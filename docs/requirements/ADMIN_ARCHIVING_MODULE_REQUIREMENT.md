# Requirement: Admin Archiving Module

> **Last Updated**: 2026-09-26

**Created by:** BA
**Date:** 2026-09-25
**Status:** SA reviewed 2026-09-25: **CLEARED WITH CONDITIONS** (see [§13](#13-sa-review)). All seven Open Business Questions were answered by the user on 2026-09-25 (see [§10](#10-open-business-questions)). TQ-1 to TQ-5 are resolved by SA in [§11](#11-open-technical-questions-for-sa--dev). Dev may write the Slice 1 workplan against §13.3.

## Overview

This adds an **Archiving** module to `/admin`. It moves old rows out of an operational table into an archive table in the same Supabase database, then deletes them from the operational table. Each batch does both steps in one transaction. The first and only source in v1 is the **audit trail** (`audit_trail`). An admin runs archiving by hand. Before each run, the admin picks how long records stay live from three fixed choices: 365, 180 or 90 days. The design has a small "source" seam so more tables can be added later, and a storage seam so the archive can move to cheap object storage (S3) later. Neither is built now. The user asked for this to stay simple, and every choice below favours the smaller option.

---

## Table of Contents

- [1. As-Built Findings](#1-as-built-findings)
- [2. Goals and Non-Goals](#2-goals-and-non-goals)
- [3. User Stories](#3-user-stories)
- [4. Functional Requirements](#4-functional-requirements)
- [5. Data Design](#5-data-design)
- [6. The Source Seam and the Storage Seam](#6-the-source-seam-and-the-storage-seam)
- [7. Non-Functional Requirements](#7-non-functional-requirements)
- [8. Risks and Known Consequences](#8-risks-and-known-consequences)
- [9. Acceptance Criteria](#9-acceptance-criteria)
- [10. Open Business Questions](#10-open-business-questions)
- [11. Open Technical Questions (for SA / Dev)](#11-open-technical-questions-for-sa--dev)
- [12. Notes on Integration Points](#12-notes-on-integration-points)
- [13. SA Review](#13-sa-review)
- [Change History](#change-history)

---

## 1. As-Built Findings

Read on 2026-09-25 against branch `fix/insight-run-group-id-per-business`.

| # | Finding | Evidence |
|---|---|---|
| **F-1** | **`audit_trail` is not append-only.** It has no trigger or rule that blocks DELETE or UPDATE. The service role can do anything to it, and existing code already updates rows (`anonymizeUserData`) and deletes them (`applyRetentionPolicy`). So archiving does not weaken any immutability guarantee, because none exists. Tamper hashing is present but switched off (`enableTamperDetection: false`) | `supabase/SQL Scripts/create_audit_trail.sql`; `lib/services/AuditTrailService.ts:51`, `:428-463`, `:468-485` |
| **F-2** | ⚠️ **The DDL in the repo does not match the live table.** The creation script is in `supabase/SQL Scripts/`, not in `migrations/`. It names a policy `"Service role has full access"`, but the live policy is `"service_role_bypass_rls"` according to the 2026-09-30 migration's pre-check. The script also has an admin policy that reads `raw_user_meta_data->>'role'`, and its live state is unknown. **Any claim about live triggers, policies or columns must be checked against the database, not the script**, which is why FR-15 requires a read-only pre-check | `supabase/SQL Scripts/create_audit_trail.sql:66-81`; `supabase/migrations/20260930_audit_trail_owner_policy_hides_ai_actions.sql:36-37` |
| **F-3** | **The table is expensive to keep large.** It has 10 secondary indexes, including three GIN indexes (`changes`, `details`, `compliance_flags`). Every row costs index space as well as heap space, and an archive table needs almost none of these indexes | `create_audit_trail.sql:39-54` |
| **F-4** | **A hard-delete retention method already exists and nothing controls it.** `AuditTrailService.applyRetentionPolicy()` permanently deletes non-critical rows older than 365 days, with no archive step. This BA had no content search available and **could not verify whether anything calls it**. Its default config (`defaultDays: 365`, `criticalEventsDays: 2555`) is the only record of retention intent in the repo | `AuditTrailService.ts:46-50`, `:468-485` |
| **F-5** | **Five readers show audit history and would stop seeing archived rows.** (1) the admin audit browser `/admin/audit-trail` via `GET /api/admin/audit-trail`; (2) the admin per-user panel via `GET /api/admin/users/[id]/audit-logs`; (3) owners' own **activity history** (`/monitoring`, `/v2/monitoring`) via `AuditTrailRepository.listOwnerEntries`; (4) the approved but unbuilt **AI Activity view** (Gap B), which joins audit entries to `token_usage` ledger rows and would show an action whose entry was archived as a *lost* entry; (5) `AuditTrailService.exportUserData` (GDPR export) | `app/api/admin/audit-trail/route.ts`; `app/api/admin/users/[id]/audit-logs/route.ts`; `lib/repositories/AuditTrailRepository.ts`; [Gap B requirement](/docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md) F-10, F-15 |
| **F-6** | **The business-data purge already classifies `audit_trail`**, as `optional:activityHistory` scoped by `user_id`. The purge engine **fails closed on any unclassified user-scoped table** (AC-37). A new archive table with a `user_id` column will therefore **stop the purge from running** until it is classified | `lib/business-os/purge/descriptors.ts:296-297`; purge requirement §0.2 |
| **F-7** | **The repo-wide no-deletion-paths guard (C-34) targets identity tables and account deletion, not `audit_trail`.** A server-side archive that deletes only `audit_trail` rows does not trip it, but the guard must stay green | `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts:97-123` |
| **F-8** | **Every `/admin` page is guarded by inheritance** from `app/admin/layout.tsx`. Every `/api/admin/*` handler must open with `requireAdmin`. New gated routes move the admin-authz guard's caps, and that has to be done on purpose | `lib/admin/requireAdminRoute.ts`; [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) |
| **F-9** | **Crons are currently dormant** because `CRON_SECRET` is not set on Vercel. A scheduled archive would not run today. A manual, admin-triggered run works now | CLAUDE.md memory: payment queue-drain, parked findings 2026-09-24 |
| **F-10** | **PostgREST aggregates are disabled** (`PGRST123`). Row counts must use `count: 'exact', head: true` or a SQL function, not `GROUP BY` from the client | [Gap B requirement](/docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md) F-14 |
| **F-11** | **No archive, retention or data-movement code exists yet**, apart from the business-data purge, which deletes one business's data and does not move it anywhere. There is nothing to reuse for the move itself. The purge's descriptor discipline (every table classified, fail closed) is the reason for F-6 | Glob over `app/`, `lib/`, `scripts/` for `*archiv*`, `*retention*`, `*purge*` |

---

## 2. Goals and Non-Goals

### Goals

1. Keep `audit_trail` small and fast. Rows older than a retention period chosen by the admin move to an archive, and nothing is lost.
2. Give admins one screen that shows what can be archived, lets them run an archive, and shows what past runs did.
3. Leave room for more sources and for S3 later, without building either now.

### Non-Goals (v1)

| Not in v1 | Why |
|---|---|
| **S3 or any storage outside Supabase** | A future destination. The seam is described in [§6](#6-the-source-seam-and-the-storage-seam) and nothing is built |
| **Any source other than `audit_trail`** | The seam exists. Adding a source is a separate, small change |
| **A restore feature** | Decided by the user (BQ-3). The archive keeps each row complete, so restore can be added later |
| **Viewing or searching archived records in the UI** | Decided by the user (BQ-2). The admin sees counts per run only |
| **A scheduled (cron) run** | Decided by the user (BQ-4): manual button only. Crons are dormant anyway (F-9) |
| **A free-form retention period** | Decided by the user (BQ-1): exactly three choices, 365, 180 or 90 days |
| **Excluding any audit record from archiving** | Decided by the user (BQ-5): no exclusions. The FR-9 seam stays for later |
| **An owner-facing notice about archived history** | Decided by the user (BQ-6). See K-1 |
| **Shrinking the database's disk footprint** | Deleted rows free space for reuse inside Postgres but do not return it to the disk (see R-3). The archive sits in the same database, so **v1 does not lower the Supabase storage bill**. The bill goes down when the archive moves to S3 |
| **Fixing F-2 schema drift, the `insert_audit_log` grant, or the inline admin checks on the audit routes** | Separate items. Recorded here so they are not absorbed silently |

---

## 3. User Stories

- As a **platform admin**, I want to see, for each archivable source, how many rows it holds, how old the oldest is, and how many would be archived under the retention period I have selected, so I can decide whether to run an archive.
- As a **platform admin**, I want to choose how long records stay live (365, 180 or 90 days, starting at 365) and then archive with one confirmed action, so the operational table stays lean without a database session.
- As a **platform admin**, I want each run recorded (who, when, retention chosen, cutoff, rows moved, outcome), so I can prove what was moved and when.
- As a **platform admin**, I want a run that stops partway to be safe to run again, with no row lost or duplicated.
- As a **platform admin**, I want the admin audit screens to say that older entries have been archived, so I don't read "no results" as "nothing happened".
- As a **business owner who purges my business's activity history or asks for my personal data to be erased or exported**, I want my archived records included, the same as my live ones.

---

## 4. Functional Requirements

### Running an archive

1. **FR-1 (manual run, retention dropdown).** An admin starts a run for one source from `/admin/archiving`. Before starting, the admin picks how long records stay live from a **dropdown with exactly three options: 365 days, 180 days, 90 days**. The dropdown is **preselected to 365 days**. No other value can be entered, and there is no free-text field. Runs are started only by an admin pressing the button. Nothing triggers a run on a schedule (BQ-4).
2. **FR-2 (server-side validation).** The server does not trust the client's value. It validates the retention period with a **Zod enum of exactly `365 | 180 | 90`**. Any other value, including a valid integer outside the set, gets 400 before anything else happens. The 90-day floor is implied by the options. There is no separate minimum check, and the three options live in one shared constant used by the Zod schema and the dropdown, so the two can't drift apart.
3. **FR-3 (fixed cutoff).** The cutoff (`now() − selected days`, UTC) is computed **once, on the server, when the run starts**. It is stored on the run together with the selected retention period. Every batch and every continuation uses that stored cutoff. It is never recomputed, and Continue does not re-read the dropdown.
4. **FR-4 (confirm first).** When the admin changes the dropdown, the eligible-row count updates to match. Before the run starts, a confirmation shows the retention chosen, the cutoff date and how many rows will move, and the admin must confirm. If 180 or 90 is chosen, the confirmation also says that business owners will see only that much of their own activity history (K-1).
5. **FR-5 (atomic batches).** Rows move in batches. Each batch is a single database function call that, **in one transaction**, copies the batch into the archive and then deletes from the source **only those rows now present in the archive**. If a batch fails, both tables stay as they were.
6. **FR-6 (idempotent).** The archive is unique on `(source, source_id)`, and the copy uses `ON CONFLICT DO NOTHING`. Running again after any failure cannot duplicate a row, and cannot delete a row that was not archived.
7. **FR-7 (time-boxed, resumable).** One request processes batches until the source has nothing left before the cutoff, or until a time budget safely under the Vercel function limit runs out. If work remains, the run is marked `partial` and the UI offers **Continue**, which resumes the same run with the same cutoff.
8. **FR-8 (one run at a time).** Only one run per source can be `running`. A second start is refused with 409. A run left `running` longer than the longest possible request is treated as dead and may be taken over. The mechanism is for SA to choose (see [§11](#11-open-technical-questions-for-sa--dev)).
9. **FR-9 (exclusions seam).** Each source can declare rows it must never archive. **For audit trail this is empty (BQ-5): every record is eligible once it is older than the cutoff**, including security, admin and critical-severity events. The seam stays so a legal hold could be added later.

### Visibility

10. **FR-10 (overview).** For each registered source the page shows: the operational row count, the oldest operational record, the number of rows eligible under the retention currently selected in the dropdown (initially 365), the total archived rows, and the last run with its status.
11. **FR-11 (run history, counts only).** The page lists runs newest first: source, admin, started/finished, retention chosen, cutoff, rows archived, batches, status (`running` / `succeeded` / `partial` / `failed`), and a short error code on failure. Error text never goes to the client in production. **There is no viewer for archived records** (BQ-2): the admin sees counts, never archived contents.
12. **FR-12 (honest admin history screens).** `/admin/audit-trail` and the admin per-user audit panel show one line with the latest cutoff, for example "Entries before 2025-09-25 are archived". **Owner-facing screens get no notice in v1** (BQ-6, K-1).

### Auditing the archive itself

13. **FR-13 (audit the action).** Each run writes audit events through `AuditTrailService.log()` (non-blocking): `ARCHIVE_RUN_STARTED`, and `ARCHIVE_RUN_COMPLETED` or `ARCHIVE_RUN_FAILED`, with entity type `archive_run`, entity id = run id, and `details` = source, retention chosen, cutoff, rows archived. The events and the entity type are added to the audit catalogue (`lib/audit/events.ts`, `AUDIT_ENTITY_TYPES`) so the admin filters pick them up automatically.
    **The recursion is harmless by design.** These entries are written *now*, which is always after the cutoff, so a run never archives its own record. A later run will archive them once they age past retention, which is correct. The **permanent** record of every run is the run log table ([§5](#5-data-design)), which is never archived.

### Consistency with erasure and purge

14. **FR-14 (erasure, export and purge always reach the archive).** Decided by the user (BQ-7: yes, always):
    - (a) The archive table is added to the purge descriptors with the **same classification as its source row** (`optional:activityHistory` for audit trail), in the same slice that creates the table. A business purge with "activity history" ticked removes that business's archived audit rows as well as the live ones, and the purge does not start failing closed (F-6).
    - (b) **Erasure deletes the account's archived rows.** `AuditTrailService.anonymizeUserData` keeps today's behaviour for the account's **live** rows (anonymise). It also **deletes** every archived row for that account through `ArchiveRepository.deleteArchivedForUser(userId)`, so no row for that `user_id` remains in `archived_records`. Archived rows are removed, not anonymised. This matches BQ-7 ("removed too") and SA condition C-8, and needs no JSON-rewrite function or extra migration.
    - (c) `AuditTrailService.exportUserData` (export) includes the account's archived rows.
    - If Dev finds that (b) or (c) has no caller today, record that and extend them anyway, so they are correct when a caller is added.

### Safety

15. **FR-15 (live pre-check).** The migration's header includes a read-only pre-check. It lists the live triggers, rules and policies on `audit_trail` and confirms its columns. The migration must not be applied if a DELETE-blocking trigger or rule is found, and the output goes to Dev (F-2).
16. **FR-16 (one delete path).** After this ships, the archive function is the **only** code path that deletes `audit_trail` rows by age. `applyRetentionPolicy()` (F-4) must not be wired to anything. SA decides whether to remove it or send it through the archive ([§11](#11-open-technical-questions-for-sa--dev)).

---

## 5. Data Design

Two new tables and one function for each source. The column names below describe the requirement. Final DDL is Dev's to write and SA's to review.

### 5.1 `archived_records`: one generic archive table (recommended)

| Column | Purpose |
|---|---|
| `id` | PK |
| `source` | Source key, e.g. `audit_trail` |
| `source_id` | The row's primary key in its source (text, so any key type fits) |
| `user_id` (nullable) | Copied out of the row as a **real column**, so erasure, GDPR export and business purge can reach archived rows by account (FR-14) |
| `original_created_at` | The source row's creation time. Used for month grouping and a future S3 export |
| `payload` (`jsonb`) | The **whole source row** (`to_jsonb(row)`). Columns added to the source later are archived automatically |
| `archived_at` | When the row was moved |
| `archive_run_id` | FK to `archive_runs` |

- **Unique** `(source, source_id)` (FR-6). **Indexes:** `(source, original_created_at)` and `(user_id)`. **No GIN indexes.** This is where most of the space saving comes from (F-3).
- **Compression:** `payload` is TOASTed automatically. Use `SET COMPRESSION lz4` if the project's Postgres supports it, otherwise the default `pglz`. There is no custom compression code. Note the limit in R-4.
- **Access:** RLS enabled with **no policies**, and `REVOKE ALL` from `anon` and `authenticated`. Only the service role, through the repository, can touch it.

**Why one generic table rather than one table per source:** new sources need no new table. It maps directly to a future S3 layout (one file per source per month). Erasure and purge have one place to look. The cost is that the payload is untyped JSON, which is acceptable because nothing in v1 queries inside it.

**Why one row per record rather than one row per batch** (a compressed JSON array per batch would compress much better): per-account erasure and purge (FR-14) would then mean rewriting batches. One row per record keeps both to a simple `DELETE … WHERE user_id =`.

### 5.2 `archive_runs`: the run log

`id`, `source`, `destination` (always `'supabase'` in v1, see §6), `retention_days` (one of 365 / 180 / 90, with a CHECK constraint matching the Zod enum as defence in depth), `cutoff`, `status`, `rows_archived`, `batches`, `started_by` (admin user id), `started_at`, `finished_at`, `error_code`. Same access rules as §5.1. **Never archived and never purged**: it holds no business content, only counts.

### 5.3 The move function (one per source)

`archive_audit_trail_batch(run_id, cutoff, batch_size)` runs in one transaction:
1. Select up to `batch_size` ids from `audit_trail` where `created_at < cutoff`, oldest first (no exclusions for audit trail, FR-9).
2. Insert them into `archived_records` (`ON CONFLICT DO NOTHING`).
3. Delete from `audit_trail` **only ids that now exist in `archived_records`**.
4. Return the number moved (0 means done).

`EXECUTE` is revoked from `PUBLIC`, `anon` and `authenticated` and granted only to `service_role`. The platform already has around 50 anon-callable `SECURITY DEFINER` functions queued for lockdown, and this must not add one. SA decides between `SECURITY INVOKER` and `SECURITY DEFINER` and sets the batch size (proposed 1,000 to 5,000).

---

## 6. The Source Seam and the Storage Seam

**Source seam.** A small TypeScript registry lists each archivable source: key, label, its batch function name, and its exclusions (empty for audit trail). The retention options (365 / 180 / 90, default 365) are **one shared constant for v1**, used by the dropdown and the Zod enum, not a per-source setting. A future source that needs different options can add them then. The UI and API list whatever the registry contains. **Adding a second source later takes:**
1. one migration: that source's batch function (same four steps, with its own id and `created_at` columns and its own exclusions);
2. one registry entry;
3. one purge-descriptor decision for its archived rows (FR-14, mirroring the source's own classification);
4. a check of who reads that table's history (the equivalent of F-5).

It does **not** need a new archive table, a new page or a new route. A single generic function that takes a table name as a parameter is **rejected**: dynamic SQL over caller-chosen table names is an injection and privilege risk that costs more than one small function per source.

**Storage seam.** `archive_runs.destination` and the `(source, original_created_at)` layout are the entire seam. A future S3 step would export a month of `archived_records` for one source to one compressed file, record it, then delete those archive rows. **No destination interface or abstraction is built in v1.** Adding one would be a new pattern with a single implementation (CLAUDE.md rule 7).

---

## 7. Non-Functional Requirements

- **Security.** Every new `/api/admin/archiving/*` handler has `requireAdmin` as its first statement. There is no inline `AdminAccessService` call and no `profiles.role`. The page inherits the `/admin` layout guard. The admin-authz guard's caps move for the new gated routes, deliberately, in the same commit. Nothing is owner-callable.
- **Repository pattern.** All database access goes through a new `ArchiveRepository` in `lib/repositories/`. It uses the service role and is **cross-account by design**, as platform maintenance. The bypass is documented in the file and named in its method names, following the `TokenUsageRepository` precedent. SA to confirm.
- **Validation.** Zod on every route input: source key from the registry enum, **retention days as the enum `365 | 180 | 90`** (FR-2), run id as a UUID. The client's dropdown is a convenience, never the check.
- **Logging.** Pino via `createLogger`, a correlation id on each request, and one structured log line per batch (run id, source, retention, rows moved, elapsed). Payloads are never logged.
- **Performance.** A batch must never hold locks long enough to block `AuditTrailService` inserts. The batch size is tuned so one batch finishes in about 1 to 2 seconds. The first 90-day run may move many more rows than a 365-day run. FR-7's time box and Continue cover this.
- **Accessibility.** The retention dropdown has a visible label, the confirm dialog and the Continue action are keyboard-operable, and run status is not shown by colour alone. Page body follows the admin density standard once that exists, with the current raw-Tailwind admin look until then (reorganisation C-3).
- **Testing.** Unit tests cover the registry, the shared retention constant and the Zod schemas (each of 365, 180 and 90 accepted; 30, 366, `"365"` as a non-number if the schema does not coerce, and missing values rejected). Integration tests for each route cover the happy path, 401, 403 and invalid input. A function-level test (or a scripted check against a branch or local database) proves that a failed batch leaves both tables unchanged and that re-running is a no-op. QA records a manual run on a copy of the data.
- **Deployment.** The migration is applied by hand to production (current practice), with the FR-15 pre-check first and a rollback script in its header.

---

## 8. Risks and Known Consequences

### Risks

| # | Risk | Mitigation |
|---|---|---|
| **R-1** | Archived AI-action entries make the **Gap B** view report "missing audit entry" for older actions (F-5). This is more likely if an admin picks 90 days | The Gap B B1 workplan treats actions before the latest audit-trail cutoff as **archived**, not missing (TQ-5) |
| **R-2** | The purge fails closed once the archive table exists (F-6) | FR-14(a): classify the table in the same slice |
| **R-3** | Expecting the database to shrink. Deleting rows does not return disk space, and the archive is in the same database | Stated as a non-goal. The value in v1 is a lean operational table with small indexes. Disk reclaim (`pg_repack`) and the storage bill are out of scope until S3 |
| **R-4** | Expecting large compression. TOAST only compresses values above about 2 KB, and most audit rows are smaller | Stated plainly. The measurable saving is dropping the GIN and secondary indexes (F-3). Real compression comes with the S3 export (whole-file gzip) |
| **R-5** | The live table differs from the repo script (F-2) | FR-15 pre-check. Stop if a blocking trigger or rule is found |
| **R-6** | A second, unguarded delete path (`applyRetentionPolicy`, F-4) removes rows without archiving them | FR-16 |
| **R-7** | Personal data kept longer in the archive than in the live table (IP address, user agent, session id) | FR-14 (erasure, export and purge always cover the archive). Archive-expiry policy is decided with S3 |

### Known consequences (accepted by the user)

| # | Consequence | Status |
|---|---|---|
| **K-1** | **Owners' own activity history is only as long as the retention the admin picks.** With the default of 365 days, owners see one year. If an admin picks 180 or 90 days, owners' history shrinks to that length for every account, from that run onward. There is **no owner-facing notice in v1** (BQ-6). The admin is told this in the run confirmation (FR-4) | Accepted, 2026-09-25 |
| **K-2** | **Archived records can't be viewed or restored from the product in v1** (BQ-2, BQ-3). Answering a request for old records (a dispute, an investigation) needs a database query against `archived_records` | Accepted, 2026-09-25 |

---

## 9. Acceptance Criteria

- [ ] **AC-1** `/admin/archiving` shows the audit-trail source with row count, oldest record, eligible count for the selected retention, archived total and last run (FR-10).
- [ ] **AC-2** The retention control is a dropdown with **exactly** the options 365, 180 and 90 days, **365 preselected**, and no free-text entry. Changing it updates the eligible-row count (FR-1, FR-4).
- [ ] **AC-3** The server accepts only 365, 180 or 90. Any other value sent directly to the API (for example 30, 366, 0, a negative number, a string, or no value) gets 400 and nothing is read or written (FR-2).
- [ ] **AC-4** A run moves exactly the rows with `created_at` before the stored cutoff (`now() − selected days`). Afterwards, operational count plus archived count for that source equals the operational count before the run. The run log records the retention chosen (FR-3).
- [ ] **AC-5** A batch forced to fail partway leaves `audit_trail` and `archived_records` unchanged (FR-5).
- [ ] **AC-6** Running again, or pressing Continue, after any interruption produces no duplicate archive rows, never deletes a source row that is not in the archive, and reuses the original cutoff even if the dropdown has since changed (FR-3, FR-6, FR-7).
- [ ] **AC-7** A second concurrent run gets 409 (FR-8).
- [ ] **AC-8** Choosing 180 or 90 shows the owner-history consequence in the confirmation (FR-4, K-1).
- [ ] **AC-9** Each run writes `ARCHIVE_RUN_STARTED` and one of `_COMPLETED` / `_FAILED`, which are selectable in the `/admin/audit-trail` filters. The run's own entries are never archived by that run (FR-13).
- [ ] **AC-10** Every new route returns 401 when signed out and 403 for a non-admin before it reads anything. `Admin authz surface guard` passes with the caps moved deliberately.
- [ ] **AC-11** `anon` and `authenticated` cannot read `archived_records` or `archive_runs`, and cannot execute the move function (verified by a live query after apply).
- [ ] **AC-12** The purge descriptor invariant test passes with the archive table classified. A business purge with "activity history" ticked removes that business's archived audit rows as well as its live ones (FR-14a).
- [ ] **AC-13** GDPR erasure anonymises the account's live rows and **deletes** its archived rows, so no `archived_records` row remains for that `user_id` and other accounts' archived rows are untouched. GDPR export includes both live and archived rows (FR-14b, FR-14c).
- [ ] **AC-14** No UI shows the contents of archived records, and no restore action exists (BQ-2, BQ-3).
- [ ] **AC-15** Nothing starts a run except an admin pressing the button. No cron or scheduled route exists for archiving (BQ-4).
- [ ] **AC-16** The admin audit screens show the "archived before <date>" line after the first successful run. Owner screens are unchanged (FR-12).
- [ ] **AC-17** No code path deletes `audit_trail` rows by age other than the move function (FR-16). The no-deletion-paths guard (C-34) stays green.
- [ ] **AC-18** No `console.*` in any new or touched file. No model names, no secrets.

---

## 10. Open Business Questions

All seven were answered by the user on 2026-09-25. They are kept here, with the answers, as the record of each decision.

- [x] **BQ-1: How long should audit records stay in the live system before they are archived?** *(raised by: BA · status: answered by user, 2026-09-25)*
  BA had recommended 365 days, adjustable per run, never less than 90.
  **Answer (changed from the recommendation):** archiving is manual. Before each run the admin picks the retention from a **dropdown with exactly three options: 365, 180 or 90 days**, with **365 preselected**. No free-form number. The server validates that the value is one of the three (Zod enum) and does not trust the client. The 90-day floor is implied by the options. Reflected in FR-1 to FR-4, §5.2, §6, AC-2 to AC-4 and AC-8.

- [x] **BQ-2: After archiving, do admins need to see or search archived records in the admin area?** *(raised by: BA · status: answered by user, 2026-09-25)*
  **Answer:** not in v1. No archive viewer; counts per run only. Reflected in FR-11, K-2 and AC-14.

- [x] **BQ-3: Will we ever need to put archived records back into the live system?** *(raised by: BA · status: answered by user, 2026-09-25)*
  **Answer:** accepted as recommended. No restore feature in v1. Rows are kept complete, so restore stays possible later. Reflected in §2, K-2 and AC-14.

- [x] **BQ-4: For v1, should archiving be a button an admin presses, or run automatically on a schedule?** *(raised by: BA · status: answered by user, 2026-09-25)*
  **Answer:** manual button only for v1. Reflected in FR-1 and AC-15.

- [x] **BQ-5: Are there any audit records that must never leave the live system?** *(raised by: BA · status: answered by user, 2026-09-25)*
  **Answer:** accepted as recommended. No exclusions; the FR-9 seam stays for a possible future legal hold. Reflected in FR-9 and §5.3.

- [x] **BQ-6: Is it acceptable that business owners' own activity history only shows the last year?** *(raised by: BA · status: answered by user, 2026-09-25)*
  **Answer:** accepted as recommended. Owners see one year by default. If an admin picks 180 or 90 days, owners' history shrinks accordingly. This is recorded as a known consequence (K-1), with **no owner-facing notice in v1**. Reflected in FR-4, FR-12, K-1 and AC-8.

- [x] **BQ-7: When an owner deletes their business's activity history or asks us to erase their personal data, should their archived records be removed too?** *(raised by: BA · status: answered by user, 2026-09-25)*
  **Answer:** yes, always. Business purge and GDPR erasure and export must all cover archived records. Reflected in FR-14 and AC-12 to AC-13.

---

## 11. Open Technical Questions (for SA / Dev)

These are not for the user. Each had a proposed resolution. All five were resolved by SA on 2026-09-25.

- [x] **TQ-1: Stale-run takeover (FR-8).** *Proposed:* a partial unique index on `archive_runs(source) WHERE status = 'running'`, plus a takeover rule that treats a run as dead once it is older than the Vercel maximum function duration plus a margin. This is the "provably dead" idea from §8.1 of the event-driven plan without its queue machinery, because there is no queue here. *(raised by: BA · status: resolved by SA, 2026-09-25)*
  **SA decision: accepted, made concrete.** Partial unique index `archive_runs(source) WHERE status = 'running'`; a start that hits it returns 409. Add one column, `last_batch_at`, written after every batch. The route exports `maxDuration = 60` (the repo's usual value) and stops starting new batches after a 45 s budget. A run still `running` whose `COALESCE(last_batch_at, started_at)` is older than **5 minutes** can only be a crashed request, so it is flipped to **`partial`** (not `failed`), with `error_code = 'interrupted'`, by a single conditional `UPDATE … WHERE status = 'running' AND … < now() - interval '5 minutes'`. Continue claims a run the same way (`UPDATE … SET status = 'running' WHERE id = $1 AND status IN ('partial','failed')`, 0 rows = 409). These are plain conditional updates through the repository. No claim RPC, lease table or heartbeat job is needed. *Why:* batches are atomic (FR-5), so an interrupted run is safe to resume with its stored cutoff. `partial` says that honestly, and it reuses the Continue path rather than adding a second recovery path.
- [x] **TQ-2: `applyRetentionPolicy()` (FR-16).** *Proposed:* Dev confirms whether it has callers. If none, SA decides whether to remove it or change it to delegate to the archive. It must never run in parallel with archiving. *(raised by: BA · status: resolved by SA, 2026-09-25)*
  **SA decision: remove it, in Slice 2.** SA grepped `app/`, `lib/`, `scripts/`, `components/` and `hooks/` on 2026-09-25. The only hit is its own definition at `lib/services/AuditTrailService.ts:468`, so it has **no callers** (this settles F-4). Also delete the `retentionPolicy` config and the `RetentionPolicy` type if nothing else reads them. *Why:* a method that deletes without archiving is exactly the second delete path FR-16 forbids. Making it delegate to the archive would keep a second entry point with its own defaults (`365` / `2555` days) that contradict the dropdown. Deleting it is smaller and leaves nothing to drift.
- [x] **TQ-3: INVOKER or DEFINER for the move function.** *Proposed:* `SECURITY INVOKER` called with the service role, because it needs no privilege the service role lacks, which keeps the "anon-callable DEFINER" class from growing. *(raised by: BA · status: resolved by SA, 2026-09-25)*
  **SA decision: `SECURITY INVOKER`, as proposed.** Add `SET search_path = ''` and schema-qualify every name. `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` explicitly: Postgres grants EXECUTE to `PUBLIC` by default, and Supabase's default privileges grant it to `anon`/`authenticated` on `public`, so leaving out the revoke is the usual way these functions become anon-callable. Then `GRANT EXECUTE … TO service_role`. Batch size is a **1,000-row** constant in the source registry, passed as the argument. It is tuned upward only if the manual QA run shows a batch well under 1 s. For the required statement shape, see condition C-3.
- [x] **TQ-4: lz4 availability.** *Proposed:* Dev runs `SHOW default_toast_compression` and a test `SET COMPRESSION lz4` on the project. Use lz4 if it is accepted, otherwise the default. Nothing else depends on this. *(raised by: BA · status: resolved by SA, 2026-09-25)*
  **SA decision: don't use lz4. Use the default compression and skip the check.** R-4 already says most audit rows are under the ~2 KB TOAST threshold, so the codec barely matters. The space saving comes from dropping the indexes (F-3). The check would add a manual PROD step and a branch in the DDL for nothing measurable. The `SET COMPRESSION` bullet in §5.1 is withdrawn (condition C-9).
- [x] **TQ-5: Does the Gap B B1 workplan need the latest cutoff from `ArchiveRepository`?** (R-1) *Proposed:* yes, as one read-only method. Record this in the Gap B requirement's integration notes when B1 is written. *(raised by: BA · status: resolved by SA, 2026-09-25)*
  **SA decision: yes. Gap B reuses the method FR-12 already needs, so there is no new one.** `ArchiveRepository.getLatestCutoff(source)` (the cutoff of the newest `succeeded` run, or `null`) is built in Slice 2 because the "archived before" notice needs it anyway. The Gap B B1 workplan consumes it and records the dependency in its own integration notes when it is written. This cycle does not edit the Gap B document.

---

## 12. Notes on Integration Points

| Area | Effect |
|---|---|
| **Database** | New migration in `supabase/migrations/`: `archived_records`, `archive_runs` (with the `retention_days IN (365, 180, 90)` check), `archive_audit_trail_batch(...)`, grants and revokes, with the FR-15 pre-check and a rollback in the header. `audit_trail` is only **read, deleted from, and (for erasure) updated**, and its schema and policies are unchanged |
| **Repository** | New `lib/repositories/ArchiveRepository.ts`, cross-account by design and documented as such. `AuditTrailRepository` is unchanged |
| **Service** | `lib/services/AuditTrailService.ts`: `exportUserData` and `anonymizeUserData` extended to the archive (FR-14b/c), `applyRetentionPolicy` resolved (FR-16). Check the file for `console.*` when touching it; the Pino logger is already in use |
| **Audit catalogue** | `lib/audit/events.ts`, `lib/audit/types.ts` (`AUDIT_ENTITY_TYPES`): three events and one entity type (FR-13) |
| **Validation** | One shared retention constant (`365 \| 180 \| 90`, default 365) used by the Zod schema in `lib/validation/` and by the page's dropdown (FR-2) |
| **API** | New `app/api/admin/archiving/` routes: overview (GET, with eligible counts for the selected retention), runs list (GET), start/continue run (POST). `requireAdmin` first in each |
| **UI** | New `app/admin/archiving/page.tsx`: source overview, retention dropdown (365 preselected), confirm dialog, run history. No archive viewer, no restore. Sidebar entry in the current **Admin** section next to Audit Trail. Under the [admin reorganisation](/docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md) it belongs in **Platform** (platform housekeeping); whichever change merges second moves the entry (one line) |
| **Existing screens** | `/admin/audit-trail` page and route, `/api/admin/users/[id]/audit-logs`: the "archived before" line (FR-12). Owner `/monitoring` and `/v2/monitoring`: **unchanged** (BQ-6, K-1) |
| **Business-data purge** | `lib/business-os/purge/descriptors.ts`: classify `archived_records` as `optional:activityHistory` (FR-14a). `descriptors.invariant.test.ts` must pass |
| **Guards that must stay green** | Admin authz surface guard (caps move deliberately); no-deletion-paths guard C-34; purge descriptor invariants |
| **Gap B (AI Activity view)** | Its B1 workplan must treat pre-cutoff actions as archived (R-1, TQ-5) |
| **Not touched** | `token_usage`, `audit_logs` (a different table), `AuditTrailService.log()` write path, owner RLS policy on `audit_trail`, any cron route |

**Suggested slicing (for Dev's workplan):** **Slice 1:** migration, repository, purge classification, and the AuditTrailService erasure/export changes, with no UI. The function can be proven on a copy of the data. **Slice 2:** API routes, admin page with the retention dropdown, audit events, and the "archived before" line.

> **SA note (2026-09-25):** the slicing above is **superseded** by §13.3, which follows the user's requested order (UI → runs + records → user delete scope).

---

## 13. SA Review

**Reviewed by SA — 2026-09-25**
**Status:** ✅ **CLEARED WITH CONDITIONS.** Dev may write the Slice 1 workplan now. Each later slice's workplan must show how it meets the conditions tagged for that slice.

The design is proportionate: one generic archive table, a run log, one atomic function per source, a manual button, and no S3 or destination abstraction. It fits the repository pattern, the `requireAdmin` gate, the `/admin` layout guard and the purge's descriptor discipline, and it adds no new pattern. The conditions fix three factual errors (F-8 caps, the nav section, where the purge's fail-closed actually bites) and one correctness trap in the move function (C-3). They also trim a few over-built items (C-9) and set the order in which the destructive path is switched on (C-5).

### 13.1 Verification of the BA's claims (against the tree, 2026-09-25)

| Claim | Verdict | Evidence |
|---|---|---|
| F-1: no DELETE-blocking trigger/rule on `audit_trail` in the repo | ✅ Confirmed for the repo. No `TRIGGER`/`RULE` in `supabase/SQL Scripts/create_audit_trail.sql`, and no migration other than the 2026-09-30 policy migration mentions `audit_trail`. The live state is still unknown (F-2), so FR-15's pre-check stays mandatory | grep over `supabase/` |
| F-3: 10 secondary indexes, 3 GIN | ✅ Confirmed | `create_audit_trail.sql:39-54` |
| F-4: `applyRetentionPolicy()` callers unknown | ✅ **Resolved: zero callers.** Only its definition matches | grep over `app lib scripts components hooks` |
| FR-14 (b)/(c): erasure/export may have no caller | ✅ **Confirmed: no production callers.** `anonymizeUserData` has none. `exportUserData` is called only by `scripts/test-audit-service.ts` | same grep |
| F-6: an unclassified archive table stops the purge | ⚠️ **Partly right.** The purge's live delete RPC `purge_business_data` sits in `supabase/held/` and is **not applied**, so no purge deletes anything in PROD today. The RPC is generic (iterates the `p_tables` list built from descriptors, `format('%I')`), so a new descriptor needs **no RPC or migration change**. What does fail on a missing or wrong classification is the descriptor invariant suite (`descriptors.invariant.test.ts`, SA-S3 baseline). Classifying in the same change is still required, for that suite and for when the hold lifts (C-4) | `lib/business-os/purge/capabilities.ts:66-82`; `supabase/held/20260916b_purge_business_data.sql:51-61,178` |
| F-7: C-34 no-deletion guard unaffected | ✅ Confirmed. Its table lists are identity tables only | `no-deletion-paths.guard.test.ts:97-123` |
| F-8 / §7 Security / AC-10: "new gated routes move the admin-authz guard's caps" | ❌ **Wrong.** `CAPS` in `lib/admin/__tests__/admin-authz-surface.guard.test.ts:373-381` count **exemptions** (parked/permanent), asserted by equality. A new route that calls `requireAdmin` adds no exemption, so **no cap moves**. A cap change in this feature's diff would be a red flag (C-1) | guard test `:369-381`, ratchet rule `:196-220` |
| §12 UI: nav entry "in the current Admin section… Platform under the reorganisation" | ❌ **Out of date.** Admin reorganisation slice 1 (PR #107) is on `main`. The sidebar sections are Monitor / Businesses / Settings / AgentsPilot (parked). There is no "Admin" section and no "Platform" section (C-2) | `git show origin/main:app/admin/components/AdminSidebar.tsx` |
| F-5 readers #1 and #2 | ✅ Confirmed. **Note:** both routes are **parked inline-`AdminAccessService` exemptions** (R1/R2 parked, slice 4). Editing them for FR-12 would put parked authz work into this feature (C-6) | guard test `:252-270` |
| §7 Repository precedent `TokenUsageRepository` | ✅ Confirmed. Documented service-role header, and all-accounts reads are separately **named** methods | `TokenUsageRepository.ts:1-24` |
| `AuditTrailService` logging | ✅ 0 `console.*` in `AuditTrailService.ts`, `lib/audit/events.ts`, `lib/audit/types.ts`, and the two audit routes/page. ⚠️ The service does query `audit_trail` directly rather than through a repository. This is pre-existing and flagged here, not fixed by this feature (C-7) | grep |

### 13.2 Conditions

| # | Condition | Priority | Slice |
|---|---|---|---|
| **C-1** | **Do not touch `CAPS` in the admin-authz guard.** New `/api/admin/archiving/*` handlers call `requireAdmin` as their **first statement**. That passes R1 without an exemption. The guard proves the gate is present, not that it comes first (OI-20), so SA checks the position by hand in code review. §7 Security and AC-10's "caps moved deliberately" should read "caps unchanged". | High | 1, 2 |
| **C-2** | `app/admin/archiving/page.tsx` must be a **`'use client'` component**, because R8 requires every `/admin` render entry point to be one. It inherits the server guard from `app/admin/layout.tsx`, so **no** per-page guard is added. The nav entry goes in the **Monitor** section, directly under "Audit trail". Branch from current `main`, not from `fix/insight-run-group-id-per-business`, whose sidebar predates PR #107. | High | 1 |
| **C-3** | **The move function must be PL/pgSQL with separate statements**: (1) select the batch ids, (2) `INSERT … SELECT … ON CONFLICT (source, source_id) DO NOTHING`, (3) `DELETE FROM public.audit_trail WHERE id = ANY(batch) AND EXISTS (SELECT 1 FROM public.archived_records r WHERE r.source = 'audit_trail' AND r.source_id = audit_trail.id::text)`. It must **not** be a single statement with data-modifying CTEs. All sub-statements of one statement share one snapshot, so the `EXISTS` would not see the rows just inserted. The batch would then delete nothing, or a "fix" that drops the `EXISTS` would break FR-5/FR-6. Also: `SECURITY INVOKER`, `SET search_path = ''`, and explicit REVOKE/GRANT (TQ-3). The choice of a database function over a TypeScript mover is recorded in [§13.5](#135-decision-d-1-the-move-is-a-database-function) (D-1). | High | 2 |
| **C-4** | **Purge classification ships in the Slice 2 PR that creates the tables**, not in Slice 3. `archived_records` → `optional:activityHistory`, scope `user_id`, band `LEAF`, mirroring `audit_trail`, **but with `snapshot: 'ids'`** (amended 2026-09-26). The purge's pre-delete snapshot refuses above 250,000 rows (`SNAPSHOT_ROW_CEILING`, `lib/business-os/purge/SnapshotWriter.ts:55`). Archived history is by definition the long tail, so a full-row snapshot of it could make a business with years of history impossible to purge. Six unbounded tables already use `'ids'` for the same reason. `archive_runs` → `never` (it has no `user_id` column: the admin is in `started_by`. It holds counts only and must never be purged). Add a unit assertion that `descriptorsForRun` with activity history ticked includes `archived_records`. **That assertion is how AC-12's behaviour part is proven.** A live purge cannot be run while `purge_business_data` is held. | High | 2 |
| **C-5** | **Runs are switched off in PROD until Slice 3 merges.** Add a code constant `ARCHIVE_RUNS_ENABLED = false` next to the source registry. The POST route checks it **server-side** after auth and Zod and returns 409 `runs_not_enabled`. The page disables the Archive button with a plain "Not switched on yet" note. Slice 3's PR flips it to `true`. *Why a constant and not an env var:* flipping it is then a reviewed diff with no dependency on Vercel access, and env var changes currently wait on Offir (see `CRON_SECRET`). *Why hold at all:* no automated erasure or export path exists today, so the practical gap is small, but BQ-7 said "always". Archived rows must not exist in PROD before the code that reaches them. | High | 2 → 3 |
| **C-6** | **FR-12's notice must not edit the two parked audit routes.** A small shared client component on `/admin/audit-trail` and in the per-user audit panel fetches the latest cutoff from the new `GET /api/admin/archiving` and shows "Entries before <date> are archived" when it is not null. | Medium | 3 |
| **C-7** | All access to `archived_records` / `archive_runs` goes through `ArchiveRepository` (service-role, documented header in the `TokenUsageRepository` style, all-accounts reads named as such, e.g. `countAuditTrailAllAccounts`). The Slice 3 changes to `AuditTrailService` **call the repository**. They do not add `.from('archived_records')` to the service. | Medium | 1–3 |
| **C-8** | **Erasure on the archive deletes the account's archived rows** (`ArchiveRepository.deleteArchivedForUser(userId)`) rather than anonymising the JSON payload. This matches BQ-7's wording ("removed too"), is stronger for erasure, and needs no jsonb-rewrite SQL function or Slice 3 migration. Live rows keep today's anonymise behaviour. BA to amend FR-14(b) wording to match. If the user prefers anonymise parity, that costs one SQL function and one extra PROD migration in Slice 3. | Medium | 3 |
| **C-9** | **Simplifications (withdrawn from the design):** (a) drop `archive_runs.destination`. A column that is always `'supabase'` is not a seam, and adding it with S3 is a one-line migration. (b) The TS source registry carries **no `exclusions` field**. Exclusions live in the per-source SQL function, and an always-empty TS array would be dead code. (c) No lz4 (TQ-4). (d) The overview returns eligible counts for **all three** retention options in one response, so changing the dropdown is client-only with no refetch. (e) Two route files only: `GET /api/admin/archiving` (overview, plus runs from Slice 2) and `POST /api/admin/archiving/runs` (Zod discriminated union: `{ action: 'start', source, retentionDays }` \| `{ action: 'continue', runId }`). (f) Audit events: `ARCHIVE_RUN_STARTED` on a new run only, and `_COMPLETED`/`_FAILED` on a terminal state. A `partial` request writes none, because the run log is the record. | Medium | 1–2 |
| **C-10** | **AC-4 reword:** "operational + archived = operational before" does not hold while new rows are being inserted. Measure it over `created_at < cutoff`: rows before the cutoff afterwards = 0, and archived rows for the run = eligible rows before the run (less any already archived by an earlier interrupted attempt). | Low | 2 |
| **C-11** | ~~`archived_records.user_id` mirrors the source FK: `REFERENCES auth.users(id) ON DELETE SET NULL`. Account deletion then treats live and archived rows alike.~~ *Superseded by the Slice 2 SA review (2026-09-26): no FK, so erasure by `user_id` still finds archived rows after account deletion.* | Low | 2 |
| **C-12** | Continue is allowed from `partial` **and** `failed`, with the same stored cutoff (AC-6 says "after any interruption"). A new Start after a `failed` run is also allowed and takes a new cutoff. | Low | 2 |
| **C-13** | **Remove `applyRetentionPolicy()`; do not extend it** (TQ-2, D-1). Also remove its now-unused `retentionPolicy` config and `RetentionPolicy` type. AC-17 is then verified by grep in code review. No new guard test (simplicity). | Low | 2 |
| **C-14** | *(Added 2026-09-26, correcting the 2026-09-25 review, which missed it.)* **Add `archived_records` to `USER_OWNED_TABLES` in `lib/business-os/businessOwnedTables.ts`**, in the Slice 2 PR that creates it, with a reason (e.g. "the person's own archived activity history. Like `audit_trail`, it follows the account, not the business"). `lib/business-os/__tests__/businessOwnedTables.test.ts:108` scans **every migration** for tables with a `user_id` column and fails on any that are unclassified, so M1 turns it red without this line. This test, not the held purge RPC, is the check that actually fails closed today. `audit_trail` itself is **not** listed there: its DDL lives in `supabase/SQL Scripts/`, which the scan does not read (F-2). So there is no entry to mirror, and `archived_records` is the first archive-side entry. `archive_runs` has no `user_id` column, so it is not caught. | High | 2 |
| **C-15** | **UI reuses existing parts; no custom confirm component.** The dropdown uses `components/ui/select.tsx`, the confirm step `components/ui/dialog.tsx` (Radix, keyboard-operable, which meets the §7 accessibility NFR), and run status `components/ui/badge.tsx` with a text label, not colour alone. Slice 1's "Not available yet" panels copy the style of `app/admin/business-os-tiers/components/NotBuiltPanel.tsx`. Browser `confirm()` (used elsewhere in admin) is **not** acceptable here, because it cannot show the counts or the K-1 sentence. | Medium | 1, 2 |
| **C-16** | **Audit events reuse the existing catalogue.** Add the three events to `AUDIT_EVENTS` (`lib/audit/events.ts`) and `archive_run` to `AUDIT_ENTITY_TYPES` (`lib/audit/types.ts`). `lib/audit/filterOptions.ts` already derives the `/admin/audit-trail` filters from both, so AC-9's "selectable in the filters" needs **no** page or route change. | Low | 2 |
| **C-17** | **Pre-existing, out of scope, recorded only:** `AuditTrailService.anonymizeUserData` (`lib/services/AuditTrailService.ts:428-463`) nulls ids, IP, user agent and session and replaces `details`, but **leaves `changes` and `resource_name` untouched**, and both can hold personal data. This affects live rows only (archived rows are deleted, C-8). It has no production caller today. Not fixed by this feature. It needs its own item before erasure is wired to any caller. **Added 2026-09-26 (Slice 2a review, CR-3):** it also leaves the live `user_email` column (filled by the `trigger_sync_audit_user_email` BEFORE INSERT trigger) while it nulls `user_id`, so a row anonymised and then archived keeps the email in `payload` but can no longer be found by `user_id`. Whoever fixes C-17 also nulls `user_email`; **Slice 3** decides whether erasure also matches archived rows by `payload->>'user_email'`. | Info | 3 |

### 13.3 Slice plan (user's order: UI → runs + records → user delete scope)

Each slice is its own branch and PR (`feature/admin-archiving-sN`), with the full Dev → SA → QA → user → RM cycle, because Slices 2 and 3 touch data and security.

#### Slice 1 — the `/admin/archiving` page (read-only)

| | |
|---|---|
| **Scope** | `lib/archiving/config.ts` (the shared retention constant `[365, 180, 90]` with default 365, a source registry with one `audit_trail` entry, `ARCHIVE_RUNS_ENABLED = false`). It must be client-safe with no server imports. `lib/validation/archiving.ts` (Zod enum built from the constant). `lib/repositories/ArchiveRepository.ts` (**read-only** methods over `audit_trail` only: total count, oldest `created_at`, eligible count per option, using `count: 'exact', head: true`, F-10). `app/api/admin/archiving/route.ts` GET (`requireAdmin` first, Pino with a `correlationId`). `app/admin/archiving/page.tsx` (`'use client'`), built from the existing `select` / `badge` primitives and `NotBuiltPanel`-style panels, with no new UI primitives (C-15). One sidebar line (C-2). Tests: constant/schema unit tests (FR-2 cases), repository unit tests, and route tests for 200/401/403. |
| **Observable at the end** | The admin sees **Archiving** under Monitor. The audit-trail card shows **real** row count, oldest record and eligible counts, and the dropdown (365 preselected) switches between them instantly. The Archive button is disabled with "Not switched on yet". Archived total, last run and run history show **"Not available yet"**, not a fake `0` or "No runs yet". |
| **Deliberately NOT** | No migration, no writes, no confirm dialog, no POST route, nothing destructive. |
| **Dependencies** | None. |
| **Migrations (PROD, by hand)** | **None.** |
| **Closes** | AC-2 (full). AC-1 (partial: count, oldest, eligible). AC-10 for GET. AC-14, AC-15. AC-18 for touched files. AC-3's schema is unit-tested here, and the route-level AC-3 comes in Slice 2. |

#### Slice 2 — runs and records (built, but switched off in PROD)

| | |
|---|---|
| **Scope** | **Migration M1** (`archived_records`, `archive_runs` with the `retention_days IN (365,180,90)` CHECK, `last_batch_at`, the running-per-source partial unique index, `archive_audit_trail_batch(run_id, cutoff, batch_size)`, the PL/pgSQL move function chosen in D-1 and shaped per C-3, 1,000-row batches, RLS on with no policies, REVOKE ALL from `anon`/`authenticated`, REVOKE/GRANT EXECUTE; FR-15 pre-check and rollback in the header). `ArchiveRepository` run methods (create, claim-continue, stale-takeover per TQ-1, run batch, finish, list runs, archived total, `getLatestCutoff`). `POST /api/admin/archiving/runs` (Zod, 409 on concurrency, 409 `runs_not_enabled` per C-5, time budget per TQ-1). GET extended with runs, archived total and last run. The page gets the confirm step on the Radix `dialog` (retention, cutoff, row count, plus the K-1 sentence for 180/90), run history with `badge` statuses, and Continue (C-15). Existing audit catalogue extended: 3 events in `AUDIT_EVENTS`, `archive_run` in `AUDIT_ENTITY_TYPES` (C-16). **Both classification registries in the same PR:** purge descriptors for both tables with `snapshot: 'ids'` for `archived_records` (C-4), and `archived_records` in `USER_OWNED_TABLES` (C-14). `applyRetentionPolicy` **removed, not extended** (C-13). |
| **Observable at the end** | In PROD: both tables exist and are locked down (AC-11 live check). The page shows archived total `0` and "No runs yet" (now true). The confirm dialog opens. **Start is refused server-side** (409 `runs_not_enabled`), and the button stays disabled. The move function is proven by the user/QA in the Supabase SQL editor with `BEGIN; SELECT public.archive_audit_trail_batch(...); <checks>; ROLLBACK;`, covering atomicity and a re-run no-op (AC-5, AC-6) with nothing kept. The route logic is proven by Jest with the constant overridden. |
| **Deliberately NOT** | No real run in PROD. No erasure or export change. No "archived before" notice (nothing can have been archived yet). |
| **Dependencies** | Slice 1 merged. **M1 applied to PROD before this PR's code deploys**: the GET now reads the new tables. M1 is additive, so applying it early is safe. |
| **Migrations (PROD, by hand)** | **M1**, in order: (1) run the FR-15 read-only pre-check and send the output to Dev; stop if a DELETE-blocking trigger or rule exists; (2) apply M1; (3) run the AC-11 checks: as `anon`/`authenticated`, `SELECT` on both tables and `EXECUTE` of the function must fail; (4) keep the header rollback ready. |
| **Closes** | AC-3, AC-5 (strict, per D-1), AC-7, AC-8, AC-10 (POST), AC-11, AC-12 (classification + `descriptorsForRun` assertion), AC-17. AC-4, AC-6, AC-9 are proven in tests and in the rollback-wrapped SQL, and confirmed live in Slice 3. |
| **Size** | The largest slice. If the workplan runs long, Dev may split it into **2a** (M1 + repository + both classification registries + retention-method removal) and **2b** (POST route, UI wiring, audit events), in that order. C-14 must land in the same PR as M1 whichever way it is split. The user's three-step order is unchanged. |

#### Slice 3 — user delete scope, then switch on

| | |
|---|---|
| **Scope** | `AuditTrailService.anonymizeUserData` also calls `ArchiveRepository.deleteArchivedForUser` (C-8). `exportUserData` adds the account's archived rows through `ArchiveRepository.listArchivedForUser`. The "archived before" notice component on `/admin/audit-trail` and in the per-user panel (C-6). **Flip `ARCHIVE_RUNS_ENABLED` to `true`.** Business purge needs no new code: its classification landed in Slice 2 (C-4). |
| **Observable at the end** | Archiving is live. The user runs the first real archive at 365 days, and QA records it: counts before and after, the run row, the two audit events visible in the `/admin/audit-trail` filters, and the notice appearing. Erasure and export are proven by unit/integration tests. Neither has a production caller today (§13.1), so this makes them correct for when one is added. |
| **Deliberately NOT** | No owner-facing notice (BQ-6), no viewer or restore, no cron, no fix to the pre-existing direct DB access in `AuditTrailService`, and no fix to `anonymizeUserData` leaving `changes` / `resource_name` on live rows (C-17). |
| **Dependencies** | Slice 2 merged and M1 applied. |
| **Migrations (PROD, by hand)** | **None** (given C-8). If the user chooses anonymise-parity instead, one function migration **M2** is added here. |
| **Closes** | AC-13, AC-16. AC-12 (behaviour, unit-level while the purge RPC is held). Live confirmation of AC-1 (full), AC-4, AC-6 and AC-9. |

### 13.4 Approval

- [x] Requirement cleared for workplan, with conditions C-1 to C-17 (C-14 to C-17 added 2026-09-26)
- [ ] Slice 1 workplan reviewed (C-1, C-2, C-15 must be visible in it)
- [ ] Slice 2 workplan reviewed (C-3, C-4, C-5, C-9 to C-16 and D-1 must be visible in it)
- [ ] Slice 3 workplan reviewed (C-6, C-8, and the C-5 flip)

### 13.5 Decision D-1: the move is a database function

**Decided by the user, 2026-09-26.** Recorded by SA.

**Question.** How does a batch of rows move from `audit_trail` to `archived_records`?

| Option | Shape |
|---|---|
| **(a) PL/pgSQL move function** ✅ chosen | `archive_audit_trail_batch(run_id, cutoff, batch_size)`: select ids, copy, then delete only the ids now in the archive. All three steps run in **one database transaction** (§5.3, C-3) |
| **(b) TypeScript mover** | Built on the `applyRetentionPolicy()` shape: the repository reads N old rows, upserts them into the archive, reads back which ids landed, then deletes those. Each step is a separate PostgREST call, so there is no shared transaction |

**Why (a).**
- **No record is ever in both tables.** Under (b), a crash between the copy and the delete leaves rows in both tables until the next run tidies up. Under (a) a batch either happened completely or not at all.
- **An exact copy, made inside the database.** `to_jsonb(row)` is taken in-database. (b) sends every row through JSON to the server and back, which risks subtle type drift (timestamps, numerics, arrays) in what is meant to be a faithful record.
- **1,000-row batches instead of about 200.** (b)'s delete puts the ids in the request URL, which caps batch size. Fewer, larger batches mean more rows per 45 s request and **fewer Continue clicks**, especially on the first 90-day run.
- **(b) is not materially simpler.** It removes about 25 lines of SQL and one permission lockdown. In exchange it adds a read-back step, weaker atomicity, and a documented "rows may briefly be in both" state that every reader (erasure, export, counts) would have to tolerate.

**Accepted costs.**
- **One more database object to lock down.** The function must follow C-3 exactly: `SECURITY INVOKER`, `SET search_path = ''`, EXECUTE revoked from `PUBLIC`/`anon`/`authenticated`, granted to `service_role` only, and separate statements rather than data-modifying CTEs. AC-11 checks it live.
- **Changing the move needs a migration.** Every change is a by-hand PROD apply.
- **It is proven by a rolled-back dry run.** Jest cannot run PL/pgSQL, so AC-5 and AC-6 are proven in the Supabase SQL editor inside `BEGIN … ROLLBACK`, and QA records the output.

**AC-5 stays strict:** a batch forced to fail partway leaves **both** tables unchanged.

**What this does not decide.** The future S3 step (§6) will be a **write-verify-delete mover in TypeScript** regardless, like the purge's `SnapshotWriter`, because object storage cannot join a database transaction. That is a property of the destination. It **does not argue for (b) now**: inside one database the atomic option is available and costs little, so v1 takes it.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-25 | Created | Initial draft. Researched the audit_trail DDL and live-drift evidence, its five readers, the purge classification, the admin gate and the dormant-cron state. Recommends one generic archive table, a run log, one atomic batch function per source, and a manual admin run in v1 |
| 2026-09-25 | Business questions answered; status → Ready for SA review | User answered BQ-1 to BQ-7. **BQ-1 changed from the BA proposal:** retention is a dropdown of exactly 365 / 180 / 90 days (365 preselected), validated server-side as a Zod enum, with no free-form value or separate floor. BQ-2 to BQ-6 accepted as recommended: no viewer, no restore, manual button only, no exclusions, no owner notice. BQ-7: purge, erasure and export always cover the archive. FR-1 to FR-4, FR-9, FR-11, FR-12, FR-14, §5.2, §6, NFRs and ACs updated; added Known Consequences K-1 (owner history follows the chosen retention) and K-2 (no view/restore); ACs renumbered AC-1 to AC-18. TQ-1 to TQ-5 remain open for SA |
| 2026-09-25 | SA review: CLEARED WITH CONDITIONS | Added §13. Verified the BA's claims against the tree: `applyRetentionPolicy` has no callers; erasure/export have no production callers; the purge delete RPC is held, so classification is enforced by the invariant suite; **F-8 was wrong** (guard caps count exemptions, so gated routes move none); the nav target was out of date after PR #107. Resolved TQ-1 to TQ-5 in §11. Set conditions C-1 to C-13, including the snapshot trap in the move function (C-3), purge classification in Slice 2 (C-4), runs server-disabled until Slice 3 (C-5), and erasure deleting archived rows (C-8, BA to amend FR-14(b)). Added the three-slice plan (UI → runs + records → user delete scope), which supersedes §12's suggested slicing |
| 2026-09-25 | FR-14(b) amended per SA condition C-8 | GDPR erasure now **deletes** the account's archived rows (`ArchiveRepository.deleteArchivedForUser(userId)`) instead of anonymising them; live rows keep today's anonymise behaviour. Matches BQ-7 ("removed too"). AC-13 reworded to match (archived rows deleted, other accounts untouched), and §5.1's note dropped the anonymisation `UPDATE`. No other section changed; §13 kept as written by SA |
| 2026-09-26 | Decision D-1 recorded; conditions C-14 to C-17 added | User chose option (a): the move stays a PL/pgSQL function with strict all-or-nothing batches (added §13.5 with options, rationale and accepted costs; AC-5 stays strict; the future S3 mover will be TypeScript write-verify-delete regardless). Folded in the infrastructure-reuse findings: **C-14** `archived_records` in `USER_OWNED_TABLES` (corrects the 2026-09-25 review, which missed `businessOwnedTables.test.ts`), C-4 amended to `snapshot: 'ids'` (250k snapshot ceiling), C-13 made explicit (removed, not extended), **C-15** UI reuses Radix `dialog`/`select`/`badge` and the `NotBuiltPanel` style, **C-16** audit catalogue reuse, **C-17** pre-existing `anonymizeUserData` gap recorded as out of scope. §13.3 slice tables and §13.4 approval updated to match |
| 2026-09-26 | C-11 superseded (Slice 2 SA review, R-1) | `archived_records.user_id` has no FK to `auth.users`: `ON DELETE SET NULL` would have nulled the column while the payload kept the personal data, hiding the row from erasure and purge. Recorded in §13.2 by Dev in the Slice 2a PR |
