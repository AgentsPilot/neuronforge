# Business OS Tier Billing — Reuse Plan and Revised Slice Strategy

> **Last Updated**: 2026-09-25

**Created by:** BA
**Date:** 2026-09-24
**Status:** ✅ **SA APPROVED as the plan of record** (2026-09-25) — see [§13 SA Review](#13-sa-review), written by SA. SA's four required changes (**SA-1 to SA-4**), the two ledger corrections and the three verified claims are **applied to the body of this document**; SA's §13 is preserved verbatim. Business questions **Q-B1 to Q-B9 DECIDED by the user** (§1.2); the evidence gate **E-1/E-2 answered by the user** (§1.3); **E-3 and Q-T1 to Q-T11 decided by SA** (§13.5). Remaining items are the business items in §10.3.
**Supplements:** [BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md) (§13 Billing Linkage Scope, §16 Delivery Slicing). It does **not** replace it. Differences are in §7.

## Overview

A colleague (Offir) reported that much of the tier and subscription machinery already exists. An evidence-based audit was run, and the findings below were re-verified against the code. The short answer is: **the plumbing is real and production-working, but it is plumbing for a different product.** The agent platform can take recurring money, upgrade, downgrade, cancel, dun and renew — and it has **no concept of a named plan with contents**. Business OS has the opposite: a complete, merged, production-applied concept of named plans with contents (`trial`, `champion`, `basic`, `pro`) and **no way for anybody to pay for one**.

This document says precisely what can be reused, what must be adapted, what must be built, what must be **deleted**, and in what order — so the remaining work is sized against what exists rather than against what the original slice plan assumed.

---

## Table of Contents

1. [How to read this document](#1-how-to-read-this-document)
2. [Verified findings](#2-verified-findings)
3. [The reuse ledger](#3-the-reuse-ledger)
4. [The fixed-price question, and retiring the credit purchase path](#4-the-fixed-price-question-and-retiring-the-credit-purchase-path)
5. [Decisions](#5-decisions)
6. [Revised slice plan](#6-revised-slice-plan)
7. [What changed versus the existing requirement](#7-what-changed-versus-the-existing-requirement)
8. [What "finished" means](#8-what-finished-means)
9. [Housekeeping: fold in or spin out](#9-housekeeping-fold-in-or-spin-out)
10. [Decisions and open questions](#10-decisions-and-open-questions)
11. [Deferred open issues](#11-deferred-open-issues)
12. [Integration points](#12-integration-points)
13. [SA Review](#13-sa-review)

---

## 1. How to read this document

### 1.1 Conventions

- **Plan names.** The body of this document uses the **internal ids** — `trial`, `champion`, `basic`, `pro`. The customer-facing names (Test Flight, Founding Partner, Essentials, Autopilot) are **data**, held in `tierMatrix.ts`'s `presentation` block, and are deliberately not used to reason with. This matters beyond style: renaming a plan must never mean rewriting a `tier` column or a requirement, and FR-12 already forbids code branching on a tier name.
- **F-n** = a verified finding. Each row says how it was verified. **The three claims BA could not verify (no grep tool was available) were checked by SA and all three held** — F-11, F-18, F-19.
- **L-n** = a row of the reuse ledger. Four verdicts, plus the reason in business terms.
- **RD-n** = a decision. RD-1 to RD-16 are **approved by SA** (§13); RD-4 was rewritten by SA-1 and RD-16 added by SA-4.
- **S-n** slices · **WS-n** workstreams inside S-4a · **TK-n** named tasks · **H-n** housekeeping · **OI-n** deferred open issues · **Q-Bn / Q-Tn** questions · **E-n** evidence · **SA-n** SA's required changes.

**The B-8 test** is applied to every ledger row. B-8 (decided 2026-09-19) says Business OS billing stays separate from the agent platform's Pilot Credits. The test is: *does reusing this piece create a path by which a Business OS payment produces agent-platform value, or vice versa?*

### 1.2 Decisions of 2026-09-25 (DECIDED by user)

| # | Question | Decision |
|---|---|---|
| **Q-B1** | One invoice or two for a dual-product customer | **NOT RELEVANT.** The agent platform is being **parked**. A dual-product customer is not a case that exists for now; if it returns it gets supported then. |
| **Q-B2** | Currency | **USD only for now.** Multi-currency pricing is recorded as a deferred open issue — **OI-1** (§11). |
| **Q-B3** | `champion` gets `basic`-level entitlements, so champions lose chat at switch-on | **Leave as is for now; revisit during testing.** It is a one-line cohort change whenever wanted. |
| **Q-B4** | `trial` cannot demonstrate chat | **No — keep chat out of `trial` for now.** Infrastructure first; adding chat to a cohort later is a very low-effort change. |
| **Q-B5** | Self-serve or sales-assisted buying | **Both.** Includes a customer-facing surface under the user's configuration/settings area describing the plans with a buy/upgrade button. **SA-3 re-sized this from a section to its own workstream** — see §6.5 WS-2. |
| **Q-B6** | Grace before a lapsed payer's public pages go dark | **5 days.** Invoice pay links, receipts and booking cancel/reschedule links keep working throughout, per B-11. |
| **Q-B7** | Refund on mid-month cancellation | **No refunds.** Access runs to the end of the paid period. |
| **Q-B8** | Annual plans | **Later.** |
| **Q-B9** | Wording for "billed separately" | **NOT RELEVANT** while the agent platform is parked. |

**The parking of the agent platform is the consequential one.** It removed the main justification for §4's original recommendation, so §4 was re-derived — and the evidence below then settled it.

### 1.3 Evidence gate answered by the user (2026-09-25)

E-1 and E-2 are **the user's statements of fact about the business**, recorded as such — not inferences drawn from the code or the database.

| # | Evidence | Answer |
|---|---|---|
| **E-1** | Live paying subscriptions on the platform Stripe account | Query run: `select status, count(*), count(*) filter (where monthly_amount_usd > 0), max(updated_at) from user_subscriptions group by status`. **One row: `active`, 4 subscriptions, all 4 with a non-zero monthly amount, last change 2026-07-19.** The user states plainly: **the agent platform is not live in production, there are no real paying customers, and all four are testing accounts.** ⚠️ The query evidences *our records*, not Stripe's — hence **TK-1**. Note also the absence of any `canceled` or `past_due` row, consistent with subscriptions never taken through a real lifecycle. |
| **E-2** | Must the agent platform's billing keep working while parked? | **No.** *The user's statement:* the agent platform is parked and its billing does not need to keep working for customers. |
| **E-3** | What else depends on `user_subscriptions` outside billing? | **Answered by SA** — §13.3, reflected in §4.6. Retiring the purchase path is **not** retiring the table. |

**Consequence:** §4 adopts **option B — retire the Pilot-Credit purchase path as part of the same work**, and SA ruled that it must merge into S-4a rather than follow it (§13.3).

---

## 2. Verified findings

### 2.1 What genuinely exists and works (agent platform)

| # | Finding | Verified by |
|---|---|---|
| **F-1** | **Recurring subscriptions work end to end.** `createCustomCreditSubscription` builds a `mode: 'subscription'`, `ui_mode: 'embedded'` checkout session against a Stripe customer. | `lib/stripe/StripeService.ts:107-196`; `app/api/stripe/create-checkout/route.ts` |
| **F-2** | **Upgrade/downgrade with a deliberate hybrid proration policy**: upgrades `always_invoice` (charged now), downgrades `none` (next cycle, no refund). | `StripeService.ts:301-359`, esp. `:350`; `app/api/stripe/update-subscription/route.ts` |
| **F-3** | **Cancel and reactivate** via `cancel_at_period_end`. | `StripeService.ts:364-381` + routes |
| **F-4** | **Customer portal, invoice list, session status and a manual `sync-subscription` fallback** all exist as routes. | `StripeService.ts:280-290, 393-400`; nine routes under `app/api/stripe/` |
| **F-5** | **The webhook envelope is the strongest asset here.** Signature verification with **dual secrets** (`STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`), an event-claim idempotency table (`processed_webhook_events`) claimed **before** the handler runs, `23505` handled as a concurrent claim, and **release-on-error** so a Stripe retry is not silently swallowed. Plus a connected-account vs platform split on `event.account` and a nine-case switch. | `webhook/route.ts:2380-2560`; SA-confirmed §13.1 |
| **F-6** | **Period-boundary allowance renewal is already modelled correctly**: on `invoice.paid` a renewal *replaces* the subscription allowance and *preserves* boost, reward and welcome grants — exactly the semantic B-6 specifies for Business OS. SA confirmed it at two sites, commented `SUBSCRIPTION CREDITS DO NOT ROLL OVER - replace with new allocation`. | `webhook/route.ts:139-180`; SA-confirmed |
| **F-7** | **Dunning exists**: retry counter, then **per-user `grace_period_days`, else `payment_grace_period_days` from `system_settings_config`, else a default of 3**; on exceed → `status: 'past_due'` **and agents paused**; a `billing_events` row and an audit entry. ⚠️ **This is live agent-platform code and keeps reading that config key** (SA-4, RD-16). | `webhook/route.ts:346-447`; SA-confirmed |
| **F-8** | Live tables in use: `user_subscriptions` (source of truth), `credit_transactions`, `billing_events`, `processed_webhook_events`, `boost_packs`. | Read across the webhook and `CreditService` |
| **F-9** | A working user billing UI exists at `/settings` → Billing. | `app/(protected)/settings/page.tsx:23,56-60` → `components/settings/BillingSettings.tsx` |

### 2.2 What does not exist

| # | Finding | Verified by |
|---|---|---|
| **F-10** | **There is no named-plan-with-contents concept anywhere on the agent platform.** Billing is a continuous slider: the customer picks a number of Pilot Credits (min 1,000, max 10,000,000) and that becomes the monthly charge. | `create-checkout/route.ts:77-89`; `StripeService.ts:107-196` |
| **F-11** | **The `plans` table is orphaned and its migration is not in the repo.** Globbing `supabase/migrations/*plan*.sql` returns only chat-plan cache/saved-plan migrations and *client* payment-plan migrations. ✅ **`.from('plans')` has ZERO callers — verified by SA** (§13.1): the table is genuinely orphaned. ⚠️ **"Plan" is overloaded in this repo**: `payment_plan_subscriptions` is *a customer's instalment plan for an invoice*, not a platform tier. Not prior art. | Glob; **SA-verified** |
| **F-12** | **There are no fixed Stripe products or prices.** `stripe.prices.create()` is called **per checkout** (`:149`) and **per upgrade** (`:321`), each with an inline `product_data`. ✅ SA confirmed there is **no `lookup_key` anywhere in the file**. In business terms: **Stripe cannot answer "who is on `pro`?"** — every subscriber sits on a private, one-off price whose only identity is a name string like "100,000 Pilot Credits". | `StripeService.ts:149, 321`; **SA-verified** |
| **F-13** | **Business OS has no billing or plan surface at all.** `app/business-os/settings/page.tsx` renders profile, language, currency, timezone, password, notifications, marketing consent and the erasure/danger zone. No plan card, no invoice list, no upgrade button, no usage meter. | `app/business-os/settings/page.tsx:1-80` |
| **F-14** | **Nothing in Business OS can take a subscription payment.** The whole surface under `app/api/stripe/` is Pilot-Credit-shaped. Business OS's own Stripe usage is **Connect** — taking money from *the business's* clients, a different direction of money. | Glob of `app/api/stripe/`; `StripeService.ts:413-776` |

### 2.3 Weak enforcement today (agent platform)

| # | Finding | Verified by |
|---|---|---|
| **F-15** | `checkExecutionAllowed` enforces only two rules — account frozen, and balance below estimated cost — and **fails open on a DB error** (returns `allowed: true`), and also on a missing subscription row. | `lib/services/CreditService.ts:388-438`, esp. `:404-408` |
| **F-16** | **`check-free-tier-expiration` is not scheduled.** `vercel.json` registers 15 crons and this is not one of them, so nothing freezes a lapsed free account. | `vercel.json`; the route exists |
| **F-17** | ⚠️ **F-16 is now a Business OS problem.** That cron freezes accounts that never bought Pilot Credits. Under B-8 a paying Business OS customer will, correctly, never buy Pilot Credits. **Scheduling it as written would freeze paying Business OS customers.** Retiring the purchase path makes this **stricter, not moot** — §4.6, TK-3. | Consequence of F-16 + B-8 |
| **F-18** | Storage and execution quotas are allocated and never checked. ✅ **Verified by SA** with the evidence BA could not gather: `QuotaAllocationService` exposes only `allocateQuotasForUser`, `getUserQuotaInfo` and `allocateQuotasForAllUsers` — **no check or enforce method at all** — and **nothing outside the class reads the allocated columns**. SA also located **six allocation calls in the billing path: webhook ×5, `sync-subscription` ×1**, which die with the retirement (§4.6). | **SA-verified** |
| **F-28** | 🔴 **A live B-8 leak, found by SA.** `app/api/business-os/usage/route.ts` — a **Business OS** surface — already reads `user_subscriptions`, the agent-platform subscription row. This is the boundary RD-2 draws, breached today, before any billing is built. **In scope for WS-3 / TK-6, not a future clean-up** (§13.3). | **SA-verified** |

### 2.4 Dead and near-duplicate code

| # | Finding | Verified by |
|---|---|---|
| **F-19** | `components/settings/PlanManagementTab.tsx` hardcodes a 'free' plan and fake usage. ✅ **ZERO importers — verified by SA** (§13.1): only its own definition exists, so it is dead and safe to delete. | **SA-verified** |
| **F-20** | There are **four** billing-ish React components, not two: `components/settings/BillingSettings.tsx` (live), `PlanManagementTab.tsx`, `components/v2/settings/BillingSettingsV2.tsx`, `BillingSettingsV2_NEW.tsx` — plus `app/v2/billing/page.tsx` **and** `page.tsx.bak`. | Glob |

### 2.5 Business OS side — already merged and live

| # | Finding | Verified by |
|---|---|---|
| **F-21** | **The plan concept is done and shipped.** `TIER_ORDER = ['basic','pro']`; `basic` = $79, no chat, 500 AI actions/mo; `pro` = $129, chat, 2,000/mo. `trial` and `champion` are **cohorts pointing at the `basic` row**, so they inherit `basic` rather than drifting from it. | `lib/business-os/entitlements/config/tierMatrix.ts:68, 87-232` |
| **F-22** | Prices in `presentation.monthlyPriceUsd` are **display-only**. The config itself says "Stripe becomes the source of truth in Slice 4; nothing here charges anyone." | `tierMatrix.ts:220` |
| **F-23** | **The metering seam is deliberately stubbed.** `ALWAYS_SUFFICIENT` answers `{ sufficient: true }` for every balance question, with a comment explaining it exists so Slice 3 needs no call-site migration. | `lib/business-os/entitlements/balance.ts:45-49` |
| **F-24** | Nothing is enforced: `BOS_ENTITLEMENTS_MODE` is unset in production. Admin ops, shadow recording, the plan row, the resolver, the launch dry run and the admin screen all exist. | `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:9, 139-149, 163-181` |
| **F-25** | Switch-on gates already recorded: **G-1** service-role key rotation, **G-2** CI checks made required, the **`chat.access` gate**, `findTenantsMissingPlanRow` needing an exhaustive anti-join, the launch operation, and the trim list. | `BUSINESS_OS_ENTITLEMENTS.md:151-161` |
| **F-26** | Because `trial` and `champion` both point at `basic`, and chat is the entire difference between the two paid plans, **only a paying `pro` customer ever sees the chat assistant.** The config anticipates the fix ("champions become `pro` in one line"). **Q-B3/Q-B4: the user decided to leave both as configured for now** and revisit during testing — one line in `config/cohorts.ts`. | `tierMatrix.ts:109-124`; `BUSINESS_OS_ENTITLEMENTS.md:47, 51` |
| **F-27** | **Charging a second currency is a parameter, not a rebuild — but only halfway.** `createCustomCreditSubscription` takes `currency`, defaults to `'usd'` (`:124`) and lowercases it for Stripe (`:145`). However `unit_amount` is `Math.round(amountUsd * 100)` (`:151`) — **the USD-derived amount is used verbatim whatever the currency**, so a shekel charge would bill ₪ at the dollar number. This is why OI-1 (§11) is a pricing problem, not a plumbing one. | `StripeService.ts:124, 138, 145, 151` |

---

## 3. The reuse ledger

Verdicts: **REUSE AS-IS** · **ADAPT** · **BUILD NEW** · **DO NOT REUSE**.

> ⚠️ **RD-16 / SA-4: "DO NOT REUSE" never means "delete"** unless §4.6's *Dies* list says so. Several rejected rows are live agent-platform code that must keep working — `payment_grace_period_days`, `account_frozen`, `checkExecutionAllowed`, the signup grant, and the whole of Connect.

### 3.1 Stripe plumbing — largely product-agnostic

| # | Piece | Verdict | Reason (business terms) | B-8 test |
|---|---|---|---|---|
| **L-1** | Stripe SDK init, secret key, pinned API version | REUSE AS-IS | One Stripe account, one SDK setup. Nothing product-specific. | Passes |
| **L-2** | `getOrCreateCustomer` — one Stripe customer per person | ADAPT | The idea is right. But it **also writes an agent-platform `user_subscriptions` row**, and SA confirmed the numbers are **hard-coded**: `monthly_amount_usd: 10.00, monthly_credits: 20833` (`:83-93`). A Business OS checkout calling this hands the buyer a phantom Pilot-Credit subscription. Per **Q-T8** the customer lookup/create stays shared and the seed write **moves out into the agent-platform caller**. | **Fails as-is** |
| **L-3** | Embedded checkout session creation | REUSE AS-IS | The checkout envelope is identical for any recurring product; only the line item differs. | Passes |
| **L-4** | `createPortalSession` | REUSE AS-IS | Self-serve card update, receipts and cancellation with no code to write. (The Q-B1 dual-product caveat is moot while the agent platform is parked.) | Passes |
| **L-5** | `listInvoices` | REUSE AS-IS | Stripe is the invoice record; we read it. | Passes |
| **L-6** | `cancelSubscription` / `reactivateSubscription` | REUSE AS-IS | "Keep what you paid for until period end" is confirmed policy (Q-B7). Both are WS-2 surface features (SA-3). | Passes |
| **L-7** | `session-status` and the manual `sync-subscription` fallback | ADAPT | A "payment went through but the app doesn't know" escape hatch has earned its keep once already. The reconciliation logic inside is credit-shaped and goes (it also holds one of the six quota calls, F-18). | Fails as-is |
| **L-8** | Hybrid proration **policy** | ADAPT | Inherited per **Q-B7 / RD-7**: upgrade charged and effective immediately, downgrade at next renewal, no refund. Its implementation mints a price (L-9). | Policy passes |
| **L-9** | Ad-hoc `stripe.prices.create()` per checkout and per upgrade | DO NOT REUSE → **DELETE** | The one design choice that blocks plans. See §4. | n/a |
| **L-10** | Fixed Stripe product + price per Business OS plan, addressed by **`lookup_key`** (Q-T1) | **BUILD NEW** | Without it, "who is on `pro`?" is unanswerable in Stripe and an upgrade is just a different dollar amount. The same lookup key exists in test and live mode, so there is no per-environment id table — and it is what makes RD-4's routing possible at all. | n/a |

### 3.2 The webhook envelope — the highest-value reuse

| # | Piece | Verdict | Reason (business terms) | B-8 test |
|---|---|---|---|---|
| **L-11** | Signature verification (dual secrets) | REUSE AS-IS | Security-critical and already correct. **SA calls L-11/L-12 the most valuable row in the ledger.** A second verifier is pure risk. | Passes |
| **L-12** | `processed_webhook_events` claim + **release-on-error** idempotency | REUSE AS-IS | Claimed before the handler runs, `23505` treated as a concurrent claim, released on error so a retry is not swallowed. ⚠️ **Keyed on `event_id` alone** — which is exactly why RD-4 mandates a single endpoint. | Passes |
| **L-13** | Event routing | ADAPT → **replaced by RD-4** | 🔴 **Worse than BA first wrote it (SA correction, §13.1).** The hazard is not only that a Business OS invoice would fall into `handleInvoicePaid`. When the invoice carries no metadata, that handler falls back to `stripe.subscriptions.list({ customer }).data[0]` (`webhook/route.ts:64-78`). With two subscription kinds per customer — **exactly what this plan creates** — it can read **another subscription's** `user_id` and `credits`. So the failure is not only "converted to credits", it is "converted using the wrong subscription's numbers". **RD-4 replaces the whole routing approach.** | **Fails badly as-is** |
| **L-14** | Renewal semantics: replace the period allowance, preserve one-off grants | ADAPT (pattern only) | Exactly B-6's rule, and it already exists in credit arithmetic (F-6). Copy the rule, not the code. | Pattern passes |
| **L-15** | Proration detection by reading invoice line-item **descriptions** | DO NOT REUSE → **DELETE** | 🔴 **Reason strengthened by SA.** It matches the English strings `'Unused time'` / `'Remaining time'` from Stripe's **generated** descriptions (`:98-101`). That is **not an API contract**: a Stripe wording change or a locale change breaks proration detection **silently**, mis-crediting every prorated invoice with no error anywhere. It is fragile **today**, not merely redundant once fixed prices exist. | n/a |
| **L-16** | Dunning shape: retry count → grace → `past_due` → pause | ADAPT | Shape right, consequence not. SA confirmed the shape: per-user `grace_period_days`, else config, else **3**; on exceed → `past_due` **and agents paused**. Business OS instead moves through its own lifecycle, **grace 5 days (Q-B6)**, with pay links, receipts and booking cancel/reschedule live throughout (B-11). | Shape passes |
| **L-17** | `payment_grace_period_days` in `system_settings_config` | **NOT A SOURCE OF TRUTH for Business OS — left in place for the agent platform** (SA-4) | Business OS grace lives in lifecycle config as *histories*, so shortening grace cannot retroactively change a deal already given, and two sources of truth for "how long is grace" is a support trap. **But the live agent-platform dunning path still reads this key** (F-7). It stays, untouched. Business OS simply never consults it. | Rejected for Business OS on single-source-of-truth grounds |
| **L-18** | `billing_events` table | ADAPT — **decided (Q-T3): add a product dimension** | One honest history per product, one table. A second table duplicates the write path and invites divergent shapes. | Fails if one undifferentiated history is shown |
| **L-19** | Webhook handler turning a paid Business OS invoice into a plan assignment on the entitlement plan row | **BUILD NEW** | The join between money and entitlements. Per **Q-T2** it calls the existing `assign_tier` path **as a server-side function, never an HTTP self-call**, inheriting Zod validation, the required-`expiresAt` rule, the allow-listed write and the audit entry. | n/a |

### 3.3 Credits, ledgers and quotas — agent-platform-specific

| # | Piece | Verdict | Reason (business terms) | B-8 test |
|---|---|---|---|---|
| **L-20** | `user_subscriptions` as the source of truth | DO NOT REUSE — **but the table survives untouched** | One row per user carrying a Pilot-Credit balance, a dollar amount and a frozen flag. Making it carry the Business OS plan too means one lapse, one freeze and one balance across two products. ⚠️ It is *also* the signup-grant, frozen-flag and Stripe-customer-id table, so retiring the **purchase path** is not retiring the **table** (§4.6). **And a Business OS route already reads it today (F-28).** | **Fails** |
| **L-21** | `credit_transactions` | DO NOT REUSE — **history survives** | A shared ledger means a Business OS payment visibly tops up an agent-platform balance. Purchase-derived rows stop being *written*; existing rows stay. | **Fails** |
| **L-22** | A Business OS AI-action ledger behind `balance.ts` | **BUILD NEW** | The customer-visible unit is a flat AI action (B-4), not a token. The seam is in place and waiting (F-23). | n/a |
| **L-23** | `CreditService` | DO NOT REUSE — **partly DELETE** | Pilot Credits, token balances, and a fail-open execution check (F-15). Its purchase/charge paths go with L-9; **`checkExecutionAllowed` and the signup grant survive** (§4.6). | **Fails** |
| **L-24** | `pricingConfig`, `ais_system_config`, `pilotCreditsToTokens` | DO NOT REUSE → **DELETE (purchase-side only)** | Converts dollars to tokens at an agent-platform rate. Business OS sells flat monthly plans. Non-billing readers, if any, are TK-2's job to find. | **Fails** |
| **L-25** | AIS intensity multipliers (`chargeTokensWithIntensity`) | DO NOT REUSE | Charges more for heavier work; B-4 chose a flat count so customers can understand their bill. | **Fails** |
| **L-26** | `QuotaAllocationService` | DO NOT REUSE — **its six billing-path calls DELETE** | Allocates quotas nobody checks: **no check or enforce method exists, and nothing outside the class reads the allocated columns** (F-18, SA-verified). The six calls in the billing path (**webhook ×5, `sync-subscription` ×1**) die with the purchase path; whether the service itself goes is TK-2. | Fails |
| **L-27** | `boost_packs` + admin API | ADAPT **later** | Business OS boosts are real (D-8) but the packs are denominated in Pilot Credits. Deferred to **S-4b** (RD-11). ⚠️ The *agent-platform boost checkout* is part of the credit purchase path — disposition is **TK-5**. | Fails as-is |
| **L-28** | `check-free-tier-expiration` cron | DO NOT REUSE — **and must be GUARDED** | Business OS trial expiry is the entitlements lifecycle, and per F-17 this cron is actively dangerous to Business OS customers. **It stays unscheduled, and must exclude Business OS payers before it is ever wired** (RD-9, TK-3). | **Fails** |

### 3.4 Platform patterns — reuse without hesitation

| # | Piece | Verdict | Reason | B-8 test |
|---|---|---|---|---|
| **L-29** | Server-write-only RLS lockdown pattern | REUSE AS-IS | Money tables must not be writable by a logged-in browser. Proven in production. | Passes |
| **L-30** | `requireAdmin` + the admin authz CI guard | REUSE AS-IS | Already used by every entitlements admin route; new billing admin routes inherit it free. | Passes |
| **L-31** | `AuditTrailService` | REUSE AS-IS | Already used by the Stripe routes and the entitlements admin ops. | Passes |
| **L-32** | The Business OS entitlements module | REUSE AS-IS | The target, not a candidate. Merged, applied to production, recording in shadow. Billing writes to it; it never imports billing. | Passes by construction |

### 3.5 User interface

| # | Piece | Verdict | Reason | B-8 test |
|---|---|---|---|---|
| **L-33** | `/settings` → Billing and `/v2/billing` (agent platform) | DO NOT REUSE → **DELETE or reduce to read-only history** | They speak Pilot Credits, tokens and a dollar slider — the wrong vocabulary for a plan product — and they are in the agent platform's design system, while Business OS needs its own tokens, language context, RTL and currency handling. With the purchase path gone they have nothing to sell. | Fails (vocabulary leak) |
| **L-34** | The Business OS plan, buy, manage and invoice surface | **BUILD NEW — a workstream (WS-2), not a section** | F-13: nothing exists. **SA-3**: plan display, buy, upgrade, downgrade, cancel, reactivate, invoice list and a card-update entry point, in a different design system with RTL and localisation. Size it separately "or it will be the thing that slips". §6.5. | n/a |
| **L-35** | `PlanManagementTab.tsx`, `BillingSettingsV2.tsx`, `BillingSettingsV2_NEW.tsx`, `app/v2/billing/page.tsx.bak` | DO NOT REUSE — **delete** | Four billing-ish surfaces, fake data in at least one, and zero importers on the first (SA-verified). They mislead anyone reading for prior art. | n/a |

### 3.6 Headline counts

| Verdict | Count | Rows |
|---|---|---|
| **REUSE AS-IS** | **11** | L-1, L-3, L-4, L-5, L-6, L-11, L-12, L-29, L-30, L-31, L-32 |
| **ADAPT** | **8** | L-2, L-7, L-8, L-13, L-14, L-16, L-18, L-27 |
| **BUILD NEW** | **4** | L-10, L-19, L-22, L-34 |
| **DO NOT REUSE** | **12** | L-9, L-15, L-17, L-20, L-21, L-23, L-24, L-25, L-26, L-28, L-33, L-35 |
| **Total** | **35** | |

19 of 35 (54%) are reusable in some form, and they are the expensive, security-sensitive, hard-to-get-right ones — webhook verification, idempotency, dunning, proration policy, portal, RLS lockdown. The 12 rejections are almost entirely *the credit system*, which is the one thing B-8 forbids sharing — and of those, only the ones §4.6 lists actually get deleted (RD-16). **Offir is right that a lot is built; the refinement is that what is built is the envelope, not the contents.**

---

## 4. The fixed-price question, and retiring the credit purchase path

### 4.1 The problem (unchanged)

Business OS sells two named plans at two fixed prices. The existing system mints a brand-new private Stripe price for every checkout and every upgrade (F-12), so Stripe holds no notion of `basic` or `pro` at all.

| Consequence | Impact |
|---|---|
| Stripe cannot answer "how many `pro` subscribers?" | Every revenue, churn and cohort question must be answered by hand-joining our database to Stripe. Stripe's own reporting is useless for plan mix. |
| An "upgrade" is just a bigger number | No way to distinguish a `basic`→`pro` upgrade from a price change. |
| The founder coupon (D-6) has nothing to attach to | Coupons are normally scoped to a product or price. |
| Annual (Q-B8, deferred) has nothing to be an alternative *to* | Monthly and annual are two prices on one product. |
| Price changes are invisible | Raising `basic` from $79 to $89 for new customers while existing ones keep $79 is standard with fixed prices, near-impossible to audit with ad-hoc ones. |
| **Nothing can route a webhook event by plan** | Added after SA review. With no stable price identity there is nothing trustworthy to route on, which is *why* the current file falls back to metadata and then to "first subscription found" (L-13). RD-4 depends on fixing this. |

### 4.2 How this section reached its answer

Re-derived twice, then confirmed. The record matters because each step narrowed the question.

1. **First pass** recommended "a separate Business OS catalog *alongside* the existing ad-hoc flow", justified by *zero risk to live paying agent-platform customers*.
2. **The parking of the agent platform removed that justification.** Re-deriving also exposed that "separate catalog" never meant a separate billing *system* — the plan already reused the same Stripe account, webhook endpoint, idempotency table, portal and dunning shape. So the question was never "separate or shared". It was: **do we retire the Pilot-Credit purchase path, and when?**
3. **The evidence (§1.3) answered "and when".** No real paying customers, and no requirement for the parked platform's billing to keep working, so retirement is a deletion rather than a customer migration — it belongs in the same work.
4. **SA confirmed and hardened this** (§13.3): splitting it would leave the credit conversion running alongside the new path for at least one release, and *that window is precisely when a Business OS invoice can be turned into Pilot Credits.* SA also notes it is **cheaper merged** — "the PR that adds price-id routing is the PR that deletes the branch which made routing necessary."

### 4.3 Options

| Option | What it means | Verdict |
|---|---|---|
| **A. Add fixed Business OS prices; leave the Pilot-Credit path live** | The credit slider keeps working and the L-13 hazard is mitigated by a third router branch. | **Rejected.** Its only advantage was protecting live paying subscriptions and a possibly-unparked platform; E-1 and E-2 removed both. |
| **B. Retire the Pilot-Credit purchase path as part of this work** | Fixed prices become the only model. | ✅ **ADOPTED** — §4.4, and SA-2 requires the merge into S-4a. |
| **C. Build A now, retire immediately after as its own change** | The previous recommendation. | **Superseded.** It existed to decouple a customer-facing money decision from the buy path; with no customers to decide about there is nothing to decouple, and SA ruled against the split. |
| **D. Keep minting ad-hoc prices for Business OS, tagging the plan in metadata** | $79/$129 prices created on the fly. | **Rejected under any evidence** — and doubly so now, since metadata is exactly what must not be trusted (RD-4). |

### 4.4 Adopted: option B

**Retire the Pilot-Credit purchase path inside S-4a, as workstream WS-3.** In business terms:

1. **It removes the B-8 hazard at its root.** An invoice cannot be mistaken for a credit purchase if no credit product exists — and the "first subscription found" fallback cannot mis-credit across two subscription kinds if there is only one kind.
2. **The blast radius is test data, not customers.** Four subscriptions, all testing accounts, last touched 2026-07-19, per the user (§1.3).
3. **Splitting it would open a hazard window** — SA's reason for requiring the merge (§4.2 point 4).
4. **It makes the codebase say what is true.** A parked product's purchase path left in place reads as a live second billing model to every future reader, and §9.1 shows what that costs.
5. **It resolves three housekeeping items for free**: H-4, H-5 and part of H-9.

**What it is not.** Not "delete billing", and not "drop `user_subscriptions`". §4.6 draws that line — getting it wrong produces a half-deleted system worse than either end state (RD-15, RD-16).

### 4.5 Two things that still need care

| Concern | Why it still needs care |
|---|---|
| **The four subscriptions may still be charging** (TK-1) | The E-1 query evidences *our database*, not Stripe. Those rows were last touched **2026-07-19** and nothing has looked at them since. "Testing accounts" describes intent, not Stripe mode — **if they are live-mode subscriptions they have been renewing monthly against a real card for two months unattended.** |
| **The same webhook file serves Connect** (Q-T5) | Business OS Connect payments — real money from real clients of real businesses — flow through `app/api/stripe/webhook/route.ts`. Deleting the platform-subscription concern must not disturb the connected-account path. The one part of the retirement deserving a careful review rather than a confident deletion. |

### 4.6 Retirement scope: dies / survives / guarded

**SA-2 (§13.3).** This is the difference between a clean retirement and a half-deleted system, and SA's framing is that *the risk here is deleting one item too many*. **TK-2 confirms the list against the code before anything is deleted.**

#### Dies

| Thing | Note |
|---|---|
| Ad-hoc price minting (`:149`, `:321`) — L-9 | The slider has nothing to sell |
| `updateSubscriptionAmount` (credit amount change) | Same |
| The credit conversion inside `handleInvoicePaid` — L-14, L-24 | Token math, `pilotCreditsToTokens`, `ais_system_config` read — **and the "first subscription found" fallback** (L-13, `:64-78`) |
| The L-15 description heuristic (`:98-101`) | Fragile against Stripe's generated English wording and locale; replaced by the price id |
| The credit-shaped checkout and dollar-slider UI: `create-checkout`'s `custom_credits` branch, `update-subscription`, `sync-subscription`'s credit reconciliation (L-7) | |
| **The six `QuotaAllocationService` allocation calls in the billing path — webhook ×5, `sync-subscription` ×1** (L-26) | SA's count; a retirement detail the ledger did not surface |
| The credit-purchase UI: `/v2/billing`, the `BillingSettings` buy flow (L-33), **and the four dead UI files** (L-35) | Nothing to sell |
| `credit_transactions` rows of type `subscription_renewal` / `subscription_upgrade` | No longer *written*; existing rows stay as history |
| The agent-platform **boost-pack checkout** | ⚠️ Not obvious — **decide explicitly (TK-5)**. A one-off *Pilot-Credit* purchase sharing `getOrCreateCustomer` and `handleCheckoutCompleted`. The `boost_packs` **table** survives. |

#### Survives untouched

| Thing | Why | Risk if handled carelessly |
|---|---|---|
| **`user_subscriptions` the table** | Holds `account_frozen`, `free_tier_expires_at`, the signup grant and the Stripe customer id | Dropping it breaks agent execution gating and loses the Stripe customer mapping |
| **The signup grant** | Independent of purchase | Deleting it silently removes new agent-platform accounts' ability to do anything |
| **`account_frozen`** — ⚠️ **read by `generate-agent` to block agent creation** (SA) | A live read path outside billing and outside `CreditService` | Removing or repurposing the flag breaks agent *generation*, not just billing |
| **`free_tier_expires_at`** | Read by `checkExecutionAllowed` and the cron | **The latent-freeze trap (TK-3)** — see *Guarded* |
| **The `credit_transactions` history** | Audit and support | |
| **The entire Connect half of the webhook** (`StripeService:413-776` + handlers) | Live, and unrelated to this work | §4.5, Q-T5 |
| `getOrCreateCustomer`'s lookup/create (L-2, split per Q-T8) | Business OS needs a Stripe customer per person | The shared function must have **no** agent-platform side effect |
| Webhook envelope: dual-secret verification, claim/release idempotency (L-11, L-12) | Product-agnostic, security-critical | |
| `billing_events`, `processed_webhook_events`, `boost_packs` table, money-table RLS lockdowns (L-29) | Audit, idempotency, data, security posture | |
| **`payment_grace_period_days`** (L-17, SA-4, RD-16) | The live agent-platform dunning path reads it (F-7) | "Not a Business OS source of truth" must not be executed as "delete the key" |

#### Must be replaced or guarded

| Thing | Guard |
|---|---|
| **`check-free-tier-expiration`** | **Stays unscheduled (RD-9), and before it is *ever* scheduled it must exclude Business OS payers** (F-17). ⚠️ The retirement makes this stricter: the purchase path was the only thing that ever *cleared* `free_tier_expires_at`, so afterwards every account carries a permanently-expired free tier. Harmless only while the cron is unscheduled; a mass freeze of **paying Business OS customers** the day anyone wires it. **TK-3** decides between replacing the field's semantics and making RD-9 permanent and discoverable. |
| **`app/api/business-os/usage/route.ts`** (F-28) | 🔴 **A live B-8 leak: a Business OS route already reads `user_subscriptions` today.** SA places it **inside this scope rather than being discovered later** — **TK-6**. Otherwise the boundary RD-2 draws is fiction on day one. |
| **`checkExecutionAllowed`** (F-15) | Survives with its fail-open intact. Business OS's T-3 policy must not copy it — confirmed clean per Q-T6. |

> **RD-15, the completeness test:** after S-4a, no code path may leave an account in a state that something else still reads and acts on. `free_tier_expires_at` is the failure mode to prove absent.

### 4.7 What stays true regardless

| | |
|---|---|
| Fixed Stripe products and prices for `basic` and `pro`, addressed by `lookup_key` | Required (L-10, Q-T1, RD-4) |
| One Stripe account, **one webhook endpoint**, one claim table | Required — RD-4. The endpoint count is a **correctness constraint**, not a preference |
| RD-2 (Business OS billing never writes Pilot-Credit tables) | Trivially true for *writes* once the purchase path is gone — but **F-28 shows the read side is already breached** and must be fixed |

---

## 5. Decisions

**RD-1 to RD-16 are approved by SA** (§13). RD-4 was rewritten by SA-1; RD-16 added by SA-4.

| # | Decision | Rests on |
|---|---|---|
| **RD-1** | **Business OS gets its own fixed Stripe product and price per plan**, addressed by `lookup_key`, built inside the existing Stripe service and webhook rather than beside them. | §4, F-12, Q-T1 |
| **RD-2** | **Business OS billing never writes to `user_subscriptions`, `credit_transactions`, or any Pilot-Credit balance** — and per **F-28** no Business OS surface may *read* them either. The B-8 boundary is drawn at the table, so it can be enforced by RLS and reviewed by grep. | B-8, L-20/21/23, **F-28** |
| **RD-3** | **One Stripe customer per person.** Per Q-T8, `getOrCreateCustomer` is **split**: the Stripe lookup/create stays shared, the `user_subscriptions` seed moves out into the agent-platform caller. The shared function has no agent-platform side effect. | L-2, Q-T8 |
| **RD-4** | **Route on the Stripe price id, before any handler runs — and on one endpoint only.** *(Rewritten by SA-1; this single decision settles what were Q-T4, Q-T11 and the old RD-4.)*<br>1. **Route on the price id**, resolved from configured **lookup keys**, read off the **invoice's line items**, **before any handler runs**. Not metadata: on a Connect event, subscription metadata is written by the **connected business**, and the webhook file already documents this as a cross-tenant hazard and gates two handlers on it. A fixed price id is an identity **we** control and a customer cannot forge, and Stripe reports it on the invoice line without a second API call.<br>2. **Deny by default.** An unrecognised platform price is logged and **not** converted to credits. *"Unknown means credits" is the shape of the present hazard; the fix must not preserve it.*<br>3. **`subscription.metadata.product` is a cross-check, never the discriminator.** If the price id says Business OS and the metadata disagrees, **refuse and alert** — that disagreement is a tamper signal, not a routing question.<br>4. **One endpoint, one claim table, branch inside on price id.** The claim is keyed on **`event_id` alone** and **Stripe delivers the same event id to every configured endpoint**, so a second endpoint's delivery would be discarded as a duplicate by whichever endpoint claimed first — **silently ignoring paid Business OS invoices, the worst failure this system can have.** If a second endpoint ever becomes unavoidable, the claim key must first become `(event_id, endpoint)`. | L-11, L-12, L-13, **SA-1 §13.2** |
| **RD-5** | **Billing moves ahead of enforcement switch-on.** Enforcement cannot be switched on until someone can buy a plan. SA signed off the order S-0 → (S-2 ∥ S-4a) → S-5 → S-3 → S-4b. | §6, §13.4 |
| **RD-6** | **The Business OS plan surface is its own workstream (WS-2)**, in Business OS's design system, language context, RTL and localisation. Per **Q-B5** it supports both self-serve purchase and admin (sales-assisted) assignment; per **SA-3** it covers plan display, buy, upgrade, downgrade, cancel, reactivate, invoice list and a card-update entry point. | F-13, L-34, Q-B5, **SA-3** |
| **RD-7** | Business OS **inherits the existing proration and refund policy**: upgrade charged and effective immediately; downgrade at next renewal; **no refunds**, access to end of paid period. | F-2, L-8, **Q-B7** |
| **RD-8** | A lapsed **paid** Business OS account follows the **entitlements lifecycle** with **5 days** of grace before public pages go dark (**Q-B6**). Business OS reads its grace from **lifecycle config only, as a history entry** (Q-T7) — ⚠️ **never `payment_grace_period_days`, which stays in place for the live agent-platform dunning path** (SA-4, RD-16). Pay links, receipts and booking cancel/reschedule links stay live throughout (B-11). | L-16, L-17, **Q-B6**, **Q-T7**, **SA-4** |
| **RD-9** | **`check-free-tier-expiration` stays unscheduled, and before it is ever scheduled it must exclude Business OS payers.** ⚠️ Retiring the purchase path makes this stricter: nothing will clear `free_tier_expires_at` afterwards (§4.6), so either the field's semantics are replaced or RD-9 becomes **permanent** and is recorded where a future reader of `vercel.json` will find it. | F-16, F-17, §4.6, TK-3 |
| **RD-10** | The three misleading billing documents are corrected or archived **in S-0**, not at the end. They are being read as input right now. | H-6 |
| **RD-11** | **Boosts, add-ons, auto top-up, annual plans (Q-B8) and Flex/pay-as-you-go are out of S-4a.** | D-8, D-9, D-10, Q-B8 |
| **RD-12** | **The Pilot-Credit purchase path is retired inside S-4a as workstream WS-3** — not as a follow-on change. SA's reason: splitting it leaves the credit conversion running alongside the new path for at least one release, and that window is precisely when a Business OS invoice can be turned into Pilot Credits. It is also cheaper merged. The deletion boundary inside the webhook gets its own review because that file serves live Connect payments (§4.5, Q-T5). | §1.3, §4.3-4.4, **SA-2 §13.3** |
| **RD-13** | **Business OS plans are priced in USD only for now** (**Q-B2**). Multi-currency is **OI-1** (§11). | Q-B2, F-27 |
| **RD-14** | **Plan names in code, docs and discussion are the internal ids** (`trial`, `champion`, `basic`, `pro`). Customer-facing names stay data in the `presentation` block. | User instruction; FR-12 |
| **RD-15** | **The retirement is only complete when no code path can leave an account in a state something else still reads and acts on.** §4.6's `free_tier_expires_at` case is the failure mode to prove absent. | §4.6, F-17 |
| **RD-16** | **"DO NOT REUSE" never means "delete"** unless §4.6's *Dies* list says so. Several rejected rows are live agent-platform code (`payment_grace_period_days`, `account_frozen`, `checkExecutionAllowed`, the signup grant, all of Connect) that must keep working. | **SA-4 §13.1** |

---

## 6. Revised slice plan

### 6.1 Why the order changes

The existing requirement (§16) orders the work **2 Enforcement → 3 Metering → 4 Billing**. Two facts make that unexecutable, and SA confirmed both premises:

1. **You cannot enforce a plan nobody can buy.** Switching enforcement on when the only route onto a paid plan is an admin operation turns every expiring trial into a support ticket.
2. **Metering is not a prerequisite.** `balance.ts` already answers "sufficient" for everything (F-23), built precisely so Slice 3 can land later without touching a call site.

So **Slice 4 splits and its first half moves ahead of switch-on**, and Slice 3 moves after it.

### 6.2 The slices

| Slice | What it delivers **to a user** | Content | Depends on | Size vs original |
|---|---|---|---|---|
| **S-0 Unblock** | Nothing visible. Removes what makes the rest unsafe. | **G-1 service-role key rotation + verification — ⚠️ not ours to schedule, see §6.4**; G-2 CI checks made required; `findTenantsMissingPlanRow` becomes an exhaustive anti-join; the no-profile champion trim list worked; RD-9 settled; RD-10 doc corrections; TK-2 inventory confirmed. | — | **New** (was implicit) |
| **S-2 Enforcement, built but off** | Nothing visible yet. | All §10.2 surfaces gated through the resolver; the **`chat.access` gate at the chat entry point, once per turn** (FR-46); grace/paused overlay incl. the transactional/marketing split and the B-11 paused split, with **5-day paid-lapse grace (Q-B6)** as a lifecycle config history entry; failure policy (T-3, confirmed clean per Q-T6); grandfathering. Flag stays `shadow`. | S-0 (may merge inert without G-1) | **Unchanged** — none of it is reusable from the agent platform |
| **S-4a Buy path + customer surface + retirement** | **A customer can buy `basic` or `pro`, see and manage their plan, upgrade, downgrade, cancel, reactivate, view invoices and update their card.** | **Three workstreams — §6.5.** WS-1 billing backend, WS-2 the customer-facing surface, WS-3 the retirement. Tasks **TK-1 to TK-6** (§6.6). | S-0 (may merge inert without G-1); RD-1, RD-4, RD-12 | **Re-sized by SA-3.** The backend shrank (11 REUSE AS-IS + 8 ADAPT rows), but WS-2 is a workstream in its own right and WS-3 is a deletion inside a live-money file. |
| **S-5 Switch-on** | **Accounts are held to their plan.** Trials expire; lapsed accounts degrade gracefully. | Execute `launch_champion_existing`; flip `BOS_ENTITLEMENTS_MODE` to `enforce`; monitor the shadow-vs-enforce delta. **Per Q-T10, verify the paid-lapse path here with one real test purchase taken through lapse → grace → paused** — it has no shadow equivalent. Q-B3/Q-B4 revisited here during testing if wanted. | S-2 **and** S-4a; **G-1 verified — hard gate** | **New as an explicit step** |
| **S-3 Metering** | **AI usage counts, warnings fire, hitting the cap degrades instead of stopping.** | The AI-action ledger behind `balance.ts` (L-22); the FR-30 call-site inventory; setup-AI measurement and trial sizing; template fallbacks; 80%/100% warnings; admin credit grants; no-rollover period reset; email fair-use alerting. **The first-pass credit numbers (250/500/1,000/2,000) are reset here from shadow data.** | S-5 | **Same content, later.** No call-site migration, by construction. |
| **S-4b Billing extras** | **Customers can top up, buy add-ons and pay annually.** | Boosts (L-27, and whatever TK-5 leaves); auto top-up with a customer cap; add-ons (seats, domain, SMS); **annual prices (Q-B8)**; renewal-driven end of grandfathering. ⚠️ **G-1 also gates all of S-4b** (§13.4). | S-3, S-4a, G-1 | **Deferred off the critical path** (RD-11) |

### 6.3 Dependency graph

```
S-0 Unblock ──┬──> S-2 Enforcement (built, flag off) ──┐
              └──> S-4a WS-1 + WS-2 + WS-3 ────────────┴──> S-5 Switch-on ──> S-3 Metering ──> S-4b Extras
                                                             ▲                                    ▲
                                                       G-1 key rotation (hard gate, external)─────┘
```

S-2 and S-4a are **independent** and can run in parallel. S-5 is a gate, not a build.

### 6.4 The G-1 dependency is not ours to schedule (SA-3)

S-0 contains the **service-role key rotation**, which depends on someone outside this work and *has been outstanding across this whole programme*. SA required this be written down so a slip does not stall the plan silently:

| If G-1 slips | Consequence |
|---|---|
| **S-2 and S-4a** | May be built, reviewed and **merged — both inert**. Neither needs the rotation to be correct. |
| **S-5 and all of S-4b** | **Cannot run.** G-1 gates both. No amount of finished code moves this. |
| **Therefore** | Progress does not stall, but *delivery to a customer* does. The honest status while G-1 is outstanding is **"built, not switched on"** — and it should be reported that way rather than as "done". |

### 6.5 S-4a workstreams and sizing (SA-3)

The original plan treated the customer-facing surface as one section of a billing slice. SA re-sized it: *"it is not 'a section'… budget it as its own workstream inside S-4a, sized separately, or it will be the thing that slips."*

| # | Workstream | Contents | Why it is its own workstream |
|---|---|---|---|
| **WS-1** | **Billing backend** | Fixed Stripe products/prices via `lookup_key` (L-10, Q-T1); the **price-id router with deny-by-default** (RD-4); the Business OS checkout route; the plan assignment calling `assign_tier` server-side (L-19, Q-T2); dunning mapped to the Business OS lifecycle with 5-day grace (L-16, RD-8); portal and invoice reads (L-4, L-5); product dimension on `billing_events` (Q-T3); founder coupon at champion conversion. USD only (RD-13). | Mostly reuse and adaptation, but RD-4 is a **correctness-critical** rewrite of how events are routed, and it must land before or with the first paid invoice. |
| **WS-2** | **The customer-facing surface** | **Plan display · buy · upgrade · downgrade · cancel · reactivate · invoice list · card-update entry point.** In Business OS's design system, with **RTL** and localisation. Self-serve **and** admin-assigned paths both reachable (Q-B5). | **Eight distinct user journeys in a design system that has never rendered any of them** (F-13). Not a settings section with a button; it is the entire commercial front door, and it cannot borrow the agent-platform components (L-33) because they speak the wrong vocabulary and the wrong direction of text. SA's named slip risk. |
| **WS-3** | **The retirement** | Everything in §4.6's *Dies* list, while preserving everything in *Survives untouched* and implementing the *Guarded* items — including **F-28's live B-8 leak (TK-6)**. | A **deletion inside a file that carries live client money** (§4.5, Q-T5). Deletions need different evidence from builds: before/after proof the Connect path is untouched, and TK-2's confirmed inventory first. |

### 6.6 Named tasks carried by S-4a

Recorded as tasks with their reasoning, because each is the kind of thing that becomes a footnote and then an incident.

| # | Task | WS | Reasoning |
|---|---|---|---|
| **TK-1** | **Check the four subscriptions in the Stripe dashboard for live vs test mode, and cancel them as part of this work if they are live.** Record the mode found either way. | WS-3 | The E-1 query evidences *our database*, not Stripe. Those rows were last touched **2026-07-19** and nothing has looked at them since. "Testing accounts" describes intent, not Stripe mode — **if live, they have been renewing monthly against a real card for two months unattended.** Deleting code does not cancel a Stripe subscription: Stripe keeps charging until told to stop, and with the handler gone those charges would land nowhere. |
| **TK-2** | **Confirm §4.6's dies / survives / guarded inventory against the code before deleting anything**, and record the confirmed list in the workplan. | WS-3 | §4.6 is SA's answer to E-3 plus what the audit traced. SA's own framing is that the risk is *deleting one item too many*. A deletion built on an unconfirmed inventory is how a half-deleted system happens (RD-15). |
| **TK-3** | **Decide and implement the disposition of `free_tier_expires_at` and `account_frozen`.** Either replace the field's semantics, or make RD-9 permanent and record it where a future reader of `vercel.json` will find it. | WS-3 | The latent-freeze trap (§4.6). The purchase path is the only thing that ever *cleared* the expiry; `checkExecutionAllowed` and the cron both read it; `account_frozen` is additionally **read by `generate-agent` to block agent creation**. Leave it and every account carries a permanently-expired free tier — harmless only while the cron is unscheduled, and a mass freeze of **paying Business OS customers** the day anyone wires it (F-17). RD-15's test case. |
| **TK-4** | **Convert `app/api/stripe/webhook/route.ts` to Pino structured logging** (CLAUDE.md mandatory rule 3), subject to the user's approval. | WS-1/WS-3 | The file is modified by S-4a and **survives**, because it serves live Connect payments. See §9.2. |
| **TK-5** | **Decide explicitly whether the agent-platform boost-pack checkout dies with the credit purchase path.** | WS-3 | A one-off *Pilot-Credit* purchase sharing `getOrCreateCustomer` and `handleCheckoutCompleted`, so it belongs to the purchase path — but easy to miss because it is a one-time payment, not a subscription. The `boost_packs` **table** survives regardless (L-27); S-4b may adapt it. |
| **TK-6** | **Stop `app/api/business-os/usage/route.ts` reading `user_subscriptions`** (F-28). | WS-3 | 🔴 SA found the B-8 boundary already breached: a **Business OS** route reads the agent-platform subscription row today. SA puts it inside this scope rather than leaving it to be discovered later — otherwise RD-2 is fiction from day one, and the leak outlives the system it belongs to. |

---

## 7. What changed versus the existing requirement

| # | Requirement says | This plan sets | Why |
|---|---|---|---|
| 1 | §16: slice order 1 → 2 → 3 → 4 | 1 → S-0 → {S-2 ∥ S-4a} → S-5 → S-3 → S-4b | You cannot enforce a plan nobody can buy (RD-5); SA signed the order off (§13.4) |
| 2 | §13: "Stripe product/price per tier … Slice 4" as one block | S-4a (three workstreams: buy path, customer surface, **retirement of the credit purchase path**) and S-4b (extras) | RD-11, RD-12, SA-2, SA-3 |
| 3 | §11: the signup grant, `monthly_ai_allowance_usd` and `check-free-tier-expiration` "must each be reconciled (T-9)" | Adds F-17 and §4.6: the cron is a **guarded** item, and the retirement makes it stricter rather than moot | It would freeze paying Business OS customers |
| 4 | §16 dependencies list the `sendEmailReminder` stub and `CRON_SECRET` | Adds: no fixed Stripe prices, no Business OS billing surface at all, and **G-1 as an external hard gate on S-5 and S-4b** | F-12, F-13, SA-3 |
| 5 | §13: "the entitlement engine must never import from billing" | Endorsed, strengthened by RD-2 — and **F-28 shows the read side is already breached**, fixed in WS-3 | B-8 |
| 6 | §5.3/§6.2 use Basic / Growth / Pro illustratively | Internal ids only in prose; customer-facing names are data (RD-14) | User instruction |
| 7 | Assumes the agent platform's billing coexists indefinitely | **Its purchase path is retired** (RD-12) | E-1, E-2 |

---

## 8. What "finished" means

The middle column is the honest state for the agent platform — which is what made the machinery look more complete than it is.

| # | Capability | Agent platform today | Business OS today | Delivered by |
|---|---|---|---|---|
| 1 | Sign up and start a trial | ✅ (signup grant — **survives**, §4.6) | ✅ plan row + `trial` cohort exist; ⬜ inert, nothing enforced | S-5 |
| 2 | See what plans exist and what each includes | ❌ **no named plans at all** (F-10) | ✅ configured (`basic`, `pro`); ⬜ invisible to customers | **WS-2** |
| 3 | **Buy a plan** | ✅ buy *an amount of credits* — **retired in WS-3** | ❌ nothing | **WS-1 + WS-2** |
| 4 | Be charged monthly, automatically | ✅ | ❌ | WS-1 (reuses F-1) |
| 5 | Allowance renews at the period boundary | ✅ (F-6) | ❌ nothing meters anything | S-3 (pattern from L-14) |
| 6 | See my current plan, next charge and usage | ✅ `/settings` → Billing | ❌ **no surface exists** (F-13) | **WS-2** (plan), **S-3** (usage) |
| 7 | See and download invoices | ✅ | ❌ | WS-2 (reuses L-5) |
| 8 | Upgrade, effective immediately | ✅ as a dollar amount, not a plan (F-2, F-12) | ❌ | WS-1 + WS-2 |
| 9 | Downgrade, effective next cycle, no refund | ✅ | ❌ | WS-1 + WS-2 (RD-7) |
| 10 | Cancel, keep what I paid for to period end | ✅ (F-3) | ❌ | WS-2 (L-6, Q-B7) |
| 11 | **Reactivate after cancelling** | ✅ (F-3) | ❌ | WS-2 (SA-3) |
| 12 | Update my card / manage myself | ✅ portal (F-4) | ❌ | WS-2 (L-4) |
| 13 | A failed payment is retried, with grace and warnings | ✅ (F-7) — though no email is sent (`TODO` at `webhook/route.ts:446`) | ❌ | WS-1 (adapts L-16, 5-day grace) |
| 14 | **Be actually held to my plan** | ⚠️ two rules only, and it **fails open** (F-15) | ❌ nothing enforced (F-24) | **S-2 + S-5** |
| 15 | Hitting the AI cap degrades rather than stops | ❌ | ❌ | S-3 |
| 16 | Lapse gracefully: booking page and invoice links keep working for my clients through **5 days** of grace, then pause with dignity | ❌ (agents just pause) | ❌ specified (B-9, B-11), not built | S-2 + S-5 (RD-8), verified in S-5 per Q-T10 |
| 17 | An admin can comp, extend, grant or investigate any of this | ⚠️ partial | ✅ **already done** — full admin ops + a screen (F-24) | done |

**The one sentence:** of the seventeen, Business OS has one (#17) and part of another (#1); the agent platform has twelve **for a product with no plans** — and after WS-3 it will have fewer, deliberately. The gap is **buy**, **see and manage**, and **be held to it**.

---

## 9. Housekeeping: fold in or spin out

| # | Item | Fold in / spin out | Reason |
|---|---|---|---|
| **H-1** | `check-free-tier-expiration` unscheduled (F-16) and dangerous to Business OS if scheduled (F-17) | **Fold in** to S-0 (RD-9) and **WS-3 (TK-3)** | A Business OS blocker; the retirement makes it stricter |
| **H-2** | `checkExecutionAllowed` fails open (F-15) | **Spin out** — but it **survives** the retirement (§4.6), so the leak survives with it. With the platform parked it drops in priority. **Fold in the lesson**: Business OS's T-3 policy must not copy it (confirmed clean, Q-T6). | Off the Business OS critical path |
| **H-3** | Quotas allocated and never checked (F-18) | **Partly absorbed** into WS-3 — the six billing-path allocation calls (webhook ×5, `sync-subscription` ×1) die. Whether `QuotaAllocationService` itself goes is TK-2. | SA confirmed no check method exists and nothing outside reads the columns |
| **H-4** | Dead billing components and the `.bak` page (F-19, F-20, L-35) | **Absorbed into WS-3** | They go with the purchase-path deletion; zero importers confirmed |
| **H-5** | `/settings` → Billing and `/v2/billing` near-duplicates | **Absorbed into WS-3** | With the purchase path retired they have nothing to sell (L-33): delete or reduce to read-only history. No longer a standing decision. |
| **H-6** | Stale docs that actively mislead | **Fold in** to S-0 (RD-10) | §9.1 |
| **H-7** | The orphaned `plans` table (F-11, zero callers SA-confirmed) | **Fold in** to S-0 as a one-line decision: Business OS is not built on it | Stops a future reader "discovering" it |
| **H-8** | `create-checkout` validates by hand, not with Zod (mandatory rule 2) | **Fold in** to WS-1 | The new route must be compliant; the old `custom_credits` branch is deleted anyway, so there is nothing left to retrofit |
| **H-9** | **`console.*` logging (mandatory rule 3) — RESOLVED** | Split: one **superseded**, one **still owed (TK-4)** | §9.2 |
| **H-10** | **F-28: a Business OS route reads `user_subscriptions`** | **In scope — WS-3 / TK-6.** Not housekeeping and not deferrable. | SA-2: a live B-8 leak, not a tidy-up |

### 9.1 The misleading documents

| Document | Problem | Proposed action |
|---|---|---|
| `docs/BILLING_SYSTEM_COMPLETE_STATUS.md` | **Stale-pessimistic and the most dangerous of the three.** States there is no Stripe integration, no recurring billing and no dunning. All three are false (F-1, F-7). Anyone planning from it would rebuild what works. | Archive, or replace its body with a pointer to this document |
| `docs/PRICING_SYSTEM_IMPLEMENTATION_PLAN.md` | Aspirational, never built (Explorer/Navigator/Commander, credit multipliers, a Settings-page plan UI). Already "superseded for Business OS" per the requirement §1. | Banner: never built; superseded for Business OS |
| `docs/STRIPE_BILLING_DATABASE_STATUS.md` (Jan 2025) | Aspirational for the plan layer; describes a `plans` table whose migration is not in the repo and which has **zero callers** (F-11). | Banner distinguishing what shipped from what did not |

### 9.2 H-9 resolved: where the logging debt stands

Rule 3 says a touched file must not be left logging via `console.*`. Adopting option B splits the obligation cleanly, and both halves are recorded rather than dropped:

| File | Status | Why |
|---|---|---|
| `lib/services/CreditService.ts` (`console.*` at `:358, 377, 405, 454` and elsewhere) | **SUPERSEDED for the deleted parts.** | Its purchase and charge paths are deleted in WS-3 (§4.6), so converting them would be work on code about to be removed. ⚠️ **But `checkExecutionAllowed` and the signup grant survive** — whatever remains of this file after the retirement is still subject to rule 3, and converting that remainder is part of S-4a's definition of done, not a spin-out. |
| `app/api/stripe/webhook/route.ts` (`console.*` at `:45, 312, 400, 2410, 2545` and throughout) | **STILL OWED — TK-4.** | Modified by S-4a and **survives**, because it serves live Connect payments (§4.5, Q-T5). The one place the conversion is genuinely owed. |

**BA flags; the user decides** whether the conversion happens in S-4a or is explicitly declined. Recorded either way so it is not quietly dropped.

---

## 10. Decisions and open questions

### 10.1 Business — DECIDED by user, 2026-09-25

| # | Question | Decision | Where applied |
|---|---|---|---|
| **Q-B1** | One invoice or two for a dual-product customer | **NOT RELEVANT** — the agent platform is being parked | §4.2, L-4 |
| **Q-B2** | Currency | **USD only for now** | RD-13, **OI-1** (§11) |
| **Q-B3** | `champion` loses chat at switch-on | **Leave as is; revisit during testing.** One-line cohort change | F-26, S-5 |
| **Q-B4** | `trial` cannot demonstrate chat | **No — keep chat out of `trial` for now** | F-26, S-5 |
| **Q-B5** | Self-serve or sales-assisted | **Both** — re-sized by SA-3 into **WS-2** | RD-6, L-34, §6.5 |
| **Q-B6** | Grace before public pages go dark | **5 days**, pay links/receipts/booking changes live throughout | RD-8, L-16, S-2, §8 row 16 |
| **Q-B7** | Refund on mid-month cancel | **No refunds**; access to end of paid period | RD-7, L-6, L-8 |
| **Q-B8** | Annual plans | **Later** | RD-11, S-4b |
| **Q-B9** | "Billed separately" wording | **NOT RELEVANT** while the agent platform is parked | — |
| **E-1** | Live paying subscriptions | **4 active rows, all non-zero, last change 2026-07-19. User's statement: not live in production, no real paying customers, all four are testing accounts.** | §1.3, §4.4, **TK-1** |
| **E-2** | Must the parked platform's billing keep working? | **No** — *the user's statement*, not an inference | §1.3, RD-12 |
| **Q-B10** | Who owns the retirement, and by when? | **Moot as a separate decision** — retirement is WS-3 inside S-4a, so it has S-4a's owner and date. **The action survives as TK-1.** | TK-1, §6.5 |

### 10.2 Technical — ALL DECIDED by SA (§13.2, §13.3, §13.5)

| # | Question | SA's decision |
|---|---|---|
| **E-3** | What else depends on `user_subscriptions` outside billing? | **§13.3** — reflected in §4.6, incl. `account_frozen` read by `generate-agent`, and the F-28 leak. **TK-2** confirms against the code before deletion. |
| **Q-T1** | Price reference: configured id or `lookup_key`? | **`lookup_key`.** The same key exists in test and live mode, so no per-environment id table and no env-specific config. Resolve to a price id at runtime and cache it. |
| **Q-T2** | Where the money→entitlement join is written | **The webhook calls the existing `assign_tier` path as a server-side function — never an HTTP self-call.** It inherits Zod validation, the required-`expiresAt` rule, the allow-listed write and the audit entry. *"Fewer moving parts is the wrong optimisation when the alternative gives up an audit trail on a money event."* |
| **Q-T3** | `billing_events` shape | **Add a product dimension.** One honest history per product, one table. |
| **Q-T4** | Router discrimination | **§13.2 → RD-4.** Price id from lookup keys, off the invoice line items, before any handler; deny by default; metadata a cross-check only, disagreement is a tamper signal. |
| **Q-T5** | Account / endpoint topology | **Shared Stripe account and one endpoint.** `event.account` already separates Connect correctly and is proven in production. |
| **Q-T6** | Does T-3 inherit the fail-open? | **Confirmed clean, no inheritance risk.** `decide.ts` implements the audience-based policy and does not import `CreditService`. |
| **Q-T7** | Grace source of truth | **Lifecycle config only, as a history entry.** |
| **Q-T8** | Sharing the Stripe customer | **Split `getOrCreateCustomer`** — the lookup/create stays shared; the `user_subscriptions` seed moves out into the agent-platform caller. |
| **Q-T9** | Who owns "which plan" | **Stripe owns *what was bought*; the plan row owns *what is in force*.** Support reads the plan row; the admin inspect route shows both. On disagreement the plan row governs access and a reconciliation alert fires — an access decision must never wait on an external API. |
| **Q-T10** | Can S-2 merge dormant? | **Yes.** The shadow report is sufficient for the capability mapping but **not** for the paid-lapse path, which has no shadow equivalent — verify that in S-5 with one real test purchase through lapse → grace → paused. |
| **Q-T11** | Idempotency across a second endpoint | **§13.2 → RD-4: one endpoint.** The claim key forbids a second. |

### 10.3 Still open — business items going back to the user

| # | Item | Note |
|---|---|---|
| **TK-1 outcome** | Are the four subscriptions Stripe **live-mode**, and are they to be cancelled? | The only item with a live-money clock on it. |
| **TK-3 choice** | Replace `free_tier_expires_at` semantics, or make RD-9 permanent? | A product call about a parked product. |
| **TK-4 approval** | Convert the webhook route to Pino now, or explicitly decline? | CLAUDE.md rule 3 (§9.2). |
| **TK-5 choice** | Does the agent-platform boost checkout die with the purchase path? | Cheap either way; needs a decision, not a guess. |
| **OI-1** | Multi-currency, incl. Israeli VAT and invoicing (§11) | Deferred, not forgotten. Must also reach the central backlog. |

---

## 11. Deferred open issues

Issues deliberately not solved now, recorded so they are found when they become relevant. **Each must also be added to the team's central backlog** — this document is a plan, not a tracker, and an issue recorded only here will be missed.

### OI-1 — Multi-currency pricing for Business OS plans

**Status:** deferred (Q-B2: USD only for now). **Read this before planning an Israeli launch or any non-USD market.**

| Sub-point | Detail |
|---|---|
| **1. The plumbing is half-ready** | `StripeService` already accepts a `currency` parameter and defaults to `'usd'` (`:124`), lowercasing it for Stripe (`:145`). So *charging* in another currency is a parameter, not a rebuild. |
| **2. But the amount is used as-is** | `unit_amount` is `Math.round(amountUsd * 100)` (`:151`) — the USD-derived number is billed verbatim in whatever currency is passed. **₪129 ≠ $129.** A real shekel price must be *set per plan*, not converted: there is no FX rate anywhere in the platform, and the platform rule is that money is never summed across currencies. So this is a **pricing decision per plan per currency**, needing its own Stripe price on the same product — and its own `lookup_key`, which RD-4's router will route on. |
| **3. Israeli VAT and invoicing are unresolved** | Selling to Israeli businesses in ILS raises VAT registration, VAT-inclusive vs VAT-exclusive display, tax-compliant invoice numbering and Hebrew invoice content. None of it is modelled today. Stripe Tax may cover part; the invoicing format may not. **This is the largest of the three sub-points and is not an engineering question.** |

**Also note:** Business OS already has per-service currency handling for *the business's own clients* (`scheduling_services.currency`). That is a different axis — what a business charges *its* customers — and must not be confused with what we charge the business. Getting these two crossed is a live hazard the moment a second currency appears.

---

## 12. Integration points

| System | Effect |
|---|---|
| `lib/stripe/StripeService.ts` | Gains Business OS subscription methods against fixed prices addressed by `lookup_key`; **loses** `createCustomCreditSubscription` and `updateSubscriptionAmount` (§4.6). `getOrCreateCustomer` **split** per Q-T8. **The Connect methods (`:413-776`) are untouched.** |
| `app/api/stripe/webhook/route.ts` | Gains the **price-id router with deny-by-default, ahead of every handler** (RD-4) and the Business OS plan assignment via `assign_tier` server-side (L-19, Q-T2); **loses** the credit conversion, the `subscriptions.list(...).data[0]` fallback (`:64-78`), the description heuristic (`:98-101`) and five of the six quota calls. ⚠️ **Also serves live Connect payments** — deletion boundary needs before/after evidence (Q-T5). Logging conversion owed (TK-4). **One endpoint; no second webhook** (RD-4). |
| `app/api/stripe/**` | A new Business-OS-scoped checkout route; `update-subscription` and the `custom_credits` branch of `create-checkout` retired; `sync-subscription` reduced or retired (L-7, and it holds the sixth quota call). |
| `lib/services/CreditService.ts` | Purchase and charge paths deleted; **`checkExecutionAllowed` and the signup grant survive** (§4.6, H-2). The remainder is still subject to rule 3 (§9.2). |
| `app/api/business-os/usage/route.ts` | 🔴 **Must stop reading `user_subscriptions`** (F-28, TK-6). |
| `generate-agent` | **Reads `account_frozen`** to block agent creation — a survive-path outside billing. Must keep working (§4.6). |
| `lib/business-os/entitlements/**` | Receives plan assignments from billing. **Must never import billing.** `balance.ts` gets its real implementation in S-3. |
| `lib/business-os/entitlements/config/tierMatrix.ts` | `presentation.monthlyPriceUsd` stays display-only alongside a real Stripe price (F-22). **Customer-facing names live here and nowhere else** (RD-14). |
| `lib/business-os/entitlements/config/cohorts.ts` | Q-B3 / Q-B4 are one-line changes here if revisited during testing (S-5). |
| `lib/business-os/entitlements/config/lifecycle.ts` | Holds the **5-day** paid-lapse grace (RD-8, Q-B6, Q-T7) as a history entry, never a constant. |
| `app/api/admin/business-os/entitlements/**` | `assign_tier` becomes the write path for paid plans too (Q-T2). Existing admin ops are the comp/override and **sales-assisted assignment** path (Q-B5). |
| `app/business-os/settings/**` | Gains **WS-2**: plan display, buy, upgrade, downgrade, cancel, reactivate, invoices, card update — in Business OS's design system with RTL (SA-3). |
| `app/v2/billing/**`, `components/settings/BillingSettings.tsx`, `components/v2/settings/BillingSettings*`, `PlanManagementTab.tsx` | Retired or reduced to read-only history (L-33); the dead four deleted (L-35, H-4, H-5). |
| `system_settings_config` → `payment_grace_period_days` | ⚠️ **Left in place.** The live agent-platform dunning path reads it (F-7, SA-4, RD-16). Business OS never consults it. |
| `vercel.json` | RD-9: `check-free-tier-expiration` stays unscheduled and must exclude Business OS payers before it is ever wired. **TK-3 may make that permanent**, recorded where a future reader will find it. |
| Stripe dashboard (not code) | **TK-1**: the four subscriptions checked for live vs test mode, cancelled if live. |
| Tables **read/written** by Business OS billing | The Business OS plan row and its audit tables; `processed_webhook_events`; `billing_events` with a product dimension (Q-T3). |
| Tables Business OS billing **must never write** | `user_subscriptions`, `credit_transactions`, `boost_packs` (until S-4b), any Pilot-Credit balance (RD-2). |
| Docs to correct | `BILLING_SYSTEM_COMPLETE_STATUS.md`, `PRICING_SYSTEM_IMPLEMENTATION_PLAN.md`, `STRIPE_BILLING_DATABASE_STATUS.md` (H-6). |

---

## 13. SA Review

**Reviewed by SA — 2026-09-25**
**Status:** ✅ **APPROVED AS THE PLAN OF RECORD**, with four required changes (**SA-1 to SA-4**). The audit is sound, the ledger is right, and the re-ordering is correct. Every expensive claim I spot-checked held, two were understated, and I found one hazard the document raises as a question but does not resolve — it changes a structural decision, so it is SA-1.

### 13.1 Ledger spot-checks — what I verified myself

| Row | Claim | SA verification |
|---|---|---|
| **L-2** | `getOrCreateCustomer` seeds a Pilot-Credit row | ✅ Confirmed, and the numbers are **hard-coded**: `monthly_amount_usd: 10.00, monthly_credits: 20833`. A Business OS checkout calling this hands the buyer a phantom subscription. |
| **L-11 / L-12** | Signature verification + claim/release idempotency | ✅ Confirmed: dual secrets (`STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`), the claim is written **before** the handler runs, `23505` is handled as a concurrent claim, and the catch releases so a retry is not silently swallowed. **This is the most valuable row in the ledger** and REUSE AS-IS is right. |
| **L-13** | A Business OS invoice would become Pilot Credits | ✅ Confirmed, and **worse than stated**. When the invoice carries no metadata, `handleInvoicePaid` falls back to `stripe.subscriptions.list({ customer }).data[0]`. With two subscription kinds per customer — exactly what this plan creates — it can read **another subscription's** `user_id` and `credits`. So the failure is not only "converted to credits", it is "converted using the wrong subscription's numbers". |
| **L-14** | Renewal replaces the allowance | ✅ Confirmed at two sites, commented `SUBSCRIPTION CREDITS DO NOT ROLL OVER - replace with new allocation`. B-6's rule already exists in credit arithmetic; ADAPT-pattern-only is right. |
| **L-15** | Proration detected from line-item descriptions | ✅ Confirmed — and I would **strengthen the reason**. It matches the English strings `'Unused time'` / `'Remaining time'` from Stripe's *generated* descriptions. That is not an API contract; a Stripe wording or locale change breaks it silently. It is fragile **today**, not merely redundant once fixed prices exist. |
| **L-16** | Dunning shape | ✅ Confirmed: per-user `grace_period_days`, else `payment_grace_period_days`, else **3**; on exceed → `past_due` **and agents are paused**. Shape reusable, consequence not — ADAPT is right. |
| **L-26** | Quotas nobody checks | ✅ Confirmed with the evidence BA could not gather: `QuotaAllocationService` exposes only `allocateQuotasForUser`, `getUserQuotaInfo` and `allocateQuotasForAllUsers` — **no check or enforce method** — and **nothing outside the class reads the allocated columns**. "Allocates quotas nobody checks" is literally true. |
| **L-9** | Ad-hoc prices at `:149` and `:321` | ✅ Confirmed, and there is **no `lookup_key` anywhere in the file**. |

**BA's three unverified claims:** `.from('plans')` has **zero callers** (the table is genuinely orphaned) ✅; `PlanManagementTab` has **zero importers** — only its own definition — so it is dead and safe to delete ✅; the quota claim is ✅ as above.

**Nothing marked REUSE that I would reject.** One correction to a rejection: **L-17** is right that `payment_grace_period_days` must not be a source of truth for Business OS grace, but it is still read by the live agent-platform dunning path. "DO NOT REUSE" must not be read as "delete" — phrase it as *not a source of truth for Business OS; left in place for the agent platform*. **SA-4.**

### 13.2 SA-1 (required) — the webhook split, and one endpoint only

**Ruling on Q-T4: route on the Stripe price id, resolved from configured lookup keys, read off the invoice's line items, before any handler runs.** Not metadata, and not a second endpoint.

| Why not metadata | Why price id |
|---|---|
| On a Connect event, subscription metadata is written by the **connected business**. The webhook file already documents this as a cross-tenant hazard and gates two handlers on it for that reason. | A fixed price id (L-10) is an identity **we** control and a customer cannot forge. |
| The `subscriptions.list(...).data[0]` fallback proves metadata lookup is already unreliable the moment a customer has two subscriptions — the state this plan creates. | Stripe reports it on the invoice line without a second API call. |

Two conditions on that routing:

1. **Deny by default.** An unrecognised platform price must be logged and **not** converted to credits. "Unknown means credits" is the shape of the present hazard; the fix must not preserve it.
2. **`subscription.metadata.product = 'business_os'` is a cross-check, never the discriminator.** If the price id says Business OS and the metadata disagrees, refuse and alert — that disagreement is a tamper signal, not a routing question.

**And the finding the document does not resolve — this is why SA-1 is required rather than a preference.** Q-T11 asks how idempotency survives a second endpoint (RD-4). The answer is that it does not: the claim is keyed on **`event_id` alone**, and **Stripe delivers the same event id to every configured endpoint**. A second endpoint's delivery would therefore be discarded as a duplicate by whichever endpoint claimed first — silently ignoring paid Business OS invoices, which is the worst failure this system can have. So:

> **One endpoint, one claim table, branch inside on price id.** If a second endpoint ever becomes unavoidable, the claim key must first become `(event_id, endpoint)`. This settles Q-T4, Q-T11 and RD-4 together.

### 13.3 SA-2 (required) — the retirement scope, stated as three lists

The document is right that retiring the purchase path is not retiring the table, but it leaves the boundary as prose. It needs to be explicit, because the risk here is deleting one item too many:

| | |
|---|---|
| **Dies** | Ad-hoc price minting (`:149`, `:321`); the credit conversion inside `handleInvoicePaid`; the credit-shaped checkout and dollar-slider UI; the L-15 description heuristic; the four dead UI files (L-35); and **the six `QuotaAllocationService` allocation calls that live in the billing path** (webhook ×5, `sync-subscription` ×1) — a retirement detail the ledger does not surface. |
| **Survives untouched** | `user_subscriptions` **the table**; the signup grant; `account_frozen` (read by `generate-agent` to block agent creation); `free_tier_expires_at`; the `credit_transactions` history; and the entire Connect half of the webhook, which is live and unrelated. |
| **Must be replaced or guarded** | `check-free-tier-expiration` stays unscheduled (RD-9) and, before it is *ever* scheduled, must exclude Business OS payers. And **`app/api/business-os/usage/route.ts` already reads `user_subscriptions` today** — a live B-8 leak that belongs inside this scope rather than being discovered later. |

**Does retirement belong in the same slice? Yes — merge S-4a′ into S-4a.** With E-1 = 0 real payers and E-2 = no, splitting it would leave the credit conversion running alongside the new path for at least one release, and that window is precisely when a Business OS invoice can be turned into Pilot Credits. It is also *cheaper* merged: the PR that adds price-id routing is the PR that deletes the branch which made routing necessary.

### 13.4 SA-3 (required) — two sizing corrections to the slice plan

**The order is right and I sign it off:** S-0 → (S-2 ∥ S-4a) → S-5 → S-3 → S-4b. The dependencies are real, and the two premises behind the re-ordering are both correct — you cannot enforce a plan nobody can buy, and `balance.ts` genuinely removes metering from the critical path.

1. **The customer surface is under-budgeted, and BA is right to flag it.** I would go further: it is not "a section". It is plan display, buy, upgrade, downgrade, cancel, reactivate, invoice list and a card-update entry point — in a different design system from the agent-platform billing UI, with RTL and localisation. Budget it as **its own workstream inside S-4a**, sized separately, or it will be the thing that slips.
2. **S-0 contains a dependency that is not ours to schedule.** G-1 (key rotation) is the gate on S-5 and on all of S-4b, and it has been outstanding across this whole programme. Say so in the plan: if G-1 slips, **S-2 and S-4a can still be built and merged** (both inert), but **S-5 cannot run**. Without that written down the plan stalls silently at the last step.

### 13.5 Q-T1 to Q-T11 — decided

| # | Decision |
|---|---|
| **Q-T1** | **`lookup_key`.** The same key exists in test and live mode, so no per-environment id table and no env-specific config. Resolve to a price id at runtime and cache it. |
| **Q-T2** | **The webhook calls the existing `assign_tier` path**, as a server-side function — never an HTTP self-call. It inherits Zod validation, the required-`expiresAt` rule, the allow-listed write and the audit entry. Fewer moving parts is the wrong optimisation when the alternative gives up an audit trail on a money event. |
| **Q-T3** | **Add a product dimension to `billing_events`.** One honest history per product, one table. A second table duplicates the write path and invites divergent shapes. |
| **Q-T4** | §13.2. |
| **Q-T5** | **Shared Stripe account and one endpoint.** `event.account` already separates Connect correctly and is proven in production; adding a second axis of separation adds risk without removing any. |
| **Q-T6** | **Confirmed, no inheritance risk.** `decide.ts` implements the audience-based policy (client-facing fail open, owner-paid `entitlement_unavailable`, marketing defer) and does not import `CreditService`. Reviewed in §13.6 and unchanged since. |
| **Q-T7** | **Lifecycle config only**, as a history entry. Two sources of truth for "how long is grace" is a support trap, and histories are what stop a shortened grace changing a deal already given. |
| **Q-T8** | **Split `getOrCreateCustomer`.** The Stripe customer lookup/create is genuinely shared and stays; the `user_subscriptions` seed **moves out into the agent-platform caller**. The shared function must have no agent-platform side effect. |
| **Q-T9** | **Stripe owns *what was bought*; the plan row owns *what is in force*.** Support reads the plan row, and the admin inspect route shows both side by side. On disagreement the plan row governs access and a reconciliation alert fires — because an access decision must never wait on an external API. |
| **Q-T10** | **Yes, S-2 can merge dormant.** The shadow report is sufficient evidence for the capability mapping, but **not** for the paid-lapse path, which has no shadow equivalent. Verify that in S-5 with one real test purchase taken through lapse → grace → paused. |
| **Q-T11** | §13.2 — one endpoint; the claim key forbids a second. |
| **E-3** | Answered in §13.3. |

### 13.6 For the user

1. **Your colleague was right, and the plan now says what he was right about.** A real, working, recurring billing system exists — the hard, security-sensitive parts (verifying that a payment message genuinely came from Stripe, never double-processing one, retries and grace when a card fails, the upgrade/refund policy, the customer portal) are built and proven. What is missing is that it sells *a dollar amount of credits*, not *a named plan*, so Stripe cannot answer "who is on Autopilot?". That is the gap, and it is a much smaller gap than "build billing".
2. **One thing in the plan needed a firm technical decision and now has one.** Today, if a Business OS plan payment arrived, the system would turn it into agent-platform credits. The fix is to identify each payment by the plan it was for, refuse to guess when it cannot tell, and keep everything on a single Stripe connection — a second connection would cause paid invoices to be silently ignored, which I checked and confirmed.
3. **Retiring the old credit-purchase checkout should happen in the same piece of work as the new buy page**, precisely because there are no real paying customers. Doing it separately leaves a window where a Business OS payment could still be converted into credits.
4. **Two expectations to set.** The customer-facing plan and invoice screens are a bigger job than they look — there is nothing there today, and Business OS needs its own language, layout and right-to-left support. And the last step, switching enforcement on, still cannot happen until the database key is rotated; everything before it can be built and merged while that waits.
5. **Nothing here changes your plan decisions** — the four plans, their contents, no refunds, the 5-day grace and USD-only all stand as decided.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-24 | Created | Re-strategisation of Business OS tier support after an evidence-based billing audit. Findings F-1 to F-26 re-verified against the code; 35-row reuse ledger; fixed-price recommendation; revised six-slice plan moving billing ahead of enforcement switch-on. |
| 2026-09-25 | User decisions Q-B1 to Q-B9 recorded; §4 re-examined | **Q-B1/Q-B9 not relevant (the agent platform is being parked); Q-B2 USD only; Q-B3/Q-B4 leave chat as configured for now; Q-B5 both self-serve and sales-assisted, with a plans + buy/upgrade settings section as a named deliverable; Q-B6 5-day grace; Q-B7 no refunds; Q-B8 annual later.** Terminology switched to internal plan ids throughout (RD-14). **§4 rewritten**: the parking removed the original justification, so the options were re-derived — the real question is not "separate or shared system" (it was always shared) but "do we retire the Pilot-Credit purchase path, and when". Four options, then recommending **C** (buy path additively, then retire as its own change), gated on new evidence E-1/E-2 and SA confirmation E-3. Added F-27 (currency is a parameter but the amount is not converted), S-4a′ (conditional retirement slice), RD-12 to RD-14, §11 OI-1 (multi-currency, three sub-points incl. Israeli VAT), and Q-B10. |
| 2026-09-25 | SA review: APPROVED as the plan of record, with SA-1 to SA-4 (SA) | Added §13. Spot-checked the expensive ledger rows in the code: L-2 (hard-coded `monthly_amount_usd: 10.00, monthly_credits: 20833`), L-11/L-12 (dual-secret verification, claim-before-handle, 23505 race, release-on-error), L-13, L-14, L-15, L-16 (per-user override, then config, then default 3, then `past_due` AND agents paused), L-26 and L-9 — all confirmed, and BA's three unverified claims verified (zero `.from(plans)` callers, zero `PlanManagementTab` importers, and `QuotaAllocationService` exposing no check method with nothing outside it reading the allocated columns). Two claims understated: L-13 also falls back to `subscriptions.list(...).data[0]`, so it can convert using ANOTHER subscription's numbers; L-15 matches Stripe's generated English strings, so it is fragile today, not merely redundant later. **SA-1 (required):** route the webhook on the Stripe price id resolved from lookup keys, deny by default on an unrecognised platform price, treat `metadata.product` as a cross-check only — and **one endpoint only**, because the claim table is keyed on `event_id` alone while Stripe delivers the same event id to every endpoint, so a second endpoint would have its deliveries discarded as duplicates and paid invoices silently ignored. This settles Q-T4, Q-T11 and RD-4 together. **SA-2:** retirement scope stated as dies / survives / must-be-guarded, including the six QuotaAllocationService calls in the billing path and the live B-8 leak in `app/api/business-os/usage/route.ts`; merge S-4a-prime into S-4a. **SA-3:** the customer surface is its own workstream, not a section; and record that S-2 and S-4a can merge inert if G-1 slips but S-5 cannot run. **SA-4:** L-17 must read "not a source of truth for Business OS", not "delete" — the agent-platform dunning still reads it. Q-T1 to Q-T11 all decided (lookup keys; webhook calls `assign_tier` server-side; product dimension on `billing_events`; shared account and endpoint; T-3 confirmed clean of CreditService; grace in lifecycle config only; split the customer helper so the shared path has no agent-platform side effect; Stripe owns what was bought and the plan row owns what is in force, plan row governs on disagreement; S-2 may merge dormant but the paid-lapse path needs one real test purchase in S-5). |
| 2026-09-25 | **E-1/E-2 answered; option B adopted; SA-1 to SA-4 applied to the body (BA)** | ⚠️ **Record correction:** BA reported these changes as applied twice before; neither write reached disk — the file remained at the pre-evidence version plus SA's §13. This entry is the first application that has been read back and verified. **Evidence:** E-1 — 4 active rows, all non-zero, last change 2026-07-19; *the user states* the agent platform is not live in production, has no real paying customers and all four are testing accounts. E-2 — *the user states* the parked platform's billing need not keep working. Both recorded as the user's statements, not inferences. **§4 now adopts option B** (retire the purchase path in the same work); option C superseded, `S-4a′` folded into **WS-3** of S-4a, dependency graph simplified. **SA-1:** RD-4 rewritten as one decision — price-id routing from lookup keys off the invoice line items before any handler, deny-by-default, metadata as cross-check with disagreement treated as tamper, one endpoint only (settles Q-T4 + Q-T11). **SA-2:** new **§4.6** as three lists (dies / survives untouched / must be replaced or guarded), incl. the six quota calls (webhook ×5, `sync-subscription` ×1), `account_frozen` read by `generate-agent`, and new **F-28** — the live B-8 leak in `app/api/business-os/usage/route.ts` (now **TK-6**, and H-10). **SA-3:** S-4a re-sized into **WS-1/WS-2/WS-3** (§6.5), `reactivate` added to §8 (now 17 rows), and **§6.4** records G-1 as an external hard gate on S-5 *and all of S-4b*. **SA-4:** L-17 reworded to "not a source of truth for Business OS — left in place for the agent platform", RD-8 amended, and new **RD-16** generalising it. **Ledger corrections accepted:** L-13 now carries the `subscriptions.list({customer, limit: 1})` fallback (`:64-78`) and its consequence; L-15 now rests on Stripe's generated English strings (`:98-101`) being presentation text, not an API contract. **Three claims marked SA-verified** in F-11, F-18, F-19. **SA's Q-T1 to Q-T11 decisions folded into the body** (§10.2, and into L-2/L-10/L-18/L-19, RD-3, RD-8, S-5) — they had been at risk of being dropped. Added TK-1 to TK-6, RD-15, RD-16, §9.2. SA's §13 preserved verbatim. |
