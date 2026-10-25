# Admin Money Area: KPI Restructure Review

> **Last Updated**: 2026-10-19

**Created by:** BA
**Date:** 2026-10-18
**Status:** **APPROVED by the user, 2026-10-19.** Page 1 (Finance) and Page 2 (AI cost) are both approved, and Q-1 to Q-12 are answered at their defaults (§10). **Q-13 and Q-14 (terminology, §14) are answered: keep the current names** (user, 2026-10-19). **SA approved with conditions, conditions applied; ready for MK-0 workplan** (SA-RR-MK, 2026-10-19; MK-C1 to MK-C4 applied by BA, decisions recorded in FIN as BD-38 to BD-54). No code exists.
**Related:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) (cited as **FIN**; decisions BD-n, KPIs K-1 to K-7), [ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md](/docs/requirements/ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md) (cited as **CR**), [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) (cited as **PAY**; P-8a, AM-2, AM-3, PF-15), [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) (cited as **LAY**).
**Mockups (reference only, sample data, no real figure):** Page 1 [mockups/ADMIN_FINANCE_PAGE1_MOCKUP.html](/docs/requirements/mockups/ADMIN_FINANCE_PAGE1_MOCKUP.html); Page 2 [mockups/ADMIN_AI_COST_PAGE2_MOCKUP.html](/docs/requirements/mockups/ADMIN_AI_COST_PAGE2_MOCKUP.html).

## Overview

The admin **Money** area has four pages today: Finance, Subscriptions, Charge checks and AI calls & usage (detail). The user's rule for the area is: *"every block that we present and we believe has value, should have a representing KPI that i understand what i want to track."* This review checks every block on the four pages against that rule. The user approved the result, **two pages**:

- **Finance**, with three tabs: Overview, Accounts, Plans & subscriptions. It covers money in, AI margin and customers.
- **AI cost**, with two tabs: Summary & checks, Calls. It covers what AI costs us and whether we charged for it.

On each page, a KPI strip of at most five tiles sits at the top. Each tile opens the breakdown it summarises, and a side drawer gives the deeper dive for one business, one plan, one billing period or one AI call.

Every KPI has a leading or lagging icon that explains it on hover. Every amount is in US dollars, shown with `$`.

This review also does three more things:

- It explains why Finance and Charge checks show different AI cost figures today, and how to make them agree (§2).
- It records what to keep in mind now for the other operating costs (hosting, tools) that will be tracked later, without building any of it (§13).
- It evaluates the cost and margin terminology (§14).

The coordinator suggested a two-page direction, and this review tested it. The two-page shape holds up, but three parts were changed:

1. Client payments ("takings") become one clearly named block with its own KPI, at the bottom of Overview, not a tab.
2. The KPI strip is re-cut, so that every tile has exactly one breakdown.
3. The AI cost page's main tile uses the same window as Finance, so the two pages show the same charged figure.

---

## Table of Contents

