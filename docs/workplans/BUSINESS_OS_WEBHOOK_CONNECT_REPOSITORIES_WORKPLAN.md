# Workplan: Stripe webhook onto repositories (CLAUDE.md rule 1), no behaviour change

> **Last Updated**: 2026-10-06

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): SR-16 (every route on repositories), §9.4, the tenant-isolation ruling and "Standards for every workplan" (SA-3). Tracked follow-up from [P-0](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P0_WORKPLAN.md) SA review ("Rule 1 / direct Supabase … record it as a tracked follow-up") and [P-1](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P1_WORKPLAN.md) condition P1-C6.
**Prior slices read:** P-0 (Connect characterisation harness, `check-logging-only-diff`), P-1 (router, deny by default), [P-10](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P10_WORKPLAN.md) (P-10a #234, P-10b #238).
**Date:** 2026-10-06
**Branch:** `feature/bos-webhook-connect-repos` (worktree `neuronforge-webhook-repos`), created by RM off `origin/main` `248de6be`. `origin/main` is now `05815f69`; the only change since is one requirement doc (#239), so `route.ts` and every file this plan touches are identical on both.
**Status:** Planning. Workplan only, no production code. Waiting for the SA workplan review.

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
- Belt and braces, after every run: `git hash-object <snap>` must equal the recorded blob (`4f5f223e…` until PR 0 merges, then PR 0's blob), and `git diff --exit-code -- app/api/stripe/webhook/__tests__/__snapshots__/` must exit 0. A hash mismatch is a stop, whatever Jest printed.
- The harness file itself is not edited after PR 0. Its blob after PR 0 is recorded and checked in PR 1 to PR 5 the same way.

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
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` | modify | 0 | Scenarios X1–X11, knobs `dispatch` and `eventPatch`, fall-through mock |
| `app/api/stripe/webhook/__tests__/__snapshots__/connectPath.characterisation.test.ts.snap` | modify (append only) | 0 | New entries; old 28 byte-identical |
| `app/api/stripe/webhook/__tests__/fixtures/platform/subscription-deleted-legacy.json` (+ any fixture X2 needs) | create | 0 | Platform scenarios |
| `app/api/stripe/webhook/__tests__/routerEdgeCases.qa.test.ts` | modify | 0 | Same fall-through mock |
| `app/api/stripe/webhook/route.ts` | modify | 1–5 | The conversion |
| `lib/repositories/ProcessedWebhookEventRepository.ts` | create | 1 | §3 |
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
| `docs/REPOSITORY_STRATEGY.md` | modify | 5 | Note the webhook repositories and the "unscoped by design, owner proven by `accountOwns`" pattern, if SA wants it recorded there |
| Migrations | **none** | — | §1 |

---

## 11. Task list

- [x] ✅ Read the requirement sections, P-0/P-1/P-10 workplans, the harness, `check-logging-only-diff.ts`, `REPOSITORY_STRATEGY.md`, the four skills.
- [x] ✅ Inventory every DB call (§2) and every source guard that pins route text (§8).
- [x] ✅ Record the "before" (§7.1): harness, coverage, regression set, scoped `tsc`, `--exact` sanity run, client-equivalence measurement.
- [x] ✅ SA workplan review; Q-1 to Q-7 ruled (approved with C-1 to C-9).
- **Sequence (C-1, extended by the Fix-1 SA review C-5): Fix-1 → Fix-1b → PR 0 → PR 1 → PR 2 → PR 3 → (Fix-2 if decided) → PR 4 → PR 5.** Each off fresh `main` after the previous one merged.
- [ ] Fix-1: refuse foreign ids (F-1, F-2, F-4, J/K/L). Code complete, uncommitted, on `fix/webhook-connect-tenant-ownership`. Plan and evidence: [BUSINESS_OS_WEBHOOK_CONNECT_FIX1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_FIX1_WORKPLAN.md).
- [ ] Fix-1b (F-5): inside `bindPlanSubscription`, keep `bookingId` / `serviceId` / `paymentPlanId` only if `ownerId` owns them; drop, never refuse. Covers the three call sites (`route.ts:1031`, `:1142`, `:1581` at `248de6be`). Code complete 2026-10-07, uncommitted, on `fix/webhook-plan-booking-ownership`: [BUSINESS_OS_WEBHOOK_PLAN_BOOKING_OWNERSHIP_FIX1B_WORKPLAN.md](/docs/workplans/BUSINESS_OS_WEBHOOK_PLAN_BOOKING_OWNERSHIP_FIX1B_WORKPLAN.md). Uses separate `findOwnedId` reads rather than the `resolveContactId` fold (SA accepted). Harness snapshot grows from 40 to 44 entries.
- [ ] PR 0: harness additions; the "before-with-additions" recorded on post-Fix-1b `main` (the snapshot then has 44 entries, not 28); the existing entries proven identical.
- [ ] PR 1: claim repository, client alias, `routerPlacement` guard moved.
- [ ] PR 2: invoices.
- [ ] PR 3: money rows.
- [ ] PR 4: plans and bookings; two guards moved; plus bind's five inline queries (scope addition, Fix-1b C-4).
- [ ] PR 5: legacy tables, alias removed, rule-1 guard added, lockdown test updated.
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

---

## QA Testing Report

*(QA to populate.)*

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
