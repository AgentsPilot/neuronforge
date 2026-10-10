# Requirement: Business OS Finance & Business Health (admin page)

> **Last Updated**: 2026-10-10

**Created by:** BA
**Date:** 2026-10-09
**Status:** **Draft. SA review: APPROVED WITH CONDITIONS (2026-10-09); BA has applied SA-F1 to SA-F14 and the SA-Q1 to SA-Q12 rulings; SA re-check passed 2026-10-09 (SA-RC): cleared for the slice 1a workplan.** The user accepted every proposed default for BQ-1 to BQ-12 on 2026-10-09 (§0.2, BD-1 to BD-12). No business question is open. Slice 1 is split into **1a** and **1b** (SA-F3). Slice 1a implemented, SA code review approved, QA passed, user approved the diff 2026-10-10; RM commit + PR next.
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
| 1a | Page, menu, filter bar (URL), tiles K-1 / K-3 / K-5, "Platform revenue: none yet" panel, Section 1 accounts by plan, Section 3 AI cost | None (real rows today); **no migration**; new reads R-a, R-c, R-c′, R-d (§10.8) | ⬜ Requirement SA-cleared (SA-RC, 2026-10-09); implemented 2026-10-09; SA code review APPROVED (SA-CR-1a), QA PASS WITH ISSUES, fix round 1 applied; **User approved diff 2026-10-10; TL retrospective done; committed `946653a1`, PR #284 open (merge awaits the user)** ([retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_RETROSPECTIVE.md); manual QA L-1 to L-13 owed by the user) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md) | [#284](https://github.com/AgentsPilot/neuronforge/pull/284) |
| 1b | Section 4 credits, tiles K-2 / K-4, SA-Q7 refactor | Slice 1a; **no migration**; new read R-b (§10.8) | ⬜ Not started (after 1a) | — | — |
| 2 | Business takings and client payment problems (layer B); currency-grouping helper (CUR-1, CUR-2, AC-13) | None (real rows today); SA-Q9 measured in the workplan | ⬜ Not started | — | — |
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

**Log:**
- 2026-10-09 — BA applied SA findings F1–F14; slice 1 split into 1a/1b (SA F3).
- 2026-10-09 — BA applied SA workplan-review edits E-1..E-4 (SEC-3, AC-42, S1-FR-9; L-3, §10.8 R-c′, §12.2 RC-15 pin; AC-26; §8.1 Paying row per SA-W2 option B).
- 2026-10-10 — User reviewed the full slice 1a diff (uncommitted, `feature/bos-finance-health-1a`) and approved it; TL retrospective written; RM to commit, push and open the PR. Manual QA steps L-1 to L-13 (AC-9, AC-10, AC-32) remain owed by the user.

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
| **SA-Q9** | **Deferred to slice 2's workplan**, which must measure live distinct values of `processor_type` / `charge_account_kind` with the `business-os-schema-check` skill before ruling. No layer B read in slice 1. | 2026-10-09 | Slice 2 |
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

### 0.4 Deferrals and parked items

| # | Item | Why | Date |
|---|---|---|---|
| DF-1 | Currency-grouping helper (CUR-1, CUR-2) and AC-13 moved from slice 1 to **slice 2** | Slice 1 shows only USD AI cost; a helper with no production caller is dead code (SA-F10) | 2026-10-09 |
| DF-2 | "Businesses without a plan row" is **not** shown in slice 1 | A shadow-report fact (`findTenantsMissingPlanRow`); the page links to Plans & entitlements instead (SA-F7) | 2026-10-09 |

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
| **K-2 Accounts far over allowance** | Number of accounts whose credits used in their **current credit period** are at least 150% of the period allowance. | amber: count >= 1 (`atLeast`) | Credit pass failed, timed out or reached its ceiling (no partial sum, §8.4) | Not possible (the pass never returns a partial sum) | Yes, when the pass was complete | 1b |
| **K-3 Founding Partners with no end date** | Number of accounts in the Founding Partner group whose cohort has no end date, using the **open-ended cohort predicate exported by `report.ts`** (SA-Q3). With a business picked: whether that business is an open-ended Founding Partner. | amber (information): count >= 1 (`atLeast`) | Plan walk failed | Plan walk at its cap: per AGG-3 | Yes (0) | 1a |
| **K-4 Gifted credits outstanding** | Admin-granted credits minus taken back, over lots not expired now (§8.4). | none (BD-11 sets no threshold) | Lots read failed or reached its ceiling ("Unknown") | Not possible (the lots read errors on its ceiling) | No (informational, grey with value) | 1b |
| **K-5 Our revenue** | Live-mode platform revenue this month. | none in slice 1 | Always in slice 1: "None yet", "Revenue recorded, not yet shown" or "Could not check" (§10.6) | — | No | 1a (grey), 4-5 (values) |
| K-6 Disputes | Open boost or plan disputes. | red: count >= 1 | No live source | — | Yes | 4 (boosts), 7 (plans) |
| K-7 AI margin | AI margin this month | new condition kind "falls below" needed (SA) | No revenue | — | — | 6 |

