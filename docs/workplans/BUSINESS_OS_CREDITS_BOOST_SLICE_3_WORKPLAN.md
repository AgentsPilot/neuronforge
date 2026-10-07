# Workplan: Business OS credits boost — slice 3, checkout (test mode, behind a flag)

> **Last Updated**: 2026-10-07

**Developer:** Dev
**Requirement:** [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md): FR-6 to FR-13, FR-18 to FR-23, FR-27, FR-28, §10.3, HP-3, NFR-1 to NFR-11; SA §18.3 T-3 (c)(d), T-4, T-8, T-10, T-14, T-15; §18.5 slice 3 row; §18.8 R-1; §18.10 slice 3 row and gate, R-9, R-10, F-14 (server flag)
**Carry-forward notes honoured:**
- slice 1: SA C-7 (outside importers registered as non-gates) and QA E-2 (refuse on **any** catalogue rejection);
- slice 2: §3.4b (attach right after the session is created; `boost_checkout_session_in_use` is a refusal and the Stripe session is expired; on `reservation_expired`, expire the session and do not show it);
- 2b: §9 N-1 and I-3 (class-22 and repository validation errors are deterministic);
- 2a: the user's decision that no PROD script writes `auth.users`.

**Worktree:** `neuronforge-boost`
**Branch:** `feature/bos-credits-boost-slice-3`, cut from `origin/main` `5fb0cded` (includes #235 and #236). Not stacked. The worktree was clean before the switch, confirmed with `git branch --show-current` on 2026-10-06.
**Date:** 2026-10-06
**Status:** **Approved and committed 2026-10-07, PR open.** The flag stays unset on Vercel until 4a is deployed. **QA follow-ups applied 2026-10-06 (QA3-D1, QA3-D2, tests R-1 to R-7).** Previously: **QA 2026-10-06: PASS WITH NOTES** (two Low defects, QA3-D1/D2; see QA Testing Report). **SA code review approved 2026-10-06 (after the CR-1 to CR-3 re-check).** Previously: **SA code review 2026-10-06: Fix Required** (CR-1 an ambiguous Stripe create failure must not abandon; CR-2 an all-invalid test-account list must close, not open; CR-3 `logAndFlush`). Previously: **Code Complete 2026-10-06, awaiting SA code review.** SA workplan review: approved with conditions C-1 to C-7 (C-8 binding on 4a), applied in §3.0; the user approved the build. Tests and scoped tsc are green (§6.4). Nothing is committed.

## Overview

Slice 3 lets the server start a boost purchase: **`POST /api/business-os/credits/boost/checkout`**, with body `{ packageId }`. Behind a server-only flag, default **off**, it:

1. checks that the caller is signed in and not awaiting payment;
2. reads the package from the catalogue;
3. reserves the purchase under the $150 / 30-day cap (2a's `reserve`);
4. creates a Stripe **embedded** checkout session for exactly that package (USD, inline price, tax-exclusive, Adaptive Pricing off, no promotion codes, our purchase id as the reference, 30-minute expiry);
5. attaches the session to the reservation (2a's `attach`);
6. returns the session's `client_secret`.

Any failure after the reservation releases it (`abandon`), and expires the Stripe session when one was created.

Nothing credits yet: that is 4a's webhook. Nothing appears in the owner's UI: that is slice 5. **Stripe stays in test mode**, and no Stripe customer is created (R-9).

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope, out of scope and guardrails](#2-scope-out-of-scope-and-guardrails)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Task List](#5-task-list)
6. [Test Plan](#6-test-plan)
7. [How QA verifies without a real Stripe account, and the manual test-mode check](#7-how-qa-verifies-without-a-real-stripe-account-and-the-manual-test-mode-check)
8. [CI impact, entitlements, estimate and risks](#8-ci-impact-entitlements-estimate-and-risks)
9. [Notes for slices 4a and 5](#9-notes-for-slices-4a-and-5)
10. [Open questions for SA](#10-open-questions-for-sa)
11. [SA Review Notes](#sa-review-notes)
12. [QA Testing Report](#qa-testing-report)
13. [Commit Info](#commit-info)
14. [Change History](#change-history)

---

## 1. Analysis Summary

**Verified at `5fb0cded` (2026-10-06).**

| Thing | Where | Use in slice 3 |
|---|---|---|
| The package catalogue: `codeBoostPackageSource().getActive(id)` → a frozen `BoostPackage` or `null`; **rejects** on an invalid catalogue | `lib/business-os/entitlements/boostCatalogue.ts` (slice 1) | Read the package. Any rejection means the checkout refuses (E-2) |
| `BOOST_PURCHASE_CAP_DEFAULT` `{ amountMinor 15000, currency 'USD', windowDays 30 }` | `config/boostPackages.ts` | Passed to `reserve` (Q-4 of 2a) |
| `BusinessOsBoostPurchaseRepository`: `reserve` (`reserved` / `cap_reached` / `no_plan_row`), `attachCheckout` (6 statuses, `boost_checkout_session_in_use` on 23505), `abandon` | `lib/repositories/BusinessOsBoostPurchaseRepository.ts` (2a/2b, on PROD) | The three writes of the route |
| `readPaymentHold(accountId, readers)`: `{ ok, held }`; the fail-closed use is in `creditAdminOps.ts` (11b) | `lib/business-os/invites/paymentHold.ts` | R-1, fail closed |
| `currentStripeMode()` (throws on an unknown key) | `lib/business-os/billing/stripeMode.ts` | `livemode` for the reservation (R-10) |
| `BOS_PRODUCT_METADATA_KEY = 'product'`, `BOS_BOOST_PRODUCT_MARKER = 'business_os_boost'` | `lib/business-os/billing/stripeMetadataKeys.ts` (P-1) | Session and payment-intent metadata: the dispatcher's cross-check marker (R-6) |
| `StripeService`: `stripe` is **private**, apiVersion `2025-10-29.clover`, `getStripeService()` singleton; its old `createBoostPackCheckout` (switched off, FR-40) is the only embedded `mode: 'payment'` envelope in the repo, and it creates a customer, uses `* 100` and has no marker, so it **is not reused** | `lib/stripe/StripeService.ts` | **Not changed** (§17). Q-1 decides how slice 3 gets a client |
| No Business OS checkout route exists yet (plan payments P-3a is not on `main`) | — | Boost builds the first one. §3.3 is written so P-3a can reuse the client module |
| Owner-route pattern: flag → 404 before the session; `getUser`; `force-dynamic`, `no-store`; correlationId | `app/api/business-os/credits/history/route.ts` | Mirrored |
| Server-only flag pattern (`parseBooleanFlag`, no `NEXT_PUBLIC_`) | `lib/utils/featureFlags.ts` (`isAdminBusinessDeleteEnabled`) | New reader `isBusinessOsCreditsBoostEnabled()` |
| Audit registry: `AUDIT_EVENTS` + metadata in `lib/audit/events.ts`, audience in `lib/audit/eventAudience.ts` | — | New event `BOS_BOOST_CHECKOUT_STARTED` |
| `@stripe/stripe-js` / `@stripe/react-stripe-js` are already dependencies | `package.json` | Slice 5 mounts the embedded checkout; nothing new here |

---

## 2. Scope, out of scope and guardrails

### In scope

| # | Item |
|---|---|
| S-1 | `POST /api/business-os/credits/boost/checkout` (new-api-route skill) |
| S-2 | `lib/business-os/boost/boostCheckout.ts`: pure orchestration over injected dependencies (the `creditAdminOps.ts` pattern), so every branch is unit-testable without HTTP or Stripe |
| S-3 | `lib/business-os/boost/boostCheckoutSession.ts`: builds the Stripe session parameters from a package and a reservation (pure), and creates / expires the session through an injected Stripe client |
| S-4 | `lib/business-os/billing/stripeClient.ts`: the Business OS server Stripe client (Q-1) |
| S-5 | `isBusinessOsCreditsBoostEnabled()` (server-only, default off) in `lib/utils/featureFlags.ts` + `docs/feature_flags.md` |
| S-6 | Audit event `BOS_BOOST_CHECKOUT_STARTED` registered (events, audience) |
| S-7 | Entitlements registration of the outside importer(s) of slice 1 code (C-7) |
| S-8 | Tests (§6); docs (entitlements doc paragraph, requirement status) |

### Out of scope

| Not in slice 3 | Where |
|---|---|
| A `GET` of the active packages for the picker | **Slice 5** (Q-4). It is the picker's data. It must be added to the credit-figure guard's `SOURCES` with the picker, and nothing calls it before slice 5 |
| Any owner UI, a `/test-business-os` harness card, the "payment processing" state | Slice 5 (Q-5 asks whether a harness card belongs here) |
| The webhook resolver and handler, crediting, the receipt | 4a (`credit`, `recordReceipt` already exist from 2b) |
| Refunds, disputes, the reconcile pass | 4b |
| A Stripe customer: created, or reused from `business_os_billing_accounts` | Never created (R-9). Reuse is optional by R-9 and **not done** (Q-2) |
| Stripe Tax collection | Off (T-14); the switch is DEP-7's outcome |
| Any write to `auth.users`, the lots or the charge tables | Never |

### Guardrails

| # | Guardrail | Checked by |
|---|---|---|
| G-1 | The client sends **only** `{ packageId }`. Price, credits, currency, mode and account come from the catalogue, the key and the session (FR-8). The schema is `.strict()` | Route test: extra fields → 400, nothing reserved |
| G-2 | The account is `user.id` from the verified session, never from the request | Route test (an injected `accountId` / `userId` is ignored or refused) |
| G-3 | No reservation is left `pending` without a session after a failed request. Every failure after `reserve` calls `abandon` (best effort, logged) | Orchestrator tests, one per failure point |
| G-4 | No Stripe session is left open after a failed attach: it is expired (best effort, logged) | Orchestrator tests |
| G-5 | No Stripe customer is created: no `customers.create`, no `customer:` parameter, no import of `businessOsStripeCustomer` or `StripeService` in the boost module (R-9, §17) | Source guard |
| G-6 | Adaptive Pricing is off, currency `usd`, `tax_behavior: 'exclusive'`, `automatic_tax` off, promotion codes off (T-14, T-15, F-7) | Session-builder tests pin the exact parameters |
| G-7 | Flag off: the route answers 404 before reading the session or anything else (the credit-history pattern) | Route test |
| G-8 | No `console.*`; Pino with `correlationId`; production errors carry no internals | Review + route test (`details` only in development) |

---

## 3. Implementation Approach

### 3.0 SA conditions applied (2026-10-06)

These override the text below where they differ.

| # | Applied as |
|---|---|
| **C-1** | **`BUSINESS_OS_CREDITS_BOOST_ENABLED` stays unset on Vercel (Preview and Production) until 4a is merged and deployed.** Before 4a, a paid boost session reaches the agent-platform handler, which does nothing and marks the event completed, so the payment would be lost to the webhook. The local manual check (§7) **must not complete a payment**. The test-account list does not change this. Written in §3.5, §7 and `docs/feature_flags.md` |
| **C-2** | `abandon` is called **only** when no Stripe session was created, or after `expire` **succeeded**. If `expire` fails, it is retried once. If it still fails, the row is left `pending` and an `error` log `bos_boost_orphan_session` is written with `alert: true`, the purchase id and the session id. If that session is then paid, 4a reaches the row (C-8 a) and 2b's `credit` flags it. Orchestrator tests cover every branch |
| **C-3** | `expires_at = now + 1860 s` (31 minutes) for the Stripe session, and `checkoutTtlSeconds: 1860` for `reserve` (within 1,800–86,400 and inside attach's 24 h 5 min bound). The builder test pins it |
| **C-4** | After logging `BOS_BOOST_CHECKOUT_STARTED`, the route `await`s `auditTrail.flush()` (with `.catch` → `error` log) before responding (new-api-route WC-7) |
| **C-5** | When `user.email` is null, `customer_email` and `receipt_email` are **omitted** (Stripe collects the email in checkout). One builder test |
| **C-6** | `return_url` is built from `NEXT_PUBLIC_APP_URL`. Only when `NODE_ENV === 'development'` does it fall back to the request origin. In production with the variable unset, the route refuses with `payments_unavailable` and an `error` log |
| **C-7** | `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS` is parsed as comma-separated **UUIDs**: blanks are ignored, and an invalid entry is logged once at `warn`. **Unset means open to every account while the flag is on** (that is the launch switch), and `docs/feature_flags.md` says so. `stripeClient.ts` starts with `import 'server-only'` |
| **C-8** | Binding on 4a; recorded in §9 |

Rulings: Q-1 a new `stripeClient.ts`; Q-2 no customer reuse; Q-3 `return_url` per C-6; Q-4 and Q-5 deferred to slice 5; Q-6 the test-account list per C-7; Q-7 `cap_reached` logged at `warn` only; Q-8 dynamic payment methods. **`adaptive_pricing` is typed in `stripe@19.2.1`, so no cast is needed.**

### 3.1 The route — `app/api/business-os/credits/boost/checkout/route.ts`

`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `Cache-Control: private, no-store` on every answer.

```
POST
  1. flag off                → 404 { success:false, error:'Not found' }      (before anything)
  2. getUser() null          → 401
  3. body: z.object({ packageId: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/) }).strict()
                             → 400 'Invalid input' (details in development only)
  4. runBoostCheckout(deps, { accountId: user.id, email: user.email, packageId, origin }, log)
  5. map the outcome (§3.2) to a status and a user-safe error code; audit on success
```

The route holds no logic beyond parse, auth, mapping and the audit call. Everything else is in the orchestrator, behind injected dependencies.

### 3.2 The orchestrator — `lib/business-os/boost/boostCheckout.ts`

`runBoostCheckout(deps, input, log)` → `BoostCheckoutOutcome`. The steps, in order (pinned by tests):

| Step | Does | Refusal (HTTP, code) |
|---|---|---|
| 1 | **Payment hold**, fail closed (R-1): `readPaymentHold(accountId, readers)`; a throw or `{ ok:false }` → refuse | 500 `payment_hold_check_failed`; held → 409 `awaiting_payment` |
| 2 | **Package**: `source.getActive(packageId)`. **Any** rejection (not only `BoostCatalogueInvalidError`, QA E-2) → refuse and log `error` with the issues if present | 503 `catalogue_unavailable`; `null` → 404 `unknown_package` |
| 3 | **Mode**: `currentStripeMode()` (throws on a bad key) | 500 `payments_unavailable` |
| 4 | **Reserve**: `repo.reserve({ accountId, livemode, packageId, packageVersion, retailVersion, creditValueVersion, priceMinor, currency, creditsBase, creditsBonus, defaultCapMinor: cap.amountMinor, windowDays: cap.windowDays, checkoutTtlSeconds: 1800 })`, field by field from the frozen package | `no_plan_row` → 403 `not_eligible`; `cap_reached` → 409 `cap_reached` (with nothing else: no figures, FR-20's message is the client's); `{ error }` → 500 `reservation_failed` (deterministic, N-1/I-3: no retry) |
| 5 | **Session**: `createBoostCheckoutSession(stripe, params)` (§3.3), Stripe idempotency key `bos-boost-checkout:` ∥ purchase id (T-4). Then check `session.livemode === livemode`, `session.amount_subtotal === priceMinor`, `session.currency === 'usd'`, `session.client_reference_id === purchaseId` | Throw → `abandon` → 502 `checkout_unavailable`. A cross-check mismatch → expire the session, `abandon`, `error` log `bos_boost_session_mismatch` → 502 `checkout_unavailable` |
| 6 | **Attach**: `repo.attachCheckout({ accountId, purchaseId, sessionId, checkoutExpiresAt: session.expires_at })`. Only `attached` / `already_attached` succeed | `boost_checkout_session_in_use` error, `session_conflict`, `reservation_expired`, `not_pending`, `not_found` or `{ error }` → **expire the Stripe session** (§3.4b), `abandon` (it is a no-op answer when the row has a session), `error` log → 502 `checkout_unavailable` |
| 7 | Success → `{ ok: true, purchaseId, clientSecret, expiresAt, package: { id, version }, livemode }` | — |

"Best effort" steps (abandon, expire) never change the answer. A failure is logged at `error` with the purchase id, and the 4b reconcile pass covers a leftover row: an unattached `pending` row stops counting after expiry plus 5 minutes anyway.

**Dependencies (injected; production wiring in `boostCheckoutDeps.ts`):** `holdReaders`, `packageSource` (`codeBoostPackageSource()`), `cap` (`BOOST_PURCHASE_CAP_DEFAULT`), `repo` (`businessOsBoostPurchaseRepository`), `stripe` (§3.3), `mode` (`currentStripeMode`), `now`.

### 3.3 The session — `lib/business-os/boost/boostCheckoutSession.ts`

`buildBoostCheckoutSessionParams({ package, purchaseId, email, returnUrl, now })` is pure and returns exactly:

```typescript
{
  mode: 'payment',
  ui_mode: 'embedded',
  customer_email: email,                         // R-9: no customer object; receipt goes here
  client_reference_id: purchaseId,               // T-4 routing identity
  line_items: [{
    quantity: 1,
    price_data: {
      currency: 'usd',                           // FR-28, from the package; never converted
      unit_amount: pkg.priceMinor,               // integer minor units from the catalogue (NFR-9)
      tax_behavior: 'exclusive',                 // T-14: inert while tax is off
      product_data: { name: pkg.labels.name.en } // no figures typed; the credits are shown by slice 5
    },
  }],
  metadata: { product: 'business_os_boost', purchase_id, package_id, package_version },
  payment_intent_data: {
    receipt_email: email,                        // FR-27, T-8
    metadata: { product: 'business_os_boost', purchase_id, package_id, package_version },
  },
  adaptive_pricing: { enabled: false },          // T-15 / F-7
  automatic_tax: { enabled: false },             // T-14
  allow_promotion_codes: false,                  // T-7: 'no_payment_required' never happens
  expires_at: nowSeconds + 1800,                 // 30 min: Stripe's minimum; inside attach's 24 h 5 min bound
  return_url: returnUrl,                         // Q-3
}
```

`createBoostCheckoutSession(client, params, { idempotencyKey })` and `expireBoostCheckoutSession(client, sessionId)` are thin calls on an injected client (`Pick<Stripe, 'checkout'>`).

- **T-15:** the workplan's first task verifies that `adaptive_pricing` is accepted on API version `2025-10-29.clover` with the installed `stripe@19` types. If the types reject it, the builder casts one documented field, and SA is told.
- **The metadata keys** come from `stripeMetadataKeys.ts`, never as string literals.

### 3.4 The Stripe client — `lib/business-os/billing/stripeClient.ts` (Q-1)

`getBusinessOsStripeClient()` returns a lazily created singleton, `new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION })`. `StripeService` keeps its private client, so it is unchanged (§17). The module throws if the key is missing; the orchestrator maps that to `payments_unavailable`. A guard test reads `StripeService.ts` and asserts that its apiVersion literal equals `STRIPE_API_VERSION`, so the two cannot drift. It sits in `billing/` so plan payments P-3a can reuse it.

### 3.5 Flag, audit, logging

- **Flag:** `isBusinessOsCreditsBoostEnabled()` reads the server-only `BUSINESS_OS_CREDITS_BOOST_ENABLED` (default off). **(C-1) It stays unset on Vercel Preview and Production until 4a is merged and deployed.** It is documented in `docs/feature_flags.md`. **Test accounts only (Q-6):** an optional `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS` (comma-separated user ids). When it is set, only those accounts pass and everyone else gets 404, so PROD (Stripe test mode) can be exercised by the team without opening the feature (§18.10 go-live note).
- **Audit:** `BOS_BOOST_CHECKOUT_STARTED`. Entity `business_os_boost_purchase` with the purchase id. Details: package id and version, price minor, currency, livemode, and **no** client secret. Severity `info`; audience `bos`. It is non-blocking (`.catch` → `error` log). It is written only on success; refusals are logged, not audited, as for other owner routes. Q-7 asks whether `cap_reached` should be audited.
- **Logging:** `createLogger({ module: 'BusinessOsBoostCheckoutAPI' })` with `correlationId`. Events: `bos_boost_checkout_started`, `bos_boost_checkout_refused` (with the code), `bos_boost_session_mismatch`, `bos_boost_abandon_failed`, `bos_boost_session_expire_failed`. The client secret and the email are never logged.

### 3.6 Entitlements registration (C-7)

`boostCheckoutDeps.ts` imports `codeBoostPackageSource` and `BOOST_PURCHASE_CAP_DEFAULT`, and `boostCheckout.ts` imports `type BoostPackage, type BoostPackageSource, type BoostPurchaseCap`. Both are registered in `KNOWN_NON_GATE_IMPORTERS` (`enforcementPoints.test.ts`) with their exact symbols and a `why`: they refuse by catalogue validity and the cap, never by plan or capability. The route itself imports nothing from the module. `npm run test:bos-entitlements` is part of the definition of done.

---

## 4. Files to Create / Modify

| File | Action |
|---|---|
| `app/api/business-os/credits/boost/checkout/route.ts` | create |
| `app/api/business-os/credits/boost/checkout/__tests__/route.test.ts` | create |
| `lib/business-os/boost/boostCheckout.ts`, `boostCheckoutDeps.ts`, `boostCheckoutSession.ts` | create |
| `lib/business-os/boost/__tests__/boostCheckout.test.ts`, `boostCheckoutSession.test.ts` | create |
| `lib/business-os/billing/stripeClient.ts` + `__tests__/stripeClient.test.ts` | create |
| `lib/utils/featureFlags.ts`, `docs/feature_flags.md` | modify |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts` (+ their guards) | modify |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify (two `KNOWN_NON_GATE_IMPORTERS` entries) |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`, the requirement | modify (one paragraph; status and Change History) |

No migration. No change to `StripeService.ts`, the webhook, the dispatcher or any repository.

---

## 5. Task List

- ✅ T3.0: Branch confirmed; scratch Jest and tsc configs; check `adaptive_pricing` against the installed `stripe` types and API version (§3.3)
- ✅ T3.1: `stripeClient.ts` + apiVersion guard
- ✅ T3.2: `boostCheckoutSession.ts` + tests (exact parameters, metadata from the constants, expiry bound)
- ✅ T3.3: `boostCheckout.ts` + deps + tests (every step and failure)
- ✅ T3.4: The flag reader + docs
- ✅ T3.5: The route + integration tests
- ✅ T3.6: Audit registration + guards
- ✅ T3.7: Entitlements registration; run the `test:bos-entitlements` file set
- ✅ T3.8: Docs; requirement status
- ✅ T3.9: Local bar, scoped tsc, `git diff --stat`; Code Complete. **Leave uncommitted**

---

## 6. Test Plan

### 6.1 Route integration — `app/api/business-os/credits/boost/checkout/__tests__/route.test.ts`

The real route and orchestrator run. The session, the repository client (the Supabase RPC fake), the hold readers, the catalogue source and the Stripe client are faked.

| Case | Expect |
|---|---|
| Happy path | 200 `{ success:true, data:{ clientSecret, purchaseId, expiresAt } }`, `no-store`. Reserve, then the session, then attach, in that order. Audit called once with the purchase id and no secret |
| Flag off | 404 before `getUser`; nothing read |
| Test-account list set, caller not on it | 404 |
| No session | 401; nothing reserved |
| Invalid input: no `packageId`, a bad slug, extra fields (`price`, `credits`, `accountId`) | 400; nothing reserved (G-1, G-2) |
| Held account / hold unreadable | 409 `awaiting_payment` / 500; nothing reserved (R-1) |
| Unknown or inactive package / catalogue rejects (an invalid catalogue **and** a plain `Error`) | 404 / 503; nothing reserved (E-2) |
| `no_plan_row` / `cap_reached` / reserve `{ error }` | 403 / 409 / 500; no Stripe call |
| Stripe create throws | 502; `abandon` called with the purchase id |
| Session cross-check mismatch (livemode, amount, currency, reference) | 502; the session expired; `abandon` called |
| Attach answers `boost_checkout_session_in_use` / `reservation_expired` / `session_conflict` / `{ error }` | 502; the session expired; `abandon` called |
| `abandon` or `expire` itself fails | Same refusal; an `error` log; no throw |
| Production error body | No `details` |

### 6.2 Unit

- **`boostCheckoutSession.test.ts`:**
  - the exact parameter object for each package;
  - `unit_amount` equals `priceMinor`, never a multiplication;
  - metadata from the constants;
  - `expires_at` within 1,800 s of now and inside the 24 h 5 min bound;
  - no `customer`;
  - the idempotency key format;
  - `expire` calls `checkout.sessions.expire(id)`.
- **`boostCheckout.test.ts`:** each step's order and every outcome; best-effort failures never change the answer; account and email come from the input only.
- **`stripeClient.test.ts`:** the apiVersion literal equals `StripeService`'s (a source read); a missing key throws.
- **Source guards:** the boost module never names `customers.create`, `businessOsStripeCustomer`, `StripeService`, `* 100` or `user_subscriptions`. The route never reads a body field but `packageId`.
- **Audit:** the existing `lib/audit/__tests__` guards (registry, audience) pass with the new event.

### 6.3 Commands

Local (scratch configs, `--runTestsByPath`): the new suites plus `enforcementPoints`, `tierLiteral.forbidden`, `creditFigures.fromConfig.guard`, `accountSeam.guard`, the `lib/audit/__tests__` guards and the slice 1/2 suites. Scoped tsc: 0 errors in the touched files. CI runs `test:bos-entitlements`, the Jest gate and the required type-check.

---

### 6.4 Results (Dev, 2026-10-06)

| Check | Result |
|---|---|
| `app/api/business-os/credits/boost/checkout/__tests__/route.test.ts` (scratch config, `--runTestsByPath`) | ✅ Happy path, with the audit entry and its flush before the answer (C-4); flag off → 404 before the session is read; the test-account list; 401; seven invalid inputs → 400 with no details in production; C-5 (no email); C-6 (production without `NEXT_PUBLIC_APP_URL` → `payments_unavailable`); held account, unknown package, cap reached, no plan row; Stripe failure → the reservation abandoned |
| `lib/business-os/boost/__tests__/boostCheckout.test.ts` | ✅ See the C-2 branch list below |
| `lib/business-os/boost/__tests__/boostCheckoutSession.test.ts` | ✅ The exact Stripe parameters; the marker from the constants; the 1,860 s expiry inside 24 h 5 min; C-5; no customer; no `* 100`; the idempotency key; source guards (no customer creation, no `StripeService`, no agent-platform tables, no typed credit figure) |
| `lib/business-os/boost/__tests__/boostCheckoutAccess.test.ts` | ✅ See the access and client list below |
| Broad set: the whole `test:bos-entitlements` file set, the new suites, `featureFlags` and `entitlementSqlScripts.guard` (JSX-capable scratch config) | ✅ **204 suites, 5,357 tests.** `enforcementPoints` passes with the two new non-gate entries. The audit guards pass after two deliberate pin updates (deviation 1) |
| Scoped tsc (`tsconfig.slice3.json`: the route, the boost module, the client, the flag file, the audit files and the touched tests) | ✅ **0 errors** |

**`boostCheckout.test.ts` covers:**
- the order of the steps, and the exact `reserve` arguments (`checkoutTtlSeconds: 1860`);
- every refusal before the reservation writes nothing;
- **C-2:**
  - Stripe create fails → abandon only;
  - a session cross-check fails (5 cases) → expire, then abandon;
  - attach fails (5 cases) → expire, then abandon;
  - expire fails once and succeeds on the retry → abandon;
  - expire fails twice → **no abandon**, and `bos_boost_orphan_session` with `alert: true`;
- an abandon that fails or throws never changes the answer.

**`boostCheckoutAccess.test.ts` covers:**
- the flag off closes everything; no list means open to every account;
- the list is parsed as UUIDs, case-insensitive; an invalid entry is warned once, without logging the ids;
- the C-6 return-URL rules;
- the client starts with `import 'server-only'`, its apiVersion equals `StripeService`'s, and a missing key throws on use.

**SA code review fixes (Dev, 2026-10-06):**

| # | Change | Tests |
|---|---|---|
| CR-1 | A failed Stripe create no longer always abandons. **A definite rejection** (`StripeInvalidRequestError`, `StripeAuthenticationError`, `StripePermissionError`, `StripeRateLimitError`, `StripeCardError`, matched on the error's `type`), or an error thrown while building the parameters (before any request), abandons. **Anything else** (timeout, connection, 5xx, idempotency, unknown) is retried once with the **same** idempotency key. If the retry returns a session, it is expired and then the reservation abandoned (C-2 rules apply to the expire). If the retry fails too, the row stays `pending` and `bos_boost_session_unknown` is logged at `error` with `alert: true` and the purchase id; the correlation id is on the child logger | `boostCheckout.test.ts`: each of the five definite rejections → one call, abandon, no expire; a connection error, then a session on the retry with identical arguments → expire + abandon; an API error twice → no expire, no abandon, the alert; `isDefiniteStripeRejection` for a plain `Error`, connection and idempotency errors (all indeterminate). The route's Stripe-failure test now throws a typed `StripeInvalidRequestError` |
| CR-2 | A set, non-blank `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS` **always restricts**. With no valid UUID it is an empty set, so the checkout is closed to all, and an `error` is logged once (never the entries). Only unset or blank means open | `boostCheckoutAccess.test.ts`: `'not-a-uuid,also-bad'` → an empty set, one error, closed; an email list → closed, with no email in the logs; blank → open |
| CR-3 | The route's audit write is `await logAndFlush(entry, requestLogger, { reason: 'boost checkout started', continues: 'the checkout answer is unaffected' })` from `lib/audit/boundedAuditFlush.ts` (a 2 s bound, never throws), replacing the raw `log` + `flush` | Route test mocks `logAndFlush` and checks it is called once with the entry, before the answer |

**Re-run after the fixes:**
- **The four new suites:** 77 tests.
- **The broad set** (the whole `test:bos-entitlements` file set, the new suites, `featureFlags`, `entitlementSqlScripts.guard`, the audit guards, `enforcementPoints`): **204 suites, 5,365 tests**, all green.
- **Scoped tsc:** 0 errors.

**QA follow-ups (Dev, 2026-10-06):**

| # | Change | Tests |
|---|---|---|
| QA3-D1 | In `runBoostCheckout`, the `reserve` and `attachCheckout` calls are wrapped so a throw is treated like `{ error }`. A throwing reserve → `reservation_failed`, and nothing else happens. A throwing attach goes through the normal release: expire (one retry), then abandon per C-2; if the expire fails twice, `bos_boost_orphan_session` alerts and the row is not abandoned | R-1 (three cases) |
| QA3-D2 | A Stripe error is never logged as the object or its message. The new `stripeErrorFacts(error)` keeps only `{ type, code, param, requestId, statusCode }`, and is used on the create, retry and expire logs. The parameter-build and `payments_unavailable` logs carry only the error name (and a fixed reason) | R-2 (two cases: an error whose message and `raw` carry the email → the email is absent from every log call; the request id survives) |
| R-3 | Confirmed as intended and documented in the orchestrator header: an indeterminate create, then a **definite** rejection on the retry, leaves the row `pending` with the `bos_boost_session_unknown` alert. The first attempt may have created a session, so nothing is expired or abandoned | R-3 |
| R-4 | Cross-check: currency `USD` (upper case), a null `amount_subtotal`, or a null `expires_at` → mismatch → expire, then abandon | R-4 (three cases) |
| R-5 | Allow-list: own id in upper case and space-padded → open; a two-entry list → open; a braced id, a commas-only list, or another account's id → closed | R-5 (five cases) |
| R-6 | Production with a blank `NEXT_PUBLIC_APP_URL` → 500 `payments_unavailable`, nothing reserved; a hostile Host is never used | R-6 |
| R-7 | `packageId` of 33 characters, 100,000 characters, or `plüs` → 400, nothing reserved | R-7 (three cases) |

**Re-run after the QA follow-ups:**
- **The four new suites:** 95 tests, all green (was 77).
- **The broad set** (the `test:bos-entitlements` file set rebuilt with `find`, the boost suites, `featureFlags`, `entitlementSqlScripts.guard`; JSX scratch config): **200 suites, 5,338 tests**, all green. This list has 4 fewer suites than the earlier 204 because it was rebuilt by hand; the count is not a regression.
- **Scoped tsc** (`tsconfig.slice3.json`): 0 errors.

**Deviations from the plan (small, for SA code review):**
1. **The audit catalogue pins moved on purpose.**
   - `lib/audit/__tests__/eventAudience.test.ts` now expects 184 events, 39 of them `bos` (was 183 and 38).
   - `lib/audit/filterOptions.ts` gains a `BOS_BOOST_` group, "Business OS Credits Boost", because an existing guard refuses a stray "Bos" group label.
2. **A new audit entity type, `business_os_boost_purchase`,** is classified `owner` in `lib/audit/ownerVisibility.ts`: it is the owner's own action and carries no internal reason. The owner-hidden set, and so the owner-policy migration, are unchanged.
3. **The flag, allow-list and return-URL rules sit in a small module of their own,** `lib/business-os/boost/boostCheckoutAccess.ts`, so they are unit-tested apart from the route. The route checks the bare flag first (404 before the session is read), then the allow-list after `getUser`.
4. **The orchestrator also refuses a session with no `client_secret` or no `expires_at`,** as part of the cross-check.
5. **The flags doc is `docs/FEATURE_FLAGS.md`** (the repository's casing; CLAUDE.md links it in lower case). It is now version 1.7.0, with a section and a table row.

## 7. How QA verifies without a real Stripe account, and the manual test-mode check

**Without Stripe (the definition of done).** Every Stripe interaction goes through an injected `Pick<Stripe, 'checkout'>`. QA verifies with the mocks: the route and orchestrator suites, plus the session-builder suite that pins the exact parameters sent to Stripe. The repository calls hit the real 2a functions only on PROD, but their behaviour is already proven (2a and 2b probes, PGlite). QA can add a PGlite pass that runs `reserve` → `attach` → `abandon` with the orchestrator's argument shapes.

**(SA C-1) The manual check must NOT complete a payment.** Until 4a is deployed, a paid boost session would be swallowed by the agent-platform webhook handler.

**Manual test-mode check (optional, needs a Stripe test key).** The user's local key is an empty sandbox, which is enough. Steps:

1. Set `STRIPE_SECRET_KEY=sk_test_…`, `BUSINESS_OS_CREDITS_BOOST_ENABLED=true` and `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS=<own id>` locally.
2. Sign in, then `POST /api/business-os/credits/boost/checkout` with `{ "packageId": "starter" }` (browser devtools or curl with the session cookie).
3. Expect a `clientSecret` (`cs_test_…_secret_…`).
4. In the Stripe test dashboard, the session shows `mode: payment`, USD 10.00, the metadata marker, `client_reference_id` = the purchase id, no customer, and an expiry about 30 minutes out.
5. In the database, the purchase row is `pending` with the session id attached.
6. Nothing is paid or credited, and the row stops counting after expiry plus 5 minutes.

Paying the session needs slice 5's embedded mount, or Stripe's hosted test, and crediting needs 4a. **Local runs write to the PROD database** (the environments share it), so the test-account list keeps it to the user's own account.

---

## 8. CI impact, entitlements, estimate and risks

- **CI:** no new job or dependency. The tests run in the Jest gate; the entitlements and audit guards run in the entitlements job.
- **Entitlements:** two `KNOWN_NON_GATE_IMPORTERS` entries (§3.6).
- **Estimate:** **about 2 to 2.5 days**: route 0.5, orchestrator 0.5, session and client 0.5, tests 0.5–0.75, flag, audit, registration and docs 0.25. No split is needed. If SA wants the `GET` packages route or a harness card here (Q-4, Q-5), that adds about 0.5 day.

| Risk | Mitigation |
|---|---|
| A reservation left pending after a crash between reserve and attach | It stops counting after expiry plus 5 minutes (2a); the 4b reconcile pass expires it |
| An open Stripe session with no purchase link | It is expired on any attach failure; it also expires itself in 30 minutes; a payment on it would resolve by `client_reference_id`, and 4a flags a mismatch, never credits |
| Double click → two reservations | Both count toward the cap (FR-23); each has its own session; 4a credits whichever is paid |
| `adaptive_pricing` unsupported by the installed types | Checked first (T3.0); one documented cast at most |
| Shared database in local runs | The test-account list (Q-6) |

---

## 9. Notes for slices 4a and 5

| For | Note |
|---|---|
| 4a | Resolve by `findBySessionIdForWebhook(session.id)`, then pass the **row id** to `credit` (never `client_reference_id` unchecked). Map class-22 errors and repository validation errors as deterministic (N-1, I-3). `lot_key_conflict` alerts |
| **4a (SA C-8, binding)** | (a) If `findBySessionIdForWebhook` misses on a platform `checkout.session.*` event that carries the boost marker, fall back to the row by `client_reference_id` (platform-created, so it is our id), then call `credit`. The `no_session` / `session_mismatch` flags make an orphan session visible (C-2). Only with **no row at all** does it deny `metadata_mismatch` with an alert. (b) `credit` → `not_creditable` on a session Stripe reports **paid** is an `error` with `alert: true`, `bos_boost_paid_not_creditable`, plus an audit entry, not a `warn`; the 4b reconcile pass lists such rows. **The flag stays off in deployed environments until 4a is deployed (C-1)** |
| 5 | The picker reads a `GET` packages route (added in slice 5 and listed in the credit-figure guard's `SOURCES`). The embedded checkout mounts with `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and the `clientSecret`. Map the route's codes: `cap_reached` → the FR-20 message with the support contact; `awaiting_payment`; `catalogue_unavailable` / `checkout_unavailable` → "try again later"; `not_eligible` |

---

- **Follow-up for the user (I-2, not in this slice):** CLAUDE.md links the flags doc as `/docs/feature_flags.md`, but the file is `docs/FEATURE_FLAGS.md`, so the link is broken on case-sensitive systems. CLAUDE.md is out of scope here; the user decides whether to fix the link.

## 10. Open questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | The Stripe client. `StripeService.stripe` is private and §17 says `StripeService.ts` is not changed | A new `lib/business-os/billing/stripeClient.ts` singleton, with the apiVersion pinned equal to `StripeService`'s by a guard test, reusable by P-3a. The alternative is a 3-line getter on `StripeService` |
| Q-2 | R-9: reuse an existing Business OS customer from `business_os_billing_accounts`? | **No** in slice 3. `customer_email` only. Reuse would add a reader to the billing repository's single-caller guard, and it gains nothing for a one-off payment (the receipt goes to the email either way) |
| Q-3 | Embedded completion: `return_url` (Stripe redirects back) or `redirect_on_completion: 'never'` (slice 5 handles `onComplete` in place; redirect-only payment methods are then unavailable) | `return_url` = `<origin>/business-os?boost=return&session_id={CHECKOUT_SESSION_ID}`, built from `NEXT_PUBLIC_APP_URL` when set, otherwise the request origin. It keeps every method Stripe offers. Slice 5 adds the landing |
| Q-4 | The `GET` packages route: here or in slice 5? | Slice 5: it is the picker's data and the credit-figure guard's `SOURCES` entry belongs with the picker |
| Q-5 | §18.5 says "exercised from `/test-business-os`". A harness card here? | No; the mocks are the proof, and slice 5 builds the real picker. A harness card here would duplicate it |
| Q-6 | The test-account allowlist env beside the on/off flag | Yes; the database is shared, so a flag alone would open the checkout to every account in PROD |
| Q-7 | Audit `cap_reached` refusals (fraud signal) or log only? | Log only (`warn`) in slice 3; slice 6's admin view shows the purchases anyway |
| Q-8 | Payment methods: Stripe's dynamic methods (incl. delayed ones, handled by T-7 / 4a), or card only? | Dynamic (dashboard-controlled): 2b's `awaiting_payment` path is built for delayed methods |

**Business questions:** none. The price, cap, currency, tax and eligibility are all decided.

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-06, against `5fb0cded`**
**Status:** ✅ Approved with conditions (C-1 to C-7; C-8 is binding on 4a). The Dev writes them into §3 and §6 as the first step of implementation, and no second review is needed. Two conditions are **Medium**: without them, a paid boost could end uncredited with no flag.

The shape is right: an owner route with a strict `{ packageId }`, the account from `getUser`, the flag 404 first, the orchestrator over injected dependencies, the pure session builder, no customer (R-9), USD inline price, tax-exclusive with tax off, Adaptive Pricing off, promotion codes off, the marker from the constants, and `client_reference_id` = the purchase id. It reuses the slice 1/2 seams and adds no migration, no CI job and no change to `StripeService` or the webhook.

#### Facts verified

| Claim | Verified |
|---|---|
| `adaptive_pricing` is a typed `SessionCreateParams` field, and `ui_mode` accepts `'embedded'` | ✅ `stripe@19.2.1` `types/Checkout/SessionsResource.d.ts:10`, `:309`, `:3269` (UiMode `'custom' \| 'embedded' \| 'hosted'`). **No cast is needed** |
| The dispatcher today: `DEFAULT_RESOLVERS = [planResolver]` | ✅ `webhookDispatcher.ts:103` |
| `planResolver` on `checkout.session.completed` with `mode !== 'subscription'` → `not_business_os` | ✅ `planInvoiceResolver.ts`, the "boost pack (TK-5)" line |
| So, **before 4a**, a completed boost session falls through to the route's agent-platform `handleCheckoutCompleted` | ✅ That handler has no `user_id` in metadata (we never set it), so it logs and **returns**, and the event is marked **completed**. Nothing harmful is written, but the payment is **swallowed**: Stripe will not redeliver it once 4a ships. See C-1 |
| `planResolver` ignores `charge.*`; platform `charge.refunded` / disputes go to the `payment_transactions` handlers | ✅ They log "unknown payment" and write nothing. That is harmless |
| new-api-route skill, WC-7: a money write must **await** `auditTrail.flush()` before responding | ✅ `.claude/skills/new-api-route/SKILL.md:190` |

#### Conditions

| # | Severity | Condition |
|---|---|---|
| **C-1** | **Medium** | **The flag stays off in every deployed environment until 4a is merged and deployed.** Before 4a, a paid boost session is routed to the agent-platform handler, which no-ops and marks the event completed. The payment is then lost to the webhook for good: only 4b's reconcile pass, not built yet, would find it. So `BUSINESS_OS_CREDITS_BOOST_ENABLED` must not be set on Vercel (Preview or Production) before 4a, and the local manual check (§7) **must not complete a payment**. Write this in §3.5 and §7, and as a line in `docs/feature_flags.md`. The test-account list does not change it. |
| **C-2** | **Medium** | **Never abandon a reservation while its Stripe session may still be payable.** With the plan as written, if Stripe created the session, then attach fails and the expire also fails, the row is `abandoned` while a live session can be paid for 30 minutes. 2b's `credit` answers `not_creditable` for an abandoned row **before** any cross-check, so the payment would be uncredited **and unflagged**. **Rule:** call `abandon` only when no session was created, or after `expire` **succeeded**. If `expire` fails, retry once; if it still fails, leave the row `pending` and log `error` `bos_boost_orphan_session` with `alert: true`, the purchase id and the session id. If that session is then paid, 4a's handler (C-8) reaches the row, and 2b's `credit` flags it `no_session` or `session_mismatch`: visible, and refundable by an admin. The tests cover expire-fails → no abandon, and the alert log. |
| **C-3** | Low | **`expires_at` margin.** Stripe requires `expires_at` at least 30 minutes after **its** creation time. `now + 1800`, computed before the request, can arrive a few seconds short and be refused, so every checkout would fail at random. Use **`now + 1860`** (31 minutes), and `checkoutTtlSeconds: 1860` for `reserve` (within its 1,800–86,400 bound). The builder test pins it, and it stays inside attach's 24 h 5 min bound. |
| **C-4** | Low | **Audit flush (WC-7).** This is a money write. After `log(BOS_BOOST_CHECKOUT_STARTED)`, `await auditTrail.flush().catch(err => log.error(...))` before responding. The route test mocks `flush` resolving. |
| **C-5** | Low | **A null email.** `user.email` can be null for some sign-in methods. When it is, omit `customer_email` and `receipt_email` (Stripe then collects the email in checkout) rather than sending `null`. One builder test. |
| **C-6** | Low | **`return_url` origin.** Build it from `NEXT_PUBLIC_APP_URL`. Fall back to the request origin **only** when `NODE_ENV === 'development'`. In production with the variable unset, refuse with `payments_unavailable` and log `error`, rather than trusting a `Host` header. |
| **C-7** | Low | **Test-account list hygiene:** parse it as comma-separated **UUIDs**, ignore blanks, and log a `warn` once for an invalid entry. **Unset means open to every account** while the flag is on (that is the launch switch), and `docs/feature_flags.md` says so explicitly. The client module starts with `import 'server-only'`. |
| **C-8** | Binding on 4a (record in §9) | **4a's resolver and handler:** (a) If `findBySessionIdForWebhook` misses on a platform `checkout.session.*` event that carries the boost marker, fall back to the row by `client_reference_id` (platform-created, so it is our id), then call `credit`. The `no_session` / `session_mismatch` flags make an orphan session visible (C-2). Only with **no row at all** does it deny `metadata_mismatch` with an alert. (b) `credit` → `not_creditable` on a session Stripe reports **paid** is an `error` with `alert: true`, `bos_boost_paid_not_creditable`, plus an audit entry, not a `warn`. The 4b reconcile pass lists such rows. |

#### Rulings on §10

| Q | Ruling |
|---|---|
| **Q-1** | **Yes:** the new `lib/business-os/billing/stripeClient.ts` singleton with the apiVersion guard test. It has `server-only` (C-7) and stays reusable by P-3a. `StripeService` is unchanged (§17). |
| **Q-2** | **Yes:** no customer reuse in slice 3, `customer_email` only (with C-5). |
| **Q-3** | **Yes:** a `return_url` keeps every payment method. Use `{CHECKOUT_SESSION_ID}`, built per C-6. Slice 5 adds the landing. |
| **Q-4** | **Defer to slice 5**, as the coordinator leans. |
| **Q-5** | **No harness card.** The mocks are the proof; slice 5 builds the picker. |
| **Q-6** | **Yes:** the test-account list. PROD and local share the database. See C-7. |
| **Q-7** | **Log only** (`warn` with the counted amount, never the account's email) in slice 3. Slice 6's view shows the purchases. |
| **Q-8** | **Dynamic payment methods** (dashboard-controlled). 2b's `awaiting_payment` path handles delayed methods, and C-2 / C-8 cover the edge cases. |

#### Other checks

- **Tenant isolation:** the account comes only from `getUser()`. `.strict()` refuses an injected `accountId` / `userId` / price / credits (G-1, G-2). The repository is called with field-by-field arguments. ✅
- **CI guards:** not an admin route, so the admin authz guard does not apply; the identity guard does not apply either (no `x-user-id` or body user id). ✅
- **Entitlements:** two `KNOWN_NON_GATE_IMPORTERS` entries with exact symbols (type-only imports included). ✅
- **new-api-route conventions:** Zod `.strict()`, Pino with `correlationId`, `details` only in development, `no-store`, `force-dynamic`, and the audit (with C-4). ✅
- **CI time:** mocked suites in existing jobs; none added. ✅
- **Size:** about 2–2.5 days, plus about 0.25 day for C-2 to C-7. No split needed. ✅

**No user question.** One operational point for the coordinator: per C-1, nobody turns the flag on in a deployed environment before 4a.

#### Approval

[x] Workplan approved with conditions C-1 to C-7. C-8 is recorded for 4a. Proceed to implementation.

### SA Code Review

**Code Review by SA — 2026-10-06**
**Status:** 🔄 **Fix Required: three small items** (CR-1 and CR-2 Medium, CR-3 Low). Everything else is approved. After the fixes, SA re-checks **only that diff** and its tests, and the code then goes to QA.

**Scope:**
- **Created:** the route and its test; `lib/business-os/boost/` (`boostCheckout`, `boostCheckoutAccess`, `boostCheckoutDeps`, `boostCheckoutSession`) with three test files; `lib/business-os/billing/stripeClient.ts`.
- **Modified:** `featureFlags.ts`, `docs/FEATURE_FLAGS.md`, the audit registry (events, audience and its pins 184 / 39, filter group, owner visibility, entity type), `enforcementPoints.test.ts` (2 non-gate entries), the entitlements doc, the requirement.
- `git diff --stat`: 87 insertions and 5 deletions over 11 tracked files, plus the new files. No deletion lacks an insertion. No change to `StripeService`, the webhook, the dispatcher or any repository.

#### What I verified myself

| Check | Result |
|---|---|
| The four new suites, the whole `lib/audit/__tests__` set and `enforcementPoints` (scratch config, `--runTestsByPath`) | ✅ **330 passed** |
| Mutation M1: `release` also abandons after the expire failed twice | ✅ Caught (`boostCheckout.test.ts`, 1 red) |
| Mutation M2: `adaptive_pricing: { enabled: true }` | ✅ Caught (`boostCheckoutSession.test.ts`, 1 red) |
| Restoration after each mutation | ✅ SHA-1 checked |
| Probe: `parseBoostTestAccounts('not-a-uuid,also-bad')` | ❌ Returns `null`, which means **open to every account**. This is CR-2 |

#### Conditions C-1 to C-8 and the Q rulings

| | Met? |
|---|---|
| C-1 flag off until 4a | ✅ Default off (`parseBooleanFlag(…, false)`), server-only, no `NEXT_PUBLIC_`. The warning is in the reader's JSDoc and in `docs/FEATURE_FLAGS.md`. Nothing sets it by default |
| C-2 never abandon while payable | ✅ for the cross-check and attach failures: expire with one retry, abandon only after a successful expire, otherwise the row stays `pending` with the `bos_boost_orphan_session` alert. M1 proves the test. ⚠️ The **create-throws** branch is not covered: CR-1 |
| C-3 1,860 s | ✅ `BOOST_CHECKOUT_TTL_SECONDS = 1860`, used for both the session `expires_at` and `reserve`'s `checkoutTtlSeconds` |
| C-4 WC-7 flush | ✅ Awaited before the answer, but as a raw `flush()`: CR-3 |
| C-5 null email | ✅ `customer_email` and `receipt_email` are omitted |
| C-6 `return_url` | ✅ `NEXT_PUBLIC_APP_URL`; the request origin only in development; otherwise `payments_unavailable` plus an `error` log |
| C-7 list hygiene and `server-only` | ✅ UUID parsing, a warning once without the ids, `server-only` on the client. ❌ All-invalid means open: CR-2 |
| C-8 (4a) | Recorded in §9 ✅ |
| Q-1 to Q-8 | ✅ As ruled. The client singleton's apiVersion is pinned equal to `StripeService`'s by the access test |

#### Other checks

- **Session builder:** `mode: 'payment'`, `ui_mode: 'embedded'`, USD from the package (lower-cased for Stripe), `unit_amount = priceMinor` (no multiplication), `tax_behavior: 'exclusive'`, `automatic_tax` off, `adaptive_pricing` off (M2), promotion codes off, the marker `product = business_os_boost` from P-1's constants on both the session and the payment intent, `client_reference_id` = the purchase id, idempotency key `bos-boost-checkout:<purchase id>`, and no customer. ✅
- **After-create cross-check:** livemode, `amount_subtotal`, `currency`, `client_reference_id`, `client_secret`, `expires_at`. ✅
- **Tenant isolation:** the account and email come only from `getUser()`. The Zod schema is `.strict()` with `packageId` only, so injected ids, prices and credits get 400. ✅
- **Error format:** `details` only in development; `no-store` everywhere; Pino with `correlationId`. The client secret and the email are never logged (the logs carry `userId` and purchase and session ids). ✅
- **Owner-visible audit entity:** right. `BOS_BOOST_CHECKOUT_STARTED` is the owner's own action, and the entry holds the purchase id, package id and version, price, currency and livemode. It holds **no** Stripe id and no client secret, so the owner sees nothing internal. The audience `bos` and the filter group are consistent. ✅
- **Entitlements:** two `KNOWN_NON_GATE_IMPORTERS` entries with exact symbols, including the type-only imports in `boostCheckout.ts`; `enforcementPoints` is green. ✅
- **CI guards:** not under `/api/admin`, so the admin authz guard is unaffected. No CI job or time is added. ✅

#### Findings

| # | File | Finding | Priority |
|---|---|---|---|
| **CR-1** | `boostCheckout.ts` step 5 (`catch` around `createBoostCheckoutSession`) | **An ambiguous create failure abandons a row whose session may exist.** A timeout, a connection error or a Stripe 5xx can happen **after** Stripe created the session. The code then calls `release(…, null)`, which abandons the reservation. If that unseen session is paid (`client_reference_id` = the purchase id), 2b's `credit` answers `not_creditable` for the abandoned row **before** any cross-check: paid, uncredited and unflagged, which is the exact C-2 hazard. **Fix:** abandon on a create failure **only** for a definite rejection, where Stripe says nothing was created: `StripeInvalidRequestError`, `StripeAuthenticationError`, `StripePermissionError`, `StripeRateLimitError`, `StripeCardError`, or a thrown error before the request (the builder). For any other error (`StripeConnectionError`, `StripeAPIError`, an unknown type), **first retry the create once with the same idempotency key**: Stripe returns the original session if one exists. If that yields a session, expire it and abandon as usual. If it still fails, **leave the row `pending`** and log `bos_boost_session_unknown` at error with `alert: true` and the purchase id. A later payment then reaches the row through 4a's `client_reference_id` fallback (C-8), and `credit` flags it `no_session`: visible. Tests cover a definite rejection → abandon, connection error then retry success → expire and abandon, and connection error twice → no abandon plus the alert. | **Medium (must-fix)** |
| **CR-2** | `boostCheckoutAccess.ts` `parseBoostTestAccounts` | **A list set to only invalid entries opens the checkout to everyone.** It returns `null` (the "unset" meaning) when no entry is a valid UUID, so a typo in `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS` (for example, emails pasted instead of ids) would open purchases to every account the moment the flag is on. **Fix:** a **set, non-blank** variable restricts **always**. With no valid entries it returns an **empty set**, which closes the checkout to everyone, and logs an `error` once. Only an unset or blank variable means open. Add a test. | **Medium (must-fix)** |
| **CR-3** | `route.ts` (the audit write) | **Use the repo's bounded helper.** The route awaits a raw `auditTrail.flush()`. The repo already has `logAndFlush` (`lib/audit/boundedAuditFlush.ts`, a 2 s bound, never throws, already used by three admin routes) for exactly this WC-7 case. A slow or stuck flush would hold the response after the Stripe session exists, and invite a double click and a second reservation. Replace the `log(…).catch` plus `await flush()` with `await logAndFlush(entry, { logger })`, and update the route test's mock. | **Low (must-fix)** |

#### Optimisation suggestions

- None.

#### Code Approved for QA: **No, pending CR-1 to CR-3**

SA re-checks only that diff. QA can then run the existing plan plus the three new tests.

#### Re-check of CR-1 to CR-3 (SA, 2026-10-06, diff only)

✅ **Code Approved for QA.**

- **CR-1:** `isDefiniteStripeRejection` matches the error's `type`, which stripe-node sets to the class name (`Error.js:52`). The five definite types and a parameter-build failure abandon. Every other error retries the create once with the **same** idempotency key. A session that comes back is expired and then abandoned under the C-2 rules. A second failure leaves the row `pending` with `bos_boost_session_unknown` and `alert: true`.
- **CR-2:** a set, non-blank list always restricts. No valid UUIDs gives an empty set, which closes the checkout to everyone, with one `error` that names no entries.
- **CR-3:** the route awaits the bounded `logAndFlush`.
- **Re-run by SA:** 4 suites, **77 passed**.
- **Mutations:**
  - `StripeConnectionError` added to the definite list → 2 tests red;
  - the all-invalid list reverted to open → 1 test red.

  Both files were restored and SHA-1 checked.

## QA Testing Report

### QA — slice 3 (2026-10-06)

**Verdict:** ✅ **PASS WITH NOTES.** QA found no bug in any reachable path. Two Low defects (both defence in depth) and a few Info notes.

**Test mode:** full
**Strategy used:** A + B (Jest). The route, the orchestrator and the session builder were tested with everything mocked: auth, the dependency wiring (hold readers, catalogue, repository, Stripe), the audit helper and the logger. Two adversarial scratch suites live in the session scratchpad and are **not committed**:
- `qa/boostCheckout3.qa.test.ts`: 60 orchestrator tests;
- `qa/route3.qa.test.ts`: 55 route tests.

**No real Stripe call, no Supabase write, no flag set anywhere deployed.**
**Focus:** api, security, money-path failure handling
**Skipped:** the optional manual test-mode check (§7). It needs a Stripe test key and the user's session, and C-1 forbids completing a payment. It remains for the user if wanted. `npm run test:bos-entitlements` and the Jest gate run in CI, because the worktree has no `node_modules`.
**Input source:** coordinator brief + workplan §3.0, §6, §7

#### Commands run

| Check | Result |
|---|---|
| The four new suites (route, `boostCheckout`, `boostCheckoutAccess`, `boostCheckoutSession`) | ✅ **4 suites, 77 tests passed** |
| Broad set (JSX scratch config, `--runTestsByPath`):<br>• the four new suites;<br>• all of `lib/audit/__tests__` and `lib/business-os/entitlements/__tests__`;<br>• the `featureFlags` tests;<br>• `entitlementSqlScripts.guard`;<br>• the boost repository test;<br>• both boost migration tests | ✅ **61 suites, 1,634 tests passed**, 19.1 s. `enforcementPoints` is green with the two non-gate entries; the audit pins (184 / 39) are green |
| Scoped tsc (`tsconfig.slice3.json`: route, boost module, client, flag file, audit files, touched tests) | ✅ **0 errors** |
| QA orchestrator suite | 60 / 60. Three findings are recorded as observations (QA3-D1, QA3-D2) |
| QA route suite | ✅ 55 / 55 |
| Flag default and docs | ✅ `isBusinessOsCreditsBoostEnabled()` is `parseBooleanFlag(…, false)`: unset, `''`, `false`, `0`, `no` and `off` are all off. `docs/FEATURE_FLAGS.md` 1.7.0 says, in bold: "Do not set `BUSINESS_OS_CREDITS_BOOST_ENABLED` on Vercel (Preview or Production) until credits boost slice 4a is merged and deployed", and states the allow-list rules |
| Source untouched | ✅ The SHA-1 of all 18 non-doc files (new and modified) and the `git status --porcelain` output match the pre-QA snapshot |

#### Test matrix

| Area | Result | Notes |
|---|---|---|
| Flag off → 404 before any read | ✅ | unset, `''`, `false`, `0`, `no` and `off` → 404 with `getUser` called 0 times. `' true'` and `'TRUE '` count as on (parser trims and lower-cases; consistent with the other flags) |
| No session → 401 | ✅ | No hold read, nothing reserved |
| Allow-list | ✅ | Unset, blank or all-spaces → open. `' , ,'`, `not-a-uuid`, an email, another account's id, or the id in braces → 404 with nothing reserved. Own id upper-cased, or surrounded by spaces in a list → allowed (CR-2 holds) |
| Input validation (FR-8, G-1, G-2) | ✅ | 19 bodies → 400 `{ success:false, error:'Invalid input' }` with **no `details`** in production, and no hold read and nothing reserved: `{}`; injected `priceMinor`, `credits`, `userId`, `accountId`, `currency` or `livemode`; a number, null or array id; `PLUS`; 1 char, 33 chars or 100,000 chars; SQL-ish text; `plüs`; a trailing newline; an array body; a null body. Non-JSON, empty or truncated bodies → 400. Development shows `details`. The account used is always `user.id` |
| Unknown / inactive package | ✅ | 404 `unknown_package` |
| Catalogue rejection of any kind | ✅ | `BoostCatalogueInvalidError`, `Error`, `TypeError`, a string, `null`, or a sync throw → 503 `catalogue_unavailable`, with nothing reserved and no Stripe call (slice 1 E-2) |
| Payment hold fail closed (R-1) | ✅ | A throw or `{ ok:false }` → `payment_hold_check_failed` (500); held → 409 `awaiting_payment`; nothing reserved |
| Mode / key | ✅ | `mode()` throws, or the Stripe key is missing → `payments_unavailable` before `reserve` |
| Reserve mapping | ✅ | `cap_reached` → 409 with **no figures** in the answer; `no_plan_row` → 403 `not_eligible`; `{ error }` or an empty result → 500 `reservation_failed`; no Stripe call in any of these. The reserve arguments are field by field: package version, retail and credit-value versions, price, `USD`, base 12,500, bonus 1,250, cap 15,000, 30 days, TTL 1,860; `livemode` from `mode()` |
| Session parameters pinned | ✅ | Exact object: `mode:'payment'`, `ui_mode:'embedded'`, `client_reference_id` = the purchase id, one line item with `currency:'usd'`, `unit_amount: 2500` (= `priceMinor`, no ×100), `tax_behavior:'exclusive'`, product name `Plus`. Marker metadata `{product:'business_os_boost', purchase_id, package_id, package_version}` on the session **and** on `payment_intent_data`. `adaptive_pricing` and `automatic_tax` off, `allow_promotion_codes:false`, `expires_at` = now + 1,860, `return_url`, `customer_email`. **No** `customer`, `customer_creation`, `discounts` or `payment_method_types`. Idempotency key `bos-boost-checkout:<purchase id>`. A null or `''` email omits both `customer_email` and `receipt_email` |
| `return_url` rules (C-6) | ✅ | Production uses `NEXT_PUBLIC_APP_URL` and ignores a hostile request Host; trailing slashes are trimmed. Unset or blank in production → 500 `payments_unavailable` before `reserve`. Development falls back to the request origin |
| Definite Stripe rejections | ✅ | Each of the five types → one create, then `abandon`, no expire |
| Indeterminate create | ✅ | `StripeConnectionError`, `StripeAPIError`, `StripeIdempotencyError`, a plain `Error`, or a lower-cased type → retried with **identical params and idempotency key**. A session on the retry → expire, then abandon. A failure twice → **no abandon and no expire**, and `bos_boost_session_unknown` with `alert:true` and the purchase id. Indeterminate followed by a definite rejection on the retry also stays pending (conservative) |
| Cross-check mismatches (C-2) | ✅ | `livemode`; amount 2,499 or null; `eur`; upper-case `USD`; another reference; no `client_secret`; no or string `expires_at` → expire, then abandon, 502. Expire fails once → retried, then abandon. Expire fails twice → **no abandon**, and `bos_boost_orphan_session` with `alert:true` and both ids |
| Attach outcomes | ✅ | `boost_checkout_session_in_use` error, `reservation_expired`, `session_conflict`, `not_pending`, `not_found`, a generic error, or an empty result → expire then abandon, 502. `already_attached` → success. The attach expiry is Stripe's `expires_at` as an ISO string. An attach failure plus an expire failing twice → orphan alert, no abandon. A failing, throwing or `has_session` abandon never changes the answer |
| Success | ✅ | The order is reserve → create → attach → audit. 200, `private, no-store`. The body has exactly `{ success, data: { clientSecret, purchaseId, expiresAt } }` |
| Audit | ✅ | `logAndFlush` is called **once**, after attach, on success only; refusals are not audited. The entry holds no session id, payment intent, secret or email |
| Logs | ✅ / ⚠️ | Across success, a 400, a catalogue failure and six orchestrator failure branches, no log line contains the client secret or the email, and every route line carries `correlationId` (including a header-supplied one). ⚠️ See QA3-D2 for an email embedded in a Stripe error message |
| Unexpected throw | ✅ | 500 `{ success:false, error:'Internal server error' }` with no `details` in production |
| Route surface | ✅ | Exports only `POST`, `dynamic`, `runtime` |

#### Issues Found

##### Bugs

1. **QA3-D1: a repository call that *throws* escapes the orchestrator.** Severity: **Low**, because it is not reachable: the repository's contract is "never throws", and that was fixed and tested in 2a. File: `lib/business-os/boost/boostCheckout.ts`, steps 4 and 6.
   - Steps to reproduce: make `repo.attachCheckout` (or `repo.reserve`) throw instead of returning `{ error }`.
   - Expected: `runBoostCheckout` never throws, as its JSDoc says. A throwing attach should go through `release` (expire the session, then abandon).
   - Actual: the exception propagates and the route answers 500. **After `create`, the Stripe session is left open, unexpired and unattached**, and the row is left `pending` with no session. A payment would still be visible (4a's `client_reference_id` fallback, then `credit` flags `no_session`), but C-2's "expire first" is skipped.
   - Fix: wrap `reserve` and `attachCheckout` in `try/catch`, treating a throw like `{ error }`; for attach, go through `release`. Add one test each.
2. **QA3-D2: a Stripe error can put the buyer's email in the logs.** Severity: **Low** (privacy). File: `boostCheckout.ts`, which logs `err: error` on create failures.
   - Steps to reproduce: Stripe rejects the session with a message that names the email (for example "Invalid email address: …" for `customer_email`).
   - Expected: §3.5 says "the email is never logged".
   - Actual: the error object, and so its message, is logged as `err`, and the email appears in the log line. The repo's logger redaction (OI-9) covers exact keys only, not message text.
   - Fix: log `{ type, code, param, requestId }` from Stripe errors rather than the whole error, or redact the message. Do the same where an `expire` failure is logged.

##### Performance Issues

None.

##### Info

- **I-1:** the request body has no size limit before `request.json()`. A 100,000-character `packageId` is refused with 400 after parsing. Next's platform limits apply in deployment, so no change is needed.
- **I-2:** `CLAUDE.md` links `/docs/feature_flags.md`, but the file is `docs/FEATURE_FLAGS.md`. The link is broken on case-sensitive hosts (GitHub). This predates the slice (deviation 5), and a one-word fix belongs to whoever next edits CLAUDE.md.
- **I-3:** Stripe's default `customer_creation` for `mode: 'payment'` is `if_required`. Stripe may then create a **guest** customer for some payment methods, but never a saved Customer object. R-9 ("no customer created by us") holds. Noted for the slice 5 / 4a reviewers.
- **I-4:** the manual test-mode check (§7) was not run by QA (it needs the user's key and session). The mocks cover the definition of done. If the user runs it, it must stop before paying (C-1).

#### Recommended additions

| # | Test | Where | Priority |
|---|---|---|---|
| R-1 | `attachCheckout` throws → session expired, then abandon; `reserve` throws → `reservation_failed` | `boostCheckout.test.ts` | With the QA3-D1 fix |
| R-2 | A Stripe error whose message contains the email → no log line contains the email | `boostCheckout.test.ts` | With the QA3-D2 fix |
| R-3 | Indeterminate create, then a definite rejection on the retry → stays pending + alert | `boostCheckout.test.ts` | Should (pins the conservative choice) |
| R-4 | Session currency upper-case `USD`, or `amount_subtotal` null → mismatch | `boostCheckout.test.ts` | Nice |
| R-5 | Allow-list edge cases: own id upper-case or space-padded passes; a braced id or commas-only list closes | `boostCheckoutAccess.test.ts` | Nice |
| R-6 | Production `NEXT_PUBLIC_APP_URL` blank (spaces) → `payments_unavailable`; a hostile Host is ignored | route test | Nice |
| R-7 | Oversized `packageId` (33 chars, 100k chars) and `plüs` → 400 | route test | Nice |

#### Test Outputs / Logs

```text
4 new suites:   Test Suites: 4 passed, 4 total     Tests: 77 passed, 77 total
Broad set:      Test Suites: 61 passed, 61 total   Tests: 1634 passed, 1634 total   Time: 19.147 s
QA scratch:     boostCheckout3.qa.test.ts  Tests: 60 passed   |  route3.qa.test.ts  Tests: 55 passed
Observations:   attach throw escapes: true order: reserve,create,attach
                reserve throw escapes: true
                email appears in logs via err.message: true
Scoped tsc:     0 errors (tsconfig.slice3.json)
```

#### Final Status
- [x] The slice 3 acceptance criteria pass. Ready for the PR once the user has seen the diff. QA3-D1 and QA3-D2 are Low: fix them in this PR (small) or carry them to 4a. **The flag stays unset on Vercel until 4a is deployed (C-1).**
- [ ] Issues found that the Dev must address before commit

## Commit Info

*(RM populates.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-06 | Created | Slice 3 workplan drafted against main `5fb0cded` (after #235, 20261030 and 20261031 applied). One owner route, an orchestrator, a session builder, a Business OS Stripe client, a server flag with a test-account list, an audit event and the entitlements registration. About 2 to 2.5 days. Eight SA questions; no business question |
| 2026-10-06 | SA workplan review: approved with conditions | C-1 the flag stays off in deployed environments until 4a (before 4a the dispatcher sends a paid boost session to the agent-platform handler, which no-ops and completes the event). C-2 never abandon while the session may be payable (expire must succeed, else keep the row pending and alert). C-3 `expires_at` = now + 31 minutes. C-4 WC-7 audit flush. C-5 null email. C-6 `return_url` from `NEXT_PUBLIC_APP_URL`. C-7 test-account list hygiene and `server-only`. C-8 for 4a: fall back to `client_reference_id`; `not_creditable` on a paid session alerts. `adaptive_pricing` is typed in stripe 19.2.1. Q-1 to Q-8 ruled. No user question |
| 2026-10-06 | Implemented; Code Complete | C-1 to C-7 applied (§3.0), C-8 recorded for 4a. Route, orchestrator, session builder, access module, Business OS Stripe client, flag reader and docs, audit event and entity type, two non-gate registrations. 204 suites / 5,357 tests green; scoped tsc 0 errors (§6.4). Nothing committed |
| 2026-10-06 | SA code review: Fix Required | 330 tests green; mutations M1 (abandon after a failed expire) and M2 (adaptive pricing on) caught. C-1 and C-3 to C-8 met. Must-fix: CR-1 abandon after a create failure only on a definite Stripe rejection, otherwise retry with the same idempotency key, else keep the row pending and alert; CR-2 a set test-account list with no valid UUIDs closes the checkout (it currently opens it to all); CR-3 use the bounded `logAndFlush`. The audit entry is owner-visible and correctly holds no Stripe ids or client secret |
| 2026-10-06 | SA code review fixes CR-1 to CR-3 | CR-1: only a definite Stripe rejection abandons; anything else is retried once with the same idempotency key, and an unknown result leaves the row pending with a `bos_boost_session_unknown` alert. CR-2: a set test-account list always restricts (no valid id → closed, one error). CR-3: the audit write goes through `logAndFlush`. 77 tests in the four suites; 204 suites / 5,365 tests; scoped tsc 0 errors. Nothing committed |
| 2026-10-06 | SA re-check of CR-1 to CR-3: Code Approved for QA | A definite Stripe rejection abandons; anything else retries with the same idempotency key, else the row stays pending with an alert. A set test-account list always restricts. Bounded `logAndFlush`. 77 tests green; 2 mutations caught |
| 2026-10-06 | QA (slice 3): PASS WITH NOTES | 4 new suites / 77 green; broad set 61 suites / 1,634 green; scoped tsc 0 errors. Adversarial scratch suites (60 orchestrator + 55 route, all mocked, no Stripe or database calls) cover: flag-off 404 before any read, 401, allow-list edges, 19 invalid bodies → 400 with no details, any catalogue rejection → 503, hold fail-closed, reserve mapping, the exact Stripe parameters, definite vs indeterminate create (identical retry), C-2 expire-before-abandon including the orphan alerts, every attach outcome, the audit once after success with no Stripe ids, no secret or email in logs or answers, and the 3-field response. QA3-D1 (Low): a repository call that throws escapes the orchestrator (the session is not expired). QA3-D2 (Low): a Stripe error message can carry the email into the logs. Recommended tests R-1 to R-7 |
| 2026-10-06 | QA follow-ups applied; ready for user review | QA3-D1: a throwing reserve → `reservation_failed`; a throwing attach → expire, then abandon (orphan alert if the expire fails). QA3-D2: Stripe errors are logged as `stripeErrorFacts` only (type, code, param, request id, status), never the message. R-3 confirmed: a definite rejection on the retry still leaves the row pending with an alert. Tests R-1 to R-7 added; the four suites 95 green; broad set 200 suites / 5,338 green; scoped tsc 0 errors. I-2 (CLAUDE.md link casing) noted in §9 for the user. Nothing committed |
| 2026-10-07 | Approved and committed, PR open | The user saw the diff and approved the commit (2026-10-07). RM committed on `feature/bos-credits-boost-slice-3` and opened a PR to `main`. `BUSINESS_OS_CREDITS_BOOST_ENABLED` stays unset on Vercel until slice 4a is merged and deployed |
