# Workplan: Business OS Export MX-7 (E10) — Drop the old table

> **Last Updated**: 2026-11-26

**Developer:** Dev (EXPORT session)
**Step:** E10 (user's numbering) = doc slice MX-7, the last slice of the export stream
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) §6 (MX-7 row), §7 (AC MX-7), §10 (XC-11, XC-12, XC-16), §11 (S-1, S-3, S-16, SR-2, SR-5, SR-6)
**Plan:** [BUSINESS_OS_EXPORT_REDESIGN_PLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md) §3 (CC-1…CC-8, frozen interfaces), §4.10 (quoted in §2 below)
**Earlier slices this builds on:** [MX-1a](/docs/workplans/BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md) (the regeneration and paste procedure copied here), [MX-3.1](/docs/workplans/BUSINESS_OS_EXPORT_MX3_1_WORKPLAN.md) (ZIP code removed, bucket emptied after deploy), [MX-4](/docs/workplans/BUSINESS_OS_EXPORT_MX4_WORKPLAN.md) (`findDeletionFacts` reads old and new tables; the three stale descriptor strings), [MX-5](/docs/workplans/BUSINESS_OS_EXPORT_MX5_WORKPLAN.md) (structure of this file)
**Coordination:** `C:/Users/Barak/My Projects/AgentsPilot/SELF_SERVICE_EXIT_COORDINATION.md` (outside git). CC-1 read on 2026-11-25: l.285 is the EXPORT "E10 (MX-7) STARTED" entry (cleanup-regen lock taken, 20261134 + 20261135 reserved, claims listed); l.286 is DELETE's acknowledgement
**Branch:** `feature/bos-export-mx7-drop-old-table` (RM-created, worktree `neuronforge-mx7`, off `origin/main` `aa4c1310`). Dev confirmed it with `git branch --show-current` on 2026-11-25 before writing this file. Not `main`
**Date:** 2026-11-25
**Status:** Code Complete 2026-11-26 (Tasks 2 to 9, Dev). Uncommitted on the branch; SA code review next. SA approved the workplan with conditions 2026-11-25; M-1 to M-3 and the S-4 claim list folded in by Dev on 2026-11-25

---

## Overview

