# Workplan: Business OS Plan Payments, P-4 (Buy button in Settings → Plan)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): F1 (and the F10 note); §9.1 P-4 row; §9.1.2 "Findings from the user's Stripe test-account session" (F-1, F-2, F-5, the standard sandbox); §9.1.1 N-4, N-5 (as updated 2026-10-12); §10.4 **BQ-P10** (decided "Refuse until end date set"); PF-7; SR-5, SR-8, SR-11, SR-15, SR-16, SR-17; AC-F1.1 to AC-F1.5; and **"SA Ruling — P-4 and P-7b.1 sequencing (2026-10-12)"**, R-4 must-fixes **M-1 to M-9** and the CF-6 placement.
**Depends on:** P-3b merged (#251, #299); P-5a merged (P-5a.1 #314, **P-5a.2 #327**), whose `PlanEmbeddedCheckout`, `lib/client/stripeJs.ts`, return marker, bounded refresh and `heldPaymentOffer` pattern this slice reuses.
**Date:** 2026-10-13
**Branch:** `feature/bos-plan-payments-p4`, worktree `neuronforge-invite-s1`, fresh from `origin/main` `28d64b02` (#327). Confirmed with `git branch --show-current` on 2026-10-13. Uncommitted.
**Status:** SA **APPROVED WITH CONDITIONS** 2026-10-13 (W-1 to W-12; two PRs, P-4.1 then P-4.2). **P-4.1 Code Complete** 2026-10-13 (uncommitted); **SA code review: CODE APPROVED** 2026-10-13, ready for QA. P-4.2 not started.

## Overview

P-4 lets an owner buy a plan from **Settings → Plan**. Today that section is read-only: it shows the current plan and, as information, the plan above. After P-4, when buying is switched on, it lists every plan that is shown to customers and on sale, each with its price "a month, excluding tax" and a **Choose** button. Choose opens Stripe's embedded checkout in the page. After paying, the owner sees "Payment processing" until the server re-read shows the new plan, then "You're on Essentials" with "Renews on <date>".

Nothing on the screen is decided in the browser. One server predicate decides what may be bought, and both the screen and the checkout route use it, so the screen never offers what the server would refuse. That is the same rule P-5a.2 set for the holding screen (D5-3).

P-4 also hardens the shared checkout, as SA required:

- `availableToBuy` is enforced on the server (M-1);
- a Founding Partner whose free access has no end date is refused (BQ-P10);
- a form closed mid-checkout no longer blocks buying for 31 minutes (M-3);
- the publishable key is checked before anything is opened (M-2);
- there is one Stripe.js loader on the billing surface (M-4).

**Nothing changes in production after merge.** `availableToBuy` is `false` for both tiers, and both payment switches (`BUSINESS_OS_PLAN_CHECKOUT_ENABLED`, `BUSINESS_OS_PLAN_PRICES_ENABLED`) are off there. The section then looks exactly as it does today.

**Size: about 4 dev-days.** That is over SA's 2.5 to 3 days, because BQ-P10 and F-2 were added after the ruling. A split into two PRs is proposed in §10.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope](#2-scope)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Gates](#5-gates)
6. [Task List](#6-task-list)
7. [Tests](#7-tests)
8. [Demo Plan](#8-demo-plan)
9. [i18n and RTL](#9-i18n-and-rtl)
10. [Sizing and Split](#10-sizing-and-split)
11. [Risks](#11-risks)
12. [Rollout and Rollback](#12-rollout-and-rollback)
13. [Questions for SA](#13-questions-for-sa)

---

## 1. Analysis Summary

As-built on `origin/main` `28d64b02`, read for this workplan:

| Area | As built | What P-4 needs |
|---|---|---|
| Settings → Plan (`components/business-os/settings/PlanSection.tsx`) | Client component. Fetches `GET /api/business-os/entitlements/my-plan` and renders it. "It renders; it does not decide." The plan above is shown as information. `availableToBuy` only switches a "Coming soon" badge to "Available to choose." There is no button | A Choose list, the embedded checkout, a processing state and the result. Still rendering only what the server sends (M-5) |
| `customerPlanView.ts` (entitlements, `server-only`) | `nextPlanUp` only: one plan, from `nextPlanIdFor`. It is `null` for a Founding Partner (who already has more than Essentials) and whenever the basis is neither a tier nor a cohort. **A paused or expired tier account** resolves with `basis: tier` (A-1 in `lifecycle.ts`), so its "next plan" is the tier **above**: it could not re-buy its own plan. For a tier, `endsWhen` is the dateless key `plan.ends.while_paid`; `accessEndsAt` (the paid-through date) is in the payload | Every plan with `shownToCustomers` (and its `availableToBuy`), with its price, independent of the account's basis (M-5). The paused/expired case is covered by listing every plan, not "the next one" |
| `my-plan` route | Accepts no input at all, by design (tenant isolation is structural; a guard test asserts it reads no query and no body). Reads the snapshot and the reader's locale | Adds the purchase state: our billing record (session user, server key's mode), the switches, the hold, and the shared predicate. Still no input (SR-8, SR-11: no Stripe call) |
| Checkout service (`planCheckout.ts`) | Steps 4 to 14 (P-3a). Non-held accounts may buy **every tier with a Stripe price** (`sellableTiers()`), so a direct POST buys a tier that is "not on sale". Step 9 refuses `checkout_open` while the account's own lock is unexpired (up to 31 min after a closed form). The snapshot port reads only `unavailable` and `resolution.anomaly`. **No cohort check**: a Founding Partner can buy, and loses Founding Partner while the tier is in force (§9.1.2 F-1) | M-1, M-3, BQ-P10 (§3.1 to §3.3) |
| Eligibility (`planCheckoutEligibility.ts`) | `heldPaymentOffer` is the one predicate for the holding screen's Pay button and the held checkout (P-5a.2). Non-held → `sellableTiers()` | A second shared predicate for non-held accounts (§3.1) |
| Checkout route | Strict Zod `{ tier, returnTo }`; `returnTo: 'settings_plan'` already exists and returns to `/business-os/settings?section=plan&checkout={CHECKOUT_SESSION_ID}` | **No contract change.** Two new refusal codes arrive through `PLAN_CHECKOUT_REFUSALS` |
| `PlanEmbeddedCheckout.tsx` (P-5a.2) | POSTs first, then mounts the frame. Shows "not configured" only after the POST, so a missing publishable key still opens a session and takes the SR-5 lock (SA O-1) | M-2 (§3.5) |
| `lib/client/stripeJs.ts` (P-5a.2) | One loader; no key-shape check. `BoostPackagesPanel.tsx` still has its own `loadStripe` with a `pk_(test|live)_` check | M-4 (§3.5). `components/website/blocks/StripePaymentForm.tsx` is **not** touched (Connect money, SR-10) |
| Return and processing (P-5a.2) | `checkoutReturnMarker.ts` (pattern check, display only); `PaymentProcessingRefresher` (4 s × 15) on the holding screen; release only from the server re-read | The same pattern in Settings (M-6), with the refresh constants shared rather than copied |
| Champion / Founding Partner (`config/cohorts.ts`, `lifecycle.ts`) | `champion` has **no `durationHistory`**: its end is set per account by an admin (`cohort_expires_at`), NULL = open-ended. A tierless champion resolves `basis: cohort`, `lifecycle.accessEndsAt = cohort_expires_at`. A live tier beats the cohort; when the tier expires and the cohort is still live, the cohort resumes (A-1). The apply function (20261028) never writes `cohort` | BQ-P10 can be decided structurally, with no cohort name in code (§3.2). F-3 (return to Founding Partner) looks right in code; SA confirms it (requirement §9.1.2) |
| `availableToBuy` (`config/tierMatrix.ts` `presentation`) | `false` for both tiers. The schema refuses `availableToBuy && !shownToCustomers`. `productionConfig.test.ts` pins both to `false` | Read by the server predicate. Flipped **locally only** for demos (as `paidInvitesAvailable`); never committed |
| `/test-business-os` `PlanCheckoutPanel` | Offers every tier in `TIER_ORDER` and calls the same route with `returnTo: 'test_harness'` | Not changed. **Side effect (M-1, BQ-P10):** the harness can buy only a tier with `availableToBuy` on, and a Founding Partner with no end date is refused there too. The user's current test account is a champion (§9.1.2) |

**Platform phase touched:** none of the V6 pipeline. This is Business OS billing, the entitlements view, and one Settings component.

**Deprecated patterns found:** none in the files touched. No `console.*` in any of them (checked: `PlanSection.tsx`, `customerPlanView.ts`, `planCheckout.ts`, `planCheckoutEligibility.ts`, `PlanEmbeddedCheckout.tsx`, `stripeJs.ts`, `BoostPackagesPanel.tsx` and the two routes all use `createLogger` or log nothing).

---

## 2. Scope

| In | Out (and where it lives) |
|---|---|
| Choose buttons in Settings → Plan for every plan shown to customers and on sale, with price and "excluding tax" (F1, M-5, M-8) | Upgrade for an account that already pays (P-7b.1; CF-6 moved there) |
| The embedded checkout, the return marker, a bounded re-read, then "You're on <plan>" with the renewal date (M-6) | Cancel, reactivate, card and invoices (P-7a) |
| "Renews on <date>" / "Ends on <date>" from our billing record (F-2) | The founder discount and trial-to-end-date start for Founding Partners (P-11) |
| `availableToBuy` enforced on the server (M-1) | Renewal, failure and grace banners (P-6a) |
| BQ-P10: refusal code and no Choose for a Founding Partner without an end date | Verifying F-3 (SA, then P-6a and P-7a ACs) |
| Expire-and-replace for an open checkout of the account's own; new refusal `checkout_processing` (M-3), on the shared route, so the holding screen gets it too | Any migration (none needed) |
| Publishable key checked before the POST (M-2); `BoostPackagesPanel` on the shared loader (M-4) | `StripePaymentForm` (Connect) |
| Localised refusal lines, en/he/es, Hebrew right to left (M-7) | Switching anything on in production (§9.5 rows 15, 16) |
| PF-7 recorded closed by QA (M-7) | — |

---

## 3. Implementation Approach

### 3.1 One predicate for what a non-held account may buy (M-1, M-5)

Today `planCheckoutEligibility` gives a non-held account `sellableTiers()` (every tier with a Stripe price). P-4 replaces that with a second pure predicate next to `heldPaymentOffer`, in `planCheckoutEligibility.ts`:

```text
planPurchaseOffer(facts, switches) →
  { kind: 'choose', tiers: TierId[] }                     // tiers with a Stripe price AND availableToBuy, in tier order
| { kind: 'none', reason: 'switches_off' | 'not_on_sale'
                        | 'free_access_no_end_date'       // BQ-P10
                        | 'paying' }                      // live or pending subscription, or a lock that reads `complete`
```

- `switches`: `checkoutEnabled` and `pricesEnabled`, read by the existing `readHeldPaymentSwitches()` (the third switch, `paidInvitesAvailable`, governs held accounts only and is ignored here).
- `facts`: the free-access fact (§3.2) and the billing state (§3.4).
- `buyableTiers()` = `sellableTiers()` ∩ `presentation[tier].availableToBuy`, from config, no tier literal.
- **The checkout** (step 6 for a non-held account, step 7 for BQ-P10, step 9 for `paying`) and **the my-plan view** call this one function. The screen shows Choose exactly when it says `choose`, and only for the tiers it lists. A tier not in the list is refused `price_unavailable` with `reason: 'tier_not_sold'`, as today (M-1 names both).
- **The held path is unchanged:** `heldPaymentOffer` still decides, and `paidInvitesAvailable` governs there (D5-3). A held friend's tier is not required to be `availableToBuy`.

A matrix test (as `heldPaymentOffer.matrix.test.ts`) drives every combination through the real checkout (with fakes) and the real view builder and asserts that they agree.

### 3.2 BQ-P10: "Refuse until end date set"

**The fact, structurally.** `hasOpenEndedFreeAccess(resolution, config)`, a new pure helper inside the entitlements module, is true when:

1. `resolution.basis.kind === 'cohort'`;
2. that cohort's config has **no** `durationHistory` (its end is set per account by an admin, which is what makes it a Founding-Partner-like cohort; a trial has a duration and is never caught); and
3. `resolution.lifecycle.accessEndsAt === null`.

No cohort name is written anywhere (`tierLiteral.forbidden.test.ts`; skill rule). A champion with an end date, including one already in grace, is **not** caught: they may buy (F10, user's decision).

**Server.** `planCheckout.ts` step 7 already reads the snapshot. Its port `PlanSnapshotLike` grows to carry `basis` and `lifecycle.accessEndsAt` (both already on `SnapshotResult.resolution`). After the existing `plan_unreadable` and `no_plan_row` checks, the checkout calls `planPurchaseOffer`. On `free_access_no_end_date` it refuses with the new code **`free_access_no_end_date`** (409, warn, no alert, no audit, no Stripe call): "Your free access has no end date yet, so there is no plan to buy." It is decided before any Stripe call, so the C-4 order holds.

**Screen.** The same predicate gives the view `kind: 'none', reason: 'free_access_no_end_date'`. Settings shows no Choose and no "Coming soon": the existing Founding Partner sentence (`plan.changes.no_end_date`, "…if that ever changes for your account we will tell you first and you will be able to choose a plan") already says the right thing, so no new sentence is needed for this case.

**Held accounts** are not affected: a held account is never a tierless champion.

**Open for SA (Q-1):** a champion whose tier is live (an admin assignment with no subscription) resolves `basis: tier`, so the rule does not catch them. That account is not on Founding Partner today, so buying takes nothing away from them. Dev proposes leaving it that way.

### 3.3 M-3: expire-and-replace the account's own open checkout

Step 9 today refuses `checkout_open` whenever the account's own lock is unexpired. New behaviour, when `row.openCheckoutSessionId` is set and unexpired:

1. Retrieve that session from Stripe through a new read, `StripeService.retrieveCheckoutSessionState(sessionId)`. It returns `{ status, customerId, livemode }` and nothing else, so no client secret is read or logged.
2. **Ownership check (tenant-isolation-guard):** the session id comes from our own record, never the request. As a backstop, its `customer` must equal `row.stripeCustomerId` and its `livemode` the row's. On a mismatch, refuse with `checkout_open` and log `error` with `alert: true`.
3. `open`: expire it at Stripe (`expireCheckoutSession`, existing). Then clear the lock with the existing `releaseCheckoutLock`, compare-and-set on that session id, and continue as a new checkout for the tier asked for.
4. `expired`: clear the lock (compare-and-set) and continue.
5. `complete`: refuse with the new code **`checkout_processing`** (409, warn): "Your payment is being processed." Settings and the holding screen localise it and offer no new checkout.
6. The retrieve or the expire throws, or the release fails: refuse `checkout_open`, as today. That is now its only remaining use (M-3).

SR-5 still holds. A new session is created only after the old one can no longer be paid, and layer 1b (the Stripe subscription list, step 12) still runs. If two requests race, both may expire the same session; only one wins the new lock (step 14), and the loser's session is expired and answered `checkout_busy`, as today.

**C-4 order (Q-2 for SA).** This adds a Stripe call **before** the price check (step 10), but only when the account's own lock is unexpired. It still comes after every database read (hold, plan row, billing row). A `checkout_processing` refusal therefore follows a Stripe read. Dev proposes amending C-4's wording to "every database read precedes any Stripe call; the only Stripe call before the price check is the M-3 read of the account's own open session".

P-5a.2's tests that pin `checkout_open` for an unexpired lock (`planCheckout.test.ts`, `planCheckout.qa.test.ts`, the route test, `awaitingPayment.render.test.tsx`) are **rewritten on purpose** to the new matrix (open → replaced; expired → replaced; complete → `checkout_processing`; unreadable → `checkout_open`). None is loosened. The holding screen's copy gains `checkout_processing` in en/he/es.

### 3.4 M-5 and F-2: the purchase view, from the server

`my-plan` keeps its "no input" property. It adds one field, `purchase`, built by a new server-only module `lib/business-os/billing/planPurchaseView.ts`:

| Input | Source | Never |
|---|---|---|
| Account | the session (`getUser()` → `resolveAccountId`) | a request value |
| Billing state | `businessOsBillingAccountRepository.findByUser(user.id, livemode)`, the server key's mode (`currentStripeMode`); `subscriptionStatus`, `cancelAtPeriodEnd`, `currentPeriodEnd`, `boughtTier`, the open lock | a Stripe call (SR-11) |
| Switches | `readHeldPaymentSwitches()` | — |
| Free-access fact | `hasOpenEndedFreeAccess(snapshot.resolution, config)` | — |
| Plans | `customerPlanView`'s new `plans` list (below) | the tier matrix read in the component |

Output:

```text
purchase: {
  offer: { kind: 'choose', tiers: [...] } | { kind: 'none', reason },     // planPurchaseOffer, unchanged
  billing: null | { state: 'renewing' | 'ending' | 'processing',          // from our record only
                    date: ISO | null },
  trialEndsToday: boolean                                                 // M-8, BQ-P2
}
```

- **`customerPlanView` gains `plans`:** every tier with `shownToCustomers`, in `tierOrder`, each with `planId`, localised `name`, `monthlyPriceUsd` and `availableToBuy`. The existing `nextPlanUp` (what the plan above would add) stays as it is. This is a change inside the entitlements module, so its review checklist applies. No capability or tier literal is added.
- **F-2 wording.** For an account with a paying subscription (`PAYING_SUBSCRIPTION_STATUSES`) on our record, the view's `endsWhen` is replaced. It becomes `{ key: 'plan.renews_on', date: currentPeriodEnd }`, or `{ key: 'plan.ends_on_paid', date }` when `cancelAtPeriodEnd`. Without a billing record (an admin-assigned plan, F4) it stays `plan.ends.while_paid`. The replacement is made server-side, so the component still renders whichever sentence it is sent. `ends_on_paid` is reached only once P-7a can set `cancel_at_period_end` (or through the Stripe dashboard); it is built now so the wording is never wrong.
- **`paying`.** A live or pending subscription on our record, or the account's own open session reading `complete`, gives `offer.kind = 'none', reason = 'paying'`. Autopilot is then shown as information with no action, until P-7b.1.
- **`trialEndsToday`** is true when the basis is a cohort that is live **and has a duration** (a trial). The structural test is the same as in §3.2, with no cohort name. It adds the BQ-P2 line "Buying ends your free trial today, and the first month is charged now." A Founding Partner with an end date who buys before that date also loses their remaining free days until P-11. **Open for SA/user (Q-3):** should they get the same line ("ends your free access today")? Dev proposes yes, as one generic sentence for any live cohort.
- **A failed billing read** never hides the plan. The offer is computed as if no billing record existed, so the server still refuses at SR-5 if a subscription is live (`subscription_live`, localised), and `billing` is `null`. This is the same choice `heldPaymentView` made.

### 3.5 M-2 and M-4: the shared loader and the key check

- `lib/client/stripeJs.ts` adopts `BoostPackagesPanel`'s `^pk_(test|live)_` shape check. A key of the wrong shape returns `null`, like a missing one.
- `BoostPackagesPanel.tsx` imports `getStripePromise` from it and deletes its own `loadStripe` copy. Its tests' `@stripe/stripe-js` mock is redirected, not weakened.
- `PlanEmbeddedCheckout.tsx` reads `getStripePromise()` **before** the POST. When it is `null`, the component shows `labels.notConfigured` instead of the start button and never calls the route. The harness, the holding screen and Settings all get this.
- `components/website/blocks/StripePaymentForm.tsx` is not touched (SA O-3).

### 3.6 M-6: the return from checkout

- Settings mounts `PlanEmbeddedCheckout` with `returnTo: 'settings_plan'`. On Stripe's `onComplete`, it replaces the URL with `/business-os/settings?section=plan&checkout=<session id>`, as `HeldPaymentCheckout` does.
- `PlanSection` reads `?checkout=` through `isCheckoutReturnMarker` (display only) and shows "Payment processing". It then re-fetches `my-plan` every 4 s, at most 15 times.
- **Success comes only from the server re-read.** "You're on <plan>" and "Renews on <date>" are shown once `purchase.billing.state` reads `renewing` **and** the plan view's `kind` is `tier`. Until then the processing line stays, and after the last re-fetch it becomes "This is taking longer than usual", with a "Check again" link to the URL without the marker.
- A failed re-fetch never claims success. A stale or bookmarked marker cannot trap the owner: the link without the marker shows Choose again when nothing is live.
- The refresh constants move from `app/invite/awaiting-payment/PaymentProcessingRefresher.tsx` to a shared `components/business-os/billing/checkoutProcessing.ts`, which both screens import, so the two cannot drift. That is a move, not a behaviour change.

### 3.7 Entitlements registration (SR-17, `business-os-entitlements`)

| File | Imports from the module | Gate or non-gate |
|---|---|---|
| `lib/business-os/billing/planCheckoutEligibility.ts` (existing entry) | + `TIER_MATRIX` (for `availableToBuy`), + `hasOpenEndedFreeAccess`, + `EntitlementResolution` type, + `getEntitlementConfig` if needed | **Q-4 for SA.** It now refuses a sale by a presentation flag and by the free-access fact. Neither is a capability, so Dev proposes keeping it a recorded non-gate, with `why` updated to say exactly that: "refuses a SALE, never a capability; registered so the decision is visible" |
| `lib/business-os/billing/planCheckout.ts` (existing entry) | symbols re-checked; only the port type grows | non-gate, `why` updated |
| `lib/business-os/billing/planPurchaseView.ts` (new) | `hasOpenEndedFreeAccess`, `getEntitlementConfig`, types | non-gate (display) |
| `app/api/business-os/entitlements/my-plan/route.ts` (existing entry) | symbols re-checked | non-gate (display) |

`npm run test:bos-entitlements` is run on the final diff and the result is recorded here.

### 3.8 Tenant isolation (`tenant-isolation-guard`)

- Every read and write is keyed by the session's user id and the server key's mode. The body carries only `{ tier, returnTo }` (strict). `my-plan` takes no input at all, and its guard test stays.
- M-3 acts only on the session id stored on the account's own billing row, and cross-checks its customer and mode (§3.3 step 2). The lock is cleared by compare-and-set on that session id (`releaseCheckoutLock`, `.eq('user_id')`, `.eq('livemode')`, `.eq('open_checkout_session_id')`).
- No new service-role write path. No new repository method.

### 3.9 Audit and logging

- No new audit event. The existing `BOS_BILLING_CHECKOUT_STARTED` (with flush) covers a started checkout. Refusals are logged, never audited (SA Q-9), and the two new codes follow that.
- **Q-5 for SA:** should an M-3 replacement (an open session expired by us) add `replacedSessionId` to the existing audit entry's `details`? Dev proposes yes: it costs one field and records why a session disappeared.
- Pino with a correlation id on both routes, as today. No `console.*`.

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/billing/planCheckoutEligibility.ts` | modify | `buyableTiers()`, `planPurchaseOffer` (M-1, BQ-P10, M-5); non-held branch uses it |
| `lib/business-os/billing/planCheckout.ts` | modify | Snapshot port grows; BQ-P10 at step 7; M-3 at step 9; codes `free_access_no_end_date`, `checkout_processing` |
| `lib/stripe/StripeService.ts` | modify | `retrieveCheckoutSessionState(sessionId)`: status, customer id, livemode only |
| `lib/business-os/entitlements/freeAccess.ts` | create | `hasOpenEndedFreeAccess`, `isLiveTimedCohort` (pure, structural) |
| `lib/business-os/entitlements/customerPlanView.ts` | modify | `plans` list (M-5) |
| `lib/business-os/billing/planPurchaseView.ts` | create | Server-only purchase state for `my-plan` (M-5, F-2, M-8) |
| `app/api/business-os/entitlements/my-plan/route.ts` | modify | Adds `purchase`; replaces `endsWhen` for a paying account; still no input |
| `components/business-os/settings/PlanSection.tsx` | modify | Payload type; renders `plans`, `purchase`, processing; still decides nothing |
| `components/business-os/settings/PlanPurchase.tsx` | create | Client island: Choose list, `PlanEmbeddedCheckout`, refusal line by code, processing re-fetch |
| `components/business-os/billing/PlanEmbeddedCheckout.tsx` | modify | M-2 |
| `components/business-os/billing/checkoutProcessing.ts` | create | Shared refresh interval and limit |
| `app/invite/awaiting-payment/PaymentProcessingRefresher.tsx` | modify | Import the shared constants (no behaviour change) |
| `lib/client/stripeJs.ts` | modify | M-4 key-shape check |
| `components/business-os/BoostPackagesPanel.tsx` | modify | M-4: use the shared loader |
| `app/invite/awaitingPaymentCopy.ts` | modify | `checkout_processing` line, en/he/es |
| `lib/business-os/translations/en.ts`, `he.ts`, `es.ts` | modify | New `plan.*` keys (§9) |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | Registrations (§3.7) |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | § Billing: `availableToBuy` is enforced on the server; BQ-P10 rule |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | P-4 row status, PF-7 closed, Change History (at the end) |
| Tests | create / modify | §7 |

**Not touched:** the checkout route file (no contract change; the codes come through `PLAN_CHECKOUT_REFUSALS`), `components/test-business-os/PlanCheckoutPanel.tsx`, `StripePaymentForm.tsx`, the webhook, any migration, any repository.

---

## 5. Gates

| # | Gate | Before |
|---|---|---|
| G-1 | SA approves this workplan (and rules on the split, §10) | T1 |
| G-2 | `npm run test:bos-entitlements`, the full Jest suite for the touched folders, `npm run lint`, `tsc --noEmit` green on the final diff | SA code review |
| G-3 | The user approves the he/es drafts (§9) | Merge |
| G-4 | Demo on the standard sandbox (§8), including F-5 watch | Merge |
| G-5 | **TL tells the user before merge** that the harness can then buy only where `availableToBuy` is flipped locally, and that their champion test account is refused until an admin sets an end date on it (M-1, BQ-P10) | Merge |
| G-6 | QA records PF-7 (WS-2 step 1b) closed, or Dev fixes the gap (M-7) | Merge |

---

## 6. Task List

| # | Task | Est. |
|---|---|---|
| ✅ T0 (P-4.1) | Day-1 checks: branch, `origin/main` still `28d64b02` or merged; P-5a.2 files as described; re-read `PAYING_SUBSCRIPTION_STATUSES` and the lock columns | 0.1d |
| ✅ T1 (P-4.1) | M-4 + M-2: shape check in `stripeJs.ts`; `BoostPackagesPanel` on it; `PlanEmbeddedCheckout` checks the key before the POST; tests (no fetch when null; boost panel unchanged behaviour) | 0.3d |
| ✅ T2 (P-4.1) | M-1: `buyableTiers()`, `planPurchaseOffer` (switches, not on sale); checkout non-held branch on it; tests incl. "a direct POST for a priced tier with `availableToBuy` off is refused `price_unavailable`/`tier_not_sold`" | 0.3d |
| ✅ T3 (P-4.1) | BQ-P10: `freeAccess.ts` (structural helpers); snapshot port; step-7 refusal `free_access_no_end_date`; tests (open-ended champion refused; dated champion, dated champion in grace, trial, tier, paused tier all allowed; no Stripe call on refusal) | 0.35d |
| ✅ T4 (P-4.1) | M-3: `retrieveCheckoutSessionState`; step 9 matrix (open → expire + CAS release + continue; expired → release + continue; complete → `checkout_processing`; mismatch / throw / release failure → `checkout_open`); race test; P-5a.2 pins rewritten on purpose | 0.5d |
| ⬜ T5 | `customerPlanView.plans` (every shown plan, price, `availableToBuy`); tests incl. paused/expired tier account lists its own plan | 0.4d |
| ⬜ T6 | `planPurchaseView.ts` + `my-plan` route: billing state from our record, F-2 `renews_on` / `ends_on_paid`, `paying`, `trialEndsToday`, failed billing read; route tests (401, still reads no query/body, billing read by session user + mode, no Stripe call) | 0.45d |
| ⬜ T7 | `PlanPurchase.tsx` + `PlanSection` wiring: Choose list, embedded checkout, refusal line by code, return marker, bounded re-fetch, success only from the re-read, "taking longer" + check-again link; shared refresh constants | 0.6d |
| ⬜ T8 (P-4.1 part ✅: holding-screen `checkout_processing` en/he/es) | i18n: en/he/es keys (§9), `awaitingPaymentCopy` `checkout_processing`, RTL render tests; he/es drafts to the user (G-3) | 0.3d |
| ⬜ T9 (P-4.1 part ✅: its registrations, `test:bos-entitlements`, ENTITLEMENTS doc) | Registrations (§3.7), `test:bos-entitlements`; `BUSINESS_OS_ENTITLEMENTS.md` § Billing; requirement P-4 row and Change History | 0.2d |
| ⬜ T10 | Full checks (G-2), `git diff --stat` reviewed (no deletion-only file), Implementation Notes | 0.2d |
| ⬜ T11 | Demo on the standard sandbox (§8), F-5 watch, subscription cancelled the same day | 0.3d |
| | **Total** | **≈ 4.0d** |

---

## 7. Tests

| Area | File | What |
|---|---|---|
| Shared predicate | `lib/business-os/billing/__tests__/planPurchaseOffer.matrix.test.ts` (new) | Every combination of switches × `availableToBuy` per tier × free-access fact × billing state: the view offers Choose for tier X **iff** the real checkout (fakes) admits X. Same shape as `heldPaymentOffer.matrix.test.ts` |
| Checkout | `planCheckout.test.ts`, `planCheckout.qa.test.ts` | M-1 refusal; BQ-P10 refusal with no Stripe call; M-3 matrix and race; ownership mismatch alert; held path unchanged (`paidInvitesAvailable` still governs; a held friend's tier need not be `availableToBuy`) |
| Route | `app/api/business-os/billing/plan/checkout/__tests__/route.test.ts` | New codes map to 409 with the English message; 401; invalid body; happy path unchanged |
| Free access | `lib/business-os/entitlements/__tests__/freeAccess.test.ts` (new) | Structural rule over the production config and a fixture config with renamed cohorts (proves no name is read) |
| Plan view | `customerPlanView.test.ts` | `plans` lists every shown plan in tier order with price and flag; paused/expired tier lists its own plan; `nextPlanUp` unchanged; no-exclusions test still green |
| Purchase view + my-plan | `planPurchaseView.test.ts` (new), `app/api/business-os/entitlements/my-plan/__tests__/route.test.ts` | F-2 sentences; `paying`; `trialEndsToday`; failed billing read; still no query/body read; no Stripe import |
| UI | `components/business-os/settings/__tests__/PlanSection.render.test.tsx`, `PlanPurchase.render.test.tsx` (new) | Choose only for listed tiers; none for paying, open-ended Founding Partner, switches off; "excluding tax"; trial line; refusal localised by code, never the server's English; processing → success only after a re-read shows the tier; failed re-read never claims success; `dir="rtl"` in Hebrew; payload contract test updated |
| Shared checkout | `components/business-os/__tests__/PlanEmbeddedCheckout.test.tsx` | M-2: no fetch when the key is missing or mis-shaped |
| Loader | `lib/client/__tests__/stripeJs.test.ts` (new) | Shape check, single instance |
| Boost | `BoostPackagesPanel*.test.tsx` | Still buys through the shared loader |
| Holding screen | `app/invite/__tests__/awaitingPayment.render.test.tsx` | `checkout_processing` line in en/he/es; `checkout_open` kept for the unreadable case |
| Invariants | `npm run test:bos-entitlements` | Registrations, no tier/cohort literal, snapshot unchanged |

---

## 8. Demo Plan

On the **standard Stripe test account** `acct_1UPKR4C7KDUGYIcA` (user decision 2026-10-12, §9.1.2). Its webhook does not forward to production, so **no production endpoint pause** is needed. Where its keys live is supplied by TL; Dev does not look for them and never writes them down.

**Setup (local only, never committed):** the standard sandbox keys in `.env.local`; `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` and `BUSINESS_OS_PLAN_PRICES_ENABLED` on; `availableToBuy` flipped to `true` for both tiers in `config/tierMatrix.ts`, which makes `productionConfig.test.ts` red locally, as expected; `stripe listen` started with the CLI 1.53 syntax from the F-6 docs fix; `npm run check-bos-plan-prices` passes against the sandbox.

| # | Step | Expected |
|---|---|---|
| D1 | A designated **trial** test owner opens Settings → Plan | Essentials and Autopilot, each "$79 / $129 a month, excluding tax", each with Choose; the "buying ends your free trial today" line |
| D2 | Choose Essentials, pay with `4242` | Processing, then "You're on Essentials", "Renews on <date>". Tiers page `basic`, paid-through = Stripe period end; money history and audit as in P-3b |
| D3 | Reload Settings | No Choose (paying); Autopilot shown as information |
| D4 | A second owner: Choose, close the tab, reopen within a minute, Choose again (M-3) | A new checkout opens; the first session is expired in the sandbox dashboard |
| D5 | Champion test account with **no end date** | No Choose. A direct POST from the harness → `free_access_no_end_date` |
| D6 | Admin sets an end date on that champion | Choose appears (do not buy, or buy and cancel the same day) |
| D7 | `availableToBuy` back to `false` locally, direct POST | `price_unavailable` (`tier_not_sold`), and no Choose |
| D8 | Unset the publishable key locally | "Not configured" line; no POST in the network tab (M-2) |
| D9 | Switch the UI to Hebrew and Spanish | Every new string translated; Hebrew right to left |
| F-5 | Watch the **first** "Choose" after a cold `npm run dev` | If `404 not_available` recurs, record the time, the response, and the server log line; retry once |

**After the demo:** the demo subscriptions are cancelled in the sandbox the same day (N-4). The local flips are reverted, and `git diff` shows no change to `tierMatrix.ts`.

---

## 9. i18n and RTL

New keys in `lib/business-os/translations/{en,he,es}.ts` (English final; **he/es are drafts for the user's approval**, G-3):

| Key | English |
|---|---|
| `plan.choose.heading` | Choose a plan |
| `plan.choose.button` | Choose {plan} |
| `plan.choose.starting` | Opening checkout… |
| `plan.choose.price_ex_tax` | {amount} a month, excluding tax |
| `plan.choose.trial_ends_today` | Buying ends your free trial today, and the first month is charged now. |
| `plan.choose.not_configured` | Payments are not set up on this site yet. |
| `plan.renews_on` | Renews on {date}. |
| `plan.ends_on_paid` | Ends on {date}. It will not renew. |
| `plan.purchase.processing` | Payment processing… |
| `plan.purchase.slow` | This is taking longer than usual. |
| `plan.purchase.check_again` | Check again |
| `plan.purchase.done` | You're on {plan}. |
| `plan.refusal.checkout_processing` | Your payment is being processed. |
| `plan.refusal.free_access_no_end_date` | Your free access has no end date, so there is nothing to buy yet. |
| `plan.refusal.subscription_live` | You already have a subscription. |
| `plan.refusal.price_unavailable` | This plan cannot be bought right now. |
| `plan.refusal.checkout_open` | A checkout is already open. Please try again in a moment. |
| `plan.refusal.generic` | Something went wrong opening checkout. Please try again. |

The awaiting-payment copy (`app/invite/awaitingPaymentCopy.ts`) gains `checkout_processing` in its own three-language dictionary. Prices stay in digits and USD (SR-15). Dates go through the section's existing `renderSentence` (UTC, locale map). The new island inherits `dir` from `PlanSection`, and render tests assert `dir="rtl"` in Hebrew.

---

## 10. Sizing and Split

**≈ 4.0 dev-days** (SA sized M-1 to M-9 at 2.5 to 3 days; BQ-P10 ≈ 0.35d and F-2 ≈ 0.2d were added afterwards, and the M-3 test rewrite is larger than it looked).

**Proposed split, two PRs, never stacked (SA decides):**

| PR | Title | Tasks | Est. | State after merge |
|---|---|---|---|---|
| **P-4.1** | **Checkout hardening** | T0–T4, part of T8 (`checkout_processing` copy for the holding screen), T9 for its files | ≈ 1.7d | Inert in production. Locally: the harness can buy only `availableToBuy` tiers, and a Founding Partner with no end date is refused (G-5 applies here) |
| **P-4.2** | **Buy in Settings** | T5–T8, T9, T10, T11 | ≈ 2.3d | Inert (`availableToBuy` off) |

P-4.1 is useful alone: M-3 fixes the holding screen's 31-minute block, and M-1 and BQ-P10 close the server holes the user's test session found (F-1). If SA prefers one PR, the order is the same.

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The screen offers what the server refuses | One predicate (`planPurchaseOffer`) and a matrix test through the real checkout |
| R-2 | M-3 expires a session that was being paid that very second | Stripe refuses to expire a `complete` session, and the retrieve says `complete` first. If the expire fails, the answer is `checkout_open` and no new session is created. SR-5 layer 1b still runs |
| R-3 | A wrong success claim after checkout | Success only from the `my-plan` re-read (`renewing` + `kind: tier`); a failed read stays on processing |
| R-4 | A local `availableToBuy` flip gets committed | `productionConfig.test.ts` pins `false` and runs in CI (required Jest gate). Demo checklist reverts it |
| R-5 | BQ-P10 rule catches the wrong accounts if cohorts change | Structural rule tested over a fixture config with renamed cohorts; a new admin-dated cohort is caught by design |
| R-6 | F-5 recurs in the demo | Watch item; recorded with time, response and log; if it reproduces, it becomes its own ticket (not a P-4 blocker unless it reproduces after compile) |
| R-7 | The user's champion test account can no longer buy from the harness | G-5: TL tells the user before merge; an admin end date or a non-champion test account unblocks it |
| R-8 | `BoostPackagesPanel` behaviour changes through the loader | Same key check it had; its buy tests unchanged except for the mock path |
| R-9 | Over-estimate creep in M-3 test rewrite | Pins are rewritten as a table, one row per state; reviewed by SA as a deliberate change |

---

## 12. Rollout and Rollback

- **Rollout:** merge is inert. Buying in production needs §9.5 rows 14 (live keys), 15 (checkout switch) and 16 (`availableToBuy`), each a separate one-line decision by the user. Local and preview demos flip `availableToBuy` and both env switches locally and never commit the flip.
- **Rollback:** revert the PR(s). No migration, no data written by P-4 itself; checkouts started under P-4 are ordinary P-3a sessions handled by the P-3b webhook.

---

## 13. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | BQ-P10 for a champion whose admin-assigned tier is live (`basis: tier`) | Not caught; they are not on Founding Partner today, so buying takes nothing away |
| Q-2 | M-3 adds a Stripe read before the price check (C-4 order) | Amend C-4's wording as in §3.3; the read happens only for the account's own unexpired lock |
| Q-3 | `trialEndsToday` line also for a dated Founding Partner buying before their end date (until P-11) | Yes, one generic "ends your free access today" sentence for any live cohort |
| Q-4 | `planCheckoutEligibility.ts` now refuses a sale by `availableToBuy` and by the free-access fact: gate or recorded non-gate? | Non-gate (refuses a sale, never a capability), `why` updated |
| Q-5 | Record `replacedSessionId` on the existing `BOS_BILLING_CHECKOUT_STARTED` audit entry | Yes |
| Q-6 | The split (§10) | Two PRs, P-4.1 then P-4.2 |
| Q-7 | Where to put `hasOpenEndedFreeAccess`: new `entitlements/freeAccess.ts`, or inside `lifecycle.ts` | New small file; `lifecycle.ts` stays the resolver's own |

---

## SA Review Notes

**Reviewed by SA — 2026-10-13**
**Status:** ✅ **APPROVED WITH CONDITIONS** (W-1 to W-12 below). Ship as **two PRs**, P-4.1 then P-4.2, not stacked.

Checked against the worktree on `feature/bos-plan-payments-p4` at `origin/main` `28d64b02`: `planCheckout.ts` (steps 4 to 14), `planCheckoutEligibility.ts`, `heldPaymentView.ts`, `payingSubscriptionStatuses.ts`, `BusinessOsBillingAccountRepository.ts` (`acquireCheckoutLock`, `releaseCheckoutLock`, the mirror), `StripeService.ts` (`expireCheckoutSession`), `entitlements/lifecycle.ts`, `config/cohorts.ts`, `config/lifecycle.ts`, `config/tierMatrix.ts` (`presentation`), `EntitlementService.ts` (`SnapshotResult`), `resolver.ts` (`EntitlementResolution`), migration 20261028 (the apply function), `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts`, `enforcementPoints.test.ts`, and the `business-os-entitlements` skill. Every M-1 to M-9 condition and BQ-P10 is covered by a task and a test; the conditions below correct how, not whether.

### Coverage of the ruling

| Item | Covered by | SA |
|---|---|---|
| M-1 `availableToBuy` on the server | §3.1, T2, matrix test, D7 | ✅ with W-1 |
| M-2 key before the POST | §3.5, T1, `PlanEmbeddedCheckout.test.tsx`, D8 | ✅ |
| M-3 expire-and-replace | §3.3, T4, D4 | ✅ with W-4 |
| M-4 one loader, not Connect | §3.5, T1 | ✅ |
| M-5 server-side purchase view | §3.4, T5, T6 | ✅ with W-2, W-5 |
| M-6 return and server re-read | §3.6, T7 | ✅ |
| M-7 PF-7, en/he/es, RTL | §9, T8, G-3, G-6 | ✅ (G-3 applies to P-4.1 too, W-11) |
| M-8 price, "excluding tax", trial line | §3.4, §9 | ✅ with W-7 |
| M-9 demo prerequisites | §8 (standard sandbox, N-5 as updated) | ✅ with W-12 |
| BQ-P10 "Refuse until end date set" | §3.2, T3, D5, D6 | ✅ with W-1, W-3 |

### Rulings on Q-1 to Q-7

| # | Ruling |
|---|---|
| **Q-1** | **Accepted: not caught.** A champion whose admin-assigned tier is in force resolves `basis: tier`, and Founding Partner is already suspended behind that tier. Buying replaces the tier (F4 row 2) and, when the subscription ends, the cohort resumes (F-3 below), so buying ends no free access, which is the harm BQ-P10 refuses. It also keeps the rule on the snapshot alone (the resolution carries no recorded cohort when the basis is a tier, so catching it would need a second plan-row read). The moment that tier lapses, the account resolves `basis: cohort` with no end date and IS caught. Pin both in `freeAccess.test.ts` / the matrix test, and say it in one sentence in `BUSINESS_OS_ENTITLEMENTS.md` § Billing |
| **Q-2** | **Accepted, with this exact C-4 wording** (the P-3a order contract that `planCheckout.ts`'s header cites): *"Every database read precedes any Stripe call. Every refusal decided from our own data (switches, key mode, hold, plan row, BQ-P10, `availableToBuy`, a live subscription on our record) precedes any Stripe call. The only Stripe calls before the price check are the M-3 retrieve and expire of the session id stored on the account's own billing row, made only while that lock is unexpired."* Update the header comment of `planCheckout.ts` in the same PR. Recorded in the requirement (P-4 workplan review subsection) |
| **Q-3** | **Yes, but two sentences, not one generic one** (W-7). The trial keeps BQ-P2's wording ("ends your free trial today"); an admin-dated free access gets "Buying ends your free access today, and the first month is charged now." The English goes to the user with the he/es drafts at G-3 |
| **Q-4** | **Recorded non-gate.** `ENFORCEMENT_POINTS` is keyed by capability, and a refusal to SELL has no capability to register under: it grants or withholds no feature. Each `why` must say so plainly (W-6) |
| **Q-5** | **Yes.** Add `replacedSessionId` to the existing `BOS_BILLING_CHECKOUT_STARTED` `details` (a session id is not a secret), and log the replacement at `info` (`bos_billing_checkout_replaced`). No new audit event |
| **Q-6** | **Two PRs** (see Split below) |
| **Q-7** | **New file `entitlements/freeAccess.ts`.** `lifecycle.ts` stays the resolver's own. Both helpers pure, taking the cohort config as a parameter (production default), structural only (no cohort id), and the renamed-cohort fixture test as proposed |

### F-3 (return to Founding Partner): confirmed in code, with forward conditions on P-6a

Dev's reading is right. **Confirmed:**

1. **The cohort survives a purchase.** `business_os_apply_plan_payment` (20261028) writes only `tier`, `plan_version`, `tier_expires_at` (= Stripe's period end, verbatim), `period_anchor`, `updated_by_admin_id` and `updated_at` on the plan row. It never writes `cohort` or `cohort_expires_at`. The subscription mirror writes the billing row only, never `tier_expires_at`, so a cancellation (at period end, or immediately from the dashboard) leaves the paid-through date where the last paid invoice put it.
2. **The cohort resumes when the tier lapses.** `deriveLifecycle`: a tier is in force while `tierExpiresAt` is in the future (RC-11). Once it passes, `cohortStatus` is asked; a live cohort returns its own result (`basis: cohort`, state `champion`), reason `tier_expired_champion_open_ended` or `_dated`. So a Founding Partner who stops paying is a Founding Partner again, with the cohort as the basis (what the pill reads), not in grace or paused. AC-F6.5 and AC-F8.3 hold as written.
3. **A champion whose own end date passed while paying:** when the tier lapses the cohort is not live, so the basis stays the **tier** they paid for (not Founding Partner), access end is the later of the two dates (the tier's), and the grace length is the **champion's 30 days**, not the subscription grace. This is a deliberate, commented A-1 rule ("having been a champion should not make their lapse worse").
4. **A trial buyer** never sees the trial resume: a 14-day trial always ends before a monthly period does.

**Forward conditions for the P-6a workplan** (recorded in the requirement; nothing for P-4 to build):

- **FC-1 Margin placement.** The PF-10 24-hour margin must extend the **tier-in-force test** in `deriveLifecycle` (tier in force while `now < tierExpiresAt + margin`), not only move the start of grace in `settle()`. Otherwise, at every renewal, a dated Founding Partner subscriber resumes Founding Partner for the hour between the period end and Stripe's renewal payment (more access, not less, so harmless today, but it fails AC-F6.5's "after the paid-through date and the 24-hour margin" and flickers the pill). Test with a renewal one hour late.
- **FC-2 Ex-champion grace.** Item 3 above gives a lapsed ex-Founding-Partner subscriber 30 days of grace on the paid tier where F6/F8 say 5. P-6a's workplan states whether it keeps the as-built rule; changing it is a user decision taken then, not now.

### Split decision: two PRs, never stacked

| PR | Contents | Gates before merge |
|---|---|---|
| **P-4.1 "Checkout hardening"** (~1.7d) | T0 to T4; `planPurchaseOffer` with its checkout consumer; the holding screen's `checkout_processing` line (part of T8); registrations and `test:bos-entitlements` for its files (part of T9) | SA code review, QA, G-3 for the new holding-screen line, **G-5**, a P-4.1 demo (W-11) |
| **P-4.2 "Buy in Settings"** (~2.3d) | T5 to T11 | G-1 to G-4, G-6 |

P-4.2 branches from `origin/main` **after** P-4.1 merges, never from P-4.1's branch.

**G-5 (TL, before P-4.1 merges):** tell the user, in plain words, that from then on `/test-business-os` can only buy a plan whose `availableToBuy` is switched on locally, and that their champion test account will be refused once its current sandbox subscription has ended, until an admin sets an end date on its free access (or they use a non-champion test account).

### Conditions (binding)

1. **W-1 One evaluation, after every database read, before any Stripe call.** The checkout reads the hold (6), the snapshot (7) and the billing row (8), then evaluates `planPurchaseOffer` **once** with the full fact set for a non-held account; the held path keeps `heldPaymentOffer` at step 6, unchanged. Every DB-fact refusal (`price_unavailable`/`tier_not_sold`, `free_access_no_end_date`, `subscription_live` from the record) is decided **before M-3**, so a refused request never retrieves, expires or releases the account's open session. Tests: with an unexpired lock present, each of those refusals makes zero Stripe calls and leaves the lock untouched.
2. **W-2 The shared predicate reads our data only.** Drop "the account's own open session reading `complete`" from `paying`: `my-plan` must make no Stripe call (SR-11), so the view cannot know it. `paying` = the billing row's `subscriptionStatus` in **`LIVE_SUBSCRIPTION_STATUSES`**, imported from `planCheckout.ts` (the set step 9 refuses on, as `heldPaymentView` already does), never `PAYING_SUBSCRIPTION_STATUSES`. `checkout_processing` is a checkout-only outcome of M-3. The matrix test asserts view/checkout agreement over every DB fact; the Stripe-side refusals (M-3 `complete`, layer 1b, price) are listed in the test as the documented exceptions, each with its localised line.
3. **W-3 BQ-P10 for every account.** The checkout applies `hasOpenEndedFreeAccess` irrespective of the hold (cheap, fail closed). Dev's claim that a held account is never a tierless champion is then a test (a held fixture is not caught), not a precondition.
4. **W-4 M-3 details.** (a) The session id comes only from `row.openCheckoutSessionId` of the caller's own row (read by session user + server key mode); never from the request. (b) `retrieveCheckoutSessionState` returns `{ status, customerId, livemode }` only; the raw Stripe object is never logged or returned. (c) A customer or mode mismatch → `checkout_open`, `error` with `alert: true`, and **no expire**. (d) `releaseCheckoutLock` returning `released: false` is **not** a failure (a racing request, or the `checkout.session.expired` webhook, cleared it first): continue, and step 14's compare-and-set is the arbiter. Only a repository error refuses `checkout_open`. (e) The port grows by `releaseCheckoutLock` and `retrieveCheckoutSessionState`; no new repository method. Test rows: open, expired, complete, customer mismatch, mode mismatch, retrieve throws, expire throws, release error, `released: false`, and the two-request race. The rewritten P-5a.2 pins are listed in Implementation Notes as deliberate.
5. **W-5 F-2 wording, exact.** "Renews on <date>" only when the row's status is `active`, `cancelAtPeriodEnd` is false, `endedAt` is null and `currentPeriodEnd` is in the future. "Ends on <date>" when `active` with `cancelAtPeriodEnd`. Any other status (`past_due` included: its `current_period_end` has not moved, so the date would be in the past) keeps the dateless `plan.ends.while_paid`; P-6a's banners own that state. The success state (M-6) keys on `renewing` as so defined.
6. **W-6 Registrations (`business-os-entitlements`).** Rewrite the `why` of `planCheckoutEligibility.ts`, `planCheckout.ts` **and the checkout route** (both currently say they refuse "never by tier"; through the snapshot port they now refuse a SALE by the free-access fact and by `availableToBuy`), saying: refuses a sale, grants or withholds no capability, no capability to register under; if it ever calls `check()`/`decide()` or refuses a feature by plan, it moves to `ENFORCEMENT_POINTS`. New entries for `planPurchaseView.ts` and any other new importer. Prefer defining the `my-plan` payload type outside the module so `PlanPurchase.tsx` imports nothing from it; if a client component does import a type, it is registered (type-only counts) and never imports a `server-only` file. `npm run test:bos-entitlements` green on **each** PR's final diff, result recorded.
7. **W-7 Q-3 copy.** Replace `trialEndsToday: boolean` with `endsFreeAccessOnPurchase: 'trial' | 'free_access' | null`, decided structurally (live cohort with a duration → `trial`; live admin-dated cohort → `free_access`; never a cohort id). Keys `plan.choose.trial_ends_today` (as drafted) and `plan.choose.free_access_ends_today`.
8. **W-8 Placement guard.** `planPurchaseView.ts` imports `BusinessOsBillingAccountRepository`, so add it to `BILLING_REPOSITORY_IMPORTS` in `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` (missing from §4). `import 'server-only'`, and an injectable `billing` port like `heldPaymentView`.
9. **W-9 `my-plan` stays input-free.** Its no-query/no-body guard test stays green; the billing read is keyed by the session user and the server key's mode; no Stripe import (asserted).
10. **W-10 C-4 wording** as ruled in Q-2, in `planCheckout.ts`'s header.
11. **W-11 P-4.1 demo** on the standard sandbox: D4 (on the holding screen or the harness), D5 and D7 by direct POST from the harness, D8, and the `checkout_processing` line in en/he/es. P-4.2 runs the full §8.
12. **W-12 D5 precondition.** The user's champion test account still holds sandbox subscription `sub_1UPnr9C7KDUGYIcAE5yxoCaQ` (§9.1.2 F-3). While its tier is in force it resolves `basis: tier` and is refused `subscription_live`, not `free_access_no_end_date`. D5 needs a champion with no tier in force: that account once its paid period has ended, or a fresh champion test account. T0 also confirms `/business-os/settings?section=plan&checkout=…` opens the Plan section with the marker readable.

### Standards check

- Repositories only (rule 1): ✅ no direct Supabase; W-8 for the guard.
- Zod: ✅ the checkout body unchanged and strict; `my-plan` takes no input.
- Pino, no `console.*`: ✅ none in the touched files (Dev checked; SA spot-checked `planCheckout.ts`, `planCheckoutEligibility.ts`, `heldPaymentView.ts`).
- No tier/cohort literals: ✅ tiers from `TIER_ORDER`/`presentation`, cohorts structural.
- Tenant isolation: ✅ with W-4 (a).
- Server Components by default: `PlanSection` is already a client component fetching `my-plan`; a client island for the checkout is justified (Stripe.js, interactivity). No new pattern.
- No migration, no new route, no new switch: ✅.

### Business question

None for P-4. (FC-2 may become one when the P-6a workplan is written.)

### Approval

[x] Workplan approved with conditions W-1 to W-12 — proceed to implementation of **P-4.1** (T0 to T4). P-4.2 starts from `origin/main` after P-4.1 merges.

### SA Code Review — P-4.1 (2026-10-13)

**Code Review by SA — 2026-10-13**
**Status:** ✅ **Code Approved** (no fixes applied; three Low follow-ups below, none blocking)

Reviewed the uncommitted diff on `feature/bos-plan-payments-p4` at `28d64b02` (19 modified + 4 new files, +981/−111; `git diff --stat` shows no deletion-only file): `planCheckout.ts`, `planCheckoutEligibility.ts`, `freeAccess.ts`, `StripeService.retrieveCheckoutSessionState`, the checkout route, `stripeJs.ts`, `BoostPackagesPanel.tsx`, `PlanEmbeddedCheckout.tsx`, `awaitingPaymentCopy.ts`, `enforcementPoints.test.ts`, the ENTITLEMENTS doc, and every test file in the diff.

#### Conditions verified

| # | Check | Result |
|---|---|---|
| W-1 | One our-data evaluation after reads 6/7/8, before any Stripe call | ✅ Step 8a runs once, after hold, snapshot and billing row; `stripe` is not even resolved until after it. Tests: four refusals plus two held cases with `OPEN_LOCK` present assert `stripeCalls() === []`, `releaseCheckoutLock` not called, `getStripeService` not reached. Log-order test pins `db:lineage, db:snapshot, db:findByUser` before `stripe:retrieve` |
| W-2 | Predicate on our data only, `LIVE_SUBSCRIPTION_STATUSES` | ✅ via `isLiveSubscriptionStatus` (deviation 1); Stripe-side exceptions pinned in their own block of the matrix test |
| W-3 | BQ-P10 for every account | ✅ held branch checks it first; held-on-a-tier fixture not caught |
| W-4 a | Session id only from the caller's own row | ✅ `row.openCheckoutSessionId` from `findByUser(userId, livemode)`; the body schema is unchanged |
| W-4 b | `{ status, customerId, livemode }` only, raw object never logged | ✅ return is three fields; logs carry `openSessionId` and Stripe *errors* only, never the session object |
| W-4 c | Mismatch → `checkout_open` + `error`/`alert`, nothing expired | ✅ customer and mode each tested; no expire, no release, no create |
| W-4 d | `released: false` continues; only a repository error refuses | ✅; step 14's `acquireCheckoutLock` CAS (`checkoutLockFreeFilter`) arbitrates |
| W-4 e | Port grows by the two methods only; no new repository method | ✅ |
| Race test | Meaningful | ✅ shared lock and session-state world, `Promise.all`; asserts one `ok`, loser `checkout_busy`, loser's own new session expired, secret not in the loser's result, old session expired, lock on the winner's session |
| M-1 | Production config sells nothing | ✅ `buyable: 'config'` test refuses every tier with zero Stripe calls; `productionConfig.test.ts` still pins `availableToBuy: false` |
| M-2 | No POST without a usable key | ✅ not-configured line replaces the start button; `start()` also guards |
| M-4 | Shared loader; `StripePaymentForm` untouched | ✅ boost panel's copy and `@stripe/stripe-js` import removed; `StripePaymentForm.tsx` not in the diff |
| W-6 | Registration `why`s; type-only imports registered | ✅ all three rewritten as ruled; `FreeAccessResolutionLike` (type-only) registered; `TIER_MATRIX` added. `freeAccess.ts` has no outside importer except `planCheckout.ts` (registered) |
| W-10 | C-4 header wording | ✅ verbatim |
| Tenant isolation | `tenant-isolation-guard` | ✅ no request-supplied id reaches Stripe or the repository; release keyed by session user + mode + stored session id; no new service-role path |
| Rule 1 / Zod / contract | | ✅ no direct Supabase; body schema and response shape unchanged; only `replacedSessionId` added to audit details (Q-5) |
| Pino | | ✅ no `console.*` in any touched or new file |
| i18n | `refusalProcessing` en/he/es | ✅ present in all three; he/es are DRAFTS (G-3) |
| Entitlements doc | Q-1 sentence, Change History at the end | ✅ |

#### Rulings on deviations 1–9

| # | Ruling |
|---|---|
| 1 | **Accepted.** `isLiveSubscriptionStatus` in `planCheckout.ts`, passed in as a boolean fact, is the right way to avoid the import cycle. One set, one helper. P-4.2's `planPurchaseView.ts` must use the same helper |
| 2 | **Accepted.** Switches-off now refuses a non-held account `checkout_unavailable` (warn). This is required for view/checkout agreement, and production refuses earlier anyway (route 404, step 4) |
| 3 | **Accepted.** Route touched only for the W-6 header and the Q-5 audit field. No contract change |
| 4 | **Accepted.** `replacedSessionId` only when this request expired an `open` session. An already-expired lock is still logged (`expiredByUs: false`) |
| 5 | **Accepted.** If a racing second request's expire fails, it answers `checkout_open` and does not retry. That fails closed (SR-5), and the window is milliseconds wide. Follow-up F-A (Low) is copy only |
| 6 | **Accepted.** If a cohort id is unknown to the config and the account has no access end, the account is caught. That fails closed, consistent with "nothing sold on a guess", and the mutation test proves the planCheckout tests depend on it |
| 7 | **Accepted.** `free_access_no_end_date` → `refusalNotReady` on the holding screen; a held account reaching it is an anomaly, and that line already says "contact support" |
| 8 | **Accepted as a workaround.** Separate `import type` line. Follow-up F-B (Low): fix the guard's parser |
| 9 | **Accepted.** The harness injects `buyableTiers` so the P-3a rows test what they did. The production config is still covered by its own test (`buyable: 'config'`). The route test's in-memory flip is restored per test, which is the existing `paidInvitesAvailable` pattern, and Jest's module registry is per file |

#### Checks run by SA

| Check | Result |
|---|---|
| Affected suites (`lib/business-os/billing`, `app/api/business-os/billing`, `app/invite`, `components/business-os`, `lib/client`, `lib/stripe`, `app/api/stripe`, `app/api/business-os/entitlements`, `freeAccess.test.ts`) | 90 suites, 2,339 tests, all pass |
| `npm run test:bos-entitlements` | 245 suites, 7,202 tests, all pass |
| Mutation checks (each restored, md5 of all five source files verified identical afterwards) | All caught: release `released:false` treated as failure (2 fail); mode check dropped (1); held BQ-P10 dropped (2); `complete` treated as open (3); `durationHistory` check dropped (2); unknown cohort not caught (6); raw session spread into the retrieve result (3); key-shape check dropped (3); not-configured early return dropped (1) |

#### Code Review Comments

None blocking.

#### Optimisation Suggestions / follow-ups (Low, not for this PR)

- **F-A (deviation 5):** the expire-failure `checkout_open` returns the *old* lock's `expiresAt`, so the holding screen says "a payment window is open until {time}". In the race case that window was just closed by the other request. Copy only, rare. Revisit if QA or the demo ever shows it.
- **F-B (deviation 8):** `enforcementPoints.test.ts`'s import parser reads `import { a, type B }` as the symbol `type B`. Strip the inline `type ` modifier in the parser so a future Dev does not have to know the workaround.
- **F-C (P-4.2 carry-forward):** the matrix test's agreement is partly by construction today, because the checkout calls the same predicate. It becomes a real cross-check only when P-4.2's view supplies the facts from its own reads. P-4.2 must drive the matrix through `planPurchaseView`, not by calling `planPurchaseOffer` directly.

#### QA focus

1. M-3 on the holding screen (D4): open the checkout, close the tab, reopen within the lock window. Expect a new frame, and the first session `expired` in the sandbox dashboard.
2. Pay in one tab, then press start in a second tab before the webhook lands. Expect `checkout_processing` with the localised line, not a second session.
3. D5 / D7 by direct POST from the harness (mind W-12: the champion account still on its sandbox subscription gets `subscription_live`, not `free_access_no_end_date`).
4. D8: unset or mis-shape `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (e.g. an `sk_` value). Expect the not-configured line, no POST in the network tab, and Boost Buy still behaving as before.
5. `refusalProcessing` in en/he/es, Hebrew `dir="rtl"`; he/es are drafts for G-3.
6. Logs: `bos_billing_checkout_replaced` and the audit row's `replacedSessionId` on a replacement; no session object or client secret in any log line.

### Code Approved for QA: Yes

---

## Implementation Notes

### Implementation Notes (P-4.1, "Checkout hardening") — Dev, 2026-10-13

Branch `feature/bos-plan-payments-p4`, worktree `neuronforge-invite-s1`, on `28d64b02`. **Uncommitted** (RM commits after SA, QA and the user). P-4.2 (T5 to T7, the rest of T8 and T9, T10, T11) is not built.

#### T0 day-1 checks

| Check | Result |
|---|---|
| Branch | `feature/bos-plan-payments-p4` (confirmed with `git branch --show-current`) |
| `origin/main` | The branch is on `28d64b02`. `git ls-remote` now shows `origin/main` at `a1839141` (nothing was fetched or merged here). RM to check for conflicts before the PR |
| P-5a.2 files as described | `PlanEmbeddedCheckout.tsx`, `lib/client/stripeJs.ts`, `checkoutReturnMarker.ts`, `heldPaymentView.ts`, `heldPaymentOffer` as in §1 |
| `PAYING_SUBSCRIPTION_STATUSES` | `['active', 'past_due']` (finance page). **Not** used by P-4.1: `paying` is decided on `LIVE_SUBSCRIPTION_STATUSES` (W-2) |
| Lock columns | `open_checkout_session_id`, `open_checkout_expires_at`; `releaseCheckoutLock` is compare-and-set on `user_id` + `livemode` + `open_checkout_session_id`, and returns `released: false` when the lock is already gone |
| W-12 `?section=plan&checkout=…` | Read-only: `app/business-os/settings/page.tsx` honours `section=plan` (expands and scrolls to it, line ~188) and ignores other params, so `checkout=` stays in the URL for P-4.2's `PlanSection` to read through `useSearchParams` |

#### What was built

| Item | Where | Notes |
|---|---|---|
| M-1 | `planCheckoutEligibility.ts`: `buyableTiers()`, `planPurchaseOffer(facts, switches, buyable?)` | Pure, our data only (W-2): switches (`checkoutEnabled`, `pricesEnabled`), `openEndedFreeAccess`, `subscriptionLive`, buyable tiers. Reasons in order: `switches_off`, `free_access_no_end_date`, `paying`, `not_on_sale`. `planCheckoutEligibility` no longer returns tiers for a non-held account (`{ ok: true, held: false }`) |
| BQ-P10 | new `lib/business-os/entitlements/freeAccess.ts`: `hasOpenEndedFreeAccess(resolution, cohorts = COHORTS)` | Structural (Q-7): cohort basis, cohort config with no `durationHistory`, `accessEndsAt === null`. A cohort the config does not know is caught when it has no end (fail closed). `isLiveTimedCohort` (W-7) is **not** built: P-4.2 needs it, P-4.1 does not |
| W-1, W-3 | `planCheckout.ts` new step 8a | After the hold (6), snapshot (7) and billing row (8), once: every account → BQ-P10 (W-3, held included); held → `subscription_live` from the record; not held → `planPurchaseOffer`. All before any Stripe call, so a refused request never touches the open session |
| M-3, W-4 | `planCheckout.ts` step 9; `StripeService.retrieveCheckoutSessionState` | Session id only from our row (W-4 a). Retrieve returns `{ status, customerId, livemode }` only (W-4 b). Customer or mode mismatch → `checkout_open`, `error` + `alert: true`, nothing expired (W-4 c). `open` → expire + CAS release + continue; `expired` → release + continue; `complete` → `checkout_processing` (409, warn); unknown status, retrieve or expire throws → `checkout_open`; a release **error** → `checkout_open` (error, alert); `released: false` → continue (W-4 d). The port grows by `releaseCheckoutLock` and `retrieveCheckoutSessionState` only (W-4 e) |
| Q-5 | `planCheckout.ts`, checkout route | `replacedSessionId` on the result (only when this request expired an `open` session) and in the `BOS_BILLING_CHECKOUT_STARTED` audit `details`; `info` log `bos_billing_checkout_replaced` (with `previousStatus`, `expiredByUs`, `lockReleased`), also when an already-expired lock is cleared |
| Q-2 / W-10 | `planCheckout.ts` header | The C-4 wording as ruled, verbatim, plus steps 8a and 9 in the step list |
| M-4 | `lib/client/stripeJs.ts`, `BoostPackagesPanel.tsx` | The shared loader adopts the boost panel's publishable-key shape check (`pk_test_` / `pk_live_`); the panel's own `loadStripe` copy and its `@stripe/stripe-js` import are deleted. `StripePaymentForm.tsx` not touched |
| M-2 | `PlanEmbeddedCheckout.tsx` | `getStripePromise()` is read first; `null` → `labels.notConfigured` **instead of** the start button, and the route is never called |
| Holding screen | `app/invite/awaitingPaymentCopy.ts` | New key `refusalProcessing` for `checkout_processing`; `free_access_no_end_date` → the existing `refusalNotReady`; `checkout_open` keeps its line (now only the "could not check or close it" case) |
| W-6 | `enforcementPoints.test.ts` | `why` rewritten for `planCheckoutEligibility.ts` (+`TIER_MATRIX`), `planCheckout.ts` (+`hasOpenEndedFreeAccess`, `FreeAccessResolutionLike`) and the checkout route (symbols unchanged). No new outside importer (`freeAccess.ts` is inside the module) |
| Q-1 | `freeAccess.test.ts`; `BUSINESS_OS_ENTITLEMENTS.md` § Plan checkout | A live admin tier over an open-ended cohort → not caught; the same account once the tier lapses → caught. One sentence in the doc's new P-4.1 table |

#### Holding-screen line `refusalProcessing` (G-3: he and es are DRAFTS for the user's approval)

| Locale | Text |
|---|---|
| en | Your payment is already being processed. Refresh this page in a minute. |
| he (DRAFT) | התשלום כבר בעיבוד. כדאי לרענן את הדף בעוד דקה. |
| es (DRAFT) | Tu pago ya se está procesando. Actualiza esta página en un minuto. |

The server's English messages for the two new codes (the route body's `error`, never shown on a customer screen): `checkout_processing` "Your payment is being processed."; `free_access_no_end_date` "Your free access has no end date yet, so there is no plan to buy."

#### Tests rewritten on purpose (P-5a.2 / P-3a pins; none loosened)

| File | Was | Now |
|---|---|---|
| `planCheckout.test.ts` | "an unexpired checkout lock → `checkout_open`, no Stripe call" (early-refusal table) | Removed from that table; the M-3 block covers open, expired, complete, customer mismatch, mode mismatch, retrieve throws, unknown status, expire throws, release error, `released: false` and the two-request race |
| `planCheckout.test.ts` | "`checkout_open` carries the open lock's expiry" | Same assertion, for the case where the open session is unreadable |
| `planCheckout.test.ts` | "NOT held is unaffected by the held-payment switches" (all three off → ok) | Not held is unaffected by `paidInvitesAvailable`; `checkoutEnabled` or `pricesEnabled` off → `checkout_unavailable`, no Stripe call (they now feed `planPurchaseOffer`) |
| `planCheckout.qa.test.ts` | "a lock expiring 1 ms from now → `checkout_open`, no Stripe call" | The same boundary now runs the M-3 path (retrieve, expire) before any other Stripe call; plus "a lock expiring exactly now never reaches M-3" |
| `planCheckoutEligibility.test.ts` | "not held → every sellable tier" | "not held → `{ ok: true, held: false }`" (W-1: the tiers are decided later) |
| `route.test.ts` | "an open checkout → 409 `checkout_open`, no Stripe call"; "`checkout_open` returns the expiry" | Open → replaced, 200, audit has `replacedSessionId`; complete → 409 `checkout_processing`, no audit; unreadable → 409 `checkout_open` with the expiry |
| `PlanEmbeddedCheckout.test.tsx` | "no key → click start → not configured" | No start button and no `fetch` at all (M-2) |
| `awaitingPayment.render.test.tsx` | — | Added: `checkout_processing` in en/he/es (Hebrew `dir="rtl"`), the two new code mappings |

Harness changes, so the P-3a cases test what they always tested: `planCheckout.test.ts` and `.qa` inject `buyableTiers` = every priced tier (one P-4.1 test leaves it out to prove the production config sells nothing); `route.test.ts` flips `TIER_MATRIX.presentation[*].availableToBuy` in memory per test and restores it (the pattern it already used for `paidInvitesAvailable`); the snapshot fakes now carry `basis` and `lifecycle.accessEndsAt`.

#### New tests

- `planPurchaseOffer.matrix.test.ts` (294 tests): every combination of checkout switch × price switch × `availableToBuy` per priced tier × open-ended free access × 10 billing-record states, through the real `startPlanCheckout`: the predicate offers tier X if and only if the checkout admits X. The documented Stripe-side exceptions (W-2) are pinned in their own block: M-3 `complete` → `checkout_processing`, layer 1b → `subscription_live`, price mismatch and missing price.
- `freeAccess.test.ts` (11): through the real `deriveLifecycle`, a renamed-cohort fixture, no cohort id in the source.
- `stripeJs.test.ts` (9): key shapes, one instance, the boost panel on the loader, Connect form not on it.
- `businessOsPlanCheckout.test.ts` +3 (retrieve: three facts only, expanded customer, error propagates).
- W-1 "zero Stripe calls, lock untouched, with a lock present" for `tier_not_sold`, `free_access_no_end_date`, `subscription_live`, switches off, and the held BQ-P10 and live-subscription cases.

#### Checks run on the final diff

| Check | Result |
|---|---|
| Affected suites: `lib/business-os/billing`, `app/api/business-os/billing`, `app/invite`, `components/business-os`, `components/test-business-os`, `lib/client`, `app/api/stripe`, `lib/stripe`, `app/api/business-os/entitlements` | 94 suites, 2,410 tests, all pass |
| `npm run test:bos-entitlements` | Green: 245 suites, 7,202 tests (final diff) |
| `npm run typecheck:bos-llm` | Passed: 505 files in scope, 28 errors, **0 new** (the one "baseline entry is fixed" note is `app/api/onboarding/build/route.ts`, not this diff) |
| ESLint on the 21 touched `.ts`/`.tsx` files | 0 problems |
| `npm run lint:hooks` | Pass |
| `git diff --stat` | No deletion-only file |

#### Deviations for SA

1. **`subscriptionLive` is a boolean fact, not a status, in `planPurchaseOffer`.** W-2 says `paying` reads `LIVE_SUBSCRIPTION_STATUSES` imported from `planCheckout.ts`; `planCheckout.ts` imports `planCheckoutEligibility.ts`, so importing back would be a cycle. The set is applied through a new exported `isLiveSubscriptionStatus(status)` in `planCheckout.ts`; the checkout (and, in P-4.2, `planPurchaseView.ts`) pass its answer in. Same set, one helper.
2. **`switches_off` refuses `checkout_unavailable` (warn) for a non-held account.** The predicate reads `checkoutEnabled` and `pricesEnabled` so the view and the checkout agree; in production the route's 404 and step 4 refuse first, so this branch is reachable only if a switch flips mid-request.
3. **The route file is touched** (§4 listed it as not touched): the header comment (W-6 wording) and `replacedSessionId` in the audit details (Q-5). No contract change.
4. **`replacedSessionId` only when this request expired an `open` session.** A lock whose session Stripe already reports `expired` is cleared and logged (`bos_billing_checkout_replaced`, `expiredByUs: false`) but not put on the audit entry, since this request did not make it disappear.
5. **A racing second request whose expire fails** (Stripe refuses to expire an already-expired session) answers `checkout_open` (W-4: expire throws). It does not retry. The race test models both expires succeeding; either way only one new checkout survives.
6. **`hasOpenEndedFreeAccess` catches a cohort id the config does not know** when its access has no end (fail closed). Such a resolution normally carries an anomaly and no cohort basis, so this is a backstop.
7. **`free_access_no_end_date` on the holding screen** reuses `refusalNotReady` rather than a new line, as a held account is not expected to reach it (W-3 is a test, not a precondition).
8. **The `planCheckout.ts` import of the port type is on its own `import type` line**: the registration guard's parser reads an inline `type` modifier as part of the symbol name.

#### `availableToBuy` turned ON for testing (user decision, 2026-10-13)

The user decided: "switch the plans on for now, as we are all testing, i want to see it work". `presentation.basic.availableToBuy` and `presentation.pro.availableToBuy` are now `true` in `lib/business-os/entitlements/config/tierMatrix.ts` (both already `shownToCustomers: true`, so the schema refinement holds), and the comment above `basic` is rewritten. **This supersedes** the plan-stage statements that the flag stays `false` and is flipped only locally (Overview, the §1 `availableToBuy` row, §8 setup and D7, the §10 P-4.2 row, R-4, §12). Production still sells nothing while `BUSINESS_OS_PLAN_PRICES_ENABLED` / `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` are off on Vercel. Visible side effect: Settings → Plan shows "Available to choose." instead of "Coming soon" until P-4.2 adds the Buy button. Re-checked per plan at go-live (requirement §9.5 row 16). For demo step D7, turn one tier off locally instead.

Pins changed on purpose, none loosened. Each still fails if the flag is ignored or reverted: setting `pro` back to `false` made 13 tests fail, and the file was then restored byte for byte.

| File | Was | Now proves |
|---|---|---|
| `productionConfig.test.ts` | Both `availableToBuy: false`; "lets nobody buy either yet" | Both `true`; "shows both plans and offers both for sale (2026-10-13, for testing)". The commercial state stays visible in a diff |
| `planCheckoutEligibility.test.ts` | `buyableTiers()` is `[]` | `buyableTiers()` is every priced tier, and every tier is priced (so not vacuous). New per-tier rows: turning one tier off drops exactly that tier |
| `planCheckout.test.ts` | The production config refuses every tier | The production config (real `buyableTiers`) sells every tier. New per-tier rows: turning ONE tier off refuses exactly that tier with `price_unavailable` / `tier_not_sold` and zero Stripe calls, while every other tier still sells |
| `route.test.ts` | `beforeEach` forced every tier on; the refusal row turned every tier off | `beforeEach` restores the production values; the refusal row turns off only the body's tier. New: production pins every tier on; each tier → 200 with both switches on; turning the first tier off still sells the last |
| `customerPlanView.test.ts` | Essentials' next plan has `availableToBuy: false` and the reason key | `true` with no unavailability sentence (real config). The fixture block still covers both branches |
| `PlanSection.render.test.tsx` | Essentials shows "Coming soon" and "get in touch"; he/es show the localised "coming soon" | Real config: "Available to choose.", no "Coming soon", and still no button or link (the Buy button is P-4.2's). New: `pro` turned off in memory → "Coming soon" and the reason, no control. he/es show the localised "available" line, not "coming soon" |
| `planCheckout.qa.test.ts` | Comment said production pins it off | Comment only |

Not affected: the admin Tiers tests (`page.render` uses fixtures that set the flag explicitly; `payload.contract` renders the real payload but asserts field names, not the flag's value), `tierMatrix.invariant.test.ts` (schema refinement), and the drift snapshot (`entitlements.snapshot.json` does not record presentation). No lifecycle registration changes: no new importer. Checks: the 7 requested areas 83 suites / 2,589 tests green; `test:bos-entitlements` 245 / 7,202 green; `typecheck:bos-llm` 0 new.

---

## QA Testing Report

### QA — P-4.1 "Checkout hardening" (2026-10-13)

**Test mode:** full (P-4.1 scope only; P-4.2 is not built)
**Strategy used:** A + B (Jest unit and route integration with fakes), plus source reading and two mutation checks. No browser, real database or Stripe was available, so D4, D5, D7 and D8 are left as a manual checklist (below) for the W-11 demo
**Focus:** api, security, schema, ui (M-2 only), i18n
**Skipped:** live sandbox demo (environment). Option D is handed to the user as the checklist below
**Input source:** prompt from TL, plus the SA code review's QA focus list
**Verdict:** ✅ **PASS WITH NOTES**. No bugs. Notes are Low-priority test gaps, plus the PF-7 status below

#### Gates run (worktree `neuronforge-invite-s1`, `28d64b02` plus the uncommitted P-4.1 diff)

| Check | Result |
|---|---|
| Affected suites: `lib/business-os/billing`, `lib/business-os/entitlements`, `app/api/business-os/billing`, `app/invite`, `components/business-os`, `components/test-business-os`, `lib/client`, `lib/stripe`, `app/api/stripe` | ✅ 136 suites, 3,608 tests, 110 snapshots, all pass |
| `npm run test:bos-entitlements` | ✅ 245 suites, 7,202 tests, all pass |
| `npm run typecheck:bos-llm` | ✅ passed: 505 files, 28 errors, **0 new** (the "1 baseline entry is fixed" note is `app/api/onboarding/build/route.ts`, which is outside this diff) |
| `npm run lint:hooks` | ✅ exit 0 |
| `StripePaymentForm.tsx` | ✅ not in the diff (`components/website/blocks/StripePaymentForm.tsx`); `stripeJs.test.ts` pins that it keeps its own loader |

#### Mutation checks (each restored by re-editing; `md5sum -c` on both files OK; billing and route suites green again, 25 suites and 945 tests)

| Mutation | Caught by |
|---|---|
| `replacedSessionId` also set when the open session was already `expired` (it should be set only when this request expired it) | 1 test: `planCheckout.test.ts` "expired → released and continued; … no replacedSessionId" |
| `buyableTiers()` ignores `availableToBuy` | 4 tests: `planCheckout.test.ts` production config sells nothing; `route.test.ts` M-1 tier not on sale; `planCheckoutEligibility.test.ts` two `buyableTiers` tests |

#### Test Coverage

| Acceptance criterion / focus item | Tested? | Result | Notes |
|---|---|---|---|
| M-1: the production config sells nothing while `availableToBuy` is off | ✅ | Pass | `buyable: 'config'` refuses every tier in `TIER_ORDER` with `price_unavailable` and zero Stripe calls; `productionConfig.test.ts` still pins `false`. Mutation caught |
| M-1: an in-memory flip sells only that tier | ✅ | Pass | `harness({ buyable: [FRIEND_TIER] })`: the friend tier proceeds, the higher tier gets `tier_not_sold` with no Stripe call; the route test flips `TIER_MATRIX.presentation` per test and restores it |
| BQ-P10: open-ended champion → `free_access_no_end_date` (non-held) | ✅ | Pass | 409, warn, no alert; log order is `db:lineage, db:snapshot, db:findByUser` and nothing else |
| BQ-P10 held (W-3) | ✅ | Pass | A held account on an open-ended cohort is refused with no Stripe call; a held account on a tier is not caught |
| Q-1: a live admin tier is not caught; a lapsed tier is caught | ✅ | Pass | `freeAccess.test.ts` uses the real `deriveLifecycle`. A dated, grace or timed cohort is not caught; renamed cohorts give the same answers; no cohort id appears in the source |
| Zero Stripe calls on every own-data refusal with a lock present (W-1) | ✅ | Pass | 4 non-held cases plus 2 held cases with `OPEN_LOCK`: `stripeCalls() === []`, `releaseCheckoutLock` not called, `getStripeService` not reached |
| M-3 open → expire + new | ✅ | Pass | Order is retrieve, expire, release (compare-and-set keyed by session user, mode and stored id), then create. `replacedSessionId` is on the result and on both logs |
| M-3 expired → clear + new, no `replacedSessionId` | ✅ | Pass | Mutation caught |
| M-3 complete → `checkout_processing` | ✅ | Pass | 409, no expire, release or create; route returns 409 with no audit |
| M-3 customer or mode mismatch → `checkout_open` + alert, nothing expired | ✅ | Pass | Both variants: error with `alert: true`, no expire, release or create |
| M-3 retrieve throws, unknown status, expire throws, release error → `checkout_open`; `released: false` continues | ✅ | Pass | |
| M-3 race → one winner; the loser's new session is expired; no secret leak | ✅ | Pass | Shared lock and session state, `Promise.all`; loser `checkout_busy`; the result JSON has no `secret`; the old session is expired; the lock holds the winner's session |
| `replacedSessionId` only when this request expired an open session (route audit) | ✅ | Pass | Route: replaced → audit has it; plain start → absent. Expired path: unit test plus mutation |
| Logs never contain a session object or client secret | ✅ (test + source) | Pass | `retrieveCheckoutSessionState` returns three fields (`businessOsPlanCheckout.test.ts`; SA's raw-spread mutation was caught). The M-3 log lines carry only ids, status and booleans (source read). See Edge Case 1 |
| M-2: no POST without a usable `pk_` key | ✅ | Pass | `PlanEmbeddedCheckout.test.tsx`: no start button, `fetch` never called. `stripeJs.test.ts`: missing, empty, `sk_test_…`, `rk_live_…` and `pk_tst_…` all return null and `loadStripe` is never called |
| `BoostPackagesPanel` behaviour unchanged with the shared loader | ✅ | Pass | Same `pk_(test|live)_` check, moved into the loader; still loaded only when `checkout` is set; the panel's existing suites pass |
| `refusalProcessing` en/he/es, Hebrew RTL | ✅ | Pass | `awaitingPayment.render.test.tsx` covers all 3 locales with `dir` asserted; the server message is never shown; the `checkout_processing` → `refusalProcessing` and `free_access_no_end_date` → `refusalNotReady` mappings are pinned. he/es are DRAFTS (G-3) |
| P-5a.2 intact: a held friend still gets Pay with all three switches on | ✅ | Pass | `heldPaymentOffer.matrix.test.ts` (8 switch combinations × 3 held shapes). Checked in source: a real held friend's plan row has **no basis** (`inviteRedemption.ts`, T-13 layer 1, `basis: 'none'`), which `hasOpenEndedFreeAccess` never catches (`freeAccess.test.ts` "basis none") |
| Entitlements registration (W-6) | ✅ | Pass | `test:bos-entitlements` green |
| Live sandbox: D4, D5, D7, D8 and the localized line | ⚠️ | Not run | Environment. See the manual checklist |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. M-3 adds at most two Stripe calls (retrieve and expire), and only while the account's own lock is unexpired.

**Edge cases / test gaps (nice to fix; Low, not blocking):**
1. **The logging guard does not exercise the M-3 path.** `planCheckout.test.ts` › "never logs the client secret or the email" runs only the lock-lost and happy paths. The M-3 logs are clean by source reading (ids, status and booleans only; Stripe *errors* only through `{ err }`). Suggest adding an `OPEN_LOCK` replacement run, plus a retrieve-throws run, to that test.
2. **There is no route-level test for "an already-expired open session → 200 with no `replacedSessionId` in the audit".** The rule is pinned at the service level only (mutation 1 failed exactly one test). The route spreads the field conditionally, so the risk is low.
3. **The held-matrix fixture uses a `tier` basis.** A real held friend resolves with basis `none`. Both are not caught by BQ-P10, so the outcome is the same. The fixture is just less realistic than the comment suggests.
4. **SA F-A** (stale `expiresAt` in the racing expire-failure `checkout_open`) was confirmed by reading. Copy only, rare. Left as SA's follow-up.

#### M-7 / PF-7 (WS-2 step 1b, localisation)

**Recorded for P-4.1's share only, not closed.** The one new customer-facing string P-4.1 adds (`refusalProcessing`, holding screen) exists in en/he/es and renders RTL in Hebrew (tested), and `free_access_no_end_date` maps to an existing localized line. he/es await the user's approval (G-3). The Settings → Plan purchase screen, which is the payment-asking screen PF-7 mainly gates, belongs to P-4.2. **G-6 / PF-7 closure is to be recorded by P-4.2's QA.**

#### Manual checklist — W-11 P-4.1 demo (new standard sandbox `acct_1UPKR4C7KDUGYIcA`; no production endpoint pause)

Setup: local dev with the sandbox `pk_test_` and `sk_test_` keys, plan checkout and price switches on. Expect that a non-held account is refused `tier_not_sold` for **every** tier until you flip one tier's `availableToBuy` to `true` **locally** (do not commit the flip). The holding-screen path also needs `paidInvitesAvailable` flipped locally (do not commit).

| # | Step | Expected | ✓ |
|---|---|---|---|
| D4 | Harness (or holding screen): start a checkout, close the tab before paying, reopen within the lock window, start again | A new frame opens (no 409). In the sandbox dashboard the first session is `expired`. The dev log shows `bos_billing_checkout_replaced` with `expiredByUs: true` | ⬜ |
| D4b | Wait about 31 minutes or more after an abandoned start (lock expired), then start again | New frame; no `bos_billing_checkout_replaced` line (M-3 runs only while the lock is unexpired) | ⬜ |
| D4c | Pay in tab A with test card 4242, then immediately press start in tab B before the webhook lands | Tab B gets `checkout_processing` and the localized "already being processed" line, not a second session | ⬜ |
| D5 | Direct POST from the harness as a champion with **no tier in force** and no end date | 409 `free_access_no_end_date`; no session in the sandbox dashboard. **W-12:** the user's own champion account still holds `sub_1UPnr9C7KDUGYIcAE5yxoCaQ`, so it gets **`subscription_live`** instead. Use a fresh champion test account, or wait until that period ends | ⬜ |
| D7 | Set `availableToBuy` back to `false` locally, then direct POST for that tier | 503 `price_unavailable` (log `reason: tier_not_sold`); no Stripe call in the dev log | ⬜ |
| D8a | Unset `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, restart dev, open the harness plan checkout | The "not configured" line instead of the start button; the network tab shows **no** POST to `/api/business-os/billing/plan/checkout` | ⬜ |
| D8b | Set the key to an `sk_test_…` value, restart | Same as D8a. Boost → Buy also shows no payment frame (as before) | ⬜ |
| D8c | Restore the real `pk_test_` key, restart | Start button back; Boost Buy opens its frame as before | ⬜ |
| L1 | Trigger `checkout_processing` (D4c) with the holding screen in en, he, es | en: "Your payment is already being processed. Refresh this page in a minute." he: the line renders right to left (`dir="rtl"`). es: the Spanish line. The user approves he/es (G-3) | ⬜ |
| A1 | After D4, run the read-only SQL below in the Supabase SQL editor | The newest row has `replaced_session_id` = the first session's id; a plain start has it empty | ⬜ |
| A2 | Scan the dev log for D4 and D4c | No `client_secret` or `cs_…_secret_…` value, and no full session object | ⬜ |

Read-only SQL for A1 (no comments, safe in the SQL editor):

```sql
select created_at, user_id, details->>'sessionId' as session_id, details->>'replacedSessionId' as replaced_session_id, details->>'held' as held
from audit_trail
where action = 'BOS_BILLING_CHECKOUT_STARTED'
and created_at > now() - interval '2 hours'
order by created_at desc
limit 20;
```

Optional, to see the lock after D4:

```sql
select user_id, livemode, open_checkout_session_id, open_checkout_expires_at, subscription_status
from business_os_billing_accounts
where open_checkout_session_id is not null
order by open_checkout_expires_at desc
limit 10;
```

#### Final Status
- [x] All automated acceptance criteria for P-4.1 pass, and there are no bugs. Ready for the user diff review and the W-11 manual demo. The he/es drafts await G-3; G-5 is per the SA conditions
- [ ] Issues found — Dev must address before commit

---

## Commit Info

_(RM populates this section.)_

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-13 | Workplan written (Dev) | P-4 per §F1, §9.1 P-4 row, SA ruling M-1 to M-9, BQ-P10 ("Refuse until end date set", decided 2026-10-12), F-2 and the standard sandbox (§9.1.2). As-built analysed on `origin/main` `28d64b02`. ≈ 4.0d, proposed split P-4.1 checkout hardening / P-4.2 Buy in Settings. Questions Q-1 to Q-7 for SA |
| 2026-10-13 | SA workplan review: APPROVED WITH CONDITIONS (SA) | Q-1 accepted (a champion with a live tier is not caught; caught once it lapses); Q-2 accepted with the exact C-4 wording; Q-3 yes as two sentences (trial / free access); Q-4 recorded non-gate; Q-5 yes; Q-6 two PRs, not stacked; Q-7 new `freeAccess.ts`. F-3 confirmed in code (apply function never writes the cohort; A-1 resumes a live cohort), with forward conditions FC-1 (margin extends the tier-in-force test) and FC-2 (ex-champion 30-day grace) on P-6a. Conditions W-1 to W-12: one predicate evaluation after every DB read and before M-3; DB-only `paying` on `LIVE_SUBSCRIPTION_STATUSES`; BQ-P10 for every account; M-3 ownership and `released: false` handling; exact F-2 states; registration `why` rewrites incl. the checkout route; placement guard entry for `planPurchaseView.ts`; P-4.1 demo subset; D5 precondition. G-5 before P-4.1 merges |
| 2026-10-13 | P-4.1 "Checkout hardening" implemented (Dev) | T0 to T4, the holding screen's `checkout_processing` line (en; he/es DRAFT for G-3) and its registrations. `planPurchaseOffer` + `buyableTiers` (M-1), `freeAccess.ts` `hasOpenEndedFreeAccess` (BQ-P10, every account), one our-data decision after every read (W-1), M-3 expire-and-replace with `checkout_processing` and `retrieveCheckoutSessionState`, `replacedSessionId` in audit + `bos_billing_checkout_replaced` (Q-5), C-4 wording (W-10), one shared Stripe.js loader with the key-shape check (M-4) checked before the POST (M-2). Registrations rewritten (W-6), Q-1 test and doc sentence. Deliberately rewritten pins listed in Implementation Notes. Uncommitted |
| 2026-10-13 | SA code review P-4.1: CODE APPROVED (SA) | W-1 to W-4, W-6, W-10, M-1, M-2, M-4 verified; deviations 1 to 9 accepted; affected suites (90 / 2,339) and `test:bos-entitlements` (245 / 7,202) green; 9 mutation checks all caught, sources md5-restored. No fixes applied. Low follow-ups F-A (stale `expiresAt` copy on a racing expire failure), F-B (guard parser inline `type`), F-C (P-4.2 matrix through `planPurchaseView`). QA focus listed |
| 2026-10-13 | QA P-4.1: PASS WITH NOTES (QA) | Affected suites 136 / 3,608 green; `test:bos-entitlements` 245 / 7,202 green; `typecheck:bos-llm` 0 new; `lint:hooks` pass. 2 mutation checks caught (expired-path `replacedSessionId`; `buyableTiers` ignoring `availableToBuy`), sources md5-restored. No bugs; 3 Low test gaps (M-3 path not in the log-secret guard; no route test for expired → no `replacedSessionId`; held-matrix fixture basis). PF-7: P-4.1 share recorded, closure owed by P-4.2 QA. W-11 manual checklist written |
| 2026-10-13 | `availableToBuy` turned on for testing (Dev, user decision) | `basic` and `pro` set to `availableToBuy: true` in `tierMatrix.ts` ("switch the plans on for now, as we are all testing, i want to see it work"). Inert in production while both server switches are off; Settings → Plan shows "Available to choose." until P-4.2. Seven test files re-pinned on purpose (production sells both tiers; turning ONE tier off refuses exactly that tier with no Stripe call). Supersedes the plan-stage "flip locally only" statements; see Implementation Notes. Uncommitted |
