# Requirement: Business OS Credits Boost (on-demand top-up)

> **Last Updated**: 2026-10-08

**Created by:** BA
**Date:** 2026-09-27
**Status:** **Re-baselined 2026-10-04 against main 1a9944a5: still APPROVED WITH CONDITIONS** (§18.10). The user approved the build. The lots tables come from credit deduction 11a. **Slices:** 0 done (P-0); **1 — merged** ([PR #224](https://github.com/AgentsPilot/neuronforge/pull/224), 2026-10-05; [workplan](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_1_WORKPLAN.md)); **2a — merged** ([PR #233](https://github.com/AgentsPilot/neuronforge/pull/233)) **and applied to PROD 2026-10-06, verified** ([workplan](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_2_WORKPLAN.md) §6.9); **2b — merged** ([PR #235](https://github.com/AgentsPilot/neuronforge/pull/235)) **and applied to PROD 2026-10-06, verified** ([workplan](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_2B_WORKPLAN.md)); **Slice 3 — merged ([PR #247](https://github.com/AgentsPilot/neuronforge/pull/247)); flag must stay UNSET on Vercel until 4a is deployed** (2026-10-06; QA PASS WITH NOTES, both Low notes fixed; SA code review approved; the flag stays off on Vercel until 4a) *(earlier: workplan drafted and SA-approved with conditions C-1 to C-7)* (2026-10-06; [workplan](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_3_WORKPLAN.md)); **slice 5 split 5a/5b (user, 2026-10-07): Slice 5a — merged ([PR #252](https://github.com/AgentsPilot/neuronforge/pull/252)); every owner sees Top up + packages, Buy disabled 'Coming soon'** (2026-10-07; one accessibility fix recommended before the PR; SA code review approved) *(earlier: 5a workplan drafted and SA-approved with conditions C-1 to C-5, 2026-10-07)* ([workplan](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_5A_WORKPLAN.md); 5a shows the packages to every owner with a disabled "Coming soon" Buy, decision B in §16; 5b, the Buy flow and Purchases history, follows 4a); **Slice 4a — committed, [PR #259](https://github.com/AgentsPilot/neuronforge/pull/259) open (user approved 2026-10-08); after deploy the user subscribes the Stripe events (workplan §7); checkout flag still OFF until 5b** (branch update from main waits for RM to commit the 4a work) (2026-10-07; one false-alert fix recommended before the PR; SA code review approved; rule 3 item on `monitoring/page.tsx` to close before the commit) *(earlier: 4a workplan drafted; SA workplan review 2026-10-07: approved with conditions C-1 to C-6)* (2026-10-07; [workplan](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_4A_WORKPLAN.md); awaiting SA review); 4b, 5b and 6 not started; **7 — verify-only** (plan payments P-10 owns FR-40, 2026-10-06). The per-slice history is in the Change History. BQ-B1 is decided (single "Extra credits" figure). **SA reviewed 2026-09-30: APPROVED WITH CONDITIONS** (§18). **Re-validated 2026-10-01 against main 8f18aaf2 and the parallel sessions: still APPROVED WITH CONDITIONS** (§18.8; held accounts refused, migration block 20261030–34, per-slice gates). The §18.6 BA text corrections and the §18.10 rulings were folded into the body on 2026-10-04 (see Change History). No user question raised. *(Previous status: Ready for SA review.)* The user answered the business questions in three rounds (2026-09-27, 2026-09-30, 2026-09-30). No business question is open. One pre-launch dependency remains: the accountant confirms the sales-tax obligation before live launch (§9, DEP-7). *(Superseded: "Not approved"; see the status above and §18.)*
**Based on:** [BUSINESS_OS_CREDITS_BOOST_DISCOVERY.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_DISCOVERY.md) (as-built facts, hazards HZ-1 to HZ-17, user answers in §7).
**Related:** [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md) (the credit value and markup — **the conversion this requirement uses**), [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md) (credit deduction, credit diary), [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) § Metering, [BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md), [BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md](/docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md).

## Overview

A Business OS owner can press **Top up**, choose one of three boost packages (Starter, Plus, Max), pay through Stripe, and have their Business OS **credit** balance increased by the package amount plus any bonus. The purchase is recorded in the Business OS credit ledger and shown in the owner's history, and Stripe sends a receipt. Boost credits are the same Business OS credits that plans include (1 credit = $0.001 of our measured AI cost, sold at 500 credits per $1). They are separate from the AgentsPilot agent-platform balance, and they never unlock a feature. Prices are in **USD only** and exclude tax. This is not a port of the AgentsPilot boost: it reuses that system's proven payment plumbing, and each hazard found in the AgentsPilot implementation (discovery §4) has an explicit requirement that prevents it.

---

## Table of Contents

1. [Decisions this requirement rests on](#1-decisions-this-requirement-rests-on)
2. [Changes to earlier decisions](#2-changes-to-earlier-decisions)
3. [Scope](#3-scope)
4. [User stories](#4-user-stories)
5. [Functional requirements](#5-functional-requirements)
6. [Hazard-prevention requirements](#6-hazard-prevention-requirements)
7. [Non-functional requirements](#7-non-functional-requirements)
8. [Packages and pricing basis](#8-packages-and-pricing-basis)
9. [Tax](#9-tax)
10. [Currency: what exists and the decision](#10-currency-what-exists-and-the-decision)
11. [Acceptance criteria](#11-acceptance-criteria)
12. [Parked items](#12-parked-items)
13. [Dependencies](#13-dependencies)
14. [Out of scope / future roadmap](#14-out-of-scope--future-roadmap)
15. [Technical decisions for SA](#15-technical-decisions-for-sa)
16. [Open questions](#16-open-questions)
17. [Notes on integration points](#17-notes-on-integration-points)
18. [SA Review](#18-sa-review)

---

## 1. Decisions this requirement rests on

The Q numbers refer to discovery §7.

| # | Decision | When |
|---|---|---|
| Q1 | A boost buys the unit Business OS actually meters. **Resolved by the credit deduction work:** that unit is the **Business OS credit** (capability `credits.allowance`, unit `credit`, customer label "Credits"). 1 credit = $0.001 of measured provider cost. | 2026-09-27, resolved 2026-09-30 |
| Q2 / Q3 | **Fixed packages only in v1.** A custom amount comes later. The numbers are adjustable. | 2026-09-27 |
| Q4 | Packages: **"Option A"**: **Starter $10** (5,000 credits, no bonus), **Plus $25** ("Most popular", +10%, 13,750 credits), **Max $50** ("Best value", +15%, 28,750 credits) (§8). The bonus is measured against the standard rate of 500 credits per $1. The aim is to push buyers to Plus and Max with a visible 5-point bonus step. The user **accepts Max dipping below the 70% markup target**. Packages start **in configuration** and must be able to move to a table without a rewrite. | Round 3, 2026-09-30 |
| Q5 | The boost balance is **separate** from the AgentsPilot balance. | 2026-09-27 |
| Q6 | **Every tier and cohort can buy**: trial, champion, basic, pro. | 2026-09-27 |
| Q7 | v1 is **on-demand purchase by the owner**. Rules about when to prompt come later. | 2026-09-27 |
| Q8 | **Currency: USD only for now** (OQ-2 resolved). **Tax: prices exclude tax; we operate in the USA.** For v1, SA picks the simplest tax mechanism that keeps a later switch to collecting tax possible. **The accountant confirms the real obligation before live launch** (a pre-launch dependency, not a blocker; §9). | Rounds 2–3, 2026-09-30 |
| Q9 | Each boost lot has an **optional expiry date** in the data model. **Expiry is not enforced in v1.** | 2026-09-27 |
| Q12 | Purchase cap **$150 per account per rolling 30 days**. No count cap (§5.4, FR-21). | 2026-09-30 |
| Q13 | Boost purchases write into the **Business OS credit ledger**, the same one the credit diary reads. Admin add/remove belongs to the credit deduction work (slice 11), not to this requirement. *(2026-10-04: concretely, a row in `business_os_credit_lots`, built by credit deduction 11a; §5.6.)* | 2026-09-27 |
| Q14 | The AgentsPilot boost checkout is **retired for now**, without destructive deletion. | 2026-09-27 |
| Q15 | v1 has an on-demand **Top up** button. A pop-up when the limit is hit comes later. | 2026-09-27 |
| Q16 | No auto top-up. | 2026-09-27 |
| Q17 | Stripe sends a **receipt**, **and** each boost appears in the **in-app history**. | 2026-09-27 |
| Q18 | Low-balance warnings come later (credit deduction slice 8). | 2026-09-27 |
| Q19 | A boost **never unlocks a feature**. | 2026-09-27 |
| Q20 | Plan allowance and boost balance are **shown separately**. **Refined 2026-10-04 (user):** "separately" means the plan figure and **one "Extra credits" figure** that covers admin grants **and** boost purchases (S11-D-1). There is no separate "Bought credits" line. The purchase history tells bought and granted apart (§18.10). | 2026-09-27, refined 2026-10-04 |
| Q10, Q11 | **Parked** (§12). | 2026-09-27 |

---

## 2. Changes to earlier decisions

| # | Earlier decision | Change | Source |
|---|---|---|---|
| C-1 | **D-8** (entitlements requirement §3): "Boosts … **paid plans only**." | **All tiers and cohorts may buy**. D-7 ("champions do not buy boosts") is superseded on the purchase side. Admin grants remain, owned by credit deduction slice 11. | User, Q6 |
| C-2 | **D-11 / B-4**: customers see a flat count of "AI actions". | ✅ **Resolved, no conflict remains.** The credit deduction work already replaced AI actions with measured-cost **credits** (BD-1 option B; `ai.actions` renamed `credits.allowance` in slice 5, SQ-17). Boosts are denominated in the same credits. D-8's "+250 AI actions for $10" no longer applies. | [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md) §1; [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) Change History 2026-09-30 |
| C-3 | **RD-11** (reuse plan): boosts are in **S-4b**, after metering. | Boost **purchase** may ship before a zero balance is enforced. Recorded as a known dependency (§13, DEP-2), not a blocker. | User, Q7 |
| C-4 | **D-8** 12-month boost expiry; **FR-24** "soonest-expiring first". | Expiry is modelled (optional per lot) but **not enforced in v1**. The consumption order stands as the rule for the metering work. | User, Q9 |
| C-5 | **TK-5** (reuse plan): whether to retire the AgentsPilot boost checkout. | **Retire it for now**, without destructive deletion (FR-40). | User, Q14 |
| C-6 | **Pricing doc D3**: the generous plan allowance "will not drive boost purchases". | Unchanged, and relevant: boosts are expected to matter mainly for **trial** accounts (2,000 one-off credits) and image-heavy use (§8.3). | [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md) §5 |
| C-7 | **Pricing doc D1** (100% markup on plans) | Boosts sell at the same base rate (500 credits per $1). **The Plus and Max bonuses deliberately lower the effective markup**, to 74% and 68% after the Stripe fee (§8.2). The user accepted Max below a 70% target. | User, round 3 |

---

## 3. Scope

| Area | In scope (v1) | Out of scope |
|---|---|---|
| Purchase | On-demand Top up, three fixed packages (Starter, Plus, Max), one-off Stripe payment | Custom amount, auto top-up, subscriptions |
| Who | Every Business OS account with a plan row (all tiers and cohorts) | Agent-platform accounts that have no Business OS plan row |
| Packages | A configuration-defined catalogue that can move to a table later | Admin UI to edit packages (future) |
| Balance | Credit the boost lot to `business_os_credit_lots` (built by credit deduction 11a) | **Consuming** boost lots and refusing at zero (credit deduction slices 9–10, DEP-2) |
| Expiry | Optional expiry field per lot | Enforcing expiry, reminders before expiry |
| Display | Top up button; plan allowance and the single "Extra credits" figure (grants + boosts) shown separately (Q20 as refined 2026-10-04); boosts in the history; package badges and computed bonus % | Limit-hit pop-up, low-balance warnings |
| Receipts | Stripe receipt email + in-app history entry | Tax invoice |
| Tax | Prices shown **excluding tax** (USA); the simplest mechanism that keeps tax collection switchable (§9) | Multi-jurisdiction tax, VAT |
| Limits | $150 per account per rolling 30 days, admin-adjustable per account | Fraud scoring, a count cap |
| Refunds and disputes | Detect, log and flag for an admin; the ledger never silently inconsistent | Refund policy, self-service refunds, automatic clawback rules (parked, Q11) |
| Admin credit add/remove | Interface expectation only (FR-33) | Built by credit deduction slice 11 (11a–11d merged) |
| AgentsPilot | Retire the AgentsPilot boost checkout (non-destructive) | Any change to the AgentsPilot balance or its billing |
| Currency | **USD only** (decided) | Multi-currency, exchange-rate conversion |

---

## 4. User stories

- As a **Business OS owner on any plan**, I want to press Top up, pick a package and pay, so that I have more credits available without changing my plan.
- As an **owner on a trial**, I want to buy credits if my trial credits run low, so that I can keep evaluating the product until the trial ends.
- As an **owner comparing packages**, I want to see clearly how much bonus each larger package adds, so that I can choose the best value.
- As an **owner**, I want to see my plan allowance and my extra credits (bought or granted) as two separate figures, and to tell bought from granted in my purchase history, so that I understand what I get monthly and what I added.
- As an **owner**, I want every boost I bought to appear in my in-app history, with a Stripe receipt emailed to me, so that I have a record for my books.
- As an **owner**, I want the price shown to be clearly the price before tax, so that I am not surprised at checkout.
- As an **owner who accidentally clicks buy several times**, I want the system to stop me at a sensible monthly limit, so that a mistake or a misused card cannot run up large charges.
- As an **owner**, I want the balance I see to reflect only purchases that were actually paid, so that I am never shown credit that later disappears.
- As an **admin**, I want every boost purchase in the credit ledger, with its Stripe reference, and a flag when Stripe reports a refund or dispute, so that I can reconcile the balance by hand.
- As the **business owner (product)**, I want packages defined in configuration now and movable to a table later, so that changing a price or amount does not need a rewrite.

---

## 5. Functional requirements

### 5.1 Package catalogue

| ID | Requirement |
|---|---|
| **FR-1** | Boost packages are defined in **one** catalogue. For each package it holds: a stable id, a **version**, the customer-facing name and short description per locale (en, he, es; English may fill all three initially, as for tiers), the **base credits**, the **bonus percentage**, the price in the smallest currency unit, the currency (USD), whether the price excludes tax (true), an active flag, a display order and an optional **badge** (for example "Most popular", "Best value") per locale. |
| **FR-2** | In v1 the catalogue is **configuration in code** (`lib/business-os/entitlements/config/boostPackages.ts`, T-3b), validated by Zod. An invalid catalogue makes a Jest test fail in the Business OS entitlements job and in the Jest gate that runs on every PR, which blocks a merge once that check is made required (F-9, §18.10 B-10). At runtime an invalid catalogue fails closed: checkout refuses with a logged `error` and no other route is affected. *(Superseded wording: "fails the build and CI, never a request".)* The validation checks that base credits equal price × the configured base rate (§8.1), and that total credits equal base × (1 + bonus %), so the numbers cannot drift apart. |
| **FR-42** | **The bonus % shown to the owner is computed, never typed as a label.** It is derived from the configured base rate, which is computed from `creditValue.ts` and the versioned markup in `creditRetail.ts` (T-3a, §8.1): (total credits ÷ (price × base rate)) − 1. The same figure feeds the badge text, the picker, the confirmation and the history. A hand-typed bonus label, or any display value not derived from the catalogue and the base rate, is a defect. If the base rate changes, the shown bonus changes with it, or validation fails. |
| **FR-3** | Everything that reads the catalogue goes through **one loader interface**, so that replacing the configuration with a database table changes the loader only, not the checkout, the webhook, the UI or the ledger. |
| **FR-4** | Each ledger entry records the package id **and version** it was sold under, and the **credit value version** in force (as charge rows do). A later change to a package, to the credit value or to the markup never changes a past purchase. |
| **FR-5** | Only packages that are active in the catalogue are offered or sold. |

### 5.2 Purchase

| ID | Requirement |
|---|---|
| **FR-6** | A **Top up** button appears on the Business OS credits card (the card built by credit deduction 6a and 11d, on main; boost adds only the button and picker, no figure change, R-11). It opens a package picker in the Business OS design system, with RTL support and en/he/es, showing each package's price (excluding tax), credits, computed bonus and badge. |
| **FR-7** | Choosing a package starts a **one-off** Stripe payment (no subscription) using Stripe's embedded checkout. |
| **FR-8** | The client sends **only the package id**. Price, credits, currency and account come from the server (catalogue + session), never from the request body. |
| **FR-9** | Before a checkout is created, the server verifies that: the caller is authenticated; the caller has a Business OS plan row; the account is **not awaiting payment** (an invited friend still on payment hold is refused, fail-closed, reusing `readPaymentHold`; R-1); the package exists and is active; and the purchase is within the cap (FR-20). Any failure returns a clear, localised message and creates no Stripe session. |
| **FR-10** | Every tier and cohort is eligible (C-1). Eligibility is decided on the server. The UI may hide the button, but hiding it is never the check. |
| **FR-11** | While payment is being confirmed, the UI shows a **"payment processing"** state. The balance changes only after the server has credited the purchase (FR-14). After a successful payment the UI refreshes the balance and history. |
| **FR-12** | A checkout that is abandoned or fails changes nothing and writes no ledger entry. |

### 5.3 Crediting

| ID | Requirement |
|---|---|
| **FR-13** | A boost is credited **only** from Stripe's webhook, and only when Stripe reports the payment as **paid**. This includes delayed payment methods that complete later. A browser redirect or success page never credits. Each purchase row records the Stripe mode (`livemode`); an event whose mode differs from the row's is refused as a mismatch (R-10). |
| **FR-14** | Crediting writes **one** row to `business_os_credit_lots` (`source = 'boost_purchase'`) through the existing `business_os_record_credit_lot(...)`, built by credit deduction 11a (migration 20261017; T-2, §18.10): a lot of total credits (base + bonus), with an optional expiry that is empty in v1. The purchase facts (price, tax, Stripe references, status) live on `business_os_boost_purchases`, which links to the lot. *(Superseded wording: "one entry to the Business OS credit ledger".)* |
| **FR-15** | Crediting is **exactly once** per payment. A repeated webhook delivery, a retry, or a manual re-process of the same payment adds nothing a second time. |
| **FR-16** | Crediting and its ledger entry either both happen or neither does. There is no state in which the balance changed without a ledger entry, or the reverse. |
| **FR-17** | Crediting writes an **audit entry** (`AuditTrailService`) naming the account, package, version, credits, price and Stripe reference. |
| **FR-18** | Boost purchase **never** writes to agent-platform tables (`user_subscriptions`, `credit_transactions`) or balances. It never creates or modifies a `user_subscriptions` row as a side effect of creating a Stripe customer. A boost creates **no** Stripe Customer at all (T-8, R-9); an existing Business OS customer may be reused, read-only. |
| **FR-19** | A boost **never** grants, unlocks or changes a capability, tier or cohort. It only adds credits. For a **trial**, bought credits can keep the trial from ending because credits ran out. They **never extend the 14-day trial period**. |

### 5.4 Purchase cap

| ID | Requirement |
|---|---|
| **FR-20** | Each account has a purchase cap of **$150 per rolling 30 days**. The cap counts the pre-tax package price, over purchases in the current Stripe mode only (R-10). A purchase that would exceed it is refused before any Stripe session is created, with a message saying the limit was reached and how to contact support. With the v1 packages this allows, for example, three Max packages, or fifteen Starter packages, in 30 days. |
| **FR-21** | **There is no separate count cap.** A count limit adds little safety: the money cap already stops a runaway, and repeated clicks are handled by FR-23. It would only stop an owner buying many small packages that are within the money cap, which is legitimate. |
| **FR-22** | The default cap lives in configuration. An admin can raise or lower it for one account, with a required reason, and the change is audited. The override is set and ended through an admin operation shipped in **boost slice 6**, on the per-account credit view built by credit deduction 11c under `/admin/users`, following the `creditAdminOps.ts` conventions (F-5, R-12). The cap check reads the per-account override in v1. *(Superseded wording: "may ship with credit deduction slice 11".)* |
| **FR-23** | The cap counts **paid** purchases plus checkouts still in progress. Opening several checkouts at once, or clicking buy repeatedly, cannot get past it. |

### 5.5 Display and history

| ID | Requirement |
|---|---|
| **FR-24** | *(Revised 2026-10-04, user decision; §18.10.)* The credits card shows the **plan figure** and **one "Extra credits" figure**. The extra figure is the remaining credits on all unexpired lots, admin grants **and** boost purchases, as defined by `extraCreditsAt` in `lib/business-os/credits/creditLots.ts` and already built by credit deduction 11d. There is **no separate bought-credits figure** and **no combined total**. Bought and granted are told apart only in the purchase history (FR-26). *(Superseded wording: "plan allowance and boost balance as two separate figures (Q20)".)* |
| **FR-25** | The "Extra credits" figure is read from the Business OS credit lots (`business_os_credit_lots` / `_lot_draws`), never from the AgentsPilot balance. |
| **FR-26** | The owner's history lists every boost purchase: date (in the account's timezone, from `user_preferences.timezone`), package name, credits added (base + bonus), price, the words "excluding tax", status (credited, refunded or disputed and under review), and a link to the Stripe receipt where Stripe provides one. It is a **Purchases** list **beside** the credit diary, with its own owner endpoint, never inside the diary, because the diary never shows dollars (T-12, F-4, RV-5). Each entry is marked **bought**, so bought and granted credits are told apart here (Q20 as refined). *(Superseded: "in the credit diary … or next to it; SA decides which".)* |
| **FR-27** | Every successful boost payment carries `receipt_email` and a `receipt_url` (stored on the purchase), so Stripe sends a receipt email. The email itself is verified on the **first live purchase**, because Stripe sends no receipt emails in test mode (F-6, T-8). *(Superseded wording: "Stripe sends a receipt email for every successful boost payment" as a test-mode check.)* |
| **FR-28** | Prices are shown and charged in **USD only**. Nothing in the flow converts a price or fetches an exchange rate (see §10). |
| **FR-29** | Package prices are labelled as **excluding tax** wherever they appear (picker, confirmation, history). |

### 5.6 The credit ledger contract

The Business OS credit ledger **exists and is live** (credit deduction slices 3b-i and 3b-ii): `business_os_credit_charges` (rows of `kind = 'charge'` and `'adjustment'`), `business_os_credit_totals` (one row per account and billing period), and the write function `business_os_record_credit_charge`. It records **consumption**. *(Superseded 2026-10-04: "It has no entry for credits added yet".)* Credits added live in **`business_os_credit_lots`**, with append-only reversals in `business_os_credit_lot_draws`, written only through `business_os_record_credit_lot(...)` and `business_os_reverse_credit_lot(...)`. Credit deduction 11a built these (migration 20261017, applied to PROD), and the `source` CHECK already admits `'boost_purchase'` with the boost row shape (actor `stripe_webhook`, `source_ref` required, key prefix `boost:`). Boost and admin grant add credits through this **one** mechanism (T-2, §18.9, §18.10 B-1). Boost adds no column, CHECK or function to these tables; they stay byte-identical.

| ID | Requirement |
|---|---|
| **FR-30** | Each boost purchase writes one `business_os_credit_lots` row (credits base, bonus and total; credit value version; key `'boost:' ∥ session id`; `source_ref` = purchase id; actor `stripe_webhook`; expiry empty) and one `business_os_boost_purchases` row. Between them they carry at least: account id; that it adds credits; credits (base and bonus, 6 dp as elsewhere in the ledger); source `boost_purchase`; package id and version; credit value version; price paid (smallest unit), currency and "excluding tax"; any tax Stripe collected, if tax is collected (§9); the Stripe payment reference(s); an idempotency key unique per payment; created at; optional expires at (empty in v1); actor = system (Stripe webhook). |
| **FR-31** | Boost lots **do not reset** with the billing period, unlike the monthly allowance. Remaining credits per lot are **derivable from append-only records** (the lot minus its rows in `business_os_credit_lot_draws`); no mutable "remaining" column is kept (§18.6 item 1, T-2). The metering work consumes in the approved order: plan allowance first, then boost lots (soonest-expiring first; lots with no expiry after those with one; oldest first among equals). **Consumption itself is not in this scope.** |
| **FR-32** | The owner's "Extra credits" figure is derived from the lots (`extraCreditsAt` in `lib/business-os/credits/creditLots.ts`: remaining credits on unexpired lots, grants and boosts together; FR-24). No separate balance figure may drift from it. It can be rebuilt from the ledger, as the period totals can (checker row C7). |
| **FR-33** | Admin add/remove of credit (required reason, audited) is **owned by credit deduction slice 11**. This requirement expects those entries in the same ledger and the same history, clearly labelled as support adjustments. *(2026-10-04: built by credit deduction 11a–11d, merged. Taking back a bought lot needs `confirmPaidCredits: true` and a plan row; §18.9, §18.10 B-2.)* |
| **FR-34** | The ledger stays **server-write-only**, following the pattern slice 3b-i used. No browser session can insert, update or delete entries. Owners read their own entries only. Cost columns stay hidden from owners, as they are today. |

### 5.7 Refunds and disputes

Policy is parked (Q11). v1 only ensures nothing is silently wrong.

| ID | Requirement |
|---|---|
| **FR-35** | When Stripe reports a refund or a dispute on a boost payment, the system records it against the original purchase, updates the purchase's status in history, and **raises an admin-visible flag** (a structured `error` log and an audit entry). |
| **FR-36** | A refund or dispute on a boost payment is never reported as "unknown payment" and ignored. |
| **FR-37** | Whether credits are clawed back automatically, and how much, is decided by SA with the credit deduction work (T-9). Until then the flag is the minimum. A manual take-back is available today through credit deduction 11b with `confirmPaidCredits` (§18.10 B-2). |
| **FR-43** | **Stuck-purchase reconciliation** (F-1, R-8). A purchase left `pending` or `awaiting_payment` past its checkout expiry plus a grace period is re-read from Stripe, and either credited through the **same** idempotent crediting function or marked expired or failed. It runs as a pass in the shared `bos-billing-reconcile` cron (created by whichever of boost slice 4b and plan payments P-8b lands first) and from an admin button. Boost go-live needs either this pass live or P-8b's in-webhook reclaim of stale claims; both is the target. |

### 5.8 Admin visibility

| ID | Requirement |
|---|---|
| **FR-38** | An admin can see, per account, the boost purchases, their status and any flags, gated by `requireAdmin`. Its home is the **per-account credit view** built by credit deduction 11c under `/admin/users`, where lots already appear by source (R-12). *(Superseded: "the Costs & credits tab of `/admin/business-os-llm`".)* |
| **FR-39** | Changes to packages in v1 are a configuration change through a normal release. There is no runtime editing path in v1. |

### 5.9 Retiring the AgentsPilot boost checkout

| ID | Requirement |
|---|---|
| **FR-40** | The AgentsPilot boost purchase is **switched off**: its checkout refuses new boost purchases, and its UI no longer offers them. Code, tables (`boost_packs`, `boost_pack_purchases`) and history are **kept**, not deleted, so it can be reused later. Any deletion needs an SA-approved plan. On the server, the checkout refuses with a logged 410, and the packs are set inactive as a recorded, reversible data change (T-11). Whichever of boost slice 7 and plan payments P-10 lands first owns this; if P-10, the boost-pack checkout sits on P-10's *Guarded* list and slice 7 becomes verify-only (R-7). **Update 2026-10-06: owned by plan payments P-10 (SA-approved 2026-10-05).** P-10 switches the AgentsPilot checkout off: `create-checkout` returns 410 for every purchase type. The webhook's boost-pack branch and the checkout code stay, so open Stripe sessions still complete. The old boost packs are set inactive by a hand-run step after P-10a deploys, with the old values saved first. Boost slice 7 is therefore **verify-only** for FR-40 (R-7's "if P-10 goes first" branch). |
| **FR-41** | Switching it off must not affect the AgentsPilot subscription paths, Connect payments, or past boost history. |

---

## 6. Hazard-prevention requirements

Each hazard found in the AgentsPilot implementation (discovery §4) has an explicit requirement that prevents it.

| Hazard (discovery) | What went wrong there | Requirement that prevents it |
|---|---|---|
| **HZ-4** Credit before paid | Credited on checkout completion without checking payment status | **FR-13** |
| **HZ-3** Swallowed errors mark the event complete | Balance update unchecked, ledger errors logged and ignored, event stamped `completed`, so no Stripe retry | **FR-16**; **HP-1** |
| **HZ-5** Read-then-write balance race | Balance read, then rewritten with `current + credits` | **FR-15**, **FR-16**, **FR-32**; **HP-2** |
| **HZ-6** Inactive packs purchasable | Pack looked up by id with no active check | **FR-5**, **FR-9** |
| **HZ-7** Client-only eligibility | "Must be a subscriber" enforced in the browser | **FR-9**, **FR-10** |
| **HZ-10** Live-FX display | Browser fetched a live exchange rate to show converted prices | **FR-28**; §10 |
| **HZ-11** Metadata-only routing | Webhook routed on `metadata.purchase_type` | **HP-3** |
| **HZ-8** Phantom subscription row | Creating a Stripe customer inserted an agent-platform row | **FR-18** |
| **HZ-9** Refunds ignored | Refund matched only client payments, so the platform refund was dropped | **FR-35**, **FR-36** |
| **HZ-14** No audit on credit | Only the checkout start was audited | **FR-17** |
| **HZ-13** Admin API hygiene | No Zod, `console.*`, no repository, hard delete | **NFR-3** to **NFR-6**; FR-40 |
| **HZ-1 / HZ-2** Boost had no effect on Business OS | Balance was one Business OS never reads | **FR-25**, **FR-32**; DEP-2 |
| *(new)* Credits and advertised bonus drift apart | AgentsPilot stored `bonus_percentage` and `bonus_credits` as separate hand-entered fields | **FR-2**, **FR-42** |

| ID | Requirement |
|---|---|
| **HP-1** | If crediting fails for any reason, the webhook event is **not** recorded as completed. It is released so that Stripe's retry reprocesses it, and the failure is logged at `error`. A handler that returns normally after a failed write is a defect. (The AI charge recorder's "never throw" rule does **not** apply here: a lost charge under-bills us, but a lost boost takes a customer's money.) |
| **HP-2** | Balance and ledger changes are atomic in the database, as `business_os_record_credit_charge` already is for charges. No code path reads a balance and writes back a computed total. |
| **HP-3** | The webhook identifies a Business OS boost payment by an identity the platform controls and a customer cannot forge. Any metadata is a **cross-check only**, and a mismatch is refused and alerted. An unrecognised payment is **denied by default**: logged, and never credited to either product. A Business OS boost can never reach an AgentsPilot handler, and the reverse. The existing single webhook endpoint and its duplicate-event protection are kept (reuse plan RD-4). Concretely, boost is **one resolver plus one handler** in the Business OS dispatcher built by plan payments P-1 (`lib/business-os/billing/webhookDispatcher.ts`; R-6), and `user_id` always comes from the purchase row. |
| **HP-4** | Connect (client) payments that pass through the same webhook are unaffected. The change ships with evidence that the Connect path behaves identically before and after. |

---

## 7. Non-functional requirements

| ID | Area | Requirement |
|---|---|---|
| **NFR-1** | Security | The Stripe secret key is rotated (DEP-3) before this goes live. No secret reaches the client. Only the publishable key is used in the browser. |
| **NFR-2** | Security | All new tables or entry kinds are server-write-only, with reads scoped to the owner's `user_id`. |
| **NFR-3** | Standards | All route inputs are Zod-validated. |
| **NFR-4** | Standards | All database access goes through `lib/repositories/` with `user_id` scoping. A service-role write is documented with the reason, and follows the `tenant-isolation-guard` skill (the webhook acts on an account id taken from a Stripe object). |
| **NFR-5** | Standards | Pino structured logging with a `correlationId`. No `console.*` in new or touched code. Touched files that still use `console.*` are flagged for conversion per CLAUDE.md rule 3. *(The Stripe webhook route was converted by plan payments P-0, #183; §18.10 B-4.)* |
| **NFR-6** | Errors | Production responses never expose internal error details. |
| **NFR-7** | Reliability | From Stripe reporting the payment as paid to the balance updating is typically under one minute. Stripe retries cover transient failures. |
| **NFR-8** | Accessibility / i18n | The Top up flow, card figures and history are keyboard-accessible, translated (en/he/es) and RTL-correct. Dates use the account's timezone. |
| **NFR-9** | Money | Amounts are held in the smallest currency unit with an explicit currency, converted with the existing zero-decimal-aware helpers (`lib/payments/refundMath.ts`), never `× 100`. Money is never summed across currencies. |
| **NFR-10** | Audit | Every credit, flag and cap override has an audit entry. |
| **NFR-11** | Entitlements | Any import from `lib/business-os/entitlements/` is registered per the `business-os-entitlements` skill. |
| **NFR-12** | Retention | `business_os_boost_purchases` and `business_os_boost_cap_overrides` are **financial records**: never purged by a business Reset, keyed to `auth.users` (not `business_profiles`), and minimised on account deletion (`user_id` set to NULL, as charges are). They are registered in `lib/business-os/businessOwnedTables.ts`, `lib/business-os/purge/descriptors.ts` and `lib/business-os/account/accountDeletionPolicy.ts` (F-11). |

---

## 8. Packages and pricing basis

### 8.1 The conversion (from the existing pricing doc)

The conversion already exists. It is defined in [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md):

| Rule | Value | Source |
|---|---|---|
| Credit value | **1 credit = $0.001** of measured provider cost (version 1, `derived`) | §1; `lib/business-os/entitlements/config/creditValue.ts` |
| Markup | **100%**: the owner pays **2×** our AI cost | §2, decision **D1**. In code: the versioned, append-only `lib/business-os/entitlements/config/creditRetail.ts`, added in boost slice 1 (T-3a, F-3) |
| **Base rate** (the standard plan rate) | **$0.002 per credit = 500 credits per $1** = credit value × (1 + markup) | Computed from `creditValue.ts` and `creditRetail.ts`, never typed (T-3a). It is the same rate the plans use: Essentials' $39.50 allowance value ÷ 19,750 credits = $0.002 (§3) |

The markup lives in what a dollar buys, never in the credit value itself (pricing doc §1: "the credit itself carries no markup"), so the ledger stays an honest record of cost. **The bonus % is measured against this base rate**, and that is what the UI displays (FR-42). If the credit value or the markup changes (pricing doc §6.3), the base rate follows. FR-2's validation then flags any package whose credits no longer match.

### 8.2 The packages ("Option A", user-approved 2026-09-30)

| Package | Price (excl. tax) | Base credits (price × 500) | Bonus shown | Total credits | Markup over AI cost after Stripe fee |
|---|---|---|---|---|---|
| **Starter** | $10 | 5,000 | none | **5,000** | 88% |
| **Plus** — badge "Most popular" | $25 | 12,500 | +10% | **13,750** | 74% |
| **Max** — badge "Best value" | $50 | 25,000 | +15% | **28,750** | 68% |

**How the markup column is computed.** (price − Stripe fee) ÷ (total credits × $0.001) − 1, with the fee **assumed** at 2.9% + $0.30:

| Package | Stripe fee (assumed) | Net | AI cost if every credit is used | Markup |
|---|---|---|---|---|
| Starter | $0.59 | $9.41 | $5.00 | 88% |
| Plus | $1.03 | $23.98 | $13.75 | 74% |
| Max | $1.75 | $48.25 | $28.75 | 68% |

⚠️ **The Stripe fee is an assumption to verify.** Our actual Stripe rate was not checked; international cards and some payment methods cost more. If the real fee is higher, every markup is lower, most noticeably on Starter (the fixed $0.30 weighs more on a small charge). SA / the Dev workplan confirms it (T-18).

Package names per locale ("Starter", "Plus", "Max") and the badges ("Most popular", "Best value") are drafts in English. Hebrew and Spanish need native review, as for the credit diary labels.

### 8.3 Sanity check

| Check | Finding | Verdict |
|---|---|---|
| Profitable? | Every package sells above cost even if every credit is used, after the assumed Stripe fee: 88% / 74% / 68%. | ✅ |
| Below the 70% target | Max (68%) is below a 70% markup target. | ✅ **Accepted by the user** (round 3), as the price of a visible "best value" step |
| Bonus rises with size? | 500 → 550 → 575 credits per dollar: each larger pack is better value, with a visible **5-point bonus step** (0% → +10% → +15%). This matches the user's aim of steering buyers to Plus and Max. | ✅ |
| Relative to plans | Plans sell at the flat 500 per $1. Plus and Max are 10% and 15% cheaper per credit than a plan's allowance. That is acceptable for one-off credit, which does not buy the product. | ✅ Worth knowing |
| Will anyone need them? | Measured regular use is ~60 credits per 30 days (pricing doc §4.6). Plans include 19,750–32,250 credits a month. A paid-plan owner is unlikely to need a boost. A **trial** account (2,000 credits in total) or heavy **image** use (~250 credits per image) can. | ⚠️ Expect low volume from paid plans (pricing doc D3). It does not change the packages. |
| Cap vs packages | $150 per 30 days allows three Max packs (86,250 credits). | ✅ |

---

## 9. Tax

| # | Item | Status |
|---|---|---|
| TX-1 | **Package prices exclude tax.** Every place a price is shown says so (FR-29). | ✅ Decided (user, 2026-09-30) |
| TX-2 | **We operate in the USA.** Prices are in USD only (§10). | ✅ Decided (user, 2026-09-30) |
| TX-3 | **For v1, "go with whatever works now".** SA picks the **simplest mechanism** that charges the package price and **keeps a later switch to collecting tax possible** without reworking the purchase, the ledger or the history: the ledger records any tax separately from the price (FR-30); the receipt and history already say "excluding tax"; and nothing assumes tax is always zero. | ✅ Decided (user, round 3). Mechanism for SA: **T-14** |
| TX-4 | **The accountant confirms the real sales-tax obligation before live launch.** If collection is required, the switch in TX-3 is made then. | **Pre-launch dependency** (DEP-7), not an open blocker. It does not block SA review, the workplan or the build |

---

## 10. Currency: what exists and the decision

**Decision (user, round 3, 2026-09-30): USD only for now.** OQ-2 is resolved. The analysis below is kept as the record behind the decision, and as the starting point when multi-currency is taken up with plan prices (reuse plan OI-1).

### 10.1 Two different currency questions

| Domain | Direction of money | Who sets the currency | Example |
|---|---|---|---|
| **A. The business's own clients** | A client pays the business, through the business's Stripe Connect account | The business, per service | An Israeli clinic charges a client ₪300 |
| **B. The platform's own billing** (plans, **boosts**) | The business owner pays **us**, on the platform's Stripe account | **Us** | Essentials is $79; a boost is $10 |

Boosts are **domain B**. Everything the product built for currency so far is **domain A**, apart from the AgentsPilot billing screen.

### 10.2 What exists

| # | What exists | Domain | What it does | Where | Reusable for boost pricing? |
|---|---|---|---|---|---|
| CU-1 | `scheduling_services.currency` | A | **The authority** for what a client is charged | CLAUDE.md "Currency & Timezone"; `lib/business-os/userCurrency.ts:28-38` | **No.** It is what the owner charges clients, not what we charge the owner. |
| CU-2 | `business_profiles.currency` / `businessCurrency` | A | A **default** for new services and a **label** for sums | CLAUDE.md "Currency & Timezone". Note: `lib/business-os/userCurrency.ts:4-5` says the column did not exist when that file was written; not re-checked against the live schema | **No** for pricing. |
| CU-3 | `resolveUserCurrency` (service → latest invoice → USD) | A | Derives "the business's currency" for sums and chat answers | `lib/business-os/userCurrency.ts` | **No.** Same reason as CU-1. |
| CU-4 | `LanguageContext.currencyCode` | Display | A localStorage display preference; **never persisted** | CLAUDE.md "Currency & Timezone" | **No.** CLAUDE.md forbids seeding anything written or charged from it. |
| CU-5 | `currencySymbol`, `currencyForLanguage`, `resolveBusinessCurrency` | A (formatting) | Symbols for USD/ILS/EUR/GBP; language is only a fallback guess | `lib/business-os/currency.ts` | **Yes, for display only**: the `$` symbol and formatting. |
| CU-6 | `minorUnitsPerMajor`, `toMinorUnits`, `fromMinorUnits` (zero- and three-decimal aware) | A and B | Correct conversion between cents and whole units for any currency | `lib/payments/refundMath.ts:23-60` | **Yes.** It must be used for any amount sent to Stripe (NFR-9). |
| CU-7 | `settlementCurrencyFor(country)` | A | The currency a Connect account settles in, by country | `lib/payments/countryCurrency.ts` | **No.** |
| CU-8 | `revenue_by_currency` / `primary_currency`; the "never sum across currencies" rule | A | Sums grouped per currency, labelled with a primary one | CLAUDE.md "Currency & Timezone" | **The rule applies** if a second currency is ever added. |
| CU-9 | AgentsPilot `CurrencyService`, the `exchange_rates` table, `/admin/exchange-rates`, and a **live exchange rate fetched in the browser** on the billing screen | B (AgentsPilot) | Shows AgentsPilot prices converted into the user's currency; the charge stays USD | `lib/services/CurrencyService.ts`; `app/admin/exchange-rates/page.tsx`; `components/v2/settings/BillingSettingsV2_NEW.tsx:293-331` | **No.** Converted display breaks the "no FX in the platform" rule (HZ-10, FR-28). |
| CU-10 | `StripeService` `currency` parameter | B | Passes a currency to Stripe, but bills the **USD number verbatim** in it | `lib/stripe/StripeService.ts:218, 240-250`; reuse plan F-27 | **No, not as-is.** Irrelevant while USD only. |
| CU-11 | Plan pricing currency decision | B | **Plans are USD only for now** (Q-B2 / RD-13). Multi-currency is **OI-1**: a price must be **set** per plan per currency, never converted | [BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md](/docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md) §1.2, §11 OI-1 | **Yes, as the policy.** Boosts now follow it. |

### 10.3 Options that were considered

| Option | Outcome |
|---|---|
| **1. USD only** (same as plans) | ✅ **Chosen** (user, round 3) |
| 2. A fixed price list per currency | Deferred. To be decided together with plan prices under OI-1 |
| 3. Converted display (the AgentsPilot approach) | Rejected. It breaks the no-FX rule (HZ-10) |

*(Corrected by SA, F-7.)* Stripe's Adaptive Pricing, if enabled, **charges** the buyer in their local currency; it is not only an estimate. Each boost session therefore disables it (`adaptive_pricing: { enabled: false }`), so a non-US owner is always charged USD (T-15). *(Superseded wording: "an approximate local amount while still charging USD … left to SA".)*

---

## 11. Acceptance criteria

- [ ] An owner on each of trial, champion, basic and pro can open Top up, choose each of Starter, Plus and Max, and complete payment in Stripe test mode.
- [ ] After a successful test payment for **Plus**, exactly one `business_os_credit_lots` row (`source = 'boost_purchase'`) adds **13,750** credits (12,500 base + 1,250 bonus), with the credit value version, key `boost:<session id>` and an empty expiry, and the linked `business_os_boost_purchases` row holds the package id and version, the price and the Stripe reference. The card's "Extra credits" figure has increased by 13,750.
- [ ] The catalogue fails validation if a package's base credits do not equal price × the base rate, or its total credits do not equal base × (1 + bonus %).
- [ ] The bonus shown in the picker, the badges and the history is **computed** from the catalogue and the base rate (Starter none, Plus +10%, Max +15%). Changing the base rate in a test either changes the shown bonus or fails validation; no hand-typed bonus text exists.
- [ ] Replaying the same Stripe event, or re-processing the same payment, does not add a second entry.
- [ ] A delayed-payment test (payment pending, then succeeding) credits only on success. A pending payment that fails credits nothing.
- [ ] Forcing the ledger write to fail leaves the event **not** completed, and Stripe's retry then credits exactly once.
- [ ] A request naming an inactive, unknown or tampered package, or sending its own price or credits, is refused and no Stripe session is created.
- [ ] A user without a Business OS plan row is refused on the server even when calling the API directly. So is an account awaiting payment (an invited friend on payment hold; R-1).
- [ ] A purchase that would take the account above $150 in the rolling 30 days is refused before checkout. An admin override, set through the slice 6 admin operation on the 11c per-account view, raises it for one account, and the override is audited. There is no count limit.
- [ ] Opening several checkouts at once cannot exceed the cap.
- [ ] A trial account that buys a boost keeps its original trial end date.
- [ ] After a boost is credited, the card's single "Extra credits" figure rises by the package's credits. There is no separate bought-credits line and no combined total. The purchase history marks the entry as bought (not granted). Translated and RTL-correct. *(Revised 2026-10-04, user decision.)*
- [ ] The history lists the purchase with date (account timezone), package, credits added, price marked "excluding tax", status and a receipt link. The payment carries `receipt_email` and a `receipt_url`; the receipt email itself is checked on the first live purchase (F-6).
- [ ] Every price in the flow is in USD and says "excluding tax". No exchange rate is fetched or shown.
- [ ] The tax mechanism chosen by SA records tax (zero or not) separately from the price, and a test shows that enabling tax collection would not change the credits granted or the ledger entry's shape.
- [ ] A Stripe refund and a dispute on a test boost each raise an admin-visible flag and change the purchase status. Neither is logged as an unknown payment.
- [ ] No row in `user_subscriptions` or `credit_transactions` is created or changed by a boost purchase, including for a user with no `user_subscriptions` row.
- [ ] A payment the webhook cannot identify is logged and credited to neither product. A metadata mismatch is refused and alerted.
- [ ] Existing Connect payment handling passes its tests unchanged, with before/after evidence.
- [ ] The existing AI charge path (`business_os_record_credit_charge`), the period totals and the leak check behave identically after the change. `business_os_credit_lots`, `business_os_credit_lot_draws` and both lot functions are byte-identical.
- [ ] The AgentsPilot boost checkout refuses new purchases and its UI no longer offers them. Its tables and history are intact.
- [ ] Every credit has an audit entry. The new routes use Zod, repositories and Pino, and contain no `console.*`.
- [ ] SA review confirms that moving the package catalogue from configuration to a table needs only a loader change.
- [ ] A purchase left `pending` or `awaiting_payment` past its checkout expiry plus grace is re-read from Stripe by the reconcile pass, and is either credited exactly once through the same function or marked expired or failed (FR-43).
- [ ] An event whose Stripe mode differs from the purchase row's is refused as a mismatch, and the cap counts only the current mode (R-10).
- [ ] Every boost session has Adaptive Pricing disabled, so the charge is in USD (T-15).

---

## 12. Parked items

| # | Item | Status | Working assumption |
|---|---|---|---|
| P-1 | Currency (Q8) | ✅ **Resolved**: USD only (§10) | — |
| P-1b | Tax (Q8) | ✅ **Resolved for v1**: tax-exclusive, USA, the simplest switchable mechanism (§9). The accountant's confirmation is a pre-launch dependency (DEP-7) | — |
| P-2 | What happens to boost lots on cancel, downgrade, grace or pause (Q10) | Parked. There is no downgrade support today | Boost lots are kept. Purchase is allowed in any lifecycle state while the account has a plan row. |
| P-3 | Refund policy (Q11) | Parked. There are no refunds today | FR-35 to FR-37 ensure refunds and disputes are flagged, not silent. |
| P-4 | Enforcing expiry and reminders before expiry (Q9) | Low priority. Field modelled only | No lot expires in v1. |
| P-5 | Custom amount (Q2) | Later | At the base rate (500 credits per $1), no bonus unless decided |
| P-6 | Multi-currency prices (with plans, OI-1) | Later | USD only |

---

## 13. Dependencies

| # | Dependency | Effect on this work |
|---|---|---|
| **DEP-1** | **The credit ledger** (credit deduction slices 3b-i/3b-ii, live) and the **credit diary** (slice 7) | ✅ **The ledger exists**: `business_os_credit_charges`, `business_os_credit_totals`, `business_os_record_credit_charge` ([BUSINESS_OS_ENTITLEMENTS.md § Metering](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md#metering-the-credit-ledger)). **What it lacks is a way to add credits**: its rows are charges and corrections, and its totals are per period. Boost needs a credit-adding entry that survives period resets. So does admin grant (slice 11). **One mechanism for both** (T-2). The purchase history belongs in or beside the credit diary (slice 7). **Update 2026-10-04: met.** The add-credits mechanism is built by credit deduction 11a (`business_os_credit_lots`, `_lot_draws` and both lot functions; migration 20261017, applied). The purchase history sits **beside** the diary (T-12). Boost slice 2 creates only `business_os_boost_purchases` and `business_os_boost_cap_overrides`, in migration **20261030** (block 20261030–34, R-4). |
| **DEP-2** | **Refusal at zero** (credit deduction slice 9: pre-check in `runAiAction`; slice 10: pause owner AI / templates for clients); `balance.ts` still answers "sufficient" to everything | **Known dependency, not a blocker.** Charging is live, but nothing refuses at zero and nothing draws from a boost lot yet. Until slices 9–10 ship, a boost raises a balance that nothing limits, so the owner gains no practical headroom. The card must not imply otherwise (T-13). |
| **DEP-3** | **Stripe secret key rotation** and **service-role key rotation (G-1)** | Must be done before this takes live payments. Build and merge can proceed meanwhile. |
| **DEP-4** | The `getOrCreateCustomer` split (reuse plan Q-T8) | ~~Required by FR-18.~~ **Not needed for boosts** (F-10, T-8, R-9): no Stripe Customer is created, so FR-18 holds by construction. Moves back to S-4a. |
| **DEP-5** | ~~The unit decision~~ | ✅ **Resolved**: the unit is the credit (§8.1, C-2). |
| **DEP-6** | **The credits card** (credit deduction 6a, 6b and 11d, **merged**) | ✅ Met. The card already shows the single "Extra credits" figure (11d); boost adds only the Top up button and picker (R-11). *(Superseded: "the separate boost figure go on the new card".)* |
| **DEP-7** | **Pre-launch: the accountant confirms the US sales-tax obligation** (§9 TX-4) | Does not block SA review, the workplan or the build. Must be answered before **live** launch; if collection is required, the switchable mechanism (TX-3) is turned on then. |
| **DEP-8** | **Pre-launch: verify the actual Stripe fee** (§8.2) | Confirms the markup figures. It does not change the packages unless the user decides to. |
| **DEP-9** | **Pre-launch: Stripe endpoint event subscriptions** (F-8) | The user confirms in the Stripe dashboard that the platform webhook endpoint receives `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded` and `charge.dispute.*`. Not a build blocker. |
| **DEP-10** | **Plan payments shared infrastructure**: the dispatcher (P-1, merged), `business_os_billing_accounts` (P-2a, read-only here), the shared `bos-billing-reconcile` cron and P-8b's stale-claim reclaim (R-8), and P-10 vs boost slice 7 (R-7) | Coordination, not a blocker. Boost go-live items are added to plan payments §9.5 as pointers (§18.10 go-live note). |

---

## 14. Out of scope / future roadmap

- A pop-up offering a top-up when the limit is hit (Q15).
- Low-balance warnings (Q18; credit deduction slice 8).
- Custom-amount purchase (Q2).
- Auto top-up (Q16). It is not planned.
- Enforcing expiry and reminders before expiry (Q9).
- An admin UI to edit packages. Moving packages to a database table (FR-3 prepares for it).
- Admin add/remove credit (credit deduction slice 11, FR-33).
- Refund policy, and automatic clawback beyond flagging (Q11).
- Multi-currency prices, VAT and tax invoices (§10, OI-1).
- Consuming boost lots and refusing at zero (DEP-2).
- Reviving the AgentsPilot boost (FR-40 keeps it possible).

---

## 15. Technical decisions for SA

These are for SA. They are not raised with the user. **All of them are ruled in §18.3, as amended by §18.8 to §18.10.**

| # | Decision | Notes |
|---|---|---|
| T-1 | ~~The unit~~ | ✅ Resolved: credits (§8.1) |
| T-2 | **How credits are added to the ledger**: a new entry kind in `business_os_credit_charges`, a separate lots table, or a function beside `business_os_record_credit_charge`. **Shared with admin grant (slice 11)**, so there is one mechanism. How boost lots relate to the per-period totals (whose CHECK is `owner + scheduled + external + adjustment`) and to period resets. | DEP-1, FR-30 to FR-32. ✅ Ruled (§18.3) and built by credit deduction 11a (§18.10 B-1) |
| T-3 | The catalogue loader's shape, so the configuration-to-table move is a loader swap. Pricing identity in Stripe: a fixed product/price per package (`lookup_key`, consistent with RD-1) vs inline pricing. **Where the base rate (500 per $1) is derived**, so it follows `creditValue.ts` and the markup rather than being copied, and how the displayed bonus % is computed from it (FR-42). | FR-1 to FR-5, FR-42, §8.1, HP-3 |
| T-4 | Webhook identification of Business OS boosts (price identity or another controlled identity), deny by default, metadata as a cross-check | HP-3; reuse plan RD-4 |
| T-5 | Idempotency key (checkout session / payment intent) and its unique constraint | FR-15 |
| T-6 | Atomic crediting, and how the webhook releases its claim on failure | FR-16, HP-1, HP-2 |
| T-7 | Handling delayed payment success and failure events | FR-13 |
| T-8 | Receipts: Stripe receipt email configuration, and whether one-off payments also create a Stripe invoice for the history link | FR-26, FR-27 |
| T-9 | Recording and flagging refunds and disputes; any clawback, jointly with the credit deduction work | FR-35 to FR-37 |
| T-10 | Cap implementation: pending checkouts, the rolling window, where the per-account override lives (likely next to slice 11's admin grant) | FR-20 to FR-23 |
| T-11 | How the AgentsPilot boost checkout is switched off non-destructively | FR-40, FR-41 |
| T-12 | Where boost purchases appear: inside the credit diary (slice 7) or a separate list beside it | FR-26 |
| T-13 | Card wording while nothing refuses at zero (DEP-2), coordinated with slice 6a | FR-24, DEP-6 |
| T-14 | **The simplest v1 tax mechanism that keeps a later switch to collecting tax possible** (for example charging the price as-is with tax recorded as zero, versus Stripe Tax configured but off). How tax is recorded beside the pre-tax price. | §9 TX-3, DEP-7 |
| T-15 | Whether Stripe's local-currency estimate at checkout is enabled on our account, and whether it should be | §10.3 |
| T-16 | Where `billing_events` fits, if anywhere (product dimension, reuse plan Q-T3) | |
| T-17 | Converting `app/api/stripe/webhook/route.ts` to Pino (reuse plan TK-4) while it is being touched; surface to the user per rule 3 | NFR-5 |
| T-18 | Confirm our actual Stripe processing fee for the markup figures | §8.2, DEP-8 |

---

## 16. Open questions

- [x] **OQ-1: Purchase cap.** ✅ Resolved 2026-09-30: **$150 per account per rolling 30 days**, admin-adjustable. No count cap (FR-21). (raised by: BA | status: decided by user)
- [x] **OQ-2: Currency for boost prices.** ✅ Resolved 2026-09-30 (round 3): **USD only for now** (§10). (raised by: BA | status: decided by user)
- [x] **OQ-3: US sales tax.** ✅ Resolved for v1 (round 3): prices exclude tax; SA picks the simplest switchable mechanism (T-14). The accountant's confirmation is a **pre-launch dependency** (DEP-7), not an open question. (raised by: BA | status: decided by user)
- [x] **OQ-4: Adding credits to the ledger, shared with admin grant (T-2).** ✅ Resolved: SA ruled T-2 (lots table), the credit deduction session acknowledged it, and 11a built it (20261017). (raised by: BA | status: resolved)
- [x] **BQ-B1: A separate "Bought credits" line on the card?** ✅ Decided by the user 2026-10-04: no. There is one "Extra credits" figure, and the purchase history tells bought from granted (§18.10). (raised by: SA | status: decided by user)

- [x] **BQ-5a: Who sees Top up before purchasing works?** ✅ Decided by the user 2026-10-07, option B: **every Business OS owner** sees the Top up button and the package picker. The Buy button is disabled with "Coming soon" until purchasing works (slices 4a and 5b). The picker does not depend on the checkout flag, which stays off on Vercel, and never calls the checkout route. Slice 5 is split: 5a shows the packages, 5b adds the Buy flow, the return landing and the Purchases history. (raised by: TL | status: decided by user)

**No business question is open.**

---

## 17. Notes on integration points

| System | Effect |
|---|---|
| Credits card (credit deduction 6a / 11d, on main) | Top up button only. The existing single "Extra credits" figure already includes boost lots (revised 2026-10-04). |
| `business_os_credit_charges` / `business_os_credit_totals` / `business_os_record_credit_charge` | **Not changed.** The existing charge path must behave identically. *(Superseded: "gain a way to add credits"; that is the lots table below.)* |
| `business_os_credit_lots`, `business_os_credit_lot_draws`, `business_os_record_credit_lot` (credit deduction 11a, migration 20261017) | Boost writes one lot per purchase through the existing function. Tables and functions stay byte-identical. |
| `business_os_boost_purchases`, `business_os_boost_cap_overrides` (new, migration 20261030) | Purchase facts, the cap reservation and overrides. Registered per NFR-12. |
| `business_os_billing_accounts` (plan payments P-2a) | Read-only: an existing Business OS customer id may be passed to the session (R-9). |
| `lib/business-os/entitlements/config/creditValue.ts`, [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md) | Source of the credit value and markup behind the base rate. A boost row in the pricing doc's revision log when packages change. |
| Credit diary (slice 7) | Not changed. The Purchases list sits **beside** it (T-12); a price-free "+N credits added" line may follow later. |
| Per-account credit view under `/admin/users` (credit deduction 11c) | Admin view of boost purchases, flags and the cap override (FR-38, R-12). *(Superseded: the Costs & credits tab of `/admin/business-os-llm`.)* |
| `app/api/business-os/credits/boost/checkout` (new) | Zod, auth, eligibility (plan row, not on payment hold), cap, catalogue price. One-off embedded checkout, no Stripe Customer created, Adaptive Pricing off, `livemode` recorded. |
| `lib/stripe/StripeService.ts` | **Not changed** (§18.6 item 6). The boost session builder lives in `lib/business-os/boost/` and uses the shared Stripe client. *(Superseded: "a boost checkout method … the `getOrCreateCustomer` split".)* |
| `app/api/stripe/webhook/route.ts`, `lib/business-os/billing/webhookDispatcher.ts` (plan payments P-1) | Boost adds one resolver and one handler to the existing dispatcher (R-6): deny by default, crediting, refund/dispute flagging. The existing signature check and duplicate-event protection are reused. Live Connect money flows through this file (HP-4). |
| `lib/payments/refundMath.ts`, `lib/business-os/currency.ts` | Reused for minor units and `$` formatting (§10). |
| `lib/business-os/entitlements/balance.ts` | Future consumer of boost lots (DEP-2). Not changed here. |
| `AuditTrailService`, `requireAdmin` | Reused as-is. |
| `app/api/stripe/create-checkout/route.ts`, `components/v2/settings/BillingSettingsV2_NEW.tsx`, `components/settings/BillingSettings.tsx` | AgentsPilot boost purchase switched off (FR-40). |
| `user_subscriptions`, `credit_transactions`, `boost_packs`, `boost_pack_purchases`, `exchange_rates`, `billing_events` | **Not written** by the Business OS boost flow. Kept intact. The one exception is slice 7's recorded, reversible `boost_packs.is_active = false` data change (T-11). `billing_events` is not used (T-16). |

---

## 18. SA Review

**Reviewed by SA — 2026-09-30**
**Status:** APPROVED WITH CONDITIONS

The requirement is sound and its hazard map is accurate. The business decisions in §1 are final and are not reopened here. The conditions are technical corrections and design rulings. None needs the user. The BA text corrections in §18.6 must land before the slice 1 workplan. The per-slice conditions in §18.5 must be met in each slice's workplan.

### 18.1 Fact check against main (de4b31f2)

| # | Claim | Verified | Notes |
|---|---|---|---|
| V-1 | Ledger `business_os_credit_charges` (kinds `charge`, `adjustment`), `business_os_credit_totals`, `business_os_record_credit_charge` exist | ✅ | `supabase/migrations/20261015_business_os_credit_charges.sql`. Charge rows require `credits >= 0`. Adjustment rows require `adjusts_action_id NOT NULL`. Totals are keyed `(user_id, period_start)` with CHECK `credits_total = owner + scheduled + external + adjustment`. service_role has `SELECT, INSERT` only on charges (no UPDATE), and the function is `SECURITY INVOKER`, EXECUTE to service_role only. |
| V-2 | The ledger has no entry for credits added | ✅ | Neither kind can carry a positive, period-independent addition. See T-2. |
| V-3 | Checker row C7 (totals equal the rebuild from the ledger) | ✅ | `scripts/check-bos-credit-charges-migration.sql:324` |
| V-4 | Credit value config | ✅ | `lib/business-os/entitlements/config/creditValue.ts`: version 1, `derived`, $0.001, append-only. |
| V-5 | "Base rate follows `creditValue.ts` and the markup" (§8.1, FR-42, T-3) | ❌ **The markup is not in code.** It lives only in the pricing doc and in a derivation string. The base rate cannot be derived from config today. Finding F-3. |
| V-6 | HZ-4: the AgentsPilot boost credits without a `payment_status` check | ✅ | `app/api/stripe/webhook/route.ts:466`. The line refs have drifted by about one line. |
| V-7 | HZ-3: ledger errors are logged and swallowed | ✅ | `route.ts:528-531, 554-558` |
| V-8 | HZ-8: phantom `user_subscriptions` row | ✅ | `lib/stripe/StripeService.ts:83-92` (hard-coded `10.00` / `20833`) |
| V-9 | HZ-9: refund and dispute handlers match only `payment_transactions` | ✅ | `handleChargeRefunded` `route.ts:1025`, `handleDispute` `route.ts:934`. **Additionally:** `handleDispute` is not passed the connect account id, and a platform-side dispute on a boost would log "unknown payment" and return (violates FR-36 unless boost routing runs first). |
| V-10 | HZ-11: routing on `metadata.purchase_type` | ✅ | `route.ts:459-466`. A platform `mode: 'payment'` session without `boost_pack` falls through to no branch (no write). That is safe today but it is an implicit deny, not an explicit one. |
| V-11 | Duplicate-event protection with release on throw | ✅ | `route.ts:2494-2560, 2708-2740` (two-phase `processed_webhook_events`). **Gap:** a claim stuck in `processing` (the function is killed by a timeout or crash before the catch runs) is never reclaimed. Every Stripe retry is then answered `duplicate: true` with a 200. Finding F-1. |
| V-12 | Webhook `console.*` | ✅ | **173** calls in `route.ts` (2,748 lines). `StripeService.ts` has 2 calls. `create-checkout/route.ts` has 0. `BillingSettingsV2_NEW.tsx` has 45 and `components/settings/BillingSettings.tsx` has 69. |
| V-13 | `refundMath.ts:23-60` helpers | ✅ (drifted) | `minorUnitsPerMajor` :44, `toMinorUnits` :58, `fromMinorUnits` :76. |
| V-14 | AgentsPilot boost UI lists only active packs | ✅ | Both billing components read `boost_packs` with `.eq('is_active', true)` directly from the browser (a rule 1 violation, flagged but not fixed here) and render "No boost packs available" when the list is empty. This enables T-11. |
| V-15 | Stripe API version | ✅ | `StripeService` pins `2025-10-29.clover`. `StripeInvoiceService` pins `2024-12-18.acacia` (not used here). |
| V-16 | No Business OS Stripe customer storage exists | ✅ | No `stripe_customer_id` on any `business_os_*` table. See T-8 / F-10. |
| V-17 | Admin grant (slice 11) plans "a grants table" (SA-S8) | ✅ | Deduction requirement slice 11. T-2 makes the lots table that table. |
| V-18 | Credit diary content rule | ✅ | The deduction requirement says the diary never shows dollars. That conflicts with FR-26 placing priced purchases "in" the diary (F-4). |
| V-19 | Jest runs in CI | ⚠️ Partly | `test:bos-entitlements` runs `lib/business-os/entitlements`, `lib/repositories/__tests__`, `supabase/migrations/__tests__` and the purge and owned-table invariants. It is **not a required check**. No workflow runs the full suite. FR-2's "fails the build and CI" holds only if the tests sit in that job's paths, and even then CI goes red without blocking the merge (F-9). |
| V-20 | Stripe dashboard subscribes the endpoint to `checkout.session.async_payment_succeeded` / `_failed` / `checkout.session.expired` | ⬜ **Unverifiable from code** | This is a dashboard setting. Recorded as DEP-9 (F-8). |
| V-21 | Our real Stripe fee (T-18) | ⬜ **Unverifiable from code** | Account pricing is a dashboard fact. Stays DEP-8. |

### 18.2 Findings

| # | Severity | Finding | Required action |
|---|---|---|---|
| **F-1** | **High (money)** | **A stuck webhook claim loses a paid boost silently.** HP-1 relies on the catch block releasing the claim. A timed-out or killed invocation never reaches it. The row stays `processing` forever, and Stripe's retries are acknowledged as duplicates. The customer paid and nothing credits. | The purchase row (T-2) is the durable truth, not `processed_webhook_events`. Add a **stuck-purchase reconciliation**: any purchase `awaiting_payment` or `pending` past its checkout expiry plus a grace period is re-read from Stripe and credited through the **same idempotent function**, or marked expired or failed. It runs from an admin button and a nightly job, reusing the slice 4b leak-check cron pattern and the `durable-queue-drain` claim rules. It is part of the crediting slice (4b), not deferred. |
| **F-2** | **High (design)** | **FR-31/FR-32 cannot be met by the existing ledger.** Charge rows are non-negative consumption. Adjustments must point at a charge. Totals are per period and reset. A boost written as a negative charge or adjustment would vanish at the next period. | T-2 ruling: a separate **lots** table. FR-30/FR-31 reworded (§18.6). |
| **F-3** | **Medium** | **The markup is not in code**, so FR-42's "derived from the configured base rate" has no source. Copying 500 into the catalogue is exactly the drift FR-42 forbids. | T-3 ruling: a versioned, append-only **retail rate** entry beside `creditValue.ts`. |
| **F-4** | **Medium** | **FR-26 contradicts the credit diary's rule** (the diary never shows dollars). | T-12 ruling: the purchase history sits **beside** the diary. The diary may later show a price-free "+13,750 credits added" line. |
| **F-5** | **Medium** | **FR-22 vs the acceptance criteria:** the ACs require an audited per-account override in v1, while FR-22 lets the admin surface wait for slice 11. | T-10 ruling: a minimal admin override operation ships in this work (slice 6). |
| **F-6** | **Medium** | **"Stripe emails a receipt" is not testable in test mode.** Stripe does not send receipt emails for test-mode payments. | The AC becomes "the payment carries `receipt_email` and a `receipt_url`; the email is verified on the first live purchase" (post-deploy check). |
| **F-7** | **Medium** | **Stripe Adaptive Pricing**, if enabled on the account, charges the buyer **in their local currency**. It is not only an estimate. That breaks USD-only and the currency cross-check. | T-15 ruling: disable it per session. |
| **F-8** | **Medium (ops)** | The async-payment and expiry events are only delivered if the endpoint subscribes to them (V-20). | New **DEP-9**: the user confirms the endpoint subscriptions before live launch. The workplan lists the exact events. |
| **F-9** | **Low** | FR-2 overstates CI (V-19). | Put the catalogue and its tests under a path `test:bos-entitlements` already runs (T-3). Reword FR-2 to "a Jest test in the Business OS entitlements job fails". |
| **F-10** | **Low (simplification)** | DEP-4 (`getOrCreateCustomer` split) is not needed for boosts. A one-off payment needs no Stripe Customer. | T-8 ruling: no customer object in v1. FR-18 is met by construction. DEP-4 moves back to S-4a (plans). |
| **F-11** | **Low (gap)** | New tables must be registered in `lib/business-os/businessOwnedTables.ts`, `lib/business-os/purge/descriptors.ts` and `lib/business-os/account/accountDeletionPolicy.ts`, as the charges tables are. The requirement does not say what a business Reset or account deletion does to a purchase. | Purchases and lots are **financial records**: `never` purged, keyed to `auth.users` (not `business_profiles`), `minimise` on account deletion (user id `ON DELETE SET NULL`, as charges do). New NFR-12. |
| **F-12** | **Low (process)** | Migration numbering: 20261015–19 belong to credit deduction and 20261020–22 to invite signup. 20261023 is taken. | The boost migration uses **20261024 or later**, confirmed with both sessions at workplan time. |
| **F-13** | **Low** | Line refs in discovery HZ-4/HZ-9 and §10.2 CU-6 have drifted (V-6, V-9, V-13). | Informational. The workplan cites current lines. |
| **F-14** | **Risk (business, already accepted)** | Until credit deduction slices 9–10 ship, a bought credit is never drawn and never needed (C-3, DEP-2). An owner can pay for something with no effect yet. | Not reopened. **Guardrail:** the whole feature sits behind a server-read flag, default **off**, which is also the kill switch. Turning it on in production is a launch decision taken with DEP-3, DEP-7, DEP-8 and DEP-9, and the go-live note restates DEP-2 in business terms. |

### 18.3 Rulings on the technical decisions (T-1 to T-18)

| # | Ruling |
|---|---|
| **T-1** | Resolved (credits). |
| **T-2** | **Adding credits: a new table `business_os_credit_lots`, not a new kind in `business_os_credit_charges`.** One row per addition, with columns `id, user_id, source ('boost_purchase' now; 'admin_grant' added by slice 11 through a CHECK change), credits_granted numeric(18,6) > 0, credits_base, credits_bonus, credit_value_version, expires_at NULL, idempotency_key UNIQUE NOT NULL, source_ref (purchase id), actor ('stripe_webhook' / admin id), reason, created_at`. **Append-only.** service_role gets `SELECT, INSERT` and no UPDATE, as on charges. Written only through one `SECURITY INVOKER` function `business_os_record_credit_lot(...)` (EXECUTE to service_role only), with `ON CONFLICT (idempotency_key) DO NOTHING`, returning `recorded`. **This is the one mechanism slice 11 uses for admin grants** (it replaces slice 11's planned grants table, SA-S8). The credit deduction session must acknowledge this before slice 2 applies. **Relation to totals and resets:** lots **never touch** `business_os_credit_totals` or `business_os_record_credit_charge`. Totals stay period consumption, so period resets cannot affect a lot, and C7 and the charge path are unchanged by construction. **Remaining credits per lot (FR-31):** in v1, remaining = granted, because nothing consumes. Consumption and reversals (clawback, admin reduce or end) are recorded by **later slices as append-only rows against a lot** (for example a `business_os_credit_lot_draws` table written by slices 9–10 and 11), never by updating the lot. Remaining is therefore always rebuildable (FR-32, checker parity with C7). No mutable `credits_remaining` column is added before a writer exists. Consumption order (allowance, then lots by expiry, then oldest) is binding on slice 9. **Owner read:** column-level SELECT for `authenticated` on own rows (hides `reason` and `actor` if needed), following the 3b-i pattern. |
| **T-3** | **Catalogue and rate.** (a) Add `lib/business-os/entitlements/config/creditRetail.ts`: an append-only, versioned `{ version, markup, creditValueVersion, decidedOn }` history (version 1: markup 1.0, credit value v1), with the same snapshot-test pattern as `creditValue.ts`. The **base rate is computed** (`1 / (usdPerCredit × (1 + markup))` = 500 per $1) and never typed. (b) The catalogue `boostPackages.ts` sits in the same config folder, so the `test:bos-entitlements` job runs its tests. It is data plus a Zod schema. Each package holds `id, version, priceMinor, currency 'USD', taxExclusive true, bonusPercent (integer), active, order, labels/badges per locale, retailVersion`. `baseCredits` and `totalCredits` are **derived in integer arithmetic** from `priceMinor` and the base rate (credits per cent). The validation test asserts both identities, and `bonusPercent` is the **only** typed number. The displayed bonus is recomputed from credits, which FR-42 requires. (c) **Loader seam:** `BoostPackageSource { listActive(): Promise<BoostPackage[]>; getActive(id): Promise<BoostPackage \| null> }`, async like `balance.ts`, so a DB table later is an implementation swap. Runtime validation failure **fails closed** (checkout refuses with a logged `error`) and never crashes other routes. (d) **Stripe pricing identity: inline `price_data`**, not per-package Stripe Prices. RD-1's lookup keys exist because a subscription invoice line is the only routing identity. For a one-off boost the stronger identity is our own purchase row (T-4), and inline pricing needs no Stripe dashboard objects in two modes. `product_data.name` carries the package name. (e) Every import from `lib/business-os/entitlements/` is registered per the `business-os-entitlements` skill (NFR-11). |
| **T-4** | **Routing identity: a purchase row we created.** The checkout route first **reserves** a `business_os_boost_purchases` row, then creates the session with `client_reference_id = purchase.id`, metadata `{ product: 'business_os_boost', purchase_id }`, the same metadata on `payment_intent_data`, and a Stripe idempotency key = purchase id. The session id is stored on the row. **Webhook routing seam** (a small hook before the existing `switch`; the logic lives in `lib/business-os/boost/`, not in the 2,748-line route): **only for platform events (`event.account == null`)**, the checkout events are looked up by `client_reference_id` → purchase row, and charge and dispute events by `payment_intent` → purchase row. Found → the Business OS handler; the AgentsPilot handlers never see it. Not found but metadata says `business_os_boost` → **refuse, `error` log, audit flag**, credit nothing. Not found and not tagged → the existing handlers, unchanged. **Cross-checks before crediting:** stored session id matches, `mode = 'payment'`, `amount_subtotal = row.price_minor`, `currency = row.currency`, `livemode` matches the key mode, metadata tag present. A **deterministic mismatch** sets the row to `flagged_mismatch`, credits nothing, and completes the event (a retry cannot fix it). A **transient failure throws** so the claim is released (HP-1). **Connect events never reach the lookup.** That, plus unchanged Connect handlers, is the HP-4 evidence. `user_id` always comes from the purchase row, never from Stripe metadata (tenant-isolation-guard: the row is the ownership oracle). |
| **T-5** | **Idempotency key** = `'boost:' ∥ checkout_session_id` on `business_os_credit_lots.idempotency_key` (UNIQUE). Also UNIQUE on `business_os_boost_purchases.stripe_checkout_session_id` and `.stripe_payment_intent_id`, and a UNIQUE `lot_id`. A replay, a retry, a reconciliation run or a manual re-process all converge on one lot. |
| **T-6** | **Atomic crediting:** one SQL function `business_os_credit_boost_purchase(p_purchase_id, p_session_id, p_payment_intent_id, p_amount_subtotal, p_amount_tax, p_amount_total, p_currency)` (`SECURITY INVOKER`, service_role only) runs in one transaction. It locks the purchase row `FOR UPDATE`, re-verifies status and amounts **against the snapshot on the row** (never a fresh catalogue read, FR-4), inserts the lot via the T-2 function, and sets the purchase to `paid` with the `lot_id` and amounts. It returns `credited` / `already_credited` / `mismatch`. No application read-then-write. A database error throws, and the route releases the claim (HP-1). The recorder's "never throw" rule does not apply. |
| **T-7** | **Delayed payments:** `checkout.session.completed` credits **only** if `payment_status === 'paid'`. `'unpaid'` sets the row to `awaiting_payment`. `'no_payment_required'` is refused (promotion codes disabled on the session). `checkout.session.async_payment_succeeded` credits via T-6. `checkout.session.async_payment_failed` sets `failed`. `checkout.session.expired` sets `expired`. All are handled only through the T-4 seam. |
| **T-8** | **Receipts and customer:** no Stripe Customer is created in v1. The session uses `customer_email` from the authenticated user, and `payment_intent_data.receipt_email` is set explicitly so the receipt does not depend on a dashboard setting. There is **no `invoice_creation`**: it adds Stripe Invoicing fees and a second document, and the receipt suffices. The history link is the charge's `receipt_url`, stored with `stripe_charge_id` during crediting (one PaymentIntent retrieve expanding `latest_charge`). Failing to fetch it is logged at `warn` and does **not** fail crediting. The reconciler fills it later. DEP-4 is not needed (F-10). |
| **T-9** | **Refunds and disputes: flag, never auto-claw in v1.** On platform `charge.refunded` or `charge.dispute.*` resolved to a purchase (T-4): record the Stripe refund or dispute id, amount and phase on the purchase (`refunded` / `partially_refunded` / `disputed` / `dispute_won` → back to `paid` / `dispute_lost`), write an audit entry and a structured `error` log (`bos_boost_payment_reversed`), and surface it in the admin view. The lot is **not** touched. A manual clawback is an admin reduce (slice 11) recorded as an append-only reversal against the lot. Automatic clawback stays parked (Q11/P-3). |
| **T-10** | **Cap.** The purchase row **is** the reservation. `business_os_reserve_boost_purchase(p_user_id, p_package_snapshot…, p_default_cap_minor)` runs in one transaction under `pg_advisory_xact_lock` keyed on the user. It checks that the account has a `business_os_account_plans` row (FR-9) and reads the active per-account override. It sums `price_minor` over the user's purchases created in the last 30 days whose status could have moved money: `pending` not yet past `checkout_expires_at` + 5 min grace, `awaiting_payment`, `paid`, `partially_refunded`, `refunded`, `disputed`, `dispute_lost`, `flagged_mismatch`. Refunded purchases still count, which is conservative, and the override is the remedy. If sum + price exceeds the cap it returns `cap_reached` and inserts nothing. Otherwise it inserts `pending`. The session is created with `expires_at` = now + 30 min (Stripe's minimum), so an abandoned checkout stops counting within about 35 minutes even if `checkout.session.expired` is lost. If session creation fails, the row becomes `abandoned` (not counted). Two tabs cannot both pass, because the second waits on the lock and sees the first reservation. **Override storage:** a small table `business_os_boost_cap_overrides` (`user_id, cap_minor, currency, reason ≥ 3 chars, actor_admin_id, created_at, ended_at, ended_by_admin_id, ended_reason`, with at most one active row per user via a partial unique index). It mirrors `business_os_entitlement_overrides` instead of forcing a money cap into a capability shape that does not exist. The default cap ($150) is a config constant beside the catalogue. |
| **T-11** | **Retiring the AgentsPilot boost:** (1) **server:** `app/api/stripe/create-checkout/route.ts` refuses `purchaseType === 'boost_pack'` with a clear 410/403. This is the real control, and the file has 0 `console.*`. (2) **UI:** set every `boost_packs.is_active = false` as a recorded, reversible data change (previous values kept in the workplan). Both billing components already render "No boost packs available". This avoids touching two files with 114 `console.*` calls for a legacy surface. (3) The AgentsPilot webhook `boost_pack` branch is left as-is, so in-flight sessions still complete. Nothing is deleted (FR-40). |
| **T-12** | **History beside the diary, not inside it** (F-4). It is a "Purchases" list reading `business_os_boost_purchases` through an owner-scoped repository, with date in `user_preferences.timezone`, package, credits, price "excluding tax", status and receipt link. A price-free "+N credits added" diary line may follow once slice 7 exists, but it is not required. |
| **T-13** | **Card wording before enforcement:** two separate figures, "Plan credits" (the allowance as slice 6 shows it) and "Bought credits" (the sum of lots). Beneath them is one neutral line: "Bought credits are used after your plan's credits and do not reset monthly." The card never shows a combined total and never shows a "you are out, top up" prompt while nothing refuses at zero. Slice 5 of this work must not change slice 6a's allowance logic, only add the second figure and the button. *(Superseded 2026-10-04: one "Extra credits" figure, §18.10. The neutral sentence still applies to extra credits.)* |
| **T-14** | **Tax: charge the price as-is, tax recorded separately, switch prepared.** `automatic_tax` off. `price_data.tax_behavior = 'exclusive'` is set now: it is inert while tax is off and correct when it is turned on. The purchase row stores `amount_subtotal`, `amount_tax` (0 today) and `amount_total` from the session. Credits come **only** from the package snapshot and the cap counts only the subtotal, so turning tax on changes neither. The later switch is one change in the session builder: `automatic_tax.enabled`, a product `tax_code`, and billing-address collection. That work plus Stripe Tax registration is DEP-7's outcome. The AC's proof is a unit test that runs the crediting mapper on a session fixture with `amount_tax > 0` and asserts the same lot and ledger shape. |
| **T-15** | **Local-currency presentment: off.** Each boost session sets `adaptive_pricing: { enabled: false }`, so a non-US owner is always charged USD (F-7). The workplan verifies that the parameter name holds on API version `2025-10-29.clover`. The currency cross-check in T-4 is the backstop. |
| **T-16** | **`billing_events`: not used.** It is an AgentsPilot table with no migration in the repo (HZ-12). Boost history is `business_os_boost_purchases`. Q-T3's product dimension stays with S-4a plans. |
| **T-17** | **Pino in the webhook:** a separate **slice 0** PR converts all 173 calls, mechanically, with before/after Connect test evidence, **before** the boost hook lands. Mixing a whole-file logging rewrite of a file carrying live Connect money into the crediting diff would make that diff unreviewable. Per CLAUDE.md rule 3 the user is asked to approve the conversion (they may decline, in which case the boost hook still uses Pino and the file is flagged). `StripeService.ts` (2 calls) is **not** touched: the boost session builder lives in `lib/business-os/boost/` and uses the shared Stripe client. |
| **T-18** | **Not verifiable from code** (V-21). It stays DEP-8, a pre-launch check by the user in the Stripe dashboard. Note: turning on Stripe Tax later adds its own per-transaction fee, which lowers the markups in §8.2 further. |

### 18.4 Standards the workplans must meet

- **Repository pattern (rule 1):** `BusinessOsBoostPurchaseRepository` (reserve, attach session, lookup by id / session / payment intent, status transitions via the SQL functions, owner list) and `BusinessOsCreditLotRepository` (record via function, owner sum and list), both following the `new-repository` skill with client injection and `RepositoryResult`. The webhook and routes call repositories only. The existing `processed_webhook_events` direct access is not extended.
- **Service role and tenant isolation:** webhook writes run as service role. The **purchase row is the ownership oracle**. `user_id` is never read from Stripe metadata or the request body. The checkout route takes `userId` from the session only. The body is `{ packageId }` validated by Zod (`.strict()`, so extra price or credits fields are rejected, per the AC).
- **Zod:** the checkout route body and the admin override body. The Stripe event is signature-verified and its fields are narrowed through a Zod parser in the boost handler before use.
- **Pino:** `createLogger({ module: 'business-os-boost' })`, with `correlationId` on routes and the Stripe event id as the correlation on the webhook. Log events `bos_boost_credited`, `bos_boost_payment_reversed`, `bos_boost_mismatch`, `bos_boost_unrecognised`.
- **Audit:** credited, flagged, mismatch, cap override set or ended, all non-blocking **except** that the crediting outcome itself never depends on the audit.
- **Admin:** the override route and the view gate with `requireAdmin` as the first statement, and are added to the admin access register.
- **RLS:** all new tables have RLS on and owner SELECT only (column-level where a column should be hidden). There are no INSERT, UPDATE or DELETE grants to `authenticated` or `anon`. Writes go only through functions granted to service_role.
- **Registries:** F-11 (owned tables, purge descriptors, deletion policy).

### 18.5 Proposed slices

Small and numbered, reusing existing infrastructure. Each is its own PR.

| Slice | Scope title | Contents | Guardrails (must not) | Est. |
|---|---|---|---|---|
| **0** | ~~**Webhook logging to Pino** (precursor)~~ **Done as plan payments P-0 (#183); see §18.10** | Mechanical conversion of `app/api/stripe/webhook/route.ts` (173 calls). Before/after Connect test evidence. Needs the user's approval under rule 3. | No behaviour change. No boost code. | ~1–1.5d |
| **1** | **Price rule and package catalogue** | `creditRetail.ts` (versioned markup) and the computed base rate. `boostPackages.ts` with Zod, integer derivations, the computed bonus %, the `BoostPackageSource` seam and the default cap constant. Tests in the entitlements job. Entitlements registration. | No DB, no Stripe, no route, no UI. `creditValue.ts` history is not edited. | ~1.5–2d |
| **2** | **Lots and purchases tables** *(superseded 2026-10-04: lots, draws and both lot functions were built by credit deduction 11a; see §18.10)* | Migration (≥ 20261024): `business_os_credit_lots`, `business_os_boost_purchases`, `business_os_boost_cap_overrides`, and the functions `record_credit_lot`, `reserve_boost_purchase`, `credit_boost_purchase` and the status transitions. Grants and RLS. Checker SQL, a rollback write probe, migration tests, the two repositories and the F-11 registries. The user applies it to production and runs the checker. The deduction session acknowledges T-2 first. | Nothing wired. `business_os_credit_charges`, `_totals` and `record_credit_charge` are byte-identical, and C7 still passes. | ~2.5–3d |
| **3** | **Checkout (test mode, behind a flag)** | `POST /api/business-os/credits/boost/checkout` (`new-api-route` skill): auth, `{packageId}` Zod, plan row and cap via the reservation, inline-price embedded session (T-3d, T-8, T-14, T-15, 30-minute expiry, no promotion codes), `abandoned` on failure. A server flag, default off. Exercised from `/test-business-os`. | No webhook change, no crediting, no owner card. | ~2–2.5d |
| **4a** | **Crediting from the webhook** | The T-4 routing seam (platform events only, deny by default, cross-checks), T-6 atomic crediting, T-7 async and expired events, receipt URL capture, audit and Pino. Connect before/after evidence (HP-4). DEP-9 event list. | The AgentsPilot and Connect handlers are unchanged. No lot is ever written outside the function. | ~3d |
| **4b** | **Refunds, disputes and the stuck-purchase check** | T-9 flags. The F-1 reconciliation: an admin button and a nightly job on the leak-check cron pattern, crediting through the same function. | No automatic clawback. The lot is never touched by a reversal. | ~2–2.5d |
| **5** | **Owner Top up and history** | Top up button and picker on the slice 6a card, the separate "Bought credits" figure and T-13 wording, the Purchases list (T-12), "payment processing" state and refresh, en/he/es, RTL, timezone. | Depends on 6a being **merged**. The allowance logic is not changed. The flag stays off in production. | ~3d |
| **6** | **Admin view and cap override** | Boost purchases, statuses and flags on the Costs & credits tab. The cap override set/end route (`requireAdmin`, Zod, reason, audit). | No grant or adjust of credits (that is slice 11 of credit deduction, on the T-2 table). | ~2d |
| **7** | **Retire the AgentsPilot boost checkout** | T-11: server refusal and the recorded `is_active=false` data change. | No deletion. The AgentsPilot subscription and Connect paths are untouched. Independent: it can ship any time. | ~0.5d |

**Go-live (not a slice):** turning the flag on in production requires DEP-3 (Stripe and service-role key rotation), DEP-7 (accountant), DEP-8 (fee check) and DEP-9 (endpoint events), plus a first live purchase that verifies the receipt email (F-6). The go-live note restates DEP-2 (F-14).

### 18.6 Text corrections owed by BA (before the slice 1 workplan) — ✅ applied 2026-10-04 (see Change History)

1. **FR-14 / FR-30 / FR-31 / FR-32 / §5.6 / DEP-1:** "ledger entry" means a row in `business_os_credit_lots` (T-2), not in `business_os_credit_charges`. FR-31 changes to "remaining per lot is derivable from append-only records". The purchase facts (price, tax, Stripe refs, status) live on `business_os_boost_purchases`.
2. **FR-26:** history **beside** the diary (T-12). **FR-27 / AC:** receipt as in F-6.
3. **FR-2:** CI wording per F-9. **§8.1:** the markup gains a config home (T-3a).
4. **FR-22 / AC:** the override surface ships in slice 6 (F-5).
5. **DEP-4:** not needed for boosts (F-10). **New DEP-9:** Stripe endpoint event subscriptions (F-8). **New NFR-12:** retention and registries (F-11). **New FR:** the stuck-purchase reconciliation (F-1). **§10.3 / T-15:** Adaptive Pricing charges in local currency and is disabled (F-7).
6. **§17:** the checkout route is `app/api/business-os/credits/boost/checkout`. `StripeService.ts` is not changed. `billing_events` is not written.

### 18.7 Questions for the user

None. Every open item was technical and is ruled above. The only user actions are the existing pre-launch checks (DEP-3, DEP-7, DEP-8), the new DEP-9 (a Stripe dashboard setting), and approving or declining the slice 0 logging conversion under rule 3.

### Approval

[x] Requirement approved with conditions. The Dev may write the slice 1 workplan once the §18.6 corrections land. Slice 2 needs the credit deduction session's acknowledgement of T-2 first.

### 18.8 Re-validation 2026-10-01

This section was requested as "§18.7". §18.7 already holds the user questions, so it is appended here as §18.8.

**Scope.** A delta check from the review base de4b31f2 to `origin/main` **8f18aaf2**, plus a read-only look at the parallel work in progress.

- **Since the base, main gained #161 (56feb9d2) and #162 (8f18aaf2).** #161 makes the my-plan route read the language through the repository. #162 is invite slice 5b-1, "friend signup at L2 behind a payment hold", and **it is already merged**, not branch-only. Its migration `20261024_business_os_friend_invite_signup.sql` is applied to production and its checker passes.
- **Parallel work read:** the credit deduction slice 6 worktree (`neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-6`, large uncommitted changes) and its slice workplans. The `feature/business-os-trial-inactive` and `fix/entitlements-champion-parity` worktrees have no relevant uncommitted change. The champion-parity commit is already on main.
- **Unchanged since the base:** `app/api/stripe/**`, `lib/stripe/**`, the 20261015 ledger migration, `lib/business-os/entitlements/config/**`, the purge and deletion registries and `UsageCard.tsx` on main. Every §18.1 fact still holds.

**Verdict: unchanged, APPROVED WITH CONDITIONS.** No earlier ruling is reversed. Three rulings are tightened (R-1 to R-3 below) and the migration guidance changes (R-4).

#### Findings

| # | Severity | Finding | Effect on boost |
|---|---|---|---|
| **RV-1** | **Medium** | **Held friends have a plan row.** 5b's `business_os_finalise_friend_invite_redemption` inserts a `business_os_account_plans` row with no tier and no cohort (`origin = 'invite'`). The account is held until `business_os_account_lineage.first_paid_at` is set. The hold is enforced only by four page layouts. **API routes are not covered**, an accepted residual (5b F5b-5). Under FR-9 as written ("has a Business OS plan row"), a held friend could call the boost checkout API directly and buy credits for an account that cannot enter the product. | Ruling R-1. |
| **RV-2** | **Medium** | **5c will stamp `first_paid_at` from a payment**, and that payment will arrive through the same Stripe webhook. 5b's workplan: "only 5c's payment stamp lifts the hold". A boost payment that stamped it would turn a credit top-up into the key that releases a held account. That breaks FR-19 / Q19 ("a boost never unlocks a feature") and invite BQ-13. | Ruling R-2. |
| **RV-3** | **Low (coordination)** | Two Business OS money flows will share the webhook: boost (slice 4a here) and the plan or first payment (invite 5c / S-4a). | Ruling R-3. |
| **RV-4** | **Medium (coordination)** | **Slice 6a's balance formula is per-period:** `computeCreditBalance` = `max(0, allowance + granted − used)` (uncommitted `lib/business-os/credits/creditBalance.ts`). The payload carries `granted: 0` "until slice 11", and the card ignores it, showing "left" = allowance − used. That is compatible with T-2 and FR-24 today. But `allowance + granted − used` is **only correct** for non-resetting lots if `granted` means *lot credits remaining at the start of the period*. Lots consumed in an earlier period must not be counted again. And T-2 makes boost lots and admin grants **one** table, so "granted" means all lots. | No change to 6a. A condition for credit deduction slices 9 and 11 (below). Boost slice 5 shows the bought figure separately and never shows the combined `remaining`. |
| **RV-5** | **Low** | Slice 6a pins an **exact payload key set** and bans `price`, `cost`, `usd` and `dollar` in the card payload (`ownerCreditUsage.payload.test.ts`). | It confirms T-12: purchase history (which shows a price) needs its **own** owner endpoint. Boost slice 5 adds one key (bought credits, no money) to the card payload and updates that pin deliberately. |
| **RV-6** | **Info** | The deduction requirement's FR-17 consumption order is "period allowance first, then grants (soonest-expiring first)". Slice 11 still plans "a grants table carrying actor, reason, `created_at`, `expires_at`" (SA-S8). | The order agrees with FR-31. The **separate grants table conflicts with T-2** until the deduction session acknowledges that slice 11 uses `business_os_credit_lots` (`source = 'admin_grant'`). "Reduce / end a grant" becomes an append-only reversal against the lot. This acknowledgement is still owed and still gates slice 2. |
| **RV-7** | **Info** | `BUSINESS_OS_CREDIT_PRICING.md` (uncommitted slice 6a edits): **$0.001 per credit and the 100% markup are unchanged**. The edits only record the card's whole-credit rounding and an orphan config key. The 500 credits per $1 base rate and the §8.2 packages stand. | None. |
| **RV-8** | **Low (merge friction)** | Slice 6a and #162 both modify `lib/repositories/BusinessOsAccountPlanRepository.ts` and `businessOsEntitlements.imports.guard.test.ts`. Boost slice 1 adds an entitlements registration in the same guard file. | Rebase on whichever lands first. There is no design conflict. |

#### Rulings added or tightened

| # | Ruling |
|---|---|
| **R-1** (tightens FR-9 / T-10) | The checkout route **refuses an account that is awaiting payment**. It reuses main's `readPaymentHold` (`lib/business-os/invites/paymentHold.ts`) with the lineage and invite repositories and does not copy the predicate. It fails **closed** (`{ ok: false }` → refuse, logged), because this is a money path and refusing a purchase harms nobody, unlike the layout gate's fail-open. **Why this is not a business question:** "every tier and cohort can buy" (Q6) covers accounts with an assignment. A held friend has none and, by BQ-13, has "no free use, nothing to do here" until payment opens. Selling credits that cannot be used would be the HZ-1 failure again. If 5c later releases friends, they become eligible automatically. |
| **R-2** (new guardrail on 4a, and a note for invite 5c) | Boost crediting **never writes `business_os_account_lineage`**, `business_os_account_plans` or anything the payment hold reads. The 5c payment stamp must key on a **plan or first-payment identity**, never on a boost purchase. A boost row is a purchase of credits, not proof of a paid plan. Pinned in 4a by a source guard: the boost module does not reference the lineage table or its repository's write methods. |
| **R-3** (refines T-4) | Slice 4a builds the webhook's Business OS hook as a **dispatcher**: platform events only, with each Business OS money flow resolving its own row and denying by default. Invite 5c / S-4a then add a plan branch to the dispatcher, not a second seam. Whichever lands first owns the dispatcher, and the other rebases onto it. A payment resolved as a boost is never offered to the plan branch, and the reverse. |
| **R-4** (replaces F-12) | **Migration numbers:** `20261024` is taken (applied). 20261015–19 stay with credit deduction and 20261020–22 with invite signup. Invite 5c will need numbers soon. To avoid a race, boost takes a **reserved block, 20261030–20261034**, recorded with both sessions before the slice 2 workplan. Boost has no ordering dependency on the 20261025–29 gap: it depends only on 20261005 (plans), 20261015 (ledger), and 20261014/20261024 (lineage, read-only via R-1). Slice 2's migration must not alter any table another session owns. |
| **R-5** (conditions for the credit deduction session, not a boost change) | (a) **Slice 11** uses `business_os_credit_lots` (T-2) instead of its own grants table. "Reduce / end" is an append-only reversal row. (b) **Slice 9:** the `granted` input to `computeCreditBalance` is the **lot balance at the start of the period** (lots granted minus draws recorded in earlier periods), or slice 9 replaces the formula with an explicit allowance-then-lots computation. Either way, draws are recorded append-only per lot so the owner's separately shown bought figure (FR-24) can be rebuilt. (c) The card keeps "plan left" and "bought" as **two figures**. The combined `remaining` is for enforcement, not for display. |

#### Gate table: which boost slices can start now

| Slice | Can start now? | Must wait for |
|---|---|---|
| **0** Webhook logging to Pino *(superseded: done by P-0 #183, §18.10)* | ✅ **Yes** | The user's yes under rule 3. If invite 5c starts webhook work first, agree the order. Land 0 first if possible, because a whole-file logging change rebases badly. |
| **1** Price rule and package catalogue | ✅ **Yes** (after the §18.6 BA corrections) | Nothing from parallel sessions. Expect the RV-8 rebase on the entitlements import guard. |
| **2** Lots and purchases tables *(superseded: see §18.10 gate table)* | ⏸ **Workplan yes; build and apply no** | (1) The credit deduction session acknowledges T-2 and R-5 (RV-6). (2) Migration block 20261030–34 recorded with both sessions (R-4). |
| **3** Checkout (flag off) | ⏸ After slices 1 and 2 | Nothing parallel. The payment hold it needs (R-1) is already on main. |
| **4a** Crediting and the dispatcher *(superseded: the dispatcher exists, §18.10)* | ⏸ After slice 3, and after slice 0 if the user approves it | Coordination with invite 5c on the dispatcher (R-3) if 5c's webhook work is in flight. |
| **4b** Refunds, disputes, stuck-purchase check | ⏸ After 4a | Nothing parallel. Reuses the merged slice 4b cron pattern. |
| **5** Owner Top up and history *(superseded: see §18.10)* | ⏸ After 4a | **Credit deduction slice 6a merged.** It is uncommitted today, and 6b is not needed. The payload pin is updated deliberately (RV-5). |
| **6** Admin view and cap override | ⏸ After 4b | Nothing parallel. The Costs & credits tab is on main. |
| **7** Retire the AgentsPilot boost *(see §18.10: still needed, coordinate with P-10)* | ✅ **Yes** | Nothing. It is independent. |

**Go-live** is unchanged: DEP-3, DEP-7, DEP-8, DEP-9 and the first live receipt check. Boost go-live does **not** wait for invite 5c, because held accounts are refused (R-1).

**User questions:** still none. R-1 is reported to the user as an FYI only: "invited friends who have not paid yet cannot buy credits".

### 18.9 Credit deduction slice 11 creates the lots table (2026-10-02)

> Recorded from the credit deduction session. Source of truth: `BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md`, "Slice 11 scoping (BA, 2026-10-02)" and "SA review — slice 11 scoping (2026-10-02)" (branch `feature/business-os-credit-deduction-slice-11`, uncommitted at the time of writing).

- **T-2 and R-5 are acknowledged** by the credit deduction session (SA, formally, in its slice 11 review). This releases the "credit deduction session acknowledges T-2 and R-5" part of boost slice 2's gate (RV-6, §18.8).
- **Ordering changed: credit deduction sub-slice 11a creates the shared tables**, because boost is not built. Migration **20261017** creates `business_os_credit_lots`, `business_os_credit_lot_draws` (kind `'reversal'` only for now) and the functions `business_os_record_credit_lot(...)` and `business_os_reverse_credit_lot(...)`. The `source` CHECK admits **both** `'admin_grant'` and `'boost_purchase'` from day one, and the boost-purchase row shape (actor `stripe_webhook`, `source_ref` required, no reason, key prefix `boost:`) is fixed there, so boost adds **no column, CHECK change or FK** to these tables.
- **Boost slice 2 must not create the lots table, the draws table or either lot function again.** Its migration (block 20261030–34) creates only `business_os_boost_purchases` (with `lot_id UNIQUE REFERENCES business_os_credit_lots`), `business_os_boost_cap_overrides` and the boost functions, which call the existing `business_os_record_credit_lot(...)`. It extends the slice 11 lot repository rather than recreating it. New guardrail: the lots and draws tables and both lot functions stay byte-identical. **Boost slice 2 builds only after 20261017 is merged and applied to PROD.**
- **Owner figure (credit deduction S11-D-1, accepted by the user 2026-10-02):** one figure, **"Extra credits"**, for every lot, gifted and bought, instead of T-13's "Bought credits" label. The card has two figures (plan left, extra credits), never a combined total. Whichever of boost slice 5 or credit deduction 11d lands first builds it; the other reuses it.
- **Manual clawback (T-9; credit deduction S11-D-7, accepted 2026-10-02):** an admin may take back bought credits with slice 11's take-back action and a stronger "these were paid for" confirmation. Until that confirmation exists, reductions on `boost_purchase` lots are refused (409 `paid_credits_locked`).
- **A take-back needs a plan row (credit deduction 11b audit F5, 2026-10-04).** Slice 11b's take-back (`reduce_credit_lot`) refuses an account with no plan row (409 `plan_row_missing`), like every admin op. A manual clawback of a boost lot therefore needs the account to still have a plan row; boost must not assume it can reverse a lot on an account whose plan row is gone. Grants are refused without a plan row too, but boost purchases are written by the webhook through `business_os_record_credit_lot(...)` directly and are not affected.

### 18.10 Re-baseline 2026-10-04

**Reviewed by SA — 2026-10-04, against `origin/main` 1a9944a5.** The user approved starting the build. **Verdict: still APPROVED WITH CONDITIONS.** The scope is unchanged. Three slices shrink because main now holds what they were going to build. **The first slice for the Dev is slice 1** (price rule and package catalogue).

#### Verified on main

| # | What landed | Verified | Effect on boost |
|---|---|---|---|
| B-1 | **Credit deduction 11a (#173), migration `20261017` (applied to PROD):** `business_os_credit_lots`, `business_os_credit_lot_draws` (kind `'reversal'` only), `business_os_record_credit_lot(...)`, `business_os_reverse_credit_lot(...)`. Both functions are `SECURITY INVOKER` with EXECUTE to service_role only. `idempotency_key` is UNIQUE. | ✅ | **T-2 is built.** `source` already admits `'boost_purchase'`, with CHECK `boost_purchase_shape`: `actor_kind = 'stripe_webhook'`, `actor_admin_id IS NULL`, `reason IS NULL`, `source_ref IS NOT NULL`, key prefix `boost:`. `credits_base + credits_bonus = credits_granted`. Owner column-level SELECT. `record_credit_lot` returns `(out_recorded, out_lot_id)`, is idempotent on the key, and **raises 23505 if the key is reused for a different lot**. Boost adds no column or CHECK to these tables. |
| B-2 | **11b (#179) admin grants:** `creditAdminOps.ts`. Take-back = an append-only reversal. A `boost_purchase` lot is refused with 409 `paid_credits_locked` unless the body carries **`confirmPaidCredits: true`** (`creditAdminOps.ts:131, 355`), which the admin dialog sends after a tick-box. Take-backs need a plan row (F5). | ✅ | **The T-9 manual clawback path exists now.** `confirmPaidCredits` is that "these were paid for" confirmation. Boost builds no clawback UI. |
| B-3 | **11c (#194) admin per-account view** (`app/admin/users/…`) and **11d (#213) owner card** "Extra credits N" (`UsageCard.tsx`, hidden at 0), defined by `extraCreditsAt` in `lib/business-os/credits/creditLots.ts`. | ✅ | The owner figure for bought credits **already exists**. A credited boost lot appears in it with no card change. |
| B-4 | **Plan payments P-0 (#183):** the webhook logs through Pino. `app/api/stripe/webhook/route.ts` has no `console.*` left. | ✅ | **Boost slice 0 is done (superseded).** |
| B-5 | **P-1 (#188):** `lib/business-os/billing/webhookDispatcher.ts`. Platform events only, deny by default, `resolver_conflict` when two resolvers decide. `DEFAULT_RESOLVERS = [planResolver]`, `BusinessOsFlow = 'plan' \| 'boost'`. The route has `BUSINESS_OS_FLOW_HANDLERS` and throws `BusinessOsHandlerMissingError` for a flow with no handler. Marker `BOS_BOOST_PRODUCT_MARKER = 'business_os_boost'` under key `product` (`stripeMetadataKeys.ts`). P-1 also returns 410 for the Pilot-Credit **subscription** checkout. The `boost_pack` branch of `create-checkout` **stays** (its header says so, "TK-5"). | ✅ | **R-3 is settled:** boost 4a appends a resolver and registers a handler. The AgentsPilot boost checkout is still live, so slice 7 is still needed. |
| B-6 | **P-2a (#192), migration `20261025`:** `business_os_billing_accounts` and billing events. `ensureBusinessOsStripeCustomer` (`businessOsStripeCustomer.ts`). `stripeMode.ts` (`currentStripeMode`, `isLiveMode`). | ✅ | See R-9 (customer) and R-10 (livemode). |
| B-7 | **Plan payments requirement §9.4** records the boost coordination. One `bos-billing-reconcile` cron with pluggable passes (SA-P4), created by whichever of P-8b and boost 4b lands first. P-8b also reclaims `processing` claims older than 15 minutes inside the webhook (PF-5). The **§9.5 go-live checklist** is the one consolidated checklist. | ✅ (not built yet: no `bos-billing-reconcile` on main) | See R-8 and the go-live note. |
| B-8 | Migrations on main: 20261015, 17, 18, 20, 23, 24, **25, 26**, **35**. | ✅ | **20261030–34 are still free** for boost (R-4 stands). 20261026 is taken (credit charges activity indexes) and 20261035 is taken (admin cleanup 7b). |
| B-9 | Markup in code | ❌ still absent | F-3 and T-3a stand. Slice 1 is still needed. |
| B-10 | Jest on every PR (#210, three shards, `Gate tests (jest)`) | ✅, **not yet a required check** | F-9 softens: FR-2's validation test runs on every PR wherever it lives. It blocks a merge once the user makes the check required. |

#### Superseded

| Item | Now |
|---|---|
| Slice 0 (webhook Pino) | **Done** by P-0 (#183). |
| §18.5 slice 2 ("Lots and purchases tables"); §18.8 gate row 2; T-2's table and function design | **Built by 11a.** Boost slice 2 creates **only** `business_os_boost_purchases` (with `lot_id uuid UNIQUE REFERENCES business_os_credit_lots(id)`), `business_os_boost_cap_overrides`, and the boost functions (reserve, attach session, credit, status transitions). The credit function calls `public.business_os_record_credit_lot(user, 'boost_purchase', base, bonus, credit_value_version, NULL, 'boost:' ∥ session_id, purchase_id, 'stripe_webhook', NULL, NULL)` **in the same transaction**. It treats `out_recorded = false` with the same lot id as "already credited", and lets a 23505 key-reuse error throw. |
| T-4's routing seam; R-3; §18.8 gate row 4a | **Built by P-1** as the dispatcher (R-6 below). |
| T-13 "Bought credits", FR-24 two boost figures | **User decision 2026-10-04 (resolved below):** one "Extra credits" figure, already built by 11d. |
| T-9 manual clawback | Available through 11b with `confirmPaidCredits`. Automatic clawback stays parked (P-3). |
| §18.8 gate row 5 (waits for 6a) | 6a, 6b and 11d are merged. Slice 5 shrinks (R-11). |
| F-12 / R-4 | Unchanged: block **20261030–34**. |

#### Changed or new rulings

| # | Ruling |
|---|---|
| **R-6** (replaces the T-4 seam; refines R-3) | **Boost 4a = one resolver plus one handler.** It appends `boostResolver` to `DEFAULT_RESOLVERS` and registers `BUSINESS_OS_FLOW_HANDLERS.boost`. **Resolver:** on platform events of types `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `_failed`, `checkout.session.expired`, `charge.refunded` and `charge.dispute.*`, it makes **one keyed read** of `business_os_boost_purchases` by the Stripe object id (`client_reference_id` / session id, or `payment_intent`) through the repository. A row found → `flow: 'boost'`. Session metadata `product = business_os_boost` with **no** row → `deny 'metadata_mismatch'`. Otherwise → `not_business_os`. The outcome never carries an account. **This is a deliberate extension of the dispatcher's "pure apart from the price catalog read" rule:** refund and dispute objects do not carry the session metadata, so the purchase row is the only platform-controlled identity. 4a updates the header comment to say so. **Handler:** resolves `user_id` from the row (SR-8 / tenant-isolation-guard), runs the T-4 cross-checks, then T-6 / T-7. A deterministic mismatch sets the row to `flagged_mismatch` and returns normally. A transient failure throws so the claim is released. Plan and boost are disjoint because a payment intent belongs to one row in one table. Any overlap is a `resolver_conflict` deny, which is correct. |
| **R-7** (slice 7 vs P-10) | **Slice 7 is still needed and stays a separate half-day slice.** P-1 kept the `boost_pack` branch on purpose, and P-10 ("retire the rest of the Pilot-Credit purchase path", "Live (deletion)") has not started. Whichever lands first owns the AgentsPilot boost checkout. In either case FR-40 binds: the **checkout is refused (410, logged)** and the packs are set inactive, but the code path's tables and history are **kept**, not deleted. If P-10 goes first, its *Guarded* list (not *Dies*) must carry the boost-pack checkout, and boost slice 7 becomes "verify only". The plan-payments session must be told this before the P-10 workplan. |
| **R-8** (F-1 placement) | Boost's stuck-purchase check is a **pass** in the shared `bos-billing-reconcile` cron (SA-P4). Whichever of boost 4b and P-8b lands first creates the route, and passes never share rows. The **in-webhook reclaim** of stale `processing` claims is P-8b's (PF-5). Boost go-live therefore requires **either** P-8b merged **or** boost 4b's reconcile pass live; both is the target. The pass alone covers boost purchases even without the reclaim, because it reads Stripe for any `pending` or `awaiting_payment` row past expiry plus grace. |
| **R-9** (refines T-8) | **Boost still creates no Stripe customer.** It never calls `ensureBusinessOsStripeCustomer` or anything that creates one. If the account already has a Business OS customer in `business_os_billing_accounts` (read through its repository), the session **may** pass `customer: <id>` instead of `customer_email`. The slice 3 workplan decides. The plan-payments session owns that table, and boost only reads it. |
| **R-10** (new; aligns with PF-15 / SR-12) | **Test mode on the production database.** `business_os_boost_purchases` carries `livemode boolean NOT NULL`, set from `currentStripeMode()` at reservation. The handler refuses an event whose `livemode` differs from the row's (`flagged_mismatch`). The cap sums only rows of the current mode. Admin lists filter on the current mode. |
| **R-11** (slice 5 shrinks) | The owner card needs **no figure change**: a credited boost lot already shows in "Extra credits" (11d). Slice 5 = the Top up button and package picker on the card, the "payment processing" state and refresh, and the **purchase history** (T-12, its own owner endpoint) that marks each entry *bought*. Showing granted lots in the same history is optional and decided in the slice 5 workplan. The card payload gains **no** key, so the 6a payload pin is untouched (RV-5 relaxed). |
| **R-12** (admin home, refines FR-38 / slice 6) | Boost purchases, statuses, flags and the cap override sit on the **per-account credit view built by 11c** under `/admin/users`, where lots already appear by source, rather than on the Costs & credits tab. The cap override uses the same admin ops path and conventions as `creditAdminOps.ts` (`requireAdmin` first, Zod, reason, audit). |
| **R-13** (locks) | The cap reservation takes its **own** advisory lock (`business_os_boost_cap:<user_id>`), not slice 9's `business_os_credit_lots:<user_id>` draw lock. Crediting inserts a lot and does not need the draw lock (an insert only adds credit). The 11a and 11b repositories are **extended** (a boost-lot read by purchase id, if needed), never copied. When slice 9's first draw writer lands, it widens both lot-reading repositories, and boost changes nothing. |

#### Resolved business question (2026-10-04)

**BQ-B1: should bought credits get their own line on the card?** **Decided by the user 2026-10-04: no.** The card keeps the **single "Extra credits" figure** for admin grants and boost purchases together (S11-D-1). There is no separate "Bought credits" line and no combined total. **The purchase history tells bought from granted.** Q20, §3, the user story, FR-24, FR-25, the card acceptance criterion and §17 are revised to match. T-13's "Bought credits" label is superseded. Its neutral sentence ("used after your plan's credits and do not reset monthly") still applies to extra credits if the card shows one.

#### Revised slices

| Slice | Scope title | Contents | Est. |
|---|---|---|---|
| ~~0~~ | ~~Webhook logging to Pino~~ | Done (P-0 #183). | — |
| **1** | **Price rule and package catalogue** | Unchanged (T-3): `creditRetail.ts` (versioned markup), the computed base rate, `boostPackages.ts` with Zod, integer derivations and the computed bonus %, the `BoostPackageSource` seam, the default cap constant, entitlements registration. | ~1.5–2d |
| **2** | **Purchases and cap-override tables** | Migration **20261030**: `business_os_boost_purchases` (snapshot columns, Stripe ids UNIQUE, `lot_id` UNIQUE FK, `livemode`, amounts subtotal/tax/total, `checkout_expires_at`, receipt url), `business_os_boost_cap_overrides`, and functions reserve / attach / credit (calling `business_os_record_credit_lot`) / status transitions. Grants and RLS, checker, rollback probe, migration tests, repository, owned-table / purge / deletion registrations. The user applies it. **Guardrail:** the lots, draws and both lot functions stay byte-identical. | ~2d |
| **3** | **Checkout (test mode, flag off)** | Unchanged scope plus R-1 (held accounts refused), R-9 (no customer creation) and R-10 (livemode). Marker from `stripeMetadataKeys.ts`. | ~2–2.5d |
| **4a** | **Boost resolver and handler in the dispatcher** | R-6, T-6, T-7, receipt URL capture, audit and Pino. Connect and plan before/after evidence (the P-0 characterisation harness). | ~2.5d |
| **4b** | **Refunds, disputes and the reconcile pass** | T-9 flags (status, audit, `error` log). R-8 reconcile pass, creating `bos-billing-reconcile` if P-8b has not. | ~2d |
| **5** | **Owner Top up and purchase history** | R-11. | ~2–2.5d |
| **6** | **Admin purchases view and cap override** | R-12. | ~1.5–2d |
| **7** | **Retire the AgentsPilot boost checkout** *(superseded 2026-10-06: verify-only, owned by plan payments P-10)* | R-7. **Now:** verify after P-10a deploys and the hand-run pack step is done that `create-checkout` refuses boost packs with 410, the packs are inactive with old values saved, and open sessions still complete. No boost code change. | ~0.5d |

#### Gate table (as of 1a9944a5)

| Slice | Can start now? | Waits for |
|---|---|---|
| **1** | ✅ **Yes: first for the Dev** | The §18.6 BA text corrections are owed **before its workplan is approved**. *(Applied 2026-10-04.)* The workplan may be drafted in parallel. |
| **2** | ✅ **Yes** (workplan now; build after slice 1's types, or in parallel if the snapshot columns are fixed in the workplan) | Nothing from other sessions: 20261017 is applied, and 11a/11b are acknowledged and merged. Record 20261030 with the plan-payments and deduction sessions when the workplan is approved. |
| **3** | ⏸ | Slices 1 and 2 merged, and slice 2 applied to PROD. |
| **4a** | ⏸ | Slice 3. Nothing parallel: the dispatcher is merged. |
| **4b** | ⏸ | 4a. Coordinate with P-8b on who creates `bos-billing-reconcile`. |
| **5** | ⏸ | 4a. 6a, 6b and 11d are merged, so there is no parallel wait. |
| **6** | ⏸ | 4b. 11c is merged. |
| **7** *(superseded 2026-10-06: verify-only)* | ⏸ **Verify only** | P-10a deployed and the hand-run boost-pack step done (plan payments owns FR-40). *(Superseded: "✅ Yes. Nothing. Tell the plan-payments session before P-10's workplan (R-7).")* |

**Go-live note:** boost's go-live items (DEP-3 key rotation, DEP-7 accountant, which the plan-payments go-live checklist row 5 already covers, DEP-8 fee check, DEP-9 Stripe endpoint events including `checkout.session.async_payment_*` and `checkout.session.expired`, the first live receipt check, and R-8's reclaim or reconcile condition) belong in plan payments **§9.5** as pointers to this document. That edit is for the next docs PR on that requirement and is **not** made here. DEP-2 (nothing refuses at zero until credit deduction slices 9–10) still holds. Production Stripe is in test mode, so every slice above can be demonstrated end-to-end in test mode with the flag on for test accounts only.

**Questions for the user:** none open. BQ-B1 is resolved above.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-27 | Created | Formal requirement from the discovery doc and the user's answers to Q1 to Q20. 41 FRs, 4 hazard-prevention requirements (each discovery hazard mapped to a preventing requirement), 10 NFRs, starting packages, acceptance criteria, parked items, dependencies (credit diary, metering/enforcement, key rotation), 15 SA decisions. Records changes to D-8 (all tiers can buy), D-11 (unit left to SA), RD-11 (purchase may precede metering) and TK-5 (retire the AgentsPilot boost checkout). |
| 2026-09-30 | User feedback round 2 | **Unit resolved** (C-2, DEP-5, T-1): the Business OS credit, from the credit deduction work (1 credit = $0.001 of cost, 100% markup, so **$0.002 per credit / 500 per $1**; [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md) §1–§3). **Packages** $10 +5% / $25 +20% / $50 +30%, sanity-checked. **Tax**: prices exclude tax, USA (§9); sales-tax collection open (OQ-3). **Cap** $150 per rolling 30 days confirmed; count cap dropped (FR-21). **Currency**: new §10, what exists by domain (clients vs platform billing) with reuse verdicts; options for the user (OQ-2). **Ledger** (DEP-1): exists; needs a way to add credits shared with admin grant, slice 11 (T-2). DEP-2 re-pointed to slices 9–10; DEP-6 slice 6a card added. Trial rule FR-19. SA list T-1 to T-17. |
| 2026-09-30 | User decisions round 3; **status → Ready for SA review** | **Currency: USD only** (OQ-2 resolved; §10 rewritten as the decision record). **Tax**: v1 uses the simplest mechanism that keeps a switch to collecting tax possible (TX-3, T-14 reworded). The accountant's confirmation is a **pre-launch dependency** (TX-4, DEP-7), not a blocker (OQ-3 resolved). **Packages replaced with "Option A"**: Starter $10 / 5,000 / no bonus; Plus $25 "Most popular" / +10% / 13,750; Max $50 "Best value" / +15% / 28,750. Bonus measured against the 500 credits per $1 base rate. Markup after an **assumed** Stripe fee of 2.9% + $0.30: 88% / 74% / 68%; the user accepted Max below the 70% target (C-7). The fee is to be verified (DEP-8, T-18). **New FR-42**: the displayed bonus % is computed from the configured base rate, never a hand-typed label; FR-1/FR-2 and the acceptance criteria updated to match, and a new hazard-map row. Cap unchanged ($150 / rolling 30 days, no count cap). No business question open; OQ-4 remains for SA. |
| 2026-09-30 | SA review: **APPROVED WITH CONDITIONS** | New §18. Fact check against main de4b31f2 (ledger, webhook hazards, credit value). The markup is not in code (F-3). A stuck webhook claim can lose a paid boost (F-1, reconciliation required). The diary's no-dollars rule conflicts with FR-26 (F-4). Adaptive Pricing would charge local currency (F-7). T-1 to T-18 ruled: **T-2**: a new append-only `business_os_credit_lots` table and one recording function shared with admin grant (slice 11); lots never touch the per-period totals, so resets cannot affect them. Purchase row = cap reservation and routing identity. Inline pricing, no Stripe Customer, tax-exclusive with tax recorded separately. Slices 0–7 proposed. BA text corrections listed in §18.6. No user question. |
| 2026-10-01 | SA re-validation: **still APPROVED WITH CONDITIONS** | New §18.8 (requested as §18.7, which already held the user questions). Delta to main 8f18aaf2 (#161, and #162 invite 5b-1 merged with `20261024` applied) plus the uncommitted credit deduction slice 6a. Every §18.1 fact holds, and the pricing assumptions are unchanged. New: R-1, the checkout refuses accounts awaiting payment (reuses `readPaymentHold`, fails closed). R-2, a boost never writes lineage or plan rows, and 5c's payment stamp never keys on a boost. R-3, the webhook hook is a shared Business OS dispatcher. R-4, migration block 20261030–34 (replaces F-12). R-5, conditions for deduction slices 9 and 11 (lots table, balance at the start of the period, two figures). Per-slice gate table: slices 0, 1 and 7 can start now. Slice 2 waits for the deduction session's T-2 acknowledgement. Slice 5 waits for slice 6a merged. |
| 2026-10-02 | Credit deduction slice 11 creates the lots table | New §18.9 (recorded from the credit deduction session). T-2 / R-5 acknowledged; credit deduction 11a creates `business_os_credit_lots`, `business_os_credit_lot_draws` and both lot functions in migration 20261017, with both sources allowed. Boost slice 2 must not create them again, builds only after 20261017 is applied to PROD, and creates only its purchase and cap-override tables. "Extra credits" replaces "Bought credits" as the single owner figure (S11-D-1); bought credits may be taken back with a stronger confirmation (S11-D-7) |
| 2026-10-04 | §18.9: take-backs need a plan row | Credit deduction 11b audit F5: `reduce_credit_lot` refuses accounts with no plan row, so a manual clawback of a boost lot needs a plan row; boost purchases written by the webhook are unaffected |
| 2026-10-04 | SA re-baseline against main 1a9944a5; BQ-B1 decided | New §18.10. Verified on main: 11a lots, draws and both lot functions (20261017, boost shape CHECK built); 11b `confirmPaidCredits`; 11c and 11d "Extra credits"; P-0 Pino (slice 0 done); P-1 dispatcher with the boost marker; P-2a billing accounts (20261025); migrations 20261026 and 20261035 taken, 20261030–34 free; markup still not in code. Superseded: slice 0, slice 2's lots design, the T-4 seam, T-13 "Bought credits". New rulings R-6 to R-13 (boost resolver with a keyed purchase read, slice 7 vs P-10, the reconcile pass in the shared cron, no customer creation, livemode, slice 5 shrinks, admin home on the 11c view, separate cap lock). **BQ-B1 decided by the user 2026-10-04:** one "Extra credits" figure for grants and boosts, with the history telling them apart; Q20, §3, the user story, FR-24, FR-25, the card AC and §17 revised. Revised slices 1–7 and gate table: slices 1, 2 and 7 can start now; slice 1 is first. Go-live items to be added to plan payments §9.5 by its next docs PR. Superseded markers added to §18.5 and §18.8 rows. |
| 2026-10-04 | BA: §18.6 text corrections and §18.10 fold-in | No business decision changed. **§18.6 items 1–6 applied:** FR-14/FR-30/FR-31/FR-32/§5.6/DEP-1 now name `business_os_credit_lots` (built by 11a, migration 20261017) and `business_os_boost_purchases`, with remaining credits derivable from append-only records. FR-26: purchase history beside the diary. FR-27 and its AC: receipt per F-6. FR-2: CI wording (F-9, Jest gate B-10). §8.1: the markup gets a config home, `creditRetail.ts`. FR-22 and its AC: override in boost slice 6. DEP-4 not needed; new DEP-9 (endpoint events); new NFR-12 (retention and registries); new FR-43 (stuck-purchase reconciliation); §10.3 Adaptive Pricing disabled (F-7). §17: checkout route `app/api/business-os/credits/boost/checkout`, `StripeService.ts` not changed, `billing_events` not written. **§18.10 folded in:** FR-6/DEP-6 (card already built, button only, R-11); FR-9 and its AC (accounts on payment hold refused, R-1); FR-13/FR-20 and new ACs (livemode, R-10); FR-18 (no customer creation, R-9); FR-33/FR-37 (11b take-back with `confirmPaidCredits`); FR-38/§17 (admin home on the 11c view, R-12); FR-40 (slice 7 vs P-10, R-7); HP-3 (dispatcher resolver and handler, R-6); NFR-5 (webhook already on Pino, P-0); new DEP-10 (plan-payments shared infrastructure); OQ-4 closed and BQ-B1 recorded in §16. Superseded wording is marked, not deleted. SA sections are untouched apart from the "applied" markers on §18.6 and the §18.10 slice 1 gate row. |
| 2026-10-04 | Slice 1 — workplan drafted | Dev drafted [BUSINESS_OS_CREDITS_BOOST_SLICE_1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_1_WORKPLAN.md) (price rule and package catalogue: `creditRetail.ts`, computed base rate, `boostPackages.ts`, `BoostPackageSource`, default cap; config, pure functions and tests only). Awaiting SA workplan review; no business question raised |
| 2026-10-04 | Slice 1 — SA workplan review | Approved with conditions C-1 to C-6 (the figure guard exempts money in minor units; worktree test and tsc procedure; memoisation; append-only package snapshot; shipped pairing test; narrow doc edits). Q-2 to Q-9 agreed. No user question |
| 2026-10-04 | Slice 1 — implemented, awaiting SA code review | `creditRetail.ts` (markup, append-only), `retailRate.ts` (computed 500 per $1), `boostPackages.ts` (Starter / Plus / Max as data, default $150 / 30-day cap), `boostCatalogue.ts` (Zod, derived credits, computed bonus %, `BoostPackageSource`, fails closed), four test suites. Local bar green (10 suites, 252 tests; scoped tsc 0 errors in the module). No business decision changed |
| 2026-10-04 | Slice 1 — SA code review approved | The CR-1 fix (frozen, copied packages and config) plus CR-2 and CR-3 re-checked. 10 suites and 255 tests green; scoped tsc 0 errors in the module. Awaiting QA |
| 2026-10-04 | Slice 1 — QA PASS WITH NOTES | Approved figures, the computed 500 per $1, the $150 / 30-day cap, FR-42 (computed bonus %), fail-closed rejection on 27 invalid configs, `null` for unknown and inactive ids, frozen outputs and lazy import all verified. No bug. Two Low notes: the label check misses some figure-like characters (`％`, `½`), which matters for slice 5 copy; slice 3's checkout must treat any loader rejection as a refusal. No business decision changed |
| 2026-10-05 | Slice 1 — committed | The user saw and approved the diff. Committed on `feature/bos-credits-boost-slice-1` and opened as [PR #224](https://github.com/AgentsPilot/neuronforge/pull/224) to main. No business decision changed |
| 2026-10-05 | Slice 1 — merged (PR #224); slice 2 workplan drafted | Slice 1 merged to main as [PR #224](https://github.com/AgentsPilot/neuronforge/pull/224). Dev drafted [BUSINESS_OS_CREDITS_BOOST_SLICE_2_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_2_WORKPLAN.md): purchases and cap-override tables, reservation and cap, crediting and status functions, proposed as 2a (migration 20261030) and 2b (migration 20261031). Awaiting SA workplan review. No business question raised |
| 2026-10-05 | Slice 2 — SA workplan review | Approved with conditions C-1 to C-8. The split is approved: 2a = migration 20261030, reservation and cap; 2b = 20261031, crediting and status. Key conditions: column-level INSERT grants; session id at most 194 characters to fit the lot key; checker B8 reported as INFO. No user question |
| 2026-10-05 | Slice 2a — implemented, awaiting SA code review | SA approved the slice 2 workplan with conditions C-1 to C-8 and the 2a / 2b split. 2a built: migration 20261030 (`business_os_boost_purchases`, `business_os_boost_cap_overrides`, reserve / attach / abandon / set and end cap override, column-level grants, owner column read), checker, write probe, rollback, repository, registries. Verified locally on a throwaway PGlite database. The user applies the migration to PROD after the PR is approved. No business decision changed |
| 2026-10-05 | Slice 2a — SA code review approved | Code Approved for QA, with no must-fix. Verified with the local suites, PGlite (checker PASS, probe PASS, rollback) and planted mutations. Before the PR: record migration numbers 20261030/31 with the other sessions (C-7). Before the PROD apply: record `version()` in the pre-check |
| 2026-10-05 | Slice 2a — QA PASS WITH NOTES | The cap holds at exactly $150 and refuses $150.01. Test and live are counted apart, in-flight checkouts count until 5 min after expiry, and abandoned or expired ones do not. Admin overrides raise, lower and revert the cap. No client can read another account's purchases or hidden columns, write anything or run any function. Deleting an account keeps its purchase records, detached. One fix is owed before the PR: the read-only checker reports a false failure after accounts with an override are deleted. Two Low notes: a very late checkout attach can exceed the cap, and the repository can reject on a malformed input. No business decision changed |
| 2026-10-05 | Slice 2a — QA follow-ups applied, ready for user review | SA code review approved (CR-2, CR-3 applied). QA passed with notes; follow-ups applied (checker fix for deleted accounts, stale-reservation refusal on attach, repository null-input handling, extra probe coverage). Migration 20261030 not yet applied; the migration-number recording with the other sessions is pending. No business decision changed |
| 2026-10-06 | FR-40 owned by plan payments P-10; slice 7 verify-only | P-10 (SA-approved 2026-10-05) switches the AgentsPilot boost checkout off: `create-checkout` returns 410 for every purchase type. The webhook boost branch and checkout code stay so open sessions complete. Packs are set inactive by a hand-run step after P-10a deploys, old values saved first. FR-40 note added; §18.10 slice 7 row and gate row marked superseded (verify-only). Boost migration block 20261030–34 acknowledged by both other sessions (slice 2 workplan §6.5). No business decision changed |
| 2026-10-06 | Slice 2a: probe P17 removed from PROD per user | The production runbook never writes to `auth.users`. The account-deletion detach check runs only in the local PGlite smoke test; on PROD the `ON DELETE SET NULL` rule is proven by the read-only checker (B4). No business decision changed |
| 2026-10-06 | Slice 2a — committed, PR #233 open | The user approved the commit on 2026-10-06 after seeing the diff (SA code review approved; QA passed with notes, follow-ups applied). Committed on `feature/bos-credits-boost-slice-2` and opened as [PR #233](https://github.com/AgentsPilot/neuronforge/pull/233) to `main`. Migration 20261030 is NOT yet applied to PROD; the user applies it after merge per the slice 2 workplan §6.6. 2b not started |
| 2026-10-06 | Slice 2a — applied to PROD and verified | The user applied migration 20261030 to PROD (13:46:19 UTC) and ran the slice 2 workplan §6.6 runbook: pre-check and md5s matched, new checker PASS 20/0, existing lots and charges checkers PASS, probe P00–P16 PASS, recheck PASS with nothing kept. Results: [workplan §6.9](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_2_WORKPLAN.md). PR #233 awaiting merge; next 2b |
| 2026-10-06 | Slice 2a — merged (#233); 2b workplan drafted | 2a merged as PR #233; migration 20261030 applied to PROD 2026-10-06 and verified (slice 2 workplan §6.9). Dev drafted [BUSINESS_OS_CREDITS_BOOST_SLICE_2B_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_2B_WORKPLAN.md): migration 20261031 with the credit, transition and receipt functions. Awaiting SA workplan review. No business question raised |
| 2026-10-06 | Slice 2b — SA workplan review | Approved with conditions C-1 to C-6: a lot-key conflict is flagged, not retried; currency compared case-insensitively; dispute won restores the pre-dispute status; refund and dispute facts recorded on disputed and flagged rows; the probe neutralises overrides; payment-intent identity checks. No user question |
| 2026-10-06 | Slice 2b — implemented, awaiting SA code review; status line tidied | SA approved the 2b workplan with conditions C-1 to C-6 (C-7 a note). 2b built: migration 20261031 (credit, transition and receipt functions; an 11-column UPDATE grant), the shared checker moved to the post-2b state, a new write probe with no `auth.users` writes, a rollback that never drops a table, repository methods and tests. Verified on a throwaway PGlite database. The status line now lists the slices in order; the earlier per-slice notes are in this table. No business decision changed |
| 2026-10-06 | Slice 2b — SA code review approved | Code Approved for QA. Verified with the local suites, PGlite (checker, both probes, rollback, adversarial run) and planted mutations. Doc must-fixes: the runbook warns that the boost checker is post-2b only (before the PR is merged), and gives the exact 9-function md5 pre-check (before the PROD apply) |
| 2026-10-06 | Slice 2b — QA PASS WITH NOTES | A paid boost writes exactly one credit lot of the right size (base plus bonus), to the account on the purchase. A repeated payment event never credits twice. Every data mismatch (wrong session, mode, currency, amount, a reused payment, a deleted account) flags the purchase for an admin, adds no credits, and does not loop. Refunds and disputes are recorded in either order and never take credits back. The receipt link is filled once and never overwritten. Owners cannot run the functions or see the hidden payment fields. The PROD pre-check query matches its table exactly. Two Low notes: a late partial-refund event after a full refund is reported as "not allowed" rather than "out of date" (no data effect); and a defensive check for an out-of-band lot is suggested. No business decision changed |
| 2026-10-06 | Slice 2b — QA follow-ups applied, ready for user review | SA code review: approved for QA (doc fixes to the PROD runbook applied). QA passed with notes. Follow-ups: an out-of-order lower refund is answered `stale`; crediting links an existing lot only if it is the purchase's own; more probe coverage. Migration 20261031 not yet applied. No business decision changed |
| 2026-10-06 | Slice 2b — committed, PR #235 open | The user approved the commit on 2026-10-06 after seeing the diff (SA code review approved, including the re-check of QA fixes D1/D2; QA passed with notes, follow-ups applied). Committed on `feature/bos-credits-boost-slice-2b` and opened as [PR #235](https://github.com/AgentsPilot/neuronforge/pull/235) to `main`. Migration 20261031 is NOT yet applied to PROD; the user applies it after merge per the slice 2b workplan §6.5. Do not run the boost checker on PROD before 20261031 is applied |
| 2026-10-06 | Slice 2b — applied to PROD and verified | The user applied migration 20261031 to PROD (16:44:09 UTC) and ran the slice 2b workplan §6.5 runbook: the pre-check md5s matched, boost checker PASS 22/0, the existing lots and charges checkers PASS, probe PASS, recheck PASS with nothing kept. Results: [2b workplan §6.6](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_2B_WORKPLAN.md). PR #235 awaiting merge; next slice 3 |
| 2026-10-06 | Slice 2b — merged (#235); slice 3 workplan drafted | 2b merged as PR #235; migrations 20261030 and 20261031 applied to PROD and verified. Dev drafted [BUSINESS_OS_CREDITS_BOOST_SLICE_3_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_3_WORKPLAN.md): the owner checkout route behind a server flag (test mode), about 2 to 2.5 days. Awaiting SA workplan review. No business question raised |
| 2026-10-06 | Slice 3 — SA workplan review | Approved with conditions C-1 to C-7, plus C-8 for 4a. Key points: the flag stays off in deployed environments until 4a; a reservation is never abandoned while its Stripe session may still be paid; session expiry 31 minutes. No user question |
| 2026-10-06 | Slice 3 — implemented, awaiting SA code review | SA approved the slice 3 workplan with conditions C-1 to C-7 (C-8 binding on 4a); the user approved the build. Built: `POST /api/business-os/credits/boost/checkout` behind the server-only flag `BUSINESS_OS_CREDITS_BOOST_ENABLED` (off; not to be set on Vercel until 4a is deployed) with an optional test-account list; payment hold fail-closed; reservation under the $150 / 30-day cap; a Stripe embedded checkout session (USD, tax-exclusive, Adaptive Pricing off, no customer); and safe clean-up that never leaves a payable session without its reservation. Mocked tests only; Stripe stays in test mode. No business decision changed |
| 2026-10-06 | Slice 3 — SA code review: fix required | Three small fixes before QA: an ambiguous Stripe create failure must not release the reservation; a test-account list with no valid ids must close the checkout; use the bounded audit flush. Everything else approved |
| 2026-10-06 | Slice 3 — SA code review approved | CR-1 to CR-3 re-checked (a definite Stripe rejection versus an indeterminate failure; a set test-account list always restricts; bounded audit flush). Awaiting QA |
| 2026-10-06 | Slice 3 — QA PASS WITH NOTES | Verified with mocks only (no real payment, no database writes): the checkout is invisible while the switch is off; only signed-in owners not awaiting payment can start one; the browser can send nothing but the package choice; the price, currency, cap and account always come from the server; a broken catalogue or a full cap refuses before anything is reserved; the Stripe session is exactly the approved one: USD, the package price, tax-exclusive, no currency conversion, no promotion codes, no saved customer, a 31-minute expiry; every failure releases the reservation, unless a payable session might still exist, in which case it is kept and an alert is raised; the answer carries only what the payment screen needs, and no secret or email is logged in the tested paths. Two Low notes: an unexpected internal error in the reservation step would skip closing the Stripe session (not reachable today); and a Stripe error message could carry the buyer's email into the server logs. No business decision changed |
| 2026-10-06 | Slice 3 — QA follow-ups applied, ready for user review | Both Low QA notes fixed: an unexpected internal error in the reservation or attach step is now handled like any other failure (the Stripe session is closed before the reservation is released, or an alert is raised if it cannot be); and Stripe errors are logged as a few fixed facts only, so the buyer's email cannot reach the server logs. Seven extra tests added; all green. No business decision changed |
| 2026-10-07 | Slice 3 — committed, PR #247 open | The user approved the commit on 2026-10-07 after seeing the diff (SA code review approved, including the CR-1 to CR-3 re-check; QA passed with notes, follow-ups applied). Committed on `feature/bos-credits-boost-slice-3` and opened as [PR #247](https://github.com/AgentsPilot/neuronforge/pull/247) to `main`, with the one-address fix OA-1 (user and SA approved 2026-10-07). No migration. `BUSINESS_OS_CREDITS_BOOST_ENABLED` must stay unset on Vercel (Preview and Production) until slice 4a is merged and deployed |
| 2026-10-07 | Slice 3 merged; slice 5 split; 5a workplan drafted | PR #247 (checkout, flag off) merged. The user split slice 5 and moved 5a ahead of 4a: every owner sees a Top up button on the Credits card and a picker with the three packages (prices excluding tax, credits, the computed bonus, the badges), with Buy disabled as "Coming soon" (decision B, §16 BQ-5a). 5a does not depend on the checkout flag and never calls the checkout. 5b (Buy, Stripe form, return, Purchases history) follows 4a. No other business decision changed |
| 2026-10-07 | Slice 5a — SA workplan review | Approved with conditions C-1 to C-5. The inert purchase UI for every owner is safe: Buy is hard-disabled and the checkout route stays behind the off flag until 4a. No user question |
| 2026-10-07 | Slice 5a — implemented, awaiting SA code review | SA approved the 5a workplan with conditions (prices formatted with the payments money rules; nothing internal sent to the browser; the picker provably cannot start a purchase; Hebrew and Spanish texts listed for native review). Built: the Top up button on the Credits card and the package picker: three packages with the price excluding tax, the credits and the computed bonus, and a disabled "Coming soon" Buy, for every owner. The checkout is not called and its switch is not read. No business decision changed |
| 2026-10-07 | Slice 5a — SA code review approved | Code Approved for QA with no must-fix. SA type-checked the `.tsx` files (0 new errors), re-ran 380 tests and planted mutations (Buy enabled; a version leak), all caught |
| 2026-10-07 | Slice 5a — QA PASS WITH NOTES | The packages read refuses signed-out users and shows exactly Starter $10 / 5,000 credits, Plus $25 / 13,750 (+10%, 1,250 bonus credits) and Max $50 / 28,750 (+15%, 3,750 bonus credits), straight from the catalogue. A broken or empty catalogue shows an error with Try again, never an empty list. Prices read correctly in English, Hebrew (right-to-left, panel from the left) and Spanish, always "excl. tax". Buy stays "Coming soon" and sends nothing even if the server ever said otherwise. No internal pricing fields reach the browser. One accessibility fix is recommended before the PR: after closing the panel, keyboard focus should return to Top up (today it falls to the top of the page). One Low note: the figure guard cannot catch a hand-typed "5,000 credits". No business decision changed |
| 2026-10-07 | Slice 5a — QA follow-ups applied, ready for user review | SA code review approved; QA passed with notes, both fixed: after closing the package picker, the keyboard focus returns to the Top up button (an accessibility fix); and the safeguard against a hand-typed credit figure now also catches the Starter package's figure. More tests for the Hebrew and Spanish formats and for error states. No business decision changed |
| 2026-10-07 | Slice 5a — committed, PR #252 open | The user approved the commit on 2026-10-07 after seeing the diff (SA code review approved; QA passed with notes, follow-ups applied). Committed on `feature/bos-credits-boost-slice-5a` and opened as [PR #252](https://github.com/AgentsPilot/neuronforge/pull/252) to `main`. Every owner sees the Top up button and the packages; Buy is disabled ('Coming soon'). No purchase is possible and the checkout flag stays off |
| 2026-10-07 | Slice 5a merged; 4a workplan drafted | PR #252 (the packages shown, Buy disabled) merged. The user asked for slice 4a next: the payment webhook credits a paid boost exactly once, records the receipt link and an audit entry, and handles delayed payments, failures and expiry. A purchase that does not match is flagged and alerted, never credited silently. Refunds, disputes and the stuck-purchase check remain slice 4b. The workplan lists the Stripe events to subscribe and the steps for switching boosts on for testing. No business decision changed |
| 2026-10-07 | Slice 4a — SA workplan review | Approved with conditions C-1 to C-6. Key points: precise deterministic/transient error classes; resolver and handler ship together; the `client_reference_id` fallback never flags a row with a different session. **Go-live gate: real money requires 4b (refunds, disputes, reconcile) and the stuck-claim reclaim.** No user question |
| 2026-10-07 | Slice 4a — implemented, awaiting SA code review | SA approved the 4a workplan with conditions. Built: the payment webhook now credits a paid boost exactly once, against the purchase's own account, and handles delayed payments, failures and expiry. Every disagreement is flagged and alerted; the owner sees only "Payment under review". A temporary database problem makes Stripe retry, while a permanent one stops with an alert. Connect payments are untouched. The go-live-for-testing steps now include "never on Preview" and the exact recovery statement. Real money still needs slice 4b. No business decision changed |
| 2026-10-07 | Slice 4a — SA code review approved | Code Approved for QA. The claim lifecycle was verified (transient failures release, deterministic ones complete), Connect is byte-identical, and the tests and mutations are green. One rule-3 item: the touched `monitoring/page.tsx` still uses `console.*`; it is converted or the user declines before the commit |
| 2026-10-07 | Slice 4a — QA PASS WITH NOTES | Verified with mocks only (no real payment, no database writes). A paid boost credits exactly once, only when Stripe says paid, always to the account on the purchase; repeated or out-of-order events never credit twice; a temporary database problem makes Stripe retry, and a permanent one is completed with an alert so it cannot loop; mismatches (wrong mode, wrong product, a payment naming someone else's purchase) add no credits and never move another owner's purchase; card-payment events from connected business accounts, plan payments and old agent-platform packs are unaffected; the receipt lookup can be slow or fail without affecting crediting; no email or secret appears in logs or audit entries, and owners see a neutral "Payment under review" without internal codes. The test-mode recovery statement in the workplan is paste-safe and can only release a stuck test-mode claim for a still-unpaid purchase. One Medium note: if Stripe delivers an old "awaiting payment" event after the purchase was already credited, an alert fires and the owner sees "Payment under review" next to "Credits added" (money is correct); a small fix is recommended before the PR. No business decision changed |
| 2026-10-07 | Slice 4a — QA follow-ups applied; rule-3 monitoring page decision pending | SA code review approved; QA passed with notes. Fixed: an out-of-order "payment still pending" message for a purchase that is already paid no longer raises an alarm or shows "Payment under review" to the owner. The recovery statement now also checks the kind of payment event. Added tests for every combination of event and purchase state. One decision waits for the user: whether to convert the old activity page's logging (CLAUDE.md rule 3). No business decision changed |
| 2026-10-08 | Slice 4a — monitoring page converted; ready for user review | The user decided the old activity page's logging is converted as part of 4a; it now uses the platform's structured logging, with no change to what the page does. Bringing the branch up to date with main needs the 4a work committed first; a preview shows no conflicts. No business decision changed |
| 2026-10-08 | Slice 4a — committed, PR #259 open | The user approved the commit on 2026-10-08 after seeing the diff (SA code review approved; QA passed with notes, follow-ups applied; CR-1 resolved by converting the monitoring page to Pino; SA approved the commit-then-merge plan). Committed on `feature/bos-credits-boost-slice-4a` and opened as [PR #259](https://github.com/AgentsPilot/neuronforge/pull/259) to `main`. No migration. After deploy the user subscribes the Stripe events (slice 4a workplan §7). `BUSINESS_OS_CREDITS_BOOST_ENABLED` stays off until 5b |
