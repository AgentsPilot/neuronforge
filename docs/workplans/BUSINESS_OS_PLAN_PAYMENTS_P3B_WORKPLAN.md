# Workplan: Business OS Plan Payments, P-3b (A paid invoice switches the plan)

> **Last Updated**: 2026-10-07

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §5 F1 row 3, F4 rows 2–3, F5 row 1, F7 (the plan-row half); §6 (credit period, upgrade); §8 SR-4, SR-6, SR-8, SR-9, SR-10, SR-11, SR-12, SR-16, SR-17; §9.1 P-3b; §9.3 (20261027); §9.4 CF-2; §9.5 rows 6 and 7; findings PF-2, PF-3, PF-9, PF-11, PF-13, PF-15; SA Review SA-P2, SA-P3, SA-P5, SA-P6, SA-P8, SA-P14 (layer 2), SA-P15 (backstop), SA-P16, the tenant-isolation ruling; conditions C-5, C-6, C-7, C-8, C-9.
**Carry-forwards taken in:** P-3a SA Q-1 (the `checkout.session.completed` / `.expired` handling moved here); P-1 CF-2 / SA Q-8 (fetch a truncated invoice instead of denying it); P-2b F-1 (P-3b is what makes turning `BUSINESS_OS_PLAN_PRICES_ENABLED` on safe); P2b-Q2 (endpoint still on `2025-09-30.clover`).
**Depends on:** P-3a merged (#248, 2026-10-07). 20261025 applied (checker PASS, 2026-10-04).
**Date:** 2026-10-07
**Branch:** `feature/bos-plan-payments-p3b`, cut from `origin/main` `99df24d3` (the #248 merge) on 2026-10-07, worktree `neuronforge-invite-s1`. Uncommitted. Note for RM: `git switch -c … origin/main` set the branch's upstream to `origin/main`; push with `-u origin feature/bos-plan-payments-p3b`.
**Status:** P-3b.1 code complete with SA fixes F-1 to F-3 applied, uncommitted; code approved for QA. `routes.test.ts` is unedited except the one SA-approved mock (C-8 ruling). Next: QA.

## Overview

P-3b makes a paid Stripe plan invoice change the customer's plan. When Stripe reports that a Business OS plan invoice is paid, the webhook finds the account from **our** billing record. It cross-checks Stripe's facts and calls one SQL function, `business_os_apply_plan_payment`. In a single transaction, that function records the payment in a new append-only money history (`business_os_billing_events`) and sets the plan row's tier and paid-through date. It sets the credit-period anchor only for a subscription the account has not paid before (SA-P2). It also updates the billing record. A replayed or reconciled invoice changes nothing. A shared helper, `recordPlanChange`, then writes the audit entry, flushes it before the 200 and invalidates the entitlement cache. The admin entitlements route is refactored onto the same helper with no behaviour change. The webhook also handles the checkout-session events (link the subscription, clear the checkout lock) and, as proposed in §2, mirrors the subscription's status on `customer.subscription.updated` / `.deleted`.

**Nothing changes in production after merge.** `BUSINESS_OS_PLAN_PRICES_ENABLED` stays off there, so production's router recognises no plan price and P-3b's handler is never reached. The two parts that are live at once are behaviour-neutral in production: the admin route refactor, and the anchor rule for a subscribed account, which affects no account because none is subscribed. The migration is inert until called.

**Sizing: about 5.5 dev-days, so it is split into two PRs** (§10): **P-3b.1**, the money history, the apply function and `recordPlanChange` with the admin refactor (inert), then **P-3b.2**, the webhook plan handler and the demo.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope](#2-scope)
3. [Implementation Approach](#3-implementation-approach)
4. [Migration 20261027](#4-migration-20261027)
5. [Files to Create / Modify](#5-files-to-create--modify)
6. [Gates](#6-gates)
7. [Task List](#7-task-list)
8. [Tests](#8-tests)
9. [Local Demo Plan](#9-local-demo-plan)
10. [Sizing and Split](#10-sizing-and-split)
11. [Risks](#11-risks)
12. [Rollback](#12-rollback)
13. [Questions for SA](#13-questions-for-sa)
14. [SA Review Notes](#sa-review-notes)
15. [QA Testing Report](#qa-testing-report)
16. [Commit Info](#commit-info)
17. [Change History](#change-history)

---

## 1. Analysis Summary

Read on `origin/main` `99df24d3`.

| Area | What exists | What P-3b does with it |
|---|---|---|
| `lib/business-os/billing/webhookDispatcher.ts` | `DEFAULT_RESOLVERS = [planResolver]`; the outcomes `flow` / `deny` / `not_business_os`; `BusinessOsHandlerMissingError` | Unchanged. Boost has **not** appended a resolver yet (boost slice 3, #247, is the checkout only; its webhook slice 4 is still to come) |
| `app/api/stripe/webhook/route.ts` (2,655 lines) | `BUSINESS_OS_FLOW_HANDLERS = {}` (l. 2249). A recognised flow with no handler throws, so the claim is released and the event answered 500. A platform `customer.subscription.updated` / `.deleted` goes to the legacy `handleSubscriptionUpdated` / `handleSubscriptionDeleted`, which return at "No user_id in subscription metadata" (`error`) for a Business OS subscription | **One added line**: `plan: handlePlanBillingEvent`. All logic lives in `lib/business-os/billing/` (SA standards, rule 1). No Connect path is edited |
| `planInvoiceResolver.ts` | `invoice.paid` and `invoice.payment_failed` → `flow: plan` on a recognised price. Truncated lines → `deny lines_truncated`. A subscription-mode `checkout.session.completed` → `deny legacy_subscription_checkout`. Everything else → `not_business_os`. Reads no database | Fetches a truncated invoice's lines (CF-2). Recognises plan checkout sessions (completed and expired) and plan subscriptions (updated and deleted) **by price**, through Stripe line items or subscription items, never by metadata. With the price switch off, it behaves exactly as today: no new Stripe call, same outcomes (§3.6) |
| `planPriceCatalog.ts` | `planTierForLookupKey`, `activePlanLookupKeys()` (empty while the switch is off) | The tier a paid line sells. The "switch off" short-circuit for the new recognitions |
| `BusinessOsBillingAccountRepository` | `findByUser`, `recordCustomer`, `acquireCheckoutLock`, `replaceCustomer` (CAS with `{ count: 'exact' }`, no `.select()`) | Adds `findByStripeSubscription`, `findByStripeCustomer`, `linkCheckoutSession`, `releaseCheckoutLock` and `mirrorSubscriptionState` (§3.5). The function does the payment write itself |
| `business_os_billing_accounts` (20261025) | 21 columns; `stripe_subscription_id` UNIQUE; `subscription_status` CHECK of 8 statuses, needing a subscription id; column-level UPDATE for `service_role` on 17 columns | Written by the function and the session/mirror methods. **No ALTER**: every column needed exists |
| `business_os_account_plans` (20261005) | `tier`, `plan_version` (CHECK > 0 with a tier), `tier_expires_at`, `cohort`, `period_anchor` NOT NULL, `updated_by_admin_id` (no FK), `updated_at`. `service_role` SELECT, INSERT, UPDATE | Written only by the function, which is `SECURITY INVOKER`. `updated_by_admin_id = NULL` marks a system write (SA-P3). **Live columns re-checked at T0** (`business-os-schema-check`) |
| `lib/business-os/entitlements/adminOps.ts` | `assignTier` (l. 482) and `setCohort` (l. 426) both write `period_anchor = now`. `wouldLeaveNoBasis` and `tierInForce` are private. `executeAdminOp` requires `adminId` | Extracts the shared pre-write checks (SA-P3 a) to `planWriteChecks.ts`. `assignTier` keeps the anchor on a subscribed account (PF-13). `setCohort` is Q-6 |
| `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts` POST (l. 257–300) | `invalidate(accountId)` → `auditTrail.log({...}).catch` → `auditTrail.flush().catch` → 200 | Replaced by one `recordPlanChange` call, with the same inputs and order (§3.4). `routes.test.ts` pins the plan-op audit entries byte for byte (T11b.1), which is the before/after proof |
| `AuditTrailService.buildLogEntry` | `actorId = input.actorId \|\| input.userId \|\| SYSTEM_ADMIN_USER_ID`: a missing actor becomes the **owner** | The webhook passes `platformActorId()` (`lib/business-os/llm/aiActionAudit.ts`, the D-3 convention for external actions) plus `details.actor = 'stripe_webhook'`. It does not pass a null actor, because the service would turn that into the owner (Q-4) |
| `lib/audit/boundedAuditFlush.ts` | `logAndFlush`: bounded at 2 s, never rejects. P-3a uses it | `recordPlanChange` uses it (Q-5) |
| `lib/business-os/purge/adminDeletionRefusals.ts` | `isPlanSubscriptionLive`: status in the live set, **or** a subscription id with `ended_at` NULL | Once P-3b links a subscription, an admin deletion is refused until `ended_at` is set. That is the reason the subscription mirror is proposed in scope (§2, Q-1) |
| Payment hold (`paymentHold.ts`) | Held while `first_paid_at` is NULL (lineage) | **Not touched.** A held friend who pays in P-3b gets the tier but stays held until P-5 stamps `first_paid_at`. This cannot happen in production, because both switches are off there (R-6) |
| Stripe SDK `stripe@19.2.1`, `2025-10-29.clover` | Invoice `total_taxes[]`, `status_transitions.paid_at`, `billing_reason`; line `period.start/end`, `pricing.price_details.price`; subscription `billing_cycle_anchor`, item `current_period_end`; `invoices.listLineItems`, `checkout.sessions.listLineItems` | Every field P-3b reads is listed in §3.7 (PF-9) |
| Fixtures | `lib/business-os/billing/__tests__/fixtures/stripe/*.json` are still **HAND-BUILT** (P-2b H3 stopped: the sandbox renders `2025-09-30.clover`) | C-8 is Q-9: capture during the P-3b demo |
| Connect characterisation harness | `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` + snapshot | Run before and after P-3b.2. The Connect entries must stay byte-identical (SR-10) |

**Phase being fixed (CLAUDE.md rule 8):** not applicable. No V6 pipeline or plugin code is touched.

**Deprecated patterns met:** the legacy platform handlers in `route.ts` (`handleSubscriptionUpdated`, `handleSubscriptionDeleted`, `handleInvoicePaymentFailed`) key on `metadata.user_id` and write `user_subscriptions` / `billing_events`. P-3b neither extends nor calls them. They are P-10's. The route's 51 direct `.from(` calls are CF-5's, so P-3b adds none.

---

## 2. Scope

| In P-3b | Out (and where it goes) |
|---|---|
| Migration **20261027**: `business_os_billing_events` (money history) and `business_os_apply_plan_payment`. The function does **not** reference the lineage table (P-5's 20261028 replaces it to add the `first_paid_at` stamp) | `first_paid_at` stamp, the column grant on it, and releasing held friends (P-5) |
| `recordPlanChange` (audit + bounded flush + invalidate), with the admin route refactored onto it, and the shared pre-write checks extracted (SA-P3 a, c) | The F4 admin warning "Stripe is still billing…" and the billing panel (P-8a) |
| SA-P2 anchor: set from `billing_cycle_anchor` only on the first plan-writing invoice of a subscription id new to the account. Admin `assign_tier` on a subscribed account keeps the anchor (PF-13) | Founding Partner `trial_end` subscriptions (P-11). The $0-invoice rule itself is in P-3b and tested (SA-P16c) |
| Webhook `invoice.paid` on a recognised plan price → apply. Includes SA-P14 layer 2 (a second live subscription is refused), the SA-P15 backstop (non-USD is refused), the metadata cross-check and PF-15 (the event's mode must equal the key's mode) | Stale-claim reclaim and nightly reconciliation (P-8b). The function is written so the reconciler can call it (idempotent by invoice id) |
| CF-2: a truncated recognised invoice is fetched in full, not denied | — |
| `checkout.session.completed` (subscription mode, plan price): link the subscription id and clear the lock. `checkout.session.expired`: clear the lock (P-3a SA Q-1) | — |
| **Proposed (Q-1): `customer.subscription.updated` / `.deleted` for plan subscriptions, a status-only mirror**: `subscription_status`, `cancel_at_period_end`, `ended_at`, read **fresh from Stripe** so event order does not matter. No plan write, no money history, no audit | Everything else on those events (pending downgrade, `failed_attempts`, the "ended" audit and money-history rows): P-6a / P-7b |
| `invoice.payment_failed` on a plan price: one money-history row (`invoice_payment_failed`), logged, claim completed (Q-2). Before P-3b it was released and retried, because no handler existed | Attempt count, banner, `action_required` (P-6a) |
| Audit events `BOS_BILLING_INVOICE_PAID` and `BOS_BILLING_PAYMENT_REFUSED` (AM-7) | Every other AM-7 event, each with its slice |
| Repository `BusinessOsBillingEventRepository` (`new-repository`); purge, deletion and cleanup registrations of the new table | Owner-facing invoice list (P-7a) |
| Demo on `/test-business-os` (§9) | Production demo; turning any switch on in a shared environment |

**State in production after merge:** inert. The price switch is off, so the router recognises no plan price and the new handler is never called. The migration adds an empty table and an uncalled function. The admin refactor and the PF-13 rule are live but change nothing observable, because no account has a live subscription.

---

## 3. Implementation Approach

### 3.1 Layering

| Layer | File | Responsibility |
|---|---|---|
| Route | `app/api/stripe/webhook/route.ts` | Registers `plan: handlePlanBillingEvent`. Nothing else |
| Handler | `lib/business-os/billing/planBillingHandler.ts` | Switches on `event.type` and calls one of the four use cases below. Throws for "could not tell" (Stripe or DB unavailable: the claim is released and Stripe retries). Returns normally for a refusal (logged, recorded, claim completed) |
| Use case | `lib/business-os/billing/planPaymentApply.ts` | `invoice.paid` / `invoice.payment_failed`: parse the invoice (pure, §3.7), resolve the account (§3.3), cross-check, call the function, then `recordPlanChange` |
| Use case | `lib/business-os/billing/planCheckoutSessionEvents.ts` | Session completed / expired (§3.5) |
| Use case | `lib/business-os/billing/planSubscriptionMirror.ts` | Subscription updated / deleted (§3.5) |
| Pure | `lib/business-os/billing/planInvoiceFacts.ts` | Invoice → `{ tier, periodStart, periodEnd, amountMinor, taxMinor, currency, paidAt, assignsPlan, subscriptionId, customerId, bosUserIdClaim }` or a refusal reason. No I/O |
| Shared | `lib/business-os/entitlements/recordPlanChange.ts` | Audit, bounded flush, invalidate (§3.4) |
| Shared | `lib/business-os/entitlements/planWriteChecks.ts` | `tierIsConfigured`, `wouldLeaveNoBasis`, `tierInForce`, moved out of `adminOps.ts` unchanged (SA-P3 a) |
| Data | `BusinessOsBillingEventRepository` (new), `BusinessOsBillingAccountRepository` (extended) | RPC call and inserts; CAS updates |
| Stripe | `lib/stripe/StripeService.ts` | `retrieveBusinessOsSubscription`, `listInvoiceLinesAll`, `listCheckoutSessionPriceIds`, placed after P-3a's methods, Stripe only (as P-3a) |

The dispatcher contract is unchanged: no account in the outcome. The account is resolved only inside the handler, from our billing record (SR-8).

### 3.2 The apply function contract (`business_os_apply_plan_payment`)

`SECURITY INVOKER`, `SET search_path = ''`, `VOLATILE`; EXECUTE for `service_role` only. One transaction.

```text
business_os_apply_plan_payment(
  p_user_id uuid, p_livemode boolean, p_stripe_customer_id text,
  p_stripe_subscription_id text, p_replaces_subscription_id text,   -- NULL unless the handler proved the old one ended
  p_stripe_event_id text, p_stripe_invoice_id text,
  p_tier text, p_plan_version integer, p_assigns_plan boolean,
  p_amount_minor integer, p_amount_tax_minor integer, p_currency text,
  p_period_start timestamptz, p_period_end timestamptz, p_paid_at timestamptz,
  p_billing_cycle_anchor timestamptz, p_subscription_status text)
RETURNS TABLE (out_status text, out_event_row_id uuid, out_tier_before text, out_tier_after text,
               out_plan_written boolean, out_anchor_set boolean)
```

| Step | Rule | Result |
|---|---|---|
| 1 | Every argument is checked for presence and shape (`cus_`, `sub_`, `in_`, `evt_` prefixes, lengths, amounts ≥ 0, `period_end > period_start`, `p_currency = 'usd'`, `p_tier` 1–64 chars) | Raises `22004` / `22023`. The handler validated already, so this is a backstop |
| 2 | Billing row `WHERE user_id = p_user_id AND livemode = p_livemode FOR UPDATE` | Not found → `billing_row_missing`. `stripe_customer_id <> p_stripe_customer_id` → `customer_mismatch`. Nothing written |
| 3 | **Idempotency by invoice:** an `invoice_paid` row for `p_stripe_invoice_id` exists | `already_applied` (returns the existing row id), nothing written. This covers webhook redelivery, a second event for the same invoice and P-8b's reconciler, which has no event id |
| 4 | Subscription identity. The row's subscription is NULL, or equals `p_stripe_subscription_id` → the same subscription. It equals `p_replaces_subscription_id` → a replacement (re-buy). Anything else → `subscription_conflict`: one `mismatch_refused` row (`refusal_reason = 'second_subscription'`, ON CONFLICT on the event id does nothing), no other write | SA-P14 layer 2 |
| 5 | Plan row `FOR UPDATE` | Missing → `plan_row_missing`, nothing written (Q-3) |
| 6 | **Newest?** A replacement, or a row with no `current_period_end`, is newest. So is `p_period_end > current_period_end`, or an equal period end with `p_paid_at >= last_paid_at`. The order is taken from the **billing row** (Stripe's facts), never from the plan row, which an admin may have edited | Decides whether the plan and the paid-through date move (Q-7) |
| 7 | **Anchor?** `p_assigns_plan` AND newest AND no earlier `invoice_paid` row for this account and this subscription with `plan_written = true` | SA-P2: the first plan-writing invoice of a subscription new to the account. Renewals, upgrades, downgrades, card fixes and replays never set it. A $0 trial invoice writes no plan, so the first non-zero invoice after it sets the anchor (SA-P16c) |
| 8 | INSERT the `invoice_paid` row: `tier = p_tier`, `plan_written = p_assigns_plan AND newest`, amounts, period, `paid_at`, ids, `livemode` | One history row per invoice, always, including the $0 and out-of-order ones |
| 9 | If `plan_written`: UPDATE the plan row: `tier = p_tier`, `plan_version` = `p_plan_version` if the tier changes or no tier is in force, otherwise unchanged (grandfathering, Q-8), `tier_expires_at = p_period_end`, `period_anchor` = `p_billing_cycle_anchor` if step 7 holds, otherwise unchanged, `updated_by_admin_id = NULL`, `updated_at = now()`. `cohort` is never touched (SA-P16d: the tier wins over a live trial) | SA-P16b: every newest paid plan invoice re-asserts the bought tier |
| 10 | UPDATE the billing row: `stripe_subscription_id`, `subscription_status = p_subscription_status`, `ended_at = NULL` on a replacement, and when newest also `bought_tier`, `current_period_end`, `last_invoice_id`, `last_paid_at = p_paid_at`, `updated_at`. `failed_attempts` is left for P-6a | A UNIQUE clash on `stripe_subscription_id` (held by another account's row) is caught: `subscription_conflict` with `refusal_reason = 'subscription_held_elsewhere'` |
| 11 | Return | `applied` (plan written) or `recorded` (history only: $0, not newest) |

**`tier_expires_at`** is Stripe's period end, stored verbatim (PF-10: the 24 h margin is P-6a's, in `deriveLifecycle`). SA-P3 wrote `GREATEST(existing, period_end)`. Step 6 already makes this out-of-order safe, and `GREATEST` against the plan row would keep a longer admin end date after a payment. Q-7 asks SA to confirm the change.

**The handler (TypeScript) decides, before the call:**

- `p_assigns_plan`, from `planInvoiceFacts`: `amount_paid > 0`, or `billing_reason = 'subscription_cycle'` with a discount (SA-P8, SA-P16c).
- `p_tier`, from the plan-price lines with a **positive** amount, so an upgrade's proration credit line (old tier, negative) is ignored. Two different tiers on positive lines are refused (`mismatch_refused`, `mixed_tiers`). If no line is positive (a $0 invoice), the tier comes from the plan lines.
- `p_period_start` / `p_period_end`, from the invoice's own plan lines (`line.period`), the max end over the positive lines. It is not taken from the subscription fetched now, so a late replay carries its own period.
- `p_billing_cycle_anchor` and `p_subscription_status`, from `subscriptions.retrieve(subscriptionId)` (one Stripe call per paid invoice; Stripe errors throw, so the claim is released).
- `p_replaces_subscription_id`: set only when the row holds a different subscription **and** Stripe says that one has ended (`canceled` or `incomplete_expired`). If the old one is still live, it is passed as NULL and the function refuses (step 4).
- `p_plan_version` = `getEntitlementConfig().matrix.version`; `tierIsConfigured(config, tier)` is checked first. An unconfigured tier → `mismatch_refused` (`tier_not_configured`) with `alert`.

### 3.3 Account resolution and cross-checks (SR-8, tenant isolation)

| # | Check | On failure |
|---|---|---|
| 1 | `event.livemode === isLiveMode(currentStripeMode())` (PF-15) | `error` + `alert` `bos_billing_mode_mismatch`, claim completed, **nothing written** (no account is resolved for an event from the other mode). Unknown key mode → throw (release) |
| 2 | `invoice.currency === 'usd'` (SA-P15 backstop) | `mismatch_refused` (`currency_not_usd`; the row's `currency` stays NULL because of the CHECK) |
| 3 | Account: billing row by `stripe_subscription_id` + `livemode`, else by `stripe_customer_id` + `livemode` | None → `mismatch_refused` with `user_id` NULL and `refusal_reason = 'unknown_customer'`, `error` + `alert`, claim completed. The money is recorded even though no account is found |
| 4 | Metadata cross-check: `bos_user_id` on the invoice's subscription snapshot, if present, equals the row's `user_id` | `mismatch_refused` (`metadata_account_mismatch`), alert. Metadata never chooses the account |
| 5 | Subscription and customer on the invoice agree with the row (step 2 of §3.2) | `customer_mismatch` → `mismatch_refused` |

The two `findByStripe…` repository methods are the documented exception to "filter by `user_id`": the account is not yet known. Both filter by `livemode` and a UNIQUE Stripe id, select the full row, and every write that follows uses the `user_id` taken from that row. The repository header documents this (tenant-isolation-guard, CLAUDE.md rule 4 note).

### 3.4 `recordPlanChange` and the admin refactor

```text
recordPlanChange({
  accountId, action, actor: { kind: 'admin', adminId } | { kind: 'system', source: 'stripe_webhook' },
  entityType, entityId, changes, details, severity, request?, invalidatesEntitlements, log
}) → Promise<void>   // never throws
  1. if invalidatesEntitlements: getEntitlementService().invalidate(accountId)
  2. logAndFlush({ action: AUDIT_EVENTS[action] ?? action, entityType, entityId, userId: accountId,
                   actorId: admin ? adminId : platformActorId(), changes,
                   details: { ...details, actor: admin ? undefined : 'stripe_webhook' }, severity, request }, log, …)
```

- **Admin route:** steps 257–300 become one call with the same arguments: `severity: 'warning'`, the same `entityType` / `entityId` fallbacks, the same `details` spread order, and `invalidatesEntitlements: outcome.invalidatesEntitlements !== false`. The replay branch (credit ops) stays in the route, before the call, exactly as now.
- **Proof of no behaviour change:** (1) `routes.test.ts` (T11b.1) pins every plan-op and credit-op audit entry byte for byte. It must pass unedited except the one SA-approved mock (C-8 ruling): the T11b.1 pin byte-identical. (2) A new test asserts the call order invalidate → log → flush → response. (3) Its one real difference is Q-5: the raw `flush()` becomes the bounded `logAndFlush`, so a hung flush now returns after 2 s instead of holding the request.
- **Webhook:** `severity: 'info'` for `BOS_BILLING_INVOICE_PAID`, `'warning'` for `BOS_BILLING_PAYMENT_REFUSED`. `entityType: 'business_os_account_plan'`, `entityId = accountId`, `changes: { before, after }` (the plan row tier, expiry and anchor, read back from the function's outputs), `details: { invoiceId, subscriptionId, tier, amountMinor, planWritten, anchorSet, livemode, stripeEventId }`. No email, no metadata values. Written only when the function returns `applied` or `recorded`. An `already_applied` replay writes none (as the admin replay branch).
- **Invalidation:** local instance only. Other instances follow within the 30 s TTL. Nothing in P-3b depends on the hold, which is read uncached anyway.

**SA-P2 / PF-13 in `adminOps.ts`:** `AdminOpContext` gains `billing: { hasLivePlanSubscription(accountId): Promise<boolean | null> }`, which reads the billing rows of **both** Stripe modes through `findByUser` (SA ruling 2, 2026-10-07; implemented as `hasLivePlanSubscription` in `adminDeletionFacts.ts`) and applies `isPlanSubscriptionLive` (reused from `adminDeletionRefusals.ts`, not copied). `assignTier` writes `period_anchor` only when the answer is `false`. If the read fails (`null`), the op is refused `500 billing_read_failed` (fail closed; Q-6). `setCohort` also resets the anchor (l. 426), so Q-6 asks whether the same rule applies there.

### 3.5 Session events and the subscription mirror

All three methods use `update(patch, { count: 'exact' })` with **no `.select()`** (the PostgREST UPDATE + `.or()` + `.select()` 42703 rule) and no `.or()` at all. Each has an explicit column allow-list.

| Event | Account | Write (compare-and-set) | Replay |
|---|---|---|---|
| `checkout.session.completed`, subscription mode, plan price | Row by `session.customer` + `livemode`; `bos_user_id` cross-check | `linkCheckoutSession`: `open_checkout_session_id = NULL, open_checkout_expires_at = NULL`, and `stripe_subscription_id = session.subscription` **only if** the row's subscription is NULL or the same one, `WHERE user_id = … AND livemode = … AND open_checkout_session_id = session.id`. If the row holds another subscription, the lock is still cleared and the link is left to `invoice.paid` (§3.2), with a `warn` | count 0 → already done, `info` |
| `checkout.session.expired`, plan price | Same | `releaseCheckoutLock`: both lock columns NULL `WHERE … AND open_checkout_session_id = session.id` | count 0 → no-op |
| `customer.subscription.updated` / `.deleted`, plan price on an item | Row by `stripe_subscription_id` + `livemode` | `mirrorSubscriptionState`: retrieve the subscription **fresh**, then `subscription_status`, `cancel_at_period_end`, `ended_at` (`ended_at` from Stripe, else NULL) `WHERE user_id AND livemode AND stripe_subscription_id = sub.id`. Not `current_period_end`: only a paid invoice moves that | Order-independent: always the latest state |

A session or subscription whose customer has no row → `warn` (not money, so no money-history row), claim completed.

### 3.6 Resolver changes, and how production stays byte-identical

| Event | Switch off (production) | Switch on |
|---|---|---|
| `invoice.paid` / `.payment_failed`, `lines.has_more` | `deny lines_truncated` (unchanged) | `invoices.listLineItems` paged in full, then the normal decision. A Stripe error throws |
| `checkout.session.completed`, subscription mode | `deny legacy_subscription_checkout` (unchanged, no Stripe call) | `checkout.sessions.listLineItems` → every price recognised → `flow: plan`. None → `deny legacy_subscription_checkout`. Some → `deny mixed_prices` |
| `checkout.session.expired`, subscription mode | `not_business_os` (unchanged) | Same price test → `flow: plan`. Unrecognised → `not_business_os` |
| `customer.subscription.updated` / `.deleted` | `not_business_os` (unchanged: the legacy handler runs as today) | Item prices (`items.data[].price.id`, with `has_more` → fetched) recognised → `flow: plan`. Otherwise `not_business_os` |

"Off" is `activePlanLookupKeys().length === 0`, checked **before** any new Stripe call. A test pins that, with the switch off, every new branch makes zero Stripe calls and returns today's outcome. The router's metadata rule is unchanged: metadata never routes, and a mismatch is denied.

**Disjointness with boost:** boost resolves `checkout.session.completed` in **payment** mode (P-1's `NOT_OURS` branch, untouched). Plan resolves subscription mode only, so the two cannot both claim a session. The `resolver_conflict` deny stays the backstop.

### 3.7 Stripe fields read (PF-9) and the API version note

| Object | Field (clover) | Used for |
|---|---|---|
| Invoice | `id`, `customer`, `currency`, `amount_paid`, `billing_reason`, `discounts`, `total_taxes[].amount`, `status_transitions.paid_at`, `livemode`, `lines.data[]`, `lines.has_more` | Facts, ordering, assigns-plan |
| Invoice | `parent.subscription_details.subscription` / `.metadata` (via `invoiceSubscription.ts`) | Subscription id, `bos_user_id` cross-check |
| Invoice line | `pricing.price_details.price` (via `invoiceLinePrices.ts`), `amount`, `period.start`, `period.end` | Tier, period |
| Subscription | `id`, `status`, `billing_cycle_anchor`, `cancel_at_period_end`, `ended_at`, `items.data[].price.id` | Anchor, status mirror, recognition |
| Checkout session | `id`, `mode`, `customer`, `subscription`, `metadata`; line items `price.id` | Link, lock |

**API version.** Production's endpoint (`we_1UNG3L56GTXD0wwiKUsZn8DU`) is still on `2025-09-30.clover`; the user kept that ops step (P-3a gate G-4) open. SA ruled in P2b-Q2 that the fields the router reads do not differ between `09-30` and `10-29` (monthly releases within a major are additive). P-3b reads more fields (the table above). All of them are Basil-era and exist in both. Q-9 asks SA to extend the P2b-Q2 ruling to this list. The code reads the clover shapes only, with the existing legacy fallbacks in the two shared readers.

---

## 4. Migration 20261027

**Number check (2026-10-07):** `supabase/migrations` on `origin/main` jumps from 20261026 to 20261030, so 20261027 is free. There are no open PRs (`gh pr list --state open` is empty), and no remote branch or local worktree (all 26 scanned) holds a 20261027–29 file. P-5 keeps 20261028 and P-9 keeps 20261029.

### 4.1 `business_os_billing_events` (SA-P5 shape, plus four columns for SA to rule on in Q-10)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | — |
| `user_id` | uuid NULL, FK `auth.users` ON DELETE SET NULL | NULL for an unknown customer, or after deletion (detached like the billing record) |
| `livemode` | boolean NOT NULL | PF-15 |
| `kind` | text NOT NULL, CHECK in the 9 SA-P5 kinds | Full v1 set from day one |
| `stripe_event_id` | text NULL, UNIQUE, CHECK `evt_` shape | NULL only for a reconciler row (P-8b) |
| `stripe_invoice_id` | text NULL, CHECK `in_` | — |
| `stripe_subscription_id` | text NULL, CHECK `sub_` | — |
| `stripe_customer_id` | text NULL, CHECK `cus_` | **Addition**: the only key of an unknown-customer refusal; reconciliation (P-8b) |
| `tier` | text NULL, 1–64 | The tier the paid line sells |
| `plan_written` | boolean NOT NULL DEFAULT false | **Addition**: drives the anchor rule (§3.2 step 7) and tells an admin which payment moved the plan |
| `refusal_reason` | text NULL; CHECK `(kind = 'mismatch_refused') = (refusal_reason IS NOT NULL)`, 1–64 | **Addition** |
| `amount_minor`, `amount_tax_minor` | integer NULL, CHECK ≥ 0 | — |
| `currency` | text NULL, CHECK `currency = 'usd'` | SA-P5 |
| `period_start`, `period_end` | timestamptz NULL; CHECK end > start when both are set | — |
| `paid_at` | timestamptz NULL | **Addition**: Stripe's `status_transitions.paid_at`, the ordering key and the date on P-7a's invoice list |
| `created_at` | timestamptz NOT NULL DEFAULT now() | — |

Indexes: UNIQUE (`stripe_event_id`). **Partial UNIQUE (`stripe_invoice_id`) WHERE `kind = 'invoice_paid'`**, which gives idempotency by invoice (Q-11). (`user_id`, `created_at` DESC). (`stripe_subscription_id`) WHERE `kind = 'invoice_paid' AND plan_written`.

Privileges: RLS on, no policy. REVOKE ALL from PUBLIC, `anon`, `authenticated`, `service_role` (four statements), then GRANT SELECT, INSERT to `service_role`. **No UPDATE, no DELETE** (append-only, SA-P5). No `authenticated` grant: owners read through routes (P-7a).

### 4.2 The function

As §3.2. REVOKE ALL ON FUNCTION from PUBLIC, `anon`, `authenticated`; GRANT EXECUTE to `service_role`. It names `business_os_billing_accounts`, `business_os_account_plans` and `business_os_billing_events` only. A migration test asserts that `business_os_account_lineage` does not appear (§9.3).

### 4.3 SQL-editor rules (the user pastes every file by hand)

| Rule | How |
|---|---|
| No `--` comments, no comment blocks | Prose lives in this workplan and in `COMMENT ON` strings |
| No punctuation in string literals | `COMMENT ON` text uses double spaces as separators (20261025 style). Prefixes are built with `chr(95)` / `chr(58)` (`'cus' \|\| chr(95)`) |
| **The word "into"** | Never in a literal, a comment or an exception message. The SQL keyword is unavoidable in `INSERT INTO`, and `SELECT … INTO` has applied cleanly before (20261031 has 4 uses, 20261017 has 9). Where an assignment `v_x := (SELECT …)` reads as well, it is used instead. A migration test asserts every occurrence is the keyword form (Q-12) |
| Small statements | One `ALTER TABLE … ADD CONSTRAINT` per constraint, one `GRANT` / `REVOKE` per statement, one `CREATE INDEX` each |
| One transaction | `BEGIN; SET LOCAL lock_timeout = '5s'; … COMMIT;`, plain `CREATE` (a second paste fails and changes nothing) |
| No DO block, no SECURITY DEFINER, no single-letter alias | As the existing migration tests pin |

### 4.4 Scripts (four files plus a probe, as 20261025 / 20261031)

| File | Contents |
|---|---|
| `scripts/precheck-bos-billing-events-migration.sql` | Read-only from its first statement (`SET TRANSACTION READ ONLY`). Checks: 20261025's table and its 17-column UPDATE grant exist; the plan table has `tier`, `plan_version`, `tier_expires_at`, `cohort`, `period_anchor`, `updated_by_admin_id`, `updated_at`, and `service_role` UPDATE on it; the new table and function names are free. PASS / FAIL per row + **VERDICT**. Tells the user to run the migration in a NEW tab |
| `supabase/migrations/20261027_business_os_billing_events.sql` | §4.1 + §4.2 |
| `scripts/check-bos-billing-events-migration.sql` | Read-only. Columns and types in order; every CHECK by name and text; the indexes; RLS on, 0 policies; grants exactly SELECT and INSERT for `service_role` and nothing for PUBLIC, `anon` or `authenticated`; the function exists with `prosecdef = false`, `search_path` empty, EXECUTE for `service_role` only, and source not naming the lineage table; 0 rows. PASS / FAIL + **VERDICT** |
| `scripts/probe-bos-apply-plan-payment.sql` | `BEGIN … ROLLBACK`, run by the user on their own test account (precedent `probe-bos-boost-crediting-migration.sql`). It exercises in SQL: first apply, replay, a different event for the same invoice, an out-of-order older invoice, an upgrade (same end, later `paid_at`), the $0 invoice then the first paid one, a second live subscription, a replacement, a missing billing row and a missing plan row. Each prints PASS / FAIL, then a VERDICT. **Nothing persists** |
| `supabase/SQL Scripts/20261027_business_os_billing_events_rollback.sql` | `DROP FUNCTION`, then `DROP TABLE`, guarded: the first statement refuses (raises) if the table holds any `livemode = true` row |

Safe to apply before the code deploys: nothing calls the function until P-3b.2, and production's switch is off even then.

---

## 5. Files to Create / Modify

**P-3b.1 (inert)**

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261027_business_os_billing_events.sql` | create | §4 |
| `scripts/precheck-bos-billing-events-migration.sql`, `scripts/check-bos-billing-events-migration.sql`, `scripts/probe-bos-apply-plan-payment.sql` | create | §4.4 |
| `supabase/SQL Scripts/20261027_business_os_billing_events_rollback.sql` | create | §4.4 |
| `supabase/migrations/__tests__/business-os-billing-events.migration.test.ts` | create | Static pins (§8) |
| `lib/repositories/BusinessOsBillingEventRepository.ts` + test | create | `applyPlanPayment` (RPC, mapped result), `recordEvent` (insert; a 23505 on the event id → `duplicate`, not an error) |
| `lib/repositories/index.ts` (if it barrels) | modify | Export |
| `lib/business-os/entitlements/planWriteChecks.ts` + test | create | Moved from `adminOps.ts`, unchanged |
| `lib/business-os/entitlements/recordPlanChange.ts` + test | create | §3.4 |
| `lib/business-os/entitlements/adminOps.ts` | modify | Uses `planWriteChecks`; `billing` port; PF-13 anchor rule |
| `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts` | modify | `recordPlanChange`; wires the `billing` port |
| `lib/business-os/entitlements/__tests__/adminOps.test.ts`, the route's `routes.test.ts` | modify (adminOps) / unedited except the one SA-approved mock (C-8 ruling) (routes) | PF-13 cases; byte-for-byte proof |
| `lib/audit/events.ts` (+ metadata, audience, filter group, owner visibility, `types.ts`, as P-3a's registration) | modify | `BOS_BILLING_INVOICE_PAID`, `BOS_BILLING_PAYMENT_REFUSED` |
| `lib/business-os/purge/descriptors.ts`, `classification-baseline.json`, `lib/business-os/account/accountDeletionPolicy.ts`, `lib/business-os/businessOwnedTables.ts`, `scripts/generate-test-account-cleanup-sql.ts` | modify | The new table: `never` purged, a retained financial record, detached on deletion; test cleanup refuses live rows (as 20261025) |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | Non-gate registrations (SR-17) for every new importer |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` § Billing | modify | Money history, apply function, anchor rule, `recordPlanChange` |

**P-3b.2 (webhook)**

| File | Action | Reason |
|---|---|---|
| `lib/business-os/billing/planBillingHandler.ts`, `planPaymentApply.ts`, `planInvoiceFacts.ts`, `planCheckoutSessionEvents.ts`, `planSubscriptionMirror.ts` + tests | create | §3.1 |
| `lib/business-os/billing/planInvoiceResolver.ts` + test | modify | §3.6 (truncation fetch, sessions, subscriptions). Header table updated |
| `lib/repositories/BusinessOsBillingAccountRepository.ts` + test | modify | Five methods (§3.1, §3.5) |
| `lib/stripe/StripeService.ts` + test | modify | Three read methods |
| `app/api/stripe/webhook/route.ts` | modify | One handler registration + import |
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts`, the billing repository ALLOWED list | modify | New callers |
| `lib/business-os/billing/__tests__/fixtures/stripe/*.json` | add / replace | Session, subscription, renewal, $0 trial fixtures; captured ones per Q-9 |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | §9.1 P-3b status, §9.3 20261027 row, §9.4 CF-2 closed, Change History (both PRs) |
| `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` | modify | Billing tab: what P-3b shows |

No new feature flag: the handler is reachable only where `BUSINESS_OS_PLAN_PRICES_ENABLED` is on.

---

## 6. Gates

| # | Gate | Blocks | Owner | State |
|---|---|---|---|---|
| G-1 | 20261027 is free on main and in open PRs | Workplan | Dev | ✅ 2026-10-07 (§4) |
| G-2 | 20261027 **applied to production** with checker VERDICT PASS (+ probe VERDICT PASS) | **P-3b.2 merge** (its code calls the function; the switch being off is not a reason to ship a call to a missing function) | User (paste) / Dev (record) | ⬜ After P-3b.1 merges |
| G-3 | Connect characterisation snapshot byte-identical before/after (SR-10) | P-3b.2 hand-over | Dev | ⬜ |
| G-4 | `npm run test:bos-entitlements` green (SR-17) | Each hand-over | Dev | ⬜ |
| G-5 | The sandbox → production forwarding link during the demo (P-3a G-5, still open) | Demo | User | ⬜ Decision owed (§9 step 0) |
| G-6 | Endpoint API version / key-prefix look (P-3a G-4) | **Not** this code. It gates turning the price switch on in a shared environment | User + Offir | ⬜ Kept open by the user |

---

## 7. Task List

**P-3b.1: money history, apply function, `recordPlanChange` (inert)**

- [x] **T0** Branch confirmed (`feature/bos-plan-payments-p3b`). The live schema check was **not** run by Dev (no SQL against a real database in this session); the pre-check carries it instead: P7 and P8 compare the live billing and plan columns the function names, with their types, and the `service_role` grants it needs. The user runs it before the migration
- [x] **T1** Migration 20261027 (§4.1, §4.2), paste rules applied; C-1, C-2, C-3, C-4 built in
- [x] **T2** Migration static test (`supabase/migrations/__tests__/business-os-billing-events.migration.test.ts`, 111 tests)
- [x] **T3** Pre-check, checker, probe (P00 to P15) and rollback scripts
- [x] **T4** `BusinessOsBillingEventRepository` + tests (`new-repository`); not barrel-exported (see notes)
- [x] **T5** Registrations: purge descriptor, baseline (147 to 148), deletion policy, business-owned tables, cleanup generator (G-5 now also counts live money-history rows) and the regenerated cleanup SQL
- [x] **T6** `planWriteChecks.ts` extracted; the 77 existing `adminOps` tests passed **unedited** right after the move
- [x] **T7** `recordPlanChange.ts` + tests (order, actor, 2 s bound, never throws)
- [x] **T8** Admin route onto `recordPlanChange`; `routes.test.ts` **unedited and green (88/88)** with the refactor alone
- [x] **T9** PF-13 in `adminOps.ts` (both ops, `billing_read_failed`) + 12 new `adminOps` cases. Route wiring needed one additive mock in `routes.test.ts`; SA approved it (C-8 ruling), see notes item 1
- [x] **T10** Audit events `BOS_BILLING_INVOICE_PAID`, `BOS_BILLING_PAYMENT_REFUSED` (events, metadata, audience, count pin)
- [x] **T11** Entitlements registrations; `npm run test:bos-entitlements` green (202 suites, 5430 tests) before the route wiring of T9
- [x] **T12** Docs: ENTITLEMENTS § Billing subsection; requirement SA-P3 / SA-P5 / C-5 amendments, §9.1, §9.3, CF-6, Change History (C-7)
- [x] **T13** Jest, eslint, scoped tsc; `git diff --stat` checked. Handed to TL (not SA) because of the C-8 stop

**P-3b.2: webhook plan handler**

- [ ] **T14** G-2 recorded (20261027 applied, checker + probe VERDICT PASS)
- [ ] **T15** Connect harness "before" run recorded (snapshot hash)
- [ ] **T16** StripeService: three read methods + tests (pagination, no writes)
- [ ] **T17** Billing account repository: five methods + tests (no `.select()` on updates, `count: 'exact'`, allow-lists, documented no-`user_id` lookups)
- [ ] **T18** `planInvoiceFacts.ts` (pure) + tests incl. proration, $0, discount, non-USD, mixed tiers
- [ ] **T19** Resolver: truncation fetch (CF-2), sessions, subscriptions, switch-off byte-identity + tests
- [ ] **T20** `planPaymentApply.ts` (paid + failed) + tests (§8 C-6 list through a fake repository)
- [ ] **T21** `planCheckoutSessionEvents.ts` + `planSubscriptionMirror.ts` + tests
- [ ] **T22** `planBillingHandler.ts`; route registration; guard lists updated
- [ ] **T23** Connect harness "after": byte-identical (G-3); webhook guard suites green
- [ ] **T24** Fixtures: hand-built additions now; captured ones from the demo per Q-9
- [ ] **T25** Jest, `test:bos-entitlements`, eslint, scoped tsc; `git diff --stat`; hand-over to SA code review
- [ ] **T26** Local demo (§9), after QA; evidence recorded; sandbox subscription cancelled the same day
- [ ] **T27** Docs: requirement §9.1 / §9.4 CF-2 / Change History; TEST_PAGE_SCOPE

**28 tasks: 14 in P-3b.1 (T0–T13), 14 in P-3b.2 (T14–T27).**

---

### P-3b.1 implementation notes (Dev, 2026-10-07)

**1. C-8 stop: `routes.test.ts` cannot stay unedited once PF-13 is wired.** The refactor onto `recordPlanChange` passes the suite unedited (88/88). The PF-13 billing read does not: `set_cohort` and `assign_tier` now read the billing record before writing, the suite mocks every repository the route uses **except** `BusinessOsBillingAccountRepository`, so the real one is called, fails (no database in Jest), and the op is refused `500 billing_read_failed`, exactly as Q-6 requires. 8 tests fail (the T11b.1 pin among them). No design reaches a fail-closed PF-13 without the suite knowing about the billing read. **Proposed edit for SA (additive, no existing line changed):** one `jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', ...)` block answering `findByUser` with `{ data: null, error: null }` (no subscription). Proven on a temporary copy of the suite (deleted afterwards): 88/88 green, the T11b.1 pin byte-identical. Alternative if SA wants the suite untouched: gate the read on something the suite already fakes, which weakens fail-closed and is not recommended. The tree is left with the wiring in place and those 8 tests red, so the decision stays visible.

**2. "Subscribed" reads both Stripe modes.** `hasLivePlanSubscription` (in `lib/business-os/purge/adminDeletionFacts.ts`, next to deletion's R-3 read, which it reuses with `isPlanSubscriptionLive`) answers true when either the test-mode or the live-mode billing row is live. §3.4 said "the current mode's billing row". Both modes, because test and live rows share the database and a test-mode subscription re-asserts the same plan row, and so the answer never depends on whether this deployment holds a Stripe key (a missing key would otherwise make every `assign_tier` / `set_cohort` a 500 wherever no key is set). For SA to confirm.

**3. Function statuses.** C-2's early return for a known event id answers `already_recorded`, not `already_applied`, so P-3b.2 can tell "this invoice was applied" from "this event was a refusal". Nine statuses in total, pinned by the static test and mapped by the repository.

**4. The word "into" (Q-12, C-5).** All five files use it only as `INSERT INTO`: no `SELECT ... INTO`, no `RETURNING ... INTO`. Values are read with `v_x := (SELECT ...)`, rows are locked with `PERFORM ... FOR UPDATE`, the inserted id is generated first (`gen_random_uuid()`), and `GET DIAGNOSTICS` reports the refusal insert. The static test pins it.

**5. Executed locally, not only read.** The migration, pre-check, checker, probe and rollback were run against a local PGlite (PostgreSQL 16.4, installed in the session scratchpad, not in the repo) with stub roles (`service_role` with BYPASSRLS), `auth.users` and the plan table: pre-check VERDICT PASS before the migration (FAIL after, as designed); checker VERDICT PASS 16/0, and FAIL on four sabotages (UPDATE granted, EXECUTE to `authenticated`, a CHECK dropped, the partial index dropped); probe **PROBE PASS P01 to P15**, with and without an existing test-mode billing row, nothing left behind; five mutations of the function (the newest rule, the anchor filter, the C-2 early return, the C-1 check, `GREATEST`) each turn the probe to PROBE FAIL; the rollback drops both objects, and refuses with a live-mode row present. Not a substitute for the production run (G-2).

**6. Smaller decisions.** One extra CHECK, `plan_written_needs_payment` (`plan_written` only on `invoice_paid`). The repository is not exported from `lib/repositories/index.ts`: like the billing account repository, a source guard lists every file allowed to name it, and a barrel export would defeat it. `logAndFlush` gained an optional fourth argument (the audit sink, default the singleton) so `recordPlanChange` writes through `AuditTrailService.getInstance()`, the instance the route always used and the suite pins; same chain, same 2 s bound. On a replacement the function leaves `cancel_at_period_end` alone (not in the §3.2 contract; the P-3b.2 mirror sets it).

**7. Carry-forwards.** SA C-3 is requirement §9.4 **CF-6** (owner P-4): a $0 `subscription_update` invoice paid from the Stripe credit balance never switches the tier under the current assigns-plan rule. C-6 (captured `2025-09-30.clover` fixtures) belongs to P-3b.2.

**Paste order for the user (G-2, before P-3b.1 merges):** 1. `scripts/precheck-bos-billing-events-migration.sql` (VERDICT PASS; it leaves the tab read-only), 2. in a **new tab** `supabase/migrations/20261027_business_os_billing_events.sql`, 3. `scripts/check-bos-billing-events-migration.sql` (VERDICT PASS), 4. `scripts/probe-bos-apply-plan-payment.sql` with your own **test** account id pasted in (expect the error "PROBE PASS ... rolls everything back"). Rollback, only if needed: `supabase/SQL Scripts/20261027_business_os_billing_events_rollback.sql`.

**Then the cleanup function (20261042, after 20261027, before P-3b.1 merges and deploys).** P-3b.1 adds `business_os_billing_events` to the test-account cleanup plan (Danger Zone, PR #249), and that plan is compiled into the database function `operator_test_account_cleanup`. Its migration 20261041 is applied and never edited, so the generator now writes **`supabase/migrations/20261042_operator_test_account_cleanup_billing_events.sql`** (`CREATE OR REPLACE` of the function only; the schema, the secret table and the stored hash stay). 5. Paste 20261042 in a new tab. It refuses with "Apply ... first" and applies nothing unless 20261041 and 20261027 are already in place. 6. Run the version query in the [cleanup runbook](/docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md) §6.1.1: `applied_version` must equal `CLEANUP_FUNCTION_VERSION` in `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` and `knows_billing_events` must be true; then the lock check §6.5 (`false, false, true, false`). Why before the deploy: the app pins the function's version stamp, so between the deploy and the apply the Danger Zone check and delete refuse (fail closed, nothing removed); applied first, only the current build's Danger Zone refuses until P-3b.1 deploys. Rollback, only if needed: `supabase/SQL Scripts/20261042_operator_test_account_cleanup_billing_events_rollback.sql` (restores the 20261041 function, keeps the secret).

---

## 8. Tests

**Required C-6 cases** (SA-P2, SA-P16). Each is pinned twice: in Jest through `planPaymentApply` with a fake repository that models the function's rules, and in SQL by the probe (§4.4), because Jest cannot run the function.

| # | Case | Expected |
|---|---|---|
| C6-1 | **Replay**: the same `invoice.paid` twice; then a different event id for the same invoice | `already_applied` both times; one history row; plan, anchor and audit written once |
| C6-2 | **Out-of-order renewal**: renewal for period N+1 applied, then N delivered late | N is recorded with `plan_written = false`; `tier_expires_at` stays at N+1's end; the anchor does not move |
| C6-3 | **Upgrade**: a proration invoice (basic credit line, pro charge line), same period end, later `paid_at` | Tier `pro`, `tier_expires_at` unchanged, anchor unchanged, `plan_version` = current. A late replay of the earlier basic invoice → `already_applied` (or `recorded` if it is a new invoice); never a downgrade |
| C6-4 | **Re-buy after pause**: the row holds an ended subscription; a new subscription's first invoice | Stripe says the old one is `canceled` → replacement: anchor = new `billing_cycle_anchor`, subscription id replaced, `ended_at` cleared, tier written |
| C6-4b | Re-buy while the old subscription is **live** at Stripe | `mismatch_refused` (`second_subscription`), alert, no plan write (SA-P14 layer 2) |
| C6-5 | **$0 trial invoice** (`trial_end` subscription) | History row, `plan_written = false`, no tier, no anchor. The next non-zero invoice writes the tier **and** sets the anchor |
| C6-6 | **Admin change on a subscribed account** | `assign_tier` keeps `period_anchor` (PF-13), and the change lasts until the next paid invoice re-asserts the bought tier (SA-P16b). On an unsubscribed account the anchor still resets (unchanged behaviour). Billing read failure → `billing_read_failed` |
| C6-7 | First buy from trial | Tier written, `cohort` untouched, anchor = `billing_cycle_anchor`, `tier_expires_at` = line period end, `updated_by_admin_id` NULL |

**Other suites**

| Suite | Cases |
|---|---|
| Migration static test | Paste rules (no `--`, punctuation-free literals, "into" only as the keyword), one transaction, the table's columns in order, every CHECK, the indexes incl. the partial UNIQUE, RLS on, no policy, the four REVOKEs before the GRANTs, `service_role` SELECT and INSERT only, the function `SECURITY INVOKER` with an empty `search_path`, EXECUTE for `service_role` only, **no `business_os_account_lineage`**, the repository's mapped columns equal the migration's |
| `planInvoiceFacts.test.ts` | Basil and legacy line shapes; proration picks the positive tier; mixed positive tiers refused; $0; 100% discount on `subscription_cycle`; `total_taxes` sum; non-USD; missing `paid_at` → refused as malformed |
| `planPaymentApply.test.ts` | C-6 list; PF-15 mode mismatch → nothing written; unknown customer → refusal row with `user_id` NULL; metadata mismatch; tier not configured; `plan_row_missing` → throws (Q-3); Stripe retrieve error → throws; audit only on `applied` / `recorded`; `recordPlanChange` called after the function and before return; `payment_failed` → one history row, no plan or billing write |
| `planInvoiceResolver.test.ts` | Switch off: every new branch returns today's outcome with **zero** Stripe calls. Switch on: truncated recognised invoice fetched → `flow`; fetch error → throws; sessions and subscriptions recognised by price, never by metadata; mixed → deny |
| Session / mirror tests | Link + clear on the matching session; replay count 0 → no-op; another session's lock not cleared; row with another subscription → lock cleared, link left; expired clears only its own lock; mirror reads fresh and writes the three columns; deleted sets `ended_at`, so `isPlanSubscriptionLive` turns false |
| Repository tests | Each new method: filter chain, allow-list, `count: 'exact'`, **no `.select()` after `.update()`** (source assertion), invalid ids refused before the query |
| `recordPlanChange.test.ts` | Invalidate → log → flush order; system actor = `platformActorId()`, `details.actor`; never throws on audit failure; no invalidate when told not to |
| Admin route | `routes.test.ts` unedited except the one SA-approved mock (C-8 ruling) and green; order test |
| Webhook | Connect characterisation snapshot identical; `routerPlacement`, `pinoLogging`, `routerEdgeCases` suites green; handler registered for `plan` only |
| Entitlements | `npm run test:bos-entitlements` |

Coverage rule (CLAUDE.md): no new API route; each new repository method has unit tests.

---

## 9. Local Demo Plan

**Where:** the developer's machine, as P-3a §8: this worktree, the main checkout's `.env.local` copied in (never committed, never on Vercel), with both switches on locally, the **sandbox** key (`acct_1SMy0N56GTXD0wwi`) and the Stripe CLI's `whsec_`. P-3a's own demo (T16) was never run, so this demo covers both.

**What is written, honestly.** There is one Supabase project, so the local server writes to the production database (PF-15, designated test account, all rows `livemode = false`). Written: the test account's billing row, its plan row (tier, expiry, anchor), money-history rows, audit rows and claim rows. Undo: the plan row via the admin Tiers page (assign tier null / reset). The history rows stay: they are append-only test-mode records.

| Step | Action | Expected |
|---|---|---|
| 0 | **G-5, the user's choice (business terms):** while the sandbox → production link stays on, the demo raises false alarms in production's log, and nothing is charged or changed for any customer. With P-3b these are the `metadata_mismatch` alert for the invoice (as P-3a), and the "No user_id" lines for the subscription events. **If production's price switch were on, production would also process the same events against the same database.** The result would be the same, because the function is idempotent by invoice id and the session and mirror writes are compare-and-set. The switch stays off | Choice and time recorded |
| 1 | `check-bos-plan-prices` on the sandbox | VERDICT PASS |
| 2 | `stripe listen --forward-to localhost:3000/api/stripe/webhook`; `npm run dev`; sign in as the designated **trial** test account (not held) | — |
| 3 | `/test-business-os` → Billing → first tier → Start checkout → pay with `4242 4242 4242 4242` | `checkout.session.completed` → lock cleared, subscription linked (log `bos_billing_checkout_linked`). `invoice.paid` → `applied` |
| 4 | Admin Tiers page and `/api/business-os/entitlements/my-plan` | Plan **Essentials (`basic`)**. Paid-through = Stripe's period end. `period_anchor` = the subscription's `billing_cycle_anchor`, so the credit card's period starts on the billing date. Cohort `trial` still recorded |
| 5 | Data (read-only SQL, given in the evidence log) | One `invoice_paid` row (`plan_written = true`, $79.00 USD, `livemode = false`). Billing row: subscription id, `active`, `current_period_end`, `last_paid_at`, no lock. Audit `BOS_BILLING_INVOICE_PAID`, actor = platform, `details.actor = stripe_webhook` |
| 6 | `stripe events resend <invoice.paid evt id>` | `already_applied`; no new row; no second audit entry |
| 7 | Start checkout again | 409 `subscription_live` (from the record now, not only from Stripe's list) |
| 8 | **Cleanup, the same day (P-3a C-5):** cancel the subscription in the sandbox dashboard, immediately | `customer.subscription.deleted` → mirror: `canceled`, `ended_at` set; the plan row keeps `basic` until its paid-through date (cancel at period end semantics; access is the plan row's, Q-T9). Stop the CLI, restore the secret, remove the switches |
| 9 | Fixtures (Q-9) | The CLI-forwarded payloads saved as captured fixtures with their real `api_version` |

**Demo evidence (to fill in):** G-5 choice; VERDICT; session, subscription, invoice and event ids; responses; SQL results; production alert time; cancellation time.

---

## 10. Sizing and Split

| Part | Work | Days |
|---|---|---|
| P-3b.1 | Migration + static test + 4 scripts (0.75), event repository (0.25), registrations (0.25), `planWriteChecks` + `recordPlanChange` + admin refactor + proof (0.5), PF-13 (0.25), audit + docs (0.25) | **≈ 2.25** |
| P-3b.2 | Stripe reads + repository methods (0.5), facts + resolver (0.75), apply use case + C-6 tests (0.75), sessions + mirror (0.5), handler + harness + guards (0.25), demo + fixtures + docs (0.5) | **≈ 3.25** |
| **Total** | | **≈ 5.5** |

Over the 3-day ceiling, so it is **split into two PRs, in order, never stacked**: P-3b.1 merges first and the user applies 20261027 (G-2), then P-3b.2 is cut from the new `main`. P-3b.1 is reviewable on its own: the money history, the function contract and the admin refactor's no-change proof. P-3b.2 is where the demo happens. If SA drops the subscription mirror (Q-1 option B), P-3b.2 falls to about 2.75 days.

---

## 11. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | The price switch turned on in production before G-6 and the §9.5 rows | Low | Real money applied on an unchecked endpoint | Switch default off; FEATURE_FLAGS rule; §9.5 row 7 |
| R-2 | A paid invoice not applied (missing plan row, Stripe outage) | Low | Customer paid, no plan | Throw → released → Stripe retries for 3 days; `error` + `alert`; P-8b's reconciler re-applies by invoice id |
| R-3 | Double apply via webhook + reconciler, or local + production | Low | Two history rows, two audits | Partial UNIQUE on the invoice id; `already_applied` |
| R-4 | Anchor moved by a renewal or admin op | Low | Credit period out of step with billing | Step 7 rule; PF-13; C-6 tests + probe |
| R-5 | Upgrade replay downgrades | Low | Wrong tier | Billing-row ordering (step 6), positive-line tier; C6-3 |
| R-6 | Held friend pays before P-5 and stays held | Only with both switches on | Paid but locked out | Both off in production until go-live (after P-5); not demoed with a held account |
| R-7 | PostgREST UPDATE + `.or()` + `.select()` 42703 | Would be High | Session/mirror writes fail in production | No `.or()`, no `.select()`, `count: 'exact'`; source test |
| R-8 | Merge conflict with CF-5 webhook PRs or boost slice 4 in `route.ts` | Medium | Rework | P-3b touches one line of `route.ts`; the handler map is the agreed seam (§9.4) |
| R-9 | Admin refactor changes audit rows | Low | Lost or altered history | `routes.test.ts` unedited except the one SA-approved mock (C-8 ruling), T11b.1 pin byte-identical; order test |
| R-10 | SQL editor rejects a paste ("into", punctuation) | Medium | Apply blocked | Static test of paste rules; pre-check first |
| R-11 | Clover `09-30` vs `10-29` difference in a field P-3b reads | Low | Wrong fact parsed | Q-9; fixtures from the demo |

---

## 12. Rollback

| What | How |
|---|---|
| P-3b.2 code | Revert the PR. With the switch off, nothing changes in production either way |
| P-3b.1 code | Revert the PR. The admin route returns to its inline audit; the anchor rule reverts (no subscribed account exists) |
| Migration 20261027 | `supabase/SQL Scripts/20261027_business_os_billing_events_rollback.sql`: refuses if any live-mode row exists; drops the function, then the table. Only after P-3b.2 is reverted, or the webhook would throw (released, retried) on a recognised invoice |
| Demo data | Plan row via the admin Tiers page; sandbox subscription cancelled; history rows stay (test mode, append-only) |

---

## 13. Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | Mirror `customer.subscription.updated` / `.deleted` in P-3b, or defer it all to P-6a? | **A (recommended): in P-3b, status-only, read fresh from Stripe.** Once P-3b links a subscription, `isPlanSubscriptionLive` says live until `ended_at` is set, so without the mirror a cancelled test account can be neither deleted (R-3) nor rebuy (P-3a layer 1). It also stops the legacy "No user_id" error lines for Business OS subscriptions. B: defer, and accept both until P-6a |
| Q-2 | `invoice.payment_failed` on a plan price, now that a handler exists | One `invoice_payment_failed` history row, a `warn`, the claim completed. No billing-row counters (P-6a). The alternative of throwing makes Stripe retry it for 3 days for nothing |
| Q-3 | A paid invoice for an account with **no plan row** | Throw (release, retry), with `error` + `alert`. An admin can `ensure_plan_row` within Stripe's 3 days, and P-8b re-applies later. P-3a refuses checkout without a plan row, so this needs a deleted row |
| Q-4 | The system actor: `AuditTrailService` turns a missing `actorId` into the owner | Pass `platformActorId()` (the D-3 convention), plus `details.actor = 'stripe_webhook'`. Not a change to `AuditTrailService` |
| Q-5 | `recordPlanChange` uses the bounded `logAndFlush` (2 s), not the admin route's raw `flush()` | Yes. It is the only behaviour difference for the admin route (a hung flush returns after 2 s), and it matches P-3a and the `new-api-route` follow-up |
| Q-6 | PF-13 details: (a) billing read failure on `assign_tier`, (b) `setCohort` also resets the anchor (l. 426) | (a) Refuse `500 billing_read_failed` (fail closed). (b) Apply the same rule: on a subscribed account the cohort change keeps the anchor |
| Q-7 | `tier_expires_at`: SA-P3 says `GREATEST(existing, period_end)` | Write the period end verbatim when the invoice is the newest **by the billing row's Stripe facts** (period end, then `paid_at`). Against the plan row, `GREATEST` would let a longer admin end date outlive a payment (F4: "the payment is the newer fact") |
| Q-8 | `plan_version` on renewal | Kept on a same-tier renewal (grandfathering), set to the current matrix version only when the tier changes or none is in force |
| Q-9 | C-8 fixtures and the clover version | Capture the demo's CLI payloads as fixtures labelled with their real `api_version` (likely `2025-09-30.clover`). SA extends the P2b-Q2 ruling to the §3.7 field list. Hand-built fixtures fill the gaps (renewal, $0 trial) until the account default moves to `10-29` |
| Q-10 | Four columns beyond SA-P5's shape: `stripe_customer_id`, `plan_written`, `refusal_reason`, `paid_at` (C-5 says "exactly as SA-P5") | Add them: the anchor rule needs `plan_written`, an unknown-customer refusal needs the customer id, and `paid_at` is the ordering key and P-7a's date |
| Q-11 | Idempotency key: SA-P3 says UNIQUE on the event id | Keep the event-id UNIQUE, and add a partial UNIQUE on the invoice id for `invoice_paid`. The function checks by invoice, so P-8b's reconciler (no event id) cannot double-record |
| Q-12 | The SQL keyword INTO in the function body | Allowed as a keyword only (`INSERT INTO`; `SELECT … INTO` where an assignment is awkward), with precedent in 20261031 and 20261017, both applied. Never in a literal or a comment. The static test pins it |
| Q-13 | The split | P-3b.1 (inert) then P-3b.2, sequential PRs; G-2 (20261027 applied) gates P-3b.2's merge |

---

## SA Review Notes

_SA populates this section._

**Reviewed by SA — 2026-10-07**
**Status:** ✅ Approved with conditions (C-1 to C-8 below). Dev may implement P-3b.1.

### Rulings on Q-1 to Q-13

1. **Q-1** — A approved: status-only mirror, read fresh from Stripe, no plan write, no history, no audit. Recognised by item price only.
2. **Q-2** — Approved: one `invoice_payment_failed` row, `warn`, claim completed. The same mode / account / metadata checks as `invoice.paid` apply first. An event-id duplicate counts as done.
3. **Q-3** — Approved: throw, `error` + `alert`. The probe and Jest both pin that nothing is written.
4. **Q-4** — Approved: `platformActorId()` + `details.actor = 'stripe_webhook'`. Never a null actor.
5. **Q-5** — Approved. This is the only behaviour change to the admin route.
6. **Q-6** — (a) Approved: fail closed `500 billing_read_failed`, standard error format, no details in production. (b) Approved: `setCohort` follows the same rule.
7. **Q-7** — Approved: write verbatim when newest by the billing row's facts. This supersedes SA-P3's `GREATEST`. Consequence for the user (F4, already the business rule): on a subscribed account, an admin-extended paid-through date is cut back to Stripe's date at the next payment.
8. **Q-8** — Approved.
9. **Q-9** — Approved conditionally. I could not diff `2025-09-30.clover` against `2025-10-29.clover` offline, so the extension of P2b-Q2 holds only once proven (C-6).
10. **Q-10** — The four columns are approved. C-5 / SA-P5 are amended.
11. **Q-11** — Approved: event-id UNIQUE plus a partial UNIQUE on the invoice id.
12. **Q-12** — Approved: INTO is allowed as a keyword only (precedent 20261031 l. 56/113/216/406). See C-5.
13. **Q-13** — Split approved. **20261027 is applied (checker + probe VERDICT PASS) before P-3b.1 merges**, after SA code approval, as 20261031 was before #235. P-3b.1 ships the repository and registers the table in the purge, deletion and cleanup registries, and those must never name a missing table. G-2 moves accordingly.

### Conditions

- **C-1 Step 10 clash.** Detect `subscription_held_elsewhere` by a SELECT **before** any write, or wrap steps 8–10 in an EXCEPTION sub-block, so that the plan row and the `invoice_paid` row are never left half-written. Add a probe case.
- **C-2 Event-id reuse.** Step 3 also returns early when any row already holds `p_stripe_event_id`. Otherwise a refused event that is resent later (for example after the old subscription ends) hits the UNIQUE at step 8, returns 500 and loops. Pin it in the probe and in Jest.
- **C-3** `bought_tier` is written only when `plan_written`. Carry-forward to P-4: a $0 `subscription_update` invoice paid from the customer's credit balance never switches the tier under the current assigns-plan rule.
- **C-4** With `search_path = ''`, every relation is `public.`-qualified. The static test pins this.
- **C-5** The paste-rule static test covers all five SQL files, including the RAISE messages and the COMMENT ON strings.
- **C-6** Every §3.7 field is asserted present in the captured `2025-09-30.clover` fixtures before P-3b.2 is handed over. A missing field reopens Q-9.
- **C-7** The rulings above are spliced into the requirement: the SA-P3 amendment (Q-7, Q-11), the C-5 amendment (Q-10) and the §9.1 gate.
- **C-8** `routes.test.ts` stays unedited. If it has to change, stop and return to SA.

Tenant isolation is acceptable. `p_user_id` always comes from our own row, which is found by a UNIQUE Stripe id + `livemode`. The function re-locks the row by `user_id` and re-checks the customer and the subscription. Metadata never selects the account.

### Approval
[x] Workplan approved — proceed to P-3b.1 implementation, subject to C-1 to C-8

### C-8 ruling + Code Review — P-3b.1

**Code Review by SA — 2026-10-07**
**Status:** 🔄 Fix Required (APPROVED WITH FIXES: small, listed below; no re-design)

**C-8 ruling.** C-8 existed to protect the T11b.1 byte-for-byte pin, not to freeze the suite against a new dependency. The additive mock is **approved**: exactly one `jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', ...)` block, `findByUser` → `{ data: null, error: null }`, with a comment citing this ruling. `git diff` of `routes.test.ts` must show added lines only, and the T11b.1 pin must be unchanged. The alternative (skipping the read on some condition) is rejected: it weakens Q-6's fail-closed rule.

**Rulings on the five decisions**
1. C-8: as above.
2. Reading both modes is **approved**. Production gets test-mode rows only for test accounts, and a deployment with no Stripe key must not 500. Placing `hasLivePlanSubscription` in `adminDeletionFacts.ts` is acceptable: there is one definition of "subscribed", and `adminOps.ts` sees only the `PlanSubscriptionReader` port. The cost is that the entitlements route now loads the purge facts module. Move it to `lib/business-os/billing/` once P-3b.2 adds a second caller (optimisation).
3. `already_recorded` and nine statuses: **approved**.
4. The optional `logAndFlush` sink: **approved**. Same chain, same bound, and the same singleton in production.
5. `plan_written_needs_payment` and the repository being left out of the barrel (source guard) are **approved**. Leaving `cancel_at_period_end` alone on a replacement is **not**: see F-1.

**Verified.** SECURITY INVOKER, `search_path=''`, every relation `public.`-qualified, EXECUTE for `service_role` only. The billing row is locked first and the plan row second, both by `user_id` (no lock cycle with the admin route or the mirror). The idempotency order follows C-2. C-1 is a pre-write SELECT, and a concurrent UNIQUE race aborts the whole transaction. "Newest" comes from the billing row. The anchor is set only on the first plan-writing `invoice_paid` of the subscription. Cohort and lineage are never touched. Q-7 writes the period end verbatim. The grants on 20261025 and 20261009 cover every column the function writes. `into` appears only as `INSERT INTO`. The cleanup SQL drift and double-render test passes (62/62), and the renumbering is an ordinal shift. Audit, purge, deletion and entitlements registrations are correct, and C-7 is spliced. Jest: 10466 pass, with exactly the 8 expected C-8 failures. `test:bos-entitlements` shows the same 8.

**PGlite 16.4 vs prod 17.4.** PGlite does not reproduce Supabase's default grants (covered by the explicit REVOKEs), MAINTAIN (the checker reads it through aclexplode, so it is safe on both) or concurrency. The G-2 prod checker and probe run remains the proof.

### Code Review Comments
1. **F-1** `20261027…sql:274-283`: on a replacement, set `cancel_at_period_end = false`. A new subscription cannot inherit the old one's flag, and once the file is pasted, a fix needs a new migration. Update the checker md5 and add a probe assertion. Priority: Medium
2. **F-2** Add the C-8 mock as ruled. Priority: High
3. **F-3** `recordPlanChange.ts:12`, `route.ts:267`, the workplan status line, §3.4 ("current mode" → both modes) and the Change History (workplan and requirement) all say "unedited". Change them to "unedited except the one SA-approved mock (C-8 ruling)". Priority: Low

### Optimisation Suggestions
- Carry-forward to P-6a: on a replacement, `failed_attempts`, `last_payment_failed_at`, `action_required_invoice_url` and `pending_tier` stay stale.
- Move `hasLivePlanSubscription` in P-3b.2 (ruling 2).

### Code Approved for QA: Yes, after F-1 to F-3 (Dev re-runs the same Jest scope, expecting 0 failures, plus PGlite for F-1). No SA re-review needed unless the diff goes beyond F-1 to F-3.

---

## QA Testing Report

**QA — 2026-10-07 (P-3b.1, inert slice; SA-approved after F-1 to F-3)**
**Test mode:** full
**Strategy used:** A + B (Jest, mocked Supabase) for routes, adminOps, recordPlanChange, repository, registrations; C (independent PGlite 0.2.17 / PostgreSQL 16 harness) for the SQL; TS mutation spot-checks.
**Focus:** api, schema, security
**Skipped:** real DB, Stripe, browser (inert slice: no caller, no UI)
**Input source:** prompt keywords

### Test Coverage
| Area | Tested? | Result | Notes |
|---|---|---|---|
| Admin route unchanged for unsubscribed accounts | ✅ | Pass | `routes.test.ts` diff is the one additive billing-repository mock only (one hunk); suite green, T11b.1 byte-for-byte audit pin unchanged |
| PF-13 anchor kept on subscribed account, either mode | ✅ | Pass | adminOps PF-13 block green. QA also ran a throwaway route-level suite through the REAL route and REAL `hasLivePlanSubscription` adapter (10/10): test-mode only / live-mode only subscribed keeps the anchor for assign_tier and set_cohort; no rows or an ended subscription resets it |
| Billing read failure, fail closed | ✅ | Pass | Either mode unreadable (incl. subscribed + other mode unreadable) = 500 `billing_read_failed`, no `updatePlan`, no audit; credit ops never read billing |
| recordPlanChange: same entry, order, 2 s bound, invalidation, never throws | ✅ | Pass | 10 cases green; route pin proves the admin entry is identical |
| Money-history repository: append-only, user_id written, validation | ✅ | Pass | No update/delete method; explicit insert allow-list; `invoice_paid` not recordable; strict RPC result mapping |
| SQL precheck | ✅ | Pass | Before: PASS 10/0. After migration: FAIL (P1, P2, P3) |
| SQL checker | ✅ | Pass | PASS 16/0. QA's own 10 sabotages each FAIL on the right check: anon SELECT (50), column grant to authenticated (50), policy (11), service_role DELETE (60, 70), FK CASCADE (31), SECURITY DEFINER (80), RLS off (10), kind CHECK loosened (32), trigger (12), function body tampered (83, md5) |
| SQL probe P01–P15 | ✅ | Pass | All 15 PASS incl. P12 (F-1 cancel flag cleared on replacement); plan, billing and events byte-identical after; also PASS on an account with an existing canceled test billing row; guards fire for a live-mode billing row, a read-only session and the unedited placeholder |
| Rollback | ✅ | Pass | Test-only rows: table and function dropped. With a live-mode row: `ROLLBACK REFUSED`, nothing dropped |
| Paste rules | ✅ | Pass | Scripted scan of all 5 SQL files: no `--`, no block comments, no punctuation in any string literal (RAISE and COMMENT included), "into" only as INSERT INTO, ASCII only |
| Registrations | ✅ | Pass | Purge baseline/descriptor (`never`), deletion policy (`minimise`), businessOwnedTables, both audit events registered (info / warning, SOC2) with audience tests; cleanup SQL drift + determinism test 62/62 |

The SQL harness was built independently of Dev's: base tables come from the REAL migrations 20261005, 20261009 and 20261025 (with stubs for `auth.users`, `onboarding_conversations` and `business_profiles`), not from a hand-written plan table.

### Mutation spot-checks (TS; each file copied, mutated, restored, verified identical with a byte compare)
| Mutation | Result |
|---|---|
| M1 a failed billing read (`null`) treated as unsubscribed | Killed (2 failed) |
| M2 subscribed check removed, so the anchor always resets | Killed (3) |
| M3 bounded `logAndFlush` replaced by a raw log and flush | Killed (2) |
| M4 `recordEvent` writes without `user_id` | Killed (3) |
| M5 cache invalidation dropped | Killed (5) |
| M6 `hasLivePlanSubscription` reads test mode only | **Survived** the Dev suites (killed only by QA's throwaway route suite) |

### Issues Found

#### Bugs (must fix before commit)
1. **Test gap: the "either Stripe mode" rule of `hasLivePlanSubscription` is untested.** File: `lib/business-os/purge/adminDeletionFacts.ts`. Severity: Low (the code is correct today). adminOps tests only the port, and `routes.test.ts` mocks the billing repository as "no row". So a regression that ignores live mode (M6) passes CI and would let an admin change move the anchor on a live-subscribed account. Fix: add a unit test (test-only, live-only, ended, either read unreadable gives `null`). Put it outside `app/api/admin/.../__tests__`. A copy of the route mocks there trips three repository source guards (see the Edge Cases section).

#### Performance Issues
None. PF-13 adds two indexed billing reads (in parallel) to assign_tier and set_cohort only.

#### Edge Cases (nice to fix)
1. `recordEvent` accepts `accountId: null` for any kind. The header says null is only for `unknown_customer`, but validation does not enforce that. P-3b.2 should hold the line, or the repository should check it.
2. The precheck VERDICT detail always says "run the migration in a NEW tab", even when the verdict is FAIL.
3. Any new test file that names the plan, credit-lot or billing repositories trips the RC-15 / G3 / billing source guards. A route-level PF-13 test therefore needs its allow-list entries.

### Test Outputs / Logs
```
npx jest lib/business-os lib/repositories app/api/admin supabase/migrations/__tests__ lib/audit --ci
Test Suites: 455 passed, 455 total   Tests: 28 skipped, 10475 passed
npm run test:bos-entitlements  ->  Test Suites: 202 passed   Tests: 5443 passed
npx jest scripts/__tests__/testAccountCleanupSql.test.ts  ->  62 passed
PGlite: PRECHECK before PASS 10/0, after FAIL 10,20,30 | CHECKER PASS 16 pass 0 fail | PROBE PASS P01..P15, rows unchanged | ROLLBACK refused with live row
```

### Only production can prove
- That the precheck passes on the real schema: no name clashes, and the real column privileges and default privileges in `public`.
- That the checker passes 16/0 against PostgreSQL 17: MAINTAIN and the real owner role, and that the body md5 survives the SQL editor's line endings.
- That the probe passes with the user's own account and the real grants.
- That the migration takes its locks under `lock_timeout` 5 s on live traffic.

### Final Status
- [x] All acceptance criteria pass — PASS WITH NOTES; ready for commit once the Low test gap (Bug 1) is closed or explicitly deferred by TL
- [ ] Issues found — Dev must address before commit

Tree after QA: same `git status` and `git diff --stat` as before QA, plus this insert. No test files were added: the QA route suite was deleted after use (kept in the QA scratchpad).

---

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-07 | Workplan written (Dev) | Branch `feature/bos-plan-payments-p3b` cut from `origin/main` `99df24d3` (after #248). 20261027 verified free on main, open PRs and all worktrees. Scope, apply-function contract, migration and scripts, `recordPlanChange` + admin refactor proof, resolver changes with switch-off byte-identity, demo, 28 tasks, ≈ 5.5 days split as P-3b.1 / P-3b.2, risks, rollback, SA questions Q-1 to Q-13. Uncommitted |
| 2026-10-07 | P-3b.1 implemented (Dev) | Migration 20261027 + pre-check, checker, probe P00 to P15 and rollback (all run on a local PGlite), static test, money history repository, `planWriteChecks.ts`, `recordPlanChange.ts` with the admin route on it (`routes.test.ts` unedited and green), PF-13 in `adminOps.ts`, registrations, audit events, docs and requirement rulings (C-7). **C-8 stop:** the PF-13 route wiring needed one added mock in `routes.test.ts`; SA approved it (C-8 ruling), so the suite is unedited except the one SA-approved mock (C-8 ruling). Uncommitted |
| 2026-10-07 | SA fixes F-1 to F-3 applied (Dev) | F-1: on a replacement the apply function sets `cancel_at_period_end = false`; checker md5 updated (`7ac579a49380b170e1ba3ac42d512820`), pre-check grant list 8 to 9 columns, probe P12 asserts the cleared flag, static test pins it. All five SQL files re-run on PGlite: pre-check PASS (FAIL after, as designed), checker PASS 16/0 and FAIL on the four sabotages, probe PASS P01 to P15 with and without an existing row, six mutations (the new F-1 one included) each FAIL, rollback drops and refuses with a live row. F-2: the one additive billing-repository mock in `routes.test.ts` (13 lines added, 0 removed, the T11b.1 block byte-identical). F-3: the "unedited" statements now read "unedited except the one SA-approved mock (C-8 ruling)"; §3.4 says both modes |
| 2026-10-07 | QA notes closed (Dev) | QA Bug 1: `lib/business-os/purge/__tests__/hasLivePlanSubscription.test.ts` (9 tests: both modes read, live-mode alone true, test-mode alone true, not-ended true, ended false, no row false, no subscription false, a failed read in either mode null); bite check: reading test mode only fails 3 tests, file restored byte-identical (cmp). Added to the billing repository caller guard. Pre-check VERDICT detail now says to run the migration only on PASS and "do not run the migration" on FAIL (PGlite: PASS before, FAIL after); static test pins it. Jest scope 456 suites 10484 passed 0 failed; `test:bos-entitlements` 202 suites 5443 passed |
