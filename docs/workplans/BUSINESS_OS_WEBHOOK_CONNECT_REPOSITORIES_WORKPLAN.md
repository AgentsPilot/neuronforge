# Workplan: Stripe webhook onto repositories (CLAUDE.md rule 1), no behaviour change

> **Last Updated**: 2026-10-08

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): SR-16 (every route on repositories), §9.4, the tenant-isolation ruling and "Standards for every workplan" (SA-3). Tracked follow-up from [P-0](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P0_WORKPLAN.md) SA review ("Rule 1 / direct Supabase … record it as a tracked follow-up") and [P-1](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P1_WORKPLAN.md) condition P1-C6.
**Prior slices read:** P-0 (Connect characterisation harness, `check-logging-only-diff`), P-1 (router, deny by default), [P-10](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P10_WORKPLAN.md) (P-10a #234, P-10b #238).
**Date:** 2026-10-06
**Branch:** `feature/bos-webhook-connect-repos` (worktree `neuronforge-webhook-repos`), created by RM off `origin/main` `248de6be`. `origin/main` is now `05815f69`; the only change since is one requirement doc (#239), so `route.ts` and every file this plan touches are identical on both.
**PR 0 branch:** `feature/webhook-repos-pr0-harness`, off `origin/main` `0c3c1800` (includes Fix-1 #242, Fix-1b #246, FU-5 #250, P-3a #248), same worktree.
**PR 1 branch:** `feature/webhook-repos-pr1-claim-client`, off `origin/main` `90da8301` (PR 0 merged as #254), same worktree.
**PR 2 branch:** `feature/webhook-repos-pr2-invoices`, off `origin/main` `933d661c` (PR 1 merged as #258), same worktree.
**Status:** SA approved (C-1 to C-9). Fix-1, Fix-1b and FU-5 merged. PR 0 merged (#254). PR 1 merged (#258). **PR 2 code complete 2026-10-08**, uncommitted; waiting for SA code review. Refresh and evidence in §7.3.3.

## Overview

`app/api/stripe/webhook/route.ts` is the last big route that still talks to the database directly: **51 `.from(` sites, no `.rpc(`**, all on its own module-level service-role client (`createClient(…)`, `route.ts:40`, `supabaseAdmin`), plus three helpers that take that client as an argument. This plan moves every one of them behind `lib/repositories/` and replaces the private client with the shared `supabaseServer`, **without changing what the route does**: the same queries, in the same order, with the same filters, columns, terminals, payloads and error handling.

The proof is the P-0 characterisation harness. It intercepts `@supabase/supabase-js` itself, so it records the full builder chain of every query whether the route or a repository issued it. A repository method that reproduces the chain exactly leaves the snapshot byte-identical; one that does not, fails it. The "before" is recorded in §7.1.

The work is about 5 developer days, so it is split into six sequential PRs (PR 0 to PR 5), each off `main` after the previous one merged, each with its own before/after proof (§9).

Two **pre-existing cross-tenant write holes** were found while mapping the writes (§5.2, F-1 and F-2). They are reported for SA/TL and are **not** fixed here, because this task is no-behaviour-change; each needs its own small fix PR.

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Inventory: every direct database call in route.ts](#2-inventory-every-direct-database-call-in-routets)
3. [Reuse map: repositories and methods](#3-reuse-map-repositories-and-methods)
4. [The client: module-level createClient to supabaseServer](#4-the-client-module-level-createclient-to-supabaseserver)
5. [Tenant isolation](#5-tenant-isolation)
6. [Dead and legacy code (follow-ups, not deleted here)](#6-dead-and-legacy-code-follow-ups-not-deleted-here)
7. [Proof plan](#7-proof-plan)
8. [Source guards that pin route.ts text](#8-source-guards-that-pin-routets-text)
9. [Sizing and split](#9-sizing-and-split)
10. [Files to create / modify](#10-files-to-create--modify)
11. [Task list](#11-task-list)
12. [Risks](#12-risks)
13. [Open questions for SA](#13-open-questions-for-sa)
14. [SA Review Notes](#sa-review-notes)
15. [QA Testing Report](#qa-testing-report)
16. [Commit Info](#commit-info)
17. [Change History](#change-history)

---

## 1. Analysis summary

| Item | Finding |
|---|---|
| Direct DB sites | **51** `.from(` (grep), **0** `.rpc(`, all on `supabaseAdmin`. Listed one by one in §2 |
| Client-injected helpers | 3: `pilotCreditsToTokens(…, supabaseAdmin)` (`:200`), `new QuotaAllocationService(supabaseAdmin)` (`:294`), `resolveAccountOwner(supabaseAdmin, …)` (`:1077`). They are not route queries; they get `supabaseServer` instead (§4) and are otherwise untouched |
| Tables | `processed_webhook_events`, `payment_invoices`, `payment_transactions`, `payment_refunds`, `payment_plan_installments`, `payment_plan_subscriptions`, `scheduling_bookings`, `business_profiles`, and the agent-platform tables `user_subscriptions`, `billing_events`, `credit_transactions`, `boost_pack_purchases`, `system_settings_config` |
| Already on repositories | `paymentPlanSubscriptionRepository.findBySubscriptionId / recordPeriodPaid / recordFailure / close`, `crmActivityRepository.create`. Unchanged |
| Migration | **None.** No table, column, index, grant or policy changes. Every query keeps its current shape. The tables all exist and are written today by these exact queries |
| `business-os-entitlements` | **Does not apply.** No file this plan creates or edits imports from `lib/business-os/entitlements/`, and none of the repositories it uses does (checked: `PaymentRepository`, `PaymentPlanRepository`, `PaymentPlanSubscriptionRepository`, `SchedulingRepository`, `BusinessProfileRepository`, `UserSubscriptionRepository`, `CreditTransactionRepository`, `SystemConfigRepository`). `BusinessOsBoostPurchaseRepository` does, and it is not used |
| `business-os-schema-check` | No new column claims: every column named in a new method is copied from a query that runs today. One finding came out of reading the schema: `payment_plan_installments.subscription_id` is a UUID FK to `payment_plan_subscriptions(id)` (`20260828e_payment_plan_subscriptions.sql:135`), and the webhook filters it with a Stripe subscription id (F-3) |
| `durable-queue-drain` | Not applicable (no drain); `processed_webhook_events` is a claim table and keeps its current two-phase claim exactly |
| Logging | `route.ts` has 0 `console.*` (P-0). Every repository file this plan touches has 0 `console.*` (counted: the eight above). The new repository files are Pino from the start. Nothing to flag under CLAUDE.md § Logging |
| Phase | Not V6 / not pipeline. Data-access refactor of one API route |

**What does not change, on purpose:** the order of effects, every `if`, every early return, every `throw`, every log line in the route, the Stripe calls, the response bodies and status codes. Gaps found on the way are listed as follow-ups (§5.3, §6), never fixed inline.

**Design rule for the new methods (SA to confirm, Q-3):**

- **Inserts** take a typed row that the route builds, as it does today. The row type is the allow-list (an object literal with an extra key fails `tsc`). This keeps the Stripe-to-row mapping where it is and keeps strings that source guards pin (`activity_type: 'boost_pack_purchase'`) in `route.ts`.
- **Updates and reads** are named purpose methods with the patch, filters and column list fixed inside the repository; the route passes ids and values only. Column lists are module constants, never free-form strings from the caller.
- **Exact chain:** same call order, same column string, same terminal (`.single()` / `.maybeSingle()` / plain `await`), no added `.select()` after a write, no added `user_id` filter, `new Date().toISOString()` called the same number of times.
- **Errors:** the method returns `{ data, error }` with the **same** error object Supabase returned (so `insertError.code === '23505'` and `txError.message` still work). supabase-js 2.75 does not throw on a failed query (fetch failures come back as `error` too), so wrapping in `try/catch` changes nothing the route can observe.

---

## 2. Inventory: every direct database call in route.ts

Line numbers are `route.ts` at `248de6be` (blob `0ad6e6a5`). "Keyed by" says what selects the row and where that value comes from: **event** = the signed Stripe event object; **meta(C)** = metadata on a connected account's object, which **that account writes**; **meta(P)** = metadata on a platform object, written by our own checkout; **row** = a row we already loaded. Repository methods marked **new** are specified in §3.

### 2.1 Claim (idempotency), platform and Connect

| # | Function (line) | Table · op · chain | Keyed by | Result handling | Target | PR |
|---|---|---|---|---|---|---|
| P1 | `POST` (2215) | `processed_webhook_events` select `'event_id, status'` · eq `event_id` · `maybeSingle` | event `event.id` | error logged, processing continues | `ProcessedWebhookEventRepository.findClaim` **new** | 1 |
| P2 | `POST` (2240) | update `{status:'processing', failure_message:null, processed_at}` · eq `event_id` · await | event | result ignored | `.reclaimFailed` **new** | 1 |
| P3 | `POST` (2246) | insert `{event_id, event_type, status:'processing', processed_at, metadata:{created, livemode}}` · await | event | `error.code === '23505'` → duplicate 200; other error logged, continue | `.insertClaim` **new** (returns the raw error) | 1 |
| P4 | `POST` catch (2482) | update `{status:'failed', failure_message}` · eq `event_id` · await | event | inside `try/catch`, result ignored | `.markFailed` **new** (`.slice(0, 500)` stays in route) | 1 |
| O1 | `completeClaim` (2095) | update `{status:'completed', completed_at}` · eq `event_id` · await | event | result ignored | `.complete` **new** | 1 |

### 2.2 Connect: invoices (`payment_invoices`, `business_profiles`)

| # | Function (line) | Table · op · chain | Keyed by | Result handling | Target | PR |
|---|---|---|---|---|---|---|
| H1 | `handleConnectInvoicePaid` (1189) | `payment_invoices` select `'*'` · eq `stripe_invoice_id` · `single` | event `invoice.id` | data used; error unused | `PaymentInvoiceRepository.findByStripeInvoiceId` **reuse, exact chain** | 2 |
| H2 | same (1219) | select `'*'` · eq `id` · `single` | **meta(C)** `neuronforge_invoice_id` / `invoice_id` | used only if data and no error | `.findByIdUnscoped` **new** | 2 |
| H3 | same (1230) | update `{stripe_invoice_id, updated_at}` · eq `id` · await | row from H2 (**before** the owner check, F-1) | ignored | `.recordStripeInvoiceId` **new** | 2 |
| H6 | same (1379) | update `{status:'paid', paid_at, stripe_hosted_invoice_url, stripe_invoice_pdf, updated_at}` · eq `id` | row (owned) | error → throw | `.markPaidFromStripeInvoice` **new** | 2 |
| H8 | same, receipt IIFE (1499) | select `'user_id, client_email, client_name, invoice_number, currency, booking_id'` · eq `id` · `maybeSingle` | row (owned) | fire-and-forget | `.readFieldsUnscoped(id, RECEIPT)` **new** | 2 |
| I1 | `handleConnectCheckoutCompleted` (1617) | select `'*'` · eq `id` · `single` | **meta(C)** `session.metadata.invoice_id`; owner checked next | error or no data → log, return | `.findByIdUnscoped` **new** (same as H2) | 2 |
| I3 | same (1696) | update `{status:'paid', paid_at, updated_at}` · eq `id` | row (owned) | error → throw | `.markPaidFromCheckout` **new** | 2 |
| J1 | `handleConnectInvoicePaymentFailed` (1818) | select `'id, invoice_number, user_id'` · eq `stripe_invoice_id` · `single` | event `invoice.id` | error or no data → return | `.findByStripeInvoiceId(id, FAILURE)` **reuse + optional `columns`** | 2 |
| J2 | same (1830) | update `{status:'overdue', updated_at}` · eq `id` | row | error → log, return | `.setStatusFromStripe(id, 'overdue')` **new** | 2 |
| J3 | same (1850) | select `'contact_id, amount, currency'` · eq `id` · `maybeSingle` | row | data used | `.readFieldsUnscoped(id, FAILED_ACTIVITY)` **new** | 2 |
| J4 | same (1857) | `business_profiles` select `'language'` · eq `user_id` · `maybeSingle` | row `platformInvoice.user_id` | `language \|\| 'en'` | `BusinessProfileRepository.findLanguage` **reuse, exact chain** | 2 |
| K1 | `handleConnectInvoiceFinalized` (1901) | select `'id, invoice_number'` · eq `stripe_invoice_id` · `single` | event | error or no data → return | `.findByStripeInvoiceId(id, LOOKUP)` **reuse** | 2 |
| K2 | same (1913) | update `{stripe_hosted_invoice_url, stripe_invoice_pdf, updated_at}` · eq `id` | row | error → log, return | `.recordStripeDocuments` **new** | 2 |
| L1 | `handleConnectInvoiceUncollectible` (1941) | select `'id, invoice_number'` · eq `stripe_invoice_id` · `single` | event | as K1 | `.findByStripeInvoiceId(id, LOOKUP)` **reuse** | 2 |
| L2 | same (1953) | update `{status:'cancelled', updated_at}` · eq `id` | row | error → log, return | `.setStatusFromStripe(id, 'cancelled')` **new** | 2 |

### 2.3 Connect and platform: money rows (`payment_transactions`, `payment_refunds`)

| # | Function (line) | Table · op · chain | Keyed by | Result handling | Target | PR |
|---|---|---|---|---|---|---|
| D1 | `handleDispute` (416) | `payment_transactions` select `'id, user_id, status, amount, currency, contact_id, metadata'` · `limit(1)` · then eq `stripe_payment_intent_id` **or** eq `stripe_charge_id` (`chargeId \|\| ''`) · await | event (PI or charge id) | `matches?.[0]` | `PaymentTransactionRepository.findFirstByStripeReference(ref, DISPUTE)` **new** | 3 |
| D2 | same (447) | update `{status, metadata, updated_at}` · eq `id` | row from D1 | error → log, return | `.recordDisputeState` **new** | 3 |
| E1 | `handleChargeRefunded` (514) | select `'id, user_id, invoice_id, currency'` · `limit(1)` · eq PI **or** eq `stripe_charge_id` (`charge.id`) | event | `matches?.[0]` | `.findFirstByStripeReference(ref, REFUND)` **new** | 3 |
| E2 | same, per refund (553) | `payment_refunds` upsert `{…16 fields}` · `{onConflict:'processor_refund_id'}` · await | event refund id; `user_id`/`transaction_id`/`invoice_id` from row E1 | error → log, **throw** | `PaymentRefundRepository.upsertFromStripe` **new** | 3 |
| F1 | `handleConnectPaymentIntentSucceeded` (659) | select `'id'` · eq `stripe_payment_intent_id` · `limit(1)` · `maybeSingle` | event | exists → return | `.findIdByPaymentIntentId` **new** | 3 |
| F2 | same (687) | insert `{…}` · await | `user_id` = **meta(C)** `owner_id`, checked by `accountOwns`; `contact_id`, `booking_id`, `service_id` = **meta(C)**, unchecked (F-4) | error → log, **throw** | `.insertFromWebhook(row)` **new** | 3 |
| G2 | `recordPlanPeriodPaid` (829) | insert `{…}` · `select('id')` · `single` | row (plan, owned) | error → log, **throw the raw error** | `.insertFromWebhookReturningId(row)` **new** | 3 |
| H4 | `handleConnectInvoicePaid` (1276) | select `'id'` · eq `invoice_id` · in `status` `['succeeded','refunded']` · `limit(1)` · `maybeSingle` | row (owned invoice) | exists → return | `.findSettledIdForInvoice` **new** | 3 |
| H5 | same (1327) | insert `{…}` · await | row (owned invoice) | error → log, **throw** | `.insertFromWebhook(row)` **new** | 3 |
| I2 | `handleConnectCheckoutCompleted` (1657) | insert `{…}` · await | row (owned invoice) | error → log, **throw** | `.insertFromWebhook(row)` **new** | 3 |

### 2.4 Connect: plans and bookings

| # | Function (line) | Table · op · chain | Keyed by | Result handling | Target | PR |
|---|---|---|---|---|---|---|
| G1 | `recordPlanPeriodPaid` (779) | `payment_plan_installments` select `'id'` · eq `stripe_invoice_id` · `maybeSingle` | event `invoice.id` | exists → return true | `PaymentPlanRepository.findInstallmentIdByStripeInvoiceId` **new** | 4 |
| G3 | same (896) | update `{status:'paid', paid_at, stripe_invoice_id, payment_method:'card', processor_type:'stripe', transaction_id, next_retry_at:null, updated_at}` · eq `subscription_id` · eq `installment_number` · await | row (plan id, owned) | ignored | `.markPeriodPaidFromStripe` **new** | 4 |
| G4 | same (921) | select `'due_date, amount'` · eq `subscription_id` · eq `status` `'pending'` · `order('installment_number')` · `limit(1)` · `maybeSingle` | row (plan id) | data used | `.findNextPendingPeriod` **new** | 4 |
| G5 | same (953) | `scheduling_bookings` update `{payment_status:'paid', updated_at}` · eq `id` · eq `user_id` | row (plan's booking + owner) | error → log | `SchedulingBookingRepository.markPaidForOwner` **new** | 4 |
| H7 | `handleConnectInvoicePaid` (1400) | update `{payment_status:'paid', updated_at}` · eq `id` | row (owned invoice's `booking_id`) | error → log | `.markPaidUnscoped` **new** | 4 |
| I4 | `handleConnectCheckoutCompleted` (1730) | update `{payment_status:'paid', status:'confirmed', updated_at}` · eq `id` · eq `status` `'pending'` | row (owned invoice's `booking_id`) | error → log | `.markPaidAndConfirmIfPending` **new** | 4 |
| I5 | same, booking branch (1766) | update `{payment_status:'paid', updated_at}` · eq `id` | **meta(C)** `session.metadata.booking_id`, **no owner check** (F-2) | error → log | `.markPaidUnscoped` **new** (same as H7) | 4 |
| M1 | `handlePlanSubscriptionEnded` (1998) | `payment_plan_subscriptions` select `'id, user_id, status, installment_count, periods_paid'` · eq `stripe_subscription_id` · `maybeSingle` | event `subscription.id` | no row → return | `PaymentPlanSubscriptionRepository.findEndStateBySubscriptionId` **new** | 4 |
| M2 | same (2020) | update `{status, completed_at\|cancelled_at, updated_at}` · eq `id` · await | row (owned) | ignored | `.endFromStripe(id, outcome)` **new** (not `close()`, see §3) | 4 |
| M3 | same (2032) | `payment_plan_installments` update `{status:'cancelled', next_retry_at:null, updated_at}` · eq `user_id` · eq `subscription_id` **= Stripe id** · not `status` in `(paid,cancelled)` | row owner + event id (F-3) | ignored | `PaymentPlanRepository.cancelOpenPeriodsForEndedPlan` **new** | 4 |

### 2.5 Platform, agent-platform legacy (`user_subscriptions` and friends)

| # | Function (line) | Table · op · chain | Keyed by | Result handling | Target | PR |
|---|---|---|---|---|---|---|
| A1 | `handleInvoicePaymentFailed` (77) **dead** | `user_subscriptions` select `'payment_retry_count, grace_period_days, current_period_end'` · eq `user_id` · `single` | **meta(P)** `invoice.metadata.user_id` | data used | `UserSubscriptionRepository.findDunningState` **new** | 5 |
| A2 | same (90) | `system_settings_config` select `'value'` · eq `key` · `maybeSingle` | constant key | `parseInt(value)` or 3 | `SystemConfigRepository.findRawValue` **new** | 5 |
| A3 | same (105) | `user_subscriptions` update `{payment_retry_count, last_payment_attempt, status, agents_paused}` · eq `user_id` | meta(P) | ignored | `.recordPaymentFailure` **new** | 5 |
| A4 | same (116) | `billing_events` insert `{…10 fields}` · await | meta(P) | ignored | `BillingEventRepository.insert(row)` **new repo** | 5 |
| B2 | `handleCheckoutCompleted` (205) | `user_subscriptions` select `'balance, total_earned'` · eq `user_id` · `single` | meta(P) `session.metadata.user_id` | data used | `.findBalance` **new** | 5 |
| B3 | same (219) | update `{balance, total_earned, free_tier_expires_at:null, account_frozen:false}` · eq `user_id` | meta(P) | ignored | `.applyBoostPackBalance` **new** | 5 |
| B4 | same (231) | `credit_transactions` insert `{…}` · `select('id')` · `single` | meta(P) | error logged | `CreditTransactionRepository.insertReturningId(row)` **new** | 5 |
| B5 | same (259) | `boost_pack_purchases` insert `{…}` · await | meta(P) | error logged | `LegacyBoostPackPurchaseRepository.insert(row)` **new repo** | 5 |
| C1 | `handleSubscriptionUpdated` (356) | `user_subscriptions` update `{cancel_at_period_end, canceled_at, status}` · eq `user_id` | meta(P) | ignored | `.mirrorStripeStatus` **new** | 5 |
| N1 | `handleSubscriptionDeleted` (2067) | update `{status:'canceled', canceled_at, cancel_at_period_end:false}` · eq `user_id` | meta(P) | ignored | `.markCanceled` **new** | 5 |
| N2 | same (2077) | `billing_events` insert `{user_id, event_type, credits_delta, description}` · await | meta(P) | ignored | `BillingEventRepository.insert(row)` **new repo** | 5 |

**Totals, by table:** `processed_webhook_events` 5, `payment_invoices` 14, `business_profiles` 1, `payment_transactions` 9, `payment_refunds` 1, `payment_plan_installments` 4, `payment_plan_subscriptions` 2, `scheduling_bookings` 4, `user_subscriptions` 6, `billing_events` 2, `credit_transactions` 1, `boost_pack_purchases` 1, `system_settings_config` 1 = **51 rows = the 51 `.from(` sites**. D1 and E1 are one site each with two alternative `.eq` arms. By PR: 5 + 15 + 10 + 10 + 11 = 51. A PR's "every site converted" check is the grep in §7.4.

---

## 3. Reuse map: repositories and methods

**How repositories get the client.** Every target repository already defaults to `supabaseServer` (`PaymentRepository` classes, `BusinessProfileRepository`, `UserSubscriptionRepository`, `CreditTransactionRepository`, `SystemConfigRepository` by constructor default; `PaymentPlanRepository` and `SchedulingBookingRepository` by their singleton `new …(supabaseServer)`; `PaymentPlanSubscriptionRepository` by field). New repositories follow `new-repository`: optional injected `SupabaseClient`, default `supabaseServer`, Pino `createLogger({ service })`, singleton export, `index.ts` export, and an RLS-bypass comment.

**Why existing methods mostly do not fit.** The existing methods are user-scoped (`.eq('user_id', userId)`), and most writes end in `.select().single()`. The webhook's queries are keyed by Stripe ids or by rows it already proved ownership of, and the writes return nothing. Reusing a scoped method would add a filter or a terminal, which changes the query. That is a behaviour change, so it is out of scope here and listed as a follow-up where it would be an improvement (§5.3).

| Table | Existing home | Reused exactly | New methods (purpose, exact chain) | Why new |
|---|---|---|---|---|
| `processed_webhook_events` | **none** (no repository; only the webhook and `create-checkout`'s boost path name it) | — | **New `ProcessedWebhookEventRepository`**: `findClaim`, `insertClaim`, `reclaimFailed`, `complete`, `markFailed` | No repository exists; one table, one owner. `⟨unscoped-by-design⟩`: a claim row is keyed by Stripe's globally unique event id |
| `payment_invoices` | `PaymentInvoiceRepository` (`PaymentRepository.ts`) | `findByStripeInvoiceId` (H1): same `select('*')·eq·single`, and it has **no callers today** (written for the webhook) | `findByStripeInvoiceId(id, columns = '*')` gains an optional column list from a constant (`LOOKUP`, `FAILURE`) for J1/K1/L1, default unchanged. New: `findByIdUnscoped`, `readFieldsUnscoped(id, RECEIPT \| FAILED_ACTIVITY)`, `recordStripeInvoiceId`, `markPaidFromStripeInvoice`, `markPaidFromCheckout`, `setStatusFromStripe(id, 'overdue' \| 'cancelled')`, `recordStripeDocuments` | `markAsPaid` / `updateStripeFields` are user-scoped and `select().single()`; `markAsPaid` also writes `payment_method`, `payment_notes`, `processor_type`, `next_retry_at` |
| `business_profiles` | `BusinessProfileRepository` | `findLanguage(userId)` (J4): same `select('language')·eq('user_id')·maybeSingle`; returns the string or null, and the route's `\|\| 'en'` gives the same locale | — | — |
| `payment_transactions` | `PaymentTransactionRepository` (`PaymentRepository.ts`) | — | `findFirstByStripeReference({paymentIntentId, chargeId}, DISPUTE \| REFUND)` (keeps `select → limit(1) → eq` order), `findIdByPaymentIntentId`, `findSettledIdForInvoice`, `insertFromWebhook(row)`, `insertFromWebhookReturningId(row)`, `recordDisputeState` | `create` is `insert().select().single()`; `findById` is user-scoped; `findSettledForBooking` keys on booking |
| `payment_refunds` | **none** (`RefundService`, `ledgerService` write it directly) | — | **New `PaymentRefundRepository`** with `upsertFromStripe(row)` (`onConflict: 'processor_refund_id'`) | No repository exists. Moving `RefundService`'s writes is out of scope |
| `payment_plan_installments` | `PaymentPlanRepository` | — | `findInstallmentIdByStripeInvoiceId`, `markPeriodPaidFromStripe(planRowId, installmentNumber, {stripeInvoiceId, transactionId})`, `findNextPendingPeriod(planRowId)`, `cancelOpenPeriodsForEndedPlan(userId, subscriptionId)` | `markInstallmentPaid` keys on the instalment id + `user_id` and returns the row; `cancelInstallments` keys on `payment_plan_id` + `contact_id` |
| `payment_plan_subscriptions` | `PaymentPlanSubscriptionRepository` | `findBySubscriptionId`, `recordPeriodPaid`, `recordFailure`, `close` already used | `findEndStateBySubscriptionId` (5 columns), `endFromStripe(id, 'completed' \| 'cancelled')` | `findBySubscriptionId` selects `*`; `close()` adds `cancel_reason/cancel_note/cancelled_by: null` and `.select().single()`, so it writes three more columns |
| `scheduling_bookings` | `SchedulingBookingRepository` | — | `markPaidForOwner(id, userId)`, `markPaidUnscoped(id)`, `markPaidAndConfirmIfPending(id)` | `update()` is user-scoped, pre-reads the status for evented statuses and returns a joined row |
| `user_subscriptions` | `UserSubscriptionRepository` | — | `findDunningState`, `recordPaymentFailure`, `findBalance`, `applyBoostPackBalance`, `mirrorStripeStatus`, `markCanceled` | The existing methods serve the free-tier grant and data export only |
| `billing_events` | **none** (`CreditService` writes it directly) | — | **New `BillingEventRepository`** with `insert(row)` (A4, N2) | No repository exists |
| `credit_transactions` | `CreditTransactionRepository` | — | `insertReturningId(row)` | Only `listForUserDataExport` exists |
| `boost_pack_purchases` | **none** | — | **New `LegacyBoostPackPurchaseRepository`** with `insert(row)` | No repository exists. Named `Legacy…` and documented as the **agent-platform** table, not `business_os_boost_purchases`, which `BusinessOsBoostPurchaseRepository` owns |
| `system_settings_config` | `SystemConfigRepository` | — | `findRawValue(key)` (`select('value')·eq('key')·maybeSingle`) | `getByKey` is `select('*')·single` with PGRST116 → null |

**Counts.** 38 new methods, 3 reused as they are, 1 reused with an optional argument, 4 new small repositories (`ProcessedWebhookEvent`, `PaymentRefund`, `BillingEvent`, `LegacyBoostPackPurchase`). The new-method count is high because "exact chain" rules out almost every existing method; SA may prefer fewer methods with typed patch arguments (Q-3).

**Logging in new methods.** New methods do not log on a query error by default: the route already logs every error it acts on, with the correlation id and the Stripe event id, and a second line from the repository would duplicate it. Where the route **ignores** an error today (A3, A4, B3, C1, G3, H3, M2, M3, N1, N2, O1, P2, P4), adding a repository warning would be an improvement but it is a change; listed as follow-up FU-9 (SA Q-4).

**Not touched:** `resolveAccountOwner`, `pilotCreditsToTokens`, `QuotaAllocationService` (they keep doing their own reads on the client they are given), `syncBookingsForTransactions`, `bindPlanSubscription`, `notifyOwnerOfDispute`, the dispatcher.

---

## 4. The client: module-level createClient to supabaseServer

| | `route.ts:40` `supabaseAdmin` | `lib/supabaseServer.ts` `supabaseServer` |
|---|---|---|
| URL / key | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | the same two |
| Options | `auth: { autoRefreshToken: false, persistSession: false }` | supabase-js defaults |
| Already used by this request? | — | **Yes**: `PaymentPlanSubscriptionRepository`, `syncBookingsForTransactions`, `bindPlanSubscription`, `crmActivityRepository` all run on it inside the same webhook delivery |

**Why the options difference does not reach the database.** The auth options only affect a user session. A service-role client never signs in, so there is no session to persist or refresh; `_getAccessToken()` falls back to the key in both cases. Measured rather than argued: a scratch script (`client-equivalence.js`, kept in the session scratchpad) built both clients on supabase-js **2.75.1** with a capturing `fetch` and sent the same three queries (a `maybeSingle` select, an `upsert` with `onConflict`, an update). **The three HTTP requests were identical** (URL, method, all headers incl. `apikey`, `authorization: Bearer <key>`, `accept-profile`, `x-client-info`, and body). The only difference is a no-op refresh ticker that `supabaseServer` already runs in every process that imports it.

**Plan.**

- **PR 1** replaces the `createClient(…)` call with `const supabaseAdmin = supabaseServer;` (an alias with the RLS-bypass comment below), so the remaining direct sites keep compiling and every later PR is a pure site-by-site move. The `createClient` import goes.
- **PR 5** removes the alias. The three helpers then take `supabaseServer` directly (`pilotCreditsToTokens(…, supabaseServer)`, `new QuotaAllocationService(supabaseServer)`, `resolveAccountOwner(supabaseServer, …)`).

Comment to carry in the code (Security Rules): *"Service role on purpose: a Stripe webhook has no user session. Every row is reached by a Stripe id from a signed event or by a row already proved to belong to the sending account (`accountOwns`); see the tenant-isolation notes in the webhook repositories workplan."*

Harness impact: none. The harness mocks `@supabase/supabase-js`'s `createClient`, and `lib/supabaseServer.ts` calls that same function, so `supabaseServer` **is** the harness's `mockSupabase` (same object, same `<supabase-admin>` marker in the recorded `resolveAccountOwner` arguments).

Whether the route may keep importing `supabaseServer` only to hand it to the three helpers is Q-2.

---

## 5. Tenant isolation

Per `tenant-isolation-guard`: the webhook is a service-role path that acts on ids it was handed. The defence it relies on is `accountOwns(connectAccountId, ownerId)`, which maps the **sending** connected account to its business and compares. The table below is every write, what keys it, and whether its new repository method widens scope. **No method widens scope**: each keeps exactly the filters it has today. Nothing here is fixed in this task.

### 5.1 Write-by-write

| Write | Keyed by | Source of the key | Owner proven before the write? | Method widens scope? |
|---|---|---|---|---|
| P2, P3, P4, O1 claim | `event_id` | Stripe, signed | n/a (claim table) | No |
| H3 `stripe_invoice_id` on our invoice | `id` | **meta(C)** UUID | **No: written before `accountOwns` (`:1230` vs `:1242`)** → F-1 | No |
| H6 mark paid | `id` | row from H1/H2 | Yes (`:1242`) | No |
| H5, I2 payment row insert | `user_id` = invoice owner | row | Yes | No |
| I3 mark paid | `id` | row from I1 | Yes (`:1628`) | No |
| J2, K2, L2 invoice status / documents | `id` | row found by `stripe_invoice_id` | No check; safe only because a Stripe invoice id cannot be forged, **unless H3 planted it** (F-1) | No |
| D2 dispute status | `id` | row found by PI / charge id | No `accountOwns` (Stripe ids are global; FU-3) | No |
| E2 refund upsert | `onConflict: processor_refund_id` (Stripe) | event; `user_id` etc. from our row | No `accountOwns` (FU-3). The conflict target is a Stripe id the sender cannot choose, so it cannot overwrite another tenant's refund | No |
| F2 payment row insert | `user_id` = meta(C) `owner_id` | connected account | Yes (`:647`). But `contact_id`, `booking_id`, `service_id` are also meta(C) and are **not** checked (F-4) | No |
| G2, G3, G5 plan period | plan row id; G5 adds `user_id` | row from `findBySubscriptionId` | Yes (`:745`) | No |
| H7, I4 booking paid | `id` | owned invoice's `booking_id` | Invoice owned; `booking_id` on it not re-checked, no `user_id` filter (FU-4) | No |
| **I5** booking paid | `id` | **meta(C)** `session.metadata.booking_id` | **No check at all** → F-2 | No |
| M2, M3 plan ended | plan `id`; M3 `user_id` + `subscription_id` | row from M1 | Yes (`:2008`) | No |
| A3, A4, B3–B5, C1, N1, N2 legacy | `user_id` | meta(P), written by our own checkout on the platform account | Platform-only branches (never on a Connect event since the gating of `customer.subscription.*` and P-1) | No |

### 5.2 Findings for SA and TL (pre-existing, not fixed here)

> **F-1 — HIGH, cross-tenant write. `handleConnectInvoicePaid` writes to an invoice before checking who owns it.**
> When the Stripe invoice id is not found, the handler looks our invoice up by a UUID taken from the Stripe invoice's metadata (H2), which the **connected account writes**, and immediately stores the attacker's `stripe_invoice_id` on it (H3, `:1230`). The ownership refusal comes 12 lines later (`:1242`) and does not undo the write. After that, the attacker's own Stripe invoice id points at the victim's invoice, and the three handlers that look invoices up by Stripe id and **do not check ownership** act on the victim's row for events from the attacker's account: `invoice.finalized` replaces the victim's **hosted payment URL and PDF** with the attacker's (K2), `invoice.payment_failed` marks it **overdue** (J2), `invoice.marked_uncollectible` marks it **cancelled** (L2). The victim's own later events stop finding their row by Stripe id. Precondition: the attacker knows one of the victim's `payment_invoices` UUIDs; whether any surface exposes those is for SA to establish. Fix shape (own PR, behaviour change): move the `accountOwns` check before H3, and add `accountOwns` to J/K/L.

> **F-2 — HIGH, cross-tenant write. Connect `checkout.session.completed` with a `booking_id` marks any booking paid.**
> The booking branch (`:1762–1781`, I5) takes `session.metadata.booking_id` from a session the **connected account** created and runs `update scheduling_bookings set payment_status='paid' where id = …` with **no owner check and no `user_id` filter**. Any connected business can mark another business's booking paid. Precondition: the booking UUID. Fix shape (own PR): `accountOwns` on the booking's owner, or `.eq('user_id', <account owner>)`.

### 5.3 Lower-severity gaps (follow-ups)

| # | Gap | Severity |
|---|---|---|
| F-3 | **Bug, money on the books:** `handlePlanSubscriptionEnded` cancels the remaining periods with `.eq('subscription_id', subscription.id)`, but `payment_plan_installments.subscription_id` is a UUID FK to **our** plan row (`20260828e…sql:135`). The Stripe id never matches (PostgREST answers 22P02 on a UUID column, and the error is discarded), so a plan stopped from the Stripe dashboard leaves its unpaid periods `pending`, still counted as owed. `cancelPlan.ts:278–295` documents and fixed the **same** bug on the owner path; the webhook copy was missed. The harness snapshot records the wrong value (`sub_plan_1`, scenario 8), so the fix will update that snapshot on purpose. Fix: `.eq('subscription_id', plan.id)` | Medium-High |
| F-4 | `handleConnectPaymentIntentSucceeded` writes `contact_id`, `booking_id`, `service_id` from connected-account metadata into the owner's payment row without checking they belong to that owner. Refund propagation and booking sync follow `booking_id`, so a crafted row could reach another tenant's booking | Medium |
| FU-3 | `handleDispute` / `handleChargeRefunded` never compare the transaction's owner with the sending account. Safe while Stripe ids are unforgeable; defence in depth | Low |
| FU-4 | H7 / I4 update a booking by the invoice's `booking_id` with no `user_id` filter | Low |
| FU-5 | `accountOwnerCache` is module-level, so it lives for the whole warm function instance, not "per invocation" as its comment says. A reassigned connected account could be judged on a stale owner | Low |

---

## 6. Dead and legacy code (follow-ups, not deleted here)

| # | Code | State | Follow-up |
|---|---|---|---|
| FU-1 | `handleInvoicePaymentFailed` (`:66–167`, A1–A4) | **Unreachable.** The plan resolver decides every platform `invoice.payment_failed` (deny, or `flow` → missing handler → retry), so the `switch` never calls it. Kept on purpose: `routerPlacement.guard` asserts it survives (RD-16) | Delete with RD-16, after its owner agrees |
| FU-2 | `handleCheckoutCompleted` boost-pack branch (B1–B6) | Reachable only for agent-platform boost sessions; the boost checkout was switched off in P-10a (Credits Boost FR-40), so only sessions opened before #234 can still arrive, and Checkout sessions expire within 24 h. Effectively dead now | Delete in WS-3 follow-through (and the P-1 harness scenario P6 with it) |
| FU-6 | `handleSubscriptionUpdated` / `handleSubscriptionDeleted` (C1, N1, N2) | Live for the agent platform's remaining subscriptions (P-10 kept the mirror for the portal and cancel routes) | Retire with the agent platform |
| FU-7 | `B2 → B3` read-then-write of `balance` | Not atomic: two concurrent boost deliveries could lose one increment. Moot if FU-2 lands | With FU-2 |
| FU-8 | An orphaned JSDoc (`:368–372`, "Handle business invoice.paid event") sits above two more doc blocks on `handleDispute` | Cosmetic | Any later edit of the file |
| FU-9 | Writes whose error is discarded (A3, A4, B3, C1, G3, H3, M2, M3, N1, N2, O1, P2, P4) | Silent failures; M3 is how F-3 stayed hidden | Log at `warn` (SA Q-4) |

---

## 7. Proof plan

### 7.1 The "before", recorded 2026-10-06 on the untouched tree

Tree: worktree `neuronforge-webhook-repos`, `HEAD` = `248de6be`, `git status` clean. Node 22.19.0, supabase-js 2.75.1.

**Command (characterisation harness, with coverage of the route only):**

```bash
node node_modules/jest/bin/jest.js --ci \
  --runTestsByPath app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts \
  --coverage --collectCoverageFrom=app/api/stripe/webhook/route.ts \
  --coverageDirectory=<scratchpad>/before/coverage --coverageReporters=json-summary --coverageReporters=json --coverageReporters=text
```

| Evidence | Value |
|---|---|
| Result | **1 suite, 28 tests passed, 28 snapshots passed** (19 Connect P-0 scenarios, 7 P-1 platform, 2 P-10) |
| Snapshot file `…/__snapshots__/connectPath.characterisation.test.ts.snap` | git blob **`4f5f223e9884da154b5800a0591929d5ed585c31`** (= `origin/main`); working-tree sha256 (CRLF checkout) **`be25c778fcf80ee03bf32cc2e47b6ebc8f999c93b2fac065d2029e15da3f360a`**; blob (LF) sha256 `e1e5c30c1a19b36e158cf0cd269cbc7f33c92cd66cdff12cfe54e12ee05f50f8`; 3,517 lines, 28 `exports[` |
| Snapshot hash after the run | unchanged (`be25c778…`); `git status` still clean |
| `route.ts` | blob `0ad6e6a5ad9f2f871b19900324cfe70e2a00ca3d`, working-tree sha256 `bda153cd88e41573ae9ed732eb9ab92539ee3e1f53b5d0ae58dc42e0644bb82c`, 2,512 lines, 51 `.from(` |
| Harness file | working-tree sha256 `b0d840f2eda6f30891d9e5cd49c5b1781c32b8858514a9a745d24a624b317b57` |
| Route coverage by the harness | statements 66.6 %, branches 49.18 %, functions 68 %, lines 67.54 % |
| Copies | snapshot and coverage JSON copied to the session scratchpad `before/`; the snapshot is also reproducible from git at any time (`git show origin/main:<path>`) |

**Regression set, same tree** (`--ci --runTestsByPath`, 16 files: the 6 webhook suites, `noBookingGuess.guard`, `planSurfaces.guard`, `deferredFirstPayment.guard`, `userSubscriptionsWriteLockdown.qa`, `userSubscriptionsWriteLockdownMigration`, `bookingPaymentStatusReaders.guard`, `UserSubscriptionRepository`, `PaymentRepository.getOverdueInvoices`, `BusinessProfileRepository.languageCurrency`, `scripts/__tests__/check-logging-only-diff`): **16 suites, 210 tests, 28 snapshots, all passed.**

**Scoped `tsc`** (scratch tsconfig extending the repo's, `files: [route.ts]`, 8 GB heap): **0 errors in `route.ts`**; 64 pre-existing errors in files it imports transitively (`WebsiteBlockEnrichmentService` 16, `StripeInvoiceService` 12, `website-block-translations` 7, `aiAnalytics` 6, `hubspot-plugin-executor` 5, `InvoicePDFGenerator` 3, two each in `MemoryManager` and `SchemaFieldExtractor`, one each in `WebsiteSectionService` and `ProposalAcceptanceService`). Same 64 as P-10 recorded.

**`check-logging-only-diff --exact`**, all 18 top-level functions, base `248de6be` vs working tree: **18 × identical** (sanity: the tool runs here and reports the tree untouched).

**The "before" with the PR 0 additions** (§7.3) does not exist yet: it is recorded in PR 0 on the same untouched `route.ts` (blob `0ad6e6a5…`), and PR 0 must show that the 28 existing entries are byte-identical inside the new snapshot file.

### 7.2 After each step: byte-identical, and how `-u` is prevented

- Always `node node_modules/jest/bin/jest.js --ci --runTestsByPath <files>`; never a bare path (it ran every suite in every worktree) and never `-u` / `--updateSnapshot` / `-i` interactive mode. `--ci` makes a missing snapshot a failure instead of a write; a mismatch is a failure without `-u` anyway.
- Belt and braces, after every run: `git hash-object <snap>` must equal the recorded blob (`5cc8789c…` on `0c3c1800` until PR 0 merges, then PR 0's `a673a901…`, §7.3.1), and `git diff --exit-code -- app/api/stripe/webhook/__tests__/__snapshots__/` must exit 0. A hash mismatch is a stop, whatever Jest printed.
- The harness file itself is not edited after PR 0. Its blob after PR 0 (`a7cc9992…`, §7.3.1) is checked in PR 1 to PR 5 the same way.

### 7.3 Does the harness cover every converted site? Gaps and proposed additions

From the coverage run, every DB site is executed by at least one scenario **except**:

| Gap | Sites | Why it matters |
|---|---|---|
| `handleSubscriptionDeleted` never runs | N1, N2 | Reachable in production (platform `customer.subscription.deleted` is `not_business_os`) |
| `handleInvoicePaymentFailed` never runs | A1–A4 | Unreachable through `POST` (FU-1), so only a dispatcher override can reach it |
| Charge-id branch of the PI-or-charge lookup | D1, E1 (`:421`, `:519` alternate arm) | The new method builds the query conditionally; both arms must be pinned |
| `completed` arm of plan end | M2 (`completed_at` key), M3 skipped | Different payload key |
| Claim insert conflict | P3 `23505` branch | The repository must return the raw error code |
| Plan period: already recorded / final period / no booking | G1 hit, `close` path, G5 skipped | Order and presence of effects |
| Connect invoice already paid on checkout | I1 early return | — |
| Connect plan payment failed | `recordFailure` branch (`:1806`) | No direct DB, but pins the order before J1 |

**Proposed harness additions (PR 0, tests only, recorded against the untouched route):**

| # | Scenario | Mechanism |
|---|---|---|
| X1 | Platform `customer.subscription.deleted` with legacy `user_id` → N1, N2 | New fixture `fixtures/platform/subscription-deleted-legacy.json` |
| X2 | Platform `invoice.payment_failed` reaching the legacy dunning, grace from the user row → A1, A3, A4 | New scenario knob `dispatch: 'not_business_os'` (mocks `dispatchBusinessOsEvent` for that scenario only; real dispatcher otherwise) |
| X3 | Same, `grace_period_days` null → A2 `system_settings_config` | X2 + DB answer |
| X4 | `charge.refunded` on the **platform**, no payment intent → E1 charge-id arm, E2 with `stripe_connect_account_id: null` | New knob `eventPatch` (deep-merge into the fixture) |
| X5 | `charge.dispute.closed`, won, charge-id only, `metadata.status_before_dispute` set → D1 charge-id arm, D2 restore | `eventPatch` |
| X6 | Connect `customer.subscription.deleted`, plan complete (`periods_paid = installment_count`) → M2 `completed_at`, no M3 | DB answer |
| X7 | `invoice.paid` plan period, last period, no booking → G1 miss, `close`, G5 skipped | `planLookup` |
| X8 | `invoice.paid` plan period already recorded → G1 hit, return | DB answer |
| X9 | Connect checkout for an invoice already `paid` → early return | DB answer |
| X10 | Claim insert returns `23505` → duplicate, 200 | DB answer |
| X11 | Connect `invoice.payment_failed` for an owned plan → `recordFailure`, return | `planLookup` |

PR 0 also makes the `PaymentPlanSubscriptionRepository` mock **fall through** to the real module for any method it does not list (a `Proxy` over `jest.requireActual`), so PR 4's two new methods run against `mockSupabase` and record their chains exactly as the inline queries do today. The same fall-through goes into `routerEdgeCases.qa.test.ts`, which mocks the same module. Neither change alters an existing scenario (no existing scenario calls an unlisted method), which PR 0's proof shows: the 28 old `exports[...]` entries must be byte-identical (compared entry by entry, by a short script, not by eye).

Adding scenarios writes new snapshot entries, so PR 0 runs once **without** `--ci` to write them, then again with `--ci`, then the entry-by-entry comparison. That is the one run in the whole plan allowed to write the file.

### 7.3.1 PR 0 refresh (2026-10-07, against `0c3c1800`)

§7.3 was written on `248de6be` (28 entries). Fix-1 (#242), Fix-1b (#246) and FU-5 (#250) have merged since, so the gap list is re-derived from a fresh coverage run on `0c3c1800`. Line numbers below are `route.ts` at `0c3c1800` (blob `df671c4a…`, 2,668 lines, 51 `.from(`).

**What changed against §7.3:**

- **Already covered now, dropped:** none of X1–X11 was closed by the fixes. Fix-1 added entries for the refusals at H2/H3, J, K, L, I5 and F2's links, so those branches are not added again.
- **Kept:** X1–X11. X2/X3 stay: `handleInvoicePaymentFailed` is **not reachable through `POST`** today (the Business OS router decides every platform `invoice.payment_failed`, deny or flow, before the switch). It is covered with the `dispatch` knob (SA Q-6 accepted it), and the entries say so in their names. Listing it instead would leave A1–A4, four PR 5 sites, unpinned.
- **Added:** every result-handling branch of a site PRs 1–5 convert that the run shows unexecuted: the miss, the error and the hit arms. The repository has to hand the route the same `data` / `error` on each arm, and only an executed arm proves it. Plus the early returns that sit between a moved read and a moved write.
- **Not harness-observable, so not added here** (both modules are mocked in the harness, on purpose): bind's five queries (PR 4) and `resolveAccountOwner`'s two reads (PR 5). Their proof is their own unit tests; their coverage is recorded in the evidence below.

**Mechanism (SA Q-6 / C-4, no `Proxy`):**

| Knob / change | Scope | Effect on the 45 existing entries |
|---|---|---|
| `eventPatch` | Deep-merged into the fixture (plain objects merge; anything else, `null` included, replaces). Used only by new scenarios | None: absent means the fixture as read |
| `dispatch: 'not_business_os'` | `@/lib/business-os/billing/webhookDispatcher` is mocked as the real module, with `dispatchBusinessOsEvent` overridden **only** when a scenario sets `dispatch`. The override is recorded as an effect, so an entry that used it shows it | None: unset delegates to the real dispatcher with the same arguments and records nothing |
| `PaymentPlanSubscriptionRepository` mock: explicit delegation list | Two named methods, `findEndStateBySubscriptionId` and `endFromStripe` (PR 4's, §3), delegate to `jest.requireActual(…).paymentPlanSubscriptionRepository`, resolved at call time, recording nothing of their own (their DB chain records through `mockSupabase`, as the inline query does today). Nothing else delegates; the four recorded methods are unchanged | None: no route code calls them before PR 4 |
| The same two delegations in `fix1Ownership.qa.test.ts` | **Deviation from §10**, which named `routerEdgeCases.qa.test.ts`. No scenario there reaches `handlePlanSubscriptionEnded`. `fix1Ownership.qa` (written after §10) does (`:2151 Connect customer.subscription.deleted`), so without the delegation PR 4 would turn that site into a `TypeError` | None (QA suite, no snapshots) |

**New scenarios (one snapshot entry each, in a new `describe`, "CF-5 PR 0"):**

| # | Scenario | Sites / lines it executes | For PR |
|---|---|---|---|
| X10 | Claim insert answers `23505` → duplicate, 200 | P3 `:2418` | 1 |
| X12 | Claim insert answers another error → logged, processing continues, completed at the end | P3 `:2422`, O1 | 1 |
| X13 | Claim lookup answers an error → logged, processing continues | P1 `:2378` | 1 |
| X53 | Claim insert fails, then the handler throws → 500, nothing to release (P4 skipped) | `:2636` false arm | 1 |
| X48 | `invoice.paid` found neither by Stripe id nor by the metadata id → no write | H2 miss `:1309` | 2 |
| X49 | Checkout for an invoice with no booking → paid, no booking write | `:1826` false arm (I4 skipped) | 2 |
| X52 | `invoice.payment_failed`, owner has no business profile → activity in English | J4 miss, `\|\| 'en'` `:1994` (the equivalence SA relied on for `findLanguage`) | 2 |
| X50 | `invoice.payment_failed` whose subscription names no plan → falls through to J1 | `:1927` false arm | 4 |
| X51 | Connect subscription deleted, not our plan → no write | M1 miss `:2158` | 4 |
| X9 | Checkout for an invoice already `paid` → return | I1 hit, `:1737` | 2 |
| X14 | Checkout for an invoice not found | I1 miss `:1722` | 2 |
| X15 | Checkout for an invoice another business owns → refused | `:1729` (between I1 and I2) | 2 |
| X16 | Checkout: marking the invoice paid fails → 500 | I3 error `:1804` | 2 |
| X17 | `invoice.paid`: marking the invoice paid fails → 500 | H6 error `:1489` | 2 |
| X18 | `invoice.payment_failed`: no platform invoice | J1 miss `:1946` | 2 |
| X19 | `invoice.payment_failed`: the overdue update fails | J2 error `:1971` | 2 |
| X20 | `invoice.payment_failed`: invoice has no contact → no profile read, no activity | J3 data, J4 skipped (`:1988`) | 2 |
| X21 / X22 | `invoice.finalized`: no invoice / update fails | K1 miss `:2040`, K2 error `:2065` | 2 |
| X23 / X24 | `invoice.marked_uncollectible`: no invoice / update fails | L1 miss `:2090`, L2 error `:2114` | 2 |
| X4 | Platform `charge.refunded`, no payment intent | E1 charge-id arm `:524`, E2 with `stripe_connect_account_id: null` | 3 |
| X5 | `charge.dispute.closed`, won, charge id only, `status_before_dispute` set | D1 charge-id arm `:426`, D2 restore | 3 |
| X25 / X26 | `charge.refunded`: unknown payment / refund upsert fails → 500 | E1 miss `:532`, E2 error `:583` | 3 |
| X27 / X28 | Dispute: unknown payment / update fails | D1 miss `:434`, D2 error `:474` | 3 |
| X29 | `payment_intent.succeeded` already recorded | F1 hit `:703` | 3 |
| X30 | Plan period: transaction insert fails → 500 (raw error thrown) | G2 error `:943` | 3 |
| X31 / X32 | `invoice.paid`: payment already recorded / transaction insert fails → 500 | H4 hit `:1383`, H5 error `:1464` | 3 |
| X33 | Checkout invoice: transaction insert fails → 500 | I2 error `:1782` | 3 |
| X6 | Connect subscription deleted, plan complete → `completed_at`, no M3 | M2 completed arm `:2176`, M3 skipped | 4 |
| X7 | Last plan period, no booking → `close`, no booking write | G1 miss, `:1000`, G5 skipped | 4 |
| X8 | Plan period already recorded | G1 hit `:850` | 4 |
| X11 | Connect `invoice.payment_failed` for an owned plan → `recordFailure`, return | `:1925–1934` (before J1) | 4 |
| X34 | Plan period: booking update fails → logged, 200 | G5 error `:1027` | 4 |
| X35 | Plan period from an account that does not own the plan → refused, no G1 | `:810` | 4 |
| X36 | Plan invoice that collected nothing → no G1 | `:836` | 4 |
| X37 | `invoice.paid`: booking update fails → logged | H7 error `:1507` | 4 |
| X38 | Checkout invoice: booking confirm fails → logged | I4 error `:1850` | 4 |
| X39 | Checkout booking: update fails → logged | I5 error `:1890` | 4 |
| X40 | Connect subscription deleted, plan owned by another business → refused, no M2 | `:2161` | 4 |
| X41 | Connect subscription deleted, plan already `cancelled` → no write | `:2168` | 4 |
| X1 | Platform `customer.subscription.deleted`, legacy `user_id` | N1, N2 (`:2209–2238`) | 5 |
| X42 | Same, no `user_id` → nothing written | `:2214` | 5 |
| X2 | Platform `invoice.payment_failed` via `dispatch`, grace from the user row | A1, A3, A4 | 5 |
| X3 | Same, grace null → system config | A2 | 5 |
| X43 | Same, no `user_id` → nothing written | `:74` | 5 |
| X55 | Same, no user row and no config row → grace defaults to 3 | A1 miss `:86–103`, A2 miss `:99` | 5 |
| X44 | Boost checkout, no `user_id` → nothing written | `:183` | 5 |
| X54 | Boost checkout on an existing balance → the credit transaction's id reaches the purchase row | B2 hit `:214–215`, B4 data `:257`, `:267` | 5 |
| X45 | Boost checkout: credit transaction and boost purchase inserts both fail → logged, not thrown | B4 error `:255`, B5 error `:281` | 5 |
| X46 | Boost checkout without `boost_pack_id` → B5 skipped | `:286` | 5 |
| X47 | Platform `customer.subscription.updated`, no `user_id` → nothing written | `:344` | 5 |

**55 new entries**: the 11 from §7.3, 36 from the first coverage pass, X48–X53 from reviewing the cold branch arms after it, and X54–X55 from a second pass over the arms that read a query result (rows grouped by PR above). Time-dependent values are kept out on purpose: X2/X3/X55 use `current_period_end: null` (or no row), so `days_since_period_end` is 0 on any day.

**Proof steps (C-7 included):** record the 45 entry hashes and the suite time on the untouched tree; write the new entries only with `--ci=false` and `-t` anchored to the new entries (three such runs, below; §7.3 planned one); re-run everything with `--ci`; compare entry by entry (45 identical, 55 new, 0 changed or missing); record coverage and time again; `route.ts` blob unchanged.


#### PR 0 evidence (2026-10-07)

Tree: worktree `neuronforge-webhook-repos`, branch `feature/webhook-repos-pr0-harness`, `HEAD` `0c3c1800`, Node 22.19.0. Every Jest run is `node node_modules/jest/bin/jest.js --ci --runTestsByPath …`, except the three write runs listed below.

**Before (untouched `0c3c1800`):**

| Evidence | Value |
|---|---|
| Harness | 1 suite, 47 tests, **45 snapshots**, all passed |
| Snapshot blob | `5cc8789c09b887bef4181acd281e1153ae457861` (= `HEAD`), 6,011 lines, 45 `exports[` |
| `route.ts` | blob `df671c4addda96f59c4d01b463ceb59c994aa2ec`, 2,668 lines, 51 `.from(` |
| Harness / `fix1Ownership.qa` blobs | `e172c18e988d37f9c55a93eb8aabcc8dc5b4f3db` / `5fc0bf242a9c6d55c8ef0d54cc26453578b2bb3a` |
| Route coverage by the harness (same command as §7.1) | statements **73.09 %** (421/576), branches **59.02 %** (438/742), functions 76.66 %, lines 73.8 %. Cold `.from(` sites: **6** (`:81`, `:94`, `:108`, `:119`, `:2219`, `:2229`, i.e. A1–A4, N1, N2) |
| Per-entry hashes | sha256 of each `exports[…]` value (a script evaluates the `.snap` and hashes each entry): 45 entries, kept in the session scratchpad. Three pairs are equal on purpose, because their effects are the same: 9a = 9b, F1-1 = F1-2, F4-1 = F4-4 |

**Writing the new entries (the only runs allowed to write; each anchored with `-t`, none with `-u`):**

1. `--ci=false -t "^Stripe webhook, CF-5 PR 0: arms the repository moves will touch "`: 47 written, the 47 other tests skipped, 0 updated.
2. After a review of the cold branch arms added X48–X53: `-t "… touch X(48|49|50|51|52|53)\. "`: 6 written, 94 skipped, 0 updated.
3. After a second pass over arms that read a query result added X54–X55: `-t "… touch X(54|55)\. "`: 2 written, 100 skipped, 0 updated.

Before step 1, a `--ci` run with the new knobs and mocks in place passed all 45 existing entries and wrote nothing (blob still `5cc8789c…`). After each write run the entry comparison was repeated: 45 → 92 → 98 → 100 entries, with every earlier entry identical each time.

**After:**

| Evidence | Value |
|---|---|
| Harness | 1 suite, **102 tests, 100 snapshots**, all passed with `--ci` |
| Snapshot blob | `a673a9019e8486375aaf240575f325f701870413`, 13,418 lines, 100 `exports[`. `git diff --numstat`: **7,407 insertions, 0 deletions** |
| Entry by entry | **45 identical, 0 changed or missing, 55 new** (script comparison, not by eye) |
| Each new entry read | Condensed to its effect sequence and checked against its name. For example: X4 filters `stripe_charge_id = ch_connect_1` and upserts both refunds with `stripe_connect_account_id: null`; X5 writes `status: 'refunded'` back; X10 answers `{ received, duplicate }`; X2/X3 reach `user_subscriptions` select → (`system_settings_config`) → update → `billing_events` insert → audit with `days_since_period_end: 0`; X55 falls back to 3 grace days; X6 writes `completed_at` and no `payment_plan_installments` update; X52's activity title is `Payment failed: $120.00`; X54 writes `transaction_id: 'ctx-1'` and `balance_before: 2500`; X53 has no claim update after the throw |
| `route.ts` | blob **`df671c4a…`, unchanged**; `git diff --exit-code` on it exits 0 |
| Harness blob | `a7cc9992a002780e876a6f7ef82d73b9aff32d99` (PR 1 to PR 5 check it, §7.2) |
| `fix1Ownership.qa.test.ts` blob | `f509e75e53c96d3c920f25aabdf7da0c9bb3ff59` (after CR-1 / PR0-Q6: the two delegations plus the `:595` annotation) |
| `bindPlanSubscription.test.ts` blob (CR-1 + QA note) | `2e7b97317b6ca22c1c3b0f64347317c7f6b59fc6` (was `e233ac01…` on `0c3c1800`; `e87c78f2…` after CR-1 alone). PR 4 checks it the same way (§7.2) and must pass it unedited |
| New fixture `fixtures/platform/subscription-deleted-legacy.json` | blob `f8473c63c4b2dd304356ee72358cea17035c256d` |
| Route coverage by the harness | statements **91.49 %** (527/576), branches **75.6 %** (561/742), functions 86.66 % (26/30), lines 92.21 % (521/565). **Cold `.from(` sites: 0 of 51** |

**Suite run time (C-7).** Measured interleaved, so both sides saw the same machine load: the `origin/main` harness and snapshot were copied to a temporary file in the same folder, run alternately with the final new file, then deleted. Pairs 1–3 ran while the machine was loaded (the base alone took up to 23.8 s) and are discarded:

| Pair | Base (47 tests) Jest time | New (102 tests) Jest time |
|---|---|---|
| 4 | 4.32 s | 4.91 s |
| 5 | 4.05 s | 5.02 s |
| 6 | 3.97 s | 4.45 s |
| 7 | 3.77 s | 4.49 s |
| 8 | 3.49 s | 5.16 s |
| **Median** | **3.97 s** | **4.91 s** |

So about **+0.9 s** per run of this suite (about 17 ms per new scenario), measured on this Windows machine. The suite runs in one shard of the Jest gate, which already finishes ahead of `Build`, so the critical path should not move. SA to confirm against the shard timings on the PR.

**Regression set** (`--ci --runTestsByPath`, 55 files: every `app/api/stripe/webhook/__tests__/*.test.ts`, every `lib/payments/__tests__/*.test.ts`, `app/api/stripe/__tests__/noBookingGuess.guard` and `stripeAuditEntries`, `lib/repositories/__tests__/userSubscriptionsWriteLockdown.qa`, `userSubscriptionsWriteLockdownMigration`, `bookingPaymentStatusReaders.guard`, `lib/business-os/__tests__/noPilotCreditTableReads.guard`): **55 suites, 931 tests, 100 snapshots, all passed.** Snapshot blob still `a673a901…` after it.

After CR-1 and the PR0-Q6 fix, the same 55 files: **55 suites, 934 tests, 100 snapshots, all passed**; snapshot blob still `a673a901…`; `bindPlanSubscription.ts` blob `23a38fdd…` = `HEAD` (untouched).

**Scoped checks.** ESLint on the two changed test files: 0 problems. `tsc` (scratch tsconfig, `files` = the two test files, 8 GB heap): **0 errors in the harness**. 1 error in `fix1Ownership.qa.test.ts:596` (`withMetadata(…, metadata)` argument type). It is pre-existing from FU-5 (the same line is `origin/main:586`; my edit is 10 lines at `:135`) and is not fixed here.

After CR-1 and PR0-Q6: scoped `tsc` with `files` = the harness, `fix1Ownership.qa.test.ts` and `bindPlanSubscription.test.ts`: **0 errors** (exit 0). ESLint on all three: 0 problems.

**Not harness-observable (mocked modules), covered by their own unit tests instead.** Coverage of the two files by `bindPlanSubscription.test.ts` + `stripeAccountContext.test.ts`: `bindPlanSubscription.ts` lines 94.36 %, cold lines **431** (installments insert error), **454** (booking plan-link update error) and **483–484** (`resolveContactId` read error); `stripeAccountContext.ts` lines 100 %, only branch arms cold. The bind error arms are PR 4 sites (open question for SA below).

**CR-1 (SA PR 0 code review), done.** Three tests added to `lib/payments/__tests__/bindPlanSubscription.test.ts` in a new `describe` ("write and read errors (CF-5 PR 0, CR-1)"), against the untouched bind, through the existing `@/lib/supabaseServer` mock. The mock gained two knobs, both off by default (`updateError`, `contactReadError`), and records every awaited update with its full chain (`mockUpdates`). With the knobs off it answers exactly as before, and the 28 existing tests pass unchanged.

| Test | Arm | Asserts |
|---|---|---|
| installments insert fails | `:431` | bind resolves (`scheduleId: 'sched_1'`); the error line is logged; the booking plan-link update is still sent, with `eq('id', bookingId)` and `eq('user_id', ownerId)` |
| booking plan-link update fails | `:454` | bind resolves without throwing; the update was sent once; the error line is logged |
| booking contact read fails | `:483–484` | all three projected periods carry `contact_id: null`; bind resolves |

Result: 31 tests (28 + 3), all passed. Coverage of `bindPlanSubscription.ts` by that file alone: **lines 100 %** (was 94.36 %, with 431, 454 and 483–484 cold); statements 100 %, functions 100 %, branches 85.89 % (only value-fallback arms left).

**QA note (Medium), done.** QA showed that three bind read filters were pinned by no test: removing any one left all 31 green. A new `describe`, "read chains pinned (CF-5 PR 0)", asserts the **full** recorded chain of each read against the untouched bind. The mock also records reads awaited on the builder (`mockAwaitedReads`, needed for the period count, which is not a `maybeSingle`). As SA suggested, the `:483–484` test now also asserts that the `select('contact_id')` read was actually issued.

| Test | Read | Chain asserted (`toEqual`) |
|---|---|---|
| contact read scoped to booking and owner | `:476–480` | `select('contact_id')`, `eq('id', booking)`, `eq('user_id', owner)` |
| fallback plan read | `:508–516` | `select('id')`, `eq('user_id')`, `eq('service_id')`, `eq('is_active', true)`, `order('created_at', asc)`, `limit(1)` |
| already-bound period count | `:143–146` | `select('id', { count: 'exact', head: true })`, `eq('subscription_id', plan id)` |

**Mutant proof.** A temporary copy of bind (its `./` imports rewritten to `@/lib/payments/`) and a copy of the test file were placed in a temp folder, run once per mutant, then deleted. The real bind was never touched (blob `23a38fdd…` = `HEAD` before and after).

| Mutant | Result |
|---|---|
| Control (copy, no mutation) | 34 / 34 passed |
| M1: `:479` `.eq('user_id', ownerId)` removed (contact read tenant filter) | **1 failed**: "the booking contact read is scoped to the booking AND its owner" |
| M2: `:146` `.eq('subscription_id', …)` removed | **1 failed**: "the already-bound check counts the periods of THIS plan only" |
| M3: `:513` `.eq('is_active', true)` removed | **1 failed**: "the fallback plan read takes the oldest ACTIVE plan of this owner for the service" |

Each mutant is killed by exactly its own test. The file now has 34 tests, all passing; ESLint is clean and scoped `tsc` on it gives 0 errors. Regression set (same 55 files): **55 suites, 937 tests, 100 snapshots**, all passed. Snapshot blob still `a673a901…`.

**Still cold in `route.ts` after PR 0, each with its reason.** None is a DB site; every `.from(` executes.

| Lines | What | Why not added |
|---|---|---|
| 158 | Audit failure catch in the legacy dunning | The `auditLog` mock never throws; no DB site |
| 306–317 | Quota allocation failure; a platform subscription checkout that bypassed the router | No DB site; the router denies subscription sessions first |
| 505, 2016 | Fire-and-forget failure catches (dispute alert, CRM activity) | No DB site |
| 669–680 | `payment_intent.succeeded` with no `owner_id` | No DB site; returns before F1. The "Stripe-generated" arm needs `metadata: {}`, which `eventPatch` cannot express (it merges) |
| 872–873, 877 | Plan payment intent not resolved | Resolver mock; no DB site |
| 1115–1119, 1245–1246, 1702–1706 | `bindPlanSubscription` throws | Bind is mocked; no DB site. The Fix-1 and FU-5 QA suites cover the rethrow |
| 1577 | Audit failure catch on `invoice.paid` | The `auditLog` mock never throws |
| 1608–1627 | Receipt sent (`client_email` present) | H8's query **is** executed in every paid scenario; only its data arm is cold. Covering it needs a `BookingEmailService` mock inside a fire-and-forget IIFE that one `setImmediate` does not reliably settle, so the entries could flake. PR 2's unit test for `readFieldsUnscoped(id, RECEIPT)` pins the shape instead (§7.5) |
| 1904 | Connect checkout with neither invoice nor booking | No DB site |
| 2287, 2303–2309, 2325–2326, 2341, 2348–2349 | Signature, body and secret guards | No DB site, before the claim; `emptyBody.guard` covers 2303 |
| 2479–2481 | A registered Business OS flow handler | Unreachable: `BUSINESS_OS_FLOW_HANDLERS` is empty until P-3b. Its `completeClaim` is the same O1 every other path runs |
| 2495, 2598–2599, 2619 | Platform `invoice.paid` past the router, `charge.dispute.funds_reinstated`, unhandled type | No DB site of their own; the `completeClaim` after them is O1, which runs everywhere |
| 2648 | The claim release itself throws | supabase-js does not throw on a failed query (§1), and the mock models that. A throw here needs a network-level failure |

**Branch arms still cold: 181 of 742** (from 304). Almost all are `?.` / `??` / `||` value fallbacks inside payloads. Two sit on a query result and are left on purpose, because the shape cannot occur: `:968` (G2 succeeded but returned no row; `insert().select('id').single()` without an error always returns one) and `:1988` (J3 found no row for the invoice J1 found a moment earlier). Every other miss, error and hit arm of a moved query executes, except the H8 data arm above.

#### PR 0: deviations and questions for SA

| # | Item | Dev's position |
|---|---|---|
| PR0-Q1 | **Bind's error arms are cold** (`bindPlanSubscription.ts:431`, `:454`, `:483–484`), and PR 4 moves exactly those queries. They are not harness-observable (bind is mocked), so PR 0 does not cover them | PR 4's first task: add the three error-path unit tests to `bindPlanSubscription.test.ts` against the **untouched** bind, then convert. Alternatively PR 0 grows by those three tests. SA to choose |
| PR0-Q2 | **Three anchored write runs, not one** (§7.3 planned one). Each was `-t`-anchored to new names only, wrote only new entries (47, 6, 2) and updated none, and the entry comparison was repeated after each | Accept as recorded |
| PR0-Q3 | **§10 deviation**: the two named delegations went into `fix1Ownership.qa.test.ts`, not `routerEdgeCases.qa.test.ts`. The QA suite reaches `handlePlanSubscriptionEnded` through its mocked plan repository; the edge-case suite never does | Accept |
| PR0-Q4 | **Dead code pinned**: X2, X3, X43 and X55 reach `handleInvoicePaymentFailed` only through the `dispatch` override. The entries say so in their names. They are what lets PR 5 prove A1–A4 | Accept; deleting the dead handler stays FU-1 |
| PR0-Q5 | **Snapshot size**: 6,011 → 13,418 lines. Every entry is a full effect trace by design (P-0) | Accept; trimming the format would change the 45 existing entries |
| PR0-Q6 | **Pre-existing type error** `fix1Ownership.qa.test.ts:596` (from FU-5), seen in the scoped `tsc` | **Fixed in PR 0** (SA: optional, single annotation): `as Record<string, string>[]` on the `for … of` array (now `:595`). No runtime change; scoped `tsc` 0 errors |

### 7.3.2 PR 1 refresh (2026-10-07, against `90da8301`)

Branch `feature/webhook-repos-pr1-claim-client`, off `origin/main` `90da8301` (PR 0 merged as #254). `route.ts` is still blob `df671c4a…` (2,668 lines, 51 `.from(`), so the PR 0 line numbers hold. The route now has **20** top-level functions, not the 18 of §7.1 (Fix-1 added `ownedOrNull`, FU-5 `accountOwner`), so PR 1's untouched set is **18**.

**Sites, exact lines at `90da8301`:**

| Site | Lines | Today | After PR 1 |
|---|---|---|---|
| client | `:7` import, `:42–51` | `createClient(URL, SERVICE_ROLE_KEY, { auth: … })` | `import { supabaseServer } from '@/lib/supabaseServer'` at `:7`; `const supabaseAdmin = supabaseServer;` with the §4 RLS-bypass comment. PR 5 removes the alias |
| O1 `completeClaim` | `:2246–2251` | update `{status:'completed', completed_at}` · eq `event_id` | `await processedWebhookEventRepository.complete(eventId)` |
| P1 | `:2371–2375` | select `'event_id, status'` · eq · `maybeSingle` | `processedWebhookEventRepository.findClaim(event.id)`, same destructuring |
| P2 | `:2396–2399` | update `{status:'processing', failure_message:null, processed_at}` · eq | `processedWebhookEventRepository.reclaimFailed(event.id)` |
| P3 | `:2402–2413` | insert `{event_id, event_type, status:'processing', processed_at, metadata:{created, livemode}}` | `processedWebhookEventRepository.insertClaim({ …the same object literal… })` |
| P4 | `:2638–2644` | update `{status:'failed', failure_message}` · eq, inside the release `try/catch` | `processedWebhookEventRepository.markFailed(processedEventId, String(…).slice(0, 500))`, same `try/catch` |

**Final method names** (the §3 names, kept): `findClaim(eventId)`, `insertClaim(row)`, `reclaimFailed(eventId)`, `complete(eventId)`, `markFailed(eventId, failureMessage)`. New file `lib/repositories/ProcessedWebhookEventRepository.ts`; no existing repository names the table, so there is nothing to reuse.

**Design, per SA C-3 and Q-3:**

- One section headed `// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)`. All five methods sit in it. Each doc comment carries `⟨unscoped-by-design⟩` and names what it relies on instead of an owner check: the claim row is keyed by Stripe's globally unique event id, taken from an event whose signature `POST` verified before the first claim query. The table has a `user_id` column (purge descriptors), but the claim never writes or reads it, and a filter on it would change the query.
- One column constant, `CLAIM_COLUMNS = 'event_id, status'`, typed as its own literal (a closed union of one).
- `insertClaim(row: NewWebhookClaimRow)`: the row type fixes `status: 'processing'` and the metadata shape. The route passes an object literal, so an extra key fails `tsc`.
- No generic update. Each update is a named transition with its patch fixed inside the method; the route passes only the event id (and, for `markFailed`, the message it already truncates).
- Exact chains: same table, operation, payload keys, filter and terminal; no `.select()` after a write; `new Date().toISOString()` called once per write that has it today.
- **No `try/catch` in the methods, and no logging.** Each returns supabase-js's own `{ data, error }` (the same error object, so `insertError.code === '23505'` still works). supabase-js does not throw on a failed query. If something below it ever did throw, `POST`'s release `try/catch` must still see it, so "Could not release failed event" is still logged (the §11 PR 1 note). A catch in the repository would silence that line. No logging because the route already logs every error it acts on, and Q-4 keeps the discarded ones (P2, P4, O1) a follow-up (FU-9).
- Default client `supabaseServer`, optional injected client, singleton, `index.ts` export (new-repository skill).

**The PR 1 note, kept as a note.** When the database is fully down, the release (P4) returns an error that `POST` ignores (supabase-js returns, it does not throw), so the row stays `processing` and later deliveries are answered "duplicate". PR 1 does not change that. It is written into the repository's `markFailed` comment, so the next reader of the claim code meets it.

**Guard audit (C-2): every check on `route.ts` text that names this table, the claim or the client, and where it bites after PR 1:**

| Guard | Check today | After PR 1 |
|---|---|---|
| `routerPlacement.guard` "every claim completion goes through completeClaim()" | Positive: `completeClaim`'s code contains `status: 'completed'`. Negative: no other `status: 'completed'` property in the route, outside `completeClaim` | **Moved and tightened.** Positive: `completeClaim` calls `processedWebhookEventRepository.complete(`, and the repository's `complete` method contains `status: 'completed'`. Negatives: (a) **no** `status: 'completed'` property anywhere in the route (the `completeClaim` exception is gone, because it no longer needs one); (b) none in the repository file outside `complete`; (c) `processedWebhookEventRepository.complete(` is called only inside `completeClaim`, so the deny, flow and switch paths cannot complete a claim around it. The "`completeClaim` called at least 3 times in POST" check is unchanged |
| **New** `it` in the same suite (C-7: no new suite, the route's `SourceFile` is reused) | — | The route code (comments excluded) has no `from('processed_webhook_events')`, and `POST` calls `findClaim`, `reclaimFailed`, `insertClaim` and `markFailed` once each. This is PR 1's "every site converted" check |
| `userSubscriptionsWriteLockdown.qa` writer list, `route.ts // supabaseAdmin` | The route writes `user_subscriptions` | Unchanged, still true: the writes still go through `supabaseAdmin`, now an alias of `supabaseServer`. PR 5 removes the entry (§8) |
| `userSubscriptionsWriteLockdown.qa` construction site `QuotaAllocationService(supabaseAdmin)` | Text of the call | Unchanged (`handleCheckoutCompleted` is in the `--exact` untouched set) |
| `noBookingGuess.guard:66` `not.toMatch(from('payment_invoices')…booking_id:)` | `handleConnectInvoicePaid` | Unaffected: that handler is in the untouched set. Re-homed in PR 2 (C-2) |
| `pinoLogging.guard` (≥ 133 log calls), `emptyBody.guard`, `receiptOnPaid.guard`, `deferredFirstPayment.guard` | Log calls, strings | Unaffected: no log line moves, none of their strings is in the claim code |
| `planSurfaces.guard:32` `not.toMatch(from('payment_plan_installments'))` | `PaymentsSection.tsx`, not the route | Unaffected |

The QA suites that read the claim as behaviour (`fix1Ownership.qa`, `ownerCacheRetry.qa`, `planOwnership.qa`, `routerEdgeCases.qa`, `stripeAuditEntries`) mock `@supabase/supabase-js`'s `createClient`, which `lib/supabaseServer.ts` calls too, so the repository's queries reach the same mock and record the same effects. They are run unedited.

**Proof, as §9:** harness `--ci`, blob `a673a901…` before and after, all 100 entries compared by hash; the 18 other functions `--exact` identical to `90da8301`; `grep -c "\.from("` 51 → 46; unit tests for the five methods; the webhook, `lib/payments` and guard regression set; scoped `tsc` and `eslint`. No snapshot is written.

#### PR 1 evidence (2026-10-07)

Tree: worktree `neuronforge-webhook-repos`, branch `feature/webhook-repos-pr1-claim-client`, `HEAD` `90da8301`, uncommitted, Node 22.19.0. Every Jest run was `node node_modules/jest/bin/jest.js --ci --runTestsByPath …`. **No run wrote a snapshot; none used `-u`.**

**Before (untouched `90da8301`):**

| Evidence | Value |
|---|---|
| Harness | 1 suite, **102 tests, 100 snapshots**, all passed |
| Snapshot blob | **`a673a9019e8486375aaf240575f325f701870413`** (= `HEAD`), 13,418 lines, 100 `exports[` |
| Per-entry hashes | sha256 of each of the **100** `exports[…]` values (a script evaluates the `.snap` in a `vm` context), from `git show 90da8301:<snap>`; the working copy matched it 100/100. Kept in the session scratchpad (`pr1/before-hashes.json`, file sha256 `ec99e97b…`) |
| `route.ts` | blob `df671c4a…`, 2,668 lines, **51** `.from(`, 20 top-level functions |
| `check-logging-only-diff --exact`, all 20 functions | 20 × identical (sanity) |
| Frozen test files | harness `a7cc9992…`, `fix1Ownership.qa` `f509e75e…`, `bindPlanSubscription.test` `2e7b9731…` |

**After:**

| Evidence | Value |
|---|---|
| Harness | 1 suite, **102 tests, 100 snapshots**, all passed |
| Snapshot blob | **`a673a901…`, unchanged**, after every run in this PR (including the mutant runs below). `git diff --exit-code` on `__snapshots__/` and on the harness: exit 0 |
| Entry by entry | **100 identical, 0 changed, 0 missing, 0 added** (same script; the after-hash file has the same sha256 `ec99e97b…` as the before) |
| Frozen test files | harness `a7cc9992…`, `fix1Ownership.qa` `f509e75e…`, `bindPlanSubscription.test` `2e7b9731…`: all unchanged |
| `check-logging-only-diff --exact`, base `90da8301` | the 18 untouched functions: **18 × identical, exit 0**. All 20: `completeClaim` and `POST` **differ**, the other 18 identical |
| `grep -c "\.from("` on `route.ts` | **51 → 46** (the five claim sites). `createClient` no longer appears in the route; `BUSINESS_OS_FLOW_HANDLERS` and the dispatcher call site are not in the diff |
| Coverage, harness only (`route.ts` + the repository) | repository **100 %** statements, branches, functions and lines. Calls per method: `findClaim` 104, `insertClaim` 101, `reclaimFailed` 1, `complete` 91, `markFailed` 9. In `route.ts` every new call site executes: `:2248` complete 91, `:2369` findClaim 104, `:2390` reclaimFailed 1, `:2393` insertClaim 101, `:2627` markFailed 9. Route statements 91.5 %, branches 75.6 % (was 91.49 % / 75.6 %; the denominator shrank by the moved chains) |
| Repository unit tests (`lib/repositories/__tests__/ProcessedWebhookEventRepository.test.ts`) | **18 tests**, all passed: exact chain of each method (table, operation, columns, payload and its key order, filter, terminal or `await`); the same error object returned (identity), including a `23505`; no `user_id` anywhere in any chain (all five); the insert payload is the caller's object, untouched; an extra key in the insert row is a compile error (`@ts-expect-error`, checked by the scoped `tsc`); `markFailed` does not catch a throw; default client is `supabaseServer`; barrel export; C-3 source shape (section header, the marker on every method's doc, no spread payload, no generic update, no `select('*')`, no `delete`/`upsert`/`rpc`, no `user_id`, no `try`) |
| `routerPlacement.guard` | 13 tests (was 12), all passed |
| Regression set (58 files: every `app/api/stripe/webhook/__tests__/*.test.ts`, every `lib/payments/__tests__/*.test.ts`, `noBookingGuess.guard`, `stripeAuditEntries`, `userSubscriptionsWriteLockdown.qa`, `userSubscriptionsWriteLockdownMigration`, `bookingPaymentStatusReaders.guard`, `noPilotCreditTableReads.guard`, `mutationOrSelect.guard`, `scripts/__tests__/check-logging-only-diff`, and the new repository test) | **58 suites, 983 tests, 100 snapshots, all passed.** Snapshot blob still `a673a901…` |
| Also run | `businessOsEntitlements.imports.guard`, and two repository suites that import the barrel (`BosCronRunRepository`, `AdminJobsQueuesRepository`): 3 suites, 83 tests, passed |
| Scoped `tsc` (scratch tsconfig, `files` = `route.ts`, the repository, its test, the guard; 8 GB heap) | **0 errors in the changed files.** 64 pre-existing errors in transitively imported files, the same total as §7.1. With `lib/repositories/index.ts` added: still 64, none in it |
| ESLint on the 5 changed `.ts` files | **0 errors.** 6 warnings, all in `route.ts` lines this PR does not touch (unused `planSchedule` imports at `:21`, two `any`, an unused `lookupError` at `:1274`) |
| `console.*` | 0 in `route.ts`, the repository and `index.ts` |

**The harness and the moved guard bite on the new code (mutants).** The real files were copied to the scratchpad, mutated in place one at a time, the suite run with `--ci`, then copied back. The blobs were checked after each restore (`route.ts` `e82720b2…`, repository `4c8b3351…`), and the snapshot blob stayed `a673a901…` throughout.

| # | Mutation | Suite | Result |
|---|---|---|---|
| G1 | `completeClaim` writes `status: 'completed'` inline again | guard | **2 red** |
| G2 | `POST` calls `processedWebhookEventRepository.complete(…)` directly, around `completeClaim` | guard | **1 red** |
| G3 | `POST` reads the claim with an inline `from('processed_webhook_events')` | guard | **1 red** |
| G4 | The repository's `markFailed` writes `'completed'` | guard | **1 red** |
| H1 | `reclaimFailed` drops `failure_message: null` | harness | **1 red** (the reclaim entry) |
| H2 | `findClaim` ends in `.single()` instead of `.maybeSingle()` | harness | **100 red** |

**Guard moves (C-2 audit, done as planned above):** the `routerPlacement` claim check moved with the code and got stricter. `completeClaim` must call `processedWebhookEventRepository.complete` once. The repository's `complete` holds the only `status: 'completed'` in that file. The route holds none at all, and calls `complete` nowhere outside `completeClaim`. A new `it` in the same suite asserts that the route code has no `from('processed_webhook_events')` and that `POST` calls `findClaim`, `reclaimFailed`, `insertClaim` and `markFailed` once each. No other guard's text changed. `userSubscriptionsWriteLockdown.qa` still lists `route.ts // supabaseAdmin`, which stays accurate (an alias now); PR 5 removes it.

#### PR 1: after the SA code review (CR-P1-2, O-P1-1), 2026-10-07

SA approved PR 1 (see "PR 1 code review"). Dev took the two optional items. CR-P1-1 is a PR 2 condition, recorded on the §11 PR 2 task; `REPOSITORY_STRATEGY.md` is not changed here.

| Item | Change |
|---|---|
| **CR-P1-2** | `lib/repositories/index.ts` re-exports the repository's types (`NewWebhookClaimRow`, `ProcessedWebhookEventColumns`, `WebhookClaim`, `WebhookClaimResult`, `WebhookClaimStatus`) with one `export type { … } from './ProcessedWebhookEventRepository'`, as `ArchiveRepository` does |
| **O-P1-1 (a)** | `routerPlacement.guard`, in "the claim table is reached only through its repository": the `from(` match now also accepts a backtick-quoted table name |
| **O-P1-1 (b)** | Same `it`: the route never names the class `ProcessedWebhookEventRepository` as an AST identifier; only the singleton is allowed. That closes a `new ProcessedWebhookEventRepository().complete(…)` bypass of "complete only via `completeClaim`". The import path string does not count, because the check reads identifiers, not text |

**Mutants.** These were temporary edits of `route.ts`. The original was copied to the scratchpad, copied back after each run, and its blob checked.

| # | Mutation | Result |
|---|---|---|
| M5 | `POST` adds a `supabaseAdmin.from(…)` on `processed_webhook_events` with the table name in backticks, behind a dead `if`. The four repository calls are kept, so only the new arm can catch it | **1 red**: the backtick-aware `not.toMatch` (guard `:233`). The old pattern accepted only `'` and `"` |
| M6 | The import also takes the class, and `POST` adds `new ProcessedWebhookEventRepository().complete(event.id)` | **1 red**: `classMentions` (guard `:243`; the import specifier and the `new`). The "every claim completion goes through completeClaim()" test **stayed green** on this mutant: that is the bypass SA described |

`route.ts` blob before and after both mutants: `e82720b2…`.

**Re-runs** (`--ci --runTestsByPath`):

- `routerPlacement.guard` (13 tests), `ProcessedWebhookEventRepository.test` (18 tests) and the harness (102 tests, 100 snapshots): **3 suites, 133 tests and 100 snapshots, all passed.**
- Snapshot blob still **`a673a901…`**.
- ESLint on the two changed files: 0 problems.
- Scoped `tsc` (`files` = `index.ts` and the guard): 0 errors in either file. 3 errors already exist in other files (`MemoryManager` 2, `CalibrationSessionRepository` 1).
- Blobs now: guard `d1432ba4…`, `index.ts` `1ff1e48c…`. `route.ts` and the repository are unchanged (`e82720b2…`, `4c8b3351…`).

#### PR 1: deviations and questions for SA

| # | Item | Dev's position |
|---|---|---|
| PR1-D1 | **No `try/catch` in the repository methods**, unlike the `new-repository` template. supabase-js returns query errors and does not throw, so the template's catch would change nothing on that path. On a real throw, though, a catch in `markFailed` would silence the route's "Could not release failed event" log, which the §11 note asks to keep. A unit test pins "does not catch" | Accept |
| PR1-D2 | **No logger in the repository.** It has nothing to log: the route logs every claim error it acts on, and the discarded ones are FU-9 (SA Q-4). An unused logger field would be dead code | Accept, or SA asks for the field for template conformity |
| PR1-D3 | **Own result type `WebhookClaimResult<T>`** (`error: PostgrestError \| null`), not `AgentRepositoryResult<T>`. The shared type declares `error: Error`, which loses `.code`, so the route's `insertError.code === '23505'` would not type-check | Accept |
| PR1-D4 | **Order of evaluation inside two calls.** In P3 and P4 the payload values (`new Date().toISOString()`, `String(error…).slice(0, 500)`) are now computed before the query builder is created, not after. The query, its payload and the effects are identical (the harness proves it). The only case where the difference shows is an error whose `String()` itself throws. Then no builder is created at all, where before one was created and abandoned. Either way the throw lands in the same release `catch` and is logged | Accept; noted for completeness |
| PR1-D5 | **The guard reads a second file.** `routerPlacement.guard` now parses the repository (165 lines) once, besides the route. C-7 asked for no second parse of the route, which still holds | Accept |
| PR1-D6 | **20 functions, not 18.** §7.1's count predates `ownedOrNull` (Fix-1) and `accountOwner` (FU-5). PR 1's untouched set is the other 18 | Recorded |
| PR1-Q1 | The PR 1 note (DB fully down, claim left `processing`) is kept as a note, now in `markFailed`'s doc comment as well as §11. No fix here | SA to confirm that placement |

### 7.3.3 PR 2 refresh (2026-10-08, against `933d661c`)

Branch `feature/webhook-repos-pr2-invoices`, off `origin/main` `933d661c` (PR 1 merged as #258). `route.ts` is blob `31434a7f…`, 2,714 lines, **48** `.from(` (PR 1 took five; Offir's #257 added three `payment_transactions` sites, which are PR 3's). 20 top-level functions.

**What changed since §2.2:**

- **Fix-1 (#242)** moved `accountOwns` **before** H3 and added it to J, K and L. The J1, K1 and L1 lookups now all select `'id, invoice_number, user_id'`, so the two planned column constants (`LOOKUP`, `FAILURE`) collapse into one.
- **#257** (Stripe settlement recovery) added, inside `handleConnectInvoicePaid`, a `payment_transactions` lookup by intent and an attach update (`:1452–1474`). Both are PR 3's and stay inline, untouched. The receipt read (H8) now also selects `id`.

**Sites, exact lines at `933d661c`** (the `.from(` line in brackets):

| Site | Lines | Chain today | After PR 2 |
|---|---|---|---|
| H1 | `:1274–1278` (1275) | `payment_invoices` select `'*'` · eq `stripe_invoice_id` · `single` | `paymentInvoiceRepository.findByStripeInvoiceId(invoice.id)` (reuse; default columns `'*'`) |
| H2 | `:1304–1308` (1305) | select `'*'` · eq `id` · `single` | `.findByIdUnscoped(metadataInvoiceId)` |
| H3 | `:1329–1335` (1330) | update `{stripe_invoice_id, updated_at}` · eq `id` · await, **after** `accountOwns` (Fix-1) | `.recordStripeInvoiceId(invoiceByMetadata.id, invoice.id)` |
| H6 | `:1537–1545` (1538) | update `{status:'paid', paid_at, stripe_hosted_invoice_url, stripe_invoice_pdf, updated_at}` · eq `id` | `.markPaidFromStripeInvoice(platformInvoice.id, { paidAt, hostedInvoiceUrl, invoicePdf })` |
| H8 | `:1657–1661` (1658) | select `'id, user_id, client_email, client_name, invoice_number, currency, booking_id'` · eq `id` · `maybeSingle` | `.readFieldsUnscoped(platformInvoice.id, WEBHOOK_INVOICE_RECEIPT_COLUMNS)` |
| I1 | `:1776–1780` (1777) | select `'*'` · eq `id` · `single` | `.findByIdUnscoped(invoiceId)` |
| I3 | `:1855–1862` (1856) | update `{status:'paid', paid_at, updated_at}` · eq `id` | `.markPaidFromCheckout(invoiceId, paidAt)` |
| J1 | `:2000–2004` (2001) | select `'id, invoice_number, user_id'` · eq `stripe_invoice_id` · `single` | `.findByStripeInvoiceId(invoice.id, WEBHOOK_INVOICE_LOOKUP_COLUMNS)` |
| J2 | `:2023–2029` (2024) | update `{status:'overdue', updated_at}` · eq `id` | `.setStatusFromStripe(platformInvoice.id, 'overdue')` |
| J3 | `:2043–2047` (2044) | select `'contact_id, amount, currency'` · eq `id` · `maybeSingle` | `.readFieldsUnscoped(platformInvoice.id, WEBHOOK_INVOICE_FAILED_ACTIVITY_COLUMNS)` |
| J4 | `:2050–2054` (2051) | `business_profiles` select `'language'` · eq `user_id` · `maybeSingle` | `businessProfileRepository.findLanguage(platformInvoice.user_id)` (reuse) |
| K1 | `:2094–2098` (2095) | as J1 | `.findByStripeInvoiceId(invoice.id, WEBHOOK_INVOICE_LOOKUP_COLUMNS)` |
| K2 | `:2116–2123` (2117) | update `{stripe_hosted_invoice_url, stripe_invoice_pdf, updated_at}` · eq `id` | `.recordStripeDocuments(platformInvoice.id, { hostedInvoiceUrl, invoicePdf })` |
| L1 | `:2144–2148` (2145) | as J1 | `.findByStripeInvoiceId(invoice.id, WEBHOOK_INVOICE_LOOKUP_COLUMNS)` |
| L2 | `:2166–2172` (2167) | update `{status:'cancelled', updated_at}` · eq `id` | `.setStatusFromStripe(platformInvoice.id, 'cancelled')` |

15 sites, so `.from(` goes **48 → 33**. Converted functions: `handleConnectInvoicePaid`, `handleConnectCheckoutCompleted`, `handleConnectInvoicePaymentFailed`, `handleConnectInvoiceFinalized`, `handleConnectInvoiceUncollectible`. The other **15** must be `--exact` identical. Inside the two converted functions that also hold other PRs' sites (H4, the #257 lookup and attach, H5, H7 in the paid handler; I2, I4, I5 in checkout), those lines stay byte-identical; the diff hunks show it.

**Methods (`PaymentInvoiceRepository`, one new section with the C-3 header; 7 new, 1 reused with an optional column list):**

| Method | Chain | Owner check it relies on (⟨unscoped-by-design⟩) |
|---|---|---|
| `findByStripeInvoiceId(id, columns = '*')` (reuse) | select `columns` · eq `stripe_invoice_id` · `single` | Key is the Stripe invoice id of a signed event; the route calls `accountOwns` on the row before any write |
| `findByIdUnscoped(id)` | select `'*'` · eq `id` · `single` | The id is connected-account metadata, so **not** trusted: every caller checks `accountOwns` on the returned row before anything is written (Fix-1) |
| `recordStripeInvoiceId(id, stripeInvoiceId)` | update `{stripe_invoice_id, updated_at}` · eq `id` | Row proved owned (`accountOwns`, moved before this write by Fix-1) |
| `markPaidFromStripeInvoice(id, {paidAt, hostedInvoiceUrl, invoicePdf})` | update `{status:'paid', paid_at, stripe_hosted_invoice_url, stripe_invoice_pdf, updated_at: paidAt}` · eq `id` | Row proved owned |
| `markPaidFromCheckout(id, paidAt)` | update `{status:'paid', paid_at, updated_at: paidAt}` · eq `id` | Row proved owned |
| `setStatusFromStripe(id, 'overdue' \| 'cancelled')` | update `{status, updated_at}` · eq `id` | Row found by Stripe id and proved owned (Fix-1 J/L) |
| `recordStripeDocuments(id, {hostedInvoiceUrl, invoicePdf})` | update `{stripe_hosted_invoice_url, stripe_invoice_pdf, updated_at}` · eq `id` | Row found by Stripe id and proved owned (Fix-1 K) |
| `readFieldsUnscoped(id, RECEIPT \| FAILED_ACTIVITY)` | select constant · eq `id` · `maybeSingle` | Row proved owned earlier in the same handler |

Column constants, a closed union each: `WEBHOOK_INVOICE_LOOKUP_COLUMNS = 'id, invoice_number, user_id'`, `WEBHOOK_INVOICE_RECEIPT_COLUMNS`, `WEBHOOK_INVOICE_FAILED_ACTIVITY_COLUMNS`. No insert in this PR, so no typed row. No generic update: each update is a named transition, and `paidAt` is passed in because the route uses the same value for the transaction row and the invoice. `new Date().toISOString()` is called the same number of times as before (once in H3, J2, K2, L2; zero in H6, I3).

**Errors and logging.** The seven new methods follow PR 1: no try/catch, no logger, supabase-js's own `{ data, error }`. **C-5:** `findByStripeInvoiceId` no longer logs a `PGRST116` (no row, a routine miss for H1, J1, K1, L1); any other error still logs at `error` through the file's `createLogger({ service: 'PaymentRepository' })`. *(Updated during implementation, PR2-D1:)* its try/catch is also removed, so a rejected query reaches the route as the inline one did. `findLanguage` is reused; *(updated after the SA review, CR-P2-1, PR2-Q1 ruled (c))* its try/catch is removed the same way, and it still logs a returned error with `createLogger({ service: 'BusinessProfileRepository' })`. Its other caller, the inviter notification, wraps it in `settle()`. New log lines on a real DB error in H1/J1/K1/L1/J4 are log-only (P0-C1, accepted in Q-5).

**Guard audit (C-2): every negative check on `route.ts` text, and where it bites after PR 2.**

| Guard | Check | After PR 2 |
|---|---|---|
| `noBookingGuess.guard:66` | the paid handler does not match `from('payment_invoices')…booking_id:` | **Re-homed, three arms, the old one kept.** (a) Old negative stays on the handler text. (b) New: the handler has **no** `from(` on `payment_invoices` in any quote style, never names the class `PaymentInvoiceRepository`, and every mention of `paymentInvoiceRepository` is a direct call to one of five methods; the ones of those that write (read from the repository's AST: `.update(`/`.insert(`/`.upsert(`/`.delete(`) are exactly `recordStripeInvoiceId` and `markPaidFromStripeInvoice`. (c) New: neither write method's body contains `booking_id`, and no method the handler calls touches `scheduling_` tables or `servicePrice` |
| `noBookingGuess.guard:56` `matchingBooking`, `:73–74` `servicePrice` / `scheduling_services(price)` | whole route / handler | Unchanged; (c) extends the second to the repository methods the handler calls |
| `routerPlacement.guard:233` claim table | `from('processed_webhook_events')` | Unaffected |
| **New** `it` in `routerPlacement.guard` (C-7: same suite, same parsed route) | — | Route code has no `from(` on `payment_invoices` or `business_profiles`, and never names `PaymentInvoiceRepository` or `BusinessProfileRepository` as identifiers. Each of the five handlers makes exactly its expected repository calls, and no other function makes any; `findLanguage` is called once, in `handleConnectInvoicePaymentFailed`. PR 2's "every site converted" check |
| **New** `it` in `routerPlacement.guard` (F-1) | — | For each invoice write in the five handlers, the nearest preceding `accountOwns(…)` tests `platformInvoice.user_id` or `invoiceByMetadata.user_id`. Moving a write above its check makes the nearest check a plan's, or none |
| `receiptOnPaid.guard` | `currency: receiptInvoice.currency \|\| invoiceCurrency`, the IIFE, the log line | Kept true: the variable stays `receiptInvoice`, the IIFE and its catch are unchanged |
| `invoiceIntentsStayUnowned.guard:82`, `:90` | `paymentIntents.update(`, `invoice.payment_intent` | Unaffected (no such text moves) |
| `emptyBody.guard`, `pinoLogging.guard` (≥ 133 log calls), `deferredFirstPayment.guard` | strings and log calls | Unaffected: no log line moves |
| `planSurfaces.guard:32` | `PaymentsSection.tsx` | Unaffected |
| `userSubscriptionsWriteLockdown.qa` | `user_subscriptions` writers | Unaffected (PR 5) |

**F-1 stays fixed.** In each of H (metadata path), I, J, K and L, the `accountOwns` refusal stays ahead of every write. The snapshot pins it (Fix-1's refusal entries), and the `--exact`-equal hunks show the checks did not move.

**Proof:** as §9, against `933d661c`: harness `--ci`, snapshot blob **`ae7b32c4…`** before and after, all 100 entries compared by hash; the 15 untouched functions `--exact` identical; `.from(` 48 → 33; unit tests for the new and changed methods; regression set; scoped `tsc` and ESLint. No snapshot is written.

#### PR 2 evidence (2026-10-08)

Tree: worktree `neuronforge-webhook-repos`, branch `feature/webhook-repos-pr2-invoices`, `HEAD` `933d661c`, uncommitted, Node 22.19.0. Every Jest run was `node node_modules/jest/bin/jest.js --ci --runTestsByPath …`. **No run wrote a snapshot; none used `-u`.** TL's edit to `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` is in the tree and was not touched.

**Before (untouched `933d661c`):**

| Evidence | Value |
|---|---|
| Harness | 1 suite, **102 tests, 100 snapshots**, all passed |
| Snapshot blob | **`ae7b32c4480ad7f7a1d4945763dd00acf81083bc`** (= `HEAD`), 13,502 lines, 100 `exports[` |
| Per-entry hashes | sha256 of each of the 100 `exports[…]` values (the `.snap` evaluated in a `vm` context), from `git show 933d661c:<snap>`; the working copy matched 100/100. Hash file sha256 `18097317…` (session scratchpad, `pr2/before-base.json`) |
| `route.ts` | blob `31434a7f…`, 2,714 lines, **48** `.from(`, 20 top-level functions |
| `check-logging-only-diff --exact`, all 20 functions | 20 × identical (sanity) |
| Frozen test files | harness `a7cc9992…`, `fix1Ownership.qa` `f509e75e…`, `bindPlanSubscription.test` `2e7b9731…`, `claimRepository.qa` `fa012262…` |

**After:**

| Evidence | Value |
|---|---|
| Harness | 1 suite, **102 tests, 100 snapshots**, all passed |
| Snapshot blob | **`ae7b32c4…`, unchanged** after every run in this PR, mutant runs included. `git diff --exit-code` on `__snapshots__/` and on the harness: exit 0 |
| Entry by entry | **100 identical, 0 changed, 0 missing, 0 added**; the after-hash file has the same sha256 `18097317…` |
| Frozen test files | all four blobs unchanged |
| `check-logging-only-diff --exact`, base `933d661c` | the 15 untouched functions: **15 × identical, exit 0**. All 20: the five converted handlers differ, the other 15 identical |
| Module-level diff (§7.4: not seen by `--exact`) | Two imports only: `paymentInvoiceRepository` + the three column constants from `@/lib/repositories/PaymentRepository`, and `businessProfileRepository`. `BUSINESS_OS_FLOW_HANDLERS` and the dispatcher call are not in the diff |
| Inside the converted handlers | Only the 15 sites change, plus one type annotation (`contact_id: string \| null` on the paid handler's local, PR2-D2) and one comment at J4. H4, the #257 lookup and attach, H5, H7, I2, I4 and I5 are byte-identical (diff hunks) |
| `grep -c "\.from("` on `route.ts` | **48 → 33** |
| Coverage, harness only | Every new call site executes: H1 `:1283` 12, H2 `:1310` 4, H3 `:1331` 1, H6 `:1533` 4, H8 `:1648` 3, I1 `:1766` 8, I3 `:1841` 4, J1 `:1979` 7, J2 `:2001` 5, J3 `:2015` 4, J4 `:2023` 2, K1 `:2063` 8, K2 `:2084` 5, L1 `:2108` 4, L2 `:2129` 2. Repository: `findByStripeInvoiceId` 31 calls, `findByIdUnscoped` 12, `setStatusFromStripe` 7. Route statements 90.66 % (534/589) |
| Repository unit tests (`lib/repositories/__tests__/PaymentInvoiceRepository.webhook.test.ts`, new) | **38 tests**, all passed: exact chain of each method (table, operation, columns, payload and key order, filter, terminal or `await`); same error object returned (identity); no `user_id` filter or payload key (all eight methods); `findByStripeInvoiceId` quiet on `PGRST116`, logs any other error at `error` with `service: 'PaymentRepository'`, logs nothing on a hit (C-5); a rejected query rejects (no catch) in every method incl. `findByStripeInvoiceId`; document keys kept when Stripe sends `undefined`; closed column and status sets (`@ts-expect-error`, consumed in the scoped `tsc`); default client `supabaseServer`; C-3 source shape (section header once, marker on every method doc and on `findByStripeInvoiceId`, no generic update, spread, insert/delete/upsert/rpc, `user_id`, `try`, logger or `booking_id` in the section) |
| Guards | `noBookingGuess.guard` 7 tests (was 5); `routerPlacement.guard` 15 tests (was 13); `receiptOnPaid.guard` unchanged and green |
| Regression set (178 files: every `app/api/stripe/webhook/__tests__/*.test.ts`, every `lib/payments/__tests__/*.test.ts`, every `lib/repositories/__tests__/*.test.ts`, `noBookingGuess.guard`, `stripeAuditEntries`, `invoiceIntentsStayUnowned.guard`, `noPilotCreditTableReads.guard`, `check-logging-only-diff`, and the 53 other test files that import `PaymentRepository` or `BusinessProfileRepository`) | **178 suites, 3,842 tests, 119 snapshots, all passed.** Snapshot blob still `ae7b32c4…` |
| Scoped `tsc` (scratch tsconfig, `files` = `route.ts`, `PaymentRepository.ts`, the new test, both guards; 8 GB heap) | **0 errors in the changed files.** 58 errors in transitively imported files, the **same 58** (file and position) as the untouched `933d661c` route gives on the same tree |
| ESLint on the 5 changed `.ts` files | **0 errors.** 10 warnings, all on lines this PR does not touch (unused `planSchedule` imports, `any`s, the existing unused `lookupError` at H1) |
| `console.*` | 0 in `route.ts` and `PaymentRepository.ts` |

**The moved guards and the harness bite on the new code (mutants).** Each mutant was applied to the real file after copying it to the scratchpad, the suites were run with `--ci`, the file was copied back and its blob checked (`route.ts` `7507a6bd…`, `PaymentRepository.ts` `99226b4e…`); the snapshot blob stayed `ae7b32c4…` throughout.

| # | Mutation | Result |
|---|---|---|
| M1 | `markPaidFromStripeInvoice` also writes `booking_id: null` | **3 red**: `noBookingGuess` (writer contains `booking_id`), the unit chain test, the C-3 source check |
| M2 | Paid handler also calls the generic `paymentInvoiceRepository.update(…, { booking_id })` behind a dead `if` | **2 red**: `noBookingGuess` allow-list and writer set |
| M3 | Paid handler reaches the repository through an alias (`const invoices = paymentInvoiceRepository`) | **1 red**: `noBookingGuess` mentions-equal-calls check |
| M4 | H3 written again **above** its `accountOwns` check (the F-1 shape) | **5 red**: the new F-1 `it`, the call-count `it`, and three harness entries (Fix-1's F1-1, F1-2 refusals and 1b) |
| M5 | `invoice.finalized` gains an inline `` from(`payment_invoices`) `` update (backticks) behind a dead `if` | **1 red**: the new "reached only through their repositories" `it` |
| M6 | `findByStripeInvoiceId` logs on `PGRST116` too | **1 red**: the C-5 unit test |
| M7 | `readFieldsUnscoped` ends in `.single()` | **9 red**: two unit tests and seven harness entries (incl. X20, X37, X50, X52) |

**Guard moves (C-2, done as planned above).** The `noBookingGuess:66` negative is kept on the handler text and now has two arms that follow the writes into the repository: (b) the handler has no inline `payment_invoices` query in any quote style, never names the class, and every mention of `paymentInvoiceRepository` is a direct call to one of five allow-listed methods; (c) of those, the ones whose code (from the repository's AST, comments removed) writes are exactly `recordStripeInvoiceId` and `markPaidFromStripeInvoice`; neither contains `booking_id`, and no called method touches `scheduling_` or `servicePrice`. The other negatives on route text are unaffected (table above). `routerPlacement.guard` gained the PR 2 "every site converted" check and an F-1 ordering check, in the same suite and on the same parsed route (C-7).

#### PR 2: deviations and questions for SA

| # | Item | Dev's position |
|---|---|---|
| PR2-D1 | **`findByStripeInvoiceId` lost its try/catch**, beyond C-5's logging change. With the catch, a query that *rejects* became `{ data: null, error }`: the paid handler would fall through to the metadata lookup and J/K/L would return quietly, where the inline query threw, answered 500 and let Stripe retry. QA's `claimRepository.qa` caught it (3 tests went red on the first version, on a rejected `payment_invoices` select). It has no other caller. Same reasoning as PR1-D1. Pinned by a unit test | Accept |
| PR2-D2 | **Type annotation in the paid handler**: `contact_id: string \| null` (was `string`). The row now arrives typed as `PaymentInvoice`, whose `contact_id` is nullable; before it was `any`. No runtime change | Accept |
| PR2-D3 | **One lookup constant, not two** (§3 planned `LOOKUP` and `FAILURE`). Fix-1 made J1, K1 and L1 select the same `'id, invoice_number, user_id'` | Accept |
| PR2-D4 | **The `findByStripeInvoiceId` result keeps `PaymentRepositoryResult` (`error: Error`)**, not `WebhookInvoiceResult` (`PostgrestError`). The route reads only `lookupError ||`, and changing the reused method's declared type would touch its other users' types. `PostgrestError` extends `Error`, so the object is the same | Accept |
| PR2-Q1 | **`findLanguage` keeps its try/catch** (it has another caller, invite redemption). On a *rejected* `business_profiles` read in J4, the old inline query threw (500, Stripe retries); the reused method logs "Failed to read business language", returns null, and the activity is written in English (200). The invoice was already marked overdue in both cases. supabase-js returns query errors rather than throwing, so this differs only on a thrown query, and the harness cannot see it. Options: (a) accept as is; (b) a non-catching method for the webhook (a second method for the same query); (c) drop the catch in `findLanguage` and check the invite caller | (a), since the reuse was ruled; SA to choose. **SA ruled (c), CR-P2-1: done.** The try/catch is gone, the returned-error log and the string check are kept, a "rejected query rejects" test was added, and the inviter notification and redemption tests pass unchanged |
| PR2-Q2 | **The new F-1 ordering check is positional** (nearest preceding `accountOwns` in source order), not flow-aware. It catches a write moved above its check (M4) and a check that tests a plan rather than an invoice. It would not catch a check moved into a branch that does not dominate the write | Accept as a guard; the harness's Fix-1 entries remain the behavioural proof |

### 7.4 What `check-logging-only-diff.ts` can and cannot prove here

- **Can:** with `--functions <list> --exact`, prove that every top-level function a PR is **not** meant to touch is textually identical to `origin/main`. Each PR names its untouched set (§9) and records 18 verdicts.
- **Cannot:** prove the converted functions are equivalent. Their text changes by design, and the default normalising mode refuses this file anyway (P0-C3: the base already uses `log`). Equivalence of the converted code is the harness's job (§7.2). It also does not see module-level statements (imports, the client, the cache), which the review reads.
- Per-PR completeness check: `grep -n "\.from(" route.ts` must list exactly the sites the later PRs still own, and the final PR adds a source guard (§8) that `route.ts` has no `.from(`, `.rpc(` or `createClient`.

### 7.5 Unit tests for each new repository method

One test file per touched repository (new or extended), with a recording fake client like the existing `UserSubscriptionRepository.test.ts`. For each method:

- **Exact chain**: table, operation, column string, every filter in order, payload keys and values, terminal (`single` / `maybeSingle` / await), and `onConflict` for the upsert.
- **Error pass-through**: the repository returns the **same** error object (identity, so `code` and `message` survive), never throws.
- **Data shape**: `data` is what the route reads (a row, `null`, an array for D1/E1).
- **Scope**: methods that carry `user_id` today (G5, M3, A/B/C/N) assert it; the unscoped-by-design ones assert they add none, with the reason in the doc comment.
- Plus the `new-repository` checks for the four new repositories (default client is `supabaseServer`, singleton export, `index.ts` export).

### 7.6 Type-check and lint, scoped

Per PR: the scratch tsconfig with `files` = every changed `.ts` file, 8 GB heap. Pass = **0 errors in changed files** and the transitive pre-existing set unchanged (64 today). `eslint` on changed files, 0 errors. Full-repo `tsc` runs out of heap here (P-10 §16b), so it is not the gate. CI's `bos-llm` typecheck baseline is unaffected (no `lib/business-os/llm` import).

---

## 8. Source guards that pin route.ts text

These tests read `route.ts` as text and will fail when a query leaves it. Each is **moved, never weakened**: the assertion follows the code into the repository and the route keeps an assertion that it calls that method in the same place.

| Guard | What it pins | Change | PR |
|---|---|---|---|
| `routerPlacement.guard` "every claim completion goes through completeClaim()" | `completeClaim` text contains `status: 'completed'`; no other `status: 'completed'` in the route | `completeClaim` must call `processedWebhookEventRepository.complete(`; `ProcessedWebhookEventRepository.complete` contains `status: 'completed'`; the "no other completing write" scan stays on the route and is added for the repository file | 1 |
| `noBookingGuess.guard` | `handleConnectInvoicePaid` contains `if (platformInvoice.booking_id)` and `payment_status: 'paid'` | `payment_status: 'paid'` → the handler calls `schedulingBookingRepository.markPaidUnscoped(platformInvoice.booking_id)` inside that `if`; the repository method sets `payment_status: 'paid'` | 4 |
| `planSurfaces.guard` "the webhook closes the instalment by subscription and period number" | `recordPlanPeriodPaid` contains `from('payment_plan_installments')…status: 'paid'` and `.eq('installment_number', periodsPaid)` | The route calls `paymentPlanRepository.markPeriodPaidFromStripe(plan.data.id, periodsPaid, …)`; the repository method contains the update and both `.eq`s | 4 |
| `userSubscriptionsWriteLockdown.qa` writer list | `app/api/stripe/webhook/route.ts // supabaseAdmin` is a `user_subscriptions` writer | Entry removed (the writes now live in `UserSubscriptionRepository`, already listed) | 5 |
| `userSubscriptionsWriteLockdown.qa` construction sites | `app/api/stripe/webhook/route.ts::QuotaAllocationService(supabaseAdmin)` | `…::QuotaAllocationService(supabaseServer)` | 5 |
| `routerPlacement.guard` "handleCheckoutCompleted keeps only the boost-pack conversion" | `activity_type: 'boost_pack_purchase'` and one `new QuotaAllocationService(` in the function | Unchanged: the insert row is still built in the route | — |
| `receiptOnPaid.guard`, `emptyBody.guard`, `pinoLogging.guard` (≥ 133 log calls), `deferredFirstPayment.guard` | Strings, log calls, and the subscription-created handler | Unchanged: no log line moves, none of those strings move | — |
| **New** in PR 5: `route.ts` has no `.from(`, `.rpc(`, `createClient(` (AST, comments ignored) and imports `supabaseServer` only for the three helpers | — | Added | 5 |

`bookingPaymentStatusReaders.guard` and `noPilotCreditTableReads.guard` scan other trees; the new methods set `payment_status` but never filter on it, and the legacy repositories sit in `lib/repositories/`, outside the Business OS trees. Both stay green.

---

## 9. Sizing and split

**Estimate: about 5 developer days** (harness 0.75, claim and client 0.5, invoices 1, money rows 1, plans and bookings 1, legacy and final guard 0.75), plus review rounds. That is more than 3 days, so six PRs.

All six touch `route.ts`, so they are **strictly sequential**: each branches off `main` after the previous one merged. No stacking. Each is small enough to review in one sitting, and each carries its own proof:

**Every PR's proof** (recorded in this workplan's evidence log): (1) harness `--ci`, snapshot blob equal to the recorded one, `git diff --exit-code` on `__snapshots__`; (2) coverage run showing each site it converted is executed; (3) `check-logging-only-diff --exact` on the functions it must not touch, all identical; (4) unit tests for its methods; (5) the regression set (§7.1, plus new files); (6) scoped `tsc` and `eslint`; (7) `git diff --numstat` with no deletion-only file.

| PR | Scope title | Sites | Guardrails (must not touch) | Size |
|---|---|---|---|---|
| **0** | **Harness: close the coverage gaps** (tests only) | — | `route.ts` (blob stays `0ad6e6a5…`), any production file. The 28 existing snapshot entries must be byte-identical | 0.75 d |
| **1** | **Claim table and client** | P1–P4, O1; `createClient` → `supabaseServer` alias | Any handler other than `POST` and `completeClaim` (16 functions `--exact` identical); claim semantics (two-phase, `23505`, release on failure) | 0.5 d |
| **2** | **Connect invoices** (`payment_invoices`, `business_profiles`) | H1–H3, H6, H8, I1, I3, J1–J4, K1, K2, L1, L2 | Money-row inserts (H5, I2), bookings, plans; F-1 is **not** fixed (the order of H3 and `accountOwns` stays). Untouched set: every function except the four invoice handlers and `handleConnectCheckoutCompleted` | 1 d |
| **3** | **Money rows** (`payment_transactions`, `payment_refunds`) | D1, D2, E1, E2, F1, F2, G2, H4, H5, I2 | Invoice and booking writes, plan instalments; F-4 not fixed | 1 d |
| **4** | **Plans and bookings** (`payment_plan_installments`, `payment_plan_subscriptions`, `scheduling_bookings`) | G1, G3, G4, G5, H7, I4, I5, M1–M3; **scope addition (Fix-1b SA C-4, 2026-10-07):** the five inline `supabaseServer` queries in `lib/payments/bindPlanSubscription.ts` (installment count, installments insert, booking plan-link update, `resolveContactId` read, `resolvePlanRowId` fallback read; L123, L371, L403, L431, L462 at `2a88f0bc`, shifted by Fix-1b) | F-2 and F-3 **not** fixed (I5 stays unscoped, M3 keeps the Stripe id; the snapshot proves both). Platform handlers. bind's Fix-1b link vetting (`vetLinkId` + `findOwnedId`) is not changed | 1 d (+0.25 d for bind) |
| **5** | **Agent-platform legacy tables, remove the alias, add the rule-1 guard** | A1–A4, B2–B5, C1, N1, N2; helpers to `supabaseServer`; alias removed | No deletion of FU-1/FU-2 code; the Connect handlers (`--exact` identical); RD-16 guard keeps passing | 0.75 d |

Re-cut if SA prefers fewer PRs: 0+1 together (1.25 d) and 2+3 together (2 d) still keep each under 3 days.

**The fixes are separate and not part of this plan's six PRs.** F-1, F-2 and F-3 each change behaviour (and F-3 changes a snapshot entry on purpose). They should be small fix PRs, sequenced with TL. They can land before PR 2 / PR 4 (the refactor then moves the fixed code, against a re-recorded "before"), or after PR 5. SA/TL decide (Q-1).

---

## 10. Files to create / modify

| File | Action | PR | Reason |
|---|---|---|---|
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` | modify | 0 | 55 scenarios (§7.3.1), knobs `dispatch` and `eventPatch`, two named delegations on the plan subscription repository mock (C-4) |
| `app/api/stripe/webhook/__tests__/__snapshots__/connectPath.characterisation.test.ts.snap` | modify (append only) | 0 | 55 new entries; the 45 existing ones byte-identical |
| `app/api/stripe/webhook/__tests__/fixtures/platform/subscription-deleted-legacy.json` | create | 0 | X1, X42. X2/X3/X43/X55 reuse `invoice-payment-failed-unknown-price.json` |
| `app/api/stripe/webhook/__tests__/fix1Ownership.qa.test.ts` | modify | 0 | The same two named delegations. **Replaces** `routerEdgeCases.qa.test.ts`, which never reaches `handlePlanSubscriptionEnded` (§7.3.1) |
| `app/api/stripe/webhook/route.ts` | modify | 1–5 | The conversion |
| `lib/repositories/ProcessedWebhookEventRepository.ts` (+ `lib/repositories/__tests__/ProcessedWebhookEventRepository.test.ts`) | create | 1 | §3, §7.3.2 |
| `lib/repositories/PaymentRepository.ts` | modify | 2, 3 | `PaymentInvoiceRepository`, `PaymentTransactionRepository` methods |
| `lib/repositories/PaymentRefundRepository.ts` | create | 3 | §3 |
| `lib/repositories/PaymentPlanRepository.ts` | modify | 4 | Instalment methods; also the methods bind's inline queries need (scope addition, Fix-1b C-4) |
| `lib/payments/bindPlanSubscription.ts` (+ `lib/payments/__tests__/bindPlanSubscription.test.ts`) | modify | 4 | Scope addition (Fix-1b C-4): its five inline `supabaseServer` queries move behind repositories (CLAUDE.md rule 1), no behaviour change; the bind unit tests (28 after Fix-1b) are the proof |
| `lib/repositories/PaymentPlanSubscriptionRepository.ts` | modify | 4 | `findEndStateBySubscriptionId`, `endFromStripe` |
| `lib/repositories/SchedulingRepository.ts` | modify | 4 | Booking methods |
| `lib/repositories/UserSubscriptionRepository.ts`, `CreditTransactionRepository.ts`, `SystemConfigRepository.ts` | modify | 5 | Legacy methods |
| `lib/repositories/BillingEventRepository.ts`, `LegacyBoostPackPurchaseRepository.ts` | create | 5 | §3 |
| `lib/repositories/index.ts` | modify | 1, 3, 5 | Exports |
| `lib/repositories/__tests__/*` (one per touched repository) | create / modify | 1–5 | §7.5 |
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` | modify | 1, 5 | §8 |
| `app/api/stripe/__tests__/noBookingGuess.guard.test.ts`, `lib/payments/__tests__/planSurfaces.guard.test.ts` | modify | 4 | §8 |
| `lib/repositories/__tests__/userSubscriptionsWriteLockdown.qa.test.ts` | modify | 5 | §8 |
| `docs/REPOSITORY_STRATEGY.md` | modify | 1 (SA C-6) | Note the webhook repositories and the "unscoped by design, owner proven by `accountOwns`" pattern, if SA wants it recorded there |
| Migrations | **none** | — | §1 |

---

## 11. Task list

- [x] ✅ Read the requirement sections, P-0/P-1/P-10 workplans, the harness, `check-logging-only-diff.ts`, `REPOSITORY_STRATEGY.md`, the four skills.
- [x] ✅ Inventory every DB call (§2) and every source guard that pins route text (§8).
- [x] ✅ Record the "before" (§7.1): harness, coverage, regression set, scoped `tsc`, `--exact` sanity run, client-equivalence measurement.
- [x] ✅ SA workplan review; Q-1 to Q-7 ruled (approved with C-1 to C-9).
- **Sequence (C-1, extended by the Fix-1 SA review C-5 and the FU-5 SA review Q-5): Fix-1 → Fix-1b → FU-5 → PR 0 → PR 1 → PR 2 → PR 3 → (Fix-2 if decided) → PR 4 → PR 5.** Each off fresh `main` after the previous one merged.
- [x] Fix-1: refuse foreign ids (F-1, F-2, F-4, J/K/L). **Merged 2026-10-07 (#242).** Was on `fix/webhook-connect-tenant-ownership`. Plan and evidence: [BUSINESS_OS_WEBHOOK_CONNECT_FIX1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_FIX1_WORKPLAN.md).
- [x] Fix-1b (F-5) — **merged 2026-10-07 (#246)**: inside `bindPlanSubscription`, keep `bookingId` / `serviceId` / `paymentPlanId` only if `ownerId` owns them; drop, never refuse. Covers the three call sites (`route.ts:1031`, `:1142`, `:1581` at `248de6be`). Code complete 2026-10-07, uncommitted, on `fix/webhook-plan-booking-ownership`: [BUSINESS_OS_WEBHOOK_PLAN_BOOKING_OWNERSHIP_FIX1B_WORKPLAN.md](/docs/workplans/BUSINESS_OS_WEBHOOK_PLAN_BOOKING_OWNERSHIP_FIX1B_WORKPLAN.md). Uses separate `findOwnedId` reads rather than the `resolveContactId` fold (SA accepted). Harness snapshot grows from 40 to 44 entries.
- [x] FU-5 (webhook reliability, infra, no business-logic change) — **merged 2026-10-07 (#250)**: `resolveAccountOwner` throws on a read error (claim released, 500, Stripe retries) and the route's owner cache never holds `null` and is cleared at the start of every request. Was on `fix/webhook-owner-cache-retry`: [BUSINESS_OS_WEBHOOK_OWNER_CACHE_FU5_WORKPLAN.md](/docs/workplans/BUSINESS_OS_WEBHOOK_OWNER_CACHE_FU5_WORKPLAN.md). Harness snapshot grows from 44 to 45 entries (+FU5-1, the 44 others byte-identical).
- [ ] PR 0: harness additions; the "before-with-additions" recorded on post-FU-5 `main` (the snapshot then has 45 entries, not 28); the existing entries proven identical. **Code complete 2026-10-07, uncommitted**, on `feature/webhook-repos-pr0-harness` off `0c3c1800`. Plan refresh and evidence: §7.3.1.
  - [x] ✅ Plan refreshed against `0c3c1800` (§7.3.1): gap list re-derived from a fresh coverage run; SA Q-6/C-4 explicit delegation list (`findEndStateBySubscriptionId`, `endFromStripe`); C-7 timing step.
  - [x] ✅ Before recorded: 45 entries hashed, coverage 73.09 % / 59.02 %, 6 cold `.from(` sites.
  - [x] ✅ 55 scenarios added (X1–X55), written only by `-t`-anchored runs; the 45 existing entries byte-identical.
  - [x] ✅ After recorded: coverage 91.49 % / 75.6 %, 0 cold `.from(` sites, each remaining cold line with its reason; about +0.9 s suite time.
  - [x] ✅ Regression set (55 suites, 931 tests, 100 snapshots), ESLint, scoped `tsc`.
  - [x] ✅ SA code review: approved with CR-1. CR-1 done (three bind error-path tests, §7.3.1); PR0-Q6 fixed.
  - [ ] SA re-check of the CR-1 test diff; QA; user sees the diff; RM commits.
- [ ] PR 1: claim repository, client alias, `routerPlacement` guard moved. **Code complete 2026-10-07, uncommitted**, on `feature/webhook-repos-pr1-claim-client` off `90da8301`. Refresh and evidence: §7.3.2.
  - [x] ✅ Plan refreshed against `90da8301` (§7.3.2): exact lines, method names, C-2 guard audit.
  - [x] ✅ Before recorded: 100 entry hashes, blob `a673a901`, 51 `.from(`, 20 × identical.
  - [x] ✅ `ProcessedWebhookEventRepository` (5 methods, C-3 controls) + 18 unit tests; barrel export.
  - [x] ✅ `route.ts`: client is the `supabaseServer` alias with the RLS-bypass comment; P1–P4 and O1 through the repository.
  - [x] ✅ `routerPlacement.guard` claim check moved and tightened; new "claim table only via its repository" check.
  - [x] ✅ `REPOSITORY_STRATEGY.md` note (C-6).
  - [x] ✅ After recorded: 100/100 entries identical, blob unchanged, 18 × identical, 51 → 46 `.from(`, regression 58 suites / 983 tests, scoped `tsc` and ESLint clean in changed files, mutants G1–G4 and H1–H2 red.
  - [x] ✅ SA code review: approved (D1–D6 accepted, Q1 confirmed). Optional CR-P1-2 and O-P1-1 done, with mutants M5 and M6 (§7.3.2).
  - [ ] QA; user sees the diff; RM commits.
  - *Note (FU-5 SA review, Q-2 observation; pre-existing, not a behaviour change for PR 1):* when the database is fully down, `POST`'s catch can fail to release the claim (`status: 'failed'`). The row then stays `processing`, and later deliveries are answered 200 "duplicate", so the event is not retried. This holds for every handler throw today. FU-5 did not introduce or widen it. Record it when the claim moves behind its repository, and keep the release's failure logged. Any fix (e.g. a stale-`processing` reclaim) is its own change, not part of the byte-identical PR 1.
- [ ] PR 2: invoices. **Code complete 2026-10-08, uncommitted**, on `feature/webhook-repos-pr2-invoices` off `933d661c`. Refresh and evidence: §7.3.3.
  - *Condition from the PR 1 code review (CR-P1-1):* reword the `REPOSITORY_STRATEGY.md` pattern bullet "Errors passed through". Its "They neither catch nor log" stops being true once C-5 makes `findByStripeInvoiceId` log errors other than PGRST116. New wording: "They do not catch; they log only where SA ruled it (C-5)", or equivalent. ✅ Done (bullet reworded, plus a short `PaymentInvoiceRepository` webhook-section note and a Change History row).
  - [x] ✅ Plan refreshed against `933d661c` (§7.3.3): exact lines incl. #257's receipt `id`, method names, C-2 guard audit.
  - [x] ✅ Before recorded: 100 entry hashes, blob `ae7b32c4`, 48 `.from(`, 20 × identical.
  - [x] ✅ `PaymentInvoiceRepository`: 7 new methods in the C-3 section, `findByStripeInvoiceId` with a closed column list, quiet on PGRST116 (C-5) and without its try/catch (PR2-D1); 38 unit tests.
  - [x] ✅ `route.ts`: the 15 sites through the repositories (`findLanguage` reused for J4); 48 → 33 `.from(`.
  - [x] ✅ `noBookingGuess.guard:66` re-homed (C-2, two new arms, old kept); `routerPlacement.guard` gained the "every site converted" and F-1 ordering checks.
  - [x] ✅ After recorded: 100/100 entries identical, blob unchanged, 15 × identical, regression 178 suites / 3,842 tests, scoped `tsc` (0 in changed files, same 58 elsewhere) and ESLint clean, mutants M1–M7 red.
  - [ ] SA code review (PR2-D1 to D4, PR2-Q1, PR2-Q2); QA; user sees the diff; RM commits.
- [ ] PR 3: money rows.
- [ ] PR 4: plans and bookings; two guards moved; plus bind's five inline queries (scope addition, Fix-1b C-4). Also (FU-5 SA Q-3): move the owner check at the plan checkout site (route.ts ~1669) above its `try`, so a lookup failure is no longer logged as "Could not bound a payment plan" before it is rethrown.
  - *PR 0 CR-1 contract:* PR 4 must pass the three CR-1 tests in `bindPlanSubscription.test.ts` **unedited** (and the three read-chain tests from the QA note; blob `2e7b9731…`, §7.3.1). That file also mocks `PaymentPlanSubscriptionRepository` (only `create`, `attachStripe`, `findBySubscriptionId`). If PR 4 moves a bind query behind a `PaymentPlanSubscriptionRepository` method that mock does not list, it needs an explicit delegation there in the shape PR 0 used, and must bring that edit to SA before making it. The method names for bind's five queries are not fixed in §3 yet, so PR 0 does not plan it. Queries moved into `PaymentPlanRepository` / `SchedulingRepository` need no mock change, since that file does not mock them.
- [ ] PR 5: legacy tables, alias removed, rule-1 guard added, lockdown test updated.
  - *Scope addition (FU-5 SA review, rule 1; supersedes Q-2's "tracked follow-up"):* `resolveAccountOwner`'s two direct reads (`lib/payments/stripeAccountContext.ts`) move behind the **existing** repositories. No new repository:
    - `StripeConnectRepository.findOwnerIdByStripeAccountId(stripeAccountId)` (`lib/repositories/PaymentRepository.ts:1498`): `select('user_id').eq('stripe_account_id', …).maybeSingle()`;
    - a `PluginConnectionRepository` method listing by plugin key: `select('user_id, profile_data, status').eq('plugin_key', …)`.
    - Both use the same chains as today and **no status filter**. Do not reuse `findActiveByProfileData`: it filters `active`, which would change which accounts map to a business.
    - Both are unscoped by design: they map an external id to an owner, so the owner is the output. Document that per `tenant-isolation-guard`.
    - The resolver keeps its signature `resolveAccountOwner(db, stripeAccountId)` and builds the two repositories with the injected `db`. A repository `error` becomes FU-5's throw, with the same message (table + PostgREST code only).
    - So `route.ts`, every harness entry's recorded `resolveAccountOwner` args, and PR 5's guard stay unchanged.
    - Add unit tests for each new method (data, miss, error). The resolver's existing unit tests keep passing on the same fake.
    - Estimate +0.25 d.
    - Out of scope: `resolveUserConnectAccounts` and `resolvePaymentCollectionCapability` stay with the purge workplan's T29 item (3).
- [ ] Follow-ups handed to TL: F-1, F-2 (HIGH), F-3, F-4, FU-1 to FU-9.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| A repository method that "looks the same" but issues a different chain (an extra `.select()`, a reordered `.limit()`, a missing `.single()`) | The harness records the chain, so any of these fails the snapshot. The unit test pins it a second time |
| Snapshot quietly rewritten | `--ci`, never `-u`, blob hash and `git diff --exit-code` after every run (§7.2) |
| A site the harness never executes is converted wrongly | PR 0 closes the coverage gaps first; every PR records a coverage run showing its sites executed |
| Mocked repositories in the harness hide new methods | PR 0's fall-through mock; `PaymentPlanSubscriptionRepository` is the only mocked repository that gains methods (`CRMActivityRepository` gains none) |
| A new import pulls a module with load-time side effects into the webhook | Target repositories import only `supabaseServer`, the logger and types (checked); the harness run is the test |
| Moved guards end up weaker | §8: each assertion follows the code into the repository and the route keeps a call-site assertion; SA reviews the guard diffs explicitly |
| Fixing F-1/F-2/F-3 inside the refactor by accident | Guardrails per PR (§9); the snapshot pins today's wrong values (scenario 8's `sub_plan_1`, I5's unscoped update), so an accidental fix fails the proof |
| Merge conflicts with other webhook work (boost 4a, P-3b) | Six short PRs, each off fresh `main`; RM checks for open PRs touching `route.ts` before each branch |
| Edge in the logging layer: `findByStripeInvoiceId` and `findLanguage` log an error on failure, which the inline queries did not | Log-only (excluded from the snapshot by P0-C1). For H1 a miss is a normal path, so the PGRST116 log would be noise: Q-5 |

---

## 13. Open questions for SA

| # | Question | Dev's default |
|---|---|---|
| Q-1 | **F-1 and F-2 are cross-tenant writes; F-3 leaves stopped plans owing money.** Fix before the refactor touches those handlers (PR 2 / PR 4 then move fixed code against a re-recorded "before"), or after PR 5? | Before. Each fix is a few lines with its own harness change, and refactoring a known hole first means moving it twice |
| Q-2 | After PR 5, the route still imports `supabaseServer`, only to pass it to `resolveAccountOwner`, `pilotCreditsToTokens` and `QuotaAllocationService`. Acceptable under rule 1 (no query in the route), or should `resolveAccountOwner` move behind `StripeConnectRepository` in this plan? | Acceptable; moving `resolveAccountOwner` changes a shared helper and belongs to its own task |
| Q-3 | 38 purpose methods with fixed patches (default), or fewer methods taking typed patch objects (for example one `PaymentInvoiceRepository.updateFromWebhook(id, patch: WebhookInvoicePatch)`)? The second is shorter but moves the "what is written" decision back into the route | Purpose methods: the method name is the intent, and the tenant-isolation allow-list is the method body |
| Q-4 | New methods return errors without logging (the route already logs what it acts on). Should the 13 writes whose errors the route discards (FU-9) get a repository `warn` as part of this work, or stay a follow-up because it changes log output? | Follow-up |
| Q-5 | `findByStripeInvoiceId` has no callers and logs an **error** on PGRST116. H1 misses routinely (plan invoices, invoices made in Stripe). Change that method to stay quiet on PGRST116 (no other caller is affected), or add a separate quiet method? | Change the existing method; it was written for this caller |
| Q-6 | Harness: a fall-through `Proxy` over `jest.requireActual` for the mocked `PaymentPlanSubscriptionRepository`, plus `dispatch` and `eventPatch` scenario knobs. Acceptable as the standing pattern for the harness? | Yes |
| Q-7 | Six sequential PRs (§9) or the 4-PR re-cut (0+1, 2+3, 4, 5)? | Six; each is under a day of review |

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-06**
**Status:** ✅ Approved with conditions (C-1 to C-9). Implementation may start once the sequencing in C-1 is agreed with TL and the user.

#### What SA checked against the tree (not taken from the plan)

| Claim | Evidence | Verdict |
|---|---|---|
| 51 `.from(`, 0 `.rpc(`, module-level `createClient` at `route.ts:40` | grep on `route.ts` at `248de6be` (blob `0ad6e6a5…` confirmed by `git rev-parse HEAD:…`); `:40–48` | ✅ |
| Snapshot blob `4f5f223e…` | `git hash-object` on the working-tree snapshot | ✅ |
| `supabaseServer` sends the same requests as `supabaseAdmin` | `lib/supabaseServer.ts`: same `createClient(URL, SERVICE_ROLE_KEY)`, only the `auth` options differ. Those options matter only once a session exists. SA grepped `app/` and `lib/` for any `supabaseServer.auth.signIn*/setSession/verifyOtp/exchangeCode/refreshSession/updateUser`: **0 hits**, so the shared singleton never holds a user session and the bearer stays the service key. This agrees with Dev's measured result | ✅ |
| `findByStripeInvoiceId` matches H1 exactly and has no callers | `PaymentRepository.ts:1321`: `select('*')·eq('stripe_invoice_id')·single`. The only references are its own definition and a comment | ✅ (logs on PGRST116, see C-5) |
| `findLanguage` matches J4 | `BusinessProfileRepository.ts:1296`: `select('language')·eq('user_id')·maybeSingle`. It returns `null` for a non-string, and the route's `\|\| 'en'` gives the same result | ✅ |
| `close()` does not fit M2 | `PaymentPlanSubscriptionRepository.ts:244`: it writes the cancel-reason columns and returns the row | ✅ new `endFromStripe` justified |
| Default client on target repositories | Constructor default or singleton `new …(supabaseServer)` in all eight | ✅ |
| "Target repositories import only `supabaseServer`, the logger and types" (§12) | Not quite. `PaymentPlanRepository` imports `planSchedule` at runtime (the route already imports it, `:19`). `SchedulingRepository` imports `SLOT_HOLDING_STATUSES` from `bookingStatus` at runtime. Both are pure constants or functions, so this is harmless; correct the sentence (C-8) | ⚠️ wording |
| Entitlements not applicable | No target repository and not `route.ts` import `lib/business-os/entitlements/`; only `BusinessOsBoostPurchaseRepository` does, and the plan does not use it | ✅ |
| No migration | Every new method copies a query that runs today | ✅ (the trigger follow-up below needs one, outside this plan) |
| F-3 schema reference | `20260828e_payment_plan_subscriptions.sql` **`:136`** (not `:135`): `subscription_id UUID REFERENCES payment_plan_subscriptions(id)`; no later migration retypes it | ✅ (line fix, C-8) |
| Source guards "moved, never weakened" (§8) | Read all seven route-text readers. One is **missed**: see C-2 | ⚠️ |

#### Rulings on F-1, F-2, F-3 (Q-1), and one upgrade (F-4)

| # | Ruling | Evidence | Severity (SA) |
|---|---|---|---|
| **F-1** | **Confirmed.** H3 (`:1230–1237`) writes the sender's `stripe_invoice_id` onto the row that H2 found by a metadata UUID. The `accountOwns` refusal comes after it (`:1242`) and does not undo the write. `handleConnectInvoicePaymentFailed` (`:1790`), `…Finalized` (`:1897`) and `…Uncollectible` (`:1937`) look the invoice up by Stripe id and **never call `accountOwns`** (the only `accountOwns` in those three is the plan branch at `:1806`). The precondition is easy to meet: the invoice UUID is in the client-facing pay link (`app/invoice/[id]`, `app/api/public/invoice/[id]/pay`), so **any client of a business knows it** | `route.ts` as cited | **Medium-High.** The cross-tenant write is certain: another business's invoice is detached from its real Stripe invoice, so its own later status, pay-link and PDF updates stop landing. The worse half (the attacker's events overwriting the victim's pay link and PDF, or marking the invoice overdue or cancelled) needs the attacker's `finalized`/`payment_failed` events to arrive **after** its `invoice.paid`. Stripe does not guarantee delivery order, but the attacker does not control it either. The paid mark and the payment row are refused, so no money is redirected |
| **F-2** | **Confirmed.** The booking branch (`:1762–1781`) runs `update scheduling_bookings set payment_status='paid' where id = <metadata booking_id>` with no owner check and no `user_id` filter. The precondition is met by any client of the victim business: the self-service booking route returns `booking.id` (`app/api/book/manage/[token]/route.ts:453`) | `route.ts` as cited | **High.** A client who also runs a business on the platform can pay a token amount to **their own** connected account and have the other business's booking show as paid. The business then delivers the service without having been paid |
| **F-3** | **Confirmed.** M3 (`:2030–2041`) filters `payment_plan_installments.subscription_id` (UUID FK to our plan row) with Stripe's `sub_…` id. That never matches, and the error is discarded. The owner path documents and fixes the same bug (`lib/payments/cancelPlan.ts:278–295`, `.eq('subscription_id', planId)`). The snapshot pins `sub_plan_1` (snapshot `:755`, `:2240`) | as cited | **Medium. Data correctness, not security.** It bites only when **Stripe** ends the plan, not when the owner cancels it in-app: the owner path cancels the periods itself, and M1's `status === 'cancelled'` early return then skips. **This one needs a business decision first** (below) |
| **F-4 (upgraded)** | **Confirmed, and worse than §5.3 says.** F2 inserts a `succeeded` transaction under the attacker's own `user_id` (it passes `accountOwns`) with `booking_id` taken from the attacker's metadata. The trigger `propagate_refund_to_booking` (`20260903_propagate_refund_to_booking.sql`, never redefined, `AFTER INSERT … ON payment_transactions`) sums settled money **by booking id across all tenants** and runs `UPDATE scheduling_bookings SET payment_status = 'paid' WHERE id = target` **with no `user_id` filter**. This is the "unscoped trigger" case in `tenant-isolation-guard` Step 4. (`syncBookingsForTransactions` is correctly scoped by `user_id`, so it is the trigger, not the sync, that reaches across) | trigger `:44–100` | **High**, same impact as F-2 by a different event (`payment_intent.succeeded`) |

**Sequencing ruling (Q-1).** Fix first, in separate PRs, each with its own user approval, because each one changes behaviour. Do not fix anything inside this refactor.

- **Fix-1, "Connect webhook refuses ids it cannot prove belong to the sending business"** (about 1 day, one PR, needs **no business decision**: refusing is already the stated policy at `:1242–1252`):
  - F-1: move `accountOwns` before H3.
  - F-1 defence in depth: add `accountOwns` to J, K and L.
  - F-2: scope the booking branch to the account's owner. Use the `.eq('user_id', owner)` shape, so a refused booking is a no-op, not an error.
  - F-4: before the F2 insert, check that the metadata `booking_id` belongs to `ownerId`, and fail closed by **dropping** the foreign `booking_id` to `null`, not by refusing the money row. The money did arrive in that account. Apply the same check to `contact_id` and `service_id`.
  - Each refusal gets its own harness scenario. The PR's intended snapshot diff is reviewed entry by entry.
- **Then PR 0 to PR 5** of this plan. PR 0 records its "before" on the post-Fix-1 `main`.
- **Fix-2 (F-3)** after the user answers the business question. If the answer arrives before PR 4 starts, Fix-2 lands before PR 4. If not, PR 4 moves M3 unchanged (the snapshot pins it) and Fix-2 lands after PR 5. Never inside PR 4.
- **Separate follow-up, outside this plan (it needs a migration):** harden `propagate_refund_to_booking` so the sum and the `UPDATE` are scoped to `NEW.user_id`. Fix-1 closes the webhook route; the trigger is the root cause, and any future writer of `payment_transactions.booking_id` would reopen it.
- If the user declines Fix-1 for now, the refactor may proceed as planned. The snapshot pins today's holes, and the decision is recorded in this section.

**Business question for the user (F-3 only), in plain terms:**
> When a client's instalment plan is ended by Stripe itself, for example because their card kept failing and Stripe stopped retrying, or because someone stopped it in the Stripe dashboard, what should happen to the instalments the client has not paid?
> (a) They stop counting as money the client owes you. This matches what already happens when you cancel a plan inside the app.
> (b) Instalments that were already billed and not paid still count as owed, so you can chase them. Only future instalments are dropped.
> Today, because of the bug, **all** of them keep counting as owed, so the "money owed" figure is overstated for Stripe-ended plans. Answer (b) needs one extra rule (Stripe tells us why it ended the plan), so it is slightly more work than (a).

#### Rulings on the other questions

| # | Ruling |
|---|---|
| Q-2 | **Accepted.** The route may import `supabaseServer` only to hand it to `resolveAccountOwner`, `pilotCreditsToTokens` and `QuotaAllocationService`. Moving `resolveAccountOwner` behind `StripeConnectRepository` is a tracked follow-up, not part of this plan. The PR 5 guard asserts that `supabaseServer` appears in `route.ts` only as an argument to those three |
| Q-3 | **Purpose methods (Dev's default)**, with the bloat controls in C-3. A typed-patch `updateFromWebhook(id, patch)` is rejected. It moves "what is written" back into the route, it is a generic update that `tenant-isolation-guard` Step 3 warns against, and it would leave the moved `noBookingGuess` guard (C-2) unable to prove anything. Collapsing methods whose chain differs only by a literal (`setStatusFromStripe(id, 'overdue' \| 'cancelled')`, the shared `markPaidUnscoped`, `findByStripeInvoiceId(id, columns)`) is right; do more of it where the chains are identical |
| Q-4 | **Follow-up (FU-9).** Not part of this plan |
| Q-5 | **Change the existing `findByStripeInvoiceId`** so it stays quiet on PGRST116 (no other caller), with a unit test. Other errors still log at `error`. That adds a log line on a real DB error where the inline query had none, which is a log-only change and accepted (P0-C1). Same for `findLanguage` |
| Q-6 | **Accepted with a narrower mechanism (C-4).** Delegate the named new methods explicitly to `jest.requireActual(…)`, not through a `Proxy` over every unlisted method. Both reach the same snapshot, and the explicit list avoids a new test pattern that would silently send any future unmocked method to the DB mock. The `dispatch` and `eventPatch` knobs are fine, scoped to this harness |
| Q-7 | **Six sequential PRs (PR 0 to PR 5)**, plus Fix-1 before them and Fix-2 when decided. Each is at most 1 day, off fresh `main`, with no stacking. This fits the small-numbered-slices preference better than the 4-PR re-cut. PR 0 stays alone because every later proof depends on its baseline |

#### Conditions

- **C-1 Sequencing.** Order: Fix-1, then PR 0 to PR 5, with Fix-2 placed as described above. PR 2 must not start before Fix-1 has merged, or before the user has declined it in writing. RM checks for open PRs touching `route.ts` before each branch is cut.
- **C-2 Guard missed by §8 (must fix in PR 2).** `noBookingGuess.guard.test.ts:66` asserts `handler` does **not** match `from('payment_invoices')…booking_id:`. Once PR 2 moves the invoice writes out, that assertion passes vacuously: the guard is weakened without anyone touching it. PR 2 must re-home it:
  - assert that the paid handler's `payment_invoices` writes go only through `recordStripeInvoiceId` and `markPaidFromStripeInvoice`;
  - assert that neither method body contains `booking_id`;
  - keep the handler-side negative as well.
  The same audit applies in every PR: list each `not.toMatch` / `not.toContain` on `route.ts` text that names a table or a query, and say where it now bites. Also, `planSurfaces.guard.test.ts:108` slices `recordPlanPeriodPaid` to end of file; when moving it in PR 4, bound the slice to the function.
- **C-3 Bloat controls (Q-3).**
  - One section per touched class, headed `// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)`.
  - Each unscoped method's doc comment carries the marker and names the owner check it relies on.
  - The unit test for each unscoped method asserts it adds no `user_id`.
  - The column constants are a closed union type.
  - Inserts take the typed row, and the route passes an object literal or uses `satisfies`, so the excess-property check actually rejects an extra key (a pre-built variable bypasses it).
  - No generic patch or update methods.
- **C-4 Harness fall-through.** Use an explicit delegation list, not a `Proxy` (Q-6). PR 0's entry-by-entry comparison of the 28 old snapshot entries stays as planned.
- **C-5 `findByStripeInvoiceId` quiet on PGRST116** (Q-5) in PR 2, with a test.
- **C-6 Docs.** The `REPOSITORY_STRATEGY.md` note on "unscoped by design, owner proven by `accountOwns`" lands in **PR 1** (the first such repository), not PR 5.
- **C-7 No added CI time.**
  - The PR 5 rule-1 guard is a new `it` inside `routerPlacement.guard.test.ts`, reusing its already-parsed `SourceFile`. No new suite and no second parse.
  - Repository unit tests use the recording fake client: no DB, no network.
  - The eleven new harness scenarios live in the existing suite. PR 0 records the suite's wall time before and after in its evidence.
- **C-8 Text corrections before PR 0.**
  - Schema line `:136`.
  - F-4 raised to High, with the trigger evidence.
  - Fix §12's "imports only…" sentence.
  - Replace §9's "SA/TL decide" with the C-1 order.
  - Add Fix-1, Fix-2 and the trigger-hardening follow-up to §11.
- **C-9 No fix inside the refactor.** Already a §12 risk; restated as a condition. The F-1 order (H3 before `accountOwns`), I5 unscoped, and M3's Stripe id stay exactly as pinned in every refactor PR, unless Fix-1 or Fix-2 has merged first and the "before" was re-recorded.

#### Final PR split

| Order | PR | Behaviour change? | Approval |
|---|---|---|---|
| 1 | **Fix-1**: refuse foreign ids (F-1, F-2, F-4, plus `accountOwns` on J/K/L) | Yes, intended | User, as a security fix |
| 2 | PR 0: harness gaps (tests only) | No | Standard cycle |
| 3 | PR 1: claim table and client | No | Standard cycle |
| 4 | PR 2: Connect invoices (+ C-2, C-5) | No | Standard cycle |
| 5 | PR 3: money rows | No | Standard cycle |
| — | **Fix-2** (F-3) here if the business answer is in | Yes, intended | User decision (a)/(b) |
| 6 | PR 4: plans and bookings | No | Standard cycle |
| 7 | PR 5: legacy tables, alias removed, rule-1 guard | No | Standard cycle |
| — | Fix-2 here if it was not answered earlier; trigger hardening as its own migration follow-up | Yes | User |

### Approval
[x] Workplan approved with conditions C-1 to C-9. Proceed in the order above.

### PR 0 code review

**Code Review by SA — 2026-10-07**
**Status:** ✅ Code Approved, with one condition (CR-1) to meet before commit

Scope: worktree `neuronforge-webhook-repos`, branch `feature/webhook-repos-pr0-harness`, base `0c3c1800`, uncommitted. The edit to `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` belongs to TL and was not reviewed here.

#### What SA checked itself (not taken from §7.3.1)

| Claim | SA's own evidence | Verdict |
|---|---|---|
| No production file changed | `git status` / `git diff --numstat`: the harness, its snapshot, `fix1Ownership.qa.test.ts`, one new fixture, two docs. Nothing else | ✅ |
| `route.ts` untouched | `git rev-parse HEAD:…route.ts` = `origin/main:…route.ts` = `git hash-object` of the working file = `df671c4a…` | ✅ |
| 45 identical, 55 new, 0 changed | SA's own script: evaluates the base `.snap` (`git show 0c3c1800:…`) and the working `.snap` in a `vm` context, compares each `exports[…]` by string equality and sha256. **base 45, new 100, identical 45, changed 0, missing 0, added 55**, and all 55 are in the `CF-5 PR 0` describe. `git diff --numstat` on the snapshot: 7,407 / 0 | ✅ |
| Blobs | snapshot `a673a901…`, harness `a7cc9992…`, `fix1Ownership.qa` `03b61e89…`, fixture `f8473c63…`: all match §7.3.1. The snapshot blob was unchanged after each of SA's three runs | ✅ |
| Only deletion is the `mockEvent` line | `git diff` of the harness: one `-` line, `mockEvent = JSON.parse(`, replaced by `fixtureEvent` plus the `eventPatch` merge. `fix1Ownership.qa`: 10 added lines, 0 removed. No assertion removed | ✅ |
| Q-6 / C-4 met | Both repository mocks list the four recorded methods plus two named delegations to `jest.requireActual(…).paymentPlanSubscriptionRepository`, resolved at call time and called as methods, so `this` binds. No catch-all: any other method is `undefined`, so a call is a `TypeError`. The only `Proxy` in either file is the pre-existing PostgREST builder. The delegation is sound: `createClient` is mocked file-wide and the real repository's `supabaseServer` is built from it, so a delegated query records through `mockSupabase` | ✅ |
| Coverage | SA's own run, same command as §7.1: **statements 91.49 %, branches 75.6 %, functions 86.66 %, lines 92.21 %**. Per `.from(` line, using the smallest enclosing statement (not the whole-line count, which an enclosing `if` would satisfy): **51 sites, 0 with a zero count** | ✅ |
| Fixture | `fixtures/platform/subscription-deleted-legacy.json`: synthetic ids (`evt_…legacy`, `sub_platform_legacy_1`, `cus_platform_1`, `agent-platform-user`), `livemode: false`. No key, token, e-mail or real id. The harness additions have no secret-shaped strings either | ✅ |
| Determinism | No timers, `Date` or random in the new code. Timestamps go through the existing `sanitise` (`<NOW>` within 10 minutes of `runStartedAt`), as in the 45 old entries. X2/X3/X55: with `current_period_end: null` the route computes `new Date()` and then `Date.now()`, so `days_since_period_end` is `floor(≥0 ms / day) = 0` on any day. The `due_date: '2026-12-01'` in `PLAN_PERIOD_DB` is passed through as `chargeAt` and never compared with the clock (`route.ts:995`), the same as the existing `:508` use. Settling is the existing single `setImmediate`. The H8 receipt arm was left out because it could flake, which is the right call. The suites passed on all three of SA's runs | ✅ |

**SA's runs** (each `node node_modules/jest/bin/jest.js --ci --runTestsByPath …`):

- harness + `fix1Ownership.qa`: 2 suites, **149 tests, 100 snapshots** passed;
- every `app/api/stripe/webhook/__tests__/*.test.ts`: **9 suites, 251 tests, 100 snapshots** passed;
- the harness with coverage: 102 tests, 100 snapshots passed.

#### Sample of new entries read as effect sequences (at least one per PR group)

| PR | Entry | Effect sequence matches the name? |
|---|---|---|
| 1 | X10 | Claim select, then claim insert; body `{ received, duplicate }`, 200, nothing after. ✅ |
| 1 | X12, X13 | Claim select, insert, K1, `resolveAccountOwner`, K2 update, claim `completed`. The run goes on past the failed claim. ✅ The two traces are identical; they differ only in the DB answer and the log, which the snapshot does not carry (see O-1) |
| 1 | X53 | Ends at the failed `payment_transactions` insert with 500. No claim update follows. ✅ |
| 2 | X15 | I1 select, `resolveAccountOwner`, claim completed; no transaction, no invoice write. ✅ |
| 2 | X16 | Transaction insert, then the invoice paid update, then claim `failed` with `Failed to mark invoice pinv-0002 paid: write rejected`; 500. ✅ |
| 2 | X48 | H2 by Stripe id, then by `id = pinv-0001`, both PGRST116; claim completed, no write. ✅ |
| 2 | X52 | J4 `business_profiles` `language` read answers nothing; the activity title is `Payment failed: $120.00`. ✅ |
| 3 | X4 | E1 is `eq('stripe_charge_id','ch_connect_1')`, the charge-id arm; both refund upserts carry `stripe_connect_account_id: null`; then sync, claim completed. ✅ |
| 3 | X5 | D1 by charge id; D2 writes `status: 'refunded'` with `phase: 'closed'`, `status: 'won'` in the dispute metadata. ✅ |
| 3 | X26 | First refund upsert fails, then claim `failed`, `Failed to record refund re_1`; 500. ✅ |
| 3 | X29 | F1 hit, then claim completed; no link reads. ✅ |
| 4 | X6 | M1, owner check, M2 `{ completed_at, status: 'completed' }`; no `payment_plan_installments` update. ✅ |
| 4 | X7 | G1 miss, G2 insert with `booking_id: null`, G3, next-period read, `recordPeriodPaid`, `close('completed')`; no `scheduling_bookings` write. ✅ |
| 4 | X11 | `findBySubscriptionId`, owner, `recordFailure('plan-1','card_declined')`, claim completed; no J1. ✅ |
| 4 | X35, X40, X41, X51 | Refusal or early return after the read; no write. ✅ (X40 and X41 have identical traces, O-1) |
| 5 | X1 | N1 `user_subscriptions` update `status: 'canceled'`, N2 `billing_events` insert. ✅ |
| 5 | X2, X55 | The recorded `dispatchBusinessOsEvent (scenario override)`, A1, then A2 in X55 only, A3, A4, audit. Grace 5 days in X2, the default 3 in X55, `days_since_period_end: 0`. ✅ |
| 5 | X43 | Override recorded, then claim completed; nothing written. ✅ |
| 5 | X54, X46 | X54: `balance_before: 2500`, purchase row `transaction_id: 'ctx-1'`. X46: `boost_pack_id: null` and no `boost_pack_purchases` insert. ✅ |

#### Rulings on PR0-Q1 to PR0-Q6 and C-7

| # | Ruling |
|---|---|
| **PR0-Q1** | **In PR 0 (condition CR-1).** A test added as PR 4's first commit gives a weaker "before": once squash-merged, nothing on `main` ever ran it against the untouched bind, and the reviewer has to trust the commit order. Landed in PR 0, CI runs it on `main` against today's inline queries, and PR 4 then has to pass it unchanged. That matches how the harness is treated (frozen after PR 0) |
| PR0-Q2 | **Accepted.** Three `-t`-anchored write runs, 0 updated each time, the comparison repeated after each, and SA's own comparison of the final file agrees. No `-u` was used |
| PR0-Q3 | **Accepted.** `routerEdgeCases.qa` never reaches `handlePlanSubscriptionEnded`. `fix1Ownership.qa` does, so it is the suite that would turn into a `TypeError` in PR 4. SA also checked `ownerCacheRetry.qa`, which reaches `:2160`. It does not mock the repository (real module over a mocked `createClient`), so it needs no delegation and will run PR 4's real methods |
| PR0-Q4 | **Accepted.** Pinning the dead `handleInvoicePaymentFailed` through a recorded override is the only way PR 5 can prove A1–A4. Every such entry names the override and records it as an effect, so nobody can read it as reachable. Deleting the handler stays FU-1 |
| PR0-Q5 | **Accepted.** 13,418 lines is the cost of full traces, and reformatting would change the 45 baseline entries |
| PR0-Q6 | **Accepted as a follow-up; fixing it here is optional.** `:596` is a pre-existing error from FU-5, and ts-jest does not type-check here. Because the file is already in this diff and the fix is a single annotation on the `for … of` array (`as Record<string, string>[]`) that changes no runtime behaviour, Dev may fix it in PR 0. If not, record it as a named follow-up in §11. Not blocking |
| **C-7** | **Met.** About +0.9 s median (interleaved pairs, loaded runs discarded: sound method), all inside the existing suite, in one of the three `Gate tests` shards. No new suite, no new job. The Jest gate already finishes well ahead of `Build`, so the critical path does not move. Confirmation step: RM or QA reads the PR run and records that the shard holding this suite still finishes before `Build`. If it does not, stop and come back to SA |

#### Code Review Comments

1. **CR-1 (condition, before commit). `lib/payments/__tests__/bindPlanSubscription.test.ts`: add the three error-path tests in PR 0. Priority: High (they are PR 4's only "before" for those arms).**
   - Write them against the untouched bind, through the existing `@/lib/supabaseServer` mock.
   - Assert the outcomes the route depends on, not just that the code ran:
     - `:431`, installments insert errors: bind still resolves, and the booking link update is still sent with `eq('id', bookingId)` and `eq('user_id', ownerId)`;
     - `:454`, booking link update errors: bind resolves and does not throw;
     - `:483–484`, contact read errors: the installments insert carries `contact_id: null`, and bind resolves.
   - Record the test file's blob after PR 0 in §7.3.1, next to the harness blob. PR 4 checks it the same way (§7.2).
   - PR 4 must pass these three tests **unedited**. That test file mocks `PaymentPlanSubscriptionRepository` too. If PR 4 moves a bind query behind a method that file's mock does not list, PR 4 needs an explicit delegation there, in the same shape as this PR's. Planning it in PR 0 is better, but only if the method names are fixed in §3; otherwise PR 4 brings it to SA before it edits that file.
   - Coverage evidence after CR-1: `bindPlanSubscription.ts` lines 431, 454 and 483–484 executed.
   - SA re-checks only that test diff. No new review cycle.
2. **O-1. Identical traces: X12 = X13 and X40 = X41.** Each pair differs only in the DB answer and the log line, neither of which is in the snapshot (P0-C1). Each entry still earns its place: it executes its arm, and it would catch a repository that throws or returns a different shape on that arm. But the snapshot cannot tell the two arms of a pair apart. Not a change request. If PR 1 or PR 4 wants to prove which branch logged, the `mockLogLines` side channel is the tool, as P-1 used it. Priority: Low.
3. **O-2. The delegation names are now a contract with PR 4.** `findEndStateBySubscriptionId` and `endFromStripe` are frozen into a harness that is not edited after PR 0. If PR 4 picks other names, the harness breaks loudly with a `TypeError` (safe), but fixing it means editing the frozen file. PR 4 keeps the §3 names, or comes back to SA first. Priority: Low (process note).

#### Optimisation Suggestions

- The new `describe`'s header comment states that entries pin today's behaviour, holes included (C-9). Keep that wording; it stops a later reader from taking X40 or X15 as a spec.

#### Code Approved for QA: Yes, once CR-1 is in

SA spot-checks the bind test diff, then QA proceeds. Nothing else is required. The PR0-Q6 one-liner is Dev's choice.

#### CR-1 re-check (SA, 2026-10-07)

**Status:** ✅ CR-1 met. **Code Approved for QA: Yes.**

| Check | SA's evidence | Verdict |
|---|---|---|
| No production file in the diff | `git diff --name-only`: only `__tests__/` files and docs. `bindPlanSubscription.test.ts` blob `e87c78f2…` | ✅ |
| Knobs off, the mock answers as before | `updateError` defaults to `null` and is reset in `beforeEach`. An awaited update answers `{ data: [], count, error: null }`, the same object as before. `contactReadError` is checked only after the ownership-read branch (`select('id')` plus an id filter), so Fix-1b's booking ownership read is untouched and only the `select('contact_id')` read can fail. The new `calls.push(['update', …])` appears only on update chains; bind never ends an update with `maybeSingle`, so no existing `mockQueries` assertion can see it | ✅ |
| The 28 old tests are unedited | The diff touches only the mock (the `then` rewrite is the 2 `−` lines), `beforeEach` (3 resets) and a new trailing `describe`. No existing `it` is changed | ✅ |
| The new assertions pin the branches | `:431`: insert error → bind resolves, the error is logged with its exact message, and the booking link update is still sent with `eq('id', BOOKING)` and `eq('user_id', 'user_1')`. `:454`: update error → bind resolves, exactly one link update, the error is logged with `bookingId`. `:483–484`: read error → 3 rows, all `contact_id: null`, where the default would be `contact_1`. Each test fails if PR 4 makes its arm throw, skip the next step, or carry a different value | ✅ |
| Coverage | SA's run: `bindPlanSubscription.ts` lines **100 %** (branches 85.89 %). Lines 431, 454 and 483–484 are executed; 487 is the `data?.contact_id ?? null` value fallback | ✅ |
| Runs (`--ci --runTestsByPath`) | bind: **31/31** passed. Harness + `fix1Ownership.qa`: **149 tests, 100 snapshots** passed. Snapshot blob still `a673a901…` | ✅ |
| PR0-Q6 | `fix1Ownership.qa.test.ts:595`: `as Record<string, string>[]` on the loop array. Type-only; no runtime change | ✅ |

**Optimisation (Low, not blocking):** in the `:483–484` test, also assert that the `scheduling_bookings` `select('contact_id')` read was issued (in `mockQueries`). Today `contact_id: null` would also follow if a later change dropped the booking before the read; the extra assertion would tell the two causes apart. If it is added, update the blob recorded in §7.3.1.

### PR 1 code review

**Code Review by SA — 2026-10-07**
**Status:** ✅ Code Approved (APPROVED_CODE_REVIEW). No blocking finding. CR-P1-1 is a condition on **PR 2**, not on this PR.

Scope reviewed: the uncommitted diff on `feature/webhook-repos-pr1-claim-client` against `90da8301`: `route.ts`, the new `ProcessedWebhookEventRepository.ts` and its test, `routerPlacement.guard.test.ts`, `lib/repositories/index.ts` and `docs/REPOSITORY_STRATEGY.md`. The `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` edit is TL's and out of scope.

#### What SA checked itself (not taken from §7.3.2)

| # | Check | SA's evidence | Verdict |
|---|---|---|---|
| 1a | Snapshot unchanged | `git hash-object` on the `.snap` before and after SA's harness run: `a673a9019e84…` both times. Harness `--ci`: **102 tests, 100 snapshots passed**, no obsolete or written entries | ✅ |
| 1b | Entry by entry (SA's own method) | SA loaded `git show 90da8301:<snap>` and the working copy as CommonJS modules and compared an md5 of each `exports[…]` value: **base 100, work 100, 100 identical, 0 differing, 0 missing, 0 added**. Separately, the harness matches every one of them against what the moved code now records, and it records the full query chain (294 `processed_webhook_events` lines in the snapshot, every claim scenario incl. `23505`, DB-down insert, failed read, failed-row reclaim) | ✅ |
| 1c | Harness and frozen tests untouched | `git diff --stat 90da8301 -- app/api/stripe/webhook/__tests__/ lib/payments`: only `routerPlacement.guard.test.ts`. Harness blob `a7cc9992…` = `90da8301`'s | ✅ |
| 1d | `check-logging-only-diff --exact`, all 20 top-level functions, base `90da8301` | Run by SA (`tsx`): **18 identical; `completeClaim` and `POST` differ**, and the printed hunks are exactly the five claim sites (the rest of `POST` prints as context, unchanged). Module-level diff read by hand: the `createClient` import → `supabaseServer` + repository imports, and the client block → the alias with its comment. Nothing else | ✅ |
| 2 | Client | `lib/supabaseServer.ts`: `createClient(NEXT_PUBLIC_SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)`, same URL and key; only the `auth` options differ, which SA ruled harmless in the workplan review (no session ever set on the singleton; Dev's request-capture measurement). The RLS-bypass comment is present at the alias, per §4 and CLAUDE.md Security Rules | ✅ |
| 3a | Each method's chain = the old inline chain | Read side by side with the `-` lines: `findClaim` `select('event_id, status')·eq('event_id')·maybeSingle`; `insertClaim` `insert(row)` awaited, no `.select()`; `reclaimFailed` `update({status:'processing', failure_message:null, processed_at})·eq`; `complete` `update({status:'completed', completed_at})·eq`; `markFailed` `update({status:'failed', failure_message})·eq`. Key order identical. `maybeSingle<WebhookClaim>()` is a type argument only | ✅ |
| 3b | 23505 path | `insertClaim` returns `{ data: null, error }` with supabase-js's own object; the route's `insertError.code === '23505'` branch is byte-identical; unit test asserts identity (`toBe`) | ✅ |
| 3c | `.slice(0, 500)` and the release `try/catch` | Both remain in the route at the `markFailed` call; the repository does not truncate and does not catch (test: "does not catch a throw") | ✅ |
| 3d | Q-3 / C-3 controls | Section header verbatim; `⟨unscoped-by-design⟩` on all five method docs (source test pins it); `CLAIM_COLUMNS` constant with its literal type; `NewWebhookClaimRow` with `status: 'processing'`, route passes an object literal; `@ts-expect-error` on an injected `user_id` — **SA's scoped `tsc` (scratch tsconfig: repository, its test, `route.ts`, the guard, `index.ts`; 8 GB) reports 0 errors in those files**, so the directive is consumed (an unused one would be TS2578); 64 pre-existing errors elsewhere, the §7.1 total. No generic update, no spread payload, no `delete`/`upsert`/`rpc`. Every method has a no-owner-filter test | ✅ |
| 4 | Tenant isolation (`tenant-isolation-guard`) | See below | ✅ |
| 5 | `routerPlacement.guard` rewrite | See below | ✅ stricter |
| 6 | Shared surface with P-3b.2 | `git diff 90da8301` contains no `BUSINESS_OS_FLOW_HANDLERS` or `dispatchBusinessOsEvent` line (the one hit is the workplan's own prose); `--exact` shows them only as unchanged context in `POST` | ✅ |
| 7 | `REPOSITORY_STRATEGY.md` | Tree entry, catalog section and the pattern match the code: method list and semantics, "complete only via `completeClaim()` (source guard)", "Rule 4" is CLAUDE.md rule 4, typed literal insert, no generic update, same error object. One sentence will go stale in PR 2 (CR-P1-1) | ✅ |
| 8 | Rules 1, 3, 4, 6; console; entitlements | Rule 1: the five claim sites leave the route (51 → 46 `.from(`). Rule 3: `console.` count 0 in all four `.ts` files; no log line added, moved or removed. Rule 4: the exception is documented in the file header, the section comment, each method doc and the strategy doc. Rule 6: no `any` added (the test uses `as unknown as` casts only). Entitlements: the repository imports only `@supabase/supabase-js` types and `@/lib/supabaseServer`; the barrel line added is this repository only, and the barrel's existing entitlement exports are repository files, not `lib/business-os/entitlements/`; `businessOsEntitlements.imports.guard` passes. ESLint on the repository, its test, the guard and `index.ts`: exit 0. Only importers of the new file: the route, the barrel and two tests (no `'use client'`) | ✅ |
| 9 | Runs (`--ci --runTestsByPath`, no `-u`) | Every `app/api/stripe/webhook/__tests__/*.test.ts`, every `lib/payments/__tests__/*.test.ts`, the new repository test, `noBookingGuess.guard`, `stripeAuditEntries`, `userSubscriptionsWriteLockdown.qa`, `userSubscriptionsWriteLockdownMigration`, `bookingPaymentStatusReaders.guard`, `noPilotCreditTableReads.guard`, `mutationOrSelect.guard`, `businessOsEntitlements.imports.guard`, `check-logging-only-diff`: **59 suites, 1,008 tests, 100 snapshots, all passed**. Snapshot blob after the run: `a673a901…` | ✅ |

#### Tenant isolation (item 4)

"Unscoped by design" is correct here, and it is documented in four places (file header, section comment, each method's doc, `REPOSITORY_STRATEGY.md`).

- **Key.** Every method filters on `event_id` only. That id comes from `event`, which exists only after `stripeService.constructWebhookEvent(body, signature, secret)` succeeded; a failed signature returns 400 before the first claim query. Stripe event ids are globally unique, Connect events included, and a business cannot choose another tenant's.
- **Payload.** No caller-controlled field reaches a write. The insert row is a fixed type built from the verified event, `user_id` is rejected at compile time, and each update's patch is fixed inside its method (Step 3 allow-list, by construction).
- **Scope-defeating three (Step 4).** No trigger on `processed_webhook_events` in `supabase/migrations/` (the only `ON processed_webhook_events` is an index). No upsert. No injected field.
- **What the row holds.** A claim holds no business data. Client grants on the table were revoked in `20261038`, so it is server-write-only.
- **Purge descriptors.** They record that the table carries a `user_id` and exclude it deliberately. Leaving that column unread and unwritten is today's behaviour, and filtering on it would change the query (C-9).

#### `routerPlacement.guard` (item 5): every old assertion still bites

| Old assertion | Where it bites now |
|---|---|
| `completeClaim` exists | Unchanged |
| `completeClaim`'s code contains `status: 'completed'` | Split in two, both required: `completeClaim` calls `processedWebhookEventRepository.complete` exactly once, **and** the repository's `complete` method contains `status: 'completed'` |
| No other `status: 'completed'` in the route, outside `completeClaim` | **Stricter:** none anywhere in the route, the `completeClaim` exception is gone. **New:** none in the repository outside `complete`. **New:** the route calls `processedWebhookEventRepository.complete` nowhere outside `completeClaim` |
| `completeClaim` called ≥ 3 times in `POST` | Unchanged |
| (new `it`) | The route code without comments has no `from('processed_webhook_events')`, and `POST` calls each of the other four methods exactly once |

Dev's mutants G1 to G4 show each new arm going red, and the "inline write sneaks back" case is caught twice (the `from(` check and the status check). The old guard's blind spots (a `'completed'` held in a variable; a write from another file) are unchanged, so nothing is weaker. Optional hardening is in O-P1-1.

#### Rulings on PR1-D1 to PR1-D6 and PR1-Q1

| # | Ruling |
|---|---|
| **PR1-D1** no `try/catch` | **Accepted. This is the only choice that keeps behaviour identical.** The template's catch exists to keep a repository from throwing at its caller. supabase-js already returns query errors without throwing, so on the error path the template's catch would change nothing and the "returns `{ data, error }`" checklist item is met. It matters only on a real throw, and there it would change behaviour in two places. In `findClaim`, a thrown read today reaches `POST`'s outer catch with `processedEventId` null and gets a 500, so Stripe retries. A catch would turn it into `checkError`, log it and carry on processing **without a claim**. In `markFailed`, a catch would silence "Could not release failed event". So the absence is required, and it is documented in the header and pinned by a test. Record it as the webhook-repository exception in `REPOSITORY_STRATEGY.md`, which the "Errors passed through" bullet already does |
| **PR1-D2** no logger | **Accepted, no field.** A logger field that is never called is dead code (SA Phase 2 item 8). The checklist's actual aim, "no `console.*`", is met. Adding log lines for the errors the route discards is FU-9 (Q-4) and would make this PR a log-change PR. When FU-9, or C-5 in PR 2, gives a repository something to log, it uses `createLogger({ service: '<Name>Repository' })` per the template |
| **PR1-D3** own `WebhookClaimResult<T>` | **Accepted.** `AgentRepositoryResult`'s `error: Error` would drop `.code` from the type, and the 23505 check needs it. Keep `PostgrestError \| null` |
| **PR1-D4** order of evaluation | **Accepted.** The payload values are pure, and the only observable difference needs a `String()` that throws. Either way that throw lands in the same release `catch`. The harness shows the effects are identical |
| **PR1-D5** guard parses a second file | **Accepted.** C-7 forbade re-parsing the **route**. A 165-line file parsed once costs nothing measurable, and the guard needs it to follow the completing write |
| **PR1-D6** 20 functions, untouched set 18 | **Recorded.** SA's `--exact` run enumerated 20 top-level functions: 18 identical, 2 differing |
| **PR1-Q1** PR 1 note placement | **Confirmed.** It stays a note, in `markFailed`'s doc comment and in §11. That is the right place: the next reader of the release code meets it. A fix (for example reclaiming a stale `processing` row) is a behaviour change that needs its own requirement, outside CF-5 (C-9) |

#### Code Review Comments

1. **CR-P1-1** `docs/REPOSITORY_STRATEGY.md`, pattern bullet "Errors passed through": "They neither catch nor log" is stated for all the webhook repositories, but C-5 / Q-5 has `PaymentRepository.findByStripeInvoiceId` log on non-PGRST116 errors in PR 2. **Condition on PR 2, not PR 1:** PR 2 rewords it to "They do not catch; they log only where SA ruled it (C-5)", or something equivalent. — Priority: Low
2. **CR-P1-2** `ProcessedWebhookEventRepository.ts`: the new-repository checklist asks for types re-exported from `index.ts`. `NewWebhookClaimRow`, `WebhookClaim`, `WebhookClaimResult` and `WebhookClaimStatus` are not. The only consumer imports the file directly, so nothing is broken. **Optional.** If wanted, one `export type { … } from './ProcessedWebhookEventRepository'` line, as `ArchiveRepository` has. — Priority: Low

#### Optimisation Suggestions

- **O-P1-1 (guard, optional).** Two cheap extra arms in the new `it`. First, the route never names the class `ProcessedWebhookEventRepository`, only the singleton: a `new ProcessedWebhookEventRepository().complete(…)` would otherwise get around "complete only via `completeClaim`". Second, the `from(` regex also matches a backtick-quoted table name.
- The `--exact` per-function check cannot see module-level statements (§7.4). For PR 2 onward, keep quoting the module-level diff in the evidence; SA checked it by hand here.

#### Code Approved for QA: Yes

No change is required before QA. CR-P1-2 and O-P1-1 are Dev's choice; if Dev takes either, SA needs only the re-run of the guard and repository suites, not a fresh review. CR-P1-1 is carried to PR 2's review.

### PR 2 code review

**Code Review by SA — 2026-10-08**
**Status:** 🔄 Fix Required (NEEDS REVISION), one finding: CR-P2-1, the PR2-Q1 ruling. Everything else is approved as it stands.

Scope reviewed: the uncommitted diff on `feature/webhook-repos-pr2-invoices` against `933d661c`. That covers `route.ts`, `PaymentRepository.ts`, the new `PaymentInvoiceRepository.webhook.test.ts`, `noBookingGuess.guard.test.ts`, `routerPlacement.guard.test.ts` and `docs/REPOSITORY_STRATEGY.md`. The `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` edit is TL's and is out of scope.

#### What SA checked itself (not taken from §7.3.3)

| # | Check | SA's evidence | Verdict |
|---|---|---|---|
| 1a | Snapshot unchanged | `git hash-object` on the `.snap` before and after SA's runs gave `ae7b32c4480a…` both times, equal to `git rev-parse 933d661c:<snap>` | ✅ |
| 1b | Entry by entry (SA's own method, not Dev's sha256) | SA wrote `git show 933d661c:<snap>` to the scratchpad, evaluated both files in a `vm` context and compared a sha1 of each `exports[…]` value. Result: **base 100, work 100, 100 identical, 0 differing, 0 missing, 0 added** | ✅ |
| 1c | `check-logging-only-diff --exact`, base `933d661c` | SA ran it (`tsx`) on the 15 untouched functions, named one by one (`handleInvoicePaymentFailed`, `handleCheckoutCompleted`, `handleSubscriptionUpdated`, `handleDispute`, `handleChargeRefunded`, `ownedOrNull`, `handleConnectPaymentIntentSucceeded`, `recordPlanPeriodPaid`, `handleConnectPlanSubscriptionCreated`, `accountOwns`, `accountOwner`, `handlePlanSubscriptionEnded`, `handleSubscriptionDeleted`, `completeClaim`, `POST`): **15 × identical, exit 0**. Together with the five converted handlers that makes the 20 top-level functions | ✅ |
| 1d | Module-level diff | Read by hand. The only change is two import statements (`paymentInvoiceRepository` and the three column constants, then `businessProfileRepository`). `BUSINESS_OS_FLOW_HANDLERS` and the dispatcher are not in the diff | ✅ |
| 1e | Each converted site against its old inline chain | Read side by side with the `-` lines. **H1**: `'*'`, `eq stripe_invoice_id`, `single`; the route reads only `data` (the `lookupError` was already unused). **H2/I1**: `'*'`, `eq id`, `single`; the same `{data, error}` reaches `invoiceByMetadata && !metadataLookupError` and `lookupError \|\| !platformInvoice`, and I1's error still reaches `log.error({ err: lookupError … })`. **H3**: `{stripe_invoice_id, updated_at: new Date()…}` in that order, `eq id`, awaited, result ignored as before. **H6**: `{status:'paid', paid_at, stripe_hosted_invoice_url, stripe_invoice_pdf, updated_at: paidAt}`, the same order and the same `paidAt`; an `undefined` from Stripe is still passed through (the unit test pins it); `updateError` still reaches the same `log.error` and `throw`. **H8 (#257)**: `'id, user_id, client_email, client_name, invoice_number, currency, booking_id'` (`id` included), `maybeSingle`, still inside the IIFE's `try`, so a rejection still lands in its existing `catch`. **I3**: `{status, paid_at, updated_at: paidAt}`. **J1/K1/L1**: `'id, invoice_number, user_id'` (one constant, PR2-D3), `single`, error or no data → the same `log.info` + return. **J2/L2**: `{status, updated_at}` with the literal now passed as an argument; key order unchanged. **J3**: `'contact_id, amount, currency'`, `maybeSingle`, error ignored as before. **K2**: `{stripe_hosted_invoice_url, stripe_invoice_pdf, updated_at}`. **J4**: see CR-P2-1. `new Date().toISOString()` runs the same number of times, at the same point (after `.from()`, while the payload is built) | ✅ (J4 has one finding) |
| 1f | Data reaching the route | `findLanguage` turns a non-string `language` into null. The column is `TEXT` (`20260721_create_business_profiles.sql:36`), so `ownerLanguage \|\| 'en'` gives the same result as `ownerProfile?.language \|\| 'en'`. PR2-D2 (`contact_id: string \| null`) is a type-only change | ✅ |
| 1g | Extra `await` hops | Each repository call adds a microtask or two before the same query. The fire-and-forget work (receipt IIFE, CRM activity) talks to the network, so its order relative to this work was never fixed. The harness, which records order, is identical | ✅ no change |
| 1h | `.from(` count | `route.ts`: 48 → **33**. No `from(` on `payment_invoices` or `business_profiles` remains | ✅ |
| 2 | **F-1 by hand (control flow, not position)** | **H3** (`:1331`): it sits inside `if (invoiceByMetadata && !metadataLookupError)`, after `if (!(await accountOwns(…, invoiceByMetadata.user_id …))) { …; return; }` (`:1322`) in the same block. **H6** (`:1533`) and **H8** (`:1648`): every path to them passes `:1337` (`platformInvoice && !owns → return`) and `:1354` (`!platformInvoice → return`). No other `accountOwns`, and no earlier invoice write, sits between those and `:1533`. **I3** (`:1841`): it sits in the same `if (invoiceId)` block as `:1773` (`!owns → return`), after the `lookupError \|\| !platformInvoice → return`. **J2/J3/J4** (`:2001`, `:2015`, `:2023`): at function top level, after `:1992`. **K2** (`:2084`): after `:2075`. **L2** (`:2129`): after `:2120`. In every case the check is an unconditional early return that dominates the write | ✅ |
| 3 | Q-3 / C-3 controls | The C-3 section header is verbatim, once. `⟨unscoped-by-design⟩` appears on all seven new method docs and on `findByStripeInvoiceId`. The column constants are literal-typed and the parameters are closed unions (`WebhookInvoiceByStripeIdColumns`, `WebhookInvoiceFieldColumns`, `WebhookInvoiceStatusFromStripe`). Each update is a named transition with a fixed patch: no spread and no generic update. No insert, so no typed row is needed. Every method has a no-`user_id` test | ✅ |
| 3t | Tenant isolation (`tenant-isolation-guard`): the proof named in each doc exists at each call site | `findByStripeInvoiceId` (H1, J1, K1, L1): keyed by the event's Stripe invoice id, owner checked before any write (row 2). `findByIdUnscoped` (H2, I1): the doc says "not trusted, every caller checks `accountOwns` before anything is written"; true at `:1322`/`:1337` and `:1773`. `recordStripeInvoiceId`: `:1322`. `markPaidFromStripeInvoice`: `:1337`. `markPaidFromCheckout`: `:1773`. `setStatusFromStripe`: `:1992` / `:2120`. `recordStripeDocuments`: `:2075`. `readFieldsUnscoped`: H8 after `:1337`, J3 after `:1992`. Payloads: no caller-controlled key; the values come from the signed event or from `paidAt`. Scope-defeating three: no upsert, no injected field. The `payment_invoices` triggers (`update_invoice_on_payment`) were not touched and fire as before | ✅ |
| 4 | C-5 | `findByStripeInvoiceId`: on `PGRST116` it returns the same error object and logs nothing; on any other error it logs `error` through the file's `createLogger({ service: 'PaymentRepository' })` with `{ err, stripeInvoiceId }`. The unit tests cover the quiet miss, the logged other error (level, service, args), a hit logging nothing, and identity (`toBe`) | ✅ |
| 5 | C-2 guards | See below | ✅ stricter |
| 6 | PR2-D1 | See the rulings | ✅ |
| 7 | PR2-Q1 | See CR-P2-1 | 🔄 |
| 8 | CR-P1-1 and `REPOSITORY_STRATEGY.md` | "They do not catch … They log only where SA ruled it … The one ruling so far: `findByStripeInvoiceId` …" is accurate for the code as submitted. The new section paragraph matches the methods, and its "14 `payment_invoices` queries + the `business_profiles` read" adds up to the 15 sites. **But** its last sentence ("`findLanguage` … keeps its own try/catch") goes stale under CR-P2-1 and must change with it | ✅ now, update with CR-P2-1 |
| 9 | Rules 1, 3, 4, 6; console; entitlements | **Rule 1**: 15 sites leave the route. **Rule 3**: 0 `console.` in all five `.ts` files; the only new log line is the C-5 one, through Pino. **Rule 4**: the exception is documented in the section comment, in each method doc and in the strategy doc. **Rule 6**: no `any` added (the test uses `as unknown as` only). **Entitlements**: no import from `lib/business-os/entitlements/` in the diff; `businessOsEntitlements.imports.guard` passes. **Scoped `tsc`** (SA's own scratch tsconfig over the five changed `.ts` files, 8 GB): **0 errors in those files**, so the two `@ts-expect-error` lines are consumed (an unused one would raise TS2578). There are 58 errors in transitively imported files, the same count Dev reports for the base. **ESLint**: 0 errors; the 10 warnings are all on lines this PR does not touch | ✅ |
| 10 | Runs (`--ci --runTestsByPath`, no `-u`) | Every `app/api/stripe/webhook/__tests__/*.test.ts`, every `lib/payments/__tests__/*.test.ts`, the new repository test, `noBookingGuess.guard`, `invoiceIntentsStayUnowned.guard`, `stripeAuditEntries`, `noPilotCreditTableReads.guard`, `bookingPaymentStatusReaders.guard`, `businessOsEntitlements.imports.guard`, `mutationOrSelect.guard`, `userSubscriptionsWriteLockdown.qa` + `…Migration`, `BusinessProfileRepository.languageCurrency` + `.searchForAdmin`, `PaymentRepository.getOverdueInvoices`, `inviterNotification`, `redemptionDeps` and `check-logging-only-diff`: **66 suites, 1,127 tests, 100 snapshots, all passed**. Snapshot blob after the run: `ae7b32c4…` | ✅ |

#### C-2: every old guard assertion still bites

| Old assertion | Where it bites now |
|---|---|
| `noBookingGuess`: no `matchingBooking` in the route | Unchanged (the diff only adds lines) |
| `noBookingGuess:66`: the handler does not match `from('payment_invoices')…booking_id:` | **Kept verbatim**, plus two new arms. (b) No inline `payment_invoices` query in any quote style. The class is never named. Every mention of `paymentInvoiceRepository` is a direct call (so an alias fails, M3), and every call is to one of five allow-listed methods (so the generic, user-scoped `update` fails, M2). (c) Which called methods write is read from the repository's AST with comments stripped, not from their names. The writers must be exactly `recordStripeInvoiceId` and `markPaidFromStripeInvoice`, and neither may contain `booking_id` (M1). A `this.update(…)` helper call would also match `.update(` and so be counted as a writer |
| `noBookingGuess`: `servicePrice` / `scheduling_services(price)` on the handler | Unchanged, and now also applied to the code of every repository method the handler calls |
| `routerPlacement`: claim table checks | Unaffected (no `processed_webhook_events` line moved) |
| (new) every site converted | No `from(` on either table in any quote style, and neither class name appears as an identifier. Exact per-handler call counts, and the route-wide total equals their sum (so no stray call elsewhere). `findLanguage` is the only `businessProfileRepository` call, and it sits inside `handleConnectInvoicePaymentFailed` |
| (new) F-1 ordering | The nearest preceding `accountOwns` before each of the five write calls must test `platformInvoice.user_id` or `invoiceByMetadata.user_id` |
| `receiptOnPaid`, `invoiceIntentsStayUnowned`, `emptyBody`, `pinoLogging`, `deferredFirstPayment`, `planSurfaces` | No text they read moved; all green on SA's run |

**M1–M7 are plausible.** Each targets one arm, and the red counts are what that arm and the harness would give. M4 (H3 above its check) turns 5 tests red, as expected. The harness records the extra update in Fix-1's three refusal scenarios (F1-1, F1-2, 1b), and the two route guards see the order and the count. M7 (`maybeSingle` → `single`) reaching seven harness entries fits the harness recording the terminal.

#### Rulings on PR2-D1 to D4, PR2-Q1 and PR2-Q2

| # | Ruling |
|---|---|
| **PR2-D1** (no try/catch in `findByStripeInvoiceId`) | **Accepted. Behaviour-preserving, and required.** Inline, a rejected H1/J1/K1/L1 query threw out of the handler to `POST`'s outer catch, which answered 500 and released the claim, so Stripe retried. With the old catch it would have become `{ data: null, error }`, so H1 would fall through to the metadata lookup and J/K/L would return 200 quietly. Without the catch, the old behaviour is back (`claimRepository.qa` and the new unit test pin it). **No other caller depends on the catch.** SA grepped the whole repo (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.sql`) both at `933d661c` and in the working tree. At the base, the method's only occurrences are its definition and a comment at `:1341`. Now the only callers are the four route sites, and no `jest.mock` stubs it. Same reasoning as PR1-D1 |
| **PR2-D2** `contact_id: string \| null` | **Accepted.** Type-only change; scoped `tsc` is clean |
| **PR2-D3** one lookup constant | **Accepted.** Fix-1 made the three selects identical, so this is collapsing literals, as Q-3 asked |
| **PR2-D4** `findByStripeInvoiceId` keeps `PaymentRepositoryResult` | **Accepted.** The object is the same, the route reads only truthiness, and `tsc` accepts the `PostgrestError` → `Error` assignment |
| **PR2-Q1** | **(c). See CR-P2-1.** (a) is rejected because it is a behaviour change: a thrown J4 read would answer 200 instead of 500, so Stripe would not retry, and the overdue activity would be written in English. The user's rule for CF-5 is none. (b) is rejected because it would mean two methods for the same query, which is the bloat Q-3 rules out |
| **PR2-Q2** (positional F-1 guard) | **Accepted as a guard.** SA checked dominance by hand (row 2), so the code as submitted is right. The behavioural proof is still the harness's Fix-1 refusal entries, which would go red on any reordering that lets a write run. The guard's blind spot (a check moved into a branch that does not dominate the write) is recorded here, so no one reads the guard as a flow analysis |

#### Code Review Comments

1. **CR-P2-1** `lib/repositories/BusinessProfileRepository.ts:1307` `findLanguage`, used by `route.ts:2023` (J4). This is a behaviour change on a thrown read: the method's `try/catch` turns a rejected `business_profiles` query into `{ data: null, error }`, so the webhook answers 200 with English where the inline query answered 500 and Stripe retried. **Fix (option c, minimal):** drop the `try/catch` and keep the returned-error path as it is:
   - `const { data, error } = await this.supabase.from('business_profiles').select('language').eq('user_id', userId).maybeSingle();`
   - `if (error) { logger.error({ err: error, userId }, 'Failed to read business language'); return { data: null, error }; }`
   - then the existing string check.
   With that, a returned error behaves exactly as today for both callers (logged, `data: null`), and a rejection reaches the caller again.

   **The invite caller is safe.** SA checked it. `redemptionDeps.ts:102` → `inviterNotification.ts:180` wraps the call in `settle(() => deps.findProfileLanguage(id), LOOKUP_FAILED)` (`:133–139`), which catches a rejection and returns `{ data: null, error }`. `:190` then treats any `.error` as "absent". So on a thrown read the invite still sends with the same fallback language as today. The only difference there is that the repository's own "Failed to read business language" line is no longer written on a *thrown* read. That is log-only and on a path supabase-js practically never takes. If Dev wants to keep that line, `catch (err) { logger.error(…); throw err; }` around the query is also acceptable, as long as the returned-error branch still returns and does not throw.

   **With the fix:**
   - Add a unit test in `BusinessProfileRepository.languageCurrency.test.ts`: a rejected query rejects. The existing three tests must stay green unedited.
   - Update `REPOSITORY_STRATEGY.md`'s "Errors passed through" sentence on `findLanguage` (it no longer "keeps its own try/catch"), plus §7.3.3's "Errors and logging" paragraph and the PR2-Q1 row.
   - SA re-check needs only: `languageCurrency`, `inviterNotification`, `redemptionDeps`, the webhook `__tests__` dir (snapshot blob still `ae7b32c4`), and a read of the method and the doc sentence.

   — Priority: **High** (blocking: it breaks the "no behaviour change" contract), effort small
2. **CR-P2-2** `noBookingGuess.guard.test.ts` arm (c) classifies a method as a writer by `.update|insert|upsert|delete(` in its own body. A write delegated to a module-level helper outside the class would not be seen. Nothing does that today, and the C-3 source test forbids such shapes inside the section. **Optional; no action needed.** — Priority: Low

#### Optimisation Suggestions

- `WebhookInvoiceResult`'s doc says "used by the webhook methods, which neither catch nor log". `findByStripeInvoiceId` is in the same family but returns `PaymentRepositoryResult` and logs (C-5, PR2-D4). Adding a half-sentence would save the next reader a double take. Style only.

#### Code Approved for QA: No, not until CR-P2-1 is in

Everything except CR-P2-1 is approved, and SA does not need a fresh review. Once CR-P2-1 is done, SA runs the re-check listed under it and then marks the PR approved for QA.

#### CR-P2-1 re-check (SA, 2026-10-08)

**Status:** ✅ Code Approved (APPROVED_CODE_REVIEW). CR-P2-1 is met.

| Check | SA's evidence | Verdict |
|---|---|---|
| `findLanguage` | `git diff 933d661c`. The try/catch is gone. The chain `select('language')·eq('user_id')·maybeSingle` is unchanged. A returned error still logs `{ err, userId }`, 'Failed to read business language', and returns `{ data: null, error }`. The string check is unchanged. A rejection now reaches the caller. The doc names both callers and the `settle()` wrapper | ✅ |
| Invite caller | `inviterNotification.ts:180` `settle()` still catches. `inviterNotification` and `redemptionDeps` pass, and neither file is edited | ✅ |
| Tests | One new test in `languageCurrency` ("a rejected query rejects": `maybeSingle` rejects, and so does `findLanguage`). The three existing tests are unchanged in the diff and green | ✅ |
| Docs | The REPOSITORY_STRATEGY "Errors passed through" sentence now says `findLanguage` logs a returned error, does not catch, and its invite caller's `settle()` does. §7.3.3's "Errors and logging" paragraph and the PR2-Q1 row record the (c) ruling. The `WebhookInvoiceResult` half-sentence was added (the optional item). CR-P2-2 was not taken, which is accepted | ✅ |
| Runs (`--ci --runTestsByPath`, no `-u`) | All 11 suites in the webhook `__tests__` dir, plus `languageCurrency`, `inviterNotification`, `redemptionDeps`, `PaymentInvoiceRepository.webhook` and `noBookingGuess.guard`: **15 suites, 378 tests, 100 snapshots passed**. Snapshot blob `ae7b32c4…` before and after | ✅ |
| Scoped `tsc` | SA's scratch tsconfig, with `BusinessProfileRepository.ts` and its test added: **0 errors in the changed files**, and 58 elsewhere, the same as before | ✅ |

#### Code Approved for QA (after the CR-P2-1 re-check): Yes

---

## QA Testing Report

### PR 0: Harness, close the coverage gaps

**QA — 2026-10-07**
**Test mode:** full
**Strategy used:** A (Jest) plus mutation testing. PR 0 is tests only, so the main test is whether the harness catches real changes to `route.ts`. Mutants were temporary copies of `route.ts` (and of `bindPlanSubscription.ts`), loaded through a scratch Jest config whose `moduleNameMapper` sent `../route` (or `../bindPlanSubscription`) to the copy. The real harness, snapshot and test files were used unedited.
**Focus:** pipeline of PRs 1 to 5 (api, schema of the recorded chains, security for the tenant filters)
**Skipped:** e2e (no UI). `npm run test:bos-entitlements` not needed: the diff imports nothing from `lib/business-os/entitlements/`.
**Input source:** prompt from TL, plus workplan §7.3.1, the PR 0 code review and the CR-1 re-check.

**Tree:** worktree `neuronforge-webhook-repos`, branch `feature/webhook-repos-pr0-harness`, `HEAD` = `origin/main` = `0c3c1800`, uncommitted, Node 22.19.0. Every Jest run used `--ci --runTestsByPath`. None used `-u`.

#### Invariants (checked before, during and after)

| Check | Result |
|---|---|
| Snapshot blob | `a673a901…` before, after every mutant run (the runner checked it each time and would have stopped) and at the end ✅ |
| `route.ts` blob | `df671c4a…`, never edited ✅ |
| Harness / `fix1Ownership.qa` / `bindPlanSubscription.test.ts` blobs | `a7cc9992…` / `f509e75e…` / `e87c78f2…`, as recorded in §7.3.1 ✅ |
| `bindPlanSubscription.ts` blob | `23a38fdd…` = `HEAD` ✅ |
| Production files in the diff | none: three test files, one new fixture, two docs ✅ |
| Coverage of `route.ts` by the harness (QA's own run) | statements 91.49 % (527/576), branches 75.6 % (561/742), functions 86.66 %, lines 92.21 %. **51 of 51 `.from(` sites executed.** Matches Dev and SA ✅ |

#### Test coverage

| Acceptance criterion (PR 0, §9 / §7.3.1) | Tested? | Result | Notes |
|---|---|---|---|
| Tests only; `route.ts` unchanged | ✅ | Pass | Blob `df671c4a` |
| 45 old entries byte-identical, 55 new | ✅ | Pass | The 47 old tests pass against the new snapshot file. SA's entry-by-entry comparison was not re-run |
| Every `.from(` site executed | ✅ | Pass | 51/51 |
| The harness catches behaviour changes in PR 1–5 sites | ✅ | Pass | 35/35 behaviour mutants killed (below) |
| The harness is not pinned to the text | ✅ | Pass | 4/4 behaviour-preserving refactors green, plus a PR 4 simulation |
| CR-1 bind error arms pinned | ✅ | Pass | 5/5 error-arm mutants killed. **Note:** 3 bind chain filters are not pinned (Edge case 1) |
| Not flaky | ✅ | Pass | 5 of 5 runs: 102/102 tests and 100/100 snapshots each time, blob unchanged |
| C-7 time | ✅ | Pass | About +0.85 s per run (below) |
| Regression | ✅ | Pass | 56 suites, 937 tests, 100 snapshots |

#### Mutation results: `route.ts` (harness)

"New" is the PR 0 harness. "Base" is the `0c3c1800` harness and snapshot, copied temporarily to show which kills come from PR 0's new entries.

| # | PR | Mutation | New: red tests | Base: red |
|---|---|---|---|---|
| M01 | 1 | Claim insert `23505` check changed | 1 (X10) | 0 |
| M02 | 1 | Claim lookup `.maybeSingle()` → `.single()` | 100 | 45 |
| M03 | 1 | Claim insert, any other error: returns 500 instead of continuing | 2 (X12, X53) | 0 |
| M04 | 1 | `completeClaim` drops `completed_at` | 87 | 40 |
| N01 | 1 | Retry of a failed claim drops `failure_message: null` | 1 (9c) | 1 |
| N02 | 1 | Release writes `'error'` instead of `'failed'` | 9 | 3 |
| N03 | 1 | Claim lookup error treated as a duplicate | 1 (X13) | 0 |
| M05 | 2 | J1 select column list changed | 7 | 2 |
| M06 | 2 | J4 drops `.eq('user_id')` on `business_profiles` | 2 | 1 |
| M07 | 2 | J4 language fallback `'en'` → `'he'` | 1 (X52) | 0 |
| M08 | 2 | I3 error swallowed (no throw, so 200) | 1 (X16) | 0 |
| M09 | 2 | H1 `.single()` → `.maybeSingle()` | 11 | 6 |
| N04 | 2 | H8 receipt read column list changed | 3 | 2 |
| N05 | 2 | K2 update drops `stripe_invoice_pdf` | 5 | 2 |
| M10 | 3 | Refund upsert `onConflict` changed | 3 | 1 |
| M11 | 3 | E1 charge-id arm filters another column | 1 (X4) | 0 |
| M12 | 3 | F1 drops `.limit(1)` | 10 | 8 |
| M13 | 3 | H5 insert error swallowed | 1 (X32) | 0 |
| N06 | 3 | D2 `status_before_dispute` always overwritten | 1 (X5) | 0 |
| N07 | 3 | G2 throws a wrapped error, not the raw one | 1 (X30) | 0 |
| M14 | 4 | M2 drops the plan `completed_at` write | 1 (X6) | 0 |
| M15 | 4 | G5 booking update drops `.eq('user_id')` | 2 | 1 |
| M16 | 4 | G5 booking error thrown (was logged, 200) | 1 (X34) | 0 |
| M17 | 4 | M1 `.maybeSingle()` → `.single()` | 5 | 1 |
| M18 | 4 | I5 drops `.eq('user_id', owner)` | 4 | 3 |
| N08 | 4 | I4 drops `.eq('status', 'pending')` | 2 | 1 |
| N09 | 4 | G3 drops the `installment_number` filter | 3 | 1 |
| N10 | 4 | M3 settles only `pending` | 1 | 1 |
| M19 | 5 | Legacy grace default 3 → 7 | 1 (X55) | 0 |
| M20 | 5 | A1 `.single()` → `.maybeSingle()` | 3 (X2, X3, X55) | 0 |
| M21 | 5 | B5 `transaction_id` no longer carries the credit transaction id | 1 (X54) | 0 |
| M22 | 5 | B4 error thrown (was logged) | 1 (X45) | 0 |
| M23 | 5 | N1 drops `cancel_at_period_end` | 1 (X1) | 0 |
| N11 | 5 | A2 config key renamed | 2 | 0 |
| N12 | 5 | B2 select column list changed | 4 | 1 |

**35 of 35 behaviour mutants killed**: every PR group 1–5, each by at least one snapshot entry, under `--ci`. The pre-PR 0 harness lets **16 of the 35 survive**: M01, M03, N03, M07, M08, M11, M13, N06, N07, M14, M16, M19–M23 and N11. So PR 0 closes real holes in every PR group.

**Survivors (all expected, none a PR 0 gap):**

| # | PR | Mutation | Why it survives |
|---|---|---|---|
| L01 | 2 | Remove the I3 `log.error` (the throw is kept) | Logging is excluded from the snapshot on purpose (SA P0-C1) |
| L02 | 4 | Remove the G5 `log.error`, so the booking error is swallowed silently | Same. Note for PRs 2–4: a repository that stops logging a discarded write error (FU-9, Q-4) is invisible to the harness. Only review and `check-logging-only-diff` (§7.4) can see it |
| E01 | 2 | K2 error arm: `return` removed | Equivalent: only a `log.info` follows the arm, so the behaviour does not change |

(E02, the D2 error arm with its `return` removed, was killed by X28: the dispute alert then fires.)

#### Behaviour-preserving refactors (must stay green)

| # | PR | Refactor | Result |
|---|---|---|---|
| R1 | 1 | Claim lookup and `completeClaim` moved behind a local repository-shaped object (identical chains, patch built in a variable with its keys reordered) | 102/102, 100/100 ✅ |
| R2 | 4 | M1 read and M2 write moved into local helpers; the M2 patch built key by key in another order | 102/102 ✅ |
| R3 | 3 | Refund upsert through a wrapper that passes `onConflict` from a local constant | 102/102 ✅ |
| R4 | 5 | A1 and A2 into arrow helpers (one-line chains); the grace fallback rewritten as `!configData ? DEFAULT_GRACE : …` | 102/102 ✅ |
| PR4-sim | 4 | **The O-2 contract, end to end:** a temporary copy of `PaymentPlanSubscriptionRepository` with `findEndStateBySubscriptionId` and `endFromStripe` (same chains), and a route copy calling them. Run through the harness **and** `fix1Ownership.qa` | Faithful: 149/149, 100/100 ✅. With one column dropped from the repository's select: 5 red, so the delegation really routes through `mockSupabase` |

#### Mutation results: `bindPlanSubscription.ts` (CR-1 tests, `bindPlanSubscription.test.ts`)

| # | Mutation | Result |
|---|---|---|
| B1 | `:431` insert error thrown | killed (CR-1 test 1) |
| B2 | `:431` insert error returns before the booking link | killed (CR-1 test 1) |
| B3 | `:454` link error thrown | killed (CR-1 test 2) |
| B4 | `:483` contact read error thrown | killed (CR-1 test 3) |
| B5 | Link update drops `.eq('user_id', ownerId)` | killed (CR-1 test 1) |
| B9 | `resolvePlanRowId` drops `.eq('user_id', ownerId)` | killed (Fix-1b B-3) |
| **B6** | **`resolveContactId` drops `.eq('user_id', ownerId)`** | **survives** |
| **B8** | **Installment count drops `.eq('subscription_id', …)`** | **survives** |
| **B10** | **`resolvePlanRowId` drops `.eq('is_active', true)`** | **survives** |
| B11 | `resolveContactId` selects `'id, contact_id'` | survives (benign under the mock; same gap as B6) |
| B7 | Contact read error: falls through to `data?.contact_id ?? null` | survives, equivalent (data is null on error) |

### Issues found

#### Bugs (must fix before commit)

None.

#### Performance issues

None. **C-7 timing**, interleaved runs of a temporary copy of the `0c3c1800` harness and snapshot against the new harness, on the same machine. Pairs 1–3 were noisy (the base took up to 6.1 s) and are left out:

| Pair | Base (47 tests) Jest / wall | New (102 tests) Jest / wall |
|---|---|---|
| 4 | 2.92 s / 7.44 s | 4.00 s / 9.62 s |
| 5 | 2.90 s / 7.28 s | 3.74 s / 7.96 s |
| 6 | 3.02 s / 7.25 s | 3.80 s / 8.11 s |
| **Median** | **2.92 s / 7.28 s** | **3.80 s / 8.11 s** |

So about **+0.9 s Jest time and +0.8 s wall time**, which agrees with Dev's +0.9 s. The temporary copies were deleted.

#### Edge cases (recommended; a gap for PR 4, not a PR 0 defect)

1. **Three of bind's query chains are not pinned by any test, and PR 4 moves all three** (`lib/payments/__tests__/bindPlanSubscription.test.ts`). Severity: Medium (B6 is a tenant filter). PR affected: **PR 4**.
   - Steps to reproduce: in a copy of `bindPlanSubscription.ts`, drop `.eq('user_id', ownerId)` from `resolveContactId` (`:479`). Or drop `.eq('subscription_id', …)` from the installment count (`:146`), or `.eq('is_active', true)` from `resolvePlanRowId` (`:513`). Run the bind tests.
   - Expected: at least one test goes red, because these are PR 4 sites whose "before" should live on `main`, like the harness.
   - Actual: all 31 pass. The bind mock answers by table, and no test asserts these chains. Only `mockQueries` (ownership reads) and CR-1's `mockUpdates` are checked.
   - Why it matters: if PR 4 writes a repository method that is missing one of these filters, and that method's own new unit test (§7.5) pins the same wrong chain, nothing on `main` catches it. B6 would make the contact read unscoped: a booking id from another business would leak its `contact_id` into this owner's periods. Today Fix-1b's vetting of `bookingId` (`vetLinkId`, before this read) hides the hole. The read's own filter is the second line of defence, and no test holds it in place.
   - Suggested fix (Dev, SA to rule): extend SA's optional CR-1 note. Add one test asserting the full chains of the three reads: count `eq('subscription_id')`; contact `select('contact_id')`, `eq('id')`, `eq('user_id')`; plan fallback `eq('user_id')`, `eq('service_id')`, `eq('is_active', true)`, order and limit. Then re-record the test file's blob in §7.3.1. Doing it in PR 0 keeps that file frozen afterwards. If it waits, PR 4 must add it as its first commit, against the untouched bind.
2. **Logging is invisible to the harness** (L01, L02). This is by design (P0-C1) and listed only so PRs 2–4 reviewers know the harness cannot prove that a repository keeps logging a discarded write error. §7.4 and code review cover it.

### Test outputs / logs

```text
Flakiness (5 runs, --ci): each 102 passed / 100 snapshots passed; blob a673a901 after each
Mutation runner, route.ts: S0 sanity (identical copy) 102/102; 35 behaviour mutants all red; L01, L02, E01 green (expected)
Base-harness comparison: S0 47/47; 16 of 35 behaviour mutants green on the 0c3c1800 harness
PR4-sim faithful: Test Suites 2 passed; Tests 149 passed; Snapshots 100 passed
PR4-sim wrong select: Tests 5 failed, 144 passed; Snapshots 5 failed
Regression (--ci --runTestsByPath):
  webhook __tests__ (9 files):       9 suites, 251 tests, 100 snapshots, all passed
  lib/payments __tests__ (40 files): 40 suites, 636 tests, all passed
  guards (noBookingGuess, stripeAuditEntries, userSubscriptionsWriteLockdown.qa,
          userSubscriptionsWriteLockdownMigration, bookingPaymentStatusReaders,
          noPilotCreditTableReads, mutationOrSelect): 7 suites, 50 tests, all passed
  Total 56 suites, 937 tests, 100 snapshots (Dev's 55-file set + mutationOrSelect.guard)
After everything: snapshot a673a901, route.ts df671c4a, every temporary file deleted
```

### Final status

**Verdict: PASS WITH NOTES.**

- [x] All acceptance criteria pass. The harness kills every behaviour mutant in PR groups 1–5 and stays green under refactors that keep behaviour, so it is fit to prove PRs 1 to 5.
- [ ] Note for SA/Dev before commit (not blocking): Edge case 1, the three bind query chains PR 4 moves. Recommended in PR 0, so that the frozen test file is the "before". Otherwise it becomes PR 4's first commit.

### PR 1: Claim table and client

**QA — 2026-10-07**
**Test mode:** full
**Strategy used:** A (Jest), plus a direct old-vs-new equivalence run and mutation testing. PR 1 must not change behaviour, so the main test runs the same scenarios through the `90da8301` route and the new route and compares the traces. Mutants were temporary copies of the repository or `route.ts`. A scratch Jest config pointed `@/lib/repositories/ProcessedWebhookEventRepository` or `../route` at the copy. Copies of the guard, the repository unit test and the QA test read the copy through an env path. The real harness and snapshot were used unedited.
**Focus:** api (the claim path), security (the service-role client), schema (each method's query chain)
**Skipped:** e2e (no UI). `npm run test:bos-entitlements` is not needed: the diff imports nothing from `lib/business-os/entitlements/`. The import guard ran anyway (below).
**Input source:** prompt from TL, plus §7.3.2 (including "after the SA code review") and the PR 1 code review.

**Tree:** worktree `neuronforge-webhook-repos`, branch `feature/webhook-repos-pr1-claim-client`, base `90da8301`, uncommitted, Node 22.19.0. Every Jest run used `--ci --runTestsByPath`. None used `-u`.

#### Invariants (checked before, during and after)

| Check | Result |
|---|---|
| Snapshot blob | `a673a901…` before, after every mutant (the runner checked it each time and would have stopped) and at the end ✅ |
| Dev's files, never edited by QA | `route.ts` `e82720b2`, repository `4c8b3351`, its test `1ee78dfb`, guard `d1432ba4`, `index.ts` `1ff1e48c`, harness `a7cc9992`. All the same at the start and the end ✅ |
| Old route used for the comparison | `git show 90da8301:app/api/stripe/webhook/route.ts` into a temp folder: blob `df671c4a` = the base ✅ |
| Temp files | the temp folder (old route, equivalence test, mutants, test copies, scratch config) deleted. Only `claimRepository.qa.test.ts` is new ✅ |

#### Test coverage

| Acceptance criterion (PR 1, §7.3.2) | Tested? | Result | Notes |
|---|---|---|---|
| 1. Same behaviour on the claim path, old vs new | ✅ | Pass | **17 of 17 scenarios identical.** Status, body, every DB op with its payload, and every log line (level, bindings, arguments) compared byte for byte (table below) |
| 2. The route uses `supabaseServer` and builds no client | ✅ | Pass | With `supabaseServer` mocked, all queries reach it and `createClient` is never called. `route.ts` has no `createClient`, no `@supabase/supabase-js` value import and no Supabase env read |
| 3. Repository unit tests; each chain = the old inline chain | ✅ | Pass | 18 tests, including the no-owner-filter test on all five methods. The chains match the `-` lines of the diff. The old-vs-new traces confirm it at the route |
| 4. Mutants caught | ✅ | Pass | **29 of 29 killed** (below). Without the new QA file, 7 would survive |
| 5. Regression | ✅ | Pass | 119 suites, 2,387 tests, 100 snapshots, plus 8 guard suites (74 tests) |
| Scoped type-check and lint of the QA file | ✅ | Pass | `tsc` (scratch tsconfig, the QA file only): 0 errors. ESLint: exit 0 |

#### 1. Equivalence, old route vs new

Both routes ran in the same Jest process, under the same mocks and a fixed clock, with a fresh module per run. Random correlation ids were renamed in order of appearance (`<UUID#1>`). Error objects were written out with their name, message and own fields. "Module load" (the `createClient` calls made at import) is compared on its own in §2.

| # | Scenario | Status | Trace old = new |
|---|---|---|---|
| E1 | First delivery, platform event with no handler | 200 | ✅ (select → insert → complete) |
| E2 | First delivery, Connect `invoice.finalized` | 200 | ✅ |
| E3 | Duplicate in flight (`processing`) | 200 duplicate | ✅ |
| E4 | Duplicate completed | 200 duplicate | ✅ (only the select) |
| E5 | `23505` race on insert | 200 duplicate | ✅ |
| E6 | Insert returns another error (DB down): logged, processed anyway | 200 | ✅ |
| E7 | Reclaim of `failed` | 200 | ✅ (select → reclaim → complete) |
| E8 | Reclaim and complete both return errors (ignored, no log, FU-9) | 200 | ✅ |
| E9 | Handler throws a 700-character message → `markFailed`, `failure_message` cut to 500 | 500 | ✅ |
| E10 | Handler throws a string, not an Error | 500 | ✅ |
| E11 | Handler throws with `NODE_ENV=development` (`details` in the body) | 500 | ✅ |
| E12 | Release returns an error (DB down): no "Could not release" line | 500 | ✅ |
| E13 | Release **rejects**: "Could not release failed event" logged with `processedEventId` | 500 | ✅ |
| E14 | Release throws **synchronously** at `.update()` | 500 | ✅ (same log line: old code caught it in the `try`, new code gets a rejected promise from the async method) |
| E15 | `findClaim` returns an error: logged, claimed and processed anyway | 200 | ✅ |
| E16 | `findClaim` **rejects** (thrown read) | 500 | ✅ (no claim written, nothing released: SA's PR1-D1 holds) |
| E17 | `findClaim` throws synchronously at `.select()` | 500 | ✅ |

**Negative control.** The same comparison, run with a route copy whose release swallows a throw (`.catch(() => undefined)`), went red on E13 and E14 only. So the comparison does see a log-only change.

#### 2. Client equivalence

- Module load, measured in the equivalence run: the old route made 2 `createClient` calls (the shared `supabaseServer` and its own, with `auth: { autoRefreshToken: false, persistSession: false }`). The new route makes 1, which is `supabaseServer`. Same URL and key.
- With `@/lib/supabaseServer` mocked to a tagged client, a full delivery runs both the claim (repository) and a remaining direct query (`supabaseAdmin`). Every query is on the tagged client, and `createClient` is not called at all.
- Static, from the AST with comments excluded: no `createClient`, `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` identifier in `route.ts`, and no value import of `@supabase/supabase-js`. The route's only `process.env` reads are the Stripe keys and secrets and `NODE_ENV`.
- The QA test's two client tests fail against the old route (checked through the scratch mapping), so they are not vacuous.

#### 3. Repository

`lib/repositories/__tests__/ProcessedWebhookEventRepository.test.ts`: 18 tests, all pass. Every method has an exact-chain test and a no-owner-filter test, and the error object is passed through by identity. QA checked each chain against the removed lines of the diff:

| Method | Chain | Same as old? |
|---|---|---|
| `findClaim` | `from · select('event_id, status') · eq('event_id') · maybeSingle` | ✅ |
| `insertClaim` | `from · insert(row)`, awaited, no `.select()` | ✅ (the route passes the same object literal) |
| `reclaimFailed` | `from · update({status:'processing', failure_message:null, processed_at}) · eq('event_id')` | ✅ key order too |
| `complete` | `from · update({status:'completed', completed_at}) · eq('event_id')` | ✅ |
| `markFailed` | `from · update({status:'failed', failure_message}) · eq('event_id')`, the route still does `.slice(0, 500)` | ✅ |

#### 4. Mutation results

Columns are red tests per suite. H = harness, G = guard, U = repository unit test, QA = `claimRepository.qa.test.ts`.

| # | Target | Mutation | H | G | U | QA |
|---|---|---|---|---|---|---|
| R01 | repo | `complete`: `'completed'` → `'complete'` | 87 | 1 | 1 | 0 |
| R02 | repo | `findClaim` drops `.eq('event_id')` | 100 | 0 | 1 | 0 |
| R03 | repo | `findClaim` `maybeSingle` → `single` | 100 | 0 | 1 | 0 |
| R04 | repo | `reclaimFailed` drops `failure_message: null` | 1 | 0 | 1 | 0 |
| R05 | repo | `complete` writes `processed_at` instead of `completed_at` | 87 | 0 | 1 | 0 |
| R06 | repo | `complete` writes a `Date`, not an ISO string | 87 | 0 | 1 | 0 |
| R07 | repo | `insertClaim` swallows `23505` (error nulled) | 1 | 0 | 1 | 0 |
| R08 | repo | `insertClaim` adds `.select()` | 97 | 0 | 1 | 0 |
| R09 | repo | `insertClaim` adds `user_id: null` (via `Object.assign`, no spread) | 97 | 0 | 2 | 0 |
| R10 | repo | `markFailed` cuts the message again, to 100 | 0 | 0 | 1 | 1 |
| R11 | repo | `markFailed` writes `'error'` | 9 | 0 | 1 | 1 |
| R12 | repo | `CLAIM_COLUMNS` widened | 100 | 0 | 2 | 0 |
| R13 | repo | `reclaimFailed` adds `.eq('status', 'failed')` | 1 | 0 | 1 | 0 |
| R14 | repo | `complete` adds `.eq('status', 'processing')` | 87 | 0 | 1 | 0 |
| R15 | repo | `findClaim` catches a rejection with `.then(ok, err)` (no `try`, so the source check passes) | 0 | 0 | 0 | **1** |
| R16 | repo | `markFailed` catches a rejection the same way | 0 | 0 | 0 | **1** |
| R17 | repo | `complete` also writes `failure_message: null` | 87 | 0 | 1 | 0 |
| R18 | repo | `complete` does not wait for its update | 87 | 0 | 2 | 2 |
| T01 | route | `23505` → `23503` | 1 | 0 | 0 | 0 |
| T02 | route | release `.slice(0, 500)` → `.slice(0, 499)` | 0 | 0 | 0 | **1** |
| T03 | route | route swallows a thrown release (`.catch` on `markFailed`) | 0 | 0 | 0 | **1** |
| T04 | route | `reclaimFailed` call removed | 1 | 1 | 0 | 0 |
| T05 | route | `findClaim` keyed by the object id, not the event id | 100 | 0 | 0 | 0 |
| T06 | route | claim metadata drops `livemode` | 97 | 0 | 0 | 0 |
| T07 | route | `completeClaim` does not await `complete` | 0 | 0 | 0 | **1** |
| T08 | route | route builds its own service-role client again (the old code) | 0 | 0 | 0 | **2** |
| T09 | route | a `findClaim` error answered as a duplicate | 1 | 0 | 0 | 0 |
| T10 | route | `processing` no longer short-circuited | 1 | 0 | 0 | 0 |
| T11 | route | the release (`markFailed`) not awaited | 0 | 0 | 0 | **2** |
| T12 | route | claim insert not awaited | 72 | 0 | 0 | 1 |

**29 of 29 killed.** Bold = killed by the new QA file only. Without it, **7 survive: R15, R16, T02, T03, T07, T08 and T11. All of them affect PR 1.** They fall into three groups:

- **A catch that silences or reroutes a throw** (R15, R16, T03). The harness answers every query with `{ data, error }` and records no logs, so it cannot see these. The unit test "does not catch a throw" uses a client whose `from()` throws synchronously. A rejection caught by `.then(ok, err)` gets past it, and gets past the source check that bans `try`. R15 is exactly the case SA's PR1-D1 ruling warns about: a thrown claim read would become "process without a claim".
- **A dropped `await`** (T07, T11). The mock answers at once, so the write is recorded either way. For real, a serverless function can stop once it has answered. An un-awaited completion then leaves the row `processing`, and every retry is answered "duplicate". This blind spot exists before PR 1 too.
- **Client and long message** (T08, T02). The client is not part of any recorded effect. The harness's failure messages are all shorter than 500 characters.

#### 5. Regression

| Run | Suites | Tests | Snapshots | Time |
|---|---|---|---|---|
| `app/api/stripe/webhook/__tests__/*.test.ts` (10, including the new QA file), `lib/payments/__tests__/*.test.ts` (40), `lib/repositories/__tests__/*.test.ts` (69: the barrel change, the new repository test and `businessOsEntitlements.imports.guard`) | **119 passed** | **2,387 passed** | 100 passed | Jest 42.1 s, wall 46 s |
| Dev's guard set: `noBookingGuess.guard`, `stripeAuditEntries`, `noPilotCreditTableReads.guard`, `bookingPaymentStatusReaders.guard`, `mutationOrSelect.guard`, `userSubscriptionsWriteLockdown.qa`, `userSubscriptionsWriteLockdownMigration`, `check-logging-only-diff` | 8 passed | 74 passed | — | 28.9 s |
| `claimRepository.qa.test.ts`, 3 runs in a row | 1 | 9/9 each time | — | 3.1–3.2 s each (stable) |

Snapshot blob after all runs: `a673a901…`.

**New file (QA):** `app/api/stripe/webhook/__tests__/claimRepository.qa.test.ts`, 9 tests, no snapshots. It covers what the harness cannot see: the client identity (2 tests), the claim throws (4) and the awaited claim writes (3). It kills R15, R16, T02, T03, T07, T08 and T11. The cost is one suite of about 3 s, which runs in parallel inside the existing Jest shards.

### Issues found (PR 1)

#### Bugs (must fix before commit)

None.

#### Performance issues

None. The route makes one `createClient` call fewer at module load.

#### Edge cases (nice to fix, Low)

1. **The unit test "does not catch a throw" only tries a synchronous throw.** File: `lib/repositories/__tests__/ProcessedWebhookEventRepository.test.ts`. A `.then(ok, err)` on a rejected query (R15, R16) passes it, and passes the `try` ban in the source check. The route-level QA test now catches both. Optional for Dev: add a rejecting-builder case for `findClaim` and `markFailed` in the unit test, so the repository's own suite pins it.
2. **The guard's "complete only via `completeClaim`" check matches the receiver by name.** File: `routerPlacement.guard.test.ts`. An alias (`const r = processedWebhookEventRepository; r.complete(…)`) would pass it. This is the same kind of blind spot the old guard had (SA: "nothing is weaker"). Not a regression; noted for PR 5, when the alias work happens.
3. **Pre-existing, unchanged (FU-5 / FU-9):** a release that returns an error is not logged, and the row stays `processing` (E8, E12). PR 1 keeps this behaviour, as ruled (PR1-Q1).

### Final status (PR 1)

**Verdict: PASS.**

- [x] All acceptance criteria pass. PR 1 preserves behaviour: 17 of 17 claim scenarios give byte-identical traces (status, body, DB ops with payloads, logs), the route uses `supabaseServer` and builds no client, each repository chain equals the old inline chain, and 29 of 29 mutants are killed. Regression: 119 + 8 suites green. Snapshot `a673a901` unchanged.
- [ ] Dev must review the new QA file `claimRepository.qa.test.ts`, which goes into PR 1. Edge cases 1 and 2 are optional.

### PR 2: Connect invoices

**QA — 2026-10-08**
**Test mode:** full
**Strategy used:** A (Jest), plus a direct old-vs-new equivalence run and mutation testing, the same method as PR 1. PR 2 must not change behaviour, so the main test runs the same scenarios through the `933d661c` route and the new route and compares the traces. Mutants were temporary copies of `PaymentRepository.ts`, `BusinessProfileRepository.ts` or `route.ts`. A scratch Jest config pointed `@/lib/repositories/PaymentRepository`, `@/lib/repositories/BusinessProfileRepository` or `../route` at the copy. Copies of the two guards and the two repository unit tests read the copy through an env path. The real harness and snapshot were used unedited.
**Focus:** api (the five Connect invoice handlers), security (F-1 ordering, unscoped methods), schema (each method's query chain)
**Skipped:** e2e (no UI). `npm run test:bos-entitlements` is not needed: the diff imports nothing from `lib/business-os/entitlements/` (the one match in the diff is a doc sentence). `businessOsEntitlements.imports.guard` ran anyway (regression).
**Input source:** prompt from TL, plus §7.3.3, the PR 2 code review and the CR-P2-1 re-check.

**Tree:** worktree `neuronforge-webhook-repos`, branch `feature/webhook-repos-pr2-invoices`, base `933d661c`, uncommitted, Node 22.19.0. Every Jest run used `--ci` and `--runTestsByPath`. None used `-u`.

#### Invariants (checked before, during and after)

| Check | Result |
|---|---|
| Snapshot blob | `ae7b32c4480ad7f7a1d4945763dd00acf81083bc` before, after every mutant (the runner hashed it after each run and would have stopped) and at the end ✅ |
| Dev's files, never edited by QA | `route.ts` `7507a6bd`, `PaymentRepository.ts` `8729ea84`, `BusinessProfileRepository.ts` `dfe05e30`, `PaymentInvoiceRepository.webhook.test.ts` `8fdd4af6`, `languageCurrency` test `c50469fd`, `noBookingGuess.guard` `b73833cb`, `routerPlacement.guard` `112426be`, harness `a7cc9992`. All the same at the start and the end. The runner also re-hashed the three source files after every mutant ✅ |
| Old route used for the comparison | `git show 933d661c:app/api/stripe/webhook/route.ts` into a temp folder: blob `31434a7f` = the base ✅ |
| Temp files | The temp folder (old route, equivalence test, mutants, test copies, scratch config, runner) was at the repo root, outside the `app/` and `lib/` trees that `routerPlacement.guard` scans. It and the scratchpad dumps are deleted. The only new file is `invoiceRepository.qa.test.ts` ✅ |

#### Test coverage

| Acceptance criterion (PR 2, §7.3.3) | Tested? | Result | Notes |
|---|---|---|---|
| 1. Same behaviour in the five converted handlers, old vs new | ✅ | Pass | **79 scenarios. 74 are byte-identical.** 4 differ only by the accepted repository log line (P0-C1 / Q-5). 1 differs on an input supabase-js cannot produce (Edge case 1). The comparison covers status, body, every DB op with its payload and terminal, every log line (level, bindings, arguments) and every side call, all in order (table below) |
| 1a. A rejected `findByStripeInvoiceId` or `findLanguage` → 500 and claim `failed`, as the old code did | ✅ | Pass | H-23, J-15, K-06, L-05 (`findByStripeInvoiceId`) and J-08, J-09 (`findLanguage`, rejected and thrown synchronously) are identical to the old route: 500, generic body, claim released `failed`. Pinned in the new QA file at all 14 delivery-failing sites |
| 2. Tenant isolation: each unscoped method is reached only after its owner check | ✅ | Pass | 11 foreign or unmapped scenarios across all five handlers write nothing but the claim, and send no receipt and no activity. The new QA file pins one per handler, plus the metadata path before `recordStripeInvoiceId` |
| 3. Mutants caught | ✅ | Pass | **38 of 39 killed. The 1 survivor is an equivalent mutant** (T14, below). Without the new QA file, 3 more survive: T07, T08 and T17, a catch added at a call site |
| 4. Regression | ✅ | Pass | 129 suites, 2,569 tests, 100 snapshots, all passed. Jest 99.4 s, wall 124 s |
| Scoped type-check and lint of the QA file | ✅ | Pass | `tsc` (scratch tsconfig, the QA file only, 8 GB): exit 0, 0 errors. ESLint: 0 errors, 0 warnings |

#### 1. Equivalence, old route vs new

Both routes ran in the same Jest process, under the same mocks, with a fresh module per run. `Date` was frozen at `2026-10-08T09:00:00.000Z`, with only `Date` faked so the timers stayed real. The correlation id was fixed through `x-correlation-id`. The trace recorded:

- every query (table, operation, the full chain with payload, and the terminal: `single`, `maybeSingle` or `await`);
- every log line, with the logger's merged bindings (`module`/`service`, correlation id, event id, account);
- `resolveAccountOwner`, `resolveInvoicePaymentIntent`, `resolveProcessorFee`, `auditLog`, `crmActivityRepository.create` (with the localised title) and `BookingEmailService.sendPaymentReceipt`.

Fire-and-forget work was allowed to settle before the trace was read. Errors were written out with their name, message and own fields, and `undefined` was kept visible, so a missing key and an `undefined` value do not compare equal.

| Group | Scenarios | Result |
|---|---|---|
| **H `invoice.paid`** (32) | By Stripe id, with and without booking (H-01, H-02); hosted URL and PDF `undefined` or `null` (H-03, H-04); by metadata under both keys (H-05, H-06); not found three ways (H-07 to H-09); **F-1**: foreign by Stripe id, foreign by metadata, unmapped account, owner `null` (H-10 to H-13); write errors on the invoice and on the transaction (H-14, H-15); already paid (H-16); #257 attach-by-intent (H-17); **receipt read with #257's `id`**: no e-mail, returned error, rejected, not sent, null currency and name (H-18 to H-22); **rejections**: H1 rejected or thrown synchronously, H2 rejected, H3 rejected, H6 rejected or thrown synchronously (H-23, H-24, H-26, H-28, H-30, H-31); H2 error with data (H-27); H3 returned error ignored (H-29) | 30 identical. H-25 log-only. H-32 unreachable input |
| **I checkout** (12) | Paid with a pending booking confirmed, paid with no booking and a null currency, already paid, foreign, foreign and already paid, not found, other lookup error, I1 rejected, I3 error, I3 rejected, transaction insert error, unmapped account | 12 identical |
| **J `invoice.payment_failed`** (20) | Overdue + activity in **he / en / no profile / es / null / empty / non-string** language; `findLanguage` returned error (J-07) and **rejected** (J-08) and thrown synchronously (J-09); no contact; activity read error and rejected; not found; other lookup error; J1 rejected; foreign; overdue update error and rejected; empty invoice number | 18 identical. J-07 and J-14 log-only |
| **K `invoice.finalized`** (8) | URLs recorded, URLs `undefined`, not found, foreign, update error, K1 rejected, K2 rejected, other lookup error | 7 identical. K-08 log-only |
| **L `invoice.marked_uncollectible`** (7) | Cancelled, not found, foreign, update error, L1 rejected, L2 rejected, unmapped account | 7 identical |

**Every rejection or synchronous throw at a converted site** (H1, H2, H3, H6, I1, I3, J1, J2, J3, J4, K1, K2, L1, L2) gives the same 500, generic body and claim release to `failed` as the old route. The receipt read (H8) is the exception, as before: it sits inside the receipt's own try/catch, so a rejection logs "Payment settled but the receipt did not go out" and the delivery answers 200 (H-20, identical).

**Log-only differences, accepted (P0-C1 / Q-5, §7.3.3).** H-25, J-14 and K-08 are a Stripe-id lookup that returns an error other than `PGRST116`. In those, the new route adds one `error` line, `service: 'PaymentRepository'`, "Failed to find invoice by Stripe ID". J-07 is a language read that returns an error: one `error` line, `service: 'BusinessProfileRepository'`, "Failed to read business language". Everything else in those four traces is byte-identical, including the activity written in English. A **`PGRST116` miss stays quiet** (H-07, H-08, J-13, K-03 and L-02 are identical, so C-5 holds).

**Language (J4).** `he` → "התשלום נכשל: ‏120.00 ‏₪", `es` → "Pago fallido: 99,50 €", and `en`, no profile, `null` and `''` → "Payment failed: …", the same in both routes. A non-string `language` (J-20, which the `TEXT` column cannot hold) also gives the same trace.

#### 2. Tenant isolation

- **In the equivalence run**, every foreign or unmapped scenario was also checked on the new route: no DB write other than the claim table, no receipt, no activity, and 200. That covers H-10 to H-13, I-04, I-05, I-12, J-16, K-04, L-03 and L-07, so all five handlers.
- **In the new QA file**, one case per handler, plus the metadata path, checks four things: the handler's own refusal line is logged; there is no write; there is no `business_profiles` read; the claim is `completed`.
- **Ordering, by mutation:** T01, T02, T03 and T05 each add the handler's write above its `accountOwns` check, and T04 removes the checkout check. Each was killed by the harness (Fix-1 entries), `fix1Ownership.qa`, `routerPlacement.guard` (F-1 ordering), the new QA file and the equivalence run. So the owner check precedes every unscoped write on all paths tested.

#### 3. Mutation results

Columns are red tests per suite. H = harness, F1 = `fix1Ownership.qa`, CQ = `claimRepository.qa`, QA = the new `invoiceRepository.qa`, GB = `noBookingGuess.guard`, GR = `routerPlacement.guard`, U = `PaymentInvoiceRepository.webhook`, UL = `BusinessProfileRepository.languageCurrency`, EQ = the temporary equivalence run (79 scenarios). A baseline run with no mutant was all green.

| # | Target | Mutation | H | F1 | CQ | QA | GB | GR | U | UL | EQ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R01 | repo | `findByIdUnscoped` drops `.eq('id')` | 12 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 23 |
| R02 | repo | `recordStripeInvoiceId` drops `.eq('id')` | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 5 |
| R03 | repo | `markPaidFromStripeInvoice` drops `stripe_hosted_invoice_url` | 4 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 16 |
| R04 | repo | `markPaidFromStripeInvoice` writes `booking_id: null` | 4 | 0 | 0 | 0 | 1 | 0 | 2 | 0 | 16 |
| R05 | repo | `WEBHOOK_INVOICE_LOOKUP_COLUMNS` gains `status` | 19 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 34 |
| R06 | repo | receipt columns lose `id` (#257) | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 14 |
| R07 | repo | `readFieldsUnscoped` `maybeSingle` → `single` | 7 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 27 |
| R08 | repo | `findByIdUnscoped` `single` → `maybeSingle` | 12 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 23 |
| R09 | repo | `findByStripeInvoiceId` logs `PGRST116` too | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 14 |
| R10 | repo | `findByStripeInvoiceId` catches a rejection with `.then(ok, err)` | 0 | 0 | 3 | 4 | 0 | 0 | 1 | 0 | 4 |
| R11 | repo | `findByStripeInvoiceId` re-adds `try/catch` (the pre-PR shape) | 0 | 0 | 3 | 4 | 0 | 0 | 1 | 0 | 5 |
| R12 | repo | `setStatusFromStripe` always writes `overdue` | 2 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 3 |
| R13 | repo | `recordStripeDocuments` swaps URL and PDF | 5 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 3 |
| R14 | repo | `recordStripeInvoiceId` never awaits its query | 1 | 1 | 0 | 0 | 0 | 0 | 3 | 0 | 5 |
| R15 | repo | `findByStripeInvoiceId` default columns `'*'` → the lookup list | 11 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 30 |
| R16 | repo | `findByStripeInvoiceId` filters `id`, not `stripe_invoice_id` | 30 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 64 |
| R17 | repo | `markPaidFromCheckout` also writes `stripe_invoice_pdf: null` | 4 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 4 |
| B01 | profile repo | `findLanguage` re-adds `try/catch` (the pre-CR-P2-1 shape) | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 1 | 2 |
| B02 | profile repo | `findLanguage` drops `.eq('user_id')` | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 9 |
| B03 | profile repo | `findLanguage` `maybeSingle` → `single` | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 9 |
| B04 | profile repo | `findLanguage` returns `'en'` instead of null when missing | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **2** | 0 |
| B05 | profile repo | `findLanguage` throws a returned error instead of returning it | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 1 |
| T01 | route | H3 written above its `accountOwns` (F-1) | 3 | 3 | 0 | 1 | 0 | 2 | 0 | 0 | 7 |
| T02 | route | J2 overdue written above its check | 6 | 4 | 0 | 2 | 0 | 2 | 0 | 0 | 16 |
| T03 | route | K2 documents written above its check | 7 | 7 | 0 | 1 | 0 | 2 | 0 | 0 | 5 |
| T04 | route | checkout owner check removed | 7 | 2 | 0 | 1 | 0 | 1 | 0 | 0 | 9 |
| T05 | route | L2 cancelled written above its check | 3 | 4 | 0 | 1 | 0 | 2 | 0 | 0 | 5 |
| T06 | route | `findLanguage` keyed by the invoice id | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 9 |
| T07 | route | `.catch` on the `findLanguage` call | 0 | 0 | 0 | **2** | 0 | 0 | 0 | 0 | 2 |
| T08 | route | `.catch` on the H1 `findByStripeInvoiceId` call | 0 | 0 | 0 | **1** | 0 | 0 | 0 | 0 | 2 |
| T09 | route | uncollectible writes `overdue` | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| T10 | route | receipt read with the failed-activity columns | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| T11 | route | `markPaidFromStripeInvoice` gets URL and PDF swapped | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| T12 | route | J3 reads the receipt columns | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 13 |
| T13 | route | H6 not awaited, its error ignored | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 17 |
| T14 | route | `ownerLanguage \|\| 'en'` → `?? 'en'` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| T15 | route | H2 looks up the metadata id by Stripe id | 4 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 11 |
| T16 | route | the H1-path owner check skipped | 6 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 17 |
| T17 | route | `.catch` on the I1 `findByIdUnscoped` call | 0 | 0 | 0 | **1** | 0 | 0 | 0 | 0 | 1 |

**38 of 39 killed** by the permanent suites. Bold = killed by that suite alone among the permanent ones.

- **T14 survives, and is equivalent.** `??` differs from `||` only when the stored language is `''`. With `''`, the locale passed on is `''` rather than `'en'`, but `Intl` gets `en-US` either way and `activitySentence` falls back to English. The equivalence run's J-06 (language `''`) stayed identical under the mutant. No test can kill it, because it changes nothing observable.
- **Without the new QA file, T07, T08 and T17 survive** (all PR 2). Each is a catch added at a route call site, which turns a rejected read into a quiet 200. The harness answers every query with `{ data, error }`, the guards read structure rather than behaviour, and the repository unit tests do not see the route. The pre-PR shapes of the two reused methods (R11 re-adds the `findByStripeInvoiceId` catch; B01 re-adds the `findLanguage` catch) are also killed by `claimRepository.qa` and the unit tests, as Dev and SA reported.
- B04 is killed only by the `languageCurrency` unit test. It is equivalent at the webhook, because of `|| 'en'`, but not for the invite caller. R09 is killed by the C-5 unit test (and by EQ).

#### 4. Regression

| Run | Suites | Tests | Snapshots | Time |
|---|---|---|---|---|
| `app/api/stripe/webhook/__tests__/*.test.ts` (11, including the new QA file), `lib/payments/__tests__/*.test.ts` (40), `lib/repositories/__tests__/*.test.ts` (71, including `PaymentInvoiceRepository.webhook`, `languageCurrency`, `businessOsEntitlements.imports.guard`, `bookingPaymentStatusReaders.guard`, `mutationOrSelect.guard`, `userSubscriptionsWriteLockdown.qa` + `…Migration`), `inviterNotification`, `redemptionDeps`, `noBookingGuess.guard`, `invoiceIntentsStayUnowned.guard`, `stripeAuditEntries`, `noPilotCreditTableReads.guard`, `check-logging-only-diff` | **129 passed** | **2,569 passed** | 100 passed | Jest 99.4 s, wall 124 s |
| `invoiceRepository.qa.test.ts`, 3 runs in a row | 1 | 24/24 each time | — | 3.3–3.4 s each (stable) |

Snapshot blob after all runs: `ae7b32c4…`.

**New file (QA):** `app/api/stripe/webhook/__tests__/invoiceRepository.qa.test.ts`, 24 tests, no snapshots. It covers four things:

- A rejected query at each of the 14 delivery-failing sites gives 500, the generic body and the claim `failed`, and nothing downstream runs.
- A rejected J4 read leaves the invoice overdue with no activity.
- A rejected receipt read does not fail the delivery.
- J4 behaves the same on a returned error (200, English) and keeps its language and chain.

It also has the six foreign-owner cases. It kills T07, T08 and T17. It sets `jest.setTimeout(30000)` because each scenario loads the route afresh: under 9 suites in parallel, the first load took more than 5 s once. The cost is one suite of about 3.3 s, which runs in parallel inside the existing Jest shards.

### Issues found (PR 2)

#### Bugs (must fix before commit)

None.

#### Performance issues

None. Each converted call adds one async hop before the same query, and the order of the recorded traces is unchanged.

#### Edge cases (nice to fix, Low)

1. **`findByStripeInvoiceId` drops `data` when an error comes back with it.** File: `lib/repositories/PaymentRepository.ts`. Inline, H1 used `invoiceByStripeId` whenever it was truthy, even alongside an error. Now an error returns `{ data: null, error }`, so H1 falls through to the metadata lookup (H-32, the only real trace difference). **Unreachable today:** in `@supabase/postgrest-js` 2.75.1, `error` is set only on a non-2xx response, where `data` stays `null` (and `PGRST116` from `single()` also has `data: null`). The old repository method did the same. No action needed; recorded so no one reads H-32 as an oversight.
2. **Log-only differences on a returned non-`PGRST116` error** (H-25, J-07, J-14, K-08): one new repository `error` line each. These are accepted per P0-C1 / Q-5 and documented in §7.3.3. A routine miss stays quiet.
3. **The F-1 ordering guard is positional** (PR2-Q2, accepted by SA). The behavioural proof is the harness's Fix-1 entries, `fix1Ownership.qa` and now the new QA file's six refusal cases. All of them killed T01 to T05 and T16.

### Final status (PR 2)

**Verdict: PASS WITH NOTES.** The notes are the four accepted log-only lines and one difference on an input supabase-js cannot produce (Edge cases 1 and 2). Neither changes behaviour.

- [x] All acceptance criteria pass. PR 2 preserves behaviour in all 79 scenarios. 74 are byte-identical (status, body, DB ops with payloads and terminals, logs, side calls). 4 differ only by the accepted repository log line. 1 differs on an input supabase-js cannot produce. A rejected `findByStripeInvoiceId` or `findLanguage` still gives 500 with the claim `failed`. The owner check precedes every unscoped write in all five handlers. 38 of 39 mutants are killed, and the survivor is equivalent. Regression 129 suites / 2,569 tests / 100 snapshots. Snapshot `ae7b32c4` and all of Dev's files are unchanged, and the temp files are deleted.
- [ ] Dev must review the new QA file `invoiceRepository.qa.test.ts`, which goes into PR 2. Edge cases 1 to 3 need no action.

---

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-06 | Workplan created (Dev) | Inventory of 51 direct sites, reuse map, client equivalence measured, tenant-isolation review (F-1, F-2 HIGH; F-3 bug), "before" recorded (28 tests / 28 snapshots, snapshot blob `4f5f223e`), six-PR split, open questions Q-1 to Q-7 |
| 2026-10-06 | SA workplan review | Approved with conditions C-1 to C-9. F-1 confirmed (Medium-High), F-2 confirmed (High), F-3 confirmed (Medium, business decision needed), F-4 upgraded to High (an unscoped `propagate_refund_to_booking` trigger). Order: Fix-1, then PR 0 to PR 5, with Fix-2 placed once the user decides. Missed guard found (`noBookingGuess:66` would go vacuous). Q-2 to Q-7 ruled |
| 2026-10-07 | Fix-1 plan written (Dev) | User chose Fix-1 first (C-1). Plan in its own file: [BUSINESS_OS_WEBHOOK_CONNECT_FIX1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_FIX1_WORKPLAN.md). Branch renamed to `fix/webhook-connect-tenant-ownership`. New finding F-5 (plan binding keeps an unchecked metadata `booking_id`) recorded there |
| 2026-10-07 | Fix-1 implemented (Dev); sequence updated | Fix-1 SA review: F-5 confirmed High, goes to its own PR **Fix-1b** right after Fix-1. Order recorded in §11: Fix-1 → Fix-1b → PR 0 to PR 5 (Fix-2 placed as before). Fix-1 grows the harness snapshot from 28 to 40 entries, so PR 0's "before" is re-recorded on post-Fix-1b `main` |
| 2026-10-07 | Fix-1b scope addition (Dev) | Fix-1b SA condition C-4: the five pre-existing inline `supabaseServer` queries in `lib/payments/bindPlanSubscription.ts` (CLAUDE.md rule 1) are not fixed in Fix-1b; they join **PR 4** (plans), §9 / §10 / §11 updated. Fix-1b grows the harness snapshot from 40 to 44 entries, so PR 0's "before" counts 44 |
| 2026-10-07 | FU-5 sequenced; PR 1 note; PR 5 rule-1 scope (Dev, per the FU-5 SA review) | §11: sequence is now Fix-1 → Fix-1b → **FU-5** → PR 0 … PR 5 (FU-5 SA Q-5). FU-5 grows the harness snapshot from 44 to 45 entries, so PR 0's "before" counts 45. PR 1 note: a failed claim release when the DB is fully down leaves the row `processing` (pre-existing). PR 5 scope addition: `resolveAccountOwner`'s reads move behind the existing `StripeConnectRepository` + `PluginConnectionRepository` (new methods, no status filter, resolver signature unchanged), superseding Q-2's tracked follow-up. FU-5 plan and evidence: [BUSINESS_OS_WEBHOOK_OWNER_CACHE_FU5_WORKPLAN.md](/docs/workplans/BUSINESS_OS_WEBHOOK_OWNER_CACHE_FU5_WORKPLAN.md) |
| 2026-10-07 | PR 0 implemented (Dev): harness coverage gaps closed, tests only | §7.3.1 added: plan refreshed against `0c3c1800` (gap list re-derived from a coverage run; X1–X11 kept, 44 more), SA Q-6/C-4 explicit delegation list (`findEndStateBySubscriptionId`, `endFromStripe`, no `Proxy`), `eventPatch` and `dispatch` knobs. 55 new snapshot entries, the 45 existing byte-identical (entry-by-entry hashes), `route.ts` blob unchanged (`df671c4a`). Route coverage 73.09 % / 59.02 % → 91.49 % / 75.6 % (statements / branches); cold `.from(` sites 6 → 0. Suite +0.9 s (C-7). Snapshot blob `a673a901`, harness blob `a7cc9992`. Deviations and questions PR0-Q1 to PR0-Q6 for SA (bind error arms for PR 4; three anchored write runs; delegations in `fix1Ownership.qa` instead of `routerEdgeCases.qa`). Header, §7.2, §10 and §11 updated |
| 2026-10-07 | SA code review of PR 0 | Approved with one condition (CR-1). SA re-verified on its own: `route.ts` blob `df671c4a` = `origin/main`, no production file in the diff, an entry-by-entry snapshot comparison (45 identical, 55 new, 0 changed), 51/51 `.from(` sites executed, coverage 91.49 % / 75.6 %, 9 webhook suites (251 tests, 100 snapshots) passing, effect sequences sampled across PR groups 1–5. PR0-Q1: the bind error-path tests go **into PR 0** (CR-1), so PR 4 has a "before" on `main`. PR0-Q2–Q5 accepted. PR0-Q6 is a follow-up; Dev may fix it here. C-7 met (+0.9 s, inside an existing shard; confirm on the PR run). O-1 (identical trace pairs) and O-2 (the delegation names are a contract with PR 4) noted |
| 2026-10-07 | PR 0: SA CR-1 and PR0-Q6 done (Dev) | Three error-path tests in `bindPlanSubscription.test.ts` against the untouched bind (`:431` insert error still links the booking scoped to id + owner; `:454` link error resolves; `:483–484` contact read error projects `contact_id: null`), through the existing mock plus two default-off knobs. 31 tests pass; bind lines 94.36 % → 100 %. Test blob `e87c78f2`, recorded in §7.3.1; PR 4 contract note in §11. PR0-Q6: `as Record<string, string>[]` at `fix1Ownership.qa:595`, scoped `tsc` 0 errors. Regression 55 suites / 934 tests / 100 snapshots; snapshot blob still `a673a901` |
| 2026-10-07 | SA re-check of CR-1 | CR-1 met. With the knobs off the mock answers as before; the 28 old tests are unedited; the three new tests pin `:431`, `:454` and `:483–484` by outcome. On SA's runs: bind lines 100 %, 31/31 bind tests, and harness + `fix1Ownership.qa` at 149 tests / 100 snapshots, snapshot blob `a673a901`. PR0-Q6 annotation accepted. One optional assertion suggested (the contact read was issued). **Code approved for QA** |
| 2026-10-07 | QA of PR 0 | **PASS WITH NOTES.** Mutation-tested through temporary copies of `route.ts` loaded by a scratch `moduleNameMapper`, with the real harness unedited. 35/35 behaviour mutants across PR groups 1–5 killed under `--ci`; the `0c3c1800` harness lets 16 of them survive. 4 behaviour-preserving refactors and a PR 4 simulation of the two named delegations (harness + `fix1Ownership.qa`) stay green. Only expected survivors: 2 log-only (P0-C1) and 1 equivalent. Harness 5/5 stable; about +0.9 s (C-7); 51/51 `.from(` executed; regression 56 suites / 937 tests / 100 snapshots. Snapshot `a673a901` and `route.ts` `df671c4a` unchanged. Note: three bind query chains PR 4 moves are not pinned (contact read `user_id`, installment count `subscription_id`, plan fallback `is_active`); recommended in PR 0 |
| 2026-10-07 | PR 0: QA note (bind read filters) done (Dev) | Three read-chain tests in `bindPlanSubscription.test.ts` pin the full chain of the contact read (`:479` tenant filter), the period count (`:146`) and the plan fallback read (`:513`). The `:483–484` test also asserts that the contact read was issued (SA suggestion). Mutants on a temp copy of bind: each filter removed → exactly its test fails; real bind untouched (`23a38fdd`). 34 tests; regression 55 suites / 937 tests / 100 snapshots; snapshot blob still `a673a901`. Test blob `2e7b9731`, re-recorded in §7.3.1 and the §11 PR 4 note |
| 2026-10-07 | PR 1 implemented (Dev): claim table and client | §7.3.2 added (refresh against `90da8301`, C-2 guard audit, evidence). New `ProcessedWebhookEventRepository` (`findClaim`, `insertClaim`, `reclaimFailed`, `complete`, `markFailed`; ⟨unscoped-by-design⟩ section, fixed columns, typed insert row, no generic update, no try/catch, no logging) with 18 unit tests; `route.ts` client is now the `supabaseServer` alias with the RLS-bypass comment, and P1–P4 and O1 go through the repository (51 → 46 `.from(`). Snapshot blob `a673a901` unchanged, 100/100 entries identical by hash; the 18 other functions `--exact` identical; `routerPlacement.guard` claim check moved and tightened, plus a "claim table only via its repository" check; regression 58 suites / 983 tests / 100 snapshots. `REPOSITORY_STRATEGY.md` note (C-6). Deviations PR1-D1 to D6 and PR1-Q1 for SA |
| 2026-10-07 | SA code review of PR 1 | **Code approved (APPROVED_CODE_REVIEW)**, no blocking finding. SA re-verified on its own: snapshot blob `a673a901` before and after its run, 100/100 entries identical by its own per-entry md5 against `90da8301`, harness and frozen tests unchanged; its own `check-logging-only-diff --exact` over all 20 functions gives 18 identical, only `completeClaim` and `POST` differ, at the five claim sites; method chains read side by side; scoped `tsc` 0 errors in changed files (`@ts-expect-error` consumed), ESLint clean; 59 suites / 1,008 tests / 100 snapshots passed. Tenant isolation: "unscoped by design" is correct (signature-verified Stripe event id, fixed payloads, no trigger, server-only grants). Guard rewrite is stricter, and every old arm still bites. PR1-D1 (no `try/catch`, required for identical behaviour: a catch would turn a thrown claim read into "process without a claim"), D2 to D5 accepted; D6 recorded; Q1 placement confirmed. CR-P1-1 (strategy doc "neither catch nor log" vs C-5) is carried to PR 2; CR-P1-2 and O-P1-1 optional |
| 2026-10-07 | PR 1: SA optional items done (Dev) | CR-P1-2: the repository types are re-exported from `lib/repositories/index.ts`. O-P1-1: `routerPlacement.guard` now also catches a backtick-quoted `from(` and any mention of the class name in the route, which closes a `new …().complete()` bypass. Mutants M5 and M6 each go red on their own new check; `route.ts` blob restored to `e82720b2`. Re-run: 3 suites / 133 tests / 100 snapshots, snapshot blob `a673a901`. CR-P1-1 recorded on the §11 PR 2 task |
| 2026-10-07 | QA of PR 1 | **PASS.** Behaviour preserved: the `90da8301` route and the new route, run side by side under the same mocks, give byte-identical traces (status, body, DB ops with payloads, logs) in 17 of 17 claim scenarios. The scenarios include `23505`, reclaim, a release that is cut to 500 characters, a release that fails or throws, and a claim read that errors or throws. A negative control shows the comparison sees a log-only change. Client: the route builds no client and every query reaches `supabaseServer`. 29 of 29 mutants killed. 7 of them (a catch that swallows a rejection, a dropped `await`, the client, the 500-character cut) are killed only by the new `claimRepository.qa.test.ts` (9 tests). Regression 119 suites / 2,387 tests / 100 snapshots (46 s wall) plus 8 guard suites / 74 tests. Snapshot `a673a901` and all of Dev's files unchanged; temp files deleted. Edge cases (Low, optional): the unit test's "does not catch" only tries a synchronous throw; the guard matches the receiver by name, so an alias passes |
| 2026-10-08 | PR 2 implemented (Dev): Connect invoices | §7.3.3 added (refresh against `933d661c`: Fix-1 made J1/K1/L1 select the same columns, #257 added `id` to the receipt read and three PR 3 sites; C-2 guard audit; evidence). `PaymentInvoiceRepository` gains seven ⟨unscoped-by-design⟩ purpose methods (`findByIdUnscoped`, `recordStripeInvoiceId`, `markPaidFromStripeInvoice`, `markPaidFromCheckout`, `setStatusFromStripe`, `recordStripeDocuments`, `readFieldsUnscoped`) with closed column constants; the reused `findByStripeInvoiceId` takes an optional column list, is quiet on PGRST116 (C-5) and no longer catches (PR2-D1); J4 reuses `findLanguage`. 15 sites moved, `.from(` 48 → 33. Snapshot blob `ae7b32c4` unchanged, 100/100 entries identical by hash; the 15 untouched functions `--exact` identical. `noBookingGuess:66` re-homed onto the repository methods (C-2); `routerPlacement.guard` gains the "every site converted" and an F-1 ordering check. 38 unit tests; regression 178 suites / 3,842 tests / 119 snapshots; mutants M1–M7 red. `REPOSITORY_STRATEGY.md` "Errors passed through" reworded (CR-P1-1). Deviations PR2-D1 to D4, questions PR2-Q1 (findLanguage keeps its catch) and PR2-Q2 for SA |
| 2026-10-08 | SA code review of PR 2 | **NEEDS REVISION**, one blocking finding (CR-P2-1). SA re-verified on its own. Snapshot blob `ae7b32c4` before and after its runs, and 100/100 entries identical by its own per-entry sha1 against `933d661c`. Its own `check-logging-only-diff --exact` on the 15 untouched functions: 15 identical. All 15 sites read against the old chains, including #257's receipt `id`. `.from(` 48 → 33. F-1 checked by hand: every invoice write is dominated by an `accountOwns` early return. Q-3 / C-3 and tenant isolation met, with the named proof present at every call site. C-5 met and tested. C-2 guard moves are stricter, and every old arm is kept. Scoped `tsc` 0 errors in the changed files; ESLint 0 errors; 66 suites / 1,127 tests / 100 snapshots passed. PR2-D1 accepted (it restores 500-on-throw; no other caller, repo-wide grep at base and now). D2–D4 accepted. Q2 accepted as a guard. **PR2-Q1 → (c):** `findLanguage` drops its try/catch and keeps logging returned errors. Otherwise a thrown J4 read answers 200 + English instead of 500 + retry. The invite caller is unaffected because `settle()` catches. Needs a rejection unit test and the strategy-doc sentence updated. CR-P2-2 optional |
| 2026-10-08 | PR 2: SA CR-P2-1 done (Dev) | PR2-Q1 ruled (c). `BusinessProfileRepository.findLanguage` no longer has a try/catch: a returned error is still logged ("Failed to read business language") and handed back, the string check is unchanged, and a rejected read now reaches the webhook (500, Stripe retries), as the inline J4 read did. One test added to `BusinessProfileRepository.languageCurrency.test.ts` ("a rejected query rejects"); the three existing tests are unedited. The inviter notification (`settle()`) and redemption tests pass unchanged. Docs updated: `REPOSITORY_STRATEGY.md`, the "Errors and logging" paragraph in §7.3.3, the PR2-Q1 row, and the optional half-sentence in the `WebhookInvoiceResult` doc. CR-P2-2 not taken (optional, SA: no action). Re-run: 15 suites / 378 tests / 100 snapshots; snapshot blob `ae7b32c4`, 100/100 entries identical; scoped `tsc` 0 errors in changed files (same 58 elsewhere); ESLint 0 errors |
| 2026-10-08 | SA re-check of CR-P2-1 | **APPROVED_CODE_REVIEW; code approved for QA.** `findLanguage` no longer catches. A returned error is still logged and returned, and the chain and string check are unchanged. A rejection reaches the webhook again, which answers 500 and Stripe retries. The invite caller is unchanged, because `settle()` catches. A "rejected query rejects" test was added and the three old tests are unedited. Strategy doc, §7.3.3 and the PR2-Q1 row updated. SA's run: 15 suites / 378 tests / 100 snapshots, snapshot blob `ae7b32c4` unchanged. Scoped `tsc` 0 errors in the changed files |
| 2026-10-08 | QA of PR 2 | **PASS WITH NOTES.** The `933d661c` route and the new route were run side by side under the same mocks with a frozen clock, across all five converted handlers: 79 scenarios. 74 traces are byte-identical (status, body, DB ops with payloads and terminals, logs, side calls). 4 differ only by the accepted repository log line on a returned non-PGRST116 error (P0-C1 / Q-5). 1 differs on an input supabase-js 2.75 cannot produce (error and data together). A rejected or synchronously thrown `findByStripeInvoiceId` or `findLanguage`, and every other converted site except the receipt read, still gives 500 and releases the claim as `failed`. The foreign-owner path writes nothing in all five handlers. 38 of 39 mutants are killed, and the one survivor (`|| 'en'` → `?? 'en'`) is equivalent. A catch added at a route call site (T07, T08, T17) is killed only by the new `invoiceRepository.qa.test.ts` (24 tests). Regression 129 suites / 2,569 tests / 100 snapshots (124 s wall). Snapshot `ae7b32c4` and all of Dev's files are unchanged; the temp files are deleted |
