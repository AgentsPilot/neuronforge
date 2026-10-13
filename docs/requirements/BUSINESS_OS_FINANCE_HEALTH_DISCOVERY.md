# Discovery: Business OS Finance / Business Health Admin Page

> **Last Updated**: 2026-10-09

**Created by:** BA
**Date:** 2026-10-09
**Status:** Discovery only. This is not a requirement and has not been reviewed by SA. It feeds the requirement that comes next.
**Checked against:** worktree `neuronforge-finance-health` (latest `main`) for code and migrations. The live production database was checked separately on 2026-10-09: [BUSINESS_OS_FINANCE_HEALTH_LIVE_SCHEMA.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_LIVE_SCHEMA.md) (cited below as **LS**).

## Overview

The user wants a read-only, admin-only **Finance / Business Health** page. It would show figures per month, with a strip of red and amber KPI tiles at the top (like `/admin` Health) and six sections below: customers by plan, revenue, AI cost against revenue (margin), credits, the growth funnel, and payment problems. This document records what the code and the live database **actually** hold, with file:line for every claim. For each section it says which numbers can already be produced, which cannot and why, and what can be reused. It then lists the business questions for the user and proposes a first slice.

> **Live-schema status.** Every Business OS table checked matches its migrations column for column (LS:151). Where this document cites a migration for a Business OS table, the columns are therefore **live-verified**. CHECK constraints, indexes and function bodies are **not** live-verified (LS:17, LS:163). Some tables exist only in the dashboard and have no migration: `token_usage`, the `daily_token_usage` and `monthly_token_usage` views, and `exchange_rates`, among others (LS:152-162).

---

## Table of Contents

