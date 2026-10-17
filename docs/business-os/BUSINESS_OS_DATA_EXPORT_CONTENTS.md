# Business OS Data Export — Contents and Packaging

> **Last Updated**: 2026-10-17

## Overview

This is the reference for **exactly what "Download my data" puts in the zip and how the zip is packaged**, written from the code on `origin/main` (DE-1 … DE-9 merged) plus the admin path of DE-10a (`origin/feature/data-export-de10a`, not yet on `main` when this was written). **The code is the source of truth**; where this page and the code disagree, the code wins and this page is stale. The decisions behind each choice live in [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md) §0.2–§0.15; this page cites them by section and decision id (BC-n, SA-Qn, DX-n) so a later session can find the reasoning.

There is **one builder** for every export: `runZipExport` in `lib/business-os/data-export/zipExport.ts`, wired by `zipExportDeps()` in `zipExportDeps.ts`. The owner route and the admin route both call it, so the zip, its contents, the ceilings and the database limit (1 at a time, 3 a day) are identical whoever starts it. What differs on the admin path (DE-10a):

| Topic | Owner | Admin (DE-10a) |
|---|---|---|
| Who is exported | The session user (`getUser().id`) | The account in the route path (`/api/admin/users/[id]/…`, Zod uuid, lower-cased) after `requireAdmin` and a confirmed identity read (`authAccountRepository.findUserIdentity`) |
| Audit placement | Rows on the owner's account (`userId` = owner) | Every row **admin-owned**: `userId` = `actorId` = the admin, `entityType 'user'`, `entityId` = target, `details.target_user_id`, `surface 'admin'` (`adminExportAudit.ts`, SA-1). The owner never sees them (BQ-SA-2). Cron rows on an admin job: `userId: null`, `actorId: null` (SA-2) |
| Link | Prepare returns a **120 s** signed URL (`OWNER_SIGNED_URL_TTL_SECONDS`) | Prepare returns **no link** (SA-10). Only the audited download route mints one: **60 s** (`ADMIN_SIGNED_URL_TTL_SECONDS`), after a write-ahead `DATA_EXPORT_DOWNLOADED_BY_ADMIN` (`critical`) |
| Replacement | A new owner export expires the owner's older ready exports | **Each kind replaces only its own kind** (SA-4, BC-3): an admin export never replaces the owner's file, nor the reverse. An account can hold two ready files for up to 3 days |
| Own account | — | Refused, 403 `own_account` (BC-6) |
| Daily limit | 3 a day, 1 at a time | Same limit, **shared** with the owner (DX-4) |

---

## Table of Contents

