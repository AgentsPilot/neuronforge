# Workplan: Business OS Credit Deduction — Slice 4 (Operator cost report and nightly leak check)

> **Last Updated**: 2026-09-30

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md) — §4 (three records, effective service), §12 slice 4, FR-12c, FR-12d, FR-16 (detection), FR-33, FR-40f, AC-4, AC-23 (report half), AC-31, SA-S9, N-10, SQ-13 (3), SQ-15
**Builds on:** [BUSINESS_OS_CREDIT_DEDUCTION_SLICE_3_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_3_WORKPLAN.md) (the ledger shape §3.2, the RPC §3.5, the checker §6.3, and open items OI-1 / OI-2 in §12)
**Date:** 2026-09-29
**Branch:** `feature/business-os-credit-deduction-slice-4` (worktree `neuronforge-llm-deduction`, off `origin/main` `95a7ead0`). If SA accepts the three-way split (§8), RM decides whether 4b and 4c get their own branches.
**Status:** 4a QA Passed (PR #150). **4b Code Complete (uncommitted) — for SA code review**, on `feature/business-os-credit-deduction-slice-4b`. 4c not started (BQ-3). No migration.

## Overview

Slice 3 made every Business OS AI action write one charge row. Slice 4 is the operators' half: a report of what AI costs us and what we charged, per account and period (FR-33), a nightly check that no Business OS AI spend in `token_usage` escaped the bill (SA-S9, FR-16), and the one write this slice is allowed: reconciling a fallback-priced charge with an adjustment row (FR-12d).

This plan splits the slice into three parts, each a few days, each shipping alone: **4a** the read-only report (no migration), **4b** the leak check (on demand and nightly, no migration), **4c** the reconciliation adjustment (one migration, `20261016`). The reasons for the split, and for three parts rather than two, are in §8.

---

## Table of Contents

- [1. Verification log](#1-verification-log)
- [2. Analysis summary](#2-analysis-summary)
- [3. Where it lives: reuse decisions](#3-where-it-lives-reuse-decisions)
- [4. Implementation approach — 4a, the report](#4-implementation-approach--4a-the-report)
- [5. Implementation approach — 4b, the leak check](#5-implementation-approach--4b-the-leak-check)
- [6. Implementation approach — 4c, reconciliation adjustments](#6-implementation-approach--4c-reconciliation-adjustments)
- [7. Files to create / modify](#7-files-to-create--modify)
- [8. Estimate and the split decision](#8-estimate-and-the-split-decision)
- [9. Task list](#9-task-list)
- [10. Test plan](#10-test-plan)
- [11. Guardrails and out of scope](#11-guardrails-and-out-of-scope)
- [12. Risks](#12-risks)
- [13. Open questions for SA](#13-open-questions-for-sa)
- [14. Business questions for the user](#14-business-questions-for-the-user)
- [15. Flagged items (console.*, stale facts)](#15-flagged-items-console-stale-facts)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Verification log

Every fact this plan relies on, checked on 2026-09-29 against this worktree at `95a7ead0` and, where marked **LIVE**, against production with read-only requests from the main checkout's `.env.local` (PostgREST OpenAPI description and `SELECT`s with `Prefer: count=exact`, `Range: 0-0`; no write, no RPC, no DDL).

| # | Fact | Evidence |
|---|---|---|
| V-1 | The ledger shape: one table, `kind` `charge` / `adjustment`; an adjustment has `action_id` NULL, `adjusts_action_id` required (self-FK to `action_id`), `reason_code` required and format-checked, `service` / `action_type` / `triggered_by` / `outcome` NULL, `is_fallback_priced` false; `credits` and `cost_usd` may be negative only on adjustments; `group_id` may be NULL on adjustments; `period_start` NOT NULL on every row | `supabase/migrations/20261015_business_os_credit_charges.sql` (`…_adjustment_shape`, `…_charge_shape`, `…_reason_code_format`) |
| V-2 | `business_os_record_credit_charge` hard-codes `kind = 'charge'`, so no adjustment can be written without a new function. `service_role` holds only `SELECT, INSERT` on charges and `SELECT, INSERT, UPDATE` on totals, so it cannot `SELECT … FOR UPDATE` a charge row (needs `UPDATE`) | same migration, §3.5 of slice 3 |
| V-3 | The totals row already has `credits_adjustment` (0 until slice 4) and a CHECK `credits_total = owner + scheduled + external + adjustment`; the checker's C7 rebuild already sums adjustments | migration; `scripts/check-bos-credit-charges-migration.sql:201`, `:221` |
| V-4 | **LIVE:** the tables and columns exist with the expected types (`group_id uuid`, `period_start timestamptz`, `credits` / `cost_usd numeric`, `adjusts_action_id uuid`, `reason_code text`, …). **0 charge rows, 0 totals rows, 0 adjustments, 0 fallback-priced rows** at the time of the check (3b-ii merged 15:38 UTC; go-live not yet recorded). 8 plan rows | OpenAPI `definitions`; counts |
| V-5 | **LIVE:** `token_usage.session_id` is `uuid`, `user_id` `uuid`, `cost_usd` `numeric`, `feature` `varchar`. 4,990 Business OS rows (`feature LIKE 'business-os%'`) in the last 30 days; 29 since 2026-09-29 00:00 UTC; 0 of those with a NULL `session_id` | OpenAPI; counts |
| V-6 | **LIVE: `token_usage.cost_usd` holds at most micro-dollar precision.** No row has `0 < cost_usd < 0.000001`; **1,377 of 1,545** Business OS chat embedding rows record exactly `0`. The charge row keeps 10 decimals (SQ-8). So an embedding-only action shows **$0** in `token_usage` and ~$0.0000002 on its charge. The column's declared scale is not visible through PostgREST (QA can confirm with `information_schema` read-only) | counts |
| V-7 | **The `token_usage` row is written before the charge is attempted.** `callWithTracking` notifies the usage scope, then `await this.analytics.trackAICall(…)`, then returns the result to the action; `trackAICall` awaits the `token_usage` insert (a failed insert is logged at `error` and swallowed). The charge is written only at the end of `runAiAction`, after all calls returned | `lib/ai/providers/baseProvider.ts:118`, `:132`, `:170`; `lib/analytics/aiAnalytics.ts:211`, `:226` |
| V-8 | Business OS spend in `token_usage` is defined by `bosRowFilter()` (prefix `business-os` OR the legacy values), and `TokenUsageRepository.listCallsInWindow(userId, window, filter, { pageSize, ceiling })` already reads one account's matching calls with `session_id` and `cost_usd`, paged, up to 5,000 rows, returning `reachedCeiling` | `lib/business-os/llm/callCatalog.ts:139`; `lib/repositories/TokenUsageRepository.ts:347` |
| V-9 | `token_usage` has only a `(user_id, created_at DESC)` index relevant here; no index on `session_id`; PostgREST aggregates are disabled (`PGRST123`); the Gap B0 aggregate RPC was planned, never built | `supabase/migrations/20260929_usage_summary.sql:98-99`; `docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B0_WORKPLAN.md` §Overview, Status "Planning" |
| V-10 | The insight cron mints one `runId` per run and shares it across businesses, so a grouping id is not unique across accounts: every match must key on `(user_id, group_id)` | `app/api/cron/insight-detect/route.ts` (B0 workplan V-4); memory note on the AI activity view |
| V-11 | Calls a usage scope leaves out: a call with a different `sessionId` (counted as `excluded`, `warn`) and a call finishing after its scope closed (`debug`). Both reach `token_usage`, neither reaches a charge | `lib/ai/usageScope.ts` (`notifyUsage`) |
| V-12 | The slice 1 declarations give the area per `AiActionType` (`AI_ACTION_DECLARATIONS[type].area`); they cover service `ai` only (N-11) | `lib/business-os/llm/aiActionAudit.ts:114` |
| V-13 | The credit value per version is `CREDIT_VALUE_HISTORY` (append-only; v0 = $0.001 / credit), in the entitlements module; `chargeResolver.ts` is already registered as a non-gate importer of it | `lib/business-os/entitlements/config/creditValue.ts:45`; `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts:327` |
| V-14 | The writer repository is guarded: only the files in `ALLOWED` may import `BusinessOsCreditChargeRepository` ("the AI charge recorder is the only production caller") | `lib/repositories/__tests__/BusinessOsCreditChargeRepository.test.ts:312` |
| V-15 | Admin gate: `requireAdmin` (`lib/admin/requireAdminRoute.ts:59`) as the first statement of every admin handler; pages are guarded by `requireAdminPage` in `app/admin/layout.tsx`. A new gated route needs no allow-list edit in the authz surface guard | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` rules R1, R6; `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (caps count parked violations only) |
| V-16 | **LIVE: `CRON_SECRET` appears to be set on production now.** `bos_cron_runs` holds rows with `source = 'vercel_cron'` (latest `calendar-sync` 2026-09-29 15:45 UTC; 36 succeeded `payment-reminders` runs; `insight-detect` 03:30 on 09-28 and 09-29). The recorder writes `vercel_cron` only when `isProvenVercelCronCall` holds, which returns false without `CRON_SECRET` | `lib/cron/cronRunRecorder.ts:84-97`; LIVE rows. **Contradicts the task brief's premise; see §15, F-1** |
| V-17 | A new cron needs no migration: `bos_cron_runs.job` is format-checked, not a closed list; jobs are declared in `lib/cron/bosCronJobs.ts`, whose test pins them to `vercel.json` and to each route's `maxDuration`; counts must carry **no money** keys | `supabase/migrations/20261011_bos_cron_runs.sql` (D-12 job rule); `lib/cron/bosCronJobs.ts` header |
| V-18 | `AuditTrailService.log` is **queued** (batch 100 / 5 s), i.e. lossy like the AI audit entries (KI-B) | `lib/services/AuditTrailService.ts:60-123` |
| V-19 | The Business OS AI admin page (`/admin/business-os-llm`) is a single `'use client'` page whose source guard forbids any `@/lib/` import except `ledgerCheckCopy`, and it states "Nothing on this page writes" | `app/admin/business-os-llm/page.tsx:1-30`; `app/admin/business-os-llm/__tests__/source.guard.test.ts:90-118` |
| V-20 | Reserved migration numbers for this work: **20261016–20261019**; `20261020` is taken (`20261020_business_os_invite_email.sql`) | `ls supabase/migrations` |

---

## 2. Analysis summary

**What it touches**

| Area | Part | What |
|---|---|---|
| Charge table, totals table | 4a, 4b read; 4c writes adjustments | `business_os_credit_charges`, `business_os_credit_totals` |
| `token_usage` | 4b read only | Business OS rows per account and window, by `session_id` |
| `business_os_account_plans` | 4a, 4b read | the list of Business OS accounts (`pagePlans`) |
| `business_profiles` | 4a read | business names for display (`findAdminIdentitiesByUserIds`) |
| `bos_cron_runs` | 4b (through the existing recorder) | one row per nightly run, counts only |
| New SQL function | 4c | `business_os_record_credit_adjustment`, migration `20261016` |
| Admin UI | 4a (tab), 4c (one action) | a "Costs & credits" tab on `/admin/business-os-llm` |
| Audit trail | 4c | one entry per adjustment |

**What it does not touch:** `runAiAction`, the charge recorder, the charge RPC, `balance.ts`, any owner surface, how `token_usage` is written, any Pilot-Credit table, the applied `20261015` migration file.

**No LLM call is made** anywhere in this slice, so `bos-llm-call-standards` applies only as far as its gates go (`typecheck:bos-llm` and the literal gate pick up any new file that imports the call catalog or `aiActionAudit.ts`; §9 runs both).

**Answer to slice 3 OI-2 (SA N-4, lead alerts).** V-7 settles it: every call's `token_usage` insert is awaited inside the provider call, before the call returns to the action, and the charge write comes after the action's last call. So on the un-awaited lead-alert path, a function frozen after the response can lose the **charge**, but the `token_usage` rows of every call that had returned are already written: **the leak check sees a freeze-lost lead-alert charge.** The one blind case is a freeze during a provider call, before its `token_usage` insert completes: then neither record exists and only the provider invoice would show it (out of scope, §16 of the requirement). The leak check never joins to the audit entry, so a lost audit entry changes nothing.

---

## 3. Where it lives: reuse decisions

The user's rule is "reuse existing infrastructure, justify anything new". Each candidate, and why it was taken or not:

| Candidate | Verdict | Why |
|---|---|---|
| **`/admin/business-os-llm` ("Business OS AI")** | ✅ **The report's home: a second tab, "Costs & credits"** | Already the admin page about Business OS AI, already in the sidebar, already behind the layout's `requireAdminPage`, already the "refresh + read at" pattern. The report is "what Business OS AI costs and what we charged". The source guard (V-19) is met by keeping the tab's payload types local to the page folder, as `types.ts` already does. The sidebar description changes from "Models & temperatures" to "Models, temperatures & costs" (pinned by `nav.test.ts`, updated with it) |
| `/test-business-os` → LLM Usage tab | ❌ | A test harness (`docs/BUSINESS_OS_TEST_PAGE_SCOPE.md`), not an operator surface; its route hand-rolls `AdminAccessService` (a parked R2 violation) and must not be extended |
| `/admin/users` → Business OS panel (per account) | ❌ for the report, ✅ as a future link | Per-account; slice 11's position view (FR-31) belongs there. The report links an account row to it |
| `/admin/business-os-tiers` / the entitlements shadow report | ❌ | Plans and entitlements; the shadow report is JSON only and must carry no business names (RC-16), while operators need names; and every file importing the entitlements module has to be registered (skill `business-os-entitlements`) |
| The Layer 2 ledger check (`llm-settings/ledger`) | ❌ (different question) | It answers "did calls stop after I changed a setting?" by area, across accounts. The leak check answers "was every call billed?" per account. Nothing is shared except `TokenUsageRepository`, which is reused |
| `TokenUsageRepository.listCallsInWindow` + `bosRowFilter()` | ✅ reused unchanged | Exactly the per-account read the leak check needs (V-8); no new `token_usage` method, no new all-accounts read |
| `withCronRunRecord` + `bos_cron_runs` + `bosCronJobs.ts` | ✅ reused for the nightly run | The run record, the admin jobs page and its late / stopped tiles come for free; no results table |
| A results table for leak findings | ❌ (not built) | The findings are cheap to recompute on demand; the nightly run leaves an `error` log per leaking account and numeric counts in `bos_cron_runs`. A table would be a new pattern and a migration for no reader |
| An aggregate RPC over the ledger or `token_usage` | ❌ for now | Node-side aggregation with a read ceiling and an "incomplete" flag is the existing pattern (`llmUsageReport.ts`), and today's volume is small (V-4, V-5). The RPC is the scale path, recorded in R-3 |

**On demand and nightly, both.** The task brief expected crons to be dormant until `CRON_SECRET` is set, which would make an on-demand path the only one that runs. V-16 suggests it is already set; either way the plan builds **one** check function with **two** doors: an admin "Run check" button (works regardless of the secret, answers "right now") and a nightly cron (works only when the secret is set, fail-closed, answers "every night without anyone looking"). The trade-off is in §5.5.

---

## 4. Implementation approach — 4a, the report

### 4.1 What it answers (FR-33, FR-12c, AC-23 report half, AC-4 report half)

For a chosen window (default: the last 30 days, UTC; at most 92 days):

1. **Per account and period** — every `(account, period_start)` totals row whose period overlaps the window: credits total, split owner / scheduled / external / adjustments, cost, charge count, fallback-priced count. Read from `business_os_credit_totals` (the stored truth), then **cross-checked** against the sum of that period's rows (AC-23: "reproduces the same totals"); a mismatch is shown, never hidden.
2. **By action type, by area, by effective service, by trigger** — across the selected account periods, from the charge table's rows: rows, credits, cost; adjustments shown as their own column and included in the net.
3. **Fallback-priced charges** — the count (FR-12c) and a list (at most 50, newest first): account, time, action type, group id, action id, credits, cost, and whether it is already reconciled (4c). Countable from logs too: every fallback charge already logs `bos_ai_charge_fallback_priced` at `info` (slice 3b-ii).
4. **Spread per action type** — p50 and p90 of cost and of credits, with the number of examples (feeds slices 5 and 8).

Whole periods are reported, not window-clipped rows, so a period's figures never depend on where the window edge fell. The window only selects which periods are shown.

**The totals cross-check compares like with like (SA S-7).** The totals row keeps corrections in their own bucket (`credits_adjustment`); `credits_owner`, `credits_scheduled` and `credits_external` exclude them. So each totals row is compared with its rows **by the totals' own rules**: owner / scheduled / external summed over **charge** rows by their own `triggered_by`; adjustment summed over **adjustment** rows; total and cost over **all** rows; charge count and fallback count over charge rows. A period with one adjustment passes the check. The breakdowns of item 2 (action type, area, effective service, trigger), which put an adjustment under the charge it corrects (§4.2), are labelled **"net, including corrections"** on the tab, so nobody reads the by-trigger figures as the totals row's owner / scheduled / external split.

### 4.2 The effective service, and the adjustment's other effective fields (N-10)

A pure function resolves, for every row read:

- `effectiveService = row.service ?? adjusted(row).service`
- and, proposed here (Q-5), **the same inheritance for `action_type`, `area` and trigger**, so an adjustment is counted under the action type, area and service of the charge it corrects.

When the adjusted charge is not in the rows already read (it sits in another period), the service fetches it by `action_id` (`.in('action_id', missing)`, at most one extra read per report). An adjustment whose original cannot be found (impossible while the self-FK holds, but defended) goes to an "unresolved" bucket that is shown. **No query in this slice filters or groups on the raw `service` column** (KI-14); a source test enforces it.

Area and label lookups key on **(effective service, action type)** (N-11): for `ai` the slice 1 declarations; for any other service the area is "not declared" and the row is still counted.

### 4.3 The percentile rule (Q-13)

Linear interpolation between closest ranks (the same answer `percentile_cont` gives, so a later SQL version agrees). Computed over **succeeded charge rows only** (SA S-6), **excluding fallback-priced rows** (a deliberate over-estimate, KI-2). A failed action usually stops early and spends less, so including it would pull p90 down, and slice 8 uses p90 as its "would this exhaust the trial?" estimate, where understating is the unsafe direction. The **failed count is shown beside** the figures, and failed spend still counts in every **sum** (FR-8). The number of examples is always shown; below 10 the figures are marked "few examples".

### 4.4 Reads

A new, read-only repository, **`BusinessOsCreditLedgerReadRepository`** (Q-3), per `new-repository` adapted to a read-only ledger:

| Method | Scope | Notes |
|---|---|---|
| `listTotalsForPeriodsInRange(range)` | **all accounts**, named as such | The deliberate cross-account admin read, reached by a differently named method (the `TokenUsageRepository` convention), never by leaving an account out |
| `listTotalsForAccountInRange(userId, range)` | one account | `.eq('user_id', userId)` |
| `listRowsForAccountPeriods(userIds, periodRange, { pageSize, ceiling })` | named list of accounts | Paged, ordered, de-duplicated by `id`; returns `reachedCeiling`. Ceiling 20,000 rows per report |
| `findChargesByActionIds(actionIds)` | by id, ≤ 200 per call | For the adjustments' originals (§4.2) and for 4c's pre-check |

Selected columns only (an exported allow-list, tested): `id, kind, action_id, adjusts_action_id, reason_code, user_id, period_start, group_id, credits, cost_usd, credit_value_version, is_fallback_priced, service, action_type, triggered_by, outcome, created_at`. Every method returns `{ data, error }` and never throws. **It has no write method**, and a source test pins that it names no `insert`, `update`, `upsert`, `delete` or `rpc`. The writer repository and its `ALLOWED` guard (V-14) stay exactly as they are.

Header documents the intentional service-role use: the report is an admin cross-account read behind `requireAdmin`; owners cannot read cost columns at all (column grants, slice 3).

Business names come from `businessProfileRepository.findAdminIdentitiesByUserIds` (existing).

### 4.5 The route

**`GET /api/admin/business-os/credits/report?from=YYYY-MM-DD&to=YYYY-MM-DD[&accountId=<uuid>]`**

- `requireAdmin` first statement; nothing above it touches the request or the database.
- Zod, `.strict()`: both dates or neither; `from ≤ to`; span ≤ 92 days; `to` not in the future (+1 day tolerance); `accountId` a UUID and **not** a platform account (409, pure check, as the account summary route does). Invalid → 400 with a plain message; details only in development.
- Builds the report through `lib/business-os/credits/creditReport.ts` (reads in parallel with `Promise.allSettled`; one failed read marks its section failed rather than failing the request, as `llmUsageReport.ts` does).
- Read-only: no audit entry (precedent: the shadow report and the account summary); the accountability is one `info` log with the admin id, window, account filter, row count and `incomplete`.
- Response: `{ success: true, data: CreditReport }`; 500 with a generic message otherwise.

### 4.6 The tab

`/admin/business-os-llm` gains a two-tab strip: **Settings** (today's page, unchanged) and **Costs & credits**. The new tab: window picker (last 7 / 30 / 90 days, or two dates), optional account filter — **no business-name search (SA S-5)**: the report already returns every account in the window with its business name (`findAdminIdentitiesByUserIds`), so the filter is a choice from that list, which re-queries the route with `accountId` — refresh button with "read at", and the four sections of §4.1. States: loading, error, **"No charges recorded in this window"** (true today until charging starts), and an amber "incomplete — narrow the window" banner when a read hit its ceiling. USD formatting shows enough decimals for sub-cent actions (the slice 2 precision-aware formatter, if it is importable without breaking the source guard; else a local one). No lib import except the existing copy module.

---

## 5. Implementation approach — 4b, the leak check

> **SA rulings folded in (T4b.0, 2026-09-29):** B-1 (a group is examined on ANY activity in the window, not on its first call), S-1 (plan accounts plus charged accounts), S-2 (a scale-independent tolerance), S-3 (known uncharged paths at `warn`, ungrouped calls counted separately), S-4 (the period in the output and the log), N-3 (the usage read's inclusive end), N-5 (a 7-day on-demand cap), Q-9 (no per-account legacy `onboarding` count; the helper label joins the platform count), Q-15 (the schedule's reason corrected), and the user's decision **BQ-2** (admin pages and logs only, no email). Each is marked where it lands.

### 5.1 What counts as Business OS spend

`token_usage` rows matching `bosRowFilter()` (V-8), on the account being checked. Rows on the **platform account** are Business OS spend no account can be charged for. They are counted and shown separately (count only, through the existing `countInWindow`). **Q-9:** the platform-account information also counts rows under the shared helper label `BOS_LEGACY_HELPER_LABEL` (`onboarding` / `simple-complete`), passed as data to the same `countInWindow` (`{ kind: 'label' }`). That label is the fingerprint of a Business OS call that lost its account context. The legacy `onboarding` feature value is **not** counted per account: on a Business OS account it is agent-platform spend by construction. `BOS_LEGACY_FEATURES.onboarding` stays empty (RC-3).

### 5.2 The comparison, per account

For a window `[S, E)` of whole UTC days:

1. **Usage side:** `listCallsInWindow(account, [S − 1 h − 300 s, E + 1 h), bosRowFilter(), ceiling 5,000)`. **N-3:** that method's end is **inclusive** (`.lte`), so it is passed `E + 1 h − 1 ms`. Window membership (step 3) is always `S ≤ t < E`, so a row at exactly `E` belongs to the next window only.
2. **Charge side:** the account's ledger rows (charges **and** adjustments) with `created_at` in `[S − 1 h, E + 1 h + 300 s)`, from the 4a read repository. It is a new account-scoped method (`.eq('user_id', …)`, half-open). Only rows whose **effective** service is `ai` are compared (N-10, through `resolveEffectiveFields`); an adjustment inherits its charge's service and group. An adjustment whose charge was not read is **unresolved**: counted and shown, never compared.
3. **Group by `(user_id, group_id)` ↔ `(user_id, session_id)`** (V-10). **B-1: a group is examined when it has ANY usage row or ANY charge-side row inside `[S, E)`.** The rows outside `[S, E)` (the slack) are used only to match. So a reused chat or onboarding group that crosses midnight is examined on both nights, and a discrepancy near the edge can be **reported on two consecutive nights**; the output says so. Over-reporting is the safe direction; missing a leak is not.
   - The usage read starts **300 s (the longest action, `maxDuration`) earlier** than the charge read, so every charge read has its calls read, and no phantom "charged above usage" appears at the lower edge. The charge read ends 300 s later than the usage read, so every call read near the upper edge has its charge read, and no phantom under-charge appears there.
   - **The one residue:** a reused group with an action whose calls fall in the 300 s before the charge read starts, and whose charge also falls before it, shows an under-charge at the lower edge. That needs one group active both about an hour before the window and inside it. It is over-reporting, and the output names it (blind spot `edge_of_window`: check the previous day).
   - **The midnight example (SA B-1), tested both ways:** chat group G, turn A at 23:40 on D−1 **charged**, turn B at 00:20 on D with its charge **lost**. Day D's run examines G (turn B is in the window); turn A's usage and charge sit in the slack; usage = A + B, charged = A, so G is **under-charged by B and reported**. With B charged too, G is **matched and not reported**.
4. **Classify each examined group.** **S-2:** tolerance `T = calls × 0.000001 + 1e-9`, one micro-dollar per call. It holds whether `token_usage.cost_usd` rounds or truncates to micro-dollars; the charge keeps 10 decimals (V-6). An uncharged group is detected by **presence**, so an embedding-only action recorded at $0 is still found.

| Case | Rule | Is it a leak? |
|---|---|---|
| **Matched** | a charge exists and `|usage − charged| ≤ T` | No |
| **Uncharged group** | usage rows, no charge row at all, and the rows carry any tokens or cost | **Yes.** A call outside `runAiAction`, a lost or failed charge write (FR-16), a charge lost when the function froze after its calls returned (Q-14, V-7: the `token_usage` insert is awaited before a call returns), or calls left out of their scope (V-11) |
| **No-spend group** | usage rows, no charge, zero tokens and zero cost (for example the plan-cache marker row) | No, informational |
| **Ungrouped calls** (S-3: counted separately) | Business OS rows with `session_id` NULL that carry tokens or cost and are not a known path | **Yes.** Nothing without a grouping id can be charged |
| **Under-charged group** | a charge exists, nothing in the group is fallback-priced, and `usage − charged > T` | **Yes.** Calls that finished after the scope closed or carried another group id, or one lost charge inside a reused group (SA-B1) |
| **Pending reconciliation** | a charge in the group is fallback-priced and `|usage − charged| > T` | **No** (SQ-13 (3)). Shown with its direction: **over** (the expected case, since a fallback is the highest price) or **under** (SA N-8, BQ-4: the real price exceeded the fallback; shown, never hidden as matched, so the price list can be fixed) |
| **Charged above recorded usage** | `charged − usage > T`, nothing fallback-priced | No, informational (a `token_usage` insert that failed and was logged, V-7) |
| **Known uncharged path** (S-3) | rows whose `(feature, component)` is a `BOS_KNOWN_NON_CATALOG_COMPONENTS` entry exempt from `missing_group_id` (today `business-os-chat` / `IntentParser`, KI-6) | **Accepted**, not a leak. Its own bucket, counted and shown with feature and component, logged at **`warn` once per run**, never at `error` |

An account whose read hit its ceiling is **"incomplete"**, never "clean". An account whose read failed is **"could not check"**, never "clean".

**Accepted blind spots.** They are stated in the output as codes, which the tab spells out; none is hidden.

| Code | Blind spot |
|---|---|
| `no_plan_no_charge_account` | **S-1:** Business OS spend on an account with neither a plan row nor a charge in the window is not walked. SA's re-measurement (9 spenders in 30 days = the 8 plan accounts + the platform account) says none exists today. No all-accounts `token_usage` read is added to find one |
| `sub_microdollar_reused_group` | A lost charge worth less than a micro-dollar, inside a reused group that has other charges |
| `never_reached_token_usage` | Spend that never reached `token_usage`: a freeze during a provider call (V-7), or the chat path that calls the provider directly |
| `outside_business_os_filter` | Spend under non-Business-OS feature values (Q-9) |
| `edge_of_window` | A discrepancy at a window edge can be reported on two consecutive nights, or once as an edge under-charge (step 3) |
| `fallback_masks_undercharge` | A lost charge inside a group that also holds a fallback-priced charge is shown as pending reconciliation, not as a leak |

### 5.3 The check function

`lib/business-os/credits/creditLeakCheck.ts`:

- `classifyLeakGroups(usageRows, ledgerRows, window, periodOf)` is **pure** and fully unit-tested (the table above).
- `runCreditLeakCheck({ window, accountId?, deadlineAt, trigger }, deps)`. **S-1:** it walks the **plan accounts** (`pagePlans`, 500 per page) **plus the accounts with a totals row overlapping the window** (the read repository's named all-accounts totals read, `[S − 31 d, E)`), with platform accounts removed, one account at a time. It stops **starting** accounts at the deadline and returns `accountsRemaining` (the `insight-detect` `RUN_BUDGET_MS` pattern). It returns, per account with any finding: the account, the **period** (S-4), counts and USD per case, and at most 20 example group ids per case for the drill-down (group id → `token_usage.session_id`, SQ-15). It never throws.
- **The period (S-4, AC-31).** A group with a charge takes the charge's stored `period_start`. Otherwise the RPC's own rule applies: the plan anchor's period at the group's first in-window call, else the UTC calendar month. The account's `periodStart` is its earliest leaking group's period, and `periodStarts` lists every distinct one.
- The dependencies (three repositories) are wired in one file, `creditLeakCheckDeps.ts`. It is declared as a reader on the plan repository's referrer guard (RC-15) and on the read repository's importer guard. The runner and the routes take the dependencies injected.
- **Logs (BQ-2: logs and admin pages only, no email):**
  - one `error` **`bos_credit_leak_found`** per leaking account: `{ accountId, periodStart, periodStarts, windowStart, windowEnd, unchargedGroups, ungroupedCalls, underchargedGroups, unchargedCostUsd, groupIds }`. Ids and numbers only, no owner text; the one money figure is the one this plan allowed;
  - one `warn` **`bos_credit_leak_known_path`** per run when a known path was seen (S-3);
  - one `warn` per account that could not be checked;
  - one `info` **`bos_credit_leak_check_completed`** summary.

### 5.4 The two doors

| Door | Path | Auth | Window |
|---|---|---|---|
| **On demand** | `GET /api/admin/business-os/credits/leak-check?from=&to=[&accountId=]`, and a "Run leak check" button on the Costs & credits tab | `requireAdmin` first statement; Zod strict; **window ≤ 7 days (N-5)**; `maxDuration = 60`, check deadline 45 s | Chosen by the admin (default: yesterday, UTC). An end later than *now − 6 min* is clamped to it, so an action that is still running is not reported as uncharged |
| **Nightly** | `GET /api/cron/credit-leak-check`, `export const GET = withCronRunRecord('credit-leak-check', runJob)`, `vercel.json` schedule `45 4 * * *` | **Fail-closed** `CRON_SECRET` bearer check, copied from `payment-reminders` (a missing secret in production refuses with 401 and an `error` log). V-16: the secret **is** set in production | The previous UTC day; walk deadline 45 s |

**Q-15:** 04:45 UTC is not "after the 03:30 insight run". The run checks **yesterday**, and today's 03:30 run falls in tomorrow's window. Any time after 01:05 UTC works (the window's end, plus 1 h of slack, plus 300 s). 04:45 is kept because it clashes with no hourly `:00`–`:40` job.

The cron registry entry records counts only, no money (V-17): `accountsChecked`, `accountsWithLeak`, `unchargedGroups`, `ungroupedCalls`, `underchargedGroups`, `pendingReconciliation`, `knownPathCalls`, `accountsIncomplete`, `accountsNotChecked`, `accountsRemaining`, `listingFailed`. A run is "partly done" when `accountsRemaining`, `accountsIncomplete`, `accountsNotChecked` or `listingFailed` is ≥ 1. A leak is a finding, not a job fault, so it does not colour the job (the Q-U2 precedent): the count sits on the jobs page, and the `error` log is the alert. The jobs page shows the run, its counts and whether it is late or stopped, with no new UI.

The job **drains no table and writes nothing**, so the §8.1 claim pattern does not apply (requirement N-7; skill `durable-queue-drain`: nothing is claimed and no effect runs). Two overlapping runs are harmless.

**No new delivery channel (BQ-2):** no email and no notification. The Costs & credits tab (on demand), the jobs page (nightly counts) and the logs are the whole surface.

### 5.5 The trade-off, for the record

| | On demand only | Nightly only | **Both (built)** |
|---|---|---|---|
| Runs without `CRON_SECRET` | Yes | No (fail-closed, dormant) | Yes, on demand |
| Tells you without anyone looking | No | Yes, through the jobs page and `error` logs | Yes |
| History | None | `bos_cron_runs` counts + logs | Same |
| Extra cost | — | One route, one registry entry, one `vercel.json` line | Same |

`CRON_SECRET` is set (V-16, confirmed by SA), so the nightly door runs. If it were ever removed, the cron's attempts would be refused and the jobs page would show the job as "stopped", which is itself the signal. The on-demand door keeps working either way.

---

## 6. Implementation approach — 4c, reconciliation adjustments

### 6.1 Why a migration is needed

V-2: the only write function hard-codes `kind = 'charge'`, and `service_role` cannot insert an adjustment and move the totals in one transaction through PostgREST (two calls, no atomicity; the totals CHECK would also fail between them). So 4c needs **one** new function, in **`20261016_business_os_credit_adjustments.sql`**. No other number is used (`20261017`–`20261019` stay free).

### 6.2 The function

```sql
business_os_record_credit_adjustment(
  p_adjusts_action_id uuid,
  p_reason_code text,
  p_credits numeric,          -- signed; computed in TS at the original's credit-value version
  p_cost_usd numeric,         -- signed
  p_admin_id uuid             -- only if SA takes Q-11's column option
) RETURNS TABLE (out_recorded boolean, out_adjustment_id uuid, out_user_id uuid, out_period_start timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
```

1. Refuse NULL arguments (`22004`).
2. Read the original: `kind = 'charge'` and `action_id = p_adjusts_action_id`. Not found → `P0002`. **Detached** (`user_id IS NULL`, the account was deleted) → refuse.
3. **The account, the period, the group and the credit-value version come from the original row, never from the caller** (tenant-isolation-guard: the only caller-supplied id is the action id; there is no `p_user_id` parameter at all).
4. Bounds: `p_cost_usd ≤ 0`, `p_credits ≤ 0`, and `-p_cost_usd ≤ original.cost_usd`, `-p_credits ≤ original.credits`. A fallback price is the highest rate in its class (SQ-9), so a reconciliation can only lower a charge. For `reason_code = 'fallback_price_reconciled'`, also require `original.is_fallback_priced`.
5. `INSERT … kind = 'adjustment' … ON CONFLICT (adjusts_action_id, reason_code) WHERE kind = 'adjustment' DO NOTHING`, backed by a new **partial unique index** `business_os_credit_charges_one_adjustment_per_reason`: one adjustment per charge per reason, concurrency-safe without row locks (V-2).
6. Only if a row was inserted: `UPDATE business_os_credit_totals SET credits_total += p_credits, credits_adjustment += p_credits, cost_usd_total += p_cost_usd, updated_at = now() WHERE user_id = original.user_id AND period_start = original.period_start`; zero rows updated → `RAISE` (the transaction rolls back; a charge without its totals row is an invariant break). `charge_count` and `fallback_priced_count` do not move (the totals comments say adjustments are not counted).
7. `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE … TO service_role`. No `SECURITY DEFINER`, no trigger.

**Rollback** (`supabase/SQL Scripts/20261016_business_os_credit_adjustments_rollback.sql`): refuses if any adjustment row exists (the 20261015 pattern), else drops the function and the index. **Checker and probe:** a separate `scripts/check-bos-credit-adjustment-migration.sql` (read-only) and `scripts/probe-bos-credit-adjustment-migration.sql` (one always-raising `DO` block, the 20261015 precedent), plus a re-run of the 20261015 checker (C7's rebuild already sums adjustments). If Q-11's column is taken, the 20261015 checker's C2 hidden-column list must gain that column, or C2 fails (it treats every column not on its list as owner-readable).

### 6.3 The service and the route

`lib/business-os/credits/creditAdjustment.ts`:

1. Load the original through the read repository's `findChargesByActionIds([id])` → not found 404, not a charge 404, not fallback-priced 409, detached 409, already reconciled 409.
2. `deltaCost = correctedCostUsd − original.cost_usd` (must be ≤ 0; 400 otherwise); `deltaCredits = round(deltaCost ÷ CREDIT_VALUE_HISTORY[original.credit_value_version].usdPerCredit, 6)` — **the original's version** (FR-3: a correction nets exactly against the charge it corrects, Q-10). This imports the credit value from the entitlements module, so the file is registered in `KNOWN_NON_GATE_IMPORTERS` (skill `business-os-entitlements`).
3. Write through a new `recordAdjustment` method on the **existing writer repository** `BusinessOsCreditChargeRepository` (FR-14: one ledger, one writer), whose `ALLOWED` list gains exactly this service file and its test.
4. `info` log `bos_credit_adjustment_recorded`; audit entry (non-blocking, CLAUDE.md) `BOS_CREDIT_ADJUSTMENT_RECORDED` with actor, target account (from the row), the original's cost and credits (before), the net after, and the reason code.

**`POST /api/admin/business-os/credits/adjustments`**, body `{ adjustsActionId: uuid, reasonCode: 'fallback_price_reconciled', correctedCostUsd: number (finite, ≥ 0) }`, Zod `.strict()` (so an injected `userId`, `accountId`, `credits` or `periodStart` is a 400, not ignored). `requireAdmin` first. 200 `{ recorded, adjustmentId, credits, costUsd }`.

**UI:** a "Reconcile" action on a fallback row in the Costs & credits tab: a corrected-cost field, the drill-down to the group's `token_usage` calls (model, tokens, recorded cost) to inform it, a confirm step, then refresh. This makes the page write for the first time (Q-12).

**No automatic re-pricing** in 4c: the admin enters the corrected figure. Re-pricing from `token_usage` is only exact when the group holds one action, which is not true for chat and onboarding (Q-10).

---

## 7. Files to create / modify

### 7.1 Part 4a

| File | Action | Reason |
|---|---|---|
| `lib/repositories/BusinessOsCreditLedgerReadRepository.ts` | create | Read-only ledger access (§4.4) |
| `lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts` | create | Per method; column allow-list; no write verbs; never throws |
| `lib/repositories/index.ts` | modify | Export |
| `lib/business-os/credits/creditReportTypes.ts` | create | The report payload type (server side) |
| `lib/business-os/credits/effectiveFields.ts` | create | Pure: effective service / action type / area / trigger (§4.2) |
| `lib/business-os/credits/percentiles.ts` | create | Pure: the percentile rule (§4.3), exported for slices 5 and 8 |
| `lib/business-os/credits/creditReport.ts` | create | Reads + aggregation + totals cross-check |
| `lib/business-os/credits/__tests__/*.test.ts` | create | Unit tests for the three modules above, plus the no-plain-`service`-filter source guard |
| `app/api/admin/business-os/credits/report/route.ts` | create | §4.5 |
| `app/api/admin/business-os/credits/report/__tests__/route.test.ts` | create | 401 / 403 / 400 / 409 / 200 / 500 |
| `app/admin/business-os-llm/page.tsx` | modify | Tab strip; Settings tab = today's content, unchanged |
| `app/admin/business-os-llm/components/costs/*.tsx` | create | Costs & credits tab sections |
| `app/admin/business-os-llm/costTypes.ts` | create | Local payload types (the source guard forbids lib imports, V-19) |
| `app/admin/business-os-llm/__tests__/costsTab.render.test.tsx` | create | States and sections |
| `app/admin/business-os-llm/costCopy.ts`, `costFormat.ts` (+ `__tests__/costFormat.test.ts`) | create (added at T4a.5) | The tab's words in one place; USD with enough decimals for sub-cent amounts |
| `lib/business-os/credits/__tests__/creditReport.wireTypes.test.ts` | create (added at T4a.5) | Pins `costTypes.ts` to `creditReportTypes.ts`, both directions |
| `scripts/typecheck-bos-llm.ts` | modify (added at T4a.5) | `lib/business-os/credits/` joins `SCOPED_DIRS`, so the wire-type pin is compiled by the gate (Jest checks no types) |
| `app/admin/components/AdminSidebar.tsx`, `app/admin/business-os-llm/__tests__/nav.test.ts` | modify | Description "Models, temperatures & costs" |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | New gated route row(s) |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | Metering section: where the report lives |

### 7.2 Part 4b

| File | Action | Reason |
|---|---|---|
| `lib/business-os/credits/creditLeakCheck.ts` | create | Pure classifier + period rule + runner (§5.2, §5.3) |
| `lib/business-os/credits/creditLeakCheckTypes.ts` | create | The result type (server side) |
| `lib/business-os/credits/creditLeakCheckDeps.ts` | create (D-11) | The production wiring of the three repositories |
| `lib/business-os/credits/__tests__/creditLeakCheck.test.ts` | create | Every case of §5.2, B-1, S-1 to S-4, the runner |
| `lib/business-os/credits/__tests__/creditLeakCheck.ac31.test.ts` | create | AC-31 through the real `runAiAction` |
| `lib/business-os/credits/__tests__/creditLeakCheck.wireTypes.test.ts` | create | Pins `leakTypes.ts` to the server type, both directions |
| `lib/repositories/BusinessOsCreditLedgerReadRepository.ts` (+ test) | modify | `listRowsForAccountCreatedInRange` (D-10) |
| `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` | modify (D-11) | The wiring file declared as a plan-row reader |
| `app/api/admin/business-os/credits/leak-check/route.ts` (+ test) | create | On-demand door |
| `app/api/cron/credit-leak-check/route.ts` (+ test) | create | Nightly door |
| `lib/cron/bosCronJobs.ts`, `lib/cron/__tests__/bosCronJobs.test.ts`, `lib/cron/__tests__/vercelCrons.test.ts` | modify | Job id, schedule, counts, time limit; 13 jobs |
| `vercel.json` | modify | `/api/cron/credit-leak-check` at `45 4 * * *` |
| `app/admin/business-os-llm/components/costs/LeakCheckPanel.tsx`, `leakTypes.ts`, `leakCopy.ts` (+ `__tests__/leakPanel.render.test.tsx`) | create | Button and result |
| `app/admin/business-os-llm/components/costs/CostsTab.tsx` | modify | Mounts the panel |
| `app/admin/__tests__/jobsQueues.render.test.tsx`, `lib/admin/jobs/__tests__/buildJobsQueuesView.test.ts`, `lib/admin/jobs/__tests__/qa-slice5-pr2.status.test.ts`, `app/api/admin/jobs-queues/__tests__/route.test.ts`, `app/api/cron/__tests__/runRecord.adoption.test.ts`, `lib/admin/health/evaluateHealth.ts` (comment) | modify (D-18) | "12 jobs" pins → 13 |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`, `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | Register row 86; Metering pointer |

### 7.3 Part 4c

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261016_business_os_credit_adjustments.sql` | create | §6.2 |
| `supabase/SQL Scripts/20261016_business_os_credit_adjustments_rollback.sql` | create | Refusing rollback |
| `scripts/check-bos-credit-adjustment-migration.sql`, `scripts/probe-bos-credit-adjustment-migration.sql` | create | Read-only checker; always-raising probe |
| `supabase/migrations/__tests__/business-os-credit-adjustments.migration.test.ts` | create | Static guard of the SQL (§10.3) |
| `lib/repositories/BusinessOsCreditChargeRepository.ts` (+ test incl. `ALLOWED`) | modify | `recordAdjustment` |
| `lib/business-os/credits/creditAdjustment.ts` (+ test) | create | §6.3 |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | Register `creditAdjustment.ts` as a non-gate importer of `CREDIT_VALUE_HISTORY` |
| `lib/audit/events.ts` (+ `EVENT_METADATA`), `lib/audit/types.ts` if a new entity type is ruled | modify | `BOS_CREDIT_ADJUSTMENT_RECORDED` |
| `app/api/admin/business-os/credits/adjustments/route.ts` (+ test) | create | §6.3 |
| `app/admin/business-os-llm/components/costs/ReconcileAction.tsx` (+ render test) | create | The one write in the UI |
| `scripts/check-bos-credit-charges-migration.sql` | modify **only if** Q-11's column is taken | C2 hidden-column list |
| `docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_4_WORKPLAN.md` §6.4 (to be written at T4c) | modify | PROD apply / verify runbook |

---

## 8. Estimate and the split decision

| Part | Work | Estimate |
|---|---|---|
| **4a — Operator cost report** | Read repository + tests (0.5); effective fields + percentiles + report builder + tests (1); route + tests (0.5); tab UI + render tests (1); gates, docs, evidence (0.5) | **≈ 3.5 days** |
| **4b — Leak check, on demand and nightly** | Pure classifier + tests incl. AC-31 fixture (1); runner with deadline + repo method (0.5); two routes + cron registry + `vercel.json` + tests (0.5); panel (0.25); gates and docs (0.25) | **≈ 2.5 days** |
| **4c — Reconcile a fallback-priced charge** | Migration + rollback + checker + probe + static test (1.25); repository method + service + route + audit + tests (1); UI action (0.25); PROD runbook (0.5) | **≈ 3 days**, plus the user's PROD apply before merge |
| **Total** | | **≈ 9 days** |

**Decision: split into three, 4a → 4b → 4c.** Two parts ("4a report; 4b leak check + adjustments") would leave 4b at about 5.5 days, over the few-days rule, and would tie the leak check, which is read-only and needs nothing from the user, to a migration that needs a PROD apply. Each part ships alone:

- **4a** is self-contained: no migration, no write, no cron. It is also the first thing worth having once charging starts.
- **4b** depends only on 4a's read repository and tab.
- **4c** depends on 4a (the fallback list is where the action lives). **Today there are no fallback-priced rows at all (V-4)**, and after slice 2 only a defect can produce one. 4c can therefore wait until the first one appears without anything being wrong in the meantime (BQ-3).

---

## 9. Task list

### 9.1 Part 4a — Operator cost report

- ✅ **T4a.0** Branch `feature/business-os-credit-deduction-slice-4` confirmed (off `95a7ead0`). User decisions BQ-1 to BQ-4 recorded (§14); SA S-5, S-6, S-7 folded into §4.1, §4.3, §4.6. **Baseline:** `npx jest lib/repositories lib/business-os/llm app/admin/business-os-llm app/admin/components lib/admin/__tests__` **80 suites / 1,597 tests, all pass**; `typecheck:bos-llm` 307 files, 28 errors, **0 new**; `check:bos-llm-literals` 50 files, **0 violations**; `test:bos-entitlements` **88 / 1,825 pass**.
- ✅ **T4a.1** `BusinessOsCreditLedgerReadRepository` + test (29 tests): allow-listed columns, account methods refuse a missing / malformed id before querying, the one all-accounts read is named so, paging + de-duplication + ceiling, never throws, source test for no write verb and no `service` filter, and an importer guard (only the report builder, the barrel and tests). The writer's `ALLOWED` list is unchanged.
- ✅ **T4a.2** `effectiveFields.ts` + `percentiles.ts` + tests; N-10 source guard `serviceColumn.guard.test.ts` (four rules, each proved on planted violations first: a PostgREST filter / order on `service`, an or-expression on it, SQL `GROUP BY` / `WHERE service =`, and a Node `.service` read outside the resolver).
- ✅ **T4a.3** `creditReport.ts` + `creditReportTypes.ts` + test (21 tests) on the §10.1 fixture: every period equals its totals row by the totals' own rules (S-7), every breakdown sums to the grand total, a correction is counted under its charge's service / type / area / trigger, the correction in another period is fetched by id, an unfindable one is its own bucket, fallback list with the reconciled flag, spreads over succeeded charges (S-6). Failures: mismatch shown with both figures, ceiling → incomplete + "not checked", each read failing alone, empty, an orphan period, an unreadable amount.
- ✅ **T4a.4** Route `GET /api/admin/business-os/credits/report` + test (22 tests): 401 / 403 with no read, `requireAdmin` pinned as the first statement after the logger, 10 × 400 (one date, `from > to`, > 92 days, future `to`, unknown key, malformed id, malformed / impossible date, repeated key) with no read, 409 platform account with no read, 200 default 30 days and narrowed, the one `info` log (no business name), a failed read → 200 with that section failed, 500 generic.
- ✅ **T4a.5** Tab strip + Costs & credits tab + `costsTab.render.test.tsx` (20 tests) + `costFormat.test.ts` (18 tests); sidebar description `'Models, temperatures & costs'` + `nav.test.ts`. The page's `source.guard.test.ts` is **unchanged and green** over the new files (it walks the folder). Wire-type pin `creditReport.wireTypes.test.ts`, with `lib/business-os/credits/` added to the gate's `SCOPED_DIRS`; **mutation-tested**: making the client's `rowsRead` non-nullable fails `typecheck:bos-llm` with TS2344 on the pin (reverted).
- ✅ **T4a.6** Docs: `ADMIN_IDENTIFICATION_AND_ACCESS.md` register row 85; `BUSINESS_OS_ENTITLEMENTS.md` Metering pointer. **Gates after:** baseline set **83 / 1,684 pass** (80 + the 3 new suites in those folders); new + directly affected suites **14 / 355 pass**; wider set incl. `lib/business-os/usage` and `app/api/admin/business-os`: 104 suites, **2 failures, both pre-existing and outside this diff** (below); `typecheck:bos-llm` **318 files, 28 errors, 0 new, passed**; `check:bos-llm-literals` **51 files, 0 violations**; `test:bos-entitlements` **89 / 1,854 pass** (nothing imports the entitlements module); authz surface guard pass; scoped `tsc` over every new / changed file **0 errors in them** (6 pre-existing in the transitively loaded `lib/analytics/aiAnalytics.ts`); ESLint clean; `next build` (6 GB heap, CI placeholder env) **exit 0**, `ƒ /api/admin/business-os/credits/report` and `ƒ /admin/business-os-llm` (9.65 kB) built. `git diff --stat`: 7 tracked files, 77 insertions, 8 deletions; no deletion without insertion.
- ✅ **T4a.7** Handover: uncommitted, for SA code review → user view → QA → RM.

**T4a deviations**

| # | Deviation from §4 / §7 | Why |
|---|---|---|
| D-1 | Business names are looked up by the **route** (`findNames`, injected into the builder), not by `creditReport.ts` | `lib/repositories/__tests__/adminReadMethods.guard.test.ts` allows `findAdminIdentitiesByUserIds` to be called only from `app/api/admin/**`. The builder has no default for it |
| D-2 | `findChargesByActionIds` is unscoped by account (as planned), and the builder refuses to resolve a correction whose original sits on **another** account (unresolved bucket) | A lookup by id is not an ownership proof (tenant-isolation-guard); attributing it would move a figure between accounts |
| D-3 | `lib/business-os/credits/` added to `typecheck:bos-llm`'s `SCOPED_DIRS` | The only way the wire-type pin is checked at all (Jest checks no types); the script's documented extension point |
| D-4 | Periods shown: `period_start` in `[window start - 31 days, window end)` | A billing period is at most 31 days (anchor + n months), so no overlapping period is missed; a shorter one that ended up to 3 days before the window may be shown. Stated on the tab |
| D-5 | Amounts summed as integers of the column's scale (credits x 10^6, cost x 10^10) | The cross-check is an equality, not a tolerance; a float rounding can never show as a mismatch |
| D-6 | Two extra payload fields: `rowsRead` and `unreadableAmounts` | The log line's row count, and a never-silent count of amounts that could not be read (expected 0) |
| D-7 | Extra files: `costCopy.ts`, `costFormat.ts` (+ test), `components/costs/CostsSections.tsx`, the wire-type test | One place for the tab's words; USD formatting that keeps two significant digits up to 10 decimals |
| D-8 | On the Costs tab, the Settings refresh / "read at" and the standing note are hidden (`hidden` attribute); the "Read-only" pill stays | They describe the settings, not the report; the whole page is still read-only in 4a |
| D-9 | Admin register: row 85 added, census **not** re-derived | A quick count finds 88 handlers / 58 files; the 3 extra are the invite routes (gated, never registered). Flagged to TL |

**Pre-existing reds, not in this diff:** `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` (`TokenUsageRepository` has a `summariseFeatureAllAccountsInWindow` method its arity pin does not list; the repository was last changed by `2ab01d9b`), and `app/api/admin/business-os/entitlements/__tests__/routes.test.ts` (`payments.reminders` is now granted by tier while the pinned body expects the lifecycle gate). Neither the tests nor their subjects are touched here.

**`console.*` (CLAUDE.md § Logging):** every new file 0. Modified `page.tsx`, `AdminSidebar.tsx`, `lib/repositories/index.ts`, `nav.test.ts`: 0. **Flag:** `scripts/typecheck-bos-llm.ts` has **10** `console.*` calls. It is a CLI gate outside `lib/`, `app/` and `components/`, and its console output is its report; no conversion proposed unless the user wants one.

**What the user will see on the tab** (`/admin/business-os-llm` → **Costs & credits**): the intro line; window buttons Last 7 / 30 / 90 days (30 selected), From / To date fields with "Apply dates", an Account picker ("All accounts" plus every business in the window), refresh with "read at … UTC"; a line with the window, the ledger rows read and the period rule. Then **"No charges recorded in this window"** (what production shows until charging goes live), or four sections: *Per account and billing period* (business, period start, credits, owner / scheduled / external / corrections, cost in USD, charges, fallback count, and a check chip: "matches its rows", "mismatch" with the rebuilt figures, or "not checked", plus a Total row); *Breakdowns, net, including corrections* (action type, area, service, trigger); *Fallback-priced charges* (count, reconciled count, newest 50); *Spread per action type* (succeeded examples, failed beside them, cost and credits p50 / p90, a "few examples" chip below 10). An amber "Incomplete" banner when a read hit its ceiling; a red box on a failed read.

- ✅ **T4a.8** SA code review and QA report findings fixed (2026-09-29, Dev). Uncommitted. No real database was touched: every Jest run used `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys.

**T4a.8 evidence: each finding, its fix and its test**

| Finding | Fix | Test (red first where it could be) |
|---|---|---|
| **CR-B1** (High): the rows read was bounded by the newest `period_start` truncated to milliseconds, with `.lte` | `creditReport.ts`: the rows are read with the **same** `periodRange` as the totals, `[window start − 31 d, window end)`. The range is half-open with a whole-day exclusive end, and the `end − 1 ms` is gone. `rowsRange` / `Date.parse` bounds were removed. Repository: `CreditPeriodStartRange` is now **half-open** (documented why), both reads use `.gte` + **`.lt`**, and the guard refuses `from >= to` | `creditReport.test.ts`: ledger mocks now **honour the range at microsecond precision** (`micros()` parses the `timestamptz` string; `from <= ps < to`), with a self-test that a millisecond bound excludes a `.345678` value. New `CR-B1` block (2 cases: all accounts, and one account whose current period is the newest read) with `period_start = 2026-09-05T10:11:12.345678+00:00`. It asserts that the rows-read range equals the totals range, that its `to` is later than the raw newest `period_start` in microseconds, `rowsRead = 3`, both periods "matches", 0 mismatched, and the rows in breakdowns and spreads. The happy-path range test now pins `to = 2026-10-01T00:00:00.000Z` for both reads. **Red on the old builder, proved twice:** (a) with the half-open mock, 14 tests fail; (b) with the mock switched to the OLD inclusive `<=` contract and the range assertions removed, the CR-B1 cases still fail with **`rowsRead` 1, expected 3** (the microsecond period's rows dropped), which is QA's reproduction. Green after the fix. Repository test: `lt` pinned and `lte` absent on both reads, an empty half-open range refused, and a source rule "no `.lte('period_start'`" |
| **CR-S1** (Medium): an orphan period was always a mismatch, even when the totals read hit its ceiling | When `totals_ceiling` is set, a period with rows but no totals row read is `matches: null` ("not checked"), and it is not counted in `mismatchedPeriods`. Exactly at the ceiling: both repositories already use one rule, `reachedCeiling = rows >= ceiling`. That is conservative, since a full last page cannot be told from a cut one. It is now documented on `CreditLedgerPagedResult` and in the builder, and the builder treats the flag the same way for both reads | `CR-S1` test: totals at the ceiling plus a stray B period → `stored: null, matches: null`, `mismatchedPeriods = 0`, and the read periods are still "matches". Red on the old builder. The existing "orphan without ceiling → mismatch" test still passes |
| **CR-N1**: exactness bound | `creditReport.ts` header: sums stay exact below 2^53 units, which is about **$900,719 per cost sum** and about 9 billion credits. `Number()` is exact to about 15 significant digits. The RPC (R-3) must take over before any sum approaches this | — (comment) |
| **CR-N2** (tab) | `CostsTab.tsx`: each read takes a sequence number and **aborts** the previous one (`AbortController`). A response or error that is no longer current is ignored, and `loading` is cleared only by the current read. An unmount also abandons the read. A **failed read clears the report** (`setPayload(null)`), so an old window never sits under the red box. `page.tsx`: the Costs tab is mounted on first choice and then **kept mounted (hidden)**, so the window, account and report survive a tab switch with no re-read. Each tab has an `id` and `aria-controls`, and each panel is `role="tabpanel"` with `aria-labelledby` and `hidden`. The Settings content moved into its panel, and its existing `onSettings` gates are unchanged | `costsTab.render.test.tsx`: a slower earlier response does not overwrite a newer window; a slower earlier failure does not show an error over a newer report; a failed re-read clears the report and the window line; tabpanel wiring for both tabs; a tab switch keeps "Last 7 days" and the chosen account and makes no new read. **Mutation-tested:** with the sequence guard disabled and the clear-on-failure removed, the 3 response tests fail (reverted). The old "switch back → `costs-tab` not in the document" assertion is now "not visible" |
| **QA Low 2**: `unreadableAmounts` was invisible | Route: the `info` line carries `unreadableAmounts`. Tab: an amber one-line notice when > 0 (`UNREADABLE_AMOUNTS` in `costCopy.ts`) | Route test pins `unreadableAmounts: 0` in the log line. Render tests: notice at 3, none at 0 |
| **QA Low 3**: a failed originals read looked like a ledger break | `CostsSections.tsx` reads `sections.originals`. When it is `failed`, it shows `ORIGINALS_FAILED` ("…could not be read… a failed read, not a gap in the ledger; re-read…", with the count and credits) **instead of** the "could not be matched" line | Render test: `originals: 'failed'` → the read-failed note with "1 correction (-0.1 credits)", and no `costs-unresolved` |
| **QA Low 4**: a cross-account unresolved correction set the other account's `reconciled` | `creditReport.ts`: `reconciledIds` is filled only from **resolved** corrections (`f.resolved`, which already implies the same account, D-2) | Builder test: A's `fallback_price_reconciled` correction points at B's fallback charge → B's item `reconciled: false`, A's own stays `true`, `fallback.reconciled = 1`, and the correction is unresolved. Red on the old builder |
| **QA edge 6**: percentiles below display precision printed as `$0.00` / `0` | `costFormat.ts`: a non-zero value below the stored precision (USD < 1e-10, credits < 1e-6) gets the decimals for two significant digits, capped at 20. Every value at or above the stored precision formats exactly as before | `costFormat.test.ts`: `4e-11 → $0.00000000004`, `1.23e-12 → $0.0000000000012`, negative, never `$0`/`$0.00…`; credits `1e-7 → 0.0000001`, `4.4e-7 → 0.00000044`, `-2.5e-8`, `0 → 0` |
| **QA edge 7**: a synchronous throw from `findNames` became a 500 | `creditReport.ts`: the rows read and the name lookup each start inside `Promise.resolve().then(...)`, so a synchronous throw fails **only its own section** | Builder tests: a sync throw from `findNames` → `names: 'failed'`, and the rest is ok; a sync throw from the rows read → `rows: 'failed'`. Both red on the old builder. Route: the old 500 test relied on this path, so it now asserts **200 with `names: 'failed'`** and no leaked message. The 500 test now uses a totals result whose `rows` getter throws (a real unexpected failure), and it is still the generic body |
| **QA edge 8**: exactly at the ceiling reads as incomplete | Kept as the conservative rule, the same in both reads (see CR-S1). A false "incomplete" is possible, and a false "complete" never is | Covered by CR-S1 and the existing repository ceiling tests |
| CR-N3, CR-N4 | Left as notes, as instructed | — |

**Gates after T4a.8**

| Gate | Result |
|---|---|
| New and directly affected suites (read repository test, `lib/business-os/credits/__tests__`, the report route test, `costsTab.render`, `costFormat`) | **9 suites / 158 tests pass** |
| `npx jest lib/repositories lib/business-os/credits app/admin/business-os-llm app/api/admin/business-os/credits` | **61 suites / 1,014 tests pass** |
| `npm run test:authz-guard` | **1 / 119 pass** |
| `npm run typecheck:bos-llm` | **318 files, 28 errors, 0 new, passed.** It also reports the same pre-existing "baseline entry fixed" note QA saw (`app/api/onboarding/build/route.ts`, not in this diff) |
| `npm run check:bos-llm-literals` | **51 files, 2 exempt, 0 violations** |
| Scoped `tsc` over every new or changed file | **0 errors in them.** The 6 errors are the pre-existing ones in the transitively loaded `lib/analytics/aiAnalytics.ts` |
| ESLint on every changed file | Clean |
| `next build` (6 GB heap, the `build.yml` CI placeholder env) | **Exit 0.** `ƒ /admin/business-os-llm` (10.2 kB) and `ƒ /api/admin/business-os/credits/report` were built |
| `console.*` in touched files | 0 |

**Diff since the SA / QA run.** Tracked: `page.tsx` (tabpanels; most of its line count is the Settings content re-indented into its panel). Untracked, and changed in this pass: `creditReport.ts` (+40 / −18), `BusinessOsCreditLedgerReadRepository.ts` (+20 / −6), `CostsTab.tsx`, `CostsSections.tsx`, `costCopy.ts`, `costFormat.ts`, `route.ts`, and the tests (`creditReport.test.ts`, the read-repository test, `route.test.ts`, `costsTab.render.test.tsx`, `costFormat.test.ts`). No deletion without insertion. Nothing committed.

**Re-run owed by QA** (from QA's list): the new suites, `app/admin/business-os-llm`, `lib/repositories`, the authz guard, `typecheck:bos-llm`, `check:bos-llm-literals`, the microsecond test (now in `creditReport.test.ts`, "CR-B1" block), and QA's hand-computed fixture repeated with microsecond `period_start` values.

### 9.2 Part 4b — Leak check

Branch `feature/business-os-credit-deduction-slice-4b` (worktree `neuronforge-llm-deduction`), stacked on 4a's branch (PR #150, which already merged `origin/main`). Uncommitted. No migration. No real database: every Jest run used `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys; the worktree has no `.env*`; no dev server was started.

- ✅ **T4b.0** SA B-1, S-1 to S-4, N-3, N-5, Q-9, Q-15 and user decision BQ-2 folded into §5 (as SA asked, before code). **Baseline** (`lib/business-os/credits lib/repositories app/admin/business-os-llm app/api/admin/business-os/credits lib/cron app/api/cron`): 69 suites / 1,404 tests, **1 failure, pre-existing** (see below).
- ✅ **T4b.1** `classifyLeakGroups` + tests: one test per §5.2 case (matched, uncharged, uncharged-by-presence at $0, no-spend, ungrouped with and without spend, under-charged, pending over, pending under (N-8), fallback within T, charged above usage, known path); the tolerance edge (exactly `T` matched, `T + 1e-9` under-charged) and the rounded-vs-truncated case (S-2); **B-1**: the 23:40 / 00:20 example both ways, the same discrepancy seen by the night before (two-night reporting), slack-only group not examined, `[S, E)` membership at both edges, a group examined through its charge only; a reused onboarding group (three turns, two charges → under by the third); an adjustment inheriting service and group (N-10); an unresolved adjustment; another service; another account's row; unreadable amounts; the examples cap; the period (S-4): charge's stored period verbatim, plan-anchor period (six date cases incl. the 31st clamped into February and a year boundary), calendar month without a plan, unreadable anchor → null. **Mutation-tested:** with B-1 reverted to "first call in the window", the midnight test fails (reverted).
- ✅ **T4b.2** `listRowsForAccountCreatedInRange` on the 4a read repository + 7 tests (account-scoped `.eq('user_id')`, half-open `.gte` / `.lt` on `created_at`, no `kind` / `service` filter, order, paging and de-duplication, ceiling, every refusal before querying, never throws; source rule "no `.lte('created_at'`"). `runCreditLeakCheck` + tests: the walk is plan accounts ∪ charged accounts without a plan, platform account removed, id order (S-1); the exact read windows (usage `S − 1 h − 300 s` … `E + 1 h − 1 ms`, charges `S − 1 h` … `E + 1 h + 300 s`); one-account mode reads only that account; platform count and helper label (Q-9); the shared insight run id on two accounts (V-10); a failed read and a thrown read → "could not check"; a ceiling → "incomplete", no error log; the deadline → `accountsRemaining`; a failed plan listing → `listingFailed` and the charged accounts still walked; plan paging by last id; the logs (one `error` per leaking account with the exact fields, one `warn` for known paths across accounts, one `info` summary); the on-demand end clamp; the nightly window; the blind spots; a read-only source rule.
- ✅ **T4b.3** On-demand route `GET /api/admin/business-os/credits/leak-check` + test (22): 401 / 403 with no read, 401 before validation, `requireAdmin` pinned as the first statement after the logger, `maxDuration = 60`, 9 × 400 (one date, `from > to`, 8 days, future `to`, unknown key, malformed id, impossible date, repeated key) with no read, exactly 7 days accepted, 409 platform account with no read, 200 default = yesterday with the real runner over fake reads, one-account reads, the business name in the body and in **no** log line, a failed name lookup, a failed `token_usage` read, 500 generic. Panel `LeakCheckPanel.tsx` + `leakPanel.render.test.tsx` (15): no run on mount, default dates, the query sent (with and without an account), leak / clean / 4 × partial verdicts, remaining + end-clamped notes, a could-not-check row with its reason, known paths, every blind spot, an error clears the result, one run at a time and unmount aborts. Wire-type pin `creditLeakCheck.wireTypes.test.ts`, **mutation-tested**: `accountsRemaining: string` on the client fails `typecheck:bos-llm` with 2 × TS2344 (both directions; reverted).
- ✅ **T4b.4** Cron route `GET /api/cron/credit-leak-check` + test (9): production without `CRON_SECRET` → 401 + the fail-closed `error` log + no read; wrong bearer, no header, secret without `Bearer ` → 401, no read; the previous UTC day; counts only (no money in the body); every registered count present as a number; a read failure → `accountsNotChecked`; `withCronRunRecord` and `maxDuration` pinned; no write verb, audit or email. `bosCronJobs.ts` entry (`45 4 * * *`, `DAILY`, `MAX_60`, 11 counts, 4 partly-done rules); `vercel.json` line; the job joins the existing adoption suite automatically (its three cases pass for `credit-leak-check`). Six tests that pinned "12 jobs" updated to 13, deliberately (D-18).
- 🟡 **T4b.5** **AC-31 evidence: done, in Jest** (`creditLeakCheck.ac31.test.ts`): (1) a Business OS call made outside `runAiAction`, and (2) an action through the **real** `runAiAction`, charge recorder and writer repository with the database refusing the charge RPC (`42501`). The captured order proves V-7 / Q-14: `token_usage_written`, `token_usage_written`, `charge_attempted`; `bos_ai_charge_write_failed` is logged. The check reports **both** groups as uncharged, with the account, the period (plan anchor rule) and an `error` `bos_credit_leak_found` naming both group ids. **Owed by the user:** the first real on-demand run on production data (read-only), for the first full day after go-live (SA N-2), pasted here.
- ✅ **T4b.6** Gates, docs, handover (below). Docs: `ADMIN_IDENTIFICATION_AND_ACCESS.md` register row 86 + Change History; `BUSINESS_OS_ENTITLEMENTS.md` Metering pointer + Change History.
- ✅ **T4b.7** SA and QA 4b findings fixed (2026-09-30). Uncommitted; no migration; no real database.

| Finding | Fix | Test (red first) |
|---|---|---|
| **CR4b-S1** (SA, should fix; QA concurs) | `creditLeakCheck.ts` `checkAccount` takes the runner's `settleEndMs`; the usage read ends at `min(E + 1 h − 1 ms, now − 6 min)`. The charge read is unchanged. D-13 extended | `creditLeakCheck.test.ts` "CR4b-S1: …": now 09-29 04:45, on demand `to` = today (end clamped to 04:39), reused group G1 with a charged turn at 04:00 and an uncharged turn at 04:43 (now − 2 min), a usage fake that honours the read window. **On the old code it fails twice over:** the read end is `05:38:59.999Z` (expected `04:39:00.000Z`), and with that assertion removed `accountsWithLeak` is **1** (expected 0), the phantom under-charge at `error`. Passes after |
| **QA4b-B1** (QA, Medium) | No migration. `BosCronJob.addedOn?: 'YYYY-MM-DD'` in `lib/cron/bosCronJobs.ts`, set only on `credit-leak-check` (`'2026-09-30'`). New pure `jobBaseline(job, baseline)` in `buildJobsQueuesView.ts`: a job with no Vercel cron run is timed from the **end** of its added UTC day, or the global baseline if later (D-22). `jobStatus` uses it; `expectedBy` / `lateAt` / `stoppedAt` follow. A job without `addedOn` keeps the global baseline exactly as before, and every other rule is unchanged | `buildJobsQueuesView.test.ts` "QA4b-B1" (6): the registry dates only the new job; `jobBaseline` (end of day, later global wins, null global, undated, unreadable date); with the other jobs' first run 2026-09-28 10:00, the new job with no run reads **"No run recorded yet"** at 09-30 15:00, 10-01 03:00 (before its first 04:45 run) and 10-02 00:59, `expectedBy` 10-02 00:00; **late** after 10-02 01:00, **stopped** after 10-03 01:00; an undated job with no run since 09-28 is still "Stopped" on 10-02; the Health "Scheduled jobs" tile at 10-02 00:30 is `not_measured` (facts 12 healthy / 0 stopped / 1 no run yet), never red. **With `addedOn` removed, 5 of the 6 fail** (the new job reads `stopped`, the tile facts carry `stopped: 1`); the undated case passes either way, as it should |
| **QA4b-E1** (QA, Low) | `LeakCheckPanel.tsx`: a row with any of *charged above usage*, *unresolved corrections* or *unreadable amounts* carries a note beside its status, e.g. "2 charged above usage · 1 unresolved correction · 3 unreadable amounts" (`LEAK_ROW_NOTE` in `leakCopy.ts`, non-zero counts only) | `leakPanel.render.test.tsx` "QA4b-E1": a "No leak" row with all columns zero shows the note; a row without those counts has none. **Fails with the note disabled** |
| **CR4b-N2 / QA4b-E2** (cosmetic) | When the clamp leaves `end ≤ start`, the verdict is **"Nothing to check yet — the window has not ended"** (`LEAK_EMPTY_WINDOW`), neutral with an amber edge and a clock icon, never the green "clean". Order: leak → empty window → partial → clean | `leakPanel.render.test.tsx` "CR4b-N2 / QA4b-E2": `window.start == window.end`, `endClamped` → `leak-verdict-empty`, no `leak-verdict-clean`, the end-clamped note still shown. **Fails on the old panel** (it rendered green) |

Two existing tests in `qa-slice5-pr2.status.test.ts` state the global-baseline rule for **every** job; they now strip `addedOn` for the per-schedule rule (the dated behaviour is pinned in the QA4b-B1 block), and the "installed 40 days ago → every job stopped" fixture (clock 2026-09-27) now expects every **undated** job stopped and the dated one `no_run_yet`, because its added day is after that clock. Both edits are deliberate (the D-18 kind).

**T4b deviations**

| # | Deviation from §5 / §7.2 | Why |
|---|---|---|
| D-10 | The new read method is `listRowsForAccountCreatedInRange`, not `listChargesForAccountInWindow` | It returns charge **and** adjustment rows (an adjustment inherits its charge's service and group, N-10), and its range is half-open on `created_at`. The name says so |
| D-11 | A wiring file, `creditLeakCheckDeps.ts`, holds the three repositories; it is declared on the plan repository's RC-15 guard (ALLOWED + NO_STATE_WRITE_REFERRERS, so the guard pins that it calls no plan write) and on the read repository's importer guard. `creditLeakCheck.ts` is also on the latter (type-only import) | The runner stays pure and testable with injected reads; declaring the referrer is the guard's own rule ("a declared referrer is auditable; a hidden one is not") |
| D-12 | The usage read ends at `E + 1 h` (the plan said `E`) and the charge read at `E + 1 h + 300 s` | With B-1's "any activity" rule the slack must match on both sides; the extra 300 s at the top mirrors SA's lower-edge rule, so the upper edge produces no phantom under-charge. Stated in §5.2 |
| D-13 | On demand, an end later than *now − 6 min* is pulled back (`endClamped`) | Otherwise an action still running (calls written, charge not yet) would be reported as uncharged. The nightly window ends at midnight, so it is never clamped. **CR4b-S1:** the usage read's upper slack is capped at the same instant, `min(E + 1 h − 1 ms, now − 6 min)`, so a reused group examined for in-window activity never sums the calls of an action still running; the charge read keeps its full `E + 1 h + 300 s` |
| D-14 | A leak does not make the nightly run "partly done"; `knownPathCalls`, `accountsNotChecked` and `listingFailed` were added to the counts | The Q-U2 precedent: a business finding is a number, not a job fault; the `error` log is the alert. "Partly done" means "could not look everywhere" |
| D-15 | An account whose read hit a ceiling is "incomplete", never "leak", and gets a `warn`, not the `error` | A cut read can manufacture a phantom leak (a missing charge) as easily as hide one |
| D-16 | Pending reconciliation covers both directions; an under-charged fallback group is **shown** (with "under") but is not a leak; blind spot `fallback_masks_undercharge` states the cost | N-8 asked for it to be shown; BQ-4 says we never charge more, so it is a price-list signal, not a billing leak |
| D-17 | Business names are added by the admin route, for display, never logged | `adminReadMethods.guard` allows `findAdminIdentitiesByUserIds` only from `app/api/admin/**` (the 4a D-1 rule) |
| D-18 | Six existing tests and one comment pinned "12 jobs": `bosCronJobs.test.ts`, `vercelCrons.test.ts`, `jobsQueues.render.test.tsx`, `buildJobsQueuesView.test.ts`, `qa-slice5-pr2.status.test.ts`, `jobs-queues/route.test.ts`; `evaluateHealth.ts` comment; the adoption test's header | Adding a job is meant to be a deliberate edit of those pins. The Health "Scheduled jobs" tile's denominator becomes 13 |
| D-19 | The panel's date labels are "Check from / Check to (UTC)" | The 4a tab test queries the label "From (UTC)"; two identical labels would make it ambiguous |
| D-20 | The plan-anchor period is computed in TypeScript (the SQL rule, day clamped) at millisecond precision | A label only; a charged group always shows its stored `period_start` verbatim |
| D-21 | The on-demand door logs `bos_credit_leak_found` at `error` too (one function) | Every door states a leak the same way; pressing the button again repeats the line |
| D-22 | QA4b-B1: a dated job with no run is timed from the **end** of its `addedOn` UTC day (the brief said "the added-on date as its baseline") | The deploy can land at any hour, and this job's first run is 04:45 the next morning. Timed from 00:00 of the added day it would turn "Late" at 01:00 the next day, 3 h 45 min before its first scheduled run, a new false amber. From the end of the day it reads "No run yet" until 10-02 01:00, late after that, stopped after 10-03 01:00. **The date must be the real deploy day:** if 4b ships after 2026-09-30, RM updates `addedOn` in the same PR, or the false "Stopped" returns on deploy (by 10-03 01:00 for this job) |

**Pre-existing reds, not in this diff:** `app/api/cron/__tests__/runRecord.adoption.test.ts` › `payment-reminders` (the route calls `paymentReminderService.billDueDatedStages`, which the test's service mock does not provide; confirmed on `origin/main` `c1ff4d42`, and red in this branch's baseline before any 4b change). The two 4a-era reds (`tokenUsageRepository.contract`, `entitlements/routes`) are outside the folders run here.

**Gates after T4b**

| Gate | Result |
|---|---|
| New suites: `creditLeakCheck` (55), `creditLeakCheck.ac31` (1), `creditLeakCheck.wireTypes` (1), leak-check route (22), cron route (9), `leakPanel.render` (15); read repository test (41, +7) | **all pass** |
| `npx jest lib/repositories lib/business-os/credits app/admin/business-os-llm app/api/admin/business-os/credits` | **66 suites / 1,134 tests pass** |
| Wider: + `app/api/cron lib/cron lib/admin app/admin/__tests__ app/api/admin/jobs-queues lib/business-os/llm` | 116 suites / 2,730 tests, **1 failure, the pre-existing adoption red** above |
| `npm run test:authz-guard` | **1 / 119 pass** |
| `npm run typecheck:bos-llm` | **328 files, 28 errors, 0 new, passed** (+10 files in scope; the same pre-existing "baseline entry fixed" note, `app/api/onboarding/build/route.ts`) |
| `npm run check:bos-llm-literals` | **53 files, 2 exempt, 0 violations** |
| `npm run test:bos-entitlements` | **90 / 1,891 pass** (nothing in the diff imports `lib/business-os/entitlements/**`) |
| ESLint on every changed or new file | Clean |
| `next build` (6 GB heap, `build.yml` placeholder env) | **Exit 0.** `ƒ /admin/business-os-llm` (13.4 kB), `ƒ /api/admin/business-os/credits/leak-check`, `ƒ /api/cron/credit-leak-check`, `ƒ /api/admin/business-os/credits/report` built. The `level:50` lines are the known pre-existing "Dynamic server usage" noise from other modules |
| `console.*` in touched code | 0 (every new and modified file) |
| `git diff --stat` | 17 tracked files, 286 insertions, 48 deletions; no file with deletions only. 14 new files |

**Gates after T4b.7** (same env rules)

| Gate | Result |
|---|---|
| New and touched suites: `creditLeakCheck` (56, +1), `.ac31`, `.wireTypes`, leak-check route, cron route, `leakPanel.render` (17, +2), read repository, `lib/admin/jobs` (3 suites, +6 in `buildJobsQueuesView.test.ts`) | **10 suites / 255 tests pass** |
| `npx jest lib/business-os/credits lib/cron lib/admin app/admin/__tests__ app/admin/business-os-llm app/api/cron app/api/admin/business-os/credits app/api/admin/jobs-queues lib/repositories` | 93 suites / 2,138 tests: **1 failure, the pre-existing** `runRecord.adoption` › `payment-reminders` red |
| `npm run test:authz-guard` | **1 / 119 pass** |
| `npm run test:bos-entitlements` | **90 / 1,891 pass** |
| `npm run typecheck:bos-llm` | **328 files, 28 errors, 0 new, passed** (the same "baseline entry fixed" note) |
| `npm run check:bos-llm-literals` | **53 files, 2 exempt, 0 violations** |
| `tsc --noEmit` (whole project), filtered to the touched files | 0 errors |
| ESLint on every touched file | Clean |
| `next build` (6 GB heap, `build.yml` placeholder env) | **Exit 0.** `ƒ /admin/business-os-llm` 13.6 kB, both leak-check routes built. 65 `level:50` lines, all the known "Dynamic server usage" noise, none mentioning the leak check |
| `console.*` in touched code | 0 |

**What the user will see**

- **The button.** `/admin/business-os-llm` → **Costs & credits**, below the cost report: a **Leak check** box with a one-paragraph explanation, *Check from* / *Check to (UTC)* date fields (both default to yesterday; at most 7 days), a **Run leak check** button, and a scope line ("Checking every Business OS business", or "Checking one business: <name>" when an account is chosen in the tab's picker). Nothing runs until the button is pressed; while it runs the button reads "Checking…".
- **The result.** A line with the window, how many businesses were checked, and when; then one verdict: **red** "N businesses with uncharged AI spend ($X not charged)", **amber** "Not everything could be checked…" (a read failed, a read was cut, time ran out, or the business list failed), **neutral** "Nothing to check yet — the window has not ended" (the chosen window lies entirely in the last 6 minutes, e.g. *today* just after 00:00 UTC; CR4b-N2), or **green** "No uncharged AI spend found". Then a table of businesses with a finding: business, status (Uncharged spend / Could not check / Only partly read / No leak, with a short note such as "2 charged above usage · 1 unresolved correction · 3 unreadable amounts" when those are why a row is listed, QA4b-E1), billing period, *No charge*, *No group id*, *Charged less*, *Pending reconciliation* (with "N under" when the real price beat the fallback), *Known paths*, *Not charged (USD)*; each row opens a list of grouping ids (to look up as `token_usage.session_id`) with calls, recorded and charged USD and first-call time. Below: known uncharged paths (e.g. `business-os-chat / IntentParser`) as accepted, the platform-account line ("19 Business OS calls, 3 with the shared helper label"), and a folded "What this check cannot see" list. Until charging goes live, a run shows every Business OS call as uncharged (the ledger is empty, V-4) — expected, and exactly why T4b.5 waits for the first full day after go-live.
- **The nightly job.** On **Scheduled jobs & queues**, a 13th job **Credit leak check**, "Daily at 04:45 UTC", with its counts (businesses checked, with uncharged AI spend, AI actions with no charge, calls with no grouping id, charged less, pending reconciliation, known-path calls, partly read, could not be read, left when time ran out, list failed). It shows **"No run recorded yet"** until its first 04:45 UTC run, and the Health "Scheduled jobs" tile stays grey ("Not measured yet"), not red, meanwhile. That holds because the job is timed from the end of its deploy day (`addedOn: '2026-09-30'` in the registry, QA4b-B1 / D-22), not from the first run of any job (2026-09-27/28), which would have made it "Stopped" and the tile red on the first page load after deploy. If it still has no run by 10-02 01:00 UTC it turns **Late**, and by 10-03 01:00 UTC **Stopped**, by the usual rules. **If 4b deploys later than 2026-09-30, `addedOn` must be moved to the real deploy day in the same PR.** Each leaking business is one `error` log `bos_credit_leak_found` (account, billing period, window, counts, group ids, USD). No email (BQ-2).

### 9.3 Part 4c — Reconciliation adjustments

- ⬜ **T4c.1** Migration `20261016`, rollback, checker, probe, static migration test. SA executes in throwaway PGlite (precedent) at code review.
- ⬜ **T4c.2** `recordAdjustment` on the writer repository; `ALLOWED` gains the service and its test.
- ⬜ **T4c.3** `creditAdjustment.ts` + tests; entitlements non-gate registration; `npm run test:bos-entitlements` green.
- ⬜ **T4c.4** Audit event; route + tests; Reconcile action + render test.
- ⬜ **T4c.5** PROD runbook (§6.4, written here at this task): pre-check → apply → checker → probe → checker again → 20261015 checker still PASS. **The migration is applied by the user before 4c merges.**
- ⬜ **T4c.6** Gates, docs, handover.

---

## 10. Test plan

### 10.1 Part 4a

| Kind | Case |
|---|---|
| Happy | Fixture ledger with two accounts, two periods, all three triggers, a failed action, one fallback row, one adjustment of an `ai` charge in another period and one row of a fixture service `sms_fixture` → per-period figures equal the totals rows; by-type / by-area / by-effective-service / by-trigger sums equal the grand total; the adjustment is counted under `ai` and under its charge's action type and area (AC-34's effective-service read, N-10); `sms_fixture` is its own bucket with area "not declared" |
| Happy | p50 / p90 on known arrays (1, 2, 10 values); **succeeded charges only**, failed count beside, fallback rows excluded (S-6); "few examples" below 10 |
| Happy (S-7) | A period with one adjustment passes the totals cross-check (corrections in their own bucket) and still shows the correction under its charge's action type and trigger |
| Failure | A totals row that disagrees with its rows → the period is flagged mismatched, both figures shown |
| Failure | Rows read hit the ceiling → `incomplete: true`, banner; one read rejected → that section failed, the others present |
| Failure | Adjustment whose original cannot be found → "unresolved" bucket, counted, not dropped |
| Authz | Route: signed out 401, non-admin 403 (both before any read: the repository mock is never called), `requireAdmin` is the first statement (authz surface guard, automatic) |
| Validation | 400: one date only, `from > to`, span > 92 days, future `to`, unknown query key, malformed `accountId`; 409 platform account |
| Tenant isolation | Read-only; every account-scoped method refuses a missing / malformed account id before querying; the all-accounts read is only reachable by its named method; the read repository names no write verb (source test); the writer's `ALLOWED` list is unchanged |
| UI | Tab renders each state; no `@/lib/` import beyond the copy module; no `console.*` (existing source guard) |

### 10.2 Part 4b

| Kind | Case |
|---|---|
| Happy | Every row of §5.2's table, one test each; boundary at exactly `T` and `T + 1e-9` |
| AC-31 | Jest, with fakes: (1) a Business OS call made **outside** `runAiAction` (a usage row with a group id and no charge) and (2) an action run through the real `runAiAction` with the charge repository forced to fail (its usage row faked as written first, as V-7 guarantees) → the check reports both as uncharged spend, with the account and the period |
| Shared group id | The same group id on two accounts, only one charged → the other account is flagged, the charged one is matched (V-10) |
| Reused group | Three onboarding turns under one group id, two charges → under-charged by the third turn's cost |
| Failure | One account's `token_usage` read fails → "could not check", not clean; ceiling → "incomplete"; deadline → `accountsRemaining` |
| Authz | On-demand route 401 / 403 / 400; cron route: production without `CRON_SECRET` → 401 and `error` log, wrong bearer → 401, `withCronRunRecord` wraps it; registry counts have no money keys (`bosCronJobs.test.ts`) |
| Tenant isolation | Every read scoped to the account being checked; no write anywhere (the runner receives no writer) |
| Real data (T4b.5) | The user runs the on-demand check for the first full day after go-live and pastes the result. Expect 0 leaking accounts, or each finding explained |

### 10.3 Part 4c

| Kind | Case |
|---|---|
| Static SQL | `SECURITY INVOKER`, `SET search_path = ''`, `REVOKE ALL` then `GRANT EXECUTE` to `service_role` only; no `SECURITY DEFINER`, no trigger; `kind` hard-coded `'adjustment'`; **no user id parameter**; `ON CONFLICT … WHERE kind = 'adjustment' DO NOTHING`; the sign and magnitude bounds; the totals `UPDATE` scoped by the original's `user_id` and `period_start`; checker names every object the migration creates |
| Probe (PROD, always raises) | Creates a fallback charge on the user's own account, adjusts it (recorded, totals moved by exactly the delta, C7 rebuild equal), repeats (not recorded), refuses a positive delta, an over-large delta, a non-fallback original, an unknown id; `authenticated` cannot execute; nothing kept |
| Service | 404 unknown / not a charge; 409 not fallback-priced, detached, already reconciled; 400 corrected > original; credits computed at the original's version (a fixture history with v0 and v1); repository error → 500; audit called once with before / after, and its failure does not fail the request |
| Authz | 401 / 403 before the body is read; 400 on an injected `userId` / `accountId` / `credits` / `periodStart` (strict schema) |
| Tenant isolation | The RPC arguments contain no account id (asserted); the adjustment lands on the original's account and period whatever the admin's own id is; the writer `ALLOWED` list gains exactly the two new files |
| Entitlements | `npm run test:bos-entitlements` green with the new non-gate registration |

---

## 11. Guardrails and out of scope

| Must not | Source |
|---|---|
| Write anything except adjustment rows (4c only) and their totals move | Slice 4 guardrail |
| Correct or backfill a missed charge automatically | Slice 4 guardrail, SQ-3, N-7 |
| Change how `token_usage` is written, or `runAiAction`, the recorder, the charge RPC | Slice 4 guardrail; slice 3 |
| Touch `balance.ts`, refuse anything, add any owner-visible change | Task brief; slice 4 guardrail |
| Filter or group on the raw `service` column | N-10, KI-14 (source guard, T4a.2) |
| Take an account, period or version from a request for a write | NFR Security; tenant-isolation-guard |
| Read or write a Pilot-Credit table | FR-14, A-11 |
| Edit the applied `20261015` migration; use any migration number other than `20261016` (never `20261020`–`20261022`) | Task brief |
| Introduce an admin check other than `requireAdmin` / the layout's `requireAdminPage`, or read `profiles.role` | CLAUDE.md Security Rules |
| Add a results table, an aggregate RPC, or a new delivery channel (email) for leak findings | §3; BQ-2 |
| Put money into `bos_cron_runs` counts | V-17 |

Out of scope: a non-AI service's reconciliation (§16 of the requirement), grants (slice 11), the per-account position view (slice 11), provider-invoice reconciliation, a Health tile for the leak check (follow-up).

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The report and the check read rows into Node; volume grows | Ceilings with an explicit "incomplete" state (never a silent partial); today ~5,000 Business OS calls a month across all accounts (V-5) and 8 accounts |
| R-2 | The per-account walk gets slow as accounts grow (one read pair per account) | Deadline with `accountsRemaining` (on demand 45 s; nightly within its `maxDuration`); the nightly run records "partly done" |
| R-3 | Scale beyond the ceilings | The path is an aggregate RPC over `token_usage` keyed `(user_id, session_id)` (the planned Gap B0 function) and one over the ledger. Trigger: any account "incomplete" in a nightly run, or the walk not finishing |
| R-4 | False leaks from rounding (V-6) | Tolerance per call; detection of uncharged groups by presence, not cost |
| R-5 | False "clean" from a group reused across windows | Reporting rule keyed on the group's first call / the charge's time within the window; one-hour slack |
| R-6 | A "leak" that is really a known pre-existing path (chat v1 `IntentParser`, KI-6) makes the first nights noisy | It is real uncharged spend (KI-6 says the check will show it); the finding names the feature and component so it is triaged once |
| R-7 | `CRON_SECRET` not actually set (F-1) | The on-demand door works regardless; the jobs page shows the cron as stopped |
| R-8 | 4c makes the Business OS AI page write for the first time | Scoped to one confirmed action on the Costs tab; header comment and "Read-only" pill scoped to the Settings tab (Q-12) |
| R-9 | The adjustment's actor lives only in the queued, lossy audit trail (V-18) | Q-11 proposes an additive `created_by_admin_id` column |
| R-10 | Importing `aiActionAudit.ts` (for the area declarations) into the report pulls the recorder and audit modules into an admin route's graph | Server-only anyway; if SA prefers, the declarations are read through a small type-safe accessor with no runtime imports (Q-5) |

---

## 13. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| **Q-1** | The split: three parts (4a report, 4b leak check, 4c adjustments) instead of the two the brief suggested | Three; §8 |
| **Q-2** | The report's home: a "Costs & credits" tab on `/admin/business-os-llm`, with payload types duplicated locally because the page's source guard forbids `@/lib/` imports, or a new page | The tab; §3. The duplication is what the page already does with `types.ts` |
| **Q-3** | Reads through a **new read-only repository** (keeps the writer's `ALLOWED` guard intact) rather than adding reads to `BusinessOsCreditChargeRepository` | New read repository; the writer stays the only writer |
| **Q-4** | Node-side aggregation with ceilings now (no migration in 4a / 4b), RPC later (R-3) | Yes |
| **Q-5** | Extend N-10's inheritance from `service` to `action_type`, area and trigger, so an adjustment is reported under the charge it corrects | Yes; §4.2 |
| **Q-6** | Leak tolerance `calls × 0.0000005 + 1e-9` and detection by group presence (V-6) | Yes |
| **Q-7** | The window rule: one-hour slack, a group reported by the window holding its first call; the accepted blind spot of a sub-micro-dollar lost charge inside a reused group | Yes |
| **Q-8** | Both doors (on demand + nightly), no results table; the durable trace is `bos_cron_runs` counts plus one `error` log per leaking account | Yes; §5.4, §5.5 |
| **Q-9** | "Business OS spend" = `bosRowFilter()` only. Spend by Business OS accounts under the legacy `onboarding` value or the shared `onboarding` / `simple-complete` helper label is **not** checked. Should the check at least count those rows per account as "outside the filter" (information only)? | Count them, information only, not a leak |
| **Q-10** | Adjustment design: account, period, group and credit-value version taken from the original inside SQL; corrected ≤ original enforced in SQL; one per (charge, reason) by a partial unique index; reason enum `fallback_price_reconciled` only; the admin enters the corrected cost (no automatic re-pricing) | As proposed; §6 |
| **Q-11** | Record the acting admin **on the adjustment row** (additive `created_by_admin_id uuid`, NULL on charges, hidden from owners by the column grants) since the audit trail is queued and lossy (V-18)? It costs a CHECK and an edit to the 20261015 checker's C2 list | Yes, add it |
| **Q-12** | The Reconcile action on the Business OS AI page makes that page write for the first time. Acceptable with the "Read-only" statement scoped to the Settings tab, or should reconciliation be a script (as model settings were before their writer)? | The page action |
| **Q-13** | Percentiles: linear interpolation, fallback rows excluded, failed actions included, "few examples" below 10 | Yes |
| **Q-14** | The answer to slice 3 OI-2 (§2): the leak check does see a freeze-lost lead-alert charge, because the `token_usage` insert is awaited before the call returns (V-7); the only blind case is a freeze mid-call | Confirm |
| **Q-15** | The nightly schedule `45 4 * * *` checking the previous UTC day, `maxDuration` 60 with a 45 s walk deadline | Yes |

---

## 14. Business questions for the user

Asked in plain terms; each has a recommendation, and none blocks 4a.

**User decisions (2026-09-29): all four recommendations accepted.**

| # | Decision | Effect on the plan |
|---|---|---|
| **BQ-1** | Reconciliation credits go back to **the month the over-charge happened**. A make-good for the owner is a **grant** (slice 11), not a reconciliation | 4c: the adjustment row takes the original's `period_start` (§6.2 step 3, unchanged) |
| **BQ-2** | Leaks are shown on the **admin pages and in the logs only**. No email | 4b: no new delivery channel (§11 guardrail stands) |
| **BQ-3** | Build **4a and 4b now**; build **4c later**, with slice 5 or when the first over-charge appears, whichever comes first | 4c is not started in this cycle |
| **BQ-4** | **Never charge more after the fact.** We absorb under-charges; only downward corrections exist | 4c: corrections can only lower a charge (§6.2 step 4); 4b shows under-charged fallback groups (SA N-8) so the price list can be fixed |

- **BQ-1 — When we find we over-charged an owner and fix it later, which month gets the credits back?** Sometimes a charge is priced from a cautious fallback because a price was missing, so the owner was charged a little too much. If we correct it after their month has already reset, the credits can go back into **the month it happened** (the books stay exact, but the owner gets nothing they can still use), or into **their current month** (they get usable credits back, but last month's figures stay slightly high). *Recommendation: the month it happened, for now.* Today nobody is refused anything and nobody pays, so no owner is affected; the question matters only once limits are switched on, and can be revisited then. *(Needed before 4c.)*
- **BQ-2 — How do you want to hear about a nightly leak?** The plan shows it on the admin pages (the jobs page and the Costs & credits tab) and in the logs. An email to you each morning would be a new kind of notification. *Recommendation: the admin pages only for now.* *(Needed before 4b.)*
- **BQ-3 — Build the "fix an over-charge" part now, or when the first one appears?** There are **no** such charges today, and after the pricing fixes only a defect can create one. *Recommendation: build the report and the nightly check now (4a, 4b), and schedule 4c when the first over-charge shows up in the report — or with slice 5, whichever comes first.*

---

## 15. Flagged items (console.*, stale facts)

**`console.*`** (CLAUDE.md § Logging): every existing file this plan modifies was counted on 2026-09-29 and has **0** `console.*` calls: `lib/repositories/BusinessOsCreditChargeRepository.ts`, `lib/repositories/index.ts`, `lib/repositories/TokenUsageRepository.ts` (reused, not modified), `lib/repositories/BusinessOsAccountPlanRepository.ts` (reused), `lib/repositories/BusinessProfileRepository.ts` (reused), `app/admin/business-os-llm/page.tsx`, `app/admin/components/AdminSidebar.tsx`, `lib/cron/bosCronJobs.ts`, `lib/cron/cronRunRecorder.ts` (reused), `lib/audit/events.ts`, `lib/audit/types.ts`, `lib/business-os/llm/callCatalog.ts`, `lib/business-os/llm/aiActionAudit.ts` (read-only use), `vercel.json`, `scripts/check-bos-credit-charges-migration.sql`, and the tests `BusinessOsCreditChargeRepository.test.ts`, `bosCronJobs.test.ts`, `AdminSidebar.nav.test.ts`, `business-os-credit-charges.migration.test.ts`. `app/admin/business-os-llm/__tests__/nav.test.ts` and `source.guard.test.ts` match the string `console.` only in a comment and a test name (0 calls). **Nothing to flag.**

**F-1 — the `CRON_SECRET` premise looks stale.** V-16: production has `vercel_cron` rows in `bos_cron_runs` today, which the recorder only writes when `CRON_SECRET` is set. TL should confirm with Offir and update the memory note on the payment queue-drain (which still says blocked on the secret). The plan does not depend on it either way (§5.5).

**F-2 — charging start not yet recorded.** At the time of the live check the charge table was empty (V-4). The report's empty state covers it; 4b's first real run (T4b.5) should be for a day after the go-live RM records in the slice 3 workplan §15.

**F-3 — existing duplication, not fixed here.** Each cron route carries its own copy of the fail-closed `verifyCronSecret`; 4b copies the `payment-reminders` shape rather than introducing a shared helper (a new pattern). Noted for a later clean-up.

**Deprecated systems:** none touched or extended.

---

## SA Review Notes

**Reviewed by SA — 2026-09-29**
**Status:** ✅ Approved with conditions. **4a may start now.** 4b starts after B-1 and S-1 to S-4 are folded into §5. 4c starts after B-2, S-8 and S-9 are folded into §6 and the user has answered BQ-1 and BQ-4.

### Verdict in one paragraph

The plan fits the codebase. It reuses the right things: the Business OS AI admin page, `listCallsInWindow` with `bosRowFilter()`, `withCronRunRecord` / `bosCronJobs.ts`, and the writer repository for the one write. It adds no table, no aggregate RPC and no delivery channel. Tenant isolation for the write is correct in principle: the only id the caller supplies is the action id, and account, period, group and version all come from the original row inside SQL. I found two defects that would ship a wrong answer: a leak in a reused group that crosses midnight is never reported (B-1), and the SQL bound on an adjustment is only sound while exactly one reason code exists (B-2). Neither affects 4a. I verified every live fact the plan depends on and re-measured several of them (below).

### Verified (SA, 2026-09-29, read-only; worktree `95a7ead0` and PROD through the main checkout's `.env.local`)

| Claim | Result |
|---|---|
| V-1, V-2, V-3: ledger shape, the RPC hard-codes `kind = 'charge'`, `service_role` holds only `SELECT, INSERT` on charges | ✅ `20261015_business_os_credit_charges.sql` read in full. An adjustment's `period_start` is NOT NULL and `group_id` may be NULL. Its `credits` and `cost_usd` are unconstrained in sign. `credits_adjustment` has no sign CHECK. The totals CHECK `credits_add_up` holds under a same-delta move of `credits_total` and `credits_adjustment` |
| V-4: ledger empty | ✅ **Re-counted at 15:59 UTC: 0 charges, 0 totals, 0 fallback, 0 adjustments. This is expected, not suspicious.** There have been **0** Business OS `token_usage` rows since the 3b-ii merge at 15:38:10 UTC. The last one was `business-os-briefing` at 13:19:49 UTC. No Business OS AI has run since the merge, so the empty ledger proves nothing either way. The first real evidence will be the `insight-detect` run at 03:30 UTC on 2026-09-30, plus any hourly briefing (see N-2) |
| V-6: `token_usage.cost_usd` keeps micro-dollars | ✅ Consistent (planner rows such as `0.000901`, embedding rows at `0.000000`). The declared scale is not visible through PostgREST, so S-2 removes the dependence on it |
| V-7 / Q-14: the `token_usage` insert is awaited before a call returns | ✅ `baseProvider.ts`: `notifyUsage(…)` → `await this.analytics.trackAICall(…)` → `return result`. `trackAICall` awaits the insert and swallows a failure at `error` (`aiAnalytics.ts:210-226`). **OI-2 answered as Dev states** |
| V-8: `bosRowFilter()`, `listCallsInWindow` (ceiling ≤ 5,000, `reachedCeiling`) | ✅ Note: the window end is **inclusive** (`.lte('created_at', end)`), not half-open (N-3) |
| V-15: admin gate | ✅ `requireAdmin(logger)` returns `NextResponse \| { user }`. The authz surface guard needs no allow-list edit for a gated route. It proves the gate is **present**, not that it is **first** (OI-20). SA checks the position at code review |
| **V-16: `CRON_SECRET` is set in production** | ✅ **Confirmed.** `isProvenVercelCronCall` (`cronRunRecorder.ts:84-97`) returns true only in production, on `VERCEL_ENV = production`, with `CRON_SECRET` set **and** a bearer that matches it. `bos_cron_runs` holds **2,277** `vercel_cron` rows. The first is 2026-09-27 13:20:00 UTC (`insight-automations`). The latest is 2026-09-29 15:55:40 UTC (`lead-response`). So the secret has been set on Vercel, and sent by Vercel's scheduler, since about 13:20 UTC on 2026-09-27. The memory note on the payment queue-drain ("blocked on CRON_SECRET") is stale (TL) |
| V-19: the AI admin page's source guard | ✅ As stated |
| V-20: reserved range | ✅ 4c uses `20261016` only |
| Which accounts spend on Business OS | Re-measured over the last 30 days: 9 distinct `user_id`s. 8 are exactly the 8 `business_os_account_plans` rows. The 9th (19 rows) is the platform account (`SYSTEM_ADMIN_USER_ID`). Today no Business OS spend comes from an account without a plan row. The plan-only walk is still structurally blind to such an account (S-1) |
| **V-5 is incomplete** | "0 NULL `session_id`" is true for today's 29 rows only. **Over 30 days, 3,019 of 4,990 Business OS rows have a NULL `session_id`.** 2,830 of those were written between 09-22 and 09-28 01:15 UTC, and the latest are `business-os-chat` `planner` / `verified_question_embedding` rows at 01:14–01:15 UTC. None since then. See N-9 |
| Legacy `onboarding` (Q-9) | The charged onboarding turn writes `business-os-onboarding` (`OnboardingConversationManager.callContext` → `buildBosCallContext`). `OnboardingChatService` writes `onboarding` but **has no callers**. `generate-prompt-ideas` is agent-platform. The shared helper's default label `onboarding` / `simple-complete` lands on the **platform** account, with 149 rows in 30 days |

### Split ruling (Q-1)

✅ **Three parts, 4a → 4b → 4c, as proposed.** Each part is within the user's "few days" rule, each ships alone, and the only PROD apply is isolated in 4c. 3.5 days is the ceiling for 4a. S-5 below takes about half a day out of it. Two parts would make a 5.5-day 4b, and would tie a read-only check to a PROD migration. I agree with Dev on that. Branching is RM's call. One branch per part, each off `main` after the previous part merges, matches the 3a / 3b precedent.

### Q rulings

| # | Ruling |
|---|---|
| **Q-1** | ✅ Three parts (above) |
| **Q-2** | ✅ A "Costs & credits" tab on `/admin/business-os-llm`, with local payload types (the page already does this with `types.ts`). The Layer 2 admin-screen slice 3 (its settings **writer**) is planned for the same page. Whichever lands second rebases the tab strip. **Drop the business-name search** (S-5) |
| **Q-3** | ✅ A new read-only `BusinessOsCreditLedgerReadRepository`. The writer's `ALLOWED` guard stays meaningful. Follow `new-repository`: client injection (so slice 7 can later pass the RLS client; do not build that now), `RepositoryResult`, never throws, `.eq('user_id')` on every account method, all-accounts reached **only** by a method named so, a column allow-list, and a source test for no write verb |
| **Q-4** | ✅ Aggregate in Node with ceilings and an explicit "incomplete" state. This matches `llmUsageReport.ts`. The volume is small: the largest account wrote 3,493 Business OS rows in 30 days, about 116 a day, against a 5,000 per-account ceiling. The trigger for the RPC path (R-3) is right. Cap the on-demand window (N-5) |
| **Q-5** | ✅ Extend inheritance to `action_type`, area and trigger. It is deterministic, because the self-FK targets `UNIQUE (action_id)`. Put it in one pure `effectiveFields.ts` that slice 7's diary will reuse. Watch the totals semantics, though (S-7) |
| **Q-6** | ✅ Detection by **presence**, which is the right answer to V-6. **Tolerance changed** to `calls × 0.000001 + 1e-9` (S-2) |
| **Q-7** | 🔄 **The reporting rule is wrong for reused groups (B-1).** The one-hour slack is fine. The "first call" attribution is not |
| **Q-8** | ✅ Both doors, and no results table. `CRON_SECRET` is set (V-16), so the nightly door will actually run. Durable trace: `bos_cron_runs` counts plus one `error` per leaking account (S-4 adds the period to it). `durable-queue-drain` does not apply: nothing is drained and nothing is written |
| **Q-9** | ✅ `bosRowFilter()` only. **Do not** count the legacy `onboarding` rows per account: on a Business OS account they are agent-platform spend by construction (`OnboardingChatService` is dead code, and `generate-prompt-ideas` belongs to the agent platform). **Instead**, add the helper label `BOS_LEGACY_HELPER_LABEL` (`onboarding` / `simple-complete`) to the **platform-account** informational count, as data passed to the existing count method. That label is the fingerprint of a Business OS call that lost its account context. `BOS_LEGACY_FEATURES.onboarding` stays empty (RC-3) |
| **Q-10** | ✅ The design is right on tenant isolation: no `p_user_id`, and account, period, group and version come from the original, in SQL. It needs **two changes**. **B-2:** the SQL accepts only `fallback_price_reconciled`. **S-8:** the caller passes the **corrected cost**, and SQL derives both deltas. No automatic re-pricing: agreed |
| **Q-11** | ✅ Add `created_by_admin_id`, under the conditions in S-9. A money change made by a person must not depend on the queued, lossy audit trail (V-18) for its actor. The audit entry is still written (NFR Auditability) |
| **Q-12** | ✅ A page action, not a script. Operators should not need SQL (FR-33 "without SQL"). The page gains a writer in Layer 2 slice 3 anyway. Conditions: the source guard's "nothing on this page writes" assertion is changed deliberately and **scoped to the Settings tab**, in the same commit; the Reconcile component calls only the adjustments route; there is a confirm step |
| **Q-13** | 🔄 Linear interpolation (`percentile_cont`-equal), fallback rows excluded, and "few examples" below 10 are all fine. **Change:** compute p50 / p90 over **succeeded** charges only, and show the failed count beside them. A failed action usually stops early and spends less, so including it pulls p90 down. Slice 8 uses p90 as the "would this exhaust the trial?" estimate, where an understated figure is the unsafe direction. Failed spend still counts in every **sum** (FR-8) |
| **Q-14** | ✅ Confirmed (V-7 above). The one blind case, a freeze during a provider call, is correctly stated |
| **Q-15** | ✅ `45 4 * * *`, previous UTC day, `maxDuration = 60`, 45 s walk deadline. One correction: "after the 03:30 insight run" is not a reason, because the 04:45 run checks **yesterday** and today's 03:30 run falls in tomorrow's window. Any time after 01:05 UTC works. Keep 04:45, because it clashes with no hourly `:00`–`:40` job. The registry needs `timeLimitSource: 'maxDuration'`, the daily grace (60 min), and counts with no money key (`bosCronJobs.test.ts`) |

### Findings

**Blocking (for the part named; nothing blocks 4a)**

- **B-1 (4b, §5.2 step 3, Q-7): a lost charge in a reused group that crosses midnight is never reported.** Chat and onboarding share one group id across turns (SA-B1). Example: turn A of conversation G runs at 23:40 on day D−1 and is charged. Turn B runs at 00:20 on day D and its charge is lost.
  - **Day D's run** reads usage from 23:00 on D−1, so G's first call read is 23:40. That is outside `[S, E)`. No charge of G is written in `[S, E)`. So G is not reported.
  - **Day D−1's run** read usage only up to its own end, midnight. It saw turn A, charged and matched.
  - **Result:** B is never reported. That is exactly FR-16's case.
  
  **Fix (Dev chooses the mechanics):** report a group whenever it has **any** usage row or charge in `[S, E)`, and use the slack rows only to match. Accept that a discrepancy sitting across the boundary can be reported on two consecutive nights, and state that in the output. Over-reporting is the safe direction; missing a leak is not. Also make the usage lower bound at least the charge lower bound minus the longest action (`maxDuration` 300 s). Otherwise an action whose calls sit just before the usage edge and whose charge sits just after it produces a phantom "charged above usage". **Tests:** the midnight example above, which must be reported, and the same with B charged, which must not be.
- **B-2 (4c, §6.2 step 4-5, Q-10): the bound "−delta ≤ original" is only a bound on the total while there is one reason code.** The unique index allows one adjustment per `(charge, reason)`. A second reason added later could take the net of a charge below zero, and two concurrent calls with different reasons would race. **Fix:** the function accepts **only** `p_reason_code = 'fallback_price_reconciled'` (refused otherwise, `22023`), together with `original.is_fallback_priced`. A future reason is a new migration that designs the cumulative bound, for example by taking a row lock on the totals row, where `service_role` holds `UPDATE`. The static test pins the one allowed value.

**Should fix**

- **S-1 (4b, §5.3): the account walk is plan rows only.** The charge RPC deliberately charges an account **without** a plan row, in the calendar month (slice 3 Q-3), and such an account would never be checked. Walk **plan accounts ∪ accounts with a totals row overlapping the window** (the read repository's named all-accounts totals read, already planned for 4a). For Business OS spend from an account with neither a plan row nor a charge, state the blind spot in the output. Do **not** add an all-accounts `token_usage` read: the repository's contract test allows exactly one, and this would need SA sign-off. T4b.5 records the re-measurement above (every non-platform account with Business OS usage has a plan row).
- **S-2 (4b, Q-6): make the tolerance independent of the column's scale.** Use `T = calls × 0.000001 + 1e-9`. That covers rounding and truncation alike, costs at most a micro-dollar per call in sensitivity, and removes the "QA confirms the scale" dependency. Presence detection is unchanged.
- **S-3 (4b, R-6): known uncharged paths are not nightly `error`s.** KI-6 (chat v1 / v2 outside the catalog) and anything under `BOS_KNOWN_NON_CATALOG_COMPONENTS` exempt from `missing_group_id` are real but **accepted** uncharged spend. Put them in a separate "known uncharged path" bucket: counted, shown with feature and component, and logged at `warn` once per run. Keep `bos_credit_leak_found` at `error` for everything else. An `error` that fires every night for a known gap teaches operators to ignore the one that matters. (`IntentParser` wrote 0 rows in the last 30 days, so this is cheap insurance, not noise already present.)
- **S-4 (4b, §5.3, AC-31): the leak output and log name the period.** AC-31 requires "the account and period". Add `periodStart` (from the charges, else the plan anchor, else the calendar month, the same rule as the RPC) to the per-account finding and to `bos_credit_leak_found`.
- **S-5 (4a, §4.6): drop the business-name search.** The report already returns every account with its business name, from `findAdminIdentitiesByUserIds`. Filter by choosing from that list, client-side, or re-query with `accountId`. This removes a second behaviour from the report route, a search input, and the dependency on the unmerged audit-trail picker. It also saves about half a day of 4a.
- **S-6 (4a, Q-13):** p50 / p90 over **succeeded** charges only, with the failed count shown (see the Q-13 ruling).
- **S-7 (4a, §4.1-4.2): compare like with like in the totals cross-check.** The totals row keeps adjustments in their **own** bucket (`credits_adjustment`), and `credits_owner` / `scheduled` / `external` exclude them. With Q-5's inheritance, the by-trigger breakdown puts an adjustment under its charge's trigger. So:
  - Cross-check each totals row against the rows' sums **by the totals' own rules**: owner, scheduled and external over charge rows, adjustments separately, total over everything.
  - Label the inherited breakdowns as "net, including corrections".
  - Test that a period with one adjustment passes the cross-check and still shows the correction under its charge's action type and trigger.
- **S-8 (4c, §6.2 / §6.3): SQL derives the deltas from a corrected cost.** The signature becomes `(p_adjusts_action_id uuid, p_reason_code text, p_corrected_cost_usd numeric, p_admin_id uuid)`. SQL requires `0 ≤ p_corrected_cost_usd < original.cost_usd`, then computes `v_cost := round(p_corrected_cost_usd − original.cost_usd, 10)` and `v_credits := round(original.credits × v_cost ÷ original.cost_usd, 6)`. That equals the delta at the original's credit-value version by construction, because `credits = cost ÷ usdPerCredit(v)`. It also:
  - leaves no way to pass an inconsistent credits / cost pair;
  - makes a full reversal net to exactly `−original.credits`;
  - removes `creditAdjustment.ts`'s import of `CREDIT_VALUE_HISTORY`, and with it the `KNOWN_NON_GATE_IMPORTERS` registration (skill `business-os-entitlements`). If Dev keeps a TS computation instead, the registration is mandatory.
  
  The adjustment row carries the original's `credit_value_version`, `group_id` and `user_id`, and a period decided by BQ-1.
- **S-9 (4c, Q-11): conditions on `created_by_admin_id`.**
  - `uuid`, nullable, **no FK**. An admin's auth row may later be deleted, and the id is a historical fact. A `SET NULL` FK would fight the CHECK below. Say so in the column comment and in the deletion-policy reason for the table.
  - A **new** named CHECK: charges carry NULL, adjustments carry NOT NULL. Existing constraints stay untouched. Validating it against live charge rows is instant under the migration's `lock_timeout`.
  - **Not granted** to `authenticated`. The grants are per column, so it is hidden by default. The new checker asserts it.
  - The **20261015 checker's C2** is updated in the same PR, from `total = 29` to 30, with the column added to the hidden list. Until then it FAILs check 21 after 20261016 is applied, and the runbook says so.
  - The rollback drops the column only when no adjustment row exists.

**Notes**

- **N-1 (F-1): `CRON_SECRET` is set** (V-16 above). TL: update the payment queue-drain memory note, and tell the user that the dormant-cron items in the memory index (payment drains, insight crons H4, the sentinel webhook is a different secret) may now be live. That belongs to a separate follow-up, not this slice.
- **N-2 (F-2): go-live is not yet observable.** Business OS AI has not run since the merge. Check once after 03:30 UTC on 2026-09-30, read-only:
  - Business OS `token_usage` rows **after the deploy time** > 0 and charge rows = 0 means **stop**: charging is not live, or is failing, and the `bos_ai_charge_write_failed` logs say which.
  - Both > 0 means go-live is observed. RM records the moment in slice 3 §15.
  
  T4b.5 runs on a full day after that moment, as Dev says.
- **N-3 (4b):** `listCallsInWindow`'s end is inclusive. Either pass `E − 1 ms` or document that a row at exactly `E` falls in both windows. Test the boundary.
- **N-4 (4a/4b): admin routes.** `requireAdmin` is the first statement, with only the request logger created before it. It runs before Zod, before the 409 platform check (pure, as the account-summary route does) and before any read. The route tests assert that the repository mocks are never called on 401 / 403. The cron route is not an admin route and uses the fail-closed bearer check, copied as F-3 says.
- **N-5 (4b):** cap the on-demand window at **7 days**, not 31. The heaviest account is about 116 Business OS rows a day, so 31 days sits close to the 5,000-row ceiling today and past it soon. Seven days keeps the button useful and "incomplete" rare.
- **N-6 (R-10):** importing `aiActionAudit.ts` for `AI_ACTION_DECLARATIONS` is acceptable, since it is server-only and already in the `typecheck:bos-llm` gate. Do not extract a leaf module now. If slice 7 needs one, it extracts it.
- **N-7 (skills):** no LLM call (`bos-llm-call-standards`: gates only). No drain (`durable-queue-drain`: not applicable). `business-os-entitlements`: 4a and 4b import nothing from the module. 4c imports nothing either if S-8 is taken. SA greps the diff at each code review. `business-os-schema-check`: every column the plan names was live-verified (V-4, V-5).
- **N-8 (4b, §5.2):** the pending-reconciliation rule should also list a fallback group that is **under**-charged, where the real price exceeded the fallback. That is the case BQ-4 asks about: show it, and do not hide it as matched.
- **N-9 (for TL, before reading the first nightly results):** 2,830 Business OS chat rows with a NULL `session_id` were written between 2026-09-22 and 2026-09-28 01:15 UTC, and none since. They look like golden-set (`eval:chat`) runs or a since-fixed path. If that source writes again, the leak check will report it as ungrouped spend, which is correct: it is uncharged. Identify the source once, so the first finding is not a surprise.
- **N-10:** R-8's "Read-only" pill scoped to the Settings tab: agreed (Q-12).

### Business questions (as they should go to the user)

None blocks 4a. BQ-2 is needed before 4b. BQ-1 and BQ-4 are needed before 4c. BQ-3 decides when 4c is built.

- **BQ-1 — When we correct an over-charge after the owner's month has reset, which month gets the credits back?** Sometimes a charge is priced from a cautious estimate, and the owner pays a little too much. We can put the correction into **the month it happened**: the books stay exact and the figures we use to set prices stay right, but the owner cannot use the credits any more. Or we can put it into **their current month**: the owner gets usable credits back, but last month's figures stay slightly high. *Recommendation: the month it happened. If we want to make it up to an owner, we give them a grant (a later slice).* Today nobody is refused or billed, so no owner is affected yet.
- **BQ-2 — How do you want to hear about a nightly leak?** Leaks will show on the admin pages (the scheduled-jobs page and the new Costs & credits tab) and in the logs. An email to you each morning would be a new kind of notification. *Recommendation: the admin pages only, for now.* (The nightly job will actually run: the scheduler's secret is set.)
- **BQ-3 — Build the "correct an over-charge" tool now, or when the first one appears?** There are **none** today, and after the pricing fixes only a defect can create one. *Recommendation: build the report and the nightly check now, and build the correction tool when the first over-charge shows up in the report or with slice 5, whichever comes first.*
- **BQ-4 (added by SA) — If we find we under-charged an owner, do we ever charge them more after the fact?** The cautious estimate uses the most expensive price we know for that provider, so this should almost never happen. It could happen with a brand-new, pricier model. *Recommendation: never raise a charge after the fact; we absorb the difference, and the report shows it so we can fix the price list.* (This is what the plan builds: a correction can only lower a charge.)

### Approval

- [x] Workplan approved. **4a proceeds now**, with S-5, S-6 and S-7 folded into §4 at T4a.0.
- [ ] 4b: fold B-1 and S-1 to S-4 (plus N-3 and N-5) into §5, then proceed. No SA re-review needed if they are folded as written. SA checks them at 4b's code review.
- [ ] 4c: fold B-2, S-8 and S-9 into §6, record the user's answers to BQ-1 and BQ-4, then proceed. SA executes the migration in throwaway PGlite at code review (precedent).

### SA code review — 4a (2026-09-29)

**Code Review by SA — 2026-09-29**
**Status:** 🔄 Fix Required. One blocking defect (CR-B1), one small should-fix (CR-S1). Everything else is approved as built. After CR-B1 is fixed and the gates below are re-run green, 4a is ready for the user's diff view. No SA re-review is needed if the fix is made as described; SA checks it with QA's re-run.

**Scope read (static):** the route, its test, the read repository (header, guards, paging, all four methods), `creditReport.ts`, `effectiveFields.ts`, `percentiles.ts`, the N-10 guard, the wire-type pin, `CostsTab.tsx`, `CostsSections.tsx`, `costCopy.ts`, `costFormat.ts`, `page.tsx`, `adminReadMethods.guard.test.ts`, `admin-authz-guard.yml`, and migration `20261015` (column types) plus the `period_anchor` writers in `20261005` / `20261014` / `adminOps.ts`.

**Not re-run by SA.** My one attempt at a read-only PROD query (the precision of `business_os_account_plans.period_anchor`, for CR-B1) was refused by the session's permission classifier. After that it refused every shell command, including local Jest. So SA did **not** re-run the suites, `typecheck:bos-llm`, `check:bos-llm-literals` or the authz guard. The figures in §9.1 T4a.6 are Dev's. **QA's run is the one on record**, and it is owed again after CR-B1. CR-B1 is proved from source, not from live data.

#### Blocking

- **CR-B1 — `creditReport.ts` step 1→2: the newest period's rows are silently dropped whenever its `period_start` carries sub-millisecond digits. That is the normal case for a plan account.** Priority: High.
  - **How.** The rows read is bounded by `rowsRange = { from: min(periodStarts), to: max(periodStarts) }`, built from `Date.parse(t.period_start)`. `Date.parse` truncates to milliseconds. The repository then applies `.lte('period_start', range.to.toISOString())`. `period_start` is `timestamptz`, which is microsecond precision (`20261015` line 12). It is `period_anchor + n months` (`business_os_credit_period_start`), and `period_anchor` is `DEFAULT now()` (`20261005` line 119) or `now()` (the invite function, `20261014` line 113), so it carries microseconds. Only the calendar-month fallback and an anchor that an admin set from JS (`adminOps.ts`, ms precision) are exact.
    - Example: `…T10:11:12.345678Z` becomes the bound `…T10:11:12.345Z`, and the newest period's rows fail `.lte`.
  - **What the operator sees.** For the account whose period is the newest one read, which with an account filter is always the account's **current** period, the check shows **"mismatch"** with rows = 0. Worse, those rows are also missing from the breakdowns, the fallback list and the spreads, with no marker. That is a wrong answer about money, on the period that matters most.
  - **Why the tests pass.** Every fixture `period_start` is a whole second (`2026-09-05T00:00:00+00:00`), and the ledger mocks ignore the range.
  - **Fix (Dev chooses the mechanics).** Read the rows with the same day-granular, half-open window the totals were read with. Use `periodRange`, `[window start − 31 d, window end)`. The builder already keeps only the (account, period) pairs it shows. Also make the repository's upper bound exclusive (`.lt`), taking the exclusive end, instead of `.lte(end − 1 ms)`. That closes the same truncation class on the totals read. Neither the millisecond floor nor `+1 ms` is a fix.
  - **Tests.** A fixture period whose `period_start` has microseconds (`2026-09-05T10:11:12.345678+00:00`) must pass the cross-check, and its rows must appear in the breakdowns. Add a builder-level assertion that the rows read is called with the same range as the totals read, or with a bound not earlier than the raw newest `period_start`. A mock that ignores the range cannot catch this, so assert the argument.

#### Should fix

- **CR-S1 — `creditReport.ts` step 4, the orphan loop: a period with rows but no totals row is always `matches: false`, even when the totals read hit its ceiling.** When `totals_ceiling` is set, the "orphan" is a totals row that was not read, not an invariant break. The tab would show a red "mismatch" and "no totals row for this period" for a healthy period. When `incompleteReasons` includes `totals_ceiling`, give such lines `matches: null` ("not checked") and leave them out of `mismatchedPeriods`. Add one test. Priority: Medium. It cannot trigger today (ceiling 2,000 account-periods), but the report must never show a false mismatch.

#### Notes (no action needed for 4a)

- **CR-N1 (D-5).** Integer-at-scale sums are exact while each sum stays below 2^53 units. For cost at 10^10, that is about **$900,719 per sum**. `Number()` of a numeric string is also exact only up to about 15 significant digits. Both are far from today's volumes. State the bound in the `creditReport.ts` header, so that the RPC path (R-3) takes over before it matters.
- **CR-N2 (UI).** `CostsTab` has no abort or sequence guard, so a slow earlier response can overwrite a later window. After a failed re-read, the old report stays under the red error box. Switching to Settings unmounts the tab, which loses the window and account and re-reads on return. The tabs have `role="tab"` without `aria-controls` or a `tabpanel`. None of these blocks 4a. Fold them in if the tab is touched in 4b.
- **CR-N3.** `effectiveFields.ts` imports `AI_CHARGE_SERVICE` from `aiChargeRecorder.ts`, which pulls the writer repository into the report route's module graph at runtime. It is harmless (no call), and the writer's `ALLOWED` guard is about direct importers. If slice 7 reuses `effectiveFields` from an owner path, move the constant to a leaf module then.
- **CR-N4.** `D-4`'s over-inclusion is correct and stated on the tab. A period that starts exactly 31 days before the window ends at or before the window start, and is shown anyway. That is harmless.

#### Verified

| Check | Result |
|---|---|
| `requireAdmin` first | ✅ Only `correlationId` and `baseLogger` come before it, and the route test pins the exact statements. 401 and 403 happen with no read (every ledger and name mock is asserted uncalled), including a signed-out caller with an invalid query |
| Authz CI guard / register | ✅ A gated route needs no allow-list or cap edit (R1 satisfied). The guard does not read the doc register, so the register cannot turn it red |
| Zod | ✅ `.strict()`, both dates or neither, real calendar dates, `from ≤ to`, span ≤ 92 days (inclusive), `to ≤ today + 1`, `accountId` UUID, repeated keys refused before parsing. 409 platform account is a pure check before any read. The 400 body carries `details` in development only. The 500 is generic |
| Repository | ✅ Read-only. The column allow-lists are exported and tested. No write verb and no `rpc` appear (source test). It never throws (`fail()` → `{ data, error }`). A malformed or missing account id is refused before any query. The all-accounts read is reachable only through `listTotalsForPeriodsInRange`, and `pageTotals(null)` is private. Service role is documented in the header. Paging is ordered, de-duplicated and capped. `findChargesByActionIds` is `kind = 'charge'`, UUID-checked, ≤ 200. The writer's `ALLOWED` list is untouched |
| Effective fields (N-10, Q-5) | ✅ In one pure resolver. An adjustment inherits service, action type, trigger and area from its charge. A missing original, one that is not a charge, or one on **another account** is unresolved (D-2), and it is counted and shown. The area is keyed on (effective service, action type) (N-11). The N-10 source guard covers four rules, each proved on planted samples, and scans the credits module plus the read repository |
| Percentiles (S-6) | ✅ `percentile_cont`-equal linear interpolation over **succeeded, non-fallback** charges. Failed and fallback-excluded counts are shown beside. `fewExamples` is below 10, including 0 |
| Totals cross-check (S-7) | ✅ Owner, scheduled and external are summed over charge rows by their **own** `triggered_by`. The adjustment is summed over adjustment rows. Total and cost are over all rows. Counts are over charge rows. It is an equality on integers at the column scale (D-5). Breakdowns are labelled "net, including corrections", with a note that the trigger lines are not the stored split |
| Incomplete | ✅ Totals, rows and originals ceilings → `incomplete` and reasons, and the cross-check becomes "not checked". A failed read fails its own section, and names failing is display-only |
| Owner-facing surface | ✅ None. The report builder is reached only from the admin route. The repository has an importer guard. The page sits behind the layout's `requireAdminPage` |
| Logs | ✅ One `info` line with admin id, window, account id, counts, `incomplete` and section states. There is no business name (tested) and no money. Repository and builder logs carry method, counts and `err` only |
| Page source guard | ✅ Unchanged. The tab imports only local modules (`costTypes`, `costCopy`, `costFormat`, `format`). The only network call is one `GET`. The sidebar and `nav.test.ts` description changes are consistent |
| Entitlements (skill) | ✅ No file in the diff imports `lib/business-os/entitlements/**`, type-only included |
| `console.*` | ✅ 0 in every new or modified app/lib file. `scripts/typecheck-bos-llm.ts` (10, CLI output by design, outside `lib/`, `app/` and `components/`) is flagged correctly by Dev. It needs no conversion |
| Pre-existing reds | ✅ (static) Neither `lib/business-os/usage/**` nor `app/api/admin/business-os/entitlements/**` is in the diff (`git status`), and neither test imports a new file. That matches the known main reds from #129/#130. SA did **not** run them on `origin/main` (see "Not re-run" above). QA confirms |

#### Rulings on D-1 to D-9

| # | Ruling |
|---|---|
| D-1 | ✅ Correct. `adminReadMethods.guard` allows `findAdminIdentitiesByUserIds` only from `app/api/admin/**`. Injecting it with **no default** keeps the builder from ever reaching it another way. That identity read also chunks its `.in()`, so a long account list is safe |
| D-2 | ✅ Correct, and it is the tenant-isolation reading I would require. A lookup by id is not an ownership proof |
| D-3 | ✅ Accepted. It is the script's documented extension point, the only way the wire pin is type-checked, and the mutation test proves it bites. The scope grew by 11 files with 0 new errors |
| D-4 | ✅ Accepted as a rule. **But** CR-B1: the rows must be read with this same day-granular window, not with a range rebuilt from the periods read |
| D-5 | ✅ Accepted, with CR-N1's documented bound |
| D-6 | ✅ Accepted (`rowsRead`, `unreadableAmounts`). Both are never-silent counters |
| D-7 | ✅ Accepted. The copy module and a precision-aware USD formatter are what §4.6 asked for |
| D-8 | ✅ Accepted. The "Read-only" pill stays, and the Settings-only controls are hidden on the Costs tab |
| D-9 | ✅ **A separate item, not this PR.** The three unregistered invite handlers were introduced on `main` by the invite slices, not by 4a. The CI guard does not read the register, so nothing is red. Row 85 is correct for this route. This PR must **not** claim a re-derived census. TL raises a small docs follow-up to register the invite routes and re-derive the as-built figures. The invite session is the natural owner |

### Code Approved for QA: Yes, with CR-B1 fixed first

QA can test in parallel on everything except the rows-read range. After the fix, the re-run must cover: the new suites, `app/admin/business-os-llm`, `lib/repositories`, `npm run test:authz-guard`, `npm run typecheck:bos-llm`, `npm run check:bos-llm-literals`, plus the microsecond test. **It is ready for the user's diff view once CR-B1 (and ideally CR-S1) is in and those runs are green.**

### SA code review — 4b (2026-09-30)

**Reviewed by SA — 2026-09-30.** Worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-4b` (uncommitted, on top of 4a's `e5dd8dff`). Diff read against `feature/business-os-credit-deduction-slice-4` plus the 14 new files. Review only: no code changed, nothing committed, no database touched (Jest ran with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys). No PROD read was needed; the period rule was checked against the migration source.

**Status: ✅ Code Approved, with one should-fix (CR4b-S1) that the Dev can fold in before the user's diff view.** Nothing blocks.

#### Blocking

None.

#### Should fix

| # | Where | Finding | Fix |
|---|---|---|---|
| CR4b-S1 | `creditLeakCheck.ts` `checkAccount` (usage window) together with `runCreditLeakCheck` (the settle clamp, D-13) | The clamp pulls the **window end** back to *now − 6 min*, but the **usage read** still runs to `E + 1 h − 1 ms`, which can reach past *now − 6 min*. A **reused** group (chat or onboarding) that has any activity in the window is examined, and its slack is then summed with it. If one of its actions is still running, its calls are already in `token_usage` but its charge is not yet written. That shows up as a **phantom under-charge**, logged at `error` as `bos_credit_leak_found`. This happens on demand in two cases: (a) `to` = today, or (b) the default "yesterday" run less than about 1 h after midnight UTC. (b) is the case the user is most likely to hit on the T4b.5 first run after go-live. The nightly run is not affected: at 04:45 its reads end at 01:05. | Cap the usage read's end at `min(E + 1 h − 1 ms, now − SETTLE_MS)`. Leave the charge read as it is: reading charges up to `E + 1 h + 300 s` (or now) is harmless. Any call that is read then started before *now − 6 min*. Actions are ≤ 300 s, so its charge exists unless it really was lost. Add one runner test: a reused group with a charged turn before the clamp and an uncharged turn at *now − 2 min*, expected **not** reported; it should fail on the current code. Add one sentence to D-13 |

#### Notes (no action needed for 4b)

- **CR4b-N1: the upper-edge mirror of the lower-edge residue.** Take an action whose calls start in the 300 s after `E + 1 h`. They are not read, but its charge is (the charge read runs 300 s longer). In a reused group this is a phantom "charged above usage", which is informational. In theory it could offset a real lost charge in the same group. That needs the same group to be active both in the window and exactly 60–65 min after it. It is the same class as `edge_of_window`. If the Dev touches `LEAK_BLIND_SPOT_TEXT.edge_of_window` for CR4b-S1, it can say "either edge". Otherwise leave it.
- **CR4b-N2: an empty window reads as "clean".** If the clamp makes `endMs == startMs` (for example `from = to = today` at 00:03 UTC), no group is examined and the panel shows the green "No uncharged AI spend found" next to the end-clamped note. It is not wrong, but "nothing to check yet" would be clearer. Cosmetic; can wait for 4c.
- **CR4b-N3: `unreadableAmounts` does not change the status.** An unreadable ledger `cost_usd` is summed as 0. That could give a phantom under-charge, or hide a real one, while the account still says "leak" or "clean". `cost_usd` is `numeric(16,10)` and PostgREST returns a number, so it cannot happen in practice. The count is surfaced, as in 4a. Acceptable.
- **CR4b-N4: the plan listing sits outside the 45 s deadline.** Up to 200 pages × 500 are read before the deadline starts to count. That is far beyond today's handful of accounts, and a failed or exhausted listing sets `listingFailed`, so the risk is theoretical.
- **CR4b-N5: `origin/main` has moved on** to `b6efd992` (#151) since 4a merged `c1ff4d42`. `vercel.json` differs from `origin/main` by the one added cron only, so no conflict is expected there. RM should re-merge `origin/main` before the PR and re-run the owed set.

#### Verified

| Item | Result |
|---|---|
| **B-1** | A group is examined when **any** usage row **or** any ledger row falls in `[S, E)` (`classifyLeakGroups`, the `examined` test); the slack only matches. The usage read starts at `S − 1 h − 300 s`, and the charge read at `S − 1 h`, 300 s later ✅. The upper edge mirrors it (D-12) ✅. The 23:40 / 00:20 midnight example is tested both ways (`creditLeakCheck.test.ts:230`), and Dev's revert mutation shows the test biting ✅ |
| **S-1** | Accounts walked = plan rows (`pagePlans`, keyset, 500 per page) ∪ accounts with a totals row whose period starts in `[S − 31 d, E)`, minus `isPlatformAccount`, sorted by id ✅. `token_usage` is reached **only** through the existing per-account `listCallsInWindow` and `countInWindow` on the platform ids. There is **no** new `token_usage` method and no all-accounts `token_usage` read (`creditLeakCheckDeps.ts`) ✅ |
| **S-2** | `leakTolerance(calls) = calls × 0.000001 + 1e-9`. Matched is `|diff| ≤ T`; the edge tests are at exactly `T` and `T + 1e-9` ✅. Uncharged is detected by presence (tokens **or** cost), so a $0 embedding still counts ✅ |
| **S-3** | Known path = a `BOS_KNOWN_NON_CATALOG_COMPONENTS` entry exempt from `missing_group_id` (today only `IntentParser`, which records no group id). It is its own bucket, with one `warn` `bos_credit_leak_known_path` per run and never `error` ✅. Ungrouped calls with spend are counted separately and are a leak ✅ |
| **S-4** | `periodStart` and `periodStarts` are in the result and in the `error` log ✅. A charged group takes the charge's stored `period_start` verbatim ✅. For an uncharged group, `creditPeriodStartAt` matches `business_os_credit_period_start` in `20261015` line for line: the month difference in UTC, `anchor + n months` with the day clamped to the end of the month (Postgres interval semantics), and one month back if the candidate is later than `at`. A NULL anchor (no plan row, or a plan row with a NULL anchor) falls to the UTC calendar month, as the RPC's `calendar_month` branch does ✅. Microseconds: the anchor is truncated to ms, which is a label only, and a charged group never uses it (D-20) ✅ |
| Matching | Matching is on `(user_id, group_id)` ↔ `(user_id, session_id)`. Both reads are scoped to the account, and the classifier also drops ledger rows of any other account ✅. The shared insight run id across two accounts is tested (V-10) ✅ |
| Fallback | If a group has a fallback-priced charge and `|diff| > T`, it is `pending_reconciliation` with a direction, and it is **not** a leak ✅ |
| Effective service (N-10) | Every ledger row goes through `resolveEffectiveFields`. An adjustment inherits its charge's service and group (via `adjusts_action_id`). An unresolved one is counted and never compared ✅ |
| Never "clean" | A failed or thrown read gives `could_not_check`. A ceiling on either read gives `incomplete`, which is never a leak and never clean, with a `warn` (D-15) ✅. The panel's verdict is amber whenever something is incomplete, not checked, remaining, or `listingFailed` ✅ |
| Deadline | `RUN_DEADLINE_MS = 45_000` on both doors. It stops **starting** accounts and returns `accountsRemaining`. `maxDuration = 60` on both routes ✅ |
| On-demand route | `requireAdmin(baseLogger)` is the first statement after the logger. Zod is `.strict()`, a repeated key gets 400, it rejects impossible dates, `from > to`, and more than 7 days (inclusive count), and allows `to` up to today + 1 (east-of-UTC tolerance). The clamp covers the rest (see CR4b-S1). A platform account gets 409 with no read. The error body is generic, with `details` only in development ✅. Business names come from `findAdminIdentitiesByUserIds` for display (D-17). They are never logged: the route's `info` has ids and counts only ✅ |
| Cron route | Fail-closed: in production without `CRON_SECRET` it returns 401 and logs `error`; a wrong or missing bearer gets 401. The check is copied from `payment-reminders` ✅. `withCronRunRecord('credit-leak-check', …)` ✅. The body carries counts and window strings only, **no money**. `listingFailed` is a boolean that the recorder stores as 0 / 1 (`cronRunRecorder.ts:108`) ✅. It is not a queue drain: nothing is claimed or written, so `durable-queue-drain` does not apply ✅ |
| Logs | `bos_credit_leak_found` (`error`) carries `trigger`, `accountId`, the periods, the window, three counts, `unchargedCostUsd` and at most 20 group ids. It has no owner text and no business name ✅. There is a `warn` for each account that was not fully checked, and one `info` summary ✅. No `console.*` in any new or touched file ✅ |
| Repository | `listRowsForAccountCreatedInRange`: `assertAccount`, `.eq('user_id', userId)`, a half-open `.gte` / `.lt` on `created_at`, newest first with an `id` tie-break, paged, de-duplicated, and capped by a ceiling. It reads only. The service-role header states the new caller ✅ |
| Guards | The wiring file is declared on the RC-15 plan-referrer guard, **and** in `NO_STATE_WRITE_REFERRERS` ✅. The diff has no import from `lib/business-os/entitlements/**` (checked), so the entitlements review checklist does not apply ✅. There is no LLM call, so `bos-llm-call-standards` does not apply beyond the logging rule ✅ |
| `vercel.json` | One entry added, `/api/cron/credit-leak-check` at `45 4 * * *`. **Nothing else changed**, against the 4a branch or against `origin/main`. That makes 13 crons, all daily or hourly schedules, within Vercel Pro limits ✅ |
| Pre-existing red | `runRecord.adoption.test.ts › payment-reminders` is confirmed red on `origin/main` `b6efd992` by source. The route calls `paymentReminderService.billDueDatedStages()` (line 114), and the test's `PaymentReminderService` mock defines only `processOverdueItems` and `processDueReminders`. It is not caused by 4b. `credit-leak-check`'s own three adoption cases pass |

#### Gates re-run by SA (2026-09-30)

| Gate | Result |
|---|---|
| `npx jest lib/business-os/credits lib/repositories app/admin/business-os-llm app/api/admin/business-os/credits app/api/cron lib/cron` | **75 suites / 1,542 tests: 1,541 pass, 1 fail.** The one failure is the pre-existing `payment-reminders` adoption red above |
| `npm run test:authz-guard` | **1 / 119 pass** |
| `npm run typecheck:bos-llm` | **328 files, 28 errors, 0 new, passed** (the same "baseline entry is fixed" note for `app/api/onboarding/build/route.ts`) |
| `npm run check:bos-llm-literals` | **53 files, 2 exempt, 0 violations, passed** |

#### Rulings on D-10 to D-21

| # | Ruling |
|---|---|
| D-10 | ✅ Accepted. The name is accurate: it returns charges **and** adjustments over a half-open `created_at` range |
| D-11 | ✅ Accepted. It is the right shape: the runner stays pure, the one wiring file is declared on both guards, and its read-only status is pinned by `NO_STATE_WRITE_REFERRERS` |
| D-12 | ✅ Accepted. The 300 s at the top mirrors the B-1 rule at the bottom. The residue it leaves is CR4b-N1 |
| D-13 | ✅ Accepted, **extended by CR4b-S1**. Clamping the window end is right, but it is not enough on its own: the usage read's upper slack must be capped at the same instant |
| D-14 | ✅ Accepted. A leak is a finding, not a job fault (the Q-U2 precedent). "Partly done" means "could not look everywhere". The count is on the jobs page and the `error` log is the alert (BQ-2) |
| D-15 | ✅ Accepted. It is the right conservative call: a cut read can make up a leak as easily as hide one |
| D-16 | ✅ Accepted. The under-direction is shown and never hidden as matched (N-8); the blind spot `fallback_masks_undercharge` states the cost |
| D-17 | ✅ Accepted. It follows the 4a D-1 rule, and names are for display only |
| D-18 | ✅ Accepted. Editing the "12 jobs" pins on purpose is the intended friction. The `evaluateHealth.ts` comment now says "every registered job", so it will not drift again |
| D-19 | ✅ Accepted |
| D-20 | ✅ Accepted. The rule was verified line for line against `20261015` (see S-4 above), and the precision loss affects a label only |
| D-21 | ✅ Accepted. One function logs the same way through both doors, and the `trigger` field (`on_demand` / `nightly`) lets any alert rule tell them apart. A repeated line for a repeated button press is acceptable for an admin-only tool |

### Code Approved for QA: Yes

It can go to the user's diff view once QA passes. CR4b-S1 is a two-line change plus one test. The Dev should fold it in first, and QA's run then covers it. If the user prefers to ship as is, CR4b-S1 must be fixed before the T4b.5 production run, **or** that run must be made after 01:10 UTC with `to` before today. The notes need no action. Before the PR, RM re-merges `origin/main` (CR4b-N5).

### SA hand-off check — 4b fixes (2026-09-30)

**Status: ✅ Code Approved for the user's diff view.** One RM rule (below) and one optional registry test. Nothing blocks.

| Item | Verdict |
|---|---|
| CR4b-S1 | ✅ `checkAccount`'s usage read ends at `Math.min(window.endMs + SLACK_MS - 1, settleEndMs)`, with `settleEndMs = now − SETTLE_MS` computed once in the runner. The ledger range is unchanged (`E + SLACK + LONGEST_ACTION`). The red-first test is the case asked for (reused group, charged 04:00, uncharged at now − 2 min, `to` = today). D-13 extended. Closed |
| QA4b-B1 approach | ✅ Right place, right size. The fault is generic: F-6's baseline is global, so *any* job added after recording began reads "Stopped" on arrival. The fix therefore belongs in the shared status rule, not in a special case for this job. It is opt-in: `jobBaseline` returns the global baseline unchanged for an undated job, so the 12 existing jobs and every other rule are untouched. It is pure and needs no migration. A registry date is the lightest per-job baseline available; a per-job `installed_at` in the DB would be a migration for the same result. Once the job has a run, `last_cron_started_at` wins and `addedOn` is inert. A measured-from instant in the future only yields a negative `sinceMinutes`, which is never displayed and falls through to `no_run_yet`. The two edits in `qa-slice5-pr2.status.test.ts` keep the generic rule pinned (by stripping `addedOn`) and are the deliberate D-18 kind. Accepted |
| D-22 (end of day) | ✅ Accepted. Timing from 00:00 would give a false "Late" at 01:00 the next day, before the first 04:45 run. End of day costs at most one extra day of detection on a job's very first run |
| Deploy-date risk | **A past date is not harmless.** With `addedOn: '2026-09-30'` the job is late after 10-02 01:00 and stopped after 10-03 01:00. Deployed on 10-01, it reads a false **Late** from 10-02 01:00 until its 04:45 run. Deployed on 10-02 after 01:00, it is Late at once and a false **Stopped / red tile** from 10-03 01:00 to 04:45. A date *later* than the deploy is safe: it only delays "Late" for a job that truly never runs, by the gap. So the date must be the deploy day and, when in doubt, the later day. See the RM rule |
| Registry test (optional) | Recommended, not blocking: pin the set of jobs **without** `addedOn` to the 12 original ids, and check that any `addedOn` matches `YYYY-MM-DD`. Then a 14th job without a date fails CI, which is where this lesson should live. Can go in this PR or in the next job's PR |
| QA4b-E1 | ✅ `LEAK_ROW_NOTE` lists only non-zero counts, pluralised, beside the status; the test fails with the note off. Closed |
| CR4b-N2 / QA4b-E2 | ✅ Neutral amber-edged "Nothing to check yet — the window has not ended", never green; order leak → empty → partial → clean. An empty window ranks above "partial", so a listing failure in an empty window reads "Nothing to check yet"; that is correct, since nothing needed reading. Closed |

**RM rule for `addedOn`:** before merging, set `credit-leak-check`'s `addedOn` to the **UTC date on which the production deploy lands** (the merge day; if the merge is near 00:00 UTC or the deploy may slip, use the **later** day). Never leave a date earlier than the deploy day. State the value in the PR description. If the PR merges and deploys on 2026-09-30 UTC, the current value stands.

**SA gates** (Jest with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` + stub keys): `npx jest lib/admin/jobs lib/cron lib/business-os/credits app/admin/business-os-llm app/api/admin/jobs-queues` → 25 / 25 suites, 686 / 686 tests. `npm run typecheck:bos-llm` → passed, 0 new (28 baseline; 1 baseline entry now fixed, `app/api/onboarding/build/route.ts`, not from this slice). Review only; nothing changed except this section and its history row; nothing committed.

---

## QA Testing Report

### QA report — 4a (2026-09-29)

**Test mode:** full
**Strategy used:** A (unit: builder, percentiles, formatter) + B (route with mocked auth and repositories) + static source checks + `next build`. No real database: every Jest run used `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys. The worktree has no `.env*`. No dev server was started.
**Focus:** api, ui, schema, security
**Skipped:** Option D (manual browser check). It needs an admin session on a server with real credentials, which this run was told not to use. The tab is covered by render tests instead. The user's diff view should include one look at the tab.
**Input source:** TL prompt (items 1–5)

**Verdict: ❌ Not ready to commit — the SA CR-B1 blocker is reproduced.** Everything else passes. QA found no new High or Medium bug. Three Low items and four edge cases are listed below. Re-run owed after the CR-B1 fix (list at the end).

#### 1. Gates

| Gate | Result |
|---|---|
| New + directly affected suites (read repository test, `lib/business-os/credits/__tests__`, the report route test, `app/admin/business-os-llm/__tests__`) | ✅ **14 suites / 355 tests pass** |
| Wider set: `lib/repositories`, `lib/business-os/llm`, `app/admin/business-os-llm`, `app/admin/components`, `lib/admin/__tests__`, `lib/business-os/credits`, `app/api/admin/business-os` | 98 suites / 1,973 tests. **1 failure, and it is the known pre-existing one** (`entitlements/__tests__/routes.test.ts`) |
| `lib/business-os/usage` | 6 suites / 138 tests. **1 failure, the known pre-existing one** (`tokenUsageRepository.contract.test.ts`) |
| `npm run test:authz-guard` | ✅ 1 / 119 pass |
| `npm run typecheck:bos-llm` | ✅ 318 files, 28 errors, **0 new**, passed. It also reports one baseline entry now fixed (`app/api/onboarding/build/route.ts` TS18047), which is not in this diff |
| `npm run check:bos-llm-literals` | ✅ 51 files, 0 violations |
| `npm run test:bos-entitlements` | ✅ 89 / 1,854 pass. No file in the diff imports `lib/business-os/entitlements/**` |
| `next build` (`NODE_OPTIONS=--max-old-space-size=6144`, the CI placeholder env from `build.yml`) | ✅ **exit 0**. `ƒ /admin/business-os-llm` (9.65 kB) and `ƒ /api/admin/business-os/credits/report` were built. The `DYNAMIC_SERVER_USAGE` log from `requireAdminPage` appears 6× for **every** admin page, so it is pre-existing build noise |
| **Pre-existing reds on `origin/main`** | ✅ **Confirmed.** In a temporary detached worktree at `origin/main` `bd763222` (node_modules junction removed first, then the worktree), both fail with the same test names: `TokenUsageRepository account contract › pins every public method and its arity…` and `GET /accounts/[accountId] … › still matches the body the admin screen is tested against — account on a tier`. Neither is caused by this diff |

#### 2. Route (temporary test, 17 cases, deleted)

| Case | Result |
|---|---|
| 401 signed out, **with an invalid query too**; 403 non-admin | ✅ No ledger method and no name lookup is called |
| 400: `from` only, `to` only, `from > to`, 93 days, `to` = today + 2, unknown key, repeated `to`, non-UUID `accountId`, impossible date `2026-02-30`, wrong format `2026-9-1` | ✅ All 10 return 400 with `{ success: false, error: <string> }` and do no read |
| Boundaries | ✅ 92 days inclusive is accepted, and `to` = tomorrow is tolerated (the documented +1 day) |
| 409 platform account | ✅ For the all-zero UUID, and for `SYSTEM_ADMIN_USER_ID` given in **upper case**. No read |
| 200 with a faked repository | ✅ With `accountId` set, only `listTotalsForAccountInRange` is used, never the all-accounts read. The default window is today − 29 … today |
| Logs | ✅ **Exactly one `info`** line: `window`, `accountId`, `periods`, `rowsRead`, `incomplete`, `incompleteReasons`, `sections`. The business name (`Secret Bakery Ltd`) and the amount (`0.0123456789`) appear in **no** log line at any level |
| 500 | ✅ `{ success: false, error: 'Internal server error' }`, and no `details` outside development |

#### 3. Report correctness — hand-computed fixture (temporary test, 15 cases, deleted)

**Fixture.** Two accounts. Account A has periods 2026-08-05 and 2026-09-05; account B has 2026-09-01. The window is 2026-09-01…09-28.
- Charges cover owner, scheduled and external. One charge failed (`insight_run`), and one charge was fallback-priced.
- A second-account charge is on service `sms_fixture` at $0.00000021.
- Correction `adj1` (−0.5 credits) corrects a July **fallback** `website_full_site` charge. That charge sits outside every period read, so it is fetched by id.
- Correction `adj2` (−0.1 credits) points at **B's** charge, so it stays unresolved.

The expected figures were computed by hand before running. One expectation of mine was wrong: I left B out of the `ai` cost. The correct value, 0.02075, is what the code returned.

| Check | Result |
|---|---|
| Ranges asked of the repository | ✅ Totals: `2026-08-01T00:00Z … 2026-09-28T23:59:59.999Z`. Rows: both accounts. `findChargesByActionIds` is called once, with the one missing original |
| Per-period stored figures and cross-check | ✅ A/09-05 = 14.9 total (owner 12, scheduled 0.5, external 3, corrections −0.6), $0.0149, 4 charges, 1 fallback, **matches its rows**. That is S-7: a period holding two corrections passes. The other two periods also match. Grand total 20.650001 credits, $0.02065021, 8 charges |
| Deliberate mismatch | ✅ B's totals changed to 4.000002 → that period is `matches: false` with stored 4.000002 and rows 4.000001, `mismatchedPeriods = 1`, and the other two still match. A `charge_count`-only mismatch is also caught |
| Breakdowns, net including corrections | ✅ **Every** dimension sums exactly to the grand total, in credits and in cost. `chat_turn` 20.5 (5 charges), `insight_run` 0.75 (1 failed), `website_full_site` −0.5 (1 correction, inherited from the other-period original), `sms_send` 0.000001, unresolved −0.1. By area: `chat` / `insights` / `website`, and not declared for `sms_fixture`. By service: `ai` 20.75 / $0.02075, `sms_fixture` 0.000001 / $0.00000021. By trigger: owner 17 (includes the inherited correction), scheduled 0.75, external 3.000001. `unresolvedCorrections` = 1 / −0.1 / −$0.0001 |
| Fallback list and count | ✅ Count 1 (the July fallback charge is not in a shown period, so it is not counted), reconciled 0. The item carries account, name, action type, group id, action id, credits and cost |
| Spreads (S-6) and `percentile_cont` | ✅ `chat_turn`: 4 succeeded examples (the fallback one is excluded, `fallbackExcluded = 1`), p50 2.5 / p90 3.7 credits and $0.0025 / $0.0037. Postgres `percentile_cont` over [1.5, 2, 3, 4] gives the same values. `insight_run`: 1 example with `failed = 1` beside it. Reference values are equal to Postgres: [1..10] → p50 5.5, p90 9.1; [1,2] p90 → 1.9; one value → itself; none → null. `fewExamples` is true at 9 and false at 10 |
| Incomplete | ✅ Rows at ceiling → `incomplete`, `['rows_ceiling']`, every check "not checked". Totals at ceiling → `totals_ceiling` |
| One section failing | ✅ If the rows read is **rejected**, `sections.rows = failed`, the stored totals are still shown ("not checked"), and `breakdowns` / `rowsRead` are null. If names fail, the report continues with `companyName` null. If the originals read fails, `sections.originals = failed` and both corrections go to unresolved, while the periods still match. If the totals read fails, the totals section is failed and nothing else is read. An empty ledger gives an empty report with totals `ok` |
| **CR-B1 reproduced** | ❌ A separate temporary test uses a mock that compares `period_start` at **microsecond** precision, as Postgres does, with `period_start = 2026-09-05T10:11:12.345678+00:00`. The rows read was called with `to = 2026-09-05T10:11:12.345Z`. Result: `rowsRead = 0`, `matches = false`, rows total 0, `mismatchedPeriods = 1`. That is a false "mismatch" on a healthy current period, with its rows missing from every breakdown. This confirms SA's CR-B1 from behaviour, not only from source |

#### 4. UI render (temporary test, 11 cases, deleted; Dev's `costsTab.render.test.tsx` (20) also green)

| State | Result |
|---|---|
| Loading | ✅ `costs-loading` shows until the response, then disappears |
| Error | ✅ The route's message is shown as-is (`from must not be after to`) |
| Empty | ✅ "No charges recorded in this window", with no sections rendered |
| Incomplete | ✅ Amber banner naming the reason ("too many ledger rows") |
| Per-section failure | ✅ When rows fail: periods still render, and breakdowns, fallback and spread each say "could not be read" |
| Data | ✅ Period row shows `$0.00000021` and "matches its rows" |
| Settings tab | ✅ Settings is the default (`aria-selected`), and the cost report is not mounted or fetched until chosen. `page.tsx` diff: the Settings content is unchanged apart from the `onSettings` gating and `hidden` on its refresh and standing note (D-8) |
| `formatUsd` | ✅ `0.00000021` → `$0.00000021`, `0.0012` → `$0.0012`, `1.5` → `$1.50`, `0.001` → `$0.001`, `0.1` → `$0.10`, `-0.0005` → `-$0.0005`, `1234.5` → `$1,234.50`, `1e-10` → `$0.0000000001`, `0` → `$0`, null → `—` |

#### 5. Read-only proof

| Check | Result |
|---|---|
| Write verbs (`.insert(`, `.update(`, `.upsert(`, `.delete(`, `.rpc(`), `AuditTrailService`, exported `POST` / `PUT` / `PATCH` / `DELETE`, non-GET `fetch` in the new repository, `lib/business-os/credits/*.ts`, the route, the costs components and `cost*.ts` | ✅ **None** |
| Network calls from the tab | ✅ One `fetch` (`CostsTab.tsx:64`), a `GET` to the report route |
| Importers of `BusinessOsCreditLedgerReadRepository` / its singleton outside tests | ✅ Only `lib/business-os/credits/creditReport.ts` and the barrel `lib/repositories/index.ts` |
| `@/lib/` imports in the page folder | ✅ None new. The only one is the pre-existing `LedgerCheckPanel.tsx`, and the source guard is green |
| `console.*` in new files | ✅ 0 |

### Issues Found

#### Bugs (must fix before commit)
1. **CR-B1 (SA) — reproduced by QA.** The newest period's rows are dropped when `period_start` has sub-millisecond digits. File: `lib/business-os/credits/creditReport.ts` (the `rowsRange` built from `Date.parse`) with `.lte` in `lib/repositories/BusinessOsCreditLedgerReadRepository.ts`. Severity: **High**.
   - Steps to reproduce: a totals row and a charge row with `period_start = 2026-09-05T10:11:12.345678+00:00`, read through a ledger that compares at microsecond precision.
   - Expected: the check shows "matches its rows" and there is 1 row.
   - Actual: `rowsRead = 0`, "mismatch", and the period's rows are missing from the breakdowns, fallback list and spreads.
   - Fix as SA describes. The re-run must include SA's microsecond fixture test and assert the rows-read range argument.

#### Low (should fix; not blocking on their own)
2. **`unreadableAmounts` is not "never-silent" (D-6).** Severity: Low.
   - Where: `app/admin/business-os-llm/components/costs/*`, `app/api/admin/business-os/credits/report/route.ts`.
   - The count is in the JSON payload only. The tab does not render it (a probe with `unreadableAmounts: 3` found no text), and the route's `info` log leaves it out.
   - An unreadable amount is counted as 0, so it usually surfaces indirectly as a mismatch, but the stated counter itself is invisible.
   - Fix: add it to the `info` log line, and show a one-line notice when > 0.
3. **A failed originals read is shown as a data problem.** Severity: Low. File: `CostsSections.tsx`.
   - When `findChargesByActionIds` fails (`sections.originals = 'failed'`), its corrections go to the unresolved line with the text "could not be matched to the charge…". That reads as a ledger break.
   - No component reads `sections.originals`.
   - Fix: when it is `failed`, show `SECTION_FAILED` (or "originals could not be read") beside the unresolved line.
4. **A cross-account unresolved correction still sets the other account's `reconciled` flag.** Severity: Low. File: `creditReport.ts` (`reconciledIds`).
   - A probe showed it: A's `fallback_price_reconciled` correction pointed at B's fallback charge. It was correctly **unresolved** under D-2, yet B's charge was listed as `reconciled: true`.
   - This is inconsistent with D-2's "never attribute across accounts".
   - It cannot happen while 4c takes the account from the original in SQL, and 4c is not built.
   - Fix: add to `reconciledIds` only for resolved corrections, or when `row.user_id === original.user_id`.

#### Edge Cases (nice to fix)
5. **After a failed refresh, the previous report stays under the red error box** with no "stale" marker. QA reproduced this. It is the same finding as SA CR-N2.
6. **Interpolated percentiles below display precision print as zero.** `formatUsd(4e-11)` → `$0.00`, and `formatCredits(1e-7)` → `0`. Stored amounts cannot go below 1e-10 USD / 1e-6 credits, but interpolated p50 / p90 can. Cosmetic.
7. **A synchronous throw from `findNames` fails the whole request with a 500**, instead of marking only the names section failed. The throw happens while the array passed to `Promise.allSettled` is being built. The real `findAdminIdentitiesByUserIds` is async and never throws, so this is not reachable today.
8. **Totals ceiling: exactly `ceiling` rows reads as "incomplete".** The repositories set `reachedCeiling` on `>= ceiling`. This is conservative (a false "incomplete", never a false "complete"), so it is noted only. It adds to SA CR-S1.

### Test Outputs / Logs

```text
new + affected:   Test Suites: 14 passed, 14 total   Tests: 355 passed, 355 total
wider set:        Test Suites: 1 failed, 97 passed, 98 total   Tests: 1 failed, 1972 passed, 1973 total
                  FAIL app/api/admin/business-os/entitlements/__tests__/routes.test.ts   (pre-existing, also red on origin/main bd763222)
usage:            FAIL lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts (pre-existing, also red on origin/main bd763222)
authz guard:      Tests: 119 passed
bos-entitlements: Test Suites: 89 passed   Tests: 1854 passed
literals:         check-bos-llm-literals: 51 files in scope, 2 exempt, 0 violations
typecheck:        typecheck-bos-llm: 318 files in scope, 28 errors, 0 new — passed
next build:       EXIT 0; ƒ /admin/business-os-llm 9.65 kB; ƒ /api/admin/business-os/credits/report
QA fixture:       15 passed; QA route: 17 passed; QA UI: 11 passed (all three files deleted)
CR-B1 repro:      rowsRange.to=2026-09-05T10:11:12.345Z matches=false rowsRead=0 fromRowsCredits=0 mismatched=1
```

**No code changed during the QA run.** The SHA-256 of the 25 changed or new non-doc files is identical before and after, and the manifest hash is `156419214643a8c7…` both times. The temporary test files (4) and the `origin/main` worktree were removed. Only this section and one Change History row were edited.

### Re-run owed after the CR-B1 fix
The new suites, `app/admin/business-os-llm`, `lib/repositories`, `npm run test:authz-guard`, `npm run typecheck:bos-llm`, `npm run check:bos-llm-literals`, the microsecond test, and the QA fixture repeated with microsecond `period_start` values.

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit (CR-B1, High; Low items 2–4 recommended in the same pass)

### QA re-test — 4a (2026-09-29)

**Test mode:** full, focused on the T4a.8 fixes
**Strategy used:** A (builder, formatter) + B (route with mocked auth and repositories) + render tests (jsdom) + static source checks + `next build`. No real database. Every Jest run used `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys. The worktree has no `.env*`, and no dev server was started.
**Focus:** api, ui, schema
**Skipped:** Option D (manual browser check), for the same reason as the first run. The user's diff view should include one look at the Costs & credits tab.
**Input source:** TL prompt (the re-run list owed in the first report, plus each T4a.8 fix)

**Verdict: ✅ PASS — 4a is ready for commit.** CR-B1 is fixed, and QA's own microsecond fixture now matches by hand. CR-S1 and every QA Low / edge item are verified by independent probes. QA found no new bug.

#### 1. Gates

| Gate | Result |
|---|---|
| New and directly affected suites (read repository test, `lib/business-os/credits/__tests__`, the report route test, `costsTab.render`, `costFormat`) | ✅ **9 suites / 158 tests pass.** Run clean after the QA temp files were deleted. This matches Dev's figure |
| `npx jest lib/repositories lib/business-os/credits app/admin/business-os-llm app/api/admin/business-os/credits` | ✅ **61 suites / 1,014 tests pass** |
| The CR-B1 / CR-S1 / QA-Low blocks in `creditReport.test.ts` | ✅ 7 / 7. These include the mock's own microsecond self-test |
| Repository test: `.lt` pinned, `.lte` absent on both reads | ✅ (lines 134–135, 229–230) |
| `npm run test:authz-guard` | ✅ 1 / 119 pass |
| `npm run typecheck:bos-llm` | ✅ 318 files, 28 errors, **0 new**, passed. It also shows the same pre-existing "baseline entry fixed" note (`app/api/onboarding/build/route.ts`), which is not in this diff |
| `npm run check:bos-llm-literals` | ✅ 51 files, 2 exempt, 0 violations |
| `next build` (`NODE_OPTIONS=--max-old-space-size=6144`, the `build.yml` placeholder env) | ✅ **exit 0.** It built `ƒ /admin/business-os-llm` (10.2 kB) and `ƒ /api/admin/business-os/credits/report`. The one `level:50` line is the pre-existing Dynamic-server-usage log from `/api/v2/calibrate/load-configuration` |
| `test:bos-entitlements` | Not required. Nothing in the diff imports `lib/business-os/entitlements/**`. The only mention is the pre-existing `SCOPED_DIRS` string in `scripts/typecheck-bos-llm.ts` |
| Read-only proof | ✅ In the repository, builder, route, costs components and `cost*.ts`, there is no `.lte(`, no write verb, no `.rpc(`, no `AuditTrailService` and no `console.*`. Importers of the read repository outside tests: only `creditReport.ts` and the barrel |

#### 2. Hand-computed microsecond fixture (temporary, 11 cases, deleted)

**The mock** parses `period_start` to **microseconds** with a `BigInt`. It accepts both the PostgREST ISO form and the psql / PROD text form `2026-09-23 19:55:01.28632+00`. It applies the repository's half-open contract, `from <= period_start < to`, to both reads.

**Negative control:** for each micro value, the value is **greater than** its own millisecond-truncated `Date`. So the old `.lte(truncated)` bound would drop it, and this mock would catch that.

**Fixture.** The window is 2026-09-01…09-28, so the range is `[2026-08-01T00:00Z, 2026-09-29T00:00Z)`.

Periods:
- **A** has `2026-09-23T19:55:01.28632+00:00` and `2026-08-23T19:55:01.286321+00:00`.
- **B** has `2026-09-05T10:11:12.345678+00:00`.

Rows. All three triggers appear, plus one failed charge, two fallback-priced charges, and an `sms_fixture` service at $0.00000021. The corrections are:
- a same-period reconciliation of A's fallback charge;
- a **cross-period** correction (A Sep → A Aug);
- a **cross-account** `fallback_price_reconciled` correction (A → B's fallback charge);
- a correction whose original sits in **B's period at `2026-07-31T23:59:59.999999`**, 1 µs before the lower bound, so it is not read and is fetched by id.

Traps: a totals row and rows at exactly `2026-09-29T00:00:00.000000` (the exclusive upper bound), and one at the 1 µs-early July period.

The expected figures were written by hand before the run. All passed on the first run, and no expectation had to be corrected.

| Check | Result |
|---|---|
| Ranges | ✅ Totals and rows are asked for **the same** range, `2026-08-01T00:00:00.000Z` → `2026-09-29T00:00:00.000Z`. Its `to` is later than the newest micro `period_start`. `findChargesByActionIds` is called once, with only B's July original |
| All accounts, ISO rows | ✅ `rowsRead = 13`, so every row of every in-range period was read and both traps were excluded. The 3 periods are A Sep / B Sep / A Aug, all **"matches"**, with `mismatchedPeriods = 0` and `unreadableAmounts = 0`. A Sep rebuilt = total 6.250001, owner 3.500001, scheduled 0.75, external 3, adjustment −1, $0.00625021, 5 charges, 1 fallback. Grand stored = grand rebuilt = 16.500001 credits / $0.01650021 / 9 charges |
| All accounts, **PROD-shape rows** (`2026-09-23 19:55:01.28632+00`) against ISO totals | ✅ Identical results. The (account, period) join matches across the two text forms |
| Breakdowns (net, including corrections) | ✅ All four dimensions sum exactly to 16.500001 / $0.01650021. By action type: `chat_turn` 10, `insight_run` 0.5 (1 failed, plus the correction fetched by id), `lead_reply_recommendation` 2.6, `website_full_site` 3.5 (cross-period correction inherited), `sms_send` 0.000001 / $0.00000021, unresolved −0.1. By service: `ai` 16.6. By trigger: owner 9.750001 / $0.00975021, scheduled 1.75, external 5.1. By area: chat / insights / leads / website, and "not declared" for `sms_fixture` |
| Fallback | ✅ Count 2, reconciled **1**. A's charge in the micro period is `reconciled: true`. B's charge is `reconciled: false`, even though A's cross-account correction names it (QA Low 4 fixed) |
| Spreads (S-6) | ✅ The micro-period rows are included. `ai / chat_turn`: 4 examples (1 fallback excluded), credits p50 1.75 / p90 2.7 and $0.00175 / $0.0027 (`percentile_cont` over [1, 1.5, 2, 3]). `insight_run`: 0 examples, 1 failed, p50 null. `sms_send` p50 $0.00000021 |
| One account: A | ✅ The all-accounts totals read is not called. Rows are read for `[A]`. B's charge is fetched by id and the correction stays **unresolved** (D-2). `rowsRead = 10`, both micro periods "matches", every breakdown sums to 11.250001, fallback 1 / reconciled 1, and `chat_turn` spread = 3 examples, p50 1.5 |
| One account: B | ✅ The `.345678` period is read: `rowsRead = 3`, "matches". The original from 1 µs before the range is fetched by id, and the correction is attributed to `insight_run` (−0.25). Fallback 1 / reconciled 0 |
| Lower edge | ✅ A period at `2026-08-01T00:00:00.000001` is read and matches |

#### 3. Each other fix, probed independently

| Fix | Probe | Result |
|---|---|---|
| **CR-S1** | Micro fixture: totals at the ceiling with A Aug's totals row missing | ✅ A Aug `stored: null`, `matches: null` ("not checked"), `mismatchedPeriods = 0`, `totals_ceiling` reported, and the other periods still "matches". **Without** the ceiling, the same orphan is a mismatch (1) |
| **Stale response** (CR-N2) | Three overlapping reads (30 → 7 → 90 days) | ✅ Reads 1 and 2 have their `AbortSignal` **aborted** when superseded, and read 3's does not. Read 3 resolves first and sets the window. Then read 2 resolves with other data, and read 1 fails with a 500: neither changes the screen, no error box appears, loading is cleared, and "Last 90 days" stays pressed |
| **Failed read clears the report** | Good report (with `unreadableAmounts: 1`), then a preset whose `fetch` **rejects** (network) | ✅ The error box shows "Failed to fetch". Periods, the window line and the unreadable notice are all gone |
| **Window and account kept across a tab switch; aria** | Full page: custom dates 2026-08-15…09-10 via "Apply dates", account A, then Settings → Costs | ✅ There are 2 `role="tab"`. The query sent is `from=2026-08-15&to=2026-09-10&accountId=A`. On Settings, Costs has `aria-selected="false"` and its `aria-controls` panel is `role="tabpanel"` and hidden. Back on Costs, the panel is visible, both date fields and the account are kept, and **no new read** is made (still 3) |
| **`unreadableAmounts` shown and logged** | Route: a PROD-shape micro period with `cost_usd: 'garbage'` | ✅ 200, `unreadableAmounts: 1`, and exactly one `info` line carrying `unreadableAmounts: 1, rowsRead: 1`. The period is a mismatch, because the unreadable cost counts as 0, as documented. The business name appears in no log line. Tab: singular copy "1 stored amount could not be read and was counted as 0…" |
| **Originals-read failure message** | Route: `findChargesByActionIds` returns an error. Tab: `originals: 'failed'` with 2 corrections | ✅ Route: 200, `originals: 'failed'`, the correction is unresolved (−0.5 / −$0.0005), the period still "matches", and "db down" is not in the body. Tab: "…2 corrections (-0.35 credits) are counted on their own line…", and `costs-unresolved` is not shown |
| **Cross-account correction does not mark reconciled** | The micro fixture (above) | ✅ |
| **Tiny values formatting** | A rendered spread row with cost p50 4e-11 / p90 1.23e-12 and credits 4.4e-7 / 1e-7 | ✅ Shows `$0.00000000004`, `$0.0000000000012`, `0.00000044` and `0.0000001`. There is no `$0.00`, and no bare `0`, in the row |
| **Synchronous name-lookup throw** | Builder: `findNames` throws synchronously. Route: `findAdminIdentitiesByUserIds` throws synchronously | ✅ The builder returns `names: 'failed'` with rows, originals and checks intact, and `rowsRead = 13`. The route returns **200**, `names: 'failed'`, the period "matches", and the thrown message is not in the body. A synchronous throw from the rows read fails only `rows` (names ok, every check "not checked", breakdowns null) |

#### 4. Notes (no action needed)
- **N-QA-1.** The (account, period) join key (`pairKey`) and the period sort use `Date.parse`, which is millisecond precision. This is safe: totals and rows are truncated the same way, and two billing periods of one account cannot fall within 1 ms of each other. The mixed ISO / psql-shape probe confirmed the join. It does not bound a query, so CR-B1 does not apply to it.
- **N-QA-2.** At the totals ceiling, "incomplete" can be a false positive when there are exactly `ceiling` rows (edge 8). This is accepted as the documented conservative rule.

#### Test outputs

```text
new + affected (clean):   Test Suites: 9 passed, 9 total    Tests: 158 passed, 158 total
owed set:                 Test Suites: 61 passed, 61 total  Tests: 1014 passed, 1014 total
CR-B1/CR-S1/QA-Low block: Tests: 7 passed (21 skipped by -t)
authz guard:              Tests: 119 passed, 119 total
typecheck:                typecheck-bos-llm: 318 files in scope, 28 errors, 0 new (293.9s) — passed
literals:                 check-bos-llm-literals: 51 files in scope, 2 exempt, 0 violations — passed
next build:               EXIT 0; ƒ /admin/business-os-llm 10.2 kB; ƒ /api/admin/business-os/credits/report
QA temp:                  micro fixture 11 passed; route probe 3 passed; UI probe 4 passed (all 3 files deleted)
```

**No code changed during the re-test.** The SHA-256 of the 25 changed or new non-doc files is identical before and after the run. The manifest hash is `74dd37e8c47428d1…` both times, and the file set is the same. It differs from the first run's `156419214643a8c7…` because of Dev's T4a.8 changes. The three temporary test files were deleted before `next build` and the clean re-run. Only this section and one Change History row were edited.

### Final Status (re-test)
- [x] All acceptance criteria for 4a pass — ready for commit (after the user's diff view, per the standing flow)
- [ ] Issues found

### QA report — 4b (2026-09-30)

**Test mode:** full
**Strategy used:** A + B. A covers the gates plus QA's own hand-built fixtures, run through the real `runCreditLeakCheck` with faked repositories. B covers route probes with a mocked admin gate and mocked reads, and a render of the real runner's JSON in the panel. There was no browser check: that would need a dev server with real credentials, which the brief forbids. The panel was exercised by rendering it in jsdom instead.
**Focus:** api, ui, security, pipeline of the check (classification)
**Skipped:** the real-data run (T4b.5, owed by the user after go-live), and a live browser check (no real DB allowed)
**Input source:** prompt keywords (TL brief), plus §5, §9.2 and §10.2
**Environment:** worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-4b`, uncommitted. Every Jest run used `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys. The worktree has no `.env*`, and no dev server was started.

#### Test Coverage

| Criterion / area | Tested? | Result | Notes |
|---|---|---|---|
| Clean account (every group charged) | ✅ | Pass | Two groups matched. No finding row, no `error` log, `listingFailed` false |
| Group with calls and no charge → leak | ✅ | Pass | `periodStart` follows the plan-anchor rule (`2026-09-15T10:00:00.000Z` for anchor 08-15), the group id is in the examples and in `groupIds`, USD not charged = 0.005, and there is exactly one `error` `bos_credit_leak_found` |
| B-1: 23:40 charged, 00:20 lost, across midnight | ✅ | Pass | Day D reports the group as under-charged by turn B ($0.002) |
| Matched group straddling midnight | ✅ | Pass | Not reported on D, nor on D−1. An action at 23:58 with its charge at 00:02 is matched on both nights |
| Fallback-priced group | ✅ | Pass | Over → pending. Under → pending with `pendingUndercharged` 1 and direction `under`. Neither is a leak: `totalUncharged` 0, no `error` |
| Ungrouped calls | ✅ | Pass | NULL **and** `''` `session_id` with spend go to their own bucket (2 calls, $0.003) as a leak. A zero-spend ungrouped row, and one in the slack only, are ignored |
| Known uncharged path (`business-os-chat` / `IntentParser`) | ✅ | Pass | Own bucket, 3 calls over 2 accounts. Exactly one `warn` `bos_credit_leak_known_path`, no `error`, both accounts clean |
| Adjustments (effective service) | ✅ | Pass | A reconciliation adjustment (group NULL, inherited through its charge) on a fallback charge → matched. An adjustment whose charge was not read → `unresolvedCorrections` 1, and it neither hides nor creates a leak (a real leak in another group is still reported). A charge plus adjustment of **another service** under the same group id does not hide an AI leak |
| Tiny costs recorded as $0 | ✅ | Pass | `'0.000000'` with tokens → uncharged by presence. $0 with 0 tokens → no-spend. A sub-µ$ charge (0.0000004) against a $0 row → matched within T |
| Insight cron's shared run id on two businesses | ✅ | Pass | Matched per (account, group): only the uncharged account is flagged. Even when the ledger fake is made to return **the other account's** charge row, it is not matched (the `user_id` guard in the classifier) |
| Ceiling → incomplete; failed read → could not check | ✅ | Pass | Ceiling → `incomplete`, `warn`, no `error`, not counted as a leak. An error result and a **thrown** read → `could_not_check` (`ledger_read_failed`). Never clean |
| 45 s deadline | ✅ | Pass | At 30 s per account, 2 are checked, `accountsRemaining` is 1 and `deadlineReached` is true |
| Platform account excluded | ✅ | Pass | The all-zero id, `SYSTEM_ADMIN_USER_ID`, and its upper-case spelling are never walked. The platform count is still reported |
| Charged account with no plan row | ✅ | Pass | Walked (`chargedWithoutPlan` 1), with the calendar-month period `2026-09-01` |
| Timestamps / window edges | ✅ | Pass | PostgREST microsecond `+00:00` timestamps parse (0 unreadable). A row at exactly `E` belongs to the next window |
| D-13 end pulled back | ✅ | Pass | Runner: an end of tomorrow at 10:00 becomes `09:54:00.000Z`, `endClamped`. Route: `from = to = today` gives an end within ±50 ms of now − 6 min |
| Admin route authz | ✅ | Pass | 401 when signed out, even with a bad query. 403 for a non-admin. No read and no name lookup before the gate |
| Admin route 400s | ✅ | Pass | 9 probes, each with no read: only `from`, only `to`, from > to, 8 days, unknown key (`userId`), bad UUID, `2026/09/01`, `2026-02-30`, `to` 5 days ahead |
| Admin route 409 | ✅ | Pass | The all-zero id, and the upper-case `SYSTEM_ADMIN_USER_ID`, both with no read |
| Admin route 200 | ✅ | Pass | Default window is yesterday `[D−1 00:00, D 00:00)`. The business name is in the body and in **no** log line. The leak is logged at `error` |
| Cron route | ✅ | Pass | 401 with no header, a wrong bearer, or the secret without `Bearer `. With no `CRON_SECRET` in production: 401 plus an `error` log. No read in any of these. The right bearer gives 200 with counts only: no `usd`, `cost` or `credit` key, the $0.123456 fixture does not appear, and there is no name lookup and no name in any log |
| UI panel | ✅ | Pass | The **real runner's JSON** was rendered: idle "Not run yet", no fetch on mount, "Checking…" while running, red verdict "2 businesses…", "(1 under)", expandable group-id `<details>` per row, the known path "business-os-chat / IntentParser: 1 call", platform "5 Business OS calls, 2 with the shared helper label", 6 blind spots under "What this check cannot see". Red plus "also partial" when one account is incomplete. Green in one-account mode, with the platform line hidden and "Checking one business: Beta". `CostsTab` mounts the panel and never calls the leak URL on mount. Dev's 15 panel tests cover the four amber cases |
| Jobs page: 13th job | ✅ | **Partial** | "Credit leak check", "Daily at 04:45 UTC" are listed as the 13th job. **But the status after deploy is "Stopped", not "No run yet"** (QA4b-B1 below) |
| Health tile "Not measured yet" | ✅ | **Fail** | The tile is **red, "A job has stopped", worst job "Credit leak check"** (QA4b-B1) |
| AC-31 (Jest) | ✅ | Pass | `creditLeakCheck.ac31` is green. The real-data half is owed by the user (T4b.5) |

#### Issues Found

**Bugs (must fix before commit)**

1. **QA4b-B1. The new job shows "Stopped" and turns the Health tile red from deploy until its first 04:45 UTC run.** Files: `lib/admin/jobs/buildJobsQueuesView.ts` (`jobStatus` / `runBaseline`) and `supabase/migrations/20261011_bos_cron_runs.sql` (`first_run_at = min(started_at)` over **all** jobs). Severity: **Medium**.
   - **Cause:** a job with no Vercel run is measured from the baseline `COALESCE(first run of ANY job, installed_at)` (F-6). Run recording has existed since 2026-09-27/28, so on any deploy more than 49 h later (2 × 1440 + 60 min), the new daily job is already past `stoppedAfterMinutes` on its first page load.
   - **Steps to reproduce:** in a temporary test, give `buildJobsQueuesView` 13 summary rows: 12 healthy jobs with a run 5 min ago, and `credit-leak-check` with `last_cron_started_at: null`, all with `first_run_at: 2026-09-28T10:00Z`. Use now = 2026-10-02T12:00Z, then call `evaluateHealth` with those tile facts.
   - **Expected (as stated in §9.2 "What the user will see"):** the job reads "No run recorded yet", and the Health "Scheduled jobs" tile is grey, "Not measured yet".
   - **Actual:** `status: 'stopped'`, and `jobsTileFacts` returns `{ healthy: 12, stopped: 1, noRunYet: 0, worstJob: 'Credit leak check' }`. The tile is `status: 'red'`, `headline: 'A job has stopped'`, `matchedRuleId: 'jobs.stopped'`. It stays that way for up to about 24 h, until the first 04:45 UTC run.
   - **Why it matters:** a false red alarm on the admin Health page right after the release. It also teaches the operator to ignore "Stopped", which is exactly the signal §5.5 relies on if `CRON_SECRET` is ever removed.
   - **Root cause:** this is the first job added after recording began, so it is the first to hit the gap in F-6's baseline. Whoever fixes it should decide the approach with SA. Two options: a per-job baseline (for example, a registry "added on" date, so `measuredFrom = max(baseline, addedAt)`, and the job reads "No run yet" until its first late period ends), or an accepted, documented deploy-day red. Either way, §9.2's "What the user will see" text needs correcting.
   - SA's 4b review did not raise this.

**Performance issues:** none found. Each account gets one usage read and one ledger read, run in parallel. Accounts are walked one at a time, with the deadline checked before each one.

**Edge cases (nice to fix)**

1. **QA4b-E1. The panel does not explain rows that are listed only for unresolved corrections or unreadable amounts** (`LeakCheckPanel.tsx`). Such an account's row reads "No leak" with zeros in every column, because the table has no column or note for `unresolvedCorrections`, `unreadableAmounts` or `chargedAboveUsage`. `chargedAboveUsage` appears only in the drill-down. Severity: Low. This is related to SA CR4b-N3: unreadable amounts do not change the status.
2. **QA4b-E2. An empty on-demand window reads green.** With `from = to = today` in the first 6 min after 00:00 UTC, the end is clamped to the start: the window is empty, and the verdict is "No uncharged AI spend found". The note "The window's end was pulled back…" is shown with it. Severity: Low. Same as SA CR4b-N2.
3. **QA concurs with SA CR4b-S1 from reading the code.** `checkAccount` builds the usage read's end from the **clamped** `endMs` plus 1 h. So on demand it reaches past now, and it reads the calls of an action that is still running while its charge does not exist yet. QA did not build a separate test for this. The fix SA asked for should carry its own test.

#### Test Outputs / Logs

| Gate | Result |
|---|---|
| New suites: `creditLeakCheck`, `.ac31`, `.wireTypes`, leak-check route, cron route, `leakPanel.render`, and the read repository test | **7 suites / 144 tests pass** |
| `npx jest lib/business-os/credits lib/repositories app/admin/business-os-llm app/api/admin/business-os/credits app/api/cron lib/cron app/admin/__tests__` | 80 suites / 1,622 tests: **1 failure, pre-existing** (`runRecord.adoption` › `payment-reminders`) |
| Adoption suite, `credit-leak-check` cases only | 3 / 3 pass |
| The same `payment-reminders` failure on `origin/main` `b6efd992` | **Reproduced** in a temporary detached worktree: 1 failed / 35 passed, the same test. The node_modules junction was removed first, then the worktree; the main `node_modules` is intact |
| `npm run test:authz-guard` | 1 / 119 pass |
| `npm run test:bos-entitlements` | 90 / 1,891 pass |
| `npm run typecheck:bos-llm` | 328 files, 28 errors, **0 new**, passed. The same pre-existing "baseline entry fixed" note (`app/api/onboarding/build/route.ts`) |
| `npm run check:bos-llm-literals` | 53 files, 2 exempt, **0 violations** |
| `next build` (6 GB heap, the `build.yml` placeholder env) | **Exit 0.** Built: `ƒ /admin/business-os-llm` 13.4 kB, `ƒ /api/admin/business-os/credits/leak-check`, `ƒ /api/cron/credit-leak-check`. 65 `level:50` lines, all the known "Dynamic server usage" noise, **none** mentioning the leak check |
| QA temporary fixtures: 20 classification + 16 route probes, 4 UI, 3 jobs/health | 40 / 40 pass, plus the 2 jobs/health probes that **reproduce QA4b-B1** (they assert "no_run_yet" / "Not measured yet" and fail with `stopped` / `red`). All 4 files were deleted |

**No code changed during the run.** The SHA-1 manifest of the 30 changed or new non-workplan files is `5430c3a20e3bf27e…` before and after, and a line-for-line `diff` of the two manifests is empty. Only this section and one Change History row were edited.

#### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found. Dev must address **QA4b-B1** (Medium; decide the approach with SA) and SA's **CR4b-S1** before commit. No High-severity bug. The classification, both doors, authz, tenant scoping, logs and the UI all pass

### QA re-test — 4b (2026-09-30)

**Test mode:** focused regression on the T4b.7 fixes (QA4b-B1, CR4b-S1, QA4b-E1, CR4b-N2 / QA4b-E2), plus the full gate set
**Strategy used:** A + B. QA wrote three temporary probe suites of its own (not the Dev's fixtures): the real `buildJobsQueuesView` → `jobsTileFacts` → `evaluateHealth` on a simulated clock; the real `runCreditLeakCheck` with faked reads that honour the read window; and the real runner's JSON, round-tripped through `JSON.stringify`, rendered in `LeakCheckPanel` under jsdom. All three were deleted after the run
**Skipped:** a live browser check and the real-data run (T4b.5): no real database is allowed
**Environment:** worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-4b`, uncommitted. Jest ran with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` and stub keys. `next build` ran with the `build.yml` placeholder env. There is no `.env*` in the worktree

#### Results

| Item | Result | Evidence (QA probes) |
|---|---|---|
| **QA4b-B1**: no run yet at 09-30 15:00, 10-01 03:00, 10-02 00:59 (and at exactly 10-02 01:00) | ✅ Pass | The other 12 jobs first ran 2026-09-28T10:00Z and have a run 1 min ago. `credit-leak-check` has no run. At each instant it reads `no_run_yet` / "No run recorded yet", with `expectedBy` 2026-10-02T00:00Z. The tile facts are `healthy 12, stopped 0, noRunYet 1, worstJob "Credit leak check"`, and the Health tile is `not_measured`, "Not measured yet", never red |
| QA4b-B1: late, then stopped | ✅ Pass | At 10-02 01:01 it reads `late`, and the tile is amber, "A job is late". At exactly 10-03 01:00 it is still `late`. At 10-03 01:01 it reads `stopped`, and the tile is red, "A job has stopped" |
| QA4b-B1: once it has a run | ✅ Pass | A run 15 min before 10-01 05:00 → `healthy`, and the tile is green. A run 1,502 min ago → `late`, and one 2,941 min ago → `stopped`. Both are timed from the run, not from `addedOn` |
| QA4b-B1: an undated job with no run is unchanged | ✅ Pass | `insight-detect` with no run, baseline 09-28 10:00: `no_run_yet` at 09-28 20:00, `late` at 09-29 12:00, still `late` at 09-30 11:00 (at the threshold, not past it), `stopped` at 09-30 11:01 with `measuredFrom` = the global first run, and the tile is red. In the same view the dated job stays `no_run_yet` |
| QA4b-B1: other baselines | ✅ Pass | With no `first_run_at` anywhere and `installed_at` 09-27, the dated job is measured from 10-01T00:00Z. A global first run later than its added day (10-05) wins, and `expectedBy` is 10-06T00:00Z. `jobStatus` is the only consumer of the baseline (grep), so the Jobs page and the Health tile cannot disagree |
| **CR4b-S1**: `to` = today, uncharged turn 2 min ago | ✅ Pass | Now is 09-30 12:00, and the window is [09-30, 10-01). Reused chat group: turn one at 11:00, charged at 11:00:04. Turn two at 11:58 has no charge. The window end is clamped to `11:54:00.000Z` (`endClamped`), and the usage read's end is `11:54:00.000Z`. Result: `accountsWithLeak` 0, `underchargedGroups` 0, $0, no `error` log. This holds in all-accounts mode **and** in one-account mode |
| CR4b-S1: the same uncharged turn 10 min ago | ✅ Pass | Turn two at 11:50: `accountsWithLeak` 1, `underchargedGroups` 1, $0.001 not charged. The example is the group, with 2 calls (recorded $0.003, charged $0.002), and there is exactly one `error` `bos_credit_leak_found`. Same in both modes |
| CR4b-S1: nightly is unaffected | ✅ Pass | A past whole-day window is not clamped, and the usage read keeps its full slack, ending at `00:59:59.999Z` |
| **QA4b-E1**: row notes, from the real runner's JSON | ✅ Pass | Four accounts are each listed only for an informational count, and each reads "No leak" plus a note. One has an adjustment whose charge was not read: "1 unresolved correction". One has a ledger row with an unreadable time and amount: "1 unreadable amount". One was charged $0.004 against $0.001 recorded: "1 charged above usage". One has all three: "1 charged above usage · 1 unresolved correction · 1 unreadable amount". A plain clean account is not listed, and the verdict is green, which is correct because none of these is a leak |
| **Empty window** (CR4b-N2 / QA4b-E2), from the real runner's JSON | ✅ Pass | Now is 09-30 00:03, with `from = to` = today. The runner returns `window.start == window.end` and `endClamped`. The panel shows "Nothing to check yet — the window has not ended" (`leak-verdict-empty`), with no `leak-verdict-clean` and no "No uncharged AI spend found" text, and the end-clamped note is shown. A non-empty clamped window (12:00 the same day) does **not** show the empty verdict |

#### Observations (no action needed)

1. **An empty window still walks every account.** With an empty window, the runner still lists and reads each account (`accountsChecked` 5 in the probe), so the line above the verdict says "5 businesses checked" next to "Nothing to check yet". This is harmless: the reads cover only the slack, and nothing can be reported. It is also cosmetic: a later slice could skip the walk when `endMs == startMs`.
2. **The empty-window verdict outranks "partial"** (leak → empty → partial → clean, as documented in T4b.7). An empty window whose listing also failed shows "Nothing to check yet", and the listing-failed note is shown below it. That is acceptable.
3. **The `addedOn` date is still a deploy-day dependency (D-22).** If 4b ships after 2026-09-30, RM must move `addedOn` to the deploy day in the same PR. The probe shows why. With `addedOn` at 09-30, a job with no run is `late` from 10-02 01:01 and `stopped` from 10-03 01:01, whatever the deploy day. So a deploy on or after 10-02 would show a false Late or Stopped, and a red tile, before its first 04:45 run.

#### Gates

| Gate | Result |
|---|---|
| New and touched suites (`creditLeakCheck`, `.ac31`, `.wireTypes`, both leak-check routes, `leakPanel.render`, the read repository, `lib/admin/jobs`, `lib/cron`, `jobsQueues` render and guard, `jobs-queues` routes, the adoption suite, the entitlements import guard) | 20 suites / 495 tests: **1 failure, pre-existing** (`runRecord.adoption` › `payment-reminders`, the same red as in QA report — 4b, reproduced there on `origin/main`) |
| `npx jest lib/business-os/credits lib/cron lib/admin app/admin/__tests__ app/admin/business-os-llm app/api/cron app/api/admin/business-os/credits app/api/admin/jobs-queues lib/repositories` | 93 suites / 2,138 tests: **1 failure, the same pre-existing one**. This matches the Dev's T4b.7 count exactly |
| `npm run test:authz-guard` | **1 / 119 pass** |
| `npm run test:bos-entitlements` | **90 / 1,891 pass** |
| `npm run typecheck:bos-llm` | **328 files, 28 errors, 0 new, passed** (the same "baseline entry fixed" note for `app/api/onboarding/build/route.ts`) |
| `npm run check:bos-llm-literals` | **53 files, 2 exempt, 0 violations** |
| `next build` (6 GB heap, `build.yml` placeholder env) | **Exit 0.** Built `ƒ /admin/business-os-llm` 13.6 kB, `ƒ /admin/jobs-queues`, `ƒ /api/admin/business-os/credits/leak-check`, `ƒ /api/cron/credit-leak-check`. There are 65 `level:50` lines, all "Dynamic server usage" noise (64 marked `DYNAMIC_SERVER_USAGE`, plus 1 from calibrate `load-configuration` with the same message). **None** mention the leak check |
| QA probes | 8 jobs/health + 5 runner + 3 panel = **16 / 16 pass** (after 3 of QA's own probe mistakes were corrected: 2 read a field `JobView` does not carry, and 1 had wrong clock arithmetic; none was a product defect). All 3 files were deleted |

**No code changed during the run.** QA took a SHA-1 manifest of the 31 changed or new non-workplan files before the run and again after it. Both hash to `e7735c879edf60fa0423d28f6dc7208383d7eb41`, and a line-for-line `diff` of the two manifests is empty. `git status --short` shows the same 18 modified and 12 untracked entries as at the start, and no probe file remains. Only this section and one Change History row were edited.

#### Final Status (re-test)
- [x] All acceptance criteria pass — ready for the user's diff view. QA4b-B1, CR4b-S1, QA4b-E1 and QA4b-E2 are all closed. No open bug; the only red is the pre-existing `payment-reminders` adoption test, which is not from this slice
- [ ] Issues found

---

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-09-29 | Workplan created (Dev) | Slice 4 planned as three parts: 4a read-only operator cost report on a new "Costs & credits" tab of `/admin/business-os-llm` (≈ 3.5 d, no migration), 4b leak check with an on-demand admin door and a fail-closed nightly cron (≈ 2.5 d, no migration), 4c reconciliation adjustments through a new function in `20261016` (≈ 3 d, PROD apply by the user). Live read-only checks: ledger empty (0 charges), `token_usage` keeps micro-dollars (1,377 of 1,545 chat embedding rows at $0), `CRON_SECRET` appears set (vercel_cron rows in `bos_cron_runs`). Answers slice 3 OI-2: the `token_usage` insert is awaited before a call returns, so a freeze-lost lead-alert charge is visible to the leak check. 15 SA questions, 3 business questions. No code, no SQL, nothing committed |
| 2026-09-29 | SA workplan review | Approved with conditions. The three-way split is accepted, and 4a may start now. Blocking for its own part: B-1 (4b: a lost charge in a reused group that crosses midnight is never reported) and B-2 (4c: the SQL accepts only the one reason code). Should-fix: S-1 to S-9, including walking plan accounts plus charged accounts, a scale-independent tolerance, known uncharged paths not logged as `error`, the period in the leak output, dropping the business-name search, p50 / p90 over succeeded charges, like-for-like totals cross-check, SQL deriving the deltas from a corrected cost (no entitlements import), and conditions on `created_by_admin_id`. Live re-checks: ledger still empty and **expected** (0 Business OS calls since the merge); `CRON_SECRET` confirmed set (2,277 `vercel_cron` runs since 2026-09-27 13:20 UTC); 3,019 of 4,990 Business OS rows in 30 days carry a NULL `session_id` (none since 2026-09-28 01:15). BQ-1 to BQ-3 reworded; BQ-4 added (never raise a charge after the fact). Review only: no code, nothing committed |
| 2026-09-29 | User decisions recorded (Dev) | BQ-1 reconciliation credits go to the month the over-charge happened (an owner make-good is a slice 11 grant); BQ-2 leaks on admin pages and logs only, no email; BQ-3 build 4a and 4b now, 4c later (with slice 5 or at the first over-charge); BQ-4 never charge more after the fact, only downward corrections. §14 |
| 2026-09-29 | SA 4a items folded into §4 (Dev, T4a.0) | S-5 business-name search dropped (§4.6); S-6 p50 / p90 over succeeded charges only, failed count beside, "few examples" below 10 (§4.3); S-7 totals cross-check by the totals' own rules, corrections in their own bucket, inherited breakdowns labelled "net, including corrections" (§4.1, §4.2) |
| 2026-09-29 | Part 4a implemented (Dev) | Read-only repository, effective fields, percentiles, report builder, admin route, Costs & credits tab, sidebar description, docs. 9 deviations recorded under §9.1 (D-1 to D-9). Gates: baseline set 83 / 1,684 pass, new + affected 14 / 355 pass, typecheck:bos-llm 0 new, literals 0 violations, entitlements 89 / 1,854 pass, `next build` exit 0. Two pre-existing reds outside the diff. Uncommitted, no migration |
| 2026-09-29 | SA code review — 4a | 🔄 Fix Required. **CR-B1 (blocking):** the rows read is bounded by the newest `period_start` truncated to milliseconds, but `period_start` is microsecond `timestamptz` (from `period_anchor DEFAULT now()`). So the newest period's rows are dropped, which shows a false mismatch and understated breakdowns for the current period. Fix: read the rows with the same half-open day window as the totals, `.lt` upper bound, plus a microsecond fixture test. **CR-S1:** orphan periods are "not checked" when the totals ceiling was hit. Notes CR-N1 to CR-N4. D-1 to D-9 all accepted. D-9 (3 unregistered invite handlers) is a separate docs item for TL, not this PR. Route gate first, strict Zod, read-only repository, N-10, S-6 and S-7 all verified. SA could not re-run the gates (shell refused after an attempted read-only PROD query), so QA's run is on record. Review only, nothing committed |
| 2026-09-29 | QA report — 4a | ❌ Not ready. **CR-B1 reproduced.** A microsecond `period_start` leads to 0 rows read and a false mismatch. All gates are otherwise green: 14 / 355 new + affected; authz 119; entitlements 89 / 1,854; literals 0; `typecheck:bos-llm` 0 new; `next build` exit 0. The two reds (`tokenUsageRepository.contract`, `entitlements/routes`) are confirmed pre-existing on `origin/main` `bd763222`. Route: 401 / 403 / 10 × 400 / 409 all happen with no read, and there is one `info` log with no name and no money. A hand-computed two-account fixture matches: cross-check (S-7), net breakdowns, fallback, and spreads equal to `percentile_cont` (S-6). New Low items: `unreadableAmounts` is not surfaced; a failed originals read looks like a ledger break; a cross-account unresolved correction sets `reconciled`. Read-only proof clean. No code changed (hashes identical), and temp files and worktree were removed |
| 2026-09-29 | 4a SA / QA findings fixed (Dev, T4a.8) | **CR-B1:** rows are read with the same half-open day window as the totals, the repository's upper bound is `.lt` (range now half-open, `from < to` guarded), and the ledger mocks compare `period_start` at microsecond precision. The new microsecond test is red on the old builder (`rowsRead` 1 vs 3) and green now. **CR-S1:** an orphan period under `totals_ceiling` is "not checked", not a mismatch, and `>=` at the ceiling is documented as the rule both reads share. **CR-N1:** the exactness bound (~$900k per sum) is in the header. **CR-N2:** a stale-response guard with abort, a failed re-read clears the report, the Costs tab is kept mounted across tab switches, and `aria-controls` / `role="tabpanel"` are added. **QA Lows:** `unreadableAmounts` is on the tab and in the log; a failed originals read says the read failed; only resolved corrections set `reconciled`; below-precision percentiles keep 2 significant digits; a synchronous throw from the name lookup or the rows read fails only its section. Gates: 61 / 1,014 pass, authz 119, `typecheck:bos-llm` 0 new, literals 0, `next build` exit 0. CR-N3 and CR-N4 are left as notes. Uncommitted |
| 2026-09-29 | QA re-test — 4a | ✅ **PASS, ready for commit.** CR-B1 is fixed: QA's hand-computed two-account fixture was re-run with microsecond `period_start` values (`.28632`, `.286321`, `.345678`, and the PROD psql shape), through a mock that compares at microsecond precision with the half-open range. For all accounts and for each single account, every in-range period is read (`rowsRead` 13 / 10 / 3), every check matches, and the breakdowns, fallback and spreads include those rows. The traps at the exact upper bound and 1 µs below the lower bound are excluded. CR-S1, the stale-response / abort / clear-on-failure behaviour, window and account kept across a tab switch, the aria roles, `unreadableAmounts` (tab and log), the originals-failure message, cross-account `reconciled`, tiny-value formatting and synchronous-throw isolation were all verified by independent probes. Gates: 9 / 158 new, 61 / 1,014 owed set, authz 119, `typecheck:bos-llm` 0 new, literals 0, `next build` exit 0. No code changed (manifest hash `74dd37e8…` before and after), and the 3 temp files were deleted |
| 2026-09-29 | SA 4b items folded into §5 (Dev, T4b.0) | B-1 a group is examined on any usage or charge in the window, slack only matches, two-night reporting stated, usage read 300 s earlier than the charge read, the 23:40 / 00:20 example; S-1 plan accounts ∪ charged accounts, remaining blind spot stated, no all-accounts `token_usage` read; S-2 tolerance `calls × 0.000001 + 1e-9`, presence detection; S-3 known paths in their own bucket at `warn`, ungrouped calls counted separately; S-4 the period in the output and the log; N-3 inclusive usage end (`E + 1 h − 1 ms`); N-5 7-day on-demand cap; Q-9 helper label in the platform count only; Q-15 schedule reason corrected; BQ-2 no email. Six blind spots named as codes |
| 2026-09-30 | Part 4b implemented (Dev) | The leak check: pure classifier, the RPC's period rule in TS, the runner (plan ∪ charged accounts, 45 s deadline, never throws), a new account-scoped half-open read on the 4a read repository, on-demand admin route (≤ 7 days, `requireAdmin` first), fail-closed nightly cron at `45 4 * * *` recorded through `withCronRunRecord` with counts only, the "Run leak check" panel on the Costs & credits tab. AC-31 proved through the real `runAiAction` with the charge RPC refused. 12 deviations recorded (D-10 to D-21). Gates: 6 new suites (103 tests) + 7 new repository tests pass, owed set 66 / 1,134, authz 119, `typecheck:bos-llm` 328 files 0 new, literals 53 / 0, entitlements 90 / 1,891, ESLint clean, `next build` exit 0. One pre-existing red (the adoption test's `payment-reminders` mock, also red on `origin/main`). Uncommitted, no migration. Owed by the user: the first real on-demand run after go-live (T4b.5) |
| 2026-09-30 | SA code review — 4b | ✅ Code Approved, no blocking findings. **CR4b-S1 (should fix, before the user's diff view):** the on-demand clamp pulls the window end back to now − 6 min, but the usage read still runs to `E + 1 h`. So a reused chat or onboarding group with an action still running shows a phantom under-charge at `error`. This happens with `to` = today, or with the default "yesterday" run within about 1 h of midnight UTC. Fix: cap the usage read's end at now − 6 min, and add one test. Notes CR4b-N1 to N5 (upper-edge mirror residue, an empty window reads clean, unreadable amounts do not change the status, the listing is outside the deadline, re-merge `origin/main` `b6efd992`). B-1, S-1 to S-4, N-3, N-5, matching, fallback, N-10, never-clean, deadline, both doors, logs, repository and guards all verified. The period rule was checked line for line against `20261015`. `vercel.json` gains only the one cron (13 in total). D-10 to D-21 all accepted, D-13 extended by CR4b-S1. SA gates: 75 / 1,542 with 1 pre-existing red (`payment-reminders` adoption mock, confirmed on `origin/main` by source), authz 119, `typecheck:bos-llm` 0 new, literals 0. Review only, nothing committed |
| 2026-09-30 | QA report — 4b | ❌ **Issues found, no High.** **QA4b-B1 (Medium):** the new job shows "Stopped", and the Health "Scheduled jobs" tile turns red ("A job has stopped", worst job "Credit leak check") from deploy until the first 04:45 UTC run. The cause is that a job with no run is measured from the global first run of any job (F-6, `first_run_at = min(started_at)`). This contradicts §9.2, which promises "No run yet" and grey. Reproduced with `buildJobsQueuesView` and `evaluateHealth`. The fix approach is for Dev and SA to agree. QA concurs with SA CR4b-S1 from reading the code. Lows: E1 (rows listed only for unresolved or unreadable amounts are unexplained), E2 (an empty window reads green). Every other item passes, through QA's own fixtures run with the real runner and faked reads: B-1 midnight both ways, straddle matched, fallback over/under, ungrouped (NULL and `''`), known path at one `warn`, adjustments (inherited group, unresolved, other service), $0 by presence, shared insight run id (even with a cross-account row injected), ceiling → incomplete, failed or thrown read → could not check, deadline → remaining, platform excluded (upper case too), no-plan account, microsecond timestamps, and the D-13 clamp. Routes: 401 / 403 / 9 × 400 / 409 with no read, 200 with the name only in the body; cron 401 × 3 plus fail-closed, 200 with counts only. The panel renders the real runner JSON. Gates: 7 / 144 new, 80 / 1,622 with 1 pre-existing red (`payment-reminders`, reproduced on `origin/main` `b6efd992`), authz 119, entitlements 90 / 1,891, `typecheck:bos-llm` 0 new, literals 0, `next build` exit 0. No code changed (manifest `5430c3a2…` before and after), and the temp files and worktree were removed |
| 2026-09-30 | 4b SA / QA findings fixed (Dev, T4b.7) | **CR4b-S1:** the usage read ends at `min(E + 1 h − 1 ms, now − 6 min)`; the charge read is unchanged; D-13 extended. New runner test (reused group, charged turn at 04:00, uncharged turn at now − 2 min, `to` = today) fails on the old code (read end `05:38:59.999Z`, `accountsWithLeak` 1) and passes. **QA4b-B1:** no migration; `addedOn?: 'YYYY-MM-DD'` on the cron registry, set only on `credit-leak-check` (`2026-09-30`); `jobBaseline` times a dated job with no run from the end of that day or the global baseline if later (D-22). The new job reads "No run recorded yet" until 10-02 01:00, then late, then stopped after 10-03 01:00; the Health tile stays `not_measured`; undated jobs unchanged. 6 new tests, 5 red with `addedOn` removed; two generic-rule tests in `qa-slice5-pr2.status.test.ts` adjusted deliberately. **QA4b-E1:** a row note for charged-above-usage / unresolved corrections / unreadable amounts. **CR4b-N2 / QA4b-E2:** an empty window reads "Nothing to check yet — the window has not ended", never green. Panel tests +2, both red on the old panel. §9.2 "What the user will see" corrected. Gates: 10 / 255 new and touched, 93 / 2,138 with the 1 pre-existing `payment-reminders` red, authz 119, entitlements 90 / 1,891, `typecheck:bos-llm` 0 new, literals 0, `next build` exit 0. **RM:** if 4b deploys after 2026-09-30, move `addedOn` to the deploy day. Uncommitted |
| 2026-09-30 | SA hand-off check — 4b fixes | ✅ Code Approved for the diff view. CR4b-S1 closed (usage read end `min(E + 1 h − 1 ms, now − 6 min)`, charge read unchanged, red-first test). QA4b-B1 approach accepted: opt-in `addedOn` + pure `jobBaseline` in the shared status rule, undated jobs unchanged, no migration; D-22 (end of day) accepted. A past `addedOn` is **not** harmless (one day late gives a false Late, two a false Stopped / red tile). **RM rule:** set `addedOn` to the UTC production-deploy day, the later day when in doubt, never earlier; state it in the PR. Optional registry test: pin the undated set to the 12 original jobs. QA4b-E1 and CR4b-N2 closed. Gates: 25 / 686 pass; `typecheck:bos-llm` 0 new. Nothing committed |
| 2026-09-30 | QA re-test — 4b | ✅ **Pass; ready for the user's diff view.** Tested with QA's own temporary probes (16 / 16 pass, then deleted). **QA4b-B1 closed:** the real `buildJobsQueuesView` and `evaluateHealth` show "No run recorded yet" and a `not_measured` tile (never red) at 09-30 15:00, 10-01 03:00, 10-02 00:59 and at exactly 01:00. The job is late (amber) from 10-02 01:01 and stopped (red) from 10-03 01:01. Once it has a run it is healthy / late / stopped by the usual rules, timed from that run. An undated job with no run keeps the global baseline exactly. **CR4b-S1 closed:** with `to` = today, an uncharged turn 2 min ago in a reused group is not reported (the usage read ends at now − 6 min), and the same turn 10 min ago is reported as under-charged with one `error`. Both hold in all-accounts and in one-account mode, and the nightly run is unaffected. **QA4b-E1 closed:** on the real runner's JSON, every info-only row gets its note. **E2 closed:** an empty window reads "Nothing to check yet", never green. Observations only: an empty window still walks the accounts, and `addedOn` must equal the deploy day (D-22). Gates: 20 / 495 new and touched, 93 / 2,138 broad; each has only the pre-existing `payment-reminders` red. Authz 119, entitlements 90 / 1,891, `typecheck:bos-llm` 0 new, literals 0, `next build` exit 0. No code changed: manifest `e7735c87…` before and after |
