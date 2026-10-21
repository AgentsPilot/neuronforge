# Admin Cost and Revenue Consolidation Review

> **Last Updated**: 2026-10-17

**Created by:** BA
**Date:** 2026-10-14
**Status:** Draft (discovery and recommendation only). Not reviewed by SA. All ten business questions answered 2026-10-14: the user accepted every proposed default (§9; FIN BD-18 to BD-27). M-1 and M-2 merged as PR #383; M-3 specified in FIN §11E.
**Supersedes:** [ADMIN_AI_COST_PAGES_OVERLAP_REVIEW.md](/docs/requirements/ADMIN_AI_COST_PAGES_OVERLAP_REVIEW.md) (cited as **OV**). OV covered three pages against older code; §2 below re-checks each of its claims.
**Related:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) (cited as **FIN**), [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) (cited as **LAY**), [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) (cited as **PAY**).

## Overview

The user wants one place in admin to understand cost and revenue, including for one account: what the account cost us and what it paid us. Today money is spread over **seven visible places** and **five hidden legacy pages**, and they use **two cost records**, **four default windows** and **three ways to pick a business**. This review lists every admin page, tab and tile that shows money, cost, credits or revenue. It then proposes one **Money area**, built on the existing Finance page, with a **per-account view** (account, then cost against revenue, then margin) assembled almost entirely from pieces that already exist. It also gives a step plan ordered so the per-account view arrives first.

The main finding: **the Finance page can already answer most of "what did this account cost us and what did it pay us"**. With a business picked, it narrows AI cost, credit-boost revenue, credits and the account's plan group to that business (`lib/business-os/finance/financeHealth.ts:15-28`). Three things are missing: plan payment amounts, a margin line, and a readable account name (the chip shows an id fragment). It also never says plainly that the page is now about one account.

All citations are `path:line` in the worktree `neuronforge-ai-cost-overlap` at main `3b300f58`. Nothing was checked in a browser or against the live database.

---

## Table of Contents

