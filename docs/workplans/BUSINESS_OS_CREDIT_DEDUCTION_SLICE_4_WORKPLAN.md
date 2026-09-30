# Workplan: Business OS Credit Deduction — Slice 4 (Operator cost report and nightly leak check)

> **Last Updated**: 2026-09-29

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md) — §4 (three records, effective service), §12 slice 4, FR-12c, FR-12d, FR-16 (detection), FR-33, FR-40f, AC-4, AC-23 (report half), AC-31, SA-S9, N-10, SQ-13 (3), SQ-15
**Builds on:** [BUSINESS_OS_CREDIT_DEDUCTION_SLICE_3_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_3_WORKPLAN.md) (the ledger shape §3.2, the RPC §3.5, the checker §6.3, and open items OI-1 / OI-2 in §12)
**Date:** 2026-09-29
**Branch:** `feature/business-os-credit-deduction-slice-4` (worktree `neuronforge-llm-deduction`, off `origin/main` `95a7ead0`). If SA accepts the three-way split (§8), RM decides whether 4b and 4c get their own branches.
**Status:** 4a Code Complete (uncommitted) — for SA code review. 4b and 4c not started. No migration. Nothing committed.

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

### 5.1 What counts as Business OS spend

`token_usage` rows matching `bosRowFilter()` (V-8), on the account being checked. Rows on the **platform account** are Business OS spend no account can be charged for; they are counted and shown separately (count only, through the existing `countInWindow`). Spend recorded under other feature values, including the legacy `onboarding` value and the shared helper label, is **outside** this check (Q-9).

### 5.2 The comparison, per account

For a window `[S, E)`:

1. **Usage side:** `listCallsInWindow(account, [S − 1 h, E), bosRowFilter(), ceiling 5,000)`.
2. **Charge side:** the account's `kind = 'charge'` rows with effective service `ai` and `created_at` in `[S − 1 h, E + 1 h)`, from the read repository (a new `listChargesForAccountInWindow(userId, window)`, scoped `.eq('user_id', …)`).
3. **Group by `(user_id, group_id)` ↔ `(user_id, session_id)`** (V-10). The one-hour slack on both sides catches an action whose calls and charge straddle an edge (actions are bounded by `maxDuration` ≤ 300 s). Only groups whose **first call** falls in `[S, E)`, or whose charge was written in `[S, E)`, are reported, so a group is reported by exactly one window.
4. **Classify each group** (tolerance `T = calls × 0.0000005 + 1e-9`, because `token_usage` keeps micro-dollars and the charge keeps 10 decimals, V-6):

| Case | Rule | Is it a leak? |
|---|---|---|
| **Matched** | a charge exists and `|usage − charged| ≤ T` | No |
| **Uncharged group** | usage rows, no charge row at all, and the rows carry any tokens or cost | **Yes** — a call outside `runAiAction`, a lost or failed charge write (FR-16), or calls left out of their scope (V-11). Detected by **presence**, not cost, so an embedding-only action recorded at $0 is still found |
| **No-spend group** | usage rows, no charge, zero tokens and zero cost (e.g. the plan-cache marker row) | No — shown as informational |
| **Ungrouped spend** | Business OS rows with `session_id` NULL | **Yes** — nothing without a grouping id can be charged |
| **Under-charged group** | a charge exists and `usage − charged > T` | **Yes** — calls that finished after the scope closed or carried another group id, or one lost charge inside a reused group (onboarding and chat reuse a group id across turns, SA-B1) |
| **Pending reconciliation** | `charged − usage > T` and a charge in the group is fallback-priced | **No** (SQ-13 (3)); listed with the fallback rows |
| **Charged above recorded usage** | `charged − usage > T`, nothing fallback-priced | No — informational (a `token_usage` insert that failed and was logged, V-7) |

A group of an account read that hit its ceiling makes the account **"incomplete"**, never "clean". An account whose read failed is **"could not check"**, never "clean".

**Accepted blind spots (stated in the output, not hidden):** a lost charge worth less than a micro-dollar inside a reused group (invisible by cost, and the group has other charges); spend that never reached `token_usage` (a freeze mid-call, V-7; the chat path that calls the provider directly, noted in the ledger-check route header); spend under non-Business-OS feature values (Q-9).

### 5.3 The check function

`lib/business-os/credits/creditLeakCheck.ts`:

- `classifyLeakGroups(usageRows, chargeRows, window)` — **pure**, fully unit-tested (the table above).
- `runCreditLeakCheck({ window, accountId?, deadlineAt }, deps)` — walks the Business OS accounts (`pagePlans`, 500 per page), one account at a time, and stops **starting** accounts at the deadline, returning `accountsRemaining` (the `insight-detect` `RUN_BUDGET_MS` pattern). Returns, per account with any finding: account, period (from the charges, else the plan anchor), counts and USD per case, and at most 20 example group ids per case for the drill-down (group id → `token_usage.session_id`, SQ-15). Never throws.
- Logs: one `error` **`bos_credit_leak_found`** per leaking account `{ accountId, windowStart, windowEnd, unchargedGroups, ungroupedCalls, underchargedGroups, unchargedCostUsd }` (no owner text, ids and numbers only), and one `info` **`bos_credit_leak_check_completed`** summary.

### 5.4 The two doors

| Door | Path | Auth | Window |
|---|---|---|---|
| **On demand** | `GET /api/admin/business-os/credits/leak-check?from=&to=[&accountId=]`, and a "Run leak check" button on the Costs & credits tab | `requireAdmin` first statement; Zod strict; window ≤ 31 days; `maxDuration = 60`, check deadline 45 s | chosen by the admin (default: yesterday UTC) |
| **Nightly** | `GET /api/cron/credit-leak-check`, `export const GET = withCronRunRecord('credit-leak-check', runJob)`, `vercel.json` schedule `45 4 * * *` (after the 03:30 insight run and its charges) | **Fail-closed** `CRON_SECRET` bearer check copied from `payment-reminders` (a missing secret in production refuses with 401 and an `error` log) | the previous UTC day |

The cron registry entry records counts only, no money (V-17): `accountsChecked`, `accountsWithLeak`, `unchargedGroups`, `ungroupedCalls`, `underchargedGroups`, `pendingReconciliation`, `accountsIncomplete`, `accountsRemaining`; "partly done" when `accountsRemaining ≥ 1` or `accountsIncomplete ≥ 1`. The jobs page then shows the run, its counts and whether it is late or stopped, with no new UI.

The job **drains no table and writes nothing**, so the §8.1 claim pattern does not apply (requirement N-7); two overlapping runs are harmless.

### 5.5 The trade-off, for the record

| | On demand only | Nightly only | **Both (proposed)** |
|---|---|---|---|
| Runs without `CRON_SECRET` | Yes | No (fail-closed, dormant) | Yes, on demand |
| Tells you without anyone looking | No | Yes, via the jobs page tiles and `error` logs | Yes, when the secret is set |
| History | None | `bos_cron_runs` counts + logs | Same |
| Extra cost | — | One route, one registry entry, one `vercel.json` line | Same |

If `CRON_SECRET` is **not** in fact set (F-1), "both" degrades cleanly to "on demand", the cron's first attempt is refused, and the jobs page shows the job as "stopped", which is itself the signal.

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
| `lib/business-os/credits/creditLeakCheck.ts` | create | Pure classifier + runner (§5.3) |
| `lib/business-os/credits/__tests__/creditLeakCheck.test.ts` | create | Every case of §5.2, AC-31 fixture |
| `lib/repositories/BusinessOsCreditLedgerReadRepository.ts` (+ test) | modify | `listChargesForAccountInWindow` |
| `app/api/admin/business-os/credits/leak-check/route.ts` (+ test) | create | On-demand door |
| `app/api/cron/credit-leak-check/route.ts` (+ test) | create | Nightly door |
| `lib/cron/bosCronJobs.ts`, `lib/cron/__tests__/bosCronJobs.test.ts` | modify | Job id, schedule, counts, time limit |
| `vercel.json` | modify | `/api/cron/credit-leak-check` at `45 4 * * *` |
| `app/admin/business-os-llm/components/costs/LeakCheckPanel.tsx` (+ render test) | create | Button and result |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | Route row |

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

- ⬜ **T4b.1** `classifyLeakGroups` + tests (§5.2 table, one test per case, the tolerance edge, the shared insight run id across two accounts, a reused onboarding group).
- ⬜ **T4b.2** `listChargesForAccountInWindow` + test; `runCreditLeakCheck` + tests (deadline, one account's read failing, ceiling → incomplete).
- ⬜ **T4b.3** On-demand route + tests; panel + render test.
- ⬜ **T4b.4** Cron route (fail-closed) + tests; `bosCronJobs.ts` entry; `vercel.json`; `bosCronJobs.test.ts` green.
- ⬜ **T4b.5** AC-31 evidence (§10.2) and a first real on-demand run on production data by the user (read-only), pasted here.
- ⬜ **T4b.6** Gates, docs, handover.

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