- [1. Where the code lives](#1-where-the-code-lives)
- [2. The zip layout](#2-the-zip-layout)
- [3. The zip file name](#3-the-zip-file-name)
- [4. CSV rules](#4-csv-rules)
- [5. data.json](#5-datajson)
- [6. The README (English and Hebrew)](#6-the-readme-english-and-hebrew)
- [7. Every section](#7-every-section)
- [8. Every table not exported](#8-every-table-not-exported)
- [9. Files, and the size ceilings](#9-files-and-the-size-ceilings)
- [10. Delivery](#10-delivery)
- [11. How to change it](#11-how-to-change-it)
- [Change History](#change-history)

---

## 1. Where the code lives

| File | Owns |
|---|---|
| `lib/business-os/purge/descriptors.ts` | **What is exported.** Every table descriptor's required `export` field: `include` (section, explicit `columns`, `excludedColumns` with reasons, optional `rowFilter` / `rowKey` / `viaParent`) or `exclude` (reason). Buckets: `include { folder }` or `exclude`. Reason constants `EXPORT_REASON` and `EXPORT_COLUMN_REASON` |
| `lib/business-os/data-export/classificationTypes.ts` | `ExportSectionId` (every section id), the classification types, `NON_TABLE_SECTIONS` |
| `lib/business-os/data-export/classification.ts` | Reading the classification: `exportColumnsOf`, `exportDescriptorOfSection`, the secret-column deny list (`SECRET_COLUMN_DENY_EXACT`, `SECRET_COLUMN_DENY_PATTERNS`, `DENY_EXCEPTIONS`), the CI rule functions, `exportColumnDrift` / `exportColumnsMissing` |
| `lib/business-os/data-export/sections.ts` | The section registry `EXPORT_SECTIONS` (order, group, GDPR role), the row mappers and allow-lists, `runExportSections` (row ceiling) |
| `lib/repositories/BusinessDataExportRepository.ts` | The one read path for table sections (`listOwnedRowsForExport`): first filter `.eq('user_id', userId)`, keyset paging on `id` ascending (`PAGE_SIZE` 1,000, ends on an empty page), the `rowKey` single-row read and the `viaParent` read |
| `lib/business-os/data-export/payload.ts` | `data.json` shape (`buildExportPayload`), `EXPORT_GROUPS`, `FILE_INDEX_COLUMNS` |
| `lib/business-os/data-export/zipExport.ts` | The builder: order of work, entry order, store vs deflate, the failure invariant |
| `lib/business-os/data-export/zipEntries.ts` | Safe entry names (`cleanSegment`, `joinEntry`, `EntryNamer`, `isAllowedEntryName`) |
| `lib/business-os/data-export/fileManifest.ts` | "Your files": which stored files go in, under which names (`createExportFileSource`) |
| `lib/business-os/data-export/csv.ts` | CSV encoding |
| `lib/business-os/data-export/readme.ts` | README text, en + he; `cleanBusinessName`; `isoWithOffset` |
| `lib/business-os/data-export/fileName.ts` | The zip's file name |
| `lib/business-os/data-export/downloadName.ts` | DE-10a: the one name rule for both download routes (a pure move of the owner route's local helper) |
| `lib/business-os/data-export/ownerClock.ts` | The owner's timezone (`user_preferences.timezone`, NULL / invalid → UTC) |
| `lib/business-os/data-export/limits.ts` · `ceiling.ts` | Phase 1 ceilings (`EXPORT_LIMITS`) and how much of them an export uses |
| `lib/business-os/data-export/jobPolicy.ts` | Job rules mirrored from the database (`EXPORT_JOB_POLICY`), the object path builder `exportObjectPath` |
| `lib/business-os/data-export/exportSweep.ts` | The daily sweep |
| `lib/business-os/data-export/adminExportAudit.ts` | DE-10a: the only builder of admin-path audit rows |
| `app/api/business-os/data-exports/route.ts` | Owner: `POST` start, `GET` "Last export" |
| `app/api/business-os/data-exports/[jobId]/parts/[partNo]/download/route.ts` | Owner: `POST` download again |
| `app/api/admin/users/[id]/data-exports/route.ts` · `…/[jobId]/parts/[partNo]/download/route.ts` | DE-10a admin: status, prepare, audited download |
| `app/api/cron/data-export/route.ts` | Daily sweep, `25 5 * * *` (`vercel.json`) |

---

## 2. The zip layout

### 2.1 Entries, in the order they are written

The order is fixed (SA C-14) and pinned in `zipExport.test.ts`:

| # | Entry | Content | Compression |
|---|---|---|---|
| 1 | `README.txt` | UTF-8 with BOM, CRLF, English (§6) | deflate, level 6 |
| 2 | `README-he.txt` | UTF-8 with BOM, CRLF, Hebrew (§6) | deflate, level 6 |
| 3 | `data.json` | `JSON.stringify(payload, null, 2)`, no BOM (§5) | deflate, level 6 |
| 4 … 42 | `records/<group>/<section_id>.csv` | One CSV per section, in registry order (§7). A **failed** section still gets its CSV, header row only (FR-E12) | deflate, level 6 |
| 43 | `files-index.csv` | One row per file in "Your files" (§9.3) | deflate, level 6 |
| 44 … | `files/client-documents/<contact_id>/<original file name>` | The documents, in inventory order | **store** (level 0) |
| … | `files/website-images/<cleaned path below the owner folder>` | The website pictures, in inventory order | **store** (level 0) |

`<group>` is `account`, `client_records` or `content`. A file that could not be read has a `files-index.csv` row with status `could_not_be_read` but no entry. The zip is built in memory with `fflate` `zipSync(entries, { mtime: <export start> })`, so every entry carries the export's start time.

### 2.2 How names are kept safe

Entry names are a **security control** (SA C-4): `contact_documents.file_name` is whatever the public intake uploader's browser sent.

| Step | Rule (`zipEntries.ts`) |
|---|---|
| `cleanSegment` 1 | Lone surrogates dropped; Unicode NFC |
| `cleanSegment` 2 | C0 / C1 control characters, bidi controls (U+061C, U+200E/F, U+202A–E, U+2066–9) and U+FEFF stripped |
| `cleanSegment` 3 | `/ \ : * ? " < > \|` replaced with `-` |
| `cleanSegment` 4 | Spaces and dots trimmed at both ends |
| `cleanSegment` 5 | At most `SEGMENT_MAX_UNITS` = 120 UTF-16 units, cut on a code-point boundary, keeping the extension (an extension is 2–16 units after the last dot) |
| `cleanSegment` 6 | Empty, or a Windows reserved stem (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`, any case, before the first dot) → `file` + extension |
| `joinEntry` | Cleaned segments joined under a fixed ASCII prefix (`files/<folder>`) |
| Duplicates | `EntryNamer.claim`: a clash inside one folder, compared **case-insensitively**, gets ` (2)`, ` (3)` … before the extension |
| Determinism | Files are sorted by record id, then storage key, **before** names are claimed, so the ` (n)` suffixes are stable between two exports of the same data |
| Last check | `isAllowedEntryName` runs on every entry before it is added; a duplicate entry name throws. Allowed: the four fixed top-level names, `records/(account\|client_records\|content)/[a-z_]+.csv`, or `files/<folder>/…` (at least 3 segments) with no `.` / `..` segment, no leading `/`, no `\`, no drive letter, no control character |
| No usable original name | A document with an empty `file_name` uses the last segment of its storage key |
| Client folder | `<contact_id>` is used as a folder only when it is a lower-case canonical uuid; otherwise the record counts as "without a file" |

---

## 3. The zip file name

Built by `exportZipFileNames(now, timezone, businessName)` in `lib/business-os/data-export/fileName.ts`. On `main` the start route calls it directly and download-again calls it inline; DE-10a moves the download-again call into `exportDownloadNames()` (`downloadName.ts`), shared with the admin download.

| Rule | As built |
|---|---|
| Pattern | `<business-slug>-data-export-YYYY-MM-DD-HHmm.zip`; with no usable name `agentpilot-data-export-YYYY-MM-DD-HHmm.zip` (`FALLBACK_SLUG = 'agentpilot'`) |
| Stamp | `exportStamp()`: the job's **`created_at`** (the moment the export started, SA C-8), on the owner's clock: `user_preferences.timezone` via `ownerClock.ts`; NULL, blank, invalid or unreadable → UTC. Midnight is `00`, never `24`. So the start route and every "download again" give the same name (DE4-U1, SA C-16) |
| Business name | `business_profiles.company_name` (from the `business_profile` section at build; read again with `businessProfileRepository.findCompanyName` on download again), cleaned by `cleanBusinessName` (NFC, control characters → space, bidi controls removed, whitespace collapsed, at most 200 code points) |
| Slug (`businessSlug`) | NFC; only letters, marks and digits of any script survive (`\p{L}\p{M}\p{N}`); every other run (spaces, punctuation, bidi controls, `/ \ : * ? " < > \|`, emoji) becomes one `-`; leading combining marks dropped; trimmed of `-` and `.`; lower case; at most `SLUG_MAX_CODE_POINTS` = 60 code points, cut on a grapheme boundary (Hebrew niqqud is never split), never inside a surrogate pair. Empty or a Windows reserved name → fallback |
| ASCII name (`asciiSlug`) | NFKD, marks stripped (`Café` → `cafe`), then only `[a-z0-9]` runs kept, at most 60; empty (for example a Hebrew-only name) → `agentpilot-data-export-…zip` |
| Hebrew / Unicode | The Unicode `fileName` is passed as the signed URL's `download` option (`BusinessOsDataExportStorageRepository.sign`), so Storage sends `Content-Disposition`. The reference header is `contentDisposition()`: `attachment; filename="<asciiFileName>"; filename*=UTF-8''<RFC 5987 encoding of fileName>`; `encodeRfc5987` = `encodeURIComponent` plus `' ( ) *`. Both names are also in the 200 JSON body (`fileName`, `asciiFileName`) |
| Guarantees | `fileName` always matches `FILE_NAME_PATTERN`, `asciiFileName` `ASCII_FILE_NAME_PATTERN`, so no quote, `;`, CR or LF can reach the header (SA C-13) |
| Never | The file name and the business name are never logged, audited or put in the object path (`{user_id}/{job_id}/1.zip`). The business name is visible in the signed URL's query (DE-8b BC-8, accepted) |

---

## 4. CSV rules

`toCsv(columns, rows)` in `lib/business-os/data-export/csv.ts`. The header is the section's columns: `sectionColumns(id)` in `zipExport.ts` = `exportColumnsOf(exportDescriptorOfSection(id).table)`, or `id, email, created_at` for `account_identity`. So an empty or failed section still has its header.

| Rule | As built |
|---|---|
| Encoding | UTF-8 with a BOM (`U+FEFF`), so Excel opens Hebrew correctly |
| Line ends | CRLF (RFC 4180), after the last row too |
| Quoting | A cell is quoted when it holds `,` `"` CR or LF, or begins or ends with a space; `"` is doubled. Header cells follow the same rule |
| NULL / undefined | Empty cell |
| Numbers | `String(n)`, **never** neutralised (so `-5` stays a number); a non-finite number is an empty cell; `bigint` → its decimal text |
| Booleans | `true` / `false` |
| jsonb objects and arrays | `JSON.stringify` text in **one** cell (starts with `{` or `[`, so never neutralised); an unserialisable value is empty |
| Formula injection (DE-8b BC-1, OWASP) | A **string** cell whose first character is `=` `+` `-` `@` TAB or CR gets a leading apostrophe `'` (`FORMULA_START = /^[=+\-@\t\r]/`). Applied after JSON conversion and before quoting. `data.json` keeps the exact value; the README says so |
| Columns | Exactly the header's, in its order; a row key outside the header is never written |
| Row order | `id` ascending (the keyset reader; `website_blocks` re-sorted by `id` in code-unit order) — not date order (DE-4 SA-Q8) |

---

## 5. data.json

`buildExportPayload()` in `lib/business-os/data-export/payload.ts`, called by the builder with `zip: { accountHolderName, files }`.

**File:** `data.json` (shape)

```json
{
  "export_metadata": {
    "format_version": 2,
    "user_id": "<the exported account's id>",
    "export_date": "<export start, ISO 8601 UTC>",
    "export_format": "ZIP",
    "gdpr_article": "Article 15 (Right to Access) & Article 20 (Data Portability)",
    "provider": "AgentPilot",
    "groups": {
      "account":        { "gdpr_role": "controller", "controller": "AgentPilot", "description": "…" },
      "client_records": { "gdpr_role": "processor",  "controller": "<business name or account_holder>", "description": "…" },
      "content":        { "gdpr_role": "processor",  "controller": "<business name or account_holder>", "description": "…" }
    }
  },
  "sections": [
    { "id": "account_identity", "group": "account", "gdpr_role": "controller", "status": "ok", "row_count": 1, "rows": [ … ] },
    { "id": "…", "group": "…", "gdpr_role": "…", "status": "failed", "row_count": 0, "rows": [] }
  ],
  "files": [
    { "path_in_export": "files/…", "folder": "client-documents", "size_bytes": 0, "content_type": "…",
      "record_section": "client_documents | images | ''", "record_id": "…", "status": "included | could_not_be_read" }
  ],
  "summary": {
    "section_counts": { "<section id>": 0 },
    "failed_sections": [ "<section id>" ],
    "export_size_kb": 0,
    "export_duration_ms": 0
  }
}
```

| Key | Rule |
|---|---|
| `format_version` | `2` (the break from the 2025 shape). Every slice since was additive, so it stayed 2 |
| `groups.*.controller` | `account`: `AgentPilot`. `client_records` and `content`: the cleaned business name, or the literal `account_holder` when there is none (`groupsWithController`, DE-4 SA-Q13) |
| `groups.*.description` | `account`: "Your own account details. AgentPilot is the controller of this data." `client_records`: "Records you keep about your clients. You, the account holder, are the controller of these records. AgentPilot keeps them on your behalf, as its processor." `content`: "Your website, landing pages, smart links and picture library. You, the account holder, are the controller of this content. AgentPilot hosts it on your behalf, as its processor." |
| `sections` | Registry order. Rows hold the **exact** values (after the row mappers of §7), unlike the CSVs, which neutralise formula-looking strings |
| `status: 'failed'` | A section whose read failed or threw (FR-E12). No error text anywhere in the file or the audit; the reason is only in the server log |
| `files` | The same rows as `files-index.csv`, never a storage key |
| `summary` | Exactly these four keys; **no totals of any kind** (DE-5 BC-11). `export_size_kb` is measured on the payload before `summary` is added |

---

## 6. The README (English and Hebrew)

`buildReadme(lang, facts)` in `lib/business-os/data-export/readme.ts`. Both languages are always written (DE-8b BC-2). Format: for each block, `== <heading> ==`, a blank line, one `- <line>` per line, a blank line; CRLF; the builder prefixes the BOM. All copy is in one typed table per language (`EN`, `HE`), so a missing Hebrew string fails `tsc`, and `readme.test.ts` checks every block id is present and non-empty in both. The Hebrew file has the same blocks, in the same order, with the same facts and counts, translated; the Hebrew headings are listed below.

| # | Block id | English heading | Hebrew heading | English lines (the Hebrew file says the same) |
|---|---|---|---|---|
| 1 | `title` | Your data export | ייצוא הנתונים שלך | "Prepared by AgentPilot (the provider) at your request." · "Started at: <UTC ISO> (UTC); on your clock: <ISO with offset> (<zone>)." · Either "Times inside the files are in UTC unless a column says otherwise." or, when no timezone is set, "No timezone is set on your account, so your clock above is UTC. …" |
| 2 | `contents` | What is inside this zip | מה יש בקובץ ה-zip הזה | One line each for `README.txt / README-he.txt`, `data.json` (exact values, for importing), `records/account, records/client_records, records/content` (one CSV per part), `files-index.csv`, `files/client-documents/<client id>/` (original names), `files/website-images/` |
| 3 | `controller` | Who is responsible for this data | מי אחראי על הנתונים האלה | Your account: AgentPilot is the controller; contact AgentPilot support. Your client records and Your content: `<business name>` (or "the account holder") is the controller; AgentPilot keeps them on its behalf as processor; a client's own data request is for `<business name>` to answer (§0.4.1 E) |
| 4 | `sections` | The spreadsheets (one per part of your data) | הגיליונות (גיליון לכל חלק מהנתונים שלך) | One line per section: `records/<group>/<id>.csv: <section name> (<group name>): <n> rows, complete` — or `COULD NOT BE READ (this spreadsheet holds only its header row; try the export again)`. Section names: `SECTION_NAMES_EN` / `SECTION_NAMES_HE`; group names "Your account" / "Your client records" / "Your content" |
| 5 | `files` | Your files | הקבצים שלך | Counts: files in the zip (and how `record_section` / `record_id` link to `client_documents.csv` / `images.csv`); pictures with no picture-library record (logos, older uploads; included, empty link); document records with no file in the zip; files that could not be read (listed as `could_not_be_read`); stored files of **deleted** documents (not included) |
| 6 | `not_included` | Not included in this export | מה לא נכלל בייצוא הזה | Agents and agent settings · Your plan, billing, credits and payments to AgentPilot · Activity history (assistant chats, briefings, insights, emails sent, reminders sent) · Connected apps and their access keys · The synced copy of an outside calendar · Bank details on your invoice settings · Deleted items · Visitor tracking (page views, link clicks, IP evidence) |
| 7 | `how_to_read` | How to read the files | איך לקרוא את הקבצים | Rows are in id order, not date order · "As of the start time, best effort" (SQ-A5) · Cells beginning with `= + - @` start with an apostrophe; `data.json` keeps the exact value · Structured values are JSON text in one cell |
| 8 | `timezones` | Timezones | אזורי זמן | `preferences.timezone` is the authority; `user_profile.timezone` is a mirror; `notification_settings.quiet_hours_timezone` is the quiet hours' zone only (DE-3 SA-Q8) |
| 9 | `money` | Money | כסף | Amounts as stored next to their own currency; nothing converted, no totals (use the ledger export) · `processor_fee` / `net_amount` are in `fee_currency`; an empty fee means "not recorded" · Refund rows are positive; `payments.amount` is gross, do not count refunds twice · `fee_returned` / `refund_fee` have no recorded currency (DE-5 SA-Q6 wording) · The invoice links open the invoice for anyone holding them (DE-5 BC-3) · `website_content.payment_button` keeps its own amount and currency |
| 10 | `consent` | Consent and email preferences | הסכמות והעדפות אימייל | Current answer = latest consent record, a withdrawal wins a tie · For email, `email_unsubscribes` and `newsletter_subscribers.status` answer directly · Only the current privacy notice text is kept (`consent_settings`); each record keeps the exact sentence and notice link · `redacted@invalid` with `redacted_at` = a decision that was erased (DE-6 BC-6, BC-8) |
| 11 | `page_addresses` | Page addresses | כתובות דפים | Page addresses in consent records, newsletter sign-ups and client sources are shown without their query string or `#` part (DE-6 SA-Q7, F-DE6-1) |
| 12 | `website` | Your website | האתר שלך | Rebuild a page from `website_blocks` (base) + `website_content` (edits) · `business_profile.subdomain` is the authority, `website_pages.subdomain` a copy · Smart-link totals are not in the file; payments are in `payments` |
| 13 | `retention` | How long this download is kept, and its limits | כמה זמן ההורדה נשמרת, והמגבלות שלה | The link works for 3 days, then the file is deleted; one at a time, up to 3 a day · The on-screen download packages up to 40 MB of files, 150 files and 100,000 records |
| 14 | `questions` | Questions | שאלות | "For questions about this export, contact AgentPilot support." |

The business name enters the README only through `cleanBusinessName` (no control or bidi characters, so a crafted name cannot reorder the text).

---

## 7. Every section

39 sections: 8 `account`, 26 `client_records`, 5 `content`. 38 come from one `include` descriptor each; `account_identity` comes from the session. Registry order is `EXPORT_SECTIONS` in `sections.ts`, which is also the CSV order, the `data.json` order and the README order.

**Rules common to every table section** (unless the table says otherwise):

- Read through `BusinessDataExportRepository.listOwnedRowsForExport(sectionId, userId, { maxRows })` (except `user_profile`), service role, first filter `.eq('user_id', userId)`, columns only from `exportColumnsOf()`, keyset paged on `id` (DE-4 SA-Q1, E-1…E-6).
- `user_id` is never a column: it is always the exported account and is in `export_metadata.user_id` (`EXPORT_COLUMN_REASON.OWNER_ID`).
- No status filter: archived, cancelled, inactive, draft and failed rows are all in ("everything we hold", DX-8). The only row filter is the soft delete of `contact_documents`.
- Ids and foreign-key ids are in: they are how rows point at each other inside the file.
- jsonb goes out whole unless a row mapper is named.
- The deny list (§11.3) is re-checked at request time; a denied column fails its section closed.

### 7.1 Group `account` (AgentPilot is the controller)

#### 1. `account_identity` — `records/account/account_identity.csv`

| Field | Value |
|---|---|
| Source | the signed-in session (`getUser()`), not a table (`NON_TABLE_SECTIONS`) |
| Columns included (3) | `id`, `email`, `created_at` (hard-coded in `sectionColumns()` in `zipExport.ts`) |
| Columns excluded | — |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-1 (§0.5); SA-Q8 (§0.6): the only non-table section. Cannot fail once past the 401 |

#### 2. `user_profile` — `records/account/user_profile.csv`

| Field | Value |
|---|---|
| Source table | `profiles` |
| Columns included (15) | `id`, `full_name`, `avatar_url`, `company`, `job_title`, `timezone`, `language`, `created_at`, `updated_at`, `role`, `domain`, `onboarding`, `onboarding_goal`, `onboarding_mode`, `onboarding_data` |
| Columns excluded (3) | `plan`: DX-1a / DE-1 SA Q-3: no plan or billing data<br>`org_id`: DE-2 BC-2 (user 2026-10-15): the agent-platform organisation record is not exported; its id alone points at nothing in the file<br>`hourly_rate_usd`: user 2026-10-16: agent-platform setting, Business OS data only |
| Row filter | none |
| Row mapper | none. Read by `UserProfileRepository.findForUserDataExport` (`.eq('id', userId).maybeSingle()`, columns from `exportColumnsOf('profiles')`), not the shared section repository; no row is an `ok` section with 0 rows |
| Decisions | DE-1; DE-2 BC-2 (user 2026-10-15: `org_id` out); DE-3 BC-A (user 2026-10-16: `hourly_rate_usd` out); BC-G (`role` kept) — §0.6, §0.8 |

#### 3. `preferences` — `records/account/preferences.csv`

| Field | Value |
|---|---|
| Source table | `user_preferences` |
| Columns included (16) | `id`, `preferred_language`, `timezone`, `timezone_confirmed_at`, `preferred_currency`, `theme`, `sidebar_collapsed`, `compact_mode`, `show_timestamps`, `enable_sounds`, `keyboard_shortcuts`, `data_retention_days`, `analytics_enabled`, `telemetry_enabled`, `created_at`, `updated_at` |
| Columns excluded (7) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`default_model`: user 2026-10-16: agent-platform setting, Business OS data only<br>`max_tokens`: user 2026-10-16: agent-platform setting, Business OS data only<br>`temperature`: user 2026-10-16: agent-platform setting, Business OS data only<br>`auto_save_conversations`: user 2026-10-16: agent-platform setting, Business OS data only<br>`debug_mode`: user 2026-10-16: agent-platform setting, Business OS data only<br>`beta_features`: user 2026-10-16: agent-platform setting, Business OS data only |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-3 BC-A (user 2026-10-16, agent-platform settings out); R-3; SA-Q8 (timezone is the authority, README note) — §0.8 |

#### 4. `notification_settings` — `records/account/notification_settings.csv`

| Field | Value |
|---|---|
| Source table | `notification_settings` |
| Columns included (20) | `id`, `email_enabled`, `email_frequency`, `email_system_alerts`, `email_security_alerts`, `email_marketing`, `push_enabled`, `push_system_alerts`, `push_mentions`, `desktop_enabled`, `desktop_system_alerts`, `inapp_enabled`, `inapp_sounds`, `inapp_popups`, `quiet_hours_enabled`, `quiet_hours_start`, `quiet_hours_end`, `quiet_hours_timezone`, `created_at`, `updated_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`email_agent_updates`: user 2026-10-16: agent-platform setting, Business OS data only<br>`push_agent_updates`: user 2026-10-16: agent-platform setting, Business OS data only<br>`desktop_agent_updates`: user 2026-10-16: agent-platform setting, Business OS data only |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-3 BC-A / R-3 (user 2026-10-16: the three `*_agent_updates` toggles out) — §0.8 |

#### 5. `business_profile` — `records/account/business_profile.csv`

| Field | Value |
|---|---|
| Source table | `business_profiles` |
| Columns included (68) | `id`, `vertical`, `sub_vertical`, `company_name`, `company_size`, `clients_per_week`, `revenue_tier`, `description`, `services`, `pain_points`, `goals`, `tools`, `payment_mode`, `online_presence_mode`, `primary_crm`, `primary_calendar`, `primary_payment`, `phone`, `email`, `address`, `address_parts`, `address_id`, `invoice_address_id`, `website_url`, `landing_pages`, `logo_url`, `show_logo_on_smart_links`, `theme`, `template_id`, `subdomain`, `user_code`, `scheduling_availability`, `process_steps`, `language`, `currency`, `invoice_company_name`, `invoice_address`, `invoice_tax_id`, `invoice_footer_text`, `invoice_number_prefix`, `invoice_document_type`, `invoice_prices_include_tax`, `invoice_tax_rate`, `invoice_tax_label`, `invoice_payment_terms_days`, `collection_method`, `default_payment_processor`, `payment_retry_enabled`, `payment_retry_intervals`, `payment_max_retries`, `payment_reminder_enabled`, `payment_reminder_days_before`, `payment_overdue_reminder_days`, `payment_reminder_channels`, `daily_briefing_email_enabled`, `lead_alert_email_enabled`, `lead_autosend_enabled`, `chase_invoices_enabled`, `chase_intake_enabled`, `chase_quotes_enabled`, `automations_declined`, `meeting_reminder_enabled`, `meeting_reminder_hours_before`, `meeting_reminder_notify_client`, `meeting_reminder_notify_owner`, `auto_complete_meetings_enabled`, `created_at`, `updated_at` |
| Columns excluded (17) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`website_analysis`: assistant output, not something the owner entered (DX-1d; as DE-4 BC-7): scraped website data and the assistant's analysis of it<br>`extracted_data`: assistant output, not something the owner entered (DX-1d; as DE-4 BC-7): what the assistant extracted from the onboarding bio<br>`onboarding_conversation`: DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported: the onboarding chat<br>`connected_plugins`: connected apps are not exported (user DE4-U2, 2026-10-15)<br>`calendar_sync_enabled`: calendar sync plumbing<br>`calendar_sync_provider`: calendar sync plumbing<br>`calendar_last_synced_at`: calendar sync plumbing<br>`onboarding_completed`: setup progress state the product keeps, not data the owner entered (as DE-2 BC-1; user BC-D, 2026-10-16)<br>`profile_completeness`: setup progress state the product keeps, not data the owner entered (as DE-2 BC-1; user BC-D, 2026-10-16)<br>`setup_checklist_dismissed`: setup progress state the product keeps, not data the owner entered (as DE-2 BC-1; user BC-D, 2026-10-16)<br>`dismissed_setup_steps`: setup progress state the product keeps, not data the owner entered (as DE-2 BC-1; user BC-D, 2026-10-16)<br>`needs_stripe_connect`: setup progress state the product keeps, not data the owner entered (as DE-2 BC-1; user BC-D, 2026-10-16): derived from the onboarding answers<br>`invoice_bank_name`: user 2026-10-16: bank details left out of the file<br>`invoice_bank_account`: user 2026-10-16: bank details left out of the file<br>`invoice_bank_routing`: user 2026-10-16: bank details left out of the file<br>`invoice_payment_instructions`: user 2026-10-16: bank details left out of the file (free-text payment instructions; the product treats them as the same thing as bank details: SA DE-3) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-3 BC-B (user 2026-10-16: bank details out), R-1 (`invoice_tax_id` in), R-2 (`invoice_payment_instructions` out), BC-C…BC-F, SA-Q3 (`subdomain`, `user_code` in), SA-Q4, SA-Q5 (jsonb travels whole) — §0.8. `company_name` also feeds the zip file name and the README controller name |

#### 6. `business_addresses` — `records/account/business_addresses.csv`

| Field | Value |
|---|---|
| Source table | `business_addresses` |
| Columns included (6) | `id`, `label`, `parts`, `is_default`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-3 — §0.8. Read by its own `user_id`, never by following `address_id` |

#### 7. `payment_account` — `records/account/payment_account.csv`

| Field | Value |
|---|---|
| Source table | `stripe_connect_accounts` |
| Columns included (13) | `id`, `stripe_account_id`, `stripe_account_type`, `charges_enabled`, `payouts_enabled`, `details_submitted`, `onboarding_completed`, `country`, `currency`, `business_type`, `stripe_email`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-5 SA-Q1 (group `account`), SA-Q13 (`stripe_email`, `currency` in) — §0.9 |

#### 8. `payment_providers` — `records/account/payment_providers.csv`

| Field | Value |
|---|---|
| Source table | `payment_processors` |
| Columns included (8) | `id`, `processor_type`, `is_active`, `is_default`, `connection_status`, `last_verified_at`, `created_at`, `updated_at` |
| Columns excluded (6) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`credentials`: secrets and credentials are never exported (§3.2)<br>`supports_checkout`: what the payment provider can do: a product fact, not the owner's data<br>`supports_saved_methods`: what the payment provider can do: a product fact, not the owner's data<br>`supports_refunds`: what the payment provider can do: a product fact, not the owner's data<br>`supports_partial_refunds`: what the payment provider can do: a product fact, not the owner's data |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-5 BC-12 (provider name and status in, keys never), SA-Q15 — §0.9 |

### 7.2 Group `client_records` (the account holder is the controller; AgentPilot the processor)

#### 9. `pipeline_stages` — `records/client_records/pipeline_stages.csv`

| Field | Value |
|---|---|
| Source table | `crm_pipeline_stages` |
| Columns included (9) | `id`, `vertical`, `stage_key`, `stage_label`, `position`, `color`, `stage_type`, `is_primary_client_stage`, `created_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-4 SA-Q5: `stage_key` passes the deny list via `DENY_EXCEPTIONS['crm_pipeline_stages.stage_key']` — §0.7 |

#### 10. `clients` — `records/client_records/clients.csv`

| Field | Value |
|---|---|
| Source table | `crm_contacts` |
| Columns included (18) | `id`, `first_name`, `last_name`, `email`, `phone`, `stage`, `stage_entered_at`, `tags`, `custom_fields`, `notes`, `source`, `source_metadata`, `referrer_domain`, `utm_source`, `utm_medium`, `utm_campaign`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | `clientRow`: `source_metadata` → `sourceMetadata()`: only the string values of `SOURCE_METADATA_KEYS` (`capture_page_url`, `referrer_url`, `referrer_domain`, `capture_channel`, `device_type`, `capture_timestamp`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`); `capture_page_url` and `referrer_url` cut at the first `?` or `#` (`withoutQueryOrFragment`). Dropped: `ip_hash`, `user_agent`, `session_id`, `smart_link_id` and every unnamed key |
| Decisions | DE-4 BC-4 (user 2026-10-15, allow-list); F-DE6-1 (TL 2026-10-16, URLs cut) — §0.7, §0.10 |

#### 11. `client_activities` — `records/client_records/client_activities.csv`

| Field | Value |
|---|---|
| Source table | `crm_activities` |
| Columns included (10) | `id`, `contact_id`, `activity_type`, `title`, `description`, `activity_date`, `auto_logged`, `source_capability`, `source_entity_id`, `created_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-4 — §0.7 (every activity type in) |

#### 12. `client_tasks` — `records/client_records/client_tasks.csv`

| Field | Value |
|---|---|
| Source table | `crm_tasks` |
| Columns included (15) | `id`, `contact_id`, `title`, `description`, `priority`, `status`, `due_date`, `reminder_at`, `completed_at`, `created_by`, `source_entity_type`, `source_entity_id`, `tags`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-4 BC-2 (user 2026-10-15: completed and cancelled tasks in) — §0.7 |

#### 13. `client_documents` — `records/client_records/client_documents.csv`

| Field | Value |
|---|---|
| Source table | `contact_documents` |
| Columns included (12) | `id`, `contact_id`, `name`, `document_type`, `file_name`, `file_size`, `mime_type`, `description`, `tags`, `status`, `created_at`, `updated_at` |
| Columns excluded (3) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`storage_path`: where the file sits in our storage; the file itself arrives in 'Your files' (DE-8b), whose manifest comes from STORAGE_DESCRIPTORS<br>`storage_bucket`: where the file sits in our storage; the file itself arrives in 'Your files' (DE-8b), whose manifest comes from STORAGE_DESCRIPTORS |
| Row filter | `status` NOT IN ('deleted'): SQ-E5: soft-deleted documents are not exported (user BC-3, 2026-10-15: archived ones are) |
| Row mapper | none. The files themselves go to `files/client-documents/` (§9) |
| Decisions | DE-4 BC-3 (user 2026-10-15: archived in, deleted out) — §0.7 |

#### 14. `services` — `records/client_records/services.csv`

| Field | Value |
|---|---|
| Source table | `scheduling_services` |
| Columns included (24) | `id`, `service_name`, `description`, `duration_minutes`, `price`, `currency`, `buffer_minutes`, `max_bookings_per_day`, `advance_booking_days`, `min_notice_hours`, `availability`, `is_active`, `status`, `is_scheduled`, `collection`, `sale_mode`, `payment_type`, `installment_count`, `installment_frequency`, `first_payment_due`, `first_payment_days`, `source`, `created_at`, `updated_at` |
| Columns excluded (2) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`ai_suggestions`: assistant output kept to pre-fill the service form, not a setting the owner chose (DX-1d; user BC-7, 2026-10-15) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-4 BC-7 (user 2026-10-15: `ai_suggestions` out) — §0.7 |

#### 15. `bookings` — `records/client_records/bookings.csv`

| Field | Value |
|---|---|
| Source table | `scheduling_bookings` |
| Columns included (27) | `id`, `service_id`, `contact_id`, `parent_booking_id`, `occurrence_number`, `start_time`, `end_time`, `timezone`, `status`, `cancellation_reason`, `cancel_reason`, `cancel_note`, `cancelled_by`, `booking_source`, `notes`, `internal_notes`, `payment_status`, `payment_method`, `payment_amount`, `payment_currency`, `payment_id`, `invoice_id`, `payment_plan_id`, `intake_responses`, `intake_completed_at`, `created_at`, `updated_at` |
| Columns excluded (9) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`reminder_24hr_sent`: DX-1d: a reminder email sent is activity (user BC-6, 2026-10-15)<br>`reminder_2hr_sent`: DX-1d: a reminder email sent is activity (user BC-6, 2026-10-15)<br>`intake_sent_at`: DX-1d: when the intake email was sent is activity (user BC-6, 2026-10-15)<br>`intake_reminded_at`: DX-1d: when the intake email was sent is activity (user BC-6, 2026-10-15)<br>`external_calendar_event_id`: calendar sync plumbing<br>`calendar_sync_provider`: calendar sync plumbing<br>`calendar_synced_at`: calendar sync plumbing<br>`calendar_sync_error`: the calendar provider's error text from our integration |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-4 BC-1 (`internal_notes` in), BC-2 (every status in), BC-6 (reminder / intake-sent markers out) — §0.7. `intake_responses` (the client's answers) is in |

#### 16. `time_off` — `records/client_records/time_off.csv`

| Field | Value |
|---|---|
| Source table | `scheduling_availability_exceptions` |
| Columns included (7) | `id`, `exception_type`, `start_date`, `end_date`, `custom_hours`, `reason`, `created_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-4 — §0.7 |

#### 17. `quotes` — `records/client_records/quotes.csv`

| Field | Value |
|---|---|
| Source table | `proposals` |
| Columns included (32) | `id`, `contact_id`, `service_id`, `booking_id`, `package_booking_id`, `document_id`, `supersedes_id`, `created_invoice_id`, `created_plan_id`, `title`, `description`, `currency`, `total`, `prices_include_tax`, `tax_rate`, `tax_label`, `payment_shape`, `payment_terms_days`, `sessions`, `status`, `valid_until`, `decline_reason`, `decline_note`, `stop_reason`, `stop_note`, `accepted_snapshot`, `sent_at`, `viewed_at`, `decided_at`, `stopped_at`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-5 BC-2 (every status in), BC-7 (sent / viewed dates in) — §0.9 |

#### 18. `invoices` — `records/client_records/invoices.csv`

| Field | Value |
|---|---|
| Source table | `payment_invoices` |
| Columns included (35) | `id`, `contact_id`, `booking_id`, `service_id`, `invoice_number`, `amount`, `currency`, `status`, `line_items`, `due_date`, `payment_terms`, `notes`, `internal_notes`, `sent_at`, `paid_at`, `payment_method`, `payment_received_at`, `payment_notes`, `processor_type`, `processor_checkout_id`, `processor_payment_id`, `processor_customer_id`, `processor_payment_method_id`, `stripe_invoice_id`, `stripe_hosted_invoice_url`, `stripe_invoice_pdf`, `client_name`, `client_email`, `client_address`, `refunded_amount`, `refund_status`, `refunded_at`, `allow_online_payment`, `created_at`, `updated_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`retry_count`: the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12)<br>`last_retry_at`: the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12)<br>`next_retry_at`: the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-5 BC-3 (user 2026-10-16: `stripe_hosted_invoice_url`, `stripe_invoice_pdf` IN, overriding SA-Q5), BC-7 (`internal_notes` in), SA-Q12 (retry counters out) — §0.9 |

#### 19. `payments` — `records/client_records/payments.csv`

| Field | Value |
|---|---|
| Source table | `payment_transactions` |
| Columns included (28) | `id`, `contact_id`, `invoice_id`, `booking_id`, `service_id`, `amount`, `currency`, `status`, `payment_method`, `description`, `metadata`, `failure_reason`, `paid_at`, `refund_status`, `refunded_amount`, `refunded_at`, `refund_reason`, `processor_type`, `processor_refund_id`, `processor_fee`, `net_amount`, `fee_currency`, `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_customer_id`, `stripe_connect_account_id`, `created_at`, `updated_at` |
| Columns excluded (3) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`account_resolution`: which Stripe account our refund path must target; internal routing state (DE-5 SA-Q7)<br>`charge_account_kind`: which Stripe account our refund path must target; internal routing state (DE-5 SA-Q7) |
| Row filter | none |
| Row mapper | `paymentRow`: `metadata` → `paymentMetadata()`: only the string values of `PAYMENT_METADATA_KEYS` = `notes`, `source` |
| Decisions | DE-5 SA-Q3, BC-7 (user 2026-10-16), BC-8…BC-10 (fees, net, Stripe ids in), SA-Q7 (`account_resolution`, `charge_account_kind` out), SA-Q9 — §0.9 |

#### 20. `refunds` — `records/client_records/refunds.csv`

| Field | Value |
|---|---|
| Source table | `payment_refunds` |
| Columns included (20) | `id`, `transaction_id`, `invoice_id`, `amount`, `amount_minor`, `currency`, `status`, `reason`, `reason_note`, `processor_type`, `processor_refund_id`, `stripe_connect_account_id`, `source`, `failure_code`, `failure_message`, `fee_returned`, `refund_fee`, `created_at`, `updated_at`, `succeeded_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`idempotency_key`: our internal dedupe key for the refund request, not the owner's data (and a secret deny-list name)<br>`initiated_by`: the id that started the refund inside our system, which can be an AgentPilot operator; `source` says how it was started (DE-5 SA-Q15)<br>`metadata`: processor plumbing (Stripe object ids already in their own columns, routing bits); no key the owner entered on live rows (DE-5 SA-Q3) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-5 SA-Q3 (`metadata` out whole), SA-Q4 (positive amounts as stored), SA-Q6 (`fee_returned` / `refund_fee` have no currency), SA-Q15 — §0.9 |

#### 21. `payment_plans` — `records/client_records/payment_plans.csv`

| Field | Value |
|---|---|
| Source table | `payment_plans` |
| Columns included (15) | `id`, `service_id`, `name`, `description`, `total_amount`, `currency`, `supported_currencies`, `installment_count`, `installment_amount`, `installment_frequency`, `allowed_processors`, `preferred_processor`, `is_active`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-5 — §0.9 |

#### 22. `client_payment_plans` — `records/client_records/client_payment_plans.csv`

| Field | Value |
|---|---|
| Source table | `payment_plan_subscriptions` |
| Columns included (29) | `id`, `contact_id`, `booking_id`, `service_id`, `payment_plan_id`, `stripe_subscription_id`, `stripe_schedule_id`, `stripe_price_id`, `stripe_customer_id`, `stripe_connect_account_id`, `installment_count`, `installment_amount`, `currency`, `frequency`, `periods_paid`, `status`, `next_charge_at`, `next_charge_amount`, `last_failure_code`, `last_failure_at`, `card_brand`, `card_last4`, `cancel_reason`, `cancel_note`, `cancelled_by`, `created_at`, `updated_at`, `completed_at`, `cancelled_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`card_exp_month`: user 2026-10-16 (DE-5 BC-1): card brand and last 4 digits only; the expiry stays out<br>`card_exp_year`: user 2026-10-16 (DE-5 BC-1): card brand and last 4 digits only; the expiry stays out<br>`metadata`: processor plumbing (Stripe object ids already in their own columns, routing bits); no key the owner entered on live rows (DE-5 SA-Q3) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-5 BC-1 (user 2026-10-16: card brand and last 4 only), SA-Q3 (`metadata` out) — §0.9 |

#### 23. `installments` — `records/client_records/installments.csv`

| Field | Value |
|---|---|
| Source table | `payment_plan_installments` |
| Columns included (26) | `id`, `payment_plan_id`, `subscription_id`, `booking_id`, `contact_id`, `proposal_id`, `invoice_id`, `transaction_id`, `installment_number`, `label`, `trigger`, `amount`, `currency`, `due_date`, `status`, `paid_at`, `payment_method`, `processor_type`, `stripe_invoice_id`, `completed_at`, `cancel_reason`, `cancel_note`, `cancelled_by`, `cancelled_at`, `created_at`, `updated_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`retry_count`: the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12)<br>`last_retry_at`: the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12)<br>`next_retry_at`: the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-5 SA-Q12 (retry counters out) — §0.9 |

#### 24. `client_payment_methods` — `records/client_records/client_payment_methods.csv`

| Field | Value |
|---|---|
| Source table | `saved_payment_methods` |
| Columns included (12) | `id`, `contact_id`, `processor_type`, `processor_customer_id`, `processor_method_id`, `method_type`, `brand`, `last_four`, `is_default`, `is_valid`, `created_at`, `updated_at` |
| Columns excluded (3) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`expiry_month`: user 2026-10-16 (DE-5 BC-1): card brand and last 4 digits only; the expiry stays out<br>`expiry_year`: user 2026-10-16 (DE-5 BC-1): card brand and last 4 digits only; the expiry stays out |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-5 BC-1 (user 2026-10-16: brand and last 4 only) — §0.9 |

#### 25. `intake_settings` — `records/client_records/intake_settings.csv`

| Field | Value |
|---|---|
| Source table | `user_intake_settings` |
| Columns included (5) | `id`, `is_enabled`, `send_after_booking`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-6 — §0.10 |

#### 26. `intake_forms` — `records/client_records/intake_forms.csv`

| Field | Value |
|---|---|
| Source table | `business_intake_forms` |
| Columns included (8) | `id`, `version`, `status`, `questions`, `generated_at`, `published_at`, `created_at`, `updated_at` |
| Columns excluded (2) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`generated_from`: assistant output, not something the owner entered (DX-1d; as DE-4 BC-7): how the assistant built the form (model, inputs) (TL default BC-4, 2026-10-16) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-6 BC-4 (TL default 2026-10-16: every version in, `generated_from` out); SA-Q4 (`questions` whole) — §0.10 |

#### 27. `email_campaigns` — `records/client_records/email_campaigns.csv`

| Field | Value |
|---|---|
| Source table | `email_campaigns` |
| Columns included (11) | `id`, `name`, `subject`, `body_html`, `body_text`, `segment_filter`, `status`, `scheduled_at`, `sent_at`, `created_at`, `updated_at` |
| Columns excluded (6) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`recipients_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`sent_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`opened_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`clicked_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`failed_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-6 BC-3 (TL default 2026-10-16: counters out); SA-Q4 (`segment_filter` whole) — §0.10 |

#### 28. `email_sequences` — `records/client_records/email_sequences.csv`

| Field | Value |
|---|---|
| Source table | `email_sequences` |
| Columns included (8) | `id`, `name`, `description`, `trigger_type`, `trigger_config`, `is_active`, `created_at`, `updated_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`total_sent`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`total_opened`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`total_clicked`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-6 BC-3 (counters out); SA-Q4 (`trigger_config` whole) — §0.10 |

#### 29. `email_sequence_steps` — `records/client_records/email_sequence_steps.csv`

| Field | Value |
|---|---|
| Source table | `email_sequence_steps` |
| Columns included (8) | `id`, `sequence_id`, `step_number`, `delay_minutes`, `subject`, `body_html`, `body_text`, `created_at` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`sent_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`opened_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)<br>`clicked_count`: DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-6 BC-3 (counters out) — §0.10 |

#### 30. `email_sequence_enrollments` — `records/client_records/email_sequence_enrollments.csv`

| Field | Value |
|---|---|
| Source table | `email_sequence_enrollments` |
| Columns included (7) | `id`, `sequence_id`, `contact_id`, `status`, `current_step_number`, `enrolled_at`, `completed_at` |
| Columns excluded (2) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`next_send_at`: when the next email is scheduled to go: sending machinery, not a record (DE-6 SA-Q6) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-6 SA-Q6 (`next_send_at` out, `current_step_number` in) — §0.10 |

#### 31. `newsletter_subscribers` — `records/client_records/newsletter_subscribers.csv`

| Field | Value |
|---|---|
| Source table | `business_subscribers` |
| Columns included (12) | `id`, `email`, `name`, `status`, `source`, `attribution`, `subscribed_at`, `confirmed_at`, `promoted_contact_id`, `promoted_at`, `created_at`, `updated_at` |
| Columns excluded (2) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`email_normalized`: a generated lower-case copy of email, which is in (DE-6 SA-Q8) |
| Row filter | none |
| Row mapper | `subscriberRow`: `attribution` → `sourceMetadata()` (the same `SOURCE_METADATA_KEYS` allow-list and URL cut as `clients`) |
| Decisions | DE-6 BC-5 (TL default: unconfirmed and unsubscribed in), SA-Q4, SA-Q7, SA-Q8 — §0.10 |

#### 32. `consent_records` — `records/client_records/consent_records.csv`

| Field | Value |
|---|---|
| Source table | `marketing_consent_events` |
| Columns included (17) | `id`, `contact_id`, `email`, `channel`, `purpose`, `decision`, `method`, `statement_text`, `statement_locale`, `statement_version`, `privacy_policy_url`, `source_surface`, `source_page_url`, `evidence`, `redacted_at`, `occurred_at`, `created_at` |
| Columns excluded (7) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`email_normalized`: a generated lower-case copy of email, which is in (DE-6 SA-Q8)<br>`ip_hash`: a scrambled internet address with the key to check it, the browser signature and the visit id: visitor tracking, not exported (TL default BC-1, 2026-10-16; as DE-4 BC-4)<br>`ip_hash_salt`: a scrambled internet address with the key to check it, the browser signature and the visit id: visitor tracking, not exported (TL default BC-1, 2026-10-16; as DE-4 BC-4)<br>`user_agent`: a scrambled internet address with the key to check it, the browser signature and the visit id: visitor tracking, not exported (TL default BC-1, 2026-10-16; as DE-4 BC-4)<br>`session_id`: a scrambled internet address with the key to check it, the browser signature and the visit id: visitor tracking, not exported (TL default BC-1, 2026-10-16; as DE-4 BC-4)<br>`recorded_by`: the id that recorded the decision inside our system (the owner on every live row); `method` says how it was recorded (DE-6 SA-Q10; as DE-5 SA-Q15) |
| Row filter | none |
| Row mapper | `consentEventRow`: `source_page_url` → `withoutQueryOrFragment()`; `evidence` → `consentEvidence()`: only the string values of `CONSENT_EVIDENCE_KEYS` = `client_statement`, `confirmed_via`, `note`. `privacy_policy_url` kept as held |
| Decisions | DE-6 BC-1 (TL default 2026-10-16: visitor evidence out), BC-8 (redacted rows in as held), SA-Q4, SA-Q5, SA-Q7, SA-Q8, SA-Q10 — §0.10 |

#### 33. `consent_settings` — `records/client_records/consent_settings.csv`

| Field | Value |
|---|---|
| Source table | `marketing_consent_settings` |
| Columns included (13) | `capture_enabled`, `statement_en`, `statement_es`, `statement_he`, `statement_version`, `privacy_policy_mode`, `privacy_policy_url`, `privacy_policy_body`, `privacy_policy_updated_at`, `postal_address`, `label_as_advertisement`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id; it is also the row key (one row per owner) |
| Row filter | none |
| Read key | `rowKey: 'user_id'`: one row read by `user_id` (`.limit(2)`, two rows fail the section); no `id` column |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-6 BC-7 (TL default: in), SA-Q1 (`rowKey`) — §0.10 |

#### 34. `email_unsubscribes` — `records/client_records/email_unsubscribes.csv`

| Field | Value |
|---|---|
| Source table | `email_unsubscribes` |
| Columns included (5) | `id`, `contact_id`, `email`, `reason`, `unsubscribed_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-6 — §0.10 |

### 7.3 Group `content` (the account holder is the controller; AgentPilot the processor)

#### 35. `website_content` — `records/content/website_content.csv`

| Field | Value |
|---|---|
| Source table | `website_content` |
| Columns included (22) | `id`, `hero`, `about`, `services`, `testimonials`, `faq`, `team`, `contact`, `process`, `features`, `stats`, `pricing`, `gallery`, `cta`, `newsletter`, `logo_cloud`, `video`, `booking_widget`, `payment_button`, `intake_form`, `created_at`, `updated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-7 SA-Q7 (jsonb whole), BC-4 (TL default 2026-10-17: assistant-drafted text in) — §0.11 |

#### 36. `website_pages` — `records/content/website_pages.csv`

| Field | Value |
|---|---|
| Source table | `website_pages` |
| Columns included (22) | `id`, `page_type`, `slug`, `title`, `meta_description`, `seo_keywords`, `published`, `published_at`, `template_id`, `theme`, `created_at`, `updated_at`, `subdomain`, `custom_domain`, `custom_domain_verified`, `status`, `last_published_at`, `favicon_url`, `og_image_url`, `client_flow`, `website_language`, `content_generated_at` |
| Columns excluded (1) | `user_id`: always the exporting account; it is in export_metadata.user_id |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-7 BC-3 (TL default 2026-10-17: draft / unpublished / archived in), BC-6 (public addresses in), SA-Q12 — §0.11. Read twice per export: its section, then the parent ids for `website_blocks` |

#### 37. `website_blocks` — `records/content/website_blocks.csv`

| Field | Value |
|---|---|
| Source table | `website_blocks` (no `user_id`; read through `website_pages` by `page_id`) |
| Columns included (9) | `id`, `page_id`, `block_type`, `position`, `content`, `styles`, `created_at`, `enabled`, `capability_config` |
| Columns excluded (0) | — (the table has no other column) |
| Row filter | none |
| Read path | `viaParent: { parent: 'website_pages', fk: 'page_id' }`: the owner's page ids first (`website_pages` by `user_id`), then the blocks by `.in('page_id', chunk)`, 100 ids per chunk (`EXPORT_LIMITS.VIA_PARENT_CHUNK`); every returned block is checked against its chunk; rows re-sorted by `id` |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-7 SA-Q1 (new pattern, the parent-scoped read), SA-Q2 (two-key opt-in), BC-7 (TL default: hidden blocks in, `enabled` shows it) — §0.11 |

#### 38. `smart_links` — `records/content/smart_links.csv`

| Field | Value |
|---|---|
| Source table | `smart_links` |
| Columns included (13) | `id`, `code`, `name`, `destination_url`, `destination_type`, `source`, `medium`, `campaign`, `content`, `is_active`, `created_at`, `updated_at`, `metadata` |
| Columns excluded (4) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`click_count`: DX-1d: how many visits and sign-ups a link brought is activity (TL default BC-1, 2026-10-17)<br>`conversion_count`: DX-1d: how many visits and sign-ups a link brought is activity (TL default BC-1, 2026-10-17)<br>`revenue_cents`: a running total derived from payments already in the file, with no currency of its own (DX-1d; CLAUDE.md § Currency; TL default BC-1, 2026-10-17) |
| Row filter | none |
| Row mapper | none: every cell goes out as held |
| Decisions | DE-7 BC-1 (TL default 2026-10-17: counters and revenue out), BC-2 (switched-off links in), SA-Q8, SA-Q11 — §0.11 |

#### 39. `images` — `records/content/images.csv`

| Field | Value |
|---|---|
| Source table | `user_media` |
| Columns included (9) | `id`, `public_url`, `source`, `section`, `aspect`, `description`, `width`, `height`, `created_at` |
| Columns excluded (3) | `user_id`: always the exporting account; it is in export_metadata.user_id<br>`storage_path`: where the file sits in our storage; the file itself arrives in 'Your files' (DE-8b), whose manifest comes from STORAGE_DESCRIPTORS<br>`source_ref`: our lookup key that stops the same picture being fetched or paid for twice (a stock library id, or a hash of a picture request); `source` says where the picture came from (DE-7 SA-Q6) |
| Row filter | none |
| Row mapper | none. The picture files go to `files/website-images/` (§9) |
| Decisions | DE-7 BC-5 (TL default 2026-10-17: every `source`, `description` in), SA-Q5 (`storage_path` out, `public_url` in), SA-Q6 (`source_ref` out) — §0.11 |

---

## 8. Every table not exported

156 table descriptors = **38 `include` + 118 `exclude`** (0 `planned`: forbidden on tables since DE-7, `PLANNED_TABLES_ALLOWED = false`). The reasons below are the descriptor's `reason` string, verbatim (built from `EXPORT_REASON` plus a table-specific detail). An excluded table is never read by the export.

### 8.1 Activity (DX-1d) — 29 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `payment_events` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported; payment event log feeding the automation engine; the payments, invoices and refunds it records are exported themselves (user BC-5, 2026-10-16; as business_events, §0.3.1 SQ-E7) |
| `payment_automation_executions` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported; automation run history and its claim / lease columns (user BC-5, 2026-10-16) |
| `payment_reminders` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported; payment reminders scheduled and sent to clients: emails sent are activity (user BC-4, 2026-10-16; as DE-4 BC-6) |
| `email_sends` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `onboarding_conversations` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `onboarding_prompt_ideas` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `command_sessions` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `business_chat_conversation` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `business_chat_action_log` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `business_chat_saved_plans` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `business_chat_verified_questions` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `channel_connections` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported; and it holds account_token |
| `channel_metrics_daily` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `insight_automations` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `insights` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `insight_actions` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `owner_insight_history` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `insight_hypotheses` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `insight_measurements` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `business_events` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `business_health_summaries` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `kernel_executions` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `kernel_action_log` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `lead_responses` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported; queued and sent automatic messages to leads and clients (invitations, chases, reminders) with their claim / lease columns: messages sent are activity (TL default BC-2, 2026-10-16; as payment_reminders, DE-5 BC-4) |
| `daily_briefings` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `daily_briefing_sends` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `audit_trail` | DX-1d: the owner's activity history is not exported; BD-26 hidden types never |
| `archived_records` | DX-1d: the owner's activity history is not exported; BD-26 hidden types never |
| `audit_logs` | DX-1d: the owner's activity history is not exported; BD-26 hidden types never |

### 8.2 Visitor tracking (DX-1d / SQ-E7) — 2 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `website_page_views` | DX-1d / SQ-E7: visitor tracking, not exported |
| `smart_link_clicks` | DX-1d / SQ-E7: visitor tracking, not exported |

### 8.3 Billing and money paid to AgentPilot (DX-1) — 19 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `subscriptions` | DX-1: billing and credits are not exported |
| `user_subscriptions` | DX-1: billing and credits are not exported |
| `subscription_invoices` | DX-1: billing and credits are not exported |
| `billing_events` | DX-1: billing and credits are not exported |
| `credit_transactions` | DX-1: billing and credits are not exported |
| `boost_pack_purchases` | DX-1: billing and credits are not exported |
| `token_usage` | DX-1: billing and credits are not exported; usage and our provider cost |
| `business_os_account_plans` | DX-1: billing and credits are not exported |
| `business_os_entitlement_overrides` | DX-1: billing and credits are not exported |
| `business_os_credit_charges` | DX-1: billing and credits are not exported |
| `business_os_credit_totals` | DX-1: billing and credits are not exported |
| `business_os_credit_lots` | DX-1: billing and credits are not exported |
| `business_os_credit_lot_draws` | DX-1: billing and credits are not exported |
| `business_os_billing_accounts` | DX-1: billing and credits are not exported |
| `business_os_billing_events` | DX-1: billing and credits are not exported |
| `business_os_boost_purchases` | DX-1: billing and credits are not exported |
| `business_os_boost_cap_overrides` | DX-1: billing and credits are not exported |
| `business_os_invites` | DX-1: billing and credits are not exported |
| `user_rewards` | DX-1: billing and credits are not exported |

### 8.4 Agent platform (BQ-SA-1, user 2026-10-14) and its organisation record — 37 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `agent_logs` | not Business OS data (user 2026-10-14) |
| `agent_scheduler_state` | not Business OS data (user 2026-10-14) |
| `agents` | not Business OS data (user 2026-10-14) |
| `agent_executions` | not Business OS data (user 2026-10-14) |
| `agent_memory` | not Business OS data (user 2026-10-14) |
| `agent_memories` | not Business OS data (user 2026-10-14) |
| `run_memories` | not Business OS data (user 2026-10-14) |
| `user_memory` | not Business OS data (user 2026-10-14) |
| `agent_prompt_threads` | not Business OS data (user 2026-10-14) |
| `agent_prompt_workflow_generation_sessions` | not Business OS data (user 2026-10-14) |
| `data_decision_requests` | not Business OS data (user 2026-10-14) |
| `organizations` | PLATFORM: agent-platform organisation record (user 2026-10-15) |
| `organization_members` | PLATFORM: agent-platform organisation record (user 2026-10-15) |
| `advisor_reports` | not Business OS data (user 2026-10-14) |
| `automation_slas` | not Business OS data (user 2026-10-14) |
| `metric_baselines` | not Business OS data (user 2026-10-14) |
| `group_metrics_rollup` | not Business OS data (user 2026-10-14) |
| `calibration_history` | not Business OS data (user 2026-10-14) |
| `error_patterns` | not Business OS data (user 2026-10-14) |
| `execution_anomalies` | not Business OS data (user 2026-10-14) |
| `execution_baselines` | not Business OS data (user 2026-10-14) |
| `plugin_performance` | not Business OS data (user 2026-10-14) |
| `intent_examples` | not Business OS data (user 2026-10-14) |
| `agent_configurations` | not Business OS data (user 2026-10-14) |
| `agent_execution_logs` | not Business OS data (user 2026-10-14) |
| `agent_templates` | not Business OS data (user 2026-10-14) |
| `agentkit_analytics` | not Business OS data (user 2026-10-14) |
| `calibration_sessions` | not Business OS data (user 2026-10-14) |
| `workflow_executions` | not Business OS data (user 2026-10-14) |
| `pilot_step_routing_history` | not Business OS data (user 2026-10-14) |
| `shadow_failure_snapshots` | not Business OS data (user 2026-10-14) |
| `shared_agents` | not Business OS data (user 2026-10-14) |
| `execution_insight_runs` | not Business OS data (user 2026-10-14) |
| `execution_insights` | not Business OS data (user 2026-10-14) |
| `agent_stats` | not Business OS data (user 2026-10-14) |
| `agent_intensity_metrics` | not Business OS data (user 2026-10-14) |
| `shared_agent_imports` | not Business OS data (user 2026-10-14) |

### 8.5 Connected apps and the synced outside calendar (user 2026-10-15) — 2 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `external_calendar_events` | user 2026-10-15: synced copy of the owner's own external calendar, not Business OS data |
| `plugin_connections` | user 2026-10-15: connected apps dropped from the export (business data only); see lawyer note §0.2 DX-1 |

### 8.6 Secrets and credentials (§3.2) — 3 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `auth_handoff_codes` | secrets and credentials are never exported (§3.2); short-lived sign-in codes |
| `security_settings` | secrets and credentials are never exported (§3.2); security configuration, not in the DX-1a set (may hold second-factor material) |
| `api_keys` | secrets and credentials are never exported (§3.2) |

### 8.7 Cache or derived data — 4 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `marketing_consent_state` | cache or derived data, not the owner's data; the current consent per address, rebuilt by trigger from marketing_consent_events, which is exported whole as consent_records; no id column to page on (TL default BC-6, 2026-10-16; DE-6 SA-Q3) |
| `business_chat_plan_cache` | cache or derived data, not the owner's data |
| `derived_metrics` | cache or derived data, not the owner's data |
| `business_os_entitlement_shadow_events` | cache or derived data, not the owner's data; platform counters |

### 8.8 Platform data and module setup — 21 tables

| Table | Recorded `reason` (verbatim) |
|---|---|
| `payment_automation_rules` | platform data, not this account's data; the built-in payment rules the platform seeds; the owner cannot create or edit them (defaultPaymentRules.ts; user BC-6, 2026-10-16) |
| `payment_methods` | platform data, not this account's data; dead table superseded by saved_payment_methods: no app reads or writes it, 0 rows (live 2026-10-16); drop migration pending |
| `user_capabilities` | PLATFORM: module setup, not data the owner entered (user 2026-10-15) |
| `user_capability_blocks` | PLATFORM: module setup, not data the owner entered (user 2026-10-15) |
| `capabilities` | platform data, not this account's data |
| `capability_building_blocks` | platform data, not this account's data |
| `website_templates` | platform data, not this account's data |
| `intake_form_templates` | platform data, not this account's data |
| `storage_usage` | platform data, not this account's data; quota accounting |
| `admin_users` | platform data, not this account's data; platform authorization |
| `archive_runs` | platform data, not this account's data |
| `bos_cron_runs` | platform data, not this account's data |
| `bos_cron_run_recording` | platform data, not this account's data |
| `business_os_account_lineage` | platform data, not this account's data |
| `ais_scoring_weights` | platform data; the account appears only as who changed a row |
| `ais_system_config` | platform data; the account appears only as who changed a row |
| `exchange_rates` | platform data; the account appears only as who changed a row |
| `exchange_rate_history` | platform data; the account appears only as who changed a row |
| `system_settings_config` | platform data; the account appears only as who changed a row |
| `sla_events` | platform data; the account appears only as who changed a row |
| `processed_webhook_events` | platform data, not this account's data; webhook idempotency |

### 8.9 The export itself — 1 table

| Table | Recorded `reason` (verbatim) |
|---|---|
| `business_os_data_exports` | the export itself: a short-lived copy of this account's data |

---

## 9. Files, and the size ceilings

### 9.1 Buckets

`STORAGE_DESCRIPTORS` in `descriptors.ts`; the rule per bucket is `BUCKET_RULES` in `fileManifest.ts` (an `include` bucket with no rule fails the inventory, fail closed).

| Bucket | Export | Zip folder | Rule (what counts as "yours") |
|---|---|---|---|
| `contact-documents` | `include` | `files/client-documents/` | `live_document_rows`: **the rows are the authority**. An object under `${userId}/` is in only when a **live** `contact_documents` row of the owner (`status <> 'deleted'`, read by `listLiveDocumentFiles`, at most `FILE_ROWS_MAX` = 20,000) has `storage_path` equal to its key and `storage_bucket` equal to the bucket or NULL. One object, one record. Entry `files/client-documents/<contact_id>/<cleanSegment(file_name)>` (the original upload name; DE-8b BC-3, SA Q-13) |
| `website-images` | `include` | `files/website-images/` | `listing_with_media_links`: **the listing is the authority** (Q10b, DE-8b BC-4). Every object in the owner's folder is in; a `user_media` row with the same `storage_path` links it (`record_section 'images'`, `record_id`), others have an empty link. Entry `files/website-images/<each segment below the owner folder, cleaned>` |
| `business-purge-snapshots` | `exclude` | — | "an internal copy taken before a purge, not the live data" |
| `business-data-exports` | `exclude` | — | "the export itself: a short-lived copy of this account's data" |

### 9.2 What is left out, and how it is counted

| Case | What happens | Where it is counted |
|---|---|---|
| Object of a **deleted** or missing `contact_documents` row (an orphan: the delete route soft-deletes even if the storage remove failed) | Skipped, never named (DE-4 C-11) | `orphanSkipped` → README "stored file(s) belong to documents that were deleted" |
| Live document row with no object, a non-uuid `contact_id`, or an object already claimed | No file | `recordsWithoutFile` → README; the record is still in `client_documents.csv` |
| Picture with no `user_media` row | **Included**, empty link | `filesWithoutRecord` → README |
| File that cannot be downloaded (one retry) | Export continues (DE-8b BC-5); `files-index.csv` row with `could_not_be_read`, no entry | `couldNotBeRead` → README; `missing_files` in the audit = could-not-be-read + records-without-file |
| Objects outside `${userId}/` (another account, non-owner root folders) | Never listed: the walk starts at the owner's prefix and re-checks every name; a row pointing elsewhere can never match | `rejectedPaths` (should be 0) |
| Listing budget exhausted (`FILE_WALK_MAX_MS` 15 s / `FILE_WALK_MAX_CALLS` 300, shared by both buckets) | The **export fails** (`error`, SA Q-16): "Your files" is never offered as complete when it is not | — |

### 9.3 `files-index.csv`

Columns (`FILE_INDEX_COLUMNS`): `path_in_export`, `folder`, `size_bytes`, `content_type`, `record_section` (`client_documents`, `images` or empty), `record_id`, `status` (`included` / `could_not_be_read`). `size_bytes` is the real downloaded size for included files, the listing size otherwise. `content_type` is the row's `mime_type`, else the object's, if it looks like `type/subtype`, else `application/octet-stream`. Never a storage key.

### 9.4 Ceilings (Phase 1, `EXPORT_LIMITS`, constants, never env-tunable)

| Measure | Ceiling | Checked | Over it |
|---|---|---|---|
| Files, bytes | `FILE_BYTES_CEILING` 41,943,040 (40 MiB) | Pre-flight on listing sizes, before any download; again on real bytes while downloading | `over_ceiling` → 413 `export_too_large` |
| Files, count | `FILE_COUNT_CEILING` 150 | Pre-flight | `over_ceiling` → 413 |
| Rows across all sections | `ROW_CEILING` 100,000 | The bounded records pass is the row check (SA Q-3): reading stops the moment the total passes it; later sections are not read. Exactly at the ceiling is exported | `over_ceiling` → 413 |
| Finished zip | `ZIP_BYTES_CEILING` 47,185,920 (45 MiB; bucket limit 50 MB) | After build, before upload | `over_ceiling` → 413 |
| Build time | `BUILD_MS_CEILING` 40,000 ms from the request start | Before downloads, before each new download, before the zip, before the upload | `timeout` → 503 `export_timeout` |
| Near ceiling | `NEAR_CEILING_RATIO` 0.6 | Success log; the daily size watch | `warn` `data_export_near_ceiling` / `data_export_accounts_near_ceiling` (files only; records are not watched) |

Over a ceiling **nothing is uploaded and no link is minted**: the job is marked `failed` with its reason, any uploaded object is removed, `DATA_EXPORT_FAILED` records the measured sizes (never content). The owner message: "Your account holds more than the on-screen download can package (over 40 MB of files or 150 files). Nothing was downloaded. Please contact support and we will prepare your export." Above the ceiling neither the owner nor an admin can export in Phase 1 (§0.4.1 C, H). Other limits: `PAGE_SIZE` 1,000, `VIA_PARENT_CHUNK` 100, `FILE_DOWNLOAD_CONCURRENCY` 4.

---

## 10. Delivery

### 10.1 Routes

| Route | Who | What |
|---|---|---|
| `POST /api/business-os/data-exports` | Owner (`getUser`) | Strict **empty** body (any key, a `userId` included, is 400) → throttle `RATE_LIMITS.create` (10 / 900 s, key `data-export-start`) → `startForOwner(user.id)` (database limit; 409 `export_in_progress` / `export_daily_limit` with `retryAt`) → `DATA_EXPORT_REQUESTED` → `runZipExport` → 120 s signed URL → `markOwnerDownloaded` (handing over the link counts as downloaded, DE-8b BC-6) → `DATA_EXPORT_READY` → 200 `{ jobId, downloadUrl, fileName, asciiFileName, expiresAt, failedSections, missingFiles }`. `maxDuration = 60`. Errors: 413 `export_too_large`, 503 `export_timeout`, 500 `export_failed`, 500 `export_ready_sign_failed` (job stays ready; use download again) |
| `GET /api/business-os/data-exports` | Owner | "Last export": newest owner-requested `ready` or `expired` job; a `jobId` only while downloadable; no counts, no audit; query string ignored; throttle `read` |
| `POST /api/business-os/data-exports/[jobId]/parts/1/download` | Owner | "Download again" within 3 days. **POST, not GET** (SA C-7). Zod: `jobId` uuid, `partNo` literal `'1'`; empty body; throttle `read`. Another account's job = 404; not ready or past `expires_at` = 410 `export_expired`. Name re-derived (§3), 120 s URL, `markOwnerDownloaded`, `DATA_EXPORT_DOWNLOADED`. DE-10a: reads `findOwnerJobById`, so an admin job id is a 404 |
| `GET /api/admin/users/[id]/data-exports` (DE-10a) | Admin (`requireAdmin` first) | Last 10 exports: status, times, sizes, who started it (8-char short id), owner downloaded or not. No link, no name; not audited; throttle `read` |
| `POST /api/admin/users/[id]/data-exports` `{ reason }` (DE-10a) | Admin | Reason 5–500 chars, `.strict()`. Same `runZipExport` with the target's context; counts against the target's 3 a day; **returns no link**; own account 403; throttle `create` |
| `POST /api/admin/users/[id]/data-exports/[jobId]/parts/1/download` `{ reason }` (DE-10a) | Admin | Either kind of job (BC-2). Throttle `write`. Write-ahead `DATA_EXPORT_DOWNLOADED_BY_ADMIN` via `writeNow`; not written → 503 `audit_unavailable`, nothing signed. Then a **60 s** link. Never sets the owner's downloaded stamp (SA-5) |

The only account id is the session's (owner) or the path's (admin); never a body, query or header value.

### 10.2 Job rules (database is the authority)

`public.business_os_data_export_start` (migration `20261074`), mirrored in `EXPORT_JOB_POLICY` (`jobPolicy.ts`) and pinned by `supabase/migrations/__tests__/business-os-data-exports.migration.test.ts`:

| Rule | Value |
|---|---|
| One at a time | Partial unique index: one `queued` / `running` row per account |
| Per day | `DAILY_LIMIT` 3 per rolling `DAILY_WINDOW_HOURS` 24, counting `running`, `ready`, `expired`; **`failed` never counts**; admin-started jobs count |
| Stale run | A `running` row older than `STALE_RUNNING_SECONDS` 90 becomes `failed` / `timeout` at the next start (routes stay at `maxDuration` 60) |
| Retention | `RETENTION_HOURS` 72 (`expires_at = ready_at + 72 h`, hours not days, so DST cannot move it) |
| Object | Private bucket `business-data-exports`, 50 MB, `application/zip`, no policy; path `{user_id}/{job_id}/1.zip` built only by `exportObjectPath` (both uuids); uploaded with `upsert: false` |
| Replacement | After `markReady`, `expireOtherReady` expires this account's older ready exports (DE-10a: of the same `requested_by_kind` only) and removes their objects, best effort |
| Job record | Kept until the account is deleted (DE-8a B-1); holds dates, counts, bytes, never content |

### 10.3 Daily cron

`GET /api/cron/data-export`, `25 5 * * *` UTC, fail-closed `CRON_SECRET`, `withCronRunRecord('data-export', …)`, `maxDuration = 60`. `runExportSweep` (not a queue drain; each step idempotent, own budget in `SWEEP_LIMITS`):

| Step | Budget | What |
|---|---|---|
| 1 Reap | 8 s | `running` older than 90 s → `markFailed(…, 'timeout')`; only when that took: remove the object, audit `DATA_EXPORT_FAILED` (system) |
| 2 Expire | 10 s | Ready past `expires_at`: remove the object **first**, then `markExpired` + `DATA_EXPORT_EXPIRED` `reason: 'retention'`. A failed remove keeps the row for tomorrow (the routes already refuse after `expires_at`). So a file is unreachable after 3 days and physically gone within about one more day (DE-8b BC-7) |
| 3 Orphans | 15 s, 500 calls | Only objects named exactly `{uuid}/{uuid}/1.zip`. Kept only if a job row has the same id **and** the same `user_id` and is `running` / `ready`; otherwise removed once older than 10 minutes (`ORPHAN_GRACE_MS`), by a path rebuilt from the two uuids. Anything else is counted and left |
| 4 Size watch | 20 s, 600 calls | Per uuid owner folder of each include bucket, the export's own inventory; one `warn` `data_export_accounts_near_ceiling` with counts and user ids when any account is at ≥ 60 % or over |

### 10.4 Audit events

Defined in `lib/audit/events.ts`; all `resourceName 'Data export'`, `entityType 'user'`. Details carry ids, counts, bytes and durations only — never the signed URL, file name, business name or email.

| Event | Severity | Flags | Written by | Details |
|---|---|---|---|---|
| `DATA_EXPORT_REQUESTED` | info | GDPR, SOC2 | Start route (non-blocking); DE-10a prepare | `job_id`, `requested_by_kind` (`owner` / `admin`; admin adds `reason`) |
| `DATA_EXPORT_READY` | info | GDPR, SOC2 | Start route / prepare (`logAndFlush`) | `job_id`, `section_counts`, `failed_sections`, `bytes`, `file_count`, `row_count`, `missing_files`, `ceiling_use_pct`, `duration_ms`, `format_version` |
| `DATA_EXPORT_FAILED` | warning | GDPR | Start route / prepare (`logAndFlush`); cron reap | `job_id`, `reason` (`over_ceiling` / `timeout` / `error`), measured `bytes` / `file_count` / `row_count`, `ceiling_over`, `duration_ms`; cron: `actor_kind 'system'`, `actorId: null` |
| `DATA_EXPORT_DOWNLOADED` | info | GDPR | Owner download again (non-blocking) | `job_id`, `part_no: 1` |
| `DATA_EXPORT_EXPIRED` | info | GDPR | Start route (`reason: 'replaced'`); cron (`reason: 'retention'`, system) | `job_id`, `reason` |
| `DATA_EXPORT_DOWNLOADED_BY_ADMIN` | **critical** | GDPR, SOC2 | DE-10a admin download, write-ahead `writeNow` | `job_id`, `part_no: 1`, `requested_by_kind`, `reason`, `target_user_id`, `surface 'admin'` |

`DATA_EXPORT_READY` is info (not critical) so an ordinary self-export does not raise the Health "Critical audit events" tile; the admin download does (DE-8a Q-9, B-2). The zip route writes no `DATA_EXPORTED` (historical rows only).

---

## 11. How to change it

### 11.1 Cheat-sheet

| To … | Edit | Also update / expect |
|---|---|---|
| **Add or remove a column** of an exported table | The table's `*_EXPORT` constant in `lib/business-os/purge/descriptors.ts`: move the name between `columns` and `excludedColumns` (an excluded column needs a reason; reuse `EXPORT_COLUMN_REASON`). Order in `columns` = CSV column order = select order | The literal pins in `lib/business-os/data-export/__tests__/exportClassification.test.ts` (`DE3_PINS`, `DE4_PINS`, `DE5_PINS`, `DE6_PINS`, `DE7_PINS`; `profiles` is in `DE3_PINS`) fail until updated. A name on the deny list fails CI unless an SA-reviewed `DENY_EXCEPTIONS` entry excuses it. Run `npm run schema:reconcile` (read-only, needs DB env) — expect 0 `exportColumnDrift` and 0 `exportColumnsMissing`; a declared column that is not live makes PostgREST reject the whole select, so the section would always be `failed`. This is a privacy decision: record it in the requirement |
| **Export a new table** | Change its descriptor's `export` to `include` with a new section id; add the id to `ExportSectionId` (`classificationTypes.ts`); add one entry to `EXPORT_SECTIONS` (`sections.ts`) via `clientRecordsSection` / `accountTableSection` / `contentSection`; add the name to `SECTION_NAMES_EN` and `SECTION_NAMES_HE` (`readme.ts`; `tsc` and `readme.test.ts` fail without it) | The registry ↔ descriptor check (`sectionRegistryProblems`) needs exactly one `include` per section. No `user_id` column → `viaParent` (SA item); no `id` column → `rowKey: 'user_id'` (SA item). Update the 156 / 38 / 118 totals in `exportClassification.test.ts` |
| **Stop exporting a table** | Its descriptor → `exclude` with a reason (reuse `EXPORT_REASON`); remove its section from `ExportSectionId`, `EXPORT_SECTIONS` and both README name maps | The pins and totals in `exportClassification.test.ts`; `sections.test.ts`; `BusinessDataExportRepository.test.ts`; README `not_included` if it is a new kind of exclusion |
| **Add a new database table** (any feature) | It needs a purge descriptor **with** an `export` classification on the spot (`planned` is forbidden) | `exportClassification.test.ts` fails on a descriptor without `export`; `descriptors.invariant.test.ts` and the ownership tests apply as for any purge descriptor |
| **Change what a jsonb cell keeps** | The allow-list in `sections.ts`: `SOURCE_METADATA_KEYS`, `SOURCE_METADATA_URL_KEYS`, `PAYMENT_METADATA_KEYS`, `CONSENT_EVIDENCE_KEYS`, or the row mappers `clientRow`, `paymentRow`, `subscriberRow`, `consentEventRow` | `sections.test.ts` pins each allow-list and the URL cut; a privacy decision |
| **Rename a section / its CSV** | The id in `ExportSectionId`, the descriptor's `section`, the `EXPORT_SECTIONS` entry and both README maps. The CSV is `records/<group>/<section id>.csv` (built in `zipExport.ts`); the id must match `[a-z_]+` (`isAllowedEntryName`) | `readme.test.ts`, `zipExport.test.ts`, `zipEntries.test.ts`; changing an id changes `data.json` for anyone who scripted against it |
| **Add or rename a group** | `ExportGroupId` (`sections.ts`), `EXPORT_GROUPS` (`payload.ts`), `groupNames` in both README copies, and the `records/(account\|client_records\|content)` regex in `isAllowedEntryName` (`zipEntries.ts`) — without the regex change the builder throws on the first CSV | `zipEntries.test.ts`, `readme.test.ts` |
| **Rename a files folder** | The bucket's `export.folder` in `STORAGE_DESCRIPTORS` (`descriptors.ts`); the rule key in `BUCKET_RULES` (`fileManifest.ts`) is the bucket name | README `contents` lines name the folders; `fileManifest.test.ts`, `zipExport.test.ts` |
| **Include a new bucket** | `STORAGE_DESCRIPTORS` `export: { kind: 'include', folder }` **and** a rule in `BUCKET_RULES` (an include without a rule fails the inventory) | `exportClassification.test.ts` (bucket shape; `planned` forbidden), `fileManifest.test.ts` |
| **Change the zip file name** | `lib/business-os/data-export/fileName.ts` (`exportZipFileNames`, `businessSlug`, `asciiSlug`, `exportStamp`); the patterns `FILE_NAME_PATTERN` / `ASCII_FILE_NAME_PATTERN` must still hold | `fileName.test.ts`; DE-10a `downloadName.test.ts`. Recheck `Content-Disposition` on Preview for a Hebrew name (DE-8b T-14) |
| **Change the README** | `lib/business-os/data-export/readme.ts`: the `EN` and `HE` copy tables (both, always), `README_BLOCK_IDS` for a new block | `readme.test.ts` (every block id present and non-empty in both languages) |
| **Change CSV encoding** | `lib/business-os/data-export/csv.ts` | `csv.test.ts`; the README `how_to_read` lines describe it |
| **Change `data.json`** | `lib/business-os/data-export/payload.ts`. Additive changes keep `format_version: 2`; a breaking change bumps it (and `FORMAT_VERSION` in the start route and `adminExportAudit.ts`) | `sections.test.ts` (`payload`), `zipExport.test.ts` |
| **Change a ceiling** | `EXPORT_LIMITS` in `limits.ts` (and the README `retention` line and the 413 messages in both start routes). The zip ceiling must stay under the bucket's 50 MB | `ceiling.test.ts`, `zipExport.test.ts` |
| **Change the daily limit, retention or stale rule** | A **migration** to `public.business_os_data_export_start` (the SQL literals are the authority), then `EXPORT_JOB_POLICY` | `business-os-data-exports.migration.test.ts` fails when the two disagree; README `retention` line |

### 11.2 CI checks that will fail, and why

| Check | File | Fails when |
|---|---|---|
| Classification | `lib/business-os/data-export/__tests__/exportClassification.test.ts` | A descriptor has no `export`; `exclude` has no reason; `include` has an empty / malformed / duplicate column, or a column both included and excluded; a `planned` table or bucket; a denied column without an exception; a stale `DENY_EXCEPTIONS` entry; the registry and descriptors disagree; `rowKey` / `viaParent` / `rowFilter` shape rules; an `include` without `rowKey` that does not list `id`; a pinned column list or the 156 / 38 / 118 totals changed |
| Section registry and mappers | `lib/business-os/data-export/__tests__/sections.test.ts` | Registry order / group / role, allow-lists, URL cutting, the row ceiling |
| Repository | `lib/repositories/__tests__/BusinessDataExportRepository.test.ts` | The E-1…E-6 bounds: `user_id` first filter, columns only from the descriptor, keyset paging, the `viaParent` read |
| Zip | `zipExport.test.ts`, `zipEntries.test.ts`, `fileManifest.test.ts`, `csv.test.ts`, `readme.test.ts`, `fileName.test.ts`, `ceiling.test.ts`, `jobPolicy.test.ts`, `exportSweep.test.ts` | Entry order and names, hostile names, ceilings, failure invariant, CSV rules, README blocks, name rules, sweep |
| Routes | `app/api/business-os/data-exports/__tests__/route.test.ts`, `route.get.test.ts`, `…/download/__tests__/route.test.ts`, `app/api/cron/data-export/__tests__/route.test.ts` (DE-10a adds the admin route tests and `adminGate.writes`) | Auth, strict bodies, status codes, audit placement |
| Purge invariants | `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | No table name may appear outside `descriptors.ts` in the purge feature; ordering bands |
| Migration mirror | `supabase/migrations/__tests__/business-os-data-exports.migration.test.ts` | `EXPORT_JOB_POLICY` and the start function's SQL literals disagree |
| Drift (report-only, not CI) | `npm run schema:reconcile` (`scripts/purge-schema-reconcile.ts`) | Reports `exportColumnDrift` (a live column in neither list) and `exportColumnsMissing` (a declared column not live). Run before merging any column change |

### 11.3 The secret-column deny list

`classification.ts`, checked in CI **and** at request time (`exportColumnsOf` throws; the section fails closed):

- Exact: `access_token`, `refresh_token`, `token`, `credentials`, `secret`, `api_key`, `password`, `password_hash`, `account_token`, `cost_usd`, `provider_cost_usd`, `card_number`, `cvc`, `cvv`, `ip_hash_salt`, `user_agent`, `session_id`, `ip_address`, `fingerprint`.
- Patterns: `/_token$/`, `/_secret$/`, `/_key$/`, `/_credentials$/`, `/_hash$/`, `/cost_usd$/`, `/_salt$/`.
- `DENY_EXCEPTIONS` (one entry): `crm_pipeline_stages.stage_key` — "the stage's short name (e.g. lead), which crm_contacts.stage refers to; not a credential" (DE-4 SA-Q5). Every new exception is an SA item.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created | Generated from the code on `origin/main` (DE-1 … DE-9) and the DE-10a admin additions on `origin/feature/data-export-de10a`: zip layout, file name, CSV, `data.json`, README, all 39 sections, all 118 excluded tables, files, ceilings, delivery, change cheat-sheet |
