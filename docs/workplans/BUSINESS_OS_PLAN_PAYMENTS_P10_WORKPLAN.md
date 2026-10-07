# Workplan: Business OS Plan Payments, P-10 (Retire the rest of the Pilot-Credit purchase path, WS-3)

> **Last Updated**: 2026-10-06

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §9.1 P-10, §9.4 CF-3, §10.1 BQ-P8, SA-P5 (`billing_events` shape), SR-10. Reuse plan [BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md](/docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md): §4.6, §4.6b, TK-2, TK-3, TK-5, TK-6, RD-2, RD-9, RD-12, RD-15, RD-16, F-7, F-16 to F-20, F-28, L-7, L-9, L-23, L-26, L-33, L-35. Credits Boost [requirement](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md): FR-40, T-11, R-7.
**Depends on:** P-1 merged (#188, done). `billing_events` live shape answered by the user on 2026-10-04 (C-4, done, §1.3).
**Prior slices read:** [P-0](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P0_WORKPLAN.md) (Connect characterisation harness, AST check), [P-1](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P1_WORKPLAN.md) (router, deny by default, what P-1 removed, SA Q-1), [Payment tables lockdown](/docs/workplans/PAYMENT_TABLES_WRITE_LOCKDOWN_WORKPLAN.md) (grant revoke pattern).
**Date:** 2026-10-05
**Branch:** `feature/bos-plan-payments-p10` (worktree `neuronforge-invite-s1`), on `origin/main` `f9448054`, **rebased 2026-10-06 onto `origin/main` `4c1b630a`** (§16.9). Created by RM at kickoff. **P-10b:** `feature/bos-plan-payments-p10b` from `origin/main` `49c2e001` (after #234 merged), same worktree (§16b). **Follow-up:** `fix/boost-packs-revoke-browser-select` from `origin/main` `248de6be` (migration 20261039).
**Status:** **P-10a merged** (PR #234, merge `49c2e001`, 2026-10-06; migration 20261038). **P-10b merged** (PR #238, merge `248de6be`, 2026-10-06). Follow-up migration 20261039 (browser SELECT on `boost_packs` revoked, B-4 / SA Q-7) written, pending review and manual apply. Evidence: [§16](#16-p-10a-implementation-and-evidence-log), [§16b](#16b-p-10b-implementation-and-evidence-log).

## Overview

P-1 closed the money hazard: no platform invoice is converted into Pilot Credits any more, and the credit-subscription checkout and the upgrade route return 410. P-10 is the clean-up the reuse plan calls WS-3. It removes what is left of the Pilot-Credit purchase path (§4.6 *Dies*), keeps everything on the *Survives* list exactly as it is, and implements the *Guarded* items. The guarded items are the free-tier freeze trap (TK-3, decided by BQ-P8: the freeze job stays off for good) and the agent-platform boost checkout (TK-5, decided by the Credits Boost requirement FR-40: switched off, not deleted). It also closes `sync-subscription` (CF-3), the last route that still turns Stripe metadata into credits, and adds one small migration that removes the browser's table grants from four purchase-path tables that no browser code uses.

The work is split in two PRs so each stays small and reviewable:

| PR | Scope | Size |
|---|---|---|
| **P-10a** | Server: webhook, `StripeService`, `CreditService` stubs, `sync-subscription`, `create-checkout`, the freeze job (TK-3), boost switch-off (TK-5), RD-2 read guard (TK-6), migration **20261038** | 1.5 to 2 days |
| **P-10b** | Agent-platform billing UI (F-19, F-20, L-33, L-35): dead files deleted, `/v2/billing` redirected, the buy flow removed from `BillingSettings` | 1 to 1.5 days |

P-10b depends on P-10a (the UI stops calling routes that P-10a turns into 410s). Neither touches Connect.

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Confirmed inventory (TK-2)](#2-confirmed-inventory-tk-2)
3. [Design decisions](#3-design-decisions)
4. [What must keep working](#4-what-must-keep-working)
5. [The migration (20261038)](#5-the-migration-20261038)
6. [Files to create / modify / delete](#6-files-to-create--modify--delete)
7. [Task list](#7-task-list)
8. [Test plan](#8-test-plan)
9. [Tenant isolation](#9-tenant-isolation)
10. [Risks](#10-risks)
11. [Rollback](#11-rollback)
12. [Demo](#12-demo)
13. [Sizing](#13-sizing)
14. [Questions for SA](#14-questions-for-sa)
15. [Coordination](#15-coordination)
16. [P-10a implementation and evidence log](#16-p-10a-implementation-and-evidence-log)
    - 16b. [P-10b implementation and evidence log](#16b-p-10b-implementation-and-evidence-log)
17. [SA Review](#sa-review)
18. [QA Testing Report](#qa-testing-report)
19. [Commit Info](#commit-info)
20. [Change History](#change-history)

---

## 1. Analysis summary

Line numbers are on `f9448054`.

### 1.1 Where P-1 left things

| Fact | Evidence |
|---|---|
| Every platform `invoice.paid` and `invoice.payment_failed` is decided by the Business OS router (flow or deny) before the `switch`. `handleInvoicePaid` is gone | `app/api/stripe/webhook/route.ts:50-57` (removal note), `:2347-2381` (router) |
| `handleInvoicePaymentFailed` (agent-platform dunning) is still in the file and still called from the `switch` arm, but that arm is unreachable for platform invoices (SA Q-1: kept, not deleted) | `route.ts:66-168`, `:2396-2404` |
| The subscription-mode branch of `handleCheckoutCompleted` is a defensive `error` log only; the **boost-pack branch is live** | `route.ts:185-306` (boost), `:308-317` (defensive log) |
| `handleSubscriptionUpdated` still converts `subscription.metadata.credits` into `monthly_credits` / `monthly_amount_usd`, inserts `billing_events`, and calls `QuotaAllocationService` | `route.ts:326-395`, called at `:2453-2456` (platform only) |
| `handleSubscriptionDeleted` mirrors `status: 'canceled'` on `user_subscriptions`, keyed on `subscription.metadata.user_id` | `route.ts:2110-2141`, called at `:2458-2472` |
| `create-checkout`: `custom_credits` returns 410; **`boost_pack` still creates a Stripe checkout** | `app/api/stripe/create-checkout/route.ts:66-76` (410), `:77-131` (boost) |
| `update-subscription` already returns 410 after auth | `app/api/stripe/update-subscription/route.ts` (65 lines) |
| **`sync-subscription` is a live, user-callable credit path** (CF-3): it lists the caller's Stripe subscriptions, reads `metadata.credits`, writes `balance`, `monthly_credits`, clears `account_frozen` / `free_tier_expires_at`, inserts a `subscription_renewal` credit row and a `billing_events` row, and calls `QuotaAllocationService` | `app/api/stripe/sync-subscription/route.ts:53-262` |
| `StripeService.createCustomCreditSubscription` and `updateSubscriptionAmount` mint ad-hoc prices (`prices.create`) and have **no caller left** | `lib/stripe/StripeService.ts:170-262` (`:212`), `:364-427` (`:389`); grep: only tests mention the first, nothing mentions the second |
| `CreditService.createSubscription`, `updateSubscription`, `purchaseBoostPack` are stubs that only `throw`, with **no caller** | `lib/services/CreditService.ts:124-150`; grep |

### 1.2 The freeze trap today (TK-3)

| Fact | Evidence |
|---|---|
| The **only code that ever sets `account_frozen = true`** is the free-tier expiry job. It also zeroes the balance | `app/api/cron/check-free-tier-expiration/route.ts:76-85`; grep of `app/ lib/ components/ supabase/` (two dev scripts aside: `scripts/test-free-tier-expiration.sql:55` is commented out, `scripts/test-free-tier-ui.ts:99` is a manual test tool) |
| It is not scheduled. `vercel.json` lists the 13 Business OS jobs only, and `lib/cron/__tests__/vercelCrons.test.ts` pins exactly those 13 | `vercel.json:3-57`; `vercelCrons.test.ts:61` |
| An S-0 guard already fails CI if the path is scheduled **without** a Business OS exclusion; it still allows "scheduled with an exclusion" | `app/api/cron/__tests__/freeTierExpiration.rd9.guard.test.ts:80-99` |
| Readers that act on `account_frozen = true`: `CreditService.checkExecutionAllowed` (from `run-agent`), `generate-agent` (403), the agent run page, the V2 footer, `onboarding/get-allocation` (display) | `CreditService.ts:388-438`, `app/api/run-agent/route.ts:109`; `app/api/generate-agent/route.ts:89-102`; `app/v2/agents/[id]/run/page.tsx:428-436`; `components/v2/Footer.tsx:127-133`; `app/api/onboarding/get-allocation/route.ts:37,79-81` |
| Readers of `free_tier_expires_at` only display it (no blocking): user menu, V2 billing, get-allocation, `checkExecutionAllowed` passes it back in its reply | `components/v2/UserMenu.tsx:61-62,151`; `BillingSettingsV2_NEW.tsx:1052-1330`; `CreditService.ts:424` |
| None of these readers is a Business OS surface. No file under `app/api/business-os`, `app/business-os`, `lib/business-os` or `components/business-os` calls `.from('user_subscriptions')`, `credit_transactions`, `billing_events`, `UserSubscriptionRepository` or `CreditService` | grep (only deletion and purge registries name the tables, as strings) |

### 1.3 `billing_events`, live (user, production, 2026-10-04)

| Fact | Consequence |
|---|---|
| Columns: `id`, `user_id`, `event_type`, `event_source`, `stripe_event_id`, `subscription_id`, `transaction_id`, `amount_usd`, `credits_amount`, `status`, `error_message`, `payload`, `processed_at`, `created_at`, `amount_cents` | Every writer in the code sends at least one column that **does not exist**: `credits_delta`, `description`, `stripe_invoice_id`, `currency`, `metadata` (webhook `:117-128`, `:364-372`, `:2131-2138`; `sync-subscription:223-232`; `CreditService.ts:74,291,317,339`). PostgREST rejects the whole insert and no caller checks the error |
| **Zero rows** | Consistent with the above: no write has ever landed in production. Deleting writers loses nothing; the table's history is empty |
| Policies: "Service role can manage billing events" (ALL, `auth.jwt()->>'role' = 'service_role'`); "Users can view own billing events" (SELECT, `auth.uid() = user_id`) | Policies are correct |
| **`anon` and `authenticated` hold DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE** | The Supabase default set. RLS still blocks rows, but `TRUNCATE` is **not subject to RLS**: any holder of the anon key can empty the table. Empty today, but the grant is wrong on a money table. No browser code reads or writes `billing_events` (grep) |

### 1.4 Already closed before P-10

| Item | Evidence |
|---|---|
| **TK-6 / F-28** (Business OS usage route read `user_subscriptions`) | `app/api/business-os/usage/route.ts:42-48` imports only `getUser`, `readOwnerCreditUsage`, the logger and the auth client; no Pilot-Credit table (commits `8f394409`, `0e3815a2`). P-10 adds the guard that keeps it closed (§3.6) |
| **L-2 / Q-T8** (customer helper split) | P-2a: `StripeService.findOrCreatePlatformCustomer` (`StripeService.ts:64`), used by `lib/business-os/billing/businessOsStripeCustomer.ts:106`. `getOrCreateCustomer` keeps the `user_subscriptions` seed for the agent platform |

---

## 2. Confirmed inventory (TK-2)

Each row of reuse plan §4.6 checked against `f9448054`. "P-10 action" is what this slice does.

### 2.1 Dies

| §4.6 item | Where it is now | P-10 action | PR |
|---|---|---|---|
| Ad-hoc price minting, L-9 | `StripeService.ts:212` inside `createCustomCreditSubscription` (`:160-262`); `:389` inside `updateSubscriptionAmount` (`:355-427`). No caller of either | **Delete both methods** and their doc comments | a |
| `updateSubscriptionAmount` | as above | **Delete** | a |
| Credit conversion in `handleInvoicePaid`, first-subscription fallback, L-13/L-14/L-24 | Gone (P-1) | Nothing. Guard `routerPlacement.guard.test.ts` keeps it gone | — |
| L-15 description heuristic | Gone with `handleInvoicePaid` (P-1) | Nothing | — |
| `create-checkout` `custom_credits` branch | 410 since P-1 | Folded into the whole-route 410 (§3.4) | a |
| `update-subscription` | 410 since P-1 | Unchanged (410 stub stays, see §3.3) | — |
| `sync-subscription` credit reconciliation, L-7 (CF-3) | `sync-subscription/route.ts:53-262` | **Body deleted; route becomes auth then 410** (§3.3) | a |
| Six `QuotaAllocationService` billing-path calls, L-26 | P-1 removed 3. Left: webhook boost branch `:294`, webhook `handleSubscriptionUpdated` `:377`, `sync-subscription:239-241` | **Remove `:377` and `sync-subscription`'s**. The boost-branch call stays because FR-40 keeps that branch as-is (§3.4, SA Q-2) | a |
| Credit-subscription sync in `handleSubscriptionUpdated` (the webhook twin of `updateSubscriptionAmount`) | `route.ts:326-395`: `monthly_credits`, `monthly_amount_usd`, `billing_events` insert, quota call | **Remove those three effects**; keep the status mirror (§3.2) | a |
| Credit-purchase UI: `/v2/billing`, `BillingSettings` buy flow, L-33 | `app/v2/billing/page.tsx` → `BillingSettingsV2_NEW.tsx` (1,727 lines); `components/settings/BillingSettings.tsx` (2,004 lines) in `/settings` → Billing | `/v2/billing` → redirect; `BillingSettingsV2_NEW` and its two private components deleted; buy flow removed from `BillingSettings` (§3.7) | b |
| Dead UI files, L-35 / F-19 / F-20 | `components/settings/PlanManagementTab.tsx` (0 importers), `components/v2/settings/BillingSettingsV2.tsx` + `.css` (0 importers), `app/v2/billing/page.tsx.bak`, `components/v2/billing/StorageUsageV2.tsx` (0 importers) | **Delete** | b |
| `credit_transactions` `subscription_renewal` / `subscription_upgrade` writes | Only writer left: `sync-subscription:210` (`update-subscription` already 410) | Gone with the `sync-subscription` body. Existing rows stay | a |
| `CreditService` purchase paths, L-23 | `CreditService.ts:124-150`: three throwing stubs, no caller | **Delete the three stubs** (SA Q-3) | a |
| Agent-platform boost-pack checkout, TK-5 | `create-checkout:77-131` → `StripeService.createBoostPackCheckout` (`:264-341`) | **Moved to *Guarded* by FR-40** (§3.4): switched off, not deleted | a |

### 2.2 Survives untouched

| §4.6 item | Confirmed where | Note |
|---|---|---|
| `user_subscriptions` table | Many readers (run-agent, generate-agent, onboarding, V2 header/footer, admin) | No DDL in P-10 |
| Signup grant | `lib/services/FreeTierGrantService.ts`, `app/api/onboarding/allocate-free-tier` | Not touched. Still uses `pilotCreditsToTokens` |
| `account_frozen` and its readers | §1.2 | Not touched; made safe by having no writer (§3.5) |
| `free_tier_expires_at` | §1.2 | Not touched; semantics unchanged (TK-3 option "permanent RD-9") |
| `credit_transactions` history | — | No rows changed |
| **All of Connect**: `handleConnect*`, `recordPlanPeriodPaid`, `handleConnectPlanSubscriptionCreated`, `accountOwns`, `handlePlanSubscriptionEnded`, `handleDispute`, `handleChargeRefunded`, `StripeService.ts:490-850`, `lib/stripe/StripeInvoiceService.ts` (§4.6b) | `route.ts:436-2104` | Byte-identical, proven by harness + function-text check (§8.2) |
| `getOrCreateCustomer` / `findOrCreatePlatformCustomer` | `StripeService.ts:64-158` | Not touched |
| Webhook envelope (dual secret, claim / release, `completeClaim`) | `route.ts:2147-2310` | Not touched |
| `billing_events`, `processed_webhook_events`, `boost_packs` tables | — | Kept. Only browser grants change (§5) |
| `payment_grace_period_days` + `handleInvoicePaymentFailed` (RD-16, SA Q-1) | `route.ts:66-168` | Not touched; still unreachable for platform invoices |
| `checkExecutionAllowed` incl. its fail-open (F-15) | `CreditService.ts:388-438` | Not touched |
| Portal, invoices, session status, cancel, reactivate routes (L-4, L-5, L-6) | `app/api/stripe/{create-portal,invoices,session-status,cancel-subscription,reactivate-subscription}` | Not touched (they keep working for the agent platform's four test subscriptions until TK-1 cancels them) |
| `pricingConfig` (L-24 "purchase side only") | `lib/utils/pricingConfig.ts` | **Nothing purchase-only is in it.** `pilotCreditsToTokens` is used by the signup grant and the kept boost branch; `tokensToPilotCredits` by the pilot, intensity and onboarding services. Not touched |
| `QuotaAllocationService` (L-26 "whether the service goes") | `lib/services/QuotaAllocationService.ts` | **Stays**: called by the FR-40-kept boost branch and three maintenance scripts (`scripts/fix-duplicate-credits.ts`, `reallocate-all-quotas.ts`, `reallocate-quotas-by-monthly.ts`) |
| `handleSubscriptionDeleted` | `route.ts:2110-2141` | Not touched (lifecycle mirror, not a purchase). Its `billing_events` insert never lands (§1.3); left as it is to keep the diff to *Dies* items |

### 2.3 Must be replaced or guarded

| Item | P-10 action |
|---|---|
| `check-free-tier-expiration` (TK-3, RD-9, BQ-P8) | Permanently off, made inert, recorded in the cron registry (§3.5) |
| Agent-platform boost-pack checkout (TK-5 via FR-40, R-7) | Checkout 410; packs set inactive as a recorded data change; webhook branch kept for in-flight sessions (§3.4) |
| `app/api/business-os/usage/route.ts` (TK-6, F-28) | Already clean; a guard keeps the whole Business OS tree off the Pilot-Credit tables (§3.6) |
| `checkExecutionAllowed` fail-open (F-15) | Unchanged; nothing in Business OS copies it (confirmed: no Business OS import of `CreditService`) |

### 2.4 Found by TK-2, not in §4.6

| Item | Disposition |
|---|---|
| `billing_events` writers all send non-existent columns (§1.3) | Recorded. The writers P-10 deletes lose nothing; the survivors (`handleInvoicePaymentFailed`, `handleSubscriptionDeleted`, `CreditService`) are left alone (RD-16) and flagged as follow-up F-1 |
| Browser grants on purchase-path tables (`billing_events` measured; `boost_pack_purchases`, `subscription_invoices`, `processed_webhook_events` by inference from the same Supabase default) | Migration 20261038 (§5) |
| `components/billing/PilotCreditCalculator.tsx` | Used by the marketing landing page `app/page.tsx`; takes no money and calls no route. **Out of scope**, noted |
| Help texts naming `/v2/billing` and "add more credits" (`components/v2/HelpBot.tsx:26`, `ModernHelpDialog.tsx:59,79`, `app/api/help-bot-v2/route.ts:534`) | Left: `/v2/billing` keeps resolving through the redirect. Rewording would pull 35 `console.*` conversions into P-10 for text on a parked product. Follow-up F-2 |
| Migration number collision: plan-payments reserved **20261026** for P-3b, but `main` already has `20261026_business_os_credit_charges_activity_indexes.sql` | Not P-10's to fix. Reported to TL (§15); P-3b needs a new number |

---

## 3. Design decisions

### 3.1 Webhook: what changes, what does not

Only `handleSubscriptionUpdated` changes, plus comment text that names TK-5. No Connect function, no envelope code, no router code is edited.

### 3.2 `handleSubscriptionUpdated`: same events, fewer effects

Today (`route.ts:326-395`) it requires `metadata.user_id` and `metadata.credits` (or `pilot_credits`), then writes `monthly_credits`, `monthly_amount_usd`, `cancel_at_period_end`, `canceled_at`, `status`; inserts a `billing_events` row; calls `QuotaAllocationService`.

After P-10:
- **The early returns stay exactly as they are** (both `user_id` and credits metadata required). So it runs for the same events as today, and never for a Business OS plan subscription (P-3a writes no legacy metadata, CF-4; and the router denies a known plan price that carries it).
- It writes only `cancel_at_period_end`, `canceled_at`, `status`. `monthly_credits` and `monthly_amount_usd` go (credit amount change, *Dies*). The `billing_events` insert goes (never landed, §1.3). The quota call goes (L-26).
- Why keep the status mirror: the portal (L-4) and cancel/reactivate (L-6) survive, and the four agent-platform test subscriptions still exist until TK-1 cancels them. Without the mirror, a cancellation made in the Stripe portal would not reach `user_subscriptions`. It is lifecycle, not purchase.
- Platform only, as today (`case 'customer.subscription.updated': if (isConnectEvent) break;`).

P-6a will later recognise Business OS `subscription.updated` events in the router before the `switch`; this function is untouched by that.

### 3.3 Retired routes become 410 stubs, not deleted files

`sync-subscription` follows the P-1 pattern for `update-subscription`: authenticate (401 unchanged), then **410** `{ success: false, error: 'Credit subscriptions are no longer sold' }`, logged at `warn` (`stripe_sync_subscription_refused`, `userId`). No Stripe client, no Supabase admin client, no audit. The 19 `console.*` calls go with the body; the stub uses Pino.

Why a stub and not a deletion: the parked UI calls it automatically after a checkout and from a "sync" button (`BillingSettings.tsx:170,563`, `BillingSettingsV2_NEW.tsx:208,577`). A 410 with a message is clearer than a 404 for anything still calling it, and it matches `update-subscription`. After P-10b no first-party caller is left; deleting the three stubs is a one-line follow-up whenever SA prefers (SA Q-4).

### 3.4 TK-5: the boost checkout is switched off, not deleted

The reuse plan left TK-5 open. The Credits Boost requirement decided it with the user on 2026-09-27 (Q14, FR-40, T-11) and ruled the hand-off (R-7): **whichever of boost slice 7 and P-10 lands first owns it; if P-10, the boost checkout sits on P-10's *Guarded* list, not *Dies*, and slice 7 becomes verify-only.** P-10 is first (slice 7 has not started; boost is on slice 2). So P-10 implements FR-40 exactly:

| FR-40 / T-11 part | P-10 |
|---|---|
| Server refuses new boost purchases with a logged 410 | `create-checkout`: after auth, **every** body returns 410 (`stripe_checkout_refused`, `warn`, `purchaseType` logged). Zod parse stays so an invalid body is still 400 (rule 2). No Stripe call, no profile read, no audit |
| Packs set inactive as a recorded, reversible data change | Hand-run SQL step in the apply guide (§5.5), previous values captured into this workplan first. Not in the migration (data, not schema) |
| UI no longer offers them | P-10b removes the boost UI anyway; the inactive flag covers the window between P-10a and P-10b |
| Webhook `boost_pack` branch left as-is so in-flight sessions complete | `route.ts:185-306` **not touched**, including its `QuotaAllocationService` call. Proven by the harness scenario P6 staying identical |
| Code, tables (`boost_packs`, `boost_pack_purchases`) and history kept | `StripeService.createBoostPackCheckout` and `getOrCreateCustomer` stay, with no caller. A comment at the method says why (FR-40) |

**The 410 is the real guard; `is_active = false` is display only (SA C-8).** The admin AgentsPilot billing page (`app/api/admin/boost-packs`, service role behind `requireAdmin`) can still flip a pack's `is_active` back on. That only makes the pack visible again in the parked UI; any purchase attempt still gets the 410 from `create-checkout`. No code change.

### 3.5 TK-3: the freeze job stays off permanently (BQ-P8), and nothing can freeze an account

BQ-P8 chose "permanent RD-9" over "replace the field's semantics". So `free_tier_expires_at` keeps its meaning and nothing reads it to block. What makes RD-15 hold is that **no code path can set `account_frozen = true`**:

1. **Route made inert.** `app/api/cron/check-free-tier-expiration/route.ts` keeps its `CRON_SECRET` check (401 unchanged), then returns **410** `{ success: false, error: 'Permanently disabled' }` with an `error` + `alert: true` log (`free_tier_expiration_disabled`), because anything calling it means someone scheduled it. No Supabase client is created. The freezing body is deleted (it is in git history; BQ-P8 says it never runs again). The file is kept, not deleted, so whoever looks for the job at its path finds the decision there (SA Q-5).
2. **Recorded where the cron list is.** `vercel.json` cannot hold a comment. The cron registry `lib/cron/bosCronJobs.ts` is the declared single source for scheduled jobs and is pinned to `vercel.json` by `vercelCrons.test.ts`. P-10 adds a data-only export there, `PERMANENTLY_UNSCHEDULED_CRONS`, with this one entry (`path`, `reason` = BQ-P8 / RD-9 / F-17 in plain words, `decidedOn: '2026-10-02'`). The file stays import-free (SA SC-8). `vercelCrons.test.ts` gains: no path in that list may appear in `vercel.json`, and the failure message names the reason.
3. **The S-0 guard tightened.** `freeTierExpiration.rd9.guard.test.ts` currently accepts "scheduled with a Business OS exclusion". BQ-P8 removes that option: the suite now asserts unscheduled, full stop, and that the route source contains no `account_frozen: true` and no `.update(`. Its negative control stays.
4. **No other writer, enforced.** New source guard `lib/__tests__/accountFrozenWriters.guard.test.ts`: in `app/`, `lib/`, `components/` (tests excluded), no `account_frozen: true` and no `account_frozen = true`. The two dev scripts under `scripts/` are named in the test as known, manual-only tools.
5. **Measured in production (read-only, pre-check Q-7).** Count of `user_subscriptions` rows with `account_frozen = true`, and how many of those have a Business OS plan row. Expected 0 and 0. If any Business OS account is frozen, the user decides on a one-row correction; P-10 does not write it.

Readers of `account_frozen` (`generate-agent`, `checkExecutionAllowed`, run page, footer, get-allocation) are **not changed** (RD-16, and they are all agent-platform). With no writer, they can only ever read `false` or `null` for an account that was not frozen before P-10, which (5) proves for every Business OS account.

### 3.6 TK-6: a guard so the read-side leak cannot come back

New `lib/business-os/__tests__/noPilotCreditTableReads.guard.test.ts`: no non-test file under `app/api/business-os/`, `app/business-os/`, `lib/business-os/`, `components/business-os/` calls `.from('user_subscriptions' | 'credit_transactions' | 'billing_events' | 'boost_pack_purchases' | 'subscription_invoices')`, or imports `UserSubscriptionRepository` or `CreditService`. The deletion and purge registries (`lib/business-os/account/accountDeletionPolicy.ts`, `lib/business-os/purge/descriptors.ts`) name these tables as strings, not through `.from(`, so they pass unchanged. Negative control included. This is the RD-2 read side, enforceable by grep, as the reuse plan asks.

### 3.7 UI (P-10b)

| File | Action | Why |
|---|---|---|
| `components/settings/PlanManagementTab.tsx` | delete | F-19: 0 importers, fake data |
| `components/v2/settings/BillingSettingsV2.tsx`, `BillingSettingsV2.css` | delete | 0 importers (F-20 listed it as live; it is not) |
| `app/v2/billing/page.tsx.bak` | delete | F-20 |
| `components/v2/billing/StorageUsageV2.tsx` | delete | 0 importers |
| `app/v2/billing/page.tsx` | replace with a server `redirect('/settings?tab=billing')` | Keeps the six inbound links (dashboard `:775`, run page `:1035`, user menu `:180`, help texts) working without touching those files. `/settings` already honours `?tab=` (`app/(protected)/settings/page.tsx:28-30,82-87`) |
| `components/v2/settings/BillingSettingsV2_NEW.tsx`, `components/v2/billing/ModalsV2.tsx`, `StatsCardsV2.tsx` | delete | Only importer is the `/v2/billing` page above |
| `components/settings/BillingSettings.tsx` | **reduce**: remove the buy flow (custom-credit slider and purchase, upgrade, boost-pack list and purchase, embedded Stripe checkout and its script, the two `sync-subscription` calls, the `boost_packs` browser read). Keep balance, credit history, usage analytics, invoices, portal, cancel and reactivate | L-33 "reduce to read-only history". Those surviving routes still serve the agent platform. Removes the browser read of `boost_packs` (V-14) |

`BillingSettings.tsx` has **69 `console.*` calls**. Per CLAUDE.md § Logging, P-10b flags this to the user and proposes converting the reduced file to `createLogger` (as other client components do, e.g. `components/business-os/CreditHistoryPanel.tsx`). Many of the 69 go with the deleted buy flow. Alternative if SA prefers a smaller P-10b: delete `BillingSettings` and render `UsageAnalytics` plus a portal link in the Billing tab instead (SA Q-6).

---

## 4. What must keep working

| Must keep working | How it is shown |
|---|---|
| **Connect (client) payments**, SR-10 | P-0 harness: the 17 Connect snapshot entries (1a to 9c) byte-identical before and after, SHA-256 recorded (as P-0 P0-C2 and P-1 E.2). Function-text equality of every Connect function against `f9448054` (§8.2) |
| Boost-pack sessions already open at Stripe when P-10a deploys complete normally (FR-40) | Harness P6 identical; `handleCheckoutCompleted` function text identical |
| The P-1 router (deny by default) | Harness P1 to P7 identical; `routerPlacement.guard.test.ts` green |
| Agent platform: signup grant, `run-agent` gating, `generate-agent`, portal, invoices, cancel, reactivate, session status, dunning code kept | Not touched (§2.2); existing tests green; `stripeAuditEntries.test.ts` green for portal/cancel/reactivate |
| Agent-platform subscription status mirror (portal cancel → `user_subscriptions`) | New harness scenario P10-1 (§8.2) |
| Business OS plan flow (P-2a customer helper, router catalog) | `lib/business-os/billing` suites green; no file in it is edited |
| Webhook writes to `processed_webhook_events` and `billing_events` as `service_role` after the migration | Migration revokes from `anon` and `authenticated` only; the checker asserts `service_role` keeps its privileges (§5.3) |

---

## 5. The migration (20261038)

### 5.1 Number

**20261038** (`supabase/migrations/20261038_purchase_path_tables_client_grants.sql`). **Renumbered 2026-10-06:** the branch was rebased on `origin/main` `4c1b630a`, which already holds `20261036_business_addresses_book.sql` and `20261037_business_addresses_ownership_fk.sql` (address book, PR #229). 20261038 was checked free on `main` and on every remote branch the same day. The original check below is kept as written.

*As written 2026-10-05:* **20261036** (`supabase/migrations/20261036_purchase_path_tables_client_grants.sql`). Checked on 2026-10-05: on `main` and every remote branch and local worktree, the highest used numbers are 20261026 (credit deduction, not P-3b), 20261030 (boost, worktree), 20261035 (admin delete). 20261036 is free everywhere. I did **not** take 20261029 (payments' spare): P-3b's reserved 20261026 is already taken on `main` (§2.4), so the payments block will need its spare. Recorded with the other sessions per G-11 (§15).

### 5.2 Scope

| Table | Measured | Client use in code | Revoke from `anon` | Revoke from `authenticated` |
|---|---|---|---|---|
| `billing_events` | Yes (§1.3): all seven privileges for both roles | None | ALL | ALL |
| `boost_pack_purchases` | No (pre-check measures) | None (only the service-role webhook `route.ts:260`) | ALL | ALL |
| `subscription_invoices` | No | None at all (its only writer was `handleInvoicePaid`, removed by P-1) | ALL | ALL |
| `processed_webhook_events` | No | None (service-role webhook only) | ALL | ALL |
| `boost_packs` (SA Q-7) | No | **Browser SELECT** in `BillingSettings.tsx:302` and `BillingSettingsV2_NEW.tsx:378` until P-10b; writes only via the service-role admin route | writes only (keep SELECT) | writes only (keep SELECT) |

"ALL" includes SELECT. No browser reads these four tables, so the owner SELECT policy on `billing_events` stops mattering; any future owner-facing history goes through a server repository (rule 1). `service_role` and the owner are never named. Policies and RLS are not changed. REVOKE of a privilege not held is a no-op, so the file is safe whatever the unmeasured grants are.

### 5.3 Files and SQL rules

The user's rules for anything pasted in the Supabase SQL editor apply to all four files: **no `--` comments, no punctuation inside string literals, never the word "into", one REVOKE statement per table and role.** Documentation lives in this workplan and the apply guide, not in the SQL.

| File | Content |
|---|---|
| `scripts/precheck-purchase-path-tables-grants.sql` | Read-only (`SET default_transaction_read_only = on`). Q-1 each table exists, RLS on, FORCE RLS off. Q-2 every grant on the five tables from `information_schema.role_table_grants` for `anon`, `authenticated`, `service_role`, `PUBLIC`. Q-3 column-level grants for `anon`/`authenticated` (expect none). Q-4 policies with `qual`, `with_check`, `roles` (backup). Q-5 row counts. Q-6 `boost_packs` id, name, `is_active` (TK-5 previous values). Q-7 frozen accounts: total, and those with a `business_os_account_plans` row (TK-3). Each query is a separate statement so the editor shows its result |
| `supabase/migrations/20261038_purchase_path_tables_client_grants.sql` | `BEGIN;` then 10 statements of the form `REVOKE ALL ON TABLE public.billing_events FROM anon;` (four tables × two roles), then 2 for `boost_packs` (`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.boost_packs FROM anon;` and the same for `authenticated`), then `COMMIT;`. Nothing else |
| `scripts/check-purchase-path-tables-grants-migration.sql` | Read-only. One result set, columns `check_name`, `result` (`PASS`/`FAIL`), `detail`, then a `VERDICT` row (`PASS` only if every row passes). Checks: for each of the four tables and both roles, `has_table_privilege` false for SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER (counts PUBLIC inheritance); `boost_packs` both roles SELECT true and the six write privileges false; no column-level grant to `anon`/`authenticated` on the five tables; RLS still on for all five; policy count per table equal to the pre-check (literal numbers filled in from the pre-check output before running); `service_role` still holds SELECT, INSERT, UPDATE on `processed_webhook_events`, INSERT on `billing_events` and `boost_pack_purchases`, SELECT on `boost_packs` |
| `supabase/SQL Scripts/20261038_purchase_path_tables_client_grants_rollback.sql` | `BEGIN;` separate `GRANT ... TO anon;` / `TO authenticated;` statements restoring what pre-check Q-2 showed (written out for the measured default set; trim to Q-2 before use), `COMMIT;` |

### 5.4 Static test

`supabase/migrations/__tests__/purchase-path-tables-client-grants.migration.test.ts`: the migration has exactly the 12 REVOKE statements and nothing else between `BEGIN` and `COMMIT`; never names `service_role`, `PUBLIC` or `postgres`; no `GRANT`, `DROP`, `ALTER`, `CREATE`; no `--`; no `into` (case-insensitive) in any of the four files; no punctuation inside string literals in the checker and pre-check; rollback grants only to `anon` and `authenticated`; pre-check and checker start with the read-only `SET`; checker ends with a `VERDICT` row.

### 5.5 Apply guide (user, production, by hand)

1. Run the pre-check. **Save Q-2, Q-4 and Q-6 output into §5.6 of this workplan before step 2** (Q-4 is the policy backup; Q-6 is the TK-5 "previous values"). If any table is missing, RLS is off, FORCE RLS is on, or a privilege shows grantee `PUBLIC`, stop and send the output to Dev (RC-4 lesson: never run a `FROM PUBLIC` remedy blind).
2. Run the migration. It commits or fails as a whole.
3. Fill the policy counts from Q-4 into the checker and run it. Expect `VERDICT PASS`.
4. **TK-5 data step** (only after P-10a is deployed, so no new boost checkout can start): `UPDATE public.boost_packs SET is_active = false WHERE is_active = true;` then re-run pre-check Q-6. Reverse: `UPDATE public.boost_packs SET is_active = true WHERE id IN (...)` with the ids saved in step 1.
5. Watch for 24 h: a webhook `error` mentioning `permission denied` on any of these tables means a missed writer on a non-service client (none found by grep). Rollback per §11.

The migration is safe before or after the code deploys: no code path uses these grants.

### 5.6 Captured outputs

✅ Pre-check Q-2, Q-4, Q-6, Q-7 (user). **Q-7 is a merge gate for P-10a (SA C-1): both counts recorded here before RM merges; a non-zero Business OS count stops the merge.** Q-6 (boost pack ids and `is_active`) must be saved here before the TK-5 data step.

Recorded 2026-10-06 13:16 UTC (user ran the pre-check on production):

| Item | Result |
|---|---|
| Q-1 | All five tables exist. RLS on for `billing_events`, `boost_pack_purchases`, `subscription_invoices`, `boost_packs`; **RLS OFF for `processed_webhook_events`**; FORCE RLS off on all |
| Q-2 | `anon` and `authenticated` hold DELETE INSERT MAINTAIN REFERENCES SELECT TRIGGER TRUNCATE UPDATE on all five tables; `service_role` the same; `PUBLIC` none. With RLS off, `processed_webhook_events` was readable and writable by anyone holding the anon key until 20261038 |
| Q-3 | 0 column grants to anon or authenticated on all five |
| Q-4 | Policy counts: `billing_events` 2, `boost_pack_purchases` 2, `subscription_invoices` 1, `processed_webhook_events` 0, `boost_packs` 2 (copied into the checker's C5 list) |
| Q-5 | Rows: `billing_events` 0, `boost_pack_purchases` 2, `subscription_invoices` 0, `processed_webhook_events` 1191, `boost_packs` 3 |
| Q-6 | 3 active packs: `boost_mega` da24fc50-3885-4a0a-b130-2f21e4f1c833, `boost_power` 1ec1694f-8622-4917-993e-e132fb427fd4, `boost_quick` 24528d97-bab2-4068-95bc-f87e52eccb1b, all `is_active = true` (the reversal list for the TK-5 step) |
| **Q-7** | **Frozen accounts 0; frozen Business OS accounts 0. Merge gate PASSES** |
| DB writers (`check-billing-events-db-writers.sql`, 13:16:49 UTC) | Table exists; 0 triggers; 0 functions mention `billing_events` |

⬜ Checker output (user, after apply; C5 policy counts filled from Q-4 on 2026-10-06).
⬜ TK-5 data step done after P-10a deploy, Q-6 re-run (user).

---

## 6. Files to create / modify / delete

### P-10a

| File | Action | Reason |
|---|---|---|
| `app/api/stripe/webhook/route.ts` | modify | `handleSubscriptionUpdated` reduced to the status mirror (§3.2); TK-5 comments updated. Nothing else |
| `app/api/stripe/sync-subscription/route.ts` | modify | Auth then 410, Pino, body deleted (§3.3, CF-3) |
| `app/api/stripe/create-checkout/route.ts` | modify | Auth then 410 for every purchase type (§3.4); Zod kept; unused imports removed |
| `lib/stripe/StripeService.ts` | modify | Delete `createCustomCreditSubscription`, `updateSubscriptionAmount`; FR-40 comment on `createBoostPackCheckout` |
| `lib/services/CreditService.ts` | modify | Delete three throwing stubs and `CalculatorInputs` (no importer). **20 `console.*`: flag and propose conversion** (CLAUDE.md § Logging; SA Q-3) |
| `app/api/cron/check-free-tier-expiration/route.ts` | modify | Inert 410 after auth, Pino (10 `console.*` go with the body) (§3.5) |
| `lib/cron/bosCronJobs.ts` | modify | `PERMANENTLY_UNSCHEDULED_CRONS` (data only) |
| `lib/cron/__tests__/vercelCrons.test.ts` | modify | Assert no permanently-unscheduled path is in `vercel.json` |
| `app/api/cron/__tests__/freeTierExpiration.rd9.guard.test.ts` | modify | BQ-P8: unscheduled, full stop; route writes nothing |
| `lib/__tests__/accountFrozenWriters.guard.test.ts` | create | No code writes `account_frozen = true` (§3.5.4) |
| `lib/business-os/__tests__/noPilotCreditTableReads.guard.test.ts` | create | TK-6 guard (§3.6) |
| `app/api/stripe/sync-subscription/__tests__/route.test.ts` | create | 401; 410 with no Stripe or Supabase admin call; 500 body |
| `app/api/cron/check-free-tier-expiration/__tests__/route.test.ts` | create | 401 without the secret; 410 with it; no Supabase client created |
| `app/api/stripe/create-checkout/__tests__/route.test.ts` | modify | Boost happy path becomes 410; 401; 400 invalid body; no Stripe call, no audit |
| `app/api/stripe/__tests__/stripeAuditEntries.test.ts` | modify | No `BOOST_PACK_CHECKOUT_INITIATED` (the route no longer initiates); portal/cancel/reactivate unchanged |
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` (+ fixture `platform/subscription-updated-legacy.json`) | modify / create | Scenario P10-1 recorded **before** the route edit (§8.2) |
| `app/api/stripe/webhook/__tests__/pinoLogging.guard.test.ts` | modify | Log-call floor lowered by the deleted calls |
| `lib/repositories/__tests__/userSubscriptionsWriteLockdown.qa.test.ts` | modify | `sync-subscription` leaves the writer list; webhook `QuotaAllocationService` sites 2 → 1; `createCustomCreditSubscription` index check removed |
| `lib/repositories/__tests__/userSubscriptionsWriteLockdownMigration.test.ts`, `paymentTablesWriteLockdownMigration.test.ts` | modify if they pin `sync-subscription` | Pin that it stays gone |
| `supabase/migrations/20261038_purchase_path_tables_client_grants.sql` | create | §5 |
| `scripts/precheck-purchase-path-tables-grants.sql`, `scripts/check-purchase-path-tables-grants-migration.sql` | create | §5 |
| `supabase/SQL Scripts/20261038_purchase_path_tables_client_grants_rollback.sql` | create | §5 |
| `supabase/migrations/__tests__/purchase-path-tables-client-grants.migration.test.ts` | create | §5.4 |
| `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` | modify | §4.6 TK-2 confirmation note; TK-3, TK-5, TK-6 rows closed; F-18/F-19/F-20 corrections (BillingSettingsV2 is dead, V2_NEW was live); Change History |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | §9.1 P-10 row (split a/b, migration 20261038), §9.3 migration table, §9.4 CF-3 closed, Change History |
| `docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md` | modify | R-7 outcome: P-10 owns FR-40, slice 7 verify-only (one row + Change History; after SA confirms Q-1) |

### P-10b

| File | Action |
|---|---|
| `components/settings/PlanManagementTab.tsx` | delete |
| `components/v2/settings/BillingSettingsV2.tsx`, `components/v2/settings/BillingSettingsV2.css` | delete |
| `components/v2/settings/BillingSettingsV2_NEW.tsx` | delete |
| `components/v2/billing/ModalsV2.tsx`, `StatsCardsV2.tsx`, `StorageUsageV2.tsx` | delete |
| `app/v2/billing/page.tsx.bak` | delete |
| `app/v2/billing/page.tsx` | replace with server redirect to `/settings?tab=billing` |
| `components/settings/BillingSettings.tsx` | reduce to read-only (§3.7); console conversion on approval |
| `components/settings/__tests__/billingSettingsReadOnly.guard.test.ts` | create: no `create-checkout`, `update-subscription`, `sync-subscription` fetch; no `from('boost_packs')`; no Stripe embedded checkout script; the deleted files stay deleted |

---

## 7. Task list

**Phase A: preconditions and baselines (P-10a)**
- [x] ✅ A1. Branch `feature/bos-plan-payments-p10` at `f9448054` = `origin/main`; no code diff before work.
- [x] ✅ A2. Harness on the unmodified route: 26/26 pass. Connect 17-entry SHA recorded (§16.2; P-1's `7347cd07…` is not reproducible, see there).
- [x] ✅ A3. P10-1 **and P10-2** (SA C-3) recorded against the unmodified route; P10-1 before-text pasted in §16.3.
- [x] ✅ A4. Regression set on the unmodified tree: 83 suites, 1,847 tests green.

**Phase B: server deletions and stubs**
- [x] ✅ B1. `handleSubscriptionUpdated`: status mirror only (§3.2).
- [x] ✅ B2. `sync-subscription`: auth then 410, Pino (§3.3).
- [x] ✅ B3. `create-checkout`: auth, Zod, then 410 for every purchase type (§3.4).
- [x] ✅ B4. `StripeService`: both price-minting methods deleted; FR-40 comment.
- [x] ✅ B5. `CreditService`: three stubs and `CalculatorInputs` deleted; 20 `console.*` converted to Pino (SA Q-3, user told; logging-only check in §16.5).

**Phase C: TK-3 and TK-6**
- [x] ✅ C1. Freeze job route inert (§3.5.1), fail-closed secret check.
- [x] ✅ C2. `PERMANENTLY_UNSCHEDULED_CRONS` + `vercelCrons.test.ts` assertions with a negative control.
- [x] ✅ C3. `freeTierExpiration.rd9.guard.test.ts` tightened.
- [x] ✅ C4. `accountFrozenWriters.guard.test.ts` and `noPilotCreditTableReads.guard.test.ts`, each with negative controls.

**Phase D: migration**
- [x] ✅ D1. Pre-check, migration, checker, rollback (§5.3).
- [x] ✅ D2. Static migration test (§5.4), incl. the "no word into" guard and C-7.

**Phase E: tests and evidence (P-10a)**
- [x] ✅ E1. Tests updated; harness: Connect 17 byte-identical, every other entry identical, P10-1 changed by design.
- [x] ✅ E2. Function-text check with the new `--exact` mode (C-5).
- [x] ✅ E3. Regression set, `test:bos-entitlements`, scoped `tsc`, `eslint`.
- [x] ✅ E4. Payments requirement (renumbering per C-2, P-10 row, 20261038, CF-3). Reuse plan and boost requirement rows **deferred**, see §16.8. Status Code Complete, uncommitted.

**Phase F: P-10b (after P-10a is merged)**
- [x] ✅ F1. Delete the dead and V2 billing files; `/v2/billing` redirect (§16b.1, importer proof §16b.2).
- [x] ✅ F2. Reduce `BillingSettings` (§3.7); 69 `console.*` → 0, client Pino logger (Q-6; user told, did not decline).
- [x] ✅ F3. Read-only guard test + mocked render test; scoped type check of the touched pages (§16b.4). ⬜ **Manual dev-server check owed** (no `.env` in the worktree, so not run by Dev; see §16b.5).

---

## 8. Test plan

### 8.1 Unit and route

| Suite | Cases |
|---|---|
| `sync-subscription` route | 401 unauthenticated; 410 authenticated; Stripe and admin client never constructed (module mock asserts); 500 body has no `details` outside development |
| `create-checkout` route | 401; 400 invalid `purchaseType`; 410 for `custom_credits`; **410 for `boost_pack`**; `StripeService` not called; no audit entry |
| Freeze job route | 401 wrong secret; 410 right secret; `createClient` never called; `error` log with `alert: true` |
| `vercelCrons` | permanently-unscheduled paths absent from `vercel.json`; negative control with a synthetic config that schedules it |
| RD-9 guard | unscheduled; route has no `account_frozen: true`, no `.update(` |
| `accountFrozenWriters` guard | repo clean; negative control string flagged |
| `noPilotCreditTableReads` guard | Business OS tree clean; negative controls (`.from('user_subscriptions')`, `import ... CreditService`) flagged; registries pass |
| Migration static test | §5.4 |

### 8.2 Webhook evidence (SR-10)

| Check | Expected |
|---|---|
| Harness Connect entries 1a to 9c | Byte-identical; SHA-256 before = after |
| Harness 10, 11, P1 to P7 (incl. **P6 boost pack**) | Identical |
| P10-1 `customer.subscription.updated`, legacy metadata | Before: credit fields + `billing_events:insert` + quota. After: one `user_subscriptions:update` with `cancel_at_period_end`, `canceled_at`, `status` only |
| P10-2 same event without credits metadata | No write before and after |
| Function-text equality vs `f9448054` | Every function in the route except `handleSubscriptionUpdated` is identical (TypeScript AST, function body text). Use `scripts/check-logging-only-diff.ts --functions`; if its P0-C3 rule refuses a base that already uses `log`, add an `--exact` mode (plain text equality of the named functions) in this slice (SA Q-8) |

### 8.3 Regression set

`npx jest app/api/stripe app/api/cron lib/cron lib/business-os lib/stripe lib/payments lib/repositories/__tests__/userSubscriptionsWriteLockdown lib/repositories/__tests__/paymentTablesWriteLockdownMigration supabase/migrations/__tests__ --ci`. `npm run test:bos-entitlements` only if a guard ends up importing from `lib/business-os/entitlements/` (planned: none; the TK-6 guard reads source text).

### 8.4 Acceptance mapping

| P-10 "done means" | Evidence |
|---|---|
| §4.6 *Dies* removed | §2.1 table; guards; `grep prices.create lib/stripe/StripeService.ts` → none |
| *Survives* intact | §2.2; function-text check; suites green |
| *Guarded* implemented | §3.4, §3.5, §3.6 tests |
| TK-3 per BQ-P8 | §3.5; pre-check Q-7 = 0 |
| Connect before/after | §8.2 |

---

## 9. Tenant isolation

| Rule (`tenant-isolation-guard`) | P-10 |
|---|---|
| Service role acting on a caller-supplied id | P-10 **removes** two: `sync-subscription` (service-role writes for the session user, driven by Stripe metadata) and the credit half of `handleSubscriptionUpdated` (service-role write keyed on `subscription.metadata.user_id`). The remaining status mirror is unchanged in keying and platform-only, as today |
| New writes | None. The 410 stubs write nothing |
| Grants | The migration narrows access; it grants nothing |

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A Connect line changes by accident in the live-money file | Low (one function edited) | High | Harness SHA, function-text check |
| A boost checkout opened just before deploy completes after it | Low | Low | Webhook boost branch untouched (FR-40) |
| An agent-platform user loses buy controls | Certain | Low (platform parked, no real customers, E-1/E-2) | Intended (RD-12); 410 messages are clear |
| A missed browser reader of one of the four tables breaks | Very low (grep: none) | Low | Rollback is separate GRANT statements; §5.5 step 5 |
| `service_role` privilege came through PUBLIC on one table | Very low | High (webhook claim table) | Migration never names PUBLIC; checker asserts `service_role` privileges after apply |
| A Business OS account is already frozen | Very low | High for that customer | Pre-check Q-7 before merge; user decides a one-row fix |
| Someone re-wires the freeze job | Low | High | Route inert, registry entry, three guards |
| Deleting `CreditService` stubs breaks an unknown caller | Very low (grep: none; they only throw) | Low | Type check fails at build if any exists |
| `BillingSettings` reduction breaks the `/settings` page | Medium (large file) | Low (parked surface) | P-10b on its own PR; read-only guard; manual check |

---

## 11. Rollback

- **P-10a code:** revert the PR. Returns `sync-subscription` (a metadata-driven credit path) and the boost checkout, so prefer fixing forward; nothing in P-10a is needed by P-1's safety. No data changed by code.
- **Migration:** run the rollback file, trimmed to pre-check Q-2. It re-opens the browser grants, including TRUNCATE; only for a proven missed reader.
- **TK-5 data step:** re-activate the ids saved from Q-6.
- **P-10b:** revert the PR; restores the files and the buy UI (which then calls 410 routes).
- No feature flag: a switch that re-enables a retired purchase path would be the hazard P-1 removed.

---

## 12. Demo

1. `npx jest` per §8.3: green, with the harness showing the Connect SHA unchanged and P10-1 changed as described.
2. Signed-in test account on a local dev server: `POST /api/stripe/create-checkout {purchaseType:'boost_pack', boostPackId}` → 410 and a `warn` line; `POST /api/stripe/sync-subscription` → 410.
3. `GET /api/cron/check-free-tier-expiration` with the local `CRON_SECRET` → 410 and an `alert` line; nothing read or written.
4. Break it on purpose: add the freeze path to a scratch copy of `vercel.json`, run `vercelCrons.test.ts` → fails naming BQ-P8. Restore.
5. Production, user: pre-check, migration, checker `VERDICT PASS`, Q-7 = 0.
6. P-10b: `/v2/billing` lands on `/settings?tab=billing`; no purchase controls; history and invoices present.

---

## 13. Sizing

**3 to 3.5 days in total, as two PRs** (requirement estimate 2–3 d; the extra is the migration and the UI reduction).

| Part | Estimate |
|---|---|
| P-10a: baselines, P10-1 scenario, webhook edit, three route stubs, `StripeService`/`CreditService` deletions | 0.75 d |
| P-10a: TK-3 (route, registry, guards), TK-6 guard | 0.5 d |
| P-10a: migration, pre-check, checker, rollback, static test | 0.5 d |
| P-10a: evidence and docs | 0.25 d |
| P-10b: deletions and redirect | 0.25 d |
| P-10b: `BillingSettings` reduction + console conversion + guard + manual check | 0.75 to 1 d |

---

## 14. Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| **Q-1 (TK-5)** | The reuse plan lists the boost checkout under *Dies* pending TK-5. The Credits Boost requirement (Q14, FR-40, T-11, R-7) decided it with the user: switched off, not deleted, and owned by whichever of boost slice 7 and P-10 lands first. Confirm P-10 takes FR-40 now (checkout 410, packs inactive as a recorded data change, webhook branch and code kept), moves it to *Guarded*, and boost slice 7 becomes verify-only? | Yes. Slice 7 has not started; P-10 already edits `create-checkout`. TL tells the boost session (§15) |
| Q-2 | L-26 says all six billing-path `QuotaAllocationService` calls die; FR-40 says the webhook boost branch is left as-is. The boost branch holds one of them | Keep it (FR-40 is the later, specific decision; the call is harmless, F-18). Five of six are then gone; the service itself stays (scripts use it) |
| Q-3 | `CreditService`: delete the three throwing purchase stubs (L-23)? Touching the file brings its 20 `console.*` under CLAUDE.md § Logging | Delete them and convert the file on user approval (small, mechanical). Alternative: leave `CreditService` untouched; the stubs take no money |
| Q-4 | Retired routes: keep `sync-subscription`, `update-subscription` and `create-checkout` as 410 stubs, or delete the files once P-10b removes the UI callers? | Keep as 410 stubs (consistent with P-1, clear to stale clients). FR-40 requires the checkout to refuse with 410, so `create-checkout` stays regardless |
| Q-5 | Freeze job: keep the file as an inert 410 (body deleted), or delete the route? | Keep the inert file: the decision is then found at the path, and the guard keeps a fixed target |
| Q-6 | `BillingSettings` (L-33): reduce to read-only (keep history, usage, invoices, portal, cancel) and convert its console calls, or delete it and show `UsageAnalytics` plus a portal link? | Reduce (L-33's stated option; keeps the portal and cancel for the four test subscriptions until TK-1) |
| Q-7 | Include `boost_packs` (writes only) in the migration? It is outside the four "no client use" tables because the browser reads it until P-10b | Yes, writes only: admin writes go through the service-role route, and no browser should write it |
| Q-8 | Function-text check: `check-logging-only-diff.ts --functions` refuses a base that already uses `log` (P0-C3). Add an `--exact` mode, or a separate small script? | Add `--exact` to the existing script (one tool, already reviewed) |
| Q-9 | `handleSubscriptionUpdated`: keep both early returns (so it runs for the same events) and only drop the credit effects? | Yes (§3.2). Dropping the credits requirement would widen what it acts on |
| Q-10 | The surviving `billing_events` writers (`handleInvoicePaymentFailed`, `handleSubscriptionDeleted`, four in `CreditService`) all fail on non-existent columns. Leave them (RD-16), or delete the inserts since they never land? | Leave them in P-10 (RD-16; the kept dunning handler is unreachable anyway). Follow-up F-1 |

### Follow-ups (not P-10)

| # | Item |
|---|---|
| F-1 | Surviving `billing_events` inserts use non-existent columns (§1.3). Fix or delete with the agent platform's next owner |
| F-2 | Help texts naming "add more credits" and `/v2/billing` (35 `console.*` across the three files) |
| F-3 | P-3b's reserved migration 20261026 is taken on `main` (§2.4) |

---

## 15. Coordination

| Who | What | When |
|---|---|---|
| TL → Credits Boost session | P-10 takes FR-40 (if SA confirms Q-1); boost slice 7 becomes verify-only | After SA review |
| TL → all sessions with migrations | 20261038 claimed by plan-payments P-10 | Now |
| TL → plan-payments (P-3b) | 20261026 is already used on `main` by `business_os_credit_charges_activity_indexes`; P-3b needs a new number (20261029 is the natural one) | Now |
| User | Pre-check Q-2/Q-4/Q-6/Q-7 output saved before apply; migration; checker; TK-5 data step after P-10a deploys | At apply |

---

## 16. P-10a implementation and evidence log

All on `feature/bos-plan-payments-p10` at `f9448054`, **uncommitted** (user sees the diff before RM commits). No SQL was run against any database; no Stripe call was made.

### 16.1 What changed, against the plan

| Plan item | As built |
|---|---|
| B1 webhook (§3.2, C-4) | Only `handleSubscriptionUpdated` changes (body + its own JSDoc). Both early returns kept (Q-9). Writes `cancel_at_period_end`, `canceled_at`, `status` only. **No other edit in the route file**: no TK-5 comment edits elsewhere (C-4's simplest option). The `QuotaAllocationService` import stays (boost branch, Q-2) |
| B2 `sync-subscription` | Auth (401 `{ success:false, error:'Unauthorized' }`), then 410 `Credit subscriptions are no longer sold`, `warn` `stripe_sync_subscription_refused`. No Stripe client, no service-role client, no audit. 19 `console.*` gone with the body |
| B3 `create-checkout` | Auth, Zod (400 kept), then 410 for **every** purchase type: `custom_credits` → "Credit subscriptions are no longer sold", `boost_pack` → "Boost packs are no longer sold"; `warn` `stripe_checkout_refused` with `purchaseType`. Event renamed from P-1's `stripe_checkout_subscription_refused` (one event for both types). Unused imports removed |
| B4 `StripeService` | `createCustomCreditSubscription` and `updateSubscriptionAmount` deleted; `grep prices.create lib/stripe/StripeService.ts` → none. FR-40 comment on `createBoostPackCheckout`; class header rewritten |
| B5 `CreditService` | Three stubs + `CalculatorInputs` deleted (Q-3). 20 `console.*` → 18 Pino calls (three consecutive `console.log` lines became one structured line). Two pre-existing `any[]` return types left as they were |
| C1 freeze route (Q-5, C-6) | GET only (the only method it ever exported; the test pins that the export set is exactly `['GET']` and runs every case per exported method). Secret check is **fail closed** (no `CRON_SECRET` → 401, so `Bearer undefined` no longer matches) and constant-time, like `cronRunRecorder`. With the secret: 410 `Permanently disabled` + `error` `free_tier_expiration_disabled` `alert: true`. No database client is constructed |
| C2 registry | `PERMANENTLY_UNSCHEDULED_CRONS` (+ its interface) in `lib/cron/bosCronJobs.ts`, data only, file still import-free (SC-8) |
| C3 RD-9 guard | "Unscheduled, full stop"; route code (comments stripped) has no table access, no write, no RPC, no database client, no `account_frozen: true`. `createHash(...).update(` is exempted explicitly (the secret hash), with a negative control proving a real write after it is still caught |
| C4 guards | `accountFrozenWriters` scans `app/ lib/ components/ hooks/ supabase/migrations/` (wider than planned: migrations and hooks added). `noPilotCreditTableReads` matches whole import statements (multi-line and dynamic too) |
| D migration | As §5.3. See §16.6 for one deviation in the pre-check's shape |
| Pino floor (`pinoLogging.guard`) | **Not lowered**: the route still has at least 134 log calls after losing five in `handleSubscriptionUpdated`, so the floor stays as it is. **Superseded after the rebase (2026-10-06): lowered to 133, see §16.9** |

### 16.2 Connect evidence (SR-10, C-3)

**Method** (the P-1 log does not say how `7347cd07…53c383c` was computed, and none of seven obvious methods reproduces it): the raw text of the 17 `exports[...]` blocks titled `P-0 baseline` 1a to 9c, LF-normalised, joined by `\n` in file order, SHA-256. Scratch script, not committed. Separately, entries 1a and 1b **did** change between P-1 (`beb2e496`) and `f9448054`: the receipt-on-paid work (merge `f66cae67`) added a `payment_invoices` select. That is why today's hash cannot equal P-1's whatever the method. It does not affect P-10's before/after.

| Measure | Before (unmodified route, `f9448054`) | After (P-10a) |
|---|---|---|
| Connect 17 entries 1a–9c | `77eaca4113b24f919a3d8100b01d216aa5a150f60533b0860b4cb8bcd6fbec3f` | `77eaca4113b24f919a3d8100b01d216aa5a150f60533b0860b4cb8bcd6fbec3f` |
| Harness result | 26/26 (then 28/28 with P10-1/P10-2 recorded) | 28/28, 28 snapshots |
| Per-entry hashes, all 28 entries | — | **27 identical** (17 Connect, 10, 11, P1–P7 incl. **P6 boost pack**, P10-2); **1 changed: P10-1**, by design |
| Whole snapshot file, LF | `d000ecb2…0447c5` (26 entries); `27e142d7…151e146e` (with P10-1/P10-2 before-edit) | `b940aec1ed9a04ab2acdda9046a403151f35a059cc83d4bdf49de0bb279de450` |

### 16.3 P10-1 before the edit (C-3, recorded against the unmodified route)

P10-1 diff before → after, read line by line: the edit removed `monthly_amount_usd: 20` and `monthly_credits: 5000` from the `user_subscriptions:update`; removed the whole `billing_events:insert` effect; removed the `quota.allocateQuotasForUser` effect. Nothing else differs. P10-2 (no credits metadata) is byte-identical before and after: claim, no write, claim completed. SHA-256 of the text below: `c53abc2e39584d73211a049f104b1deaae1599b65bd74dd0328092e13059caf0`.

```text
exports[`Stripe webhook, platform customer.subscription.updated (P-10) P10-1. legacy user_id + credits metadata: only the status mirror is written 1`] = `
{
  "body": {
    "received": true,
  },
  "effects": [
    {
      "secret": "whsec_platform_test",
      "type": "stripe.constructWebhookEvent",
    },
    {
      "chain": [
        [
          "select",
          "event_id, status",
        ],
        [
          "eq",
          "event_id",
          "evt_platform_subscription_updated_legacy",
        ],
      ],
      "operation": "select",
      "table": "processed_webhook_events",
      "terminal": "maybeSingle",
      "type": "db",
    },
    {
      "chain": [
        [
          "insert",
          {
            "event_id": "evt_platform_subscription_updated_legacy",
            "event_type": "customer.subscription.updated",
            "metadata": {
              "created": 1790003000,
              "livemode": false,
            },
            "processed_at": "<NOW>",
            "status": "processing",
          },
        ],
      ],
      "operation": "insert",
      "table": "processed_webhook_events",
      "terminal": "await",
      "type": "db",
    },
    {
      "chain": [
        [
          "update",
          {
            "cancel_at_period_end": true,
            "canceled_at": "2026-09-21T14:55:00.000Z",
            "monthly_amount_usd": 20,
            "monthly_credits": 5000,
            "status": "active",
          },
        ],
        [
          "eq",
          "user_id",
          "agent-platform-user",
        ],
      ],
      "operation": "update",
      "table": "user_subscriptions",
      "terminal": "await",
      "type": "db",
    },
    {
      "chain": [
        [
          "insert",
          {
            "amount_cents": 2000,
            "credits_delta": 0,
            "currency": "usd",
            "description": "Subscription updated: 5,000 Pilot Credits/month ($20.00)",
            "event_type": "subscription_updated",
            "user_id": "agent-platform-user",
          },
        ],
      ],
      "operation": "insert",
      "table": "billing_events",
      "terminal": "await",
      "type": "db",
    },
    {
      "args": [
        "agent-platform-user",
      ],
      "type": "quota.allocateQuotasForUser",
    },
    {
      "chain": [
        [
          "update",
          {
            "completed_at": "<NOW>",
            "status": "completed",
          },
        ],
        [
          "eq",
          "event_id",
          "evt_platform_subscription_updated_legacy",
        ],
      ],
      "operation": "update",
      "table": "processed_webhook_events",
      "terminal": "await",
      "type": "db",
    },
  ],
  "status": 200,
}
`;
```

### 16.4 Function-text check (E2, C-4, C-5)

`npx tsx scripts/check-logging-only-diff.ts --base origin/main --file app/api/stripe/webhook/route.ts --functions <17 names> --exact` → **exit 0, all 17 identical**: `handleInvoicePaymentFailed`, `handleCheckoutCompleted`, `handleDispute`, `handleChargeRefunded`, `handleConnectPaymentIntentSucceeded`, `recordPlanPeriodPaid`, `handleConnectPlanSubscriptionCreated`, `accountOwns`, `handleConnectInvoicePaid`, `handleConnectCheckoutCompleted`, `handleConnectInvoicePaymentFailed`, `handleConnectInvoiceFinalized`, `handleConnectInvoiceUncollectible`, `handlePlanSubscriptionEnded`, `handleSubscriptionDeleted`, `completeClaim`, `POST`. The same 18 top-level functions exist before and after; the 18th, `handleSubscriptionUpdated`, reports `differs` as intended. `git diff` of the route has three hunks, all inside `handleSubscriptionUpdated` and its JSDoc (old lines 321 to 395).

`--exact` (C-5): plain text of the named top-level functions, LF-normalised, no logging normalisation and therefore no P0-C3 refusal; leading JSDoc outside the compared text, comments inside it count. Default mode untouched. Its tests: identical passes (on a base that uses `log`, while default mode still refuses it), CRLF = LF, one-character change fails only that function, a log-only or comment-only edit fails (default mode would pass the log edit), missing function on either side, edits outside the named functions ignored. `scripts/__tests__/check-logging-only-diff.test.ts`: 24/24.

### 16.5 Logging-only check on `CreditService` (Q-3)

`check-logging-only-diff.ts --base origin/main --file lib/services/CreditService.ts` (default mode) → differs, and the only non-logging lines are the intended deletions: `CalculatorInputs` and the three throwing stubs. The other two lines are `__LOG__()` placeholders (three `console.log` became one log call). Log calls: base 20, head 18. The only call marked REVIEW is `createLogger({ module: 'CreditService' })`.

### 16.6 Migration files (D1, C-7) and one deviation

| File | Notes |
|---|---|
| `supabase/migrations/20261038_purchase_path_tables_client_grants.sql` | `BEGIN;`, exactly the 12 REVOKEs of §5.3 (one table, one role each), `COMMIT;` |
| `scripts/precheck-purchase-path-tables-grants.sql` | Read-only. **Deviation:** **one** result set (`sort_order`, `item`, `detail`) with rows Q1 to Q7, not one statement per query. The Supabase SQL editor shows only the last statement's result, so separate statements would hide Q1 to Q6. Q2 reads the ACL itself (`aclexplode` of `relacl`, PUBLIC shown as `PUBLIC`), not `information_schema.role_table_grants`, which hides grants the current role is not part of. Q4 has a count row and a backup row (name, command, permissive, roles, `qual`, `with_check`). Q5 counts rows with direct `count(*)`, so **a missing table makes the whole pre-check error**. That error is itself the "stop" signal of §5.5 step 1. Q7 has both counts (C-1). First row: "run the migration in a NEW tab" |
| `scripts/check-purchase-path-tables-grants-migration.sql` | Read-only; `VERDICT` first. C1 exists, C2 RLS on, C3 `has_table_privilege` for 2 roles × 7 privileges × 5 tables (boost_packs SELECT must be true, its writes false; the other four all false), C4 no column grant to anon/authenticated/PUBLIC, C5 policy count vs literal, C6 `service_role` needs, **fail closed** (missing privilege or table → FAIL). **The user fills C5's literals from pre-check Q4 before running:** `billing_events` is pre-filled with **2** (§1.3); the other four are `-1`, which is a FAIL ("fill in the policy count from pre check Q4 first") until replaced |
| `supabase/SQL Scripts/20261038_purchase_path_tables_client_grants_rollback.sql` | Separate GRANTs to `anon` / `authenticated` only, restoring the measured default set; trim to Q-2 before use |
| `supabase/migrations/__tests__/purchase-path-tables-client-grants.migration.test.ts` | 36 tests: no `--` or `/*`, **no word "into"** (case-insensitive) in all four files, literals only letters/digits/underscores/spaces, no single-letter alias, read-only first statement, the 12 REVOKEs exactly and in order, one table + one role per REVOKE, never `service_role` / PUBLIC / `postgres` / GRANT / DROP / ALTER / CREATE, boost_packs keeps SELECT, rollback mirrors the pairs, checker VERDICT + fail-closed `service_role` + unfilled-count FAIL, pre-check Q1–Q7 markers, neither check file writes |

### 16.7 Tests run

| Run | Result |
|---|---|
| Baseline before any edit (§8.3 set + `lib/services lib/__tests__`) | 83 suites, 1,847 tests green |
| `npx jest app/api/stripe lib/stripe lib/services lib/business-os/billing lib/cron lib/__tests__ supabase/migrations/__tests__ --ci` (TL's set) | **78 suites, 1,567 tests, 35 snapshots green** |
| Wider set: + `app/api/cron lib/business-os lib/payments lib/audit` + the two lockdown suites + `scripts/__tests__/check-logging-only-diff` | **408 suites, 8,204 passed (28 skipped), 58 snapshots green** |
| `npm run test:bos-entitlements` (none of the changed files imports the module; run as the guard) | 187 suites, 4,802 tests green |
| `eslint` on the 22 changed TS files | 0 errors; 8 warnings, all pre-existing lines (webhook unused imports at :19, `any` at :305 in the untouched boost branch and :2495, `lookupError` :1189; `CreditService` `any[]` :310/:329) |
| Scoped `tsc --noEmit` (temporary tsconfig over the changed files; a full run exhausts the heap here) | **0 errors in changed files**. 64 pre-existing errors in files they import transitively (e.g. `WebsiteBlockEnrichmentService`, `StripeInvoiceService`), none touched |

### 16.8 Open items and deviations

| # | Item | Owner |
|---|---|---|
| D-1 | Connect hash method differs from P-1's (unrecorded); before = after under one stated method (§16.2) | SA to accept |
| D-2 | Pre-check is one result set, not separate statements (§16.6) | SA to accept |
| D-3 | `create-checkout` refusal event renamed to `stripe_checkout_refused` for both types (the workplan's §3.4 name); P-1's `stripe_checkout_subscription_refused` no longer emitted | SA to accept |
| D-4 | Freeze route secret check now fails closed when `CRON_SECRET` is unset (was: compares against `Bearer undefined`) | SA to accept |
| D-5 | **Deferred docs:** reuse plan §4.6 TK-2/TK-3/TK-5/TK-6 rows and F-18 to F-20 corrections; Credits Boost requirement R-7 row (P-10 owns FR-40, slice 7 verify-only). Not edited here: the boost requirement is the boost session's file (TL tells that session, §15), and the reuse-plan edits are not needed for P-10a's code. Proposed: with P-10b, or a small docs PR | TL |
| G-1 | **C-1 merge gate:** user runs the pre-check and records Q-7 (both counts) in §5.6 before RM merges. Any non-zero Business OS count stops the merge | User |
| G-2 | Migration apply (§5.5 steps 1–3, 5); fill C5 policy counts first | User |
| G-3 | TK-5 hand-run step (§5.5 step 4), **only after P-10a is deployed**, with Q-6 values saved first | User |

### 16.9 After the rebase on `main` (2026-10-06)

The five P-10a commits were rebased from `f9448054` onto `origin/main` `4c1b630a` (31 commits, including Offir's `f0723d4d` "payments, insight and CRM work in progress"). All proofs below were re-run against the new `origin/main`.

**Conflicts.** One, the known one: `app/api/stripe/create-checkout/route.ts`. `main` changed only two lines of that file (`import { platformOrigin } from '@/lib/utils/origins'` and `baseUrl = request.headers.get('origin') || platformOrigin()`), both inside the boost checkout body P-10a deletes. Resolved to P-10a's 410 version verbatim (`const { purchaseType } = parsed.data;`), so the import is gone too. The rebased file is byte-identical to the pre-rebase P-10a file. `lib/cron/bosCronJobs.ts` and `lib/cron/__tests__/vercelCrons.test.ts` merged cleanly: `main` added the 14th job (`stripe-settlement-gap`), P-10a appends `PERMANENTLY_UNSCHEDULED_CRONS` and its suite; neither touches the other's lines. (§1's "13 Business OS jobs" is as measured at `f9448054`; `main` now schedules 14.)

**Migration renumbered 20261036 → 20261038.** `main` now holds `20261036_business_addresses_book.sql` and `20261037_business_addresses_ownership_fk.sql` (address book, PR #229). 20261038 was checked free on `main` and on every remote branch. Renamed: the migration and `supabase/SQL Scripts/20261038_purchase_path_tables_client_grants_rollback.sql`; updated: the migration test's two paths, this workplan, and the payments requirement (§9.1, §9.3 with a renumber note, Change History). The pre-check, the checker and `check-billing-events-db-writers.sql` never named the number. No guard lists migration numbers. The SA Review section and the 2026-10-05 history rows keep 20261036 as written on their date. The first commit's subject still says 20261036 (nothing is amended).

**One interaction, fixed in its own commit.** `pinoLogging.guard` floor (at least 134 log calls in the webhook): `main` deleted the Connect booking guess in `handleConnectInvoicePaid` (141 → 138 calls) and P-10a deleted the minting in `handleSubscriptionUpdated` (141 → 136). Each alone passes; together the route has 133. Code was deleted, which is the case the floor's own comment allows, so the floor is now 133 with both deletions named in the comment.

| Proof | Result |
|---|---|
| Connect harness, entry by entry vs `origin/main`'s snapshot | `main` 26 entries, branch 28. **All 26 byte-identical** (LF-normalised), including `main`'s rewritten 1b (*"invoice.paid with no booking_id is left unlinked — the booking is never guessed"*); the branch carries `main`'s new value, not P-0's. The 2 extra are P10-1 and P10-2, both new relative to `main`. SHA-256 over the 26 shared entries (sorted, name + body): `f1f8de62ce3852869cd25ca4853a6445ab34994252d3976a6c167d6cfbdeecc4` on both |
| Connect 17 entries 1a–9c, §16.2 method | `main` `e3c1150e47dccb8cbff5f3d5d3d50606333407554da555e315043a8e16b96aa6` = branch `e3c1150e…6aa6`. (Changed from `77eaca41…ec3f` because of `main`'s 1b, not P-10a: the same method gives `77eaca41…` on `f9448054` and on pre-rebase P-10a) |
| `check-logging-only-diff.ts --base origin/main --file app/api/stripe/webhook/route.ts --functions <17 names of §16.4> --exact` | **exit 0, all 17 identical** to `main`'s new text, including `handleConnectInvoicePaid` (so P-10a keeps Offir's no-guess change). `--functions handleSubscriptionUpdated --exact` reports `differs` with the intended diff. 18 top-level functions on both sides. `git diff origin/main` of the route: 3 hunks, all in `handleSubscriptionUpdated` and its JSDoc |
| `main` did not touch P-10a's function | `--base f9448054 --head origin/main --exact`: `handleSubscriptionUpdated` and `handleCheckoutCompleted` identical; only `handleConnectInvoicePaid` differs. So §16.3's P10-1 *before* recording is still valid |
| `npx jest app/api/stripe lib/stripe lib/services lib/business-os/billing lib/cron lib/__tests__ supabase/migrations/__tests__ app/api/cron --ci` | Before the floor fix: 89/90 suites, 1,910/1,911 (only the floor). After: **90 suites, 1,911 tests, 35 snapshots green** |
| Scoped `tsc --noEmit` over the 23 changed TS files | **0 errors in changed files**; the same 64 pre-existing errors in transitively imported files, none touched |
| `eslint` on the 23 changed TS files | 0 errors, the same 8 pre-existing warnings as §16.7 |

**Offir's change and P-10a's surfaces.** Checked across all 31 new commits: no new reader or writer of `billing_events`, `boost_pack_purchases`, `subscription_invoices`, `processed_webhook_events` or `boost_packs` (every `.from()` on them is the same set as at `f9448054`; browser reads of `boost_packs` are still only the two billing components, which keep SELECT). No change to `CreditService`, `sync-subscription`, the freeze route, `user_subscriptions` writes or the Pilot-Credit path. The new `stripe-settlement-gap` cron and `StripeService.listPaidInvoices` are read-only and do not touch the revoked tables. Purge slices 3a/3b classify the four revoked tables `never` and run on the service role, so the grant revoke does not reach them. P-10a's `noPilotCreditTableReads` and `accountFrozenWriters` guards pass over the rebased tree.

## 16b. P-10b implementation and evidence log

Branch `feature/bos-plan-payments-p10b` from `origin/main` `49c2e001` (P-10a, #234, merged). Uncommitted. Scope as §3.7 and §6 P-10b, under SA Q-6 (reduce, keep portal, cancel and reactivate; convert the reduced file's `console.*`).

### 16b.1 What changed, against the plan

| File | Action | Note |
|---|---|---|
| `components/settings/PlanManagementTab.tsx` | deleted | 0 importers (§16b.2) |
| `components/v2/settings/BillingSettingsV2.tsx`, `.css` | deleted | 0 importers; the `.css` was imported only by the `.tsx` |
| `components/v2/settings/BillingSettingsV2_NEW.tsx` | deleted | only importer was `app/v2/billing/page.tsx` (and the `.bak`) |
| `components/v2/billing/ModalsV2.tsx`, `StatsCardsV2.tsx` | deleted | only importer was `BillingSettingsV2_NEW` |
| `components/v2/billing/StorageUsageV2.tsx` | deleted | 0 importers. The `components/v2/billing/` folder is now empty |
| `app/v2/billing/page.tsx.bak` | deleted | |
| `app/v2/billing/page.tsx` | replaced | Server component, `redirect('/settings?tab=billing')`. No `'use client'`. The five inbound links (dashboard Pilot Credits card `:775`, run page "Go to Billing" `:1035`, user menu `:180` for non-Business-OS users, two help texts) are untouched and resolve through it |
| `components/settings/BillingSettings.tsx` | reduced, 2,004 → 1,059 lines (1,108 before B-2) | See below |
| `components/settings/__tests__/billingSettingsReadOnly.guard.test.ts` | new | §16b.3 |
| `components/settings/__tests__/BillingSettings.readOnly.render.test.tsx` | new | §16b.3 (not in §6; added to show the screen, jsdom + mocked Supabase and fetch) |

**`BillingSettings` removed:** the Credits tab (custom-credit slider, presets, price breakdown, Start/Update Subscription button calling `create-checkout` / `update-subscription`), the boost-pack list and its Buy Now (`create-checkout`), the browser read of `boost_packs`, the embedded Stripe checkout (Stripe.js `<Script>`, `window.Stripe`, checkout modal), both `sync-subscription` calls (the `?success=true` effect and the checkout `onComplete`), the "Payment Successful" toast (only purchases raised it), the currency lookup and its call to `api.exchangerate-api.com` (it only fed the calculator's converted price), `min_subscription_usd` from the config read, and the unused `UsageAnalytics` import (it was imported but never rendered, so nothing visible changes).

**Kept:** the six figure cards (status, available balance, monthly, boost credits bought earlier, rewards, used: read-only history from `user_subscriptions` and `credit_transactions`), the Subscription tab (dates, next cycle, Update Payment → `create-portal`, Cancel → `cancel-subscription`, the cancel banner with Reactivate → `reactivate-subscription`), both modals, and the Invoices tab (`/api/stripe/invoices`). The default tab is now Subscription. A one-line notice says purchases are no longer available. Copy and styling of the kept parts are unchanged.

**Logging and types:** 69 `console.*` → 0; `createLogger({ module: 'BillingSettings' })` from `@/lib/logger` (as `CreditHistoryPanel`), errors as `{ err }`, invoice failures log the status only. The `any`-typed props and `useState<any[]>` became `SubscriptionInfoTab` prop types and an `InvoiceRow` interface; `catch (error: any)` became `unknown` with a message helper. The three copies of the date formatter became one (`formatLongDate`, accepts `undefined`, which the call sites already passed). `eslint` on the file: 26 warnings → 6 (all pre-existing apostrophes in kept copy), 0 errors.

### 16b.2 Importer proof (before deleting, on `49c2e001`)

`git grep -n -E "PlanManagementTab|BillingSettingsV2|StorageUsageV2|ModalsV2|StatsCardsV2" -- ':!docs'` returned only self-references and these imports: `app/v2/billing/page.tsx:8` and `page.tsx.bak:7` → `BillingSettingsV2_NEW`; `BillingSettingsV2_NEW.tsx:26-27` → `StatsCardsV2`, `ModalsV2`; `BillingSettingsV2.tsx:8` → `./BillingSettingsV2.css`. No importer of `PlanManagementTab`, `BillingSettingsV2` (the `.tsx`) or `StorageUsageV2`. After the change the same grep (excluding the new guard, which lists the paths) returns nothing (exit 1).

Retired routes: `git grep -n -E "/api/stripe/(create-checkout|update-subscription|sync-subscription)" -- app components hooks lib`, excluding the three stub folders and the new tests, returns nothing (exit 1). Before: 5 hits in `BillingSettings.tsx`, 5 in `BillingSettingsV2_NEW.tsx`.

`boost_packs`: the only browser reads were the two billing components; both are gone. Remaining `.from('boost_packs')`: `app/api/admin/boost-packs/route.ts` (service role behind `requireAdmin`) and `StripeService.createBoostPackCheckout` (kept by FR-40, no caller while `create-checkout` answers 410). So the browser SELECT that 20261038 kept (Q-7) has no first-party user left. **Not changed here** (no grant change in P-10b); revoking it is the one-line follow-up SA named in Q-7.

### 16b.3 Tests

| Suite | Cases |
|---|---|
| `billingSettingsReadOnly.guard.test.ts` (7) | Non-vacuity (scans `app`, `components`, `hooks`, `lib` incl. `lib/client`; the three stubs are present); no non-test file outside the three stub folders names a retired route; `BillingSettings` has no `boost_packs` read, no Stripe embedded checkout, no `console.*`, imports `createLogger`; it still names `create-portal`, `cancel-subscription`, `reactivate-subscription`, `invoices`; the 8 deleted files stay deleted; `/v2/billing` is a non-client `redirect('/settings?tab=billing')`; negative controls for each offence shape plus two that must pass (a stub's own header, a `create-portal` call) |
| `BillingSettings.readOnly.render.test.tsx` (7 after B-2) | Renders the notice, balance (120,000 tokens → "12,000"), Subscription and Invoices tabs, Update Payment and Cancel; no Start/Update Subscription, Buy Now, "Need Credits Now", slider or Credits tab. Tables read: `user_subscriptions`, `credit_transactions`, `ais_system_config`, never `boost_packs`; no retired route fetched; no Stripe.js script. `?success=true` no longer triggers a sync. Cancel → `cancel-subscription`; canceling subscription → Reactivate → `reactivate-subscription`; Invoices tab → `/api/stripe/invoices`, empty state |

**Mutation checks.** (a) A probe file `components/__p10b_mutation_probe.tsx` calling `fetch('/api/stripe/sync-subscription')`: the guard FAILED naming it; probe deleted. (b) The pre-P-10b `BillingSettings.tsx` (from `origin/main`) put in place, both suites run: 6 of 13 FAILED (retired-route guard, buy-flow guard, and 4 of 6 render cases); the reduced file copied back and `cmp`-identical.

```text
npx jest components/settings app/v2 app/settings "app/(protected)/settings" app/api/stripe app/__tests__/tailwind-css-escape --ci
Test Suites: 17 passed, 17 total
Tests:       138 passed, 138 total
Snapshots:   28 passed, 28 total

npx jest components/v2 lib/business-os/__tests__/noPilotCreditTableReads --ci
Test Suites: 2 passed, 2 total
Tests:       46 passed, 46 total
```

(No test exists under `app/settings` or `app/(protected)/settings`; the patterns match nothing and are harmless.)

### 16b.4 Type check and lint

Full-project `tsc --noEmit` runs out of heap on this machine (4 GB default), so the check was scoped: a temporary tsconfig extending the repo's, including `BillingSettings.tsx`, `app/v2/billing/page.tsx`, both new tests and `app/(protected)/settings/page.tsx` (the page that renders the component), run with an 8 GB heap. **0 errors in those files.** 26 errors in files pulled in transitively and not touched (`lib/business-os/LanguageContext.tsx` 24, `components/settings/NotificationsTab.tsx` 1, `ProfileTab.tsx` 1). `eslint` on the changed and new files: 0 errors, 6 warnings (pre-existing apostrophes). Tailwind escape guard green (in the run above).

### 16b.5 Open items and deviations

| # | Item | Owner |
|---|---|---|
| B-1 | **Manual check not run by Dev:** the worktree has no `.env*`, so `next dev` cannot reach Supabase. Owed: `/v2/billing` lands on `/settings?tab=billing`; no purchase controls; figures, Subscription tab (portal button) and Invoices render. The mocked render test covers the component, not the page chrome | QA / user |
| B-2 | ✅ **Resolved (user decision 2026-10-06, "a, delete it").** The hard-coded "Platform Usage" block (fake "Agents 20 / 5 (400.0% used)", "Executions Today 0 / 100", "Storage 150 MB / 500 MB") is deleted from the Subscription tab. It was inline JSX only, so no constant, import or i18n string went with it. The render test now asserts the block is gone and that the Subscription tab still shows Started, Next Billing, Next Cycle Credits, Next Cycle Cost and Active Subscription (7 render cases). `npx jest components/settings app/v2 app/api/stripe --ci`: 16 suites, 133 tests, 28 snapshots green; eslint 0 errors, 6 warnings | Done |
| B-3 | `fetchBillingData` still reads `user_subscriptions`, `credit_transactions` and `ais_system_config` from the browser client (CLAUDE.md rule 1; pre-existing, RLS-scoped by `user_id`). Not moved behind a route in P-10b (scope); unchanged queries | ✅ Resolved: [PR #240](https://github.com/AgentsPilot/neuronforge/pull/240). Reads moved behind `GET /api/billing/summary` |
| B-4 | Browser SELECT on `boost_packs` now has no first-party reader (§16b.2). Revoke is a later one-liner per Q-7 | Follow-up |
| B-5 | `/settings` is the old V1 settings page: a user arriving from the V2 dashboard's Pilot Credits card or the run page's "Go to Billing" lands in different page chrome. As planned (§3.7); noted for the demo | — |
| B-6 | D-5 (§16.8) deferred docs (reuse plan §4.6 rows and F-18 to F-20 corrections, boost requirement R-7) are still not edited; not part of this task | TL |
| B-7 | `components/settings/CurrencySelector.tsx:65` comment names `BillingSettings` as a listener of `currencyChanged`; it no longer listens. Harmless (the event is a broadcast); comment left to avoid touching a file with `console.*` outside scope | — |

---

## SA Review

**Reviewed by SA — 2026-10-05**
**Status:** ✅ Approved with conditions (C-1 to C-8 below)

### What SA verified against `f9448054`

| Claim | Result |
|---|---|
| TK-2 / F-20 correction | ✅ Correct. `app/v2/billing/page.tsx` imports `BillingSettingsV2_NEW` (live); `BillingSettingsV2.tsx`/`.css`, `StorageUsageV2.tsx`, `PlanManagementTab.tsx` have zero importers; `ModalsV2`/`StatsCardsV2` are imported only by `BillingSettingsV2_NEW` |
| No browser or cookie-client code reads `billing_events`, `boost_pack_purchases`, `subscription_invoices`, `processed_webhook_events` | ✅ Only the service-role webhook, `sync-subscription` (service role, body being deleted) and `CreditService` (only constructed with `supabaseServer`, `run-agent:94`; `getBillingEvents` has no caller). Business OS registries name them as strings only |
| `boost_packs` writes only via service role | ✅ `app/api/admin/boost-packs/route.ts` uses a service-role client behind `requireAdmin`. Browser SELECT only in the two billing components |
| 20261036 free | ✅ Not on `main`, any branch, or any sibling worktree (highest: 20261030 boost worktree, 20261035 main) |
| `business_os_account_plans` exists (pre-check Q-7 join) | ✅ `20261005_business_os_entitlements.sql:83` |
| `check-logging-only-diff.ts --functions` exists with the P0-C3 refusal | ✅ |

### Rulings on §14

| Q | Ruling |
|---|---|
| Q-1 | **Approved.** P-10 owns FR-40 (R-7: P-10 lands first). Boost checkout moves to *Guarded*; `create-checkout` 410 for every purchase type after auth + Zod; packs inactive by the hand-run step with Q-6 values saved first; webhook boost branch and `createBoostPackCheckout` kept; boost slice 7 becomes verify-only. TL tells the boost session |
| Q-2 | **Approved.** Keep the one quota call in the boost branch (FR-40 is the later, specific decision). Five of six gone |
| Q-3 | **Approved.** Delete the three stubs + `CalculatorInputs`; flag the 20 `console.*` and convert the whole file unless the user declines |
| Q-4 | **Approved.** All three stay as 410 stubs. Deleting files is not a follow-up worth tracking |
| Q-5 | **Approved** as specified (secret check, 410, `error` + `alert: true`, no client constructed, `PERMANENTLY_UNSCHEDULED_CRONS`, tightened RD-9 guard, `accountFrozenWriters` guard). See C-6 |
| Q-6 | **Reduce**, not delete (L-33; portal/cancel/reactivate still serve the four test subscriptions). Convert the reduced file's `console.*` unless the user declines |
| Q-7 | **Approved.** `boost_packs` write revokes in 20261036, SELECT kept until P-10b; revoking SELECT is a later one-liner, not P-10 |
| Q-8 | **Approved**, see C-5 |
| Q-9 | **Approved.** Keep both early returns; drop only the credit effects |
| Q-10 | **Leave them** (RD-16). They are dead-on-arrival but harmless; deleting them widens the diff into files P-10 does not otherwise need. F-1 stands |

### Conditions

1. **C-1 Frozen-account query is a merge gate for P-10a**, not an apply-time step: pre-check Q-7 (both counts) is run by the user and recorded in §5.6 before RM merges. Any non-zero Business OS count stops the merge and goes to the user.
2. **C-2 P-3b renumbering (§15 / F-3).** Do **not** give P-3b 20261029: P-5's 20261027 *replaces* `business_os_apply_plan_payment`, which P-3b creates, so P-3b must sort before it or a replay breaks and an older function body wins. Shift the block by one: **P-3b 20261027, P-5 20261028, P-9 20261029**; P-8b's spare is dropped (if ever needed, take the next free number after 20261036 at that time). TL records this in the requirement §9.1/§9.3 and with all migration sessions. Not P-10 code.
3. **C-3 P10-1 before-state preserved.** The snapshot file is overwritten by the after-run, so paste the pre-edit P10-1 snapshot text and the 17-entry Connect SHA-256 (before and after) into the evidence log. Add P10-2 (no credits metadata) to the harness too, not only the table.
4. **C-4 Webhook diff scope.** The only function whose text may differ is `handleSubscriptionUpdated`; comment-only edits elsewhere (TK-5 wording) must be outside function bodies or the function-text check must be re-run showing them comment-only. Simplest: put no comment edits inside the route file except in `handleSubscriptionUpdated`.
5. **C-5 `--exact` mode** ships with its own test (identical passes, one-character change in a named function fails, missing function fails) and must not change the default mode's behaviour.
6. **C-6 Freeze route:** every exported HTTP method (GET and POST if both exist) gets the same secret-check-then-410; the route test covers each.
7. **C-7 Migration files** obey the SQL-editor rules exactly as §5.3 states; the static test also asserts each REVOKE names exactly one table and one role. The checker's `service_role` assertions are fail-closed (a missing privilege is FAIL, not skipped).
8. **C-8 TK-5 note:** add to §3.4 that the admin AgentsPilot billing page can still flip `is_active` back on; the 410 is the real guard, the inactive flag is display only. No code change.

Sizing (3 to 3.5 d, two PRs, P-10b after P-10a merges) accepted.

### Approval
[x] Workplan approved — proceed to P-10a implementation under C-1 to C-8; P-10b after P-10a merges

### Re-check after rebase — 2026-10-06

**Status:** ✅ Approved (HEAD `12d2486b` on `origin/main` `4c1b630a`). SA re-ran each proof itself; only what the rebase changed was checked.

| Check | Result |
|---|---|
| `create-checkout` conflict | ✅ `git diff d851a660 HEAD` on the file is empty: byte-identical to pre-rebase P-10a, `platformOrigin` import gone |
| Connect snapshot, per entry vs `git show origin/main:` | ✅ main 26, branch 28; all 26 identical (incl. main's rewritten 1b); only P10-1 and P10-2 new |
| `--exact --functions` (17 names) | ✅ all 17 identical to main's text, incl. `handleConnectInvoicePaid`; only `handleSubscriptionUpdated` differs |
| Log-call floor 134 → 133 (`53c81619`) | ✅ Acceptable. 141 − 3 (main) − 5 (P-10a) = 133, both deletions named in the comment, which is the case the floor's rule allows. No mechanism change needed |
| Renumber 20261036 → 20261038 | ✅ Migration, rollback, test paths, requirement §9 and this workplan all on 20261038; not on main or any remote branch. Remaining 20261036 mentions are the address-book migration or dated history. First commit subject left as is: acceptable (history row explains it); RM uses 20261038 in the PR title and body |
| Main's 31 new commits vs the 5 revoked tables | ✅ `git diff f9448054 origin/main` names none of them. Settlement-gap cron uses `PaymentInvoiceRepository` / `StripeConnectRepository`; `listPaidInvoices` calls only the Stripe API |
| Jest (scoped command) | ✅ 90 suites, 1,911 tests, 35 snapshots passed |

**Nit (fix in passing, does not block):** §16.9 says the route diff has "5 hunks"; it has 3, as §16.4 says.

---

### Code Review — P-10b — 2026-10-06

**Status:** ✅ Code Approved (uncommitted worktree on `origin/main` `49c2e001`, 13 files, +476/−4,197). No must-fix items.

| Check | Result |
|---|---|
| Importer proof | ✅ SA grep of `app/ components/ hooks/ lib/` for all 8 deleted paths (incl. `BillingSettingsV2_NEW`, `ModalsV2`, `StatsCardsV2`, `StorageUsageV2`): the only hits are the guard test's `DELETED_FILES` list |
| Retired routes | ✅ No client code names `create-checkout` / `update-subscription` / `sync-subscription`; the remaining hits are the 410 stubs, server comments and tests |
| Read-only still works (B-3) | ✅ Queries are the pre-existing ones, unchanged. `user_subscriptions` SELECT is asserted kept by 20261001's post-condition; `credit_transactions` SELECT is kept by 20261004 ("SELECT is kept"); `ais_system_config` is touched by no migration in the repo, and 20261038 touches only `billing_events`, `boost_pack_purchases`, `subscription_invoices`, `processed_webhook_events` and writes on `boost_packs`. Nothing in this diff can newly break them. Rule-1 debt stays a follow-up |
| Logger (Q-6) | ✅ `createLogger` from `@/lib/logger` is the established client pattern (44 `'use client'` components use it). `@/lib/logger/client` is only a re-export of the same module, so the bundle is identical; `lib/logger.ts` imports only `pino` (browser build) and `./logger/config` (pino only). No server-only module enters the bundle. 0 `console.*`, guard enforces it |
| Redirect | ✅ Server `redirect('/settings?tab=billing')`; `/settings` is under `(protected)`, whose layout handles signed-out users, and `fetchBillingData` returns early with no user. Settings page reads `?tab=billing` |
| B-2 fake "Platform Usage" | **Recommend delete.** It shows every paying customer invented figures ("20 / 5, 400% used, −15 remaining") that read as an over-limit warning; wiring real data is a separate feature on a parked surface. Business decision for the user |
| B-4 `boost_packs` SELECT | Follow-up only (Q-7 one-liner revoke) |
| Tests | ✅ Guard: non-vacuous tree scan, retired-route callers, buy-flow offences, deletions stay deleted, redirect shape. Render: balances, no purchase controls, no `boost_packs` read, no retired call on `?success=true`, cancel/reactivate/invoices go through their routes. Meaningful |
| Jest | ✅ `npx jest components/settings app/v2 app/api/stripe components/v2 --ci`: 17 suites, 174 tests, 28 snapshots passed. Full `tsc` OOMs here too (exit 134); relying on Dev's scoped 8 GB run (§16b.4) |

**QA:** only the manual B-1 click-through (signed in: `/v2/billing` → `/settings?tab=billing`, figures + Subscription/portal + Invoices render against real RLS; signed out: lands on login). No further QA cycle warranted.

### Code Approved for QA: Yes (B-1 manual check only)

---

## QA Testing Report

**QA — 2026-10-06**
**Test mode:** full (P-10a only)
**Strategy used:** A + B. Jest route tests with mocks, the webhook characterisation harness, source guards with mutation checks, and a static review of the SQL. No Stripe call, no database, no dev server.
**Focus:** api, security, schema (SQL), logging
**Skipped:** live DB and Stripe checks. They need production access, so they are listed under USER/ops below.
**Input source:** prompt keywords (SA's QA focus list)

### Test Coverage

| # | Check | Tested? | Result | Notes |
|---|---|---|---|---|
| 1a | `sync-subscription`: 401 signed out, 410 signed in, no Stripe or DB client | ✅ | Pass | New `app/api/stripe/sync-subscription/__tests__/route.test.ts`, 4 tests. Builds no Stripe or service-role client at module load. A thrown error gives 500 with no internal message |
| 1b | `create-checkout`: 401, 400 from Zod, 410 for `custom_credits` and `boost_pack` | ✅ | Pass | `it.each` 410 rows assert no Stripe, DB or audit call. `it.each` 400 rows. A source guard confirms the route reaches no Stripe service, table, service-role client or audit |
| 1c | `update-subscription` 410 | ✅ | Pass | Unchanged from P-1. Existing route test is green |
| 1d | `check-free-tier-expiration`: 401 with no secret or a wrong one, 401 when `CRON_SECRET` is unset (even for `Bearer undefined`, D-4), 410 + `alert: true` with the secret, no DB client | ✅ | Pass | New route test, 6 tests. GET is the only export (C-6). `timingSafeEqual` compares SHA-256 digests, so it cannot throw on a length mismatch |
| 2a | Webhook `handleSubscriptionUpdated` still mirrors cancel and status, and writes no credit fields | ✅ | Pass | P10-1: the only write is `user_subscriptions:update`, with keys exactly `cancel_at_period_end, canceled_at, status`. No quota call, no `billing_events`. P10-2 (no credits metadata) writes nothing |
| 2b | Cancel and reactivate routes still write `cancel_at_period_end` | ✅ | Pass | Both files are byte-unchanged vs `origin/main` (`git diff --quiet`). They write through the service-role client and are covered by `stripeAuditEntries.test.ts` (200 + audit) |
| 3 | Connect: 17 entries + P6 boost unchanged | ✅ | Pass | Snapshot diff vs `origin/main` is **167 lines added, 0 removed**. All 26 baseline snapshots are byte-identical, including P6. The harness runs 28/28 tests and 28/28 snapshots under `--ci` |
| 4 | Guards fail on a real violation | ✅ | Pass | 3 mutations, applied together: (a) freeze cron added to `vercel.json`; (b) `account_frozen: true` appended to `CreditService.ts`; (c) `.from('billing_events')` appended to `app/api/business-os/usage/route.ts`. All 3 suites FAILED (4 tests). Files were restored from copies and `cmp` showed them identical. `git diff --stat` matched the pre-mutation capture. The re-run gave 17/17 green |
| 5 | SQL files: static review for Postgres 17 in the Supabase editor | ✅ | Pass | All 5 files: 0 occurrences of `into`, 0 of `--`. Pre-check, checker and writer-check are SELECT-only after `SET default_transaction_read_only = on`. The migration has the 12 REVOKEs in BEGIN/COMMIT and none from `service_role`. `boost_packs` keeps SELECT. Checker: the `-1` placeholders FAIL C5 with "fill in the policy count", missing tables or privileges FAIL C1/C3/C6, and VERDICT is FAIL whenever any row is not PASS. The static migration test is green |
| 6 | Logging | ✅ | Pass | 0 `console.*` in `CreditService`, `StripeService`, the 4 changed routes, and `bosCronJobs`. New log lines carry only `userId` (UUID), `status`, `purchaseType`, amounts, and `err`. No email, name or token. `check-logging-only-diff` on `CreditService` (exit 1, as expected) differs only by the intended deletions (`CalculatorInputs`, 3 throwing stubs). This matches §16.5 |
| — | Grant revoke does not break a live reader | ✅ | Pass | Grep: `billing_events`, `boost_pack_purchases`, `subscription_invoices` and `processed_webhook_events` are touched only by the service-role webhook and by `CreditService`, which is built with `supabaseServer`. The browser reads only `boost_packs` (SELECT kept). The admin boost-packs route uses a service-role client |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **Boost-pack buy button still shows until P-10b.** `BillingSettings.tsx` and `BillingSettingsV2_NEW.tsx` still list active packs. A click now gets 410 from `create-checkout`. The UI removal is planned for P-10b, and the TK-5 hand-run step deactivates the packs. Severity: Low.
2. **Checker C5 has one pre-filled count.** `billing_events` is set to 2 from §1.3, not from the user's own pre-check Q4. If prod differs, the checker FAILs (it fails closed), so this is safe. The user should still confirm the 2 against Q4. Severity: Low.

### Test Outputs / Logs

```text
npx jest app/api/stripe lib/stripe lib/services lib/business-os/billing lib/cron lib/__tests__ supabase/migrations/__tests__ app/api/cron lib/repositories --ci
Test Suites: 144 passed, 144 total
Tests:       3083 passed, 3083 total
Snapshots:   35 passed, 35 total

connectPath.characterisation: Tests 28 passed, Snapshots 28 passed
mutation run (3 guards): Tests 4 failed, 13 passed  -> restored -> 17 passed
scripts/__tests__/check-logging-only-diff.test.ts: 24 passed
```

### USER/ops checks (not runnable by QA)

1. **Merge gate (C-1):** run `scripts/precheck-purchase-path-tables-grants.sql`. Q7 must show **both counts = 0**. Record the result in §5.6. Any non-zero Business OS count stops the merge.
2. From pre-check Q4, replace the four `-1` values in C5 of `scripts/check-purchase-path-tables-grants-migration.sql` and confirm `billing_events` = 2.
3. In a **new tab**, apply `supabase/migrations/20261038_purchase_path_tables_client_grants.sql`.
4. Run the checker. Its first row must read **VERDICT PASS**.
5. Run `scripts/check-billing-events-db-writers.sql`. Record the trigger count and the functions that reference `billing_events`. A trigger or SECURITY INVOKER function called by a client role would now hit "permission denied".
6. After apply and deploy, check Vercel logs for the Stripe webhook. There must be **no "permission denied"** (42501).
7. Once Stripe test access exists, make one live Connect test payment end to end.
8. TK-5 (§5.5 step 4): only after deploy, and save the Q6 values first.

### Final Status
- [x] All acceptance criteria pass — ready for commit (subject to the USER/ops merge gate C-1)
- [ ] Issues found — Dev must address before commit

**Verdict: PASS WITH NOTES** (2 low edge cases, no bugs).

---

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-05 | Created (Dev) | P-10 workplan: TK-2 inventory confirmed against `f9448054`; TK-3 per BQ-P8 (freeze job inert and recorded in the cron registry, no `account_frozen` writer); TK-5 per FR-40 (boost checkout 410, kept); TK-6 already closed, guard added; `sync-subscription` closed (CF-3); migration 20261036 revoking browser grants on four purchase-path tables (plus `boost_packs` writes); split into P-10a (server) and P-10b (UI) |
| 2026-10-05 | P-10a implemented (Dev) | Code complete, uncommitted, under SA C-1 to C-8: webhook status mirror, three 410 stubs, `StripeService` / `CreditService` deletions and Pino conversion, freeze job inert and permanently unscheduled, TK-6 and `account_frozen` writer guards, migration 20261036 with pre-check, checker, rollback and static test, `--exact` mode for the function-text check. Evidence in §16 (Connect 17 entries identical, `77eaca41…cbfec3f` before and after; P10-1 before-text kept). §3.4 C-8 note; §5.6 C-1 merge gate. Deviations D-1 to D-5 in §16.8 |
| 2026-10-06 | Rebased on `main` `4c1b630a`; migration renumbered to 20261038 (Dev) | One conflict (`create-checkout`, resolved to P-10a's 410 version). 20261036/37 taken on `main` by the address book. Webhook log floor 134 → 133 (both sides deleted code). Proofs re-run against the new `main`: §16.9 |
| 2026-10-06 | P-10b implemented (Dev) | Branch `feature/bos-plan-payments-p10b` from `49c2e001`, uncommitted: 8 dead or replaced billing files deleted, `/v2/billing` → server redirect to `/settings?tab=billing`, `BillingSettings` reduced to read-only (no buy, upgrade, boost or sync; portal, cancel, reactivate, invoices kept; 69 `console.*` → Pino), guard + render tests. Evidence and open items B-1 to B-7: §16b |
| 2026-10-06 | `boost_packs` browser SELECT revoke; doc corrections (Dev) | Branch `fix/boost-packs-revoke-browser-select` from `248de6be`. Migration **20261039** revokes SELECT on `boost_packs` from `anon` and `authenticated` (B-4, SA Q-7 one-liner); policies, RLS and `service_role` unchanged. Pre-check `scripts/precheck-boost-packs-client-select.sql`, checker `scripts/check-boost-packs-client-select-migration.sql`, rollback `supabase/SQL Scripts/20261039_boost_packs_revoke_client_select_rollback.sql`, static test `boost-packs-revoke-client-select.migration.test.ts`. **Pending manual apply.** Once applied, the 20261038 checker's C3 `boost_packs` SELECT rows read FAIL by design (it expects SELECT kept); use the 20261039 checker. Header corrected: P-10a merged (#234), P-10b merged (#238); stale "uncommitted" wording removed. Reuse plan TK-2/3/5/6 outcomes and F-18 to F-20 corrected |
| 2026-10-07 | B-3 resolved (RM) | `BillingSettings` browser reads of `user_subscriptions`, `credit_transactions` and `ais_system_config` moved behind `GET /api/billing/summary`: [PR #240](https://github.com/AgentsPilot/neuronforge/pull/240). B-4: confirmed `boost_packs` has no browser reader any more (the grant revoke stays in the tidy-up task) |
