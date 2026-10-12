# Requirement: Business OS Finance & Business Health (admin page)

> **Last Updated**: 2026-10-11

**Created by:** BA
**Date:** 2026-10-09
**Status:** **Draft. SA review: APPROVED WITH CONDITIONS (2026-10-09); BA has applied SA-F1 to SA-F14 and the SA-Q1 to SA-Q12 rulings; SA re-check passed 2026-10-09 (SA-RC): cleared for the slice 1a workplan.** The user accepted every proposed default for BQ-1 to BQ-12 on 2026-10-09 (§0.2, BD-1 to BD-12). No business question is open. Slice 1 is split into **1a** and **1b** (SA-F3). Slice 1a implemented, SA code review approved, QA passed, user approved the diff 2026-10-10; RM commit + PR next. **Slice 2 (§11A):** SA requirement review APPROVED WITH CONDITIONS 2026-10-11 (SA-RR-2); BA applied findings S2-F1 to S2-F9 and the SA-Q13 to SA-Q19 rulings; the 2a workplan is next.
**Based on:** [BUSINESS_OS_FINANCE_HEALTH_DISCOVERY.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_DISCOVERY.md) (cited as **D**, with section or line) and [BUSINESS_OS_FINANCE_HEALTH_LIVE_SCHEMA.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_LIVE_SCHEMA.md) (cited as **LS**; authoritative over migrations wherever they differ).
**Related:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) (P-3b.2, P-5, P-6a/b, P-8a/b; AM-10 "revenue by month" is this page), [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md), [BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md), [ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md](/docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md), [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md), [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md).

## Overview

A read-only, admin-only page that answers "how is the Business OS business doing this month?" in one place. At the top, a strip of red / amber / grey KPI tiles in the style of the `/admin` Health page; below it, six sections: customers by plan, revenue, AI cost against revenue (margin), credits, the growth funnel, and payment problems. The page only reports what the database actually holds. Where a number cannot be produced yet (platform revenue is zero until plan billing and boosts go live), it says so and why, instead of drawing a $0 chart. It is built in small numbered slices; **slice 1 (split into 1a and 1b) uses only data that has real rows today** (accounts, AI cost, credits) and needs no migration, but it does add new read-only repository methods (§10.8).

This document is the feature's **single source of truth**: every slice decision, SA ruling, PR and deferral is recorded here (§0).

---

## Table of Contents

