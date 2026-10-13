# Workplan: Business OS Plan Payments, P-7b.1 (Upgrade now: Essentials → Autopilot)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): F7 (incl. "How (SA)"); §6 (upgrade, credit period); §9.1 P-7b.1 and P-7b.2 rows; §9.4 **CF-6**; SR-5, SR-8, SR-11, SR-12, SR-15, SR-16, SR-17; AC-F7.1, AC-F7.3; and **"SA Ruling — P-4 and P-7b.1 sequencing (2026-10-12)"**, R-1, R-2 and conditions **U-1 to U-10**. Also SA's later notes in the [P-4 workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P4_WORKPLAN.md): the P-4.2 Low note on the admin-assigned plan offered Choose on its own plan, QA P-4.2 note 2 (Stripe Checkout language), and P-4.1 follow-ups F-A and F-B.
**Depends on:** P-3b merged (#251, #299); P-5a merged (#314, #327); **P-4 merged** (P-4.1 #337, P-4.2 #341), whose purchase view (`planPurchaseView.ts`), `planPurchaseOffer` pattern, Settings → Plan island, shared Stripe.js loader and bounded re-read this slice reuses. **Not P-6a** (SA R-1).
**Date:** 2026-10-13
**Branch:** P-7b.1a on `feature/bos-plan-payments-p7b1` (fresh from `origin/main` `103dead2`, #341), **merged as PR #346**. P-7b.1b on `feature/bos-plan-payments-p7b1b`, worktree `neuronforge-invite-s1`, fresh from `origin/main` `8014ee73` (#346); confirmed with `git branch --show-current` on 2026-10-13.
**Status:** P-7b.1a **Merged** (PR #346). P-7b.1b **Code Complete** (uncommitted); SA code review 2026-10-13: **APPROVED WITH FIXES** (G-1, G-2 before QA; G-3 docs); **G-1 to G-3 applied by Dev 2026-10-13, awaiting SA re-check**. E-1 to E-6 observed on the sandbox 2026-10-13 (T1 done, T2 done). D-W and T14 are TL's (checklist in Implementation Notes (P-7b.1b)). G-5 (he/es drafts) is the user's.

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
| ✅ T1 | **Done 2026-10-13** (first BLOCKED on the sandbox key; run on the standard sandbox, evidence in "SA re-check of F-1..F-5 + sandbox evidence"; captures committed in P-7b.1b). Sandbox experiments E-1 to E-6 and fixture capture (§8). Standard sandbox; key location from TL. Results and captured, scrubbed fixtures recorded in Implementation Notes. U-6 answered (G-2) | a | 0.5d |
| ✅ T2 | **Done**: E-1 observed 2026-10-13 (the update's `expand` accepted; the payment state read by ONE `invoicePayments.list`, the permanent path; preview fields `amount_due`, `total`, `total_taxes`), pinned by the captured fixtures (P-7b.1b). `StripeService`: additive subscription fields; `previewBusinessOsPlanUpgrade`; `upgradeBusinessOsPlanSubscription` (exact params, idempotency key, facts-only return, card-error mapping); tests incl. "no metadata, no anchor, no trial_end" and "secret never in the facts' logs" | a | 0.5d |
| ✅ T3 | U-3 in `planInvoiceFacts` + `decidingPriceIds`; the U-3 matrix; C-6 field list (`total`) | a | 0.25d |
| ✅ T4 | U-4 in `planPaymentApply` (pending → retry; not on price → record without plan + alert + audit only on a new row); `billingReason` in details; tests incl. replay silence | a | 0.35d |
| ✅ T5 | `planUpgradeOffer` + `planUpgradeEligibility` (pure); tests over every rule and order | a | 0.35d |
| ✅ T6 | `planUpgrade.ts` orchestration: order contract, `prorationDate` window, price check on the target, outcome mapping, refusal table; tests with fakes | a | 0.5d |
| ✅ T7 | The two routes (`new-api-route`); `BOS_BILLING_UPGRADE_REQUESTED` registration; route tests (happy path per outcome, 401, 400 incl. extra keys, every refusal, double click, flush before 200, secret only in the body) | a | 0.4d |
| ✅ T8 | Apply-function probe `scripts/probe-bos-upgrade-apply.sql` (U-8 anchor cases), run on local PGlite | a | 0.25d |
| ✅ T9 | `purchase.upgrade` in the view + wire type; `my-plan` tests; matrix test view ↔ preview route | b | 0.3d |
| ✅ T10 | `PlanUpgrade.tsx` + `PlanSection` wiring + `planUpgradeCopy.ts`: preview, confirm, 3-D Secure via `handleNextAction`, outcomes, bounded re-read, success only from the server; Q-7 wording if ruled in | b | 0.6d |
| ✅ T11 | i18n en/he/es (§10), RTL render tests; he/es drafts to the user (G-5) | b | 0.2d |
| ✅ T12 | **a: done; b: done** (P-7b.1b: the `planPurchaseView.ts` registration re-checked, no new importer of the module). Registrations + F-B parser fix + placement guards + `test:bos-entitlements` (a: backend files; b: view and UI); ENTITLEMENTS doc § Billing; requirement row, CF-6 closed, Change History | a + b | 0.2d |
| ✅ T13 | **a: done; b: done** (P-7b.1b checks in Implementation Notes). Full checks (G-4), `git diff --stat` reviewed (no deletion-only file), Implementation Notes | a + b | 0.2d |
| ⬜ T14 | **TL runs it** (checklist in Implementation Notes (P-7b.1b), with D-W). Demo on the standard sandbox (§9), subscriptions cancelled the same day (TL / user, Dev assists) | b (D-W rows in a) | 0.4d |
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

### SA Code Review — P-7b.1b (2026-10-13)

**Code Review by SA — 2026-10-13**
**Status:** 🔄 **APPROVED WITH FIXES** — G-1 (Medium, behaviour) and G-2 (Medium, tests only) are applied by Dev and re-checked by SA (a diff look, not a new review) before QA starts; G-3 (docs) in the same pass. No business question for the user.

Reviewed in the worktree `neuronforge-invite-s1` on `feature/bos-plan-payments-p7b1b` (`origin/main` `8014ee73`), uncommitted: the 25 modified files, `PlanUpgrade.tsx`, `planUpgradeCopy.ts`, the three new test files and the 39 `captured-p7b1-*.json` fixtures. Read against U-5, V-1, V-3, Q-2, Q-5 to Q-7, the user's E-5 decision, the P-7b.1a review and re-check, and the `business-os-entitlements` review checklist.

#### Checks run by SA

| Check | Result |
|---|---|
| Jest: `lib/business-os/billing`, `app/api/business-os/billing`, `app/api/business-os/entitlements`, `components/business-os/settings`, `lib/stripe`, `app/api/stripe`, `lib/repositories/__tests__/BusinessOsBilling*`, `lib/business-os/entitlements` | **110 suites, 5,603 tests, green** |
| `npm run test:bos-entitlements` | **251 suites, 7,337 tests, green** (matches Dev) |
| Mutations (each restored from a scratch copy; md5 of `PlanUpgrade.tsx` `4f5b1345…`, `planUpgradeCopy.ts` `dfa8b978…`, `planPurchaseView.ts` `f060e12b…`, `PlanSection.tsx` `98aa7bc2…` identical before and after) | **2 of 5 caught.** Caught: E-5 boundary `<` → `<=` 50 (1 fails); the view's upgrade offer fed hard-coded switches ON instead of the real ones (9 fail across the matrix, view and `my-plan` tests). **Survived:** MB, a Stripe.js throw inside `handleNextAction` read as "not confirmed, nothing changed" (deviation 5 claims "unknown"; no test) → G-1; MS1, the upgrade success without `succeeded` (tier + `renewing`); MS2, the upgrade success without `planId === upgradeTarget` → G-2. Both are U-5 terms |
| Fixture scrub re-scan (39 files) | ✅ Emails: only `fixture@example.invalid` (26). URLs: only `https://example.invalid/scrubbed` (49). No `sk_` / `rk_` / `pk_` / `whsec_`. Every `client_secret` is `scrubbed_secret` (9); `confirmation_secret` otherwise null. No `bos_*` metadata key or value (every `metadata` is `{}`). Names: `Test Customer` and the restored SDK class name only; `customer_phone` null; no address (the one `country: US` is the test card's issuing country); no IP. Present and harmless: the sandbox account id, test-mode object ids, invoice numbers, the test card `last4` 0341 and its test fingerprint, a 3-D Secure `server_transaction_id`, and the `bos-upgrade:` idempotency keys (sub, price, date only) |
| "pending E-n" markers | ✅ None left in `lib/`, `app/`, `components/`. The remaining mentions in this workplan are history (the P-7b.1a sections), correct as written |
| i18n | ✅ 29 keys in each of en / he / es, the same key set (diffed). RTL: the island uses `me-1` (logical), the render test asserts `dir="rtl"` for Hebrew and no English for he / es. he / es remain drafts for the user (G-5) |

#### Conditions verified in code

| # | Verdict | Where |
|---|---|---|
| V-1 Secret | ✅ | `PlanUpgrade.tsx`: the secret is read from the confirm body into a `const`, passed as an argument to `authenticate`, and from there only to `stripe.handleNextAction({ clientSecret })`. No `Phase` variant carries it; no storage, router, URL or `history` use in the file; both `logger.warn` calls in the 3-D Secure / confirm paths log `errName` only (the preview's `{ err }` is a fetch `TypeError`, before any secret exists). Render test asserts the DOM, URL and `setItem`; the source guard pins the shape |
| U-5 success only from the server | ✅ in code, ❌ untested in two of its terms → G-2 | `PlanSection`: `upgradeSucceeded` = target set AND `succeeded` (status ok, kind tier, `renewing`) AND `planId === target` AND the record no longer offers the target. The apply function writes `bought_tier` with the plan (`20261028` line 202), so the last term clears once the webhook lands. The island never claims success |
| V-3 Try again, same `prorationDate` | ✅ | `confirm(tier, unsure.prorationDate, …)`; pinned by Dev's M3 and the render test's two-post assertion |
| V-3 unknown never "nothing changed" | ✅ for the route answers (502 `outcomeUnknown`, 5xx without a code, network after send, `action_required` without a secret, an unknown outcome); **❌ for a returned Stripe.js error that is not a payment refusal → G-1** | |
| Q-2 resume (screen half) | ✅ | Preview `409 upgrade_awaiting_confirmation` → the "waiting" line, the pending amount, Confirm posts the fresh `prorationDate`; never a secret in the preview |
| Q-5 note | ✅ | `plan.upgrade.own_plan_note`, shown only when the plan in force is a tier equal to the target; wording as ruled |
| Q-6 | ✅ | `declined` + `retryAfter` → "You can try again after {time}" on the account clock; `upgrade_pending` without a time uses `refusal.pending_no_time`, never an empty `{time}` |
| Q-7 | ✅ | `currentTierId` set only for `kind === 'tier'`; label "Pay for {plan}" + note; what is offered is still the server's `tiers` |
| E-5 user decision | ✅ exact | `upgradeDueKey`: `<= 0` → zero line; `< 50` → "Nothing to pay now. {amount} will be added to your next bill."; `>= 50` → "due now, excluding tax". Strictly between 0 and 50, threshold 50 (`STRIPE_MINIMUM_CHARGE_MINOR`); pinned at 0 / 1 / 49 / 50, and the boundary mutation is caught |
| M-2 / no publishable key | ✅ | `confirm` returns early without `stripeReady`; no Confirm and no Try again rendered |
| Client-side imports (F-1 guard style, W-6) | ✅ | `PlanUpgrade.tsx` / `planUpgradeCopy.ts`: type-only imports from billing (`PlanUpgradeRefusalCode`, `PlanChoice`), no entitlements import, no `server-only`, repository, `supabaseServer` or `lib/stripe/`; source guard test covers both files. `createLogger` in a client component has its precedent in `PlanSection.tsx` / `PlanPurchase` |
| Entitlements (V-10, checklist) | ✅ | No new import from `lib/business-os/entitlements/` in any source file. `planPurchaseView.ts` gains `planUpgradeOffer` from `planCheckoutEligibility.ts` (not the module); its registration `why` re-checked honestly (describes, refuses nothing). The new test file's type imports from the module are tests, not enforcement points. Doc § Plan checkout + Change History updated |
| Repository guards | ✅ | The captured test is listed in both billing repository "only these files name it" lists (type imports only) |
| C-6 ratchet | ✅ | Five new kinds with the fields the code actually reads (checked against `previewBusinessOsPlanUpgrade`, `upgradeBusinessOsPlanSubscription`, `pendingUpdateFacts`, `upgradePaymentStateOf`, the F-2 catch); `CAPTURED_OBJECTS` equality assertion updated; the version allow-list adds `2026-09-30.endive` for the sandbox events only, each fixture's source line naming its version |
| Logging | ✅ | Pino throughout; no `console.*` in any touched file |
| Hooks | ✅ | Every hook in `PlanUpgrade` runs before its early `return null` |

#### Code Review Comments (fixes, Dev applies)

1. **G-1 — `components/business-os/settings/PlanUpgrade.tsx` `authenticate` — a returned Stripe.js error is read as "nothing changed" whatever it is. Priority: Medium.** Today any `result.error`, and any non-success status, becomes `not_confirmed` ("The payment was not confirmed, so nothing changed. You're still on {plan}."). That is true for a refusal (the bank or the owner refused or closed the challenge; E-4 then voids the invoice at expiry), but not for an `api_connection_error` / `api_error` / `rate_limit_error` returned after the challenge may have completed: the payment can have succeeded and the upgrade will land, and the screen has told the owner nothing changed. That is the V-3 rule on the client side. **Fix:** classify by what is known about the PaymentIntent. (a) A PaymentIntent status (from `result.paymentIntent`, or `result.error.payment_intent` when present) of `succeeded` / `processing` / `requires_capture` → `onUpgrading`, as today. (b) `requires_payment_method`, `requires_action` or `canceled`, or `result.error.type === 'card_error'`, or `result.error.code === 'payment_intent_authentication_failure'` (how Stripe.js reports a closed or failed challenge) → `not_confirmed`. (c) Anything else (another error type with no PaymentIntent, a missing or unrecognised status) → `unknown` with Check again / Try again. Keep the existing throw → `unknown`. **Tests (render):** a Stripe.js throw → "We could not confirm your upgrade", never "nothing changed" (kills SA mutation MB); a returned `{ error: { type: 'api_connection_error' } }` → the same; a returned closed-challenge error (`invalid_request_error`, `payment_intent_authentication_failure`, `payment_intent.status: 'requires_payment_method'`) → "not confirmed"; the existing `card_error` and `requires_payment_method` cases stay.
2. **G-2 — `components/business-os/settings/__tests__/PlanUpgrade.render.test.tsx` — two U-5 success terms are not pinned. Priority: Medium (tests only).** SA mutations MS1 and MS2 both survived the whole `components/business-os/settings` suite (161 tests). **Add:** (a) after Confirm → `upgraded`, the re-read shows the plan in force = the target and the record no longer offers it, but `billing.state` is not `renewing` (for example `cancelling` or `past_due`) → no "You're on …", still "Upgrading…" / then "taking longer"; (b) the re-read shows `renewing`, `purchase.upgrade` null (for example the prices switch turned off meanwhile), and the plan in force still the LOWER tier → no "You're on …" (this case would otherwise read "You're on Essentials" right after an upgrade). Re-run MS1 and MS2: each must fail at least one test.
3. **G-3 — this workplan, Implementation Notes (P-7b.1b) and the D-W / T14 checklist — docs. Priority: Low.** Record G-1 / G-2 and the SA mutations in the Checks table. In T14 D3b, add: "record what Stripe.js returned when the challenge was closed (error `type`, `code`, PaymentIntent status)", so G-1's classification is confirmed against the real Stripe.js, which the render tests can only mock.

#### Rulings on deviations 1 to 12

| # | Ruling |
|---|---|
| 1 Matrix drives `previewPlanUpgrade` | **Accepted.** Same shape as P-4's matrix; the route's front (404, auth, strict body) has its own suite. The documented exceptions are exactly the Stripe-side refusals, which our data cannot predict. The hard-coded-switches mutation is caught by it |
| 2 Extra success term ("no longer offered") | **Accepted, and required.** Without it the Q-5 case reads "done" before the webhook lands (Dev's M2). It cannot keep success away forever: the apply writes `bought_tier` with the plan. G-2 pins the two other terms |
| 3 `upgrade_processing` / `not_an_upgrade` → "Upgrading…" + re-read | **Accepted.** Both mean our record or Stripe already moved past the page; the bounded re-read decides, and if it is something else (for example another tab upgraded to a higher tier) it ends in "taking longer than usual" with the reload link, never a false success |
| 4 `not_subscribed` → the `not_active` line | **Accepted** |
| 5 Unknown-state mapping | **Accepted for the route answers and for a Stripe.js throw; changed for a returned Stripe.js error → G-1.** A closed challenge and a bank refusal are "not confirmed, nothing changed" (true by E-4); a transport or API error from Stripe.js is not known to be a refusal, so it is "could not confirm". A preview failure reading the generic line is right (a preview writes nothing). Stripe.js unloadable after the confirm answered → "not confirmed" is right (no challenge was shown, so nothing was paid) |
| 6 Check again = ONE re-read | **Accepted.** V-3 asked for "re-read my-plan"; one read per press is the honest answer to "is it done now?", the island stays unsure unless the server shows success, and "Upgrading…" is never claimed for an unknown result. `onUpgradeCheckAgain` catches its own failure, so the button cannot stay disabled |
| 7 Three new keys | **Accepted** (`due_later_small` is the user's E-5 decision; `pending_no_time` avoids an unfilled `{time}`; `try_again` is V-3's button). In the G-5 table for the user |
| 8 "Still on {plan}" names the plan in force | **Accepted** (true in the Q-5 case too) |
| 9 No publishable key → price, no Confirm | **Accepted** (M-2 pattern). The price is information; the confirm is never posted, and Try again is hidden with it |
| 10 Q-7 label only | **Accepted.** The P-4.2 render test's new "Pay for" expectation is correct: its default payload is precisely the Q-7 case |
| 11 Fixture plumbing; one fresh read for all confirm runs | **Accepted; not a weak test for what U-7 requires.** What U-7 / G-3 asks is that OUR parsing runs over Stripe's real answers: each experiment's own update answer, invoice-payments list, preview and error body is parsed by the real `StripeService` and orchestration, and the C-6 ratchet pins the fields. The fresh read is a real capture of exactly the pre-upgrade shape (one basic item, no pending update), and the code's decision on it is the same for every experiment. What it does not prove is anything about ids: the fresh read's subscription and customer differ from the update answer's, which passes only because the code does not compare them. Optimisation below. Classification of SDK answers by file name is accepted: a misnamed file would be checked against the wrong field list and fail, or drop a kind and fail the `CAPTURED_OBJECTS` equality |
| 12 E-2 earlier retry not acted on | **Accepted** (as ruled in the re-check: conservative and safe; an earlier "fix the card and try now" is a P-7a design point) |

#### Merge gates (D-W, T14)

| Item | Gate for the P-7b.1b merge? | Why |
|---|---|---|
| **G-1, G-2 (+ G-3)** | **Yes** | SA re-check of the fix diff, then QA |
| **T14** (demo D0 to D7) | **Yes** | It is the manual critical-path check CLAUDE.md requires for a new UI flow, and the only run of the island against the real Stripe.js `handleNextAction` (D3a / D3b), which every render test mocks. D3b also confirms G-1's classification (G-3). D8 is optional and does not gate |
| **D-W** (D-W1 to D-W5) | **Yes, unchanged from the P-7b.1a ruling**, run in the SAME sandbox session as T14 | The captured test runs the real handlers over real events, but with the apply function, the route, signature checking and Stripe's redelivery faked; D-W is the only end-to-end run of them. It costs almost nothing extra: T14 D1b, D3a, D4 and D2 produce the D-W1 to D-W4 events, and D-W5 is one `stripe events resend`. D-W6 is optional and does not gate |
| **G-5** he / es wording | **Yes** (unchanged) | The user approves the drafts |
| **All of the above** | Also before either buy-path switch is turned on in production (F-5, unchanged) | |

If D-W or T14 finds a defect in P-7b.1a's code, the fix is its own PR from `origin/main` (as ruled); a defect in the island is fixed on this branch.

#### Optimisation Suggestions

- `planUpgrade.captured.test.ts`: build each confirm run's fresh read as the after-expiry capture re-identified with that experiment's subscription and customer ids (`{ ...AFTER_EXPIRY, id: update.id, customer: update.customer }`), and the row from it. Then a future "the update answer is for the subscription we asked about" check cannot break these tests for the wrong reason.
- After a successful upgrade the island stays hidden until a reload even if a higher tier is still offered (`!upgradeSucceeded`). Rare (three tiers) and harmless; a later slice can let the island return once "done" has been shown.
- In the endive / clover note (requirement §9.1.2 F-4): the D-W replay uses `stripe listen`, which delivers in the sandbox's default version (`2026-09-30.endive`), not the production endpoint's pinned version. D-W therefore proves the handlers, not the production endpoint's shape; that stays F-4's item.

#### QA focus

1. G-1: a Stripe.js throw and a returned non-refusal error after the challenge → "We could not confirm your upgrade" with Check again and Try again (same `prorationDate`), never "nothing changed"; a closed challenge and a card refusal → "not confirmed, nothing changed", Upgrade again → the Q-2 "waiting" line.
2. G-2: "You're on <plan>" only when all four terms hold; each term's absence keeps "Upgrading…" and ends in "taking longer than usual".
3. The secret: absent from the DOM, URL, `localStorage` / `sessionStorage`, every log call and every refusal body, in the fresh confirm and the Q-2 resume.
4. E-5 wording at 0, 1, 49, 50 cents; "excluding tax" on the due-now line only.
5. Refusals: every code reads its localised line in en / he / es, never the server's English; `upgrade_pending` with and without `retryAfter`; `upgrade_processing` / `not_an_upgrade` → "Upgrading…".
6. No publishable key: the price shows, no Confirm, no POST.
7. Q-5 note and Q-7 "Pay for" label only where the plan in force is a tier.
8. The matrix (view ↔ preview) and the captured suite green; rerun `npm run test:bos-entitlements` on the final diff.
9. T14 and D-W run by TL in one sandbox session, results and clean-up ids recorded (merge gates above).

#### Code Approved for QA: **Yes, after G-1 and G-2** (SA re-check of the fix diff), with G-3 in the same pass.

### SA diff look — P-7b.1b G-fixes (2026-10-14)

**Status:** ✅ **OK**. G-1 to G-3 are applied as asked. QA can start. This was a look at the fix diff only, not a new review.

| Item | Result |
|---|---|
| G-1 `classifyNextAction` (`PlanUpgrade.tsx`, exported) | ✅ Matches G-1 exactly. The status is taken from `paymentIntent`, and from `error.payment_intent` when `paymentIntent` is absent. `succeeded` / `processing` / `requires_capture` → `upgrading`. `requires_payment_method` / `requires_action` / `canceled`, `card_error`, or `payment_intent_authentication_failure` → `not_confirmed`. Anything else, including no status and an unrecognised status such as `requires_confirmation`, → `unknown`. A known status is checked before the error type, so an `api_connection_error` that carries a `succeeded` PaymentIntent reads as "Upgrading…", which is correct. A throw → `unknown`, with only `errName` logged. The inconclusive path logs `errType` / `errCode` only and never the result object, the PaymentIntent or the secret |
| G-1 tests | ✅ 6 render cases for unknown: a throw, `api_connection_error`, `api_error`, `rate_limit_error`, an unknown type and no status. Each asserts that "nothing changed" never shows and that Try again re-posts the same `prorationDate`. 4 render cases for not confirmed, including the closed challenge and a `canceled` PaymentIntent carried on the error. The Q-2 resume after "not confirmed" is covered. A 15-row table runs over the function |
| G-2 tests | ✅ (a) The target is in force and no longer offered, but billing is `cancelling`: no "You're on…", and it ends in "taking longer". This pins `renewing` (MS1). (b) Billing is `renewing` and the offer is null because the switches are off, but the plan in force is still the lower tier: no "You're on…". This pins `planId === upgradeTarget` (MS2). Each test asserts its premises (`planId`, `upgrade` null, `billing.state`) before it runs, so a fixture drift cannot leave it passing for nothing |
| Mutations | Dev reports 5 of 5 caught. SA applied MS2 (drop `plan?.planId === upgradeTarget`) with the Edit tool, but **the permission system did not allow the Jest run against the mutated file**. The file was restored by re-editing, and its md5 `98aa7bc2…` matches before and after. MS2 was therefore **not re-run by SA**. By reading the code, G-2 (b) kills it: with the term dropped, `succeeded` holds and the empty offer holds, so "You're on Essentials" would render, and the test asserts it does not. Dev's 5 of 5 is accepted on that reading. QA may re-run MS1 / MS2 if its permissions allow |
| `planUpgrade.captured.test.ts` (SA optimisation) | ✅ Sound. `freshReadFor(name)` gives the real E-4 after-expiry shape the experiment's own subscription id and customer id. `rowFor`, the `retrieve` mock (which throws on any other id) and `expectWriteTo` now all name the same subscription. The mocks are `mockReset` in `beforeEach`, so `calls[0]` belongs to the current test. The E-6 race reuses the replay's ids, which is correct because both come from the same subscription. Previews still run on `AFTER_EXPIRY` and assert its ids, which is consistent |
| G-3 docs | ✅ The Checks table has the G-1 / G-2 and mutation rows, deviation 5 is amended, and D3b in T14 records the real Stripe.js close result |
| Suites (SA run) | `components/business-os/settings` + `lib/business-os/billing`: **34 suites, 3,500 tests, green** |

Remaining merge gates are unchanged: T14 (including the D3b confirmation of G-1 against the real Stripe.js), D-W and G-5.

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

#### E-n: pending at P-7b.1a code complete, observed 2026-10-13 (the right column; first T1 was BLOCKED on the sandbox key and no Stripe call was made)

| # | What was pending | Where the code waits | If the answer differs | Observed 2026-10-13 (sandbox), and where it is pinned |
|---|---|---|---|---|
| **E-1** | How the payment state is read on clover. Today: a `paid` invoice is `succeeded` with no read; an `open` invoice uses its `payments` list when expanded, else ONE `invoicePayments.list({ invoice, expand: ['data.payment.payment_intent'] })`. Also unverified: that `expand: ['latest_invoice.confirmation_secret']` is accepted on `subscriptions.update`, the `createPreview` amount fields (`amount_due`, `total`, `total_taxes`), and the `pending_update` shape on the update's answer | `StripeService.upgradeInvoicePaymentState` (private seam), `upgradeBusinessOsPlanSubscription`, `previewBusinessOsPlanUpgrade` | Only the update's `expand` list or the seam changes; the outcome mapping does not. T2 was held at "code done" until E-1 answered | `expand: ['latest_invoice.confirmation_secret']` accepted; applied update: no pending update, invoice `paid` (no read); 3-D Secure: pending update, invoice `open`, no `payments` key, ONE `invoicePayments.list` → default payment, PaymentIntent `requires_action`. Expanding `latest_invoice.payments...payment_intent` is refused (`property_expansion_max_depth`), so the list read is permanent. Preview: `amount_due`, `total`, `total_taxes: []`. No code change. Pinned: `planUpgrade.captured.test.ts` E-1 rows, C-6 kinds `upgrade_response`, `invoice_payment`, `invoice_preview` |
| **E-2** | The decline shape: thrown `StripeCardError`, or a returned pending update with `requires_payment_method`. Both are mapped to `declined` and tested (V-7). Whether a returned decline keeps a pending update (and so `retryAfter`, Q-6) is unconfirmed | `confirmPlanUpgrade` | None in code; the UI line "You can try again after" depends on it | **Returned, not thrown**: the pending update is kept, invoice `open`, PaymentIntent `requires_payment_method` → `declined` + `retryAfter` = `expires_at`; the screen shows "You can try again after {time}" (Q-6). Stripe allows a second update over a pending one (it voids the first invoice); our `upgrade_pending` refusal is unchanged. Pinned: captured E-2 row |
| **E-3** | Captured $0 credit-balance upgrade invoice (`amount_paid` 0, `total` > 0, `paid`, no pending update) | U-3 matrix uses the hand-built proration fixture | A field not present would show in the C-6 ratchet | Preview `amount_due` 0 / `total` 3387; update applied, `confirmation_secret` null; invoice `paid`, `amount_paid` 0, `total` 3387 → CF-6 assigns. Pinned: captured E-3 rows (preview, confirm, `planInvoiceFacts`, webhook apply) |
| **E-4** | **U-6 / G-2**: what happens to an unpaid upgrade invoice when its pending update expires. Holds P-7b.1b's UI (T10). Also decides whether the Q-2 resume is safe up to the expiry | `resumable()` in `planUpgrade.ts` requires the invoice `open` and `requires_action` | If the invoice can be paid after expiry, Dev brings a design to SA before T10 | The unpaid upgrade invoice is **voided exactly at `expires_at`**; paying it or confirming its PaymentIntent afterwards fails; the price stays on the lower tier. **G-2 cleared**: U-4 stays a backstop; the Q-2 resume stays as built (it needs `open`). Pinned: captured E-4 rows (voided_at = expires_at; a void invoice is not resumable, no payment read) |
| **E-5** | Captured under-minimum upgrade invoice (`total` small, `amount_paid` 0) | U-3 matrix (hand-built `total: 30`) | As E-3 | Preview `amount_due` 14 (the preview applies no minimum); update applied; invoice `paid`, `amount_paid` 0, `total` 14, carried to the next renewal (12914) → CF-6 assigns. **User decision 2026-10-13 (option a)**: the screen reads "Nothing to pay now. {amount} will be added to your next bill." under 50 cents. Pinned: captured E-5 rows and `upgradeDueKey` |
| **E-6** | The in-flight idempotency conflict: error `type` and `code`. Mapped today (after SA F-2) by `code === 'idempotency_key_in_use'` → `upgrade_busy` whatever the error class; any other `StripeIdempotencyError` → alerted `stripe_error` | `confirmPlanUpgrade` catch | The code string to match (E-6 now confirms, it no longer decides) | In flight: `StripeInvalidRequestError`, `invalid_request_error`, code `idempotency_key_in_use`, 409, `stripe-should-retry: false` (the SDK does not retry it) → `upgrade_busy`; same key, other params: `StripeIdempotencyError` 400 → alerted `stripe_error`; identical replay after completion returns the first answer. Pinned: captured E-6 rows (the SDK rebuilds the class from the captured body) |
| **U-7 / G-3** | Captured upgrade objects in the C-6 ratchet: a subscription with `pending_update`, a paid `subscription_update` invoice (negative `basic` line, positive `pro` line via `pricing.price_details.price`), a failed one, the expired-update event. `CAPTURED_OBJECTS` unchanged until then | `planStripeFields.c6.test.ts` | — | **Done in P-7b.1b**: 39 `captured-p7b1-*.json` files; `CAPTURED_OBJECTS` gains `invoice_payment`, `invoice_preview`, `pending_update`, `stripe_error`, `upgrade_response` |
| **D-W** | The webhook rows of E-1 to E-5 replayed through local `stripe listen` | — | — | **Open: TL** (checklist in Implementation Notes (P-7b.1b)). The captured events already run through the real handlers in `planUpgrade.captured.test.ts` |

All Stripe answers in the P-7b.1a tests are hand-built and say so in each file's header; P-7b.1b adds the captured answers (`planUpgrade.captured.test.ts`) and the headers now point there.

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

### P-7b.1b "Upgrade in Settings" (Dev, 2026-10-13)

**Branch:** `feature/bos-plan-payments-p7b1b`, worktree `neuronforge-invite-s1`, fresh from `origin/main` `8014ee73` (P-7b.1a merged, PR #346); confirmed with `git branch --show-current`. Nothing committed (RM's job, after SA, QA and the user). No migration. No Stripe call and no database were used: every Stripe answer in the new tests is either hand-built (labelled) or one of the scrubbed sandbox captures.

#### Files

| File | Change |
|---|---|
| `lib/business-os/billing/planPurchaseTypes.ts` | `PlanUpgradeWire { tiers }`; `PlanPurchaseWire.upgrade` (import-free, W-6) |
| `lib/business-os/billing/planPurchaseView.ts` | `purchase.upgrade` from `planUpgradeOffer` over the SAME billing row, switches and buyable tiers (the routes' step 5). A failed billing read offers nothing. No Stripe, no new entitlements symbol |
| `components/business-os/settings/PlanUpgrade.tsx` (new) | The island (§3.7): preview, confirm, 3-D Secure via `getStripePromise()` + `handleNextAction`, Q-2 resume, outcomes, refusals by code, V-3 unknown (Check again / Try again on the same `prorationDate`), Q-5 note. The secret lives only in the handler's argument |
| `components/business-os/settings/planUpgradeCopy.ts` (new) | Refusal → key map typed over `PlanUpgradeRefusalCode` (type import), the re-read codes, `upgradeDueKey` (E-5 rule, `STRIPE_MINIMUM_CHARGE_MINOR` 50), USD and account-clock formatters, the two route paths |
| `components/business-os/settings/PlanSection.tsx` | Renders `PlanUpgrade`; "Upgrading…" and the bounded re-read on the shared `checkoutProcessing` constants; "You're on <plan>" only from the server; Q-7 `currentTierId` to `PlanPurchase` |
| `components/business-os/settings/PlanPurchase.tsx` | Q-7: the row of the plan in force (a tier) reads "Pay for {plan}" with the one-line note; label only |
| `lib/business-os/translations/{en,he,es}.ts` | 29 keys each (below) |
| `lib/stripe/StripeService.ts`, `lib/business-os/billing/planUpgrade.ts` | Comments only: the "pending E-1 / E-2" markers replaced by the observed answers |
| `lib/business-os/billing/__tests__/fixtures/stripe/captured-p7b1-*.json` (39 new) | U-7 captures (list below) |
| `lib/business-os/billing/__tests__/planStripeFields.c6.test.ts` | Loader reads SDK answers, `invoicePayments` lists and a captured error; 5 new object kinds with their field lists; `CAPTURED_OBJECTS` ratchet updated; the version check admits the endive events |
| `lib/business-os/billing/__tests__/planUpgrade.captured.test.ts` (new) | The real `StripeService`, preview/confirm, `planInvoiceFacts`, `applyPaidPlanInvoice` and `recordFailedPlanInvoice` over the captures (25 tests) |
| `lib/business-os/billing/__tests__/planUpgradeOffer.matrix.test.ts` (new) | View ↔ real preview, every our-data combination (2,089 tests incl. documented exceptions) |
| `components/business-os/settings/__tests__/PlanUpgrade.render.test.tsx` (new) | 48 tests (§7 "UI") |
| Tests touched | `planPurchaseView.test.ts` (+ upgrade block), `my-plan` route test (+1), `PlanPurchase.render.test.tsx` (Q-7 label helper), `planInvoiceResolver.test.ts` (fixture-version check), header comments in `planUpgrade.test.ts`, `planUpgradeEligibility.test.ts`, `planInvoiceFacts.test.ts`, `businessOsPlanUpgrade.test.ts`, the upgrade route test |
| Guards | `BusinessOsBillingAccountRepository.test.ts` and `BusinessOsBillingEventRepository.test.ts` list the captured test (it imports the row / apply TYPES); `enforcementPoints.test.ts` `planPurchaseView.ts` `why` re-checked (no new symbol) |
| Docs | This workplan; requirement §9.1 P-7b.1 row, P-6a row, U-10 (extended), Change History; `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` § Plan checkout + Change History |

#### User decision 2026-10-13 (E-5 wording, option a)

When the preview's `amountDueMinor` is above 0 and under 50 (Stripe's minimum charge), the quote reads **"Nothing to pay now. {amount} will be added to your next bill."** instead of "{amount} due now, excluding tax." E-5 showed why: the preview says 14 cents due, Stripe marks the invoice paid with nothing charged and adds the 14 cents to the next renewal. Key `plan.upgrade.due_later_small`; rule in `upgradeDueKey`; pinned at 0 / 1 / 49 / 50 and by a render test. Also recorded in the requirement (§9.1 P-7b.1 row, Change History).

#### U-7 / G-3: the captured fixtures

Copied from the scrubbed experiment output into `lib/business-os/billing/__tests__/fixtures/stripe/` as `captured-p7b1-<name>.json`. Each keeps Stripe's ids, prices, amounts, statuses and timestamps, and states its source and version in `_fixture_source` (starting `CAPTURED`). SDK answers carry no `api_version`, so they state theirs in `_fixture_api_version` (`2025-10-29.clover`, the pinned SDK); events keep their `api_version` (`2026-09-30.endive`, as the sandbox renders them).

| SDK answers (22) | Events (17) |
|---|---|
| `e1a-01-preview`, `e1a-02-update-response`, `e1a-04-invoicePayments-list`, `e1a-07-invoice-paid`, `e1b-01-update-response`, `e1b-02-invoicePayments-list`, `e1b-04-subscription-pending`, `e1b-06-subscription-after-pay`, `e2-01-update-response`, `e2-03-invoice`, `e3-01-preview`, `e3-02-update-response`, `e3-03-invoice`, `e4-01-update-response`, `e4-10-subscription-after-expiry`, `e4-11-invoice-after-expiry`, `e5-01-preview`, `e5-02-update-response`, `e5-03-invoice`, `e5-05-renewal-invoice`, `e6a-race-1`, `e6a-replay` | `e1a-event-invoice-paid-no3X5G`, `e1b-event-customer-subscription-pending_update_applied-DUk3sV`, `e1b-event-customer-subscription-updated-nRvRUW`, `e1b-event-customer-subscription-updated-Em1Qcy`, `e1b-event-invoice-paid-bd5SF4`, `e1b-event-invoice-payment_action_required-mSJfzg`, `e1b-event-invoice-payment_failed-PrF4oA`, `e2-event-customer-subscription-pending_update_expired-kVkUDA`, `e2-event-customer-subscription-updated-YXKbps`, `e2-event-invoice-payment_failed-tYXBde`, `e3-event-invoice-paid-Mm9iSs`, `e4-event-customer-subscription-pending_update_expired-zI3ljM`, `e4-event-customer-subscription-updated-fKUahQ`, `e4-event-invoice-payment_action_required-3pxFCe`, `e4-event-invoice-voided-GSGgyh`, `e5-event-invoice-paid-AVZ9jo`, `e5-event-invoice-paid-3OxITR` |

**Scrub re-check (Dev, on the 39 files as committed):** a scanner over every value found **no** email other than `fixture@example.invalid`, **no** URL other than `https://example.invalid/scrubbed`, **no** `sk_` / `rk_` / `pk_` / `whsec_` string, **no** `_secret_` value, every `client_secret` (incl. `confirmation_secret.client_secret`) equal to `scrubbed_secret` or null, no address, phone, IP address or `bos_user_id` value. Names: only `Test Customer` (account and customer name); descriptions are Stripe's proration lines ("Unused time on Essentials after …") and the experiment labels (`p7b1-exp e1a` …); price nicknames `bos basic/pro monthly usd`. The one card detail is the public test card's `last4` 0341 and its test fingerprint. One edit to Stripe's data: in `e6a-race-1` the scrubber's name rule had replaced `err.name` (the SDK class) with "Test Customer"; it is restored to `StripeInvalidRequestError` and the file's source line says so.

**C-6 ratchet:** `CAPTURED_OBJECTS` gains `invoice_payment`, `invoice_preview`, `pending_update`, `stripe_error`, `upgrade_response`, each with the fields the code reads (`invoice_preview`: `amount_due`, `total`, `total_taxes`, `currency`; `upgrade_response`: `id`, `livemode`, `pending_update`, `latest_invoice.{id,status,confirmation_secret}`; `pending_update`: `expires_at`, `subscription_items[].price.id`; `invoice_payment`: `is_default`, `payment.payment_intent.status`; `stripe_error`: `err.{type,code,statusCode}`, `raw.{code,type}`). Every captured invoice, line and subscription also passes the existing webhook field lists.

**The real code over the captures** (`planUpgrade.captured.test.ts`): E-1 preview amounts and the exact `createPreview` call; applied updates (E-1a, E-3, E-5, E-6 replay) → `upgraded` with no payment read; E-1b → one `invoicePayments.list` → `action_required` with the secret in no log or audit; E-2 → `declined` + `retryAfter` = `expires_at`; E-6 → the SDK rebuilds `StripeInvalidRequestError` / `idempotency_key_in_use` from the captured body → `upgrade_busy`, not audited; Q-2 resume over the E-1b pending subscription and open invoice (confirm resumes; preview answers awaiting with 3387, no secret); E-4 `voided_at` = `expires_at`, and a void invoice behind a pending update → `upgrade_pending`, no payment read, no write; `planInvoiceFacts` over all five captured `invoice.paid` events (pro, assigns, deciding price pro, CF-6 at `amount_paid` 0 for E-3 and E-5); webhook apply: E-1b paid with the after-pay subscription → applied with `billingReason`; with ITS pending update → `PlanPaymentRetryError`; E-1a against a captured lower-tier subscription → recorded without the plan, alerted once (U-4 case 2); E-3 / E-5 → applied at `amount_paid` 0; and the P-6a note: the E-1b `invoice.payment_failed` of an upgrade that succeeded records one `invoice_payment_failed` row and moves nothing.

#### Checks (final diff)

| Check | Result |
|---|---|
| Jest: `lib/business-os/billing`, `lib/business-os/entitlements`, `app/api/business-os/billing`, `app/api/business-os/entitlements`, `components/business-os`, `app/business-os`, `app/api/stripe`, `lib/stripe`, `lib/client`, `app/invite`, `lib/business-os/__tests__`, `lib/payments`, the two billing repository tests | **228 suites, 7,644 tests, all green** |
| New files alone | `planStripeFields.c6` 57, `planUpgrade.captured` 25, `planUpgradeOffer.matrix` 2,089, `PlanUpgrade.render` 48 (run 3 times, stable) |
| `npm run test:bos-entitlements` | **251 suites, 7,337 tests, green** |
| `npm run typecheck:bos-llm` | **Passed, 0 new** (518 files, 28 baseline; the same one baseline entry reported fixed, `app/api/onboarding/build/route.ts`, untouched) |
| `tsc` over every touched source and test (scratch tsconfig extending the project's) | 0 new. Reported only pre-existing items: duplicate translation keys at `en.ts` 2040-2054 / 4113 and `es.ts` 1947-1961 / 3872 (on `origin/main` too) and two unused `@ts-expect-error` in the `my-plan` route test (lines 515, 527, on `origin/main`) |
| ESLint on every touched code and test file | Clean |
| `npm run lint:hooks` | Clean |
| Mutations (each restored from a scratch copy; md5 identical before and after) | **3 of 3 caught.** M1 the view without `endedAt` (matrix + view test: 3 fail); M2 the section's success without "no longer offered" (Q-5: 2 fail); M3 Try again re-posting a different `prorationDate` (V-3: 3 fail) |
| **SA fixes G-1 / G-2 (Dev, 2026-10-13)** | **G-1** `PlanUpgrade.tsx`: `classifyNextAction` reads the `handleNextAction` answer. PaymentIntent status (from `paymentIntent`, else `error.payment_intent`) `succeeded` / `processing` / `requires_capture` → "Upgrading…" + re-read; `requires_payment_method` / `requires_action` / `canceled`, or `error.type === 'card_error'`, or `error.code === 'payment_intent_authentication_failure'` (a closed or failed challenge) → "not confirmed, nothing changed"; anything else (`api_connection_error`, `api_error`, `rate_limit_error`, an unknown type, no status) → unknown with Check again and Try again (same `prorationDate`). A throw from `handleNextAction` stays unknown. The inconclusive case logs `errType` / `errCode` only (never the result object, which can carry the PaymentIntent). Render tests: a throw, returned `api_connection_error` / `api_error` / `rate_limit_error` / unknown type / no status → unknown, never "nothing changed", Try again re-posts the same date (6); closed challenge (`invalid_request_error` + `payment_intent_authentication_failure` + `requires_payment_method`) and an error carrying a `canceled` PaymentIntent → not confirmed (added to the existing `card_error` / `requires_payment_method` cases); after "not confirmed", Upgrade again → the Q-2 "waiting" line, Confirm posts the fresh date and offers the same challenge; a 15-row table over `classifyNextAction`. **G-2** render tests on the U-5 terms: (a) target in force, no longer offered, billing `cancelling` (not `renewing`) → no "You're on…", ends in "taking longer"; (b) billing `renewing`, `purchase.upgrade` null (prices switch off), plan in force still the lower tier → no "You're on…". `PlanUpgrade.render` now 74 tests (was 48) |
| **SA mutations re-run after G-1 / G-2** (Edit-tool mutations, each restored by re-editing; md5 identical before and after: `PlanUpgrade.tsx` `005afae8…` (post-G-1), `PlanSection.tsx` `98aa7bc2…` (unchanged, as SA recorded)) | **5 of 5 caught** over `components/business-os/settings` (187 tests). **MB** a Stripe.js throw read as not confirmed → 1 fails (the G-1 throw test). **MS1** success without `succeeded` (`renewing`) → 1 fails (G-2 a). **MS2** success without `planId === upgradeTarget` → 1 fails (G-2 b). **MG1** every returned error read as not confirmed (the pre-G-1 behaviour) → 8 fail. **MG2** the `payment_intent_authentication_failure` term dropped → 1 fails (the table row with no PaymentIntent on the error) |
| **QA note 1: `upgrade_pending` without `retryAfter` pinned (Dev, 2026-10-13)** | New render test in `PlanUpgrade.render.test.tsx`, run on both the preview and the confirm path (2 cases): a 409 `upgrade_pending` with no `retryAfter` shows `plan.upgrade.refusal.pending_no_time` (en text), the line contains no `{`, and never the server's English. Mutations (Edit tool, restored by re-editing; `PlanUpgrade.tsx` md5 `005afae8…` and `planUpgradeCopy.ts` `dfa8b978…` identical before and after): **QA-M1** (branch removed, the timed line filled with an empty time) → 2 fail; **QA-M1b** (the unfilled timed template when there is no time) → 2 fail. `components/business-os/settings`: **4 suites, 189 tests, green** (was 187). `PlanUpgrade.render` now 76 tests |
| SA optimisation (captured test) | Applied. Each confirm run's fresh read is the E-4 after-expiry subscription re-identified with that experiment's own subscription and customer ids (`freshReadFor(name)`); the E-6 race uses the E-6 replay's ids. Each run now also asserts the write went to that subscription. `planUpgrade.captured` 25 / 25 green |
| Suites after G-1 / G-2 | `components/business-os/settings`, `lib/business-os/billing`, `app/api/business-os/billing`, `app/api/business-os/entitlements`: **37 suites, 3,634 tests, green**. `npm run test:bos-entitlements`: **251 suites, 7,337 tests, green**. `npm run typecheck:bos-llm`: passed, 0 new. `tsc` over `PlanUpgrade.tsx` and the two touched test files (scratch tsconfig): 0 new (only the pre-existing `en.ts` / `es.ts` duplicate keys). ESLint on the touched files: clean |
| `git diff --stat` | 25 tracked files modified (622 insertions, 79 deletions, this workplan included), no deletion-only file; new: 2 components, 4 test files, 39 fixtures |

#### he / es drafts for the user (G-5), verbatim

English is final for SA. The Hebrew and Spanish below are **drafts** for the user's approval before P-7b.1b merges.

| Key | English | Hebrew (draft) | Spanish (draft) |
|---|---|---|---|
| `plan.choose.button_own` | Pay for {plan} | תשלום עבור {plan} | Pagar {plan} |
| `plan.choose.own_plan_note` | You are on {plan} by arrangement with us. Paying starts a monthly subscription that replaces that arrangement. | התוכנית {plan} ניתנה לך בהסדר איתנו. תשלום פותח מינוי חודשי שמחליף את ההסדר הזה. | Tienes {plan} por un acuerdo con nosotros. Al pagar empieza una suscripción mensual que sustituye ese acuerdo. |
| `plan.upgrade.button` | Upgrade to {plan} | שדרוג ל־{plan} | Mejorar a {plan} |
| `plan.upgrade.previewing` | Working out the price… | מחשבים את המחיר… | Calculando el precio… |
| `plan.upgrade.due_now` | {amount} due now, excluding tax. | {amount} לתשלום עכשיו, לא כולל מס. | {amount} a pagar ahora, impuestos no incluidos. |
| `plan.upgrade.due_now_zero` | Nothing to pay now: your account credit covers it. | אין מה לשלם עכשיו: יתרת הזכות בחשבון מכסה את הסכום. | No hay nada que pagar ahora: el saldo a favor de tu cuenta lo cubre. |
| `plan.upgrade.due_later_small` | Nothing to pay now. {amount} will be added to your next bill. | אין מה לשלם עכשיו. {amount} יתווספו לחשבון הבא. | No hay nada que pagar ahora. Se añadirán {amount} a tu próxima factura. |
| `plan.upgrade.then` | Your plan renews on {date} at {price} a month. | התוכנית מתחדשת ב־{date} במחיר {price} לחודש. | Tu plan se renueva el {date} a {price} al mes. |
| `plan.upgrade.immediate` | You move to {plan} as soon as the payment goes through. | המעבר ל־{plan} מתבצע ברגע שהתשלום עובר. | Pasas a {plan} en cuanto se complete el pago. |
| `plan.upgrade.confirm` | Confirm upgrade | אישור השדרוג | Confirmar la mejora |
| `plan.upgrade.cancel` | Not now | לא עכשיו | Ahora no |
| `plan.upgrade.upgrading` | Upgrading… | משדרגים… | Mejorando tu plan… |
| `plan.upgrade.done` | You're on {plan}. | התוכנית שלך עכשיו: {plan}. | Ya tienes {plan}. |
| `plan.upgrade.declined` | Your card was declined, so nothing changed. You're still on {plan}. | הכרטיס נדחה, ולכן שום דבר לא השתנה. התוכנית שלך עדיין {plan}. | Tu tarjeta fue rechazada, así que no cambió nada. Sigues con {plan}. |
| `plan.upgrade.not_confirmed` | The payment was not confirmed, so nothing changed. You're still on {plan}. | התשלום לא אושר, ולכן שום דבר לא השתנה. התוכנית שלך עדיין {plan}. | El pago no se confirmó, así que no cambió nada. Sigues con {plan}. |
| `plan.upgrade.retry_after` | You can try again after {time}. | אפשר לנסות שוב אחרי {time}. | Puedes volver a intentarlo a partir del {time}. |
| `plan.upgrade.awaiting_confirmation` | Your upgrade is waiting for you to confirm the payment. | השדרוג ממתין לאישור התשלום שלך. | Tu mejora está esperando a que confirmes el pago. |
| `plan.upgrade.own_plan_note` | You have {plan} by arrangement with us. Upgrading makes it your paid plan from today. | התוכנית {plan} ניתנה לך בהסדר איתנו. שדרוג הופך אותה לתוכנית בתשלום החל מהיום. | Tienes {plan} por un acuerdo con nosotros. Al mejorar, pasa a ser tu plan de pago desde hoy. |
| `plan.upgrade.not_sure` | We could not confirm your upgrade. | לא הצלחנו לוודא את השדרוג. | No pudimos confirmar tu mejora. |
| `plan.upgrade.try_again` | Try again | לנסות שוב | Intentar de nuevo |
| `plan.upgrade.refusal.pending` | An upgrade is already waiting for payment. You can try again after {time}. | שדרוג כבר ממתין לתשלום. אפשר לנסות שוב אחרי {time}. | Ya hay una mejora pendiente de pago. Puedes volver a intentarlo a partir del {time}. |
| `plan.upgrade.refusal.pending_no_time` | An upgrade is already waiting for payment. Please try again later. | שדרוג כבר ממתין לתשלום. כדאי לנסות שוב מאוחר יותר. | Ya hay una mejora pendiente de pago. Inténtalo de nuevo más tarde. |
| `plan.upgrade.refusal.cancelling` | Your plan is set to end, so it cannot be upgraded. | התוכנית שלך מוגדרת להסתיים, ולכן אי אפשר לשדרג אותה. | Tu plan está programado para terminar, así que no se puede mejorar. |
| `plan.upgrade.refusal.not_active` | Your subscription is not active right now, so it cannot be upgraded. | המינוי שלך לא פעיל כרגע, ולכן אי אפשר לשדרג אותו. | Tu suscripción no está activa en este momento, así que no se puede mejorar. |
| `plan.upgrade.refusal.preview_expired` | The price needs checking again. Please press Upgrade once more. | צריך לחשב שוב את המחיר. כדאי ללחוץ שוב על השדרוג. | Hay que volver a calcular el precio. Pulsa de nuevo para mejorar. |
| `plan.upgrade.refusal.busy` | Your upgrade is already being processed. Please wait a moment. | השדרוג כבר בטיפול. כדאי לחכות רגע. | Tu mejora ya se está procesando. Espera un momento. |
| `plan.upgrade.refusal.unavailable` | Upgrading is not available right now. Please try again later. | שדרוג לא זמין כרגע. כדאי לנסות שוב מאוחר יותר. | La mejora de plan no está disponible ahora. Inténtalo de nuevo más tarde. |
| `plan.upgrade.refusal.support` | We could not upgrade your plan. Please contact support. | לא הצלחנו לשדרג את התוכנית. יש לפנות לתמיכה. | No pudimos mejorar tu plan. Contacta con soporte. |
| `plan.upgrade.refusal.generic` | Something went wrong. Please try again. | משהו השתבש. כדאי לנסות שוב. | Algo salió mal. Inténtalo de nuevo. |

"Check again" reuses `plan.purchase.check_again` (already approved). `{time}` is a day and a time on the account clock (for example "October 14, 09:05 AM"; Hebrew and Spanish use their own locale order), `{date}` a day on the account clock, prices in digits and USD (SR-15).

#### Deviations and decisions for SA

1. **The matrix test drives `previewPlanUpgrade`, not the HTTP handler**, as P-4's matrix drove `startPlanCheckout`. The route adds only the 404 switch, auth and the strict body in front of it (pinned by its own suite); "gets past step 5" = it reached Stripe's fresh subscription read. Both sides read the world through their own ports. Documented exceptions pinned: Stripe status `past_due`, Stripe cancelling, a pending update for another target, the late webhook (`upgrade_processing`), a different customer at Stripe, and the price check.
2. **Success is one term stricter than U-5's three**: the plan in force is the target, the record reads `renewing`, AND `purchase.upgrade` no longer lists the target. Without the last term, the Q-5 case (an admin-assigned top tier on a lower paid tier) would read "You're on Autopilot" before the webhook landed (mutation M2 shows the term is needed).
3. **`upgrade_processing` and `not_an_upgrade` go to "Upgrading…" and the re-read**, not a line. `not_an_upgrade` after the screen offered the upgrade means our record already pays for the target (the webhook landed between page load and press); the re-read then shows the plan. If it is ever something else, the bounded re-read ends in "This is taking longer than usual", never success.
4. **`not_subscribed` reads the `not_active` line** (the subscription ended or was never recorded between page load and press).
5. **Unknown is conservative on the confirm only (V-3)**: a 502 with `outcomeUnknown`, a 5xx without a code, a network failure after sending, an `action_required` without a secret, an unknown outcome, and a Stripe.js throw inside `handleNextAction` all read "We could not confirm your upgrade" with Check again and Try again. A preview failure reads the generic line (a preview writes nothing). A closed or failed challenge, or `requires_payment_method` after it, reads "not confirmed, nothing changed" (true by E-4: the invoice is voided at expiry and the price stays). Stripe.js not loadable after the confirm answered also reads "not confirmed". **Changed by SA G-1:** a returned Stripe.js error is "not confirmed" only when it is known to be a refusal (`card_error`, `payment_intent_authentication_failure`, or a PaymentIntent in `requires_payment_method` / `requires_action` / `canceled`); any other returned error reads "We could not confirm your upgrade" (see Checks).
6. **Check again (unknown) is ONE server re-read** (`onCheckAgain`), not the bounded loop, and the island stays unsure unless the server shows success; "Upgrading…" is never claimed for an unknown result. Try again re-posts the same `prorationDate` (mutation M3 pins it).
7. **New keys beyond §10**: `plan.upgrade.due_later_small` (the user's E-5 decision), `plan.upgrade.refusal.pending_no_time` (an `upgrade_pending` without `retryAfter`, so a `{time}` slot is never shown unfilled), `plan.upgrade.try_again` (the V-3 button). All three in the G-5 table.
8. **"You're still on {plan}"** names the plan in force (`plan.name`). In the rare Q-5 case that is the admin-assigned plan, which is still true.
9. **No Stripe.js key**: the preview still works (it needs none); the quote shows `plan.choose.not_configured` and no Confirm, so the confirm is never posted (M-2 pattern). Try again is also hidden then.
10. **Q-7** is a label and note only (`currentTierId`, set only when the plan in force is a tier). The existing P-4.2 render test now expects "Pay for <plan>" on the plan-in-force row (its default payload is an admin-assigned tier with no billing record, exactly the Q-7 case).
11. **Fixture plumbing**: the C-6 loader and the resolver test's version check were widened for SDK answers (`_fixture_api_version`), `invoicePayments` lists, a captured error, and the sandbox's endive events. Classification of SDK answers is by file name (`-preview`, `-update-response` / `-replay`). The captured test's confirm runs use the E-4 after-expiry subscription as the fresh read for every experiment (no pre-update read was captured for E-1a, E-3, E-5, E-6); each experiment's own update answer is the write's answer. **SA optimisation applied:** that fresh read now carries the experiment's own subscription and customer ids.
12. **E-2 forward point (SA) not acted on**: Stripe would accept "fix the card and try now" (a second update voids the first invoice), but our `upgrade_pending` refusal until expiry stays, as SA ruled; the declined line shows when.

#### D-W and T14: checklist for TL (not run by Dev)

Run on the **standard sandbox `acct_1UPKR4C7KDUGYIcA`** (test mode) only, the same day as the clean-up.

**Setup (local only, never committed)**

1. TL puts the sandbox keys in `.env.local` (secret key, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` `pk_test_…`, and the `whsec_…` that `stripe listen` prints as `STRIPE_WEBHOOK_SECRET`), and turns on `BUSINESS_OS_PLAN_CHECKOUT_ENABLED=true` and `BUSINESS_OS_PLAN_PRICES_ENABLED=true` locally. `npm run check-bos-plan-prices` passes against the sandbox.
2. `stripe listen` with explicit events (Stripe CLI 1.53 syntax), forwarding to the local webhook route:
   `stripe listen --events invoice.paid,invoice.payment_failed,invoice.payment_action_required,invoice.voided,customer.subscription.updated,customer.subscription.deleted,customer.subscription.pending_update_applied,customer.subscription.pending_update_expired,checkout.session.completed,checkout.session.expired --forward-to localhost:3000/api/stripe/webhook`
3. A designated test owner per scenario, on a non-champion account. Note each customer and subscription id for the clean-up list.

**D-W (webhook replay; P-7b.1a's rows)**

| # | Do | Expect |
|---|---|---|
| D-W1 | An owner on Essentials (bought with `4242`) upgrades with `4242` | `invoice.paid` (`subscription_update`) applied: plan row `pro`, `tier_expires_at` and `period_anchor` unchanged; money history one `invoice_paid` row; audit `BOS_BILLING_INVOICE_PAID` with `billingReason: subscription_update` |
| D-W2 | Card `4000002760003184` (3-D Secure always) set as the **subscription's** default payment method; upgrade; complete the challenge | `invoice.payment_failed` → one `invoice_payment_failed` row, nothing moved (the P-6a note); `invoice.payment_action_required` handled as today; `invoice.paid` → applied once Stripe shows the item on `pro` (if it lands while the pending update still waits on this invoice, the handler answers a retry and Stripe re-delivers) |
| D-W3 | Credit balance: `stripe customers update cus_… --balance=-20000`, then upgrade | `invoice.paid` with `amount_paid` 0, `total` > 0 → applied (CF-6) |
| D-W4 | Card `4000000000000341` attached and set as the **subscription's** default payment method; upgrade | `invoice.payment_failed` → one failed row; plan row stays `basic`; no banner (U-10) |
| D-W5 | Re-deliver an `invoice.paid` already applied (D-W1) through the listener (`stripe events resend <evt_id>`) | Replay: no new row, no alert, no audit |
| D-W6 (optional) | E-5 near the period end on a test-clock customer (advance to ~2 h before the end, then upgrade) | `invoice.paid` with `amount_paid` 0, `total` under 50 → applied (CF-6); the next renewal carries the cents |

**T14 (demo of P-7b.1b, §9 D0 to D7)**

| # | Do | Expect |
|---|---|---|
| D0 | Buy Essentials in Settings → Plan with `4242` | "You're on Essentials", "Renews on <date>" |
| D1 / D1a | Settings → Plan | "Upgrade to Autopilot"; pressing it shows "$NN.NN due now, excluding tax.", "Your plan renews on <same date> at $129 a month." |
| D1b | Confirm | "Upgrading…", then "You're on Autopilot." The sandbox charge equals the preview |
| D2 | `4000000000000341` as the subscription default; Upgrade → Confirm; then Upgrade again | "Your card was declined, so nothing changed. You're still on Essentials." + "You can try again after <time>"; the second press: "An upgrade is already waiting for payment. You can try again after <time>." |
| D3a | `4000002760003184` as the subscription default; Upgrade → Confirm → complete the challenge | The challenge in place, then "Upgrading…" → "You're on Autopilot." |
| D3b | Same, close the challenge; press Upgrade again. **Record what Stripe.js actually returns when the challenge is closed** (the `handleNextAction` result: `error.type`, `error.code`, and the PaymentIntent status on `error.payment_intent` or `paymentIntent`; browser devtools, never the client secret) **to confirm G-1's mapping** | "The payment was not confirmed, so nothing changed."; the second press shows "Your upgrade is waiting for you to confirm the payment." and Confirm offers the same challenge (Q-2). If the close reads "We could not confirm your upgrade" instead, G-1's mapping does not match the real Stripe.js: record the values and stop for Dev / SA |
| D4 | Credit balance covering the proration | "Nothing to pay now: your account credit covers it."; Confirm → Autopilot |
| D5 | Double click Confirm; then two tabs confirming together | One charge; the second answer is "Upgrading…" (`upgrade_processing` / `not_an_upgrade`) or "Your upgrade is already being processed." (`upgrade_busy`) |
| D6 | Leave a quote open 16 minutes, then Confirm | "The price needs checking again. Please press Upgrade once more."; a fresh preview works |
| D7 | Switch to Hebrew, then Spanish | Every new line translated (drafts); Hebrew right to left |
| D8 (optional) | E-5 near the period end (test clock) | "Nothing to pay now. $0.xx will be added to your next bill." |

**Clean-up, the same day:** cancel every sandbox subscription and delete the test customers and test clocks created for D-W and T14 (`stripe subscriptions cancel sub_…`, `stripe customers delete cus_…`, `stripe test_helpers test_clocks delete clock_…`); turn the local switches off and remove the sandbox keys from `.env.local`; `git diff` shows nothing in env files or `tierMatrix.ts`; record the ids and results in this section (TL).

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

### P-7b.1b "Upgrade in Settings"

**QA — 2026-10-13**
**Test mode:** full
**Strategy used:** A + B (Jest). Dev's suites, plus a **temporary QA render file of 71 tests** (`components/business-os/settings/__tests__/zzqa.p7b1b.temp.test.tsx`, deleted after the run). It reused the Dev render harness (the real plan view and the real `readPlanPurchaseView`, with routes faked at `fetch`) and added a recording `createLogger` mock, so every log call could be searched for the secret. QA also re-scanned the 39 fixtures and ran two mutations. No browser, no real database, no Stripe call.
**Focus:** ui, security (V-1 secret), schema (E-5, refusal map), i18n / RTL
**Skipped:** T14 and D-W (manual, sandbox). TL runs them with the user, from the run-sheet below
**Input source:** prompt keywords (TL brief) and SA "QA focus" 1 to 8

#### Suites run (worktree `neuronforge-invite-s1`, uncommitted, G-1 to G-3 applied)

| Check | Result |
|---|---|
| Jest: `components/business-os`, `lib/business-os/billing`, `lib/business-os/entitlements`, `app/api/business-os/billing`, `app/api/business-os/entitlements`, `app/business-os`, `app/api/stripe`, `lib/stripe`, `lib/client`, `app/invite`, `lib/repositories/__tests__` | **231 suites, 8,250 tests, all green** (final run). A combined md5 of the settings components, the billing sources and `StripeService.ts` was identical before and after this run. The first run of the same scope had **1 failure**, G-2 (b) ("You're on Essentials" shown). It ran while SA's parallel diff look had MS2 applied to `PlanSection.tsx` (mtime 21:00:22, then restored to md5 `98aa7bc2…`). So that run is an accidental **Jest confirmation that G-2 (b) kills MS2**, the run SA could not make. It is not a defect |
| `components/business-os/settings` alone, on the untouched sources | 4 suites, 187 tests, green |
| `npm run test:bos-entitlements` | **251 suites, 7,337 tests, green** |
| `npm run typecheck:bos-llm` | **Passed, 0 new** (518 files, 28 baseline; the same one baseline entry reported fixed, `app/api/onboarding/build/route.ts`, untouched) |
| `npm run lint:hooks` | **Clean** (exit 0) |
| QA temporary render file (deleted) | **71 / 71 passed** (coverage table below) |
| Fixture spot re-scan (39 `captured-p7b1-*.json`) | ✅ Emails: only `fixture@example.invalid` (26). URLs: only `https://example.invalid/scrubbed` (49). No `sk_` / `rk_` / `pk_` / `whsec_` value. `client_secret`: only `scrubbed_secret` (9), and no `_secret_` token. Names: `customer_name` / `account_name` `Test Customer`, plus the restored `StripeInvalidRequestError`. No phone, address line, postal code or IP address. `bos_plan_*` appears only as Stripe `product` ids and `lookup_key`s (configuration, not personal data). Every `metadata` is empty |
| Client imports | ✅ `PlanUpgrade.tsx` imports `react`, `lucide-react`, `LanguageContext`, `lib/client/stripeJs`, `lib/logger`, `./PlanPurchase` (type only), `./planPurchaseCopy` and `./planUpgradeCopy`. `planUpgradeCopy.ts` has one type-only import from `billing/planUpgrade`. `PlanSection.tsx` / `PlanPurchase.tsx` add no server import. No `server-only`, repository, `supabaseServer`, `lib/stripe/` or `console.*` in any of the four |
| P-4.2 purchase / P-5a.2 holding screen unchanged | ✅ `PlanEmbeddedCheckout`, `lib/client/stripeJs.ts` and every `app/` source are untouched; only two `app/` test files change. `PlanPurchase.tsx` changes the label and note only (`currentTierId`). The P-4.2 render test's edits only swap the expected label through `chooseLabel` (the Q-7 row), and the POST bodies it asserts are unchanged. The holding-screen suites (`app/business-os`, `app/invite`) are green |

#### Mutations (each by Edit tool, restored by re-editing, md5 identical before and after: `PlanUpgrade.tsx` `005afae8…`, `PlanSection.tsx` `98aa7bc2…`)

| # | Mutation | Dev suites (`components/business-os/settings`, 187) | QA file |
|---|---|---|---|
| QA-M1 | `upgrade_pending` without `retryAfter` reads `refusal.pending` with an empty `{time}` (the `pending_no_time` branch removed) | **Survived** (0 fail) | 4 fail (no-time × en / he / es, malformed time) |
| QA-M2 = SA MS1 | `upgradeSucceeded` without `renewing` (the `succeeded` term replaced by `status ok && kind tier`) | **Caught** (1 fail: G-2 (a)) | — |
| SA MS2 (incidental, see above) | `upgradeSucceeded` without `planId === upgradeTarget` | **Caught** (1 fail: G-2 (b)) | — |

#### Test Coverage (SA QA focus 1 to 8)

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| 1. G-1: a throw or a returned non-refusal error after the challenge → "We could not confirm your upgrade", Try again re-posts the SAME `prorationDate`; a closed challenge or card refusal → "not confirmed", then Upgrade again → the Q-2 waiting line | ✅ | Pass | Dev: 6 unknown cases, 4 not-confirmed cases, the Q-2 case after a close, and a 15-row table. QA added: `card_error` + `card_declined` → not confirmed → Upgrade again → waiting line. Check again with a **failing** re-read stays unsure, its button is enabled again, "nothing changed" is never shown, and Try again re-posts the same date |
| 2. "You're on <plan>" only when all four U-5 terms hold | ✅ | Pass | Dev's G-2 (a) / (b), Q-5 not-done and done, and failed re-reads. MS1 and MS2 are both caught under Jest (above) |
| 3. Secret absent from the DOM, URL, storage, logs and refusal bodies, on a fresh confirm and on the resume | ✅ | Pass | QA ran the fresh confirm four ways: completed, closed, transport error, and a throw whose `Error.message` contains the secret. QA also ran the Q-2 resume ending in an `api_error`. Each run asserts: the secret is in no `innerHTML` or `location.href`; no `localStorage` / `sessionStorage` value and no `setItem` call; no `router.replace`; and no recorded `createLogger` call from any module (the throw logs `errName` only, the inconclusive path `errType` / `errCode` only). A `stripe_error` refusal body carrying the secret in `error` and `details` renders the localized generic line only. The server side (refusal bodies, the 200 `awaiting` body) was pinned in the P-7b.1a QA |
| 4. E-5 wording at 0, 1, 49, 50 cents (decision a) | ✅ | Pass | Rendered in **en, he and es** at each point (12 cases): 0 → the zero line; 1 and 49 → "Nothing to pay now. $0.01 / $0.49 will be added to your next bill."; 50 → "$0.50 due now, excluding tax." No unfilled `{…}`. "Tax" (en `tax`, he `מס`, es `impuestos`) appears **only** on the due-now line |
| 5. Every refusal localized in en / he / es; `upgrade_pending` with and without a time; Hebrew RTL; `upgrade_processing` / `not_an_upgrade` → "Upgrading…" | ✅ | Pass | QA: every line-mapped code (14, incl. `not_available` and `invalid_input`) as a confirm refusal in each of the 3 languages (42 cases). Each shows the dictionary line and never the server's English. `upgrade_pending` without `retryAfter`, and with a malformed one → `pending_no_time`, no `{time}` (en / he / es). With `retryAfter` → the line with the account-clock time (en / he / es). A 401 → signed out. Hebrew declined line inside `dir="rtl"`, with no English. Dev covers the re-read codes and the he / es button and quote. **Note:** the no-time branch is not pinned by Dev's suite (QA-M1 survived), so see Edge case 1 |
| 6. No publishable key → price shows, no Confirm, no POST | ✅ | Pass | Dev: the quote. QA added the Q-2 awaiting state without a key: the line and the amount show, there is no Confirm, and nothing is posted |
| 7. Q-5 note and Q-7 "Pay for" only where the plan in force is a tier | ✅ | Pass | Dev: the Q-5 note on an admin-assigned top tier; Q-7 on an admin-assigned tier with no record; a trial without a record. QA added: the lower tier in force and paying → no note on either list; a trial (a cohort) with a paying record → no Q-5 note and no "Pay for" |
| 8. Matrix and captured suites green; `test:bos-entitlements` on the final diff | ✅ | Pass | `planUpgradeOffer.matrix` and `planUpgrade.captured` are inside the 231 / 8,250; entitlements 251 / 7,337 |
| P-4.2 purchase and P-5a.2 holding screen unchanged | ✅ | Pass | See Suites |
| Happy path + a failure path (CLAUDE.md minimum) | ✅ | Pass | — |
| Manual critical path (T14) and webhook replay (D-W) | ⬜ | Not run | Merge gates. TL and the user run them, using the run-sheet below |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. The island makes one POST per press (`inFlight` guard). Check again makes one re-read. The bounded re-read reuses the checkout's limits.

**Edge cases and observations:**
1. **Test gap: `upgrade_pending` without `retryAfter` is not pinned** (Low, tests only). The behaviour is correct (QA's temporary tests pass in all three languages), but QA-M1 survived all 187 Dev tests in `components/business-os/settings`. The only cover is the key-presence check. Recommend one render test before commit: the preview refuses `upgrade_pending` with no `retryAfter` → `plan.upgrade.refusal.pending_no_time`, and no `{` in the line. QA's version is in this report's history.
2. **Secret-in-logs is pinned by a source regex only** in the Dev suite (`logger.\w+(…clientSecret`). QA's recording logger confirms nothing leaks today, including a thrown `Error` whose message holds the secret. A behavioural log assertion would be stronger. Optional.
3. **After "You're on <plan>", the island stays hidden until a reload** (SA optimisation, already recorded). Harmless with two buyable tiers.
4. **Parallel QA and SA mutation runs share one worktree.** An SA mutation was live during QA's first run, and that run failed for it. Future cycles should run one at a time, or have each check its md5 before and after.

#### Run-sheet: T14 + D-W in one sandbox session (TL with the user)

Refines the Dev checklist above into one order. Every step is test mode on the **standard sandbox `acct_1UPKR4C7KDUGYIcA`** only. **Local development uses the PRODUCTION database**, so use test accounts only (never a champion or a real customer). Start in the morning: cleanup must finish the same day. Record each id in the table at the end of this section.

**Accounts (5 Business OS test owners, each non-champion, with no billing record yet).** A: D0, D1, D1b, D-W1, D-W5, D7. B: D2 / D-W4. C: D3b then D3a / D-W2. E: D4 / D-W3. F: D6 then D5. Each one first buys Essentials through P-4.2 (step 3). If fewer accounts are available, the order below still holds, but every scenario needs an owner who is on a **paid Essentials subscription with no pending update**.

**0. Pre-checks (stop if any fails)**
1. In the Dashboard, sandbox `acct_1UPKR4C7KDUGYIcA` → Developers → Webhooks: **no hosted endpoint forwards to production**. If one exists, stop: production would receive these events too.
2. The worktree is on `feature/bos-plan-payments-p7b1b` (`git branch --show-current`), and `git status` shows the uncommitted P-7b.1b diff. Do not stash or check out.
3. Port 3000 may be in use by another dev server. If it is, use **3100** everywhere below.

**1. Local setup (Git Bash, in `neuronforge-invite-s1`; nothing printed, nothing committed)**
1. Build `.env.local` from the main checkout, without the Stripe and switch lines, then add the sandbox secret key from the key file (the key is not printed):
   `grep -vE '^(STRIPE_SECRET_KEY|NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_CONNECT_WEBHOOK_SECRET|BUSINESS_OS_PLAN_PRICES_ENABLED|BUSINESS_OS_PLAN_CHECKOUT_ENABLED)=' ../neuronforge/.env.local > .env.local`
   `grep '^STRIPE_SECRET_KEY=' C:/Users/Barak/stripe-test.env >> .env.local`
2. **The publishable key must be supplied by the user** (it is not in the key file). In the Dashboard, sandbox → Developers → API keys, copy the `pk_test_…` and add one line to `.env.local` in an editor: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…`. It must be the same sandbox as the secret key.
3. Add `BUSINESS_OS_PLAN_CHECKOUT_ENABLED=true` and `BUSINESS_OS_PLAN_PRICES_ENABLED=true`.
4. Verify by counts only. Each command must print `1`:
   `grep -c '^STRIPE_SECRET_KEY=sk_test_' .env.local`
   `grep -c '^NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_' .env.local`
   `grep -c 'sk_live_\|pk_live_' .env.local` must print `0`.
5. Prices match: `npm run check-bos-plan-prices -- --env C:/Users/Barak/stripe-test.env --expect-account acct_1UPKR4C7KDUGYIcA` → VERDICT PASS.
6. Stripe CLI against the sandbox without printing the key: `export STRIPE_API_KEY="$(sed -n 's/^STRIPE_SECRET_KEY=//p' C:/Users/Barak/stripe-test.env)"`. Then add the CLI's signing secret: `echo "STRIPE_WEBHOOK_SECRET=$(stripe listen --print-secret)" >> .env.local`. This is the CLI `whsec`, not the Dashboard one.
7. Terminal 1, the listener with explicit events (use port 3100 if 3000 is busy). Keep it open all session:
   `stripe listen --events invoice.paid,invoice.payment_failed,invoice.payment_action_required,invoice.voided,customer.subscription.updated,customer.subscription.deleted,customer.subscription.pending_update_applied,customer.subscription.pending_update_expired,checkout.session.completed,checkout.session.expired --forward-to localhost:3000/api/stripe/webhook`
8. Terminal 2: `npm run dev` (or `npx next dev -p 3100`). Browser: `/business-os/settings?section=plan`. Devtools Console open, with **Preserve log** on.

**2. Read-only SQL (Supabase SQL editor, production).** Pasted as written: no `--` comments, no punctuation inside a string literal (the only literal is `'billing'`), and never the word "into" (the editor breaks on it). Run **Q1–Q3 after every scenario** and note the rows of that scenario's owner (match by `user_id`, which you get from Q1 after D0).

```sql
select user_id, livemode, subscription_status, bought_tier, cancel_at_period_end, current_period_end, last_invoice_id, last_paid_at, failed_attempts, ended_at, updated_at
from business_os_billing_accounts
where livemode = false
order by updated_at desc
limit 6;
```

```sql
select p.user_id, p.tier, p.tier_expires_at, p.period_anchor, p.updated_at
from business_os_account_plans p
join business_os_billing_accounts b on b.user_id = p.user_id
where b.livemode = false
order by b.updated_at desc
limit 6;
```

```sql
select user_id, kind, tier, plan_written, amount_minor, stripe_invoice_id, stripe_event_id, created_at
from business_os_billing_events
where livemode = false and created_at > now() - make_interval(hours => 12)
order by created_at desc
limit 30;
```

Q4 (D-W5 and the end of the session: one row per event, no duplicates):

```sql
select stripe_invoice_id, kind, count(*)
from business_os_billing_events
where livemode = false and created_at > now() - make_interval(hours => 12)
group by stripe_invoice_id, kind
order by stripe_invoice_id;
```

Q5 (audit; `billingReason` on invoice-paid, upgrade requests):

```sql
select action, user_id, created_at, details
from audit_trail
where created_at > now() - make_interval(hours => 12) and position(upper('billing') in action) > 0
order by created_at desc
limit 40;
```

**3. Scenarios, in this order**

| Step | Account | Do | Expect (screen) | Expect (Q1–Q5) |
|---|---|---|---|---|
| R0 = D0 | A–F | Buy Essentials in Settings → Plan with `4242 4242 4242 4242` (P-4.2). Note `cus_` and `sub_` from the Stripe Dashboard | "You're on Essentials", "Renews on <date>" | Q1 `active` / `basic`; Q2 tier `basic`; Q3 one `invoice_paid`. **Record A's `tier_expires_at` and `period_anchor`** |
| R1 = D7 | A | Before upgrading: switch the language to Hebrew, press Upgrade, then Not now; then Spanish, the same | Every new line translated (he / es drafts, G-5); Hebrew right to left; prices in `$` digits | Nothing new |
| R2 = D1 / D1a | A | English. Press "Upgrade to Autopilot" | "$NN.NN due now, excluding tax." and "Your plan renews on <same date as R0> at $129 a month." | Nothing new (a preview writes nothing) |
| R3 = D1b = D-W1 | A | Confirm | "Upgrading…", then "You're on Autopilot." In Stripe, the charge equals the preview | Q1 `bought_tier` `pro`; Q2 tier `pro` with **`tier_expires_at` and `period_anchor` unchanged from R0**; Q3 one `invoice_paid` for the `subscription_update` invoice; Q5 `BOS_BILLING_UPGRADE_REQUESTED` and `BOS_BILLING_INVOICE_PAID` with `billingReason` `subscription_update`. **Record the `evt_` of that `invoice.paid`** from the listener output |
| R4 = D-W5 | A | `stripe events resend <evt_ from R3>` (the listener must be running; if the CLI asks for an endpoint, use Dashboard → Events → the event → Resend to the CLI listener) | Nothing on screen | Listener shows a 200; Q4 still **one** `invoice_paid` for that invoice; no new Q5 row and no alert in the dev log |
| R5 = D2 = D-W4 | B | `stripe payment_methods attach pm_card_chargeCustomerFail --customer cus_B` (card 0341), then `stripe subscriptions update sub_B --default-payment-method pm_…` (the id returned). Upgrade → Confirm. Then press Upgrade again | "Your card was declined, so nothing changed. You're still on Essentials." and "You can try again after <time>". The second press: "An upgrade is already waiting for payment. You can try again after <time>." | Q1 stays `basic`; Q3 one `invoice_payment_failed`, plan not moved; no banner (U-10) |
| R6 = D3b | C | `stripe payment_methods attach pm_card_authenticationRequired --customer cus_C` (card 3184), then set it as the **subscription** default as in R5. Upgrade → Confirm → **close the challenge**. In devtools, record what `handleNextAction` returned: `error.type`, `error.code` and the PaymentIntent status. If no value is visible, set a breakpoint in `authenticate` in `PlanUpgrade.tsx` and read `result`. **Never copy the client secret** | "The payment was not confirmed, so nothing changed. You're still on Essentials." **If it reads "We could not confirm your upgrade" instead, stop and give Dev / SA the three recorded values** (G-1 does not match the real Stripe.js) | Q1 still `basic`; Q3 one `invoice_payment_failed` (3-D Secure, harmless per the P-6a note) |
| R7 = D3b (resume) → D3a = D-W2 | C | Press Upgrade again → Confirm → **complete** the challenge | The waiting line "Your upgrade is waiting for you to confirm the payment." and the amount; Confirm opens the same challenge (Q-2); after completing it, "Upgrading…" then "You're on Autopilot." | Q3 `invoice.payment_action_required` handled, then one `invoice_paid`; Q1 / Q2 `pro`. A retry answer followed by Stripe redelivery is acceptable if the paid event arrives while the pending update still waits |
| R8 = D4 = D-W3 | E | `stripe customers update cus_E --balance=-20000` (a $200 credit). Upgrade | "Nothing to pay now: your account credit covers it."; Confirm → "You're on Autopilot." | Q3 `invoice_paid` with `amount_minor` 0, plan written (CF-6); Q2 `pro` |
| R9 = D6 | F | Upgrade, leave the quote open **16 minutes**, then Confirm. Then press Upgrade again but **do not** confirm (press Not now) | "The price needs checking again. Please press Upgrade once more."; the fresh preview shows a price | Nothing written |
| R10 = D5 | F | Upgrade, then double click Confirm. Then a second tab on the same page: press Upgrade and Confirm in both tabs within a second | One charge in Stripe; the second answer reads "Upgrading…" or "Your upgrade is already being processed." Never two invoices | Q4: one `invoice_paid` for F's upgrade invoice |
| R11 = D8 / D-W6 (optional, does not gate) | new test-clock customer | E-5 near the period end | "Nothing to pay now. $0.xx will be added to your next bill." | `invoice_paid` with `amount_minor` 0 |

**4. Pass rule.** Every row's screen and SQL expectations hold, R6 reads "not confirmed", and the three Stripe.js values from R6 are recorded. Any mismatch: stop, record it, and do not clean up the failing account until Dev has looked at it (still the same day).

**5. Same-day cleanup**
1. For each account A to F: `stripe subscriptions cancel sub_…`, then `stripe customers delete cus_…`. Delete any test clock: `stripe test_helpers test_clocks delete clock_…`.
2. Stop `stripe listen` and the dev server. `unset STRIPE_API_KEY`.
3. **Delete `neuronforge-invite-s1/.env.local`** (it did not exist before this session). `git status` must show no env file, and `git diff --stat` must show nothing in `tierMatrix.ts` or in any env file.
4. Q1 after cleanup shows each test row `canceled` or ended, once the `customer.subscription.deleted` events land (keep the listener running until they do).
5. Record in this section: the account `user_id`s; each `cus_`, `sub_`, `in_` and `evt_` used; the R6 Stripe.js values; and the result of each row.

| Step | Account / ids | Result |
|---|---|---|
| R0–R11 | (TL fills in) | |

#### Test Outputs / Logs

```text
Jest (11 scopes, final):    Test Suites: 231 passed, 231 total   Tests: 8250 passed, 8250 total
Jest (11 scopes, 1st run):  1 failed (G-2 (b)) while SA's MS2 mutation was live in PlanSection.tsx; not a defect
settings alone (clean):     Test Suites: 4 passed, 4 total       Tests: 187 passed, 187 total
test:bos-entitlements:      Test Suites: 251 passed, 251 total   Tests: 7337 passed, 7337 total
typecheck:bos-llm:          518 files in scope, 28 errors, 0 new (268.5s) - passed
lint:hooks:                 exit 0
QA temporary file:          Tests: 71 passed, 71 total (deleted)
QA-M1 (pending no-time):    Dev settings suites 187/187 PASS (survived); QA file 4 failed; restored md5 005afae8...
QA-M2 = MS1 (no renewing):  1 failed (G-2 (a)); restored md5 98aa7bc2...
```

#### Final Status
- [x] Every acceptance criterion testable without a browser passes. **Verdict: PASS WITH NOTES.** No bug. Edge case 1 (an untested no-time branch) is a test to add before commit, recommended and Low. The merge gates are unchanged: T14 and D-W, run from the run-sheet above in one sandbox session (R6 confirms G-1 against the real Stripe.js), and G-5 (the user approves the he / es drafts)
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
| 2026-10-13 | P-7b.1b "Upgrade in Settings" code complete (Dev) | On `feature/bos-plan-payments-p7b1b` from `origin/main` `8014ee73` (P-7b.1a merged #346), uncommitted. T9 to T11 done; T12/T13 done for P-7b.1b; T1/T2 marked done (E-1 to E-6 observed 2026-10-13); every "pending E-n" marker in code and this workplan replaced by the observed answer. `purchase.upgrade` in the view (matrix test view ↔ preview, 2,089 cases), `PlanUpgrade` island + `planUpgradeCopy.ts`, `PlanSection` "Upgrading…" re-read, Q-5 and Q-7 notes, en/he/es (he/es drafts, G-5). **User decision 2026-10-13 (E-5 wording, option a)** recorded. U-7 / G-3: 39 scrubbed captures in the C-6 ratchet, the real code run over them (25 tests). P-6a forward note recorded in the requirement (U-10 extended). D-W and T14 checklist written for TL. Deviations for SA in Implementation Notes (P-7b.1b) |
| 2026-10-13 | SA code review of P-7b.1b: APPROVED WITH FIXES (SA) | Suites rerun green (110 / 5,603; `test:bos-entitlements` 251 / 7,337). Fixture scrub re-scanned clean; no "pending E-n" marker left in code; 29 keys in en / he / es; V-1, V-3 Try again, Q-2, Q-5 to Q-7 and the E-5 rule (0 < amount < 50) verified. 2 of 5 SA mutations caught. G-1 Medium: a returned Stripe.js error that is not a refusal must read "could not confirm", not "nothing changed" (V-3 on the client). G-2 Medium (tests): pin the `renewing` and `planId === target` terms of the upgrade success (mutations MS1 / MS2 survived). G-3 docs, incl. T14 D3b records the real Stripe.js close result. Deviations 1–12 accepted (5 changed by G-1). Merge gates for P-7b.1b: G-1 / G-2, T14 and D-W (one sandbox session; D-W6 / D8 optional), G-5 |
| 2026-10-13 | P-7b.1b SA fixes G-1 to G-3 applied (Dev) | G-1: `classifyNextAction` in `PlanUpgrade.tsx` (confirmed statuses → "Upgrading…"; `card_error`, `payment_intent_authentication_failure` or a refused / cancelled PaymentIntent → "not confirmed"; any other returned error, no status, or a throw → unknown with Check again / Try again, same `prorationDate`). G-2: two render tests pin the `renewing` and `planId === target` success terms. SA mutations re-run: MB, MS1, MS2 and Dev's MG1 / MG2 all caught (5 / 5), files md5-restored. SA optimisation applied in `planUpgrade.captured.test.ts` (per-experiment fresh-read ids, write target asserted). G-3: Checks table, deviations 5 and 11, T14 D3b now records the real Stripe.js close result. Suites: 37 / 3,634; `test:bos-entitlements` 251 / 7,337; `typecheck:bos-llm` 0 new; ESLint clean. Uncommitted; awaiting SA re-check, then QA |
| 2026-10-13 | QA of P-7b.1b: PASS WITH NOTES (QA) | 231 suites / 8,250 tests green (11 scopes); `test:bos-entitlements` 251 / 7,337; `typecheck:bos-llm` 0 new; `lint:hooks` clean. A temporary QA render file (71 tests, deleted) covered the secret with a recording logger on the fresh confirm and the resume, E-5 at 0 / 1 / 49 / 50 in en / he / es, every refusal in 3 languages, `upgrade_pending` with and without a time, Check again on a failed re-read, and the no-key Q-2 state. Mutations: MS1 caught; MS2 caught incidentally (SA's live mutation during QA's first run); QA-M1 (`pending_no_time` branch) survived the Dev suite, so the test is recommended before commit (Low). Fixture re-scan clean. No bug. The T14 + D-W run-sheet for TL and the user is in the QA section |
| 2026-10-13 | QA note 1 applied (Dev) | Test only: one render test (preview and confirm, 2 cases) pins `upgrade_pending` without `retryAfter` → `plan.upgrade.refusal.pending_no_time`, no `{` in the line. QA-M1 now caught (2 fail), as is a variant that shows the unfilled timed template; files md5-restored. `components/business-os/settings` 4 / 189 green. No source change. Uncommitted |