1. [Recommendation in one table](#1-recommendation-in-one-table)
2. [Re-check of the earlier overlap review](#2-re-check-of-the-earlier-overlap-review)
3. [Inventory: every admin place that shows money](#3-inventory-every-admin-place-that-shows-money)
4. [Can the Finance page answer one account today?](#4-can-the-finance-page-answer-one-account-today)
5. [Target information architecture: the Money area](#5-target-information-architecture-the-money-area)
6. [The cost-measure question](#6-the-cost-measure-question)
7. [Gaps that block the single view](#7-gaps-that-block-the-single-view)
8. [Step plan](#8-step-plan)
9. [Business questions for the user](#9-business-questions-for-the-user)
10. [Questions for SA](#10-questions-for-sa)
11. [Out of scope](#11-out-of-scope)
12. [Change History](#change-history)

---

## 1. Recommendation in one table

| Existing place | Recommendation | One-line reason |
|---|---|---|
| **Finance** `/admin/finance` | **Keep. It becomes the Money area's home** (Overview + new per-account view) | It already reads the business figures (ledger cost, our revenue, credits) and already narrows to one account |
| **AI cost & usage** `/admin/analytics` | **Move** into the Money area (sidebar only), kept as its own page, relabelled "AI calls & usage (detail)" | A per-call debugging and both-products view; merging it into Finance would mix two cost records |
| **Business OS AI → Costs & credits** tab | **Move** into the Money area as a Finance tab "Charge checks" (later step) | Read-only, ledger-based cost data; today it sits under Settings, where nobody looks for money |
| **Business OS AI → Activity** tab | **Link only** (stays) | One row per AI action is an operations log; the per-account view deep-links into it |
| **Business OS AI → Settings** tab | **Keep as is** | Model settings; a writer is planned (slice 3), so it is a settings page |
| **Health** `/admin` AI-spend tile | **Keep**, relabel "Recorded AI cost", link to the Money area | Health is "is anything wrong", and uncharged spend is what it should catch |
| **Businesses** drawer (credits, top-ups, AI usage) | **Keep, link both ways** to the per-account view | It holds money **actions** (give and take back credits, boost limit, delete): not for a read-only area |
| **Businesses** list "Credits left" column | **Keep as is** | Support needs it while scanning accounts |
| **Plans & entitlements** | **Keep as is** (prices and allowances as configuration); link from Money | It is the catalogue, not money that moved |
| **Model pricing** `/admin/system-config` | **Keep as is**; link from Money's AI cost section | It has edit actions and sets every charge |
| **Scheduled jobs & queues** | **Keep as is** | Drain, cancel, retry and "Reconcile top-ups" are actions |
| **Signup Invites** (paid column, P-5b.2) | **Keep as is** | An invite-operations view; the paid line is a status, not a money report |
| Parked: **Platform dashboard (legacy)** | **Deprecate, then remove** | URL-only, nothing links to it, and its AI cost duplicates AI cost & usage's "All" scope |
| Parked: **Exchange rates** (unlisted) | **Deprecate, then remove** | Never used for any figure (FIN BD-12), and it writes to the database from the browser |
| Parked: **AgentsPilot billing**, **Free tier & onboarding**, **Reward**, **Executions**, **Storage** config | **Leave parked** (no change) | Legacy settings with actions; outside a Business OS money view |
| Parked: **Agent memory dashboard** (memory cost and ROI) | **Leave parked** | Legacy and estimated; flag for the same clean-up decision as the dashboard |
| `/test-business-os` take-credits tab | **Out of scope** | A test harness with a write action, not an admin money view |

---

## 2. Re-check of the earlier overlap review

The admin layout work merged L-8a to L-10 after OV was written (LAY `:63-67`). Several OV claims are now stale.

| OV claim | Now | Evidence |
|---|---|---|
| Costs & credits picks a business with a native `<select>`, not in the URL (OV §2.3) | **Stale.** Shared business picker; `range`, `from`, `to`, `account` are in the URL | `app/admin/business-os-llm/costsFilters.ts:5-7`, `:41-44`; LAY `:65` (L-9a merged, PR #321) |
| Activity filters are not in the URL; it uses the original picker (OV §2.3) | **Stale.** Every filter is in the URL, with the shared picker | LAY `:63` (L-8a merged, PR #319) |
| One page subtitle for all three Business OS AI tabs (OV §2.3) | **Stale.** Each tab has its own purpose line | `app/admin/business-os-llm/page.tsx:50-55` |
| L-8 deletes the original `BusinessAccountPicker` while Finance still imports it (OV §1) | **Changed.** L-8 did not delete it; the deletion moved to Finance's layout-adoption slice. Finance still imports it | LAY `:63` ("NOT deleted in L-8"); `app/admin/finance/components/FinanceFilterBar.tsx:21` |
| Finance shows accounts, AI cost and credits | **Grown.** It now also shows our revenue (credit boosts, 4a), takings through the platform (2a) and client payment problems (2b) | `app/admin/finance/components/FinanceView.tsx:94-103`; `app/admin/finance/financeCopy.ts:15-16` |
| Finance's link to the other measure says "provider-side token measure" and carries no window or business | **Still true** (moved to `:180`) | `financeCopy.ts:178-180`; `AiCostSection.tsx:152-157` |
| Costs & credits says "the provider's measured cost" | **Still true** | `app/admin/business-os-llm/costCopy.ts:9-11` |
| Health tile "Business OS AI spend (USD, estimated)" reads `token_usage` | **Still true** | `lib/admin/health/evaluateHealth.ts:409-412`, `:422` |
| The cut-over notice links to "Cost Analytics" with no window | **Still true** | `app/admin/business-os-llm/components/activity/CutoverNotice.tsx:3-5`, `:22-30` |
| Four places show a Business OS AI cost | **Now six.** OV missed the Businesses drawer: a "Business OS AI, 30 days" strip figure and an "All products" figure, both from `token_usage` | `app/admin/users/components/BusinessSummaryStrip.tsx:80`; `BusinessOsPanel.tsx:212-220`; `AllProductsUsage.tsx:20-23` |

OV's analysis of why the two records differ (OV §4: coverage, cut-over, fallback prices, windows, row limits) still holds, and this review relies on it. OV's slices OV-1 to OV-6 are absorbed into the step plan in §8.

---

## 3. Inventory: every admin place that shows money

"Charged" = the credit ledger (`business_os_credit_charges`): one row per charged AI action. "Recorded" = the usage log (`token_usage`): one row per AI call, charged or not. Revenue layer **A** = owners paying us. Layer **B** = clients paying the businesses (never our revenue, FIN BD-1).

### 3.1 Visible pages (Business OS)

| # | Place | Question it answers and audience | Data and measures | Filters | One account: cost **and** paid? | Product | Read-only? |
|---|---|---|---|---|---|---|---|
| I-1 | **Finance** `/admin/finance` (sidebar `AdminSidebar.tsx:95-101`) | "How is Business OS doing this month" (`financeCopy.ts:14-16`). Owner, commercial | KPI strip K-1 to K-5; **Our revenue** (layer A: credit boosts per currency; plans only as an "amounts later" line, `financeCopy.ts:61-78`); **Takings** (layer B); Accounts by plan; **AI cost, charged** (`AiCostSection.tsx:75-157`); Credits; Client payment problems (`FinanceView.tsx:94-103`) | Today / 7d / 30d / **This month** / Custom up to 92 days; original business picker; URL `preset`, `from`, `to`, `accountId` (`FinanceFilterBar.tsx:21`, `:114-119`) | **Mostly yes.** Charged AI cost, boost revenue, credits and plan group narrow to the account (`financeHealth.ts:15-28`, `:53-59`). Plan payment **amounts** are not shown; the plans line stays platform-wide (`financeCopy.ts:74-78`). No margin | Business OS | Read-only (FIN NG-1) |
| I-2 | **AI cost & usage** `/admin/analytics` (`AdminSidebar.tsx:102-107`) | "What Business OS and agent-platform AI calls cost, by provider, model and feature" (`analytics/page.tsx:48`). Operators and engineers | **Recorded** cost, "estimated from the model pricing table" (`page.tsx:343-351`); 1,000-row cap (`:336-341`) | Rolling 30 days default plus 24h / 90d; scope Business OS or All; shared picker; URL `account` (old `user` still read) | **Cost only** (recorded measure), no revenue | Both | Read-only |
| I-3 | **Business OS AI → Costs & credits** (`AdminSidebar.tsx:170-180`) | "What Business OS actions cost us … and what we charged (credits), per account and billing period" (`costCopy.ts:9-11`). Operator: are charges correct | **Charged** cost per account and **whole billing period** (`costCopy.ts:22-24`); fallback-priced charges; cost spread; **Leak check** compares recorded and charged per business (`leakCopy.ts:11-14`) | 30 days default, 7 / 90, custom; shared picker; URL `account` (`costsFilters.ts:33-44`) | **Cost and credits charged**; no revenue | Business OS | Read-only (the leak check reads only, `leakCopy.ts:12-13`) |
| I-4 | **Business OS AI → Activity** | One row per charged AI action, with its audit entry. Operator, support | **Charged** cost per action | This month default and others; shared picker; URL (LAY `:63`) | Cost per action; no revenue | Business OS | Read-only |
| I-5 | **Business OS AI → Settings** | What each AI call is set to | No money | — | No | Business OS | Read-only today; a writer is planned (`business-os-llm/page.tsx:24-28`) |
| I-6 | **Health** `/admin` tile "Business OS AI spend (USD, estimated)" | "Is anything wrong?" | **Recorded** cost; links to AI cost & usage with its own window (`evaluateHealth.ts:409-412`, `:422`) | Fixed | No | Business OS | Read-only |
| I-7 | **Businesses** list `/admin/users`, "Credits left" column | Which accounts are low | Credit allowance and use (FIN SA-Q7 core) | Status, search | No | Business OS | List read-only |
| I-8 | **Businesses** drawer: summary strip | Plan, credits left, "Business OS AI, 30 days" (`BusinessSummaryStrip.tsx:68-92`) | AI figure is **recorded**, rolling 30 days, "estimated" (`BusinessOsPanel.tsx:212-220`; summary route `accounts/[accountId]/summary/route.ts:56`, `:145-149`) | Fixed 30 days | Cost only (recorded) | Business OS | Read-only |
| I-9 | **Businesses** drawer: Credits & billing | Credits (allowance, used, extra credits, gifts) and Credit top-ups (every boost, amount paid, refunds, disputes, spending limit) (`BusinessOsPanel.tsx:265-290`) | Credit position; boost purchases | None | **Paid (boosts) yes**, cost no | Business OS | **Actions:** Give and Take back credits (`CreditsBlock.tsx:21-24`); Set limit, Back to default, Take back on a purchase (`BoostBlock.tsx:19-30`) |
| I-10 | **Businesses** drawer: AI usage | Business OS 30-day recorded cost by area, failures, "All products" token figures (`BusinessOsPanel.tsx:343-380`; `AllProductsUsage.tsx:20-23`) | **Recorded** (both figures) | Fixed 30 days | Cost only | Both (All products) | Read-only; the drawer also holds the Danger area (`BusinessDetail.tsx:236-285`) |
| I-11 | **Plans & entitlements** `/admin/business-os-tiers` | What each plan includes: name, price, allowance (`PlanCard.tsx:1-3`) | Configuration, not money that moved | Account lookup | No | Business OS | Read-only (PAY plans to add billing tabs here: AM-1, AM-2, AM-3, PAY `:295-297`) |
| I-12 | **Model pricing** `/admin/system-config` (`AdminSidebar.tsx:181-190`) | The price table every charge is computed from | Prices per model | — | No | Business OS (and the usage log's prices) | **Actions:** edit prices; Sync parked (`system-config/page.tsx:3-19`) |
| I-13 | **Scheduled jobs & queues** | Job runs and queues, including the payment reminder queue and boost reconciliation | Counts, no amounts | — | No | Business OS | **Actions:** Drain, cancel, retry (`jobs-queues/page.tsx:3-9`); "Reconcile top-ups now" moved here (`BoostBlock.tsx:27-30`) |
| I-14 | **Signup Invites** | Invite status; P-5b.2 adds a paid line (date, amount in USD) | `business_os_billing_events` | Page-held | Paid at signup only | Business OS | Actions: New invite, Revoke |

### 3.2 Hidden or URL-only pages (legacy agent platform)

The "AgentsPilot (parked)" section is hidden (`AdminSidebar.tsx:199-207`).

| # | Place | Money shown | Actions | Recommendation |
|---|---|---|---|---|
| I-15 | **Platform dashboard (legacy)** `/admin/platform-dashboard` | Token cost totals for the agent platform (`platform-dashboard/page.tsx:53-57`); URL-only, nothing links to it (`:23-33`) | None seen | Deprecate (BQ-7) |
| I-16 | **AgentsPilot billing** `/admin/agentspilot-billing` | Boost packs, grace period, Pilot Credit calculator (`agentspilot-billing/page.tsx:3-18`) | Edit settings | Leave parked |
| I-17 | **Free tier & onboarding**, **Reward config**, **Executions config**, **Storage config** | Agent-platform credit grants, rewards, quotas, storage tiers (`AdminSidebar.tsx:261-299`) | Edit settings | Leave parked |
| I-18 | **Agent memory dashboard** `/admin/learning-system` | "memoryCost" and "estimatedSavings" (`learning-system/page.tsx:34-35`); reads Supabase from the browser (`:7`) | — | Leave parked; same clean-up decision as I-15 |
| I-19 | **Exchange rates** `/admin/exchange-rates` (not in the sidebar, `AdminSidebar.tsx:76-77`) | Currency rates to USD; writes from the browser (`exchange-rates/page.tsx:20-21`) | Edit rates | Deprecate (BQ-7). FIN BD-12 forbids its use for any figure |
| I-20 | **AI cost & usage, "All" scope** | Agent-platform AI cost | — | Keep (OV BQ-1 default) |

---

## 4. Can the Finance page answer one account today?

The user is testing this now. Here is what a picked business shows today, section by section.

| Question for one account | Shown today? | Where | Note |
|---|---|---|---|
| Which plan group is it in, and is it paying? | Yes | Accounts by plan narrows to one row, Total 1 (FIN S1-FR-9) | A paying Founding Partner shows its tier, with a chip (BD-15) |
| What did its AI cost us (charged)? | **Yes** | AI cost section: total USD, credits, actions, by trigger (`AiCostSection.tsx:80-128`) | The window is the page window. Before 29 Sep 2026 there is no ledger (cut-over notice) |
| What did it pay us for credit boosts? | **Yes** | Our revenue, "Credit boosts paid, this business" (`financeCopy.ts:63`) | Net includes tax (`financeCopy.ts:91`) |
| What did it pay us for its plan? | **No** | The plans line covers all businesses even when one is picked, and shows no amount (`financeCopy.ts:74-78`) | The data exists since P-3b (PAY `:346`); Finance only counts rows (R-d) |
| Credits used against allowance, gifts outstanding | Yes | Credits section, one row | — |
| Cost against revenue (margin) | **No** | — | FIN slice 6, blocked on slices 4 and 5 |
| AI cost it caused that was never charged | No | Only on AI cost & usage (filter by account) or the Leak check (7 days at most) | SA-Q4 kept `token_usage` off Finance |
| What its clients paid it (layer B) | Yes, but it is the business's money | Takings section | Must never be read as our revenue (BD-1) |
| **Which account am I looking at?** | **Poorly** | The chip shows "Business: 1a2b3c4d…" (`FinanceFilterBar.tsx:128-131`) | The original picker shows no name after a reload; the shared picker shows "Business: {name}" (LAY `:52`) |
| Can I get here from the account itself? | **No** | The Businesses drawer links to AI cost & usage (`BusinessOsPanel.tsx:374-379`), not to Finance | — |

**Verdict:** the per-account view is close: one screen already holds four of the six answers. The gaps are plan payment amounts, a margin line, a clear account header, and a way in from the Businesses drawer.

---

## 5. Target information architecture: the Money area

### 5.1 Shape

One sidebar section, **Money**, placed after Monitor. It holds the pages that **report** money, and no page whose main job is an action.

| Money area entry | Route | Sections | Reuses |
|---|---|---|---|
| **Finance: Overview** (default tab) | `/admin/finance` | Today's page, unchanged in content: KPI strip, Our revenue (boosts, then plans), Takings (not ours), Accounts by plan, AI cost (charged), Credits, Client payment problems | Everything in `app/admin/finance/**` and `lib/business-os/finance/**` |
| **Finance: Accounts** (new tab) | `/admin/finance?view=accounts` | **Account economics table**: one row per account with plan group, charged AI cost, our revenue (boosts + plans) per currency, AI margin (USD only), credits used %; sorted by margin or cost; a row opens the per-account view | The same reads Finance already runs (R-a ledger rows already grouped by `user_id` for the top 10, `AiCostSection.tsx:130-143`; R-k boost rows; the credit-positions pass) plus the plan-payment read from step M-2 |
| **Finance: one account** (Overview with a business picked) | `/admin/finance?accountId=…` | An **account header** (name, plan, paying or not, since when) and an **account summary** block above the sections: charged AI cost, what it paid us (boosts, plans), AI margin, credits position, and links that carry the window and the account to Activity, Charge checks, AI calls & usage, and the Businesses drawer | Today's account-scoped reads (`financeHealth.ts:15-28`); the shared `AdminBusinessPicker` and its chip |
| **Finance: Charge checks** (later step) | `/admin/finance/charges` | Today's Costs & credits tab: per billing period checks, fallback prices, cost spread, Leak check | `components/costs/CostsTab.tsx` and `LeakCheckPanel.tsx`, mounted on a new route as they are |
| **AI calls & usage (detail)** | `/admin/analytics` (unchanged URL) | Today's page: per-call cost, both products | Unchanged; only its sidebar position and label move |

Pages that stay outside, linked from Money: **Businesses** (credit and boost actions), **Business OS AI** (Settings and Activity), **Plans & entitlements**, **Model pricing**, **Scheduled jobs & queues**, **Health**.

### 5.2 The per-account view, in detail

Built from existing pieces. The only new data is plan payment amounts (M-2).

| Line | Value | Source | Exists today? |
|---|---|---|---|
| Account | Business name, owner, plan group, paying since | Shared picker name; R-c′ billing row; plan row | Name: no (chip shows an id). Plan group: yes |
| AI cost, charged | USD in the window | R-a account-scoped (`listRowsForAccountCreatedInRange`) | **Yes** |
| AI cost, recorded but not charged | USD, labelled, never added | Leak check, or a `token_usage` summary read (OV-5) | No (later step) |
| Paid us: credit boosts | Net per currency | R-k′ | **Yes** |
| Paid us: plan | Paid invoices in the window, per currency | `business_os_billing_events` `invoice_paid` (FIN §8.2) | **No** (M-2) |
| **AI margin** | Our revenue (excluding tax, BQ-3) minus charged AI cost, **USD only**; any other currency shown "not comparable" | Composition of the lines above (FIN BD-7) | No (M-3) |
| Credits | Allowance, used, % used, gifts outstanding | Credit-positions pass | **Yes** |
| Their clients paid them | Per currency, labelled "not our revenue" | Takings | Yes |

### 5.3 Rules the area keeps

| Rule | Source |
|---|---|
| Never sum across currencies; margin is computed only where revenue and cost share a currency (USD) | CLAUDE.md Currency rules; FIN BD-12 |
| Layer B (takings) never shares a total, tile or margin with layer A | FIN BD-1 |
| Charged and recorded cost are never added together | FIN SA-Q4 |
| Read-only: no action moves into the area | FIN NG-1 |
| One window and one business picker for every section, both in the URL | LAY §5; FIN L-4 |

---

## 6. The cost-measure question

| | **Charged AI cost** (credit ledger) | **Recorded AI cost** (usage log) |
|---|---|---|
| What it counts | Each charged Business OS AI action, with corrections | Every AI call, charged or not, both products |
| Starts | Charging cut-over, 29 Sep 2026 | Much earlier |
| Includes | Fallback-priced charges (a deliberate over-estimate) | Platform-account calls, calls outside an action, failed charge writes, chat v1 parser |
| Is it the business figure? | **Yes.** It matches the credits we charged, and margin is defined on it (FIN BD-7, `:74`; `:406`) | No. It is the **operations** figure: waste, uncharged spend, history before charging, the agent platform |
| Where it lives | Finance (Overview, Accounts, one account), Charge checks, Activity | AI calls & usage, Health tile, Businesses drawer AI usage, and beside the charged figure on Finance as "not charged" (later) |

Both figures are priced from the same price table (OV §4, pending SA-1), so "measured" against "estimated" is the wrong contrast. The labels become **"Charged AI cost"** and **"Recorded AI cost"** everywhere (OV-1 wording, OV §5). The places to fix: `financeCopy.ts:164-165`, `:178-180`; `costCopy.ts:9-11`; `analytics/page.tsx:343-351`; `evaluateHealth.ts:422`; `BusinessOsPanel.tsx:218`, `:344`; `CutoverNotice.tsx:3-5` and its copy.

---

## 7. Gaps that block the single view

| # | Gap | Blocks | Possible today? | Fix |
|---|---|---|---|---|
| G-1 | **Plan payment amounts** are not read. Finance only counts plan rows (R-d), platform-wide | Plan revenue overall and per account; margin | **The data is there**: P-3b writes `invoice_paid` events (PAY `:346`, complete 2026-10-11). Only the read and the display are missing | M-2: a "plan payments received" read, all accounts and one account. FIN slice 5 waits on P-8a only for **MRR**, not for cash received (SA-Q-1) |
| G-2 | Per-account AI cost | Per-account view | **Yes.** The ledger is keyed on `user_id`, which is the account (one login = one business), and Finance already narrows it | None. Deleted accounts stay in their own bucket |
| G-3 | Per-account boost revenue | Per-account view | **Yes** (4a, R-k′) | None |
| G-4 | **Margin**, overall and per account | The "cost against revenue" answer | No | M-3. FIN slice 6 needed slices 4 and 5: 4a covers boosts, and M-2 covers plan cash |
| G-5 | **Account name** in the picked view | Knowing which account you are looking at | No (id fragment, `FinanceFilterBar.tsx:128-131`) | M-1: the shared `AdminBusinessPicker` (same as OV-2 and FIN DF-4). This also lets the old picker be deleted (LAY `:63`) |
| G-6 | **All-accounts economics table** | Comparing accounts | Partly (top 10 by cost only) | M-3 |
| G-7 | Recorded-but-uncharged cost on Finance | The full cost of an account | No (SA-Q4) | M-4 (OV-5): shown beside the charged figure, never added |
| G-8 | **Windows differ**: Finance This month, Analytics rolling 30 days, Costs whole billing periods, Businesses drawer fixed 30 days | Comparing figures between pages | — | Links carry the window (OV-2); labels say which rule applies |
| G-9 | A **lifetime** view for one account is not possible (Custom is capped at 92 days) | "What has this account cost and paid since it joined" | No | BQ-9: a "Since charging began" choice for a picked account only |
| G-10 | No **Stripe fee** recorded for our revenue | True net margin | No | Shown as a labelled estimate (BD-7), unchanged |
| G-11 | Boost refunds and disputes count in the purchase month | Month accuracy | — | DF-5, unchanged |
| G-12 | Plan at the time of a charge is not stored | Margin per plan over time | — | BD-8 note, unchanged |
| G-13 | No link from the Businesses drawer to the per-account money view | Getting to the answer from the account | No | M-1 |

---

## 8. Step plan

Ordered so the per-account view comes first. Each step takes a few days and reuses what exists. "Short path" = UI-only (CLAUDE.md team flow); "full cycle" = new read or money logic.

| Step | Title | Scope | Path, size | Depends on |
|---|---|---|---|---|
| **M-1** | **One account, one screen** | Finance swaps to the shared `AdminBusinessPicker` (OV-2 picker half), so the chip names the business. With a business picked: an account header and an **account summary** block above the sections, built only from figures already in the payload (charged AI cost, boost revenue, credits, plan group). Links carry window and account to Activity, Costs & credits, AI cost & usage and the Businesses drawer. The Businesses drawer gains "Open money view" (`/admin/finance?accountId=…&preset=this_month`). The original `audit-trail/BusinessAccountPicker.tsx` is deleted once nothing imports it | Short path; about 2 days. No new read | None. **Pause FIN 4b during M-1 to M-3**: 4b edits the same files (`RevenuePanel`, `CreditsSection`, the K-5 tile) |
| **M-2** | **Plan payments received** (FIN slice 5 split: **5a**) | A read of `invoice_paid` billing events in the window, all accounts and one account, per currency, net of tax shown separately. Our revenue shows plans beside boosts, K-5 includes them, and the plans line is no longer platform-wide in the picked view. No MRR | Full cycle; about 2.5 days. A new read in `BusinessOsFinanceReadRepository`, no migration (to confirm, SA-Q-1) | M-1 (layout of the block). SA rules that 5a does not need P-8a |
| **M-3** | **Account economics and AI margin** (FIN slice 6, early) | The **Accounts** tab (§5.1) and the margin line in the account summary. Margin = our revenue excluding tax (BQ-3) minus charged AI cost, USD only, labelled "AI margin", with "Stripe fees not deducted" | Full cycle; about 3 days. Groups rows Finance already reads; no new table | M-2 |
| **M-4** | **Two measures, one vocabulary** (OV-1 + OV-5) | The §6 labels on every page; Finance shows "Recorded, not charged" beside the charged figure for the window and for one account, never added | OV-1 copy: short path, about 1 day (it can run any time, alone). OV-5: full cycle, about 2 days. **In progress (2026-10-15): specified in FIN §11F, awaiting SA review** | M-3 for OV-5 |
| **M-5** | **The Money section** | The sidebar gains "Money" holding Finance and AI calls & usage (relabelled); Costs & credits mounts at `/admin/finance/charges` and leaves the Business OS AI tabs; the Business OS AI sidebar description drops "costs" | Short path, about 2 days; **needs user sign-off** (the layout stream treats the sidebar as fixed, LAY `:12`); sign-off given 2026-10-14 by accepting BQ-1 and BQ-6. **PR open (2026-10-17): [#444](https://github.com/AgentsPilot/neuronforge/pull/444), auto-merge on; commit `1c7b7554`; FIN §11H** | M-1. BQ-1, BQ-6 |
| **M-6** | **Finance shell on the layout standard** (FIN DF-4, rest) | Shared header, KPI strip (with its cross-page link mode, LAY `:54`) and URL names `range` / `account`, keeping `preset` / `accountId` as aliases | Full cycle (it builds the deferred cross-page tile mode); about 2 days. **In progress (2026-10-15) via F-2/F-4/F-5**, specified in FIN §11G | M-1 (picker already done) |
| **M-7** | **Resume FIN 4b, then 5b and 7** | 4b boost problems and bought credits; 5b MRR after PAY P-8a; 7 platform payment problems after PAY P-6a/P-6b/P-8b | As already specified in FIN | M-3 |
| **M-8** | **Legacy clean-up** | **Changed 2026-10-16 (FIN BD-34): do not delete** Platform dashboard and Exchange rates. Mark both redundant with code comments, and stop using or linking them; the routes stay (BQ-7 as amended) | Short; about 1 day. Third in the FIN BD-32 order (after M-5 and FIN 4b). **PR open (2026-10-17): [#448](https://github.com/AgentsPilot/neuronforge/pull/448), auto-merge on; commit `92ef1454`; FIN §11J; workplan [BUSINESS_OS_FINANCE_HEALTH_M8_REDUNDANT_PAGES_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_M8_REDUNDANT_PAGES_WORKPLAN.md)** | User decision (given) |

**How this fits the other streams.**

| Stream | Interaction |
|---|---|
| Layout rollout | All page slices are merged except L-11 Model pricing (skipped, waits on the price review) and L-12 (PR open) (LAY `:68-69`). Neither touches Finance. M-1 does the picker swap the layout stream left to Finance (LAY `:63`), and M-6 is FIN DF-4 |
| FIN 4b | Paused until M-3 merges, because it edits the same files. Not cancelled |
| FIN 5 | Split: **5a** = M-2 (cash received, now); **5b** = MRR, after PAY P-8a |
| FIN 6 | Delivered early as M-3 for boosts and plan cash; the per-plan margin (BD-8) is added when 5b lands |
| OV-2 | Its picker half is in M-1; its link half (window carried to Analytics) is in M-1's links |
| PAY P-8a | Plans AM-1 to AM-3 on Plans & entitlements (PAY `:295-297`). BQ-5 proposes MRR and the subscriptions list in the Money area, and the per-account billing panel in the Businesses drawer |

---

## 9. Business questions for the user

**Answered 2026-10-14:** the user accepted the proposed default for every question, exactly as written. They are recorded in FIN §0.2 as BD-18 to BD-27.

| # | Question | Proposed default | Why | Answer |
|---|---|---|---|---|
| **BQ-1** | Should admin get one "Money" section in the sidebar, holding Finance (overview, accounts, one account) and the detailed AI calls page? | **Yes.** Finance stays the first page; nothing with buttons moves in | One place to look, without mixing reports and actions | Accepted default, 2026-10-14 (FIN BD-21) |
| **BQ-2** | When we talk about "our AI cost" for prices and margin, which number is it? | **The charged cost** (what we billed in credits). The recorded cost is shown beside it as "not charged", never added | It matches the credits we charged; the gap is waste to chase, not a different truth | Accepted default, 2026-10-14 (FIN BD-18) |
| **BQ-3** | Is an account's revenue counted **before or after tax** when we work out margin? | **After removing tax**, net of refunds and disputes. Stripe fees are not deducted (not recorded) and are said so | Tax is collected for the government, not earned. Today's boost "net" includes tax (`financeCopy.ts:91`) | Accepted default, 2026-10-14 (FIN BD-22) |
| **BQ-4** | For plans, should Finance show the money actually received in the month first, and monthly recurring revenue later? | **Yes: cash received now, MRR when the billing panel (P-8a) defines it** | Cash received can be shown now; MRR needs a definition that P-8a owns | Accepted default, 2026-10-14 (FIN BD-19) |
| **BQ-5** | The planned billing views (P-8a): where should they go? | **Totals, MRR and the subscriptions list in the Money area; the per-account billing panel in the Businesses drawer**, beside credits, linked from the per-account money view | The drawer is where support acts on an account; the Money area is where you read results | Accepted default, 2026-10-14 (FIN BD-23) |
| **BQ-6** | Should "Costs & credits" move out of the Business OS AI settings page into the Money area (as "Charge checks")? | **Yes, after the per-account view is done** | It is a money report; under Settings nobody looks for it | Accepted default, 2026-10-14 (FIN BD-24) |
| **BQ-7** | May we retire the hidden **Platform dashboard** and the unlisted **Exchange rates** page? The agent platform's AI cost stays visible in AI calls & usage | **Yes, retire both**; keep the "All products" view | Neither feeds any figure; Exchange rates writes from the browser, a security exposure | Accepted default, 2026-10-14 (FIN BD-25) |
| **BQ-8** | Test payments are counted as real (your decisions BD-13, BD-14). Should the per-account view say "includes test payments"? | **No label for now**, as decided; revisit at go-live (DF-3) | Consistent with your earlier decisions | Accepted default, 2026-10-14 (FIN BD-20) |
| **BQ-9** | For **one account**, do you want a "since it started" view, beyond 92 days? | **Yes, only when one account is picked**, starting from 29 Sep 2026 (when charging began) | One account's history is small, and "has this customer been worth it?" is a lifetime question | Accepted default, 2026-10-14 (FIN BD-26; built later, FIN DF-6) |
| **BQ-10** | The Health tile counts every recorded AI call, while Finance counts charged actions. Keep that? | **Keep**, rename it "Recorded AI cost", link to the Money area | Health's job is to catch spend that was never charged | Accepted default, 2026-10-14 (FIN BD-27) |

---

## 10. Questions for SA

| # | Question | BA's suggested answer |
|---|---|---|
| SA-Q-1 | Can FIN slice 5 be split, so that "plan payments received" (cash, `invoice_paid` events) ships before P-8a's MRR definition? | Yes. Cash received needs no MRR rule; P-5a already stamps `first_paid_at` |
| SA-Q-2 | Is M-1 a short-path UI slice? It adds a summary block that only re-arranges figures already in the payload, plus links and the picker swap | Yes, provided no figure is computed on the client beyond formatting |
| SA-Q-3 | M-3 margin: compute on the server in `lib/business-os/finance/`, per currency, from the existing rows? | Yes, a pure builder beside `boostRevenue.ts`, with the CUR-1 helper |
| SA-Q-4 | M-5: is mounting `CostsTab` on a new Finance route a new pattern, given the tab coordination built in L-9a (`business-os-llm/page.tsx:82-93`)? | No; on its own route the tab needs no coordination. Confirm its `useAdminFilters` default `active` works standalone |
| SA-Q-5 | OV SA-1: confirm both cost records are priced from the same table, so the labels "charged" and "recorded" are accurate | Yes (OV §4) |
| SA-Q-6 | BQ-9 lifetime window for one account: raise the 92-day cap for account-scoped reads only? | Yes, bounded below by the cut-over; the ledger per account is small |

---

## 11. Out of scope

- Any change to how AI calls are recorded or charged, or to the leak check.
- Any money action (refunds, plan changes, credit grants) inside the Money area.
- The analytics 1,000-row cap (parked by the user).
- Owner-facing money views.
- Editing FIN, LAY or PAY: the TL records pointers there once the user decides.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created | BA discovery and recommendation: re-check of OV against main `3b300f58` (six AI cost places, not four; Costs and Activity now in the URL with the shared picker; the old picker's deletion moved to Finance). Inventory I-1 to I-20 across both products. Finding: Finance already answers most of the per-account question. Target Money area with per-account view and account economics tab. Gaps G-1 to G-13. Steps M-1 to M-8. BQ-1 to BQ-10, SA-Q-1 to SA-Q-6 |
| 2026-10-14 | Business questions answered (BA) | The user accepted the proposed default for all ten questions. §9 gains an Answer column; each is recorded in FIN §0.2 (BQ-2, BQ-4, BQ-8 as BD-18 to BD-20 with M-1 and M-2; the other seven as BD-21 to BD-27). Status line updated: M-1 and M-2 merged (#383), M-3 specified in FIN §11E. Body otherwise unchanged |
| 2026-10-16 | M-5 in progress; M-8 changed (BA) | §8 M-5 row: in progress, specified in FIN §11H, sign-off recorded as given by BQ-1 and BQ-6. §8 M-8 row: no deletion; the two pages are marked redundant in code comments and unlinked (FIN BD-34). Body otherwise unchanged |
| 2026-10-17 | M-8 in progress (BA) | §8 M-8 row: in progress, specified in FIN §11J (both pages and the dashboard's API route marked REDUNDANT in comments, the dashboard's hidden sidebar item removed, routes kept with a notice, no deletion; FIN BD-34). Body otherwise unchanged |