0. [Status, decisions and rulings](#0-status-decisions-and-rulings)
1. [Goals and non-goals](#1-goals-and-non-goals)
2. [User stories](#2-user-stories)
3. [Access and security](#3-access-and-security)
4. [Shared admin page layout standard (SA-approved with amendments)](#4-shared-admin-page-layout-standard-sa-approved-with-amendments)
5. [Menu placement](#5-menu-placement)
6. [Cross-cutting rules](#6-cross-cutting-rules)
7. [KPI strip](#7-kpi-strip)
8. [The six sections](#8-the-six-sections)
9. [Slice plan](#9-slice-plan)
10. [Slices 1a and 1b: full specification](#10-slices-1a-and-1b-full-specification)
11. [Slices 1a and 1b: acceptance criteria](#11-slices-1a-and-1b-acceptance-criteria)
    - [11A. Slice 2 (2a and 2b): full specification and acceptance criteria](#11a-slice-2-2a-and-2b-full-specification-and-acceptance-criteria)
12. [Testing and CI guards](#12-testing-and-ci-guards)
13. [Read-only SQL cross-checks for slice 1](#13-read-only-sql-cross-checks-for-slice-1)
14. [Open questions for SA](#14-open-questions-for-sa)
15. [Out of scope / future roadmap](#15-out-of-scope--future-roadmap)
16. [Notes on integration points](#16-notes-on-integration-points)
17. [Change History](#change-history)

---

## 0. Status, decisions and rulings

### 0.1 Slice status

| Slice | Title | Data dependency | Status | Workplan | PR |
|---|---|---|---|---|---|
| 1a | Page, menu, filter bar (URL), tiles K-1 / K-3 / K-5, "Platform revenue: none yet" panel, Section 1 accounts by plan, Section 3 AI cost | None (real rows today); **no migration**; new reads R-a, R-c, R-c′, R-d (§10.8) | ✅ **Merged PR #284 (2026-10-10); user manual QA L-1..L-13 owed** (merge `5a6fff13`; committed `946653a1`; SA code review APPROVED (SA-CR-1a), QA PASS WITH ISSUES, fix round 1 applied; [retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_RETROSPECTIVE.md)) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md) | [#284](https://github.com/AgentsPilot/neuronforge/pull/284) |
| 1b | Section 4 credits, tiles K-2 / K-4, SA-Q7 refactor | Slice 1a; **no migration**; new read R-b (§10.8) | ✅ **Merged PR #290 (2026-10-11); user manual QA L-14..L-22 owed** (branch `feature/bos-finance-health-1b`, committed `1f46bcb3`; user approved diff 2026-10-11; TL retrospective done; SA code review APPROVED (SA-CR-1b), QA PASS WITH ISSUES, fix round 1 applied; user manual QA L-14..L-22 owed; [retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_RETROSPECTIVE.md)) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_WORKPLAN.md) | [#290](https://github.com/AgentsPilot/neuronforge/pull/290) |
| 2 | Business takings and client payment problems (layer B); currency-grouping helper (CUR-1, CUR-2, AC-13) | None (real rows today); **no migration**; new reads R-e to R-i (§11A.7) plus the reused reminder read R-j; SA-Q9 resolved by BD-13; split **2a** (takings) and **2b** (client payment problems) | ⬜ **2a implemented (uncommitted); SA code review APPROVED (SA-CR-2a), QA PASS WITH ISSUES (no bugs), fix round 1 applied; user approved diff 2026-10-12; TL retrospective done; committed `502e5d5d` on `feature/bos-finance-health-2`, PR [#312](https://github.com/AgentsPilot/neuronforge/pull/312) opened 2026-10-12, merge pending; user manual QA L-23..L-31 owed. 2b next** (§11A; SA rulings SA-Q13 to SA-Q19 and SA-W18 to SA-W27 in §0.3; findings S2-F1 to S2-F9 applied 2026-10-11; workplan-review edits E-8 to E-10 applied 2026-10-11) | 2a: [BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md); 2b: — | — |
| 3 | Growth funnel (invites) | More invite volume to be meaningful; "paid" stage waits on P-5 | ⬜ Not started | — | — |
| 4 | Boost revenue (live, with test-mode switch) | Boost checkout open beyond test accounts (boost slice 5b.1 deployed + flag); new admin read on the boost repository | ⬜ Not started | — | — |
| 5 | Plan revenue, MRR, paying vs comped, trial-to-paid | P-3b.2 (webhook writer), P-8a (MRR definition), P-5 (`first_paid_at` writer) | ⬜ Blocked on dependencies | — | — |
| 6 | AI margin (overall and per current plan) | Slices 4 and 5 | ⬜ Blocked on slices 4, 5 | — | — |
| 7 | Platform payment problems and churn | P-6a, P-6b, P-8b | ⬜ Blocked on dependencies | — | — |
| 8 | History snapshots (plan mix, credits) for trend lines | A migration and a cron (SA) | ⬜ Not started | — | — |

### 0.2 Decisions log

Every business question from discovery §11 was answered on 2026-10-09: **the user accepted the proposed default for each one, exactly as written**.

| # | From | Decision | Date | Source |
|---|---|---|---|---|
| **BD-1** | BQ-1 | "Revenue" is two clearly separate blocks. **"Our revenue"** (owners paying AgentPilot: plans and boosts) is the headline, zero until go-live. **"Takings through the platform"** (clients paying businesses, per currency) is shown as a growth signal and is **never added to ours**. | 2026-10-09 | User accepted proposed default |
| **BD-2** | BQ-2 | "Payment problems" shows **both**, in two labelled blocks. Ours is empty until plan billing goes live. The businesses' block shows failed client plan charges and refunds, and links to Jobs & queues for reminders. | 2026-10-09 | User accepted proposed default |
| **BD-3** | BQ-3 | "Customers by plan" shows **all six groups** (Trial, Founding Partner, Comped, Essentials, Autopilot, Unknown/held) with real counts, including zeros, plus the open-ended and dormant counts. | 2026-10-09 | User accepted proposed default |
| **BD-4** | BQ-4 | An admin-assigned plan with no payment is **not** paying. **Comped** is its own group; "paying" means a live Stripe subscription. | 2026-10-09 | User accepted proposed default |
| **BD-5** | BQ-5 | **Paid churn** = a subscription ended (`ended_at` / `subscription_ended`). "Trial not converted" and "free access ended" are counted separately. | 2026-10-09 | User accepted proposed default |
| **BD-6** | BQ-6 | **"Active after 30 days"** = at least one owner action (an AI action, a booking or an invoice) between day 30 and day 60 after accepting the invite. | 2026-10-09 | User accepted proposed default |
| **BD-7** | BQ-7 | Margin counts **AI cost only**, labelled **"AI margin"**. The Stripe fee on our revenue is shown as a labelled **estimate**, because none is recorded for platform payments. | 2026-10-09 | User accepted proposed default |
| **BD-8** | BQ-8 | Margin per plan may count a whole month under the plan the account is on **now**, with a visible note, until plan history exists. | 2026-10-09 | User accepted proposed default |
| **BD-9** | BQ-9 | "Per month" = **calendar month in UTC** for platform totals. (Credit allowance stays on each account's own credit period; §8.4.) | 2026-10-09 | User accepted proposed default |
| **BD-10** | BQ-10 | Platform money shows **live mode only**, with a labelled **test-mode switch** for demos. | 2026-10-09 | User accepted proposed default |
| **BD-11** | BQ-11 | KPI thresholds: AI cost up **50%** month on month = amber, **doubled** = red; any account over **150%** of allowance = amber; Founding Partners with **no end date** = amber (information); **any** boost or plan dispute = red. Thresholds are **data**, cheap to change. | 2026-10-09 | User accepted proposed default |
| **BD-12** | BQ-12 | The legacy `exchange_rates` table is **never** used for a combined figure. Per-currency totals only; any FX use is a separate future decision for SA and the user. | 2026-10-09 | User accepted proposed default |
| **BD-13** | SA-Q9 (slice 2) | **"Option A. Build slice 2 now. Test and real client payments are shown together, and all data is treated as real for now; no test-mode label and no livemode migration. In the future, test data may be filtered out by business or user."** Layer B (clients paying businesses) therefore shows every recorded client payment, with no test-mode label, no switch and no `livemode` filter, and no migration is added. **This resolves SA-Q9.** BD-10 is unchanged and still governs layer A (platform money). Filtering test businesses or users out later is DF-3. | 2026-10-11 | User decision |

**Log:**
- 2026-10-09 — BA applied SA findings F1–F14; slice 1 split into 1a/1b (SA F3).
- 2026-10-09 — BA applied SA workplan-review edits E-1..E-4 (SEC-3, AC-42, S1-FR-9; L-3, §10.8 R-c′, §12.2 RC-15 pin; AC-26; §8.1 Paying row per SA-W2 option B).
- 2026-10-10 — User reviewed the full slice 1a diff (uncommitted, `feature/bos-finance-health-1a`) and approved it; TL retrospective written; RM to commit, push and open the PR. Manual QA steps L-1 to L-13 (AC-9, AC-10, AC-32) remain owed by the user.
- 2026-10-10 — BA applied SA 1b workplan-review edits E-5..E-7 (§13 check 5 `and l.user_id is not null` + §7.1 K-4 note, SA-W9; §7.1 K-2 inexact and green-eligible cells, SA-WR-8; AC-37 and S1-FR-24 capped plan walk, SA-W11).
- 2026-10-11 — User reviewed the full slice 1b diff (uncommitted, `feature/bos-finance-health-1b`) and approved it; TL retrospective written; RM to commit, push and open the PR. With 1b, slice 1 (1a + 1b) is complete; the next slices depend on data (slice 2: business takings, per currency). Left as-is and surfaced to the user: a zero allowance shows Unknown (as on the Businesses list), and a test hook on the deps type. Manual QA steps L-1 to L-13 (1a) and L-14 to L-22 (1b; AC-11, AC-32) remain owed by the user.
- 2026-10-11 — User decided slice 2 (BD-13, option A): build it now; test and real client payments are shown together and treated as real; no test-mode label and no livemode migration; future filtering by business or user is DF-3. SA-Q9 is resolved by this decision. BA specified slice 2 in §11A from the slice 2 live check ([BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md)), split into **2a** (business takings, about 2.5 days) and **2b** (client payment problems, about 2.5 days); no new KPI tile; new reads R-e to R-i in the finance read repository, reminders through the existing Jobs & queues reader. Awaiting SA review (SA-Q13 to SA-Q19, §14).
- 2026-10-11 — BA applied SA slice 2 findings S2-F1..F9 and the SA-Q13 to SA-Q19 rulings (SA-RR-2): §11A (money at scale 100, refunds by `amount` and dated by `created_at`, date-only `due_date` and new AC-74, no "Deleted business" row, invoice and instalment amount labels, 2 s reminder deadline), §12.1, §12.2 (finance source guard tripped in 2a; guard path and row fixes) and §13 checks 7 to 13 (trimmed currency codes, check 8 comment, check 13 at 690 seconds). Next: the 2a workplan.
- 2026-10-11 — BA applied SA 2a workplan-review edits E-8..E-10 (SA-WP-2a): §13 check 7 gains `counted_payments` and `businesses_counted`, with AC-47 and S2-FR-2 comparing counted payments (E-8, SA-W18); refund-only lines and rows in S2-FR-2, S2-FR-7 and S2-FR-8 (E-9, SA-W19); unreadable amounts and fees in S2-CUR-3, an unreadable fee making the block `partial` (E-10, SA-W20).

### 0.3 SA rulings

| # | Ruling | Date | Affects |
|---|---|---|---|
| **SA-Q1** | **Option (b), with a type-only widening.** A finance rule set lives in its own data file with its own tile vocabulary, `GREEN_ELIGIBLE` set and colouring function. It **reuses `matchCondition` / `firstMatchingRule`** from `lib/admin/health/evaluateHealth.ts`, so the micro-unit rounding and the SA C-2 rule ("a comparison never fires on a lower bound") are never copied. To make that possible, Dev widens the generic bounds of `HealthCondition`, `matchCondition` and `firstMatchingRule` from `MetricId` / `FlagId` to `string`, with Health's types as the defaults. That is a **type-only change: no runtime line in Health changes**, `HEALTH_RULES` / `TILE_VOCABULARY` / `HealthRuleSet` stay closed, and every Health test passes unchanged. Finance validation either takes a vocabulary argument through a widened `validateRuleList` or uses a finance copy of the vocabulary check (Dev's choice; Health behaviour must not change). No new condition kind in slice 1. | 2026-10-09 | §7.2, K-1 to K-5 |
| **SA-Q2** | **A sibling preset module, not an edit of `activityPresets.ts`.** `ACTIVITY_PRESETS` drives the Activity tab's six buttons, so adding presets there changes Activity. The new pure module (`today`, `7d`, `30d`, `this_month`, plus custom) sits beside the shared admin components and uses the same UTC rules. A parity test pins that `today` and `this_month` resolve exactly as Activity's do. `7d` / `30d` = the last 7 / 30 UTC days **including today** (`from = today - 6` / `today - 29`, `to = today`). **The server re-resolves the preset with its own clock**: the URL is input, never authority. **L-4 (URL-held filters) is approved** with the conditions in SA-F11. | 2026-10-09 | §4 L-3, L-4; S1-FR-3, S1-FR-7 |
| **SA-Q3** | **Do not call `buildShadowReport`.** Its static walk also runs `findTenantsMissingPlanRow`, and its output has no per-account basis, which the six groups need. The finance builder runs its own keyset `pagePlans` walk (same page size and ceiling semantics; a cap or error makes Section 1 `partial` / `unknown`). It classifies each row with `deriveLifecycle(fromPlanRow(row), …)`. To keep **one definition** of "no end date" and "dormant Founding Partner", `report.ts` **exports** its `lifecycleInputs` helper and two predicates (open-ended cohort, dormant champion) for both callers. The shadow report's control flow is untouched; `report.test.ts` and `dormantChampions.test.ts` pass unchanged. | 2026-10-09 | §8.1, S1-FR-13, S1-FR-14 |
| **SA-Q4** | **No `token_usage` read in slice 1.** Link to AI cost & usage only (S1-FR-20). A later slice that shows it uses `business_os_usage_summary` or `monthly_token_usage` through `TokenUsageRepository`, side by side and labelled, never added to the ledger figure. | 2026-10-09 | §8.3, AGG-4 |
| **SA-Q5** | **Add the read now**, in the new read-only finance repository (SA-F2), never on `BusinessOsBillingAccountRepository`, which holds writers and has an exact caller list. "Paying" (BD-4) = a `livemode = true` billing row with `subscription_status` in **{`active`, `past_due`}** and `ended_at` NULL. That set is defined **once**, as an exported constant typed against `BusinessOsSubscriptionStatus` in `lib/business-os/billing/`, for P-8a to adopt rather than redefine. It must **not** reuse `LIVE_SUBSCRIPTION_STATUSES` or `R3_LIVE_STATUSES`: those are fail-closed sets for selling and deleting, not a definition of paying. The fallback "Tier set" group is used only when that read fails. | 2026-10-09 | §8.1, S1-FR-15 |
| **SA-Q6** | **No. `listChargesAllAccountsInWindow` is the wrong path.** It returns **one** capped page of at most 100 **charge** rows (`CHARGE_LIST_LIMITS.MAX_LIMIT`), sorted for a list. Summing it would silently stop at 100 rows and drop every adjustment. Slice 1 adds **one new named method** on `BusinessOsCreditLedgerReadRepository`, for example `listRowsOfAllAccountsCreatedInRange`. It returns charges **and** adjustments with `created_at` half-open, paged, de-duplicated by id, with a ceiling, **including** `user_id` NULL rows (the deleted bucket is split in Node, so one read gives one total). It logs at info and uses the existing allow-listed columns. When a business is picked, the existing `listRowsForAccountCreatedInRange` is used. **Ceiling: 20,000** (`MAX_CEILING`), with the `>=` "may be incomplete" rule. | 2026-10-09 | §8.3, S1-FR-17, S1-FR-18 |
| **SA-Q7** | **Neither a sibling copy nor a change to the list's contract: one core, two projections.** Inside `adminCreditPercent.ts`, the existing `computeByAccount` pass becomes the single core and yields `{ allowance, used, trial }` per account. `readAdminCreditsLeft` keeps its exact output type (`AdminCreditsLeft`, no counts) and its tests unchanged (FR-48). A new exported function returns the counts for the finance route only, under the same budget and failure rules. Reasons: the pass already computes `used` and `allowance` internally; a sibling would copy about 80 lines of window and anchor logic that must not drift; and keeping `getSnapshots` and `creditAllowanceForDisplay` in this one file avoids new entries for the account-seam and credit-figures guards. The file's `KNOWN_NON_GATE_IMPORTERS` symbols stay the same. | 2026-10-09 | §8.4, S1-FR-21 to S1-FR-24 |
| **SA-Q8** | **One route** for slice 1, sections read concurrently, each settled on its own (a rejected read gives that section `unknown`, never a 500), returning 200 with per-section status. Split only if a section's p95 crosses 1 s. | 2026-10-09 | S1-FR-7, S1-FR-8 |
| **SA-Q9** | **Deferred to slice 2's workplan**, which must measure live distinct values of `processor_type` / `charge_account_kind` with the `business-os-schema-check` skill before ruling. No layer B read in slice 1. **Resolved 2026-10-11 by user decision BD-13 (§0.2):** the live check found no way to tell test from live layer-B rows; the user chose option A (show test and real client payments together, treat all as real, no test-mode label, no livemode migration; future filter by business or user, DF-3). No SA ruling is needed. | 2026-10-09 | Slice 2 |
| **SA-Q10** | **A named all-accounts read on `BusinessOsCreditLotRepository`** (for example `listLotsWithDrawsAllAccounts`), read-only, with the existing column lists. On its ceiling it **errors** (never a partial list, matching `listLotsWithDraws`). It returns every source; the caller filters `admin_grant` before `extraCreditsAt` (slice 4 reuses it for boost lots). When a business is picked, the existing account-scoped `listLotsWithDraws(accountId)` is used. Not a loop over accounts: that is N+1. The wiring names the repository only through `Pick<…, 'listLotsWithDrawsAllAccounts' \| 'listLotsWithDraws'>` (the `adminCreditPositionDeps` precedent), so no writer is reachable. G3 is updated (SA-F5). | 2026-10-09 | §8.4, K-4 |
| **SA-Q11** | **Confirmed: no audit entry.** Accountability is one `info` line carrying `adminId`, `correlationId`, the validated filters (account id, not name), section statuses, counts and timing (the ai-activity route precedent). | 2026-10-09 | SEC-10, S1-FR-10 |
| **SA-Q12** | **Same elapsed span: accepted** (clamped to the previous month's length, injected `now`). **Base minimum: replaced** by Health's own semantics. K-1 uses `ratioAtLeast` with its `floor` on the **current** figure (USD 1.00, data): a tiny month never fires, and no new grey state is invented. K-1 is grey "Not enough history" (code, not data) **only when the previous span starts before the charging cut-over** (`CHARGING_CUTOVER_FLOOR_MS`). That is true today, because September 1 to 9 predates 2026-09-29, and it would otherwise produce a false "doubled". On a lower bound, Health's SA C-2 and C-18 apply unchanged (SA-F4). | 2026-10-09 | K-1, AC-15, AC-18 |
| **SA-L** | **Layout standard L-1 to L-7: approved with amendments** SA-F11 and SA-F12. | 2026-10-09 | §4 |
| **SA-S** | **Slice 1 is split into 1a and 1b** (SA-F3). No migration and no SQL function in either: **confirmed**. New repository methods are required (SA-F2). | 2026-10-09 | §0.1, §9, §10 |
| **SA-RC** | **2026-10-09 SA re-check: conditions met — cleared for slice 1a workplan.** The SA review section and these rulings are intact word for word. SA-F1 to SA-F14 and SA-Q1 to SA-Q12 are applied in the body: §10.8 R-a to R-d; §10.0 and the §11 AC mapping; §12.2 guard table; §8.1 lifecycle mapping; §7.1 / AGG-3; §4; §13. BD-1 to BD-12 are unchanged. | 2026-10-09 | Whole document |
| **SA-W1** | **Approved (slice 1a workplan review).** With a business picked, Section 1 narrows to that business (six groups shown, Total 1). Plan row via the existing `findEntitlementInputs(accountId)` (no row → 404, error → 500). Its embedded override rows (admin `reason` text) are dropped **in the wiring** and never reach the builder, payload or logs. Paying via the new account-scoped R-c′ `findLiveBillingStatusForAccount`. Zero calls on `pagePlans`, R-a, R-c. R-d (platform-wide head counts, no account, no amount) is the one allowed exception. RC-15 pin = `pagePlans`, `findEntitlementInputs`. Requirement edits E-1 to E-3 (SEC-3, AC-42, S1-FR-9, L-3, §10.8 R-c′, §12.2 RC-15 row, AC-26) are listed in the workplan's SA review, for BA to apply. | 2026-10-09 | SEC-3, S1-FR-9, L-3, §10.8, AC-26, AC-42 |
| **SA-W2** | **Option B. Amends SA-Q5's "typed against `BusinessOsSubscriptionStatus`".** `PAYING_SUBSCRIPTION_STATUSES` is a literal `as const` in `lib/business-os/billing/` with **no** repository import (P-2a M-1 keeps meaning "DB callers only"). A test checks each member against the migration CHECK `business_os_billing_accounts_status_known`. Neither `routerPlacement.guard.test.ts` nor the billing-account caller list is edited. Requirement edit E-4 (§8.1 Paying row) is for BA. | 2026-10-09 | SA-Q5, §8.1 |
| **SA-W3** | **Approved:** export `stateForCohort` from `lifecycle.ts` (keyword only); it is added to `planGroups.ts`'s non-gate symbols. | 2026-10-09 | §8.1 mapping |
| **SA-W4** | **Approved:** a behaviour-preserving extract `validateRuleListAgainst`; `validateRuleList` keeps its signature; no Health test edited. | 2026-10-09 | SA-Q1 |
| **SA-W5** | **Health semantics kept:** an exact $0 previous span with current ≥ the $1.00 floor is red ("new spend"); pinned by a test; any change is a data edit. | 2026-10-09 | K-1 |
| **SA-W6** | **Approved:** for a preset, client `from` / `to` are format-checked (malformed → 400) and their values ignored. | 2026-10-09 | S1-FR-7 |
| **SA-W7** | **Approved:** tiles use the `STATUS_STYLES` labels; the headline carries the finance-specific reason. | 2026-10-09 | L-2 |
| **SA-W8** | **Approved:** `app/admin/components/adminWindowPresets.ts`, pure (no `'use client'`, React or server-only import), imported by the route. | 2026-10-09 | SA-Q2 |
| **SA-WP-1a** | **2026-10-09 SA workplan review (slice 1a): APPROVED WITH CONDITIONS.** Required changes SA-WR-1 to SA-WR-7 are in the workplan; SA checks them at code review. Ledger caller-list citation in §12.2 and the SA review corrected to `:937-976`. | 2026-10-09 | Slice 1a |
| **SA-CR-1a** | **2026-10-09 SA code review (slice 1a): APPROVED, code approved for QA.** SA-WR-1 to SA-WR-7 verified in code. Dev deviations approved: `financeHealthDeps.ts` as a second registered non-gate importer (`getEntitlementConfig` only); a client `page.tsx` behind the layout's `requireAdminPage`, with the route's `requireAdmin` as the real enforcement (authz guard R8); native tables. Three Low, non-blocking findings are in the workplan § SA Code Review. | 2026-10-09 | Slice 1a |
| **SA-W9 to SA-W17** | **Slice 1b workplan rulings, all approved as recommended.** W9: lots of deleted accounts (`user_id` NULL) are left out of K-4 and the gifted column, shown as their own figure, and counted in the window grants; check 5 adds `user_id is not null` (E-5). W10: `FINANCE_METRIC_PARAMS.farOverAllowancePercent = 150`, data, an integer from 100 to 1000. W11: a capped plan walk makes Section 4 `unknown` and K-2 grey, with no positions pass (E-7). W12: the failure matrix; K-4 shows when the totals pass fails. W13: the finance wiring reuses `adminCreditPercentDeps()`; RC-15, the ledger caller list, `enforcementPoints` and N-10 are not tripped (verified). W14: lots are mapped narrow in the wiring, so admin text never travels. W15: 200 displayed rows. W16: a separate names call. W17: % used in tenths, rounded down. | 2026-10-10 | §7.1, §8.4, §13 check 5, AC-37, S1-FR-24 |
| **SA-WP-1b** | **2026-10-10 SA workplan review (slice 1b): APPROVED WITH CONDITIONS.** Required changes SA-WR-8 to SA-WR-13 are in the workplan. SA-WR-8: K-2 is a lower bound when any account is Unknown, so it is never green then (E-6). BA applies E-5 to E-7 (exact text in the workplan's SA review). | 2026-10-10 | Slice 1b |
| **SA-CR-1b** | **2026-10-10 SA code review (slice 1b): APPROVED, code approved for QA.** SA-WR-8 to SA-WR-13 and SA-W14 verified in code. Dev deviations D-1 to D-4 approved: four G3 entries; gifted figures at section level so K-4 survives a failed pass; the `credit…` count prefix; `accountsNotListed` null without the account list. The SA-Q7 refactor leaves the Businesses list unchanged (its tests unedited, `git diff --exit-code` = 0). R-b errors at its ceiling, and AC-42 holds. Two optional Low notes are in the workplan. | 2026-10-10 | Slice 1b |
| **SA-Q13** | **Scale 100 (two decimal places):** every layer-B money column is DECIMAL(10,2) or NUMERIC(12,2). Each value is converted once with `Math.round(n * 100)`. It is unreadable when it is not finite or not a whole number of hundredths, and unreadable values are counted. Refunds use `amount`, not `amount_minor`. | 2026-10-11 | S2-CUR-3, S2-FR-3, check 8 |
| **SA-Q14** | **Reuse `readQueueFiguresAllAccounts`, approved.** The route binds the context and the queue id and injects a structural `readReminderFigures(now, signal)` (the health-summary precedent). Finance `lib/` names neither the repository nor its constants. It runs under `underDeadline` with an explicit 2 s finance deadline, shows plain figures with no colour plus the link, and is not called with a business picked. | 2026-10-11 | S2-FR-20, S2-FR-21, AC-61, AC-67 |
| **SA-Q15** | **Confirmed.** Keyset on `id`, page 1,000, ceiling 5,000, returning rows plus `reachedCeiling` ("at least"). `.or()` on a SELECT already runs in production (`AdminJobsQueuesRepository`); the 42703 bug needs UPDATE + `.or()` + `.select()`. The filter string is built only from literal statuses and the validated date. | 2026-10-11 | §11A.7, R-g, R-h |
| **SA-Q16** | **The three Stripe placement guards are not tripped (verified).** None scans the finance read repository; Dev still runs them unchanged. The finance page's own source guard does trip in 2a (S2-F1). | 2026-10-11 | §12.2 |
| **SA-Q17** | **One route.** The SA-Q8 split rule stands (a section whose p95 is over 1 s moves to its own route). QA records `durationMs` in 2a and 2b. | 2026-10-11 | §11A.9 |
| **SA-Q18** | **Confirmed.** The new blocks use the shared parts through the alias. 2b builds `formatUtcDate` (full cycle, R-7; date-only rule S2-F5). The shell adoption is its own UI slice after 2b (DF-4). | 2026-10-11 | S2-FR-13, S2-FR-25, DF-4 |
| **SA-Q19** | **Refunds are dated by `created_at`.** | 2026-10-11 | S2-FR-3 |
| **SA-RR-2** | **2026-10-11 SA requirement review (slice 2): APPROVED WITH CONDITIONS.** Findings S2-F1 to S2-F9: the finance source guard trips in 2a; check 13 uses 690 seconds, not 700; §12.2 path and row fixes; money scale 100 with refunds by `amount`; `due_date` is date-only, adding AC-74; deleted businesses cascade; amount labels; trimmed codes in the SQL; a 2 s reminder deadline. The 2a workplan starts after the BA edits S2-F1 to S2-F4. See "SA Requirement Review — Slice 2 — 2026-10-11". | 2026-10-11 | Slice 2 |
| **SA-W18 to SA-W27** | **Slice 2a workplan rulings, all approved.** W18: every 2a figure is over counted payments (succeeded or refunded), with an exact status match (E-8). W19: lines and rows are the union of counted payments and succeeded refunds (E-9). W20: an unreadable amount makes net Unknown on its line and the block partial; an unreadable fee makes the block partial and never changes net (E-10). W21: processor labels in copy only. W22: `takings.ts` uses structural input types, so the one-caller pin is unchanged. W23: only the `FINANCE_READ_LIMITS` equality is edited. W24: optional page-local badge on `FinanceSection`. W25: Section 3 is unchanged; conversion through `toUnits`. W26: decimal numbers on the wire, safe from integer hundredths. W27: columns confirmed by LC §1. | 2026-10-11 | S2-FR-2, S2-FR-7, S2-FR-8, S2-CUR-3, AC-47, check 7 |
| **SA-WP-2a** | **2026-10-11 SA workplan review (slice 2a): APPROVED WITH CONDITIONS.** Required changes SA-WR-14 to SA-WR-19 are in the workplan. BA applies E-8 to E-10 (exact text in the workplan's SA review) before V-11 and QA. | 2026-10-11 | Slice 2a |
| **SA-CR-2a** | **2026-10-11 SA code review (slice 2a): APPROVED, code approved for QA.** SA-WR-14 to SA-WR-19 verified in code, with planted negative controls on every new rule. Deviations D-1 to D-4 approved. D-1 widens the whole-hundredths tolerance to `max(1e-6, abs(n·100)·4ε)`; it is proven safe because the rounding error is at most about `abs(n·100)·ε` and a third decimal is still caught. Picked business: account-scoped reads only; no cross-currency sum; fees grouped by `fee_currency`; ceiling 5,000 with "At least"; the Businesses list is unchanged. Two optional Low notes are in the workplan. | 2026-10-11 | Slice 2a |

### 0.4 Deferrals and parked items

| # | Item | Why | Date |
|---|---|---|---|
| DF-1 | Currency-grouping helper (CUR-1, CUR-2) and AC-13 moved from slice 1 to **slice 2** | Slice 1 shows only USD AI cost; a helper with no production caller is dead code (SA-F10) | 2026-10-09 |
| DF-2 | "Businesses without a plan row" is **not** shown in slice 1 | A shadow-report fact (`findTenantsMissingPlanRow`); the page links to Plans & entitlements instead (SA-F7) | 2026-10-09 |
| DF-3 | **Filter out test businesses or users (future)** | BD-13: test and real client payments are shown together and all layer-B data is treated as real for now; no test-mode label and no livemode migration. A later slice may let the admin exclude chosen test businesses or users from the layer-B figures. Needs its own business decision on how a business or user is marked as test | 2026-10-11 |
| DF-4 | The finance page **shell** adopts the shared admin layout standard ([ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md)): `AdminPageHeader`, `AdminFilterBar` through `useAdminFilters` (canonical `range` / `account`, with `preset` / `accountId` read as legacy aliases), the shared `KpiStrip` with its cross-page tile mode, and the C-14 registry entry | Not in slice 2: a layout migration is UI-only and must not ride in a data slice (layout standard §3 rules 1, 4 and 5). Slice 2's **new** blocks use the shared components from the start (S2-FR-13). Its own slice, after 2b (SA-Q18) | 2026-10-11 |

---

## 1. Goals and non-goals

### 1.1 Goals

| # | Goal |
|---|---|
| G-1 | One admin page that shows, per calendar month (UTC), the state of the Business OS business: who the customers are, what we earn, what AI costs us, where credits stand, how invites convert, and what is going wrong with payments. |
| G-2 | A KPI strip that turns red or amber only when a data-defined rule is met (BD-11), on the Health page's model. |
| G-3 | **Honesty over completeness.** Every figure states its source; a figure that is a lower bound says "at least"; a figure that cannot be produced says "none yet" or "not available" and why. A missing figure is never shown as zero, and zero is never shown as healthy green when it means "no data". |
| G-4 | Small numbered slices, each a few days, each reusing existing readers (shadow report predicates, credit-percent pass, Health evaluator, Activity patterns). |

### 1.2 Non-goals (v1, all slices unless a slice says otherwise)

| # | Non-goal | Why |
|---|---|---|
| NG-1 | **No writes of any kind.** No money write, no credit write, no plan change, no RPC that writes (e.g. never `business_os_apply_plan_payment`, LS:59). | Read-only reporting page |
| NG-2 | **Admin only.** No owner-facing view. | Platform-level figures |
| NG-3 | **No FX.** Never one total across currencies (BD-12, CLAUDE.md Currency rules). | No FX authority exists |
| NG-4 | **No new money source.** No new revenue table, no Stripe fee column, no Stripe API call from the page. | Platform money writers belong to plan payments / boosts |
| NG-5 | **No legacy agent-platform data** (`user_subscriptions`, `credit_transactions`, `billing_events`, `subscription_invoices`, `boost_pack*`, `exchange_rates`). | LS:26, LS:138-145 |
| NG-6 | No export, no scheduled email report, no alerting beyond the tile colours. | Later, if asked |
| NG-7 | No migration and no new SQL function **in slice 1 (1a and 1b)** (§6.5). New read-only repository **methods** are allowed and listed in §10.8 (SA-F2). | User constraint; data volumes allow it |

---

## 2. User stories

- As a **platform admin**, I want one page that shows this month's AI cost, account mix and credit position, so that I can see the health of the business without opening four admin pages.
- As a **platform admin**, I want red and amber tiles only when a rule I agreed is met, so that colour means something.
- As a **platform admin**, I want "our revenue" and "takings through the platform" kept visibly apart, so that I never mistake the businesses' money for ours.
- As a **platform admin**, I want money grouped by currency, never summed across currencies, so that a USD and an ILS figure are never added up.
- As a **platform admin**, I want the page to say "none yet" when there is no revenue, and "at least" when a figure was cut off, so that I am never misled by a zero or a partial sum.
- As a **platform admin**, I want the date window and the selected business in the URL, so that I can share or reload exactly what I am looking at.
- As a **platform admin**, I want to narrow the page to one business with the same picker the Activity view uses, so that I can check one account's cost and credits quickly.
- As a **platform admin** (slice 2), I want to see how much clients paid the businesses this month, per currency, with refunds and recorded fees, so that I can see whether businesses are actually taking money through the platform.
- As a **platform admin** (slice 2), I want to see overdue client invoices and instalments, client plan cancellations and the health of payment reminders, so that I can spot businesses whose clients are not paying, without opening each business.

---

## 3. Access and security

| # | Requirement | Source |
|---|---|---|
| SEC-1 | Every route the page calls gates with **`requireAdmin` as the first statement of the handler**. A hand-rolled `AdminAccessService` call fails the required CI guard. Never `profiles.role` or `app_metadata.role`. | CLAUDE.md Security Rules; [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) |
| SEC-2 | The page gates with **`requireAdminPage`** (the admin layout already applies it; D §9, `ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md:117`). The page must not render any figure before the gate. | D §9 |
| SEC-3 | **Cross-account reads use the service role through named all-accounts repository methods** (never by omitting an account argument), each documenting in the repository header why RLS is bypassed (CLAUDE.md rule 4; D X-6; `BusinessOsCreditLedgerReadRepository.ts:41-65`). The new methods are listed in §10.8. **A `tenant-isolation-guard` review is required** on the workplan and on the code review. The only caller-supplied id is `accountId`: it is validated as a UUID, checked against the plan table via `findEntitlementInputs(accountId)`, whose override rows are dropped in the wiring and never used (404 otherwise), and then **every** account-scoped read receives exactly that id; when it is present, **no** all-accounts method is called (R-d, a platform-wide head count that reads no account and no amount, is the one deliberate exception). Names are looked up only for ids taken from rows already read. | CLAUDE.md Security Rules; SA security review |
| SEC-4 | Any import from `lib/business-os/entitlements/` (type-only included) **must be registered** as an importer, per the `business-os-entitlements` skill. Slice 1a imports `deriveLifecycle`, `fromPlanRow`, the config getter and the `report.ts` predicates and registers as a **non-gate importer** (display only, refuses nothing). `adminCreditPercent.ts`'s existing entry stays the same (SA-Q7). Exact entries: §12.2. | CLAUDE.md Key Documentation; D X-7 |
| SEC-5 | Admin identity reads (business names) may be called only from `app/api/admin/**` (repository guard `adminReadMethods`; `creditReport.ts:11-15`). Names are looked up by the route and injected into the service. | Existing guard |
| SEC-6 | All inputs validated by a strict Zod schema before any read; unknown parameters refused with 400. A **repeated query key** is refused with 400 **before** Zod (ai-activity route precedent). | CLAUDE.md rule 2; SA security review |
| SEC-7 | Error responses use the standard format; `details` only when `NODE_ENV === 'development'`. An unexpected throw returns 500 in that format. | CLAUDE.md Error Response Format |
| SEC-8 | Logs carry counts, timings and outcomes only, **never a per-account money or credit figure** and never an email (the `adminCreditPercent.ts:286` rule). Pino via `createLogger`, child logger with `correlationId`. | CLAUDE.md rule 3 |
| SEC-9 | **Every** response, success and error, is `Cache-Control: no-store`. | Financial data |
| SEC-10 | No audit entry is written for reading the page (**confirmed, SA-Q11**). Accountability is one `info` line carrying `adminId`, `correlationId`, the validated filters (account id, never a name), section statuses, counts and timing. | Precedent; SA-Q11 |

---

## 4. Shared admin page layout standard (SA-approved with amendments)

**Status: approved by SA with amendments SA-F11 and SA-F12 (SA-L).** No shared admin page standard exists today: the IA rules cover only the landing and naming (`ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md:125-130`). Two admin pages already **read** filters from the URL (`app/admin/audit-trail/page.tsx:124`, `filtersFromUrl`; `app/admin/analytics/linkedWindow.ts`), while the Activity tab keeps its filters in component state (`ActivityTab.tsx:21-23, 85-87`). What is new here is **writing** filters back to the URL (two-way sync). This page is the first place the standard is used; it is kept minimal so other admin pages can adopt it later without a rewrite, and nothing here obliges an existing page to change.

| # | Element | Rule | Reuses / justification |
|---|---|---|---|
| L-1 | **Header** | Page title + one sentence saying what the page answers. | The sidebar's description line already does this (`AdminSidebar.tsx:86-93`) |
| L-2 | **KPI strip** | One row of tiles directly under the header. Each tile: label, value, a text state ("Needs attention", "Watch", "No data yet") **as well as** the colour, and a one-line reason when red or amber. Colours only red, amber, grey and (where eligible) green. | Health's evaluator (`lib/admin/health/rules.ts:5-21`, `evaluateHealth.ts:1-29`, per SA-Q1) and `STATUS_STYLES` from `app/admin/components/health/HealthTile.tsx` (`HealthTile` itself is typed on Health's tile ids and is not reused) |
| L-3 | **One filter bar** | Date presets **Today / 7d / 30d / This month / Custom** (UTC; Custom capped at **92 inclusive days**, `from` to `to`), and the **`BusinessAccountPicker`** ("All businesses" by default). `7d` / `30d` = the last 7 / 30 UTC days including today. Every filter applies to every section that is time- or account-sensitive; Section 1 ('accounts now') ignores the date window but narrows to a picked business; its subtitle says which. | A **sibling pure preset module** beside the shared admin components (SA-Q2), with a parity test pinning `today` and `this_month` to `activityPresets.ts`; `activityPresets.ts` is not edited. `BusinessAccountPicker` (`ActivityFilters.tsx:17-20`); the 92-day cap is `CREDIT_REPORT_LIMITS.MAX_WINDOW_DAYS` (`creditReport.ts:71`), inclusive days as there |
| L-4 | **Filters live in the URL** (`?preset=this_month&from=&to=&accountId=`), read **and written back**. Reload and shared links reproduce the view. Invalid URL values fall back to the default and show a small notice; they never crash the page. **Conditions (SA-F11):** (1) one pure `parse` / `serialise` module with unit tests (invalid value → default plus notice; unknown key dropped); (2) `useSearchParams` inside a Suspense boundary (Next 14, as both precedents do); (3) `router.replace(…, { scroll: false })`, not `push`; (4) only ids and enums in the URL, never a business name; (5) the server re-validates everything with the strict Zod schema, so the URL is never trusted, and for a preset the server ignores any client `from` / `to` and resolves its own window; (6) the account param is named **`accountId`** (the Activity route's and the picker's precedent). | Reading from the URL has precedent (audit-trail, analytics); two-way sync is the new part, approved by SA (SA-Q2). Justification: an admin needs to send "this is what I saw" to another admin |
| L-5 | **Sections** below the filter bar, each with a heading, a subtitle naming its source and window, and its own status (loaded / could not load / partial "at least"). One section failing never blanks the page. | `CreditReportSectionStatus` pattern (`creditReport.ts:58-68`) |
| L-6 | **Components:** reuse existing admin components where they fit (`STATUS_STYLES`, `BusinessAccountPicker`, `CutoverNotice`, `cutoverClamp`); a new table uses `components/ui` primitives. Activity's `ActivityTable` is shaped for charge rows and is **not** reused for plan or credit tables (SA-F12). | Existing admin components; `components/ui` |
| L-7 | Times and month boundaries shown **in UTC, labelled "UTC"**. | `activityPresets.ts:1-7`; BD-9 |

**Slice 2 note (2026-10-11).** The shared admin layout standard ([ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md)) is now on main and supersedes L-1 to L-7 for new work. Slice 2's new blocks follow it (S2-FR-13, S2-FR-25): the shared status chip, table constants, notices, empty states and formatters from `app/admin/components/layout/`. The page shell (header, filter bar, URL names, KPI strip) moves to the standard in its own slice (DF-4); until then L-1 to L-7 above describe the shell as built.

---

## 5. Menu placement

A new item in the **Monitor** group of `app/admin/components/AdminSidebar.tsx` (`:82-120`), directly **after Health** (D §9):

| Field | Proposed value |
|---|---|
| name | `Finance` |
| href | `/admin/finance` |
| description | `Revenue, AI cost and credits, Business OS` |
| icon | A lucide icon already imported by the sidebar or one new import (Dev's choice) |

The nav test (`app/admin/components/__tests__/AdminSidebar.nav.test.ts`, pinned at `AdminSidebar.tsx:78-80`) is updated to include the entry. The page inherits `requireAdminPage` from the admin layout (D §9). Delivered in slice 1a.

---

## 6. Cross-cutting rules

### 6.1 Two money layers, never mixed

| Layer | Meaning | Rule |
|---|---|---|
| **A: Our revenue** | Owners paying AgentPilot (plans, boosts) | Headline revenue. USD by migration CHECK, but CHECKs are not live-verified (LS:17) and casing differs (`'usd'` plan events, `'USD'` boosts; D §2.1), so code still groups by currency after normalising case. |
| **B: Takings through the platform** | Clients paying the businesses (Stripe Connect) | A growth signal only (BD-1). USD and ILS live today (LS:122). |

Layers A and B never share a total, a chart axis or a tile (D X-1).

### 6.2 Currency

| # | Rule |
|---|---|
| CUR-1 | **Every money figure travels with its currency.** One pure helper groups amounts by currency and returns one line per currency; there is no function that returns a single cross-currency total. **The helper is built in slice 2**, its first real caller (SA-F10, DF-1); slice 1 shows only USD AI cost and labels it USD. |
| CUR-2 | Currency codes are normalised to upper case before grouping. A NULL or unrecognised currency goes to its own **"unknown currency"** line; it is never assumed to be USD. (Slice 2, with CUR-1.) |
| CUR-3 | No FX, ever, in this feature (BD-12). `exchange_rates` is never read. |
| CUR-4 | For layer B, the currency is the row's own `currency` column (the transaction's), consistent with "`scheduling_services.currency` is the authority for what a client is charged". `business_profiles.currency` is not used to relabel anything (CLAUDE.md). |
| CUR-5 | AI cost (`cost_usd`) is our measured provider cost in USD by definition of the column; it is labelled USD. From slice 2 on it passes through the CUR-1 helper as USD wherever it is shown beside other money. |

### 6.3 Timezone

| # | Rule |
|---|---|
| TZ-1 | Platform months are **calendar months in UTC** (BD-9). Presets resolve in UTC (sibling preset module, SA-Q2). The UI labels windows "UTC". Window bounds are half-open whole-day instants (`windowInstants`, the microsecond rule in the ledger repository header). |
| TZ-2 | `user_preferences.timezone` (each business's clock) is **not** used for platform totals: this page aggregates many businesses, and a per-business clock would make month boundaries differ per row. `business_profiles.timezone` does not exist and must never be selected (CLAUDE.md; LS:115). |
| TZ-3 | Credit allowance against usage uses **each account's own credit period** (anniversary-based, D §5.3), labelled as such; it is not forced into a calendar month. |

### 6.4 Test and live money

Platform money filters on `livemode` (PF-15, `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md:102`). Default **live only**; a labelled **test-mode switch** shows test rows instead, never mixed with live (BD-10). Applies from slice 4; slice 1a's revenue panel only checks whether live rows exist (§10.6), and the paying read (SA-Q5) filters `livemode = true` in the query.

**Layer B (slice 2, BD-13):** client payments have no `livemode` column and cannot be told apart from test rows (live check §2). By the user's decision they are shown **together and treated as real**, with **no test-mode label, no switch and no `livemode` filter**, and no migration. Filtering test businesses or users is a future item (DF-3). BD-10 above still governs layer A.

### 6.5 Aggregation rules

| # | Rule | Source |
|---|---|---|
| AGG-1 | **PostgREST aggregate functions are disabled in production (PGRST123).** No `.select('sum(...)')` or similar. A row count via `{ count: 'exact', head: true }` is not an aggregate function and is allowed. | Production behaviour |
| AGG-2 | Business OS finance tables (all under 300 rows, LS:174-176) are read with **bounded, paged reads summed in Node**, with an explicit **ceiling**. Sums are exact integers in the column's own scale (credits 6 dp, cost 10 dp), the `creditReport.ts:28-35` method. | D X-4 |
| AGG-3 | **When a read reaches its ceiling** (the `>=` "may be incomplete" rule), the figure is shown as **"at least X"** with a visible note and the section status is "partial". A tile built on it follows Health's rules **unchanged**: a comparison rule never fires on an inexact figure (SA C-2); an inexact tile with no rule matched is **amber "Total is a minimum"** (SA C-18); it is never green. Exceptions where a partial figure is not allowed at all are stated per read (credit totals and lots: §8.4). | `evaluateHealth.ts:279-292, 500-506`; SA-F4 |
| AGG-4 | `token_usage` (about 29.6k rows, growing about 5k a month) is **never scanned raw**. Only through `monthly_token_usage` / `daily_token_usage` or `business_os_usage_summary(p_since, p_user_id)` (LS:87-95, LS:176), and not at all in slice 1 (SA-Q4). | D X-4 |
| AGG-5 | **No new SQL function, view or migration in slice 1 (1a and 1b)** (confirmed, SA-S). If a later slice outgrows bounded reads, the scale path is an SA decision (an aggregate RPC, as `creditReport.ts` R-3 foresees). | User constraint |
| AGG-6 | Never group or filter on the raw `service` column of the credit ledger; effective fields via `resolveEffectiveFields` (N-10; `serviceColumn.guard.test.ts`). | Existing guard |

### 6.6 Honest indicators (all sections)

| Indicator | When |
|---|---|
| **"None yet"** + reason | A source table has no qualifying rows because the feature that writes them is not live (e.g. platform revenue). |
| **"0"** | The source is live and genuinely recorded nothing in the window. |
| **"At least X"** | A read hit its ceiling (AGG-3). |
| **"Unknown"** | A read failed or a figure was unreadable. Never shown as 0. |
| **"Not available" + reason** | The number cannot be produced from current data (listed per section in §8). |

---

## 7. KPI strip

### 7.1 Tiles

Rules are data, first match wins, only red or amber are data, green only for code-level eligible tiles (Health's model, `rules.ts:5-21, 116-125, 168`). Thresholds are BD-11. The K-1 `floor` (USD 1.00) is stored in the same rule data, adjustable without code (SA-Q12). Inexact figures follow AGG-3 (SA C-2, C-18).

| Tile | Metric (definition) | Rules (data) | Grey when | Inexact figure | Green-eligible | Slice |
|---|---|---|---|---|---|---|
| **K-1 AI cost this month** | Ledger AI cost for the current UTC month to date, compared with the **same elapsed span of the previous month** (day 1 up to the same day and time, clamped to the previous month's length, injected `now`). Ratio = this / previous. Read through R-a (§10.8). | red: ratio >= 2.0; amber: ratio >= 1.5 (`ratioAtLeast`, with `floor` USD 1.00 on the **current** figure, so a tiny month never fires) | **Only** when the previous span starts before the charging cut-over (`CHARGING_CUTOVER_FLOOR_MS`): "Not enough history" (code, not data). True today. Also when either figure is unreadable ("Unknown") | Ratio rules do not fire; amber "Total is a minimum; not all charges counted"; never green | Yes, when both figures are exact and no rule matched | 1a |
| **K-2 Accounts far over allowance** | Number of accounts whose credits used in their **current credit period** are at least 150% of the period allowance. | amber: count >= 1 (`atLeast`) | Credit pass failed, timed out or reached its ceiling (no partial sum, §8.4) | When any listed account's figure is Unknown (AC-17), the count is a lower bound: the rule still fires at count >= 1; with no match the tile is amber 'N accounts could not be read', never green (AGG-3) | Yes, when the pass was complete and no listed account is Unknown | 1b |
| **K-3 Founding Partners with no end date** | Number of accounts in the Founding Partner group whose cohort has no end date, using the **open-ended cohort predicate exported by `report.ts`** (SA-Q3). With a business picked: whether that business is an open-ended Founding Partner. | amber (information): count >= 1 (`atLeast`) | Plan walk failed | Plan walk at its cap: per AGG-3 | Yes (0) | 1a |
| **K-4 Gifted credits outstanding** | Admin-granted credits minus taken back, over lots not expired now (§8.4). Lots of deleted accounts (`user_id` NULL) are not counted; the page shows them as their own figure (SA-W9). | none (BD-11 sets no threshold) | Lots read failed or reached its ceiling ("Unknown") | Not possible (the lots read errors on its ceiling) | No (informational, grey with value) | 1b |
| **K-5 Our revenue** | Live-mode platform revenue this month. | none in slice 1 | Always in slice 1: "None yet", "Revenue recorded, not yet shown" or "Could not check" (§10.6) | — | No | 1a (grey), 4-5 (values) |
| K-6 Disputes | Open boost or plan disputes. | red: count >= 1 | No live source | — | Yes | 4 (boosts), 7 (plans) |
| K-7 AI margin | AI margin this month | new condition kind "falls below" needed (SA) | No revenue | — | — | 6 |

In slice 1a, **K-2 and K-4 are not rendered** (not placeholders); they appear in 1b. Every tile shows its text state, not colour alone (accessibility).

**Slice 2 adds no tile** (§11A.6): the strip already holds five tiles, the layout standard's maximum; layer B is "not our revenue" and "the businesses' problem, not ours" (BD-1, BD-2); and BD-11 sets no layer-B threshold. A layer-B tile would need its own business decision.

### 7.2 Reuse of the Health evaluator

Per **SA-Q1**: a finance rule set lives in its own data file with its own tile vocabulary, `GREEN_ELIGIBLE` set and colouring function, and **reuses `matchCondition` / `firstMatchingRule`** from `lib/admin/health/evaluateHealth.ts`, so the micro-unit rounding and SA C-2 are never copied. Dev widens the generic bounds of `HealthCondition`, `matchCondition` and `firstMatchingRule` from `MetricId` / `FlagId` to `string`, with Health's types as the defaults. This is a **type-only change: no runtime line in Health changes**, `HEALTH_RULES` / `TILE_VOCABULARY` / `HealthRuleSet` stay closed, and every Health test passes unchanged. Finance validation takes a vocabulary argument through a widened `validateRuleList` or uses a finance copy of the vocabulary check (Dev's choice). The existing condition kinds (`atLeast`, `ratioAtLeast`, `shareAtLeast`, `anyLowerBound`, `flag`; `rules.ts:23-37`) cover K-1 to K-3; **no new condition kind in slice 1**. A test proves that changing a threshold in data changes the colour with no code change.

---

## 8. The six sections

Each section lists its business definition, live-verified source, currency, timezone, honest indicators and what cannot be produced. "Live-verified" columns are per LS:151 (Business OS tables match migrations column for column).

### 8.1 Section 1: Customers by plan

| Aspect | Requirement |
|---|---|
| **Definition** | A **Business OS account** = a row in `business_os_account_plans` (one login = one business today, `AdminSidebar.tsx:125-131`). Each account is in **exactly one** of six groups (BD-3): **Trial**, **Founding Partner**, **Comped**, the **tier groups**, **Unknown/held**. The tier groups are **one group per `config.tierOrder` entry**, labelled from config (today these are shown as Essentials and Autopilot, config tiers `basic` / `pro`, `tierMatrix.ts:71`); finance code contains **no tier string literal** (`tierLiteral.forbidden.test.ts`) and no `'champion'` literal (SA-F6). A tier group counts **paying** accounts only (BD-4, SA-Q5); a tier in force without a paying billing row = **Comped**. Lifecycle comes from `deriveLifecycle(fromPlanRow(row), …)` (`lifecycle.ts:132-258`), never a stored status (there is none, D §3.1). The group is chosen by the mapping table below (SA-F7). |
| **Founding Partner rules** | Founding Partner = lifecycle state `champion`. "No end date" and "dormant" come from the **predicates exported by `report.ts`** (open-ended cohort, dormant champion) together with its exported `lifecycleInputs` helper (SA-Q3), so there is one definition for the shadow report and this page. |
| **Paying (BD-4)** | A `livemode = true` row in `business_os_billing_accounts` with `subscription_status` in **{`active`, `past_due`}** and `ended_at` NULL. The set is one exported constant in `lib/business-os/billing/`, a literal `as const` whose members a test checks against the migration's `business_os_billing_accounts_status_known` CHECK list (SA-W2: no repository import in `lib/business-os/billing/`), for P-8a to adopt; it must **not** reuse `LIVE_SUBSCRIPTION_STATUSES` or `R3_LIVE_STATUSES` (SA-Q5). Read through the new read-only finance repository (R-c, §10.8). |
| **Also shown** | Lifecycle state counts (`byState`); Founding Partners with no end date; dormant Founding Partners; grace and past-due counts beside their group; new accounts in the window, split by `origin` (backfill rows are labelled "backfilled", because their `created_at` is the backfill date, not a signup); accounts whose cohort, tier or trial ends in the next 30 days. |
| **Source (live)** | `business_os_account_plans`: `user_id`, `tier`, `tier_expires_at`, `cohort`, `cohort_expires_at`, trial / grace pins, `origin`, `created_at` (LS:49-54), read by the finance builder's own keyset `pagePlans` walk (same page size and ceiling as the shadow report; **`buildShadowReport` is not called**, SA-Q3). Live: 8 rows, all `champion`, `tier` NULL. Paying status: `business_os_billing_accounts` (`livemode`, `subscription_status`, `ended_at`; 0 rows, LS:34-43) via R-c. |
| **Currency** | None (counts). |
| **Timezone** | "Now" counts are as of the request; "new in window" uses UTC window bounds. |
| **Honest indicators** | All six groups always shown, zeros included (BD-3). Plan walk error → Section 1 `unknown`; plan walk at its cap → Section 1 `partial`, counts shown as "at least". **Only if the paying read (R-c) fails**, the Comped and tier groups are shown as one "Tier set (paying vs comped not available)" group (SA-Q5). |
| **Not in slice 1** | **Businesses without a plan row** (`findTenantsMissingPlanRow`) are not shown: a shadow-report fact; the section links to Plans & entitlements (SA-F7, DF-2). |
| **Cannot produce** | Churn (no paying accounts; no history for free accounts; D §3.3) → slice 7 / 8. Plan mix at the end of a past month → slice 8. Trial-to-paid → slice 5. |

**Lifecycle → group mapping (SA-F7).** `state` is from `deriveLifecycle` (`LifecycleState`, `types.ts:344`); `basis.kind` is the basis it reports. A tier in force takes precedence over a cohort (`lifecycle.ts:186`), and an expired tier keeps `basis: tier` in grace (`:218-229`). Implemented as one pure function; a test proves the groups sum to Total over every `LifecycleState`.

| `state` | `basis.kind` | Group | Also counted |
|---|---|---|---|
| `trial` | any | Trial | — |
| `champion` | any | Founding Partner | No end date / dormant (report.ts predicates) |
| `active` | tier | That tier's group if paying (SA-Q5); otherwise Comped | — |
| `past_due` | tier | That tier's group if paying; otherwise Comped | "past due" count beside the group |
| `grace` | tier | That tier's group if paying; otherwise Comped | "grace" count beside the group |
| `grace` | cohort | Its cohort group (Founding Partner for the champion cohort) | "grace" count beside the group |
| `paused` | any | Unknown/held | — |
| `unknown` | any | Unknown/held | — |
| any pair not listed above | — | Unknown/held (so the six groups always sum to Total) | — |

### 8.2 Section 2: Revenue

| Aspect | Block A: Our revenue | Block B: Takings through the platform |
|---|---|---|
| **Definition** | Plan revenue: `invoice_paid` billing events, `amount_minor` by `paid_at`, tax (`amount_tax_minor`) shown separately. Boost revenue: `business_os_boost_purchases` paid rows, `amount_total_minor` by `paid_at`, less `amount_refunded_minor`, tax separate. MRR: **P-8a's definition** (`BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md:295`), never a second one. Stripe fee: a labelled **estimate** (BD-7; the boost requirement's assumed 2.9% + $0.30, `BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md:282-290`). | Succeeded client payments per month: `payment_transactions` `amount` by `paid_at`, status succeeded or refunded; refunds from `payment_refunds`; recorded Stripe fees (`processor_fee` in `fee_currency`, present on 46 of 97 rows) with a "fees recorded on N of M payments" note; number of businesses with takings. |
| **Source (live)** | `business_os_billing_events` (0 rows, LS:44-48); `business_os_boost_purchases` (0 rows, LS:65-71). | `payment_transactions` (97: USD 59, ILS 38), `payment_refunds` (34) (LS:122-127). |
| **Currency** | Grouped by normalised currency (CUR-1, CUR-2). | **Grouped by currency, one line per currency, never summed** (CUR-1, BD-12), using the CUR-1 helper built in slice 2. Fees grouped by `fee_currency`. |
| **Timezone** | UTC calendar month (BD-9). | UTC calendar month (BD-9). |
| **Test / live** | Live only, test switch (BD-10). | Layer B rows have no Business OS `livemode` column. **SA-Q9: deferred to slice 2's workplan**, which measures live distinct values of `processor_type` / `charge_account_kind` with the `business-os-schema-check` skill before SA rules. **Resolved 2026-10-11 by BD-13:** shown together with test rows, treated as real, no label, no switch, no filter (DF-3 for the future). |
| **Honest indicators** | Slice 1a: "Platform revenue: none yet" panel (§10.6). | "Not our revenue" label on the block. |
| **Cannot produce** | Net revenue after real Stripe fees (no fee column, LS:168); plan refunds and disputes until P-6b; list price from the DB (LS:171). | One cross-currency total (BD-12); refund fees (columns empty, LS:169). |
| **Slice** | 4 (boosts), 5 (plans, MRR) | 2 |

**Slice 2 note (2026-10-11).** Block B is specified in full in §11A.4 (slice 2a). The live check of 2026-10-11 supersedes the row counts above (`payment_transactions` 110: USD 60, ILS 50; `payment_refunds` 41; fees on 51 of 110, all in USD, including fees on ILS payments), and §11A governs wherever it differs from this table.

### 8.3 Section 3: AI cost against revenue (margin)

| Aspect | Requirement |
|---|---|
| **Definition** | **AI cost** = sum of `cost_usd` over credit-ledger rows created in the window (charges **and** adjustments, net; adjustments placed under the charge they correct for breakdowns, via `resolveEffectiveFields`). **AI margin** (slice 6) = our revenue minus AI cost, per currency of revenue, labelled "AI margin" (BD-7). Per plan: by the plan the account is on **now**, with a note (BD-8). |
| **Breakdowns (slice 1a)** | Total; by trigger (owner / scheduled / external); by current plan group (§8.1, with the BD-8 note); top 10 accounts by cost (business name from the route's admin name lookup); deleted accounts as one bucket (`user_id` NULL rows, **split in Node from the same read**, so one read gives one total). Also credits charged and charge count. |
| **Source (live)** | `business_os_credit_charges` (`cost_usd`, `credits`, `triggered_by`, `kind`, `user_id`, `created_at`; 265 rows, LS:79-81). All businesses: the **new** named all-accounts method on `BusinessOsCreditLedgerReadRepository` (R-a, §10.8; SA-Q6). One business picked: the existing `listRowsForAccountCreatedInRange`. **Not** `listChargesAllAccountsInWindow` (one page of at most 100 charge rows, no adjustments, no deleted accounts; SA-F1) and not `listChargesOfDeletedAccountsInWindow`. |
| **Second measure** | `token_usage` cost is a **different measure** (estimated from model pricing; includes calls not charged). **Not read in slice 1 (SA-Q4)**; the section links to "AI cost & usage" (`/admin/analytics`). A later slice that shows it uses `business_os_usage_summary` or `monthly_token_usage` through `TokenUsageRepository`, side by side and labelled, never added to the ledger figure. |
| **Currency** | USD (CUR-5). |
| **Timezone** | UTC window (TZ-1). Note: the ledger starts at the charging cut-over (D-8); a window that starts before it shows the cut-over notice, and a window entirely before it shows the notice instead of a $0 (`CutoverNotice.tsx:1-9`, `cutoverClamp`). |
| **Honest indicators** | Ceiling 20,000 rows, `>=` rule: "At least USD X", status `partial` (AGG-3); "No AI actions charged in this window" when 0 rows; theoretical per-plan margin from config (e.g. Essentials $79 vs 19,750 credits = $19.75 of cost if every credit is used, D §4.2) may be shown only labelled "configuration, not measured" (slice 6). |
| **Cannot produce** | Real margin (no revenue, D §4.3); cost per business beyond per `user_id` (LS:170); margin per plan over time (no plan history); full cost of goods (email, hosting, fees, uncharged calls). |

### 8.4 Section 4: Credits

| Aspect | Requirement |
|---|---|
| **Definition** | Per account, for its **current credit period** (TZ-3): **allowance** (from the entitlement snapshot, as the owner card shows it), **used** (credits charged in that period; a trial sums every row since its trial anchor), **% used**, **over allowance** (used > allowance; nothing is refused at zero, `ALWAYS_SUFFICIENT`, as-built `:47`). A trial counts its one-off allowance from the trial anchor (the `creditWindowRule` rule). **Gifted outstanding** = admin-granted credits **minus taken back**, over lots not expired now: the one definition, `extraCreditsAt` in `creditLots.ts:5-20`, applied after the caller filters `admin_grant` lots. Also: credits granted and taken back **in the window**, with the granting admin's count. |
| **How it is computed (SA-Q7)** | **One core, two projections.** Inside `adminCreditPercent.ts`, the existing `computeByAccount` pass becomes the single core and yields `{ allowance, used, trial }` per account. `readAdminCreditsLeft` keeps its exact output type (`AdminCreditsLeft`, no counts) and tests unchanged (FR-48). A new exported function returns the counts for the finance route only, under the same 2 s budget and failure rules. No sibling copy. |
| **Source (live)** | Allowance: entitlement snapshots (`getSnapshots`), `creditAllowanceForDisplay`, `creditWindowRule`, all inside `adminCreditPercent.ts`. Used: `business_os_credit_totals` (`user_id`, `period_start`, `credits_total`; 6 rows, LS:82-84) via `listTotalsForAccountsInRange` (selects no cost column; ceiling 5,000). Gifts: `business_os_credit_lots` (`source`, `credits_granted`, `expires_at`, `actor_admin_id`, `created_at`; 1 row) and `business_os_credit_lot_draws` (`kind` `reversal`, `credits`, `lot_id`; 1 row) (LS:85-86), all businesses via the **new** `listLotsWithDrawsAllAccounts` (R-b, §10.8; SA-Q10), one business via the existing `listLotsWithDraws(accountId)`. The wiring names the lot repository only through `Pick<…, 'listLotsWithDrawsAllAccounts' \| 'listLotsWithDraws'>`. No loop over accounts (N+1). |
| **Currency** | None (credits are units, not money). |
| **Timezone** | Credit period per account (TZ-3); "granted in window" in UTC. |
| **Honest indicators** | "Unknown" per account when its snapshot or figure is unreadable; "No allowance" where the plan has none; whole section "unknown" if the totals read fails, times out or hits its ceiling (the `adminCreditPercent.ts:193-194` "never a partial sum" rule, because a per-account percentage cannot be a lower bound). The lots read **errors** on its ceiling (never a partial list): the gifted column and K-4 are "Unknown" and the rest of the section renders. If the plan walk fails, the section is `unknown` (it has no account list). A note that gifted credits are **not consumed yet** (until credit deduction slice 9, `creditLots.ts:18-20`), so "outstanding" is what remains available, not "unused". |
| **Cannot produce** | How much of a gift was used (lots not consumed yet); allowance vs used per **calendar** month; breakdown by tier (no tiers live). Boost lots appear in slice 4 (R-b returns every source; the caller filters). |
| **Slice** | 1b |

### 8.5 Section 5: Growth funnel (invites)

| Aspect | Requirement |
|---|---|
| **Definition** | Stages per invite, counted by the month the invite was **issued**: issued (`created_at`) → email sent (`email_sent_at`) → link opened (`first_viewed_at`; "email opened" is not tracked) → account created (`claimed_at`) → accepted (`redeemed_at`) → active after 30 days (BD-6) → paid (`business_os_account_lineage.first_paid_at`). Split by `issuer_kind` (admin / account). Median time between stages. Failed / revoked / expired shown beside. |
| **Source (live)** | `business_os_invites` (2 rows, LS:101-107); `business_os_account_lineage` (1 row, LS:55-56). BD-6 activity: owner-triggered ledger charges (`triggered_by = 'owner'`), bookings and invoices; SA picks the reads (slice 3). |
| **Currency / timezone** | None / UTC months. |
| **Honest indicators** | Rates hidden below a minimum cohort size (proposed 10 invites), counts only, with "too few invites for a rate". "Paid: not recorded yet" until P-5 writes `first_paid_at`. "Active after 30 days" shows "not yet measurable" for invites accepted less than 60 days ago. |
| **Cannot produce** | Email opens; "paid" before P-5. |
| **Slice** | 3 |

### 8.6 Section 6: Payment problems

| Aspect | Block A: Ours (platform billing) | Block B: The businesses' (client payments) |
|---|---|---|
| **Definition** | Failed plan payments (`invoice_payment_failed`, `payment_action_required`, `failed_attempts`, `last_payment_failed_at`); accounts in grace or paused; boost failed / expired / refunded / disputed; open disputes (K-6); stuck webhook claims (P-8b). | Failed client plan charges (`payment_plan_subscriptions.last_failure_at` in window, `last_failure_code`); instalments with retries (`retry_count > 0`); refunded client payments; a **link** to Jobs & queues for reminders (already measured there and on Health tile 7, `readJobsQueues.ts:1-14`, `rules.ts:311-355`), not a second count. |
| **Source (live)** | `business_os_billing_accounts`, `business_os_billing_events`, `business_os_boost_purchases` (0 rows each). | `payment_plan_subscriptions` (6), `payment_plan_installments` (51), `payment_transactions` / `payment_refunds` (LS:122-134). |
| **Currency** | Grouped by currency (CUR-1). | Grouped by currency (CUR-1); never summed. |
| **Honest indicators** | "None yet: plan billing is not live" until P-6a. | "The businesses' problem, not ours" label (BD-2). |
| **Cannot produce** | Anything before P-6a / P-6b / P-8b. | Refund fees. |
| **Slice** | 7 (plans), 4 (boost problems) | 2 |

**Slice 2 note (2026-10-11).** Block B is specified in full in §11A.5 (slice 2b), and §11A governs wherever it differs from this table. The live check found that **failed client charges are never stored** (`payment_transactions` statuses are only `succeeded` and `refunded`; `failure_reason`, `last_failure_at`, `last_failure_code` and the retry fields are empty everywhere), so "failed client payments" and "failed client plan charges" are shown as **not available, with the reason**, never as 0. Slice 2b adds overdue invoices and instalments (as of now), client plan cancellations, and a reminder health summary that reuses the Jobs & queues reader and links there.

---

## 9. Slice plan

Small numbered slices of a few days each, reusing existing infrastructure. Each slice gets its own Dev workplan, SA review, QA and PR, recorded in §0.1.

| Slice | Scope (few days each) | Depends on | Migration? |
|---|---|---|---|
| **1a** | Page, menu entry, layout standard (§4) with the filter bar and two-way URL sync, one admin route; KPI tiles **K-1, K-3, K-5**; "Platform revenue: none yet" panel; **Section 1** (accounts by plan); **Section 3** AI cost (no margin); new reads **R-a, R-c, R-c′, R-d** (§10.8); the SA-Q1 type widening; `report.ts` exports (SA-Q3); paying-status constant (SA-Q5). K-2 and K-4 are not rendered. About 3 to 4 days, demoable alone. Specified in §10-§11. | Nothing new | **No** |
| **1b** | **Section 4** credits; tiles **K-2, K-4**; new read **R-b** (§10.8); the SA-Q7 refactor of `adminCreditPercent.ts`; the G3 and lot-repository caller-list updates. About 3 to 4 days, demoable alone. Specified in §10-§11. | Slice 1a | **No** |
| **2** | Section 2 block B (takings per month per currency, refunds, recorded fees, businesses with takings) and Section 6 block B (failed client plan charges, retries, refunds, link to reminders); the currency-grouping helper CUR-1 / CUR-2 and AC-13 (moved from slice 1, SA-F10). **Specified in §11A (2026-10-11) and split: 2a** takings (CUR-1 / CUR-2 helper, R-e, R-f, Section 2 block B; about 2.5 days) and **2b** client payment problems (R-g, R-h, R-i, reused reminder read R-j, Section 6 block B; about 2.5 days). No new KPI tile. | BD-1, BD-2; real rows today; SA-Q9 measured in the workplan; **SA-Q9 resolved by BD-13**; 2b after 2a | No (expected) |
| **3** | Section 5 growth funnel, including BD-6 "active after 30 days"; "paid" stage shows "not recorded yet" until P-5. | Invite volume; P-5 for "paid" | No (expected) |
| **4** | Section 2 block A boost revenue (live, test switch BD-10), boost problems in Section 6 block A, K-6 for boost disputes, K-5 values; boost lots in Section 4 via R-b. | Boost checkout open beyond the test-account list; a new `…ForAdmin` read on `BusinessOsBoostPurchaseRepository` (D §2.1) | No (expected) |
| **5** | Plan revenue and MRR (P-8a definition); paying vs comped made exact in Section 1; trial-to-paid; funnel "paid" stage. | **P-3b.2** (webhook writer), **P-8a**, **P-5** | No (expected) |
| **6** | AI margin overall and per current plan (BD-7, BD-8), Stripe fee as labelled estimate; K-7 (needs a new condition kind, SA). | Slices 4, 5 | No (expected) |
| **7** | Platform payment problems and paid churn (BD-5): failures, grace, paused, `ended_at`; webhook health; K-6 for plan disputes. | **P-6a**, **P-6b**, **P-8b** | No (expected) |
| **8** | History snapshots (plan mix, credit position) for trend lines and churn of free accounts; scale path for any aggregate. | A migration and a cron on the `bos_cron_runs` pattern (SA) | **Yes** |

---

## 10. Slices 1a and 1b: full specification

**Title:** "Accounts, AI cost and credits", delivered as **1a** then **1b** (SA-F3). **Scope:** §9 rows 1a and 1b. **No migration, no new SQL function, no write.** Each requirement below is tagged with its slice.

### 10.0 Scope split

| Slice | In scope | Not in scope |
|---|---|---|
| **1a** | S1-FR-1 to S1-FR-20, S1-FR-25 to S1-FR-27; reads R-a, R-c, R-c′, R-d; tiles K-1, K-3, K-5 | Section 4, K-2, K-4 (not rendered, not placeholders); R-b; the SA-Q7 refactor |
| **1b** | S1-FR-21 to S1-FR-24; read R-b; tiles K-2, K-4; SA-Q7 refactor; G3 / lot repository caller lists; narrowing of Section 4, K-2, K-4 to a picked business | Anything in slice 2 or later |

### 10.1 Page

| # | Requirement | Slice |
|---|---|---|
| S1-FR-1 | A new admin page at `/admin/finance` (title "Finance & business health", purpose line "How is Business OS doing this month: accounts, AI cost and credits.") following the layout standard L-1 to L-7. | 1a |
| S1-FR-2 | Menu entry per §5; nav test updated. | 1a |
| S1-FR-3 | Filter bar: presets Today / 7d / 30d / This month (default) / Custom (max **92 inclusive days**, UTC dates, `to` not before `from`, `to` not after today UTC); `7d` / `30d` = the last 7 / 30 UTC days including today; `BusinessAccountPicker` (default "All businesses"). Filters are held in the URL with the param names `preset`, `from`, `to`, `accountId` (L-4, all six SA-F11 conditions). Presets come from the sibling preset module (SA-Q2). | 1a |
| S1-FR-4 | KPI strip (§7.1). **1a:** K-1, K-3, K-5. **1b:** adds K-2, K-4. K-1 always compares calendar months regardless of the selected window (its label says "This month vs last month, UTC"). K-2, K-3, K-4 are "now" figures. When a business is picked, K-1 (1a), K-2 and K-4 (1b) narrow to that business, and K-3 shows whether that business is an open-ended Founding Partner. | 1a / 1b |
| S1-FR-5 | Sections in this order: Platform revenue panel (§10.6), Section 1 (§10.3), Section 3 AI cost (§10.4), and from 1b Section 4 Credits (§10.5). Section 2, 5, 6 placeholders are **not** rendered (no empty headings); in 1a, Section 4 is not rendered either. | 1a / 1b |
| S1-FR-6 | Each section renders independently: a failed section shows "Could not load this section" with a retry, the others still render (L-5). | 1a |

### 10.2 Route

| # | Requirement | Slice |
|---|---|---|
| S1-FR-7 | **One** admin route, `GET /api/admin/business-os/finance` (SA-Q8; split only if a section's p95 crosses 1 s). `requireAdmin` is the first statement. A repeated query key → 400 **before** Zod. Strict Zod query schema: `preset` (enum `today`, `7d`, `30d`, `this_month`, `custom`), `from` / `to` (`YYYY-MM-DD`, required only with `custom`, `from <= to`, `to` not after today UTC, span <= 92 **inclusive** days), `accountId` (optional UUID). Unknown keys refused. For a non-custom preset the server **ignores any client `from` / `to`** and resolves the window with its own clock (SA-Q2). Invalid input → 400 in the standard error format. | 1a |
| S1-FR-8 | The route resolves the window in UTC with one clock for the whole request, reads through repositories only (CLAUDE.md rule 1), reads sections concurrently with each settled on its own (a rejected read gives that section `unknown`, never a 500), and returns 200 `{ success: true, data }` with, per section, `status` (`ok` / `partial` / `unknown`), figures, the resolved window and `generatedAt`. An unexpected throw returns 500 in the standard format. | 1a |
| S1-FR-9 | When `accountId` is given, the route verifies the id belongs to a Business OS account (exists in the plan table) and otherwise returns 404 "Business not found" without revealing anything further. A platform account id is not in the plan table, so it gets the **same 404** (no separate 409 path; SA-F14). Then every account-scoped read receives **exactly** that id and **no** all-accounts method is called (SEC-3). Section 1 then narrows to that business (all six groups shown, Total 1), using `findEntitlementInputs` and the account-scoped R-c′. | 1a (1b extends to R-b / credits reads) |
| S1-FR-10 | Pino child logger with `correlationId`; one `info` line per request carrying `adminId`, `correlationId`, the validated filters (account id, never a name), section statuses, counts and timing only (SEC-8, SA-Q11). `Cache-Control: no-store` on **every** response, success and error. | 1a |
| S1-FR-11 | No write, no RPC that writes, no LLM call, no audit entry (NG-1, SEC-10). | 1a / 1b |

### 10.3 Section 1 in slice 1a: Accounts by plan

| # | Requirement | Slice |
|---|---|---|
| S1-FR-12 | Six groups (§8.1, BD-3, BD-4) with counts, zeros shown, tier groups one per `config.tierOrder` entry labelled from config (no tier literal, SA-F6); the six counts add up to the total number of accounts, shown as "Total". | 1a |
| S1-FR-13 | Lifecycle state counts; grace and past-due counts beside their group; Founding Partners with no end date and dormant Founding Partners via the predicates exported by `report.ts` (SA-Q3); new accounts in the window split by origin (backfill labelled); ending in the next 30 days. A link to Plans & entitlements for businesses without a plan row (not counted here, DF-2). | 1a |
| S1-FR-14 | The finance builder runs its **own** keyset `pagePlans` walk (same page size and ceiling semantics as the shadow report; error → `unknown`, cap → `partial` "at least") and classifies each row with `deriveLifecycle(fromPlanRow(row), …)` and the §8.1 mapping table, as one pure function. **`buildShadowReport` is not called.** `report.ts` exports `lifecycleInputs` and the two predicates; its control flow is untouched and `report.test.ts` / `dormantChampions.test.ts` pass unchanged (SA-Q3). No business names in the counts. | 1a |
| S1-FR-15 | Paying vs comped uses R-c (§10.8): live-mode billing rows with `subscription_status` in the exported paying set {`active`, `past_due`} and `ended_at` NULL (SA-Q5). The fallback "Tier set" group is shown **only** when R-c fails. | 1a |

### 10.4 Section 3 in slice 1a: AI cost this window

| # | Requirement | Slice |
|---|---|---|
| S1-FR-16 | AI cost in the window (USD), credits charged, number of charged actions; by trigger; by current plan group (BD-8 note shown; `unknown` if the plan walk failed, while the total still renders); top 10 accounts with business name and cost; deleted-accounts bucket. | 1a |
| S1-FR-17 | All businesses: read through the **new** named all-accounts method on `BusinessOsCreditLedgerReadRepository` (R-a, e.g. `listRowsOfAllAccountsCreatedInRange`): charges **and** adjustments, `created_at` half-open, paged, de-duplicated by id, **including** `user_id` NULL rows (the deleted bucket is split in Node, so one read gives one total), existing allow-listed columns, info log. **Ceiling 20,000** (`MAX_CEILING`) with the `>=` "may be incomplete" rule. One business picked: the existing `listRowsForAccountCreatedInRange`. **Not** `listChargesAllAccountsInWindow` or `listChargesOfDeletedAccountsInWindow` (SA-F1, SA-Q6). Exact integer sums at 10 dp for cost and 6 dp for credits. On ceiling: AGG-3 ("at least", status `partial`). | 1a |
| S1-FR-18 | K-1's calendar-month comparison uses the same read path (R-a, or `listRowsForAccountCreatedInRange` when a business is picked) for the current month to date and the previous month's same elapsed span (clamped, injected `now`). K-1's evaluation follows §7.1 and SA-Q12. | 1a |
| S1-FR-19 | A window that starts before the charging cut-over shows the cut-over notice; a window entirely before it shows the notice instead of a $0 (`CutoverNotice`, `cutoverClamp`). | 1a |
| S1-FR-20 | A link to "AI cost & usage" for the `token_usage` measure; **no `token_usage` read in slice 1** (SA-Q4). | 1a |

### 10.5 Section 4 in slice 1b: Credits

| # | Requirement | Slice |
|---|---|---|
| S1-FR-21 | A table, one row per account (or the picked one): business, plan group, allowance, used, % used, over allowance (yes / no), gifted outstanding. Sorted by % used, highest first. Counts and credits are allowed here (admin page), unlike the Businesses list's percent-only column. Built with `components/ui` primitives (L-6). | 1b |
| S1-FR-22 | Summary line: accounts over allowance; accounts at or over 150% (= K-2); total gifted outstanding (= K-4); credits granted and taken back in the window. | 1b |
| S1-FR-23 | **SA-Q7, one core, two projections:** the existing `computeByAccount` pass in `adminCreditPercent.ts` becomes the single core yielding `{ allowance, used, trial }`; `readAdminCreditsLeft` keeps its exact output type and tests (FR-48); a new exported function returns the counts for the finance route only, under the same batched reads (`getSnapshots`, `findPeriodAnchorsBatch`, `listTotalsForAccountsInRange`; one pass, no N+1), 2 s budget and failure rules. Its `KNOWN_NON_GATE_IMPORTERS` symbols stay the same. Gifts: R-b (all businesses) or `listLotsWithDraws(accountId)` (one business), filtered to `admin_grant` before `extraCreditsAt` (SA-Q10). | 1b |
| S1-FR-24 | Failure rules per §8.4: per-account "unknown"; whole-section "unknown" on totals read failure, timeout or ceiling, or when the plan walk failed or reached its cap; lots read failure or ceiling → gifted column and K-4 "Unknown", rest of the section renders. | 1b |

### 10.6 "Platform revenue: none yet" panel

| # | Requirement | Slice |
|---|---|---|
| S1-FR-25 | A panel titled "Our revenue" stating: "None yet. Plan billing is not live (the payment webhook is not in place) and credit boosts are open to test accounts only." It shows no $0 chart and no $0 figure. | 1a |
| S1-FR-26 | **The panel never claims "none" when it is false.** It checks, through R-d (§10.8), whether any **live-mode** row exists in `business_os_billing_events` with `kind = 'invoice_paid'` or in `business_os_boost_purchases` with `paid_at` set (a `{ count: 'exact', head: true }` existence read, not a sum). If one exists, the panel instead says "Live revenue has started to arrive; the revenue section is coming in a later update" and K-5 says "Revenue recorded, not yet shown". If the check fails, the panel says "Could not check" and K-5 is grey. | 1a |
| S1-FR-27 | Test-mode rows are ignored by this check (`livemode = true` in the query, BD-10). | 1a |

### 10.7 Non-functional (slices 1a and 1b)

| Area | Requirement |
|---|---|
| Performance | Route p95 under 2 s at today's volumes; credits pass inside its 2 s budget; no N+1 (batched reads only). |
| Security | §3 in full; `tenant-isolation-guard` review on each workplan and code review. |
| Accessibility | Tile state in text as well as colour; tables with header cells; filters keyboard-operable with labels; focus visible. |
| Logging | Pino only; touching any file that still uses `console.*` triggers the CLAUDE.md flag-and-convert rule. |
| Types | TypeScript strict; no implicit `any`. ts-jest does not type-check in this repo: scoped `tsc --noEmit` with a planted canary (AC-44). |
| CI time | No new CI job and no added PR critical-path time: every new test runs in the existing Jest gate or the existing `test:bos-entitlements` job. |

### 10.8 New reads (no migration)

Slice 1 cannot be built from existing reads alone (SA-F2). Each new method is a **named** method; each all-accounts method documents the intentional RLS bypass in its repository header. Use the `new-repository` skill and walk its final checklist. The workplan lists each method's final name, columns, ceiling and ceiling behaviour (SA workplan condition 3).

| # | Repository | Method (example name) | Scope | What it returns / rules | Ceiling | Slice |
|---|---|---|---|---|---|---|
| **R-a** | `BusinessOsCreditLedgerReadRepository` (existing) | `listRowsOfAllAccountsCreatedInRange` | Named all-accounts | Charges **and** adjustments, `created_at` half-open, paged, de-duplicated by id, **including** `user_id` NULL; existing allow-listed columns; logs at info. Caller-list pin and header caller paragraph updated (§12.2) | 20,000 (`MAX_CEILING`), `>=` rule → "at least", section `partial` | 1a |
| **R-b** | `BusinessOsCreditLotRepository` (existing) | `listLotsWithDrawsAllAccounts` | Named all-accounts | Lots with draws, every source (caller filters `admin_grant`); existing column lists; read-only. Wiring reaches it only via `Pick<…, 'listLotsWithDrawsAllAccounts' \| 'listLotsWithDraws'>`; no writer reachable | Reached → **error** (never a partial list), gifted column and K-4 "Unknown" | 1b |
| **R-c** | **New** read-only `BusinessOsFinanceReadRepository` | e.g. `listLiveBillingStatusesAllAccounts` | Named all-accounts | `user_id`, `subscription_status`, `ended_at` of `business_os_billing_accounts` with `livemode = true` in the query. Paying set applied by the caller from the exported constant in `lib/business-os/billing/` (SA-Q5) | Set in the workplan; failure → "Tier set" fallback group | 1a |
| **R-c′** | **New** `BusinessOsFinanceReadRepository` (same) | `findLiveBillingStatusForAccount(accountId)` | Account-scoped | `business_os_billing_accounts` `.eq('user_id').eq('livemode', true).maybeSingle()`; used instead of R-c when a business is picked (SA-W1) | Not applicable (one row) | 1a |
| **R-d** | **New** `BusinessOsFinanceReadRepository` (same) | e.g. `hasLiveRevenueRows` | Platform-wide existence | `{ count: 'exact', head: true }` on `business_os_billing_events` (`livemode = true`, `kind = 'invoice_paid'`) and `business_os_boost_purchases` (`livemode = true`, `paid_at` not null); no amounts read | Not applicable (head count) | 1a |

**The new finance read repository (R-c, R-c′, R-d)** follows the `BusinessOsCreditLedgerReadRepository` precedent: service role documented, explicit column lists, `livemode = true` in the query, `{ count: 'exact', head: true }` for existence, **no write method**, and a source test pinning no `insert` / `update` / `upsert` / `delete` / `rpc`. It keeps a read page off the money writers' exact caller lists (`BusinessOsBillingAccountRepository`, the billing-event repository and `BusinessOsBoostPurchaseRepository` are not named). It is not a new pattern (SA-F2).

**Existing reads reused (unchanged):** `businessOsAccountPlanRepository.pagePlans` (all accounts) and `findEntitlementInputs(accountId)` (picked business, override rows dropped in the wiring; SA-W1) — the two RC-15-pinned methods, §12.2; `listRowsForAccountCreatedInRange` (one business, R-a's counterpart); `listLotsWithDraws(accountId)` (one business, R-b's counterpart); the credit-percent pass's batched reads (1b); the route's admin name lookup (`app/api/admin/**` only, SEC-5).

**Other new code (no new pattern):** the paying-status constant in `lib/business-os/billing/` (SA-Q5); `report.ts` exports `lifecycleInputs` and two predicates (SA-Q3); the sibling preset module and the URL `parse` / `serialise` module (SA-Q2, L-4); the finance rule data file with the type-only widening of Health's evaluator generics (SA-Q1).

---

## 11. Slices 1a and 1b: acceptance criteria

All must be testable by Jest or by QA's recorded manual check. Each AC is tagged with the slice that must pass it. AC numbers are stable; AC-13 has moved to slice 2.

**AC to slice mapping (SA-F3):**
- **Slice 1a:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-9, AC-10, AC-12, AC-14, AC-15, AC-18, AC-20, AC-21, AC-22, AC-23, AC-24, AC-25, AC-26 (Section 1, Section 3 and K-1), AC-27, AC-28, AC-29, AC-30, AC-31, AC-32 (1a part), AC-33, AC-34, AC-35, AC-36, AC-37 (Section 1, K-3, AI cost parts), AC-39, AC-40, AC-41, AC-42, AC-44.
- **Slice 1b:** AC-8, AC-11, AC-16, AC-17, AC-19, AC-38, AC-43, plus the 1b parts of AC-26 (Section 4, K-2, K-4), AC-32 (credits part) and AC-37 (credits section), and a re-run of AC-21, AC-27, AC-28, AC-30, AC-31, AC-42 and AC-44 over the 1b diff.
- **Slice 2:** AC-13 (moved, SA-F10). Slice 2's own criteria, AC-45 to AC-74, and the 2a / 2b mapping are in §11A.10.

**Access and input**
- [ ] **AC-1** *(1a)* An unauthenticated request to the route returns 401 and no figures.
- [ ] **AC-2** *(1a)* A signed-in non-admin (including one whose `profiles.role` says admin but who is not in `admin_users`) gets 403 and no figures; `requireAdmin` is the first statement (admin authz surface guard passes).
- [ ] **AC-3** *(1a)* A non-admin opening `/admin/finance` is refused by `requireAdminPage` and sees no figure.
- [ ] **AC-4** *(1a)* Invalid input returns 400 in the standard format with no internal details outside development: unknown `preset`; `custom` without dates; `to` before `from`; span over 92 inclusive days; malformed `accountId`; an unknown query key.
- [ ] **AC-5** *(1a)* A well-formed `accountId` that is not a Business OS account (including a platform account id) returns 404 with no further detail.

**Empty and normal data**
- [ ] **AC-6** *(1a)* With no plan rows, Section 1 shows all six groups at 0 and Total 0; K-3 shows 0 and is not red or amber.
- [ ] **AC-7** *(1a)* With no ledger rows in the window, Section 3 says "No AI actions charged in this window" and shows USD 0.00 as a real zero (source live); K-1 is not red or amber (the USD 1.00 `floor` on the current figure), and is grey "Not enough history" only when the previous span starts before the charging cut-over.
- [ ] **AC-8** *(1b)* With no lots, gifted outstanding is 0 and K-4 is grey with value 0.
- [ ] **AC-9** *(1a)* Section 1's group counts, Total and K-3 match SQL check 1 (§13) **run at the time of the test** (today, for example, Founding Partner = 8 and Total = 8; the figures drift with each new account, so the AC is the match, not the number). K-3 equals check 1's `no_cohort_end_date` count for the champion cohort **while no champion account also has a tier in force** (true today: every tier is NULL). K-3 follows §7.1 (accounts in the Founding Partner group); a champion with a tier in force sits in its tier group and is not counted, so check 1 can then read higher (QA-2, fix round 1; §7.1 governs).
- [ ] **AC-10** *(1a)* Section 3 total cost, credits and charge count for "This month" match SQL check 2 exactly (to the displayed precision); the deleted-accounts bucket matches `deleted_account_rows`; the trigger split matches **while the ledger holds no adjustment rows** (the page places a correction under its charge's trigger, the SQL under its own NULL trigger).
- [ ] **AC-11** *(1b)* The credits table's "used" per account matches SQL check 4 for accounts whose current period has a totals row (a trial account sums all rows since its trial anchor); gifted outstanding matches SQL check 5.
- [ ] **AC-12** *(1a)* The six plan-group counts always add up to Total: unit test of the §8.1 mapping function over **every** `LifecycleState` and basis kind, including `grace`, `past_due`, `paused`, `unknown`, a tier-plus-cohort account and an expired tier in grace.

**Currency and layers**
- [ ] **AC-13** *(moved to slice 2, SA-F10)* The money-grouping helper, given USD, `usd`, ILS and NULL-currency amounts, returns three lines (USD with `usd` merged, ILS, unknown currency) and exposes no cross-currency total (unit test).
- [ ] **AC-14** *(1a)* AI cost is labelled USD; no figure on the page adds a layer-A and a layer-B amount (source test or review check: no layer-B table is read in slice 1).

**Ceilings and partial data**
- [ ] **AC-15** *(1a)* When the ledger window read (R-a) reaches its ceiling, Section 3 shows "At least USD X" and status `partial`. When either K-1 figure (current or previous span) is inexact, K-1's ratio rules do not fire and K-1 is **amber "Total is a minimum; not all charges counted"**; it is never green (Health SA C-2, C-18).
- [ ] **AC-16** *(1b)* When the credit totals read fails, times out or reaches its ceiling, the whole credits section shows "Unknown" (never a partial sum), K-2 is grey, and the other sections still render.
- [ ] **AC-17** *(1b)* An unreadable single account figure makes only that row "Unknown".

**KPI rules**
- [ ] **AC-18** *(1a)* K-1 on the pure evaluator with injected `now`: previous span USD 10, current USD 15 → amber; USD 20 → red; USD 14.99 → green (no rule matched, both exact); a current figure below the USD 1.00 `floor` → no rule fires; previous span starting before the charging cut-over → grey "Not enough history"; an inexact figure → amber "Total is a minimum". Includes month-length clamping on the 31st and a year boundary.
- [ ] **AC-19** *(1b)* K-2: one account at 150% of allowance → amber; at 149.9% → no match.
- [ ] **AC-20** *(1a)* Changing a threshold in the rule data (e.g. amber ratio 1.5 → 1.2) changes the tile colour with no code change (unit test).
- [ ] **AC-21** *(1a; re-run 1b)* Every tile shows a text state in addition to colour.

**Revenue panel**
- [ ] **AC-22** *(1a)* With no live-mode paid rows, the panel shows "None yet" with the reason and no $0 figure or chart; K-5 is grey.
- [ ] **AC-23** *(1a)* With one live-mode `invoice_paid` billing event (or one live-mode paid boost) present, the panel no longer says "None yet" (mocked repository test); test-mode rows alone do not change it.

**Filters and URL**
- [ ] **AC-24** *(1a)* Selecting a preset, a custom range or a business updates the URL (`preset`, `from`, `to`, `accountId`) via `router.replace`; reloading that URL shows the same view; an invalid URL value falls back to "This month / All businesses" with a notice; an unknown key is dropped; no business name appears in the URL (unit tests on the `parse` / `serialise` module).
- [ ] **AC-25** *(1a)* Presets resolve in UTC for a `now` just before and just after UTC midnight and month end (unit test); "This month" starts on day 1 00:00 UTC; `7d` / `30d` include today; `today` and `this_month` resolve exactly as Activity's (parity test); for a preset the server ignores client `from` / `to`.
- [ ] **AC-26** *(1a: Section 1, Section 3 and K-1; 1b: Section 4, K-2, K-4)* Picking a business narrows those sections and tiles to that business, and every read for it is account-scoped (repository-level test).

**Resilience, standards and guards**
- [ ] **AC-27** *(1a; re-run 1b)* One failing section (mocked repository error) shows "Could not load this section" and the rest of the page renders; the route still returns 200 with that section's status `unknown`.
- [ ] **AC-28** *(1a; re-run 1b)* The route, its service and the new finance read repository name no insert, update, upsert, delete or writing RPC (source test); the diff contains no migration and no SQL function.
- [ ] **AC-29** *(1a)* No PostgREST aggregate select and no raw `token_usage` select anywhere in the slice (source test).
- [ ] **AC-30** *(1a; re-run 1b)* Logs contain counts, statuses and timing only, with `correlationId` and `adminId`; no per-account figure, no email, no business name; no `console.*` in touched files.
- [ ] **AC-31** *(1a; re-run 1b)* Every guard in §12.2 for the slice passes: the new entitlements importer is registered and `npm run test:bos-entitlements` passes; `npm run test:authz-guard` passes; Health tests pass unchanged; the sidebar nav test passes with the new entry.
- [ ] **AC-32** QA records a manual check of the critical path in the workplan's QA report. *(1a)* Admin opens Finance from the Monitor menu, sees tiles K-1, K-3, K-5, the revenue panel, Section 1 and Section 3 with today's data, switches to 30d and to one business, reloads the URL, and cross-checks Section 1 and Section 3 against SQL checks 1 and 2. *(1b)* Also sees K-2, K-4 and Section 4 and cross-checks them against SQL checks 4 and 5.
- [ ] **AC-33** *(1a)* A repeated query key returns 400 before Zod.
- [ ] **AC-34** *(1a)* `to` after today (UTC) returns 400; a custom span of exactly 92 inclusive days is accepted and 93 is refused.
- [ ] **AC-35** *(1a)* Every response, success and error, carries `Cache-Control: no-store` (SEC-9).
- [ ] **AC-36** *(1a)* An unexpected throw in the route returns 500 in the standard format, with `details` only in development.
- [ ] **AC-37** *(1a; credits clause 1b)* The plan walk fails → Section 1 `unknown`, K-3 grey, the credits section `unknown` (it has no account list; 1b), the AI-cost total still renders (by-plan-group breakdown `unknown`). The plan walk reaches its cap → Section 1 `partial` with "at least", and the credits section `unknown` with K-2 grey (no positions pass is run; SA-W11); K-4 still renders.
- [ ] **AC-38** *(1b)* The lots read fails or reaches its ceiling → the gifted column and K-4 are "Unknown"; the rest of the credits section renders.
- [ ] **AC-39** *(1a)* The revenue existence check fails → the panel says "Could not check" and K-5 is grey (S1-FR-26's third branch).
- [ ] **AC-40** *(1a)* A window that starts before the charging cut-over shows the cut-over notice; a window entirely before it shows the notice instead of a $0 (S1-FR-19).
- [ ] **AC-41** *(1a)* With a business picked, K-3 says whether that business is an open-ended Founding Partner (S1-FR-4).
- [ ] **AC-42** *(1a; re-run 1b)* With `accountId` set, every account-scoped call receives exactly that id, no all-accounts method (`pagePlans`, R-a, R-b, R-c) is called, and R-d is called without any account argument (security review).
- [ ] **AC-43** *(1b)* The Businesses list's "Credits left" output and tests are unchanged after the SA-Q7 refactor (no count reaches `AdminCreditsLeft`).
- [ ] **AC-44** *(1a; re-run 1b)* **Type check:** ts-jest does not type-check in this repo. Dev and QA run a scoped `tsc --noEmit` over the touched files (a temporary tsconfig that extends `tsconfig.json` with `include` narrowed to the diff), with a **planted canary error** that must be reported before it is removed, and paste the output. The full `npx tsc --noEmit -p tsconfig.json` OOMs silently and does not count as evidence. Zero new diagnostics in touched files.

---

## 11A. Slice 2 (2a and 2b): full specification and acceptance criteria

**Title:** "Business takings and client payment problems" (layer B: clients paying businesses). **Status:** specified 2026-10-11; SA requirement review APPROVED WITH CONDITIONS (SA-RR-2); findings S2-F1 to S2-F9 and rulings SA-Q13 to SA-Q19 applied 2026-10-11; the 2a workplan is next. **Basis:** [BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md) (cited as **LC**; authoritative for live facts, and it supersedes the layer-B figures in LS, §8.2 and §8.6), BD-1, BD-2, BD-9, BD-12 and BD-13. **No migration, no new SQL function, no write, no new query parameter.** The route, its Zod schema, the filter bar and the URL stay exactly as built in slice 1. Each requirement is tagged 2a or 2b.

### 11A.0 Scope and split

The whole slice is about 5 days, more than the 4-day limit, so it is split. **2b starts after 2a merges.** Each part is demoable alone and gets its own workplan, SA workplan review, SA code review, QA and PR, recorded in §0.1.

| Part | In scope | Not in scope | Estimate |
|---|---|---|---|
| **2a: Business takings** | The currency-grouping helper (CUR-1, CUR-2, S2-CUR-1 to S2-CUR-7, AC-13); reads R-e, R-e′, R-f, R-f′ (§11A.7); Section 2 block B "Takings through the platform": takings per currency (gross, refunded, net), refunds, recorded fees by fee currency, payments by processor, businesses with takings, per-business table (S2-FR-1 to S2-FR-14) | Section 6; any reminder read; any KPI tile; any change to the page shell (DF-4) | About 2.5 days |
| **2b: Client payment problems** | Reads R-g, R-g′, R-h, R-h′, R-i, R-i′, and the reused reminder read R-j (§11A.7); Section 6 block B "Client payment problems": failed client payments (not available, with the reason), overdue invoices, overdue or past-due instalments, client plan cancellations, reminder health linking to Jobs & queues (S2-FR-15 to S2-FR-26); the shared `formatUtcDate` (first page with a date-only column) | Platform payment problems (block A, slice 7); any KPI tile; the page shell (DF-4) | About 2.5 days |

**Page order after slice 2** (extends S1-FR-5): KPI strip; "Our revenue" panel; **Section 2 block B, Takings through the platform (2a)**, directly under "Our revenue" and visibly separate from it; Section 1; Section 3; Section 4; **Section 6 block B, Client payment problems (2b)**.

### 11A.1 What BD-13 means for the build

| # | Rule |
|---|---|
| S2-T-1 | Every layer-B row is read and shown, test and real together, and treated as real. |
| S2-T-2 | **No test-mode label, no note about test payments, no switch and no `livemode` filter** on any layer-B read or block. No migration. |
| S2-T-3 | The blocks still say what the money is: "Not our revenue" (BD-1) and "The businesses' problem, not ours" (BD-2). |
| S2-T-4 | Filtering out test businesses or users is a future item (DF-3). BD-10 (live only, test switch) is unchanged and governs layer A only. |

### 11A.2 Window rules

"The window" is the filter bar's resolved window: whole UTC days, half-open instants `[start, end)` (TZ-1), default **This month** = the current UTC calendar month to date (BD-9). "Today" is the UTC date of the request's one clock `now` (S1-FR-8). **As of now** means the figure is computed against `now` / today, and the date window does not apply; its subtitle says so.

| Figure | Rule | Column |
|---|---|---|
| Takings: gross, payment count, fees, payments by processor, businesses with takings | The window | `payment_transactions.paid_at` (set on 110 of 110 rows, LC §1) |
| Refunds | The window | `payment_refunds.created_at` (SA-Q19) |
| Client plans cancelled, client plans completed | The window | `payment_plan_subscriptions.cancelled_at`, `completed_at` |
| Client plans active now; active plans whose next charge time has passed | **As of now** | `status`, `next_charge_at < now` |
| **Overdue invoices** | **As of now.** An invoice is overdue now when its status is `overdue`, **or** its status is `sent` and its `due_date` is **before today's UTC date**. A due date equal to today is not past due. The two kinds are shown separately ("Marked overdue" and "Past due date, not marked overdue"). `due_date` is compared as a date-only value (note below, S2-F5). | `payment_invoices.status`, `due_date` |
| **Overdue or past-due instalments** | **As of now.** Status `overdue`, **or** status `pending` with `due_date` before today's UTC date. Shown separately ("Marked overdue" and "Past due date, still pending"). `due_date` is compared as a date-only value (note below, S2-F5). | `payment_plan_installments.status`, `due_date` |
| Reminder health | **As of now**, with the Jobs & queues reader's own windows (24 hours, 7 days) | `ADMIN_QUEUE_SPECS.payment_reminders` |

**Note on due dates (S2-F5).** `due_date` is a calendar date with no time zone: a **date-only value, never an instant** (the `dateOnlyIsNotMidnightUTC` lesson, INV-00013). "Past due" compares the `YYYY-MM-DD` string with today's UTC date (`todayUtc(now)`) and **never** goes through `new Date(due_date)`. "Days past due" is the whole UTC-day difference between the two dates. The shared `formatUtcDate` renders a date-only string as that same calendar date in any process time zone (AC-74). It is compared with today's **UTC** date, because this page aggregates many businesses (TZ-2); a business in another zone may see a due date pass up to one day earlier or later. The subtitle says "As of now, UTC".

### 11A.3 Currency and money rules (the helper is built in 2a)

| # | Rule |
|---|---|
| S2-CUR-1 | One pure helper (for example `lib/business-os/finance/currencyGroups.ts`) implements CUR-1: it takes amounts, each with its own currency code, and returns one line per normalised currency, sorted by code, with the "unknown currency" line last. **No exported function returns a total across currencies** (source test). Both 2a and 2b use it for every money figure. |
| S2-CUR-2 | CUR-2: a code is trimmed and upper-cased (LC §4: Stripe writes lower case). A code that is not exactly three letters A to Z after that, or is NULL or empty, goes to the **"Unknown currency"** line; it is never assumed to be USD. No ISO list is kept. |
| S2-CUR-3 | **Exact sums at scale 100** (SA-Q13). Every layer-B money column is declared with two decimals (payments and invoices DECIMAL(10,2); refunds and fees NUMERIC(12,2)), so **scale 100 is the declared two-decimal scale of every layer-B money column**. Each amount is converted once to an integer number of hundredths with `Math.round(n * 100)` (the `toUnits` method, AGG-2) and summed as an integer; it is displayed at 2 decimals. An amount is **unreadable** when it is missing, **not finite**, or **not a whole number of hundredths** (`abs(n * 100 - round(n * 100)) > max(1e-6, abs(n * 100) * 4 * Number.EPSILON)`; identical to a flat `1e-6` below about 11 million, and widened above it only for floating-point error, so a third decimal is still caught — D-1, approved in SA-CR-2a): it is excluded from the sum and counted ("N amounts could not be read"), never treated as 0 and never dropped silently. Refunds use `amount`, never `amount_minor` (S2-FR-3). An unreadable payment or refund amount makes that currency line's net, and the net of the affected per-business rows, 'Unknown', and the block `partial` with a notice. An unreadable fee is left out of its fee line and counted in the fee note; it makes the block `partial` but never changes net. |
| S2-CUR-4 | Each row's **own** currency (CUR-4; LC §4: every money row carries one, so no join is needed). Recorded fees are grouped by **`fee_currency`**, never by the payment's `currency` (LC §4: every fee is in USD, including fees on ILS payments). |
| S2-CUR-5 | No FX, no `exchange_rates` read, no combined figure and no ranking across currencies (CUR-3, BD-12). Any list that holds several currencies is sorted by currency first. |
| S2-CUR-6 | **Net = gross minus refunded, per currency only**, labelled "Net of refunds (fees not deducted)". Fees are **never** subtracted from takings: their currency can differ from the payment's. |
| S2-CUR-7 | Layer A and layer B never share a total, a tile or a chart axis (§6.1). |

### 11A.4 Section 2 block B: Takings through the platform (2a)

| # | Requirement | Part |
|---|---|---|
| S2-FR-1 | A block titled "Takings through the platform", with a neutral "Not our revenue" chip (BD-1), a subtitle naming the source (client payments recorded by the businesses) and the window (UTC), and saying "Covers businesses that still exist" (a deleted business's client payments are deleted with it, S2-F6), and its own section status (`ok` / `partial` / `unknown`, L-5). Placed directly under "Our revenue" (§11A.0 page order). | 2a |
| S2-FR-2 | **Takings per currency**, one line per currency (S2-CUR-1): payments (count of counted payments: succeeded or refunded), **gross**, **refunded**, **net** (S2-CUR-6), businesses with takings. Gross = the sum of `amount` over payments whose `paid_at` is in the window and whose status is `succeeded` or `refunded` (a refunded payment was received; its refund is counted under refunded). A payment with any other status is left out of every sum and counted ("N payments with another status not counted"; none today, LC §3). Lines are the currencies with a counted payment or a succeeded refund in the window; a refund-only line shows payments 0, gross 0.00 and a negative net. | 2a |
| S2-FR-3 | **Refunds**, one line per refund currency: refunds (count) and amount refunded, over refunds created in the window (dated by **`created_at`**, SA-Q19) with status `succeeded`. The amount is the refund's **`amount`** (same scale and unit as the payment), **never `amount_minor`** (SA-Q13). A refund in any other state is counted as "not completed" and its amount is left out (none today, LC §3). A note says: "A refund counts in the month it was made, which may differ from the month of its payment." | 2a |
| S2-FR-4 | **Recorded processor fees, grouped by fee currency** (S2-CUR-4): one line per fee currency, with "Fees recorded on N of M payments in this window". A fee with no fee currency goes to the "Unknown currency" line. A note says: "A fee can be charged in another currency than its payment, so fees are never deducted from takings." Only recorded fees are shown, never an estimate. | 2a |
| S2-FR-5 | **Payments by processor:** a count per `processor_type` (today Stripe and manual, LC §1), from the same rows. Counts only. "Manual" is labelled "recorded by the business; no processor fee". | 2a |
| S2-FR-6 | **Businesses with takings:** the number of distinct businesses with at least one counted payment in the window, overall and per currency. | 2a |
| S2-FR-7 | **Per-business table:** one row per business and currency (from counted payments and succeeded refunds): business, currency, payments, gross, refunded, net. Sorted by currency, then by gross, highest first (S2-CUR-5). At most **200 rows** (`TAKINGS_ROWS_SHOWN`, data in `FINANCE_LIMITS`), with a count line "Showing N of M". Names come from the route's admin name lookup, only for ids taken from rows already read (SEC-5); a platform account is labelled as such. There is **no "Deleted business" row**: `user_id` is NOT NULL with ON DELETE CASCADE on the payment tables, so a deleted business's payments are deleted with it (S2-F6). A NULL id, should one ever be read, is handled defensively as "Unknown business". | 2a |
| S2-FR-8 | **Honest indicators.** No counted payment and no succeeded refund in the window → no currency line; with no counted payment the block says 'No client payments recorded in this window' (never "USD 0.00" for a currency with no rows); no refund → "No refunds in this window". R-e at its ceiling → gross and counts are "At least", the block is `partial` with a notice, and **net is "Unknown (a read was cut off)"**, because a lower bound minus a figure is not a bound. R-f at its ceiling → refunded is "At least" and net is "Unknown". R-e failed → the block shows "Could not load this section" (`unknown`). R-f failed → refunds and net show "Unknown", gross still renders, and the block is `partial` with the notice "Refunds could not be read". | 2a |
| S2-FR-9 | **BD-13:** no test-mode label, note or switch; no `livemode` filter (S2-T-1 to S2-T-4). | 2a |
| S2-FR-10 | **Cannot produce, said on the block:** failed client payments (not stored; shown in 2b), refund fees (`refund_fee` empty everywhere, LC §1), net after fees (S2-CUR-6), one total across currencies (BD-12). | 2a |
| S2-FR-11 | **Picked business:** R-e′ and R-f′ receive exactly the picked id (SEC-3); the table shows that business's currency rows; "Businesses with takings" reads 1 or 0. | 2a |
| S2-FR-12 | **Route and payload:** the payload gains a `takings` section `{ status, scope, figures }` (figures null only when `unknown`). The route's one `info` line gains the block's status and counts only (rows read, ceiling reached, unreadable amounts, other-status rows): **never an amount, a currency total or a name** (SEC-8). | 2a |
| S2-FR-13 | **Layout standard:** the block follows [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md), importing shared parts only through the alias `@/app/admin/components/layout/`: the table constants (§5.7, `adminTable.ts`, including `ADMIN_TH_NUM` / `ADMIN_TD_NUM`: numbers right-aligned, `tabular-nums`, `whitespace-nowrap`); the currency named in every money column header or cell; a missing value shown as "Unknown" or a dash, never blank; `StatusChip` (text and icon, never colour alone, §5.9); `AdminNotice` for a partial notice and `AdminEmpty` for an empty state (§5.10); `formatCount` for counts (§5.11); tables with header cells and an `aria-label`. The page shell is not migrated here (DF-4). | 2a |
| S2-FR-14 | All new copy lives in `financeCopy.ts`; no `console.*` in any touched file (CLAUDE.md Logging). | 2a |

### 11A.5 Section 6 block B: Client payment problems (2b)

| # | Requirement | Part |
|---|---|---|
| S2-FR-15 | A block titled "Client payment problems", with a neutral chip "The businesses' problem, not ours" (BD-2), placed after Section 4. It has five parts, each with its own status: failed client payments, overdue invoices, overdue instalments, client plans, reminder health. | 2b |
| S2-FR-16 | **Failed client payments: not available.** A fixed panel, with no read behind it: "Failed client payments cannot be shown. A failed charge is not stored (client payments are recorded only when they succeed or are refunded), and the failure fields are empty everywhere." It never shows 0 and never feeds a tile. **Failed client plan charges** use R-i: while no plan has `last_failure_at` set, the part says "Not recorded: no failure has ever been stored"; once one is set, it shows the number with a failure time in the window. Instalment retries are shown as "Not recorded" (`last_retry_at` / `next_retry_at` empty everywhere, LC §1). | 2b |
| S2-FR-17 | **Overdue invoices (as of now, §11A.2):** per currency: marked overdue (count), past due date not marked (count), **invoice amount** (both kinds), businesses affected; and the oldest due date. A table of the **50 oldest** (`OVERDUE_ROWS_SHOWN`, data): business, invoice (short id), due date (UTC date), days past due, **invoice amount** and currency, and a `warn` status chip "Overdue" or "Past due, not marked". The chip comes from the stored status and the due date (layout standard §5.4 K-5 (i)), never from a new threshold. Sorted by due date, oldest first. **The invoice amount is the full amount of the invoice, not the amount still owed:** partial payments and `refunded_amount` are not deducted, and a note on the part says so (S2-F7). "Days past due" is the whole UTC-day difference between today's UTC date and the due date, computed on the date-only values (S2-F5). Today: 16 marked overdue, 0 past due not marked (LC §3). | 2b |
| S2-FR-18 | **Overdue or past-due instalments (as of now):** the same shape: marked overdue, past due date still pending, **instalment amount** per currency, businesses affected, oldest due date, and a table of the 50 oldest with chips "Overdue" / "Past due, still pending". The instalment amount is the full instalment amount, **not the amount still owed**, with the same note (S2-F7); dates follow the date-only rule (S2-F5). Today: 1 marked overdue, 2 pending past their due date (LC §3). | 2b |
| S2-FR-19 | **Client plans:** plans by status (counts, every status shown, an unrecognised one counted as such); active now; **cancelled in the window**; completed in the window; active plans whose next charge time has passed ("next charge overdue", as of now); failed plan charges per S2-FR-16. Today: active 5, cancelled 1 (LC §3). | 2b |
| S2-FR-20 | **Reminder health (summary, platform-wide):** the `payment_reminders` figures from the Jobs & queues reader (R-j): due now, in progress, **stuck**, failed (24 h, 7 d), **dead-lettered** (24 h, 7 d), the oldest due time. "Stuck" and "dead-lettered" are **not redefined**: they are `ADMIN_QUEUE_SPECS.payment_reminders`, `STUCK_AFTER_SECONDS` and `DEAD_LETTER_MARKER`, applied inside the reused read. The figures are shown **without colour**: the queue's status belongs to Jobs & queues (layout standard §5.4 K-5: a page never re-computes a status from a rule that lives elsewhere; SA-Q14). A link "Open Jobs & queues" goes to `/admin/jobs-queues#queues`. The read runs under `underDeadline` with an explicit finance deadline of **2 s** (`FINANCE_LIMITS.REMINDER_DEADLINE_MS`, written `2 * 1000`; not the default 5 s `ADMIN_READ_DEADLINE_MS`), and the signal is passed to the read (SA-Q14, S2-F9). A failed or timed-out read → "Could not check reminders" with the same link. Today: none stuck, none dead-lettered (LC §3). | 2b |
| S2-FR-21 | **Picked business:** R-g′, R-h′ and R-i′ receive exactly the picked id (SEC-3). **R-j is not called** (it exists only as an all-accounts read); the reminder part says "Reminder health is platform-wide and is not narrowed to one business" with the link. | 2b |
| S2-FR-22 | **Ceilings:** R-g, R-h or R-i at its ceiling → that part's counts and amounts are "At least", status `partial`, with a notice; its table says it lists the oldest rows among those read. | 2b |
| S2-FR-23 | **Each part on its own:** one failed read makes only its part "Could not load this part"; the rest of the block and the page render; the route returns 200 with per-part status. | 2b |
| S2-FR-24 | **Route and payload:** the payload gains `paymentProblems` with `failedPayments` (fixed `not_stored`), `overdueInvoices`, `overdueInstalments`, `clientPlans` and `reminders`, each with its own status. The route's `info` line gains their statuses and counts only (never an amount or a name). | 2b |
| S2-FR-25 | **Layout standard:** as S2-FR-13, plus `StatusChip` `warn` for the overdue rows, `unknown` for "could not check", and dates through the shared **`formatUtcDate`**: this is the first admin page with a date-only column, so 2b builds that deferred export in the shared folder (a page slice that builds a shared export runs the full cycle, layout standard R-7; SA-Q18). `formatUtcDate` renders a date-only `YYYY-MM-DD` string as that same calendar date in any process time zone and never passes it through `new Date` (S2-F5, AC-74). | 2b |
| S2-FR-26 | **No client data.** The businesses' clients are third parties: no read selects, and no payload carries, a contact id, client name, email, phone, notes, metadata or invoice text. Invoices and instalments are identified by short id and business only. | 2b |

### 11A.6 KPI tiles

**No new tile in slice 2.** Reasons: (1) the strip already holds five tiles (K-1 to K-5), the layout standard's maximum (ADMIN_LAYOUT_STANDARD §5.4 K-1); (2) layer B is a growth signal and "the businesses' problem, not ours" (BD-1, BD-2), so a tile would put it in our own health headline; (3) BD-11 sets no layer-B threshold, and adding one is a business decision. Colour inside the blocks comes only from a stored status (an invoice or instalment marked `overdue`, or a past due date) and from section status, never from a new threshold. If the user later wants a layer-B tile (for example "Overdue client invoices"), it needs its own BD with the threshold as data in `FINANCE_RULES` and a decision on which tile it replaces. The only new data constants are display caps (`TAKINGS_ROWS_SHOWN` 200, `OVERDUE_ROWS_SHOWN` 50), the reminder deadline (`REMINDER_DEADLINE_MS`, 2 s) and the read limits in §11A.7, all in `FINANCE_LIMITS` / `FINANCE_READ_LIMITS`.

### 11A.7 New reads (no migration)

All new reads go in **`BusinessOsFinanceReadRepository`** (SA-F2; LC §5), never in the payment writer or owner-scoped repositories, several of which are pinned by the Stripe webhook placement guards. The finance repository keeps its rules: service role documented in its header (an admin read across accounts), explicit exported column lists, **no write method** (its no-write source pin), one caller (`financeHealthDeps.ts`), and methods that never throw.

**Common rules for R-e to R-i:**
- Pairs of **named** methods: an all-accounts method, and an account-scoped one that refuses a malformed UUID before querying and filters `.eq('user_id', accountId)` (CLAUDE.md rule 4; SEC-3). Never one method with an optional account.
- **No `livemode` filter** (BD-13).
- Keyset paging on `id`, page size 1,000 (PostgREST's `max-rows`), **ceiling 5,000 rows** (`FINANCE_READ_LIMITS`, data). On the `>=` rule the read **returns the rows with `reachedCeiling: true`** (partial, "at least", AGG-3), unlike R-c, which errors. Every table holds 188 rows or fewer today (LC §5). R-i follows the same rule (SA-Q15).
- All-accounts methods log at `info` with counts and timing only.
- The overdue filters (R-g, R-h) use `.or()` on a **select**, confirmed safe (SA-Q15): it already runs in production on SELECT and head-count reads in `AdminJobsQueuesRepository`, and the known 42703 problem needs UPDATE plus `.or()` plus `.select()`. The filter string is built **only from literal statuses and the validated `YYYY-MM-DD`** (for example `status.eq.overdue,and(status.eq.sent,due_date.lt.<today>)`); the keyset `.gt('id', last)` and `.eq('user_id', …)` stay separate top-level filters.
- Money columns are converted by the caller at scale 100 (S2-CUR-3). **Refunds are read and summed by `amount`, never `amount_minor`** (SA-Q13).

| # | Method (example name) | Scope | Table and filter | Columns | Part |
|---|---|---|---|---|---|
| **R-e** | `listClientPaymentsAllAccountsPaidInRange(range)` | Named all-accounts | `payment_transactions`, `paid_at >= start` and `< end` | `id, user_id, amount, currency, status, paid_at, processor_fee, fee_currency, processor_type` | 2a |
| **R-e′** | `listClientPaymentsForAccountPaidInRange(accountId, range)` | Account-scoped | Same, plus `user_id` | Same | 2a |
| **R-f** | `listClientRefundsAllAccountsCreatedInRange(range)` | Named all-accounts | `payment_refunds`, `created_at` in the range (every status; split in Node; dated by `created_at`, SA-Q19) | `id, user_id, amount, currency, status, created_at` (`amount`, not `amount_minor`) | 2a |
| **R-f′** | `listClientRefundsForAccountCreatedInRange(accountId, range)` | Account-scoped | Same, plus `user_id` | Same | 2a |
| **R-g** | `listOverdueClientInvoicesAllAccounts(todayUtc)` | Named all-accounts | `payment_invoices`, status `overdue`, or status `sent` with `due_date < todayUtc` (`YYYY-MM-DD`, validated) | `id, user_id, amount, currency, status, due_date` | 2b |
| **R-g′** | `listOverdueClientInvoicesForAccount(accountId, todayUtc)` | Account-scoped | Same, plus `user_id` | Same | 2b |
| **R-h** | `listOverdueClientInstalmentsAllAccounts(todayUtc)` | Named all-accounts | `payment_plan_installments`, status `overdue`, or status `pending` with `due_date < todayUtc` | `id, user_id, subscription_id, amount, currency, status, due_date` | 2b |
| **R-h′** | `listOverdueClientInstalmentsForAccount(accountId, todayUtc)` | Account-scoped | Same, plus `user_id` | Same | 2b |
| **R-i** | `listClientPlansAllAccounts()` | Named all-accounts | `payment_plan_subscriptions`, every row (6 today) | `id, user_id, status, currency, cancelled_at, completed_at, next_charge_at, last_failure_at` | 2b |
| **R-i′** | `listClientPlansForAccount(accountId)` | Account-scoped | Same, plus `user_id` | Same | 2b |
| **R-j** (reused, not new) | `AdminJobsQueuesRepository.readQueueFiguresAllAccounts(context, 'payment_reminders', now)` | All accounts only (no account-scoped variant) | Existing: head counts and the oldest due time, through `ADMIN_QUEUE_SPECS.payment_reminders` | Existing `ADMIN_QUEUE_FIGURE_COLUMNS` | 2b |

**Reminders: reuse (SA-Q14, ruled).** The finance repository gets **no** reminder read and never reads `payment_reminders`. `AdminJobsQueuesRepository` already carries the one definition of stuck and dead-lettered (`ADMIN_QUEUE_SPECS.payment_reminders`, `STUCK_AFTER_SECONDS`, `DEAD_LETTER_MARKER`), and it feeds Jobs & queues and Health tile 7, so the three cannot disagree. Its callers are limited to `app/api/admin/**` after `requireAdmin`, so **the finance route** binds the context `{ correlationId, adminId }` and the queue id and injects a structural `readReminderFigures(now, signal)` into the builder (the `health-summary/route.ts` and `readJobsQueues` precedent, and the `findNames` precedent): `lib/business-os/finance/**` never names the repository, its singleton, `ADMIN_QUEUE_SPECS`, `STUCK_AFTER_SECONDS` or the marker. It is not called when a business is picked (S2-FR-21). It runs under `underDeadline` with an explicit finance deadline of **2 s** (`FINANCE_LIMITS.REMINDER_DEADLINE_MS`, written `2 * 1000`), not the default 5 s, and the signal is passed to the read (S2-F9). The part shows plain figures with no colour and the link; `buildJobsQueuesView` is not used.

**Wiring:** `financeHealthDeps.ts` exposes the R-e to R-i pairs through `finance: Pick<BusinessOsFinanceReadRepository, …>`, read only; the finance repository's one-caller pin is unchanged.

### 11A.8 Picked business (summary)

| Part | All businesses | One business picked |
|---|---|---|
| Takings, refunds, fees, per-business table (2a) | R-e, R-f | R-e′, R-f′ with exactly that id |
| Overdue invoices, instalments (2b) | R-g, R-h | R-g′, R-h′ with exactly that id |
| Client plans (2b) | R-i | R-i′ with exactly that id |
| Reminder health (2b) | R-j | **Not called**; platform-wide note and the Jobs & queues link |
| Names | Ids from rows already read | That business only |

When a business is picked, no all-accounts layer-B method and no R-j call is made (extends SEC-3 and AC-42).

### 11A.9 Non-functional (slice 2)

| Area | Requirement |
|---|---|
| Performance | Route p95 still under 2 s at today's volumes with the new reads (all concurrent and settled, S1-FR-8). The reminder read has its own 2 s deadline (S2-FR-20). SA-Q8's split rule stands: a section whose p95 crosses 1 s moves to its own route (SA-Q17). QA records `durationMs` in 2a and 2b. |
| Security | §3 in full; `tenant-isolation-guard` review on each workplan and code review; S2-FR-26 (no client data). |
| Logging | Pino only; counts, statuses and timing; never an amount, a currency total, a name or an email. |
| Accessibility | Status in text as well as colour; tables with header cells and labels; the Jobs & queues link has a descriptive name. |
| CI time | No new CI job and no added PR critical-path time: every test runs in the existing Jest gate. |
| Types | Scoped `tsc --noEmit` with a planted canary (AC-44, re-run as AC-72). |

### 11A.10 Acceptance criteria

All testable by Jest or by QA's recorded manual check. Figures quoted "today" are examples from LC; each AC is the match with its SQL check run at test time, not the number.

**AC to part mapping:**
- **2a:** AC-13, AC-45, AC-46, AC-47 to AC-55, AC-65 (2a reads), AC-66 (2a reads), AC-68 to AC-73.
- **2b:** AC-56 to AC-64, AC-65 (2b reads and R-j), AC-66 (2b reads), AC-67, AC-74, and a re-run of AC-45, AC-46 and AC-68 to AC-73 over the 2b diff.

**Currency helper**
- [ ] **AC-13** *(2a)* The money-grouping helper, given USD, `usd`, ILS and NULL-currency amounts, returns three lines (USD with `usd` merged, ILS, unknown currency) and exposes no cross-currency total (unit test). Also: `" ils "` is merged into ILS, and a code such as `US` or `USDX` goes to the unknown currency line.

**Access and input**
- [ ] **AC-45** *(2a; re-run 2b)* **Auth failure:** an unauthenticated request gets 401 and a non-admin (including a `profiles.role`-only "admin") gets 403, with no figures, and **no layer-B read is called** (R-e to R-j mocks show zero calls).
- [ ] **AC-46** *(2a; re-run 2b)* **Invalid input:** each AC-4, AC-33 and AC-34 case still returns 400 in the standard format with zero layer-B reads. Slice 2 adds no query parameter: an unknown key such as `currency` is still refused.

**Takings (2a)**
- [ ] **AC-47** *(2a)* For "This month", counted payments, gross and businesses (check 7 `counted_payments`, `gross`, `businesses_counted`), refunds and refunded (check 8) per currency match the SQL run at the time of the test, to the displayed precision; net equals gross minus refunded per currency.
- [ ] **AC-48** *(2a)* **Multi-currency:** payments in USD, `usd`, ILS and with a NULL currency give three lines (USD merged, ILS, Unknown currency), and refunds likewise; no element on the page, field in the payload or exported function holds a total across currencies (render test and source test).
- [ ] **AC-49** *(2a)* **Fee currency differs from charge currency:** an ILS payment with a USD fee puts the fee only on the USD fee line; the ILS takings line carries no fee; net is not reduced by any fee; "Fees recorded on N of M payments" is correct; the fee lines match check 9 summed per fee currency.
- [ ] **AC-50** *(2a)* A succeeded refund created in the window counts in its own currency even when its payment was in an earlier month; a refund in another state is counted as "not completed" and its amount is left out.
- [ ] **AC-51** *(2a)* **Ceiling** (injected small ceiling): R-e at its ceiling shows gross and counts as "At least", the block `partial` with a notice, and net "Unknown"; R-f at its ceiling shows refunded "At least" and net "Unknown".
- [ ] **AC-52** *(2a)* **Empty data:** with no payment and no refund in the window, the block says "No client payments recorded in this window" and "No refunds in this window", shows no currency line and no "0.00" figure, and its status is `ok`.
- [ ] **AC-53** *(2a)* An unreadable amount (not finite, or not a whole number of hundredths, S2-CUR-3), or a payment with another status, is left out of the sums and counted on the page; it is never a 0 and never dropped silently.
- [ ] **AC-54** *(2a)* The per-business table has one row per business and currency, sorted by currency then gross, at most 200 rows with a "Showing N of M" line; names come only from the route's lookup for ids already read; a platform account is labelled; there is no "Deleted business" row (S2-F6), and a NULL id, if one is ever read, shows "Unknown business".
- [ ] **AC-55** *(2a)* **BD-13:** the block shows no test-mode label, note or switch, and no layer-B method filters on `livemode` (source test on R-e to R-i).

**Client payment problems (2b)**
- [ ] **AC-56** *(2b)* Overdue invoices per currency (marked overdue, past due not marked, invoice amount, businesses, oldest due date) match check 10; the amount is labelled "Invoice amount" with the not-the-amount-still-owed note; switching the window (This month, 7d, a custom range) does **not** change them (as of now).
- [ ] **AC-57** *(2b)* **UTC boundary:** with injected `now` at 23:59 UTC and at 00:01 UTC the next day, an invoice and an instalment due on the first day become past due exactly at UTC midnight; a due date equal to today is never past due.
- [ ] **AC-58** *(2b)* Overdue instalments (marked overdue, pending past due date, instalment amount, businesses, oldest) match check 11; the amount is labelled "Instalment amount" with the same note.
- [ ] **AC-59** *(2b)* Client plans by status, active now, cancelled and completed in the window, and next charge overdue match check 12; the cancelled count follows the window.
- [ ] **AC-60** *(2b)* **Failed client payments** show the "not available" panel with its reason, never a 0 and never a tile; failed plan charges show "Not recorded" while no `last_failure_at` is set, and a count once one is (mocked).
- [ ] **AC-61** *(2b)* **Reminders:** the figures are exactly those `readQueueFiguresAllAccounts(context, 'payment_reminders', now)` returns; no finance file names `STUCK_AFTER_SECONDS`, the dead-letter marker or a reminder status literal (source test); the figures carry no colour; the link goes to `/admin/jobs-queues#queues`; stuck and dead-lettered agree with check 13.
- [ ] **AC-62** *(2b)* **Ceiling:** R-g, R-h or R-i at an injected small ceiling makes that part's figures "At least" and its status `partial`, with a notice.
- [ ] **AC-63** *(2b)* **Empty data:** "No overdue invoices", "No overdue instalments" and "No client payment plans" are shown as real zeros, status `ok`.
- [ ] **AC-64** *(2b)* **No client data:** the R-e to R-i column lists hold no contact, name, email, phone, notes or metadata column, and the payload carries none (column-list pin and payload test).

**Picked business**
- [ ] **AC-65** *(2a: R-e′, R-f′; 2b: R-g′, R-h′, R-i′, R-j)* With `accountId` set, each account-scoped layer-B call receives exactly that id; R-e, R-f, R-g, R-h, R-i and R-j have **zero** calls; the reminder part shows the platform-wide note and the link (extends AC-42).

**A section failing on its own**
- [ ] **AC-66** *(2a: R-e, R-f; 2b: R-g, R-h, R-i, R-j)* Each new read failing on its own (mocked error): R-e → the takings block "Could not load this section"; R-f → refunds and net "Unknown", gross still shown; R-g, R-h, R-i or R-j → only that part fails. The route returns 200 with per-section status, and every slice 1 section still renders.
- [ ] **AC-67** *(2b)* The reminder read running past its 2 s finance deadline (`FINANCE_LIMITS.REMINDER_DEADLINE_MS`, not the default 5 s) → "Could not check reminders" with the link; the page still renders.

**Standards and guards**
- [ ] **AC-68** *(2a; re-run 2b)* **Layout standard:** the new blocks use the shared `StatusChip` (text and icon, never colour alone), the shared table constants (numbers right-aligned, `tabular-nums`), the currency named on every money column or cell, "Unknown" or a dash for a missing value, `AdminNotice` for partial and `AdminEmpty` for empty; tables have header cells and an `aria-label`. The KPI strip still holds exactly K-1 to K-5.
- [ ] **AC-69** *(2a; re-run 2b)* Logs carry counts, statuses and timing only: no amount, no currency total, no business name, no email (re-run of AC-30).
- [ ] **AC-70** *(2a; re-run 2b)* Read-only: the route, the builder and the finance read repository name no insert, update, upsert, delete or writing RPC; the diff has no migration and no SQL function (re-run of AC-28).
- [ ] **AC-71** *(2a; re-run 2b)* Every slice 2 row of §12.2 passes, including the three Stripe webhook placement guards run unchanged, and AC-31 is re-run.
- [ ] **AC-72** *(2a; re-run 2b)* Scoped type check with a planted canary (re-run of AC-44).
- [ ] **AC-73** QA records a manual check of the critical path in the workplan's QA report. *(2a)* Admin opens Finance, sees the takings block for this month, cross-checks it against SQL checks 7 to 9, switches to 30d and to one business, and reloads the URL. *(2b)* Admin sees the client payment problems block, cross-checks it against SQL checks 10 to 13, follows the Jobs & queues link, and picks one business.

**Date-only due dates (2b)**
- [ ] **AC-74** *(2b)* With the process time zone set to `America/New_York` and to `Pacific/Auckland`, a due date of 2026-09-30 renders as 30 September and its overdue state follows AC-57 unchanged (unit and render test). The due date is compared as a `YYYY-MM-DD` value and never passed through `new Date` (S2-F5).

---

## 12. Testing and CI guards

### 12.1 Expected tests

| Type | What | Where | Slice |
|---|---|---|---|
| Unit (Jest) | Pure aggregation: plan-group mapping over every `LifecycleState` (sum = total); AI cost sums (exact integers, ceiling → "at least", deleted bucket split in Node); K-1 span arithmetic, floor, cut-over grey, inexact → amber; finance rule evaluation and threshold-in-data; sibling preset resolution in UTC with Activity parity; URL `parse` / `serialise`. | Co-located `*.test.ts` | 1a |
| Unit (Jest) | Credits position and over-allowance via the SA-Q7 core; gifted outstanding via `extraCreditsAt` after the `admin_grant` filter; `readAdminCreditsLeft` unchanged. | Co-located `*.test.ts` | 1b |
| Unit (Jest) | Money grouping by currency (CUR-1, CUR-2, AC-13); scale 100 via `Math.round(n * 100)`, with non-finite and non-whole-hundredths values counted as unreadable (S2-CUR-3). | Co-located `*.test.ts` | 2 |
| Unit (Jest) | Takings builder: gross, refunded and net per currency; refunds summed by `amount`; fees by fee currency; other status and unreadable amounts counted; ceiling → "at least" and net "Unknown"; per-business rows and cap; no "Deleted business" row. | Co-located `*.test.ts` | 2a |
| Unit (Jest) | Payment problems builder: the as-of-now overdue rule with injected `now` around UTC midnight, comparing date-only `YYYY-MM-DD` values, never through `new Date`; days past due as a whole UTC-day difference; `formatUtcDate` in two process time zones (AC-74); client plan counts with the window; the failed-charges "not recorded" switch; reminder figures mapped unchanged, with no colour. | Co-located `*.test.ts` | 2b |
| Integration (Jest) | Route: happy path; 401; 403 (non-admin, and `profiles.role`-only "admin"); 400 for each invalid input in AC-4, AC-33, AC-34; 404 unknown business and platform id; 500 on throw; `no-store` on every response; section failure isolation; `accountId` scoping (AC-42). | `__tests__/` next to the route | 1a (+1b) |
| Integration (Jest) | Route, slice 2: the new sections in the payload; zero layer-B reads on 401, 403 and 400; each new read failing alone; `accountId` scoping of R-e to R-i and no R-j call (AC-65); the 2 s reminder deadline (AC-67). | `__tests__/` next to the route | 2a, 2b |
| Repository (Jest) | Each new method in §10.8: one unit test each, including the named all-accounts rule, the explicit column list, `livemode = true`, ceiling behaviour, and for the new finance read repository a no-write source pin. | `lib/repositories/__tests__/` | 1a (R-a, R-c, R-c′, R-d), 1b (R-b) |
| Repository (Jest) | Each new method in §11A.7: exact column list, no `livemode` filter, the account-scoped method refuses a malformed id and filters `user_id`, keyset paging, ceiling → rows with `reachedCeiling`, never throws; the no-write pin and one-caller pin unchanged. | `lib/repositories/__tests__/` | 2a (R-e, R-f), 2b (R-g, R-h, R-i) |
| Render (Jest) | Takings and problems blocks: no cross-currency total, no test-mode label, the "not available" panel, the Jobs & queues link, empty and partial states, status chips with text. | `app/admin/finance/__tests__/` | 2a, 2b |
| Source guards | No write, no aggregate select, no raw `token_usage`, no grouping on raw `service`, no tier literal. | Next to the service | 1a |
| Source guards | No exported cross-currency total; no `exchange_rates`; no `livemode` in layer-B reads; no reminder rule literal in finance code (AC-61). | Next to the service | 2a, 2b |
| Manual (QA) | AC-32; scoped `tsc` with canary (AC-44). | Workplan QA report | 1a, 1b |
| Manual (QA) | AC-73; scoped `tsc` with canary (AC-72). | Workplan QA report | 2a, 2b |

Before any commit, QA confirms at minimum the happy path and one failure path are tested (CLAUDE.md Testing).

### 12.2 CI guards that will apply

This table is SA's guard table from the SA review (SA-F5), replacing the earlier BA list.

| Guard | Trips because | What Dev must do | Slice |
|---|---|---|---|
| `enforcementPoints.test.ts` (entitlements importer registration) | The Section 1 classifier imports `deriveLifecycle`, `fromPlanRow`, the config getter and the `report.ts` predicates | Add `{ file, symbols, why }` to `KNOWN_NON_GATE_IMPORTERS` with the exact symbol list ("display only, refuses nothing"). `adminCreditPercent.ts`'s entry stays the same (SA-Q7) | 1a, plus 1b if symbols change |
| `businessOsEntitlements.imports.guard.test.ts` (RC-15) | The finance wiring names `businessOsAccountPlanRepository` (`pagePlans`); a **type-only** import of the plan type matches by path too | Add the wiring file (and its test) to `ALLOWED` **and** `NO_STATE_WRITE_REFERRERS`, and pin `pagePlans` and `findEntitlementInputs` (the `ADMIN_CREDITS_LEFT_METHOD` precedent) | 1a |
| `BusinessOsCreditLedgerReadRepository.test.ts` exact caller list (`:937-976`; corrected by SA 2026-10-09, was `:950-975`) | The new finance wiring names the ledger read repository | Add it to the list; amend the repository header's caller paragraph (the B1a / B2a precedent) | 1a |
| `serviceColumn.guard.test.ts` (N-10) | Scans only `lib/business-os/credits/**` plus listed Activity files | Put the finance builder under `lib/business-os/credits/`, or add the finance files to the guard's scanned list. Group only through `resolveEffectiveFields` | 1a |
| G3 in `creditLots.test.ts` (`:201-228`, exact list plus a non-vacuity check) | The finance wiring names `businessOsCreditLotRepository`; the credits builder names `extraCreditsAt` | Add both product files and their tests to `ALLOWED_LIST` with a slice comment | 1b |
| `BusinessOsCreditLotRepository.test.ts` | New method | One unit test: no `user_id` filter by name, column list, ceiling → error | 1b |
| `creditFigures.fromConfig.guard.test.ts` | Only if a new file names `creditAllowanceForDisplay` (avoided by SA-Q7). Note: a bare `2000` / `2_000` is the trial allowance and fails the guard (write budgets as `2 * 1000`) | Nothing if SA-Q7 is followed; otherwise add the file to `SOURCES` | 1b |
| `tierLiteral.forbidden.test.ts` | Any `'basic'` / `'pro'` literal | None allowed (SA-F6) | 1a |
| Admin authz surface guard | New `app/api/admin/**` route and new `/admin` page | `requireAdmin` first statement; page under the guarded layout, no `route.ts` in `app/admin/**` | 1a |
| `AdminSidebar.nav.test.ts` | New Monitor entry | Update the pinned list | 1a |
| Health tests (`lib/admin/health/__tests__`) | SA-Q1 type widening | Must pass **unchanged** | 1a |
| New read-only finance repository tests | New repository (SA-F2) | Column list, `livemode = true`, head-count existence, no-write source pin | 1a |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts:86-88` | **TRIPPED in 2a** (S2-F1). The assertion forbids `payment_transactions\|payment_refunds\|payment_plan_` in every file of `FILES`, and `FILES` includes `lib/repositories/BusinessOsFinanceReadRepository.ts` (`:44`), which is exactly where R-e to R-i go | **Narrow the rule plus a positive pin on the repository's tables.** Narrow the slice-1 assertion to the builder, route, page and billing files, which still never name a payment table. Add a positive pin that the repository's `.from(...)` tables are exactly the three layer-A tables plus the five layer-B tables (`payment_transactions`, `payment_refunds` in 2a; `payment_invoices`, `payment_plan_installments`, `payment_plan_subscriptions` in 2b), with a planted negative control. The repository never reads `payment_reminders` (R-j owns it) | 2a (2b adds its three tables to the pin) |
| `BusinessOsFinanceReadRepository.test.ts` (no-write source pin; one caller, `financeHealthDeps.ts`) | New methods R-e to R-i | One unit test per method (§12.1). The no-write pin and the one-caller pin stay unchanged; the repository header's method list is extended, and its "named in words only, never by class name" rule for writer repositories still holds | 2a, 2b |
| Stripe webhook placement guards: `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts`, `app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts`, `lib/payments/__tests__/planSurfaces.guard.test.ts` | They pin who may touch the payment tables and the payment writer repositories | **Not tripped (verified by SA, SA-Q16):** `routerPlacement` reads only the webhook route and `lib/business-os/billing/*.ts`; `invoiceIntentsStayUnowned` pins `PaymentRepository` and the Stripe routes; `planSurfaces` pins named files; none scans the finance read repository. Dev still runs all three unchanged before SA code review and pastes the result; any trip goes to SA, never a silent list edit | 2a, 2b |
| `lib/repositories/__tests__/AdminJobsQueuesRepository.test.ts` isolation guard (name-based, `:234-262`; barrel included) | The finance route calls `readQueueFiguresAllAccounts` (R-j) | **Passes with no list edit** (S2-F3): the guard is name-based and the finance route is under `app/api/admin/**`. The rule to hold: no `lib/business-os/finance/**` file names the repository or its singleton | 2b |
| `app/admin/finance/__tests__/source.guard.test.ts` | New block components | Only type imports from `lib/business-os/finance/`; no repository; no `console.` | 2a, 2b |
| Shared layout folder guard (C-14, `app/admin/components/layout/__tests__/`) | The finance page imports shared exports through the alias; 2b builds `formatUtcDate` in the shared folder | Rules S-1 to S-10 hold for the new export; the migrated-pages registry is **not** changed (the page shell is not migrated, DF-4) | 2a, 2b |
| New finance source guards (§12.1) | `currencyGroups` and the layer-B builders | No exported cross-currency total; no `exchange_rates`; no `livemode` in layer-B reads; no reminder rule literal | 2a, 2b |

**Not tripped:** L8, BD-26 owner-read, `businessOwnedTables` / purge descriptors, `adminReadMethods`, `accountSeam.guard` (if SA-Q7 is followed), billing-account and billing-event caller lists, boost repository pins (SA-F2 keeps the page off them). **No new CI job and no added PR critical-path time:** every new test runs in the existing Jest gate or the existing `test:bos-entitlements` job.

**Not tripped by slice 2 (expected; SA confirms):** `enforcementPoints` (no new entitlements import), RC-15, the ledger caller list, G3, `tierLiteral.forbidden`, N-10, `businessOwnedTables` and purge descriptors (no new table), and the billing-account, billing-event and boost pins. Also **`adminReadMethods.guard`** (S2-F3): `readQueueFiguresAllAccounts` is not in `ADMIN_METHODS` (`:479-490`), so the R-j call does not trip it; Dev still runs it unchanged. The three Stripe webhook placement guards are not tripped either (SA-Q16, row above).

**Dev must run, before SA code review, and paste the results in the workplan:** `npm run test:bos-entitlements`, `npm run test:authz-guard`, the Health tests, the sidebar nav test, `npm run lint:hooks`, eslint on touched files, and the scoped `tsc` with canary (AC-44).

---

## 13. Read-only SQL cross-checks for slice 1

The user can paste each script into the Supabase SQL editor to cross-check the page. Each script is read-only and returns **one final result set** (the editor shows only the last one). Months are UTC calendar months. Checks 1 to 3 and 6 back slice 1a; checks 4 and 5 back slice 1b.

**File:** `check 1 - accounts by plan` (AC-9)

```sql
-- Finance page check 1: accounts by cohort, tier and origin, read only.
-- Compare with Section 1 and tile K-3.
-- cohort_already_ended counts rows whose cohort end date has passed.
select
  coalesce(p.cohort, '(none)') as cohort,
  coalesce(p.tier, '(none)') as tier,
  coalesce(p.origin, '(none)') as origin,
  count(*) as accounts,
  count(*) filter (where p.cohort_expires_at is null) as no_cohort_end_date,
  count(*) filter (where p.cohort_expires_at <= now()) as cohort_already_ended,
  count(*) filter (where p.created_at >= date_trunc('month', now(), 'UTC')) as created_this_month_utc
from public.business_os_account_plans p
group by 1, 2, 3
order by 1, 2, 3;
```

**File:** `check 2 - AI cost this month` (AC-10)

```sql
-- Finance page check 2: AI cost this UTC calendar month, read only.
-- One row per kind and trigger, plus a final all rows total.
-- deleted_account_rows counts rows whose account was deleted.
with w as (
  select date_trunc('month', now(), 'UTC') as month_start,
         date_trunc('month', now(), 'UTC') + interval '1 month' as month_end
)
select
  coalesce(c.kind, '(all)') as kind,
  coalesce(c.triggered_by, case when grouping(c.triggered_by) = 1 then '(all)' else '(none)' end) as triggered_by,
  count(*) as charge_rows,
  sum(c.cost_usd) as cost_usd,
  sum(c.credits) as credits,
  count(*) filter (where c.user_id is null) as deleted_account_rows
from public.business_os_credit_charges c, w
where c.created_at >= w.month_start
  and c.created_at < w.month_end
group by grouping sets ((c.kind, c.triggered_by), ())
order by grouping(c.kind), 1, 2;
```

**File:** `check 3 - top accounts by AI cost this month` (Section 3 top 10)

```sql
-- Finance page check 3: top 10 accounts by AI cost this UTC month, read only.
-- Deleted accounts are excluded here; their total is deleted_account_rows in check 2.
select
  c.user_id,
  count(*) as charge_rows,
  sum(c.cost_usd) as cost_usd,
  sum(c.credits) as credits
from public.business_os_credit_charges c
where c.created_at >= date_trunc('month', now(), 'UTC')
  and c.created_at < date_trunc('month', now(), 'UTC') + interval '1 month'
  and c.user_id is not null
group by c.user_id
order by sum(c.cost_usd) desc
limit 10;
```

**File:** `check 4 - latest credit period per account` (AC-11)

```sql
-- Finance page check 4: latest credit totals row per account, read only.
-- The page shows the CURRENT credit period. If period_start below is older
-- than the current period of that account, the page shows 0 used.
-- Trial accounts sum all rows since the trial anchor, not only the latest row.
-- Allowances live in configuration, not in the database, so compare used only.
select distinct on (t.user_id)
  t.user_id,
  t.period_start,
  t.credits_total,
  t.charge_count
from public.business_os_credit_totals t
where t.period_start <= now()
order by t.user_id, t.period_start desc;
```

**File:** `check 5 - gifted credits outstanding` (AC-11, tile K-4)

```sql
-- Finance page check 5: admin granted credits minus taken back, read only.
-- Outstanding counts only lots that are not expired now.
with grants as (
  -- Lots of deleted accounts (user_id NULL) are left out, as on the page (SA-W9).
  select l.id, l.credits_granted, l.expires_at
  from public.business_os_credit_lots l
  where l.source = 'admin_grant'
    and l.user_id is not null
),
taken as (
  select d.lot_id, sum(d.credits) as taken_back
  from public.business_os_credit_lot_draws d
  where d.kind = 'reversal'
  group by d.lot_id
)
select
  count(g.id) as grant_lots,
  coalesce(sum(g.credits_granted), 0) as granted,
  coalesce(sum(t.taken_back), 0) as taken_back,
  coalesce(sum(greatest(g.credits_granted - coalesce(t.taken_back, 0), 0))
    filter (where g.expires_at is null or g.expires_at > now()), 0) as outstanding_not_expired
from grants g
left join taken t on t.lot_id = g.id;
```

**File:** `check 6 - is there any live platform revenue` (AC-22, AC-23)

```sql
-- Finance page check 6: live mode platform revenue rows, read only.
-- All zeros means the None yet panel is correct.
select 'plan_invoice_paid_live' as source, count(*) as row_count
from public.business_os_billing_events e
where e.livemode = true and e.kind = 'invoice_paid'
union all
select 'boost_paid_live', count(*)
from public.business_os_boost_purchases b
where b.livemode = true and b.paid_at is not null
union all
select 'billing_accounts_live', count(*)
from public.business_os_billing_accounts a
where a.livemode = true;
```

### Slice 2 checks (7 to 13)

Checks 7 to 9 back slice 2a; checks 10 to 13 back slice 2b. The same rules hold: read-only, ASCII only, one final result set each. Months are UTC calendar months and "today" is the current UTC date. Every amount stays in its own currency; no check adds two currencies. A currency shown as `(NONE)` is the page's "Unknown currency" line. Currency codes are **trimmed and upper-cased**, as on the page (S2-CUR-2, S2-F8). A code that is not three letters A to Z would still show here under its own text while the page puts it on the "Unknown currency" line; that difference is accepted because no such code exists today.

**File:** `check 7 - client payments this month by currency` (AC-47, AC-48)

```sql
-- Finance page check 7: client payments this UTC month by currency, read only.
-- Compare with Section 2 block B: payments, gross and businesses per currency.
-- Gross adds succeeded and refunded payments; other statuses are only counted.
-- The page counts payments and businesses over succeeded and refunded rows only.
select
  upper(trim(coalesce(t.currency, '(none)'))) as currency,
  count(*) as payment_rows,
  count(*) filter (where t.status = 'succeeded') as succeeded_rows,
  count(*) filter (where t.status = 'refunded') as refunded_rows,
  count(*) filter (where coalesce(t.status, '') not in ('succeeded', 'refunded')) as other_status_rows,
  sum(t.amount) filter (where t.status in ('succeeded', 'refunded')) as gross,
  count(*) filter (where t.status in ('succeeded', 'refunded')) as counted_payments,
  count(distinct t.user_id) filter (where t.status in ('succeeded', 'refunded')) as businesses_counted,
  count(distinct t.user_id) as businesses
from public.payment_transactions t
where t.paid_at >= date_trunc('month', now(), 'UTC')
  and t.paid_at < date_trunc('month', now(), 'UTC') + interval '1 month'
group by 1
order by 1;
```

**File:** `check 8 - client refunds this month by currency` (AC-47, AC-50)

```sql
-- Finance page check 8: client refunds created this UTC month by currency, read only.
-- Compare with the refunds part of Section 2 block B.
-- Only succeeded refunds are added up; the others are only counted.
-- The page sums amount, not amount_minor.
-- refunded_minor equals refunded times 100 for two-decimal currencies such as USD and ILS.
select
  upper(trim(coalesce(r.currency, '(none)'))) as currency,
  count(*) as refund_rows,
  count(*) filter (where r.status = 'succeeded') as succeeded_rows,
  count(*) filter (where coalesce(r.status, '') <> 'succeeded') as not_completed_rows,
  sum(r.amount) filter (where r.status = 'succeeded') as refunded,
  sum(r.amount_minor) filter (where r.status = 'succeeded') as refunded_minor
from public.payment_refunds r
where r.created_at >= date_trunc('month', now(), 'UTC')
  and r.created_at < date_trunc('month', now(), 'UTC') + interval '1 month'
group by 1
order by 1;
```

**File:** `check 9 - recorded fees this month by fee currency` (AC-49)

```sql
-- Finance page check 9: recorded processor fees this UTC month, read only.
-- The page groups fees by fee_currency only. The charge_currency column shows
-- that a fee can be in another currency than its payment.
-- To compare with a page fee line, add up fees over the rows of one fee_currency.
select
  upper(trim(coalesce(t.fee_currency, '(none)'))) as fee_currency,
  upper(trim(coalesce(t.currency, '(none)'))) as charge_currency,
  count(*) as payment_rows,
  count(t.processor_fee) as rows_with_fee,
  sum(t.processor_fee) as fees
from public.payment_transactions t
where t.paid_at >= date_trunc('month', now(), 'UTC')
  and t.paid_at < date_trunc('month', now(), 'UTC') + interval '1 month'
  and t.status in ('succeeded', 'refunded')
group by 1, 2
order by 1, 2;
```

**File:** `check 10 - overdue client invoices as of now` (AC-56, AC-57)

```sql
-- Finance page check 10: overdue client invoices as of now, read only.
-- Overdue now means status overdue, or status sent with a due date before
-- the current UTC date. The date window of the page does not apply.
-- amount is the full invoice amount, not the amount still owed.
select
  upper(trim(coalesce(i.currency, '(none)'))) as currency,
  count(*) filter (where i.status = 'overdue') as marked_overdue,
  count(*) filter (where i.status = 'sent') as sent_past_due,
  sum(i.amount) as amount,
  min(i.due_date) as oldest_due_date,
  count(distinct i.user_id) as businesses
from public.payment_invoices i
where i.status = 'overdue'
   or (i.status = 'sent' and i.due_date < (now() at time zone 'UTC')::date)
group by 1
order by 1;
```

**File:** `check 11 - overdue client instalments as of now` (AC-58)

```sql
-- Finance page check 11: overdue or past due client instalments as of now, read only.
-- Overdue now means status overdue, or status pending with a due date before
-- the current UTC date. The date window of the page does not apply.
-- amount is the full instalment amount, not the amount still owed.
select
  upper(trim(coalesce(p.currency, '(none)'))) as currency,
  count(*) filter (where p.status = 'overdue') as marked_overdue,
  count(*) filter (where p.status = 'pending') as pending_past_due,
  sum(p.amount) as amount,
  min(p.due_date) as oldest_due_date,
  count(distinct p.user_id) as businesses
from public.payment_plan_installments p
where p.status = 'overdue'
   or (p.status = 'pending' and p.due_date < (now() at time zone 'UTC')::date)
group by 1
order by 1;
```

**File:** `check 12 - client payment plans` (AC-59, AC-60)

```sql
-- Finance page check 12: client payment plans by status, read only.
-- cancelled_this_month and completed_this_month use the UTC calendar month.
-- next_charge_overdue counts active plans whose next charge time has passed.
-- failure_recorded counts plans with any stored failure time.
select
  coalesce(s.status, '(none)') as status,
  count(*) as plans,
  count(*) filter (where s.cancelled_at >= date_trunc('month', now(), 'UTC')
    and s.cancelled_at < date_trunc('month', now(), 'UTC') + interval '1 month') as cancelled_this_month,
  count(*) filter (where s.completed_at >= date_trunc('month', now(), 'UTC')
    and s.completed_at < date_trunc('month', now(), 'UTC') + interval '1 month') as completed_this_month,
  count(*) filter (where s.status = 'active' and s.next_charge_at < now()) as next_charge_overdue,
  count(*) filter (where s.last_failure_at is not null) as failure_recorded
from public.payment_plan_subscriptions s
group by 1
order by 1;
```

**File:** `check 13 - payment reminders` (AC-61)

```sql
-- Finance page check 13: payment reminders by status, read only.
-- Compare with the reminder part of Section 6 block B and with Jobs and queues.
-- stuck: processing with no claim, or a claim older than 690 seconds (90 plus 600).
-- dead_lettered: failed with the fixed dead letter marker. The page shows the
-- last 24 hours and 7 days; this check counts all time.
select
  coalesce(r.status, '(none)') as status,
  count(*) as reminders,
  count(*) filter (where r.status = 'processing'
    and (r.claimed_at is null or r.claimed_at < now() - interval '690 seconds')) as stuck,
  count(*) filter (where r.status = 'failed'
    and r.error_message = 'dead-letter: max attempts') as dead_lettered,
  max(r.attempts) as max_attempts
from public.payment_reminders r
group by 1
order by 1;
```

---

## 14. Open questions for SA

Technical questions only; none needs the user. **All twelve are ruled (§0.3, 2026-10-09) and applied to the body above.** The BA suggestion is kept for the record.

| # | Question | BA suggestion | Status |
|---|---|---|---|
| **SA-Q1** | KPI rules: generalise Health's closed tile / rule types (`rules.ts:128-164`) so a second rule set can use the evaluator, or a local finance rule set reusing the condition kinds? | Whichever leaves Health's types and tests untouched; a local rule set reusing the pure evaluation functions looks smallest | Ruled (§0.3): local rule set + type-only widening; applied §7.2 |
| **SA-Q2** | Presets: extend `activityPresets.ts` with `7d`, `30d`, `custom`, or a sibling for the layout standard? And approve the URL-held filters (L-4) as the new admin pattern? | Sibling `adminWindowPresets` sharing the UTC helpers, so Activity is unchanged | Ruled (§0.3): sibling; L-4 approved with conditions; applied §4, S1-FR-3, S1-FR-7 |
| **SA-Q3** | Section 1: reuse the shadow report's paged walk as-is, or factor out a shared reader for the shadow report and this page? | Factor out only the walk, if the shadow report's own tests stay unchanged | Ruled (§0.3): own walk, `report.ts` exports predicates; applied §8.1, S1-FR-14 |
| **SA-Q4** | Show the `token_usage` cost beside the ledger cost in slice 1? If yes, `monthly_token_usage` or `business_os_usage_summary`, through which repository? | Not in slice 1; link to AI cost & usage | Ruled (§0.3): not in slice 1; applied §8.3, S1-FR-20 |
| **SA-Q5** | Paying vs comped needs an all-accounts read of `business_os_billing_accounts` (0 rows today). Add a named `…ForAdmin` read now, or show the fallback "Tier set" group until slice 5? And which `subscription_status` values count as paying (align with P-8a)? | Add the read now (tiny, no migration); status set from P-8a | Ruled (§0.3): read now in new finance repository; {active, past_due}; applied §8.1, R-c |
| **SA-Q6** | Ledger read for a calendar window: is `listChargesAllAccountsInWindow` (plus the deleted-accounts read) the right path, and is 20,000 rows the right ceiling? | Yes, reuse; 20,000 as in the cost report | Ruled (§0.3): no; new paged method, ceiling 20,000; applied §8.3, S1-FR-17, R-a |
| **SA-Q7** | Credits section: extend the credit-percent pass to return counts, or a sibling builder sharing its reads? The Businesses list must stay percent-only (FR-48). | Sibling builder sharing the deps, so the list's contract is untouched | Ruled (§0.3): one core, two projections; applied §8.4, S1-FR-23 |
| **SA-Q8** | One route returning all sections, or one route per section? | One route with per-section status for slice 1; split later if a section gets slow | Ruled (§0.3): one route; applied S1-FR-7, S1-FR-8 |
| **SA-Q9** | (Slice 2) Layer B has no `livemode`: can test-mode client payments be told apart (`processor_type`, `charge_account_kind`, the Connect account), and should they be excluded? | Decide in slice 2's workplan | Ruled (§0.3): deferred to slice 2 workplan with schema check; applied §8.2. **Resolved 2026-10-11 by user decision BD-13** (show together, treat as real, no label, no migration; DF-3) |
| **SA-Q10** | Gifted outstanding needs lots and draws across all accounts; the lot repository's reads are all account-scoped. Add a named all-accounts read, or loop over the (8) accounts with batched reads? G3 caller list must be updated either way. | A named all-accounts read, read-only, with its own test | Ruled (§0.3): named all-accounts read via `Pick<>`; applied §8.4, R-b |
| **SA-Q11** | Confirm no audit entry for reading the page (SEC-10). | No audit, matching the cost report | Ruled (§0.3): confirmed; applied SEC-10, S1-FR-10 |
| **SA-Q12** | K-1's comparison span ("same elapsed span of last month") and base minimum (USD 1.00): acceptable as the BD-11 "month on month" interpretation? | Yes; both stored as rule data | Ruled (§0.3): span accepted; base minimum replaced by `floor` + cut-over grey; applied §7.1, AC-7, AC-15, AC-18 |

### Slice 2 questions (open, raised 2026-10-11)

Technical questions only; none needs the user (BD-13 settled the only business question). Each has a BA suggestion.

| # | Question | BA suggestion | Status |
|---|---|---|---|
| **SA-Q13** | Exact sums for layer B: `amount`, `processor_fee` and the refund `amount` are Postgres `numeric`. Which fixed integer scale, and parse from the JSON number or ask PostgREST for text? Use the refund's `amount` (same scale as payments) or `amount_minor`? | Integers at 4 decimal places, parsed from the value's decimal text (a value with more decimals is "unreadable", S2-CUR-3); use `amount` for refunds, with check 8 comparing it to `amount_minor` | Ruled 2026-10-11 (§0.3) |
| **SA-Q14** | Reminder health: reuse `AdminJobsQueuesRepository.readQueueFiguresAllAccounts` from the finance route and inject it (R-j), or add a reminder read to the finance repository? Which deadline? And should the part show the Jobs page's queue status, which needs `buildJobsQueuesView` and the run summary, or plain figures plus the link? | Reuse and inject from the route (one definition of stuck and dead-lettered; §11A.7); `underDeadline` with the Jobs page budget; plain figures without colour plus the link (layout standard K-5) | Ruled 2026-10-11 (§0.3) |
| **SA-Q15** | Layer-B reads: keyset on `id` with page 1,000 and ceiling 5,000, returning rows with `reachedCeiling` (partial) instead of erroring like R-c; and `.or()` filters on a SELECT for R-g / R-h. Confirm both. | Confirm; the `.or()` problem on record is UPDATE plus `.or()` plus `.select()`, not a read | Ruled 2026-10-11 (§0.3) |
| **SA-Q16** | Do the Stripe webhook placement guards (`routerPlacement.guard`, `invoiceIntentsStayUnowned.guard`, `planSurfaces.guard`) match on payment table names, so that the finance read repository naming `payment_*` tables in `.from(...)` trips one of them? If so, how should a read-only admin reader be registered? | Expected not tripped (they pin the writer repositories and routes); SA runs them on the 2a branch; if one trips, add the finance read repository as a named read-only exception with a reason, never weaken the rule | Ruled 2026-10-11 (§0.3) |
| **SA-Q17** | One route still? Slice 2 adds up to six concurrent reads and the reminder read. | Keep one route (SA-Q8); measure p95 in each workplan and split a section only if it crosses 1 s | Ruled 2026-10-11 (§0.3) |
| **SA-Q18** | Layout standard: 2a / 2b import shared components but do not migrate the page shell (DF-4). 2b builds the deferred shared `formatUtcDate`, which runs that part on the full cycle (layout R-7). Confirm both, and confirm the shell adoption is its own slice after 2b (renaming the URL params to `range` / `account`, with `preset` / `accountId` as legacy aliases, and replacing `router.replace` with `useAdminFilters`). | Confirm: new blocks on the standard now; shell in its own UI slice after 2b, because a layout migration must not ride in a data slice | Ruled 2026-10-11 (§0.3) |
| **SA-Q19** | Refunds by `created_at` or by `succeeded_at`? Both are present; every refund is succeeded today. | `created_at`: one window column for every status, so a refund that is not completed can be counted beside the succeeded ones; Stripe refunds succeed within seconds | Ruled 2026-10-11 (§0.3) |

---

## 15. Out of scope / future roadmap

- Everything listed as non-goals in §1.2.
- FX conversion or a combined multi-currency figure (BD-12).
- Per-business AI cost beyond per login while one login = one business (D X-8).
- Real Stripe fees on platform revenue (needs a fee column, plan payments / boosts work).
- Owner-facing finance views, exports, scheduled reports.
- Adoption of the layout standard (§4) by other admin pages (each a separate, UI-only change).
- Businesses without a plan row on this page (DF-2; shadow report only).
- Filtering out test businesses or users from the layer-B figures (DF-3, BD-13).
- The finance page shell adopting the shared admin layout standard (DF-4), as its own UI slice after 2b.
- Failed client payments and failed client charge details: not stored today (live check §3); showing them needs a writer that records failures, which belongs to the payments work, not this page.
- A KPI tile for layer B (for example overdue client invoices): needs its own business decision and threshold (§11A.6).

---

## 16. Notes on integration points

| Area | Affected (read-only) | Notes |
|---|---|---|
| Admin shell | `app/admin/components/AdminSidebar.tsx`, its nav test | New Monitor entry (1a) |
| Health | `lib/admin/health/rules.ts`, `evaluateHealth.ts`; `app/admin/components/health/HealthTile.tsx` (`STATUS_STYLES` only) | Type-only widening of evaluator generics (SA-Q1); Health behaviour and tests must not change |
| Activity view | `activityPresets.ts` (parity test only, not edited), `BusinessAccountPicker`, `CutoverNotice`, `cutoverClamp` | Reused; Activity behaviour must not change; `ActivityTable` not reused (L-6) |
| Shared admin components | New sibling preset module; new URL `parse` / `serialise` module | SA-Q2, L-4 |
| Entitlements | `deriveLifecycle`, `fromPlanRow`, config getter, `report.ts` (new exports `lifecycleInputs` + two predicates; control flow untouched) | Registered non-gate importer (§12.2) |
| Credits | `BusinessOsCreditLedgerReadRepository` (new R-a), `adminCreditPercent.ts` (SA-Q7 refactor, 1b), `creditLots.ts` (`extraCreditsAt`), `BusinessOsCreditLotRepository` (new R-b, 1b) | No write |
| Billing | `lib/business-os/billing/` (new exported paying-status constant, SA-Q5) | For P-8a to adopt |
| New repository | `BusinessOsFinanceReadRepository` (R-c, R-c′, R-d), read-only | Keeps the page off the billing-account, billing-event and boost repositories' caller lists |
| Plan payments | `business_os_billing_accounts`, `business_os_billing_events` (status and existence only in slice 1, via the new repository) | Writers are P-3b.2 / P-6a; never called |
| Boosts | `business_os_boost_purchases` (existence only in slice 1, via the new repository) | Admin read in slice 4 |
| Tables | `business_os_account_plans`, `business_os_credit_charges`, `business_os_billing_accounts`, `business_os_billing_events`, `business_os_boost_purchases` (1a); `business_os_credit_totals`, `business_os_credit_lots`, `business_os_credit_lot_draws` (1b); `payment_*` (slice 2); `business_os_invites`, `business_os_account_lineage` (slice 3) | All live-verified (LS:151) |
| Not touched | Legacy agent-platform billing tables, `exchange_rates`, `token_usage` raw | NG-5, AGG-4 |
| Client payments (layer B, slice 2) | `payment_transactions`, `payment_refunds` (2a); `payment_invoices`, `payment_plan_installments`, `payment_plan_subscriptions` (2b), all through new R-e to R-i in `BusinessOsFinanceReadRepository` | Live-verified 2026-10-11 (LC). The payment writer and owner-scoped repositories and the Stripe webhook are not touched or named (§12.2 placement guards) |
| Jobs & queues | `AdminJobsQueuesRepository.readQueueFiguresAllAccounts` with `ADMIN_QUEUE_SPECS.payment_reminders` (R-j, 2b), called by the finance route only | Reused unchanged; the page links to `/admin/jobs-queues#queues` |
| Shared admin layout | `app/admin/components/layout/` (`StatusChip`, `adminTable.ts`, `AdminNotice`, `AdminEmpty`, formatters; 2b adds `formatUtcDate`) | Slice 2 blocks follow the standard; the page shell adopts it later (DF-4) |

---

## SA Requirement Review — 2026-10-09

**Reviewed by:** SA, against the code at `origin/main @ 88f97171` (every cited file opened; the citations were checked, not trusted) and the live schema in LS.
**Verdict: APPROVED WITH CONDITIONS.** The business definitions (BD-1 to BD-12) are sound and none is technically unworkable. The architecture is right: reads only, no migration, no SQL function, bounded paged reads summed in Node, honest indicators, Health's evaluator reused. Four things must change before a workplan. (1) The proposed AI-cost read path silently caps at 100 rows (SA-F1). (2) Slice 1 needs new repository methods the requirement does not list (SA-F2). (3) Slice 1 is more than a few days and is split (SA-F3). (4) K-1's lower-bound and base-minimum rules contradict Health's evaluator (SA-F4). Rulings on SA-Q1 to SA-Q12 are in §0.3; this section holds the findings behind them.

### Findings

| # | Severity | Finding | Required change |
|---|---|---|---|
| **SA-F1** | **High** | SA-Q6 / S1-FR-17 name `listChargesAllAccountsInWindow` for the AI-cost sum. In code (`BusinessOsCreditLedgerReadRepository.ts:754-770`, `pageOfCharges` `:910-924`) it reads **one** page capped at `CHARGE_LIST_LIMITS.MAX_LIMIT` = 100, **charge rows only** (`chargeQuery` `.eq('kind','charge')`), and **excludes** deleted accounts. A sum over it would be wrong above 100 actions a month (265 rows exist today) and would drop every correction. `listChargesOfDeletedAccountsInWindow` is charges only too. | BA: rewrite S1-FR-17 and S1-FR-18 per the SA-Q6 ruling: one new named all-accounts method (charges and adjustments, `created_at` half-open, paged, de-duplicated, ceiling 20,000, NULL `user_id` included and split in Node); the account-scoped path uses the existing `listRowsForAccountCreatedInRange`. |
| **SA-F2** | **High** | "No migration" is correct, but slice 1 cannot be built from existing reads alone, and the requirement does not say so. Missing reads, verified: (a) the ledger window sum (SA-F1); (b) all-accounts lots and draws (`BusinessOsCreditLotRepository` has only account-scoped reads, `:420`, `:468`); (c) live billing-account status (`BusinessOsBillingAccountRepository` has only `findByUser(userId, livemode)`); (d) live-revenue existence on `business_os_billing_events` and `business_os_boost_purchases` (no admin read exists; the billing-event repository has **no caller at all** yet, and both repositories hold money writers such as `applyPlanPayment`, `recordEvent` and `reserve`). | BA: add a "New reads (no migration)" table to §10 listing (a) to (d). **Ruling:** (a) on the ledger read repository; (b) on the lot repository, reached via `Pick<>`; (c) and (d) in **one new read-only repository** (for example `BusinessOsFinanceReadRepository`). It follows the `BusinessOsCreditLedgerReadRepository` precedent: service role documented, explicit column lists, `livemode = true` in the query, `{ count: 'exact', head: true }` for existence, no write method, and a source test pinning no `insert` / `update` / `upsert` / `delete` / `rpc`. This keeps a read page off the money writers' exact caller lists. It is not a new pattern. Use the `new-repository` skill. |
| **SA-F3** | **High** | Slice 1 as written is the page, the layout standard with two-way URL sync, the menu, a route, a four-section builder, five tiles plus the evaluator widening, three repositories touched or added, the `adminCreditPercent` refactor, `report.ts` exports, about eight guard-list updates and their tests. That is more than "a few days" (realistically 6 to 8). | BA: split §0.1 / §9 / §10 / §11 into **Slice 1a**: page, menu, filter bar with URL, KPI strip with K-1, K-3, K-5, the revenue panel, Section 1, Section 3, and reads SA-F2 (a), (c), (d). Then **Slice 1b**: Section 4, K-2, K-4, read SA-F2 (b), the SA-Q7 refactor and the G3 / ledger caller-list updates. In 1a, the K-2 and K-4 tiles are not rendered (not placeholders). Each slice is about 3 to 4 days and is demoable alone. Map every AC to 1a or 1b. |
| **SA-F4** | **Medium** | K-1 and AC-15 say a lower-bound ratio may turn K-1 red or amber "if it already crosses", and that a lower-bound previous span is grey. Health's `ratioAtLeast` **never fires on an inexact side** (SA C-2, `evaluateHealth.ts:279-292`), and a lower-bound tile with no match is **amber "Total is a minimum"** (SA C-18, `:500-506`). Two different meanings of "at least" on two admin pages are a defect. The "base minimum, grey" rule is not a Health condition either. | BA: rewrite K-1 and AC-15 to: ratio rules fire only on exact figures; any inexact K-1 figure, with no rule matched, gives amber "Total is a minimum; not all charges counted"; never green. Rewrite AC-18's grey case per SA-Q12: grey only when the previous span starts before the cut-over; `floor` USD 1.00 on the current figure. Keep the 31st-of-month and year-boundary cases. |
| **SA-F5** | **Medium** | §12.2's guard list is partly wrong. **Not tripped:** credit-lots **L8** (a migration md5 pin, `business-os-credit-lots.migration.test.ts:734`; slice 1 has no SQL); **BD-26** (that is the `audit_trail` owner-read guard, `ownerAuditReads.guard.test.ts`, and slice 1 reads no audit); `businessOwnedTables.test.ts` (fires only on a new table); `adminReadMethods` (a prefix rule, `app/api/admin/**`; passes as long as names are read in the route). **Tripped, missing from §12.2:** see the guard table below. | BA: replace §12.2 with the guard table below. |
| **SA-F6** | **Medium** | The six groups name "Essentials" and "Autopilot". In config these are tiers `basic` / `pro` (`tierMatrix.ts:71`). A literal `'basic'` / `'pro'` in finance code fails `tierLiteral.forbidden.test.ts`. A literal `'champion'` duplicates the shadow report's definition. | BA: state in §8.1 that the tier groups are **one group per `config.tierOrder` entry**, labelled from config, never a tier literal. Founding Partner = lifecycle state `champion`, and the "no end date" and "dormant" rules come from the predicates exported by `report.ts` (SA-Q3). |
| **SA-F7** | **Medium** | §8.1's grouping does not cover every `LifecycleState` (`types.ts:344`). `past_due` is not mapped. An account with a tier **and** a cohort is not addressed: `deriveLifecycle` gives a tier in force precedence (`lifecycle.ts:186`), and an expired tier keeps `basis: tier` in grace (`:218-229`). Accounts with a business but **no plan row** (`findTenantsMissingPlanRow`) are invisible. | BA: add a mapping table from (state, basis.kind) to group: `trial` → Trial; `champion` → Founding Partner; `active` / `past_due` / `grace` with basis tier → that tier's Paying or Comped group (SA-Q5), with `grace` / `past_due` counted beside it; `grace` with basis cohort → its cohort group; `paused` / `unknown` → Unknown/held. Add one line: "businesses without a plan row" is **not** in slice 1 (it is a shadow-report fact; link to Plans & entitlements). |
| **SA-F8** | **Medium** | Acceptance criteria are missing for behaviour the spec requires or the precedent route enforces. | BA: add the ACs listed under "Missing acceptance criteria" below. |
| **SA-F9** | **Medium** | AC-9 hard-codes today's production figures (Founding Partner 8, K-3 8). They drift with the next invite, so the AC would go red on correct code. It also asserts K-3 = 8 without evidence that all 8 have `cohort_expires_at` NULL. | BA: reword AC-9 to "matches SQL check 1 run at the time of the test", and keep "8 today" only as an example. |
| **SA-F10** | **Low** | CUR-1 and AC-13 require a currency-grouping helper in slice 1, but slice 1 shows only USD AI cost (CUR-5). A helper with no production caller is dead code at code review. | BA: move the CUR-1 / CUR-2 helper and AC-13 to **slice 2**, its first real caller. Slice 1 labels AI cost USD (AC-14 stays). |
| **SA-F11** | **Low** | §4 says no admin page keeps filters in the URL. Not quite: `app/admin/audit-trail/page.tsx:124` (`filtersFromUrl`) and `app/admin/analytics/linkedWindow.ts` already **read** filters from the URL. What is new is **writing** them back (two-way sync). The param is `accountId` on the existing Activity route and the picker's precedent; the proposal uses `account`. | BA: correct the §4 lead and L-4. **L-4 conditions:** (1) one pure `parse` / `serialise` module with unit tests (invalid value → default plus notice; unknown key dropped); (2) `useSearchParams` inside a Suspense boundary (Next 14, as both precedents do); (3) `router.replace(…, { scroll: false })`, not `push`; (4) only ids and enums in the URL, never a business name; (5) the server re-validates everything with the strict Zod schema, so the URL is never trusted; (6) the param name is `accountId`. |
| **SA-F12** | **Low** | L-6 says to reuse Activity's table and drawer. `ActivityTable` is shaped for charge rows and would not fit a credits or plan table. L-2 can reuse `STATUS_STYLES` from `app/admin/components/health/HealthTile.tsx`; `HealthTile` itself is typed on Health's tile ids. | BA: L-6 becomes "reuse existing admin components where they fit (`STATUS_STYLES`, `BusinessAccountPicker`, `CutoverNotice`, `cutoverClamp`); a new table uses `components/ui` primitives". |
| **SA-F13** | **Low** | Notes on the §13 SQL (all six checked: live columns, ASCII only, no apostrophes in comments, never the word "into", one final result set each; all **pass**). Check 3's top 10 can include the NULL `user_id` (deleted) row, which the page shows as its own bucket. Check 4 shows only the latest totals row, but a **trial** account's "used" sums every row since its anchor (`adminCreditPercent.ts` `trial_total`). AC-10's trigger split matches check 2 only while no adjustment rows exist (the page puts a correction under its charge's trigger; SQL groups it under its own, NULL). Check 1 cannot tell a lapsed cohort from a live one. | BA: in check 3 add `and c.user_id is not null` (the deleted bucket is check 2's `deleted_account_rows`). Add a comment line to check 4: trial accounts sum all rows since the trial anchor. Add to AC-10: "while the ledger holds no adjustment rows". Add to check 1 a column counting rows whose `cohort_expires_at <= now()`. Keep the style rules (ASCII, no apostrophes, no "into"). |
| **SA-F14** | **Low** | The window rules leave three things unsaid: what the 92-day cap counts, how the server treats a client-sent `from` / `to` for a preset, and how a platform account id in `accountId` is handled. | BA: (1) the cap counts **inclusive days** (`from` to `to` ≤ 92), as `creditReport.ts`; (2) for a preset, the server ignores client dates and resolves its own (SA-Q2); (3) a platform account id is not in the plan table, so it gets the same 404 as any non-Business-OS id (S1-FR-9), with no separate 409 path. |

### Guards slice 1 trips (replaces §12.2's list)

| Guard | Trips because | What Dev must do | Slice |
|---|---|---|---|
| `enforcementPoints.test.ts` (entitlements importer registration) | The Section 1 classifier imports `deriveLifecycle`, `fromPlanRow`, the config getter and the `report.ts` predicates | Add `{ file, symbols, why }` to `KNOWN_NON_GATE_IMPORTERS` with the exact symbol list ("display only, refuses nothing"). `adminCreditPercent.ts`'s entry stays the same (SA-Q7) | 1a, plus 1b if symbols change |
| `businessOsEntitlements.imports.guard.test.ts` (RC-15) | The finance wiring names `businessOsAccountPlanRepository` (`pagePlans`); a **type-only** import of the plan type matches by path too | Add the wiring file (and its test) to `ALLOWED` **and** `NO_STATE_WRITE_REFERRERS`, and pin `pagePlans` as its one method (the `ADMIN_CREDITS_LEFT_METHOD` precedent) | 1a |
| `BusinessOsCreditLedgerReadRepository.test.ts` exact caller list (`:937-976`; corrected by SA 2026-10-09, was `:950-975`) | The new finance wiring names the ledger read repository | Add it to the list; amend the repository header's caller paragraph (the B1a / B2a precedent) | 1a |
| `serviceColumn.guard.test.ts` (N-10) | Scans only `lib/business-os/credits/**` plus listed Activity files | Put the finance builder under `lib/business-os/credits/`, or add the finance files to the guard's scanned list. Group only through `resolveEffectiveFields` | 1a |
| G3 in `creditLots.test.ts` (`:201-228`, exact list plus a non-vacuity check) | The finance wiring names `businessOsCreditLotRepository`; the credits builder names `extraCreditsAt` | Add both product files and their tests to `ALLOWED_LIST` with a slice comment | 1b |
| `BusinessOsCreditLotRepository.test.ts` | New method | One unit test: no `user_id` filter by name, column list, ceiling → error | 1b |
| `creditFigures.fromConfig.guard.test.ts` | Only if a new file names `creditAllowanceForDisplay` (avoided by SA-Q7). Note: a bare `2000` / `2_000` is the trial allowance and fails the guard (write budgets as `2 * 1000`) | Nothing if SA-Q7 is followed; otherwise add the file to `SOURCES` | 1b |
| `tierLiteral.forbidden.test.ts` | Any `'basic'` / `'pro'` literal | None allowed (SA-F6) | 1a |
| Admin authz surface guard | New `app/api/admin/**` route and new `/admin` page | `requireAdmin` first statement; page under the guarded layout, no `route.ts` in `app/admin/**` | 1a |
| `AdminSidebar.nav.test.ts` | New Monitor entry | Update the pinned list | 1a |
| Health tests (`lib/admin/health/__tests__`) | SA-Q1 type widening | Must pass **unchanged** | 1a |
| New read-only finance repository tests | New repository (SA-F2) | Column list, `livemode = true`, head-count existence, no-write source pin | 1a |

**Not tripped:** L8, BD-26 owner-read, `businessOwnedTables` / purge descriptors, `adminReadMethods`, `accountSeam.guard` (if SA-Q7 is followed), billing-account and billing-event caller lists, boost repository pins (SA-F2 keeps the page off them). **No new CI job and no added PR critical-path time:** every new test runs in the existing Jest gate or the existing `test:bos-entitlements` job.

### Security review (tenant-isolation-guard applied)

- **Admin gate:** `requireAdmin` as the first statement (SEC-1), the page under `app/admin/layout.tsx`'s `requireAdminPage` (SEC-2): correct. Add the repeated-query-key 400 that runs before Zod (ai-activity route precedent).
- **Service role, cross-account:** every all-accounts read is a **named** method, documented as an intentional RLS bypass in the repository header (SEC-3: correct). **No write path exists**, so the guard's write steps (ownership pre-check before an effect, field allow-list) do not apply. Its read invariant does: the only caller-supplied id is `accountId`. It is validated as a UUID, checked against the plan table (404), and then **every** account-scoped read receives exactly that id. When it is present, **no** all-accounts method is called. Names are looked up only for ids taken from rows already read. **Required test:** with `accountId` set, each account-scoped repository call receives exactly the validated id, and every all-accounts method has zero calls (the W11c-5 precedent).
- **Entitlements:** slice 1 **does** import from `lib/business-os/entitlements/` (classifier; `adminCreditPercent.ts` already registered). Registration as in the guard table above.
- **Logs:** SEC-8 is correct; the `info` line is per SA-Q11.

### Currency and timezone

Correct as written. Slice 1 has one currency (USD AI cost, CUR-5); no figure is summed across currencies; `exchange_rates` is never read (CUR-3); `scheduling_services.currency` stays the layer-B authority from slice 2 (CUR-4). Platform months are UTC calendar months (BD-9). `user_preferences.timezone` is correctly not used for platform totals (TZ-2), and `business_profiles.timezone` is never selected. Credit allowance uses each account's own period through the existing pass (TZ-3). Window bounds are half-open whole-day instants (`windowInstants`, the microsecond rule in the ledger repository header).

### Aggregation and token usage

AGG-1 to AGG-6 are correct and match the code. No `select('sum(…)')`; `{ count: 'exact', head: true }` is allowed (not an aggregate). `token_usage` is not read in slice 1 (SA-Q4). Ceilings: ledger 20,000 (`>=` rule, "at least", section `partial`); credit totals 5,000 via the pass (reached → section `unknown`, never a partial sum); lots, ceiling → error → gifted column and K-4 `unknown`; plan walk 20,000 (cap → Section 1 `partial`, "at least" on counts).

### Missing acceptance criteria (SA-F8)

- **AC-33** A repeated query key returns 400 before Zod.
- **AC-34** `to` after today (UTC) returns 400; a custom span of exactly 92 inclusive days is accepted and 93 is refused.
- **AC-35** Every response, success and error, carries `Cache-Control: no-store` (SEC-9).
- **AC-36** An unexpected throw in the route returns 500 in the standard format, with `details` only in development.
- **AC-37** The plan walk fails → Section 1 `unknown`, K-3 grey, the credits section `unknown` (it has no account list), the AI-cost total still renders (by-plan-group breakdown `unknown`). The plan walk reaches its cap → Section 1 `partial` with "at least".
- **AC-38** The lots read fails or reaches its ceiling → the gifted column and K-4 are "Unknown"; the rest of the credits section renders. *(1b)*
- **AC-39** The revenue existence check fails → the panel says "Could not check" and K-5 is grey (S1-FR-26's third branch).
- **AC-40** A window that starts before the charging cut-over shows the cut-over notice; a window entirely before it shows the notice instead of a $0 (S1-FR-19).
- **AC-41** With a business picked, K-3 says whether that business is an open-ended Founding Partner (S1-FR-4).
- **AC-42** With `accountId` set, every account-scoped call receives exactly that id and no all-accounts method is called (security review above).
- **AC-43** The Businesses list's "Credits left" output and tests are unchanged after the SA-Q7 refactor (no count reaches `AdminCreditsLeft`). *(1b)*
- **AC-44** **Type check:** ts-jest does not type-check in this repo. Dev and QA run a scoped `tsc --noEmit` over the touched files (a temporary tsconfig that extends `tsconfig.json` with `include` narrowed to the diff), with a **planted canary error** that must be reported before it is removed, and paste the output. The full `npx tsc --noEmit -p tsconfig.json` OOMs silently and does not count as evidence. Zero new diagnostics in touched files.

### Conditions for the Dev workplan(s)

1. One workplan per slice (**1a**, then **1b**), each about 3 to 4 days, each mapping every AC (AC-1 to AC-44, as amended) to a test or to QA's manual check.
2. Implement SA-Q1 to SA-Q12 exactly as ruled in §0.3. Any deviation goes back to SA before code.
3. List each new repository method (SA-F2) with its name, scope (named all-accounts vs account-scoped), columns, ceiling and ceiling behaviour, and the header text documenting the RLS bypass. Use the `new-repository` and `new-api-route` skills, and walk their final checklists.
4. The guard table above, line by line, with the exact list entries to add and their reasons.
5. The K-1 measurement per SA-F4 and SA-Q12, with unit tests on the pure evaluator using injected `now` (month-length clamp, year boundary, cut-over grey, inexact → amber, floor).
6. The section 1 group-mapping table (SA-F7) as a pure function with a test proving the groups sum to Total over every `LifecycleState`.
7. Run locally before SA code review, and paste the results: `npm run test:bos-entitlements`, `npm run test:authz-guard`, Health tests, the sidebar nav test, `npm run lint:hooks`, eslint on touched files, and the scoped `tsc` with canary (AC-44).
8. Pino only, `correlationId` child logger; any touched file still using `console.*` is flagged and converted (CLAUDE.md § Logging).
9. Nothing is committed before the user has seen the diff.

### BA edits required before the workplan starts

SA-F1 (S1-FR-17 / S1-FR-18), SA-F2 (new-reads table in §10), SA-F3 (split into 1a / 1b across §0.1, §9, §10, §11), SA-F4 (K-1, AC-15, AC-18), SA-F5 (§12.2 replaced by the guard table above), SA-F6 and SA-F7 (§8.1), SA-F8 (AC-33 to AC-44), SA-F9 (AC-9), SA-F10 (CUR-1 / AC-13 to slice 2), SA-F11 and SA-F12 (§4), SA-F13 (§13 SQL notes), SA-F14 (window rules). Each is a text edit; none reopens a business decision. SA re-checks only the edited lines (no full re-review).

---

## SA Requirement Review — Slice 2 — 2026-10-11

**Reviewed by SA — 2026-10-11, against `a66b4c41`**
**Status:** ✅ **APPROVED WITH CONDITIONS.** The 2a workplan may start once the BA has applied the edits for S2-F1 to S2-F4. S2-F5 to S2-F9 can be applied with them or be carried by the workplans. BD-13 is respected throughout and is not reopened.

**How it was checked.** I opened the code rather than trusting the citations:
- `AdminJobsQueuesRepository.ts:48, 54, 78-90, 201-217, 260-279, 421-500` (`STUCK_AFTER_SECONDS = 90 + 10 * 60`, and `.or()` on SELECT and head-count queries);
- `readUnderDeadline.ts:17, 41-45` (`ADMIN_READ_DEADLINE_MS = 5000`);
- `readJobsQueues.ts:45, 114` and `app/api/admin/health-summary/route.ts:167-168` (the structural reader injected from the route);
- `adminReadMethods.guard.test.ts:479-522` and `AdminJobsQueuesRepository.test.ts:234-262`;
- the three Stripe guards: `routerPlacement.guard.test.ts` (scans the webhook route and `lib/business-os/billing/*.ts`), `app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts` (pins `PaymentRepository`) and `planSurfaces.guard.test.ts` (named files);
- `lib/payments/__tests__/dateOnlyIsNotMidnightUTC.guard.test.ts`;
- `finance.source.guard.test.ts:39-46, 86-88`;
- the payment migrations (`20260722` DECIMAL(10,2) with `user_id NOT NULL … ON DELETE CASCADE`; `20260828b:46-48` refunds NUMERIC(12,2) plus `amount_minor` BIGINT; `20260904:39` fee NUMERIC(12,2));
- the shared layout folder (`StatusChip.tsx:25-28` tones, `adminTable.ts:31-34`, `AdminStates.tsx`, `adminFormat.ts`; `formatUtcDate` not built yet);
- `creditReport.ts:136` (`toUnits`).

The SQL checks 7 to 13 are ASCII only, with no "into", no apostrophe in a comment, and one result set each.

### Rulings SA-Q13 to SA-Q19

| # | Ruling |
|---|---|
| **SA-Q13** | **Scale 100 (two decimal places), not four.** Every layer-B money column is declared with two decimals: payments and invoices DECIMAL(10,2), refunds and fees NUMERIC(12,2). PostgREST returns them as JSON numbers.<br>**Conversion:** each value becomes an integer once, `Math.round(n * 100)`, the `toUnits` method. A value is **unreadable** when it is not finite, or when `abs(n * 100 - round(n * 100)) > 1e-6`; unreadable values are counted, never 0 (S2-CUR-3). The largest value, 10^10 × 100, is a safe integer.<br>**Refunds use `amount`, not `amount_minor`.** `amount_minor` depends on each currency's minor unit, while `amount` has the same scale and unit as the payment. See S2-F4. |
| **SA-Q14** | **Reuse, approved.**<br>**Wiring:** the route binds the context `{ correlationId, adminId }` and the queue id. It injects a structural `readReminderFigures(now, signal)`, following the precedent in `health-summary/route.ts:167-168` and `readJobsQueues.ts`. `lib/business-os/finance/**` never names the repository, its singleton, `ADMIN_QUEUE_SPECS`, `STUCK_AFTER_SECONDS` or the marker.<br>**Deadline:** `underDeadline` with an **explicit finance deadline of 2 s** (`FINANCE_LIMITS.REMINDER_DEADLINE_MS = 2 * 1000`), not the default 5 s. The signal is passed to the read. See S2-F9.<br>**Display:** plain figures, no colour, the link to Jobs & queues, and no `buildJobsQueuesView`.<br>**Picked business:** not called. |
| **SA-Q15** | **Both confirmed.**<br>**Paging:** keyset on `id`, page 1,000, ceiling 5,000. At the ceiling the read returns the rows with `reachedCeiling: true` and the figure shows "At least". R-i follows the same rule.<br>**`.or()` on a SELECT is safe.** It already runs in production on SELECT and head-count reads (`AdminJobsQueuesRepository.ts:261` and the `due` / `laterFilter` predicates in `readQueueFiguresAllAccounts`: Jobs & queues and Health tile 7). The 42703 bug needs UPDATE + `.or()` + `.select()`.<br>**Filter string:** build it only from literal statuses and the validated `YYYY-MM-DD`, for example `status.eq.overdue,and(status.eq.sent,due_date.lt.<today>)`. Keep the keyset `.gt('id', last)` and `.eq('user_id', …)` as separate top-level filters. |
| **SA-Q16** | **Not tripped (verified).**<br>• `routerPlacement` reads only the webhook route and `lib/business-os/billing/*.ts`.<br>• `invoiceIntentsStayUnowned` pins `PaymentRepository` and the Stripe routes.<br>• `planSurfaces` pins named files.<br>None of them scans `lib/repositories/BusinessOsFinanceReadRepository.ts`. Dev still runs all three unchanged. **But the finance page's own source guard does trip:** see S2-F1. |
| **SA-Q17** | **One route, approved.** The new reads are settled and concurrent. The SA-Q8 rule stands: a section whose p95 crosses 1 s moves to its own route. QA records `durationMs` in 2a and in 2b. |
| **SA-Q18** | **All three confirmed.**<br>• The new blocks import shared parts only through `@/app/admin/components/layout/`. Everything they need already exists: `StatusChip` with the `warn`, `unknown` and `neutral` tones, `ADMIN_TH_NUM` / `ADMIN_TD_NUM`, `AdminNotice`, `AdminEmpty` and `formatCount`.<br>• **2b builds `formatUtcDate`** in `adminFormat.ts`, with its own test, and so runs the full cycle (layout R-7). `EXPECTED_SOURCES` in the folder guard does not change. See S2-F5 for the date-only rule.<br>• The shell adoption (DF-4) is **its own UI slice after 2b**, never inside a data slice. |
| **SA-Q19** | **`created_at`, approved.** It is one window column for every refund status. The note in S2-FR-3 stays. |

**Also confirmed:**
- **The 2a / 2b split and their order.** About 2.5 days each is accepted. 2b is the tighter one because of the `formatUtcDate` full cycle, so report at the end of day 2 if it slips.
- **Reads.** R-e to R-i are named pairs (all-accounts and account-scoped). The account-scoped methods refuse a malformed UUID and use `.eq('user_id')`. The only caller-supplied id is the route's validated and existence-checked `accountId`. All reads come after `requireAdmin` and nothing writes. This passes the tenant-isolation-guard read invariant.
- **Currency.** No sum across currencies; fees are grouped by `fee_currency`; codes are trimmed and upper-cased.
- **Panels and rules.** The fixed "failed client payments not available" panel is honest. The "as of now" overdue rule is correct.
- **No new KPI tile** (§11A.6).
- **ACs.** AC-13 and AC-45 to AC-73 are testable, apart from the gaps in S2-F5 and S2-F6.

### Findings

1. **S2-F1 (High): 2a trips a guard §12.2 does not list.**
   - **The problem.** `lib/business-os/finance/__tests__/finance.source.guard.test.ts:86-88` forbids `payment_transactions|payment_refunds|payment_plan_` in every file of `FILES`. `FILES` includes `lib/repositories/BusinessOsFinanceReadRepository.ts` (`:44`), which is exactly where R-e to R-i go.
   - **BA edit:** add a §12.2 row for this guard: "Trips in 2a. Narrow the slice-1 assertion to the builder, route, page and billing files, which still never name a payment table. Add a positive pin that the repository's `.from(...)` tables are exactly the three layer-A tables plus the five layer-B tables (`payment_transactions`, `payment_refunds`, 2a; `payment_invoices`, `payment_plan_installments`, `payment_plan_subscriptions`, 2b). The repository never reads `payment_reminders` (R-j owns it)."
2. **S2-F2 (Medium): check 13 uses the wrong stuck threshold.** `STUCK_AFTER_SECONDS` is 90 + 10 × 60 = **690** seconds (`AdminJobsQueuesRepository.ts:54`), not 700. **BA edit:** in the check 13 comment, write "a claim older than 690 seconds (90 plus 600)"; in the SQL, use `interval '690 seconds'`.
3. **S2-F3 (Medium): three wrong rows in §12.2.**
   - (a) The `invoiceIntentsStayUnowned` path is `app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts`, also in LC §5.
   - (b) **`adminReadMethods.guard` is not tripped.** `readQueueFiguresAllAccounts` is not in `ADMIN_METHODS` (`:479-490`). Move the row to "Not tripped".
   - (c) The `AdminJobsQueuesRepository.test.ts` isolation guard is name-based (`:234-262`). The finance route under `app/api/admin/**` passes with no list edit. The rule to state is that no finance `lib/` file names the repository or its singleton.
4. **S2-F4 (Medium): money scale and refunds (SA-Q13).** **BA edit:**
   - S2-CUR-3: "scale 100, the declared two-decimal scale of every layer-B money column; unreadable = not finite or not a whole number of hundredths".
   - §11A.7 and S2-FR-3: refunds use `amount`.
   - The check 8 comment: "refunded_minor equals refunded times 100 for two-decimal currencies such as USD and ILS".
5. **S2-F5 (Medium): `due_date` is a date-only value, not an instant** (the `dateOnlyIsNotMidnightUTC` lesson, INV-00013).
   - **Required:**
     - "past due" compares the `YYYY-MM-DD` string with `todayUtc(now)`, never through `new Date(due_date)`;
     - "days past due" is a whole UTC-day difference of the two dates;
     - `formatUtcDate` renders a date-only string as that same calendar date in any process time zone.
   - **BA edit:** add **AC-74** *(2b)*: "With the process time zone set to `America/New_York` and to `Pacific/Auckland`, a due date of 2026-09-30 renders as 30 September and its overdue state follows AC-57 unchanged (unit and render test)". Add AC-74 to the 2b mapping.
6. **S2-F6 (Low): deleted businesses.** `user_id` is `NOT NULL … ON DELETE CASCADE` on the payment tables (`20260722`; `20260828b:35`). A "Deleted business" row (S2-FR-7, AC-54) cannot occur, and a deleted business's payments disappear from past windows.
   - **BA edit:** remove the deleted-business row from S2-FR-7 and AC-54, and keep defensive handling of a NULL id ("Unknown business").
   - Add to the subtitle: "Covers businesses that still exist".
7. **S2-F7 (Low): overdue amounts are invoice amounts.** The overdue amount is the invoice or instalment `amount`, not what is still owed (partial payments and `refunded_amount` exist). **BA edit:** S2-FR-17 / S2-FR-18 label it "Invoice amount" / "Instalment amount", with a note.
8. **S2-F8 (Low): the SQL checks do not trim currency codes.** Checks 7 to 12 use `upper(coalesce(x, '(none)'))` with no trim, while the page trims (S2-CUR-2). **BA edit:** use `upper(trim(coalesce(x, '(none)')))`. A code that is not three letters still differs from the page, which is acceptable: none exist today, and the note in §13 says so.
9. **S2-F9 (Low): the reminder deadline.** `ADMIN_READ_DEADLINE_MS` is 5 s (`readUnderDeadline.ts:17`), above the page's 2 s p95. **BA edit:** S2-FR-20 and AC-67 name a finance deadline of 2 s (`FINANCE_LIMITS.REMINDER_DEADLINE_MS`, written `2 * 1000`).

### Conditions for the 2a workplan

1. Follow S2-F1: name the finance source-guard edit in the guard table, and add the positive table pin with a planted negative control.
2. Build the currency helper (`currencyGroups.ts`) with scale 100 (SA-Q13). Pin with a source test that no exported function returns a cross-currency total. AC-13 and AC-48 are unit tests over the helper.
3. **R-e, R-e′, R-f and R-f′:**
   - exact exported column lists (no `contact_id`, no metadata);
   - no `livemode`;
   - keyset on `id` with page 1,000 and ceiling 5,000, returning rows plus `reachedCeiling`;
   - the account-scoped method refuses a malformed id before any query;
   - all-accounts methods log counts and timing only at `info`;
   - every method never throws;
   - the existing no-write and one-caller pins stay unchanged.
4. **Tests:**
   - The AC-65 test (SA-WR-3 shape): with `accountId`, R-e′ and R-f′ each receive exactly the id, R-e and R-f get zero calls, and names come only from ids in rows already read.
   - AC-45 and AC-46: zero layer-B calls on 401, 403 and 400.
5. Net is "Unknown" whenever R-e or R-f is at its ceiling or R-f failed (S2-FR-8). Never subtract a lower bound.
6. **The route's info line:** statuses and counts only (rows, ceiling, unreadable, other status). No amount, no currency total, no name.
7. **Guard and verification runs:**
   - Run unchanged and paste: the three Stripe guards, `AdminJobsQueuesRepository.test.ts`, `adminReadMethods.guard`, `layoutFolder.guard`, `test:bos-entitlements`, `test:authz-guard`, the Health tests, the sidebar nav test, `lint:hooks`, and eslint on touched files.
   - Run the scoped `tsc` with a planted canary in a new 2a file (AC-72).
8. Re-run the SQL checks 7 to 9 at QA time against the page (AC-73), and record `durationMs` (SA-Q17).
9. Nothing is committed before the user has seen the diff.

**For 2b (recorded now, re-checked at its workplan review):** SA-Q14 wiring and deadline; S2-F5 (date-only, AC-74); the full cycle for `formatUtcDate`; R-g and R-h `.or()` built per SA-Q15; R-j is never called with a business picked; AC-61's source test over every finance file.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-09 | Created (BA) | Main requirement from discovery and the live-schema check. Recorded BD-1 to BD-12 (user accepted every proposed default for BQ-1 to BQ-12). Added the shared admin layout standard for SA approval, KPI strip K-1 to K-7, six section definitions, slices 1 to 8, slice 1 full specification with AC-1 to AC-32, testing and CI guards, six read-only SQL cross-checks, SA questions SA-Q1 to SA-Q12. No code changed. |
| 2026-10-09 | SA requirement review: **APPROVED WITH CONDITIONS** | Filled §0.3: SA-Q1 to SA-Q12 ruled, plus the layout standard (approved with amendments) and the slice split (1a / 1b). Added "SA Requirement Review — 2026-10-09": findings SA-F1 to SA-F14 (High: AI-cost read path capped at 100 rows; unlisted new repository reads; slice size; Medium: K-1 lower-bound semantics vs Health C-2 / C-18), the exact guards slice 1 trips, security / currency / timezone / aggregation review, missing AC-33 to AC-44 (incl. scoped tsc with canary), workplan conditions and the BA edit list. Verified against code at 88f97171. No code changed. |
| 2026-10-09 | BA applied SA findings F1–F14 and rulings SA-Q1 to SA-Q12 | Slice 1 split into 1a / 1b across §0.1, §9, §10 (new §10.0 scope split), §11 (every AC tagged, mapping list). F1: AI cost via new paged all-accounts ledger method R-a (ceiling 20,000). F2: new §10.8 "New reads (no migration)" R-a to R-d incl. new read-only `BusinessOsFinanceReadRepository`. F4: K-1 / AGG-3 / AC-7 / AC-15 / AC-18 follow Health C-2 / C-18, `floor` USD 1.00, cut-over grey. F5: §12.2 replaced by SA's guard table. F6 / F7: §8.1 tier groups from `config.tierOrder`, full lifecycle → group mapping incl. `past_due`. F8: AC-33 to AC-44 added. F9: AC-9 reworded. F10: CUR-1 / CUR-2 / AC-13 moved to slice 2 (DF-1). F11 / F12: §4 lead, L-2, L-3, L-4 (`accountId`, six conditions), L-6. F13: SQL checks 1, 3, 4 and AC-10. F14: inclusive 92 days, server re-resolves presets, platform id → same 404. §14 statuses set to ruled; §16 updated. SA review section and BD-1 to BD-12 unchanged. No code changed. |
| 2026-10-09 | SA re-check: conditions met — cleared for slice 1a workplan | SA review section and §0.3 rulings verified intact word for word. SA-F1 to SA-F14 and SA-Q1 to SA-Q12 verified in the BA body (R-a paged, ceiling 20,000; the 1a / 1b split with every AC tagged; the §12.2 guard table; the §8.1 lifecycle mapping incl. `past_due`, tier plus cohort, and a catch-all to Unknown/held). §13 SQL re-scanned: ASCII only, no apostrophes in comments, no "into", one result set each. BD-1 to BD-12 unchanged. Verdict row SA-RC added to §0.3. No code changed. |
| 2026-10-09 | Dev: slice 1a workplan written | [BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md), linked in §0.1. It raises SA-W1 to SA-W8 for the SA workplan review. Two of them are requirement gaps. **SA-W1:** with a business picked, AC-42 / SEC-3 forbid R-c and the all-accounts plan walk, but Section 1 needs both; the proposal narrows Section 1 to the business, using `findEntitlementInputs` plus a new account-scoped R-c′. **SA-W2:** the SA-Q5 constant, typed against the billing-account repository's status type, trips the billing-account caller list and the webhook `routerPlacement` M-1 guard, which §12.2 lists as not tripped. No code changed. |
| 2026-10-09 | SA workplan review, slice 1a: **APPROVED WITH CONDITIONS** | §0.3 rows SA-W1 to SA-W8 and SA-WP-1a added. SA-W2 amends SA-Q5 (literal constant, CHECK-list test, no repository import). SA-W1 narrows Section 1 to a picked business; requirement edits E-1 to E-4 are listed in the workplan for BA. The ledger caller-list citation corrected (`:950-975` → `:937-976`) in §12.2 and the SA review. No code changed. |
| 2026-10-09 | BA applied SA workplan-review edits E-1..E-4 | E-1: SEC-3 (plan check via `findEntitlementInputs`, overrides dropped in the wiring; R-d named as the one deliberate exception), AC-42 (`pagePlans` added to the forbidden list; R-d called with no account argument), S1-FR-9 (Section 1 narrows to the picked business via `findEntitlementInputs` and R-c′). E-2: L-3 (Section 1 ignores the window but narrows to a picked business), new §10.8 row R-c′ `findLiveBillingStatusForAccount`, §12.2 RC-15 row pins `pagePlans` and `findEntitlementInputs`. E-3: AC-26 1a clause is Section 1, Section 3 and K-1 (also in the §11 mapping list). E-4: §8.1 Paying row, constant is a literal `as const` checked against the migration CHECK list (SA-W2 option B). SA sections, §0.3 rulings and BD-1 to BD-12 unchanged. No code changed. |
| 2026-10-09 | SA code review, slice 1a: **APPROVED** | §0.3 row SA-CR-1a added. All 48 changed and new files were reviewed. Dev deviations approved. SA re-ran the suites (1,327 + 203 + 5,837 tests, all green). Three Low, non-blocking findings are in the workplan. Code approved for QA. No code changed. |
| 2026-10-09 | AC-9 reconciled with §7.1 (QA-2); slice 1a status updated | AC-9 now states K-3 matches check 1 only while no champion account has a tier in force; §7.1 governs. §0.1 1a: implemented, SA code review approved, QA pass with issues, fix round 1 applied, awaiting user diff review. |
| 2026-10-10 | User approved the slice 1a diff; TL retrospective (TL) | §0.1 1a status: user approved the diff 2026-10-10, TL retrospective done, RM commit + PR next. §0.2 log line added. Retrospective: [BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_RETROSPECTIVE.md](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_RETROSPECTIVE.md). Manual QA steps L-1 to L-13 still owed by the user. No code changed. |
| 2026-10-10 | RM: slice 1a committed and PR opened | Commit `946653a1` on `feature/bos-finance-health-1a`, `origin/main` (`6869ed13`) merged in (`2cc6814b`), PR [#284](https://github.com/AgentsPilot/neuronforge/pull/284) to main. §0.1 1a status and PR column updated. Manual QA L-1 to L-13 still owed by the user. No code changed. |
| 2026-10-10 | Slice 1a merged; Dev: slice 1b workplan written | §0.1 1a: merged PR #284 (merge `5a6fff13`), user manual QA L-1 to L-13 still owed. §0.1 1b: [BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_WORKPLAN.md) linked, awaiting SA review. The workplan raises SA-W9 to SA-W17; one is a requirement gap: **SA-W9**, deleted accounts' admin-grant lots (`user_id` set NULL on delete) are counted by SQL check 5 but should not count as outstanding; proposed BA edit to check 5. No code changed. |
| 2026-10-10 | SA workplan review, slice 1b: **APPROVED WITH CONDITIONS** | §0.3 rows SA-W9 to SA-W17 and SA-WP-1b added. Required changes SA-WR-8 to SA-WR-13 are in the workplan. Requirement edits for BA: E-5 (check 5 adds `and l.user_id is not null`; K-4 row note), E-6 (K-2 inexact when any account is Unknown, never green), E-7 (AC-37 and S1-FR-24: a capped plan walk makes the credits section unknown). No code changed. |
| 2026-10-10 | BA applied SA 1b workplan-review edits E-5..E-7 | E-5: §13 check 5 `grants` CTE adds `and l.user_id is not null` with a comment line (ASCII, no apostrophe, no "into", one result set); §7.1 K-4 Metric cell notes deleted accounts' lots are not counted (SA-W9). E-6: §7.1 K-2 "Inexact figure" and "Green-eligible" cells replaced (lower bound when any listed account is Unknown; never green then; SA-WR-8). E-7: AC-37 capped plan walk makes the credits section `unknown`, K-2 grey, K-4 still renders; S1-FR-24 adds "or reached its cap" (SA-W11). §0.1 1b status and §0.2 log updated. SA sections, §0.3 rulings and BD-1 to BD-12 unchanged. No code changed. |
| 2026-10-10 | SA code review, slice 1b: **APPROVED** | §0.3 row SA-CR-1b added. SA re-ran 21 suites / 753 tests, `test:bos-entitlements` (6,074 tests) and `test:authz-guard` (203 tests), all green. Code approved for QA; QA owes AC-32. No code changed. |
| 2026-10-10 | Slice 1b status: awaiting user diff review | SA-CR-1b APPROVED; QA PASS WITH ISSUES (no bugs); fix round 1 wraps the credit positions pass on the finance side only (Businesses list unchanged). Left as-is by TL, surfaced to user: zero allowance shows Unknown (same as Businesses list); test hook on deps type. User manual QA L-14 to L-22 owed. |
| 2026-10-11 | User approved the slice 1b diff; TL retrospective (TL) | §0.1 1b status: user approved the diff 2026-10-11, TL retrospective done, RM commit + PR next. §0.2 log line added. Retrospective: [BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_RETROSPECTIVE.md](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_RETROSPECTIVE.md). Slice 1 (1a + 1b) is complete once 1b merges; the next slices depend on data (slice 2: business takings, per currency). Manual QA steps L-1 to L-22 still owed by the user. No code changed. |
| 2026-10-11 | Slice 1b committed, PR opened (RM) | Commit `1f46bcb3` on `feature/bos-finance-health-1b`; `origin/main` merged in, tests re-run green. PR [#290](https://github.com/AgentsPilot/neuronforge/pull/290) open against `main`. §0.1 1b row status and PR column updated. Manual QA L-1 to L-22 still owed. No code changed. |
| 2026-10-11 | Slice 2 specified (BA); BD-13 recorded | User decision **BD-13** (option A: build slice 2 now; test and real client payments shown together and treated as real; no test-mode label and no livemode migration; future filter by business or user) added to §0.2 with a log line; **SA-Q9 marked resolved** in §0.3, §8.2 and §14; DF-3 (filter out test businesses or users) and DF-4 (finance page shell adopts the admin layout standard) added to §0.4. New **§11A**: slice 2 split into **2a** business takings (about 2.5 days) and **2b** client payment problems (about 2.5 days); BD-13 rules; window rules (UTC calendar month per BD-9 for takings, refunds and cancellations; **as of now** for overdue invoices and instalments, client plans active now and reminders); currency rules S2-CUR-1 to S2-CUR-7 (fees by fee currency, net of refunds only, no cross-currency total); S2-FR-1 to S2-FR-26 (failed client payments shown as not available, never 0; reminders reuse `ADMIN_QUEUE_SPECS.payment_reminders` and link to Jobs & queues); **no new KPI tile**; new reads R-e to R-i (named all-accounts / account-scoped pairs) in `BusinessOsFinanceReadRepository`, ceiling 5,000 with "at least", plus the reused `AdminJobsQueuesRepository.readQueueFiguresAllAccounts` (R-j); AC-13 and AC-45 to AC-73 (30 criteria). Slice 2 rows added to §12.1 and §12.2; SQL checks 7 to 13 added to §13 (ASCII, no apostrophes in comments, no "into", one result set each); SA-Q13 to SA-Q19 added to §14; notes added to §4, §6.4, §7.1, §8.2, §8.6, §9, §15 and §16. Based on [BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md). §0.1 slice 2: specified 2026-10-11, awaiting SA review. No code changed. |
| 2026-10-11 | SA requirement review, slice 2: **APPROVED WITH CONDITIONS** | New section "SA Requirement Review — Slice 2 — 2026-10-11", checked against `a66b4c41`. §0.3 rows SA-Q13 to SA-Q19 and SA-RR-2 added; §14 slice 2 rows marked ruled. Findings S2-F1 (High: the finance source guard trips in 2a) to S2-F9, with exact BA edits (check 13 at 690 seconds, §12.2 row fixes, scale 100, AC-74 for date-only due dates, cascade on delete, amount labels, trimmed codes, 2 s reminder deadline). Conditions for the 2a workplan listed. BD-13 not reopened. No code changed. |
| 2026-10-11 | BA applied SA slice 2 findings S2-F1 to S2-F9 | **S2-F1:** §12.2 row for `finance.source.guard.test.ts:86-88`, TRIPPED in 2a; fix = narrow the rule plus a positive pin on the repository's tables (with a planted negative control). **S2-F2:** check 13 comment and SQL at 690 seconds. **S2-F3:** §12.2 `invoiceIntentsStayUnowned` path corrected to `app/api/stripe/__tests__/`; `adminReadMethods.guard` row moved to "Not tripped"; `AdminJobsQueuesRepository.test.ts` row restated as name-based, passing with no list edit. **S2-F4 / SA-Q13:** S2-CUR-3 at scale 100 via `Math.round(n * 100)`, unreadable when not finite or not a whole number of hundredths; refunds use `amount` (S2-FR-3, §11A.7); check 8 comment. **S2-F5:** date-only `due_date` rule (§11A.2 note, S2-FR-17, S2-FR-18, S2-FR-25, §12.1); new **AC-74** (2b), added to the 2b mapping. **S2-F6:** no "Deleted business" row (S2-FR-1 subtitle, S2-FR-7, AC-54). **S2-F7:** "Invoice amount" / "Instalment amount" labels with a note (S2-FR-17, S2-FR-18, AC-56, AC-58; checks 10 and 11 comments). **S2-F8:** checks 7 to 11 trim currency codes; note in the §13 slice 2 intro. **S2-F9:** 2 s reminder deadline (S2-FR-20, §11A.7, §11A.9, AC-67). SA-Q14, SA-Q15 and SA-Q19 rulings reflected in §11A.7 and S2-FR-3. §0.1 slice 2 status ("SA-approved with conditions (SA-RR-2), findings applied; 2a workplan next"), §0.2 log line and header status updated. SQL kept ASCII only, no apostrophes in comments, no "into", one result set each. SA sections, §0.3 and BD rows unchanged. No code changed. |
| 2026-10-11 | Dev: slice 2a workplan written | [BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md), linked in §0.1 (slice 2 row). Reads R-e, R-e′, R-f, R-f′ (keyset on `id`, page 1,000, ceiling 5,000, rows plus `reachedCeiling`, no `livemode`); the currency helper at scale 100; the pure takings builder; the route's info line; the new block on the shared layout parts; the finance source guard narrowed with a positive table pin (S2-F1). It raises SA-W18 to SA-W27 for the SA workplan review. Three are requirement gaps: **SA-W18** (check 7 counts businesses and payment rows over every status, while S2-FR-2 / S2-FR-6 count only succeeded or refunded payments; proposed BA edit to check 7 and AC-47), **SA-W19** (a refund-only currency or business has no line or row for its net; proposed union of keys) and **SA-W20** (an unreadable amount does not say what happens to net; proposed net Unknown on that line and the block partial). No code changed. |
| 2026-10-11 | SA workplan review, slice 2a: **APPROVED WITH CONDITIONS** | §0.3 rows SA-W18 to SA-W27 and SA-WP-2a added. Required changes SA-WR-14 to SA-WR-19 are in the workplan. Requirement edits for BA (exact text in the workplan): E-8 (check 7 adds `counted_payments` and `businesses_counted`; AC-47 and S2-FR-2 compare counted payments), E-9 (refund-only lines and rows; S2-FR-2, S2-FR-7, S2-FR-8), E-10 (unreadable amounts and fees; S2-CUR-3). No code changed. |
| 2026-10-11 | BA applied SA 2a workplan-review edits E-8..E-10 | **E-8 (SA-W18):** §13 check 7 gains a comment line and the `counted_payments` and `businesses_counted` columns (ASCII, no apostrophes in comments, no "into", one result set); AC-47 compares counted payments, gross and businesses via `counted_payments`, `gross`, `businesses_counted`; S2-FR-2 payments are the count of counted payments (succeeded or refunded). **E-9 (SA-W19):** refund-only lines (S2-FR-2) and rows (S2-FR-7, from counted payments and succeeded refunds); S2-FR-8 first sentence restated. **E-10 (SA-W20):** S2-CUR-3 states that an unreadable payment or refund amount makes the line net and affected row nets Unknown and the block `partial`, and an unreadable fee makes the block `partial` but never changes net. §0.1 slice 2 status and §0.2 log line updated. SA sections, §0.3 and BD rows unchanged. No code changed. |
| 2026-10-11 | SA code review, slice 2a: **APPROVED** | §0.3 row SA-CR-2a added. SA re-ran 34 suites / 1,381 tests, `test:bos-entitlements` (6,638 tests) and `test:authz-guard` (203 tests), all green; the Businesses-list diff exits 0. Code approved for QA; QA owes V-11 (checks 7 to 9) and L-23 to L-29. No code changed. |
| 2026-10-11 | S2-CUR-3 tolerance aligned with approved D-1 (QA-1, slice 2a) | The whole-hundredths test now states `max(1e-6, abs(n*100)*4*Number.EPSILON)` as built and approved in SA-CR-2a, instead of a flat `1e-6`. |
| 2026-10-12 | Slice 2a status: awaiting user diff review | SA-CR-2a APPROVED (D-1 tolerance proven); QA PASS WITH ISSUES, no bugs; fix round 1: gross 'At least' on unreadable or cut-off payments, plain 'Unknown' net on refunds-read failure, refund log wording. User manual QA L-23 to L-31 owed. |
| 2026-10-12 | Slice 2a approved by user | User read the diff and approved; TL retrospective `docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_RETROSPECTIVE.md`; RM to commit and open the PR. |
| 2026-10-12 | Slice 2a PR opened (RM) | Committed `502e5d5d` on `feature/bos-finance-health-2`, merged current `origin/main` into the branch (`049cdaae`, clean; suites re-run green), PR [#312](https://github.com/AgentsPilot/neuronforge/pull/312) opened. §0.1 slice 2 row updated. No migration. User manual QA L-23 to L-31 owed. |
