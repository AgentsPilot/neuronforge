# Workplan: Business OS Plan Payments, P-1 (Price-id router, deny by default)

> **Last Updated**: 2026-10-02

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §4 PF-4, PF-9, PF-12; §8 SR-1, SR-2, SR-3, SR-8, SR-10, SR-14, SR-16; §9.1 P-1; §9.4; SA Review SA-P6, SA-P7, tenant isolation ruling; conditions C-1, C-2, C-3, C-8. Reuse plan [RD-4, RD-12, TK-1, TK-5](/docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md).
**As-built:** [BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md) §2 (platform `invoice.paid`, G-6), §6 G-5, G-6
**Depends on:** [P-0 workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P0_WORKPLAN.md) merged (C-1)
**Date:** 2026-10-02
**Branch:** to be created by RM as `feature/bos-plan-payments-p1`, cut from `main` **after P-0 merges**. This workplan is written on `feature/bos-plan-payments-p0` only so both plans can be reviewed together; no P-1 code exists.
**Status:** Planning. Waiting for SA workplan review. Nothing implemented, nothing committed.

## Overview

Today a platform `invoice.paid` that carries `metadata.user_id`, or whose customer's **first** subscription does, is converted into Pilot Credits (as-built G-6). The first Business OS plan invoice would fall straight into that path. P-1 closes it before any Business OS checkout exists. A small Business OS **dispatcher** runs before the existing `switch` for platform events only. Its plan resolver reads the **price ids on the invoice lines** (Basil shapes, PF-9) and compares them to the prices behind our configured **lookup keys**. A price we do not recognise is logged and **denied**: the event is acknowledged and no handler runs, so nothing is converted to credits. The metadata→Pilot-Credit conversion and the first-subscription fallback are deleted. Metadata is only a cross-check, and a disagreement is refused and alerted. Because a denied subscription invoice would mean money taken and never credited, the subscription branch of `app/api/stripe/create-checkout` is refused in the same PR (410, logged; PF-12). The one-off boost-pack branch stays (TK-5). Connect events never reach the dispatcher, and the Connect handlers do not change.

