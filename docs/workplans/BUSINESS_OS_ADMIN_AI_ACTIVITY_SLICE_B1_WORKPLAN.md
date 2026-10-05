# Workplan: Admin AI Activity — Slice B1 (the Activity tab list) with B0′ (charge-table indexes)

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md) — Gap B, slices **B0′** and **B1** (re-plan 2026-10-02)
**SA rulings this plan implements:** SA-R1 to SA-R13 and SA-RC-1 to SA-RC-17 (requirement § SA Re-plan Review and § SA Re-plan Re-check). The superseded B0 workplan is **not** used as a design; only its verification log was read as background.
**Date:** 2026-10-02
**Branch:** B1a: **`feature/admin-ai-activity-b1a`** (cut by RM from `origin/main` `03b62c3c`; confirmed by Dev with `git branch --show-current`, worktree `neuronforge-ai-activity`). B1b: **`feature/admin-ai-activity-b1b`** (cut by RM from `origin/main` `8c8b5d08`, which contains merged B1a, PR #195; confirmed by Dev, same worktree).
**Status:** B1a merged (PR #195). B0′ applied on production 2026-10-04 and verified. **B1b committed (2026-10-04) after SA code review APPROVED and QA PASS WITH NOTES; PR open to `main`, not merged.**

## Overview

Gap B gives platform admins one row per Business OS AI action, with what it was, whether it worked and what it cost. The re-plan moved the backbone from `token_usage` to the credit ledger: `business_os_credit_charges` already holds one `kind = 'charge'` row per `runAiAction` invocation (F-19), so the list is a filtered, sorted, capped read of that table. Nothing is grouped and no SQL function is added.

This workplan covers two things that ship together:

- **B0′**: one hand-applied migration that adds two indexes to the charge table and no function (FR-B11, SA-RC-1, D-7).
- **B1**: the **Activity** tab on `/admin/business-os-llm`. It lists charge rows with the FR-B1 columns, the FR-B3 filters (six presets plus an explicit range), a server-side 100-row cap with an honest filtered count (FR-B10), adjustments netted in (FR-B12), the audit entry attached by `actionId` and account (SA-RC-12), the "no audit entry" classes (FR-B5 question 1), the "account deleted" bucket (FR-B8) and the cut-over line (FR-B13).

B1 is about five days of work. This plan therefore proposes **splitting it into B1a and B1b** along the one seam in the design: B1a reads only the credit ledger, and B1b adds the audit-trail join. Both ship alone. The reasoning is in [Proposed Split](#proposed-split-b1a-and-b1b).

The view is **read-only**. It writes nothing, makes no LLM call and writes no audit entry (FR-B7, NFR-3).

---

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Proposed Split: B1a and B1b](#proposed-split-b1a-and-b1b)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
  - [A. B0′ — the index migration](#a-b0--the-index-migration)
  - [B. The ledger read repository](#b-the-ledger-read-repository)
  - [C. The audit-trail repository (B1b)](#c-the-audit-trail-repository-b1b)
  - [D. The view builder](#d-the-view-builder)
  - [E. The route and its Zod schema](#e-the-route-and-its-zod-schema)
  - [F. The Activity tab](#f-the-activity-tab)
  - [G. Guards that must be extended](#g-guards-that-must-be-extended)
  - [H. The console.* audit](#h-the-console-audit)
- [Files to Create / Modify](#files-to-create--modify)
- [Task List](#task-list)
- [Test Plan](#test-plan)
- [Verification Plan](#verification-plan)
- [Risks](#risks)
- [Non-Goals](#non-goals)
- [Open Questions for SA](#open-questions-for-sa)
- [Implementation Notes (B1a)](#implementation-notes-b1a)
- [Implementation Notes (B1b)](#implementation-notes-b1b)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

Every claim this plan depends on was re-read in the tree on 2026-10-02 (`main` at `03b62c3c`). Live-database facts are taken from the requirement (F-21, F-24) and not re-measured. **Three findings contradict or extend the requirement, and two of them change the plan** (V-6, V-14).

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| V-1 | The charge table's repo indexes are PK `(id)`, UNIQUE `(action_id)`, `(user_id, period_start, created_at DESC)` and `(group_id)` | Holds, and **live matches the repo exactly** (F-24, check 2, 2026-10-02) | `supabase/migrations/20261015_business_os_credit_charges.sql:23`, `:26`, `:52`, `:54` |
| V-2 | `user_id` is `ON DELETE SET NULL`; `adjusts_action_id` is a FK onto `action_id` with no index | Holds | `20261015:28`, `:30`; nothing indexes `adjusts_action_id` |
| V-3 | `20261016` is reserved for slice 4c's adjustment function and does not exist; the newest migration is `20261024` | Holds | `ls supabase/migrations`; requirement F-24 |
| V-4 | Migration conventions: `BEGIN` + `SET LOCAL lock_timeout`, rollback under `supabase/SQL Scripts/<name>_rollback.sql`, read-only checker under `scripts/check-*-migration.sql`, SQL-text test under `supabase/migrations/__tests__/` | Holds | `20261015:1-3`; `supabase/migrations/__tests__/business-os-credit-charges.migration.test.ts:24-30` (paths of the migration, rollback, checker and probe) |
| V-5 | `BusinessOsCreditLedgerReadRepository` is read-only, service role, account-scoped by signature, with one named cross-account read; `pageTotals` is the one-builder-two-methods precedent | Holds | `lib/repositories/BusinessOsCreditLedgerReadRepository.ts:17-36` (header), `:43-47` (never `service`), `:128-130` (columns), `:216` (`listTotalsForPeriodsInRange`), `:236` (account twin), `:258-292` (`pageTotals`), `:422` (`findChargesByActionIds`) |
| V-6 | **"No importer guard exists on the read repository"** (F-25, NFR-4.5, SA-RC-2) | **Does not hold.** The repository's own test file carries an **exact-equality importer list**: "is imported only by the report builder, the leak check (slice 4b), the barrel and tests". Any new file that names the repository fails it unless the list is extended in the same commit. SA looked for a separate guard file; the guard lives inside the unit test. `creditLeakCheckDeps.ts:9` also names "the ledger read repository's importer guard" | `lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts:437-462` |
| V-7 | The write-verb pin and the `created_at` exclusive-bound pin exist | Holds | same test file `:409-422` (write verbs), `:432-435` (no `.lte('created_at')`) |
| V-8 | The service-column guard scans only `lib/business-os/credits/**` and the two read repositories | Holds; the file list is at **`:64`** (requirement cites `:62`, which is the last rule) | `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts:19-24`, `:64`, `:67-77` |
| V-9 | `typecheck:bos-llm` scopes `lib/business-os/credits/` as core and adds every direct importer | Holds. It is a CI workflow but **not a required check** | `scripts/typecheck-bos-llm.ts:102-111` (`SCOPED_DIRS`), `:150-160` (direct callers); `.github/workflows/bos-llm-typecheck.yml:2-6` |
| V-10 | The page's source guard walks every file under `app/admin/business-os-llm/` and refuses any `@/lib/` import except `ledgerCheckCopy`, any provider-name literal and any `console.*` | Holds. Payload types must be re-declared client-side and pinned (`costTypes.ts` precedent) | `app/admin/business-os-llm/__tests__/source.guard.test.ts:39-55`, `:100-118`, `:131-133`, `:156-173`; `app/admin/business-os-llm/costTypes.ts:1-12`; `lib/business-os/credits/__tests__/creditReport.wireTypes.test.ts` |
| V-11 | The page has two tabs held in `useState`, Costs lazily mounted and then kept mounted | Holds. The tab is **not** URL-addressable today | `app/admin/business-os-llm/page.tsx:53-61` (tabs), `:68-75` (state), `:161-163` (costs panel) |
| V-12 | `AuditTrailRepository` has two admin exceptions, its header pins that AI entries are excluded from `listOwnerEntries` in the query, and admin methods are pinned to `app/api/admin/**` callers | Holds | `lib/repositories/AuditTrailRepository.ts:14-34` (header), `:83-89` (`AdminAuditReadContext`), `:134-178` (`listOwnerEntries`); `lib/repositories/__tests__/adminReadMethods.guard.test.ts:271-278` (`ADMIN_METHODS`), `:290-312` (callers only under `app/api/admin/`) |
| V-13 | `audit_trail` has `idx_audit_trail_entity_id (entity_id)` live, and `entity_id` is `TEXT` | Holds (F-24, check 3) | `supabase/SQL Scripts/create_audit_trail.sql:15`, `:42` |
| V-14 | The audit join can use the charge's `group_id` string as-is against `entity_id` | **Does not fully hold.** `isUuid` is case-insensitive and chat-v4 takes the turn id from the client's `x-correlation-id` unchanged. An upper-case header becomes an upper-case `entity_id` (text), while the charge's `group_id` (`uuid`) reads back lower-case. A plain `IN (lower-case ids)` would miss that entry and mark the charge "entry lost" | `lib/business-os/llm/callCatalog.ts:223-226` (`/…/i`); `app/api/business-os/chat-v4/route.ts:391-392` |
| V-15 | An audit entry's `created_at` is set when it is **queued**, not when the batch flushes | Holds. So an entry's `created_at` is at or just before its charge's `created_at`, and a time bound around the charges is safe | `lib/services/AuditTrailService.ts:175`; batch defaults `:71-72` |
| V-16 | `ArchiveRepository.getLatestCutoff` (succeeded runs only) and `listRuns` exist; no importer guard | Holds. `getLatestCutoff`'s doc already names "the Gap B view" as a reader | `lib/repositories/ArchiveRepository.ts:201-218`, `:220-236`; `ARCHIVE_RUN_COLUMNS` `:77-78` (includes `rows_archived`) |
| V-17 | The credit report route is the prior art for an admin ledger route: `requireAdmin` first, strict Zod, repeated keys refused, platform account 409, admin-only reads injected from the route | Holds. **Its maximum window is already 92 days** (`CREDIT_REPORT_LIMITS.MAX_WINDOW_DAYS`) | `app/api/admin/business-os/credits/report/route.ts:56-89`, `:97-98`, `:104-108`, `:125-127`, `:134-138`; `lib/business-os/credits/creditReport.ts:70-82` |
| V-18 | Area per action type and the effective-field resolver exist and are reusable | Holds | `lib/business-os/credits/effectiveFields.ts:59-63` (`areaFor`), `:81-94` (`resolveEffectiveFields`, refuses a cross-account adjustment); `lib/business-os/llm/aiActionAudit.ts:114-189` (`AI_ACTION_DECLARATIONS`) |
| V-19 | `AiAuditDetails` is a closed shape carrying `actionId` (schema 2), calls, tokens, models, outcome and an error code | Holds | `lib/business-os/llm/aiActionAudit.ts:237-268`; the projection precedent is `app/api/admin/business-os/accounts/[accountId]/summary/route.ts:87-100` |
| V-20 | An admin business picker exists and is reusable | Holds: `BusinessAccountPicker` over `GET /api/admin/business-os/llm-usage/businesses`. **It imports `@/lib/logger`** | `app/admin/audit-trail/BusinessAccountPicker.tsx:44-49`, `:73-77`, `:103` |
| V-21 | Admin pages read query params through `useSearchParams` inside a `Suspense` boundary | Holds | `app/admin/audit-trail/page.tsx:251-256`, `:263`; `app/admin/analytics/page.tsx:209-220` |
| V-22 | The cut-over link targets accept URL filters | Holds: the Audit Trail reads `entity_type`, `date_to`, `user_id`; Analytics reads `scope` and `user` | `app/admin/audit-trail/page.tsx:112-123`; `app/admin/analytics/page.tsx:220-248` |
| V-23 | Adding a new admin route gated by `requireAdmin` needs no change to the authz guard's caps | Holds: caps count parked and permanent exemptions only | `lib/admin/__tests__/admin-authz-surface.guard.test.ts:402-410` |
| V-24 | Cut-over instant and volumes | Taken from F-21: first charge `2026-09-29T16:50:53.914167Z`; 82 charge rows, 0 adjustments, 0 NULL `user_id`, 0 fallback-priced | Requirement F-21 |

---

## Scope

### In scope for B1 (B1a and B1b together)

| Item | Requirement | Slice |
|---|---|---|
| B0′ migration: a partial `created_at` index and a partial `adjusts_action_id` index, no function; rollback, checker, SQL-text test; hand-applied on production before B1 is verified | FR-B11, SA-RC-1, D-7, AC-B16 | **B1a** |
| Two named list methods over one private builder; an adjustment lookup by action id; a deleted-account read | FR-B11, FR-B12, FR-B8, NFR-4.5 | **B1a** |
| The view builder: window and cut-over clamp, area to action types, netting, names, the honest count, the deleted-account bucket | FR-B1, FR-B3, FR-B10, FR-B12, FR-B13, FR-B8 | **B1a** |
| `GET /api/admin/business-os/ai-activity` with strict Zod (required window, maximum 92 days, limit 1 to 100) | NFR-1, NFR-10, AC-B14 | **B1a** |
| The Activity tab: presets, explicit range, filters, sort, table, count line, cut-over line, fallback-priced and corrected markers, deleted-account bucket; `?tab=` addressable | FR-B1, FR-B3, FR-B10, FR-B13, SA-RC-13 | **B1a** |
| A named cross-account `AuditTrailRepository` method; the server-side `actionId` + account match; the entry columns (calls, failed calls, tokens, models, error code) | FR-B1, SA-RC-12, NFR-4.4 | **B1b** |
| "No audit entry" with **too recent / entry may be archived / entry lost**, plus "unknown" when the audit read failed or was cut | FR-B5 question 1, SA-RC-7, SA-RC-8 | **B1b** |

### Explicitly out of scope (later slices)

| Item | Goes to | Why not here |
|---|---|---|
| Drill-down by action id, group charges, `token_usage` calls, the shared-group marker, the group-level cost check | **B2** | Needs the new account-scoped `TokenUsageRepository` method and `EXPECTED_ARITY` (NFR-4.1, NFR-4.3). B1 touches neither |
| The charge-vs-entry cost mismatch marker (FR-B6 item 1) | **B3** | Slicing table puts it in B3. B1b attaches the entry but does not carry `estimatedCostUsd` |
| The fallback marker's **direction** against `token_usage` | **B2/B3** | Needs a `token_usage` read; the list never reads it (SA-RC-4). B1a shows "Priced from a fallback rate" without a direction |
| "Audited, not charged" reverse pass (FR-B9) | **B3** | |
| "AI spend with no charge", ungrouped and platform-account figures from the leak-check route (FR-B5 question 2, FR-B8 first two bullets) | **B3** | |
| The Audit Trail deep link and landing on `?actionId=` (FR-B4); the help text naming chat-v2 and the leak check's blind spots (AC-B21) | **B3** | B1a makes the tab URL-addressable (`?tab=activity`), which is the half B3 needs; the inbound link and the row landing ship together in B3 so they are tested together |
| Pre-cut-over history | **Never** (D-8) | |
| Any write, adjustment, export, alert | **Never** in this requirement (FR-B7, D-5) | |

---

## Proposed Split: B1a and B1b

**Recommendation: split.** B1 as specified is about five working days. The user's standing preference is numbered slices of a few days each, each shipping alone, reusing infrastructure.

| Slice | Content | Estimate | Ships alone? | Depends on |
|---|---|---|---|---|
| **B1a — the ledger list** | B0′; the four ledger repository methods; the builder (window, cut-over, area, netting, names, count, deleted bucket); the route; the Activity tab with every charge-row column, filter, sort, cap, count, cut-over line and the fallback-priced / corrected markers | ~3 days | **Yes.** It answers "what ran, for whom, did it succeed, what did it cost" from the bill alone. Action type, trigger and outcome are on the charge row, so the row is useful without the entry | B0′ applied before verification |
| **B1b — the audit join** | The `AuditTrailRepository` named method with its header amendment and caller pin; the case-variant `IN`; the server-side match; entry columns; the four "no audit entry" states; the archive cutoff | ~2 days | **Yes.** Adds columns and markers to an existing table | B1a merged |

**Why this seam.** It is the only place where the design changes data source. B1a reads one table through one repository and touches no audit code, so its review is about the ledger, the index and the cap. B1b brings in `audit_trail`, `ArchiveRepository`, the cross-tenant discard rule and the admin-method caller pin, which is where AC-B5's "never serialised" property lives. Reviewing those separately keeps each review focused on one risk.

**What B1a shows where B1b will add entry fields.** The calls, tokens, models and error-code columns are simply absent in B1a; they are not rendered as blanks. FR-B1 asks that a missing entry never reads as "none". An absent column cannot be misread that way, but a blank cell could.

If SA prefers one slice, the task list below runs straight through: T1 to T9 are B1a and T10 to T15 are B1b.

---

## Analysis Summary

| Area | What this touches |
|---|---|
| **Tables read** | `business_os_credit_charges` (charges and adjustments); `business_profiles` (company name, through the existing admin identity read); `audit_trail` (B1b); `archive_runs` (B1b). **Not** `token_usage` (SA-RC-4), **not** `business_os_credit_totals` |
| **Schema change** | B0′: two `CREATE INDEX` statements, no function, no grant change |
| **Repositories** | `BusinessOsCreditLedgerReadRepository` gains four read methods. `AuditTrailRepository` gains one named cross-account method (B1b). `BusinessProfileRepository.findAdminIdentitiesByUserIds` and `ArchiveRepository.getLatestCutoff` / `listRuns` are reused unchanged |
| **Server modules** | New `lib/business-os/credits/aiActivity.ts` (builder), `aiActivityTypes.ts` (wire types), `aiActivityDeps.ts` (non-admin wiring). They live under `lib/business-os/credits/` on purpose: that directory is in `typecheck:bos-llm`'s scope (V-9) and in the service-column guard's scan (V-8), so both checks cover the new code with no configuration change |
| **Route** | New `app/api/admin/business-os/ai-activity/route.ts`: `GET`, `requireAdmin` first, strict Zod |
| **UI** | New `app/admin/business-os-llm/components/activity/` folder; client mirrors `activityTypes.ts`, `activityCopy.ts`, `activityPresets.ts`; `page.tsx` gains a third tab and reads `?tab=` |
| **Providers / LLM** | None |
| **Entitlements** | Nothing imports from `lib/business-os/entitlements/` directly. `aiActionAudit.ts` imports a type from there, but it is already reached by `effectiveFields.ts` today. The `business-os-entitlements` skill does not apply; `npm run test:bos-entitlements` is run once anyway as confirmation |
| **Audit writes** | None. The view is read-only, so `AuditTrail.log()` queueing and writer-severity rules do not arise |

---

## Implementation Approach

### A. B0′ — the index migration

**Live state (F-24, check 2, recorded 2026-10-02):** production `business_os_credit_charges` has exactly the repo's four indexes — `business_os_credit_charges_pkey (id)`, `business_os_credit_charges_action_id_key UNIQUE (action_id)`, `business_os_credit_charges_user_period_idx (user_id, period_start, created_at DESC)`, `business_os_credit_charges_group_idx (group_id)`. None leads with `created_at`; none is on `adjusts_action_id`. There is no production-only index to reconcile, so B0′ stands as ruled.

**Planned file:** `supabase/migrations/20261026_business_os_credit_charges_activity_indexes.sql`. The date skips `20261016`, which slice 4c has reserved (V-3).

**Planned content (the plan, not the file):**

```sql
BEGIN;

-- Shorter than the charge writer's 1.5 s budget (aiChargeRecorder.ts:52): a
-- CREATE INDEX that has to queue would hold every charge INSERT behind it.
SET LOCAL lock_timeout = '1s';

-- (a) The cross-account window, the time order with its id tie-break, and the
-- exact count. kind LEADS and the index is NOT partial (SA-B1-1): usable under
-- a generic plan whatever value PostgREST binds for kind.
CREATE INDEX IF NOT EXISTS business_os_credit_charges_kind_created_idx
  ON public.business_os_credit_charges (kind, created_at DESC, id DESC);

-- (b) FR-B12's per-page adjustment lookup. Charge rows always carry NULL here.
CREATE INDEX IF NOT EXISTS business_os_credit_charges_adjusts_action_idx
  ON public.business_os_credit_charges (adjusts_action_id)
  WHERE adjusts_action_id IS NOT NULL;

COMMIT;
```

**Shape decisions:**

| Decision | Reason |
|---|---|
| `(kind, created_at DESC, id DESC)`, **not partial** (SA-B1-1, applied) | The equality on `kind`, the `created_at` range and `ORDER BY created_at DESC, id DESC` (FR-B11's tie-break) are all served, so the time sort is an ordered index scan with a `LIMIT` and no sort node. A partial `WHERE kind = 'charge'` index could not be used by a cached generic plan whose `kind` is a bound parameter. Renamed `…_kind_created_idx` because it is no longer charge-only |
| ~~Partial `WHERE kind = 'charge'`~~ | **Superseded by SA-B1-1.** Adjustment rows add negligible size to index (a) |
| No `cost_usd` index | SA ruled one `created_at` index. The cost sort is a top-N sort over the window's rows, bounded by the 92-day span. See [R-3](#risks) |
| `user_id IS NOT NULL` not in the predicate | The deleted-account bucket reads `user_id IS NULL` through the same index |
| Plain `CREATE INDEX`, not `CONCURRENTLY` | Today's table has about 100 rows, so the build takes milliseconds. `CONCURRENTLY` cannot run inside a transaction block, and the SQL editor's batching makes that fragile. This repo has never used it (`grep CONCURRENTLY supabase/migrations` is empty) |
| `lock_timeout = '1s'` (20261015 used `5s`) | A queued `SHARE` lock request blocks every later `INSERT`. A 5 s wait could push charge writes past the recorder's 1.5 s budget and leave them with an unknown fate (F-20). A failed apply is simply re-run |
| `IF NOT EXISTS` | A re-run is safe. The checker verifies `indexdef`, so a same-named index with a different definition cannot pass unnoticed |

**Companion files:**

| File | Content |
|---|---|
| `supabase/SQL Scripts/20261026_business_os_credit_charges_activity_indexes_rollback.sql` | `BEGIN; SET LOCAL lock_timeout = '1s'; DROP INDEX IF EXISTS` × 2`; COMMIT;` (SA-B1-3: `DROP INDEX` takes `ACCESS EXCLUSIVE`). Dropping an index loses no data |
| `scripts/check-bos-credit-charges-activity-indexes.sql` | Read-only (SA-B1-2). **Section 1**: `SET default_transaction_read_only = on;` then ONE result set with a VERDICT row and a PASS/FAIL row per expected index comparing the exact `indexdef` (all six), plus "no other index", "both new indexes valid and ready", ledger size and the busiest account id, for block E6. Before the apply it reads FAIL with the two new rows "missing" — that is the "before" record (SA-B1-4). **Section 2**: E1–E6, each its own `BEGIN READ ONLY; SET LOCAL enable_seqscan = off; EXPLAIN (ANALYZE, BUFFERS) …; ROLLBACK;` block with literal values, labelled "run this block alone". **Section 3**: generic-plan blocks G1/G2/G4 (`PREPARE`, `SET LOCAL plan_cache_mode = force_generic_plan`, `EXPLAIN EXECUTE`, `DEALLOCATE`). **Section 4**: E1/E2 at default settings for today's latency |
| `supabase/migrations/__tests__/business-os-credit-charges-activity-indexes.migration.test.ts` | Pins: exactly two `CREATE INDEX IF NOT EXISTS`; index (a) is `(kind, created_at DESC, id DESC)` and **not** partial; index (b) is partial on `adjusts_action_id IS NOT NULL`; no `FUNCTION`, `GRANT`, `REVOKE`, `ALTER`, `DROP`, `CONCURRENTLY`, `TRIGGER`, `POLICY` or write; `lock_timeout` 1 s (below 1.5 s) in the migration **and** the rollback, set before the first statement; the filename is not `20261016*`; the rollback drops exactly both names; the checker is read-only, compares both exact `indexdef`s, has a single-result-set section 1 with a VERDICT, 11 self-contained blocks, and three `force_generic_plan` blocks |

**The six `EXPLAIN` queries (mirroring what PostgREST will send):**

| # | Query | Expected plan |
|---|---|---|
| E1 | All accounts, by time: `kind='charge' AND user_id IS NOT NULL AND created_at >= $1 AND created_at < $2 ORDER BY created_at DESC, id DESC LIMIT 100` | Index Scan on `…_kind_created_idx`, no Sort node (also under a generic plan, G1) |
| E2 | The exact count with E1's filters | Index (or Bitmap) Scan on `…_kind_created_idx` (also generic, G2) |
| E3 | All accounts, by cost: E1's filters `ORDER BY cost_usd DESC, id DESC LIMIT 100` | Index Scan on `…_kind_created_idx`, then a top-N heapsort. This sort is expected and documented |
| E4 | Adjustments: `kind='adjustment' AND adjusts_action_id = ANY($ids)` | Index or Bitmap Scan on `…_adjusts_action_idx` (also generic, G4) |
| E5 | Deleted-account bucket: `kind='charge' AND user_id IS NULL` plus the window | `…_kind_created_idx` with a filter on `user_id` |
| E6 | One account, by time: `user_id = $1` plus E1's other filters | `…_user_period_idx` (existing) or the new index; either is acceptable at per-account volume (about 116 rows a month, NFR-6) |

**Apply procedure (D-7, by the user, on production, before B1a is verified):**

1. Run **section 1** of `scripts/check-bos-credit-charges-activity-indexes.sql` alone and confirm the "before" state: the four existing indexes PASS, the two new ones FAIL ("missing"), "no other index" PASS (SA-B1-4). `scripts/check-admin-ai-activity-indexes.sql` (the F-24 record) is kept and ships with B1a, but the apply procedure no longer depends on it.
2. Apply at a quiet hour (charge writes are per AI action). Paste the migration into the Supabase SQL editor and run it. **Use a fresh query tab** (or run `RESET default_transaction_read_only;` first): the checker's section 1 sets the editor session read-only, and the migration run in that session fails harmlessly with "cannot execute CREATE INDEX in a read-only transaction".
3. If it fails with `lock_timeout`, nothing was created (the transaction rolled back). Re-run it.
4. Run the checker — section 1 alone, then each EXPLAIN block alone — and paste every output, labelled, into [§ Verification Plan, B0′ evidence](#b0-evidence-ac-b16).
5. **Rollback** if needed: run the rollback script. It is safe at any time; the view still works without the indexes, only slower at volume.

---

### B. The ledger read repository

All additions go into `lib/repositories/BusinessOsCreditLedgerReadRepository.ts`. Every method guards its input before querying, never throws, and selects only `CREDIT_LEDGER_ROW_COLUMNS`. None names a write verb and none filters on `service`. The created-at range is half-open, using `CreditPeriodStartRange` and `.lt` (the `:432-435` pin).

**Types (exported, re-exported from `lib/repositories/index.ts`):**

```typescript
export type ChargeListSort = 'created_at' | 'cost_usd';

export interface ChargeListFilter {
  /** Half-open on created_at: from <= created_at < to. */
  range: CreditPeriodStartRange;
  /** The area's action types, passed in as plain data. Non-empty when present. */
  actionTypes?: readonly string[];
  outcome?: 'succeeded' | 'failed';
  triggeredBy?: 'owner' | 'scheduled' | 'external';
  /** Gross charge cost, a decimal string (numeric(16,10) is never round-tripped through a float). */
  minCostUsd?: string;
}

export interface ChargeListOptions {
  sort: ChargeListSort;
  /** 1 to 100, asserted here and applied in the query (FR-B10). */
  limit: number;
}

export interface ChargeListPage {
  rows: CreditLedgerRow[];
  /** count: 'exact' on the identical filters. Not an aggregate (PGRST123 does not apply). */
  total: number;
}

export const CHARGE_LIST_LIMITS = { MAX_LIMIT: 100 } as const;
```

**Methods:**

```typescript
/** ALL accounts, deleted accounts excluded (they have their own bucket). Logged at info. */
async listChargesAllAccountsInWindow(
  filter: ChargeListFilter,
  opts: ChargeListOptions
): Promise<RepositoryResult<ChargeListPage>>;

/** ONE account. Refuses a non-UUID account before querying. Logged at debug. */
async listChargesForAccountInWindow(
  userId: string,
  filter: ChargeListFilter,
  opts: ChargeListOptions
): Promise<RepositoryResult<ChargeListPage>>;

/**
 * Adjustment rows pointing at these charges, written at ANY time (FR-B12),
 * at most MAX_IDS_PER_REQUEST ids per call. Like findChargesByActionIds, a
 * lookup by unique id is not an ownership proof: the caller checks each
 * adjustment's account against its charge's (resolveEffectiveFields does).
 */
async listAdjustmentsForActionIds(
  actionIds: readonly string[]
): Promise<RepositoryResult<CreditLedgerPagedResult<CreditLedgerRow>>>;

/**
 * Charges whose account was deleted (user_id IS NULL), with the same filters,
 * paged to a ceiling, plus the exact count. Named for its purpose (SA-R12).
 * Logged at info.
 */
async listChargesOfDeletedAccountsInWindow(
  filter: ChargeListFilter,
  opts: CreditLedgerPageOptions
): Promise<RepositoryResult<CreditLedgerPagedResult<CreditLedgerRow> & { total: number }>>;
```

**One private builder.** This follows `pageTotals` (`:258-292`), where `null` is reachable only from the named all-accounts method:

```typescript
type ChargeScope =
  | { kind: 'account'; userId: string }
  | { kind: 'all_accounts' }          // reachable only from listChargesAllAccountsInWindow
  | { kind: 'deleted_accounts' };     // reachable only from listChargesOfDeletedAccountsInWindow

private chargeQuery(filter: ChargeListFilter, scope: ChargeScope) {
  let q = this.supabase
    .from('business_os_credit_charges')
    .select(CREDIT_LEDGER_ROW_COLUMNS, { count: 'exact' })
    .eq('kind', 'charge')
    .gte('created_at', filter.range.from.toISOString())
    .lt('created_at', filter.range.to.toISOString());
  if (scope.kind === 'account') q = q.eq('user_id', scope.userId);
  if (scope.kind === 'all_accounts') q = q.not('user_id', 'is', null);
  if (scope.kind === 'deleted_accounts') q = q.is('user_id', null);
  if (filter.actionTypes) q = q.in('action_type', [...filter.actionTypes]);
  if (filter.outcome) q = q.eq('outcome', filter.outcome);
  if (filter.triggeredBy) q = q.eq('triggered_by', filter.triggeredBy);
  if (filter.minCostUsd !== undefined) q = q.gte('cost_usd', filter.minCostUsd);
  return q;
}
```

The two list methods add `.order(sort, { ascending: false }).order('id', { ascending: false }).range(0, limit - 1)` and return `{ rows, total: count }`. A `null` count is an **error**, not 0, so the route sends no count rather than a wrong one (FR-B10).

**Guards added:** `assertChargeFilter` (range valid; `actionTypes`, if present, is non-empty, at most 64 entries, each matching the column's own format `^[a-z][a-z0-9_]{0,63}$`; `outcome` and `triggeredBy` in their CHECK sets (`20261015` `:38`, `:40`); `minCostUsd` matching `^\d{1,6}(\.\d{1,10})?$`); `assertListOptions` (`sort` in the union, `limit` an integer from 1 to 100). A failed guard returns `{ data: null, error }` and logs at `warn` through the existing `fail()` (`:198-205`).

**Header amendment (same commit, NFR-4.5).** `:29-36` currently says the one cross-account read is `listTotalsForPeriodsInRange`. It will name the **two** all-accounts reads (`listTotalsForPeriodsInRange`, `listChargesAllAccountsInWindow`), the no-account read (`listChargesOfDeletedAccountsInWindow`), and the two by-unique-id lookups (`findChargesByActionIds`, `listAdjustmentsForActionIds`, where the caller checks the account). The "SERVICE ROLE" callers paragraph (`:18-27`) gains the Activity view.

---

### C. The audit-trail repository (B1b)

**New method on `lib/repositories/AuditTrailRepository.ts`:**

```typescript
/** The only columns the admin AI-entry join selects. No hash, no user_email, no ip, no user agent. */
export const ADMIN_AI_ACTION_ENTRY_COLUMNS = 'id, user_id, created_at, entity_id, details';

export const ADMIN_AI_ENTRY_LIMITS = {
  /** Distinct group ids per call, BEFORE case variants are added (so at most 200 in the IN). */
  MAX_GROUP_IDS: 100,
  /** Rows per call. PostgREST's default max-rows. */
  MAX_ROWS: 1000,
} as const;

export interface AdminAiActionEntryRow {
  id: string;
  user_id: string | null;
  created_at: string;
  entity_id: string | null;
  /** AiAuditDetails as stored. Projected to an allow-list by the caller. */
  details: unknown;
}

/**
 * ADMIN ONLY, ALL ACCOUNTS. Business OS AI action entries whose grouping id is
 * one of `groupIds`, in [window.start, window.end). Filtered by ENTITY TYPE and
 * the two AI ACTIONS, never by severity (SA-RC-12). The caller matches each
 * entry to its charge on details.actionId AND user_id, and discards the rest.
 */
async listAiActionEntriesAllAccountsByGroupIds(
  context: AdminAuditReadContext,
  groupIds: readonly string[],
  window: { start: string; end: string }
): Promise<RepositoryResult<{ rows: AdminAiActionEntryRow[]; reachedLimit: boolean }>>;
```

**Query:** `.from('audit_trail').select(ADMIN_AI_ACTION_ENTRY_COLUMNS).eq('entity_type', AI_ACTION_ENTITY_TYPE).in('action', [AUDIT_EVENTS.BUSINESS_AI_ACTION_COMPLETED, AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED]).in('entity_id', variants).gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }).limit(MAX_ROWS)`.

- **`variants`** is each group id in lower case **and** in upper case, de-duplicated (V-14). That covers a client header sent in either canonical case. A mixed-case header is not covered; see [R-6](#risks).
- **The window** is `[earliest charge − SLACK_MS, latest charge + SLACK_MS)`, reusing `LEAK_CHECK_LIMITS.SLACK_MS` (one hour). Entries are stamped when queued (V-15), so they sit at or just before their charge. The bound stops a client that reuses one turn id indefinitely from making the read unbounded.
- `reachedLimit` is `rows.length >= MAX_ROWS`, the same `>=` rule the ledger repository uses (`:119-124`).
- Guards: a valid context (as `countAdminEventsAllAccountsInWindow` does, `:219-221`); 1 to 100 UUID group ids; a valid window. The method logs at `info` with the context, the group-id count and the row count, because it is a cross-tenant read.

**Header amendment (same commit, NFR-4.4).** A third exception paragraph names this method, its only caller (the Activity route), and states that it returns **only** AI entries, while `listOwnerEntries` still excludes them in the query. The closing paragraph (`:32-34`) is reworded so it is still literally true: AI entries are excluded from the **owner** read.

**Caller pin.** `listAiActionEntriesAllAccountsByGroupIds` is added to `ADMIN_METHODS` in `lib/repositories/__tests__/adminReadMethods.guard.test.ts:271-278`. It may therefore be called only under `app/api/admin/**`, so the route injects it into the builder (the credit report route does the same with `findNames`, `report/route.ts:134-136`).

---

### D. The view builder

**`lib/business-os/credits/aiActivity.ts`** is server-only and pure apart from its injected dependencies. It follows `buildCreditReport` and `runCreditLeakCheck`.

**Constants:**

```typescript
export const AI_ACTIVITY_LIMITS = {
  /** Same as the cost report's window (CREDIT_REPORT_LIMITS.MAX_WINDOW_DAYS = 92). */
  MAX_WINDOW_DAYS: CREDIT_REPORT_LIMITS.MAX_WINDOW_DAYS,
  MAX_ROWS: CHARGE_LIST_LIMITS.MAX_LIMIT,             // 100
  DELETED_BUCKET_PAGE_SIZE: 1000,
  DELETED_BUCKET_CEILING: 2000,
  /** B1b: entries younger than this are "too recent", not lost. Minutes, NOT batchIntervalMs (SA re-check §4 Q4). */
  AUDIT_SETTLE_MS: 15 * 60_000,
  /** B1b: archive runs inspected for the highest cutoff that moved rows. */
  ARCHIVE_RUNS_INSPECTED: 100,
} as const;

/**
 * The first charge row, read once on production (F-21, SA-RC-9 check 1):
 * 2026-09-29T16:50:53.914167Z. A JS Date holds milliseconds, so the
 * comparison floor is TRUNCATED to .914 — below the real value, so the first
 * row is still inside any window clamped to it. Never round up.
 */
export const CHARGING_CUTOVER_ISO = '2026-09-29T16:50:53.914167Z';
export const CHARGING_CUTOVER_FLOOR_MS = Date.UTC(2026, 8, 29, 16, 50, 53, 914);
```

**Input:** `{ window: { from, to } (inclusive UTC dates), accountId | null, area | null, outcome | null, trigger | null, minCostUsd | null, sort: 'time' | 'cost', limit }`.

**Steps:**

1. **Window.** `windowInstants()` (reused from `creditReport.ts:126-130`) gives `[start, end)`.
   - If `end <= CHARGING_CUTOVER_FLOOR_MS`, nothing is read. The payload says `coverage: 'entirely_before_cutover'` (AC-B20).
   - Otherwise the query starts at `max(start, floor)`, and `coverage` is `'starts_before_cutover'` when `start < floor`, else `'after_cutover'`.
2. **Area.** The action types whose `areaFor('ai', type)` equals the area (`effectiveFields.ts:59-63`, reused so the list and the report agree). An area with no declared types returns an empty list without a query.
3. **The page.** `listChargesForAccountInWindow` when an account is chosen, otherwise `listChargesAllAccountsInWindow`. Sort `time` maps to `created_at`, `cost` to `cost_usd` (**gross**, SA-R8).
4. **Adjustments.** One `listAdjustmentsForActionIds` call for the page's action ids (at most 100, under the 200-per-request limit). Each adjustment goes through `resolveEffectiveFields` with the page's charges as the map. An adjustment it refuses (another account) is **not** netted; it is counted in `unresolvedAdjustments`, and no adjustment data is serialised. A read failure sets `adjustments: 'failed'` and marks every row `net: null`; a gross figure is never shown as net.
5. **Netting.** Integer units: cost × 1e10, credits × 1e6. This reuses `toUnits` and the two scales from `creditReport.ts:88-89`, `:135-138` (exported for the purpose; see [OQ-9](#open-questions-for-sa)). Each row carries `costUsd { gross, net }`, `credits { gross, net }`, `corrected` (at least one netted adjustment), `adjustmentCount` and `reasonCodes`. An unreadable amount counts in `unreadableAmounts`, as the report does.
6. **Names.** `findNames(distinct account ids)` is injected by the route. A failure sets `names: 'failed'` and `companyName: null`; the list itself does not fail.
7. **Deleted-account bucket (all-accounts mode only).** `listChargesOfDeletedAccountsInWindow` with the same filter, its adjustments chunked by 200, and a Node sum with netting. The result is `{ status, count, costUsd, credits, atLeast }`, where `atLeast` is the read ceiling being reached. The bucket is never merged into a row (FR-B8). In single-account mode it is `null`: a deleted account has no account id, so it cannot be selected.
8. **(B1b) The audit join.** See [§ C](#c-the-audit-trail-repository-b1b). The method is injected by the route as `listAuditEntries`. For each charge:

   | Situation | Row's `entry` |
   |---|---|
   | One entry with `details.actionId === charge.action_id` **and** `user_id === charge.user_id` | `{ state: 'found', callCount, failedCallCount, inputTokens, outputTokens, totalTokens, models, errorCode }`, projected field by field (summary route `:87-100` precedent). `models` holds at most 10 strings of at most 64 characters each; `errorCode` must match `sanitizeErrorCode`'s shape or is dropped |
   | An entry with the right `actionId` but **another** account | `{ state: 'account_mismatch' }`, a defect marker. Neither account's entry data is serialised (SA-RC-12) |
   | No matching entry, charge younger than `now − AUDIT_SETTLE_MS` | `{ state: 'too_recent' }` |
   | No matching entry, charge older than the archive cutoff | `{ state: 'may_be_archived' }` |
   | No matching entry otherwise | `{ state: 'lost' }` |
   | The audit read failed, was cut at `MAX_ROWS`, or the archive cutoff could not be read for a charge it would decide | `{ state: 'unknown', reason }`. Never "lost" on incomplete evidence |

   Entries with no `actionId` (schema 1), and entries matching no charge on the page, are dropped and never leave the builder.

   **The archive cutoff** is the highest of `getLatestCutoff('audit_trail')` (succeeded runs) and the highest `cutoff` among `listRuns({ limit: 100 })` rows with `source = 'audit_trail'` and `rows_archived > 0` (partial runs also move rows, SA-R7).

   **Counts** `noEntry: { tooRecent, mayBeArchived, lost, unknown, accountMismatch }` are computed **over the rows shown**, and labelled as such on screen. They are not a window-wide figure.
9. **The list never touches `token_usage`.** `AiActivityDeps` has no `token_usage` member, and a source test pins that `aiActivity.ts` and `aiActivityDeps.ts` do not name `TokenUsageRepository` (AC-B7, list half).

**Payload** (`lib/business-os/credits/aiActivityTypes.ts`; the client mirror is pinned by a wire-types test):

```typescript
export interface AiActivityPayload {
  generatedAt: string;
  window: { from: string; to: string; start: string; end: string };
  cutover: { at: string; coverage: 'after_cutover' | 'starts_before_cutover' | 'entirely_before_cutover' };
  filters: { accountId: string | null; area: string | null; outcome: string | null; trigger: string | null; minCostUsd: string | null };
  sort: 'time' | 'cost';
  limit: number;
  /** Areas that have at least one action type, for the area filter. Plain data (SA-R10). */
  areas: { area: string; actionTypes: string[] }[];
  rows: AiActivityRow[];
  /** Exact filtered count, or null when it could not be read (FR-B10: no count beats a wrong one). */
  total: number | null;
  capped: boolean;
  names: 'ok' | 'failed';
  adjustments: 'ok' | 'failed';
  unresolvedAdjustments: number;
  unreadableAmounts: number;
  deletedAccounts: AiActivityDeletedBucket | null;
  /** B1b. */
  audit?: { status: 'ok' | 'failed' | 'incomplete'; settleMinutes: number; archiveCutoff: string | null; archive: 'ok' | 'failed'; noEntry: AiActivityNoEntryCounts };
}

export interface AiActivityRow {
  actionId: string;
  createdAt: string;
  accountId: string;
  companyName: string | null;
  area: string | null;
  actionType: string;
  trigger: 'owner' | 'scheduled' | 'external';
  outcome: 'succeeded' | 'failed';
  groupId: string;
  costUsd: { gross: number; net: number | null };
  credits: { gross: number; net: number | null };
  isFallbackPriced: boolean;
  corrected: boolean;
  adjustmentCount: number;
  reasonCodes: string[];
  /** B1b. */
  entry?: AiActivityEntryState;
}
```

The row carries **no `service` field**. The effective service is `'ai'` for every row today, and the non-AI tripwire is recorded in [R-8](#risks).

**`lib/business-os/credits/aiActivityDeps.ts`** wires the non-admin reads only: the four ledger methods, and (B1b) the archive cutoff from `archiveRepository`. The two admin-pinned reads, `findAdminIdentitiesByUserIds` and `listAiActionEntriesAllAccountsByGroupIds`, are added by the route.

---

### E. The route and its Zod schema

**`app/api/admin/business-os/ai-activity/route.ts`**, `GET`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. It is a structural copy of the credit report route (V-17).

**Order:** `requireAdmin(baseLogger)` is the first statement (401 / 403). Then repeated keys are refused (400), then strict Zod (400), then the platform account is refused (409, pure, no read), then the reads. Nothing from the request reaches the database except validated values.

```typescript
const DATE = z.string().refine((v) => dateMs(v) !== null, 'must be a date, YYYY-MM-DD');

function buildQuerySchema(now: Date) {
  return z
    .object({
      from: DATE,                                          // REQUIRED (D-3, AC-B14)
      to: DATE,                                            // REQUIRED
      accountId: z.string().uuid().optional(),
      area: z.enum(BOS_LLM_AREAS).optional(),               // from callCatalog; the route may import it
      outcome: z.enum(['succeeded', 'failed']).optional(),
      trigger: z.enum(['owner', 'scheduled', 'external']).optional(),
      minCostUsd: z.string().regex(/^\d{1,6}(\.\d{1,10})?$/, 'minCostUsd must be a dollar amount').optional(),
      sort: z.enum(['time', 'cost']).default('time'),
      limit: z.string().regex(/^\d{1,3}$/).transform(Number)
        .refine((n) => n >= 1 && n <= 100, 'limit must be 1 to 100').default('100'),
    })
    .strict()                                              // B1 rejects actionId (B3) and any unknown key
    .superRefine((q, ctx) => {
      // from <= to; (to - from) + 1 <= AI_ACTIVITY_LIMITS.MAX_WINDOW_DAYS (92);
      // to <= today + 1 day (an admin east of UTC is already on "tomorrow").
    });
}
```

**Maximum span: 92 days (SA-RC-15).** It is at least the longest preset (31 days, "Last Month"), it covers a full quarter, and it matches the Costs & credits tab's existing `MAX_WINDOW_DAYS = 92`. So the two sibling tabs refuse the same windows. At the NFR-6 design volume (about 1.4 million rows a year), a 92-day window is about 350,000 rows for the exact count; see [R-3](#risks).

**Response:** `{ success: true, data: AiActivityPayload }`. On a thrown error the response is 500 `'Internal server error'`, with `details` only when `NODE_ENV === 'development'`.

**Accountability (AC-B8, NFR-3):** one `info` line per request through `requestLogger = baseLogger.child({ adminId })`, carrying the correlation id, the window, `accountId`, `area`, `outcome`, `trigger`, `minCostUsd`, `sort`, `limit`, `rows`, `total`, `capped`, `coverage`, the deleted-bucket count, (B1b) the audit status and `noEntry` counts, and `durationMs`. **It never carries a company name.** The log statement takes no row data, only counts.

---

### F. The Activity tab

**Constraints from the page's source guard (V-10):** no `@/lib/` import, no provider-name literal, no model literal, no `console.*`. Types are re-declared in `activityTypes.ts`, and areas arrive in the payload.

**`page.tsx` changes:**

1. `type PageTab = 'settings' | 'costs' | 'activity'`; a third `TABS` entry labelled **Activity** (from `activityCopy.ts`).
2. **URL-addressable (SA-RC-13).** The initial tab is read with `useSearchParams()?.get('tab')`, null-safe, and an unknown value means `settings`. Choosing a tab writes `?tab=<id>` with `window.history.replaceState`, so there is no `useRouter` and no app-router invariant in tests. The Costs tab becomes addressable too, as a side effect. The default export wraps the page in `<Suspense fallback={null}>`, as the audit-trail and analytics pages do (V-21).
3. The Activity panel is lazily mounted and then kept mounted, exactly like Costs (`page.tsx:70-75`, `:161-163`).

**Components (`app/admin/business-os-llm/components/activity/`):**

| Component | Responsibility |
|---|---|
| `ActivityTab.tsx` | Query state, the fetch with sequence number and `AbortController` (CostsTab's newest-request-wins pattern), section layout, error state that clears the table (a failed read never leaves the previous window's rows on screen) |
| `ActivityFilters.tsx` | Six preset buttons (`aria-pressed`) plus an explicit From/To (`<input type="date">`, labelled) and Apply; the account picker; Area, Outcome and Trigger `<select>`s; minimum cost; a sort toggle (Newest first / Most expensive first). Every control is a native element with a `<label>`, so it is keyboard-reachable (NFR-7) |
| `ActivityTable.tsx` | One `<tr>` per row. B1a columns: When, Business (name, with the short account id beneath it), Area, Action type, Trigger, Outcome, **Cost (USD)** (net, with gross struck beside it when corrected), Credits charged, Grouping id, Record state. B1b adds Calls / failed, Tokens, Models and Error code. Outcome and every record state render as **text plus an icon**, never colour alone (AC-B17) |
| `ActivityCountLine.tsx` | `total === null`: no count at all. Not capped: "N actions". Capped: "Showing the top 100 of N for the current filter, **newest first**" or "**most expensive first**" (FR-B10) |
| `CutoverNotice.tsx` | FR-B13's line, with links to `/admin/audit-trail?entity_type=ai_action&date_to=2026-09-29` (plus `&user_id=` when an account is chosen) and `/admin/analytics?scope=bos` (plus `&user=`). When `coverage === 'entirely_before_cutover'` it replaces the table, so no empty "no results" appears (AC-B20) |
| `DeletedAccountsBucket.tsx` | All-accounts mode only: "Account deleted — N actions, $X, Y credits". Prefixed with "at least" when `atLeast`, and labelled "not audit loss" (FR-B8) |
| `RecordStateMarker.tsx` | Text labels: "Priced from a fallback rate", "Corrected" (with reason codes), and in B1b "No audit entry — too recent (under 15 min)", "No audit entry — may be archived", "No audit entry — lost", "Audit entry unknown — read incomplete", "Audit entry on another account — defect". Reuses `components/Chip.tsx` for the visual |

**Screen-local modules:**

| File | Content |
|---|---|
| `activityTypes.ts` | Client mirror of `AiActivityPayload` and its parts, with the `costTypes.ts` header explaining the duplication |
| `activityCopy.ts` | Every string, so render tests assert the screen's own words. It includes the intro, the cut-over line, the count lines, the state labels, the bucket label and "Times are UTC" |
| `activityPresets.ts` | Pure `resolvePreset(preset, now): { from, to }` in **UTC**. Today; Yesterday; This Week (Monday to today, ISO week); Last Week (Monday to Sunday); This Month (1st to today); Last Month (1st to last day). No `@/lib/` import |

**The account picker (see [OQ-3](#open-questions-for-sa)).** The plan reuses `BusinessAccountPicker` by importing it from `@/app/admin/audit-trail/BusinessAccountPicker`. The source guard's `@/lib/` rule reads import specifiers, so the import passes the guard's letter. The picker brings `@/lib/logger` into the bundle; it is already a client-safe module, and it is already in the admin bundle through the audit page. The alternative is a second picker. That would duplicate an existing, tested component against the reuse rule, so the plan asks SA rather than deciding.

**Formatting** reuses `costFormat.ts` (`formatUsd`, `formatCredits`, `formatCount`) and `format.ts` (`formatInstant`).

---

### G. Guards that must be extended

Each of these, if missed, either goes red locally or silently stops covering the new code.

| Guard | Change | Why |
|---|---|---|
| `BusinessOsCreditLedgerReadRepository.test.ts:437-462` (importer list, **V-6**) | Add `lib/business-os/credits/aiActivity.ts` (types via `Pick<…>`) and `lib/business-os/credits/aiActivityDeps.ts` | Exact equality: red otherwise |
| Same file: recording client `:50` | Add `not` and `is` to the builder's method list | The new builder calls them |
| `serviceColumn.guard.test.ts:64`, `:67-77` | Files under `credits/` are scanned already. **Add explicit `arrayContaining` entries** for `aiActivity.ts`, `aiActivityDeps.ts` and `aiActivityTypes.ts` so a move out of the directory fails, and **append** the route file and every file under `app/admin/business-os-llm/components/activity/` to `files` (NFR-4.5: "wherever it lives") | SA-RC-2 |
| `adminReadMethods.guard.test.ts:271-278` (B1b) | Add `listAiActionEntriesAllAccountsByGroupIds` to `ADMIN_METHODS`, and a query-shape test (columns, entity type, two actions, case variants, window, limit, **no** `severity`) | NFR-4.4 caller pin |
| `source.guard.test.ts` (page) | **No change.** It walks the folder, so it covers the new files automatically. Its anti-vacuity check (`:77-82`) still holds | SA-RC-13: "unchanged" |
| `creditReport.wireTypes.test.ts` pattern | New `lib/business-os/credits/__tests__/aiActivity.wireTypes.test.ts`: two-way `Satisfies<>` between `AiActivityPayload` and the client mirror | Enforced by `typecheck:bos-llm`, not Jest |
| Admin authz surface guard | **No change**: the new route gates with `requireAdmin` first (V-23) | Required CI check |
| `page.render.test.tsx`, `costsTab.render.test.tsx` | Add a `jest.mock('next/navigation', …)` returning a controllable `useSearchParams` | The page now reads the URL |

---

### H. The console.* audit

Counted on 2026-10-02 (`grep -c 'console\.'`). **Every file this plan modifies or calls into has 0 calls**, so there is no conversion to propose:

| File | `console.*` |
|---|---|
| `app/admin/business-os-llm/page.tsx` | 0 (the page's source guard enforces it) |
| `lib/repositories/BusinessOsCreditLedgerReadRepository.ts` | 0 |
| `lib/repositories/AuditTrailRepository.ts` | 0 |
| `lib/repositories/ArchiveRepository.ts` (called, not modified) | 0 |
| `lib/repositories/BusinessProfileRepository.ts` (called, not modified) | 0 |
| `lib/repositories/index.ts` | 0 |
| `lib/business-os/credits/effectiveFields.ts`, `creditLeakCheck.ts`, `creditReport.ts` | 0 |
| `app/admin/audit-trail/BusinessAccountPicker.tsx` (imported, not modified) | 0 |
| `app/admin/business-os-llm/costFormat.ts`, `format.ts`, `components/Chip.tsx`, `components/Marker.tsx` | 0 |

---

## Files to Create / Modify

| File | Action | Slice | Change |
|---|---|---|---|
| `supabase/migrations/20261026_business_os_credit_charges_activity_indexes.sql` | create | B1a | Two partial indexes, no function ([§ A](#a-b0--the-index-migration)) |
| `supabase/SQL Scripts/20261026_business_os_credit_charges_activity_indexes_rollback.sql` | create | B1a | `DROP INDEX IF EXISTS` × 2 |
| `scripts/check-bos-credit-charges-activity-indexes.sql` | create | B1a | Read-only `pg_indexes` + E1 to E6 `EXPLAIN` |
| `supabase/migrations/__tests__/business-os-credit-charges-activity-indexes.migration.test.ts` | create | B1a | SQL-text pins |
| `lib/repositories/BusinessOsCreditLedgerReadRepository.ts` | modify | B1a | Header `:17-36`; types; `CHARGE_LIST_LIMITS`; two guards; private `chargeQuery`; four methods |
| `lib/repositories/index.ts` | modify | B1a/B1b | Re-export the new types and constants (`:67-79`, and the AuditTrail block) |
| `lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts` | modify | B1a | Tests for the four methods; `not` / `is` in the client; importer list `:437-462` |
| `lib/business-os/credits/creditReport.ts` | modify | B1a | **Export** `toUnits`, `CREDIT_SCALE` and `COST_SCALE` (`:88-89`, `:135-138`). No behaviour change ([OQ-9](#open-questions-for-sa)) |
| `lib/business-os/credits/aiActivityTypes.ts` | create | B1a | Wire types |
| `lib/business-os/credits/aiActivity.ts` | create | B1a (+B1b) | The builder, limits, cut-over constant |
| `lib/business-os/credits/aiActivityDeps.ts` | create | B1a (+B1b) | Production wiring of non-admin reads |
| `lib/business-os/credits/__tests__/aiActivity.test.ts` | create | B1a (+B1b) | Builder tests ([Test Plan](#test-plan)) |
| `lib/business-os/credits/__tests__/aiActivity.wireTypes.test.ts` | create | B1a | Two-way type pin |
| `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts` | modify | B1a | Explicit entries and the out-of-directory files |
| `app/api/admin/business-os/ai-activity/route.ts` | create | B1a (+B1b) | The route |
| `app/api/admin/business-os/ai-activity/__tests__/route.test.ts` | create | B1a (+B1b) | Integration tests |
| `app/admin/business-os-llm/page.tsx` | modify | B1a | Third tab, `?tab=`, `Suspense` wrapper, header comment |
| `app/admin/business-os-llm/activityTypes.ts`, `activityCopy.ts`, `activityPresets.ts` | create | B1a | Client mirrors, strings, presets |
| `app/admin/business-os-llm/components/activity/*.tsx` (7 files, [§ F](#f-the-activity-tab)) | create | B1a (+B1b columns) | The tab |
| `app/admin/business-os-llm/__tests__/activityTab.render.test.tsx` | create | B1a (+B1b) | jsdom render tests |
| `app/admin/business-os-llm/__tests__/activityPresets.test.ts` | create | B1a | Pure preset tests |
| `app/admin/business-os-llm/__tests__/page.render.test.tsx`, `costsTab.render.test.tsx` | modify | B1a | `next/navigation` mock; a `?tab=activity` test |
| `lib/repositories/AuditTrailRepository.ts` | modify | B1b | Header; column list, limits, row type; the new method |
| `lib/repositories/__tests__/adminReadMethods.guard.test.ts` | modify | B1b | `ADMIN_METHODS` + query-shape tests |
| `lib/repositories/__tests__/AuditTrailRepository.test.ts` | modify | B1b | Regression: `listOwnerEntries` still excludes AI entries (AC-B18) |

**Not touched:** `TokenUsageRepository` and its contract test (B2); the writer repository and its importer guard; `runAiAction`, the recorder and `business_os_record_credit_charge`; the leak check and its route; `app/admin/components/AdminSidebar.tsx` (`nav.test.ts` pins exactly one entry); `app/admin/audit-trail/**` (the deep link is B3); every owner surface.

---

## Task List

### B1a

**T0 — Branch (blocker).**
- ✅ RM cut `feature/admin-ai-activity-b1a` from `origin/main` `03b62c3c` (worktree `neuronforge-ai-activity`). Dev confirmed it with `git branch --show-current` and recorded it in this header. (The proposed name `…-slice-b1a` was shortened by RM.)

**T1 — B0′ files.**
- ✅ Migration, rollback, checker and migration test ([§ A](#a-b0--the-index-migration)), with SA-B1-1 to SA-B1-4 applied.
- ✅ Migration test green locally (18 tests); see [Implementation Notes](#implementation-notes-b1a).

**T2 — Checkpoint: user applies B0′ on production (D-7).**
- [ ] **OWED BY THE USER.** User follows the [apply procedure](#a-b0--the-index-migration) and pastes the checker output into [B0′ evidence](#b0-evidence-ac-b16). Nothing has been applied to any database by Dev.
- [ ] Dev reads the plans against the E1 to E6 (and G1/G2/G4) expectations and records the verdict. **B1a is not verified until this is done.**

**T3 — Ledger repository.**
- ✅ Types, limits, guards, `chargeQuery`, four methods, header amendment ([§ B](#b-the-ledger-read-repository)).
- ✅ Repository tests, including the importer-list and recording-client (`not`, `is`) updates.

**T4 — Builder.**
- ✅ Export `toUnits` and the scales from `creditReport.ts` (OQ-9, in place).
- ✅ `aiActivityTypes.ts`, `aiActivity.ts` (steps 1 to 7, 9), `aiActivityDeps.ts`.
- ✅ Builder tests and the wire-types pin.

**T5 — Route.**
- ✅ Route and integration tests ([§ E](#e-the-route-and-its-zod-schema)).

**T6 — Tab.**
- ✅ `activityTypes.ts`, `activityCopy.ts`, `activityPresets.ts`; the seven components; `page.tsx` changes (SA-B1-5, SA-B1-8).
- ✅ Render tests and preset tests. Page `?tab=` tests live in the new `activityTab.render.test.tsx` (see deviation D-9).

**T7 — Guards.**
- ✅ Service-column guard extended ([§ G](#g-guards-that-must-be-extended)); ledger importer list extended (T3).

**T8 — Local verification.**
- ✅ L-1, L-2, L-3, L-4, L-7 run; L-5 compiled but page-data collection needs env (see notes; CI Build check confirms). L-6 and L-8 are QA's. Results in [Implementation Notes](#implementation-notes-b1a).

**T9 — Production checks (user, after deploy).**
- [ ] P-1 to P-6 recorded.

### B1b

**T10 — Branch.**
- ✅ RM cut `feature/admin-ai-activity-b1b` (the proposed `…-slice-b1b` shortened, as for B1a) from `origin/main` `8c8b5d08` after B1a merged. Dev confirmed it with `git branch --show-current`.

**T11 — Audit-trail repository.**
- ✅ `listAiActionEntriesAllAccountsByGroupIds`, `ADMIN_AI_ACTION_ENTRY_COLUMNS`, `ADMIN_AI_ENTRY_LIMITS`, row and page types, header amendment ([§ C](#c-the-audit-trail-repository-b1b)).
- ✅ `ADMIN_METHODS` entry and query-shape tests. `listOwnerEntries` regression: the existing exclusion suite in `AuditTrailRepository.test.ts` is unchanged and green (D-B6).

**T12 — Builder join.**
- ✅ Step 8: the match (SA-B1-7), the projection, the six states, the archive cutoff, the counts. Archive wiring in `aiActivityDeps.ts` (`aiActivityArchive()`).
- ✅ Builder tests for B1b (25 new).

**T13 — Route wiring.**
- ✅ `listAuditEntries` injected with the admin read context; `archive` from `aiActivityArchive()`; audit status and counts on the log line; route tests (5 new).

**T14 — Tab columns and markers.**
- ✅ Four entry columns, the five B1b state labels, the "over the rows shown" counts with the 15-minute boundary (new `AuditSummaryLine.tsx`); render tests (9 new, 1 updated).

**T15 — Verification.**
- ✅ Local gates re-run; results in [Implementation Notes (B1b)](#implementation-notes-b1b).
- [ ] **P-7 and P-8 owed after B1b deploys** (QA / user).

---

## Test Plan

**Gates versus evidence (NFR-9, SA-RC-14, corrected by SA-B1-6).** No CI job runs Jest, and ts-jest does not type-check. Every Jest result below is **evidence**: Dev runs it and pastes the output into [§ QA Testing Report](#qa-testing-report). The CI gates are the **four required checks** on `main`: **Admin authz surface guard**, **Type check (Business OS LLM attribution)** (`npm run typecheck:bos-llm`, which compiles `lib/business-os/credits/**`, the wire-types pin and the route), **Build**, and **React hooks rules guard** (`npm run lint:hooks`). `typecheck:bos-llm` (exit 0, no new baseline entries) and `lint:hooks` are therefore gates, run locally before the PR.

### Mapping to the acceptance criteria in B1's scope

| AC | B1 part | Evidence (test file → what it asserts) | Slice |
|---|---|---|---|
| **AC-B1** | One row per `action_id`, never per adjustment; FR-B1 columns from their sources; cost and credits equal charge plus adjustments; column labelled "Cost (USD)" | `aiActivity.test.ts`: a page with two charges and an adjustment returns two rows, with the adjustment netted into its charge. `activityTab.render.test.tsx`: the header reads "Cost (USD)"; entry columns are present in B1b only | B1a, entry columns B1b |
| **AC-B3** | Each filter narrows and they combine; presets resolve; cost sort | Repository tests: each filter appears in the recorded query, and all together. `aiActivity.test.ts`: area resolves to its action types, and an area with none makes no query. `activityPresets.test.ts`: the six presets on fixed `now` values, including a Sunday, a Monday, the 1st of a month, 1 January and a leap February. Route test: `sort=cost` maps to `cost_usd` descending | B1a |
| **AC-B5** (list half) | Two accounts sharing a `group_id`: each row is its own account; the other account's audit entry is never serialised | `aiActivity.test.ts`: seeded charges on accounts A and B with one group. All-accounts mode gives two rows with the right accounts. With `accountId = A`, the repository call carries `.eq('user_id', A)`. **B1b:** B's entry, carrying marker strings, is absent from `JSON.stringify(payload)`. Same `actionId` on another account gives `account_mismatch` with no entry fields. The drill-down half is **B2** | B1a, B1b |
| **AC-B6** (Q1 half) | "No audit entry", counted as lost unless too recent or older than the archive cutoff | `aiActivity.test.ts` with a fixed `now`: a charge 5 minutes old is `too_recent`; one older than a seeded cutoff is `may_be_archived`; otherwise `lost`. The cutoff comes from `max(getLatestCutoff, partial run with rows moved)`. Audit read failed or cut gives `unknown`, never `lost`. **QA:** records the live "lost" count over a window and splits it with the two error lines (`aiActionAudit.ts:478-481`, `:585`). The leak-check half is **B3** | B1b |
| **AC-B7** (list half) | The list performs no `token_usage` read | Source test: `aiActivity.ts`, `aiActivityDeps.ts` and the route do not name `TokenUsageRepository` or `token_usage`. The deps type has no usage member | B1a |
| **AC-B8** | No write, no LLM call, no audit write; scoped, allow-listed reads; one log line with admin, correlation id and filters, no business name | Route test: a logger spy sees exactly one `info` with `adminId`, correlation id and the filters, and `JSON.stringify` of every log call contains no seeded company name. Repository write-verb pin. Code review | B1a |
| **AC-B9** (deleted-account part) | `user_id` NULL charges in their own bucket, exact count, netted total, "at least" at the ceiling, never merged, not audit loss | Repository: `.is('user_id', null)` with `count: 'exact'`, paged. `aiActivity.test.ts`: bucket figures netted; `atLeast` when the ceiling is reached; no row with a null account; `null` in single-account mode. Render test: "at least" and "not audit loss" text. The ungrouped and platform parts are **B3** | B1a |
| **AC-B11** | At most 100 rows; limit in the query; >100 refused by schema and repository; "top 100" text; count filtered like the rows | Repository: `.range(0, 99)` recorded; `limit: 101` returns a guard error before any query. Route: `limit=101` gives 400. Builder: `total` passes through, and `capped` is `total > rows.length`. A test where the recorded count (filtered) differs from a fake unfiltered figure proves the filtered one is shown. A `null` count shows no count. Render: the capped line text | B1a |
| **AC-B13** | No prompt, owner text, output or error message; no email; no business name in logs | B1b builder: an entry whose `details` also carries `prompt`, `ownerText`, `output` and `errorMessage` keys with unique markers, and a non-identifier `errorCode`. No marker appears in the payload. The column list has no `user_email`. Route log spy as in AC-B8 | B1a, B1b |
| **AC-B14** (list route) | 401; 403; missing window 400; span over 92 days 400 **called directly**; limit over 100 rejected; happy path; `requireAdmin` first; authz guard passes | `route.test.ts`: all of these, plus a non-admin with an invalid query gets 403 (not 400), a repeated key gives 400, `actionId` gives 400 in B1 (strict), a platform account gives 409, and a production `NODE_ENV` 500 has no `details`. The drill-down 400 is **B2** | B1a |
| **AC-B15** (B1 part) | No inline client; two named list methods over one builder; header amended; no write verb; no `service` filter; service-column guard extended; AuditTrail method filters by action and entity type, never severity, header amended; `listOwnerEntries` unchanged | Repository tests (`not` / `is` / `in('action_type')`, no `service`); write-verb pin; importer list; service-column guard run; `adminReadMethods` query-shape test asserting no `eq('severity')`; `AuditTrailRepository.test.ts` regression. The `TokenUsageRepository` part is **B2** | B1a, B1b |
| **AC-B16** | Live `pg_indexes` recorded before; `EXPLAIN` with `enable_seqscan = off` after apply; latency today | [B0′ evidence](#b0-evidence-ac-b16). The "before" half is already in F-24 | B1a |
| **AC-B17** (B1 states) | Keyboard operable; labelled controls; outcome, no-entry classes, bucket, fallback-priced and corrected distinguishable without colour | Render test: every state renders its **text**; every control has an accessible name (`getByLabelText`); presets have `aria-pressed`. QA keyboard pass. The mismatch, audited-not-charged and shared-group states are **B2/B3** | B1a, B1b |
| **AC-B18** | No owner surface changed; no owner read returns an AI entry | Diff review (no file under owner surfaces); the `AuditTrailRepository.test.ts` `listOwnerEntries` exclusion suite stays green | B1a, B1b |
| **AC-B19** (list half) | A later-period adjustment nets onto its charge with original and net; never its own row; area and trigger are the charge's; cost sort by gross | `aiActivity.test.ts`: an adjustment with `created_at` and `period_start` outside the window is still netted (the lookup is by id, unwindowed); the row is marked corrected with its reason code; ordering is the repository's gross order. Repository: `listAdjustmentsForActionIds` has no `created_at` filter. Adjustments are seeded, because none can exist live today (FR-B12). The drill-down listing is **B2** | B1a |
| **AC-B20** | Window starting before cut-over shows the line with both links; window entirely before shows the line, not an empty table; no pre-cut-over row | `aiActivity.test.ts`: `to` before the cut-over makes no repository call and gives `entirely_before_cutover`; a straddling window is clamped to the floor (asserted on the recorded `gte`); the floor is `<=` the microsecond value. Render: line plus links, no table, in the "entirely" case | B1a |

**Not in B1:** AC-B2, AC-B4, AC-B10, AC-B12 (retired), AC-B21, and the drill-down, leak-check and reverse-pass halves of AC-B5, B6, B7, B9 and B19.

---

## Verification Plan

### Local (Dev, then QA re-runs)

| # | Command | Pass condition | Note |
|---|---|---|---|
| L-1 | `npx jest lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts lib/repositories/__tests__/adminReadMethods.guard.test.ts lib/repositories/__tests__/AuditTrailRepository.test.ts lib/business-os/credits app/api/admin/business-os app/admin/business-os-llm supabase/migrations/__tests__ lib/admin/__tests__/admin-authz-surface.guard.test.ts` | All green; output pasted | Evidence, not a gate |
| L-2 | `npm run typecheck:bos-llm` and `npm run typecheck:bos-llm -- --list` | Exit 0, no new baseline entries. `--list` shows `aiActivity*.ts` as core and the route in scope | **Required check** (SA-B1-6) |
| L-3 | Scoped `tsc` over the files the gate does not cover (both repositories, `index.ts`, the page and the activity components): a scratch `tsconfig` (not committed) extending `tsconfig.json` with `"include": []` and `"files": [those files]`, run as `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p <scratch>`. Write the output to a file, check `tsc`'s own exit code, and **filter diagnostics to the touched files**. Run the same on a clean `main` export and diff | No diagnostic in a touched file that `main` does not have | **Canary first:** plant one deliberate type error in a touched file and confirm it is reported, then remove it. A run that OOMs prints nothing and reads as clean (`business-os-schema-check` Rule 7) |
| L-4 | `npx eslint` on every new or modified source file; `npm run lint:hooks` | No new errors or warnings against `main` on the modified files; new files clean | `npm run lint` is broken repo-wide (Slice A finding), so eslint runs per file. `lint:hooks` is a **required check** (SA-B1-6) |
| L-5 | `npm run build` | Compiles | Required CI check |
| L-6 | `npm run schema:check` | No failure on the new selects | Constant-built selects are a known blind spot: QA confirms every column against the `20261015` body, all of which `CREDIT_LEDGER_ROW_COLUMNS` already reads in production through the report |
| L-7 | `npm run test:bos-entitlements` | Green, unchanged | Confirmation only; nothing imports the module directly |
| L-8 | Manual, `npm run dev`, signed in as an admin: open `/admin/business-os-llm?tab=activity`, try each preset, filter and sort, a window before 29 September, and the keyboard pass | Behaviour as specified | QA records it (E2E is not set up) |

### B0′ evidence (AC-B16)

**Before the migration (recorded 2026-10-02 in F-24):** four indexes, matching the repo exactly (see [§ A](#a-b0--the-index-migration)).

**Applied by the user on production, 2026-10-04 (~07:37 UTC).** Recorded by TL from the user's pasted output.

*Editor note.* The Supabase SQL editor rejected checker section 1 with `42P01: relation "E6" does not exist`: the label text `'account id to paste into E6 …'` was read by the editor as a `SELECT … INTO E6` clause, though Postgres ignores string contents. The label is now `'busiest account id, for block E6'` and the file is ASCII-only with no apostrophes in comments. The user ran an equivalent section 1 (same expected/live comparison, without the `SET default_transaction_read_only` line and the valid/ready row), and single `SET enable_seqscan = off; EXPLAIN …` statements rather than `BEGIN READ ONLY … ROLLBACK` blocks, because the editor shows only the last result set.

```text
-- Section 1 BEFORE (2026-10-04 07:36:18 UTC): VERDICT FAIL, 5 pass 2 fail
--   pkey, action_id_key, user_period_idx, group_idx: PASS
--   kind_created_idx, adjusts_action_idx: FAIL (missing); no other index: PASS
--   ledger: 154 charges, 0 adjustments, 0 charges of deleted accounts
--   busiest account: 9459b49b-9374-4329-9ed2-fb0adcbc3aab (57 charges)

-- Migration 20261025 run: success, no rows returned.

-- Section 1 AFTER (2026-10-04 07:38:33 UTC): VERDICT PASS, 7 pass 0 fail
--   kind_created_idx: CREATE INDEX business_os_credit_charges_kind_created_idx ON public.business_os_credit_charges USING btree (kind, created_at DESC, id DESC)
--   adjusts_action_idx: CREATE INDEX business_os_credit_charges_adjusts_action_idx ON public.business_os_credit_charges USING btree (adjusts_action_id) WHERE (adjusts_action_id IS NOT NULL)
--   no other index on the table: PASS

-- E1 (enable_seqscan = off) all accounts, newest first, LIMIT 100
Limit (cost=0.14..7.25 rows=100) (actual time=1.307..1.364 rows=100)
  -> Index Scan using business_os_credit_charges_kind_created_idx (actual rows=100)
       Index Cond: kind = 'charge' AND created_at >= '2026-09-29 16:50:53.914+00' AND created_at < '2027-01-01'
       Filter: user_id IS NOT NULL
Planning 3.527 ms, Execution 1.442 ms   -- no Sort node

-- E2 (enable_seqscan = off) exact count, E1 filters
Aggregate -> Index Scan using business_os_credit_charges_kind_created_idx (actual rows=154)
       Index Cond: kind = 'charge' AND created_at range; Filter: user_id IS NOT NULL
Planning 2.058 ms, Execution 1.444 ms

-- E4 (enable_seqscan = off) adjustments for two action ids
Index Scan using business_os_credit_charges_kind_created_idx (actual rows=0)
       Index Cond: kind = 'adjustment'
       Filter: adjusts_action_id = ANY ('{…0001,…0002}'::uuid[])
Planning 1.275 ms, Execution 0.066 ms
```

**Index (b) direct proof (user, 2026-10-04, after the SA ruling below; optional, not a gate):** `SET enable_seqscan = off; EXPLAIN SELECT id … WHERE adjusts_action_id = ANY ('{…0001,…0002}'::uuid[])` → `Index Scan using business_os_credit_charges_adjusts_action_idx` (cost=0.12..2.34), `Index Cond: adjusts_action_id = ANY (…)`. Index (b) is usable.

**TL verdict (pending SA confirmation):** E1 and E2 meet their expectations — index (a) serves the window, the order (no Sort node) and the count. **E4 did not use index (b)**: with **zero** adjustment rows, the planner served `kind = 'adjustment'` from index (a), which is empty for that kind and cheaper than the partial index. This is the expected planner choice at today's volume, not a defect, and index (b) is harmless until slice 4c writes adjustments. E3, E5, E6 and the generic-plan blocks G1, G2, G4 were **not run**. SA to rule whether E1/E2/E4 suffice for AC-B16 or which further blocks are needed.

**SA ruling on B0′ evidence — 2026-10-04**

1. **AC-B16 is satisfied for B1a. No further block is required.** The live `pg_indexes` was recorded before (F-24 and section 1 BEFORE). Section 1 AFTER shows both exact `indexdef`s at 7/0. E1 and E2, run with `enable_seqscan = off`, show that the list (ordered, no Sort node) and its exact count use index (a), at about 1.4 ms execution today. The lookup in E4 can use a new index, which is what the AC asks for.
2. **The E4 result is acceptable.** With 0 adjustment rows, `kind = 'adjustment'` on index (a) is an empty range and the cheapest path. Index (b) is valid, and an equality / `ANY` on `adjusts_action_id` implies its `IS NOT NULL` predicate, so it becomes the cheaper path once slice 4c writes adjustments. That is standard planner behaviour, not a defect.
3. **The blocks not run are waived, proportionate to 154 rows.** G1/G2: index (a) is not partial (verified by `indexdef`), so a generic plan can use it by construction. That was the whole point of SA-B1-1. G4 adds nothing beyond E4. E3: the top-N sort is expected and documented (R-3). E5 has the same access path as E1 over 0 rows. E6: either index is acceptable per § A.
4. **Optional, not a gate.** For direct evidence that index (b) is usable, run this single statement in a fresh tab:
   `SET enable_seqscan = off; EXPLAIN SELECT id FROM public.business_os_credit_charges WHERE adjusts_action_id = ANY ('{00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000002}'::uuid[]);`
   The expected result is an Index (or Bitmap) Scan on `business_os_credit_charges_adjusts_action_idx`.
5. The checker fix was confirmed. The migration test is 18/18 after the `E6` label and comment edits. The latency half of AC-B16 at the route level is still owed as P-6 after deploy.

### Production checks owed by the user

| # | When | Check | Record |
|---|---|---|---|
| P-0 | Before verification | B0′ applied, checker output pasted above. ✅ Done 2026-10-04: applied, 7/0 PASS, E1/E2/E4 recorded; accepted by the SA ruling above | Here |
| P-1 | After B1a deploys | `/admin/business-os-llm?tab=activity` loads for an admin. A non-admin is redirected by the layout. The URL keeps `?tab=activity` across reloads | QA report |
| P-2 | After B1a | "This Month" (October): the count line's N equals a read-only `count: 'exact'` of `kind = 'charge'` rows since 1 October. The first row, sorted oldest-first in a "Last Month" window, is the `briefing_narration` at `2026-09-29T16:50:53Z` | QA report |
| P-3 | After B1a | "Last Month" (September) shows the cut-over line with both links working, and lists rows only from 29 September 16:50 UTC | QA report |
| P-4 | After B1a | Sort by cost: the first row has the highest `cost_usd` in the window. Filter to one account: every row shows that business, and the deleted-account bucket disappears | QA report |
| P-5 | After B1a | The deleted-account bucket shows 0 (F-21: 0 NULL `user_id` rows) | QA report |
| P-6 | After B1a | Route latency from the `durationMs` field of the Pino line for the "This Month" read | Here, with AC-B16 |
| P-7 | After B1b | A recent row shows calls, tokens and models matching its audit entry on `/admin/audit-trail` | QA report |
| P-8 | After B1b | QA records the "lost" count over the rows shown for a recent window, and splits it with the two error lines (FR-B5, SA-RC-7). It is a QA note, never a screen feature | QA report |

### Rollback

- **Code:** revert the PR. The tab and the route are additive, and nothing else reads them.
- **B0′:** run the rollback script. Without the indexes the view is slower at volume and still correct.

---

## Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | **Index build blocks charge writes.** A queued `CREATE INDEX` holds later `INSERT`s, and a charge write that waits beyond 1.5 s ends with an unknown fate (F-20) | Low / medium | `lock_timeout = '1s'`; apply at a quiet hour; the build itself takes milliseconds at about 100 rows; a timed-out apply rolls back and is re-run |
| R-2 | **Cut-over constant rounding.** Rounding the microsecond instant **up** would exclude the very first charge | Low / low | Floor truncated to the millisecond, documented, and asserted by test |
| R-3 | **Count and cost-sort cost at design volume.** A 92-day all-accounts window at about 1.4 million rows a year is about 350,000 index entries to count, plus a top-N sort for the cost order | Low today / medium at scale | Partial index; bounded span; the route logs `durationMs`. Revisit (for example a planned rather than exact count, or a `(cost_usd)` index) when P-6-style latency grows. Not built now (SA-R1) |
| R-4 | **The importer guard SA did not know about** (V-6) goes red | Certain if missed / low | Extended in the same commit (T3, [§ G](#g-guards-that-must-be-extended)); raised for SA as [OQ-1](#open-questions-for-sa) |
| R-5 | **Gross sort becomes wrong** if slice 4c ever lets an adjustment **raise** a charge | Low / low | Recorded dependency (SA-R8). The builder comment names it, and the corrected marker always shows both figures |
| R-6 | **Mixed-case client turn ids** escape the lower/upper `IN` and read as "entry lost" | Very low / low | Real clients send canonical case; the residue is visible as "lost" (not hidden), and the root fix belongs to chat-v4 lower-casing its turn id, recorded as a follow-up |
| R-7 | **An audit read cut at 1,000 rows** (a client reusing one turn id many times) | Low / low | `unknown — read incomplete`, never "lost" |
| R-8 | **A non-AI service** writes charge rows. The list has no `service` filter, and the area resolves to `null` for a non-AI row | Not today / medium | The Out-of-Scope tripwire (SA-R5): an effective-service rule is needed here before a non-AI service ships. The builder comment repeats it |
| R-9 | **`useSearchParams` without `Suspense`** breaks `next build` | Medium if missed / high | `Suspense` wrapper copied from the audit-trail page; `npm run build` is L-5 |
| R-10 | **The picker reuse** pulls `@/lib/logger` into the page's bundle through another folder | Certain / low | It is already client-safe and in the admin bundle. Raised as [OQ-3](#open-questions-for-sa) |
| R-11 | **Archive classification** misses a partial run older than the 100 newest runs whose cutoff beats every succeeded one | Very low / low | Archive runs are manual and rare (about one a quarter at the shortest 90-day retention); the class is first reachable around 2026-12-28 (SA-R7) |
| R-12 | **Agent file-write truncation** (project memory): a large edit blanks a file and is reported as success | Low / high | `git diff --stat` before reading the diff on every modified file; a deletion without insertion is a stop |

---

## Non-Goals

1. **No drill-down, no `token_usage` read, no `TokenUsageRepository` change** (B2).
2. **No mismatch marker, no reverse pass, no leak-check section, no Audit Trail deep link** (B3).
3. **No change to `/admin/audit-trail`, the analytics page, the sidebar, or any owner surface.** The cut-over line only links to the first two.
4. **No change to the leak check, the cost report's behaviour, the writer, or anything that records data.** The one edit to `creditReport.ts` exports three existing symbols.
5. **No new admin authorisation pattern.** `requireAdmin` first, the layout guards the page, and the source guard stays as it is.
6. **No pre-cut-over history** (D-8).

---

## Open Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| **OQ-1** | **V-6 contradicts F-25, NFR-4.5 and SA-RC-2.** The read repository **does** have an importer guard: an exact-equality list in its own unit test (`BusinessOsCreditLedgerReadRepository.test.ts:437-462`). Should the requirement be corrected? | Extend the list (T3) **and** the service-column guard, as SA-RC-2 also asks. BA corrects F-25 and NFR-4.5 in a docs touch |
| **OQ-2** | **Where the builder lives.** `lib/business-os/credits/` puts it inside `typecheck:bos-llm`'s scope and the service-column scan with no configuration change. The alternative is a new `lib/business-os/ai-activity/` folder, which needs both configs extended | `lib/business-os/credits/` |
| **OQ-3** | **The account picker.** Reuse `BusinessAccountPicker` by importing it from `app/admin/audit-trail/`? It passes the page guard's letter (the specifier is not `@/lib/`) but brings `@/lib/logger` in transitively | Reuse by import. The alternative duplicates a tested component |
| **OQ-4** | **Maximum window span** | 92 days, the same as the Costs & credits tab's `MAX_WINDOW_DAYS` |
| **OQ-5** | **"Too recent" window** | 15 minutes, stated on screen. Conservative against a serverless instance dying before the 5 s flush |
| **OQ-6** | **Case variants in the audit join (V-14)** | Query lower and upper case (at most 200 ids). Record "chat-v4 lower-cases its turn id" as a follow-up for the Layer 3 owners |
| **OQ-7** | **Audit join bounds**: `[earliest − SLACK_MS, latest + SLACK_MS)` with `SLACK_MS` = 1 h, 1,000-row cap, `unknown` when cut | As stated |
| **OQ-8** | **Archive cutoff**: `max(getLatestCutoff('audit_trail'), highest cutoff among listRuns({ limit: 100 }) with rows moved)`, or a new purpose-named `ArchiveRepository` method? | Reuse the two existing methods. A new method is not justified at about one run a quarter |
| **OQ-9** | **Integer-unit helpers.** Export `toUnits`, `CREDIT_SCALE` and `COST_SCALE` from `creditReport.ts`, or move them into a small shared `ledgerAmounts.ts`? | Export in place: three words, no move, no behaviour change |
| **OQ-10** | **B0′ index shape and apply**: `(created_at DESC, id DESC) WHERE kind = 'charge'` plus `(adjusts_action_id) WHERE adjusts_action_id IS NOT NULL`; plain `CREATE INDEX`, `lock_timeout = '1s'`; file `20261025_…` (`20261016` is reserved for 4c) | As stated |
| **OQ-11** | **The split** into B1a (ledger list, about 3 days) and B1b (audit join, about 2 days) | Split |
| **OQ-12** | **Deep-link landing** (`?actionId=`) moved to B3 with the inbound Audit Trail link; B1a makes the tab addressable only | Move to B3 |
| **OQ-13** | **Fallback-priced marker in B1a without a direction**, since direction needs `token_usage` (SA-RC-4) | Show "Priced from a fallback rate" now; the direction arrives with B2/B3 |
| **OQ-14** | **The platform account as `accountId`**: 409 as the cost report does, or an empty list? | 409 (`report/route.ts:125-127` precedent) |

---

## Implementation Notes (B1a)

**Dev, 2026-10-02.** Branch `feature/admin-ai-activity-b1a`, worktree `neuronforge-ai-activity`, base `03b62c3c`. **Everything is uncommitted and unstaged**, per the standing rule that the user reads the diff before any commit. Nothing was applied to any database.

### SA required changes — resolution

| # | Resolution |
|---|---|
| SA-B1-1 | ✅ Index (a) is `business_os_credit_charges_kind_created_idx (kind, created_at DESC, id DESC)`, not partial. Index (b) `business_os_credit_charges_adjusts_action_idx (adjusts_action_id) WHERE adjusts_action_id IS NOT NULL`. Both `CREATE INDEX IF NOT EXISTS`, `SET LOCAL lock_timeout = '1s'`, one transaction. § A, the shape table, E1–E6 and the test pins updated |
| SA-B1-2 | ✅ `scripts/check-bos-credit-charges-activity-indexes.sql`: section 1 is `SET default_transaction_read_only = on;` plus ONE result set (VERDICT + a PASS/FAIL row per index comparing the exact `indexdef`); E1–E6 are self-contained `BEGIN READ ONLY … ROLLBACK` blocks with literals; G1/G2/G4 are generic-plan blocks (`PREPARE`, `plan_cache_mode = force_generic_plan`, `EXPLAIN EXECUTE`, `DEALLOCATE`). Pinned by the migration test |
| SA-B1-3 | ✅ Rollback is `BEGIN; SET LOCAL lock_timeout = '1s'; DROP INDEX IF EXISTS … ×2; COMMIT;`, pinned by test |
| SA-B1-4 | ✅ Both: `scripts/check-admin-ai-activity-indexes.sql` is **kept** (the requirement's F-24 cites it, and it also lists the `audit_trail` indexes B1b needs) and must ship with B1a; and the new checker's section 1 doubles as the "before" check, so apply step 1 now points at it |
| SA-B1-5 | ✅ `ActivityTab` renders `PLATFORM_ACCOUNT_ERROR` (amber, `data-testid="activity-platform-account"`) for `error: 'platform_account'`, pointing at the leak check on Costs & credits. Render test asserts the copy and the absence of the generic error |
| SA-B1-6 | ✅ Test Plan preamble, L-2 and L-4 now name the four required checks. The stale workflow comment is NOT edited (TL follow-up) |
| SA-B1-8 | ✅ `?tab=costs` / `?tab=activity` set the panel's opened flag in `useState` initialisers on first render; `replaceState(window.history.state, …)` keeps state and other params. One test per tab, plus a `history.state` test. Both properties were mutation-checked (each mutation turned a test red) |
| SA-B1-9 | ✅ `aiActivityAreaOptions()` calls `areaFor(AI_CHARGE_SERVICE, type)`; a source test refuses `areaFor('…'` |
| SA-B1-7 | B1b only — not in this slice |

### Deviations from the plan, and why

| # | Deviation | Why |
|---|---|---|
| D-1 | Index (a) renamed `…_kind_created_idx` (plan: `…_charge_created_idx`) | After SA-B1-1 it is no longer charge-only; the old name would mislead |
| D-2 | `ChargeListPage.total` (and the deleted-bucket `total`) is `number \| null`; a missing PostgREST count is passed through as `null`, not turned into a repository error | The plan's goal is "no count beats a wrong one" (FR-B10) and "never coerced to 0". Failing the whole list over a missing count would hide rows that were read correctly; `null` reaches the payload's `total: null`, and the screen shows no number. Tested at repository, builder and render level |
| D-3 | A failed main list read throws `AiActivityListReadError`; the route answers 500 with "The AI activity could not be read. Try again." (no internals) | The plan did not say what a failed page read returns. An empty list would read as "nothing ran" |
| D-4 | An adjustment read that reaches its ceiling (2,000 rows) is treated as **failed** (`adjustments: 'failed'`, every `net: null`) | A cut read could miss a correction, and a net figure that may be missing one is a wrong figure |
| D-5 | The Audit Trail cut-over link uses `date_to=2026-09-29T16:51`, not `date_to=2026-09-29` | The audit route applies `.lte('created_at', date_to)`, so a bare date stops at that day's midnight and would miss the 16 hours before the cut-over. The value also fills the page's `datetime-local` field. One minute past the cut-over overlaps by seconds instead of leaving a gap |
| D-6 | A row's `area` comes from `resolveEffectiveFields(row).effectiveArea` (the row's own service); the area FILTER uses `areaFor(AI_CHARGE_SERVICE, …)` | For an AI row they are identical. For a non-AI row (R-8 tripwire) the row shows "Not declared" instead of claiming an AI area. No `.service` read in the new code (service-column guard) |
| D-7 | Default window is **This month** | The plan did not name one; P-2 uses it |
| D-8 | The B1b fields (`entry`, `audit`) are absent from the B1a payload types, not optional | B1b adds them; an optional field that is never sent is dead UI and would weaken the two-way wire pin |
| D-9 | `page.render.test.tsx` and `costsTab.render.test.tsx` are **unchanged**; the `next/navigation` mock and the `?tab=` tests are in the new `activityTab.render.test.tsx` | `useSearchParams()` returns `null` outside the App Router in jsdom (Next 14.2.35 source), which the page treats as "no tab asked for", so the existing suites need no mock and stay green (334/334). Fewer edits to existing tests |
| D-10 | The service-column guard also scans the three screen-local modules (`activityTypes.ts`, `activityCopy.ts`, `activityPresets.ts`) | They are part of the view "wherever it lives" (NFR-4.5) |
| D-11 | `CHARGE_LIST_LIMITS` also carries `MAX_ACTION_TYPES: 64` and `ADJUSTMENTS_CEILING: 2000`; the deleted-bucket count is requested on the first page only | Guards named in § B; the count-once rule is SA's § 8 optimisation |

### Files

Created: the migration, rollback, checker and migration test; `lib/business-os/credits/aiActivity.ts`, `aiActivityDeps.ts`, `aiActivityTypes.ts` and their two tests; `app/api/admin/business-os/ai-activity/route.ts` and its test; `app/admin/business-os-llm/activityTypes.ts`, `activityCopy.ts`, `activityPresets.ts`; seven components under `components/activity/`; `activityTab.render.test.tsx`, `activityPresets.test.ts`.
Modified: `BusinessOsCreditLedgerReadRepository.ts` (+ test), `lib/repositories/index.ts`, `creditReport.ts` (three `export` keywords), `serviceColumn.guard.test.ts`, `app/admin/business-os-llm/page.tsx`.
Kept (untracked, must ship with B1a): `scripts/check-admin-ai-activity-indexes.sql`.
`git diff --stat` on the modified files: 705 insertions, 20 deletions; no file lost lines without gaining them (R-12 check).

### console.* audit

0 calls in every file created, modified or imported (`page.tsx`, `creditReport.ts`, the ledger repository, `index.ts`, the three `aiActivity*` modules, the route, the three screen modules, the seven components, `BusinessAccountPicker.tsx`). Nothing to convert.

### SA-CR / QA fixes (2026-10-03)

Applied after the SA code review (APPROVED WITH CHANGES) and QA (PASS WITH NOTES). Still uncommitted.

| Item | Fix |
|---|---|
| SA-CR-1 | `aiActivity.test.ts`: the ledger fakes and `findNames` are built with a `fake<F>()` helper, so each is a `jest.Mock<ReturnType<F>, Parameters<F>>` of the REAL `AiActivityDeps` member; fixtures are typed `ChargeListPage` / `CreditLedgerPagedResult<CreditLedgerRow>`. Both `as unknown as` casts and all four `as never` casts are gone; call arguments are read through a typed `firstCall()`. (A plain `jest.fn` annotated with the type was tried first and `typecheck:bos-llm` rejected it — the gate does check these fakes.) |
| SA-CR-2 / QA E-1 | `DeletedAccountsBucket.tsx`: "at least" now qualifies only the USD and credit sums, never the exact count; render test updated. Ceiling made exact: `listChargesOfDeletedAccountsInWindow` reads ONE row past the ceiling and sets `reachedCeiling` only when more than the ceiling came back, returning at most `ceiling` rows. Cost: one extra one-row request, only when the bucket holds at least the ceiling. Two repository tests (exactly 4 of ceiling 4 → not reached, with a one-row probe; 5 → reached, 4 returned) |
| SA-CR-3 | Stale comments fixed: route log comment no longer cites "(D-6)"; the importer list says `aiActivity.ts` imports types AND the value `CHARGE_LIST_LIMITS` |
| QA E-2 | `route.ts`: the minimum-cost refusal is plain language and names the actual reason — "must be a dollar amount written in digits, for example 0.05" / "must be less than $1,000,000" / "can have at most 10 decimal places". No parameter name. Accepted values unchanged (the repository guard's own rule). Not exported from the route file (route files export route fields only). Six refusal tests assert the exact message; four acceptance tests |
| SA optional | Apply step 2 now says to use a fresh query tab or `RESET default_transaction_read_only` |

Results: builder, repository, route, render, presets, source guard, service-column guard, wire pin, migration test and admin authz guard — **17 suites / 705 tests pass**. `npm run typecheck:bos-llm`: **passed, 0 new** (same unrelated "1 baseline entry is fixed" notice; baseline not edited). `npm run lint:hooks`: exit 0. eslint on every changed file: clean.

### Local verification (T8)

| # | Result |
|---|---|
| L-1 Jest | 57 suites / 1,574 tests: **56 suites pass; 1 suite fails with 2 tests — `lib/business-os/credits/__tests__/creditPeriod.test.ts`, PRE-EXISTING and untouched** (`git diff 03b62c3c` is empty for it and its subject). Its `withoutDisplayMaths` regex expects LF (`\n}\n`) and this Windows worktree checks files out with CRLF. New suites: migration 18/18, repository 73/73, builder 36/36, route 37/37, render 31/31, presets 9/9, wire pin 1/1, service-column guard (extended) green, page source guard green over the new files |
| L-2 `typecheck:bos-llm` | **Exit 0**: "369 files in scope, 28 errors, 0 new — passed". `--list`: `aiActivity.ts`, `aiActivityDeps.ts`, `aiActivityTypes.ts` and both tests `core`; the route `catalog-importer`; its test `caller`. It also prints "1 baseline entry is fixed" for `app/api/onboarding/build/route.ts` — unrelated to this slice, not touched |
| L-3 scoped `tsc` | Throwaway `tsconfig` over all 26 touched/new TS files. **Canary** (`const x: number = "…"` appended to `aiActivity.ts`) reported at `aiActivity.ts(452,7) TS2322`, exit 2 — the run checks. Canary removed. Real run: **0 diagnostics in any touched file**; 10 diagnostic lines in 4 untouched files reached through the repository barrel (`lib/analytics/aiAnalytics.ts`, `lib/pilot/insight/MemoryManager.ts`, `lib/repositories/CalibrationSessionRepository.ts`). The same scoped check on a clean `03b62c3c` export over the six pre-existing files gives the **identical** error set. Throwaway config and export deleted |
| L-4 eslint | All touched files: 0 errors, 0 warnings (5 warnings in the new tests were fixed). `npm run lint:hooks`: exit 0 |
| L-5 build | `npm run build` (7 min 51 s): **"✓ Compiled successfully"** (only the two long-standing Edge-runtime warnings from `@supabase/realtime-js`), and `.next/server/app/api/admin/business-os/ai-activity/route.js` and `.next/server/app/admin/business-os-llm/page.js` were emitted. It then **stopped at "Collecting page data" for `/api/admin/dashboard`: `supabaseUrl is required`**, because this worktree has no `.env.local` (only the main checkout has one, and secrets are not copied). That route is untouched; CI's Build check supplies the env. **The full build must be confirmed by the PR's Build check** |
| L-7 `test:bos-entitlements` | 103 suites / 2,226 tests pass |
| L-6, L-8 | QA |

## Implementation Notes (B1b)

**Dev, 2026-10-04.** Branch `feature/admin-ai-activity-b1b`, worktree `neuronforge-ai-activity`, base `origin/main` `8c8b5d08`. **Everything is uncommitted and unstaged**, per the standing rule that the user reads the diff before any commit. No database was read or written. No SQL file was added (the credit-lots L8 guard stays green).

### What was built

| Part | Where | Notes |
|---|---|---|
| Repository method | `lib/repositories/AuditTrailRepository.ts` | `listAiActionEntriesAllAccountsByGroupIds(context, groupIds, window)`. Filters `entity_type = 'ai_action'` and `action IN (BUSINESS_AI_ACTION_COMPLETED, BUSINESS_AI_ACTION_FAILED)`, never severity; `entity_id IN` every id in lower AND upper case, de-duplicated (at most 200); `created_at` in `[start, end)`; newest first; `.limit(1000)`; `reachedLimit` is `rows >= 1000`. Guards before any query: an admin read context, 1 to 100 UUID group ids, a valid half-open window. Logs `info` with counts only (no id, no details); a failure logs `warn` and returns `{ data: null, error }`. Header gains a third-exception paragraph; the closing paragraph now says the OWNER read excludes AI entries, which stays literally true. The `MAX_ROWS` comment says the cap follows PostgREST max-rows (OQ-7) |
| Builder join (step 8) | `lib/business-os/credits/aiActivity.ts` | Group ids come from the page's charge rows (lower-cased, distinct), never the request. Window `[earliest charge − 1 h, latest charge + 1 h)` using `LEAK_CHECK_LIMITS.SLACK_MS`. Archive cutoff = max of `getLatestCutoff('audit_trail')` and every `listRuns({ limit: 100 })` row with `source = 'audit_trail'` and `rows_archived > 0` (OQ-8). The match, the precedence and the projection follow SA-B1-7 (below). Both reads run in parallel with the adjustments, names and deleted bucket, and each fails only itself |
| Wire types | `aiActivityTypes.ts` + client mirror `activityTypes.ts` | `AiActivityRow.entry: AiActivityEntryState`; `AiActivityPayload.audit: AiActivityAuditSummary \| null`. The two-way wire pin compiles under `typecheck:bos-llm` |
| Production wiring | `aiActivityDeps.ts` | `aiActivityArchive()` wraps the two existing `ArchiveRepository` reads. The admin-pinned audit read is injected by the route |
| Route | `app/api/admin/business-os/ai-activity/route.ts` | `listAuditEntries` bound to `{ correlationId, adminId: gate.user.id }`; the log line gains `audit: { status, archive, noEntry }`. `requireAdmin` is still the first statement (its source test passes unchanged). Zod unchanged |
| Tab | `ActivityTable.tsx`, `RecordStateMarker.tsx`, `ActivityTab.tsx`, new `AuditSummaryLine.tsx`, `activityCopy.ts` | Columns Calls / failed, Tokens (in/out on hover), Models, Error code, after Credits charged. A row with no found entry reads "Unknown" in all four. Record state gains five text-plus-icon chips. The summary line says "over the N rows shown", gives the five counts, states the 15-minute boundary, and names a failed or cut audit read and an unreadable archive cutoff |

### SA-B1-7 — how each rule is met

| Rule | Code | Test |
|---|---|---|
| (i) `String(details.actionId).toLowerCase() === charge.action_id` and `entry.user_id === charge.user_id` | `joinAuditEntries`: only a string `actionId` is considered; it is lower-cased and looked up among the page's action ids; `user_id` compared exactly (both are `uuid` columns) | "(i) compares the actionId lower-cased"; mutation M2a |
| (ii) own entry ⇒ `found`; a wrong-account entry with the same id only adds to `accountMismatch`; `account_mismatch` only when no own entry | Own and foreign entries are kept apart; foreign entries are counted per charge and never projected | the two "(ii)" tests, AC-B5 tests, route AC-B5 test; mutation M1 |
| (iii) two own entries: newest `created_at`, then higher `id`; `warn` with ids only | `newestEntry`; `log.warn({ actionId, entryIds, read })` | "(iii) two own entries…" (both orders of a time tie) |

**Precedence for a row without an own entry:** audit read failed → `unknown (audit_read_failed)`; read cut at 1,000 → `unknown (audit_read_incomplete)`; another account's entry → `account_mismatch`; younger than 15 minutes → `too_recent`; archive cutoff unreadable → `unknown (archive_unread)`; older than the cutoff → `may_be_archived`; otherwise `lost`. "Lost" is reached only on complete evidence.

### Deviations from the plan, and why

| # | Deviation | Why |
|---|---|---|
| D-B1 | `entry` is **required** on a row and `audit` is **required but nullable** on the payload (plan: `entry?`, `audit?`). `audit` is `null` when no row is shown, and then neither audit read is made | Same reasoning as D-8: an optional field weakens the two-way wire pin. With no row there is nothing to join, and `null` says so honestly |
| D-B2 | `unknown` carries one of three named reasons: `audit_read_failed`, `audit_read_incomplete`, `archive_unread`. The screen shows one label ("Audit entry unknown — read incomplete") with the reason as hover text | The plan said `{ state: 'unknown', reason }` without naming the reasons |
| D-B3 | When the audit read is cut, a row with only a wrong-account entry is `unknown`, not `account_mismatch` (it still adds to the mismatch count) | Its own entry may sit in the part that was not read; SA-B1-7 (ii) makes `account_mismatch` conditional on there being no own entry, which a cut read cannot establish |
| D-B4 | `noEntry.accountMismatch` counts **rows** with at least one wrong-account entry (found or not), not entries | It is a per-row count like the other four, all "over the rows shown" |
| D-B5 | The archive cutoff is read on every non-empty page, in parallel, not only when a row needs it. A failure is reported as `archive: 'failed'`, but it changes only rows it would decide | One cheap read (≤ 100 `archive_runs` rows) in parallel keeps the builder single-pass; a found or too-recent row is unaffected (tested) |
| D-B6 | `lib/repositories/__tests__/AuditTrailRepository.test.ts` is **unchanged**, and `lib/repositories/index.ts` is **unchanged** | The existing suite already pins `listOwnerEntries`' AI exclusion in the query (AC-B18) and stays green. `AuditTrailRepository` is not exported from the barrel at all, so there is no "AuditTrail block" to extend |
| D-B7 | The slack is **imported** (`LEAK_CHECK_LIMITS.SLACK_MS`), so `aiActivity.ts` now value-imports `creditLeakCheck.ts` | Reuse, as § C planned. `creditLeakCheck.ts` imports `TokenUsageRepository` **types only**; nothing reads `token_usage`, and the AC-B7 source tests stay green. If SA prefers the builder's module graph to stay clear of the leak check, the alternative is a local `60 * 60_000` pinned equal to it by a test — a one-line change |
| D-B8 | Models longer than 64 characters, or not strings, are **dropped**, not truncated; an error code that fails `sanitizeErrorCode` (imported from `aiActionAudit.ts`, the writer's own rule) is `null`; a count that is not a finite non-negative number is `null` and renders "Unknown" | A truncated model id would be a wrong model id. Reusing the writer's sanitiser keeps the reader and writer on one definition of "a code" |
| D-B9 | For a found entry, an empty model list renders "None recorded" and a null error code "None" | Those are real values of a found entry, unlike a missing entry, which renders "Unknown" (FR-B1) |
| D-B10 | An eighth component, `AuditSummaryLine.tsx` | The counts and the read notices are their own block; the page's source guard walks the folder and covers it |
| D-B11 | The scoped `tsc` comparison with `origin/main` was not run on a separate clean export | An export would need the shared `node_modules` junction (a known deletion hazard). Touched files have **0** diagnostics; the only diagnostics (6) are in `lib/analytics/aiAnalytics.ts`, which is byte-identical to `origin/main` and was already in B1a's recorded baseline |

### Guards checked

| Guard | Result |
|---|---|
| Ledger read repository importer list | Unchanged and green: no new file names the repository (`aiActivityDeps.ts` was already listed) |
| `serviceColumn.guard.test.ts` | Unchanged and green: the route is listed, `components/activity/` is walked (so `AuditSummaryLine.tsx` is covered), and no new code reads `.service` |
| `adminReadMethods.guard.test.ts` | Extended: `listAiActionEntriesAllAccountsByGroupIds` in `ADMIN_METHODS` (only caller: the Activity route), `lt` added to the recording client, 14 query-shape tests plus the caller-pin case |
| Page source guard | Unchanged and green over the new component (no `@/lib/` import, no provider or model literal, no `console.*`) |
| Admin authz surface guard | Green; no cap change |
| Credit-lots L8 migration guard | Green (inside `test:bos-entitlements`); no SQL file added |

### Local verification (T15)

| # | Result |
|---|---|
| L-1 Jest | 70 suites / 2,268 tests: **69 pass; 1 fails with 2 tests — `lib/business-os/credits/__tests__/creditPeriod.test.ts`, PRE-EXISTING (CRLF, see the B1a QA report), untouched** (`git diff` empty). New or extended: builder 60/60 (25 new), route 52/52 (5 new), render 387/387 across the page folder (9 new, 1 updated), `adminReadMethods` + `AuditTrailRepository` 53/53 (15 new: 14 query-shape, 1 caller pin) |
| L-2 `typecheck:bos-llm` (**required**) | **Passed: "402 files in scope, 28 errors, 0 new"**. Same unrelated "1 baseline entry is fixed" notice for `app/api/onboarding/build/route.ts`; baseline not edited |
| L-3 scoped `tsc` | Throwaway `tsconfig` over the 15 touched/new TS files plus the wire pin. **Canary** (`const b1bCanary: number = "not a number"` appended to `AuditSummaryLine.tsx`) reported at `AuditSummaryLine.tsx(63,7) TS2322`, exit 2 — the run checks. File restored (`cmp` clean). Real run: **0 diagnostics in any touched file**; 6 in `lib/analytics/aiAnalytics.ts` (untouched, see D-B11). Config deleted |
| L-4 | `npx eslint` on every touched file: 0 errors, 0 warnings. `npm run lint:hooks` (**required**): exit 0 |
| L-5 build | **Not run to completion locally**: this worktree has no `.env.local`, so `next build` stops at page-data collection (B1a's L-5 note). **The PR's Build check is the gate** |
| L-7 `test:bos-entitlements` | 108 suites / 2,578 tests pass |
| Mutation checks | M1 builder treats every entry as own-account (`if (true)`): 3 builder tests red. M2a builder does not lower-case `actionId`: 1 red. M2b repository drops the upper-case variant: 3 red. M3 builder does not treat a cut read as unknown: 1 red. Both files restored; `sha256` before and after identical |
| console.* | 0 in every created, modified or newly imported file (`ArchiveRepository.ts`, `creditLeakCheck.ts`, `aiActionAudit.ts` included). Nothing to convert |

### SA-CR-B / QA fixes (2026-10-04)

Applied after the SA code review (APPROVED, three optional Lows) and QA (PASS WITH NOTES). Still uncommitted.

| Item | Fix |
|---|---|
| QA T-1 | Behavioural boundary test: a charge 14m59s old is `too_recent`; exactly 15m00s and 15m01s are `lost`. The code's intent is "strictly younger than 15 minutes", matching the screen's "under 15 min", and a comment at the branch now says so. QA's **M7** (`>` → `>=`) and **M9** (10-minute floor) were re-run: **both now go red** (1 test each). Restored byte-exact (sha256) |
| SA-CR-B-1 | An unparseable charge `created_at` is now `unknown` with a new reason `charge_time_unreadable` (both wire-type unions extended), never `too_recent`. Test added |
| QA E-B2 | A `models` that is not an array projects to `null` (wire type `string[] \| null` on both sides) and renders "Unknown", not "None recorded". An empty array still renders "None recorded". Builder and render tests added |
| SA-CR-B-2 | `AuditSummaryLine` shows the archive cutoff as a date: "Audit entries from before <YYYY-MM-DD HH:MM UTC> may have been archived…", only when a cutoff exists. Render test covers present and absent |
| SA-CR-B-3 / QA E-B3 | The chip label is the neutral "Audit entry unknown", followed by the reason as **visible** short text (`ENTRY_UNKNOWN_SHORT`: "audit read failed", "audit read cut short", "archive cutoff unreadable", "charge time unreadable"). The full sentence stays as hover text. Render test checks every reason |
| QA E-B1 | Margin added: "may be archived" now means `charge created_at < cutoff + ARCHIVE_CUTOFF_MARGIN_MS`, where the margin reuses `LEAK_CHECK_LIMITS.SLACK_MS` (1 h), the same "entry at or before its charge" slack as the audit read window. The margin only affects rows with **no** entry (a found entry still wins), so the worst case is that a genuinely lost entry within an hour after a cutoff reads "may be archived" rather than "lost". That errs toward not claiming loss, and can only happen within an hour after an archive cutoff (archive runs are manual, about one a quarter). Test: 5 s and 59m59s after the cutoff → may be archived; exactly 1 h → lost. A mutation that removes the margin goes red |

**Re-run results:** builder 64/64; builder, route, render (whole page folder), `adminReadMethods`, `AuditTrailRepository`, service-column guard and admin authz guard: **16 suites / 725 tests pass**. `typecheck:bos-llm`, `lint:hooks`, eslint and `test:bos-entitlements`: `typecheck:bos-llm` passed (402 files, 28 errors, 0 new); `lint:hooks` exit 0; eslint on touched files clean; `test:bos-entitlements` 108 suites / 2,578 tests pass. Scoped `tsc` over the touched files (canary in `ActivityTable.tsx` reported TS2322, then removed): 0 diagnostics in touched files, only the 6 known ones in the unchanged `lib/analytics/aiAnalytics.ts`.

### Owed after deploy

- **P-7**: a recent row's calls, tokens and models match its entry on `/admin/audit-trail`.
- **P-8**: QA records the "lost" count over the rows shown for a recent window and splits it with the two error lines (`aiActionAudit.ts:478-481`, `:585`). A QA note, never a screen feature.

## SA Review Notes

### SA Review — 2026-10-02

**Reviewed by SA — 2026-10-02** (against `main` at `03b62c3c`, the requirement's Gap B re-plan, SA-R1 to SA-R13, SA-RC-1 to SA-RC-17, the SA re-plan re-check, and the live checks in F-21 and F-24. Branch protection was read live via `gh api …/branches/main/protection/required_status_checks`. SA has no database access.)
**Status:** 🔄 **APPROVED WITH CHANGES.** The design is sound, stays inside the requirement's B1 scope, reuses existing infrastructure throughout, and adds no unjustified pattern. Dev applies **SA-B1-1 to SA-B1-9** below. No second SA workplan pass is needed: SA checks them during code review. **The split is approved. Dev implements B1a first.**

#### 1. Verdict on the split (OQ-11)

**Approved: B1a, then B1b**, each on its own branch and PR. It is the right seam. B1a reads only the ledger and touches no audit code. B1b brings the cross-tenant audit join, the `ADMIN_METHODS` caller pin and the archive classification, which is where AC-B5's "never serialised" property lives, and it gets a review of its own. B0′ stays inside B1a, as proposed (T1 and T2). Together B1a and B1b are exactly the requirement's B1 row. Nothing is pulled forward from B2 or B3, and the deep-link landing moving to B3 matches the slicing table, where B3 owns FR-B4's cross-links.

#### 2. Verification of Dev's findings against the tree

| # | SA verdict | Evidence re-read |
|---|---|---|
| **V-6** | ✅ **Dev is right; SA-RC-2 was wrong.** The read repository **has** an importer guard: an exact-equality list inside its own unit test (`'is imported only by the report builder, the leak check (slice 4b), the barrel and tests'`). It walks `app`, `lib`, `components`, `hooks` and `scripts` for the substring `BusinessOsCreditLedgerReadRepository`. SA looked for a separate guard file and missed it. Dev's plan (extend the list **and** the service-column guard) is correct. `aiActivity.ts` (via `Pick<…>`) and `aiActivityDeps.ts` (via the import path) both trip it. The route does not, as long as it imports only from `aiActivity*` | `lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts:437-462`; recording client `:50` (no `not` or `is`) |
| **`:64` vs `:62`** | ✅ **Dev is right.** The file list is `const files = [...]` at **`:64`**. SA's citation of `:62` (in F-25, in the SA Re-plan Review and in SA's own re-check §2 spot-check) is wrong by two lines | `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts:64` |
| **V-14** | ✅ **Holds.** `UUID_PATTERN` is `/…/i`, and chat-v4 passes the client's `x-correlation-id` through unchanged as `groupId` when it is a UUID. The entry stores it as `entity_id` (`text`, case-preserved), while the charge's `group_id` is `uuid` and reads back lower-case. In-repo clients all send `crypto.randomUUID()` (lower-case), so today the exposure is external callers only. **Ruling in OQ-6 below** | `lib/business-os/llm/callCatalog.ts:223-227`; `app/api/business-os/chat-v4/route.ts:391-392`; `aiActionAudit.ts:384`; `supabase/SQL Scripts/create_audit_trail.sql:15` (`entity_id TEXT`), `:9` (`user_id UUID`, so the account side is case-safe) |
| **V-15** | ✅ **Holds.** `created_at: new Date().toISOString()` is stamped when the entry is built inside `log()`, which `runAiAction` calls **before** it awaits the charge (`aiActionAudit.ts:585`, F-20). So an entry is at or just before its charge, give or take server-versus-database clock skew. A one-hour slack on both sides is ample | `lib/services/AuditTrailService.ts:175`; batch defaults `:71-72` |
| **V-9** | ❌ **Does not hold; corrected here.** `Type check (Business OS LLM attribution)` **is a required check on `main`**. The live required set is: Admin authz surface guard, Type check (Business OS LLM attribution), Build (next build), and React hooks rules guard. The workflow file's header comment ("NOT a required check today") is stale. This **strengthens** the plan: the wire-types pin and every file under `lib/business-os/credits/` (plus its direct callers, i.e. the route) are behind a merge gate. See SA-B1-6 | `gh api repos/AgentsPilot/neuronforge/branches/main/protection/required_status_checks` (read 2026-10-02); `.github/workflows/bos-llm-typecheck.yml:2-6` (stale comment) |

**Other citations spot-checked. All hold:** V-1/V-2 (`20261015:1-3` `BEGIN` + `lock_timeout 5s`); V-5 (header `:17-36` still names `listTotalsForPeriodsInRange` as the one cross-account read; `pageTotals` builder with `null` scope reachable only from the named method); V-8; V-10 (`source.guard.test.ts`: walked file list, `@/lib/` ban except `ledgerCheckCopy`, provider-literal and `console.*` rules); V-11 (`page.tsx` `PageTab = 'settings' | 'costs'`, `costsOpened` lazy mount); V-12 (`ADMIN_METHODS` `:271-278`, callers only under `app/api/admin/`); V-16 (`listRuns` `:201`, `getLatestCutoff` `:220-236`, succeeded runs only, with the doc naming the Gap B view); V-17 (report route: `requireAdmin` first, repeated-key 400, strict Zod, 409 platform account, `findNames` injected; `MAX_WINDOW_DAYS: 92`); V-18 (`areaFor` `:59-63`, and `resolveEffectiveFields` refuses a cross-account adjustment, which also nets correctly for deleted accounts because both sides are NULL); V-19 (summary route projection `:87-100`); V-20 (picker imports `@/lib/logger`, which five other admin client pages already import); V-23 (`CAPS` count only exemptions); `aiChargeRecorder.ts:49-52` (`AI_CHARGE_SERVICE`, 1.5 s budget); `LEAK_CHECK_LIMITS.SLACK_MS = HOUR_MS`. The `history.replaceState` approach has an in-repo precedent (`app/admin/analytics/page.tsx:238`), so it is not a new pattern.

#### 3. Checks against CLAUDE.md and the skills

| Check | Result |
|---|---|
| Rule 1: repositories only | ✅ Every read goes through `BusinessOsCreditLedgerReadRepository`, `AuditTrailRepository`, `ArchiveRepository` or `BusinessProfileRepository`. No inline client |
| Rule 2 / NFR-10: Zod first | ✅ Strict schema, required window, 92-day span, `limit` 1–100 and `actionId` refused in B1, all before any read. The repeated-key refusal is copied |
| Rule 3: Pino + correlationId | ✅ `baseLogger.child({ correlationId })`, then `requestLogger` with `adminId`. One `info` line carrying counts only, never a company name. The console audit (§ H) is clean: 0 calls in every touched file |
| Admin gate | ✅ `requireAdmin(baseLogger)` is the first statement. There is no hand-rolled `AdminAccessService`. The authz CI guard needs no change (V-23) |
| `tenant-isolation-guard` | ✅ Read-only, service role, with the RLS bypass documented in the header amendment. The only request-supplied steering value is `accountId`, a validated UUID that an admin is entitled to choose. Every second read is keyed on **server-derived** values: adjustments by the page's action ids, then account-checked by `resolveEffectiveFields`; names by the page's account ids; and (B1b) audit entries by the page's group ids, matched on `actionId` **and** `user_id`, with other accounts' entries discarded before serialisation. No write path exists |
| PGRST123 | ✅ Only filter, order, range and `count: 'exact'`. The one sum (the deleted-account bucket) is in Node, bounded by a ceiling and reported as "at least" |
| `business-os-entitlements` | ✅ Not applicable. Nothing imports `lib/business-os/entitlements/` directly. The type reaches the code transitively through `aiActionAudit.ts`, which is already registered. L-7 as a confirmation run is fine |
| `bos-llm-call-standards` | ✅ Not applicable. No LLM call |
| `durable-queue-drain` | ✅ Not applicable |
| Rule 7: new patterns | ✅ None unjustified. The two-named-methods-over-one-builder pattern follows `pageTotals`; the route copies the report route; client re-declared types plus a wire-types pin follow `costTypes.ts`; the URL tab copies the analytics page; the picker is reused, not rebuilt |
| Scope | ✅ Within the requirement's B1 row. Non-goals match B2 and B3 |
| Test plan: gates vs evidence | ✅ Jest treated as evidence, scoped `tsc` with a canary and an OOM warning (L-3), output pasted. Corrected for V-9 in SA-B1-6 |

#### 4. B0′ — production hand-apply safety

The plan is safe to hand-apply, with the shape change and rollback fix below. Plain `CREATE INDEX` takes a `SHARE` lock, which conflicts with the charge writer's `ROW EXCLUSIVE`. At about 100 rows the build takes milliseconds. With `lock_timeout = '1s'`, the worst case is that charge inserts queue behind it for under 1 s, which is inside the recorder's 1.5 s budget, and a timed-out apply rolls back whole. Both statements share one transaction, so the lock is taken once and held only until `COMMIT`. Rejecting `CONCURRENTLY` is correct: it cannot run in a transaction block and has no precedent in this repo. There is no branch database, so the evidence is the checker run on production after the apply, which is what AC-B16 now asks for.

#### 5. Rulings on OQ-1 to OQ-14

| # | Ruling |
|---|---|
| **OQ-1** | **Yes.** Extend the importer list (T3) **and** the service-column guard (T7). BA corrects F-25 and NFR-4.5 (see § 7). SA's own records stay as written, with this review as the correction |
| **OQ-2** | **`lib/business-os/credits/`**, approved. It is inside a **required** typecheck scope and the service-column scan with no config change |
| **OQ-3** | **Reuse by import, approved.** `@/lib/logger` is client-safe and already in five admin client bundles. The page guard exists to keep server modules and catalogue knowledge out of the browser, and the picker carries neither. Do not move or fork the picker in B1. Conditions: a one-line comment at the import site naming why, and SA-B1-5 (platform account) |
| **OQ-4** | **92 days**, approved (matches the Costs & credits tab; covers the 31-day preset) |
| **OQ-5** | **15 minutes**, approved. Show it on screen; export the constant and pin it in a test |
| **OQ-6** | **Query both canonical cases; do not use `lower()`.** `lower(entity_id)` cannot be expressed as a PostgREST filter without a function or computed column. It would also defeat `idx_audit_trail_entity_id` and need a new expression index on `audit_trail`, a large, script-managed table outside this requirement. Two variants at most 200 ids per `IN` equals the existing `ORIGINALS_PER_REQUEST: 200` precedent. In Node, compare case-normalised (SA-B1-7). The root fix, chat-v4 lower-casing its turn id (one line), is a **separate follow-up for TL to schedule**, not B1. Historical upper-case rows would still need the two-variant query. The mixed-case residue stays visible as "lost" (R-6), never hidden |
| **OQ-7** | **Approved**: `[earliest − SLACK_MS, latest + SLACK_MS)`, 1,000-row cap with `>=` meaning "cut", `unknown` when cut. 1,000 matches the project's PostgREST max-rows that every `PAGE_SIZE: 1000` in the credits module already relies on. If max-rows is ever lowered, this cap must follow it, so say so in the constant's comment |
| **OQ-8** | **Reuse `getLatestCutoff` + `listRuns({ limit: 100 })`**, approved. A new method is not justified at about one run a quarter |
| **OQ-9** | **Export in place**, approved. No move, no behaviour change |
| **OQ-10** | **Approved with a change to index (a)** (SA-B1-1). `lock_timeout = '1s'`, plain `CREATE INDEX`, `IF NOT EXISTS`, filename `20261025_…` and index (b) are approved as written |
| **OQ-11** | **Split approved; B1a first** (§ 1) |
| **OQ-12** | **Landing on `?actionId=` moves to B3**, approved. In B1a the **page** must ignore an unknown `actionId` param. Only the **route** refuses it (strict) |
| **OQ-13** | **Approved.** B1a shows "Priced from a fallback rate — pending reconciliation" and claims **no** direction. Direction arrives with B2/B3 |
| **OQ-14** | **409**, approved (report-route precedent), plus SA-B1-5 so the tab explains it |

#### 6. Required changes (Dev applies; SA verifies at code review)

| # | Slice | Change |
|---|---|---|
| **SA-B1-1** | B1a | **Index (a) becomes `(kind, created_at DESC, id DESC)`, not partial.** PostgREST can send filter values as bound parameters. A generic plan for a prepared statement cannot use an index whose partial predicate (`kind = 'charge'`) needs the parameter's value. Once a plan is cached, the list, count and deleted-bucket reads could stop using the index silently, and a literal-value `EXPLAIN` would never show it. With `kind` leading, the index is used in either case: the equality on `kind`, the range on `created_at` and `ORDER BY created_at DESC, id DESC` are all served, with no sort node, and adjustment rows add negligible size. Index (b) stays partial: `adjusts_action_id IS NOT NULL` is implied by a strict `=`/`= ANY` whatever the parameter's value. Update § A, the shape-decisions table, E1–E6 expectations and the migration test's pins (index (a) is now **not** partial) |
| **SA-B1-2** | B1a | **Checker shape.** (i) Section 1 follows the repo's checker convention (`scripts/check-bos-credit-charges-migration.sql`): `SET default_transaction_read_only = on;` and **one** result set with a PASS/FAIL row per expected index, comparing the exact `indexdef`. The Supabase SQL editor shows only the **last** result set of a multi-statement run. (ii) Each `EXPLAIN` is its own self-contained block (`BEGIN; SET LOCAL enable_seqscan = off; EXPLAIN (ANALYZE, BUFFERS) …; ROLLBACK;`), labelled "run this block alone", with literal values (no `$n`). (iii) Add a **generic-plan** block for E1, E2 and E4: `PREPARE` with parameters, `SET LOCAL plan_cache_mode = force_generic_plan`, `EXPLAIN EXECUTE`. This proves the indexes are usable the way PostgREST runs them. The migration test pins that the checker contains `force_generic_plan` |
| **SA-B1-3** | B1a | **Rollback takes a lock too.** `DROP INDEX` takes `ACCESS EXCLUSIVE` on the table, which blocks charge inserts **and** every read. The rollback script uses `BEGIN; SET LOCAL lock_timeout = '1s'; DROP INDEX IF EXISTS …; COMMIT;`, and the migration test pins the `lock_timeout` in the rollback as well |
| **SA-B1-4** | B1a | **`scripts/check-admin-ai-activity-indexes.sql` is untracked on `main`.** Apply-procedure step 1 depends on it. Commit it in B1a, or fold its query into the new checker as a "before" section and change step 1 to match. Either way, no step may point at a file that is not in the repo |
| **SA-B1-5** | B1a | **Platform account in the picker.** `BusinessAccountPicker` deliberately does **not** hide platform accounts, so an admin can choose one and get the route's 409. `ActivityTab` renders a specific line for `error: 'platform_account'` (from `activityCopy.ts`, pointing at the Costs & credits leak check, where platform figures live per FR-B8). It does not show the generic error. Add a render test |
| **SA-B1-6** | B1a | **Correct the gate list (V-9).** In the Test Plan preamble and L-2/L-4: the CI gates are the **four required checks**: Admin authz surface guard, Type check (Business OS LLM attribution), Build, and React hooks rules guard. `npm run typecheck:bos-llm` (exit 0, no new baseline entries) and `npm run lint:hooks` are therefore **gates**, run locally before the PR. Do not edit the stale workflow comment in this slice. TL logs it as a follow-up |
| **SA-B1-7** | B1b | **Match rules, explicit and tested.** (i) Compare case-normalised: `String(details.actionId).toLowerCase() === charge.action_id` and `entry.user_id === charge.user_id`. (ii) Precedence: an own-account match ⇒ `found`, and any extra wrong-account entry with the same `actionId` is counted in `accountMismatch` without changing the row. `account_mismatch` applies only when **no** own-account entry exists. (iii) Two own-account entries with one `actionId` (impossible by construction): pick deterministically (newest `created_at`, then `id`) and log at `warn` with ids only. Each of (i)–(iii) gets a builder test |
| **SA-B1-8** | B1a | **Initial tab from the URL also opens its lazy panel.** `?tab=costs` or `?tab=activity` must set that panel's "opened" flag on first render, or the hidden-until-chosen panel never mounts. Add a test per tab. Preserve `window.history.state` in `replaceState` as the analytics page does |
| **SA-B1-9** | B1a | **Use the constant, not the literal.** The area resolution calls `areaFor(AI_CHARGE_SERVICE, type)` (`aiChargeRecorder.ts:49`), not `'ai'`, so the list and the report cannot drift if the constant ever changes |

#### 7. Requirement corrections for BA (SA does not edit the requirement)

1. **F-25** — "No importer guard exists on the read repository" is wrong. It has an exact-equality importer list in `lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts:437-462`. Also correct the citation `serviceColumn.guard.test.ts:62` → **`:64`**.
2. **NFR-4.5** — replace "No importer guard exists … so none is extended" with: the read repository's importer list **is extended in the same commit** with every new importer, **and** the service-column guard's file list is extended. Align AC-B15's wording and the BA Response row for SA-RC-2. Leave the SA Re-plan Review's F-25 row, SA-RC-2 and the re-check §2 `:62` spot-check as historical records, with a dated BA note pointing at this SA review as the correction.
3. **NFR-9 (gates versus evidence)** — the `bos-llm` typecheck is a **required** check named "Type check (Business OS LLM attribution)", and its scope includes `lib/business-os/credits/` and its direct callers, not only `lib/business-os/llm/**`. The React hooks rules guard is also required. Update the gate list and the Gap B AC preamble.
4. **"What one row is" → Audit join row (and F-28)** — record that `audit_trail.entity_id` is `text` and preserves the case of a client-supplied chat turn id, while the charge's `group_id` is `uuid`. The join therefore queries both canonical cases, and a mixed-case id is a known residue that reads as "entry lost". Record the chat-v4 lower-casing follow-up in Out of Scope / Future Roadmap.

#### 8. Optimisation suggestions (non-blocking)

- **Count cost at design volume (R-3).** `user_id IS [NOT] NULL` is not in index (a), so the exact count and the deleted-bucket read visit the heap per row. If P-6 latency grows, `INCLUDE (user_id)` on index (a) allows an index-only count. Not now: decide from the evidence.
- **Count once.** In `listChargesOfDeletedAccountsInWindow`, request `count: 'exact'` on the first page only, not on every page of the ceiling walk.
- **Follow-up for TL (not B1):** chat-v4 lower-cases its turn id (one line), and `.github/workflows/bos-llm-typecheck.yml`'s stale "not a required check" comment.

#### 9. Approval

- [x] **Workplan approved with changes.** Dev applies SA-B1-1 to SA-B1-9 (B1a items before B1a code review, SA-B1-7 before B1b code review). No further workplan pass.
- [x] **Split approved. Dev implements B1a first** (T0 to T9); B1b (T10 to T15) starts after B1a merges.
- [x] **B0′ hand-apply** (T2) is safe as amended (SA-B1-1 to SA-B1-4). B1a is not verified until the checker output and Dev's E1–E6 verdict are pasted.
- [x] **Nothing needs the user** beyond the already-agreed hand-apply of B0′ at a quiet hour (D-7).

### SA Code Review — B1a — 2026-10-02

**Code Review by SA — 2026-10-02** (the uncommitted working tree of `feature/admin-ai-activity-b1a` in worktree `neuronforge-ai-activity`, base `03b62c3c`: `git diff` plus every untracked file. Nothing was staged or committed.)
**Status:** 🔄 **APPROVED WITH CHANGES.** The slice does what B1a promised, follows every SA-B1 ruling, and has no security, tenant-isolation or correctness defect. There are three small fixes (SA-CR-1 to SA-CR-3). Dev applies them before QA. SA checks them in the diff at QA hand-off; no second full review is needed.

#### 1. SA-B1 required changes: verified in the code

| # | Verdict | Where |
|---|---|---|
| SA-B1-1 | ✅ Index (a) is `(kind, created_at DESC, id DESC)` and not partial. Index (b) is partial on `adjusts_action_id IS NOT NULL`. Both use `IF NOT EXISTS` inside one transaction with `SET LOCAL lock_timeout = '1s'` | `supabase/migrations/20261025_…:27-38`; test pins `:60-89` |
| SA-B1-2 | ✅ Section 1 is one result set, with a VERDICT row and exact `indexdef` comparison for all six indexes. E1–E6 are each self-contained `BEGIN READ ONLY … ROLLBACK` blocks with literal values. G1/G2/G4 use `force_generic_plan` with `PREPARE`/`DEALLOCATE` | `scripts/check-bos-credit-charges-activity-indexes.sql:25-264` |
| SA-B1-3 | ✅ The rollback sets `lock_timeout` 1s before the first `DROP`, inside one transaction, and the test pins it | `SQL Scripts/20261025_…_rollback.sql:51-59`; test `:123` |
| SA-B1-4 | ✅ `scripts/check-admin-ai-activity-indexes.sql` ships with B1a, and apply step 1 now points at the new checker's section 1 | § A apply procedure |
| SA-B1-5 | ✅ `error: 'platform_account'` shows its own amber line from `activityCopy.ts`, not the generic error, and a render test covers it | `ActivityTab.tsx:103-105`, `:185-197` |
| SA-B1-6 | ✅ The gate list in the Test Plan, L-2 and L-4 now names the four required checks. The workflow comment was left alone, as ruled | Test Plan preamble |
| SA-B1-8 | ✅ The `useState` initialisers open the lazy panel the URL names. `replaceState(window.history.state, …)` keeps the state and the other parameters. There is a test per tab, plus a `history.state` test | `page.tsx` `BusinessOsLlmSettingsContent`; `activityTab.render.test.tsx:410-470` |
| SA-B1-9 | ✅ The code calls `areaFor(AI_CHARGE_SERVICE, …)`, and a source test refuses a literal | `aiActivity.ts:144`; `aiActivity.test.ts` source block |
| OQ-3 condition | ✅ The comment at the import site explains the picker reuse | `ActivityFilters.tsx:17-20` |
| OQ-12 | ✅ The page ignores `actionId`; the route refuses it because the schema is strict | `route.ts:84`; render test "an actionId (B3) is ignored" |

#### 2. Rulings on Dev's deviations

| # | Ruling | Note |
|---|---|---|
| D-1 | ✅ **Accept** | The name follows the shape. The checker, test and rollback all use it consistently |
| D-2 | ✅ **Accept** | `total: null` keeps the rows that were read correctly and still shows no wrong number. The `capped` fallback (`rows.length >= limit`) is honest because its copy says "the total could not be read" |
| D-3 | ✅ **Accept** | An empty list would read as "nothing ran". The 500 message names no internals |
| D-4 | ✅ **Accept** | A conservative choice. The ceiling cannot be reached at 0–1 adjustments per charge and ≤ 100 charges, so it costs nothing in practice |
| D-5 | ✅ **Accept** | Verified: the audit route passes `date_to` to `.lte('created_at', …)` as given (`app/api/admin/audit-trail/route.ts`), `dateFilter` accepts it (`lib/audit/requestSchemas.ts:116-119`), and PostgreSQL reads a zone-less literal in the session zone (UTC on Supabase). The result is a one-minute overlap and no gap. That the audit page's `datetime-local` field displays a UTC value as if it were local is a pre-existing quirk of that page, not of this slice |
| D-6 | ✅ **Accept** | `resolveEffectiveFields` is the one place allowed to read `service` (N-10). For a non-AI row it says "Not declared" instead of claiming an AI area, which is the honest form of the R-8 tripwire |
| D-7 | ✅ **Accept** | P-2 uses it |
| D-8 | ✅ **Accept** | Absent fields keep the two-way wire pin strict. B1b adds them on both sides |
| D-9 | ✅ **Accept** | Verified: `page.render.test.tsx` and `costsTab.render.test.tsx` pass unchanged, and the `?tab=` tests live in the new suite |
| D-10 | ✅ **Accept** | Wider coverage under the "wherever it lives" rule |
| D-11 | ✅ **Accept** | Both are guards named in § B. Counting once is the § 8 optimisation |

#### 3. Security and tenant isolation

| Check | Result |
|---|---|
| Admin gate | ✅ `requireAdmin(baseLogger)` is the first statement after creating the correlation id and logger (`route.ts:112`). There is no `AdminAccessService` call. `admin-authz-surface.guard.test.ts` passes, and route tests prove 401/403 before any read, including 403 rather than 400 for a non-admin sending an invalid query |
| Zod before any read | ✅ Repeated keys are refused, then the strict schema runs: window required, ≤ 92 days, not in the future (+1 day tolerance), `limit` 1–100, `actionId` and unknown keys refused (`route.ts:61-104`, `:118-137`). The repository repeats every guard before it queries (`assertChargeFilter`, `assertListOptions`, `assertActionIds`) |
| Platform account | ✅ The 409 check is pure and runs before any read (`route.ts:142-144`) |
| `tenant-isolation-guard` | ✅ Read-only, with service role. The only steering value from the request is `accountId`, a validated UUID that an admin may choose. Every second read is keyed on **charge-row values**: adjustments by the page's `action_id`s (`aiActivity.ts:304`, `:312`), with each adjustment's account checked against its charge by `resolveEffectiveFields` before netting (`:196`, `effectiveFields.ts:92`); names by the page's `user_id`s (`:305`, `:315`). A refused adjustment is counted, not serialised. The unscoped `ChargeScope` forms are reachable only from the two methods named for them |
| PII in logs | ✅ The route's `info` line carries ids, filters and counts, never a name or a row (`route.ts:162-184`), and a test asserts it with a seeded company name. The builder logs `rowId` and `err` only. The repository logs counts |
| Internal errors to the client | ✅ `AiActivityListReadError` returns a fixed message. Anything else gets `'Internal server error'`, with `details` only in development (`route.ts:187-201`). The 400 text is the schema's own message |

#### 4. CLAUDE.md compliance

| Rule | Result |
|---|---|
| 1 — repositories only | ✅ All reads go through `BusinessOsCreditLedgerReadRepository` (four new methods over one private `chargeQuery`) and `BusinessProfileRepository.findAdminIdentitiesByUserIds`, which the route injects. There is no inline client. The importer list was extended (`…ReadRepository.test.ts:728-731`) |
| 3 — Pino + correlationId | ✅ `logger.child({ correlationId })`, then `{ adminId }`. **No `console.*`** in any created, modified or imported file (re-grepped; the only hits are the guard tests' own regexes). Nothing to convert |
| 5 — no hardcoded model names | ✅ None. No LLM call |
| 6 — strict TS | ✅ No `any` in production code. In tests, `as unknown as SupabaseClient` in the repository test is the established fake-client pattern, and `as unknown as typeof fetch` in render tests is standard. **The builder test's ledger fake is not acceptable as written; see SA-CR-1** |
| 7 — no unjustified new pattern | ✅ Every construct has an in-repo precedent: the named all-accounts method over one builder (`pageTotals`), the route copied from the report route, a client mirror pinned by wire types (`costTypes.ts`), the URL tab via `replaceState` (analytics page), and the reused picker |
| Entitlements | ✅ The diff has no import from `lib/business-os/entitlements/`. `test:bos-entitlements` passes, per Dev |
| Currency | ✅ Not applicable. `cost_usd` is the platform's own measured provider cost and is USD by column definition. Credits are units, not money. No client-currency figure is shown or summed |

#### 5. Correctness

| Area | Result |
|---|---|
| Cut-over clamp | ✅ `Date.UTC(2026, 8, 29, 16, 50, 53, 914)` truncates `.914167` downward, and `.gte` keeps the first row. Entirely-before reads nothing. A straddling window is clamped and says so (`aiActivity.ts:96-97`, `:156-162`). Tests cover the 29th, straddling, before and after |
| Honest count | ✅ The rows and `count: 'exact'` come from the **same** request built by `chargeQuery`, so the count has exactly the rows' filters. A missing count is `null`, never 0 |
| ≤ 100 in the query | ✅ `.range(0, limit - 1)` after asserting 1–100 in both Zod and the repository |
| Adjustment netting | ✅ Integer units through the cost report's `toUnits`, `COST_SCALE` and `CREDIT_SCALE`. The lookup is unwindowed and by id. A read failure or ceiling gives `net: null` on every row, so a gross figure is never shown as net |
| Ceiling (D-4) | ✅ As ruled above |
| Deleted-account bucket | ✅ All-accounts mode only, `.is('user_id', null)`, the exact count is requested on the first page only, and the sum is netted in Node. It is never merged into a row and is labelled "not audit loss". **One wording defect; see SA-CR-2** |
| No `token_usage` | ✅ Source-pinned for the builder, the deps and the route, and `AiActivityDeps` has no usage member |
| PGRST123 | ✅ Only filter, order, range and `count: 'exact'`. No aggregate |
| Dates and time zones | ✅ Presets are pure UTC, including ISO weeks and year roll-back. The date fields are labelled "(UTC)", `formatInstant` is UTC, and `to ≤ today + 1 day` serves admins east of UTC |

#### 6. Migration, rollback and checker: safe to hand-apply on production

✅ The migration is one transaction with `lock_timeout` 1s set before the first statement (below the 1.5 s charge-writer budget). It uses `IF NOT EXISTS`, has no `CONCURRENTLY`, and contains nothing besides the two indexes. The filename avoids `20261016`, and no remote branch carries a `20261025*` file. The rollback has the same lock discipline. The checker is truly read-only: section 1 runs under `default_transaction_read_only`, and every `EXPLAIN` block runs in `BEGIN READ ONLY … ROLLBACK`. `PREPARE` is session-scoped, and the script already says to `DEALLOCATE` if a block fails half-way. The migration test (18 tests) pins all of this.

#### 7. Gates, re-run by SA

| Gate | Result |
|---|---|
| `npm run typecheck:bos-llm` (**required**) | ✅ Exit 0: "369 files in scope, 28 errors, 0 new — passed". It also reports one unrelated baseline entry as fixed (`app/api/onboarding/build/route.ts`). Leave the baseline alone in this PR |
| `npm run lint:hooks` (**required**) | ✅ Exit 0 |
| Admin authz surface guard (**required**) | ✅ `lib/admin/__tests__/admin-authz-surface.guard.test.ts` passes |
| Scoped `tsc` (files outside the gate: page, 7 components, 3 screen modules, render/preset tests, repository + test, barrel, route test, migration test, service-column guard) | ✅ **Canary first**: a planted `const x: number = "x"` was reported (TS2322), so the run really checks. Real run: **0 diagnostics in any touched file**. The 9 diagnostics are in untouched files reached through the barrel (`aiAnalytics.ts`, `MemoryManager.ts`, `CalibrationSessionRepository.ts`), which matches Dev's claim. The scratch config was deleted |
| `eslint` on every touched file | ✅ 0 errors, 0 warnings |
| Jest (evidence) | 34 suites / 965 tests: **33 pass, 1 fails with 2 tests**: `creditPeriod.test.ts`, pre-existing and untouched (no diff against `03b62c3c`). The cause is confirmed: `core.autocrlf=true` checks the file out with CRLF and the guard's regex expects LF. New and extended suites all pass: repository, builder, wire pin, route, render, presets, migration, service-column guard, page source guard, `adminReadMethods`, `page.render`, `costsTab.render` |
| Build (**required**) | ⚠️ **Not confirmed locally.** It compiled and emitted both new bundles, then stopped at page-data collection for an untouched route because this worktree has no `.env.local`. **The PR must show the CI Build check green before merge**, and RM should say so in the PR body |

#### 8. Code review comments (SA-CR-n, for Dev)

| # | File:line | Issue | Priority |
|---|---|---|---|
| **SA-CR-1** | `lib/business-os/credits/__tests__/aiActivity.test.ts:96-124` (and `:271`) | **The ledger fake defeats the type check it runs under.** Three fakes are `jest.fn<Promise<unknown>, unknown[]>` and the whole object is cast with `ledger as unknown as AiActivityDeps['ledger']`. This file is compiled by the **required** `typecheck:bos-llm` gate, but with this cast a change to a repository return shape (for example renaming `total` or `reachedCeiling`) still compiles and the builder tests keep passing against a stale shape. Type the fakes against the real signatures instead: for example `jest.fn<ReturnType<AiActivityDeps['ledger']['listChargesAllAccountsInWindow']>, Parameters<…>>`, or a `jest.Mocked<AiActivityDeps['ledger']>`, with fixtures typed `RepositoryResult<ChargeListPage>` and so on. Then drop the `as unknown as` cast at `:124` and the `mock.calls` cast at `:271`. Run `typecheck:bos-llm` afterwards | **Medium** |
| **SA-CR-2** | `app/admin/business-os-llm/components/activity/DeletedAccountsBucket.tsx:33-34` | **"at least" is also printed before the count, but the count is exact.** The requirement (Gap B "Charges whose account was deleted") says "Its count is `count: 'exact'`" and that the **total** shows "at least" at the ceiling. The repository returns the exact count even when the row read is cut (`total` from page 1). Print the count plainly and keep the prefix on the USD and credit sums only. Adjust the render test "says 'at least' when the read stopped at its ceiling" so it asserts both halves | **Low** |
| **SA-CR-3** | `app/api/admin/business-os/ai-activity/route.ts:176`; `lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts:728` | **Two comments are now untrue.** (a) The route cites "(D-6)", which was copied from the report route, where it meant the report's D-6. In this workplan D-6 is the area-resolution deviation. Remove the reference or name the source. (b) The importer list says `aiActivity.ts` imports "types only, via Pick<…>", but it also imports the **value** `CHARGE_LIST_LIMITS` (`aiActivity.ts:47-52`). This has no runtime effect, since `creditReport.ts` already loads the module. Correct the comment | **Low** |

#### 9. Optimisation suggestions (non-blocking)

- **Checker and migration in one SQL-editor session.** Section 1 sets `default_transaction_read_only` for the **session**. If the editor reuses that connection, the migration run next (apply step 2) fails harmlessly with "read-only transaction". This precedent is shared by every repo checker. Consider one line in apply step 3: "if it reports a read-only transaction, open a new editor tab (or run `SET default_transaction_read_only = off;`) and re-run".
- `capped` compares `total` with the rows **kept**. A row skipped by the invariant check (`aiActivity.ts:293-296`) would make `capped` true by one. It cannot happen under the CHECK constraints and is logged at `warn`. No change needed.

#### 10. Approval

- [x] **Code approved with changes.** Dev applies SA-CR-1 (Medium), SA-CR-2 and SA-CR-3 (Low) and re-runs `typecheck:bos-llm` and the builder and render suites. SA checks the three in the diff at QA hand-off; no further full review.
- [ ] **Code Approved for QA:** **Yes, once SA-CR-1 to SA-CR-3 are in.** QA owns L-6 (`schema:check` plus the column check against the `20261015` body) and L-8 (the manual and keyboard pass).
- **Before merge:** the CI Build check must be green (§ 7). SA recommends that the user hand-apply B0′ (T2) and that its checker evidence is pasted **before** the PR merges, so `main` never carries a migration production does not have. The code is correct without the indexes, so this is about ordering, not a blocker on correctness.

### SA Code Review — B1b — 2026-10-04

**Reviewed by SA — 2026-10-04.** Worktree `neuronforge-ai-activity`, branch `feature/admin-ai-activity-b1b`, base `8c8b5d08`. Reviewed `git diff` (15 files) plus the untracked `AuditSummaryLine.tsx`. Nothing staged or committed; no database access.
**Status:** ✅ **Code Approved.** No required changes. Three Low, optional items below; none blocks QA.

#### 1. SA-B1-7 and OQ-5 to OQ-8, as ruled

| Ruling | Verdict | Evidence |
|---|---|---|
| SA-B1-7 (i) case-normalised match on `actionId` AND `user_id` | ✅ | `aiActivity.ts` `joinAuditEntries`: only a string `actionId`, lower-cased, looked up among the page's own action ids; `user_id` compared exactly. Test "(i)…", mutation M2a |
| SA-B1-7 (ii) own entry ⇒ `found`; foreign only counts; `account_mismatch` only without an own entry | ✅ | Own and foreign kept apart; foreign is a counter, never projected. Two "(ii)" tests, two AC-B5 builder tests, route AC-B5 test (response body checked, not just the builder) |
| SA-B1-7 (iii) deterministic duplicate, `warn` with ids only | ✅ | `newestEntry` (newest `created_at`, then higher id; a NaN time falls through to the id). The warn carries `actionId` + `entryIds` only. Tested in both tie orders |
| OQ-5 15 minutes, on screen, pinned | ✅ | `AUDIT_SETTLE_MS: 15 * 60_000`, sent as `settleMinutes`, rendered in the chip and the settle note; pinned by "the settle window is 15 minutes" |
| OQ-6 both canonical cases, never `lower()`, ≤ 200 ids | ✅ | Repository `variants` = lower + upper, `Set`-deduplicated, `MAX_GROUP_IDS: 100` guarded before the query; the Node side lower-cases. Tests for an upper-case input and the 100 cap |
| OQ-7 `[earliest − 1 h, latest + 1 h)`, 1,000 cap, `>=` is cut, `unknown` when cut | ✅ | `.gte(start).lt(end)`, `.limit(1000)`, `reachedLimit = rows >= 1000`; the cap's comment ties it to PostgREST max-rows as ruled. Cut read: own entries still `found`, everything else `unknown (audit_read_incomplete)` |
| OQ-8 `getLatestCutoff('audit_trail')` + `listRuns({ limit: 100 })`, `source = 'audit_trail'`, `rows_archived > 0` | ✅ | `readArchiveCutoff`; `Number(rows_archived) > 0` handles the `number \| string` column type. Partial-run, zero-row-run and failure cases tested. An unparseable cutoff fails closed to `archive: 'failed'` |

**Precedence** (no own entry): read failed → cut → foreign → too recent → archive unreadable → before cutoff → lost. Matches § D step 8; "lost" is reached only on complete evidence. **Projection**: field by field, never a spread of `details`; `callNames`, `estimatedCostUsd`, `area`, `correlationId` are not sent. The AC-B13 test asserts that prompt, owner text, output, error message and email never reach the payload.

#### 2. Deviation rulings

| # | Ruling |
|---|---|
| D-B1 | ✅ Accepted. Required `entry` and required-nullable `audit` keep the two-way wire pin strict, as D-8 did for B1a |
| D-B2 | ✅ Accepted. Three named reasons are the right granularity. One visible label with the reason as hover text is fine, because the summary line also names a failed or cut read and an unreadable cutoff in text |
| D-B3 | ✅ **Accepted — decision below** |
| D-B4 | ✅ Accepted. Per-row is consistent with the other four counts and the "over the rows shown" label |
| D-B5 | ✅ Accepted. One bounded read in parallel; a found or too-recent row is provably unaffected (tested) |
| D-B6 | ✅ Accepted. Verified: `lib/repositories/index.ts` has no `AuditTrail` export; the existing `listOwnerEntries` exclusion tests stand (AC-B15's "still excludes AI entries" holds) |
| D-B7 | ✅ **Accepted — decision below** |
| D-B8 | ✅ Accepted. Drop-not-truncate is correct for model ids; reusing the writer's `sanitizeErrorCode` (`aiActionAudit.ts:286`) keeps one definition of "a code"; malformed counts are `null` and render "Unknown", never 0 |
| D-B9 | ✅ Accepted. "None recorded" / "None" are true values of a found entry; "Unknown" is reserved for no entry or an unreadable field (FR-B1) |
| D-B10 | ✅ Accepted. `AuditSummaryLine.tsx` has no `@/lib/` import, no `console.*`, no provider or model literal; covered by the page source guard and the `serviceColumn` folder walk |
| D-B11 | ✅ Accepted. SA re-ran the scoped `tsc` independently (§ 5): the same 6 diagnostics, all in untouched `lib/analytics/aiAnalytics.ts` |

**Decision on D-B7: keep the import of `LEAK_CHECK_LIMITS.SLACK_MS`.** It is what § C planned and SA approved. The module-graph cost is nil: `creditLeakCheck.ts` imports `TokenUsageRepository` as **types only**, and its value imports (`callCatalog`, `aiChargeRecorder`, `effectiveFields`, the logger) are already in the builder's graph. The coupling is already pinned: the builder test "is keyed on … [earliest − 1 h, latest + 1 h)" asserts the literal one-hour bounds, so a future change to the leak check's slack turns that test red instead of silently moving this window. A local constant would buy nothing the test does not already give.

**Decision on D-B3: a cut read shows `unknown`, not `account_mismatch`.** Correct, and the only reading consistent with SA-B1-7 (ii): `account_mismatch` asserts the absence of an own-account entry, which a truncated read cannot establish. The defect is not hidden: the row still adds to `noEntry.accountMismatch`, the builder logs the defect marker at `warn`, and the summary line names the cut read.

#### 3. Tenant isolation (`tenant-isolation-guard`)

| Check | Result |
|---|---|
| Keys come from the server, never the request | ✅ Group ids are taken from the page's charge rows (`group_id` is `NOT NULL` on a charge by `charge_shape`, `20261015:34`), lower-cased, distinct. The route passes no query value to the read. Route test "never request values" |
| Matched server-side on `actionId` + account | ✅ § 1 |
| Other accounts' entries never serialised | ✅ Checked at the **type** level (`AiActivityEntryState` has no slot for a foreign entry; `account_mismatch` carries no field), in the builder (a foreign entry is a counter only), and in the **route response** (the route AC-B5 test inspects the JSON body) |
| No severity filter | ✅ `.eq('entity_type')` + `.in('action', [COMPLETED, FAILED])` only; the repository test asserts there is no severity filter |
| Column allow-list | ✅ `ADMIN_AI_ACTION_ENTRY_COLUMNS = 'id, user_id, created_at, entity_id, details'`: no `hash`, `user_email`, `ip_address`, `user_agent`; tested |
| Admin pin | ✅ Added to `ADMIN_METHODS`; the only caller is `app/api/admin/business-os/ai-activity/route.ts`. The builder imports the repository's **types only** and receives the method by injection. The method requires the admin context `{ correlationId, adminId: gate.user.id }` |
| `requireAdmin` first | ✅ Unchanged from B1a (`route.ts:140`, preceded only by the correlation-id lines); the authz surface guard passes with no cap change |
| Logs | ✅ Repository `info`: counts, correlationId and adminId only. Builder: ids and counts only. Route log line: `audit.status`, `archive` and the `noEntry` counts; no entry, no business name. Error responses unchanged and sanitised (`NODE_ENV === 'development'` guard) |

#### 4. CLAUDE.md and the repository header

- Repositories only ✅ (`AuditTrailRepository`; `ArchiveRepository` reused unchanged). Pino with correlationId ✅. `console.*`: 0 in every touched, new or newly imported file ✅. Strict TS ✅. The one `as unknown as AdminAiActionEntryRow[]` is in the repository, on the Supabase result, the same idiom as the two sibling methods (`:222`, `:256`); it is not a test signature cast. **No** `as unknown as` / `as never` / `any` was added in any test ✅. No new pattern: injecting an admin-pinned read is the B1a `findNames` precedent ✅.
- **The header's "third exception" paragraph is accurate.** It is the third admin method, after `listAdminAiFailures` (account-scoped) and `countAdminEventsAllAccountsInWindow` (unscoped, but `head: true`, so no rows). "The first unscoped read of entry content" is therefore literally true. The reworded closing paragraph ("the OWNER read … excludes them IN THE QUERY … Only the admin exceptions above read them") is true. NFR-4.4 and AC-B15's header-amendment clause are met.

#### 5. Gates (re-run by SA, 2026-10-04)

| Gate | Result |
|---|---|
| `npm run typecheck:bos-llm` (**required**) | **Passed**: "402 files in scope, 28 errors, 0 new". Same unrelated "1 baseline entry is fixed" notice (`app/api/onboarding/build/route.ts`) |
| `npm run lint:hooks` (**required**) | **Exit 0**, 0 warnings |
| `npm run test:authz-guard` (**required**, Admin authz surface guard) | 1 suite / 119 tests pass |
| `npm run test:bos-entitlements` | 108 suites / 2,578 tests pass |
| Relevant Jest: `lib/business-os/credits`, the route, `app/admin/business-os-llm`, `adminReadMethods.guard`, `AuditTrailRepository`, `ArchiveRepository` | 42 suites / 1,206 tests: 41 suites pass. **1 fails with 2 tests: `creditPeriod.test.ts`, pre-existing (CRLF, recorded in the B1a QA report); `git diff` on it and on `creditPeriod.ts` is empty** |
| Scoped `tsc` (SA's own throwaway config in the session scratchpad, not in the repo; `--listFilesOnly` confirms the touched files, `AuditSummaryLine.tsx` included, are root files; `strict: true` inherited) | 6 diagnostics, all in untouched `lib/analytics/aiAnalytics.ts`; **0 in any touched or new file** |
| Build (**required**) | Not runnable locally (no `.env.local`); the PR's Build check is the gate. The icons used (`FileQuestionMark`, `FileX`, `ShieldAlert`, `Archive`, `Clock`, `FileSearch`) exist in the installed `lucide-react@0.525.0`, and `Chip` accepts `title` |

#### 6. Code Review Comments (all Low and optional; not conditions of approval)

| # | Where | Comment | Priority |
|---|---|---|---|
| **SA-CR-B-1** | `lib/business-os/credits/aiActivity.ts`, `joinAuditEntries`, the `!Number.isFinite(createdMs) \|\| createdMs > settleFloorMs` branch | A charge whose `created_at` cannot be parsed is classed `too_recent`. That is a claim made on unreadable evidence; `unknown` would follow the file's own rule. Unreachable in practice (`timestamptz`), so no test is owed. Either change it, or add a one-line comment saying why `too_recent` is acceptable | Low |
| **SA-CR-B-2** | `archiveCutoff` on the audit summary (`aiActivityTypes.ts`, `activityTypes.ts:77`); `AuditSummaryLine.tsx` | `archiveCutoff` is sent but not rendered. Showing it ("may be archived" = older than a date) would let the operator read the class without a second screen; otherwise it is an unused wire field. Either render it in the summary line or note that it is reserved | Low |
| **SA-CR-B-3** | `activityCopy.ts`, `MARKER_ENTRY_UNKNOWN` | "read incomplete" reads slightly off for `archive_unread`: the entry read was complete, the cutoff read failed. The hover text is correct. A neutral "Audit entry unknown" fits all three reasons | Low |

#### 7. Observations (no action)

- **The insight cron's shared group id** (requirement evidence: `insight-detect/route.ts:143, 217`): one `runId` is the group id for every business in a run, so an insight row's group fetches one entry per business per insight action. Correctness holds: the match is on `actionId` + account, other businesses' entries are dropped, and they do not count as mismatches because their `actionId` differs. If a run ever puts more than ~1,000 entries in the window, the read is reported as cut and undecided rows show `unknown`, never `lost`: the intended fail-closed path. Worth one line in QA's P-8 note if insight rows dominate the "unknown" count.
- The archive notice can appear on a page where every row is `found` (D-B5). Harmless and truthful.

#### 8. Approval

- [x] **Code Approved for QA: Yes.** SA-CR-B-1 to SA-CR-B-3 are optional. If Dev applies any of them, re-run the builder and render suites and `typecheck:bos-llm`; no further SA pass is needed.
- **QA owns:** P-7 and P-8 after deploy, the keyboard and no-colour pass over the five new chips (AC-B17), and a check that the summary's "over the N rows shown" equals the rows on the page.
- **Before merge:** Build, Type check (Business OS LLM attribution), React hooks rules guard and Admin authz surface guard green, and Business OS entitlements invariants green too (it bit B1a).

---

## QA Testing Report

### QA Report — B1a — 2026-10-02

**QA — 2026-10-02** (worktree `neuronforge-ai-activity`, branch `feature/admin-ai-activity-b1a`, uncommitted, base `03b62c3c`)
**Tree tested:** Dev's B1a tree **before** SA-CR-1 to SA-CR-3. SA's code review ran in parallel and landed while QA was running. None of the three changes production behaviour except SA-CR-2 (copy only). After Dev applies them, re-run the builder and render suites and `typecheck:bos-llm`.
**Test mode:** full
**Strategy used:** A (unit: builder, presets, repository with a recording client) + B (route integration with mocked auth and ledger) + mutation checks + throwaway edge-case probes (deleted afterwards). D (manual browser check) was not possible from an agent session: there is no admin sign-in and no `.env.local` in the worktree. It is handed to the user as the post-deploy click-through below.
**Focus:** api, ui, schema, security
**Skipped:** L-6 `npm run schema:check`, because it reads the **live** schema and QA was told not to touch any database. Instead, every column the new reads filter or order on (`kind`, `created_at`, `id`, `user_id`, `action_type`, `outcome`, `triggered_by`, `cost_usd`, `adjusts_action_id`) was checked against the body of `20261015_business_os_credit_charges.sql`, and all are present. The selected columns are the unchanged `CREDIT_LEDGER_ROW_COLUMNS`, already read in production by the report. L-5 build was not re-run: Dev's run compiled, and the PR's Build check is the gate. AC-B16 waits on the user's B0′ hand-apply.
**Input source:** prompt (TL brief) + the workplan's Test Plan and Verification Plan

**Verdict: PASS WITH NOTES.** No bugs. Edge E-1 is the same finding as SA-CR-2, found independently. B1a is not *verified* until T2 (B0′ evidence) and the post-deploy click-through are recorded.

#### Test Coverage

| AC (B1a part) | Tested? | Result | Proving test(s) / notes |
|---|---|---|---|
| AC-B1: one row per `action_id`, adjustments netted, "Cost (USD)" | ✅ | Pass | `aiActivity.test.ts` "two charges and one correction give two rows…"; render "labels the cost column…". Probe: 1e-10 USD charge with a -1e-10 correction nets to exactly 0; 123456.1234567891 nets exactly |
| AC-B3: filters narrow and combine; presets; cost sort | ✅ | Pass | Repository "applies every filter, together, to the same query that is counted" + per-filter `it.each`; builder area → action types, and an empty area makes no query; route "every filter reaches the read", `sort=cost` → `cost_usd`; `activityPresets.test.ts` (Sunday, Monday, 1st, 1 Jan, leap Feb, UTC day boundary) |
| AC-B5 (list half): shared `group_id`, each row its own account | ✅ | Pass | Builder "all-accounts mode gives each charge its own account" and "choosing an account uses the account-scoped read"; repository `.eq('user_id', …)` |
| AC-B7 (list half): no `token_usage` read | ✅ | Pass | Source test over `aiActivity.ts`, `aiActivityDeps.ts` and the route, with a planted-violation check; the deps type has no usage member |
| AC-B8: read-only; one info log with admin, correlation id and filters; no business name | ✅ | Pass | Route "logs one info line … and no business name". No write verb anywhere in the diff (reviewed) |
| AC-B9 (deleted part): own bucket, exact count, netted, "at least", never merged | ✅ | Pass, edge E-1 | Builder bucket tests. Repository `.is('user_id', null)`, count on the first page only (the probe saw `{count:'exact'}` then `undefined`). Render: "at least", "not audit loss", absent in single-account mode. **M-6 red** |
| AC-B11: ≤100 rows, cap in the query, >100 refused, honest filtered count, null count shows none | ✅ | Pass | Repository `range(0, 99)` and a same-query count (`queries.length === 1`); limit 0, 1.5 and 101 refused before any query; route 400s; builder `capped` and null count; render count lines. **M-1, M-2, M-7 red** |
| AC-B13 (B1a part): no business name in logs | ✅ | Pass | Same route log test as AC-B8. The entry-detail half is B1b |
| AC-B14: 401, 403, 403-not-400, missing window, >92 days, limit >100, `actionId` 400, repeated key, 409, prod 500 without details, `requireAdmin` first | ✅ | Pass | `route.test.ts` (37 tests). **M-4, M-5 red**. Probe: 92 days gives 200, 93 days gives 400 |
| AC-B15 (B1a part): named methods over one builder, header amended, no `service` filter, guards extended | ✅ | Pass | Repository tests (`not`, `is`, `in('action_type')`); importer list extended; service-column guard green over the new files |
| AC-B16: indexes and `EXPLAIN` evidence | ⚠️ | Pending (user, T2) | Migration test 18/18. QA read the migration, rollback and checker: two `CREATE INDEX IF NOT EXISTS` with `lock_timeout 1s`, and no write in the checker. The live evidence is owed by the user |
| AC-B17 (B1a states): text not colour; labelled controls; `aria-pressed` | ✅ / ⚠️ | Pass (jsdom) | Render "every state renders as TEXT" and "every control has an accessible name…". The keyboard pass is manual (click-through item 9) |
| AC-B18: no owner surface changed | ✅ | Pass | The diff touches only `app/admin/business-os-llm/**`, `app/api/admin/business-os/ai-activity/**`, `lib/business-os/credits/**`, the read repository and its barrel. `AuditTrailRepository.test.ts` is green |
| AC-B19: later-period adjustment nets; never its own row; cost sort by gross | ✅ | Pass | Builder "looks corrections up … unwindowed"; repository `listAdjustmentsForActionIds` has no `created_at` filter; a cross-account adjustment is not netted |
| AC-B20: cut-over line and links; entirely-before shows the line, not the table; no pre-cut-over row | ✅ | Pass | Builder clamp tests and render tests. **M-3a, M-3b red**. Probe: `2026-09-01..09-28` gives `entirely_before_cutover` with zero reads; `09-01..09-30` starts the read at `2026-09-29T16:50:53.914Z` |

**AC coverage gaps:** none in B1a's scope is without a real test. Only AC-B16 (live evidence) and the keyboard half of AC-B17 are open, both manual by design. SA-CR-1 is a test-strength gap: the builder's ledger fakes are cast through `unknown`, so a change to a repository return shape would not turn the builder tests red. QA concurs with SA that it should be fixed.

#### Mutation checks (each mutation applied alone, then restored)

| # | Mutation | Result |
|---|---|---|
| M-1 | Repository `.range(0, opts.limit - 1)` → `.range(0, 999)` (cap removed from the query) | 🔴 2 repository tests red |
| M-2 | Repository page query built without `count: 'exact'` | 🔴 2 repository tests red |
| M-3a | Builder: straddling window not clamped (`readFrom: start`) | 🔴 "a window straddling it is clamped to the floor" red |
| M-3b | Builder: the entirely-before test moved one day earlier | 🔴 "a window entirely before it reads nothing" red |
| M-4 | Route: platform-account 409 disabled | 🔴 the 409 test red |
| M-5 | Route: a query-string check injected **above** `requireAdmin` | 🔴 the route's own "requireAdmin is the first statement" source test went red. **The required CI `Admin authz surface guard` stayed GREEN**: it proves the gate is present, not that it comes first (known OI-20). For this route, only its Jest test enforces first-ness, and no CI job runs Jest |
| M-6 | Builder: deleted bucket `atLeast` forced to `false` | 🔴 1 builder test red |
| M-7 | Builder: `capped` forced to `false` | 🔴 2 builder tests red |

**Restoration:** every file was restored from a byte copy and checked with `cmp`. At the end, the `sha256` of `git diff` and of the two untracked files matched the hashes taken before the first mutation.

#### Edge-case probes (throwaway Jest files, deleted)

| Case | Result |
|---|---|
| Window 92 / 93 / 1 days | 200 / 400 "at most 92 days" / 200 |
| Entirely before the cut-over; straddling it | 200 `entirely_before_cutover` with no read at all; 200 clamped to the `.914Z` floor |
| `limit` 1 / 100 / `001` / 0 / 101 / empty / 1.5 / -1 | 200 (1) / 200 (100) / 200 (1) / 400 / 400 / 400 / 400 / 400 |
| Repeated key (`from` twice); case-variant key `Sort` | 400 "Each query parameter may appear once"; 400 unrecognised key |
| `accountId` with bad hex, or in braces; upper-case UUID | 400, 400; 200 (a Postgres `uuid` comparison ignores case; `isPlatformAccount` lower-cases) |
| `actionId` present | 400 (strict schema). The page ignores it (render test) |
| Empty result | `rows: []`, `total: 0`, `capped: false`, no adjustment or name read |
| Row with two adjustments (one zero) | netted exactly, `adjustmentCount: 2`, `corrected: true` |
| Null count from PostgREST | list `total: null`, so a full page reads as capped; bucket `count: null` with `status: 'ok'` (renders "—") |
| Deleted bucket at 1,999 / 2,000 / 2,001 / 5,000 rows (real repository, fake client) | `reachedCeiling` false / **true** / true / true; the exact `total` is right in every case; 2 page reads, count only on the first. See E-1 |
| Preset timezone | `activityPresets.ts` uses only `Date.UTC` / `getUTC*`; a grep found no local getters. The suite passes on this machine at UTC+3. Node on Windows ignores `TZ=`, so other zones were checked by reading the code, not by running it. Inputs are labelled "(UTC)", and `formatInstant` prints UTC |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none found locally. The real check is P-6 latency after B0′ is applied (R-3).

**Edge cases (nice to fix, all Low):**
1. **E-1: "at least" also prefixes the exact count (same as SA-CR-2).** `DeletedAccountsBucket.tsx:26`, `:33-35` apply the prefix to the count, the USD sum and the credits, but `count` is `count: 'exact'`. Also, `reachedCeiling` uses `>=` (`BusinessOsCreditLedgerReadRepository.ts:730`, surfaced as `atLeast` at `aiActivity.ts:448`), so with **exactly** 2,000 deleted rows the bucket says "at least" even though every row was summed. Repro: a deleted bucket with 2,000 matching rows → "at least 2,000 actions, at least $X, at least Y credits". Expected: a plain count, with "at least" only on the sums, and ideally only when `total > rows read`. Nothing is visible today, because F-21 says the bucket is empty.
2. **E-2: minimum-cost error copy.** `route.ts:73` answers `.5`, `1000000`, `$5` and `0,5` all with "minCostUsd must be a dollar amount with at most 10 decimals". The tab shows that text as it is: it names an API parameter, and gives the wrong reason for too many integer digits. Cosmetic.
3. **E-3: UTC presets for an admin east of UTC.** Between 00:00 and 03:00 Israel time, "Today" is the admin's local yesterday, and on the 1st "This month" is the previous month. This is the intended, labelled design (`activityPresets.ts` header; "Times are UTC"). It is recorded so the click-through does not report it as a bug.
4. **E-4: integer-unit headroom.** `toUnits` × 1e10 passes `Number.MAX_SAFE_INTEGER` above about $900,719 in one sum. This is the reused `creditReport.ts` helper, and per-action costs are cents. No action.

**Process note:** M-5 shows that the required authz CI guard does not catch a statement placed before `requireAdmin`. Only this route's Jest source test does, and Jest is not in CI. OI-20 already tracks this; recorded here as evidence.

#### Test Outputs / Logs

```text
L-1  npx jest <L-1 paths>                       Test Suites: 1 failed, 56 passed, 57 total
                                                 Tests:       2 failed, 1572 passed, 1574 total
     only failure: lib/business-os/credits/__tests__/creditPeriod.test.ts (2 tests, source guard)
L-2  npm run typecheck:bos-llm                   369 files in scope, 28 errors, 0 new — passed (exit 0)
                                                 (1 baseline entry fixed: app/api/onboarding/build/route.ts, unrelated)
L-4  npm run lint:hooks                          exit 0
```

**`creditPeriod.test.ts` is pre-existing and environmental, not caused by B1a.**
- `git diff --stat 03b62c3c` on the test and its subject is empty.
- The worktree's `creditPeriod.ts` equals `git show 03b62c3c:…` byte for byte once `\r` is stripped (`cmp` clean).
- The `withoutDisplayMaths` regex (`\n}\n`) strips the display maths from the LF blob that `main` stores, but not from the CRLF copy that `core.autocrlf=true` checks out on Windows.
- So the test is red on any Windows checkout of clean `main`, and green on LF checkouts (CI/Linux).

#### Manual post-deploy click-through (critical path, user, after B0′ is applied and B1a deploys)

1. Signed in as an admin, open `/admin/business-os-llm?tab=activity`. The Activity tab is selected and the list loads without clicking the tab. Reload: `?tab=activity` stays. (P-1)
2. As a non-admin, or signed out, open the same URL: the layout redirects you. `GET /api/admin/business-os/ai-activity?from=2026-10-01&to=2026-10-02` answers 401 or 403. (P-1)
3. Default "This month": the count line's N equals a read-only count of `kind = 'charge'` rows since 1 October UTC, and rows are newest first. (P-2)
4. "Last month": the blue cut-over line appears and both links open (`/admin/audit-trail?entity_type=ai_action&date_to=2026-09-29T16:51` and `/admin/analytics?scope=bos`). No row is earlier than 2026-09-29 16:50 UTC. (P-3)
5. Explicit window 2026-09-01 → 2026-09-28, then Apply: the "entirely before" line shows **instead of** a table or a "no results" box.
6. "Most expensive first": the first row has the highest `cost_usd` in the window. With more than 100 rows, the line reads "Showing the top 100 of N … most expensive first". (P-4)
7. Pick one business: every row shows that business, the deleted-account line disappears, and the cut-over links gain `user_id=` / `user=`. Pick the platform account, if the picker lists it: the amber platform-account explanation shows, not a red error. (P-4, SA-B1-5)
8. Area, Outcome, Trigger and a minimum cost (for example `0.001`, then Apply) each narrow the list and the count together. An invalid minimum cost (`abc`) shows an error and clears the table.
9. Keyboard only: Tab through the presets, From/To, minimum cost, Apply, the picker, the three selects, the sort buttons and refresh. Each one is reachable and named, and Enter or Space activates it. (AC-B17)
10. The deleted-account line reads 0. (F-21, P-5)
11. In the Vercel logs, record `durationMs` from the "Admin read the Business OS AI activity" line for "This month", and confirm the line has no company name. (P-6, AC-B8)

#### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] **PASS WITH NOTES.** No bug blocks the commit. Dev applies SA-CR-1 to SA-CR-3 (SA-CR-2 also closes E-1; E-2 is optional). After that, re-run the builder and render suites and `typecheck:bos-llm`. AC-B16 (T2) and the click-through above are owed by the user before B1a counts as verified.

### QA Report — B1b — 2026-10-04

**QA — 2026-10-04**, worktree `neuronforge-ai-activity`, branch `feature/admin-ai-activity-b1b` (uncommitted, base `8c8b5d08`). Tested the tree as SA approved it (SA-CR-B-1 to SA-CR-B-3 not applied).
**Test mode:** full
**Strategy used:** A (Jest unit: builder, projection, render) + B (route integration with mocked repositories; repository query shape with a recording client) + throwaway edge probes + mutation checks. D (browser) is owed after deploy — see the checklist below.
**Focus:** api, security, schema, ui
**Skipped:** live database reads (forbidden in this pass); `next build` (no `.env.local` in the worktree — the PR's Build check is the gate, as for B1a)
**Input source:** prompt (TL) + QA judgment

#### Test Coverage

| Acceptance criterion (B1b part) | Tested? | Result | Proving tests / notes |
|---|---|---|---|
| **Audit-join row** (FR-B1: entry joined by `actionId` + account, both case forms, entry columns) | ✅ | Pass | Builder: "is keyed on the page grouping ids…", "(i) compares the actionId lower-cased", "an entry on the right account is found, projected field by field". Repository: `adminReadMethods.guard.test.ts` query shape (`entity_type`, both actions, `in('entity_id', [lower, upper])`, `gte`/`lt`, order, limit 1000, no `user_id`, no `severity`), 100 ids → 200 values. Render: "a found entry fills the four columns" |
| **AC-B5** (audit half): another account's entry is never serialised | ✅ | Pass | Builder "(ii)…never sent", "(ii) only another account…account_mismatch", "AC-B5: two accounts sharing one group…", "AC-B5: two charged actions of one account…". Route "AC-B5: …never reaches the response" asserts the other account's markers **and its account id** are absent from the HTTP body. Dev mutation M1 went red |
| **AC-B6** (Q1 half): too recent / may be archived / lost; unknown on incomplete evidence | ✅ | Pass, with a test gap | Builder `describe('B1b / AC-B6…')` (9 tests) covers each class, partial runs, runs that moved nothing, failed / cut / thrown reads, archive unreadable. **Gap T-1:** the 15-minute boundary is pinned only as a constant; classification is tested at 5 min vs 20 min, so a floor anywhere between them passes (M9 survived). The live "lost" figure and its split (P-8) are owed after deploy |
| **AC-B13** (entry half): allow-listed projection | ✅ | Pass | Builder "no prompt, owner text, output, error message or email reaches the payload…" and "keeps an identifier error code, caps the models…". M6 (spreading `details`) went red |
| **AC-B15** (AuditTrail part) | ✅ | Pass | Header third-exception paragraph present and accurate; method filters by action + entity type, never severity (asserted); `ADMIN_METHODS` caller pin extended and green — only caller is `app/api/admin/business-os/ai-activity/route.ts` (grep confirms); `AuditTrailRepository.test.ts` `listOwnerEntries` exclusion suite unchanged and green (AC-B18). Column list excludes hash, email, ip, user agent (asserted) |
| **AC-B17** (B1b states) | ✅ (Jest) / ⬜ (keyboard) | Pass | Render: "every no-entry state renders as TEXT, with the 15-minute boundary on screen" (each state has text + icon), unknown reason in `title`, summary-line notices for failed / cut / archive-unread, "Unknown" never blank. M10 (lost chip shows the archived label) went red. No new control was added, so the B1a keyboard pass still applies; the user re-checks it once (checklist item 7) |

#### Mutation checks (QA's own; none overlaps Dev's M1–M3)

Each applied with `sed` to one line, the suite run, the file restored from a scratch copy, and `sha256` confirmed identical to the pre-mutation hash (`aiActivity.ts` `7492ac3a…`, `RecordStateMarker.tsx` `455ba9eb…`).

| # | Mutation | Suite | Result |
|---|---|---|---|
| M4 | Archive cutoff counts runs with `rows_archived = 0` (`> 0` → `>= 0`) | builder | **Red** (2 tests) |
| M5 | Duplicate own entries resolve oldest-first | builder | **Red** (1) |
| M6 | Projection spreads `details` into the found entry | builder | **Red** (3) |
| M7 | Too-recent boundary inclusive (`>` → `>=`) | builder | **Survived** — 1 ms difference, untested (see T-1) |
| M8 | Archive cutoff ignores `source` (other sources' runs count) | builder | **Red** (1) |
| M9 | Settle floor `now − 10 min` instead of `AUDIT_SETTLE_MS` | builder | **Survived** — real gap, see T-1 |
| M10 | "Lost" chip renders the "may be archived" label | render | **Red** (1) |

Other accounts' entries not reaching the route response is covered by Dev's M1 (builder) plus the route-level body assertion; not re-mutated.

#### Edge probes (throwaway `zzQaB1bProbe.test.ts`, 8 tests, all passed, file deleted)

| Probe | Result |
|---|---|
| Page spanning ~2.5 days (well over 2 h) | One audit read, window `[min − 1 h, max + 1 h)` exactly; the repository accepts any `start < end` |
| Exactly 100 rows, 100 distinct group ids | Builder sends 100 ids; real repository (fake client) sends 200 `IN` values and succeeds; 101 ids refused with `{ data: null, error }` and no query |
| Window edges | Query uses `gte(start)` / `lt(end)`; `start == end` is refused |
| Charge 14m59s / exactly 15m00s / 15m01s old, no entry | `too_recent` / `lost` / `lost` — correct for "under 15 min" |
| Archive cutoff unreadable, audit read OK | `getLatestCutoff` error → `archive: 'failed'`, settled row `unknown (archive_unread)`, too-recent row unchanged; an unparseable cutoff string → `failed`; a run with rows moved but `cutoff: null` → ignored, not a failure; cutoff exactly equal to the charge time → `lost` (strict `<`) |
| Mixed-case | Mixed-case `details.actionId` matches (lower-cased). A mixed-case **group id** input yields only lower + upper variants, so a mixed-case `entity_id` is not fetched — the documented R-6 gap, shows as "lost" |
| `actionId` missing / null / number / array / object / padded with spaces; `details` a string, array or null | All dropped; row `lost`; no marker from any of them in the payload |
| Models: 64 chars kept, 65 dropped, `""` dropped, >10 capped at 10; `models` not an array | As specified; a non-array `models` becomes `[]` (see E-B2) |
| Counts −1, NaN, Infinity, `'5'`, `null` → `null`; `2.9` → `2`; `0` kept; numeric `errorCode: 429` → `'429'` | As specified (D-B8) |

#### Issues Found

**Bugs (must fix before commit):** none.

**Test gaps (should fix, Low):**
1. **T-1 — the 15-minute classification is not pinned at its boundary.** `aiActivity.ts:594`/`:618` use `AUDIT_SETTLE_MS`, but the only behavioural test (`aiActivity.test.ts:800`) uses 5 and 20 minutes, so M9 (a 10-minute floor) survives while the screen still says "under 15 min". Add one case: a charge 14m59s old is `too_recent`, 15m01s is `lost` (the probe above, two lines). Optionally an exact-15m case to fix the inclusive/exclusive choice (M7).

**Edge cases (nice to fix, Low):**
1. **E-B1 — archive cutoff vs. entry stamp.** "May be archived" compares the **charge's** `created_at` with the cutoff (`aiActivity.ts:622`), but the archive moves the **entry**, stamped at or just before the charge (V-15). A charge a few seconds after a cutoff whose entry fell just before it shows "lost". At most a handful of rows per archive run; acceptable, worth one comment.
2. **E-B2 — a malformed `models` field reads "None recorded".** `aiActivity.ts:515` turns a non-array `models` into `[]`, and `ActivityTable.tsx:79` then renders "None recorded", a claim on unreadable evidence (unlike counts, which become "Unknown"). Unreachable from the current writer. Same family as SA-CR-B-1.
3. **E-B3 — the unknown reason is hover-only.** The chip text is the same for all three reasons (overlaps SA-CR-B-3); the reason is in `title`, which keyboard and screen-reader users do not reliably get. The summary line names a failed / cut / archive read in text, so AC-B17 holds; noted for B2's drill-down.

#### Test Outputs / Logs

| Gate | Result |
|---|---|
| Jest, 43 relevant suites (`lib/business-os/credits`, the route, `app/admin/business-os-llm`, `adminReadMethods.guard`, `AuditTrailRepository`, `BusinessOsCreditLedgerReadRepository`, `ArchiveRepository*`) | **42 pass, 1 fail — 1,289 / 1,291 tests.** The 2 reds are `creditPeriod.test.ts` source guard, pre-existing CRLF (B1a QA report), file untouched. Builder 60/60, render 40/40 in `activityTab.render`. Evidence only — ts-jest does not type-check |
| `npm run typecheck:bos-llm` (required) | `402 files in scope, 28 errors, 0 new` — **passed** (same "1 baseline entry is fixed" notice) |
| `npm run lint:hooks` (required) | exit 0 |
| `npm run test:bos-entitlements` | 108 suites / 2,578 tests pass. No touched code imports `lib/business-os/entitlements/` |
| `console.*` | 0 in every touched and new source file |
| Clean-up | Probe file deleted; scratch copies deleted; `git status --short` matches Dev's list exactly; nothing staged |

#### Manual post-deploy click-through (user, after B1b deploys)

1. Signed in as an admin, open `/admin/business-os-llm?tab=activity` ("This month"). Four new columns sit after "Credits charged": **Calls / failed, Tokens, Models, Error code**. No cell is blank.
2. **P-7.** Pick a row older than 15 minutes with no record-state chip. Note its grouping id (hover) and time. On `/admin/audit-trail?entity_type=ai_action`, open the entry with that `entity_id` and the same `actionId`: calls, failed calls, total tokens (hover shows in/out) and models match the row. A failed action's error code matches too.
3. Trigger one Business OS AI action (for example, a chat turn), then refresh within 15 minutes: its row shows **"No audit entry — too recent (under 15 min)"** or a found entry, never "lost". Refresh after 15 minutes: it shows a found entry.
4. Under the table, the summary reads "Audit entries, over the N rows shown: … lost, … may be archived, … too recent, … unknown, … with an entry on another account", plus the 15-minute note. No failed / cut / archive notice shows on a healthy read.
5. **P-8.** Pick a recent settled window (for example yesterday, one business at a time and then all accounts). Record the **lost** count over the rows shown. For each lost row, search the Vercel logs around its time for the two audit-writer error lines (`aiActionAudit.ts:478-481` and `:585`), and split the count into "writer logged an error" vs. "no error line". Record both figures in this report as an **upper bound** on KI-B, never as a screen feature.
6. **Account mismatch.** Expect **0** "with an entry on another account". Any non-zero figure is a defect: record the row's action id only (no business name) and raise it.
7. Keyboard: Tab across a row's record-state chips — each state is readable as text, not colour alone (AC-B17). No new control was added.
8. In the Vercel logs, the "Admin read the Business OS AI activity" line now carries `audit: { status, archive, noEntry }` and still no company name; the "Admin AI action entries read across all accounts" line carries counts only (no group id, no entry). Record `durationMs` for "This month" next to B1a's P-6 figure.

#### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] **PASS WITH NOTES.** No bug. Every in-scope AC is proven by a test, and 5 of QA's 7 mutations went red. T-1 is a Low test gap (the 15-minute boundary is not pinned behaviourally): Dev should add the two-line case before commit; it needs no further SA pass. E-B1 to E-B3 are optional. P-7, P-8 and the click-through above are owed by the user after deploy.

---

## Commit Info

**B1a** (RM, 2026-10-04), branch `feature/admin-ai-activity-b1a`, base `origin/main` `03b62c3c`:

| Commit | Message |
|---|---|
| `0c03f55f` | docs(admin): Gap B re-plan on the credit ledger, B1 workplan, B0 superseded |
| `e74f549b` | feat(db): B0' activity indexes on business_os_credit_charges (applied on production 2026-10-04) |
| `077b3de2` | feat(admin): Business OS AI Activity tab, slice B1a (ledger list) |

PR: opened to `main` by RM (see the PR for its number). Not merged; merge needs the CI Build check green and the user's explicit instruction. B1b: branch to be cut after B1a merges.

**B1b** (RM, 2026-10-04), branch `feature/admin-ai-activity-b1b`, base `origin/main` `8c8b5d08`:

| Commit | Message |
|---|---|
| `a371c3a1` | feat(admin): AI Activity tab audit join, slice B1b |
| (this commit) | docs(admin): B1b workplan, SA code review, QA report, commit info |

PR: opened to `main` by RM (see the PR for its number). Not merged; merge needs the CI Build check green and the user's explicit instruction. Post-deploy checks P-7, P-8 and the QA click-through are owed by the user.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-04 | B1b committed (RM) | Code commit `a371c3a1` plus this docs commit on `feature/admin-ai-activity-b1b`; PR opened to `main`. See § Commit Info |
| 2026-10-04 | **B1b SA-CR-B / QA fixes applied (Dev), uncommitted** | QA T-1 boundary tests (14m59s / 15m00s / 15m01s); QA M7 and M9 re-run and now red. SA-CR-B-1: an unreadable charge time gives `unknown` (`charge_time_unreadable`). QA E-B2: a non-array `models` gives `null` / "Unknown". SA-CR-B-2: archive cutoff shown as a date in the summary. SA-CR-B-3 / E-B3: neutral "Audit entry unknown" with the reason as visible text. QA E-B1: a 1 h margin (`LEAK_CHECK_LIMITS.SLACK_MS`) after the archive cutoff. See "SA-CR-B / QA fixes" under Implementation Notes (B1b) |
| 2026-10-04 | **QA of B1b: PASS WITH NOTES** | "QA Report — B1b — 2026-10-04" added under § QA Testing Report (targeted edit). Every in-scope AC (audit-join row, AC-B5 audit half, AC-B6 Q1, AC-B13 entry half, AC-B15 AuditTrail part, AC-B17) mapped to tests. 7 QA mutations: 5 red, 2 survived (M7, M9 — the 15-minute boundary is pinned only as a constant: test gap T-1, Low). 8 edge probes all passed, then deleted. No bugs. Gates: Jest 1,289/1,291 (2 pre-existing `creditPeriod` CRLF reds), `typecheck:bos-llm` 0 new, `lint:hooks` exit 0, `test:bos-entitlements` 2,578/2,578. Edge cases E-B1 to E-B3 (Low). Post-deploy click-through incl. P-7 and P-8 owed by the user |
| 2026-10-04 | **SA code review, B1b: APPROVED** | SA Code Review — B1b — 2026-10-04 added to § SA Review Notes. SA-B1-7 and OQ-5 to OQ-8 implemented as ruled; D-B1 to D-B11 accepted; D-B7: keep the `LEAK_CHECK_LIMITS.SLACK_MS` import (already pinned by the window test); D-B3: a cut read shows `unknown`. Tenant isolation verified at the type, builder and route-response level. Gates re-run by SA: `typecheck:bos-llm` 0 new, `lint:hooks` exit 0, authz guard 119/119, `test:bos-entitlements` 2,578/2,578, relevant Jest 1,204/1,206 (2 pre-existing `creditPeriod` CRLF reds), scoped `tsc` 0 on touched files. Three optional Low items, SA-CR-B-1 to SA-CR-B-3 |
| 2026-10-04 | **B1b implemented (Dev), uncommitted** | T10–T14 done on `feature/admin-ai-activity-b1b` (base `8c8b5d08`); T15 local gates run, P-7/P-8 owed after deploy. `AuditTrailRepository.listAiActionEntriesAllAccountsByGroupIds` (entity type + two actions, never severity, both id cases, half-open ±1 h window, 1,000-row cap) with header amendment and `ADMIN_METHODS` pin; builder step 8 with SA-B1-7's match and precedence, the projection, the six states and the archive cutoff (OQ-8); route injection and log fields; four entry columns, five state labels and the "over the rows shown" summary with the 15-minute boundary. Deviations D-B1 to D-B11 in Implementation Notes (B1b). `typecheck:bos-llm` 0 new, `lint:hooks` exit 0, scoped `tsc` with canary clean on touched files, four mutations red and restored byte-exact |
| 2026-10-04 | **B0′ migration renamed 20261025 → 20261026** | `main` gained `20261025_business_os_billing_accounts.sql` (62048d63) after this branch was cut, and the migration test pins ours as the only file with its date prefix. Renamed the migration and its rollback to `20261026_…` (no other branch uses that prefix) and updated the checker, the migration test and this workplan. Repo filename only: the indexes were already applied on production on 2026-10-04 and are unchanged. Earlier rows and review sections keep the old name as the record |
| 2026-10-04 | B1a committed (RM) | Three commits on `feature/admin-ai-activity-b1a` (`0c03f55f`, `e74f549b`, `077b3de2`); PR opened to `main`. See § Commit Info |
| 2026-10-02 | QA of B1a: PASS WITH NOTES | "QA Report — B1a — 2026-10-02" added under § QA Testing Report (targeted edit). Tested the tree before SA-CR-1 to SA-CR-3. Every in-scope AC is mapped to a test; AC-B16 and the keyboard pass are owed by the user. Eight mutation checks all went red, and restoration was confirmed byte-exact by sha256. Edge probes covered window bounds, limit, keys, UUIDs, empty and null-count results, the deleted-bucket ceiling and UTC presets. No bugs. E-1 duplicates SA-CR-2; E-2 to E-4 are Low. M-5 shows the authz CI guard does not enforce gate-first (OI-20). `creditPeriod` red is confirmed as CRLF, identical to `main` |
| 2026-10-02 | SA code review of B1a: APPROVED WITH CHANGES | "SA Code Review — B1a — 2026-10-02" added under § SA Review Notes (targeted edit). SA-B1-1 to SA-B1-6, SA-B1-8, SA-B1-9 verified in code. D-1 to D-11 all accepted. Security, tenant isolation, CLAUDE.md and migration safety clean. Gates re-run: `typecheck:bos-llm` exit 0 (0 new), `lint:hooks` exit 0, authz guard green, scoped `tsc` with canary clean on touched files; Jest 33/34 (the one red suite is pre-existing `creditPeriod` CRLF). Build owed to CI. Three fixes for Dev: SA-CR-1 (Medium, typed ledger fakes in the builder test), SA-CR-2 and SA-CR-3 (Low) |
| 2026-10-02 | B1a implemented (Dev), uncommitted | T0, T1, T3–T8 done on `feature/admin-ai-activity-b1a`. SA-B1-1 to SA-B1-6, SA-B1-8, SA-B1-9 applied (§ A, shape table, E1–E6, apply step 1, Test Plan gate list and L-2/L-4 updated). Deviations D-1 to D-11 recorded in Implementation Notes. T2 (hand-apply of B0′ on production) and T9 owed by the user |
| 2026-10-02 | SA review: APPROVED WITH CHANGES | SA Review — 2026-10-02 added to § SA Review Notes (targeted edit). Split approved, B1a first. V-6, the `:64` citation, V-14 and V-15 confirmed in the tree. V-9 corrected: the `bos-llm` typecheck is a **required** check (verified live). OQ-1 to OQ-14 ruled. Nine required changes: SA-B1-1 index (a) becomes `(kind, created_at DESC, id DESC)`, robust to PostgREST's parameterised generic plans; SA-B1-2 checker convention plus generic-plan `EXPLAIN`; SA-B1-3 rollback `lock_timeout`; SA-B1-4 commit the untracked "before" checker; SA-B1-5 platform-account 409 copy; SA-B1-6 gate list; SA-B1-7 audit-match rules; SA-B1-8 URL tab opens its lazy panel; SA-B1-9 `AI_CHARGE_SERVICE` constant. Four requirement corrections listed for BA. Nothing for the user |
| 2026-10-02 | Created | B1 workplan with B0′ folded in, written against the SA-approved Gap B re-plan (SA-RC-1 to SA-RC-17) and the four SA-RC-9 live checks (F-21, F-24). Verification log V-1 to V-24 against `main` `03b62c3c`. **Three findings beyond the requirement:** the read repository does have an importer guard, inside its unit test (V-6, contradicting F-25 and NFR-4.5); a client-supplied upper-case turn id would defeat a plain `entity_id IN` join (V-14); and audit entries are stamped when queued, which makes a time-bounded join safe (V-15). B0′ planned as two partial indexes with `lock_timeout = '1s'` in `20261025_…`. Maximum window 92 days, matching the Costs & credits tab. **Proposes splitting B1 into B1a (ledger list, about 3 days) and B1b (audit join, about 2 days).** Fourteen open questions for SA. No code, SQL file or test written; no branch created |
