# Workplan: Business OS Plan Payments, P-7b.1 (Upgrade now: Essentials → Autopilot)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): F7 (incl. "How (SA)"); §6 (upgrade, credit period); §9.1 P-7b.1 and P-7b.2 rows; §9.4 **CF-6**; SR-5, SR-8, SR-11, SR-12, SR-15, SR-16, SR-17; AC-F7.1, AC-F7.3; and **"SA Ruling — P-4 and P-7b.1 sequencing (2026-10-12)"**, R-1, R-2 and conditions **U-1 to U-10**. Also SA's later notes in the [P-4 workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P4_WORKPLAN.md): the P-4.2 Low note on the admin-assigned plan offered Choose on its own plan, QA P-4.2 note 2 (Stripe Checkout language), and P-4.1 follow-ups F-A and F-B.
**Depends on:** P-3b merged (#251, #299); P-5a merged (#314, #327); **P-4 merged** (P-4.1 #337, P-4.2 #341), whose purchase view (`planPurchaseView.ts`), `planPurchaseOffer` pattern, Settings → Plan island, shared Stripe.js loader and bounded re-read this slice reuses. **Not P-6a** (SA R-1).
**Date:** 2026-10-13
**Branch:** `feature/bos-plan-payments-p7b1`, worktree `neuronforge-invite-s1`, fresh from `origin/main` `103dead2` (#341). Confirmed with `git branch --show-current` on 2026-10-13. Nothing written yet but this workplan and the requirement row.
**Status:** P-7b.1a **Code Complete** (uncommitted), awaiting SA code review. T1 (sandbox experiments) BLOCKED on the sandbox key; T2 "code done, pending E-1". P-7b.1b not started.

## Overview

P-7b.1 lets an owner who pays for **Essentials** move to **Autopilot** at once, from **Settings → Plan**. The section shows "Upgrade to Autopilot". Pressing it asks the server for a **preview**: the prorated amount due now, in USD, "excluding tax", and the unchanged renewal date. The owner confirms. The server swaps the price on their existing Stripe subscription, and Stripe charges the card on file at once. If the bank asks, the owner completes 3-D Secure in the same screen. The screen then says "Upgrading…" until the server re-read shows Autopilot. A declined card, or an abandoned 3-D Secure step, leaves the account on Essentials, with a clear line.

Two webhook gaps are closed in the same slice:

- **CF-6 (U-3):** an upgrade paid from the customer's Stripe credit balance, or one too small for Stripe to charge, is applied instead of only recorded.
- **U-4:** a paid upgrade invoice that Stripe did not apply to the subscription never writes `pro` to the plan row.

Nothing is decided in the browser. One server predicate decides whether the upgrade is offered (screen) and admitted (routes), and a fresh Stripe read re-checks it before money moves.

**Nothing changes in production after merge.** The two routes answer 404 while `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` is off, and refuse while `BUSINESS_OS_PLAN_PRICES_ENABLED` is off. Both are off on Vercel. `availableToBuy` is on for both tiers since 2026-10-13 (testing), so the target tier's flag does not keep it inert; the two switches do. No migration.

**Size: about 5 dev-days**, over SA's ~3d. A split into two PRs is proposed in §10: **P-7b.1a "Upgrade backend and CF-6"** (~3.3d) and **P-7b.1b "Upgrade in Settings"** (~1.8d).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope](#2-scope)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Gates](#5-gates)
6. [Task List](#6-task-list)
7. [Tests](#7-tests)
8. [Sandbox Experiments and Fixtures (U-6, U-7)](#8-sandbox-experiments-and-fixtures-u-6-u-7)
9. [Demo Plan](#9-demo-plan)
10. [i18n and RTL](#10-i18n-and-rtl)
11. [Sizing and Split](#11-sizing-and-split)
12. [Risks](#12-risks)
13. [Rollout, Rollback and Migration Check](#13-rollout-rollback-and-migration-check)
14. [Questions for SA](#14-questions-for-sa)

---

## 1. Analysis Summary

As built on `origin/main` `103dead2`, read for this workplan:

| Area | As built | What P-7b.1 needs |
|---|---|---|
| `planInvoiceFacts.ts` (pure) | Tier and period from **positive** plan lines only, so an upgrade invoice (negative `basic` credit line, positive `pro` line) reads `pro`, period = upgrade time → current period end. `assignsPlan` = paid AND (`amount_paid > 0` OR a discounted `subscription_cycle`). Header already names CF-6 as open | U-3: also a paid `subscription_update` with `total > 0` and a positive plan line. Expose the deciding price id(s) for U-4 |
| `planInvoiceResolver.ts` | Routes `invoice.paid` / `invoice.payment_failed` by price; both lines are catalog prices, so an upgrade invoice is `flow: 'plan'` (SA R-1) | No change |
| `planPaymentApply.ts` | Steps 1–10; step 9 reads the subscription fresh (`retrieveBusinessOsSubscription`: status, anchor, customer, deduplicated `priceIds`), then calls `business_os_apply_plan_payment`; `afterApply` audits `BOS_BILLING_INVOICE_PAID` through `recordPlanChange` (no `billingReason` in details today). A failed invoice is one `invoice_payment_failed` row | U-4 branch for `subscription_update` invoices only; `billingReason` added to the invoice-paid audit details (U-9) |
| Apply function (20261028) | `v_newest` = period end later, or equal with `paid_at >= last_paid_at`; `v_plan_written = p_assigns_plan AND v_newest`; anchor set only on the first plan-writing paid invoice of the subscription; writes `bought_tier` only when the plan is written; stamps the first payment only when `p_amount_minor > 0` and none exists | **No SQL change** (SA R-1, U-3). An upgrade keeps the subscription id, so the anchor never moves. Pinned by a rolled-back probe (U-8) |
| `planSubscriptionMirror.ts` | `customer.subscription.updated` copies status, `cancel_at_period_end`, `ended_at` only, read fresh | No change. The pending update and its expiry never move the plan row (SA R-1) |
| `StripeService` | Pinned `apiVersion: '2025-10-29.clover'`. `retrieveBusinessOsSubscription` returns deduplicated `priceIds`, no item ids, no item count, no `pending_update`, no latest invoice. No preview or update method for Business OS. `cancelSubscription` / `reactivateSubscription` are legacy | Additive fields on the subscription read; two new methods (§3.3) |
| `planCheckout.ts` | The route template for order (C-4 as amended by SA for P-4.1), refusals as results, `PLAN_CHECKOUT_REFUSALS`, `isLiveSubscriptionStatus`, idempotency keys, the price resolver (SA-P12 b) | Reused: price resolver, `isMissingCustomerError`-style Stripe error helpers, the order contract wording, the refusal pattern |
| `planCheckoutEligibility.ts` | `planPurchaseOffer` (non-held) and `heldPaymentOffer` (held), one predicate each for screen and server; `buyableTiers()` = Stripe price AND `availableToBuy` | A third twin, `planUpgradeOffer`, from our data only (§3.1) |
| `planPurchaseView.ts` + `my-plan` | Input-free route; billing row by session user and key mode; `purchase = { offer, billing, endsFreeAccessOnPurchase }`; no Stripe call (SR-11). For a paying account `offer = none / paying`, and Autopilot is shown as information in `NextPlanUp` | `purchase.upgrade` added from the same predicate (§3.6) |
| `PlanSection.tsx` / `PlanPurchase.tsx` | Client components. "It renders; it does not decide." Bounded re-read (4 s × 15, `checkoutProcessing.ts`); success only from the server re-read; refusals localised by code (`planPurchaseCopy.ts`) | An upgrade island next to `NextPlanUp` (§3.7) |
| `lib/client/stripeJs.ts` | One Stripe.js loader with the `pk_(test|live)_` shape check | Reused for 3-D Secure (`handleNextAction`) |
| Audit | `BOS_BILLING_CHECKOUT_STARTED`, `_INVOICE_PAID`, `_PAYMENT_REFUSED`, `_FIRST_PAYMENT_STAMPED` registered in `lib/audit/events.ts`, `eventAudience.ts` (`'bos'`) with SOC2 only | `BOS_BILLING_UPGRADE_REQUESTED` registered the same way (U-9) |
| Entitlements registration | The checkout route, `planCheckout.ts`, `planCheckoutEligibility.ts`, `planPurchaseView.ts` are recorded non-gates in `enforcementPoints.test.ts` | Every new importer registered (§3.9). F-B (inline `type` parser) still open |

**F-3 / FC-1 / FC-2** (Founding Partner after a paid period) are unaffected: the upgrade keeps the subscription and its period end.

**Platform phase touched:** none of the V6 pipeline. Business OS billing, the webhook plan handler, one customer route pair, and the Settings → Plan section.

**Deprecated patterns found:** `StripeService.cancelSubscription` / `reactivateSubscription` / `getSubscription` are legacy agent-platform helpers. Not used or extended here. No `console.*` in any file this slice touches (checked: `planInvoiceFacts.ts`, `planPaymentApply.ts`, `planBillingHandler.ts`, `planPurchaseView.ts`, `planCheckoutEligibility.ts`, `PlanSection.tsx`, `PlanPurchase.tsx`, `StripeService.ts` plan methods, the checkout and `my-plan` routes).

---

## 2. Scope

| In | Out (and where it lives) |
|---|---|
| "Upgrade to Autopilot" in Settings → Plan for a paying `basic` owner, with the preview amount, "excluding tax", the unchanged renewal date (F7) | Downgrade at renewal, undo, "an upgrade while a downgrade is scheduled" (P-7b.2) |
| Preview and confirm routes, strict Zod, account from the session only (R-2) | Renewal failure / "confirm your payment" banners, attempt counting (P-6a; **U-10** recorded for it, §3.5) |
| `subscriptions.update` with `always_invoice` + `pending_if_incomplete`, the preview's `proration_date`, the U-1 idempotency key (U-1) | Card update and invoice list (P-7a; see Q-6 for what a declined owner is told meanwhile) |
| Eligibility on our record, then a fresh Stripe read (U-2) | Any new switch (R-2 "Flags") |
| CF-6 fix in `planInvoiceFacts` (U-3) | Any migration (none needed, §13) |
| U-4 guard in the webhook apply path | Stripe Checkout language (QA P-4.2 note 2): no Checkout frame is used here; see §10 and Q-8 |
| In-session outcomes: upgraded, action required (3-D Secure in place), declined, refusal (U-5) | F-A (holding-screen copy after a racing expire): this slice does not touch that screen |
| `BOS_BILLING_UPGRADE_REQUESTED` audit, flushed (U-9); en/he/es with RTL | Admin billing panel display of the change (P-8a; the audit and money history carry it now) |
| F-B parser fix (we edit `enforcementPoints.test.ts` anyway) | — |
| Wording for an admin-assigned plan offered Choose on its own plan (SA P-4.2 Low note), if SA rules it in (Q-7) | — |

---

## 3. Implementation Approach

### 3.1 One predicate for whether an upgrade is offered (our data only)

A new pure function next to `planPurchaseOffer`, in `planCheckoutEligibility.ts` (or `planUpgradeOffer.ts` if SA prefers a smaller file):

```text
planUpgradeOffer(facts, switches, buyable) →
  { kind: 'upgrade', from: TierId, tiers: TierId[] }      // buyable tiers ABOVE boughtTier, in TIER_ORDER
| { kind: 'none', reason: 'switches_off' | 'not_subscribed' | 'not_active'
                        | 'cancelling' | 'top_tier' | 'not_on_sale' }

facts = { boughtTier, subscriptionId, subscriptionStatus, cancelAtPeriodEnd, endedAt }   // OUR billing row only
```

First reason wins, in this order: switches off (checkout or prices) → no billing row, no `boughtTier` or no subscription id (`not_subscribed`, so the upgrade never races the first payment, U-2) → status not `active` or `endedAt` set (`not_active`) → `cancelAtPeriodEnd` (`cancelling`) → no tier above `boughtTier` in `TIER_ORDER` (`top_tier`) → none of those is buyable (`not_on_sale`). Tiers come from `TIER_ORDER` and `buyableTiers()`; no tier literal.

- **The my-plan view** (§3.6) and **both routes** call this one function. The screen shows the Upgrade button exactly when it says `upgrade`, and only for the tiers listed.
- **What our record cannot know** (`pending_update`, the live item price, Stripe's status now) is checked by the routes after a fresh Stripe read (§3.2). Those refusals are the documented exceptions in the matrix test, as M-3's were for P-4.
- **The plan row's tier is not an input** (U-2): an admin override (F4) may differ from what Stripe bills. See Q-5 for the display consequence.
- **A held account** is not read. A held account has no `boughtTier` (its first paid invoice is what releases it), so it is `not_subscribed` by construction. A test pins that, rather than relying on it.

### 3.2 Eligibility after the fresh Stripe read (U-2)

A second pure function, `planUpgradeEligibility(row, subscription, target, tierOfPrice)`, run by both routes after the read:

| Rule | Refusal code | Level |
|---|---|---|
| Subscription id, customer and mode on Stripe equal our row's | `billing_record_mismatch` | `error` + `alert: true` (reconciliation) |
| Status is `active` (`past_due`, `incomplete`, `trialing`, `unpaid`, `paused` and anything unknown refused) | `subscription_not_active` | warn |
| `cancel_at_period_end` is false | `subscription_cancelling` | warn |
| No `pending_update` (Q-2 resume: a pending update on the target whose open `subscription_update` invoice asks for `requires_action` is resumed by the confirm, and answered `upgrade_awaiting_confirmation` by the preview, §3.4) | `upgrade_pending` (with `retryAfter` = `pending_update.expires_at`) | warn |
| **Exactly one** item (an item count other than one) | `billing_record_mismatch` | `error` + `alert: true` |
| *(SA V-2)* The single item is on a tier **above** `boughtTier`, with no pending update: the upgrade went through and the webhook has not landed yet | `upgrade_processing` | warn, **no alert** |
| The single item's price is not in the catalog (retired keys included, CF-1), or its tier is **below** `boughtTier` | `billing_record_mismatch` | `error` + `alert: true` |
| Target above `boughtTier` in `TIER_ORDER`, and in `buyableTiers()` | `not_an_upgrade` / `price_unavailable` (`tier_not_sold`) | warn / error |
| *(SA V-8, Q-1)* Confirm only: `prorationDate` ≥ the single item's `current_period_start` (on `2025-10-29.clover` the period lives on the subscription ITEM) | `preview_expired` | warn |

Refusals are results, never throws (U-2). A Stripe read that fails is `stripe_error` (502).

### 3.3 Stripe calls, exact parameters (U-1)

All Stripe access stays in `StripeService`. CF-4 holds: the methods build their own parameters and take no metadata from the caller.

**(a) `retrieveBusinessOsSubscription` — additive fields** (U-4 asks for `pending_update` presence):

```text
+ items: Array<{ id: string; priceId: string | null }>   // every item, NOT deduplicated (U-2 "exactly one")
+ pendingUpdate: { expiresAt: number } | null           // subscription.pending_update
+ latestInvoiceId: string | null
```

Existing fields and callers (resolver, apply, mirror) are unchanged; their tests get the new fields in fixtures.

**(b) `previewBusinessOsPlanUpgrade`** — read-only at Stripe:

```ts
stripe.invoices.createPreview({
  customer: row.stripeCustomerId,               // from OUR row
  subscription: row.stripeSubscriptionId,       // from OUR row
  subscription_details: {
    items: [{ id: itemId, price: targetPriceId }],   // itemId from the fresh read; price from the runtime price check
    proration_behavior: 'always_invoice',
    proration_date: prorationDate,              // chosen by the server: now, unix seconds
  },
});
// returns only { amountDueMinor, totalMinor, currency } — the invoice object is never logged or returned
```

`invoices.createPreview` replaced "upcoming invoice" on the Basil line; the exact field names are confirmed against the SDK types and in experiment E-1 (§8).

**(c) `upgradeBusinessOsPlanSubscription`** — the one write:

```ts
stripe.subscriptions.update(
  row.stripeSubscriptionId,                     // from OUR row (SR-8)
  {
    items: [{ id: itemId, price: targetPriceId }],
    proration_behavior: 'always_invoice',
    proration_date: prorationDate,              // the preview's, validated (§3.4)
    payment_behavior: 'pending_if_incomplete',
    expand: ['latest_invoice.confirmation_secret'],   // + the payment state, shape confirmed in E-1
  },
  { idempotencyKey: `bos-upgrade:${subscriptionId}:${targetPriceId}:${prorationDate}` }
);
```

Never `billing_cycle_anchor`, never `trial_end`, never `metadata` (CF-4; Stripe also refuses metadata on a `pending_if_incomplete` update). No price is created (L-9, AC-F7.3): `targetPriceId` is the one behind the target's lookup key, and the runtime price check (SA-P12 b, `planCheckoutPrice.ts`) runs on it first and must equal the display price.

The method returns facts only:

```text
{ pendingUpdate: boolean,
  invoiceId, invoiceStatus: 'paid' | 'open' | ...,
  paymentState: 'succeeded' | 'requires_action' | 'requires_payment_method' | 'processing' | 'none',
  confirmationClientSecret: string | null }      // returned to the route, NEVER logged
```

A `StripeCardError` thrown by the call (if Stripe declines synchronously on this path; E-2 tells) maps to `paymentState: 'requires_payment_method'`. How the payment state is read on `2025-10-29.clover` (the invoice's `payments` list, expanded, or one `invoicePayments.list` read) is settled by E-1 and recorded in Implementation Notes; the outcome mapping does not depend on which.

### 3.4 The two routes

Both are built with the `new-api-route` skill, on the checkout route's shape: 404 while `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` is off (nothing read, SA Q-6 of P-3a), `getUser()` → 401, strict Zod → 400 with the development-only `details`, `resolveAccountId(user.id)`, Pino `logger.child({ correlationId })`, the CLAUDE.md error format, refusals answered with `{ success: false, error, code }` from one `PLAN_UPGRADE_REFUSALS` table.

| | **Preview** `POST /api/business-os/billing/plan/upgrade/preview` | **Confirm** `POST /api/business-os/billing/plan/upgrade` |
|---|---|---|
| Body (strict) | `{ tier: z.enum(TIER_ORDER) }` | `{ tier: z.enum(TIER_ORDER), prorationDate: z.number().int().positive() }` |
| Writes at Stripe | None | The price swap |
| 200 | `{ tier, amountDueMinor, taxMinor, currency: 'usd', prorationDate, renewsOn, monthlyPriceMinor }` (V-12: `taxMinor` from Stripe's answer) | `{ outcome: 'upgraded' }` · `{ outcome: 'processing' }` (V-4, Q-4: the screen treats it as `upgraded`) · `{ outcome: 'action_required', clientSecret }` (fresh, or resumed, Q-2) · `{ outcome: 'declined' }` (with `retryAfter` when a pending update stays, Q-6) |
| Audit | None (a read). Logged | `BOS_BILLING_UPGRADE_REQUESTED`, flushed before the 200 (WC-7), for every outcome |

**Order contract** (C-4, as worded for P-4.1, applied here): every database read precedes any Stripe call; every refusal decided from our own data precedes any Stripe call.

```text
 1  switch: checkout off                  → 404 (route looks absent)
 2  auth, body                            → 401 / 400
 3  prices switch off, key mode unknown   → upgrade_unavailable (503)
 4  billing row (session user, key mode)  → billing_row_unreadable (503)
 5  planUpgradeOffer (our data, §3.1)     → not_subscribed / subscription_not_active /
                                            subscription_cancelling / not_an_upgrade /
                                            price_unavailable (tier_not_sold) / upgrade_unavailable
 6  confirm only: prorationDate clock window → preview_expired (409)                   [no Stripe call yet]
 7  Stripe: fresh subscription read       → §3.2 refusals (incl. V-2 upgrade_processing, V-8 period start)
 7a Stripe, only when 7 shows a pending update on the target (Q-2): one invoice read
                                          → confirm: action_required (resumed) | preview: upgrade_awaiting_confirmation
                                          → anything else: upgrade_pending (retryAfter)
 8  Stripe: runtime price check (target)  → price_unavailable / price_mismatch (503)
 9  Stripe: preview  |  update            → result
```

**`prorationDate` (confirm).** The preview chooses it (server clock, unix seconds) and returns it; the confirm accepts it only if it is not in the future (60 s skew allowed) and not older than **15 minutes** (step 6, no Stripe call), and not before the single item's `current_period_start` (after the fresh read, step 7, SA V-8: the period start lives on the subscription item on `2025-10-29.clover`). Outside the window → `preview_expired`, and the screen asks for a fresh preview. The window is Q-1.

**Double click / two tabs.** The button is disabled while a request runs. Two confirms with the same `prorationDate` carry the same idempotency key: Stripe replays the first response for an identical request, and answers an idempotency conflict for one still in flight (`idempotency_key_in_use`), which maps to `upgrade_busy` (409); any other idempotency error is `stripe_error` + alert (V-7). A confirm after the first has finished (SA V-2) reads either the item already on the higher tier with no pending update → `upgrade_processing` (409, warn, no alert: the webhook has not landed yet; the screen goes to "Upgrading…" and the re-read), or a `pending_update` → resumed (Q-2) or `upgrade_pending`. So a second charge is never made.

**Unknown result after the write (SA V-3).** A Stripe failure on the `subscriptions.update` call itself (timeout, 5xx, connection) is `stripe_error` (502) logged `error` with `alert: true` and audited with `outcome: 'unknown'`. The screen (P-7b.1b) never says "nothing changed": "We could not confirm your upgrade" with **Check again** (re-read my-plan) and **Try again**, which re-posts the **same** `prorationDate` so the idempotency key replays rather than charges twice. The 502 body carries `outcomeUnknown: true` so the screen can tell it from a `stripe_error` before any write.

**Refusal codes** (status, owner message in English; the screen localises by code):

| Code | Status | When |
|---|---|---|
| `upgrade_unavailable` | 503 | Prices switch off, key mode unknown, or the purchase switches read off |
| `billing_row_unreadable` | 503 | Our record cannot be read |
| `not_subscribed` | 409 | No billing row, no `boughtTier`, no subscription |
| `subscription_not_active` | 409 | Record or Stripe status is not `active` |
| `subscription_cancelling` | 409 | Set to cancel at period end |
| `upgrade_pending` | 409 | Stripe holds a pending update (`retryAfter` in the body) |
| `upgrade_awaiting_confirmation` | 409 | Preview only (Q-2): our pending upgrade to this target waits for 3-D Secure; body carries `amountDueMinor` and a fresh `prorationDate`, never a secret |
| `upgrade_processing` | 409 | SA V-2: Stripe already bills the higher tier; the webhook has not landed. warn, no alert |
| `not_an_upgrade` | 409 | Target not above `boughtTier` |
| `price_unavailable` / `price_mismatch` | 503 | Target not on sale, or the Stripe price differs from the display price |
| `billing_record_mismatch` | 409 | Our record and Stripe disagree (customer, mode, subscription, item count ≠ 1, item price below `boughtTier` or not in the catalog); alerted (V-2) |
| `preview_expired` | 409 | `prorationDate` outside the window |
| `upgrade_busy` | 409 | Idempotency conflict (the same request still in flight) |
| `stripe_error` | 502 | Stripe did not answer |

**Logs.** `bos_billing_upgrade_previewed` (info: tier from/to, amounts, prorationDate), `bos_billing_upgrade_refused` (code; `error` with `alert: true` only for `billing_record_mismatch`, price problems, `stripe_error`), `bos_billing_upgrade_requested` (info: outcome, invoice id, subscription id, livemode). **The confirmation client secret is never logged, never audited, never put in an error.** A test spies on every logger and audit call and asserts the fixture's secret string appears in none of them, and only in the 200 body.

### 3.5 Webhook side (U-3, U-4, U-10)

**U-3 (CF-6), `planInvoiceFacts.ts`:**

```text
assignsPlan = kind === 'paid' && (
     amount_paid > 0
  || (billing_reason === 'subscription_cycle' && discounted)              // unchanged
  || (billing_reason === 'subscription_update' && total > 0 && positive plan line exists)   // NEW
)
```

Covers the credit-balance payment (`amount_paid = 0`, `total > 0`) and the under-$0.50 upgrade that Stripe marks paid and carries to the balance. Excludes a trial-period price swap (`total = 0`, no positive line) and a prorated downgrade credit (`total < 0`). `total` is added to the C-6 field list in `planStripeFields.c6.test.ts`. The facts also expose `decidingPriceIds` (the prices of the deciding lines) for U-4. No SQL change; the first-payment stamp keys on `p_amount_minor > 0` and is unaffected.

**U-4, `planPaymentApply.ts` step 9, `subscription_update` invoices only:**

1. The fresh read shows a `pendingUpdate` **that belongs to this invoice** (`latestInvoiceId === facts.invoiceId`, SA V-5) → log `warn` (`bos_billing_upgrade_pending_at_stripe`) and **throw `PlanPaymentRetryError('upgrade_pending_at_stripe')`**: the claim is released and Stripe retries. A pending update for a **different** invoice goes on to the item-price test (cases 2 / 3), so a replay of an old upgrade invoice is never held in retry for up to 23 hours.
2. No pending update, and the subscription's single item is **not** on a deciding price (or there is more than one item) → apply with `assignsPlan = false` (`upgradeNotApplied`). The money is recorded; the plan row is untouched.
3. Otherwise unchanged.

**The alert and audit for case 2 are written only when the apply result is `recorded`** (a new money-history row), never on `already_applied` / `already_recorded`. A replay of an old upgrade invoice after a later price change (P-7b.2's downgrade) therefore alerts nothing. Case 2 logs `error` with `alert: true` (`bos_billing_upgrade_paid_not_applied`, "upgrade paid but not applied at Stripe") and audits. Which audit entry is Q-3; Dev proposes the existing `BOS_BILLING_INVOICE_PAID` entry with `upgradeNotApplied: true` and severity `warning`.

**U-9 on the webhook:** the existing `BOS_BILLING_INVOICE_PAID` details gain `billingReason`, so the tier change of an upgrade is visible as such.

**U-10 (forward, P-6a):** recorded in §14 and in the requirement row. The failed-payment and "confirm your payment" banners and the attempt count key on renewals only (`subscription_cycle`, or the subscription's status), never on a `subscription_update` invoice. Nothing is built for it here; `recordFailedPlanInvoice` already writes one history row for a failed upgrade and moves nothing.

### 3.6 The my-plan view

`planPurchaseView.ts` adds one field, from the same record read it already makes (SR-11, no Stripe):

```text
purchase.upgrade: null | { tiers: string[] }      // planUpgradeOffer → 'upgrade'
```

`planPurchaseTypes.ts` gains `PlanUpgradeWire` (import-free, W-6). The `my-plan` route still reads no input; its guard tests stay. The matrix test (`planUpgradeOffer.matrix.test.ts`) drives the real view and the real preview route (with fakes) over every our-data combination and asserts that the view offers tier X exactly when the preview route gets past step 5 for X (SA F-C's lesson: through the view's own reads, not the predicate).

### 3.7 The Settings UI

A client island `components/business-os/settings/PlanUpgrade.tsx`, rendered by `PlanSection` beside the "next plan" block when `purchase.upgrade` lists the plan:

```text
idle      → [Upgrade to Autopilot]
preview   → "Working out the price…"  → POST preview
quoted    → "$NN.NN due now, excluding tax." / "Nothing to pay now: your account credit covers it."
            "Your plan renews on <date> at $129 a month."    [Confirm upgrade] [Not now]
confirm   → POST confirm (button disabled)
  upgraded        → "Upgrading…" + bounded re-read of my-plan (shared constants)
  action_required → Stripe.js `handleNextAction({ clientSecret })` via getStripePromise()
                      success → "Upgrading…" + re-read
                      error / closed → "The payment was not confirmed, so nothing changed."
  declined        → "Your card was declined, so nothing changed. You're still on Essentials."
  refusal         → localised line by code (upgrade_pending shows the retry time)
done      → "You're on Autopilot." ONLY when the re-read shows planId = target, kind tier,
            billing.state renewing (U-5); a failed re-read never claims success;
            after the last re-read: "This is taking longer than usual." + Check again
```

- Plan names and prices come from the payload (`plans`), never a literal (FR-12).
- `clientSecret` lives only in component memory for the `handleNextAction` call; it is never put in the URL, storage or a log.
- No Stripe.js key → the island shows `plan.choose.not_configured` and never POSTs the confirm (M-2 pattern). The preview needs no Stripe.js.
- The island imports no entitlements value and no server code (P-4.2 source-guard style).

### 3.8 Tenant isolation (`tenant-isolation-guard`)

- The only request values are `tier` (an enum) and `prorationDate` (an integer, window-checked). No id is taken from the request.
- The subscription id, customer id and item id come from **our** billing row, read by the session user and the server key's mode, and the item id from Stripe's answer for that subscription. The fresh read cross-checks customer and mode before any write (§3.2).
- The webhook side is unchanged in who the account is: the billing row by subscription, then customer (SR-8).
- No new service-role write path, no new repository method (Stripe holds the change; the webhook applies it through the existing function).

### 3.9 Entitlements registration (SR-17, `business-os-entitlements`)

| File | Imports from the module | Entry |
|---|---|---|
| `lib/business-os/billing/planUpgrade.ts` (new) | `TIER_ORDER`, `TierId` (type) | non-gate: refuses an upgrade SALE, grants or withholds no capability |
| `lib/business-os/billing/planCheckoutEligibility.ts` (existing) | symbols re-checked (`TIER_ORDER` already imported) | `why` updated for `planUpgradeOffer` |
| `app/api/business-os/billing/plan/upgrade/preview/route.ts` (new) | `resolveAccountId`, `TIER_ORDER` | non-gate |
| `app/api/business-os/billing/plan/upgrade/route.ts` (new) | `resolveAccountId`, `TIER_ORDER` | non-gate |
| `lib/business-os/billing/planPurchaseView.ts` (existing) | unchanged unless the upgrade facts need a new symbol | re-checked |
| `PlanUpgrade.tsx`, `PlanSection.tsx` | none (types from `planPurchaseTypes.ts`) | source guard |

**F-B fix** in the same PR: the import parser in `enforcementPoints.test.ts` strips an inline `type ` modifier (`import { a, type B }` → `B`), with a test. `npm run test:bos-entitlements` on each PR's final diff, result recorded.

Placement guards: `planUpgrade.ts` is added to `BILLING_REPOSITORY_IMPORTS` in `routerPlacement.guard.test.ts` and to the "only the listed files name the repository" list in `BusinessOsBillingAccountRepository.test.ts`.

### 3.10 Audit (U-9)

`BOS_BILLING_UPGRADE_REQUESTED`, registered in `lib/audit/events.ts` (comment block like the other plan events), severity `info`, `['SOC2']`, audience `'bos'` in `eventAudience.ts`, the count in `eventAudience.test.ts` bumped with a dated comment. Written by the confirm route with `logAndFlush` before the 200, once per confirmed request (whatever the outcome). Entity `business_os_billing_account`, id = the account. Details: `fromTier`, `toTier`, `lookupKey`, `prorationDate`, `outcome`, `invoiceId`, `subscriptionId`, `livemode`, `actor: 'owner'`, `correlationId`. Never the client secret, an email or a card detail. Refusals and previews are logged, not audited (SA Q-9 of P-3a).

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/stripe/StripeService.ts` | modify | Subscription read: `items`, `pendingUpdate`, `latestInvoiceId`; `previewBusinessOsPlanUpgrade`; `upgradeBusinessOsPlanSubscription` (§3.3) |
| `lib/business-os/billing/planInvoiceFacts.ts` | modify | U-3; `decidingPriceIds`; header CF-6 line |
| `lib/business-os/billing/planPaymentApply.ts` | modify | U-4; `billingReason` in the invoice-paid details |
| `lib/business-os/billing/planCheckoutEligibility.ts` | modify | `planUpgradeOffer` (§3.1) |
| `lib/business-os/billing/planUpgrade.ts` | create | `planUpgradeEligibility`, `previewPlanUpgrade`, `confirmPlanUpgrade`, `PLAN_UPGRADE_REFUSALS` (§3.2–§3.4) |
| `app/api/business-os/billing/plan/upgrade/preview/route.ts` | create | Preview route |
| `app/api/business-os/billing/plan/upgrade/route.ts` | create | Confirm route |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts` | modify | `BOS_BILLING_UPGRADE_REQUESTED` |
| `lib/business-os/billing/planPurchaseTypes.ts`, `planPurchaseView.ts` | modify | `purchase.upgrade` |
| `components/business-os/settings/PlanUpgrade.tsx` | create | The island (§3.7) |
| `components/business-os/settings/planUpgradeCopy.ts` | create | Refusal → key map, typed over every code |
| `components/business-os/settings/PlanSection.tsx` | modify | Render the island; "Upgrading…" re-read state |
| `lib/business-os/translations/en.ts`, `he.ts`, `es.ts` | modify | `plan.upgrade.*` keys (§10) |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | Registrations; F-B parser fix |
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts`, `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts` | modify | Placement and name guards |
| `lib/business-os/billing/__tests__/fixtures/stripe/captured-*.json` | add | U-7 captured payloads (§8) |
| `lib/business-os/billing/__tests__/planStripeFields.c6.test.ts` | modify | `total`, `pending_update`; captured upgrade objects in the ratchet |
| `scripts/probe-bos-upgrade-apply.sql` | create | Rolled-back apply-function probe, anchor cases (U-8) |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | § Billing: upgrade gating, CF-6, U-4 |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | P-7b.1 row, §9.4 CF-6 closed, Change History (at the end) |
| Tests | create / modify | §7 |

**Not touched:** the checkout route and `planCheckout.ts` (contract unchanged), the resolver, the subscription mirror, `PlanEmbeddedCheckout.tsx`, `StripePaymentForm.tsx` (Connect), the holding screen, any migration, any repository.

---

## 5. Gates

| # | Gate | Before |
|---|---|---|
| G-1 | SA approves this workplan, rules on the split (§11) and Q-1 to Q-9 | T1 |
| G-2 | **U-6 answered** from E-4 (§8): what Stripe does with an unpaid upgrade invoice when its pending update expires. If it can still be paid after expiry, Dev brings a design to SA before T10 (U-6) | T10 (the UI) |
| G-3 | U-7: every captured fixture in §8 present, every field the code reads present (`planStripeFields.c6.test.ts` ratchet) | SA code review of P-7b.1a |
| G-4 | `npm run test:bos-entitlements`, the affected Jest scope, `npm run lint`, `tsc --noEmit` on touched files, `npm run typecheck:bos-llm` (0 new) green on each PR's final diff | SA code review |
| G-5 | The user approves the he/es drafts (§10) | Merge of P-7b.1b |
| G-6 | Demo on the standard sandbox (§9) | Merge of P-7b.1b (P-7b.1a: E-runs + D-W rows) |
| G-7 | The probe (`scripts/probe-bos-upgrade-apply.sql`) passes on a local PGlite; optionally on production on a test account, rolled back, by the user | SA code review of P-7b.1a |

---

## 6. Task List

| # | Task | PR | Est. |
|---|---|---|---|
| ✅ T0 | Day-1 checks: branch, `origin/main` still `103dead2` or merged in; highest migration still 20261057; the P-4.2 files as described; SDK types for `invoices.createPreview` and `subscriptions.update` on the pinned version | a | 0.1d |
| ⛔ T1 | **BLOCKED (no sandbox key yet, TL 2026-10-13). Sandbox experiments E-1 to E-6 and fixture capture (§8).** Standard sandbox; key location from TL. Results and captured, scrubbed fixtures recorded in Implementation Notes. U-6 answered (G-2) | a | 0.5d |
| 🟡 T2 | **Code done, pending E-1** (Implementation Notes). `StripeService`: additive subscription fields; `previewBusinessOsPlanUpgrade`; `upgradeBusinessOsPlanSubscription` (exact params, idempotency key, facts-only return, card-error mapping); tests incl. "no metadata, no anchor, no trial_end" and "secret never in the facts' logs" | a | 0.5d |
| ✅ T3 | U-3 in `planInvoiceFacts` + `decidingPriceIds`; the U-3 matrix; C-6 field list (`total`) | a | 0.25d |
| ✅ T4 | U-4 in `planPaymentApply` (pending → retry; not on price → record without plan + alert + audit only on a new row); `billingReason` in details; tests incl. replay silence | a | 0.35d |
| ✅ T5 | `planUpgradeOffer` + `planUpgradeEligibility` (pure); tests over every rule and order | a | 0.35d |
| ✅ T6 | `planUpgrade.ts` orchestration: order contract, `prorationDate` window, price check on the target, outcome mapping, refusal table; tests with fakes | a | 0.5d |
| ✅ T7 | The two routes (`new-api-route`); `BOS_BILLING_UPGRADE_REQUESTED` registration; route tests (happy path per outcome, 401, 400 incl. extra keys, every refusal, double click, flush before 200, secret only in the body) | a | 0.4d |
| ✅ T8 | Apply-function probe `scripts/probe-bos-upgrade-apply.sql` (U-8 anchor cases), run on local PGlite | a | 0.25d |
| ⬜ T9 | `purchase.upgrade` in the view + wire type; `my-plan` tests; matrix test view ↔ preview route | b | 0.3d |
| ⬜ T10 | `PlanUpgrade.tsx` + `PlanSection` wiring + `planUpgradeCopy.ts`: preview, confirm, 3-D Secure via `handleNextAction`, outcomes, bounded re-read, success only from the server; Q-7 wording if ruled in | b | 0.6d |
| ⬜ T11 | i18n en/he/es (§10), RTL render tests; he/es drafts to the user (G-5) | b | 0.2d |
| 🟡 T12 | **a: done** (b: P-7b.1b). Registrations + F-B parser fix + placement guards + `test:bos-entitlements` (a: backend files; b: view and UI); ENTITLEMENTS doc § Billing; requirement row, CF-6 closed, Change History | a + b | 0.2d |
| 🟡 T13 | **a: done** (b: P-7b.1b). Full checks (G-4), `git diff --stat` reviewed (no deletion-only file), Implementation Notes | a + b | 0.2d |
| ⬜ T14 | Demo on the standard sandbox (§9), subscriptions cancelled the same day (TL / user, Dev assists) | b (D-W rows in a) | 0.4d |
| | **Total** | | **≈ 5.1d** |

---

## 7. Tests

| Area | File | What |
|---|---|---|
| U-3 matrix | `planInvoiceFacts.test.ts` | Paid `subscription_update`: balance-paid (`amount_paid 0`, `total > 0`) → assigns; under-minimum (`total` 30, `amount_paid 0`) → assigns; trial swap (`total 0`, no positive line) → not; downgrade credit (`total < 0`) → not; `amount_paid > 0` upgrade → assigns (unchanged); cycle invoice unchanged both ways; failed invoice never assigns; `decidingPriceIds` = the positive line's price |
| U-4 | `planPaymentApply.test.ts` (+ `.upgrade.test.ts` if large) | Pending update → `PlanPaymentRetryError`, nothing written; item on another price → `assignsPlan:false` sent, alert + audit once; same on replay (`already_recorded`) → no alert, no audit; two items → treated as not applied; a cycle invoice with a pending update is NOT affected (only `subscription_update`); `billingReason` in details |
| Offer | `planUpgradeOffer.test.ts`, `planUpgradeOffer.matrix.test.ts` | Every reason in order; no tier literal; held-shaped record (`boughtTier` null) → `not_subscribed`; view ↔ preview route agreement over every our-data combination; Stripe-side refusals listed as documented exceptions |
| Eligibility | `planUpgradeEligibility.test.ts` | Each U-2 rule: customer / mode / subscription mismatch (alert), `past_due`, `incomplete`, `trialing`, `unpaid`, `paused`, unknown, cancelling, pending update with `retryAfter`, zero / two items, item on a retired `basic` key (accepted, CF-1), item on `pro` already, target equal or lower |
| Orchestration | `planUpgrade.test.ts` | Order: zero Stripe calls on every our-data refusal (log-order pin as P-4.1); `prorationDate` future / stale / before period start → `preview_expired` with no Stripe call; price check on the TARGET; outcome mapping (paid → upgraded; requires_action → secret; requires_payment_method → declined; card error thrown → declined; processing → Q-4); idempotency conflict → `upgrade_busy`; Stripe read failure → `stripe_error`; the same key for the same request |
| Stripe methods | `lib/stripe/__tests__/businessOsPlanUpgrade.test.ts` | Exact params (the `subscriptions.update` call object asserted whole: no `metadata`, `billing_cycle_anchor`, `trial_end`); `idempotencyKey`; preview params; facts-only returns; additive subscription fields incl. undeduplicated items |
| Routes | `app/api/business-os/billing/plan/upgrade/**/__tests__/route.test.ts` | 404 with the switch off and nothing read; 401; 400 (bad tier, extra key such as `userId` / `subscriptionId` / `priceId`, non-integer date); happy path per outcome; every refusal code → status + English; audit once per confirm, flushed before the 200; no audit on preview or refusal; client secret only in the body (spies on logger and audit); the subscription id passed to Stripe is the row's, whatever the body says |
| Apply function | `scripts/probe-bos-upgrade-apply.sql` (PGlite) | (1) `basic` paid → upgrade invoice paid: tier `pro`, `tier_expires_at` and `period_anchor` unchanged, `bought_tier` `pro`, no first-payment stamp; (2) the upgrade invoice applied **before** the first `basic` invoice, then that invoice: ends on `pro`, anchor = Stripe's `billing_cycle_anchor` (C-6), the late `basic` not newest so no plan write; (3) replay of either → nothing; (4) `p_assigns_plan = false` upgrade (U-4) → recorded, plan untouched |
| C-6 / U-7 | `planStripeFields.c6.test.ts` | Captured upgrade payloads carry every field read (incl. `total`, `billing_reason`, `pending_update`, `lines[].pricing.price_details.price`) |
| View | `planPurchaseView.test.ts`, `my-plan` route test | `upgrade` present for an active `basic` record with both switches on and `pro` buyable; absent for every other reason; still no input, no Stripe import |
| UI | `PlanUpgrade.render.test.tsx` | Button only when listed; preview amounts with "excluding tax" and the zero-due line; Confirm disabled while in flight (double click → one POST); upgraded → "Upgrading…" then success only after a re-read with the target tier + renewing; failed re-read never success; action_required → `handleNextAction` called with the secret, success → re-read, error → "not confirmed" line; declined line; each refusal localised by code (never server English); `upgrade_pending` shows the time; no key → no confirm POST; Hebrew `dir="rtl"`; source guards (no entitlements import, no server code, no `console.*`, secret not written to URL / storage) |
| Invariants | `npm run test:bos-entitlements` | Registrations, F-B parser test, no tier literal |

**Required scenarios from the brief, mapped:** anchor tests (probe 1, 2); replay (U-4 replay silence, probe 3); $0 credit balance (U-3, D4, E-3); under $0.50 (U-3, E-5); declined (orchestration, D2, E-2); 3-D Secure confirmed / abandoned (UI, D3a/D3b, E-1); pending-update expiry (E-4, U-4 branch 1, G-2); double click (orchestration, route, UI, D5).

---

## 8. Sandbox Experiments and Fixtures (U-6, U-7)

All on the **standard Stripe test account** `acct_1UPKR4C7KDUGYIcA` (user decision 2026-10-12). Its webhook does not forward to production. **TL supplies where its key file lives; Dev does not search for keys and never writes one into a file, a log or this document.** Stripe CLI 1.53 syntax for `stripe listen` (the F-6 docs fix). Events are captured as delivered (this sandbox renders `2026-09-30.endive`, §9.1.2 F-4); responses to our own SDK calls render in the pinned `2025-10-29.clover`. Each fixture keeps its real `api_version` and a `_fixture_source` line, and is scrubbed exactly as the P-3b C-6 capture was (email, name, address, hosted URLs, the `bos_user_id` value). Experiments run through the CLI on sandbox customers created for them (a test clock where time must pass), never on a real account's data.

| # | Experiment | Records | Captures (U-7) |
|---|---|---|---|
| E-1 | Customer + `basic` subscription paid with `4242`; card swapped to an "always authenticate" card; `subscriptions.update` with the §3.3 params; then confirm the PaymentIntent in the dashboard; repeat and abandon | Where the payment state is read on clover (expanded invoice `payments` vs one `invoicePayments.list`); `latest_invoice.confirmation_secret` present; `createPreview` field names; the update's response with a `pending_update` | Subscription with `pending_update`; paid `subscription_update` invoice (negative `basic` and positive `pro` lines, both via `pricing.price_details.price`) |
| E-2 | Same with `4000000000000341` set as the subscription's default payment method | Does the update **return** with a pending update and an open invoice, or **throw** a card error? Which events arrive (`invoice.payment_failed`)? | Failed `subscription_update` invoice |
| E-3 | Customer credit balance covering the proration (`stripe customers update cus_… --balance=-20000`) | `amount_paid 0`, `total > 0`, status `paid`, no pending update | $0 credit-balance upgrade invoice |
| E-4 | **U-6.** Test-clock customer; upgrade left in `requires_action`; advance the clock past `pending_update.expires_at` | Is the invoice **voided**? Are automatic retries made on it? `customer.subscription.pending_update_expired` delivered? Can `stripe invoices pay` still pay it after expiry? Stripe's docs say the invoice is voided and the update discarded at expiry (expiry = the earlier of 23 h and the period end) — **this experiment is the proof SA asked for** | Expired-update event, the voided invoice |
| E-5 | Test-clock customer, clock advanced to ~2 h before the period end, then upgrade | Amount under $0.50: marked paid, carried to the balance? `total` and `amount_paid` | Under-minimum upgrade invoice |
| E-6 | Same request twice with the same idempotency key, once in flight | Replayed response; in-flight conflict error type | — |

**Decision rule (U-6, G-2):** if E-4 shows the unpaid invoice is voided at expiry and cannot be paid afterwards, U-4 stays a backstop and the UI proceeds as §3.7. If it can still be paid after expiry, Dev stops and brings a design to SA (for example, voiding our own open upgrade invoice when the owner abandons) before T10.

**After the experiments:** every sandbox subscription created for them is cancelled the same day, and the ids are listed in Implementation Notes.

---

## 9. Demo Plan

On the standard sandbox `acct_1UPKR4C7KDUGYIcA`; no production endpoint pause. **Setup (local only, never committed):** the sandbox keys in `.env.local` (location from TL); both payment switches on; `availableToBuy` already on for both tiers in the committed config; `stripe listen` running; `npm run check-bos-plan-prices` passes against the sandbox. A designated test owner on a non-champion account.

| # | Step | Expected |
|---|---|---|
| D0 | The test owner buys Essentials in Settings → Plan with `4242` (P-4.2 flow) | "You're on Essentials", "Renews on <date>". TL reads `tier_expires_at`, `period_anchor` on the plan row (read-only SQL) |
| D1 | Settings → Plan | "Upgrade to Autopilot" beside the Autopilot block; no Choose list |
| D1a | Press Upgrade | The preview: "$NN.NN due now, excluding tax", "renews on <same date> at $129 a month" |
| D1b | Confirm | "Upgrading…", then "You're on Autopilot." The amount charged in the sandbox equals the preview. Tiers page `pro`; `tier_expires_at` and `period_anchor` **unchanged**; money history has the `subscription_update` row; audit `BOS_BILLING_UPGRADE_REQUESTED` and `BOS_BILLING_INVOICE_PAID` with `billingReason` |
| D2 | Second owner on Essentials; in the sandbox, attach `4000000000000341` and make it the **subscription's** default payment method (Checkout set the subscription default, so the customer default alone is not enough); Upgrade → Confirm | "Your card was declined, so nothing changed. You're still on Essentials." Plan row `basic`; one failed history row; no banner (U-10). A second press → `upgrade_pending` with the time it can be retried (SA adjusted item) |
| D3a | Third owner; card swapped to an always-authenticate card (`4000002760003184`); Upgrade → Confirm → complete the challenge | The 3-D Secure modal in place, then "Upgrading…" → Autopilot |
| D3b | Same, but close the challenge | "The payment was not confirmed, so nothing changed." Still Essentials. Press Upgrade again → the challenge is offered again (Q-2 resume: preview answers `upgrade_awaiting_confirmation`, Confirm returns the same confirmation, no new update) |
| D3c | `4000002500003155` on a fourth owner | Observe whether a challenge is asked (this card asks only when not set up for future use; Checkout sets cards up, so it may not). Recorded either way |
| D4 | CF-6: give an Essentials owner a sandbox credit balance that covers the proration; Upgrade | Preview "Nothing to pay now"; confirm → Autopilot (`amount_paid = 0` applied) |
| D5 | Double click Confirm; then two tabs confirming together | One charge; the second answer is the same outcome or `upgrade_busy` / `not_an_upgrade` |
| D6 | Leave a preview open 16 minutes, then Confirm | `preview_expired`, localised; a fresh preview works |
| D7 | Switch the UI to Hebrew, then Spanish | Every new string translated; Hebrew right to left |
| D-W | (P-7b.1a, no UI) the webhook rows from E-1 to E-5 replayed through local `stripe listen` | U-3 applies the $0 and under-minimum invoices; U-4 retries while pending; a forced "paid but not applied" case alerts once |

**After the demo:** every demo subscription is cancelled in the sandbox **the same day** (N-4); local flips reverted (`git diff` shows nothing in `tierMatrix.ts` or env files).

---

## 10. i18n and RTL

New keys in `lib/business-os/translations/{en,he,es}.ts` (English final for SA; **he/es are drafts for the user's approval**, G-5):

| Key | English |
|---|---|
| `plan.upgrade.button` | Upgrade to {plan} |
| `plan.upgrade.previewing` | Working out the price… |
| `plan.upgrade.due_now` | {amount} due now, excluding tax. |
| `plan.upgrade.due_now_zero` | Nothing to pay now: your account credit covers it. |
| `plan.upgrade.then` | Your plan renews on {date} at {price} a month. |
| `plan.upgrade.immediate` | You move to {plan} as soon as the payment goes through. |
| `plan.upgrade.confirm` | Confirm upgrade |
| `plan.upgrade.cancel` | Not now |
| `plan.upgrade.upgrading` | Upgrading… |
| `plan.upgrade.done` | You're on {plan}. |
| `plan.upgrade.declined` | Your card was declined, so nothing changed. You're still on {plan}. |
| `plan.upgrade.not_confirmed` | The payment was not confirmed, so nothing changed. You're still on {plan}. |
| `plan.upgrade.refusal.pending` | An upgrade is already waiting for payment. You can try again after {time}. |
| `plan.upgrade.refusal.cancelling` | Your plan is set to end, so it cannot be upgraded. |
| `plan.upgrade.refusal.not_active` | Your subscription is not active right now, so it cannot be upgraded. |
| `plan.upgrade.refusal.preview_expired` | The price needs checking again. Please press Upgrade once more. |
| `plan.upgrade.refusal.busy` | Your upgrade is already being processed. Please wait a moment. |
| `plan.upgrade.refusal.unavailable` | Upgrading is not available right now. Please try again later. |
| `plan.upgrade.refusal.support` | We could not upgrade your plan. Please contact support. |
| `plan.upgrade.refusal.generic` | Something went wrong. Please try again. |
| `plan.upgrade.awaiting_confirmation` | Your upgrade is waiting for you to confirm the payment. |
| `plan.upgrade.own_plan_note` | You have {plan} by arrangement with us. Upgrading makes it your paid plan from today. |
| `plan.upgrade.not_sure` | We could not confirm your upgrade. |
| `plan.upgrade.retry_after` | You can try again after {time}. |

Plus the Q-7 keys (ruled in for P-7b.1b): `plan.choose.button_own` "Pay for {plan}" and `plan.choose.own_plan_note` "You are on {plan} by arrangement with us. Paying starts a monthly subscription that replaces that arrangement."

Prices stay in digits and USD (SR-15). Dates and times go through `PlanSection`'s existing account-clock rendering (`useLanguage().timezone`, QA P-4.2 note 3). The island inherits `dir` from `PlanSection`.

**Stripe's own language.** This slice opens no Stripe Checkout frame. The only Stripe UI is the 3-D Secure challenge, which is the card issuer's page. Stripe Checkout has no Hebrew, so QA P-4.2 note 2 stays a business decision on the **buy** path; Dev recommends it is not folded in here (Q-8).

---

## 11. Sizing and Split

**≈ 5.1 dev-days** against SA's ~3d. The difference is the U-6/U-7 sandbox work (0.5d, required before the UI), the three-layer test matrix (pure, orchestration, route) for a money write, the PGlite probe, and the 3-D Secure UI path.

**Proposed split, two PRs, never stacked (SA decides):**

| PR | Title | Tasks | Est. | State after merge |
|---|---|---|---|---|
| **P-7b.1a** | **Upgrade backend and CF-6** | T0–T8, Q-2 resume (server half), T12 and T13 for its files, D-W | ≈ 3.6d (SA) | Inert in production (switches off). Locally the routes work by direct POST; the webhook applies upgrade invoices correctly, including CF-6 and U-4. No screen change |
| **P-7b.1b** | **Upgrade in Settings** | T9–T11, Q-2/Q-5/Q-7 screen work, T12 and T13 for its files, T14 | ≈ 1.9d (SA) | Inert in production. Locally the Upgrade button appears for a paying `basic` owner |

P-7b.1a stands alone: CF-6 and U-4 make the webhook correct for any upgrade, including one made in the Stripe dashboard, and the routes can be demoed by direct POST. P-7b.1b branches from `origin/main` after P-7b.1a merges.

**Alternative split** (if SA prefers the webhook fixes isolated): P-7b.1a = T1, T3, T4, T8 (≈ 1.4d, webhook only); P-7b.1b = everything else (≈ 3.7d). Dev prefers the first split: it keeps each PR near SA's size and puts the routes with the Stripe methods they call.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The screen offers an upgrade the server refuses | One predicate (`planUpgradeOffer`) behind view and routes; matrix test through the view's own reads; Stripe-side refusals listed as documented exceptions with their own lines |
| R-2 | A second charge from a double click or two tabs | Disabled button; same idempotency key for the same request; fresh read refuses `upgrade_pending` / `not_an_upgrade` once one went through |
| R-3 | A paid upgrade not applied at Stripe writes `pro` | U-4: pending → retry; not on price → recorded without the plan, alerted once |
| R-4 | CF-6 widens `assignsPlan` too far | Narrow rule (`subscription_update` AND `total > 0` AND a positive plan line); matrix includes trial swap and downgrade credit; the apply function still writes only when newest |
| R-5 | The credit period restarts | No SQL change; probe pins anchor and paid-through unchanged, including webhook lag (C-6 case) |
| R-6 | The client secret leaks | Facts-only Stripe return; never logged or audited; spy tests over every logger/audit call; component memory only |
| R-7 | An abandoned 3-D Secure blocks a retry for up to 23 h | `upgrade_pending` tells the owner when; Q-2 proposes resuming the same confirmation instead |
| R-8 | A declined owner cannot fix their card in the app until P-7a | Copy says nothing changed; Q-6 asks what to point them to meanwhile |
| R-9 | P-6a later shows "payment failed" for a declined upgrade | U-10 recorded on the P-6a row (§14) |
| R-10 | `createPreview` / payment-state field names differ on the pinned version | E-1 settles them before T2 is finished; captured fixtures pin them |
| R-11 | Preview amount differs from the charge | Same `proration_date` and prices; only a credit-balance change in between can differ, and the preview shows "due now" after the balance |
| R-12 | Over-estimate creep | Split (§11); each PR near 2–3 days |

---

## 13. Rollout, Rollback and Migration Check

- **Rollout:** merge is inert. The routes need both env switches (§9.5 rows 15 and the price switch at row 7) and the target's `availableToBuy` (row 16, already on for testing, to be confirmed per plan before live money). P-7b.1 goes live with the Buy button (SA R-5). No new switch.
- **Rollback:** revert the PR(s). No migration and no data written by P-7b.1 itself: an upgrade made under it is an ordinary Stripe price change whose invoice the existing P-3b webhook path records.
- **Migration check:** none needed (SA R-2). Highest on `origin/main` `103dead2` is **20261057** (`20261057_rls_disabled_tables_slice2b_token_usage.sql`), confirmed with `git ls-tree origin/main supabase/migrations/` on 2026-10-13. If one ever proves necessary, it takes the next free number at Dev time and comes back to SA.

---

## 14. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | `prorationDate` window on confirm | Not in the future (60 s skew), not older than 15 min, not before the current period start; else `preview_expired` |
| Q-2 | Retry after an abandoned 3-D Secure: refuse `upgrade_pending` until expiry (U-2 as written), or **resume** — when the pending update is ours, for the same target, and its invoice's payment `requires_action`, return `action_required` with the same confirmation again, with no new update? | Resume, in the confirm route only; every other pending case stays `upgrade_pending` |
| Q-3 | Audit for U-4 case 2 ("paid but not applied") | The existing `BOS_BILLING_INVOICE_PAID` entry with `upgradeNotApplied: true`, severity `warning`; no new event |
| Q-4 | Payment state `processing` after the update (rare for cards) | Treat as `upgraded` for the screen ("Upgrading…" + re-read); success still only from the server |
| Q-5 | An admin-assigned `pro` on an account that pays for `basic` (F4): offer Upgrade? | Follow U-2 (our record decides): offered. The screen says "Upgrade to Autopilot" though the plan row already shows Autopilot; rare, and F4 row 3 already warns the admin |
| Q-6 | What a declined owner is pointed to before P-7a (no card update in the app) | "Nothing changed" line only, no link; P-7a adds the portal button |
| Q-7 | SA's P-4.2 Low note: an admin-assigned paid plan with no billing record sees "Choose Essentials" while on Essentials | In scope, ~0.1d: label "Pay for {plan}" plus a one-line note for the row equal to the current plan (keys in §10); wording to the user with the he/es drafts |
| Q-8 | Stripe Checkout language (QA P-4.2 note 2) | Not in P-7b.1 (no Checkout frame here). Its own small follow-up, with a business decision for Hebrew (no Checkout support) |
| Q-9 | The split (§11) | Two PRs, P-7b.1a then P-7b.1b |

**Forward condition carried (U-10, for the P-6a workplan):** the failed-payment and "confirm your payment" banners and the attempt count key on renewal failures (`subscription_cycle`, or the subscription's status), never on a failed or abandoned `subscription_update` invoice.

---

## SA Review Notes

**Reviewed by SA — 2026-10-13**
**Status:** ✅ **APPROVED WITH CONDITIONS** (V-1 to V-12 below). Two PRs, not stacked. No business question for the user.

Checked against the worktree on `feature/bos-plan-payments-p7b1` (`origin/main` `103dead2`): `planInvoiceFacts.ts` (`assignsPlan` at line 197 is exactly as described, CF-6 still open in the header), `planPaymentApply.ts` (step 9 fresh read at line 350, `afterApply` outcomes `applied` / `recorded` / `already_*`, `recordPlanChange` with a `severity` argument), `StripeService.retrieveBusinessOsSubscription` (deduplicated `priceIds`, paged items, pinned `2025-10-29.clover`), `planCheckoutEligibility.ts` (`TIER_ORDER`, `TierId`, `buyableTiers()`), `planPurchaseView.ts`, the checkout route (`getUser()`, strict Zod, `logAndFlush`, 404 first), the `new-api-route` and `tenant-isolation-guard` skills, and the installed `stripe` types (`invoices.createPreview`, `Invoice.confirmation_secret`, `Invoice.payments` includable, `Invoice.total`, `Subscription.pending_update`; **`current_period_start` is on the subscription ITEM on this version, not the subscription**). Prior probes (`scripts/probe-bos-apply-plan-payment.sql`) were run on a scratchpad PGlite, so G-7 has a precedent.

### U-1 to U-10 coverage

| Condition | Task | Test | Verdict |
|---|---|---|---|
| U-1 Stripe call | T2, T6 | Stripe-method test asserts the whole `subscriptions.update` object and the key | ✅ params exact: one item `{ id, price }`, `always_invoice`, `pending_if_incomplete`, the preview's `proration_date`, key `bos-upgrade:<sub>:<price>:<date>`, no anchor / trial_end / metadata, price check on the target, no price created |
| U-2 Who may upgrade | T5, T6 | Offer, eligibility, orchestration (zero Stripe calls on our-data refusals) | ✅ with V-2 (webhook-lag case must not alert) |
| U-3 CF-6 | T3 | U-3 matrix | ✅ with V-6 (pin every existing invoice kind) |
| U-4 Fresh-read guard | T4 | U-4 tests incl. replay silence | ✅ with V-5 (retry only when the pending update is THIS invoice's) |
| U-5 In-session result | T6, T7, T10 | Orchestration, route, UI | ✅ with V-3 (an unknown result after the write is never "nothing changed"), V-4 (`processing`) |
| U-6 Expiry behaviour | T1 (E-4), G-2 | — | ✅ gate holds the UI. Do not take Stripe's docs as the answer; E-4 is |
| U-7 Fixtures | T1, G-3 | C-6 ratchet | ✅ |
| U-8 Tests | T3–T8 | §7 | ✅ with V-6 |
| U-9 Audit and standards | T7, T11, T12 | Route (flush before 200), registrations | ✅ |
| U-10 Forward on P-6a | §3.5, §14 | — | ✅ recorded; stays on the requirement's P-6a row |

### Rulings on Q-1 to Q-9

| # | Ruling |
|---|---|
| Q-1 | **Accepted:** not in the future (60 s skew), not older than 15 minutes, not before the current period start. On `2025-10-29.clover` the period start is read from the subscription **item** (`items[].current_period_start`), so the window's third test runs after the fresh read (step 7), not at step 6; step 6 checks only the clock window. A preview taken just before a renewal and confirmed after it is therefore `preview_expired` |
| Q-2 | **Resume, ruled in** (technical, no trade-off for the user to weigh: the same invoice is paid, so no second charge is possible, and the alternative is a 23-hour lock for a step the owner merely closed). Scope: when the fresh read shows a `pending_update` whose item price is the target's, and the subscription's `latest_invoice` is an open `subscription_update` invoice of this subscription whose payment is `requires_action`, the **confirm** route returns `action_required` with that invoice's confirmation secret (one invoice read in `StripeService`, facts-only return, no new update). The **preview** route, in the same case, answers `409 upgrade_awaiting_confirmation` with the pending invoice's `amountDueMinor` and a fresh `prorationDate` (never a secret), so the screen shows "Your upgrade is waiting for you to confirm the payment" with a Confirm button that posts the normal confirm body. Every other pending case (declined, `requires_payment_method`, a different target, an invoice we cannot identify) stays `upgrade_pending` with `retryAfter`. Audit: `BOS_BILLING_UPGRADE_REQUESTED` with `outcome: 'action_required'`, `resumed: true`. About +0.3d in P-7b.1a (orchestration + one Stripe read) and P-7b.1b (one state). Requirement R-2 demo (5) amended accordingly (Change History) |
| Q-3 | **Accepted:** the existing `BOS_BILLING_INVOICE_PAID` through `recordPlanChange`, `upgradeNotApplied: true`, severity `warning`, only on a new `recorded` row; the `error` log with `alert: true` is the alert. No new event |
| Q-4 | **Accepted with a change:** the wire answers its own outcome `processing` (not `upgraded`), and the audit records `processing`. The screen treats it exactly as `upgraded` ("Upgrading…" + bounded re-read; success only from the server). An honest record costs one enum value |
| Q-5 | **Offered** (U-2: our billing record decides, and the one-predicate rule forbids a screen-only exception). When the plan in force already equals the target, P-7b.1b shows one note above the button: "You have {plan} by arrangement with us. Upgrading makes it your paid plan from today." (`plan.upgrade.own_plan_note`, with the he/es drafts, G-5). No server change |
| Q-6 | **Accepted:** the "nothing changed" line, no link. If E-2 shows the declined update stays pending, the `declined` answer carries `retryAfter` and the line adds "You can try again after {time}." (so the next press's `upgrade_pending` is not a surprise). **Forward to P-7a:** when card update lands, a declined pending upgrade is paid with the new card (the portal or a resume with `requires_payment_method`), recorded on the P-7a row |
| Q-7 | **In scope, P-7b.1b** (~0.1d; `PlanSection` is touched anyway): "Pay for {plan}" plus the one-line note, label only, no server change. Wording goes to the user with the he/es drafts (G-5) |
| Q-8 | **Out.** No Checkout frame here. Stays its own follow-up with its business decision |
| Q-9 | **First split approved** (below) |

### Split

**P-7b.1a "Upgrade backend and CF-6"** = T0–T8 + Q-2 resume (server half) + T12/T13 for its files + D-W rows; **P-7b.1b "Upgrade in Settings"** = T9–T11 + Q-2/Q-5/Q-7 screen work + T12/T13 for its files + T14. Not stacked: P-7b.1b branches from `origin/main` after P-7b.1a merges. The alternative (webhook only first) is declined: it would merge routes and Stripe methods without the guard they rely on being reviewed in the same diff. New total ≈ 5.5d (a ≈ 3.6d, b ≈ 1.9d); accepted over my ~3d for the reasons in §11.

### Design points

| Point | Ruling |
|---|---|
| `items` not de-duplicated | **Accepted.** `priceIds` stays deduplicated for its existing callers; `items` is the complete list from the same paged read (fails closed exactly as today). "Exactly one" is decided on `items.length` |
| Payment state on clover left to E-1 | **Accepted**, but settled before T2 is marked done, recorded in Implementation Notes, and pinned by a captured fixture. Whichever read is chosen stays inside `StripeService` |
| Decline shape left to E-2 | **Accepted**, with V-7: both shapes are mapped and tested whatever E-2 shows |
| `planUpgradeOffer` placement | In `planCheckoutEligibility.ts`, beside its twins and `buyableTiers()`. `planUpgradeEligibility` and the orchestration in `planUpgrade.ts` |
| Probe file | A new `scripts/probe-bos-upgrade-apply.sql` (the prod-proven probes stay untouched), same shape: `DO` block, rolled back, refuses a live-mode row, nothing left behind |

### Conditions (binding)

1. **V-1 Secret.** The confirmation secret appears only in the confirm route's 200 body (and an idempotent replay of it) for the session's own account; never in a log, audit, error, URL or storage. The spy test covers both the fresh confirm and the Q-2 resume path. — High
2. **V-2 Webhook lag is not a mismatch.** After a successful upgrade our record says `basic` until the webhook lands, so a second tab or a reload offers Upgrade again. If the fresh read shows no pending update and the single item on a tier **above** `boughtTier`, refuse `upgrade_processing` (409, `warn`, no alert); the screen goes to "Upgrading…" and the re-read. `billing_record_mismatch` with `alert: true` is kept for a different customer / mode / subscription, an item count other than one, or an item on a tier below `boughtTier` or not in the catalog. §3.4's "refused `not_an_upgrade`" sentence is corrected to this. Tests in eligibility and route. — High
3. **V-3 Unknown result after the write.** A Stripe failure on the `subscriptions.update` call itself (timeout, 5xx, connection) is `stripe_error` (502) logged `error` with `alert: true`, audited with `outcome: 'unknown'`, and the screen never says "nothing changed": it shows "We could not confirm your upgrade" with **Check again** (re-read my-plan) and **Try again**, which re-posts the **same** `prorationDate` so the idempotency key replays rather than charges twice. — High
4. **V-4 `processing`** is its own wire and audit outcome (Q-4). — Low
5. **V-5 U-4 retry scope.** Throw `PlanPaymentRetryError('upgrade_pending_at_stripe')` only when the pending update belongs to this invoice (`latestInvoiceId === facts.invoiceId`). A paid `subscription_update` invoice while a pending update exists for a **different** invoice goes on to the item-price test (cases 2 / 3), so a replay of an old upgrade invoice is not held in retry for up to 23 hours. Test both. — Medium
6. **V-6 Every existing invoice kind pinned.** The U-3 matrix also asserts `assignsPlan` unchanged for `subscription_create` paid > 0, the $0 trial `subscription_create`, `subscription_cycle` (discounted and not), and `manual`; U-4 tests assert a cycle and a create invoice take no U-4 branch even with a pending update. Probe case (2) records what the first-payment stamp does when a (dashboard-made) upgrade invoice is applied before the first `basic` one: expected, the upgrade row stamps it, since our route cannot produce that order (U-2 needs `bought_tier`). Accepted as is; recorded, not fixed. — Medium
7. **V-7 Decline both ways.** Orchestration maps a thrown `StripeCardError` and a returned pending update with `requires_payment_method` both to `declined`, each tested, whatever E-2 shows; an idempotency `idempotency_key_in_use` maps to `upgrade_busy`, any other idempotency error to `stripe_error` + alert. — Medium
8. **V-8 Q-1 window** as ruled: clock checks at step 6 (no Stripe call), the period-start test after the fresh read, from the item. — Medium
9. **V-9 Order contract** as P-4.1's amended C-4: every DB read and every our-data refusal before any Stripe call; pinned by the log-order test for preview and confirm. The Q-2 invoice read happens only after the fresh subscription read shows a pending update. — Medium
10. **V-10 Entitlements.** Register `planUpgrade.ts` (`TIER_ORDER`, `TierId`), both routes (`resolveAccountId`, `TIER_ORDER`), re-check `planCheckoutEligibility.ts` and `planPurchaseView.ts`; F-B parser fix with its own test; `npm run test:bos-entitlements` on each PR's final diff, result in Implementation Notes. Walk the `business-os-entitlements` review checklist at code review. — Medium
11. **V-11 Routes** per `new-api-route`: `getUser()` (the skill's and the checkout route's auth; no `requireUser` helper exists), 404 first with nothing read, strict Zod, Pino child with `correlationId`, CLAUDE.md error format, `logAndFlush` before the confirm's 200 for every outcome, no audit on preview or refusals. — Medium
12. **V-12 Tax wording, forward.** Today no tax is collected, so "excluding tax" is true. The preview also returns `taxMinor` from Stripe's answer; at §9.5 rows 5 / 7 (tax set) the upgrade wording is re-checked. Recorded on the §9.5 row by Dev in T12. — Low

### Adjusted items (marked by SA)

- §3.2 table: add the V-2 row (`upgrade_processing`); narrow `billing_record_mismatch` as V-2.
- §3.4: `processing` outcome (V-4), `upgrade_awaiting_confirmation` and `upgrade_processing` codes, V-3 copy; the "after the first has finished" paragraph per V-2.
- §3.5 U-4 branch 1 per V-5.
- §10: keys `plan.upgrade.awaiting_confirmation`, `plan.upgrade.own_plan_note`, `plan.upgrade.not_sure` ("We could not confirm your upgrade."), `plan.upgrade.retry_after` ("You can try again after {time}."), plus the Q-7 keys.
- §9 demo: D3b becomes "close the challenge → not confirmed; press Upgrade again → the challenge is offered again (resume)"; D2 adds a second press → `upgrade_pending` with the time.
- §11: a ≈ 3.6d, b ≈ 1.9d.

### Approval

[x] Workplan approved — proceed to T0/T1 under V-1 to V-12. G-2 still holds T10 until E-4 answers U-6; if the unpaid invoice can be paid after expiry, Dev stops and brings a design to SA. Dev applies the "Adjusted items" in this workplan before T2.

---

### SA Code Review — P-7b.1a (2026-10-13)

**Code Review by SA — 2026-10-13**
**Status:** 🔄 **APPROVED WITH FIXES** — F-1 (High) and F-2 (Medium) must be applied by Dev and re-checked by SA (a diff look, not a new review) before QA starts; F-3 to F-5 in the same pass. No business question for the user.

Reviewed in the worktree `neuronforge-invite-s1` on `feature/bos-plan-payments-p7b1` (`origin/main` `103dead2`), uncommitted: the 19 modified files and every new file (`planUpgrade.ts`, both routes, the four new test files, the route test, the probe). Read against V-1 to V-12, U-1 to U-10, the `new-api-route`, `tenant-isolation-guard` and `business-os-entitlements` skills, and the installed `stripe` 19.2.1 SDK (`Error.js`, `RequestSender.js`).

#### Checks run by SA

| Check | Result |
|---|---|
| Jest: `lib/business-os/billing`, `app/api/business-os/billing`, `app/api/stripe`, `lib/stripe`, `lib/business-os/entitlements`, `lib/repositories/__tests__`, `lib/audit` | **204 suites, 5,237 tests, green** (matches Dev) |
| `npm run test:bos-entitlements` | **248 suites, 7,297 tests, green** (matches Dev) |
| Mutations (each restored by re-editing; md5 of `planInvoiceFacts.ts` `f0b9a36d…`, `planPaymentApply.ts` `57cd7f21…`, `planUpgrade.ts` `8d7a66e3…` identical before and after) | **9 of 10 caught.** M1 CF-6 without `total > 0` (downgrade row fails); M2 U-4 judging every invoice kind (19 fail, V-6 pins hold); M3 the thrown card error logged (V-1 spies, 2 fail); M4 the 15-minute window disabled (2 fail); M5 / M5b the resume without the `open` status test (caught); M7 `none` mapped to `declined` (V-3 caught); M9 resume without the customer cross-check (caught); M10 eligibility without the mode cross-check (caught). **Survived: M8**, the resume invoice's `livemode` cross-check removed (F-4) |
| Probe paste rules (`scripts/probe-bos-upgrade-apply.sql`) | ✅ no `--` comment, no block comment, no punctuation inside any string literal, the word appears only as the `INSERT INTO` keyword and in no string; `DO` block, refuses the placeholder, a read-only session, an unknown user, no plan row and any live-mode billing row; ends in the expected `RAISE EXCEPTION` that rolls everything back |

#### Conditions verified in code

| # | Verdict | Where |
|---|---|---|
| U-1 / V-1 Stripe params and key | ✅ | `StripeService.upgradeBusinessOsPlanSubscription`: one item `{ id, price }`, `always_invoice`, the preview's `proration_date`, `pending_if_incomplete`, `expand: ['latest_invoice.confirmation_secret']`, key `bos-upgrade:<sub>:<price>:<date>`; the Stripe test asserts the whole call with `toEqual` and the absence of `metadata`, `billing_cycle_anchor`, `trial_end`, `price_data`. Preview params asserted the same way |
| V-1 Secret | ✅ (subject to F-1 not changing it) | Only in the confirm's 200 body (`action_required`, fresh and Q-2 resume). Never logged by `StripeService`, never in a refusal context, never in the audit facts; Stripe errors reduced by `safeErr` to name / type / code / status / request id. Spies in `planUpgrade.test.ts` and `route.test.ts` cover the fresh confirm, the resume and a thrown card error that carries the secret. The route's 500 catch logs `{ err }`, but every Stripe call in the orchestration is caught first, so no Stripe error can reach it |
| V-2 Webhook lag | ✅ | `planUpgradeEligibility`: item above `boughtTier` → `upgrade_processing`, warn, no alert; mismatch narrowed as ruled |
| V-3 Unknown result | ✅ for the write itself; **❌ for the read that follows it → F-1** | |
| V-4 `processing` | ✅ | own wire and audit outcome |
| V-5 Retry scope | ✅ | `upgradeGuard`: `retry` only when `latestInvoiceId === facts.invoiceId`; both cases tested (Dev mutation) |
| V-6 Every kind pinned | ✅ | U-3 matrix + `V-6:` rows (create > 0, $0 trial create, cycle discounted / not, manual, $0 manual and create with `total > 0`); U-4 test: a cycle and a create invoice take no branch with a pending update for them (M2) |
| V-7 Decline both ways | ✅ thrown and returned shapes; idempotency mapping **→ F-2** | |
| V-8 Window | ✅ | clock at step 6, before any Stripe call; period start from the ITEM after the fresh read; an item with no period start fails closed |
| V-9 Order | ✅ | one ordered log in both test files; our-data refusals make zero Stripe calls; the Q-2 invoice read only after a pending update is seen |
| V-10 Entitlements | ✅ | `planUpgrade.ts` (`TIER_ORDER`, `TierId`), both routes (`TIER_ORDER`, `resolveAccountId`) registered as non-gates with honest `why`; `planCheckoutEligibility.ts` re-checked (no new symbol; `planUpgradeOffer` reads only config already registered); F-B parser fix strips an inline `type ` modifier, keeps `typeOfThing`, with its own test; four entries renamed `type X` → `X`, one stale comment removed. Review checklist walked: no `check()` / `decide()`, no resolver import, refuses a SALE only |
| V-11 Routes | ✅ | `isPlanCheckoutEnabled()` → 404 before session, body, DB or Stripe; `getUser()` → 401; `request.json()` failure → 400; strict Zod (`.strict()`, `z.enum(TIER_ORDER)`, `int().positive()`); `logger.child({ correlationId })`; CLAUDE.md error format with dev-only `details`; `logAndFlush` before every confirm 200 and before the V-3 502; no audit on the preview or on any refusal except the V-3 unknown (which V-3 requires) |
| V-12 Tax | ✅ | `taxMinor` from `total_taxes`, unreadable → throw (no quote); §9.5 row 5 updated |
| U-3 CF-6 | ✅ | narrow: `subscription_update`, `kind === 'paid'`, `total > 0`, a positive PLAN line. First-payment stamp unaffected (`amountMinor` is `amount_paid`) |
| U-4 guard | ✅ | money recorded with `assignsPlan` false; alert + `warning` audit only on `applied` / `recorded`, never `already_*` |
| Tenant isolation | ✅ | request carries a tier and a proration date only; subscription, customer and item ids come from `findByUser(session user, key mode)` and Stripe's answer for that subscription; customer, subscription and mode cross-checked before any write; the resume invoice cross-checked for subscription, customer, mode, reason and status. No new service-role write path, no new repository method |
| Logging | ✅ | Pino throughout; no `console.*` in any touched file |
| U-9 audit | ✅ | `BOS_BILLING_UPGRADE_REQUESTED` registered (info, SOC2, `'bos'`, counts 54 / 199 with dated comment) |

#### Code Review Comments (fixes, Dev applies)

1. **F-1 — `lib/stripe/StripeService.ts` `upgradeBusinessOsPlanSubscription` — the read AFTER the write can surface as a "nothing was attempted" error. Priority: High.** After `subscriptions.update` succeeds, the method awaits `upgradeInvoicePaymentState`, which for an `open` invoice makes one `invoicePayments.list` call (the E-1 seam; its `expand` path is exactly what E-1 has not confirmed). If that read throws, the error leaves the method and `confirmPlanUpgrade` classifies it by its class: a `StripeInvalidRequestError` or `StripeRateLimitError` lands in `NOT_EXECUTED_ERROR_TYPES` → `stripe_error`, **not audited, no `outcomeUnknown`**, logged as "refused by Stripe" — although the price swap (a pending update with an open invoice, or an applied upgrade) was made. That breaks V-3 and U-9. **Fix:** (a) read the payment state only when the update's answer holds a pending update (with no pending update the outcome is `upgraded` without it, so the read is wasted and only adds a way to fail); (b) wrap that post-write read in its own try/catch inside `StripeService` and answer `paymentState: 'none'` on any failure (→ `unknown`, audited, `outcomeUnknown: true`, alerted), logging only `{ name, type, code, statusCode, requestId }`, never the error object. **Tests:** Stripe test — update resolves with a pending update and an open invoice, `invoicePayments.list` rejects with a `StripeInvalidRequestError` → the method resolves with `paymentState: 'none'`, no throw; Stripe test — no pending update → `invoicePayments.list` never called; orchestration or route test — that answer → 502 `stripe_error`, `outcomeUnknown: true`, audited `unknown`.
2. **F-2 — `lib/business-os/billing/planUpgrade.ts` catch of the write — match the in-flight conflict by its CODE, whatever its class. Priority: Medium.** The SDK builds the error class from Stripe's `type` (`Error.js` `generateV1Error`); an in-flight `idempotency_key_in_use` is not guaranteed to arrive as `idempotency_error` (it may come as `invalid_request_error`, E-6 tells). Today such an answer would be `refused_by_stripe` → an alerted `stripe_error`, no audit, while the first request may still succeed. **Fix:** test `errorCode(err) === 'idempotency_key_in_use'` first, before the class checks → `upgrade_busy`; keep "any other `StripeIdempotencyError` → alerted `stripe_error`". Test: a `StripeInvalidRequestError` carrying that code → `upgrade_busy`, no audit. Note in the comment: the SDK retries a 409 and a 5xx itself (default `maxNetworkRetries` 2, same key), so `upgrade_busy` is rare and a lost first answer usually replays.
3. **F-3 — `planUpgrade.ts` `prepare` step 3 — deviation 7. Priority: Low.** Ruled for consistency with the checkout: prices switch off and key mode unknown, reached while the checkout switch is ON, are configuration faults → `error` with `alert: true` (the checkout logs both that way). Add them to the alerted set by reason (or log them at error directly); `purchase_switches_off` (unreachable after step 3) may stay a warn. Owner-facing code and status unchanged. Adjust the test that pins the level.
4. **F-4 — `planUpgrade.test.ts` Q-2 block — survived mutation M8. Priority: Low.** Add one case: the pending invoice in the other mode (`livemode` true against a test row) → `upgrade_pending`, no secret, no audit.
5. **F-5 — requirement §9.5 and the P-7b.1 row — record the switch gate. Priority: Low (docs).** "No new switch" means the upgrade routes go live in production the moment the buy-path switches are turned on there, UI or not. Record: neither `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` nor `BUSINESS_OS_PLAN_PRICES_ENABLED` is turned on in production while E-1, E-2, E-6 or D-W of P-7b.1 is open.

#### Rulings on deviations 1 to 13

| # | Ruling |
|---|---|
| 1 Outcome rule | **Accepted.** No pending update after a `pending_if_incomplete` update means Stripe applied it. Pinned by E-1 (a captured answer of each kind) before P-7b.1b merges |
| 2 PaymentIntent map | **Accepted.** `requires_capture` → `processing`; `requires_confirmation` / `canceled` → `none` → "could not confirm", never "nothing changed". Correctly conservative |
| 3 Error classes | **Accepted with F-1 and F-2.** Card → `declined` audited; not-executed classes → alerted `stripe_error`, not audited; everything else → unknown, audited. Sound for errors of the WRITE; F-1 keeps errors of the follow-up read out of it; F-2 makes the in-flight conflict class-independent |
| 4 No Stripe error object logged | **Accepted, and adopted as the rule for every Stripe call that can carry a PaymentIntent.** The spy test with a secret-carrying card error is the right pin |
| 5 Resume skips the price check | **Accepted.** No price is written on resume; the pending invoice's amount was fixed by an earlier, checked request; step 5 still requires the target to be on sale. Audit `lookupKey: null`, `resumed: true` is honest |
| 6 Key inside `StripeService` | **Accepted.** CF-4 style: the key cannot drift from the parameters it guards; exported for the test |
| 7 `upgrade_unavailable` level | **Changed → F-3** (alerted error, as the checkout) |
| 8 Fail-closed choices | **Accepted** (unknown `bought_tier` → `not_subscribed`; item without period start → `preview_expired`; non-USD preview → alerted `price_mismatch`; an ambiguous pending update never resumed) |
| 9 `renewsOn` from the item | **Accepted** (the period lives on the item on clover) |
| 10 `mixed_tiers` on an all-zero two-line invoice | **Accepted, out of scope, recorded.** Our routes cannot produce it (`trialing` is refused `subscription_not_active`); a dashboard-made trial swap is refused by the existing tier rule with its own refusal row, which is safe (no plan written). E-1 / U-7 captures will show Stripe's real shape; if it ever matters it is a new requirement item, not a P-7b.1 fix |
| 11 One route test file | **Accepted** |
| 12 Probe as the session role | **Accepted.** The function's privileges are unchanged and were proven by the P-3b probe (P14, P15) |
| 13 View matrix in P-7b.1b | **Accepted** (as split) |

#### Merge gates for the E-items

**P-7b.1a may merge with E-1 to E-6, U-7 and D-W still pending**, once F-1 to F-5 are in and QA passes. Reason: nothing in it is reachable in production (both routes 404 while the checkout switch is off; the webhook recognises no plan invoice while the prices switch is off, so U-3 and U-4 are inert too; the subscription read gains fields from the same call), and with F-1 every unconfirmed Stripe shape fails toward "refused before the write" or "unknown, audited, retry on the same key" — never a second charge and never "nothing changed". E-1 is therefore **not** a merge gate for P-7b.1a; T2 stays "code done, pending E-1" in Implementation Notes and the code keeps its "pending E-1" markers.

| Item | Gate |
|---|---|
| **E-1** payment state, `expand` on update, preview amount fields | **Before T10 starts** (the 3-D Secure screen depends on it) and pinned by a captured fixture **before P-7b.1b merges** |
| **E-4** expiry (U-6 / G-2) | **Before T10 starts** (unchanged). Also decides whether the Q-2 resume stays as built |
| **E-2** decline shape | **Before P-7b.1b merges** (the "try again after" line, Q-6) |
| **E-6** in-flight conflict | **Before P-7b.1b merges** (with F-2 it confirms, it no longer decides) |
| **E-3, E-5, U-7 / G-3, D-W** captures and webhook replays | **Before P-7b.1b merges** (they validate the CF-6 / U-4 code this PR merges against real objects). If any contradicts P-7b.1a, the fix is its own PR from `origin/main` before or with P-7b.1b |
| **All of the above** | **Before either buy-path switch is turned on in production** (F-5), because the upgrade routes ride those switches |

#### Optimisation Suggestions

- The route logs "Plan upgrade requested" on entry and the orchestration logs the same message for the outcome; rename the route's line (for example "Plan upgrade confirm received") so a log search for the outcome is not doubled.
- `NOT_EXECUTED_ERROR_TYPES` includes the rate-limit class; with the SDK's own retries, a 429 on a retry after a lost first answer could hide a made write. Very rare, and the next confirm is safe through V-2's fresh read; a one-line comment is enough.

#### QA focus

1. The F-1 path: update succeeds, the payment read fails → 502 `outcomeUnknown`, audited `unknown`, alert logged, secret nowhere.
2. The secret: only in the confirm 200 for `action_required` (fresh and resume); absent from every log line, audit entry, refusal body, the preview's `upgrade_awaiting_confirmation` body, and the 500 path.
3. Order contract: every our-data refusal (switches, row unreadable, not subscribed, not active, cancelling, top tier, not on sale, stale or future proration date) makes zero Stripe calls; the invoice read only after a pending update.
4. Double click and retry: identical params on a re-post of the same `prorationDate`; `idempotency_key_in_use` under both error classes → 409 `upgrade_busy`, not audited (F-2); a confirm after a finished upgrade → `upgrade_processing`, warn, no alert.
5. Webhook: the U-3 matrix and V-6 pins; U-4 retry only for this invoice's pending update; `not_applied` alerts and audits once, never on a replay; `billingReason` in `BOS_BILLING_INVOICE_PAID`.
6. Routes: 404 with nothing read when the checkout switch is off; 401; 400 for non-JSON, extra keys, a non-integer or a string `prorationDate`, an unknown tier; audit flushed before the 200 (the delayed-flush test).
7. Rerun `npm run test:bos-entitlements` on the final diff after the fixes.

#### Code Approved for QA: **Yes, after F-1 and F-2** (SA re-check of the fix diff), with F-3 to F-5 in the same pass.

---

## Implementation Notes

### P-7b.1a "Upgrade backend and CF-6" (Dev, 2026-10-13)

**Branch:** `feature/bos-plan-payments-p7b1`, worktree `neuronforge-invite-s1`, on `origin/main` `103dead2` (fetched and confirmed an ancestor on 2026-10-13). Nothing committed (RM's job, after SA, QA and the user).

**T0 day-1 checks.** `origin/main` still `103dead2`. Highest migration on `origin/main` still **20261057**. No migration in this slice. The P-4.2 files are as §1 describes. SDK types (`stripe` 19.2.1, pinned `2025-10-29.clover`): `invoices.createPreview` with `subscription_details.{items, proration_behavior, proration_date}`; `subscriptions.update` with `payment_behavior`, `proration_behavior`, `proration_date`; `Invoice.confirmation_secret`, `Invoice.payments` (includable), `Invoice.total`; `Subscription.pending_update` (`expires_at`, `subscription_items`), `latest_invoice`; `SubscriptionItem.current_period_start` / `_end` (on the ITEM, as SA noted); `invoicePayments.list({ invoice, expand })`; `InvoicePayment.payment.payment_intent`; error classes `StripeCardError`, `StripeIdempotencyError` and others by `type`.

**Adjusted items applied before T2** (SA): §3.2 table (V-2 `upgrade_processing` row, narrowed `billing_record_mismatch`, V-8 period-start row); §3.4 (`processing`, `upgrade_awaiting_confirmation`, `upgrade_processing`, V-3 copy and `outcomeUnknown`, V-2 "after the first has finished", step 7a, V-12 `taxMinor`); §3.5 branch 1 per V-5; §10 keys; §9 D2 and D3b; §11 sizes.

#### Files

| File | Change |
|---|---|
| `lib/stripe/StripeService.ts` | Subscription read: `items` (complete, with item period), `pendingUpdate`, `latestInvoiceId`. New: `previewBusinessOsPlanUpgrade`, `upgradeBusinessOsPlanSubscription` (the one write), `retrieveBusinessOsUpgradeInvoice` (Q-2), the private E-1 seam `upgradeInvoicePaymentState`, pure `upgradePaymentStateOf`, `businessOsUpgradeIdempotencyKey`, the fact types |
| `lib/business-os/billing/planInvoiceFacts.ts` | U-3 / CF-6; `decidingPriceIds`; header |
| `lib/business-os/billing/planPaymentApply.ts` | U-4 guard (step 9a, V-5); `upgradeNotApplied` alert and warning audit on a new row only; `billingReason` in the invoice-paid details (U-9) |
| `lib/business-os/billing/planCheckoutEligibility.ts` | `planUpgradeOffer` (§3.1) |
| `lib/business-os/billing/planUpgrade.ts` (new) | `planUpgradeEligibility`, `previewPlanUpgrade`, `confirmPlanUpgrade`, `PLAN_UPGRADE_REFUSALS`, the window constants |
| `app/api/business-os/billing/plan/upgrade/preview/route.ts`, `.../upgrade/route.ts` (new) | The two routes (V-11) |
| `lib/audit/events.ts`, `eventAudience.ts`, `__tests__/eventAudience.test.ts` | `BOS_BILLING_UPGRADE_REQUESTED` (info, SOC2, `'bos'`), count 53 → 54 / 198 → 199 |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | Three non-gate entries, `planCheckoutEligibility.ts` re-checked (no new symbol), F-B parser fix + its test; four existing entries renamed from `type X` to `X` |
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts`, `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts` | `planUpgrade.ts` and the two new test files that name the repository |
| Fixtures `customer-subscription-{deleted,updated}.json` (hand-built) | `pending_update: null`, `latest_invoice: null` added; `planStripeFields.c6.test.ts` reads `total`, item id and period, `pending_update`, `latest_invoice` |
| `scripts/probe-bos-upgrade-apply.sql` (new) | Rolled-back apply-function probe, U01 to U05 |
| Tests | New: `lib/stripe/__tests__/businessOsPlanUpgrade.test.ts` (19), `planUpgradeOffer.test.ts` (22), `planUpgradeEligibility.test.ts` (23), `planUpgrade.test.ts` (60), `app/api/business-os/billing/plan/upgrade/__tests__/route.test.ts` (52, both routes). Extended: `planInvoiceFacts.test.ts` (U-3 matrix + V-6), `planPaymentApply.test.ts` (U-4 block, harness gains the new fields), `planPaymentApply.firstPayment.test.ts` (key list + `billingReason`), `businessOsPlanWebhookReads.test.ts` |
| Docs | This workplan; requirement P-7b.1 row, §9.4 CF-6, §9.5 row 5 (V-12), Change History; `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` § Plan checkout + Change History |

#### Checks (final diff)

| Check | Result |
|---|---|
| Jest: `lib/business-os/billing`, `app/api/business-os/billing`, `app/api/stripe`, `lib/stripe`, `lib/business-os/entitlements`, `lib/repositories/__tests__`, `lib/audit` | **204 suites, 5,237 tests, all green** |
| `npm run test:bos-entitlements` (V-10) | **248 suites, 7,297 tests, green** |
| `npm run typecheck:bos-llm` | Passed, **0 new** (515 files, 28 baseline). It reports one baseline entry as fixed (`app/api/onboarding/build/route.ts` TS18047), which this slice does not touch |
| `tsc` diagnostics on every touched file, through the project program (scratch script) | **0** |
| ESLint on every touched file | 0 errors; 1 warning that predates this slice (`lib/audit/events.ts` line 1560, `_` unused) |
| `npm run lint:hooks` | Clean |
| `git diff --stat` | No deletion-only file (19 tracked files modified, 805 insertions, 37 deletions, plus the new files: the two routes and their test, `planUpgrade.ts`, four new test files, the probe, this workplan) |
| Mutation checks (sources md5-restored afterwards) | 3 of 3 caught: `upgrade_processing` turned into a mismatch (V-2); the U-4 retry without the `latestInvoiceId` test (V-5); the confirm route logging its result (V-1) |
| T8 / G-7 probe on local PGlite (scratch harness from P-5a, migrations 20261025, 20261027, 20261028) | **PASS** twice: without and with a lineage row; every count unchanged afterwards (rolled back); the unedited file refuses with PROBE SKIPPED. U02 INFO: with a lineage row, the dashboard-order upgrade invoice stamps the first payment and the late `basic` invoice does not (V-6 expected, accepted and recorded only). The optional production run on a test account is the user's |

#### Pending E-n (T1 BLOCKED: the standard sandbox key is not available; no Stripe call was made)

| # | What is pending | Where the code waits | If the answer differs |
|---|---|---|---|
| **E-1** | How the payment state is read on clover. Today: a `paid` invoice is `succeeded` with no read; an `open` invoice uses its `payments` list when expanded, else ONE `invoicePayments.list({ invoice, expand: ['data.payment.payment_intent'] })`. Also unverified: that `expand: ['latest_invoice.confirmation_secret']` is accepted on `subscriptions.update`, the `createPreview` amount fields (`amount_due`, `total`, `total_taxes`), and the `pending_update` shape on the update's answer | `StripeService.upgradeInvoicePaymentState` (private seam), `upgradeBusinessOsPlanSubscription`, `previewBusinessOsPlanUpgrade` | Only the update's `expand` list or the seam changes; the outcome mapping does not. **T2 stays "code done, pending E-1"** |
| **E-2** | The decline shape: thrown `StripeCardError`, or a returned pending update with `requires_payment_method`. Both are mapped to `declined` and tested (V-7). Whether a returned decline keeps a pending update (and so `retryAfter`, Q-6) is unconfirmed | `confirmPlanUpgrade` | None in code; the UI line "You can try again after" depends on it |
| **E-3** | Captured $0 credit-balance upgrade invoice (`amount_paid` 0, `total` > 0, `paid`, no pending update) | U-3 matrix uses the hand-built proration fixture | A field not present would show in the C-6 ratchet |
| **E-4** | **U-6 / G-2**: what happens to an unpaid upgrade invoice when its pending update expires. Holds P-7b.1b's UI (T10). Also decides whether the Q-2 resume is safe up to the expiry | `resumable()` in `planUpgrade.ts` requires the invoice `open` and `requires_action` | If the invoice can be paid after expiry, Dev brings a design to SA before T10 |
| **E-5** | Captured under-minimum upgrade invoice (`total` small, `amount_paid` 0) | U-3 matrix (hand-built `total: 30`) | As E-3 |
| **E-6** | The in-flight idempotency conflict: error `type` and `code`. Mapped today (after SA F-2) by `code === 'idempotency_key_in_use'` → `upgrade_busy` whatever the error class; any other `StripeIdempotencyError` → alerted `stripe_error` | `confirmPlanUpgrade` catch | The code string to match (E-6 now confirms, it no longer decides) |
| **U-7 / G-3** | Captured upgrade objects in the C-6 ratchet: a subscription with `pending_update`, a paid `subscription_update` invoice (negative `basic` line, positive `pro` line via `pricing.price_details.price`), a failed one, the expired-update event. `CAPTURED_OBJECTS` unchanged until then | `planStripeFields.c6.test.ts` | — |
| **D-W** | The webhook rows of E-1 to E-5 replayed through local `stripe listen` | — | — |

All Stripe answers in the new tests are hand-built and say so in each file's header.

#### Deviations and decisions for SA

1. **Outcome rule (U-5, V-4).** With `pending_if_incomplete`, *no pending update after the call* is read as "applied" → `upgraded`, whatever the payment state. A pending update with `succeeded` or `processing` → `processing`; `requires_action` with a secret → `action_required` (without one → unknown); `requires_payment_method` → `declined` (+ `retryAfter` = the pending update's expiry); `none` → unknown (V-3).
2. **PaymentIntent status map** (`upgradePaymentStateOf`): `requires_capture` → `processing`; `requires_confirmation` and `canceled` → `none`, so they are answered "could not confirm" (V-3), never "declined, nothing changed".
3. **Error classes on the write (V-3, V-7).** `StripeCardError` → `declined` (audited). `StripeIdempotencyError` + `idempotency_key_in_use` → `upgrade_busy`; other idempotency errors → alerted `stripe_error`. `StripeInvalidRequestError`, `StripeAuthenticationError`, `StripePermissionError`, `StripeRateLimitError` mean Stripe refused before running the request: alerted `stripe_error`, **not audited** (nothing was attempted). Everything else (API 5xx, connection, an untyped timeout) → alerted `stripe_error` with `outcomeUnknown: true` in the 502 body, audited `outcome: 'unknown'`.
4. **Stripe error objects are never logged from `planUpgrade.ts`** (V-1 hardening): a card error can carry the PaymentIntent, client secret included. Logs carry `stripeError: { name, type, code, statusCode, requestId }` only. The spy tests include a thrown card error that carries the secret.
5. **The Q-2 resume skips the runtime price check** (no price is written; the pending update was created by an earlier, checked request). Its audit has `lookupKey: null`, `resumed: true`, the pending invoice id.
6. **The idempotency key is built inside `StripeService`** from the call's own arguments (`businessOsUpgradeIdempotencyKey`), not passed by the caller, so it cannot drift from the parameters (CF-4 style).
7. **Refusal log levels** follow §3.4 "Logs": `error` + `alert: true` only for `billing_record_mismatch`, `price_unavailable`, `price_mismatch`, `stripe_error`. So the prices switch off and an unknown key mode (`upgrade_unavailable`) are warns, unlike the checkout, which logs its prices-switch refusal as an alerted error. SA to confirm.
8. **Fail-closed details.** A `bought_tier` the config does not know → `not_subscribed`. An item with no `current_period_start` → `preview_expired`. A preview in a currency other than USD → alerted `price_mismatch`. A pending update whose prices do not name exactly one tier is never resumed.
9. **`renewsOn`** in the preview is the single item's `current_period_end` (the period lives on the item on clover).
10. **The U-4 trial-swap case** in the tests drops the negative line, because an all-zero two-line invoice is refused `mixed_tiers` by the existing tier rule. That existing behaviour is unchanged and not in scope; noted for E-1, which will show what Stripe really sends.
11. **One route test file for both routes**, `app/api/business-os/billing/plan/upgrade/__tests__/route.test.ts`, to share the fakes.
12. **The probe** runs as the session role (no `SET ROLE`): the P-3b probe's privilege checks (P14, P15) are not repeated. Tier values are `probebasic` / `probepro` (no punctuation). It uses `INSERT INTO` only as the SQL keyword, as the P-3b probe did on production; the word appears in no string or comment.
13. **Not in P-7b.1a:** the view ↔ preview matrix test (T9) and every Settings change are P-7b.1b. The `my-plan` route and `planPurchaseView.ts` are untouched, so their registrations are unchanged.

#### SA fixes F-1..F-5 (Dev, 2026-10-13)

Applied from "SA Code Review — P-7b.1a (2026-10-13)". Uncommitted, awaiting SA's re-check of the fix diff. No fixture touched, no Stripe call made.

| # | Priority | Fix | Where | Tests |
|---|---|---|---|---|
| **F-1** | High | ✅ The payment-state read after the write runs **only when the update's answer holds a pending update** (with none the outcome is `upgraded`; a `paid` invoice still reports `succeeded` with no read, anything else `none`). The read is wrapped in its own try/catch inside `StripeService`: any failure answers `paymentState: 'none'` (→ `unknown`, audited, `outcomeUnknown: true`, alerted by the orchestration), and logs a warn `bos_billing_upgrade_payment_read_failed` with `stripeError: { name, type, code, statusCode, requestId }` only (new local helper `safeStripeErrorFields`), never the error object. `retrieveBusinessOsUpgradeInvoice` (Q-2, a read before any write) is unchanged | `lib/stripe/StripeService.ts` `upgradeBusinessOsPlanSubscription` | `businessOsPlanUpgrade.test.ts`: no pending update → `invoicePayments.list` never called; pending update + open invoice + list rejects with a secret-carrying `StripeInvalidRequestError` → resolves `none`, no throw, exact safe log fields, secret in no log call (the test's logger mock is now one shared instance). `route.test.ts` end to end through the REAL `StripeService` method over a hand-built Stripe client: 502 `stripe_error` + `outcomeUnknown: true`, audit flushed with `outcome: 'unknown'` and the invoice id, one alerted `error` line (`reason: 'outcome_unknown'`, `paymentState: 'none'`), the read-failed line, secret in no body, log or audit |
| **F-2** | Medium | ✅ `errorCode(err) === 'idempotency_key_in_use'` → `upgrade_busy` is tested **first**, before any class check; any other `StripeIdempotencyError` → alerted `stripe_error`. Comment records that the SDK retries a 409 and a 5xx itself (`maxNetworkRetries` default 2, same key), so `upgrade_busy` is rare and a lost first answer usually replays | `lib/business-os/billing/planUpgrade.ts` `confirmPlanUpgrade` catch | `planUpgrade.test.ts`: the code under `StripeIdempotencyError`, `StripeInvalidRequestError` and `StripeAPIError` → `upgrade_busy`, no `audit`, no requested line, a warn. `route.test.ts`: both `StripeIdempotencyError` and `StripeInvalidRequestError` → 409 `upgrade_busy`, not audited |
| **F-3** | Low | ✅ `upgrade_unavailable` with reason `bos_billing_prices_switch_off` or `stripe_key_mode_unknown` logs at `error` with `alert: true` (new `ALERTED_REASONS`, checked in `refuser`); code and status unchanged; `purchase_switches_off` stays a warn | `planUpgrade.ts` | `planUpgrade.test.ts`: both reasons, preview and confirm, exactly one alerted error line; checkout switch off stays a warn with no `alert` |
| **F-4** | Low | ✅ The resume invoice in the other mode (`livemode: true` against a test row) → `upgrade_pending` with `retryAfter`, no write, no secret, no audit (kills SA mutation M8) | `planUpgrade.test.ts` Q-2 `it.each` (runs for confirm and preview) | — |
| **F-5** | Low (docs) | ✅ Requirement §9.1 P-7b.1 row and §9.5 rows 7 (prices switch) and 15 (checkout switch): neither buy-path switch goes on in production while E-1, E-2, E-6 or D-W is open, because the upgrade routes ride those switches. Requirement Change History row at the end | `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | — |

**Checks after the fixes**

| Check | Result |
|---|---|
| Jest: `lib/business-os/billing`, `app/api/business-os/billing`, `lib/stripe`, `app/api/stripe`, `lib/audit` | **73 suites, 1,954 tests, green** |
| The three touched test files alone | 3 suites, 141 tests, green |
| `npm run test:bos-entitlements` | **248 suites, 7,297 tests, green** |
| `npm run typecheck:bos-llm` | Passed, **0 new** (515 files, 28 baseline; the same one baseline entry reported fixed, untouched by this slice) |
| `tsc` on the touched sources and tests (scratch tsconfig extending the project's) | 0 diagnostics |
| ESLint on the five touched code/test files | Clean |

#### SA re-check of F-1..F-5 + sandbox evidence (2026-10-13)

**Verdict: ✅ OK — Code Approved for QA.** A diff look, not a new review. Nothing is required in code before QA. One comment correction is recommended before RM commits (R-1 below); it does not block QA.

| Item | Result |
|---|---|
| F-1 | ✅ `upgradeBusinessOsPlanSubscription`: the payment read runs only when `pending !== null && invoice`; without a pending update, `paid` → `succeeded`, anything else → `none`, and no network read is made. The read has its own try/catch → `none`, and a warn that logs only `safeStripeErrorFields` (name / type / code / statusCode / requestId). Stripe test, route test (real method, 502 `outcomeUnknown`, audited `unknown`, secret absent) present. The Q-2 `retrieveBusinessOsUpgradeInvoice` read is still unguarded, which is correct: it runs before any write, and a throw there is the alerted `pending_invoice_read` refusal |
| F-2 | ✅ `errorCode(err) === 'idempotency_key_in_use'` is checked before any class check. **E-6 shape:** `StripeInvalidRequestError`, `invalid_request_error`, code `idempotency_key_in_use`, HTTP 409 → `upgrade_busy`, not audited. That is the exact case `planUpgrade.test.ts` and `route.test.ts` cover. The other E-6 shape (same key, different params) is `StripeIdempotencyError` 400 → alerted `stripe_error`, not audited. Correct: that request did nothing. A sequential replay returns the first answer (`replayed: true`), and our flow never reaches it anyway, because V-2's fresh read answers `upgrade_processing` first |
| F-3 | ✅ `ALERTED_REASONS` in `refuser`; `purchase_switches_off` stays a warn |
| F-4 | ✅ **M8 re-run by SA:** the `invoice.livemode === row.livemode` term was replaced with `true` → 1 test fails (the new Q-2 other-mode case). The file was restored from a scratch copy; md5 `49e4ef3f…` is identical before and after |
| F-5 | ✅ Requirement §9.1 P-7b.1 row and §9.5 rows 7 and 15 |
| Suites | `lib/business-os/billing`, `app/api/business-os/billing`, `lib/stripe`, `app/api/stripe`, `lib/audit`: **73 suites, 1,954 tests, green** (matches Dev) |

**Sandbox evidence against the code** (standard sandbox, `stripe` 19.2.1 at `2025-10-29.clover`, events at `2026-09-30.endive`):

| Exp. | Observed | Code path | Change needed? |
|---|---|---|---|
| E-1a | Update answer: `pending_update: null`, invoice `paid`, no `payments` key, `confirmation_secret` present (so the `expand` on update is accepted) | No pending update → `succeeded` with no read → `upgraded` | None |
| E-1b | Pending update; invoice `open`; no `payments` key; `invoicePayments.list` with `data.payment.payment_intent` → `is_default` true, PI `requires_action` | F-1 read runs → the fallback list → `requires_action` + secret → `action_required` | None. Expanding `latest_invoice.payments.data.payment.payment_intent` hits `property_expansion_max_depth`, so the list fallback is the permanent path. The `invoice.payments?.data ??` branch is now dead on the update answer but harmless; keep the E-1 seam comment in step with this |
| E-2 | A decline is **returned**, not thrown; the pending update is kept; PI `requires_payment_method` | → `declined` + `retryAfter` = `expires_at` | None in 7b.1a. **For 7b.1b (the Q-6 copy):** a second update before expiry **voids the first invoice**, opens a new one, and keeps the same `expires_at`. Stripe would allow "fix the card and try now" with no double invoice. Our "refused until expiry" is conservative and safe. Whether to offer an earlier retry is a 7b.1b / P-7a design point, not a fix |
| E-3 / E-5 | No pending update; invoice `paid`, `amount_paid` 0, no payment rows | No read; `upgraded` regardless (F-1a safe). U-3 `total > 0` applies the plan | None |
| E-4 | An unpaid upgrade invoice (3DS abandoned or declined) is voided exactly at `expires_at`; paying it or confirming its PI afterwards fails; the price stays on `basic` | Decision rule §8: **U-4 stays a backstop, UI proceeds as §3.7; the Q-2 resume stays as built** (it needs `open` + a pending update, both gone after expiry) | None. E-4's T10 gate is cleared |
| 3DS `invoice.payment_failed` | Every 3DS upgrade fires `payment_failed` alongside `payment_action_required` (E-1b, E-4); E-2 fires one per attempt | `recordFailedPlanInvoice` writes one `invoice_payment_failed` row (unique on `stripe_event_id`), moves nothing | **Harmless.** The paid dedup index is partial on `kind = 'invoice_paid'`, so the failed row cannot block the later paid apply. No code in `lib/` or `app/` reads `invoice_payment_failed` today. U-10, carried to P-6a, already covers this: banners and attempt counts key on renewals, never a `subscription_update` invoice. Added for P-6a: a 3DS upgrade that **succeeds** still leaves a failed row, so any future history display must not call it a failed payment |

**Recommended before commit (Low, comment only, Dev):**

- **R-1** `planUpgrade.ts`, the F-2 catch comment (and the F-2 row above): "the SDK retries a 409 ... so `upgrade_busy` is rare" is contradicted by E-6. With the SDK default retries, the in-flight 409 still reached the caller twice out of three, because the SDK honours `stripe-should-retry: false` (`RequestSender.js`). The wording came from SA's own F-2 note. Reword it to "E-6: the in-flight 409 is not absorbed by the SDK retries; `upgrade_busy` is the expected answer to a double click". No behaviour change.

**Carried to 7b.1b:** replace the "pending E-1 / E-2 / E-4 / E-6" markers with the observed answers, and pin E-1 to E-5 as captured fixtures in the C-6 ratchet (U-7). U-7 / G-3 and D-W remain open gates before 7b.1b merges and before either buy-path switch goes on (F-5).

**Code Approved for QA: Yes.**

---

## QA Testing Report

### P-7b.1a "Upgrade backend and CF-6"

**QA — 2026-10-13**
**Test mode:** full
**Strategy used:** A + B (Jest unit and integration through the real routes, orchestration and `StripeService` over fake Stripe clients). Plus a check against the **real scrubbed sandbox payloads** (E-1 to E-6, the `events/` `invoice.paid` deliveries on `2026-09-30.endive`), run through the real parsers in a temporary Jest file that was deleted afterwards. The fixtures were read from the scratchpad and nothing was copied into the repo (U-7 is P-7b.1b's). No browser, no real database, no Stripe call.
**Focus:** api, pipeline (webhook), security (V-1 secret, tenant isolation), schema
**Skipped:** e2e / manual browser (no UI in P-7b.1a; the UI is P-7b.1b). The optional live probe run on production (the user's)
**Input source:** prompt keywords (the TL brief) plus the SA's "QA focus" 1 to 7

#### Suites run (worktree `neuronforge-invite-s1`, uncommitted, F-1 to F-5 applied)

| Check | Result |
|---|---|
| Jest: `lib/business-os/billing`, `app/api/business-os/billing`, `lib/stripe`, `app/api/stripe`, `lib/audit`, `lib/business-os/entitlements`, `lib/repositories/__tests__` | **204 suites, 5,247 tests, all green** (10 more than SA's first 5,237 run: the F-1 to F-4 tests) |
| `npm run test:bos-entitlements` | **248 suites, 7,297 tests, green** |
| `npm run typecheck:bos-llm` | **Passed, 0 new** (515 files, 28 baseline; the same one baseline entry reported fixed, `app/api/onboarding/build/route.ts` TS18047, which this slice does not touch) |
| `npm run lint:hooks` | **Clean** (exit 0) |
| Real-payload check (temporary, deleted) | **22 of 22 passed, no mismatch with the code** (table below) |
| QA mutations (each restored by re-editing; md5 identical before and after: `route.ts` `57fc5cf0…`, `planCheckoutEligibility.ts` `ab8c18f2…`; `planUpgrade.ts` `49e4ef3f…` and `StripeService.ts` `8cd14917…` checked unchanged) | **2 of 2 caught.** QA-M1: the confirm route skips the audit on the refusal path (`if (result.audit && false)`). 2 tests fail: V-3 connection error and SA F-1 read-after-write. QA-M2: `planUpgradeOffer` without the `endedAt` test. 1 test fails ("not_active: an ended subscription, even if the status still reads active") |

#### Real sandbox payloads through the code (QA's own check)

Each scrubbed fixture was used as Stripe's answer to a fake client under the REAL `StripeService`, `confirmPlanUpgrade` / `previewPlanUpgrade`, `planInvoiceFacts` and `applyPaidPlanInvoice`. Price `…t4…` = basic and `…t5…` = pro, through the real lookup keys.

| Payload | Expected | Got |
|---|---|---|
| e1a update response (no pending update, invoice `paid`) | `upgraded`, no payment read | ✅ `paymentState: succeeded`; `invoicePayments.list` not called (F-1 a); the secret Stripe puts on the paid invoice appears in no log line |
| e1b update (pending) + e1b `invoicePayments.list` (PI `requires_action`) | `action_required` with the secret | ✅ The secret is only in the result: not in the audit facts or any log line |
| e2 update (pending) + the e2 invoice's payments (PI `requires_payment_method`) | `declined`, `retryAfter` = the pending expiry | ✅ `retryAfter` = `1792848746` as ISO |
| e3 update (credit balance) / e5 update (under the minimum) | `upgraded` | ✅ both |
| e1a / e3 / e5 previews | due 3387 / total 3387; due 0 / total 3387; due 14 / total 14 | ✅ `{ amountDueMinor, totalMinor, taxMinor: 0, currency: 'usd' }` exact (`total_taxes: []` → 0) |
| e4 subscription after expiry | no pending update, item on basic: an ordinary upgrade, no resume read | ✅ |
| e4 void invoice behind a pending update | not resumable → `upgrade_pending` | ✅ `paymentState: none` with no list read; `upgrade_pending` with `retryAfter` = expiry; no secret |
| e1b resume: the pending subscription, the open invoice (as retrieved with `confirmation_secret` only, no `payments`) and the list | confirm → `action_required`, `resumed: true`; preview → `upgrade_awaiting_confirmation`, no secret | ✅ preview body has `amountDueMinor: 3387` and a fresh `prorationDate`; the secret is in no log line |
| e6a race error (`StripeError.generate` of the captured raw: `StripeInvalidRequestError`, code `idempotency_key_in_use`, 409) | `upgrade_busy`, not audited | ✅ exactly `{ ok: false, code: 'upgrade_busy' }`. Without F-2 this would have been an alerted `stripe_error` |
| e6a replay (Stripe's replayed answer) | `upgraded` | ✅ |
| e6 same key, other params (`StripeIdempotencyError`) | alerted `stripe_error`, not audited | ✅ |
| `invoice.paid` e1a, e1b, e3 (`amount_paid` 0, total 3387), e5 (`amount_paid` 0, total 14), e5 renewal (`subscription_cycle`, 12914) | tier pro, `assignsPlan` true, `decidingPriceIds` = [pro], tax 0, usd | ✅ all five; CF-6 (U-3) assigns on e3 and e5 as ruled |
| e1b `invoice.paid` + the fresh read after payment (no pending update, item pro) | applied; `billingReason` in the `BOS_BILLING_INVOICE_PAID` details; severity info | ✅ |
| e1b `invoice.paid` + a fresh read still pending on THIS invoice (`latest_invoice` = the invoice) | `PlanPaymentRetryError`, nothing applied | ✅ (V-5 branch 1) |
| e3 / e5 `invoice.paid` + their post-update subscriptions | applied with the plan, `amountMinor` 0 | ✅ |
| e1a `invoice.paid` + a subscription still on basic (U-4 case 2) | recorded with `assignsPlan` false, one alert, a `warning` audit with `upgradeNotApplied` | ✅ |
| e5 renewal + a pending update pointing at it (V-6) | no U-4 branch | ✅ applied |

These results agree with SA's re-check table (E-1 to E-6, "no code change needed in 7b.1a"), which reached the same answer by reading the code against the evidence.

#### Test Coverage (SA QA focus 1 to 7)

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| 1. F-1: update ok, follow-up read fails → 502 `outcomeUnknown`, audited `unknown`, alert, secret nowhere | ✅ | Pass | Route test through the REAL `StripeService` method; QA-M1 shows the audit on this path is pinned |
| 2. Secret only in the confirm 200 for `action_required` (fresh and resume): no log line, audit entry, refusal body, awaiting-confirmation body or 500 | ✅ | Pass | Dev spy tests plus QA's real-payload runs (e1b fresh, e1b resume, preview awaiting). The 500 catch logs `{ err }`, but every Stripe call is caught first (SA verified; QA re-read the code) |
| 3. Every our-data refusal makes zero Stripe calls; the invoice read comes only after a pending update | ✅ | Pass | `planUpgrade.test.ts` "our-data refusals make ZERO Stripe calls" (preview and confirm) and the V-9 test; a stale preview makes zero calls at the route |
| 4. Double click: same params on a re-post; `idempotency_key_in_use` under both classes → 409 `upgrade_busy`, not audited; a confirm after a finished upgrade → `upgrade_processing`, warn, no alert | ✅ | Pass | Also checked with the REAL captured E-6 error (above) |
| 5. Webhook: the U-3 matrix and V-6 pins; U-4 retries only for this invoice; `not_applied` alerts and audits once, never on a replay; `billingReason` in invoice-paid | ✅ | Pass | Dev tests plus the real `invoice.paid` deliveries (above) |
| 6. Routes: 404 with nothing read; 401; 400 for non-JSON, extra keys, a non-integer / string / zero / negative / missing `prorationDate`, an unknown tier; audit flushed before the 200 | ✅ | Pass | `route.test.ts` (54 tests, both routes) |
| 7. `npm run test:bos-entitlements` on the final diff | ✅ | Pass | 248 / 7,297 |
| Happy path + a failure path (CLAUDE.md minimum) | ✅ | Pass | — |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. The `upgraded` path makes one subscription read, one price check (cached 60 s) and one write.

**Edge cases and observations (nice to fix, or forward):**
1. **SA R-1 is still open** (Low, comment only). `planUpgrade.ts` md5 is unchanged at `49e4ef3f…`, so the F-2 comment still says the SDK retries make `upgrade_busy` rare. E-6 contradicts that. Dev should reword it before RM commits, as SA recommends. No behaviour change.
2. **Real E-2 / E-4: a declined upgrade invoice gets a Smart Retries `next_payment_attempt`** (`1792928968`, about 45 h after the update). Stripe voids that invoice when the pending update expires (about 23 h, `1792848746`), so the retry never fires and "nothing changed" stays true. If the pending window or the retry schedule ever changes, re-check this (P-7b.1b, Q-6 copy). Low.
3. **Real E-2: Stripe accepts a second update over a pending one** (it voids the first invoice and opens another). In our flow, only our step-7 `upgrade_pending` refusal stops a second open invoice, and that refusal is tested. Recorded so the refusal is not relaxed without a design (SA's 7b.1b / P-7a point). Low.
4. The 3-D Secure `invoice.payment_failed` row and the stale "pending E-n" markers: as in SA's re-check (U-10 → P-6a; the markers and the U-7 fixtures → P-7b.1b). QA has nothing to add.
5. SA's optimisation is not applied: the confirm route logs "Plan upgrade requested" on entry, which is the same message as the orchestration's outcome line. Cosmetic.

#### Test Outputs / Logs

```text
Jest (7 scopes):        Test Suites: 204 passed, 204 total   Tests: 5247 passed, 5247 total
test:bos-entitlements:  Test Suites: 248 passed, 248 total   Tests: 7297 passed, 7297 total
typecheck:bos-llm:      515 files in scope, 28 errors, 0 new (281.4s) - passed
lint:hooks:             exit 0
QA real payloads (temporary, deleted): Tests: 22 passed, 22 total
QA-M1 (route refusal-path audit removed): 2 failed (V-3, SA F-1); restored, md5 57fc5cf0...
QA-M2 (offer without endedAt):            1 failed (planUpgradeOffer not_active ended); restored, md5 ab8c18f2...
```

#### Final Status
- [x] All acceptance criteria in P-7b.1a's scope pass. **Verdict: PASS WITH NOTES.** There is no bug. Note 1 (SA R-1) is a comment fix Dev should make before commit; notes 2 to 5 are forward items. Ready for the user's diff review and RM, under SA's merge gates (U-7 / G-3 and D-W before P-7b.1b merges and before any production switch flip, F-5)
- [ ] Issues found: Dev must address before commit

---

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-13 | Workplan written (Dev) | P-7b.1 "Upgrade now" planned against `origin/main` `103dead2` under SA conditions U-1 to U-10: preview and confirm routes, exact Stripe parameters, our-data offer predicate plus fresh-read eligibility, CF-6 (U-3) and the U-4 guard on the webhook, `BOS_BILLING_UPGRADE_REQUESTED`, sandbox experiments E-1 to E-6 (U-6, U-7), test matrix incl. anchor probe, demo on the standard sandbox, en/he/es. ≈ 5.1d; split proposed into P-7b.1a (backend + CF-6, ≈ 3.3d) and P-7b.1b (Settings UI, ≈ 1.8d). No migration (highest 20261057). Q-1 to Q-9 for SA |
| 2026-10-13 | SA workplan review: APPROVED WITH CONDITIONS (SA) | Conditions V-1 to V-12 (secret only in the owner's 200 body; webhook lag answered `upgrade_processing`, not an alerted mismatch; an unknown result after the write never says "nothing changed" and retries on the same idempotency key; `processing` its own outcome; U-4 retry only for this invoice's pending update; every existing invoice kind pinned; decline mapped both ways; period start read from the item on clover; order contract; entitlements registrations + F-B; routes per `new-api-route`; tax wording forward to §9.5). Q-2 resume after an abandoned 3-D Secure ruled IN; Q-4 `processing` own outcome; Q-5 offered with a note; Q-7 in P-7b.1b; Q-8 out. First split approved, not stacked: P-7b.1a ≈ 3.6d, P-7b.1b ≈ 1.9d. No business question |
| 2026-10-13 | P-7b.1a code complete (Dev) | SA adjusted items applied before T2 (§3.2 V-2/V-8 rows, §3.4 `processing`, `upgrade_awaiting_confirmation`, `upgrade_processing`, V-3 copy, §3.5 V-5, §10 keys, demo D2/D3b, §11 sizes). T0, T3 to T8 done; T2 code done pending E-1; T1 BLOCKED (no sandbox key); T12/T13 done for P-7b.1a. Routes, orchestration, CF-6, U-4, Q-2 resume (server half), `BOS_BILLING_UPGRADE_REQUESTED`, F-B, registrations, probe PASS on local PGlite. Implementation Notes (P-7b.1a) with the pending E-n list and deviations for SA. Uncommitted |
| 2026-10-13 | SA code review of P-7b.1a: APPROVED WITH FIXES (SA) | Suites rerun green (204 / 5,237; `test:bos-entitlements` 248 / 7,297); 9 of 10 mutations caught. F-1 High: the payment-state read after the write must not surface as a "refused before running" error (read only with a pending update; failure → `none` → unknown, audited). F-2 Medium: `idempotency_key_in_use` matched by code whatever the error class. F-3 Low: prices switch off and key mode unknown alerted, as the checkout (deviation 7). F-4 Low: test for the resume invoice's mode cross-check. F-5 Low: record that the production switches stay off while E-1, E-2, E-6, D-W are open. Deviations 1–6, 8–13 accepted. P-7b.1a may merge with the E-items pending; E-1 and E-4 gate T10, E-1 to E-6, U-7 and D-W gate P-7b.1b's merge and any production switch flip |
| 2026-10-13 | P-7b.1a SA fixes F-1 to F-5 applied (Dev) | F-1: payment-state read only with a pending update, any failure → `none` (unknown, audited, alerted), safe error fields only. F-2: `idempotency_key_in_use` matched by code before any class check. F-3: prices switch off and key mode unknown alerted. F-4: resume-invoice mode test (M8). F-5: requirement §9.1 P-7b.1 row and §9.5 rows 7 and 15. E-6 pending row updated. Tests added in the Stripe, orchestration and route files; suites green (73 / 1,954; `test:bos-entitlements` 248 / 7,297; `typecheck:bos-llm` 0 new). Table in Implementation Notes "SA fixes F-1..F-5". Uncommitted, awaiting SA re-check |
| 2026-10-13 | SA re-check of F-1 to F-5 and the sandbox evidence: OK (SA) | The F-1 to F-5 diff checked; suites green (73 / 1,954); M8 re-run now caught. E-1 to E-6 matched against the code: no code change needed in 7b.1a. E-4 clears the T10 gate (U-4 stays a backstop, the Q-2 resume stays as built). The 3-D Secure `payment_failed` row is harmless (partial paid index, no reader; U-10 extended for P-6a). R-1 (Low, comment only): the F-2 note that the SDK absorbs the 409 is contradicted by E-6. For 7b.1b: E-2 shows that a re-update before expiry voids the first invoice. Code Approved for QA |
| 2026-10-13 | QA of P-7b.1a: PASS WITH NOTES (QA) | 204 suites / 5,247 tests green; `test:bos-entitlements` 248 / 7,297; `typecheck:bos-llm` 0 new; `lint:hooks` clean. Real sandbox payloads (E-1 to E-6, `invoice.paid` on `2026-09-30.endive`) run through the real parsers in a temporary test (deleted): 22 / 22, no mismatch. 2 / 2 QA mutations caught and md5-restored. No bug. Open: SA R-1 comment (Low, before commit). Forward: a declined invoice's Smart Retry falls after the void at expiry; our `upgrade_pending` refusal is the only guard against a second open invoice |
| 2026-10-13 | SA R-1 applied (TL) | Comment-only: the F-2 catch comment in `lib/business-os/billing/planUpgrade.ts` now says `upgrade_busy` is the expected answer to a double click (Stripe sends `stripe-should-retry: false`, so the SDK does not retry the 409; E-6). The F-2 row above that calls it rare is superseded. No behaviour change |
