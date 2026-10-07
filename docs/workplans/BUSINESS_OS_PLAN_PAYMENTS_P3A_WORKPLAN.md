# Workplan: Business OS Plan Payments, P-3a (Checkout route, test mode)

> **Last Updated**: 2026-10-07

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §5 F1 rows 1–2 and F2 row 2; §6 (currency, price shown vs charged); §8 SR-1, SR-5, SR-8, SR-9, SR-11, SR-12, SR-15, SR-16, SR-17; §9.1 P-3a; §9.4 CF-4; §9.5 rows 6, 12 and 15; SA Review SA-P1, SA-P2 (no anchor parameters), SA-P7, SA-P8 (card only), SA-P11, SA-P12 (b), SA-P14 (layer 1), SA-P15, the tenant-isolation ruling, conditions C-3 and C-9.
**Carry-forwards taken in:** [P-2 workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P2_WORKPLAN.md) SA Q-2 and Q-6 (compare-and-set customer replacement), Q-11 (`userId` and `email` from the session), the P-2a code review (replacement key must not reuse `bos-customer:<userId>`; `billing_row_not_recorded` is a refused checkout with an alert, never a retry loop), P-2b review F-1 (a recognised plan invoice is answered 500 until P-3b).
**Depends on:** P-1 deployed to production (C-3, done: #188). P-2a (#192) and P-2b (#241) merged. Migration 20261025 applied with checker PASS (P-2 workplan §4.7: mandatory before P-3a merges; see gate G-2 below).
**Date:** 2026-10-07
**Branch:** `feature/bos-plan-payments-p3a`, cut from `origin/main` `acd2663b` on 2026-10-07, worktree `neuronforge-invite-s1`. Uncommitted.
**Status:** Code Complete (2026-10-07), uncommitted, awaiting SA code review. Local demo (T16) **not run yet**: it waits for the user's G-5 choice and C-5 (§8). Implementation notes and deviations: § Implementation Notes; evidence: § Evidence Log.

## Overview

P-3a adds the first Business OS plan checkout: `POST /api/business-os/billing/plan/checkout`, behind a new server flag that is off by default. An authenticated owner names a tier. The route creates (or reuses) their Business OS Stripe customer and refuses if they already have a live subscription or an open checkout (SR-5). It resolves the tier's Stripe price by lookup key and refuses unless that price equals the display price (SA-P12 b). It restricts a held friend to the friend tier (SA-P11). Then it opens an **embedded** Stripe subscription checkout in USD with Adaptive Pricing off (SA-P15), records the session as the account's checkout lock, and returns the client secret. Nothing assigns a plan. P-3b does that. The webhook is not changed in P-3a.

The demo runs locally against the "AgentsPilot sandbox" Stripe account with the Stripe CLI. A test card pays. The P-1 router recognises the `invoice.paid` as a Business OS plan invoice, logs `bos_billing_plan_unhandled`, releases the claim and answers 500. No plan row changes.

**No migration.** 20261025 already holds every column P-3a writes (`open_checkout_session_id`, `open_checkout_expires_at`, `stripe_customer_id`, `updated_at`) with a column-level UPDATE grant to `service_role`, and the lock-pair and `cs_` shape CHECKs. Confirmed against `supabase/migrations/20261025_business_os_billing_accounts.sql` (§3.6).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope](#2-scope)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Gates](#5-gates)
6. [Task List](#6-task-list)
7. [Tests](#7-tests)
8. [Local Demo Plan](#8-local-demo-plan)
9. [Risks](#9-risks)
10. [Sizing](#10-sizing)
11. [Questions for SA](#11-questions-for-sa)
12. [SA Review Notes](#sa-review-notes)
13. [Implementation Notes](#implementation-notes)
14. [Evidence Log](#evidence-log)
15. [QA Testing Report](#qa-testing-report)
16. [Commit Info](#commit-info)
17. [Change History](#change-history)

---

## 1. Analysis Summary

| Area | What exists (read on `acd2663b`) | What P-3a does with it |
|---|---|---|
| `lib/business-os/billing/businessOsStripeCustomer.ts` | `ensureBusinessOsStripeCustomer({ userId, email, name })`: reads the row for (account, mode), else creates the customer with key `bos-customer:<userId>` and metadata `product` + `bos_user_id`, records it. Failures: `invalid_input`, `billing_row_unreadable`, `stripe_mode_mismatch`, `billing_row_not_recorded`. No route caller yet | First caller. `userId` and `email` from the session only (Q-11) |
| `BusinessOsBillingAccountRepository` | `findByUser`, `recordCustomer`. Service role, `.eq('user_id').eq('livemode')`, strict mapping, no update methods. Source guard lists every file allowed to name it | Adds `acquireCheckoutLock` and `replaceCustomer`, both compare-and-set (§3.5). New caller registered in both guards |
| `planPriceCatalog.ts`, `planPricesFlag.ts` | Webhook catalog (price id → lookup key), used only while `BUSINESS_OS_PLAN_PRICES_ENABLED` is on. With it on and no plan handler, a recognised plan invoice is released and answered 500 (P-2b F-1) | The checkout **refuses unless this switch is on** (§3.3). It does not use the catalog to sell: it needs the full price, not only the id |
| `planPriceCheck.ts` | Pure `priceProblems(price, expectedCents, expectedLivemode)`, `displayPriceInCents`, `displayMonthlyPricesUsd` | Reused at runtime for SA-P12 (b) |
| `config/planPrices.ts` | `PLAN_STRIPE_PRICES` (tier → lookup key); keys only, no ids | Tier → lookup key at checkout |
| `stripeMetadataKeys.ts` | `product`, `business_os_plan`, `bos_user_id`, the legacy keys | Exactly these are written; no legacy key (CF-4, C-3) |
| `stripeMode.ts` | `currentStripeMode()` from the key prefix, fails closed | The row's mode; the price's mode is checked against it |
| `webhookDispatcher.ts`, `planInvoiceResolver.ts` | A BOS-price `invoice.paid` resolves to `flow: plan`; no handler → `BusinessOsHandlerMissingError` → claim released, 500. `checkout.session.completed` in subscription mode is denied `legacy_subscription_checkout` (200) | **Unchanged in P-3a** (Q-1). The demo shows both behaviours |
| `lib/stripe/StripeService.ts` | Embedded one-off checkout for boost packs (`ui_mode: 'embedded'`, `return_url`); `findOrCreatePlatformCustomer`; SDK pinned to `2025-10-29.clover` | Adds four narrow Stripe-only methods for the plan checkout (§3.4), placed after `createBoostPackCheckout`, outside the `user_subscriptions` lockdown slice |
| `lib/business-os/invites/paymentHold.ts` | `readPaymentHold(accountId, readers)` → `{ok:false}` / not held / held with `inviteId`. The four page layouts redirect a held account; API routes are not gated (F5b-5) | Read to decide the tier a held account may buy, failing closed (SA-P11). Needs the lineage `source` in the held result (Q-3) |
| `config/invites.ts` | `INVITE_ISSUANCE_POLICY.account.grantId` = the friend tier (`TIER_ORDER[0]`, FR-30) | The friend's only allowed tier, imported, never written as a literal |
| `lib/audit/events.ts`, `boundedAuditFlush.ts` | `SUBSCRIPTION_CHECKOUT_INITIATED` belongs to the agent platform; `logAndFlush` writes before responding, never throws | New `BOS_BILLING_CHECKOUT_STARTED` (SA-P3 names `BOS_BILLING_*`), written with `logAndFlush` (WC-7) |
| Stripe SDK types (`node_modules/stripe/types/Checkout/SessionsResource.d.ts`) | `adaptive_pricing.enabled`, `ui_mode: 'custom' \| 'embedded' \| 'hosted'`, `expires_at`, `return_url`, `redirect_on_completion`, `subscription_data.metadata`; `ApiVersion = '2025-10-29.clover'` | SA-P15's parameter is confirmed on the pinned version (as boost T-15 asked) |

**Phase being fixed (V6 rule 8):** not applicable. No V6 pipeline or plugin code is touched.

**Deprecated patterns met:** `app/api/payments/create-checkout/route.ts` (pins `2024-12-18.acacia`, direct `supabaseServer.from`, returns raw Stripe `error.message`) is **not** copied. The template is the `new-api-route` skill.

---

## 2. Scope

| In P-3a | Out (and where it goes) |
|---|---|
| `POST /api/business-os/billing/plan/checkout`, server flag `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` (reader `isPlanCheckoutEnabled()`), off by default | Plan assignment, money history, `recordPlanChange`, anchor (P-3b, 20261027) |
| Customer create or reuse through `ensureBusinessOsStripeCustomer`; replacement of a customer deleted at Stripe by compare-and-set (Q-2/Q-6 carry-forward) | Webhook handling of `checkout.session.completed` / `.expired` (linking the subscription id, clearing the lock): P-3b, unless SA rules otherwise (Q-1) |
| SR-5 / SA-P14 layer 1: refuse a live subscription or an unexpired checkout; lock written by compare-and-set; 31-minute session expiry (C-1); a per-attempt Stripe idempotency key | SA-P14 layer 2 (the webhook refuses a second subscription): P-3b. Layer 3 (reconciliation): P-8b |
| SA-P12 (b): runtime price check against `presentation`, fail closed | Buy button in Settings → Plan, `availableToBuy` (P-4) |
| SA-P11: held account admitted; friend restricted to the friend tier; hold unreadable → refused | Held friend's Pay button and `paidInvitesAvailable` (P-5); admin Paid invite tier (P-9: until then a held `admin_invite` account is refused, fail closed) |
| SA-P15: `adaptive_pricing: { enabled: false }`, USD price only, card only | Founder discount, `trial_end` (P-11) |
| Audit `BOS_BILLING_CHECKOUT_STARTED`, flushed before responding | Portal, invoices, cancel (P-7a) |
| A "Plan checkout (test)" panel on `/test-business-os` that mounts the embedded checkout (the demo trigger) | Checkout-session fixtures from real payloads (C-8): with whichever slice changes the webhook (Q-1) |
| Docs: FEATURE_FLAGS.md, BUSINESS_OS_ENTITLEMENTS.md § Billing, BUSINESS_OS_TEST_PAGE_SCOPE.md, requirement §9.1/§9.4 status lines | The P-3a gate ops step (endpoint on `2025-10-29.clover`, key-prefix look): **kept open by the user**. It gates the end-to-end demo against production and turning either switch on there, not this code |

**State in production after merge:** flag off. The route answers 404 and makes no Stripe or database call. The webhook is byte-identical.

---

## 3. Implementation Approach

### 3.1 Layering

| Layer | File | Responsibility |
|---|---|---|
| Route | `app/api/business-os/billing/plan/checkout/route.ts` | Flag, `getUser()`, Zod (strict body), `resolveAccountId(user.id)`, call the service, map the outcome to HTTP, audit + flush, Pino with `correlationId` |
| Service | `lib/business-os/billing/planCheckout.ts` | `startPlanCheckout(input, deps)`: pure orchestration over injected ports. Returns a discriminated result (`ok` or `refused` with a code). Never throws for an expected refusal; throws only for unexpected faults |
| Price | `lib/business-os/billing/planCheckoutPrice.ts` | Tier → lookup key → exactly one Stripe price → `priceProblems` against the display price and the key's mode. Per-instance cache, 60 s TTL, keyed on the lookup key |
| Eligibility | `lib/business-os/billing/planCheckoutEligibility.ts` | Pure: which tiers the account may buy, from the hold. Imports `TIER_ORDER`, `PLAN_STRIPE_PRICES`, `INVITE_ISSUANCE_POLICY` from the entitlements config, so no tier literal leaves the config folder |
| Flag | `lib/business-os/billing/planCheckoutFlag.ts` | `isPlanCheckoutEnabled()` on `parseBooleanFlag`, as `planPricesFlag.ts` (P2b-Q1 precedent, not a new pattern) |
| Stripe | `lib/stripe/StripeService.ts` | Four Stripe-only methods (§3.4) |
| Data | `BusinessOsBillingAccountRepository` | Two compare-and-set methods (§3.5) |

The route stays thin so every branch is tested on the service with fakes. This is the shape of `ensureBusinessOsStripeCustomer` (P-2a) and `readPaymentHold`.

### 3.2 Request and response

```text
POST /api/business-os/billing/plan/checkout
body (strict; unknown keys → 400):  { tier: <TierId>, returnTo: 'settings_plan' | 'awaiting_payment' | 'test_harness' }
200 → { success: true, data: { clientSecret, sessionId, expiresAt, tier } }
```

- `tier` is `z.enum(TIER_ORDER)`, built from the import, so the route holds no tier literal.
- `returnTo` names a **surface**, mapped server-side to a fixed path on `platformOrigin()` with `?checkout={CHECKOUT_SESSION_ID}`. A free URL is never accepted (open redirect). P-3a uses `test_harness`; the other two are there so P-4 and P-5 need no API change (Q-7).
- Strict body: an injected `userId`, `accountId`, `customerId`, `priceId` or `amount` is refused with 400 (tenant-isolation-guard Step 3).
- `clientSecret` is returned to the owner's browser only. It is never logged.

### 3.3 The order of checks (fail closed everywhere)

| # | Check | Refusal | Why here |
|---|---|---|---|
| 1 | `isPlanCheckoutEnabled()` | 404 `not_available`, nothing read | Off in production: no Stripe or DB call |
| 2 | `getUser()` | 401 | `new-api-route` |
| 3 | Zod strict body | 400 `invalid_input` | Before any business logic (rule 2) |
| 4 | `isPlanPriceRecognitionEnabled()` | 503 `checkout_unavailable`, log `bos_billing_checkout_prices_switch_off` (`error`, `alert`) | **Never take money the webhook cannot recognise.** With the price switch off, the paid invoice would be denied `metadata_mismatch` (the subscription carries the plan marker but the catalog is empty). That is a paid invoice lost once P-3b exists |
| 5 | `currentStripeMode()` | 503 `checkout_unavailable` (`stripe_key_mode_unknown`) | No mode, no row |
| 6 | `readPaymentHold(accountId)` → eligibility | `{ok:false}` → 503 `hold_unreadable`. Held friend asking another tier → 409 `held_tier_not_allowed`. Held `admin_invite` → 409 `held_tier_unresolved` (until P-9) | SA-P11: it decides what may be bought, so it fails **closed** (unlike the page gate) |
| 7 | Plan row present (Q-4) | 409 `no_plan_row` | P-3b's pre-write checks require a plan row. Selling to an account with none would take money P-3b cannot apply |
| 8 | Billing row read (`findByUser`) | unreadable → 503 | Before any Stripe call, as P-2a |
| 9 | Layer 1, record: `subscription_status` in (`active`, `trialing`, `past_due`, `unpaid`, `incomplete`) → 409 `subscription_live`; `open_checkout_session_id` with `open_checkout_expires_at > now` → 409 `checkout_open` (with `expiresAt`) | — | SA-P14 (1). Cheap, no Stripe call |
| 10 | Resolve price + runtime check | No price / more than one / Stripe error → 503 `price_unavailable`; any `priceProblems` → 503 `price_mismatch`, log `error` `alert` | SA-P12 (b) and the CF-1 window (main key missing between price-change steps 2 and 3) |
| 11 | `ensureBusinessOsStripeCustomer({ userId, email, name })` | `invalid_input` (no email) → 422 `email_required`; `billing_row_unreadable` → 503; `stripe_mode_mismatch` → 503 `alert`; **`billing_row_not_recorded` → 500 `billing_record_conflict`, log `error` `alert`, no retry** (carry-forward); `idempotency_error` → 409 `retry_later` | P-2a contract |
| 12 | Layer 1b, Stripe: `subscriptions.list({ customer, status: 'all', limit: 100 })`, every page (C-2); any subscription in the live set → 409 `subscription_live`, log `warn` | — | **Needed in P-3a** because nothing writes `subscription_status` until P-3b/P-6a: without it, a paid account could open a second subscription once the 30-minute lock expires. Kept afterwards as a belt-and-braces check against a lagging webhook (Q-5). Not an access decision, so SR-11 is not touched |
| 13 | Create the session (§3.4); on `resource_missing` for `customer` → replace the customer once (§3.5) and retry once | Second failure → 502 `stripe_error` | Q-6 carry-forward; one retry, never a loop |
| 14 | `acquireCheckoutLock` (compare-and-set) | Lost → expire the new session at Stripe, 409 `checkout_busy` | Two clicks cannot both get a payable session (§3.5) |
| 15 | Audit `BOS_BILLING_CHECKOUT_STARTED` via `logAndFlush`, then 200 | — | AM-7, WC-7 |

Error bodies follow CLAUDE.md: `{ success: false, error: <user-friendly>, code, details: dev-only }`. Stripe and database messages never reach the client outside development.

### 3.4 Stripe calls (StripeService, Stripe-only, no DB client)

| Method | Call | Pinned parameters |
|---|---|---|
| `listPricesByLookupKeys(keys)` | `prices.list({ lookup_keys, limit: 10 })` | No `active` filter, so an inactive price surfaces and fails `priceProblems` rather than disappearing |
| `listCustomerSubscriptions(customerId)` | `subscriptions.list({ customer, status: 'all', limit: 100 })`, every page (C-2) | — |
| `createBusinessOsPlanCheckoutSession(p)` | `checkout.sessions.create(params, { idempotencyKey })` | `mode: 'subscription'`; `ui_mode: 'embedded'` (the existing pattern, F1 "embedded checkout"); `return_url`; `redirect_on_completion: 'if_required'`; `customer`; `line_items: [{ price, quantity: 1 }]`; `payment_method_types: ['card']` (SA-P8); `adaptive_pricing: { enabled: false }` (SA-P15); `expires_at = now + 31 min` (C-1: Stripe's minimum is 30, measured at its side, SA-P14); `metadata` and `subscription_data.metadata` = `{ product: 'business_os_plan', bos_user_id }` from `stripeMetadataKeys.ts` only. **Never** `user_id`, `credits`, `pilot_credits` (CF-4, C-3); **never** `billing_cycle_anchor`, `proration_behavior`, `trial_*` (SA-P2); no `allow_promotion_codes`, no `automatic_tax` (BQ-P5 is a go-live item, §9.5 row 5). Idempotency key `bos-plan-checkout:<userId>:<attemptUuid>`, a fresh UUID per request, so only the SDK's own network retries share it |
| `expireCheckoutSession(id)` | `checkout.sessions.expire(id)` | Used only for the loser of a lock race. A failure is logged `warn` and ignored: the loser's client secret is never returned, so nobody can pay it, and it expires in 30 minutes anyway |

The idempotency key is the one rule from SA-P14 a per-request UUID satisfies. A double click is stopped by the lock, not by the key.

Currency (CLAUDE.md § Currency, RD-13): the only currency is the price's, checked as `usd` by `priceProblems`. Nothing is read from `LanguageContext.currencyCode`, `business_profiles.currency` or any scheduling service. The checkout passes no `currency` parameter.

### 3.5 Lock and customer replacement: compare-and-set without `.select()`

Both methods follow the PostgREST rule learned on 2026-09-29: **UPDATE + `.or()` + `.select()` fails with 42703 in production**, so they use `{ count: 'exact' }` and read the count, never `.select()`.

```text
acquireCheckoutLock({ userId, livemode, stripeCustomerId, sessionId, expiresAt, nowIso })
  UPDATE business_os_billing_accounts
     SET open_checkout_session_id = sessionId, open_checkout_expires_at = expiresAt, updated_at = nowIso
   WHERE user_id = userId AND livemode = livemode AND stripe_customer_id = stripeCustomerId
     AND (open_checkout_session_id IS NULL OR open_checkout_expires_at <= nowIso)
  → count 1 = acquired; 0 = lost (someone holds an unexpired lock, or the customer was replaced)
```

- `.update(patch, { count: 'exact' }).eq('user_id').eq('livemode').eq('stripe_customer_id').or('open_checkout_session_id.is.null,open_checkout_expires_at.lte.<iso>')`. The ISO string is `toISOString()` (ends in `Z`, no `+` that a URL would turn into a space, no comma that would split the `or` list). A unit test pins the exact filter string.
- **Why the session is created before the lock, not after.** The `cs_` CHECK means the lock cannot be reserved before the session id exists, and a placeholder id would put a fake session into a column the admin panel (P-8a) will display. So: pre-check (§3.3 step 9), create the session, then compare-and-set. Two clicks may both create a session. Only one wins the update. The loser's session is expired and its client secret is never returned, so at most one payable session exists per account.
- The patch is an explicit allow-list of three columns. `user_id`, `livemode` and `id` cannot be written (no grant).
- App clock vs DB clock: the expiry is Stripe's `expires_at`, compared with the server's `now`. A few seconds of skew only shift when an abandoned lock frees up.

```text
replaceCustomer({ userId, livemode, oldCustomerId, newCustomerId, nowIso })
  UPDATE ... SET stripe_customer_id = new, stripe_subscription_id = NULL, subscription_status = NULL,
                 open_checkout_session_id = NULL, open_checkout_expires_at = NULL, updated_at = nowIso
   WHERE user_id = userId AND livemode = livemode AND stripe_customer_id = oldCustomerId
  → count 1 = replaced; 0 = someone else replaced it first → re-read and use the stored customer
```

- Triggered **only** by Stripe's `resource_missing` error with `param = 'customer'` on session create (the customer was deleted at Stripe, as "Delete all test data" does). Never by a retrieve (Q-6: the BOS caller trusts its row).
- The new customer is created with idempotency key **`bos-customer:<userId>:replaces:<oldCustomerId>`**, never `bos-customer:<userId>` (carry-forward: within 24 h Stripe would replay the deleted customer).
- Clearing the subscription fields with the customer: a deleted Stripe customer has no live subscription, so keeping its subscription id would make layer 1 refuse forever. Q-8 asks SA to confirm.
- A UNIQUE violation on `stripe_customer_id` (the new id held by another row) is an error with `alert`, never a returned row, as `recordCustomer` does.

### 3.6 No migration: evidence

| Need | In 20261025 |
|---|---|
| Lock columns | `open_checkout_session_id text`, `open_checkout_expires_at timestamptz` |
| Lock integrity | `checkout_lock_pair` CHECK (both null or both set); `checkout_id_shape` (`cs_` prefix, ≤ 255) |
| Writable by the server | `GRANT UPDATE (stripe_customer_id, stripe_subscription_id, subscription_status, …, open_checkout_session_id, open_checkout_expires_at, …, updated_at) TO service_role` |
| Not writable | `id`, `user_id`, `livemode`, `created_at` (no grant) |
| No client access | RLS on, no policy, REVOKE ALL from `anon`, `authenticated` |

Migration numbers stay untouched: 20261027 (P-3b), 20261028 (P-5), 20261029 (P-9) remain reserved; 20261039 is the latest on main.

### 3.7 Interaction with the plan price switch (`BUSINESS_OS_PLAN_PRICES_ENABLED`)

| Price switch | Checkout flag | Result |
|---|---|---|
| off | off | Production today. Route 404; webhook denies every plan invoice |
| off | on | **Route refuses (503, alert)**: §3.3 step 4. A misconfiguration, never a sale |
| on | off | Webhook recognises plan invoices; with no handler (until P-3b) each is released and answered 500, and Stripe retries it for up to 3 days. Nobody can buy through the route |
| on | on | The demo state (local only). A paid invoice → `bos_billing_plan_unhandled` → claim released → 500 → Stripe retries. **Via the Stripe CLI there are no retries**: `stripe listen` forwards each event once and Stripe does not redeliver to the CLI. A real endpoint would retry for 3 days, which is why neither switch is turned on in a shared environment before P-3b |

Docs: FEATURE_FLAGS.md gets the new flag with the rule "turn on only where the price switch is on and `check-bos-plan-prices` passes; never in production before P-3b" (§9.5 row 15 turns it on in production at go-live).

### 3.8 Logging and audit

- `createLogger({ module: 'BosPlanCheckoutAPI' })` in the route, `child({ correlationId })`; the service takes the child logger. Event names `bos_billing_checkout_started`, `bos_billing_checkout_refused` (with `code`), `bos_billing_checkout_lock_lost`, `bos_billing_customer_replaced`, `bos_billing_checkout_price_mismatch`. Ids, tier, lookup key, mode and codes only: no email, no name, no client secret, no metadata values. `error` lines carry `alert: true` (the v1 alert channel, AM-9).
- Audit: new `AUDIT_EVENTS.BOS_BILLING_CHECKOUT_STARTED` (`severity: 'info'`, `['SOC2', 'FINANCIAL']`, registered in `events.ts` with its description). `entityType: 'business_os_billing_account'`, `entityId` = billing row id, `userId` = the session user, details `{ tier, lookupKey, sessionId, livemode, held, expiresAt, actor: 'owner' }`. Written with `logAndFlush` (bounded, never throws) before the 200. Refusals are logged, not audited (AM-7 lists "checkout started", not refusals); Q-9 asks whether `billing_record_conflict` should also be audited.

### 3.9 Test harness panel

`/test-business-os` gets a "Plan checkout (test)" panel (in a new **Billing** tab): a tier select built from `TIER_ORDER` (a registered non-gate import, Q-10, so the component holds no tier literal), a Start button that calls the route with `returnTo: 'test_harness'`, the JSON response in the shared viewer, and the embedded checkout mounted with `@stripe/react-stripe-js` `EmbeddedCheckoutProvider` + `EmbeddedCheckout` (already installed, v6.8) on `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. A held account cannot open `/test-business-os` (the layout redirects it), so the held paths are demoed by a `fetch` from the browser console on `/invite/awaiting-payment` (§8).

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/billing/planCheckoutFlag.ts` | create | `isPlanCheckoutEnabled()`, server-only, default off |
| `lib/business-os/billing/planCheckout.ts` | create | `startPlanCheckout` orchestration (§3.3) |
| `lib/business-os/billing/planCheckoutPrice.ts` | create | Lookup-key price resolution + runtime check, 60 s cache |
| `lib/business-os/billing/planCheckoutEligibility.ts` | create | Tiers a (held) account may buy; pure |
| `app/api/business-os/billing/plan/checkout/route.ts` | create | The route (`new-api-route`) |
| `lib/stripe/StripeService.ts` | modify | Four Stripe-only methods (§3.4), after `createBoostPackCheckout` |
| `lib/repositories/BusinessOsBillingAccountRepository.ts` | modify | `acquireCheckoutLock`, `replaceCustomer`; header scope note |
| `lib/business-os/billing/businessOsStripeCustomer.ts` | modify | Export `replaceBusinessOsStripeCustomer` (the Q-2/Q-6 path) beside `ensure…`, sharing its mode and error rules; header "no route calls this" line updated |
| `lib/business-os/invites/paymentHold.ts` | modify | Held result gains `source` (Q-3); additive |
| `lib/audit/events.ts` | modify | `BOS_BILLING_CHECKOUT_STARTED` + registration |
| `lib/business-os/billing/planInvoiceResolver.ts` | modify (comment only) | "P-3a adds this" → the slice SA picks in Q-1. No behaviour change |
| `app/test-business-os/page.tsx` + `components/test-business-os/PlanCheckoutPanel.tsx` | modify / create | Demo trigger (§3.9) |
| Tests (§7) | create / modify | Route, service, price, eligibility, flag, repository, StripeService, guards |
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` | modify | `BILLING_REPOSITORY_CALLERS` += `planCheckout.ts` |
| `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts` | modify | Allow-list += the new caller and its test |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | `KNOWN_NON_GATE_IMPORTERS` for the route (`resolveAccountId`), `planCheckoutEligibility.ts`, `planCheckout.ts` if it imports `TierId`, the panel if it does (Q-10) |
| `lib/business-os/invites/__tests__/paymentHold.test.ts` | modify | Expectations gain `source` |
| `docs/FEATURE_FLAGS.md` | modify | The new flag, its order with the price switch, version row |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` § Billing | modify | The route, the flag, the lock rule |
| `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` | modify | The Billing tab |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | §9.1 P-3a status, §9.4 CF-4 closed, Change History (always update the main requirement) |

No file under `supabase/migrations/`. No change to `app/api/stripe/webhook/route.ts` (so no Connect before/after evidence is owed, SR-10).

---

## 5. Gates

| # | Gate | Blocks | Owner | State |
|---|---|---|---|---|
| G-1 | P-1 deployed to production (C-3) | Merge | — | ✅ #188 |
| G-2 | 20261025 applied, checker VERDICT PASS on record (P-2 §4.7: "P-3a must not merge without the checker PASS on record") | Merge | User (paste) / RM (record) | ✅ **Met per SA ruling G-2.** The user stated on **2026-10-04**: "checker passed, merged PR192" (recorded verbatim in the [P-2 evidence log](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P2_WORKPLAN.md#evidence-log)). Plus Dev's read-only schema check on 2026-10-07 (§ Evidence Log E-1): the six lock/customer/mirror columns exist live, a phantom column is refused `42703`, `anon` is refused `42501`; the column UPDATE grant and the `checkout_lock_pair` / `checkout_id_shape` CHECKs are in the migration body (lines 42, 52, 88) and were covered by the user's checker PASS. SA: together these satisfy P2-C6; rows are not owed retroactively |
| G-3 | Sandbox `check-bos-plan-prices` PASS (H2) | Demo | Dev | ✅ 2026-10-06; re-run at demo time |
| G-4 | Test endpoint on `2025-10-29.clover` + key-prefix look (§9.1 P-3a gate, P2b-Q2 ops step) | **Not** code or merge. Blocks: any demo against production, fixture capture (C-8), turning either switch on in a shared environment | User + Offir | ⬜ **Kept open by the user** (2026-10-07). The local demo does not depend on it: P2b-Q2 ruled that no field the router reads differs between `2025-09-30.clover` and `2025-10-29.clover` |
| G-5 | The sandbox → production endpoint (`we_1UNG3L56GTXD0wwiKUsZn8DU`) during the demo | Demo | User | ⬜ Decision owed (§8 step 0, R-3) |
| G-6 | `npm run test:bos-entitlements` green (SR-17) | Hand-over to SA | Dev | ✅ 2026-10-07: 196 suites, 5,184 tests, all pass (§ Evidence Log) |

---

## 6. Task List

- [x] ✅ **T0** Branch `feature/bos-plan-payments-p3a` confirmed (base `acd2663b`). G-2: the user's 2026-10-04 statement recorded; read-only schema check done (E-1)
- [x] ✅ **T1** `planCheckoutFlag.ts` + test
- [x] ✅ **T2** StripeService: the four methods (after `createBoostPackCheckout`, no client). `listCustomerSubscriptions` pages through everything (C-2). Tests pin §3.4; lockdown guard and `stripeAuditEntries` green
- [x] ✅ **T3** Repository `acquireCheckoutLock` + `replaceCustomer` + tests (incl. the exact `.or()` string, no `.select()` source assertion, filter-unsafe input refused)
- [x] ✅ **T4** `replaceBusinessOsStripeCustomer` + tests
- [x] ✅ **T5** `paymentHold.ts` `source`; its tests updated; `creditAdminOps` / `paymentHoldGate` unaffected (they read `held` only); `paymentHold.ts` still imports nothing from the entitlements module
- [x] ✅ **T6** `planCheckoutEligibility.ts` + tests
- [x] ✅ **T7** `planCheckoutPrice.ts` + tests (only a PASSING price is cached; key = mode + lookup key)
- [x] ✅ **T8** `planCheckout.ts` + `planCheckout.test.ts` (57 tests, ordered call log for C-4)
- [x] ✅ **T9** `BOS_BILLING_CHECKOUT_STARTED` registered (event, metadata, audience `bos`, entity type `business_os_billing_account` owner-visible, filter group "Business OS Billing")
- [x] ✅ **T10** Route + `__tests__/route.test.ts` (35 tests, through the real orchestration)
- [x] ✅ **T11** Guards updated: `BILLING_REPOSITORY_CALLERS` + the repository's ALLOWED list; CF-4 / tier-literal source guards in `planCheckout.test.ts`; five `KNOWN_NON_GATE_IMPORTERS` entries; `npm run test:bos-entitlements` green
- [x] ✅ **T12** `planInvoiceResolver.ts` comments re-pointed to P-3b (comment-only)
- [x] ✅ **T13** `/test-business-os` Billing tab + `PlanCheckoutPanel` + source-level test
- [x] ✅ **T14** Docs: FEATURE_FLAGS.md (1.8.0), BUSINESS_OS_ENTITLEMENTS.md § Plan checkout, BUSINESS_OS_TEST_PAGE_SCOPE.md § Tab: Billing, requirement §9.1 / §9.4 CF-4 / Change History, P-2 workplan evidence log (G-2)
- [x] ✅ **T15** Jest, `test:bos-entitlements`, eslint, scoped tsc (§ Evidence Log)
- [ ] **T16** Local demo (§8). **Not run**: waits for the user's G-5 choice; C-5 (cancel the sandbox subscription the same day) is in the runbook
- [ ] **T17** Hand-over to SA code review (uncommitted; `git diff --stat` checked first)

---

## 7. Tests

| Suite | Cases (minimum) |
|---|---|
| `route.test.ts` | 200 with `clientSecret`; 401; 400 bad tier; 400 unknown key (`userId` injected); 404 flag off with **no** service, Stripe or repository call; each refusal code → status; audit `log` + flush called before the response; development-only `details`; the client secret and email never appear in a log call |
| `planCheckout.test.ts` | Price switch off → refused, no Stripe call; hold unreadable → refused, no Stripe call; held friend + other tier → refused; held friend + friend tier → ok; held admin invite → refused; no plan row → refused; billing row unreadable → refused before Stripe; `subscription_status` live → refused; unexpired lock → `checkout_open` with `expiresAt`; expired lock → proceeds; price mismatch → refused, `alert`; customer `billing_row_not_recorded` → `billing_record_conflict`, `alert`, **no second attempt**; Stripe live subscription (layer 1b) → refused, no session; `resource_missing` customer → one replacement, one retry, then ok; second `resource_missing` → `stripe_error`, no third call; lock lost → session expired, `checkout_busy`, no client secret; expire failure on the loser → still `checkout_busy`, `warn` |
| `planCheckoutPrice.test.ts` | Exactly one price passes; zero / two prices; wrong amount, currency, interval, tax, mode, inactive; cache hit within TTL, miss after; different key not served from another key's cache |
| `planCheckoutEligibility.test.ts` | Not held → all sellable tiers (derived from config, compared by reference, no literal); friend → friend tier only; admin invite → refuse; unreadable → refuse |
| `BusinessOsBillingAccountRepository.test.ts` | Lock: patch is exactly the three columns; filter chain `eq user_id`, `eq livemode`, `eq stripe_customer_id`, `or(...)` with the exact string; `{ count: 'exact' }` and **no `.select()`** (a source assertion as well); count 1/0/error. Replace: CAS on the old id; cleared fields; count 0; unique violation → error; invalid ids refused before the query |
| `StripeService` plan checkout test | Parameters of §3.4 exact; `metadata` and `subscription_data.metadata` have exactly `product` and `bos_user_id`; no `user_id`/`credits`/`pilot_credits`/`billing_cycle_anchor`/`proration_behavior`/`trial_end`/`allow_promotion_codes`/`currency`; idempotency key shape; `expires_at` = now + 1860 s (C-1) |
| `businessOsStripeCustomer.test.ts` | Replacement key ≠ `bos-customer:<userId>`; mode mismatch → nothing written; CAS lost → stored id |
| Guards | CF-4 source guard over `lib/business-os/billing/**` and the route: no string literal `'user_id'`, `'credits'`, `'pilot_credits'` as a metadata key; repository-caller lists; tier-literal; entitlements registrations |

Coverage rule (CLAUDE.md): the new route has happy path, auth failure and invalid input; each new repository method has unit tests.

---

## 8. Local Demo Plan

**Status: runbook ready, NOT run.** It waits for the user's G-5 choice (step 0). C-5 (cancel the sandbox subscription the same day) is step 13 and is not optional.

**Where:** the developer's machine, `npm run dev` in this worktree, Stripe **sandbox** account `acct_1SMy0N56GTXD0wwi` (test mode). Nothing on Vercel changes, and no switch is turned on in any shared environment.

**What is written, honestly.** There is one Supabase project, so the local server writes to the production database. The demo writes: one `business_os_billing_accounts` row with `livemode = false` for a designated test account (or reuses it), the lock columns on it, one `BOS_BILLING_CHECKOUT_STARTED` audit row, and `processed_webhook_events` claim rows for the forwarded events. This is the PF-15 arrangement the requirement accepted (designated test accounts, test-mode rows). No plan row, lineage, credit or `user_subscriptions` row is written.

**Pre-flight facts (checked 2026-10-07, by name only, no value printed):**

| Item | State |
|---|---|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in the main checkout's `.env.local` | **Present**, test prefix, and it embeds the sandbox account id (`acct_1SMy0N56GTXD0wwi`). Nothing owed by the user |
| `STRIPE_SECRET_KEY` there | Present, test prefix, sandbox account |
| `STRIPE_WEBHOOK_SECRET` there | Present (`whsec_`): it is NOT the CLI's secret. Step 3 replaces it for the demo; step 13 restores it |
| `NEXT_PUBLIC_APP_URL` there | Points at localhost, so the return URL is local |
| `BUSINESS_OS_PLAN_PRICES_ENABLED`, `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` | Absent (off) |
| This worktree's own `.env.local` | **None.** The dev server must run with the main checkout's variables (step 1) |
| Stripe CLI | Not on this machine's PATH. Install it (e.g. `scoop install stripe` or the Windows zip from Stripe) and run `stripe login` against the **sandbox** before step 3 |

### Runbook

| Step | Action | Expected |
|---|---|---|
| 0 | **G-5, the user's choice (business terms):** while the sandbox → production forwarding link (`we_1UNG3L56GTXD0wwiKUsZn8DU`) stays on, the demo causes **one expected false alarm in production's log**; nothing is charged, sold or changed for any customer. SA recommends running with the link on and noting the alarm's time and session id here. Alternative: switch the link off for the demo (no alarm, but it touches a setting the user chose to leave open) | The user's choice recorded here, with the time |
| 1 | Environment, **developer's machine only, never committed, never on Vercel.** Copy the main checkout's `.env.local` into this worktree (`.env*` is git-ignored), then add: `BUSINESS_OS_PLAN_PRICES_ENABLED=true` and `BUSINESS_OS_PLAN_CHECKOUT_ENABLED=true`. The sandbox `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are already there | — |
| 2 | `npm run check-bos-plan-prices -- --env <the copied .env.local> --expect-account acct_1SMy0N56GTXD0wwi` | `PASS` for both tiers ($79.00, $129.00) and `VERDICT PASS`. Anything else: stop |
| 3 | `stripe listen --forward-to localhost:3000/api/stripe/webhook` (CLI logged in to the sandbox). Put the `whsec_…` it prints into the worktree's `.env.local` as `STRIPE_WEBHOOK_SECRET` (keep the old value aside for step 13). Never write it in this workplan | `Ready! … forwarding` |
| 4 | `npm run dev` in this worktree. Sign in as the designated test account (trial, not held) → `/test-business-os` → **Billing** tab → tier = the first tier → **Start checkout** | 200 in the Last API Response viewer with `sessionId`, `expiresAt` about 31 minutes ahead, client secret shown as `[redacted: mounted below]`. The embedded checkout shows **$79.00 USD per month**, card only, no local-currency switch. Server log: `bos_billing_checkout_started`. Audit: one `BOS_BILLING_CHECKOUT_STARTED` row |
| 5 | Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode | The panel shows "completed. The plan is unchanged until P-3b" (no redirect) |
| 6 | Watch the CLI and the dev-server log | `checkout.session.completed` → router deny `legacy_subscription_checkout`, 200 (expected until P-3b, SA Q-1). `invoice.paid` → router `flow: plan` → `bos_billing_plan_unhandled` → claim released → **500**. The CLI forwards once and does not retry |
| 7 | Check the data | `/api/business-os/entitlements/my-plan` and the admin Tiers page: plan unchanged (still trial). Billing row: `livemode = false`, a `cus_…`, lock = this session, expiry = Stripe's. No `business_os_billing_events` table yet (P-3b) |
| 8 | Press **Close checkout**, then **Start checkout** again at once | 409 `checkout_open` with the lock's `expiresAt` |
| 9 | Wait for the lock to expire (**31 minutes**; no SQL write is made to shorten it), then Start again | 409 `subscription_live`: the record still shows no subscription (P-3b mirrors it), but Stripe's list shows the active subscription from step 5 (layer 1b) |
| 10 | Declined card: sign in as a second test account, Start, pay with `4000 0000 0000 0002` | Error shown inside the checkout; no `invoice.paid`; plan unchanged. That account's lock stays until it expires |
| 11 | Held friend (only if a held test friend exists): signed in as them, on `/invite/awaiting-payment`, browser console: `fetch('/api/business-os/billing/plan/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier: '<second tier>', returnTo: 'awaiting_payment' }) }).then(r => r.json())` | 409 `held_tier_not_allowed`. With the friend tier: 200 (do not pay). If no held test friend exists, the unit and route tests are the evidence and this step is marked skipped |
| 12 | Price mismatch | Not demoed live (the code is not edited for a demo); the unit and route tests are the evidence |
| 13 | **Cleanup, the same day (C-5):** in the Stripe **sandbox** dashboard → Customers → the test customer(s) → the subscription → **Cancel subscription → immediately** (or `stripe subscriptions cancel sub_…` with the CLI logged in to the sandbox). Otherwise it renews monthly and every renewal reaches production through the forwarding link. Then stop the CLI, restore the old `STRIPE_WEBHOOK_SECRET`, and remove the two switches (or delete the worktree's copied `.env.local`) | Subscription status `canceled` in the sandbox; time recorded here. The cancellation's `customer.subscription.deleted` is forwarded too (see "In production" below) |

**In production while the forwarding link is on (what alert to expect).** Production has both switches off and no plan handler. The demo's events reach it with a valid signature:

- `invoice.paid` for the plan subscription: production's catalog recognises no plan price (switch off), but the invoice carries the Business OS plan marker in its metadata, so the router **denies it `metadata_mismatch`**: one `error` log line with `alert: true`, a completed claim row in `processed_webhook_events`, answered 200. **This is the one expected false alarm.** Note its time and the session id here.
- `checkout.session.completed` (subscription mode): denied `legacy_subscription_checkout`, answered 200, no alert.
- `customer.subscription.updated` / `.deleted` (platform): the agent-platform handlers key on `metadata.user_id`, which a Business OS subscription never carries (CF-4), so each logs `No user_id in subscription metadata` at `error` (without `alert`) and returns, writing nothing (`app/api/stripe/webhook/route.ts` `handleSubscriptionUpdated`, `customer.subscription.deleted`). The local dev server logs the same lines. `customer.subscription.created` on the platform is ignored.
- Nothing is charged, sold or changed for any customer, and no plan row moves.

**What the demo shows:** a test card pays through the real route; the P-1 router recognises the invoice as a Business OS plan invoice; nothing assigns a plan; the SR-5 lock and the Stripe-side check stop a second subscription; held friends are restricted.

**Demo evidence (to fill in when run):** G-5 choice and time; check-bos-plan-prices VERDICT; session id; CLI event ids and responses; production alert time (if the link stayed on); cancellation time.

---

## 9. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | Money taken that the webhook cannot recognise (checkout on, price switch off) | Low | High after P-3b | §3.3 step 4 refuses; FEATURE_FLAGS.md orders the two switches; a test pins it |
| R-2 | Second subscription for one account while P-3a writes no `subscription_status` | Medium in test | Medium | Lock + Stripe layer 1b; P-3b's layer 2 |
| R-3 | Demo events reach production through the sandbox endpoint and raise a `metadata_mismatch` alert | High if the endpoint stays enabled | Low (deny, 200) | G-5 decision before the demo |
| R-4 | Either switch turned on in production before P-3b | Low | 3-day retry loops; money without a plan | Both default off; docs; §9.5 row 15 ordering; SA-ruled in P-2b |
| R-5 | A loser session in a lock race left payable | Very low | Medium | Its client secret is never returned; it is expired at Stripe; 31-minute expiry backstop |
| R-6 | PostgREST UPDATE + `.or()` + `.select()` 42703 | Would be High | Checkout broken in prod | `{ count: 'exact' }`, no `.select()`, source test |
| R-7 | Clearing subscription fields on customer replacement hides a live subscription | Very low (Stripe deletes subscriptions with the customer) | Medium | Only on Stripe's `resource_missing`; Q-8 |
| R-8 | `paymentHold.ts` change affects the page gate | Low | High (could release a friend) | Additive field only; every existing test kept; gate logic not edited |
| R-9 | Entitlements invariants red from a new importer | Medium (it has happened three times) | Main red | T11 + `npm run test:bos-entitlements` before hand-over |
| R-10 | Webhook endpoint version not yet `2025-10-29.clover` (G-4 open) | Certain today | Low for P-3a (P2b-Q2: no field read differs) | Stays a gate on fixtures and production, as the user chose |

---

## 10. Sizing

| Block | Estimate |
|---|---|
| Flag, eligibility, price module, StripeService methods + tests (T1, T2, T6, T7) | 0.75 d |
| Repository CAS methods, customer replacement, hold field + tests (T3–T5) | 0.75 d |
| Orchestration, route, audit, guards, registrations (T8–T12) | 0.75 d |
| Harness panel, docs, demo, evidence (T13–T16) | 0.5–0.75 d |
| **Total** | **2.75–3 days** |

Within the 2–3 day slice **provided the webhook's session events stay out** (Q-1). If SA puts them in P-3a (recognise BOS sessions, link the subscription id, clear the lock, session fixtures from real payloads, Connect before/after evidence because the webhook file changes), that is about +1.5 days, and Dev proposes splitting it: **P-3a1** this route, **P-3a2** session events.

---

## 11. Questions for SA

| # | Question | Dev's recommendation |
|---|---|---|
| Q-1 | `checkout.session.completed` / `.expired` (SA-P8: link subscription id, clear the lock). The resolver comment says "P-3a adds this". In P-3a, or P-3b? | **P-3b**, which already changes the webhook and the billing row. P-3a then leaves the webhook byte-identical (no Connect evidence owed), and the demo shows the session as `legacy_subscription_checkout` (200). The lock expires on its own in 30 minutes; layer 1b covers the paid case. If SA prefers P-3a, split it into P-3a1/P-3a2 (§10) |
| Q-2 | Lock order: create the session, then compare-and-set, and expire the loser (§3.5). Acceptable instead of a reservation placeholder or an advisory-lock RPC (which would need a migration)? | Yes |
| Q-3 | `readPaymentHold`'s held result gains `source` (`account_invite` / `admin_invite`), so the checkout restricts by source without copying the predicate (SA-P11) | Yes, additive; the alternative is a second lineage read |
| Q-4 | Refuse an account with no plan row (`no_plan_row`)? Read through `getEntitlementService().getSnapshot()` (non-gate import, cached 30 s) or a plan-row read in the billing module? | Refuse. Use the snapshot. A missing row can only appear after the check if the account is deleted, which PF-14 handles |
| Q-5 | Layer 1b (Stripe `subscriptions.list` before every checkout). Keep it permanently, or only until P-3b mirrors status? | Keep it: one Stripe call on a buy is cheap and covers a lagging webhook. It is not an access decision (SR-11) |
| Q-6 | Flag off → 404 `not_available` (the route looks absent), or 403? | 404 |
| Q-7 | `returnTo` enum with three surfaces now (`settings_plan`, `awaiting_payment`, `test_harness`), or only `test_harness` until P-4/P-5? | Three now, fixed paths, so the API does not change in P-4/P-5 |
| Q-8 | Customer replacement also clears `stripe_subscription_id`, `subscription_status` and the lock (§3.5) | Yes |
| Q-9 | `billing_record_conflict` (customer held by another account): log `error` + `alert` only, or also an audit row? | Also an audit row (`BOS_BILLING_CHECKOUT_REFUSED`, severity `warning`) only if SA wants refusals in the trail; otherwise log only, as AM-7 lists starts, not refusals |
| Q-10 | Registrations: the route (`resolveAccountId`), `planCheckoutEligibility.ts` (`TIER_ORDER`, `PLAN_STRIPE_PRICES`, `INVITE_ISSUANCE_POLICY`, `TierId`) and possibly the harness panel as **non-gates** in `KNOWN_NON_GATE_IMPORTERS`. Is restricting a held friend to the friend tier a "gate"? | Non-gate: it applies invite policy (FR-30), not a capability, and calls no `check()`/`decide()`. If SA disagrees, the eligibility file goes in `ENFORCEMENT_POINTS` |
| Q-11 | `redirect_on_completion: 'if_required'` (card only, so the embedded checkout normally does not redirect, and P-4's "processing" screen is driven by `onComplete`) | Yes |
| Q-12 | `checkout_open`: refuse (SA-P14 as ruled) vs "resume the open session" (retrieve it and return its client secret if it is for the same tier). Resume is better UX for a reload mid-checkout | Refuse in P-3a as ruled; raise resume as a P-4 UX question |

---

## SA Review Notes

**Reviewed by SA — 2026-10-07**
**Status:** ✅ APPROVED WITH CONDITIONS (C-1 to C-6). Proceed to implementation.

### Rulings on Q-1 to Q-12

| # | Ruling |
|---|---|
| Q-1 | **P-3b.** Webhook stays byte-identical in P-3a; no Connect evidence owed. `planInvoiceResolver.ts` comment re-pointed to P-3b (T12). The demo's `legacy_subscription_checkout` deny is expected |
| Q-2 | **Approved.** Session → CAS → expire loser. Loser's client secret never leaves the service (test pins it) |
| Q-3 | **Approved**, additive. `paymentHold.ts` must still import nothing from the entitlements module; the gate's held/not-held decision is not edited |
| Q-4 | **Refuse, via `getSnapshot()`.** Snapshot read failure → 503, fail closed. Register `planCheckout.ts` as a non-gate with `why`: refuses on a *missing row* (P-3b precondition), never by tier/capability, no `check()`/`decide()` |
| Q-5 | **Keep permanently** (not an access decision, SR-11 untouched). See C-2 |
| Q-6 | **404**, nothing read |
| Q-7 | **Three surfaces now**, fixed server-side paths, no free URL |
| Q-8 | **Approved**, only on Stripe `resource_missing` for `customer`. Log `bos_billing_customer_replaced` at `warn` |
| Q-9 | **Log only** (`error` + `alert`). No refusal audit event in P-3a (AM-7) |
| Q-10 | **Non-gate** for the route, eligibility file, `planCheckout.ts` and the panel: the friend restriction applies invite policy (FR-30), not a plan/capability refusal. `symbols` must match imports exactly |
| Q-11 | **Approved.** The harness panel handles `onComplete` (no redirect expected) |
| Q-12 | **Refuse** in P-3a; resume is a P-4 UX question |

### Price switch requirement (§3.3 step 4)

**Correct and required**: never sell what the webhook cannot recognise. Reconciled with P-2b F-1: in **production both switches stay off until P-3b**; the checkout flag is turned on there only after the price switch, at §9.5 row 15. **For the demo**, both switches are on **only in the developer's `.env.local`** with the sandbox key and the CLI's `whsec_`; nothing on Vercel changes.

### Gates

- **G-2:** the user's dated statement ("checker passed, merged PR192", 2026-10-04), recorded verbatim in the P-2 evidence log, **plus** Dev's read-only `business-os-schema-check` of the four lock/customer columns, the column grant and the two CHECKs, **satisfies P2-C6** for P-3a's merge. Rows are not owed retroactively.
- **G-5 (user's choice, business terms):** while the sandbox → production forwarding link stays on, the demo causes **one expected false alarm in production's log**; nothing is charged, sold or changed for any customer. *Recommendation: run the demo now, note the alarm's time and session id here.* Alternative: switch the link off for the demo (no alarm, but it touches the setting you chose to leave open).

### Conditions

1. **C-1** `expires_at` = now + **31 minutes** (Stripe rejects < 30 min measured at its side; now+1800 can fail on latency). The lock stores the **session's returned** `expires_at`, never the computed one. Tests updated (§7 "now + 1800").
2. **C-2** Layer 1b must not miss a live subscription behind cancelled ones: auto-paginate, or if `has_more` with no live one found → refuse 503 (fail closed). Test it.
3. **C-3** The single customer-replacement path triggers on `resource_missing`/`customer` from **whichever Stripe call surfaces it first** (layer 1b list or session create); still one replacement, one retry. Test both.
4. **C-4** Snapshot/hold/billing reads all precede any Stripe call (keep the §3.3 order); a test asserts no Stripe call on each early refusal.
5. **C-5** Demo cleanup (step 13) cancels the sandbox subscription **the same day**, or every monthly renewal reaches production through the forwarding link. Record it.
6. **C-6** `npm run test:bos-entitlements` green before hand-over (G-6); `git diff --stat` checked first.

### Approval
[x] Workplan approved with conditions C-1 to C-6 — proceed to implementation

### Code Review — P-3a

**Code Review by SA — 2026-10-07**
**Status:** ✅ Code Approved

Re-ran: `npx jest lib/business-os/billing app/api/business-os app/test-business-os lib/business-os/invites lib/repositories lib/stripe lib/audit components/test-business-os --ci` → 124 suites / 2,722 tests pass; `npm run test:bos-entitlements` → 196 / 5,184 pass (C-6).

| Area | Finding |
|---|---|
| Money safety | Record check + Stripe paged check (`complete:false` → 503, C-2) + CAS lock; loser and mode-mismatch sessions expired, secret never returned (Q-2). `paused` live (dev 3) accepted. Card only, Adaptive Pricing off, no anchor/proration/promo/tax, no `currency`. Metadata built inside `StripeService` from `stripeMetadataKeys` only (dev 6, CF-4 closed). Price = exactly one lookup-key match + `priceProblems` (USD, amount, mode, active). Lock stores Stripe's `expires_at` (C-1). |
| Repository CAS | Both methods `update(…, {count:'exact'})`, no `.select()`, `.eq('user_id')` + `livemode` + customer; `.or()` predicate correct and pinned; ISO input validated against `,`/`+` injection; column allow-lists. |
| Auth / Zod | Flag → 404 first statement, no `getUser`; strict body; ids from session/seam only; price switch off → 503 alert. |
| Hold | `source` additive; unreadable → 503 closed; friend → `TIER_ORDER[0]` from invite config; admin invitee refused. |
| Audit | Registered in events/audience/filters/ownerVisibility/types; `logAndFlush` before 200; refusals log-only. Dev 1, 2, 9 accepted; `owner` visibility leaks nothing (own action, no internal reason). |
| Entitlements | Five non-gates, symbols exact; suite green. |
| Harness | Open to any signed-in user (not admin), but it only calls the caller's own route, which is flag-gated: acceptable. Secret redacted from the viewer, never logged. |
| Windows-only 4 | Unrelated: guard uses `ROOT + '/'` (Windows backslashes); geo suites import nothing in this diff. |

### Optimisation Suggestions
- `planCheckout.ts`: a tier with no Stripe price (owner input) logs `error`+`alert` as `price_unavailable`; a `warn` would avoid false alarms. Non-blocking.

### Code Approved for QA: Yes — QA warranted before the demo (money path, lock race, held-friend paths).

---

## Implementation Notes

**Dev, 2026-10-07.** Every SA ruling and condition, and where it lives:

| Ruling / condition | Where it is met |
|---|---|
| Q-1 session events → P-3b, webhook byte-identical | `app/api/stripe/webhook/route.ts` untouched; only comments in `planInvoiceResolver.ts` re-pointed to P-3b |
| Q-2 session → CAS → expire loser; loser's secret never leaves | `planCheckout.ts` step 14; `planCheckout.test.ts` "the lock race" (incl. two concurrent calls) and the route's `checkout_busy` test |
| Q-3 `source` on the held result, additive | `paymentHold.ts`; its source guard (no entitlements import) still green; the gate reads `held` only |
| Q-4 `no_plan_row` via `getSnapshot()`, read failure 503, non-gate | The route passes `getEntitlementService().getSnapshot(accountId)` as a port; `planCheckout.ts` refuses `plan_unreadable` (503) / `no_plan_row` (409); registered non-gates |
| Q-5 permanent Stripe-side live-subscription check | Step 12, every request |
| Q-6 flag off → 404, nothing read | Flag check is the first statement of `POST` (route source guard); route test asserts an empty call log and no `getUser` call |
| Q-7 three surfaces, fixed paths | `PLAN_CHECKOUT_RETURN_PATHS`: `/business-os/settings?section=plan`, `/invite/awaiting-payment` (imported `AWAITING_PAYMENT_PATH`), `/test-business-os`; `z.enum`, a URL is a 400 |
| Q-8 replacement clears the mirror and the lock; `warn` log | `replaceCustomer` patch; `bos_billing_customer_replaced` at `warn` in `replaceBusinessOsStripeCustomer` |
| Q-9 refusals logged only | `bos_billing_checkout_refused` (with `code`; `error` + `alert: true` for the 5xx-class ones); no refusal audit event |
| Q-10 non-gates, symbols exact | Five `KNOWN_NON_GATE_IMPORTERS` entries: the route, `planCheckout.ts`, `planCheckoutEligibility.ts`, `planCheckoutPrice.ts`, `PlanCheckoutPanel.tsx` |
| Q-11 `onComplete` in the panel | `PlanCheckoutPanel.tsx` |
| Q-12 `checkout_open` refused | Step 9, with `expiresAt` in the body |
| Price switch required, else 503 | Step 4, `checkout_unavailable` + `reason: bos_billing_checkout_prices_switch_off`, `alert` |
| C-1 now + 31 min; lock stores Stripe's expiry | `PLAN_CHECKOUT_SESSION_LIFETIME_SECONDS = 1860`; the lock gets `session.expires_at` (tests use a Stripe expiry that differs from the computed one) |
| C-2 pages through all, else fail closed | `StripeService.listCustomerSubscriptions` (100 per page, up to 10 pages, `complete` flag); `subscription_check_incomplete` (503) |
| C-3 one replacement from whichever call surfaces it | One `try` around list + create; tests for both triggers, a second `resource_missing` (no third call), a lost replacement race |
| C-4 no Stripe call on an early refusal | `planCheckout.test.ts` ordered log: 12 early refusals × "no Stripe call"; the happy path asserts reads `[lineage, snapshot, findByUser]` before the first Stripe call; the route repeats it for 10 refusals |
| C-5 cancel the sandbox subscription the same day | §8 step 13 |
| C-6 `test:bos-entitlements` green, `git diff --stat` first | Evidence Log |

**Deviations from the workplan text (for SA's code review):**

1. **Audit compliance flags: `['SOC2']`, not `['SOC2', 'FINANCIAL']`** (§3.8). SA W11b-3 ruled that FINANCIAL is reserved for AgentsPilot's own platform-billing events and every Business OS money event carries SOC2 alone; the registry comment says so.
2. **Audit `entityId` = the ACCOUNT id, not the billing row id** (§3.8). A new account's row is created inside `ensureBusinessOsStripeCustomer`, which returns only the customer id; a re-read just for the audit id would be one more read on every buy. The billing record is one row per account and mode, and `livemode` is in the details. New entity type `business_os_billing_account`, **owner-visible** (it records the owner's own action and no internal reason), so no owner-policy migration is needed.
3. **`paused` counts as a live subscription** (§3.3 step 9 listed five statuses). Fail closed: a paused subscription resumes without a new checkout, so selling a second beside it is the double-subscription SR-5 forbids.
4. **New refusal code `lock_unavailable` (503)**: the lock write itself failed (a database error, not a lost race). The session is expired and never returned, so no session exists without a lock. **New `subscription_check_incomplete` (503)** for C-2.
5. **A fresh idempotency key per Stripe create, not per request**: the retry after a customer replacement must not reuse the first attempt's key (Stripe would answer an idempotency error, or replay the failure). Shape unchanged: `bos-plan-checkout:<userId>:<uuid>`.
6. **The session's metadata is built inside `StripeService.createBusinessOsPlanCheckoutSession`** from `stripeMetadataKeys.ts`; the method takes `bosUserId`, not a metadata object, so no caller can add a legacy key (CF-4). `lib/stripe/StripeService.ts` therefore imports the three constants.
7. **Customer step**: with a stored row the checkout uses its customer directly; `ensureBusinessOsStripeCustomer` is called only when there is no row (it would re-read the same row otherwise). Behaviour is the P-2a contract either way.
8. **Mode check on the returned session**: a session whose `livemode` differs from the key's mode is expired and refused (`checkout_unavailable`, alert). Not in §3.3; cheap and fail-closed.
9. **Audit filter group** "Business OS Billing" (`BOS_BILLING_` prefix) added to `lib/audit/filterOptions.ts`, because the existing guard refuses an event grouped under "Bos".
10. **G-2 record** also added to the P-2 workplan's evidence log (where SA said it lives), and the main requirement updated (§9.1 P-3a row, §9.4 CF-4 closed, Change History).

**Files touched outside §4's list:** `lib/audit/eventAudience.ts`, `lib/audit/types.ts`, `lib/audit/ownerVisibility.ts`, `lib/audit/filterOptions.ts` and `lib/audit/__tests__/eventAudience.test.ts` (registration of the event, deviation 2 and 9); `lib/business-os/billing/__tests__/businessOsStripeCustomer.test.ts` (its "only caller" guard now lists `planCheckout.ts`, plus the replacement tests); `docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P2_WORKPLAN.md` (G-2).

**`console.*`:** none in any touched file (CLAUDE.md § Logging): the new files use Pino or receive the route's child logger.

---

## Evidence Log

**Base:** `origin/main` `acd2663b`, worktree `neuronforge-invite-s1`, branch `feature/bos-plan-payments-p3a`. All work uncommitted. No production database write, no Stripe call (Stripe is mocked in every test).

**E-1, G-2 read-only schema check (2026-10-07).** Zero-row selects through PostgREST with the main checkout's `.env.local`, nothing written, no row printed: as `service_role`, `select open_checkout_session_id, open_checkout_expires_at, stripe_customer_id, updated_at, stripe_subscription_id, subscription_status from business_os_billing_accounts limit 0` → **OK**; negative control `select no_such_column_zz` → refused **42703**; as `anon`, `select id limit 0` → refused **42501**. The column-level UPDATE grant and the two CHECKs are not readable through PostgREST without writing; they are in the migration body and were covered by the user's checker PASS.

**E-2, demo pre-flight (names only):** see §8 "Pre-flight facts". The sandbox publishable key is present in the main checkout's `.env.local`.

**E-3, tests and checks:**

| Command | Result |
|---|---|
| `npx jest lib/business-os/billing app/api/business-os app/test-business-os lib/business-os/invites lib/repositories --ci` | 103 suites, 2,454 tests: all pass |
| `npm run test:bos-entitlements` | 196 suites, 5,184 tests: all pass |
| `npx jest lib/stripe app/api/stripe lib/audit components/test-business-os app/api/user/data-export app/api/admin/jobs-queues --ci` | 42 suites, 838 tests: all pass |
| `npm test -- --ci` (full suite) | 986 of 994 suites ran: 971 passed, 15 failed, 8 skipped; 19,259 tests passed, 144 failed. 11 of the 15 are the CI quarantine (`.github/ci/jest-quarantine.json`, agent platform, parked). The other 4 (`lib/geo/__tests__/addressFormat.test.ts`, `lib/utils/__tests__/oneAddressPolicy.guard.test.ts`, `components/ui/__tests__/AdminAreaField.render.test.tsx`, `AdminAreaField.search.test.tsx`) touch no file of this slice and fail on this Windows machine only: the guard prints absolute Windows drive-letter paths where it expects repo-relative ones, and the address suites get no subdivision data. CI (Linux) is the arbiter; none of the P-3a suites failed |
| `npx eslint` on the 30 changed or new TS/TSX files | 0 errors. 6 warnings, all on pre-existing lines of `lib/audit/events.ts` (1) and `lib/audit/types.ts` (5) |
| Scoped type-check (the full program built from `tsconfig.json`, diagnostics asked for the 30 changed or new TS/TSX files only) | 0 diagnostics |

New suites: `lib/business-os/billing/__tests__/planCheckout.test.ts` (57), `app/api/business-os/billing/plan/checkout/__tests__/route.test.ts` (35), `lib/business-os/billing/__tests__/planCheckoutPrice.test.ts`, `planCheckoutEligibility.test.ts`, `planCheckoutFlag.test.ts`, `lib/stripe/__tests__/businessOsPlanCheckout.test.ts` (12), `components/test-business-os/__tests__/PlanCheckoutPanel.test.ts`. Extended: the repository test (lock and replacement, 43 in the file), `businessOsStripeCustomer.test.ts` (29), `paymentHold.test.ts`.

**E-4, demo:** not run (§8).

---

## QA Testing Report

*(QA to populate.)*

**QA — 2026-10-07**
**Test mode:** full
**Strategy used:** A (Jest unit on the orchestration, eligibility, repository CAS and `StripeService` pins, all ports faked) + B-shaped route integration (real route + real orchestration, edges faked). No Stripe call, no database write, no dev server; the live demo (§8) was not run, it waits on the user.
**Focus:** api, security (money path, lock race, held-friend paths)
**Skipped:** D (browser) and the §8 demo — owned by the user
**Input source:** TL prompt (payment path, lock race, held friend, flags, customer replacement, mutations)

### Test Coverage
| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Happy path: client secret only in the caller's 200; never in a log line or the audit | ✅ | Pass | `planCheckout.test.ts` happy path + logging; route happy path + log scan |
| Session params pinned: card only, Adaptive Pricing off, subscription, embedded, `expires_at` = now + 1860 s, metadata only `product` + `bos_user_id`; no `user_id`/`credits`/anchor/trial/promo/tax/currency | ✅ | Pass | `lib/stripe/__tests__/businessOsPlanCheckout.test.ts` (exact `toEqual`, smuggled metadata dropped) |
| USD, exact lookup-key price, equal to the display price | ✅ | Pass | `planCheckoutPrice.test.ts`; mismatch → 503 before any customer/session. QA: each tier sends its own lookup-key price |
| Billing row + lock by CAS (count exact, no `.select()`, user_id + livemode + customer, free-lock `or` pinned) | ✅ | Pass | Repository test; the lock stores Stripe's `expires_at` |
| Audit `BOS_BILLING_CHECKOUT_STARTED` flushed before the 200; refusals not audited | ✅ | Pass | Route test asserts the order (lock → audit → response) |
| Lock race: one winner, loser's session expired, its secret never returned | ✅ | Pass | Concurrent `Promise.all` test with a shared fake CAS; route `checkout_busy` |
| Open lock → `checkout_open` (with expiry); expired lock → allowed | ✅ | Pass | QA added the boundary: expiry == now is free (matches the CAS `lte`), now + 1 ms is open |
| Expired lock but live subscription at Stripe → `subscription_live`; `paused` = live | ✅ | Pass | Every live status at Stripe (Dev) and on the record (QA, incl. `paused`) |
| Paged Stripe check incomplete → 503 fail closed | ✅ | Pass | Also after a customer replacement (QA); a partial page that already shows a live sub still refuses (QA) |
| Held friend: friend tier only (from invite config); other tier refused | ✅ | Pass | Refusal reads nothing past the lineage |
| Held admin invitee refused (either tier) | ✅ | Pass | QA added both tiers + invite read failure → `hold_unreadable` |
| Hold read failure → fail closed | ✅ | Pass | Error result (Dev) and a THROWING reader (QA) |
| Not-held owner may pick either tier; a friend who has paid is no longer held | ✅ | Pass | QA added |
| `no_plan_row` 409; snapshot unavailable / throws → 503 | ✅ | Pass | |
| Checkout flag off → 404, zero reads, no `getUser` | ✅ | Pass | Route test + source guard (first statement) |
| Price switch off → 503 alert; signed out → 401 | ✅ | Pass | |
| Strict Zod: injected userId/accountId/customerId/priceId/amount, free URL, unknown tier → 400, nothing read | ✅ | Pass | `returnTo` is a 3-value enum mapped server-side |
| Customer replacement from the subscription list AND from session create; replaces-key; one retry only | ✅ | Pass | QA added: missing at list then again at create → one replacement, `stripe_error`, no lock |
| `billing_row_not_recorded` → 500 `billing_record_conflict`, alert, no retry | ✅ | Pass | On first create (Dev) and on a failed replacement (QA); status table pinned (QA) |

### Mutation checks (each file copied first, restored, verified with `cmp`; `git diff --stat` unchanged)
| Mutation | Result |
|---|---|
| Remove the CAS predicate `.or(checkoutLockFreeFilter(nowIso))` in `acquireCheckoutLock` | Caught: repository suite 2 failed |
| Drop the Stripe-side live-subscription refusal (`if (live)` → `if (false && live)`) | Caught: 9 failed across `planCheckout.test.ts`, `planCheckout.qa.test.ts`, route test |
| Held friend may buy any tier (`tiers: sellableTiers()`) | Caught: 4 failed across eligibility, `planCheckout.test.ts`, route test |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **Orphan session on a thrown lock write** — `planCheckout.ts` step 14 — Low. If `acquireCheckoutLock` *throws* (the repository returns errors rather than throwing, so only an unexpected fault), the route answers 500 without expiring the session just created. Its secret is never returned, so nobody can pay it, and it expires in 31 min. A `try` around the lock call that calls `expireLoser` would close it.
2. SA's open suggestion stands: a tier with no Stripe price logs `error` + `alert` as `price_unavailable` (false alarm risk). Non-blocking.

### What only the live demo (§8) can prove
- Stripe accepts the pinned params (embedded `ui_mode`, `adaptive_pricing`, `expires_at` ≥ 30 min measured at Stripe) and the embedded form renders with the sandbox publishable key.
- Real atomicity of the CAS under PostgREST (`count: 'exact'` without `.select()`, the `or` filter string, the `cs_` CHECK and column grants); unit tests prove the query shape only.
- A real double click producing one payable session; a real deleted test customer triggering replacement with the `:replaces:` key.
- The audit row actually landing, and the webhook seeing the subscription metadata (P-3b scope after that).

### Test Outputs / Logs
```text
npx jest lib/business-os/billing app/api/business-os app/test-business-os lib/business-os/invites lib/repositories lib/stripe lib/audit components/test-business-os --ci
Test Suites: 125 passed, 125 total
Tests:       2754 passed, 2754 total      (SA run: 124 / 2,722; +1 suite / +32 tests = QA file)

npm run test:bos-entitlements
Test Suites: 196 passed, 196 total
Tests:       5184 passed, 5184 total
```
New test file: `lib/business-os/billing/__tests__/planCheckout.qa.test.ts` (32 tests; eslint clean). It takes the billing-row type through the service's port so it does not trip the repository's "only the listed files name the repository" source guard.

### Final Status
- [x] All acceptance criteria pass — ready for commit (after the user sees the diff and runs the §8 demo)
- [ ] Issues found — Dev must address before commit

---

## Commit Info

*(RM to populate. Record also: G-2 evidence (20261025 checker PASS), and that neither switch was turned on in any shared environment.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-07 | Created (Dev) | P-3a workplan: checkout route behind `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` (default off), refusing unless the plan price switch is on; customer create/reuse and compare-and-set replacement with a new idempotency key; SR-5 layer 1 lock written by compare-and-set after session creation (count-exact, no `.select()`), plus a Stripe-side live-subscription check; runtime price check; held friend restricted to the friend tier, fail closed; embedded checkout, card only, Adaptive Pricing off, USD only, no legacy metadata; audit flushed before responding; `/test-business-os` Billing panel; local Stripe CLI demo on the sandbox. No migration. Webhook unchanged (session events proposed for P-3b). 18 tasks, 2.75–3 days. Questions Q-1 to Q-12 for SA |
| 2026-10-07 | Implemented (Dev), uncommitted | All SA rulings Q-1 to Q-12 and conditions C-1 to C-4 and C-6 met (§ Implementation Notes, ten recorded deviations); C-5 is in the demo runbook. G-2 recorded (user's 2026-10-04 statement + read-only schema check). §8 rewritten as a runbook; demo not run (G-5 owed). Tests, `test:bos-entitlements`, eslint and scoped type-check green (§ Evidence Log) |