**In P-1 the router recognises nothing as Business OS**: no plan price exists until P-2. So every platform subscription invoice is denied. P-2 plugs in by filling the lookup-key list; P-3a/P-3b add the handler (§3.4).

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Scope](#2-scope)
3. [Design](#3-design)
4. [Files to create / modify](#4-files-to-create--modify)
5. [Task list](#5-task-list)
6. [Test plan](#6-test-plan)
7. [Fixture capture (C-8)](#7-fixture-capture-c-8)
8. [Gates](#8-gates)
9. [Tenant isolation](#9-tenant-isolation)
10. [Risks](#10-risks)
11. [Demo](#11-demo)
12. [Sizing](#12-sizing)
13. [Rollback](#13-rollback)
14. [Questions for SA](#14-questions-for-sa)
15. [SA Review](#sa-review)

---

## 1. Analysis summary

Line numbers are on `259f67b5`; P-0 changes logging only, so they shift but the code does not.

| Fact | Evidence |
|---|---|
| Platform `invoice.paid` → `handleInvoicePaid`: `invoice.metadata.user_id`, else subscription metadata, else `subscriptions.list({ customer, limit: 1 }).data[0]` metadata; then the amount or `credits` metadata becomes Pilot-Credit tokens written to `user_subscriptions`, `credit_transactions`, `billing_events`, and a `QuotaAllocationService` call | `route.ts:45-345` |
| Platform `checkout.session.completed`, `mode = 'subscription'`: converts `session.metadata.credits` to tokens on `user_id` from metadata alone (a second conversion, at session time) | `route.ts:583-824` |
| Platform `checkout.session.completed`, `mode = 'payment'`, `purchase_type = 'boost_pack'`: the agent-platform boost pack (TK-5, stays) | `route.ts:466-582` |
| Platform `invoice.payment_failed` → `handleInvoicePaymentFailed`: agent-platform dunning keyed on `invoice.metadata.user_id`; writes no credits. Reuse plan §4.6 lists `payment_grace_period_days` and its dunning path under *Survives* | `route.ts:347-447`; reuse plan §4.6, RD-16 |
| The Connect split is `event.account`: Connect events carry it, platform events do not | `route.ts:2577` |
| A Basil reader for the invoice's subscription already exists (`parent.subscription_details.subscription`, with a legacy fallback) | `lib/payments/invoiceSubscription.ts` |
| **No reader for the invoice line's price exists.** On `2025-10-29.clover` it is `line.pricing.price_details.price` (a string id). `line.price` is gone | `node_modules/stripe/types/InvoiceLineItems.d.ts:266-291`; PF-9 |
| No `lookup_key` exists anywhere; no `lib/business-os/billing/` module; no Business OS dispatcher (boost 4a has not landed) | grep |
| `create-checkout` validates by hand; `custom_credits` calls `createCustomCreditSubscription` (a `mode: 'subscription'` session); `boost_pack` calls `createBoostPackCheckout` | `create-checkout/route.ts:47, 73-125, 127-164` |
| Callers of `custom_credits`: the parked agent-platform billing UI (`components/settings/BillingSettings.tsx:414,423`, `components/v2/settings/BillingSettingsV2_NEW.tsx:455`) | grep |
| `update-subscription` upgrades a platform subscription with `proration_behavior: 'always_invoice'`, which bills a proration invoice **now** | `app/api/stripe/update-subscription/route.ts:74`; `StripeService.ts:350` |
| Tests pinned to the current code: `userSubscriptionsWriteLockdown.qa.test.ts` lists five `QuotaAllocationService(supabaseAdmin)` sites in the route; `stripeAuditEntries.test.ts` expects `custom_credits` → `SUBSCRIPTION_CHECKOUT_INITIATED` | the two tests |
| Production receives test-mode events: all 897 recorded events are `livemode = false` | requirement §10.2 |

---

## 2. Scope

| In scope | Out of scope (where it lives) |
|---|---|
| Business OS dispatcher module (SA-P6), platform events only, pluggable resolvers, conflict refusal. P-1 builds it because boost 4a has not landed (§9.4) | The boost resolver (boost 4a adds it) |
| Plan resolver: price ids from invoice lines (Basil, with a legacy fallback), compared with prices behind configured lookup keys; deny by default; metadata cross-check | Creating prices or lookup keys (P-2) |
| Known-price catalog with an **empty** lookup-key list, the Stripe lookup, its cache and its failure rule | Lookup-key → tier mapping (P-2, inside the entitlements config) |
| Delete `handleInvoicePaid` (the conversion and the first-subscription fallback) | The rest of the *Dies* list (P-10) |
| Deny the platform subscription-mode `checkout.session.completed` conversion (§14 Q-2) | The boost-pack session branch (TK-5, boost slice 7) |
| Refuse `custom_credits` in `create-checkout` with 410, logged (PF-12); Zod on the route | Removing the agent-platform billing UI (P-10) |
| Fixture tests from real test-mode payloads (C-8) | Any plan handler, plan write, billing record, audit, livemode check (P-3a, P-3b) |
| Connect before/after evidence (SR-10) | Stale-claim reclaim (P-8b), refunds and disputes of plan payments (P-6b) |

No migration. No new table. No entitlements import.

---

## 3. Design

### 3.1 Where it runs

```text
POST /api/stripe/webhook
  verify signature (unchanged) → claim event (unchanged) → Connect split (unchanged)
  ├─ Connect event (event.account set) ──────────────────────────► existing switch (unchanged)
  └─ platform event ─► dispatchBusinessOsEvent(event)
                        ├─ { kind: 'not_business_os' } ──────────► existing switch
                        ├─ { kind: 'deny', reason } ─► log, mark claim completed, 200, no handler
                        └─ { kind: 'flow', flow: 'plan' | 'boost' } ─► registered handler
                                                       (none in P-1 → throw → claim released, 500)
```

The route change is one block between the Connect split and the `switch`, plus a small `completeClaim()` helper reused by the deny path and the existing end-of-handler update. The `switch` is not re-indented, so the Connect cases do not appear in the diff.

### 3.2 Dispatcher contract (SA-P6)

**File:** `lib/business-os/billing/webhookDispatcher.ts`

```typescript
export type DispatchOutcome =
  | { kind: 'not_business_os' }
  | { kind: 'deny'; reason: DenyReason; detail: DenyDetail }
  | { kind: 'flow'; flow: 'plan' | 'boost'; lookupKeys: readonly string[] };

export interface BusinessOsResolver {
  readonly flow: 'plan' | 'boost';
  /** Pure apart from the price catalog read. Never resolves an account. */
  resolve(event: Stripe.Event, ctx: ResolverContext): Promise<DispatchOutcome>;
}

export async function dispatchBusinessOsEvent(
  event: Stripe.Event,
  ctx: ResolverContext,
  resolvers: readonly BusinessOsResolver[] = DEFAULT_RESOLVERS,
): Promise<DispatchOutcome>;
```

- **Platform only:** `event.account` set → `not_business_os` before any resolver runs.
- **Disjoint by construction:** if two resolvers return `flow` (or one `flow` and another `deny`), the outcome is `deny` with reason `resolver_conflict`, logged at `error`. A payment resolved as one flow is never offered to the other.
- **No account in the outcome.** The outcome type has no user or account field. Who the payment belongs to is decided later from our own billing record (SR-8, P-3b).
- **A resolver that throws** propagates. The route's existing catch releases the claim and returns 500, so Stripe retries. A resolver must never turn "I could not tell" into `deny`.
- `DEFAULT_RESOLVERS` in P-1 = `[planResolver]`. Boost 4a appends its resolver.

### 3.3 Plan resolver

**Files:** `lib/business-os/billing/planInvoiceResolver.ts`, `lib/payments/invoiceLinePrices.ts`, `lib/business-os/billing/planPriceCatalog.ts`, `lib/business-os/billing/stripeMetadataKeys.ts`

**Reading the price (PF-9).** `invoiceLinePriceIds(invoice)` is the single reader, next to `invoiceSubscription.ts` and in its style: for each line, `line.pricing?.price_details?.price` (string, or `.id` if expanded); fallback to the legacy `line.price?.id` for pre-Basil and replayed events. Returns `{ priceIds, unpricedLines, truncated: invoice.lines.has_more }`.

**Events it governs in P-1:**

| Platform event | Recognised (all priced lines are known plan prices) | Not recognised |
|---|---|---|
| `invoice.paid` | `flow: 'plan'` → no handler in P-1 → throw, claim released | **`deny`**, no handler runs |
| `invoice.payment_failed` | `flow: 'plan'` → as above | `not_business_os` → legacy agent-platform dunning, which writes no credits and survives per reuse §4.6 (**§14 Q-1**) |
| `checkout.session.completed`, `mode = 'subscription'` | (P-3a adds Business OS session recognition here) | **`deny`** `legacy_subscription_checkout`: the session-time credit conversion goes (**§14 Q-2**) |
| `checkout.session.completed`, `mode = 'payment'` | — | `not_business_os` → boost-pack branch unchanged (TK-5) |
| any other type | — | `not_business_os` → existing switch unchanged |

**Deny reasons and levels:**

| Reason | When | Level |
|---|---|---|
| `unknown_price` | No priced line matches a known plan price, and no metadata claims Business OS | `warn` (expected for the four agent-platform test subscriptions every month) |
| `no_priced_lines` | No line carries a price | `warn` |
| `mixed_prices` | Some lines known plan prices, some not | `error` |
| `lines_truncated` | `lines.has_more` is true (more than the lines embedded in the event) | `error` (§14 Q-8) |
| `metadata_mismatch` | See the cross-check below | `error` |
| `legacy_subscription_checkout` | Platform subscription-mode session that no Business OS resolver recognised | `warn` |
| `resolver_conflict` | Two resolvers claim the event | `error` |

`error` lines carry `alert: true`. They are the v1 alert channel (requirement AM-9) and what P-8a/P-8b later surface.

**Metadata cross-check (RD-4.3, SR-2).** Metadata never routes and never names an account. Sources read: `invoice.metadata` and the subscription snapshot `subscriptionMetadataFromInvoice(invoice)`.
- Known plan price, and the metadata carries the legacy `user_id` or `credits`, or a `product` other than the plan marker → `deny metadata_mismatch` (tamper signal).
- Unknown price, but the metadata claims Business OS (`product` = the plan marker, or `bos_user_id` present) → `deny metadata_mismatch` (a tamper signal or a catalog gap; either way a person must look).
- Known plan price and no metadata → recognised. Absence is not disagreement; P-3a always writes it, and P-3b may tighten this.

The marker constants live in `stripeMetadataKeys.ts`: `product = 'business_os_plan'`, `bos_user_id` (C-3), and the legacy `user_id` / `credits` names, so P-3a writes exactly what P-1 checks (§14 Q-7).

### 3.4 What P-1 recognises, and how P-2 and P-3 plug in

**File:** `lib/business-os/billing/planPriceCatalog.ts`

```typescript
/** Lookup keys of Business OS plan prices. Empty until P-2 creates the prices. */
export const BOS_PLAN_LOOKUP_KEYS: readonly string[] = [];

export interface KnownPlanPrices {
  /** price id → the lookup key it was found under */
  readonly byPriceId: ReadonlyMap<string, string>;
}

export async function loadKnownPlanPrices(deps?: { stripe?: Stripe; now?: () => number }): Promise<KnownPlanPrices>;
```

- **P-1:** the list is empty, so `loadKnownPlanPrices` returns an empty map **without calling Stripe**. Nothing is recognised. Every platform invoice is `unknown_price` (or `no_priced_lines` or `metadata_mismatch`), so every platform subscription invoice is denied. This is the intended state: protective only.
- **P-2** fills the list with the two keys it creates (and moves the key → tier mapping into the entitlements config, per its own workplan). From then on, the loader resolves them with one `stripe.prices.list({ lookup_keys })` call (no `active` filter, so an archived price that still holds its key is recognised), caches the map per instance for 5 minutes, and **throws** on a Stripe error. Throwing releases the claim so Stripe retries; it never degrades to "nothing recognised", which would deny a paying customer's invoice for good.
- **P-3a** registers no handler yet, so a recognised plan invoice throws `BusinessOsHandlerMissingError`, logged at `warn` with `bos_billing_plan_unhandled`, and the claim is released (its demo: "the router recognises a BOS plan invoice, logs that no handler exists yet, and releases the claim"). P-3a also adds session recognition ahead of the `legacy_subscription_checkout` deny.
- **P-3b** registers the plan handler in the route's flow → handler map. From then on, `flow: 'plan'` calls it.

Mode: lookup keys are the same in test and live mode (Q-T1), so the list is not per environment.

### 3.5 Removals

| Removed | Why |
|---|---|
| `handleInvoicePaid` (whole function): metadata `user_id`, `subscriptions.retrieve` metadata, the `subscriptions.list({ customer, limit: 1 })` fallback, the L-15 description heuristic, the token conversion, its `QuotaAllocationService` call | Unreachable after the router: every platform `invoice.paid` is either a plan flow or denied. Leaving it would leave a dead conversion one edit away from live |
| The `mode = 'subscription'` branch of `handleCheckoutCompleted`, with its `QuotaAllocationService` call | The session-time conversion (§14 Q-2). The boost-pack branch stays |
| The `custom_credits` branch of `create-checkout` | Replaced by a 410 refusal (§3.6) |

Imports that become unused are removed. `pilotCreditsToTokens` stays (boost-pack branch). `StripeService.createCustomCreditSubscription` stays until P-10 (it has no caller left; noted for P-10).

### 3.6 `create-checkout` refusal (PF-12, SA-P7)

- Body parsed with a Zod discriminated union on `purchaseType`: `custom_credits` (any other fields ignored) or `boost_pack` with `boostPackId: string`. Invalid → 400 with the existing messages ("Invalid purchase type", "Boost pack ID is required").
- Order: auth (401 unchanged) → parse → `custom_credits` → **410** `{ success: false, error: 'Credit subscriptions are no longer sold' }`, logged at `warn` (`stripe_checkout_subscription_refused`, `userId`), **before** any Stripe or database call and with no audit entry (no checkout was initiated).
- `boost_pack` unchanged.
- The 500 response adopts the CLAUDE.md error format (`details` only in development) instead of returning `error.message` (§14 Q-9).

### 3.7 Logging

New modules use `createLogger({ module: 'business-os-billing' })` and the route's request child logger from P-0 (`correlationId`, `stripeEventId`). Events: `bos_billing_event_denied` (with `reason`, `eventType`, `invoiceId` or `sessionId`, `priceIds`, `lookupKeysMatched`, `metadataKeys`, `livemode`), `bos_billing_plan_unhandled`, `bos_billing_resolver_conflict`. No metadata values, no customer details, no amounts beyond `amount_paid` in minor units.

---

## 4. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/billing/webhookDispatcher.ts` | create | SA-P6 dispatcher |
| `lib/business-os/billing/planInvoiceResolver.ts` | create | Plan resolver, deny by default, cross-check |
| `lib/business-os/billing/planPriceCatalog.ts` | create | Empty lookup-key list, loader, cache, fail-closed rule |
| `lib/business-os/billing/stripeMetadataKeys.ts` | create | Marker constants shared with P-3a |
| `lib/payments/invoiceLinePrices.ts` | create | The one Basil reader for line prices (PF-9) |
| `app/api/stripe/webhook/route.ts` | modify | Dispatcher call before the `switch` (platform only), `completeClaim()` helper, deny path, delete `handleInvoicePaid` and the subscription-mode session branch |
| `app/api/stripe/create-checkout/route.ts` | modify | Zod, 410 for `custom_credits`, standard 500 body |
| `lib/business-os/billing/__tests__/webhookDispatcher.test.ts` | create | §6.1 |
| `lib/business-os/billing/__tests__/planInvoiceResolver.test.ts` | create | §6.1, on real fixtures |
| `lib/business-os/billing/__tests__/planPriceCatalog.test.ts` | create | §6.1 |
| `lib/payments/__tests__/invoiceLinePrices.test.ts` | create | §6.1 |
| `lib/business-os/billing/__tests__/fixtures/stripe/*.json` | create | Real test-mode payloads (§7) |
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` (from P-0) | modify | Add platform scenarios (§6.2); Connect snapshots must not change |
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` | create | Source guard: dispatcher call sits after the Connect split and before the `switch`; `handleInvoicePaid`, `subscriptions.list(` and the subscription-mode conversion are gone |
| `app/api/stripe/__tests__/stripeAuditEntries.test.ts` | modify | `custom_credits` → 410, no audit entry, no Stripe call |
| `app/api/stripe/create-checkout/__tests__/route.test.ts` | create | Happy path (boost pack), 401, 400 invalid, 410 `custom_credits` |
| `lib/repositories/__tests__/userSubscriptionsWriteLockdown.qa.test.ts` | modify | Five → three `QuotaAllocationService(supabaseAdmin)` sites in the route (two removed with their conversions; four if §14 Q-2 is ruled no), with a comment naming P-1 |
| `scripts/capture-stripe-billing-fixtures.ts` | create | Test-mode-only capture (§7) |
| `scripts/replay-stripe-fixture.ts` | create | Signs a fixture locally and posts it to the dev server for the demo (§11) |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | Record TK-1's outcome (when the user gives it) and the dispatcher ownership in §9.4 |

---

## 5. Task list

**Phase A: preconditions**
- [ ] A1. P-0 merged (C-1). RM creates `feature/bos-plan-payments-p1` from `main`; confirm with `git branch --show-current`.
- [ ] A2. Record with the Credits Boost session that P-1 builds the dispatcher and boost 4a adds its resolver (§9.4, R-3). Note it in the requirement §9.4.
- [ ] A3. Ask TL to obtain TK-1's outcome from the user (C-2). P-1 can be built without it; it cannot merge without it.

**Phase B: fixtures (C-8)**
- [ ] B1. Write `scripts/capture-stripe-billing-fixtures.ts` (§7). Refuses to run unless the key starts `sk_test_`.
- [ ] B2. Run it in test mode; sanitise; save the fixtures; record each fixture's `api_version` and source event id in the evidence log.

**Phase C: modules**
- [ ] C1. `invoiceLinePrices.ts` + tests (Basil line, expanded price object, legacy `line.price`, unpriced line, `has_more`).
- [ ] C2. `stripeMetadataKeys.ts`.
- [ ] C3. `planPriceCatalog.ts` + tests (empty list → no Stripe call; non-empty → one call, cached, TTL expiry; Stripe error → throws, never an empty map).
- [ ] C4. `planInvoiceResolver.ts` + tests on the real fixtures (§6.1).
- [ ] C5. `webhookDispatcher.ts` + tests (Connect never consulted; conflict; throw propagates; ungoverned types pass through).

**Phase D: route**
- [ ] D1. Add the dispatcher call after the Connect split for platform events, the `completeClaim()` helper, the deny path (log, complete, 200 `{ received: true }`), and the flow path (handler map empty in P-1 → `BusinessOsHandlerMissingError`).
- [ ] D2. Delete `handleInvoicePaid` and its `switch` call. The dispatcher returns `deny` or `flow` for every platform `invoice.paid`, so the `switch` arm keeps only its Connect call; the platform `else` becomes a defensive `error` log (`platform invoice.paid reached the switch`) in case the dispatcher is ever bypassed.
- [ ] D3. Delete the `mode = 'subscription'` branch of `handleCheckoutCompleted` (pending §14 Q-2).
- [ ] D4. Remove imports left unused.

**Phase E: checkout**
- [ ] E1. `create-checkout`: Zod schema, 410 for `custom_credits` before any external call, standard 500 body. `boost_pack` unchanged.
- [ ] E2. If SA rules yes on §14 Q-3: the same 410 refusal on `update-subscription`.

**Phase F: tests and evidence**
- [ ] F1. Extend the P-0 harness with the platform scenarios in §6.2. Connect snapshots must be byte-identical to the ones P-0 recorded; the one platform snapshot P-0 recorded (scenario 11) changes by design, and the change is reviewed line by line.
- [ ] F2. `routerPlacement.guard.test.ts`.
- [ ] F3. Update `stripeAuditEntries.test.ts` and `userSubscriptionsWriteLockdown.qa.test.ts`; add `create-checkout/__tests__/route.test.ts`.
- [ ] F4. Run `scripts/check-logging-only-diff.ts --functions` (from P-0) over the Connect functions (`handleConnect*`, `recordPlanPeriodPaid`, `accountOwns`, `handlePlanSubscriptionEnded`, `handleDispute`, `handleChargeRefunded`): identical to `main`.
- [ ] F5. `npx jest app/api/stripe lib/business-os/billing lib/payments lib/repositories/__tests__/userSubscriptionsWriteLockdown.qa.test.ts`; `npm run test:bos-entitlements` (expected unaffected: no entitlements import, no tier literal); `npx tsc --noEmit` for the touched files; `npm run lint`.
- [ ] F6. Local demo (§11) and evidence log. Status → Code Complete, uncommitted, hand to TL.

---

## 6. Test plan

### 6.1 Unit (Jest)

| Suite | Cases |
|---|---|
| `invoiceLinePrices` | Basil fixture → the price id; expanded `price_details.price` object; legacy `line.price.id`; a line with no price; two lines (proration); `has_more` reported |
| `planPriceCatalog` | Empty list → empty map, Stripe not called; listed keys → one `prices.list` call, map built, second call within TTL served from cache; TTL elapsed → refetch; Stripe throws → loader throws |
| `planInvoiceResolver` (fixtures) | Real `invoice.paid` with an unknown price → `deny unknown_price`; the same invoice with an injected catalog that knows its price → `flow plan`; a two-line proration invoice with both prices known → `flow plan`; one known + one unknown → `deny mixed_prices`; known price + legacy `user_id` metadata → `deny metadata_mismatch`; unknown price + `product: business_os_plan` → `deny metadata_mismatch`; `has_more` → `deny lines_truncated`; no priced lines → `deny no_priced_lines`; `invoice.payment_failed` unknown → `not_business_os`; subscription-mode session → `deny legacy_subscription_checkout`; payment-mode session → `not_business_os`; catalog throws → resolver throws |
| `webhookDispatcher` | Connect event → `not_business_os` and no resolver called; one resolver `flow` → that flow; two `flow` → `deny resolver_conflict`; a resolver throws → rejects; outcome objects carry no account field (type test with `// @ts-expect-error`) |

### 6.2 Route (characterisation harness from P-0, extended)

| Scenario | Expected |
|---|---|
| **Hazard:** platform `invoice.paid`, unknown price, `metadata.user_id` and `credits` set (the G-6 shape) | 200; claim `completed`; **no** write to `user_subscriptions`, `credit_transactions` or `billing_events`; **no** `subscriptions.retrieve` or `subscriptions.list` call; `warn` `bos_billing_event_denied unknown_price` |
| Platform `invoice.paid`, unknown price, no metadata, customer with another subscription carrying `user_id` (the fallback shape) | Same; the fallback is never consulted |
| Platform `invoice.paid`, price known through an injected catalog | 500; claim `failed`; no writes; `bos_billing_plan_unhandled` |
| Platform `invoice.paid`, metadata mismatch | 200; claim `completed`; `error` with `alert: true` |
| Platform subscription-mode `checkout.session.completed` with `credits` metadata | 200; denied; no credit writes |
| Platform boost-pack `checkout.session.completed` | Unchanged from the P-0 snapshot |
| Platform `invoice.payment_failed`, unknown price | Legacy dunning runs as before (if Q-1 is ruled as proposed) |
| All Connect scenarios from P-0 | Snapshots unchanged (SR-10, AC-SR.3) |

### 6.3 Checkout

`create-checkout/__tests__/route.test.ts`: `boost_pack` happy path returns a session and queues `BOOST_PACK_CHECKOUT_INITIATED`; unauthenticated → 401; `purchaseType: 'x'` → 400; `boost_pack` without id → 400; `custom_credits` → 410, `StripeService` not called, no audit entry.

### 6.4 Acceptance mapping

| AC / condition | Test |
|---|---|
| AC-SR.1 (unknown price refused and logged, no Pilot-Credit row) | §6.2 hazard rows |
| AC-SR.2 (mismatch refused and alerted) | §6.1 resolver, §6.2 mismatch row |
| AC-SR.3 (Connect unchanged) | §6.2 Connect snapshots, F4 AST check |
| PF-9 / C-8 (Basil shapes, real payloads) | §6.1 on fixtures from §7 |
| PF-12 / C-2 (subscription checkout refused) | §6.3 |
| SR-3 (one endpoint) | No new route; guard asserts the dispatcher is called from the existing route only |

---

## 7. Fixture capture (C-8)

**Why real payloads:** the shapes PF-9 describes are easy to get subtly wrong in a hand-written fixture, and a wrong fixture would make a broken reader pass.

**Who and where:** Dev, on a local machine, with the **test-mode** platform key in `.env.local`. The script refuses any key that does not start `sk_test_`. Nothing touches live mode.

**Safety on the shared database.** Production receives test-mode events (§1). So every object the script creates carries **no `user_id`, `credits` or `bos_user_id` metadata** and uses a fresh customer with no other subscription. Before P-1 deploys, the legacy handler on production then finds no `user_id` and returns without writing (traced: `route.ts:47-92`); after P-1 deploys, the router denies it. The probe lookup keys (`bos_router_fixture_probe_a`, `bos_router_fixture_probe_b`) are **not** the keys P-2 will create, so they can never be recognised in production.

**Steps (`scripts/capture-stripe-billing-fixtures.ts`):**
1. Find or create the test product "BOS router fixture probe" with two monthly USD prices carrying the probe lookup keys, and one price with **no** lookup key.
2. Create a test clock and a customer on it (no metadata), attach `pm_card_visa`.
3. Subscribe to probe price A → `invoice.paid` (`billing_reason: subscription_create`).
4. Swap to probe price B with `proration_behavior: 'always_invoice'` → a two-line proration `invoice.paid`.
5. Subscribe a second clock customer to the no-key price → `invoice.paid` for an unknown price.
6. Attach `pm_card_chargeCustomerFail` as default and advance the clock one month → `invoice.payment_failed`.
7. Fetch the events with `stripe.events.list({ type, created: { gte: start } })`, filtered to these customers, and write each as `lib/business-os/billing/__tests__/fixtures/stripe/<scenario>.json`.
8. Sanitise: customer email → `fixture@example.invalid`; `customer_name`, `customer_address`, `customer_phone`, `customer_shipping` → `null`. Ids are kept (test-mode ids are not secret).
9. Clean up: delete the test clocks (which deletes their customers and subscriptions).

**Version check:** each fixture keeps `api_version`. The resolver suite asserts every fixture is `2025-10-29.clover`, so a capture on another version fails loudly instead of testing the wrong shape. Whether the **production endpoint** delivers on that version is a separate question (§14 Q-5): a webhook payload's shape is set by the endpoint's API version, not by the SDK pin.

The P-0 Connect fixtures stay synthetic. They only need to be identical before and after, not realistic.

---

## 8. Gates

| Gate | When | How it is shown |
|---|---|---|
| **C-1** P-0 merged | Before P-1 branches | P-1 cut from a `main` that contains P-0 |
| §9.4 dispatcher ownership recorded with the boost session | Before code | Line in requirement §9.4 |
| **C-2 / SR-14** TK-1 recorded: the four agent-platform subscriptions checked in the Stripe dashboard, live or test, cancelled if live | **Before merge** | User's answer recorded in the requirement §10.2 and the reuse plan TK-1 row |
| **C-8** fixtures from real test-mode payloads | Before SA code review | Fixture files with event ids and `api_version` in the evidence log |
| SA code review, user sees the diff, QA pass, user approval | Before RM commits | Standing flow |
| **C-3** P-1 **deployed to production** before P-3a merges | After merge (gate on P-3a, not on P-1) | Deployed commit on Vercel includes P-1, and one `bos_billing_event_denied` line (or the router's start-up path) seen in production logs. Recorded in this workplan's Commit Info so the P-3a workplan can cite it |

---

## 9. Tenant isolation

`tenant-isolation-guard` applies: the webhook runs on the service role and Stripe metadata is caller-controlled data (on Connect events it is written by the connected business; on platform events by whoever created the object).

| Skill rule | P-1 |
|---|---|
| Service role + caller-supplied id | The router reads price ids (identities we control) and metadata. It writes nothing except the claim row keyed by the Stripe event id |
| Never select an account from caller data | The outcome type has no account field; metadata is compared, never used to choose a row (SA tenant-isolation ruling, SR-8). Account resolution from our billing record is P-3b |
| Ownership pre-check before a write | No tenant write in P-1. The deletions **remove** a metadata-keyed service-role write path (`handleInvoicePaid` wrote `user_subscriptions` for whatever `user_id` the metadata named) |
| Connect events | Never reach the dispatcher; existing Connect ownership checks (`accountOwns`) untouched (F4) |
| Test | §6.1 type test (no account on outcomes); §6.2 rows assert no writes keyed on metadata for denied or unhandled events |

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A real Business OS plan invoice is denied for good (wrong shape, catalog failure) | Low in P-1 (none exist) | High from P-3a on | Real-payload fixtures; catalog throws instead of returning empty; plan-with-no-handler releases rather than denies; deny path covered by tests per reason |
| Connect regression in a live-money file | Low | High | Dispatcher skipped for Connect before any work; Connect functions AST-identical; harness snapshots unchanged |
| Agent-platform users (four test subscriptions) stop receiving credits on renewal | Certain | Low (E-1, E-2: testing accounts, platform parked) | Intended by RD-4/RD-12; TK-1 recorded before merge |
| Parked billing UI shows an error on "buy credits" | Certain | Low | 410 with a clear message; UI removal is P-10 |
| An archived Business OS price or a future price change makes renewals unknown | Low until prices change (out of scope) | High | No `active` filter; §14 Q-4 proposes a retired-price list |
| The endpoint delivers an older API version than the SDK pin | Unknown | High (every plan invoice unknown) | Legacy fallback in the reader; §14 Q-5 asks for the dashboard check |
| `invoice.payment_failed` left on the legacy path is the wrong call | Low | Low | §14 Q-1; a one-line change either way |

---

## 11. Demo

All in test mode; no event is sent through Stripe, so production never receives the demo events.

1. `npx jest lib/business-os/billing lib/payments/__tests__/invoiceLinePrices.test.ts app/api/stripe`: all green, including the fixture suite (shows the fixture `api_version`s) and the unchanged Connect snapshots.
2. Local dev server with test keys. `npx tsx scripts/replay-stripe-fixture.ts hazard` signs a copy of the captured `invoice.paid` with `metadata.user_id` set to a **designated test account** and `credits: 5000`, with a fresh `evt_replay_<uuid>` id, using the local `STRIPE_WEBHOOK_SECRET`, and posts it to `localhost:3000/api/stripe/webhook`. Shown: the `bos_billing_event_denied unknown_price` log line with `correlationId` and `stripeEventId`; a read-only query before and after showing no new `credit_transactions` row and an unchanged `user_subscriptions.balance` for that account. (The replay writes one `processed_webhook_events` row, `livemode = false`, as every test event already does.)
3. Replay the mismatch fixture → `error` line with `alert: true`.
4. Signed in as a test account: `POST /api/stripe/create-checkout { purchaseType: 'custom_credits', pilotCredits: 5000 }` → 410 and a `warn` line; `{ purchaseType: 'boost_pack', boostPackId }` still returns a session.
5. Show `planPriceCatalog.ts`: the empty `BOS_PLAN_LOOKUP_KEYS`, and the test where an injected catalog makes the same fixture `flow: plan` → 500 and a released claim, which is exactly what P-3a's demo will show for real.

---

## 12. Sizing

**2.5 to 3 days.**

| Part | Estimate |
|---|---|
| Fixture capture script, run, sanitise | 0.5 d |
| Reader, catalog, resolver, dispatcher + unit tests | 1 d |
| Route change, deletions, harness extension, guards, updated tests | 0.75 d |
| `create-checkout` (Zod, 410, tests) | 0.25 d |
| Evidence, demo, workplan | 0.25 d |

If it runs over, the split point is clean: the fixture capture script and the reader (C1) could land first as a test-only PR. The router and the `create-checkout` refusal must stay in one PR (C-2, PF-12).

---

## 13. Rollback

- **Before P-3a is deployed:** revert the PR. No migration and no data to undo. Effects of the revert: the credit conversion and the `custom_credits` checkout come back (the state before P-1). Events denied while P-1 was live stay `completed` and are not reprocessed; they were agent-platform test invoices (E-1), so no customer is owed anything.
- **After P-3a is deployed:** **no revert.** Reverting would put the conversion back in front of real Business OS plan invoices (G-6). Fix forward only. This is recorded so the P-3a workplan carries it.
- No feature flag: a switch that turns deny-by-default off would be a switch that turns the hazard back on.

---

## 14. Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | Platform `invoice.payment_failed` with an unknown price: deny, or pass to the legacy agent-platform dunning? | Pass through (`not_business_os`). It writes no credits, the reuse plan §4.6 lists its config under *Survives*, and a Business OS invoice never carries `user_id` (C-3). Denying it is a one-line change if SA prefers strict deny-by-default on every platform invoice event |
| Q-2 | Remove the platform subscription-mode `checkout.session.completed` conversion in P-1? It converts `credits` metadata on `user_id` metadata alone, at session time, and is not named in the requirement | Yes: it is the same hazard as `handleInvoicePaid` in another event, and with `custom_credits` refused nothing legitimate reaches it. P-3a adds Business OS session recognition ahead of the deny |
| Q-3 | `update-subscription` upgrades a platform subscription with `always_invoice`, which charges a proration invoice now that P-1 will deny: the same "paying into a denied path" as PF-12. Refuse it with 410 in P-1 too? | Yes, same PR. `cancel-subscription` and `reactivate-subscription` take no money and stay |
| Q-4 | Lookup keys move to a new price when a price changes, so renewals of old subscribers would carry a price id no key resolves to | Add `BOS_PLAN_RETIRED_PRICE_IDS: readonly string[] = []` to the catalog now (recognised as plan, empty in P-1), so a price change is a config line, not a router change. Or defer: price changes for existing subscribers are out of scope |
| Q-5 | Payload shape follows the **webhook endpoint's** API version (Stripe dashboard), not the SDK pin. Is the production endpoint (and the test-mode one) on `2025-10-29.clover`? | Ask the user for a dashboard look (Developers → Webhooks → endpoint → API version), alongside TK-1. The reader keeps the legacy fallback either way |
| Q-6 | Deny marks the claim `completed` and returns 200 (final); a recognised plan with no handler throws (claim `failed`, 500, Stripe retries for up to three days). Confirm both | As stated. The second is what P-3a's demo relies on |
| Q-7 | Marker constants: `product = 'business_os_plan'` and `bos_user_id`, fixed in P-1 for P-3a to write | As stated (boost uses `business_os_boost`) |
| Q-8 | `lines.has_more`: deny with `error`, or fetch all lines (one API call) | Deny with `error` in P-1: a plan invoice has at most three lines. P-3b may switch to fetching |
| Q-9 | While touching `create-checkout`: add Zod (rule 2) and the standard 500 body (no `error.message` in production)? | Yes, both small and on the touched route |

---

## Evidence log

*(Dev fills during implementation: fixture ids and `api_version`s, test runs, AST `--functions` output, harness diff, demo output, TK-1 outcome.)*

---

## QA Testing Report

*(QA to populate.)*

---

## Commit Info

*(RM to populate. Also record the production deployment of P-1 here, for C-3.)*

---

## SA Review

*(SA to populate.)*

**Reviewed by SA — 2026-10-02 (workplan review)**
**Status:** ✅ APPROVED WITH CONDITIONS (P1-C1 to P1-C8 below). Implementation starts only after P-0 merges (C-1); merge additionally needs TK-1 recorded (C-2) and the endpoint-version look (Q-5).

### Architectural fit

The design matches SA-P6 and SA-P7: dispatcher in `lib/business-os/billing/`, one call before the `switch`, platform events only, outcome type with no account field, metadata as cross-check only, throw-to-retry instead of "could not tell → deny", no feature flag. The price reader next to `invoiceSubscription.ts` is the right single home for PF-9. Tenant isolation (§9) is correct: P-1 removes a metadata-keyed service-role write path and adds none. No entitlements import, no migration. Sizing (2.5 to 3 days) is realistic; the test-clock fixture capture is the part most likely to run long, and §12's split point (capture script + reader first, test-only) is acceptable. Router and `create-checkout` refusal must stay in one PR (C-2), as planned. Nothing else needs splitting.

### Rulings on §14

| # | Ruling |
|---|---|
| Q-1 | **Deny, not pass-through** (reason `unknown_price`, `warn`), and also `deny metadata_mismatch` when an unknown-price failed invoice carries a Business OS marker. Reason: P-1 deletes `handleInvoicePaid`, which is the **only** path that resets `payment_retry_count` and clears `agents_paused` / `past_due` after a later successful payment (`route.ts:186-200`). Keeping dunning while removing its recovery makes a one-way pause, which RD-15 forbids. RD-16 is not violated: RD-16 forbids **deleting** survivors; `handleInvoicePaymentFailed` and `payment_grace_period_days` stay in the code untouched, they just stop being reached for platform subscription invoices (which, after P-1, nothing sells). Practical effect is near nil anyway: that handler keys on `invoice.metadata.user_id`, which Stripe does not copy onto subscription invoices. Record this in the reuse plan's F-7 row and §4.6 *Survives* note so TK-2/P-10 see it. |
| Q-2 | **Yes, remove it in P-1.** Same hazard as `handleInvoicePaid` in another event, covered by §4.6 *Dies* (the webhook's `QuotaAllocationService` calls, L-26) and unreachable legitimately once `custom_credits` is refused. |
| Q-3 | **Yes, 410 on `update-subscription` in the same PR** (auth first, then 410, logged, no Stripe call, no audit). It is on the §4.6 *Dies* list and `always_invoice` takes money into the now-denied path: PF-12 applies directly. `cancel-subscription` and `reactivate-subscription` take no money and stay. Add it to §4 and the test plan. |
| Q-4 | **Defer to P-2; do not add an empty list now.** A retired price needs a tier as well as recognition, and the lookup-key → tier mapping lands in P-2's entitlements config. P-2's workplan must state how a renewal on a price whose lookup key moved is recognised (carried as a P-2 requirement, see P1-C8). |
| Q-5 | **User/ops look, before P-1 merges, alongside TK-1** (see "User actions" below). The reader keeps the legacy fallback regardless. |
| Q-6 | **Confirmed both.** Deny = claim `completed` + 200 (final; Stripe stops). Recognised with no handler = throw → existing catch releases the claim → 500 → Stripe retries. Deny must never be produced by an exception path. |
| Q-7 | **Confirmed:** `product = 'business_os_plan'` and `bos_user_id`, constants in `stripeMetadataKeys.ts`, never read to select an account. P-3a must also never write `user_id`, `credits` or `pilot_credits` (C-3), because `handleSubscriptionUpdated` and `sync-subscription` still act on those names. |
| Q-8 | **Deny with `error` + `alert: true` accepted for P-1** (nothing is recognised yet, and a plan invoice has at most three lines). Carry-forward: before P-3b assigns plans, a truncated recognised invoice must be fetched, not denied for good. |
| Q-9 | **Yes, both** (rule 2, Error Response Format). |

### RD-16: does removing `handleInvoicePaid` break a surviving path?

Checked against §4.6 *Survives*. Connect: untouched (separate handlers, F4 AST check). Signup grant: independent. `user_subscriptions` table, `credit_transactions` history, `billing_events`, `processed_webhook_events`: unchanged. `account_frozen` and `free_tier_expires_at`: `handleInvoicePaid` was one of the paths that cleared them; that loss is already the accepted TK-3 / RD-9 trap (the freezing cron stays unscheduled) and P-1 does not worsen it. `agents_paused` from CreditService has its own clear path (`CreditService.ts:335`). The **only** break is the dunning recovery, closed by the Q-1 ruling. With Q-1 ruled deny, P-1 breaks no surviving path.

### Conditions

1. **P1-C1** Q-1 as ruled: platform `invoice.payment_failed` with an unknown price is denied; update §3.3's table, §6.1, §6.2 (replace the "legacy dunning runs" row), §10's last risk row, and record it in the reuse plan F-7 / §4.6 notes.
2. **P1-C2** `update-subscription` refused with 410 in this PR (Q-3), with a route test (401, 410, no Stripe call) and the `stripeAuditEntries.test.ts` update if it covers that route.
3. **P1-C3** Catalog staleness: when the key list is non-empty and a priced line is not in a cache-served map, refetch once (bypassing the cache) before returning `unknown_price`. A 5-minute stale cache must never permanently deny a paying invoice. Implement in the P-1 loader and test it with an injected Stripe client, even though the list is empty in P-1.
4. **P1-C4** The deny path's claim completion must go through the same update the existing end-of-handler path uses (`completeClaim()`), and the Connect harness snapshots must stay byte-identical (SHA-256 recorded as in P-0's P0-C2). The defensive "platform `invoice.paid` reached the switch" branch logs `error` + `alert: true` and writes nothing.
5. **P1-C5** Fix the webhook's 500 body to the CLAUDE.md format (`details` only in development, generic `error` otherwise), since P-1 adds new throw paths (catalog Stripe errors, `BusinessOsHandlerMissingError`) that would otherwise reach it. Status code and retry behaviour unchanged; harness scenario 10 changes in body only, reviewed line by line.
6. **P1-C6** No new direct Supabase access: the new `lib/business-os/billing/` modules read nothing from the database in P-1 and must not import the route's `supabaseAdmin`. The route's own `createClient` (rule 1) stays a tracked follow-up, not P-1 scope.
7. **P1-C7** Fixture capture safety as written in §7 (no `user_id` / `credits` / `pilot_credits` / `bos_user_id` metadata, fresh customers on test clocks, `sk_test_` guard), plus: the script must also refuse if the captured events' customer has any subscription with those metadata keys, and the evidence log records that the production webhook processed the capture events without any `user_subscriptions` write (one read-only check by the user, or by Dev on the local DB if the capture targets a local endpoint).
8. **P1-C8** Carry-forwards recorded in the requirement §9.4 / slice rows, so they are not lost: Q-4 (retired-price recognition, P-2), Q-8 (fetch on truncation, before P-3b), `sync-subscription` remaining a metadata-driven credit path until P-10 (no BOS impact because BOS uses its own Stripe customer per SA-P1, but it must stay on P-10's list).

### User actions owed before P-1 merges

- **TK-1** (C-2): Stripe dashboard, live mode and test mode: the four agent-platform subscriptions, live or test, cancelled if live.
- **Q-5, endpoint API version:** Stripe dashboard → Developers → Webhooks (Workbench: "Event destinations"). For **each** endpoint whose URL is the production `/api/stripe/webhook` (expect one "your account" endpoint and one "connected accounts" endpoint, since the route verifies two secrets), in **both** test and live mode, read the **API version** shown on the endpoint's details panel and report it as text (e.g. `2025-10-29.clover`). Also report the account's default API version (Workbench → Overview) if any endpoint shows none. Copy no signing secret. Anything other than `2025-10-29.clover` on the platform endpoint must be reported to SA before merge.
- **SA-P13 remainder:** whether the Vercel production `STRIPE_SECRET_KEY` starts `sk_live_` or `sk_test_` (look, do not copy).

### Approval
[x] Workplan approved with conditions P1-C1 to P1-C8 — implement after P-0 merges; merge gated on TK-1 and the Q-5 look.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-02 | Created (Dev) | P-1 workplan: Business OS dispatcher and plan price-id router, deny by default, conversion and fallback removed, `custom_credits` refused, real-payload fixtures, gates C-1/C-2/C-3/C-8 |
