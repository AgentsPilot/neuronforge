# Business OS Credits Boost: Discovery

> **Last Updated**: 2026-09-30

**Created by:** BA
**Date:** 2026-09-27
**Status:** Discovery complete. The user answered §7 on 2026-09-27 and revised answers in rounds 2 and 3 on 2026-09-30. The formal requirement, [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md), is **Ready for SA review**.

## Overview

The user wants Business OS owners to be able to **boost** (top up) their AI balance by buying a package, or a custom amount if the existing system supports one. This existed on the AgentsPilot agent-platform side of this repo. This document records what is actually built, whether each piece can be reused for Business OS, the hazards already present, and the questions the user must answer before a requirement can be written. It **builds on** two approved documents that already decided much of this: [BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md) (D-7, D-8, B-4, B-6, B-8, FR-24, FR-36, FR-37) and [BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md](/docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md) (L-27, RD-2, RD-4, RD-11, RD-12, TK-5, slice S-4b). Where this document disagrees with them, it says so in §6.

**The short answer (as of 2026-09-27).** The agent platform's boost checkout works, but it tops up a balance that **Business OS never spends from**. Business OS counts no AI usage against any balance today, so there is nothing yet for a boost to top up. The payment plumbing (checkout, webhook security, idempotency) is reusable. The balance, the ledger, the unit and the user interface are not.

> **User framing (2026-09-27):** we do not have to reuse the AgentsPilot mechanism. Reuse the good plumbing, and do not copy any of the §4 hazards. The requirement maps each hazard to a requirement that prevents it.

> **Update (2026-09-30):** §1–§4 describe the state on 2026-09-27. Since then the credit deduction work has shipped a live Business OS credit ledger (`business_os_credit_charges` / `business_os_credit_totals`), measured-cost charging, and the credit value (1 credit = $0.001 of cost, 100% markup). HZ-2, R-16, R-17 and §2.1 are superseded by that work. See the requirement §8.1 and §13 (DEP-1, DEP-2) and [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md).

---

## Table of Contents

