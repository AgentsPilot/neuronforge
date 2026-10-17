# Workplan: Business OS Data Export — DE-8b One zip end to end (Phase 1 cut)

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md): §0.2 (DX-2, DX-3, DX-10), **§0.4.1 A, B, C, E (binding over §0.3 for Phase 1)**, the DE-8b notes in §0.5 to §0.11, and §0.12 (DE-8a as built, SA Q-6 / Q-12)
**Branch:** `feature/data-export-de8b` (worktree `neuronforge-de8b`, from `origin/main` `d24e3971`, 2026-10-17)
**Date:** 2026-10-17
**Status:** SA code-approved + QA PASS 2026-10-17 (QA Bug 1 fixed by TL); committed by RM. Built to SA C-1 … C-16; **no env flag** (SA ruling: §5.3, V-9, Q-11 and the flag-off rows are superseded). Branch merged `origin/main` at `e5bc1e1f` (DE-8a PR #451) before the first line of code. See [Implementation record](#implementation-record-dev-2026-10-17).

*Original status (planning):* Workplan only. No code until DE-8a is merged and its two migrations (20261074, 20261075) are applied to PROD.
**Depends on:** DE-8a (`feature/data-export-de8a`, uncommitted in worktree `neuronforge-de8a` when this was written; read from there). This plan is written against DE-8a's end state: `business_os_data_exports`, `business_os_data_export_start`, bucket `business-data-exports`, `BusinessOsDataExportJobRepository`, `EXPORT_JOB_POLICY` / `exportObjectPath`, and the six `DATA_EXPORT_*` audit names.

## Overview

DE-8b turns "Download my data" into the zip that §0.2 promised: **one zip** with one CSV per section, `data.json`, a plain-language README (English and Hebrew) and the owner's **actual files**. It is built in **one request** (≤ 60 s), uploaded to the private bucket at `{user_id}/{job_id}/1.zip`, and handed over as a **120 s signed URL**. The zip never passes through the function's response. Phase 1 size ceilings are checked **before** any heavy work, and an account over them gets a safe refusal (no file, no URL). The writer ships with its enforcer, the daily `/api/cron/data-export`, in the **same PR** (SA DE-8a Q-6). That cron runs the 3-day sweep, removes orphan objects, reaps stale `running` rows (SA DE-8a Q-12) and runs the 60% size watch.

Everything owner-facing stays behind the new flag `isBusinessOsDataExportEnabled` (default off). **The four existing "Export data" buttons keep using today's JSON route, unchanged.** DE-9 moves them to the zip and retires the JSON route (§4).

## Table of Contents

1. [What DE-8b reads, what it writes](#1-what-de-8b-reads-what-it-writes)
2. [Verified facts (read before building)](#2-verified-facts-read-before-building)
3. [Design](#3-design)
4. [Transition: the JSON route and the four entry points](#4-transition-the-json-route-and-the-four-entry-points)
5. [Routes](#5-routes)
6. [The zip builder](#6-the-zip-builder)
7. [CSV writer](#7-csv-writer)
8. [README generator](#8-readme-generator)
9. [File manifest ("Your files")](#9-file-manifest-your-files)
10. [Ceilings](#10-ceilings)
11. [File name (DX-10)](#11-file-name-dx-10)
12. [Daily cron `/api/cron/data-export`](#12-daily-cron-apicrondata-export)
13. [Audit and logs](#13-audit-and-logs)
14. [Files to create / modify](#14-files-to-create--modify)
15. [Task list](#15-task-list)
16. [Tests](#16-tests)
17. [Read-only SQL for TL (PROD)](#17-read-only-sql-for-tl-prod)
18. [Risks](#18-risks)
19. [Open questions for SA](#19-open-questions-for-sa)
20. [Business calls (TL defaults)](#20-business-calls-tl-defaults)
21. [SA Review Notes](#sa-review-notes)
22. [QA Testing Report](#qa-testing-report)
23. [Commit Info](#commit-info)

---

## 1. What DE-8b reads, what it writes

| Thing | DE-8b does | Scope |
|---|---|---|
| The 39 sections (`EXPORT_SECTIONS`, DE-1…DE-7) | Reads them through the existing `runExportSections` (unchanged), once per export | Session user id only (E-4) |
| `contact-documents`, `website-images` buckets | **Lists and downloads** objects under `{user_id}/` only | Prefix `{user_id}/`, asserted on every path |
| `contact_documents.storage_path`, `user_media.storage_path` | **Internal read, never exported** (they stay `excludedColumns`), used only to filter orphan documents and to link files to records | `.eq('user_id', session id)` |
| `business_os_data_exports` | Start (RPC), `markReady`, `markFailed`, `expireOtherReady`, `markOwnerDownloaded`, `markExpired`; cron reads | DE-8a repository |
| `business-data-exports` bucket | Upload `{user_id}/{job_id}/1.zip`, sign 120 s, remove | Path only from `exportObjectPath` |
| `STORAGE_DESCRIPTORS` | Two buckets move from `planned 'DE-8b'` to `include { folder }`; `PLANNED_FILES_ALLOWED` flips to `false` | Classification only, purge untouched |
| `vercel.json`, `bosCronJobs.ts` | One new daily job | — |
| Migration | **None** | — |
| New dependency | **None** (`fflate@0.8.3` became direct in DE-8a) | — |

## 2. Verified facts (read before building)

| # | Fact | Where checked |
|---|---|---|
| V-1 | **The business name column is `business_profiles.company_name`.** `business_name` does not exist (DE-1 42703). `company_name` is already an exported column of section `business_profile` (`BUSINESS_PROFILES_EXPORT`), and every product surface that names the business reads it (`ContextBuilder.ts:81`, `consent/recordConsent.ts:88`, `adminDeletionFacts.ts:94`, `financeHealth.ts`). `invoice_company_name` is the legal name on invoices, used only as a fallback in `footerBlockContent.ts`. **Live confirmation owed: SQL S-4 (§17)** (`business-os-schema-check`) | descriptors.ts:372, grep |
| V-2 | The name needs **no extra query**: the `business_profile` section row is already in memory after the records pass. A failed or empty section gives the fallback name | sections.ts |
| V-3 | Contact document keys are **ASCII-only**: both upload paths do `file_name.replace(/[^a-zA-Z0-9.-]/g, '_')` (`documents/upload-url/route.ts:140`, `ContactDocumentService.ts:112`). A Hebrew file name is all underscores in the key. Its real name lives only in `contact_documents.file_name` | grep |
| V-4 | Key shapes: documents `{uid}/{contactId}/{ts}_{name}` and intake `{uid}/{contactId}/intake/{uuid}.{ext}`; images `{uid}/{uuid}.{ext}`, `{uid}/logo/{uuid}.{ext}`, `{uid}/generated/{hash}.png`, `{uid}/stock/{id}.jpg` | grep |
| V-5 | A document delete soft-deletes the row even if the storage remove fails, so **orphan objects can exist** (DE-4 F-7, C-11) | DE-4 |
| V-6 | `storage.from(b).list(prefix, { limit, offset })` returns `metadata.size` / `metadata.mimetype` per object. A folder has no `id`. `BusinessPurgeRepository.listObjectPathsRecursive` is the precedent walk (budget plus `truncated`) | BusinessPurgeRepository.ts:660 |
| V-7 | `createSignedUrl(path, ttl, { download: string })` exists (storage-js). **What Content-Disposition Storage sends for a non-ASCII name is unverified**; T-14 checks it on Preview | storage-js d.ts |
| V-8 | fflate's reader honours general-purpose bit 11 (UTF-8 names). T-6 pins that the writer sets it for a non-ASCII name | fflate lib |
| V-9 | `isBusinessOsDataExportEnabled` **does not exist yet** in `featureFlags.ts`; DE-8b adds it | grep |
| V-10 | New BOS crons register in `lib/cron/bosCronJobs.ts` (pinned to `vercel.json` and `maxDuration` by `bosCronJobs.test.ts`; the run-record adoption test iterates `BOS_CRON_JOBS`) and wrap the handler in `withCronRunRecord` | bosCronJobs.ts, runRecord.adoption.test.ts |
| V-11 | No business-entitlements import is needed: exporting is a data right, not a plan feature. `business-os-entitlements` therefore does not apply. If SA wants a capability gate, that is a new decision | — |
| V-12 | `bos-llm-call-standards` does not apply: there are no AI calls | — |

## 3. Design

### 3.1 Layers

```text
POST /api/business-os/data-exports  (route: auth, flag, Zod, throttle, start RPC, HTTP mapping)
        |
        v
lib/business-os/data-export/zipExport.ts   runZipExport(ctx, jobId, deps, log)   <- DE-10a reuses it
        |-- fileManifest.ts     inventory under {user_id}/ (+ orphan filter, links)   [server-only]
        |-- sections.ts         runExportSections (unchanged)                         [server-only]
        |-- csv.ts, readme.ts, fileName.ts, zipEntries.ts, ceiling.ts                 [PURE]
        |-- fflate zipSync (store for files, deflate for text)
        v
BusinessOsDataExportStorageRepository   (export bucket: upload / sign / remove / sweep list)
BusinessDataExportFilesRepository       (read-only: list + download under {user_id}/, linked rows)
BusinessOsDataExportJobRepository       (DE-8a, + listStaleRunning)
```

Pure modules have no I/O and take `now` as an input, so each gets a plain unit test. `zipExport.ts` takes its repositories as a `deps` object. Tests inject fakes, and there is no `jest.mock` of module internals.

### 3.2 One request (§0.4.1 A, as built)

| Step | What | On failure |
|---|---|---|
| 0 | Flag off → **404** (the route does not exist for owners) | — |
| 1 | `getUser()` (cookie client, used for nothing else) → 401 | — |
| 2 | Zod: empty strict body `z.object({}).strict()` (a `userId` or anything else → 400) | 400 |
| 3 | Request throttle (`lib/security/rateLimit.ts`, DE-8a R-6) | 429 |
| 4 | `startForOwner(user.id)`: `in_progress` / `daily_limit` → **409** `{ code, retryAt }` | 409 |
| 5 | `DATA_EXPORT_REQUESTED` audit (non-blocking) | — |
| 6 | **Pre-flight files:** inventory (list only, no download) → orphan filter → count + bytes ≥ ceiling? | `over_ceiling` → 413 |
| 7 | **Records:** `runExportSections` with `ROW_CEILING` (stops at the ceiling, no file read yet) | `over_ceiling` → 413 |
| 8 | Deadline check (40 s budget from step 1) | `timeout` → 503 |
| 9 | Download files one at a time (concurrency 4), counting real bytes (backstop for metadata lies) | over → 413; per-file failure → listed as failed, export continues |
| 10 | Build CSVs, `data.json`, READMEs, `files-index.csv`; `zipSync` | `error` → 500 |
| 11 | **Finished size ≤ 45 MiB** and **elapsed ≤ 40 s** | 413 / 503, **nothing uploaded** |
| 12 | Upload `exportObjectPath(user.id, jobId)`, `contentType: 'application/zip'`, `upsert: false` | `error` → 500 |
| 13 | `markReady(jobId, user.id, counts)`; `null` (the stale rule took it) → remove the object, `timeout` | 503 |
| 14 | `expireOtherReady` → remove those objects (best effort, logged; the cron is the backstop) | logged |
| 15 | `createSignedUrl(path, 120, { download: fileName })` | the export stays `ready`; 500 says "ready, download again"; the download-again route works |
| 16 | `markOwnerDownloaded` (Q-9), `DATA_EXPORT_READY` (logAndFlush), 200 `{ jobId, downloadUrl, fileName, asciiFileName, expiresAt, failedSections, missingFiles }` with `Cache-Control: no-store` | — |

**Failure invariant:** every exit after step 4 that is not 200 runs `markFailed(jobId, user.id, reason, sizes)`, removes `1.zip` if step 12 ran (idempotent remove), and writes `DATA_EXPORT_FAILED` (logAndFlush). A `try/finally` keeps one "settled" flag, so no exit path leaves a `running` row, and the stale rule backs this up. **No URL is minted before the upload and `markReady` both succeed.**

`export const maxDuration = 60` (≤ 60, below the 90 s stale rule, DE-8a forward item). `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.

## 4. Transition: the JSON route and the four entry points

| Option | What | Verdict |
|---|---|---|
| **A (Dev default)** | DE-8b leaves `GET /api/user/data-export` **byte-identical**, including its 4 MB body cap, `DATA_EXPORTED` and its characterization test. The four entry points (BOS settings page, `DangerZonePanel`, `SecurityTab`, `SecurityTabV2`) keep calling it through `downloadUserDataExport()`. DE-9 switches them to the zip route (and UI-1), turns the flag on after QA, then deletes the GET route, `JSON_BODY_MAX_BYTES` and the 413 body path | Nothing owner-facing moves before DE-9. The zip route can be exercised on Preview with the flag on, with no risk to today's button |
| B | DE-8b replaces the GET route's body with the zip | Breaks the four entry points (they expect JSON plus a filename header) before DE-9 gives them the new flow. Rejected |
| C | GET route redirects to the zip when the flag is on | A third code path in a slice that DE-9 deletes anyway. Rejected |

So the requirement's C-11 ("remove the 4 MB cap when the zip replaces the direct response") is met in **DE-9**, the slice that does the replacing. **SA Q-1.** Shared code DE-8b factors out of the JSON route, with no behaviour change: `ownerTimezone()` moves to `lib/business-os/data-export/ownerClock.ts` and both routes import it. The characterization test proves the JSON route is unchanged.

## 5. Routes

Both follow `new-api-route`: cookie-client `getUser()` for identity only, Zod before logic, repositories only, `createLogger({ module })` plus `child({ correlationId })`, no `console.*`, the dev-only `details`, and non-blocking audit (READY / FAILED via `logAndFlush`, the WC-7 bounded flush).

### 5.1 `POST /api/business-os/data-exports`: start and build

**File:** `app/api/business-os/data-exports/route.ts`

| Status | Body |
|---|---|
| 200 | `{ success: true, data: { jobId, downloadUrl, fileName, asciiFileName, expiresAt, failedSections: string[], missingFiles: number } }` |
| 400 | Zod (any body key) |
| 401 | no session |
| 404 | flag off |
| 409 | `{ success: false, code: 'export_in_progress' \| 'export_daily_limit', retryAt }` |
| 413 | `{ success: false, code: 'export_too_large', error: <§0.4.1 C sentence> }`, the same code as the JSON route, so `downloadUserDataExport` already understands it |
| 429 | throttle |
| 503 | `{ success: false, code: 'export_timeout' }` (time ceiling or stale-run loss) |
| 500 | generic |

There is no user id from body, header or query. The only id is `user.id` (C-10: `startForOwner`).

### 5.2 `GET /api/business-os/data-exports/[jobId]/parts/[partNo]/download`: download again

**File:** `app/api/business-os/data-exports/[jobId]/parts/[partNo]/download/route.ts`

Flag → auth → Zod on the path (`jobId` uuid; `partNo` exactly `'1'` in Phase 1) → `findById(jobId, user.id)` (a foreign id returns `null` → **404**, the same as a missing id) → `status === 'ready'` and `expires_at > now` else **410** `{ code: 'export_expired' }` → file name re-derived (§11: the business name and timezone are read again, never stored) → `createSignedUrl(…, 120, { download })` → `markOwnerDownloaded` → `DATA_EXPORT_DOWNLOADED` (non-blocking, `.catch`) → 200 `{ downloadUrl, fileName, asciiFileName, expiresAt }`, `no-store`.

There is no status/list route in DE-8b: DE-9 needs one for "Last export … download again until …" and adds it with its UI (**SA Q-14**).

### 5.3 Flag

`isBusinessOsDataExportEnabled()` in `lib/utils/featureFlags.ts`, reading `NEXT_PUBLIC_BUSINESS_OS_DATA_EXPORT_ENABLED === 'true'` (`NEXT_PUBLIC_` so DE-9's client buttons read the same flag; **SA Q-11**). It is not `use…`-named (`lint:hooks`). It goes in `docs/feature_flags.md`. **The cron ignores the flag**: the sweep must run whenever a writer could have written (SA Q-6).

## 6. The zip builder

**File:** `lib/business-os/data-export/zipExport.ts` (server-only)

```typescript
export type ZipExportOutcome =
  | { kind: 'ready'; job: DataExportJob; fileName: string; asciiFileName: string; failedSections: ExportSectionId[]; missingFiles: number; ceilingUsePct: number }
  | { kind: 'refused'; reason: 'over_ceiling'; measured: CeilingMeasure }
  | { kind: 'failed'; reason: 'timeout' | 'error'; measured: Partial<CeilingMeasure> };

export async function runZipExport(
  ctx: ExportContext,           // userId = session id (owner) or path id (DE-10a)
  jobId: string,                // from the start RPC, never from a caller
  deps: ZipExportDeps,          // repositories + clock, injected
  log: SectionRunLogger,
): Promise<ZipExportOutcome>;
```

The route maps the outcome to HTTP and audit. DE-10a calls the same function with the target's context, so the admin path has the same ceilings and the same file (§0.4.1 C).

**Zip layout** (entry names ASCII except file names; UTF-8 flag set when non-ASCII):

```text
README.txt                         English (UTF-8 with BOM)
README-he.txt                      Hebrew  (UTF-8 with BOM)
data.json                          the machine file (§6.1)
records/account/<section>.csv      8 sections
records/client_records/<section>.csv   26 sections
records/content/<section>.csv      5 sections
files-index.csv                    one row per file in "Your files" (§9.3)
files/client-documents/<contact_id>/<file name>
files/website-images/<path below the owner folder>
```

The folder names come from the bucket's `include.folder` (descriptor), never from the bucket id. A failed section still gets its CSV, holding only the header row, and is marked `failed` in the README and `data.json` (FR-E12: never silently empty).

**Compression:** `zipSync(entries)` with a per-entry `level`: `0` (store) for files under `files/`, `6` for text. Memory peak is about files (≤ 40 MiB) + text + zip (≤ 45 MiB), well under 150 MiB.

### 6.1 `data.json`

It is `buildExportPayload(...)` as today, plus two additive fields, so `format_version` stays `2`:
- `export_metadata.export_format: 'ZIP'` (the type widens to `'JSON' | 'ZIP'`), and the groups whose controller is `account_holder` carry the business name instead, when there is one (DE-4 SA-Q13). With no name they keep `'account_holder'`. The type widens `controller` to `string`. **The JSON route passes no name, so its output stays byte-identical** (characterization test).
- `files: FileManifestEntry[]` (the same rows as `files-index.csv`).

`summary.export_size_kb` keeps today's meaning (the JSON head). The zip's bytes go in the audit and job row only.

## 7. CSV writer

**File:** `lib/business-os/data-export/csv.ts` (PURE)

`toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): Uint8Array`

| Rule | Ruling |
|---|---|
| Header | `exportColumnsOf(exportDescriptorOfSection(id).table)` (DE-4 note); `account_identity` uses its fixed three columns. An empty or failed section still has its header row |
| Encoding | UTF-8 with **BOM** (`EF BB BF`), so Excel opens Hebrew correctly |
| Line end | CRLF (RFC 4180), including after the last row |
| Quoting | A cell is quoted when it contains `,` `"` CR or LF, or begins or ends with a space; `"` doubles |
| Values | `null`/`undefined` → empty; `string` → as is (after neutralising); `number` → `String(n)`, never neutralised (so `-5` stays a number); `boolean` → `true`/`false`; object/array → `JSON.stringify` (DE-4 rule: jsonb as JSON text in one cell) |
| **CSV injection** | A **string** cell whose first character is `=` `+` `-` `@`, TAB (`\t`) or CR (`\r`) is prefixed with `'` (OWASP). Neutralising is checked **after** JSON-stringifying objects (they start with `{`/`[`, so they are safe) and **before** quoting. `data.json` keeps the exact value. The README says so (BC-1) |
| Column order | descriptor order; a row key outside the header is never written (pinned) |

## 8. README generator

**File:** `lib/business-os/data-export/readme.ts` (PURE). `buildReadme(lang: 'en' | 'he', facts: ReadmeFacts): string`. All copy lives in one typed table per language, so a missing Hebrew string fails `tsc` and the test.

`ReadmeFacts` = business name (or null), start instant (ISO 8601 with offset) and zone name (or "UTC" when NULL), section rows `{ id, group, rowCount, status }`, file counts `{ included, missing, failed, orphanSkipped }` (orphans are counted, never named), and the ceiling notice.

**Contents, in order:**

| # | Block | Source |
|---|---|---|
| 1 | Title, "prepared by AgentPilot (provider)" (DX-10), start time with offset; "times in this file are UTC unless a column says otherwise" | §0.4.1 E |
| 2 | What is inside (the zip layout of §6, in plain words) | — |
| 3 | **Who is the controller, per group**, using the §0.4.1 E wording with the business name, or "the account holder" | §0.4.1 E |
| 4 | Sections table: file, plain name, rows, "complete" / "could not be read" | FR-E12 |
| 5 | "Your files": how many, how they link (`files-index.csv`), files with no record (logos, older uploads: Q10b), records with no file, files that could not be read | §9 |
| 6 | **Not included:** agents and agent settings; plan, billing, credits and payments to AgentPilot; activity (assistant chats, briefings, insights, emails sent, reminders sent); connected apps; the synced copy of an outside calendar; bank details; deleted items (documents, soft-deleted rows); visitor tracking (page views, link clicks, IP evidence) | DE-1 Q-6, DX-1, DE4-U2, BC-5, DE-3 BC-B, SQ-E5, DE-6 BC-1 |
| 7 | How to read it: rows are in `id` order, not date order (DE-4 SA-Q8); "as of the start time, best effort" (SQ-A5); CSV cells starting with `= + - @` carry a leading `'` (BC-1); jsonb as JSON text | DE-4, §7 |
| 8 | **Timezones:** `preferences.timezone` is the authority, `user_profile.timezone` a mirror, `notification_settings.quiet_hours_timezone` the quiet hours only | DE-3 SA-Q8 |
| 9 | **Money:** amounts exactly as stored next to their currency; no totals (use the ledger export); `processor_fee`/`net_amount` are in `fee_currency`, which can differ from `currency`; an empty fee = not recorded, not zero; **refunds are stored positive** (money returned; `payments.amount` is gross, so do not count twice); `fee_returned`/`refund_fee` SA-Q6 wording verbatim; invoice links open the invoice for anyone holding them; `website_content.payment_button` keeps its own amount and currency | DE-5 SA-Q4/Q6/Q9, BC-3, BC-11, DE-7 |
| 10 | **Consent:** the current answer for an address is its latest consent record (a withdrawal wins a tie); for email, `email_unsubscribes` and `newsletter_subscribers.status` give it directly; only the current privacy notice text is kept; `redacted@invalid` + `redacted_at` = a decision existed and was erased | DE-6 BC-6, R-5, BC-8 |
| 11 | **Page addresses** are shown without their query string or `#` part, **so an empty page address can mean the original held only a query or fragment, not that none was recorded** | DE-6 SA-Q7, QA note 1 |
| 12 | Website: to rebuild a page read `website_blocks` (base) + `website_content` (edits); `business_profile.subdomain` is the authority, `website_pages.subdomain` a copy; smart-link totals are not in the file | DE-7 notes |
| 13 | Retention: the download link works for 3 days, then the file is deleted; "prepare again" any time (limits: 1 at a time, 3 per day) | §0.2 DX-4 |
| 14 | Questions: AgentPilot support (legal-entity line is copy, open lawyer note §0.2) | §0.4.1 E |

The business name appears in the README and `data.json` only, **never** in a log, audit detail or object path (§0.4.1 E "Never"). It is put in as plain text (no markup interpreted). Bidi-control characters are stripped from it (as in §11) so a crafted name cannot reorder the README.

## 9. File manifest ("Your files")

**File:** `lib/business-os/data-export/fileManifest.ts` (server-only)

### 9.1 Inventory

For each `STORAGE_DESCRIPTORS` entry with `export.kind === 'include'` (after T-1: `contact-documents` → folder `client-documents`, `website-images` → folder `website-images`; `business-purge-snapshots` and `business-data-exports` stay `exclude`):

1. `filesRepo.listOwnerObjects(bucket, userId, budget)` walks recursively from prefix `${userId}` only. It returns `{ name, size, mimetype }[]` and `truncated`. Budget: 15 s / 300 list calls, shared across buckets. **Truncated → the export fails `error`** (an incomplete "Your files" is not offered as complete).
2. Each returned path must start with `${userId}/` and contain no `..`, `.` or empty segment, no backslash and no control character. **Otherwise it is dropped and logged as `data_export_file_path_rejected`** (counts only; it should never happen).

### 9.2 Orphan filter and links (C-11, Q10b, DE-7 SA-Q5)

| Bucket | Inventory authority | Rule |
|---|---|---|
| `contact-documents` | **The rows.** `filesRepo.listLiveDocumentFiles(userId)` → `{ id, contact_id, storage_path, storage_bucket, file_name, mime_type }` where `status <> 'deleted'`, `.eq('user_id', userId)`, keyset paged | An object is in "Your files" **only if** a live row has `storage_path === object name` and `storage_bucket` = `'contact-documents'` (or NULL, the default). Objects of deleted or missing rows are **skipped** and counted as `orphanSkipped`. A live row with no object goes in `missingFiles` (README block 5). A row whose `storage_path` is outside `${userId}/` never matches (the walk never lists it): pinned by the crossed-pointer test |
| `website-images` | **The bucket listing** (Q10b: logos and pre-F-27 uploads have no `user_media` row and are still the owner's) | Every listed object is in. `filesRepo.listMediaPaths(userId)` → `{ id, storage_path }` links the ones that have a `user_media` row; the others have an empty link |

`storage_path` is read **internally** and never written. The section CSVs still exclude it (`DOCUMENT_STORAGE`), and `files-index.csv` holds the **zip path**, never the storage key.

### 9.3 Entry names and `files-index.csv`

| Bucket | Zip entry |
|---|---|
| `contact-documents` (linked) | `files/client-documents/<contact_id>/<clean(file_name)>`: the **original upload name** (Hebrew survives; V-3), not the underscore key (**SA Q-13**, deviates from the DE-7 SA-Q5 proposal) |
| `website-images` | `files/website-images/<clean(each segment of the key below {user_id}/)>` (the DE-7 SA-Q5 proposal) |

`clean()` (in `zipEntries.ts`, PURE) applies NFC; strips C0/C1 control and bidi-control characters (U+200E/F, U+202A–E, U+2066–9); replaces `/ \ : * ? " < > |` with `-`; trims spaces and dots at both ends; caps a segment at 120 UTF-16 units on a code-point boundary, keeping the extension. An empty result or a Windows reserved stem (`con`, `prn`, `aux`, `nul`, `com1`–`9`, `lpt1`–`9`) becomes `file` + extension. The joined name can never start with `/`, contain `..` or a drive letter (`c:`), because each segment is cleaned and joined under a fixed ASCII prefix. Duplicates within a folder get ` (2)`, ` (3)` before the extension, compared case-insensitively (Windows).

**No `file_in_export` column on the sections (SA Q-2).** Adding a computed column to `client_documents` or `images` breaks the "`columns ∪ excludedColumns` = live set" invariant that `schema:reconcile` and the DE pins rely on. Instead the link lives in one place:

`files-index.csv` / `data.json.files`: `path_in_export, folder, size_bytes, content_type, record_section, record_id, status` where `record_section` ∈ `client_documents | images | ''`, `record_id` = the row `id` (already in that section's CSV) and `status` ∈ `included | could_not_be_read`. Rows with no object are counted in the README, not listed (they are already in their section CSV).

`BucketDescriptor.export.include.folder` values are pinned in `exportClassification.test.ts`.

## 10. Ceilings

**File:** `lib/business-os/data-export/limits.ts` (extend; read at call time) and `ceiling.ts` (PURE)

| Constant | Value | Checked |
|---|---|---|
| `FILE_BYTES_CEILING` | 41,943,040 (40 MiB) | pre-flight (metadata) and during download (real bytes) |
| `FILE_COUNT_CEILING` | 150 | pre-flight, after the orphan filter |
| `ROW_CEILING` | 100,000 (existing) | records pass (existing `overCeiling`) |
| `ZIP_BYTES_CEILING` | 47,185,920 (45 MiB, under the bucket's 50 MiB) | after `zipSync`, **before upload** |
| `BUILD_MS_CEILING` | 40,000 | before downloads, before zip, **before upload** |
| `NEAR_CEILING_RATIO` | 0.6 | success log + cron watch |

The pre-flight files check comes **before** the records pass because a file listing is cheap, and **before any download** (the heavy part). **The row check is the records pass itself**: it stops at the ceiling with no file read, and it is bounded memory (≤ 100k flat rows). A separate `count`-head pre-pass would add about 40 queries and a new repository method for a check the bounded read already makes (**SA Q-3**: requirement text says "count head queries").

`ceilingUse(measure)` returns `{ pct, over: ('fileBytes'|'fileCount'|'rows'|'zipBytes'|'buildMs')[] }`, where `pct` is the highest of the five ratios, rounded to an integer. Sizes go to `markFailed` / `markReady` (`bytes` = the zip bytes when built, otherwise the file bytes measured; `file_count`, `row_count`).

**Over the time budget** gives `failure_reason = 'timeout'`, not `over_ceiling` (it is ours, not the account's size; **SA Q-5**). The owner sees the generic "could not prepare, try again" (503), and it does not count against the daily 3.

## 11. File name (DX-10)

**File:** `lib/business-os/data-export/fileName.ts` (PURE)

`exportZipFileNames(now: Date, timezone: string | null, businessName: string | null): { fileName: string; asciiFileName: string }`

| Step | Rule |
|---|---|
| Stamp | `YYYY-MM-DD-HHmm` from `toBusinessLocalInput(now, tz)`, the same as the DE-4 JSON name (DE4-U1: time included); NULL/invalid tz → UTC (`safeTimezone`) |
| Slug | NFC → keep `\p{L}\p{M}\p{N}`; every other run → one `-` (incl. bidi controls, `/ \ : * ? " < > |`, spaces, punctuation, emoji) → trim `-` and `.` at both ends → `toLowerCase()` → cut to **60 code points** (never inside a surrogate pair; re-trim `-`) |
| Empty / reserved | Empty slug, or a slug equal to `con prn aux nul com1–9 lpt1–9` → no slug |
| `fileName` | `<slug>-data-export-<stamp>.zip`, or `agentpilot-data-export-<stamp>.zip` without a slug |
| `asciiFileName` | the slug with non-ASCII letters removed, the `-` runs collapsed and re-trimmed; empty → `agentpilot-data-export-<stamp>.zip` |
| Header form | `contentDisposition(fileName, asciiFileName)` = `attachment; filename="<ascii>"; filename*=UTF-8''<RFC 5987 percent-encoded fileName>` (used by tests and as the reference T-14 compares against) |

**Delivery:** the signed URL carries `download: fileName`. **T-14 (Preview, Dev):** download a Hebrew-named export in Chrome and Edge and record the `Content-Disposition` Storage sends. If it is not a correct `filename*` (or the browser saves a mangled name), DE-8b switches the URL to `download: asciiFileName`, and the 200 body already carries the Unicode `fileName` for DE-9's fetch-and-blob path (§0.4.1 E fallback). The result goes in this workplan.

## 12. Daily cron `/api/cron/data-export`

**Files:** `app/api/cron/data-export/route.ts` (thin), `lib/business-os/data-export/exportSweep.ts` (logic, deps injected)

`runtime = 'nodejs'`, `maxDuration = 60`, fail-closed `CRON_SECRET` (copied from `credit-leak-check`, `durable-queue-drain` Step 8), wrapped in `withCronRunRecord('data-export', …)`. Schedule `25 5 * * *` (no clash with any `:x5` hourly or daily job, DE-8a §7). Registered in `bosCronJobs.ts` (`DAILY`, `MAX_60`, counts below) and `vercel.json`. **Not a queue drain:** every step is idempotent and two overlapping runs are harmless (DE-8a D-10). Each step has its own budget, so one slow step cannot starve the next. A step that throws is logged and counted, and the run continues.

| Step | What | Scope |
|---|---|---|
| 1 Reap (Q-12) | `listStaleRunning(now − 90 s, limit 500)` (**new** cross-account read, the same predicate as the start function) → for each, `markFailed(row.id, row.user_id, 'timeout')` + remove `exportObjectPath(row.user_id, row.id)` (idempotent) + `DATA_EXPORT_FAILED` (actor `system`) | per row's own `user_id` (tenant-isolation-guard Step 6) |
| 2 Expire | `listDueForExpiry(now)` → for each: **remove the object first**, then `markExpired(id, user_id)` + `DATA_EXPORT_EXPIRED`. Remove failed → the row stays `ready` (retried tomorrow); routes already refuse after `expires_at`, so it cannot be downloaded | per row |
| 3 Orphans | Walk `business-data-exports` (root → `{user_id}/` → `{job_id}/` → objects; budget 15 s). Folder names must be uuids, else it is logged and left alone (never removed by a guess). `findJobsByIds(jobIds)`. An object is **kept only if** a row exists with the same `id` **and the same `user_id` as its folder** and status `running` or `ready`. Otherwise it is removed when its `created_at` is older than 10 minutes (**SA Q-6**: stricter than "older than 3 days", so a hard-deleted user's or failed job's file does not wait 3 days) | path rebuilt with `exportObjectPath` from the two folder uuids, never the raw listed name |
| 4 Size watch | For each include bucket: list root folders (owner ids), walk each owner (shared 20 s budget), apply the **same** orphan filter for documents (one `listLiveDocumentFiles` per owner with files), compute bytes and count → `accountsNearCeiling` (≥ 60% of 40 MiB or 150 files), `accountsOverCeiling`; one `warn` `data_export_accounts_near_ceiling` with the counts and the near/over **user ids only**, when either count > 0 (§0.4.1 C). Records are not watched (§0.4.1 C) | read-only |

Response: `{ success: true, data: { staleReaped, expired, expireFailed, orphansRemoved, orphansKept, accountsWatched, accountsNearCeiling, accountsOverCeiling, incompleteSteps } }`. The counts are registered for the run record (no money; keys match `^[a-zA-Z][a-zA-Z0-9]{0,39}$`). `partlyDoneWhen`: `incompleteSteps ≥ 1` or `expireFailed ≥ 1`.

Size watch method (**SA Q-7**): the Storage API walk costs one list call per owner folder (about 80 objects across all accounts today) and needs **no migration**. The alternative, one aggregate over `storage.objects` through a new read-only function, needs a hand-applied migration and a grant. If SA prefers the SQL function, it is +0.5 d plus a TL apply step.

## 13. Audit and logs

| Event (DE-8a names, severities fixed) | When | Details (never content, names or emails) |
|---|---|---|
| `DATA_EXPORT_REQUESTED` info | start answered `started` | `job_id`, `requested_by_kind: 'owner'` |
| `DATA_EXPORT_READY` info | 200 | `job_id`, `section_counts`, `failed_sections`, `bytes`, `file_count`, `row_count`, `missing_files`, `ceiling_use_pct`, `duration_ms`, `format_version` |
| `DATA_EXPORT_FAILED` warning | every non-200 after start; cron reap | `job_id`, `reason`, measured sizes, `ceiling_over: […]` |
| `DATA_EXPORT_DOWNLOADED` info | download-again route | `job_id`, `part_no: 1` |
| `DATA_EXPORT_EXPIRED` info | cron step 2 | `job_id` |

`entityType 'user'`, `entityId = userId`, `userId = userId`. READY and FAILED use `logAndFlush` (WC-7); the others use `log().catch(…)`. The cron flushes once at the end. **`DATA_EXPORTED` is not written by the zip route**: it stays the JSON route's event until DE-9 retires that route (**SA Q-8**). The new events are `shared` audience and owner-visible by default. SA confirms whether they need `ownerVisibility` / owner presentation entries.

Logs: `data_export_over_ceiling` (warn: userId, jobId, bytes, files, rows, which ceiling), `data_export_near_ceiling` (warn, ≥ 60%), `data_export_ready` (info, with `ceilingUsePct`), `data_export_accounts_near_ceiling` (cron warn). Ids, counts, bytes and durations only (§0.3.2): no file names, no business name, no email.

## 14. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/api/business-os/data-exports/route.ts` | create | POST start + build (§5.1) |
| `app/api/business-os/data-exports/[jobId]/parts/[partNo]/download/route.ts` | create | download again (§5.2) |
| `app/api/cron/data-export/route.ts` | create | daily sweep (§12) |
| `lib/business-os/data-export/zipExport.ts` | create | orchestrator (§6), reused by DE-10a |
| `lib/business-os/data-export/fileManifest.ts` | create | inventory, orphan filter, links (§9) |
| `lib/business-os/data-export/exportSweep.ts` | create | cron logic (§12) |
| `lib/business-os/data-export/csv.ts` | create | PURE (§7) |
| `lib/business-os/data-export/readme.ts` | create | PURE en/he (§8) |
| `lib/business-os/data-export/fileName.ts` | create | PURE (§11) |
| `lib/business-os/data-export/zipEntries.ts` | create | PURE entry cleaning + dedupe (§9.3) |
| `lib/business-os/data-export/ceiling.ts` | create | PURE (§10) |
| `lib/business-os/data-export/ownerClock.ts` | create | `ownerTimezone` moved out of the JSON route, no behaviour change |
| `lib/business-os/data-export/limits.ts` | modify | the five new constants |
| `lib/business-os/data-export/payload.ts` | modify | optional `accountHolderName`, `export_format` `'ZIP'`, optional `files`; JSON output unchanged |
| `lib/business-os/data-export/classificationTypes.ts` | modify | comment: `PlannedFilesSlice` forbidden on buckets since DE-8b (type kept for negative controls, as DE-7 SA-Q9) |
| `lib/business-os/purge/descriptors.ts` | modify | two buckets `include { folder }` (classification only; purge fields untouched) |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | modify | `PLANNED_FILES_ALLOWED = false`; folder pins; controls moved to an excluded bucket |
| `lib/repositories/BusinessDataExportFilesRepository.ts` | create | read-only: `listOwnerObjects`, `downloadOwnerObject`, `listLiveDocumentFiles`, `listMediaPaths` (`new-repository`; bounds F-1…F-6 below; **SA Q-4**) |
| `lib/repositories/BusinessOsDataExportStorageRepository.ts` | create | export bucket only: `upload`, `sign`, `remove`, `listForSweep` |
| `lib/repositories/BusinessOsDataExportJobRepository.ts` | modify | `listStaleRunning(before, limit)` (cross-account, cron only, commented as the other two) |
| `lib/repositories/types.ts` | modify | types for the above |
| `app/api/user/data-export/route.ts` | modify | import `ownerTimezone` from `ownerClock.ts` only |
| `lib/utils/featureFlags.ts`, `docs/feature_flags.md` | modify | `isBusinessOsDataExportEnabled` |
| `lib/cron/bosCronJobs.ts`, `vercel.json` | modify | the `data-export` job |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | modify | new §0.13 DE-8b status (standing rule) |
| tests (§16) | create | — |

**`BusinessDataExportFilesRepository` bounds (as DE-4's E-1…E-6):**
- F-1: read-only (no upload, remove, update or rpc; a source scan pins it).
- F-2: a bucket is accepted only if its `STORAGE_DESCRIPTORS` entry is `include`, resolved by name from the descriptors. Anything else returns `{ error }` and makes no call.
- F-3: every list and download path is `${userId}/…`, checked again on each returned name.
- F-4: `userId` is the caller's session id (or the DE-10a path id); there is no find-by-object-key.
- F-5: service role, with the reason documented (the buckets have no owner read policy for the server).
- F-6: the sole importer is `fileManifest.ts` (pinned by a scan); it is not in `lib/repositories/index.ts`.

## 15. Task list

- ✅ T-0 After DE-8a merges and 20261074/75 are applied: `git merge origin/main`; confirm `checker PASS 18/0` was recorded; TL runs SQL S-1…S-6 (§17); record results in §17.1
- ✅ T-1 Buckets `include { folder }`, `PLANNED_FILES_ALLOWED = false`, move bucket negative controls (each shown red once)
- ✅ T-2 `limits.ts` constants + `ceiling.ts` + tests
- ✅ T-3 `csv.ts` + tests (BOM, CRLF, quoting, injection, numbers, jsonb)
- ✅ T-4 `fileName.ts` + tests (Hebrew, Arabic, CJK, emoji, bidi, reserved, empty, 60-code-point cut, surrogate pair, tz NULL/invalid, midnight)
- ✅ T-5 `zipEntries.ts` + tests (zip-slip, drive letters, reserved, duplicates, case-insensitive dupes, extension kept)
- ✅ T-6 fflate spike: `zipSync` with store/deflate levels, UTF-8 flag on a Hebrew name, round-trip with `unzipSync`; record peak memory for a 40 MiB fixture
- ✅ T-7 `readme.ts` en/he + tests (every §8 block present in both; business name absent → "the account holder"; bidi stripped)
- ✅ T-8 `BusinessDataExportFilesRepository` + `BusinessOsDataExportStorageRepository` + `listStaleRunning` (`new-repository`), unit tests per method incl. cross-tenant fakes
- ✅ T-9 `fileManifest.ts` + tests (orphan filter, Q10b, crossed pointer, truncation → error)
- ✅ T-10 `payload.ts` additive fields; JSON route characterization still byte-identical; `ownerClock.ts` extraction
- ✅ T-11 `zipExport.ts` + tests (every outcome, invariant "no URL before upload + ready", object removed on every failure after upload)
- ✅ T-12 POST route + download route (no flag: SA ruling) (`new-api-route`): integration tests incl. 401/400/404/409/413/503
- ✅ T-13 `exportSweep.ts` + cron route + `bosCronJobs` + `vercel.json`; adoption and schedule tests green
- ⬜ T-14 Preview check (flag on in Preview only): Hebrew, English and no-business accounts; record `Content-Disposition`; open the zip in Windows Explorer and macOS Archive Utility (Hebrew file name); open a CSV in Excel (Hebrew, a `+972…` phone); check the 413 refusal on a Preview test account with planted files over 150 objects (the ceilings are constants, never env-tunable, so the refusal logic itself is proven in Jest)
- ✅ T-15 `npm run test:bos-entitlements` not needed (no entitlements import, V-11); run the targeted Jest list + `npm run lint` + `lint:hooks`; measure Jest delta (no added critical-path time)
- ✅ T-16 Requirement §0.13 splice + this workplan's implementation record

**Effort:** 🔴 about **3 days** (requirement estimate 2.5 d; +0.5 d for the files repository bounds, the orphan and link rules and the cron's four steps). +0.5 d if SA picks the SQL size-watch function (Q-7) or count-head pre-pass (Q-3).

## 16. Tests

All Jest, with fakes injected through `deps` or the repository's client parameter. They run in the existing Tests job: no DB, no network, no added critical-path time.

| Suite | Covers | Negative controls |
|---|---|---|
| `csv.test.ts` | BOM first 3 bytes; CRLF; quoting; jsonb as JSON text; header-only for an empty section; column order | `=1+1`, `+972…`, `-2`, `@SUM`, `\tx`, `\rx` strings all prefixed with `'`; **number** `-5` NOT prefixed; `{"a":"=x"}` object not prefixed (starts with `{`); an extra row key never written |
| `fileName.test.ts` | Latin → `acme-studio-data-export-2026-10-17-0930.zip`; `"סטודיו נוגה"` → `סטודיו-נוגה-data-export-…` and ASCII fallback `agentpilot-data-export-…`; mixed `Café Noga 2` → `café-noga-2` / ascii `caf-noga-2`; tz Asia/Jerusalem vs NULL vs `"Mars/Base"` | `../../etc`, `CON`, `" "`, a name of only emoji, U+202E (RLO) mid-name, a 200-char name cut inside a surrogate pair, `filename*` encoding of `%` and `'` |
| `zipEntries.test.ts` | cleaning; dedupe ` (2)`; extension kept | `../x`, `/abs`, `C:\x`, `a/../../b`, `.`, `..`, NUL, `nul.txt`, `Report.PDF` vs `report.pdf` |
| `readme.test.ts` | every §8 block in en and he (keyed ids, not prose); name present / absent; failed sections listed | business name with bidi controls stripped; name never in a "Not included" or log-bound string |
| `ceiling.test.ts` | pct is the max ratio; 60% boundary | exactly at ceiling = ok, +1 = over, for each of the five |
| `BusinessDataExportFilesRepository.test.ts` | recursive walk with sizes; paging; budget → truncated; download | **cross-tenant:** list called with another prefix never happens (spy); a fake list returning `../other-uid/x` or `other-uid/x` is rejected; an `exclude` bucket name refused with no call; source scan: no `.upload(`/`.remove(`/`.update(`/`.rpc(`; sole-importer scan |
| `BusinessOsDataExportStorageRepository.test.ts` | upload sets `contentType: 'application/zip'`, `upsert: false`; sign TTL 120 and `download` passed; remove idempotent | non-uuid ids throw before any call (via `exportObjectPath`) |
| `fileManifest.test.ts` | docs linked by `storage_path`, entries named from `file_name`; images linked/unlinked; `files-index` rows | **orphan:** an object whose row is `deleted` → skipped + counted; an object with no row → skipped; **crossed pointer:** tenant A row with `storage_path` under tenant B → not listed, not downloaded (B's file never fetched: spy); Q10b unlinked logo included; walk truncated → `error` |
| `zipExport.test.ts` | happy path: unzip and assert layout, 39 CSVs, `data.json` parse, both READMEs, files present byte-for-byte; failed section → header-only CSV + `failed` | **over-ceiling** (files bytes, count, rows, zip size): no `upload` call, no `sign` call, `markFailed('over_ceiling')`; build over 40 s (fake clock) → `timeout`, no upload; upload ok + `markReady` null → object removed, no URL; a file download error → `could_not_be_read`, export still ready; metadata says 1 MB but real bytes push past 40 MiB → refused before zip |
| `app/api/business-os/data-exports/__tests__/route.test.ts` | 200 shape, `no-store`; READY via logAndFlush | 401; 400 with `{ userId: <other> }` (and the RPC never called); 404 flag off; 409 both codes; 413 code `export_too_large` and no `downloadUrl`; every failure path calls `markFailed` once; no business name in any logger/audit call argument (deep scan of mock calls) |
| `…/download/__tests__/route.test.ts` | 200 for own ready job | **foreign job id → 404** (repo called with session id); expired → 410; `partNo` `2`/`../1` → 400; flag off → 404 |
| `exportSweep.test.ts` | reap, expire, orphan, watch counts | object in tenant A's folder whose job id belongs to tenant B → **removed** (user_id mismatch), and the path is rebuilt from the folder ids; non-uuid folder → left; remove failure → row stays ready; young (< 10 min) unknown object kept; doc orphans excluded from the watch |
| `app/api/cron/data-export/__tests__/route.test.ts` | — | no secret in production → 401 and nothing called; wrong bearer → 401 |
| existing `bosCronJobs.test.ts`, `runRecord.adoption.test.ts` | the new job pinned to `vercel.json`/`maxDuration`; records a run | — |
| existing `exportClassification.test.ts` | buckets classified, `planned` forbidden on buckets | planted `planned` bucket fails (shown red once) |
| existing JSON route characterization | **byte-identical** output after `ownerClock`/`payload` changes | — |

Manual (T-14) is recorded in the QA report: Preview zip opened on Windows and macOS, Excel CSV check, Hebrew file name, `Content-Disposition` text.

## 17. Read-only SQL for TL (PROD)

Run in the SQL editor as is. Every statement is a `SELECT`; nothing writes. (The scripts avoid the editor's word bug.) Results go to §17.1.

**File:** pasted by TL (not committed)

```sql
-- S-1 Stored files per owner and bucket: count, bytes, largest (top 20 by bytes)
SELECT o.bucket_id,
       (storage.foldername(o.name))[1]                     AS owner_folder,
       count(*)                                            AS files,
       sum((o.metadata->>'size')::bigint)                  AS bytes,
       pg_size_pretty(sum((o.metadata->>'size')::bigint))  AS bytes_pretty,
       max((o.metadata->>'size')::bigint)                  AS largest_bytes
FROM storage.objects o
WHERE o.bucket_id IN ('contact-documents', 'website-images', 'business-data-exports')
GROUP BY 1, 2
ORDER BY sum((o.metadata->>'size')::bigint) DESC NULLS LAST
LIMIT 20;

-- S-1b Objects whose first folder is not an existing auth user (outside an owner folder)
SELECT o.bucket_id, count(*) AS objects
FROM storage.objects o
LEFT JOIN auth.users u ON u.id::text = (storage.foldername(o.name))[1]
WHERE o.bucket_id IN ('contact-documents', 'website-images')
  AND u.id IS NULL
GROUP BY 1;

-- S-2 Q10b: website-images objects with no user_media row, by kind of path
SELECT CASE
         WHEN o.name ~ '^[^/]+/logo/'      THEN 'logo'
         WHEN o.name ~ '^[^/]+/generated/' THEN 'generated'
         WHEN o.name ~ '^[^/]+/stock/'     THEN 'stock'
         ELSE 'upload'
       END AS kind,
       count(*) AS objects_without_row
FROM storage.objects o
LEFT JOIN public.user_media m ON m.storage_path = o.name
WHERE o.bucket_id = 'website-images' AND m.id IS NULL
GROUP BY 1 ORDER BY 2 DESC;

-- S-2b Q10b: user_media rows with no object, and rows whose path is outside their owner folder
SELECT count(*) FILTER (WHERE o.id IS NULL)                                       AS rows_without_object,
       count(*) FILTER (WHERE m.storage_path NOT LIKE m.user_id::text || '/%')     AS rows_outside_owner_folder,
       count(*)                                                                   AS rows_total
FROM public.user_media m
LEFT JOIN storage.objects o ON o.bucket_id = 'website-images' AND o.name = m.storage_path;

-- S-3 Orphan document files: object present, row deleted or missing
SELECT CASE WHEN d.id IS NULL THEN 'no row' ELSE 'row ' || d.status END AS row_state,
       count(*) AS objects,
       pg_size_pretty(sum((o.metadata->>'size')::bigint)) AS bytes
FROM storage.objects o
LEFT JOIN public.contact_documents d
       ON d.storage_path = o.name AND coalesce(d.storage_bucket, 'contact-documents') = 'contact-documents'
WHERE o.bucket_id = 'contact-documents'
GROUP BY 1 ORDER BY 2 DESC;

-- S-3b Document rows: live rows with no object, other buckets, paths outside the owner folder, non-ASCII names
SELECT count(*) FILTER (WHERE d.status <> 'deleted' AND o.id IS NULL)                         AS live_rows_without_object,
       count(*) FILTER (WHERE coalesce(d.storage_bucket, 'contact-documents') <> 'contact-documents') AS rows_other_bucket,
       count(*) FILTER (WHERE d.storage_path NOT LIKE d.user_id::text || '/%')                AS rows_outside_owner_folder,
       count(*) FILTER (WHERE d.file_name ~ '[^\x01-\x7F]')                                   AS non_ascii_file_names,
       count(*) FILTER (WHERE d.file_name IS NULL OR btrim(d.file_name) = '')                AS empty_file_names
FROM public.contact_documents d
LEFT JOIN storage.objects o ON o.bucket_id = 'contact-documents' AND o.name = d.storage_path;

-- S-3c Duplicate file names per client (drives the " (2)" rule)
SELECT count(*) AS clients_with_duplicate_names
FROM (SELECT user_id, contact_id, lower(file_name)
      FROM public.contact_documents WHERE status <> 'deleted'
      GROUP BY 1, 2, 3 HAVING count(*) > 1) x;

-- S-4 Business name column (business-os-schema-check): candidates, then how they are filled
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'business_profiles'
  AND (column_name LIKE '%name%' OR column_name LIKE '%company%')
ORDER BY column_name;

SELECT count(*)                                                                 AS profiles,
       count(*) FILTER (WHERE nullif(btrim(company_name), '') IS NOT NULL)        AS company_name_set,
       count(*) FILTER (WHERE nullif(btrim(invoice_company_name), '') IS NOT NULL) AS invoice_company_name_set,
       count(*) FILTER (WHERE nullif(btrim(company_name), '') IS NULL
                          AND nullif(btrim(invoice_company_name), '') IS NOT NULL) AS only_invoice_name,
       count(*) FILTER (WHERE company_name ~ '[^\x01-\x7F]')                      AS non_ascii_company_name,
       max(char_length(company_name))                                            AS longest_company_name
FROM public.business_profiles;

-- S-5 Owners near the Phase 1 file ceiling (60% of 40 MiB = 25,165,824 bytes, or 90 of 150 files),
--     counting only files the export would include (document orphans left out)
WITH f AS (
  SELECT (storage.foldername(o.name))[1] AS owner_folder, (o.metadata->>'size')::bigint AS bytes
  FROM storage.objects o
  WHERE o.bucket_id = 'website-images'
  UNION ALL
  SELECT (storage.foldername(o.name))[1], (o.metadata->>'size')::bigint
  FROM storage.objects o
  JOIN public.contact_documents d
    ON d.storage_path = o.name AND d.status <> 'deleted'
   AND coalesce(d.storage_bucket, 'contact-documents') = 'contact-documents'
  WHERE o.bucket_id = 'contact-documents'
)
SELECT owner_folder, count(*) AS files, sum(bytes) AS bytes,
       round(100.0 * greatest(sum(bytes) / 41943040.0, count(*) / 150.0)) AS ceiling_use_pct
FROM f GROUP BY 1
ORDER BY ceiling_use_pct DESC
LIMIT 10;

-- S-6 Records rows per owner across the biggest included tables (rough upper bound vs 100,000)
SELECT user_id, sum(n) AS rows_estimate FROM (
  SELECT user_id, count(*) AS n FROM public.crm_activities GROUP BY 1
  UNION ALL SELECT user_id, count(*) FROM public.crm_contacts GROUP BY 1
  UNION ALL SELECT user_id, count(*) FROM public.scheduling_bookings GROUP BY 1
  UNION ALL SELECT user_id, count(*) FROM public.payment_transactions GROUP BY 1
  UNION ALL SELECT user_id, count(*) FROM public.marketing_consent_events GROUP BY 1
) t GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
```

### 17.1 Results (TL fills in)

| Query | Result | Effect on the plan |
|---|---|---|
| S-1 / S-1b | — | — |
| S-2 / S-2b | — | — |
| S-3 / S-3b / S-3c | — | — |
| S-4 | — | `company_name` confirmed? |
| S-5 / S-6 | — | — |

## 18. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | Storage sends a wrong `Content-Disposition` for a Hebrew name | Medium / low | T-14; ASCII `download` + DE-9 blob fallback (§11) |
| R-2 | The business name rides in the signed URL's `download` query, so it reaches Supabase's own request logs and browser history | Certain / low | Required by §0.4.1 E; our Pino logs and audit never carry it. If SA objects, use `download: asciiFileName`, or no `download`, with the DE-9 blob path |
| R-3 | A file is deleted between listing and download | Low / none | `could_not_be_read` / README "removed before export" (SQ-A5); export continues |
| R-4 | Storage list metadata `size` missing or wrong | Low / low | Real bytes counted during download; ceilings re-checked; zip size checked before upload |
| R-5 | Function killed at 60 s after upload, before `markReady` | Very low / low | Stale rule (start fn + cron reap) marks it failed; orphan sweep removes the object within a day |
| R-6 | Physical deletion up to about 24 h after the 72 h (daily cron) | Certain / low | Routes refuse after `expires_at`, so it cannot be downloaded; BC-10 |
| R-7 | CSV `'` prefix on phone numbers like `+972…` surprises an owner in Excel | Certain / low | README line; `data.json` exact; BC-1 |
| R-8 | Memory: about 40 MiB of files + 45 MiB of zip in one function | Low / medium | Ceilings; T-6 measures the peak; Vercel default memory ≫ 150 MiB |
| R-9 | Builder time: 40 MiB of downloads plus the zip inside 40 s | Low / low | M-1: largest 14 MB; concurrency 4; time ceiling → `timeout` |
| R-10 | Deploy before DE-8a's migrations | Low / none | Implementation starts after apply (T-0); flag off; cron errors are recorded, nothing written |
| R-11 | New audit events show in the owner's Activity log | Medium / low | SA Q-8 |

## 19. Open questions for SA

| # | Question | Dev default |
|---|---|---|
| Q-1 | JSON route and its 4 MB cap stay byte-identical in DE-8b; DE-9 switches the four entry points and deletes both (§4)? | Yes (option A) |
| Q-2 | File↔record link as `files-index.csv` + `data.json.files`, **not** a computed `file_in_export` column on `client_documents` / `images` (keeps the live-columns invariant)? | Yes, no column |
| Q-3 | Row ceiling enforced by the bounded records pass (stops at 100k, before any file download) instead of a separate count-head pre-pass? | Yes |
| Q-4 | One read-only `BusinessDataExportFilesRepository` with bounds F-1…F-6 (a granularity exception like DE-4 SA-Q1), rather than new methods on `ContactDocumentsRepository` / `UserMediaRepository` plus storage calls elsewhere? | Yes |
| Q-5 | Build-time overrun → `failure_reason 'timeout'` (503), not `over_ceiling`? | Yes |
| Q-6 | Orphan rule: remove any export object without a same-user `running`/`ready` row once it is 10 minutes old (stricter than "older than 3 days")? | Yes |
| Q-7 | Size watch by Storage API walk (no migration) rather than a SQL function over `storage.objects`? | Walk |
| Q-8 | Zip route writes the DE-8a events, not `DATA_EXPORTED`; do the new events need `ownerVisibility` / owner-presentation entries, or is owner visibility acceptable? | No `DATA_EXPORTED`; owner sees REQUESTED/READY/DOWNLOADED, hide none |
| Q-9 | The start route marks `owner_downloaded_at` when it hands over the URL (no way to know the browser fetched it)? | Yes (BC-8) |
| Q-10 | `data.json` groups' `controller` = business name when known (DE-4 SA-Q13), widening the type to `string`; `format_version` stays 2? | Yes |
| Q-11 | Flag `NEXT_PUBLIC_BUSINESS_OS_DATA_EXPORT_ENABLED` (one flag for DE-9's client too)? | Yes |
| Q-12 | Cron reap writes `DATA_EXPORT_FAILED` with actor `system`? | Yes |
| Q-13 | Linked document entries are named from `contact_documents.file_name` (Hebrew survives) under `files/client-documents/<contact_id>/`, deviating from the DE-7 SA-Q5 "storage name" proposal; images keep the storage name? | Yes |
| Q-14 | No status/list route in DE-8b; DE-9 adds it with the button? | Yes |
| Q-15 | Request throttle on POST: 10 per 10 minutes per user? | Yes |
| Q-16 | Truncated file inventory (budget hit) fails the export (`error`) rather than delivering "Your files" partly? | Fail |
| Q-17 | Bucket `include.folder` names `client-documents` and `website-images`? | Yes |

## 20. Business calls (TL defaults)

The user authorised an autonomous run. TL applies a default to each and records it as "TL default 2026-10-17 — user may change". Numbers are DE-8b's own.

| # | Question (business terms) | Default |
|---|---|---|
| BC-1 | In the spreadsheet files, text that starts with `= + - @` (phone numbers like `+972…` included) gets a leading apostrophe, so Excel cannot run it as a formula. The machine file (`data.json`) keeps the exact value | **Yes, protect** |
| BC-2 | Instructions file language | **Both** English and Hebrew files, always |
| BC-3 | Client documents in the zip: original file names (Hebrew kept), one folder per client by client id (it matches the spreadsheet), not by client name | **Original names, folder by id** |
| BC-4 | Pictures on the website storage with no picture-library record (logos, older uploads) | **In** ("everything we hold") |
| BC-5 | A file that cannot be read during packaging | **Export still completes**; the instructions file lists how many were missing |
| BC-6 | Starting an export and receiving the link counts as "the owner downloaded it" (affects the admin delete warning in DE-10a) | **Yes** |
| BC-7 | The file is unreachable after 3 days, but physically deleted at the next daily clean-up (up to about one more day) | **Accept**, or run the clean-up every 6 hours at no cost |
| BC-8 | The download shows the business's name in the file name, which is also visible in the download link's address (and so in browser history) | **Accept** (decided in DX-10) |

---

## SA Review Notes

*(SA populates)*

### SA workplan review DE-8b — 2026-10-17

**Reviewed by SA — 2026-10-17**, against this worktree (`origin/main` `d24e3971`) and DE-8a's end state on `origin/feature/data-export-de8a` (`1ccd61f8`: requirement §0.2, §0.4.1 A–H, §0.6–§0.12; `BusinessOsDataExportJobRepository`; audit names and severities; `eventAudience` / `ownerVisibility`), plus TL's PROD read-only results §17.2 and TL defaults §20.1.
**Status:** ✅ **Approved with conditions C-1…C-16.** No halt. The design is the §0.4.1 A single request as approved, the phase split is right (pure modules + one orchestrator + repositories), and the security shape (session id only, `{user_id}/` prefixes only, live-row rule, paths rebuilt from uuids, no URL before upload + ready) is sound. The conditions close gaps, they do not change the approach. Implementation still waits for T-0 (DE-8a merged, 20261074/75 applied, `checker PASS 18/0` recorded).

#### Rulings on §19

| Q | Ruling |
|---|---|
| Q-1 | ✅ **Option A.** The JSON route, its 4 MB cap, `DATA_EXPORTED` and its characterization test stay byte-identical. **C-11 (body cap) moves to DE-9**, the slice that does the replacing; the `ownerClock.ts` extraction is allowed only as a pure move (characterization test is the proof) |
| Q-2 | ✅ **No `file_in_export` column.** `files-index.csv` + `data.json.files` is the link; the live-columns invariant stays. This closes the DE-7 SA-Q5 proposal's open column question |
| Q-3 | ✅ **Bounded records pass as the row check.** It reads at most 100,000 rows and stops before any file download, which meets the purpose of §0.4.1 C ("before any heavy work" = before file downloads and the zip). §0.4.1 C's "count head queries" wording is amended by this ruling for Phase 1 |
| Q-4 | ✅ **One read-only `BusinessDataExportFilesRepository` with F-1…F-6** (granularity exception on the DE-4 SA-Q1 precedent; the storage walk follows `BusinessPurgeRepository.listObjectPathsRecursive`). Not a new pattern under rule 7, with **C-6** (F-6 widened by one importer, see below) |
| Q-5 | ✅ Over the build-time budget → `failure_reason 'timeout'`, 503, does not count against the 3 per day |
| Q-6 | ✅ **10-minute grace orphan rule**, stricter than §0.4.1 A's "older than 3 days" (amended). Every job row exists before its object (the start RPC creates it), so the grace is belt and braces, not correctness. With **C-10** |
| Q-7 | ✅ **Storage API walk**, no migration (amends §0.4.1 C's "one aggregate over `storage.objects`"). With **C-11**: the watch reuses the export's own inventory code, so the watch and the export can never disagree about what counts |
| Q-8 | ✅ The zip route writes **no `DATA_EXPORTED`**. **Owner visibility is acceptable** for every event DE-8b writes: visibility is by `entity_type` (`user` → `owner`), and nothing DE-8b writes is internal. **No `ownerVisibility` change and no owner-presentation entries in DE-8b**; DE-9 may add labels with its UI. **Forward note for DE-10a (binding there):** an admin-started `DATA_EXPORT_REQUESTED` and `DATA_EXPORT_DOWNLOADED_BY_ADMIN` written with `entityType 'user'` against the target account **would be readable by the owner**, which contradicts BQ-SA-2 (no notice to the owner). DE-10a must write those under an `operator` entity type (new type, classified in `AUDIT_ENTITY_OWNER_VISIBILITY` + the RLS policy mirror) or otherwise prove they are hidden |
| Q-9 | ✅ The start route records `owner_downloaded_at` when it hands over the URL (BC-6) |
| Q-10 | ✅ `controller` widened to `string`, business name for the `account_holder` groups when known; `format_version` stays 2; the JSON route passes no name (characterization test) |
| Q-11 | **Superseded by the flag ruling below: no flag.** |
| Q-12 | ✅ Cron reap writes `DATA_EXPORT_FAILED` with `userId` = the row's own `user_id`, `actorId: null`, `details.actor_kind: 'system'` (there is no "system" actor id; do not invent one) |
| Q-13 | ✅ Document entries named from `contact_documents.file_name` under `files/client-documents/<contact_id>/`; images keep the cleaned storage segments. Note: intake `file_name` is **chosen by the public uploader** (`book/manage/[token]/intake/upload` stores `file.name` verbatim), so `clean()` is a security control on hostile input, not cosmetics (C-4) |
| Q-14 | ✅ No status/list route in DE-8b; DE-9 adds it with the button |
| Q-15 | ✅ **Use the existing `rateLimit` rule `create`** (10 per 900 s) for the start route and `read` for the download route. No new rule tuple |
| Q-16 | ✅ A truncated inventory fails the export (`error`); "Your files" is never offered as complete when it is not |
| Q-17 | ✅ `client-documents` and `website-images`, pinned in `exportClassification.test.ts` |

#### Ruling on the env flag (§20.1 note) — **no flag in DE-8b**

`isBusinessOsDataExportEnabled` / `NEXT_PUBLIC_BUSINESS_OS_DATA_EXPORT_ENABLED` is **dropped** (V-9, §5.3, Q-11, the flag-off 404 rows and tests all go; nothing added to `featureFlags.ts` / `feature_flags.md`). §0.4.1 B's "behind the flag (env, default off) until DE-9" is amended by SA: **the owner-facing switch is DE-9's merge**, because DE-8b ships no UI and the four buttons keep calling the JSON route.

Why: a default-off env flag nobody can set is a dead feature that also blocks T-14 on Preview; a default-on flag is a kill switch that, being `NEXT_PUBLIC_`, needs a redeploy to flip, so it buys nothing a revert does not. With no flag, the new routes are live but unlinked. That exposure is acceptable: they act **only on the caller's own data** (the same data the live JSON route already returns, plus the caller's own files), behind `getUser()`, the DB limit (1 at a time, 3 per day) and the request throttle; the cron must run anyway (SA DE-8a Q-6). DE-9 still turns the four buttons over only after its own QA.

#### Conditions (Dev builds to these; SA checks them at code review)

| # | Condition | Priority |
|---|---|---|
| **C-1** | **Failure invariant, precisely.** "Every non-200 exit runs `markFailed` + remove" applies to exits **before `markReady` succeeded**. After `markReady` returns the row, a `sign` failure keeps the job `ready` (step 15) and returns 500 with a code DE-9 can read (`export_ready_sign_failed` or similar); no `markFailed`, no remove. One test per side of that line | High |
| **C-2** | **`markReady` returning an error is not "the stale rule took it".** The update may have applied with only the response lost. On `error`: re-read with `findById(jobId, user.id)`; `ready` → continue as success (or the C-1 500); `running` → `markFailed` + remove; anything else → remove + `timeout`. Only `data === null` with no error means "no longer running". Tested with a fake for each branch | High |
| **C-3** | **Never log or audit the signed URL** (it carries the token and the business name) or `fileName`. The route test's deep scan of logger and audit mock arguments must also assert no `token=` / no `downloadUrl` value appears, in addition to "no business name" | High |
| **C-4** | **`clean()` is tested against hostile `file_name`s as they arrive from the public intake upload**: `../../x.pdf`, `..\\x`, `C:x`, `/etc/passwd`, a name of only dots, U+202E (`invoice‮fdp.exe`), NUL, 500 characters, a lone surrogate. `contact_id` and the image path segments are validated (`contact_id` uuid by Zod, else the row is skipped and counted, never used as a folder). The zipExport test unzips and asserts **every** entry name matches the fixed-prefix allow-list (`README.txt`, `README-he.txt`, `data.json`, `files-index.csv`, `records/<group>/<id>.csv`, `files/<folder>/…`) with no `..` segment, no leading `/`, no `\`, no drive letter | High |
| **C-5** | **S-1b test (TL request).** A fake `website-images` root holding objects and folders that are not the session user's (another uuid, and two non-uuid root folders like PROD's) is never listed, never downloaded and never appears in `files-index`: the repository's `list()` spy only ever receives `${userId}` or `${userId}/…` prefixes. `userId` is Zod-uuid-validated in every files-repository method before any call, so an empty or `/`-bearing prefix is impossible | High |
| **C-6** | **F-6 widened to exactly two importers**: `fileManifest.ts` and nothing else imports the files repository; `exportSweep.ts` gets the size watch by calling `fileManifest`'s own per-owner inventory (C-11). The sole-importer scan pins it | Medium |
| **C-7** | **Download-again is `POST`, not `GET`** (`POST /api/business-os/data-exports/[jobId]/parts/[partNo]/download`, strict empty body), amending §0.3.2 / §0.4.1 A. It has side effects (`owner_downloaded_at`, `DATA_EXPORT_DOWNLOADED`) that feed the DE-10a delete warning, and a cross-site top-level `GET` navigation carries the Lax session cookie, so a link on another site could mark an export "downloaded". `POST` matches DE-10a's admin route. The start route likewise treats a missing body as `{}` and rejects anything else with 400 | Medium |
| **C-8** | **Re-download file name is stamped from the job's `created_at`**, not "now" (DX-10: the day the export started), with the owner timezone and business name read again. The name is read through `BusinessProfileRepository` with an explicit column and `.eq('user_id', user.id)` (no `select('*')`, no new direct call). A failed read gives the fallback name and a `warn`, never a failed download | Medium |
| **C-9** | **Time budget enforced inside the download loop**, not only at steps 8 and 11: no new download starts after the 40 s budget, and the export ends `timeout` with no upload. Step 11 stays as the last check before upload | Medium |
| **C-10** | **Orphan sweep scope:** only objects named exactly `{uuid}/{uuid}/1.zip` are candidates and are removed via `exportObjectPath` from the two folder uuids; any other name or shape is counted (`orphansUnexpected`) and logged at `warn` with counts only, never removed by a guess. An object with no `created_at` is kept and counted. This step also removes objects of jobs `expireOtherReady` turned `expired` when the route's best-effort remove failed (status `expired` is not kept): state that in the code comment, and test it | Medium |
| **C-11** | **Size watch = the export's inventory.** Per owner folder (uuid only; non-uuid root folders skipped and counted), the watch calls the same inventory + live-row filter the export uses, so a document orphan never inflates the watch. The `warn` carries user ids and counts only. Budget hit → `incompleteSteps` + partly-done run record | Medium |
| **C-12** | **Replaced exports are audited.** Step 14 writes `DATA_EXPORT_EXPIRED` (non-blocking, `details.reason: 'replaced'`) for each job `expireOtherReady` returns; its description already says "or replaced by a newer export". Cron step 2 uses `reason: 'retention'` | Low |
| **C-13** | **File name safety pin.** `fileName` must match `^[\p{L}\p{M}\p{N}-]+-data-export-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/u` and `asciiFileName` the same with `[a-z0-9-]`, so nothing user-supplied can inject a quote, `;`, CR or LF into the `Content-Disposition` Storage builds. The RFC 5987 encoder encodes `' ( ) *` too (beyond `encodeURIComponent`) | Low |
| **C-14** | **Deterministic output.** Entries are ordered (section order, then rows by `id`, files by record id then path) so dedupe suffixes ` (2)` are stable between two exports of the same data | Low |
| **C-15** | **No large fixtures in CI.** The T-6 40 MiB memory measurement is a local spike recorded in this workplan, not a committed Jest test; committed zip tests use KB-sized fixtures. Report the Jest delta (T-15); everything stays in the existing Tests job, off the `next build` path | Low |
| **C-16** | **Requirement splice (T-16)** records these amendments in §0.13: no flag (amends §0.4.1 B); row check = bounded pass (§0.4.1 C); Storage walk watch (§0.4.1 C); 10-minute orphan grace (§0.4.1 A); download-again `POST` (§0.3.2 / §0.4.1 A); C-11 body cap moves to DE-9; file name keeps `-HHmm` (DE4-U1 extended to the zip, amends §0.4.1 E's `YYYY-MM-DD`); ASCII fallback `agentpilot-data-export-<stamp>.zip` (amends §0.4.1 E's `data-export-<date>.zip`, for consistency with the no-name fallback); the DE-10a audit-visibility forward note (Q-8) | Low |

#### Checks that passed (no change asked)

- **Routes / `new-api-route`:** `getUser()` identity only; no id from body, header or query (`startForOwner(user.id)`, C-10 of DE-8a); Zod before logic; repositories only; `correlationId`; dev-only `details`; `Cache-Control: no-store`; `maxDuration = 60` (< the 90 s stale rule); `runtime = 'nodejs'`. No response carries the zip, so the 4.5 MB response cap is never in play (SQ-A1).
- **Order of work:** start RPC → pre-flight files (list only) → bounded records → downloads → zip → size and time check → upload (`contentType: 'application/zip'`, `upsert: false`, path only from `exportObjectPath`) → `markReady` → sign 120 s. No URL before upload and ready both succeed. The repository's `markReady` / `markFailed` update only `status = 'running'` rows, so a reaped job cannot be resurrected.
- **Storage tenant isolation:** walk from `${userId}` only; every returned name re-checked; F-2 (only `include` buckets, resolved from `STORAGE_DESCRIPTORS`); live-row rule for documents (the 6 PROD no-row objects are out, C-11 of DE-4); crossed-pointer test; `storage_path` read internally only, `files-index` holds the zip path. BC-4 (33 unlinked `website-images` objects in by folder ownership) is consistent with Q10b.
- **CSV:** BOM, CRLF, RFC 4180 quoting, OWASP neutralising on strings only (numbers untouched, `data.json` exact), header from `exportColumnsOf`, header-only on empty or failed sections (FR-E12). 
- **README:** every owed DE-3…DE-7 note is in §8 (timezones, refund-fee SA-Q6 wording, fees, refunds positive, invoice links, consent, erased people, page addresses incl. the QA wording, pages/smart links/subdomain/amounts, `id` order, deleted documents out); business name as plain text with bidi controls stripped; never in a log, audit detail or object path.
- **R-2 / BC-8 (name in the signed URL's `download`):** **accepted.** §0.4.1 E chose this delivery deliberately and the user accepted it (DX-10, BC-8); the "Never" list in §E covers our object path, our logs and our audit, which stay clean (C-3). The URL lives 120 s. If T-14 shows a bad `Content-Disposition`, the §11 fallback (`download: asciiFileName` + DE-9 fetch-and-blob) also removes most of the name from the URL.
- **Cron:** fail-closed `CRON_SECRET` (the `credit-leak-check` precedent), `withCronRunRecord`, `bosCronJobs` + `vercel.json` pins, `25 5 * * *` free (neighbours 05:17 / 05:41), each step idempotent and bounded, every effect scoped by the row's own `user_id` or the folder's uuids. Reap uses the start function's predicate; the route's 60 s cap leaves 30 s of margin against clock skew.
- **Not applicable:** `business-os-entitlements` (no import; V-11), `bos-llm-call-standards` (no AI call; V-12), admin gate (no admin route in DE-8b). `business-os-schema-check`: `company_name` confirmed live (S-4).
- **Effort:** ~3 d is proportionate. No migration, no dependency.

#### Optimisation suggestions (non-blocking)

- ASCII fallback: NFKD + strip `\p{M}` before dropping non-ASCII, so `Café` gives `cafe`, not `caf`.
- Slug cut: cut on a grapheme boundary (`Intl.Segmenter`) so a Hebrew letter never loses its niqqud at the 60th character.
- One retry per failed file download before marking it `could_not_be_read` (BC-5 stays).
- Cron step 2: when `listDueForExpiry` returns exactly its limit, count it in `incompleteSteps` so a backlog is visible.

#### §20.1 TL defaults

BC-1…BC-8 **confirmed** as recorded; none conflicts with a binding ruling. BC-7 stays daily (the routes refuse after `expires_at`; a 6-hourly run adds nothing the owner can see).

#### Approval

[x] Workplan approved — proceed to implementation after T-0, building to C-1…C-16. Code review checks every condition and the `new-api-route` / `new-repository` final checklists against the diff.

## Implementation record (Dev, 2026-10-17)

### Files

| File | Action | Note |
|---|---|---|
| `app/api/business-os/data-exports/route.ts` | create | POST start + build (§5.1; C-1, C-3, C-7, C-12, Q-15) |
| `app/api/business-os/data-exports/[jobId]/parts/[partNo]/download/route.ts` | create | **POST** download again (C-7, C-8) |
| `app/api/cron/data-export/route.ts` | create | daily sweep, fail-closed `CRON_SECRET`, `withCronRunRecord` |
| `lib/business-os/data-export/zipExport.ts` | create | orchestrator; failure invariant C-1 / C-2; C-9 in the download loop; C-14 order; C-4 allow-list checked before every entry |
| `lib/business-os/data-export/zipExportDeps.ts` | create | production wiring, kept apart so tests inject fakes; DE-10a reuses it |
| `lib/business-os/data-export/fileManifest.ts` | create | inventory, live-row rule, links, entry names; the files repository's one importer (C-6) |
| `lib/business-os/data-export/exportSweep.ts` | create | reap, expire, orphans (C-10), size watch (C-11) |
| `lib/business-os/data-export/{csv,readme,fileName,zipEntries,ceiling}.ts` | create | PURE |
| `lib/business-os/data-export/ownerClock.ts` | create | `ownerTimezone` moved unchanged, plus `ownerClock` (zone and "was set") for the README |
| `lib/business-os/data-export/limits.ts` | modify | Phase 1 zip constants, plus the walk budget, download concurrency and file-row cap |
| `lib/business-os/data-export/payload.ts` | modify | optional `zip` input: `export_format 'ZIP'`, controller = business name, `files`; JSON output unchanged |
| `lib/business-os/data-export/classificationTypes.ts` | modify | comment only |
| `lib/business-os/purge/descriptors.ts` | modify | two buckets `include { folder }` (classification only) |
| `lib/repositories/BusinessDataExportFilesRepository.ts` | create | read-only, F-1 … F-6 |
| `lib/repositories/BusinessOsDataExportStorageRepository.ts` | create | upload / sign / remove / listForSweep |
| `lib/repositories/BusinessOsDataExportJobRepository.ts` | modify | `listStaleRunning` |
| `lib/repositories/BusinessProfileRepository.ts` | modify | `findCompanyName` (one column, C-8) |
| `lib/repositories/types.ts`, `lib/repositories/index.ts` | modify | types; the storage repository is exported, the files repository deliberately not (F-6) |
| `app/api/user/data-export/route.ts` | modify | imports `ownerTimezone` from `ownerClock.ts` only |
| `lib/cron/bosCronJobs.ts`, `vercel.json` | modify | the 18th job |
| tests | create / modify | see below |

### Deviations from the workplan (for SA)

| # | Deviation | Why |
|---|---|---|
| D-1 | No env flag, no flag tests, nothing in `featureFlags.ts` / `feature_flags.md` | SA ruling 2026-10-17 |
| D-2 | Download again is `POST` | SA C-7 |
| D-3 | The DE-5 currency source guard (`exportClassification.test.ts` M-5) bans `.toLowerCase(` in `lib/business-os/data-export/`. It is avoided in `exportSweep.ts` and `fileManifest.ts` (uuids are already lower case), but it is intrinsic in `fileName.ts` (the slug is lower case by §0.4.1 E) and `zipEntries.ts` (case-insensitive dedupe). **A named two-file exemption (`LOWER_CASE_EXEMPT`, `.toLowerCase(` only) was added to the guard, with a negative control.** SA to confirm | A guard change, made visibly, not an evasion |
| D-4 | `runRecord.adoption.test.ts` mocks the export storage repository and `fileManifest` to "nothing to do" | Its Supabase proxy has no storage client; every other job is mocked the same way |
| D-5 | The ASCII fallback folds accents (NFKD): `Café` gives `cafe` (the workplan said `caf`); the slug is cut on a grapheme boundary; one retry per failed download | SA optimisation suggestions |
| D-6 | The throttle key is the existing `rateLimit` shape (route plus hashed caller IP): routes `data-export-start` (`create`) and `data-export-download` (`read`) | Q-15: the existing rule, no new tuple. It is per caller, not per user; the database limit is the per-account rule |
| D-7 | `actorId: null` on the cron's system rows is passed as ruled (Q-12), but `AuditTrailService.buildLogEntry` falls back to `userId` when `actorId` is null, so `actor_id` will read as the owner; `details.actor_kind: 'system'` tells them apart. Changing the service is out of scope | SA item |
| D-8 | `bosCronJobs` `addedOn: '2026-10-18'` is the planned deploy day | RM corrects it if the merge lands later (a date before the deploy brings back a false "Stopped") |
| D-9 | `markReady` records `file_count` = files actually in the zip (not files listed) | The row records what the file holds |
| D-10 | On a rows refusal the job's `row_count` is the rows read before the cut (the total is unknown), with `ceiling_over: ['rows']` in the audit | No made-up number |

### T-6 spike (local, not committed; SA C-15)

Node v22.19.0, fflate 0.8.3, run outside the worktree: 40 files x 1 MiB random (Hebrew names, `level: 0`) plus 2 MB of CSV text (`level: 6`) gave a 40.01 MiB zip in **617 ms**, with **peak RSS 176.5 MiB**, including an `unzipSync` round trip of the whole archive (the route never unzips). The UTF-8 flag (bit 11) on a Hebrew entry and `method 0` (stored) for files are pinned in `zipExport.test.ts` at KB scale.

### Tests

New: `ceiling`, `csv`, `fileName`, `zipEntries`, `readme`, `fileManifest`, `zipExport`, `exportSweep` (all under `lib/business-os/data-export/__tests__/`); `BusinessDataExportFilesRepository`, `BusinessOsDataExportStorageRepository`, `BusinessProfileRepository.findCompanyName` (under `lib/repositories/__tests__/`); `app/api/business-os/data-exports/__tests__/route.test.ts`, `…/[partNo]/download/__tests__/route.test.ts`, `app/api/cron/data-export/__tests__/route.test.ts`. Modified: `exportClassification.test.ts` (the planned flip, folder pins, the moved negative control, D-3), `BusinessOsDataExportJobRepository.test.ts` (`listStaleRunning`, three cross-account comments), `bosCronJobs.test.ts` / `vercelCrons.test.ts` (18 jobs), `runRecord.adoption.test.ts` (D-4). The JSON route's characterization and route suites are unchanged and green.

### SA code review DE-8b — 2026-10-17

**Code Review by SA — 2026-10-17**, against the uncommitted worktree `neuronforge-de8b` (`origin/main` `e5bc1e1f` + changes). I read every new and modified source file. I ran the 25 affected Jest suites myself: **931/931 green**, including the JSON route's characterization and route suites, `exportClassification`, `bosCronJobs`, `vercelCrons` and `runRecord.adoption`. `eslint` on the changed files shows 0 errors (1 warning, the `any` at `types.ts:525`, which dates from 2025-12 and is not in this diff). `tsc --noEmit` shows no error in a touched file. No `console.*` in any touched file. No change to `package.json` or the lockfile, and no migration. Requirement §0.13 is insert-only (`git diff --numstat`: 39 / 0).
**Status:** ✅ **Code Approved for QA.** No High or Medium finding. C-1 … C-16 are all met. The Low items below are non-blocking follow-ups.

#### Conditions C-1 … C-16, checked against the diff

| # | Verdict | Evidence |
|---|---|---|
| C-1 | ✅ | `zipExport.ts` settles every exit before `markReady` succeeds (`settle`, which runs once, then `markFailed` and remove only if `uploaded`). After ready, the route answers 500 `export_ready_sign_failed` with no `markFailed`, no remove and no `markOwnerDownloaded`. Both sides of that line are tested (zipExport invariant suite, route C-1 test) |
| C-2 | ✅ | `markReady` error → `findById(jobId, userId)`: `ready` → success; `running` → markFailed + remove; anything else → remove + `timeout`. If the re-read also fails, `markFailed` is tried and the object is removed only when that took (correct: never delete the file of a job that may be ready). `data === null` with no error → remove + `timeout`. Each branch has its own test |
| C-3 | ✅ | The URL and the file name appear only in the 200 body. The storage repository's `sign` logs only `userId` and `jobId`, and `downloadOwnerObject` logs no key. Both route suites deep-scan every logger and audit argument for the token, `token=`, the URL, both file names, the business name (Hebrew) and the email |
| C-4 | ✅ | `cleanSegment` (lone surrogates, NFC, C0/C1, bidi and BOM stripped, forbidden characters replaced, edges trimmed, 120 units, reserved stems), applied per segment under a fixed ASCII prefix. `contact_id` must be a uuid, otherwise the record is counted, never used as a folder. `isAllowedEntryName` runs before **every** `add()` (it throws, and the build settles as `error`), and the happy-path test unzips and checks every entry |
| C-5 | ✅ | Every files-repository method validates `userId` as a uuid before any call. The walk starts at `${userId}` and re-checks each joined key with `isOwnerObjectKey`. S-1b tests (repository and manifest) prove that another owner and the non-uuid root folders are never listed, downloaded or indexed |
| C-6 | ✅ | `BusinessDataExportFilesRepository` is imported by `fileManifest.ts` only (scan pin, which also asserts it is absent from the barrel). The cron reaches it through `createExportFileSource()` |
| C-7 | ✅ | Download again exports `POST` only (pinned). Both routes treat a missing or blank body as `{}`, and any key, `[]`, `null` or non-JSON is a 400 before any read or RPC |
| C-8 | ✅ | The name is stamped from `job.created_at` in **both** routes, and the clock and the name are read again. `findCompanyName` reads one column with `.eq('user_id', userId)`. A failed read logs a `warn` and gives the fallback name (tested) |
| C-9 | ✅ | `overTime()` is checked before each new download in the worker loop, before `zipSync` and before the upload (tested with a fake clock mid-loop) |
| C-10 | ✅ | `listForSweep` returns only `{uuid}/{uuid}/1.zip` and counts everything else as unexpected, never descending into it. An object is removed only by `remove(folderUser, folderJob)`, i.e. `exportObjectPath`. A missing `created_at` keeps the object. `expired` is not a kept status (the comment says why) |
| C-11 | ✅ | The watch calls the export's own `inventory()` per uuid owner folder, so document orphans are out (tested). The `warn` carries user ids and counts. A budget hit or a truncated listing counts as `incompleteSteps` |
| C-12 | ✅ | `replacedJobIds` → `DATA_EXPORT_EXPIRED` `reason: 'replaced'` (non-blocking). Cron step 2 writes `reason: 'retention'` |
| C-13 | ✅ | `FILE_NAME_PATTERN` / `ASCII_FILE_NAME_PATTERN` exported and pinned. `encodeRfc5987` also encodes `' ( ) *` |
| C-14 | ✅ | Files sorted by record id, then key, before names are claimed. Entries go in a fixed order, and `mtime` is the start instant. The two-build determinism test is green |
| C-15 | ✅ | The T-6 40 MiB measurement is recorded as a local spike. Committed fixtures are KB-sized |
| C-16 | ✅ | §0.13 records every listed amendment and the DE-10a audit-visibility forward note |

#### Security review (routes, storage, zip, cron)

- **Routes / `new-api-route`:** the order is `getUser()` → Zod → throttle → logic. The only account id is `user.id` (`startForOwner(user.id)`, `findById(jobId, user.id)`, so a foreign id is a 404 exactly like a missing one). Errors return dev-only `details`. Both routes set `Cache-Control: no-store` on every answer and attach a `correlationId`. POST has `maxDuration = 60`, `runtime = 'nodejs'`, `force-dynamic`. An expired or non-ready job, a past `expires_at` or a NULL `expires_at` all give 410 with nothing signed. No URL is minted before the upload and `markReady` both succeed: signing is the route's job and happens only on a `ready` outcome.
- **Storage:** both repositories use the service role, with the reason documented. The export bucket is reached only through `exportObjectPath`. `upload` uses `upsert: false` and `contentType` from the policy. `sign` keeps its TTL inside 1–600. The files repository is read-only (scan pin). F-2 resolves the include bucket from `STORAGE_DESCRIPTORS`.
- **Live-row rule:** a document is in the zip only when a live row (`status <> 'deleted'`, `.eq('user_id')`) matches the key, in the same bucket or NULL. One object, one record. A crossed pointer cannot match because the walk never lists another tenant's key.
- **CSV:** BOM, CRLF and RFC 4180 quoting. `= + - @ TAB CR` are neutralised on strings and on JSON text, never on numbers. Columns follow the header.
- **fflate:** `zipSync` with `[data, { level }]`, stored for files and deflate 6 for text. The UTF-8 flag (bit 11) and method 0 are pinned at KB scale.
- **Ceilings:** the files pre-flight (listing only) runs before the records pass and before any download. Real bytes are counted while downloading, the finished size is checked before upload, and the time budget is enforced throughout.
- **Cron:** fail-closed `CRON_SECRET` (copied from the precedent; the bypass applies only when `NODE_ENV === 'development'`, and Preview runs as `production`). The route is wrapped in `withCronRunRecord('data-export')`. Reap → remove + audit runs only when `markFailed` took. Expiry removes the object **first**. Audit entries are written once at the end with `logAndFlush`. `bosCronJobs` + `vercel.json` are registered (`25 5 * * *`, `MAX_60`) and the pins are green.

#### Rulings on the Dev items

| Item | Ruling |
|---|---|
| D-3 `LOWER_CASE_EXEMPT` | ✅ **Accepted.** The guard is still meaningful. The exemption is named, covers two files and one pattern only (`.toLowerCase(`), and neither file touches a currency value: one makes the file-name slug, the other compares entry names case-insensitively. Every other pattern (rates, FX imports, `.toUpperCase(`) still applies to them, and the negative control proves it. Any new exemption must come back to SA |
| D-6 throttle per caller IP | ✅ Accepted. The per-account rule is the database limit (1 at a time, 3 a day), and the throttle is a request-rate backstop |
| D-7 `actorId: null` → `actor_id` = owner | ✅ **Keep as built.** `details.actor_kind: 'system'` tells the rows apart, and changing `AuditTrailService.buildLogEntry` (`input.actorId \|\| input.userId \|\| systemAdminId`) touches every caller. **Follow-up (DE-10a, binding there):** DE-10a's operator rows need a real actor semantics anyway. Resolve "null means system" in the service there, under its own SA review |
| D-8 `addedOn: '2026-10-18'` | ✅ Accepted. **RM:** set it to the real deploy day at merge if that differs |
| D-9 `file_count` = files in the zip | ✅ Accepted (the row describes the file it points at) |
| D-10 rows refusal records rows read | ✅ Accepted (no made-up total; `ceiling_over: ['rows']` names the cause) |
| Item 3 `listOwnerFolders` (cross-account root listing) | ✅ **Allowed.** It returns uuid folder **names** only, reads no object, never descends a non-uuid entry, refuses non-include buckets, and every later effect is per owner through the uuid-validated inventory (tenant-isolation-guard Step 6, commented at the call). See Low L-1 for a pin |
| Item 4 Unicode `download` name, pending T-14 | ✅ Accepted for merge. The routes are unlinked until DE-9, and C-13 makes the name header-safe. **T-14 must be recorded before DE-9 switches the buttons**, and the §11 ASCII fallback applies if Storage's `Content-Disposition` is wrong |
| Item 5 `findCompanyName` | ✅ One column, `.eq('user_id', userId)`, `maybeSingle`, logs `err` + `userId` only, unit-tested. Correct place (`business-os-schema-check`: `company_name` confirmed live, S-4) |
| Item 6 barrel exports | ✅ The storage repository and its types are exported, and the files repository deliberately is not (F-6, scan-pinned). This matches how the job repository is exported |
| Item 7 | No separate item 7 is listed in the implementation record; every deviation (D-1 … D-10) is ruled above |
| D-1, D-2, D-4, D-5 | ✅ As ruled in the workplan review (no flag; POST; adoption-test mocks follow the existing pattern; SA optimisations taken) |

**JSON route:** the only change is the `ownerTimezone` import, moved unchanged to `ownerClock.ts`. The characterization and route suites are green, and `payload.ts` changes are additive behind the optional `zip` input, so DE-1 … DE-7 output is unchanged. **CI time:** 14 new suites in the existing Tests job, off the `next build` critical path (no added critical-path time; `feedback-no-added-ci-time`).

#### Code Review Comments (all Low, non-blocking)

1. `lib/business-os/data-export/fileManifest.ts:116` (L-1): `listOwnerFolders` is on `ExportFileSource`, so the owner route's deps also hold a reference to the cross-account call (it never calls it). Follow-up: a scan pin that `exportSweep.ts` is the only caller, or a separate cron-only port. Priority: Low
2. `lib/business-os/data-export/zipExport.ts:409` (L-2): a throw **after** `markReady` succeeded returns `failed/error`, so the route writes `DATA_EXPORT_FAILED` and answers 500 for a job that is `ready`. Download again still works and the post-ready code is near-pure, so this is cosmetic. Follow-up: return a ready-sign-failed-style outcome when `settled` and `job` is set. Priority: Low
3. `app/api/business-os/data-exports/[jobId]/parts/[partNo]/download/route.ts` (L-3): no explicit `maxDuration`. The default is enough for one read plus one sign; add `maxDuration = 10` for explicitness when next touched. Priority: Low
4. Both routes' `readBody` (L-4): `request.text()` with no length cap before the empty-body check. The platform body cap bounds it. Optional: refuse `content-length > 1 kB` first. Priority: Low
5. `exportSweep.ts:159` (L-5): the reap step ignores the `remove` result. Acceptable, because the orphan sweep removes it after 10 minutes. A count would make it visible. Priority: Low

#### Optimisation suggestions

- The `BusinessDataExportFilesRepository.pageRows` comment says it "ends on a short or empty page", but the code stops only on an empty page (one extra query per call). Either is correct; align the comment, or break on `batch.length < ROW_PAGE` when not near the project max-rows.

#### Code Approved for QA: **Yes**

QA focus: the T-14 Preview check (Hebrew, English and no-business accounts; `Content-Disposition`; Windows and macOS unzip; Excel with a `+972…` phone), the 409, 413 and 410 paths live on Preview, and one cron run on Preview with a planted `{uuid}/{uuid}/1.zip` orphan older than 10 minutes and a non-matching object (removed vs left alone). This review changes no code.

## QA Testing Report

*(QA populates)*

### QA — DE-8b — 2026-10-17

**Test mode:** full
**Strategy used:** A + B (Jest: the new and touched suites, plus a full `npx jest --ci` run against an `origin/main` baseline) and C (a scratch harness that builds a **real** zip end to end and unzips it with four tools). D (browser) is not possible yet because DE-8b has no UI. Instead I reviewed T-14, the Preview check TL runs after deploy (see below). E: not needed.
**Focus:** api, security, schema, performance (ceilings)
**Skipped:** the browser check (no UI until DE-9). Nothing touched PROD.
**Input source:** prompt keywords (TL), plus SA C-1 … C-16 and the SA code review
**Hygiene:** I worked only in scratch copies outside the worktree (`C:/Users/Barak/de8bqa/{base,wt}`, built with `git archive` + `git init`, with `node_modules` junctions removed with `rmdir`). No `git stash`, no commit. `git diff --numstat` and `git status --porcelain` of the worktree were the same before and after. The only worktree edit is this section, which is insert-only.

#### Test Coverage

| Acceptance criterion / condition | Tested? | Result | Notes |
|---|---|---|---|
| New + touched suites (data-export, purge, user/data-export, business-os/data-exports, api/cron, lib/cron, the 4 repository suites, lib/admin/jobs + health) | ✅ | Pass | **66 suites, 2,121 / 2,121**, 56 s (wall 71 s) |
| `npm run test:bos-entitlements` (precaution: the diff imports nothing from entitlements, V-11) | ✅ | Pass | 286 suites, 8,734 / 8,734, 2 m 47 s |
| `npm run test:authz-guard` | ✅ | Pass | 2 suites, 203 / 203, 65 s |
| No CI change; one new cron | ✅ | Pass | `.github/` has no diff. `vercel.json` +4 / −0: only `/api/cron/data-export` `25 5 * * *` |
| Full Jest vs `origin/main` (`e5bc1e1f`) baseline | ✅ | Pass | Base: 1,514 suites, 38,384 tests, 141 failed. Worktree: 1,528 suites (+14 new), 38,650 tests (+266), 140 failed. **Failing-assertion set: worktree ⊂ base, 0 new.** The extra base failure is `tailwind-css-escape.guard` (it uses `git ls-files`, and the archive copy tracks nothing). All 140 are the known local/Windows set (v6 / pilot / orchestration, contact-drawer guards, `publicEndpointsAreThrottled`, `oneAddressPolicy`, `supabaseFetch`, …). `qa-slice5-pr2` timing passed in both runs. Wall time: base 16 m 12 s, worktree 13 m 8 s |
| Jest cost of DE-8b | ✅ | Info | 14 new suites, about 250 tests, about 26.6 s of summed suite time in the existing Tests job (slowest: `BusinessDataExportFilesRepository.test` 7.0 s, `zipExport.test` 4.2 s). Off the `next build` path |
| **Real zip end to end** (§6, §7, §8, §9, C-4, C-5, C-14): see the evidence below | ✅ | Pass | Real `runExportSections` + all 39 section readers + `ownerClock` + `createExportFileSource` + `BusinessDataExportFilesRepository` + `runZipExport` + fflate. Only the Supabase client underneath is faked (an in-memory query engine that honours `eq/neq/gt/in/order/limit/select` plus an in-memory Storage), along with the job repository and the export bucket |
| README.txt + README-he.txt carry every owed note | ✅ | Pass | Both have a BOM and all 14 blocks. EN checked word for word: refunds stored positive / gross not counted twice; `processor_fee`/`net_amount` in `fee_currency`; empty fee ≠ 0; `fee_returned`/`refund_fee` SA-Q6 wording; the three timezone columns (`preferences.timezone` authority, `user_profile.timezone` mirror, `notification_settings.quiet_hours_timezone` quiet hours only); consent current state (latest record, withdrawal wins a tie, unsubscribes / subscriber status, `redacted@invalid`); empty page address = only a query or fragment; Not included (agents, plan/billing/credits, activity, connected apps, synced outside calendar, bank details, deleted items, visitor tracking); the apostrophe rule; the 3-day retention; controller wording with the business name. HE has the same blocks and column names |
| `data.json` | ✅ | Pass | `export_format: "ZIP"`, `format_version: 2`. `groups.account.controller = "AgentPilot"`, and `client_records` / `content` controller = `סטודיו נוגה`. `files[]` has 12 rows. Values are exact (`"+972501234567"`, no apostrophe). No `storage_path`, no other tenant's data |
| `records/<group>/<section>.csv` for every section | ✅ | Pass | **39 / 39** CSVs (account 8, client_records 26, content 5). Every one has a BOM and ends in CRLF, with no bare LF outside quotes. The header comes from the descriptor columns, and empty sections have a header row only |
| CSV injection (BC-1) | ✅ | Pass | `'+972501234567`, `'@evil.example`, `"'=HYPERLINK(""http://x"")"`, `'-2+3` are prefixed. The **number** `-5` is written as `,-5,` with no prefix. jsonb is one JSON cell (`{"capture_page_url":"=x"}`, not prefixed because it starts with `{`) |
| `files-index.csv` | ✅ | Pass | 12 rows: `path_in_export, folder, size_bytes, content_type, record_section, record_id, status`. It holds zip paths only, never a storage key (`<uid>/` is absent). Docs are linked `client_documents,d1…`. Images: 1 linked (`images,m1`), 2 unlinked (logo, generated: Q10b) |
| `files/client-documents/<client uuid>/<original name>` incl. Hebrew | ✅ | Pass | `files/client-documents/3333…/חוזה לקוח.pdf` holds the right bytes (`%PDF-hebrew`). The central directory has bit 11 (UTF-8) set on that entry only, and method 0 (stored) on all 12 files versus 8 (deflate) on the 43 text entries. The key on disk was all underscores (V-3) |
| `files/website-images/…` | ✅ | Pass | `abc.png`, `logo/l.png`, `generated/h.png` |
| Orphans / live-row rule (C-11) | ✅ | Pass | A deleted row's object and an object with no row are both **absent** from the zip (`orphanSkipped` 2). A live row with no object and a crossed pointer (a USER row pointing at OTHER's key) are counted as `missingFiles` 2. OTHER's object was never downloaded (download spy: every key starts with `USER/`) |
| S-1b / tenant scope (C-5) | ✅ | Pass | The storage `list()` spy only ever saw `USER` or `USER/…`. The non-uuid root folders `public/`, `tmp/` and the OTHER owner folder were never listed, downloaded or indexed. No `OTHER-SECRET` / `NON-OWNER-ROOT` byte appears in any entry |
| Hostile names (C-4) | ✅ | Pass | `../../x.pdf` → `-..-x.pdf`; `CON.pdf` → `file.pdf`; `C:\Windows\evil.exe` → `C--Windows-evil.exe`; `invoice‮fdp.exe` → `invoicefdp.exe`; NUL + 300 chars → 120-unit name with `.txt` kept; `/etc/passwd` → `-etc-passwd`; `Report.PDF` + `report.pdf` → `Report.PDF`, `report (2).pdf`. **All 55 entries pass `isAllowedEntryName`**, with no `..` segment, leading `/`, `\` or drive letter |
| Logs carry no names (§0.4.1 E, C-3) | ✅ | Pass | A deep scan of every Pino call in the harness found no business name, Hebrew file name, `evil`, `passwd` or `Report` |
| Deterministic output (C-14) | ✅ | Pass | Two builds with the same data and start time are **byte-identical** (24,842 bytes). A build one hour later differs only in `README.txt`, `README-he.txt` and `data.json`, and those are identical once the timestamps are normalised. Every entry carries one mtime (the start instant) |
| Unzip with other tools | ✅ | Pass | PowerShell `Expand-Archive` gave **55 / 55** files, with the Hebrew name intact and nothing outside the target. Python `zipfile`: `testzip()` = no CRC error, `extractall` gave 55. fflate `unzipSync` gave 55. **Windows' built-in `tar.exe` (bsdtar) skips the Hebrew entry** ("empty or unreadable filename"), and it does the same with a Hebrew zip that Python wrote, so this is the tool's code-page limit, not a DE-8b defect. Explorer and macOS Archive Utility stay with T-14 |
| File name (DX-10, C-8, C-13) | ✅ | Pass | `סטודיו נוגה` + Asia/Jerusalem at 06:30Z → `סטודיו-נוגה-data-export-2026-10-17-0930.zip`, ASCII `agentpilot-data-export-2026-10-17-0930.zip`. `contentDisposition` = `attachment; filename="agentpilot-…-0930.zip"; filename*=UTF-8''%D7%A1%D7%98…-0930.zip`. Empty name or NULL tz → `agentpilot-data-export-2026-10-17-0630.zip` (UTC). `"; filename=evil.exe\r\n` + `Mars/Base` → `filename-evil-exe-data-export-…-0630.zip` (no quote, `;`, CR or LF). `CON` and emoji-only → fallback. `Café Noga 2` (New York) → `café-noga-2-…-0230.zip` / `cafe-noga-2-…-0230.zip`. Midnight in Jerusalem → `-0000` |
| Negative controls (scratch copy; each mutation applied, its suites run, then reverted) | ✅ | Pass, with one gap (Bug 1) | See the table below: **41 controls covering a–k. 39 go red against Dev's suites. h4 goes red only against a QA-written test (Bug 1). c2 stays green, but it is harmless (Edge 3)** |
| Manual Preview check T-14 | ⚠️ | Owed (TL, after deploy) | Plan reviewed: complete in intent, but see the additions under "T-14 review" |

#### Negative controls

Each mutation went into the scratch copy, was run against the named suites, and was then reverted from the worktree file.

| # | Mutation | Suites | Result |
|---|---|---|---|
| a1 | Walk starts at the bucket root (`queue = ['']`) | files repo + fileManifest | 🔴 13 failed |
| a2 | `isOwnerObjectKey` accepts any prefix (another owner's) | same | 🔴 2 failed |
| a3 | No uuid / include-bucket check in `listOwnerObjects` | files repo | 🔴 2 failed (F-2, C-5) |
| b1 | Drop `.neq('status','deleted')` (deleted row counts as live) | same | 🔴 3 failed |
| b2 | Objects without a live row are planned too (orphans in) | fileManifest | 🔴 5 failed |
| c1 | Drop `/ \ : * ? " < > |` replacement | zipEntries + zipExport + fileManifest | 🔴 6 failed |
| c2 | Drop the first edge trim (spaces/dots) | same | 🟢 **not caught**: harmless (a second trim on the stem covers it; see Edge 3) |
| c3 | Drop the reserved-stem rule (CON/NUL…) | same | 🔴 1 failed |
| c4 | `isAllowedEntryName` returns true | same | 🔴 10 failed |
| c5 | Drop the bidi / BOM strip | same | 🔴 2 failed |
| c6 | Drop the control-character (NUL) strip | same | 🔴 2 failed |
| c7 | Drop the lone-surrogate strip | same | 🔴 1 failed |
| c8 | Case-sensitive dedupe | same | 🔴 2 failed |
| c9 | No 120-unit cut | same | 🔴 2 failed |
| d1 | Start route logs the signed URL | start route | 🔴 C-3 scan |
| d2 | Start route logs the file name | start route | 🔴 C-3 scan |
| d3 | Download route audits the signed URL | download route | 🔴 2 failed |
| d4 | Download route audits the file name | download route | 🔴 2 failed |
| d5 | READY audit carries the business name | start route | 🔴 C-3 scan |
| d6 | `zipExport` logs the business name | zipExport + start route | 🔴 1 failed |
| e1 | Download-again also exports `GET` | download route | 🔴 "exports POST only" (the 405 pin) |
| f1 | `findById` scoped by a non-session id | download route | 🔴 2 failed |
| f2 | Foreign / missing job answers 410 instead of 404 | download route | 🔴 1 failed |
| g1 | `markReady` skipped (treated as ready) | zipExport | 🔴 6 failed |
| g2 | Route signs before checking the outcome | start route | 🔴 4 failed (413/503/500 "nothing signed") |
| g3 | Upload skipped | zipExport | 🔴 10 failed |
| h1 | Pre-flight file ceiling removed | zipExport | 🔴 2 failed (count > 150, bytes > 40 MiB: no download, no records) |
| h2 | Finished-zip ceiling removed | zipExport | 🔴 1 failed |
| h3 | C-9 time check in the download loop removed | zipExport | 🔴 1 failed |
| h4 | Real-bytes backstop (download loop) removed | zipExport | 🟢 **not caught by Dev's suite** (Bug 1). 🔴 red against a QA test with an under-reporting listing; the code itself is correct |
| i1 | Cron runs when `CRON_SECRET` is missing | cron route | 🔴 "fail closed" test |
| i2 | Sweep listing accepts names other than `1.zip` | storage repo + exportSweep | 🔴 1 failed |
| i3 | Sweep descends non-uuid owner folders | same | 🔴 1 failed |
| i4 | Sweep keeps an object whose job belongs to another user | exportSweep | 🔴 1 failed |
| i5 | Sweep drops the 10-minute grace | exportSweep | 🔴 1 failed |
| j1 | CSV injection prefix removed | csv + zipExport | 🔴 8 failed |
| j2 | Numbers neutralised too | csv | 🔴 "the NUMBER -5 is not prefixed" |
| j3 | Only `=` `@` neutralised (`+ - TAB CR` dropped) | csv | 🔴 5 failed |
| k1 | JSON route `export_format` always `ZIP` | app/api/user/data-export (characterization + route) | 🔴 44 failed |
| k2 | JSON route gets a business-name controller | same | 🔴 46 failed |
| k3 | JSON route gets a `files` key | same | 🔴 44 failed |

#### Issues Found

##### Bugs (must fix before commit)
1. **The real-bytes backstop has no working test.** File: `lib/business-os/data-export/__tests__/zipExport.test.ts` ("metadata says small, real bytes push past 40 MiB: refused before the zip"). Severity: **Low** (test gap; the code is correct).
   - Steps to reproduce: delete the `realBytes > EXPORT_LIMITS.FILE_BYTES_CEILING` block in `zipExport.ts` and run `zipExport.test.ts`. All 26 tests stay green.
   - Expected: the test fails, because it claims the listing under-reports.
   - Actual: the harness's listing sizes (4 + 3 = 7) are already over the test's ceiling of 5, so the **pre-flight** refuses first and the download-loop backstop is never reached.
   - Fix: `harness({ inventory: { totalBytes: 0 } })`, and assert `files.download` was called. I checked this exact form in scratch: green on the current code, red with the backstop removed.

##### Performance Issues (should fix)
None. The real-zip build of the fixture takes under 1 s. The T-6 spike (40 MiB, 617 ms, 176.5 MiB RSS) is Dev's and was not re-run (C-15: local only).

##### Edge Cases (nice to fix)
1. **README overstates "deleted".** The files block says "N stored file(s) belong to documents that were deleted". The count (`orphanSkipped`) also includes objects that have **no row at all**: in the harness, 1 of the 2 had never had a row. Suggest "belong to documents that were deleted or no longer have a record". `readme.ts`, EN + HE. Low.
2. **Unicode look-alike separators survive `cleanSegment`.** `／` (U+FF0F), `＼` (U+FF3C), `∕` (U+2215), `：` (U+FF1A) and `‥` (U+2025) pass through unchanged and pass the allow-list. They are not separators for any UTF-8-aware unzip tool (Explorer, 7-Zip, PowerShell, macOS, Python all use wide APIs). However, a legacy ANSI-code-page extractor on Windows can "best-fit" `／`/`＼` to `/`/`\` (the 2025 "WorstFit" class). Optional hardening: NFKC-fold or replace these five as well. Zero-width characters (U+200B) are kept too, which is cosmetic. Low.
3. **Test gap c2.** No test covers a name with a trailing space or dot **after** the extension (`"x.pdf "`). The code handles it (`"x.pdf "` → `x.pdf`), but only because of the first trim, and removing that trim stays green. Add one `zipEntries` case. Low.
4. **The 413 sentence names files only.** A **rows** refusal (> 100,000) gets "over 40 MB of files or 150 files". That is the §0.4.1 C wording verbatim, so it is a requirement copy question for DE-9's UI copy, not a Dev defect. Low.
5. `cleanSegment('nul.tar.gz')` → `file.gz` (drops `.tar`). Cosmetic. Low.

#### T-14 review (Dev's Preview plan: TL runs it after deploy)

The plan (§15 T-14 and SA's QA focus) covers the right things: Hebrew, English and no-business accounts; recording `Content-Disposition`; Windows Explorer and macOS Archive Utility with a Hebrew file name; Excel with Hebrew and a `+972…` phone; the 413 refusal with more than 150 planted objects; the 409 / 410 paths; and one cron run with a planted `{uuid}/{uuid}/1.zip` orphan older than 10 minutes next to a non-matching object. **Add these before running it:**

1. ⚠️ **Preview uses the PROD Supabase project** (`jgccgkyhpwirgknnceoh`, per `docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md`). Every T-14 step writes real PROD job rows and real objects in `business-data-exports`. A manual cron call on Preview reaps, expires and sweeps **every PROD account**, so it behaves exactly like the production cron. Use test accounts only, and list what to clean up afterwards: the planted 150+ objects, the planted orphan, and the non-matching object.
2. **How to call it:** there is no UI. Signed in, run `fetch('/api/business-os/data-exports', { method: 'POST' }).then(r => r.json())` in the browser console. For download again, POST to `/api/business-os/data-exports/<jobId>/parts/1/download`. The cron route has no browser path: Vercel does not run crons on Preview, so it needs `Authorization: Bearer <CRON_SECRET>` from curl.
3. **The daily limit runs out mid-test.** Each account has 3 per 24 h, and an `over_ceiling` refusal also counts (only `timeout` does not). Plan the order: the Hebrew account needs about 4 starts (ok, download again, 409 in progress, 4th → 409 daily limit). Use a separate account for the 413.
4. Also check: a GET on download-again → 405; another account's `jobId` → 404; the signed URL fails after 120 s; the row reads `ready` with `owner_downloaded_at` set; the object sits at `{uid}/{job}/1.zip`; a second export marks the first `expired` and removes its object; `410` after `expires_at` (set by SQL on a test row, or wait for the cron).
5. **Excel:** record what the owner sees. Opening a CSV directly shows the protective apostrophe **literally** (`'+972…`), because Excel's CSV open does not treat `'` as a hidden text prefix. That is the accepted BC-1 trade-off and the README explains it, but put it in the record.
6. Open `README-he.txt` in Notepad and check that it renders right-to-left without broken mixed Hebrew and column names. Windows' built-in `tar.exe` cannot extract the Hebrew entry (see above), so tell any support person to use Explorer or 7-Zip.

#### Test Outputs / Logs

```text
Targeted:   Test Suites: 66 passed, 66 total | Tests: 2121 passed, 2121 total | Time: 55.879 s
Entitle.:   Test Suites: 286 passed, 286 total | Tests: 8734 passed, 8734 total (2m47s)
Authz:      Test Suites: 2 passed, 2 total | Tests: 203 passed, 203 total (65s)
Full base:  suites 1514 failedSuites 21 tests 38384 failed 141 (16m12s)
Full wt:    suites 1528 failedSuites 20 tests 38650 failed 140 (13m08s) | new failing assertions: 0
Real zip:   55 entries, 24842 bytes; README.txt, README-he.txt, data.json, 39 records CSVs, files-index.csv, 12 files
            nonAscii entries [{"name":"files/client-documents/3333…/חוזה לקוח.pdf","utf8":true,"method":0}]
            methods {"text:8":43,"files:0":12}; distinct mtimes 1
            Expand-Archive 55/55; python testzip None, extractall 55; bsdtar skips the Hebrew entry (also for a Python-made zip)
            outcome: ready, filesIncluded 12, missingFiles 2, ceilingUsePct 8, rows 20, failedSections []
Determinism: same start -> Buffer.compare 0; +1h -> differing = [README.txt, README-he.txt, data.json] only
```

#### Final Status
- [x] All acceptance criteria that can be tested before deploy pass. **No High or Medium bug.** Bug 1 (Low, a test gap: the backstop test never reaches the backstop) should be fixed in this PR, since it is a one-line harness change.
- [ ] T-14 (Preview, manual) is owed by TL after deploy, with the additions above, before DE-9 switches the buttons over.
- **Ready for commit** once Bug 1 is fixed, or once TL accepts it as a follow-up.

## Commit Info

*(RM populates)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Workplan created | Dev, against DE-8a's end state (worktree `neuronforge-de8a`); awaiting SA workplan review |
| 2026-10-17 | Code complete | Dev: built to SA C-1 … C-16, no env flag; implementation record, deviations D-1 … D-10 and the T-6 spike recorded; awaiting SA code review |
| 2026-10-17 | QA report | QA: targeted 2,121/2,121; full Jest 0 new failures vs `origin/main`; real zip end to end (55 entries, unzipped by 3 tools); 41 negative controls, 1 Low test-gap bug (the real-bytes backstop test); T-14 additions |
| 2026-10-17 | SA code review | SA: Code Approved for QA; C-1 … C-16 met; D-3, D-6 … D-10 and items 3 … 6 ruled; L-1 … L-5 Low follow-ups, non-blocking |

### 17.2 TL results — 2026-10-17 (read-only, Supabase MCP, prod `jgccgkyhpwirgknnceoh`)
| Query | Result | Effect on the plan |
|---|---|---|
| S-1 | top owner folders: website-images 08456106… 15 files / 8.5 MB (max 2.6 MB); website-images 5f63adbd… 5 / 6.3 MB; contact-documents 08456106… 12 / 5.2 MB (max 4.7 MB); website-images 9459b49b… 18 / 3.1 MB; business-data-exports empty | well inside the Phase 1 ceiling |
| S-1b | **website-images: 2 objects whose first folder is not a user id** | must never be exported; the `{user_id}/` prefix list excludes them — add a test that a non-owner folder is never listed |
| S-2 | website-images objects with **no user_media row: upload 25, stock 7, generated 1** | BC-4 default includes them (by folder ownership), linked to user_media where a row exists |
| S-2b | user_media rows without an object 0; rows outside owner folder 0; total 37 | clean |
| S-3 | contact-documents objects: **no row 6 (902 kB)**; row active 9 (5.0 MB); no object for any deleted row | the 6 orphans are excluded by the live-row rule (C-11) |
| S-3b | live rows without object 0; other bucket 0; outside owner folder 0; non-ASCII file names 0; empty names 0 | clean (Hebrew names still must be handled) |
| S-3c | clients with duplicate document names 0 | duplicate handling still tested |
| S-4 | name columns: company_name, company_size, invoice_company_name, invoice_bank_name. company_name set on **6/6** profiles; invoice name 5; only-invoice 0; **non-ASCII company_name 1**; longest 25 | **`company_name` confirmed** as the business name; Hebrew file-name path is live |
| S-5 | ceiling use: 08456106… 22 files / 13.7 MB = **33%**; next 15%, 12% | no account near 60% |
| S-6 | record rows (5 big tables): max 1,063 | far below 100,000 |

### 20.1 Business calls — TL defaults 2026-10-17 (autonomous run; user may change)
All Dev defaults accepted: BC-1 apostrophe prefix in CSV (data.json exact); BC-2 README en + he; BC-3 original document names, one folder per client id; BC-4 website pictures without a library record included; BC-5 an unreadable file doesn't stop the export (README states how many are missing); BC-6 handing over the link counts as "downloaded"; BC-7 physical deletion up to ~1 day after the 3 days (daily cron); BC-8 business name visible in the download link's address accepted.

**For SA:** the plan adds a new env flag `NEXT_PUBLIC_BUSINESS_OS_DATA_EXPORT_ENABLED`. TL cannot set Vercel env vars, so a flag that defaults OFF would leave the zip unreachable after merge. Rule: no flag (no UI calls the new routes until DE-9), or a flag that defaults ON.