MX-7 removes what is left of the ZIP-era "Download my data" export. Nothing has called it since MX-3.1 (2026-10-30). It drops the table `business_os_data_exports` and its start function (from migration 20261074). It regenerates the test-account cleanup function so it no longer names that table or the bucket. `findDeletionFacts` then reads only the two module-export tables. The ZIP-only server code goes (the job repository's ZIP methods, the storage repository, `jobPolicy.ts`, `toCsv`). The bucket `business-data-exports` and its descriptor are deleted. The three stale descriptor strings carried over from MX-4 are fixed in the same file.

It is **two migrations in a fixed order** (SR-6): **20261134** = the regenerated cleanup function, chained on 20261130; then **20261135** = the DROP. One sitting, in the order SA set (M-1): the user pastes 20261134, the PR is enqueued at once, and only when the deploy is Ready does the user paste 20261135 and then delete the bucket. From the 20261134 paste until the 20261135 checker passes, admin deletes and test-account cleanup refuse (they fail closed). No data is dropped while the merge is pending.

**Lock: held (cleanup-regen, EXPORT E10). Migrations: two. Manual prod gate: yes. Switch: none.** Effort 🟢 1.5 d budgeted, 1.75 d planned (§9).

---

## Table of Contents

1. [Analysis summary (evidence)](#1-analysis-summary-evidence)
2. [Approved scope (verbatim)](#2-approved-scope-verbatim)
3. [Constraints carried into this slice](#3-constraints-carried-into-this-slice)
4. [Design](#4-design)
5. [Files to create / modify / delete](#5-files-to-create--modify--delete)
6. [Task list](#6-task-list)
7. [Test plan](#7-test-plan)
8. [Verification, prod apply and live checks](#8-verification-prod-apply-and-live-checks)
9. [Effort](#9-effort)
10. [Coordination (CC-1 … CC-8)](#10-coordination-cc-1--cc-8)
11. [Acceptance criteria mapping](#11-acceptance-criteria-mapping)
12. [Risks](#12-risks)
13. [Open questions for SA](#13-open-questions-for-sa)
14. [Open questions for the user](#14-open-questions-for-the-user)
15. [Live schema checks requested](#15-live-schema-checks-requested)

---

## 1. Analysis summary (evidence)

Every claim below was read on this branch (`aa4c1310`, fresh `origin/main`). Line numbers are as read. Nothing was read from a live database (§15 lists what is needed).

### 1.1 The established facts, checked

| # | Fact (from the brief) | Checked | Evidence |
|---|---|---|---|
| E-1 | The cleanup-regen lock is EXPORT's, and 20261134 + 20261135 are reserved | ✅ | Coordination file l.285 ("Took the cleanup-regen lock. RESERVED 20261134 … + 20261135 …"), l.286 (DELETE acknowledged). Earlier lock rows l.75, l.78 are released |
| E-2 | Main's `FUNCTION_MIGRATION` is `20261130_operator_test_account_cleanup_client_standing`, so 20261134 chains on 20261130 | ✅ | `scripts/generate-test-account-cleanup-sql.ts` l.189 (`FUNCTION_MIGRATION`), l.191 (`PREVIOUS_FUNCTION_MIGRATION` = 20261127). Version file stamp `5c369aaf2fa78abf` (`lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts`) |
| E-3 | Main gained regenerations 20261120, 22, 27 and 30 outside the coordination file; the highest migration on main is 20261133 | ✅ | `ls supabase/migrations` ends at `20261133_a_period_nobody_invoiced_is_not_late.sql`; no 20261134 or 20261135 on disk. The four regens are in the drift test's `APPLIED` (l.791–811) and `APPLIED_TARGET` (l.825–837). DELETE confirmed they are not its own (coordination l.286) |
| E-4 | 20261130 may not be live yet | ✅ **Settled by LC-8** (2026-11-25: the live function carries `5c369aaf2fa78abf`) | The `APPLIED_TARGET` comment (drift test l.832–834) and commit `8bab24ca` say "NOT YET APPLIED … must be run against prod and its stamp confirmed live before #663 goes in". #663 is merged, so it was most likely applied, but this must be **proved** (live check LC-8) before 20261134 is pasted: 20261134's rollback restores 20261130 |
| E-5 | SR-5 pre-apply check | ✅ | Requirement §11 S-1 row (l.381) and SR-5 (l.554); plan §4.10 "Manual prod gate"; coordination l.54 |
| E-6 | `findDeletionFacts` is frozen; only its body changes; receipt meaning XC-12 | ✅ | Plan §3 frozen row (l.103); requirement B.6 (l.575–586): "After MX-7: new tables only"; S-3 (l.383) |
| E-7 | `DATA_EXPORT_*` audit constants are kept forever | ✅ | Plan l.229 ("**Forever:** the `DATA_EXPORT_READY` / … audit constants"). MX-7 does not open `lib/audit/events.ts` (its l.122 comment naming the old table stays) |
| E-8 | `lib/business-os/account-deletion/receiptInput.ts` is DELETE's | ✅ | Requirement SR-1 (l.550), B.1 (l.368). Not opened |

### 1.2 Who still uses the old objects

| # | Object | Callers on main | Evidence |
|---|---|---|---|
| E-9 | `BusinessOsDataExportJobRepository` | **Only `findDeletionFacts`**, from two DELETE routes: `app/api/business-os/account/deletion-check/route.ts` l.134 and `app/api/admin/test-account-cleanup/delete/route.ts` l.164. Their four test files mock the class with `findDeletionFacts` only. Every other method (`startForOwner`, `startForAdmin`, `findById`, `findOwnerJobById`, `findLatestForUser`, `findLatestCompletedForUser`, `listForUser`, `markReady`, `markFailed`, `markOwnerDownloaded`, `expireOtherReady`, `markExpired`, `listDueForExpiry`, `listStaleRunning`, `findJobsByIds`), the singleton `businessOsDataExportJobRepository`, `DATA_EXPORT_JOB_COLUMNS` and `DATA_EXPORT_JOB_LIMITS` has **no caller** outside the file, its test and the barrel | grep over `app lib components hooks scripts supabase tests`; repository l.105–629; barrel `lib/repositories/index.ts` l.344–361 |
| E-10 | `findDeletionFacts` today | Four reads on `user_id`: O1 newest owner ZIP `ready_at` + `owner_downloaded_at` and O2 head count of admin ZIP rows (old table), N1 `findLatestOwnerSentAt` and N2 `hasAdminOriginRequest` (new tables, through their own repositories). The newer of O1 and N1 wins; a tie goes to the module job | `BusinessOsDataExportJobRepository.ts` l.272–352 |
| E-11 | `BusinessOsDataExportStorageRepository` (+ `ExportBucketListing`, `ExportBucketObject`, `ExportFileBudget`) | **No caller** outside its own test and the barrel | barrel l.362–370; `lib/repositories/types.ts` l.1448–1506 |
| E-12 | `lib/business-os/data-export/jobPolicy.ts` (`EXPORT_JOB_POLICY`, `exportObjectPath`) | Only the job repository (l.38, l.390), the storage repository (l.27), `jobPolicy.test.ts`, the job repository test (l.33) and the 20261074 migration test (l.19, MT-11 l.279–289). Comment mentions only in `moduleExportPolicy.ts` l.18 (EXPORT), `closureLifecycle.ts` l.16 and `business-os-account-closures.migration.test.ts` l.7 (both DELETE: "the jobPolicy.ts precedent", history, not edited) | grep |
| E-13 | `csv.ts` `toCsv` (l.89–92) | **No production caller.** Only `csv.test.ts` l.11 and l.30. `toCsvText` (l.79–85) is called only by `toCsv` and tests. The module CSV uses `csvLine`, `csvHeaderLine`, `csvPartText` (`csvParts.ts` l.22, `joinedCsv.ts` l.37). The `toCsv` in `lib/payments/csv.ts` is a different function (LX-1) and is not touched | grep |
| E-14 | The start function `business_os_data_export_start(uuid, uuid, text)` | Named only by the job repository (l.56) and its test, and by the 20261074 migration test (history). No route, cron or script calls it | grep; `supabase/migrations/20261074_business_os_data_exports.sql` l.93, l.155–157 |
| E-15 | Crons | `vercel.json` has only `/api/cron/data-export-modules` (l.90); `/api/cron/data-export` was removed in MX-3.1 (`lib/cron/__tests__/bosCronJobs.test.ts` l.91). No migration schedules a `pg_cron` job naming a data export. ✅ **Settled by LC-7** (2026-11-25): `pg_cron` is not installed | grep; LC-7 |
| E-16 | Types in `lib/repositories/types.ts` l.1378–1506 (DE-8a jobs + DE-8b files) | All 17 are dead after MX-7. Five of them (`ExportOwnerObject`, `ExportOwnerObjects`, `ExportOwnerFolders`, `ExportLiveDocumentFile`, `ExportMediaPath`) are **already** dead since MX-3.1 deleted `BusinessDataExportFilesRepository`. See SA-Q6 | grep, each type name |

### 1.3 Where the old table and bucket appear

| # | Place | What it holds | Evidence |
|---|---|---|---|
| E-17 | Generator | `FUNCTION_REQUIRED_TABLES` entry (l.232–236) makes the migration refuse until the table exists. The table enters the plan **from the purge descriptor** (`descriptorsForRun`, import l.75–79), not from a list in the generator. The bucket list comes from `STORAGE_DESCRIPTORS` (l.1284, l.1554). So removing the two descriptors removes both from the generated SQL; removing the `FUNCTION_REQUIRED_TABLES` entry removes the order guard (20261130 l.40–41) | generator; 20261130 l.10, l.40, l.166, l.367, l.834, l.948 |
| E-18 | Pasted SQL | `scripts/test-account-cleanup-check.sql` l.52, l.253, l.720, l.834; `scripts/test-account-cleanup-delete.sql` l.76, l.277, l.744, l.856, l.1033 | regenerated, never hand-edited |
| E-19 | `descriptors.ts` | Table descriptor l.1367–1369 (`level: 'purge'`, `area: 'data_exports'`, reason `EXPORT_REASON.EXPORT_ITSELF`); bucket descriptor l.1621–1623. `EXPORT_REASON.EXPORT_ITSELF` (l.77) is used only by these two | `descriptors.ts` |
| E-20 | Ownership registry | `lib/business-os/businessOwnedTables.ts` l.251–255 `USER_OWNED_TABLES.business_os_data_exports`. **Not in the plan's Touches list, but it must go in the same PR**: `businessOwnedTables.test.ts` "direction 3" (l.272–274) fails if a user-owned table has no descriptor. Its migration scanner replays `CREATE TABLE` and `DROP TABLE` in file order (l.47–85), so the DROP in 20261135 also removes the table from what the scanner demands. See SA-Q8 | as named |
| E-21 | Count pins | `exportClassification.test.ts` l.1397 `{ include: 38, planned: 0, exclude: 130 }` (168); `descriptors.invariant.test.ts` l.889 `baseline.count` 168 (history comment l.871); `classification-baseline.json` l.3 `count: 168`, l.56 level, l.182 note; bucket test `exportClassification.test.ts` l.341–350 (names `business-data-exports`). After MX-7: **167 = 38 + 0 + 129** | as named |
| E-22 | Drift test | `scripts/__tests__/testAccountCleanupSql.test.ts`: l.514–515 previous pin; l.636–662 required-tables tests; l.785–837 `APPLIED` / `APPLIED_TARGET`; l.1057–1058 **asserts the generated migration still names `'business_os_data_exports'`** (flips in MX-7) | as named |
| E-23 | Older-version allow-lists | `no-deletion-paths.guard.test.ts` l.119–160 and l.289–310 (built from `INITIAL_FUNCTION_MIGRATION`, never a literal, R-7), l.730–750 (the "previous slot" test); `business-os-credit-lots.migration.test.ts` l.840–858 (L8 list by name) | as named |
| E-24 | The DE-8a migration test | `supabase/migrations/__tests__/business-os-data-exports.migration.test.ts` pins the applied 20261074, the 20261075 cleanup file and the five DE-8a scripts as history (literal stamp `a824848e0a538477`, l.22). Only MT-11 (l.279–289) and the import (l.19) depend on `jobPolicy.ts` | as named |
| E-25 | PROD-2 baseline (DevOps) | Three places name the bucket (corrected by SA): `supabase/baseline/before-schema.sql` l.150 (the empty-target guard), `after-schema.sql` l.95–108 (inserts five buckets and checks that five landed), and `scripts/__tests__/schemaParityBaseline.test.ts` l.540–550 plus its negative control at l.1042, which deletes exactly this bucket's insert line. After the bucket delete the source project has four. **Not edited in this PR** (SA M-2): they belong to the open DevOps PROD-2 stream (live gate U5r owed). A hand-off goes to DevOps before the PR opens (Task 10b) | as named; SA review |
| E-26 | Other DE-8a scripts | `scripts/precheck-`, `check-`, `probe-`, `rollback-business-os-data-exports.sql`, `measure-data-export-size.sql`, `precheck-bos-boost-reversal-events.sql` l.33. All historical and pinned by tests. **`rollback-business-os-data-exports.sql`'s guard checks only the retired 6-argument cleanup signature**, which 20261081 dropped, so that guard no longer protects anything. It becomes moot once the table is gone (SA-Q14) | as named |

### 1.4 What the deploy window does

| # | Question | Answer | Evidence |
|---|---|---|---|
| E-27 | What refuses while the database and the deployed build disagree? | (a) **Version stamp:** from the 20261134 paste until the build pinning the new stamp is live, every admin delete, check and test-account cleanup answers `function_out_of_date` (XC-11). (b) **Schema reconciler:** a live tenant table with no descriptor is `unclassified`, and a deletable descriptor whose table is gone is `missingDeletable`; both make the status `drift`, which blocks admin deletes (R-8). So old code after 20261135 and new code before 20261135 both block. Both fail closed, and both fall inside the window in (a) | `lib/business-os/purge/SchemaReconciler.ts` l.14–16, l.164–188; used by `adminDeletionFacts.ts` |
| E-28 | Owner-side effects in the window | The old `findDeletionFacts` errors once the table is gone. The owner's deletion check then shows "none on record", and DELETE's E route refuses before removing anything (B.6 "DELETE's side"). Owner Reset and Purge iterate `STORAGE_DESCRIPTORS` (`ResetService.ts` l.462–466) and the purge descriptors; Purge is still inert (memory) and Reset does not reach a `purge`-level table | as named |
| E-29 | Why the bucket must be **empty before** the deploy and **deleted after** it | `TestAccountCleanupRepository.ts` l.463–468 refuses a storage path outside the known buckets. A leftover object listed by the old function would then block a cleanup delete. Deleting the bucket before the deploy would make the old build's Purge and Reset storage step report a failure for a missing bucket. MX-3.1's post-deploy step emptied it: "2 -> 0 objects" on 2026-10-31 | coordination l.251; contents doc l.1025 |
| E-30 | How a regeneration is done (copied in §4.2 and §8) | MX-1a §5 (generator constants, `npx tsx`, numstat check), §6 T-7…T-9 (pins), §7 (read-only Q-1…Q-6), §8 (paste procedure, one pause window), §9 (rollback order). The latest regen, 20261130 (`8bab24ca`), shipped with **no** pre-check or checker of its own and no runbook row. MX-7 follows MX-1a, which had both | MX-1a workplan l.299–456; `git show --stat 8bab24ca` |
| E-31 | Runbook | `docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md` §6.1.1 has rows up to 20261096 (l.110–112) and Change History to 2026-10-27 (l.297). Rows for 20261104, 20, 22, 27 and 30 are missing (SA-Q11) | as named |
| E-32 | `.gitattributes` | l.15–16 cover every `*_operator_test_account_cleanup*` migration and rollback (so 20261134 is LF). A migration with another name needs its own lines (paste-safety rule 3), as 20261100 has (l.20–23) | as named |

### 1.5 The "3 stale descriptor strings" (carried over)

Found in two places, which count them slightly differently. The requirement itself has no such item (grep for "stale" + "descriptor" finds only Change History rows).

| # | String | Where (file:line) | Raised in |
|---|---|---|---|
| D-1 | `EXPORT_COLUMN_REASON.OWNER_ID` = `'always the exporting account; it is in export_metadata.user_id'`. There is no `export_metadata` any more: `data.json` went with the ZIP, and the module CSV carries no account id. Used by about 40 descriptors; pinned verbatim by `exportClassification.test.ts` l.584 (`OWNER_ID_REASON`) | `lib/business-os/purge/descriptors.ts` l.117 | MX-4 workplan l.799; contents doc l.212 and §7 table |
| D-2 | `EXPORT_COLUMN_REASON.DOCUMENT_STORAGE` = "where the file sits in our storage; the file itself arrives in 'Your files' (DE-8b), whose manifest comes from STORAGE_DESCRIPTORS". There is no "Your files". Same wording in the comment at l.917 ("the picture files arrive in DE-8b's 'Your files'") | `descriptors.ts` l.118–119 (and l.917) | MX-4 workplan l.799; contents doc §7 table (l.1024) |
| D-3 | The two file buckets are still `export: { kind: 'include', folder: … }` under the DE-8b comment "both buckets are in 'Your files', under these zip folders". Files are **not** exported (BQ-35). Pinned by `exportClassification.test.ts` l.344–350. The type's doc comments say the same: `lib/business-os/purge/types.ts` l.143 and `lib/business-os/data-export/classificationTypes.ts` l.165 | `descriptors.ts` l.1613–1619 | MX-4 workplan l.799 ("the two `STORAGE_DESCRIPTORS` buckets marked `include` with ZIP folders") |
| D-4 | The `business-data-exports` bucket descriptor (reason "the export itself") | `descriptors.ts` l.1621–1623 | Contents doc §7 table (l.1025) counts this as its third. MX-7 deletes it anyway (§4.7) |

The contents doc (`docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` l.1019–1025, l.212) quotes D-1, D-2 and D-4 with a ⚠️ marker. It is updated in the same PR.

---

## 2. Approved scope (verbatim)

### 2.1 Plan §4.10 (`docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md` l.302–312)

| Field | Value |
|---|---|
| Goal | SR-6 order: migration N = regenerated cleanup function that no longer names `business_os_data_exports` (descriptor and `FUNCTION_REQUIRED_TABLES` entry removed in the same PR); migration N+1 = DROP of the `20261074` start function and `business_os_data_exports`; `findDeletionFacts` reads only the new tables (signature unchanged); bucket emptied (if anything is left after MX-3.1's post-deploy step) and deleted through the Storage API, together with its purge descriptor; **from the folded MX-6 (2026-10-27):** remove the ZIP-only methods of `BusinessOsDataExportJobRepository`, `BusinessOsDataExportStorageRepository` (with a coordination-file claim for its `lib/repositories/index.ts` line, S-16), and `jobPolicy.ts` with its 20261074 mirror test |
| Touches | Same S-1 file set as MX-1a; `descriptors.ts` (remove EXPORT's own old table and bucket descriptors); `BusinessOsDataExportJobRepository.ts` (`findDeletionFacts` body; other ZIP methods go, class and file stay, SR-2); `BusinessOsDataExportStorageRepository.ts`, `lib/repositories/index.ts` (own line, with a claim), `lib/business-os/data-export/jobPolicy.ts` + test. **Added by MX-3.1's SA review (2026-10-30, Q-2 / Q-4):** `csv.ts` `toCsv` (no production caller since MX-3.1), and the stale `lib/repositories/index.ts` comment naming `BusinessDataExportFilesRepository` (deleted in MX-3.1; S-16 claim). Depends on MX-3.1 and MX-4 merged, not on MX-5 |
| Lock | **Yes** (last in order). Wait for any DELETE regeneration in flight |
| Migration numbers | **Two**, reserved at once (SR-6) |
| Manual prod gate | **Yes.** SR-5 pre-apply check; apply N, then N+1, then enqueue at once; checker; release lock |
| Effort | 🟢 1.5 d (was 1 d; it gains the dead old-table server code from the folded MX-6) |
| Done when | AC MX-7; checker green; lock released; bucket removed |

**Coordination checklist (MX-7):** CC-1; take the lock; CC-4 two numbers; interface notice `[EXPORT→DELETE] MX-7 interface notice — findDeletionFacts reads only the new tables`; after apply + merge + checker: release and message `[EXPORT→DELETE] MX-7 lock released — stream complete`.

### 2.2 Requirement §6, the MX-7 row (l.201)

> | **MX-7** (E10) | Drop the old table | Migration drops the `20261074` start function and `business_os_data_exports`; removes it from `FUNCTION_REQUIRED_TABLES` and the plan; **cleanup function regenerated** (serialised, §11); `findDeletionFacts` reads only the new tables; bucket emptied if needed and removed through the Storage API, with its descriptor; ZIP-only repository methods, the storage repository and `jobPolicy.ts` with its mirror test removed | MX-3.1, MX-4 | ✅ manual gate | 🟢 1.5 d |

### 2.3 Requirement §7, AC "MX-7" (l.284–286)

> **MX-7**
> - [ ] `business_os_data_exports` and its start function are gone; the regenerated cleanup function passes the drift test and the checker; `findDeletionFacts` reads only the new tables.
> - [ ] (2026-10-27) The bucket `business-data-exports` and its descriptor are gone. The ZIP-only repository methods, `BusinessOsDataExportStorageRepository` and `jobPolicy.ts` with its mirror test are removed. `findDeletionFacts`'s path, class, method and type are unchanged.

### 2.4 Requirement §10, XC-11, XC-12, XC-16 (l.341, l.342, l.345)

> **XC-11** (shared) | **New tables and the cleanup function** (answers SA-Q12). Yes, it must be regenerated: the descriptor, the generator output and the drift test move together, in the **same PR** as the table. Two regenerations: MX-1a (export tables) and DL-1a (closure table). They are separate PRs merged one after the other, never stacked; the second regenerates on top of the first. A third at MX-7 (drop of `business_os_data_exports`: remove it from `FUNCTION_REQUIRED_TABLES` and the plan). Add a new table to `FUNCTION_REQUIRED_TABLES` only if the generated SQL names it statically. Numbers: **20261093 is next free today**, taken when each PR opens; 20261089 is never back-filled. **Deploy order:** a new `CLEANUP_FUNCTION_VERSION` makes the check and E answer `function_out_of_date` until DB and code agree. That fails closed, but it pauses admin deletes and test-account cleanup, so apply and merge back to back and run the checker. Each is a manual prod gate

> **XC-12** | **Receipt export facts** re-sourced in MX-4, before the switch goes on. `ownerLastExportReadyAt` = the last owner module job accepted; `ownerExportDownloadedAt` = NULL from then on (no download exists; document the meaning in the DE-10b requirement); `adminExportExisted` = any admin-origin request. Read both the old and the new tables until MX-7. No receipt schema change

> **XC-16** | **Retirement order** (answers SA-Q11). (1) MX-4 switch on: owner ZIP start refused. (2) MX-5 live: admin prepare refused; DE-10a becomes "Send export to owner". (3) At least 72 h and one sweep run later: the bucket is empty (the sweep expires and removes the objects). (4) MX-6 removes the start, download and download-again routes, the admin data-exports routes and UI, the ZIP builder files, the ready email, and the `/api/cron/data-export` route and its `vercel.json` entry. ZIP-specific CI guards are deleted with their subjects, never loosened in place. (5) **MX-7** (new, 1 d, manual gate): one migration drops the start function and `business_os_data_exports` and regenerates the cleanup function. The bucket is removed through the Storage API once it is empty

Read with the user's decision of 2026-10-27 (requirement §6 l.179): the 72 h wait and MX-6 no longer apply, and SR-6 makes MX-7 **two** migrations, not the "one migration" XC-16 (5) names. §6 and §7 win where §10 differs.

### 2.5 Also in scope (carried over)

The three stale descriptor strings, §1.5 D-1…D-3 (D-4 is removed anyway).

---

## 3. Constraints carried into this slice

| Rule | How MX-7 meets it |
|---|---|
| CLAUDE.md rule 1 (repositories only) | `findDeletionFacts` keeps calling `BusinessOsExportModuleJobRepository.findLatestOwnerSentAt` and `BusinessOsExportRequestRepository.hasAdminOriginRequest` with its own client. No new `.from(` anywhere |
| Rule 3 (Pino) | Unchanged logger in the job repository; ids and the field name only, never a value |
| Rule 4 / `tenant-isolation-guard` | Both reads stay keyed on `user_id` (service role, documented in the header). Invalid uuid → error without a DB call |
| Rule 7 (no new pattern) | The regeneration copies MX-1a exactly. The DROP copies the guard shape of `scripts/rollback-business-os-data-exports.sql` and 20261095. No new script type (the bucket is deleted in the dashboard by default, SA-Q4) |
| SR-2 / S-3 frozen interface | Same path, class (`BusinessOsDataExportJobRepository`), constructor (`client?`), method, `DataExportDeletionFacts` type. Only the body changes |
| SR-6 | 20261134 before 20261135, enforced in SQL: 20261135 refuses while the live cleanup function still names the table (§4.3) |
| S-1 lock files | Generator, pasted check and delete SQL, 20261134 + rollback, version file, drift-test pins, older-version allow-list entries, `FUNCTION_REQUIRED_TABLES` |
| S-16 barrel | Only EXPORT's own lines in `lib/repositories/index.ts` (l.344–370); claim already in the coordination file (l.285) |
| XC-13 / plan l.229 | The `DATA_EXPORT_*` audit constants, definitions and audience entries stay. `events.ts` and `eventAudience.ts` are not opened |
| `receiptInput.ts` | Not opened (DELETE) |
| Entitlements | No file imports from `lib/business-os/entitlements/`; checked by grep at V-4. `test:bos-entitlements` run once anyway |
| `durable-queue-drain` | Not applicable: no drain, no cron change (the sweep cron went in MX-3.1) |
| Hazards | No commit, no `git stash`, no `npm install`, `node_modules` untouched; temp file + rename for every rewrite; no backslash followed by a hex digit in any doc or copy file; CRLF kept on CRLF files, LF on the pasted SQL; no secret printed |

---

## 4. Design

### 4.1 Order (amended by SA M-1)

| # | Step | When | Why this order |
|---|---|---|---|
| 1 | Pre-check; both checkers run once and shown to `FAIL` on the pre-apply state; LC-6 re-read (0 objects) | Before merge | Proves the shape the migrations expect, and that each checker can fail (supabase-ops §4 step 2b) |
| 2 | **20261134** pasted by the user; its checker (md5 row included). The pause window starts | Before merge | SR-6: the function must stop naming the table before the table goes. 20261134 applies whether or not the table exists (no order guard for it any more) |
| 3 | PR enqueued at once, with the user's OK (manual merge) | Merge | XC-11: apply and merge back to back |
| 4 | Deploy Ready: the deployed commit is the merge commit, and the live stamp equals the stamp pinned in the merge commit's version file | After deploy | The build that no longer reads the table is live before anything is dropped |
| 5 | The 20261135 checker run once more and still `FAIL` on its table-absent rows; **20261135** pasted by the user; its checker. The pause window ends | After deploy | env-change-protocol §2 ("after deploy: removing what the old code still used"); supabase-ops rollback rule (data is dropped only once nothing can need it). Its guard refuses unless step 2 is live |
| 6 | LC-6 (0 objects); the user deletes the bucket in the dashboard; LC-6 again (0 bucket rows) | After deploy | The old build iterated the bucket descriptor (E-29); the new one does not |

**The window** runs from step 2 until the 20261135 checker passes in step 5. During it, admin deletes and checks, test-account cleanup and DELETE's E route refuse (fail closed): first on the version stamp (steps 2 to 4), then on schema drift, because the new build sees the still-present table as an unclassified tenant table and the new function finds the table's FK to `auth.users` unreviewed (step 4 to step 5). Nothing is removed wrongly, and `findDeletionFacts` never errors in the window, because the old build never runs against a dropped table. The window is as long as in Dev's first order. What changes is the restore: if CI goes red or the queue sticks after step 2, it is the 20261134 rollback alone, with the table and its rows intact. SR-6 and XC-11 both still hold. This amends the plan §4.10 line "apply N, then N+1, then enqueue at once"; the plan's Change History records it (2026-11-25).

### 4.2 Migration 20261134: the regenerated cleanup function

Under the S-1 lock. Generator edits (`scripts/generate-test-account-cleanup-sql.ts`), copied from MX-1a §5:

| Constant | From | To |
|---|---|---|
| `FUNCTION_MIGRATION` (l.189) | `20261130_operator_test_account_cleanup_client_standing` | `20261134_operator_test_account_cleanup_drop_data_exports` |
| `PREVIOUS_FUNCTION_MIGRATION` (l.191) | `20261127_operator_test_account_cleanup_refund_transaction_fk` | `20261130_operator_test_account_cleanup_client_standing` |
| `FUNCTION_MIGRATION_PURPOSE` (l.197–203) | 20261130 lines | "Removes business_os_data_exports from step A and the business-data-exports bucket from the storage count and list" · "The old ZIP export table of 20261074 is dropped by 20261135 right after this file, and the bucket is deleted after the deploy" · "The migration no longer refuses while that table is absent" · "Nothing else in the plan changes. Same 8 argument signature as 20261104" |
| `ROLLBACK_CONSEQUENCE` (l.209–213) | 20261130 lines | "The restored 20261130 function names business_os_data_exports in step A" · "While that table exists this rollback can run on its own" · "Once 20261135 has dropped the table, the restored function refuses every check, delete and anonymise (fails closed), so run the 20261135 rollback first" · "Redeploy a build that pins the 20261130 stamp after running this file" (paste-safe: no semicolon, no apostrophe, no "into"; "refuses (fails closed)" unless the drift test proves the exact failure, S-5) |
| Doc comment (after l.181) | — | One `20261134:` paragraph: chains on 20261130 (stamp `5c369aaf2fa78abf`, live per LC-8), the old table and bucket leave the plan, the DROP follows in 20261135 |
| `FUNCTION_REQUIRED_TABLES` (l.229–243) | three entries | the `business_os_data_exports` entry removed; billing events and receipts stay |
| `KEEP_SET`, `FULL_REMOVAL_EXTRAS`, `INBOUND_FOREIGN_KEYS`, `STEP_B_BLOCKING_EDGES`, `ACTOR_FOREIGN_KEYS`, triggers | unchanged | None names the old table (grep) |

Purge descriptors (§4.7) are edited first, because the plan and the bucket list come from them (E-17). Then `npx tsx scripts/generate-test-account-cleanup-sql.ts` rewrites the check SQL, the delete SQL, 20261134, `supabase/SQL Scripts/20261134_operator_test_account_cleanup_drop_data_exports_rollback.sql` and the version file (new stamp). **20261130 and its rollback are never touched** (sha-pinned). Before the run: `git diff --stat` clean of generated files. After: `git diff --numstat` shows each generated file changed and none emptied (agent file-write truncation hazard).

### 4.3 Migration 20261135: the DROP (hand-written)

**File:** `supabase/migrations/20261135_drop_business_os_data_exports.sql`, one `BEGIN; … COMMIT;`, LF, ASCII, paste-safe:

| Part | Content |
|---|---|
| Header | What it drops, the apply order (after 20261134 and after the deploy is Ready, same sitting, §4.1 step 5), timing (the window, §4.1), "No known undo for data", the rollback path |
| `SET LOCAL lock_timeout = '5s';` | As the DE-8a rollback |
| `DO $drop_guard$` | Refuses, applying nothing, unless: (1) the 8-argument cleanup function, looked up by its exact `to_regprocedure` signature (SA-Q15), exists and its body no longer contains `business_os_data_exports` (SR-6 in SQL; the old DE-8a rollback checked only the retired 6-argument signature, E-26); (2) no other function body in any schema names the table, except the start function itself (`pg_proc.prosrc` over every schema, as LC-5; SA-Q15); (3) no row is in `queued` or `running` (nothing in flight); (4) no foreign key points at the table from another table (`pg_constraint.confrelid`); (5) the start function exists with exactly `(uuid, uuid, text)` |
| Drop | `LOCK TABLE public.business_os_data_exports IN ACCESS EXCLUSIVE MODE;` then `DROP FUNCTION public.business_os_data_export_start(uuid, uuid, text);` then `DROP TABLE public.business_os_data_exports;` (no `IF EXISTS`, no `CASCADE`: a hidden dependent makes the paste fail with nothing applied, rather than taking something with it). The `DROP TABLE public.business_os_data_exports` form is what the ownership scanner reads (E-20) |
| `DO $drop_check$` | Post-condition: both `to_regclass` and `to_regprocedure` are NULL, or raise |
| Last | `NOTIFY pgrst, 'reload schema';` |

The guard is name-based, not stamp-based, so it stays correct if 20261134 is regenerated on a rebase (SA-Q15). The bucket is **not** touched in SQL. Supabase refuses a direct delete of storage rows, and the plan says "through the Storage API".

### 4.4 Rollbacks and the backup

| Undo | How | Effect |
|---|---|---|
| 20261135 | `supabase/SQL Scripts/20261135_drop_business_os_data_exports_rollback.sql` (hand-written): refuses if the table or the function already exists, then re-creates the **shape** of 20261074 statement by statement (S-2): the full `CREATE TABLE` with its defaults, the FK to `auth.users` ON DELETE CASCADE and all eleven named CHECK constraints; the three indexes, the unique partial one included; RLS on; the REVOKE / GRANT lines; the start function body byte-equal, with its REVOKE / GRANT; and 20261074's own privilege post-condition (its l.186–206). The bucket is not re-created here | **No known undo for the rows.** The table comes back empty. Nothing reads it after this PR. A revert of the PR also needs the rows only for the receipt's old-ZIP facts |
| 20261134 | The generated rollback (restores 20261130 byte for byte, stamp `5c369aaf2fa78abf`) **and** a PR revert | Before §4.1 step 5 (M-1) it runs **on its own**, with the table and its rows intact: this is the restore when CI goes red or the queue sticks. After step 5 it runs **after** the 20261135 rollback: the restored 20261130 names the table in step A and reviews its live FK, so without the table it refuses every check and delete (fails closed, S-5) |
| Full restore after step 5 | 20261135 rollback → 20261134 rollback → PR revert → redeploy | As MX-1a §9 |
| Bucket | Re-create it in the dashboard with 20261074's settings (private, 50 MB, `application/zip`), only if the PR is reverted | No objects to restore: it is empty before the delete |

**Backup before 20261135 (SA-Q2, settled).** No extra copy of the rows is taken. LC-1 found 6 rows (all owner, none in flight, none created after MX-3.1), holding dates, counts and two ids each, never content, and nothing reads them after this PR. SA weighed and accepted "No known undo for data". The user reads Database → Backups (LC-10) and the latest backup time is recorded as the before-state of the 20261135 change record; if no backup covers the paste, that is recorded and the step proceeds.

### 4.5 `findDeletionFacts`: new tables only

The body keeps N1 and N2 and drops O1 and O2:

| Field | After MX-7 |
|---|---|
| `ownerLastExportReadyAt` | N1 `sentAt` (the newest owner-origin module job with status `sent`), or `null` |
| `ownerExportDownloadedAt` | always `null` |
| `adminExportExisted` | N2 (any admin-origin request) |

Kept: the uuid check without a DB call; `Promise.all` of the two repository reads with `this.supabase`; any read error, or a missing fact, is an error (never partial facts, K-3); an unparseable `sent_at` is an error naming the field, not the value (Q-5). The JSDoc states the meaning from MX-7 exactly as XC-12 words it, and that an old ZIP no longer counts (S-8). Signature, class, path and type: unchanged.

**Meaning change.** An account whose only export was an old ZIP (before 2026-10-30) will read "none on record" from now on. LC-9 found 3 such owners and 0 admin-only accounts, so `adminExportExisted` loses nothing (BQ-E10-2: the user accepted this on 2026-11-26). The receipts already written are untouched. DELETE gets the interface notice **before the PR opens** (§10); its tests mock the method, so DELETE changes nothing.

### 4.6 Code removals

| File | Change |
|---|---|
| `lib/repositories/BusinessOsDataExportJobRepository.ts` | Keeps: header (rewritten: "receipt export facts only; reads the two module-export tables through their repositories"), imports it still needs, `uuid`, `toError`, `invalid`, `DataExportDeletionFacts`, the class with its constructor and `findDeletionFacts`. Removes: `TABLE`, `START_FUNCTION`, `DATA_EXPORT_JOB_COLUMNS`, `SWEEP_REF_COLUMNS`, `DATA_EXPORT_JOB_LIMITS`, the ZIP Zod schemas, every other method, the `jobPolicy` import, the ZIP type imports, and the singleton (SA-Q6) |
| `lib/repositories/__tests__/BusinessOsDataExportJobRepository.test.ts` | Keeps the `findDeletionFacts` describe (l.534–714), adapted (§7.2); the rest goes |
| `lib/repositories/BusinessOsDataExportStorageRepository.ts` + its test | Deleted |
| `lib/repositories/index.ts` | l.344–370: the job-repository block shrinks to `export { BusinessOsDataExportJobRepository } from './BusinessOsDataExportJobRepository'` and `export type { DataExportDeletionFacts } …` (SA-Q6); the ZIP type exports, the storage-repository block and its stale comment naming `BusinessDataExportFilesRepository` (l.362–364) go |
| `lib/repositories/types.ts` | The DE-8a / DE-8b block l.1378–1506 goes (all dead, E-16; SA-Q6) |
| `lib/business-os/data-export/jobPolicy.ts` + `__tests__/jobPolicy.test.ts` | Deleted |
| `supabase/migrations/__tests__/business-os-data-exports.migration.test.ts` | The `jobPolicy` import (l.19) and MT-11 (l.279–289) go: they mirror code that no longer exists. The rest stays as history pins of the applied 20261074 and its scripts (SA-Q7) |
| `lib/business-os/data-export/moduleExportPolicy.ts` l.18 | Comment: "the old ZIP export kept its rules in jobPolicy.ts until MX-7 removed it" |
| `lib/business-os/data-export/csv.ts` | `toCsv`, its `encoder` and `toCsvText` go (SA-Q12, S-3): after `toCsv` goes, `toCsvText` would be production code that exists only for tests. The header comment (l.20–25) is reworded |
| `lib/business-os/data-export/__tests__/csv.test.ts` | `toCsvText` moves here as a local helper built from `csvPartText`, `csvHeaderLine` and `csvLine`. The two `toCsv` cases (l.11, l.30) encode it with a `TextEncoder`, so the BOM bytes, the Hebrew round trip and the pre-refactor byte fixture stay pinned (S-3) |

### 4.7 Descriptors, ownership and the stale strings

| Change | Where |
|---|---|
| Remove the table descriptor and its `§3.16` comment | `descriptors.ts` l.1366–1369 |
| Remove the bucket descriptor and its comment | `descriptors.ts` l.1620–1623 |
| Remove `EXPORT_REASON.EXPORT_ITSELF` (no other user) | `descriptors.ts` l.77 |
| Remove `USER_OWNED_TABLES.business_os_data_exports` and its comment (E-20) | `businessOwnedTables.ts` l.250–255 |
| `area: 'data_exports'` stays in the `PurgeArea` union (`purge/types.ts` l.106). DELETE-owned `app/admin/users/types.ts` l.154 and `deletionCopy.ts` l.43 use it; an unused member breaks nothing | not edited |
| **D-1** `OWNER_ID` → "always the exporting account itself, so it is never a column of the export" | `descriptors.ts` l.117; the pin `exportClassification.test.ts` l.584 |
| **D-2** `DOCUMENT_STORAGE` → "where the file sits in our storage; files are not exported, the owner downloads each one from its record (BQ-35)"; the l.917 comment reworded the same way | `descriptors.ts` l.118–119, l.917 |
| **D-3** default: both file buckets become `export: { kind: 'exclude', reason: 'files are not exported; the owner downloads each one from its record (BQ-35)' }`; the l.1613–1616 comment rewritten; the type comments (`purge/types.ts` l.143, `classificationTypes.ts` l.165) reworded. The `include` variant of the type stays (SA-Q9, approved). The bucket count pin at l.337 (`toBeGreaterThanOrEqual(4)`) becomes 3, the include list at l.347–350 becomes `[]`, and that test is renamed to say files are not exported (S-1) | `descriptors.ts`, `exportClassification.test.ts` l.337–350 |
| Counts | 167 = 38 include + 0 planned + 129 exclude; `classification-baseline.json` count 167, its two `business_os_data_exports` entries removed; each count comment gains "MX-7: −1 (business_os_data_exports dropped)" |

### 4.8 The bucket

- **Before the paste:** LC-6 read 0 objects, 1 bucket row and 0 storage policies on 2026-11-25, so no emptying step is needed. It is re-read in §8.2 step 5 and again in step 12.
- **After the 20261135 checker passes (§4.1 step 6):** the user deletes the bucket in the dashboard (Storage → `business-data-exports` → Delete bucket). That goes through the Storage API. It is a production change, so the user executes it (env-change-protocol §1). No script, no service-role key in anyone's hands, no new pattern (SA-Q4, settled). The `BusinessOsDataExportStorageRepository` is removed in the same PR, so nothing in code could do it after the merge anyway.
- **Probe that can fail:** the same read-only query before and after: `storage.buckets` has 1 row for the id before, 0 after; `storage.objects` has 0 rows for it both times. A probe on a different bucket name, or one run before the user reports the click, would prove nothing; the record names the time.
- The change record is the third of three separate blocks under `## Environment changes` (S-9).

### 4.9 Pre-check and checkers (MX-1a shape, read-only, paste-safe)

| File | When | Rows (each `ok` / `FAIL`, numbered, `ORDER BY checks.ord;`) |
|---|---|---|
| `scripts/precheck-drop-data-exports.sql` | Before 20261134 | live cleanup stamp is `5c369aaf2fa78abf`; the new stamp is absent; the old table and the start function `(uuid, uuid, text)` exist; no queued or running row; no FK into the table; no view, policy or trigger depends on it; no function other than the start function and the cleanup function names it; the bucket has 0 objects; browser roles cannot create in `public` |
| `scripts/check-test-account-cleanup-drop-data-exports-migration.sql` | After 20261134 | the 8-argument function exists, the 6-argument one is gone; owner rights, owner `postgres`, the search path; EXECUTE service_role only; the new stamp is in the body; `5c369aaf2fa78abf` is gone; the body names neither `business_os_data_exports` nor `business-data-exports`; operator gate: md5 of the body equals the committed 20261134 body |
| `scripts/check-drop-data-exports-migration.sql` | After 20261135 | the table and the start function are absent; the live cleanup stamp is still the new one; no function body names the table |

Each checker is run once on the pre-apply state and must show `FAIL` on the rows for what it proves (supabase-ops §4 step 2b): for 20261134, the row "the body names neither the table nor the bucket" and the md5 row; for 20261135, its table-absent rows, which are shown to `FAIL` **twice**, at the pre-check and again immediately before its paste (§4.1 step 5, S-6). Every pre-check and checker file is one read-only `SELECT` with numbered rows and a stated row count, with no write keyword and no `SET`, and the word "into" appears nowhere in it, identifiers and aliases included (S-6). None contains the phrase that the SECURITY DEFINER tripwire scans for (it uses `prosecdef`). Each gets a `text eol=lf` line in `.gitattributes`, as do 20261135 and its rollback (E-32).

---

## 5. Files to create / modify / delete

| File | Action | Reason |
|---|---|---|
| `scripts/generate-test-account-cleanup-sql.ts` | modify | §4.2 (S-1 lock) |
| `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql` | regenerate | §4.2 |
| `supabase/migrations/20261134_operator_test_account_cleanup_drop_data_exports.sql` | generate | Migration N |
| `supabase/SQL Scripts/20261134_operator_test_account_cleanup_drop_data_exports_rollback.sql` | generate | Its rollback |
| `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` | regenerate | New stamp |
| `supabase/migrations/20261135_drop_business_os_data_exports.sql` | create | Migration N+1 (§4.3) |
| `supabase/SQL Scripts/20261135_drop_business_os_data_exports_rollback.sql` | create | §4.4 |
| `scripts/precheck-drop-data-exports.sql`, `scripts/check-test-account-cleanup-drop-data-exports-migration.sql`, `scripts/check-drop-data-exports-migration.sql` | create | §4.9 |
| `supabase/migrations/__tests__/business-os-data-exports-drop.migration.test.ts` | create | §7.3 |
| `.gitattributes` | modify | LF lines for 20261135, its rollback and the three scripts |
| `scripts/__tests__/testAccountCleanupSql.test.ts` | modify | §7.1 T-1 |
| `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | modify (allow-list entries only, S-1) | §7.1 T-2 |
| `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` | modify (add only) | §7.1 T-3 |
| `lib/business-os/purge/descriptors.ts` | modify (EXPORT's entries and the D-1…D-3 strings) | §4.7 |
| `lib/business-os/businessOwnedTables.ts` | modify (EXPORT's DE-8a entry only) | §4.7, E-20 |
| `lib/business-os/purge/types.ts` l.143, `lib/business-os/data-export/classificationTypes.ts` l.165 | modify (doc comment only) | D-3 |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts`, `lib/business-os/purge/__tests__/descriptors.invariant.test.ts`, `lib/business-os/purge/__tests__/classification-baseline.json` | modify | Counts, bucket test, the OWNER_ID pin |
| `lib/repositories/BusinessOsDataExportJobRepository.ts` + its test | modify | §4.5, §4.6 |
| `lib/repositories/BusinessOsDataExportStorageRepository.ts` + its test | delete | §4.6 |
| `lib/repositories/index.ts` | modify (EXPORT's lines only, S-16 claim) | §4.6 |
| `lib/repositories/types.ts` | modify (the DE-8a / DE-8b block only) | §4.6, SA-Q6 |
| `lib/business-os/data-export/jobPolicy.ts` + `__tests__/jobPolicy.test.ts` | delete | §4.6 |
| `supabase/migrations/__tests__/business-os-data-exports.migration.test.ts` | modify (import + MT-11 only) | §4.6 |
| `lib/business-os/data-export/moduleExportPolicy.ts` | modify (comment l.18) | §4.6 |
| `lib/business-os/data-export/csv.ts` + `__tests__/csv.test.ts` | modify | §4.6 |
| `docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md` | modify | §6.1.1 row for 20261134 + 20261135, newest-rollback paragraph, Change History (SA-Q11) |
| `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` | modify | §7 ⚠️ table and l.212 resolved; old table and bucket gone |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md` | modify (add a line to EXPORT's section only, S-14) | `ownerExportDownloadedAt` is always null and old ZIPs no longer count, from MX-7 |
| `docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md`, `docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md` | modify | §6 MX-7 row note, §7 ticks at merge, plan §4.10 status, Change History (the plan row for the SA M-1 order change is already added, 2026-11-25) (standing rule: record every stage in the master doc) |
| `docs/workplans/BUSINESS_OS_EXPORT_MX7_WORKPLAN.md` | create | This file |

**Not edited:** `lib/audit/events.ts`, `eventAudience.ts`, `receiptInput.ts`, DELETE's routes and their tests, `app/admin/users/**`, `vercel.json`, `bosCronJobs.ts`, 20261074 / 20261075 / 20261130 and every other applied migration, the DE-8a scripts (history, SA-Q14), `closureLifecycle.ts`, and the PROD-2 baseline files `supabase/baseline/before-schema.sql`, `after-schema.sql` and `scripts/__tests__/schemaParityBaseline.test.ts` (DevOps hand-off, M-2).

---

## 6. Task list

- [x] Task 1: SA review of this workplan (2026-11-25, approved with conditions); LC-1…LC-9 run by the coordinator and recorded in §15; M-1…M-3 folded in by Dev (2026-11-25). Still owed: the CC-5 "workplan approved" message, and LC-10 (the user)
- [ ] Task 1b: log every S-4 claim in the coordination file before Task 2 (§10 CC-3). None for the PROD-2 baseline files (M-2)
- [x] Task 2: descriptors and ownership (§4.7), D-1…D-3 as ruled; counts and `classification-baseline.json`; the l.337 bucket count and the renamed include test (S-1); `exportClassification`, `descriptors.invariant`, `businessOwnedTables` tests green
- [x] Task 3: generator constants (§4.2), including the S-5 `ROLLBACK_CONSEQUENCE` wording, then the regeneration; numstat check; record the new stamp in this file
- [x] Task 4: drift test, `no-deletion-paths` and credit-lots allow-lists (T-1…T-3); `APPLIED_TARGET` pinned **last**, once the bytes are final
- [x] Task 5: 20261135 + its rollback (§4.3, §4.4), the rollback compared with 20261074 statement by statement (S-2); the three scripts with the S-6 rules (§4.9); `.gitattributes`; the migration text test (T-7)
- [x] Task 6: `findDeletionFacts` body, its JSDoc worded as XC-12 (S-8), and its tests (§4.5, T-6)
- [x] Task 7: code removals (§4.6) and their tests; `toCsv` and `toCsvText` out of `csv.ts`, `toCsvText` into `csv.test.ts` (S-3)
- [x] Task 8 (except the coordination-file line, see Implementation Notes D-5): docs: runbook (the 20261134 / 20261135 rows, the newest-rollback paragraph, "never run the DE-8a rollback after 20261135", Change History; SA-Q11, SA-Q14); contents doc; the DE-10b requirement line with the XC-12 meaning and the BQ-E10-2 answer (S-8); master requirement and plan notes. A follow-up line in the coordination file for the missing runbook rows 20261104, 20, 22, 27 and 30 (SA-Q11). The plan Change History row for the M-1 order change is already done (2026-11-25)
- [x] Task 9 (V-2 not run, see Implementation Notes): verification §8.1; the V-6 grep output goes in the Implementation Notes (it replaces the dropped T-13)
- [ ] Task 10: interface notice to DELETE (coordination file + message) **before the PR opens** (text in §10)
- [ ] Task 10b: post a DevOps hand-off before the PR opens: bucket list five → four before U5r (coordination file line + DO message, text in §10; M-2)
- [ ] Task 11: SA code review → QA → the user sees the diff → RM commit + PR (no auto-merge)
- [ ] Task 12: prod apply §8.2 in one sitting (M-1 order) on each project that holds the table (M-3); three change records under `## Environment changes` per project (S-9); lock release

---

## 7. Test plan

All pure Jest in the existing job, no network (`tests/jest-no-network.ts`), no added CI time.

### 7.1 Regeneration pins (copied from MX-1a T-7…T-9)

| # | Test | Asserts |
|---|---|---|
| T-1 | `scripts/__tests__/testAccountCleanupSql.test.ts` | The 20261130 pair moves from `APPLIED_TARGET` to `APPLIED` with its hashes (`25e15f00…173c`, `f2e7398e…4a00`, l.835–836), with a comment as the slot directs. l.514–515: the previous is 20261130. New 20261134 block: it is the generator target and chains on 20261130 (`5c369aaf2fa78abf` in the previous file and in the rollback; the rollback restores the 20261130 body exactly); the new stamp is not `5c369aaf2fa78abf`; check, delete and migration SQL do not contain `business_os_data_exports` or `business-data-exports`; the bucket list is the three remaining buckets; `FUNCTION_REQUIRED_TABLES` has no entry for the table and the order guard does not name it; l.1057–1058 flips to "the DE-8a plan is gone"; the rollback header carries the S-5 lines ("can run on its own while the table exists", "refuses (fails closed) once 20261135 has dropped it, so run the 20261135 rollback first"); rollback and migration paste-safe. New `APPLIED_TARGET` written last |
| T-2 | `no-deletion-paths.guard.test.ts` | 20261127 becomes its own entry in `SQL_LOGIN_DELETE_ALLOW_LIST` and `SQL_AUTH_WRITE_ALLOW_LIST` (built from `INITIAL_FUNCTION_MIGRATION`, never a literal, R-7), and the previous-slot test reads 20261130, exactly as `8bab24ca` did for 20261122 |
| T-3 | `business-os-credit-lots.migration.test.ts` | The 20261130 pair added by name to the L8 list (add only) |
| T-4 | `testAccountCleanupInboundFk.guard.test.ts`, `migrationNumberUnique.guard.test.ts` | No edit; must pass |

### 7.2 `findDeletionFacts` (`BusinessOsDataExportJobRepository.test.ts`)

| # | Case |
|---|---|
| T-6a | Two reads, both on `user_id`, through the two repositories with the same client; **no query to `business_os_data_exports`** (recording client) and the source holds no `.from(` |
| T-6b | Nothing on record: `null`, `null`, `false` |
| T-6c | An owner module job sent: its `sent_at`; `ownerExportDownloadedAt` is `null` |
| T-6d | An admin-origin request: `adminExportExisted` true; an admin send never sets `ownerLastExportReadyAt` |
| T-6e | Invalid uuid: error, no DB call |
| T-6f | Either read errors, or returns no fact: error, never partial facts |
| T-6g | Unparseable `sent_at`: error naming the field, not the value |
| T-6h | Contract pin: the class still constructs with an optional client, and the result type is `RepositoryResult<DataExportDeletionFacts>` with exactly the three keys (a type-level assignment plus `Object.keys` on a fixture) |
| T-6i | DELETE's four route test files pass unedited (they mock the method) |

### 7.3 Migration 20261135 text test (new)

| # | Asserts (each with a negative control on a planted copy) |
|---|---|
| T-7a | One `BEGIN;` … `COMMIT;`; `lock_timeout` set; the guard block comes before any DROP; the post-condition after; `NOTIFY pgrst` last |
| T-7b | The guard names the 8-argument signature, checks that the body lacks the table name, and checks the other function bodies, the in-flight rows and the inbound FKs |
| T-7c | `DROP FUNCTION public.business_os_data_export_start(uuid, uuid, text);` comes before `DROP TABLE public.business_os_data_exports;`; no `CASCADE`, no `IF EXISTS`; nothing about storage |
| T-7d | Paste safety on the migration, its rollback and the three scripts: ASCII, LF, no `;` or `'` in a comment, no word "into" in a literal or comment. For the pre-check and the checkers: no "into" anywhere (identifiers and aliases included), no `SET`, no write keyword, one `SELECT` (S-6) |
| T-7e | The rollback refuses when the table or the function exists, and re-creates the 20261074 shape statement by statement, each compared with the 20261074 text: the full `CREATE TABLE` (defaults, the `auth.users` CASCADE FK, the eleven named CHECK constraints), the three indexes including the unique partial one, RLS, the REVOKE / GRANT lines, the start function body byte-equal, and 20261074's privilege post-condition (l.186–206) (S-2) |
| T-7f | The pre-check and checkers are numbered and state their row counts; the md5 row exists; the 20261135 checker has the table-absent rows that must read `FAIL` before its paste (S-6) |

### 7.4 Classification, ownership and code

| # | Test | Change |
|---|---|---|
| T-8 | `exportClassification.test.ts` | Kinds `{ include: 38, planned: 0, exclude: 129 }`; the `STORAGE_DESCRIPTORS.length` pin (l.337) is 3; the bucket test names three buckets with the D-3 classification, its include list is `[]` and it is renamed to say files are not exported (S-1); the `OWNER_ID_REASON` pin carries the D-1 text |
| T-9 | `descriptors.invariant.test.ts`, `classification-baseline.json` | 167 |
| T-10 | `businessOwnedTables.test.ts` | No edit; passes with the entry removed (the scanner reads the DROP in 20261135) |
| T-11 | `csv.test.ts` | `toCsvText` is a local helper in the test; the BOM bytes, the Hebrew round trip and the byte fixture are pinned through it; no `toCsv` or `toCsvText` import (S-3) |
| T-12 | `business-os-data-exports.migration.test.ts` | Passes without MT-11 |
| T-13 | Dropped (SA-Q13: no added CI time) | `tsc` refuses any import of a removed module; the one-time V-6 grep covers string table names |

---

## 8. Verification, prod apply and live checks

### 8.1 Before hand-over (outputs in the Implementation Notes)

| # | Check |
|---|---|
| V-1 | `npm test -- scripts/__tests__ lib/business-os/purge lib/business-os/data-export lib/business-os/__tests__ lib/repositories/__tests__ supabase/migrations/__tests__ app/api/business-os/account/deletion-check app/api/admin/test-account-cleanup` |
| V-2 | Full `npm test` compared against a `main` baseline run, FAIL lines deduplicated |
| V-3 | `npx tsc --noEmit` with `NODE_OPTIONS=--max-old-space-size=8192`, filtered to the touched files, exit code checked (no OOM trace) |
| V-4 | `npm run lint` on the touched files; grep that no touched file imports from `lib/business-os/entitlements/`; `npm run test:bos-entitlements` once |
| V-5 | `git diff --stat` shows no edit to the files under "Not edited" (§5), and `--numstat` shows no emptied file |
| V-6 | A repo grep for the table, the start function and the bucket name lists only migrations, SQL scripts, history tests and docs |

### 8.2 Prod apply: one sitting (SA M-1 order)

The user pastes; the main session runs the pre-check and checkers through `begin read only; …; commit;` and counts the rows (supabase-ops §1, §4). Never paste from a working copy other than the rebased PR head CI ran green. Steps 3 to 13 run on **each** project that holds the table (step 2 f).

| # | Step | Who | Stop if |
|---|---|---|---|
| 1 | Gates: SA code review ✅, QA ✅, user has seen the diff and approved; the user OKs the PR open (standing rule) | TL | any missing |
| 2 | **SR-5 pre-apply check.** (a) Branch rebased on current `origin/main`, CI green. (b) `git show origin/main:scripts/generate-test-account-cleanup-sql.ts` shows `FUNCTION_MIGRATION = '20261130_operator_test_account_cleanup_client_standing'`, equal to our `PREVIOUS_FUNCTION_MIGRATION`. (c) `origin/main` holds no 20261134 or 20261135. (d) The lock row is still EXPORT's. (e) LC-8 again: the live stamp is `5c369aaf2fa78abf`. (f) **M-3:** DevOps confirms, by role, which Supabase project(s) hold `business_os_data_exports` at the time of the paste, using PROD-2's role names: **the staging project** (the existing project, which becomes staging; the coordinator's 2026-11-25 LC run called it the production project) and **the new production project** (built by PROD-2 from the baseline). If the new production project already exists and holds the table, steps 3 to 13 run on each project that holds it, each with its own change records. If main moved: rebase, regenerate, renumber if 34 / 35 were taken, repeat | TL; DevOps for (f) | any mismatch; (f) unanswered |
| 3 | Advisors (security + performance) captured, privately | main session | — |
| 4 | `[EXPORT→DELETE] E10 pause window starting`: no admin delete, no test-account cleanup until step 11 passes | TL | — |
| 5 | Pre-check `scripts/precheck-drop-data-exports.sql`, LC-6 included (0 objects) | main session | any row not `ok` |
| 6 | Prove both checkers can fail: run them now. The 20261134 checker's "body names neither the table nor the bucket" row and md5 row, and the 20261135 checker's table-absent rows, must read `FAIL` | main session | a checker that is all `ok` before the paste |
| 7 | User pastes `supabase/migrations/20261134_operator_test_account_cleanup_drop_data_exports.sql`. **The pause window starts** | user | an error (nothing applied): re-run the pre-check, stop |
| 8 | Checker after 20261134, md5 row included | main session | any `FAIL`; an md5 `FAIL` is resolved by comparing the pasted bytes and line endings with the PR head, never ignored |
| 9 | **Enqueue the PR at once**, with the user's OK (manual merge, no auto-merge) | user / RM | CI red or the queue sticks: paste the 20261134 rollback on its own (the table and its rows are intact, and the restored 20261130 stamp matches the build still deployed), the window ends, and the user decides the next attempt |
| 10 | Deploy Ready: the deployed commit is the merge commit, and the live stamp equals the stamp pinned in the merge commit's version file. This replaces the Danger Zone click check (BQ-E10-4, settled) | TL / main session | a mismatch: stop, do not paste 20261135 |
| 11 | Run the 20261135 checker once more: its table-absent rows must still read `FAIL`. Then the user pastes `supabase/migrations/20261135_drop_business_os_data_exports.sql`; then its checker; advisors re-run. **The pause window ends when this checker passes** | main session, user | the pre-paste run is not `FAIL`; a paste error (nothing dropped): stay in the window, fix forward; a checker `FAIL` after the paste: **stop, apply nothing more, escalate to SA and the user** (data was dropped, so no blind rollback) |
| 12 | Bucket: LC-6 (0 objects, 1 bucket row); the user deletes the bucket in the dashboard; LC-6 again (0 bucket rows) | user / main session | objects present: stop |
| 13 | Three change records under `## Environment changes` (S-9) | main session | — |
| 14 | Coordination: `[EXPORT→DELETE] E10 migrations applied`, `… merged`, `MX-7 lock released — stream complete`; release the lock row (CC-8) | TL | — |

---

## 9. Effort

| Part | Estimate |
|---|---|
| Descriptors, ownership, counts, stale strings | 0.25 d |
| Regeneration, pins, allow-lists | 0.25 d |
| 20261135, rollback, three scripts, text test | 0.5 d |
| `findDeletionFacts` + code removals + tests | 0.5 d |
| Docs, verification | 0.25 d |
| **Total** | **1.75 d** (budget 1.5 d) |

SA accepted 1.75 d. T-13 is dropped (SA-Q13) and `toCsvText` moves into the test (S-3), which recovers part of the overrun. D-3 stays a real classification change.

---

## 10. Coordination (CC-1 … CC-8)

| Item | Action |
|---|---|
| CC-1 | Read 2026-11-25; l.285–286 already record the start, the lock, the two numbers and the claims |
| CC-3 / S-16 | Already logged (l.285): the S-1 files, `descriptors.ts` (EXPORT's entries), the two repositories, `index.ts` (EXPORT's lines), `jobPolicy.ts` + mirror test, `csv.ts`. **To log before Task 2 (S-4):** `lib/repositories/types.ts` (the DE-8a / DE-8b block), `lib/business-os/businessOwnedTables.ts` (the DE-8a entry), `no-deletion-paths.guard.test.ts` (allow-list entries, S-1), `business-os-credit-lots.migration.test.ts` (add only), `exportClassification.test.ts`, `descriptors.invariant.test.ts`, `classification-baseline.json`, `lib/business-os/purge/types.ts` (doc comment), `.gitattributes`, `docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md`. **No claim on the PROD-2 baseline files** (M-2) |
| CC-4 | 20261134 + 20261135 reserved (l.285); re-check `origin/main` at the SR-5 step |
| CC-5 | `[EXPORT→DELETE] MX-7 workplan approved`, `… interface notice`, `… PR opened`, `… pause window starting`, `… migrations applied`, `… merged`, `… lock released — stream complete` |
| **Interface notice (before the PR opens)** | `[EXPORT→DELETE] MX-7 interface notice — findDeletionFacts reads only the new tables`. Body: signature unchanged; `ownerLastExportReadyAt` = the newest owner module job sent; `ownerExportDownloadedAt` = always null; `adminExportExisted` = any admin-origin request; an old ZIP no longer counts; during the window `findDeletionFacts` does not error, because the table is dropped only after the new build is live; checks and deletes refuse on the version stamp and then on schema drift until the 20261135 checker passes (M-1) |
| **DevOps hand-off (M-2, before the PR opens)** | Coordination file line and a DO message: "after MX-7 the `business-data-exports` bucket no longer exists on the source project; the baseline's bucket list, its count of five, the before-schema guard and the parity test (including the l.1042 negative control, which needs another bucket) must move to four before U5r" (Task 10b) |
| CC-6 | No shared hotspot entry is added. `descriptors.ts` and `businessOwnedTables.ts`: EXPORT removes only its own entries |
| CC-7 | `findDeletionFacts`, `DataExportDeletionFacts`, `DownloadMyDataButton` keep their shapes |
| CC-8 | Status row "MX-7 complete"; lock released only after 20261134 + merge + deploy + 20261135 + both checkers + the bucket step, on every project that holds the table |

---

## 11. Acceptance criteria mapping

| AC MX-7 | Where proven |
|---|---|
| The table and its start function are gone | §8.2 step 11 checker; T-7; LC-1/LC-2 before |
| The regenerated cleanup function passes the drift test and the checker | T-1…T-4; §8.2 step 8 (md5 gate) |
| `findDeletionFacts` reads only the new tables | T-6a…T-6g; V-6 |
| The bucket and its descriptor are gone | §4.7 + T-8; §8.2 step 12 probe |
| ZIP-only methods, the storage repository, `jobPolicy.ts` and its mirror test are removed | §4.6; V-5, V-6, T-12 |
| `findDeletionFacts`'s path, class, method and type are unchanged | T-6h, T-6i; V-3 |
| (Carried over) the three stale descriptor strings are fixed | §4.7 D-1…D-3; T-8 |

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | 20261130 is not actually live, so 20261134's rollback would restore a function prod never had | LC-8 and the pre-check's first row stop the paste |
| R-2 | Main takes another regeneration (or 20261134 / 35) before the paste | SR-5 step (b)–(c); rebase, regenerate, renumber; the drift test's sha pins catch a wrong hand merge |
| R-3 | The DROP is pasted before 20261134 | Its guard refuses unless the live cleanup body no longer names the table |
| R-4 | A hidden dependent (view, policy, FK, another function) | Pre-check rows, the guard, and no `CASCADE`: the paste fails with nothing dropped |
| R-5 | Old rows are lost for good | They hold no content; latest backup time recorded (LC-10), not a blocker; SA-Q2 |
| R-6 | Receipts stop mentioning old ZIP exports | Accepted meaning (B.6 "After MX-7: new tables only"); LC-9 sizes it; BQ-E10-2; DELETE notified |
| R-7 | The window lasts longer than one build (CI red, queue stuck) | Admin deletes and cleanup stay refused and nothing is lost. Because 20261135 waits for the deploy (M-1), the restore is the 20261134 rollback alone, with the table and its rows intact; the user decides |
| R-8 | A leftover object in the bucket blocks cleanup deletes after the deploy | LC-6 before the paste and again before the bucket delete |
| R-9 | The PROD-2 baseline still lists five buckets, so its parity check or U5r reports a difference | DevOps hand-off before the PR opens (M-2, Task 10b) |
| R-10 | The generated files are truncated by a failed write | numstat check after the run; temp file + rename for every hand edit |
| R-11 | A project built by PROD-2 also holds the table, and only one project is changed | §8.2 step 2 (f): the sequence runs on each project that holds it, each with its own change records (M-3) |

---

## 13. Open questions for SA

**All sixteen ruled by SA on 2026-11-25** (SA Review Notes, Rulings). Where SA changed Dev's default: SA-Q1 (M-1, 20261135 after the deploy), SA-Q10 (M-2, DevOps hand-off), SA-Q12 (`toCsvText` moves into the test, S-3) and SA-Q13 (T-13 declined). The table below is Dev's original list, kept for the record.

| # | Question | Dev default |
|---|---|---|
| SA-Q1 | Order and window: 20261134, then 20261135, then enqueue at once, in one sitting; bucket deleted after the deploy. The supabase-ops timing test calls this case 3 (split needed), but both directions fail closed and XC-11 accepts this window. Accept it, or require an expand / contract split? | Accept, one sitting (MX-1a precedent) |
| SA-Q2 | Rollback of 20261135 re-creates the shape only ("No known undo for data"). Backup: rely on the project backup confirmed in LC-10, or also take a private JSON copy of the rows? | Backup confirmed, no extra copy |
| SA-Q3 | The 20261135 guard: (1) live cleanup body lacks the table name, (2) no other function names it, (3) no queued or running row, (4) no inbound FK, (5) exact start-function signature; no `CASCADE`, no `IF EXISTS`. Add a refusal when the bucket still has objects? | The five rows; the bucket is checked in the pre-check, not in the DROP |
| SA-Q4 | Bucket delete: the user in the dashboard after the deploy, or a one-off operator script through the Storage API (a new script, service-role key in a local env)? | Dashboard, user |
| SA-Q5 | `findDeletionFacts` body (§4.5): keep the unparseable-time error and the "missing fact is an error" rule | Yes |
| SA-Q6 | "ZIP-only" scope: also remove the singleton `businessOsDataExportJobRepository`, `DATA_EXPORT_JOB_COLUMNS` / `_LIMITS`, the ZIP type exports in the barrel, and the whole DE-8a / DE-8b block of `types.ts` (l.1378–1506, five types already dead since MX-3.1)? Keep the class and `DataExportDeletionFacts` in the barrel | Remove all of them |
| SA-Q7 | "jobPolicy.ts with its 20261074 mirror test": delete `jobPolicy.test.ts` and remove MT-11 from `business-os-data-exports.migration.test.ts`, keeping the rest of that test as history pins? Or delete the whole 20261074 test and the DE-8a scripts? | Remove MT-11 only |
| SA-Q8 | `businessOwnedTables.ts`: remove the DE-8a entry (not in the plan's Touches, but direction 3 fails otherwise, E-20). The `'data_exports'` purge area stays in the union (DELETE's admin files use it) | Remove the entry; keep the union |
| SA-Q9 | D-1, D-2 wording as in §4.7. D-3: switch the two file buckets to `exclude` with a BQ-35 reason (a classification change; no code reads it), or keep `include` and fix only the comments? | Switch to `exclude` |
| SA-Q10 | PROD-2 baseline: `supabase/baseline/after-schema.sql` inserts `business-data-exports` and `schemaParityBaseline.test.ts` pins five buckets. Edit both in MX-7 (with a DevOps claim), or hand to DevOps as a follow-up? | Edit in MX-7, with DevOps told |
| SA-Q11 | Runbook: add the 20261134 / 20261135 row only, or also the missing rows for 20261104, 20, 22, 27, 30? | Ours only; list the gap as a follow-up |
| SA-Q12 | `csv.ts`: remove `toCsv` and keep `toCsvText` (now test-only), or remove `toCsvText` too and pin the bytes through `csvPartText`? | Keep `toCsvText` |
| SA-Q13 | Add the small "no app code names the old objects" guard (T-13)? | Yes, if it fits the existing job |
| SA-Q14 | `scripts/rollback-business-os-data-exports.sql` guards on the retired 6-argument signature (ineffective since 20261081). Leave the DE-8a scripts as untouched history once the table is gone, or add a "do not run after 20261135" header line (their contents are pinned by the 20261074 test)? | Leave untouched |
| SA-Q15 | 20261135's ordering guard is name-based ("the live cleanup body no longer names the table"), not stamp-based, so a regeneration on rebase does not need a second edit. Agree? | Yes |
| SA-Q16 | SA-P8 (count "too large" modules toward the limit) was allowed to ride on MX-7's migration. Keep it out? | Out; it stays open |

---

## 14. Open questions for the user

Final after SA review: two stay open for the user, three are settled by SA.

| # | Question (plain language) | Suggested default | Status |
|---|---|---|---|
| BQ-E10-1 | Keep a private copy of the old download list before it is deleted? | — | **Settled by SA** (SA-Q2): no copy; the latest backup time is recorded instead |
| BQ-E10-2 | Three accounts used only the old "Download my data" file, before 30 October, and never the new email export. After this change, if one of those accounts is deleted, its deletion receipt will say "no export on record" instead of the date of that old download. Receipts already issued do not change. Is that acceptable? | **Yes.** We are in testing mode, and the old download no longer exists | **Answered 2026-11-26: Yes, that's fine** (the user) |
| BQ-E10-3 | To finish, you will do three short things in one sitting of about half an hour: paste one database file, approve the release, and once it is live paste a second database file and delete one empty storage folder in the Supabase dashboard. Before the first paste, please also open Database → Backups and tell us the time of the latest backup. While this runs, admin account deletions and test-account cleanup are paused; they refuse safely and nothing is lost. When suits you? | **Any time you have half an hour free**, in one sitting | **Open, for the user** |
| BQ-E10-4 | Create a test account on production for an after-release click check? | — | **Settled by SA** (M-1 step 4): the deployed-commit and live-stamp check replaces it |
| BQ-E10-5 | Will you delete the empty storage folder in the dashboard? | — | **Settled by SA** (SA-Q4): yes, the user does it; folded into BQ-E10-3 |

---

## 15. Live schema checks requested

Read-only, for the coordinator to run on the production project before SA rules and again at the SR-5 step (`begin read only; <query>; commit;`). Each is one `SELECT`, returns counts, booleans or catalog facts only (no customer rows), and contains no "into". Dev had no database tool in this session; every name below is from migration 20261074, 20261095 and the generator as merged.

| # | Query | Expect | LC results (production project, coordinator, 2026-11-25) |
|---|---|---|---|
| LC-1 | `SELECT count(*) AS total, count(*) FILTER (WHERE requested_by_kind = 'owner') AS owner_rows, count(*) FILTER (WHERE requested_by_kind = 'admin') AS admin_rows, count(*) FILTER (WHERE status IN ('queued', 'running')) AS in_flight, count(*) FILTER (WHERE created_at > timestamptz '2026-10-31') AS after_mx31 FROM public.business_os_data_exports;` | `in_flight` 0, `after_mx31` 0; totals recorded | total 6, owner 6, admin 0, in_flight 0, after_mx31 0 |
| LC-2 | `SELECT p.oid::regprocedure AS fn, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'business_os_data_export_start';` | One row, `p_user_id uuid, p_requested_by uuid, p_requested_by_kind text` | Exactly one: `business_os_data_export_start(uuid, uuid, text)`, args `p_user_id uuid, p_requested_by uuid, p_requested_by_kind text`, SECURITY INVOKER (`prosecdef` false) |
| LC-3 | `SELECT con.conname, con.conrelid::regclass AS from_table, con.confrelid::regclass AS to_table, con.confdeltype FROM pg_catalog.pg_constraint AS con WHERE con.contype = 'f' AND (con.conrelid = pg_catalog.to_regclass('public.business_os_data_exports') OR con.confrelid = pg_catalog.to_regclass('public.business_os_data_exports'));` | One row: its own `user_id` FK to `auth.users` (CASCADE). No row with the table as `to_table` | One FK: `business_os_data_exports_user_id_fkey` to `auth.users` ON DELETE CASCADE. Nothing references the table |
| LC-4 | `SELECT 'view' AS kind, count(DISTINCT rw.ev_class) AS n FROM pg_catalog.pg_depend AS d JOIN pg_catalog.pg_rewrite AS rw ON rw.oid = d.objid WHERE d.refobjid = pg_catalog.to_regclass('public.business_os_data_exports') AND rw.ev_class <> d.refobjid UNION ALL SELECT 'policy', count(*) FROM pg_catalog.pg_policy WHERE polrelid = pg_catalog.to_regclass('public.business_os_data_exports') UNION ALL SELECT 'trigger', count(*) FROM pg_catalog.pg_trigger WHERE tgrelid = pg_catalog.to_regclass('public.business_os_data_exports') AND NOT tgisinternal;` | 0, 0, 0 | views 0, policies 0, triggers 0 |
| LC-5 | `SELECT p.oid::regprocedure AS fn FROM pg_catalog.pg_proc AS p WHERE position('business_os_data_exports' in p.prosrc) > 0 OR position('business-data-exports' in p.prosrc) > 0;` | Exactly the start function and the 8-argument cleanup function | Exactly two: `operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)` and `business_os_data_export_start(uuid, uuid, text)` |
| LC-6 | `SELECT (SELECT count(*) FROM storage.objects WHERE bucket_id = 'business-data-exports') AS objects, (SELECT count(*) FROM storage.buckets WHERE id = 'business-data-exports') AS bucket_rows, (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'storage' AND concat(COALESCE(qual, ''), COALESCE(with_check, '')) LIKE '%business-data-exports%') AS policies;` | 0, 1, 0 | objects 0, bucket rows 1, storage policies naming it 0 |
| LC-7 | Step one: `SELECT pg_catalog.to_regclass('cron.job') IS NOT NULL AS has_pg_cron;`. Only if true: `SELECT jobid, jobname, schedule FROM cron.job WHERE command ILIKE '%data_export%' OR command ILIKE '%data-export%';` (never select `command`: it can hold a header with a key) | No row | `pg_cron` not installed (`cron.job` absent); step two not run |
| LC-8 | `SELECT position('5c369aaf2fa78abf' in p.prosrc) > 0 AS is_20261130 FROM pg_catalog.pg_proc AS p WHERE p.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)');` | `true` | `true`: stamp `5c369aaf2fa78abf` is live, so 20261130 is applied (E-4 settled) |
| LC-9 | `SELECT (SELECT count(DISTINCT e.user_id) FROM public.business_os_data_exports AS e WHERE e.requested_by_kind = 'owner' AND e.ready_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.business_os_export_module_jobs AS j JOIN public.business_os_export_requests AS r ON r.id = j.request_id WHERE j.user_id = e.user_id AND r.origin = 'owner' AND j.status = 'sent')) AS zip_only_owners, (SELECT count(DISTINCT e.user_id) FROM public.business_os_data_exports AS e WHERE e.requested_by_kind = 'admin' AND NOT EXISTS (SELECT 1 FROM public.business_os_export_requests AS r WHERE r.user_id = e.user_id AND r.origin = 'admin')) AS zip_only_admin_accounts;` | Two counts, for BQ-E10-2 | zip_only_owners 3, zip_only_admin_accounts 0 |
| LC-10 | Dashboard, by the user: Database → Backups shows a daily backup or PITR covering the paste time | Yes, recorded by role, no project ids | **Owed by the user** (see SA-Q2: recorded as the 20261135 before-state, not a blocker) |

Also at the SR-5 step: `pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')` and the same for `authenticated` are both false (the regenerated migration refuses otherwise). **Result 2026-11-25:** both false (anon and authenticated have no CREATE on `public`).

---

## Environment changes

Three separate change records (S-9), by role, env-change-protocol §6, filled in during §8.2: (1) 20261134 (step 7; before-state LC-8); (2) 20261135 (step 11; before-state LC-1 and the LC-10 backup time; "No known undo for data" written out); (3) the bucket delete (step 12; before-state LC-6). One set per project that holds the table (M-3).

---

## SA Review Notes

**Reviewed by SA — 2026-11-25 (workplan review; no code exists yet)**
**Status:** ✅ Approved with conditions (M-1 to M-3 are folded into this workplan by Dev before Task 2; S-1 to S-9 are done in the implementation and checked at code review)

Read for this review: this file in full; plan §4.10 and §3 (frozen interfaces, the "Forever" audit-constant line); requirement §6 MX-7 row, §7 AC MX-7, §10 XC-11 / XC-12 / XC-16, §11 S-1 to S-3, S-16, B.6 and SR-1 to SR-12; the `supabase-ops` and `env-change-protocol` skills; and, on this branch (`aa4c1310`): `BusinessOsDataExportJobRepository.ts` (findDeletionFacts l.272–352), `BusinessOsExportModuleJobRepository.findLatestOwnerSentAt`, `SchemaReconciler.ts`, `TestAccountCleanupRepository.emptyStorage`, migration 20261074 and 20261130 (order guard, `fk_review`, G-10 / G-18), the 20261130 rollback, `businessOwnedTables.test.ts` (scanner and direction 3), `exportClassification.test.ts`, `descriptors.invariant.test.ts`, `classification-baseline.json`, the drift test l.1050–1058, commit `8bab24ca` (allow-list precedent), `csv.ts`, and the PROD-2 files `supabase/baseline/before-schema.sql`, `after-schema.sql`, `scripts/__tests__/schemaParityBaseline.test.ts`.

### Live results (coordinator, read-only, production Supabase project, 2026-11-25)

Recorded in §15 ("LC results" column). What they settle:

- **E-4 settled** (LC-8): the live cleanup function carries stamp `5c369aaf2fa78abf`, so 20261130 is applied and 20261134 can chain on it. 20261130 moves to `APPLIED` in the drift test (T-1).
- **The DROP has no hidden dependent** (LC-3, LC-4, LC-5): the only FK is the table's own `user_id` to `auth.users` ON DELETE CASCADE; no view, policy or trigger; exactly two functions name the table or the bucket (the start function and the 8-argument cleanup function). The guard's rows (§4.3) match what is live.
- **The start function** is exactly `(uuid, uuid, text)`, SECURITY INVOKER (LC-2), as 20261074 wrote it. No later migration on main altered the table (grep: only 20261074 and the cleanup regenerations name it), so re-creating 20261074's text is a faithful rollback shape.
- **Nothing in flight, nothing new** (LC-1): 6 rows, all owner, 0 admin, 0 queued or running, 0 created after MX-3.1.
- **The bucket is already empty** (LC-6): 0 objects, 1 bucket row, 0 storage policies. No emptying step is needed; it is still re-read at the paste and before the delete.
- **No pg_cron** (LC-7): E-15 closed.
- **Meaning change sized** (LC-9): 3 owners used only the old ZIP; 0 admin-only accounts, so `adminExportExisted` loses nothing. The 3 owners' "last export" fact is the user's question (BQ-E10-2 below).
- **SR-5 privilege row**: anon and authenticated have no CREATE on `public`.
- **LC-10 (backup) is still owed by the user**, see SA-Q2.

### Rulings on SA-Q1 to SA-Q16

| # | Ruling | Class |
|---|---|---|
| SA-Q1 | **Accepted with a change of order: see M-1.** One sitting and one pause window, yes (XC-11 accepts the window for every regeneration, and both sides fail closed: E-27, confirmed in `SchemaReconciler.ts` l.14–16 and l.164–188). But 20261135 is pasted **after the deploy is Ready**, not before the merge. The window is the same length either way, because new code with the table still present is `drift` (unclassified tenant table), and the new function finds the table's live FK to `auth.users` unreviewed (its `fk_review` list no longer names it). What changes is what is at risk while the merge is pending: under M-1 no data is dropped until the build that no longer reads the table is live | **Must-fix** (M-1) |
| SA-Q2 | No extra copy of the rows. "No known undo for data" is weighed and **accepted**: 6 rows of dates, counts and two ids each, no content, no reader after this PR, and a revert would bring the table back empty anyway (§4.4). A private dump of user ids would be a new personal-data artefact for no gain. LC-10 is still read by the user and recorded as the before-state of the 20261135 step; if the project has no backup covering the paste, record that and proceed. Settled by SA, so BQ-E10-1 is dropped | No fix |
| SA-Q3 | The five guard rows as written; no `CASCADE`, no `IF EXISTS`; **no bucket check in the DROP**. The migration never touches storage, the pre-check and the bucket step read LC-6, and under M-1 the bucket is deleted after the DROP anyway | No fix |
| SA-Q4 | Dashboard, by the user, after the deploy and after 20261135 (production tier, user executes). No script, no service-role key in a local env, no new pattern | No fix |
| SA-Q5 | Yes: the unparseable-time error and the "missing fact is an error" rule stay, and the uuid check without a DB call. `ownerLastExportReadyAt` = N1 (`status = 'sent'`, the message the provider accepted, as MX-4 ruled for XC-12's "accepted"); `ownerExportDownloadedAt` = always `null`; `adminExportExisted` = N2. Signature, path, class, method and type unchanged (SR-2, B.6) | No fix |
| SA-Q6 | Remove all of them: the singleton, `DATA_EXPORT_JOB_COLUMNS` / `_LIMITS`, the ZIP schemas and methods, the ZIP type exports in the barrel, and the whole DE-8a / DE-8b block of `types.ts`. Checked: none of the 17 types in l.1378–1506 is named by any file outside the two repositories, their tests, `types.ts` and the barrel. Keep the class and `DataExportDeletionFacts` (in the repository file) and their barrel lines. `types.ts` is an S-16 surface: removing EXPORT's own dead block is allowed with a coordination-file claim first (already listed in §10 CC-3) | No fix (claim first) |
| SA-Q7 | Remove MT-11 and the `jobPolicy` import only; the rest of `business-os-data-exports.migration.test.ts` stays as history pins of the applied 20261074 and its scripts. The DE-8a scripts are not deleted | No fix |
| SA-Q8 | Remove the `USER_OWNED_TABLES.business_os_data_exports` entry; keep `'data_exports'` in the `PurgeArea` union (DELETE's admin files use it). S-2 says `businessOwnedTables.ts` is add only, but a table that no longer exists cannot stay registered (direction 3 fails, and the scanner drops it on the DROP in 20261135: its `DROPPED` regex is checked). Claim first (CC-3) | No fix (claim first) |
| SA-Q9 | D-1 and D-2 wording approved as in §4.7. D-3: **switch the two file buckets to `exclude`** with the BQ-35 reason; the `include` variant of the shared type stays (tables use it). Note S-1 below for the bucket-count pin | No fix |
| SA-Q10 | **Overruled: do not edit the PROD-2 baseline files in MX-7. Hand them to DevOps.** See M-2 | **Must-fix** (M-2) |
| SA-Q11 | Our rows only (20261134 and 20261135, the newest-rollback paragraph, Change History). The missing rows for 20261104, 20, 22, 27 and 30 are a follow-up posted in the coordination file for their owners, not done here | No fix |
| SA-Q12 | **Changed:** remove `toCsv` and its encoder, and move `toCsvText` out of production code into `csv.test.ts` as a local helper built from the three exported functions. After `toCsv` goes it has no production caller, and production code that exists only for tests is dead code. The BOM bytes and the Hebrew round trip stay pinned through the helper | Should-fix (S-3) |
| SA-Q13 | **Declined.** No new guard (standing rule: no added CI time). After the deletions, `tsc` refuses any import of the removed modules, and the remaining risk (a string table name in a `.from(`) is covered by the one-time repo grep V-6, whose output goes in the Implementation Notes | No fix (T-13 dropped) |
| SA-Q14 | Leave the DE-8a scripts untouched: they are history, pinned by the 20261074 test, and their ineffective guard is moot once the table is gone. The runbook row for 20261135 says the DE-8a rollback is never to be run after it | No fix |
| SA-Q15 | Agreed: name-based, so a rebase that regenerates 20261134 needs no second edit. Guard (1) must look up the function by its exact 8-argument `to_regprocedure`, and guard (2) must scan `pg_proc` in every schema (as LC-5 does), not only `public` | No fix |
| SA-Q16 | SA-P8 stays out of MX-7 and stays open | No fix |

### Must-fix (fold into this workplan before Task 2)

**M-1. Paste 20261135 after the deploy, not before the merge (SA-Q1).** New order, one sitting:

| # | Step | When |
|---|---|---|
| 1 | Pre-check; both checkers shown to `FAIL` on the pre-apply state | Before merge |
| 2 | User pastes 20261134; its checker (md5 row included). The pause window starts | Before merge |
| 3 | Enqueue the PR at once (user's OK, manual merge) | Merge |
| 4 | Deploy Ready: the deployed commit is the merge commit, and the live stamp equals the stamp pinned in the merge commit's version file | After deploy |
| 5 | The 20261135 checker is run once more and must still `FAIL` on its table-absent rows; then the user pastes 20261135; its checker. The pause window ends here | After deploy |
| 6 | LC-6 again (0 objects); the user deletes the bucket; LC-6 again (0 bucket rows) | After deploy |

Why: it is the same window (E-27 still holds: new code with the table present is `drift`), but (a) the old build never runs against a dropped table, so the owner's deletion check never errors; (b) if CI goes red or the queue sticks after step 2, the restore is the 20261134 rollback alone, with the table and its rows intact, instead of a re-created empty table; (c) it follows `env-change-protocol` §2 ("after deploy: removing what the old code still used") and the `supabase-ops` rollback rule (data is dropped only once nothing can need it). SR-6 and XC-11 are both still met (function first, DROP second; apply and merge back to back). Update §4.1, §4.4 (the 20261134 rollback can now run alone while the table exists), §8.2 steps 6–13, §12 R-7, the `ROLLBACK_CONSEQUENCE` text (the 20261135-first line applies only after step 5), the interface notice (§10: during the window `findDeletionFacts` does not error; checks and deletes refuse on the version stamp and then on schema drift), the Overview, and record this as an SA amendment of plan §4.10's "apply N, then N+1, then enqueue" in the plan's Change History (Task 8).

**M-2. The PROD-2 baseline goes to DevOps (SA-Q10).** Dev's E-25 missed two of the three places: `supabase/baseline/before-schema.sql` l.150 (the empty-target guard lists the bucket), `after-schema.sql` l.95–108 (inserts it and counts five), and `schemaParityBaseline.test.ts` l.540–550 **and its negative control at l.1042, which deletes exactly this bucket's insert line**. These are DevOps files in an open stream (DV-3 merged with its live gate U5r owed; DV-2 / DV-4 on another branch awaiting SA), proved file by file; editing them from EXPORT's branch would collide with that branch and redo DevOps proofs. Instead: before the PR opens, post a hand-off to DevOps in the coordination file and a DO message: "after MX-7 the `business-data-exports` bucket no longer exists on the source project; the baseline's bucket list, its count of five, the before-schema guard and the parity test (including the l.1042 negative control, which needs another bucket) must move to four before U5r". Remove the conditional row from §5, the DevOps claim from §10 CC-3, and point R-9 at the hand-off.

**M-3. Name the target project and check PROD-2 first.** Add to §8.2 step 2 a row (f): DevOps confirms, by role, which Supabase project(s) hold `business_os_data_exports` at the time of the paste (the coordinator's LC run used "the production project"; PROD-2 is building a new production project from what its workplan calls staging). If a project built by PROD-2 already exists and holds the table, steps 1–6 of M-1 run on each project that holds it, each with its own change record. Use the same role names the PROD-2 workplan uses, so the two records cannot point at different projects.

### Should-fix (in the implementation; checked at code review)

- **S-1.** `exportClassification.test.ts` l.337 `expect(STORAGE_DESCRIPTORS.length).toBeGreaterThanOrEqual(4)` fails with three buckets: change it to 3 (Dev listed only l.341–350). With D-3, the "include" list at l.347–350 becomes `[]`; rename that test to say files are not exported (BQ-35).
- **S-2.** The 20261135 rollback and T-7e: compare against 20261074's text **statement by statement**, not "column list, indexes, RLS, grants": the full `CREATE TABLE` (defaults, the FK to `auth.users` ON DELETE CASCADE, all eleven named CHECK constraints), the three indexes including the unique partial one, RLS, the REVOKE / GRANT lines, the start function body byte-equal, and 20261074's own privilege post-condition (its l.186–206).
- **S-3.** SA-Q12: `toCsvText` moves into `csv.test.ts`.
- **S-4.** Claims: §10 CC-3 lists `types.ts`, `businessOwnedTables.ts`, the `no-deletion-paths` allow-list and the credit-lots test; add also the S-2 test files (`exportClassification.test.ts`, `descriptors.invariant.test.ts`, `classification-baseline.json`), `lib/business-os/purge/types.ts` (doc comment), `.gitattributes`, and `docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md`. All claims logged before Task 2 starts; none for the baseline files (M-2).
- **S-5.** `ROLLBACK_CONSEQUENCE` and §4.4: the restored 20261130 body checks table presence with `to_regclass` and reviews live FKs (G-10 / G-18), so after the DROP it may refuse with a guard row rather than error. Write "refuses (fails closed)" unless the drift test proves the exact failure.
- **S-6.** Checkers: the 20261135 checker is shown to `FAIL` twice, at the pre-check and again immediately before its paste (M-1 step 5). The 20261134 checker's rows for "the body names neither the table nor the bucket" and the md5 row must read `FAIL` before the paste. Every pre-check and checker file: one read-only `SELECT`, numbered rows, a stated row count, no write keyword, no `SET`, and no word "into" anywhere in the file (T-7d already covers comments and literals; extend it to identifiers and aliases so the editor bug cannot bite a paste).
- **S-7.** §1.1: mark E-4 and E-15 settled by LC-8 and LC-7; E-16 says "Four of them" and lists five.
- **S-8.** `findDeletionFacts` JSDoc and the DE-10b requirement line (S-14): state the meaning from MX-7 exactly as XC-12 does, and that an old ZIP no longer counts (BQ-E10-2's answer goes in the same line).
- **S-9.** The change records for 20261134, 20261135 and the bucket are three separate blocks under `## Environment changes`, by role, with LC-1 / LC-6 / LC-8 as the before-state and "No known undo for data" written out on the 20261135 block.

### Checked and found right

- **SR-6 order** (20261134 then 20261135) is enforced in SQL by guard (1), name-based, and kept under M-1.
- **The DROP guard** covers what LC-2 to LC-5 found live. `DROP FUNCTION` before `DROP TABLE`, no `CASCADE`, `lock_timeout`, post-condition, `NOTIFY pgrst`: approved. A DROP rollback that restores the shape only is meaningful as one step of the full restore (20261135 rollback, 20261134 rollback, PR revert, redeploy), because the restored 20261130 function and the old build both expect the table. It restores no rows, and says so.
- **`findDeletionFacts` stays frozen** (same path, class, optional-client constructor, method and `DataExportDeletionFacts`), and its XC-12 meaning holds after O1 / O2 go. T-6h pins the contract; DELETE's four route tests run unedited (T-6i).
- **`DATA_EXPORT_*` audit constants are kept**: `events.ts` and `eventAudience.ts` are not opened.
- **`receiptInput.ts`** is not opened (SR-1).
- **Descriptor counts**: the table descriptor is `exclude`, so 168 becomes **167 = 38 + 0 + 129**; buckets are not in that count. `classification-baseline.json` loses two entries (l.56 level, l.182 note). The `businessOwnedTables.ts` entry goes in the same PR (direction 3).
- **Regeneration pins** follow `8bab24ca` exactly (20261127 named on its own in both allow-lists, built from `INITIAL_FUNCTION_MIGRATION`, R-7); the drift test's l.1057–1058 assertion flips.
- **`emptyStorage`** derives its bucket list from `STORAGE_DESCRIPTORS`, so a leftover object would be refused after the deploy; LC-6 shows none.
- **Entitlements**: nothing in the plan imports from `lib/business-os/entitlements/`; V-4 greps it.
- **No CI time added**: T-7 is one more text test in the existing job (milliseconds); T-13 is dropped; no workflow change.
- **Effort**: 1.75 d against a 1.5 d budget is accepted; dropping T-13 and the smaller `csv.ts` change recover part of it. D-3 stays a real classification change.

### User questions (final, after SA review)

BQ-E10-1 (backup copy), BQ-E10-4 (a production test account) and BQ-E10-5 (the bucket click) are settled by SA (SA-Q2, M-1 step 4, SA-Q4); the click is folded into the hand-over in BQ-E10-3. Two remain, to be put to the user exactly as below:

| # | Question | Suggested default |
|---|---|---|
| BQ-E10-2 | Three accounts used only the old "Download my data" file, before 30 October, and never the new email export. After this change, if one of those accounts is deleted, its deletion receipt will say "no export on record" instead of the date of that old download. Receipts already issued do not change. Is that acceptable? | **Yes.** We are in testing mode, and the old download no longer exists |
| BQ-E10-3 | To finish, you will do three short things in one sitting of about half an hour: paste one database file, approve the release, and once it is live paste a second database file and delete one empty storage folder in the Supabase dashboard. Before the first paste, please also open Database → Backups and tell us the time of the latest backup. While this runs, admin account deletions and test-account cleanup are paused; they refuse safely and nothing is lost. When suits you? | **Any time you have half an hour free**, in one sitting |

### Approval

[x] Workplan approved with conditions: Dev folds M-1, M-2 and M-3 into this file (SA re-reads only those sections, no full re-review), logs the S-4 claims, then proceeds. S-1 to S-9 are checked at code review.

### Code review

**Code Review by SA — 2026-11-26** (worktree `neuronforge-mx7`, branch `feature/bos-export-mx7-drop-old-table`, uncommitted, read with `git diff` + `git status`; no database touched)
**Status:** ✅ Approved with fixes (one small must-fix, CR-M1; no re-review needed beyond a diff of the two scripts and their test lines)

Re-run by SA on the worktree: the V-1 subset (`scripts/__tests__/testAccountCleanupSql.test.ts`, `supabase/migrations/__tests__`, `lib/business-os/purge`, `lib/business-os/data-export`, `businessOwnedTables.test.ts`, the job repository test, DELETE's `deletion-check` and `test-account-cleanup` route tests): **101 of 101 suites, 4,391 tests pass**. Also `lib/repositories/__tests__`, `components/payments/__tests__/exportMatchesTheScreen.guard.test.ts`, `lib/crm` / `lib/payments` csv tests and `app/admin/users`: 175 of 175 suites pass. `tsc --noEmit` (8 GB, no OOM trace, 1,846 errors repo-wide): the only hit in a touched file is the existing `exportClassification.test.ts(2064)` TS2353 (HEAD l.2054 moved by +10). No error names a removed module, export or type; a repo grep finds no remaining user of the 17 removed types, the singleton, `jobPolicy`, the storage repository or `toCsvText`.

#### Must-fix

1. **CR-M1. The "must read FAIL before the paste" lines under-state the rows that fail, so an operator following them sees an unexpected FAIL.** Priority: Medium (operator-facing, cheap).
   - `scripts/check-test-account-cleanup-drop-data-exports-migration.sql:3` says rows 5, 7 and 8 read FAIL before the paste. Row 6 ("the 20261130 stamp is gone") also reads FAIL then, because 20261130 is live. Say **rows 5, 6, 7 and 8** (rows 1 to 4 ok).
   - `scripts/check-drop-data-exports-migration.sql:3-4` says rows 1, 2 and 4 read FAIL "both times". At the step-6 run (before 20261134) row 3 (the 20261134 stamp) also reads FAIL; only at the step-11 run is row 3 ok. Say so per run: step 6, rows 1 to 4 FAIL; step 11, rows 1, 2 and 4 FAIL and row 3 ok (row 3 ok at step 11 is itself a useful check that 20261134 is still live).
   - Update the pins in `supabase/migrations/__tests__/business-os-data-exports-drop.migration.test.ts:305` and `:311`, the QA line in N-5 (l.766 of this file), and §8.2 step 6 / step 11 if they quote the rows. Keep the comment lines paste-safe (no `;`, no apostrophe, no "into"). No other file changes.

#### Rulings on the deviations

| # | Ruling |
|---|---|
| D-1 | **Accepted.** Verified line by line against 20261074 l.162–288: the rollback's `$post_condition$` is byte-equal with items 6 and 7 (bucket, storage policies) cut, and T-7e builds the expected block from the 20261074 text minus exactly that slice, so it cannot drift. My "l.186–206" in S-2 was a loose reference; the whole block is the better reading. Keeping `v_names` declared and unused keeps the DECLARE byte-equal: fine |
| D-2 | **Accepted.** The "browser roles cannot CREATE in public" pre-guard is 20261074's own, refuses with nothing changed, and LC/SR-5 showed it passes today |
| D-3 | **Accepted.** Seven refusals: (a) table exists, (b) the 8-argument function exists, (c) its body no longer names the table (SA-Q15 exact `to_regprocedure`), (d) no other function in any schema names it (no `nspname` filter, start function exempt), (e) nothing queued or running, (f) no inbound FK from another table, (g) the start function is exactly `(uuid, uuid, text)` and the only overload in `public`. (b) closes a real hole: without it (c) passes vacuously when the function is missing. All fail closed, all are name-based |
| D-4 | **Accepted.** The `contact_documents` (descriptors l.189–190) and `user_media` (l.1012) comments carried the same stale "arrive in DE-8b" claim. Comment only |
| D-5 | **Accepted, owed by the coordinator** with Task 10 / 10b: the coordination-file follow-up line for the missing runbook rows. The runbook's gap note is in place |
| D-6 | **Accepted.** 167 = 38 + 129 is right (`exportClassification.test.ts` pins it). The ⚠️ naming the four unlisted excluded tables is the honest fix; listing them is for their owners |
| D-7 | **Owed by the coordinator before the PR opens:** the S-4 claims (Task 1b). Not verifiable from the worktree. RM must not open the PR without them |
| D-8 | **Accepted.** The write-keyword scan runs on the text with comments and single-quoted literals emptied (`has_schema_privilege(…, 'CREATE')` is a literal, not DDL), while "no SET", "no into" and "exactly one `;`" run on the raw file, so a keyword hidden in a comment still fails the stricter checks. The negative controls (alias `check_into`, a leading `SET`, a second statement, a planted `DELETE` CTE, a skipped row number, a wrong stated count) prove each detector can fail |

#### Checked and found right

- **`findDeletionFacts` frozen** (`lib/repositories/BusinessOsDataExportJobRepository.ts`): same path, class, `constructor(supabaseClient?: SupabaseClient)`, method signature and `DataExportDeletionFacts` (same three fields, still exported from the repository file and the barrel). Body: N1 and N2 only, through `BusinessOsExportModuleJobRepository` / `BusinessOsExportRequestRepository` with `this.supabase`; uuid refused without a DB call; any read error or missing fact is an error (K-3); an unparseable `sent_at` is an error naming the field. `ownerExportDownloadedAt` is always `null`. Meaning per SA-Q5 and XC-12; the JSDoc states it and that an old ZIP no longer counts, with the BQ-E10-2 answer (S-8). The file has no `.from(` / `.rpc(` (T-6a pins it on the code lines, non-vacuously). Pino logger unchanged; ids and field names only
- **T-6a to T-6h** cover the plan; the recording fake throws on any table other than the two, so "no read of the dropped table" is structural, not only asserted. DELETE's route tests pass unedited (T-6i)
- **Regeneration follows `8bab24ca`**: `FUNCTION_MIGRATION` 20261134, `PREVIOUS_FUNCTION_MIGRATION` 20261130; stamp `5c369aaf2fa78abf` → `9a097ff36229f6b5`; the 20261130 pair moved to `APPLIED` with its unchanged hashes (`25e15f00…173c`, `f2e7398e…4a00`); `APPLIED_TARGET` holds the 20261134 pair. 20261127 named on its own in both allow-lists, built from `INITIAL_FUNCTION_MIGRATION` (R-7); the previous-slot pin reads 20261130; the credit-lots L8 list gains the 20261130 pair (add only). The new "changes nothing else" test (the 20261134 body equals the 20261130 body minus the table rows and the bucket, renumbered, stamp swapped) is the strongest pin this regeneration has had, and the checker's md5 is derived from the committed body in the test
- **`ROLLBACK_CONSEQUENCE`** worded per S-5 ("refuses … (fails closed)"), with the 20261135-first line applying only after the drop (M-1)
- **20261135**: one transaction; `SET LOCAL lock_timeout = '5s'`; guard before any DROP; `LOCK TABLE … ACCESS EXCLUSIVE`; `DROP FUNCTION` before `DROP TABLE`; no `CASCADE`, no `IF EXISTS`, nothing about storage; post-condition on both `to_regclass` and `to_regprocedure`; `NOTIFY pgrst` last. ASCII, LF, no "into" in any case, header-only comments without `;` or apostrophe. The `DROP TABLE public.business_os_data_exports;` line is what the ownership scanner reads
- **20261135 rollback** (S-2): refuses while the table or the function exists; every 20261074 statement present in order and byte-equal (T-7e extracts them from 20261074, not retyped; the start body is also md5-pinned). Its two "into" are the real `INSERT INTO` / `RETURNING … INTO` keywords of the function body, the same text that was pasted for 20261074
- **Pre-check and checkers**: one read-only `SELECT` each, `WITH … ORDER BY checks.ord;`, numbered rows with stated counts (10 / 8 / 4), ok / FAIL column, no write keyword, no `SET`, no "into" anywhere. Each can fail on the pre-apply state (CR-M1 is only about the stated FAIL rows). The 20261134 checker's row 8 md5 operator gate is present
- **S-1** met (the bucket count reads `toBeGreaterThanOrEqual(3)` but the next test pins the exact three bucket names, so it is effectively exact; the include list is `[]`; the test is renamed). **S-2, S-3** (`toCsvText` / `toCsv` are local helpers in `csv.test.ts` built from the three exported functions; the BOM, Hebrew and byte-fixture pins go through them), **S-5, S-6** (subject to CR-M1), **S-7, S-8** met. **S-4** see D-7. **S-9** is a §8.2 deliverable: the three blocks are specified under `## Environment changes` and are filled at the paste
- **Not edited** (`git diff --stat` empty): `lib/audit/events.ts`, `eventAudience.ts`, `receiptInput.ts`, DELETE's routes and tests, `app/admin/users/**`, every applied migration (20261074, 20261075, 20261130 and its rollback included), the DE-8a scripts, `vercel.json`, `bosCronJobs.ts`, and the PROD-2 files `supabase/baseline/*.sql` and `scripts/__tests__/schemaParityBaseline.test.ts` (M-2)
- **CLAUDE.md rules**: no new `.from(` (rule 1); no `console.*` in any touched code file (rule 3); TS strict holds, no new `any`; no entitlements import
- **No backslash followed by a hex digit** in any changed or new file (the `LC_ALL=C grep -cE` backslash-then-hex-digit count is 0 on every one, the workplan included)
- **Line endings**: every modified file keeps its eol (index LF, CRLF working copy where it was CRLF); the five new SQL files and the two regenerated SQL files are LF with `text eol=lf` lines in `.gitattributes`. The version file is LF in the working copy (generator output); git normalises it on commit, as for every earlier regeneration
- **No CI time added**: one more text-test file in the existing Jest job (milliseconds); no workflow change

#### Optimisation suggestions (non-blocking)

- `supabase/migrations/20261135_drop_business_os_data_exports.sql`: the in-flight check (refusal e) runs before `LOCK TABLE`, so a row inserted between the two would be dropped. Nothing can insert (no caller since MX-3.1, EXECUTE is service-role only, and LC-1 found none), so this is theoretical. If you touch the file anyway, the `LOCK TABLE` could move inside the guard right after refusal (a), so the in-flight read happens under the lock
- `supabase/migrations/__tests__/business-os-data-exports.migration.test.ts:279-280`: two blank lines left where MT-11 was
- `docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md`: **Last Updated** reads 2026-11-25 but the file now has a 2026-11-26 row; the §4.10 "Manual prod gate" cell still reads "apply N, then N+1, then enqueue at once" (the Change History row records the M-1 amendment; a "(amended 2026-11-25, see Change History)" note in the cell would stop a reader taking the old order)
- `docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md`: the new 2026-11-26 Change History row sits above the 2026-11-02 row; move it to the end
- `lib/business-os/account-deletion/closureLifecycle.ts:16` still cites "the jobPolicy.ts precedent", a file this PR deletes. DELETE owns the file, so it is not edited here: add it to the DELETE interface notice (Task 10) as a one-line comment follow-up
- V-2 (full `npm test` against a `main` baseline, FAIL lines deduplicated) is still owed: QA runs it before the user sees the diff

### Code Approved for QA: Yes, once CR-M1 is done (SA checks only the two script headers and the two test pins; no full re-review)

**SA re-check 2026-11-26: CR-M1 cleared, Code Approved for QA: Yes.** Both checker headers now name the right FAIL rows (20261134 checker: rows 5 to 8 before the paste; 20261135 checker: rows 1 to 4 at step 6, rows 1, 2 and 4 with row 3 ok at step 11). The comment lines stay paste-safe (no "into", no `;` or apostrophe, LF, one statement), the pins at the drop test l.305, l.311 and l.312 match, N-5 is updated, and the drop, DE-8a and drift tests pass (3 suites, 352 tests). The three optional items (blank line, plan Last Updated and the §4.10 note, DE-10b row order) are done correctly.

---

## Implementation Notes

**Dev, 2026-11-26. Tasks 2 to 9 done on `feature/bos-export-mx7-drop-old-table`, uncommitted.** No database touched, no message sent, nothing staged. Tasks 1b (claims), 10, 10b, 11 and 12 are the coordinator's.

### N-1 The new stamp

`npx tsx scripts/generate-test-account-cleanup-sql.ts` (exit 0) after the descriptor edits: **`CLEANUP_FUNCTION_VERSION` `5c369aaf2fa78abf` → `9a097ff36229f6b5`**. md5 of the committed 20261134 function body (the checker's row 8 operator gate): `44c6e9b643c9f2741cf6da705539ba18`. `APPLIED_TARGET` pinned last, once the bytes were final: 20261134 `22b5531f7d394b76d85e790c4acf1114365ff675e3038b861eeb0d78d3efdb4a`, its rollback `cb1763b18da1f053c57beeb3ee83aada9978525b26c5020daae052f2e37a00c0`. 20261130 and its rollback were not touched (their sha256 pins `25e15f00…173c` / `f2e7398e…4a00` now sit in `APPLIED` and pass).

### N-2 Numstat check (V-5: nothing emptied)

Generated files: `scripts/test-account-cleanup-check.sql` 127+/129-, `scripts/test-account-cleanup-delete.sql` 376+/380-, `cleanupFunctionVersion.generated.ts` 1+/1-; new 20261134 migration 4,759 lines and rollback 4,742 lines. No generated file emptied. The "Not edited" list of §5 shows no diff: `lib/audit/events.ts`, `eventAudience.ts`, `receiptInput.ts`, DELETE's routes and tests, `app/admin/users/**`, `vercel.json`, `bosCronJobs.ts`, 20261074 / 20261075 / 20261130 and its rollback, the DE-8a scripts, and the PROD-2 baseline files (`supabase/baseline/before-schema.sql`, `after-schema.sql`, `scripts/__tests__/schemaParityBaseline.test.ts`).

| File | Change (lines) |
|---|---|
| `lib/business-os/purge/descriptors.ts` | 22+/22-: table and bucket descriptors and `EXPORT_REASON.EXPORT_ITSELF` removed; D-1 `OWNER_ID`, D-2 `DOCUMENT_STORAGE` reworded (also the l.917 comment and the same stale "files arrive in DE-8b" comment on `contact_documents` and `user_media`); D-3 both file buckets `exclude` with `FILES_NOT_EXPORTED` (BQ-35) |
| `lib/business-os/businessOwnedTables.ts` | 2+/5-: the DE-8a entry removed (SA-Q8) |
| `lib/business-os/purge/types.ts`, `lib/business-os/data-export/classificationTypes.ts` | doc comments only (D-3) |
| `exportClassification.test.ts`, `descriptors.invariant.test.ts`, `classification-baseline.json` | 167 = 38 + 0 + 129; bucket count pin 3; renamed test "files are not exported (BQ-35)", include list `[]`; `OWNER_ID_REASON` carries D-1 |
| `scripts/generate-test-account-cleanup-sql.ts` | 19+/14-: §4.2 constants and the 20261134 doc paragraph; `FUNCTION_REQUIRED_TABLES` entry removed |
| `scripts/__tests__/testAccountCleanupSql.test.ts` | 121+/14-: T-1 (20261130 to `APPLIED`, previous pin, l.1057 flip, new `20261134` describe block of 8 tests incl. "changes nothing else" and the checker md5 pin) |
| `no-deletion-paths.guard.test.ts` | 32+/4-: T-2, 20261127 named on its own in both allow-lists (built from `INITIAL_FUNCTION_MIGRATION`), previous slot reads 20261130 |
| `business-os-credit-lots.migration.test.ts` | 5+/0-: T-3, the 20261130 pair added (add only) |
| `supabase/migrations/20261135_drop_business_os_data_exports.sql` | new, 73 lines (§4.3) |
| `supabase/SQL Scripts/20261135_drop_business_os_data_exports_rollback.sql` | new, 259 lines (§4.4, S-2): every statement extracted from 20261074's text, not retyped |
| `scripts/precheck-drop-data-exports.sql` (10 rows), `scripts/check-test-account-cleanup-drop-data-exports-migration.sql` (8 rows), `scripts/check-drop-data-exports-migration.sql` (4 rows) | new, 57 / 46 / 24 lines (§4.9, S-6) |
| `supabase/migrations/__tests__/business-os-data-exports-drop.migration.test.ts` | new, 378 lines: T-7a to T-7f, each detector with a negative control on a planted copy |
| `.gitattributes` | 9+: `text eol=lf` for 20261135, its rollback and the three scripts |
| `lib/repositories/BusinessOsDataExportJobRepository.ts` | 629 → 126 lines: `findDeletionFacts` only (§4.5, S-8 JSDoc), singleton and every ZIP method removed |
| `lib/repositories/__tests__/BusinessOsDataExportJobRepository.test.ts` | 714 → 243 lines: T-6a to T-6h |
| `lib/repositories/BusinessOsDataExportStorageRepository.ts` (197) + test (130), `lib/business-os/data-export/jobPolicy.ts` (51) + test (51) | deleted |
| `lib/repositories/index.ts` | 5+/27-: the class and `DataExportDeletionFacts` only (SA-Q6) |
| `lib/repositories/types.ts` | 2+/129-: the DE-8a / DE-8b block removed |
| `business-os-data-exports.migration.test.ts` | 2+/13-: the `jobPolicy` import and MT-11 only (SA-Q7) |
| `moduleExportPolicy.ts` | comment l.18 |
| `csv.ts` (92 → 82), `csv.test.ts` (139 → 155) | `toCsv`, its encoder and `toCsvText` out of production; `toCsvText` and `toCsv` are local test helpers built from the three exported functions (S-3, T-11) |
| Docs | runbook (§6.1.1 row, newest-rollback paragraph, "never run the DE-8a rollback after 20261135", gap note for 20261104 / 20 / 22 / 27 / 30, Change History); contents doc (§6.10, §7 table resolved, all 37 OWNER_ID and 3 DOCUMENT_STORAGE quotes updated, §6 totals, Change History); DE-10b requirement (the S-8 line with XC-12 and BQ-E10-2); master requirement §6 MX-7 note + Change History; plan §4.10 Workplan row + Change History; this file (R-5 fixed, tasks ticked, status) |

### N-3 Verification §8.1

| # | Result |
|---|---|
| V-1 | `npx jest scripts/__tests__ lib/business-os/purge lib/business-os/data-export lib/business-os/__tests__ lib/repositories/__tests__ supabase/migrations/__tests__ app/api/business-os/account/deletion-check app/api/admin/test-account-cleanup lib/server/__tests__/testCleanupSecret.test.ts`: **296 of 298 suites pass, 9,005 of 9,008 tests**. The 2 failing suites (3 tests) are `lib/business-os/__tests__/bookingNextStep.test.ts` (2, source scans of `bookingNextStep.ts` and the translations) and `LanguageContext.initialLanguage.render.test.tsx` (1, timezone T-1). Neither they nor anything they read is touched by this branch. They fail the same way when run alone, and match the known Windows CRLF source-scan pattern. They are not from MX-7, but no `main` baseline was run to prove it (V-2). After a later regex edit, the drift test and the new T-7 file were re-run: 271 of 271 pass. DELETE's route tests (T-6i) pass unedited inside V-1 |
| V-2 | **Not run** (a full `npm test` on the branch and on a `main` baseline). Owed before the PR, or by QA |
| V-3 | `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`: exit 2, 1,846 errors repo-wide (existing ones, semantic ones included, so the semantic pass ran; no OOM trace). Filtered to the touched files: one hit, `exportClassification.test.ts(2064)` TS2353. It is the same line as HEAD l.2054, moved by +10 lines, so it predates MX-7. No error names a removed module or export |
| V-4 | `npx eslint` on the 19 touched TS files: 0 errors, 1 warning (`lib/repositories/types.ts:824` `no-explicit-any`, existing, outside the removed block). No touched file imports from `lib/business-os/entitlements/` (grep). `npm run test:bos-entitlements`: 349 of 349 suites, 10,117 of 10,117 tests pass |
| V-5 | See N-2 |
| V-6 | See N-4 |

Also checked: no `console.*` in any touched `lib/` file; no new backslash followed by a hex digit in any touched file (per-file count against HEAD. the digit and word-boundary regex escapes first written in the two new test blocks were rewritten as `[0-9]` and lookarounds, so the count is unchanged or lower everywhere); CRLF kept on every CRLF file, LF on the five new SQL files and on the generated ones; the five new SQL files are ASCII and contain no "into" except the two start-function keywords in the 20261135 rollback, which the test allows by name.

### N-4 The V-6 grep

`git grep -l -e business_os_data_exports -e business_os_data_export_start -e business-data-exports` (plus untracked files), with `docs/`, `supabase/migrations/<n>_*.sql` and `supabase/SQL Scripts/` left out:

```text
.gitattributes                                    the new LF lines (file names)
lib/audit/events.ts                               l.122 comment, not opened (E-7)
lib/business-os/businessOwnedTables.ts            l.251 comment: removed in MX-7
lib/business-os/data-export/__tests__/exportClassification.test.ts   history comments; has(...) is false
lib/business-os/purge/__tests__/descriptors.invariant.test.ts       history comments
lib/business-os/purge/descriptors.ts              l.76, l.1367, l.1622 comments: removed in MX-7
lib/repositories/BusinessOsDataExportJobRepository.ts              l.7 header comment
lib/repositories/__tests__/BusinessOsDataExportJobRepository.test.ts  asserts the table is NOT read
scripts/__tests__/schemaParityBaseline.test.ts    PROD-2, DevOps hand-off (M-2), not edited
scripts/__tests__/testAccountCleanupSql.test.ts   asserts absence; history pins
scripts/check-business-os-data-exports.sql, measure-data-export-size.sql, precheck-bos-boost-reversal-events.sql,
  precheck-business-os-data-exports.sql, probe-business-os-data-exports.sql, rollback-business-os-data-exports.sql
                                                  DE-8a history scripts (SA-Q14), not edited
scripts/check-drop-data-exports-migration.sql, check-test-account-cleanup-drop-data-exports-migration.sql,
  precheck-drop-data-exports.sql                  the MX-7 scripts
scripts/generate-test-account-cleanup-sql.ts      doc comments and the 20261134 header strings
supabase/baseline/after-schema.sql, before-schema.sql   PROD-2, DevOps hand-off (M-2), not edited
supabase/migrations/__tests__/business-os-boost-reversal-events.migration.test.ts, business-os-credit-lots.migration.test.ts,
  business-os-data-exports-drop.migration.test.ts, business-os-data-exports.migration.test.ts   history and MX-7 text tests
```

No application code under `app/`, `components/` or `hooks/` names any of the three, and no `.from(` or `.rpc(` names the table or the start function anywhere outside migrations and SQL scripts.

### N-5 Deviations and notes for SA

| # | What | Why |
|---|---|---|
| D-1 | The rollback's post-condition is 20261074's **whole** `$post_condition$` block minus items 6 and 7 (the bucket and its storage policies), not only l.186–206 | Those line numbers cut through item 2. Items 1 to 5 and 8 hold the privilege, index, function and FK post-condition, byte-equal. The bucket is not re-created (§4.4), so items 6 and 7 would always fail. `v_names` stays declared, unused, so the DECLARE is byte-equal too |
| D-2 | The rollback also keeps 20261074's "browser roles cannot CREATE in public" pre-guard | Copied from 20261074's own pre-guard; refuses with nothing changed |
| D-3 | 20261135's guard has 7 refusals, not 5: also "the table exists" and "the 8-argument cleanup function exists" | Without them, a paste on a project without the table fails on `LOCK TABLE` with a less clear message, and a missing 8-argument function would pass guard (1) vacuously. Both fail closed. Guard (5) also refuses a second overload named `business_os_data_export_start` |
| D-4 | The stale "the files arrive in DE-8b" comments on `contact_documents` (descriptors l.190) and `user_media` (l.1012) were reworded with l.917 | Same stale claim as D-2. Comment only |
| D-5 | **Not done: the coordination-file line** for the missing runbook rows 20261104, 20, 22, 27 and 30 (Task 8, SA-Q11) | The coordination file is outside the worktree, and the brief said to work only there. The runbook carries the gap note. The coordinator should post the line with Task 10 / 10b |
| D-6 | The contents doc §6 total now says 167 = 38 + 129, with a ⚠️ that the four excluded tables added since 2026-11-02 (`proposal_attachments`, `proposal_signatures`, `refund_requests`, `crm_client_standing`) are not listed in §6 | The page said 164 = 38 + 126 before MX-7 and was already stale. Listing those four belongs to their owners |
| D-7 | Task 1b (claims) was not done by Dev | The coordinator's, outside the worktree. Not verified from here |
| D-8 | The T-7 `scriptProblems` write-keyword check runs on the SQL with comments and literals emptied | `has_schema_privilege(..., 'CREATE')` is a literal, not a statement. `no SET`, `no "into"` and "exactly one `;`" run on the raw text |

For the user's diff view and QA: the 20261134 checker must read `FAIL` on rows 5, 6, 7 and 8 before the paste (row 6 too, because 20261130 is live). The 20261135 checker must read `FAIL` on rows 1, 2, 3 and 4 at the pre-check (step 6, before 20261134), and on rows 1, 2 and 4 with row 3 `ok` right before its paste (step 11) (S-6; SA code review CR-M1).

---

## QA Testing Report

**QA — 2026-11-26** (worktree `neuronforge-mx7`, branch `feature/bos-export-mx7-drop-old-table`, uncommitted; no database touched, nothing committed, no stash, no install)
**Test mode:** full (V-2 regression and the targeted cases)
**Strategy used:** A (Jest unit and SQL-text tests) for `findDeletionFacts`, the 20261135 text, the checkers and the drift pins. Full-suite regression (V-2) against a clean `main` baseline. The checkers were also read row by row against the pre-apply and post-apply states, because no branch database exists and the live FAIL proof is §8.2 step 6 by design
**Focus:** api, schema, security, pipeline (cleanup regeneration)
**Skipped:** D (no UI in this slice); live SQL runs (no database access allowed, owed at §8.2 steps 5, 6, 8 and 11); `test:bos-entitlements` not re-run, because no touched file imports from `lib/business-os/entitlements/` (grep on the diff: 0), and Dev ran it once (V-4, 349 of 349 suites)
**Input source:** prompt (TL brief) and the workplan §7, §8.1, §11

### V-2: full Jest, branch against a `main` baseline

| | Branch (worktree) | Baseline |
|---|---|---|
| Commit | `aa4c1310` plus the uncommitted MX-7 diff (CR-M1 header pins in place, the T-7 file passed with them) | `aa4c1310` detached, read-only worktree; node_modules junctioned to the shared one, the junction then removed and the worktree removed with plain `git worktree remove` |
| Suites | 2,138 (31 failed) | 2,139 (31 failed) |
| Tests | 52,551 (150 failed) | 52,579 (150 failed) |

The baseline is the branch's merge base `aa4c1310` (a `main` commit), not today's `origin/main` `a0de0585`, so that only the MX-7 diff differs between the two runs. The rebase at §8.2 step 2 (a) re-runs CI against current `main`.

Compared by suite path from `--json` output (no duplicate FAIL lines), then test by test inside every shared suite:

- **Suites failing on the branch but not on main: none.**
- **Tests failing on the branch but not on main, inside a suite both runs share: none.** Each of the shared failing suites fails on exactly the same test names
- Suite count -1 is the diff: `jobPolicy.test.ts` and `BusinessOsDataExportStorageRepository.test.ts` deleted, `business-os-data-exports-drop.migration.test.ts` added (passes)
- The one "main only" entry, `tests/plugins/integration-tests/document-extractor-all-invoices.integration.test.ts`, has Jest status `focused` on the baseline and `passed` on the branch. Nothing failed: it is a live-credential integration suite that is exempt from the network guard, and its status differs from run to run. Not related to MX-7
- **The two suspected Windows-local failures also fail on main, identically:** `lib/business-os/__tests__/bookingNextStep.test.ts` (the same 2 tests: "every action the banner can offer has a label in every language", "… and a handler in the card that runs it") and `lib/business-os/__tests__/LanguageContext.initialLanguage.render.test.tsx` (the same 1 test: "timezone (T-1) stays UTC until the preferences row arrives, then takes its zone"). They do not come from MX-7
- The other 29 failing suites are the known clean-main noise (V6 / pilot / orchestration suites, the live plugin integration suites, and a set of `*.guard.test.ts` source scans). All of them fail the same way on both runs

### Test Coverage

| Acceptance criterion / brief item | Tested? | Result | Notes |
|---|---|---|---|
| `findDeletionFacts` reads only the new tables (happy path) | ✅ | Pass | T-6a: exactly two queries, `business_os_export_module_jobs` and `business_os_export_requests`, both `.eq('user_id', …)`. The fake throws on any other table, so a read of the old table cannot pass. T-6a source scan: no `.from(`, `.rpc(`, table name or `jobPolicy` on code lines, non-vacuous. T-6b/c/d: `null, null, false`; owner `sent_at`; `ownerExportDownloadedAt` always `null`; admin origin never sets the owner field |
| `findDeletionFacts` bad uuid | ✅ | Pass | T-6e: `'nope'` returns an error and records 0 queries |
| `findDeletionFacts` unparseable time | ✅ | Pass | T-6g: message is exactly `Unparseable timestamp: module job sent_at`; the value is not in the logs |
| `findDeletionFacts` missing fact is an error | ✅ | Pass (see EC-2) | T-6f: either read erroring makes the whole call an error, never partial facts, and `details` is kept out of the logs; an admin count of `null` is an error, not "no"; an embedded origin that is not owner is an error |
| Path, class, method and type unchanged | ✅ | Pass | T-6h (optional client, `RepositoryResult<DataExportDeletionFacts>`, exactly 3 keys); the barrel exports the class and the type only; DELETE's `deletion-check` and `test-account-cleanup/delete` route tests pass unedited in the full run (T-6i) |
| 20261135 guard refusals | ✅ | Pass (see EC-1) | T-7b pins all 7 refusals by their exact text plus an exact count of 7 `RAISE EXCEPTION`: table missing, 8-argument function missing, its body still names the table (exact `to_regprocedure`), another function in any schema names it (no `nspname` filter, start function exempt), queued or running rows, inbound FK from another table, start function not exactly `(uuid, uuid, text)` or a second overload. Negative controls: a guard scoped to `public` fails (2); the 6-argument signature fails (1); a DROP above the guard fails T-7a. T-7c: CASCADE, IF EXISTS and a swapped order each fail. Read by hand: the guard runs before `LOCK TABLE` and both DROPs, and the whole file is one transaction |
| The checkers can FAIL | ✅ | Pass (static; live proof is §8.2 step 6) | T-7d/T-7f: each script is one read-only `SELECT` with an ok / FAIL column and numbered rows with a stated count (10 / 8 / 4). The S-6 negative controls fail (an "into" alias, a SET, a second statement, a skipped row number, a wrong count, a planted DELETE CTE). Rows read by hand against the live state of §15: **20261134 checker** before the paste: rows 1 to 4 ok, rows 5 (new stamp absent), 6 (`5c369aaf2fa78abf` present), 7 (body names the table) and 8 (md5) FAIL. **20261135 checker** at step 6: rows 1, 2, 3 and 4 FAIL; at step 11: rows 1, 2 and 4 FAIL (row 4 because the start function still names the table, LC-5), row 3 ok; after 20261135 all 4 ok. This matches the CR-M1 headers and their pins (test l.302–314), which pass |
| Regeneration drift pins | ✅ | Pass | `testAccountCleanupSql.test.ts`: the 20261130 pair moved to `APPLIED` with unchanged sha256; `APPLIED_TARGET` holds the 20261134 pair; previous is 20261130; the new 20261134 block (8 tests) pins the chain, the new stamp `9a097ff36229f6b5`, check/delete/migration with no table or bucket name (non-vacuous against 20261130), the three remaining buckets, no `FUNCTION_REQUIRED_TABLES` entry and no order guard, "changes nothing else" (130 body minus the rows equals 134 body), the S-5 rollback header, and the checker md5 derived from the committed body. The l.1057 flip passes. `no-deletion-paths` and credit-lots allow-lists pass |
| Table and start function gone | ⚠️ | Pass for the code; live part owed | T-7 pins the DROP. The live proof is the step 11 checker |
| Cleanup function passes drift test and checker | ⚠️ | Pass for the drift test; live part owed | The checker is owed at §8.2 step 8 |
| Bucket and its descriptor gone | ✅ | Pass for the code | `descriptors.ts` and `businessOwnedTables.ts` keep only comments naming them. `STORAGE_DESCRIPTORS` holds 3 buckets. Bucket delete owed at step 12 |
| ZIP methods, storage repository, `jobPolicy.ts` and its mirror test removed | ✅ | Pass | The three files are absent; `git grep` finds no importer of `jobPolicy`, the storage repository, the singleton or `DATA_EXPORT_JOB_*`; no app/components/hooks code names the table, the function or the bucket (only comments in lib, and `events.ts` l.122, which is not opened by design) |
| Stale descriptor strings D-1 to D-3 | ✅ | Pass | The T-8 pins (`OWNER_ID_REASON`, bucket test renamed with an empty include list, 167 = 38 + 0 + 129) pass in the full run |
| "Not edited" list (§5) | ✅ | Pass | `git status` shows no change to `lib/audit/events.ts`, `eventAudience.ts`, `receiptInput.ts`, DELETE's routes, `vercel.json`, applied migrations or the PROD-2 baseline files |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. One more text-test file in the existing Jest job.

#### Edge Cases (nice to fix)

1. **EC-1: guard refusals (3) to (5), "table missing" and "8-argument function missing" have positive pins but no planted negative control.** T-7 says "each with a negative control", and only (1), (2) and the DROP order have one. Risk is low: each detector is an exact-text `includes`, so removing a refusal makes it fail, and the exact count of 7 catches a deleted one. File: `supabase/migrations/__tests__/business-os-data-exports-drop.migration.test.ts`. Severity: Low
2. **EC-2: the `moduleSent.data === null` branch ("No module export fact returned") is not exercised.** The fake client cannot make `findLatestOwnerSentAt` return `{ data: null, error: null }`. The admin-side missing fact is covered. File: `lib/repositories/__tests__/BusinessOsDataExportJobRepository.test.ts`. Severity: Low
3. **EC-3 (carried, not QA's to fix):** SA's non-blocking suggestions are still open. They are the in-flight read before `LOCK TABLE` (theoretical), the two blank lines left where MT-11 was, the plan's Last Updated date and its §4.10 cell, the order of the DE-10b Change History rows, and the `closureLifecycle.ts:16` comment for the DELETE notice. The coordinator still owes Tasks 1b, 10 and 10b, and D-5 and D-7, before the PR opens

### Test Outputs / Logs

```text
branch  suites 2138 failedSuites 31 tests 52551 failedTests 150
main    suites 2139 failedSuites 31 tests 52579 failedTests 150
BRANCH ONLY (suite): none
EXTRA FAILED TESTS in shared suites: none
NEW ON BRANCH   supabase/migrations/__tests__/business-os-data-exports-drop.migration.test.ts  passed
GONE ON BRANCH  lib/repositories/__tests__/BusinessOsDataExportStorageRepository.test.ts
GONE ON BRANCH  lib/business-os/data-export/__tests__/jobPolicy.test.ts
bookingNextStep.test.ts               branch = main = the same 2 failing tests
LanguageContext.initialLanguage.render  branch = main = the same 1 failing test (timezone T-1)
```

### Final Status
- [x] All acceptance criteria that can be tested in code pass. Ready for the user's diff view, and RM once the user approves. The live criteria (both checkers, the DROP, the bucket delete) are §8.2 gates
- [ ] Issues found — Dev must address before commit (none blocking; EC-1 and EC-2 are optional)

**Verdict: Pass with notes.** No bugs. V-2 has no regression, and the two Windows-local failures are pre-existing on `main`.

---

## Commit Info

(RM)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-25 | Workplan created (Dev, EXPORT session) | E10 / MX-7 on `feature/bos-export-mx7-drop-old-table` (off `aa4c1310`). Evidence E-1…E-32 read on the branch: only `findDeletionFacts` of the old job repository is still called (two DELETE routes); the storage repository, `jobPolicy.ts` and `toCsv` have no production caller; the table and bucket enter the cleanup plan through the purge descriptors; the schema reconciler blocks admin deletes on either side of the DROP, inside the same window as the version stamp; 20261130 shipped without a pre-check or checker and may need its live stamp proved. Design: 20261134 regenerated on 20261130, 20261135 hand-written DROP with a name-based SR-6 guard, both pasted in one sitting, PR enqueued at once, bucket deleted in the dashboard after the deploy. The three stale descriptor strings located (D-1…D-3). SA-Q1…SA-Q16; user questions BQ-E10-1…BQ-E10-5; live checks LC-1…LC-10 |
| 2026-11-25 | SA workplan review: approved with conditions | Rulings on SA-Q1 to SA-Q16. Must-fix: M-1 paste 20261135 after the deploy is Ready (same window, no data dropped while the merge is pending; amends plan §4.10 order), M-2 the PROD-2 baseline files go to DevOps (three places, incl. before-schema.sql and the parity test negative control), M-3 name the target project by role and check PROD-2 first. Should-fix S-1 to S-9 (bucket-count pin l.337, rollback compared statement by statement with 20261074, `toCsvText` into the test, extra claims, checker FAIL proof before each paste). T-13 declined (no CI time). LC-1 to LC-9 and the SR-5 privilege row recorded in §15; E-4 settled. User questions cut to BQ-E10-2 and BQ-E10-3 |
| 2026-11-25 | SA conditions folded in (Dev) | M-1: new one-sitting order, 20261135 pasted only after the deploy is Ready (Overview, §4.1, §4.2 `ROLLBACK_CONSEQUENCE`, §4.3, §4.4, §4.8, §8.2, §10 interface notice, §11, §12 R-7); plan §4.10 Change History row added. M-2: the PROD-2 baseline files are out of this PR, DevOps hand-off as Task 10b (E-25, §5, §10, R-9). M-3: §8.2 step 2 (f), the project(s) named by PROD-2's role names, R-11. S-1…S-9 folded into §4, §6, §7, §10 (the S-4 claim list in CC-3) and Environment changes (S-9). E-15 and E-16 corrected (S-7). §13 marked ruled. BQ-E10-1, -4, -5 settled by SA; BQ-E10-2, -3 open for the user |
| 2026-11-25 | SA re-check of the folded conditions: M-1, M-2, M-3 cleared for Task 2 | Re-read §4.1, §4.3, §4.4, §5, §6 Tasks 1b and 10b, §8.2, §10 CC-3 and the DevOps hand-off, R-7, R-9, R-11; S-1 to S-9 spot-checked and present. One stale line, non-blocking: R-5 still says "backup is confirmed first (LC-10); BQ-E10-1" and should read "latest backup time recorded (LC-10), not a blocker; SA-Q2" (fix during Task 8). Task 1b claims must be logged before Task 2 starts |
| 2026-11-26 | BQ-E10-2 answered | The user accepted that the 3 old-ZIP-only accounts will read "no export on record" on a future receipt. Task 2 may start |
| 2026-11-26 | Tasks 2 to 9 code complete (Dev) | Descriptors, ownership and counts (167 = 38 + 0 + 129); generator constants and the regeneration (stamp `9a097ff36229f6b5`); drift test, allow-lists, `APPLIED_TARGET` pinned last; 20261135, its rollback from the 20261074 text, the pre-check and the two checkers, `.gitattributes`, the T-7 text test; `findDeletionFacts` on the new tables only; the ZIP code removed; docs. Implementation Notes N-1 to N-5 (deviations D-1 to D-8; V-2 not run; the coordination-file line left to the coordinator). R-5 reworded as SA asked |
| 2026-11-26 | SA code review: approved with fixes | Deviations D-1 to D-8 ruled (D-1 to D-4, D-6, D-8 accepted; D-5 and D-7 owed by the coordinator before the PR opens). Must-fix CR-M1: the two checker headers (and their test pins) under-state which rows read FAIL before the paste (row 6 of the 20261134 checker; row 3 of the 20261135 checker at the step-6 run). `findDeletionFacts` frozen and on the new tables only; regeneration as `8bab24ca`; 20261135 and its rollback as approved; V-1 subset re-run by SA (101 suites pass), tsc clean on touched files. Six non-blocking suggestions; V-2 still owed by QA |