1. [How the agent-platform boost works today](#1-how-the-agent-platform-boost-works-today)
2. [How Business OS uses AI credits today](#2-how-business-os-uses-ai-credits-today)
3. [Reuse inventory](#3-reuse-inventory)
4. [Hazards already present](#4-hazards-already-present)
5. [What is already decided](#5-what-is-already-decided)
6. [Where this discovery differs from the approved documents](#6-where-this-discovery-differs-from-the-approved-documents)
7. [Business questions for the user](#7-business-questions-for-the-user)
8. [Technical decisions for SA](#8-technical-decisions-for-sa)
9. [Could not verify](#9-could-not-verify)
10. [Notes on integration points](#10-notes-on-integration-points)

---

## 1. How the agent-platform boost works today

### 1.1 The flow, end to end

| Step | What happens | Where |
|---|---|---|
| 1. Pack catalogue | Admin-defined packs in the `boost_packs` table: `pack_key`, `pack_name`, `display_name`, `description`, `price_usd`, `bonus_percentage`, `credits_amount`, `bonus_credits`, `badge_text`, `is_active`. Credits are **pre-computed when the pack is saved** (`price_usd / pilot_credit_cost_usd`, plus the bonus percentage). They are not recalculated at purchase time. | `scripts/initialize-boost-packs.ts:37-93`; `lib/stripe/StripeService.ts:232-234` |
| 2. Seed packs | Quick Boost $5 (0% bonus), Power Boost $10 (10%, "POPULAR"), Mega Boost $20 (15%, "BEST VALUE"). The live values in the database were not checked. | `scripts/initialize-boost-packs.ts:37-68` |
| 3. Admin management | `GET/POST/PUT/DELETE /api/admin/boost-packs`, gated by `requireAdmin`. | `app/api/admin/boost-packs/route.ts` |
| 4. User picks a pack | The billing UI reads active packs **directly from the browser** (`supabase.from('boost_packs')...eq('is_active', true)`). A boost can only be bought by a user who already has a Stripe subscription. That rule is enforced **only in the browser** (an `alert`). | `components/v2/settings/BillingSettingsV2_NEW.tsx:377-383, 486-491`; page `app/v2/billing/page.tsx` |
| 5. Checkout session | `POST /api/stripe/create-checkout` with `{ purchaseType: 'boost_pack', boostPackId }` calls `StripeService.createBoostPackCheckout`. This creates a one-off (`mode: 'payment'`) embedded checkout, with an inline `price_data` line item at `price_usd`, and puts `user_id`, `boost_pack_id`, `credits`, `purchase_type: 'boost_pack'` in the session metadata. It writes the audit event `BOOST_PACK_CHECKOUT_INITIATED`. | `app/api/stripe/create-checkout/route.ts:129-167`; `lib/stripe/StripeService.ts:201-275` |
| 6. Stripe customer | `getOrCreateCustomer` finds or creates a Stripe customer. If the user has no `user_subscriptions` row, it **inserts one with hard-coded `monthly_amount_usd: 10.00, monthly_credits: 20833`**. | `lib/stripe/StripeService.ts:37-96` |
| 7. Webhook | `checkout.session.completed` (platform, not Connect) goes to `handleCheckoutCompleted`. For `mode === 'payment' && purchase_type === 'boost_pack'` it converts the metadata credits to tokens (×`tokens_per_pilot_credit`, default 10), then **reads and rewrites** `user_subscriptions.balance` and `total_earned`, clears `free_tier_expires_at`, sets `account_frozen: false`, inserts a `credit_transactions` row (`activity_type: 'boost_pack_purchase'`), inserts a `boost_pack_purchases` row, and re-allocates quotas. | `app/api/stripe/webhook/route.ts:454-580, 2468-2476` |
| 8. Idempotency | At the event level only: `processed_webhook_events` is claimed before the handler runs, a `23505` is treated as a concurrent claim, and the claim is released on error. | `app/api/stripe/webhook/route.ts:2339-2408, 2536-2567` |
| 9. Rollover | Boost credits **roll over**. On a subscription renewal the webhook replaces the subscription allowance but adds back the sum of all `boost_pack_purchase` rows ever written. | `app/api/stripe/webhook/route.ts:139-179` |
| 10. Recovery tooling | `scripts/diagnose-boost-purchase.ts`, `scripts/check-boost-purchase-simple.ts` and `scripts/manually-process-boost-purchase.ts` exist to credit a purchase by hand from a Stripe session id. | `scripts/` |

### 1.2 "Custom amount" is not a top-up

The only custom-amount path, `purchaseType: 'custom_credits'` (minimum 1,000, maximum 10,000,000 Pilot Credits), creates a **recurring monthly subscription** at that amount (`mode: 'subscription'`, a price created on the fly). It is not a one-off top-up. Its subscription credits **do not** roll over. Per the approved reuse plan (RD-12), this path is being **retired**.

| Evidence | Where |
|---|---|
| Min/max validation, then `createCustomCreditSubscription` | `app/api/stripe/create-checkout/route.ts:73-107` |
| `mode: 'subscription'`, `recurring: { interval: 'month' }` | `lib/stripe/StripeService.ts:149-193` |

**So a one-off custom-amount top-up does not exist anywhere.** Only fixed packs exist.

### 1.3 How the credit value is defined

| Concept | Value | Where |
|---|---|---|
| `pilot_credit_cost_usd` | $0.00048 per Pilot Credit (default and fallback) | `ais_system_config` key/value; `lib/utils/pricingConfig.ts:56-65` |
| `tokens_per_pilot_credit` | 10 | `lib/utils/pricingConfig.ts:58, 118-124` |
| Stored balance unit | **Tokens** (Pilot Credits × 10) | `app/api/stripe/webhook/route.ts:476`; `lib/services/CreditService.ts:444-481` |
| $10 | ≈ 20,833 Pilot Credits ≈ 208,330 tokens | `supabase/migrations/20260928_ai_credit_allowance.sql:11` |
| Consumption (agent platform only) | `CreditService.chargeTokensWithIntensity`: raw tokens × (1 + intensity/10), deducted from `user_subscriptions.balance` | `lib/services/CreditService.ts:444-525` |

### 1.4 Admin controls that exist

| Control | Exists? | Where |
|---|---|---|
| Create/edit/delete packs | Yes (API) | `app/api/admin/boost-packs/route.ts` |
| Admin UI for packs | Probably in `/admin/system-config`. **Not verified** | `app/admin/system-config/page.tsx` (not opened) |
| Grant or deduct a customer's credit by hand | **No route found** | Globbed `app/api/admin/**/*{credit,balance,subscription,reward,grant}*`. Only `reward-config` matched |
| Business OS entitlement admin ops | `ensure_plan_row`, `set_cohort`, `set_expiry`, `assign_tier`, `add_override`, `end_override`, `reset_plan_state`. **No "grant AI credits" op**, although D-7 and §12 of the entitlements requirement call for one | `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:167-172` |

---

## 2. How Business OS uses AI credits today

| Question | Answer | Where |
|---|---|---|
| Does Business OS AI spend deduct from `user_subscriptions.balance`? | **No.** That balance is written only by the agent-platform charge path. The usage route says so explicitly, and records that on a real account the balance understated consumption 13×. | `app/api/business-os/usage/route.ts:212-222` |
| What does the Business OS "credits" card show? | Pilot Credits **consumed over a rolling 30 days**, computed from `token_usage` (every LLM call through the provider factory), against a **global** ceiling `monthly_ai_allowance_usd` (default $10 ≈ 20,833 credits), converted at `pilot_credit_cost_usd`. `remaining` is clamped at 0. | `app/api/business-os/usage/route.ts:115-138, 169-240`; `lib/business-os/usage/usageSummary.ts:167-205`; `components/business-os/UsageCard.tsx` |
| Is that ceiling enforced? | **No.** Display only. The ring empties, and nothing stops. | `docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md` §1 table ("Business OS never deducts credits") |
| Is it per account? | **No.** One global config value for every account. There is no per-account allowance, and nothing a purchase could raise. | `supabase/migrations/20260928_ai_credit_allowance.sql` |
| Is the window a billing period? | **No.** A rolling 30-day window (`range=last_30d`), not a calendar month or a billing anniversary. | `components/business-os/UsageCard.tsx:84`; `app/api/business-os/usage/route.ts:165-167` |
| The entitlements balance seam | `balance.ts` exposes `AiActionBalanceSource.check({ accountId, capability, cost })`. The only implementation is `ALWAYS_SUFFICIENT`. **No usage ledger, no boost grant, nothing counts an AI action.** | `lib/business-os/entitlements/balance.ts:5-49` |
| The customer-facing unit Business OS plans are sold in | **AI actions**: a flat count, 1 per customer-visible AI action, not weighted by tokens (B-4, D-11). Tier allowances: trial 250 one-off, champion 1,000/mo, basic 500/mo, pro 2,000/mo. These are first-pass numbers. | `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:38-53` |
| Enforcement mode | Shadow in production (records, refuses nothing). | memory `business-os-subscription-entitlements`; `BUSINESS_OS_ENTITLEMENTS.md` §The mode flag |
| LLM cost tracking | Every Business OS call goes through `callWithTracking` into `token_usage`, attributed to the account. This is cost accounting, not a spendable balance. | CLAUDE.md, Business OS LLM row; `lib/repositories/TokenUsageRepository.ts` |

**Conclusion.** Business OS and the agent platform **do not share a spendable balance today**, and by decision **B-8 / FR-37 / RD-2 they must not**. A boost bought through the existing flow would raise a number that nothing in Business OS reads for spending. It would not even move the Business OS card, which is computed from `token_usage` against a global ceiling.

### 2.1 Four units are in play

| Unit | Used by | Relationship |
|---|---|---|
| Tokens | `user_subscriptions.balance`, `token_usage` | raw |
| Pilot Credits | Boost packs, the agent-platform UI, the Business OS usage card | 1 credit = 10 tokens (config) |
| USD | Pack prices, `monthly_ai_allowance_usd` | $0.00048 per credit (config) |
| AI actions | Business OS tiers, cohorts, D-8 boost examples ("+250 AI actions for $10") | **No defined conversion to the other three.** A flat count per call site, set by the FR-30 inventory, which is not built |

A boost has to be sold in exactly one of these. The approved decisions say **AI actions** (D-8, D-11). **The user (Q1) left the unit to SA** as "the Business OS AI-usage unit". **Resolved 2026-09-30:** the credit deduction work replaced both Pilot Credits and AI actions in Business OS with **measured-cost credits** (1 credit = $0.001 of cost; `credits.allowance`), so boosts are sold in credits ([BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md) §1).

---

## 3. Reuse inventory

Verdicts: **Reuse as-is** · **Reuse with changes** · **Agent-platform specific** (do not reuse) · **Missing**.

| # | Element | Verdict | Why (business terms) | Evidence |
|---|---|---|---|---|
| R-1 | Stripe SDK set-up, one platform Stripe account | Reuse as-is | Nothing product-specific | `lib/stripe/StripeService.ts:22-32, 782-791` (reuse plan L-1) |
| R-2 | Embedded one-off checkout (`mode: 'payment'`, `ui_mode: 'embedded'`) | Reuse with changes | The right shape for a one-off top-up. The amount is billed in USD verbatim whatever the currency. There is no fixed Stripe price, so Stripe cannot report "boost revenue by pack". Metadata would need a product marker for the webhook router (RD-4). | `StripeService.ts:201-275` |
| R-3 | `getOrCreateCustomer` | Reuse with changes | One Stripe customer per person is right, but it **creates a phantom agent-platform subscription row** ($10 / 20,833 credits). The split is already decided (Q-T8). | `StripeService.ts:37-96`; reuse plan L-2 |
| R-4 | `create-checkout` route, `boost_pack` branch | Reuse with changes | Auth is correct. There is no Zod validation, it logs raw `error.message` to the client, it does not check the pack is **active**, and the "must be a paid customer" rule lives only in the browser. | `app/api/stripe/create-checkout/route.ts:43-52, 129-181`; `StripeService.ts:222-226` |
| R-5 | `custom_credits` path | Agent-platform specific | It is a monthly subscription, not a top-up, and it is being retired (RD-12). | §1.2 |
| R-6 | Webhook signature verification (dual secrets) + `processed_webhook_events` claim/release | Reuse as-is | The most valuable reusable piece. It is already security-reviewed. | `webhook/route.ts:2330-2408, 2536-2567`; reuse plan L-11/L-12 |
| R-7 | Webhook boost handler (`handleCheckoutCompleted`, boost branch) | Agent-platform specific | Writes tokens into `user_subscriptions.balance`, clears the free-tier expiry, unfreezes the account and re-allocates agent quotas. Every one of those is agent-platform state. It also has the correctness hazards in §4. | `webhook/route.ts:465-580` |
| R-8 | `user_subscriptions.balance` / `total_earned` | Agent-platform specific | Business OS does not spend from it. Sharing it is forbidden by B-8 / RD-2. | §2 |
| R-9 | `credit_transactions` ledger | Agent-platform specific | Same reason. Its rows are in tokens. It is server-write-only since `20261004`, a pattern worth copying. | `webhook/route.ts:507-525`; memory `payment-tables-lockdown` |
| R-10 | `boost_packs` table | Reuse with changes | Priced and denominated in Pilot Credits, not AI actions. It has no expiry, no product (agent platform vs Business OS) and no currency column. Its schema is **not in `supabase/migrations/`** (see §9). The reuse plan defers this to S-4b (L-27). | `scripts/initialize-boost-packs.ts`; `StripeService.ts:222-234` |
| R-11 | `boost_pack_purchases` table | Reuse with changes | A useful purchase record (pack, price paid, payment intent, status). But `credits_purchased` holds tokens, and there is no expiry or remaining-balance field for D-8's 12-month expiry. Schema not in the repo. | `webhook/route.ts:533-560` |
| R-12 | `/api/admin/boost-packs` | Reuse with changes | `requireAdmin` is correct. There is no Zod validation, no audit entry, `console.*` logging, a hard delete, direct Supabase access instead of a repository, and credits are not recomputed when the credit price changes. | `app/api/admin/boost-packs/route.ts` |
| R-13 | Agent-platform billing UI (`BillingSettingsV2_NEW`, `BillingSettings`, `/v2/billing`) | Agent-platform specific | Wrong design system, no RTL, Pilot-Credit vocabulary. It reads money tables from the browser and does display FX from a third-party API in the browser. Scheduled for retirement (L-33/L-35). | `components/v2/settings/BillingSettingsV2_NEW.tsx:293-331, 333-419` |
| R-14 | `pricingConfig` / `ais_system_config` credit rate | Agent-platform specific | A dollars-to-tokens rate for the agent platform. Business OS sells AI actions. | `lib/utils/pricingConfig.ts`; reuse plan L-24 |
| R-15 | `balance.ts` seam (`AiActionBalanceSource`) | Reuse as-is (the interface) | The place a boost balance plugs in. Call sites already ask the question, so no call-site migration is needed. | `lib/business-os/entitlements/balance.ts` |
| R-16 | Business OS AI-action ledger (allowance use + boost lots with expiry) | **Missing** (2026-09-27). **Now partly built**: the credit ledger is live; adding credits is not (requirement DEP-1) | Nothing counts AI actions yet (Slice 3). **A boost has nothing to top up until this exists.** | `balance.ts:7-12`; reuse plan L-22 |
| R-17 | Per-account metered allowance + period reset | **Missing** (2026-09-27). **Now built** as `credits.allowance` and period totals (credit deduction slices 3–5) | Tier and cohort numbers exist in config. Nothing applies them per account or resets them. | `BUSINESS_OS_ENTITLEMENTS.md:38-53, 131` |
| R-18 | Business OS usage card and route | Reuse with changes | A good home for "remaining + top up". It must stop being a rolling 30-day window against a global ceiling, and must show allowance + boost balance. (Being replaced by credit deduction slice 6.) | `components/business-os/UsageCard.tsx`; `app/api/business-os/usage/route.ts` |
| R-19 | Business OS billing / plan surface | **Missing** | No billing section exists in Business OS settings. It is planned as WS-2 of S-4a. | reuse plan F-13, WS-2 |
| R-20 | Admin "grant / deduct AI credits" operation | **Missing** | Required by D-7 and §12 of the entitlements requirement. It is not among the built admin ops. Planned as credit deduction slice 11. | §1.4 |
| R-21 | `AuditTrailService` | Reuse as-is | Already used for `BOOST_PACK_CHECKOUT_INITIATED`. There is **no** audit entry when the boost is actually credited (see §4). | `create-checkout/route.ts:154-167` |
| R-22 | `requireAdmin` + CI guard; server-write-only RLS pattern | Reuse as-is | Proven platform patterns. | CLAUDE.md Security Rules; reuse plan L-29/L-30 |
| R-23 | Receipts / invoices for one-off purchases | Missing / unverified | The invoice list reads Stripe invoices. A one-off checkout does not obviously create an invoice (see §9). | `StripeService.ts:393-400` |
| R-24 | Refund of a boost | **Missing** | `charge.refunded` only matches `payment_transactions` (client money on Connect). A refunded platform boost is logged as "unknown payment" and its credits stay. | `webhook/route.ts:913-941` |

**Counts (2026-09-27):** reuse as-is 5 (R-1, R-6, R-15, R-21, R-22) · reuse with changes 7 (R-2, R-3, R-4, R-10, R-11, R-12, R-18) · agent-platform specific 6 (R-5, R-7, R-8, R-9, R-13, R-14) · missing 6 (R-16, R-17, R-19, R-20, R-23, R-24).

---

## 4. Hazards already present

| # | Hazard | Severity | Evidence |
|---|---|---|---|
| HZ-1 | **A boost bought today does nothing for Business OS.** Business OS neither spends from nor displays `user_subscriptions.balance`. Reusing the flow as-is would take money for no effect. | Blocking | §2 |
| HZ-2 | **There is nothing to top up yet.** `ALWAYS_SUFFICIENT` means no Business OS account can run out, so a boost has no customer-visible value until metering (Slice 3) exists. The approved order is S-5 then S-3 then S-4b (boosts). | Blocking (sequencing). **User (Q7): record as a known dependency, not a blocker.** Since 2026-09-30, charging is live but nothing refuses at zero until credit deduction slices 9–10 | `balance.ts:45-49`; reuse plan §6.2 |
| HZ-3 | **The webhook marks a boost "done" even when crediting failed.** The balance `update` result is not checked at all. Ledger and purchase insert errors are logged and swallowed, so the handler returns normally and the event is stamped `completed`. Stripe will not retry, and the customer paid with no credit. The existence of the manual recovery scripts is consistent with this having happened (inference, not verified). | High (money) | `webhook/route.ts:495-560, 2536-2540`; `scripts/manually-process-boost-purchase.ts` |
| HZ-4 | **No `payment_status` check.** The boost branch credits on `checkout.session.completed` without checking `payment_status === 'paid'`. For delayed payment methods, that event can arrive before the money does. The manual script does check. | High (money) | `webhook/route.ts:465`; compare `scripts/manually-process-boost-purchase.ts:48-51` |
| HZ-5 | **Lost-update race on the balance.** The balance is read, then written back (`currentBalance + credits`), while the agent charge path does the same. Concurrent writes can lose a top-up or a charge (known as R1 in memory). | Medium | `webhook/route.ts:481-504`; `CreditService.ts:461-481` |
| HZ-6 | **Inactive packs can be bought.** `createBoostPackCheckout` looks the pack up by id with the service-role client and never checks `is_active`. The browser filters, the server does not. | Medium | `StripeService.ts:222-226`; `create-checkout/route.ts:100, 140` |
| HZ-7 | **"Only paying customers can boost" is browser-only.** | Low to medium | `BillingSettingsV2_NEW.tsx:488-491` |
| HZ-8 | **Phantom subscription row.** The first checkout for a user with no row creates one saying $10 / 20,833 credits per month. | Medium | `StripeService.ts:83-92`; reuse plan L-2 |
| HZ-9 | **Refunds do not claw back credits** (R-24). | Medium (money) | `webhook/route.ts:913-941` |
| HZ-10 | **Currency.** The amount is USD, billed verbatim whatever `currency` is passed. The agent-platform UI shows converted prices using a **live FX rate fetched in the browser** from `api.exchangerate-api.com`. CLAUDE.md: there is no FX rate in the platform, and money is never summed across currencies. Business OS plans are USD-only for now (Q-B2). | Medium | `StripeService.ts:218, 240-250`; `BillingSettingsV2_NEW.tsx:303-322`; reuse plan F-27/OI-1 |
| HZ-11 | **Webhook routing.** A platform `checkout.session.completed` is routed on `metadata.purchase_type` alone. RD-4 requires routing on a fixed Stripe price id with deny-by-default. A Business OS boost must not fall into the agent-platform handler. | High once Business OS takes payments | `webhook/route.ts:458-465`; reuse plan RD-4 |
| HZ-12 | **Schemas not in the repo.** No migration under `supabase/migrations/` or `supabase/SQL Scripts/` names `boost_packs`, `boost_pack_purchases` or `billing_events` (Glob by filename only). Their RLS write posture is unverified, and they are not among the 12 tables locked down in `20261004` (per memory). | Medium | §9 |
| HZ-13 | **Admin pack API hygiene.** No Zod (mandatory rule 2), `console.*` (rule 3, 13 calls), no audit, a hard delete (history in `boost_pack_purchases` would point at a deleted pack), no repository (rule 1). | Low to medium | `app/api/admin/boost-packs/route.ts` |
| HZ-14 | **No audit entry when a boost is credited.** Only the checkout start is audited. The subscription paths do audit. | Low | `webhook/route.ts:465-580` vs `:284-317` |
| HZ-15 | **The webhook reads the credit price as if it were a column.** `.from('ais_system_config').select('pilot_credit_cost_usd').single()`, but the table is key/value (`config_key`, `config_value`). This most likely always falls back to 0.00048. It affects the proration and subscription paths, not boosts. Not verified against the live schema. | Low for boosts | `webhook/route.ts:110-115, 632-637`; `20260928_ai_credit_allowance.sql:13-15` |
| HZ-16 | **Exposed Stripe secret key.** Rotation is still owed by the user. G-1 (service-role key rotation) gates all of S-4b, which is where boosts are planned. | High (external gate) | memory `plugin-secret-exposure-fix`; reuse plan §6.4 |
| HZ-17 | **The webhook file carries live Business OS Connect money.** Any change to it needs before/after evidence that Connect is untouched (Q-T5). The file is still `console.*` (TK-4). | Process | reuse plan §4.5 |

---

## 5. What is already decided

These are recorded decisions. The user may confirm or change them in §7, but they should not be re-asked as if they were open. **Changes made by the user's answers are recorded in the requirement, §2 (C-1 to C-7).**

| # | Decision | Source |
|---|---|---|
| D-8 | Boosts are only for metered things (AI actions now, SMS later). Example: **+250 AI actions for $10, +750 for $25**. **Paid plans only.** Monthly allowance first, then boost balance. **Boosts expire after 12 months.** Warnings at 80% and 100%. Optional **auto top-up** with a customer-set monthly cap. | Entitlements requirement §3. **"Paid plans only" changed by Q6 (C-1); expiry not enforced in v1 (C-4); packages replaced by "Option A" (requirement §8.2)** |
| D-7 | Champions do not buy boosts. **An admin grants credits.** | §3. **Purchase side superseded by Q6** |
| D-11 / B-4 | Customers see **AI actions** (a flat count). Pilot Credits and tokens are internal only. | §2, §11. **Superseded by the credit deduction work: credits (C-2, resolved 2026-09-30)** |
| B-6 / FR-36 | The monthly allowance does not roll over. Boost balances last 12 months. | §14 |
| FR-24 | Consumption order: allowance, then boosts, **soonest-expiring first**. | §14 |
| B-8 / FR-37 / RD-2 | Business OS billing and balances are **separate** from agent-platform Pilot Credits. No reading or writing each other's tables. | §14; reuse plan RD-2. **Confirmed by Q5** |
| FR-29 | There is exactly **one** customer-visible AI allowance in Business OS. | §14 |
| Q-B2 / RD-13 | **USD only** for now. | Reuse plan §1.2. **Boosts follow it (round 3)** |
| Q-B7 | No refunds on plans (boosts not addressed). | Reuse plan §1.2 |
| RD-11 | Boosts, add-ons and auto top-up are **out of S-4a**, in **S-4b**, after S-3 metering. | Reuse plan §5, §6.2. **Qualified by Q7 (C-3)** |
| TK-5 | Whether the **agent-platform** boost checkout is retired along with the credit purchase path is still **open**. | Reuse plan §10.3. **Decided by Q14: retire for now (C-5)** |

---

## 6. Where this discovery differs from the approved documents

| # | Item | Finding | Proposed handling |
|---|---|---|---|
| X-1 | Reuse plan **F-28 / TK-6** ("`app/api/business-os/usage/route.ts` already reads `user_subscriptions`") | In the current code, the route and `usageSummary.ts` do **not** query `user_subscriptions`. The name appears only in a comment explaining why it is *not* used (`usage/route.ts:214`). The route **does** read the agent-platform credit-price keys from `ais_system_config` (`:120-129`) and `tokens_per_pilot_credit` (`usageSummary.ts:191-200`). That is a softer B-8 coupling. | Raise with SA as an open question: F-28 may have matched the comment. The real coupling to remove is the `ais_system_config` rate. Not contradicting the approved document, only flagging. The credit deduction work reached the same finding (its SQ-8). |
| X-2 | The user's framing: "reuse the AgentsPilot boost" | The approved plan (L-27) says "adapt later", and TK-5 may retire the agent-platform checkout. Reuse is **of the plumbing and the pack concept**, not of the balance or the handler. | **Resolved (2026-09-27):** the user confirmed that reusing the mechanism is not required. Reuse the plumbing only. |

---

## 7. Business questions for the user

The "User answer" column records the user's answers (2026-09-27, revised in rounds 2 and 3 on 2026-09-30 where marked). How each answer was applied is in the requirement.

| # | Question | Suggested answer | User answer |
|---|---|---|---|
| **Q-1** | **What does a boost buy?** Extra "AI actions" (the unit Business OS plans are sold in), or credits in some other unit? | AI actions, per D-11. Customers never see tokens or Pilot Credits. | *(2026-09-27)* Whatever unit the system actually measures AI activity in (credits or tokens). Don't force "AI actions"; call it "the Business OS AI-usage unit" and leave the exact unit to SA. **Resolved 2026-09-30:** the credit deduction work settled it. The unit is the **Business OS credit** (1 credit = $0.001 of cost); boosts sell at the base rate of 500 credits per $1, from [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md). |
| **Q-2** | **Fixed packages, a custom amount, or both?** Today only fixed packs exist as a one-off purchase. There is no one-off custom amount. | Fixed packs first (D-8's +250/$10 and +750/$25). A custom amount later, if requested. | Fixed packages first. Custom amount later. |
| **Q-3** | If a custom amount is wanted: what is the minimum, the maximum, the step (for example multiples of 50 actions), and the price per action? Is there a volume discount? | Only if Q-2 says "both". | Define packages now. The numbers can be adjusted later. |
| **Q-4** | **Pack contents and prices.** Keep D-8's two packs? Is there a bonus on larger packs, as the agent platform had (10% and 15%)? | Confirm D-8. Bonuses are optional. | *(2026-09-27)* BA picks sensible starting packages; config first, table later. *(Round 2)* $10 +5% / $25 +20% / $50 +30%. **Round 3 (final): "Option A"**: **Starter $10** (5,000 credits, no bonus), **Plus $25 "Most popular"** (+10%, 13,750), **Max $50 "Best value"** (+15%, 28,750). The bonus is measured against the base rate of 500 credits per $1. The aim is to steer buyers to Plus and Max with a visible 5-point step. Markup after an assumed Stripe fee: 88% / 74% / 68%. **The user accepted Max below the 70% target.** The shown bonus % must be computed from the configured base rate, never a hand-typed label (requirement FR-42). |
| **Q-5** | **Is the balance shared with the agent platform?** B-8 says separate, and the agent platform is parked. | Separate (confirm B-8). A Business OS boost never tops up agent credits, and the reverse is also true. | Separate. Confirmed. |
| **Q-6** | **Who can buy?** D-8 says paid plans only. Can a **trial** account buy a boost to keep going when its trial allowance runs out? Today, running out ends the trial (D-2). Champions get admin grants instead (D-7). | Paid plans only. Trial users upgrade instead. Champions get admin grants. | **All tiers and cohorts can buy.** Overrides D-8's "paid plans only". |
| **Q-7** | **Timing.** Boosts only mean something once AI usage is counted and limited (planned for after enforcement switch-on and metering). Do you accept boosts shipping **after** metering? Or do you want to sell boosts earlier, knowing nothing runs out yet? | Accept the sequence. Selling a top-up for an allowance nobody can exhaust would be taking money for nothing. | Timing and rules deferred. v1 is an on-demand purchase by the user; rules about when to prompt come later. Until metering exists, a boost raises a balance nothing limits: a known dependency, not a blocker. |
| **Q-8** | **Currency and tax.** USD only, as for plans (Q-B2)? Do Israeli customers need VAT-inclusive prices or a tax invoice for a boost? | USD only. VAT and invoicing follow the plans decision (OI-1). | *(2026-09-27)* **Parked.** USD as a working assumption. *(Round 2)* Tax: prices exclude tax, and we operate in the USA. Currency: options presented in requirement §10. **Round 3 (final): currency is USD only for now. Tax: "go with whatever works now"**: SA picks the simplest mechanism that keeps a later switch to collecting tax possible. The accountant confirms the real obligation before live launch, as a **pre-launch dependency, not a blocker**. |
| **Q-9** | **Expiry.** Confirm 12 months from purchase (D-8). Do customers get a reminder before unused boost actions expire? | 12 months, with one reminder 30 days before. | Low priority. The data model allows an optional expiry per boost lot. Expiry is **not implemented in v1**. |
| **Q-10** | **What happens to unused boost actions if the customer cancels, downgrades, lapses into grace or is paused?** Can they be used during grace? Are they kept if the customer comes back within 12 months? | Kept until they expire. Usable whenever the account may use AI. Not refunded. | **Parked** (no downgrade support today). |
| **Q-11** | **Refunds.** Plans have no refunds (Q-B7). Do boosts? What about an unused or partly used boost, or a boost bought by mistake? If Stripe refunds one, should the unused actions be removed? | No refunds as policy. Admin discretion for mistakes. A refund removes the unused actions. | **Parked** (no refunds today). A refunded or disputed Stripe event must not leave the system silently inconsistent: at minimum logged and flagged for an admin. SA decides the rest. |
| **Q-12** | **Limits.** Is there a cap on how many boosts or how much money per month? Any fraud checks? | A monthly spending cap per account (admin-configurable), mainly as a safety net. | *(2026-09-27)* Agreed; BA to propose a default. *(Round 2)* **$150 per account per rolling 30 days, confirmed.** The count cap is **dropped**: the money cap already stops a runaway, and repeated clicks are handled separately. Unchanged in round 3. |
| **Q-13** | **Admin grant and adjust.** Should admins be able to **add** AI actions (D-7) and **remove** them? With a mandatory reason and optional expiry? Should the customer see admin grants in their history? | Yes to add and remove. Reason required. Expiry optional. Shown to the customer as "Added by support". This also answers your earlier queued question about managing a customer's credit. | Yes, admin add/remove with a **required** reason. It lives in the **"credit diary"** built by a separate session (credit deduction slice 11). This requirement only writes boost entries into the shared ledger and defines the interface expectation. Admin grant/adjust is out of scope here. |
| **Q-14** | **Agent-platform boost checkout (TK-5).** Retire it together with the credit purchase path? | Retire it. The agent platform is parked, and keeping it leaves a second boost path through the same webhook. | Retire it for now. It may be reused in future, so no destructive deletion without an SA plan. |
| **Q-15** | **Where in Business OS?** A "Top up" button on the dashboard credits card? A "Plan & billing" section in Settings (planned as WS-2)? A prompt when the owner hits the limit in chat? | All three, pointing to one purchase screen in Settings → Plan & billing. | v1: an on-demand **Top up** button. Later: a pop-up when the limit is hit (out of scope for v1). |
| **Q-16** | **Auto top-up.** Is it in the first version (D-8 makes it optional)? If so, what is the default cap, and who sets it? | Not in the first version. | No auto top-up. |
| **Q-17** | **Receipts.** Is a Stripe receipt email enough, or must each boost appear in the in-app invoice list, possibly as a tax invoice? | Show each boost in the in-app billing history. The tax-invoice format follows OI-1. | Yes: a Stripe receipt **and** each boost shown in the in-app billing/usage history. |
| **Q-18** | **Low-balance warnings.** Confirm 80% and 100% (D-8). In-app only, or email too? Should the warning offer "Top up" directly? | In-app and email, with a Top up link. | Wanted, but later (out of scope for v1). |
| **Q-19** | **Does a boost ever unlock a feature** (for example chat for a basic customer)? D-8 says no, because boosts are only for metered usage. | Confirm no. | Confirmed: a boost never unlocks a feature. |
| **Q-20** | **Display.** Should the credits card show plan allowance and boost balance separately ("120 of 500 this month + 250 boost"), or as one number? | Separately, so the order of use is visible. | Separately. |

---

## 8. Technical decisions for SA

These are recorded for SA. The user should not be asked them. **Superseded by the updated list in the requirement, §15 (T-1 to T-18).**

| # | Decision needed | Notes |
|---|---|---|
| T-1 | Business OS AI-action ledger design: boost "lots" with purchase date, expiry, remaining; consumption order allowance → soonest-expiring lot | Implements `AiActionBalanceSource`. Depends on the Slice 3 FR-30 inventory. Must not import billing. |
| T-2 | Atomic crediting and debiting (RPC / single statement), replacing read-then-write | HZ-5 |
| T-3 | Idempotency beyond the event id: a unique key on the checkout session id / payment intent in the purchase table | HZ-3. A replayed or manually processed session must not credit twice. |
| T-4 | Webhook failure semantics: a crediting failure must **throw** so the claim is released and Stripe retries | HZ-3 |
| T-5 | Credit only on `payment_status === 'paid'`. Handle `checkout.session.async_payment_succeeded` / `_failed` | HZ-4 |
| T-6 | Routing: fixed Stripe product/price per pack with a `lookup_key` (consistent with RD-1/RD-4), vs inline `price_data` + metadata. Deny by default. | HZ-11. Affects Stripe reporting per pack. |
| T-7 | Refund / dispute handling for platform one-off payments (claw back unused actions) | HZ-9, R-24 |
| T-8 | Receipts: whether to enable invoice creation on one-off checkouts so boosts appear in `listInvoices` | R-23; to be confirmed against the Stripe API |
| T-9 | Pack catalogue: extend `boost_packs` with a product dimension, a unit, an expiry and a currency, or create a new Business OS table. Bring its schema into `supabase/migrations/`. RLS server-write-only. | HZ-12, R-10 |
| T-10 | Replace hard delete with deactivation. Recompute or version pack credits. Zod, repository, audit, Pino on the admin API. | HZ-13 |
| T-11 | Server-side eligibility (paid plan, pack active) via the entitlement resolver. Never browser-only. | HZ-6, HZ-7 |
| T-12 | `getOrCreateCustomer` split (Q-T8, already decided) is a prerequisite | HZ-8 |
| T-13 | Usage card: move from a rolling 30 days vs a global USD ceiling to the per-account period allowance + boost balance in AI actions. Remove the `ais_system_config` rate dependency (X-1). | R-18 |
| T-14 | Admin grant/deduct op: a new entitlements admin action (Zod, `requireAdmin`, audit flushed before the response) | R-20, Q-13 |
| T-15 | Whether boost purchases belong in `billing_events` with a product dimension (Q-T3) | |

---

## 9. Could not verify

| # | Item | Why |
|---|---|---|
| U-1 | `boost_packs`, `boost_pack_purchases`, `billing_events`, `processed_webhook_events` DDL and RLS | No migration file matched by filename, and no content-search tool was available. They may be dashboard-created (memory notes core tables were dashboard-only elsewhere). |
| U-2 | Live pack rows and prices | No DB access. The seed script shows the intent only. |
| U-3 | Admin UI location for boost packs | `app/admin/system-config/page.tsx` not opened. |
| U-4 | Whether any real boost purchases exist | The reuse plan's E-1 covers subscriptions only. A read-only query would be needed: `select count(*), max(created_at) from boost_pack_purchases`. |
| U-5 | Whether a one-off embedded Checkout produces a Stripe invoice | Stripe API behaviour. For SA (T-8). |
| U-6 | HZ-15 (the column read on the key/value table) | Inferred from the migration comment describing `ais_system_config` as key/value. Not checked against the live schema. |
| U-7 | Whether `components/settings/BillingSettings.tsx` (the live `/settings` billing, per reuse plan F-9) has the same boost flow as `BillingSettingsV2_NEW.tsx` | Not opened. |
| U-8 | Whether `business_profiles.currency` exists in the live schema | CLAUDE.md names it as a default and label; `lib/business-os/userCurrency.ts:4-5` says it did not exist when that file was written. Not needed for boost pricing (requirement §10), so not checked. |
| U-9 | Our actual Stripe processing fee | The package markups assume 2.9% + $0.30 (requirement §8.2, DEP-8, T-18). |

---

## 10. Notes on integration points

| System | Effect |
|---|---|
| `lib/business-os/entitlements/balance.ts` | Gets the real ledger-backed implementation, which includes boost lots. |
| `lib/business-os/entitlements/config/*` | Boost packs could be defined next to tiers (display names per locale, price) or in a table. That is for SA. |
| `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts` | Candidate home for the admin grant/deduct operation (now owned by credit deduction slice 11). |
| `lib/stripe/StripeService.ts` | A Business OS boost checkout method. `getOrCreateCustomer` split. The Connect methods are untouched. |
| `app/api/stripe/webhook/route.ts` | A Business OS boost branch behind price-id routing (RD-4). Live Connect money flows through this file. |
| `app/api/business-os/usage/route.ts`, `components/business-os/UsageCard.tsx` | Show allowance + boost, and a Top up entry point (the card is being replaced in credit deduction slice 6). |
| `app/business-os/settings/**` | The purchase and history surface (WS-2). |
| Tables Business OS must never write | `user_subscriptions`, `credit_transactions` (RD-2). |
| Gates | G-1 key rotation; Stripe secret key rotation; refusal at zero (credit deduction slices 9–10); the accountant's sales-tax confirmation before live launch. |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-27 | Created | Discovery of the agent-platform boost flow, Business OS credit consumption, the reuse inventory (24 elements), 17 hazards, 20 business questions and 15 SA items. Flags a possible inaccuracy in reuse-plan F-28 (X-1). |
| 2026-09-27 | User answers recorded | Added a "User answer" column to §7 (Q-1 to Q-20). Parked: Q-8 currency/tax, Q-10 lifecycle, Q-11 refunds. Changes to D-8, D-7, D-11, RD-11 and TK-5 are cross-referenced in §5. X-2 resolved (reuse only the plumbing). §8 superseded by the requirement's §13. The formal requirement is [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md). |
| 2026-09-30 | User answers revised (round 2) | §7: Q-1 resolved by the credit deduction work (credits, $0.002 each / 500 per $1); Q-4 packages $10 +5% / $25 +20% / $50 +30%; Q-8 tax-exclusive pricing, USA (currency options in requirement §10, choice pending); Q-12 $150 per rolling 30 days confirmed, count cap dropped. Overview update note; §2.1, R-16/R-17/R-18/R-20, HZ-2, §5 and §10 annotated with the credit deduction work (ledger live, `credits.allowance`, slices 6/9–11); new U-8. §1–§4 otherwise kept as the 2026-09-27 record. |
| 2026-09-30 | User answers revised (round 3); requirement Ready for SA review | §7: Q-4 final packages "Option A" (Starter $10 / 5,000 / no bonus; Plus $25 "Most popular" / +10% / 13,750; Max $50 "Best value" / +15% / 28,750; Max below the 70% markup target accepted; the shown bonus is computed, not typed). Q-8 final: USD only; tax via the simplest switchable mechanism, with the accountant's confirmation as a pre-launch dependency. Q-12 unchanged. §5 and §10 notes, new U-9 (Stripe fee assumption). Status now points to the requirement being Ready for SA review. |
