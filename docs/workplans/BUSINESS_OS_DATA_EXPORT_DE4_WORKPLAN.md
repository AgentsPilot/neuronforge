# Workplan: Business OS data export, DE-4: clients and scheduling

> **Last Updated**: 2026-10-15

## Overview

DE-4 puts the owner's **client records and scheduling** into "Download my data": contacts, notes and history, tasks, pipeline stages, document details, services, bookings, time off, and the copy of the owner's outside calendar we hold. The nine tables that DE-2 marked `planned: 'DE-4'` in `lib/business-os/purge/descriptors.ts` become `include`, each with an explicit column list and a written reason for every column left out. The rows land in **today's JSON export** (`GET /api/user/data-export`) as nine new sections in a new group, `client_records`, labelled as data the business controls and AgentPilot processes. The section shape is the one DE-8b will write as one CSV per section, so DE-8b adds a writer and touches no reader. Every read goes through one repository, keyed on the session user's id, paged to the end (no silent 1,000-row cut), soft-deleted rows left out, and capped at the Phase 1 ceiling of 100,000 rows with a safe refusal above it.

| Field | Value |
|---|---|
| **Developer** | Dev |
| **Requirement** | `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` §0.2 (DX-1b client records, DX-8 everything we hold), §0.3.1 (scope rulings: B1 + B2 in, soft-deleted rows out, `external_calendar_events` in), §0.3.2 SQ-A5 (read once, ordered by primary key, paged), §0.3.6 (explicit columns from the descriptor, deny list, drift), §0.3.7 (DE-4 row), §0.4 / §0.4.1 (Phase 1: the JSON export now, the zip in DE-8b; 100,000-row ceiling; safe failure), §0.5, §0.6 (DE-2 as built, SA-Q4/Q5/Q6/Q8), §2 (GDPR roles), FR-E1…FR-E12 |
| **Branch** | `feature/data-export-de4` (worktree `neuronforge-de4`, from origin/main `eb2b9396`, which includes DE-1 #393 and DE-2 #402) |
| **Date** | 2026-10-15 |
| **Status** | Code Complete (2026-10-15; uncommitted on `feature/data-export-de4`, merged origin/main `50d26e78`; awaiting SA code review) |
| **Depends on** | DE-2 (merged, #402) |
| **Effort** | 🟡 ~2 d (SA estimate 1.5 d; +0.5 d for paging to the end, the row and body ceiling, and the re-pinned characterization test) |

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [The nine tables: included and excluded columns](#3-the-nine-tables-included-and-excluded-columns)
4. [Free-text columns flagged](#4-free-text-columns-flagged)
5. [Business calls (for the user, via TL)](#5-business-calls-for-the-user-via-tl)
6. [Files to Create / Modify](#6-files-to-create--modify)
7. [Task List](#7-task-list)
8. [Tests (incl. negative controls and the cross-tenant test)](#8-tests-incl-negative-controls-and-the-cross-tenant-test)
9. [CI placement and runtime](#9-ci-placement-and-runtime)
10. [Live schema verification (SQL for TL)](#10-live-schema-verification-sql-for-tl)
11. [Risks](#11-risks)
12. [Open questions for SA](#12-open-questions-for-sa)
13. [SA Review Notes](#sa-review-notes)
14. [QA Testing Report](#qa-testing-report)
15. [Commit Info](#commit-info)
16. [Change History](#change-history)

---

## 1. Analysis Summary

### 1.1 What DE-4 touches

| Area | Today (origin/main `eb2b9396`) | After DE-4 |
|---|---|---|
| Descriptors | 9 tables `planned('DE-4')` (`descriptors.ts` lines 310–334) | 9 × `include` with `columns` + `excludedColumns` (§3) |
| Section ids | `account_identity`, `user_profile`, `plugin_connections` (`classificationTypes.ts`) | + 9 ids (§2.3) |
| Groups | `account` only (`sections.ts`, `payload.ts`) | + `client_records`, `gdpr_role: 'processor'` |
| Reads | 2 repository methods, single select each, no order, no paging | + one descriptor-driven repository method, keyset paged to the end, ordered by `id` (§2.1) |
| Ceiling | none | 100,000 rows across sections and a 4 MB JSON body cap → safe refusal, no file (§2.6) |
| Deny exceptions | `plugin_connections.plugin_key` | + `crm_pipeline_stages.stage_key` (§3.3) |
| Route | 200 always once authenticated | + 413 refusal when over a ceiling |
| DB / migrations | — | **none.** No migration, no new route, no new dependency, no flag |

### 1.2 Facts measured in code

| # | Fact | Where | Consequence |
|---|---|---|---|
| F-1 | All nine tables are `scope: { kind: 'user_id' }`. None is a `via`-parent table | `descriptors.ts` 310–334 | Every read filters `.eq('user_id', <session id>)` on the table itself. The "children only through an owner-scoped parent" rule (SA-Q11) has no DE-4 table to apply to, but the repository **refuses** a `via` table so DE-7's `website_blocks` cannot slip through it (§2.1) |
| F-2 | The only soft delete among the nine is `contact_documents.status = 'deleted'` (`ContactDocumentsRepository.delete`). Contacts, bookings, services, tasks, activities, stages, time off and calendar events are **hard** deleted | repositories, migrations | One row filter (§2.4). `archived` documents, `inactive` / `draft` services, `cancelled` / `no_show` bookings and `cancelled` tasks are **statuses**, not deletes: they stay in (DX-8), as `disconnected` plugin connections do (§0.5) |
| F-3 | The existing export reads issue one select with no `.range()`. PostgREST returns at most `max-rows` (1,000 by default) and **says nothing**. The busiest account has ~748 CRM activities (M-1), so the cut is close | `UserProfileRepository`, `PluginConnectionRepository`; `FINANCE_READ_LIMITS` comment | DE-4 pages every section to the end (§2.2). DX-8 ("everything we hold") is not met without it |
| F-4 | The route returns the body directly, pretty-printed. Vercel refuses a function response over 4.5 MB | `route.ts` | A body cap with a clean refusal (§2.6). At M-1 sizes (~1,000 rows) the body is far below it |
| F-5 | `crm_contacts.source_metadata` holds `ip_hash`, `session_id` and `user_agent` beside the attribution. `ip_hash` is `hashIP(ip, new Date().toDateString())`: salted with the day only, so an IPv4 address is recoverable by brute force | `lib/utils/attribution.ts` 184–309 | Not exported raw. An allow-list of readable keys, like `ACCOUNT_PROFILE_KEYS` (§3.1, SA-Q6, BC-4) |
| F-6 | `scheduling_bookings.calendar_sync_error` stores the calendar provider's error text | `CalendarSyncService.ts` 108, 173 | Excluded: our integration's error text, not the owner's record |
| F-7 | A document's file is removed from storage on delete, but "continuing with soft delete" if the storage call fails | `app/api/crm/contacts/[id]/documents/[documentId]/route.ts` 250–261 | A deleted document can leave an orphan object. **DE-8b note:** the file manifest must drop objects whose `contact_documents` row is `deleted` or missing (SA-Q12) |
| F-8 | `stage_key` matches the deny pattern `/_key$/` | `classification.ts` | A reviewed `DENY_EXCEPTIONS` entry (an SA item, SA-Q6 of DE-2) |
| F-9 | The characterization mock resolves every call on a table to the same result | `route.characterization.test.ts` `mockBuilder` | A paged reader would loop on it. The mock gains a per-table result queue (§8 C-1) |

### 1.3 Live schema status

The column lists in §3 come from the migration bodies **and** the generated physical catalog `lib/business-os/catalog/catalog.generated.ts` (read from the live project on 2026-09-10). The catalog covers four of the nine tables and predates six later columns. **Every column is ❓ until TL runs the read-only SQL in §10**, and `npm run schema:reconcile` must show `exportColumnDrift` 0 and `exportColumnsMissing` 0 before merge. I had no read-only DB tool in this session.

| Table | Catalog 2026-09-10 | Added by migrations after it | Expected live count |
|---|---|---|---|
| `crm_contacts` | 18 | `stage_entered_at` (20260928) | 19 |
| `crm_activities` | 11 | — | 11 |
| `crm_pipeline_stages` | 10 | — | 10 |
| `crm_tasks` | 16 | — | 16 |
| `contact_documents` | not in catalog | — (create 20260722) | 15 |
| `scheduling_services` | 26 | — | 26 |
| `scheduling_bookings` | 30 | `intake_reminded_at` (20260921), `cancel_reason`, `cancel_note`, `cancelled_by` (20260928c), `parent_booking_id`, `occurrence_number` (20261001) | 36 |
| `scheduling_availability_exceptions` | not in catalog | — (create 20260722) | 8 |
| `external_calendar_events` | not in catalog | — (create 20260723) | 11 |

`crm_contacts.notes` exists in the catalog but only in the `20260721` create (the `20260722` create, `IF NOT EXISTS`, does not have it). The catalog says it is live; §10 Q1 confirms.

---

## 2. Implementation Approach

### 2.1 One descriptor-driven read method (SA-Q1)

**Proposal:** a new repository `lib/repositories/BusinessDataExportRepository.ts` (via the `new-repository` skill) with one method:

```typescript
listOwnedRowsForExport(table: ExportTableName, userId: string, opts: { maxRows: number })
  : Promise<RepositoryResult<{ rows: Record<string, unknown>[]; overCeiling: boolean }>>
```

- `table` is a closed union of the included table names, set in code by the section registry. It never comes from a request.
- Inside the `try`, it resolves the descriptor and **fails closed** (returns `{ error }`, so the section is `failed`) unless the descriptor is `include` **and** `scope.kind === 'user_id'`. A `via` table (DE-7 `website_blocks`) needs its own parent-scoped reader (SA-Q11 of DE-2).
- Columns come from `exportColumnsOf(table)` (DE-2), so the deny check runs at request time too.
- First filter is always `.eq('user_id', userId)`. Service role (`supabaseServer` default, client injection for tests). Documented at the call site: the export runs as the service role (DE-1 SA C-2, DE-0b), and the session id is the only tenant key.
- The row filter of §2.4 is applied when the descriptor declares one.
- Logs carry `table`, `userId`, page count and row count. Never row content.

Why one method and not nine: DE-5, DE-6 and DE-7 add about 32 more tables. One method means one place where the tenant filter, the paging, the soft-delete filter and the ceiling are tested, and a new section is a descriptor plus a registry line. `BusinessPurgeRepository` is the precedent: it is descriptor-driven over the same descriptors. **Alternative (if SA prefers the DE-2 shape):** a `listForDataExport(userId)` on each of the eight domain repositories, all calling one shared paging helper. Same behaviour, eight files touched, nine method tests.

### 2.2 Paging to the end, in primary-key order

Keyset paging on `id` (SQ-A5: "ordered by primary key and paged"): `.order('id', { ascending: true }).limit(PAGE_SIZE)`, then `.gt('id', lastId)` for each later page. `PAGE_SIZE = 1000`. **The loop ends on an empty page, not on a short one.** If the project's `max-rows` were ever set below 1,000, a "short page means the end" loop would stop early and drop rows without a word. Ending on an empty page costs one extra tiny query per section and is correct for any `max-rows`. Every section is therefore read in a fixed order (by `id`, a UUID, so not chronological; each row carries its own dates, and the README in DE-8b says so; SA-Q8).

### 2.3 Sections and the group

Nine new `ExportSectionId`s in `classificationTypes.ts`, one table each (SA-Q8 of DE-2), registered in `sections.ts` after `plugin_connections`, in this order:

| Section id | Table | Group | GDPR role |
|---|---|---|---|
| `pipeline_stages` | `crm_pipeline_stages` | `client_records` | processor |
| `clients` | `crm_contacts` | `client_records` | processor |
| `client_activities` | `crm_activities` | `client_records` | processor |
| `client_tasks` | `crm_tasks` | `client_records` | processor |
| `client_documents` | `contact_documents` (details only) | `client_records` | processor |
| `services` | `scheduling_services` | `client_records` | processor |
| `bookings` | `scheduling_bookings` | `client_records` | processor |
| `time_off` | `scheduling_availability_exceptions` | `client_records` | processor |
| `calendar_busy_times` | `external_calendar_events` | `client_records` | processor (SA-Q9) |

The ids are plain words because DE-8b will name each CSV after its section (`clients.csv`, `bookings.csv`; SA-Q3).

`payload.ts`: `ExportGroupId` becomes `'account' | 'client_records'`. `ExportGroupMetadata.controller` widens from the literal `'AgentPilot'` to `'AgentPilot' | 'account_holder'` (SA-Q13). The `client_records` entry: `gdpr_role: 'processor'`, `controller: 'account_holder'`, description: "Records you keep about your clients. You, the account holder, are the controller of these records. AgentPilot keeps them on your behalf, as its processor." The business name replaces "the account holder" in DE-8b (§0.4.1 E; the business-name column is still unknown, §0.5). `format_version` stays `2`: new sections and a new group are additive.

### 2.4 Soft-deleted rows (SQ-E5)

`TableExportClassification`'s `include` gains an optional `rowFilter: { column: string; notIn: readonly string[]; reason: string }` (SA-Q2). Only `contact_documents` sets it: `{ column: 'status', notIn: ['deleted'], reason: 'SQ-E5: soft-deleted documents are not exported' }`. The repository applies it as `.not(column, 'in', '(…)')` after the `user_id` filter. Keeping it on the descriptor makes the rule declarative, testable (T-4 checks the column is a declared one), and readable by DE-8b's README writer ("deleted documents are not included"). The purge engine stays blind to it (`export` is never read under `purge/`, DE-2 T-13).

`NULL` status: the column is `NOT NULL DEFAULT 'active'`, so `not in` cannot drop a NULL row. §10 Q3 confirms the values in use.

### 2.5 How DE-8b writes these sections as CSV without rework

- **Rows are left as the database returns them**: one flat object per row, keys = the descriptor's `columns`, in that order. The one reshaping is `clients.source_metadata` (allow-listed object, §3.1). Arrays (`tags`) and jsonb (`custom_fields`, `availability`, `intake_responses`, `custom_hours`) stay as values. DE-8b's CSV writer serialises them as JSON text in a cell, and `data.json` keeps them as they are. Both writers read the same rows.
- **`ExportSectionDefinition` gains `table?: string`** (not written to the file). DE-8b takes the CSV header from `exportColumnsOf(definition.table)`, so an empty section still gets a header row.
- **A `failed` section stays `failed`** in both writers (FR-E12). No reader changes.
- The row ceiling (§2.6) is shared code in `limits.ts`. DE-8b's pre-flight `count` head queries use the same constant.

### 2.6 Phase 1 ceiling: safe refusal, never a partial file

`lib/business-os/data-export/limits.ts` (pure): `EXPORT_LIMITS = { ROW_CEILING: 100_000, PAGE_SIZE: 1_000, JSON_BODY_MAX_BYTES: 4_000_000 }`.

1. **Rows (§0.4.1 C).** `runExportSections` passes each table reader the rows still left in the budget (`maxRows`). The repository stops after `maxRows + 1` rows and returns `overCeiling: true`. Reading then stops for every later section, and `runExportSections` returns `{ sections, overCeiling: true }`. The route then returns **413** `{ success: false, error: 'Your account holds more than the on-screen download can package. Nothing was downloaded. Please contact support and we will prepare your export.', code: 'export_too_large' }` with `Cache-Control: no-store`. No file is sent.
2. **Body (F-4).** The serialised body is measured before it is sent. Over 4 MB → the same 413. The 4.5 MB Vercel limit is a crash, not a message. This cap exists only while the export is a direct JSON response: DE-8b's signed-URL zip replaces it with the §0.4.1 C zip ceilings (40 MB files, 45 MB zip).
3. **What we record:** a `warn` log `data_export_over_ceiling` with `userId`, `sectionCounts`, `rows`, `bodyBytes` (ids and counts only). **No `DATA_EXPORTED` audit row** (nothing was exported). `DATA_EXPORT_FAILED` arrives with the audit names in DE-8a (SA-Q7).
4. **Client:** `downloadUserDataExport()` maps 413 to a new `code: 'too_large'`. Its three callers show their existing generic error until DE-9 writes the copy (SA-Q7).

Today's largest account is about 1% of the row ceiling and well under the body cap. This is the safety net §0.4 requires, not a limit anyone hits.

### 2.7 Tenant isolation (tenant-isolation-guard)

Service role, so RLS does not protect these reads. The rules:

- The **only** id is `ctx.userId = getUser().id`. No query string, header or body value reaches a reader. The route takes no input, and the test proves a planted `?userId=` and `x-user-id` are ignored.
- Every query's first filter is `.eq('user_id', ctx.userId)`. No caller-supplied entity id is used: there is no `findById` here at all.
- Read-only: no write, no trigger, no upsert, so the "scope-defeating three" of the skill do not arise.
- A child row is always read **by its own `user_id`**, never through a parent id handed in. A parent/child `user_id` mismatch in the data (a row whose `contact_id` points at another tenant's contact) would carry only the foreign UUID, never the foreign row. §10 Q6 measures whether any exist.

### 2.8 Logging and audit

Pino via the repository's `createLogger({ service: 'BusinessDataExportRepository' })`, `{ err }` on failure, no row content, no names, no emails. The route's `DATA_EXPORTED` details gain the nine section counts (counts only, FR-E15). No file touched by DE-4 uses `console.*` (checked: 0 in each).

---

## 3. The nine tables: included and excluded columns

Every list is in the order the repository selects it (order matters: the characterization test pins the select string). `user_id` is excluded from all nine with one named reason, `EXPORT_COLUMN_REASON.OWNER_ID`: "always the exporting account; it is in `export_metadata.user_id`" (SA-Q4; `plugin_connections` keeps its `user_id` unchanged). Ids and foreign-key ids **are** included: they are how a booking points at its client and service inside the file.

### 3.1 `crm_contacts` → `clients` (19 live columns ❓)

| Included (18) | |
|---|---|
| `id`, `first_name`, `last_name`, `email`, `phone`, `stage`, `stage_entered_at`, `tags`, `custom_fields`, `notes`, `source`, `source_metadata`, `referrer_domain`, `utm_source`, `utm_medium`, `utm_campaign`, `created_at`, `updated_at` | The client record as the owner keeps it. The four attribution columns are generated from `source_metadata` (20260826) |

| Excluded | Reason |
|---|---|
| `user_id` | `OWNER_ID` |

`source_metadata` is read but never written raw. The reader keeps only `SOURCE_METADATA_KEYS`: `capture_channel`, `capture_page_url`, `capture_timestamp`, `page_type`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `smart_link_code`, `smart_link_name`, `referrer_url`, `referrer_domain`, `device_type`. String values only. **Dropped:** `ip_hash` (a day-salted hash of the visitor's IP, recoverable, F-5), `session_id` and `smart_link_id` (our tracking ids), `user_agent` (browser fingerprint), and any key not on the list. This copies the `ACCOUNT_PROFILE_KEYS` precedent (DE-2 SA C-4) and is a business call (BC-4).

### 3.2 `crm_activities` → `client_activities` (11 ❓)

| Included (10) | Excluded | Reason |
|---|---|---|
| `id`, `contact_id`, `activity_type`, `title`, `description`, `activity_date`, `auto_logged`, `source_capability`, `source_entity_id`, `created_at` | `user_id` | `OWNER_ID` |

Notes and the history timeline. `auto_logged` / `source_capability` tell the owner which lines the system wrote ("booking confirmed") and which they typed. Every `activity_type` is in, including `email` lines: SA ruled B1 in whole (§0.3.1). The `email_sends` table, with the bodies, stays out.

### 3.3 `crm_pipeline_stages` → `pipeline_stages` (10 ❓)

| Included (9) | Excluded | Reason |
|---|---|---|
| `id`, `vertical`, `stage_key`, `stage_label`, `position`, `color`, `stage_type`, `is_primary_client_stage`, `created_at` | `user_id` | `OWNER_ID` |

`stage_key` hits the deny pattern `/_key$/`. **New `DENY_EXCEPTIONS` entry** (SA item): `'crm_pipeline_stages.stage_key': "the stage's short name (e.g. lead), which crm_contacts.stage refers to; not a credential"`. Without it a client's `stage` cannot be read against its label.

### 3.4 `crm_tasks` → `client_tasks` (16 ❓)

| Included (15) | Excluded | Reason |
|---|---|---|
| `id`, `contact_id`, `title`, `description`, `priority`, `status`, `due_date`, `reminder_at`, `completed_at`, `created_by`, `source_entity_type`, `source_entity_id`, `tags`, `created_at`, `updated_at` | `user_id` | `OWNER_ID` |

Completed and cancelled tasks are in (statuses, DX-8).

### 3.5 `contact_documents` → `client_documents` (15 ❓; details only, files in DE-8b)

| Included (12) | |
|---|---|
| `id`, `contact_id`, `name`, `document_type`, `file_name`, `file_size`, `mime_type`, `description`, `tags`, `status`, `created_at`, `updated_at` | |

| Excluded | Reason |
|---|---|
| `user_id` | `OWNER_ID` |
| `storage_path` | "where the file sits in our storage; the file itself arrives in 'Your files' (DE-8b), whose manifest comes from `STORAGE_DESCRIPTORS`" |
| `storage_bucket` | same |

`rowFilter`: `status not in ('deleted')`. `archived` documents are in (BC-3).

### 3.6 `scheduling_services` → `services` (26 ❓)

| Included (24) | |
|---|---|
| `id`, `service_name`, `description`, `duration_minutes`, `price`, `currency`, `buffer_minutes`, `max_bookings_per_day`, `advance_booking_days`, `min_notice_hours`, `availability`, `is_active`, `status`, `is_scheduled`, `collection`, `sale_mode`, `payment_type`, `installment_count`, `installment_frequency`, `first_payment_due`, `first_payment_days`, `source`, `created_at`, `updated_at` | `price` always travels with `currency` (the authority for what a client is charged, CLAUDE.md § Currency; FR-E9) |

| Excluded | Reason |
|---|---|
| `user_id` | `OWNER_ID` |
| `ai_suggestions` | "assistant output kept to pre-fill the service form, not a setting the owner chose (DX-1d)" (BC-7) |

Draft and inactive services are in (statuses).

### 3.7 `scheduling_bookings` → `bookings` (36 ❓)

| Included (27) | |
|---|---|
| `id`, `service_id`, `contact_id`, `parent_booking_id`, `occurrence_number`, `start_time`, `end_time`, `timezone`, `status`, `cancellation_reason`, `cancel_reason`, `cancel_note`, `cancelled_by`, `booking_source`, `notes`, `internal_notes`, `payment_status`, `payment_method`, `payment_amount`, `payment_currency`, `payment_id`, `invoice_id`, `payment_plan_id`, `intake_responses`, `intake_completed_at`, `created_at`, `updated_at` | `payment_amount` travels with `payment_currency`. `intake_responses` are the client's answers (the owner's record) |

| Excluded | Reason |
|---|---|
| `user_id` | `OWNER_ID` |
| `reminder_24hr_sent`, `reminder_2hr_sent` | "DX-1d: a reminder email sent is activity" (BC-6) |
| `intake_sent_at`, `intake_reminded_at` | "DX-1d: when the intake email was sent is activity" (BC-6) |
| `external_calendar_event_id`, `calendar_sync_provider`, `calendar_synced_at` | "calendar sync plumbing" |
| `calendar_sync_error` | "the calendar provider's error text from our integration (F-6)" |

Cancelled, completed and no-show bookings are in (statuses, DX-8; BC-2). `internal_notes` (the owner's private notes) is in (BC-1).

### 3.8 `scheduling_availability_exceptions` → `time_off` (8 ❓)

| Included (7) | Excluded | Reason |
|---|---|---|
| `id`, `exception_type`, `start_date`, `end_date`, `custom_hours`, `reason`, `created_at` | `user_id` | `OWNER_ID` |

### 3.9 `external_calendar_events` → `calendar_busy_times` (11 ❓)

| Included (8) | Excluded | Reason |
|---|---|---|
| `id`, `provider`, `title`, `start_time`, `end_time`, `is_all_day`, `created_at`, `updated_at` | `user_id` | `OWNER_ID` |
| | `external_event_id` | "the calendar provider's own event id; sync plumbing" |
| | `last_synced_at` | "sync plumbing" |

In per SQ-E7 ("the owner's own calendar as we hold it"). The rows are a cache that calendar sync refills within ~5 minutes; the owner's real calendar stays with Google / Outlook (BC-5).

### 3.10 Deny-list check of the proposed lists

Run by hand against `SECRET_COLUMN_DENY_EXACT` and `SECRET_COLUMN_DENY_PATTERNS`: the only hit is `stage_key` (§3.3). No `token`, `secret`, `credentials`, `_hash`, `cost_usd` column is on any of the nine tables (the only `_hash` value, `ip_hash`, is a jsonb key, handled by the allow-list).

---

## 4. Free-text columns flagged

These hold whatever the owner, the client or the system typed. Per §2 point 3 they are **the owner's data and are exported**. We do not filter client data "for the client's sake", and no secret of ours is expected in them. They are flagged so that review knows where an unexpected value could sit, and DE-8b's CSV-injection neutralising applies to all of them.

| Column | Who writes it | Why flagged |
|---|---|---|
| `crm_contacts.notes`, `custom_fields` | owner; the migration's own `custom_fields` examples include `diagnosis` and `insurance_provider` | may hold health data (special category). Owner's record, in |
| `crm_contacts.source_metadata.referrer_url`, `capture_page_url` | system, from the visitor's browser | a URL can carry query parameters from the referring site |
| `crm_activities.title`, `description` | owner, and the system (`activitySentence`, the AI employee) | system-written lines mix in with the owner's notes; Dev confirms in T-0 that no writer puts internal error text there |
| `crm_tasks.description` | owner, AI employee, automations | as above |
| `contact_documents.description`, `name`, `file_name` | owner | a file name can be a client's name (never logged, §0.3.2) |
| `scheduling_bookings.notes`, `cancel_note`, `cancellation_reason`, `intake_responses` | the client | third-party free text and answers |
| `scheduling_bookings.internal_notes` | owner | the owner's private notes about the client (BC-1) |
| `scheduling_availability_exceptions.reason` | owner | may name personal reasons |
| `external_calendar_events.title` | the owner's outside calendar | personal appointments (BC-5) |

**Excluded because they hold our internals:** `calendar_sync_error` (provider error text), `source_metadata.ip_hash` / `session_id` / `user_agent`.

---

## 5. Business calls (for the user, via TL)

Plain terms. Dev's recommendation in each case; SA defaults apply if the user does not answer.

| # | Question | Recommendation |
|---|---|---|
| **BC-1** | Your private notes on a booking ("internal notes", the ones the client never sees): do they go in your download? | **Yes.** They are your own record; we only leave out what is ours |
| **BC-2** | Cancelled bookings, no-shows, completed bookings, and finished or cancelled tasks: in the download, with their status? | **Yes.** "Everything we hold" (DX-8); the status column says which is which |
| **BC-3** | Documents you **archived** (not deleted): in the download? Documents you **deleted** are left out | **Yes, archived in; deleted out** |
| **BC-4** | For each client, how they found you: keep the readable parts (which page, which link, which campaign, phone or computer) but leave out the technical tracking we store (a scrambled form of their internet address, their browser signature, our session code)? | **Yes.** The scrambled address can be turned back into the real one, and it is our tracking, not your record |
| **BC-5** | The copy of your own Google / Outlook calendar we keep to block busy times (titles and times of your personal appointments): in the download? SA's earlier ruling says yes | **Yes** (confirm). Your real calendar stays with Google / Outlook either way |
| **BC-6** | The "reminder sent" and "intake form sent" markers on each booking: out, because emails we send are activity, which you decided to leave out (DX-1)? | **Out.** The client's own intake answers and when they completed them stay in |
| **BC-7** | The AI's suggestions stored with a service (what the assistant proposed when it drafted the service): out? | **Out.** Your actual service settings are in |
| **Note (not a question)** | When DE-4 merges, the **current** "Export data" button starts including your client records, before the new zip arrives in DE-8b. That is what §0.4 decided ("data still lands in the current JSON export now"). It means the file now holds third-party personal data; it is downloaded only by the signed-in owner and never cached | — |

---

## 6. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/repositories/BusinessDataExportRepository.ts` | create | §2.1, §2.2, §2.4, §2.6 (SA-Q1; alternative: eight repositories + one helper) |
| `lib/repositories/__tests__/BusinessDataExportRepository.test.ts` | create | U-5, U-6 |
| `lib/business-os/data-export/limits.ts` | create | `EXPORT_LIMITS` (pure) |
| `lib/business-os/data-export/classificationTypes.ts` | modify | 9 section ids; optional `rowFilter` on `include` |
| `lib/business-os/data-export/classification.ts` | modify | `DENY_EXCEPTIONS` + `stage_key`; `tableExportProblems` checks `rowFilter` (column declared, non-empty `notIn`, reason) |
| `lib/business-os/purge/descriptors.ts` | modify | 9 × `include` constants (`CRM_CONTACTS_EXPORT`, …) with `excludedColumns`; `EXPORT_COLUMN_REASON` names for repeated reasons. `level`, `order`, `scope`, `snapshot` untouched |
| `lib/business-os/data-export/sections.ts` | modify | group `client_records`; 9 section definitions with `table`; `SOURCE_METADATA_KEYS` + `sourceMetadata()`; row budget through `runExportSections`, which returns `{ sections, overCeiling }` |
| `lib/business-os/data-export/payload.ts` | modify | `client_records` group metadata; `controller` widened |
| `app/api/user/data-export/route.ts` | modify | 413 refusal (rows, body); log line; comment header |
| `lib/client/downloadUserDataExport.ts` | modify | `413 → code: 'too_large'` |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | modify | U-1…U-4 |
| `lib/business-os/data-export/__tests__/sections.test.ts` | modify | U-7, U-8 |
| `app/api/user/data-export/__tests__/route.test.ts` | modify | U-9, cross-tenant route test |
| `app/api/user/data-export/__tests__/route.characterization.test.ts` | modify | C-1 deliberate re-pin with `DE-4:` comments |
| `lib/client/__tests__/downloadUserDataExport.test.ts` | modify | 413 mapping |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | modify | §0.7 DE-4 status (always update the main requirement) |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`, purge docs | — | not touched (no entitlements import) |

---

## 7. Task List

- ✅ **T-0** TL runs §10 Q1–Q6 (read-only). Dev reconciles §3 against Q1 before writing the descriptors: any column not live leaves the list; any live column not in §3 gets a decision (include or reason) and comes back to SA if it changes a §3 row
- ✅ **T-1** `limits.ts`; the 9 section ids and `rowFilter` in `classificationTypes.ts`
- ✅ **T-2** `descriptors.ts`: the 9 `include` constants per §3 (as reconciled in T-0); `DENY_EXCEPTIONS` + `stage_key`; `rowFilter` validation in `tableExportProblems`
- ✅ **T-3** `BusinessDataExportRepository` (skill checklist: client injection, `RepositoryResult`, `user_id` filter, Pino, singleton) + its unit tests (U-5, U-6)
- ✅ **T-4** `sections.ts`: group, 9 definitions, `sourceMetadata()` allow-list, row budget and `overCeiling` from `runExportSections`
- ✅ **T-5** `payload.ts`: `client_records` metadata
- ✅ **T-6** `route.ts`: 413 on rows / body, warn log, no audit row on refusal; `downloadUserDataExport` `too_large`
- ✅ **T-7** Tests U-1…U-9; C-1 re-pin (mock gains a per-table result queue)
- ✅ **T-8** Full checks: `npm test -- lib/business-os lib/repositories lib/audit lib/client app/api/user/data-export`, `npm run test:bos-entitlements` (it runs the purge invariant suite, which loads `descriptors.ts`), `npm run lint`. Record runtimes
- ⬜ **T-9** TL runs `npm run schema:reconcile` on the branch: `exportColumnDrift` 0, `exportColumnsMissing` 0, status `ok`. Recorded in Dev Implementation Notes with the SHA
- ✅ **T-10** Requirement §0.7 DE-4 status; Change History rows

---

## 8. Tests (incl. negative controls and the cross-tenant test)

All Jest, mocked clients, in the existing gate. Each "NC" is a negative control: a planted bad input that must fail.

| Id | File | Asserts | Negative controls |
|---|---|---|---|
| **U-1** | `exportClassification.test.ts` | The 9 tables are `include` with the section ids of §2.3 and the column lists of §3, pinned literally; every `excludedColumns` reason is non-empty; DE-4 `planned` count is 0 | NC: a copy with one table re-`planned` fails the pin; a column moved from `excludedColumns` to `columns` fails the pin |
| **U-2** | same | Live-columns fixture (the T-0 Q1 result, committed as a small literal): `exportColumnDrift(fixture)` and `exportColumnsMissing(fixture)` are both `[]` for the 9 tables. Documents the measured state with no DB in CI | NC: a fixture with an extra live column reports it as drift; a declared column missing from the fixture reports it as missing |
| **U-3** | same | `stage_key` passes only through its `DENY_EXCEPTIONS` entry; no exception is stale | NC: without the entry, T-4 of DE-2 flags `crm_pipeline_stages.stage_key` |
| **U-4** | same | `rowFilter` rules: the column is one of the table's declared columns, `notIn` non-empty, reason non-empty; only `contact_documents` has one | NC: a `rowFilter` on an undeclared column, an empty `notIn`, a blank reason are each flagged |
| **U-5** | `BusinessDataExportRepository.test.ts` | Select string = `exportColumnsOf(table).join(', ')`, never `*`; first filter `.eq('user_id', id)`; `.order('id')`, `.limit(1000)`, `.gt('id', last)` on later pages; reads until an **empty** page; applies `rowFilter` for `contact_documents` only; `overCeiling` at `maxRows + 1` and no further page read; a PostgREST error → `{ error }` | NC: a mock that returns short pages of 500 (a lower `max-rows`) still yields every row; a `planned` / `exclude` / unknown table → `{ error }` with no query; a `via`-scoped descriptor → `{ error }` with no query; a deny-listed column planted in a copy → `{ error }` with no query |
| **U-6 (cross-tenant)** | same | An in-memory fake client holding rows for **A** and **B** in all 9 tables, honouring `.eq` / `.gt` / `.not` / `.order` / `.limit`. Running the whole registry for A returns only A's rows, by id; no B id appears anywhere in the serialised sections | NC: a fake that ignores `.eq('user_id')` makes the test fail (proves the test can see a leak) |
| **U-7** | `sections.test.ts` | Registry order (3 + 9), every DE-4 section `group: 'client_records'`, `gdprRole: 'processor'`, carries `table`; one DE-4 reader failing → that section `failed`, the rest `ok`; `sourceMetadata()` keeps the allow-listed keys only | NC: planted `ip_hash`, `session_id`, `user_agent`, `access_token` and a nested object are dropped; a non-object value gives `{}` |
| **U-8** | `sections.test.ts` / payload | Total rows over `ROW_CEILING` → `overCeiling: true`, later sections not read; exactly at the ceiling → exported; `EXPORT_GROUPS.client_records` metadata | NC: ceiling + 1 spread over two sections still trips it |
| **U-9** | `route.test.ts` | Over the row ceiling → 413 with the pinned body, `no-store`, no `Content-Disposition`, warn `data_export_over_ceiling` with counts only, **no** `DATA_EXPORTED`; body over 4 MB → same 413; `?userId=OTHER` and `x-user-id: OTHER` are ignored (every read used the session id) | NC: lowering the body cap in a test to 1 KB makes a normal seeded export refuse (proves the check runs on the real body) |
| **C-1** | `route.characterization.test.ts` | Deliberate re-pin, each change marked `DE-4:`: 11 table reads in order, all on the service-role client, none on the anon client; the 9 literal select strings; the paging calls; nine new sections in the body; the audit `section_counts` gain nine keys. The token-free check extends to the new sections | Existing: anon-client read fails the pin |
| **G-1** | existing `ownerAuditReads.guard.test.ts` | Still green: the new repository reads no audit or archive table | (existing) |
| **G-2** | existing purge `descriptors.invariant.test.ts` + `classification-baseline.json` | Unchanged: no `level`, `order`, `scope` or `snapshot` changes; T-13 "purge is blind to export" still passes with `rowFilter` added | (existing) |

**Manual QA (critical path, recorded in the QA report):** on a test account with contacts, a booking, a cancelled booking, a deleted and an archived document, press "Export data"; the file has the nine sections, the deleted document is absent, the archived one present, no `ip_hash` anywhere. With a second account, confirm none of its contact names or ids appear.

---

## 9. CI placement and runtime

No new job, no new script, no DB in CI. Every test above runs in the existing Jest gate. The new repository suite and the extended suites are pure or mocked; DE-2's comparable suites ran at ≤ 25 ms a test, the wall time being ts-jest transform. Expected added Jest time: a few seconds in a job that is not on the critical path against Build (no-added-CI-time rule). Measured and recorded in T-8. `typecheck:bos-llm` scope is not widened (DE-2 SA-Q1).

---

## 10. Live schema verification (SQL for TL)

**Read-only, run on PROD in the SQL editor.** Avoids the editor's word bug. Outputs table and column names, counts, key names and user ids only: no row content.

**File:** (pasted by TL; not committed)

```sql
-- Q1: every live column of the nine tables (reconcile with §3)
SELECT table_name, ordinal_position, column_name, data_type, is_nullable, is_generated
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('crm_contacts', 'crm_activities', 'crm_pipeline_stages', 'crm_tasks',
                     'contact_documents', 'scheduling_services', 'scheduling_bookings',
                     'scheduling_availability_exceptions', 'external_calendar_events')
ORDER BY table_name, ordinal_position;

-- Q2: column count per table (expected: 19, 11, 10, 16, 15, 26, 36, 8, 11)
SELECT table_name, count(*) AS columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('crm_contacts', 'crm_activities', 'crm_pipeline_stages', 'crm_tasks',
                     'contact_documents', 'scheduling_services', 'scheduling_bookings',
                     'scheduling_availability_exceptions', 'external_calendar_events')
GROUP BY table_name ORDER BY table_name;

-- Q3: status values in use (soft delete and statuses)
SELECT 'contact_documents' AS t, status::text AS value, count(*) FROM public.contact_documents GROUP BY 2
UNION ALL SELECT 'scheduling_services', status::text, count(*) FROM public.scheduling_services GROUP BY 2
UNION ALL SELECT 'scheduling_bookings', status, count(*) FROM public.scheduling_bookings GROUP BY 2
UNION ALL SELECT 'crm_tasks', status::text, count(*) FROM public.crm_tasks GROUP BY 2
ORDER BY 1, 2;

-- Q4: keys present in crm_contacts.source_metadata (key names and counts only)
SELECT k AS key, count(*) AS contacts
FROM public.crm_contacts, LATERAL jsonb_object_keys(source_metadata) AS k
WHERE jsonb_typeof(source_metadata) = 'object'
GROUP BY k ORDER BY 2 DESC;

-- Q5: largest owners across the nine tables (rows and approximate bytes)
WITH s AS (
  SELECT user_id, pg_column_size(x.*) AS b FROM public.crm_contacts x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.crm_activities x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.crm_pipeline_stages x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.crm_tasks x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.contact_documents x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.scheduling_services x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.scheduling_bookings x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.scheduling_availability_exceptions x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.external_calendar_events x
)
SELECT user_id, count(*) AS rows, pg_size_pretty(sum(b)) AS approx_bytes
FROM s GROUP BY user_id ORDER BY sum(b) DESC LIMIT 5;

-- Q6: child rows whose user_id differs from their parent's (cross-tenant integrity)
SELECT 'crm_activities -> crm_contacts' AS edge, count(*) FROM public.crm_activities a
  JOIN public.crm_contacts c ON c.id = a.contact_id WHERE a.user_id <> c.user_id
UNION ALL SELECT 'crm_tasks -> crm_contacts', count(*) FROM public.crm_tasks t
  JOIN public.crm_contacts c ON c.id = t.contact_id WHERE t.user_id <> c.user_id
UNION ALL SELECT 'contact_documents -> crm_contacts', count(*) FROM public.contact_documents d
  JOIN public.crm_contacts c ON c.id = d.contact_id WHERE d.user_id <> c.user_id
UNION ALL SELECT 'scheduling_bookings -> crm_contacts', count(*) FROM public.scheduling_bookings b
  JOIN public.crm_contacts c ON c.id = b.contact_id WHERE b.user_id <> c.user_id
UNION ALL SELECT 'scheduling_bookings -> scheduling_services', count(*) FROM public.scheduling_bookings b
  JOIN public.scheduling_services v ON v.id = b.service_id WHERE b.user_id <> v.user_id;
```

**Before merge (T-9):** `npm run schema:reconcile` on the branch. Expect status `ok`, `exportColumnDrift` 0, `exportColumnsMissing` 0. Recorded with the SHA.

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | PostgREST's `max-rows` cuts a section silently (F-3), breaking DX-8 | Keyset paging that ends on an empty page; U-5 NC with 500-row pages |
| R-2 | A phantom column makes PostgREST reject a whole section, so it is always `failed` | §10 Q1 before the descriptors are written; `exportColumnsMissing` in `schema:reconcile`; U-2 fixture |
| R-3 | Third-party personal data in today's JSON download (and in an owner's downloads folder) | Owner-only, session id only, `no-store`; logs and audit carry counts only; nothing new is cached. Accepted by §0.4 |
| R-4 | Reversible tracking data leaks (F-5) | `SOURCE_METADATA_KEYS` allow-list; U-7 NC |
| R-5 | Vercel 4.5 MB response crash | 4 MB body cap → 413 (§2.6) |
| R-6 | Rows whose `user_id` disagrees with their parent's (Q6) | Each row is read by its own `user_id`; a mismatch could carry only a foreign UUID, never a foreign row. If Q6 is non-zero, SA decides whether to drop such foreign ids |
| R-7 | Orphan files of deleted documents reappear in DE-8b's "Your files" (F-7) | Carried to DE-8b as a condition (SA-Q12); DE-4 itself exports no file |
| R-8 | Characterization mock loops on a paged reader (F-9) | Per-table result queue in the mock, with a hard call cap that fails the test instead of hanging |
| R-9 | One slow section blocks the request | 9 sections × ~1–2 pages at M-1 sizes is about 20 small queries, sequential (DE-1 shape); the route has no `maxDuration` today and needs none at this size. DE-8b owns the 40 s build budget |
| R-10 | DE-5/6/7 copy a reader that skips the ceiling or the paging | One repository method (SA-Q1) makes the right path the only path |

---

## 12. Open questions for SA

| # | Question | Dev default |
|---|---|---|
| **SA-Q1** | One descriptor-driven `BusinessDataExportRepository.listOwnedRowsForExport(table, userId, opts)` (precedent: `BusinessPurgeRepository`), or a method on each of the eight domain repositories over a shared paging helper (DE-2 shape)? A rule-7 call | One descriptor-driven method |
| **SA-Q2** | Soft-delete filter as an optional `rowFilter` on the `include` classification, or local to the section reader? | `rowFilter` on the descriptor |
| **SA-Q3** | Section ids are plain words (`clients`, `bookings`, …) that DE-8b uses as CSV names. Agreed, or table names? | Plain words |
| **SA-Q4** | `user_id` excluded from the nine client sections (`OWNER_ID` reason) while `plugin_connections` keeps it (unchanged file). Agreed? | Exclude in DE-4; leave `plugin_connections` alone |
| **SA-Q5** | `DENY_EXCEPTIONS` entry `crm_pipeline_stages.stage_key` (SA item per DE-2 SA-Q6) | Approve |
| **SA-Q6** | `crm_contacts.source_metadata`: allow-list `SOURCE_METADATA_KEYS` (§3.1), or exclude the column and rely on the four generated attribution columns? | Allow-list (subject to BC-4) |
| **SA-Q7** | Phase 1 ceiling in the legacy route: 413 on > 100,000 rows **or** > 4 MB body, no `DATA_EXPORTED` row on refusal (no `DATA_EXPORT_FAILED` name until DE-8a), client code `too_large` with generic copy until DE-9. Or should DE-4 state that DE-8b owns the ceiling entirely? | Build the 413 now: without it, a large account hits a Vercel crash instead of a message |
| **SA-Q8** | Order by `id` (UUID, SQ-A5) rather than `created_at`. Acceptable for the owner reading the file? | `id`; the README (DE-8b) says rows are not in date order |
| **SA-Q9** | `external_calendar_events` in the `client_records` group as processor, though it is the owner's own calendar? Or the `account` group (controller)? | `client_records` / processor: it is scheduling data we hold for the business |
| **SA-Q10** | The U-2 live-columns fixture: worth committing (documents the measured state, catches a hand edit) or redundant with `schema:reconcile`? | Commit it, small |
| **SA-Q11** | Reshaping exception: `clients.source_metadata` is the only DE-4 cell not returned as the DB holds it. Fine for DE-8b's CSV (JSON text in one cell)? | Yes |
| **SA-Q12** | Carry to DE-8b as a condition: the "Your files" manifest for `contact-documents` drops objects whose row is `deleted` or missing (F-7) | Yes |
| **SA-Q13** | `ExportGroupMetadata.controller` widens to `'AgentPilot' \| 'account_holder'`; the business name replaces `account_holder` in DE-8b | Yes |

---

## SA Review Notes

### SA workplan review DE-4 — 2026-10-15

**Reviewed by SA — 2026-10-15**
**Status:** ✅ Approved with conditions (C-1…C-12 below; no re-review needed if they are applied as written. Any change to a §3 column row beyond these comes back to SA)

#### User decisions 2026-10-15 (binding, recorded by SA)

| # | Decision | Effect on the workplan |
|---|---|---|
| BC-1 | Owner's private booking notes (`internal_notes`): **IN** | §3.7 as written |
| BC-2 | All history (cancelled / no-show / completed bookings; finished / cancelled tasks): **IN** | §3.4, §3.7 as written; no status filter anywhere except BC-3 |
| BC-3 | Archived documents **IN**; deleted (`status = 'deleted'`) **OUT** | §2.4 `rowFilter` as written |
| BC-4 | `source_metadata`: readable keys only, via allow-list: `capture_page_url`, `referrer_url`, `referrer_domain`, `capture_channel`, `device_type`, `capture_timestamp`, `utm_*`. `ip_hash`, `user_agent`, `session_id` **OUT** | **§3.1 list changes**, see C-3 |
| BC-5 | `external_calendar_events`: **OUT** (overrides the earlier SA default of in, and requirement SQ-E7) | **§2.3, §3.9, §4 change**, see C-1 |
| BC-6 | Reminder / intake "sent" markers: **OUT** | §3.7 as written (`intake_completed_at` and `intake_responses` stay in) |
| BC-7 | `ai_suggestions` on a service: **OUT** | §3.6 as written |

#### §3 column lists vs §10.1 (live, prod)

Checked every list against the T-0 Q1 output, column by column.

| Table | Live | Included + excluded | Result |
|---|---|---|---|
| `crm_contacts` | 19 | 18 + `user_id` | ✅ exact |
| `crm_activities` | 11 | 10 + 1 | ✅ exact |
| `crm_pipeline_stages` | 10 | 9 + 1 | ✅ exact |
| `crm_tasks` | 16 | 15 + 1 | ✅ exact (`created_by` is a source label `manual` / `ai_employee` / …, not a user id: fine) |
| `contact_documents` | 15 | 12 + 3 | ✅ exact |
| `scheduling_services` | 26 | 24 + 2 | ✅ exact |
| `scheduling_bookings` | 36 | 27 + 9 | ✅ exact (`cancelled_by` is `client` / `owner` / `system`: fine) |
| `scheduling_availability_exceptions` | 8 | 7 + 1 | ✅ exact |
| `external_calendar_events` | 11 | — | now table-level `exclude` (BC-5), no column list |

No phantom column, no unclassified live column. Deny-list re-checked against `SECRET_COLUMN_DENY_EXACT` / `_PATTERNS`: the only hit is `stage_key` (§3.10 is correct). Q6 cross-tenant integrity 0 on all five edges, so R-6 needs no action. Q5 (885 rows / ~200 kB largest owner) confirms the ceiling is a safety net, not a limit anyone hits.

#### Rulings on SA-Q1…SA-Q13

| # | Ruling |
|---|---|
| **SA-Q1** | **Approved: one descriptor-driven `BusinessDataExportRepository`.** This is a rule-7 granularity exception inside the repository layer, the same kind SA granted `BusinessPurgeRepository` (DEV-Q1), and it is granted on the bounds in C-5. Reason: DE-5/6/7 add ~30 tables; one tested place for the tenant filter, paging, row filter and ceiling is safer than eight copies (R-10). It is **read-only and export-only**: not a general reader, no other module may import it |
| **SA-Q2** | **Approved: `rowFilter` on the `include` descriptor.** Declarative, checked by `tableExportProblems`, readable by DE-8b's README. Purge stays blind to it. Condition C-6 on NULL semantics |
| **SA-Q3** | Approved: plain-word section ids (now eight, `calendar_busy_times` removed) |
| **SA-Q4** | Approved: `user_id` excluded with `OWNER_ID`; `plugin_connections` untouched (its section maps fields and does not write `user_id` anyway) |
| **SA-Q5** | **Approved: `DENY_EXCEPTIONS['crm_pipeline_stages.stage_key']`** with the §3.3 reason text. It is the stage's short name that `crm_contacts.stage` refers to; not a credential. U-3 must keep the stale-entry check green |
| **SA-Q6** | Allow-list approved, **but the key list is the user's BC-4 list, not §3.1's** (C-3) |
| **SA-Q7** | **Approved: build the 413 now, both caps.** F-4 is real: a direct JSON response over Vercel's 4.5 MB limit is a platform crash with no message, and DE-8b is several slices away. At pretty-printed JSON the **4 MB body cap is the binding limit in Phase 1** (100,000 rows cannot fit in 4 MB); the row ceiling stays because it is the shared §0.4.1 C constant DE-8b reuses and it bounds memory. No `DATA_EXPORTED` on refusal; no new audit name before DE-8a. Conditions C-8, C-9 |
| **SA-Q8** | Approved: order by `id` (SQ-A5). Keyset on a UUID PK is stable; date order is the README's job (DE-8b) |
| **SA-Q9** | **Moot** (BC-5: table out) |
| **SA-Q10** | Approved: commit the U-2 fixture, built verbatim from §10.1 Q1 for the eight included tables. It is small and catches a hand edit that `schema:reconcile` (report-only, not in CI) would not |
| **SA-Q11** | Approved: `source_metadata` is the one reshaped cell; JSON text in one CSV cell for DE-8b |
| **SA-Q12** | Approved: carried to DE-8b as a binding condition, recorded in requirement §0.7 under DE-8b (C-11): the "Your files" manifest drops objects whose `contact_documents` row is `deleted` or missing |
| **SA-Q13** | Approved: `controller: 'AgentPilot' \| 'account_holder'`; the business name replaces it in DE-8b |

#### Paging (F-3), including the existing DE-1 reads

- **DE-4 sections:** keyset on `id`, `PAGE_SIZE = 1000`, terminate on an **empty** page: approved. It is correct for any `max-rows`, which a short-page loop is not.
- **DE-1 reads do not need paging, and are not to be moved into the new repository in this slice.** `profiles` is `.eq('id', userId).maybeSingle()`: at most one row. `plugin_connections` is written by upsert `onConflict: 'user_id,plugin_key'`, so a user holds at most one row per plugin (tens, not 1,000): F-3 cannot bite. C-10 records this in a code comment so nobody "fixes" it later.

#### Cross-tenant test

U-6 is the right test (fake honouring `.eq` / `.gt` / `.not` / `.order` / `.limit`, A and B in every table, no B id anywhere in the serialised output) and its negative control (a fake ignoring `.eq('user_id')` must fail it) is mandatory. Approved with C-7.

#### Conditions (apply before / during implementation)

| # | Where | Condition | Priority |
|---|---|---|---|
| C-1 | §1.1, §2.3, §3.9, §4, §5, §6, §8, U-1, U-6, C-1, R-9 | **BC-5:** `external_calendar_events` → `export: exclude('user 2026-10-15: synced copy of the owner\'s own external calendar, not Business OS data')` (exact reason text; inline, not a named `EXPORT_REASON`). Remove section `calendar_busy_times`. Counts become **8 include + 1 exclude**, **8 new section ids**, registry 3 + 8, C-1 re-pin **10** table reads, 8 new `section_counts` keys. Drop the `external_calendar_events.title` row from §4. `level`, `order`, `scope`, `snapshot`, notes unchanged (G-2 baseline must stay green) | High |
| C-2 | T-10 | Update requirement **§0.3.1 and SQ-E7** (`external_calendar_events` in → out, user 2026-10-15), the B2 row of the group table, and record BC-1…BC-7 as decided. Always-update-the-main-requirement rule | High |
| C-3 | §3.1, U-7 | `SOURCE_METADATA_KEYS` = exactly `capture_page_url`, `referrer_url`, `referrer_domain`, `capture_channel`, `device_type`, `capture_timestamp`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`. Explicit names, **no `utm_` prefix match** (an allow-list must not grow by pattern). `page_type`, `smart_link_code`, `smart_link_name` are **not** on the user's list and leave it (none is present in live data per Q4, so nothing is lost today). String values only, as written. U-7 NC adds `smart_link_id` and a `utm_evil` key, both dropped | High |
| C-4 | §2.1 | Prefer `listOwnedRowsForExport(sectionId, …)` resolving the descriptor **by `export.section`**, so no table-name literal lives in `sections.ts`. If Dev keeps `table` on the section definition (for DE-8b's CSV header), a test asserts the registry's `table` ↔ descriptor `export.section` mapping is a bijection over every include descriptor | Medium |
| C-5 | `BusinessDataExportRepository.ts` header + a test | Write the exception's bounds in the file header (as `BusinessPurgeRepository` B-1…B-4 does): **E-1** read-only (no insert/update/upsert/delete/rpc); **E-2** accepts only `include` + `scope.kind === 'user_id'` descriptors, fails closed otherwise with no query; **E-3** select string only from `exportColumnsOf()` (deny check at call time), never `*`; **E-4** first filter `.eq('user_id', userId)`, `userId` only ever the session id; **E-5** service role, both reasons documented (DE-1 SA C-2 / DE-0b); **E-6** sole importer is `lib/business-os/data-export/sections.ts`. Add a cheap Jest scan for E-1 and E-6 (no DB, ms) | High |
| C-6 | §2.4, U-4, T-0 | `NOT IN` drops NULL rows silently in SQL. `tableExportProblems` (or U-2 against the fixture) must assert the `rowFilter` column is **NOT NULL** live; record `contact_documents.status` `is_nullable = NO` from the Q1 output already run (add it to §10.1). Build the PostgREST value list with proper quoting (`.not('status', 'in', '("deleted")')`), pinned in U-5 | Medium |
| C-7 | U-6 | The fake client must also exercise the row filter (A has a `deleted` and an `archived` document; only the archived one is returned) and the paging (A has > `PAGE_SIZE` rows in one table in at least one case, or `PAGE_SIZE` is injectable for the test). The route-level test keeps the planted `?userId=` and `x-user-id` checks (U-9) | High |
| C-8 | §2.2 repository loop | Defensive: if a page's last `id` is not strictly greater than the previous `lastId`, return `{ error }` (fail the section) instead of looping. Pair with R-8's hard call cap in the characterization mock | Medium |
| C-9 | §2.6 route | Measure the **exact bytes that will be sent** (`Buffer.byteLength` of the same serialised string the response uses, pretty-print included), not a re-serialisation. The 413 body carries no counts or internals (counts go to the warn log only). Keep `no-store` on the 413 | Medium |
| C-10 | `PluginConnectionRepository.listForUserDataExport` | One-line comment only: bounded by the `(user_id, plugin_key)` upsert key, so the 1,000-row cut cannot apply. No behaviour change, no re-pin | Low |
| C-11 | Requirement §0.7 DE-8b | Record SA-Q12 (manifest drops objects for `deleted` / missing rows) and that the 4 MB body cap is removed when DE-8b's signed-URL zip replaces the direct JSON response | Medium |
| C-12 | T-8, §9 | Record Jest runtime; must not add to the critical path (no-added-CI-time). No new job, no DB in CI, no `typecheck:bos-llm` widening, as planned | Low |

#### Optimisation suggestions (non-blocking)

- Effort drops slightly with one table fewer; ~2 d still fine.
- `413` is acceptable as a stable code here (`code: 'export_too_large'` is what the client keys on); do not let the client key on the status alone.
- Pretty-printing roughly doubles the body. Not worth changing in DE-4 (it would re-pin the file format); DE-8b's zip makes it moot.

#### Not SA decisions (for the user, via TL)

- **Smart-link names (optional).** If a client came through one of your share links, we also store that link's name and short code. Your list did not mention them, so they stay out. No current client has them. Say if you want them in.
- **Reminder already accepted:** once DE-4 merges, the existing "Export data" button includes your clients' details (third-party personal data). That was decided in §0.4; no new decision needed.

#### Approval

[x] Workplan approved: proceed to implementation, with C-1…C-12 applied

---

## Dev Implementation Notes (2026-10-15)

On `feature/data-export-de4`, origin/main merged in first (`50d26e78`, merge not rebase). Nothing committed. No migration, no new route, no dependency, no flag, no entitlements import, no tier literal.

### Conditions applied

| # | How |
|---|---|
| C-1 | `external_calendar_events` → `exclude("user 2026-10-15: synced copy of the owner's own external calendar, not Business OS data")`, inline. 8 include + 1 exclude, 8 section ids, registry 3 + 8, characterization re-pin 10 tables, 8 new `section_counts` keys. `level` / `order` / `scope` / `snapshot` / notes untouched (purge baseline + invariant suite green) |
| C-2 | Requirement: §0.7 added; superseding notes (insert-only) under the §0.3.1 table (SQ-E7 row), the §3.1 groups table (B2 row) and §9.2 SQ-E7; status line; Change History row |
| C-3 | `SOURCE_METADATA_KEYS` = exactly the 11 BC-4 keys, named; no prefix match. NC drops `smart_link_id`, `utm_evil`, `page_type`, `smart_link_code`, `smart_link_name`, tracking keys, nested / array / number values |
| C-4 | The repository takes a **section id** and resolves the descriptor by `export.section` (`exportDescriptorOfSection`, pure, in `classification.ts`). No table literal in `sections.ts`; **no `table` field on the section definition** (DE-8b takes the header from `exportColumnsOf(exportDescriptorOfSection(id).table)`). The existing `sectionRegistryProblems` already asserts one include per section |
| C-5 | E-1…E-6 in the repository header. Jest: E-1 code-only scan for `.insert/.update/.upsert/.delete/.rpc(` + NCs; E-6 `git grep` for importers (only `sections.ts` and tests) + NC; not in `lib/repositories/index.ts` |
| C-6 | `rowFilterInList` quotes values: `.not('status', 'in', '("deleted")')`, values limited to `[A-Za-z0-9_]+`. `rowFilterNullabilityProblems(liveColumns)` (pure) flags a filter column not `is_nullable = 'NO'`; run against the U-2 fixture + NCs. **See SA item 2** for where the NOT NULL fact comes from |
| C-7 | U-6 fake honours eq / gt / not / order / limit; A and B in all eight tables + `profiles` + `plugin_connections`; A has 1,003 activities (real PAGE_SIZE paging, 2 data pages + the empty one) and an active / archived / deleted document; whole registry run for A; NC fake ignoring `.eq('user_id')` shows the leak. Route-level planted `?userId=` / `x-user-id` kept (U-9) |
| C-8 | A page whose last id is not strictly after the previous page's fails the section (`{ error }`); unit test with a stuck client; the characterization mock has a 100-call cap |
| C-9 | `Buffer.byteLength` of the same `JSON.stringify(payload, null, 2)` string that is sent; 413 body has no counts; `no-store` on the 413; counts in the warn line only |
| C-10 | Comment on `PluginConnectionRepository.listForUserDataExport`, no behaviour change |
| C-11 | Requirement §0.7 "Notes for DE-8b" |
| C-12 | Runtimes below. No new job, no DB in CI, `typecheck:bos-llm` not widened |

### Deviations from the workplan text (none touch a §3 column row)

| # | Workplan said | Built | Why |
|---|---|---|---|
| D-1 | `listOwnedRowsForExport(table, …)`; `table?: string` on `ExportSectionDefinition` (§2.1, §2.5) | `listOwnedRowsForExport(sectionId, …)`; no `table` on the definition | SA C-4's preferred option |
| D-2 | U-6 in `BusinessDataExportRepository.test.ts` | Same file (U-5, U-6 and the C-5 scans together) | One fake shared by U-5 and U-6 |
| D-3 | U-2 fixture "a small literal" | `lib/business-os/data-export/__tests__/fixtures/de4-live-columns.json` | Jest's `testMatch` treats every `.ts` under `__tests__/` as a suite; a `.ts` fixture there fails as an empty suite. Verified verbatim against §10.1 by script |
| D-4 | `runExportSections` returns `{ sections, overCeiling }` | `{ overCeiling: false, sections } \| { overCeiling: true, sections, atSection }` | `atSection` goes to the warn log (counts / ids only) |
| D-5 | The repository returns `overCeiling: true` | Also returns **no rows** when over | A partial section can never be written by mistake |
| D-6 | Warn log "`data_export_over_ceiling`" | Message `Data export refused: over the Phase 1 ceiling`, field `event: 'data_export_over_ceiling'`, `limit: 'rows' \| 'body'` | Matches the route's sentence-style messages; the event name stays greppable |
| D-7 | Client maps "413 → `too_large`" | `too_large` only when the 413 body carries `code: 'export_too_large'`; otherwise `server_error` | SA optimisation note: do not key on the status alone |
| D-8 | — | `SchemaReconciler.test.ts` "drift is computed for the two included tables" now derives the included set (10 tables, pinned) | It hard-coded the DE-2 pair; DE-4 makes it ten |
| D-9 | — | `route.test.ts` mock: per-query chain (it accumulated every query's filters on a table), honours select / gt / order / limit, strips quotes in `in` lists | A paged reader issues several queries per table; the shared chain made a second request see the first's `.gt` |

### Exact column lists declared (for TL's read-only drift check)

Select order. Every other live column of the table is in `excludedColumns` with a reason; `user_id` is excluded on all eight (`OWNER_ID`).

| Table | `columns` (selected) | `excludedColumns` |
|---|---|---|
| `crm_pipeline_stages` | id, vertical, stage_key, stage_label, position, color, stage_type, is_primary_client_stage, created_at | user_id |
| `crm_contacts` | id, first_name, last_name, email, phone, stage, stage_entered_at, tags, custom_fields, notes, source, source_metadata, referrer_domain, utm_source, utm_medium, utm_campaign, created_at, updated_at | user_id |
| `crm_activities` | id, contact_id, activity_type, title, description, activity_date, auto_logged, source_capability, source_entity_id, created_at | user_id |
| `crm_tasks` | id, contact_id, title, description, priority, status, due_date, reminder_at, completed_at, created_by, source_entity_type, source_entity_id, tags, created_at, updated_at | user_id |
| `contact_documents` | id, contact_id, name, document_type, file_name, file_size, mime_type, description, tags, status, created_at, updated_at | user_id, storage_path, storage_bucket. `rowFilter`: status not in ("deleted") |
| `scheduling_services` | id, service_name, description, duration_minutes, price, currency, buffer_minutes, max_bookings_per_day, advance_booking_days, min_notice_hours, availability, is_active, status, is_scheduled, collection, sale_mode, payment_type, installment_count, installment_frequency, first_payment_due, first_payment_days, source, created_at, updated_at | user_id, ai_suggestions |
| `scheduling_bookings` | id, service_id, contact_id, parent_booking_id, occurrence_number, start_time, end_time, timezone, status, cancellation_reason, cancel_reason, cancel_note, cancelled_by, booking_source, notes, internal_notes, payment_status, payment_method, payment_amount, payment_currency, payment_id, invoice_id, payment_plan_id, intake_responses, intake_completed_at, created_at, updated_at | user_id, reminder_24hr_sent, reminder_2hr_sent, intake_sent_at, intake_reminded_at, external_calendar_event_id, calendar_sync_provider, calendar_synced_at, calendar_sync_error |
| `scheduling_availability_exceptions` | id, exception_type, start_date, end_date, custom_hours, reason, created_at | user_id |
| `external_calendar_events` | — (table `exclude`, BC-5) | — |

**T-9 not run by Dev:** the worktree has no `.env.local`, so `npm run schema:reconcile` cannot reach the DB. TL to run it, or the read-only SQL equivalent: for each table above, (live columns) minus (columns ∪ excludedColumns) = ∅ (drift) and (columns) minus (live columns) = ∅ (missing), plus `contact_documents.status` `is_nullable = 'NO'`.

### Runtimes (C-12, this Windows box under parallel load; Linux CI is faster)

| Run | Result | Wall |
|---|---|---|
| `lib/repositories/__tests__/BusinessDataExportRepository.test.ts` (new) | 33 passed | ~6–9 s suite; of which the E-6 `git grep` test 1–5 s here (one `git grep` call, ms on Linux) and U-6 ~0.2 s |
| `exportClassification.test.ts` / `sections.test.ts` / route + characterization / client / `SchemaReconciler.test.ts` (edited) | 76 / 25 / 19 + 41 / 9 / 31 passed | 4–14 s each, mostly ts-jest transform; DE-4 tests ≤ 0.3 s each |
| `npx jest lib/business-os/data-export lib/business-os/purge lib/client/__tests__/downloadUserDataExport.test.ts` | 19 suites, 474 passed | 54 s |
| `npm run test:bos-entitlements` | 272 suites, 8,133 passed | 2 min 44 s |
| `npm run test:authz-guard` | 2 suites, 203 passed | 1 min 46 s |
| `tsc --noEmit` (whole project) | 0 errors in any touched file (the project has 1,854 pre-existing errors elsewhere) | ~6 min |
| `eslint` on every touched file | clean | — |

All in the existing Jest gate; no new job, no new script.

### Items for SA (code review)

1. **E-6 scan uses `git grep --untracked`** (precedent: the tailwind and security-definer guards shell out to git). Walking and reading ~4,000 files took ~2.5 s here; `git grep` is one process. Either is fine off the critical path; say if you prefer the fs walk.
2. **C-6 NOT NULL source.** TL's §10.1 summary does not print `is_nullable`. The fixture records `contact_documents.status` `is_nullable: 'NO'` from the create migration (`20260722_create_contact_documents.sql` line 30, `NOT NULL DEFAULT 'active'`). **TL: please confirm from the Q1 output already run** and add the value to §10.1. The check (`rowFilterNullabilityProblems`) runs against the fixture only; it is not wired into `SchemaReconciler` (that would change the purge engine's report shape, outside the conditions). Say if you want it there.
3. **String order as uuid order** (C-8 check): the repository compares the page's last id as a string. Valid because PostgREST returns lowercase canonical uuid text; all eight `id` columns are `UUID` (migrations). If they ever disagreed the section fails closed, it cannot leak. Comment in code.
4. **Account sections count toward the row ceiling** (they ignore their budget but their rows are added). Matches "100,000 rows across sections".
5. **New `ExportClassificationErrorCode`s**: `unknown_section`, `not_user_scoped`, `invalid_row_filter`.
6. `Last Updated` of the requirement was already 2026-10-15; unchanged.
7. `scratchpad/de4dev/` holds Dev's scratch scripts (untracked, not for commit); RM must not stage it.

### SA code review DE-4 — 2026-10-15

**Code Review by SA — 2026-10-15**
**Status:** ✅ Code Approved for QA, with two small fixes to make before commit (F-1, F-2; no re-review needed if they are applied as written)

Reviewed: the full diff on `feature/data-export-de4` (origin/main `50d26e78` + changes) and the untracked files. Re-ran `npx jest` over the repository test, `app/api/user/data-export`, `lib/business-os/data-export`, the client helper test and `SchemaReconciler.test.ts`: **7 suites, 234 passed, ~60 s wall on this Windows box** (mostly ts-jest transform).

#### Focus areas

| Area | Result |
|---|---|
| Tenant isolation | ✅ The only id is `getUser().id` → `ctx.userId` → `listOwnedRowsForExport(sectionId, ctx.userId, …)`. The route takes no input (planted `?userId=` / `x-user-id` test, U-9). Zod (`ReadInputSchema`) runs before the descriptor lookup. The first filter is always `.eq('user_id', …)`, pinned per query in U-5, U-6 and C-1. There is no find-by-id. E-2 resolves the descriptor **by section** and refuses non-`include` and `via`; the NCs show no query is issued. E-1…E-6 are in the header. The E-1 scan works on code only and has NCs. E-6: `sections.ts` is the sole importer (I checked by grep too) and the repository is not in `index.ts`. U-6 seeds A and B in all eight tables plus profiles and plugin_connections, runs the whole registry, and its ignore-`eq` NC shows the leak |
| Keyset paging | ✅ `order('id').limit(PAGE_SIZE)`, then `.gt('id', lastId)`. The loop ends on an **empty** page: the 500-row `max-rows` NC still gets all 1,200 rows. C-8: when a page's last id is not a string, or not strictly greater than the previous one, the section fails closed (stuck-client test, 2 queries, no loop). SA item 3 (comparing uuids as strings) is accepted. PostgREST returns canonical lowercase uuid text, and its byte order is the string order. If they ever disagreed the section would fail; it could not leak or loop |
| rowFilter | ✅ Only `contact_documents` has one: `.not('status', 'in', '("deleted")')`. Values are limited to `[A-Za-z0-9_]+` (malformed value → no query). `rowFilterNullabilityProblems` fails closed on unknown nullability, and the fixture plus §10.2 confirm `status` is `is_nullable = NO` live. SA item 2: keeping it out of `SchemaReconciler` is accepted. Wiring it in would change the purge report shape, which is not worth it for one filter |
| 413 path | ✅ `Buffer.byteLength` of the same `body` string that is sent (C-9). The "exactly at the cap is sent" case pins `>`. The 413 body is the pinned sentence plus `code`, with no counts, `no-store`, no `Content-Disposition`, no `logAndFlush`. The warn log carries ids and counts only (exact key set pinned). The rows path returns before the payload is built. D-5 (over the ceiling ⇒ no rows) means a partial section cannot be written. SA item 4 (account rows count toward the ceiling) is accepted: it matches "100,000 rows across sections" |
| BC-4 allow-list | ✅ Exactly 11 keys, named one by one; the test pins the full list. Matching uses `hasOwnProperty` against named keys, with no prefix match. NCs drop `utm_evil`, `page_type`, `smart_link_*`, `ip_hash`, `session_id`, `user_agent`, `access_token`, nested values, arrays and numbers. The C-1 and route tests show the tracking values never reach the body |
| BC-5 | ✅ `external_calendar_events` is `exclude("user 2026-10-15: synced copy of the owner's own external calendar, not Business OS data")`, inline, with the exact text pinned plus a reworded-reason NC. The table is never read (C-1 `REMOVED_TABLES`, route test). `level` / `order` / `scope` / `snapshot` / notes are unchanged |
| Deny exception | ✅ `DENY_EXCEPTIONS` keys are pinned to exactly `plugin_connections.plugin_key` and `crm_pipeline_stages.stage_key`. The stale-entry check is green. The NC without the entry flags it |
| No error text in file / audit | ✅ Failed sections are `{ status: 'failed', row_count: 0, rows: [] }`. `boom` / `secret` absent from the body and audit (C-1, U-7) |
| Characterization re-pin | ✅ Header lists the re-pin. Every changed expectation carries `DE-4:`. 10 tables, 8 literal selects byte for byte, page chains incl. the empty page, a 3-page case, the 100-call cap (R-8), 8 new `section_counts` / `data_categories` keys |
| E-6 via `git grep --untracked` (SA item 1) | ✅ Accepted. It is one process, it respects `.gitignore`, `.claude` and `node_modules` are excluded, it has a non-vacuity assertion and a planted-importer NC. Precedent: the tailwind and security-definer guards |
| D-9 route.test mock | ✅ with a note (F-4). The per-query chain is right: a shared chain would leak page 1's `.gt` into page 2. Honouring `select` does make the route.test DE-0a token check blind to **unselected** token columns (`access_token`, `refresh_token`, `credentials`, `settings`, `expires_at` are dropped by the mock before the mapper sees them). Across the two suites, coverage is **not** weaker. The characterization mock still returns raw rows that carry `access_token: 'never-exported'` and a token inside `profile_data`, and asserts `never-exported` is absent (line ~535). `exportColumnsOf` refuses a deny-listed column at call time. The `profile_data` token cases in route.test still run, because `profile_data` is selected |
| D-1…D-8, item 5 | ✅ All accepted. D-1 is C-4's preferred option, and `exportDescriptorOfSection` has the one-match NC. D-3: the `.json` fixture is correct, since a `.ts` file under `__tests__/` would run as an empty suite. D-7 keys on `code`, not the status alone. The new error codes (item 5) are fine |
| Standards | ✅ Pino only (`createLogger({ service })`, `{ err }`, no row content, pinned by test). No `console.*` in any touched file. No `any`. `RepositoryResult`, client injection and the singleton follow `new-repository`. No entitlements import. No migration, route, dependency or flag. No added CI time: all of it sits in the existing Jest gate, which is off the Build critical path |

#### Code Review Comments

1. `lib/repositories/__tests__/BusinessDataExportRepository.test.ts:471`: `out.split(…)` holds a **literal NUL byte** in the source (the only NUL in the diff, checked byte by byte). Git classes the file as text today only because the byte falls after the first 8,000 bytes. Grep, editors and diff viewers may treat the file as binary, and a later edit that moves it up would make git do the same. **Fix: write it as the escape `'\0'`.** Priority: **Medium** (F-1, fix before commit)
2. `lib/repositories/BusinessDataExportRepository.ts:30`: the E-5 comment points at `BusinessDataExportRepository.tenancy.test.ts`, which does not exist (D-2 merged U-6 into `BusinessDataExportRepository.test.ts`). **Fix the file name.** Priority: **Low** (F-2, fix before commit)
3. `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` §0.7 / Change History still says "`schema:reconcile` owed before merge". T-9 was done by TL's read-only SQL (§10.2: drift 0, missing 0, `status` NOT NULL). RM or Dev should splice that in when recording the PR (always-update-the-main-requirement rule). Priority: **Low** (F-3)
4. `app/api/user/data-export/__tests__/route.test.ts`, DE-0a: optionally add one line saying that, with the mock honouring `select`, the raw-row token check lives in `route.characterization.test.ts`. That way nobody later "simplifies" the characterization mock into a projecting one and loses it. Priority: **Low** (F-4, non-blocking)

#### Optimisation Suggestions

- `sourceMetadata(null)` writes `{}`, so the file no longer separates "no metadata" from "metadata with no readable keys". This is harmless for the owner and keeps the CSV cell shape uniform. If DE-8b wants the distinction, keep `null` for a `null` input.
- The `MOCK_PAGED_TABLES` set in the characterization test duplicates the include list. It is fine as a literal pin; DE-5 will extend it.

#### Code Approved for QA: **Yes** (F-1 and F-2 before commit; F-3 at PR time; F-4 optional)

---

## QA Testing Report

_QA populates this section._

### QA — DE-4 — 2026-10-15

**Test mode:** full
**Strategy used:** A + B (Jest, mocked and in-memory Supabase fakes). The slice is a read path plus a refusal path, with no UI change and no DB write, so Jest covers it. Option D (browser) is owed by the user after deploy (below).
**Focus:** api, security, schema, performance
**Skipped:** the live DB check (step 5). This QA session had no Supabase MCP. TL's read-only §10.1 / §10.2 results stand: drift 0, missing 0, `contact_documents.status` NOT NULL.
**Input source:** TL prompt keywords

#### Method

- **Worktree untouched.** `git diff --numstat` was identical before and after QA. No stash, no commit.
- **Scratch copies.** Every plant and the full-suite runs used scratch copies (git-archive `HEAD` plus the 20 changed and new files) in QA's own `scratchpad/de4qa/`. The `node_modules` junctions there are removed with `rmdir` only.
- **Session interrupted.** The run was interrupted once. On resume, the scratch copies were rebuilt from scratch, so no planted state carried over. After the NC run, the NC copy matched the worktree byte for byte, and the planted importer was deleted.
- **No `.github` change.**

#### Test Coverage

| Acceptance criterion / condition | Tested? | Result | Notes |
|---|---|---|---|
| 8 tables `include`, column lists per §3 / BC-1…BC-7, `external_calendar_events` `exclude` (BC-5) | ✅ | Pass | U-1 pins. NC e1, f1 and f2 turn it red |
| Tenant isolation: session id only, `.eq('user_id')` first, no caller-supplied id | ✅ | Pass | U-5, U-6, U-9. NC a1 and b1 turn it red |
| Soft-deleted documents out, archived in (BC-3, C-6) | ✅ | Pass | NC c1 turns it red. A QA edge test runs it through the whole registry |
| `source_metadata` allow-list, exactly the 11 BC-4 keys, no prefix (C-3) | ✅ | Pass | NC d1–d4 and j1 turn it red |
| Paging to the end, keyset on `id`, ends on an empty page; non-advancing page fails (C-8) | ✅ | Pass | NC g1: the section fails, with no loop or hang |
| Ceiling: rows over 100,000 or body over 4 MB → 413 `export_too_large`, no file, no `DATA_EXPORTED`, `no-store`, counts-only warn | ✅ | Pass | NC h1–h6 turn it red |
| E-1 read-only, E-6 sole importer (C-5) | ✅ | Pass | NC i1 (planted importer) and i2 (re-export from `index.ts`) turn it red |
| Token-free export | ✅ | Pass | NC j2 (`access_token` mapped into `plugin_connections`) and j3 (raw `source_metadata`) turn it red |
| Client `too_large` only when the body code is `export_too_large` (D-7) | ✅ | Pass | Client test, including the 413-without-code and unreadable-body NCs |
| Purge invariants and the entitlements registry unaffected | ✅ | Pass | `test:bos-entitlements` green, including the purge invariant suite |
| Manual browser check (§8 Manual QA) | ⬜ | Owed | By the user after deploy (below) |

#### Step 1: targeted suites and guards (on the worktree)

| Run | Result | Wall |
|---|---|---|
| `npx jest --ci` repository test + `lib/business-os/data-export` + `lib/business-os/purge` + `lib/client` + `app/api/user/data-export` | **25 suites, 580 passed, 0 failed** | 53.9 s Jest (77 s wall) |
| `npm run test:bos-entitlements` | **272 suites, 8,133 passed** | 274.7 s Jest (5 min 05 s wall) |
| `npm run test:authz-guard` | **2 suites, 203 passed** | 138.2 s Jest (2 min 49 s wall) |

The targeted run printed one Jest notice: "A worker process has failed to exit gracefully". No suite failed. These runtimes are from a Windows box under parallel load, and all of them sit in the existing Jest gate.

#### Step 2: full `npx jest --ci`, DE-4 against a baseline of `HEAD` (`50d26e78`, git archive)

| | Suites failed / total | Tests failed / total | Wall |
|---|---|---|---|
| DE-4 copy | 21 / 1,413 | 140 / 34,941 | 20 min 23 s |
| Baseline | 19 / 1,412 | 138 / 34,842 | 12 min 55 s |

**19 suites fail in both** with identical failing assertions. They are the known list (`finance.source.guard` CRLF, `oneAddressPolicy.guard`, `publicEndpointsAreThrottled.guard`, `bookingsSearchAndPaging.guard`, `supabaseFetch`, `tailwind-css-escape.guard` and `security-definer-surface.guard`, which need a git checkout the export lacks) plus the old v4/v6/pilot/orchestration/pricing-research suites.

Two failures appear only in the DE-4 copy. **Neither is caused by DE-4:**
1. **E-6 in `BusinessDataExportRepository.test.ts`.** `git grep` fails with "not a git repository" because a git-archive copy has no `.git`. It passes in the real worktree and in the git-initialised NC copy. CI checks out with git.
2. **`app/admin/archiving/__tests__/page.render.test.tsx` (P-3 dropdown).** This is a timing flake under load. Run alone it passes: 56 / 56 on the DE-4 copy and again on a second copy.

**New failures attributable to DE-4: 0.**

#### Step 3: negative controls (each planted in the scratch copy, then restored)

**21 of 21 turned red.** The table gives the number of failing tests in each targeted run.

| # | Plant | Red tests |
|---|---|---|
| a1 | Drop `.eq('user_id', …)` from the repository | 19 (U-6, U-9 planted id, C-1 chains). The built-in U-6 NC (fake ignores `.eq`) also shows the leak |
| b1 | `ctx.userId` taken from `?userId=` / `x-user-id` | 1 (U-9 planted-id test) |
| c1 | Remove the `contact_documents` rowFilter | 7 (route, characterization, U-4) |
| d1 / d2 / d3 | Add `ip_hash` / `user_agent` / `session_id` to the allow-list | 5 / 5 / 5 |
| d4 | `utm_` prefix match | 1 (`utm_evil` NC) |
| e1 | `external_calendar_events` flipped to `include` | 10 (registry ↔ descriptor, U-1) |
| f1 | `ai_suggestions` included | 4 |
| f2 | `reminder_24hr_sent` included | 4 |
| g1 | C-8 non-advancing check removed | 1 (C-8 test fails, with no hang) |
| h1 | Row-ceiling refusal disabled | 1 |
| h2 | Body-cap refusal disabled | 1 |
| h3 | 413 without `no-store` | 2 |
| h4 | 413 body carries a count | 2 |
| h5 | Runner keeps reading past the ceiling | 3 |
| h6 | Repository returns partial rows when over the ceiling | 1 |
| i1 | Planted importer `lib/services/PlantedExportImporter.ts` | 1 (E-6) |
| i2 | Re-export from `lib/repositories/index.ts` | 1 (E-6) |
| j1 | `access_token` added to the allow-list | 2 |
| j2 | `access_token` mapped into `plugin_connections` rows | 12 (characterization token-free check) |
| j3 | `clients` written without the `source_metadata` mapper | 4 |

#### Step 4: edge cases

The existing tests cover these: zero rows (U-5), paging past one page (U-6 with 1,003 rows; U-5 with 500-row pages), cancelled and no-show bookings (U-5, C-1), `internal_notes` (U-1, C-1), and `too_large` only when the code is present (client test).

QA also added a scratch-only test, deleted after the run: **5 / 5 passed.**
- **Owner with zero client records, while tenant B has rows:** all 8 sections `ok` with 0 rows.
- **A table larger than one page:** 2,500 contacts with `max-rows` 1000 return all 2,500, none duplicated, in id order, in 4 queries.
- **Bookings:** cancelled, no-show and completed bookings are present, with `internal_notes`. No reminder marker appears.
- **Documents, through the whole registry:** the archived document is present, the deleted one is absent, and no `storage_path` appears.
- **The real default ceiling:** 100,001 activities give `overCeiling` at `client_activities`. No rows are returned and later sections are not read (104 queries). It took 73 s, all in the in-memory fake's per-page sort, not in the repository.

#### Issues Found

##### Bugs (must fix before commit)

None new. SA F-1 (the literal NUL byte at `BusinessDataExportRepository.test.ts:471`) and SA F-2 (the comment naming the non-existent `…tenancy.test.ts`) are confirmed by QA and are still open. Fix them as SA wrote.

##### Performance Issues (should fix)

None. The largest live account is 885 rows (~200 kB), about 1 page per section.

##### Edge Cases (nice to fix)

1. **The over-ceiling copy is wrong today (Low; DE-9 owns it).** A `too_large` result shows the callers' generic "Failed to export data. Please try again." Retrying cannot help. There are **four** callers, not three: `app/business-os/settings/page.tsx`, `DangerZonePanel.tsx`, `SecurityTab.tsx` and `SecurityTabV2.tsx`.
2. **Rows are read before the body cap applies (Low, informational).** An account over the 4 MB body but under 100,000 rows reads every page before it is refused. This is safe and DE-8b removes it.
3. **E-6 depends on a git checkout (Low, informational).** It errors in a non-git copy. CI is unaffected.

#### Final Status

- [x] All acceptance criteria pass in Jest, with 0 new failures attributable to DE-4. Ready for commit **once SA F-1 and F-2 are applied**. The user's manual check follows deploy.
- [ ] Issues found — Dev must address before commit

**Manual check owed by the user (Business OS, after deploy):**
1. Signed in as an owner with clients, press "Export data" (Settings). The file has the 8 new client-record sections. A deleted document is absent and an archived one present. Cancelled bookings are there. No `ip_hash`, `user_agent` or `session_id` appears anywhere.
2. Signed out (or with an expired session), the export shows an error and nothing downloads.

## Post-review changes — 2026-10-15

**Dev, after SA code review and QA.** Uncommitted on `feature/data-export-de4`. Needs an SA **delta review** (B-1 and B-2 change behaviour; A is as SA wrote).

### A. SA fixes

| # | Fix | Where |
|---|---|---|
| F-1 ✅ | The literal NUL byte in `out.split(…)` is now the escape `'\0'`. A byte scan of every changed and untracked file finds **no NUL** | `lib/repositories/__tests__/BusinessDataExportRepository.test.ts:471` |
| F-2 ✅ | E-5 comment names `BusinessDataExportRepository.test.ts` (was the non-existent `…tenancy.test.ts`) | `lib/repositories/BusinessDataExportRepository.ts:30` |
| F-3 ✅ | Requirement §0.7: dated "T-9 done" note (TL's read-only SQL, §10.2: drift 0, missing 0, `contact_documents.status` NOT NULL) + Change History row. Insert-only: the original "owed before merge" sentence stays, the note below it closes it | requirement §0.7 |
| F-4 ✅ | One comment in route.test's DE-0a describe: with the mock honouring `select`, the raw-row token check lives in `route.characterization.test.ts`; keep that mock raw | `app/api/user/data-export/__tests__/route.test.ts` |

### B. User decisions 2026-10-15 (binding)

**B-1 Time in the file name.** `agentpilot-data-export-YYYY-MM-DD-HHmm.json`.
- `exportFileName(now, timezone)` (`payload.ts`) formats the one `exportedAt` instant with `toBusinessLocalInput` (`lib/scheduling/businessTime.ts`, already the platform's wall-clock helper; it applies `safeTimezone`, midnight is `00`). `export_date` and the audit `export_timestamp` are the same instant, in UTC, unchanged.
- The route reads the owner's zone through the existing `UserPreferencesRepository.findTimezone(user.id)` (`select('timezone')`, `.eq('user_id', session id)`, `maybeSingle`), after the sections and only when the export is not refused. NULL / blank / invalid → `safeTimezone` → `FALLBACK_TIMEZONE` (`'UTC'`). A read error, or a throw, → UTC plus one `warn` (`{ userId }` only, "Data export: timezone unreadable, file name in UTC"); never a 500, never a failed section.
- Tests: Asia/Jerusalem vs UTC across midnight (unit + route), winter offset, `0000` midnight, America/New_York the other way, NULL, blank, invalid zone, no argument, read error (route: 200, UTC name, unchanged body, warn line), the chain pin, and a negative control.

**B-2 Connected apps dropped.** `plugin_connections` descriptor `export` → `exclude("user 2026-10-15: connected apps dropped from the export (business data only); see lawyer note §0.2 DX-1")`; its purge notes no longer describe the export (level, order, scope, snapshot unchanged; purge baseline green).
- Removed: the `plugin_connections` section and `PluginConnectionExportItem` (`sections.ts`), the `ExportSectionId` member, the `accountProfile` / `ACCOUNT_PROFILE_KEYS` allow-list (its only user was that reader), the `plugin_connections.plugin_key` `DENY_EXCEPTIONS` entry (the stale-entry check would flag it), `PLUGIN_CONNECTIONS_EXPORT` (`descriptors.ts`), and the dead `PluginConnectionRepository.listForUserDataExport` + `PluginConnectionExportRow` + its `exportColumnsOf` import (0 / 47 numstat, the one planned deletion-only file), with their cases in `userDataExportReads.test.ts`. A new guard there asserts the method stays gone.
- Kept and as strong: the DE-0a "no tokens in the file" tests. The characterization seed still puts raw, unprojected token-bearing rows (`access_token`, `refresh_token`, `credentials`, `settings`, a token in `profile_data`) in `plugin_connections`; `plugin_connections` is in `REMOVED_TABLES` (never read on either client) and `never-exported` plus the connection keys are asserted absent from the body. route.test's DE-0a case asserts the table is never read and no token, key or connection field appears in the body, the audit entry or the logs. The DE-0b browser guard (`pluginConnectionsBrowserAccess.guard.test.ts`) is untouched and green.
- Re-pins, each with a `DE-4 (user 2026-10-15):` comment: registry 2 account + 8 client_records; account rows toward the ceiling 2 (was 3), so the U-8 ceiling cases move by one; audit `section_counts` / `data_categories` lose `plugin_connections`; the "failed section" cases are driven through `profiles` / `user_profile`; read order gains `service:user_preferences` last; `SchemaReconciler.test.ts` included list is 9.
- **Totals (measured, `scratchpad/de4dev/count.ts`):** 155 descriptors = **9 include** (was 10) + 36 planned + **110 exclude** (was 109).
- Requirement (insert-only): §0.2 DX-1 lawyer note extended to name connected apps; §0.7 DE4-U1 / DE4-U2 table and the new totals; Change History rows. Also TL's insert: user manual check DE-1 PASS and UI-1 folded into DE-9 (no DE-4 code).

### Runs (Windows, this box)

| Run | Result |
|---|---|
| Repository test, `userDataExportReads`, `lib/business-os/data-export`, `lib/business-os/purge`, `lib/client`, `app/api/user/data-export`, `pluginConnectionsBrowserAccess.guard`, `mockedRepositoryMethods.guard`, `UserPreferencesRepository.findTimezone` | **29 suites, 640 passed** (25 s) |
| `npm run test:bos-entitlements` | **272 suites, 8,133 passed** |
| `npm run test:authz-guard` | **2 suites, 203 passed** |
| `tsc --noEmit` filtered to the touched files | 0 errors |

### For SA's delta review

1. The route now imports `UserPreferencesRepository` (service-role, user_id-scoped, existing method; no new repository method).
2. `accountProfile` / `ACCOUNT_PROFILE_KEYS` were deleted as dead code with the section, beyond the literal brief. If DE-8b or a later slice re-adds connected apps, they come back from git.
3. No `export_metadata.timezone` field was added: the name's zone is not written into the file (`export_date` stays UTC). Say if the README / DE-8b wants it.
4. `plugin_connections.plugin_key` is denied again by the deny list; harmless since the table is excluded.

### SA delta review DE-4 — 2026-10-15

**Code Review by SA (delta) — 2026-10-15**
**Status:** ✅ Delta Approved (no conditions; Low notes are non-blocking)

Scope: only the post-review changes above (A: F-1…F-4; B-1; B-2; re-pins; requirement §0.7 inserts). Re-ran `npx jest` on `app/api/user/data-export`, `lib/business-os/data-export`, `userDataExportReads`, `BusinessDataExportRepository`, the client helper and `SchemaReconciler`: **8 suites, 258 passed**.

#### Checks

| Area | Result |
|---|---|
| F-1…F-4 | ✅ Applied as written. Byte scan of every changed and untracked file (excluding `scratchpad/`): **no NUL byte** |
| Same instant (B-1) | ✅ One `const exportedAt = new Date()` feeds `export_date`, the audit `export_timestamp` and `exportFileName(exportedAt, timezone)`. Pinned at route level in the characterization suite with `jest.setSystemTime`: Jerusalem name `2026-07-16-0130` while `export_date` and `export_timestamp` are both `2026-07-15T22:30:00.000Z`, plus the UTC negative control |
| Timezone read cannot fail the export | ✅ `ownerTimezone` maps `{ error }` and a throw to `FALLBACK_TIMEZONE` plus one warn. `safeTimezone` validates through `Intl` before use, so `toBusinessLocalInput` always gets a resolvable zone. It is not a section: no `failed_sections` entry, no 500 (pinned: read error → 200, body byte-identical to the full export, `Data export failed` absent, audit written once) |
| Timezone read cannot leak | ✅ Existing `findTimezone`: `select('timezone')`, `.eq('user_id', user.id)` from `getUser()`, `maybeSingle`; the DB error is reduced by `safeDbError` and stays in logs. The zone string never reaches the header: the name holds only digits from `Intl` parts (no header-injection surface). The warn carries `{ userId }` (plus `err` only on the contract-impossible throw path, log-only). Error text is absent from the body (`secret_prefs`, `boom` pins) |
| DE-0a token-free guarantee | ✅ **Stronger than before.** Before: the table was read with a projected select plus a `profile_data` allow-list. Now: the table is never read on either client (`REMOVED_TABLES` in characterization; `plugin_connections` and `anon:plugin_connections` calls undefined in route.test). Both suites still seed raw token-bearing rows (`access_token`, `refresh_token`, `credentials`, `settings`, token in `profile_data`) and assert none of them, nor `plugin_key` / `account_profile`, in the body, audit or logs. The descriptor is `exclude` with the user's reason pinned, so `exportColumnsOf('plugin_connections')` throws `not_included`: a second barrier if someone re-adds a reader. The new prototype guard keeps `listForUserDataExport` (or any `/export/i` method) off `PluginConnectionRepository`. DE-0b browser guard untouched |
| B-2 removal completeness | ✅ No reference left to `listForUserDataExport`, `PLUGIN_CONNECTIONS_EXPORT`, `PluginConnectionExport*`, `accountProfile` or `ACCOUNT_PROFILE_KEYS` in `lib/`, `app/`, `components/` outside comments and guards. `PluginConnectionRepository` diff is deletion-only (0/47) and drops the now-unused `exportColumnsOf` import. Purge fields of the descriptor (level, order, scope, snapshot) unchanged; notes only |
| Counts | ✅ 9 include / 36 planned / 110 exclude = 155, consistent with `SchemaReconciler.test.ts` (9) and the registry 2 + 8 |
| Requirement | ✅ `git diff --numstat` = **77 / 0**: insert-only |
| Standards | ✅ No `console.*`, no `any` in touched files. No new repository method, route, migration, flag or dependency. No entitlements import |

#### Rulings on Dev's items

1. **Route imports `UserPreferencesRepository`** — ✅ Accepted. DB access through a repository (rule 1), an existing method, service role scoped to the session id, and the clock authority per CLAUDE.md. It is not an export section, so keeping it out of the section registry is right; the read happens only after the row ceiling passes.
2. **`accountProfile` / `ACCOUNT_PROFILE_KEYS` deleted** — ✅ Accepted. With the section gone it was dead code, which review forbids leaving. If connected apps return, they return through a new descriptor decision anyway.
3. **No `export_metadata.timezone`** — **Defer to DE-8b.** `export_date` is UTC and unambiguous; the zone only labels the file name. A field now is a format change with no consumer. DE-8b's README/manifest decides whether to state the zone the name uses; record it there as an input.
4. **Deny list blocks `plugin_key` again** — ✅ Harmless and correct. The deny list governs `include` columns only; the table is `exclude`, so it is never consulted for it. Removing the exception is required by the stale-entry check and restores the stricter default (pinned: `isDeniedColumn('plugin_connections', 'plugin_key') === true`).
5. **Changed pin values** — ✅ Accepted. Account rows toward the ceiling are `account_identity` + `user_profile` = 2, so the U-8 boundary moves by one. `profiles` is now the only fallible account read, so driving the failed-section cases through it keeps them meaningful (FR-E12 shape unchanged). Read order gaining `service:user_preferences` last matches the code.

#### Low notes (non-blocking)

- `app/api/user/data-export/__tests__/route.test.ts:565`: `jest.spyOn(Date, 'now')` does not change `new Date()`, and the case does not assert the name. The UTC-name-on-error assertion lives in the characterization suite, so coverage is complete; drop the spy or assert the header. Optional.
- `scratchpad/` is untracked inside the worktree. **RM: do not commit it.**
- The Jest run prints "A worker process has failed to exit gracefully"; all suites pass. Look with `--detectOpenHandles` only if it recurs in CI; not a DE-4 blocker.

#### Delta Approved for commit: **Yes**

### QA delta — DE-4 — 2026-10-15

**Test mode:** regression on the post-review changes (A, B-1, B-2) · **Strategy:** A + B (Jest, mocked Supabase) plus negative controls and mutations · **Focus:** api, security, schema · **Skipped:** e2e (manual check below, after deploy) · **Input source:** TL prompt

Negative controls and QA probes ran only in a scratch copy rebuilt from the current worktree, **outside** the worktree (session scratchpad `de4qa/`, its own `node_modules` junction, removed with `rmdir`). Worktree `git diff --numstat` was identical before and after, except this inserted section. Nothing stashed or committed.

#### Runs (worktree, Windows)

| Run | Result |
|---|---|
| `BusinessDataExportRepository`, `userDataExportReads`, `lib/business-os/data-export`, `lib/business-os/purge`, `lib/client`, `app/api/user/data-export`, `pluginConnectionsBrowserAccess.guard`, `mockedRepositoryMethods.guard`, `UserPreferencesRepository` (both files) | ✅ **30 suites, 657 passed**, 0 failed (Dev's 29/640 left out `UserPreferencesRepository.test.ts`) |
| `npm run test:bos-entitlements` | ⚠️ **271/272 suites, 8,131/8,133 passed.** The 2 failures are in `app/admin/users/__tests__/creditsBlock.render.test.tsx` (a 5 s timeout and a missing element in the dialog). The run overlapped QA's scratch-copy Jest runs. Re-run alone: **69/69 passed**. This is admin UI that DE-4 does not touch: a load flake, not a DE-4 failure |
| `npm run test:authz-guard` | ✅ **2 suites, 203 passed** |
| NUL byte scan (21 changed + untracked files, plus `scratchpad/de4dev/`) | ✅ **0 files** contain a NUL |
| `.github/` | ✅ No change: none tracked, none untracked, and no commits on the branch ahead of origin/main |

#### Negative controls (scratch copy; each one reverted before the next)

| # | Plant | Result |
|---|---|---|
| a1 | `plugin_connections` descriptor back to an `include` (5 columns) | ✅ **13 failed**: exportClassification T-1, T-4, T-6 (×5), T-7, T-8 (×2), T-9, T-10, and SchemaReconciler drift |
| a2 | `plugin_connections` section back in `EXPORT_SECTIONS` (descriptor still excluded) | ✅ **Many failures**, including the DE-0a token test, C-4 "every table section resolves", T-6, T-9 "no section backed by it", the characterization full-body pin and the U-8 ceiling case |
| b1 | `access_token: 'ya29.leak'` added to the `user_profile` row | ✅ **14 failed**: the characterization exact-body pins, and route.test "never exports profiles.plan" |
| b2 | raw `source_metadata` (the `clientRow` mapper removed) | ✅ **16 failed**, including U-7 "source_metadata keeps only the BC-4 keys" and U-9 "only the BC-4 source keys" |
| b3 | `access_token: 'never-exported-b3'` in `account_identity`, which is present in every test | ✅ The DE-0a token-free test fails on `not.toContain("\"access_token\"")`, and so does the characterization full-body pin |
| c1 | `listForUserDataExport` back on `PluginConnectionRepository` | ✅ The new guard fails (1 failed) |
| c2 | the same method renamed `exportConnectionsForUser` | ✅ The guard's `/export/i` sweep still fails it |
| d | timezone read: throws / `{ error }` / `'Not/AZone'` / NULL / blank `'   '` (QA scratch test, compared with a UTC baseline) | ✅ Every case: **200**, UTC name `…-2026-07-15-2230.json`, body **byte-identical** to the baseline, no error text in the body. One `warn` "timezone unreadable" for throw and error only, none for the others. "Data export failed" is never logged |
| d′ | mutation: route calls `findTimezone` with no guard | ✅ 2 Dev tests fail (route.test read error, characterization read error), plus QA's |
| d″ | mutation: only the `catch` removed (the throw path) | ⚠️ **No Dev test fails.** Only QA's scratch "throws" case catches it. See Edge case 1 |
| e | mutation: `exportFileName(new Date(), timezone)`, a **second** clock reading instead of `exportedAt` | ❌ **No test fails (196/196 pass).** Every name test runs under `jest.useFakeTimers`, so both readings return the same frozen instant. A QA probe with a Date that moves one minute per reading catches it (name `2301` vs `export_date` 23:00). See Edge case 2 |
| f | Asia/Jerusalem across midnight (QA route probe + Dev unit/route pins) | ✅ 22:30Z in July gives `2026-07-16-0130`, while `export_date` stays `2026-07-15T22:30:00.000Z`. 22:30Z in January (winter) gives `2026-01-16-0030`. 21:59Z in January gives `2026-01-15-2359`. Mutation "the name ignores the zone": **5 failed** (Jerusalem, New York, midnight cases) |

#### Issues Found

**Bugs:** none.

**Performance:** none (one extra `maybeSingle` read, and only after the ceiling passes).

**Edge cases (test gaps, Low, nice to fix; not blocking):**
1. **The throw path of `ownerTimezone` is not tested.** `app/api/user/data-export/route.ts` `ownerTimezone` catch block: removing it breaks no Dev test. `findTimezone` never throws by contract, so this is defensive code. To fix: one route case with `findTimezone` rejecting → 200, UTC name, a warn line.
2. **"One clock reading" is not pinned against a second reading.** `exportFileName(new Date(), timezone)` passes every suite, because the frozen fake clock makes the two readings equal. SA's delta table calls it pinned; it is pinned only against a skewed value, not against a separate `new Date()`. To fix: one characterization case whose clock moves between readings (for example `jest.spyOn(global, 'Date')`, or a Date subclass that ticks per no-arg construction, from 23:59:59.9) asserting the name's minute equals `export_date`'s. QA's probe shows this works: it fails on the mutation and passes on the real code.
3. (Agrees with SA) `scratchpad/` is untracked and not git-ignored in the worktree. **RM: do not commit it.**

#### Final Status

- [x] All acceptance criteria for the delta pass. No bug. Two Low test gaps are recorded for Dev (optional). **Ready for commit**, with the user's manual check owed after deploy.
- [ ] Issues found — Dev must address before commit

**Manual check owed by the user (Business OS, after deploy):**
1. Signed in, Settings → Danger zone → Export. The downloaded name is `agentpilot-data-export-YYYY-MM-DD-HHmm.json`, with today's date and the current **local** hour and minute.
2. The file has `account_identity`, `user_profile` and the 8 `client_records` sections (pipeline_stages, clients, client_activities, client_tasks, client_documents, services, bookings, time_off). **No** `plugin_connections` section. No token anywhere: search the file for `access_token`, `refresh_token`, `credentials`.
3. A deleted document is absent and an archived one is present. Cancelled bookings are present. No `ip_hash`, `user_agent` or `session_id` appears anywhere.
4. Signed out (or with an expired session), Export shows an error and nothing downloads.

### QA gap tests — 2026-10-15 (Dev)

Tests only; `route.ts` unchanged (md5 `ef4d4603f51a9110bce8bfa52f5725f4` before and after every mutation). Nothing stashed or committed.

| Gap | Test added | Mutation proof |
|---|---|---|
| Edge case 2: one clock reading | `route.characterization.test.ts` "one clock reading: with a clock that moves on every reading…": a `Date` subclass moves one minute per no-arg `new Date()` / `Date.now()`; the name must equal `export_date` formatted in Asia/Jerusalem, and the clock must have been read more than once | `exportFileName(new Date(), timezone)` → **1 failed** (name `…0150` vs `…0148`); restored |
| Edge case 1: `ownerTimezone` throw path | `route.test.ts` "a timezone read that throws…": `findTimezone` rejects → 200, UTC name, body byte-identical to a stored-UTC baseline at the same frozen instant, one warn (fields `err` and `userId` only), no "Data export failed" | `catch` removed → **1 failed** (500 instead of 200); restored |
| SA Low (route.test ~565) | The ineffective `Date.now` spy replaced by a frozen system clock; the read-error case now asserts the UTC `Content-Disposition` | — |

Runs: `app/api/user/data-export` + `lib/business-os/data-export`: **4 suites, 176 passed**.

---

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Created (Dev, workplan only) | On `feature/data-export-de4` from origin/main `eb2b9396`. 9 tables classified (§3) from migrations + the 2026-09-10 physical catalog, live verification owed (§10 SQL for TL). Findings: PostgREST silent 1,000-row cut on today's reads (F-3), Vercel 4.5 MB body (F-4), reversible `ip_hash` in `source_metadata` (F-5), `stage_key` deny hit (F-8), orphan document files for DE-8b (F-7). BC-1…BC-7, SA-Q1…SA-Q13 |
| 2026-10-15 | Code Complete (Dev) | Merged origin/main `50d26e78`. C-1…C-12 applied (Dev Implementation Notes); deviations D-1…D-9, none on a §3 column row. 8 include + 1 exclude; one read-only descriptor-driven repository; 413 ceiling (rows, 4 MB body); tests U-1…U-9, C-1 re-pin, C-5 scans. All listed suites green; T-9 `schema:reconcile` owed by TL (no DB env in the worktree) |
| 2026-10-15 | Post-review changes (Dev) | SA F-1…F-4 applied. User decisions: file name `agentpilot-data-export-YYYY-MM-DD-HHmm.json` on the owner's clock (`user_preferences.timezone`, UTC fallback); connected apps (`plugin_connections`) dropped from the export, dead `listForUserDataExport` removed. Totals 9 include / 36 planned / 110 exclude. Awaiting SA delta review |
| 2026-10-15 | SA delta review | Delta approved, no conditions. Same-instant name, fail-safe timezone read and the stronger DE-0a guarantee confirmed; items 1, 2, 4, 5 accepted; `export_metadata.timezone` deferred to DE-8b. 8 suites, 258 passed |

### 10.1 T-0 live results — 2026-10-15 (TL, read-only, Supabase MCP, prod `jgccgkyhpwirgknnceoh`)

**Q1/Q2 columns (count matches expected 19, 11, 10, 16, 15, 26, 36, 8, 11 exactly):**
| Table | n | Live columns (in order; `(gen)` = generated) |
|---|---|---|
| `contact_documents` | 15 | id, user_id, contact_id, name, document_type, file_name, file_size, mime_type, storage_path, storage_bucket, description, tags, status, created_at, updated_at |
| `crm_activities` | 11 | id, user_id, contact_id, activity_type, title, description, auto_logged, source_capability, source_entity_id, activity_date, created_at |
| `crm_contacts` | 19 | id, user_id, first_name, last_name, email, phone, stage, tags, custom_fields, source, **notes**, created_at, updated_at, source_metadata, referrer_domain(gen), utm_source(gen), utm_medium(gen), utm_campaign(gen), stage_entered_at |
| `crm_pipeline_stages` | 10 | id, user_id, vertical, stage_key, stage_label, position, color, created_at, stage_type, is_primary_client_stage |
| `crm_tasks` | 16 | id, user_id, contact_id, title, description, priority, status, due_date, reminder_at, completed_at, created_by, source_entity_type, source_entity_id, tags, created_at, updated_at |
| `external_calendar_events` | 11 | id, user_id, external_event_id, provider, title, start_time, end_time, is_all_day, last_synced_at, created_at, updated_at |
| `scheduling_availability_exceptions` | 8 | id, user_id, exception_type, start_date, end_date, custom_hours, reason, created_at |
| `scheduling_bookings` | 36 | id, user_id, service_id, contact_id, start_time, end_time, timezone, status, cancellation_reason, payment_status, payment_id, notes, internal_notes, booking_source, reminder_24hr_sent, reminder_2hr_sent, created_at, updated_at, external_calendar_event_id, calendar_sync_provider, calendar_synced_at, calendar_sync_error, payment_method, payment_amount, payment_currency, invoice_id, payment_plan_id, intake_responses, intake_completed_at, intake_sent_at, intake_reminded_at, cancel_reason, cancel_note, cancelled_by, parent_booking_id, occurrence_number |
| `scheduling_services` | 26 | id, user_id, service_name, description, duration_minutes, price, buffer_minutes, max_bookings_per_day, advance_booking_days, min_notice_hours, availability, is_active, created_at, updated_at, status, source, ai_suggestions, currency, payment_type, installment_count, installment_frequency, first_payment_due, first_payment_days, is_scheduled, collection, sale_mode |

`crm_contacts.notes` **is live** (resolves the migration ambiguity).

**Q3 statuses in use:** contact_documents active 9 / **deleted 2**; crm_tasks completed 1 / pending 1; scheduling_bookings cancelled 56 / completed 91 / confirmed 32 / no_show 1; scheduling_services active 30 / draft 3 / inactive 1.

**Q4 `source_metadata` keys (7 contacts):** device_type, user_agent, ip_hash, referrer_url, capture_page_url, session_id, capture_timestamp, referrer_domain, capture_channel (7 each); utm_source, utm_medium (1 each). No other keys.

**Q5 largest owners (9 tables):** 885 rows / ~200 kB; 543 / 126 kB; 544 / 124 kB; then < 50 rows. Far below the 100,000-row ceiling; the 1,000-row PostgREST cut (F-3) is not hit today but paging is still required.

**Q6 cross-tenant integrity:** 0 on all five edges.

T-0 **done**. Compare §3's lists against Q1 before coding; any difference is a workplan fix.

### 10.2 T-9 drift check — 2026-10-15 (TL, read-only, prod `jgccgkyhpwirgknnceoh`)
Declared include ∪ excluded (incl. `user_id`) for the 8 included tables compared set-wise with `information_schema.columns` in one query: **drift = 0, missing = 0** on all 8. `contact_documents.status` **`is_nullable = NO`** (C-6 confirmed). `external_calendar_events` excluded at table level, not compared. T-9 done (in lieu of `npm run schema:reconcile`; the worktree has no env).
