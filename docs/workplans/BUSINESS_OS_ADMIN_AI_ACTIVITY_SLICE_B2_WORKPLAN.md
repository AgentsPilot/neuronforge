# Workplan: Admin AI Activity — Slice B2 (the drill-down by action id)

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md) — Gap B, slice **B2** (Suggested Slicing row, `:645`)
**Builds on:** [BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B1_WORKPLAN.md) (B1a merged as PR #195, B1b merged as PR #205)
**SA rulings this plan implements:** SA-R3, SA-R9, SA-RC-4, SA-RC-11, SA-RC-12 (requirement § SA Re-plan Review), and the B1 rulings it reuses: SA-B1-7 (audit match), OQ-6 (both id cases), OQ-7, OQ-8, OQ-9 (export in place), OQ-12 (deep-link landing is B3), OQ-13 (fallback direction is B2/B3).
**Date:** 2026-10-04
**Branch:** **`feature/admin-ai-activity-b2`**, cut by RM from `origin/main` `7eac5b98` (contains B1a #195 and B1b #205). Confirmed by Dev with `git branch --show-current` in worktree `neuronforge-ai-activity`. If SA approves the split below, this branch carries **B2a**, and RM cuts a second branch for **B2b** after B2a merges.
**Status:** **B2a Code Complete** (2026-10-04) — uncommitted on `feature/admin-ai-activity-b2`, awaiting SA code review. B2b not started. See [Implementation Notes (B2a)](#implementation-notes-b2a).

## Overview

B1 gave platform admins one row per Business OS AI action: what it was, whether it worked, what it cost, and its audit entry. B2 answers the question the list cannot: **"was this one big call or forty small ones?"** An admin opens a row and sees, in a drawer:

- the charge and every adjustment that points at it;
- the action's audit entry fields, or why there is none;
- the group's other charged actions **on the same account**, and a plain statement when the group holds more than one;
- the group's individual `token_usage` calls, read by grouping id **and** account taken from the charge row;
- the group-level cost cross-check (FR-B6 item 2), which compares the sum of the group's charges with the sum of its calls using the leak check's own classifier and tolerance, and gives the direction of a fallback-priced charge.

The drill-down request carries **only an action id** (SA-RC-11). The account and the grouping id are read from the charge row, never from the request, so a request cannot widen any read.

The view stays **read-only**. It writes nothing, makes no LLM call and writes no audit entry (FR-B7, NFR-3).

B2 is about four working days. This plan proposes **splitting it into B2a and B2b** along the same kind of seam B1 used: B2a reads only the ledger and the audit trail, and B2b brings in `token_usage`. See [Proposed Split](#proposed-split-b2a-and-b2b).

---

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Proposed Split: B2a and B2b](#proposed-split-b2a-and-b2b)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
  - [A. The ledger read repository: one account-scoped group read](#a-the-ledger-read-repository-one-account-scoped-group-read)
  - [B. TokenUsageRepository: one account-scoped group-calls read (B2b)](#b-tokenusagerepository-one-account-scoped-group-calls-read-b2b)
  - [C. Reuse from the list builder: export in place](#c-reuse-from-the-list-builder-export-in-place)
  - [D. The drill-down builder](#d-the-drill-down-builder)
  - [E. The group-level cost check (B2b)](#e-the-group-level-cost-check-b2b)
  - [F. The route and its Zod schema](#f-the-route-and-its-zod-schema)
  - [G. The drawer on the Activity tab](#g-the-drawer-on-the-activity-tab)
  - [H. The read-only live check (B2b)](#h-the-read-only-live-check-b2b)
  - [I. Guards that must be extended](#i-guards-that-must-be-extended)
  - [J. The console.* audit](#j-the-console-audit)
- [Files to Create / Modify](#files-to-create--modify)
- [Task List](#task-list)
- [Test Plan](#test-plan)
- [Verification Plan](#verification-plan)
- [Risks](#risks)
- [Non-Goals](#non-goals)
- [Open Questions for SA](#open-questions-for-sa)
- [Implementation Notes (B2a)](#implementation-notes-b2a)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

Every claim this plan depends on was re-read in the worktree on 2026-10-04 at `7eac5b98`. Live-database facts are taken from the cited records and are **not** re-measured (no database access in this pass). **Four findings change the plan** (V-3, V-4, V-9, V-11).

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| V-1 | B2's scope: drill-down by action id only; group charges with adjustments; the entry's fields; the group's `token_usage` calls by group **and** account from the charge row; the shared-group marker; FR-B6 item 2 | Holds | Requirement `:645` (slicing row), `:370-379` (FR-B2), `:445` (FR-B6 item 2), `:1094` (SA-R9), `:1114` (SA-RC-11) |
| V-2 | `TokenUsageRepository` requires an account on every account read, imports nothing from `lib/business-os/**`, selects allow-listed columns only, and `LedgerCallRow` has no `user_id`, `model_name` or `provider` | Holds | `lib/repositories/TokenUsageRepository.ts:4-27` (header), `:52-65` (`LedgerCallRow`), `:106-117` (`TOKEN_USAGE_COLUMNS`), `:348-403` (`listCallsInWindow`: `lte` end, `created_at DESC, id DESC`, de-duplicating pager) |
| V-3 | **"Adding a method fails the `EXPECTED_ARITY` pin unless it is extended in the same commit"** (NFR-4.1, F-18) | **The pin is already RED at `7eac5b98`.** `summariseFeatureAllAccountsInWindow` (`TokenUsageRepository.ts:483`) is on the class and absent from `EXPECTED_ARITY`. Run on 2026-10-04: `npx jest lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` → **1 failed, 4 passed** ("pins every public method and its arity"). The header's "THE ONE ALL-ACCOUNTS READ" (`:14-18`) is stale for the same reason. The B0 workplan recorded this on 2026-09-24 (its V-8), and the user **parked** it then to avoid scope creep. B2b cannot make the pin meaningful evidence without touching that map. Raised as [OQ-2](#open-questions-for-sa) | `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts:61-69`, `:76-88`; B0 workplan `:65` |
| V-4 | **Private methods count as public in the contract test** | **New.** The test lists `Object.getOwnPropertyNames(prototype)` and excludes a hard-coded list of private names. TypeScript `private` methods are still on the prototype, so **any new private helper method** (a guard or a pager) turns the pin red unless it is added to that exclusion list. The plan therefore keeps new helpers as **module-level functions** ([OQ-15](#open-questions-for-sa)) | contract test `:77-83` (the exclusion list includes `pageChatCalls`, `assertChatRead`) |
| V-5 | What CI actually runs for B2's files | `test:bos-entitlements` (job "Business OS entitlements invariants") runs Jest over `lib/repositories/__tests__`, `lib/business-os/credits/__tests__`, `supabase/migrations/__tests__` and `lib/audit/__tests__`, so the **repository tests and the builder tests run in CI** (on Linux). It does **not** run `lib/business-os/usage/__tests__` (the contract test) or `app/api/admin/business-os/ai-activity/**` (the route tests). The contract test's `@ts-expect-error` lines **are** compiled by `typecheck:bos-llm` (its directory is core scope); its runtime arity check is evidence only | `package.json:21-22`; `.github/workflows/bos-entitlements.yml:128`; `scripts/typecheck-bos-llm.ts:102-111` (`SCOPED_DIRS`) |
| V-6 | The leak check's constants, tolerance and classifier are exported and reusable | Holds. `LEAK_CHECK_LIMITS` (`SLACK_MS` 1 h, `LONGEST_ACTION_MS` 5 min, `SETTLE_MS` 6 min, `PAGE_SIZE` 1,000, `USAGE_CEILING` 5,000); `leakTolerance(calls)`; **`classifyLeakGroups` is pure and exported**, keys groups by id, nets adjustments through `resolveEffectiveFields`, and returns `cases` per group id. A fallback-priced group outside tolerance is `pending_reconciliation` **with a direction** (`over` / `under`), never a mismatch. The leak check reads usage with `bosRowFilter()` | `lib/business-os/credits/creditLeakCheck.ts:76-101`, `:114-116`, `:206`, `:271-481` (classifier; `:394-407` the cases), `:609-618` (its usage window), `:626` (`bosRowFilter()`); `lib/business-os/llm/callCatalog.ts:139-141` |
| V-7 | The ledger read repository has a by-id charge lookup and an unwindowed adjustment lookup, but **no group read** | Holds. `findChargesByActionIds` (charges only, by unique id; the caller checks the account) and `listAdjustmentsForActionIds` (no `created_at` bound, ≤ 200 ids, ceiling 2,000). Nothing reads by `group_id`. `business_os_credit_charges_group_idx (group_id)` exists in the repo **and** live (B0′ section 1 AFTER, 7/0 PASS, B1 workplan `:763-766`). A charge row always carries `group_id` (uuid) | `lib/repositories/BusinessOsCreditLedgerReadRepository.ts:631-667`, `:727-776`; header `:38-55`; `supabase/migrations/20261015_business_os_credit_charges.sql:13` (`group_id uuid`), `:34` (`charge_shape`), `:54` (`group_idx`) |
| V-8 | The read repository's exact-equality importer list will see every new importer | Holds. Any file whose text contains `BusinessOsCreditLedgerReadRepository` must be on the list | `lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts:827-858` |
| V-9 | **The list builder's audit join and netting can be reused as they are** | **Partly.** `netAdjustments` (`:246`), `readAuditEntries` (`:470`), `readArchiveCutoff` (`:495`), `projectEntry` (`:521`) and `joinAuditEntries` (`:572`) are **module-private**. `readAuditEntries` and `readArchiveCutoff` take the whole `AiActivityDeps`. Reuse needs `export` on them plus narrowing two parameter types to `Pick<…>` (no behaviour change, the OQ-9 precedent). Reusing `readArchiveCutoff` also keeps the `'audit_trail'` literal in `aiActivity.ts` alone, which the BD-26 owner-read guard already allow-lists | `lib/business-os/credits/aiActivity.ts:133`, `:246-267`, `:470-515`, `:521-541`, `:572-679`; `lib/audit/__tests__/ownerAuditReads.guard.test.ts:37` |
| V-10 | **The AC-B7 list pin constrains where B2's code may live** | **New constraint.** A source test pins that `aiActivity.ts`, `aiActivityDeps.ts` and the list route never name `TokenUsageRepository` or `token_usage`, and that `aiActivity.ts` contains no `usage` (case-insensitive) at all. B2's `token_usage` code must live in **new files**, and the exports added to `aiActivity.ts` must not introduce the word | `lib/business-os/credits/__tests__/aiActivity.test.ts:940-962` |
| V-11 | **`token_usage.session_id` is a `uuid` column** | **Not verifiable from the repo.** No migration in `supabase/migrations` or `supabase/SQL Scripts` creates `token_usage` (it predates the migrations folder). Code comments say uuid (`turnUsage.ts:87`), and the tracker validates with a **case-insensitive** regex and stores the value **as given** (`aiAnalytics.ts:122-125`, `:140-146`, `:160`). If the column is `uuid`, Postgres canonicalises case and `.eq` works. If it is `text`, an upper-case client turn id (F-28) is stored upper-case, and both the drill-down and **the leak check** would mis-key it. A read-only live check is planned ([§ H](#h-the-read-only-live-check-b2b)); the query design does not depend on its answer ([OQ-3](#open-questions-for-sa)) | grep of both SQL folders (no `CREATE TABLE … token_usage`); `lib/business-os/bizql/telemetry/turnUsage.ts:87`; `lib/analytics/aiAnalytics.ts:122-160` |
| V-12 | A `(user_id, created_at DESC)` index on `token_usage` exists live, and no `session_id` index exists | Holds as recorded. Repo: `idx_token_usage_user_created` (`20260929_usage_summary.sql:98-99`). Live `pg_indexes` (2026-09-26): `idx_token_usage_created_at`, `(feature, created_at DESC)`, `(user_id, created_at DESC)` and others; nothing on `session_id`. SA-R9's access path (account + window, `session_id` as a residual filter) therefore needs **no migration** | `supabase/migrations/20260929_usage_summary.sql:98-99`; `docs/workplans/ADMIN_MODULE_BOS_REORGANISATION_SLICE4_WORKPLAN.md:877` (L-3); B0 workplan `:60` |
| V-13 | `token_usage` carries `provider`, `model_name`, `error_code`, and the three columns that must stay unread | Holds: `request_payload`, `response_metadata` and `error_message` are written per row and are excluded by every existing column list | `lib/analytics/aiAnalytics.ts:151-176` |
| V-14 | The admin AI-entry read can be called from a second admin route | Holds. `listAiActionEntriesAllAccountsByGroupIds` is pinned to callers under `app/api/admin/**`; the drill-down route is under that path, so the guard needs no change. It queries both id cases and caps at 1,000 rows | `lib/repositories/AuditTrailRepository.ts:376-420`; `lib/repositories/__tests__/adminReadMethods.guard.test.ts:479-490`, `:511-523` |
| V-15 | A drawer primitive exists and has an in-repo precedent | Holds. `components/ui/sheet.tsx` (Radix dialog: focus trap, Escape, focus return) is used by `components/business-os/CreditHistoryPanel.tsx:35`. The page's source guard bans `@/lib/` **specifiers** only (`source.guard.test.ts:113-116`), plus provider/model literals and `console.*`. `sheet.tsx` imports `@/lib/utils` transitively, as the reused picker imports `@/lib/logger` (B1 OQ-3, approved) | `components/ui/sheet.tsx:1-10`, `:24`, `:34`; `app/admin/business-os-llm/__tests__/source.guard.test.ts:100-118`, `:157-161` |
| V-16 | `RecordStateMarker` takes a whole list row | Holds: `({ row }: { row: ActivityRow })`, and reads only `isFallbackPriced`, `corrected`, `reasonCodes` and `entry`. Reusing it for the group's charges needs its prop widened to a `Pick` (type only) | `app/admin/business-os-llm/components/activity/RecordStateMarker.tsx:71-91` |
| V-17 | The service-column guard lists the list route and three screen modules **by name**, and walks the component folder | Holds. A new route file and a new screen module must be added; a new component under `components/activity/` is covered automatically | `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts:63-84`, `:100-106` |
| V-18 | The list route is the template: `requireAdmin` first, repeated keys refused, strict Zod, pure 409 check, one `info` line with ids and counts only | Holds | `app/api/admin/business-os/ai-activity/route.ts:134-172`, `:198-224` |
| V-19 | The credit-lots L8 guard walks only `supabase/migrations` and `supabase/SQL Scripts` | Holds. A read-only check script under `scripts/` cannot trip it; B2 adds **no** migration | `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts:773-805` |
| V-20 | B1 deferred the deep-link landing, and the page ignores `actionId` today | Holds. OQ-12 moved `?actionId=` landing to B3; a render test pins that the page ignores it | B1 workplan `:1088` (OQ-12 ruling); `app/admin/business-os-llm/__tests__/activityTab.render.test.tsx:625` |
| V-21 | The fallback marker on the list carries no direction | Holds: B1a shows "Priced from a fallback rate — pending reconciliation" (OQ-13). Direction needs `token_usage`, which the list may never read (SA-RC-4). B2 gives it **in the drill-down**; it can never appear on the list | B1 workplan `:868`, `:1089`; requirement `:447` |
| V-22 | F-13 / F-28: `(session_id, user_id)` is the permanent `token_usage` key; a grouping id may be shared across actions and across accounts | Holds | Requirement `:82` (F-13, "permanent, not a stopgap"), `:97` (F-28) |

---

## Scope

### In scope for B2

| Item | Requirement | Slice (if split) |
|---|---|---|
| `GET /api/admin/business-os/ai-activity/drill-down?actionId=<uuid>`: `requireAdmin` first, strict Zod with the action id as the only key, 404 that reveals nothing | FR-B2, SA-RC-11, NFR-1, NFR-10, AC-B14 | B2a |
| The opened charge, read by its unique action id; its account and grouping id taken **from the row** | FR-B2, SA-RC-11 | B2a |
| Every charge of the same `(group_id, user_id)`, through a new **account-scoped** method on `BusinessOsCreditLedgerReadRepository`, served by `business_os_credit_charges_group_idx`, with a ceiling | FR-B2, SA-R9, NFR-4.5 | B2a |
| Each adjustment of those charges, listed (date, reason code, cost, credits) and netted into its charge; one written in a later period still nets | FR-B12, AC-B19 (drill-down half) | B2a |
| The audit entry's fields (the B1b projection) for the opened action, and the entry state of each group charge, with the same match and precedence as the list (SA-B1-7) | FR-B2, SA-RC-12, AC-B5 | B2a |
| The shared-group marker: "this grouping id holds N charged actions on this account; calls cannot be attributed to one of them" | FR-B2, requirement `:326`, AC-B5 | B2a |
| The drawer on the Activity tab, opened from a keyboard-reachable button on each row | FR-B2, NFR-7, AC-B17 | B2a |
| A new **account-scoped** `TokenUsageRepository` method: `user_id` + `session_id` + a `created_at` window around the group's charges, the leak check's row filter passed as plain data, a ceiling with a truncation flag, a new named column list; `EXPECTED_ARITY` extended in the same commit | FR-B2, SA-R9, NFR-4.1 to NFR-4.3, AC-B15 | B2b |
| The group's calls in the drawer: time, call name (`component`), model, provider, input/output tokens, cost, success, error code | FR-B2, AC-B2 | B2b |
| **FR-B6 item 2**, the group-level cost check: the group's charges (net) against the group's calls, through the leak check's own `classifyLeakGroups` and `leakTolerance(calls)`; drill-down only | FR-B6, SA-R3, SA-RC-4, AC-B7 (drill-down half) | B2b |
| The **fallback-priced direction** (over / under) for a fallback-priced group, shown in the drawer, never as a mismatch | FR-B6, OQ-13 (the B2 half) | B2b |
| A read-only live check script (session_id type, the token_usage indexes, two `EXPLAIN` blocks) and an SQL-text pin test for it | V-11, V-12, AC-B16 spirit | B2b |

### Explicitly out of scope (B3 or never)

| Item | Goes to | Why not here |
|---|---|---|
| **FR-B6 item 1**, the charge-vs-audit-entry marker at $0.0001 | **B3** | The slicing table puts it in B3, where it runs on the list. B2 also does **not** project the entry's `estimatedCostUsd`, so the drawer never shows two cost figures without the marker that D-1 requires beside them ([OQ-11](#open-questions-for-sa)) |
| Landing on `?actionId=` and the inbound link from `/admin/audit-trail` | **B3** | OQ-12 (B1, SA-ruled). The drawer state is **not** URL-addressable in B2, and the page keeps ignoring `actionId` (V-20) |
| "Audited, not charged" (FR-B9) | **B3** | |
| "AI spend with no charge", the ungrouped bucket, the platform-account link (FR-B5 question 2, FR-B8) | **B3** | They come from the leak-check route, unchanged |
| The help text naming chat-v2 and the leak check's blind spots (AC-B21) | **B3** | |
| A shared-group marker **on the list** | Not planned ([OQ-10](#open-questions-for-sa)) | The list knows only its own page. Telling that a row's group holds other charges would need one more cross-row read per page. The marker lives in the drawer, where the group is read anyway |
| A fallback direction **on the list** | **Never** | The list never reads `token_usage` (SA-RC-4) |
| Fixing chat-v4's turn-id case at its root | TL follow-up (requirement Out of Scope) | Unchanged from B1 |
| Any write, adjustment, export or alert | **Never** (FR-B7, D-5) | |
| Pre-cut-over history | **Never** (D-8) | A charge cannot predate the cut-over, so the drill-down cannot reach one |

---

## Proposed Split: B2a and B2b

**Recommendation: split** ([OQ-1](#open-questions-for-sa)). B2 as specified is about four working days, at the upper edge of "a few days", and `main` moves fast.

| Slice | Content | Estimate | Ships alone? | Depends on |
|---|---|---|---|---|
| **B2a — the drawer on the ledger and the audit trail** | The route, the by-id charge read, the new group read on the ledger read repository, adjustments listed and netted, the entry fields and per-charge entry states (reusing B1b's join), the shared-group marker, names, the drawer and its row button | ~2 days | **Yes.** It answers "what exactly was this action, what corrected it, what does its audit entry say, and what else ran under the same grouping id for this business" | Nothing beyond `main` |
| **B2b — the calls and the group cost check** | The new `TokenUsageRepository` method, its column list and contract pin; the live check script and its pin; the calls section; the group-level cost check through `classifyLeakGroups`; the fallback direction | ~2 days | **Yes.** Adds two sections to an existing drawer | B2a merged; [OQ-2](#open-questions-for-sa) answered (the parked red pin) |

**Why this seam.** It is the only place where the design changes data source, as B1's seam was. B2a reads only tables B1 already reads, through repositories B1 already extended, and touches no `token_usage` code. B2b carries every `token_usage` risk on its own: the contract pin that is red today and was parked by the user (V-3), the unverified `session_id` type (V-11), the leak-check coupling (SA-R3) and the payload-size question. B2a can start at once; only B2b waits on a TL/user answer.

**What B2a shows where B2b will add sections.** The calls section and the cost-check line are **absent** in B2a, not empty, so nothing can read as "no calls" (the B1a D-8 precedent).

If SA prefers one slice, the task list runs straight through: T1 to T9 are B2a and T10 to T18 are B2b.

---

## Analysis Summary

| Area | What this touches |
|---|---|
| **Tables read** | `business_os_credit_charges` (the opened charge by `action_id`; the group's charges by `group_id` + `user_id`; adjustments by `adjusts_action_id`); `audit_trail` (through the existing admin AI-entry read); `archive_runs` (existing cutoff reads); `business_profiles` (company name, existing admin read); **`token_usage`** (B2b only, one account, one group, one window). **Not** `business_os_credit_totals` |
| **Schema change** | **None.** No migration, no index. The live check in [§ H](#h-the-read-only-live-check-b2b) is read-only evidence |
| **Repositories** | `BusinessOsCreditLedgerReadRepository` gains one account-scoped method. `TokenUsageRepository` gains one account-scoped method, a column list and a row type (B2b). `AuditTrailRepository`, `ArchiveRepository` and `BusinessProfileRepository` are reused unchanged |
| **Server modules** | New `lib/business-os/credits/aiActivityDrillDown.ts` (builder), `aiActivityDrillDownTypes.ts` (wire types), `aiActivityDrillDownDeps.ts` (non-admin wiring). They sit under `lib/business-os/credits/` for the reason B1 OQ-2 approved: required typecheck scope and the service-column scan with no configuration change. `aiActivity.ts` gains `export` keywords and two narrowed parameter types only |
| **Route** | New `app/api/admin/business-os/ai-activity/drill-down/route.ts`, `GET`, `requireAdmin` first |
| **UI** | `ActivityTable.tsx` gains a Details button column; `ActivityTab.tsx` holds which action is open; new `ActivityDrillDown.tsx` (drawer), `DrillDownCharges.tsx`, and in B2b `DrillDownCalls.tsx`; new client mirror `activityDrillDownTypes.ts`; strings in `activityCopy.ts`; `RecordStateMarker.tsx` prop widened |
| **Providers / LLM** | None. Provider and model values are **data** from `token_usage`, rendered as text; no literal is compared (the page guard's R-T17 rule) |
| **Entitlements** | Nothing imports `lib/business-os/entitlements/` directly. `aiActionAudit.ts` (imported for `sanitizeErrorCode`) reaches a type there, as `aiActivity.ts` already does. `npm run test:bos-entitlements` is run anyway, because it is the CI job that runs the repository and builder suites (V-5) |
| **Audit writes** | None |
| **V6 pipeline** | Not touched |

---

## Implementation Approach

### A. The ledger read repository: one account-scoped group read

**New method on `lib/repositories/BusinessOsCreditLedgerReadRepository.ts` (B2a):**

```typescript
/**
 * The CHARGE rows of ONE account that share one grouping id, at ANY time,
 * newest first (`created_at DESC, id DESC`), paged up to `ceiling`. Served by
 * `business_os_credit_charges_group_idx`. Account-scoped by signature: both the
 * account and the group come from a charge row the caller has already read,
 * never from a request (SA-RC-11). Logged at debug.
 */
async listChargesOfGroupForAccount(
  userId: string,
  groupId: string,
  opts: CreditLedgerPageOptions
): Promise<RepositoryResult<CreditLedgerPagedResult<CreditLedgerRow>>>;
```

- **Query:** `.from('business_os_credit_charges').select(CREDIT_LEDGER_ROW_COLUMNS).eq('kind', 'charge').eq('user_id', userId).eq('group_id', groupId).order('created_at', desc).order('id', desc).range(…)`, with the same de-duplicating pager as `listRowsForAccountCreatedInRange` (`:578-626`).
- **No time bound.** A group's charges belong together whenever they were written; the group index makes this cheap.
- **Guards before any query:** `assertAccount(userId)`; `groupId` a UUID (the module's `UUID_PATTERN`); `assertPaging(opts)`. A failed guard returns `{ data: null, error }` through the existing `fail()`.
- **`reachedCeiling`** uses the repository's `>=` rule (`:136-142`).
- **No write verb, no `service` filter, the existing column list.** The write-verb pin and the service-column guard cover it unchanged.
- **Header amendment (same commit, NFR-4.5):** the callers paragraph names the drill-down wiring; the "ACCOUNT SCOPE" paragraph lists the new method among the account-scoped reads. The unscoped list is unchanged, because this method is not unscoped.

The opened charge itself is read with the **existing** `findChargesByActionIds([actionId])` (V-7). Adjustments use the **existing** `listAdjustmentsForActionIds`, chunked by 200 ids.

---

### B. TokenUsageRepository: one account-scoped group-calls read (B2b)

**New exports on `lib/repositories/TokenUsageRepository.ts`:**

```typescript
/** One call of one group, for the admin AI Activity drill-down (Gap B B2, NFR-4.3). */
export interface LedgerGroupCallRow extends LedgerCallRow {
  user_id: string;
  provider: string | null;
  model_name: string | null;
}

// Added to TOKEN_USAGE_COLUMNS. Still never request_payload, response_metadata,
// metadata or error_message (V-13).
groupCall:
  'id, user_id, created_at, feature, component, session_id, provider, model_name, ' +
  'input_tokens, output_tokens, cost_usd, success, error_code',
```

`LedgerGroupCallRow` **extends** `LedgerCallRow` on purpose: the rows can be handed to `classifyLeakGroups` unchanged ([§ E](#e-the-group-level-cost-check-b2b)).

**New method:**

```typescript
/**
 * The calls of ONE group of ONE account in the window, newest first, paged, up
 * to `ceiling`. The account and the group come from a charge row (Gap B
 * SA-R9, SA-RC-11): `(session_id, user_id)` is the key, never the group alone
 * (F-13, F-28). The Business OS row filter is passed in as plain data, so this
 * module still learns nothing about the call catalog (Layer 1.1 RC-7).
 * The window is INCLUSIVE at both ends, like `listCallsInWindow`.
 */
async listGroupCallsForAccountInWindow(
  userId: string,
  sessionId: string,
  window: TokenUsageWindow,
  filter: TokenUsageFeatureFilter,
  opts: { pageSize: number; ceiling: number }
): Promise<RepositoryResult<{ rows: LedgerGroupCallRow[]; reachedCeiling: boolean }>>;
```

- **Query:** `.eq('user_id', userId)`, the `session_id` filter (below), `.gte('created_at', start)`, `.lte('created_at', end)`, `.or(buildFeatureFilterOrExpression(filter))`, `.order('created_at', desc).order('id', desc).range(…)`. The access path is the live `(user_id, created_at DESC)` index with `session_id` and `feature` as residual filters (V-12). **No migration.**
- **The `session_id` filter.** Proposed: `.in('session_id', [lower, upper])`, the B1b OQ-6 precedent. It is correct whether the column is `uuid` (both values parse to one uuid) or `text` (both canonical cases are fetched). A mixed-case `text` value would remain the known R-6 residue. The live check records which type it is ([OQ-3](#open-questions-for-sa)).
- **Guards:** `assertAccount`, the session id a UUID, `assertWindow`, `assertFilter`, page size 1 to 1,000, ceiling 1 to `MAX_CEILING` (5,000). Implemented with the **existing** private guards plus **module-level** helpers only (a session-id check and the variant builder), so no new name lands on the prototype and the contract test's exclusion list is untouched (V-4, [OQ-15](#open-questions-for-sa)). The pager is inline, like `listCallsInWindow`'s.
- **Logged at debug** (account-scoped), with counts only.
- **Header amendment (same commit):** the callers list gains the Activity drill-down (`lib/business-os/credits/aiActivityDrillDownDeps.ts`, reached only from the admin drill-down route after `requireAdmin`). If OQ-2 is approved, "THE ONE ALL-ACCOUNTS READ" also becomes "the two all-accounts reads", naming `summariseFeatureAllAccountsInWindow`.

**Contract test (same commit, NFR-4.1):**

- `EXPECTED_ARITY` gains `listGroupCallsForAccountInWindow: 5`.
- `compileTimeContract` gains a `@ts-expect-error` line that calls the method without its account. That line is compiled by the required `typecheck:bos-llm` (V-5), so a future optional account becomes a **CI failure**, not just a red Jest suite.
- **The pre-existing red** (V-3): if OQ-2 is approved, `summariseFeatureAllAccountsInWindow: 2` is added too, so the pin is green and means something. If not, the pin stays red for the parked reason, and the plan records that its B2b evidence is the new method's **own** arity assertion in `TokenUsageRepository.test.ts` (which CI runs, V-5).

---

### C. Reuse from the list builder: export in place

`lib/business-os/credits/aiActivity.ts` changes **only** as follows (B2a). No line of logic moves or changes:

| Symbol | Change | Why |
|---|---|---|
| `netAdjustments`, `projectEntry`, `joinAuditEntries`, `readAuditEntries`, `readArchiveCutoff`, `settle` | `export` | The drill-down nets, projects and joins exactly as the list does, so the two screens cannot disagree about one action |
| `type AuditRead`, `type ArchiveRead`, `type PageCharge` | `export` | Their signatures |
| `readAuditEntries(pageRows, deps: AiActivityDeps)` | parameter type → `Pick<AiActivityDeps, 'listAuditEntries'>` | A narrower type; the list still passes its full deps |
| `readArchiveCutoff(deps: AiActivityDeps)` | parameter type → `Pick<AiActivityDeps, 'archive'>` | Same. The `'audit_trail'` source literal stays here, in the one file the BD-26 guard allow-lists (V-9) |

The word "usage" is not introduced (V-10). The existing 64 builder tests stay unchanged and must stay green. This is the B1 OQ-9 precedent ("export in place, no move") ([OQ-7](#open-questions-for-sa)).

---

### D. The drill-down builder

**`lib/business-os/credits/aiActivityDrillDown.ts`**, server-only, pure apart from injected dependencies (the `buildAiActivity` pattern).

**Limits:**

```typescript
export const AI_ACTIVITY_DRILL_DOWN_LIMITS = {
  /** Charges of one group on one account. An onboarding conversation is the largest group. */
  GROUP_CHARGES_PAGE_SIZE: 500,
  GROUP_CHARGES_CEILING: 500,
  /** The adjustment lookup's per-request limit. */
  ADJUSTMENT_IDS_PER_REQUEST: 200,
  /** B2b. The leak check's own page and ceiling, so "complete" means the same on both screens. */
  CALLS_PAGE_SIZE: LEAK_CHECK_LIMITS.PAGE_SIZE,
  CALLS_CEILING: LEAK_CHECK_LIMITS.USAGE_CEILING,
  /** B2b. Calls sent to the browser; the check still sums every call read (OQ-6). */
  CALLS_SHOWN: 500,
} as const;
```

**Dependencies:**

```typescript
export interface AiActivityDrillDownDeps {
  ledger: Pick<
    BusinessOsCreditLedgerReadRepository,
    'findChargesByActionIds' | 'listChargesOfGroupForAccount' | 'listAdjustmentsForActionIds'
  >;
  /** Admin-pinned reads, injected by the route (the B1 pattern). */
  findNames: AiActivityDeps['findNames'];
  listAuditEntries: AiActivityDeps['listAuditEntries'];
  archive: AiActivityDeps['archive'];
  /** B2b. Typed against the REAL repository method, never re-declared. */
  calls: Pick<TokenUsageRepository, 'listGroupCallsForAccountInWindow'>;
  now?: () => Date;
}

/** NULL: no such charge, or one this view does not open (the route answers 404). */
export async function buildAiActivityDrillDown(
  actionId: string,
  log: CreditReportLogger,
  deps: AiActivityDrillDownDeps
): Promise<AiActivityDrillDownPayload | null>;
```

**Steps:**

1. **The opened charge.** `findChargesByActionIds([actionId])`. A read failure throws `AiActivityDrillDownReadError` (the route answers 500 with a fixed message, the B1 D-3 precedent). Then **`null`** (404) when there is no row, the row is not `kind = 'charge'`, its `user_id` is NULL (a deleted account: the list never shows it as a row, and there is no account to scope a second read), or its `user_id` is a platform account (impossible by construction, F-20, but refused rather than assumed) ([OQ-9](#open-questions-for-sa)).
2. **The keys, from the row only.** `accountId = charge.user_id`, `groupId = charge.group_id` (lower-case, a `uuid` column). Nothing from the request is used beyond the action id (SA-RC-11).
3. **The group.** `listChargesOfGroupForAccount(accountId, groupId, …)`. Every returned row is checked again in Node: `kind = 'charge'`, `user_id === accountId`, `group_id === groupId`. A row that fails is dropped and counted, and the builder logs at `warn` with ids only (defence in depth; zero by construction). If the opened charge is not in the page (the read was cut), it is added. A failed group read leaves the drawer with the opened charge alone and `group.status: 'failed'`.
4. **Adjustments.** `listAdjustmentsForActionIds` over the group's action ids, in chunks of 200, then `netAdjustments` (reused) with the group's charges as the map. An adjustment that `resolveEffectiveFields` refuses is **counted, never serialised**. A failed or ceiling-cut read sets `adjustments: 'failed'` and every `net: null`, as on the list (B1 D-4). Each charge also carries its own adjustments as a list (date, reason code, cost, credits), which is FR-B12's "the drill-down lists each adjustment".
5. **The audit entries.** `readAuditEntries(groupCharges, deps)` (one grouping id, both cases, the window `[earliest − 1 h, latest + 1 h)`, all accounts), `readArchiveCutoff(deps)`, then `joinAuditEntries(groupCharges, …)`, all reused. Each group charge gets its entry state; another account's entry is counted and never sent (SA-B1-7, AC-B5). The opened charge carries the full `found` projection.
6. **Names.** `findNames([accountId])`. A failure gives `companyName: null` and `names: 'failed'`; the drawer still opens.
7. **The shared-group marker.** `group.chargedActions` is the number of charges read; `group.shared` is `chargedActions > 1`; `group.atLeast` is the ceiling flag. The copy says the calls below cannot be attributed to one action, and the builder never allocates them (requirement `:326`, SA re-check Q1).
8. **(B2b) The calls.** See [§ E](#e-the-group-level-cost-check-b2b) for the window. `deps.calls.listGroupCallsForAccountInWindow(accountId, groupId, window, bosRowFilter(), { pageSize, ceiling })`. Every returned row is checked again in Node: `user_id === accountId` and `session_id` lower-cased `=== groupId`; a failing row is dropped and counted (zero by construction). Each call is projected field by field: time, `component` as the call name, `model_name`, `provider`, input and output tokens, cost, success, and `error_code` through `sanitizeErrorCode` (the writer's own shape, the B1b D-B8 precedent). Calls are sent oldest first, at most `CALLS_SHOWN`, with `read` and `shown` counts.
9. **(B2b) The cost check.** [§ E](#e-the-group-level-cost-check-b2b).

**Payload** (`aiActivityDrillDownTypes.ts`; the client mirror is pinned by a two-way wire test). B2b's members are **absent** from the B2a types, not optional (B1 D-8):

```typescript
export interface AiActivityDrillDownPayload {
  generatedAt: string;
  account: { accountId: string; companyName: string | null };
  names: AiActivityReadStatus;
  /** The opened action's id; it is also one of `group.charges`. */
  actionId: string;
  group: {
    groupId: string;
    status: AiActivityReadStatus;
    /** Charges of this group on THIS account, as read. */
    chargedActions: number;
    shared: boolean;
    /** The read stopped at its ceiling: "at least N". */
    atLeast: boolean;
    /** Newest first. Each carries its own adjustments and entry state. */
    charges: AiActivityDrillDownCharge[];
  };
  adjustments: AiActivityReadStatus;
  unresolvedAdjustments: number;
  unreadableAmounts: number;
  /** The B1b summary type, reused. NULL only if no charge was read. */
  audit: AiActivityAuditSummary | null;
  /** B2b. */
  calls: AiActivityDrillDownCalls;
  /** B2b. */
  costCheck: AiActivityGroupCostCheck;
}

export interface AiActivityDrillDownCharge {
  actionId: string;
  createdAt: string;
  area: string | null;
  actionType: string;
  trigger: AiActivityTrigger;
  outcome: AiActivityOutcome;
  costUsd: AiActivityAmount;
  credits: AiActivityAmount;
  isFallbackPriced: boolean;
  corrected: boolean;
  adjustmentCount: number;
  reasonCodes: string[];
  adjustments: { createdAt: string; reasonCode: string | null; costUsd: number; credits: number }[];
  entry: AiActivityEntryState;
  /** The row the admin opened. */
  opened: boolean;
}
```

The B2b types (`AiActivityDrillDownCalls`, `AiActivityGroupCostCheck`) are in [§ E](#e-the-group-level-cost-check-b2b).

**`aiActivityDrillDownDeps.ts`** wires the non-admin reads only: the three ledger reads, the archive reads (reusing `aiActivityArchive()`), and in B2b the calls read. The admin-pinned reads (`findAdminIdentitiesByUserIds`, `listAiActionEntriesAllAccountsByGroupIds`) are injected by the route, as in B1.

---

### E. The group-level cost check (B2b)

**The calls window (SA-R9),** from the group's charges as read:

- `start = earliest charge − (LONGEST_ACTION_MS + SLACK_MS)` (65 minutes);
- `end = latest charge + SLACK_MS` (60 minutes), inclusive, as `listCallsInWindow` is.

**The check reuses the leak check's classifier verbatim** ([OQ-4](#open-questions-for-sa)):

```typescript
const classification = classifyLeakGroups({
  accountId,
  usageRows: calls,          // LedgerGroupCallRow extends LedgerCallRow, unchanged
  ledgerRows: [...groupCharges, ...adjustments],
  window: { startMs: window.start.getTime(), endMs: window.end.getTime() + 1 },
  periodOf: () => null,      // periods are not shown in the drawer
});
const kase = classification.cases.get(groupId);
```

That gives, by construction and not by copy: the **sum** of the group's charges (net of adjustments, through `resolveEffectiveFields`) against the **sum** of the group's calls, never one charge against a shared group's total; the tolerance `leakTolerance(calls)`; and for a fallback-priced group outside tolerance, `pending_reconciliation` with its direction. The view and the leak check therefore cannot classify one group differently (SA-R3). The builder also returns `toleranceUsd = leakTolerance(calls)`, the two sums and the call count, so the drawer can show both numbers (D-1).

**When the check does not run** (each is a named reason, never a verdict on incomplete evidence):

| Reason | When |
|---|---|
| `calls_read_failed` | The calls read failed |
| `calls_incomplete` | The calls read reached its ceiling |
| `charges_incomplete` | The group read failed or reached its ceiling |
| `adjustments_unread` | The adjustment read failed or reached its ceiling |
| `too_recent` | The newest charge, or any call read, is younger than `LEAK_CHECK_LIMITS.SETTLE_MS` (6 minutes): an action of the same group may still be running, with calls written and no charge yet. The leak check guards against the same phantom by pulling its end back by the same constant (CR4b-S1, `creditLeakCheck.ts:611-617`) ([OQ-5](#open-questions-for-sa)) |

**Wire types:**

```typescript
export interface AiActivityDrillDownCalls {
  status: AiActivityReadStatus;
  window: { start: string; end: string };
  /** Oldest first; at most CALLS_SHOWN. */
  rows: AiActivityDrillDownCall[];
  read: number;
  shown: number;
  reachedCeiling: boolean;
}

export interface AiActivityDrillDownCall {
  createdAt: string;
  callName: string | null;
  model: string | null;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  success: boolean | null;
  errorCode: string | null;
}

export type AiActivityGroupCostCheck =
  | {
      status: 'checked';
      /** The leak check's own case for this group. */
      result: 'matched' | 'undercharged' | 'charged_above_usage' | 'pending_reconciliation';
      /** Only for pending_reconciliation: over (the expected case) or under. */
      direction: 'over' | 'under' | null;
      chargedUsd: number;
      usageUsd: number;
      calls: number;
      toleranceUsd: number;
    }
  | {
      status: 'not_run';
      reason: 'calls_read_failed' | 'calls_incomplete' | 'charges_incomplete' | 'adjustments_unread' | 'too_recent';
    };
```

`uncharged` and `no_spend` cannot occur: the group always has at least the opened charge. If the classifier ever returns one (a shape change), the builder maps it to `not_run` with a `warn` log rather than inventing a label.

**Display.** "Matched within $X for N calls"; "Charged above recorded usage" and "Under-charged" with both figures; "Priced from a fallback rate — over (expected)" or "— under" with both figures, **never** styled as a mismatch (FR-B6). Every state is text plus an icon (AC-B17).

---

### F. The route and its Zod schema

**`app/api/admin/business-os/ai-activity/drill-down/route.ts`**, `GET`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. A structural copy of the list route ([OQ-8](#open-questions-for-sa)).

**Order, and nothing before it:** `requireAdmin(baseLogger)` (401 / 403) → repeated key (400) → strict Zod (400) → the build → 404 when the builder returns `null` → 200.

```typescript
const QuerySchema = z
  .object({ actionId: z.string().uuid('actionId must be a UUID') })
  // Strict: the action id is the ONLY input (SA-RC-11). An accountId, a groupId
  // or any other key is refused, so nothing in the request can steer a read.
  .strict();
```

- **404** body: `{ success: false, error: 'This AI action could not be found' }`, identical for an unknown id, an adjustment's id, a deleted account's charge and a platform account's charge. It reveals nothing (FR-B2).
- **500:** `AiActivityDrillDownReadError` → `'The AI action could not be read. Try again.'`; anything else → `'Internal server error'` with `details` only when `NODE_ENV === 'development'`.
- **Accountability (AC-B8, NFR-3):** one `info` line through `baseLogger.child({ adminId })`, carrying the correlation id, `actionId`, the account id (an id, D-4 permits it), `chargedActions`, `atLeast`, `adjustments`, the audit status, and in B2b `calls.read`, `calls.reachedCeiling`, the cost-check status and result, and `durationMs`. **Never a company name, a model, a provider or a row.**
- **Injected admin reads:** `findNames` → `businessProfileRepository.findAdminIdentitiesByUserIds`; `listAuditEntries` → `auditTrailRepository.listAiActionEntriesAllAccountsByGroupIds({ correlationId, adminId }, …)`. Both are on `ADMIN_METHODS` already, and this route is under `app/api/admin/**` (V-14).

---

### G. The drawer on the Activity tab

**Constraints from the page's source guard:** no `@/lib/` import, no provider or model literal, no `console.*`. Types are re-declared client-side and pinned.

| File | Change |
|---|---|
| `components/activity/ActivityTable.tsx` | A new first column, "Details", with one `<button type="button">` per row. Its accessible name comes from `activityCopy.ts` and includes the action type and time ("Open details for website_copy at 2026-10-04 09:12 UTC"). It calls `onOpen(actionId)` |
| `components/activity/ActivityTab.tsx` | `const [openActionId, setOpenActionId] = useState<string \| null>(null)`; renders `<ActivityDrillDown actionId={openActionId} onClose={…} />`. Not URL-addressable in B2 (OQ-12) |
| `components/activity/ActivityDrillDown.tsx` (new) | The drawer, built on `@/components/ui/sheet` (`Sheet`, `SheetContent`, `SheetTitle`), the `CreditHistoryPanel` precedent (V-15, [OQ-13](#open-questions-for-sa)). Radix gives the focus trap, Escape to close and focus return to the row's button. Fetches `/api/admin/business-os/ai-activity/drill-down?actionId=…` with the tab's newest-request-wins pattern (sequence number plus `AbortController`); a failed read clears the drawer's content; 404 shows "This AI action could not be found". Sections, in order: **Action** (business name and short account id, time, area, action type, trigger, outcome, cost and credits with the struck gross when corrected, the record-state chips); **Corrections** (each adjustment); **Audit entry** (the B1b fields, or the entry state with its reason); **Group** (the shared-group statement, then the group's other charges); and in B2b **Calls** and the **Cost check** line |
| `components/activity/DrillDownCharges.tsx` (new) | The group's charges as a small table, each with `RecordStateMarker` |
| `components/activity/DrillDownCalls.tsx` (new, B2b) | The calls table and the cost-check line. "Showing N of M calls read" when capped. "Unknown" for a null field, never blank |
| `components/activity/RecordStateMarker.tsx` | Prop type widened to `Pick<ActivityRow, 'isFallbackPriced' \| 'corrected' \| 'reasonCodes' \| 'entry'>` (V-16). No behaviour change |
| `activityDrillDownTypes.ts` (new) | Client mirror of the drill-down payload, with the `costTypes.ts` header explaining the duplication |
| `activityCopy.ts` | Every new string: the button's accessible name, section titles, the shared-group sentence, the not-found and error lines, the "calls cannot be attributed" sentence, the cost-check labels and reasons, "Showing N of M calls read" |

Formatting reuses `costFormat.ts` and `format.ts`. Provider and model render as text from the payload; nothing compares them to a literal.

---

### H. The read-only live check (B2b)

**Planned file:** `scripts/check-admin-ai-activity-drilldown.sql`. Read-only, ASCII only, **no apostrophe in any comment**, and **the word "into" nowhere** in a string literal or a comment (the Supabase editor read a label containing it as a `SELECT … INTO` clause, B1 workplan `:752`). It names `business_os_credit_charges`, which is safe: the L8 guard does not walk `scripts/` (V-19).

**Section 1 (run alone, one result set, the editor shows only the last one):** a `VERDICT` row, then PASS/FAIL or INFO rows:

| Row | Expected |
|---|---|
| `token_usage.session_id` data type | PASS when `uuid` (V-11) |
| `token_usage.user_id` data type | PASS when `uuid` |
| An index on `token_usage` whose definition leads with `(user_id, created_at DESC)` | PASS (V-12) |
| All `token_usage` indexes, as one `string_agg` | INFO, for the record |
| The widest span, in days, between the first and last charge of one `(user_id, group_id)` | INFO, for R-3 |
| A recent charge account id and group id, **for block D1** | INFO, values to paste in D1 and D2 |

**Section 2 (each block run alone, literal values):**

- **D1:** `EXPLAIN (ANALYZE, BUFFERS)` of the calls read with the pasted account and group, at **default** settings (the table is large enough for the planner to choose for real). Expected: an index scan on the `(user_id, created_at DESC)` index with `session_id` and `feature` as filters.
- **D2:** `SET enable_seqscan = off;` then `EXPLAIN` of the group charges read. Expected: `business_os_credit_charges_group_idx`.

**Sketch (the plan, not the file):**

```sql
-- Section 1. Run this block alone. Read only. One result set.
SET default_transaction_read_only = on;
WITH col AS (
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'token_usage'
    AND column_name IN ('session_id', 'user_id')
), idx AS (
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'token_usage'
)
SELECT 'session_id type is uuid' AS check_name,
       CASE WHEN (SELECT data_type FROM col WHERE column_name = 'session_id') = 'uuid' THEN 'PASS' ELSE 'FAIL' END AS result,
       (SELECT data_type FROM col WHERE column_name = 'session_id') AS detail
UNION ALL
SELECT 'an index leads with user_id then created_at',
       CASE WHEN EXISTS (SELECT 1 FROM idx WHERE indexdef ILIKE '%(user_id, created_at DESC%') THEN 'PASS' ELSE 'FAIL' END,
       (SELECT string_agg(indexname, ', ' ORDER BY indexname) FROM idx WHERE indexdef ILIKE '%(user_id, created_at DESC%');
```

(The VERDICT row, the INFO rows and section 2 follow the same shape.)

**SQL-text pin:** `supabase/migrations/__tests__/admin-ai-activity-drilldown-check.sql.test.ts`, in a folder CI runs (V-5). It pins: no `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, `GRANT`, `REVOKE` or `TRUNCATE`; section 1 sets `default_transaction_read_only`; no non-ASCII byte; no apostrophe inside a `--` comment; no `\binto\b` anywhere (case-insensitive); a `VERDICT` row exists ([OQ-14](#open-questions-for-sa)).

**No migration is needed** whatever the result, because the access path already exists live (V-12). If section 1 shows `session_id` is `text`, the two-case query of [§ B](#b-tokenusagerepository-one-account-scoped-group-calls-read-b2b) already covers both canonical cases, and the leak check's exposure to the same case gap is raised to TL as a finding (it is outside this slice).

---

### I. Guards that must be extended

| Guard | Change | Slice | Why |
|---|---|---|---|
| Ledger read repository importer list (`BusinessOsCreditLedgerReadRepository.test.ts:827-858`, exact equality) | Add `lib/business-os/credits/aiActivityDrillDown.ts` (types via `Pick<…>`) and `lib/business-os/credits/aiActivityDrillDownDeps.ts` (calls three reads) | B2a | Red otherwise (V-8) |
| Same file: recording client | Confirm it carries every builder method the new query chains (`eq`, `order`, `range`); add any that is missing | B2a | The new method's tests |
| `serviceColumn.guard.test.ts:63-84`, `:100-106` | Add the drill-down route next to `ACTIVITY_ROUTE`, and `activityDrillDownTypes.ts` to `ACTIVITY_SCREEN_MODULES`; add explicit `arrayContaining` entries for the three new `aiActivityDrillDown*` files. New components are covered by the folder walk | B2a | NFR-4.5, "wherever it lives" (V-17) |
| `tokenUsageRepository.contract.test.ts` | `EXPECTED_ARITY` + the `@ts-expect-error` line; and, per OQ-2, the missing `summariseFeatureAllAccountsInWindow` entry | B2b | NFR-4.1 (V-3) |
| `aiActivity.test.ts:940-962` (AC-B7 list pin) | **No change.** It must stay green: the list files stay free of `token_usage` and `usage` (V-10) | B2a, B2b | The list never reads `token_usage` |
| `adminReadMethods.guard.test.ts` | **No change.** The drill-down route is under `app/api/admin/**` (V-14) | B2a | |
| `ownerAuditReads.guard.test.ts` | **No change.** The drill-down files do not name `'audit_trail'`; the archive source literal stays in `aiActivity.ts` (V-9) | B2a | |
| Page `source.guard.test.ts` | **No change.** It walks the folder and covers the new components | B2a | |
| Admin authz surface guard | **No change.** The new route gates with `requireAdmin` first (B1 V-23) | B2a | Required check |
| `aiActivity.wireTypes.test.ts` pattern | New `aiActivityDrillDown.wireTypes.test.ts`: two-way `Satisfies<>` between the server and client drill-down payloads | B2a (+B2b) | Enforced by `typecheck:bos-llm`, not Jest |

---

### J. The console.* audit

Counted on 2026-10-04 with `grep -c 'console\.'` at `7eac5b98`. **Every file this plan modifies, and every file it newly imports, has 0 calls.** There is nothing to flag or convert.

| File | `console.*` |
|---|---|
| `lib/repositories/TokenUsageRepository.ts` | 0 |
| `lib/repositories/BusinessOsCreditLedgerReadRepository.ts` | 0 |
| `lib/business-os/credits/aiActivity.ts` | 0 |
| `lib/business-os/credits/creditLeakCheck.ts`, `creditLeakCheckTypes.ts`, `effectiveFields.ts` (imported) | 0 |
| `lib/business-os/llm/aiActionAudit.ts`, `callCatalog.ts` (imported) | 0 |
| `lib/repositories/AuditTrailRepository.ts`, `ArchiveRepository.ts`, `BusinessProfileRepository.ts` (called, not modified) | 0 |
| `app/admin/business-os-llm/components/activity/*.tsx` (all eight), `activityCopy.ts`, `activityTypes.ts`, `costFormat.ts`, `format.ts`, `components/Chip.tsx` | 0 |
| `components/ui/sheet.tsx` (imported) | 0 |
| Test files to extend: `TokenUsageRepository.test.ts`, `BusinessOsCreditLedgerReadRepository.test.ts`, `tokenUsageRepository.contract.test.ts`, `serviceColumn.guard.test.ts`, `aiActivity.test.ts`, `activityTab.render.test.tsx`; helper `tests/helpers/fakePostgrest.ts` | 0 |

---

## Files to Create / Modify

| File | Action | Slice | Change |
|---|---|---|---|
| `lib/repositories/BusinessOsCreditLedgerReadRepository.ts` | modify | B2a | `listChargesOfGroupForAccount`; header (callers, account-scoped reads) |
| `lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts` | modify | B2a | Method tests; importer list (+2 files) |
| `lib/business-os/credits/aiActivity.ts` | modify | B2a | `export` on six functions and three types; two parameter types narrowed to `Pick` ([§ C](#c-reuse-from-the-list-builder-export-in-place)) |
| `lib/business-os/credits/aiActivityDrillDownTypes.ts` | create | B2a (+B2b) | Wire types |
| `lib/business-os/credits/aiActivityDrillDown.ts` | create | B2a (+B2b) | Builder, limits, read error |
| `lib/business-os/credits/aiActivityDrillDownDeps.ts` | create | B2a (+B2b) | Non-admin wiring |
| `lib/business-os/credits/__tests__/aiActivityDrillDown.test.ts` | create | B2a (+B2b) | Builder tests |
| `lib/business-os/credits/__tests__/aiActivityDrillDown.wireTypes.test.ts` | create | B2a | Two-way type pin |
| `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts` | modify | B2a | Route, screen module, explicit entries |
| `app/api/admin/business-os/ai-activity/drill-down/route.ts` | create | B2a (+B2b log fields) | The route |
| `app/api/admin/business-os/ai-activity/drill-down/__tests__/route.test.ts` | create | B2a (+B2b) | Integration tests |
| `app/admin/business-os-llm/activityDrillDownTypes.ts` | create | B2a (+B2b) | Client mirror |
| `app/admin/business-os-llm/activityCopy.ts` | modify | B2a (+B2b) | Strings |
| `app/admin/business-os-llm/components/activity/ActivityTable.tsx` | modify | B2a | Details button column |
| `app/admin/business-os-llm/components/activity/ActivityTab.tsx` | modify | B2a | Open-action state, drawer |
| `app/admin/business-os-llm/components/activity/RecordStateMarker.tsx` | modify | B2a | Prop widened to `Pick` |
| `app/admin/business-os-llm/components/activity/ActivityDrillDown.tsx` | create | B2a (+B2b sections) | The drawer |
| `app/admin/business-os-llm/components/activity/DrillDownCharges.tsx` | create | B2a | The group's charges |
| `app/admin/business-os-llm/components/activity/DrillDownCalls.tsx` | create | B2b | Calls and the cost-check line |
| `app/admin/business-os-llm/__tests__/activityDrillDown.render.test.tsx` | create | B2a (+B2b) | jsdom render tests |
| `lib/repositories/TokenUsageRepository.ts` | modify | B2b | Row type, column list, method, header |
| `lib/repositories/__tests__/TokenUsageRepository.test.ts` | modify | B2b | Method tests, including its own arity assertion |
| `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` | modify | B2b | `EXPECTED_ARITY`, `@ts-expect-error` line; per OQ-2 the missing entry |
| `scripts/check-admin-ai-activity-drilldown.sql` | create | B2b | Read-only live check ([§ H](#h-the-read-only-live-check-b2b)) |
| `supabase/migrations/__tests__/admin-ai-activity-drilldown-check.sql.test.ts` | create | B2b | SQL-text pin |

**Not touched:** any migration; `lib/repositories/index.ts` (the drill-down imports from the modules directly, the B1b D-B6 precedent); `AuditTrailRepository.ts` and its guard; the list route and `aiActivityDeps.ts`; `creditLeakCheck.ts` and the leak-check route (reused, not modified); `page.tsx`; `app/admin/audit-trail/**`; the sidebar; every owner surface; the writer repository and `runAiAction`.

---

## Task List

### B2a

**SA items folded into B2a (SA Review — 2026-10-04):** SA-B2-7 (list ↔ drawer parity test, both builders over one charge, one adjustment and its entry), SA-B2-8 (the route lower-cases `actionId` after Zod, before the lookup, the `opened` flag, the "add if missing" check and the log line; the builder normalises too, as defence), SA-B2-9 (group rows narrowed with a type guard, never `as`; no drill-down file reads `.service`), SA-B2-10 (ledger repository header: the "BY UNIQUE ID" bullet and `findChargesByActionIds`'s doc name the drill-down's entry read), SA-B2-11 (new render tests route by exact path; the tab's `activityCalls` helper also matches the list path exactly, so a drill-down fetch is never counted as a list fetch; the drawer passes `settleMinutes` to `RecordStateMarker`). Rulings applied: OQ-7, OQ-8, OQ-9, OQ-10, OQ-12, OQ-13.

**T0 — Branch.**
- ✅ RM cut `feature/admin-ai-activity-b2` from `origin/main` `7eac5b98`. Dev confirmed it with `git branch --show-current` (worktree `neuronforge-ai-activity`) and recorded it in this header.

**T1 — Ledger repository.**
- ✅ `listChargesOfGroupForAccount` with guards and pager; header amendment ([§ A](#a-the-ledger-read-repository-one-account-scoped-group-read)), plus SA-B2-10 (the "BY UNIQUE ID" bullet and `findChargesByActionIds`'s doc).
- ✅ Tests: account and group both in the recorded query; no `created_at` bound; `kind = 'charge'`; order; paging and the `>=` ceiling; malformed account or group refused before any query; no `service` (by source, method body); the file-wide write-verb pin unchanged and green.
- ✅ Importer list extended (+2).

**T2 — Reuse from the list builder.**
- ✅ `export` and the two `Pick` narrowings in `aiActivity.ts` ([§ C](#c-reuse-from-the-list-builder-export-in-place)). The list-builder tests and the AC-B7 source pin run green, unchanged.
- ✅ `RecordStateMarker` prop widened; the existing render tests run green, unchanged.

**T3 — Types.**
- ✅ `aiActivityDrillDownTypes.ts` (B2a members), client mirror, two-way wire pin.

**T4 — Builder (steps 1 to 7).**
- ✅ `aiActivityDrillDown.ts`, `aiActivityDrillDownDeps.ts`.
- ✅ Builder tests with fakes typed against the **real** signatures (`jest.Mock<ReturnType<F>, Parameters<F>>` through a `fake<F>()` helper, the SA-CR-1 fix). No `as unknown as`, no `as never` in tests. Includes the SA-B2-7 parity test.

**T5 — Route.**
- ✅ Route and integration tests ([§ F](#f-the-route-and-its-zod-schema)), including SA-B2-8's upper-case id.

**T6 — Drawer.**
- ✅ Details column, open state, `ActivityDrillDown.tsx`, `DrillDownCharges.tsx`, copy; render tests (exact-path routing, SA-B2-11).

**T7 — Guards.**
- ✅ Service-column guard extended ([§ I](#i-guards-that-must-be-extended)).

**T8 — Local verification.**
- ✅ L-1 to L-7 ([Verification Plan](#verification-plan)); results in [Implementation Notes (B2a)](#implementation-notes-b2a).

**T9 — Production checks (user, after B2a deploys).**
- [ ] P-1 to P-4. **OWED BY THE USER** after deploy.

### B2b

**T10 — Branch.**
- [ ] RM cuts the B2b branch from `origin/main` after B2a merges. Dev confirms it.

**T11 — Live check script.**
- [ ] `scripts/check-admin-ai-activity-drilldown.sql` and its SQL-text pin ([§ H](#h-the-read-only-live-check-b2b)).

**T12 — Checkpoint: user runs the live check (read-only).**
- [ ] **OWED BY THE USER.** Section 1 alone, then D1 and D2, each alone, in a fresh editor tab. Output pasted into this workplan. Dev records the verdict. Not a merge blocker if `session_id` is `uuid` and D1 uses the account index; otherwise SA rules before code review.

**T13 — TokenUsageRepository.**
- [ ] Row type, column list, method, header ([§ B](#b-tokenusagerepository-one-account-scoped-group-calls-read-b2b)).
- [ ] Repository tests; contract pin per OQ-2.

**T14 — Builder steps 8 and 9.**
- [ ] Calls read, projection, Node re-check, cap; the cost check through `classifyLeakGroups` ([§ E](#e-the-group-level-cost-check-b2b)); builder tests.

**T15 — Route.**
- [ ] Calls deps wiring; B2b log fields; route tests.

**T16 — Drawer.**
- [ ] `DrillDownCalls.tsx`, the cost-check line, copy; render tests.

**T17 — Local verification.**
- [ ] L-1 to L-7 again, including the contract test.

**T18 — Production checks (user, after B2b deploys).**
- [ ] P-5 to P-8.

---

## Test Plan

**Gates versus evidence (NFR-9).** ts-jest does not type-check, so a Jest pass proves behaviour, never types. The **required checks on `main`** are the gates: **Admin authz surface guard**, **Type check (Business OS LLM attribution)** (`npm run typecheck:bos-llm`, which compiles `lib/business-os/credits/**`, the wire pins, the contract test's `@ts-expect-error` lines and the direct importers, i.e. the route), **Build**, and **React hooks rules guard** (`npm run lint:hooks`). **"Business OS entitlements invariants"** (`npm run test:bos-entitlements`) also runs on every PR and is the only CI job that runs Jest over this slice's repository and builder suites (V-5); it has caught guard breakages twice (the credit-lots L8 guard, the BD-26 owner-read guard), so it must be green before merge too. Everything else below (the route suites, the render suites, the contract test's runtime half) is **evidence**: Dev runs it and pastes the output.

### Mapping to the acceptance criteria in B2's scope

| AC | B2 part | Evidence (test file → what it asserts) | Slice |
|---|---|---|---|
| **AC-B2** | Opened by action id only; lists the charge, its adjustments, the entry's fields, and the group's calls (time, call name, model, provider, tokens, cost, success) read by group **and** account from the charge row; for a one-action group the listed calls sum to the check's usage figure; unknown id → 404, nothing revealed | Route: only `actionId` is accepted; 404 body identical for unknown, adjustment id, deleted-account and platform-account charges. Builder: the group read and (B2b) the calls read are called with the **charge's** `user_id` and `group_id`. B2b builder: one-action group, `sum(rows.costUsd) === costCheck.usageUsd`. Render: every section | B2a, calls B2b |
| **AC-B5** (drill-down half) | Two accounts' charges share one `group_id`: the drawer of A lists only A's charges and (B2b) only A's calls; B's audit entry never serialised; a group of two charged actions of one account → "shared by 2 actions", calls not attributed; a request carrying another account's id alongside the action id cannot widen the read | Builder, seeded: A and B share a group; the ledger fake returns a B row anyway → dropped and counted, and B's markers absent from `JSON.stringify(payload)`. B2b: the calls fake returns a B row anyway → dropped. Two own charges → `shared: true`, `chargedActions: 2`, no per-charge call field exists in the type. Route: `?actionId=…&accountId=<B>` → **400** and **no read** (strict); the reads that do run carry the charge's values (asserted on the recorded calls). Route-level: B's entry markers absent from the HTTP body | B2a, calls B2b |
| **AC-B7** (drill-down half) | A group of two charges is compared as the **sum** of both against the group's calls with `leakTolerance`, and is not marked when they agree; a fallback-priced charge shows its direction, not a mismatch; the list's query path still reads no `token_usage` | B2b builder: two charges summing to the calls within `leakTolerance(n)` → `matched`; just outside → `undercharged` / `charged_above_usage`; fallback-priced outside tolerance → `pending_reconciliation` with `over` and with `under`; the verdict equals `classifyLeakGroups` called directly on the same rows (the "never classify differently" property). The AC-B7 list pin (`aiActivity.test.ts:940-962`) stays green. The $0.0001 half is **B3** | B2b |
| **AC-B8** | Read-only; one `info` line with admin, correlation id and the action id; no business name | Route: a logger spy sees exactly one `info` with `adminId`, the correlation id and `actionId`; `JSON.stringify` of every log call contains no seeded company name, model or provider. No write verb in any diff (review) | B2a, B2b |
| **AC-B13** (drill-down) | No prompt, owner text, output, error message or email anywhere in the response | Builder: an entry whose `details` carries `prompt`, `ownerText`, `output`, `errorMessage` with markers → none in the payload (projection reused). B2b repository: the recorded select is `TOKEN_USAGE_COLUMNS.groupCall` and contains none of `request_payload`, `response_metadata`, `metadata`, `error_message`, `*`; fixture rows carry `SECRET` strings that never reach the result. Builder: a free-text `error_code` is dropped by `sanitizeErrorCode` | B2a, B2b |
| **AC-B14** (drill-down route) | 401; 403; a request without a valid action id → 400; happy path; `requireAdmin` first; authz guard passes | Route: 401, 403 (and 403 not 400 for a non-admin with a bad query), missing / non-UUID / repeated `actionId` → 400, an extra key → 400, 404, 200, production 500 without `details`. A source test asserts `requireAdmin` is the first statement (the only first-ness check that exists, B1 QA M-5) | B2a |
| **AC-B15** (B2 part) | No inline client; the ledger group read is account-scoped; header amended; importer list and service-column guard extended; the new `TokenUsageRepository` method is account-scoped, extends `EXPECTED_ARITY` in the same commit, imports nothing from `lib/business-os/**`, uses a column list without the three excluded columns | Repository tests; importer list; service-column guard run; contract test (runtime half, evidence) and its `@ts-expect-error` line (gated by `typecheck:bos-llm`); the RC-7 import-ban assertion unchanged and green | B2a, B2b |
| **AC-B17** (drawer) | Keyboard operable; labelled; shared-group, fallback direction, cost-check results and entry states distinguishable without colour | Render: the Details button has an accessible name; the drawer has a title (`SheetTitle`); every state renders **text**; Escape closes and focus returns to the row's button (jsdom with the Radix primitive). QA keyboard pass (manual) | B2a, B2b |
| **AC-B18** | No owner surface changed | Diff review; `listOwnerEntries` exclusion suite green | B2a, B2b |
| **AC-B19** (drill-down half) | The drill-down lists each adjustment; one written in a later period still nets | Builder: an adjustment with `created_at` months later is listed under its charge and netted; a cross-account adjustment is counted, not listed. Adjustments are seeded, since none exist live (FR-B12) | B2a |

**Not in B2:** AC-B4, AC-B6 (Q2 half), AC-B9, AC-B10, AC-B21 and the list-level half of AC-B7 (B3).

### Mutation checks (Dev runs each alone, restores byte-exact, records sha256)

| # | Mutation | Expected |
|---|---|---|
| M1 | Ledger group read drops `.eq('user_id', …)` | Repository test red |
| M2 | Builder takes the account for the second reads from a parameter instead of the charge row | Builder AC-B5 test red |
| M3 | Builder drops the Node re-check of `user_id` on group rows (B2a) / call rows (B2b) | Builder AC-B5 test red |
| M4 | (B2b) Cost check compares the opened charge alone, not the group's sum | Two-charge test red |
| M5 | (B2b) Tolerance replaced with a fixed 0.0001 | Boundary test red |
| M6 | (B2b) Token read drops `.eq('user_id', …)` | Repository test red |
| M7 | (B2b) `too_recent` boundary uses `>=` instead of `>` | Boundary test (5m59s / 6m00s / 6m01s) red |
| M8 | Route schema loses `.strict()` | Route "extra key → 400" red |

---

## Verification Plan

### Local (Dev, then QA re-runs)

| # | Command | Pass condition | Note |
|---|---|---|---|
| L-1 | `npx jest lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts lib/repositories/__tests__/TokenUsageRepository.test.ts lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts lib/business-os/credits app/api/admin/business-os/ai-activity app/admin/business-os-llm lib/repositories/__tests__/adminReadMethods.guard.test.ts lib/audit/__tests__/ownerAuditReads.guard.test.ts supabase/migrations/__tests__ lib/admin/__tests__/admin-authz-surface.guard.test.ts` | All green except the known pre-existing reds, each named: `creditPeriod.test.ts` (CRLF on Windows checkouts, B1 QA) and, unless OQ-2 is approved, the contract arity test (V-3) | Evidence |
| L-2 | `npm run typecheck:bos-llm` and `npm run typecheck:bos-llm -- --list` | Exit 0, **0 new** baseline entries. `--list` shows the three `aiActivityDrillDown*` files as `core` and the drill-down route in scope | **Required check** |
| L-3 | Scoped `tsc` over the files the gate does not cover (both repositories, the route test, the screen files, the render test, `RecordStateMarker.tsx`): a scratch `tsconfig` **in the session scratchpad** extending the repo's, `"include": []`, `"files": [those files]`, run as `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p <scratch>`. Output to a file; check `tsc`'s own exit code; filter diagnostics to touched files. **Never** `npx tsc --noEmit -p tsconfig.json` | No diagnostic in a touched file | **Canary first:** plant `const b2Canary: number = 'x'` in a touched file, confirm TS2322 and a non-zero exit, remove it, confirm the file is byte-identical. A run that OOMs prints nothing and reads as clean |
| L-4 | `npx eslint` on every touched file; `npm run lint:hooks` | 0 errors, 0 warnings; exit 0 | `lint:hooks` is a **required check** |
| L-5 | `npm run build` | Compiles and emits the new route | This worktree has no `.env.local`, so page-data collection stops (B1 L-5). **The PR's Build check is the gate** |
| L-6 | `npm run schema:check` | QA confirms every selected `token_usage` column is in the tracker's insert (`aiAnalytics.ts:151-176`) and in the live column list from section 1 | Constant-built selects are a known blind spot |
| L-7 | `npm run test:bos-entitlements` | Green | The CI job that runs this slice's repository and builder suites (V-5) |
| L-8 | Manual, `npm run dev`, signed in as an admin | Open a row, read every section, close with Escape, keyboard only | QA records it (E2E is not set up) |

### Production checks owed by the user

| # | When | Check | Record |
|---|---|---|---|
| P-0 | B2b, before code review (T12) | Live check section 1, D1, D2 pasted; verdict recorded | Here |
| P-1 | After B2a deploys | On `/admin/business-os-llm?tab=activity`, the Details button of a recent row opens the drawer; the charge's figures match the row; Escape closes and focus returns to the button | QA report |
| P-2 | After B2a | A `briefing_narration` row from a day with a re-narration (deterministic same-day group, F-13) shows "shared by 2 actions"; any other row shows one | QA report |
| P-3 | After B2a | The drawer's audit entry fields match the entry on `/admin/audit-trail` | QA report |
| P-4 | After B2a | `GET /api/admin/business-os/ai-activity/drill-down?actionId=<random uuid>` → 404; `?actionId=<real>&accountId=<other>` → 400; the Vercel log line carries ids and counts, no company name | QA report |
| P-5 | After B2b deploys | For a recent row, the drawer's calls match `/admin/analytics` drill-down filtered to that business and session; their count matches the entry's call count for a one-action group | QA report |
| P-6 | After B2b | The cost check reads "matched" for ordinary rows; for any non-matched row, the leak check on the Costs & credits tab, run for that business and day, classifies the same group the same way | QA report |
| P-7 | After B2b | `durationMs` of the drill-down log line for an ordinary row and for the largest onboarding group (R-3) | Here |
| P-8 | After B2b | A fallback-priced row, if any exists (F-21 recorded 0), shows its direction and no mismatch styling. If none exists, recorded as "not observable", covered by the seeded test | QA report |

### Rollback

- **Code:** revert the PR. The drawer and the route are additive; the list is unchanged apart from a button.
- **Nothing in the database** is created or changed.

---

## Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | **The contract pin is red today and was parked by the user** (V-3). B2b's "extend `EXPECTED_ARITY`" is meaningless evidence while the map is wrong for another reason | Certain / low | OQ-2 to TL/user. Either way, the new method gets its own arity assertion in `TokenUsageRepository.test.ts`, which CI runs (V-5), and its compile-time contract line is gated |
| R-2 | **`session_id` might be `text`** (V-11): upper-case client turn ids would be stored as sent | Low / medium | Two-case `IN` (OQ-3); the live check records the type; a mixed-case residue stays visible as an unmatched or uncharged group, never hidden; the same exposure in the leak check is raised to TL |
| R-3 | **A long-lived group** (an onboarding conversation over weeks) widens the calls window, so the account's `(user_id, created_at)` range scanned grows | Low / low | Per-account only; bounded by the ceiling and the account's own volume (about 116 actions a month, NFR-6); D1 and P-7 measure it; a `session_id` index is **not** proposed without evidence |
| R-4 | **Payload size**: up to 5,000 calls | Low / medium | At most `CALLS_SHOWN` (500) are sent; the check sums all read (OQ-6) |
| R-5 | **A still-running action in a shared group** makes a phantom under-charge | Medium / low | `too_recent` for 6 minutes (`SETTLE_MS`), mirroring the leak check (OQ-5) |
| R-6 | **Coupling to the leak check's classifier**: a future change to it changes the drawer | Certain / positive | Intended (SA-R3): the two screens cannot disagree. A builder test compares the drawer's verdict with a direct `classifyLeakGroups` call, so a shape change surfaces as a red test, and an unexpected case maps to `not_run` with a `warn` |
| R-7 | **The `aiActivity.ts` exports** change list behaviour by accident | Low / medium | Keywords and two parameter types only; the 64 list-builder tests and the AC-B7 source pin are run unchanged before anything else (T2) |
| R-8 | **A new private method on `TokenUsageRepository`** turns the contract test red through its exclusion list (V-4) | Medium if missed / low | Module-level helpers only (OQ-15) |
| R-9 | **The `Sheet` styling** uses `var(--v2-bg)` and z-50 on a slate admin page | Medium / low | `className` override for the admin palette; P-1 visual check. The admin dialogs already sit above it (z-[60]) and none opens from the drawer |
| R-10 | **ts-jest does not type-check**: a fake re-declared loosely hides a shape drift | Medium / medium | Fakes typed from the real signatures; no `as unknown as` or `as never` in tests (SA-CR-1 lesson); scoped `tsc` with a canary (L-3) |
| R-11 | **The editor breaks on the check script** (a word read as `INTO`, an apostrophe in a comment, non-ASCII) | Medium / low | The SQL-text pin enforces all three; each section is runnable alone; fresh tab |
| R-12 | **Agent file-write truncation** (project memory) | Low / high | `git diff --stat` on every modified file before reading the diff; a deletion without insertion is a stop |

---

## Non-Goals

1. **No migration and no index.** The live access paths exist (V-7, V-12).
2. **No change to the list's query, payload or `token_usage` posture.** The list still never reads `token_usage` (SA-RC-4).
3. **No FR-B6 item 1, no reverse pass, no leak-check section, no deep link** (B3).
4. **No change to the leak check or its route.** Its classifier and constants are imported, never edited.
5. **No URL state for the drawer** (OQ-12).
6. **No new admin authorisation pattern.** `requireAdmin` first; the layout guards the page.

---

## Open Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| **OQ-1** | **The split** into B2a (ledger and audit drawer, ~2 days) and B2b (calls and the group cost check, ~2 days)? | Split. B2a needs no decision from anyone; B2b carries every `token_usage` risk |
| **OQ-2** | **The pre-existing red contract pin** (V-3). The user parked it on 2026-09-24. B2b must edit that exact map. May B2b add the missing `summariseFeatureAllAccountsInWindow: 2` and correct the header's "THE ONE ALL-ACCOUNTS READ" in the same commit? This needs TL to confirm with the user, because the item was parked by the user | Yes: two lines, in a file B2b must edit anyway, and it is the only way the pin becomes evidence again. If the user declines, the plan stands as written in § B (the new method's own arity assertion) |
| **OQ-3** | **The `session_id` filter**: `.in('session_id', [lower, upper])` unconditionally (the B1b OQ-6 precedent), or `.eq` relying on the column being `uuid` once the live check confirms it? | Two-case `IN`: correct for either type and not blocked on the live check. Classifier input is passed unmodified, so the drawer and the leak check stay identical even in the `text` case |
| **OQ-4** | **Reuse `classifyLeakGroups` verbatim** for FR-B6 item 2, rather than re-implementing the comparison around `leakTolerance`? | Verbatim reuse. SA-R3's "never classify differently" then holds by construction, and the fallback direction comes from the same code |
| **OQ-5** | **`too_recent` for the cost check**: not run while the newest charge or any call read is younger than `SETTLE_MS` (6 min)? The leak check instead pulls its window's end back | As proposed. Pulling the end back in the drawer would hide the newest action's own calls for 6 minutes and produce a phantom "charged above usage" |
| **OQ-6** | **Ceilings**: group charges 500; calls read up to 5,000 (the leak check's `USAGE_CEILING`), sent up to 500 | As proposed |
| **OQ-7** | **Export in place** six functions and three types from `aiActivity.ts`, with two parameter types narrowed to `Pick`, or move them to a shared module? | Export in place (the OQ-9 precedent): no line of logic moves |
| **OQ-8** | **Route shape**: `GET …/ai-activity/drill-down?actionId=` with a strict one-key schema, or a path segment `…/ai-activity/[actionId]`? | Query parameter: the list route's repeated-key and strict-schema code is reused as is, and an extra key such as `accountId` is a 400 rather than silently ignored |
| **OQ-9** | **404 for a deleted-account charge and a platform-account charge**, with the same body as an unknown id? | Yes. The list never offers either as a row, and one "not found" reveals nothing |
| **OQ-10** | **The shared-group marker on the list**: not built (it needs a cross-row read per page); the drawer carries it. Confirm | Drawer only |
| **OQ-11** | **FR-B6 item 1 stays in B3**, including inside the drawer, and B2 does not project `estimatedCostUsd`, so the drawer never shows two cost figures without D-1's marker. Or pull item 1 forward into the drawer (about half a day)? | Keep it in B3 |
| **OQ-12** | **The entry projection in the drawer** is exactly B1b's (calls, failed calls, tokens, models, error code); no `callNames`, `areas` or `estimatedCostUsd` | As proposed. The calls table already shows each call's name |
| **OQ-13** | **The drawer primitive**: `@/components/ui/sheet` imported from the page folder, which passes the source guard's letter (it bans `@/lib/` specifiers) while bringing `@/lib/utils` in transitively, as the approved picker reuse brings `@/lib/logger` | Reuse `Sheet` (the `CreditHistoryPanel` precedent) with a one-line comment at the import |
| **OQ-14** | **The check script's pin test** lives in `supabase/migrations/__tests__/` so CI runs it, although the script is in `scripts/` | As proposed |
| **OQ-15** | **New `TokenUsageRepository` helpers as module-level functions**, so the contract test's private-name exclusion list does not change (V-4) | As proposed |

---

## Implementation Notes (B2a)

**Dev, 2026-10-04.** Worktree `neuronforge-ai-activity`, branch `feature/admin-ai-activity-b2`, base `7eac5b98`. **Uncommitted** (nothing staged, committed or pushed). No database access. No SQL file, no migration.

### What was built

| Piece | Where |
|---|---|
| Account-scoped group read `listChargesOfGroupForAccount(userId, groupId, opts)`: `kind = 'charge'` + `user_id` + `group_id`, no time bound, `created_at DESC, id DESC`, de-duplicating pager, `>=` ceiling, guards before any query, debug log | `lib/repositories/BusinessOsCreditLedgerReadRepository.ts` (+ header: callers, the "BY UNIQUE ID" bullet, a new account-scoped bullet; `findChargesByActionIds` doc, SA-B2-10) |
| Export in place: `settle`, `netAdjustments`, `readAuditEntries` (deps → `Pick<…, 'listAuditEntries'>`), `readArchiveCutoff` (deps → `Pick<…, 'archive'>`), `projectEntry`, `joinAuditEntries`; types `PageCharge`, `AuditRead`, `ArchiveRead`. No line of logic changed; the `'audit_trail'` literal stays here only | `lib/business-os/credits/aiActivity.ts` |
| Builder: the charge by id; the four not-found cases → NULL with no second read; keys from the row; the group with a Node re-check (type guard, never `as`); the opened charge added when the read is cut; corrections listed and netted; the reused audit join; names; the shared-group marker | `lib/business-os/credits/aiActivityDrillDown.ts`, wiring `aiActivityDrillDownDeps.ts`, wire types `aiActivityDrillDownTypes.ts` |
| Route `GET /api/admin/business-os/ai-activity/drill-down?actionId=`: `requireAdmin` first, repeated key 400, strict one-key Zod 400, lower-case (SA-B2-8), one 404 body, 500 without internals, one `info` line (ids and counts) for 200 and for 404 | `app/api/admin/business-os/ai-activity/drill-down/route.ts` |
| Drawer on `components/ui/sheet` (OQ-13): Action, Corrections, Audit entry, Grouping id sections; the group table when more than one charge; newest-request-wins fetch; 404, error and network states; focus returned to the row button | `components/activity/ActivityDrillDown.tsx`, `DrillDownCharges.tsx`; Details column in `ActivityTable.tsx`; open state in `ActivityTab.tsx`; strings in `activityCopy.ts`; client mirror `activityDrillDownTypes.ts` |

### Deviations from the plan, and why

| # | Deviation | Why |
|---|---|---|
| D-B2a-1 | `audit` on the drill-down payload is **non-nullable** (the § D sketch had `\| null`) | The drawer always holds at least the opened charge, so the join always returns a summary. A nullable field would be a state the UI can never reach |
| D-B2a-2 | The builder **also** lower-cases the action id, besides the route (SA-B2-8) | Defence for any future caller. The route's own lower-casing is still what the route test and mutation M-case pin (via its log line) |
| D-B2a-3 | A charge row whose `triggered_by` or `outcome` is outside its union is refused as **not found** (NULL, `warn` with ids); a group row of that shape is dropped and counted | SA-B2-9 forbids `as`, and the list casts these two fields. A type guard needs an answer for the impossible value (CHECK `triggered_by_known` / `outcome_known`); refusing is the fail-closed one |
| D-B2a-4 | A charge with no `group_id` (impossible by CHECK `charge_shape`) opens with `group.status: 'failed'`, `groupId: ''`, and no group or audit read | There is no key to read by; the opened charge is still shown honestly |
| D-B2a-5 | `Amount`, `OutcomeLabel` (new, extracted from the table's outcome cell, identical DOM) and `EntryMarker` are **exported** from the existing components | Reuse rather than a second copy of the outcome and entry-state rendering. The existing render tests run unchanged and green |
| D-B2a-6 | The drawer sets an **inline `backgroundColor`** besides the `className` palette override (OQ-13 said "through `className`") | `cn()` in `lib/utils.ts` is a plain join (the `Chip.tsx` header records this), so the sheet's own `bg-[var(--v2-bg,…)]` class ships too and stylesheet order would decide. The inline value makes the admin palette deterministic. P-1 still checks it visually. **SA to confirm** |
| D-B2a-7 | Focus return is done **by hand** in `onCloseAutoFocus` | Radix returns focus only to a Radix `Trigger`; the row button is not one (it is in the table, the drawer in the tab). The tab keeps the opener in a ref and focuses it on close. Pinned by the Escape render test |
| D-B2a-8 | A 404 also writes **one `info` line** (`actionId`, `found: false`, `durationMs`) | Accountability for every admin open (AC-B8), without recording which kind of "not found" it was |
| D-B2a-9 | The existing tab render test's list helpers now match the list path **exactly** (`activityTab.render.test.tsx`, three lines) | SA-B2-11: "no test may count a drill-down fetch as a list fetch". A prefix match would. No assertion changed |
| D-B2a-10 | The group table renders only when the group holds more than one charge | With one charge it would repeat the Action section; the single-charge sentence says it in words |

### Verification (T8)

| # | Command | Result |
|---|---|---|
| Baseline | L-1 set at `7eac5b98`, before any change (without the two `token_usage` suites) | 44 suites, 1,346 tests, all green |
| L-1 | `npx jest` over the full L-1 list | **67 of 68 suites green; 2,206 of 2,207 tests.** The one red is the pre-existing contract pin (V-3: `summariseFeatureAllAccountsInWindow` missing from `EXPECTED_ARITY`), fixed in B2b per SA-B2-1. `TokenUsageRepository.ts` and `lib/business-os/usage/**` are untouched. `creditPeriod.test.ts` passed in this checkout |
| New suites | builder `aiActivityDrillDown.test.ts`, wire pin, route `drill-down/__tests__/route.test.ts`, render `activityDrillDown.render.test.tsx` | All green (render: 19 tests, no `act` warning) |
| L-2 | `npm run typecheck:bos-llm` | **Exit 0, 0 new** (417 files in scope, 28 baseline errors). `--list` shows the three `aiActivityDrillDown*` files and both new test files there as `core`, and the drill-down route as `caller`. It also reported one baseline entry as fixed in `app/api/onboarding/build/route.ts`, a file this slice does not touch; baseline left as is |
| L-3 | Scoped `tsc` (session scratchpad config) over 14 touched files the gate does not cover | **Canary first:** `const b2Canary: number = 'x'` planted in `DrillDownCharges.tsx` → TS2322, exit 2; file restored byte-identical (sha256 `56aa264e…` before and after). Real run: **0 diagnostics in touched files**; 6 in `lib/analytics/aiAnalytics.ts` (untouched, reached transitively, pre-existing). Scratch config deleted |
| L-4 | `npx eslint` on all 20 touched files; `npm run lint:hooks` | 0 errors, 0 warnings; `lint:hooks` exit 0 |
| L-5 | `npm run build` | **Not run.** This worktree has no `.env.local`, so page-data collection stops (B1 L-5). The PR's Build check is the gate |
| L-6 | `npm run schema:check` | Not applicable to B2a: no new column is selected (the existing `CREDIT_LEDGER_ROW_COLUMNS`). It belongs to B2b's `token_usage` column list |
| L-7 | `npm run test:bos-entitlements` | **173 suites, 4,231 tests, all green** |
| Authz | `npm run test:authz-guard` | 119 of 119 green |

### Mutation checks (each alone, restored byte-exact, sha256 checked)

| # | Mutation | Result |
|---|---|---|
| M1 | Group read drops `.eq('user_id', userId)` | Repository suite **red** (2 failed) |
| M2 | Builder keys the second reads on an account that is not the row's | Builder suite **red** (8 failed) |
| M3 | Builder drops the Node `user_id` re-check of group rows | Builder and route suites **red** (2 failed: AC-B5 at builder and at HTTP-body level) |
| M-404 | Builder no longer refuses a platform account's charge | Builder and route suites **red** (2 failed) |
| M-case | Route drops the lower-casing (SA-B2-8) | Route suite **red** (1 failed) |
| M8 | Route schema loses `.strict()` | Route suite **red** (3 failed: `accountId`, `groupId`, another key) |

### Guards extended

Ledger read repository importer list (+`aiActivityDrillDown.ts`, +`aiActivityDrillDownDeps.ts`); `serviceColumn.guard.test.ts` (+the drill-down route, +`activityDrillDownTypes.ts`, explicit entries for the three server files, the route and the two components). **Unchanged and green:** `adminReadMethods.guard` (the route is under `app/api/admin/**`), BD-26 `ownerAuditReads.guard` (no new `'audit_trail'` literal; it stays in `aiActivity.ts`), the page `source.guard` (it walks the new components: no `@/lib/` specifier, no provider or model literal, no `console.*`), the AC-B7 list pin, the credit-lots L8 guard (no SQL), the admin authz surface guard.

### `console.*`

0 in every new file and every modified file.

### SA-CR-B2a / QA fixes (2026-10-04, still uncommitted)

| Item | Fix | Evidence |
|---|---|---|
| SA-CR-B2a-1 (Medium) | `[&>button]:text-slate-300` on the drawer's `SheetContent` `className`; the shared `components/ui/sheet.tsx` is untouched | Render test: the dialog carries the class and the Close button is its direct child. Visual check in light mode stays with QA L-8 / P-1 |
| SA-CR-B2a-2 (Low) | Unused `DRILL_DOWN_FIELDS.groupId` removed from `activityCopy.ts` | Type-check and suites green |
| QA-B2a-1 (Low) | The SA-B2-7 parity test now seeds two corrections whose codes arrive in non-alphabetical order (`manual_correction`, then `fallback_price_reconciled`) and asserts the sorted pair | Mutation: removing `.sort()` from the builder's `reasonCodes` turned the builder suite red (1 failed); restored byte-exact (sha256 `9e5075b3…` before and after) |
| QA-B2a-2 (Low) + SA optional | New `app/admin/business-os-llm/readJsonBody.ts` (never throws; NULL for a body that is not a JSON object). The drawer checks the status first (a 404 shows the not-found line whatever its body), then reads the body safely; `ActivityTab.tsx` reads the list body the same way. A parse failure shows `DRILL_DOWN_ERROR_FALLBACK` / `ACTIVITY_ERROR_FALLBACK`, never parser text. A rejected `fetch` (offline) still shows its own message, as before | Render tests: HTML 502 from the drill-down → fallback; HTML 404 → not-found line; HTML 502 from the list → tab fallback; none contains "Unexpected token" |
| SA optional | Sections use `aria-labelledby` pointing at their heading (`useId`) instead of a duplicate `aria-label` | Render test: the section's `aria-labelledby` equals its heading's id, no `aria-label`, and `getByRole('region', { name })` finds it |
| QA-B2a-4 (info) | Done (trivial): the route's log line reports `chargedActions: null` when `group.status` is `failed`. The payload still carries 1, the charge it shows | Route test asserts `{ group: 'failed', chargedActions: null }` |

Also: the drawer render helper `openFirstRow` now clicks inside an async `act`, because a 404 or an unreadable body settles in the click's own tick (no `act` warnings).

**Re-run after the fixes:** builder, route (both), render (drawer 24, tab and page suites) and ledger repository suites: 15 suites, 633 tests, all green. `typecheck:bos-llm` exit 0, 0 new. Scoped `tsc` over the changed files: canary in `readJsonBody.ts` fired (TS2322) and the file was restored byte-identical; real run 0 diagnostics in touched files. eslint on the changed files clean; `lint:hooks` exit 0; `test:authz-guard` 119/119; `test:bos-entitlements` 173 suites, 4,231 tests, green.

### Owed

- **User, after B2a deploys:** P-1 to P-4 (T9).
- **QA:** L-8 manual check, including SA-CR-B2a-1 with the OS in light mode.

---

## SA Review Notes

### SA Review — 2026-10-04

**Reviewed by SA — 2026-10-04.** Worktree `neuronforge-ai-activity`, branch `feature/admin-ai-activity-b2`, base `7eac5b98`. Only this file is in the tree, and it is untracked. No code, no database access.
**Status:** 🔄 **APPROVED WITH CHANGES.** The design is sound. The drill-down is keyed only by action id, the account and group come from the charge row, and the reads are account-scoped. There is no migration, no new pattern, and the plan reuses the list's join and the leak check's classifier. Twelve changes follow (SA-B2-1 to SA-B2-12). None changes the design. Two matter for correctness: SA-B2-2 (the classifier does not give the drawer its figures as planned) and SA-B2-8 (action-id case).

**Split (OQ-1): approved. Dev implements B2a first, on this branch.** RM cuts the B2b branch from `origin/main` after B2a merges. The seam is right: B2a reads only tables and repositories B1 already reads, and every `token_usage` risk stays in B2b.

**OQ-2: decided by the user on 2026-10-04 (through TL). The answer is option 1: B2b fixes the contract pin.** It is recorded here as the user's answer, not an SA ruling, and it is a B2b requirement (SA-B2-1).

#### 1. Key findings re-verified against the tree

| Finding | Verdict | Evidence |
|---|---|---|
| V-3: contract pin red on `main` | ✅ Confirmed. SA ran `npx jest lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts`: **1 failed, 4 passed**. The received list has the extra `summariseFeatureAllAccountsInWindow` | `TokenUsageRepository.ts:483` (method); `tokenUsageRepository.contract.test.ts:61-69` (`EXPECTED_ARITY`, 7 entries), `:84` (failing assertion); header `:14-18` stale |
| V-4: private methods turn the pin red | ✅ Confirmed. The pin filters `Object.getOwnPropertyNames(prototype)` against a hard-coded list, and TS `private` instance methods are on the prototype. One nuance: `private static` methods (`orExpression` `:258`, `applyMatch` `:264`) are **not** on the prototype. Module-level functions are still the established choice (`buildFeatureFilterOrExpression`'s own comment, `:168-171`) | contract test `:77-83` |
| V-10: "usage" ban in `aiActivity.ts` | ✅ Confirmed. The test strips comments before matching (`aiActivity.test.ts:942-945`), so only **code** in `aiActivity.ts` may never contain `usage` (case-insensitive) (`:956-958`). The three list files may never name `TokenUsageRepository` / `token_usage` (`:946-954`) | as cited |
| V-11: `token_usage.session_id` type is in no repo migration | ✅ Repo half confirmed: the only `token_usage` DDL in either SQL folder is an `ALTER` (`supabase/SQL Scripts/20250113_add_execution_id_to_token_usage.sql:5`). ❌ **But "not verifiable" is wrong.** A live record exists: credit deduction slice 4 workplan `:54` (V-5, **LIVE**, OpenAPI, 2026-09-29) says "`token_usage.session_id` is `uuid`". The B0 workplan `:64` (V-7) reached the same conclusion from code. See SA-B2-4 | as cited |
| V-5: which CI checks run which suites | ✅ Confirmed, with one gap. `test:bos-entitlements` (`package.json:22`, `bos-entitlements.yml:128`) covers `lib/repositories/__tests__`, `lib/business-os/credits/__tests__`, `supabase/migrations/__tests__` and `lib/audit/__tests__`. It does **not** cover `lib/business-os/usage/__tests__` or `app/api/admin/business-os/ai-activity/**`. **Missing from V-5:** the BOS LLM type-check workflow also runs `test:bos-llm` (`bos-llm-typecheck.yml:141`, `package.json:21` = `lib/business-os/llm/__tests__` only). That changes nothing for B2. `typecheck:bos-llm` covers `lib/business-os/usage/` and `lib/business-os/credits/` as core (`scripts/typecheck-bos-llm.ts:102-111`) | as cited |
| V-19: credit-lots L8 guard | ✅ Walks only `supabase/migrations` and `supabase/SQL Scripts` (`business-os-credit-lots.migration.test.ts:773-805`). A script under `scripts/` cannot trip it |
| V-8 / V-14 / V-17 / BD-26 | ✅ Importer exact-equality list `BusinessOsCreditLedgerReadRepository.test.ts:827-858` (text match, so comments count). It also bans `.lte('created_at'` in the repository (`:822-825`); the new method has no time bound, so that is fine. `ADMIN_METHODS` `adminReadMethods.guard.test.ts:479-490` (callers under `app/api/admin/**` only). Service-column list `serviceColumn.guard.test.ts:63-84`. BD-26 allow-list `ownerAuditReads.guard.test.ts:37` (`aiActivity.ts` only) |
| Admin authz surface guard | ✅ No cap change: caps count exemptions only (B1 V-23) |
| `console.*` | ✅ SA spot-checked: 0 in both repositories, `aiActivity.ts`, `creditLeakCheck.ts`, `aiActionAudit.ts`, `callCatalog.ts`, `sheet.tsx`, every `components/activity/*.tsx` and `activityCopy.ts` |

#### 2. Compliance

| Check | Result |
|---|---|
| Tenant isolation (`tenant-isolation-guard`) | ✅ Only `actionId` crosses the boundary. The strict schema refuses `accountId`/`groupId` (400, no read). Account and group come from the charge row. Both second reads are account-scoped by signature and re-checked in Node. Other accounts' audit entries are counted and never serialised (reused `joinAuditEntries`). Cross-account adjustments are counted, never listed or netted. One identical 404 body for unknown / adjustment / deleted-account / platform-account. AC-B5 is tested at builder **and** HTTP-body level. SA-B2-8 closes the one gap: case |
| Repositories only, rule 4 | ✅ One account-scoped method per repository. The service-role use is already documented in both headers (amended per SA-B2-1 / SA-B2-10) |
| Zod strict, `requireAdmin` first | ✅ Structural copy of the list route (`route.ts:134-172`): gate, then the repeated-key check, then `.strict()` |
| Pino + correlationId | ✅ One `info` line with ids and counts only. The builder logs `warn` with ids only |
| Strict TS, no type-defeating test casts | ✅ T4 commits to the `fake<F>()` pattern (SA-CR-1). B2b's repository tests may keep the established `fake.client as unknown as SupabaseClient` idiom; nothing else. See SA-B2-9 |
| PGRST123 | ✅ Every query uses only filter, order and range. All sums happen in Node over bounded reads (≤ 500 charges, ≤ 5,000 calls). **Say so in the Analysis Summary**, as B1 did |
| New pattern | ✅ None. `Sheet` has a precedent (`CreditHistoryPanel.tsx:35`), the injected admin reads are the B1 pattern, and the checker-plus-pin is the B0′ precedent |
| Migration | ✅ **None needed.** The group index exists (`20261015:54`, live per B0′). `(user_id, created_at DESC)` on `token_usage` is in the repo (`20260929_usage_summary.sql:98-99`) and live. The `session_id` type is recorded live |

#### 3. Required changes

| # | Slice | Change | Priority |
|---|---|---|---|
| **SA-B2-1** | B2b | **User decision on OQ-2 (option 1).** In the same commit as the new method: `EXPECTED_ARITY` gains **`summariseFeatureAllAccountsInWindow: 2`** and `listGroupCallsForAccountInWindow: 5`, plus the new method's `@ts-expect-error` line. The header's "THE ONE ALL-ACCOUNTS READ" (`TokenUsageRepository.ts:14-18`) becomes the **two** named all-accounts reads (`listChatCallsAllAccountsInWindow`, `summariseFeatureAllAccountsInWindow`), and the callers list gains the drill-down. The contract test must then be **fully green**: drop the "unless OQ-2" exception from L-1 and R-1. It remains local evidence, because no CI job runs `lib/business-os/usage/__tests__`. Its `@ts-expect-error` lines are gated by `typecheck:bos-llm` | High |
| **SA-B2-2** | B2b | **The classifier does not return what § E reads from it.** `cases` holds only the case label (`creditLeakCheck.ts:205-206`, `:384`). The direction and both sums exist only in `examples`, which are kept **only for non-matched cases** and capped at 20 (`:409-446`), so a `matched` group has no figures at all. The classifier's call count also **excludes known uncharged-path calls** (`:310-320`), so `leakTolerance(<rows read>)` can differ from its own tolerance. **Required:** one **additive, pure** output on `LeakClassification`, for example `groupFigures: Map<groupId, { calls, usageUsd, chargedUsd, direction }>` (rounded like the examples), filled in the existing loop. The drawer takes the case, direction, both sums, the call count and `leakTolerance(<that count>)` from it and **never re-sums**. No existing field, behaviour, route or payload of the leak check changes. Its suites run unchanged and green. Amend Non-Goal 4 and "Not touched" to "`creditLeakCheck.ts`: one additive output". The "equals a direct `classifyLeakGroups` call" test compares the figures as well as the case | High |
| **SA-B2-3** | B2b | **Known uncharged-path calls.** A call for which the exported `isKnownUnchargedPath(feature, component)` is true is listed but marked "not charged by design", and it is excluded from the usage figure. AC-B2's "the listed calls sum to the check's figure" then holds by construction. Test it. Never copy the key set | Medium |
| **SA-B2-4** | B2b | **OQ-3: `.eq('session_id', groupId)`, not the two-case `IN`.** The column is recorded live as `uuid` (slice 4 workplan `:54`), so Postgres canonicalises case and a second form fetches nothing. The leak check also groups by the value as read. The Node re-check becomes exact equality. Section 1's type row stays as reconfirmation, with **no code branch for `text`**: if it ever reads `text`, stop and come back to SA. Update V-11, R-2 and the § H text-case paragraph | Medium |
| **SA-B2-5** | B2b | **Which 500 calls are shown.** "Oldest first, at most 500" drops the opened action's own calls whenever it is the newest action in a long group (an onboarding conversation), which is exactly the case where an admin needs them. When more than `CALLS_SHOWN` are read, send the 500 **nearest in time to the opened charge**, then order them oldest first. Copy: "Showing N of M calls read, nearest to this action". The check still sums every call read | Medium |
| **SA-B2-6** | B2b | **Check script, following the in-repo precedent** (`scripts/check-bos-credit-charges-activity-indexes.sql`, pinned at `business-os-credit-charges-activity-indexes.migration.test.ts:136-175`). Each EXPLAIN block is self-contained: `BEGIN READ ONLY; SET LOCAL …; EXPLAIN (ANALYZE, BUFFERS) …; ROLLBACK;`. **Never** the session-level `SET enable_seqscan = off;` that § H's D2 shows, because it outlives the block on the editor's connection. Prove D1 under a **generic plan** too (`PREPARE` + `SET LOCAL plan_cache_mode = force_generic_plan`), the way PostgREST runs it, as B0′ did. The pin also asserts that every block ends `ROLLBACK;` and that there is no `COMMIT`. Its ASCII, no-apostrophe-in-comment and no-`into` checks run on the **raw** text, comments and literals included. The account and group row prints ids only. T12 no longer gates the design (SA-B2-4). It is evidence owed before B2b's code review | Medium |
| **SA-B2-7** | B2a | **List ↔ drawer parity.** The per-charge projection (area, trigger, outcome, gross and net cost and credits, `corrected`, reason codes) is inline in `buildAiActivity` (`aiActivity.ts:410-440`). It is not one of the functions § C exports, so "the two screens cannot disagree" does not hold by construction for those fields. Required: a builder test that feeds one charge, one adjustment and its entry through **both** builders and asserts the drawer's opened charge deep-equals the list row on every shared field. Extracting the projection into one exported helper is an acceptable alternative, provided the 64 list tests stay unchanged | Medium |
| **SA-B2-8** | B2a | **Normalise the action id.** Zod `.uuid()` and the repository's `UUID_PATTERN` (`:236`) both accept upper case, and `action_id` reads back lower-case. An upper-case request would therefore get `opened: false` on every charge, and the opened charge would be "added" a second time. Lower-case the id after Zod, before the lookup, the `opened` flag, the "add if missing" check and the log line. Add a route test with an upper-case id | Medium |
| **SA-B2-9** | B2a | Narrow group rows to `PageCharge` with a **type guard** (`action_id` and `user_id` non-null), never `as`. No drill-down file may read `.service` (`serviceColumn.guard.test.ts:57-60`, rule `/\.service\b/`): the area comes from `resolveEffectiveFields`, as on the list | Low |
| **SA-B2-10** | B2a | Ledger repository header: besides the callers paragraph and the account-scoped list, amend the **"BY UNIQUE ID"** bullet (`:47-50`) and `findChargesByActionIds`'s doc (`:625-630`). It is now also the drill-down's **entry read**. Its row's own account becomes the scope of every later read (SA-RC-11), after `requireAdmin` | Low |
| **SA-B2-11** | B2a | Render tests: the tab tests match fetches by `startsWith('/api/admin/business-os/ai-activity')` (`activityTab.render.test.tsx:146`, `:567`, `:585`), and that prefix also matches `/ai-activity/drill-down`. New tests route by exact path, and no test may count a drill-down fetch as a list fetch. `RecordStateMarker` takes `{ row, settleMinutes }` (`RecordStateMarker.tsx:71`), not `{ row }` (V-16), so the drawer passes `audit.settleMinutes` | Low |
| **SA-B2-12** | B2b | When the group read is cut or failed, the calls window comes from a partial set of charges. The calls section says so ("calls read around the charges shown only"), alongside the `charges_incomplete` not-run reason | Low |

#### 4. Rulings on the open questions

| # | Ruling |
|---|---|
| OQ-1 | ✅ Split approved. **B2a first**, on this branch |
| OQ-2 | **User decision 2026-10-04: option 1**. B2b fixes the pin and the header (SA-B2-1) |
| OQ-3 | ✅ `.eq` on the charge's lower-case group id; the column is recorded live as `uuid` (SA-B2-4) |
| OQ-4 | ✅ Reuse `classifyLeakGroups` verbatim, plus one additive figures output (SA-B2-2) |
| OQ-5 | ✅ `too_recent` while the newest charge or any call read is **strictly younger** than `SETTLE_MS`; M7 boundary test |
| OQ-6 | ✅ 500 group charges, 5,000 calls read, 500 sent, with the shown 500 chosen nearest the opened charge (SA-B2-5) |
| OQ-7 | ✅ Export in place plus the two `Pick` narrowings (OQ-9 precedent), with the parity test (SA-B2-7) |
| OQ-8 | ✅ Query parameter with a strict one-key schema, so an extra key is a 400 |
| OQ-9 | ✅ One identical 404 body for unknown, adjustment, deleted-account and platform-account ids |
| OQ-10 | ✅ Shared-group marker in the drawer only |
| OQ-11 | ✅ FR-B6 item 1 stays in B3; B2 does not project `estimatedCostUsd` |
| OQ-12 | ✅ The entry projection is exactly B1b's |
| OQ-13 | ✅ Reuse `Sheet` with the one-line import comment. Override the palette through `className`; z-index is checked at P-1 |
| OQ-14 | ✅ The pin lives in `supabase/migrations/__tests__/`; the precedent is the B0′ checker pin |
| OQ-15 | ✅ Module-level helpers. They leave the pin's exclusion list untouched |

#### 5. Where SA disagrees with the plan's findings

- **V-11:** the type **is** recorded live (slice 4 workplan `:54`). The plan's hedge drove OQ-3 and R-2, so both are simplified (SA-B2-4).
- **§ E "by construction":** with `cases` alone the drawer has no direction or sums for a `matched` group, and its tolerance can drift from the classifier's (SA-B2-2).
- **R-6 / SA-R3 "cannot classify differently":** true for **identical inputs**. The leak check runs over a day window with its own usage slack (`creditLeakCheck.ts:609-617`), so for a group spanning several days it sees only part of the group, while the drawer sees all of it. The two can then legitimately differ. Add this to Risks. P-6 compares only groups contained within one day, and the drawer copy must not promise identity with a leak-check run.
- **V-5:** incomplete (`test:bos-llm` also runs in CI); no effect on B2. **V-16:** the signature also carries `settleMinutes`.

#### 6. Optimisation suggestions (optional)

- SA-B2-1 could also add a compile-time line for `summariseFeatureAllAccountsInWindow` ("there is no account parameter to pass"), mirroring the chat line at contract test `:51-53`. It is optional and outside what the user approved, so it is Dev's call only if it stays in the same two-line spirit.
- Today only the `ai` service writes charges. If another service ever shares a group id, `chargedActions` counts every charge while the cost check sums only effective-AI ones. A one-line comment at the count is enough.

#### 7. Approval

- [x] **Workplan approved with changes: proceed to B2a implementation** once the B2a items (SA-B2-7 to SA-B2-11) are folded into the plan. B2b items (SA-B2-1 to SA-B2-6, SA-B2-12) are folded in before B2b starts. SA checks them in the diff at code review; no second workplan pass is needed.
- **Before each merge:** Build, Type check (Business OS LLM attribution), React hooks rules guard, Admin authz surface guard, and Business OS entitlements invariants all green.

### SA Code Review — B2a — 2026-10-04

**Code Review by SA — 2026-10-04.** Worktree `neuronforge-ai-activity`, branch `feature/admin-ai-activity-b2`, base `7eac5b98`. The uncommitted diff (9 modified, 11 untracked). No database access.
**Status:** 🔄 **APPROVED WITH CHANGES.** Two small changes (SA-CR-B2a-1 Medium, SA-CR-B2a-2 Low). Neither touches the server, tenant isolation or any data path. Dev makes both before QA. SA does not need to re-review: QA confirms SA-CR-B2a-1 visually during L-8.

#### 1. Gates (re-run by SA)

| Gate | Result |
|---|---|
| `npm run typecheck:bos-llm` (required) | **Exit 0.** 417 files, 28 errors, **0 new**, 208 s. It also reports one baseline entry as fixed (`app/api/onboarding/build/route.ts`), outside this slice. Leave the baseline as it is |
| `npm run lint:hooks` (required) | Exit 0 |
| `npm run test:authz-guard` (required) | 119 / 119 |
| `npm run test:bos-entitlements` | 173 suites, 4,231 tests, all green. This run covers the importer list, the credit-lots L8 guard, BD-26 and the builder and repository suites |
| L-1 subset (ledger repo, contract pin, `lib/business-os/credits`, both `ai-activity` routes, `app/admin/business-os-llm`, `adminReadMethods`, `ownerAuditReads`) | 48 of 49 suites, 1,457 of 1,458 tests. The one red is the **expected** `tokenUsageRepository.contract.test.ts` arity pin (V-3; B2b fixes it per SA-B2-1) |

#### 2. Tenant isolation (`tenant-isolation-guard`)

| Check | Verdict | Evidence |
|---|---|---|
| The only request key is the action id | ✅ | `route.ts:46-50` uses a strict one-key schema. The repeated-key 400 is at `:71`. Route tests cover `accountId`, `groupId` or any other key → 400 with no read |
| Lower-casing (SA-B2-8) | ✅ | Route `:88`, and the builder too (`aiActivityDrillDown.ts:171`). Route and builder tests use an upper-case id |
| The account and the group come from the row | ✅ | `aiActivityDrillDown.ts:193-194`. The group read, names, audit and adjustments are all keyed on row values (builder test "SA-RC-11", M2 red) |
| Rows are re-checked in Node | ✅ | `:225` checks kind, account and group through the `isLiveCharge` type guard, with no `as`. Dropped rows are counted in a `warn` that carries ids only (M3 red at builder **and** HTTP-body level) |
| Other accounts are never serialised | ✅ | **Wire types:** `AiActivityDrillDownPayload` has no field that can carry another account's row. Its counts are `unresolvedAdjustments` and `audit.noEntry.accountMismatch`. **Route body:** `route.ts:132` sends only the builder's payload. **Tests:** builder and route both assert foreign markers are absent from `JSON.stringify` (charges, adjustments, audit entries) |
| One 404 body, with no second read | ✅ | `NOT_FOUND_BODY` `:53`. Unknown, adjustment, deleted-account and platform-account cases all return after the single by-id read (route `it.each`, builder `noSecondRead`) |
| `requireAdmin` first | ✅ | `:61`, a structural copy of the list route. A source test pins the statements before the gate. The authz guard is green |
| No details on a 500 | ✅ | A read error gets a fixed message (`:136`). Anything else gets `'Internal server error'`, with `details` only in development (`:143`). Tested with production `NODE_ENV` |
| Pino logs carry ids and counts only | ✅ | One `info` line on 200 (`:113-130`) and one on 404 (`:108`). The test asserts no company name and no model in any log call |
| Repository scope | ✅ | `listChargesOfGroupForAccount` (`BusinessOsCreditLedgerReadRepository.ts:694-741`) filters on `kind`, `user_id` and `group_id`, with UUID guards before any query. It has no `service` filter and no time bound, and copies the `listRowsForAccountCreatedInRange` pager. The header and `findChargesByActionIds` doc are amended (SA-B2-10) |

#### 3. Correctness

- **Group paging and ceiling:** 500/500 is under `MAX_PAGE_SIZE` and `MAX_CEILING`, with the repository's `>=` rule. When the opened charge is missing from a cut read, it is added and the count reads "at least" (tested).
- **Netting parity (SA-B2-7):** ✅ The parity test deep-equals the drawer's opened charge against the **whole** list row (`toEqual`, every key), using one correction, a fallback price and a found entry. A field added on only one side fails it. Netting reuses `netAdjustments`. Listing applies the same `resolveEffectiveFields` rule, so a refused correction is counted and never listed. Corrections are read in chunks of 200 (tested at 201).
- **Audit-entry fields:** ✅ Exactly B1b's projection, through the reused `joinAuditEntries` / `projectEntry`. The AC-B13 marker test passes; there is no `estimatedCostUsd` or `callNames`.
- **Shared-group marker:** ✅ Drawer only (OQ-10). `ActivityTable` gained only the Details column.
- **Order:** `newestFirst` breaks ties on `id`, a `uuid` column. Lower-case lexical order equals Postgres uuid order, so the re-sort keeps the repository's order.
- **Focus return (D-B2a-7):** ✅ The opener is kept in a ref (`ActivityTab.tsx`). `onCloseAutoFocus` calls `preventDefault` and then focuses it. The Escape test asserts `toHaveFocus()`.
- **Accessibility:** ✅ The Details control is a real `<button type="button">`, first in the row. Its visible text "Open" starts its accessible name, "Open details for <type> at <time>" (WCAG label-in-name). `SheetTitle` names the dialog. Every state is text plus an icon, and the opened group row is marked in text, not only by its highlight. **One gap:** SA-CR-B2a-1.
- **Newest request wins:** ✅ A local `current` flag plus an `AbortController`. The stale-response test passes.

#### 4. Guards

| Guard | Verdict |
|---|---|
| Ledger importer list (exact equality) | ✅ +2 files, with reasons |
| `serviceColumn.guard` | ✅ Covers the drill-down route, the client mirror and explicit entries for the three server files, the route and the two components. SA-B2-9 is also pinned by a source test with a self-check (no cast, no `.service`) |
| `adminReadMethods.guard` | ✅ Unchanged and green. The route is under `app/api/admin/**` and passes the `{ correlationId, adminId }` context |
| BD-26 `ownerAuditReads` | ✅ `'audit_trail'` still appears only in `aiActivity.ts`. The drill-down reaches it through `readArchiveCutoff` |
| Credit-lots L8 | ✅ Green (no SQL in this slice) |
| Page `source.guard` | ✅ Green. It walks the new components: no `@/lib/` specifier, no provider or model literal, no `console.*` |
| Admin authz surface | ✅ 119 / 119 |

#### 5. CLAUDE.md compliance

- **Repositories only, rule 4:** ✅ No inline client. `aiActivityDrillDownDeps.ts` wires the three reads, and the route injects the admin-pinned reads (the B1 pattern).
- **`console.*`:** ✅ 0 in every new and modified file (SA grep).
- **Strict TS and casts:** ✅ The builder, deps, types and route contain no `as` (pinned by source test). Builder fakes use the `fake<F>()` pattern. Three uses are **accepted on precedent**, and none is a repository fake:
  - the repository's `(data ?? []) as unknown as CreditLedgerRow[]` (the idiom of all 9 reads in that file);
  - `body.data as ActivityDrillDownPayload` (`ActivityDrillDown.tsx:273`, the same as `ActivityTab.tsx:127`);
  - the render test's `as Response` / `as unknown as typeof fetch` fetch stub (the same as `activityTab.render.test.tsx`).
- **New pattern:** ✅ None. `Sheet` follows the `CreditHistoryPanel` / `MoneyDetailDrawer` precedent.

#### 6. Rulings on the deviations

| # | Ruling |
|---|---|
| D-B2a-1 | ✅ **Approved.** `joinAuditEntries` always returns a summary, and the drawer always holds at least one charge, so `audit` is non-nullable. Both sides of the wire are pinned |
| D-B2a-2 | ✅ **Approved.** Lowering the case in both places is cheap. The route's own lower-casing stays pinned (M-case) |
| D-B2a-3 | ✅ **Approved: fail-closed is right.** CHECK `triggered_by_known` / `outcome_known` make the case impossible, and SA-B2-9 forbids `as`, so the guard must decide what to do with the impossible value. Refusing it (NULL → the one 404, plus a `warn` with ids) never puts an invented label in front of an admin. The drawer is opened one id at a time, so a refusal costs nothing. The list's cast serves a page of rows, and refusing there would hide a whole row. The two screens can disagree only on a row the database cannot hold. *Optional, B3:* the list could use the same guard (skip, count and warn) so the two agree by construction |
| D-B2a-4 | ✅ **Approved.** With no key there is no read; the drawer shows the opened charge and says the group failed (tested) |
| D-B2a-5 | ✅ **Approved.** Exporting reuses the components instead of copying them. `OutcomeLabel` was extracted with identical DOM, and the tab render suite is unchanged and green |
| D-B2a-6 | ✅ **Approved: keep the inline `backgroundColor`.** Verified: `cn()` (`lib/utils.ts`) is a plain join, and `/admin` does not load `app/v2/globals-v2.css`. So the sheet's `bg-[var(--v2-bg,var(--background))]` resolves to `--background`, which is **`#ffffff`** for a light-scheme OS. Which of two same-property utilities wins then depends on stylesheet order. The inline value is the only deterministic choice short of editing the shared primitive (out of scope). The same root cause affects the close button: see **SA-CR-B2a-1** |
| D-B2a-7 | ✅ **Approved.** Radix returns focus only to its own `Trigger`, and the opener lives in the table. Pinned by the Escape test |
| D-B2a-8 | ✅ **Approved.** The 404 log line serves AC-B8, and it does not record which kind of not-found occurred (asserted) |
| D-B2a-9 | ✅ **Approved.** It is exactly SA-B2-11, and no assertion changed |
| D-B2a-10 | ✅ **Approved.** With a single charge the group table would only repeat the Action section, and `GROUP_SINGLE` says so in words |

#### 7. Code review comments

| # | File:line | Issue | Priority |
|---|---|---|---|
| **SA-CR-B2a-1** | `components/ui/sheet.tsx:68`, as used by `ActivityDrillDown.tsx:303` | **The drawer's close (X) button can be invisible.** Its colour is `text-[var(--v2-text-muted,var(--foreground))]`. `/admin` does not define `--v2-*`, so on a light-scheme OS this is `#171717` at 70 % opacity on the forced `slate-900` background (the same root cause as D-B2a-6). Escape still closes the drawer, so the keyboard path holds. A mouse user, however, sees no close control. **Fix in the drawer, not in the shared primitive:** add `[&>button]:text-slate-300` to the `SheetContent` `className`. The parent-child selector outranks the child's own class, so it is deterministic. QA checks it during L-8 with the OS in **light** mode, and P-1 records it | Medium |
| **SA-CR-B2a-2** | `activityCopy.ts:226` | `DRILL_DOWN_FIELDS.groupId` is unused: the Grouping id section uses `DRILL_DOWN_SECTIONS.group`. Remove the key (dead code) | Low |

#### 8. Optimisation suggestions (optional, non-blocking)

- `ActivityDrillDown.tsx:266` calls `response.json()` before checking the status. A non-JSON gateway error, such as an HTML 504, then shows the parser's message ("Unexpected token '<'…") instead of `DRILL_DOWN_ERROR_FALLBACK`. This matches the tab's own fetch (`ActivityTab.tsx:116`). If changed, change both in a later UI pass.
- `Section` sets `aria-label` and also renders an `<h3>` with the same text. `aria-labelledby` pointing at the heading would avoid announcing it twice.

#### 9. Approval

- [x] **Code approved for QA once SA-CR-B2a-1 and SA-CR-B2a-2 are made.** Both are confined to the client and need no SA re-review. QA verifies SA-CR-B2a-1 in L-8 (light-scheme OS: the X is visible and closes the drawer).
- **Before merge:** Build, Type check (Business OS LLM attribution), React hooks rules guard, Admin authz surface guard and Business OS entitlements invariants are all green on the PR. The Build check is the only gate not proven locally (no `.env.local`).

---

## QA Testing Report

### QA Report — B2a — 2026-10-04

**QA — 2026-10-04.** Worktree `neuronforge-ai-activity`, branch `feature/admin-ai-activity-b2`, base `7eac5b98`, uncommitted. No code edited, nothing staged, no database access.
**Test mode:** full (B2a scope only)
**Strategy used:** A + B (Jest builder, repository and route suites, with throwaway probes) and D-substitute (jsdom render with `@testing-library/user-event` keyboard probe). A real browser pass (L-8) was not possible: no `.env.local`, no dev server, no DB in this session. It moves to P-1.
**Focus:** api, ui, security
**Skipped:** the browser click-through (moved to P-1); B2b (out of scope)
**Input source:** TL prompt (B2a QA brief) plus the workplan Test Plan

**Verdict: ✅ PASS WITH NOTES.** No bugs. Two low-severity notes (QA-B2a-1 test gap, QA-B2a-2 edge case) are worth fixing before merge but neither blocks it.

#### Test coverage

| Acceptance criterion (B2a half) | Tested? | Result | Evidence |
|---|---|---|---|
| **AC-B2**: opened by action id only; charge, its corrections, entry fields; unknown id 404 that reveals nothing | ✅ | Pass | Route: 8 kinds of 400 with no read. The 404 body is one constant for unknown, adjustment, deleted-account and platform-account ids. Builder: second reads keyed on the row. **QA probe:** the 404 body is **byte-identical** (`res.text()`, same `content-type`) across all four cases **and** a fifth (a row with an unknown trigger): `{"success":false,"error":"This AI action could not be found"}` |
| **AC-B5** (drawer half): another account never reaches the drawer; shared-group marker; extra account id cannot widen the read | ✅ | Pass | Builder and HTTP-body marker tests; `?accountId=` gives 400 and no read. **QA probes:** an entry on another account only gives `account_mismatch` and the foreign `callCount` is absent from the JSON; a correction on the *other* group charge is listed and netted under that charge, not the opened one. **QA mutations Q2, Q3, Q4 red** (below) |
| **AC-B14** (drill-down route): 401, 403, 403-before-400, bad id gives 400, happy path, `requireAdmin` first, authz guard | ✅ | Pass | Route suite. A source test pins `requireAdmin` as the first statement. `test:authz-guard` 119/119. **QA probe:** braced, `urn:uuid:`, trailing `%0A`, leading space, no-hyphen, extra empty key, `ActionId` case variant alone and beside `actionId`, `actionId[]`, a repeated key with different values, and a bare key all return **400 with no read**. A mixed-case id returns 200 and is looked up lower-case. The nil UUID passes Zod and returns 404 |
| **AC-B17** (drawer): keyboard-operable, labelled, states in text | ✅ (jsdom) / ⚠️ browser owed | Pass | Render suite: named button, `SheetTitle`, text for every state, Escape returns focus. **QA probe (user-event):** keyboard only. Tab reaches the Details button, Enter opens it, focus is inside the dialog, Escape closes it and focus returns to the button. The **Close (X)** button also returns focus. Reopening the same row fetches again and makes no extra list read. **QA mutation Q5 red.** Real-browser check is owed in P-1 |
| **AC-B19** (drawer half): each correction listed; a later-period one still nets | ✅ | Pass | Builder suite (later period, unread or ceiling-cut corrections, chunks of 200, unreadable amount counted once) |
| **NFR-2**: metadata only, no business name in logs | ✅ | Pass | AC-B13 marker test (prompt, owner text, output, error message, email, free-text code, `estimatedCostUsd`). The log line has ids and counts only. `console.*` is 0 in every new and modified file (QA re-counted) |
| **NFR-10**: Zod before logic, action id the only key | ✅ | Pass | Strict schema plus repeated-key check (route suite and QA probe). M8 (Dev) red |
| SA-B2-7 list and drawer parity | ⚠️ | Partial | Deep-equal parity test exists, but see **QA-B2a-1**: one field's ordering is not pinned |
| SA-B2-8 action-id case | ✅ | Pass | Route and builder tests; mixed-case QA probe |
| Every B1b no-entry state on the opened charge | ✅ | Pass | **QA probe:** `too_recent` (5 min), `lost` (2 h, no archive), `may_be_archived` (cutoff after the charge), `unknown/archive_unread`, `unknown/audit_read_incomplete`, `account_mismatch`; `unknown/audit_read_failed` is in Dev's suite |
| Group ceiling | ✅ | Pass (see QA-B2a-3) | **QA probe through the REAL repository pager** (range-slicing fake client) with the opened charge as the oldest: 499 charges give `atLeast: false` (499); 500 give `atLeast: true` (500); 501 give `atLeast: true` (501, the opened charge added once). `opened` is flagged exactly once in every case |

#### Mutation checks (QA, each alone, restored byte-exact, sha256 verified)

`aiActivityDrillDown.ts` sha256 `9e5075b3…53b4c3` and `ActivityDrillDown.tsx` sha256 `f08e9e48…4b3b`, checked before and after every mutation. The builder file is untracked, so `git diff` cannot show a mutation; each one was confirmed with `grep` before the run.

| # | Mutation | Suites run | Result |
|---|---|---|---|
| Q1 | Drawer `reasonCodes` loses `.sort()` (`aiActivityDrillDown.ts:325`) | builder and route | ❌ **Survived (52/52 green)**. See QA-B2a-1 |
| Q2 | Correction listing no longer requires `resolveEffectiveFields(...).resolved` (`:275`), so another account's correction is listed | builder and route | ✅ Red (1 failed: "a correction on another account is counted, never listed or netted") |
| Q3 | Node re-check drops the `group_id` comparison (`:225`); Dev's M3 only covered `user_id` | builder and route | ✅ Red (1 failed: AC-B5 "another group" row) |
| Q4 | `shared: charges.length >= 1` (the marker shown for a one-charge group) | builder and route | ✅ Red (3 failed) |
| Q5 | Drawer drops `onReturnFocus()` in `onCloseAutoFocus` (`ActivityDrillDown.tsx:299`) | render | ✅ Red (1 failed: Escape focus-return test) |

#### Issues found

**Bugs (must fix before commit):** none.

**Edge cases (nice to fix):**

1. **QA-B2a-1: the parity test does not pin the reason-code order.** Test gap, Low. `lib/business-os/credits/__tests__/aiActivityDrillDown.test.ts:494` (SA-B2-7) seeds one correction, so `reasonCodes` has one element. The AC-B19 test's two codes happen to arrive already in sorted order. Removing `.sort()` from the drawer (`aiActivityDrillDown.ts:325`) leaves every suite green, so the drawer and the list could list the same codes in a different order without a red test. Today's code is correct. *Fix:* give the parity test two corrections whose reason codes arrive in non-alphabetical order, e.g. `manual_correction` first, then `fallback_price_reconciled`.
2. **QA-B2a-2: a non-JSON response shows a raw parser message in the drawer.** UI, Low. `app/admin/business-os-llm/components/activity/ActivityDrillDown.tsx:266` calls `await response.json()` before it checks the status (`:268`), and the `catch` at `:277` shows `err.message`. Repro (QA jsdom probe): the drill-down fetch returns status 502 (or 404) with an HTML body. Expected: the generic fallback, or for 404 the not-found line. Actual: the drawer reads `Unexpected token < in JSON at position 0`, and a non-JSON 404 shows that text too instead of `DRILL_DOWN_NOT_FOUND`. This is reachable in production on a Vercel gateway timeout or an HTML error page. No data is exposed. *Fix:* check `response.status === 404` before parsing, and map a parse failure to `DRILL_DOWN_ERROR_FALLBACK`.
3. **QA-B2a-3: a group of exactly 500 charges reads "at least 500".** Informational, accepted. This is the repository's documented `>=` ceiling rule, pinned by its own test, and it is the same convention as every other paged read. It is honest (over-cautious) and needs no change.
4. **QA-B2a-4: on a failed group read the log line says `chargedActions: 1`.** Informational. This is the opened charge alone. The drawer correctly shows `GROUP_FAILED`, and the log carries `group: 'failed'` beside the count, so a log reader must read `group` first. No change needed.

**Performance:** nothing found. Reads are bounded: 1 by-id lookup, 1 group read (≤ 500), ⌈n/200⌉ adjustment reads, 1 audit read (≤ 1,000 rows), 2 archive reads and 1 name read. Names and the archive read start in parallel with the group read.

#### Test outputs / logs

| Check | Result |
|---|---|
| L-1 Jest list (re-run by QA) | **67 of 68 suites, 2,206 of 2,207 tests.** The one red is the pre-existing `tokenUsageRepository.contract.test.ts` arity pin (V-3, fixed in B2b per SA-B2-1). Identical to Dev's figures |
| `npm run typecheck:bos-llm` (**required**; re-run on the clean tree after all probes and mutations) | `417 files in scope, 28 errors, 0 new` → **passed**, exit 0. It also reports the known unrelated "1 baseline entry is fixed" (`app/api/onboarding/build/route.ts`) |
| `npm run lint:hooks` (**required**; clean re-run) | exit 0 |
| `npm run test:authz-guard` | 119 / 119, exit 0 |
| `npm run test:bos-entitlements` | **173 suites, 4,231 tests, all green**, exit 0 |
| Probes | 3 throwaway files (route 15 tests, builder 10, render 6), **all green**, each deleted right after its run. `git status --short` matches the pre-QA tree exactly |

#### Manual post-deploy click-through (owed by the user after B2a deploys)

| # | Step | Expected |
|---|---|---|
| P-1 | `/admin/business-os-llm?tab=activity`, signed in as an admin. Use the **keyboard only**: Tab to a recent row's **Open** button and press Enter | The drawer opens on the right with the admin (slate) palette, readable and above the page. Title "AI action" plus the action type. Its cost, credits, time, area, trigger and outcome match the row. Escape closes it and focus is back on the same **Open** button. Repeat with the **Close (X)** button |
| P-1b | Same drawer, sections | Order: Action, Corrections ("No corrections." expected live: none exist), Audit entry (fields, or a state chip with its reason), Grouping id. **No** Calls or Cost-check section (B2b) |
| P-2 | A `briefing_narration` row from a day with a re-narration | "This grouping id holds 2 charged actions on this account…", the two-row table with "This action" marked in text. Any ordinary row: "holds only this charged action" and no table |
| P-3 | Compare the drawer's Audit entry fields with the same entry on `/admin/audit-trail` | Calls, failed calls, tokens, models and error code match |
| P-4 | Signed in, call `GET /api/admin/business-os/ai-activity/drill-down?actionId=<random uuid>` | 404 with `{"success":false,"error":"This AI action could not be found"}` |
| P-4b | `?actionId=<real>&accountId=<other>` | 400 |
| P-4c | Signed out, then as a non-admin, `?actionId=<real>` | 401, then 403 |
| P-4d | The Vercel log line "Admin opened a Business OS AI action" | Shows `adminId`, `correlationId`, `actionId`, `accountId` and counts. **No** company name, model or row |
| P-x | Open a row, close it, open a different row quickly | The drawer shows the newer action only, never the previous one's figures |

#### Final status

- [x] All in-scope acceptance criteria pass (AC-B17's real-browser half is owed in P-1). **Ready for commit once SA's code review clears.** QA-B2a-1 and QA-B2a-2 are recommended small fixes; neither is a blocker.
- [ ] Issues found that Dev must address before commit: none of High or Medium severity.

---

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-04 | B2a: SA-CR-B2a and QA fixes applied (uncommitted) | SA-CR-B2a-1 (close-button colour on the drawer only), SA-CR-B2a-2 (dead copy key), QA-B2a-1 (parity test pins reason-code order; `.sort()` mutation red, restored byte-exact), QA-B2a-2 (status first, safe JSON read in the drawer and the tab; HTML 502/404 render tests), `aria-labelledby` sections, QA-B2a-4 (log `chargedActions: null` on a failed group read). All suites and gates re-run green. See "SA-CR-B2a / QA fixes" in [Implementation Notes (B2a)](#implementation-notes-b2a) |
| 2026-10-04 | QA B2a: PASS WITH NOTES | "QA Report — B2a — 2026-10-04" added under § QA Testing Report (targeted edit). No bugs. L-1 67/68 (pre-existing contract pin only); `typecheck:bos-llm` 0 new; `lint:hooks`, `test:authz-guard` (119) and `test:bos-entitlements` (173/4,231) green. Five QA mutations: four red, one survived (Q1, reason-code order, gives QA-B2a-1). QA-B2a-2: a non-JSON response shows raw parser text in the drawer. Edge probes for ids, keys, 404 byte-identity, ceiling 499/500/501, every no-entry state, and keyboard/focus all passed; probe files deleted. Browser click-through owed in P-1 to P-4 |
| 2026-10-04 | SA code review B2a: APPROVED WITH CHANGES | "SA Code Review — B2a — 2026-10-04" added under § SA Review Notes. Gates re-run by SA: `typecheck:bos-llm` 0 new, `lint:hooks`, `test:authz-guard` 119/119 and `test:bos-entitlements` (173 suites) all green; the L-1 subset is green except the expected contract pin. All ten deviations approved (D-B2a-3 fail-closed and D-B2a-6 inline background confirmed). Two client-only changes: SA-CR-B2a-1 (Medium, close-button contrast on `/admin`) and SA-CR-B2a-2 (Low, dead copy key). No SA re-review needed |
| 2026-10-04 | B2a implemented (Code Complete, uncommitted) | T1 to T8 done; SA-B2-7 to SA-B2-11 and rulings OQ-7 to OQ-10, OQ-12 and OQ-13 applied. New account-scoped `listChargesOfGroupForAccount`; `aiActivity.ts` exports in place with two `Pick` narrowings; drill-down builder, wiring, wire types and client mirror; route `GET …/ai-activity/drill-down?actionId=`; drawer on `components/ui/sheet`. Ten recorded deviations (D-B2a-1 to D-B2a-10). L-1 green except the pre-existing contract pin (V-3, B2b); `typecheck:bos-llm` 0 new; scoped `tsc` with canary 0 in touched files; eslint and `lint:hooks` clean; `test:bos-entitlements` and `test:authz-guard` green; six mutations red and restored byte-exact. Build not run locally (no `.env.local`). See [Implementation Notes (B2a)](#implementation-notes-b2a) |
| 2026-10-04 | SA review: APPROVED WITH CHANGES | "SA Review — 2026-10-04" added under § SA Review Notes (targeted edit). Split approved, B2a first. OQ-2 recorded as the user's decision (option 1: B2b fixes the contract pin). SA-B2-1 to SA-B2-12; OQ-1 and OQ-3 to OQ-15 ruled. V-11 corrected: `session_id` is recorded live as `uuid` (slice 4 workplan `:54`), so OQ-3 is ruled `.eq`. No migration |
| 2026-10-04 | Created | B2 workplan against `origin/main` `7eac5b98` (B1a #195 and B1b #205 merged), on `feature/admin-ai-activity-b2`. Verification log V-1 to V-22. **Four findings change the plan:** the `TokenUsageRepository` contract pin is already red on `main` (the user parked it on 2026-09-24), so extending `EXPECTED_ARITY` is not evidence on its own (V-3); a new private method would also turn it red through its exclusion list (V-4); the list builder's audit join and netting are module-private and need `export` to be reused (V-9); and `token_usage.session_id`'s type is in no repo migration, so it is checked live, read-only (V-11). Design: drill-down by action id only, account and group from the charge row; a new account-scoped group read on the ledger read repository and a new account-scoped group-calls read on `TokenUsageRepository`; FR-B6 item 2 through the leak check's own `classifyLeakGroups`; a `Sheet` drawer on the Activity tab. No migration. **Proposes splitting B2 into B2a (ledger and audit drawer, ~2 days) and B2b (calls and the group cost check, ~2 days).** Fifteen open questions for SA, one of which (OQ-2) needs the user through TL. No code, SQL file or test written |