0. [The live data today](#0-the-live-data-today)
1. [Summary table](#1-summary-table)
2. [Section 2: Revenue](#2-section-2-revenue)
3. [Section 1: Customers by plan](#3-section-1-customers-by-plan)
4. [Section 3: AI cost against revenue (margin)](#4-section-3-ai-cost-against-revenue-margin)
5. [Section 4: Credits](#5-section-4-credits)
6. [Section 5: Growth funnel (invites)](#6-section-5-growth-funnel-invites)
7. [Section 6: Payment problems](#7-section-6-payment-problems)
8. [KPI strip (red / amber)](#8-kpi-strip-red--amber)
9. [Page layout, menu and shared patterns](#9-page-layout-menu-and-shared-patterns)
10. [Cross-cutting constraints](#10-cross-cutting-constraints)
11. [Business questions for the user](#11-business-questions-for-the-user)
12. [Recommended first slice and later slices](#12-recommended-first-slice-and-later-slices)
13. [Change History](#change-history)

---

## 0. The live data today

There are **two money layers**, and the page must never mix them (LS:19-24):

| Layer | Meaning | Tables | Live rows (2026-10-09) |
|---|---|---|---|
| **A: Platform revenue** | Business owners paying **AgentPilot** (plans, boosts) | `business_os_billing_accounts`, `business_os_billing_events`, `business_os_boost_purchases` | **0, 0, 0** (LS:34, LS:44, LS:65) |
| | Plans and cohorts | `business_os_account_plans` | **8 rows. `tier` is NULL on all 8, every one is cohort `champion`** (7 `backfill`, 1 `invite`) (LS:49) |
| | Credits and AI cost | `business_os_credit_charges` / `business_os_credit_totals` / `business_os_credit_lots` / `business_os_credit_lot_draws` | 265 / 6 / 1 (`admin_grant`) / 1 (`reversal`) (LS:79-86) |
| | Invites | `business_os_invites` | 2 rows: both issued by an admin, both `champion`; sent 2 of 2, opened 1 of 2, accepted 1 of 2 (LS:101-105) |
| **B: Business takings** | A business's **clients** paying **the business** (Stripe Connect) | `payment_transactions`, `payment_refunds`, `payment_invoices`, `payment_plans`, `payment_plan_subscriptions`, `payment_plan_installments`, `payment_reminders` | 97 transactions (**USD 59, ILS 38**); 34 refunds; 126 invoices; 16 plans; 6 client plan subscriptions; 51 instalments; 168 reminders (LS:122-134) |
| Legacy agent platform (not Business OS) | | `user_subscriptions`, `credit_transactions`, `billing_events`, `subscription_invoices`, `boost_pack*`, `exchange_rates` | Must not be used (LS:26, LS:138-145) |

**What this means for the page:**
- **Platform revenue, MRR, churn, failed plan payments and boost revenue are zero or empty today** (LS:167).
- **Every account is a Founding Partner with no tier**, so "customers by tier" shows one bar.
- The only money data with real rows is **layer B**, which is the businesses' revenue, not ours.
- Every Business OS finance table holds fewer than 300 rows, so bounded reads in Node are fine. Only `token_usage` (about 29.6k rows, growing by about 5k a month) needs an aggregate (LS:174-176).

---

## 1. Summary table

| Section | Data (live) | Producible today | Main blocker |
|---|---|---|---|
| 1 Customers by plan | 8 plan rows, all champion, no tier | Counts by cohort and lifecycle state; open-ended free access; new accounts per month; expiring soon | No tiered or paying accounts; no plan history, so **no churn** |
| 2 Revenue (platform) | 0 rows | Nothing but zero | P-3b.2 not merged; no live money; boost checkout not open; no fee column |
| 2' Business takings (layer B) | 97 transactions, USD and ILS | Takings per month **per currency**, refunds, Stripe fees (partly) | Must be grouped by currency; it is not our revenue (BQ-1) |
| 3 AI cost against revenue | 265 charges; ~29.6k `token_usage` rows | AI cost per month, per account, per current cohort | No platform revenue to set it against; cost is per `user_id` only |
| 4 Credits | 6 totals, 1 grant, 1 take-back | Allowance against used per account; accounts over allowance; gifts outstanding | Credit periods are per-account anniversaries; lots are never consumed yet |
| 5 Growth funnel | 2 invites | Issued → sent → link opened → account created → accepted | Tiny volume; "paid" has no writer; "active after 30 days" undefined |
| 6 Payment problems | Platform: 0 rows. Takings: client plan failures, refunds, 168 reminders | Business-side problems only | Platform failures need P-6a; meaning of the section is BQ-2 |

---

## 2. Section 2: Revenue

### 2.1 What exists: platform revenue (layer A)

**Plan payments (Stripe subscriptions)**

| Item | Evidence | Note |
|---|---|---|
| Billing record per account per Stripe mode: `business_os_billing_accounts` (`stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `bought_tier`, `current_period_end`, `cancel_at_period_end`, `pending_tier`, `last_paid_at`, `last_payment_failed_at`, `failed_attempts`, `ended_at`, `founder_discount_applied_at`, `livemode`) | `supabase/migrations/20261025_business_os_billing_accounts.sql:5-28`; unique `(user_id, livemode)` `:30`; index `(livemode, subscription_status)` `:58` | Live, **0 rows** (LS:34-43) |
| Money history: `business_os_billing_events`, append-only. Kinds `invoice_paid`, `invoice_payment_failed`, `payment_action_required`, `subscription_updated`, `subscription_ended`, `refunded`, `dispute_opened`, `dispute_closed`, `mismatch_refused`; `amount_minor`, `amount_tax_minor`, `currency`, `period_start/end`, `paid_at` | `20261027_business_os_billing_events.sql:5-25`; kinds `:31`; currency `'usd'` `:51` | Live, **0 rows**, **no Stripe fee column** (LS:44-48) |
| `business_os_apply_plan_payment` writes the paid row and moves the plan row in one transaction | `20261027_…sql:87-294` | Live; it is a writer, so the page must never call it (LS:59) |
| **No caller yet.** The repository ships with no caller; the webhook handler is P-3b.2 | `lib/repositories/BusinessOsBillingEventRepository.ts:11-16, 33-38` | So no plan revenue row can exist, even in test mode |
| Checkout code is on `main` (P-3a), behind server switches that are off by default | `lib/business-os/billing/planCheckout.ts`, `planCheckoutFlag.ts`, `planPricesFlag.ts`; `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md:343` | |
| List prices: Essentials (`basic`) $79, Autopilot (`pro`) $129, `availableToBuy: false` | `lib/business-os/entitlements/config/tierMatrix.ts:246, 251, 260, 262` | **In code only, not in the database** (LS:171). Stripe is the source of truth for charges (`BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md:283`) |
| No live-mode Stripe event has ever been recorded | `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md:519-525` | |
| Plan admin monitoring is planned, not built: billing panel, subscriptions list, MRR totals (P-8a); webhook health and reconciliation (P-8b) | `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md:291-299, 352-353`; MRR definition `:295` | |
| "Churn, plan mix over time, revenue by month" was put in **Later** | `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md:302` (AM-10) | This page is that item |

**Credit boosts (one-off purchases)**

| Item | Evidence | Note |
|---|---|---|
| `business_os_boost_purchases` (`status`, `price_minor`, `currency`, `amount_subtotal/tax/total_minor`, `amount_refunded_minor`, `paid_at`, `livemode`, `credits_total`, `stripe_dispute_id`) | `supabase/migrations/20261030_business_os_boost_purchases.sql:5-37`; statuses `:51`; currency `'USD'` `:59` | Live, **0 rows**, no fee column (LS:65-71). ⚠️ Casing differs from plan events (`'usd'`) |
| The boost checkout flag stays unset on Vercel until slice 5b.1 is deployed, and then it is on in Production for the test-account list only | `docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md:7` | |
| **No all-accounts admin reader** | `lib/repositories/BusinessOsBoostPurchaseRepository.ts:21-34` | A new `…ForAdmin` read is needed |
| The legacy `boost_pack_purchases` / `boost_packs` (2 and 3 rows) belong to the agent platform | LS:73 | Not a source |

### 2.2 What exists: business takings (layer B)

| Item | Evidence (live) |
|---|---|
| `payment_transactions`: `amount`, `currency`, `status` (succeeded 67, refunded 30), `paid_at`, `refunded_amount`, **`processor_fee`, `net_amount`, `fee_currency`** (fee filled on 46 of 97 rows) | LS:122-125 |
| `payment_refunds` (34, all succeeded); `fee_returned` and `refund_fee` are empty | LS:126-127 |
| `payment_invoices` (126), `payment_plans` (16), `payment_plan_subscriptions` (6: active 5, cancelled 1; `last_failure_at`, `cancelled_at`), `payment_plan_installments` (51; `retry_count`) | LS:128-133 |
| Currencies present: **USD and ILS** | LS:122, LS:172 |

### 2.3 What CAN be produced

- **Platform:** boost revenue and plan revenue per month, once rows exist: sums of `amount_total_minor` / `amount_minor` by `paid_at`, filtered on `livemode`, tax shown separately. **Today every figure is $0.** MRR should reuse P-8a's definition (`:295`), not a second one.
- **Business takings (if the user wants them, BQ-1):** succeeded takings per month **grouped by currency**, refunds, the number of paying businesses, Stripe fees where recorded. The CLAUDE.md `revenue_by_currency` pattern applies.

### 2.4 What CANNOT be produced, and why

| Number | Why not |
|---|---|
| Any platform revenue, MRR or real figure | 0 billing accounts, 0 billing events, 0 boost purchases (LS:167); no live money before the go-live checklist (`BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md:433-462`) |
| **Net platform revenue after Stripe fees** | No fee column on the billing events or boost purchases (LS:168). The boost pricing uses an **assumed** 2.9% + $0.30 (`BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md:282-290`) |
| Plan refunds and disputes | Kinds exist (`20261027_…sql:31`); the writer is P-6b, not built (`BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md:349`) |
| One total across business takings | USD and ILS are both present and there is no FX authority (LS:172; CLAUDE.md). The legacy `exchange_rates` table (43 rows) **must not** be used without an SA decision (LS:145) |
| Refund fees on takings | Columns exist but are empty (LS:169) |
| List price from the database | Not stored (LS:171); it would come from `tierMatrix.ts` |

### 2.5 Reuse candidates

P-8a's MRR definition, and PF-15's rule that admin lists filter on the current `livemode` (`BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md:102`); the boost purchases repository with a new admin read; `lib/payments/refundMath.ts:23-60` for minor-unit conversion (`BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md:340`); the existing `payment_*` repositories (`lib/repositories/PaymentRepository.ts`, `PaymentRefundRepository.ts`, `PaymentPlanSubscriptionRepository.ts`) for layer B.

---

## 3. Section 1: Customers by plan

### 3.1 What exists

| Item | Evidence |
|---|---|
| One plan row per account, `business_os_account_plans` (`tier`, `plan_version`, `tier_expires_at`, `cohort`, `cohort_expires_at`, `onboarding_started_at`, `profile_created_at`, trial and grace pins, `period_anchor`, `origin`, `created_at`) | `supabase/migrations/20261005_business_os_entitlements.sql:83-133`; live (LS:49-54) |
| **Live: 8 rows, all `champion`, `tier` NULL on all** | LS:49 |
| The plan row is mutable and keeps no history; there is no `status` column, and state is derived when read | `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md:96, 98-103` |
| Lifecycle derivation (`active`, `trial`, `champion`, `grace`, `paused`, `unknown`) | `lib/business-os/entitlements/lifecycle.ts:132-258`; `unknown` cases `:137-184`; a tier in force `:187-196`; `past_due` produced by nothing `:193` |
| Trial ("Test Flight"): Essentials preview, 14 days, a one-off 2,000 credits, marked inactive (FYI only) | `lib/business-os/entitlements/config/cohorts.ts:52, 140, 156, 167, 172` |
| Founding Partner: Autopilot at $0, no default end date (NULL = open-ended), 30-day grace | `cohorts.ts:46, 203, 211-214`; `20261005_…sql:99-102` |
| The shadow report already counts `byState`, `byCohort` and `byTier`, lists accounts with no end date, and lists dormant champions | `lib/business-os/entitlements/report.ts:9-16, 116-137, 183`; route `app/api/admin/business-os/entitlements/shadow-report/route.ts:1-21`; no names (`report.ts:18-23`) |
| Churn columns exist for future paying accounts: `ended_at`, `cancel_at_period_end`, and a `subscription_ended` event | `20261025_…sql:14, 24`; `20261027_…sql:31`; LS:39-40 |

### 3.2 What CAN be produced today

- Accounts by cohort and lifecycle state. Today that is 8 Founding Partners. The open-ended ones (no `cohort_expires_at`) and the dormant ones come from the shadow report.
- New accounts per month (`created_at`, `onboarding_started_at`); `origin` (backfill against invite).
- Expiring soon (`cohort_expires_at`, `tier_expires_at`, or the derived trial end).

### 3.3 What CANNOT be produced, and why

| Number | Why not |
|---|---|
| Customers by **tier**, or by paid against free | No account has a tier (LS:49). The breakdown is structurally ready but shows one group today (BQ-3) |
| **Churn** in a month | No paying accounts; `ended_at` and `subscription_ended` have no rows and no writer before P-6a. No plan history exists for free accounts (as-built `:96`) |
| Plan mix at the end of a past month; trial-to-paid conversion | No snapshots; no trials and no payments yet |

### 3.4 Reuse candidates

`buildShadowReport`, `deriveLifecycle`, the plan repository's paged walk (`report.ts:25-29`), and the labels from `presentation` and `cohorts.ts` (`tierMatrix.ts:243-269`; `cohorts.ts:161, 204`).

---

## 4. Section 3: AI cost against revenue (margin)

### 4.1 What exists

| Item | Evidence |
|---|---|
| Credit ledger `business_os_credit_charges`: one row per charged action, with `cost_usd` (measured provider cost), `credits`, `user_id`, `period_start`, `triggered_by`, `created_at` | `supabase/migrations/20261015_business_os_credit_charges.sql:5-24`. **Live: 265 rows, all `charge`; owner 189, scheduled 74, external 2** (LS:79) |
| `business_os_credit_totals`: per account **per billing period** (`cost_usd_total`, `credits_total`, `charge_count`) | `20261015_…sql:56-70`; live, 6 rows (LS:82-84) |
| The ledger starts at the charging cut-over (D-8) | `docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md:7`; `app/admin/business-os-llm/components/activity/CutoverNotice.tsx:1-9` |
| Operator cost report, aggregated in Node (20,000-row ceiling, 92-day window) | `lib/business-os/credits/creditReport.ts:1-9, 70-82` |
| A second, different AI cost source: `token_usage`, in AI cost & usage and on the Health spend tile ("estimated from the model pricing table"; a 1,000-call cap, OI-P1) | `lib/admin/health/evaluateHealth.ts:65-66, 108-109, 386-389, 655-658`. **Live: about 29.6k rows; no business id; dashboard-only, no migration** (LS:87) |
| Live aggregates: `daily_token_usage` / `monthly_token_usage` views (`user_id`, day or month, `total_cost_usd`), and the RPC `business_os_usage_summary(p_since, p_user_id)` | LS:89-95 (views have no migration) |
| Pricing basis: 1 credit = $0.001 of cost, sold at 500 credits per $1 | `BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md:13`; `lib/business-os/entitlements/config/creditRetail.ts:55-60` |

### 4.2 What CAN be produced

- **AI cost per calendar month** from the ledger: 265 rows, so a bounded read is enough.
- AI cost from `token_usage` **only through the monthly view or the RPC**, never a raw scan (LS:176).
- Cost per account and per current cohort. Today that means per Founding Partner.
- A **theoretical** margin per plan from configuration: Essentials $79 against 19,750 credits = $19.75 of cost if every credit is used (`tierMatrix.ts:148, 246`). This is a configuration fact, not a measurement.

### 4.3 What CANNOT be produced, and why

| Number | Why not |
|---|---|
| Real gross margin | Platform revenue is zero (§2) |
| Cost **per business** | AI cost is keyed on `user_id` only, in both sources (LS:87, LS:170). Today one login = one business (`app/admin/components/AdminSidebar.tsx:125-131`), so `user_id` stands in for the business |
| Margin per plan over time | Ledger rows carry no tier, and plan rows keep no history |
| A calendar month from `business_os_credit_totals` | It is keyed on each account's anniversary period (`20261015_…sql:69, 138-170`) |
| Full cost of goods | Email, hosting, Stripe fees and uncharged AI calls are not in the ledger. The ledger and `token_usage` are different figures |

### 4.4 Reuse candidates

`creditReport.ts` (exact integer sums `:28-35`), `effectiveFields.ts`, `BusinessOsCreditLedgerReadRepository.ts` (named all-accounts reads `:41-65`), `TokenUsageRepository` together with the live views (SA to choose).

---

## 5. Section 4: Credits

### 5.1 What exists

| Item | Evidence |
|---|---|
| Allowances: Essentials 19,750 a month, Autopilot 32,250 a month, Founding Partner = Autopilot, trial 2,000 one-off | `tierMatrix.ts:148, 215`; `cohorts.ts:52, 97, 130` |
| Nothing is refused at zero (`ALWAYS_SUFFICIENT`) | as-built `:47` |
| Credits left, as a percentage, for every listed account in one batched pass | `lib/business-os/credits/adminCreditPercent.ts:1-43` |
| Per-account admin credit position, including "over the plan", extra credits, lots and take-backs | `app/api/admin/business-os/credits/accounts/[accountId]/route.ts:1-31` |
| Lots (`admin_grant` / `boost_purchase`) and draws (`reversal` only) | `20261017_business_os_credit_lots.sql:5-21, 27, 72`. **Live: 1 grant, 1 reversal** (LS:85-86) |
| The one definition of "extra credits" | `lib/business-os/credits/creditLots.ts:5-20` |

### 5.2 What CAN be produced

Allowance against used per account and per cohort for the current period; accounts over their allowance; admin-granted credits outstanding (granted − taken back); grants per month and who granted them.

### 5.3 What CANNOT be produced, and why

| Number | Why not |
|---|---|
| How much of a gift was **used** | Lots are never consumed until slice 9 (`creditLots.ts:18-20`) |
| Allowance against used per **calendar** month | Periods are per-account anniversaries |
| Breakdown by tier | No tiers live (§3.3) |

### 5.4 Reuse candidates

`adminCreditPercent.ts`, `adminCreditPositionDeps.ts`, `creditLots.ts`, `BusinessOsCreditLotRepository.ts`, `creditBands.ts`.

---

## 6. Section 5: Growth funnel (invites)

### 6.1 What exists: `business_os_invites`, a timestamp per stage (live: 2 rows, LS:101-107)

| Stage | Column | Evidence |
|---|---|---|
| Issued | `created_at` | `20261012_business_os_invites.sql:28` |
| Issuer | `issuer_kind` (admin or account) | `20261012_…sql:13`; friend invites `20261023_business_os_friend_invites.sql:67-68` |
| Email sent / problem | `email_attempted_at`, `email_sent_at`, `email_problem_at` | `20261020_business_os_invite_email.sql:5-13`; live, 2 of 2 sent (LS:102) |
| **Link opened** | `first_viewed_at`; `opened_by_existing_account_at` | `20261012_…sql:22`; stamped by `markFirstViewed` (`lib/repositories/BusinessOsInviteRepository.ts:15-23`); live, 1 of 2 (LS:103) |
| Account created | `claimed_at` | `20261014_business_os_invite_signup.sql:15-17` |
| Accepted | `redeemed_at` | `20261012_…sql:26`; live, 1 of 2 (LS:105) |
| Failed / revoked / expired | `redemption_failed_at`, `revoked_at`, `link_expires_at` | `20261014_…sql:29`; `20261012_…sql:21, 23` |
| Paid | lineage `first_paid_at` | `20261024_business_os_friend_invite_signup.sql:5-7`; **no writer until P-5** (as-built `:128`); live, 1 lineage row (LS:55-56) |

### 6.2 What CAN be produced

Issued → sent → link opened → account created → accepted, per month, by issuer kind, with the time between stages. With 2 invites, the rates are not meaningful yet.

### 6.3 What CANNOT be produced, and why

"Email opened" is not tracked for invites; `first_viewed_at` (the link was opened) is the stand-in. "Paid" waits on P-5. "Active after 30 days" has no definition yet (BQ-6). One candidate source is owner-triggered ledger charges (`20261015_…sql:18`).

---

## 7. Section 6: Payment problems

### 7.1 What exists

| Item | Evidence | Whose money | Live |
|---|---|---|---|
| Plan payment failures: `failed_attempts`, `last_payment_failed_at`; `invoice_payment_failed` and `payment_action_required` events | `20261025_…sql:20-22`; `20261027_…sql:31` | **Ours** (layer A) | 0 rows; no writer until P-6a (`BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md:348`) |
| Boost failed / expired / refunded / disputed | `20261030_…sql:51` | Ours | 0 rows |
| Stuck or failed webhook claims (never reclaimed; nothing reads them) | as-built `:42, 169`; fix P-8b | Ours (affects both) | not measured |
| Client plan failures: `payment_plan_subscriptions.last_failure_code` / `last_failure_at`; instalment `retry_count` | LS:130-133 | **The businesses'** (layer B) | 6 subscriptions, 51 instalments |
| Refunded client payments | LS:122, LS:126 | The businesses' | 30 refunded transactions, 34 refunds |
| **Payment reminders** (`pending`, `processing`, `sent`, `failed`, `cancelled`) | `supabase/migrations/2026-08-14_payment_reminders_claim.sql:13-20, 29-32` | The businesses' (reminders to their clients) | 168 rows: cancelled 109, sent 50, pending 9 (LS:134) |
| Stuck and dead-lettered reminders are already measured on `/admin/jobs-queues` and Health tile 7 | `lib/admin/jobs/readJobsQueues.ts:1-14`; `lib/admin/health/rules.ts:311-355` | — | — |

### 7.2 What CAN and CANNOT be produced

- **Can:** client-side problems per month (failed client plan charges, refunds, reminders by status). These can link to, or reuse, the jobs & queues figures.
- **Cannot:** platform billing problems. Every platform table is empty, and the writers are P-6a, P-6b and P-8b.

---

## 8. KPI strip (red / amber)

### 8.1 What exists

| Item | Evidence |
|---|---|
| Health's colour rules are data: ordered rules per tile, first match wins, only red or amber, "green is never data" | `lib/admin/health/rules.ts:5-21, 116-125, 168` |
| A pure evaluator that never throws; green only for a code-level `GREEN_ELIGIBLE` set; a lower bound is never green | `lib/admin/health/evaluateHealth.ts:1-29, 99-106, 444-547` |
| Condition kinds `atLeast`, `ratioAtLeast`, `shareAtLeast`, `anyLowerBound`, `flag`; a new kind is code and needs SA | `rules.ts:23-37, 97-114` |
| The tile types are closed over Health's tile ids | `rules.ts:128-164` |

### 8.2 Assessment

The pattern can be reused; whether to extend Health's types or add a sibling rule set is SA's call (CLAUDE.md rule 7). Tiles with real data today:
- AI cost this month against last month;
- accounts over allowance;
- Founding Partners with no end date (8 of 8 today, if none has an end date);
- admin credits outstanding.

Revenue and margin tiles would show $0. They should wait, or show "no revenue yet" as grey, never green. Every existing condition kind rises with its metric. "Margin fell below X" is a new kind and needs SA.

---

## 9. Page layout, menu and shared patterns

| Question | Finding | Evidence |
|---|---|---|
| Where is the menu defined? | One data array: Monitor, Businesses, Settings, and a hidden AgentsPilot section | `app/admin/components/AdminSidebar.tsx:82-302`; nav test pin `:78-80` |
| Is a new page protected automatically? | Yes (layout `requireAdminPage`); its route needs `requireAdmin` | `docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md:117`; `app/admin/page.tsx:7-9` |
| A shared admin page standard (title and purpose, KPI strip, filter bar held in the URL)? | **None exists.** The IA rules cover only the landing and naming (`ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md:125-130`). The Activity tab keeps its filters in component state, not the URL (`app/admin/business-os-llm/components/activity/ActivityTab.tsx:21-23, 85-87`) | — |
| A date-preset pattern? | Six UTC presets, pure | `app/admin/business-os-llm/activityPresets.ts:1-47` |
| A business picker? | `BusinessAccountPicker`, already reused | imported at `ActivityFilters.tsx:17-20` |
| Exchange rates | `/admin/exchange-rates` is AgentsPilot only, written from the browser and deliberately unlisted. The live table has 43 rows (LS:145). **Not to be used** for this page | `ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md:80, 164` |

**Placement suggestion (for SA):** a new item under **Monitor**, next to Health.

---

## 10. Cross-cutting constraints

| # | Constraint | Source |
|---|---|---|
| X-1 | **Keep the layers apart.** Platform revenue (A) and business takings (B) never share a total or a chart axis | LS:19-24 |
| X-2 | **Never sum across currencies.** Layer A is USD-only by CHECK. Layer B holds USD and ILS, so it must be grouped by currency. No FX: the legacy `exchange_rates` table is not an authority | CLAUDE.md; LS:145, LS:172 |
| X-3 | **Test and live rows share one database.** Filter platform money on `livemode` | PF-15, `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md:102` |
| X-4 | **Sizing.** Business OS finance tables are under 300 rows: bounded Node reads are fine. `token_usage` is used only through `monthly_token_usage` / `daily_token_usage` or `business_os_usage_summary` | LS:174-176 |
| X-5 | Month boundaries in UTC | `activityPresets.ts:1-7` |
| X-6 | Cross-account reads go through **named** all-accounts repository methods on the service role | `BusinessOsCreditLedgerReadRepository.ts:41-50` |
| X-7 | Any import from `lib/business-os/entitlements/` must be registered | CLAUDE.md; `adminCreditPercent.ts:28-32` |
| X-8 | AI cost is per `user_id`. "Per business" holds only while one login = one business | LS:170; `AdminSidebar.tsx:125-131` |

---

## 11. Business questions for the user

Each question has a proposed default and is put in business terms. Technical forks go to SA.

| # | Question | Proposed default | Why it matters |
|---|---|---|---|
| **BQ-1** | **"Revenue" means whose money?** Only what owners pay **us** (plans and boosts), or also what **clients pay the businesses** through us? | Two clearly separate blocks. "Our revenue" is the headline (zero until go-live). "Takings through the platform" (per currency) is shown as a growth signal and never added to ours | Layer B is the only money with real rows. Mixing it in would overstate our revenue |
| **BQ-2** | **Section 6, "payment problems": the platform's own billing failures, the businesses' client-payment problems, or both?** | Both, in two labelled blocks. Ours is empty until plan billing goes live. The businesses' block shows failed client plan charges and refunds, and links to Jobs & queues for reminders | Our side has no data before P-6a. The client side has data now, but it is the businesses' problem |
| **BQ-3** | **Every account today is a Founding Partner with no tier. What should "customers by tier" show?** | Show all six groups (Trial, Founding Partner, Comped, Essentials, Autopilot, Unknown/held) with their real counts. Today that is "Founding Partner: 8, everything else 0", plus the open-ended and dormant counts, which are the useful facts now | Avoids an empty chart and a misleading one |
| BQ-4 | **"Free" against "paying":** is an admin-assigned plan with no payment (a comp) "paid"? | No. Comped is its own group; "paying" means a live Stripe subscription | The data can tell them apart, but someone has to name them |
| BQ-5 | **What is "churned"?** | Paid churn = a subscription ended (`ended_at` / `subscription_ended`). "Trial not converted" and "free access ended" are counted separately | Each needs different data; paid churn needs P-6a |
| BQ-6 | **What does "active after 30 days" mean?** | At least one owner action (an AI action, a booking or an invoice) between day 30 and day 60 after accepting | No activity record exists, so the definition picks the source |
| BQ-7 | **Which costs count in margin?** | AI only, labelled "AI margin". The Stripe fee on our revenue is shown as an estimate, because none is recorded for platform payments (LS:168) | Only AI cost is measured |
| BQ-8 | **Margin per plan:** may a whole month count under the plan an account is on now? | Yes, with a note, until plan history exists | Exact attribution needs a migration |
| BQ-9 | **"Per month":** calendar month or each account's billing month? | Calendar month in UTC for platform totals | Credit periods are per-account anniversaries |
| BQ-10 | **Show test-mode money?** | Live only, with a labelled test-mode switch for demos | All platform data so far is test mode |
| BQ-11 | **KPI thresholds** | AI cost up 50% month on month = amber, doubled = red; any account over 150% of allowance = amber; Founding Partners with no end date = amber (information); any boost or plan dispute = red | Rules are data, so they are cheap to change |
| BQ-12 | **The legacy `exchange_rates` table (43 rows) exists live.** Should it ever be used to show a single combined figure for the businesses' takings? | No. Keep per-currency totals, per CLAUDE.md; any FX use is a separate decision for SA and the user | CLAUDE.md says there is no FX authority; the table is an agent-platform display relic (LS:145) |

---

## 12. Recommended first slice and later slices

Small numbered slices of a few days each, reusing what exists.

### Slice 1: "Accounts, AI cost and credits" (no migration, real data only)

**Scope:**
- A new read-only page under Monitor and one admin route (`requireAdmin` first, Zod, Pino with a correlation id).
- A month picker in the UTC preset style, defaulting to the current month.
- A KPI strip of three or four tiles on Health's evaluator pattern, built only from data that has rows.
- Three sections:
  1. **Accounts by plan:** all six groups with real counts (today Founding Partner = 8); open-ended free access; dormant champions; new accounts this month; expiring soon. Reuses the shadow report's static walk and `deriveLifecycle`.
  2. **AI cost this month:** from the credit ledger (265 rows, a bounded read): total, by current cohort, owner against scheduled, top accounts. Optionally the `monthly_token_usage` total beside it, labelled as a different measure. SA chooses whether to show it.
  3. **Credits:** allowance against used per account; accounts over their allowance; admin credits outstanding. Reuses `adminCreditPercent` and `extraCreditsAt`.
- A **"Platform revenue: none yet"** panel that states why: plan billing is not live and boosts are test-only. No $0 charts.

**Why first:** every figure on it has real rows, it needs no table and no SQL function, and it reuses the shadow report, the credit report, the credit percentage pass and the Health evaluator.

**Needs SA:**
- the finance tile rule set (§8.2);
- whether the shadow report's walk is reused or factored out;
- the ledger read for a calendar month;
- whether `token_usage` is shown, and through which view or RPC.

### Later slices (sketch)

| Slice | Scope | Depends on |
|---|---|---|
| 2 | **Business takings and client payment problems (layer B)**: succeeded takings, refunds and recorded Stripe fees per month **per currency**; failed client plan charges; a link to reminders | BQ-1, BQ-2; real data today |
| 3 | **Growth funnel**: invite stages per month, time to accept, "active after 30 days" | BQ-6; meaningful once there are more invites |
| 4 | **Boost revenue** (live, with a test toggle) | Boost checkout open; a new admin read on the boost repository |
| 5 | **Plan revenue, MRR, trial-to-paid**, reusing P-8a's definition | P-3b.2, P-8a |
| 6 | **AI margin** overall and per current plan; the Stripe fee as a labelled estimate | Slices 4 and 5; BQ-7, BQ-8 |
| 7 | **Platform payment problems and churn**: failures, grace, paused, `ended_at`; webhook health | P-6a, P-6b, P-8b; BQ-5 |
| 8 | **History snapshots** (plan mix, credits) for trend lines and churn of free accounts | A migration and a cron (the `bos_cron_runs` pattern) |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-09 | Created (BA) | Discovery only: as-built map with citations for the six sections, the KPI strip and layout; business questions; first slice proposal. No code changed |
| 2026-10-09 | Live schema folded in (BA) | Added §0 (two money layers, live row counts); marked Business OS columns live-verified per LS:151; recorded that platform revenue, MRR and churn are empty; that all 8 plan rows are tierless Founding Partners; that layer B takings (USD and ILS, with `processor_fee`) exist; that AI cost is per `user_id`; the live aggregates for `token_usage`; that the `exchange_rates` table is not to be used; that the list price is not in the DB. Added BQ-1 (whose revenue), BQ-2 (whose payment problems), BQ-3 (tier view today), BQ-12 (FX table). Slice 1 now limited to data with real rows |