1. [The answer in one table](#1-the-answer-in-one-table)
2. [Why the two AI cost figures differ today](#2-why-the-two-ai-cost-figures-differ-today)
3. [Page 1: Finance](#3-page-1-finance)
4. [Page 2: AI cost](#4-page-2-ai-cost)
5. [KPI definitions](#5-kpi-definitions)
6. [What is removed or merged, and why](#6-what-is-removed-or-merged-and-why)
7. [Decisions this changes](#7-decisions-this-changes)
8. [Decisions kept as they are](#8-decisions-kept-as-they-are)
9. [Where pending slice 5b fits](#9-where-pending-slice-5b-fits)
10. [Questions for the user and their answers](#10-questions-for-the-user-and-their-answers)
11. [Questions for SA](#11-questions-for-sa)
12. [Effort and slice order](#12-effort-and-slice-order)
13. [Future: other operating costs (not in scope)](#13-future-other-operating-costs-not-in-scope)
14. [Terminology: OPEX, cost of revenue and margins](#14-terminology-opex-cost-of-revenue-and-margins)
15. [Out of scope](#15-out-of-scope)
16. [Change History](#change-history)

---

## 1. The answer in one table

| The user's concern | Answer in this proposal |
|---|---|
| Four pages is too many | Two pages: **Finance** and **AI cost**. Subscriptions becomes a Finance tab. Charge checks and AI calls & usage become the two tabs of AI cost |
| Revenue vs MRR should not be two places | One **Revenue** breakdown on Finance Overview shows both: "received in the window" (cash) and "recurring now" (MRR). Each has its own tile |
| "Takings through the platform" is unclear and has no KPI | Renamed **"Client payments (the businesses' money, not ours)"**. Its KPI is **Businesses taking client payments**, a count, so no currencies are mixed. It merges with client payment problems into one block at the bottom of Overview |
| Accounts by plan and Subscriptions overlap | Both go on one tab, **Plans & subscriptions**: the plan mix (every account) on top, the paying subscriptions list below, and one KPI for each |
| AI cost differs between Finance and Charge checks, unexplained | Traced in §2: a different window, a different scope (whole billing periods), and deleted accounts. Fix: the AI cost tile uses the same window as Finance, and the page says in one line why the period table can differ |
| AI calls & usage should probably merge with Charge checks | Yes. They become one **AI cost** page with two tabs and one vocabulary: **Charged** (what we billed in credits) and **Recorded** (every AI call the system logged) |

---

## 2. Why the two AI cost figures differ today

Both pages call their figure "Charged AI cost" and both read the credit ledger, so the user expects them to agree. They do not, for four reasons. Traced in the code at the tip of this worktree.

| # | Difference | Finance | Charge checks | Evidence |
|---|---|---|---|---|
| 1 | **Default window** | **This month** (1 Oct to today, UTC). Tile K-1 is always this month | **Last 30 days** (today minus 29 days to today) | `app/admin/business-os-llm/costsFilters.ts:33` (`COSTS_DEFAULT_WINDOW` = 30d); FIN §7.1 K-1 |
| 2 | **What the window selects** | Charges **created** inside the window | **Whole billing periods.** Every period that started up to 31 days before the window's first day is counted in full, so charges from before the window are included | `lib/business-os/credits/creditReport.ts:17-19` and `:37-42` (read window `[start − 31 days, end)` on `period_start`); `costCopy.ts:27-29` |
| 3 | **Which totals it adds** | Adds the charge rows one by one | Adds the stored **period totals** (the "stored" figure), then checks them against the rows | `creditReport.ts:387-393` (`grandStored`); `CostsKpis.tsx:64`, `:91` |
| 4 | **Deleted accounts** | Counted: their charges stay in the total and get their own line ("Deleted accounts") | Left out: rows with no account are dropped | FIN SA-Q6 (rows with no account are included); `creditReport.ts:323` (`r.user_id !== null`) |

**In plain words.** On 18 October, Finance answers "what did AI cost us from 1 October to today". Charge checks answers "what did AI cost us in every billing period that touches the last 30 days". Charging began on 29 September and periods start on each account's own anniversary, so that is in practice everything since charging began. Charge checks therefore shows the larger number. It also leaves out businesses that were deleted, so it can be a little lower than it would otherwise be. Neither number is wrong. They answer different questions under the same label.

**A third figure, for completeness.** AI calls & usage shows **Recorded** AI cost, not charged. That is every AI call in the usage log, including calls that were never charged, over the last 30 days, and capped at 1,000 calls (`app/admin/analytics/page.tsx`; CR §6). Finance already shows the recorded figure beside the charged one ("Recorded above charged", M-4), for its own window.

**Approved fix (slice MK-2).**
- The AI cost page's **Charged AI cost** tile counts charges created in the window, exactly like Finance, with the same default window (This month). The same window then gives the same number on both pages.
- The billing-period check table stays on whole periods, because that is how a period is checked. It is labelled "Whole billing periods: can include charges from before the window", and it no longer feeds the tile.
- Deleted accounts get their own line on the AI cost page too, so both totals cover the same accounts.

**How the tile is computed (SA-1 ruling, MK-C1).** The AI cost tile is **the same computation as Finance's F-K3**: the AI cost route calls the existing ledger read (R-a, `listRowsOfAllAccountsCreatedInRange` / `…ForAccount…`) and Finance's existing charged-cost builder, for the page's window. It is not a recount over the credit report's rows, because the credit report reads rows only for accounts with a totals row and so never reads deleted accounts' rows. Deleted accounts are included (FIN SA-Q6), so "same window, same number" holds by construction. No new repository method; at the ledger ceiling the tile shows "at least", as Finance does.

---

## 3. Page 1: Finance

**Approved by the user, 2026-10-19.**

**Answers:** "Are we making money from Business OS, and from whom?" Read-only (FIN NG-1). One window and one business picker for the whole page, both in the URL (LAY §5.6). **Every money figure is in US dollars and shown with the `$` sign** (§3.4).

### 3.1 KPI strip (five tiles, in the order revenue, cost, users, BD-35)

The strip is the same on every tab (BD-29). Every tile is a link to its breakdown (BD-31). Every tile carries a leading or lagging icon (§3.3).

| # | Tile | Leading or lagging | Opens |
|---|---|---|---|
| F-K1 | **Revenue received** (in the window, $) | Lagging | Overview → Revenue |
| F-K2 | **MRR now** ($, current Stripe mode) | Leading | Overview → Revenue (the MRR part) |
| F-K3 | **Charged AI cost** ($, this month vs the same days last month) | Lagging, with an early-warning trend | Overview → AI cost summary |
| F-K4 | **AI margin** ($, in the window) | Lagging | Accounts tab |
| F-K5 | **Paying accounts** (% of all accounts), with a small second figure **Converted this month** | Paying %: lagging. Converted this month: leading | Plans & subscriptions tab |

The small "Converted this month" figure sits inside the F-K5 tile, under the percentage, with its own icon. It is not a sixth tile, so the strip stays at five (LAY's maximum).

### 3.2 The page in the user's four-part format

| Page / tab | KPI: what we track, leading or lagging | Breakdown on this page, and what we expect to learn | Side drawer (deeper dive) |
|---|---|---|---|
| **Finance → Overview** | **F-K1 Revenue received**, lagging. Cash owners paid us in the window, in $: plans plus credit boosts, net of refunds and lost disputes | **Revenue**: plans and boosts, refunds, lost disputes, held in open disputes now, boosts by package, and **our payment problems** (boost disputes, paid but not credited). *Learn:* where our money comes from, what we lost, and whether a payment is stuck | **Business drawer**: what one business paid us (plan payments list, boosts), from the payments table rows |
| | **F-K2 MRR now**, leading. The monthly value of paying subscriptions today, in $; past due counted but shown apart (BQ-P8a-4) | Same **Revenue** block, a second line "Recurring now" beside "Received in the window", with active, past due and cancelling amounts. *Learn:* what next month's plan cash should be, and how much of it is at risk | Plan drawer (see Plans & subscriptions) |
| | **F-K3 Charged AI cost**, lagging with a trend: this month against the same days last month, in $ (K-1, BD-11 amber at 1.5×, red at 2×) | **AI cost summary**: charged total, credits, by trigger, by current plan group, top 10 businesses, one line "Recorded above charged", and a link to the AI cost page for detail. *Learn:* which businesses and which kind of use (owner, scheduled, external) drive cost | Business drawer: that business's charged and recorded AI cost |
| | **Block KPI: Accounts over allowance** (count), leading. Not in the strip. Carries K-2's amber rule (at least 150% of allowance) as a chip on the block | **Credits**: allowance against use per account, gifted and bought credits outstanding (K-4, never added together), granted and taken back in the window, plus the credits history trend. Credits are units, not money. *Learn:* who is outgrowing their plan (an upsell, or a cost leak) and how many free credits we owe | Business drawer: that business's credit position |
| | **Block KPI: Businesses taking client payments** (count of businesses with at least one client payment in the window), leading: a business that takes payments through us is using the product for real | **Client payments (the businesses' money, not ours)**: amounts in $ for payments made in US dollars, and a line "plus n payments in other currencies, not converted" (§3.4, Q-10). Refunds, recorded fees and by business follow the same rule. Then **client payment problems** (overdue invoices and instalments, client plans, reminder health). Never added to our revenue (BD-1). *Learn:* which businesses depend on us for getting paid, and where their clients are not paying | Business drawer: that business's client payments, **in that business's own currency**, and its overdue items |
| **Finance → Accounts** | **F-K4 AI margin**, lagging. Revenue after tax, net of refunds and disputes, minus charged AI cost, in $ (BD-22); "after Stripe fees (estimate)" beside it (6b) | **Account economics table**: one row per business with paid us, charged AI cost, AI margin, margin after estimated fees, credits used and plan group; sortable, with filters "negative margin" and "active". *Learn:* which businesses lose us money, and whether that is a plan or a usage problem | **Business drawer** (read-only quick look): today's account summary. Its link "Open full view" goes to today's picked-business page |
| **Finance → Plans & subscriptions** | **F-K5 Paying accounts**, lagging: the share of accounts with a paying subscription (§5.1). **Converted this month**, leading: of the paying accounts, how many paid us for the first time this month (§5.1) | **Plan mix**: all six groups with real counts including zeros (BD-3), paying vs comped, Founding Partners with no end date (K-3's amber rule as a chip), dormant, new and ending soon, plus the plan-mix history trend. A **Converted this month** list: each newly paying business, its plan, and where it came from (invite or organic). Then **Subscriptions**: status tiles as filters (in grace, paused, failed, cancelling, no Stripe) and the list. *Learn:* how the customer base is made up, who converts to paying, and whose payment is failing | **Plan drawer**: one plan's accounts, statuses and MRR. **Subscription row → business drawer**, showing the read-only Plan billing panel (P-8a.2) |

**Picking a business** keeps working as today (M-1, "one account, one screen"). The page narrows to that business. The drawer is a quicker look from a list row, and it links to the same full view.

### 3.3 Leading and lagging icons (user point 1; applies to both pages)

| # | Rule |
|---|---|
| LL-1 | Every KPI tile, and every block KPI, shows a small icon in its top corner: a **forward arrow** for leading, a **clock** for lagging. The icon is not colour-coded, so it never competes with the red, amber and grey status (BD-11). |
| LL-2 | Hovering over the icon, or focusing it with the keyboard, shows a tooltip with two lines. Line 1 explains the KPI in plain words (the "Definition" column of §5). Line 2 says, in words, **"Leading indicator: it tells you early what is coming"** or **"Lagging indicator: it tells you what already happened"**. |
| LL-3 | The icon has an accessible name with the same text ("Lagging indicator. Cash owners paid us…"), so a screen reader gets the meaning without the hover. The tile itself stays a link to its breakdown (BD-31); the icon is a separate focusable element, so hovering over it does not open the breakdown. |
| LL-4 | The words come from one copy constant per KPI, held next to the tile labels, so the tooltip and §5 cannot drift. |
| LL-5 | This adds an optional `indicator` prop (`'leading' \| 'lagging'` plus the explanation) to the shared `KpiTile`. That is a shared export, so the slice that builds it (MK-0) runs the full cycle (LAY R-7; §11 SA-8). |

### 3.4 One currency on the page: US dollars, shown as `$` (user point 2; applies to both pages)

**What our own money actually comes in today.** Checked in the code:

| Source | Currency | Evidence |
|---|---|---|
| Plan prices | **USD only.** The two Stripe lookup keys are `bos_plan_basic_monthly_usd` and `bos_plan_pro_monthly_usd`, and PAY rules "USD only; no conversion shown anywhere" (Q-B2, RD-13, SR-15) | `lib/business-os/entitlements/config/planPrices.ts:51-54`; PAY §6 |
| Plan payments received (billing events) | **USD only, enforced.** A paid plan invoice in any other currency is refused and recorded as a refusal, never as revenue | `lib/business-os/billing/planPaymentApply.ts:16` (step 5, "not USD → refusal row", SA-P15 backstop); FIN §11D.1 live check (1 `invoice_paid`, USD 79.00) |
| Credit boost packages | **USD only, by type.** A package's `currency` is the literal type `'USD'` | `lib/business-os/boost/boostPackagesTypes.ts:29`; FIN §6.1 (migration CHECK) |
| MRR | **USD in practice.** It is built from the list price of each tier, which is the USD price above; the code still groups by currency | `lib/business-os/billing/planMrr.ts:38-39`, `:64-68` |
| AI cost | **USD by definition** of the column (`cost_usd`) | FIN CUR-5 |
| AI margin | **USD only** already (BD-22, M-3) | FIN §11E |

**Finding:** our revenue, MRR, AI cost and margin are **US-dollar only, in practice and by guard**. Showing them in `$` loses nothing today.

**Display rule (FX-safe):**

| # | Rule |
|---|---|
| USD-1 | Every money figure on Finance and AI cost is shown as `$1,234.56`, never "USD 1,234.56" and never a currency code. This covers the tiles, blocks, tables and the drawer, except the drawer's client payments (USD-4). |
| USD-2 | The figure is the **US-dollar line only**. The code keeps grouping by currency, so nothing is ever added across currencies, and no exchange rate is used (BD-12, CLAUDE.md "never sum money across currencies"). |
| USD-3 | If any of our own money arrives in another currency (it cannot today, but a future price could), the figure gets a small note: **"plus n payments in other currencies, not converted"**. The note links to the breakdown, where each other currency has its own line with its own code. It never turns into one total. |
| USD-4 | **Client payments** are in the businesses' own currencies (USD and ILS live today, FIN §6.1 layer B). The block KPI stays a **count of businesses**, which needs no currency. Amounts show in `$` for US-dollar payments only, with "plus n payments in other currencies, not converted". The business drawer shows that one business's own currency with its own sign (for example `₪`), because one business has one currency to show and nothing is mixed (Q-10). |
| USD-5 | A KPI tile never shows an "other currencies" figure as part of its value; only the note. |
| USD-6 | The Finance and AI cost copy guards are extended: a test fails if a money string renders "USD " instead of `$` (§11 SA-9). |

---

## 4. Page 2: AI cost

**Approved by the user, 2026-10-19.** The Page 1 rules apply here too: the leading or lagging icon on every KPI (§3.3), and every amount in `$` (§3.4; AI cost is USD by definition, so only the display changes).

**Answers:** "What does AI cost us, did we charge for all of it, and is the charging correct?" Read-only. It uses the same window choices as Finance (**This month** by default) and the same business picker.

**One vocabulary, shown on screen as a fixed two-line legend at the top of the page:**
- **Charged AI cost:** what Business OS AI actions cost us that we billed to a customer in credits (the credit ledger, from 29 Sep 2026). This is the business figure (BD-18).
- **Recorded AI cost:** every AI call the system logged, charged or not, both products (the usage log). This is the operations figure. The two are never added.

### 4.1 KPI strip (five tiles)

| # | Tile | Leading or lagging | Opens |
|---|---|---|---|
| A-K1 | **Charged AI cost** (window, $); equals Finance F-K3 for the same window | Lagging | Summary & checks → Charged breakdown |
| A-K2 | **Recorded AI cost** (window, $, Business OS scope) | Lagging | Calls tab |
| A-K3 | **Recorded above charged** (window, $) | Leading: uncharged spend is a leak before it is a loss | Summary & checks → Leak check |
| A-K4 | **Billing periods not matching** (count; red when above 0) | Leading: a ledger error shows here before a customer sees a wrong balance | Summary & checks → Period check |
| A-K5 | **Fallback-priced charges** (count, with "n reconciled") | Leading: a model with no price in the price table | Summary & checks → Fallback list, with a link to Model pricing |

### 4.2 The page in the user's four-part format

| Page / tab | KPI: what we track, leading or lagging | Breakdown on this page, and what we expect to learn | Side drawer (deeper dive) |
|---|---|---|---|
| **AI cost → Summary & checks** | **A-K1 Charged AI cost**, lagging | **Charged breakdown**: by action type, area, service and trigger (net of corrections), cost spread p50 and p90, deleted accounts on their own line. *Learn:* which actions cost most, and whether one action's cost is drifting | **Business drawer**: one business's charged and recorded cost, its billing periods, and a button that runs the Leak check for it |
| | **A-K3 Recorded above charged**, leading. **Block KPI on the Leak check: Businesses with uncharged calls** (count), leading | **Leak check**, on demand, up to 7 days: calls recorded but not charged, per business (platform accounts shown as "not a business"). *Learn:* which calls slip through charging, which businesses they belong to, and whether to fix them | Business drawer (as above) |
| | **A-K4 Billing periods not matching**, leading | **Period check**: whole billing periods, stored total against the sum of rows, labelled **"Whole billing periods: can include charges from before the window"**. *Learn:* whether the ledger is internally correct | **Period drawer**: one account's one period, stored vs rebuilt, plus that business's figures for the window |
| | **A-K5 Fallback-priced charges**, leading | **Fallback list**: charges priced from a fallback price, reconciled or not. *Learn:* which models need a price | — (the list row links to Model pricing) |
| **AI cost → Calls** | **A-K2 Recorded AI cost**, lagging | Today's AI calls & usage content: by provider, model and feature, the calls table, the Business OS / All products scope switch (BD-25 keeps All products). Call count, tokens and average cost per call become this tab's summary cards. *Learn:* where AI spend goes by provider and model, across both products | **Call drawer** (exists today): one call's details |

**Health tile.** "Recorded AI cost" on `/admin` (BD-27) links to AI cost → Calls with the same window.

---

## 5. KPI definitions

"New read?" means: does the figure need data the page does not read today. "No" means the figure is already computed or read somewhere and only moves or is combined. "Currency" means the display rule of §3.4: `$`, US-dollar line only, other currencies as a note, never converted.

| KPI | Definition in plain words | Leading / lagging | Currency | Data source today | New read? |
|---|---|---|---|---|---|
| **F-K1 Revenue received** | Money owners paid us in the window, for plans and credit boosts, after refunds and lost disputes. Test and live payments count together (BD-14) | Lagging | `$`; other currencies as a note (USD-3). None are possible today | Today's K-5 / Our revenue: plan `invoice_paid` events (R-m, M-2) and boost purchases with reversal events (R-k, 4b.2) | No |
| **F-K2 MRR now** | The monthly price of every paying subscription today. Past due is counted but shown apart; plans with no list price, or a founder discount with no amount, are not counted and say so | Leading | `$` (prices are USD) | The Subscriptions page's totals (P-8a.1 reader, `planMrr.ts`, current Stripe mode only, PF-15) | No new database read or repository method. **Home (SA-2): the finance payload**, via a `lib/admin/billing` wiring function (current-mode rows plus `computeMrr`); one ruled AC-145 update in MK-4 |
| **F-K3 Charged AI cost** | What Business OS AI actions cost us that we charged credits for, this month, against the same days of last month | Lagging (trend gives early warning) | `$` (USD by definition, CUR-5) | Today's K-1 (R-a, credit ledger) | No |
| **F-K4 AI margin** | Revenue after tax, net of refunds and disputes, minus charged AI cost, in the window (BD-22). "After Stripe fees (estimate)" shown beside it. It deducts AI cost only (§14) | Lagging | `$`; a business paying in another currency shows "n/a, different currency" as today | Today's platform line on the Accounts tab (M-3, 6b) | No (moves from the tab body to a tile) |
| **F-K5 Paying accounts %** | See §5.1 | Lagging | Not money | §5.1 | No |
| **F-K5b Converted this month** | See §5.1 | Leading | Not money | §5.1 | Yes, a small one (§5.1). **Home (SA-10): a new method on `BusinessOsBillingAdminReadRepository`**, wired through `lib/admin/billing` into the finance payload |
| **Accounts over allowance** (block KPI) | Accounts whose credit use this period is above their allowance; K-2's "far over" (150%) is the amber chip | Leading | Not money | Today's Credits section and K-2 | No |
| **Businesses taking client payments** (block KPI) | Businesses with at least one client payment recorded in the window. Their clients' money, not ours | Leading | Not money (a count). The amounts under it follow USD-4 | Today's Takings "Businesses with takings" figure | No |
| **A-K1 Charged AI cost** | The same as F-K3, for the window picked on this page | Lagging | `$` | The credit report's rows, filtered to charges created in the window | **Changed computation** over rows already read (SA-1) |
| **A-K2 Recorded AI cost** | Every Business OS AI call logged in the window, charged or not, priced from the model price table | Lagging | `$` | Today's AI calls & usage total (usage log; 1,000-call cap, says "may be incomplete") | No |
| **A-K3 Recorded above charged** | Recorded minus charged for the same window; "None" when charged is higher | Leading | `$` | Finance's M-4 figure (the Health tile's usage read) | No new read on the database; the AI cost page must call it (SA-3) |
| **Businesses with uncharged calls** (block KPI, Leak check) | Businesses with at least one AI call recorded but not charged in the days the Leak check covered. Platform accounts are listed but not counted as businesses | Leading | Not money (a count) | Today's Leak check result (per business rows) | No (counted from the Leak check's own result; shown only after a check has run) |
| **A-K4 Billing periods not matching** | Billing periods whose stored total disagrees with the sum of their rows | Leading | Not money | Today's Charge checks tile | No |
| **A-K5 Fallback-priced charges** | Charges priced from a fallback because the model had no price | Leading | Not money | Today's Charge checks tile | No |

**Not a KPI, kept as a note:** Founding Partners with no end date (K-3) and gifted credits outstanding (K-4) leave the strip. They stay as figures in their blocks, and K-3 keeps its BD-11 amber rule as a chip. K-6 (disputes) stays as the red rule on F-K1, as today's K-5 does. K-7 (AI margin) becomes F-K4, with no colour rule (Q-6 accepted).

### 5.1 Paying accounts % and Converted this month (user point 3)

**F-K5 Paying accounts %** (lagging).

| Item | Definition |
|---|---|
| Plain words | "What share of our accounts pay us for a plan." |
| Numerator | Accounts that are **paying** today: a billing row in the current Stripe mode with status `active` or `past_due` and not ended. This is the single existing definition (`PAYING_SUBSCRIPTION_STATUSES`, FIN SA-Q5, BD-15, BD-37); it is never redefined. |
| Denominator (accepted, Q-11) | **Every account with a Business OS plan row today**: Trial, Founding Partner, Comped, Essentials, Autopilot and Unknown/held, the same six groups as Plan mix (BD-3). Deleted accounts and platform accounts are not counted. So trial, free (Founding Partner) and comped accounts **are** in the denominator: the KPI then answers "how much of our base pays", and it moves when a trial converts. |
| Display | `18%`, with the sub-line "9 of 50 accounts" so the count is never lost. With a business picked: "Paying" or "Not paying" instead of a %. |
| Exactness | When the plan walk is cut off or a billing read fails, the tile says "at least" or "Unknown" as K-3 does today (AGG-3); it is never shown as 0%. |
| Source | Today's plan groups (R-c via BD-37) for both counts. **No new read.** |

**F-K5b Converted this month** (leading: each new paying account adds to next month's MRR).

| Item | Definition |
|---|---|
| Plain words | "Of the accounts paying now, how many paid us for a plan for the first time this month." |
| Display | A small second figure inside the F-K5 tile: "Converted this month: 2 of 9 paying". |
| "This month" | The current calendar month in UTC (BD-9). It is always this month, whatever window the page shows, exactly like K-1 (the tile says so). |
| Counted | An account that is paying now (numerator above) **and** whose first plan payment above $0 was paid this month. |
| Not counted | A boost purchase (a boost never counts as a first payment, PAY SR-6); a $0 invoice; an account that paid this month and has already stopped paying (it shows in the list as "converted, no longer paying", not in the figure). |
| Breakdown | The "Converted this month" list on Plans & subscriptions: business, plan, date of first payment, and where it came from (friend invite, admin invite or organic, from the lineage `source`). |

**Data source, checked in the code.** The plan payment function stamps the first payment itself: `business_os_apply_plan_payment` sets `business_os_account_lineage.first_paid_at` (and `first_payment_ref`, the invoice) on the first paid plan invoice above zero, once only (`supabase/migrations/20261028_business_os_first_payment_stamp.sql:209-217`; PAY SR-7). Every paid plan invoice is also a row in `business_os_billing_events` (`kind = 'invoice_paid'`, with `livemode`, `amount_minor` and `paid_at`, same migration `:183-184`), which Finance already reads for revenue (R-m).

**Gaps in `first_paid_at`, and what we do about them:**

| # | Gap | Effect | What we do |
|---|---|---|---|
| G-1 | **Not mode-aware.** The stamp has no `livemode`, and test and live share one database (PF-15). An account that paid in test mode is stamped with its test payment, so when live keys arrive its first real payment is never stamped. | After go-live, test-mode converts would hide real conversions | Accepted (Q-12): count from **`business_os_billing_events`**, the first `invoice_paid` above $0 per account **in the current Stripe mode**. This is mode-aware, and it matches BD-37 (status uses the current mode). `first_paid_at` stays as a cross-check only |
| G-2 | **Needs a lineage row.** The stamp is an UPDATE on the account's lineage row; an account with no lineage row is never stamped | That account would never count as converted | Covered by the same choice: billing events need no lineage row. The lineage `source` is used only for the "where it came from" column, shown as "Not recorded" when missing |
| G-3 | **Once only.** A business that stopped paying and comes back is never stamped again | A returning customer is not a "conversion" | Kept as is: Converted this month means **first** payment. Returning payers can be a later "Reactivated this month" figure, if the user wants one (not proposed now) |
| G-4 | **Before plan billing existed.** No plan payment exists before P-3b | None in practice: the first `invoice_paid` is 2026-10-12 (FIN §11D.1) | None |

**New read:** a small one. For the accounts paying now, the earliest `invoice_paid` above $0 in the current mode. The billing events table is small (FIN §11D.1 found 9 rows), and the read is account-scoped and bounded. **Home (SA-10 ruling, MK-C2):** the read is mode-aware, so it **cannot** go in `BusinessOsFinanceReadRepository` (that repository may not name `livemode`, BD-14). It is a new method on **`BusinessOsBillingAdminReadRepository`**: the earliest `invoice_paid` with `amount_minor > 0` per account in one mode, for a list of account ids, with the `.in()` list chunked at ≤ 100 ids, each chunk paged at ≤ 1,000, and reaching the ceiling an error. It is wired through `lib/admin/billing` (the R4 pattern) and lands in the **finance payload** (one ruled AC-145 update in MK-5b).

---

## 6. What is removed or merged, and why

Every block on the four pages today, and where it goes.

| # | Today: page → block | New home | Why |
|---|---|---|---|
| 1 | Finance → K-5 "Our revenue" tile | **F-K1 Revenue received** | Same figure, clearer name |
| 2 | Finance → K-1 "Charged AI cost this month" | **F-K3** | Unchanged |
| 3 | Finance → K-2 "Accounts far over allowance" | Credits block KPI, as an amber chip | The strip has five places; it is a credits signal |
| 4 | Finance → K-3 "Founding Partners with no end date" | Plan mix block, as an amber chip | A customer-mix signal, not a headline |
| 5 | Finance → K-4 "Gifted credits outstanding" | A figure in the Credits block | Informational, has no rule (BD-11) |
| 6 | Finance → Our revenue (plans, boosts, held, lost, by package) | Overview → **Revenue** | Unchanged content; gains the MRR line |
| 7 | Finance → Revenue "Not shown here: MRR (a later update)" | **Dropped** | MRR is now shown |
| 8 | Finance → Takings through the platform | Overview → **Client payments (the businesses' money, not ours)**, moved to the bottom | Unclear name and no KPI; it is not our money, so it should not sit directly under our revenue |
| 9 | Finance → Accounts by plan | Plans & subscriptions → **Plan mix** | Overlapped with Subscriptions |
| 10 | Finance → AI cost (charged, by trigger, by group, top 10) | Overview → **AI cost summary** (unchanged) | The business figure belongs on Finance (BD-18) |
| 11 | Finance → Recorded AI cost and the distortion notes (M-4) | Finance keeps **one line**, "Recorded above charged", linking to AI cost. The recorded figure and its five notes move to the AI cost page | The explanation belongs where both measures are shown; BD-18 still holds |
| 12 | Finance → Credits | Overview → **Credits**, with its block KPI | Unchanged content |
| 13 | Finance → History (plan mix and credits trends) | **Split**: the plan-mix trend goes under Plan mix, the credits trend under Credits | A trend is the history of a KPI, so it sits under that KPI rather than in a block of its own |
| 14 | Finance → Payment problems → Our payment problems (boosts) | Overview → **Revenue** | Our money's problems sit with our money |
| 15 | Finance → Payment problems → Client payment problems | Overview → **Client payments** block | Same owner as the client payments: the businesses |
| 16 | Finance → Accounts tab (account economics, platform line) | **Finance → Accounts** (unchanged); the platform margin also feeds F-K4 | — |
| 17 | Finance → one account (header, summary, links) | Unchanged full view; **also** the new business drawer | A quick look without leaving a list |
| 18 | Finance → "Since it started" (DF-6) | Unchanged | BD-26 |
| 19 | Subscriptions → MRR tiles | **F-K2** and the Revenue block | Revenue and MRR in one place |
| 20 | Subscriptions → Paid accounts tile | **F-K5** (now a %, with Converted this month) | — |
| 21 | Subscriptions → status filter tiles and list | Plans & subscriptions → **Subscriptions** | Plan mix and subscriptions together |
| 22 | Subscriptions → page and its "Stripe test mode" badge and note | The **tab** keeps the badge and note; the page route redirects to the tab | One page fewer (needs SA, §11 SA-4) |
| 23 | Charge checks → Credits charged, Cost, Charges tiles | Cost → **A-K1**; credits and charge counts become breakdown figures | Five tiles; the cost is the KPI |
| 24 | Charge checks → Periods not matching, Fallback-priced | **A-K4**, **A-K5** | Unchanged |
| 25 | Charge checks → period table, breakdowns, fallback list, spread | AI cost → **Summary & checks** | Unchanged; the period table gets its whole-periods label |
| 26 | Charge checks → Leak check | Summary & checks → Leak check, fed by **A-K3**, with its block KPI **Businesses with uncharged calls** | The block now has its own KPI |
| 27 | AI calls & usage → tiles (recorded cost, calls, tokens, average; category tiles in All scope) | Recorded cost → **A-K2**; the rest become the Calls tab's summary cards | Five tiles across the page |
| 28 | AI calls & usage → filters, tables, call drawer, scope switch | AI cost → **Calls** (unchanged) | — |
| 29 | Sidebar → four Money entries | **Two**: Finance, AI cost. Old links redirect | The user's first concern |

Nothing is deleted from the database, and no figure is lost. Two things are dropped: the "MRR later" note (item 7) and the separate History block frame (item 13).

---

## 7. Decisions this changes

The user accepted every one of these on 2026-10-19 (Q-1 to Q-12). None of them changes a money definition. BA records them in FIN §0.2 as new BD entries when the SA review clears.

| # | Existing decision | What changes | Why |
|---|---|---|---|
| C-1 | **BD-2** (payment problems in two labelled blocks, under one "Payment problems" frame) | Our problems move into Revenue (boosts) and Plans & subscriptions (plans, slice 7); the clients' problems join the Client payments block. Both are still separate and labelled | Each problem sits beside the KPI it hurts |
| C-2 | **BD-24** and M-5 (Charge checks is its own Money page) | Charge checks becomes the **Summary & checks** tab of AI cost | Merge with AI calls & usage |
| C-3 | **M-5 sidebar** (four Money entries; the sidebar is fixed, LAY §2.3 X-1, sign-off given by BD-21 and BD-24) | Two entries: Finance, AI cost. **Sidebar sign-off given by Q-1** | The user's first concern |
| C-4 | **Finance never names the Stripe mode** (BD-14 and BD-20 as built: no mode wording on Finance; the reason Subscriptions sits outside `/admin/finance`, P-8a.1 deviation D-2) | Finance may show **"Stripe test mode"** on the MRR tile and on the Plans & subscriptions tab only. Revenue received stays without any mode label (BD-20 unchanged) | MRR is current-mode only (PF-15, BD-37), while cash counts both modes (BD-14). Without the label, the two would disagree with no explanation |
| C-5 | **K-tile set** (K-1 to K-5 in the strip, order K-5, K-1, K-3, K-2, K-4 from 6b) | Tiles become F-K1 to F-K5. K-2, K-3 and K-4 move into their blocks with **their BD-11 rules unchanged**. BD-35's order (revenue, cost, users) is kept | Each tile has exactly one breakdown |
| C-6 | **Charge checks default window, last 30 days**, and its cost tile summing whole billing periods (credit deduction slice 4a) | Default **This month**; the tile counts charges created in the window | So the two pages agree (§2) |
| C-7 | **M-4 OV-5** (the recorded figure, its notes and "Recorded above charged" shown in full on Finance) | Finance keeps one line; the full block moves to AI cost. **BD-18 is kept**: charged is the business figure, and recorded is still shown beside it, never added | Fewer AI cost figures on Finance |
| C-8 | **Per-currency display on Finance** (CUR-1, CUR-2: one line per currency, labelled with its code; M-2 and 4a show "USD 79.00") | Finance and AI cost show `$` and the US-dollar line only; any other currency becomes a note "plus n in other currencies, not converted" (§3.4). **The rule against summing across currencies is kept**: the code still groups by currency, and nothing is converted | User point 2. Our own money is USD-only today (§3.4) |

---

## 8. Decisions kept as they are

| Decision | How the proposal respects it |
|---|---|
| BD-1 | Client payments never share a total, tile or margin with our revenue; the block is named "not ours" |
| BD-3, BD-4, BD-15 | Plan mix keeps all six groups with zeros; comped is not paying; a paying Founding Partner sits under its tier |
| BD-7 | AI margin counts AI cost only and is labelled so; the Stripe fee is shown as a labelled estimate beside it (§14 keeps the label) |
| BD-11 | Every threshold kept, as data |
| BD-12 and the currency rules | No FX and no cross-currency sum anywhere. `$` shows the US-dollar line only; other currencies stay separate as a note (§3.4) |
| BD-14 | Revenue received counts test and live together |
| BD-17 | Refunds and lost disputes count in the month we recorded them |
| BD-18 | Charged is the business figure; recorded is never added to it |
| BD-19 | Cash comes first in the Revenue block; MRR sits beside it, not instead of it |
| BD-22 | Margin is on revenue after tax, net of refunds and disputes |
| BD-23 | Totals, MRR and the subscriptions list stay in the Money area; the per-account billing panel stays in the Businesses drawer (the Finance drawer shows it read-only, actions stay in Businesses) |
| BD-25, BD-34 | The All products scope stays on the Calls tab; the redundant pages stay redundant |
| BD-26 | "Since it started" for one business is kept |
| BD-29, BD-31 | The strip sits above the filter bar, the same on every tab, and every tile is clickable |
| BD-35 | Revenue tiles first, then cost, then users |
| BD-37 | Paying status, MRR and Converted this month use the current Stripe mode |
| BQ-P8a-4 | Past due counts in MRR and is shown apart |
| FIN NG-1, CR §5.3 | Read-only: no action moves into Money; drawers have no buttons except "Run leak check" (a read) |

---

## 9. Where pending slice 5b fits

Slice 5b, as recorded in FIN §0.1 (row 5) and specified as §11N on another branch, puts **MRR on Finance**, makes paying vs comped exact, and adds trial-to-paid and the funnel's "paid" stage. It was not read for this review because it is on a branch this worktree does not hold, so this section is built from the §0.1 row and from what the coordinator described.

| Part of 5b | In this proposal |
|---|---|
| MRR on Finance | **Superseded** by MK-4: MRR becomes F-K2 and a line in the Revenue block, from the existing P-8a reader. Any ruling in §11N about how MRR is read or worded (in particular the Stripe-mode wording, C-4) should be reused, not redone |
| Paying vs comped exactness | **Kept** as part of 5b, now feeding F-K5 and Plan mix |
| Trial-to-paid, funnel "paid" stage | **Partly answered** by F-K5b Converted this month (§5.1). The trial-to-paid rate and the funnel stage stay in 5b and slice 3, as breakdown lines under F-K5 |

**Decision (with Q-1):** §11N is not built as written. Its MRR rulings fold into MK-4, and the rest of 5b becomes **MK-9** ("paying exactness and trial-to-paid", §12), after MK-5b. BA splices this into FIN §0.1 when the SA review clears.

---

## 10. Questions for the user and their answers

**Status (2026-10-19).**
- **Page 1 (Finance)** was accepted with the user's three feedback points applied: the leading or lagging icon with its hover explanation (§3.3), the whole page in `$` (§3.4), and Paying accounts as a %, plus Converted this month (§5.1).
- **Page 2 (AI cost)** was approved with no further review of its mockup. The extra block KPI "Businesses with uncharged calls" is in (§4).
- **Q-1 to Q-12** are all accepted at their defaults.
- **Q-13 and Q-14** (terminology, §14): accepted at their defaults on 2026-10-19 (keep "AI margin" and "AI cost").

| # | Question | Default | Answer |
|---|---|---|---|
| Q-1 | Do you approve **two pages**, Finance (Overview, Accounts, Plans & subscriptions) and AI cost (Summary & checks, Calls), in place of the four? This also re-opens the Money sidebar (C-2, C-3) | **Yes** | **Accepted 2026-10-19** |
| Q-2 | Client payments: keep them as one block **at the bottom of Finance Overview**, move them to a tab of their own, or take them out of Money altogether (for example, to the Businesses page)? | **Bottom of Overview**, named "Client payments (the businesses' money, not ours)", KPI "Businesses taking client payments" | **Accepted 2026-10-19** |
| Q-3 | While we run on Stripe test keys, may Finance show **"Stripe test mode"** on the MRR tile and the Plans & subscriptions tab? (C-4) | **Yes**, on MRR and that tab only; revenue received stays without a label | **Accepted 2026-10-19** |
| Q-4 | The five headline tiles: **Revenue received, MRR, Charged AI cost, AI margin, Paying accounts %** (with Converted this month inside it). Founding Partners with no end date, accounts far over allowance and gifted credits move into their blocks with the same colour rules (C-5) | **Yes** | **Accepted 2026-10-19** |
| Q-5 | AI cost page: default window **This month**, like Finance, so the charged figure matches (C-6)? | **Yes** | **Accepted 2026-10-19** |
| Q-6 | Should the AI margin tile turn amber or red at a level you choose (for example, below 0)? | **No colour for now**; it shows the value only, until you choose a level | **Accepted 2026-10-19** |
| Q-7 | For one business: a **side drawer** for a quick look from any list, with "Open full view" for today's full page? | **Yes, both** | **Accepted 2026-10-19** |
| Q-8 | History: move each trend under the KPI it belongs to (plan mix, credits) instead of one History block? | **Yes** | **Accepted 2026-10-19** |
| Q-9 | Page name: "AI cost"? | **"AI cost"** (Q-14 revisits the name in the light of future costs, and keeps it by default) | **Accepted 2026-10-19** |
| Q-10 | **Client payments on a `$` page.** The businesses' clients pay in the businesses' own currencies (US dollars and Israeli shekels today), and we have no exchange rate. What should the block show? | **The block KPI stays a count** (businesses taking client payments). Amounts show in `$` only for payments in US dollars, with "plus n payments in other currencies, not converted". A business's own drawer shows its own currency (for example `₪`) | **Accepted 2026-10-19** |
| Q-11 | **Paying accounts %:** should Comped accounts (given a plan on purpose, not expected to pay) count in the "all accounts" we divide by? | **Yes, count them.** The % answers "how much of our whole base pays". Trial and Founding Partner accounts are counted too | **Accepted 2026-10-19** |
| Q-12 | **Converted this month** counts a business's first plan payment in the current Stripe mode, so a business that paid during testing still counts when it first pays for real. Agree? | **Yes** | **Accepted 2026-10-19** |
| Q-13 | **The margin's name.** Keep **"AI margin"**, or rename it **"Gross margin (AI cost only)"** now? (§14) | **Keep "AI margin"**, and add to its tooltip: "a partial gross margin: only AI cost is deducted so far". The name "Gross margin" stays free for the day hosting and fees are deducted too | **Accepted 2026-10-19** |
| Q-14 | **The page's name.** Keep **"AI cost"**, or call it **"Costs"** with AI as its first tab? (§14) | **Keep "AI cost"**. When other costs arrive, they get their own home (a Finance "Costs" view), with AI cost as one line that links to this page | **Accepted 2026-10-19** |

---

## 11. Questions for SA

| # | Question | BA's suggestion |
|---|---|---|
| SA-1 | Can the credit report compute "charged in the window" from the rows it already reads (period window `[start − 31 d, end)` covers every charge created in the window)? What happens at the rows ceiling? | Yes, compute over the rows already read; at the ceiling, show "at least", as today |
| SA-2 | MRR on Finance: call the P-8a reader from the finance route, or let the tab call the subscriptions route? | Reuse the subscriptions route from the tab, with no new reader |
| SA-3 | A-K3 on the AI cost page: reuse M-4's injected usage read through a route? | Reuse it; no new repository method |
| SA-4 | Moving Subscriptions under Finance breaks the Finance source guard that forbids naming the Stripe mode (P-8a.1 deviation D-2). Is a narrowed guard acceptable (mode wording allowed only in the tab's own files)? | Narrow the guard to an allow-list of files |
| SA-5 | Read-only drawers (business, plan, billing period) on Finance and AI cost: do they need `useDrawerResource` (a new shared export, full cycle under LAY R-7)? | Reuse today's account summary payload with `account=`; full cycle if a shared export is built |
| SA-6 | Route for AI cost: keep `/admin/analytics` with tabs, or a new path with redirects from `/admin/analytics` and `/admin/finance/charges`? | New path `/admin/ai-cost`, with temporary redirects (the M-5 redirect pattern) |
| SA-7 | Is the Charge checks KPI re-cut a change to credit deduction slice 4a behaviour that needs its own pins updated? | Yes; record it in the workplan |
| SA-8 | The leading or lagging icon and its tooltip (§3.3) is a new optional prop on the shared `KpiTile`, used by both pages and by block KPIs. Hover plus keyboard focus with an accessible name: is a CSS tooltip acceptable, or should it reuse a Radix tooltip from `components/ui`? | Reuse the Radix tooltip primitive (CLAUDE.md components rule), wrapped in the shared folder |
| SA-9 | `$` display: a formatter over the existing per-currency lines (the USD line as `$`, the others as a count note), plus a copy guard against "USD " in Finance and AI cost strings. Does this conflict with the CUR-1 helper or the shared `formatMinorAmount`? | Add `formatUsdSign` beside the existing formatter; keep `groupByCurrency` untouched |
| SA-10 | Converted this month: a new bounded read of the earliest `invoice_paid` above zero per account in the current mode, in `BusinessOsFinanceReadRepository` (finance table pin). Or derive it from R-m's rows when the window covers the month? | A named account-list read with a ceiling; R-m is window-bound and cannot see "first ever" |
| SA-11 | Future costs (§13): do the payload and component names proposed here (for example `aiCost`, "Charged AI cost") leave room for other cost lines without a rename later? Is any shared name here too generic ("cost", "margin") and likely to collide? | Keep every new name specific to AI (`aiCost`, `aiMargin`); keep generic names (`costs`, `grossMargin`, `operatingMargin`) unused and reserved |

---

## 12. Effort and slice order

Rough estimates. Each slice is small, reuses existing reads and components, and has its own PR. "UI short path" and "full cycle" follow the team's standing rules (anything touching money figures, guards or new shared exports runs the full cycle). Both pages are approved, so the order no longer waits on Page 1.

| Slice | Title | What | Path | Rough effort |
|---|---|---|---|---|
| **MK-0** | Leading or lagging icon | The optional `indicator` prop on the shared `KpiTile` and on block KPIs, with its tooltip and accessible name (§3.3); in-house accessible tooltip, no new package (SA-8). No Finance tile uses it yet: Pin A and Pin B are unchanged, and the first Finance use waits for MK-5 | Full cycle (shared export, LAY R-7) | about 1 to 1.5 days. **PR [#474](https://github.com/AgentsPilot/neuronforge/pull/474) opened 2026-10-19, auto-merge on** (commit `9583426c`; SA-MK0, QA, TL approved; [retrospective](/docs/retrospectives/ADMIN_MONEY_MK0_RETROSPECTIVE.md)) |
| **MK-1** | Names and block KPIs | Rename Takings to "Client payments (the businesses' money, not ours)" and move it to the bottom; put each block's KPI as its headline (Businesses taking client payments, Accounts over allowance), with its icon | UI short path | about 1 day. **PR [#475](https://github.com/AgentsPilot/neuronforge/pull/475) opened 2026-10-19, auto-merge on** (commit `12b34dcc`; SA-CR-MK1, QA, TL approved; [retrospective](/docs/retrospectives/ADMIN_MONEY_MK1_RETROSPECTIVE.md)) |
| **MK-2** | One charged AI cost figure | AI cost tile counts charges created in the window; default This month; whole-periods label on the period table; deleted-accounts line (§2) | Full cycle | about 1.5 to 2 days |
| **MK-3** | AI cost page | Merge Charge checks and AI calls & usage into AI cost with two tabs, the Charged vs Recorded legend and one strip (A-K1 to A-K5, with icons); the Leak check's block KPI; `$` display; redirects; Health tile and Finance links; sidebar entry | Full cycle (sidebar, redirects, guard pins) | about 2.5 to 3 days |
| **MK-4** | Plans & subscriptions tab, and MRR | Subscriptions content as a Finance tab with Plan mix on top; MRR line in Revenue; redirect `/admin/subscriptions`; narrowed mode guard (C-4). **Supersedes 5b's MRR part** | Full cycle | about 2.5 to 3 days. **PR [#476](https://github.com/AgentsPilot/neuronforge/pull/476) opened 2026-10-19, auto-merge on** (commit `44667683`; SA-CR-MK4, QA, TL approved; AC-145 re-frozen `39b35743…` → `30275c29…`; [retrospective](/docs/retrospectives/ADMIN_MONEY_MK4_RETROSPECTIVE.md)) |
| **MK-5** | Finance strip re-cut | F-K1 to F-K5 (Paying accounts as a %), each with its icon; K-2, K-3, K-4 into their blocks with the same rules | Full cycle (tile rules) | about 1.5 to 2 days. **PR [#478](https://github.com/AgentsPilot/neuronforge/pull/478) opened 2026-10-19, auto-merge on** (commit `0dee536a`, main merged `4d25efdd`; SA-CR-MK5, QA, TL approved; Pin B `a1b3db0c`, AC-145 `a13f1ccd…`, Pin A `6547dcf7` on the commit and `e7d8da20` after merging #477's cases; [retrospective](/docs/retrospectives/ADMIN_MONEY_MK5_RETROSPECTIVE.md)) |
| **MK-5a** | `$` on Finance | **Folded into MK-5** (same slice, or landed immediately before it in the same PR; SA ruling, MK-C3), so Pin B is re-frozen once. The `$` formatter (`formatUsdSign`, reused if MK-3 built it), the US-dollar line only, the "plus n in other currencies" note, the copy guard (§3.4) | Full cycle (money display), inside MK-5 | about 1.5 days (counted in the total; not a separate PR) |
| **MK-5b** | Converted this month | The new bounded read, the small figure in F-K5, the Converted this month list (§5.1) | Full cycle (new read) | about 1.5 to 2 days. **PR [#485](https://github.com/AgentsPilot/neuronforge/pull/485) opened 2026-10-20, auto-merge on** (commit `4747c281`, main merged `48796149`; SA-CR-MK5B, QA, TL approved; AC-145 `23a12c7e`; follow-up MK5B-FU-1 in FIN §0.4; [retrospective](/docs/retrospectives/ADMIN_MONEY_MK5B_RETROSPECTIVE.md)) |
| **MK-6** | Payment problems where they belong | Our boost problems into Revenue; client problems into the Client payments block | UI short path | about 1 day. **PR [#489](https://github.com/AgentsPilot/neuronforge/pull/489) opened 2026-10-20, auto-merge on** (commit `4ee3b61d`, main merged `559a6745`; SA-CR-MK6, QA, TL approved; no payload change, no pin moved; [retrospective](/docs/retrospectives/ADMIN_MONEY_MK6_RETROSPECTIVE.md)) |
| **MK-7** | History under its KPIs | Split the History block into the Plan mix and Credits trends; recorded AI cost detail moves from Finance to AI cost (C-7) | UI short path | about 1 day. **PR [#491](https://github.com/AgentsPilot/neuronforge/pull/491) opened 2026-10-21, auto-merge on** (commit `af030efb`, main merged `340b4764`; SA-CR-MK7, QA, TL approved; one shared on-demand read; no pin moved; **C-7 deferred to MK-3**; [retrospective](/docs/retrospectives/ADMIN_MONEY_MK7_RETROSPECTIVE.md)) |
| **MK-8** | Read-only drawers | Business drawer (Finance Accounts and Subscriptions rows; AI cost), plan drawer, billing-period drawer | Full cycle if SA-5 needs a new shared export | about 3 days. **PR [#510](https://github.com/AgentsPilot/neuronforge/pull/510) opened 2026-10-25, auto-merge on** (commit `68f22190`, main merged `b187d774`; SA-CR-MK8, QA, TL approved; business and plan drawers built, billing-period drawer is Page 2; no pin moved; [retrospective](/docs/retrospectives/ADMIN_MONEY_MK8_RETROSPECTIVE.md)) |
| **MK-9** | Remaining 5b | Paying vs comped exactness, trial-to-paid rate, under F-K5 | Full cycle | about 2 days. **PR [#513](https://github.com/AgentsPilot/neuronforge/pull/513) opened 2026-10-26, auto-merge on** (commit `c9b1fc20`, with MK-10; SA-CR-MK9 C-1 and C-2 fixed, QA, TL approved; AC-145 `33340751…`; user owes a production run of the two read-only SQL checks, informational; [retrospective](/docs/retrospectives/ADMIN_MONEY_MK9_RETROSPECTIVE.md)) |
| **MK-10** | Finance rows open like the Businesses rows | User comment 2026-10-25: "have the open of the business line similar to the business lines, clicking on the line should open as well, and have the same button as we have there." Every Finance row that opens the MK-8 business drawer opens on a row click (the D-17 rules) and has the Businesses page's own Open button. **Folded into MK-9** (same branch, same PR) | Full cycle with MK-9 (a shared helper, SA-Q-MK10-1) | about 0.5 day. **In PR [#513](https://github.com/AgentsPilot/neuronforge/pull/513) with MK-9, auto-merge on** (shared `rowOpenTarget`, option A) |

**Total:** about 21 to 24 working days.

**Order and reasons.**
1. MK-0 first: both pages use the icon, so it is built once, before anything that shows a KPI.
2. MK-1: a quick, visible fix for the takings confusion.
3. MK-2: it ends the two-numbers confusion before anything moves.
4. MK-3 reduces four pages to three.
5. MK-4 makes it two, and brings MRR in.
6. MK-5 re-cuts the Finance strip once MRR exists, **with MK-5a folded in** (same slice or same PR, SA ruling MK-C3), so Pin B moves once. MK-5b follows. If MK-3 lands first it builds `formatUsdSign` and MK-5 reuses it. **Pin note (MK-0 / MK-5):** MK-0 adds the optional `indicator` prop only, so Pin A and Pin B are unchanged in MK-0; the first Finance use of the icon waits for MK-5, where Pin B is re-frozen once (the strip re-cut, the `$` values and the indicator together).
7. MK-6 and MK-7 are tidy-ups.
8. MK-8 (drawers) comes last, because it may build a shared export.
9. MK-9 can run any time after MK-5b.

**The existing queue (BD-32).** Slices 7 (platform payment problems and churn) and 3 (growth funnel) are unchanged. They land on Plans & subscriptions under F-K2 and F-K5. R-4 follow-up R4-FU-1 is independent. Slice 8.3 (#461) can merge as it is, and MK-7 moves its block afterwards.

**No slice in this list adds any other operating cost** (§13).

---

## 13. Future: other operating costs (not in scope)

**The user's note (2026-10-19).** Today the only expense the admin tracks is AI. The user will also want to track other costs later: hosting (Vercel), source control and CI (GitHub), and other tools. Some will be **fixed** (a monthly plan price) and some **variable** (usage-based, such as Vercel bandwidth or function time). The user does **not** want this added to the scope. BA should know it is coming, and the design should not block it.

**Not in scope, stated plainly:** no expense entry, no expense table, no migration, no import from a provider's billing, no new KPI, tile, tab, drawer or copy for these costs. Nothing in MK-0 to MK-9 builds any of it.

**Design choices to keep now, so nothing blocks it later.** Each one costs nothing extra in the approved slices; they are rules for how the slices are written.

| # | Keep in mind now | Why it matters later | Where it applies |
|---|---|---|---|
| FC-1 | **AI is one cost line, named as such.** Every figure says "AI": "Charged AI cost", "Recorded AI cost", "AI margin". Nothing on either page says just "Cost", "Expenses", "OPEX" or "Profit" | When hosting arrives, it becomes another line beside AI, and no existing label becomes wrong | MK-1, MK-3, MK-5 copy |
| FC-2 | **"AI margin" keeps saying what it deducts.** Its tooltip says it deducts AI cost only (and that the Stripe fee is an estimate beside it, BD-7). The names "Gross margin" and "Operating margin" are left unused | A later "Gross margin" (revenue minus all cost of revenue) and "Operating margin" (minus fixed costs too) can sit on top of AI margin without renaming it | MK-0 tooltip text, MK-5 |
| FC-3 | **The approved KPIs do not change when costs arrive.** The five Finance tiles stay as approved. A future "Other costs" or "Costs" breakdown would be a new block (or tab) on Finance, and whether it ever earns a tile is a later user decision | The strip is at five tiles today; the future work adds a breakdown, not a reshuffle | MK-5 (no placeholder is built) |
| FC-4 | **The AI cost page stays AI-specific.** Its checks (ledger, leak, fallback prices, calls) only make sense for AI. Future costs get their own view rather than being forced into this page's tabs | No tab or tile on AI cost has to change when hosting is added | MK-3 |
| FC-5 | **Charged AI cost is kept apart from our own operating costs.** Charged AI cost is a cost we pass on to customers through credits. Hosting and tools are not charged to anyone. They must never be written into the credit ledger, the usage log, or any AI figure, and AI figures must never be added into them | Mixing them would make "Recorded above charged" and the leak check meaningless, and would double-count | MK-2, MK-3; a rule for the future work |
| FC-6 | **AI we do not pass on is named, not hidden.** Recorded AI cost already includes calls no customer pays for (platform accounts, the All products scope). It stays labelled "recorded" and shown apart, because it is the nearest thing to an AI operating cost today | Later it can be classed as our own AI operating cost without changing any approved figure | MK-3 (Calls tab, Leak check copy) |
| FC-7 | **Time basis stays UTC calendar months, with the window labelled.** Fixed costs are monthly amounts; AI cost is per window | A monthly fixed cost can later be shown per month, or spread over a window, beside AI cost without a new time rule | Every slice (BD-9 already) |
| FC-8 | **The `$` rule already covers future costs.** Vercel and GitHub bill in US dollars; a cost in another currency would follow USD-3 (a note, never converted) | No currency decision is needed later | MK-5a |
| FC-9 | **Generic names stay free in code.** New payload keys, components and copy constants are AI-specific (`aiCost`, `aiMargin`, `AI_COST_*`); `costs`, `grossMargin`, `operatingMargin` and `OtherCosts*` are not used (§11 SA-11) | The future work can add them without renaming or colliding with today's code | All slices (SA review) |
| FC-10 | **The future cost source is its own repository.** When it comes, other costs come from their own data (entered by an admin, or imported from a provider bill), through `lib/repositories/`, never from the credit ledger or `token_usage` | Keeps FC-5 enforceable by structure | A rule for the future work (CLAUDE.md rule 1) |

---

## 14. Terminology: OPEX, cost of revenue and margins

**The common terms, in plain words.**

| Term | What it means for a SaaS business | Does it fit our figures? |
|---|---|---|
| **Cost of revenue** (COGS, "cost of goods sold") | Costs that rise and fall with customer usage and are needed to deliver the service: hosting the product, third-party APIs per use, payment processing fees, customer support | **AI cost is cost of revenue.** It is driven by customer use, and we even bill it back in credits. Stripe fees (the 6b estimate) are cost of revenue. The usage-based part of Vercel would be too |
| **OPEX** (operating expenses) | Costs of running the company that do not grow with each customer's use: tools, source control, development and staging hosting, marketing, salaries | **Not AI cost.** GitHub, the fixed Vercel plan and most other tools would be OPEX |
| **Gross margin** | Revenue minus all cost of revenue | Not yet: we deduct only AI cost (and estimate Stripe fees). Calling today's figure "gross margin" would overstate it |
| **Contribution margin** | Revenue minus variable costs, per customer or per plan. It says whether each extra customer adds money | **This is what "AI margin" per account really is**, with AI as the only variable cost counted so far. It is useful language for the Accounts tab, but less familiar to an owner than "margin" |
| **Operating margin** | Gross margin minus OPEX | Only possible once fixed costs are tracked |
| **Fixed vs variable** | Fixed: the same each month (a plan price). Variable: grows with usage | The future costs will be both (§13). AI cost is variable |

**Recommendation.**

1. **Do not call AI cost "OPEX".** It is usage-driven and tied to revenue, so it belongs to **cost of revenue**. Labelling it OPEX would be wrong today, and wrong again once real OPEX (tools, fixed hosting) arrives.
2. **Keep "AI margin" as the label now.** It is accurate: it says exactly what is deducted. Renaming it to "Gross margin" would be inaccurate, because hosting and real fees are missing. Its tooltip gains one line: **"A partial gross margin: only AI cost is deducted so far. Stripe fees are an estimate beside it."** (Q-13.)
3. **Plan the later ladder, without building it:**
   - **Revenue**;
   - minus **cost of revenue** (AI, the usage share of hosting, and payment fees) gives **Gross margin**;
   - minus **OPEX** (fixed tools and fixed hosting) gives **Operating margin**.

   "AI margin" stays as the first, partial step on that ladder.
4. **Keep the page name "AI cost".** The page is about AI alone: ledger checks, the leak check, fallback prices, calls. When other costs come, they belong in a "Costs" view on Finance, where AI cost is one line linking to this page. Renaming the page "Costs" now would promise lines that do not exist (Q-14).
5. **The smallest accurate change now:** no rename. Add one tooltip sentence to "AI margin" (in MK-0 or MK-5 copy). Add the word "usage" to the AI cost page's purpose line: "What AI usage costs us, did we charge for it, and is the charging correct?". That costs nothing and grows cleanly into the later ladder.

---

## 15. Out of scope

- Any new money source, Stripe API call, FX, or write action (FIN NG-1 to NG-4).
- **Other operating costs** (hosting, source control, CI, tools; fixed or variable): no entry, table, import, KPI or UI (§13).
- The Businesses page and its drawer actions (credits, boosts, Plan billing): they stay outside Money (BD-21, BD-23).
- Model pricing, Plans & entitlements, Scheduled jobs & queues: linked, not moved.
- Showing test and live revenue separately (DF-3 stays deferred).
- A "Reactivated this month" figure for returning payers (§5.1 G-3), unless the user asks for it.

---

## SA Requirement Review — 2026-10-19

**Reviewed by SA against `origin/main` `2e1d49b1` (R4 #471 and P-8a merged).**
**Status: APPROVED WITH CONDITIONS (SA-RR-MK).** The two-page shape, the KPI set and the slice order are sound. Each MK workplan must apply the rulings below. **The four corrections that change the plan are SA-1, SA-2, SA-8 and SA-10.** No business decision is reopened.

### Code facts checked

| Claim | Result on main |
|---|---|
| "No new read" for A-K1 from the credit report rows (§2, SA-1) | **Not quite.** `creditReport.ts:274-283` reads charge rows **only for the accounts that have a totals row** (`accountIds = totals.map(user_id)`), and `:323` drops `user_id` NULL. So rows of **deleted accounts are never read** there, and the "deleted accounts line" (§2) cannot come from those rows. See SA-1 |
| MRR "no new database read" (F-K2) | ✅ It holds: `planMrr.ts` plus `BusinessOsBillingAdminReadRepository.listBillingRowsForModeAllAccounts`, with the current mode resolved in `lib/admin/billing` (R4 pattern). But the strip shows F-K2 on page load, which decides *how* it is read (SA-2) |
| Converted this month: billing events have `livemode`, `kind`, `amount_minor`, `paid_at` | ✅ (P-8a §1.1). **But the Finance read repository may not name `livemode` at all** (`finance.source.guard.test.ts:441-444`, BD-14), so the read cannot live there (SA-10) |
| `useDrawerResource` (SA-5) | ✅ **Already exists** on main (`app/admin/components/layout/useDrawerResource.ts`, LAY C-9). No new shared export |
| Radix tooltip in `components/ui` (SA-8) | **Does not exist.** `package.json` has no `@radix-ui/react-tooltip` and `components/ui/` has no tooltip (SA-8) |
| Vocabulary guard | It scans an explicit file list (`aiCostVocabulary.source.guard.test.ts:39-55`). New AI cost page files must be added to it (MK-3) |
| Redirects | `next.config.js` `redirects()` exists (the M-5 pattern) |

### Answers to SA-1 to SA-11

| # | Ruling |
|---|---|
| **SA-1** | **Changed.** A-K1 must be **the same computation as Finance's F-K3**, not a recount over the credit report's rows. The AI cost route calls the existing ledger read (R-a, `listRowsOfAllAccountsCreatedInRange` / `…ForAccount…`) and Finance's existing charged-cost builder, for the page's window. That is no new repository method, and deleted accounts are included (FIN SA-Q6), so "same window, same number" holds **by construction**. At the ledger ceiling it shows "at least", as Finance does. The period table keeps the credit report and its whole-periods label |
| **SA-2** | **Changed.** F-K2 sits in the strip, which renders on load. Fetching the subscriptions route from the tab would be a second request on load and would break AC-173's one-fetch pin. **MRR goes in the finance payload**, via a `lib/admin/billing` wiring function (the current-mode rows plus `computeMrr`; no new repository method). That is **one ruled AC-145 update in MK-4**. The Subscriptions **list** on the Plans & subscriptions tab may call the existing subscriptions route **only when that tab is opened**, pinned in its own test (the 8.3 history precedent) |
| **SA-3** | **Accepted.** Reuse M-4's injected usage reads through the AI cost route; no new repository method |
| **SA-4** | **Accepted, narrowly (C-4).** An explicit allow-list of the Plans & subscriptions tab's files and the one MRR-tile copy constant may carry mode wording, with a planted control. `lib/business-os/finance/**` still names no mode and no `livemode`. The mode **decision** stays in `lib/admin/billing`, and the payload carries only a value such as `stripeMode: 'test' \| 'live'`. Revenue received carries no label (BD-20) |
| **SA-5** | **Reuse `useDrawerResource`** (it exists). There is no new shared export. MK-8 is still full cycle, because the plan and period drawers need reads or routes |
| **SA-6** | **Accepted.** `/admin/ai-cost`, tabs `checks` and `calls`. **Temporary** redirects in `next.config.js`: `/admin/finance/charges` → `/admin/ai-cost?tab=checks`, `/admin/analytics` → `/admin/ai-cost?tab=calls`, `/admin/subscriptions` → `/admin/finance?tab=plans`. The query (`range`, `account`, `scope`) must survive, with a test per redirect. The Health tile and every in-app link point at the new paths (no internal link relies on a redirect) |
| **SA-7** | **Yes.** MK-2 changes credit-deduction 4a behaviour. Its pins, Pin C's request literals (the default window moves from 30 days to This month) and the 4a tests are **ruled updates listed in the MK-2 workplan**, each with the before/after value |
| **SA-8** | **Changed: no new dependency.** Build a small accessible tooltip in `app/admin/components/layout/`: the icon is a focusable element with an accessible name; the tooltip has `role="tooltip"`, is linked by `aria-describedby`, shows on hover and focus, and closes on Escape. It is CSS-positioned and needs no package. Adding `@radix-ui/react-tooltip` would be a new dependency for one hover; take it only if the user later wants tooltips app-wide. MK-0 stays full cycle (shared export, LAY R-7), and the contrast and C-14 guards cover it |
| **SA-9** | **Accepted.** `formatUsdSign(line)` sits beside the existing formatter and accepts **one USD line**; it refuses (returns null) for any other code. `groupByCurrency` is untouched. The "USD " copy guard exempts the drawer's own-currency client payments (USD-4) and SQL check files |
| **SA-10** | **Changed home.** The first-payment read is mode-aware, so it **cannot** go in `BusinessOsFinanceReadRepository` (repo-wide no-`livemode` rule). It is a new method on **`BusinessOsBillingAdminReadRepository`**: the earliest `invoice_paid` with `amount_minor > 0` per account in one mode, for a list of account ids. The `.in()` list is chunked at ≤ 100 ids, each chunk is paged at ≤ 1,000, and reaching the ceiling is an error. It is wired through `lib/admin/billing` (the R4 pattern) and lands in the finance payload (an AC-145 ruled update in MK-5b). The billing-table reader list gains nothing (same repository) |
| **SA-11** | **Accepted.** AI-specific names only (`aiCost`, `aiMargin`, `AI_COST_*`). `costs`, `grossMargin`, `operatingMargin` and `OtherCosts*` stay unused. Each workplan's source guard adds a check that those names do not appear in the Money files |

### Rulings on guards, pins and display

**Guards.**
- **routerPlacement:** any new code that reads billing data goes in `lib/admin/billing/`, never in `lib/business-os/billing/`, and the allow-list is never widened (R4 lesson).
- **Vocabulary guard:** MK-3 adds the new AI cost page files to its scan list. If the bare page or nav title "AI cost" trips it, that is one ruled ALLOWED entry for the title only. Figures keep "Charged AI cost" and "Recorded AI cost".
- **Layout guards:** new pages and tabs register in the C-14 registry, the nav test (Money: 4 → 2 entries) and contrast `PAGES`, in the slice that adds them.

**`KpiTile` `indicator` (MK-0).** It is an optional prop, so existing callers are byte-unchanged and **Pin A is unchanged in MK-0**. **The first Finance use waits for MK-5**, so Pin B is re-frozen once rather than twice.

**Pins each slice moves.** Every move is a ruled re-freeze recorded in that slice's workplan, with old and new hashes and the reason. Never a silent edit.

| Slice | Pins moved | Ruling |
|---|---|---|
| MK-0 | None | Shared prop and its own tests only |
| MK-1, MK-6, MK-7 | None expected (markup and copy only; the payload is unchanged) | UI short path. If Pin B or AC-145 moves, stop and raise it to SA |
| MK-2 | **Pin C** (Charge checks request literals, default window) | One ruled re-freeze |
| MK-3 | **Pin C** again (the page moves under `/admin/ai-cost`), and **Pin D only if** a Health tile href lives in the hashed rules or vocabulary shape | One ruled re-freeze each, in MK-3. Prefer keeping hrefs outside Pin D's shape |
| MK-4 | **AC-173 part B** (route schema: `tab` gains `plans`), **AC-145** (payload gains `mrr` and `stripeMode`) | One ruled re-freeze each. The new tab request literal is pinned in its own test, never added to the AC-173 table |
| MK-5 with MK-5a | **Pin B** (the strip re-cut, the `$` values and the indicator), **Pin A** (the new Finance KpiTile usage), **AC-145** (paying % fields) | **Fold MK-5a into MK-5**, or land it immediately before in one PR, so Pin B is re-frozen once. MK-3 builds `formatUsdSign` if it lands first, and MK-5 reuses it |
| MK-5b | **AC-145** (the converted fields) | One ruled update |
| MK-8, MK-9 | AC-145 only if a payload key is added | Ruled, if so |

**`$`-only vs "never sum across currencies".** They are **compatible**. The display picks the USD line out of the per-currency grouping; it never adds lines and never converts. Conditions:
- the formatter accepts exactly one USD line (SA-9);
- the "plus n in other currencies" count is a count, never an amount;
- exactness (K-5's "exact per currency") is still decided per line;
- a tile whose USD line is unknown shows Unknown, never the other lines.

**Redirects:** see SA-6. They are temporary (307), keep the query, and are tested. The old API routes stay as they are.

**Estimates.** About 21 to 24 days still holds. SA-1 adds about 0.25 day to MK-2 (wiring the existing ledger read into the AI cost route). Folding MK-5a into MK-5 removes one Pin B re-freeze. SA-8 builds the tooltip in house instead of adding a package, at the same cost. MK-3 (about 2.5 to 3 days) is the tightest: its workplan must list Pin C / Pin D, the redirects, the vocabulary scan list and the nav tests before code starts.

**5b (§11N on `feature/bos-finance-health-5b`).** Its **MRR part is superseded by MK-4**: MRR comes from `planMrr.ts` through the finance payload (SA-2), and its mode-wording ruling folds into C-4 / SA-4. **The rest becomes MK-9** (paying exactness, trial-to-paid), after MK-5b. §11N is not built as written. BA marks it superseded in FIN §0.1 when it splices this review.

### Conditions for BA (before the MK-0 workplan)

- **MK-C1:** in §2's "Approved fix", replace "rows already read for the period check" with the SA-1 ruling: the same computation as F-K3 over the ledger read, with deleted accounts included.
- **MK-C2:** in §5, the F-K2 and F-K5b rows and §5.1's "New read" paragraph state the SA-2 and SA-10 homes (finance payload; billing admin read repository).
- **MK-C3:** in §12, MK-5a is folded into MK-5 (or the same PR), with MK-0 / MK-5 Pin B noted.
- **MK-C4:** BA records the C-1 to C-8 decisions as BD entries in FIN §0.2, and splices the 5b supersession into FIN §0.1.

**Conditions applied by BA, 2026-10-19:**
- ✅ **MK-C1** applied in §2 "How the tile is computed".
- ✅ **MK-C2** applied in §5 (F-K2 and F-K5b rows) and §5.1 "New read".
- ✅ **MK-C3** applied in §12 (MK-5a row, MK-0 row and order point 6, with the MK-0 / MK-5 Pin B note).
- ✅ **MK-C4** applied in FIN: C-1 to C-8 are **BD-38 to BD-45**; the Page 1 rules are **BD-46** (icon), **BD-47** (`$`-only), **BD-48** (Paying accounts %), **BD-49** (Converted this month); Q-10 to Q-12 are **BD-50 to BD-52**; Q-13 and Q-14 are **BD-53 and BD-54**. FIN §0.1 marks 5b superseded (MRR by MK-4, the rest as MK-9) and gains a pointer row for MK-0..MK-9.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-18 | Created | BA scoping and review document for the user: two pages (Finance, AI cost), KPI per block in the user's four-part format, AI cost mismatch traced, removal and merge map, decisions changed (C-1 to C-7), 5b positioning, Q-1 to Q-9 with defaults, slices MK-1 to MK-9 |
| 2026-10-18 | User review of Page 1 applied | (1) Leading or lagging icon on every KPI, with a hover and focus tooltip (§3.3, LL-1 to LL-5). (2) Finance in `$` only: our own money checked in the code (plan prices, plan invoices and boost packages are USD-only, by guard), display rule USD-1 to USD-6 with no FX and no cross-currency sum, C-8 added, client payments as Q-10 (§3.4). (3) Paying accounts as a %, plus Converted this month, defined with the denominator, data source (`first_paid_at` vs billing events), gaps G-1 to G-4 and a default of billing events in the current mode (§5.1, Q-11, Q-12). SA-8 to SA-10 added; slices MK-5a and MK-5b added; Page 2 marked on hold. Mockup added: `docs/requirements/mockups/ADMIN_FINANCE_PAGE1_MOCKUP.html` |
| 2026-10-19 | Page 1 accepted by the user | Page 1 (Finance) accepted with the user's three feedback points applied (icons, `$`, Paying accounts % with Converted this month). Q-10, Q-11 and Q-12 answered: the user accepted each default. Q-1 to Q-9 stay open. Page 2 (AI cost) now under the user's review; mockup added: `docs/requirements/mockups/ADMIN_AI_COST_PAGE2_MOCKUP.html` |
| 2026-10-19 | **APPROVED by the user**; final for SA review | Page 2 (AI cost) approved with no mockup review; Q-1 to Q-9 accepted at their defaults, so Q-1 to Q-12 are all answered. Page 1 rules (icons, `$`) applied to Page 2 (§4, §5). Block KPI "Businesses with uncharged calls" added to the Leak check (§4.2, §5, §6 item 26). New §13 "Future: other operating costs (not in scope)", with design rules FC-1 to FC-10 and an explicit statement that no expense entry, table or UI is in scope. New §14 terminology evaluation (cost of revenue, OPEX, gross, contribution and operating margin, fixed vs variable): recommends keeping "AI margin" and "AI cost", plus one tooltip sentence; new open questions Q-13 (margin name) and Q-14 (page name), each with a default. SA-11 added. Slice MK-0 (shared leading or lagging icon, built once for both pages) added; MK-3 and MK-5 adjusted; total about 21 to 24 days. Old §13 "Out of scope" is now §15 |
| 2026-10-19 | Q-13 and Q-14 answered | User: keep the current names ("AI margin", "AI cost"); the tooltip sentence on AI margin is kept (§14). Committed and sent to SA for the requirement review |
| 2026-10-19 | SA requirement review: **APPROVED WITH CONDITIONS** (SA-RR-MK) | Checked against main `2e1d49b1`. SA-1 changed (A-K1 = the F-K3 computation over the ledger read; the credit report never reads deleted accounts' rows). SA-2 changed (MRR in the finance payload, one AC-145 ruled update; the list fetches only on its tab). SA-8 changed (in-house accessible tooltip, no new dependency). SA-10 changed (the first-payment read goes in the billing admin read repository, not the finance one). SA-3 to SA-7, SA-9 and SA-11 accepted. Pin moves ruled per slice; MK-5a folds into MK-5. `$`-only is compatible with never-sum. Conditions MK-C1 to MK-C4 for BA. Estimate holds |
| 2026-10-19 | BA: SA conditions MK-C1 to MK-C4 applied | MK-C1: §2 tile computed as F-K3 over the ledger read, deleted accounts included. MK-C2: §5 F-K2 / F-K5b rows and §5.1 name the finance payload and `BusinessOsBillingAdminReadRepository`. MK-C3: §12 folds MK-5a into MK-5, with the MK-0 / MK-5 Pin B note. MK-C4: FIN §0.2 BD-38 to BD-54 and log line; FIN §0.1 5b superseded and MK-0..MK-9 pointer row; FIN Change History row. Status: ready for the MK-0 workplan |
| 2026-10-19 | RM: MK-0 committed, PR #474 opened, auto-merge on | Commit `9583426c` on `feature/admin-money-mk0-kpi-indicator` (main `d50ce806` had not moved). `KpiTile` `indicator` prop and `KpiIndicator`; in-house accessible tooltip, no new dependency; icon beside the link; Escape consumed only while open (QA-MK0-N1). No visible change until MK-5; seven pins unchanged. Re-run: admin components, finance, layout and contrast guards 59 / 1949; test:authz-guard 203; test:bos-entitlements 8997. §12 MK-0 row updated. |
| 2026-10-19 | RM: MK-1 committed, PR #475 opened, auto-merge on | Commit `12b34dcc` on `feature/admin-money-mk1-names-block-kpis` (main `0ca7ea6f` had not moved). Takings renamed "Client payments (the businesses' money, not ours)" and moved last; two block KPI headlines with MK-0's leading icon; payload, seven pins and AC-145 unchanged. Re-run: finance, admin components, vocabulary, contrast and layout guards 60 / 2143; test:authz-guard 203; test:bos-entitlements 8998. §12 MK-1 row updated. |
| 2026-10-19 | RM: MK-4 committed, PR #476 opened, auto-merge on | Commit `44667683` on `feature/admin-money-mk4-plans-subscriptions-mrr` (main `4583d21e` had not moved). MRR and `stripeMode` in the finance payload (same rule as Subscriptions), Recurring now line, Plans & subscriptions tab, `/admin/subscriptions` redirect with the old page deleted, mode-wording allow-list. AC-145 ruled re-freeze to `30275c29…`, other pins unchanged; no migration. Re-run: finance, users, admin components, admin billing, finance lib, finance route and admin guards 117 / 5103; test:authz-guard 203; test:bos-entitlements 9004; tsc clean on touched files. §12 MK-4 row updated. |
| 2026-10-19 | RM: MK-5 committed, PR #478 opened, auto-merge on | Commit `0dee536a` on `feature/admin-money-mk5-strip-usd` (from main `c60e2f93`); it also carries the MK-4 workplan QA-status fix. origin/main (`b71dc81d`, exchange rates 1a #477) merged in `4d25efdd`: one conflict in Pin A, where both sides appended cases; both kept (#477's three A2 cases, then MK-5's five A3 cases), every per-case hash unchanged, file hash now `e7d8da20`. Pin B `a1b3db0c` and AC-145 `a13f1ccd…` as ruled; AC-173, Pin C and Pin D unchanged. Re-run: finance, finance lib, finance route, admin components, admin guards and exchange rates 88 / 4478; test:authz-guard 203; test:bos-entitlements 9026. §12 MK-5 row updated. |
| 2026-10-20 | RM: MK-5b committed, PR #485 opened, auto-merge on | Commit `4747c281` on `feature/admin-money-mk5b-converted-this-month` (from main `f87eccda`); origin/main (`adb1c6e8`, #482 to #484) merged in `48796149` with no conflicts. Converted this month in the Paying accounts tile and the Plans & subscriptions list; two new bounded reads; AC-145 ruled re-freeze to `23a12c7e`, other pins equal main; no migration. Re-run: finance, admin billing, finance lib, repositories, finance route, admin components and admin guards 206 / 7366; test:authz-guard 203; test:bos-entitlements 9157. MK5B-FU-1 (performance, about 1,700 paying accounts) in FIN §0.4. §12 MK-5b row updated. |
| 2026-10-20 | RM: MK-6 committed, PR #489 opened, auto-merge on | Commit `4ee3b61d` on `feature/admin-money-mk6-payment-problems` (from main `4f1514f4`); origin/main (`65c26642`, through #488) merged in `559a6745` with no conflicts. Payment problems section removed; boost problems in Revenue, client problems in Client payments ("not ours" kept); blocks byte-identical; no payload change, pins equal main. Re-run: finance, admin components and guards 68 / 3619; test:authz-guard 203; test:bos-entitlements 9157. §12 MK-6 row updated. |
| 2026-10-21 | RM: MK-7 committed, PR #491 opened, auto-merge on | Commit `af030efb` on `feature/admin-money-mk7-history-under-kpis` (from main `5e6e489c`); origin/main (`930a6cee`, #490) merged in `340b4764` with no conflicts. History block removed; plan-mix and credits trends under their blocks with one shared on-demand read, still one fetch on load; byte-identical rendering; pins equal main. C-7 deferred to MK-3. Re-run: finance, finance and history routes, admin components and guards 70 / 3776; test:authz-guard 203; test:bos-entitlements 9158. §12 MK-7 row updated. |
| 2026-10-25 | RM: MK-8 committed, PR #510 opened, auto-merge on | Commit `68f22190` on `feature/admin-money-mk8-finance-drawers` (from main `ff4a676f`); the first push on 2026-10-21 was refused (GitHub account suspended) and went through once access was restored. origin/main (`3a70e98a`, through #507) merged in `b187d774` with no conflicts and no file changed on both sides. Read-only business drawer (existing finance route) and plan drawer (new `GET /api/admin/business-os/billing/plans/[planId]`, `requireAdmin` first); one read on open, still one fetch on load; CR-1 one plan-membership predicate; no payload key, pins and AC-145 unchanged; no migration. Re-run: finance, admin billing and plans route 32 / 988; guards 19 / 2044; pins 6 / 216; test:authz-guard 203; test:bos-entitlements 9227. §12 MK-8 row updated. |
| 2026-10-26 | RM: MK-9 and MK-10 committed, PR #513 opened, auto-merge on | Commit `c9b1fc20` on `feature/admin-money-mk9-paying-trial` (on main `e0d64fb2`, which had not moved; no merge needed). Paying breakdown and trial-to-paid reusing MK-5b's read; MK-10 shared row open; AC-145 ruled re-freeze to `33340751…`, no pin file changed; no migration. Re-run: finance, users, admin components, billing, finance lib, finance route, guards and pins 167 / 9225; test:authz-guard 203; test:bos-entitlements 9243. The user owes a production run of `scripts/check-bos-finance-paying-comped.sql` and `scripts/check-bos-finance-trials.sql` (informational, does not gate the merge). §12 MK-9 and MK-10 rows updated. |
