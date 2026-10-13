# Workplan: Business OS Plan Payments, P-5a (Friend pays and gets in)

> **Last Updated**: 2026-10-12

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §9.1 P-5a row; §9.1.1 "P-5 scoping (2026-10-11)" (D5-1 to D5-6, G5-5, G5-6, G5-8, N-1, N-2, N-4, N-5); §9.3 (20261028); F2; AC-F2.1 to AC-F2.7 and AC-F2.9; SR-5, SR-6, SR-7, SR-8; and the **SA Review — P-5 scoping (2026-10-11)**: rulings S5-1 to S5-7, findings P5-F1 to P5-F4, P5-N1, conditions P5-C1 to P5-C7, P5-C11 and the S5-7 half of P5-C12.
**Invite requirement:** [BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md): 5c, FR-24, FR-35, FR-37, FR-38 (no perks), §6.4 (the stamp), §8.3 (the "first payment stamped" audit). FR-25, FR-31 and N-2 (FR-43) are P-5b.
**Depends on:** P-3b merged (#251, #299); 20261027 and 20261042 applied to production.
**Date:** 2026-10-11
**Branch:** `feature/bos-plan-payments-p5`, worktree `neuronforge-invite-s1` (confirmed with `git branch --show-current` on 2026-10-11). Its base is `3c709fe5` (#300); `origin/main` is at `a66b4c41` (#302, #303 on top: the harness "take credits" feature and a docs PR). Main is merged in before T1; that is RM's call. Uncommitted; the requirement edits of 2026-10-11 are kept.
**Status:** SA APPROVED WITH CONDITIONS (2026-10-11): split into P-5a.1 then P-5a.2; see SA Review Notes. **P-5a.1 Code Complete (2026-10-11), uncommitted; SA code review APPROVED WITH FIXES (2026-10-11), ready for QA**; see [Implementation Notes (P-5a.1)](#implementation-notes-p-5a1) and "SA Code Review — P-5a.1". P-5a.2 not started.

## Overview

P-5a lets a champion's held friend pay and get in. Today the friend's holding screen says "payment coming soon". After P-5a, when payment is switched on, it says **"Finish your payment"** and shows Essentials, "$79 a month, excluding tax", and a **Pay** button. The button opens Stripe's embedded checkout. After paying, the friend sees "Payment processing" until the webhook has applied the invoice. The screen then sends them to onboarding.

What lets them in is a once-only stamp. Migration **20261028** replaces `business_os_apply_plan_payment`. In the same transaction that applies a paid plan invoice above $0, the function now stamps `first_paid_at` and `first_payment_ref` on the account's lineage row, only if they are still empty. It also returns `out_first_payment_stamped`, so the caller knows whether **this** call wrote the stamp. The payment hold already keys on `first_paid_at` (5b), so the stamp is the release. The flag drives one new audit entry, `BOS_BILLING_FIRST_PAYMENT_STAMPED`, written once per stamp. P-5b will also use it for the N-2 email.

One pure predicate decides both whether the screen offers Pay and whether the checkout admits a held account. That way the screen can never offer a payment the server would refuse. The predicate requires `paidInvitesAvailable` and both payment switches (D5-3). P-5a also extracts one shared embedded-checkout component from the test harness panel, which P-4 will reuse.

**Nothing changes in production after merge.** `paidInvitesAvailable`, `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` and `BUSINESS_OS_PLAN_PRICES_ENABLED` are all off there, so the screen still says "payment coming soon" and the route still answers 404. The replaced function is live but is not called while the price switch is off (P-1's deny-all).

**Size: about 3.5 dev-days, one PR** (§10).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope](#2-scope)
3. [Implementation Approach](#3-implementation-approach)
4. [Migration 20261028](#4-migration-20261028)
5. [Files to Create / Modify](#5-files-to-create--modify)
6. [Gates](#6-gates)
7. [Task List](#7-task-list)
8. [Tests](#8-tests)
9. [Demo Plan](#9-demo-plan)
10. [Sizing and Split](#10-sizing-and-split)
11. [Risks](#11-risks)
12. [Rollout and Rollback](#12-rollout-and-rollback)
13. [Questions for SA](#13-questions-for-sa)
14. [SA Review Notes](#sa-review-notes)
15. [Implementation Notes (P-5a.1)](#implementation-notes-p-5a1)
16. [QA Testing Report](#qa-testing-report)
17. [Commit Info](#commit-info)
18. [Change History](#change-history)

---

## 1. Analysis Summary

As built on `origin/main` (checked in this worktree on 2026-10-11):

| Piece | Where | What it does today | What P-5a changes |
|---|---|---|---|
| Payment hold | `lib/business-os/invites/paymentHold.ts` | `readPaymentHold(accountId, readers)` returns `{ ok, held, inviteId, source }`. A friend (`account_invite`) is held on the lineage read alone while `first_paid_at IS NULL` (R-3). Admin invites read the invite's grant kind. Imports nothing from the entitlements module (source guard) | **Nothing.** The stamp is what lifts the hold. `isAwaitingPayment` stays the one predicate (P-13 changes it later) |
| Hold gate | `lib/business-os/invites/paymentHoldGate.ts` | `redirectIfAwaitingPayment()` in four layouts. `readHoldForSession()` returns `signed_out`, `not_held`, `error` or `held` with the invite language | The `held` state also carries the `PaymentHold` (its `source`) and the session user id, so the screen can apply the shared predicate without a second hold read |
| Holding screen | `app/invite/awaiting-payment/page.tsx`, `SignOutButton.tsx`, `app/invite/awaitingPaymentCopy.ts` | `force-dynamic`. `not_held` redirects to `/onboarding-chat`, `error` never redirects (SA R-4), `held` shows "payment coming soon". Invite language (C-8), Hebrew RTL. `Referrer-Policy: no-referrer` from middleware and metadata. Imports nothing from the entitlements module | Three held variants: **Pay**, **Processing**, and today's **coming soon**. A client island mounts the shared checkout. A client poller refreshes the server component. New copy in en/he/es |
| Checkout eligibility | `lib/business-os/billing/planCheckoutEligibility.ts` | Pure. A held friend may buy `INVITE_ISSUANCE_POLICY.account.grantId` only, if it has a Stripe price. A held admin invitee is refused (`held_tier_unresolved`). An unreadable hold is refused (`hold_unreadable`). **It never reads `paidInvitesAvailable` (G5-5)** | The held branch delegates to the new shared predicate `heldPaymentOffer`. That predicate refuses with `held_payment_unavailable` (warn) unless all three switches are on (S5-1, S5-2) |
| Checkout orchestration and route | `lib/business-os/billing/planCheckout.ts`, `app/api/business-os/billing/plan/checkout/route.ts` | The route answers 404 while `isPlanCheckoutEnabled()` is off. The service refuses at step 4 while the price switch is off, then reads the hold (step 6), applies SR-5, the price check, the customer, and an embedded session. `returnTo: 'awaiting_payment'` returns to `AWAITING_PAYMENT_PATH?checkout={CHECKOUT_SESSION_ID}` | Step 6 passes the switch readers to the eligibility (injectable `switches` dep). The route body schema is unchanged. Add the refusal code `held_payment_unavailable` (409, "Payment for your invitation is not open yet.") |
| Harness checkout panel | `components/test-business-os/PlanCheckoutPanel.tsx` | The only plan embedded checkout. It has its own `getStripePromise()` loader, the fetch to the route, `EmbeddedCheckoutProvider` with `onComplete`, and client-secret redaction for the response viewer | The loader, the fetch and the mount are **extracted** into one shared client component. The panel becomes a thin wrapper (tier select, logs). `BoostPackagesPanel` keeps its own loader (out of scope, noted for P-4) |
| Webhook apply | `lib/business-os/billing/planPaymentApply.ts` → `afterApply` | `applied` / `recorded` → one `recordPlanChange` (`BOS_BILLING_INVOICE_PAID`, system actor, bounded flush, invalidate). Replays write and audit nothing. `recordPlanChange` never throws | When `firstPaymentStamped` is true: read the lineage row once (source, invite id), never throwing, and queue `BOS_BILLING_FIRST_PAYMENT_STAMPED` **with** the invoice-paid entry under the **same** bounded flush (S5-4). Nothing after the apply may throw (S5-5 b) |
| Apply function | `supabase/migrations/20261027_business_os_billing_events.sql` | `business_os_apply_plan_payment(18 args) RETURNS TABLE (out_status, out_event_row_id, out_tier_before, out_tier_after, out_plan_written, out_anchor_set)`, SECURITY INVOKER, `search_path = ''`, EXECUTE to `service_role` only. Never names the lineage table (pinned by its test and checker row 83) | **20261028** drops and re-creates it with a seventh output, `out_first_payment_stamped`, and the stamp (§4) |
| Billing-events repository | `lib/repositories/BusinessOsBillingEventRepository.ts` | `applyPlanPayment` → `mapApplyResult` (strict; `boolOf` throws on a non-boolean) | `applied` / `recorded` map `firstPaymentStamped`. A missing or non-boolean value reads as **false** and is logged at warn (P5-C2), never thrown |
| Lineage table | 20261014, 20261024 | PK `account_id`, no FK to `auth.users`. `first_paid_at`, `first_payment_ref` with a paired CHECK and a 1 to 255 ref length. RLS on. Grants: `service_role` SELECT and INSERT only. The repository has **no write method by design** | Column-level `UPDATE (first_paid_at, first_payment_ref)` to `service_role` (P5-C1). Still no TypeScript writer (P5-C4) |
| Invite config | `lib/business-os/entitlements/config/invites.ts` | `paidInvitesAvailable: false`, read only by `adminInviteOps.ts:256`. Admin tier invites are refused at redemption whatever the switch says (`inviteRedemption.ts:330`) | Comment only (S5-7): the switch also gates the held friend's Pay. It is turned on only after P-9 (§9.5 row 17). Local demos flip it and never commit the flip. **Value unchanged** |
| Prices for display | `TIER_MATRIX.presentation` in `config/tierMatrix.ts` | `basic`: `Essentials`, `monthlyPriceUsd: 79` (labels en/he/es) | Read by a new server helper, never written as a literal on the screen (G5-7) |

**Platform design phase.** Not V6 or plugin work; no pipeline phase is touched.

**Findings during analysis.**

- **A-1.** `readHoldForSession()` drops the hold's `source`. The shared predicate needs it, so the `held` state is widened. Additive: the four layouts read only `redirectIfAwaitingPayment()`.
- **A-2.** `'business_os_account_lineage'` is not in `AUDIT_ENTITY_TYPES` (`lib/audit/types.ts`). S5-4 names it as the entity, so it is added there. There is no database CHECK on `audit_trail.entity_type` (checked: none in `supabase/migrations`). See Q-3.
- **A-3.** `recordPlanChange` writes and flushes **one** entry through `logAndFlush`. To put the stamp entry under the same flush (S5-4: "no second serial flush"), one of the two must accept more than one entry. See Q-1.
- **A-4.** The 20261027 checker rows **81** (argument and output names) and **83** (body md5, and "never names the lineage table") will read **FAIL by design** after 20261028. The 20261027 migration test (`business-os-billing-events.migration.test.ts:281`) pins only the 20261027 *file*, so it still passes.
- **A-5.** `BoostPackagesPanel` has a third copy of the Stripe.js loader. P-5a leaves it alone (boost is merged and outside this slice); the shared loader is ready for it.

---

## 2. Scope

| In (P-5a) | Out |
|---|---|
| 20261028: the stamp, `out_first_payment_stamped`, the column grant, plus pre-check, checker, rolled-back probe and rollback (P5-C1) | "Subscribed" in the champion's list, the N-2 email, the admin paid column, the shadow-report label and the dry-run list (**P-5b**) |
| The shared predicate `heldPaymentOffer` for the Pay button and the held checkout, with the switch-matrix test (P5-C5) | Admin Paid invites (P-9). Admin invitees stay `held_tier_unresolved` |
| The holding screen: Pay, Processing (with a bounded refresh) and coming soon; a read error never redirects (P5-C6) | The waiver (P-13) |
| The shared plan embedded-checkout component, extracted from the harness panel | Buy button in Settings (P-4); P-4 reuses the component |
| `BOS_BILLING_FIRST_PAYMENT_STAMPED`, registered and written once per stamp under the existing flush (P5-C7) | Perks (FR-38) |
| No TypeScript writer of `first_paid_at` / `first_payment_ref`, with source guards that include the boost modules (P5-C4) | Reminders or deletion of unpaid friends (BQ-8) |
| The `paidInvitesAvailable` comment (S5-7) | Turning any switch on anywhere shared |
| i18n en/he/es with Hebrew RTL. **The he and es wording is a draft for the user to approve** (as in invite 5a) | — |

---

## 3. Implementation Approach

### 3.1 The shared predicate (S5-1, S5-2, P5-C5)

**File:** `lib/business-os/billing/planCheckoutEligibility.ts` (same file, so no new entitlements import; Q-4).

```typescript
export interface HeldPaymentSwitches {
  checkoutEnabled: boolean;      // isPlanCheckoutEnabled()
  pricesEnabled: boolean;        // isPlanPriceRecognitionEnabled()
  paidInvitesAvailable: boolean; // INVITE_ISSUANCE_POLICY.paidInvitesAvailable
}

export type HeldPaymentOffer =
  | { kind: 'pay'; tier: TierId }
  | { kind: 'unavailable'; code: 'held_payment_unavailable' | 'held_tier_unresolved' };

/** Only for a HELD account. Pure. */
export function heldPaymentOffer(hold: HeldPaymentHold, switches: HeldPaymentSwitches): HeldPaymentOffer;

/** One reader, used by the checkout and the screen. Injectable in tests. */
export function readHeldPaymentSwitches(): HeldPaymentSwitches;
```

Rules, in order:

1. If any of the three switches is off, return `unavailable` / `held_payment_unavailable`.
2. `account_invite`: return the friend tier (`INVITE_ISSUANCE_POLICY.account.grantId`) if `sellableTiers()` includes it, else `held_tier_unresolved`.
3. `admin_invite`: return `held_tier_unresolved` (P-9 replaces this branch).

`planCheckoutEligibility(hold, switches)` keeps its contract for `!ok` (`hold_unreadable`) and not held (every sellable tier). For a held account it returns `{ ok: true, held: true, tiers: [offer.tier] }` exactly when `heldPaymentOffer` says `pay`, and otherwise `{ ok: false, code }`. `planCheckout.ts` step 6 passes `deps.heldPaymentSwitches ?? readHeldPaymentSwitches` (S5-1: injectable). A `held_payment_unavailable` refusal is logged at `warn` (the existing `refuse(…, 'warn')`), with no alert. The route maps it to 409.

The screen calls `heldPaymentOffer(hold, readHeldPaymentSwitches())` and never re-derives any part of it. The **switch-matrix test** enumerates 2³ switch combinations × the hold shapes (`held` friend, `held` admin invitee, `held` friend with no priced tier) and asserts that the screen offers Pay ⇔ `planCheckoutEligibility` admits the account. Both are run through the real functions, and the route-level 404 for the checkout switch is folded in as "not admitted".

### 3.2 The stamp and its side effects (S5-3, S5-4, S5-5 a and b, P5-C3, P5-C7)

- **SQL** (§4) returns `out_first_payment_stamped`. It is true only on a fresh `invoice_paid` insert with `p_amount_minor > 0` where the compare-and-set `UPDATE … WHERE account_id = p_user_id AND first_paid_at IS NULL` touched one row.
- **Repository**: `{ status: 'applied' | 'recorded', …, firstPaymentStamped: boolean }`.
- **`planPaymentApply.ts`**: new optional port `lineage: Pick<BusinessOsAccountLineageRepository, 'findHoldFactsForAccount'>` on `PlanPaymentDeps` (wired in `planBillingHandler.ts`). In `afterApply`, on `applied` / `recorded`:
  1. If `firstPaymentStamped`, read the lineage once (`findHoldFactsForAccount(accountId)`), inside a `try` that never rethrows. A failure gives `source: null` and a `warn` log. P-5b reuses the same read for `invite_id` (Q-2).
  2. Build the stamp entry: action `BOS_BILLING_FIRST_PAYMENT_STAMPED`, entity `business_os_account_lineage` / `accountId`, actor `platformActorId()` with `details.actor = 'stripe_webhook'`, details `{ invoiceId, eventRowId, source, livemode, stripeEventId }`. Never an email.
  3. Call `recordPlanChange` once for `BOS_BILLING_INVOICE_PAID`, with the stamp entry as a companion entry, so one bounded flush covers both (Q-1).
  4. Log `bos_billing_first_payment_stamped` at `info` with ids only.
- **Never throw after the apply** (S5-5 b). `recordPlanChange` already resolves in every case. The lineage read is caught. The test pins that a lineage read that throws, one that returns an error, and a `recordPlanChange` that rejects all let `applyPaidPlanInvoice` resolve normally, with no `PlanPaymentRetryError`.
- Replays (`already_applied`, `already_recorded`), refusals and `subscription_conflict` never read the flag. The function returns false there anyway, and no stamp entry is built.
- P-5b adds the N-2 notifier as a further injected port at step 3, keyed on the same flag. P-5a adds **no empty hook** for it.

### 3.3 The holding screen (S5-6, P5-C6, G5-7, G5-8)

`readHoldForSession()` gains, on `held`, `{ hold, userId }` (A-1). A new server-only helper builds the screen model and is the one module on this path that imports from the entitlements config:

**File:** `lib/business-os/billing/heldPaymentView.ts` (`import 'server-only'`)

```typescript
export type HeldPaymentView =
  | { kind: 'coming_soon' }                                          // today's screen
  | { kind: 'pay'; tier: TierId; planName: string; monthlyPriceUsd: number }
  | { kind: 'processing'; stuck: boolean };

export async function readHeldPaymentView(input: {
  userId: string; accountId: string; hold: HeldPaymentHold; language: InviteLocale; checkoutReturned: boolean;
}, deps?: HeldPaymentViewDeps): Promise<HeldPaymentView>;
```

1. `offer = heldPaymentOffer(hold, switches)`. If it is `unavailable`, return `coming_soon` (D5-3: never offer what the server refuses).
2. Billing row for the current key mode (`currentStripeMode()`; if the mode is unknown, skip this step), read with `findByUser(userId, livemode)`:
   - If the row has a subscription status in `LIVE_SUBSCRIPTION_STATUSES`, or `checkoutReturned` is true, return `processing`. A paying status (`active`, `past_due`) whose row `updatedAt` is older than 5 minutes while the account is still held is the G5-6 shape: `stuck: true`, and the helper logs `error` with `alert: true` (Q-5).
   - A read error returns `pay` when the offer is `pay`. The server refuses again at SR-5 if needed, and nobody is released.
3. Otherwise return `pay`, with `planName` from `TIER_MATRIX.presentation[tier].labels[language]` and `monthlyPriceUsd` from `presentation`. No literal is written.

**The page** keeps its "imports nothing from the entitlements module" rule. It imports `readHeldPaymentView` from the billing helper and receives the price as data.

- `coming_soon`: unchanged.
- `pay`: title "Finish your payment", plan name, "$79 a month, excluding tax", and the client island `HeldPaymentCheckout`, with tier `offer.tier`, `returnTo: 'awaiting_payment'` and copy props. Sign out stays.
- `processing`: "Payment processing", no Pay button, and the client island `PaymentProcessingRefresher`. It calls `router.refresh()` every 4 s, up to 15 times (about one minute), then shows "This is taking longer than usual. Refresh in a minute." When `stuck` is true, it shows that last line at once.
- `checkoutReturned` is true when `searchParams.checkout` matches `/^cs_(test|live)_[A-Za-z0-9]{1,250}$/`. **The marker only changes what is shown.** Release happens only when the server re-read says `not_held` and the page redirects. A read `error` keeps the error state and never redirects (SA R-4).
- After `onComplete` (card-only, so no redirect), `HeldPaymentCheckout` calls `router.replace('/invite/awaiting-payment?checkout=<sessionId>')`. The server renders `processing`, and the refresher takes over.
- A refused start (for example `checkout_open` with `expiresAt`, `subscription_live` or `held_payment_unavailable`) shows a localized message keyed on `code`, never the server's English string. A declined card stays inside Stripe's form. Nothing is recorded, and the friend can retry (BQ-8).

### 3.4 The shared embedded checkout (P5-3 reuse)

**Files:** `lib/client/stripeJs.ts` (the one `getStripePromise()`, `'use client'`-safe, null without `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`), and `components/business-os/billing/PlanEmbeddedCheckout.tsx` (`'use client'`).

Props: `{ tier, returnTo, labels, onStarted?(sessionId), onRefused?(code, expiresAt), onComplete?(sessionId) }`. It owns the POST to `/api/business-os/billing/plan/checkout` and the session state, mounts `EmbeddedCheckoutProvider` + `EmbeddedCheckout` keyed by session id, and never exposes the client secret through a callback. `PlanCheckoutPanel` keeps its UI, logs and response-viewer redaction on top of it. Its existing test is kept and still green. `HeldPaymentCheckout` (in `app/invite/awaiting-payment/`) wraps it with the invite-styled button and copy.

### 3.5 Entitlements registration (P5-C11, SR-17)

| Importer | Symbols | Status |
|---|---|---|
| `lib/business-os/billing/planCheckoutEligibility.ts` | `INVITE_ISSUANCE_POLICY`, `PLAN_STRIPE_PRICES`, `TIER_ORDER`, `TierId` | **Unchanged.** `heldPaymentOffer` reads `INVITE_ISSUANCE_POLICY.paidInvitesAvailable` through the already-imported symbol |
| `lib/business-os/billing/heldPaymentView.ts` | `TIER_MATRIX` (presentation), `TierId` (type) | **New**: added to `KNOWN_NON_GATE_IMPORTERS` with exact symbols |
| `lib/business-os/billing/planPaymentApply.ts` | unchanged (`resolveAccountId`, `RecordPlanChangeInput`, `EntitlementConfig`, `tierIsConfigured`) | Unchanged; `RecordPlanChangeInput` gains an optional field (Q-1) |
| `lib/business-os/entitlements/config/invites.ts` | comment only | — |
| `lib/business-os/entitlements/recordPlanChange.ts` | gains `companionEntries?` (Q-1) | Inside the module; no registration |

`npm run test:bos-entitlements` is run before hand-over and its result is recorded in §7.

### 3.6 Tenant isolation (`tenant-isolation-guard`)

- **The stamp.** The account is the one our billing record resolved (SR-8), passed as `p_user_id`. The function writes `WHERE account_id = p_user_id` (P5-F1; `resolveAccountId` is the identity today, and the function's comment names that seam). There is no Stripe metadata and no request value.
- **The screen.** Every read is keyed on the session: `getUser()` → `resolveAccountId`. The billing row is read by the session user id. `searchParams.checkout` only changes the display (§3.3).
- **The checkout.** Unchanged: the account and email come from the session, and the body is `.strict()`.
- **The lineage read in `afterApply`.** It uses the same resolved account id, by primary key.

---

## 4. Migration 20261028

**Number check (N-1, P5-C1).** `git fetch origin` then `git ls-tree origin/main supabase/migrations/` on 2026-10-11 (`origin/main` = `a66b4c41`) lists `20261027_business_os_billing_events.sql` followed by `20261030_business_os_boost_purchases.sql`. **20261028 is free** and sorts after 20261027, so a replay of the migration chain leaves the newer body in place. It is re-checked right before the PR.

**Files**

| File | Purpose |
|---|---|
| `supabase/migrations/20261028_business_os_first_payment_stamp.sql` | The migration |
| `scripts/precheck-bos-first-payment-stamp-migration.sql` | Read-only pre-check, including the P5-F3 count |
| `scripts/check-bos-first-payment-stamp-migration.sql` | Checker with a VERDICT line |
| `scripts/probe-bos-first-payment-stamp.sql` | Rolled-back probe (a DO block ending in an expected exception, as `probe-bos-apply-plan-payment.sql`) |
| `supabase/SQL Scripts/20261028_business_os_first_payment_stamp_rollback.sql` | Rollback |

**Paste rules (all five files; pinned by the migration test).** No `--` comments anywhere. No punctuation inside string literals (labels use spaces only; `chr(95)` for an underscore where a prefix check needs it, as 20261027 does). The word "into" never appears inside a string literal. `INSERT INTO` as SQL is fine. Each file is one paste.

### 4.1 Migration shape (S5-3, P5-F1, P5-F2)

```sql
BEGIN;

DROP FUNCTION public.business_os_apply_plan_payment(uuid, boolean, text, text, text, text, text, text, integer, boolean, integer, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, text);

CREATE FUNCTION public.business_os_apply_plan_payment(
  p_user_id uuid,
  p_livemode boolean,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_replaces_subscription_id text,
  p_stripe_event_id text,
  p_stripe_invoice_id text,
  p_tier text,
  p_plan_version integer,
  p_assigns_plan boolean,
  p_amount_minor integer,
  p_amount_tax_minor integer,
  p_currency text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_paid_at timestamptz,
  p_billing_cycle_anchor timestamptz,
  p_subscription_status text
)
RETURNS TABLE (out_status text, out_event_row_id uuid, out_tier_before text, out_tier_after text, out_plan_written boolean, out_anchor_set boolean, out_first_payment_stamped boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $apply_plan_payment$
DECLARE
  ... the 20261027 declarations, verbatim ...
  v_stamped integer;
BEGIN
  out_first_payment_stamped := false;

  ... the 20261027 body, verbatim, from the argument checks to the billing_row UPDATE ...

  IF p_amount_minor > 0 THEN
    UPDATE public.business_os_account_lineage AS lineage_row
    SET first_paid_at = p_paid_at,
        first_payment_ref = p_stripe_invoice_id
    WHERE lineage_row.account_id = p_user_id
      AND lineage_row.first_paid_at IS NULL;
    GET DIAGNOSTICS v_stamped = ROW_COUNT;
    out_first_payment_stamped := (v_stamped = 1);
  END IF;

  ... the 20261027 output assignments and RETURN NEXT, verbatim ...
END;
$apply_plan_payment$;

COMMENT ON FUNCTION public.business_os_apply_plan_payment(<the 18 types>) IS '<the 20261027 text>  On the first paid plan invoice above zero it also stamps the first payment on the lineage row once and reports whether this call stamped it';

REVOKE ALL ON FUNCTION public.business_os_apply_plan_payment(<the 18 types>) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_os_apply_plan_payment(<the 18 types>) FROM anon;
REVOKE ALL ON FUNCTION public.business_os_apply_plan_payment(<the 18 types>) FROM authenticated;
REVOKE ALL ON FUNCTION public.business_os_apply_plan_payment(<the 18 types>) FROM service_role;
GRANT EXECUTE ON FUNCTION public.business_os_apply_plan_payment(<the 18 types>) TO service_role;

GRANT UPDATE (first_paid_at, first_payment_ref) ON public.business_os_account_lineage TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
```

Notes:

- **Where the stamp sits.** It runs after the `invoice_paid` INSERT and the plan and billing UPDATEs, so it runs only on the path that inserted a fresh `invoice_paid` row: `applied` and `recorded`. Every early return (`billing_row_missing`, `customer_mismatch`, `already_applied`, `already_recorded`, `subscription_conflict`, `plan_row_missing`) happens before it, with the flag already false from the first statement. The partial UNIQUE on the paid invoice id and the `FOR UPDATE` on the billing row mean a concurrent delivery either waits and returns `already_applied`, or fails the unique and is retried. Neither can see true twice.
- **`p_amount_minor > 0`, never `p_assigns_plan`** (a discounted $0 cycle invoice assigns a plan but stamps nothing; SA-P16c).
- **No lineage row** (an organic account that never had one): count 0, flag false.
- **Lock order**: billing row, plan row, then the lineage row. No other writer takes the billing or plan lock and then the lineage lock in the other order. The friend finalise only INSERTs lineage, and P-13's waiver updates lineage in its own statement after `recordPlanChange`. So no deadlock cycle is introduced.
- **`NOTIFY` is the last statement**, after `COMMIT` (Q-6).
- **SECURITY INVOKER is kept.** `service_role` now needs the column UPDATE, which this migration grants. It does not need table-level UPDATE.
- The body is copied verbatim. The migration test asserts that the 20261028 body equals the 20261027 body plus exactly the two inserted blocks (the flag initialisation and the stamp) and the one added declaration.

### 4.2 Pre-check (read-only; P5-F3)

Run in its own tab: it sets the session read-only, so the migration goes in a **new** tab, as for 20261027.

```sql
SET default_transaction_read_only = on;

WITH apply_function AS (
  SELECT pg_proc.oid AS function_oid,
         md5(pg_proc.prosrc) AS body_md5,
         array_to_string(pg_proc.proargnames, ' ') AS argument_names
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = 'business_os_apply_plan_payment'
),
lineage_table AS (
  SELECT pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public' AND pg_class.relname = 'business_os_account_lineage'
),
lineage_privileges AS (
  SELECT count(*) FILTER (WHERE has_column_privilege('anon', lineage_table.table_oid, lineage_columns.column_name, 'SELECT')
                             OR has_column_privilege('anon', lineage_table.table_oid, lineage_columns.column_name, 'INSERT')
                             OR has_column_privilege('anon', lineage_table.table_oid, lineage_columns.column_name, 'UPDATE')
                             OR has_column_privilege('authenticated', lineage_table.table_oid, lineage_columns.column_name, 'SELECT')
                             OR has_column_privilege('authenticated', lineage_table.table_oid, lineage_columns.column_name, 'INSERT')
                             OR has_column_privilege('authenticated', lineage_table.table_oid, lineage_columns.column_name, 'UPDATE')) AS client_reachable,
         count(*) FILTER (WHERE has_column_privilege('service_role', lineage_table.table_oid, lineage_columns.column_name, 'UPDATE')) AS service_updatable
  FROM lineage_table
  JOIN information_schema.columns AS lineage_columns
    ON lineage_columns.table_schema = 'public' AND lineage_columns.table_name = 'business_os_account_lineage'
  GROUP BY lineage_table.table_oid
),
unstamped_paid AS (
  SELECT event_row.livemode, count(DISTINCT lineage_row.account_id) AS accounts
  FROM public.business_os_account_lineage AS lineage_row
  JOIN public.business_os_billing_events AS event_row
    ON event_row.user_id = lineage_row.account_id
   AND event_row.kind = 'invoice_paid'
   AND event_row.amount_minor > 0
  WHERE lineage_row.first_paid_at IS NULL
  GROUP BY event_row.livemode
),
checks AS (
  SELECT 10 AS n, 'P1 the apply function exists once with the 20261027 body' AS label,
         CASE WHEN (SELECT count(*) FROM apply_function) = 1 AND (SELECT body_md5 FROM apply_function) = '7ac579a49380b170e1ba3ac42d512820' THEN 'PASS' ELSE 'FAIL' END AS verdict,
         COALESCE((SELECT body_md5 FROM apply_function LIMIT 1), 'missing') AS detail
  UNION ALL
  SELECT 20, 'P2 the function has no first payment output yet so 20261028 is not applied',
         CASE WHEN (SELECT count(*) FROM apply_function WHERE position('out_first_payment_stamped' IN apply_function.argument_names) > 0) = 0 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT argument_names FROM apply_function LIMIT 1), 'missing')
  UNION ALL
  SELECT 30, 'P3 lineage has both first payment columns',
         CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_os_account_lineage' AND column_name IN ('first_paid_at', 'first_payment_ref')) = 2 THEN 'PASS' ELSE 'FAIL' END,
         ''
  UNION ALL
  SELECT 40, 'P4 no client role holds any privilege on lineage and service role holds no UPDATE yet',
         CASE WHEN (SELECT client_reachable FROM lineage_privileges) = 0 AND (SELECT service_updatable FROM lineage_privileges) = 0 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT client_reachable || ' client reachable and ' || service_updatable || ' service updatable' FROM lineage_privileges), 'lineage table missing')
  UNION ALL
  SELECT 50, 'P5 unstamped lineage accounts with a paid plan invoice above zero in test mode expected 0',
         CASE WHEN COALESCE((SELECT accounts FROM unstamped_paid WHERE NOT livemode), 0) = 0 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT accounts FROM unstamped_paid WHERE NOT livemode), 0)::text
  UNION ALL
  SELECT 60, 'P6 unstamped lineage accounts with a paid plan invoice above zero in live mode expected 0',
         CASE WHEN COALESCE((SELECT accounts FROM unstamped_paid WHERE livemode), 0) = 0 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT accounts FROM unstamped_paid WHERE livemode), 0)::text
  UNION ALL
  SELECT 70, 'P7 lineage rows already stamped',
         'INFO',
         (SELECT count(*) FROM public.business_os_account_lineage WHERE first_paid_at IS NOT NULL)::text
)
SELECT n, label, verdict, detail FROM checks
UNION ALL
SELECT 999, 'VERDICT', CASE WHEN EXISTS (SELECT 1 FROM checks WHERE verdict = 'FAIL') THEN 'FAIL' ELSE 'PASS' END, ''
ORDER BY 1;
```

(Draft. Column lists and labels are finalised in T2, and the migration test pins the paste rules over the final text.) **If P5 or P6 is not 0, stop and bring it to SA. No backfill is written speculatively (P5-F3).**

### 4.3 Checker (after the migration; VERDICT line)

| Row | Check |
|---|---|
| C1 | The function exists once, plpgsql, VOLATILE, SECURITY INVOKER, `search_path=""` |
| C2 | Argument and output names equal the 18 inputs plus the **seven** outputs, ending in `out_first_payment_stamped` |
| C3 | Body md5 equals the 20261028 body (computed in T1). `position('business_os_account_lineage' IN prosrc) > 0`, and the body contains `first_paid_at IS NULL` and `p_amount_minor > 0` |
| C4 | Only `service_role` holds EXECUTE (an ACL listing equal to `service_role EXECUTE`). Not anon, not authenticated |
| C5 | The function comment is present and mentions the first payment |
| C6 | `service_role` holds UPDATE on `first_paid_at` and on `first_payment_ref` |
| C7 | `service_role` holds UPDATE on no other lineage column (every other column through `information_schema.columns` × `has_column_privilege`) and no table-level UPDATE or DELETE (`aclexplode(pg_class.relacl)`) |
| C8 | `anon` and `authenticated` hold no privilege on the lineage table (table or column level) |
| C9 | **INFO:** "the 20261027 checker rows 81 and 83 now read FAIL by design" |
| C10 | **INFO:** stamped lineage rows, by mode of their `first_payment_ref` money-history row |
| 999 | VERDICT |

**The P-3b checker after 20261028.** `scripts/check-bos-billing-events-migration.sql` rows **81** (the names list) and **83** (the body md5, and `lineage_mentions = 0`) read **FAIL by design**, as the 20261039 checker's C5 did after 20261040. Handling: the 20261027 checker is **not edited**, because it records what 20261027 applied. The 20261028 checker prints C9. §9.3's 20261028 row and this workplan record it. Whoever re-runs the P-3b checker reads its 81 and 83 against this note, and its VERDICT is expected to be FAIL from now on, for those two rows only. Every other row of the old checker (table, grants, indexes, B82 EXECUTE) still passes.

### 4.4 Probe (rolled back)

This is a DO block on the user's own account (`PASTE_YOUR_OWN_USER_ID_HERE`), as the P-3b probe. It ends with `RAISE EXCEPTION 'PROBE PASS  this error is expected and rolls everything back …'`, so nothing persists. Set-up inside the transaction: a test-mode billing row and plan row as the P-3b probe creates them. If the account has no lineage row, it inserts an `organic` one (level 1, root = self). If it has one, it sets `first_paid_at` and `first_payment_ref` to NULL for the probe. All of this is rolled back (Q-7).

| # | Scenario | Expected |
|---|---|---|
| F1 | Fresh paid invoice, amount > 0, unstamped lineage | `applied`, flag **true**; lineage `first_paid_at = p_paid_at`, `first_payment_ref = invoice id` |
| F2 | The same invoice again (new event id) | `already_applied`, flag **false**; lineage unchanged |
| F3 | The same event id again | `already_recorded` or `already_applied`, flag **false** |
| F4 | A second, later invoice (a renewal) | `applied`, flag **false**; lineage still holds F1's values |
| F5 | Lineage reset to NULL in the transaction, then a $0 invoice with `p_assigns_plan = true` | `applied`, flag **false**; lineage still NULL |
| F6 | An older invoice delivered late (`recorded`), amount > 0, unstamped lineage | `recorded`, flag **true** |
| F7 | Lineage row deleted in the transaction, then a paid invoice | `applied`, flag **false**; no error |
| F8 | A refusal (`customer_mismatch`, then `subscription_conflict`) | flag **false**; lineage unchanged |
| F9 | As `authenticated` (`SET LOCAL ROLE`): run the function, and UPDATE lineage directly | Both refused (`insufficient_privilege`) |
| F10 | As `service_role`: UPDATE a lineage column other than the two | Refused (column grant only) |

### 4.5 Rollback

```sql
BEGIN;
DROP FUNCTION public.business_os_apply_plan_payment(<the 18 types>);
CREATE FUNCTION ... the 20261027 definition, verbatim, six outputs ...;
COMMENT ON FUNCTION ... the 20261027 text ...;
REVOKE ... FROM PUBLIC, anon, authenticated, service_role ...;
GRANT EXECUTE ... TO service_role;
REVOKE UPDATE (first_paid_at, first_payment_ref) ON public.business_os_account_lineage FROM service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
```

The rollback **does not clear stamps already written**: a stamped friend paid and stays released. After the rollback the 20261027 checker reads PASS again, and the code maps the missing output as "not stamped" (P5-C2), so no stamp audit is written. The migration test pins that the rollback's function text equals the 20261027 migration's, byte for byte.

### 4.6 Apply order (merge gate P5-C2)

The user, on production, by hand: pre-check (P5 and P6 = 0, VERDICT PASS) → migration in a new tab → checker VERDICT PASS → probe PROBE PASS → **then** P-5a may merge. Safe before the code deploys. The P-3b.2 code on main maps the result by name and ignores the extra column, which T4 pins. Production calls the function only once the price switch is on, which it is not.

---

## 5. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261028_business_os_first_payment_stamp.sql` | create | §4.1 |
| `scripts/precheck-bos-first-payment-stamp-migration.sql` | create | §4.2 |
| `scripts/check-bos-first-payment-stamp-migration.sql` | create | §4.3 |
| `scripts/probe-bos-first-payment-stamp.sql` | create | §4.4 |
| `supabase/SQL Scripts/20261028_business_os_first_payment_stamp_rollback.sql` | create | §4.5 |
| `supabase/migrations/__tests__/business-os-first-payment-stamp.migration.test.ts` | create | Paste rules, body delta, grants, checker/pre-check/probe/rollback in step with the migration |
| `lib/repositories/BusinessOsBillingEventRepository.ts` | modify | `firstPaymentStamped` on `applied` / `recorded`, lenient (P5-C2) |
| `lib/repositories/__tests__/BusinessOsBillingEventRepository*.test.ts` | modify | Mapping: true, false, missing, non-boolean |
| `lib/business-os/billing/planPaymentApply.ts` | modify | Stamp side effects (§3.2) |
| `lib/business-os/billing/planBillingHandler.ts` | modify | Wire the `lineage` port |
| `lib/business-os/billing/__tests__/planPaymentApply.test.ts` (and a new `planPaymentApply.firstPayment.test.ts`) | modify / create | Exactly once, never throws |
| `lib/business-os/entitlements/recordPlanChange.ts` (+ test) | modify | `companionEntries?` under the one flush (Q-1) |
| `lib/audit/boundedAuditFlush.ts` (+ test) | modify | `logAndFlush` accepts one entry or a list, in one chain link (Q-1) |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, `lib/audit/types.ts` (+ `eventAudience.test.ts` count) | modify | `BOS_BILLING_FIRST_PAYMENT_STAMPED` (info, SOC2, audience `bos`); entity type `business_os_account_lineage` (A-2) |
| `lib/business-os/billing/planCheckoutEligibility.ts` (+ test) | modify | `heldPaymentOffer`, `readHeldPaymentSwitches`, held branch |
| `lib/business-os/billing/__tests__/heldPaymentOffer.matrix.test.ts` | create | Switch-matrix test (P5-C5) |
| `lib/business-os/billing/planCheckout.ts` (+ tests) | modify | Pass switches at step 6; refusal code `held_payment_unavailable` |
| `lib/business-os/billing/heldPaymentView.ts` (+ test) | create | Screen model (§3.3) |
| `lib/business-os/invites/paymentHoldGate.ts` | modify | `held` carries `hold` and `userId` (A-1) |
| `app/invite/awaiting-payment/page.tsx` | modify | Pay, Processing, coming soon |
| `app/invite/awaiting-payment/HeldPaymentCheckout.tsx` | create | Client island over the shared component |
| `app/invite/awaiting-payment/PaymentProcessingRefresher.tsx` | create | Bounded `router.refresh()` |
| `app/invite/awaitingPaymentCopy.ts` | modify | New strings en/he/es (he/es drafts, user approval) |
| `app/invite/__tests__/awaitingPayment.render.test.tsx` (+ new render tests) | modify / create | States × locales, RTL, no Pay when off |
| `lib/client/stripeJs.ts` | create | The one Stripe.js loader |
| `components/business-os/billing/PlanEmbeddedCheckout.tsx` (+ test) | create | Shared embedded checkout |
| `components/test-business-os/PlanCheckoutPanel.tsx` | modify | Thin wrapper over the shared component |
| `lib/business-os/entitlements/config/invites.ts` | modify (comment) | S5-7 |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` (`KNOWN_NON_GATE_IMPORTERS`) | modify | Register `heldPaymentView.ts` with exact symbols. `PlanCheckoutPanel.tsx` keeps its `TIER_ORDER` entry; the shared `PlanEmbeddedCheckout.tsx` takes the tier as a string prop and imports nothing from the module |
| `lib/business-os/billing/__tests__/firstPaymentStamp.guard.test.ts` | create | P5-C4 source guards |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | §9.1 P-5a status, §9.3 row, Change History (at each stage) |

---

## 6. Gates

| # | Gate | When |
|---|---|---|
| G-1 | SA approves this workplan | Before T1 |
| G-2 | P5-F4: the embedded checkout renders under `Referrer-Policy: no-referrer` on localhost (T0). If it does not, the SA-pre-approved `strict-origin` for `/invite/awaiting-payment` only, in middleware and page metadata together | Day 1 |
| G-3 | **Merge gate P5-C2:** 20261028 applied to production with pre-check P5/P6 = 0 and VERDICT PASS, checker VERDICT PASS, probe PROBE PASS, all recorded here | Before P-5a merges |
| G-4 | The user approves the he/es wording | Before P-5a merges |
| G-5 | `npm run test:bos-entitlements` green and recorded (P5-C11) | Before hand-over to SA code review |
| G-6 | Demo run (§9), or the user waives the live demo | Before merge |

---

## 7. Task List

Estimates in dev-days.

P-5a.1 = T0, T1 to T5, the T10 guards and `test:bos-entitlements`, T11 and its share of T13 (SA W-1). Marks below are for P-5a.1 only.

- [~] **T0 (0.2d) Day-1 checks.** ✅ 20261028 re-checked free on `origin/main` `a66b4c41` (2026-10-11). ⬜ `origin/main` merge: **git refused** (`docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` has uncommitted edits that main also changed); not stashed, left to TL/RM. ⬜ P5-F4 live check: static check only, live check owed to TL (Implementation Notes, G-2). Merge `origin/main` into the branch (RM, or Dev with RM's agreement). Re-run `git ls-tree origin/main supabase/migrations/` (20261028 still free). **P5-F4:** on localhost with both payment switches on, mount the harness checkout on a page under `/invite/*` (a scratch, uncommitted page, or the new island behind a local flag) and confirm that `EmbeddedCheckout` renders and a test card completes. Record the result in §6 G-2.
- [x] ✅ **T1 (0.4d) Migration 20261028 and rollback** (§4.1, §4.5). Body copied verbatim; compute the new body md5 for the checker. Generated from the 20261027 file, so the body is byte-for-byte the old one plus the three pieces; new body md5 `08b505862f2ac749c259ac852e1c9947` (20261027 recomputed the same way: `7ac579a4…`, matches).
- [x] ✅ **T2 (0.35d) Pre-check, checker, probe** (§4.2 to §4.4). Run all four against a local PGlite (PostgreSQL 16) as P-3b did: apply 20261014, 20261024, 20261025, 20261027, then pre-check, 20261028, checker, probe, rollback, and the 20261027 checker (expect rows 81 and 83 FAIL, the rest PASS). Record the run here. Recorded under Implementation Notes.
- [x] ✅ **T3 (0.15d) Migration test** `business-os-first-payment-stamp.migration.test.ts` (61 tests).
- [x] ✅ **T4 (0.1d) Repository mapping** of `out_first_payment_stamped`. Lenient false on a missing or non-boolean value, with a warn log. Test that a six-column row still maps (pre-migration and old-code compatibility).
- [x] ✅ **T5 (0.4d) Stamp side effects** (§3.2): `logAndFlush` list form, `recordPlanChange` `companionEntries`, the audit key and entity type, the `lineage` port, `afterApply`, handler wiring.
- [ ] **T6 (0.3d) Shared predicate** (§3.1): `heldPaymentOffer`, `readHeldPaymentSwitches`, the eligibility held branch, `planCheckout` step 6 and the refusal code, the S5-7 comment in `config/invites.ts`, the switch-matrix test.
- [ ] **T7 (0.25d) Shared embedded checkout** (§3.4): `lib/client/stripeJs.ts`, `PlanEmbeddedCheckout.tsx`, the harness panel refactor (its test unchanged and green).
- [ ] **T8 (0.5d) Holding screen** (§3.3): `paymentHoldGate` `held` widening, `heldPaymentView.ts`, page states, `HeldPaymentCheckout`, `PaymentProcessingRefresher`.
- [ ] **T9 (0.2d) Copy and i18n**: en/he/es strings, RTL, refusal messages by code. Draft he/es flagged for the user (G-4).
- [~] **T10 (0.15d) Guards and registration**: P5-C4 source guards; `KNOWN_NON_GATE_IMPORTERS`; `npm run test:bos-entitlements`. ✅ P-5a.1 part: `firstPaymentStamp.guard.test.ts` (14 tests) and `test:bos-entitlements` green (237 suites, 6641 tests). No new importer of the entitlements module in P-5a.1, so no registration change. ⬜ `heldPaymentView.ts` registration is P-5a.2.
- [x] ✅ **T11 (0.1d) Full checks**: the Jest scope of every touched area, `npx tsc --noEmit` over the touched files, `npm run lint`, `npm run lint:hooks`. Check `git diff --stat` for any deletion without insertion. Results under Implementation Notes.
- [ ] **T12 (0.3d) Demo** (§9). This needs the user: a held test friend, and the endpoint pause or the separate sandbox.
- [~] **T13 (0.1d) Docs**: requirement §9.1 P-5a status, §9.3 20261028 row (checker note, applied state), Change History; this workplan's records. ✅ P-5a.1 part (2026-10-11). ⬜ G-3 applied state after the production run; P-5a.2 part.

**Total ≈ 3.5d** (T0 to T13).

---

## 8. Tests

| Area | Test | Pins |
|---|---|---|
| Migration text | `business-os-first-payment-stamp.migration.test.ts` | Paste rules over all five files (no `--`, no punctuation in strings, no "into" in strings). DROP of the exact 18-type signature before CREATE, inside one BEGIN/COMMIT. Seven outputs. Body = 20261027 body + the two blocks + the one declaration. The stamp predicate (`account_id = p_user_id`, `first_paid_at IS NULL`, `p_amount_minor > 0`, never `p_assigns_plan`). Flag initialised false before any RETURN. REVOKE ×4 + GRANT EXECUTE re-issued. Column grant on exactly the two columns. NOTIFY. The rollback's function equals 20261027's. The checker names the new md5 and the C9 note. The pre-check has P5 and P6 |
| Repository | mapping tests | `firstPaymentStamped` true or false; missing → false + warn; six-column row maps |
| Exactly once | `planPaymentApply.firstPayment.test.ts` | Stamped → one stamp entry + one invoice-paid entry, **one** flush. Not stamped → no stamp entry. `already_applied` / `already_recorded` / `subscription_conflict` / refusals → no stamp entry and no lineage read. A lineage read that errors or throws → entry with `source: null`, resolves. `recordPlanChange` rejecting → resolves. No path after the apply throws `PlanPaymentRetryError` |
| Replay end to end (handler level) | existing handler tests + one new | The same `invoice.paid` twice through the handler: one apply result with the stamp, then `already_applied`; audit entries counted |
| Flush | `boundedAuditFlush` / `recordPlanChange` tests | A list is logged in order in one chain link and flushed once. The single-entry form is unchanged (existing tests untouched). The admin route suite runs unedited |
| Predicate | `heldPaymentOffer.matrix.test.ts` | 8 switch combinations × {friend held, admin held, friend with no priced tier}: Pay offered ⇔ eligibility admits, and with the route 404 folded in as "not admitted". The unreadable hold stays `hold_unreadable` |
| Checkout | `planCheckout*.test.ts` | Held + `paidInvitesAvailable` off → `held_payment_unavailable` (409, warn, no Stripe call, no DB read after the hold). Not held is unaffected by the switch |
| Screen model | `heldPaymentView.test.ts` | Offer unavailable → `coming_soon`. Return marker → `processing`. Live status → `processing`. Paying and `updatedAt` older than 5 min → `stuck` + error log with `alert: true`. Billing read error → `pay`. Unknown key mode → `pay`. Plan name and price from `presentation`, per language |
| Page | render tests | Each state × en/he/es; `dir="rtl"` for he. Coming soon unchanged when off. No Pay in `processing`. `error` never redirects; `not_held` redirects. A malformed `?checkout=` value is ignored. The page imports nothing from `lib/business-os/entitlements/` (source guard kept) |
| Refresher | component test | At most 15 refreshes, then the "taking longer" line; `stuck` shows it at once |
| Shared checkout | `PlanEmbeddedCheckout.test.tsx` + existing `PlanCheckoutPanel.test.ts` | POST body `{ tier, returnTo }` only. The client secret never reaches a callback. A refusal surfaces `code` / `expiresAt`. No publishable key → the "not configured" branch. One loader (source guard: `loadStripe(` only in `lib/client/stripeJs.ts` among plan files) |
| Source guards (P5-C4) | `firstPaymentStamp.guard.test.ts` | Across `lib/`, `app/`, `components/`, `scripts/*.ts`: `first_paid_at` / `first_payment_ref` appear only in an allow-list of readers (`paymentHold.ts`, `BusinessOsAccountLineageRepository.ts`, `repositories/types.ts`) and never next to `.update(`, `.upsert(` or `.insert(`. `BusinessOsAccountLineageRepository` has no `.update(` / `.upsert(` / `.insert(` / `.rpc(`. **Every file under `lib/business-os/boost/`** and the boost routes never names `business_os_account_lineage`, `BusinessOsAccountLineageRepository`, `first_paid_at`, `first_payment_ref`, `applyPlanPayment` or `business_os_apply_plan_payment` (SR-6, AC-F2.4) |
| Audit registry | `eventAudience.test.ts` and the events registry tests | The new key registered with severity `info` and audience `bos`; the count updated with a comment |
| Entitlements | `npm run test:bos-entitlements` | The new importer registered with exact symbols |

---

## 9. Demo Plan

**Prerequisites (N-5, P5-N1, N-4).** Local and production share **one database**, and the sandbox's webhook endpoint forwards to production, which claims the events first. So the live demo needs **one** of:

- **A.** The production endpoint `we_1UNG3L56GTXD0wwiKUsZn8DU` paused for about 15 minutes by the user in the Stripe dashboard (as on 2026-10-11), with the pause and re-enable times recorded here, and events delivered to localhost (`stripe listen --events invoice.paid,invoice.payment_failed,invoice.finalized,invoice.marked_uncollectible,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.succeeded,charge.refunded,charge.dispute.created,charge.dispute.closed,charge.dispute.funds_reinstated --forward-to localhost:3000/api/stripe/webhook`).
- **B.** The separate Stripe sandbox from the user's "Stripe test account setup" session, if it is ready by then.

Also needed: **one designated held test friend**, created through a real friend invite from a test champion whose address the user controls, invited **in Hebrew** so that RTL is seen live. Locally: `BUSINESS_OS_PLAN_CHECKOUT_ENABLED=true`, `BUSINESS_OS_PLAN_PRICES_ENABLED=true`, and `paidInvitesAvailable: true` flipped in the working tree only, **never committed** (S5-7).

| Step | Action | Expected |
|---|---|---|
| D1 | `paidInvitesAvailable` still false; sign in as the friend | "Payment coming soon", unchanged. The harness checkout as the friend → 409 `held_payment_unavailable` (D5-3) |
| D2 | Flip `paidInvitesAvailable` locally; reload | "Finish your payment", Essentials, "$79 a month, excluding tax", **Pay**, right to left |
| D3 | Pay with `4000 0000 0000 0002` (declined) | Stripe shows the decline; nothing in the money history; lineage unstamped; still held; can retry |
| D4 | Pay with `4242 4242 4242 4242` | "Payment processing", then onboarding without a manual reload |
| D5 | Read-only SQL (user) | Lineage `first_paid_at` = Stripe's paid time and `first_payment_ref` = invoice id; one `BOS_BILLING_FIRST_PAYMENT_STAMPED`; one `BOS_BILLING_INVOICE_PAID`; plan `basic` |
| D6 | Resend the `invoice.paid` event from the dashboard | `already_applied`; lineage unchanged; no new audit entry |
| D7 | Harness checkout again as the friend (AC-F2.3) | 409 `subscription_live` |
| D8 | Sign out, sign in | Straight to the product, no holding screen |
| D9 | Cleanup, the same day | Cancel the test subscription in Stripe; re-enable the production endpoint (A); revert the local flip. The test friend may then go through the Danger Zone cleanup (deletion is refused while the subscription is live, PF-14) |

No email is sent to anyone in P-5a (N-2 is P-5b). en and es are shown by the render tests; a screenshot pass on localhost is optional.

---

## 10. Sizing and Split

≈ **3.5 dev-days** (§7), inside SA's 3 to 3.5. One PR. The merge gate (G-3) applies to the whole PR whichever way it is cut. The demo (T12) depends on the user's time and the endpoint pause, so it may slip without changing the build.

**Fallback split, only if SA prefers it or T1 to T5 run long:** **P-5a.1** "first payment stamp" (T1 to T5, T10 guards; about 1.7d; inert, no UI) and then **P-5a.2** "Pay screen" (T0, T6 to T9, T11 to T13; about 1.8d). Never stacked: P-5a.2 starts from `main` after P-5a.1 merges. G-3 gates P-5a.1.

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | DROP and CREATE: a call between them, or a stale PostgREST cache, fails the RPC | One transaction (no gap); `NOTIFY pgrst`; production never calls it while the price switch is off; a failed RPC is "could not tell" and Stripe retries |
| R-2 | The P-3b checker reading FAIL alarms someone | §4.3 handling: C9 in the new checker, the §9.3 note, this workplan |
| R-3 | The embedded checkout does not render under `no-referrer` (P5-F4) | Checked on day 1 (G-2); pre-approved `strict-origin` fallback for this one path |
| R-4 | Shared database: production claims the demo's events | Demo option A or B (§9); all switches off in production |
| R-5 | A test payment stamps `first_paid_at` like a real one (P5-N1) | Test champion and friend only. Any future perk checks the money row's `livemode` (noted for that slice) |
| R-6 | The processing poll loads the server | Bounded: 15 refreshes per visit, each one hold read and one billing read by primary key or unique key |
| R-7 | A held friend paying before the stamp exists (G5-6) | Merge gate G-3, and both switches off in production |
| R-8 | `recordPlanChange` / `logAndFlush` widening changes the admin route | Single-entry form untouched; the admin route suite runs unedited |
| R-9 | he/es wording not approved | G-4 before merge |
| R-10 | The branch is behind `origin/main` | T0 merge |
| R-11 | The holding page grows server reads | One extra (billing row) on the held path only; the gate layouts are unchanged |

---

## 12. Rollout and Rollback

**Rollout.** Production after merge: inert. `paidInvitesAvailable` false (config), `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` and `BUSINESS_OS_PLAN_PRICES_ENABLED` unset, so the screen shows "payment coming soon" and the route answers 404. The 20261028 function is applied (G-3) but not called. The audit key exists unused. The shared component is used only by the harness and the (unreachable) Pay state. Switching on happens at §9.5 rows 15 and 17, the latter only after P-9 has merged.

**Rollback.** Code: revert the PR. Nothing persisted depends on the code. Database: §4.5, in any order relative to the code (the code reads a missing flag as false). Stamps already written stay.

---

## 13. Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | How the stamp entry shares the invoice-paid flush (S5-4) | `logAndFlush(entry \| entry[], …)`: one chain link logs every entry in order, then one `flush()`. `RecordPlanChangeInput.companionEntries?: Array<Pick<AuditLogInput, 'action' \| 'entityType' \| 'entityId' \| 'details' \| 'severity'>>`, given the same actor and user rules as the main entry. Alternative: queue via `AuditTrailService.log()` before `recordPlanChange`. Rejected: it relies on the queue not batch-flushing in between, and puts audit plumbing in the orchestration |
| Q-2 | Where the audit's lineage `source` comes from | One post-commit `findHoldFactsForAccount(accountId)` read, only when stamped. It never throws; `source: null` on failure. P-5b reuses the same read for `invite_id` (N-2). Alternative: a second output column (rejected, to keep S5-3's one column) |
| Q-3 | The audit entity type `business_os_account_lineage` | Add it to `AUDIT_ENTITY_TYPES`. There is no database constraint |
| Q-4 | Home of `heldPaymentOffer` | Inside `planCheckoutEligibility.ts` (no new entitlements importer, already registered). The price for the screen comes from a new registered importer, `heldPaymentView.ts` (`TIER_MATRIX`) |
| Q-5 | The G5-6 "stuck" rule | Held + billing row in a paying status (`PAYING_SUBSCRIPTION_STATUSES`) + `updatedAt` older than 5 minutes → `error`, `alert: true`, once per render (at most about 15 per visit) |
| Q-6 | `NOTIFY pgrst` placement | The last statement, after `COMMIT` (S5-3 "end with"; 20261041 to 20261043 also end with it, though they have no explicit `BEGIN`/`COMMIT`). Inside the transaction it would be delivered at commit anyway |
| Q-7 | Probe set-up on the user's own account | An `organic` lineage row inserted (or the existing stamp nulled) inside the rolled-back transaction |
| Q-8 | Refused-start messages on the holding screen | Localized by refusal `code`, never the server's English string. `checkout_open` shows the time from `expiresAt` |

---

## SA Review Notes

**Reviewed by SA, 2026-10-11.** Checked against the worktree (`3c709fe5`) and the as-built code: `20261027_business_os_billing_events.sql` (the full function body, its early returns and its COMMENT and grants), `20261014` and `20261024` (lineage columns, CHECKs, grants; no foreign key references the lineage table), `scripts/check-bos-billing-events-migration.sql` rows 81 and 83 (md5 `7ac579a4…` matches the pre-check's P1), `scripts/probe-bos-apply-plan-payment.sql` (it switches to `service_role` and `authenticated` with `SET LOCAL ROLE`), `boundedAuditFlush.ts` (`logAndFlush`, 14 callers), `recordPlanChange.ts`, `BusinessOsAccountLineageRepository.ts`, `planCheckoutEligibility.ts`, `planCheckout.ts` (`LIVE_SUBSCRIPTION_STATUSES`), `payingSubscriptionStatuses.ts`, `paymentHoldGate.ts`, `planCheckoutFlag.ts`, `planPricesFlag.ts`, `config/tierMatrix.ts` and `enforcementPoints.test.ts`.

**Status: APPROVED WITH CONDITIONS** (W-1 to W-12). The design follows the P-5 scoping ruling closely and needs no rework. The conditions are precision items in the probe, the screen and the audit wiring. No business question.

### P5-C compliance (P-5a's share)

| Condition | Met by | Verdict |
|---|---|---|
| P5-C1 20261028 as S5-3 | §4.1: `account_id = p_user_id`, `first_paid_at IS NULL`, `p_amount_minor > 0` (never `p_assigns_plan`), row count to the flag, DROP and CREATE of the exact 18-type signature in one transaction, COMMENT, four REVOKEs, GRANT EXECUTE, the two-column UPDATE grant, NOTIFY, four scripts; 20261028 re-checked free | ✅ (W-2, W-3, W-4) |
| P5-C2 merge gate, lenient mapping | G-3; T4 maps missing or non-boolean to false with a warn, and a six-column row still maps | ✅ (gates P-5a.1, W-1) |
| P5-C3 side effects only from the flag, in `planPaymentApply.ts`, never throw | §3.2 and the `planPaymentApply.firstPayment` test | ✅ (W-5) |
| P5-C4 no TypeScript writer, boost guard | `firstPaymentStamp.guard.test.ts` | ✅ |
| P5-C5 one predicate, switch-matrix test | §3.1 | ✅ (W-8, W-9) |
| P5-C6 release only on the server re-read | §3.3: the marker changes the display only; `error` never redirects | ✅ (W-7) |
| P5-C7 the stamp audit once, no second serial flush | Q-1 | ✅ (W-6) |
| P5-C8 to P5-C10 | P-5b | n/a |
| P5-C11 registration | §3.5: `heldPaymentView.ts` is the one new importer; `PlanEmbeddedCheckout.tsx`, the page and the islands import nothing from the module | ✅ |
| P5-C12, S5-7 half | Comment in `config/invites.ts` (T6); §9.5 row 17 already updated | ✅ |
| P5-F3 | Pre-check P5 and P6, split by mode; stop and come to SA if either is not 0 | ✅ |
| P5-F4 | G-2 on day 1 | ✅ (W-1) |
| The P-3b checker's expected FAIL rows | §4.3: rows 81 and 83 FAIL by design, the 20261027 checker left unedited, C9 in the new checker, the §9.3 note (T13). The rollback restores both to PASS | ✅ |

**SQL paste rules.** The drafts are clean: no `--` comments, no "into" in any string, and labels and COMMENT text use spaces only. The underscores inside identifier literals (`'business_os_account_lineage'`, `'out_first_payment_stamped'`) follow the P-3b checker, which the user pasted without trouble. The body's `chr(95)` prefix checks come over verbatim. The `…` in §4.4's probe message is an elision in this document and must not reach the file (W-11).

**PostgREST `update` + `.or()` + `.select()`.** Not reachable in P-5a. The stamp is a plain SQL `UPDATE` inside the function. TypeScript only reads (`findHoldFactsForAccount`, `findByUser`) and calls the RPC, and the P5-C4 guard keeps it that way.

**Tenant isolation (`tenant-isolation-guard`).** This passes. The stamp, the post-commit lineage read and the audit entity are all keyed on the account our billing record resolved (SR-8), never on Stripe metadata or a request value. The screen keys every read on the session. `?checkout=` is display-only and pattern-checked. The service-role function stays SECURITY INVOKER, with a column grant on two columns only and no table-level UPDATE or DELETE (C7). There is one documentation gap: `findHoldFactsForAccount`'s comment says its id is "the session's". The webhook becomes a second caller, so the comment must name it (W-5).

**Body copy (verbatim + 3 changes).** This is the right approach. The three changes are one declaration (`v_stamped`), the flag set to false as the first statement, and the stamp block after the billing-row UPDATE and before the output assignments. The first statement matters: in plpgsql an OUT column starts as NULL, and every early return (`billing_row_missing` returns no row at all; the others `RETURN NEXT`) must report false, never NULL. The one point after the billing-row UPDATE is reached only by `applied` and `recorded`, which is exactly S5-3. The migration test proving "20261027 body plus exactly these three" is the verbatim proof, and the byte-equal rollback is the reverse proof.

### Rulings on Q-1 to Q-8

| # | Ruling |
|---|---|
| Q-1 | **Accepted: `logAndFlush(entry \| entry[], …)` and `RecordPlanChangeInput.companionEntries?`.** One chain link logs every entry in order and then flushes once. The single-entry call is unchanged for its 14 callers. Queueing through `AuditTrailService.log()` beforehand stays rejected for Dev's reason. Details in W-6 |
| Q-2 | **Accepted.** One post-commit `findHoldFactsForAccount(accountId)`, only when stamped, caught and never rethrown, `source: null` on failure. A second output column stays rejected (S5-3 keeps one). W-5 |
| Q-3 | **Accepted.** Add `'business_os_account_lineage'` to `AUDIT_ENTITY_TYPES`. There is no database CHECK on `entity_type`, so no migration |
| Q-4 | **Accepted.** `heldPaymentOffer` and `readHeldPaymentSwitches` go in `planCheckoutEligibility.ts`, with no new entitlements symbol in that file. `heldPaymentView.ts` is the one new registered importer (`TIER_MATRIX`, type `TierId`). W-9 |
| Q-5 | **Accepted, narrowed.** "Stuck" = held, plus a billing row for the current mode in `PAYING_SUBSCRIPTION_STATUSES`, plus `updatedAt` older than 5 minutes → `error` with `alert: true`. The page does **not** auto-refresh while stuck, so one manual load logs one alert, not up to 15. W-7 |
| Q-6 | **Accepted.** `NOTIFY pgrst, 'reload schema'` is the last statement, after `COMMIT`. It matches S5-3's "end with" and 20261041 to 20261043 |
| Q-7 | **Accepted, with the role rule in W-2.** Set-up (insert an `organic` row: level 1, root = self, no parent, no invite; or null an existing stamp) as the owner, then the scenarios as `service_role`, all rolled back |
| Q-8 | **Accepted.** Refusals are localized by `code`, never the server's English. `checkout_open` shows the local time from `expiresAt`. An unknown code shows a generic localized "could not start the payment, try again" line (W-10) |

### One PR or the split: **the split**

P-5a ships as **P-5a.1 "first payment stamp"** and then **P-5a.2 "Pay screen"**, never stacked (P-5a.2 branches from `main` after P-5a.1 merges). Reasons:

- The three merge gates fall on different halves. G-3 (production apply) concerns only the SQL. G-4 (he/es approval) and G-6 (live demo) concern only the screen. In one PR, a wait for wording approval or for a Stripe endpoint pause would hold back an inert, already-verified backend change.
- The review surfaces are different: a function replacement plus audit plumbing shared with 14 callers, against UI and i18n. Each half is about 1.7 to 1.8 days, which is the user's preferred slice size.
- P-5b keys on the flag and can be planned against a merged P-5a.1.

### Conditions

1. **W-1 Cut.** **P-5a.1** = T1 to T5, the P5-C4 guards from T10, `npm run test:bos-entitlements` (T5 edits `recordPlanChange.ts` inside the module), T11, and T13 for its part. It merges only after G-3. **P-5a.2** = T6 to T9, the `heldPaymentView.ts` registration, T11, T12 and T13, gated by G-4 and G-6. **T0's P5-F4 localhost check still runs on day 1 of P-5a.1** (scratch page, uncommitted), so a Referrer-Policy surprise is known before any UI work is planned on it. The `origin/main` merge and the 20261028 number re-check stay in T0, and the number is re-checked again before each PR. Each PR has its own §9.1 status line in the requirement.
2. **W-2 Probe roles.** Run F1 to F8 under `SET LOCAL ROLE service_role` (as `probe-bos-apply-plan-payment.sql` does), so the probe proves the **column grant** and not the owner's rights. Do the set-up row work as the owner, before switching. In the local PGlite run, the stand-in `service_role` must be `BYPASSRLS` like Supabase's. The lineage table has RLS on and no policy, so a non-bypass role's UPDATE matches 0 rows **silently**: F1 would read false, and running as the owner would hide a missing grant. Also make F3 deterministic: the same event id with a **different** invoice id → `already_recorded`, flag false (the same invoice id hits `already_applied` first). F6 resets the lineage stamp to NULL explicitly before its call. F7's in-transaction DELETE is safe, since nothing references the lineage table.
3. **W-3 Body and md5.** The migration test compares the 20261027 and 20261028 bodies after normalising line endings. Compute the C3 md5 the way P-3b computed `7ac579a4…`. If production's checker fails C3 on the md5 **alone**, stop and bring it to SA. Never edit the checker to match.
4. **W-4 Checker C10.** Join the money-history row on **both** `stripe_invoice_id = first_payment_ref` and `user_id = account_id` (S5-8's rule), so a reused ref cannot count another account's row.
5. **W-5 Stamp entry and lineage port.** When the flag is true, the stamp entry is **always** written: with the port missing, the read failing or the read throwing, it carries `source: null` and logs a warn, and it is never skipped. A future caller of the shared orchestration (the P-8b reconciler) therefore cannot drop the audit by not wiring the port. Update the header comment of `BusinessOsAccountLineageRepository.findHoldFactsForAccount` (and the file's "Slice 5b adds ONE account-scoped read" paragraph) to name the second caller: the webhook apply, with the account resolved from our billing record (SR-8), never from Stripe metadata or a request.
6. **W-6 Flush widening.** An empty list resolves with no `log()` and no `flush()`. For a list, the timeout and failure logs carry `actions: [...]`. The single-entry log fields stay byte-identical, so the existing `boundedAuditFlush` tests and the admin route suite pass **unedited**. Companion entries take `userId`, `actorId` and `details.actor` from `recordPlanChange` by the same rule as the main entry. Callers cannot set them (the `Pick` already excludes them, so keep it that way). The `AUDIT_EVENTS` lookup applies to them too, and the main entry is logged first.
7. **W-7 Screen states.** (a) `processing` from the billing row uses `LIVE_SUBSCRIPTION_STATUSES`, the set SR-5 refuses on, so the screen never shows Pay where the server answers `subscription_live`. (b) Stuck = Q-5, with no auto-refresh while stuck. A live but non-paying status (for example `incomplete` or `unpaid`) older than 5 minutes shows the "taking longer" line at once, with a `warn` and no alert. (c) When the processing came from the return marker alone, the "taking longer" line includes a link to `/invite/awaiting-payment` **without** the marker. That page shows Pay again if nothing is live, so a stale or bookmarked marker cannot trap a friend on "processing".
8. **W-8 The matrix test drives the real checkout.** The price-switch refusal lives at `planCheckout` step 4 and the checkout switch at the route, not in `planCheckoutEligibility`. So "admitted" means the route gate plus `planCheckout(...)` reaching the Stripe create, with injected switches and a stubbed hold, billing and Stripe. Testing `planCheckoutEligibility` against `heldPaymentOffer` alone would be tautological, since one calls the other.
9. **W-9 Switch reader.** `readHeldPaymentSwitches` imports `isPlanCheckoutEnabled` from `planCheckoutFlag.ts` and `isPlanPriceRecognitionEnabled` from `planPricesFlag.ts`, not from `planCheckout.ts`. `heldPaymentOffer` stays pure. The file header changes from "Pure" to "pure except `readHeldPaymentSwitches`". The `enforcementPoints` entry for `planCheckoutEligibility.ts` stays unchanged, and `test:bos-entitlements` proves it.
10. **W-10 Refusal copy.** Every refusal code the route can return to this screen gets an en/he/es line, plus the generic fallback (Q-8). The render test covers the fallback.
11. **W-11 Paste rules in the final files.** The T3 test scans all five SQL files: no `--`, no "into" in a string, and no punctuation in a string beyond the identifier underscores the P-3b scripts already use. The probe's final `RAISE EXCEPTION` text is words and spaces only (no ellipsis, no colon).
12. **W-12 Records.** The requirement records P-5a.1 and P-5a.2 as separate §9.1 status lines. The §9.3 20261028 row gets the "P-3b checker rows 81 and 83 read FAIL by design" note and, after G-3, the applied state. The Change History is spliced at each stage. The G-2, G-3 and T2 results are recorded in this workplan.

### Optimisation suggestions (non-blocking)

- `heldPaymentView.ts` needs `LIVE_SUBSCRIPTION_STATUSES`, which lives in `planCheckout.ts` (Stripe-side dependencies). Moving the constant beside `PAYING_SUBSCRIPTION_STATUSES` in `payingSubscriptionStatuses.ts` (re-exported from `planCheckout.ts`) keeps the screen's import graph small. Dev's call.
- `planPriceCheck.ts` already builds a tier-to-price map from `presentation`. Reuse it if it fits, but the plan-name labels still need `TIER_MATRIX`, so the new importer stays either way.

### Approval

[x] Workplan approved with conditions W-1 to W-12. Dev may start **P-5a.1** (T0 day-1 checks, then T1 to T5). P-5a.2 starts from `main` after P-5a.1 has merged.

### SA Code Review — P-5a.1 (2026-10-11)

**Code Review by SA, 2026-10-11.** Worktree `neuronforge-invite-s1`, branch `feature/bos-plan-payments-p5`, uncommitted on `3c709fe5`.
**Status: ✅ APPROVED WITH FIXES.** One comment fix applied by SA (below). Nothing blocks QA. The merge gates are unchanged: G-3 on production, and the `origin/main` merge with `eventAudience.test.ts` at 53 / 198.

**What was checked, and how**

| Area | Result |
|---|---|
| Migration 20261028 | ✅ `BEGIN`, `SET LOCAL lock_timeout = '5s'` (D-5, as 20261027), a DROP of the exact 18-type signature, CREATE, COMMENT, four REVOKEs, GRANT EXECUTE to `service_role`, `GRANT UPDATE (first_paid_at, first_payment_ref)` only, `COMMIT`, and `NOTIFY` last. The line-ending-normalised diff against 20261027 is exactly the seventh output, `v_stamped`, the flag initialised to false as the first statement, the stamp block after the billing-row UPDATE, the COMMENT suffix, the column grant and the NOTIFY. Body md5s were computed independently: 20261027 = `7ac579a4…` (pre-check P1), 20261028 = `08b50586…` (checker C3), rollback = `7ac579a4…` |
| Stamp rule | ✅ The block is reached only after the fresh `invoice_paid` INSERT, so only by `applied` / `recorded`. Every early return comes before it, with the flag already false. It is keyed on `p_amount_minor > 0` (never `p_assigns_plan`), with `WHERE account_id = p_user_id AND first_paid_at IS NULL` and `ROW_COUNT = 1`. SECURITY INVOKER is kept. `service_role` already has SELECT on the lineage table, which the UPDATE's WHERE needs, and pre-check P4 pins that |
| Paste rules (5 files) | ✅ Scanned by SA as well as by the test. No `--`, no `/*`, no "into" outside `INSERT INTO`, and every string literal is `[A-Za-z0-9_ ]` only. The probe's final message has no colon and no ellipsis |
| Pre-check / checker / probe / rollback | ✅ The checker's C1 to C8 follow the P-3b checker's conventions (`aclexplode`, owner excluded, `INSERT SELECT` exact). C10 joins on both invoice and account (W-4). The probe runs F01 to F08 and F10 as `service_role`, does its set-up as the owner, makes F03 deterministic, resets F06 explicitly and refuses an account with a live billing row (W-2). The rollback is byte-equal to 20261027 for the function, its comment and its grants, and revokes only the two-column grant |
| Exactly-once audit | ✅ Driven by the flag only (`=== true`). The lineage read happens only when stamped and never throws. The entry is always written, with `source: null` when the source cannot be read (W-5). `recordPlanChange` is wrapped (D-4), so nothing after the apply throws. One `logAndFlush` call with `[main, stamp]`, main first. A single entry keeps the exact original chain and log fields (W-6), and the existing flush and admin suites run unedited |
| Tenant isolation | ✅ The stamp, the lineage read and the audit `userId` are all the account resolved from our billing record (SR-8). A companion entry cannot set its own `userId`, actor or `details.actor`. The lineage repository header names both callers (W-5) |
| Entitlements | ✅ No new importer. `recordPlanChange.ts` is inside the module, and `planPaymentApply.ts` imports the same symbols as before. `npm run test:bos-entitlements`: **237 suites, 6641 tests, 0 failed** (SA run) |
| Logging | ✅ Pino only. None of the touched product files uses `console.*` |

**Suites run by SA:** `lib/business-os/billing`, `app/api/stripe`, `lib/audit`, `lib/business-os/entitlements`, `supabase/migrations/__tests__`, the billing-event / billing-account / lineage repository tests, `app/api/admin/business-os/entitlements` and `lib/business-os/boost`: **149 suites, 4771 tests, 0 failed.** Then `test:bos-entitlements` as above. The PGlite run was not repeated. Dev's T2 record (with mutations M1 to M6 and S1 to S5) stands, and SA re-derived the md5s and the body diff independently.

**Mutation checks by SA** (each was applied, run, then restored from a scratch copy, and every file was md5-verified back to Dev's text):

| Mutation | Result |
|---|---|
| The single-entry flush logs `actions: [...]` instead of `action` | Killed (2 tests, `boundedAuditFlush`) |
| A list flush drops its `log()` calls | Killed (12 tests) |
| The stamp entry is skipped when the lineage port is not wired (a W-5 violation) | Killed (1 test) |
| A missing flag is read as `true` | Killed (1 test, the repository) |
| A companion entry always takes the platform actor (admin rule broken) | Killed (1 test, `recordPlanChange`) |

**Rulings on Dev's deviations**

| # | Ruling |
|---|---|
| D-1 | **Accepted, and it is the narrowest correct allowance.** `boostCheckoutDeps.ts` already wires the lineage repository on `main`, as a hold reader. The guard pins that one file and exactly its two occurrences (the import and `holdReaders: { lineage:`). Guard 2 pins that the repository has no write call. Every other forbidden name stays absent from every boost file |
| D-2 | **Accepted.** It is required by Q-2. The allow-list grows by exactly one specifier in the two files that need it. `planPaymentApply.ts` imports it with `import type` (a port type). The router guard does not distinguish a type-only import from a value import. That gap is pre-existing and applies equally to the two billing repositories (see O-2) |
| **D-3** | **Ruled: `'owner'`.** The entry is a fact about the owner's own payment: their invoice id, their money-history row id, their lineage source (which they already know), the mode and the event id. It carries no internal reason and nothing about another account. `business_os_billing_account` and `business_os_boost_purchase` are already owner-visible on the same reasoning. `'operator'` would add an owner-policy migration and a production apply gate to hide data that belongs to the reader, which is disproportionate. This is not a business question. **Forward condition (binding on P-13 and P-5b):** visibility is decided by entity type, so every later entry on `business_os_account_lineage` is owner-readable too. P-13's `BOS_INVITE_PAYMENT_WAIVED` (an admin actor) and P-5b's "not notified" outcome must use an operator entity type, or reclassify this one together with the owner-policy migration. This is recorded in the `ownerVisibility.ts` comment (fix F-1). TL/BA to carry it into the requirement's P-13 and P-5b rows |
| D-4 | Accepted (S5-5 b; it changes no current path) |
| D-5 | Accepted (it matches 20261027) |
| D-6 | Accepted. VERDICT first and `md5(replace(prosrc, chr(13), ''))` everywhere match the P-3b scripts (W-3) |
| D-7 | Accepted (paste rule) |
| D-8 | Accepted. A raised SQLSTATE is reported per scenario instead of ending the probe with a raw error |
| D-9 | Accepted (W-1 places it in P-5a.2) |

### Code Review Comments

1. `lib/audit/ownerVisibility.ts:89-94`: the comment still said "flagged to SA" and did not warn that the classification binds every later entry on this entity type. Priority: Low. **Fixed by SA (F-1)**: the comment now records the D-3 ruling and the forward condition for P-13 and P-5b. Comment only. `ownerVisibility` and the P5-C4 guard re-run green (37/37).

No other comment. Every W-condition in P-5a.1's share (W-2 to W-6, W-11, W-12) is met.

### Optimisation Suggestions (non-blocking)

- **O-1 Make the pre-check predict C7.** Pre-check P4 checks the client roles and `service_role` column reach, but not what C7 is strict about: any non-owner role holding UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN at table level, or any column ACL that already exists. The 20261014 checker did not check those either. If production has such a grant, it shows up only **after** the apply, as a C7 FAIL. Handling if that happens: C7 failing on `change holders` or the column-grant listing alone, with C6 PASS, comes from a grant that predates 20261028. Stop and bring it to SA, as W-3 says for the md5. Do not edit the checker. Adding a P-row that mirrors C7's table part would surface it before the apply. It is cheap, but not required.
- **O-2** `routerPlacement.guard.test.ts` could pin that the use-case files (`planPaymentApply.ts` and the others) import repositories **type-only**. The gap is pre-existing.
- **O-3** Companion entries carry no `request` block. That is correct for the webhook. If an admin caller ever passes companions, copy `request` to them by the same rule as the main entry.
- **O-4** The post-commit lineage read is unbounded, as is every repository read today. It is a primary-key read, so this is acceptable now. When P-5b adds the N-2 send under N-1's 4 s deadline, put the read inside the same bound.

### For QA

- **G-3 on production, in order:** pre-check in its own tab (P5 = P6 = 0, VERDICT PASS), then the migration in a **new** tab, then the checker (VERDICT PASS 8/0), then the probe on a test account with no live billing row (PROBE PASS F01 to F10). If C3 fails on the md5 alone, or C7 fails as O-1 describes, **stop and bring it to SA**. After the apply, the P-3b checker reads rows 81 and 83 FAIL by design, and only those two rows.
- **Exactly once:** the stamp entry is written once per stamp. A replay writes nothing, and a missing lineage read still writes the entry with `source: null`. Losing the entry on a 2 s flush timeout is accepted, because the lineage row is the durable record and a retry answers `already_applied`. Confirm this is pinned by `planPaymentApply.firstPayment.test.ts` and `boundedAuditFlush.list.test.ts`, and do not expect a production audit row: the slice is inert until the switches are on.
- **Inertness:** with `BUSINESS_OS_PLAN_PRICES_ENABLED` off, nothing calls the function on production. The code reads the 20261027 six-column answer as "not stamped" with a warn (P5-C2), so a code deploy before or after G-3 is safe either way.
- **After the `origin/main` merge:** `lib/audit/__tests__/eventAudience.test.ts` must read 53 Business OS / 198, and the requirement merge conflict must be resolved as text.

### Code Approved for QA: Yes

---

## Implementation Notes (P-5a.1)

**Dev, 2026-10-11.** Branch `feature/bos-plan-payments-p5`, worktree `neuronforge-invite-s1`, base `3c709fe5`. Everything is uncommitted. P-5a.2 (T6 to T9) is not built.

### T0: day-1 checks

| Check | Result |
|---|---|
| Merge `origin/main` (`a66b4c41`) | **Not done.** `git merge origin/main` refused: `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` has today's uncommitted edits and main changed the same file (#299 P-3b row and CF-2). Per instruction, no stash. The merge is left to TL/RM. Expected conflicts afterwards: that requirement file (text), and `lib/audit/__tests__/eventAudience.test.ts`, where main's TC-1 also bumps the count (main 52 / 197, this branch 52 / 197; **after the merge it must read 53 Business OS / 198**). `lib/audit/events.ts`, `eventAudience.ts` and `enforcementPoints.test.ts` change in different places and should merge cleanly |
| 20261028 still free | ✅ `git ls-tree origin/main supabase/migrations/` on `a66b4c41`: 20261027 then 20261030; highest 20261051 |
| **G-2 / P5-F4** Referrer-Policy | **Static check only; the live check is owed to TL.** No browser is available to Dev here. What was verified in the code: `/invite/*` gets `Referrer-Policy: no-referrer` from `middleware.ts` (header) and `app/invite/layout.tsx` plus `app/invite/awaiting-payment/page.tsx` (metadata); there is **no** Content-Security-Policy and no Cross-Origin-Opener-Policy on that path (layout header comment, and no CSP in the repo), so nothing blocks `js.stripe.com` or the `checkout.stripe.com` frame. The only difference from the harness is the absent Referer header on Stripe's requests. No Stripe document found says the embedded checkout needs it, and none says it works without it. **Live check (TL, localhost, uncommitted scratch page under `/invite/`, both payment switches on):** mount the harness `PlanCheckoutPanel`, confirm `EmbeddedCheckout` renders and a `4242` card completes. If it fails, the SA-pre-approved fallback is `strict-origin` for `/invite/awaiting-payment` only, in middleware and page metadata together. This does not block P-5a.1 (no UI), but it must be known before P-5a.2 is planned on it |

### T2: the PGlite run (W-2, W-3)

PGlite 0.2.17 (PostgreSQL 16.4), from a scratch install outside the repo. Stub roles `anon`, `authenticated`, and `service_role` **with BYPASSRLS** (Supabase's). Stub `auth.users` and plan table as in P-3b. The lineage table built from the exact 20261014 and 20261024 statements, then the full 20261025 and 20261027 files. One owner account with a plan row.

| Step | VERDICT |
|---|---|
| Pre-check before 20261028 | **PASS** 6 pass 0 fail, "run the migration in a NEW tab" (P5 = 0, P6 = 0) |
| P-3b checker before 20261028 | PASS 16/0 |
| 20261028 applied | applied |
| **20261028 checker** | **PASS 8 pass 0 fail** (C3 md5 `08b505862f2ac749c259ac852e1c9947`) |
| Pre-check after 20261028 | FAIL as designed (P1, P2, P4) |
| **Probe**, account with no lineage row | **PROBE PASS** F01 to F10 (F00: an organic row added for the probe); nothing persisted (rows before = after) |
| **Probe**, account with an existing, already-stamped lineage row | **PROBE PASS** F01 to F10 (F00: stamp cleared for the probe); the original stamp `in_previous` is still there afterwards |
| P-3b checker after 20261028 | FAIL **on rows 81 and 83 only** (by design, §4.3); 14 others PASS |
| Rollback | applied; P-3b checker back to PASS 16/0; pre-check PASS again; 20261028 checker FAIL (C2, C3, C5, C6, C7); **the written stamp is kept** |
| 20261028 re-applied after the rollback | checker PASS 8/0 |

**Mutations (each must turn the probe or the checker red):**

| Mutation | Result |
|---|---|
| M1 no column grant | PROBE FAIL (F01 to F04, F06, F07 raise 42501) |
| M2 stamp keyed on `p_assigns_plan` instead of `p_amount_minor > 0` | PROBE FAIL (F05) |
| M3 the `first_paid_at IS NULL` condition removed | PROBE FAIL (F04) |
| M4 the flag initialisation removed | PROBE FAIL (F02, F03, F05, F08 report NULL) |
| M5 `service_role` without BYPASSRLS (W-2) | PROBE FAIL (every call answers `billing_row_missing`: the stand-in must bypass RLS, as Supabase's does, or the run proves nothing) |
| M6 table-level UPDATE instead of the column grant | PROBE FAIL (F10) |
| S1 table UPDATE to service_role / S4 column UPDATE on `level` / S5 DELETE to service_role | checker FAIL on C7 |
| S2 SELECT to authenticated | checker FAIL on C8 |
| S3 EXECUTE to authenticated | checker FAIL on C4 |
| Pre-check with an unstamped lineage account that has a paid test invoice above $0, then also a live one | FAIL on P5, then on P5 and P6. A $0 paid row alone: PASS |

PGlite does not reproduce Supabase's default grants (covered by the explicit REVOKEs) or concurrency. The production pre-check, checker and probe at G-3 remain the proof.

### What was built

| Area | Files |
|---|---|
| Migration and scripts | `supabase/migrations/20261028_business_os_first_payment_stamp.sql`; `scripts/precheck-bos-first-payment-stamp-migration.sql`; `scripts/check-bos-first-payment-stamp-migration.sql`; `scripts/probe-bos-first-payment-stamp.sql`; `supabase/SQL Scripts/20261028_business_os_first_payment_stamp_rollback.sql` |
| Migration test (T3, W-3, W-11) | `supabase/migrations/__tests__/business-os-first-payment-stamp.migration.test.ts`: paste rules over all five files; body = 20261027 body + the three pieces (string equality after CRLF normalisation); rollback function, comment and grants byte-equal to 20261027; checker md5 computed as P-3b computes it; C10 joins on both keys (W-4); probe roles (W-2) |
| Repository (T4, P5-C2) | `BusinessOsBillingEventRepository.ts`: `firstPaymentStamped` on `applied` / `recorded`; a missing, NULL or non-boolean value reads as `false` with a warn (`bos_billing_first_payment_flag_unreadable`), never an error |
| Flush (Q-1, W-6) | `lib/audit/boundedAuditFlush.ts`: `logAndFlush(entry \| entry[])`. One entry: the same chain hops and the same log fields as before (the existing suite passes unedited). A list: logged in order in ONE chain link, then one `flush()`; an empty list does nothing; timeout and failure logs carry `actions: [...]`. New `boundedAuditFlush.list.test.ts` |
| Plan change (Q-1, W-6) | `recordPlanChange.ts`: `companionEntries?` (`PlanChangeCompanionEntry` = action, entity type, entity id, details, severity). User, actor and `details.actor` come from the main rule; the `AUDIT_EVENTS` lookup applies; the main entry is first. No companion: the single-entry form, exactly as before (the admin route suite runs unedited) |
| Audit registry (A-2, Q-3) | `BOS_BILLING_FIRST_PAYMENT_STAMPED` in `events.ts` (info, SOC2) and `eventAudience.ts` (`bos`); entity type `business_os_account_lineage` in `types.ts`; `ownerVisibility.ts` classifies it `'owner'` (see deviation D-3) |
| Apply (S5-4, S5-5, W-5) | `planPaymentApply.ts`: optional `lineage` port; on `applied` / `recorded` with the flag true, one lineage read (never throws: `source: null` + warn on a missing port, an error, no row or a throw) and the stamp entry as a companion of the invoice-paid entry; `bos_billing_first_payment_stamped` logged at info with ids only. The `recordPlanChange` call is wrapped so nothing after the apply throws. `planBillingHandler.ts` wires `businessOsAccountLineageRepository` |
| Lineage repository header (W-5) | `BusinessOsAccountLineageRepository.ts`: the second caller of `findHoldFactsForAccount` named, with the account from our billing record (SR-8) |
| Guards (P5-C4) | `lib/business-os/billing/__tests__/firstPaymentStamp.guard.test.ts` (14 tests) |
| Tests (§8 "Exactly once") | `planPaymentApply.firstPayment.test.ts` (17 tests, real `recordPlanChange` and real bounded flush over a recording sink; includes the end-to-end double delivery through the real `createPlanBillingHandler`). Mutation bite checks: forcing the companion on every result and making the lineage read rethrow each fail 2 tests |
| Allow-lists updated | `routerPlacement.guard.test.ts` (the handler and the apply import the lineage repository; see D-2); the caller guards of `BusinessOsBillingEventRepository.test.ts` and `BusinessOsBillingAccountRepository.test.ts` (the new test files); `planPaymentApply.test.ts` fake returns `firstPaymentStamped: false` (type only) |

### Deviations and points for SA

| # | What | Why |
|---|---|---|
| D-1 | **The boost guard allows `boostCheckoutDeps.ts` to name the lineage repository.** §8 says no boost file names `BusinessOsAccountLineageRepository` | It already does on main: the boost checkout reads the payment HOLD through `findHoldFactsForAccount` (a held account may not buy a boost). The guard pins that it is that one file, used only as `holdReaders: { lineage: … }`, and the repository has no write method (pinned by the same guard). Every other forbidden name (the lineage table, both columns, the apply function, `applyPlanPayment`, the billing-event repository) is absent from every boost file |
| D-2 | `routerPlacement.guard.test.ts` changed: `planBillingHandler.ts` and `planPaymentApply.ts` now import `@/lib/repositories/BusinessOsAccountLineageRepository` (the handler wires it; the apply names it as a port TYPE) | Required by Q-2 (the lineage read). Not listed in the workplan's file table |
| D-3 | **`business_os_account_lineage` is classified `'owner'` in `ownerVisibility.ts`**, so the account owner can read the stamp entry back | The map must classify every entity type. `'operator'` would need a new owner-policy migration on `audit_trail` (the latest policy's `NOT IN` list must equal the operator set), which SA's Q-3 ruling ("no migration") did not include. The entry carries the owner's own invoice id, money-history row id, lineage source, mode and event id: no internal reason and nothing about another account. Note that `BOS_BILLING_INVOICE_PAID` (entity `business_os_account_plan`) stays hidden from the owner. **SA to confirm `'owner'`, or rule `'operator'` plus a migration** |
| D-4 | `afterApply` wraps `recordPlanChange` in a try/catch that logs `bos_billing_invoice_audit_failed` at error with `alert: true` | S5-5 b and §8 ("`recordPlanChange` rejecting → resolves"). Before, a rejection would have released the claim; `recordPlanChange` never rejects by contract, so this changes no current path |
| D-5 | The migration also sets `SET LOCAL lock_timeout = '5s'` after `BEGIN` | As 20261027 does, so the DROP and the column GRANT cannot queue forever behind a long lock. The §4.1 sketch did not show it |
| D-6 | VERDICT is the first row (sort 0) in the pre-check and the checker, as in the P-3b scripts, not row 999 as the §4.2 draft showed. The pre-check uses `md5(replace(prosrc, chr(13), ''))` (the P-3b checker's form, W-3), not the draft's `md5(prosrc)` | Same reading for the user as P-3b; the md5 must be computed the same way everywhere |
| D-7 | C3 checks `position('first_paid_at IS NULL' …)` without the `lineage_row.` alias | A dot inside a string breaks the paste rule (letters, digits, underscores, spaces only) |
| D-8 | The probe wraps every apply call in `BEGIN … EXCEPTION WHEN OTHERS`, so a raised error (e.g. a missing grant, 42501) reports `F0n FAIL raised 42501` instead of ending the probe with a raw error | Found by mutation M1 |
| D-9 | The S5-7 comment in `config/invites.ts` is **not** in P-5a.1 | W-1 places it in T6 (P-5a.2) |

### T11: checks run

| Check | Result |
|---|---|
| Jest, affected scope (`lib/business-os/billing`, `app/api/stripe`, `app/api/business-os/billing`, `app/api/admin/business-os/entitlements`, `lib/business-os/invites`, `lib/audit`, `lib/business-os/boost`, `app/api/business-os/credits/boost`, `supabase/migrations/__tests__`, `lib/repositories/__tests__`, `lib/business-os/entitlements`) | **251 suites, 7195 tests, 0 failed** |
| `npm run test:bos-entitlements` | **237 suites, 6641 tests, 0 failed.** One earlier full run had one timeout in `app/admin/users/__tests__/businessOsPanel.render.test.tsx` (QA-P7) under load; it passes alone (23/23) and on the re-run; not touched by this change |
| `npm run typecheck:bos-llm` | **passed**: 494 files in scope, 28 errors, **0 new** (it reports one baseline entry already fixed, unrelated) |
| Scoped `tsc` over the 22 touched TypeScript files | **0 diagnostics** |
| ESLint over the touched files | 0 errors; 6 warnings, all pre-existing (`any` in `lib/audit/types.ts`, an unused `_` in `events.ts`) |
| `npm run lint:hooks` | clean |
| `git diff --stat` | 18 tracked files, +653 / −83, no deletion without insertion; 10 new files |

### Open before P-5a.1 can merge

- G-3: the user runs, on production, the pre-check (P5 and P6 = 0, VERDICT PASS), then 20261028 in a NEW tab, then the checker (VERDICT PASS), then the probe on their own account (PROBE PASS). Recorded here and in requirement §9.3.
- The `origin/main` merge (T0), with the `eventAudience.test.ts` count fixed to 53 / 198.
- The P5-F4 live check (G-2) before P-5a.2 is planned.
- SA: D-3 (owner visibility of the stamp entry), and D-1, D-2.

---

## QA Testing Report

**QA — 2026-10-11 (P-5a.1 "first payment stamp")**
**Test mode:** full (P-5a.1 only; P-5a.2 is not built)
**Strategy used:** A (Jest unit and source guards, in memory) + C (independent paste-rule scan script over the five SQL files) + mutation checks. No real database and no Stripe calls, as instructed. The SQL behaviour rests on Dev's recorded PGlite T2 run (no harness is reachable from the repo: Dev's PGlite was a scratch install outside it, and `package.json` has no PGlite), plus the production G-3 run below.
**Focus:** api (webhook apply), schema (migration and scripts), security (tenant isolation, single SQL writer)
**Skipped:** the browser check (no UI in P-5a.1); the PGlite re-run (not reachable, see above); the `origin/main` merge (deferred to after commit, per instruction)
**Input source:** prompt (TL) + SA's "For QA" list

### Test Coverage

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| First paid invoice stamps once; the stamp entry is written with the invoice-paid entry, main first, ONE flush | ✅ | Pass | `planPaymentApply.firstPayment.test.ts`: `applied` and `recorded` with the flag true give exactly `log:INVOICE_PAID, log:FIRST_PAYMENT_STAMPED, flush`; entry shape pinned (lineage entity, account, platform actor, ids only, no email) |
| Replay → `already_applied` / `already_recorded`: no second stamp, no audit, no lineage read | ✅ | Pass | Unit (both replay statuses) and end to end through the real `createPlanBillingHandler` (same invoice twice: 1 stamp entry, 1 invoice entry, 1 flush, 1 lineage read) |
| Renewal (account already stamped) → flag false, no stamp entry | ✅ | Pass | TS: "applied, flag false" and "recorded, flag false" write only the invoice entry and read no lineage. SQL: probe F04 (Dev's T2 run) |
| $0 invoice → no stamp | ⚠️ | Pass (SQL side) | The rule lives in SQL only (`p_amount_minor > 0`). Pinned statically by the migration test (S5-3 / P5-F1, never `p_assigns_plan`) and dynamically by probe F05 and mutation M2 in Dev's T2 run. In TS it is the same path as "flag false" |
| Missing lineage row → no stamp, flag false | ⚠️ | Pass (SQL side) | Probe F07 (T2). In TS, a flag of true with no row readable still writes the entry with `source: null` (W-5), tested |
| Lineage read failure after the stamp → entry with `source: null` + warn | ✅ | Pass | Four cases: port not wired, read error, no row, read throws. Each: one entry, `source: null`, one `bos_billing_first_payment_source_unread` warn, one flush, apply resolves |
| Missing / NULL / non-boolean flag (20261027 six-column answer) → false + warn | ✅ | Pass | Repository test: six-column row → `firstPaymentStamped: false` + `bos_billing_first_payment_flag_unreadable` (`present: false`); NULL and non-boolean values likewise. Apply test: an answer with no flag writes no stamp entry and reads no lineage |
| Nothing throws after the apply commits | ✅ | Pass | A rejecting `recordPlanChange` is logged at error with `alert: true` and the apply resolves; a throwing lineage read plus a rejecting `recordPlanChange` still resolves (no `PlanPaymentRetryError`) |
| `logAndFlush` single-entry form byte-identical | ✅ | Pass | `boundedAuditFlush.test.ts` and the admin route suites are **unedited** (`git status`: not modified) and pass. `boundedAuditFlush.list.test.ts` pins that one entry keeps `action` (not `actions`). Code read: one entry returns `sink.log(entry)` itself, so the chain hops are unchanged |
| `logAndFlush` list form / empty list | ✅ | Pass | In order, first first, ONE flush; one chain link (a later caller waits for the whole list); failure swallowed with every action named; hung flush released at the bound; empty list: no `log()`, no `flush()` |
| P5-C4 guard bites on a TS writer of `first_paid_at` | ✅ | Pass | Mutation A: a new file `lib/business-os/billing/zzQaStampWriter.ts` with `.from('business_os_account_lineage').update({ first_paid_at })` → **2 failed / 14**; file deleted, guard back to 14/14. Mutation B: a write call appended to `BusinessOsAccountLineageRepository.ts` → **2 failed / 14**; restored from a scratch copy (not git), md5 `fd90abde…` before = after, 14/14 |
| Paste rules on the five SQL files | ✅ | Pass | Independent scan (my own script, not the test): every file has no `--`, no `/*`; 525 string literals in total, all `[A-Za-z0-9_ ]`; "into" never appears except as `INSERT INTO`. Mutation C on the checker (`--` line + "into" and a colon in a label) → migration test **3 failed / 61**; restored from a scratch copy, md5 `12fa5759…` before = after, 61/61 |
| Pre-check, checker, probe, rollback readable for G-3 | ✅ | Pass | Read in full. Pre-check: read-only first statement, VERDICT row first with "run the migration in a NEW tab" or "do not run the migration". Checker: C1–C8 PASS/FAIL, C9–C11 INFO, VERDICT first. Probe: refuses a placeholder id, a read-only session, a missing 20261028, an unknown user, an account without a plan row, and an account with a live billing row; ends with `PROBE PASS` / `PROBE FAIL` as an exception that rolls everything back. Rollback: 20261027 body back, column grant revoked, stamps kept |
| SQL behaviour (F01–F10, checker 8/0, rollback) | ⚠️ | Not re-run | Relies on Dev's recorded T2 PGlite run (pre-check PASS, checker PASS 8/0, PROBE PASS with and without a lineage row, M1–M6 and S1–S5 all red) and SA's independent md5 re-derivation. Production proof is G-3 |
| Entitlements registration | ✅ | Pass | `npm run test:bos-entitlements`: 237 suites, 6641 tests, 0 failed |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The post-commit lineage read is one primary-key read, only when the flag is true (SA O-4 already records the P-5b bound).

#### Edge Cases (nice to fix)
1. **The P5-C4 guard is a text scan.** It catches the column names in any product file and any query-builder write in the known files. It would not catch a writer that builds the column name dynamically, or one that calls a different RPC that stamps. Acceptable: SQL is the only writer and the grant is column-scoped to `service_role` (checker C6/C7). Severity: Low. No action.
2. **The probe needs an account that has a Business OS plan row** (it says so and stops with `PROBE SKIPPED` otherwise). The runbook below says this, so the user is not surprised.
3. `lib/repositories/BusinessOsBillingEventRepository.ts` is LF in the working copy (git warns it will become CRLF). Cosmetic. RM may see the warning at commit.

### Test Outputs / Logs

```text
Affected suites: lib/business-os/billing, app/api/stripe/webhook, lib/audit, lib/business-os/entitlements,
  supabase/migrations/__tests__, lib/repositories/__tests__, lib/business-os/boost, app/api/business-os/credits/boost
Test Suites: 228 passed, 228 total
Tests:       6426 passed, 6426 total

npm run test:bos-entitlements
Test Suites: 237 passed, 237 total
Tests:       6641 passed, 6641 total

npm run typecheck:bos-llm
typecheck-bos-llm: 494 files in scope, 28 errors, 0 new (167.4s)
typecheck-bos-llm: 1 baseline entry is fixed (app/api/onboarding/build/route.ts TS18047, unrelated)
typecheck-bos-llm: passed

Mutations (all restored; tree back to 18 modified + 10 new, +659 / -83):
  A  new TS writer of first_paid_at            -> firstPaymentStamp.guard 2 failed / 14
  B  write call in the lineage repository      -> firstPaymentStamp.guard 2 failed / 14
  C  "--", "into", ":" in the checker          -> first-payment-stamp.migration 3 failed / 61
```

### G-3 runbook (production, by hand, in this order)

Each file is one paste. Use the Supabase SQL editor.

1. **Pre-check.** Open a tab, paste `scripts/precheck-bos-first-payment-stamp-migration.sql`, run. The top row must read `VERDICT PASS … run the migration in a NEW tab`, and rows P5 and P6 must show 0. This tab is now read-only; do not use it again.
   *If it fails:* stop. Do not run the migration. P1 failing means the live function is not the 20261027 one; P2 failing means 20261028 is already applied; P5 or P6 above 0 means accounts were paid before the stamp existed. Bring the screen to SA. No backfill is written in advance.
2. **Migration.** Open a **new** tab, paste `supabase/migrations/20261028_business_os_first_payment_stamp.sql`, run. It runs in one transaction: it either applies whole or not at all.
   *If it errors* (for example a lock timeout after 5 s): nothing was applied. Run it once more in a new tab. If it errors again, stop and bring it to SA.
3. **Checker.** New tab, paste `scripts/check-bos-first-payment-stamp-migration.sql`, run. The top row must read `VERDICT PASS 8 pass 0 fail`.
   *If it fails:* stop and bring it to SA. Do not edit the checker. If C3 fails on the md5 alone, or C7 fails on a grant while C6 passes, it is an older grant or a body difference that SA must judge (SA O-1). If the function itself is wrong, the rollback is `supabase/SQL Scripts/20261028_business_os_first_payment_stamp_rollback.sql`, but only on SA's say-so.
4. **Probe.** New tab, paste `scripts/probe-bos-first-payment-stamp.sql`. Replace `PASTE_YOUR_OWN_USER_ID_HERE` with the id of a **test account** that has a Business OS plan row and **no live-mode billing record**. Run. The result is an error message on purpose: it must start with `PROBE PASS  this error is expected and rolls everything back`, followed by F00 INFO and F01 to F10, each PASS. Nothing is kept.
   *If it says `PROBE SKIPPED`:* follow the sentence it prints (wrong id, read-only tab, no plan row, or a live billing record) and run it again. *If it says `PROBE FAIL`:* stop, copy the whole message, bring it to SA.
5. **Expected afterwards:** the older P-3b checker (`scripts/check-bos-billing-events-migration.sql`) now reads FAIL on rows **81 and 83 only**. That is by design (the function gained a seventh output and now names the lineage table). Every other row still passes. Any other row failing: stop, SA.
6. Record the four results in requirement §9.3 and this workplan. Only then may P-5a merge. Order with the code deploy does not matter: with `BUSINESS_OS_PLAN_PRICES_ENABLED` off nothing calls the function, and the code reads the old six-column answer as "not stamped".

### Notes for TL / RM
- After the `origin/main` merge, `lib/audit/__tests__/eventAudience.test.ts` must read **53 Business OS / 198**; not done here, as instructed.
- The P5-F4 live Referrer-Policy check (G-2) is still owed before P-5a.2 is planned; not in this slice.

### Final Status
- [x] All acceptance criteria for P-5a.1 pass in memory; the SQL side rests on Dev's T2 run and must be proven on production at G-3. **Verdict: PASS WITH NOTES.** Ready for commit after user review of the diff; merge gated on G-3 and the `origin/main` merge.
- [ ] Issues found — Dev must address before commit

---

## Commit Info

*(RM to fill.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-11 | Workplan written (Dev) | P-5a per §9.1.1 and the SA review of the P-5 scoping (P5-C1 to P5-C7, P5-C11, S5-7). 20261028 re-confirmed free on `origin/main` `a66b4c41`. Shared predicate, holding-screen states, shared embedded checkout, the 20261028 design with its four scripts, tests, demo plan; ≈3.5d, one PR, fallback split stated. Eight questions for SA. Requirement §9.5 row 17 and §9.3 P-13 row updated per P5-C12 |
| 2026-10-11 | SA workplan review: **APPROVED WITH CONDITIONS** (SA) | Q-1 to Q-8 accepted (Q-5 narrowed: no auto-refresh while stuck). P5-C compliance table, SQL paste-rule check, tenant isolation and body-copy approach recorded. **Split ruled:** P-5a.1 "first payment stamp" (G-3) then P-5a.2 "Pay screen" (G-4, G-6), never stacked; P5-F4 still checked on day 1. Conditions W-1 to W-12 (probe as `service_role` with a BYPASSRLS stand-in locally, deterministic F3, md5 discipline, C10 joins account and invoice, stamp entry always written, flush widening byte-compatible, screen states mirror SR-5 with an escape from a marker-only "processing", the matrix test through the real checkout). Requirement §9.1 P-13 cell and §9.1.1 N-3 aligned with S5-9 |
| 2026-10-11 | P-5a.1 implemented (Dev) | T1 to T5, the P5-C4 guards, T11 and the P-5a.1 share of T13; uncommitted. 20261028 and its four scripts run on PGlite (pre-check PASS, checker PASS 8/0, probe PROBE PASS F01 to F10 with and without a lineage row, rollback restores the P-3b checker; mutations and sabotages all fail). `origin/main` merge refused by git over the requirement edits (not stashed); P5-F4 checked statically only, live check owed to TL. Deviations D-1 to D-9 and the owner-visibility question (D-3) for SA in Implementation Notes |
| 2026-10-11 | SA code review of P-5a.1: **APPROVED WITH FIXES** (SA) | Migration, stamp rule, the five SQL files (paste rules, md5s re-derived independently), exactly-once audit, tenant isolation and entitlements checked. SA runs: 149 suites / 4771 tests and `test:bos-entitlements` 237 / 6641, all green; five mutations, all killed. D-1 to D-9 accepted. **D-3 ruled `'owner'`**, with a forward condition: P-13's waiver and P-5b's "not notified" entries must use an operator entity type or reclassify with the owner-policy migration. Fix F-1 (the `ownerVisibility.ts` comment). Optimisations O-1 to O-4 non-blocking; QA focus listed |
| 2026-10-11 | QA of P-5a.1: **PASS WITH NOTES** (QA) | Affected suites 228 / 6426, `test:bos-entitlements` 237 / 6641, `typecheck:bos-llm` 0 new, all green. Three mutations (two on the P5-C4 guard, one on the paste rules) all killed and restored. Independent paste-rule scan of the five SQL files clean. PGlite not re-run (not reachable); Dev's T2 record relied on. G-3 runbook written for the user. No bugs |
| 2026-10-12 | `stripe listen` command updated for Stripe CLI 1.53 | Stripe CLI 1.53 refuses a bare `stripe listen --forward-to …`. Every command now passes an explicit `--events` list (the events the webhook route and its Business OS plan and boost handlers handle), with `--all-snapshot` noted as the alternative and the `whsec_` → `STRIPE_WEBHOOK_SECRET` step spelled out. |