In slice 1a, **K-2 and K-4 are not rendered** (not placeholders); they appear in 1b. Every tile shows its text state, not colour alone (accessibility).

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
| **Test / live** | Live only, test switch (BD-10). | Layer B rows have no Business OS `livemode` column. **SA-Q9: deferred to slice 2's workplan**, which measures live distinct values of `processor_type` / `charge_account_kind` with the `business-os-schema-check` skill before SA rules. |
| **Honest indicators** | Slice 1a: "Platform revenue: none yet" panel (§10.6). | "Not our revenue" label on the block. |
| **Cannot produce** | Net revenue after real Stripe fees (no fee column, LS:168); plan refunds and disputes until P-6b; list price from the DB (LS:171). | One cross-currency total (BD-12); refund fees (columns empty, LS:169). |
| **Slice** | 4 (boosts), 5 (plans, MRR) | 2 |

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

---

## 9. Slice plan

Small numbered slices of a few days each, reusing existing infrastructure. Each slice gets its own Dev workplan, SA review, QA and PR, recorded in §0.1.

| Slice | Scope (few days each) | Depends on | Migration? |
|---|---|---|---|
| **1a** | Page, menu entry, layout standard (§4) with the filter bar and two-way URL sync, one admin route; KPI tiles **K-1, K-3, K-5**; "Platform revenue: none yet" panel; **Section 1** (accounts by plan); **Section 3** AI cost (no margin); new reads **R-a, R-c, R-c′, R-d** (§10.8); the SA-Q1 type widening; `report.ts` exports (SA-Q3); paying-status constant (SA-Q5). K-2 and K-4 are not rendered. About 3 to 4 days, demoable alone. Specified in §10-§11. | Nothing new | **No** |
| **1b** | **Section 4** credits; tiles **K-2, K-4**; new read **R-b** (§10.8); the SA-Q7 refactor of `adminCreditPercent.ts`; the G3 and lot-repository caller-list updates. About 3 to 4 days, demoable alone. Specified in §10-§11. | Slice 1a | **No** |
| **2** | Section 2 block B (takings per month per currency, refunds, recorded fees, businesses with takings) and Section 6 block B (failed client plan charges, retries, refunds, link to reminders); the currency-grouping helper CUR-1 / CUR-2 and AC-13 (moved from slice 1, SA-F10). | BD-1, BD-2; real rows today; SA-Q9 measured in the workplan | No (expected) |
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
| S1-FR-24 | Failure rules per §8.4: per-account "unknown"; whole-section "unknown" on totals read failure, timeout or ceiling, or when the plan walk failed; lots read failure or ceiling → gifted column and K-4 "Unknown", rest of the section renders. | 1b |

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
- **Slice 2:** AC-13 (moved, SA-F10).

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
- [ ] **AC-37** *(1a; credits clause 1b)* The plan walk fails → Section 1 `unknown`, K-3 grey, the credits section `unknown` (it has no account list; 1b), the AI-cost total still renders (by-plan-group breakdown `unknown`). The plan walk reaches its cap → Section 1 `partial` with "at least".
- [ ] **AC-38** *(1b)* The lots read fails or reaches its ceiling → the gifted column and K-4 are "Unknown"; the rest of the credits section renders.
- [ ] **AC-39** *(1a)* The revenue existence check fails → the panel says "Could not check" and K-5 is grey (S1-FR-26's third branch).
- [ ] **AC-40** *(1a)* A window that starts before the charging cut-over shows the cut-over notice; a window entirely before it shows the notice instead of a $0 (S1-FR-19).
- [ ] **AC-41** *(1a)* With a business picked, K-3 says whether that business is an open-ended Founding Partner (S1-FR-4).
- [ ] **AC-42** *(1a; re-run 1b)* With `accountId` set, every account-scoped call receives exactly that id, no all-accounts method (`pagePlans`, R-a, R-b, R-c) is called, and R-d is called without any account argument (security review).
- [ ] **AC-43** *(1b)* The Businesses list's "Credits left" output and tests are unchanged after the SA-Q7 refactor (no count reaches `AdminCreditsLeft`).
- [ ] **AC-44** *(1a; re-run 1b)* **Type check:** ts-jest does not type-check in this repo. Dev and QA run a scoped `tsc --noEmit` over the touched files (a temporary tsconfig that extends `tsconfig.json` with `include` narrowed to the diff), with a **planted canary error** that must be reported before it is removed, and paste the output. The full `npx tsc --noEmit -p tsconfig.json` OOMs silently and does not count as evidence. Zero new diagnostics in touched files.

---

## 12. Testing and CI guards

### 12.1 Expected tests

| Type | What | Where | Slice |
|---|---|---|---|
| Unit (Jest) | Pure aggregation: plan-group mapping over every `LifecycleState` (sum = total); AI cost sums (exact integers, ceiling → "at least", deleted bucket split in Node); K-1 span arithmetic, floor, cut-over grey, inexact → amber; finance rule evaluation and threshold-in-data; sibling preset resolution in UTC with Activity parity; URL `parse` / `serialise`. | Co-located `*.test.ts` | 1a |
| Unit (Jest) | Credits position and over-allowance via the SA-Q7 core; gifted outstanding via `extraCreditsAt` after the `admin_grant` filter; `readAdminCreditsLeft` unchanged. | Co-located `*.test.ts` | 1b |
| Unit (Jest) | Money grouping by currency (CUR-1, CUR-2, AC-13). | Co-located `*.test.ts` | 2 |
| Integration (Jest) | Route: happy path; 401; 403 (non-admin, and `profiles.role`-only "admin"); 400 for each invalid input in AC-4, AC-33, AC-34; 404 unknown business and platform id; 500 on throw; `no-store` on every response; section failure isolation; `accountId` scoping (AC-42). | `__tests__/` next to the route | 1a (+1b) |
| Repository (Jest) | Each new method in §10.8: one unit test each, including the named all-accounts rule, the explicit column list, `livemode = true`, ceiling behaviour, and for the new finance read repository a no-write source pin. | `lib/repositories/__tests__/` | 1a (R-a, R-c, R-c′, R-d), 1b (R-b) |
| Source guards | No write, no aggregate select, no raw `token_usage`, no grouping on raw `service`, no tier literal. | Next to the service | 1a |
| Manual (QA) | AC-32; scoped `tsc` with canary (AC-44). | Workplan QA report | 1a, 1b |

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

**Not tripped:** L8, BD-26 owner-read, `businessOwnedTables` / purge descriptors, `adminReadMethods`, `accountSeam.guard` (if SA-Q7 is followed), billing-account and billing-event caller lists, boost repository pins (SA-F2 keeps the page off them). **No new CI job and no added PR critical-path time:** every new test runs in the existing Jest gate or the existing `test:bos-entitlements` job.

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
  select l.id, l.credits_granted, l.expires_at
  from public.business_os_credit_lots l
  where l.source = 'admin_grant'
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
| **SA-Q9** | (Slice 2) Layer B has no `livemode`: can test-mode client payments be told apart (`processor_type`, `charge_account_kind`, the Connect account), and should they be excluded? | Decide in slice 2's workplan | Ruled (§0.3): deferred to slice 2 workplan with schema check; applied §8.2 |
| **SA-Q10** | Gifted outstanding needs lots and draws across all accounts; the lot repository's reads are all account-scoped. Add a named all-accounts read, or loop over the (8) accounts with batched reads? G3 caller list must be updated either way. | A named all-accounts read, read-only, with its own test | Ruled (§0.3): named all-accounts read via `Pick<>`; applied §8.4, R-b |
| **SA-Q11** | Confirm no audit entry for reading the page (SEC-10). | No audit, matching the cost report | Ruled (§0.3): confirmed; applied SEC-10, S1-FR-10 |
| **SA-Q12** | K-1's comparison span ("same elapsed span of last month") and base minimum (USD 1.00): acceptable as the BD-11 "month on month" interpretation? | Yes; both stored as rule data | Ruled (§0.3): span accepted; base minimum replaced by `floor` + cut-over grey; applied §7.1, AC-7, AC-15, AC-18 |

---

## 15. Out of scope / future roadmap

- Everything listed as non-goals in §1.2.
- FX conversion or a combined multi-currency figure (BD-12).
- Per-business AI cost beyond per login while one login = one business (D X-8).
- Real Stripe fees on platform revenue (needs a fee column, plan payments / boosts work).
- Owner-facing finance views, exports, scheduled reports.
- Adoption of the layout standard (§4) by other admin pages (each a separate, UI-only change).
- Businesses without a plan row on this page (DF-2; shadow report only).

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
