# Requirement: Business OS Finance & Business Health (admin page)

> **Last Updated**: 2026-10-26

**Created by:** BA
**Date:** 2026-10-09
**Status:** **Draft. SA review: APPROVED WITH CONDITIONS (2026-10-09); BA has applied SA-F1 to SA-F14 and the SA-Q1 to SA-Q12 rulings; SA re-check passed 2026-10-09 (SA-RC): cleared for the slice 1a workplan.** The user accepted every proposed default for BQ-1 to BQ-12 on 2026-10-09 (§0.2, BD-1 to BD-12). No business question is open except **BQ-13** (2026-10-16, refunded boost credits, attached to 4b; §0.4). Slice 1 is split into **1a** and **1b** (SA-F3). Slice 1a implemented, SA code review approved, QA passed, user approved the diff 2026-10-10; RM commit + PR next. **Slice 2 (§11A):** SA requirement review APPROVED WITH CONDITIONS 2026-10-11 (SA-RR-2); BA applied findings S2-F1 to S2-F9 and the SA-Q13 to SA-Q19 rulings; the 2a workplan is next.
**Based on:** [BUSINESS_OS_FINANCE_HEALTH_DISCOVERY.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_DISCOVERY.md) (cited as **D**, with section or line) and [BUSINESS_OS_FINANCE_HEALTH_LIVE_SCHEMA.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_LIVE_SCHEMA.md) (cited as **LS**; authoritative over migrations wherever they differ).
**Related:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) (P-3b.2, P-5, P-6a/b, P-8a/b; AM-10 "revenue by month" is this page), [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md), [BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md), [ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md](/docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md), [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md), [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md), [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md) (owns the Exchange rates page from 2026-10-19, BD-55; supersedes FF-2), [ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md](/docs/requirements/ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md) (client payments in approximate US dollars, BD-56).
**Money area source (2026-10-14):** [ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md](/docs/requirements/ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md) (cited as **CR**) is the source of scope for steps M-1 and M-2, specified in §11D, step M-3, specified in §11E, step M-4, specified in §11F, and step M-5, specified in §11H. It is committed on its own docs PR; this document does not copy it.

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
    - [11B. Slice 1c (fix): test-mode platform money and paying Founding Partners](#11b-slice-1c-fix-test-mode-platform-money-and-paying-founding-partners)
    - [11C. Slice 4 (4a and 4b): Boost revenue](#11c-slice-4-4a-and-4b-boost-revenue)
    - [11D. Slice 5a, Money M-1 and M-2: one account, one screen; plan payments received](#11d-slice-5a-money-m-1-and-m-2-one-account-one-screen-plan-payments-received)
    - [11E. Slice 6a, Money M-3: account economics and AI margin](#11e-slice-6a-money-m-3-account-economics-and-ai-margin)
    - [11F. Money M-4: two measures, one vocabulary (OV-1 copy, OV-5 recorded above charged)](#11f-money-m-4-two-measures-one-vocabulary-ov-1-copy-ov-5-recorded-above-charged)
    - [11G. Finance shell on the Admin Layout Standard (F-2, F-4, F-5)](#11g-finance-shell-on-the-admin-layout-standard-f-2-f-4-f-5)
    - [11H. Money M-5: the Money section](#11h-money-m-5-the-money-section)
    - [11I. Slice 4b: boost refund dates, boost problems, bought credits](#11i-slice-4b-boost-refund-dates-boost-problems-bought-credits)
    - [11J. Money M-8: mark the Platform dashboard and Exchange rates pages redundant](#11j-money-m-8-mark-the-platform-dashboard-and-exchange-rates-pages-redundant)
    - [11K. Slice 6b: margin after estimated Stripe fees, and KPI order](#11k-slice-6b-margin-after-estimated-stripe-fees-and-kpi-order)
    - [11L. Slice DF-6: since it started (one account)](#11l-slice-df-6-since-it-started-one-account)
    - [11M. Slice 8: history snapshots](#11m-slice-8-history-snapshots)
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
| 2 | Business takings and client payment problems (layer B); currency-grouping helper (CUR-1, CUR-2, AC-13) | None (real rows today); **no migration**; new reads R-e to R-i (§11A.7) plus the reused reminder read R-j; SA-Q9 resolved by BD-13; split **2a** (takings) and **2b** (client payment problems) | ⬜ **2a implemented (uncommitted); SA code review APPROVED (SA-CR-2a), QA PASS WITH ISSUES (no bugs), fix round 1 applied; user approved diff 2026-10-12; TL retrospective done; committed `502e5d5d` on `feature/bos-finance-health-2`, PR [#312](https://github.com/AgentsPilot/neuronforge/pull/312) opened 2026-10-12, merge pending; user manual QA L-23..L-31 owed. 2a MERGED PR #312 (2026-10-12, merge `045a4d06`). 2b: workplan written 2026-10-12 on branch `feature/bos-finance-health-2b`, 2b implemented (uncommitted); SA code review APPROVED WITH CONDITIONS (SA-CR-2b; condition SA-CR-1 backspace fix done), QA PASS WITH ISSUES (no bugs), fix round 1 applied; user approved diff 2026-10-12; TL retrospective done; committed `b4e0fa2b` on `feature/bos-finance-health-2b` (origin/main merged in `a6caf75e`), PR [#318](https://github.com/AgentsPilot/neuronforge/pull/318) opened 2026-10-12, merge pending; user manual QA L-32..L-41 owed** (§11A; SA rulings SA-Q13 to SA-Q19 and SA-W18 to SA-W27 in §0.3; findings S2-F1 to S2-F9 applied 2026-10-11; workplan-review edits E-8 to E-10 applied 2026-10-11) | 2a: [BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md); 2b: [BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_WORKPLAN.md) | 2a: [#312](https://github.com/AgentsPilot/neuronforge/pull/312); 2b: [#318](https://github.com/AgentsPilot/neuronforge/pull/318) |
| 1c | Fix slice: test-mode platform money counts (BD-14); a paying Founding Partner is grouped under its paid tier (BD-15); revenue panel copy no longer says the webhook is missing | Slices 1a, 1b; **no migration**; changes R-c, R-c′, R-d (§11B) | ⬜ **1c implemented (uncommitted); SA code review APPROVED WITH CONDITIONS (SA-CR-1c; SA-CR-2 rename and SA-CR-3 test title done), QA PASS WITH ISSUES (no bugs), fix round 1 applied (FP note only while the FP period is current); user approved diff 2026-10-13; TL retrospective done; committed `fa7a4aad` on `feature/bos-finance-health-1c` (origin/main merged in `10e3c5f0`), PR [#335](https://github.com/AgentsPilot/neuronforge/pull/335) opened 2026-10-13, merge pending; user manual QA L-42..L-48 owed** | [BUSINESS_OS_FINANCE_HEALTH_SLICE_1C_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1C_WORKPLAN.md) | [#335](https://github.com/AgentsPilot/neuronforge/pull/335) |
| 3 | Growth funnel (invites) | More invite volume to be meaningful; "paid" stage waits on P-5 | ⬜ Not started | — | — |
| 4 | Boost revenue: **4a** boost revenue per currency and package, K-5 value; **4b** boost problems, K-5 dispute rule, bought credits in Section 4 (test and live together, BD-14; no switch) | **Met:** boost purchases are recorded (1 paid Starter, test mode, counted under BD-14; §11C.1); **no migration**; new reads R-k, R-k′, R-l, R-l′ in `BusinessOsFinanceReadRepository`, not on the boost repository (§11C.6) | ⬜ **4a implemented (uncommitted); SA code review APPROVED with no conditions (SA-CR-4a), QA PASS WITH ISSUES (no bugs, no fix round); user approved diff 2026-10-14; TL retrospective done; 4a committed `0acb460b`, PR [#358](https://github.com/AgentsPilot/neuronforge/pull/358) open, awaiting user merge; manual QA L-49 to L-58 owed; 4b next; DF-5 refund timing on default (a) pending user. 2026-10-14: DF-5 decided by the user (BD-17, refund month); **4b paused until Money M-3 merges** (CR §8; it edits `RevenuePanel`, `CreditsSection` and the K-5 tile, as M-1 and M-2 do)**. **2026-10-16 (BD-32): 4b runs next after M-5, about 4 days. Open business question BQ-13 (does a refunded boost take its credits back?) is attached to it (§0.4); until the user answers, 4b keeps today's behaviour, where the customer keeps the credits** (§11C; SA-Q25 to SA-Q31; about 2.5 + 1.5 days). **2026-10-17: 4b SPECIFIED in §11I, awaiting SA requirement review** (SA-Q65 to SA-Q74; AC-204 to AC-232). Split **4b.1** reversal events writer (migration `20261072` plus the regenerated cleanup `20261073`, no UI; PR off auto-merge until the user applies the migration; about 2 days) and **4b.2** finance reads and UI (refunds and lost disputes by event date, held now, boost problems, bought credits; about 2.5 days). BQ-13 open: 4b keeps no take-back | 4a: [BUSINESS_OS_FINANCE_HEALTH_SLICE_4A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4A_WORKPLAN.md) **4b.1 PR [#447](https://github.com/AgentsPilot/neuronforge/pull/447) open; awaiting user migration apply** (**20261076, 20261077**, renumbered from 20261072/20261073 on 2026-10-17 after DE-8a took 20261074/20261075; cleanup stamp b78b4579fc6631f8; rebase merge staged, awaiting SA re-review; auto-merge OFF). User runbook: check 23 → apply 20261076 → apply 20261077 → check 24. **4b.2 committed `81d688e3`; origin/main (with #447) merged in `ba6772c8`; PR [#459](https://github.com/AgentsPilot/neuronforge/pull/459) opened 2026-10-17, auto-merge on** (stacked on #447; SA-CR-4b2 approved with CR-1 to CR-3 cleared, QA passed, TL approved; [retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_4B2_RETROSPECTIVE.md)). | 4a: [#358](https://github.com/AgentsPilot/neuronforge/pull/358); 4b.1: [BUSINESS_OS_FINANCE_HEALTH_SLICE_4B1_REVERSAL_EVENTS_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4B1_REVERSAL_EVENTS_WORKPLAN.md) |; 4b.1: [#447](https://github.com/AgentsPilot/neuronforge/pull/447) (open); 4b.2: [BUSINESS_OS_FINANCE_HEALTH_SLICE_4B2_REVERSAL_DISPLAY_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4B2_REVERSAL_DISPLAY_WORKPLAN.md) (committed `81d688e3`); 4b.2: [#459](https://github.com/AgentsPilot/neuronforge/pull/459) 
| 5a | **Money M-1 / M-2** (CR §8): **M-1** "One account, one screen": the shared business picker (the original audit-trail picker is deleted), an account header and account summary with a business picked, links that carry the window and the account, both ways with the Businesses drawer; **M-2** "Plan payments received": cash received from plan payments per currency, per window, per account, in Our revenue and K-5 (no MRR) | M-1: none (**no new read**); M-2: P-3b `invoice_paid` rows (live: 1, §11D.1); **no migration**; new reads R-m, R-m′ in `BusinessOsFinanceReadRepository` (§11D.6). **FIN 4b is paused during M-1 to M-3** (it edits the same files, CR §8) | ⬜ **Implemented (M-1 checkpoint green, then M-2); SA code review APPROVED (SA-CR-5a; E-43 applied); QA PASS WITH ISSUES, no bugs; user pre-authorised commit + PR without diff review (2026-10-14); committed `e8ffc5da` and PR [#383](https://github.com/AgentsPilot/neuronforge/pull/383) opened (2026-10-14, not merged); user sync next** (specified 2026-10-14, §11D; SA-Q32 to SA-Q41; requirement SA-RR-5a). M-1 about 2 days (short path if SA agrees, SA-Q32), M-2 about 2.5 days (full cycle). **Amended 2026-10-14 (user, SA-W55):** M-1 and M-2 ship in **one workplan and one PR**. M-1 is finished first and proven at the M-1 checkpoint (no `lib/` or `app/api/` change; AC-111); M-2 starts only after it | [BUSINESS_OS_FINANCE_HEALTH_SLICE_5A_MONEY_M1_M2_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_5A_MONEY_M1_M2_WORKPLAN.md) | [#383](https://github.com/AgentsPilot/neuronforge/pull/383) |
| 5 | Plan revenue, MRR, paying vs comped, trial-to-paid | P-3b.2 (webhook writer), P-8a (MRR definition), P-5 (`first_paid_at` writer) | ⬜ **Split 2026-10-14 (BD-19):** cash received is **5a / M-2** (row above, needs no P-8a); **5b** = MRR, after PAY P-8a, plus paying vs comped exactness, trial-to-paid and the funnel "paid" stage. **2026-10-19: 5b SUPERSEDED by the KPI restructure (row MK-0..MK-9 below).** Its **MRR part is superseded by MK-4** (MRR in the finance payload from `planMrr.ts`, SA-2; its mode-wording ruling folds into BD-41 / SA-4); **the rest becomes MK-9** (paying vs comped exactness, trial-to-paid), after MK-5b. §11N (on `feature/bos-finance-health-5b`) is not built as written | — | — |
| MK-0..MK-9 | **Money area KPI restructure** ([ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md), review §12): two pages, **Finance** (Overview, Accounts, Plans & subscriptions) and **AI cost** (Summary & checks, Calls); MK-0 leading or lagging icon, MK-1 names and block KPIs, MK-2 one charged AI cost figure, MK-3 AI cost page, MK-4 Plans & subscriptions tab and MRR, MK-5 strip re-cut (with MK-5a `$` folded in), MK-5b Converted this month, MK-6 / MK-7 tidy-ups, MK-8 read-only drawers, MK-9 remaining 5b. About 21 to 24 days | Decisions BD-38 to BD-54. No migration planned; new read only in MK-5b (billing admin read repository, SA-10) | ⬜ **User approved 2026-10-19; SA requirement review APPROVED WITH CONDITIONS (SA-RR-MK), conditions MK-C1 to MK-C4 applied 2026-10-19. MK-0 workplan next** | — | — |
| 6a | **Money M-3** (CR §8) "Account economics and AI margin": a Finance **Accounts** tab, one row per account for the window (what it paid us, plan + boosts, after tax and refunds, per currency; charged AI cost; **AI margin, USD only**; credits; plan group), sorted and filtered on the server, capped at 200 rows, each row opening the M-1 one-account view; the AI margin line in the M-1 account summary; a platform AI margin line above the table | Slice 5a merged (#383); **no migration, no new read**: the all-accounts reads R-a, R-k, R-m, the plan walk and the credit-positions pass already carry `user_id` per row (§11E.1) | ✅ **MERGED PR [#392](https://github.com/AgentsPilot/neuronforge/pull/392) (2026-10-15), branch `feature/bos-money-m3`, commit `b8f59db1`; SA code review APPROVED (SA-CR-6a; E-52 applied); QA PASS WITH ISSUES, B-1 fixed in fix round 1; user pre-authorised commit + PR without diff review; awaiting user merge, manual QA L-75..L-88 owed, then user sync** (requirement SA-RR-6a, edits E-44..E-51 applied; specified 2026-10-14, §11E; SA-Q42 to SA-Q50). About 3 days, full cycle. FIN 4b stays paused until M-3 merges | [6a workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_6A_MONEY_M3_WORKPLAN.md) | [#392](https://github.com/AgentsPilot/neuronforge/pull/392) |
| M-4 | **Money M-4** (CR §8) "Two measures, one vocabulary": **OV-1** every admin AI cost figure is named "Charged AI cost" (credit ledger) or "Recorded AI cost" (usage log), on Finance, AI cost & usage, Business OS AI (Costs & credits, Leak check, Activity), the Health tile (renamed "Recorded AI cost", BD-27) and the Businesses drawer; **OV-5** Finance shows "Recorded AI cost" and "Recorded above charged" (recorded minus charged) beside the charged figure, for the window and for one account, never added (BD-18) | M-1 to M-3 merged (#383, #392); **no migration, no new SQL function, no new repository method**: OV-5 reuses the Health tile's all-accounts usage read and the Businesses drawer's account-scoped usage read, injected by the route (§11F.7) | 🟡 **Part A #398 merged; Part B PR [#407](https://github.com/AgentsPilot/neuronforge/pull/407) open** (Part A, OV-1: branch `feature/bos-money-m4`, commit `a215561d`; SA-CR-M4A APPROVED, QA PASS; manual QA L-89..L-97 owed. Part B, OV-5: branch `feature/bos-money-m4b`, commit `cde25b99`, merge of `origin/main` `ee1471e9`; SA-CR-M4B APPROVED, QA PASS WITH ISSUES, no bugs; manual QA L-98..L-105 owed, including the 92-day timing L-104; no migration). User pre-authorised commit + PR without diff review for both parts. Requirement SA-approved with conditions (SA-RR-M4), workplan SA-approved (SA-WP-M4) | [M-4 workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_M4_TWO_MEASURES_WORKPLAN.md) | Part A: [#398](https://github.com/AgentsPilot/neuronforge/pull/398) (merged); Part B: [#407](https://github.com/AgentsPilot/neuronforge/pull/407) (open) |
| F-2 | **M-6 / DF-4, Finance shell part 1: header and states** (UI short path, about 1 day): `AdminPageHeader` (h1 "Finance", BD-28), `AdminLoading`, `AdminError` with Try again, `AdminNotice`, `aria-busy` during a refresh; removes `useFinanceData`'s unreachable `fallbackError` (§11G) | Owned by the finance stream 2026-10-15; F-0 #414, F-1 #418 merged; F-3 #420 merged. **No data, money or API change** | ✅ **Merged** (PR #424; SA-CR-F2 approved, QA PASS; fast track). User browser look L-106 to L-111 owed | — | [#424](https://github.com/AgentsPilot/neuronforge/pull/424) |
| F-4 | **M-6 / DF-4, Finance shell part 2: filter bar and URL state** (full cycle, about 2 days): `AdminFilterBar` + `useAdminFilters`, canonical `range` / `from` / `to` / `account` with aliases `preset` / `accountId`; bad link drops only the bad filter (BD-30) (§11G) | Owned by the finance stream 2026-10-15; F-0 #414, F-1 #418 merged; F-3 #420 merged. Starts after F-2 merges | ✅ **Merged** (PR #434, main `447d17a2`; SA-CR-F4 approved, QA PASS; fast track). User browser look L-112 to L-119 owed | — | [#434](https://github.com/AgentsPilot/neuronforge/pull/434) |
| F-5 | **M-6 / DF-4, Finance shell part 3: KPI tiles** (full cycle, about 2 days): shared `KpiTile` / `KpiStrip` extended; tiles above the filter bar (BD-29), clickable to their sections (BD-31); C-14 registry entry (§11G) | Owned by the finance stream 2026-10-15; F-0 #414, F-1 #418 merged; F-3 #420 merged. Starts after F-4 merges | ✅ **Merged** (PR #437, in main `98735db9`; committed `24cf0c3d` on `feature/finance-f5-kpi-tiles`, origin/main merged in `e8fee379`; SA-CR-F5 approved, QA PASS; fast track). With F-5 merged, M-6 / DF-4 is complete. User browser look L-120 to L-127 owed | [FINANCE_F5_KPI_TILES_WORKPLAN.md](/docs/workplans/FINANCE_F5_KPI_TILES_WORKPLAN.md) | [#437](https://github.com/AgentsPilot/neuronforge/pull/437) |
| M-5 | **Money M-5** (CR §8) "The Money section": a **Money** sidebar section after Monitor holding Finance (first), **Charge checks** (today's Business OS AI "Costs & credits" tab, Leak check included, mounted at `/admin/finance/charges`) and **AI calls & usage (detail)** (`/admin/analytics`, relabelled); the Costs & credits tab leaves Business OS AI and its old links redirect; the Business OS AI description drops "costs"; the FU-M4-1 wording (Health rule descriptions and metric labels, the leak-check cron description) moves to the Recorded vocabulary; the Health "Recorded AI cost" tile gains its page link to Finance (SA-Q55) (§11H) | M-1 to M-4 and M-6 merged; **no data, money, API route or migration change**. Sidebar sign-off: given 2026-10-14 by BQ-1 and BQ-6 (BD-21, BD-24) | 🔵 **PR open, auto-merge on** (PR #444; committed `1c7b7554` on `feature/bos-money-m5`, origin/main merged in `4e96e719`; SA-CR-M5 approved, QA PASS, TL approved; BD-33 fast track). User browser look L-128 to L-136 owed after merge | [BUSINESS_OS_FINANCE_HEALTH_M5_MONEY_SECTION_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_M5_MONEY_SECTION_WORKPLAN.md) | [#444](https://github.com/AgentsPilot/neuronforge/pull/444) |
| M-8 | **Money M-8** (CR §8) "Mark the Platform dashboard and Exchange rates pages redundant" (BD-34): both pages and the dashboard's API route get a REDUNDANT header comment; the dashboard's hidden parked sidebar item is removed; both routes stay reachable by URL with a one-line redundant notice (BQ-14 default); a source guard keeps the product from linking to them; Exchange rates' one `console.error` goes to Pino (§11J) | M-5 merged; **nothing deleted; no data, money, API logic or migration change**. Sign-off: BD-34 (§11J.0) | 🟡 **PR open (2026-10-17): [#448](https://github.com/AgentsPilot/neuronforge/pull/448), auto-merge on; commit `92ef1454`. SA code approved, QA passed, TL approved (BD-33).** Specified 2026-10-17 (§11J, AC-233 to AC-242, SA-Q75 to SA-Q80; BQ-14 resolved by BD-34). UI short path, about 1 day; BD-33 fast track; no user browser look (parked pages) | [BUSINESS_OS_FINANCE_HEALTH_M8_REDUNDANT_PAGES_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_M8_REDUNDANT_PAGES_WORKPLAN.md) | [#448](https://github.com/AgentsPilot/neuronforge/pull/448) |
| 6 | AI margin (overall and per current plan) | Slices 4 and 5 | ⬜ Blocked on slices 4, 5. **Split 2026-10-14:** margin overall and per account (USD only) is **6a / M-3** (row above); **6b** keeps the margin per current plan (BD-8), K-7 and the BD-7 Stripe fee estimate (DF-8), after 5b. **2026-10-16:** 6b also re-orders the KPI tiles, revenue first, then cost, then user and account data (BD-35); in the BD-32 order it runs after M-8, about 1.5 to 2 days. **2026-10-17:** 6b specified as the row below (fee estimate and tile order); the margin per current plan (BD-8) and K-7 stay in this row for a later decision | — | — |
| 6b | **Margin after estimated Stripe fees, and KPI order** (§11K): "Margin after Stripe fees (estimate)" beside the AI margin on the Accounts rows, the platform line and the one-account summary, from a per-charge estimate held as config data (default 2.9% + USD 0.30, USD only; BQ-15); tiles re-ordered K-5, K-1, K-3, K-2, K-4 (BD-35), order only | M-8 merged (#448); **no migration, no new read or repository method**; nothing from 4b.1 (#447) | 🟡 **PR #449 opened 2026-10-17, auto-merge on** (commit `8d2f5ff6` on `feature/bos-finance-health-6b`; SA-CR-6b approved, QA passed, TL approved under BD-33; [retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_6B_RETROSPECTIVE.md)). BQ-15 still open (does not block); user owes L-142 to L-147 and checks 27 and 28 | [BUSINESS_OS_FINANCE_HEALTH_SLICE_6B_STRIPE_FEE_MARGIN_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_6B_STRIPE_FEE_MARGIN_WORKPLAN.md) | [#449](https://github.com/AgentsPilot/neuronforge/pull/449) |
| DF-6 | **Since it started (one account)** (§11L, BD-26): a "Since it started" window, offered only with one business picked, from the charging cut-over (2026-09-29 16:50:53.914 UTC) to now, beyond the 92-day cap (E-75); refused for all businesses (400); the 92-day cap otherwise unchanged; URL `range=since_start` with `account`, a bad link drops only the window (U-4) | 6b (#449); **no migration, no new read or repository method**; the start is the cut-over constant, resolved in the route | 🟡 **PR #450 opened 2026-10-17, auto-merge on** (commit `fd7b7f02` on `feature/bos-finance-health-df6`, origin/main merged in `e73ec431`; SA-CR-DF6 approved, QA passed, TL approved under BD-33; [retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_DF6_RETROSPECTIVE.md)) (§11L; AC-257 to AC-272). BQ-16 open with a default, not blocking; user owes L-148 to L-154 and checks 29 and 30 | [BUSINESS_OS_FINANCE_HEALTH_DF6_SINCE_START_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_DF6_SINCE_START_WORKPLAN.md) | [#450](https://github.com/AgentsPilot/neuronforge/pull/450) |
| 7 | Platform payment problems and churn | P-6a, P-6b, P-8b | ⬜ Blocked on dependencies | — | — |
| 8 | History snapshots (plan mix, credits) for trend lines (§11M): a nightly 00:07 UTC snapshot of the states that cannot be rebuilt (plan mix, credit positions, gifted, bought and outstanding credits; no money, no account), a **History** block on Finance for all businesses with "History starts on {date}"; split **8.1** migration, **8.2** job, **8.3** History block | **One migration** (`20261078`, one new table, applied by the user on production, BD-33) and **one new cron** (`finance-snapshot`, on Jobs & queues); one new admin read route; BQ-17 to BQ-19 on defaults | 🟡 **8.1: PR #452 opened 2026-10-17, auto-merge OFF, merge held until the user applies `20261078` on production** (commit `0439f94f` on `feature/bos-finance-health-8`; SA-CR-8.1 approved, QA passed, TL approved; [retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_8_1_RETROSPECTIVE.md)). User owes L-155: check 31 (6 ok) → apply → check 32 (16 ok) → "applied". MR-1 against #447 (recount to 158 / 120). **8.2 committed `9bb0395c`; main (with #452) merged in `2043dffb`; `addedOn` 2026-10-19 (`6225e6e5`); PR [#460](https://github.com/AgentsPilot/neuronforge/pull/460) opened 2026-10-18, auto-merge on** (stacked on 8.1; SA-CR-8.2 approved, QA passed, TL approved; [retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_8_2_RETROSPECTIVE.md)). **8.3 committed `3209bda9`; main (with #459, #460) merged in `bf5d93ee`; PR [#461](https://github.com/AgentsPilot/neuronforge/pull/461) opened 2026-10-18, auto-merge on** (stacked on 8.2; SA-CR-8.3 approved after the C-1 fix, QA passed, TL approved; [retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_8_3_RETROSPECTIVE.md)). Specified 2026-10-17 (§11M); SA-RR-8 approved with conditions (E-85 to E-88) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_8_1_SNAPSHOTS_MIGRATION_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_8_1_SNAPSHOTS_MIGRATION_WORKPLAN.md) (8.1); [BUSINESS_OS_FINANCE_HEALTH_SLICE_8_2_SNAPSHOT_JOB_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_8_2_SNAPSHOT_JOB_WORKPLAN.md) (8.2); [BUSINESS_OS_FINANCE_HEALTH_SLICE_8_3_HISTORY_BLOCK_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_8_3_HISTORY_BLOCK_WORKPLAN.md) (8.3) | [#452](https://github.com/AgentsPilot/neuronforge/pull/452) (8.1); [#460](https://github.com/AgentsPilot/neuronforge/pull/460) (8.2); [#461](https://github.com/AgentsPilot/neuronforge/pull/461) (8.3) |
| CPU-0..CPU-1b | **Client payments in approximate US dollars** ([ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md](/docs/requirements/ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md), BD-56): one admin-only "Client payments processed" figure in the Client payments block, converted at the Exchange rates tab's current rates; slice 0 the exception on paper, 1a server, 1b page | **No migration**; reads rates through `ExchangeRatesRepository` via a wiring module outside the finance files (SA-RR-CPU SA-Q-1) | Owned by that requirement; its §11 is the status source | — | — |

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
| **BD-10** | BQ-10 | Platform money shows **live mode only**, with a labelled **test-mode switch** for demos. **Superseded 2026-10-13 by BD-14** (test and live platform money counted together, no switch for now); original text kept for history. | 2026-10-09 | User accepted proposed default |
| **BD-11** | BQ-11 | KPI thresholds: AI cost up **50%** month on month = amber, **doubled** = red; any account over **150%** of allowance = amber; Founding Partners with **no end date** = amber (information); **any** boost or plan dispute = red. Thresholds are **data**, cheap to change. | 2026-10-09 | User accepted proposed default |
| **BD-12** | BQ-12 | The legacy `exchange_rates` table is **never** used for a combined figure. Per-currency totals only; any FX use is a separate future decision for SA and the user. | 2026-10-09 | User accepted proposed default |
| **BD-13** | SA-Q9 (slice 2) | **"Option A. Build slice 2 now. Test and real client payments are shown together, and all data is treated as real for now; no test-mode label and no livemode migration. In the future, test data may be filtered out by business or user."** Layer B (clients paying businesses) therefore shows every recorded client payment, with no test-mode label, no switch and no `livemode` filter, and no migration is added. **This resolves SA-Q9.** BD-10 is unchanged and still governs layer A (platform money). Filtering test businesses or users out later is DF-3. | 2026-10-11 | User decision |
| **BD-14** | Slice 1c (owner test, 2026-10-12) | Platform money (layer A: plan billing events and boost purchases) counts **test-mode and live-mode payments together**, and all of it is treated as real, consistent with BD-13 for client payments. **No test-mode switch for now.** A future filter may exclude test businesses or users, the same as the BD-13 deferral (DF-3). **Supersedes BD-10.** | 2026-10-13 | User decision |
| **BD-15** | Slice 1c (owner test, 2026-10-12) | An account that is **paying** for a tier is grouped under **that paid tier**, even when it also has the Founding Partner (`champion`) cohort; Founding Partner then shows as a **note or badge** on that account. A champion account that is **not** paying stays in the Founding Partner group. "Paying" is the existing single definition (`PAYING_SUBSCRIPTION_STATUSES`: `active` or `past_due`, with `ended_at` NULL), now counting test-mode rows too (BD-14). | 2026-10-13 | User decision |
| **BD-16** | SA-Q21 (slice 1c) | **"There are no separate test and production rows; it should be one. We are in test mode now; assume that when we go live each account has one."** One billing record per account is the working assumption. The finance page is not built around an account holding both a test and a live billing row: no special handling for two rows beyond failing honestly (a section that cannot read a single row reports an error, never a wrong figure). SA-Q21's dual-row redesign is withdrawn; SA re-rules W41 and AC-85 against this. | 2026-10-13 | User decision |
| **BD-17** | DF-5 / SA-Q28 (slice 4) | **A boost refund shows in the month of the REFUND, so a finished month never changes.** Dispute defaults, accepted with it: a **lost** dispute shows in the month it was lost, and "held in disputes" means held **right now** (as of now, not as of the purchase month). Supersedes the 4a interim rule S4-W-3 (purchase month) once built. **Implementation deferred**: it needs a refund and dispute date from the boost module (DF-5), and FIN 4b, which would carry it, is **paused** during Money M-1 to M-3. Until then the 4a S4-W-3 note stays on the page. The same timing applies to plan refunds and disputes when PAY P-6b records them (§11D, M2-W-6). | 2026-10-14 | User decision |
| **BD-18** | CR BQ-2 (Money M-1) | **The business AI cost figure is the CHARGED cost** (the credit ledger, what we billed in credits). The recorded cost (usage log) is a separate operations figure, shown beside it as "not charged" in a later step (CR M-4) and **never added**. The M-1 account summary shows charged AI cost only. | 2026-10-14 | User accepted CR default |
| **BD-19** | CR BQ-4 (Money M-2) | **Plan revenue is shown as cash received first** (`invoice_paid` events in the window); **MRR comes later**, with PAY P-8a's definition (FIN slice 5b). Slice 5 is split: 5a = M-2 (cash received), 5b = MRR. | 2026-10-14 | User accepted CR default |
| **BD-20** | CR BQ-8 (Money M-1, M-2) | **No "includes test payments" label for now**, in the account summary or in plan revenue, consistent with BD-14. Revisit at go-live (DF-3). | 2026-10-14 | User accepted CR default |
| **BD-21** | CR BQ-1 | **One "Money" section in the admin sidebar**, holding Finance (overview, accounts, one account) and the detailed AI calls page. Finance stays the first page; nothing with buttons (an action) moves in. Built in CR step M-5. | 2026-10-14 | User accepted CR default |
| **BD-22** | CR BQ-3 (Money M-3) | **AI margin is worked out on revenue after removing tax**, net of refunds and disputes. Stripe fees are not deducted (not recorded) and the page says so. | 2026-10-14 | User accepted CR default |
| **BD-23** | CR BQ-5 | The planned billing views (PAY P-8a): **totals, MRR and the subscriptions list in the Money area; the per-account billing panel in the Businesses drawer**, beside credits, linked from the per-account money view. | 2026-10-14 | User accepted CR default |
| **BD-24** | CR BQ-6 | **"Costs & credits" moves out of the Business OS AI settings page into the Money area** (as "Charge checks"), **after** the per-account view is done (CR step M-5). | 2026-10-14 | User accepted CR default |
| **BD-25** | CR BQ-7 | **Retire the hidden Platform dashboard and the unlisted Exchange rates page**; keep the "All products" view of AI calls & usage (CR step M-8). | 2026-10-14 | User accepted CR default |
| **BD-26** | CR BQ-9 | **Yes to a "since it started" view for one account** (beyond the 92-day cap), only when one account is picked, starting from the charging cut-over (29 Sep 2026). Deferred as DF-6; not in M-3. | 2026-10-14 | User accepted CR default |
| **BD-27** | CR BQ-10 | **Keep the Health tile**, which counts every recorded AI call, but **rename it "Recorded AI cost"** and link it to the Money area (CR step M-4, OV-1 wording). | 2026-10-14 | User accepted CR default |
| **BD-28** | Finance shell review (layout standard §5) | **The page h1 becomes "Finance"**, matching the sidebar. Built in F-2 (§11G). | 2026-10-15 | User decision |
| **BD-29** | Finance shell review (layout standard §5) | **The KPI tiles move above the filter bar**, in the standard order: header, KPI strip, filter bar. They show on both the Overview and the Accounts tab. Built in F-5 (§11G). | 2026-10-15 | User decision |
| **BD-30** | Finance shell review (layout standard U-4) | **A bad link drops only the bad filter** (standard U-4). No reset of every filter and no notice. Built in F-4 (§11G). | 2026-10-15 | User decision |
| **BD-31** | Finance shell review (layout standard §5) | **The tiles are clickable**: each tile jumps to its own section below; "Charged AI cost" opens AI cost & usage. Built in F-5 (§11G). | 2026-10-15 | User decision |
| **BD-32** | Money / Finance roadmap (coordinator relay of the user) | **Order of the remaining Money and Finance work:** M-5 (about 2 days) → 4b (about 4 days) → M-8 (about 1 day) → 6b (about 1.5 to 2 days) → DF-6 (about 1.5 days) → 5b (about 2 to 3 days, after PAY P-8a) → 7 (about 2 to 3 days, after PAY P-6 and P-8b) → 3 (about 2 to 3 days, once there is enough invite volume) → 8 (about 3 to 4 days). | 2026-10-16 | User decision |
| **BD-33** | Money / Finance roadmap | **No per-slice user approval** for the BD-32 slices. Each slice proceeds when SA, QA and TL approve; RM then commits, opens the PR and turns on auto-merge. Two things still stop and go to the user: **a genuine business question**, and **a production migration**, which the user applies by hand. | 2026-10-16 | User decision |
| **BD-34** | CR BQ-7 / step M-8 (amends BD-25) | **M-8 does not delete** the Platform dashboard (legacy) and Exchange rates pages. They are marked redundant with code comments, and nothing uses or links to them any more. The routes stay. | 2026-10-16 | User decision |
| **BD-35** | Slice 6b | **6b grows:** it also re-orders the KPI tiles, revenue first, then cost, then user and account data. (BD-29's position of the strip, above the filter bar, is unchanged.) | 2026-10-16 | User decision |
| **BD-36** | BQ-20 / FU-M8-1 (follow-ups FF-1a) | **Make the redundant Exchange rates page read-only.** The page stops editing rates and the enabled flag, and calls no outside rate service. The reads, the history panel and the page copy stay; there is still no visible notice (BD-34). The database is not changed here; a later write-only lockdown is FF-2 (§0.4) | 2026-10-18 | User decision (answers BQ-20 with its default) |
| **BD-37** | Finance R4 / P8A-R4 | **Billing status is read for the current Stripe mode only; revenue keeps counting both modes (BD-14).** Status means the paying set, plan groups and K-3 (R-c, R-c′); the current mode is P-8a's key resolution (PF-15). Narrows BD-14 for status only; revenue reads are unchanged | 2026-10-18 | User decision (approved the R4 fix) |
| **BD-38** | KPI restructure C-1 (amends BD-2) | **Payment problems sit beside the KPI they hurt.** Our problems move into Revenue (boosts) and Plans & subscriptions (plans, slice 7); the clients' problems join the Client payments block. Both stay separate and labelled; the single "Payment problems" frame goes | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (Q-1) |
| **BD-39** | KPI restructure C-2 (amends BD-24, M-5) | **Charge checks is no longer its own Money page.** It becomes the **Summary & checks** tab of a new **AI cost** page, merged with AI calls & usage (the **Calls** tab) | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (Q-1) |
| **BD-40** | KPI restructure C-3 (amends the M-5 sidebar, BD-21, BD-24) | **The Money sidebar has two entries: Finance and AI cost** (was four). Q-1 is the sidebar sign-off (LAY §2.3 X-1); old links redirect | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (Q-1) |
| **BD-41** | KPI restructure C-4 (narrows BD-14 / BD-20 as built) | **Finance may show "Stripe test mode" on the MRR tile and the Plans & subscriptions tab only.** Revenue received keeps no mode label (BD-20 unchanged). The mode decision stays in `lib/admin/billing`; `lib/business-os/finance/**` still names no mode (SA-4) | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (Q-3) |
| **BD-42** | KPI restructure C-5 (replaces the K-tile set and the 6b order) | **The Finance strip is F-K1 Revenue received, F-K2 MRR now, F-K3 Charged AI cost, F-K4 AI margin, F-K5 Paying accounts %.** K-2, K-3 and K-4 move into their blocks with their BD-11 rules unchanged; BD-35's order (revenue, cost, users) is kept | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (Q-4) |
| **BD-43** | KPI restructure C-6 (changes credit deduction slice 4a) | **The AI cost page defaults to This month, and its Charged AI cost tile counts charges created in the window**, the same computation as F-K3 (SA-1), deleted accounts included. The billing-period table stays on whole periods, labelled so | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (Q-5) |
| **BD-44** | KPI restructure C-7 (amends M-4 OV-5) | **Finance keeps one line, "Recorded above charged", linking to AI cost**; the recorded figure and its notes move to the AI cost page. BD-18 is kept: charged is the business figure, recorded is shown beside it, never added | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (Q-8) |
| **BD-45** | KPI restructure C-8 (amends CUR-1, CUR-2 display) | **Finance and AI cost show `$` and the US-dollar line only**; any other currency becomes a note "plus n in other currencies, not converted". The rule against summing across currencies is kept: the code still groups by currency, nothing is converted (display rule in BD-47) | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (user Page 1 point 2) |
| **BD-46** | KPI restructure, Page 1 rule (review §3.3, LL-1 to LL-5) | **Every KPI tile and block KPI carries a leading or lagging icon** (forward arrow / clock, not colour-coded) with a hover and keyboard-focus tooltip: what the KPI means, and "Leading indicator: it tells you early what is coming" or "Lagging indicator: it tells you what already happened". Built once in MK-0 as an optional `KpiTile` prop, with an in-house accessible tooltip (SA-8) | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (user Page 1 point 1) |
| **BD-47** | KPI restructure, Page 1 rule (review §3.4, USD-1 to USD-6) | **`$`-only display:** every money figure on Finance and AI cost is shown as `$1,234.56`, never a currency code; only the US-dollar line is shown; other currencies are a count note, never an amount and never part of a tile's value; a copy guard fails on "USD ". The drawer's client payments show that business's own currency (BD-50) | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (user Page 1 point 2) |
| **BD-48** | KPI restructure, Page 1 rule (review §5.1) | **F-K5 is "Paying accounts" as a %** of all accounts, with the sub-line "n of N accounts"; the numerator is the existing paying definition (BD-15, BD-37), never redefined; "at least" or Unknown when inexact, never 0% | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (user Page 1 point 3) |
| **BD-49** | KPI restructure, Page 1 rule (review §5.1) | **"Converted this month"** is a small leading figure inside the F-K5 tile: accounts paying now whose first plan payment above $0 was this UTC month. Boosts and $0 invoices never count. A breakdown list shows each one with its plan and source | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (user Page 1 point 3) |
| **BD-50** | KPI restructure Q-10 | **Client payments on a `$` page:** the block KPI is a count of businesses taking client payments; amounts show in `$` for US-dollar payments only, with "plus n payments in other currencies, not converted"; a business's own drawer shows its own currency (for example `₪`) | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (Q-10) |
| **BD-51** | KPI restructure Q-11 | **Paying accounts % divides by every account with a Business OS plan row**: Trial, Founding Partner, Comped, Essentials, Autopilot and Unknown/held (the six Plan mix groups). Deleted and platform accounts are not counted | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (Q-11) |
| **BD-52** | KPI restructure Q-12 | **Converted this month counts the first plan payment in the current Stripe mode**, from `business_os_billing_events` (first `invoice_paid` above $0), not from `first_paid_at`, so test-mode payments do not hide real conversions. The read is a new method on `BusinessOsBillingAdminReadRepository` (SA-10) | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (Q-12) |
| **BD-53** | KPI restructure Q-13 | **Keep the name "AI margin".** Its tooltip gains: "A partial gross margin: only AI cost is deducted so far. Stripe fees are an estimate beside it." "Gross margin" and "Operating margin" stay unused | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (Q-13) |
| **BD-54** | KPI restructure Q-14 | **Keep the page name "AI cost".** Future operating costs (hosting, tools) get their own view on Finance, with AI cost as one line linking to this page; nothing for them is in scope now | 2026-10-19 | User approved 2026-10-19, via [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (Q-14) |
| **BD-55** | User message 2026-10-19 (amends BD-34 and BD-36, **Exchange rates page only**) | **The Exchange rates page becomes a maintained admin tool for manual rate entry.** User, verbatim: "let's first get the exchange rate page up to date, so it can be used. i agree with all recommendations in 1-4, let's skip on any conversions in 5 yet, and just have the page ready for manual updates by admin and allow me to write the url and open the page. then we may add it as a tab under the finance page, with no linkage yet to any customer revenue". For Exchange rates, BD-34 (redundant, do not extend) and BD-36 (read-only) no longer apply: an admin edits rates and the enabled flag through a server admin route, and the page is reached by typing its URL (later a tab under Finance). The **Platform dashboard stays redundant** (BD-34 unchanged for it). **BD-12 and CUR-3 are unchanged:** no conversion, no USD total, no cross-currency sum, and nothing in Finance reads a rate. **FF-2 is superseded** by slice 1b of [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md), which owns this work from here | 2026-10-19 | User decision (recorded per SA-R2 of that requirement) |
| **BD-56** | User message 2026-10-26 (amends BD-12, BD-45, BD-47 and MK USD-2 / USD-5 for one figure only; BD-50 is **not** amended) | **Client payments may be shown as one approximate US-dollar total**, converted with the admin Exchange rates (user, verbatim in [ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md](/docs/requirements/ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md) §1). Conditions EX-1 to EX-6 of that requirement apply: client payments only, admin only, labelled as converted, never stored, never charged, never added to our revenue. BD-1 is unchanged: the figure is never added to our revenue. Every other figure keeps BD-12, BD-45 and BD-47: per currency, `$` for the US-dollar line only, no conversion. BD-50 is unchanged: the business drawer keeps the business's own currency. CUR-3 is unchanged; slice 1a adds positive pins on the one way rates enter Finance (SA-RR-CPU SA-Q-2) | 2026-10-26 | User decision (D-0 of that requirement; wording per SA-RR-CPU CPU-7) |

**Log:**
- 2026-10-09 — BA applied SA findings F1–F14; slice 1 split into 1a/1b (SA F3).
- 2026-10-09 — BA applied SA workplan-review edits E-1..E-4 (SEC-3, AC-42, S1-FR-9; L-3, §10.8 R-c′, §12.2 RC-15 pin; AC-26; §8.1 Paying row per SA-W2 option B).
- 2026-10-10 — User reviewed the full slice 1a diff (uncommitted, `feature/bos-finance-health-1a`) and approved it; TL retrospective written; RM to commit, push and open the PR. Manual QA steps L-1 to L-13 (AC-9, AC-10, AC-32) remain owed by the user.
- 2026-10-10 — BA applied SA 1b workplan-review edits E-5..E-7 (§13 check 5 `and l.user_id is not null` + §7.1 K-4 note, SA-W9; §7.1 K-2 inexact and green-eligible cells, SA-WR-8; AC-37 and S1-FR-24 capped plan walk, SA-W11).
- 2026-10-11 — User reviewed the full slice 1b diff (uncommitted, `feature/bos-finance-health-1b`) and approved it; TL retrospective written; RM to commit, push and open the PR. With 1b, slice 1 (1a + 1b) is complete; the next slices depend on data (slice 2: business takings, per currency). Left as-is and surfaced to the user: a zero allowance shows Unknown (as on the Businesses list), and a test hook on the deps type. Manual QA steps L-1 to L-13 (1a) and L-14 to L-22 (1b; AC-11, AC-32) remain owed by the user.
- 2026-10-11 — User decided slice 2 (BD-13, option A): build it now; test and real client payments are shown together and treated as real; no test-mode label and no livemode migration; future filtering by business or user is DF-3. SA-Q9 is resolved by this decision. BA specified slice 2 in §11A from the slice 2 live check ([BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md)), split into **2a** (business takings, about 2.5 days) and **2b** (client payment problems, about 2.5 days); no new KPI tile; new reads R-e to R-i in the finance read repository, reminders through the existing Jobs & queues reader. Awaiting SA review (SA-Q13 to SA-Q19, §14).
- 2026-10-11 — BA applied SA slice 2 findings S2-F1..F9 and the SA-Q13 to SA-Q19 rulings (SA-RR-2): §11A (money at scale 100, refunds by `amount` and dated by `created_at`, date-only `due_date` and new AC-74, no "Deleted business" row, invoice and instalment amount labels, 2 s reminder deadline), §12.1, §12.2 (finance source guard tripped in 2a; guard path and row fixes) and §13 checks 7 to 13 (trimmed currency codes, check 8 comment, check 13 at 690 seconds). Next: the 2a workplan.
- 2026-10-11 — BA applied SA 2a workplan-review edits E-8..E-10 (SA-WP-2a): §13 check 7 gains `counted_payments` and `businesses_counted`, with AC-47 and S2-FR-2 comparing counted payments (E-8, SA-W18); refund-only lines and rows in S2-FR-2, S2-FR-7 and S2-FR-8 (E-9, SA-W19); unreadable amounts and fees in S2-CUR-3, an unreadable fee making the block `partial` (E-10, SA-W20).
- 2026-10-12 — BA applied SA 2b workplan-review edits E-11..E-14 (SA-WP-2b): S2-CUR-5 allows date-ordered lists (E-11, SA-W30); AC-74 renders `2026-09-30` (E-12, SA-W32); §11A.7 R-h and R-i columns drop `subscription_id` and the plan `currency` (E-13, SA-W34); S2-FR-23 says the block frame is never `unknown` (E-14, SA-W31).
- 2026-10-13 — The user's owner-account test (a Starter boost and a Basic subscription, both Stripe test mode, recorded correctly, verified read-only 2026-10-12) showed nothing on the Finance page: the revenue panel and the paying read are live-only (BD-10), and the account stayed in Founding Partner. User decided **BD-14** (test and live platform money together, no switch; supersedes BD-10) and **BD-15** (a paying champion is grouped under its paid tier, with a Founding Partner note). BA specified fix slice **1c** in §11B (about 1 day, no migration; AC-75 to AC-84; SQL checks 1 and 6 updated). Awaiting SA review (SA-Q20 to SA-Q24).
- 2026-10-13 — BA applied SA 1c review edits E-15..E-19 (SA-RR-1c): §13 check 1 comment keeps the tier caveat (E-15, S1C-F4); AC-78 rewritten for the owner account (tier in force, shown as Comped, not Founding Partner, per S1C-F1) and for a paying champion with no tier in force (E-16); AC-80 adds `tier` is `(none)` (E-17); new AC-85 (two billing rows, page boundary, OR) and AC-86 (paid tier source, SA-Q20) (E-18); §11B.5 guard rows (E-19). §11B SA-Q20 background corrected (the account showed as Comped).
- 2026-10-13 — BA applied SA 1c workplan-review edits E-20..E-25 (BD-16): S1C-FR-2 rewritten for one billing row per account, where two rows give an error and the 'Tier set' fallback (E-20); AC-82 two-row case now fails to the fallback (E-21); AC-80 "counted once" sentence removed (E-22); AC-85 rewritten (E-23); §11B.6 SA-Q21 marked withdrawn (E-24); §13 check 1 comments (E-25, ASCII, query unchanged).
- 2026-10-13 — BA specified slice 4 "Boost revenue" in §11C from a read-only live check (§11C.1: 1 boost purchase, paid, test mode, Starter, USD 10.00; integer minor-unit amounts; no refund date and no refund or dispute rows; `user_id` nullable). Split **4a** boost revenue (R-k, R-k′; per currency gross, tax, refunded, held and lost in disputes, net, credits sold; by package; K-5 value; about 2.5 days) and **4b** boost problems, the BD-11 dispute rule on K-5 and bought credits beside gifted credits in Section 4 (R-l, R-l′; about 1.5 days). Purchases dated by `paid_at`; refunds and disputes shown against the purchase month (no date stored). No migration; no business question open. AC-87 to AC-107; §13 checks 14 to 16; SA-Q25 to SA-Q31. Awaiting SA review.
- 2026-10-13 — BA applied SA slice 4 review edits E-26..E-29 (SA-RR-4): S4-W-4 uses `minorUnitsPerMajor` from `lib/payments/refundMath.ts` as the one source for currency decimals (E-26, S4-F1); AC-88 asserts the half-open bounds on the read's query (E-27, S4-F2); S4-FR-17 red reason names the dispute and narrows to a picked business via R-l′ (E-28, S4-F3); deferral DF-5 refund and dispute dates, default purchase month, pending user question on refund timing (E-29, SA-Q28).
- 2026-10-13 — BA applied SA 4a workplan-review edits E-30..E-32 (SA-WP-4a): §13 check 14 gains a comment and the `deleted_account_net_minor` column, and AC-97 compares against it (E-30, SA-W51); note after AC-77 that 4a supersedes the 1c K-5 wording only (E-31, SA-W50); S4-FR-4 plans line says it covers all businesses in the picked view (E-32, SA-WR-33).
- 2026-10-14 — The user tested owner account (the Basic plan account of 2026-10-12) paid a USD 79 Basic plan and a USD 10 boost, both Stripe test mode; Finance showed only the USD 10, because plan amounts were never built. The user accepted the consolidation review's defaults for steps M-1 and M-2 (BD-18 charged AI cost; BD-19 cash received first, MRR later; BD-20 no test-payment label) and BD-17 (boost refund in the refund month; lost dispute in the month lost; held means held now; implementation deferred, 4b paused). BA specified **slice 5a = Money M-1 and M-2** in §11D from a read-only live check (§11D.1: 9 billing event rows, 1 `invoice_paid` USD 79.00 for the test account dated 2026-10-12, 8 `mismatch_refused` with amounts and no account) and the CR source. M-1 about 2 days (UI, no new read), M-2 about 2.5 days (reads R-m, R-m′; no migration). AC-108 to AC-129; §13 checks 17 and 18; SA-Q32 to SA-Q41. The CR "since it started" view (BQ-9) is kept out of M-1 (DF-6). Awaiting SA review.
- 2026-10-14 — BA applied SA 5a review edits E-33..E-39 (SA-RR-5a): M2-FR-3 timestamps through `formatUtc` and AC-129 (E-33, S5-F1); M2-FR-5 K-5 exactness per currency (E-34, S5-F3); M1-FR-4 Paying / Not paying / Unknown from the Section 1 groups (E-35, S5-F4); M2-FR-7 picked-view `revenue.state` and AC-123 `countRevenueRows` zero calls (E-36, SA-Q35); M2-FR-3 tier label through `tierLabelForGroup` (E-37, SA-Q37); admin layout standard U-10 exception for the one-shot `account` key (E-38) and C-6 picker deletion in M-1 (E-39).
- 2026-10-14 — BA applied SA 5a workplan-review edits E-40..E-42 (SA-WP-5a): §13 checks 17 and 18 take one UTC month through a `p` block, default the current month, and the check intro names the 2026-10-01 month (E-40, SA-WR-40); §11D.2 Order and §0.1 row 5a record one workplan and one PR with the M-1 checkpoint as a hard gate (E-41, SA-W55); M1-FR-7 every link carries the window, superseding SA-Q34's "(its own window)" (E-42, SA-W56).
- 2026-10-14 — The user accepted **all ten** consolidation review defaults (CR §9). BQ-2, BQ-4 and BQ-8 were already recorded as BD-18 to BD-20; the other seven are **BD-21 to BD-27** (one Money section; margin on revenue after tax; billing totals in Money and the per-account billing panel in the Businesses drawer; Costs & credits into Money later; retire Platform dashboard and Exchange rates; "since it started" view for one account, deferred as DF-6; keep the Health tile, renamed "Recorded AI cost"). The user said "continue with M-3". BA specified **slice 6a = Money M-3** in §11E from the merged 5a code (main `d05eb0a4`) and a read-only live check (§11E.1): no new read, a new pure builder over rows the route already reads; margin USD only (BD-12, BD-22); AC-130 to AC-149; §13 checks 19 and 20; SA-Q42 to SA-Q50; DF-8 (Stripe fee estimate stays in 6b). About 3 days. Awaiting SA review.
- 2026-10-14 — BA applied SA 6a review edits E-44..E-48 (SA-RR-6a): §11E.6 export pins for `boostRevenue.ts` and `planRevenue.ts` and the DF-5 pin extended to `accountEconomics.ts` with zero tokens (E-44, S6-F1); M3-W-2 boost after-tax rule from the reader's result, no status literal (E-45, S6-F2); URL key `tab=accounts` in M3-FR-1, M3-FR-5, M3-FR-11, M3-FR-12, AC-130, AC-145, AC-146, SA-Q42 and the §11E.6 route row (E-46, S6-F3); AC-134 platform line before filter and cap (E-47, S6-F4); M3-FR-5 `sort`, `group`, `show` only with the tab, else 400 (E-48, S6-F5).
- 2026-10-14 — BA applied SA 6a workplan-review edits E-49..E-51 (SA-WP-6a): M3-FR-11 optional payload keys `accountEconomics` (tab, no business picked) and `accountMargin` (business picked), both absent otherwise (E-49, SA-W74); M3-FR-3 "Paid us" through `formatMoney`, AI cost and AI margin through `formatUsd` (E-50, SA-W76); §13 slice 6a checks intro records the two by-design differences from check 19 (E-51, SA-W81). §0.1 slice 6a: workplan SA-approved with conditions, Dev implementing.
- 2026-10-15 — With M-1 to M-3 merged (#383, #392), BA specified **Money M-4** in §11F from CR §6, G-7 and the M-4 row, OV-1 and OV-5, BD-18 and BD-27, the merged code (main `b20da2cc`) and a read-only live check (§11F.1: the daily and monthly usage views have no feature column and `business_os_usage_summary` returns no cost, so neither can give a Business OS figure; October 2026 recorded USD 1.94 against charged USD 1.61 over the same 6 accounts). **OV-1**: 25 strings (W-1 to W-25) on Finance, AI cost & usage, Business OS AI, the Health tile and the Businesses drawer, copy only; sidebar descriptions stay for M-5. **OV-5**: "Recorded AI cost" and "Recorded, not charged" (recorded minus charged, deleted accounts left out, "Not available" before the cut-over, "None" when charged is higher, never added) in Section 3 and the account summary; reads reused, not new (the Health tile's all-accounts read; the drawer's account-scoped read for a picked business), injected by the route; the finance source guard is narrowed by SA ruling. AC-150 to AC-166; §13 checks 21 and 22; SA-Q51 to SA-Q57. Recommended two PRs, OV-1 first. No business question is open. Awaiting SA review.
- 2026-10-15 — BA applied SA M-4 review edit E-54 (Finance label 'Recorded above charged'): the Finance net difference is renamed from "Recorded, not charged" to "Recorded above charged" in the §11F title, intro and TOC entry, R4-2, R4-5, R4-6, R4-9, R4-10 (closing sentence as SA worded it), M4-FR-1 to M4-FR-3, AC-154, AC-155, AC-159 and the §0.1 M-4 row. The Leak check (W-16) keeps "Recorded, not charged"; SQL column names unchanged. §0.1 M-4: SA-approved with conditions, edits applied, Dev workplan next.
- 2026-10-15 — The admin-layout session reviewed /admin/finance against the layout standard §5 and the user approved a six-slice plan (F-0 #414 and F-1 #418 merged; F-3 #420 merged). **F-2, F-4 and F-5 move to the finance stream** as DF-4 / Money M-6. User decisions **BD-28 to BD-31** (h1 "Finance"; tiles above the filter bar on both tabs; a bad link drops only the bad filter; tiles clickable to their sections). BA added §11G (AC-169 to AC-183) and §0.1 rows F-2, F-4, F-5. F-2 starts once #420 merges. No code changed.
- 2026-10-16 — With F-5 (#437) merged, M-6 / DF-4 is complete and M-1 to M-4 are merged. BA specified **Money M-5** "The Money section" in §11H from CR §1, §5.1, the M-5 row, SA-Q-4, BQ-1, BQ-6 and BQ-10, BD-21, BD-24, BD-27, FU-M4-1, SA-Q55 and the code at main `98735db9`. **Sidebar sign-off already given:** the Admin Layout Standard treats the sidebar as fixed (LAY §2.3 X-1, X-2 and §3 rule 9), so moving pages between sections needs the user; the user gave that sign-off on **2026-10-14 by accepting CR BQ-1 (BD-21) and BQ-6 (BD-24)**. No new question goes to the user for M-5. Scope: a Money section (Finance, Charge checks, AI calls & usage (detail)); the Costs & credits tab, Leak check included, moves to `/admin/finance/charges` and old links redirect; Business OS AI keeps Settings and Activity; FU-M4-1 reworded (wording only); the Health tile gains a page link to Finance. AC-184 to AC-203; SA-Q58 to SA-Q64; manual QA L-128 to L-136. About 2 days, UI short path. Awaiting SA review.
- 2026-10-16 — The user's roadmap decisions, relayed by the coordinator, are recorded as **BD-32** (order M-5 → 4b → M-8 → 6b → DF-6 → 5b → 7 → 3 → 8, with estimates), **BD-33** (no per-slice user approval: SA, QA and TL approve, then RM commits, opens the PR and turns on auto-merge; a genuine business question or a production migration still stops for the user), **BD-34** (M-8 marks the Platform dashboard and Exchange rates pages redundant in code comments and stops using or linking them; it does not delete them; amends BD-25) and **BD-35** (6b also re-orders the KPI tiles: revenue, then cost, then user and account data). **BQ-13 stays open** and is attached to 4b: does a refunded boost take its credits back? Until the user answers, 4b keeps today's behaviour (the customer keeps the credits) (§0.4). CR's M-8 row updated to match BD-34.
- 2026-10-17 — With M-5 merged (#444), BA specified **slice 4b** in §11I from §11C, BD-17 and its dispute defaults, DF-5, the refund-timing scoping (option (ii)) and a pre-work check against main `16cb2a1f` and the live database (1 boost purchase, 0 refunds, 0 disputes; the events table absent; next migration `20261072`). Split **4b.1** (writer: table `business_os_boost_reversal_events`, written inside the unchanged-signature transition function, server-write-only, service_role SELECT plus a column-level INSERT grant because the function is SECURITY INVOKER; regenerated test-account cleanup because guard G-18 blocks the new FK; about 2 days) and **4b.2** (refunds and lost disputes by event date, held now, boost problems, bought credits, the Accounts tab on the same rule; about 2.5 days). One hand-applied production migration (two with the cleanup); the 4b.1 PR stays off auto-merge until the user applies it. AC-204 to AC-232; checks 23 to 26; SA-Q65 to SA-Q74; L-137 to L-141. BQ-13 stays open: 4b keeps no take-back. No new business question. Awaiting SA review.
- 2026-10-17 — BA specified **Money M-8** in §11J from BD-34 (amends BD-25), the CR M-8 row and inventory I-15, I-19, and the code at main `5c214310` (CF-1 to CF-12): REDUNDANT header comments in both pages and in `/api/admin/dashboard` (its only caller is the dashboard); the dashboard's hidden parked sidebar item removed (parked 15 → 14, hrefs 29 → 28; visible sidebar unchanged; BD-34 is the sign-off, §11J.0); both routes kept with a one-line notice; a new source guard against in-app links; Exchange rates' `console.error` to Pino. AC-233 to AC-242 and SA-Q75 to SA-Q80 (numbered after PR #447's AC-232 and SA-Q74). New **BQ-14** (visible notice or comments only; default: notice) and **FU-M8-1** (Exchange rates still writes from the browser; not changed by M-8). CR M-8 row marked in progress. No code changed.
- 2026-10-17 — With M-8 merged (#448, main `e43dcb60`), BA specified **slice 6b** in §11K from BD-7, BD-12, BD-22, BD-29, BD-31, BD-35, DF-8 and the 6a builder, with a read-only live check (no Stripe fee is stored for plan or boost payments; client payments carry `processor_fee`). Fee estimate per successful charge on the gross amount, rounded half up per charge, as config data (default 2.9% + USD 0.30, USD only); a refunded charge keeps its fee; dispute fees not estimated. "Margin after Stripe fees (estimate)" shown beside the AI margin, never replacing it, on the Accounts rows, the platform line and the one-account summary. Tiles re-ordered K-5, K-1, K-3, K-2, K-4, order only. Wording says "estimate", because the vocabulary guard forbids "estimated" in `financeCopy.ts`. AC-243 to AC-256, checks 27 and 28, SA-Q81 to SA-Q91; new **BQ-15** (the fee rate) with its default, not blocking. No code changed.
- 2026-10-17 — With 6b open as PR #449, BA specified **slice DF-6** "Since it started (one account)" in §11L from BD-26, CR G-9, CR SA-Q-6, BD-30, BD-32 and BD-33 and the code at `ea56ad04` (6b tip). A `since_start` window, valid only with a business picked (400 for all businesses), from the later of the cut-over instant and the account's first activity (the earliest of the plan row's `onboarding_started_at` and `profile_created_at`; never `created_at`, a backfill time) to now; resolved on the server after the plan check from the row already read; the 92-day cap unchanged for every other window; read ceilings unchanged ("At least" / Unknown); no timezone read (both ends are instants; `user_preferences.timezone` remains the authority if local dates are ever shown); URL `range=since_start` as a window extra, a bad link drops only the window (U-4); links out carry the dates only up to 92 days. **No migration, no new read or repository method.** AC-257 to AC-272, checks 29 and 30, L-148 to L-154, SA-Q92 to SA-Q99; new **BQ-16** (client takings before the cut-over) with its default, not blocking. About 1.5 days. Awaiting SA review. No code changed.
- 2026-10-17 — With DF-6 open as PR #450, BA specified **slice 8** "History snapshots" in §11M from the §0.1 and §9 slice 8 rows, §8.1, CF-7 of §11L, BD-32 and BD-33, the §8.1 cron pattern of the event-driven plan, the `durable-queue-drain` and `tenant-isolation-guard` skills, `bosCronJobs.ts`, `20261011` and the `20261072` house style (PR #447), on `feature/bos-finance-health-8` (DF-6 tip `f6182697`). A nightly job at 00:07 UTC records, for the UTC day just ended, the states that cannot be rebuilt: plan mix (groups, states, K-3, dormant, ending soon), credit positions (counts, K-2, included credits and use) and the gifted, bought and outstanding credits (K-4); flows (AI cost, revenue, takings, gifts and purchases in a window) are rebuilt from their dated rows and never copied. One row per day, metric and dimension, `ON CONFLICT DO NOTHING`; only exact figures written, gaps stay gaps; no money, no currency, no account id. New table `business_os_finance_snapshots` in **migration `20261074`** (RLS on, no policy, service-role SELECT and a five-column INSERT only), job `finance-snapshot` on Jobs & queues, a separate admin history route, and a History block (all businesses only) with "History starts on {date}". Split **8.1** migration (stops for the user), **8.2** job, **8.3** History block; about 3.5 days. AC-273 to AC-294, checks 31 to 34, L-155 to L-162, SA-Q100 to SA-Q107; new **BQ-17** (daily), **BQ-18** (keep forever) and **BQ-19** (no backfill) with defaults, none blocking; **DF-9** (overdue history) deferred. Awaiting SA review. No code changed.
- 2026-10-18 — The user answered **BQ-20** (raised in the FF-1 workplan, [BUSINESS_OS_FINANCE_HEALTH_FOLLOWUPS_FF1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_FOLLOWUPS_FF1_WORKPLAN.md)): **yes, make the Exchange rates page read-only**, recorded as **BD-36**. FF-1a carries it out under SA-WR-FF1: the page's three browser write paths go (the enable toggle, the rate edit and the unused outside-rate fetch), and the new read-only **check 35** shows whether the database still accepts browser writes on `exchange_rates` and `exchange_rate_history`. FU-M8-1 is closed by FF-1a. **FF-2** (a write-only lockdown, after check 35 is run) is recorded in §0.4; `authenticated` keeps SELECT on `exchange_rates`, because the settings currency picker reads it from the browser (SA-WR-FF1).
- 2026-10-18 — The user approved **Finance R4** (SA condition P8A-R4 of plan payments P-8a), recorded as **BD-37**: billing status is read for the current Stripe mode only, revenue keeps counting both modes (BD-14). Without it, an account with both a test and a live billing row (the owner, the day live keys arrive) fails R-c and R-c′. The finance wiring now reads status through `lib/admin/billing/currentModeBillingStatus.ts`, which reuses P-8a's one-mode reader and key resolution; no guard, pin, route or migration change. Workplan [BUSINESS_OS_FINANCE_HEALTH_R4_BILLING_MODE_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_R4_BILLING_MODE_WORKPLAN.md). Follow-up **R4-FU-1** in §0.4.
- 2026-10-19 — The user approved the Money area KPI restructure ([ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md); two pages, Finance and AI cost; Q-1 to Q-14 at their defaults), and SA approved it with conditions (SA-RR-MK). BA applied conditions MK-C1 to MK-C4: the review's C-1 to C-8 are recorded as **BD-38 to BD-45**, the Page 1 rules (leading or lagging icon, `$`-only, Paying accounts %, Converted this month) as **BD-46 to BD-49**, Q-10 to Q-12 as **BD-50 to BD-52**, and Q-13 / Q-14 (keep "AI margin" and "AI cost") as **BD-53 and BD-54**. In §0.1, 5b's MRR part is superseded by MK-4 and the rest becomes MK-9 (§11N is not built as written), and a pointer row for MK-0 to MK-9 is added. Next: the MK-0 workplan. No code changed.
- 2026-10-19 — The user decided to make the Exchange rates page a usable, admin-maintained tool for manual rate entry, reached by URL and later as a tab under Finance, with no conversion and no link to customer revenue. Recorded as **BD-55**, which amends BD-34 and BD-36 for Exchange rates only (the Platform dashboard stays redundant; BD-12 and CUR-3 unchanged). **FF-2 is superseded** by slice 1b of [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md), the requirement that now owns the page (SA-R2 there). No code changed.
- 2026-10-26 — The user asked for one approximate US-dollar total of client payments, converted with the Exchange rates tab's rates, payments only, noted as our customers' revenue. Recorded as **BD-56**, the explicit exception to BD-12 for that one figure under conditions EX-1 to EX-6 of [ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md](/docs/requirements/ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md), which owns the work. BD-1 and BD-50 unchanged; CUR-3 unchanged (SA-RR-CPU). No code changed.

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
| **SA-W28 to SA-W40** | **Slice 2b workplan rulings, all approved as proposed.**<br>• W28: one generalised pager, with the 2a tests byte-identical.<br>• W29: positive pins for the reminder vocabulary and for the `'sent'` / `'pending'` literals.<br>• W30: overdue tables in date order (E-11).<br>• W31: the block frame is never `unknown` (E-14).<br>• W32: due dates shown as `YYYY-MM-DD` (E-12).<br>• W33: date-only helpers (`todayUtc`, `isRealDate`, `inclusiveDays`) with no `new Date`.<br>• W34: drop `subscription_id` and the plan `currency` (E-13).<br>• W35: a structural type for the reminder figures.<br>• W36: an overdue invoice with no due date counts as marked and sorts last.<br>• W37: instalment retries are fixed "not recorded" copy.<br>• W38: one names call.<br>• W39: plan statuses checked against the migration CHECK.<br>• W40: a new writer-names test. | 2026-10-12 | S2-CUR-5, S2-FR-23, §11A.7, AC-74 |
| **SA-WP-2b** | **2026-10-12 SA workplan review (slice 2b): APPROVED WITH CONDITIONS.** Required changes SA-WR-20 to SA-WR-25 are in the workplan, including the `formatUtcDate` regression run over every importer of `adminFormat.ts`. BA applies E-11 to E-14 (exact text in the workplan's SA review) before V-11 and QA. | 2026-10-12 | Slice 2b |
| **SA-CR-2b** | **2026-10-12 SA code review (slice 2b): APPROVED WITH CONDITIONS, code approved for QA.** SA-WR-20 to SA-WR-25 verified; D-1 to D-4 approved.<br>• Due dates are date-only end to end (AC-74 renders `2026-09-30`).<br>• Overdue amounts are per currency, labelled as the invoice or instalment amount.<br>• The failed-payments panel never shows a number.<br>• The block frame is never `unknown`.<br>• A picked business gets account-scoped reads only, and the reminder read is skipped.<br>**Condition SA-CR-1:** replace the literal backspace in the finance guard's cohort rule (`finance.source.guard.test.ts:145`) with `\b` and add a planted control; the corrected rule passes on today's code. | 2026-10-12 | Slice 2b |
| **SA-Q20** | **The paid tier comes from the plan row `tier` first** (the entitlement truth, written by the webhook). A tier in force already maps through the existing path. A paying account whose lifecycle is champion goes to the plan row `tier` if it is in `config.tierOrder`, else `bought_tier` if it is, else Unknown/held. If they disagree, the plan row wins. R-c and R-c′ add `bought_tier` to their columns (amended by BD-16: no `id` column). | 2026-10-13 | S1C-FR-3, AC-86 |
| **SA-Q21** | **Withdrawn 2026-10-13 by user decision BD-16** (one billing record per account). The original ruling (keyset on `id`, a `.limit(2)` list, OR over rows) is **not** built. **Replacement:** R-c keeps its keyset on `user_id` and R-c′ keeps `.maybeSingle()`; both drop only the mode filter. Two rows give an honest error, never a figure: R-c fails on a duplicate `user_id` among the rows read (SA-WR-27), and R-c′'s single-row read fails. Section 1 then shows "Tier set". | 2026-10-13 | S1C-FR-2, AC-82, AC-85 |
| **SA-Q22** | **Rename** to `listBillingStatusesAllAccounts`, `listBillingStatusesForAccount` and `countRevenueRows`. The source guard's `:334-335` control becomes "the repository code names no `livemode`" with a planted control, and the repository header is rewritten for BD-14. | 2026-10-13 | §11B.5 |
| **SA-Q23** | **Dormant Founding Partners counts the Founding Partner group only.** "Ending in 30 days" is unchanged. The slice 1a shadow-report parity test keeps a fixture with no paying champion. | 2026-10-13 | S1C-FR-5 |
| **SA-Q24** | **A note on the group row plus a `neutral` `StatusChip` "Founding Partner" in the picked view; no new column.** The cohort is recognised through `stateForCohort`. The note counts every paying account in a tier group whose plan row has the champion cohort, so it also covers a tier in force. | 2026-10-13 | S1C-FR-4 |
| **SA-RR-1c** | **2026-10-13 SA requirement review (slice 1c): APPROVED WITH CONDITIONS.** S1C-F1 (High): the owner test account had its tier in force and showed as Comped, not Founding Partner; BD-14 moves it and BD-15 adds the note; AC-78 is rewritten. S1C-F2 (High): two billing rows per account, fixed by SA-Q21. S1C-F3 to S1C-F6: shadow-report parity, the K-3 / check 1 caveat, a whole-file `livemode` rule, and an estimate of 1 to 1.5 days. The workplan starts after BA edits E-15 to E-19. | 2026-10-13 | Slice 1c |
| **SA-W41 to SA-W46** | **Slice 1c workplan rulings (with BD-16).**<br>• W41: moot, because one row gives one `bought_tier`; `paidTierOf(planTier, boughtTier, tierOrder)`.<br>• W42: dormant counts the Founding Partner group only, so a Comped dormant champion is not counted either.<br>• W43: keep the SA-WR-17 test and add a picked-view chip test.<br>• W44: the override runs after `groupFor`, only when paying is true.<br>• W45: comment-only edit in `payingSubscriptionStatuses.ts`, never using the word "supabase".<br>• W46: no code change; the check 1 caveat is stated (E-25).<br>`!!cohort` is accepted, since `cohort !== ''` trips the cohort-literal rule. | 2026-10-13 | §11B, AC-80, AC-82, AC-85 |
| **SA-WP-1c** | **2026-10-13 SA workplan review (slice 1c): APPROVED WITH CONDITIONS.** Under BD-16 the single-row reads are kept; keyset paging on `user_id` was verified correct for one row per account. Two rows give an honest error (SA-WR-27, SA-WR-28). Required changes SA-WR-26 to SA-WR-31; about 1 day. BA applies E-20 to E-25 (exact text in the workplan's SA review). | 2026-10-13 | Slice 1c |
| **SA-CR-1c** | **2026-10-13 SA code review (slice 1c): APPROVED WITH CONDITIONS, code approved for QA.**<br>• The dual-row redesign is gone, and two rows give an honest error.<br>• The renames leave no old name.<br>• The repository code names no `livemode` (planted control).<br>• The paid tier comes from `tierOrder` only.<br>• The BD-15 override runs after `groupFor`, with the note and the picked-view chip; a non-paying champion stays in Founding Partner.<br>• Dormant counts the Founding Partner group only.<br>• The panel copy has no webhook or mode wording.<br>• Test-mode rows count in R-c, R-c′ and R-d.<br>Conditions (Low): **SA-CR-2** rename R-c′ to `findBillingStatusForAccount`, since under BD-16 it returns one row or null; **SA-CR-3** re-title the "spans pages" duplicate test. The page-boundary residual is accurate. | 2026-10-13 | Slice 1c |
| **SA-Q25 to SA-Q31** | **Slice 4 rulings.**<br>• Q25: K-5 follows the filter window.<br>• Q26: reuse `minorUnitsPerMajor` (`lib/payments/refundMath.ts`); integer cents are hundredths only when it returns 100, otherwise unreadable; never `toUnits` or `× 100`.<br>• Q27: the layer-B pager (ceiling 5,000, "At least", net Unknown).<br>• Q28: refunds and disputes count in the purchase month, as recorded today; a refund date is deferred (DF-5) and offered to the user as a business choice with that default.<br>• Q29: a dispute rule on K-5 (data, `atLeast 1`), five tiles kept.<br>• Q30: stored package id and version, no entitlements import.<br>• Q31: bought credits in `creditsSection.ts`, a second source filter; G3 is not tripped. | 2026-10-13 | §11C |
| **SA-RR-4** | **2026-10-13 SA requirement review (slice 4): APPROVED WITH CONDITIONS.** Verified:<br>• the finance table pin does not grow (`business_os_boost_purchases` is already pinned for R-d);<br>• no boost or webhook guard trips;<br>• checks 14 to 16 match the migration columns and the style rules (to be run at QA).<br>Findings S4-F1 to S4-F5. The 4a workplan starts after BA edits E-26 to E-29. | 2026-10-13 | Slice 4 |
| **SA-W47 to SA-W54** | **Slice 4a workplan rulings, all approved.**<br>• W47: an optional `money` on K-5 only.<br>• W48: unreadable is decided per row; numeric strings in the integer money columns are unreadable.<br>• W49: reuse the `CLIENT_*` limits.<br>• W50: 1c's K-5 and panel wording tests may be rewritten, but R-d's no-mode behaviour stays pinned (SA-WR-32, E-31).<br>• W51: check 14 gains `deleted_account_net_minor` (E-30).<br>• W52: `RevenuePanel.tsx` rewritten in place over `FinanceSection`; the strip gets `windowLabel`.<br>• W53: DF-5 kept in one function and one copy line, pinned.<br>• W54: credits go through `toUnits` once; money never goes through `toUnits`, `toHundredths` or `× 100`. | 2026-10-13 | §11C, check 14, AC-75 to AC-77, AC-97 |
| **SA-WP-4a** | **2026-10-13 SA workplan review (slice 4a): APPROVED WITH CONDITIONS.** Required changes SA-WR-32 to SA-WR-35, including the plans line marked platform-wide in the picked view (E-32). Verified untouched: the table pin (eight tables), the boost repository identifier pins, the webhook placement guards, purge and entitlements. BA applies E-30 to E-32 (exact text in the workplan's SA review) before V-11 and QA. | 2026-10-13 | Slice 4a |
| **SA-CR-4a** | **2026-10-14 SA code review (slice 4a): APPROVED, code approved for QA.** SA-WR-32 to SA-WR-35 verified: the R-d repository test is unedited and the test-mode invoice behaviour is pinned; the plans line is platform-wide in the picked view; `money` is on K-5 only and printed via `formatMoney` or copy; the DF-5 function and copy line are pinned. SA-W48: numeric strings are unreadable. SA-W54: one `toUnits` (credits) and no `× 100`. `minorUnitsPerMajor` is the one source of decimals. No cross-currency sum. Account-scoped reads only with a business picked. `requireAdmin` first. Logs carry counts only. Deviations approved. The Jest worker-exit warning predates 4a. | 2026-10-14 | Slice 4a |
| **SA-Q32 to SA-Q41** | **Slice 5a (M-1/M-2) rulings.**<br>• Q32: the business name is UI only (pick, then a payload row, then the short id); no route change. M-1 still runs the full cycle.<br>• Q33: an inbound one-shot `account` deep link on `/admin/users`, read once, opening the drawer if the row is on screen, then removed from the URL; recorded as an exception to layout U-10 (E-38).<br>• Q34: Activity and Costs get the custom window; AI cost & usage gets the account only.<br>• Q35: R-d is not called with a business picked; `state` then comes from R-m′ and R-k′ (E-36).<br>• Q36: the layer-B pager.<br>• Q37: the tier label through `tierLabelForGroup` (callback), "Unknown plan" otherwise, no literal (E-37).<br>• Q38: plan refunds and disputes left out until P-6b.<br>• Q39: zero-amount invoices go in a note.<br>• Q40: the per-currency combination is server side, with one exactness rule (E-34).<br>• Q41: no P-8a dependency. | 2026-10-14 | §11D |
| **SA-RR-5a** | **2026-10-14 SA requirement review (slice 5a, Money M-1/M-2): APPROVED WITH CONDITIONS.** Both parts run the full cycle (no UI short path).<br>**Findings:**<br>• S5-F1 (High): `paid_at` and the period fields are timestamps, so the payment list uses `formatUtc`, not `formatUtcDate` (E-33).<br>• S5-F2: the U-10 and C-6 layout amendments (E-38, E-39).<br>• S5-F3: the K-5 exactness rule (E-34).<br>• S5-F4: the definition of Paying / Not paying (E-35).<br>• S5-F5 to S5-F7: lower-severity items.<br>**Verified:** no table-pin growth; the billing-event caller list, `firstPaymentStamp` and the webhook placement guards are not tripped; checks 17 and 18 match the migration and the style rules.<br>The M-1 workplan starts after E-33 to E-39. | 2026-10-14 | Slice 5a |
| **SA-W55 to SA-W73** | **Slice 5a workplan rulings, all approved.**<br>• W55: one workplan and one PR, with the M-1 checkpoint as a hard gate (E-41).<br>• W56: every link carries the window, AI cost & usage included; supersedes SA-Q34's "(its own window)" (E-42).<br>• W57: a page-only `account` key (timing test SA-WR-36).<br>• W58: option (a), the refund-timing pin widened to exactly two users.<br>• W59: `netMinorByCurrency`; `k5` moves to `ourRevenue.ts`.<br>• W60: K-5's shape is kept.<br>• W61: `revenue.plans` becomes an object; R-d's behaviour stays pinned.<br>• W62: section status comes from the two money parts.<br>• W63: an absent part is an exact 0 only for an exact read.<br>• W64: unreadable is decided per row.<br>• W65: a `tierOrder` membership check gives "Unknown plan".<br>• W66: sort by currency first.<br>• W67: the Businesses link uses `status=all`.<br>• W68: a temporary local chip until M-6.<br>• W69: Finance is not added to the contrast walk; the new files are held by a finance rule.<br>• W70 to W73: as proposed. | 2026-10-14 | §11D, checks 17 and 18 |
| **SA-WP-5a** | **2026-10-14 SA workplan review (slice 5a, Money M-1/M-2): APPROVED WITH CONDITIONS.** One PR accepted, with the M-1 checkpoint as a hard gate. Required changes SA-WR-36 to SA-WR-40. BA applies E-40 (checks 17 and 18 take a month, default now), E-41 and E-42 (exact text in the workplan's SA review). | 2026-10-14 | Slice 5a |
| **SA-CR-5a** | **2026-10-14 SA code review (slice 5a, Money M-1/M-2): APPROVED, code approved for QA.**<br>• SA-WR-36 to SA-WR-40 verified; the M-1 checkpoint is recorded and every `lib/` / `app/api/` path in the final diff is M-2.<br>• The picker is deleted and the contract test is a deletion pin.<br>• R-m / R-m′: `invoice_paid` only, `minorUnitsPerMajor`, currency normalised, ceiling 5,000 with "At least", account-scoped reads.<br>• R-d is not called with a business picked; timestamps go through `formatUtc`.<br>• K-5 adds within one currency and is Unknown unless both parts are exact.<br>• The plans line is per account; the name chain is picked → payload → short id.<br>• The one-shot `account` key is stripped from the URL and filters nothing.<br>• Tier labels come through a callback, with no literal and no new entitlements import.<br>• Every link carries the window; no money in logs; `requireAdmin` is first; the billing and webhook guards are untouched.<br>• D-1 to D-6 approved; D-4 needs **E-43** (M2-FR-7: `recorded` = any `invoice_paid` row or a counted boost).<br>• The `useFinanceData.ts` server-logger use is pre-existing since 1a and deferred to M-6. | 2026-10-14 | Slice 5a |
| **SA-Q42 to SA-Q50** | **Slice 6a (M-3) rulings.**<br>• Q42: build the table only with `tab=accounts`.<br>• Q43: key `tab=accounts`, page-local tabs, no new shared export (E-46).<br>• Q44: `sort`, `group` and `show`, accepted only with the tab (E-48).<br>• Q45: export the boost and plan row readers, with the export pins updated; `refundsAndDisputesOf` stays private (E-44); after tax with no status literal (E-45).<br>• Q46: `summariseAiCost` returns the per-account map.<br>• Q47: a part refund of a taxed boost is Unknown.<br>• Q48: "Not available" before the cut-over.<br>• Q49: money-only accounts are shown.<br>• Q50: full cycle, one PR, 4b paused. | 2026-10-14 | §11E |
| **SA-RR-6a** | **2026-10-14 SA requirement review (slice 6a, Money M-3): APPROVED WITH CONDITIONS.** "No new read" verified (R-a, R-k, R-m, the plan walk and positions all carry the account; `aiCost.ts` already has the per-account map). Caller lists and table pin unchanged; billing placement untouched.<br>**Findings:**<br>• S6-F1 (High): the boost and plan export pins trip, and DF-5 must be extended to the new builder (E-44).<br>• S6-F2: after-tax from the reader result, no status literal (E-45).<br>• S6-F3: key `tab` (E-46).<br>• S6-F4: AC-134 scope (E-47).<br>• S6-F5: sort and filter keys only with the tab (E-48).<br>• S6-F6: 3 days accepted.<br>Checks 19 and 20 pass the style rules (QA runs them). The workplan starts after E-44 to E-48. | 2026-10-14 | Slice 6a |
| **SA-W74 to SA-W89** | **Slice 6a workplan rulings (all approved).**<br>• W74: optional payload keys `accountEconomics` (tab) and `accountMargin` (picked) (E-49).<br>• W75: integer scale 1e8 is exact with no double count; the bound is corrected to about USD 900,719.<br>• W76: `formatMoney` for "Paid us", `formatUsd` for cost and margin (E-50).<br>• W77 to W80: non-wire helpers; five names per export pin.<br>• W81: tax above net gives Unknown; follow E-45; differences from check 19 recorded (E-51).<br>• W82: precedence Not available > n/a > Unknown.<br>• W83: one group regex in pure `financeUrl.ts`, imported by the route, purity pinned.<br>• W84: `tab` with `accountId` returns 400.<br>• W85: platform rows have no link.<br>• W86 to W89 as written.<br>• Refund-note pin: three users. | 2026-10-14 | Slice 6a |
| **SA-WP-6a** | **2026-10-14 SA workplan review (slice 6a): APPROVED WITH CONDITIONS.** Required changes:<br>• SA-WR-41: the safe-range bound, with a boundary test.<br>• SA-WR-42: `financeUrl.ts` purity pin.<br>• SA-WR-43: negative-margin sign and "(USD)" headers.<br>• SA-WR-44: AC-145 baseline not edited.<br>• SA-WR-45: planted sixth export.<br>BA edits E-49 to E-51. | 2026-10-14 | Slice 6a |
| **SA-CR-6a** | **2026-10-15 SA code review (slice 6a, Money M-3): Code Approved.**<br>• SA-WR-41 to SA-WR-45 verified in code.<br>• The AC-145 baseline is unedited (two inserted hunks only).<br>• Deviations 1 to 9 approved: the route importing the sort and show lists from the pure `financeUrl.ts` keeps one definition.<br>• Third check-19 difference: a zero non-USD plan invoice makes no line (M2-W-5). **The page is right**; no code change; E-52 records it.<br>• Low follow-ups: tab `aria-controls` names an unmounted panel; the cost cell is Unknown where Section 3 prints a figure (unreadable or overflow rows), so AC-134 holds on readable data; the group select does not show an unlisted tier.<br>• No repository, billing or entitlements change; no money in logs; `requireAdmin` first.<br>• SA re-run: finance 2029, authz-guard 203, bos-entitlements 7986 tests, all exit 0. | 2026-10-15 | Slice 6a |
| **SA-Q51 to SA-Q57** | **M-4 rulings (all approved).**<br>• Q51: the vocabulary guard scans string literals and JSX text only, never identifiers, testids, metrics or rule ids; it has a fixed phrase list and a planted control.<br>• Q52: pass `end` less 1 ms; the route test asserts the exact value.<br>• Q53: race only; a late result is dropped and never rejects unhandled (E-57).<br>• Q54: optional `aiCost.recorded`, with no sum field.<br>• Q55: text now, the link in M-5.<br>• Q56: a difference, not a per-call match. It is honest, so there is no scope change for the user, provided it is named as a difference (E-54).<br>• Q57: two PRs under one workplan, OV-1 first. | 2026-10-15 | §11F |
| **SA-RR-M4** | **2026-10-15 SA requirement review (Money M-4, §11F): APPROVED WITH CONDITIONS.**<br>• Live, read-only: the views have no `feature` column (42703), and `business_os_usage_summary` has no cost and no end bound. The BA's claim holds.<br>• F-1 (High): the all-accounts exactness must use `completed`, not `reachedCeiling` (E-53, applied).<br>• F-2 (High): the M-3 AC-145 baseline trips; it is updated once in OV-5 (E-55, applied).<br>• F-3 (Medium): Finance's net difference is renamed "Recorded above charged"; the Leak check keeps "Recorded, not charged" (E-54, BA).<br>• F-5: AC-167 and AC-168 added (E-56, applied).<br>• F-6: the race rule (E-57, applied).<br>• F-7: the `TokenUsageRepository` header caller list is stale; the workplan amends it in full.<br>• ACs testable; checks 21 and 22 pass the style rules. | 2026-10-15 | §11F |
| **SA-W90 to SA-W104** | **M-4 workplan rulings (all approved).**<br>• W90: subtitle `${windowLabel}. ${AI_SOURCE}`, a ruled V-5 exception (E-59).<br>• W91 to W93: `activityCopy.ts:245` joins W-18; W-27 is `DrawerBox.tsx:45`; W-28 is `financeCopy.ts:482` (E-58).<br>• W94: the Health rule texts are left for M-5 (FU-M4-1).<br>• W95: comments reworded.<br>• W96: the Leak check reasons are left.<br>• W97: AST guard and its skip set; `aria-label`, `title` and `placeholder` are scanned.<br>• W98: R4-5 is right; the block renders outside Section 3's figure guard.<br>• W99: `leakCheckHref` carries `account` when a business is picked.<br>• W100: reuse `underDeadline`, 2 s.<br>• W101: B.2 names and B.3 order.<br>• W102: charged exactness is `figures.exact`.<br>• W103: `codeOf` and `/tokenusage/i`.<br>• W104: the one `Omit` line. | 2026-10-15 | §11F |
| **SA-WP-M4** | **2026-10-15 SA workplan review (M-4, two PRs): APPROVED WITH CONDITIONS.** Part B starts only after PR 1 merges; each part stops for the user's diff view (no go-ahead given).<br>• SA-WR-46: Section 3 subtitle pin.<br>• SA-WR-47: guard controls on `aria-label` and `title`.<br>• SA-WR-48: `bosRowFilter()` pinned on both reads.<br>• SA-WR-49: the 2 s deadline changes only by SA ruling after QA's 92-day timing.<br>• SA-WR-50: the picked view's charged units equal Section 3's.<br>SA applied E-58 (W-18 `:245`, W-27, W-28, AC-150) and E-59 (V-3 and V-5 exceptions); FU-M4-1 added to §0.4. | 2026-10-15 | §11F |
| **SA-CR-M4A** | **2026-10-15 SA code review (M-4 Part A, OV-1): Code Approved.**<br>• All 37 strings match W-1 to W-28 and CR §6: ledger figures say Charged, usage-log figures say Recorded, with no swap.<br>• No testid, rule id or metric changed; Health changes labels only.<br>• E-59 subtitle pinned (SA-WR-46).<br>• SA re-ran the guard scanner on the HEAD copies: 21 offences at HEAD, 0 now.<br>• D1 and D2 approved; D3 (a test comment and title) is left.<br>• Low follow-up: the Jobs page cron description still says "AI spend" (with FU-M4-1).<br>• SA re-run all green; two untouched load flakes (`jobsQueues.layout`, `creditsBlock`) pass when run alone. | 2026-10-15 | §11F |
| **SA-CR-M4B** | **2026-10-15 SA code review (M-4 Part B, OV-5): Code Approved.**<br>• Exactness from `completed` / `reachedCeiling` only, decided in `recordedCost.ts` (E-53).<br>• End − 1 ms on both reads; race-only 2 s deadline.<br>• Optional `aiCost.recorded` with no sum anywhere (planted control).<br>• Recorded − (total − deleted); "None" when charged is higher; Not available outside Section 3's figure guard (W98).<br>• Picked view: the account read only; SA-WR-48 and SA-WR-50 pinned.<br>• AC-145: E-55 hunks only; with `recorded` deleted, the 6a hash comes back.<br>• `/tokenusage/i` over code, exactly two methods; repository headers comments only; the Leak check link carries `account`.<br>• W104 OK; no money in logs; `requireAdmin` first.<br>• D1 to D5 approved; D5 wording confirmed, no E-edit.<br>• SA re-run all exit 0 (finance 2239, guard 137, readers 28, Health 296, entitlements 7984, authz 203). | 2026-10-15 | §11F |
| **SA-WP-F2** | **2026-10-15 SA workplan ruling (F-2, Finance header and states): APPROVED WITH CONDITIONS.**<br>• SA-W1: (a) export `adminReadFallback` from the shared reader, export only, pinned equal to the helper's fallback (F2-R1).<br>• SA-W2: Finance joins `MIGRATED_PAGES` now.<br>• SA-W3: `RETRY` becomes "Try again" now, so the page has one word (F2-R2).<br>• SA-W4: the notice loses `role="status"`, accepted (`AdminNotice` static-caveat rule).<br>• DV-1 (Refresh in the header until F-4) accepted.<br>• F2-R3: the slice that implements U-4 (BD-30) rewords "so the default view is shown".<br>• Texts match the `AdminLoading`, `AdminError` and `AdminNotice` wording; the F-0, F-1 and F-3 work stays intact; data is still cleared on failure; no data or API change. | 2026-10-15 | §11G |
| **SA-CR-F2** | **2026-10-15 SA code review (F-2): Code Approved.**<br>• F2-R1, SA-W2, F2-R2 and SA-W4 met.<br>• Header is `AdminPageHeader` "Finance"; DV-1 pinned; content area always mounted with `aria-busy`; data cleared on all three failure paths.<br>• `fallbackError`, `PAGE_LOAD_FAILED`, `LOADING` and `NOTICE_LABEL` removed.<br>• `git diff -w` shows no hidden logic change in `FinanceView`.<br>• F-0, F-1 and F-3 intact; no data, API or money change.<br>• Deviations approved: test block in `financePage.render`, renamed titles, substituted mutation.<br>• SA re-run all exit 0 (finance 366, layout/contrast/reader 470, vocabulary 137, authz 203). | 2026-10-15 | §11G |
| **SA-WP-F4** | **2026-10-16 SA requirement and workplan review (F-4, filter bar and URL state): APPROVED WITH CONDITIONS.** The F-4 part of §11G is sound and BD-28 to BD-31 are unchanged.<br>• SA-W10: AC-173 covers valid page states (15 literals, schema and serialiser hashes). Four bad or non-canonical link kinds change their request by decision (BD-30 bad value, BD-30 dependent keys, U-7 implied custom, repeated key), each pinned with its new literal (F4-R1, E-60).<br>• SA-W6: the U-7 narrowing is a recorded deviation (E-61).<br>• SA-W1: delete the notice.<br>• SA-W5 (a): refuse on Apply with a sentence (F4-R3).<br>• SA-W11: the request is unchanged.<br>• SA-W2 (a), SA-W3 (no second fetch, F4-R2), SA-W4 (a), SA-W7 (a), SA-W8 (a), SA-W9 (a).<br>• F4-R4: deviations recorded in the standard (TL/BA); F4-R5: the pin file is unedited after Step 0 (hash). | 2026-10-16 | §11G |
| **SA-CR-F4** | **2026-10-16 SA code review (F-4): Code Approved.**<br>• F4-R1 to F4-R3, W1, W3, W5 (a), aliases, old links, omitted defaults, DV-1 ended, standard labels: all verified.<br>• No `lib/` or `app/api/` diff; F-0 to F-3 and F-2 intact.<br>• **F4-R5 amended once by SA ruling:** only the pin file's `findByTestId` timeout (10 s) and a 30 s per-test timeout may change; no literal, hash input or assertion. The new file hash is recorded as the frozen value; the helper hash `b84e0c96…` is unchanged.<br>• Deviations approved: the pins self-check, `financeCanClear`, lower-cased picked-name key, `accountsTab` stubs, `financeUrlState` 30 s.<br>• Stale `router.replace` comments in `AccountsTab`/`FinanceTabs` fixed in this PR (comment only).<br>• SA re-run all exit 0 (finance 458, users 615, components 734, authz 203; the pin 21/21 three times in parallel). | 2026-10-16 | §11G |
| **SA-WP-F5** | **2026-10-16 SA workplan review (F-5, KPI tiles): APPROVED WITH CONDITIONS.**<br>• The ten `KpiTile`/`KpiStrip` callers are confirmed by grep and all covered by Pin A.<br>• S-7: one `OK_GREEN` object literal passes the C-14 check.<br>• Display only, by Pin B; the AC-173 pair is unchanged (`3a1a2dd4…`, `b84e0c96…`).<br>• SA-W1 no status row on neutral tiles.<br>• SA-W2 solid grey background, no existing caller affected.<br>• SA-W3 (a) Overview plus scroll (F5-R2).<br>• SA-W4, SA-W5, SA-W6 approved.<br>• **SA-W7 (a):** the K-1 link carries This month (UTC) plus the business, not the page window (F5-R1, E-62); no user question.<br>• SA-W8 section ids, unique (F5-R3).<br>• F5-R4: both new pins frozen, with explicit timeouts from the start.<br>• F5-R5: fix the stale line references. | 2026-10-16 | §11G |
| **SA-CR-F5** | **2026-10-16 SA code review (F-5): Code Approved.**<br>• F5-R1 to F5-R5 met: K-1 opens This month plus the business; the jump is scroll-only with no hash; ids are unique; the line references are fixed.<br>• Hashes recomputed: Pin A `30f5fc24…`, Pin B `24ff0da7…`, AC-173 `3a1a2dd4…`, helper `b84e0c96…`, all frozen and untouched.<br>• S-7: one green via `OK_GREEN` (chip string byte-equal); the C-14 Finance entry passes.<br>• Existing callers are byte-identical (name and `describedBy` formulas reduce exactly, no new `useId`).<br>• No `lib/` or `app/api/` diff.<br>• Deviations approved: the financeLinks files, the `accountsTab` reversal (a stronger assertion), the amber-check exclusion, the narrower link return type (same URLs), the mutation swap.<br>• SA re-run green: finance 527, components 804, analytics 191, business-os-llm 854, authz 203. The `bosLens` P-8 5 s timeout flaked once under load, outside the diff, and passes alone; flake follow-up recorded. | 2026-10-16 | §11G |
| **SA-RR-M5** | **2026-10-16 SA requirement review (Money M-5, §11H): APPROVED, edits applied.**<br>• SA-Q58 own entry; SA-Q59 stay; SA-Q60 `next.config.js` temporary redirect; SA-Q61 keep L-9a minus `costs`; SA-Q62 "(detail)" in both h1 and sidebar; SA-Q63 contrast key now; SA-Q64 no window; CR SA-Q-4 confirmed.<br>• Code facts re-checked: admin layout `requireAdminPage` gates the new page; the Health rules are code constants (wording only, never persisted).<br>• E-63: S-18 `ANALYTICS_WHAT` → "AI calls and usage"; AC-195 now covers S-1 to S-18.<br>• E-64: `tabCoexistence` X-8, X-8b and X-10 kept and re-scoped. | 2026-10-16 | §11H |
| **SA-WP-M5** | **2026-10-16 SA workplan review (M-5): APPROVED WITH CONDITIONS.**<br>• W1: the stray `tab=costs` is harmless (no reader; the sidebar matches by pathname).<br>• W2 dual-mount Pin C approved.<br>• W3 Next internals accepted, with M5-R3 (shape block separate, version in the title, curl recorded).<br>• W4 rename; W5 stay; W6 not as listed (M5-R1: re-scope X-8, X-8b, X-10); W7 rename (S-18, M5-R2); W8 to W11 approved.<br>• M5-R4: pins C and D frozen with 10 s waits; the four existing hashes unchanged.<br>• Nav 28 → 29 is correct; C-14 entry and uniqueness case; `test:bos-entitlements` runs. | 2026-10-16 | §11H |
| **SA-CR-M5** | **2026-10-17 SA code review (Money M-5): Code Approved.**<br>• M5-R1 (X-8, X-8b, X-10 re-scoped; only X-1, X-2, X-3, X-12 and one `costsTab` case deleted), M5-R2 (S-18), M5-R3 (shape and internals blocks, curl recorded) all met.<br>• M5-R4: all seven hashes recomputed and equal (C `98ea0507…`, C helper `02813360…`, D `1f7cf07a…`, A, B, the AC-173 pair).<br>• `evaluateHealth.ts`: link and wording only; Health results change only in the spend tile's `pageLink`.<br>• Deviations approved: the 18-file vocabulary guard; X-6 kept to `keep=1` (no coverage lost).<br>• The costs files are not moved; no API, data or money change.<br>• Follow-up chip: harden `qa-slice5-pr2.route.test.ts` (wall-clock `< 1000` ms) together with `bosLens` P-8.<br>• SA re-run all exit 0 (finance 564, business-os-llm 850, components 816, Health 319, entitlements 8472, authz 203). | 2026-10-17 | §11H |
| **SA-Q65 to SA-Q74** | **4b rulings.**<br>• Q65: no `occurred_at`.<br>• Q66: CASCADE plus `20261073` regenerated in the same PR, applied right after; no DELETE grant needed.<br>• Q67: `ON CONFLICT DO NOTHING`.<br>• Q68: two reads, 100-id chunks (E-69).<br>• Q69: keep INVOKER.<br>• Q70: the rollback refuses; order `20261073` then `20261072`; fix forward once rows exist (E-67).<br>• Q71: add the table to the payment write-lockdown scan.<br>• Q72: one ruled update per pin (the AC-145 baseline as E-55; 6a pins only where FR-4B-11 changes a figure).<br>• Q73: Pin B not re-frozen; it serves fixed payloads (E-68).<br>• Q74: count each event as recorded, with a note. | 2026-10-17 | §11I |
| **SA-RR-4b** | **2026-10-17 SA requirement review (§11I, slice 4b): APPROVED WITH CONDITIONS.**<br>• The function rewrite is safe: same transaction and row lock, retries and the reconcile pass hit `already`/`stale` before any write, the signature and grants are kept, and no DEFINER guard trips.<br>• RLS and grants fit the lockdown conventions.<br>• F-2: the RV-9 race is narrowed by `LOCK TABLE` and proven by a new check 24 row (E-65).<br>• F-4: AC-207 to AC-211 are proven by a local-only self-checking SQL script in `BEGIN … ROLLBACK` (E-66).<br>• The deploy order is honest; checks 23 to 26 are editor-safe; the split is sensible.<br>• **No user business decision.** The only possible user touchpoint is a Stripe test-mode refund if Dev has no local database (F-5). | 2026-10-17 | §11I |
| **SA-W105 to SA-W115** | **4b.1 workplan rulings.**<br>• W105: TS-only `CASCADE_CHILDREN` accepted by the coverage test, with a planted control.<br>• W106: separate `LATER_SERVER_ONLY_TABLES`.<br>• W107: md5 fail-closed in the migration plus check 23.<br>• W108: no separate user confirmation; check 23's 20261047 row is the gate (if false, stop and re-plan).<br>• W109: `INSERT … SELECT`, proven byte-identical by subtraction.<br>• W110: PGlite 0.5.8 (PG 18.3) satisfies E-66; nothing used differs from prod PG 17; no test-mode refund needed.<br>• W111: both rollbacks or neither.<br>• W112: record only (FU-4B-1).<br>• W113: strengthened checks supersede §13 (E-70).<br>• W114: register in `USER_OWNED_TABLES`.<br>• W115: `NOTIFY pgrst` in the migration and its rollback. | 2026-10-17 | §11I |
| **SA-WP-4b1** | **2026-10-17 SA workplan review (4b.1, reversal events): APPROVED WITH CONDITIONS.**<br>• E-65 to E-68 honoured.<br>• Grants and RLS follow the lockdown conventions; idempotency arbiters are explicit; INVOKER and the signature are unchanged.<br>• The guard list and AC mapping are complete; the checks are editor-safe; estimate about 2.1 days.<br>• B1-R1: the Danger Zone wording covers from step 2 to the deploy. B1-R2: the self-check header says local only. B1-R3: the md5 and stamp placeholders are filled and pinned.<br>• **No user action beyond the planned apply steps.** | 2026-10-17 | §11I |
| **SA-CR-4b1** | **2026-10-17 SA code review (4b.1, reversal events): Code Approved.**<br>• `20261072` was verified by SA's own script: the body minus the six inserts is byte-equal to `20261031`, the header is byte-equal, and the arbiters are exact. Old and new md5 are `b9a5fe31…` and `018c4447…`; the rollback restores `b9a5fe31…`.<br>• Lock, RV-9 and md5 refusals come first; RLS is on with no policy; the nine-column INSERT excludes `id` and `recorded_at`; `NOTIFY` is present.<br>• `20261073` is the generator output (stamp `f854486b31baf784`).<br>• Checks 23 (8 rows) and 24 (23 rows) are editor-safe; the self-check is local only with three guards.<br>• The forced re-pins (155 → 156; allow-lists for `20261046` and `20261047`) are legitimate: those files are applied history pinned by sha256.<br>• `test:gate`'s 9 failing suites are Windows path and env failures outside every 4b.1 input; not blocking.<br>• All seven frozen pins unchanged.<br>• SA re-run all exit 0. The PR stays off auto-merge until the user's apply steps. | 2026-10-17 | §11I |
| **SA-CR-4B1-R** | **2026-10-17 SA code review (4b.1 rebase onto DE-8a): APPROVED WITH CONDITIONS.**<br>• `20261076` is the old 72 unchanged (rename, 0 lines). `20261077` vs `20261075`: 8 lines (header, the reversal-events edge, stamp `b78b4579fc6631f8`). Its rollback restores `20261075`.<br>• Only `20261031` and `20261076` define the transition function. 76 and 77 are free on every remote. Counts 157 = 38 + 0 + 119. Check 23 has 9 rows. Runbook and rollback order are right; stale references are history only; scripts are paste-safe.<br>• (a) The DE-8a test's literal `20261075` stamp is acceptable (an applied, immutable stamp, cross-checked against that file).<br>• (b) **R-1 (High), fix in this PR:** DE-8a's rollback guard must refuse while any live cleanup body names `business_os_data_exports`, not match one stamp; pin and PGlite proof.<br>• R-2: note the DE-8a checker's stamp row reads false after 77. R-3: §11I.6 step 3 wording. | 2026-10-17 | §11I |
| **SA-WR-4b2** | **2026-10-17 SA workplan review (4b.2, refund and dispute display): APPROVED WITH CONDITIONS.**<br>• E-103: new wire fields on Pin B's types are optional (E-68's intent kept), and a builder test proves they are always set.<br>• E-102: held leaves the window net by BD-17 and FR-4B-5, so K-5 also moves on an open dispute. A factual fix, **not a BQ**.<br>• E-104: `heldNow` is a per-currency list beside the lines.<br>• R-l / R-l′ are built in 4b.2. A sixth export, `readReversalMoney`. One ruled AC-145 update under SA-Q72, with the old hash kept as a second assertion.<br>• 4B2-R1: every request, chunks included, pages at 1,000. 4B2-R2: isolation tests. 4B2-R3: `tsc` over the seven pins. 4B2-R4: no lot write (BQ-13).<br>• One fetch, `requireAdmin`, per-currency only, about 2.1 days. | 2026-10-17 | §11I |
| **SA-CR-4b2** | **2026-10-17 SA code review (4b.2): Code Approved with conditions CR-1 to CR-3 before the RM commit.**<br>• R1 to R4 met:<br>  ◦ a keyset at ≤ 1,000 on every request, with 100-id chunks each paged;<br>  ◦ R-n′ reads the parent purchases first and fails closed on a foreign event;<br>  ◦ the scoped `tsc` includes the seven pins (clean 0);<br>  ◦ no lot write.<br>• Optional fields are set every time. AC-145: new hash `39b35743…56ea`, and the E-55 hash re-asserted with the 4b.2 keys stripped.<br>• `route.ts` untouched, so one fetch. Per currency. Table-absent reads `warn` and Unknown. Seven pins recomputed and equal.<br>• **CR-1:** Section 6 frame becomes "Payment problems"; the "Client payment problems" / "not ours" heading moves to block B only (FU-4B2-1 fixed now).<br>• **CR-2:** re-issue SQL check 19 on the event rule (FU-4B2-2 fixed now).<br>• **CR-3:** Pin C row 1 failed once under parallel load (passed 11/11 alone); QA re-runs quietly.<br>• DV-3 and DV-5 resolved by CR-1 / CR-2; the other DVs approved. | 2026-10-17 | §11I |
| **SA-RR-M8** | **2026-10-17 SA requirement review (Money M-8, §11J): APPROVED, E-71 applied.**<br>• **BD-34 reading:** "just add comments it is redundant for now and not use them" means code comments only and **no visible notice**. BQ-14 is resolved by BD-34 and not sent to the user. RP-4, AC-236, the §11J.2 scope row, §11J.4 and the BQ-14 paragraph are amended.<br>• `docs/MULTI_CURRENCY_SYSTEM.md` is added to the pointer notes.<br>• Estimate about 0.75 day.<br>• Q75 remove the hidden item; Q76 and Q77 moot; Q78 comment only; Q79 a new guard; Q80 FU-M8-1. | 2026-10-17 | §11J |
| **SA-WP-M8** | **2026-10-17 SA workplan review (M-8): APPROVED WITH CONDITIONS.**<br>• References re-found by `git grep` (sidebar, the dashboard's fetch, the route comment); the visible nav is unchanged; Pino matches the dashboard; no Health, C-14, contrast or authz edit; the seven pins are unchanged (LF-normalised, clean against HEAD).<br>• M8-R1: drop the notice, Step 2 and the render test. M8-R2: the MULTI_CURRENCY doc pointer. M8-R3: planted controls for every guard rule. M8-R4: LF-normalised hashes. | 2026-10-17 | §11J |
| **SA-CR-M8** | **2026-10-17 SA code review (M-8): Code Approved.**<br>• Comment-only page and route diffs, plus Exchange rates' Pino lines; no notice (G-3); `'use client'` stays first.<br>• Hidden item and icon removed; visible nav unedited; parked 15 → 14 (both pins) and hrefs 29 → 28.<br>• G-1 to G-5 each have a planted control.<br>• MULTI_CURRENCY, ADMIN_IDENTIFICATION and reorganisation doc edits were needed (stale references to the removed item and the route).<br>• Seven pins unchanged (LF-normalised).<br>• SA re-run exit 0 (components 818, guards 401, authz 203). | 2026-10-17 | §11J |
| **SA-RR-6b** | **2026-10-17 SA requirement review (slice 6b, §11K): APPROVED, edits applied.**<br>• SA-Q81 to SA-Q91 as the BA suggests: `financeRules.ts` data constant; gross fee; per-charge rounding; sort and filter on the AI margin; the AC-145 baseline unchanged; "estimate" wording; Pins A and B unedited; the order test in the page test; one PR under BD-33; fee stays on the charge.<br>• E-72: a zero-total boost is not a charge (FE-1, AC-245, checks 27 and 28).<br>• E-73: a missing or invalid USD config gives Unknown (FE-9).<br>• E-74: fee subtracted in minor units before the single scale step (FE-8).<br>• Checks 27 and 28 are editor-safe. | 2026-10-17 | §11K |
| **SA-WP-6b** | **2026-10-17 SA workplan review (6b): APPROVED WITH CONDITIONS.**<br>• Fee maths re-derived (7900 → 259, 4414 → 158, 1000 → 59, 500 → 45, 499 → 44).<br>• 6b-2 exact with no double scaling.<br>• Pin B sorts ids, so it is order-free; all seven pins unchanged.<br>• `route.test.ts:1357`/`:1385` and `financeHealth.test.ts:1981` are not frozen.<br>• 6b-1 to 6b-11 approved.<br>• 6B-R1: the FE-8 text. 6B-R2: note percent and fixed render test. 6B-R3: zero-total boost builder test. | 2026-10-17 | §11K |
| **SA-CR-6b** | **2026-10-17 SA code review (6b): Code Approved.**<br>• E-72, E-73 and E-74 met; the AI margin is the unchanged `marginUnitsOf(revenue, cost)`, and after-fees is `marginUnitsOf(revenue − fees, cost)`.<br>• 6B-R2 and 6B-R3 tests present.<br>• Fees: 7900 → 259, 1000 → 59, total 318.<br>• The fee stays on the charge.<br>• Tile blocks moved whole into K-5, K-1, K-3, K-2, K-4, with an order test.<br>• Seven pins unchanged.<br>• D-1 to D-6 approved.<br>• SA re-run exit 0 (finance UI 613, finance lib 1652, route and vocabulary 272, authz 203). | 2026-10-17 | §11K |
| **SA-RR-DF6** | **2026-10-17 SA requirement review (DF-6, §11L): APPROVED WITH CONDITIONS.**<br>• DF6-F1 (Medium): the start is the cut-over instant only. The first-activity rule could drop an early charge and adds nothing (E-75).<br>• DF6-F2: shared `resolveWindow` gives `none` for `since_start`; one ruled update to the extras list pin (E-76).<br>• DF6-F3: the link helpers never send `range=since_start` (E-77).<br>• DF6-F4 to DF6-F6: AC-262 end, Section 1 "new in window", type widening (E-78 to E-80).<br>• SA-Q92: resolved in the route, pure. SA-Q93: shared extras. SA-Q94: the cut-over. SA-Q95 to SA-Q99 as the BA suggests.<br>• Cap, `requireAdmin` first, ceilings, columns, no timezone read, isolation and pins all verified. BQ-16 default accepted. About 1.25 to 1.5 days. | 2026-10-17 | §11L |
| **SA-WR-DF6** | **2026-10-17 SA workplan review (DF-6): APPROVED WITH CONDITIONS.**<br>• W-DF6-1: `formatUtc` with " UTC" stripped, "Since it started: 2026-09-29 16:50 to now (UTC)" (E-81).<br>• W-DF6-2: summary window line for `since_start` only, text computed once in `FinanceView` and passed in (E-82).<br>• W-DF6-3: one ruled update of the links import pin, adding `adminWindowPresets` (E-83).<br>• W-DF6-4: `toFinanceQuery` sends the default without a business; the route 400 stays the backstop.<br>• W-DF6-5 to W-DF6-8 as Dev suggests; line ref `planGroups.ts:224` (E-84).<br>• DF6-R1: the folder-wide `user_preferences` / `timezone` ban skips `__tests__`. DF6-R2: one label source. DF6-R3: the ruled pin edits are listed exactly in the handover. | 2026-10-17 | §11L |
| **SA-CR-DF6** | **2026-10-17 SA code review (DF-6): Code Approved.**<br>• **D-1 approved; SA-Q96 corrected:** AC-173 part B hashes the route's `DATE` + `buildQuerySchema` text, so the schema stays unedited and `parseFinanceQuery` admits `since_start` around it (only with `accountId`, else 400).<br>• **D-2 approved, DF6-R3 amended:** a third ruled test edit, the `financeLinks.test.ts:34`/`:39` type narrowing, applied by SA. Scoped `tsc`: canary 1, clean 0.<br>• Isolation, the single first request, links, U-4, the timezone ban and the label verified. Seven pins recomputed and equal; AC-145 untouched; vocabulary guard untouched.<br>• SA re-run: 37 suites, 2605 passed. | 2026-10-17 | §11L |
| **SA-RR-8** | **2026-10-17 SA requirement review (slice 8, §11M): APPROVED WITH CONDITIONS.**<br>• S8-F1 (High): AC-173 asserts exactly one fetch, so the History block opens on demand and sends no request on load (E-85).<br>• S8-F2 (High): the dimension CHECK must admit `tier:` keys with a hyphen, and the builder checks every row first, so a bad key skips only `plan` (E-86).<br>• S8-F3: the job passes a 30 s credit budget (E-87).<br>• S8-F4: an upsert that ignores duplicates, plus `.select('id')` (E-88).<br>• SA-Q100 to SA-Q107 as the BA suggests; SA-Q104: keep the `day_ended` CHECK.<br>• `20261074` is free (main 20261071; #447 holds 72 and 73). House style, columns, cron and descriptors verified. 3.5 days. | 2026-10-17 | §11M |
| **SA-WR-8.1** | **2026-10-17 SA workplan review (slice 8.1): APPROVED WITH CONDITIONS.**<br>• E-91: the migration is now **`20261078`**, superseding SA-RR-8's `20261074` (#451 took 74 and 75; #447 is taking 76 and 77).<br>• Cleanup function: no new version, confirmed on main (a global `never` is filtered out; no FK, no `user_id`).<br>• E-89: `NOTIFY pgrst` in the migration and the rollback. E-90: the pure shape module ships in 8.1.<br>• E-92: count pins recomputed from merged main at code time (main is 156 / 118); the second of #447 and 8.1 to land re-counts.<br>• E-93: check 32's tier row is an exact-pattern match; the uuid row is dropped, so check 32 has 16 rows.<br>• 8.1-R1: merge `origin/main` first. 8.1-R2: UTC dates in the self-test. About 1 day. | 2026-10-17 | §11M |
| **SA-CR-8.1** | **2026-10-17 SA code review (slice 8.1): Code Approved.**<br>• `20261078` meets §11M.6 and E-86 / E-89 / E-93: append-only, RLS on with no policy, `service_role`-only grants, the unique key, the exact dimension pattern, `day_ended`, `NOTIFY`.<br>• The rollback refuses with rows. Checks 31 and 32 have 6 and 16 rows. Self-test and runner pass S-01 to S-21; all 17 mutations are caught.<br>• Shape module pinned to both CHECKs and to `FINANCE_GROUP_SHAPE`. Descriptor and counts 157 / 119. Cleanup untouched; seven pins equal; SA re-run 1715 passed.<br>• D-1, D-2 and D-3 approved.<br>• The one scoped-`tsc` error (TS2353, `exportClassification.test.ts`) **exists on `origin/main` itself** (line 1962, DE-7 `adf9e37f`): a main defect for the DE stream, not fixed here.<br>• **MR-1:** whichever of #447 and 8.1 merges second recounts to **158 / 120**. | 2026-10-17 | §11M |
| **SA-WR-8.2** | **2026-10-17 SA workplan review (slice 8.2): APPROVED WITH CONDITIONS.**<br>• E-94 amends SA-Q105: the wiring picks from `financeHealthDeps()`, so no caller list changes. `walkPlans` and `payingSetOf` are exported with no behaviour change (the AC-145 hash).<br>• E-95: `bought_outstanding` comes from a shared `outstandingBySource` (K-4's loop), with K-4's "existing accounts" rule.<br>• E-96: missing table means a probe, then 503 with zero reads. E-97: an injectable clock. No Run now.<br>• 8.2-R1: the E-86 pre-check runs on the emitted rows. 8.2-R2: a guard pins the writer to the job and the wiring only. 8.2-R3: `payingSetOf` keeps null as unknown. 8.2-R4: one clock.<br>• Cron pattern, isolation, 30 s budget, idempotency, pins and CI time verified. 1.5 days. | 2026-10-17 | §11M |
| **SA-CR-8.2** | **2026-10-17 SA code review (slice 8.2): Code Approved.**<br>• R1 to R4 met: shapes checked on the emitted rows, family skip only; the writer is reachable from the job and its wiring alone (whole-tree guard); null paying skips `plan`; one clock.<br>• Missing table: probe, then 503 with no reads. `CRON_SECRET` fails closed. Run is recorded. Registry and `vercel.json` at `7 0 * * *`. The one idempotent upsert. 30 s budget.<br>• The refactors are behaviour-neutral (AC-145 and `creditsSection` tests unedited and green). Seven pins recomputed and equal; SA re-run 1720 passed.<br>• **`addedOn`:** RM sets the UTC date of the first 00:07 run after the production deploy; later is harmless, earlier is not.<br>• `qa-slice5-pr2` flake is unrelated (`task_d3dcf2de`). | 2026-10-17 | §11M |
| **SA-WR-8.3** | **2026-10-17 SA workplan review (slice 8.3): APPROVED WITH CONDITIONS.**<br>• E-98: the reads go in a **separate read-only `BusinessOsFinanceSnapshotReadRepository`**. The writer file and 8.2's writer guard stay unedited.<br>• E-99: the route returns a server-built view (points, gaps, cells, change), not raw rows.<br>• E-100: `not_installed` answers 200 with a calm notice (tests only, no browser step); an optional `statusChip` (default true) on `FinanceSection`.<br>• E-101: the empty-history copy reads "a snapshot is taken every night at 00:07 UTC".<br>• `seedGroups` exported. The page's window, never `accountId`.<br>• 8.3-R1 split, 8.3-R2 route order and `no-store`, 8.3-R3 one-fetch proofs. About 1 day. | 2026-10-17 | §11M |
| **SA-CR-8.3** | **2026-10-17 SA code review (slice 8.3): Code Approved** (first Fix Required on C-1; the fix was re-checked by SA: 1,000-row pages in key order, stop on a short page, error past 5,000; tests 3,700 / 5,000 / 5,001 under a 1,000-row mock; 29 passed).<br>• **C-1 (High, fixed):** `listSnapshotsInRange` uses one `.range(0, 5000)`, which PostgREST's `max-rows` (1,000) cuts silently. A 92-day window (about 3,700 rows) would show about 25 days and false "No snapshot" gaps. **Fix:** page in 1,000-row pages up to the 5,000 ceiling, with a test of a 1,000-row cut.<br>• Everything else approved: the split (the writer and the 8.2 guard unchanged), the server-built view, `requireAdmin` first and `no-store`, the calm `not_installed`, one fetch on load on both paths, `statusChip` default true, isolation, no currency, the guards. Seven pins recomputed and equal; SA re-run 2137 passed.<br>• D-1: `financePage.render.test.tsx` is not a pin file. D-2: the error shows in-block with Try again. | 2026-10-17 | §11M |

### 0.4 Deferrals and parked items

| # | Item | Why | Date |
|---|---|---|---|
| FU-M4-1 | The Health tile's rule descriptions and metric labels (`lib/admin/health/rules.ts`) still say "spend" under the "Recorded AI cost" title | They are pinned by the Health rule tests, which AC-151 keeps unedited; reword them in M-5 (SA-W94). Same follow-up: the Jobs page cron description at `lib/cron/bosCronJobs.ts:452` ("Business OS AI spend", SA-CR-M4A). **2026-10-16: taken into M-5 (§11H.5 S-14 to S-17)** | 2026-10-15 |
| BQ-13 | **Open business question, attached to 4b:** when a boost is refunded, does it take back the credits it bought? | Still open (user, 2026-10-16). Until the user decides, 4b keeps today's behaviour: the customer keeps the credits. If the user decides credits are taken back, that is a credit-ledger write in the boost module, not a Finance display change, and it is scoped with 4b. **2026-10-17: still open; §11I specifies 4b with no take-back (RV-10, AC-213); a later decision is scoped on its own** | 2026-10-16 |
| BQ-15 | **Open business question, attached to 6b (does not block it):** what Stripe fee rate should the "Margin after Stripe fees (estimate)" use for plan and boost payments? | **Default, used to build 6b:** (a) Stripe's standard card price, **2.9% + USD 0.30 per successful charge**, on the gross amount charged, USD only; (b) a refunded charge keeps its fee; (c) the separate dispute fee, and any Stripe Billing, Stripe Tax, international-card or currency-conversion surcharge, are **not** included. The rate is an assumption, not a recorded fee: our real Stripe rate has not been checked. It is config data (§11K.3 FE-4), so the user can change it later with no logic change | 2026-10-17 |
| DF-1 | Currency-grouping helper (CUR-1, CUR-2) and AC-13 moved from slice 1 to **slice 2** | Slice 1 shows only USD AI cost; a helper with no production caller is dead code (SA-F10) | 2026-10-09 |
| DF-2 | "Businesses without a plan row" is **not** shown in slice 1 | A shadow-report fact (`findTenantsMissingPlanRow`); the page links to Plans & entitlements instead (SA-F7) | 2026-10-09 |
| DF-3 | **Filter out test businesses or users (future)** | BD-13: test and real client payments are shown together and all layer-B data is treated as real for now; no test-mode label and no livemode migration. A later slice may let the admin exclude chosen test businesses or users from the layer-B figures. Needs its own business decision on how a business or user is marked as test | 2026-10-11 |
| DF-4 | The finance page **shell** adopts the shared admin layout standard ([ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md)): `AdminPageHeader`, `AdminFilterBar` through `useAdminFilters` (canonical `range` / `account`, with `preset` / `accountId` read as legacy aliases), the shared `KpiStrip` with its cross-page tile mode, and the C-14 registry entry | Not in slice 2: a layout migration is UI-only and must not ride in a data slice (layout standard §3 rules 1, 4 and 5). Slice 2's **new** blocks use the shared components from the start (S2-FR-13). Its own slice, after 2b (SA-Q18). **2026-10-15: being delivered as Money M-6 by slices F-2, F-4 and F-5 (§11G), owned by the finance stream** | 2026-10-11 |
| DF-5 | **Boost refund and dispute dates** | No date is stored for a boost refund or dispute, so slice 4 counts them in the purchase month (S4-W-3). Showing them in the month they happen needs a writer-side change in the boost module (for example a refund event record). User choice pending; default: purchase month. **Pending user question (refund timing).** **Decided 2026-10-14 (BD-17): refund month; lost dispute in the month lost; held means held now.** The writer-side date and the page change stay deferred with FIN 4b (paused during Money M-1 to M-3). **2026-10-17: specified in §11I** (4b.1 writes dated reversal events; 4b.2 reads them; closed when 4b.2 merges) | 2026-10-13 |
| DF-6 | **"Since it started" view for one account** (CR BQ-9: a window beyond the 92-day cap, from the charging cut-over, for a picked account only) | Not needed for M-1: the account summary answers the picked window. It raises the cap for account-scoped reads only, a route and validation change (CR SA-Q-6), so it is not UI-only. A later Money item, after M-3. **2026-10-17: scheduled as slice DF-6, specified in §11L** (after 6b in the BD-32 order; the cap is lifted only for `since_start` with a business picked; no migration) | 2026-10-14 |
| BQ-16 | **Open business question, attached to DF-6 (does not block it):** with "Since it started" picked, should the business's **client takings** (layer B, clients paying the business) also start at the charging cut-over, or show the business's whole history? | **Default, used to build DF-6:** the same window for every section, starting at the cut-over (DF6-W-7), so the page has one span and one label. Client payments before 29 Sep 2026 are not shown in this view (check 30 counts them). Showing all-time takings would need a second window on one page | 2026-10-17 |
| DF-7 | **Refused plan payments with an amount** (`mismatch_refused` rows) | Live: 8 test-mode rows, no account (`unknown_customer`), amounts recorded (§11D.1). They are not revenue of any account and M-2 never counts them (M2-W-2). Showing them belongs to platform payment problems (slice 7) | 2026-10-14 |
| DF-8 | **Stripe fee estimate in the AI margin** (BD-7) | M-3 shows AI margin with the label "Stripe fees not deducted" and no estimate. The labelled estimate (the boost requirement's assumed 2.9% + USD 0.30) needs a per-payment rule for plans and boosts and its own exactness rule; it moves to slice 6b with K-7 and the per-plan margin (BD-8). DF-6 also stays deferred after M-3 (it changes the 92-day cap, a route and validation change; §11E.2) | 2026-10-14 |
| BQ-17 | **Open business question, attached to slice 8 (does not block it):** should the history be recorded **daily or monthly**? | **Default, used to build slice 8:** daily, at the end of each UTC day (HS-W-1). A monthly view is the last day of each month, so daily loses nothing and shows a change within the month. Monthly would mean about 30 times fewer rows, which does not matter at this size | 2026-10-17 |
| BQ-18 | **Open business question, attached to slice 8 (does not block it):** how long should the snapshots be kept? | **Default:** forever. They are a few dozen rows a day (about 13,000 a year), hold no personal data, and cannot be rebuilt once deleted. Keeping them for a fixed time (for example two years) would need a later prune job and a migration that grants delete | 2026-10-17 |
| BQ-19 | **Open business question, attached to slice 8 (does not block it):** should past days be filled in? | **Default:** no backfill. Plan mix and credit positions cannot be rebuilt for the past (§11M.2), so history starts on the first night after slice 8.2 ships, and the page says so ("History starts on {date}"). Gifted and bought credits could be estimated for past days, but a series that is exact from one date and estimated before it would mislead | 2026-10-17 |
| BQ-20 | **Answered 2026-10-18 (BD-36):** should the redundant Exchange rates page stop allowing edits? | The user said yes, the default. Raised in the FF-1 workplan because BD-34 said comments only. Carried out by FF-1a | 2026-10-18 |
| FU-M8-1 | Exchange rates wrote `exchange_rates` from the browser (§11J SA-Q80) | **Closed by FF-1a (BD-36), PR [#465](https://github.com/AgentsPilot/neuronforge/pull/465):** the page is read-only; the database side is FF-2 | 2026-10-17 |
| FF-2 | **Close browser writes on the rate tables in the database** (follow-up, not scheduled). **Superseded 2026-10-19 (BD-55)** by slice 1b of [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md); original text kept for history | FF-1a removes the page's writes, but a signed-in browser session could still write if the database allows it. The user runs **check 35** (`scripts/check-bos-exchange-rates-write-access.sql`) once on production. If a write grant is held and RLS is off or a write policy applies, BA specifies FF-2: one migration revoking INSERT, UPDATE and DELETE only, user-applied, with pre and post checks. **SELECT stays for `authenticated`** on `exchange_rates`, because the settings currency picker reads it from the browser (SA-WR-FF1) | 2026-10-18 |
| R4-FU-1 | **Next Finance follow-up: remove the unwired R-c and R-c′** (`listBillingStatusesAllAccounts`, `findBillingStatusForAccount`) from `BusinessOsFinanceReadRepository`, with their tests | Since R4 (BD-37) nothing calls them; they stay only because `FinanceHealthDeps['finance']` is a `Pick` of the repository. Removal moves that type, and touches the finance table pin, the billing-table reader list and possibly the AC-145 named reads (pins), so it needs its own SA-reviewed slice | 2026-10-18 |
| MK5B-FU-1 | **Rework the Converted this month first-payment read before the account count passes 1,000** (Money MK-5b, SA-CR-MK5B) | It asks about every plan-row account: one request for each 100 ids (more with paging), so its cost grows with the account count. Fine at today's scale. QA estimate (2026-10-20): because it reads every past payment, the figure turns permanently "Unknown" at about 1,700 paying accounts after a year, so the rework must land well before that. Options include reading only the paying accounts plus this month's payers, a this-month `paid_at` filter with an earlier-payment check, or a server-side first-payment-per-account view. Needs its own SA-reviewed slice, and AC-145's expected calls move | 2026-10-20 |
| DF-9 | **History of overdue client invoices and instalments** (Section 6 block B, as of now) | Not rebuildable, but it is money in the clients' currencies; slice 8 stores no money (HS-W-9). It needs its own metric family with a `currency` column and one row per currency (CUR-1), in a later slice if wanted | 2026-10-17 |

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

**Layer A from slice 1c (BD-14, 2026-10-13):** BD-10 is superseded. Platform money counts test-mode and live-mode rows together and treats all of it as real, with no switch and no label; R-c, R-c′ and R-d drop the `livemode` filter (§11B). The paragraph above is kept for history.

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

**Slice 1c (§11B.3):** K-3's definition text is unchanged, but paying champions are grouped under their tier (BD-15) and are not counted. K-5 becomes "Platform revenue (test and live mode together, BD-14)", still grey with no value.

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

**Slice 1c (BD-14, BD-15):** "Paying" counts test-mode billing rows too, and a paying account that this table would place in Founding Partner goes to its paid tier's group with a Founding Partner note (§11B.2, S1C-FR-2 to S1C-FR-4).

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
| **8** | History snapshots (plan mix, credit position) for trend lines and churn of free accounts; scale path for any aggregate. **Specified in §11M (2026-10-17)** as 8.1 / 8.2 / 8.3; churn of free accounts is out of slice 8 (§11M.3). | A migration and a cron on the `bos_cron_runs` pattern (SA) | **Yes** (`20261078`) |

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

**Slice 1c supersedes S1-FR-25 to S1-FR-27** (BD-14): the check counts both modes and the panel wording is in §11B.3. The rows above are kept for history.

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
| S2-CUR-5 | No FX, no `exchange_rates` read, no combined figure and no ranking across currencies (CUR-3, BD-12). Any list that holds several currencies is sorted by currency first. A list sorted by a date (the overdue invoice and instalment tables) keeps its date order; no amount is compared across currencies, and every amount cell names its currency. |
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
| S2-FR-23 | **Each part on its own:** one failed read makes only its part "Could not load this part"; the rest of the block and the page render; the route returns 200 with per-part status. The block's own status is never `unknown`: it is `partial` when any part is `partial` or `unknown`, and `ok` otherwise, so a failed part never hides the others; each part shows its own status in words. | 2b |
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
| **R-h** | `listOverdueClientInstalmentsAllAccounts(todayUtc)` | Named all-accounts | `payment_plan_installments`, status `overdue`, or status `pending` with `due_date < todayUtc` | `id, user_id, amount, currency, status, due_date` | 2b |
| **R-h′** | `listOverdueClientInstalmentsForAccount(accountId, todayUtc)` | Account-scoped | Same, plus `user_id` | Same | 2b |
| **R-i** | `listClientPlansAllAccounts()` | Named all-accounts | `payment_plan_subscriptions`, every row (6 today) | `id, user_id, status, cancelled_at, completed_at, next_charge_at, last_failure_at` | 2b |
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
- [ ] **AC-74** *(2b)* With the process time zone set to `America/New_York` and to `Pacific/Auckland`, a due date of 2026-09-30 renders as `2026-09-30` (never `2026-09-29` or `2026-10-01`), the layout standard's date format (§5.11) and its overdue state follows AC-57 unchanged (unit and render test). The due date is compared as a `YYYY-MM-DD` value and never passed through `new Date` (S2-F5).

---

## 11B. Slice 1c (fix): test-mode platform money and paying Founding Partners

Specified 2026-10-13 from the user's owner-account test and decisions **BD-14** and **BD-15** (§0.2). About **1 day**, **no migration**, no new table, no new read, no new tile. It changes slice 1a's reads R-c, R-c′ and R-d, the Section 1 classifier and the revenue panel copy. Where this section and an earlier slice 1a rule disagree (BD-10, §6.4 layer A, §8.1 "Paying", S1-FR-25 to S1-FR-27, AC-23), **this section governs**.

### 11B.1 Scope

| In 1c | Not in 1c |
|---|---|
| R-d counts test-mode and live-mode paid plan invoices and paid boosts (BD-14) | Any amount, sum or chart of our revenue (slices 4 and 5) |
| R-c and R-c′ read test-mode and live-mode billing rows; "paying" counts both (BD-14) | A test-mode switch or label (none for now, BD-14) |
| A paying champion is grouped under its paid tier, with a Founding Partner note (BD-15) | Filtering test businesses or users (DF-3) |
| New revenue panel wording; the stale "webhook not in place" text is removed | Boost credits in the Credits section (still slice 4, unchanged) |
| SQL checks 1 and 6 updated (§13) | Slices 4 and 5 specs: their "live, test switch" wording is superseded by BD-14 and is re-specified when each starts |

### 11B.2 Functional rules

| # | Rule |
|---|---|
| S1C-FR-1 | **R-d (BD-14).** The revenue existence check drops `livemode = true` on both tables: any `business_os_billing_events` row with `kind = 'invoice_paid'`, or any `business_os_boost_purchases` row with `paid_at` set, in either mode, counts. Still two `{ count: 'exact', head: true }` reads, still platform-wide (no account argument, AC-42), still no amount read. Replaces S1-FR-27. |
| S1C-FR-2 | **R-c and R-c′ (BD-14, BD-16).** The paying reads drop `livemode = true`. One billing record per account is assumed (BD-16): R-c keeps its keyset on `user_id`, and R-c′ keeps its single-row read. If an account ever has two rows, the read reports an error, never a figure: R-c fails when a `user_id` appears twice among the rows it read, and R-c′'s single-row read fails. Section 1 then shows the 'Tier set' fallback (S1-FR-15). An account is paying when its row passes `isPayingBillingRow` (the single definition; no new constant). R-c and R-c′ add `bought_tier` to their columns (SA-Q20). |
| S1C-FR-3 | **Grouping (BD-15).** An account whose §8.1 mapping would place it in **Founding Partner** (`champion`, or `grace` on the champion cohort) and that is **paying** is placed in its **paid tier's group** instead. The paid tier source is SA-Q20. A non-paying champion stays in Founding Partner, unchanged. Accounts whose tier is in force already map through the `tier` basis rows of §8.1; under BD-14 a test-mode paying row now puts them in the tier group instead of Comped. Every account is still in exactly one group, and the groups still sum to Total (AC-12). |
| S1C-FR-4 | **Founding Partner note (BD-15).** A tier group that holds paying champions shows a note with their number, for example "including 1 Founding Partner". With a business picked, a paying champion shows a "Founding Partner" badge beside its tier group. Text, not colour alone. No `'champion'` cohort literal in finance code (SA-F6): the cohort is recognised through `stateForCohort`. |
| S1C-FR-5 | **Founding Partner counts.** "Founding Partners with no end date" (K-3 and Section 1) counts only accounts **in the Founding Partner group**, so a paying champion is no longer counted (it already follows from the group rule, `planGroups.ts` counts by group key). Dormant Founding Partners and "ending in 30 days" follow SA-Q23. |
| S1C-FR-6 | **Unchanged:** the paying definition (`active` or `past_due`, `ended_at` NULL); BD-4 (an admin-assigned tier without a paying row is Comped); the "Tier set" fallback when R-c fails; the plan walk; Section 3; Section 4. **Boost credits stay excluded from the Credits section until slice 4**, as before. |
| S1C-FR-7 | **No test-mode wording** anywhere on layer A, matching BD-13 for layer B: no label, no note, no switch. |

### 11B.3 Impact on K-3, K-5 and the revenue panel

| Item | Before (1a) | After (1c) |
|---|---|---|
| **K-3** | "Accounts in the Founding Partner group whose cohort has no end date" | **Definition text unchanged**; its meaning narrows because a paying champion now leaves the group (S1C-FR-3). A note is added to §7.1: "Paying champions are grouped under their tier (BD-15) and are not counted." With a business picked: a paying champion answers "not an open-ended Founding Partner". |
| **K-5** | "Live-mode platform revenue this month"; grey with "None yet", "Revenue recorded, not yet shown" or "Could not check" | Definition becomes "Platform revenue (test and live mode together, BD-14)". Still grey in 1c, same three states, still no value (values are slices 4 and 5). |
| **Panel, none** | "None yet. Plan billing is not live (the payment webhook is not in place) and credit boosts are open to test accounts only." | **"None yet. No plan payment or credit boost has been recorded."** |
| **Panel, recorded** | "Live revenue has started to arrive; the revenue section is coming in a later update" | **"Revenue has been recorded. Amounts are shown in a later update."** |
| **Panel, failed** | "Could not check" | Unchanged. |
| **Panel subtitle** | "Live-mode plan invoices and paid boosts, all businesses" | **"Paid plan invoices and paid boosts, all businesses"** |

The panel still shows **no amount, no $0 figure and no chart**. Final wording may be polished by Dev within these meanings; it must not mention the webhook, test accounts, live mode or test mode.

### 11B.4 Acceptance criteria (1c)

- [ ] **AC-75** *(1c)* With only a **test-mode** `invoice_paid` billing event (and no other paid row), the panel says "Revenue has been recorded" and K-5 says "Revenue recorded, not yet shown"; the R-d queries name no `livemode` (mocked repository test). Replaces AC-23's "test-mode rows alone do not change it".
- [ ] **AC-76** *(1c)* With only a **test-mode paid boost** (`paid_at` set), the same as AC-75.
- [ ] **AC-77** *(1c)* With no paid row in either mode, the panel says "None yet" with the new wording, and shows no amount, no $0 figure and no chart; K-5 is grey (re-run of AC-22).

**Slice 4a note (SA-W50):** AC-75 to AC-77's K-5 headlines and panel sentences are superseded by S4-FR-4 (plans line) and S4-FR-7 (K-5 shows the boost net). Their R-d rule (no mode filter; any paid plan invoice or paid boost counts) stays pinned by the repository test.
- [ ] **AC-78** *(1c)* (a) A champion-cohort account whose plan row tier is **in force** and that has a paying **test-mode** billing row (`active` or `past_due`, `ended_at` NULL) is counted in that tier's group, not Comped, and the group shows the Founding Partner note; this is the owner test account. (b) A champion account with **no tier in force** and a paying row is counted in its paid tier's group (SA-Q20) with the note, and Founding Partner does not count it. In both, the six groups still sum to Total (unit test on the classifier; render test for the note).
- [ ] **AC-79** *(1c)* A champion account that is not paying (no billing row; or `canceled`, `incomplete`, `unpaid`; or `active` with `ended_at` set) stays in Founding Partner, with no note.
- [ ] **AC-80** *(1c)* K-3 counts only open-ended champions that are **not paying**, and matches updated SQL check 1: the sum of `no_cohort_end_date` over the champion rows where `paying` is false and `tier` is `(none)`.
- [ ] **AC-81** *(1c)* The words "webhook", "not in place" and "test accounts only" appear nowhere in the finance page copy or the rendered revenue panel; the panel and the layer-A copy name no live mode or test mode (source and render test).
- [ ] **AC-82** *(1c)* With a business picked whose only billing row is a paying test-mode row: Section 1 shows it in its tier group with the "Founding Partner" badge, K-3 says it is not an open-ended Founding Partner, R-c′ receives exactly that id, R-d is still called with no account argument, and a business with **two** billing rows makes the paying read fail, so Section 1 shows the 'Tier set' fallback and never a wrong group (BD-16; re-run of AC-42).
- [ ] **AC-83** *(1c)* Auth failure is unchanged: 401 unauthenticated, 403 non-admin (including a `profiles.role`-only admin), the page refused by `requireAdminPage`, with no figures and no finance read made (re-run of AC-1 to AC-3).
- [ ] **AC-84** *(1c)* Re-run over the 1c diff: AC-12 (sum to Total, now with a paying champion case), AC-28 (read-only, no migration), AC-30 (logs), AC-31 (the §11B.5 guard rows), AC-44 (scoped `tsc` with canary). QA records a manual check: admin opens Finance, sees "Revenue has been recorded" and the owner test account in its paid tier group with the Founding Partner note, and cross-checks against SQL checks 1 and 6.
- [ ] **AC-85** *(1c)* **One billing row per account (BD-16).** R-c and R-c′ read without a mode filter and assume one row per account. If an account ever has two rows, the read returns an error: R-c when a `user_id` appears twice among the rows read, R-c′ when its single-row read fails. Section 1 then shows the 'Tier set' fallback with no Founding Partner note: never a wrong group or count (repository test and builder test).
- [ ] **AC-86** *(1c)* **Paid tier source (SA-Q20).** A paying champion with no tier in force is grouped by the plan row `tier` when it is in `config.tierOrder`; otherwise by `bought_tier` when that is in `config.tierOrder`; otherwise in Unknown/held. When both are valid and differ, the plan row wins. No tier literal in finance code.

### 11B.5 Guards and tests likely affected (§12.2)

| Guard or test | Why it trips | What Dev must do |
|---|---|---|
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` (`:133`, `:198`, `:242-248`) | Pins `['livemode', true]` on R-c, R-c′ and R-d; the `:242` comment cites AC-23 | Invert to "no `livemode` filter" on R-c, R-c′ and R-d; add the two-rows-per-account case; keep the no-write and one-caller pins unchanged |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts:334-335` | "The layer-A reads still filter livemode" is the non-vacuity control for the layer-B no-`livemode` rule | Replace with: the repository's code, comments removed, names no `livemode` at all (planted control); keep the `:321` body-slicer control (SA-Q22). |
| `finance.source.guard.test.ts` `:361`, `:507`, `:519` (no `livemode` / test-mode wording in listed files) | Not tripped if the new copy follows S1C-FR-7 | Run unchanged |
| The 1a revenue-panel tests (S1-FR-26, S1-FR-27, AC-22, AC-23) in the builder tests and `app/admin/finance/__tests__/financePage.render.test.tsx` | Pin the old copy and the live-only behaviour | Update to AC-75 to AC-77 and AC-81 |
| Section 1 classifier tests (`planGroups`, AC-12, AC-9) | New paying-champion mapping | Add AC-78 to AC-80 cases |
| `planGroups.test.ts` parity with `buildShadowReport` (noEndDate / dormant, slice 1a) | Diverges when a fixture holds a paying champion (SA-Q23) | Keep the parity fixture free of paying champions; add a separate test that a paying dormant champion is not counted (S1C-F3) |
| `enforcementPoints.test.ts` (`KNOWN_NON_GATE_IMPORTERS`) | Only if `planGroups.ts` imports a new entitlements symbol | Update the exact symbol list if so (the `business-os-entitlements` skill) |
| `tierLiteral.forbidden.test.ts` | If the paid tier is read from `bought_tier`, it must flow as data | No tier literal; validate against `config.tierOrder` |
| Stripe webhook placement guards (three files, §12.2) | Not expected (the read repository was verified not scanned, SA-Q16) | Run unchanged and paste the result |
| `payingSubscriptionStatuses.test.ts` | Not tripped: the definition is unchanged | Run unchanged |

The repository header comment (`BusinessOsFinanceReadRepository.ts:69`, "filters `livemode = true`") and the method names that say "Live" become wrong (SA-Q22).

### 11B.6 Open questions for SA (1c)

| # | Question | BA suggestion |
|---|---|---|
| **SA-Q20** | Where does a paying champion's **paid tier** come from? `deriveLifecycle` already lets a tier in force on the plan row win; the owner test account showed as Comped (its tier was in force and the live-only paying read was false; S1C-F1), not Founding Partner. The other source is `business_os_billing_accounts.bought_tier`. What if they disagree, or `bought_tier` is NULL or not in `config.tierOrder`? | Plan row tier in force wins (existing path); otherwise `bought_tier` when it is in `config.tierOrder`; otherwise Unknown/held (never dropped). Verify live with the `business-os-schema-check` skill whether the subscription webhook writes the plan row tier |
| **SA-Q21** | Two billing rows per account under BD-14: R-c keysets on `user_id` with `gt`, so a page boundary between an account's two rows skips one; R-c′ uses `.maybeSingle()`. | Keyset on `id` (or `user_id`, `livemode`); R-c′ returns a list of at most two; the caller ORs `isPayingBillingRow` over the rows **Withdrawn 2026-10-13 by BD-16** (one billing record per account; see §0.3 SA-Q21). |
| **SA-Q22** | Rename `listLiveBillingStatusesAllAccounts`, `findLiveBillingStatusForAccount` and `countLiveRevenueRows` (the word "Live" becomes false), and replace the source guard's non-vacuity control? | Rename in 1c (one caller, `financeHealthDeps.ts`); planted negative control |
| **SA-Q23** | Do "dormant Founding Partners" (`isDormantChampion`, counted by row, not by group) and "ending in 30 days" still count a paying champion? | Dormant: count only accounts in the Founding Partner group, like K-3. Ending in 30 days: unchanged (it is any end date, not a group figure) |
| **SA-Q24** | Is a group-row note ("including N Founding Partners") plus a badge in the picked-business view acceptable under the layout standard (§4), or should it be a column? | Note on the row plus the badge; no new column |

---

## 11C. Slice 4 (4a and 4b): Boost revenue

Specified 2026-10-13 from a read-only live check (§11C.1), BD-1, BD-9, BD-11, BD-12, BD-14 and BD-16. **No migration, no new SQL function, no new table, no write, no new query parameter.** Where this section and an earlier slice 4 description disagree (§8.2 block A boost text, §8.6 block A boosts, §9 row 4 "live, test switch" and "a new `…ForAdmin` read on `BusinessOsBoostPurchaseRepository`"), **this section governs**: BD-14 removes the switch, and SA-F2 keeps every admin read in `BusinessOsFinanceReadRepository`. Plan revenue, MRR and plan problems stay in slices 5 and 7.

### 11C.1 Live facts (read-only check, 2026-10-13)

Measured on the live database with a SELECT-only script run from the main checkout (no rows written, no DDL); code read at `15300d29` (branch `feature/bos-finance-health-4`). The SQL checks in §13 (14 to 16) were written against these facts but not executed by BA (no SQL connection was available); SA or QA runs them.

| Fact | Live value |
|---|---|
| Rows in `business_os_boost_purchases` | **1** |
| Columns (30, match migration `20261030` exactly) | `id, user_id, livemode, status, package_id, package_version, retail_version, credit_value_version, price_minor, currency, tax_exclusive, credits_base, credits_bonus, credits_total, checkout_expires_at, stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id, receipt_url, amount_subtotal_minor, amount_tax_minor, amount_total_minor, amount_refunded_minor, stripe_dispute_id, flag_reason, lot_id, paid_at, status_changed_at, created_at, updated_at` |
| Statuses | `paid` 1. The CHECK allows `pending, abandoned, awaiting_payment, paid, failed, expired, flagged_mismatch, partially_refunded, refunded, disputed, dispute_lost`. A won dispute is not a status: the transition function moves the row back to `paid`, `partially_refunded` or `refunded` |
| `livemode` | `false` 1 (the owner test purchase of 2026-10-12; counted as real, BD-14) |
| Currency | `USD` 1; a CHECK pins `currency = 'USD'` |
| Package | `starter` version 1 (1 row); price 1000, subtotal 1000, tax 0, total 1000, refunded 0, credits 5,000 |
| Amount columns | **Integers in minor units** (cents): `price_minor`, `amount_subtotal_minor`, `amount_tax_minor`, `amount_total_minor` (NULL until paid), `amount_refunded_minor` (NOT NULL, default 0, cumulative, CHECK `<= amount_total_minor`). JSON numbers |
| `paid_at` | Set on 1 row. Written **only** by the credit function, together with status `paid`, the lot, and the three amounts (CHECK `paid_family_complete`: every row in `paid, partially_refunded, refunded, disputed, dispute_lost` has `paid_at`, `lot_id` and all three amounts). Never cleared by a refund or dispute |
| Refund and dispute records | **None live** (refunded > 0: 0 rows; `stripe_dispute_id` set: 0 rows). There is **no refund table and no refund date** for boosts: a refund only raises `amount_refunded_minor` on the purchase row. `status_changed_at` moves on every transition, so it is not a refund date |
| `flagged_mismatch` | 0 rows. A flagged purchase has the Stripe amounts but **no `paid_at` and no lot**: Stripe may have taken the money, and no credits were given |
| `user_id` | Nullable, `ON DELETE SET NULL` (a financial record, minimised on account deletion, NFR-12). 0 NULL today |
| Credit lots | `admin_grant` 1, `boost_purchase` 1 (5,000 credits, no expiry, created at the purchase `paid_at`); lot draws: 1 `reversal` (on the admin grant) |
| Billing events | `invoice_paid` 1 and `mismatch_refused` 8 (all test mode): plan rows, not boosts |
| Indexes | Only `(user_id, livemode, created_at)`; no index on `paid_at` (a sequential read of a 1-row table today) |
| Who reads the table now | `BusinessOsBoostPurchaseRepository` (the writer, RPC-only writes; scoped reads plus three unscoped `…ForWebhook` finders) and `BusinessOsFinanceReadRepository.countRevenueRows` (R-d: a head count of `paid_at` not null, no amount) |

### 11C.2 Scope and split

About 4 days in total, above the 3-day limit, so it is split. **4b starts after 4a merges.** Each part is demoable alone and gets its own workplan, SA workplan review, SA code review, QA and PR, recorded in §0.1.

| Part | In scope | Not in scope | Estimate |
|---|---|---|---|
| **4a: Boost revenue** | Reads R-k, R-k′ (§11C.6); "Our revenue" shows **boost amounts** per currency for the window: purchases, gross charged, of which tax, refunded, held in open disputes, lost in disputes, **net**, credits sold; a by-package table; a deleted-accounts line; **K-5 shows a value** (S4-FR-1 to S4-FR-14) | Plan revenue amounts and MRR (slice 5: the plan line keeps saying amounts come later); boost problems; any tile colour; Section 4 | About 2.5 days |
| **4b: Boost problems and bought credits** | Reads R-l, R-l′ (§11C.6); boost problems in Section 6 block A (open disputes, purchases flagged as not credited); the BD-11 dispute rule on K-5; **bought credits** beside gifted credits in Section 4 (S4-FR-15 to S4-FR-22) | Stuck checkouts (owned by the boost reconcile pass, FR-43); plan payment problems (slice 7); a sixth tile | About 1.5 days |

### 11C.3 Window, status and money rules

| # | Rule |
|---|---|
| S4-W-1 | **A purchase is dated by `paid_at`** (BD-9): it counts when `paid_at` is in the filter window, half-open whole UTC days `[start, end)` with the microsecond rule (TZ-1). `created_at` (when the checkout was reserved) is never used for revenue. Default **This month**. |
| S4-W-2 | **Counted purchases** are rows whose `paid_at` is in the window and whose status is in the **paid family**: `paid`, `partially_refunded`, `refunded`, `disputed`, `dispute_lost`. Defined once as a literal `as const` in finance code, checked by a test against the migration CHECKs `status_known` and `paid_family_complete` (the SA-W2 precedent: no import from the boost repository). A row read in the window with any other status (impossible today, by CHECK) is left out of every sum and counted ("N purchases with another status not counted"). |
| S4-W-3 | **Refunds and disputes are shown against the purchase's own month, as recorded now.** No boost refund or dispute date is stored (§11C.1), so a refund made in November on an October purchase lowers October's net when the page is opened after it. A note says: "Refunds and disputes are counted in the month of the purchase, as recorded today, so a past month can still change." |
| S4-W-4 | **Minor units, exact.** `amount_*_minor` are integers in the currency's smallest unit. For a currency with two decimals (USD, the only one allowed by CHECK), one minor unit **is** one hundredth, so the value is used **as is** as the integer number of hundredths of the CUR-1 helper; it is **never** passed through `toHundredths`, `toUnits` or `× 100` (that would multiply cents by 100). An amount is **unreadable** when it is missing on a counted purchase, not a safe integer, or negative, or when `minorUnitsPerMajor(currency)` (`lib/payments/refundMath.ts`, the one definition) is not 100 for the row's currency (any other currency would need its own scale; none exists, the CHECK pins USD; SA-Q26). Unreadable amounts are excluded from sums and counted, never 0, and make net 'Unknown' on that line and the block `partial` (the S2-CUR-3 rule). |
| S4-W-5 | **Per currency only** (CUR-1, CUR-2, BD-12). Lines come from `groupByCurrency`, one per normalised code, sorted, "Unknown currency" last. No figure, tile, payload field or exported function adds two currencies. |
| S4-W-6 | **Figures per currency line**, over counted purchases: **purchases** (count); **gross charged** = sum of `amount_total_minor`; **of which tax** = sum of `amount_tax_minor` (shown, not deducted; 0 on every row today, TX-3); **refunded** = sum of `amount_refunded_minor`; **held in open disputes** = sum of `amount_total_minor - amount_refunded_minor` over `disputed` rows; **lost in disputes** = the same over `dispute_lost` rows; **net** = gross charged - refunded - held in open disputes - lost in disputes; **credits sold** = sum of `credits_total` (6 dp, exact through `toUnits` at the credit scale; credits, not money). Net is labelled "Net of refunds and disputes (Stripe fees not deducted; includes any tax)". A won dispute is already back in its paid status and counts in full. |
| S4-W-7 | **Deleted accounts.** A purchase whose `user_id` is NULL (account deleted, NFR-12) is still our revenue: it counts in the all-businesses totals and is shown as its own "Deleted accounts" line under the by-package table (purchases and net per currency), never dropped. |
| S4-W-8 | **Ceiling (AGG-3).** At the read's ceiling, purchases, gross, tax, refunded and credits sold show "At least", **net and the dispute amounts show 'Unknown (a read was cut off)'**, and the block is `partial` with a notice (a lower bound minus a figure is not a bound, S2-FR-8). |

### 11C.4 Section 2 block A: Our revenue, boosts (4a)

| # | Requirement | Part |
|---|---|---|
| S4-FR-1 | The "Our revenue" panel becomes a section with its own status (`ok` / `partial` / `unknown`, L-5), titled "Our revenue", with a subtitle naming the window (UTC) and the source ("Credit boosts paid, all businesses" or the picked business). It stays visibly separate from "Takings through the platform" (§6.1). | 4a |
| S4-FR-2 | **Boosts, per currency** (S4-W-5, S4-W-6): one line per currency with purchases, gross charged, of which tax, refunded, held in open disputes, lost in disputes, net and credits sold. Money through the shared `formatMoney` (currency named in every cell). | 4a |
| S4-FR-3 | **By package**: one row per currency and package (`package_id` and `package_version` as stored on the purchase, the snapshot of what was sold), with purchases, gross charged, refunded and net; sorted by currency, then package id, then version. No catalogue lookup (SA-Q30). The deleted-accounts line follows (S4-W-7). | 4a |
| S4-FR-4 | **Plans line:** "Plan payments: amounts are shown in a later update" while R-d reports a paid plan invoice, otherwise "No plan payment recorded". No plan amount is read or shown (slice 5). With a business picked, the line says it covers all businesses ("Plan payments, all businesses: …"), because R-d reads no account (AC-42). | 4a |
| S4-FR-5 | **Honest indicators.** No counted purchase in the window → "No credit boosts paid in this window" with no currency line and no "0.00" (boost purchases are recorded today, so this is a real empty, §6.6). The read failed → the boost part says "Could not load" and the section is `unknown` when R-d failed too, `partial` otherwise. Unreadable amounts and other-status rows are counted on the page (S4-W-2, S4-W-4). The S4-W-3 note is always shown when any refund or dispute amount is non-zero. | 4a |
| S4-FR-6 | **BD-14:** test-mode and live-mode purchases count together, with no test-mode label, note or switch, and no read filters on the mode (§6.4, S1C-FR-7). | 4a |
| S4-FR-7 | **K-5 "Our revenue" shows a value**: the boost **net** for the filter window (SA-Q25), with one currency as "USD 10.00", several as "N currencies, see Our revenue" (never a sum), "At least" never used for net (S4-W-8: Unknown instead). Its caption says "Credit boosts; plans in a later update". It stays **grey (informational)** in 4a with no rule; text state "No data yet" when there is no counted purchase, "Unknown" when the read failed. Not green-eligible. | 4a |
| S4-FR-8 | **Picked business:** R-k′ receives exactly the picked id (SEC-3); R-k is not called; the deleted-accounts line is not shown; K-5 shows that business's boost net. R-d keeps its platform-wide exception for the plans line (AC-42). | 4a |
| S4-FR-9 | **No Stripe or customer data.** R-k selects no Stripe id, receipt URL, flag reason or lot id; the payload carries none (S2-FR-26 spirit). | 4a |
| S4-FR-10 | **Route and payload:** the `revenue` section gains `boosts { status, scope, lines, packages, deletedAccounts, notes }`; figures null only when `unknown`. The route's one `info` line adds the boost read's status and counts only (rows read, ceiling reached, unreadable amounts, other-status rows): never an amount or a name (SEC-8). | 4a |
| S4-FR-11 | **Where the code lives:** a pure builder under `lib/business-os/finance/` (for example `boostRevenue.ts`), **never under `lib/business-os/billing/`** (that folder is scanned by the webhook `routerPlacement` M-1 guard). It names no repository; the route wiring injects the reads (the `financeHealthDeps.ts` `Pick<…>` precedent). | 4a |
| S4-FR-12 | **Layout standard:** as S2-FR-13 (shared table constants, `StatusChip`, `AdminNotice`, `AdminEmpty`, `formatCount`, header cells and `aria-label`). The page shell is not migrated (DF-4). All new copy in `financeCopy.ts`; the 1c "Amounts are shown in a later update" sentence is replaced for boosts. | 4a |
| S4-FR-13 | **Cannot produce, said on the section:** real Stripe fees (none recorded for platform payments, BD-7; the estimate is slice 6); the date of a refund or dispute (S4-W-3); plan revenue (slice 5); one total across currencies (BD-12). | 4a |
| S4-FR-14 | **Performance:** one more concurrent read, settled on its own (S1-FR-8); route p95 still under 2 s. | 4a |

### 11C.5 Boost problems and bought credits (4b)

| # | Requirement | Part |
|---|---|---|
| S4-FR-15 | **Section 6 block A, "Our payment problems (boosts)"**, placed before block B, **as of now** (the window does not apply; the subtitle says "As of now, UTC"). Per currency: **open disputes** (status `disputed`: count and the amount held, S4-W-6) and **purchases not credited** (status `flagged_mismatch`: count and `amount_total_minor` where recorded, labelled "Payment received by Stripe, credits not given; check the purchase"). Each with the oldest `status_changed_at`. Read through R-l / R-l′. | 4b |
| S4-FR-16 | **Lost disputes** are not repeated here: they are in the revenue figures of their purchase month (S4-W-6). Plan payment problems keep the slice 7 note. Stuck checkouts are not shown (the boost reconcile pass owns them, FR-43); a link "Boost purchases of one business" points to the per-account credit view under `/admin/users` (FR-38) when a business is picked. | 4b |
| S4-FR-17 | **K-5 dispute rule (BD-11, SA-Q29):** K-5 turns **red** with the reason "N boost payments in dispute" when open disputes >= 1, as **rule data** in `FINANCE_RULES` (`atLeast`, threshold 1, adjustable without code). Otherwise K-5 stays grey with its value (S4-FR-7). The strip keeps five tiles: K-6 is not added. A failed R-l makes K-5's colour grey with "Dispute check failed", its value unchanged. The red reason names the dispute ("N boost payments in dispute"), never the revenue; with a business picked the rule uses R-l′, so it counts that business's disputes only. | 4b |
| S4-FR-18 | **Bought credits in Section 4.** The lots read R-b / `listLotsWithDraws` already returns every source. Section 4 adds, **beside** the gifted figures and never combined with them: **bought outstanding** = `extraCreditsAt` over unexpired `boost_purchase` lots (the one definition, applied after the caller filters the source, exactly as for `admin_grant`), and **bought in the window** = credits on `boost_purchase` lots created in the window and the number of such lots. Deleted accounts' bought lots are their own figure (the SA-W9 rule). | 4b |
| S4-FR-19 | **Gifted and K-4 are unchanged:** they still count `admin_grant` lots only (K-4 "Gifted credits outstanding"). Bought credits are paid for, gifts are a cost to us, so the two are never one figure on this page (the owner card's combined "Extra credits", FR-24, is the owner's view and is not changed). | 4b |
| S4-FR-20 | **Per-account table:** a "Bought outstanding" column beside "Gifted outstanding", 0 when the account has no boost lot, "Unknown" under the same failure rules as gifted (§8.4: the lots read errors at its ceiling, never a partial list). The note "credits are not consumed from lots yet" covers both columns while it remains true (`creditLots.ts:18-20`). | 4b |
| S4-FR-21 | **Picked business:** R-l′ and `listLotsWithDraws(accountId)` with exactly that id; R-l is not called. | 4b |
| S4-FR-22 | **Route and payload:** `paymentProblems` gains `boosts { status, figures }`; `credits` gains the bought figures. Logs: statuses and counts only. | 4b |

**Rule proposed for bought credits (S4-FR-18 to S4-FR-20).** This is a display rule, not a business question: the page already separates money we receive from money we give away (BD-1 separates our revenue from takings; K-4 is defined as gifts). Showing bought credits as their own column keeps K-4's meaning and adds the missing half of "extra credits". The user may still ask for one combined column; nothing in the data forces either choice.

### 11C.6 New reads (no migration)

All in **`BusinessOsFinanceReadRepository`**, never in `BusinessOsBoostPurchaseRepository` (the writer; SA-F2). The finance repository keeps its rules: service role documented in its header, explicit exported column lists, **no write method** (no-write pin), one caller (`financeHealthDeps.ts`), methods that never throw, no `livemode` anywhere in its code (BD-14; the 1c source-guard control), and the boost repository named in words only, never by class name.

| # | Method (example name) | Scope | Table and filter | Columns | Part |
|---|---|---|---|---|---|
| **R-k** | `listBoostPurchasesAllAccountsPaidInRange(range)` | Named all-accounts | `business_os_boost_purchases`, `paid_at >= start` and `< end` (every status; the caller applies S4-W-2) | `id, user_id, status, package_id, package_version, currency, amount_total_minor, amount_tax_minor, amount_refunded_minor, credits_total, paid_at` | 4a |
| **R-k′** | `listBoostPurchasesForAccountPaidInRange(accountId, range)` | Account-scoped | Same, plus `.eq('user_id', accountId)`; refuses a malformed UUID before querying | Same | 4a |
| **R-l** | `listBoostPurchasesNeedingAttentionAllAccounts()` | Named all-accounts | Same table, status `disputed` or `flagged_mismatch` (an `.in()` on literal statuses) | `id, user_id, status, currency, amount_total_minor, amount_refunded_minor, status_changed_at` | 4b |
| **R-l′** | `listBoostPurchasesNeedingAttentionForAccount(accountId)` | Account-scoped | Same, plus `user_id` | Same | 4b |

**Paging (SA-Q27):** the layer-B pager (`pageClientRows`): keyset on `id`, page 1,000, **ceiling 5,000** (`FINANCE_READ_LIMITS`), returning rows plus `reachedCeiling` ("At least", S4-W-8). All-accounts methods log at `info` with counts and timing only. **R-d is unchanged** and still drives the plans line and the existence check.

**Wiring:** `financeHealthDeps.ts` adds the four methods to its `finance: Pick<BusinessOsFinanceReadRepository, …>`; no new repository is named.

### 11C.7 Guards and tests affected

| Guard or test | Effect | What Dev must do | Part |
|---|---|---|---|
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` table pin (`REPOSITORY_TABLES`, `:271-291`) | **The table set does not grow:** `business_os_boost_purchases` is already one of the eight (R-d). The `.from(` count grows, and `fromCallsOf(code) === tables.length` and `>= 8` still hold if every new `.from` names its table as a literal | Run unchanged; extend the comment above `REPOSITORY_TABLES` to name R-k and R-l. The "no `livemode` in the repository code" control and the `MODE_WORDING` rules must stay green | 4a, 4b |
| Same guard, payment-table rule (narrowed in 2a) | The new builder must name no `payment_*` table and no boost table | Keep the builder table-free (S4-FR-11) | 4a |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | New methods | One test per method: column list (no Stripe id, receipt URL, flag reason, lot id), `paid_at` range or status filter, `user_id` and malformed-id refusal on the account-scoped ones, keyset paging, ceiling to `reachedCeiling`, never throws, no `livemode`. No-write and one-caller pins unchanged; header method list extended | 4a, 4b |
| `lib/repositories/__tests__/BusinessOsBoostPurchaseRepository.test.ts` (SA Q-1: only listed files name `findByIdForWebhook`) | **Not tripped:** finance code never names a `…ForWebhook` finder or the boost repository | Run unchanged | 4a |
| Boost repository caller lists | **None exists** beyond the SA Q-1 identifier pin (searched `lib/`, `app/` and their tests, 2026-10-13); finance never imports the boost repository, its types or `BOOST_PURCHASE_STATUSES` (S4-W-2 keeps its own literal) | Nothing | 4a, 4b |
| Stripe webhook placement guards (`routerPlacement.guard`, `invoiceIntentsStayUnowned.guard`, `planSurfaces.guard`) | **Not tripped:** `routerPlacement` reads the webhook route and `lib/business-os/billing/*.ts` only, and the boost reads stay out of that folder (S4-FR-11); the other two pin plan and Connect files | Run all three unchanged and paste the result; any trip goes to SA | 4a |
| G3 in `creditLots.test.ts` (who names `extraCreditsAt`) | Not tripped if bought credits are computed in the existing `creditsSection.ts` (already listed in 1b) | Keep `extraCreditsAt` in that file only; a new file naming it must be added to `ALLOWED_LIST` | 4b |
| `BusinessOsCreditLotRepository.test.ts`, the lot repository caller list | Not tripped: R-b and `listLotsWithDraws` are reused unchanged | Run unchanged | 4b |
| `enforcementPoints.test.ts`, `tierLiteral.forbidden`, RC-15, ledger caller list, `businessOwnedTables` and purge descriptors | Not tripped: no entitlements import (package ids as stored, SA-Q30), no new table, no ledger change | Run unchanged | 4a, 4b |
| Revenue panel and K-5 tests (1c: AC-75 to AC-77, AC-81) in the builder tests and `financePage.render.test.tsx` | The panel now shows amounts; the "Amounts are shown in a later update" copy changes for boosts | Update to AC-87 onward; AC-81 (no webhook, test-account or mode wording) stays green | 4a |
| Finance rule data tests (`financeRules`) | K-5 gains its first rule in 4b | Add the rule-in-data test (threshold change flips the colour with no code change) | 4b |

### 11C.8 Acceptance criteria

All testable by Jest or by QA's recorded manual check. Figures are compared with the §13 check run at test time, not with today's numbers.

**AC to part mapping:** 4a: AC-87 to AC-101. 4b: AC-102 to AC-107, plus a re-run of AC-98 to AC-100 over the 4b diff.

**Boost revenue (4a)**
- [ ] **AC-87** *(4a)* For "This month", per currency: purchases, gross charged, of which tax, refunded, held in open disputes, lost in disputes, net and credits sold match check 14 (its `ALL` package row), and each by-package row matches its check 14 row; net equals gross charged minus refunded minus held minus lost.
- [ ] **AC-88** *(4a)* **Window by `paid_at`:** a purchase reserved on the last day of the previous month and paid on the first day of this month counts this month; with injected purchases at `23:59:59.999999` and `00:00:00.000000` UTC on a month boundary, each falls in exactly one month (half-open, microsecond rule). `created_at` never decides. The half-open bounds are asserted on the read's query (`gte` start, `lt` end, ISO strings), since the database applies them; the builder counts each row it is given once.
- [ ] **AC-89** *(4a)* **Statuses:** each paid-family status counts; a planted row in the window with another status is left out of every sum and counted on the page; a `flagged_mismatch` row (no `paid_at`) is never in revenue. The paid-family literal matches the migration CHECKs (test).
- [ ] **AC-90** *(4a)* **Minor units exact:** `amount_total_minor` 1000 shows "USD 10.00"; 1999 shows "USD 19.99"; no boost amount passes through `toHundredths`, `toUnits` or a multiplication by 100 (unit test plus source test). A non-integer, negative or unsafe amount, or a currency with other than two decimals (mocked), is unreadable: counted, excluded, net "Unknown", block `partial`.
- [ ] **AC-91** *(4a)* **Refunds and disputes:** a partial refund, a full refund, a `disputed` row with an earlier partial refund (held = total minus refunded) and a `dispute_lost` row each give the S4-W-6 figures; the S4-W-3 note shows whenever a refund or dispute amount is non-zero.
- [ ] **AC-92** *(4a)* **Multi-currency (mocked):** USD and a planted second currency give two lines and two K-5 entries ("2 currencies, see Our revenue"); no element, payload field or exported function holds a total across currencies (render and source test).
- [ ] **AC-93** *(4a)* **Ceiling** (injected small ceiling): purchases, gross, tax, refunded and credits sold show "At least"; net, held and lost show "Unknown (a read was cut off)"; the section is `partial` with a notice; K-5 shows "Unknown".
- [ ] **AC-94** *(4a)* **Empty:** with no counted purchase in the window the section says "No credit boosts paid in this window", shows no currency line and no "0.00", and its status is `ok`; K-5 is grey "No data yet".
- [ ] **AC-95** *(4a)* **K-5 value:** with the owner test purchase in the window, K-5 shows "USD 10.00" with the caption "Credit boosts; plans in a later update", grey, no rule, not green; the R-k read failing makes K-5 "Unknown" and the boost part "Could not load", and every other section still renders.
- [ ] **AC-96** *(4a)* **Picked business:** with `accountId` set, R-k′ receives exactly that id, R-k has zero calls, the deleted-accounts line is absent, and K-5 shows that business's net; R-d is still called with no account argument (extends AC-42 and AC-65).
- [ ] **AC-97** *(4a)* **Deleted accounts:** a purchase with `user_id` NULL counts in the all-businesses totals and appears on the "Deleted accounts" line, never dropped and never named. Its net matches check 14's `deleted_account_net_minor`.
- [ ] **AC-98** *(4a; re-run 4b)* **No Stripe or customer data and logs:** the R-k and R-l column lists hold no Stripe id, receipt URL, flag reason or lot id; the payload carries none; the route's log line carries counts, statuses and timing only (re-run of AC-30).
- [ ] **AC-99** *(4a; re-run 4b)* **Auth and input:** 401 unauthenticated, 403 non-admin (including a `profiles.role`-only admin), 400 for each AC-4, AC-33 and AC-34 case and for an unknown key, all with **zero** boost reads.
- [ ] **AC-100** *(4a; re-run 4b)* **Read-only and guards:** the route, builders and finance repository name no insert, update, upsert, delete or writing RPC; no migration or SQL function in the diff; no `livemode` in the repository code; every §11C.7 row passes, including the three webhook placement guards run unchanged; scoped `tsc` with a planted canary (re-runs of AC-28, AC-31, AC-44).
- [ ] **AC-101** *(4a)* **Manual QA:** admin opens Finance, sees the owner test purchase (Starter, USD 10.00, 5,000 credits sold) under "Our revenue" and on K-5, cross-checks against check 14, switches to 30d and to the owner business and back, and reloads the URL.

**Boost problems and bought credits (4b)**
- [ ] **AC-102** *(4b)* Open disputes and purchases not credited, per currency, match check 15 and do not change with the window (as of now).
- [ ] **AC-103** *(4b)* **K-5 dispute rule:** one open dispute (mocked) turns K-5 red with "1 boost payment in dispute" and its value unchanged; changing the threshold in `FINANCE_RULES` changes the colour with no code change; R-l failing makes K-5 grey with "Dispute check failed"; the strip still holds exactly five tiles.
- [ ] **AC-104** *(4b)* **Bought credits:** bought outstanding and bought in the window match check 16; K-4 and the gifted figures are unchanged from 1b (still `admin_grant` only, check 5); no figure on the page adds bought and gifted credits together.
- [ ] **AC-105** *(4b)* Deleted accounts' bought lots are their own figure; the per-account "Bought outstanding" column is 0 for an account without a boost lot and "Unknown" under the §8.4 lots failure rules.
- [ ] **AC-106** *(4b)* **Picked business:** R-l′ and `listLotsWithDraws` receive exactly that id; R-l has zero calls.
- [ ] **AC-107** *(4b)* **Manual QA:** admin sees no open dispute and no purchase not credited today, the owner account's 5,000 bought credits beside its gifted credits, and cross-checks against checks 15 and 16.

### 11C.9 Open questions for SA (slice 4)

Technical only; none needs the user. Each has a BA suggestion.

| # | Question | BA suggestion |
|---|---|---|
| **SA-Q25** | K-5's window: the filter window (one read, the same figure as the panel) or always the current UTC month like K-1 (a second read when the filter differs)? | The filter window, named in the tile caption; the default window is This month (BD-9) |
| **SA-Q26** | Minor units: a finance-local rule (a two-decimal currency's minor unit is used as hundredths; anything else unreadable), or reuse `minorUnitsPerMajor` from `lib/payments/refundMath.ts`? Does importing `lib/payments/` from finance trip any guard? | Finance-local rule with a test; the CHECK allows USD only, so a general converter has no caller yet |
| **SA-Q27** | Reuse the layer-B pager for R-k and R-l (rows plus `reachedCeiling`, "At least"), rather than R-c's error at the ceiling? | Reuse; revenue is a sum like takings, so a lower bound with Unknown net is the honest answer |
| **SA-Q28** | Refunds and disputes against the purchase month (S4-W-3): confirm, given no refund date is stored. Is a refund date worth a later migration (for example a `refunded_at`, or a boost refund events table), and whose slice would own it? | Confirm for slice 4; a refund date is a boost-module change, recorded as a deferral, not built here |
| **SA-Q29** | BD-11's "any boost dispute = red": a rule on K-5 (the strip is at its five-tile maximum) or a sixth tile K-6 with a tile removed? | A rule on K-5 (S4-FR-17); K-6 stays unbuilt |
| **SA-Q30** | Package label: the stored `package_id` and `package_version` as is, or the catalogue name (an import from `lib/business-os/entitlements/config/boostPackages.ts`, which needs registration)? | Stored values; no entitlements import |
| **SA-Q31** | Bought credits: reuse the existing lots read and `creditsSection.ts` with a second source filter, so G3 and the lot caller list are not tripped? | Yes; one file, two filters, two figures |

---

## 11D. Slice 5a, Money M-1 and M-2: one account, one screen; plan payments received

Specified 2026-10-14 from the consolidation review (**CR**, [ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md](/docs/requirements/ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md) §4, §5.2, §7 G-1, G-5, G-13, §8 M-1 and M-2), a read-only live check (§11D.1), BD-1, BD-9, BD-12, BD-14, BD-17 to BD-20. **No migration, no new SQL function, no new table, no write, no new query parameter on the finance route.** M-1 adds **no read at all**; M-2 adds two reads in `BusinessOsFinanceReadRepository`. Where this section and an earlier description disagree (§8.2 block A "Live only, test switch" and "plan revenue and MRR" in slice 5; S4-FR-4 and S4-FR-7 for the plans line and K-5), **this section governs**. MRR, paying vs comped exactness and trial-to-paid stay in **5b** (BD-19).

**Trigger.** The owner test account (the one that bought a Starter boost and a Basic plan on 2026-10-12, both Stripe test mode, counted as real under BD-14) shows only the USD 10.00 boost on Finance. After M-2 it shows **USD 79.00 plan + USD 10.00 boost received in October 2026**, and K-5 for that account shows **USD 89.00**.

### 11D.1 Live facts (read-only check, 2026-10-14)

Measured on the live database with a SELECT-only script run from the main checkout (`e49a4719`; no rows written, no DDL); code read on `feature/bos-money-m1-m2` at `392a9b53`. The SQL checks 17 and 18 (§13) were written against these facts and not executed by BA; SA or QA runs them.

| Fact | Live value |
|---|---|
| Rows in `business_os_billing_events` | **9**: `invoice_paid` 1, `mismatch_refused` 8. **All test mode** (`livemode` false). No `refunded`, `dispute_opened`, `dispute_closed`, `invoice_payment_failed`, `payment_action_required`, `subscription_updated` or `subscription_ended` row yet |
| Columns (migration `20261027`, 20 columns) | `id, user_id, livemode, kind, stripe_event_id, stripe_invoice_id, stripe_subscription_id, stripe_customer_id, tier, plan_written, refusal_reason, amount_minor, amount_tax_minor, currency, period_start, period_end, paid_at, created_at`; no `updated_at` (append-only: no UPDATE or DELETE grant). The 14 non-Stripe columns read back without error |
| Kinds (CHECK `kind_known`) | `invoice_paid, invoice_payment_failed, payment_action_required, subscription_updated, subscription_ended, refunded, dispute_opened, dispute_closed, mismatch_refused`. Plan refunds and disputes are **not written** until PAY P-6b (the webhook writes only `invoice_paid`, `invoice_payment_failed` and `mismatch_refused` today) |
| Amounts | **Integers in minor units** (`integer`, JSON numbers), CHECK `>= 0`. `amount_minor` = Stripe `amount_paid` for a paid invoice (**tax included**); `amount_tax_minor` = the invoice's tax (`planInvoiceFacts.ts:19-20`). Both are required by the apply function for an `invoice_paid` row |
| Currency | `usd`, **lower case** (CHECK `currency_usd` pins `usd`; the boost table stores `USD`). `normaliseCurrencyCode` (CUR-1) upper-cases both, and `minorUnitsPerMajor` lower-cases, so the two meet on one USD line |
| `paid_at` | Stripe's paid time of the invoice (the ordering key). Set on the `invoice_paid` row. No index on `paid_at` (only `(user_id, created_at desc)` and two partial indexes) |
| The test account's `invoice_paid` row | `user_id` = the test account (id starts `5f63adbd`), `tier` `basic`, `plan_written` true, `amount_minor` **7900**, `amount_tax_minor` 0, `currency` `usd`, `paid_at` **2026-10-12 18:21:50 UTC**, period 2026-10-12 to 2026-11-12. Its boost: `paid`, USD, total 1000, tax 0, paid 2026-10-12 18:03:56 UTC |
| `mismatch_refused` rows | 8, all `user_id` NULL, `refusal_reason` `unknown_customer`, **all carry amounts** (7900 three times, 3387 three times, 0, 12914) and five carry a `paid_at`, two of them in **November 2026** (Stripe test clocks run ahead). They are refused payments with no account: never revenue in M-2 (M2-W-2, DF-7) |
| `user_id` | Nullable, `ON DELETE SET NULL` (kept, detached, on account deletion). 1 non-NULL today |
| Who reads the table now | `BusinessOsBillingEventRepository` (the writer: apply RPC and `recordEvent`, plus the P-5b.2 paid-line read `findPaidInvoicesForAccounts` for Signup Invites); `BusinessOsFinanceReadRepository.countRevenueRows` (R-d: a head count of `invoice_paid`, no amount, no account); the test-account cleanup and purge descriptors (counts only). The writer's callers are pinned by an exact list (`BusinessOsBillingEventRepository.test.ts:464-502`), name-based, comments included |
| Finance code on `main` | 4a is merged (R-k, R-k′, `boostRevenue.ts`). Finance still imports the original `app/admin/audit-trail/BusinessAccountPicker.tsx` (`FinanceFilterBar.tsx:21`), and the chip shows an id fragment (`:128-131`). The shared `AdminBusinessPicker` never looks a name up for an inbound id (its header, RC-6), so after a reload or a deep link the name must come from the page |

### 11D.2 Scope and split

| Part | In scope | Not in scope | Estimate |
|---|---|---|---|
| **M-1: One account, one screen** | The shared business picker, and deletion of the original; an **account header** and an **account summary** block with a business picked, built only from figures already in the payload; links from the summary that carry the window and the account; "Open money view" in the Businesses drawer, and a way from Finance back into that drawer (M1-FR-1 to M1-FR-12) | Any new read or route change; plan amounts (M-2); margin (M-3); recorded-but-not-charged cost (M-4, BD-18); the page shell and URL names `range` / `account` (M-6, DF-4); the "since it started" window (DF-6); "paying since" (no read holds it today) | About 2 days |
| **M-2: Plan payments received** (FIN 5a) | Reads R-m, R-m′; "Our revenue" shows **plan payments received** per currency for the window beside boosts; a by-business table (all businesses) or the payment list (one business); a deleted-accounts line; K-5 adds plans to boosts **within each currency**; the plans line becomes per-account in the picked view (M2-W-1 to M2-W-8, M2-FR-1 to M2-FR-14) | MRR, active subscriptions, paying vs comped (5b, PAY P-8a); plan refunds and disputes (not recorded before PAY P-6b; BD-17 timing then); refused payments (DF-7, slice 7); Stripe fees (BD-7, slice 6 / M-3) | About 2.5 days |

**Order:** M-1 first (it lays out the account summary that M-2 fills), M-2 after M-1 merges. Each part gets its own workplan, SA workplan review, SA code review, QA and PR, recorded in §0.1. FIN 4b stays paused until M-3 merges (CR §8). **Amended 2026-10-14 (user, SA-W55):** M-1 and M-2 ship in **one workplan and one PR**. M-1 is finished first and proven at the M-1 checkpoint (no `lib/` or `app/api/` change; AC-111); M-2 starts only after it.

### 11D.3 M-1 functional rules

| # | Requirement |
|---|---|
| M1-FR-1 | **Shared picker.** `FinanceFilterBar` uses the shared `AdminBusinessPicker` (`app/admin/components/layout/AdminBusinessPicker.tsx`) in place of the original. The URL keeps `accountId` and `preset` / `from` / `to` exactly as today (the rename to `range` / `account` is M-6). Picking a business sets `accountId`; "Show all businesses" clears it. |
| M1-FR-2 | **Original picker deleted.** `app/admin/audit-trail/BusinessAccountPicker.tsx` is deleted once nothing imports it, and every guard that names it is updated in the same diff (§11D.7). No other page imports it today (Audit trail moved in L-1e, Activity in L-8a). |
| M1-FR-3 | **Chip names the business.** The account chip reads "Business: {name}" (the shared `businessFilterChip` wording and test id). The name comes from, in order: (a) the name returned by the picker for the id just picked (held by the page, never in the URL); (b) the payload, from a row already read for that exact id: the Section 4 credit row, then the Section 3 top-accounts row, then a takings or overdue row; (c) otherwise the short id (`formatShortId`), as the shared chip does. A platform account shows as the existing platform label. The name is **never** written to the URL, a log line or an audit entry. |
| M1-FR-4 | **Account header** (business picked only), above the KPI strip: the business name (M1-FR-3), the plan group from Section 1 in its one-business form (with the Founding Partner chip, BD-15), and "Paying" when the account is in a paid tier group of Section 1 (`tier:*`, BD-15), "Not paying" when it is in any other known group (Trial, Founding Partner, Comped, Unknown/held), and "Unknown" when Section 1 is `unknown` or shows the "Tier set" fallback (the paying read failed). When Section 1 is `unknown`, the group shows "Unknown". It states plainly that every section below is for this business only. |
| M1-FR-5 | **Account summary block** (business picked only), under the header: **AI cost, charged** (USD, the window; Section 3 total, with "At least" and the cut-over notice carried over; BD-18); **Paid us: credit boosts** (net per currency, from the 4a boost figures); **Paid us: plan** ("Plan payments: shown in the next update" in M-1; filled by M-2); **Credits** (allowance, used, % used, gifted outstanding, from this account's Section 4 row); **Plan group** (as M1-FR-4). Each line shows its section's state: a section that is `unknown` shows "Unknown" on its line, `partial` shows "At least" where the section does. |
| M1-FR-6 | **No new arithmetic.** Every summary figure is a value already in the payload, selected and formatted; the client adds, subtracts or converts nothing (CR SA-Q-2). No margin line (M-3). No figure adds two currencies (BD-12): boost lines stay one per currency. |
| M1-FR-7 | **Links out, with the window and the account.** The summary links to: Business OS AI **Activity**, Business OS AI **Costs & credits**, **AI cost & usage** (`/admin/analytics`) and the **Businesses** drawer. Each link carries the account under the target's own URL key (`account`) and the window in the target's own window format where the target can express it (a custom `from` / `to` range or an equal preset). Where a target cannot express the window (for example a rolling-only page), the link carries the account only and its text says the window differs. The Section 3 link to AI cost & usage gains the account and window too (CR G-8). AI cost & usage accepts a custom UTC window (L-2a), so every link carries the window: equal presets where they exist, otherwise `range=custom` with the payload's dates (SA-W56; supersedes SA-Q34's "(its own window)"). |
| M1-FR-8 | **Businesses drawer to Finance.** The drawer's Business OS panel gains a link "Open money view" to `/admin/finance?accountId=<id>&preset=this_month` (the drawer has no window of its own). Only the account id goes in the URL: never a name or an email. |
| M1-FR-9 | **Finance to the Businesses drawer.** The summary's Businesses link opens `/admin/users` with that account's drawer open. The Businesses page reads one new URL key holding a validated account id (SA-Q33 names it and rules on the pattern); with a valid id whose row is on the loaded list it opens that row's drawer through the existing opener (focus rules unchanged); with an id whose row is not on screen it shows an `AdminNotice` ("This business is not in the current list") and opens nothing; a malformed value is ignored. The search text is still never in the URL. |
| M1-FR-10 | **All-businesses view unchanged.** With no business picked, there is no header and no summary, and every section renders as before M-1. |
| M1-FR-11 | **Layout standard:** the header and summary use the shared parts (`StatusChip`, `AdminNotice`, `formatCount`, the table constants where a table is used); all new copy in `financeCopy.ts`; no `console.`; contrast as LF-1. The page shell is still not migrated (DF-4, M-6). |
| M1-FR-12 | **No server change.** The M-1 diff touches no file under `lib/` or `app/api/`: no route, builder, repository, query parameter or log line changes. If SA rules the name must come from the server (SA-Q32 option b), that part moves to M-2 and M-1 keeps M1-FR-3 (a) to (c). |

### 11D.4 M-2 window, kind and money rules

| # | Rule |
|---|---|
| M2-W-1 | **A plan payment is dated by `paid_at`** (Stripe's paid time; BD-9): it counts when `paid_at` is in the filter window, half-open whole UTC days `[start, end)` with the microsecond rule (TZ-1). `created_at` (when the webhook wrote the row) and `period_start` never decide. A test-clock payment dated in a later month counts in that month. Default **This month**. |
| M2-W-2 | **Only `kind = 'invoice_paid'` counts**, filtered in the query. `mismatch_refused` rows also carry amounts (§11D.1) and are **never** revenue (DF-7); every other kind is never read by R-m. A row of another kind reaching the builder (impossible by the filter) is left out of every sum and counted. |
| M2-W-3 | **Received = `amount_minor`**, which is Stripe's `amount_paid` and **includes tax**; **of which tax** = `amount_tax_minor` (shown, not deducted). The line is labelled "Received (Stripe fees not deducted; includes any tax; before any refund)". |
| M2-W-4 | **Minor units, exact** (the S4-W-4 rule): `amount_minor` and `amount_tax_minor` are used **as is** as integer hundredths when `minorUnitsPerMajor(currency)` (`lib/payments/refundMath.ts`) is 100; never `toHundredths`, `toUnits` or `× 100`. An amount is **unreadable** when missing, not a safe integer, negative, or in a currency whose minor unit is not 1/100: excluded from sums, counted, never 0; it makes that line's received "At least" and the block `partial`. |
| M2-W-5 | **Zero-amount invoices.** An `invoice_paid` row with `amount_minor` 0 (a discount or a credit balance paid it; it may not move the plan) is not a payment: it is left out of "payments" and counted in a note "N paid invoices had nothing to charge". |
| M2-W-6 | **Refunds and disputes.** No plan refund or dispute is recorded before PAY P-6b, so received is before any refund, and the section says "Plan refunds and disputes are not recorded yet". When P-6b records them, a later slice deducts them by BD-17 (refund month; lost dispute in the month lost; held means held now), never against the payment month. |
| M2-W-7 | **Per currency only** (CUR-1, CUR-2, BD-12). Lines from `groupByCurrency`, one per normalised code (`usd` and `USD` are one line), "Unknown currency" last. No figure, tile, payload field or exported function adds two currencies. |
| M2-W-8 | **Deleted accounts and ceiling.** A payment whose `user_id` is NULL is still our revenue: it counts in the all-businesses totals and shows on a "Deleted accounts" line (payments and received per currency), never dropped or named. At the read's ceiling, payments, received and tax show "At least" and the block is `partial` with a notice (AGG-3). |

### 11D.5 M-2 functional rules

| # | Requirement |
|---|---|
| M2-FR-1 | **Our revenue, plans, per currency** (M2-W-3 to M2-W-7): one line per currency with payments (count), received, of which tax, and the number of businesses that paid. Placed beside the boost lines in the "Our revenue" section, under a "Plans" sub-heading, with boosts under "Credit boosts"; the two are **never one figure** in the section. Money through the shared `formatMoney`. |
| M2-FR-2 | **All businesses: by business.** A table, one row per business and currency with payments and received, sorted by received (descending) then name; names looked up only for ids taken from the rows read (the existing `findNames` path); the deleted-accounts line follows (M2-W-8). Capped at the same displayed-rows limit as the takings table, with "N more businesses not listed". |
| M2-FR-3 | **One business: its payments.** With a business picked, the section lists that business's plan payments in the window, newest first: paid at (UTC, the shared `formatUtc`: `paid_at` is a timestamp), plan (the stored `tier`, shown per SA-Q37) (its display label through `tierLabelForGroup`, passed in by the builder; a tier not in `config.tierOrder` shows "Unknown plan"; no tier literal anywhere), amount received, of which tax, and the period covered (`period_start` to `period_end`, both timestamps, shown with `formatUtc`). |
| M2-FR-4 | **The plans line becomes per account (supersedes S4-FR-4).** With no business picked the plans part covers all businesses, from R-m. With a business picked it covers **that business only**, from R-m′, and the "Plan payments, all businesses: …" prefix and its copy are removed. R-d no longer drives the plans line (SA-Q35 rules what R-d still does). |
| M2-FR-5 | **K-5 "Our revenue" (supersedes S4-FR-7's value and caption).** Per currency, K-5 = **boost net (4a) + plans received**, added **only within one currency**: one currency shows "USD 89.00"; several show "N currencies, see Our revenue" (never a sum). Caption "Credit boosts and plans · {window}". If either read failed, K-5 shows "Unknown" (a sum missing a part is not the figure); at a ceiling it shows "At least" for plans and the 4a rule (Unknown) for boost net, so K-5 shows "Unknown". Grey, informational, not green-eligible; "No data yet" when neither has a counted row. The 4b dispute rule, when 4b resumes, is unchanged by this. A currency shows a K-5 value only when both parts are exact for it: the boost net is known, and the plans received is exact (no ceiling, no unreadable amount). Otherwise K-5 shows "Unknown". A part with no rows in that currency counts as an exact 0. |
| M2-FR-6 | **Account summary (fills M1-FR-5).** "Paid us: plan" shows that business's plans received per currency, and "Paid us, total" shows boosts + plans **per currency** (the K-5 figure for that business). Still no margin (M-3). |
| M2-FR-7 | **Picked business** (SEC-3): R-m′ receives exactly the picked id; R-m is not called; the deleted-accounts line and the by-business table are not shown. R-d is not called with a business picked (SA-Q35 option a), so the picked view makes **no** platform-wide read (AC-42's R-d exception closes). There, `revenue.state` is `recorded` when the account has any `invoice_paid` row (any amount, the same rows R-d counts with all businesses) or a counted boost in the window, `none_yet` when it has neither, and `unknown` when either read failed. |
| M2-FR-8 | **Honest indicators.** No counted payment in the window: "No plan payments received in this window", no currency line and no "0.00" (a real empty, §6.6). The read failed: the plans part says "Could not load"; the section is `unknown` only when the boost read failed too, `partial` otherwise. Unreadable and other-kind rows are counted on the page. The M2-W-6 note is always shown. |
| M2-FR-9 | **BD-14 and BD-20:** test-mode and live-mode payments count together, with no label, note or switch, and no read filters on the mode (no `livemode` in the repository code). |
| M2-FR-10 | **No Stripe or customer data.** R-m selects no Stripe id, refusal reason, `plan_written` or `livemode`; the payload carries none (S4-FR-9). |
| M2-FR-11 | **Route and payload:** the `revenue` section gains `plans { status, scope, lines, accounts, payments, deletedAccounts, notes }`; figures null only when `unknown`. The route's one `info` line adds the plan read's status and counts only (rows read, ceiling reached, unreadable, zero-amount, other-kind): never an amount, a currency total, a tier or a name (SEC-8). |
| M2-FR-12 | **Where the code lives:** a pure builder under `lib/business-os/finance/` (for example `planRevenue.ts`), **never under `lib/business-os/billing/`** (scanned by the webhook `routerPlacement` M-1 guard). It names no repository and no table; the wiring injects the reads (`financeHealthDeps.ts` `Pick<…>`). The K-5 per-currency combination lives in finance code, server side, beside `boostRevenue.ts` (SA-Q40). |
| M2-FR-13 | **Cannot produce, said on the section:** MRR and active subscriptions (5b, after PAY P-8a); plan refunds and disputes (not recorded yet); real Stripe fees (BD-7); one total across currencies (BD-12). |
| M2-FR-14 | **Performance:** one more concurrent read, settled on its own (S1-FR-8); route p95 still under 2 s; QA records `durationMs`. |

### 11D.6 New reads (M-2; no migration)

All in **`BusinessOsFinanceReadRepository`**, never in `BusinessOsBillingEventRepository` (the writer, with an exact caller list; SA-F2). The finance repository keeps its rules: service role documented in its header, explicit exported column lists, no write method (no-write pin), one caller (`financeHealthDeps.ts`), methods that never throw, no `livemode` anywhere in its code, and the billing event repository named in words only.

| # | Method (example name) | Scope | Table and filter | Columns |
|---|---|---|---|---|
| **R-m** | `listPlanPaymentsAllAccountsPaidInRange(range)` | Named all-accounts | `business_os_billing_events`, `.eq('kind', 'invoice_paid')`, `paid_at >= start` and `< end` | `id, user_id, kind, tier, amount_minor, amount_tax_minor, currency, period_start, period_end, paid_at` |
| **R-m′** | `listPlanPaymentsForAccountPaidInRange(accountId, range)` | Account-scoped | Same, plus `.eq('user_id', accountId)`; refuses a malformed UUID before querying | Same |

**Paging:** the layer-B pager (`pageClientRows`): keyset on `id`, page 1,000, **ceiling 5,000** (`FINANCE_READ_LIMITS`), rows plus `reachedCeiling` (SA-Q36). The all-accounts method logs at `info` with counts and timing only. **R-d** stays as SA-Q35 rules.

**Wiring:** `financeHealthDeps.ts` adds the two methods to its `finance: Pick<BusinessOsFinanceReadRepository, …>`; no new repository is named.

### 11D.7 Guards and tests affected

| Guard or test | Effect | What Dev must do | Part |
|---|---|---|---|
| `app/admin/audit-trail/__tests__/businessPicker.contract.test.ts` (`PICKERS`, `:38-40`) | The original picker is deleted | `PICKERS` holds the shared picker only; header comment updated; the path and logging checks stay on the shared file | M-1 |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` (G-6 comment, `:518-522`) | Names the original picker as "kept for Finance" | Comment updated; no rule weakened | M-1 |
| `app/admin/__tests__/contrast.lf1.source.guard.test.ts` (`EXCLUDED`, `:50`; `:112`) | The excluded file no longer exists | Remove the exclusion; the Finance folder is walked with no exclusion; `:112` still passes | M-1 |
| `app/admin/business-os-llm/__tests__/source.guard.test.ts` G-1 (`:542-549`) | Forbids importing the original picker | Keep it unchanged (it still passes, and still guards against a re-added file); run it | M-1 |
| `app/admin/finance/__tests__/financeFilterBar.layout.render.test.tsx`, `financePage.render.test.tsx` | Mock the original picker | Mock the shared picker; add the chip-name, header, summary and link tests | M-1 |
| `app/admin/finance/__tests__/source.guard.test.ts` | New summary components | Only type imports from `lib/business-os/finance/`; no repository; no `console.` | M-1, M-2 |
| Businesses page tests (`app/admin/users/__tests__/`) and the shared-folder registry (C-14) | New "Open money view" link and the drawer URL key (M1-FR-8, M1-FR-9) | Tests for the link href (id only), the valid / not-on-screen / malformed key cases, focus unchanged; `usersFilters` spec change only as SA-Q33 rules | M-1 |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` table pin (`REPOSITORY_TABLES`, `:280-300`) | **Does not grow:** `business_os_billing_events` is already one of the eight (R-d) | Run unchanged; extend the comment to name R-m; the "no `livemode` in the repository code" control stays green; the builder names no table | M-2 |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | New methods | One test per method: column list (no Stripe id, refusal reason, `plan_written`, `livemode`), `kind` and `paid_at` filters on the query, `user_id` and malformed-id refusal on R-m′, keyset paging, ceiling to `reachedCeiling`, never throws. No-write and one-caller pins unchanged | M-2 |
| `BusinessOsBillingEventRepository.test.ts` exact caller list (`:464-502`, name-based) | **Not tripped** while finance names that repository in words only | Run unchanged; any trip goes to SA, never a list edit | M-2 |
| Stripe webhook placement guards (`routerPlacement.guard`, `invoiceIntentsStayUnowned.guard`, `planSurfaces.guard`) and `firstPaymentStamp.guard` | **Not tripped:** the builder is in `lib/business-os/finance/`, never `lib/business-os/billing/` (M2-FR-12) | Run all four unchanged and paste the result | M-2 |
| `tierLiteral.forbidden.test.ts`, `enforcementPoints.test.ts` | The stored tier is shown (M2-FR-3); fixtures hold a tier value | No `'basic'` / `'pro'` literal in product code or tests (build fixtures from a stored-row constant SA approves); an entitlements import only if SA-Q37 says so, then registered | M-2 |
| 4a revenue and K-5 tests (AC-95, AC-96; S4-FR-4 plans-line copy) | The plans line and K-5 caption and value change | Update to AC-117 onward; the R-d behaviour pins change only as SA-Q35 rules | M-2 |
| `businessOwnedTables`, purge descriptors, RC-15, ledger and lot caller lists, G3 | Not tripped: no new table, no ledger or lot change | Run unchanged | M-1, M-2 |

**Dev must run, before SA code review, and paste the results in the workplan:** `npm run test:bos-entitlements`, `npm run test:authz-guard`, the finance, Businesses and layout suites, the four billing placement guards (M-2), `npm run lint:hooks`, eslint on touched files, and the scoped `tsc` with canary (AC-44). No new CI job and no added critical-path time.

### 11D.8 Acceptance criteria

All testable by Jest or by QA's recorded manual check. Figures are compared with the §13 check run at test time.

**AC to part mapping:** M-1: AC-108 to AC-116. M-2: AC-117 to AC-129.

**One account, one screen (M-1)**
- [ ] **AC-108** *(M-1)* Finance renders the shared `AdminBusinessPicker`; `app/admin/audit-trail/BusinessAccountPicker.tsx` no longer exists and no file imports it; every §11D.7 M-1 guard row passes, the contract test now on the shared picker only.
- [ ] **AC-109** *(M-1)* **Chip name:** after a pick the chip reads "Business: {picked name}"; after a reload or a deep link it reads the name from the payload row for that id when one exists, else the short id; the name never appears in the URL, a log line or a request (render plus source test).
- [ ] **AC-110** *(M-1)* **Header and summary:** with a business picked, the header shows name, plan group and Paying / Not paying, and the summary shows charged AI cost, boost net per currency, the plan placeholder line, credits (allowance, used, % used, gifted outstanding) and plan group; each equals the same figure in its section on the same render; `unknown` and `partial` sections show "Unknown" and "At least" on their lines.
- [ ] **AC-111** *(M-1)* **No new read:** the M-1 diff changes no file under `lib/` or `app/api/`; the finance route receives the same query and makes the same reads as before for the same URL (route test unchanged).
- [ ] **AC-112** *(M-1)* **No client arithmetic, no cross-currency total:** the summary components compute no sum, difference or conversion (source test); with two boost currencies (mocked) the summary shows two lines and no total.
- [ ] **AC-113** *(M-1)* **Links out:** each summary link's href carries `account=<the id>` and the window in the target's format (or the account only with the "window differs" text, per SA-Q34); the Section 3 link to AI cost & usage carries both.
- [ ] **AC-114** *(M-1)* **Drawer to Finance:** the Businesses drawer shows "Open money view" with href `/admin/finance?accountId=<id>&preset=this_month`; no name or email in it.
- [ ] **AC-115** *(M-1)* **Finance to drawer:** the Businesses URL key with a valid id on the loaded list opens that drawer (focus returns to the row's Open button on close); an id not on screen shows the notice and opens nothing; a malformed value is ignored; the status filter and search behave as before.
- [ ] **AC-116** *(M-1)* **All businesses unchanged and manual QA:** with no business picked the page has no header and no summary and every section matches its pre-M-1 render (render test). QA: pick the owner test account, see its name on the chip and header, the USD 10.00 boost, charged AI cost, credits and plan group; reload (name still shown, or short id if no row holds it); open its drawer from Finance, click "Open money view", land back on Finance for This month; record it in the workplan.

**Plan payments received (M-2)**
- [ ] **AC-117** *(M-2)* For "This month", per currency: payments, received, of which tax, zero-amount invoices, businesses that paid, and the deleted-accounts figures match check 17.
- [ ] **AC-118** *(M-2)* **Window and kind on the query:** R-m and R-m′ assert `kind = invoice_paid`, `gte paid_at start` and `lt paid_at end` (ISO strings) on the query; payments at `23:59:59.999999` and `00:00:00.000000` UTC on a month boundary each fall in exactly one month; `created_at` and `period_start` never decide.
- [ ] **AC-119** *(M-2)* **Refused payments never count:** a planted `mismatch_refused` row with an amount handed to the builder is left out of every sum and counted as other-kind; the live check 17 result excludes the 8 refused rows.
- [ ] **AC-120** *(M-2)* **Minor units exact:** `amount_minor` 7900 shows "USD 79.00"; `usd` and `USD` fall on one line; no plan amount passes through `toHundredths`, `toUnits` or `× 100` (unit and source test); a non-integer, negative or unsafe amount, or a currency whose minor unit is not 1/100 (mocked), is unreadable: counted, excluded, "At least", block `partial`.
- [ ] **AC-121** *(M-2)* **Zero-amount invoices** are not payments and show in the note; the received figure is unchanged by them.
- [ ] **AC-122** *(M-2)* **K-5:** with the owner test account picked and an October 2026 window, K-5 shows "USD 89.00" with caption "Credit boosts and plans"; with all businesses it shows boost net plus plans received per currency, matching check 18 summed over accounts for one currency; two currencies (mocked) show "2 currencies, see Our revenue"; either read failing shows "Unknown"; no element, payload field or exported function totals two currencies.
- [ ] **AC-123** *(M-2)* **Picked business:** R-m′ receives exactly the id; R-m has zero calls; the "all businesses" plans prefix is gone; the payment list shows the account's payments, newest first; `countRevenueRows` has zero calls (pinned).
- [ ] **AC-124** *(M-2)* **All businesses:** the by-business table matches check 18's plan column per account and currency; names come only from ids in the rows read; the deleted-accounts line shows payments with `user_id` NULL, never named.
- [ ] **AC-125** *(M-2)* **Ceiling** (injected small ceiling): payments, received and tax show "At least"; the section is `partial` with a notice; K-5 shows "Unknown".
- [ ] **AC-126** *(M-2)* **Empty and failure:** no counted payment in the window shows "No plan payments received in this window" with no "0.00"; the plan read failing shows "Could not load" on the plans part only, the section `partial` (or `unknown` when the boost read failed too), and every other section renders.
- [ ] **AC-127** *(M-2)* **No Stripe data, logs, mode:** the R-m column list holds no Stripe id, refusal reason, `plan_written` or `livemode`; the payload carries none; the route log line carries counts, statuses and timing only; test and live rows count together with no label (BD-14, BD-20).
- [ ] **AC-128** *(M-2)* **Auth, input, read-only and guards:** re-run of AC-99 and AC-100 over the M-2 diff (zero plan reads on 401, 403 and 400; no write, no migration, no SQL function; every §11D.7 M-2 row passes, including the four billing placement guards run unchanged; scoped `tsc` with canary).
- [ ] **AC-129** *(M-2)* **Manual QA:** with the owner test account picked and a window covering 12 October 2026, the account summary and Our revenue show **USD 79.00 plan + USD 10.00 boost received**, K-5 shows **USD 89.00**, and the payment list shows the Basic payment of 2026-10-12 for the period to 2026-11-12; with all businesses, plans received for October is USD 79.00 (the refused rows are not counted); cross-checked against checks 17 and 18 and recorded in the workplan. Every timestamp on the payment list shows through `formatUtc`, never as '—'.

### 11D.9 Open questions for SA (slice 5a)

Technical only; no business question is open (BD-17 to BD-20). Each has a BA suggestion.

| # | Question | BA suggestion |
|---|---|---|
| **SA-Q32** | Is M-1 a short-path UI slice (CR SA-Q-2)? It takes the business name from (a) the picker pick, (b) a payload row for that id (Section 4, then Section 3, then takings or overdue), (c) the short id. Or (option b) should the route return the picked account's name through the existing `findNames` lookup, which is a server change and makes that part full cycle? | Short path with (a) to (c): every picked account with a plan row has a Section 4 row, so the name is there whenever Section 4 loads. Option (b) only if SA wants the header to survive a failed Section 4, and then it rides in M-2 |
| **SA-Q33** | M-1 opens a Businesses drawer from Finance through a new URL key on `/admin/users` (an account id, validated). Is that allowed under the layout standard (the Businesses spec holds only `status` in the URL; search is never in the URL), what is the key called, and is it a new pattern? M-1 also touches three folders (Finance, Businesses, the deleted audit-trail file): acceptable for one slice? | Allowed: an id is not personal data (the search rule is about names and emails); key `account`, as on every other admin page; `textFilter` with the UUID check and no default; open only a row already on screen. One slice, with the cross-folder edits recorded |
| **SA-Q34** | Window mapping for the links (M1-FR-7): Activity and Costs accept a custom range; AI cost & usage offers rolling presets only (24h, 30d, 90d). Carry the nearest preset there, or the account only with "window differs"? | Activity and Costs: the same `from` / `to`; AI cost & usage: the account only, with the link text "(its own window)" |
| **SA-Q35** | R-d after M-2: (a) not called with a business picked (the picked view then has no platform-wide read, AC-42's exception closes) and kept for the all-businesses existence check; (b) kept as is; (c) retired, since R-m returns the rows? | (a): the plans line no longer needs it; keep R-d where it still feeds the "Platform revenue" existence wording, or retire it if nothing else reads it |
| **SA-Q36** | R-m paging: reuse the layer-B pager (keyset on `id`, ceiling 5,000, "At least") with no `paid_at` index? | Reuse; 1 counted row today, and the table grows by one row per paid invoice |
| **SA-Q37** | The plan column in the payment list (M2-FR-3): the stored `tier` as is, or the display name through the mapping Section 1 already uses (a registered entitlements importer)? How do tests hold a tier value without tripping `tierLiteral.forbidden`? | The Section 1 display mapping, through the file already registered, so "Basic" reads as the plan name the page shows elsewhere; fixtures read the value from a test constant SA names |
| **SA-Q38** | Plan refunds and disputes (M2-W-6): should R-m also read the `refunded` / `dispute_*` kinds now, so the page can say "recorded, not deducted yet" the day P-6b writes them, or leave them to the slice that applies BD-17? | Leave them out; P-6b is not built, and a half-shown refund is worse than the plain "not recorded yet" note |
| **SA-Q39** | Zero-amount invoices (M2-W-5): count them outside "payments" in a note? | Yes |
| **SA-Q40** | K-5 per currency = boost net + plans received, computed in finance code on the server (a pure function beside `boostRevenue.ts`), Unknown when either read failed? | Yes; the summary's "Paid us, total" reads the same value, so the tile and the summary cannot differ |
| **SA-Q41** | CR SA-Q-1: confirm 5a (cash received) needs nothing from PAY P-8a, and that the "paying" definition (`PAYING_SUBSCRIPTION_STATUSES`) is not used by M-2 | Confirmed by design: M-2 reads paid invoices only; MRR and "paying" stay with P-8a and 5b |

---

## 11E. Slice 6a, Money M-3: account economics and AI margin

Specified 2026-10-14 from the consolidation review (**CR** §5.1 "Finance: Accounts", §5.2 "AI margin", §7 G-4 and G-6, §8 M-3), the merged 5a code (main `d05eb0a4`, PR #383), a read-only live check (§11E.1), and BD-1, BD-7, BD-8, BD-12, BD-14, BD-18, BD-20, BD-22. **No migration, no new SQL function, no new table, no write, and no new repository method.** It adds one pure builder, one validated route parameter group (SA-Q42) and a tab. This is FIN slice 6 split: **6a** = margin overall and per account, USD only; **6b** keeps the margin per current plan (BD-8), K-7 and the Stripe fee estimate (DF-8). Where this section and §8.3 disagree on margin, **this section governs**.

**The question it answers.** "Across all accounts, who paid us what, what did their AI cost us, and which accounts are worth it?" For the owner test account in October 2026 the row reads: paid us **USD 89.00** after tax (plan 79.00 + boost 10.00, tax 0), charged AI cost **USD X** (check 19), AI margin **USD 89.00 minus X**.

### 11E.1 Live facts and code facts (read-only, 2026-10-14)

Live: measured with a SELECT-only script from the main checkout (`e49a4719`; zero-row column probes plus counts; no rows written, no DDL). Code: read on `feature/bos-money-m3` at `d05eb0a4`. Checks 19 and 20 (§13) were written against these facts and not executed by BA.

| Fact | Value |
|---|---|
| `business_os_credit_charges` | 423 rows, columns `id, user_id, kind, cost_usd, credits, created_at` read back without error. Only `kind = 'charge'` today (no adjustment yet). October 2026: 386 rows over **6 accounts**, none with `user_id` NULL |
| `business_os_boost_purchases` | 1 row: `paid`, `USD`, `amount_tax_minor` 0. Columns `amount_total_minor, amount_tax_minor, amount_refunded_minor, paid_at, status, currency, user_id` read back |
| `business_os_billing_events` | 9 rows; 1 `invoice_paid`, `usd`, `amount_tax_minor` 0 (§11D.1) |
| `business_os_account_plans` | 8 rows (every account in the plan walk) |
| Every all-accounts read already carries the account | R-a ledger rows (`user_id`; `aiCost.ts` already builds a per-account map and returns only the top 10); R-k boost rows (`user_id`; `boostRevenue.ts` groups by currency and package only); R-m plan rows (`user_id`; `planRevenue.ts` builds a by-business table, received **including tax**); the plan walk (`classifyAccounts` returns `groupByAccount`); the credit-positions pass (`positionsPass.byUserId`, every walked account). **So no new read is needed: M-3 groups rows the route already holds.** |
| Tax | Plan rows carry `amount_tax_minor` per payment; boost rows carry `amount_tax_minor` per purchase. Today's boost **net** and plan **received** both **include** tax (`financeCopy.ts`, M2-W-3). No tax is recorded per refund |
| Charging cut-over | `CHARGING_CUTOVER_FLOOR_MS` = 2026-09-29 16:50:53.914 UTC (`lib/business-os/credits/aiActivity.ts:146`); Section 3 reports `coverage` (`after_cutover`, `starts_before_cutover`, `entirely_before_cutover`) |
| Route | `app/api/admin/business-os/finance/route.ts` validates `preset`, `from`, `to`, `accountId` with Zod; the page URL keys are the same (`financeUrl.ts`). There is no tab and no sort parameter today |
| Display cap precedent | `TABLE_ROWS_SHOWN` 200 (`financeHealth.ts:157`): one names request (the identity read's 200-id chunk) |

### 11E.2 Scope

| In scope | Not in scope |
|---|---|
| An **Accounts** tab on Finance (all businesses only); a pure server-side builder of one row per account; the AI margin rule; server-side sort, filter and a 200-row cap; a platform totals line; a link from each row to the M-1 one-account view; the **AI margin** line in the M-1 account summary (picked view) | Any new read or repository method; MRR (5b); the margin per current plan, K-7 and the Stripe fee estimate (6b, DF-8); recorded-but-not-charged cost (M-4, BD-18); the "since it started" window (DF-6, BD-26: it raises the 92-day cap, a route and validation change, not trivial); the Money sidebar section (M-5, BD-21); plan refunds and disputes (not recorded before PAY P-6b); any FX (BD-12); a CSV export |

**Estimate: about 3 days**, full cycle (new money logic and a route parameter): builder, wiring and route about 1.5 days; tab, table and summary line about 1 day; guards, SQL cross-checks and QA about 0.5 day.

### 11E.3 Money and margin rules

| # | Rule |
|---|---|
| M3-W-1 | **Window.** The page window (preset or custom, at most 92 days, UTC; TZ-1). Revenue is dated by `paid_at` (plans M2-W-1, boosts S4-W-1); AI cost by ledger `created_at` (Section 3). The window is the one in the URL and is carried on every row link. |
| M3-W-2 | **Paid us, after tax (BD-22), per account and currency.** **Plans:** for each counted payment (M2-W-2 to M2-W-5), `amount_minor` minus `amount_tax_minor`. **Boosts:** for each counted purchase (S4-W-2): `paid` = total minus tax; `refunded` with refunded = total = 0; `partially_refunded` or `refunded` with tax 0 = total minus refunded; `disputed` and `dispute_lost` = 0 (nothing kept; S4-W-6). A refund of a purchase with tax above 0 that is not a full refund is **inexact** (no tax per refund is recorded). Minor units used as is (S4-W-4, M2-W-4); `groupByCurrency` lines only. Before-tax figures stay on the Overview; the Accounts tab shows after-tax only and says so. Computed from the exported boost reader's result, with no status literal: let net = total minus refunded minus held minus lost; net 0 gives 0; otherwise no refund gives net minus tax; otherwise tax 0 gives net; otherwise inexact. |
| M3-W-3 | **AI cost = charged cost (BD-18)**, USD: the net of charges and adjustments in the window for that account, summed exactly at the ledger scale, as Section 3 sums it. Deleted accounts' rows form the Deleted accounts row. |
| M3-W-4 | **AI margin = paid us after tax in USD minus charged AI cost**, in USD, shown **only when all** of these hold for the account (or for the platform line): (a) every revenue line of the account is USD, so no line in another currency and no Unknown-currency line; (b) the USD revenue after tax is exact; (c) the AI cost is exact; (d) the window does not start before the charging cut-over. An account with no revenue at all and exact cost has margin = minus its cost (a real loss), labelled "No revenue in this window". |
| M3-W-5 | **Other currencies (BD-12, CUR-3).** When (a) fails, the margin cell reads **"n/a, different currency"** and the revenue cell shows each currency on its own line. No conversion, no exchange rate, and no partial margin from the USD part alone (the AI cost cannot be split between currencies). |
| M3-W-6 | **Unknown and "at least" (AGG-3, §6.6).** A read at its ceiling makes the figures from it "At least X" and the margin **Unknown** (a lower bound minus a lower bound is not a figure). A failed read makes its column **Unknown** on every row and the margin Unknown. An unreadable row (S4-W-4, M2-W-4, ledger unreadable amount) or an inexact refund (M3-W-2) makes that account's figure "At least" (revenue) or Unknown (net after refund) and its margin Unknown. Unknown is never shown as 0. |
| M3-W-7 | **Before the cut-over.** When the window starts before the charging cut-over (Section 3 `coverage` is not `after_cutover`), every margin reads **"Not available: AI cost is charged only from 29 Sep 2026"**; revenue and cost still show, with the cut-over notice. |
| M3-W-8 | **Deleted accounts** (`user_id` NULL on any read): one "Deleted accounts" row, never named, never linked, always last, outside the cap; its figures count in the platform line. |
| M3-W-9 | **Platform AI margin line** above the table: paid us after tax per currency, charged AI cost, and the platform AI margin under M3-W-4 to M3-W-7 applied to all accounts together (any non-USD revenue anywhere makes it "n/a, different currency"). It covers **every** account, unfiltered, and says so. |
| M3-W-10 | **Test and live together** (BD-14, BD-20): no label, switch or `livemode` filter. |

### 11E.4 Functional rules

| # | Requirement |
|---|---|
| M3-FR-1 | **Tab.** With no business picked, Finance shows two tabs, **Overview** (today's page, the default) and **Accounts**. The tab is in the URL (`tab=accounts`; absent means Overview), written with `replace` (the U-2 precedent of `?tab=`). With a business picked there is no tab: the one-account view shows, and picking a business from the Accounts tab drops `tab`. Tab key name and component are SA-Q43. |
| M3-FR-2 | **Which accounts.** Every account in the plan walk, plus every `user_id` that appears in the window's ledger, boost or plan rows but has no plan row (group "Unknown/held", noted "No plan row"), plus the Deleted accounts row (M3-W-8). A platform account shows the existing platform label. If the plan walk failed or hit its ceiling, the list holds only accounts seen in the money reads, the table is `partial`, and a notice says "Accounts with no money or AI use in this window may be missing". |
| M3-FR-3 | **Columns:** Business (name for shown rows only, the existing `findNames` path, else the short id; never in the URL or a log); **Plan group** (current, with the Founding Partner chip, BD-15; header note "Plan is the current one", BD-8); **Paid us, after tax** (one line per currency; a second small line "plan X · boosts Y" in the same currency); **AI cost, charged (USD)**; **AI margin (USD)**; **Credits used** (% of allowance and "used / allowance", for the account's own credit period, TZ-3, labelled "own credit period"; Unknown when the positions pass failed; "No allowance" as Section 4); **Open** (M3-FR-7). "Paid us" through `formatMoney` (exactly two decimals, currency named); AI cost and AI margin through `formatUsd` (2 to 4 decimals, as Section 3 prints its cost, so the cost cell equals Section 3's text); numbers in `ADMIN_TD_NUM` cells. |
| M3-FR-4 | **Sort (server side, before the cap).** Options: **AI cost, highest first** (default); **AI margin, lowest first** (losses first; "n/a", "Not available" and Unknown rows after every number, then by AI cost); **Paid us, highest first** (USD after tax; accounts with another currency after the USD ones, by currency code then amount, never compared across currencies); **Credits used, highest first**. Ties by account id. Sorting by name is not offered (names are read for shown rows only). |
| M3-FR-5 | **Filters (server side, before the cap):** **Plan group** (all, or one of the six groups, §8.1); **Show**: "All accounts" (default), "Paid us or used AI in this window", "Negative AI margin" (only rows with a USD margin below 0). Filters and sort live in the URL beside `tab`, validated with Zod on the route; a malformed value falls back to the default with the existing `FINANCE_URL_NOTICE`. The route accepts `sort`, `group` and `show` only together with `tab=accounts` (otherwise 400), and the page writes them only on that tab. |
| M3-FR-6 | **Cap.** At most **200** rows shown (`TABLE_ROWS_SHOWN`, one names request), plus the Deleted accounts row. The count line reads "Showing 200 of N accounts" and, when cut, "N more accounts not listed; narrow with a filter". The platform line (M3-W-9) covers every account. |
| M3-FR-7 | **Link to the one-account view.** Each named or short-id row links to `/admin/finance?accountId=<id>` plus the current window (`preset`, or `preset=custom&from&to`), so the M-1 view opens on the same window. The Deleted accounts row has no link. Only the id and the window are in the href. |
| M3-FR-8 | **Account summary AI margin line (fills CR §5.2).** With a business picked, the M-1 summary gains **"AI margin (USD)"** under "Paid us, total", built by the same builder from the account-scoped reads (R-a′, R-k′, R-m′) with the same rule; so the Accounts row and the one-account view show the same figure for the same window (AC-142). |
| M3-FR-9 | **Labels and notes (always shown on the tab):** "Paid us is after tax, net of refunds and disputes. Stripe fees are not deducted." (BD-7, BD-22); "AI cost is the charged cost (credits we billed)." (BD-18); "AI margin is shown only for accounts paid in USD. No exchange rate is used." (BD-12); "Plan refunds and disputes are not recorded yet." (M2-W-6); the S4-W-3 boost refund timing note whenever the boost part carries it (until 4b builds BD-17). |
| M3-FR-10 | **Honest indicators:** no account matches the filter: "No accounts match this filter" (no table); the tab is `unknown` only when the ledger read and both revenue reads failed; otherwise per-column Unknown and the tab `partial` with a notice naming the part. |
| M3-FR-11 | **Where the code lives.** A pure builder `lib/business-os/finance/accountEconomics.ts` (structural input types; no data-layer, entitlements or clock import; plan labels through the `tierLabelOf` callback, the aiCost precedent). It reuses the one definition of a readable boost and plan row (SA-Q45) and of a per-account ledger sum (SA-Q46); it never adds two currencies and exports no function that could. Wired in `financeHealth.ts`; the route adds an optional `accountEconomics` section to the payload only when `tab=accounts` and no business is picked (SA-Q42), and an optional `accountMargin` (the M3-FR-8 line) only when a business is picked; both keys are absent otherwise, and `accounts` stays Section 1 (SA-W74). |
| M3-FR-12 | **Overview unchanged.** Without `tab=accounts`, the route makes the same reads and returns the same payload as before M-3 (except the M3-FR-8 summary line with a business picked). |
| M3-FR-13 | **No client arithmetic** (the M1-FR-6 rule): every figure, sort and filter is decided on the server; the client formats only. |
| M3-FR-14 | **Logs and payload:** the route's one `info` line adds the accounts table's status, row counts (total, shown, filtered out), and the sort and filter values: never an amount, a name or a currency total (SEC-8). No Stripe id, tier literal or `livemode` in the payload. |
| M3-FR-15 | **Layout standard:** shared table constants, `StatusChip`, `AdminNotice`, `AdminEmpty`, `formatCount`; copy in `financeCopy.ts`; no `console.`; contrast as LF-1. The page shell stays as it is (M-6, DF-4). |
| M3-FR-16 | **Performance:** no new database read; one more names request of at most 200 ids, only on the Accounts tab; route p95 under 2 s; QA records `durationMs` for both tabs. |

### 11E.5 Reads (reused; no new read)

| Need | All accounts (Accounts tab) | One account (summary line) |
|---|---|---|
| Charged AI cost per account | R-a `listRowsOfAllAccountsCreatedInRange` (ceiling 20,000) plus the originals look-up | `listRowsForAccountCreatedInRange` |
| Boosts per account | R-k (ceiling 5,000) | R-k′ |
| Plans per account | R-m (ceiling 5,000) | R-m′ |
| Plan group | plan walk `pagePlans` + R-c paying (`classifyAccounts().groupByAccount`) | `findEntitlementInputs` + R-c′ (unchanged) |
| Credits used | credit-positions pass `byUserId` (as Section 4) | the same, one account |
| Names | `findNames` for the shown ids only (≤ 200) | the M-1 chip rule |

`BusinessOsFinanceReadRepository`, `BusinessOsCreditLedgerReadRepository` and the lot repository gain **no** method; their caller lists and the finance table pin are unchanged.

### 11E.6 Guards and tests affected

| Guard or test | Effect | What Dev must do |
|---|---|---|
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | New builder | It imports no repository, no data layer, no entitlements module and no clock; `REPOSITORY_TABLES` unchanged; extend the "no cross-currency total" control to the new file (planted negative control) |
| `app/admin/finance/__tests__/source.guard.test.ts` | New tab and table components | Type imports only from `lib/business-os/finance/`; no repository; no `console.`; no arithmetic on money in components |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts`, ledger and lot caller lists, `BusinessOsBillingEventRepository.test.ts` caller list | **Not tripped** (no new method, no new caller) | Run unchanged and paste the result |
| `serviceColumn.guard.test.ts` (AGG-6) | Per-account cost never groups on raw `service` | Run unchanged |
| `tierLiteral.forbidden.test.ts`, `npm run test:bos-entitlements` | Plan group labels via callback | No tier literal; no new entitlements importer (if SA rules otherwise, register it in the same diff) |
| Webhook placement guards (`routerPlacement`, `invoiceIntentsStayUnowned`, `planSurfaces`, `firstPaymentStamp`) | Not tripped: nothing under `lib/business-os/billing/` | Run unchanged |
| Finance route tests and `npm run test:authz-guard` | New Zod fields (`tab`, sort, filter) | 400 on malformed values; 401 / 403 make no read; Overview payload and reads unchanged without `tab` |
| `financeUrl.test.ts`, `FINANCE_URL_KEYS` | New URL keys | Round-trip, defaults, malformed fallback with the notice |
| `layoutFolder.guard`, contrast LF-1 guard | New Finance components | Run; no exclusion added |
| `finance.source.guard.test.ts` export pins for `boostRevenue.ts` (`:769-772`) and `planRevenue.ts` (`:917-919`) | **Trip**: SA-Q45 exports the row readers | Update each list to the exact new names in the same diff, with a reason comment; no other export |
| Same file, DF-5 pin (`:684-712`) | Scans `boostRevenue.ts` only | Extend it to `accountEconomics.ts` with zero tokens allowed (no `amount_refunded_minor`, `'disputed'` or `'dispute_lost'`), with a planted control |

Dev runs, before SA code review, and pastes in the workplan: `npm run test:bos-entitlements`, `npm run test:authz-guard`, the finance, layout and billing placement suites, `npm run lint:hooks`, eslint on touched files, and the scoped `tsc` with canary (AC-44). No new CI job and no added critical-path time.

### 11E.7 Acceptance criteria

All testable by Jest or by QA's recorded manual check. Figures are compared with checks 19 and 20 (§13) run at test time.

- [ ] **AC-130** With no business picked, Finance shows Overview and Accounts tabs; `tab=accounts` opens Accounts after a reload; with a business picked no tab shows and `tab` is dropped.
- [ ] **AC-131** **Rows:** every plan-walk account appears (8 today, plus any money-only account labelled "No plan row"), the Deleted accounts row last when any `user_id` NULL row was read; a platform account carries the platform label.
- [ ] **AC-132** **Paid us after tax** per account and currency equals check 19 `usd_revenue_after_tax_minor` / 100 (USD) and lists any other currency on its own line; plan and boost parts show beside it.
- [ ] **AC-133** **Tax rules (unit):** plan 7900 with tax 500 gives 74.00; boost `paid` 1000 tax 100 gives 9.00; `refunded` in full gives 0; `partially_refunded` with tax 0 gives total minus refunded; `partially_refunded` with tax above 0 gives Unknown net and margin Unknown; `disputed` and `dispute_lost` give 0.
- [ ] **AC-134** **AI cost** per account equals check 19 `ai_cost_usd` and the platform line's AI cost (every account, before any filter or cap, deleted accounts included) equals Section 3's total for the same window.
- [ ] **AC-135** **Margin rule:** an all-USD exact account shows revenue after tax minus cost (negative allowed); an account with no revenue shows minus its cost with "No revenue in this window"; values match check 19 `ai_margin_usd`.
- [ ] **AC-136** **Different currency:** a mocked account with an ILS boost (alone, or beside USD) shows "n/a, different currency", the ILS line on its own, and no USD-only partial margin; the platform line then reads "n/a, different currency"; no element, payload field or exported function adds two currencies.
- [ ] **AC-137** **Ceilings:** an injected small ceiling on R-a, R-k or R-m shows "At least" on that part and Unknown margin on every row; the tab is `partial` with a notice.
- [ ] **AC-138** **Failures:** each of the ledger, boost, plan, plan walk and positions reads failing alone shows Unknown in its column only (plan walk: the M3-FR-2 notice), the tab `partial`; all three money reads failing makes the tab `unknown`; the Overview still renders.
- [ ] **AC-139** **Cut-over:** a window starting before 2026-09-29 16:50:53.914 UTC shows "Not available: AI cost is charged only from 29 Sep 2026" in every margin cell and on the platform line.
- [ ] **AC-140** **Sort:** each of the four options orders rows as M3-FR-4 on a fixture with numbers, n/a, Unknown and a second currency; ties by id; the order is decided before the cap (a row ranked 201 by the default is absent, ranked 1 by another sort is present).
- [ ] **AC-141** **Filters:** plan group and the three Show options narrow the rows on the server; "Negative AI margin" excludes n/a, Unknown and Not available rows; the platform line is unchanged by any filter.
- [ ] **AC-142** **Same figure both ways:** for the owner test account and an October 2026 window, the Accounts row margin equals the M-1 summary's AI margin line, and "Paid us, after tax" equals USD 89.00 while "Paid us, total" on the Overview still shows USD 89.00 including tax (tax 0 today).
- [ ] **AC-143** **Cap:** with 250 fixture accounts, 200 rows show plus the Deleted accounts row, the count line reads "Showing 200 of 250 accounts" with the "N more" sentence, and `findNames` receives at most 200 ids, all taken from the rows read.
- [ ] **AC-144** **Link:** each row's href is `/admin/finance?accountId=<id>` plus the current window keys, nothing else; the Deleted accounts row has no link; following it opens the M-1 view on the same window.
- [ ] **AC-145** **Overview unchanged:** without `tab`, the route makes the same read calls with the same arguments and returns the same payload as before M-3 (route test); `findNames` is not called for the accounts table.
- [ ] **AC-146** **URL and input:** malformed `tab`, sort or filter values return 400 from the route and fall back to defaults with `FINANCE_URL_NOTICE` on the page; 401 and 403 make zero reads.
- [ ] **AC-147** **No client arithmetic, logs, data:** the tab components compute no sum, difference, sort or conversion (source test); the route info line carries statuses, counts, sort and filter values only; the payload has no Stripe id, tier literal or `livemode`; test and live rows count together with no label.
- [ ] **AC-148** **Guards and read-only:** every §11E.6 row passes; no write, migration, SQL function or repository method added; scoped `tsc` with canary.
- [ ] **AC-149** **Manual QA (L-75 to L-80):** open Finance, Accounts, This month (October 2026); see the owner test account with USD 89.00 paid after tax, its charged AI cost and margin matching check 19, its plan group and credits; sort by AI margin and by AI cost; filter "Paid us or used AI"; open the row and land on its one-account view with the same window and the same margin line; set a window starting 2026-09-15 and see "Not available" margins; compare the platform line with check 20; record it in the workplan.

### 11E.8 Open questions for SA (slice 6a)

Technical only. **No business question is open**: BD-7, BD-12, BD-18 and BD-22 decide the margin; the CR M-3 description sets the columns.

| # | Question | BA suggestion |
|---|---|---|
| **SA-Q42** | Build the accounts table only when `tab=accounts` (a new validated route field), or on every all-businesses request? | Only on `tab=accounts`: the Overview payload and timing stay exactly as today (AC-145), and the extra names request runs only on the tab |
| **SA-Q43** | The tab: URL key name (`view`, or `tab` as on Business OS AI), and whether to reuse the Business OS AI tab pattern (L-8a: roving focus, `replaceState`) as a shared part or keep it page-local (a new pattern needs SA, CLAUDE.md rule 7) | `tab=accounts`, matching Business OS AI; page-local with the same keyboard rules, no new shared export (SA-R-3) |
| **SA-Q44** | Sort and filter keys and enums in the URL and on the route (for example `sort`, `group`, `show`), and their place in the M-6 rename (`range` / `account`) | Short keys `sort`, `group`, `show`, Zod enums, defaults omitted from the URL; M-6 keeps them unchanged |
| **SA-Q45** | One definition of a readable row: export the per-row readers from `boostRevenue.ts` (`readMoney`) and `planRevenue.ts` so the new builder does not copy them, or have those builders also return a per-account after-tax projection? | Export the per-row readers (the "one core, two projections" ruling of SA-Q7); `refundsAndDisputesOf` stays the only reader of refunds and disputes |
| **SA-Q46** | Per-account AI cost: have `summariseAiCost` also return the full per-account map (non-wire), or sum the ledger rows again in the new builder? | Return the map from `summariseAiCost` (one sum, so the rows and Section 3 cannot differ; AC-134) |
| **SA-Q47** | The after-tax rule for refunds (M3-W-2): Unknown net when a taxed purchase is partly refunded, instead of a pro-rata tax share | Unknown: no tax per refund is recorded and a pro-rata figure would be a guess; live tax is 0 on every row |
| **SA-Q48** | Margin when the window starts before the cut-over: "Not available" (M3-W-7), or a margin limited to the part after the cut-over? | "Not available": revenue before the cut-over has no matching charged cost, so any margin would be overstated |
| **SA-Q49** | Accounts seen only in money reads (no plan row): show as "Unknown/held, No plan row" rows (M3-FR-2), or leave them out? | Show them: they paid us or cost us, so leaving them out would hide money; it matches Section 3 holding such ledger rows under Unknown/held |
| **SA-Q50** | Full cycle confirmed (new money logic, route fields), one workplan and one PR, FIN 4b still paused until merge? | Yes |

---

## 11F. Money M-4: two measures, one vocabulary (OV-1 copy, OV-5 recorded above charged)

Specified 2026-10-15 from the consolidation review (**CR** §6 vocabulary, §7 G-7, §8 M-4, §9 BQ-2 and BQ-10), the overlap review's slices **OV-1** and **OV-5** (cited as **OV**; its §4 explains why the two records differ, its §5 holds the proposed wording), the merged M-1 to M-3 code (main `b20da2cc`, PRs #383 and #392), a read-only live check (§11F.1), and BD-12, BD-18, BD-27. **No migration, no new SQL function, no new table, no write and no new repository method.** M-4 has two parts: **OV-1** relabels every admin AI cost figure with the two §6 names (copy only), and **OV-5** shows the recorded AI cost and how far it is above the charged figure ("Recorded above charged") **beside** the charged figure on Finance, for the window and for one account, **never added to it**.

**The question it answers.** "What did AI cost us, and how much of it did we not charge for?" For October 2026 (to 2026-10-15) the live answer is: charged AI cost USD 1.61, recorded AI cost USD 1.94, recorded above charged USD 0.33 (§11F.1).

### 11F.1 Live facts and code facts (read-only, 2026-10-15)

Live: measured with a SELECT-only script run from the main checkout (`e49a4719`; one-row column probes, paged selects of `id, user_id, cost_usd, created_at, feature, session_id`, and head counts; no rows written, no DDL). Code: read on `feature/bos-money-m4` at `b20da2cc`. Checks 21 and 22 (§13) were written against these facts and not executed by BA.

| Fact | Value |
|---|---|
| `daily_token_usage`, `monthly_token_usage` (views, no migration) | Columns `user_id, day` or `month, provider, model_name, request_count, total_input_tokens, total_output_tokens, total_tokens, total_cost_usd` (monthly adds two averages). **No `feature` column**, so neither can tell a Business OS call from an agent-platform call. **Not usable** for a Business OS figure. No TypeScript code reads either view; they are service-role only since 20261059 |
| `business_os_usage_summary(p_user_id, p_since)` (migration `20260929_usage_summary.sql`) | Returns `bucket, key, tokens, calls`: **tokens and calls only, no cost**, one account, **no end bound**. **Not usable** for a USD figure in a window |
| `token_usage`, Business OS rows (`bosRowFilter()`: feature starts with `business-os`, or one of `insight-generation`, `correlated-insight-generation`, `health-summary-generation`, `landing-page-generation`, `lead-reply`) | 7,786 rows in all (every one in the last 92 days); 1,149 since the charging cut-over; **1,103 in October 2026**, cost USD 1.942075, over **6 accounts**; none with `user_id` NULL and none on a platform account in October; 208 rows with cost 0; 446 with no `session_id` |
| `business_os_credit_charges`, October 2026 | 396 rows, cost USD 1.612137, 6 accounts (the same 6) |
| Per account, October 2026 (recorded less charged, USD) | 0.3139, 0.0099, 0.0031, 0.0031, 0.0000, 0.0000: every account has recorded at or above charged today; one account holds 95% of the difference |
| Existing all-accounts reader | `AdminTokenUsageAnalyticsRepository.listCostPointsAllAccountsInWindow(context, window, { featureFilter }, { pageSize, ceiling, signal })`: the **Health spend tile's** read. Columns `id, created_at, cost_usd`; newest first; paged; de-duplicated; ceiling `ADMIN_HEALTH_READ_LIMITS.CEILING` 10,000; `reachedCeiling` and `completed`; abort signal; requires an admin read context; **end bound inclusive** (`lte`). Allowed only under `app/api/admin/**` (isolation guard) |
| Existing one-account reader | `TokenUsageRepository.listCallsInWindow(userId, window, filter, { pageSize, ceiling })`: account-scoped **by signature** (UUID required), the read the Businesses drawer's "Business OS AI, 30 days" figure and the leak check already use. Columns `TOKEN_USAGE_COLUMNS.call` (no payloads); ceiling at most `MAX_CEILING` 5,000; **end bound inclusive**; no abort signal |
| Finance window | `start` inclusive, `end` **exclusive** (`financeTypes.ts:59-62`); the ledger reads use `gte` / `lt` |
| Finance code today | The finance source guard forbids `token_usage`, `TokenUsageRepository`, `monthly_token_usage` and `business_os_usage_summary` in **every** finance file, the route included (`finance.source.guard.test.ts:144-147`). Its pattern does **not** match `AdminTokenUsageAnalyticsRepository` (a gap this step closes). The route already injects one admin-context read into the builder (`readReminderFigures`, slice 2b): the precedent for OV-5 |
| Deleted accounts | `token_usage.user_id` has `ON DELETE CASCADE` to `users` (purge schema dump `:586`): a deleted account's recorded rows are **gone**, while its ledger rows stay with `user_id` NULL (Section 3's Deleted accounts bucket) |
| Charging cut-over | `CHARGING_CUTOVER_FLOOR_MS` = 2026-09-29 16:50:53.914 UTC; Section 3 reports `coverage` |
| Known paths that are recorded and never charged | Platform-account and invalid identities; calls outside an AI action or after its scope closed; failed or timed-out charge writes; chat v1 and v2 turns outside the call catalog (deduction KI-6, KI-20); unpriceable actions (ACT F-27, OV §4 cause 1). A cache-served chat turn is recorded at USD 0 (ACT F-15) |
| Known paths where charged is above recorded | Fallback-priced charges (the ledger carries a deliberate over-estimate, the usage log USD 0; ACT F-23); ledger corrections (none live today) |

### 11F.2 Scope, split and estimate

| In scope | Not in scope |
|---|---|
| **OV-1:** the §11F.4 strings on Finance, AI cost & usage, Business OS AI (Costs & credits, Leak check, Activity), the Health tile and the Businesses drawer; the tests that pin them. **OV-5:** a recorded AI cost and a "Recorded above charged" figure in Section 3 (window, all businesses or the picked one) and one line in the M-1 account summary; one pure builder; two reused reads injected by the route | Sidebar names and descriptions (OV-4, **M-5**, needs the user's sign-off, LAY sidebar rule); renaming the page "AI cost & usage" (M-5); a per-call list of what was not charged (that is the **Leak check**; CR §11 rules out changing it); a recorded column on the Accounts tab or a recorded figure in AI margin (BD-18: margin stays on the charged cost); K-1 or any KPI tile on the recorded figure; owner-facing pages; any change to how calls are recorded or charged; the analytics 1,000-row cap (parked) |

**Recommendation: two PRs, OV-1 first.** OV-1 is copy only, touches files in five admin folders, and is UI short path (CLAUDE.md, the user's short-path preference); it can ship alone in about a day and makes OV-5's labels already true when OV-5 lands. OV-5 adds a read on a money page (full cycle: SA requirement review, workplan, SA code review, QA). Two PRs keep the copy diff, which edits many string-pinning tests, apart from the data diff that a reviewer must check against checks 21 and 22. One workplan may cover both, with OV-1 committed and merged first; OV-5 then only adds strings in `financeCopy.ts`.

**Estimates:** OV-1 **about 1 day** (strings about 0.5 day; pinned tests and the vocabulary guard about 0.5 day). OV-5 **about 2 days** (builder, route wiring and payload about 1 day; Section 3 block and summary line about 0.5 day; guards, SQL checks and QA about 0.5 day).

### 11F.3 OV-1: vocabulary rules

| # | Rule |
|---|---|
| V-1 | **"Charged AI cost"** names every figure read from the credit ledger (`business_os_credit_charges`): what Business OS actions were charged for, with corrections, from 29 Sep 2026 (CR §6). |
| V-2 | **"Recorded AI cost"** names every figure read from the usage log (`token_usage`): every AI call, charged or not, both products where the page shows both, and history before charging (CR §6). |
| V-3 | Neither figure is called "estimated", "measured", "provider" or "provider-side", "spend" or "Cost Analytics" in any visible string of the §11F.4 places. Both are priced from the same model price table (OV §4; SA-Q-5 of CR), so the contrast is **which calls each counts**, never how it was priced. Fallback-priced charges keep their own wording (V-6). The Health rule descriptions and metric labels (`rules.ts`) keep "spend" until M-5 (SA-W94, FU-M4-1), and the Leak check reason texts describe usage paths and keep it (SA-W96) (E-59). |
| V-4 | Each place that shows a figure gives its source in one line beside it (the §11F.4 sub-label), and a page showing one measure names where the other is ("The charged cost is on Finance" / "Every recorded AI call: AI cost & usage"). |
| V-5 | **Copy only.** No figure, read, payload field, link target, URL key, `data-testid`, Health rule id or metric name changes (`spend24h`, `bos_ai_spend`, `strip-ai-spend` and the like stay as they are). The only edits outside strings are the tests that pin the old strings. One ruled exception: Section 3's subtitle join becomes `${windowLabel}. ${AI_SOURCE}` (SA-W90, E-59). |
| V-6 | "Fallback price" wording stays, but says what happened in these terms: "the model had no price in the price table" instead of "the measured price was missing". |
| V-7 | Strings are changed where they live today (the copy modules, or the literal in the component or evaluator). No new copy module and no new shared export. |

### 11F.4 OV-1: pages and strings

Re-verified against the code at `b20da2cc`. The layout work moved several strings since CR §6 was written: the Finance lines are now `financeCopy.ts:202-218`, and M-1 and M-3 added summary and Accounts-tab labels. Every row is in scope unless marked otherwise. "Sub-label" is the one-line source text (V-4).

| # | Place | File and line (today) | Today | New |
|---|---|---|---|---|
| W-1 | Finance KPI K-1 | `app/admin/finance/financeCopy.ts:42` | `AI cost this month` | `Charged AI cost this month` |
| W-2 | Finance Section 3 title | `financeCopy.ts:202` `AI_TITLE` | `AI cost in the window` | `Charged AI cost in the window` |
| W-3 | Section 3 sub-label | `financeCopy.ts:203` `AI_SOURCE` | `Credit ledger, charges and corrections` | `Credit ledger: what Business OS actions were charged for, with corrections, from 29 Sep 2026. AI calls that were never charged are not in it.` |
| W-4 | Section 3 total | `financeCopy.ts:204` `AI_TOTAL` | `AI cost (USD)` | `Charged AI cost (USD)` |
| W-5 | Section 3 top 10 | `financeCopy.ts:212` `AI_TOP` | `Top 10 businesses by AI cost` | `Top 10 businesses by charged AI cost` |
| W-6 | Section 3 link note | `financeCopy.ts:218` `AI_LINK_NOTE` (link text `AI_LINK` unchanged) | `For the provider-side token measure, see` | `Every recorded AI call, charged or not:` |
| W-7 | Account summary line (M-1) | `financeCopy.ts:481` `ACCOUNT_AI_COST` | `AI cost, charged` | `Charged AI cost` |
| W-8 | Accounts tab column (M-3) | `financeCopy.ts:519` `ECON_COST` | `AI cost, charged (USD)` | `Charged AI cost (USD)` |
| W-9 | Accounts tab note and sort | `financeCopy.ts:511`, `:547` | `AI cost is the charged cost (credits we billed).`; `AI cost, highest first` | `AI cost is the charged AI cost (credits we billed); the recorded AI cost is not used here.`; `Charged AI cost, highest first` |
| W-10 | AI cost & usage, Business OS scope note | `app/admin/analytics/page.tsx:345-347` | `Business OS only: includes legacy-tagged Business OS rows. Costs are USD, estimated from the model pricing table.` | `Recorded AI cost, Business OS only: every AI call in the usage log, charged or not, including calls before charging started on 29 Sep 2026 and legacy-tagged Business OS rows. USD, priced from the model price table. The charged cost is on Finance.` |
| W-11 | AI cost & usage, All scope note | `analytics/page.tsx:350` | `Both products. Costs are USD, estimated from the model pricing table.` | `Recorded AI cost, both products: every AI call in the usage log. USD, priced from the model price table.` |
| W-12 | AI cost & usage KPI | `app/admin/analytics/components/AnalyticsKpis.tsx:84` | `Total spend` | `Recorded AI cost` (and "% of spend" in the category sub-line, `:131`, becomes "% of recorded cost") |
| W-13 | Costs & credits intro (also the page purpose line for that tab) | `app/admin/business-os-llm/costCopy.ts:9-11` `COSTS_INTRO` | `What Business OS actions cost us (USD, the provider's measured cost) and what we charged (credits), per account and billing period. Read from the credit ledger; nothing here changes it.` | `Charged AI cost: what Business OS actions cost us (USD, priced from the model price table) and what we charged (credits), per account and billing period. Read from the credit ledger; nothing here changes it. Monthly totals are on Finance.` |
| W-14 | Costs & credits KPI | `costCopy.ts:83` `KPI_COST_USD` | `Cost (USD)` | `Charged AI cost (USD)` |
| W-15 | Costs & credits fallback note | `costCopy.ts:36-38` `FALLBACK_NOTE` | `Charged from a fallback price because the measured price was missing ...` | `Charged from a fallback price because the model had no price in the price table: a deliberate over-estimate. Reconciling them is a later part of this work.` |
| W-16 | Leak check results | `app/admin/business-os-llm/leakCopy.ts:23`, `:46`, `:59` | `No uncharged AI spend found`; `N businesses with uncharged AI spend (X not charged)`; `Uncharged spend` | `No recorded AI cost left uncharged`; `N businesses with recorded AI cost not charged (X)`; `Recorded, not charged` |
| W-17 | Activity intro (also the tab's purpose line) | `app/admin/business-os-llm/activityCopy.ts:11-13` `ACTIVITY_INTRO` | `... whether it worked and what it cost. Read from the credit ledger; nothing here changes it.` | `... whether it worked and its charged AI cost. Read from the credit ledger; nothing here changes it.` |
| W-18 | Activity KPI, table column and drill-down field | `activityCopy.ts:46` `KPI_COST`; `:191`, `:228` (the `cost:` entries of the column and drill-down label maps); `:245` `CORRECTION_COLUMNS.cost` (SA-W91, E-58) | `Cost (USD, net)`; `Cost (USD)` | `Charged AI cost (USD, net)`; `Charged AI cost (USD)` |
| W-19 | Activity cut-over notice | `activityCopy.ts:75` `CUTOVER_LINE`; `:81` `CUTOVER_ANALYTICS_LINK` | `... see the audit trail's AI action entries or Cost Analytics.`; `Cost Analytics (Business OS)` | `... see the audit trail's AI action entries or the recorded AI cost in AI cost & usage.`; `AI cost & usage (Business OS, recorded)` |
| W-20 | Health tile title | `lib/admin/health/evaluateHealth.ts:422` `TITLES.bos_ai_spend` | `Business OS AI spend (USD, estimated)` | `Recorded AI cost (USD)` (BD-27) |
| W-21 | Health tile figures and link labels | `evaluateHealth.ts:662`, `:675-676` | `AI spend, last 24 h (USD)`, `AI spend, last 7 days (USD)`; `Business OS AI spend, <window>: <X>, open in AI cost & usage` | `Recorded AI cost, last 24 h (USD)`, `Recorded AI cost, last 7 days (USD)`; `Recorded AI cost, <window>: <X>, open in AI cost & usage` |
| W-22 | Health tile footnote | `evaluateHealth.ts:678-681` | `USD, estimated from the model pricing table; never mixed with a business currency. ...` | `USD: every Business OS AI call in the usage log, charged or not, priced from the model price table; never mixed with a business currency. The charged AI cost is on Finance. ...` (the OI-P2 sentence after it is kept) |
| W-23 | Businesses drawer summary strip | `app/admin/users/components/BusinessSummaryStrip.tsx:80`; `BusinessOsPanel.tsx:218` | `Business OS AI, 30 days`; sub `estimated` / `estimated, a lower bound` | `Recorded AI cost, 30 days`; sub `recorded` / `recorded, a lower bound` |
| W-24 | Businesses drawer AI usage block | `BusinessOsPanel.tsx:359` | `Business OS, last 30 days (USD estimated)` | `Recorded AI cost, Business OS, last 30 days (USD)` |
| W-25 | Businesses drawer "All products" | `app/admin/users/components/AllProductsUsage.tsx:21`, `:27`, `:56` | `All products, token records (30 days; may be incomplete above 1,000 calls)`; `Cost by Model (highest cost first)`; `Total Cost` | `All products, recorded AI cost (30 days; may be incomplete above 1,000 calls)`; `Recorded AI cost by model (highest first)`; `Recorded AI cost` |
| W-26 | Code comments naming the old terms | `AiCostSection.tsx:8` ("provider-side token measure"); `CutoverNotice.tsx:4` ("Cost Analytics") | — | Reworded to the V-1 / V-2 terms (comments only) |
| W-27 | Businesses drawer purpose line of the AI block (SA-W92, E-58) | `app/admin/users/components/DrawerBox.tsx:45` `DRAWER_PURPOSE['ai-bos']` | `Estimated cost of this business's Business OS AI calls, in USD.` | `Recorded AI cost of this business's Business OS AI calls, in USD.` |
| W-28 | Account summary cut-over note (SA-W93, E-58) | `financeCopy.ts:482` `ACCOUNT_CUTOVER_NOTE` | `... see AI cost in the window below.` | `... see Charged AI cost in the window below.` |
| — | **Not in OV-1** | Sidebar descriptions `AdminSidebar.tsx:100`, `:106`, `:180` (`Token spend, both products`, `Models, temperatures & costs`); the page title "AI cost & usage" | — | Left for **M-5** (OV-4; the user signs off sidebar changes) |

### 11F.5 OV-5: the definition

| # | Rule |
|---|---|
| R4-1 | **Recorded AI cost (window)** = the sum of `token_usage.cost_usd` over **Business OS rows** (`bosRowFilter()`, the one definition the Health tile, AI cost & usage and the leak check use) created in the Finance window `[start, end)`. With no business picked: every account, including platform-account rows and rows with no account. With a business picked: that account only (R4-7). |
| R4-2 | **Recorded above charged** = **Recorded AI cost minus Charged AI cost** for the same window and the same accounts, where the charged side is Section 3's net ledger cost **less its Deleted accounts bucket** (with no business picked). It is a **difference between two measures**, labelled as such, **not** a per-call match. Which calls make it up is the Leak check's job (Costs & credits), linked beside it. |
| R4-3 | **Why a difference and not "calls with no charge".** A per-call answer needs each call's `session_id` matched to a charge's group id per account, with slack at the window edges: the leak check does exactly that, per account and at most 7 days, and CR §11 keeps it unchanged. Repeating it on Finance for a 92-day window would be a new matching engine. The difference answers the business question (how much AI cost did we not bill) at the page's grain, and its known distortions are stated (R4-10). |
| R4-4 | **Deleted accounts.** A deleted account's usage rows are deleted with it (cascade), while its ledger rows stay. So the deleted bucket is left out of the charged side of R4-2 (like for like), and the page says "Deleted accounts are left out: their recorded calls are deleted with the account." |
| R4-5 | **Before the cut-over.** When Section 3's `coverage` is not `after_cutover`, Recorded AI cost is still shown (it is true), but Recorded above charged reads **"Not available: AI charging began 29 Sep 2026"**: before then nothing was charged, so the difference would count history as uncharged. |
| R4-6 | **Charged above recorded.** When the difference is 0 or below, the figure reads **"None"** with the line "Charged is USD X above recorded (fallback prices or corrections)" when below 0. A negative "Recorded above charged" is never printed. |
| R4-7 | **Per account by `user_id`.** `token_usage.user_id` and the ledger's `user_id` are both the account id (one login is one business, CR G-2). The picked-business figures use only account-scoped reads (R4-14). A platform account cannot be picked (404 today). |
| R4-8 | **Exact arithmetic.** Recorded costs are summed as integers at the ledger scale (`COST_SCALE`, through the `creditReport.ts` `toUnits` rule) and converted once; the difference is taken in integers. A row whose cost cannot be read (null or not finite) counts as 0 and is counted; a USD 0 cost is a real 0. USD only, both sides (BD-12: nothing to convert). |
| R4-9 | **Unknown and "at least" (AGG-3, §6.6).** The recorded read not exact (E-53, SA F-1). For all accounts, it is exact only when the read **completed** on a short page (`completed` true, the Health tile's C-1 rule; `reachedCeiling` alone is not enough, because de-duplication can stop a read below the ceiling without completing it). For one account, it is exact when `reachedCeiling` is false. The recorded read not exact, or with an unreadable cost, makes Recorded **"At least X"** and Recorded above charged **Unknown**. The ledger side not exact (ceiling, unreadable amount) makes Recorded above charged **Unknown**. A failed or timed-out recorded read makes both new figures **Unknown**, with a notice; Section 3's charged figures are unaffected. Unknown is never shown as 0. |
| R4-10 | **Stated distortions (shown once, under the figures, in one sentence each):** fallback-priced charges are above their recorded cost, so the difference can be **lower** than the true uncharged cost; a call and its charge can fall either side of a window edge (a charge is written when its action ends, up to 5 minutes later); a failed provider call is recorded at USD 0 in both (deduction N-3). And what Recorded above charged includes by design: chat turns outside the call catalog, platform-account calls and cache-served turns at USD 0 (§11F.1). Recorded above charged is not 'not charged' call by call; the Leak check matches calls. |
| R4-11 | **Never added (BD-18, SA-Q4).** No payload field, total, tile, chart, sort, export or margin adds recorded to charged or uses the recorded figure. AI margin (M-3) and K-1 stay on the charged cost. The builder exports no function that returns their sum. |

### 11F.6 OV-5: functional rules

| # | Requirement |
|---|---|
| M4-FR-1 | **Section 3 block "Beside the charged cost, never added".** Under Section 3's charged total, two lines: **"Recorded AI cost (USD)"** with sub-label "Usage log: every Business OS AI call, charged or not, priced from the model price table", and **"Recorded above charged (USD)"** with sub-label "Recorded AI cost minus charged AI cost, for the same window. Which calls: run the Leak check." The Leak check link opens Business OS AI `?tab=costs` (it takes at most 7 days, so no window is carried); the existing AI cost & usage link (W-6) stays and keeps carrying the window and the account. The R4-4 and R4-10 sentences follow. The block narrows to the picked business exactly as Section 3 does. |
| M4-FR-2 | **Account summary line (M-1, picked view).** Under "Charged AI cost", one line **"Recorded above charged"** with the same value, state and wording as Section 3's figure for that business and window (one payload field, rendered twice; AC-158). The recorded figure itself is not repeated in the summary. |
| M4-FR-3 | **States.** Recorded: a figure, "At least X", or Unknown. Recorded above charged: a figure, "None" (R4-6), "Not available" (R4-5), or Unknown (R4-9). Each state has its own text in `financeCopy.ts`; `formatUsd` prints amounts, as Section 3 prints its cost. |
| M4-FR-4 | **No KPI tile and no Accounts tab change.** K-1 and the KPI strip are unchanged; the Accounts tab and its platform line do not read or show the recorded cost (R4-11). |
| M4-FR-5 | **Where the code lives.** A pure builder `lib/business-os/finance/recordedCost.ts`: structural input types (rows of `{ cost_usd }`, a `reachedCeiling` flag, Section 3's charged units and coverage); no repository, no data layer, no clock and no entitlements import; it does not name `token_usage` or any usage-log repository (§11F.8). Wired in `financeHealth.ts` beside Section 3; its result is an optional `aiCost.recorded` object in the payload (field names are SA-Q54), present on the Overview and in the picked view, absent on the Accounts tab. |
| M4-FR-6 | **The route injects the read** (the `readReminderFigures` precedent of slice 2b): it binds the two reused reads of §11F.7 to this request (the admin read context, `bosRowFilter()`, the page size and ceiling) and passes them to the builder as `readRecordedAllAccounts(window, signal)` and `readRecordedForAccount(accountId, window)`. The route is the **one** finance file allowed to name the usage-log repositories. |
| M4-FR-7 | **Window bounds.** The builder asks for `[start, end)`. Both reused reads are inclusive at the end (`lte`), so the route passes `end` less 1 ms, unless SA rules another way (SA-Q52). |
| M4-FR-8 | **Deadline.** The recorded read runs in parallel with the other section reads under a deadline (2 s, the reminder precedent); past it the figures are Unknown with a notice, and the rest of the page renders. The one-account read, which takes no abort signal, is bounded by a **race only** (SA-Q53, E-57). Past the deadline its result is dropped. Its late settlement is still awaited inside the `settle` wrapper, so it can never become an unhandled rejection, and it is never applied to the payload. It pages at most 5 times. |
| M4-FR-9 | **Logs and payload.** The route's one `info` line gains `sections.aiRecorded` (status) and `counts.aiRecorded` (rows read, `reachedCeiling`, unreadable count, which read ran): never an amount, a feature value, a name or a currency total (SEC-8). The repositories' own log lines are unchanged (the admin read logs who read how much). |
| M4-FR-10 | **Copy and layout.** New strings in `financeCopy.ts` only; shared table, notice and chip parts; no `console.`; contrast as LF-1. |
| M4-FR-11 | **No client arithmetic** (M1-FR-6): the difference, its state and the "charged above" amount are decided on the server; the client formats only. |
| M4-FR-12 | **Performance.** One more read per request: up to 10 sequential pages with no business picked (about 2 pages for this month today), up to 5 for one account. Route p95 stays under 2 s; QA records `durationMs` for This month, a 92-day custom window and a picked business. |

**Picked-business rule (account-scoped reads only).** With `accountId`, the route calls **only** `readRecordedForAccount`, which reaches `TokenUsageRepository.listCallsInWindow(accountId, ...)`: the account id is a required, UUID-checked argument and the query carries `.eq('user_id', accountId)`. The all-accounts read is **not called** (zero calls, AC-157). With no business picked, only the all-accounts read runs. The account id comes from the validated URL, never a body; the platform account is refused before any read (404).

### 11F.7 OV-5: reads (reused; no new read, no new method)

| Need | No business picked | One business picked |
|---|---|---|
| Recorded AI cost rows | `adminTokenUsageAnalyticsRepository.listCostPointsAllAccountsInWindow(context, window, { featureFilter: bosRowFilter() }, { pageSize: 1000, ceiling: ADMIN_HEALTH_READ_LIMITS.CEILING, signal })`, the Health tile's read: ceiling **10,000** rows | `tokenUsageRepository.listCallsInWindow(accountId, window, bosRowFilter(), { pageSize: 1000, ceiling: TOKEN_USAGE_READ_LIMITS.MAX_CEILING })`, the Businesses drawer's read: ceiling **5,000** rows |
| Charged AI cost | Section 3's existing R-a result (`summariseAiCost` units: total and deleted bucket) | Section 3's existing R-a′ result |

**Why these and not the views or the function.** The daily and monthly views have no `feature` column, so they would mix agent-platform calls in; `business_os_usage_summary` returns no cost and has no end bound (§11F.1). The two readers above already carry the Business OS filter, paging, de-duplication and a ceiling flag, and each already serves an admin money figure.

**Ceilings and headroom.** October to date: 1,103 rows for all accounts, 711 for the busiest account; every Business OS row ever is 7,786, all inside the last 92 days. A 92-day window is near the 10,000 ceiling within months at the current rate: past it the figure is "At least" and the difference Unknown (R4-9), never wrong. Raising either ceiling is not part of this step (the Health read's header forbids it; the fix is an aggregate, which needs a SQL function and is out of scope).

No repository gains a method; `TOKEN_USAGE_COLUMNS`, `ADMIN_ANALYTICS_COLUMNS` and both repositories' public surfaces are unchanged.

### 11F.8 Guards and tests affected

| Guard or test | Effect | What Dev must do |
|---|---|---|
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts:144-147` ("no aggregate select and no token_usage") | **Trips (OV-5)**: the route names the two usage-log repositories | Narrow by SA ruling: every finance file **except the route** still names no usage-log reader, and the pattern widens to close today's gap (`TokenUsage` in any case, so `AdminTokenUsageAnalyticsRepository` is caught), with a planted control. Add a positive pin: the route names exactly `listCostPointsAllAccountsInWindow` and `listCallsInWindow` and no other usage-log method, and no file names `.from('token_usage')` (AGG-4 holds) |
| Same file, new builder `recordedCost.ts` | New file in `FILES` | Purity (no repository, data layer, clock, entitlements); exports pinned; no exported sum of recorded and charged (planted control) |
| `lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.test.ts` isolation (`:327-345`) | **Not tripped**: the route is under `app/api/admin/**` | Run unchanged. Amend the repository header's "ONLY permitted callers" paragraph to add the finance route, with the reason |
| `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` | **Not tripped**: no method or optional account filter added | Run unchanged. Amend the repository header's caller list |
| `app/admin/finance/__tests__/source.guard.test.ts` | New block and summary line | Type imports only from `lib/business-os/finance/`; no arithmetic on money in components |
| Finance route tests, `npm run test:authz-guard` | New injected read; no new query parameter | 401 / 403 / 400 make zero recorded reads; picked view calls only the account read; Overview payload otherwise unchanged |
| OV-1 string pins | **Trips (OV-1)**: tests pinning the old strings in `app/admin/finance/__tests__`, `app/admin/analytics/__tests__`, `app/admin/business-os-llm/__tests__` (costs, leak, activity, cut-over), `lib/admin/health/__tests__` and `app/admin/components/health` tests, `app/admin/users/__tests__` | Update each pinned string to the §11F.4 text in the same diff; no assertion is removed. The Health rule and metric tests stay unchanged (V-5) |
| New vocabulary guard (OV-1, SA-Q51) | New | One Jest source test over the §11F.4 files: no visible string says "estimated", "provider-side", "measured cost", "Cost Analytics" or "AI spend" for these figures, with a planted control. Runs in the existing Jest gate |
| `app/api/admin/business-os/finance/__tests__/route.test.ts`, the M-3 **AC-145 Overview baseline** (SA-WR-44) | **Trips (OV-5)**: it pins every read call, the top-level keys and the SHA-256 of the Overview payload, and OV-5 adds one read and `aiCost.recorded` | **Update it once, in OV-5, by SA ruling (E-55)**: add the all-accounts recorded read with its exact arguments, and refresh the hash. Every other read call and every top-level key stays pinned unchanged. The comment cites E-55 |
| `serviceColumn.guard`, `tierLiteral.forbidden`, entitlements registration, billing placement guards, ledger, lot and finance repository caller lists | **Not tripped** | Run unchanged and paste |

Dev runs before SA code review and pastes in the workplan: `npm run test:bos-entitlements`, `npm run test:authz-guard`, `npm run typecheck:bos-llm` (the route now imports the usage-log repositories), the finance, analytics, business-os-llm, Health, users and layout suites, `npm run lint:hooks`, eslint on touched files, and the scoped `tsc` with canary (AC-44). No new CI job and no added critical-path time.

### 11F.9 Acceptance criteria

OV-1: AC-150 to AC-153. OV-5: AC-154 to AC-168 (AC-167 and AC-168 added by SA, E-56). Figures are compared with checks 21 and 22 (§13) run at test time.

- [ ] **AC-150** *(OV-1)* Every §11F.4 row W-1 to W-25, W-27 and W-28 (E-58) shows its new text on its page (render or copy tests), and no old text from the "Today" column remains in visible copy.
- [ ] **AC-151** *(OV-1)* No figure, payload, link target, URL key, `data-testid`, Health rule id or metric changes: the Health rule and metric tests pass unchanged; the route tests of Finance, Costs, Activity, analytics and the drawer summary pass unchanged.
- [ ] **AC-152** *(OV-1)* The vocabulary guard passes and its planted control fails on a planted "estimated" label.
- [ ] **AC-153** *(OV-1, manual)* QA opens Finance, AI cost & usage (both scopes), Business OS AI Costs & credits (with a Leak check run) and Activity (with a window before 29 Sep 2026), the Health landing and one Businesses drawer, and records that each AI cost figure is called Charged or Recorded as §11F.4 says.
- [ ] **AC-154** *(OV-5)* With no business picked and This month (October 2026), Section 3 shows Recorded AI cost equal to check 21 `recorded_usd` and Recorded above charged equal to check 21 `not_charged_usd`, beside the charged total, and no element shows their sum.
- [ ] **AC-155** *(OV-5)* With the owner test account picked, Section 3 and the account summary show Recorded above charged equal to check 22 `not_charged_usd` for that account and month, and Section 3's recorded figure equals check 22 `recorded_usd`.
- [ ] **AC-156** *(OV-5, unit)* Difference rules: recorded 1.94 and charged 1.61 give 0.33; equal values give "None"; charged above recorded gives "None" and "Charged is USD X above recorded"; the deleted bucket is left out of the charged side with no business picked; sums are exact at `COST_SCALE` (a 0.1 + 0.2 fixture prints 0.3).
- [ ] **AC-157** *(OV-5)* **Picked-business rule:** with `accountId`, the all-accounts recorded read is called zero times and the account read is called once with that id; with no business picked, the account read is called zero times; on 401, 403 and 400 neither is called.
- [ ] **AC-158** *(OV-5)* The account summary line and Section 3 show the same value and state for the same business and window (one payload field).
- [ ] **AC-159** *(OV-5)* **Cut-over:** a window starting 2026-09-15 shows the recorded figure and "Not available: AI charging began 29 Sep 2026" for Recorded above charged.
- [ ] **AC-160** *(OV-5)* **Ceilings and unreadable rows:** an injected small ceiling on either read shows "At least X" and Unknown difference; a row with a null cost counts as unreadable with the same effect; Section 3's charged figures are unchanged.
- [ ] **AC-161** *(OV-5)* **Failures:** the recorded read failing or passing its deadline shows Unknown for both new figures with a notice; the charged figures, the rest of Section 3 and the other sections render; the ledger side not exact makes the difference Unknown.
- [ ] **AC-162** *(OV-5)* **Window bounds:** the read receives the Finance window start and `end` less 1 ms (or SA-Q52's ruling); a fixture row exactly at `end` is not counted.
- [ ] **AC-163** *(OV-5)* **Never added:** no payload field, exported function or component adds recorded to charged; AI margin and K-1 are unchanged by a recorded fixture (route and source tests); the Accounts tab payload has no recorded field.
- [ ] **AC-164** *(OV-5)* **Logs and payload:** the route `info` line carries the recorded status and counts only, never an amount, a feature value or a name; the payload carries no `token_usage` row, id or session id.
- [ ] **AC-165** *(OV-5)* **Guards:** every §11F.8 row passes; no write, migration, SQL function or repository method added; scoped `tsc` with canary.
- [ ] **AC-166** *(OV-5, manual QA L-89 to L-94)* Open Finance This month with no business picked and compare the two new lines with check 21; pick the owner test account and compare with check 22 in Section 3 and in the summary; set a window from 2026-09-15 and see "Not available"; open the Leak check link; record `durationMs` for This month, a 92-day window and a picked business; record it in the workplan.
- [ ] **AC-167** *(OV-5, E-56)* **Accounts tab:** with `tab=accounts`, neither recorded read is called and the payload has no `aiCost.recorded`. The M-3 tab payload is otherwise unchanged.
- [ ] **AC-168** *(OV-5, E-56, R4-9)* **Exactness per read:**
  - an all-accounts read with `completed` false and fewer rows than the ceiling shows "At least X" and an Unknown difference;
  - the same rows with `completed` true show the figure;
  - a one-account read with `reachedCeiling` true shows "At least X".

### 11F.10 Open questions for SA (M-4)

Technical only. **No business question needs the user**: BD-18 (charged is the business figure, recorded beside it, never added), BD-27 (Health tile kept and renamed) and CR §6 (the two names) decide the scope. The definition of "not charged" (R4-2) is a technical reading of BD-18; SA may reject it, and a per-call definition would then be a business-visible change of scope to raise with the user.

| # | Question | BA suggestion |
|---|---|---|
| **SA-Q51** | OV-1: add the small vocabulary guard (§11F.8), or rely on the updated string pins alone? | Add it: the old words came back once already through new pages (M-1, M-3 labels), and it costs one Jest file in the existing gate |
| **SA-Q52** | The reused reads are inclusive at the end and the Finance window is exclusive: pass `end` less 1 ms from the route, or add an exclusive-end option to the two repositories? | `end` less 1 ms: no repository change; `created_at` rows inside the last millisecond are a negligible edge, and AC-162 pins the behaviour |
| **SA-Q53** | Deadline: the all-accounts read takes an abort signal; the account read does not. Race the account read against the 2 s deadline only, or add a signal option to `listCallsInWindow`? | Race only (the result is dropped past the deadline): a signal option changes the pinned public surface of `TokenUsageRepository` |
| **SA-Q54** | Payload shape: an optional `aiCost.recorded` object (`status`, `recordedUsd`, `recordedExact`, `notCharged` state and value, `chargedAboveUsd`), or a sibling section key? | Inside `aiCost`, because the block narrows with Section 3 and must never travel without the charged figure it sits beside |
| **SA-Q55** | Health tile (BD-27): the footnote names Finance in text (W-22); is a real link to Finance wanted now, or with the Money section (M-5)? | Text now, link in M-5: a link needs a figure or footnote link in `HealthTile`, which is a layout change, not copy |
| **SA-Q56** | Confirm the reading of R4-2 and R4-4: a difference of the two measures, with the deleted bucket left out of the charged side, instead of a per-call match | Yes: the per-call match is the leak check's (CR §11 keeps it unchanged); the difference is stated as one, with its distortions (R4-10) |
| **SA-Q57** | Ship as two PRs (OV-1 short path first, then OV-5 full cycle) under one workplan, or one PR? | Two PRs (§11F.2); FIN 4b may resume after M-3 as planned, since OV-5 does not touch `RevenuePanel`, `CreditsSection` or K-5 |

### SA Requirement Review — M-4 (§11F) — 2026-10-15

**Verdict: ✅ APPROVED WITH CONDITIONS.** The Dev workplan may start after **E-53 to E-57**. SA applied E-53, E-55, E-56 and E-57 below. **E-54 is for the BA.** No business question goes to the user: the difference definition is honest as a difference, so **no per-call scope change is needed** (F-4).

**How it was checked.**

*Live, read-only (a SELECT probe from the main checkout, no writes).*
- `daily_token_usage` and `monthly_token_usage` return exactly the columns of §11F.1. A `feature` select on each fails with **42703, column does not exist**.
- `business_os_usage_summary` is defined once (`20260929_usage_summary.sql`, no later redefinition). It returns `bucket, key, tokens, calls` and takes only `p_since`, so it has **no cost and no end bound**.
- **The BA's claim holds:** neither the views nor the function can give a Business OS USD figure for a window.

*Code (`b20da2cc`).*
- `listCostPointsAllAccountsInWindow`: `gte` / `lte`, paged newest first, de-duplicated, ceiling 10,000, signal checked between pages, AdminReadContext required. Its isolation guard allows only `app/api/admin/**`.
- `listCallsInWindow`: `.eq('user_id', userId)` with a UUID assert, `gte` / `lte`, ceiling at most 5,000, no signal, de-duplicated. Its only completeness flag is `reachedCeiling`.
- **The finance guard gap is real.** `finance.source.guard.test.ts:146` matches `TokenUsageRepository` case-sensitively, so it misses `AdminTokenUsageAnalyticsRepository` and the `tokenUsageRepository` instance name.
- `bosRowFilter()` gives prefix `business-os` plus the five legacy values, matching checks 21 and 22.
- The finance window is half-open UTC (`financeWindow.ts`).

**Findings**

| # | Severity | Finding | Fix |
|---|---|---|---|
| F-1 | **High** | **"At its ceiling" is the wrong exactness test for the all-accounts read.** It de-duplicates, so a read that stops on the ceiling page can return fewer than 10,000 rows and still not be complete. `reachedCeiling` (`!completed && rows >= ceiling`) is then false, and the figure would print as exact. The Health tile already uses `completed` for this (C-1, `windows.ts:126`). | **E-53 (applied)**: R4-9 now defines exactness per read. |
| F-2 | **High** | **The M-3 AC-145 Overview baseline trips.** `route.test.ts` pins every read call, the top-level keys and the SHA-256 of the Overview payload. OV-5 adds one read and `aiCost.recorded` to that payload, and §11F.8 does not list it. | **E-55 (applied)**: a §11F.8 row. The baseline is updated **once, in OV-5, by this ruling**. |
| F-3 | Medium | **One label, two different figures.** OV-1 gives the Leak check's per-call matched figure the label "Recorded, not charged" (W-16), and OV-5 gives Finance's net difference the same label. For one account and overlapping days the two can differ, and an admin reading both will think one is wrong. The difference must carry its own name. | **E-54 (BA)**, below. |
| F-4 | — (SA-Q56) | **The difference is honest, and no per-call match is required.** Both measures are priced from the same price table at the moment of the call. Deleted accounts are removed from both sides (the usage rows cascade; the ledger bucket is excluded). Platform-account and no-account rows are in both totals the same way. The remaining distortions are named in R4-10: netting across accounts, the window edge and fallback over-charges. Each makes the figure **lower**, never invented. The all-accounts read returns no `user_id`, so a per-account positive sum is impossible without a new read, and it is not needed. | Approved, provided the figure is named as a difference (F-3). |
| F-5 | Medium | **No AC covers the Accounts tab.** M4-FR-5 says `aiCost.recorded` is absent there, but nothing proves that no recorded read runs on the tab. | **E-56 (applied)**: AC-167 and AC-168. |
| F-6 | Low | **The late account read needs handling.** It cannot be aborted (SA-Q53), so a timed-out read keeps paging (at most 5 pages) after its result has been dropped. | **E-57 (applied)**: M4-FR-8 wording. |
| F-7 | Low | **`TokenUsageRepository`'s caller list is a header comment only.** It is already stale: it omits the drawer summary route, the leak check deps and the entitlements report. The repository is still tenant-safe by signature (account id required, `.eq('user_id')`). | The workplan amends the header to the **full** caller list, including the finance route, with the reason. No new guard in this step. |
| F-8 | — | **ACs AC-150 to AC-166 are testable** as written: AC-153 and AC-166 manually, the rest by unit, route or source tests. | — |
| F-9 | — | **Checks 21 and 22 pass the style rules:** ASCII only, no apostrophe in any comment, no "into", one final result set each. Both use a UTC month, like the window, and the same row filter as `bosRowFilter()`. | QA runs them at test time. |

**Rulings**

- **SA-Q51: approved, with a narrow guard.**
  - It scans **string literals and JSX text only** in the §11F.4 files. It never scans identifiers, `data-testid` values, metric names or rule ids, so `spend24h`, `bos_ai_spend` and `strip-ai-spend` stay legal.
  - The forbidden phrases are "estimated", "provider-side", "measured cost", "measured price", "Cost Analytics", "AI spend", "Total spend" and "Uncharged spend".
  - Each file is pinned by a non-vacuity count, and a planted control must fail.
  - An exception needs an explicit allow-list entry with a reason.
- **SA-Q52: `end` less 1 ms, approved.**
  - The two repositories stay unchanged.
  - Only the last millisecond is lost (sub-millisecond `created_at` values there), which is negligible against a 5-minute charge lag.
  - AC-162 pins the behaviour, and the route test asserts the exact ISO value passed.
- **SA-Q53: race only, approved** (E-57).
- **SA-Q54: inside `aiCost`, approved.** `aiCost.recorded` is optional and absent when not built. It holds `status`, `recordedUsd`, `recordedExact`, the difference state and value, and `chargedAboveUsd`. No field holds a sum of the two measures (pinned).
- **SA-Q55: text now, link in M-5, approved.**
- **SA-Q56: approved as a difference** (F-4), named as one (F-3).
- **SA-Q57: two PRs under one workplan, approved.**
  - OV-1 goes first, on the short path for copy: SA review and QA, then the user's diff view.
  - OV-5 follows on the full cycle.
  - The estimates of about 1 + 2 days are accepted. OV-5 includes the baseline update (F-2).

**E-edits**

- **E-53 (applied, R4-9).** Exactness is defined per read:
  - all accounts: exact only when the read **completed** on a short page (the Health tile's C-1 rule);
  - one account: exact when `reachedCeiling` is false. The insert-during-read edge is accepted, the same as the Businesses drawer's figure.
- **E-54 (BA).** On Finance only, rename the figure **"Recorded, not charged" to "Recorded above charged"**:
  - the sub-label begins "Recorded AI cost minus charged AI cost";
  - "None" and "Charged is USD X above recorded" are kept.

  Apply it in the §11F title and intro, R4-2, R4-5, R4-6, R4-9, R4-10, M4-FR-1 to M4-FR-3, AC-154 to AC-161 and the §0 rows. **W-16 (Leak check) keeps "Recorded, not charged"**, because that figure is per call. The SQL column names stay. R4-10's closing sentence becomes: "Recorded above charged is not 'not charged' call by call; the Leak check matches calls."
- **E-55 (applied, §11F.8).** The AC-145 baseline row.
- **E-56 (applied, §11F.9).** AC-167 (the Accounts tab) and AC-168 (exactness).
- **E-57 (applied, M4-FR-8).** The race rule.

---

## 11G. Finance shell on the Admin Layout Standard (F-2, F-4, F-5)

This is **DF-4 / Money M-6**. On 2026-10-15 the admin-layout session reviewed /admin/finance against [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) §5, and the user approved six slices. F-0 (#414) and F-1 (#418) are merged, and F-3 (#420) is open; those three are tracked in [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md). **F-2, F-4 and F-5 are owned by the finance stream** and are specified here. User decisions: BD-28 to BD-31.

### 11G.1 Rules for all three slices

- No data, money or API change. The figures, payload and route stay as they are.
- Keep the merged F-1 and F-3 work intact: the contrast guard entry for `app/admin/finance`, the `ADMIN_*` table constants, `StatusChip` on `FinanceSection`, `useFinanceData`'s `readAdminResponse` and `clientLogger`, and the `aiCostVocabulary` floor of 28 for `AiCostSection`.
- Small numbered PRs, each merged before the next starts: F-2, then F-4, then F-5.
- After each PR the user owes a read-only browser look at /admin/finance.

### 11G.2 Scope

| Slice | Path and size | Scope |
|---|---|---|
| **F-2** Header and states | UI short path, about 1 day | `AdminPageHeader` with the title "Finance" (BD-28), the purpose line and asOf. `AdminLoading`, `AdminError` with Try again, and `AdminNotice`. `aria-busy` while a refresh runs. The data is still cleared on failure. SA cleanup carried over from F-3: remove `useFinanceData`'s unreachable second parameter `fallbackError` and the `PAGE_LOAD_FAILED` argument in `FinanceView` (needs #420 merged). Refresh may stay as a header action until F-4; this is a recorded deviation. |
| **F-4** Filter bar and URL state | Full cycle, about 2 days | `AdminFilterBar` with `windowControl` (`DatePresets` / `adminWindow`, `requireBothDates`), business = `AdminBusinessPicker`, `onClear`, chips and help. Refresh and Read-at move into the bar. `FinanceActiveChip` and the local presets are deleted; the preset labels become the standard ones and Custom becomes a real button. `useAdminFilters` with canonical keys `range` / `from` / `to` / `account` and aliases `preset` / `accountId` (U-9); old links from `BusinessOsPanel.tsx` and `financeLinks.ts` keep working. `tab`, `sort`, `group` and `show` stay page keys (SA-Q44). A bad link drops only the bad filter (U-4, BD-30). `serialiseFinanceUrl` is kept as the **API serialiser only**: the page's request to the finance route and the route's Zod schema stay byte-identical, pinned by a test written first. Recorded page deviations (SA-WP-F4, E-61): the window keeps only two whole dates the route accepts (`to` not after today UTC, at most 92 days); a minute or instant bound, a one-sided window or a refused window falls back to This month, as on Analytics and Activity (SA-W6). A custom window the route would refuse is not applied on Apply; its sentence shows under the bar (SA-W5). `tab`, `sort`, `group` and `show` are fields of the page's one filter spec, so each change is one write (SA-W2). |
| **F-5** KPI tiles | Full cycle, about 2 days | Extend the shared `KpiTile` / `KpiStrip` in `app/admin/components/layout/`: statuses green (reusing `StatusChip`'s single green constant, S-7), `not_measured` and `unavailable`; a tile with no value; an optional second line (or "headline" folded into sub). Finance then uses `KpiStrip`; `FinanceKpiStrip` is deleted or slimmed and stops importing Health's `STATUS_STYLES`. Tiles sit above the filter bar on both tabs (BD-29) and each jumps to its own section; "Charged AI cost" opens AI cost & usage (BD-31). Finance's C-14 entry is added to the `layoutFolder` guard registry. Display only: no money, calculation or request change. K-1's link carries the tile's own period, This month (UTC), and the business when one is picked, not the page window (SA-W7). AI cost & usage shows the recorded AI cost, so its figure is at or above the tile's charged figure; Section 3's "Recorded above charged" explains the gap. On the Accounts tab a tile opens Overview at its section (SA-W3). Neutral tiles show no status row (K-4, SA-W1) (E-62). |

**What the user will see change:** the h1 reads "Finance"; the preset labels read "7 days" and "30 days" (the standard labels) and Custom is a real button; the KPI tiles sit above the filter bar and are clickable.

### 11G.3 Acceptance criteria

- [ ] **AC-169** *(F-2)* The page renders `AdminPageHeader` with h1 "Finance", the purpose line and asOf; no other h1 is on the page.
- [ ] **AC-170** *(F-2)* First load shows `AdminLoading`; a failed load shows `AdminError` with Try again, the previous data is cleared, and Try again reloads.
- [ ] **AC-171** *(F-2)* While a refresh runs the content region has `aria-busy="true"`, and `false` after it ends.
- [ ] **AC-172** *(F-2)* `useFinanceData` takes no `fallbackError` parameter and `FinanceView` passes no `PAGE_LOAD_FAILED` argument; the F-1 and F-3 guards (contrast entry, table constants, `StatusChip`, `readAdminResponse`, `clientLogger`, the `aiCostVocabulary` floor of 28) pass unchanged.
- [ ] **AC-173** *(F-4, written first)* **Byte-identical request:** for a fixed set of page states (each preset, Custom from/to, a picked business, `tab=accounts` with `sort` / `group` / `show`), the request URL the page sends to the finance route is byte-identical before and after F-4, and the route's Zod schema is unchanged. The test is committed before the migration and passes on both sides. "Page states" are the states a valid link or an in-page choice reaches; for those the request is byte-identical. Four kinds of link now read differently, by decision, and so change their request on purpose: one bad value next to good ones (BD-30); a business together with `tab`, or `sort` / `group` / `show` without the tab (BD-30 per key); `from` / `to` with no range (U-7 implied custom); a repeated key (first value wins). Each is pinned with its new request literal (SA-WP-F4, F4-R1). The pin test is written and run green on the unchanged tree first; it may land in the same PR (E-60).
- [ ] **AC-174** *(F-4)* Canonical keys `range`, `from`, `to` and `account` are written to the page URL; links using `preset` and `accountId` (from `BusinessOsPanel.tsx` and `financeLinks.ts`) open the same view.
- [ ] **AC-175** *(F-4)* A link with one bad value (unknown range, bad date, bad account id) drops only that filter; the others are kept; no notice is shown and nothing else is reset (BD-30).
- [ ] **AC-176** *(F-4)* `tab`, `sort`, `group` and `show` behave as before (SA-Q44).
- [ ] **AC-177** *(F-4)* `FinanceActiveChip` and the local presets are deleted; the bar shows the standard labels ("7 days", "30 days"), Custom is a button, chips and Clear work, and Refresh and Read-at sit in the bar.
- [ ] **AC-178** *(F-5)* The shared `KpiTile` supports green (the `StatusChip` green constant, S-7), `not_measured`, `unavailable`, a tile with no value and an optional second line; existing users of `KpiStrip` render unchanged.
- [ ] **AC-179** *(F-5)* Finance renders the shared `KpiStrip` above the filter bar on Overview and on the Accounts tab; nothing in `app/admin/finance` imports Health's `STATUS_STYLES`.
- [ ] **AC-180** *(F-5)* Each tile jumps to its own section; "Charged AI cost" opens AI cost & usage.
- [ ] **AC-181** *(F-5)* Every tile value and status equals the value before F-5 for the same fixture (display only); the Finance C-14 entry is in the `layoutFolder` guard registry and the guard passes.
- [ ] **AC-182** *(all)* No file under `lib/` or `app/api/` changes, and no migration.
- [ ] **AC-183** *(all, manual)* After each PR the user takes a read-only browser look at /admin/finance.

---

## 11H. Money M-5: the Money section

Specified 2026-10-16 from CR §1, §5.1, the M-5 row of §8, SA-Q-4, BQ-1, BQ-6 and BQ-10; from BD-21, BD-24 and BD-27; from FU-M4-1 (§0.4) and SA-Q55; and from the code at main `98735db9` (every item below was re-checked there; citations are `path:line` at that commit). Nothing was checked in a browser or against the database. **UI short path, about 2 days. No data, money, API route, read or migration change.**

### 11H.0 Sign-off for the sidebar change

The Admin Layout Standard treats the sidebar as fixed: its sections, their order, the pages inside them and their labels (LAY §2.3 X-1, X-2; §3 rule 9). Moving pages between sections therefore needs the user. **That sign-off was given on 2026-10-14**, when the user accepted CR BQ-1 (one Money section holding Finance and the detailed AI calls page, Finance first, nothing with buttons; BD-21) and CR BQ-6 (Costs & credits moves into Money as "Charge checks"; BD-24). M-5 is the recorded exception to LAY X-1, X-2 and rule 9 for exactly the moves in §11H.2; any other sidebar change still needs the user. Under BD-33, M-5 proceeds on SA, QA and TL approval with no further user step.

### 11H.1 Code facts (re-verified at `98735db9`)

| # | Fact | Evidence |
|---|---|---|
| CF-1 | Monitor holds Health, Finance, AI cost & usage, Scheduled jobs & queues, Audit trail, Archiving; Settings holds Business OS AI ("Models, temperatures & costs"), Model pricing, Admin users | `app/admin/components/AdminSidebar.tsx:83-128`, `:167-198` |
| CF-2 | The active entry is an **exact** pathname match, so a nested route highlights no entry unless it is listed itself | `AdminSidebar.tsx:379` |
| CF-3 | The nav test pins section order and the Monitor list, and its "every page reachable" scan reads only `app/admin/<dir>/page.tsx` (one level), so a nested route listed in the sidebar must be allowed for explicitly; it pins 28 hrefs | `app/admin/components/__tests__/AdminSidebar.nav.test.ts:85-119`, `:71-79`, `:158-166` |
| CF-4 | The Business OS AI nav test pins exactly one sidebar match for `/admin/business-os-llm` and the description "Models, temperatures & costs" | `app/admin/business-os-llm/__tests__/nav.test.ts:21-24`, `:37-47` |
| CF-5 | Business OS AI has three tabs, Settings, Costs & credits, Activity; `?tab=` is read once on load; Costs and Activity are coordinated in one address bar (L-9a) | `app/admin/business-os-llm/page.tsx:121-139`, `:155-162`, `:82-93`, `:313-319` |
| CF-6 | The **Leak check lives inside the Costs & credits tab**, so it moves with it | `components/costs/CostsTab.tsx:245` (`LeakCheckPanel`) |
| CF-7 | `CostsTab` takes `active` with default `true` and owns `range`, `from`, `to`, `account` through `useAdminFilters`; `tab` is not one of its keys | `CostsTab.tsx:70-71`; `costsFilters.ts:5-7`, `:41-44` |
| CF-8 | **Every in-app link to the Costs tab** is in `financeLinks.ts`: `costsHref` (account summary, `AccountSummary.tsx:187`) and `leakCheckHref` (Section 3 "Leak check", `RecordedCostLines.tsx:90`). No other app, lib or component file links to `?tab=costs`. Text-only mentions: `activityCopy.ts:99-101` (platform-account error) and the `/test-business-os` harness (`components/test-business-os/llm-usage/CheckPanels.tsx:286`) | `financeLinks.ts:50-64`, `:113-118` |
| CF-9 | AI cost & usage's h1 is "AI cost & usage" and must equal the sidebar label (LAY D-3 (a)); outside that page the name appears as visible copy in 8 strings | `app/admin/analytics/page.tsx:289`; §11H.5 |
| CF-10 | The Health "Recorded AI cost (USD)" tile's figures already link to AI cost & usage; its footnote names Finance in text only; it has **no page link**, although `HealthTile` already renders one (`tilePageLink` gives one only to entitlements and jobs tiles). SA-Q55's "layout change" concern does not arise: the slot exists | `lib/admin/health/evaluateHealth.ts:410-413`, `:655-662`, `:679-683`, `:734-738`; `app/admin/components/health/HealthTile.tsx:138-147` |
| CF-11 | FU-M4-1 strings: metric labels and two rule descriptions say "spend"; the leak-check cron description and one count label say "AI spend". **No test asserts these strings**: the rule tests assert rule ids (`route.qa-edge.test.ts:221-255`) or read `rule.description` back (`evaluateHealth.test.ts:263-267`), and `rules.config.test.ts:4` says a description edit needs no test edit. Only three **test titles** in `route.qa-edge.test.ts:234-246` say "24 h spend" | `lib/admin/health/rules.ts:73-76`, `:225`, `:232`; `lib/cron/bosCronJobs.ts:452`, `:459` |
| CF-12 | The vocabulary guard deliberately skips `rules.ts` until M-5 (its header) and does not scan `bosCronJobs.ts`; its forbidden list includes "AI spend" | `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts:22-23`, `:35-50`, `:54-63` |
| CF-13 | Redirect precedent: `next.config.js` `redirects()`, temporary (not cached forever) | `next.config.js:66-79` |

### 11H.2 Scope

| In | Out |
|---|---|
| A **Money** sidebar section, placed after Monitor, holding Finance (first), Charge checks, AI calls & usage (detail) (§11H.3) | Activity stays in Business OS AI (CR §1: link only) |
| A new page **Charge checks** at `/admin/finance/charges` that mounts today's `CostsTab` (Leak check included) as it is, under the standard header (§11H.4) | Anything with action buttons moving into Money (BD-21, NG-1): Businesses, Model pricing, Jobs stay where they are |
| The Costs & credits tab removed from Business OS AI; its old links land on Charge checks with their window and business (§11H.4) | Any change to the cost report, the Leak check, their routes or their reads |
| Business OS AI's description drops "costs"; the AI calls page relabelled (sidebar and h1) and its name updated where other admin pages show it (§11H.5) | Any data, money, API route, payload shape or migration change |
| FU-M4-1 wording: Health rule descriptions and metric labels, the leak-check cron description and count label (wording only; no rule id, threshold, metric id or cron key changes) | Moving the `components/costs/*` files out of `app/admin/business-os-llm/` (default; SA-Q59) |
| The Health "Recorded AI cost" tile gains a page link to Finance (SA-Q55) | The `/test-business-os` harness text (CF-8); historical workplans that cite `?tab=costs` |

**Estimate:** about 2 days (sidebar, nav tests and redirect 0.5 day; Charge checks page and Business OS AI tab removal 0.75 day; strings, Health link, guards 0.5 day; QA 0.25 day).

### 11H.3 Sidebar, before and after

| Section | Before (`98735db9`) | After (M-5) |
|---|---|---|
| **Monitor** | Health · Finance · AI cost & usage · Scheduled jobs & queues · Audit trail · Archiving | Health · Scheduled jobs & queues · Audit trail · Archiving |
| **Money** (new, after Monitor) | — | **Finance** (`/admin/finance`, description unchanged "Revenue, AI cost and credits, Business OS") · **Charge checks** (`/admin/finance/charges`, new) · **AI calls & usage (detail)** (`/admin/analytics`, href unchanged) |
| **Businesses** | Businesses · Plans & entitlements · Signup Invites · Messages | Unchanged |
| **Settings** | Business OS AI ("Models, temperatures & costs") · Model pricing · Admin users | Business OS AI ("Models, temperatures & AI activity") · Model pricing · Admin users |
| **AgentsPilot (parked)** (hidden) | 15 items | Unchanged (M-8 handles two of them, BD-34) |

Section order after: Monitor, **Money**, Businesses, Settings, AgentsPilot (parked). Icons are ones the sidebar already imports (Dev's choice). Charge checks is a sidebar entry of its own (BA default) because it is its own route and the sidebar highlights by exact path (CF-2); the alternative is a link from Finance only (SA-Q58).

### 11H.4 Routes and links, old and new

| # | Old | New | How old links land |
|---|---|---|---|
| R-1 | `/admin/business-os-llm?tab=costs` (with any of `range`, `from`, `to`, `account`) | `/admin/finance/charges` with the same `range`, `from`, `to`, `account` | A **temporary** redirect in `next.config.js` `redirects()` matching the path with the query `tab=costs` (precedent CF-13). Query values pass through, so the window and business arrive; the stray `tab=costs` is not a Charge checks key and is ignored (SA-Q60 on dropping it) |
| R-2 | `/admin/business-os-llm` with no `tab`, `tab=settings` or `tab=activity` | Unchanged | Not redirected. An unknown `tab` (now including `costs` if R-1 were bypassed) opens Settings, as today (`page.tsx:141-144`) |
| R-3 | `costsHref` → `/admin/business-os-llm?tab=costs&range…&account=…` (account summary link) | `/admin/finance/charges?range…&account=…` (same window keys, no `tab`) | Changed at the source; R-1 covers bookmarks |
| R-4 | `leakCheckHref` → `/admin/business-os-llm?tab=costs[&account=…]` (Section 3 "Leak check") | `/admin/finance/charges[?account=…]` (still no window, as SA-W99 ruled) | Changed at the source |
| R-5 | — | Health "Recorded AI cost" tile **page link** → `/admin/finance` (Finance's default window, This month; SA-Q55). The tile's two figure links keep going to AI calls & usage with their own windows | New |
| R-6 | Sidebar AI cost & usage → `/admin/analytics` | Same href, under Money | Unchanged URL |

Charge checks page rules:

- **CC-1** `app/admin/finance/charges/page.tsx`, a client page inside a Suspense boundary (the finance source guard), gated by the admin layout like every admin page; no `route.ts` under `app/admin`.
- **CC-2** `AdminPageHeader` with h1 **"Charge checks"** (= sidebar label, LAY D-3 (a)), the "Read-only" badge, and the purpose line `COSTS_INTRO` (unchanged words).
- **CC-3** It renders `<CostsTab />` with no `active` prop (default `true`, CF-7): there is no other tab to coordinate, so no L-9a code is copied (CR SA-Q-4).
- **CC-4** The report request, the Leak check request, the default window (30 days) and every figure are unchanged: a pin test compares the report URL the tab sends for a fixed set of URL states before and after (same idea as AC-173).
- **CC-5** Business OS AI keeps Settings and Activity. `TABS`, `PURPOSE`, `TAB_KEYS` and the costs panel lose their `costs` entries; the L-9a coordination stays as it is, now with one filter tab (BA default; simplifying it is SA-Q61).

### 11H.5 Strings, old and new

Copy only. Every row keeps its testid, key and href unless the row says otherwise.

| # | Where | Old | New |
|---|---|---|---|
| S-1 | Sidebar name, `/admin/analytics` (`AdminSidebar.tsx:103`) | `AI cost & usage` | `AI calls & usage (detail)` (CR §1, §5.1) |
| S-2 | Sidebar description, same entry (`:106`) | `Token spend, both products` | `Every AI call and its recorded cost, both products` |
| S-3 | Sidebar, new entry | — | name `Charge checks`; description `Charged AI cost checked per account, Business OS` |
| S-4 | Sidebar description, Business OS AI (`:179`) | `Models, temperatures & costs` | `Models, temperatures & AI activity` |
| S-5 | AI calls page h1 (`analytics/page.tsx:289`) | `AI cost & usage` | `AI calls & usage (detail)` (= S-1, LAY D-3 (a); SA-Q62) |
| S-6 | Charge checks h1 (new page) | (tab label `Costs & credits`, `costCopy.ts:6`) | `Charge checks`; the now-unused `COSTS_TAB_LABEL` is removed or renamed |
| S-7 | Finance links to the AI calls page: `AI_LINK` (`financeCopy.ts:217`), `ACCOUNT_LINK_ANALYTICS` (`:527`) | `AI cost & usage` | `AI calls & usage` |
| S-8 | Finance account summary link `ACCOUNT_LINK_COSTS` (`financeCopy.ts:526`) | `Business OS AI Costs & credits` | `Charge checks` |
| S-9 | Activity cut-over notice (`activityCopy.ts:75`, `:81`) | `… or the recorded AI cost in AI cost & usage.`; link `AI cost & usage (Business OS, recorded)` | `… or the recorded AI cost in AI calls & usage.`; link `AI calls & usage (Business OS, recorded)` |
| S-10 | Activity platform-account error (`activityCopy.ts:101`) | `… counted by the leak check on the Costs & credits tab.` | `… counted by the Leak check on Charge checks.` |
| S-11 | Businesses drawer link (`BusinessOsPanel.tsx:397`) | `Open in AI cost & usage` | `Open in AI calls & usage` |
| S-12 | Health tile note, figure link label, footnote (`evaluateHealth.ts:66`, `:662`, `:681`) | `AI cost & usage …` (3 places) | `AI calls & usage …` (same sentences otherwise) |
| S-13 | Health tile page link (new, R-5) | — | `Charged AI cost: open Finance` |
| S-14 | Health metric labels (`rules.ts:73-76`) | `24 h spend` · `previous 24 h spend` · `7-day spend` · `previous 7-day spend` | `24 h recorded AI cost` · `previous 24 h recorded AI cost` · `7-day recorded AI cost` · `previous 7-day recorded AI cost` |
| S-15 | Health rule descriptions (`rules.ts:225`, `:232`, `:239`) | `Spend tripled vs yesterday` · `Spend doubled vs yesterday` · `Week up 50% or more` | `Recorded AI cost tripled vs yesterday` · `Recorded AI cost doubled vs yesterday` · `Recorded AI cost up 50% or more on the week`. `Over $20 in the last 24 hours` and `Total is a minimum; not all calls counted` stay |
| S-16 | Jobs page cron description (`bosCronJobs.ts:452`) | `Checks that yesterday's Business OS AI spend was all charged` | `Checks that yesterday's recorded Business OS AI cost was all charged` |
| S-17 | Jobs page cron count label (`bosCronJobs.ts:459`) | `businesses with uncharged AI spend` | `businesses with recorded AI cost not charged` |
| S-18 | AI calls page bar and state noun `ANALYTICS_WHAT` (`AnalyticsFilterBar.tsx:49`; "Reading …", the error fallback) | `AI cost and usage` | `AI calls and usage` (SA-W7, E-63) |

S-14 to S-17 close FU-M4-1. Rule ids (`spend.*`), thresholds, factors, floors, metric ids (`spend24h` and the rest), the tile id `bos_ai_spend` and the cron key `accountsWithLeak` do not change.

### 11H.6 Guards and tests affected

| Guard or test | Change |
|---|---|
| `AdminSidebar.nav.test.ts` | Section order gains Money after Monitor; Monitor list loses Finance and analytics; new Money list `/admin/finance`, `/admin/finance/charges`, `/admin/analytics` in that order; the "every page reachable" check allows the one nested listed route explicitly (CF-3); href count 28 → 29; a pin that Finance is first in Money and that no Money entry is an action page |
| `business-os-llm/__tests__/nav.test.ts` | Description pin → `Models, temperatures & AI activity`; "exactly one match" stays green |
| `business-os-llm` page tests (`page.render`, `tabCoexistence.render`, `costsLayout.render`, `costsTab.render`, `leakPanel.render`, `settingsLayout.render`, `activityLayout.render`, `source.guard`) | Two tabs, not three; the costs and leak render tests mount `CostsTab` standalone or move to the Charge checks page's tests; coexistence is re-scoped to Settings and Activity. `tabCoexistence`: X-4 to X-11 kept, with X-8, X-8b and X-10 re-scoped to Activity ↔ Settings (the L-9a lag-window behaviour still exists); only X-1, X-2, X-3 and X-12 and `costsTab.render` "switching tabs keeps the chosen window" are deleted, because they need two filter tabs (SA-WP-M5, M5-R1, E-64) |
| Charge checks page tests (new, `app/admin/finance/__tests__/`) | h1, badge, purpose; `CostsTab` mounted active; the CC-4 request pin, written and run green on the old tree first; Leak check present |
| Redirect test (new) | `next.config.js` `redirects()` holds the R-1 entry, temporary, matching `tab=costs` only |
| `financeLinks.test.ts`, `financeAccount.render.test.tsx`, `recordedCost.render.test.tsx`, `financePage.render.test.tsx` | `costsHref` and `leakCheckHref` parse back against `COSTS_FILTER_SPEC` at the new path with no `tab`; S-7, S-8 link texts |
| `layoutFolder.guard.test.ts` C-14 `MIGRATED_PAGES` | **New entry** `/admin/finance/charges (Charge checks)` with `app/admin/finance/charges/page.tsx` and the five `components/costs/*` files plus `costsFilters.ts`; those six leave the Business OS AI entry (`:681-685`, `:661`), so each file is listed once |
| `contrast.lf1.source.guard.test.ts` | Finance's `walk('app/admin/finance')` picks up the new page by itself; the `components/costs/*` files are not contrast-guarded today (only Activity is, `:60`); adding them under a "Charge checks" key is SA-Q63 |
| `aiCostVocabulary.source.guard.test.ts` | Header note "skipped until M-5" removed; `lib/admin/health/rules.ts`, `lib/cron/bosCronJobs.ts` (S-16, S-17 entries only, or the whole file if it passes) and the Charge checks page added to `FILES` with their `MIN_TEXTS` floors; S-5 to S-12 pinned rows updated; forbidden list unchanged, `ALLOWED` stays empty |
| Health rule tests (`lib/admin/health/__tests__/*`, `app/api/admin/health-summary/__tests__/route.qa-edge.test.ts`, `app/admin/__tests__/health.render.test.tsx`) | **No assertion changes** (CF-11). Optional: the three `route.qa-edge` test titles that say "24 h spend". New assertions: the `bos_ai_spend` tile's `pageLink` is R-5, and every other tile's page link is unchanged |
| `analytics` tests (`analytics.layout.render` and the others that read the h1) | h1 `AI calls & usage (detail)` |
| `evaluateHealth.test.ts`, `health.render.test.tsx` | S-12 texts where pinned |
| Jobs tests (`jobsQueues.*`, `lib/admin/jobs/__tests__/*`) | **No change expected**: none pins S-16 or S-17 (verified by search); the Jobs view renders the new words |
| `npm run test:authz-guard`, `test:bos-entitlements` | Run, expected unchanged (no route, no entitlements import) |

### 11H.7 Acceptance criteria

- [ ] **AC-184** The sidebar shows, in order, Monitor, Money, Businesses, Settings; Money holds exactly Finance, Charge checks, AI calls & usage (detail), Finance first; Monitor holds Health, Scheduled jobs & queues, Audit trail, Archiving.
- [ ] **AC-185** No page whose main job is an action (Businesses, Model pricing, Scheduled jobs & queues, Signup Invites) is in Money.
- [ ] **AC-186** Business OS AI's sidebar description is `Models, temperatures & AI activity` and contains no "cost".
- [ ] **AC-187** `/admin/finance/charges` renders the h1 "Charge checks", the Read-only badge and the `COSTS_INTRO` purpose line, then today's cost report and the Leak check; the sidebar highlights Charge checks there.
- [ ] **AC-188** For the same URL state, the report request Charge checks sends is byte-identical to the one the Costs & credits tab sent before M-5 (CC-4 pin, written first); the Leak check request is unchanged.
- [ ] **AC-189** Charge checks reads on first load without any other tab being chosen (`CostsTab` active), and a change of window or business writes `range`, `from`, `to`, `account` to its own URL.
- [ ] **AC-190** Business OS AI shows two tabs, Settings and Activity; no Costs & credits tab, panel or purpose line remains; Activity's filters and URL behave as before.
- [ ] **AC-191** Opening `/admin/business-os-llm?tab=costs&range=7d&account=<id>` lands on `/admin/finance/charges` showing 7 days and that business; `?tab=costs` alone lands on Charge checks with its default window. The redirect is temporary.
- [ ] **AC-192** `/admin/business-os-llm`, `?tab=settings` and `?tab=activity` are not redirected and open as before.
- [ ] **AC-193** Finance's account summary link (S-8) and Section 3's Leak check link go straight to `/admin/finance/charges` with the window and business as before (R-3, R-4), and no in-app link to `?tab=costs` remains under `app/`, `lib/` or `components/`.
- [ ] **AC-194** The AI calls page h1 and its sidebar label both read `AI calls & usage (detail)`; its URL and content are unchanged.
- [ ] **AC-195** Every string in §11H.5 S-1 to S-18 reads as its "New" column; no other visible string changes.
- [ ] **AC-196** The Health "Recorded AI cost (USD)" tile shows a page link `Charged AI cost: open Finance` to `/admin/finance`; its two figure links still open AI calls & usage with their own windows; no other tile's page link changes.
- [ ] **AC-197** Health rule ids, colours, priorities, thresholds, factors, floors and metric ids are unchanged; for the same inputs every tile's status and matched rule id equal those before M-5.
- [ ] **AC-198** The leak-check cron's key, path, schedule and count keys are unchanged; only S-16 and S-17 change.
- [ ] **AC-199** The vocabulary guard scans `rules.ts`, the S-16 and S-17 strings and the Charge checks page, and passes with `ALLOWED` empty.
- [ ] **AC-200** The C-14 registry lists `/admin/finance/charges (Charge checks)` and the costs files once each, and the guard passes; the contrast and finance source guards pass.
- [ ] **AC-201** No API route, repository, read, payload shape (other than the Health tile's `pageLink` value), migration or money calculation changes; `test:authz-guard` and `test:bos-entitlements` pass unchanged.
- [ ] **AC-202** `/admin/finance/charges` is admin-only through the admin layout, like every admin page (a non-admin is refused as on `/admin/finance`).
- [ ] **AC-203** *(manual)* The user's read-only browser look L-128 to L-136 (BD-33: after merge, no approval step).

Manual QA (read-only, after merge): **L-128** sidebar sections and order; **L-129** Money order and labels; **L-130** Charge checks loads, report and Leak check visible; **L-131** an old `?tab=costs&range=7d&account=…` bookmark lands on Charge checks with that window and business; **L-132** Business OS AI shows Settings and Activity only; **L-133** Finance's "Charge checks" and "Leak check" links; **L-134** AI calls & usage (detail) h1; **L-135** Health tile page link to Finance and the reworded rule list; **L-136** Jobs page leak-check row wording.

### 11H.8 Open questions for SA (M-5)

Technical only. **No business question needs the user**: BD-21, BD-24 and BD-27 decide the scope, and the sidebar sign-off is recorded in §11H.0.

| # | Question | BA's suggested answer |
|---|---|---|
| **SA-Q58** | Is Charge checks its own Money sidebar entry, or reached only from Finance (a tab-like link beside Overview and Accounts)? | Its own entry: it is its own route, and the sidebar highlights by exact path (CF-2). CR §5.1 calls it a Finance entry; the sidebar entry sits directly under Finance |
| **SA-Q59** | Do the `components/costs/*` files, `costsFilters.ts`, `costCopy.ts`, `costFormat.ts`, `costTypes.ts`, `leakCopy.ts` and `leakTypes.ts` stay in `app/admin/business-os-llm/` and get imported by the new page, or move under `app/admin/finance/charges/`? | Stay (CR: "mounted on a new route as they are"); a move is a later clean-up. If they stay, the Business OS AI source guard (no `@/lib/`) keeps covering them, and the finance source guard covers the page |
| **SA-Q60** | Old links: `next.config.js` redirect (the stray `tab=costs` passes through, harmless), middleware, or a client `router.replace` in the Business OS AI page? | `next.config.js`, temporary (CF-13); the stray key is ignored. A client redirect would load Business OS AI first |
| **SA-Q61** | With one filter tab left, keep the L-9a coordination in `business-os-llm/page.tsx` as it is, or simplify it? | Keep it, minus the `costs` entries (CR SA-Q-4: not a new pattern; smallest diff) |
| **SA-Q62** | The h1 must equal the sidebar label (LAY D-3 (a)). Is "AI calls & usage (detail)" acceptable as an h1, or should the label drop "(detail)" in both places? | Keep CR's label in both; links elsewhere say "AI calls & usage" (S-7, S-9, S-11, S-12) |
| **SA-Q63** | Add the `components/costs/*` files to the contrast guard under a "Charge checks" key now? | Yes, if they pass unchanged; otherwise record the failures as follow-ups and do not fix them in M-5 (a layout fix is not this slice) |
| **SA-Q64** | The Health tile page link (R-5): Finance with no window (This month), or carry the tile's last-7-days window? | No window: Finance's default is This month, and the tile's own figures keep their windows through their links to AI calls & usage |

**SA-Q-4 (CR) answered by this spec:** mounting `CostsTab` on its own route is not a new pattern; it needs no tab coordination, and its default `active` is `true` (CF-7). SA to confirm.

---

## 11I. Slice 4b: boost refund dates, boost problems, bought credits

Specified 2026-10-17 by BA from §11C (4b outline, S4-FR-15 to S4-FR-22), **BD-17** and its dispute defaults, DF-5, BD-9, BD-12, BD-14, BD-32, BD-33, BQ-13, the refund-timing scoping ([BUSINESS_OS_FINANCE_HEALTH_REFUND_TIMING_SCOPING.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REFUND_TIMING_SCOPING.md), option (ii), cited as **RT**) and a fresh pre-work check against main `16cb2a1f` and the live database (2026-10-17, read-only; §11I.1). The code facts below were re-read at main `f0b5e9d4` (M-5 merged, #444).

**This section governs 4b.** Where it differs from §11C (S4-W-3, S4-W-6, S4-FR-5, S4-FR-13, S4-FR-16, §11C.6 "no migration", §11C.7 "no new table"), §11I wins: 4b now carries BD-17, which needs **one hand-applied production migration**. S4-FR-15, S4-FR-17 to S4-FR-22 and AC-102 to AC-107 are kept and built in 4b.2, amended where §11I.5 says so.

**BQ-13 stays open. 4b keeps no take-back:** a refunded or lost boost never takes its credits back automatically, exactly as today (T-9, FR-37). Nothing in 4b writes to `business_os_credit_lots` or `business_os_credit_lot_draws`. If the user later decides credits are taken back, that is a credit-ledger write in the boost module, scoped on its own.

### 11I.1 Facts (pre-work, verified 2026-10-17)

| # | Fact | Source |
|---|---|---|
| PF-1 | The next migration number is **`20261072`**. The latest on main is `20261071_website_images_bucket_lockdown.sql`; no open PR adds a migration. **2026-10-17: DE-8a (PR #451) took `20261074` and `20261075` first, so 4b.1 is renumbered `20261076` (table and function) and `20261077` (cleanup, regenerated over `20261075`)** | `supabase/migrations/` |
| PF-2 | `business_os_transition_boost_purchase(uuid, text, text, integer, text, text)` is defined only in `20261031_business_os_boost_crediting.sql:174-376`. It is **SECURITY INVOKER**, `SET search_path = ''`, EXECUTE for service_role only (`:460-468`). Refund branch `:269-311`, dispute branches `:313-373` | Migration |
| PF-3 | Because the function is INVOKER, it runs as service_role. **service_role needs an explicit INSERT grant on the new table**, or every refund or dispute RPC fails with 42501, which fails the webhook claim | PF-2 |
| PF-4 | A refund on a `disputed`, `dispute_lost` or `flagged_mismatch` row only updates `amount_refunded_minor` (`:278-286`, outcome `recorded`). It must **also** write an event row | Migration |
| PF-5 | A won dispute is not a status: the function moves the row back to `paid`, `partially_refunded` or `refunded` (`:351-373`). The event table needs its own kind to record "won" | Migration; CHECK `20261030…:51` |
| PF-6 | A dispute on a `flagged_mismatch` row only stores the dispute id (`recorded`, `:316-326`); its close returns `already` (`:341-342`) and changes nothing, so no close event can be written for it | Migration |
| PF-7 | Inside the function `now()` is **processing time**, not Stripe's event time. The nightly reconcile pass (`boostReconcilePass.ts`) applies a missed refund through the same function, so **a refund caught late is dated on the day we catch it** | RT §3; `boostReconcilePass.ts:585-598` |
| PF-8 | The finance revenue read R-k / R-k′ fetches only purchases **paid in the window** (`rangeFilter('paid_at', …)`, `BusinessOsFinanceReadRepository.ts:669-700`). A refund in month M on a purchase paid before M is invisible to it, so 4b needs a **separate dated read** of reversal events | Repository |
| PF-9 | `readMoney` (`boostRevenue.ts:164`, exported in 6a) is also used by `accountEconomics.ts:42,116,126` (the Accounts tab). **Changing the refund rule changes the Accounts tab too** | Code |
| PF-10 | Live: `business_os_boost_purchases` has **1 row** (paid, test mode, 2026-10-12), **0 refunds, 0 disputes**. No refund or dispute date column exists. `business_os_boost_reversal_events` does not exist (42P01). **No backfill is needed** | Live DB |
| PF-11 | The operator test-account cleanup (`20261047`) empties `business_os_boost_purchases` and its guard **G-18 blocks on any foreign key into an emptied table that the generator has not reviewed** (`generate-test-account-cleanup-sql.ts:332-346, 907-916`), whatever the FK's delete action. So the new FK to purchases needs the generator to classify it and a regenerated cleanup, even with `ON DELETE CASCADE` (this corrects the pre-work note that CASCADE avoids regeneration; SA-Q66) | Generator |

### 11I.2 Scope and split

About 4.5 days, so it is split. Both parts run the **full cycle** (a migration, money rules). Under BD-33 neither needs the user's per-slice approval, but **4b.1 stops for the user to apply the production migration**.

| Part | In scope | Not in scope | Estimate |
|---|---|---|---|
| **4b.1: Reversal events (writer)** | Migration `20261076`: the table `business_os_boost_reversal_events`, its RLS, grants and indexes, and `CREATE OR REPLACE` of the transition function (same signature) writing one event row per recorded refund step or dispute stage; the guarded "no undated history" assertion. Rollback, pre-check and post-apply check scripts, migration test. Registration in purge descriptors, classification baseline, business-owned inventory, export classification. The regenerated test-account cleanup (`20261077`, if SA-Q66 rules so) | **Any UI or finance read.** Any webhook, handler, reconcile-pass or repository change. Any credit take-back (BQ-13) | About 2 days |
| **4b.2: Finance reads and UI** | Two dated event reads (R-n, R-n′) and the attention reads (R-l, R-l′); the boost line dates refunds and lost disputes by event date; open disputes shown as **held now**; Section 6 block A "boost problems" (open disputes, payments never credited); the K-5 dispute rule; **bought credits beside gifted credits** in Section 4 (K-4 unchanged); the Accounts tab follows the same refund rule | Plan refunds and disputes (P-6b, slice 7); stuck checkouts (reconcile pass, FR-43); a sixth tile; a credit take-back | About 2.5 days |

**Order:** 4b.1 merges and its migration is applied on production **before 4b.2 merges**. 4b.2 may be built in parallel against a local database with the migration applied.

### 11I.3 Functional rules

**Writer (4b.1)**

| # | Rule |
|---|---|
| RV-1 | **One dated row per recorded step.** The transition function inserts exactly one event row, in the same transaction as the purchase update, whenever it returns `transitioned` or `recorded` for a refund or dispute target. It inserts nothing on `already`, `stale`, `not_allowed` or `not_found`, and nothing for `awaiting_payment`, `failed`, `expired` or `flagged_mismatch` targets |
| RV-2 | **The six insert points** (line numbers of `20261031`): refund `recorded` on a disputed, lost or flagged row (`:282-285`, PF-4); refund `transitioned` to `partially_refunded` or `refunded` (`:303-306`); dispute `recorded` on a flagged row (`:322-325`); dispute `transitioned` to `disputed` (`:330-333`); `dispute_lost` `transitioned` (`:349-352`); dispute won `transitioned` back to a paid status (`:368-371`) |
| RV-3 | **Kinds:** `refund`, `dispute_opened`, `dispute_won`, `dispute_lost` (PF-5) |
| RV-4 | **Refund amount = the delta:** new cumulative minus the cumulative stored before, computed under the existing `FOR UPDATE` lock. The row also stores the new cumulative. A late, older event is already `stale` and writes nothing; its share is in the newer row |
| RV-5 | **Dispute amount = the amount at stake at that moment:** `amount_total_minor - amount_refunded_minor` as stored when the stage is recorded (the same remainder 4a shows as held or lost). On a flagged row, whose total may be NULL, the amount is 0 when the total is NULL |
| RV-6 | **The Finance date is `recorded_at = now()`**, the time we recorded it (PF-7). It is never supplied by a caller and never backdated: `recorded_at` is not in service_role's INSERT grant. A refund we learn of late, for example through the nightly reconcile pass, counts in the month we learned of it. Under BD-17 that is the price of "finished months never change", and the page says so (FR-4B-6) |
| RV-7 | **Append-only.** No UPDATE or DELETE grant to any role. Rows leave only with their purchase (FK, SA-Q66) |
| RV-8 | **No change outside the migration:** the RPC name, its six arguments, its return type and every outcome are unchanged, so the webhook, `boostChargeHandler.ts`, `boostReconcilePass.ts`, `BusinessOsBoostPurchaseRepository.ts` and their tests are unchanged. The reconcile pass is covered because it calls the same function |
| RV-9 | **No undated history.** The migration refuses to apply (raises) if any purchase has `amount_refunded_minor > 0` or a `stripe_dispute_id` (PF-10: none today). If the pre-check finds one, the user stops and the session goes to SA; no backfill is invented |
| RV-10 | **BQ-13: no take-back.** The function body gains only the inserts; the credit lot is never touched (T-9, FR-37 unchanged) |

**Finance (4b.2)**

| # | Rule |
|---|---|
| FR-4B-1 | **Gross stays by `paid_at`** (S4-W-1): purchases, gross charged, of which tax and credits sold count the purchases paid in the window, as in 4a |
| FR-4B-2 | **Refunds by event date (BD-17):** "refunded" for a window = the sum of `refund` event amounts with `recorded_at` in the window, **whatever month the purchase was paid in**. A purchase paid in October and refunded in November lowers November, never October |
| FR-4B-3 | **Lost disputes by event date (BD-17 default):** "lost in disputes" for a window = the sum of `dispute_lost` event amounts recorded in the window |
| FR-4B-4 | **Held means held now (BD-17 default):** "held in open disputes" is the remainder of purchases whose status is `disputed` **right now** (R-l / R-l′), shown as its own figure, labelled "Held in open disputes now (not taken off any month)". It is **not** subtracted from any window's net. `dispute_opened` and `dispute_won` events are history and the problems block's source of dates; they move no money on the page |
| FR-4B-5 | **Net for a window** = gross charged (paid in the window) − refunded (recorded in the window) − lost in disputes (recorded in the window). Labelled "Net of refunds and lost disputes (Stripe fees not deducted; includes any tax)". Net can be negative in a window with refunds and no sales, shown with a minus sign, never clamped |
| FR-4B-6 | **The S4-W-3 note is replaced** by: "Refunds and lost disputes count in the month we recorded them, so a finished month does not change. A refund we learn of late counts in the month we learned of it. Open disputes are shown as held now." It shows whenever a refund, lost or held figure is non-zero |
| FR-4B-7 | **Grouping:** an event is grouped by its own `currency` (copied from the purchase, per currency only, BD-12) and, in the by-package table, by its purchase's `package_id` and `package_version`. An event whose purchase's account was deleted goes to the "Deleted accounts" line (S4-W-7) |
| FR-4B-8 | **Events on purchases never paid:** an event whose purchase has no `paid_at` (a `flagged_mismatch` purchase, PF-4, PF-6) is **not** revenue and never changes a figure of "Our revenue". It is counted in a note on the problems block ("N refunds or disputes recorded on purchases not credited") |
| FR-4B-9 | **Exactness:** event amounts are integer minor units read like 4a's (S4-W-4: `minorUnitsPerMajor` must be 100, never `toUnits`, `toHundredths` or `× 100`); an unreadable event is counted and makes net Unknown on its line and the block `partial`. At the event read's ceiling, refunded and lost show "At least" and net shows "Unknown (a read was cut off)" (S4-W-8) |
| FR-4B-10 | **K-5** shows the FR-4B-5 net (plus plan cash received, as M-2) for the filter window. Its colour comes from the dispute rule (FR-4B-12). K-5's value changes where a refund or a lost dispute exists, **and where a dispute is open** (E-102, SA-WR-4b2): today's 4a net still subtracts the window's held amount, and FR-4B-5 with BD-17 ("held means held now") takes it out of every window. That follows from the decided rule; it is not a new business choice. None is live, so no live figure moves |
| FR-4B-11 | **Accounts tab and account summary (PF-9):** they follow the **same** rule, so the two tabs agree. An account's boost "paid us" for the window = its boosts paid in the window after tax − its refunds recorded in the window − its lost disputes recorded in the window; held now is not deducted. A refund or loss on a taxed purchase gives Unknown (the SA-Q47 rule, unchanged). An account whose only boost money in the window is a refund is listed (SA-Q49) with a negative figure |
| FR-4B-12 | **Section 6 block A, "Our payment problems (boosts)"**, as of now: S4-FR-15 (open disputes with the amount held now, payments never credited) and S4-FR-17 (K-5 red when open disputes ≥ 1, rule in `FINANCE_RULES`), each with **the date it started**: an open dispute shows the `recorded_at` of its `dispute_opened` event, a payment never credited shows its oldest `status_changed_at`. Lost disputes are not repeated in this block; they are in revenue in the month lost (amends S4-FR-16) |
| FR-4B-13 | **Bought credits:** S4-FR-18 to S4-FR-20 unchanged: bought outstanding and bought in the window beside gifted, never combined; K-4 and the gifted figures still count `admin_grant` lots only. With BQ-13 open, bought outstanding of a refunded purchase still counts (the customer kept the credits); the section says "Credits of a refunded boost are not taken back" while any refund event exists |
| FR-4B-14 | **Picked business:** R-n′, R-l′ and `listLotsWithDraws(accountId)` with exactly that id; R-n and R-l have zero calls (S4-FR-21) |
| FR-4B-15 | **Payload and logs:** `revenue.boosts` lines lose the window `held`, and **held now is its own per-currency list, `revenue.boosts.heldNow`, beside the lines** (E-104): a currency can be held now with no line in the window. Every new wire field on a type Pin B names is **optional** (`?:`), and the builder always sets it (E-103); `paymentProblems.boosts` and the `credits` bought figures as S4-FR-22. Logs carry statuses, counts and timing only; never an amount, a Stripe id or a name |
| FR-4B-16 | **Table absent:** if the event read fails (for example 42P01 before the migration), the boost part shows refunded, lost and net as "Unknown", the section is `partial`, and every other section renders. The page never falls back to DF-5's purchase-month rule |

### 11I.4 Data model and migration outline (4b.1)

**File:** `supabase/migrations/20261076_business_os_boost_reversal_events.sql` (name to SA). One file, one transaction.

| Column | Type | Rule |
|---|---|---|
| `id` | `uuid` PK, default `gen_random_uuid()` | |
| `purchase_id` | `uuid NOT NULL` FK → `business_os_boost_purchases(id)`, **`ON DELETE CASCADE`** (SA-Q66) | The account comes through the purchase. **No `user_id` column** (RT §3) |
| `kind` | `text NOT NULL` | CHECK in `refund`, `dispute_opened`, `dispute_won`, `dispute_lost` |
| `amount_minor` | `integer NOT NULL` | CHECK `>= 0` (RV-4, RV-5) |
| `cumulative_refunded_minor` | `integer NOT NULL` | CHECK `>= 0`; the purchase's cumulative refunded after the step |
| `currency` | `text NOT NULL` | Copied from the purchase |
| `stripe_dispute_id` | `text NULL` | CHECK: NULL when `kind = 'refund'`, NOT NULL otherwise |
| `status_before`, `status_after` | `text NOT NULL` | The purchase status around the step (a flagged purchase stays `flagged_mismatch`); history only |
| `livemode` | `boolean NOT NULL` | Copied. Kept for DF-3; **the finance read never selects it** (BD-14) |
| `recorded_at` | `timestamptz NOT NULL DEFAULT now()` | **The Finance date** (RV-6) |

**Indexes:** unique `(purchase_id, cumulative_refunded_minor) WHERE kind = 'refund'`; unique `(purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund'`; `(recorded_at)` for the dated read; `(purchase_id)` for the FK and the cascade.

**Migration order inside the file:**
0. `LOCK TABLE public.business_os_boost_purchases IN EXCLUSIVE MODE;`, inside the file's one transaction (`LOCK TABLE` needs a transaction block; the SQL editor runs a pasted file as one implicit transaction). The migration test pins that it comes before the assertion. It means no new refund or dispute can start while the migration runs. A call already inside the old body can still finish with it; check 24's "no refund or dispute recorded without an event" row proves none did (E-65, SA F-2).
1. Assertion (RV-9): raise if any purchase has a refund or a dispute id.
2. `CREATE TABLE`, CHECKs, indexes, `COMMENT ON TABLE` (a retained financial record, append-only, written only by the transition function).
3. RLS and grants (§11I.5).
4. `CREATE OR REPLACE FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)`: the `20261031` body unchanged except the six inserts (RV-2), still `SECURITY INVOKER`, `SET search_path = ''`, every name schema-qualified. Each insert uses `ON CONFLICT DO NOTHING` on the two unique indexes (SA-Q67).
5. Re-state the function's `REVOKE ALL` (PUBLIC, anon, authenticated, service_role) and `GRANT EXECUTE … TO service_role`, as `20261031:460-468`.

**Rollback:** `supabase/SQL Scripts/20261076_business_os_boost_reversal_events_rollback.sql` restores the `20261031` function body byte for byte and drops the table. It **refuses** when the table holds any row (dropping dated money history must be a deliberate, separate act; SA-Q70).

**Cleanup (PF-11):** `scripts/generate-test-account-cleanup-sql.ts` classifies the new edge as parent-owned (`INBOUND_FOREIGN_KEYS` with owner column `null`, a `PARENT_OWNED_REASONS` entry), bumps its version and emits `20261077_operator_test_account_cleanup_boost_reversal_events.sql` (name to SA) with its rollback; `scripts/__tests__/testAccountCleanupSql.test.ts` pins the new pair and keeps the prior hash pins. With CASCADE, no delete step is added (SA-Q66).

### 11I.5 RLS, grants and idempotency

| Item | Rule |
|---|---|
| RLS | `ENABLE ROW LEVEL SECURITY`. **No policy for any role** (server-write-only, the payment tables lockdown and `20261030…:133-167` precedent). No owner read: the owner never sees this table |
| Grants | `REVOKE ALL ON TABLE` from `PUBLIC`, `anon`, `authenticated` **and `service_role`**; then `GRANT SELECT` to `service_role` and `GRANT INSERT (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)` to `service_role`. **No UPDATE, no DELETE, and `id` and `recorded_at` are not in the INSERT grant** (they take their defaults). The cascade from the purchase runs as the referential action and needs no DELETE grant (SA to confirm, SA-Q66) |
| Why the INSERT grant is essential | PF-3: without it every refund or dispute fails at the RPC with 42501 and the webhook claim is marked failed. The migration test and check 24 both pin it |
| Function | Stays `SECURITY INVOKER` (the SECURITY DEFINER surface guard is not tripped; SA-Q69) |
| Idempotency | **Refunds:** keyed by `(purchase_id, cumulative_refunded_minor)`: each step raises the running total, so the total after the step names it, across webhook resends, out-of-order events and the reconcile pass, with no Stripe refund id. **Disputes:** keyed by `(purchase_id, kind, stripe_dispute_id)`. The state machine writes no row on `already` or `stale`; the unique indexes are the backstop, and check 25 reconciles events against the purchase rows |

### 11I.6 Deploy order and the user's hand-apply steps

**4b.1 PR stays off auto-merge until the user confirms the migration is applied** (the migration-gated rule; BD-33 still stops for a production migration). The DB change is entirely inside the migration, so 4b.1's TypeScript (tests, descriptors, generator, scripts) reads nothing new and is safe on either side of it; the off-auto-merge rule keeps the order honest.

1. **Pre-check (production, read-only):** run check 23. Every row must show `ok = true`. Since the rebase onto DE-8a (2026-10-17) two of its 9 rows prove DE-8a is live: the `business_os_data_exports` table exists and the cleanup function is the `20261075` version (stamp `a824848e0a538477`), which `20261077` replaces. If not, stop and tell the session.
2. **Apply `20261076`** in the Supabase SQL editor, the whole file at once. It raises and changes nothing if RV-9 fails. (Editor hazard: no quoted string in the file, the `COMMENT ON TABLE` text and exception messages included, may contain the word the editor misreads as a table target; the migration test pins this.)
3. **Apply `20261077`** (the regenerated cleanup). It is needed (SA-Q66: G-18 must see the new edge reviewed).
4. **Post-apply check:** run check 24. Every row must show `ok = true`.
5. Tell the session "applied". RM then merges 4b.1 (manually, not auto-merge).
6. **4b.2** is built, reviewed and opened after that; with the table live it may auto-merge under BD-33 (its code also tolerates the table being absent, FR-4B-16).
7. **After the first real refund or dispute** (test mode counts, BD-14): run check 25 (events reconcile with the purchase) and check 26 (the month's figures).

**Rollback (only if needed):** the rollback file of step 2 (and of step 3), applied by hand, **`20261077`'s first, then `20261076`'s**. It refuses while the events table holds rows: once any event exists, a defect is fixed forward by a new migration, never by dropping dated money history (E-67, SA F-6).

### 11I.7 Reads (4b.2)

All in `BusinessOsFinanceReadRepository`, with its rules (service role documented, exported column lists, no write method, one caller, never throws, **no `livemode`**, the boost repository named in words only).

| # | Method (example name) | Scope | Table and filter | Columns |
|---|---|---|---|---|
| **R-n** | `listBoostReversalEventsAllAccountsRecordedInRange(range)` | Named all-accounts | `business_os_boost_reversal_events`, `recorded_at >= start` and `< end` (half-open, as `paid_at`) | `id, purchase_id, kind, amount_minor, currency, recorded_at`, plus the purchase's `user_id, package_id, package_version, amount_tax_minor, paid_at` (embed or second read: SA-Q68). No Stripe id, no `livemode` |
| **R-n′** | `listBoostReversalEventsForAccountRecordedInRange(accountId, range)` | Account-scoped | Same, restricted to purchases of that account (through the purchase; SA-Q68); refuses a malformed UUID before querying | Same |
| **R-l, R-l′** | As §11C.6 | As §11C.6 | As §11C.6 | As §11C.6, plus the opened date of an open dispute from its `dispute_opened` event (SA-Q68) |

Paging: the layer-B pager (keyset on `id`, page 1,000, ceiling 5,000, `reachedCeiling`). Bought credits reuse R-b and `listLotsWithDraws` (S4-FR-18).

**Read shape (SA-Q68, E-69):** two reads, with no PostgREST embed. R-n reads the events in range (keyset, capped), then their purchases by id. R-n′ reads the account's purchase ids first (account-scoped, refusing a malformed UUID), then the events whose `purchase_id` is in that set and whose `recorded_at` is in range. Every id list is sent in chunks of at most 100. R-l / R-l′'s opened date reads `dispute_opened` events by purchase id in the same way. A cut-off read makes the figures it feeds "At least" or Unknown (FR-4B-9).

### 11I.8 Guards and tests affected

| Guard or test | Effect | Part |
|---|---|---|
| Purge descriptors `lib/business-os/purge/descriptors.ts:1343` | Add `never('business_os_boost_reversal_events', {kind:'via', parent:'business_os_boost_purchases', fk:'purchase_id'}, exclude(EXPORT_REASON.BILLING), …)` next to the purchases (the `via` form exists at `:1045`) | 4b.1 |
| `lib/business-os/purge/__tests__/classification-baseline.json` | Count **155 → 156**, add `"never"` | 4b.1 |
| `descriptors.invariant.test.ts` | Runs on the two rows above | 4b.1 |
| `lib/business-os/businessOwnedTables.ts:218` | Register beside `business_os_boost_purchases` with a reason | 4b.1 |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts:1593-1603` | **Add to `BILLING_TABLES` by hand** (the `business_os_boost_*` prefix is not matched automatically) | 4b.1 |
| Test-account cleanup: `scripts/generate-test-account-cleanup-sql.ts`, `scripts/__tests__/testAccountCleanupSql.test.ts` | G-18 blocks an unreviewed inbound FK (PF-11): classify the edge, regenerate as `20261077`, pin the new pair | 4b.1 |
| `lib/business-os/account/accountDeletionPolicy.ts:186`, `scripts/audit-deletion-coverage.ts` | Deprecated, "do not extend". Touch only if the audit script demands it | 4b.1 |
| **New** `supabase/migrations/__tests__/business-os-boost-reversal-events.migration.test.ts` | Pins: RLS on, no policy; REVOKE from all four roles; SELECT and the column-level INSERT grant to service_role (no `recorded_at`, no `id`); no UPDATE or DELETE grant; the six-argument signature; `SECURITY INVOKER` and `search_path = ''`; the six insert points; the RV-9 assertion; the function re-grants. Precedent `business-os-boost-crediting.migration.test.ts` | 4b.1 |
| `business-os-boost-crediting.migration.test.ts` | Unaffected (the `20261031` file is unchanged); run unchanged | 4b.1 |
| `BusinessOsBoostPurchaseRepository.test.ts:519-574`, `boostRouting.integration.test.ts`, webhook placement guards | Not tripped (signature unchanged); run unchanged | 4b.1 |
| Payment write-lockdown scan `lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts:35-48, :347` | Not tripped automatically; **SA-Q71** decides whether to add the table | 4b.1 |
| SECURITY DEFINER surface `supabase/__tests__/security-definer-surface.guard.test.ts` | Not tripped while the function stays INVOKER (**SA-Q69**) | 4b.1 |
| Rollback and check conventions | `supabase/SQL Scripts/20261076_…_rollback.sql`; `scripts/precheck-bos-boost-reversal-events.sql` (check 23); `scripts/check-bos-boost-reversal-events-migration.sql` (check 24) | 4b.1 |
| `finance.source.guard.test.ts` DF-5 pin (`:724-751`) | **Re-pinned:** the event kinds and `amount_minor` are read in one function only (the BD-17 rule), the held-now remainder in one function only; `amount_refunded_minor` is no longer read by the revenue builder. With a planted control | 4b.2 |
| Same guard, table pin `REPOSITORY_TABLES` (`:332`) | **Grows by one table** (`business_os_boost_reversal_events`), with its control | 4b.2 |
| `BusinessOsFinanceReadRepository.ts:175` boost column list and its test | New exported column constant for R-n; one test per new method (column list, half-open `recorded_at`, account scoping, malformed id, paging, ceiling, never throws, no `livemode`) | 4b.2 |
| Accounts tab tests (`accountEconomics`), the 6a export pins and AC-145 baseline | Change with FR-4B-11; SA rules on any baseline edit (SA-Q72) | 4b.2 |
| `financeRules` data tests, `creditsSection` tests, G3 `creditLots.test.ts` | As §11C.7 (K-5 rule; bought credits in `creditsSection.ts`, G3 not tripped) | 4b.2 |
| **Frozen pins** | AC-173 `3a1a2dd4…f6f8` and helper `b84e0c96…aabf`, Pin A `30f5fc24…2e01`, Pin C `98ea0507…1e4b` and helper `02813360…5bd8`, Pin D `1f7cf07a…f144` stay **byte-identical**. **Pin B `24ff0da7…df9f`** also stays byte-identical. It serves fixed payloads to the page, so a server-side K-5 rule change cannot move its **values**. **E-103:** it also type-checks its typed payload literals, so every new wire field on `FinanceCreditRow`, `FinanceCreditsSection`, `FinancePaymentProblemsSection`, `FinanceBoostNotes` and `FinanceBoostRevenue` is optional, and no field Pin B names is removed or renamed. That keeps E-68's intent. If 4b.2 needs a tile wire change, stop and raise it to SA. The K-5 rule is proven by builder and rule tests (SA-Q73, E-68) | 4b.2 |
| `npm run test:authz-guard`, `test:bos-entitlements` | Run, expected unchanged | 4b.1, 4b.2 |

### 11I.9 Acceptance criteria

**4b.1 (writer)**
- [ ] **AC-204** *(4b.1)* The migration creates `business_os_boost_reversal_events` with the §11I.4 columns, CHECKs, the two unique partial indexes and the `recorded_at` and `purchase_id` indexes (migration test; check 24).
- [ ] **AC-205** *(4b.1)* RLS is on with no policy; `anon` and `authenticated` hold no privilege; `service_role` holds SELECT and INSERT on exactly the nine §11I.5 columns, not on `id` or `recorded_at`, and no UPDATE or DELETE (migration test; check 24).
- [ ] **AC-206** *(4b.1)* The function keeps the six-argument signature, return type, `SECURITY INVOKER`, `search_path = ''` and EXECUTE for service_role only; the boost repository and webhook tests pass unchanged.
*How AC-207 to AC-211 are proven (E-66, SA F-4).* CI has no database, so the migration test pins the migration text only (AC-204 to AC-206). The behaviour in AC-207 to AC-211 is proven by `scripts/test-bos-boost-reversal-events.sql`. It is a self-checking script: it raises on any failed expectation. Dev runs it inside `BEGIN … ROLLBACK` against a **local** database only, never production, and records the output in the workplan.

- [ ] **AC-207** *(4b.1)* A partial refund then a full refund of one purchase write two `refund` rows whose amounts are the deltas and whose cumulatives are the two totals; re-sending either, or an older cumulative (`stale`), writes nothing (integration test against a local database, or SQL test).
- [ ] **AC-208** *(4b.1)* A refund on a `disputed`, a `dispute_lost` and a `flagged_mismatch` purchase (outcome `recorded`) each writes one `refund` row (PF-4).
- [ ] **AC-209** *(4b.1)* Dispute opened, won and lost each write one row of their kind with the amount at stake (RV-5); a repeated stage writes nothing; a dispute recorded on a flagged purchase writes one `dispute_opened` row.
- [ ] **AC-210** *(4b.1)* No row is written for `awaiting_payment`, `failed`, `expired` or `flagged_mismatch` targets, or for any `already`, `stale`, `not_allowed` or `not_found` outcome.
- [ ] **AC-211** *(4b.1)* `recorded_at` is the transaction time; an insert by service_role that names `recorded_at` is refused (privilege).
- [ ] **AC-212** *(4b.1)* The migration raises and changes nothing when any purchase has a refund or a dispute id (RV-9).
- [ ] **AC-213** *(4b.1)* No credit lot or lot draw is written by any refund or dispute path (BQ-13: no take-back).
- [ ] **AC-214** *(4b.1)* Purge descriptor, classification baseline (156), business-owned inventory and export `BILLING_TABLES` list the table; the descriptor invariants and export classification tests pass; the regenerated cleanup passes G-18 for a test account with boost purchases and events (cleanup test).
- [ ] **AC-215** *(4b.1)* The rollback restores the `20261031` body byte for byte, drops the table, and refuses while the table holds a row.
- [ ] **AC-216** *(4b.1, manual)* The user ran check 23 (all ok), applied the migration(s), and check 24 shows all ok; recorded in the workplan before the PR merges.

**4b.2 (finance)**
- [ ] **AC-217** *(4b.2)* A purchase paid in October and refunded in November: October's refunded and net are unchanged by the refund; November shows the refund and a net lowered by it (FR-4B-2), with injected events at `23:59:59.999999` and `00:00:00.000000` UTC on a month boundary each in exactly one month; the half-open bounds are asserted on R-n's query.
- [ ] **AC-218** *(4b.2)* A dispute opened in October and lost in November: nothing in October; "lost" in November equals the event amount (FR-4B-3).
- [ ] **AC-219** *(4b.2)* An open dispute appears as "held in open disputes now", equal to check 15's `held_minor`, the same whatever the window, and is not subtracted from any window's net (FR-4B-4).
- [ ] **AC-220** *(4b.2)* For This month, per currency: purchases, gross, tax and credits sold match check 14; refunded and lost match check 26 (paid purchases only); net = gross − refunded − lost, negative shown with a minus sign.
- [ ] **AC-221** *(4b.2)* An event on a purchase never paid changes no revenue figure and is counted in the problems note (FR-4B-8).
- [ ] **AC-222** *(4b.2)* An event whose purchase belongs to a deleted account counts on the "Deleted accounts" line; by-package rows group events by their purchase's package.
- [ ] **AC-223** *(4b.2)* Unreadable event amounts and an injected small ceiling give the FR-4B-9 states; no event amount passes through `toUnits`, `toHundredths` or `× 100` (source test).
- [ ] **AC-224** *(4b.2)* R-n failing (including 42P01, mocked) gives refunded, lost and net "Unknown", the section `partial`, every other section rendering, and no purchase-month fallback (FR-4B-16).
- [ ] **AC-225** *(4b.2)* The FR-4B-6 note replaces the S4-W-3 note; no copy says "counted in the month of the purchase".
- [ ] **AC-226** *(4b.2)* The Accounts tab and the account summary give, for the same window and account, the boost figures of FR-4B-11, equal to the revenue section restricted to that account; a refund on a taxed purchase gives Unknown.
- [ ] **AC-227** *(4b.2)* The problems block shows each open dispute's opened date from its event and each payment never credited with its oldest change date (FR-4B-12); AC-102 and AC-103 pass.
- [ ] **AC-228** *(4b.2)* Bought credits: AC-104 and AC-105 pass; K-4 and gifted are unchanged (check 5); the "not taken back" sentence shows only while a refund event exists.
- [ ] **AC-229** *(4b.2)* Picked business: R-n′, R-l′ and `listLotsWithDraws` receive exactly that id; R-n and R-l have zero calls (AC-106 extended).
- [ ] **AC-230** *(4b.2)* No Stripe id, `livemode`, receipt, flag reason or lot id in R-n's columns, the payload or the logs; auth and input as AC-99, with zero event reads on 401, 403 and 400.
- [ ] **AC-231** *(4b.2)* The finance source guard's re-pinned DF-5 rule, the grown table pin and their planted controls pass; the AC-173 pair and Pins A, B, C and D are byte-identical (SA-Q73, E-68).
- [ ] **AC-232** *(4b.2, manual)* Admin opens Finance (This month and 30d, all businesses and the owner business): the owner test purchase shows as in 4a with no refund; no open dispute, no payment never credited; the owner account's 5,000 bought credits beside its gifted credits; cross-checked with checks 14, 15, 16 and 26. Manual QA steps **L-137 to L-141** (BD-33: after merge, no approval step).

Manual QA (read-only, after 4b.2 merges): **L-137** Our revenue for This month and 30d, with the FR-4B-6 note absent while nothing is refunded; **L-138** "Held in open disputes now" reads none; **L-139** Section 6 block A "Our payment problems (boosts)" shows no open dispute and no payment never credited; **L-140** Section 4 shows bought credits beside gifted, K-4 unchanged; **L-141** the Accounts tab and the owner account summary show the same boost figure as Our revenue for that account.

### 11I.10 Open questions for SA (4b)

Technical only. **No new business question:** BD-17 and its dispute defaults decide the money rules; BQ-13 stays open and 4b keeps no take-back.

| # | Question | BA suggestion |
|---|---|---|
| **SA-Q65** | Store Stripe's `event.created` as `occurred_at` beside `recorded_at` (RT Q-1)? It changes the RPC signature, the handler and the repository argument pins | No. `recorded_at` only; the signature stays |
| **SA-Q66** | FK delete action, and the cleanup: `ON DELETE CASCADE` plus a regenerated cleanup (`20261073`, the edge classified parent-owned for G-18, PF-11), or `NO ACTION` plus a delete step? Confirm the cascade needs no DELETE grant. Same PR as `20261072`, or a follow-up? | CASCADE; regenerate in the same 4b.1 PR as its own migration, applied right after `20261072` |
| **SA-Q67** | Inserts: `ON CONFLICT DO NOTHING` (the purchase update still lands; check 25 catches a gap) or let a unique violation raise (the webhook then fails and retries)? | `ON CONFLICT DO NOTHING`; the state machine already writes no row on `already` and `stale` |
| **SA-Q68** | R-n and R-n′ need purchase fields and account scoping through the purchase: a PostgREST embed (`business_os_boost_purchases!inner(...)`, new in this repository) or two reads (events in range, then purchases by id; for one account, its purchase ids first)? Same for the open dispute's opened date in R-l | Two reads: no new pattern, both keyset-paged and capped |
| **SA-Q69** | Keep the function `SECURITY INVOKER` with a column-level INSERT grant, rather than DEFINER (which trips the SECURITY DEFINER surface guard R-a to R-d)? | Keep INVOKER |
| **SA-Q70** | Rollback refuses while the events table holds rows? | Yes |
| **SA-Q71** | Add the new table to the payment write-lockdown scan (`paymentTablesWriteLockdownMigration.test.ts`, the fixed list and the no-browser-writer check)? | Yes: cheap, and it is a payment table written only by the server |
| **SA-Q72** | The Accounts tab follows the refund-month rule (FR-4B-11), which changes its figures and may touch the 6a export pins and the AC-145 baseline: approve and rule how the pins change | Approve; one ruled pin update, recorded |
| **SA-Q73** | Pin B pins tile values. If its fixtures hold a refund or a dispute, K-5's value changes under FR-4B-5: re-freeze Pin B once, or change the fixture? | Check the fixture first; if it changes, re-freeze once by SA ruling with the new hash recorded |
| **SA-Q74** | A refund recorded after a lost dispute, or on a flagged purchase, could make refunded + lost exceed a purchase's total across months. Count each in its month as recorded, with a note when it happens? | Yes; count as recorded, with the note; check 25 shows the purchase |

### 11I.11 Estimates

| Part | Work | Estimate |
|---|---|---|
| 4b.1 | Migration (table, RLS, grants, function body with six inserts, assertion), rollback, checks 23 and 24, migration test, purge, baseline, inventory, export list, cleanup regeneration and its pins | About 2 days |
| 4b.2 | R-n, R-n′, attention reads, builder rule change and DF-5 re-pin, Accounts tab, problems block, K-5 rule, bought credits, render and route tests, checks 25 and 26 at QA | About 2.5 days |
| **Total** | Close to BD-32's "about 4 days"; the half day is the cleanup regeneration (PF-11) | **About 4.5 days** |

### SA Requirement Review — 4b (§11I) — 2026-10-17

**Verdict: ✅ APPROVED WITH CONDITIONS.** 4b.1 may start after E-65 to E-69, which SA applied below. The design is sound: an append-only dated event table, written inside the existing transition function under its existing row lock, with RLS on, no policy, and a column-level INSERT grant. It fits the payment-tables and DB-exposure lockdown conventions. **No genuine user decision is needed for the design.** BD-17 and its defaults decide the money rules, and BQ-13 stays open, untouched. The user's only steps are the planned hand-apply (checks 23 and 24 around `20261072` and `20261073`), and possibly one operational choice in F-5.

**How it was checked.**
- **The function.** SA read `20261031:174-376` line by line.
  - Every target takes `SELECT … FOR UPDATE` on the purchase row first. Every write is one `UPDATE` in the same function call, so the same transaction.
  - Retries and the reconcile pass return `already` (equal cumulative, same dispute id) or `stale` (lower cumulative) **before** any write path.
  - Each of the six RV-2 write branches is reached only on a real state change.
- **The schema.** `20261030`: `currency` and `livemode` are `NOT NULL` (and `currency = 'USD'`), so the copied event columns cannot fail their NOT NULL. `amount_total_minor` is nullable on flagged rows (RV-5 covers it). `user_id` is `ON DELETE SET NULL`, so purchases outlive their account and events stay with them.
- **The checks.** Checks 23 to 26 were scanned: ASCII only, no apostrophe in any comment, no "into", one final result set each. Their SQL was read for type and union consistency.

**Findings**

| # | Severity | Finding | Fix |
|---|---|---|---|
| F-1 | — | **Rewriting the function is safe.** The signature, return type, outcomes, `SECURITY INVOKER` and `search_path = ''` are kept. `CREATE OR REPLACE` keeps the ACL, and re-stating the grants is harmless. The inserts sit inside the same call, so an insert failure (for example a missing grant) rolls back the purchase update too, and the webhook claim retries. There is no half-applied state. No caller changes (RV-8). The SECURITY DEFINER surface guard is not tripped (INVOKER). The payment write-lockdown scan is not tripped automatically and gains the table (SA-Q71). | — |
| F-2 | Medium | **The RV-9 guard is right, but it is not race-proof on its own.** A webhook call already running the **old** body when the migration starts can commit a refund with no event after the assertion. Locking narrows the window, but a call that has already entered the old body finishes with it. The window is tiny today (one test purchase, 0 refunds), but "no undated history" should be proven after the apply, not assumed. | **E-65 (applied):** the migration takes `LOCK TABLE public.business_os_boost_purchases IN EXCLUSIVE MODE` before the assertion, and check 24 gains the row "no refund or dispute recorded without an event". |
| F-3 | — | **Grants and RLS match the lockdown conventions:** RLS on, no policy, `REVOKE ALL` from all four roles, then SELECT plus the nine-column INSERT to service_role, with no UPDATE or DELETE. Column-level INSERT is right: unnamed columns take their defaults and need no privilege, so `id` and `recorded_at` cannot be supplied. **The cascade needs no DELETE grant** (SA-Q66): referential actions run with the referencing table owner's rights, not the caller's. | — |
| F-4 | Medium | **AC-207 to AC-211 cannot run in CI.** CI has no database, and the migration test pins text only. | **E-66 (applied):** these ACs are proven by a self-checking SQL script that Dev runs inside `BEGIN … ROLLBACK` against a **local** database, never production, with its output recorded; CI keeps the text pins. |
| F-5 | Low (operational) | **If Dev has no local database,** the six insert paths are first exercised by a real event. The only real-event path is a Stripe **test-mode** refund (BD-14 counts it), checked with check 25. | **The one possible user touchpoint:** a test-mode refund of the owner test purchase after the apply. That is operational, not a business rule; TL asks only if F-4's local run is impossible. |
| F-6 | Low | **The rollback order and the once-rows-exist rule were not stated.** | **E-67 (applied):** roll back `20261073` first, then `20261072`. Once the events table holds a row the rollback refuses, and from then on any defect is fixed forward by a new migration. |
| F-7 | — | **The deploy order is honest.** 4b.1's TypeScript reads nothing new, so it is safe on either side of the apply, and the PR stays off auto-merge until the user says "applied". 4b.2 merges only after the apply and still tolerates a missing table (FR-4B-16, AC-224). There is no window in which merged code needs a table that is not there. | — |
| F-8 | Medium | **SA-Q73 has a cleaner answer than a re-freeze.** Pin B serves **fixed payloads** to the page, so a server-side K-5 rule change (FR-4B-5, FR-4B-10) cannot move it. Pin B stays byte-identical. If 4b.2 must change the tile wire shape, that is a display change: stop and raise it to SA. The K-5 rule is proven by builder and rule tests. | **E-68 (applied)** on §11I.8 and AC-231. |
| F-9 | — | **SA-Q68: two reads, with explicit chunking.** R-n reads events in range (keyset, capped), then their purchases by id. R-n′ reads the account's purchase ids first (account-scoped), then events by `purchase_id` in that set and range. Id lists are chunked at 100 per request. | **E-69 (applied)** on §11I.7. |
| F-10 | — | **The split and estimates are sensible.** 4b.1 is writer-only, has no UI, and is migration-gated; 4b.2 is reads and UI. | — |

**Rulings SA-Q65 to SA-Q74**

| # | Ruling |
|---|---|
| SA-Q65 | **No `occurred_at`.** `recorded_at` only; the signature stays (BD-17 accepts "the month we learned of it"). |
| SA-Q66 | **`ON DELETE CASCADE`, with the cleanup regenerated as `20261073` in the same 4b.1 PR** and applied right after `20261072`. G-18 needs the edge classified (PF-11). No DELETE grant is needed (F-3). |
| SA-Q67 | **`ON CONFLICT DO NOTHING`.** A conflict can only mean the state machine already wrote the step. Raising would turn a duplicate into a webhook that fails and retries forever. Check 25 reconciles any gap. |
| SA-Q68 | **Two reads**, as F-9 and E-69. No embed pattern in this repository. |
| SA-Q69 | **Keep INVOKER** with the column-level INSERT grant. |
| SA-Q70 | **Yes**, plus E-67 (order, fix forward). |
| SA-Q71 | **Yes:** add the table to the payment write-lockdown scan (the fixed list and the no-browser-writer check). |
| SA-Q72 | **Approved: one ruled update per pin, as E-55.** The AC-145 Overview baseline gains R-n and R-l with their exact arguments, plus the `heldNow` payload change and a refreshed hash, and nothing else. The 6a export pins and `accountEconomics` tests change only where FR-4B-11 changes a figure. Paste the hunk lists. |
| SA-Q73 | **Pin B is not re-frozen** (F-8, E-68). |
| SA-Q74 | **Yes.** Count each event in its month as recorded. The problems note shows when refunded plus lost exceeds a purchase's total; check 25's `over_total` shows the purchase. |

**E-edits (all applied by SA)**
- **E-65.** §11I.4 migration order gains step 0: `LOCK TABLE public.business_os_boost_purchases IN EXCLUSIVE MODE`. Check 24 gains the row "no refund or dispute recorded without an event".
- **E-66.** §11I.9 gains a note before AC-207: AC-207 to AC-211 are proven by `scripts/test-bos-boost-reversal-events.sql`, a self-checking script (it raises on any failed expectation) run inside `BEGIN … ROLLBACK` against a local database only, with its output recorded in the workplan.
- **E-67.** §11I.6 rollback paragraph: the order is `20261073` then `20261072`, and the fix-forward rule applies once rows exist.
- **E-68.** §11I.8 frozen-pins row and AC-231: Pin B stays byte-identical; a needed tile wire change stops for SA.
- **E-69.** §11I.7: the two-read shape and the 100-id chunking.

---

## 11J. Money M-8: mark the Platform dashboard and Exchange rates pages redundant

Specified 2026-10-17 from **BD-34** (which amends BD-25 and CR BQ-7), the CR M-8 row and inventory rows I-15 and I-19, LAY §2.3 X-1, X-2 and §3 rule 9, and the code at main `5c214310` (citations are `path:line` there). Nothing was checked in a browser or against the database. **UI short path, about 1 day. Nothing is deleted. No data, money, API logic, read, request or migration change.**

**Numbering note.** PR #447 (4b.1, §11I) claims AC-204 to AC-232 and SA-Q65 to SA-Q74 in this file, so M-8 starts at **AC-233** and **SA-Q75** to keep both PRs mergeable.

### 11J.0 Sign-off

BD-34 is the user's decision that nothing in the product uses or links to the two pages any more, and that both routes stay. The one sidebar change is the removal of the Platform dashboard item from the **hidden** "AgentsPilot (parked)" section; the visible sidebar (Monitor, Money, Businesses, Settings) does not change. BD-34 is recorded as the sign-off for exactly that removal, as §11H.0 did for M-5 (LAY X-1, X-2, rule 9). Under BD-33, M-8 proceeds on SA, QA and TL approval with no user step.

### 11J.1 Code facts (at `5c214310`)

| # | Fact | Evidence |
|---|---|---|
| CF-1 | Platform dashboard is `/admin/platform-dashboard`, one client file (578 lines). Its header already says URL-only (U-6) and "the user decides later whether it stays at all (FU-4)" | `app/admin/platform-dashboard/page.tsx:1`, `:23-33` |
| CF-2 | Its only data call is `/api/admin/dashboard?period=` | `platform-dashboard/page.tsx:106` |
| CF-3 | `/api/admin/dashboard` (GET and HEAD, `requireAdmin` first in each) has **no other caller** in `app/`, `lib/` or `components/`. Its only other references are the admin gate test and the route register | `app/api/admin/dashboard/route.ts:15-23`, `:274-283`; `app/api/admin/__tests__/adminGate.writes.test.ts:237`, `:341-342`; ADMIN_IDENTIFICATION register rows 22, 23 |
| CF-4 | The **only thing in the product that points at the dashboard** is its sidebar item in the hidden parked section, kept "so every admin page keeps exactly one sidebar entry". The sidebar header comment names its path. `LayoutDashboard` is imported only for that item | `app/admin/components/AdminSidebar.tsx:225-241`, `:66-69`, `:8` |
| CF-5 | The dashboard's own links to Businesses, AI calls & usage, learning system, AIS config and the agent queue lead **out** of it; they stay | `platform-dashboard/page.tsx:242-356`, `:520-573` |
| CF-6 | Exchange rates is `/admin/exchange-rates`, one client file (531 lines). It reads and writes `exchange_rates` from the browser (`supabaseClient`, `CurrencyService.updateRate`) and fetches `api.exchangerate-api.com` | `app/admin/exchange-rates/page.tsx:20-21`, `:64-72`, `:106-150`, `:167` |
| CF-7 | Exchange rates has no sidebar item and no link. The nav test lists it as unlisted and asserts the sidebar file never contains `exchange-rates` | `app/admin/components/__tests__/AdminSidebar.nav.test.ts:87-89`, `:192-194`; sidebar comment `:82-83` |
| CF-8 | Exchange rates has **no API route of its own**. `CurrencyService` is shared with the user settings currency picker and the currency helpers, so it is not "used only by" the page and is out of scope | `components/settings/CurrencySelector.tsx:9`; `lib/utils/currencyHelpers.ts:4` |
| CF-9 | Exchange rates has one `console.error` (CLAUDE.md rule 3: flagged; converted here because the file is touched). The dashboard and its route have none | `exchange-rates/page.tsx:92` |
| CF-10 | Tests that pin the two pages: the nav test (parked section has 15 items and contains the dashboard `:135-141`; the on-disk scan finds both routes `:160-170`; 29 hrefs `:179`; no `exchange-rates` in the sidebar `:192-194`) and the Health guards (no Health file links to the dashboard `health.source.guard.test.ts:67-69`, `health.render.test.tsx:241-246`; the dashboard is still a `'use client'` page with its fetch and Pino logger `health.source.guard.test.ts:146-153`) | as cited |
| CF-11 | Neither page is in the C-14 `MIGRATED_PAGES` registry or in the contrast guard's `PAGES` | `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts:511`; `app/admin/__tests__/contrast.lf1.source.guard.test.ts:56-64` |
| CF-12 | No `next.config.js` redirect and no `middleware.ts` rule names either route | search at `5c214310` |

### 11J.2 Scope

| In | Out |
|---|---|
| Remove the Platform dashboard item from the hidden parked section (and its now-unused icon import); reword the sidebar comments so the sidebar file names neither path | Deleting any page, route, file, table or service (BD-34) |
| The redundant header comment (RP-1) in both page files and in `app/api/admin/dashboard/route.ts` | Any change to a read, write, request, figure, period option or the external rates fetch |
| **No visible notice** (BD-34 reading, RP-4, E-71): the pages render exactly as today | Making Exchange rates read-only (FU-M8-1, a later step) |
| A source guard that nothing in `app/`, `lib/`, `components/` or `hooks/` links to either page, and that only the dashboard calls its route (RP-5) | `CurrencyService`, `CurrencySelector`, `currencyHelpers` (CF-8) |
| Exchange rates' one `console.error` converted to Pino (CF-9) | Moving either page onto the Admin Layout Standard; the other 14 parked pages |
| Pointer notes in the admin reorganisation requirement (U-6, S4-b), ADMIN_IDENTIFICATION (register rows 22, 23) and `docs/MULTI_CURRENCY_SYSTEM.md` (`:43`, `:233`, `:286` tell admins to visit `/admin/exchange-rates`; E-71) | Any browser look by the user at these parked AgentsPilot pages (they are parked) |

**Estimate:** about 0.75 day (sidebar and nav test 0.25 day; comments and logger 0.15 day; guard 0.15 day; verification and doc pointers 0.2 day). With no notice there is no page restructuring and no render test (E-71).

### 11J.3 Rules

- **RP-1 Header comment.** Exactly `REDUNDANT (BD-34, 2026-10-16): superseded by the Money area; kept, not deleted; do not extend or link.`, followed by one line saying why: the dashboard's AI cost is in AI calls & usage (all products); no figure uses an exchange rate (BD-12); the route's only caller is the redundant dashboard. In both pages it sits directly after `'use client'`, which stays the first line (CF-10). In the route it sits at the top of the file.
- **RP-2 Sidebar.** The parked section stays hidden and holds 14 items; the visible sections are unchanged. The sidebar file names neither `platform-dashboard` nor `exchange-rates`, comments included (the rule CF-7 already applies to Exchange rates).
- **RP-3 Routes stay.** Both pages still load by direct URL for an admin with today's content and behaviour, admin-only through the admin layout.
- **RP-4 No visible notice (BD-34 reading, E-71).** The user's instruction for M-8 was "no need to remove, we can just add comments it is redundant for now and not use them". The treatment is therefore **code comments only**. Neither page shows a notice, and neither page's markup or component structure changes. BQ-14 is resolved by BD-34 and is not sent to the user.
- **RP-5 No in-app use.** No non-test file under `app/`, `lib/`, `components/` or `hooks/` contains `/admin/platform-dashboard` or `/admin/exchange-rates` in its code (comments stripped), and only `app/admin/platform-dashboard/page.tsx` contains `/api/admin/dashboard`.
- **RP-6 Route unchanged.** `/api/admin/dashboard` gains only the comment: `requireAdmin` stays the first statement of GET and HEAD; the gate test and register rows 22 and 23 are unchanged.
- **RP-7 Logging.** Exchange rates logs through `createLogger({ module: 'AdminExchangeRates' })`, error as `{ err }`. No other change to that file's behaviour.

### 11J.4 Guards and tests affected

| Guard or test | Change |
|---|---|
| `AdminSidebar.nav.test.ts` | The unlisted list gains `/admin/platform-dashboard` (BD-34); parked count 15 → 14 and "contains the dashboard" becomes "does not contain it"; href count 29 → 28; new case: the sidebar file never contains `platform-dashboard` (beside the `exchange-rates` case). The on-disk scan's `toContain` lines for both routes (`:167`, `:169`) stay, which proves the routes are kept |
| `health.source.guard.test.ts`, `health.render.test.tsx` | **No edit.** "No link to the legacy dashboard" and "the legacy dashboard still exists as a client page" must stay green |
| `redundantPages.source.guard.test.ts` (new, `app/admin/__tests__/`) | RP-1 exact header in the three files; RP-2 sidebar; RP-4: no `redundant-page-notice` and no `AdminNotice` import in either page; RP-5 walk; no-dead-regex self-tests and a planted control for each rule (E-71). No render test: neither page's markup changes, and `git diff` proves it |
| `layoutFolder.guard.test.ts` (C-14) | **No edit.** Neither page joins `MIGRATED_PAGES`: they are not migrated and are not to be extended. Importing `AdminNotice` from outside the folder is allowed (S-3 governs files inside the folder) |
| `contrast.lf1.source.guard.test.ts` | **No edit.** Neither page joins `PAGES`; the notice uses `AdminNotice`'s amber text, never `text-slate-500` or `-600` |
| `adminGate.writes.test.ts`, `npm run test:authz-guard` | No edit; run (comment-only route change) |
| `aiCostVocabulary.source.guard.test.ts` | No edit; neither file is scanned, and the notice copy uses none of its forbidden words |
| Frozen pins (AC-173 pin and helper, Pins A, B, C with helper, D) | Not opened; hashes checked at the start and at handover |
| `npm run lint:hooks` | Run |

### 11J.5 Acceptance criteria

- [ ] **AC-233** The sidebar data holds no item for `/admin/platform-dashboard` or `/admin/exchange-rates`; the parked section is still hidden and holds 14 items; the visible sections and their items are unchanged; the sidebar file names neither path.
- [ ] **AC-234** No non-test file under `app/`, `lib/`, `components/` or `hooks/` links to either page, and only the Platform dashboard calls `/api/admin/dashboard` (RP-5).
- [ ] **AC-235** Both routes still load by direct URL for an admin, with today's content, requests and actions unchanged.
- [ ] **AC-236** *(amended by E-71, BD-34 reading)* Neither page shows a redundant notice. Each page file's diff is the RP-1 comment lines only, plus, for Exchange rates, the RP-7 logger lines.
- [ ] **AC-237** Both page files and `app/api/admin/dashboard/route.ts` carry the exact RP-1 header comment; both pages still start with `'use client'`.
- [ ] **AC-238** `/api/admin/dashboard` is unchanged apart from the comment: `requireAdmin` first, the same GET and HEAD responses; the gate test and `test:authz-guard` pass with no edit.
- [ ] **AC-239** A non-admin is refused on both routes, as today (admin layout).
- [ ] **AC-240** Exchange rates has no `console.*`; its history-load error logs through Pino with `{ err }`; nothing else in it changes.
- [ ] **AC-241** No data, money, read, request, migration or API logic change; `git diff --stat -- supabase lib/repositories lib/services` is empty.
- [ ] **AC-242** The frozen pins (AC-173 pin and helper, Pins A to D, C's helper) are byte-identical; the nav, Health, C-14, contrast and new redundant-page guards pass; the C-14 registry and the contrast `PAGES` are unchanged.

No manual step for the user: both pages are parked AgentsPilot pages. AC-235 and AC-236 are proven by the comment-only diffs, the nav test's on-disk scan and the Health guard's "still a client page" check (E-71).

### 11J.6 Open questions

| # | Question | BA's suggested answer |
|---|---|---|
| **SA-Q75** | Remove the dashboard's hidden sidebar item (it then joins the nav test's unlisted list), or keep the hidden item and only add comments? | Remove: BD-34 says nothing links to it, and the item exists only for the "one entry per page" rule, which the unlisted list already handles for Exchange rates |
| **SA-Q76** | How does the notice show in every state without editing the early returns? | Rename each page's component to an inner `…Content` function; the default export renders the notice, then the content. Hooks stay inside the inner component |
| **SA-Q77** | Notice: text only, or a link to Finance? | Text only. "Do not link" is about links **to** these pages; a link out is harmless but not needed |
| **SA-Q78** | The route: comment only, or also a log line or response header marking it redundant? | Comment only: any runtime marker is an API logic change |
| **SA-Q79** | One new source guard file, or extend the nav test? | A new `redundantPages.source.guard.test.ts`: RP-5 walks folders the nav test does not read |
| **SA-Q80** | Exchange rates still writes from the browser (CF-6). Record it only? | Record it as **FU-M8-1** (make it read-only or close the write); M-8 changes no behaviour |

**BQ-14: resolved by BD-34, not sent to the user (SA-RR-M8, E-71).** BD-34 says "just add comments it is redundant for now and not use them", so the answer is code comments only and no visible notice. Whether Exchange rates should stop accepting edits is a separate later choice (FU-M8-1); M-8 leaves it as it is.

---

## 11K. Slice 6b: margin after estimated Stripe fees, and KPI order

Specified 2026-10-17 from **BD-7** (BQ-7's default: "AI only, Stripe fee as an estimate"), **BD-22** (margin on revenue after tax), **BD-12** (no FX), **BD-35** (6b re-orders the tiles: revenue, then cost, then user and account data), BD-29 and BD-31 (tiles above the bar, clickable), DF-8, CR G-10 and the CR M-3 row, the 6a rules (§11E.3), the F-5 tile mapping (§11G) and the code at main `e43dcb60` (M-8 merged, #448). A read-only live check was run from the main checkout (§11K.1). **No migration, no new SQL function, no new table, no write, no new read and no new repository method.** It adds one pure fee-estimate step inside the 6a builder, one config entry as data, new payload fields beside the existing margin, and a new tile order.

**Numbering note.** PR #447 (4b.1, §11I, not on main) reserves AC-204 to AC-232, SA-Q65 to SA-Q74 and checks 23 to 26; M-8 used AC-233 to AC-242 and SA-Q75 to SA-Q80. 6b therefore starts at **AC-243**, **SA-Q81** and **check 27**. Its checks sit in this section, not in §13, so the two PRs do not touch the same lines.

**The question it answers.** "After the card processor takes its cut, is this account still worth it?" For the owner test account in October 2026: paid us USD 89.00 after tax (plan 79.00 + boost 10.00); estimated Stripe fees USD 3.18 (2.59 on the plan charge + 0.59 on the boost charge, at the default rate); margin after Stripe fees (estimate) = AI margin minus 3.18.

### 11K.1 Live facts and code facts (read-only, 2026-10-17)

Live: a SELECT-only probe from the main checkout (`e49a4719`; zero-row column probes, counts and amount columns only; no row written, no DDL). Code: read at `e43dcb60` in the 6b worktree. Checks 27 and 28 (§11K.9) were written against these facts and not executed by BA.

| # | Fact | Value |
|---|---|---|
| LF-1 | Client payments (layer B) record a Stripe fee | `payment_transactions.processor_fee`, `net_amount`, `fee_currency` exist; 70 of 128 rows carry a `processor_fee` (Section 2 block B already shows them, slice 2) |
| LF-2 | **Plan payments record no fee** | `business_os_billing_events` (10 rows): no fee-like column; `processor_fee` and `fee_minor` both refused (42703). Two `invoice_paid` rows, both `usd`: `amount_minor` 7900 and 4414 (account and month of the second not checked) |
| LF-3 | **Boost purchases record no fee** | `business_os_boost_purchases` (1 row): no fee-like column; `processor_fee`, `fee_minor`, `stripe_fee_minor` refused (42703). The row: `paid`, `USD`, total 1000, refunded 0 |
| CF-1 | One builder already owns the margin | `lib/business-os/finance/accountEconomics.ts`: `buildPaid`, `buildCost`, `buildMargin` (SA-W82 precedence, SA-W75 integer subtraction at the ledger scale), used by `buildAccountEconomics` (tab and platform line) and `buildAccountMargin` (one-account summary) |
| CF-2 | A charge is already defined | Boost rows in `BOOST_PAID_FAMILY` read by `readMoney`; plan rows of `PLAN_PAYMENT_KIND` read by `readPlanMoney`; a readable zero invoice is not a payment (M2-W-5) |
| CF-3 | Thresholds are already data | `lib/business-os/finance/financeRules.ts` holds `FINANCE_RULES`, `FINANCE_METRIC_PARAMS` (`farOverAllowancePercent: 150`) and a range check (`FAR_OVER_ALLOWANCE_PERCENT_RANGE`) |
| CF-4 | The tile order lives in one component | `app/admin/finance/components/FinanceKpiStrip.tsx` renders K-1, K-2, K-3, K-4, K-5 in that order as children of the shared `KpiStrip`; the shared `KpiStrip.tsx` holds no Finance order |
| CF-5 | Pin B does not read order | `financeTiles.pin.render.test.tsx` (`24ff0da7…df9f`) finds each tile by `data-testid`, checks status and text, and counts five; its header says the line order is not pinned, by design. Pin A (`KpiStrip.callers.pin.render.test.tsx`, `30f5fc24…2e01`) covers the other ten callers, not Finance |
| CF-6 | **Vocabulary guard** | `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` scans `financeCopy.ts` and forbids the word **"estimated"** (SA-Q51 list, case-insensitive, substring). The label "Margin after estimated Stripe fees" would trip it; see FE-12 and SA-Q86 |
| CF-7 | Existing copy that stays true | `financeCopy.ts`: "Stripe fees are not deducted" (6a note, about the AI margin) and "Real Stripe fees (none are recorded for our payments yet)" (cannot-show list) |

### 11K.2 Scope

| In scope | Not in scope |
|---|---|
| The fee-estimate rule and its config (§11K.3); "Margin after Stripe fees (estimate)" **beside** the AI margin on the Accounts tab rows, the platform margin line and the one-account summary (§11K.5); the BD-35 tile order (§11K.6); BQ-15 recorded with its default | Replacing or changing the AI margin, its value, rules, sort or filter; real Stripe fees (none recorded, LF-2, LF-3; a webhook writer change); dispute fees; Stripe Billing, Stripe Tax, international-card or currency-conversion surcharges (BQ-15); any FX (BD-12); **anything that needs 4b.1's table** (`business_os_boost_reversal_events`, PR #447: refund-month dating of refunds stays with 4b.2); the margin per current plan (BD-8) and K-7 (a sixth tile is over the layout standard's five-tile maximum; both stay in the slice 6 row for a later decision); any tile value, status, label, link or test id change |

### 11K.3 The estimate rule and config

| # | Rule |
|---|---|
| FE-1 | **What a charge is.** One successful card charge per counted platform payment, from the rows the 6a builder already reads: each **plan payment** counted by M2-W-2 to M2-W-5 with an amount above 0, and each **boost purchase** in the paid family (`paid`, `partially_refunded`, `refunded`, `disputed`, `dispute_lost`, through the exported `BOOST_PAID_FAMILY`, no status literal) **with a total above 0**. A readable zero invoice is not a charge (M2-W-5), and a boost whose total is 0 is not a charge either: no money moved, so there is no card fee (E-72, SA-W-6b-4; checks 27 and 28 carry `and b.amount_total_minor > 0`). |
| FE-2 | **Formula, per charge, in integer minor units of the charge's currency:** `fee_minor = round_half_up(gross_minor × percent_bps / 10000) + fixed_minor`, where `gross_minor` is the amount **charged, tax included** (plans `amount_minor`; boosts `amount_total_minor`), because Stripe takes its fee on the amount charged. Integer form: `(gross_minor × percent_bps + 5000) div 10000 + fixed_minor`, checked with `Number.isSafeInteger`. Fees are rounded **per charge**, then summed. |
| FE-3 | **Default values (BQ-15, an estimate, not a recorded fee):** USD only: `percent_bps` = **290** (2.9%), `fixed_minor` = **30** (USD 0.30). This is Stripe's standard published price for a domestic card charge, the same assumption as the boost requirement's markup table (2.9% + USD 0.30, flagged there as an assumption to verify). Worked examples at the default: a USD 79.00 plan charge = 2.29 + 0.30 = **USD 2.59**; a USD 44.14 plan charge = 1.28 + 0.30 = **USD 1.58**; a USD 10.00 boost = 0.29 + 0.30 = **USD 0.59**. |
| FE-4 | **Config is data, never a literal in logic.** One exported, read-only entry, `STRIPE_FEE_ESTIMATE`, a map from currency code to `{ percentBps, fixedMinor }`, holding only `USD` today, with a range check beside it in the style of `FAR_OVER_ALLOWANCE_PERCENT_RANGE` (`percentBps` an integer 0 to 1000, `fixedMinor` an integer 0 to 1000; a value out of range makes every fee Unknown, never a guessed fee). The builder takes it as an **input parameter** (SA-WR-4: pure; the formula imports no rate), so tests can pass other rates. Its file is SA-Q81. Changing the rate later is a one-line data change with no logic change. |
| FE-5 | **Refunds.** A refunded or partly refunded charge **keeps its fee**: Stripe does not normally return its processing fee on a refund. The fee is counted on the gross charge, in the month of the charge (`paid_at`), whatever happens to the charge later. This is part of the estimate and the note says so (§11K.5). |
| FE-6 | **Disputes.** A `disputed` or `dispute_lost` charge keeps its processing fee (FE-5). The separate fee Stripe charges for a dispute is **not** estimated in 6b (BQ-15 (c)); the note says so. |
| FE-7 | **Dating.** A charge's fee is dated by the charge (`paid_at`), the same column as its revenue (M3-W-1), so the fee and the revenue it belongs to are always in the same window. 4b.2's refund-month rule (BD-17, needs 4b.1's table) moves refund amounts, never fees, and is out of scope. |

### 11K.4 Margin and currency rules

| # | Rule |
|---|---|
| FE-8 | **Margin after Stripe fees (estimate) = AI margin minus the estimated fees**, in USD, computed in the builder at the ledger scale. It is integer and safe-integer checked, with one division at the edge (SA-W75). The fee is subtracted from the revenue **in minor units, before the one scale step**: `(revenue_minor − fee_minor) × MINOR_TO_COST_UNITS − cost_units`. That equals `(revenue × k − cost) − fee × k` exactly, and it keeps the 6a pin of a single multiply (E-74, SA-W-6b-2). The AI margin is **never replaced or changed**; the new figure is shown beside it. |
| FE-9 | **Same currency, and only when exact.** A figure is shown only when the AI margin of the same row (or the platform line, or the one account) is a figure under M3-W-4, **and** every USD charge of that row was readable with a config entry for USD, **and** the fee sum is a safe integer. Otherwise the cell takes the AI margin's word, in the same SA-W82 precedence: **"Not available: AI cost is charged only from 29 Sep 2026"** (window before the cut-over) > **"n/a, different currency"** (any non-USD line, so no fee is ever estimated in another currency today, and no USD-only partial) > **Unknown** (a failed or ceiling read, an inexact line, an unreadable charge, an out-of-range config, an overflow). USD is the only currency with a config entry. Any non-USD line already gives "n/a, different currency" through the AI margin, so a figure is only ever computed for USD. **A missing or out-of-range USD entry is a config fault:** every margin-after-fees cell reads Unknown, the section's fee note reads "Stripe fees are an estimate: none are recorded for plan or boost payments. The assumed fee could not be read, so no margin after Stripe fees is shown.", and the AI margin is unaffected (E-73, SA-W-6b-5). Unknown is never 0. |
| FE-10 | **No revenue.** An account with no charge in the window has estimated fees **0** (exact) and its margin after fees equals its AI margin, with the AI margin's "No revenue in this window" note. |
| FE-11 | **Estimated fees shown too.** Each figure cell carries a second small line "Stripe fees, estimate: USD X" (the fee sum, `formatMoney`, USD), so the reader sees what was taken off. When the margin after fees is not a figure, the fee line is not shown. |
| FE-12 | **Wording (CF-6).** Every new string says **"estimate"**, never the guarded word "estimated", so `aiCostVocabulary.source.guard` passes with no ALLOWED entry and no edit (SA-Q86). |
| FE-13 | **Platform line.** The platform line (M3-W-9) gains the same two figures over every account and the Deleted accounts row, before any filter and cap, by the same functions (E-47 precedent). |
| FE-14 | **One account.** `buildAccountMargin` gains the same two figures from the account-scoped reads, so the Accounts row and the one-account summary show the same figure for the same window (the AC-142 rule extended). |
| FE-15 | **Sort and filter unchanged.** "AI margin, lowest first" and "Negative AI margin" keep reading the AI margin; no new option in 6b (SA-Q84). |
| FE-16 | **No client arithmetic** (M3-FR-13): the fee, the subtraction, every word state and the config values shown in the note come from the payload. The client formats only. |
| FE-17 | **Logs and payload:** the route's info line gains no amount and no rate (SEC-8); the payload gains no Stripe id, tier literal or `livemode`. |

### 11K.5 Display

| Where | Change |
|---|---|
| Accounts tab table | A new column **"Margin after Stripe fees (estimate, USD)"** directly after "AI margin (USD)": the figure through `formatUsd` (sign kept, as the AI margin), or the FE-9 word; the FE-11 fee line under a figure. The Deleted accounts row gets the same cell. |
| Platform margin line (above the table) | A new pair under "AI margin": **"Margin after Stripe fees (estimate)"** and **"Stripe fees, estimate"**. |
| One-account summary | A new line **"Margin after Stripe fees (estimate, USD)"** directly under "AI margin (USD)", with the FE-11 fee line. |
| Accounts tab notes (always shown) | One new note: **"Stripe fees are an estimate: none are recorded for plan or boost payments. Assumed {percent}% + {currency} {fixed} per card charge. A refunded charge keeps its fee. Dispute fees are not included."** The values come from the payload's copy of the config (FE-16), so the text cannot drift from the rate used. The 6a note is reworded so it is clearly about the AI margin column: **"Paid us is after tax, net of refunds and disputes. The AI margin does not deduct Stripe fees."** |
| Never | The word "actual", "real" or "recorded" beside a fee; a fee in Section 2 block A (Our revenue) or on K-5 (they stay "Stripe fees not deducted"); removing the "Real Stripe fees" cannot-show item (it stays true) |

### 11K.6 KPI tile order (BD-35)

Order only. Every tile keeps its id, test id, label, value, status, sub-line, headline, link or jump target (BD-31, SA-W7) and the placeholder count (five). The strip stays above the filter bar on both tabs (BD-29). Keyboard and reading order follow the new DOM order.

| Position | Before (F-5) | After (6b) | Group (BD-35) |
|---|---|---|---|
| 1 | K-1 Charged AI cost this month | **K-5 Our revenue** | Revenue |
| 2 | K-2 Accounts far over allowance | **K-1 Charged AI cost this month** | Cost |
| 3 | K-3 Founding Partners with no end date | **K-3 Founding Partners with no end date** | Accounts (plan) |
| 4 | K-4 Gifted credits outstanding | **K-2 Accounts far over allowance** | Accounts (credit use) |
| 5 | K-5 Our revenue | **K-4 Gifted credits outstanding** | Accounts (credits given) |

K-3 leads the account group because it is about who the accounts are; K-2 and K-4 are both about credits and sit together, use before gifts. The change is in `FinanceKpiStrip.tsx` only; the shared `KpiStrip` and `KpiTile` do not change.

### 11K.7 Guards and tests affected

| Guard or test | Effect | What Dev must do |
|---|---|---|
| **Frozen pins** | AC-173 pin `3a1a2dd4…f6f8` and helper `b84e0c96…aabf`; **Pin A** `30f5fc24…2e01`; **Pin B** `24ff0da7…df9f`; **Pin C** `98ea0507…1e4b` and helper `02813360…5bd8`; **Pin D** `1f7cf07a…f144` | All **byte-identical** (LF-normalised), hashes checked at Step 0 and at handover. BA reading (CF-5): Pin B does not pin order, so the reorder leaves it green and unedited; Pin A is untouched because `KpiStrip` is. If SA finds otherwise, **one** ruled re-freeze, as E-55, with the new hash recorded (SA-Q87, SA-Q88) |
| New tile-order test | Pins the §11K.6 order | A new render case (not in Pin B): the five tile test ids follow the new DOM order on Overview and on the Accounts tab, five placeholders while loading |
| `aiCostVocabulary.source.guard.test.ts` | Scans `financeCopy.ts` (CF-6) | No edit and no ALLOWED entry: the new strings say "estimate" (FE-12). The `financeCopy.ts` text floor (439) can only rise |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | Builder changes; config entry added | The builder stays pure (no repository, data layer, entitlements or clock import); the "no cross-currency total" control covers the fee step; the DF-5 zero-token pin on `accountEconomics.ts` stays at zero (no `amount_refunded_minor`, `'disputed'` or `'dispute_lost'`); no new export from `boostRevenue.ts` or `planRevenue.ts` (the 6a export pins unchanged). A new rule, with a planted control, fails a numeric fee literal in `accountEconomics.ts` |
| `app/admin/finance/__tests__/source.guard.test.ts` | New cells and lines | Type imports only; no arithmetic on money in components; no `console.` |
| Route tests, AC-145 Overview baseline | `accountEconomics` and `accountMargin` gain fields | Without `tab` and with no business picked: same reads and payload as before (AC-145 unchanged). The picked-business payload's `accountMargin` gains the fields: SA-Q85 rules whether that touches the baseline (one ruled update, as E-55, if it does) |
| Repository caller lists, `serviceColumn.guard`, webhook placement guards, `tierLiteral.forbidden`, `test:bos-entitlements` | Not tripped (no new read, no `lib/business-os/billing/` file, no tier literal, no entitlements import) | Run unchanged |
| `layoutFolder.guard` (C-14), contrast LF-1 | Finance components touched | Run; no exclusion added |
| `financeUrl.test.ts`, `FINANCE_URL_KEYS`, AC-173 | No URL or request change | Run unchanged |

Dev runs before SA code review and pastes in the workplan: `npm run test:bos-entitlements`, `npm run test:authz-guard`, the finance, layout and Health suites, the vocabulary guard, `npm run lint:hooks`, eslint on touched files, the scoped `tsc` with canary (AC-44), and the seven pin hashes. No new CI job and no added critical-path time.

### 11K.8 Acceptance criteria

All testable by Jest or by QA's recorded manual check. Figures are compared with checks 19, 20, 27 and 28 run at test time.

- [ ] **AC-243** **Formula (unit):** at the default rate, gross 7900 gives fee 259, 4414 gives 158, 1000 gives 59; a zero invoice is no charge; an exact half rounds up (gross 500: 145,000 + 5,000 div 10,000 = 15, plus 30 = 45) and below half rounds down (gross 499 gives 14 + 30 = 44); fees are rounded per charge, then summed.
- [ ] **AC-244** **Config is data:** the builder takes the rate as a parameter; a test passing 350 / 25 changes every fee with no code change; an out-of-range value (`percentBps` 1001, a fraction, a negative) makes every fee and margin after fees Unknown; no fee literal (290, 30, 0.029, 0.3) appears in `accountEconomics.ts` (source guard with a planted control).
- [ ] **AC-245** **Which charges:** a plan payment above 0 and each paid-family boost are one charge each; a zero invoice, a paid-family boost with total 0 (E-72), a refused plan row and a boost outside the paid family are not; `refunded`, `partially_refunded`, `disputed` and `dispute_lost` boosts keep their fee on the gross total.
- [ ] **AC-246** **Margin after fees** per account equals check 19 `ai_margin_usd` minus check 27 `usd_fee_minor` / 100, for every row where both are figures; the AI margin column is unchanged from before 6b for the same fixture.
- [ ] **AC-247** **Word states:** before the cut-over the new cell reads "Not available: AI cost is charged only from 29 Sep 2026"; an account with an ILS boost (alone or beside USD) reads "n/a, different currency" with no fee line; a ceiling, a failed read, an unreadable charge or an inexact refund reads Unknown, never 0; precedence as SA-W82.
- [ ] **AC-248** **No revenue:** an account with AI cost and no charge shows fees 0 and a margin after fees equal to its AI margin.
- [ ] **AC-249** **Platform line:** "Margin after Stripe fees (estimate)" and "Stripe fees, estimate" cover every account and the Deleted accounts row, are unchanged by any filter, sort or cap, and equal check 20's margin minus check 28 `usd_fee_minor` / 100.
- [ ] **AC-250** **Same figure both ways:** for the owner test account and October 2026, the Accounts row and the one-account summary show the same margin after fees, and the fee line reads USD 3.18 while only its two known charges (plan 79.00, boost 10.00) fall in the window.
- [ ] **AC-251** **Labels:** the new column, platform pair, summary line and note read exactly as §11K.5; the note's rate comes from the payload; every new string says "estimate"; none says "actual", "real" or "recorded" beside a fee; K-5 and Our revenue still say "Stripe fees not deducted".
- [ ] **AC-252** **Sort and filter unchanged:** each sort and Show option orders and narrows exactly as before 6b for the same fixture (they read the AI margin, FE-15).
- [ ] **AC-253** **Tile order:** on Overview and on the Accounts tab, with and without a business picked, the tiles render K-5, K-1, K-3, K-2, K-4 in DOM order; five placeholders while loading; every tile value, status, label, link and jump target equals the value before 6b (Pin B passes unedited).
- [ ] **AC-254** **No client arithmetic, logs, payload:** the components compute no fee, sum or difference (source test); the route info line carries no amount or rate; the payload has no Stripe id, tier literal or `livemode`; the Overview payload with no tab and no business is unchanged (AC-145).
- [ ] **AC-255** **Guards and read-only:** every §11K.7 row passes; the seven frozen pins are byte-identical (or re-frozen once by SA ruling, recorded); the vocabulary guard passes with no edit; no write, migration, SQL function, read or repository method added; scoped `tsc` with canary.
- [ ] **AC-256** **Manual QA (L-142 to L-147; PR #447 holds L-137 to L-141):** open Finance, This month: the tiles read Our revenue, Charged AI cost, Founding Partners, Accounts far over allowance, Gifted credits; open Accounts: the owner test account shows its AI margin and, beside it, its margin after Stripe fees (estimate) with the fee line, matching checks 19 and 27; the platform line matches checks 20 and 28; open the row and see the same two lines in the one-account summary; set a window starting 2026-09-15 and see "Not available" in both margin cells; record it in the workplan.

### 11K.9 SQL cross-checks (27 and 28)

Read-only, ASCII only, no apostrophes in comments, one final result set each. Test and live together (BD-14). Amounts are **minor units** (divide by 100). The rate is the **6b default** written in each check; if the config changes, change `pct_bps` and `fixed_minor` to match. Margin after fees = check 19 `ai_margin_usd` minus check 27 `usd_fee_minor` / 100 (per account), and check 20 margin minus check 28 `usd_fee_minor` / 100 (platform). Written against §11K.1; not executed by BA.

**File:** `check 27 - estimated Stripe fees per account this month` (AC-243, AC-245, AC-246, AC-250, AC-256)

```sql
-- Finance page check 27: estimated Stripe fees per account in one UTC month, read only.
-- Compare with the fee line under the margin after Stripe fees on the Accounts tab.
-- The month is the current UTC month. To check another month, replace null in the
-- p block below with a quoted UTC month start, such as 2026-10-01 00:00:00+00.
-- The rate is the 6b default: 290 basis points plus 30 minor units per charge, USD only.
-- One charge per plan payment above 0 and per boost in the paid family.
-- The fee is on the gross amount charged, tax included, rounded half up per charge.
-- A refunded or disputed charge keeps its fee. Dispute fees are not included.
with p as (
  select coalesce(null::timestamptz, date_trunc('month', now(), 'UTC')) as month_start,
         290::bigint as pct_bps,
         30::bigint as fixed_minor
),
charges as (
  select coalesce(e.user_id::text, 'deleted accounts') as account,
         upper(btrim(e.currency)) as currency,
         e.amount_minor::bigint as gross_minor
  from public.business_os_billing_events e
  cross join p
  where e.kind = 'invoice_paid'
    and e.amount_minor > 0
    and e.paid_at >= p.month_start
    and e.paid_at < p.month_start + interval '1 month'
  union all
  select coalesce(b.user_id::text, 'deleted accounts') as account,
         upper(btrim(b.currency)) as currency,
         b.amount_total_minor::bigint as gross_minor
  from public.business_os_boost_purchases b
  cross join p
  where b.status in ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost')
    and b.amount_total_minor > 0
    and b.paid_at >= p.month_start
    and b.paid_at < p.month_start + interval '1 month'
)
select
  c.account,
  count(*) filter (where c.currency = 'USD') as usd_charges,
  count(*) filter (where c.currency is distinct from 'USD') as other_currency_charges,
  coalesce(sum((c.gross_minor * p.pct_bps + 5000) / 10000 + p.fixed_minor)
    filter (where c.currency = 'USD'), 0) as usd_fee_minor
from charges c
cross join p
group by c.account
order by 4 desc, 1;
```

**File:** `check 28 - estimated Stripe fees for the platform this month` (AC-249, AC-256)

```sql
-- Finance page check 28: estimated Stripe fees over every account in one UTC month, one row, read only.
-- Compare with the platform line pair Stripe fees, estimate and margin after Stripe fees.
-- Same month rule, rate and charge rule as check 27. Deleted accounts are included.
-- A non USD charge anywhere means the platform margin after fees reads n/a, different currency.
with p as (
  select coalesce(null::timestamptz, date_trunc('month', now(), 'UTC')) as month_start,
         290::bigint as pct_bps,
         30::bigint as fixed_minor
),
charges as (
  select upper(btrim(e.currency)) as currency,
         e.amount_minor::bigint as gross_minor
  from public.business_os_billing_events e
  cross join p
  where e.kind = 'invoice_paid'
    and e.amount_minor > 0
    and e.paid_at >= p.month_start
    and e.paid_at < p.month_start + interval '1 month'
  union all
  select upper(btrim(b.currency)) as currency,
         b.amount_total_minor::bigint as gross_minor
  from public.business_os_boost_purchases b
  cross join p
  where b.status in ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost')
    and b.amount_total_minor > 0
    and b.paid_at >= p.month_start
    and b.paid_at < p.month_start + interval '1 month'
)
select
  count(*) as charges,
  count(*) filter (where c.currency = 'USD') as usd_charges,
  count(*) filter (where c.currency is distinct from 'USD') as other_currency_charges,
  coalesce(sum((c.gross_minor * p.pct_bps + 5000) / 10000 + p.fixed_minor)
    filter (where c.currency = 'USD'), 0) as usd_fee_minor
from charges c
cross join p;
```

### 11K.10 Open questions for SA (slice 6b)

Technical only. The one business assumption, the fee rate, is **BQ-15** (§0.4); it does not block the build.

| # | Question | BA suggestion |
|---|---|---|
| **SA-Q81** | Where does `STRIPE_FEE_ESTIMATE` live: in `financeRules.ts` beside `FINANCE_METRIC_PARAMS`, a new data file in `lib/business-os/finance/`, or a database setting? | A code data constant in `financeRules.ts` (the BD-11 "thresholds are data" precedent), passed to the builder by `financeHealth.ts`. A database setting is a new pattern and a migration, out of 6b |
| **SA-Q82** | Fee on the gross amount charged (tax included) or on the after-tax revenue? | Gross: Stripe takes its fee on what it charged; the after-tax rule (BD-22) is about what we earn, not about the fee base |
| **SA-Q83** | Round per charge (half up, integer) and sum, or sum the grosses and round once? | Per charge: that is how a processor fee arises, and it keeps checks 27 and 28 exact |
| **SA-Q84** | Sort and filter: keep them on the AI margin (FE-15), or add "Margin after Stripe fees, lowest first"? | Keep them on the AI margin in 6b; the estimate is a second view, not the ranking key. A new option is a later, small change |
| **SA-Q85** | Payload: the new fields sit inside `accountEconomics` rows, its platform line and `accountMargin`, plus one copy of the config for the note. Does the `accountMargin` change touch the AC-145 baseline (picked-business payload)? If so, one ruled update as E-55? | Yes to the shape; the no-tab, no-business baseline stays byte-identical; if the picked case is in the baseline, one ruled update with the new hash recorded |
| **SA-Q86** | The vocabulary guard forbids "estimated" in `financeCopy.ts` (CF-6). Use "estimate" wording (FE-12, no guard edit), or add one ALLOWED entry for the fee strings? | "Estimate" wording: an ALLOWED entry is a substring exemption for the whole file and would also let the word back in for AI cost, which the guard exists to stop |
| **SA-Q87** | **Pin B and order.** BA reads Pin B as not pinning tile order (CF-5: lookup by test id, a count of five, line order excluded by its header). Confirm it stays byte-identical and green after the reorder. If SA finds that any assertion depends on order, how is it updated honestly? | Confirm unedited. If an order dependency exists, **one** ruled re-freeze, as E-55: the only change is the order expectation, the new hash is recorded in §0.3 and in the workplan, and no value or status literal changes |
| **SA-Q88** | **Pin A.** The reorder lives only in `FinanceKpiStrip.tsx` (CF-4); the shared `KpiStrip` and the ten other callers are untouched. Confirm Pin A needs no edit | Confirm: no shared-component change, so Pin A is byte-identical |
| **SA-Q89** | The order test: a new case in `financePage.render.test.tsx` (or a new small file), never in Pin B? | A new case in the page render test; Pin B stays frozen |
| **SA-Q90** | Path: full cycle for the fee (new money logic, payload fields), with the reorder in the same workplan and PR, under BD-33's fast track? | Yes: one workplan, one PR, full cycle; BD-33 applies (no migration, and BQ-15 does not block) |
| **SA-Q91** | Landing order with 4b.2 (PR #447's second part edits `accountEconomics.ts` for the refund-month rule) | 6b needs nothing from 4b.1. Whichever lands second rebases; FE-7 keeps fees on the charge month, so the two rules do not conflict |

### 11K.11 Estimate

**About 1.75 days** (inside BD-32's 1.5 to 2): config and the fee step in the builder, with unit tests, about 0.5 day; payload and wiring in `financeHealth.ts` and the route about 0.25 day; the column, the platform pair, the summary line and the note about 0.5 day; the tile reorder and its test about 0.25 day; guards, pin hashes, checks 27 and 28 and QA about 0.25 day.

---

## 11L. Slice DF-6: since it started (one account)

Specified 2026-10-17 from **BD-26** (CR BQ-9: "Yes to a 'since it started' view for one account, beyond the 92-day cap, only when one account is picked, starting from the charging cut-over"), CR G-9 and **CR SA-Q-6** ("raise the 92-day cap for account-scoped reads only; bounded below by the cut-over; the ledger per account is small"), **BD-32** (DF-6 after 6b, about 1.5 days), **BD-33** (fast track), **BD-30** (U-4), the 6a and 6b margin rules (§11E.3, §11K.4) and the code on `feature/bos-finance-health-df6` (cut from the 6b tip `ea56ad04`, which includes 6b). **No migration, no new SQL function, no new table, no write, no new read and no new repository method.** It adds one window choice, valid only with a business picked, resolved on the server from the cut-over constant and the request clock (E-75).

**Numbering note.** PR #447 (4b.1, §11I, not on main) reserves AC-204 to AC-232, SA-Q65 to SA-Q74, checks 23 to 26 and L-137 to L-141; M-8 used AC-233 to AC-242 and SA-Q75 to SA-Q80; 6b used AC-243 to AC-256, SA-Q81 to SA-Q91, checks 27 and 28 and L-142 to L-147. DF-6 therefore starts at **AC-257**, **SA-Q92**, **check 29** and **L-148**. As in 6b, its checks sit in this section, not in §13, so this PR and #447 do not touch the same lines.

**The question it answers.** "Has this customer been worth it, since we started charging?" For the owner test account: everything it paid us, everything it cost us in charged AI, the AI margin and the margin after Stripe fees (estimate), from 29 Sep 2026 to now, on one screen, even once that span is longer than 92 days.

### 11L.1 Code facts (read at `ea56ad04`, 2026-10-17)

No live query was needed: DF-6 adds no read. Checks 29 and 30 (§11L.9) were written against these facts and the live facts of §11E.1 and §11K.1, and not executed by BA.

| # | Fact | Where |
|---|---|---|
| CF-1 | **The 92-day cap is a route and page rule, not a read rule.** `customRangeProblem` (shared `adminWindowPresets.ts`, `ADMIN_WINDOW_MAX_DAYS = 92`, pinned equal to `CREDIT_REPORT_LIMITS.MAX_WINDOW_DAYS`) is applied by the finance route's strict Zod schema (`superRefine`, custom windows only) and by the page's URL parser (`financeFilters.ts`). No finance read checks the window length | `app/api/admin/business-os/finance/route.ts` `buildQuerySchema`; `app/admin/finance/financeFilters.ts` `financeWindowField` |
| CF-2 | **Every account-scoped read already has a row ceiling** and reports reaching it: the ledger read (`FINANCE_LIMITS.LEDGER_CEILING` 20,000, `reachedCeiling`), client payments and refunds (`FINANCE_READ_LIMITS.CLIENT_CEILING` 5,000, the `>=` rule), boost and plan payments (same paging), the recorded AI cost read (`TOKEN_USAGE_READ_LIMITS.MAX_CEILING` 5,000). An inexact or ceiling read already gives "At least X" or Unknown (AGG-3) | `financeHealth.ts`, `BusinessOsFinanceReadRepository.ts`, `TokenUsageRepository.ts` |
| CF-3 | **The cut-over is an instant**, `CHARGING_CUTOVER_FLOOR_MS` = 2026-09-29 16:50:53.914 UTC. `cutoverClamp(start, end)` gives `after_cutover` only when the window starts at or after it; a whole-day window from 2026-09-29 00:00 UTC is `starts_before_cutover`, and every margin then reads "Not available" (`buildMargins`) | `lib/business-os/credits/aiActivity.ts:146, :219` |
| CF-4 | **The picked account's plan row is read first**, before any other read (`findPlanForAccount`, step 1, SEC-3); it carries `onboarding_started_at` and `profile_created_at` ("facts: written once by the provisioning triggers") and `created_at`. **`created_at` is not the account's start:** for every backfilled account it is the moment the backfill ran (repository comment on `findRecentOnboardedPlans`). **Since E-75, DF-6 uses none of these facts** for its window | `financeHealth.ts` step 1; `BusinessOsAccountPlanRepository.ts:41-61, :413-416` |
| CF-5 | **The shared Window control already supports a page's own extra windows** (`ADMIN_WINDOW_EXTRAS`, `windowFilter({ extras })`, `DatePresets extras`), opt-in per page, so a page that lists none ignores the value (U-4). Names use underscores (`this_week`, `last_month`) | `app/admin/components/layout/adminWindow.ts:16-18, :48`, `DatePresets.tsx:74` |
| CF-6 | **Links out carry the window** in the target's keys (`financeLinks.ts`): Activity and Charge checks take `range=<preset>` or `range=custom&from&to`; AI calls & usage takes `today` / `this_month` or custom dates. Activity's and Charge checks' routes cap custom windows at 92 days | `app/admin/finance/financeLinks.ts`; `app/api/admin/business-os/ai-activity/route.ts:121`; `.../credits/report/route.ts:78` |
| CF-7 | **No time buckets.** The page has no monthly or daily trend; every section is a total for the window or a state as of now. Slice 8 (history snapshots) is where trends belong | `lib/business-os/finance/*`, `app/admin/finance/components/*` |
| CF-8 | **No timezone is read by the page.** Windows resolve in UTC (TZ-1); no finance file reads `user_preferences.timezone` | `grep` over `lib/business-os/finance/` and `app/admin/finance/` |
| CF-9 | **The AC-173 request pin** (`financeRequestPins.ts`, 15 rows) holds no row with a since-start value, and its self-check requires every request to start `?preset=` | `app/admin/finance/__tests__/financeRequestPins.ts` |

### 11L.2 Scope

| In scope | Not in scope |
|---|---|
| One new window choice, **"Since it started"**, offered only with one business picked; its server-side resolution (§11L.3); the route's validation change (§11L.4); the URL value and U-4 behaviour (§11L.5); how every tile and section reads over it (§11L.6); its link-out rule (DF6-FR-9); checks 29 and 30 | The choice with **all businesses** (BD-26: refused); the Accounts tab (it is all businesses only, SA-W84); any change to the 92-day cap for Today, 7 days, 30 days, This month or Custom; any time bucket or trend line (CF-7, slice 8); the account's own local clock (§11L.3 DF6-W-4); history before the cut-over; any new read, repository method, SQL function or migration; raising any read ceiling; the 92-day caps of Activity, Charge checks and AI calls & usage |

### 11L.3 Window rules

| # | Rule |
|---|---|
| DF6-W-1 | **Start (E-75, DF6-F1).** The window starts at **the charging cut-over instant**, `CHARGING_CUTOVER_FLOOR_MS` (2026-09-29 16:50:53.914 UTC, CF-3), for every account. No plan-row fact is used (not `onboarding_started_at`, not `profile_created_at`, never `created_at`): an account newer than the cut-over simply has no rows before it starts, so the totals are the same and no row can be dropped. Because the start is the cut-over instant, coverage is always `after_cutover` (CF-3), so the margins are figures, not "Not available". |
| DF6-W-2 | **End.** The window ends at **now**, the request's one clock (`now`, exclusive end), not at the end of today. The end is never a client value. |
| DF6-W-3 | **Resolved on the server only (E-75, SA-Q92).** The client sends only the choice and the account id. The route resolves the window by a pure `since_start` branch of `resolveFinanceWindow` (`now` passed in): `start` = `CHARGING_CUTOVER_FLOOR_MS`, `end` = `now`, `from` = `2026-09-29`, `to` = today UTC. No plan row is needed and the builder is unchanged. Any `from` or `to` sent with the choice is format-checked and **ignored**, as for every preset (SA-W6). |
| DF6-W-4 | **Timezone.** `user_preferences.timezone` is the authority for an account's clock (CLAUDE.md); `business_profiles.timezone` does not exist and is never selected. DF-6 has **no day or month boundary to place**: both ends are instants (DF6-W-1, DF6-W-2), so the window does not depend on any timezone and nothing reads `user_preferences.timezone`. Labels stay UTC (TZ-1). If a later slice shows the account's own local dates (for example monthly buckets in its clock), `user_preferences.timezone` is the only source and NULL ("not asked") is labelled UTC, never assumed. |
| DF6-W-5 | **Payload window.** `window.preset` = `since_start`; `window.start` = the start instant (ISO); `window.end` = now (ISO); `window.from` = the UTC date of the start; `window.to` = today's UTC date. `from` and `to` are labels and link inputs only; no read uses them. |
| DF6-W-6 | **Read ceilings are unchanged** (CF-2). The window passes through the same reads with the same page sizes and ceilings as a 92-day window. A read that reaches its ceiling gives "At least X", "partial" or Unknown under AGG-3 and the per-section rules already in force (Section 3's charged figure, M-4's recorded figure, the 6a and 6b margins), **never a guessed or truncated figure**. No ceiling is raised for DF-6. |
| DF6-W-7 | **One window for every section.** Every window-based section and tile reads the same span. Client takings (layer B) therefore start at the cut-over too, although client payments exist before it (BQ-16, default: same window). |

### 11L.4 Validation change

| # | Rule |
|---|---|
| DF6-FR-1 | The route's `preset` enum becomes the shared `ADMIN_WINDOW_CHOICES` **plus `since_start`**, a Finance-local addition in the route (the shared `ADMIN_WINDOW_CHOICES` list is not edited, so the Activity and credit report routes are unchanged). |
| DF6-FR-2 | `preset=since_start` **without `accountId` is a 400** (`INVALID_QUERY`; development detail "since_start needs a business picked"). This is the only way a window longer than 92 days can be asked for, and it cannot be asked for all businesses (BD-26). |
| DF6-FR-3 | `preset=since_start` with `tab` is already a 400 through SA-W84 (no tab with a business); no new rule. `sort`, `group` and `show` are 400 without the tab (E-48), unchanged. |
| DF6-FR-4 | **The 92-day cap is otherwise unchanged:** `custom` still goes through `customRangeProblem` (at most 92 inclusive days, `to` not after today UTC), with or without a business picked. A custom window of 93 days with a business picked is still a 400. |
| DF6-FR-5 | **Order is unchanged:** `requireAdmin` first (nothing above it), the repeated-key check, the strict schema, the platform-account 404, then the builder's plan check (404 / 500) before any other read. With `since_start`, the window is resolved in the route from the constant and `now` only (DF6-W-3); the builder's order is unchanged. |
| DF6-FR-6 | The route's info line logs `window.preset` = `since_start` and the resolved `from` / `to` dates, as for every preset; never the plan row's facts, an amount or a name (SEC-8). |

### 11L.5 URL value, U-4 and the page control

| # | Rule |
|---|---|
| DF6-FR-7 | **URL value:** `range=since_start` (underscore, as the existing extras, CF-5), always with `account=<uuid>`. It is a Finance **window extra**: `since_start` is added to the shared `ADMIN_WINDOW_EXTRAS`, and `ADMIN_WINDOW_EXTRA_LABELS` gains **"Since it started"** (SA-Q93). The shared resolver (`adminWindow.ts:228-231`, which today sends every other extra to `resolveDateExtra`) gets an **explicit `since_start` case returning `{ kind: 'none' }`**: the shared folder never resolves it to dates, Finance resolves it on the server (E-76, DF6-F2). The exact-list pin of the extras (`adminWindow.test.ts:203`) is updated **once**, by this ruling. Finance lists the extra in its window field only. No `from` / `to` are written for it. The legacy alias `preset=since_start` is read as `range` like every other value (U-9). The request it sends is `preset=since_start&accountId=<uuid>`. |
| DF6-FR-8 | **U-4 (BD-30): a bad link drops only the bad filter.** (a) `range=since_start` with no valid `account`: the **window** is the dependent, bad filter, so it falls back to This month and nothing else changes (the cross-key repair in `financeFilterRepair`, the SA-W3 precedent). (b) `range=since_start&account=<bad>`: the account is dropped by its own parser, then (a) applies. (c) `range=since_start&from=…&to=…`: the dates are ignored, the choice kept. (d) `range=since_start&tab=accounts&account=<uuid>`: the existing rule drops the tab and its keys (the business wins). No notice, no reset of other filters, and no request is ever sent that the route would refuse. |
| DF6-FR-9 | **Page control:** the Window control shows **"Since it started"** after the standard choices **only while a business is picked** (`DatePresets extras` passed only then). Picking **All businesses** while it is selected sets the window to This month in the same single write (DF6-FR-8 (a)). **Clear** resets to This month and all businesses, as today. The window label under the bar reads **"Since it started: {from} to now (UTC)"**, `{from}` from the payload: `formatUtc(window.start)` with its trailing " UTC" removed, so the line reads **"Since it started: 2026-09-29 16:50 to now (UTC)"** (E-81, SA-W-DF6-1). |
| DF6-FR-10 | **Links out** (CF-6): with `since_start`, a link to Activity, Charge checks or AI calls & usage carries `range=custom&from={window.from}&to={window.to}` **while that span is at most 92 inclusive days**; once it is longer, the link carries **the account only and no window**, so the target opens on its own default, never on a window it would refuse (SA-Q95). **No link ever carries `range=since_start`** (E-77, DF6-F3): `wholeDayWindow` (Activity, Charge checks) and `analyticsWindow` each branch on `since_start` explicitly, with an exhaustive `never` check on `FinanceWindowChoice`, so no choice can fall through to `range=<preset>`. The Businesses link carries no window, as today. K-1's link is unchanged (This month, F5-R1). |

### 11L.6 Tiles, account summary and margins over the long window

| Where | Behaviour with "Since it started" |
|---|---|
| **K-5 Our revenue** | Follows the page window, as for any window: the account's plan payments received plus boost net since the start, per currency (M2-FR-5, 4a rules). Its information line names the window ("since it started"). |
| **K-1 Charged AI cost this month** | Unchanged: always this calendar month in UTC against the same span of last month (§7.1), whatever the window. |
| **K-2, K-3, K-4** | Unchanged: as of now (credit period, cohort, lots), not window-based. |
| **Section 1 Accounts by plan** | The picked account's group, as of now. **Note (E-79, DF6-F5):** the "new in window" count is not as of now: `classifyAccounts` counts it by the plan row's `created_at` (`planGroups.ts:224`), which follows the window. Over the long window a backfilled account counts as new, because its backfill time falls after the cut-over (CF-4). This is existing behaviour for any window that covers the backfill and DF-6 does not change it. |
| **Section 2 Our revenue and Takings** | Window-based: every plan payment, boost and client payment of the account since the start, per currency, no FX (BD-12). The plan payments list keeps its defensive cap (`PLAN_PAYMENTS_SHOWN` 50, about four years of monthly payments); above it the existing "first 50 shown" wording applies and the totals still cover every row read. |
| **Section 3 Charged AI cost, Recorded AI cost, Recorded above charged** | Window-based, from the start; coverage `after_cutover` (DF6-W-1). The recorded read's 5,000-call ceiling (CF-2) can be reached by a busy account over a long window: then the recorded figure is "At least X" and "Recorded above charged" reads Unknown, exactly as M-4 already does (R4 rules). Never 0. |
| **Section 4 Credits, Section 6 Payment problems** | Unchanged: as of now. |
| **Account summary (M-1) and margins (6a, 6b)** | "Paid us", charged AI cost, **AI margin (USD)** and **Margin after Stripe fees (estimate, USD)** cover the whole window by the same builder functions (`buildAccountMargin`), with the same SA-W82 precedence: "n/a, different currency" when any non-USD line exists, Unknown on any failed, ceiling or inexact read, a figure otherwise. "Not available: AI cost is charged only from 29 Sep 2026" can no longer appear (coverage is always after the cut-over). The fee estimate counts every charge in the window (FE-1 to FE-7). The summary gains a window line **for `since_start` only** (there is none today; every other window's summary is unchanged), with the same text as the page label, computed once and passed in (E-82, SA-W-DF6-2). |
| **Monthly trend buckets** | None exist (CF-7) and DF-6 adds none. |
| **Accounts tab** | Not reachable: the tab is all businesses only (SA-W84), and the choice needs a business. |

### 11L.7 Reads and performance bounds

| # | Rule |
|---|---|
| DF6-P-1 | **Same reads, same count.** A since-start request makes exactly the reads a picked-business request with a 92-day window makes (same methods, same `accountId`, same page sizes and ceilings), only with a different `start`. No platform-wide read runs with a business picked (unchanged: R-d not called, SA-Q35; the all-accounts recorded read not called, AC-157). |
| DF6-P-2 | **Bounded by ceilings, not by days.** The window has no day limit, but every read stops at its ceiling (CF-2, DF6-W-6). The worst case is therefore the same number of pages as today's worst case for one account: ledger 20 pages of 1,000, recorded 5 pages of 1,000, client payments and refunds 5 pages each, boosts and plans their own. |
| DF6-P-3 | **Timing is recorded, not gated.** QA records `durationMs` from the route's info line for the owner test account with "Since it started", beside This month and a 92-day custom window (L-153). A slow read follows the existing rules (the recorded read's 2 s deadline is race-only; a timed-out read is Unknown, never a wrong figure). No new CI job and no added critical-path time. |

### 11L.8 Guards and tests affected

| Guard or test | Effect | What Dev must do |
|---|---|---|
| `requireAdmin` first (`test:authz-guard`) | Route edited | Unchanged order (DF6-FR-5); the guard passes with no edit |
| **tenant-isolation-guard** (skill) | The route is a service-role, cross-account admin read that takes a caller-supplied `accountId` | Apply the skill: the window does not depend on account data at all (E-75); every account-scoped read still receives that id and no other; no all-accounts read is reachable with `since_start`; a test proves a since-start request for account A never passes account B's id to any dep, and that a since-start request with no account never reaches the builder (400) |
| **Frozen pins** | AC-173 pin `3a1a2dd4…f6f8` and helper `b84e0c96…aabf`; Pin A `30f5fc24…2e01`; Pin B `24ff0da7…df9f`; Pin C `98ea0507…1e4b` and helper `02813360…5bd8`; Pin D `1f7cf07a…f144` | All **byte-identical** (LF-normalised), hashes at Step 0 and at handover. The since-start request is a **new** state (CF-9), pinned in a new test, never by editing the AC-173 table. If SA finds a pin must change, one ruled re-freeze as E-55 (SA-Q96) |
| `aiCostVocabulary.source.guard.test.ts` | New strings in `financeCopy.ts` | No edit and no ALLOWED entry: "Since it started" and the window line use none of the SA-Q51 words |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | New `since_start` branch of `resolveFinanceWindow` | Pure (no repository, data layer, entitlements or clock import; `now` passed in); no `user_preferences` or `timezone` token in `lib/business-os/finance/`; `financeWindow.ts` reads no plan-row field |
| **Type changes (E-80, DF6-F6)** | `since_start` widens three types | `FinanceWindowChoice` (`financeTypes.ts:56`) gains `since_start`; `FinanceQuery.preset` (`financeUrl.ts:29`, today `AdminWindowChoice`) becomes `AdminWindowChoice \| 'since_start'`; the route's `preset` enum gains it (DF6-FR-1). `windowQuery` maps `{ kind: 'extra', extra: 'since_start' }` to `preset: 'since_start'` and `fromFinanceQuery` maps it back. The AC-173 table stays untouched |
| `app/admin/finance/__tests__/source.guard.test.ts` | Filter bar and summary | Type imports only; no date arithmetic on the window in components; no `console.` |
| Shared window tests (`adminWindow`, `DatePresets`, the extras parity tests) | `ADMIN_WINDOW_EXTRAS` gains `since_start` | An explicit `since_start` case returns `{ kind: 'none' }` (E-76); the `adminWindow.test.ts:203` exact-list pin is updated once (SA-Q93 ruling); one test each on Analytics, Activity and Costs that `range=since_start` is ignored (U-4) |
| `financeFilters.test.ts`, `financeUrl.test.ts`, `financeUrlState.render.test.tsx` | New value and repair | New cases for DF6-FR-7 and DF6-FR-8 (a) to (d); the existing cases unchanged |
| `financeLinks.test.ts` | New link rule | New cases for DF6-FR-10 at 92 and 93 inclusive days |
| `app/admin/finance/__tests__/source.guard.test.ts:192-196` (SA-W56 links import pin) | **Tripped:** the 92-day rule needs the shared day count | **One ruled update (E-83, SA-W-DF6-3):** the exact list becomes `['@/lib/business-os/finance/financeTypes', '@/app/admin/components/adminWindowPresets']`; `financeLinks.ts` imports `inclusiveDays` and `ADMIN_WINDOW_MAX_DAYS` from there, never a local `92`; the planted control stays |
| Route tests, AC-145 baseline | New enum value and rule | The no-tab, no-business Overview payload is byte-identical (AC-145 unchanged) |
| Repository caller lists, `serviceColumn.guard`, `tierLiteral.forbidden`, `test:bos-entitlements`, `layoutFolder.guard` (C-14), contrast | Not tripped (no new read, no tier literal, no entitlements import; the filter bar is already migrated) | Run unchanged |

Dev runs before SA code review and pastes in the workplan: `npm run test:bos-entitlements`, `npm run test:authz-guard`, the finance, shared layout and Health suites, the vocabulary guard, `npm run lint:hooks`, eslint on touched files, the scoped `tsc` with canary (AC-44), and the seven pin hashes.

### 11L.9 Acceptance criteria

All testable by Jest or by QA's recorded manual check. Figures are compared with checks 29 and 30 run at test time.

- [ ] **AC-257** **Start rule (unit, E-75):** the start is `CHARGING_CUTOVER_FLOOR_MS` and the end is the injected `now`; `from` is `2026-09-29` and `to` is today UTC.
- [ ] **AC-258** **Coverage:** for the AC-257 start, `cutoverClamp` gives `after_cutover`, and no margin cell reads "Not available".
- [ ] **AC-259** **Validation:** `preset=since_start&accountId=<uuid>` is accepted; `preset=since_start` alone is a 400 with the `INVALID_QUERY` message; with `tab=accounts` it is a 400; `from` / `to` sent with it are ignored (the resolved window is the same); an unknown value such as `since-start` is a 400.
- [ ] **AC-260** **Cap unchanged:** a custom window of 93 inclusive days is a 400 with and without `accountId`; 92 days is accepted; Today, 7 days, 30 days and This month resolve exactly as before (route tests unchanged).
- [ ] **AC-261** **Order and isolation:** `requireAdmin` runs first; with `since_start`, the plan check runs before any other read, a missing plan row is a 404 and a failed check a 500; every account-scoped dep receives exactly the picked id; no all-accounts read is called (`countRevenueRows` and the all-accounts recorded read: zero calls).
- [ ] **AC-262** **Same reads:** a since-start request calls the same deps with the same page sizes and ceilings as a picked 92-day custom request; only the range start and end differ (E-78: a custom window ends at the next UTC midnight, `since_start` at `now`) (DF6-P-1).
- [ ] **AC-263** **Ceilings honoured:** with a fixture where the ledger read reaches its ceiling, Section 3 shows "At least X" and both margins read Unknown; where the recorded read reaches its ceiling, "Recorded above charged" reads Unknown; never 0 and never a figure (DF6-W-6).
- [ ] **AC-264** **URL and U-4:** `range=since_start&account=<uuid>` loads the choice and sends `preset=since_start&accountId=<uuid>`; `range=since_start` with no account, or with a bad account, shows This month and all businesses and sends `preset=this_month`; dates beside `since_start` are dropped; with `tab=accounts` and an account the tab is dropped; the legacy `preset=since_start&accountId=<uuid>` reaches the same state; every AC-173 row still sends its pinned literal.
- [ ] **AC-265** **Control:** "Since it started" is offered only with a business picked; choosing All businesses while it is selected switches to This month in one URL write; Clear resets to This month and all businesses; pages that do not list the extra ignore `range=since_start`.
- [ ] **AC-266** **Labels:** the choice reads "Since it started"; the window line under the bar and in the account summary reads "Since it started: {from} to now (UTC)" with `{from}` from the payload (for the cut-over: "Since it started: 2026-09-29 16:50 to now (UTC)", E-81); the summary line appears for `since_start` only and every other window's summary is unchanged (E-82); the vocabulary guard passes with no edit.
- [ ] **AC-267** **Tiles:** K-5 equals check 29's revenue for the account (per currency); K-1 equals its This month value with the same account picked; K-2, K-3 and K-4 equal their values with This month picked (as of now).
- [ ] **AC-268** **Summary and margins:** for the owner test account, "Paid us", charged AI cost, AI margin and the margin after Stripe fees (estimate) with its fee line equal check 29 (`usd_revenue_after_tax_minor`, `ai_cost_usd`, `ai_margin_usd`, `usd_fee_minor`); an ILS line gives "n/a, different currency"; Section 3 and the summary show the same charged figure.
- [ ] **AC-269** **Links out:** with a since-start span of at most 92 inclusive days, the Activity, Charge checks and AI calls & usage links carry `range=custom&from&to` from the payload and the account; at 93 days or more they carry the account and no window; no link ever carries `range=since_start` (E-77); the Businesses and K-1 links are unchanged.
- [ ] **AC-270** **No timezone, no new read:** no file under `lib/business-os/finance/` or `app/admin/finance/` names `user_preferences` or `timezone`; no write, migration, SQL function, read or repository method is added; scoped `tsc` with canary.
- [ ] **AC-271** **Guards and pins:** every §11L.8 row passes; the seven frozen pins are byte-identical (or re-frozen once by SA ruling, recorded); the Overview payload with no tab and no business is unchanged (AC-145); the route info line carries no plan fact, amount or name.
- [ ] **AC-272** **Manual QA (L-148 to L-154):** run the steps below and record them in the workplan.

**Manual browser steps** (user or QA, recorded in the workplan):

- **L-148** Open Finance with all businesses: the Window control has no "Since it started".
- **L-149** Pick the owner test account: "Since it started" appears; choose it. The URL reads `range=since_start&account=…`; the window line reads "Since it started: 2026-09-29 16:50 to now (UTC)" (E-81).
- **L-150** Compare K-5, "Paid us", charged AI cost, AI margin and the margin after Stripe fees (estimate) with check 29 for the account; run check 30 and note the rows before the cut-over that the view leaves out (BQ-16).
- **L-151** Choose All businesses: the window becomes This month, in one step. Paste `…/admin/finance?range=since_start` (no account): This month, all businesses, no error.
- **L-152** Pick the account again with "Since it started" and open the Activity, Charge checks and AI calls & usage links: each opens on the same account with the window from the payload (or, past 92 days, on its own default).
- **L-153** Record `durationMs` from the route line for "Since it started", This month and a 92-day custom window, for the owner test account.
- **L-154** Set Custom to 93 days with the account picked: Apply is refused with the 92-day sentence, as before.

### 11L.10 SQL cross-checks (29 and 30)

Read-only, ASCII only, no apostrophes in comments, one final result set each. Test and live together (BD-14). Revenue amounts are **minor units** (divide by 100); AI cost is USD at the ledger scale. Replace `null` in each `p` block with the quoted account id. Revenue and AI cost follow check 19; fees follow check 27 at the 6b default. Written against §11L.1, §11E.1 and §11K.1; not executed by BA.

**File:** `check 29 - one account since it started` (AC-257, AC-267, AC-268, L-150)

```sql
-- Finance page check 29: one account since it started, one row, read only.
-- Compare with K-5, the account summary and Section 3 when Since it started is picked.
-- Replace null in the p block below with the quoted account id, such as
-- 1a2b3c4d-1111-4111-8111-abcdefabcdef. With null the row holds zeros only.
-- The start is the charging cut-over (2026-09-29 16:50:53.914 UTC) for every account.
-- The end is now.
-- Revenue is after tax, as in check 19. Fees are 290 basis points plus 30 minor units
-- per USD charge above 0, as in check 27. A margin is given only when all revenue is USD
-- and nothing is inexact.
with p as (
  select null::uuid as account_id,
         timestamptz '2026-09-29 16:50:53.914+00' as cutover_at,
         now() as end_at
),
s as (
  select p.account_id,
         p.end_at,
         p.cutover_at as start_at
  from p
),
rev as (
  select upper(btrim(e.currency)) as currency,
         e.amount_minor - e.amount_tax_minor as after_tax_minor,
         e.amount_minor::bigint as gross_minor
  from public.business_os_billing_events e
  cross join s
  where e.user_id = s.account_id
    and e.kind = 'invoice_paid'
    and e.paid_at >= s.start_at
    and e.paid_at < s.end_at
  union all
  select upper(btrim(b.currency)) as currency,
         case
           when b.status = 'paid' then b.amount_total_minor - b.amount_tax_minor
           when b.status in ('disputed', 'dispute_lost') then 0
           when b.amount_refunded_minor = b.amount_total_minor then 0
           when b.amount_tax_minor = 0 then b.amount_total_minor - b.amount_refunded_minor
           else null
         end as after_tax_minor,
         b.amount_total_minor::bigint as gross_minor
  from public.business_os_boost_purchases b
  cross join s
  where b.user_id = s.account_id
    and b.status in ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost')
    and b.paid_at >= s.start_at
    and b.paid_at < s.end_at
),
cost as (
  select coalesce(sum(c.cost_usd), 0) as ai_cost_usd,
         count(*) as ledger_rows
  from public.business_os_credit_charges c
  cross join s
  where c.user_id = s.account_id
    and c.created_at >= s.start_at
    and c.created_at < s.end_at
),
t as (
  select
    coalesce(sum(r.after_tax_minor) filter (where r.currency = 'USD'), 0) as usd_revenue_after_tax_minor,
    count(r.currency) filter (where r.currency is distinct from 'USD') as other_currency_rows,
    count(r.currency) filter (where r.after_tax_minor is null) as inexact_revenue_rows,
    coalesce(sum((r.gross_minor * 290 + 5000) / 10000 + 30)
      filter (where r.currency = 'USD' and r.gross_minor > 0), 0) as usd_fee_minor
  from rev r
)
select
  (select start_at from s) as window_start,
  (select end_at from s) as window_end,
  t.usd_revenue_after_tax_minor,
  t.other_currency_rows,
  t.inexact_revenue_rows,
  t.usd_fee_minor,
  cost.ai_cost_usd,
  cost.ledger_rows,
  case
    when t.other_currency_rows > 0 or t.inexact_revenue_rows > 0 then null
    else round(t.usd_revenue_after_tax_minor / 100.0 - cost.ai_cost_usd, 6)
  end as ai_margin_usd,
  case
    when t.other_currency_rows > 0 or t.inexact_revenue_rows > 0 then null
    else round((t.usd_revenue_after_tax_minor - t.usd_fee_minor) / 100.0 - cost.ai_cost_usd, 6)
  end as margin_after_fees_usd
from t
cross join cost;
```

**File:** `check 30 - one account, rows before the charging cut-over` (BQ-16, L-150)

```sql
-- Finance page check 30: rows of one account dated before the charging cut-over, one row, read only.
-- Replace null in the p block below with the quoted account id.
-- The page never counts these rows when Since it started is picked. They are expected for
-- an account that existed before the cut-over. Client payments are counted for BQ-16.
with p as (
  select null::uuid as account_id,
         timestamptz '2026-09-29 16:50:53.914+00' as cutover_at
)
select
  p.cutover_at as window_start,
  (select count(*) from public.business_os_credit_charges c
    where c.user_id = p.account_id and c.created_at < p.cutover_at) as ledger_rows_before_cutover,
  (select count(*) from public.payment_transactions x
    where x.user_id = p.account_id and x.paid_at < p.cutover_at) as client_payments_before_cutover
from p;
```

### 11L.11 Open questions for SA (DF-6)

Technical only. The one business point, whether client takings also start at the cut-over, is **BQ-16** (§0.4); it does not block the build.

| # | Question | BA suggestion |
|---|---|---|
| **SA-Q92** | Where is the start resolved: a pure helper in `financeWindow.ts` called by `buildFinanceHealth` right after the step 1 plan check (the route passes a provisional window), or the route reading the plan row itself? | The builder, after step 1: the plan row is already read there, so there is no second read and no read before the check (SEC-3). The route never resolves `since_start` |
| **SA-Q93** | `since_start` cannot be resolved to dates by the shared folder (the start needs the account's plan row, and the shared folder may not import `lib/business-os/`). Add it to `ADMIN_WINDOW_EXTRAS` with a label and have the shared date resolver return "no dates" for it, or keep it a Finance-local value outside the shared extras? Any exact-list pin on `ADMIN_WINDOW_EXTRAS`? | Add it to the shared extras (the "a later page adds its own here" rule, CF-5), with the shared resolver giving `none` for it; Finance resolves it on the server. If an exact-list pin exists, one ruled update |
| **SA-Q94** | First activity: the earliest of `onboarding_started_at` and `profile_created_at` (BA, CF-4), or only `onboarding_started_at` (the repository's "the account's own start")? | The earliest of the two: it can only make the window wider, never drop a row; check 30 proves it on live data |
| **SA-Q95** | Links out past 92 days: no window (the target's default), or the last 92 days ending today? | No window: a "last 92 days" link would show a different span under the same label. The Finance page itself is the place for the long view |
| **SA-Q96** | Pins: confirm none of the seven pins reads the window choice list or the route enum, so all stay byte-identical, and that the since-start request belongs in a new test, not in the AC-173 table (CF-9) | Confirm both; a new request case beside the pin, never inside it |
| **SA-Q97** | The tenant-isolation-guard test shape: is a since-start case added to the existing route isolation test (two accounts, a spy on every dep) enough? | Yes, one case per account-scoped dep, plus the 400 case with no account |
| **SA-Q98** | The recorded read's 5,000-call ceiling over a long window (Section 3, M-4): leave as is (Unknown at the ceiling), or raise it for one account? | Leave it: raising a ceiling is a read change, out of DF-6 (DF6-W-6); L-153 records whether the owner account comes near it |
| **SA-Q99** | Path: full cycle (route validation and window change), one workplan and one PR, under BD-33's fast track? | Yes: no migration, no business question that blocks |

### 11L.12 Estimate

**About 1.5 days** (BD-32): the window helper, the route enum and rule, with unit and route tests, about 0.5 day; the URL value, the cross-key repair, the control and the labels about 0.5 day; the link rule, the isolation test, guards, pin hashes, checks 29 and 30 and QA about 0.5 day.

### SA Requirement Review — DF-6 (§11L) — 2026-10-17

**Reviewed by SA, 2026-10-17, against `ea56ad04` on `feature/bos-finance-health-df6`.**
**Status: APPROVED WITH CONDITIONS (SA-RR-DF6).** The workplan starts after BA applies E-75 to E-80.
**BA, 2026-10-17: E-75 to E-80 applied** in §11L (E-75: DF6-W-1, DF6-W-3, DF6-FR-5, CF-4, the isolation and source-guard rows, AC-257, AC-258, AC-261, L-149, L-150, checks 29 and 30; E-76: DF6-FR-7 and the shared window tests row; E-77: DF6-FR-10 and AC-269; E-78: AC-262; E-79: the §11L.6 Section 1 row; E-80: a new type-changes row in §11L.8). Ready for the Dev workplan.

**Verified in the code**

| Claim | Result |
|---|---|
| The 92-day cap is a route and page rule only (CF-1) | ✅ `buildQuerySchema` applies `customRangeProblem` to `custom` only; no finance read checks the length |
| `requireAdmin` is the first statement (DF6-FR-5) | ✅ `route.ts` GET: correlation id, then `requireAdmin`; nothing reads the request above it |
| Account-scoped reads have ceilings and report them (CF-2) | ✅ ledger `reachedCeiling`, client, boost and plan paging, recorded `MAX_CEILING`; a longer window only reaches them sooner, and the existing "At least" / Unknown rules hold |
| Columns in checks 29 and 30 | ✅ `BusinessOsFinanceReadRepository` column lists (billing events, boosts, `payment_transactions`), `PLAN_COLUMNS` (`onboarding_started_at`, `profile_created_at`); same tables and rules as checks 19 and 27; editor-safe (no "into", no apostrophes) |
| Provisioning facts are real history | ✅ `20261005b` backfill sets them from `MIN(onboarding_conversations.created_at)` and `business_profiles.created_at`, not the run time; `created_at` is the run time (CF-4) |
| No timezone read | ✅ no file under `lib/business-os/finance/` or `app/admin/finance/` names `user_preferences` or `timezone`; both ends are instants, so DF6-W-4 is right |
| No buckets (CF-7) | ✅ |
| Tenant isolation | ✅ every account-scoped dep already takes the checked `accountId`; with E-75 the window does not depend on account data at all |

**Findings**

| # | Sev | Finding | Edit |
|---|---|---|---|
| DF6-F1 | Medium | **The first-activity start can drop rows and adds nothing.** For an account older than the cut-over the start is the cut-over either way. For a newer one, the rule gives the same totals only if no charge is dated before the earliest fact. The first AI charge and the first `onboarding_conversations` row are written by different code, so a charge a few ms earlier is possible and would silently leave the window. Check 30 on the owner account (older than the cut-over) cannot catch it. BD-26 says "starting from the charging cut-over". | **E-75:** DF6-W-1 becomes "the start is the cut-over instant `CHARGING_CUTOVER_FLOOR_MS`"; the plan-row facts are not used. DF6-W-3: resolved in the route by a pure `since_start` branch of `resolveFinanceWindow` (`now` passed in), with no plan row needed. AC-257 is reduced to "start = cut-over, end = injected `now`". Check 29's `s` block uses `p.cutover_at`. Check 30 keeps only `ledger_rows_before_cutover` and `client_payments_before_start` (renamed `_before_cutover`), for BQ-16 |
| DF6-F2 | Medium | **The shared resolver routes every unknown extra to `resolveDateExtra`** (`adminWindow.ts:228-231`). With `since_start` in `ADMIN_WINDOW_EXTRAS`, an explicit branch is needed. TS forces one, but the requirement must say what it returns. `adminWindow.test.ts:203` is an exact-list pin of the extras. | **E-76:** DF6-FR-7: `resolveWindow` returns `{ kind: 'none' }` for `since_start`, from an explicit case; `ADMIN_WINDOW_EXTRA_LABELS` gains "Since it started"; the `:203` list pin is updated once (ruled here, SA-Q93); one test per extras page (Analytics, Activity, Costs) that `range=since_start` is ignored |
| DF6-F3 | Medium | **`financeLinks.ts` `wholeDayWindow` falls through to `range=<preset>`**, so `since_start` would be sent to Activity and Charge checks, which would drop it to their own default without saying so. | **E-77:** DF6-FR-10: both link helpers branch on `since_start` explicitly, with an exhaustive `never` check on `FinanceWindowChoice`; AC-269 adds "no link ever carries `range=since_start`" |
| DF6-F4 | Low | **AC-262 says only `from` differs.** The end differs too: a custom window ends at the next UTC midnight (`windowInstants`), `since_start` ends at `now`. | **E-78:** AC-262 reads "only the range start and end differ" |
| DF6-F5 | Low | **Section 1 is not entirely "as of now".** `classifyAccounts` counts "new in window" by the plan row's `created_at` (`planGroups.ts:225`). Over the long window, a backfilled account counts as new, because its backfill time falls after the cut-over. This already happens for any window that covers the backfill; it is not fixed here. | **E-79:** the §11L.6 Section 1 row notes the "new in window" count follows the window by `created_at` (existing behaviour, CF-4) |
| DF6-F6 | Low | **Types widen in three places:** `FinanceWindowChoice` (`financeTypes.ts:56`), `FinanceQuery.preset` (`financeUrl.ts:29`, today `AdminWindowChoice`) and the route enum. `fromFinanceQuery` and `windowQuery` must map `since_start` to and from `{ kind: 'extra' }`. | **E-80:** add these to the §11L.8 rows so the workplan lists them; the AC-173 table stays untouched |

**Answers to SA-Q92 to SA-Q99**

| # | Ruling |
|---|---|
| SA-Q92 | **Route, pure.** After E-75 the start needs no plan row: `resolveFinanceWindow` gains a `since_start` branch (`start = CHARGING_CUTOVER_FLOOR_MS`, `end = now`, `from` = `2026-09-29`, `to` = today UTC). The builder is unchanged. The 400 for a missing `accountId` is in `superRefine`. The info line already logs the resolved window |
| SA-Q93 | **Shared extras**, with the `none` resolution (E-76). Exactly one ruled update to the `adminWindow.test.ts:203` list pin |
| SA-Q94 | **Neither: the cut-over** (DF6-F1, E-75). Use no plan-row fact, and never `created_at` |
| SA-Q95 | **No window past 92 inclusive days**, as BA suggests |
| SA-Q96 | **Confirmed:** the since-start request is a new test beside the AC-173 pin, never a row in it. All seven pins stay byte-identical (LF-normalised), hashed at Step 0 and at handover. No re-freeze is expected; if one is needed, it is a ruled re-freeze as for E-55 |
| SA-Q97 | **Yes:** a since-start case in the existing route isolation test, one assertion per account-scoped dep (picked id only; `countRevenueRows` and the all-accounts reads called zero times), plus the 400 with no account (builder never called) |
| SA-Q98 | **Leave the ceiling** (DF6-W-6). L-153 records whether the owner account comes near it |
| SA-Q99 | **Yes:** full cycle, one workplan and one PR, BD-33 fast track |

**Other checks.** U-4 (DF6-FR-8) fits `financeFilterRepair`: add one branch, "no account and `since_start`, so window to default". Vocabulary guard: "Since it started" uses no SA-Q51 word, so no ALLOWED entry. No new CI job: the new cases go into the existing finance, layout and route suites. BQ-16 default accepted (one window); it does not block the build. **Estimate:** about 1.25 days after E-75; 1.5 days accepted as the plan figure.

---

## 11M. Slice 8: history snapshots

Specified 2026-10-17 from the §0.1 slice 8 row ("a migration and a cron (SA)"), the §9 slice 8 row, §8.1 "Cannot produce" ("Plan mix at the end of a past month → slice 8"), §11L CF-7 ("Slice 8 (history snapshots) is where trends belong"), **BD-32** (slice 8 last, about 3 to 4 days), **BD-33** (fast track, but a production migration stops for the user), the cron pattern of `docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md` §8.1 and §9, the `durable-queue-drain` and `tenant-isolation-guard` skills, `lib/cron/bosCronJobs.ts`, the `20261011_bos_cron_runs.sql` run record and the house style of `20261072` (PR #447) with its checker, pre-check and rollback. Code read on `feature/bos-finance-health-8`, cut from the DF-6 tip `f6182697` (6b and DF-6 included). **One migration (one new table), one new cron, one new admin read route and one new repository; no change to any existing table, function, read or payload.** Columns were confirmed by reading the migrations (the `business-os-schema-check` approach), not by a live query.

**Numbering note.** PR #447 (4b.1, not on main) reserves AC-204 to AC-232, SA-Q65 to SA-Q74, checks 23 to 26 and L-137 to L-141; 6b used AC-243 to AC-256, SA-Q81 to SA-Q91, checks 27 and 28 and L-142 to L-147; DF-6 used AC-257 to AC-272, SA-Q92 to SA-Q99, checks 29 and 30 and L-148 to L-154. Slice 8 therefore starts at **AC-273**, **SA-Q100**, **check 31**, **L-155** and **BQ-17**. Its checks sit in this section, as in 6b and DF-6. **Migration number:** the highest on `origin/main` is `20261071`; the highest on any open PR or remote branch is `20261073` (#447: `20261072` and `20261073`). Slice 8 proposes **`20261074_business_os_finance_snapshots.sql`**; RM re-checks the number when 8.1 opens and renumbers if another PR has taken it. **Renumbered by SA, 2026-10-17 (E-91, SA-WR-8.1):** #451 (DE-8a) merged `20261074_business_os_data_exports` and `20261075`, and #447 is being renumbered to `20261076` and `20261077`, so slice 8.1 is **`20261078_business_os_finance_snapshots.sql`** (every later mention in §11M says so). RM re-checks the number when 8.1 opens.

**The question it answers.** "Is the business growing, and are credits piling up?" Today every Finance figure is a total for the window or a state as of now (§11L CF-7). A state as of now (how many accounts are on each plan, how many credits are outstanding) is gone the next day: nothing records yesterday's. Slice 8 records those states once a night, so a trend can be drawn from the first night on.

### 11M.1 Code facts (read at `f6182697`, 2026-10-17)

| # | Fact | Where |
|---|---|---|
| CF-1 | **Plan mix is derived, not stored.** Section 1 groups each plan row through `deriveLifecycle(fromPlanRow(row), lifecycleInputs(config), now)` and `groupFor` / `paidTierOf`, with the paying set from the billing rows' **current** `subscription_status`. The plan row holds only the current `tier`, `cohort` and expiries (overwritten on change); there is no plan history table. **A past plan mix cannot be rebuilt** | `lib/business-os/finance/planGroups.ts`; `20261005_business_os_entitlements.sql` |
| CF-2 | **Credit positions are derived for the current period.** `readAdminCreditPositions` gives `{ allowance, used, trial }` per account from the entitlement snapshot (`getSnapshots`), the period anchors (`findPeriodAnchorsBatch`) and `business_os_credit_totals`. The allowance follows the plan in force now and the anchor moves each period. **A past allowance, period use or "over allowance" count cannot be rebuilt** | `lib/business-os/credits/adminCreditPercent.ts:72-100, :382` |
| CF-3 | **Gifted and bought outstanding are rebuildable, approximately.** `extraCreditsAt(lots, at)` takes any instant: a lot counts from `created_at`, draws count at or before `at`, a lot is expired when `expires_at <= at`. The lots and draws are kept (`business_os_credit_lots`: `user_id`, `source` in (`admin_grant`, `boost_purchase`), `credits_granted`, `expires_at`, `created_at`; `business_os_credit_lot_draws`: `lot_id`, `kind` `reversal`, `credits`, `created_at`). **But** K-4 counts existing accounts only, and an account deleted later has its lots set to `user_id` NULL, so a rebuild drifts after a deletion | `lib/business-os/credits/creditLots.ts:93-155`; `20261017_business_os_credit_lots.sql` |
| CF-4 | **Flows are rebuildable from dated rows.** Charged AI cost and credits charged (`business_os_credit_charges.created_at`), recorded AI cost (`token_usage`), our revenue (`business_os_billing_events.paid_at`, `business_os_boost_purchases.paid_at`; boost refunds dated from 4b.1 on), takings and client refunds (`payment_transactions.paid_at`, `payment_refunds.created_at`), gifts granted and taken back (lots and draws `created_at`), credits bought (`business_os_boost_purchases.credits_total` by `paid_at`), new plan rows (`created_at`, with the backfill caveat of §8.1) | the finance reads in `BusinessOsFinanceReadRepository.ts`, `BusinessOsCreditLedgerReadRepository.ts`, `BusinessOsCreditLotRepository.ts` |
| CF-5 | **The cron pattern.** A cron route checks `CRON_SECRET` fail-closed (401 and an `error` log without it in production) and runs inside `withCronRunRecord`, which writes `bos_cron_runs` (job `^[a-z][a-z0-9-]{0,63}$`, counts numbers only, keys `^[a-zA-Z][a-zA-Z0-9]{0,39}$`, **no money word** in a key, kept 30 days). Every job is one entry in `BOS_CRON_JOBS`, pinned by `bosCronJobs.test.ts` to `vercel.json` and to the route's `maxDuration`; that entry is what the Jobs & queues page and the Health tiles read. A job added after recording began sets `addedOn` to its real deploy day | `app/api/cron/credit-leak-check/route.ts:1-60`; `lib/cron/bosCronJobs.ts`; `20261011_bos_cron_runs.sql:320-350` |
| CF-6 | **Taken cron minutes.** Hourly or more often: every 5 minutes, every 15 minutes, `:00`, `:10`, `:15`, `:20`, `:30`, `:40`. Daily: 03:00, 03:30, 04:45, 04:55, 05:17, 05:41; weekly Sunday 04:30. **Minute 7 of hour 0 is free** | `vercel.json` |
| CF-7 | **The house style for a server-only table** (`20261072`): RLS on, no policy, `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated` **and** `service_role`, then `GRANT SELECT` and a column-list `GRANT INSERT` to `service_role` only; no UPDATE, no DELETE; `id` and the time column take their defaults; a `COMMENT ON TABLE` with no apostrophe and not the editor word; a pre-check, a post-apply checker and a rollback in `supabase/SQL Scripts/` that refuses once the table holds history | `20261072_business_os_boost_reversal_events.sql` (PR #447); `scripts/check-bos-boost-reversal-events-migration.sql`; `scripts/precheck-bos-boost-reversal-events.sql` |
| CF-8 | **Every table is classified.** A new table needs a `descriptors.ts` entry (platform tables: `never(…, G, exclude(EXPORT_REASON.PLATFORM), …)`, as `bos_cron_runs` and `archive_runs`), checked by `businessOwnedTables.test.ts`, which scans the migrations | `lib/business-os/purge/descriptors.ts:1470-1478`; `lib/business-os/__tests__/businessOwnedTables.test.ts` |
| CF-9 | **The Overview payload is pinned.** AC-145 keeps the no-tab, no-business payload byte-identical, and AC-173 pins the page's request literals. A new key in the finance payload would break both | `app/admin/finance/__tests__/financeRequestPins.ts`; §11L.8 |
| CF-10 | **No chart is drawn in admin today.** `recharts` is a dependency, but no file under `app/admin/` imports it | `grep` over `app/admin/` |

### 11M.2 What is snapshotted, and what is not

**Rule of thumb:** a figure is snapshotted only if it is a **state** the page shows today that **cannot be rebuilt for a past date** from dated rows. Every **flow** (something that happened at a dated moment) is rebuilt from its own rows when a later slice draws its trend, and is never copied.

| Figure on the page today | Rebuildable for a past date? | Snapshotted? |
|---|---|---|
| Section 1: accounts per plan group, the total, grace and past due per group, lifecycle state counts, Founding Partners with no end date (K-3), dormant Founding Partners, ending in the next 30 days | **No** (CF-1) | **Yes**, family `plan` |
| Section 4: accounts counted, over allowance, far over allowance (K-2), unknown, no allowance; included credits (allowance) and credits used in the current periods, summed | **No** (CF-2) | **Yes**, family `credit` |
| Gifted outstanding (K-4), gifted outstanding on deleted accounts, bought outstanding (boost lots) | **Approximately** (CF-3: drifts after a deletion) | **Yes**, family `lots`: the outstanding total needs all three parts at one instant, and the rows are cheap |
| Outstanding total (included credits left + gifted + bought) | No (it has a CF-2 part) | **Yes**, family `lots`, only when every part is exact |
| Charged AI cost (K-1, Section 3), recorded AI cost, credits charged | Yes (CF-4) | **No** |
| Our revenue (K-5, Section 2 block A), takings and client refunds (block B), the Stripe fee estimate, the AI margins (6a, 6b) | Yes (CF-4); margins are computed from those | **No** |
| Gifts granted and taken back in a window, credits bought in a window | Yes (CF-4) | **No** |
| New plan rows in the window | Yes (CF-4, backfill caveat) | **No** |
| Section 6 block B overdue invoices and instalments "as of now" | No | **No, deferred (DF-9):** it is money in the clients' currencies, and slice 8 stores no money (HS-W-9) |
| Section 1 with one business, the Accounts tab (6a), the account summary | Per account | **Never** (HS-W-8) |

### 11M.3 Scope

| In scope | Not in scope |
|---|---|
| The table `business_os_finance_snapshots` (migration `20261078`) with its pre-check, checker, local self-test and rollback (§11M.6, §11M.9); the nightly job `finance-snapshot`, registered on the Jobs page (§11M.7); the snapshot builder, which reuses Section 1's and Section 4's own functions (§11M.5); a read route and a **History** block on Finance, all businesses only, with an honest start line (§11M.8); checks 31 to 34 | Any money in a snapshot (HS-W-9); any per-account row; a trend of a rebuildable flow (charged AI cost, revenue, takings): a later slice reads its own dated rows; backfill of past days (BQ-19); a chart library (SA-Q106); churn of free accounts (the §9 row mentions it: aggregate counts give the net change only; per-account churn needs per-account history and stays with slice 7 or later); pruning (BQ-18); Section 6 overdue history (DF-9); any change to an existing table, read, payload or pin, or to the 92-day cap |

### 11M.4 Rules: grain, timing, idempotency, isolation, currency

| # | Rule |
|---|---|
| HS-W-1 | **Grain: daily (BQ-17, default).** One snapshot per UTC day, **as of the end of that day**. A monthly view is the last daily snapshot of each month; it needs no second table. |
| HS-W-2 | **When: 00:07 UTC** (`7 0 * * *`, a free minute, CF-6). A run that starts on UTC date D records **`as_of_date` = D − 1**, the day that has just ended. The state read is the state at the run's start (`taken_at`), about seven minutes after the day ended. |
| HS-W-3 | **Late runs write nothing.** A run that starts at or after **02:00 UTC** (constant `SNAPSHOT_LATEST_START_HOUR_UTC` = 2, SA-Q103) writes no row and reports `lateRun = 1` (partly done). Its state is too far from the day's end to label that day; the day becomes a gap. |
| HS-W-4 | **Idempotent.** The key is **(`as_of_date`, `metric`, `dimension`)**, enforced by a unique index. Every insert is `ON CONFLICT DO NOTHING` on that key, so a re-run, an overlapping run or a retry writes nothing new and changes nothing. The first row of a day stands; nothing is ever updated (append-only). |
| HS-W-5 | **Only exact figures are written.** A family whose source read failed, timed out or reached its ceiling is **not written that day** (no row, never a lower bound, never 0), and the run is "partly done" (`familiesSkipped`). In detail: `plan` only when the plan walk completed under its ceiling **and** the paying read succeeded (so history never mixes the folded "Tier set" group with the real groups); the `credit` counts only when the credit pass is `ok`; the `credit` sums (`credit_allowance`, `credit_used`, `credit_included_left`) only when, in addition, no account is unknown; `credit_far_over_allowance` only when the configured line is valid; the `lots` parts only when the lots read succeeded; `credit_outstanding_total` only when its three parts are written. **A row outside the dimension shape (E-86)**, such as a tier key the CHECK would refuse, is caught by the builder before the insert and skips the `plan` family only (`familiesSkipped`); it never fails the batch, so the other families are still written. |
| HS-W-6 | **No gap filling.** A missing day (no run, a late run, a skipped family) stays missing. The page shows it as a gap; nothing interpolates, carries forward or backfills it. |
| HS-W-7 | **Same definitions as the page.** The builder calls the functions Section 1 and Section 4 use (`classifyAccounts` / `groupFor` / `paidTierOf`, the report predicates, the credits section core, `extraCreditsAt`), with `now` = the run's start and all businesses. A snapshot therefore equals what the page would have shown at that instant with all businesses (AC-280). No second definition is written. |
| HS-W-8 | **Isolation: platform aggregates only.** No row holds an account id, a name, an email, an admin id, a reason text, a Stripe id or any free text. `dimension` is a group key, a lifecycle state or `all`, constrained by a pattern. Deleting an account changes no snapshot (they are counts of the past). The table has no `user_id`, so it is not tenant data and is not in `USER_OWNED_TABLES` or the test-account cleanup. |
| HS-W-9 | **Currency: no money is stored.** Every value is a count of accounts or an amount of credits (the platform's own unit, never money). `unit` is CHECKed to `accounts` or `credits`. Nothing is summed across currencies because no currency is stored. A later money metric needs a new migration with a `currency` column and one row per currency (CUR-1, BD-12); it is never added to this table's `value` as it stands. |
| HS-W-10 | **Tier keys are data.** A tier group's `dimension` is the group key as the classifier builds it (`tier:` + the config tier). No tier string is written in code or SQL (the tier-literal guard; no CHECK lists tiers, as in `20261005`). A tier later removed from config keeps its stored key; the page shows the stored key with "(no longer configured)". |
| HS-W-11 | **Not a queue drain.** The job claims nothing, dispatches nothing and has no per-row effect; its one write is idempotent by key (HS-W-4; §9 of the event-driven plan). The `durable-queue-drain` claim pattern does not apply, exactly as for `credit-leak-check` (CF-5); the route's header says so. |

### 11M.5 Metrics (one row each per day)

`unit` `accounts` values are whole numbers; `credits` values have up to 6 decimal places (the ledger scale). `dimension` is `all` unless stated.

| Family | `metric` | `dimension` | `unit` | Page source |
|---|---|---|---|---|
| plan | `accounts_total` | `all` | accounts | Section 1 Total |
| plan | `accounts_in_group` | the group key (`trial`, `founding_partner`, `comped`, `tier:<tier>`, `unknown_held`); every seeded group, zeros included (BD-3) | accounts | Section 1 groups |
| plan | `accounts_in_grace`, `accounts_past_due` | the group key | accounts | Section 1 grace and past due beside each group |
| plan | `accounts_in_state` | the lifecycle state as `deriveLifecycle` names it | accounts | Section 1 `byState` |
| plan | `founding_no_end_date` | `all` | accounts | K-3 (all businesses) |
| plan | `founding_dormant` | `all` | accounts | Section 1 dormant Founding Partners |
| plan | `accounts_ending_soon` | `all` | accounts | Section 1 "ending in the next 30 days" |
| credit | `credit_accounts`, `credit_over_allowance`, `credit_unknown_accounts`, `credit_no_allowance_accounts` | `all` | accounts | Section 4 counts |
| credit | `credit_far_over_allowance` | `all` | accounts | K-2 |
| credit | `credit_allowance` | `all` | credits | Σ allowance of the accounts with a position (the included credits granted for the current periods) |
| credit | `credit_used` | `all` | credits | Σ used in the current periods |
| credit | `credit_included_left` | `all` | credits | Σ max(allowance − used, 0) |
| lots | `gifted_outstanding` | `all` | credits | K-4 (existing accounts) |
| lots | `gifted_outstanding_deleted` | `all` | credits | Section 4's gifted figure for deleted accounts (SA-W9) |
| lots | `bought_outstanding` | `all` | credits | `extraCreditsAt` over the `boost_purchase` lots of existing accounts. No such figure exists on the page yet, so it comes from **one shared helper**, `outstandingBySource(lots, source, now)` in `creditsSection.ts`. That helper is K-4's own per-account loop with the source as a parameter, and `giftedFigures` calls it with `admin_grant`. "Existing accounts" means the same as for K-4 (E-95). Until BQ-13 is answered a refunded boost keeps its credits, and the figure follows the lots as they are |
| lots | `credit_outstanding_total` | `all` | credits | `credit_included_left` + `gifted_outstanding` + `bought_outstanding` |

About 30 to 40 rows a night today (about 13,000 a year). The metric list is one exported constant in the builder, pinned by a test; the migration CHECKs only the shape (SA-Q101).

### 11M.6 The migration (`20261078_business_os_finance_snapshots.sql`, slice 8.1)

| Column | Type | Rule |
|---|---|---|
| `id` | `uuid NOT NULL DEFAULT gen_random_uuid()` | Primary key; not in the INSERT grant |
| `as_of_date` | `date NOT NULL` | The UTC day whose end the state describes (HS-W-2) |
| `metric` | `text NOT NULL` | CHECK `metric ~ '^[a-z][a-z0-9_]{0,47}$'` |
| `dimension` | `text NOT NULL` | CHECK `dimension ~ '^([a-z][a-z0-9_]{0,47}\|tier:[a-z0-9_-]{1,40})$'` (E-86: a hyphen only after `tier:`, as Finance's `FINANCE_GROUP_SHAPE` admits, so a uuid still cannot pass; no space, no `@`, no free text; HS-W-8). The builder checks every row against one exported shape constant, pinned equal to this CHECK by the migration test, before the insert (HS-W-5) |
| `unit` | `text NOT NULL` | CHECK `unit IN ('accounts', 'credits')` (HS-W-9) |
| `value` | `numeric(18,6) NOT NULL` | CHECK `value >= 0`; CHECK `unit <> 'accounts' OR value = trunc(value)` |
| `taken_at` | `timestamptz NOT NULL DEFAULT now()` | When the state was read; not in the INSERT grant. CHECK that the day had ended in UTC when it was taken: `taken_at >= ((as_of_date + 1)::timestamp AT TIME ZONE 'UTC')` (SA-Q104 ruling: deterministic, kept) |

**Constraint and index names:** `business_os_finance_snapshots_pkey`; six checks `…_metric_shape`, `…_dimension_shape`, `…_unit_known`, `…_value_not_negative`, `…_accounts_whole`, `…_day_ended`; the unique index **`business_os_finance_snapshots_day_metric_key`** on `(as_of_date, metric, dimension)`, not partial (it is the `ON CONFLICT` target and serves the date-range read, so no other index).

**Order inside the file** (one transaction, `20261072` style): `BEGIN; SET LOCAL lock_timeout = '5s';` → `CREATE TABLE` with the columns and the primary key → the six `ALTER TABLE … ADD CONSTRAINT … CHECK` → the unique index → `COMMENT ON TABLE` (text: one row per platform figure per UTC day, counts and credits only, no money, no account, append only, written only by the nightly finance snapshot job, server only, never purged) → `ENABLE ROW LEVEL SECURITY` → `REVOKE ALL ON TABLE` from `PUBLIC`, `anon`, `authenticated`, `service_role` → `GRANT SELECT` to `service_role` → `GRANT INSERT (as_of_date, metric, dimension, unit, value)` to `service_role` → `NOTIFY pgrst, 'reload schema';` (E-89, house style; the rollback ends the same way) → `COMMIT`. **No policy, no UPDATE, DELETE or TRUNCATE grant, no trigger, no function** (`ON CONFLICT DO NOTHING` needs the INSERT privilege only; SA-Q102 confirms it with the PostgREST write used). No quoted string in the file contains an apostrophe or the editor word (the migration test pins both).

**In the same change (8.1):** `supabase/migrations/__tests__/business-os-finance-snapshots.migration.test.ts` (source test: columns, CHECKs, the unique index, RLS, no policy, the exact grants, no UPDATE or DELETE, no trigger, no function, the editor-word and apostrophe pins, and the metric and dimension CHECK patterns equal to the shape constants in `lib/business-os/finance/financeSnapshotShape.ts`, a pure module with no import that 8.1 creates and 8.2's builder imports, with no second copy allowed; its tier branch pinned equal to the tier part of `FINANCE_GROUP_SHAPE`; E-86, E-90); a `descriptors.ts` entry `never('business_os_finance_snapshots', G, exclude(EXPORT_REASON.PLATFORM), …)` (platform history, no `user_id`, never purged, never archived; CF-8); `supabase/SQL Scripts/20261078_business_os_finance_snapshots_rollback.sql`; `scripts/precheck-bos-finance-snapshots.sql` (check 31); `scripts/check-bos-finance-snapshots-migration.sql` (check 32); `scripts/test-bos-finance-snapshots.sql` (the local-only self-test, §11M.9).

**Rollback:** `DROP TABLE public.business_os_finance_snapshots;` in one transaction, which **refuses** (raises and changes nothing) once the table holds any row: the history cannot be rebuilt (CF-1, CF-2), so a defect found after the first night is fixed forward. Apply it only together with a revert of 8.2's code (otherwise the job fails each night, visibly on Jobs & queues).

**The user's hand-apply steps (8.1; the BD-33 stop):**

1. Run **check 31** on production. Every row must show `ok = true`; otherwise stop and tell the session.
2. Apply `20261078` in the SQL editor, the whole file at once.
3. Run **check 32**. Every row must show `ok = true`; if one does not, run the rollback and tell the session.
4. Tell the session "applied". RM merges 8.1 by hand (it is **not** on auto-merge: the migration-gated rule). 8.2 starts after that.
5. After 8.2's first night: run **check 33**, then **check 34** (L-158).

### 11M.7 The nightly job (slice 8.2)

| # | Rule |
|---|---|
| HS-FR-1 | **Route** `app/api/cron/finance-snapshot/route.ts`, `GET` (as the other crons), `runtime = 'nodejs'`, `maxDuration = 60`. `CRON_SECRET` is checked **fail-closed**, copied from `credit-leak-check` (CF-5): in production a missing secret refuses with 401 and an `error` log. It runs inside `withCronRunRecord`. Pino `createLogger({ module: 'FinanceSnapshotCron' })` with a `correlationId` child logger; no `console.`. |
| HS-FR-2 | **Registry:** a `finance-snapshot` entry in `BOS_CRON_JOBS` (`BosCronJobId` widened): path `/api/cron/finance-snapshot`, schedule `7 0 * * *`, byte for byte as in `vercel.json`, `DAILY`, `MAX_60`, label **"Finance history snapshot"**, description **"Records last night's plan mix and credit position for the Finance history"**, `scheduleWords` **"Daily at 00:07 UTC"**, `drainsQueue: null`, `addedOn` = the real deploy day (RM sets it in the PR). It then appears on Jobs & queues (late, stopped, keeps failing after 2) and in the Health tiles with no other edit. |
| HS-FR-3 | **Counts** (numbers only, no money word in a key; CF-5): `metricsWritten`, `metricsAlreadyThere`, `metricsSkipped`, `familiesSkipped`, `accountsRead`, `lateRun` (1 = yes). `partlyDoneWhen`: `familiesSkipped` at least 1; `lateRun` at least 1. |
| HS-FR-4 | **Builder** `lib/business-os/finance/financeSnapshot.ts`, **pure** (no repository, no clock, no entitlements import beyond what `planGroups.ts` already has): input = the plan rows, the paying set, the config, the credit positions pass, the lots and `now`; output = the rows of §11M.5 and the skipped families. It calls the Section 1 and Section 4 functions (HS-W-7). The wiring `financeSnapshotDeps.ts` reuses the finance wiring's reads (the plan walk, R-c, `adminCreditPercentDeps()`, `listLotsWithDrawsAllAccounts` through a `Pick`), maps lots field by field (SA-W14) and passes `getEntitlementConfig()`; whether it reuses `financeHealthDeps` or a narrow wiring is SA-Q105. |
| HS-FR-5 | **Writer:** a new `BusinessOsFinanceSnapshotRepository` (the `new-repository` skill), service role (`supabaseServer`); its header documents why there is no `.eq('user_id')`: the table has none, it holds platform aggregates (the CLAUDE.md rule 4 bypass). `insertSnapshotRows(rows)`: one batched insert, **`upsert(rows, { onConflict: 'as_of_date,metric,dimension', ignoreDuplicates: true }).select('id')`** (E-88: `ON CONFLICT DO NOTHING`, returning the ids of the rows actually written; it needs only `SELECT` and the column `INSERT` grant, never UPDATE), only the five granted fields, built field by field (tenant-isolation-guard step 3). Written = the returned ids; already there = rows sent minus rows returned. No update or delete method. |
| HS-FR-6 | **Order:** secret → late-run gate (HS-W-3) → reads → builder → one insert → the response `{ success: true, data: { asOfDate, …counts } }`. A read that fails skips its family (HS-W-5); an insert error is a 500 with `success: false`, a generic error and development-only details, and the run record marks it failed. |
| HS-FR-7 | **Logs:** one `info` line with `asOfDate`, the counts and `durationMs`; never a value, an account id or a name. |
| HS-FR-8 | **Time:** the reads are the all-businesses Section 1 and Section 4 reads the page makes today, under the same ceilings. **The credit pass gets a night budget (E-87):** the job passes `budgetMs` = 30 s to `readAdminCreditPositions` (a named constant beside `maxDuration` 60, with a test that it is below it); the page keeps its 2 s. The same functions with a longer budget, not a new read. QA records `durationMs` and `familiesSkipped` (L-157). No read is added to the page's own request. |
| HS-FR-8a | **Wiring (E-94, amends SA-Q105):** `financeSnapshotDeps()` **picks** its four reads and the config from `financeHealthDeps()`, typed by a `Pick` of `FinanceHealthDeps`, and adds only the snapshot writer. The reads are therefore the page's reads by construction, and no repository caller list or entitlements-importer pin changes. `walkPlans` is exported as is, and the paying derivation becomes an exported `payingSetOf(rows)` that the page calls in the same place. Neither move may change any page figure; the AC-145 hash and the unedited Section 1 / Section 4 tests prove it. The credit sums are added up in micro-credits from `buildCreditsSection`'s per-account rows; no second definition of a position is written |
| HS-FR-8b | **Table not installed (E-96):** after the late gate and before any read, the job probes the table. On a missing relation (the shared `isMissingRelationError`; a missing column is a 500, not "missing") it reads and writes nothing, logs one `error` `{ tableMissing: true }` and returns **503**, so the run reads "failed" on Jobs & queues. **Clock (E-97):** the route takes its start from an injectable `financeSnapshotClock.now()`, so the cron run-record adoption test and the route tests can fix the hour. There is no "Run now" for this job (the Jobs page has none; a later requirement may add one) |

### 11M.8 The History block (slice 8.3)

| # | Rule |
|---|---|
| HS-FR-9 | **Read route** `GET /api/admin/business-os/finance/history` (the `new-api-route` skill): `requireAdmin` is the **first statement**; a strict Zod schema with the finance route's window input (`preset`, `from`, `to`), re-resolved on the server with its own clock (SA-Q2); **`accountId` is a 400** (history is all businesses only), `since_start` is a 400 (it needs a business), and an unknown key is a 400. **It returns a server-built view, not raw rows (E-99, SA-W-8.3-1):** `{ success: true, data: { window, firstSnapshotDate, state, weekly, planMix: { columns, points, change }, credits: { columns, points, change } } }`. The view comes from a pure `buildHistoryView`, which applies HS-FR-12 to HS-FR-15 (the points, "No snapshot", "Not recorded", weekly sampling, the change lines), because the browser may only format. Raw rows never leave the server. A separate route keeps the Overview payload (AC-145) and the AC-173 request pins untouched (CF-9). |
| HS-FR-10 | **Reads:** `listSnapshotsInRange(fromDate, toDate)` (at most 93 days of about 40 rows; ceiling 5,000 rows, **an error at the ceiling**, never a partial list) and `findFirstSnapshotDate()`, on **a separate read-only repository, `BusinessOsFinanceSnapshotReadRepository`** (E-98, SA-W-8.3-5). The writer repository keeps one importer (the 8.2 job's wiring), so the 8.2-R2 guard stays exactly as strict. Selected columns: `as_of_date`, `metric`, `dimension`, `unit`, `value` only. |
| HS-FR-11 | **Where:** one **History** block on the Overview, after Section 4, in the shared `FinanceSection` shell, **all businesses only**. With a business picked it shows one line, **"History is kept for all businesses together, not per business."**, and sends no history request. **E-85: the block renders closed**, with a **"Show history"** button; the history request is sent **only when the admin opens it**, never on page load, so the page still sends exactly one request on load (AC-173 and the other one-fetch render tests are unchanged). It is never part of the finance request. If the closed block's markup trips Pin A or Pin B, Dev stops and raises it to SA (no silent re-freeze). The history request literal is pinned in its own new test, never in the AC-173 table. |
| HS-FR-12 | **Honest start line**, always first: **"History starts on {firstSnapshotDate} (UTC)."** With no snapshot at all: **"No history yet: a snapshot is taken every night at 00:07 UTC."** (E-101: true on any day, unlike "tonight"). With snapshots but none in the window: **"No snapshot in this window. History starts on {firstSnapshotDate} (UTC)."** Dates are `YYYY-MM-DD`. Below it: **"Each point is the state at the end of that UTC day. Credits are units, not money."** |
| HS-FR-13 | **Two small tables, no chart** (minimal; SA-Q106). **Plan mix:** Date, one column per group in Section 1's order (labels from config; a stored key no longer in config shows the key and "(no longer configured)", HS-W-10), Total, Founding Partners with no end date. **Credits:** Date, Included credits, Used this period, Gifted outstanding, Bought outstanding, Outstanding total, Accounts over allowance, Far over allowance. Newest first. |
| HS-FR-14 | **Points:** a window of up to 31 days shows **one row per day**; a longer window shows one row per 7 days, counting back from its last day, and says "Weekly points". A day with no row shows **"No snapshot"** across the table (HS-W-6). A metric not written that day shows **"Not recorded"** in its cell, never 0. |
| HS-FR-15 | **Change line** under each table: the newest point minus the oldest point in the window, per column, **only** when both cells are recorded; otherwise "Not available". It is labelled "Change in this window". |
| HS-FR-16 | **States:** the block uses `AdminLoading`, `AdminError` (with Try again) and `AdminNotice`, like the rest of Finance; a failed history read fails the block only, never the page. **Not installed (E-100):** when the table is missing (the shared `isMissingRelationError`; a missing column is still an error), the route answers 200 with `state: 'not_installed'` and logs a `warn`. The block shows the calm `AdminNotice` "History is not available yet: it starts once the nightly snapshot is installed.", with no error tone and no Try again. This is proven by tests only; there is no browser step (production has the table before 8.3 ships). The chip: `FinanceSection` gains an optional `statusChip` (default true, so every existing caller's DOM is unchanged); the closed block hides it. |

### 11M.9 Scripts and SQL checks (31 to 34)

Read-only, ASCII only, no apostrophes in comments, the editor word never used, one final result set each. Written against §11M.1 and §11M.6; not executed by BA. Checks 31 and 32 are the files named in §11M.6; checks 33 and 34 are pasted from here.

**Local self-test (not a check):** `scripts/test-bos-finance-snapshots.sql`, in the shape of `scripts/test-bos-boost-reversal-events.sql`: **local only**; it refuses on a real Supabase database (`auth.refresh_tokens` exists) and unless `bos.selftest_local` is `on`, and runs between BEGIN and ROLLBACK on the PGlite harness. Cases: a valid row of each unit is written; the same key a second time writes nothing (`ON CONFLICT DO NOTHING`, idempotency); a negative value, a fraction of an account, an unknown unit, a metric or dimension with a space or `@`, a bare uuid as a dimension, and a `taken_at` before the day ended are each refused by their CHECK; a hyphenated tier key such as `tier:pro-plus` is accepted (E-86); as `service_role` with no UPDATE grant, the `ON CONFLICT DO NOTHING` insert with a returned `id` works and returns only the new rows (E-88); as `service_role`, UPDATE and DELETE are refused (42501), and so is setting `id` or `taken_at`; the rollback refuses with a row present and drops an empty table.

**File:** `scripts/precheck-bos-finance-snapshots.sql` (check 31, before applying `20261078`; AC-273, L-155)

```sql
-- Finance check 31: run BEFORE applying migration 20261078, read only.
-- Every row must show ok = true. If one does not, stop and tell the session.
select 'snapshots table absent' as item,
  to_regclass('public.business_os_finance_snapshots') is null as ok
union all
select 'snapshot key index name free',
  to_regclass('public.business_os_finance_snapshots_day_metric_key') is null
union all
select 'no constraint already uses the snapshot table name',
  not exists (select 1 from pg_catalog.pg_constraint c
              where c.conname like 'business_os_finance_snapshots%')
union all
select 'service_role exists and bypasses row level security',
  coalesce((select r.rolbypassrls from pg_catalog.pg_roles r where r.rolname = 'service_role'), false)
union all
select 'gen_random_uuid is available',
  exists (select 1 from pg_catalog.pg_proc p where p.proname = 'gen_random_uuid')
union all
select 'cron run record installed',
  to_regclass('public.bos_cron_runs') is not null;
```

**File:** `scripts/check-bos-finance-snapshots-migration.sql` (check 32, after applying `20261078`; AC-273, L-155)

```sql
-- Finance check 32: run AFTER applying migration 20261078, read only.
-- Every row must show ok = true. If one does not, run the rollback and tell the session.
with t as (
  select to_regclass('public.business_os_finance_snapshots') as tbl
)
select 'table exists' as item, t.tbl is not null as ok from t
union all
select 'row level security on',
  coalesce((select c.relrowsecurity from pg_catalog.pg_class c where c.oid = t.tbl), false) from t
union all
select 'no policy on the table',
  not exists (select 1 from pg_catalog.pg_policy pol where pol.polrelid = t.tbl) from t
union all
select 'anon has no privilege on the table or any column',
  not coalesce(has_table_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or has_any_column_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, REFERENCES'), true) from t
union all
select 'authenticated has no privilege on the table or any column',
  not coalesce(has_table_privilege('authenticated', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or has_any_column_privilege('authenticated', t.tbl, 'SELECT, INSERT, UPDATE, REFERENCES'), true) from t
union all
select 'service_role can select',
  coalesce(has_table_privilege('service_role', t.tbl, 'SELECT'), false) from t
union all
select 'service_role can insert exactly five columns',
  coalesce((select count(*) from pg_catalog.pg_attribute a
            where a.attrelid = t.tbl and a.attnum > 0 and not a.attisdropped
              and has_column_privilege('service_role', t.tbl, a.attnum, 'INSERT')) = 5, false) from t
union all
select 'service_role cannot set id or taken_at',
  not coalesce(has_column_privilege('service_role', t.tbl, 'id', 'INSERT')
    or has_column_privilege('service_role', t.tbl, 'taken_at', 'INSERT'), true) from t
union all
select 'service_role cannot update',
  not coalesce(has_table_privilege('service_role', t.tbl, 'UPDATE')
    or has_any_column_privilege('service_role', t.tbl, 'UPDATE'), true) from t
union all
select 'service_role cannot delete or truncate',
  not coalesce(has_table_privilege('service_role', t.tbl, 'DELETE, TRUNCATE'), true) from t
union all
select 'seven columns and no user_id column',
  coalesce((select count(*) = 7 and bool_and(a.attname <> 'user_id')
            from pg_catalog.pg_attribute a
            where a.attrelid = t.tbl and a.attnum > 0 and not a.attisdropped), false) from t
union all
select 'unique key on day, metric and dimension, not partial',
  exists (select 1 from pg_catalog.pg_index i
          join pg_catalog.pg_class ic on ic.oid = i.indexrelid
          where i.indrelid = t.tbl and i.indisunique and i.indpred is null
            and ic.relname = 'business_os_finance_snapshots_day_metric_key') from t
union all
select 'the six checks are present',
  coalesce((select count(*) from pg_catalog.pg_constraint c
            where c.conrelid = t.tbl and c.contype = 'c'
              and c.conname in ('business_os_finance_snapshots_metric_shape',
                                'business_os_finance_snapshots_dimension_shape',
                                'business_os_finance_snapshots_unit_known',
                                'business_os_finance_snapshots_value_not_negative',
                                'business_os_finance_snapshots_accounts_whole',
                                'business_os_finance_snapshots_day_ended')) = 6, false) from t
union all
select 'dimension check is exactly the E-86 pattern',
  coalesce((select position('^([a-z][a-z0-9_]{0,47}|tier:[a-z0-9_-]{1,40})$' in pg_catalog.pg_get_constraintdef(c.oid)) > 0
            from pg_catalog.pg_constraint c
            where c.conrelid = t.tbl and c.conname = 'business_os_finance_snapshots_dimension_shape'), false) from t
union all
select 'no trigger on the table',
  not exists (select 1 from pg_catalog.pg_trigger tg where tg.tgrelid = t.tbl and not tg.tgisinternal) from t
union all
select 'table comment present',
  obj_description(t.tbl, 'pg_class') is not null from t;
```

**File:** `check 33 - finance history, the last 14 snapshot days` (AC-283, L-158)

```sql
-- Finance check 33: the last 14 snapshot days, one row per day, read only.
-- Run after the first nightly snapshot, and whenever the History block looks wrong.
-- groups_match_total and taken_after_day_end must be true on every day.
-- A day missing from the list is a missed or late night and shows as a gap on the page.
with s as (
  select f.as_of_date, f.metric, f.value, f.taken_at
  from public.business_os_finance_snapshots f
  where f.as_of_date >= (now() at time zone 'UTC')::date - 14
),
d as (
  select s.as_of_date,
         count(*) as snapshot_rows,
         count(*) filter (where s.metric like 'credit%' or s.metric like 'gifted%' or s.metric like 'bought%') as credit_rows,
         max(s.value) filter (where s.metric = 'accounts_total') as accounts_total,
         sum(s.value) filter (where s.metric = 'accounts_in_group') as accounts_in_groups,
         min(s.taken_at) as first_taken_at
  from s
  group by s.as_of_date
),
r as (
  select (c.started_at at time zone 'UTC')::date - 1 as as_of_date,
         string_agg(distinct c.outcome, ' ') as run_outcomes,
         count(*) as runs
  from public.bos_cron_runs c
  where c.job = 'finance-snapshot'
    and c.started_at >= now() - interval '15 days'
  group by 1
)
select d.as_of_date,
       d.snapshot_rows,
       d.credit_rows,
       d.accounts_total,
       d.accounts_in_groups,
       (d.accounts_total is null or d.accounts_total = d.accounts_in_groups) as groups_match_total,
       (d.first_taken_at >= ((d.as_of_date + 1)::timestamp at time zone 'UTC')) as taken_after_day_end,
       d.first_taken_at,
       r.runs,
       r.run_outcomes
from d
left join r on r.as_of_date = d.as_of_date
order by d.as_of_date desc;
```

**File:** `check 34 - finance history, the newest snapshot against the lots and plan rows` (AC-280, L-158)

```sql
-- Finance check 34: the newest snapshot against the lots and plan rows, one row, read only.
-- Gifted and bought outstanding are rebuilt from the lots and draws as they stood at taken_at,
-- for lots that still have an account. A difference is expected only when an account was
-- deleted after taken_at (its lots lose their account) or a lot was written in the same second.
-- plan_rows_then counts plan rows created by taken_at. It can be lower than the snapshot
-- only when an account was deleted since.
with newest as (
  select max(g.as_of_date) as as_of_date from public.business_os_finance_snapshots g
),
snap as (
  select f.metric, f.value, f.taken_at
  from public.business_os_finance_snapshots f
  join newest n on n.as_of_date = f.as_of_date
  where f.dimension = 'all'
),
at_time as (
  select (select n.as_of_date from newest n) as as_of_date,
         (select min(snap.taken_at) from snap) as taken_at
),
lots as (
  select l.source,
         greatest(l.credits_granted - coalesce((
           select sum(dr.credits)
           from public.business_os_credit_lot_draws dr
           where dr.lot_id = l.id and dr.created_at <= a.taken_at), 0), 0) as remaining
  from public.business_os_credit_lots l
  cross join at_time a
  where l.user_id is not null
    and l.created_at <= a.taken_at
    and (l.expires_at is null or l.expires_at > a.taken_at)
)
select a.as_of_date,
       a.taken_at,
       (select snap.value from snap where snap.metric = 'gifted_outstanding') as snapshot_gifted,
       coalesce((select sum(lots.remaining) from lots where lots.source = 'admin_grant'), 0) as rebuilt_gifted,
       (select snap.value from snap where snap.metric = 'bought_outstanding') as snapshot_bought,
       coalesce((select sum(lots.remaining) from lots where lots.source = 'boost_purchase'), 0) as rebuilt_bought,
       (select snap.value from snap where snap.metric = 'accounts_total') as snapshot_accounts,
       (select count(*) from public.business_os_account_plans p where p.created_at <= a.taken_at) as plan_rows_then
from at_time a;
```

### 11M.10 Guards and tests affected

| Guard or test | Effect | What Dev must do |
|---|---|---|
| **Frozen pins** | AC-173 pin `3a1a2dd4…f6f8` and helper `b84e0c96…aabf`; Pin A `30f5fc24…2e01`; Pin B `24ff0da7…df9f`; Pin C `98ea0507…1e4b` and helper `02813360…5bd8`; Pin D `1f7cf07a…f144` | All **byte-identical** (LF-normalised), hashed at Step 0 and at handover, in each of 8.1, 8.2 and 8.3. The history request is a new test, never a row of the AC-173 table; the Overview payload is unchanged (AC-145) because history has its own route |
| `requireAdmin` first (`test:authz-guard`) | New admin route (8.3) | `requireAdmin` is the first statement of the history `GET`; the guard passes with no allow-list edit |
| **tenant-isolation-guard** (skill) | A service-role write (8.2) and a service-role all-accounts read (8.3) | Apply the skill: the job takes no caller input; the insert allow-lists the five fields (step 3); no row can carry an account id (HS-W-8; the dimension pattern refuses a uuid with dashes, and the builder refuses any dimension outside its known keys); the history route refuses `accountId`; a test proves no account id, name or reason reaches a row or the response |
| `aiCostVocabulary.source.guard.test.ts` | New strings in `financeCopy.ts` (8.3) and the registry label (8.2) | No edit and no ALLOWED entry: none of the History strings is about AI cost or uses an SA-Q51 word |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | New `financeSnapshot.ts` | Pure: no repository, data layer or clock import; no `user_preferences` or `timezone` token; no tier literal |
| `tierLiteral.forbidden.test.ts`, `npm run test:bos-entitlements` | The wiring passes `getEntitlementConfig()` | Register the new importer as a **non-gate** importer in the same change (the `business-os-entitlements` skill), as `planGroups.ts` is; no tier or cohort literal anywhere |
| `lib/cron/__tests__/bosCronJobs.test.ts` | New job (8.2) | The entry matches `vercel.json` byte for byte and the route's `maxDuration`; keys pass the key rule and the no-money rule; `addedOn` is set; the file still imports nothing |
| Repository caller lists (the lot repository's and the G3 lists, the RC-15 deps pin) | A second caller of `listLotsWithDrawsAllAccounts` and of the plan walk (8.2) | One ruled update each, recorded in the workplan (SA-Q105) |
| `businessOwnedTables.test.ts`, `descriptors.invariant.test.ts`, `no-deletion-paths.guard.test.ts` | New table (8.1) | The `never(…, G, exclude(EXPORT_REASON.PLATFORM))` entry; no deletion path is added |
| **Descriptor count pins (E-92, SA-W-8.1-3)**: `classification-baseline.json` (`count`, `levels`, `reviewNotes`), `descriptors.invariant.test.ts` `baseline.count`, `exportClassification.test.ts` (two `toHaveLength`, the `kinds` exclude total, the test title) | New descriptor (8.1) | +1 each, with a dated comment. **The numbers are recomputed at code time from merged `origin/main`**, never copied from this document (main is already at 156 / exclude 118 after DE-8a). #447 and 8.1 each add one, so **whichever lands second re-counts** when it merges main |
| Test-account cleanup function (`scripts/generate-test-account-cleanup-sql.ts`, drift test) | **None** (SA-WR-8.1): a global `never` is filtered out by `descriptorsForRun`, and the table has no FK and no `user_id` | No new function version; the drift test passes with no regeneration against main's generator state (`20261075`, and later #447's `20261077`) |
| Migration source test (8.1) | New | The §11M.6 contents, the grants, the editor-word and apostrophe pins |
| `app/admin/finance/__tests__/source.guard.test.ts`, `layoutFolder.guard` (C-14), contrast | New `HistorySection.tsx` (8.3) | Shared shell and states; type imports only; no date arithmetic in the component beyond formatting; no `console.` |
| **CI time** | New Jest files only | They run inside the existing Jest job: **no new CI job and no added critical-path time** (the user's standing rule). The local self-test runs on the PGlite harness, not in CI, unless SA rules it fits an existing job |

Dev runs before SA code review and pastes in the workplan: `npm run test:bos-entitlements`, `npm run test:authz-guard`, the finance, cron and shared layout suites, the vocabulary guard, `npm run lint:hooks`, eslint on touched files, the scoped `tsc` with canary (AC-44), and the seven pin hashes.

### 11M.11 Acceptance criteria

All testable by Jest or by QA's recorded manual check.

**8.1 (migration):**

- [ ] **AC-273** *(8.1)* `20261078` creates `business_os_finance_snapshots` with the §11M.6 columns, the six CHECKs, the unique `(as_of_date, metric, dimension)` index, RLS on, no policy, `REVOKE ALL` from the four roles, `GRANT SELECT` and the five-column `GRANT INSERT` to `service_role` only, no trigger and no function (migration test; checks 31 and 32).
- [ ] **AC-274** *(8.1)* The migration file, the rollback and checks 31 to 34 contain no apostrophe in a quoted string or comment and never the editor word; they are ASCII only (source test).
- [ ] **AC-275** *(8.1)* The rollback drops the table when it is empty and **refuses**, changing nothing, when it holds a row (local self-test).
- [ ] **AC-276** *(8.1)* The local self-test passes every case of §11M.9 (the idempotent key, each CHECK, `tier:pro-plus` accepted and a bare uuid refused (E-86), the returning insert with no UPDATE grant (E-88), no UPDATE, no DELETE, no `id` or `taken_at` from the writer); the migration test pins the dimension CHECK equal to the builder's shape constant.
- [ ] **AC-277** *(8.1)* The `descriptors.ts` entry exists and the classification, invariant and no-deletion guards pass.

**8.2 (the job):**

- [ ] **AC-278** *(8.2)* The route refuses without the secret in production (401 and an `error` log) and runs in development without it; the run is recorded in `bos_cron_runs` with the HS-FR-3 counts.
- [ ] **AC-279** *(8.2)* With an injected start at 00:07 UTC on date D the rows carry `as_of_date` = D − 1; a start at 02:00 UTC or later writes no row and reports `lateRun = 1` (partly done).
- [ ] **AC-280** *(8.2)* **Same definitions:** for one fixture, every `plan`, `credit` and `lots` value equals the figure Section 1, Section 4, K-2, K-3 and K-4 give for all businesses with the same `now` (a builder test against `buildFinanceHealth`'s own output); on production, check 34's rebuilt gifted and bought figures equal the snapshot.
- [ ] **AC-281** *(8.2)* **Idempotent (E-88):** the writer calls `upsert(…, { onConflict: 'as_of_date,metric,dimension', ignoreDuplicates: true }).select('id')`; `metricsWritten` = the ids returned and `metricsAlreadyThere` = rows sent minus rows returned; a second run for the same day writes 0 rows (`metricsAlreadyThere` = the first run's `metricsWritten`) and changes no value.
- [ ] **AC-282** *(8.2)* **Only exact figures (HS-W-5):** a failed plan walk, a plan walk at its ceiling or a failed paying read writes no `plan` row; a failed or timed-out credit pass writes no `credit` row; an unknown account suppresses the three `credit` sums but not the counts; an invalid far-over line suppresses `credit_far_over_allowance` only; a failed lots read writes no `lots` row and no outstanding total; a row outside the dimension shape (for example a tier key with a character the CHECK refuses) skips the `plan` family only and every other family is still written (E-86); each case reports `familiesSkipped` or `metricsSkipped` and the run is partly done. Never a 0 in place of a missing figure. The credit pass runs with `budgetMs` = 30 s, a named constant below `maxDuration` 60 (E-87, unit test).
- [ ] **AC-283** *(8.2)* Every seeded plan group is written, zeros included, and `accounts_in_group` sums to `accounts_total` (unit test; check 33 `groups_match_total`).
- [ ] **AC-284** *(8.2)* **Isolation:** no written row holds an account id, name, email, reason, Stripe id or admin id; a planted account id as a dimension is refused by the builder before the insert (tenant-isolation test).
- [ ] **AC-285** *(8.2)* **No money:** every row's unit is `accounts` or `credits`; the builder's pinned metric list holds no revenue, cost, fee, takings or currency metric.
- [ ] **AC-286** *(8.2)* The registry entry shows on Jobs & queues with its label, schedule words and counts; `bosCronJobs.test.ts` passes with `vercel.json` `7 0 * * *` and `maxDuration` 60.

**8.3 (the History block):**

- [ ] **AC-287** *(8.3)* The history route runs `requireAdmin` first; with `accountId`, `since_start` or an unknown key it is a 400; the window is re-resolved on the server; it returns only `as_of_date`, `metric`, `dimension`, `unit` and `value` rows and `firstSnapshotDate`; at the 5,000-row ceiling it is an error, never a partial list (route tests: happy path, auth failure, invalid input).
- [ ] **AC-288** *(8.3)* The History block shows the HS-FR-12 start line in each of its three forms (no history; none in the window; history), with `YYYY-MM-DD` dates.
- [ ] **AC-289** *(8.3)* Daily rows for a window of up to 31 days and weekly rows beyond; "No snapshot" rows for missing days; "Not recorded" for a missing metric, never 0; the change line only between two recorded cells.
- [ ] **AC-290** *(8.3)* **On demand (E-85):** on page load the block is closed with a "Show history" button and **no history request is sent** (AC-173's one fetch and the other one-fetch render tests pass unedited); the request is sent only on "Show history", and its literal is pinned in its own new test. With a business picked, the block shows the "all businesses together" line, no button and no request; the finance request and its AC-173 literal are unchanged.
- [ ] **AC-291** *(8.3)* A tier key no longer in config shows its stored key and "(no longer configured)"; group labels otherwise come from config; there is no tier literal in the component.
- [ ] **AC-292** *(8.3)* A failed history read shows the block's error with Try again and leaves every other section rendered.
- [ ] **AC-293** *(all)* Every §11M.10 row passes; the seven frozen pins are byte-identical; the Overview payload with no tab and no business is unchanged (AC-145); the vocabulary guard passes with no edit; no new CI job.
- [ ] **AC-294** *(all)* **Manual QA (L-155 to L-162):** run the steps below and record them in the relevant workplan.

**Manual steps** (user or QA, recorded in the workplan):

- **L-155** *(8.1, user)* Run check 31 on production: every row `ok = true`. Apply `20261078`. Run check 32: every row `ok = true`. Tell the session "applied".
- **L-156** *(8.2)* After the deploy, open Jobs & queues: "Finance history snapshot" is listed, "Daily at 00:07 UTC", with no run until the first night.
- **L-157** *(8.2)* After the first night: the run is green; note `metricsWritten`, `familiesSkipped` (expected 0) and `durationMs` from the route line (E-87).
- **L-158** *(8.2)* Run check 33 (one day; `groups_match_total` and `taken_after_day_end` true) and check 34 (the rebuilt gifted and bought figures equal the snapshot).
- **L-159** *(8.3)* Open Finance, all businesses, This month: the History block is closed and the network panel shows one request; click "Show history": one history request, and the block reads "History starts on {first day} (UTC)." and shows one row per snapshot day.
- **L-160** *(8.3)* The morning after a snapshot, compare its Plan mix row with Section 1 and its Credits row with Section 4, K-2 and K-4 (they may differ only by changes made since 00:07 UTC).
- **L-161** *(8.3)* Pick the owner test account: the block shows the "all businesses together" line and nothing else.
- **L-162** *(8.3)* Choose a custom window of 60 days: "Weekly points"; days before the first snapshot are not listed and nothing reads 0.

### 11M.12 Open questions for SA (slice 8)

Technical only. The business points are **BQ-17** (daily or monthly), **BQ-18** (how long to keep) and **BQ-19** (backfill) in §0.4; none blocks the build, and each has a default.

| # | Question | BA suggestion |
|---|---|---|
| **SA-Q100** | A long table (one row per metric and dimension, §11M.6) or a wide one (one row per day, a column per figure)? | Long: a new group or metric needs no migration, the idempotency key is natural, and the history read is one range scan |
| **SA-Q101** | CHECK the metric list in SQL, or only its shape, with the list pinned in code? | Shape only (the `20261005` "no second source of truth" precedent); the code list is pinned by a test, and HS-W-9 is enforced by the `unit` CHECK |
| **SA-Q102** | The write: a PostgREST insert that ignores duplicates on the key (INSERT grant only), or a SECURITY INVOKER SQL function? Does the insert with a returned count need anything beyond SELECT and the column INSERT grant? | The PostgREST insert, no function (no new function surface); the self-test proves the grants suffice |
| **SA-Q103** | The late-run cut-off: 02:00 UTC, or none (always label the previous day)? | 02:00 UTC: a state read at noon is not "the end of yesterday", and a gap is more honest |
| **SA-Q104** | The `…_day_ended` CHECK: which expression (the date to UTC midnight) is safe in a CHECK, or drop it and rely on the builder and check 33? | Keep it if an immutable form exists; otherwise drop it and keep check 33's `taken_after_day_end` |
| **SA-Q105** | Wiring: reuse `financeHealthDeps` for the four reads, or a narrow `financeSnapshotDeps` with its own `Pick`s? Which caller-list pins change? | A narrow wiring that names only the four reads; one ruled update per caller list |
| **SA-Q106** | The trend as two tables (no chart), or the first admin use of `recharts`? | Tables: minimal and no new pattern (CF-10, CLAUDE.md rule 7); a chart is a later UI slice |
| **SA-Q107** | Path: 8.1 full cycle and migration-gated (merged by hand after the user applies it); 8.2 full cycle (a new cron and writer); 8.3 full cycle (a new admin route as well as UI, so not the UI short path)? | Yes to all three; 8.2 and 8.3 may auto-merge under BD-33 once 8.1 is applied |

### 11M.13 Estimate and split

**About 3.5 days** (inside BD-32's 3 to 4), in three small slices:

| Slice | Contents | Estimate | Gate |
|---|---|---|---|
| **8.1** | Migration `20261078`, its source test, the descriptor entry, the rollback, checks 31 and 32, the local self-test; AC-273 to AC-277 | about 1 day | **Stops for the user**: the PR is off auto-merge; the user runs check 31, applies `20261078` on production by hand and runs check 32 (L-155); RM merges by hand |
| **8.2** | The repository writer, the pure builder, the wiring, the cron route, the registry entry and `vercel.json`; checks 33 and 34; AC-278 to AC-286 | about 1.5 days | Starts after 8.1 is applied and merged; BD-33 fast track |
| **8.3** | The repository reads, the history route, the History block and its copy; AC-287 to AC-292 | about 1 day | After 8.2; BD-33 fast track |

AC-293 and AC-294 apply to every slice. Each slice gets its own workplan and PR (§9).

### SA Requirement Review — Slice 8 (§11M) — 2026-10-17

**Reviewed by SA, 2026-10-17, on `feature/bos-finance-health-8` (DF-6 tip) and `origin/feature/bos-finance-health-4b` (#447).**
**Status: APPROVED WITH CONDITIONS (SA-RR-8).** The 8.1 workplan may start; E-85 to E-88 must be in the requirement before the 8.2 / 8.3 workplans.
**BA, 2026-10-17: E-85 to E-88 applied** in §11M (E-85: HS-FR-11, AC-290, L-159; E-86: the §11M.6 dimension CHECK and migration test, HS-W-5, the self-test cases, AC-276, AC-282, a check 32 row; E-87: HS-FR-8, AC-282, L-157; E-88: HS-FR-5, the self-test, AC-276, AC-281; the SA-Q104 CHECK expression written in the §11M.6 `taken_at` row). Ready for the Dev workplan (8.1).

**Verified**

| Claim | Result |
|---|---|
| Migration number | ✅ The highest on `origin/main` is `20261071`. The only open PR touching `2026107x` is #447 (`20261072`, `20261073`). `20261074` is free; RM re-checks it when 8.1 opens |
| House style (CF-7) | ✅ `20261072` on the #447 branch: `BEGIN`, `lock_timeout`, named `ADD CONSTRAINT … CHECK`, `COMMENT ON TABLE`, RLS, `REVOKE ALL` from the four roles, `GRANT SELECT` plus a column-list `GRANT INSERT`. Its precheck, checker, local self-test and refusing rollback exist in the paths §11M.6 copies |
| Tables and columns named | ✅ Read from the migrations: lots (`source` CHECK `admin_grant` / `boost_purchase`, `credits_granted`, `expires_at`, `created_at`), draws (`kind` CHECK `reversal` only, `lot_id`, `credits`, `created_at`), `bos_cron_runs` (`job`, `started_at`, `outcome`), `business_os_account_plans.created_at`. `extraCreditsAt`, `readAdminCreditPositions` (with a `budgetMs` option), `listLotsWithDrawsAllAccounts` and `withCronRunRecord` exist |
| Cron pattern (CF-5) | ✅ `credit-leak-check` uses `withCronRunRecord`; `BosCronJob` has `addedOn`; minute `7 0` is free in `vercel.json`. Not a queue drain (HS-W-11) is correct: no claim, an idempotent key-only write |
| Descriptors (CF-8) | ✅ The `never('bos_cron_runs', G, exclude(EXPORT_REASON.PLATFORM), …)` precedent is at `descriptors.ts:1475` |
| Isolation and currency | ✅ No `user_id` or free text, platform aggregates only, `unit` limited to accounts or credits, no money (HS-W-8, HS-W-9). DF-9 deferral is correct |
| Reuse | ✅ HS-W-7 and AC-280 (builder output equals `buildFinanceHealth`'s figures for the same `now`) prevent a second definition |
| SQL checks 31 to 34 | ✅ ASCII only, no apostrophe in a comment, never the editor word, one result set each. Columns match the migrations |
| CI time, vocabulary, pins | ✅ Jest files only; no new job. The pins are untouched by 8.1 and 8.2; for 8.3 see E-85 |

**Findings**

| # | Sev | Finding | Edit |
|---|---|---|---|
| S8-F1 | High | **A History fetch on page load collides with frozen pins.** AC-173 (`financeRequest.pin.render.test.tsx:108`) asserts `fetch` is called **exactly once**, and Pin B mocks `fetch` with the finance body for every URL. Five other finance render tests also assert one fetch call. A second request "beside the finance request" (HS-FR-11) puts all of these at risk, and the pins cannot be edited. | **E-85:** HS-FR-11 and AC-290 become: the History block renders **closed**, with a "Show history" button. The history request is sent **only when the admin opens it**, never on load, so no existing request count changes. If the closed block's markup trips Pin A or Pin B, Dev stops and raises it to SA; no silent re-freeze. The history request literal is pinned in its own new test |
| S8-F2 | High | **The dimension CHECK refuses real tier keys.** Tier ids are unconstrained text (`20261005`: no CHECK), and Finance's own `FINANCE_GROUP_SHAPE` admits `tier:[a-z0-9_-]{1,40}`. `^[a-z][a-z0-9_:]{0,47}$` refuses a hyphen, so one hyphenated tier would make the single batched insert fail, and **every** family would be lost that night. | **E-86:** the `…_dimension_shape` CHECK becomes `dimension ~ '^([a-z][a-z0-9_]{0,47}|tier:[a-z0-9_-]{1,40})$'`. A hyphen is allowed only after `tier:`, so a uuid still cannot pass. The builder checks every row against one exported shape constant, pinned equal to the CHECK by the migration test, **before** the insert. A tier key outside it skips the `plan` family only (`familiesSkipped`), never the batch. Self-test case: `tier:pro-plus` is accepted and a bare uuid is refused |
| S8-F3 | Medium | **The 2 s credit-pass budget is a page budget.** At night, as accounts grow, it would skip the `credit` family every night with no visible cause. `readAdminCreditPositions` takes `budgetMs`. | **E-87:** HS-FR-8: the job passes `budgetMs` = 30 s (a named constant beside `maxDuration` 60, with a test that it is under it). These are the same functions with a longer budget, not a new read. L-157 also records `familiesSkipped` |
| S8-F4 | Low | **Insert and select need the right PostgREST call.** It must be `upsert(rows, { onConflict: 'as_of_date,metric,dimension', ignoreDuplicates: true }).select('id')` (`ON CONFLICT DO NOTHING`, returning only rows written). It needs only `SELECT` plus the column `INSERT` grant. | **E-88:** HS-FR-5 names that call; "already there" = sent minus returned; the self-test covers the `service_role` path with no UPDATE grant |

**Answers to SA-Q100 to SA-Q107**

| # | Ruling |
|---|---|
| SA-Q100 | **Long**, as BA suggests |
| SA-Q101 | **Shape only** in SQL (with E-86); the metric list is pinned in code |
| SA-Q102 | **PostgREST insert, no function** (E-88); the self-test proves the grants |
| SA-Q103 | **02:00 UTC** cut-off; late runs write nothing |
| SA-Q104 | **Keep the CHECK:** `taken_at >= ((as_of_date + 1)::timestamp AT TIME ZONE 'UTC')`. It is deterministic (a literal zone; `date + integer` and the cast are immutable). Check 33 keeps its own test |
| SA-Q105 | **Narrow `financeSnapshotDeps`** with its own `Pick`s, read-only; one ruled update per caller list, named in the 8.2 workplan; entitlements importer registered as a non-gate importer |
| SA-Q106 | **Two tables, no chart** (no new pattern, rule 7) |
| SA-Q107 | **Yes.** 8.1 is migration-gated and merged by hand. 8.2 and 8.3 run the full cycle and may auto-merge under BD-33 once 8.1 is applied |

**Business questions.** The BQ-17 (daily), BQ-18 (keep forever) and BQ-19 (no backfill) defaults are sound and block nothing. **Estimate:** 3.5 days accepted (8.1 about 1, 8.2 about 1.5, 8.3 about 1).

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
| Slice 1c rows (BD-14, BD-15) | R-c, R-c′ and R-d drop `livemode`; new paying-champion mapping; new panel copy | See §11B.5: the finance repository test's `livemode = true` pins, the source guard's layer-A non-vacuity control, the S1-FR-26/27 and AC-22/23 panel tests, the classifier tests; `enforcementPoints` only if symbols change | 1c |
| Slice 4 rows (boost revenue, problems, bought credits) | New reads R-k, R-k′, R-l, R-l′ on a table the repository already reads; panel and K-5 copy change; K-5 gains a rule (4b) | See §11C.7: the finance table pin does **not** grow; the repository test gains one test per method; the 1c panel tests are updated; the boost repository and the three webhook placement guards are not tripped (run unchanged) | 4a, 4b |
| Slice 5a rows (Money M-1 picker swap and account summary; M-2 plan payments received) | M-1 deletes the original picker named by four guards and touches the Businesses page; M-2 adds R-m, R-m′ on a table the repository already reads, and changes the plans line and K-5 | See §11D.7: the picker contract test, layout folder guard, contrast guard and finance render tests (M-1); the finance table pin does **not** grow, the repository test gains one test per method, the billing event caller list and the four billing placement guards are not tripped (run unchanged), the 4a plans-line and K-5 tests are updated (M-2) | 5a (M-1, M-2) |
| Slice 6a rows (Money M-3 accounts tab and AI margin) | A new pure builder in `lib/business-os/finance/`, new route fields, a tab; no new read or repository method | See §11E.6: the finance source guards gain the new files; repository, ledger, lot and billing event caller lists, the finance table pin and the billing placement guards are not tripped (run unchanged); route and URL tests cover the new fields | 6a (M-3) |
| Money M-4 rows (OV-1 labels; OV-5 recorded, not charged) | OV-1 changes strings pinned by tests in five admin folders; OV-5 makes the route name two usage-log repositories, which the finance "no token_usage" rule forbids | See §11F.8: string pins updated and a vocabulary guard added (OV-1); the finance source guard narrowed to allow the route only, its pattern widened to catch `AdminTokenUsageAnalyticsRepository`, a positive pin on the two read methods; the analytics repository isolation guard and the `TokenUsageRepository` contract are not tripped (headers amended); Health rule tests unchanged | M-4 (OV-1, OV-5) |
| Slice 4b rows (reversal events writer; refund dates, problems, bought credits) | 4b.1 adds a table and replaces the boost transition function in a migration; 4b.2 adds R-n, R-n′ on the new table and changes the DF-5 rule | See §11I.8: purge descriptor, classification baseline (156), business-owned inventory, export `BILLING_TABLES`, the regenerated test-account cleanup, a new migration test, rollback and check scripts (4b.1); the finance table pin grows by one, the DF-5 pin is re-pinned, the repository test gains one test per method, the Accounts tab pins by SA ruling, the frozen pins kept (4b.2); boost repository, webhook placement and SECURITY DEFINER guards not tripped | 4b.1, 4b.2 |

**Not tripped:** L8, BD-26 owner-read, `businessOwnedTables` / purge descriptors, `adminReadMethods`, `accountSeam.guard` (if SA-Q7 is followed), billing-account and billing-event caller lists, boost repository pins (SA-F2 keeps the page off them). **No new CI job and no added PR critical-path time:** every new test runs in the existing Jest gate or the existing `test:bos-entitlements` job.

**Not tripped by slice 2 (expected; SA confirms):** `enforcementPoints` (no new entitlements import), RC-15, the ledger caller list, G3, `tierLiteral.forbidden`, N-10, `businessOwnedTables` and purge descriptors (no new table), and the billing-account, billing-event and boost pins. Also **`adminReadMethods.guard`** (S2-F3): `readQueueFiguresAllAccounts` is not in `ADMIN_METHODS` (`:479-490`), so the R-j call does not trip it; Dev still runs it unchanged. The three Stripe webhook placement guards are not tripped either (SA-Q16, row above).

**Dev must run, before SA code review, and paste the results in the workplan:** `npm run test:bos-entitlements`, `npm run test:authz-guard`, the Health tests, the sidebar nav test, `npm run lint:hooks`, eslint on touched files, and the scoped `tsc` with canary (AC-44).

---

## 13. Read-only SQL cross-checks for slice 1

The user can paste each script into the Supabase SQL editor to cross-check the page. Each script is read-only and returns **one final result set** (the editor shows only the last one). Months are UTC calendar months. Checks 1 to 3 and 6 back slice 1a; checks 4 and 5 back slice 1b.

**File:** `check 1 - accounts by plan` (AC-9; updated for slice 1c, AC-78 to AC-80)

```sql
-- Finance page check 1: accounts by cohort, tier, origin and paying, read only.
-- Compare with Section 1 and tile K-3.
-- Paying means any billing row, test or live mode (BD-14), with status
-- active or past_due and no end date. One billing row per account is assumed (BD-16).
-- A paying champion is shown under its paid tier on the page (BD-15).
-- K-3 equals the sum of no_cohort_end_date over champion rows where paying is false
-- and tier is (none); a champion with a tier set is Comped or in its tier group.
-- A champion whose tier has expired shows here under that tier but is a Founding Partner on the page.
-- cohort_already_ended counts rows whose cohort end date has passed.
with paying as (
  select a.user_id, max(a.bought_tier) as bought_tier
  from public.business_os_billing_accounts a
  where a.user_id is not null
    and a.subscription_status in ('active', 'past_due')
    and a.ended_at is null
  group by a.user_id
)
select
  coalesce(p.cohort, '(none)') as cohort,
  coalesce(p.tier, '(none)') as tier,
  coalesce(p.origin, '(none)') as origin,
  (y.user_id is not null) as paying,
  coalesce(y.bought_tier, '(none)') as paid_tier,
  count(*) as accounts,
  count(*) filter (where p.cohort_expires_at is null) as no_cohort_end_date,
  count(*) filter (where p.cohort_expires_at <= now()) as cohort_already_ended,
  count(*) filter (where p.created_at >= date_trunc('month', now(), 'UTC')) as created_this_month_utc
from public.business_os_account_plans p
left join paying y on y.user_id = p.user_id
group by 1, 2, 3, 4, 5
order by 1, 2, 3, 4, 5;
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

**File:** `check 6 - is there any platform revenue` (AC-22; updated for slice 1c, AC-75 to AC-77)

```sql
-- Finance page check 6: platform revenue rows, test and live mode together, read only (BD-14).
-- row_count is what the page counts. All zeros on the first two rows means None yet is correct;
-- any non zero row_count on them means Revenue has been recorded.
-- live_rows and test_rows are for information only; the page does not split them.
select 'plan_invoice_paid' as source,
  count(*) as row_count,
  count(*) filter (where e.livemode) as live_rows,
  count(*) filter (where not e.livemode) as test_rows
from public.business_os_billing_events e
where e.kind = 'invoice_paid'
union all
select 'boost_paid',
  count(*),
  count(*) filter (where b.livemode),
  count(*) filter (where not b.livemode)
from public.business_os_boost_purchases b
where b.paid_at is not null
union all
select 'billing_accounts_paying',
  count(*),
  count(*) filter (where a.livemode),
  count(*) filter (where not a.livemode)
from public.business_os_billing_accounts a
where a.subscription_status in ('active', 'past_due')
  and a.ended_at is null;
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

### Slice 4 checks (14 to 16)

Check 14 backs slice 4a; checks 15 and 16 back slice 4b (§11C). The same rules hold: read-only, ASCII only, no apostrophes in comments, one final result set each. Test and live mode are counted together (BD-14). Boost amounts are **minor units** (cents for USD): divide by 100 to compare with the page. Written against the live facts of §11C.1; not yet executed by BA.

**File:** `check 14 - credit boosts paid this month` (AC-87, AC-88, AC-95, AC-101)

```sql
-- Finance page check 14: credit boosts paid this UTC month, per currency and package, read only.
-- Compare with Our revenue (boosts) and tile K-5.
-- A purchase counts in the UTC month of paid_at, and only paid family statuses are added up.
-- Refunds and disputes are the amounts recorded today on purchases paid this month.
-- held and lost are the unrefunded remainder of disputed and dispute_lost purchases.
-- The row with package ALL is the currency line; no row adds two currencies.
-- deleted_account_net_minor is the net of purchases whose account was deleted.
select
  upper(btrim(b.currency)) as currency,
  coalesce(b.package_id || ' v' || b.package_version, 'ALL') as package,
  count(*) as purchases,
  count(*) filter (where b.user_id is null) as deleted_account_purchases,
  coalesce(sum(b.amount_total_minor - b.amount_refunded_minor)
    filter (where b.user_id is null and b.status in ('paid', 'partially_refunded', 'refunded')), 0) as deleted_account_net_minor,
  sum(b.amount_total_minor) as gross_minor,
  sum(b.amount_tax_minor) as tax_minor,
  sum(b.amount_refunded_minor) as refunded_minor,
  coalesce(sum(b.amount_total_minor - b.amount_refunded_minor)
    filter (where b.status = 'disputed'), 0) as held_in_open_disputes_minor,
  coalesce(sum(b.amount_total_minor - b.amount_refunded_minor)
    filter (where b.status = 'dispute_lost'), 0) as lost_in_disputes_minor,
  sum(b.amount_total_minor) - sum(b.amount_refunded_minor)
    - coalesce(sum(b.amount_total_minor - b.amount_refunded_minor)
      filter (where b.status in ('disputed', 'dispute_lost')), 0) as net_minor,
  sum(b.credits_total) as credits_sold
from public.business_os_boost_purchases b
where b.paid_at >= date_trunc('month', now(), 'UTC')
  and b.paid_at < date_trunc('month', now(), 'UTC') + interval '1 month'
  and b.status in ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost')
group by grouping sets (
  (upper(btrim(b.currency)), b.package_id, b.package_version),
  (upper(btrim(b.currency)))
)
order by 1, 2;
```

**File:** `check 15 - boost purchases by status as of now` (AC-102)

```sql
-- Finance page check 15: boost purchases by status and currency as of now, read only.
-- Compare with Section 6 block A (boosts) and the K-5 dispute rule.
-- The page shows the disputed rows (open disputes, with held_minor)
-- and the flagged_mismatch rows (paid at Stripe, not credited).
-- Every other status is listed for information only.
select
  b.status,
  upper(btrim(b.currency)) as currency,
  count(*) as purchases,
  coalesce(sum(b.amount_total_minor - b.amount_refunded_minor)
    filter (where b.status = 'disputed'), 0) as held_minor,
  sum(b.amount_total_minor) as recorded_total_minor,
  min(b.status_changed_at) as oldest_change
from public.business_os_boost_purchases b
group by 1, 2
order by 1, 2;
```

**File:** `check 16 - bought credits` (AC-104, AC-105)

```sql
-- Finance page check 16: credits bought through boosts, read only.
-- Compare with the bought figures of Section 4. Gifted credits are check 5.
-- outstanding: lot credits minus taken back, over lots not expired now, accounts that exist.
-- deleted_accounts_outstanding: the same for lots whose account was deleted.
-- lots_in_month and credits_in_month: boost lots created this UTC month.
with boosts as (
  select l.id, l.user_id, l.credits_granted, l.expires_at, l.created_at
  from public.business_os_credit_lots l
  where l.source = 'boost_purchase'
),
taken as (
  select d.lot_id, sum(d.credits) as taken_back
  from public.business_os_credit_lot_draws d
  where d.kind = 'reversal'
  group by d.lot_id
)
select
  count(b.id) as boost_lots,
  coalesce(sum(greatest(b.credits_granted - coalesce(t.taken_back, 0), 0))
    filter (where b.user_id is not null
      and (b.expires_at is null or b.expires_at > now())), 0) as outstanding,
  coalesce(sum(greatest(b.credits_granted - coalesce(t.taken_back, 0), 0))
    filter (where b.user_id is null
      and (b.expires_at is null or b.expires_at > now())), 0) as deleted_accounts_outstanding,
  count(b.id) filter (where b.created_at >= date_trunc('month', now(), 'UTC')
    and b.created_at < date_trunc('month', now(), 'UTC') + interval '1 month') as lots_in_month,
  coalesce(sum(b.credits_granted) filter (where b.created_at >= date_trunc('month', now(), 'UTC')
    and b.created_at < date_trunc('month', now(), 'UTC') + interval '1 month'), 0) as credits_in_month
from boosts b
left join taken t on t.lot_id = b.id;
```

### Slice 5a checks (17 and 18)

Both back M-2 (§11D). The same rules hold: read-only, ASCII only, no apostrophes in comments, one final result set each. Test and live mode are counted together (BD-14). Amounts are **minor units** (cents for USD): divide by 100 to compare with the page. Written against the live facts of §11D.1; not yet executed by BA. With the month set to 2026-10-01 00:00:00+00 (or run in October 2026), check 18 shows the owner test account (id starting `5f63adbd`) with `plan_received_minor` 7900, `boost_net_minor` 1000 and `total_minor` 8900.

**File:** `check 17 - plan payments received this month` (AC-117, AC-119, AC-129)

```sql
-- Finance page check 17: plan payments received in one UTC month, per currency, read only.
-- Compare with Our revenue (plans) and the plans part of tile K-5.
-- The month is the current UTC month. To check another month, replace null in the
-- p block below with a quoted UTC month start, such as 2026-10-01 00:00:00+00.
-- Only invoice_paid rows count. mismatch_refused rows also carry amounts and never count.
-- A payment counts in the UTC month of paid_at. amount_minor is the amount paid, tax included.
-- Zero amount invoices are not payments; they are counted on their own.
-- Rows with a null user_id are payments of deleted accounts.
with p as (
  select coalesce(null::timestamptz, date_trunc('month', now(), 'UTC')) as month_start
)
select
  upper(btrim(e.currency)) as currency,
  count(*) filter (where e.amount_minor > 0) as payments,
  count(*) filter (where e.amount_minor = 0) as zero_amount_invoices,
  count(distinct e.user_id) filter (where e.amount_minor > 0) as businesses_paid,
  coalesce(sum(e.amount_minor), 0) as received_minor,
  coalesce(sum(e.amount_tax_minor), 0) as tax_minor,
  count(*) filter (where e.user_id is null and e.amount_minor > 0) as deleted_account_payments,
  coalesce(sum(e.amount_minor) filter (where e.user_id is null), 0) as deleted_account_received_minor
from public.business_os_billing_events e
cross join p
where e.kind = 'invoice_paid'
  and e.paid_at >= p.month_start
  and e.paid_at < p.month_start + interval '1 month'
group by 1
order by 1;
```

**File:** `check 18 - our revenue per account this month` (AC-122, AC-124, AC-129)

```sql
-- Finance page check 18: our revenue per account and currency in one UTC month, read only.
-- Compare with the account summary, the by business table and tile K-5 with that business picked.
-- The month is the current UTC month. To check another month, replace null in the
-- p block below with a quoted UTC month start, such as 2026-10-01 00:00:00+00.
-- plan_received_minor: invoice_paid amounts by paid_at, tax included.
-- boost_net_minor: boosts by paid_at, net of refunds and disputes, as check 14.
-- A disputed or dispute_lost boost adds nothing to net, as on the page.
-- total_minor adds plans and boosts of one currency only; no row adds two currencies.
with p as (
  select coalesce(null::timestamptz, date_trunc('month', now(), 'UTC')) as month_start
),
money as (
  select e.user_id, upper(btrim(e.currency)) as currency,
         e.amount_minor as plan_minor, 0 as boost_minor
  from public.business_os_billing_events e
  cross join p
  where e.kind = 'invoice_paid'
    and e.paid_at >= p.month_start
    and e.paid_at < p.month_start + interval '1 month'
  union all
  select b.user_id, upper(btrim(b.currency)) as currency,
         0 as plan_minor, b.amount_total_minor - b.amount_refunded_minor as boost_minor
  from public.business_os_boost_purchases b
  cross join p
  where b.paid_at >= p.month_start
    and b.paid_at < p.month_start + interval '1 month'
    and b.status in ('paid', 'partially_refunded', 'refunded')
)
select
  coalesce(m.user_id::text, 'deleted accounts') as account,
  m.currency,
  sum(m.plan_minor) as plan_received_minor,
  sum(m.boost_minor) as boost_net_minor,
  sum(m.plan_minor) + sum(m.boost_minor) as total_minor
from money m
group by 1, 2
order by 1, 2;
```

### Slice 6a checks (19 and 20)

Both back M-3 (§11E). The same rules hold: read-only, ASCII only, no apostrophes in comments, one final result set each. Test and live mode are counted together (BD-14). Revenue amounts are **minor units** (divide by 100); AI cost is USD at the ledger scale. Written against the live facts of §11E.1; not yet executed by BA. A month that starts before the charging cut-over (2026-09-29 16:50:53.914 UTC) returns a null margin, as the page shows "Not available". Known differences, by design (SA-W81): a paid boost whose tax is above its amount shows Unknown on the page while check 19 gives a negative figure; and the page applies the status-free rule of E-45 to a paid boost with a refund recorded, which the boost transition function never produces. Neither row exists today. **Re-issued 2026-10-17 for slice 4b.2 (SA-CR-4b2 CR-2):** checks 19 and 20 now follow the event rule of FR-4B-11 (a boost paid in the month gives total less tax whatever its status; refund and lost-dispute events recorded in the month are taken off the account of their purchase; a taxed purchase makes that event inexact; held now is never deducted), so they equal the Accounts tab again for refunded and disputed purchases. Before migration 20261076 is applied, both checks fail with relation does not exist; run them after the apply. A third, also by design (SA-CR-6a): a readable plan invoice of zero in a currency other than USD makes no line on the page (M2-W-5, a zero invoice is not a payment), so the margin stays a figure, while check 19 counts it as an other-currency row and returns a null margin. The page is right. No such row exists today.

**File:** `check 19 - account economics this month` (AC-132, AC-134, AC-135, AC-142, AC-149)

```sql
-- Finance page check 19: account economics in one UTC month, one row per account, read only.
-- Compare with the Accounts tab rows and the AI margin line of the account summary.
-- The month is the current UTC month. To check another month, replace null in the
-- p block below with a quoted UTC month start, such as 2026-10-01 00:00:00+00.
-- Revenue is after tax. Plans: amount_minor less amount_tax_minor, invoice_paid only.
-- Re-issued 2026-10-17 for slice 4b.2 (SA-CR-4b2 CR-2, BD-17, FR-4B-11).
-- Boosts paid in the month: total less tax, whatever the status now.
-- Boost reversal events recorded in the month (kinds refund and dispute_lost):
-- the amount is taken off the account of the purchase of the event, in the event
-- currency. An event on a taxed purchase is inexact. An event on a purchase that
-- was never paid is not revenue. Opened and won disputes move no money.
-- AI cost is the charged cost: every credit ledger row created in the month, in USD.
-- A margin is given only when all revenue of the account is USD and nothing is inexact.
with p as (
  select coalesce(null::timestamptz, date_trunc('month', now(), 'UTC')) as month_start
),
rev as (
  select coalesce(e.user_id::text, 'deleted accounts') as account,
         upper(btrim(e.currency)) as currency,
         e.amount_minor - e.amount_tax_minor as after_tax_minor
  from public.business_os_billing_events e
  cross join p
  where e.kind = 'invoice_paid'
    and e.paid_at >= p.month_start
    and e.paid_at < p.month_start + interval '1 month'
  union all
  select coalesce(b.user_id::text, 'deleted accounts') as account,
         upper(btrim(b.currency)) as currency,
         b.amount_total_minor - b.amount_tax_minor as after_tax_minor
  from public.business_os_boost_purchases b
  cross join p
  where b.paid_at >= p.month_start
    and b.paid_at < p.month_start + interval '1 month'
    and b.status in ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost')
  union all
  select coalesce(b.user_id::text, 'deleted accounts') as account,
         upper(btrim(v.currency)) as currency,
         case
           when v.amount_minor = 0 then 0
           when b.amount_tax_minor = 0 then 0 - v.amount_minor
           else null
         end as after_tax_minor
  from public.business_os_boost_reversal_events v
  join public.business_os_boost_purchases b on b.id = v.purchase_id
  cross join p
  where v.kind in ('refund', 'dispute_lost')
    and v.recorded_at >= p.month_start
    and v.recorded_at < p.month_start + interval '1 month'
    and b.paid_at is not null
),
rev_acc as (
  select r.account,
         coalesce(sum(r.after_tax_minor) filter (where r.currency = 'USD'), 0) as usd_after_tax_minor,
         count(*) filter (where r.currency is distinct from 'USD') as other_currency_rows,
         coalesce(string_agg(distinct r.currency, ',') filter (where r.currency <> 'USD'), '') as other_currencies,
         count(*) filter (where r.after_tax_minor is null) as inexact_rows
  from rev r
  group by r.account
),
cost_acc as (
  select coalesce(c.user_id::text, 'deleted accounts') as account,
         sum(c.cost_usd) as ai_cost_usd,
         count(*) as ledger_rows
  from public.business_os_credit_charges c
  cross join p
  where c.created_at >= p.month_start
    and c.created_at < p.month_start + interval '1 month'
  group by 1
)
select
  coalesce(r.account, c.account) as account,
  coalesce(r.usd_after_tax_minor, 0) as usd_revenue_after_tax_minor,
  coalesce(r.other_currencies, '') as other_currencies,
  coalesce(r.inexact_rows, 0) as inexact_revenue_rows,
  coalesce(c.ai_cost_usd, 0) as ai_cost_usd,
  coalesce(c.ledger_rows, 0) as ledger_rows,
  case
    when (select month_start from p) < timestamptz '2026-09-29 16:50:53.914+00' then null
    when coalesce(r.other_currency_rows, 0) > 0 then null
    when coalesce(r.inexact_rows, 0) > 0 then null
    else round(coalesce(r.usd_after_tax_minor, 0) / 100.0 - coalesce(c.ai_cost_usd, 0), 6)
  end as ai_margin_usd
from rev_acc r
full outer join cost_acc c on c.account = r.account
order by 5 desc, 1;
```

**File:** `check 20 - platform AI margin this month` (AC-134, AC-136, AC-149)

```sql
-- Finance page check 20: platform AI margin in one UTC month, one row, read only.
-- Compare with the platform line above the Accounts tab. It ignores every filter.
-- The month is the current UTC month. To check another month, replace null in the
-- p block below with a quoted UTC month start, such as 2026-10-01 00:00:00+00.
-- Same revenue and cost rules as check 19, over every account, deleted accounts included.
-- Re-issued 2026-10-17 with check 19 for slice 4b.2: boost refunds and lost disputes are
-- the reversal events recorded in the month, not the purchase status.
-- Any revenue row in another currency makes the platform margin null (no exchange rate).
with p as (
  select coalesce(null::timestamptz, date_trunc('month', now(), 'UTC')) as month_start
),
rev as (
  select upper(btrim(e.currency)) as currency,
         e.amount_minor - e.amount_tax_minor as after_tax_minor
  from public.business_os_billing_events e
  cross join p
  where e.kind = 'invoice_paid'
    and e.paid_at >= p.month_start
    and e.paid_at < p.month_start + interval '1 month'
  union all
  select upper(btrim(b.currency)) as currency,
         b.amount_total_minor - b.amount_tax_minor as after_tax_minor
  from public.business_os_boost_purchases b
  cross join p
  where b.paid_at >= p.month_start
    and b.paid_at < p.month_start + interval '1 month'
    and b.status in ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost')
  union all
  select upper(btrim(v.currency)) as currency,
         case
           when v.amount_minor = 0 then 0
           when b.amount_tax_minor = 0 then 0 - v.amount_minor
           else null
         end as after_tax_minor
  from public.business_os_boost_reversal_events v
  join public.business_os_boost_purchases b on b.id = v.purchase_id
  cross join p
  where v.kind in ('refund', 'dispute_lost')
    and v.recorded_at >= p.month_start
    and v.recorded_at < p.month_start + interval '1 month'
    and b.paid_at is not null
),
cost as (
  select coalesce(sum(c.cost_usd), 0) as ai_cost_usd, count(*) as ledger_rows
  from public.business_os_credit_charges c
  cross join p
  where c.created_at >= p.month_start
    and c.created_at < p.month_start + interval '1 month'
),
rev_all as (
  select coalesce(sum(r.after_tax_minor) filter (where r.currency = 'USD'), 0) as usd_after_tax_minor,
         count(*) filter (where r.currency is distinct from 'USD') as other_currency_rows,
         count(*) filter (where r.after_tax_minor is null) as inexact_rows
  from rev r
)
select
  ra.usd_after_tax_minor as usd_revenue_after_tax_minor,
  ra.other_currency_rows,
  ra.inexact_rows as inexact_revenue_rows,
  co.ai_cost_usd,
  co.ledger_rows,
  case
    when (select month_start from p) < timestamptz '2026-09-29 16:50:53.914+00' then null
    when ra.other_currency_rows > 0 then null
    when ra.inexact_rows > 0 then null
    else round(ra.usd_after_tax_minor / 100.0 - co.ai_cost_usd, 6)
  end as ai_margin_usd
from rev_all ra
cross join cost co;
```

### Money M-4 checks (21 and 22)

Both back OV-5 (§11F). The same rules hold: read-only, ASCII only, no apostrophes in comments, one final result set each. AI cost on both sides is USD; recorded is the usage log `cost_usd`, charged the credit ledger `cost_usd`. The Business OS row rule is the one `bosRowFilter()` builds (§11F.1). Written against the live facts of §11F.1 and not executed by BA.

**File:** `check 21 - recorded and not charged this month` (AC-154)

```sql
-- Finance page check 21: recorded AI cost beside charged AI cost, one UTC month, all accounts, read only.
-- Compare with the two new lines of Section 3 on Finance, no business picked, window This month.
-- The month is the current UTC month. To check another month, replace null in the
-- p block below with a quoted UTC month start, such as 2026-10-01 00:00:00+00.
-- Recorded: Business OS rows of the usage log, every account, cost_usd summed.
-- A Business OS row has a feature that starts with business-os, or one of five legacy values.
-- Charged: every credit ledger row of the month, charges and corrections, of live accounts.
-- Deleted accounts are left out of charged, because the usage log loses their rows.
-- Section 3 charged total equals charged_usd plus deleted_accounts_charged_usd.
-- Not charged is recorded less charged. It is null when the month starts before the cut-over;
-- the page shows None when it is 0 or below.
with p as (
  select coalesce(null::timestamptz, date_trunc('month', now(), 'UTC')) as month_start
),
rec as (
  select coalesce(sum(t.cost_usd), 0) as recorded_usd,
         count(*) as recorded_rows,
         count(*) filter (where t.cost_usd is null) as rows_without_cost
  from public.token_usage t
  cross join p
  where t.created_at >= p.month_start
    and t.created_at < p.month_start + interval '1 month'
    and (t.feature like 'business-os%'
         or t.feature in ('insight-generation', 'correlated-insight-generation',
                          'health-summary-generation', 'landing-page-generation', 'lead-reply'))
),
chg as (
  select coalesce(sum(c.cost_usd) filter (where c.user_id is not null), 0) as charged_usd,
         coalesce(sum(c.cost_usd) filter (where c.user_id is null), 0) as deleted_accounts_charged_usd,
         count(*) as ledger_rows
  from public.business_os_credit_charges c
  cross join p
  where c.created_at >= p.month_start
    and c.created_at < p.month_start + interval '1 month'
)
select
  r.recorded_usd,
  r.recorded_rows,
  r.rows_without_cost,
  c.charged_usd,
  c.deleted_accounts_charged_usd,
  c.ledger_rows,
  case
    when (select month_start from p) < timestamptz '2026-09-29 16:50:53.914+00' then null
    else round(r.recorded_usd - c.charged_usd, 6)
  end as not_charged_usd
from rec r
cross join chg c;
```

**File:** `check 22 - recorded and not charged for one account this month` (AC-155, AC-166)

```sql
-- Finance page check 22: recorded AI cost beside charged AI cost for ONE account, one UTC month, read only.
-- Compare with Section 3 and the account summary on Finance with that business picked, window This month.
-- Replace null in the p block with the account id in quotes, such as
-- 11111111-2222-3333-4444-555555555555. With null the figures are all 0.
-- The month is the current UTC month; to check another month, replace the second null
-- with a quoted UTC month start, such as 2026-10-01 00:00:00+00.
-- Recorded: Business OS rows of the usage log for this account. Charged: its credit ledger rows.
-- Not charged is recorded less charged; null when the month starts before the cut-over.
with p as (
  select null::uuid as account_id,
         coalesce(null::timestamptz, date_trunc('month', now(), 'UTC')) as month_start
),
rec as (
  select coalesce(sum(t.cost_usd), 0) as recorded_usd,
         count(*) as recorded_rows,
         count(*) filter (where t.cost_usd is null) as rows_without_cost
  from public.token_usage t
  cross join p
  where t.user_id = p.account_id
    and t.created_at >= p.month_start
    and t.created_at < p.month_start + interval '1 month'
    and (t.feature like 'business-os%'
         or t.feature in ('insight-generation', 'correlated-insight-generation',
                          'health-summary-generation', 'landing-page-generation', 'lead-reply'))
),
chg as (
  select coalesce(sum(c.cost_usd), 0) as charged_usd,
         count(*) as ledger_rows
  from public.business_os_credit_charges c
  cross join p
  where c.user_id = p.account_id
    and c.created_at >= p.month_start
    and c.created_at < p.month_start + interval '1 month'
)
select
  r.recorded_usd,
  r.recorded_rows,
  r.rows_without_cost,
  c.charged_usd,
  c.ledger_rows,
  case
    when (select month_start from p) < timestamptz '2026-09-29 16:50:53.914+00' then null
    else round(r.recorded_usd - c.charged_usd, 6)
  end as not_charged_usd
from rec r
cross join chg c;
```

### Slice 4b checks (23 to 26)

Checks 23 and 24 back 4b.1 (the user runs them on production around the hand-applied migration, §11I.6); checks 25 and 26 back 4b.2 (§11I). The same rules hold: read-only, ASCII only, no apostrophes in comments, never the word that the Supabase SQL editor misreads, one final result set each. Amounts are minor units (cents for USD). Written against the facts of §11I.1; not executed by BA. For 4b.1, checks 23 and 24 are the strengthened text in the 4b.1 workplan §6: added rows for column-level privileges, the nine INSERT columns, BYPASSRLS, the index shape, the body md5 and the cleanup version (SA-W113, SA-WP-4b1, E-70). The 4b.1 PR carries those files.

**File:** `check 23 - before applying 20261076` (AC-212, AC-216)

```sql
-- Finance check 23: run BEFORE applying migration 20261076, read only.
-- Every row must show ok = true. If one does not, stop and tell the session.
select 'reversal events table absent' as item,
  to_regclass('public.business_os_boost_reversal_events') is null as ok,
  null::bigint as found
union all
select 'transition function present with six arguments',
  to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)') is not null,
  null::bigint
union all
select 'transition function is security invoker',
  coalesce(bool_and(not p.prosecdef), false),
  count(*)
from pg_catalog.pg_proc p
where p.oid = to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)')
union all
select 'no boost purchase with a refund',
  count(*) = 0,
  count(*)
from public.business_os_boost_purchases b
where b.amount_refunded_minor > 0
union all
select 'no boost purchase with a dispute',
  count(*) = 0,
  count(*)
from public.business_os_boost_purchases b
where b.stripe_dispute_id is not null;
```

**File:** `check 24 - after applying 20261076` (AC-204, AC-205, AC-206, AC-216)

```sql
-- Finance check 24: run AFTER applying migration 20261076, read only.
-- Every row must show ok = true. If one does not, stop and tell the session.
-- The function must name the events table six times, once per insert point.
with t as (
  select to_regclass('public.business_os_boost_reversal_events') as tbl,
         to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)') as fn
)
select 'table exists' as item, t.tbl is not null as ok from t
union all
select 'row level security on', coalesce((select c.relrowsecurity from pg_catalog.pg_class c where c.oid = t.tbl), false) from t
union all
select 'no policy on the table', not exists (select 1 from pg_catalog.pg_policy pol where pol.polrelid = t.tbl) from t
union all
select 'anon has no select', not coalesce(has_table_privilege('anon', t.tbl, 'SELECT'), true) from t
union all
select 'authenticated has no select', not coalesce(has_table_privilege('authenticated', t.tbl, 'SELECT'), true) from t
union all
select 'authenticated cannot insert', not coalesce(has_table_privilege('authenticated', t.tbl, 'INSERT'), true) from t
union all
select 'service_role can select', coalesce(has_table_privilege('service_role', t.tbl, 'SELECT'), false) from t
union all
select 'service_role can insert kind', coalesce(has_column_privilege('service_role', t.tbl, 'kind', 'INSERT'), false) from t
union all
select 'service_role can insert purchase_id', coalesce(has_column_privilege('service_role', t.tbl, 'purchase_id', 'INSERT'), false) from t
union all
select 'service_role cannot set recorded_at', not coalesce(has_column_privilege('service_role', t.tbl, 'recorded_at', 'INSERT'), true) from t
union all
select 'service_role cannot update', not coalesce(has_table_privilege('service_role', t.tbl, 'UPDATE'), true) from t
union all
select 'service_role cannot delete', not coalesce(has_table_privilege('service_role', t.tbl, 'DELETE'), true) from t
union all
select 'foreign key to purchases cascades',
  exists (select 1 from pg_catalog.pg_constraint con
          where con.conrelid = t.tbl and con.contype = 'f'
            and con.confrelid = 'public.business_os_boost_purchases'::regclass
            and con.confdeltype = 'c') from t
union all
select 'function still security invoker', coalesce((select not p.prosecdef from pg_catalog.pg_proc p where p.oid = t.fn), false) from t
union all
select 'function names the events table six times',
  coalesce((select (length(pg_get_functiondef(t.fn)) - length(replace(pg_get_functiondef(t.fn), 'business_os_boost_reversal_events', '')))
            / length('business_os_boost_reversal_events') = 6), false) from t
union all
select 'anon cannot execute the function', not coalesce(has_function_privilege('anon', t.fn, 'EXECUTE'), true) from t
union all
select 'service_role can execute the function', coalesce(has_function_privilege('service_role', t.fn, 'EXECUTE'), false) from t
union all
select 'no refund or dispute recorded without an event',
  not exists (select 1 from public.business_os_boost_purchases b
              where (b.amount_refunded_minor > 0 or b.stripe_dispute_id is not null)
                and not exists (select 1 from public.business_os_boost_reversal_events e where e.purchase_id = b.id))
from t;
```

**File:** `check 25 - reversal events against purchases` (AC-207 to AC-209, SA-Q67, SA-Q74)

```sql
-- Finance check 25: boost reversal events against the purchase rows, read only.
-- One row per purchase that has a refund, a dispute or an event.
-- refunds_ok: the refund event amounts add up to the refunded amount on the purchase.
-- dispute_ok: a purchase now in status disputed has more opened than closed dispute events.
-- over_total: refunds plus lost disputes exceed the purchase total (see SA-Q74).
with ev as (
  select e.purchase_id,
    coalesce(sum(e.amount_minor) filter (where e.kind = 'refund'), 0) as refund_events_minor,
    count(*) filter (where e.kind = 'refund') as refund_events,
    coalesce(sum(e.amount_minor) filter (where e.kind = 'dispute_lost'), 0) as lost_events_minor,
    count(*) filter (where e.kind = 'dispute_opened') as disputes_opened,
    count(*) filter (where e.kind in ('dispute_won', 'dispute_lost')) as disputes_closed,
    min(e.recorded_at) as first_event,
    max(e.recorded_at) as last_event
  from public.business_os_boost_reversal_events e
  group by e.purchase_id
)
select
  b.id as purchase_id,
  b.status,
  b.paid_at is not null as was_paid,
  b.amount_total_minor,
  b.amount_refunded_minor,
  coalesce(ev.refund_events_minor, 0) as refund_events_minor,
  coalesce(ev.refund_events, 0) as refund_events,
  coalesce(ev.lost_events_minor, 0) as lost_events_minor,
  coalesce(ev.disputes_opened, 0) as disputes_opened,
  coalesce(ev.disputes_closed, 0) as disputes_closed,
  ev.first_event,
  ev.last_event,
  coalesce(ev.refund_events_minor, 0) = b.amount_refunded_minor as refunds_ok,
  (b.status <> 'disputed' or coalesce(ev.disputes_opened, 0) > coalesce(ev.disputes_closed, 0)) as dispute_ok,
  coalesce(ev.refund_events_minor, 0) + coalesce(ev.lost_events_minor, 0) > coalesce(b.amount_total_minor, 0) as over_total
from public.business_os_boost_purchases b
left join ev on ev.purchase_id = b.id
where b.amount_refunded_minor > 0
   or b.stripe_dispute_id is not null
   or ev.purchase_id is not null
order by b.id;
```

**File:** `check 26 - boost refunds and lost disputes recorded this month` (AC-217, AC-218, AC-220, AC-221)

```sql
-- Finance check 26: boost refunds and disputes recorded this UTC month, per currency, read only.
-- Compare with the refunded and lost figures of Our revenue (boosts), window This month.
-- An event counts in the UTC month of recorded_at, whatever month its purchase was paid in.
-- Rows with on_paid_purchase = false are purchases never credited: not revenue, shown in the problems note.
-- Net for the month = gross_minor of check 14 minus refunded_minor minus lost_minor of the paid rows here.
select
  upper(btrim(e.currency)) as currency,
  b.paid_at is not null as on_paid_purchase,
  count(*) filter (where e.kind = 'refund') as refunds,
  coalesce(sum(e.amount_minor) filter (where e.kind = 'refund'), 0) as refunded_minor,
  count(*) filter (where e.kind = 'dispute_lost') as disputes_lost,
  coalesce(sum(e.amount_minor) filter (where e.kind = 'dispute_lost'), 0) as lost_minor,
  count(*) filter (where e.kind = 'dispute_opened') as disputes_opened,
  count(*) filter (where e.kind = 'dispute_won') as disputes_won,
  count(*) filter (where b.user_id is null) as events_of_deleted_accounts
from public.business_os_boost_reversal_events e
join public.business_os_boost_purchases b on b.id = e.purchase_id
where e.recorded_at >= date_trunc('month', now(), 'UTC')
  and e.recorded_at < date_trunc('month', now(), 'UTC') + interval '1 month'
group by 1, 2
order by 1, 2;
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

**Slice 4 questions** (SA-Q25 to SA-Q31) are in §11C.9 and ruled (§0.3). **Slice 4b questions** (SA-Q65 to SA-Q74, raised 2026-10-17) are in §11I.10, open. **Slice 5a questions** (Money M-1 and M-2, SA-Q32 to SA-Q41, raised 2026-10-14) are in §11D.9, open.

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

## SA Requirement Review — Slice 1c — 2026-10-13

**Reviewed by SA — 2026-10-13, against `97c66132`**
**Status:** ✅ **APPROVED WITH CONDITIONS.** The 1c workplan may start once the BA has applied E-15 to E-19 below. BD-14 and BD-15 are final and are not reopened.

**How it was checked.** I opened the code rather than trusting the citations:
- `lifecycle.ts:136-200`: **a tier in force wins outright** (`state: 'active'`, `basis: tier`, RC-11);
- `planGroups.ts` `groupFor`: an active state on the tier basis, not paying, maps to **Comped**;
- `BusinessOsFinanceReadRepository.ts` R-c (keyset `.gt('user_id')`), R-c′ (`.maybeSingle()`) and R-d;
- the repository test at `:128-136`, `:194-200` and `:238-250` (the `livemode` pins);
- `finance.source.guard.test.ts:321-336`;
- the billing-accounts migration: `id uuid` primary key, `bought_tier text`, `UNIQUE (user_id, livemode)`.

SQL checks 1 and 6 are ASCII only, with no "into", no apostrophe in a comment, and one result set each.

### Findings

1. **S1C-F1 (High): SA-Q20's premise is wrong, and AC-78 misses the user's own case.**
   - **What really happens.** The test account has `tier = basic`, expiring 2026-11-12, so the tier is **in force**, and `cohort = champion`. `deriveLifecycle` returns `active` on the **tier** basis, and because R-c read live rows only the account was not paying, so `groupFor` put it in **Comped**, not Founding Partner.
   - **What fixes it.** BD-14 alone moves it to the Basic group. BD-15 then adds the Founding Partner note, because its plan row carries the champion cohort.
   - BD-15's "paying champion leaves Founding Partner" case also exists: a champion **without** a tier in force who is paying, for example after a tier expires before the renewal is written. Both cases need ACs: **E-16** and **E-17**.
2. **S1C-F2 (High): two billing rows per account are a real correctness bug (SA-Q21).**
   - R-c keysets on `user_id` with `.gt`, so a page boundary between one account's test row and live row drops the second.
   - R-c′'s `.maybeSingle()` errors on two rows, which turns the picked business into "Could not check".
   - Ruling SA-Q21 is the fix. The caller's OR needs no new logic: `payingIds` is already a `Set` built from every paying row.
3. **S1C-F3 (Medium): the dormant count would diverge from the shadow report.** Under SA-Q23, "dormant Founding Partners" counts only the Founding Partner group. The slice 1a parity test (classifier vs `buildShadowReport`, AC-12 area) would then diverge whenever a paying champion is in the fixture. **Required:** keep the parity test over a fixture with no paying champion, and add a separate test that a paying dormant champion is not counted on the finance page. A guard row is added in E-19.
4. **S1C-F4 (Medium): K-3 and check 1 agree only when no champion has a tier.** A champion whose tier is in force but who is not paying is Comped, not Founding Partner, yet check 1 still counts it under "champion, not paying". This is the 1a QA-2 caveat (AC-9). The check 1 comment and AC-80 must keep that caveat: **E-15** and **E-17**.
5. **S1C-F5 (Low): the `livemode` guard must cover the whole repository.** Once layer A also has no `livemode` filter, the strongest rule is "the repository's code, comments removed, never names `livemode`", with a planted control (SA-Q22). The header paragraph "LIVE MODE (layer A only)" must be rewritten for BD-14.
6. **S1C-F6 (Low): the estimate.** One day is tight for a rename plus keyset change across three reads, a classifier change with a note and a badge, new copy, guard edits and the SQL. **1 to 1.5 days** is realistic. Report at mid-day 1 if R-c / R-c′ is not green.

### Rulings SA-Q20 to SA-Q24

| # | Ruling |
|---|---|
| **SA-Q20** | **The paid tier comes from the plan row's `tier` first.** It is the entitlement truth, and the subscription webhook writes it: the live row shows `tier = basic`.<br>• A tier in force already maps through the existing path; only the paying test decides between the tier group and Comped.<br>• A **paying** account whose lifecycle is champion (no tier in force) goes to the plan row's `tier` when it is set and is in `config.tierOrder`; otherwise to `bought_tier` when that is in `config.tierOrder`; otherwise **Unknown/held**, never dropped.<br>• If the two disagree, the plan row wins.<br>• R-c and R-c′ select `bought_tier` (the column list grows by `id` and `bought_tier`).<br>• No tier literal: values are only compared with `config.tierOrder`. |
| **SA-Q21** | **WITHDRAWN 2026-10-13 by user decision BD-16** (one billing record per account). The single-row reads are kept and two rows give an honest error; see §0.3 SA-Q21 and SA-WP-1c. The original text below is kept for history.<br>**R-c pages by keyset on the primary key `id`** (`.order('id')`, `.gt('id', last)`), keeping `.not('user_id', 'is', null)` and the 20,000-row error ceiling.<br>**R-c′** is `.eq('user_id', id).order('id').limit(2)` and returns a **list**, with no `.maybeSingle()`. `(user_id, livemode)` is unique, so there are never more than two rows.<br>The builder treats R-c′'s list like R-c's rows: an account is paying when any of its rows passes `isPayingBillingRow`.<br>Repository tests needed: two rows of one account across a page boundary (`pageSize: 1`) are both returned; R-c′ with two rows returns both and does not error. |
| **SA-Q22** | **Rename in 1c:**<br>• `listLiveBillingStatusesAllAccounts` → `listBillingStatusesAllAccounts`<br>• `findLiveBillingStatusForAccount` → `listBillingStatusesForAccount`<br>• `countLiveRevenueRows` → `countRevenueRows`<br>The one-caller pin is text-based on the class name and is unaffected.<br>**Source guard `:334-335`:** replace it with a rule that the repository's code, comments removed, contains no `livemode` at all, plus a planted control. Keep the `:321` body-slicer control. Rewrite the repository header for BD-14. |
| **SA-Q23** | **Dormant Founding Partners counts the Founding Partner group only**, like K-3; see S1C-F3 for the parity test. **"Ending in 30 days" is unchanged.** |
| **SA-Q24** | **A note on the group row ("including N Founding Partners") and, with a business picked, a `neutral` `StatusChip` "Founding Partner" beside the group, both from `financeCopy.ts`. No new column.**<br>The cohort is recognised with `stateForCohort(row.cohort) === 'champion'`, which is a lifecycle state, not a cohort literal. The note counts every account in a **paid tier group** whose plan row carries the champion cohort. That includes the user's test account (tier in force), not only accounts that left Founding Partner. |

**ACs.** AC-75 to AC-84 are testable. Three cases are missing and are added by E-16 to E-18:
- the user's own tier-in-force case;
- the fallback rules for the paid tier;
- the two-row OR and the page-boundary case.

`past_due` is already covered by AC-78. The K-3 change is covered by AC-80, with the E-17 caveat.

### Requirement edits (BA applies; recorded in §0.3 as SA-RR-1c)

- **E-15 (check 1 comment, S1C-F4).** In §13 check 1, replace the comment line `-- K-3 equals the sum of no_cohort_end_date over champion rows where paying is false.` with these two lines:

  ```sql
  -- K-3 equals the sum of no_cohort_end_date over champion rows where paying is false
  -- and tier is (none); a champion with a tier set is Comped or in its tier group.
  ```

  They are ASCII, with no apostrophe and no "into".
- **E-16 (AC-78, S1C-F1).** Replace AC-78 with: "**AC-78** *(1c)* (a) A champion-cohort account whose plan row tier is **in force** and that has a paying **test-mode** billing row (`active` or `past_due`, `ended_at` NULL) is counted in that tier's group, not Comped, and the group shows the Founding Partner note; this is the owner test account. (b) A champion account with **no tier in force** and a paying row is counted in its paid tier's group (SA-Q20) with the note, and Founding Partner does not count it. In both, the six groups still sum to Total (unit test on the classifier; render test for the note)."
- **E-17 (AC-80, S1C-F4).** In AC-80, replace "matches updated SQL check 1: the sum of `no_cohort_end_date` over the champion rows where `paying` is false" with "matches updated SQL check 1: the sum of `no_cohort_end_date` over the champion rows where `paying` is false and `tier` is `(none)`".
- **E-18 (new ACs).** Add after AC-84:
  - "- [ ] **AC-85** *(1c)* **Two billing rows.** An account with one test-mode and one live-mode billing row is paying when **either** passes `isPayingBillingRow` (for example a live `canceled` row and a test `active` row). R-c returns both rows when they fall on either side of a page boundary (repository test with `pageSize: 1`). R-c′ returns both and never errors."
  - "- [ ] **AC-86** *(1c)* **Paid tier source (SA-Q20).** A paying champion with no tier in force is grouped by the plan row `tier` when it is in `config.tierOrder`; otherwise by `bought_tier` when that is in `config.tierOrder`; otherwise in Unknown/held. When both are valid and differ, the plan row wins. No tier literal in finance code."
- **E-19 (§11B.5 guard rows).**
  - Replace the `finance.source.guard.test.ts:334-335` row's "What Dev must do" cell with: "Replace with: the repository's code, comments removed, names no `livemode` at all (planted control); keep the `:321` body-slicer control (SA-Q22)."
  - Add a row: "`planGroups.test.ts` parity with `buildShadowReport` (noEndDate / dormant, slice 1a) | Diverges when a fixture holds a paying champion (SA-Q23) | Keep the parity fixture free of paying champions; add a separate test that a paying dormant champion is not counted (S1C-F3)".

---

## SA Requirement Review — Slice 4 — 2026-10-13

**Reviewed by SA — 2026-10-13, against `15300d29`**
**Status:** ✅ **APPROVED WITH CONDITIONS.** The 4a workplan may start once the BA has applied E-26 to E-29. BD-9, BD-12, BD-14, BD-15 and BD-16 are not reopened.

**How it was checked.** I opened the code and the migrations:
- **`20261030_business_os_boost_purchases.sql`:**
  - every column R-k and R-l select exists;
  - `amount_*_minor` are `integer`, `credits_total` is `numeric(18,6)`;
  - CHECKs `status_known`, `paid_family_complete`, `currency_usd`, `amounts_not_negative` and `refund_within_total`;
  - `user_id` is `ON DELETE SET NULL`.
- **`20261031_business_os_boost_crediting.sql`:** a refund on a `disputed`, `dispute_lost` or `flagged_mismatch` row raises only `amount_refunded_minor`; a won dispute returns the row to its paid status. So `held = total - refunded` and `lost = total - refunded` are right.
- **`lib/payments/refundMath.ts`:** `minorUnitsPerMajor` is pure, has no imports, and is already used by `lib/business-os/currency.ts` and `entitlements/retailRate.ts`.
- **The guards:**
  - the finance table pin already lists `business_os_boost_purchases` (R-d), so **the table set does not grow** (verified);
  - the boost repository's scan guards pin only the identifiers `findBySessionIdForWebhook`, `findByPaymentIntentIdForWebhook`, `findByIdForWebhook` and `listForReconcile`, which finance never names, so they are **not tripped** (verified);
  - the three webhook placement guards scan the webhook route, `lib/business-os/billing/*.ts` and named files, so they are **not tripped** while the builder stays out of `billing/` (S4-FR-11).
- **SQL checks 14 to 16** were confirmed against the migration columns rather than run: there are no database credentials in the worktree, so QA runs them at V-11. All three are ASCII only, with no "into", no apostrophe in a comment, and one result set each (check 14 uses `grouping sets`, which is still one result set).

### Findings

1. **S4-F1 (Medium): S4-W-4 needs one source for "two decimals".** A finance-local list of currency decimals would be a second definition. **Ruling SA-Q26:** reuse `minorUnitsPerMajor` from `lib/payments/refundMath.ts`. A line's amounts are used as hundredths only when that returns 100; otherwise they are unreadable. Never `toUnits` or `× 100`. **E-26.**
2. **S4-F2 (Low): AC-88's microsecond boundary is enforced by the query, not the builder.** The test must assert the query bounds (`gte` start, `lt` end, ISO with microseconds), plus a builder test that a row given to it counts once. **E-27.**
3. **S4-F3 (Low): K-5 now carries two meanings.** In 4b it holds a revenue value and a dispute colour. The red reason text must name the dispute, and with a business picked the rule reads R-l′, so it is that business's disputes. **E-28.**
4. **S4-F4 (Low): Q28 is a genuine reporting choice for the user**, worded below with a default. It does not block 4a: no refund or dispute exists today.
5. **S4-F5 (Low): the estimates.** 4a at 2.5 days and 4b at 1.5 days are realistic; 4b reuses R-b, `creditsSection.ts` and the rules model. Total about 4 days, split as the BA proposes.

### Rulings SA-Q25 to SA-Q31

| # | Ruling |
|---|---|
| **SA-Q25** | **K-5 follows the filter window**: one read, the same figure as the panel. The caption names the window ("This month, UTC" by default). |
| **SA-Q26** | **Reuse `minorUnitsPerMajor`** (S4-F1). Do not pass integer cents through `toUnits` at scale 100: that is 2a's rule for decimal columns and would multiply cents by 100. A source test pins that no boost amount reaches `toHundredths` or `toUnits`. |
| **SA-Q27** | **Reuse the layer-B pager**: keyset on `id`, ceiling 5,000, rows plus `reachedCeiling` ("At least", with net Unknown). |
| **SA-Q28** | **Confirmed for slice 4:** refunds and disputes count against the purchase month, as recorded today, with the S4-W-3 note. A refund date would be a boost-module change (a migration on the writer side); record it as a deferral (**E-29**), not built here. |
| **SA-Q29** | **A rule on K-5**, as data in `FINANCE_RULES` (`atLeast 1`), with a dispute-specific reason. The strip stays at five tiles and K-6 stays unbuilt. |
| **SA-Q30** | **Stored `package_id` and `package_version`.** No entitlements import, so no registration. |
| **SA-Q31** | **Approved.** Compute bought credits in the existing `creditsSection.ts` with a second source filter. G3 and the lot caller list are not tripped, and K-4 stays gifts only. |

### For the user (business terms; a default applies if they do not answer)

**Refund timing.** "When a customer gets a refund on a credit boost, which month should show the lower figure?
- **(a) The month of the original purchase** (default). Last month's revenue can still go down later.
- **(b) The month the refund happened.** Past months never change, but it needs a small addition to how refunds are recorded, done as separate work.

There are no refunds today."

**Bought vs gifted credits:** this is not a question for the user. Showing them separately keeps the existing meaning of "gifted credits" (K-4).

### Requirement edits (BA applies; recorded in §0.3 as SA-RR-4)

- **E-26 (S4-W-4, S4-F1).** In S4-W-4, replace "or when the row's normalised currency does not have exactly two decimals (any other currency would need its own scale; none exists, SA-Q26)" with "or when `minorUnitsPerMajor(currency)` (`lib/payments/refundMath.ts`, the one definition) is not 100 for the row's currency (any other currency would need its own scale; none exists, the CHECK pins USD; SA-Q26)".
- **E-27 (AC-88, S4-F2).** Append to AC-88: " The half-open bounds are asserted on the read's query (`gte` start, `lt` end, ISO strings), since the database applies them; the builder counts each row it is given once."
- **E-28 (S4-FR-17, S4-F3).** Append to S4-FR-17: " The red reason names the dispute (\"N boost payments in dispute\"), never the revenue; with a business picked the rule uses R-l′, so it counts that business's disputes only."
- **E-29 (§0.4, SA-Q28).** Add a deferral row: "| DF-5 | **Boost refund and dispute dates** | No date is stored for a boost refund or dispute, so slice 4 counts them in the purchase month (S4-W-3). Showing them in the month they happen needs a writer-side change in the boost module (for example a refund event record). User choice pending; default: purchase month | 2026-10-13 |"

---

## SA Requirement Review — Slice 5a (M-1/M-2) — 2026-10-14

**Reviewed by SA — 2026-10-14, against `392a9b53`**
**Status:** ✅ **APPROVED WITH CONDITIONS.** The M-1 workplan may start once the BA has applied E-33 to E-39, including E-38 and E-39 in the admin layout standard. BD-14 and BD-17 to BD-20 are not reopened.

**The quality-gate note.** The user authorised M-1 and M-2 to run end to end with no diff stop. **Both run the full cycle**: workplan, SA workplan review, SA code review and QA. Neither takes the UI short path:
- **M-1** deletes a file the layout standard still names, edits guard tests in three folders, and adds a deep-link pattern to the Businesses page that the layout standard currently forbids (U-10).
- **M-2** adds money reads.

**How it was checked.** I opened the code and docs:
- **Billing events migration (`20261027`):** `amount_minor` and `amount_tax_minor` are integers, CHECK `>= 0`. The CHECK `currency_usd` pins `usd`. `paid_at`, `period_start` and `period_end` are **`timestamptz`**.
- **Who reads the totals today:** `financeHealth.ts:577-580`. R-d now feeds only `revenue.state` (the `data-state` attribute and the info line) and the plans line.
- **The pickers:**
  - the original `BusinessAccountPicker.tsx` is imported only by `FinanceFilterBar.tsx` and named by the four guard tests §11D.7 lists;
  - `AdminBusinessPicker` works standalone (`selectedAccountId`, `onSelect`) and looks nothing up on mount (RC-6);
  - `businessFilterChip({ accountId, name, onRemove })` falls back to the short id.
- **The layout standard:**
  - C-6 says "the original file stays in the audit-trail folder for Finance … its deletion moves to the finance adoption slice";
  - U-10 says "the drawer's open row is not in the URL in v1".
- **Guards:**
  - the finance table pin already lists `business_os_billing_events` (R-d), so **no growth** (verified);
  - the billing-event caller list matches the repository *name*, and the finance repository already has a test forbidding that name, so it is **not tripped**;
  - `firstPaymentStamp.guard` pins `first_paid_at` / `applyPaidPlanInvoice` namers, which M-2 never names, so it is **not tripped**;
  - the three webhook placement guards stay untripped while the builder is under `finance/`.
- **SQL checks 17 and 18:** ASCII only, with no "into", no apostrophe in a comment, and one result set each. They match the migration columns, and check 18's boost leg equals the 4a net (`disputed` and `dispute_lost` contribute 0). Not run here (no credentials); QA runs them.
- **ACs:** AC-108 to AC-129 are testable, with the edits below.
- **Estimates:** about 2 days (M-1) and 2.5 days (M-2) are accepted. M-1 is tight, so report at the end of day 1 if the picker swap and its four guard edits are not green.

### Findings

1. **S5-F1 (High): M2-FR-3 formats timestamps with a date-only helper.** `paid_at`, `period_start` and `period_end` are `timestamptz`. The shared `formatUtcDate` accepts a `YYYY-MM-DD` string only and returns "—" for anything else (2b, SA-W32), so the payment list would show dashes. **E-33.**
2. **S5-F2 (Medium): Q33 conflicts with the layout standard.** U-10 forbids the open drawer row in the URL, and C-6 places the picker deletion in the finance adoption slice. Both standard texts need a recorded exception or amendment. **E-38, E-39.**
3. **S5-F3 (Medium): K-5 exactness needs one rule.** It shows a value for a currency only when both parts are exact for that currency: boost net known, plans received exact (not "At least", nothing unreadable), and neither read failed. Otherwise it shows "Unknown". **E-34.**
4. **S5-F4 (Medium): "Paying / Not paying" in the M-1 header needs a definition from payload figures.** **E-35.**
5. **S5-F5 (Low): R-d after M-2 (SA-Q35).** With a business picked, `revenue.state` has no source once R-d is not called. **E-36.**
6. **S5-F6 (Low): showing the stored tier needs a display rule (SA-Q37).** **E-37.**
7. **S5-F7 (Low): BD-17 vs the M-1 summary.** "Paid us: credit boosts" carries the 4a purchase-month refund rule. The summary line must carry the S4-W-3 note whenever the boost section does, until 4b builds BD-17. This is covered by M1-FR-5's "state carried over"; Dev pins it with a render test.

### Rulings SA-Q32 to SA-Q41

| # | Ruling |
|---|---|
| **SA-Q32** | **UI only: options (a) to (c), no route change.** The name comes from the picker pick, else a payload row for that exact id (Section 4, then Section 3, then takings or overdue), else the short id. Option (b) is not needed. The name is never written to the URL, a log or a request. **M-1 still runs the full cycle**, for the reasons in the note above. |
| **SA-Q33** | **Allowed as an inbound, one-shot deep link (a recorded exception to U-10).** On `/admin/users`, the key **`account`** (a UUID, validated, no default) is read on load. If that row is on the loaded list, its drawer opens through the existing opener and the key is then **removed from the URL** (history `replace`), so the open row is never mirrored in the URL. A row not on screen gets the `AdminNotice`; a malformed value is ignored. This is not a filter: it does not narrow the list. The cross-folder edits are recorded. The layout standard gains the exception (E-38). |
| **SA-Q34** | **Approved.** Activity and Costs get the same custom `from` / `to`; AI cost & usage gets the account only, with "(its own window)". Dev checks each target's URL spec before building. |
| **SA-Q35** | **Option (a).** R-d is **not called** with a business picked, which closes AC-42's platform-wide exception. With all businesses, R-d keeps feeding `revenue.state`. In the picked view, `state` is derived from that account's own R-m′ and R-k′ rows (E-36). The R-d repository pins (no mode filter) stay unedited. |
| **SA-Q36** | **Approved.** The layer-B pager: keyset on `id`, ceiling 5,000, "At least". |
| **SA-Q37** | **Show the plan through `tierLabelForGroup(deps.config, 'tier:' + tier)`**, passed into the builder as a callback (the `aiCost` / `creditsSection` precedent). `planRevenue.ts` imports nothing from entitlements, and `planGroups.ts`'s registered symbol set is unchanged. A stored tier not in `config.tierOrder` shows "Unknown plan". Test fixtures take the tier from `getEntitlementConfig().tierOrder[0]` (the 1b method), with no tier literal. **E-37.** |
| **SA-Q38** | **Leave refunds and disputes out** until PAY P-6b. The "not recorded yet" note stays. |
| **SA-Q39** | **Approved.** Zero-amount invoices are counted in a note, not as payments. |
| **SA-Q40** | **Approved.** A pure server-side function beside `boostRevenue.ts` combines plans and boosts **per currency**, with the exactness rule of E-34. The summary's "Paid us, total" reads the same value. |
| **SA-Q41** | **Confirmed.** M-2 reads paid invoices only. It uses neither `PAYING_SUBSCRIPTION_STATUSES` nor P-8a, and does not name `first_paid_at`. |

### Requirement edits (BA applies; recorded in §0.3 as SA-RR-5a)

- **E-33 (M2-FR-3, S5-F1).** Replace "paid date (UTC, `formatUtcDate`)" with "paid at (UTC, the shared `formatUtc`: `paid_at` is a timestamp)", and replace "the period covered (`period_start` to `period_end`, dates only)" with "the period covered (`period_start` to `period_end`, both timestamps, shown with `formatUtc`)". Add to AC-129: " Every timestamp on the payment list shows through `formatUtc`, never as '—'."
- **E-34 (M2-FR-5, S5-F3).** Append to M2-FR-5: " A currency shows a K-5 value only when both parts are exact for it: the boost net is known, and the plans received is exact (no ceiling, no unreadable amount). Otherwise K-5 shows \"Unknown\". A part with no rows in that currency counts as an exact 0."
- **E-35 (M1-FR-4, S5-F4).** Replace "\"Paying\" or \"Not paying\" from the same Section 1 figures" with "\"Paying\" when the account is in a paid tier group of Section 1 (`tier:*`, BD-15), \"Not paying\" when it is in any other known group (Trial, Founding Partner, Comped, Unknown/held), and \"Unknown\" when Section 1 is `unknown` or shows the \"Tier set\" fallback (the paying read failed)".
- **E-36 (M2-FR-7, SA-Q35).** Replace "With SA-Q35 option (a), the picked view makes **no** platform-wide read at all (AC-42's R-d exception closes)." with "R-d is not called with a business picked (SA-Q35 option a), so the picked view makes **no** platform-wide read (AC-42's R-d exception closes). There, `revenue.state` is `recorded` when the account has a counted plan payment or a counted boost in the window, `none_yet` when it has neither, and `unknown` when either read failed." In AC-123, replace "R-d is called or not exactly as SA-Q35 rules (pinned)" with "`countRevenueRows` has zero calls (pinned)".
- **E-37 (M2-FR-3, SA-Q37).** After "plan (the stored `tier`, shown per SA-Q37)", add "(its display label through `tierLabelForGroup`, passed in by the builder; a tier not in `config.tierOrder` shows \"Unknown plan\"; no tier literal anywhere)".
- **E-38 (layout standard U-10, S5-F2).** In `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md`, append to the U-10 row's text: " **Recorded exception (Money M-1, finance health §11D, SA-Q33, 2026-10-14):** the Businesses page reads an inbound `account` key once on load, opens that row's drawer when the row is on the loaded list, and removes the key from the URL; the open row is still never mirrored in the URL."
- **E-39 (layout standard C-6, S5-F2).** In the same file, append to the C-6 row's "Notes" text: " **Deletion done in Money M-1** (finance health §11D, M1-FR-2): Finance moves to `AdminBusinessPicker` and the original file is deleted there, ahead of the finance shell adoption (M-6)."

---

## SA Requirement Review — Slice 6a (M-3) — 2026-10-14

**Reviewed by SA — 2026-10-14, against `d05eb0a4`**
**Status:** ✅ **APPROVED WITH CONDITIONS.** The workplan may start once the BA has applied E-44 to E-48. It runs the **full cycle**: new money logic, new route fields, and edits to export and DF-5 pins. BD-7, BD-12, BD-14, BD-18 and BD-22 are not reopened.

**"No new read" — verified in the code.** Every all-businesses request already holds what M-3 needs, per account:
- **R-a ledger rows** carry `user_id` (`CREDIT_LEDGER_ROW_COLUMNS`), and `summariseAiCost` already builds a full `byAccount` map (`aiCost.ts:89-125`) before cutting it to the top 10.
- **R-k boost rows** and **R-m plan rows** carry `user_id`.
- **The plan walk** gives `groupByAccount`.
- **The positions pass** gives `byUserId`.
- **In the picked view**, R-a′, R-k′ and R-m′ are already read.

So M-3 is a new pure builder plus route fields, with no repository method. The caller lists and the table pin are unchanged, and nothing goes under `lib/business-os/billing/`. This confirms the BA's guard claims.

**Missing from §11E.6 — two existing pins trip:**
- `finance.source.guard.test.ts:769-772` pins `boostRevenue.ts`'s exports to exactly four names.
- `:917-919` pins `planRevenue.ts`'s exports the same way.

Exporting the row readers (SA-Q45) changes both lists. Separately, the DF-5 pin (`:684-712`) scans **only** `boostRevenue.ts`, so a new builder could read `amount_refunded_minor` and the dispute literals with no guard noticing. See S6-F1.

**SQL checks 19 and 20:** ASCII only, with no "into", no apostrophe in a comment, and one result set each. Their revenue and cost rules match M3-W-2 to M3-W-4, and they take a month through the `p` block. They were not run here (no credentials); QA runs them.

### Findings

1. **S6-F1 (High): the guard table misses the export pins and the DF-5 scope.**
   - **Required:** update the two export pins in the same diff, to the exact new lists, each with a reason comment.
   - Extend the DF-5 pin to `accountEconomics.ts` with **zero** tokens allowed. The new builder takes refunded, held and lost only from the exported boost reader's result, never from the row.
   - **E-44.**
2. **S6-F2 (Medium): the after-tax boost rule should need no status literal.** From the boost reader's `{ total, tax, refunded, held, lost }`, let `net = total - refunded - held - lost`. Then:
   - `net === 0` gives 0 (full refund, `disputed`, `dispute_lost`);
   - otherwise `refunded === 0` gives `net - tax` (paid);
   - otherwise `tax === 0` gives `net`;
   - otherwise inexact.

   This equals M3-W-2 and check 19, and keeps the dispute statuses in DF-5's one place. **E-45.**
3. **S6-F3 (Medium): the URL key.** M3-FR-1 says `view=accounts`, but the BA's own SA-Q43 suggests `tab`, and Business OS AI uses `tab`. **Ruling: `tab=accounts`.** **E-46.**
4. **S6-F4 (Low): AC-134's sum needs a scope.** It is over **every** account before filter and cap, so the platform line's AI cost equals Section 3's total. **E-47.**
5. **S6-F5 (Low): sort and filter keys outside the tab.** The route accepts `sort`, `group` and `show` only with `tab=accounts` (400 otherwise), and the page writes them only on that tab. **E-48.**
6. **S6-F6 (Low): the estimate.** About 3 days is accepted. Report at the end of day 1 if the builder and route are not green.

### Rulings SA-Q42 to SA-Q50

| # | Ruling |
|---|---|
| **SA-Q42** | **Build the table only with `tab=accounts`.** The reads are already made on every all-businesses request; only the builder and one names request are extra. Without the tab, the Overview payload and reads are unchanged (AC-145). |
| **SA-Q43** | **Key `tab`, value `accounts`, absent = Overview, written with `replace`.** Tabs are page-local with the L-8a keyboard rules; no new shared export (SA-R-3). The M-6 shell migration keeps `tab`. |
| **SA-Q44** | **Keys `sort`, `group` and `show`, Zod enums, defaults omitted from the URL.** They are accepted only with `tab=accounts` (S6-F5) and are unchanged by M-6. |
| **SA-Q45** | **Export the per-row readers** (`readMoney` from `boostRevenue.ts`, `readPlanMoney` from `planRevenue.ts`), with the export pins updated (S6-F1). `refundsAndDisputesOf` stays private and the only reader of refunds and disputes. The after-tax step follows S6-F2. |
| **SA-Q46** | **`summariseAiCost` also returns the full per-account map** (non-wire, cost units). There is one sum, so the rows and Section 3 cannot differ. |
| **SA-Q47** | **Unknown** for a partial refund of a taxed boost; no pro-rata guess. Live tax is 0. |
| **SA-Q48** | **"Not available"** before the cut-over (Section 3's `coverage` is not `after_cutover`). |
| **SA-Q49** | **Show** money-only accounts as Unknown/held "No plan row". Hiding them would hide money. |
| **SA-Q50** | **Confirmed: full cycle, one workplan, one PR**, and FIN 4b stays paused until merge. |

**Also confirmed:**
- Sort and filter run **server side before the 200-row cap**.
- The cap is honest: "Showing 200 of N" plus "N more not listed". Names are looked up only for shown ids. The Deleted accounts row is outside the cap.
- The platform line covers every account, unfiltered, and any non-USD revenue anywhere gives "n/a, different currency": never a sum across currencies.
- AC-130 to AC-149 are testable, with E-46 and E-47.

### Requirement edits (BA applies; recorded in §0.3 as SA-RR-6a)

- **E-44 (§11E.6, S6-F1).** Add two rows to the §11E.6 table:
  - "`finance.source.guard.test.ts` export pins for `boostRevenue.ts` (`:769-772`) and `planRevenue.ts` (`:917-919`) | **Trip**: SA-Q45 exports the row readers | Update each list to the exact new names in the same diff, with a reason comment; no other export";
  - "Same file, DF-5 pin (`:684-712`) | Scans `boostRevenue.ts` only | Extend it to `accountEconomics.ts` with zero tokens allowed (no `amount_refunded_minor`, `'disputed'` or `'dispute_lost'`), with a planted control".
- **E-45 (M3-W-2, S6-F2).** Append to M3-W-2: " Computed from the exported boost reader's result, with no status literal: let net = total minus refunded minus held minus lost; net 0 gives 0; otherwise no refund gives net minus tax; otherwise tax 0 gives net; otherwise inexact."
- **E-46 (S6-F3).** In §11E, replace the Finance tab URL key `view` (value `accounts`) with `tab` everywhere it names the tab: M3-FR-1, M3-FR-5, M3-FR-11, M3-FR-12, AC-130, AC-145, AC-146 and SA-Q42.
- **E-47 (AC-134, S6-F4).** Replace "and the sum over rows (plus deleted) equals Section 3's total for the same window" with "and the platform line's AI cost (every account, before any filter or cap, deleted accounts included) equals Section 3's total for the same window".
- **E-48 (M3-FR-5, S6-F5).** Append to M3-FR-5: " The route accepts `sort`, `group` and `show` only together with `tab=accounts` (otherwise 400), and the page writes them only on that tab."

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
| 2026-10-12 | Slice 2a merged; 2b workplan written | 2a merged as PR #312. 2b workplan `docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_WORKPLAN.md` written; it raises SA-W28 to SA-W40 (requirement gaps W30, W31, W32, W34 with proposed edits E-11 to E-13). |
| 2026-10-12 | SA workplan review, slice 2b: **APPROVED WITH CONDITIONS** | §0.3 rows SA-W28 to SA-W40 and SA-WP-2b added. Required changes SA-WR-20 to SA-WR-25 are in the workplan. Requirement edits for BA (exact text in the workplan): E-11 (S2-CUR-5, date-ordered lists), E-12 (AC-74 renders `2026-09-30`), E-13 (§11A.7 R-h and R-i columns), E-14 (S2-FR-23, the block is never `unknown`). No code changed. |
| 2026-10-12 | BA applied SA 2b workplan-review edits E-11..E-14 | E-11: S2-CUR-5 allows date-ordered lists. E-12: AC-74 renders `2026-09-30`. E-13: §11A.7 R-h and R-i columns drop `subscription_id` and the plan `currency`. E-14: S2-FR-23, the block frame is never `unknown`. §0.1 slice 2 row and §0.2 updated. |
| 2026-10-12 | SA code review, slice 2b: **APPROVED WITH CONDITIONS** | §0.3 row SA-CR-2b added. SA re-ran 85 suites / 2,867 tests, `test:bos-entitlements` (6,982) and `test:authz-guard` (203), all green. Condition SA-CR-1 (the backspace byte in the finance guard's cohort rule) is for the fix round. Code approved for QA; QA owes V-11 (checks 10 to 13) and L-32 to L-40. No code changed. |
| 2026-10-12 | Slice 2b status: awaiting user diff review | SA-CR-2b approved with condition SA-CR-1 (literal backspace in finance.source.guard.test.ts:145 replaced by a word boundary, planted control added); QA PASS WITH ISSUES, no bugs; fix round 1 also qualifies the 'no failure ever stored' line when the plans read was incomplete, and documents that the reminder read error carries no client data. Same backspace defect in two non-finance tests handed to a separate task. User manual QA L-32 to L-41 owed. |
| 2026-10-12 | Slice 2b approved by user | User read the diff and approved; TL retrospective `docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_RETROSPECTIVE.md`; RM to commit and open the PR. Completes slice 2. |
| 2026-10-12 | RM: slice 2b committed and PR opened | Commit `b4e0fa2b` on `feature/bos-finance-health-2b`, `origin/main` (`8a43eb36`) merged in (`a6caf75e`), PR [#318](https://github.com/AgentsPilot/neuronforge/pull/318) to main. §0.1 slice 2 status and PR column updated. Manual QA L-32 to L-41 still owed by the user. No code changed. |
| 2026-10-13 | BA: fix slice 1c specified (BD-14, BD-15) | User decisions BD-14 (test and live platform money counted together, no switch; BD-10 marked superseded, text kept) and BD-15 (a paying champion is grouped under its paid tier with a Founding Partner note). New §11B: scope, S1C-FR-1 to S1C-FR-7, K-3 / K-5 and panel copy impact (no "webhook not in place"; "Revenue has been recorded" vs "None yet"; still no amounts), AC-75 to AC-84, affected guards (§11B.5 and a §12.2 row), SA-Q20 to SA-Q24. §13 checks 1 and 6 updated. Superseded-by-1c notes added under §6.4, §7.1, §8.1 and §10.6. §0.1 row 1c and §0.2 log. No code changed. |
| 2026-10-13 | SA requirement review, slice 1c: **APPROVED WITH CONDITIONS** | New section "SA Requirement Review — Slice 1c — 2026-10-13", checked against `97c66132`. §0.3 rows SA-Q20 to SA-Q24 and SA-RR-1c added. Findings S1C-F1 to S1C-F6. The owner account had its tier in force and showed as Comped; two billing rows per account are fixed by keyset on `id` and a list R-c′. BA edits E-15 to E-19: check 1 comment, AC-78 rewritten, AC-80 caveat, new AC-85 and AC-86, §11B.5 guard rows. Estimate 1 to 1.5 days. BD-14 and BD-15 not reopened. No code changed. |
| 2026-10-13 | BA applied SA 1c review edits E-15..E-19 | E-15: §13 check 1 comment adds "and tier is (none)" (ASCII, no apostrophe, no "into", one result set). E-16: AC-78 rewritten, (a) owner account with tier in force (Comped before, not Founding Partner; S1C-F1), (b) paying champion with no tier in force. E-17: AC-80 caveat. E-18: AC-85 and AC-86 added. E-19: §11B.5 guard rows (`:334-335` cell replaced; `planGroups.test.ts` parity row added). SA-Q20 question text in §11B corrected. §0.1 1c status and §0.2 log updated. SA sections and §0.3 unchanged. No code changed. |
| 2026-10-13 | BD-16 recorded (user decision) | One billing record per account is assumed (no separate test and live rows); SA-Q21 dual-row redesign withdrawn, W41 and AC-85 to be re-ruled by SA. |
| 2026-10-13 | SA workplan review, slice 1c: **APPROVED WITH CONDITIONS** (with BD-16) | §0.3: SA-Q21 marked withdrawn with its replacement (single-row reads kept; two rows give an honest error); the SA-Q20 row no longer adds an `id` column; rows SA-W41 to SA-W46 and SA-WP-1c added. SA-Q21 in the slice 1c SA review is marked withdrawn. Requirement edits for BA (exact text in the workplan): E-20 (S1C-FR-2), E-21 (AC-82), E-22 (AC-80), E-23 (AC-85), E-24 (§11B.6 SA-Q21), E-25 (check 1 comments). No code changed. |
| 2026-10-13 | BA applied SA 1c workplan-review edits E-20..E-25 (BD-16) | E-20: S1C-FR-2 rewritten (one billing row per account; two rows give an error and the 'Tier set' fallback; `bought_tier` added to R-c and R-c′). E-21: AC-82 two-row case. E-22: AC-80 "counted once" sentence removed. E-23: AC-85 rewritten. E-24: §11B.6 SA-Q21 marked withdrawn. E-25: §13 check 1 comments (ASCII, no apostrophe, no "into"; query unchanged). §0.1 1c status and §0.2 log updated. SA sections and §0.3 unchanged. No code changed. |
| 2026-10-13 | SA code review, slice 1c: **APPROVED WITH CONDITIONS** | §0.3 row SA-CR-1c added. SA re-ran 41 suites / 1,891 tests, `test:bos-entitlements` (7,194 tests) and `test:authz-guard` (203 tests), all green. Low conditions for the fix round: SA-CR-2 (rename R-c′ to `findBillingStatusForAccount`), SA-CR-3 (re-title the duplicate-across-pages test). Code approved for QA; QA owes V-11 (checks 1 and 6) and the owner-account manual check. No code changed. |
| 2026-10-13 | Slice 1c status: awaiting user diff review | SA-CR-1c approved with conditions SA-CR-2 (R-c' renamed findBillingStatusForAccount) and SA-CR-3 (test title), both done; QA PASS WITH ISSUES, no bugs; fix round 1 also limits the Founding Partner note and chip to accounts whose Founding Partner period is current. Note: the paid Basic tier displays as Essentials. User manual QA L-42 to L-48 owed. |
| 2026-10-13 | Slice 1c approved by user | User read the diff and approved; TL retrospective `docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1C_RETROSPECTIVE.md`; RM to commit and open the PR. |
| 2026-10-13 | Slice 1c PR opened (RM) | Committed `fa7a4aad` on `feature/bos-finance-health-1c`; origin/main merged in `10e3c5f0` (clean; finance, billing and Businesses-list suites 3,360 tests, `test:bos-entitlements` 7,231, `test:authz-guard` 203, all green); PR [#335](https://github.com/AgentsPilot/neuronforge/pull/335) opened, merge pending. §0.1 row 1c updated. |
| 2026-10-13 | BA: slice 4 "Boost revenue" specified | New §11C from a read-only live check (live facts §11C.1, code at `15300d29`): split 4a (boost revenue, about 2.5 days) and 4b (boost problems, K-5 dispute rule, bought credits in Section 4, about 1.5 days); rules S4-W-1 to S4-W-8 (dated by `paid_at`, paid-family statuses, refunds and disputes against the purchase month, minor units used as hundredths with no `× 100`, per currency only, deleted-accounts line, ceiling); S4-FR-1 to S4-FR-22; new reads R-k, R-k′, R-l, R-l′ in `BusinessOsFinanceReadRepository`; guard rows (§11C.7: the finance table pin does not grow; boost repository and webhook placement guards not tripped); AC-87 to AC-107; SA-Q25 to SA-Q31. §13 checks 14 to 16 added (ASCII, no apostrophes in comments, no "into", one result set each; not executed by BA). §12.2 slice 4 row, TOC entry, §0.1 row 4 and §0.2 log line. SA sections and §0.3 unchanged. No code changed. |
| 2026-10-13 | SA requirement review, slice 4: **APPROVED WITH CONDITIONS** | New section "SA Requirement Review — Slice 4 — 2026-10-13", checked against `15300d29`. §0.3 rows SA-Q25 to SA-Q31 and SA-RR-4 added. Findings S4-F1 to S4-F5. BA edits E-26 (one source for currency decimals, `minorUnitsPerMajor`), E-27 (AC-88 bounds on the query), E-28 (K-5 dispute reason, picked scope), E-29 (DF-5 refund dates). One business question for the user (refund timing, default: purchase month). Checks 14 to 16 confirmed against the migration columns, not run (no credentials). No code changed. |
| 2026-10-13 | BA applied SA slice 4 review edits E-26..E-29 | E-26: S4-W-4 currency-decimals test via `minorUnitsPerMajor` (`lib/payments/refundMath.ts`). E-27: AC-88 bounds asserted on the query. E-28: S4-FR-17 dispute reason and picked-business scope (R-l′). E-29: §0.4 DF-5 refund and dispute dates (default purchase month; user question pending). §0.1 row 4 status and §0.2 log updated. SA sections and §0.3 unchanged. No code changed. |
| 2026-10-13 | SA workplan review, slice 4a: **APPROVED WITH CONDITIONS** | §0.3 rows SA-W47 to SA-W54 and SA-WP-4a added. Required changes SA-WR-32 to SA-WR-35 are in the workplan. Requirement edits for BA (exact text in the workplan): E-30 (check 14 `deleted_account_net_minor`, AC-97), E-31 (AC-75 to AC-77 superseded for K-5 wording; R-d behaviour stays pinned), E-32 (S4-FR-4 plans line platform-wide in the picked view). DF-5 on default (a). No code changed. |
| 2026-10-13 | BA applied SA 4a workplan-review edits E-30..E-32 | E-30: §13 check 14 comment line and `deleted_account_net_minor` column (ASCII, no apostrophes in comments, no "into", one result set); AC-97 compares against it. E-31: Slice 4a note after AC-77 (K-5 wording superseded; R-d rule stays pinned). E-32: S4-FR-4 plans line platform-wide in the picked view. §0.1 row 4 status and §0.2 log updated. SA sections and §0.3 unchanged. No code changed. |
| 2026-10-14 | SA code review, slice 4a: **APPROVED** | §0.3 row SA-CR-4a added. SA re-ran 21 suites / 1,576 tests (including the boost repository and webhook placement guards), `test:bos-entitlements` (7,365 tests) and `test:authz-guard` (203 tests), all green. Code approved for QA; QA owes V-11 (check 14) and L-49 to L-56. No code changed. |
| 2026-10-14 | Slice 4a status: awaiting user diff review | SA-CR-4a APPROVED with no conditions; QA PASS WITH ISSUES, no bugs, so no fix round. Jest worker-exit warning shown to pre-date 4a (seen in 1a and 2a reviews; no open handle found). User manual QA L-49 to L-58 owed; DF-5 refund timing still with the user (default a). |
| 2026-10-14 | Slice 4a approved by user | User read the diff and approved; TL retrospective `docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_4A_RETROSPECTIVE.md`; RM to commit and open the PR. |
| 2026-10-14 | Slice 4a PR opened | RM committed 4a as `0acb460b`, merged `origin/main` into the branch (clean), and opened PR [#358](https://github.com/AgentsPilot/neuronforge/pull/358). §0.1 slice 4 row updated with the workplan and PR. Merge awaits the user; manual QA L-49 to L-58 owed; 4b next. |
| 2026-10-14 | BA: slice 5a "Money M-1 and M-2" specified; BD-17 to BD-20 recorded | Source of scope: [ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md](/docs/requirements/ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md) (CR, steps M-1 and M-2). Trigger: the owner test account paid a USD 79 Basic plan and a USD 10 boost (test mode) and Finance showed only the USD 10. User decisions: **BD-17** (boost refund in the refund month; lost dispute in the month lost; held means held now; implementation deferred with 4b), **BD-18** (charged AI cost is the business figure), **BD-19** (plan revenue as cash received first, MRR later; slice 5 split into 5a and 5b), **BD-20** (no test-payment label). New §11D from a read-only live check (9 billing event rows: 1 `invoice_paid` USD 79.00 for the test account, 8 `mismatch_refused` carrying amounts with no account; amounts in minor units, tax included; currency `usd` lower case). **M-1** (about 2 days, no new read): shared picker and deletion of the original, account header and summary, links carrying window and account, both ways with the Businesses drawer (M1-FR-1 to M1-FR-12). **M-2** (about 2.5 days): reads R-m, R-m′ in `BusinessOsFinanceReadRepository`, plans received per currency, by business, per account, K-5 = boosts + plans within one currency (M2-W-1 to M2-W-8, M2-FR-1 to M2-FR-14). §0.1 rows 4 (4b paused), 5a (new) and 5 (split); DF-5 decided; DF-6 ("since it started" view, CR BQ-9) and DF-7 (refused payments) added; §12.2 row; §13 checks 17 and 18; AC-108 to AC-129; SA-Q32 to SA-Q41. Awaiting SA requirement review. No code changed. |
| 2026-10-14 | SA requirement review, slice 5a (M-1/M-2): **APPROVED WITH CONDITIONS** | New section "SA Requirement Review — Slice 5a (M-1/M-2) — 2026-10-14", checked against `392a9b53`. §0.3 rows SA-Q32 to SA-Q41 and SA-RR-5a added. Findings S5-F1 to S5-F7; both parts run the full cycle. BA edits E-33 to E-37 here and E-38 / E-39 in `ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` (U-10 exception, C-6 deletion note). Guards verified not tripped; checks 17 and 18 confirmed against the migration, not run. No code changed. |
| 2026-10-14 | BA applied SA 5a review edits E-33..E-39 | SA-RR-5a: M2-FR-3 timestamps through `formatUtc` and tier label through `tierLabelForGroup` (E-33, E-37); AC-129 timestamp sentence (E-33); M2-FR-5 K-5 exactness per currency (E-34); M1-FR-4 Paying / Not paying / Unknown (E-35); M2-FR-7 picked-view `revenue.state` and AC-123 `countRevenueRows` zero calls (E-36); admin layout standard U-10 exception and C-6 deletion note (E-38, E-39). §0.1 slice 5a: SA-approved with conditions, edits applied, Dev workplan next. |
| 2026-10-14 | SA workplan review, slice 5a (M-1/M-2): **APPROVED WITH CONDITIONS** | §0.3 rows SA-W55 to SA-W73 and SA-WP-5a added. One PR accepted, with the M-1 checkpoint as a hard gate. Required changes SA-WR-36 to SA-WR-40 are in the workplan. Requirement edits for BA (exact text in the workplan): E-40 (checks 17 and 18 take a chosen month through a `p` block, default the current month; ASCII, no apostrophe in a comment, no "into", one result set), E-41 (one workplan and one PR), E-42 (links carry the window; SA-Q34 superseded). No code changed. |
| 2026-10-14 | BA applied SA 5a workplan-review edits E-40..E-42 | SA-WP-5a: §13 checks 17 and 18 replaced with the parameterised versions (`p` block defaulting to the current UTC month; set a quoted month start such as `2026-10-01 00:00:00+00` for another month) and the check intro updated (E-40, SA-WR-40); §11D.2 Order and §0.1 row 5a record one workplan and one PR with the M-1 checkpoint as a hard gate (E-41, SA-W55); M1-FR-7 every link carries the window, superseding SA-Q34's "(its own window)" (E-42, SA-W56). §0.1 row 5a status: workplan SA-approved with conditions; Dev implementing M-1 then M-2. No code changed. |
| 2026-10-14 | SA code review, slice 5a (M-1/M-2): **APPROVED** | §0.3 row SA-CR-5a added. SA re-ran 129 suites (2 failures, in an untouched jobs render test, pass alone), `test:bos-entitlements` (7,913 tests) and `test:authz-guard` (203 tests). BA wording edit E-43 (M2-FR-7, D-4). Follow-up: `useFinanceData.ts` client logger, M-6. Code approved for QA; QA owes V-12 (checks 17 and 18 for October 2026) and L-59 to L-72. No code changed. |
| 2026-10-14 | E-43 applied (SA-CR-5a, D-4) | M2-FR-7: in the picked view `revenue.state` is `recorded` when the account has any `invoice_paid` row (the same rows R-d counts with all businesses) or a counted boost in the window. |
| 2026-10-14 | Slice 5a ready for PR | SA-CR-5a APPROVED, QA PASS WITH ISSUES with no bugs. No fix round: QA low note (an unreadable plan row with no currency beside a USD boost would read as two currencies on K-5) cannot occur today because plan rows are USD-only; recorded as follow-up FU-5a-1. The user pre-authorised commit and PR for M-1 + M-2 without a diff review. User manual QA L-59 to L-74 owed. |
| 2026-10-14 | Slice 5a PR opened | RM committed slice 5a (M-1 + M-2) as `e8ffc5da` on `feature/bos-money-m1-m2`, merged origin/main (`858f037d`, clean; finance, users, layout, billing, payments suites 153 / 7,312, `test:bos-entitlements` 265 / 7,914, `test:authz-guard` 203 green) and opened PR [#383](https://github.com/AgentsPilot/neuronforge/pull/383) under the user's pre-authorisation (no diff review). Not merged. Manual QA L-59 to L-74 owed by the user. §0.1 row 5a updated. |
| 2026-10-14 | BA: CR decisions BD-21 to BD-27 recorded; slice 6a "Money M-3" specified | The user accepted all ten consolidation review defaults; the seven not already recorded are BD-21 (one Money section), BD-22 (margin on revenue after tax), BD-23 (billing totals in Money, per-account billing panel in the Businesses drawer), BD-24 (Costs & credits into Money later), BD-25 (retire Platform dashboard and Exchange rates), BD-26 ("since it started" view for one account, deferred DF-6), BD-27 (Health tile kept, renamed "Recorded AI cost"). New **§11E** (Money M-3, FIN slice 6 split into 6a and 6b): Accounts tab with one row per account (paid us after tax per currency, charged AI cost, AI margin USD only, credits used, plan group), server-side sort, filter and 200-row cap, platform margin line, row link to the M-1 view, AI margin line in the M-1 summary; rules M3-W-1 to M3-W-10 and M3-FR-1 to M3-FR-16; **no new read** (R-a, R-k, R-m, plan walk and positions pass already carry the account); guards §11E.6; AC-130 to AC-149; SA-Q42 to SA-Q50. §0.1 rows 6a (new) and 6 (split), §0.2 log, DF-8 (Stripe fee estimate to 6b), §12.2 row, §13 checks 19 and 20 (ASCII, no apostrophes in comments, no "into", one result set each; not executed by BA). About 3 days. SA sections and §0.3 unchanged. Awaiting SA requirement review. No code changed. |
| 2026-10-14 | SA requirement review, slice 6a (M-3): **APPROVED WITH CONDITIONS** | New section "SA Requirement Review — Slice 6a (M-3) — 2026-10-14", checked against `d05eb0a4`. §0.3 rows SA-Q42 to SA-Q50 and SA-RR-6a added. "No new read" verified in the code. Findings S6-F1 (High: the boost and plan export pins trip; DF-5 pin to be extended) to S6-F6. BA edits E-44 to E-48 (guard rows, status-free after-tax rule, key `tab`, AC-134 scope, sort and filter keys only with the tab). Checks 19 and 20 confirmed against the style rules, not run. No code changed. |
| 2026-10-14 | BA applied SA 6a review edits E-44..E-48 | SA-RR-6a: §11E.6 two guard rows (boost and plan export pins; DF-5 pin extended to `accountEconomics.ts` with zero tokens) (E-44); M3-W-2 status-free boost after-tax rule (E-45); URL key `tab=accounts` across §11E (E-46); AC-134 platform line before filter and cap (E-47); M3-FR-5 `sort`, `group`, `show` only with the tab, else 400 (E-48). §0.1 slice 6a: SA-approved with conditions, edits applied, Dev workplan next. SA sections and §0.3 unchanged. No code changed. |
| 2026-10-14 | SA workplan review, slice 6a (Money M-3) | APPROVED WITH CONDITIONS. §0.3 rows SA-W74 to SA-W89 and SA-WP-6a added. BA edits E-49 (M3-FR-11 payload keys), E-50 (M3-FR-3 formatters) and E-51 (§13 slice 6a check differences) are specified in the workplan SA section, not yet applied. No code changed. |
| 2026-10-14 | BA applied SA 6a workplan-review edits E-49..E-51 | SA-WP-6a: M3-FR-11 optional `accountEconomics` and `accountMargin` payload keys (E-49); M3-FR-3 formatters, "Paid us" `formatMoney`, AI cost and margin `formatUsd` (E-50); §13 slice 6a checks intro notes the known differences from check 19 (E-51). §0.1 slice 6a: workplan SA-approved with conditions (SA-WP-6a; WR-41..WR-45), Dev implementing. SA sections and §0.3 unchanged. No code changed. |
| 2026-10-15 | SA code review, slice 6a (Money M-3) | Code Approved (SA-CR-6a in §0.3). Third check-19 difference ruled page-right; E-52 (BA) appends it to the "Slice 6a checks" intro, exact text in the workplan SA Code Review. No requirement body text changed by SA. |
| 2026-10-15 | E-52 applied (SA-CR-6a) | Slice 6a checks intro: third known difference from check 19 (a zero non-USD plan invoice makes no page line; the page is right). |
| 2026-10-15 | Slice 6a ready for PR | SA-CR-6a APPROVED; QA PASS WITH ISSUES; B-1 (a No plan row account linked to a Business not found view) fixed in fix round 1 with a render test and a page-guard pin. SA Low follow-ups FU-6a: inactive tab aria-controls; cost cell vs Section 3 on unreadable or overflow rows; group select for an unlisted tier. User pre-authorised commit and PR. User manual QA L-75 to L-88 owed. |
| 2026-10-15 | Slice 6a PR opened (RM) | PR [#392](https://github.com/AgentsPilot/neuronforge/pull/392), commit `b8f59db1` on `feature/bos-money-m3` (origin/main merged in, `bbab0c24`); §0.1 row 6a status, Workplan and PR columns filled. No migration. Manual QA L-75..L-88 owed by the user |
| 2026-10-15 | Money M-4 specified (BA) | New §11F "Two measures, one vocabulary" (OV-1 copy: W-1 to W-25 and V-1 to V-7; OV-5: definition R4-1 to R4-11, M4-FR-1 to M4-FR-12, the picked-business rule, reads reused with no new method, guards §11F.8, AC-150 to AC-166, manual QA L-89 to L-94, SA-Q51 to SA-Q57); §13 checks 21 and 22; §0.1 row M-4; §0.2 log line; §12.2 row; TOC entry; Money area source line names M-4. Live check from the main checkout (`e49a4719`), SELECT only. Recommends two PRs, OV-1 first |
| 2026-10-15 | Slice 6a merged | PR #392 merged; slice 6a (Money M-3) complete. User manual QA L-75 to L-88 owed. |
| 2026-10-15 | SA requirement review, Money M-4 (§11F) | APPROVED WITH CONDITIONS (SA-RR-M4, SA-Q51 to SA-Q57 in §0.3). New section "SA Requirement Review — M-4 (§11F) — 2026-10-15" after §11F.10. SA applied E-53 (R4-9 exactness per read), E-55 (§11F.8 AC-145 baseline row), E-56 (AC-167, AC-168) and E-57 (M4-FR-8 race rule). E-54 (rename the Finance figure to "Recorded above charged") is for BA. Live views and function verified read-only. No code changed. |
| 2026-10-15 | BA applied SA M-4 review edit E-54 (Finance label 'Recorded above charged') | Finance net difference renamed in §11F title, intro and TOC, R4-2, R4-5, R4-6, R4-9, R4-10, M4-FR-1 to M4-FR-3, AC-154, AC-155, AC-159 and the §0.1 M-4 row; Leak check (W-16) keeps "Recorded, not charged". §0.1 M-4 status updated; §0.2 log line. |
| 2026-10-15 | SA workplan review, Money M-4 (two PRs) | APPROVED WITH CONDITIONS (SA-WP-M4; SA-W90 to SA-W104 in §0.3). SA applied E-58 (§11F.4: W-18 gains `:245`, new W-27 and W-28, AC-150 range) and E-59 (§11F.3: V-3 and V-5 ruled exceptions); FU-M4-1 added to §0.4. Required changes SA-WR-46 to SA-WR-50 in the workplan. No code changed. |
| 2026-10-15 | SA code review, M-4 Part A (OV-1) | Code Approved (SA-CR-M4A in §0.3). The guard's HEAD count was re-run by SA (21 offences at HEAD, 0 now). The cron description follow-up joins FU-M4-1. No requirement body text changed. |
| 2026-10-15 | M-4 user go-ahead; Part A ready for PR | The user gave the same go-ahead as M-1..M-3 for both M-4 parts: after SA and QA pass, RM commits and opens the PR with no user diff review (supersedes the SA-WP-M4 note that each part stops for a diff view). Part A: SA-CR-M4A APPROVED, QA PASS, no bugs. One TL retrospective covers both parts after Part B. User manual QA L-89 to L-97 owed. |
| 2026-10-15 | M-4 Part A PR opened (RM) | Part A (OV-1) committed on `feature/bos-money-m4` (`a215561d`), `origin/main` (`3d4122a9`) merged in with no overlapping files, re-run tests all green; PR [#398](https://github.com/AgentsPilot/neuronforge/pull/398) open. §0.1 M-4 row: Part A PR #398 open; Part B after merge. |
| 2026-10-15 | SA code review, M-4 Part B (OV-5) | Code Approved (SA-CR-M4B in §0.3). D1 to D5 approved; the D5 distortion sentence is confirmed as written (it matches R4-10), so no E-edit. No requirement body text changed. |
| 2026-10-15 | M-4 Part B ready for PR | SA-CR-M4B APPROVED; QA PASS WITH ISSUES, no bugs; fix round 1 made the recorded-read failure notice conditional (no reference to charged figures above when the charged read also failed). The 92-day read timing (SA-WR-49) could not be measured by QA and is now user manual step L-104; a slow read shows Unknown, never a wrong figure. User go-ahead (no diff review) applies. TL retrospective covers both parts. User manual QA L-98 to L-105 owed. |
| 2026-10-15 | M-4 Part B PR opened (RM) | Part B (OV-5) committed on `feature/bos-money-m4b` (`cde25b99`); `origin/main` (`69e52ada`) merged in as `ee1471e9` with no overlapping files. All re-runs after the merge are green: `test:bos-entitlements` 269 / 7,994; `test:authz-guard` 203; finance suites 27 / 2,242; `app/admin/users` 25 / 601; `app/admin` + `lib/admin/health` 146 / 4,474; vocabulary guard 137; TokenUsageRepository contract + isolation 37. PR [#407](https://github.com/AgentsPilot/neuronforge/pull/407) is open under the user's pre-authorisation (no diff review), with no auto-merge. Not merged. No migration. User manual QA L-98 to L-105 owed, including the 92-day timing (L-104). §0.1 M-4 row updated. |
| 2026-10-15 | BA: Finance shell (DF-4 / M-6) specified as F-2, F-4, F-5; BD-28 to BD-31 recorded | The admin-layout session's six-slice Finance plan (F-0 #414 and F-1 #418 merged, F-3 #420 merged) hands F-2, F-4 and F-5 to the finance stream. User decisions BD-28 (h1 "Finance"), BD-29 (tiles above the filter bar, both tabs), BD-30 (a bad link drops only the bad filter, U-4), BD-31 (tiles clickable to their sections). New §11G (scope, rules, user-visible changes, AC-169 to AC-183, including the F-4 byte-identical request pin AC-173); §0.1 rows F-2 (starting, blocked on #420), F-4, F-5; DF-4 marked as delivered by them; §0.2 log line; TOC entry. No code changed. |
| 2026-10-15 | F-3 merged; F-row wording checked | PR #420 (F-3) merged, unblocking F-2. Follow-ups requirement F-0, F-1 and F-3 rows reworded to match the merged PRs #414, #418, #420. |
| 2026-10-15 | SA workplan ruling, F-2 (Finance header and states) | APPROVED WITH CONDITIONS (SA-WP-F2 in §0.3): SA-W1 (a), SA-W2 now, SA-W3 "Try again" now, SA-W4 accepted; F2-R1 to F2-R3 in the workplan. No requirement body text changed. |
| 2026-10-15 | SA code review, F-2 (Finance header and states) | Code Approved (SA-CR-F2 in §0.3). No conditions; three deviations approved. No requirement body text changed. |
| 2026-10-15 | F-2 ready for PR | SA-CR-F2 APPROVED with no conditions; QA PASS, no bugs, AC-169 to AC-172 pass. Fast track: RM commits, opens the PR and switches on auto-merge. User read-only browser look L-106 to L-111 owed after merge. |
| 2026-10-15 | F-2 PR opened (RM) | Committed on `feature/finance-f2-header-states` (`9f6bcbb3`), origin/main `0f71e70d` merged in (`bffac050`), clean; RM re-ran finance 366, components 730, aiCostVocabulary 137, authz-guard 203, all pass. [PR #424](https://github.com/AgentsPilot/neuronforge/pull/424) opened, auto-merge on (merge queue). |
| 2026-10-16 | SA requirement and workplan review, F-4 (filter bar and URL state) | APPROVED WITH CONDITIONS (SA-WP-F4 in §0.3). SA applied E-60 (AC-173: valid page states, and four by-decision request changes pinned with new literals) and E-61 (§11G.2 F-4 row: recorded page deviations SA-W6, SA-W5, SA-W2). F4-R1 to F4-R5 in the workplan. |
| 2026-10-16 | SA code review, F-4 (filter bar and URL state) | Code Approved (SA-CR-F4 in §0.3). One permitted amendment to the AC-173 pin file (timeouts only; the new hash is the frozen value); two stale comments fixed in the PR. No requirement body text changed. |
| 2026-10-16 | F-4 ready for PR | SA-CR-F4 APPROVED; one SA-approved AC-173 pin amendment (10 s wait, 30 s per-test timeout; no literal or hash input changed), new frozen pin hash 3a1a2dd4...f6f8, helper unchanged b84e0c96...aabf; stale router.replace comments fixed. QA PASS, no bugs; pin 21/21 on 5 runs including one under load. Fast track: RM commits, opens the PR and switches on auto-merge. User browser look L-112 to L-119 owed. |
| 2026-10-16 | F-4 PR opened (RM) | Committed on `feature/finance-f4-filter-bar` (`c9496495`); pin hashes verified (3a1a2dd4...f6f8, helper b84e0c96...aabf); origin/main `15d8d3f2` merged in (`b7a4dfd5`), clean; RM re-ran finance 458, users 615, components 739, authz-guard 203, all pass. [PR #434](https://github.com/AgentsPilot/neuronforge/pull/434) opened, auto-merge on (merge queue). |
| 2026-10-16 | SA workplan review, F-5 (KPI tiles); §0.1 status fixed | APPROVED WITH CONDITIONS (SA-WP-F5 in §0.3). SA applied E-62 (§11G.2 F-5 row: K-1 link period, the Accounts-tab jump, neutral tiles). §0.1 rows corrected: F-2 merged (#424), F-4 merged (#434), F-5 workplan SA-approved. |
| 2026-10-16 | SA code review, F-5 (KPI tiles) | Code Approved (SA-CR-F5 in §0.3). All four pin hashes recomputed and frozen; no conditions. Follow-up: harden `bosLens.render` P-8's 5 s default wait (merge-queue flake risk, outside this slice). |
| 2026-10-16 | F-5 ready for PR | SA-CR-F5 APPROVED with no conditions; QA PASS, no bugs; frozen pins re-verified (Pin A 30f5fc24...2e01, Pin B 24ff0da7...df9f, AC-173 3a1a2dd4...f6f8, helper b84e0c96...aabf). One retrospective covers F-2, F-4 and F-5 (docs/retrospectives/FINANCE_LAYOUT_F2_F4_F5_RETROSPECTIVE.md). Fast track: RM commits, opens the PR and switches on auto-merge. With F-5 merged, M-6 (DF-4) is complete. User browser look L-120 to L-127 owed. |
| 2026-10-16 | F-5 PR opened (RM) | Committed on `feature/finance-f5-kpi-tiles` (`24cf0c3d`); all four frozen pin hashes verified before commit (Pin A 30f5fc24...2e01, Pin B 24ff0da7...df9f, AC-173 3a1a2dd4...f6f8, helper b84e0c96...aabf); origin/main `09e2d3ad` merged in (`e8fee379`); re-run green: finance 527, components 804, analytics 191, business-os-llm 854, authz-guard 203. PR [#437](https://github.com/AgentsPilot/neuronforge/pull/437) opened, auto-merge on (merge queue). §0.1 F-5 row updated. |
| 2026-10-16 | BA: Money M-5 "The Money section" specified | New §11H from CR (§1, §5.1, M-5 row, SA-Q-4, BQ-1, BQ-6, BQ-10), BD-21, BD-24, BD-27, FU-M4-1 and SA-Q55, re-verified against main `98735db9` (CF-1 to CF-13): Money sidebar section (Finance, Charge checks, AI calls & usage (detail)); Costs & credits with its Leak check mounted at `/admin/finance/charges`, old `?tab=costs` links redirected (temporary, `next.config.js`), the two in-app links changed at source; Business OS AI keeps Settings and Activity; strings S-1 to S-17 (S-14 to S-17 close FU-M4-1, wording only); Health tile page link to Finance; guards §11H.6; AC-184 to AC-203; L-128 to L-136; SA-Q58 to SA-Q64. Sidebar sign-off recorded as already given 2026-10-14 (BQ-1, BQ-6). §0.1 row M-5 (new) and F-5 (merged); §0.2 log line; §0.4 FU-M4-1 note; TOC; Money area source line. About 2 days, UI short path. Awaiting SA review. No code changed. |
| 2026-10-16 | BA: user roadmap decisions BD-32 to BD-35; BQ-13 open | BD-32 order M-5 → 4b → M-8 → 6b → DF-6 → 5b → 7 → 3 → 8 with estimates; BD-33 no per-slice user approval (SA, QA, TL approve; RM commits, opens the PR, turns on auto-merge; business questions and production migrations still stop for the user); BD-34 M-8 marks Platform dashboard and Exchange rates redundant in comments and unlinks them, no deletion (amends BD-25); BD-35 6b re-orders the KPI tiles (revenue, cost, then user and account data). BQ-13 (refunded boost credits) open in §0.4, attached to 4b, today's behaviour kept meanwhile. §0.1 rows 4 and 6 annotated; Status line notes BQ-13; CR M-8 row updated. No code changed. |
| 2026-10-16 | SA requirement and workplan review, Money M-5 (§11H) | SA-RR-M5 approved and SA-WP-M5 approved with conditions (§0.3). SA applied E-63 (S-18 `ANALYTICS_WHAT`, AC-195 to S-18) and E-64 (§11H.6: `tabCoexistence` X-8, X-8b, X-10 re-scoped, not deleted). M5-R1 to M5-R4 in the workplan. |
| 2026-10-17 | SA code review, Money M-5 | Code Approved (SA-CR-M5 in §0.3). No conditions. Follow-up chip: harden the load-sensitive timing tests (`app/api/admin/jobs-queues/__tests__/qa-slice5-pr2.route.test.ts`, `bosLens.render` P-8). No requirement body text changed. |
| 2026-10-17 | RM: Money M-5 committed, PR #444 opened, auto-merge on | Commit `1c7b7554` on `feature/bos-money-m5`; origin/main (`16cb2a1f`) merged in `4e96e719` (one trivial Change History conflict in ADMIN_IDENTIFICATION_AND_ACCESS.md, both rows kept). All seven frozen pin hashes verified. Re-run green after the merge. §0.1 M-5 row: status, workplan and PR columns |
| 2026-10-17 | BA: slice 4b specified (§11I) | New §11I from §11C, BD-17 and its dispute defaults, DF-5, the refund-timing scoping (option (ii)) and pre-work re-verified at main `16cb2a1f` and live (PF-1 to PF-11). **4b.1:** migration `20261072` (table `business_os_boost_reversal_events`, RLS with no policy, service_role SELECT and a column-level INSERT grant without `recorded_at`, append-only; the transition function replaced with the same signature, six insert points, refund delta and dispute amount at stake, `ON CONFLICT DO NOTHING`; refuse if any refund or dispute exists), rollback that refuses while rows exist, regenerated test-account cleanup `20261073` (G-18 blocks the new FK), purge, baseline 156, inventory and export registration; PR off auto-merge until the user applies the migration. **4b.2:** R-n, R-n′; refunds and lost disputes by `recorded_at`; held now, never taken off a month; boost problems; K-5 dispute rule; bought credits beside gifted (K-4 unchanged); Accounts tab on the same rule; table-absent tolerance. AC-204 to AC-232, L-137 to L-141, checks 23 to 26, SA-Q65 to SA-Q74. §0.1 row 4, §0.2 log, §0.4 BQ-13 and DF-5, §12.2 row, §14 pointer, TOC. BQ-13 open: no take-back. Awaiting SA review |
| 2026-10-17 | SA requirement review, slice 4b (§11I) | APPROVED WITH CONDITIONS (SA-RR-4b, SA-Q65 to SA-Q74 in §0.3). New section "SA Requirement Review — 4b (§11I) — 2026-10-17". SA applied E-65 (`LOCK TABLE` step and a check 24 row "no refund or dispute recorded without an event"), E-66 (local-only SQL proof for AC-207 to AC-211), E-67 (rollback order, fix forward), E-68 (Pin B stays byte-identical) and E-69 (two reads, 100-id chunks). No code changed. |
| 2026-10-17 | SA workplan review, slice 4b.1 (reversal events) | APPROVED WITH CONDITIONS (SA-WP-4b1; SA-W105 to SA-W115 in §0.3). SA applied E-70 (the §13 checks 23 and 24 are superseded by the strengthened 4b.1 workplan §6 text). PGlite satisfies E-66, so no user test-mode refund is needed. No user action beyond the planned apply steps. |
| 2026-10-17 | SA code review, slice 4b.1 (reversal events) | Code Approved (SA-CR-4b1 in §0.3). Migration verified byte for byte by SA; checks editor-safe; frozen pins unchanged; the 9 local `test:gate` failures are Windows-only and outside 4b.1. The PR stays off auto-merge until the user applies 20261072 and 20261073 and check 24 is all ok. |
| 2026-10-17 | RM: slice 4b.1 committed and PR opened | Commit `240b14de`, merge of origin/main `6d8ecfb8` (QA-4B1-1 applied: both `toHaveLength` 156, totals 38 + 0 + 118). PR [#447](https://github.com/AgentsPilot/neuronforge/pull/447) open, **auto-merge OFF**; awaiting the user apply of `20261072` and `20261073` (checks 23 and 24) before RM merges by hand |
| 2026-10-17 | BA: Money M-8 specified (§11J) | New §11J "Mark the Platform dashboard and Exchange rates pages redundant" from BD-34, CR M-8, I-15, I-19 and main `5c214310`: scope, rules RP-1 to RP-7, guards, AC-233 to AC-242, SA-Q75 to SA-Q80, BQ-14 (default: visible notice), FU-M8-1. §0.1 row M-8 (in progress), §0.2 log line, TOC entry. No code changed. |
| 2026-10-17 | SA requirement and workplan review, Money M-8 (§11J) | SA-RR-M8 approved and SA-WP-M8 approved with conditions (§0.3). E-71 applied: BD-34 read as code comments only, no visible notice (RP-4, AC-236, scope, §11J.4, BQ-14 resolved); MULTI_CURRENCY doc pointer added; estimate about 0.75 day. |
| 2026-10-17 | SA code review, Money M-8 | Code Approved (SA-CR-M8 in §0.3). No conditions. |
| 2026-10-17 | RM: Money M-8 committed, PR #448 opened, auto-merge on | Commit `92ef1454` on `feature/bos-money-m8`; origin/main (`5c214310`) had not moved, so no merge was needed. Seven frozen pins byte-identical (LF-normalised). Re-run: app/admin/components 818, redundant-pages guard 17, Health guards 56, test:authz-guard 203, all passed. §0.1 M-8 row updated. |
| 2026-10-17 | BA: slice 6b specified (§11K) | New §11K "Slice 6b: margin after estimated Stripe fees, and KPI order" from BD-7, BD-12, BD-22, BD-29, BD-31, BD-35, DF-8, the 6a builder at main `e43dcb60` and a read-only live check (LF-1 to LF-3): fee rule FE-1 to FE-7 (per charge, gross, half up, config data `STRIPE_FEE_ESTIMATE`, default 290 bps + 30 minor units, USD only; refunded charges keep their fee; no dispute fee), margin rules FE-8 to FE-17, display, tile order K-5, K-1, K-3, K-2, K-4 (order only), guards with the seven frozen pins and the vocabulary guard ("estimate", never "estimated"), AC-243 to AC-256, checks 27 and 28, SA-Q81 to SA-Q91, estimate about 1.75 days. New BQ-15 (§0.4) with its default, not blocking. §0.1 row 6b, §0.2 log line, TOC entry. No code changed. |
| 2026-10-17 | SA requirement and workplan review, slice 6b (§11K) | SA-RR-6b approved and SA-WP-6b approved with conditions (§0.3). SA applied E-72 (zero-total boost is no charge; checks 27 and 28 filter it), E-73 (invalid fee config gives Unknown) and E-74 (fee subtracted in minor units before the one scale step). |
| 2026-10-17 | SA code review, slice 6b | Code Approved (SA-CR-6b in §0.3). No conditions. |
| 2026-10-17 | RM: slice 6b committed, PR #449 opened, auto-merge on | Commit `8d2f5ff6` on `feature/bos-finance-health-6b`; origin/main (`e43dcb60`) had not moved, so no merge was needed. Re-run: app/admin/finance, lib/business-os/finance and the finance route, 36 suites, 2355 tests, all passed. Seven frozen pins unchanged. §0.1 row 6b: status, workplan and PR columns. |
| 2026-10-17 | BA: slice DF-6 specified (§11L) | New §11L "Slice DF-6: since it started (one account)" from BD-26, CR G-9 and SA-Q-6, BD-30, BD-32, BD-33 and the code at `ea56ad04`: window rules DF6-W-1 to DF6-W-7 (start = later of the cut-over instant and the earliest plan-row start fact, end = now, server-resolved, no timezone read, ceilings unchanged), validation DF6-FR-1 to DF6-FR-6 (`since_start` only with `accountId`, else 400; 92-day cap otherwise unchanged), URL and U-4 DF6-FR-7 to DF6-FR-10, tile and section behaviour, reads and bounds DF6-P-1 to DF6-P-3, guards; AC-257 to AC-272, checks 29 and 30, L-148 to L-154, SA-Q92 to SA-Q99; new BQ-16 in §0.4. No migration. §0.1 DF-6 row added; §0.4 DF-6 row scheduled; ToC; §0.2 log. |
| 2026-10-17 | SA requirement review, DF-6 (§11L): **APPROVED WITH CONDITIONS** | New section "SA Requirement Review — DF-6 (§11L) — 2026-10-17" after §11L.12, checked against `ea56ad04`. §0.3 row SA-RR-DF6 added; SA-Q92 to SA-Q99 ruled. Findings DF6-F1 (start is the cut-over only) to DF6-F6; BA edits E-75 to E-80. Cap, admin gate, ceilings, columns, timezone, isolation and pins verified in code. No code changed. |
| 2026-10-17 | BA: SA-RR-DF6 edits E-75 to E-80 applied (§11L) | E-75 the window starts at the cut-over instant only, resolved in the route by a pure `since_start` branch of `resolveFinanceWindow` (no plan-row fact; AC-257, checks 29 and 30 reduced); E-76 shared extras case resolving to none, one ruled update of the `adminWindow.test.ts:203` list pin; E-77 no link carries `range=since_start` (exhaustive branch); E-78 AC-262 start and end differ; E-79 Section 1 "new in window" note; E-80 type changes listed in §11L.8. §0.1 DF-6: SA approved, ready for Dev workplan. |
| 2026-10-17 | SA workplan review, DF-6 (§11L): **APPROVED WITH CONDITIONS** | §0.3 row SA-WR-DF6. SA applied E-81 (label "Since it started: 2026-09-29 16:50 to now (UTC)" in DF6-FR-9, AC-266, L-149), E-82 (summary window line for since_start only, §11L.6, AC-266), E-83 (§11L.8 row: one ruled update of the links import pin to add adminWindowPresets) and E-84 (planGroups.ts:224). No code changed. |
| 2026-10-17 | SA code review, DF-6 (§11L): **Code Approved** | §0.3 row SA-CR-DF6. D-1 approved (schema pinned by AC-173 part B; SA-Q96 corrected). D-2 approved and applied by SA (DF6-R3 amended: financeLinks.test.ts type narrowing); scoped tsc clean 0. Seven pins equal; 2605 tests passed. |
| 2026-10-17 | RM: slice DF-6 committed, PR #450 opened, auto-merge on | Commit `fd7b7f02` on `feature/bos-finance-health-df6`; origin/main (`fdaf90c1`, 6b #449) merged in `e73ec431` with no conflicts. Re-run: finance UI, finance lib, finance route, admin layout, analytics and business-os-llm filters, 80 suites, 4218 tests, all passed. Seven frozen pins unchanged. §0.1 row DF-6: status and PR columns. |
| 2026-10-17 | Dev: slice 4b.1 rebased onto DE-8a (PR #451) | main took `20261074`/`20261075`. 4b.1 renumbered: `20261072` → **`20261076`** (bytes unchanged, body md5 `018c4447f2b52dd87e4ae3b229e5b42c`; no migration since redefines the transition function) and `20261073` → **`20261077`** (regenerated over `20261075`, so it keeps `business_os_data_exports`; stamp `f854486b31baf784` → **`b78b4579fc6631f8`**; rollback restores `20261075`). Check 23 now expects DE-8a live (9 rows, stamp `a824848e0a538477`); check 24 pins the new stamp. Runbook: check 23 → `20261076` → `20261077` → check 24. Updated: §0.1, §11I (PF-1 note, 11I.2, 11I.4, 11I.6, 11I.8), §13 check headings. SA rulings and reviews keep the old numbers as history. Merge staged, not committed |
| 2026-10-17 | SA code review, 4b.1 rebase onto DE-8a | APPROVED WITH CONDITIONS (SA-CR-4B1-R in §0.3). R-1: DE-8a rollback guard must test for any live cleanup body naming business_os_data_exports (fix in #447). R-2, R-3 small. No code changed by SA. |
| 2026-10-17 | BA: slice 8 specified (§11M) | New §11M "Slice 8: history snapshots" on `feature/bos-finance-health-8` (DF-6 tip `f6182697`): code facts CF-1 to CF-10; what is snapshotted (states that cannot be rebuilt: plan mix, credit positions, gifted, bought and outstanding credits) and what is not (flows rebuilt from dated rows); rules HS-W-1 to HS-W-11 (daily at 00:07 UTC for the day just ended, late runs write nothing, key `(as_of_date, metric, dimension)` with `ON CONFLICT DO NOTHING`, only exact figures, no gap filling, the page's own functions, no account and no money); the metric list; migration `20261074` (`business_os_finance_snapshots`, RLS on, no policy, service-role SELECT and five-column INSERT, refusing rollback) with checks 31 and 32 and a local self-test; the `finance-snapshot` job HS-FR-1 to HS-FR-8; the History block HS-FR-9 to HS-FR-16 on its own admin route; checks 33 and 34; guards; AC-273 to AC-294; L-155 to L-162; SA-Q100 to SA-Q107; estimate about 3.5 days, split 8.1 / 8.2 / 8.3 (8.1 stops for the user's production apply). §0.1 slice 8 row, §9 slice 8 row, ToC, §0.2 log; §0.4 gains BQ-17, BQ-18, BQ-19 and DF-9. No code changed. |
| 2026-10-17 | SA requirement review, slice 8 (§11M): **APPROVED WITH CONDITIONS** | New section "SA Requirement Review — Slice 8 (§11M) — 2026-10-17" after §11M.13. §0.3 row SA-RR-8. Findings S8-F1 (History fetched on demand, AC-173 one-fetch pin) to S8-F4; BA edits E-85 to E-88. Migration number, house style, columns, cron pattern, descriptors and checks 31 to 34 verified. No code changed. |
| 2026-10-17 | BA: SA-RR-8 edits E-85 to E-88 applied (§11M) | E-85 the History block opens closed and sends its request only on "Show history", so AC-173 and the one-fetch render tests keep one request per load (HS-FR-11, AC-290, L-159); E-86 the dimension CHECK admits `tier:` keys with hyphens (`^([a-z][a-z0-9_]{0,47}\|tier:[a-z0-9_-]{1,40})$`), pinned equal to a builder shape constant that pre-checks rows so a bad key skips only the `plan` family (§11M.6, HS-W-5, self-test, AC-276, AC-282, new check 32 row); E-87 the job gives the credit pass a 30 s night budget (HS-FR-8, AC-282, L-157); E-88 the writer uses upsert with ignoreDuplicates and `.select(id)`, written = ids returned (HS-FR-5, AC-276, AC-281). SA-Q104 CHECK expression written in. §0.1 slice 8 row: SA approved, ready for Dev workplan (8.1). No code changed. |
| 2026-10-17 | SA workplan review, slice 8.1 (§11M): **APPROVED WITH CONDITIONS** | §0.3 row SA-WR-8.1. SA applied E-89 (NOTIFY pgrst in the §11M.6 order), E-90 (the pure shape module in 8.1), E-91 (migration renumbered 20261074 to 20261078 across §11M, the §0.1 row and the §9 row; numbering note), E-92 (§11M.10 rows: count pins recomputed from main, cleanup function needs no version) and E-93 (check 32 tier row is an exact pattern match). No code changed. |
| 2026-10-17 | SA code review, slice 8.1 (§11M): **Code Approved** | §0.3 row SA-CR-8.1. D-1 to D-3 approved. The remaining scoped tsc TS2353 is reproduced on origin/main (DE-7 adf9e37f), outside scope. Merge rule MR-1: the second of #447 and 8.1 to merge recounts to 158 / 120. No code changed by SA. |
| 2026-10-17 | RM: slice 8.1 committed, PR #452 opened, auto-merge OFF | Commit `0439f94f` on `feature/bos-finance-health-8`; origin/main (`e5bc1e1f`) had not moved, so no merge was needed. #447 still open, so MR-1 did not apply (counts stay as committed). `20261078` free on main and every remote branch. Re-run: finance UI and lib, purge, data-export, test-account-cleanup and the migration test, 57 suites, 2999 tests, all passed. Seven frozen pins unchanged. Merge held for the user's production apply (L-155). §0.1 row 8: status and PR columns. |
| 2026-10-17 | SA workplan review, slice 8.2 (§11M): **APPROVED WITH CONDITIONS** | §0.3 row SA-WR-8.2. SA applied E-94 (HS-FR-8a: the wiring picks from financeHealthDeps, amending SA-Q105; exported walkPlans and payingSetOf), E-95 (§11M.5 bought_outstanding through the shared outstandingBySource), E-96 and E-97 (HS-FR-8b: missing table means 503 with no reads; injectable clock; no Run now). No code changed. |
| 2026-10-17 | SA code review, slice 8.2 (§11M): **Code Approved** | §0.3 row SA-CR-8.2. D-1 to D-5 approved. RM sets addedOn to the UTC date of the first 00:07 run after the production deploy. The qa-slice5-pr2 flake is unrelated (task_d3dcf2de). No code changed by SA. |
| 2026-10-17 | SA workplan review, slice 4b.2 (§11I): **APPROVED WITH CONDITIONS** | §0.3 row SA-WR-4b2. SA applied E-102 (FR-4B-10: K-5 also moves on an open dispute; follows BD-17 and FR-4B-5, no BQ), E-103 (§11I.8 Pin B row and FR-4B-15: optional wire fields) and E-104 (FR-4B-15: heldNow per-currency list). No code changed. |
| 2026-10-17 | SA code review, slice 4b.2 (§11I): **Code Approved with conditions** | §0.3 row SA-CR-4b2. CR-1 Section 6 frame relabel (our boost problems no longer under "not ours"), CR-2 SQL check 19 on the event rule, CR-3 Pin C load re-run. DV-1 to DV-12 ruled. No code changed by SA. |
| 2026-10-17 | RM: slice 4b.2 PR #459 opened, auto-merge on | Commit `81d688e3` on `feature/bos-finance-health-4b2`; after #447 merged (`e5dbfa99`), origin/main (#447, #451 to #458) merged in `ba6772c8` with no conflicts and no leftover markers. Re-run: finance, finance route, repositories, data-export and purge jest 172 suites / 5878 tests; test:bos-entitlements 287 / 8692; test:authz-guard 2 / 203; all passed. AC-145 at the ruled hash `39b35743…56ea`, other six pins unchanged. §0.1 row 4: status and PR columns. |
| 2026-10-17 | SA workplan review, slice 8.3 (§11M): **APPROVED WITH CONDITIONS** | §0.3 row SA-WR-8.3. SA applied E-98 (HS-FR-10: separate read-only snapshot repository), E-99 (HS-FR-9: server-built view), E-100 (HS-FR-16: not_installed notice, statusChip) and E-101 (HS-FR-12 copy). No code changed. |
| 2026-10-17 | SA code review, slice 8.3 (§11M): **Fix Required** | §0.3 row SA-CR-8.3. C-1 (High): the history range read is cut at PostgREST max-rows 1,000; page it in 1,000-row pages up to the 5,000 ceiling. D-1 to D-3 approved. No code changed by SA. |
| 2026-10-17 | SA re-check, slice 8.3 C-1 | SA-CR-8.3 now **Code Approved**: listSnapshotsInRange pages at 1,000 rows, stops on a short page, errors past 5,000; tests pass (29). |
| 2026-10-18 | Migrations applied to production (session, at the user's request) | #447: check 23 (8/9; cleanup row read the 20261047 version, DE-8a 20261075 never applied and superseded by 20261077), then `20261076` (transition body md5 `018c4447f2b52dd87e4ae3b229e5b42c` verified) and `20261077` (cleanup body md5 `42ae104365dce86933e99da3c62aaabc` = file), check 24 23/23; #447 MERGED. #452: check 31 6/6, then `20261078`, check 32 16/16. MR-1 applied in #452 (second to merge): classification 158 = 38 + 0 + 120, baseline 158. **20261075 must not be applied any more** (it would downgrade the cleanup) |
| 2026-10-18 | RM: slice 8.2 PR #460 opened, auto-merge on | Commit `9bb0395c`; after #452 merged (`9616315d`, `20261078` live), origin/main merged in `2043dffb` keeping both sides: data-export stays the 18th cron, finance-snapshot the 19th (count pins 18 to 19), both Change History rows kept, classification pins main's 158/120. `addedOn` set to 2026-10-19 (`6225e6e5`, SA D-3). Re-run: finance, repositories, cron and jobs jest 158 / 5502; Jobs & queues 15 suites, 624 / 625 (known qa-slice5-pr2 flake, task_d3dcf2de, passes alone); test:authz-guard 2 / 203; test:bos-entitlements 289 / 8706. §0.1 row 8: status and PR columns. |
| 2026-10-18 | RM: slice 8.3 PR #461 opened, auto-merge on | Commit `3209bda9`; after #460 merged (`587d3812`), origin/main merged in `bf5d93ee` keeping both sides (FinanceView: History block plus main's PaymentProblemsSection accountId; financePage.render.test.tsx: 8.3 and 4b.2 blocks; slice 8 row and Change History). 8.2 files are main's. Re-run: finance, finance route, repositories and admin components jest 175 / 6183; pins and vocabulary guard 6 / 273; test:authz-guard 2 / 203; test:bos-entitlements 290 / 8752. Seven pin hashes unchanged; AC-145 at `39b35743…56ea` (4b.2). §0.1 row 8: status and PR columns. |
| 2026-10-18 | RM: follow-ups FF-1b to FF-1d committed, PR #463 opened, auto-merge on | Commit `0a50f14a` on `feature/bos-finance-followups` (from main `f7429b57`, which had not moved). FF-1b: check 32 exact-pattern row for the metric CHECK (QA-81-N1). FF-1c: checks 33 and 34 extracted to `scripts/check-bos-finance-history-days.sql` and `scripts/check-bos-finance-history-newest.sql`. FF-1d: `rangeCap.source.guard.test.ts` against one-shot reads above PostgREST's 1,000-row cap, allow-list pinned at 14 files / 20 entries (FF-3 burn-down, can only shrink). FF-1a (Exchange rates read-only) held for BQ-20, not included. Latent B-1 (BizQL truncation) and B-2 (purge preview and snapshot under-read) handed to separate tasks. No migration. SA-CR-FF1 approved, QA passed (QA-FF1-1 fixed), TL approved. Re-run: repositories, finance, migrations and scripts jest 188 / 7502. [Retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_FOLLOWUPS_FF1_RETROSPECTIVE.md). |
| 2026-10-18 | User decision BQ-20 recorded (BD-36); FF-1a | The user answered BQ-20: make the redundant Exchange rates page read-only. §0.2 gains BD-36 and a log line; §0.4 gains BQ-20 (answered), FU-M8-1 (closed by FF-1a) and FF-2 (write-only database lockdown after check 35; SELECT stays for authenticated). FF-1a implemented uncommitted on `feature/bos-finance-ff1a` (page read-only, guard G-6, check 35). No migration |
| 2026-10-18 | RM: FF-1a committed, PR #465 opened, auto-merge on | Commit `d9fe11f4` on `feature/bos-finance-ff1a` (main `399070d4`, with FF-1 #463, had not moved). Exchange rates page read-only (BD-36), check 35 added, FF-2 recorded; no DB change. SA-CR-FF1a approved, QA passed, TL approved. Re-run: admin tests, exchange-rates, migration source test and range-cap guard, 18 suites / 674 tests. [Retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_FF1A_RETROSPECTIVE.md). |
| 2026-10-18 | User decision BD-37 recorded; Finance R4 | BD-37 (billing status for the current Stripe mode only; revenue keeps both modes, BD-14) in §0.2 with a log line; R4-FU-1 (remove the unwired R-c / R-c′) added to §0.4 as the next Finance follow-up. R4 implemented uncommitted on `fix/bos-finance-r4-billing-mode` (SA-R4 fixes R4-C1 to R4-C3). No migration |
| 2026-10-18 | RM: Finance R4 committed, PR #471 opened, auto-merge on | Commit `7afe71c5` on `fix/bos-finance-r4-billing-mode` (from main `5e9a59f1`); origin/main (`5126beda`, #470) merged in `da560d79` with no conflicts. Billing status reads the current Stripe mode only (BD-37); revenue keeps both modes. Must land before live Stripe keys. No migration; pins unchanged. SA-R4 approved, QA passed, TL approved. Re-run: finance UI, finance lib, finance route, repositories, admin billing and the webhook router-placement guard 158 / 5547; test:authz-guard 203; test:bos-entitlements 8942. R4-FU-1 open. [Retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_R4_RETROSPECTIVE.md). |
| 2026-10-19 | BA: Money area KPI restructure spliced (SA-RR-MK conditions MK-C1 to MK-C4) | The user-approved restructure ([ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md)) is recorded in §0.2 as BD-38 to BD-45 (review C-1 to C-8), BD-46 to BD-49 (Page 1 rules: leading or lagging icon, `$`-only, Paying accounts %, Converted this month), BD-50 to BD-52 (Q-10 to Q-12) and BD-53 / BD-54 (Q-13 / Q-14: keep "AI margin" and "AI cost"), with a log line. §0.1: slice 5 row marks 5b superseded (MRR part by MK-4, the rest becomes MK-9; §11N not built as written); new pointer row MK-0..MK-9. No code changed |
| 2026-10-19 | User decision BD-55 recorded (Exchange rates page maintained again); FF-2 superseded | §0.2 gains **BD-55** (the user's 2026-10-19 message, verbatim) and a log line: the Exchange rates page becomes a maintained admin tool for manual rate entry, amending BD-34 and BD-36 for that page only; the Platform dashboard stays redundant; BD-12 and CUR-3 unchanged (no conversion, nothing in Finance reads a rate). §0.4 FF-2 marked superseded by slice 1b of [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md); cross-linked from the Related header. Applied per SA-R2 of that requirement. No code changed |
| 2026-10-26 | User decision BD-56 recorded (client payments in approximate US dollars) | Slice 0 of [ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md](/docs/requirements/ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md). §0.2 gains **BD-56** and a log line: client payments may be shown as one approximate US-dollar total on the admin Finance page, under that requirement's conditions EX-1 to EX-6; amends BD-12, BD-45, BD-47 and MK USD-2 / USD-5 for that one figure only; BD-1 and BD-50 unchanged; CUR-3 unchanged, slice 1a adds positive pins (SA-RR-CPU SA-Q-2, wording per CPU-7). §0.1 gains a pointer row for the stream (CPU-0 to CPU-1b); cross-linked from the Related header. Docs only, no code changed |
