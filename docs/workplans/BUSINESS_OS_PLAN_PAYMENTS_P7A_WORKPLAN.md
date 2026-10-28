# Workplan: Business OS Plan Payments, P-7a (Card, invoices, cancel and reactivate)

> **Last Updated**: 2026-10-27

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §9.1 P-7a row; F8 (cancel and reactivate), F9 (card, invoices, receipts), F10 / §9.1.2 F-3; §6 (cancel, reactivate, refunds, receipts); PF-14 + C-11; SA-P1, SA-P8, SA-P10, SA-P16; the tenant-isolation ruling under SA-2; SR-8, SR-11, SR-12, SR-16, SR-17; AC-F8.1 to AC-F8.3, AC-F9.1, AC-F9.2; §9.5 go-live rows 1, 10, 13 and 15.
**Depends on:** P-6a merged (#405, P-6a.2: renewal failure columns, `subscription_ended` row, `planPaymentNotice`, the `/test-business-os` test clock). P-3b.2 mirror (`customer.subscription.updated` already copies `cancel_at_period_end`). P-7b.1 merged (the owner-facing billing-mutation route pattern). P-8a merged (admin Subscriptions list and the Businesses-drawer Plan billing block).
**Date:** 2026-10-25
**Branch:** `feature/bos-plan-payments-p7a`, worktree `neuronforge-p7a`, fresh from `origin/main` `10761291` (#509). Confirmed with `git branch --show-current` on 2026-10-25. Highest migration on that main: `20261092`.
**Status:** SA reviewed 2026-10-25: APPROVED WITH CONDITIONS C-1 to C-12 (SA Review Notes). User decisions 2026-10-26 (§14.1): BQ-3 = A (P-7a.4 in scope), BQ-2 after month ends, BQ-1 yes. **P-7a.1:** SA code review APPROVED WITH FIXES (F-1 applied), QA PASS (no bugs), G-5 (he / es wording) approved by the user 2026-10-26 with the Hebrew fix ("מבטלים…" / "מחדשים…"). Merged to `main` as PR #519. **P-7a.2:** SA code review APPROVED WITH FIXES (F-2, doc only), QA PASS (all 10, no bugs), G-5 (he / es wording) approved by the user 2026-10-27 including FU-P7a2-1 ("Pay now" on a Due row). Merged to `main` as PR #528 (2026-10-27). **P-7a.3:** SA code review APPROVED WITH FIXES (F-3, F-4), QA PASS (no bugs), G-5 (he / es wording) approved by the user 2026-10-27 as drafted, "Founding Partner" kept in English in he / es. Merged to `main` as PR #534 (2026-10-27); no migration. Open follow-up **FU-P7a3-1** (QA E-1): the P-4.2 pre-purchase line `plan.choose.free_access_ends_today` is unchanged; the user has not decided on rewording it. **P-7a.4:** code complete 2026-10-27 on `feature/bos-plan-payments-p7a4` (from `89cd0d90`); SA code review 2026-10-27 APPROVED WITH FIXES (F-3, F-4 applied by SA); QA PASS; the user approved the code and the G-5 he / es wording 2026-10-27; committed `639a5b59`. `origin/main` (with #534) merged in and the SA deviation-8 (dev-8) hunk added, uncommitted, awaiting SA re-review; PR to `main` after that; no migration.

## Overview

P-7a lets a paying owner manage their plan without writing to us:

- **Cancel** in Settings → Plan. The plan keeps working to the paid-through date, then does not renew. Nothing is refunded.
- **Reactivate** before that date: the plan renews as before, nothing is charged now.
- **Update card** through Stripe's customer portal, limited to card and invoices (SA-P10).
- **See invoices** in Settings → Plan, each with a link to Stripe's hosted invoice and receipt.
- **Never charge an account that no longer exists (PF-14, C-11).** Deletion is already refused while a plan subscription is live on three of the four destructive paths; P-7a closes the fourth (Danger Zone Reset / Purge) and points every refusal at the new in-app Cancel.
- **A Founding Partner who cancels** keeps the paid plan to the paid-through date and is then back on Founding Partner, pill included, while their free access is still live (AC-F8.3). The code already does this (SA confirmed F-3 in code on 2026-10-13); P-7a shows it on screen and pins it with a test.

**Production after merge:** inert. The new routes answer only an account with a Business OS plan subscription on our billing record, and none exists in production while the payment switches are off (§13).

**Size: about 3.9 dev-days** (4.4 with the conditional P-7a.4), over the row's 2–3d, in **three small PRs, never stacked** (plus one conditional), §9.

**Migration: none** (§12).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [What the Owner Sees and What the Admin Sees](#2-what-the-owner-sees-and-what-the-admin-sees)
3. [Scope](#3-scope)
4. [Implementation Approach](#4-implementation-approach)
5. [Files to Create / Modify](#5-files-to-create--modify)
6. [Task List](#6-task-list)
7. [Tests](#7-tests)
8. [Sandbox Experiments](#8-sandbox-experiments)
9. [Sizing and Split](#9-sizing-and-split)
10. [Demo Checklist](#10-demo-checklist)
11. [Wording (en / he / es)](#11-wording-en--he--es)
12. [Migration Check](#12-migration-check)
13. [Rollout and Rollback](#13-rollout-and-rollback)
14. [Open Questions](#14-open-questions)
15. [SA Review Notes](#sa-review-notes)
16. [QA Testing Report](#qa-testing-report)
17. [Commit Info](#commit-info)
18. [Change History](#change-history)

---

## 1. Analysis Summary

**Platform phase touched:** none of the V6 pipeline. Business OS billing (`lib/business-os/billing/`), `StripeService` (Business OS methods only; Connect methods untouched), the billing-account repository (read and the existing mirror write only), Settings → Plan (`PlanSection`), the purge Reset guard, deletion copy, and one new operator script.

### 1.1 As-built, read on `origin/main` `10761291`

| Area | What exists | What P-7a does with it |
|---|---|---|
| Owner-facing billing mutation pattern | `app/api/business-os/billing/plan/upgrade/route.ts` + `lib/business-os/billing/planUpgrade.ts`: flag first (404, nothing read), `getUser()`, strict Zod body, `resolveAccountId`, orchestration over injected ports, **every DB read and our-data refusal before any Stripe call** (SA V-9), fresh Stripe read cross-checked against our row, refusal table `{status, message}`, `logAndFlush` audit before the response | Copied for cancel and reactivate (`planSubscriptionManage.ts`) and for the portal |
| Status mirror | `planSubscriptionMirror.ts`: `customer.subscription.updated/.deleted` read the subscription **fresh** and write `subscription_status`, `cancel_at_period_end`, `ended_at` by compare-and-set on the row still holding that subscription (`mirrorSubscriptionState`, `{ count: 'exact' }`, no `.select()`, no `.or()`) | Unchanged. The owner routes call the **same** repository method with Stripe's answer, so the screen says "Ends on" at once and the webhook converges on the same values |
| Owner's plan view | `planPurchaseView.ts` → `my-plan`: `billing.state` already has `renewing` / `ending` ("Ends on {date}. It will not renew.", `plan.ends_on_paid`) / `payment_failed` / `action_required` / `ended` | Adds a `manage` block (which buttons to show), from the same row read, through one pure predicate |
| Upgrade while cancelling | `planUpgradeOffer` and `planUpgrade.ts` already refuse `subscription_cancelling` | Settings tells a cancelling owner to reactivate first (one line) |
| Checkout while cancelling | The subscription is still live until Stripe ends it, so the checkout refuses (`subscription_live`, SR-5) | Unchanged and correct: after the end date the owner buys again (F8 row 4) |
| StripeService | Legacy agent-platform `createPortalSession`, `cancelSubscription`, `reactivateSubscription`, `listInvoices`: no portal configuration, no customer cross-check | **Not used** (deprecated agent-platform helpers, flagged, not extended). New Business OS methods beside the existing `retrieveBusinessOsSubscription` |
| Legacy routes | `app/api/stripe/create-portal`, `cancel-subscription`, `reactivate-subscription` read `user_subscriptions` | Not used, not touched (RD-2, SR-9) |
| Portal configuration | Env name `STRIPE_BOS_PORTAL_CONFIGURATION_ID` documented in [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) § Billing ("Read from P-7a"); no script, no reader | Script + reader (§4.4) |
| Admin Subscriptions list (P-8a.1) | `subscriptionsView.ts`: chips Active, Cancelling, Failed, In grace, Paused, Ended, No Stripe, Other; `SubscriptionsTable` shows "Ends on <date>" when cancelling, "Ended <date>" | **Nothing to add** (§2.2) |
| Admin Plan billing block (P-8a.2) | `PlanBillingBlock.tsx`: status chip(s), Stripe status, "Ends on" instead of "Next renewal" when cancelling, plan column with Free access (cohort), Paid through, State | **Nothing to add** (§2.2) |
| Audit coverage pin | `moneyEventAudit.coverage.test.ts` lists "Cancelled" and "Reactivated" as NOT_BUILT, owner P-7a, patterns `/^BOS_BILLING_.*CANCEL/`, `/^BOS_BILLING_.*REACTIVAT/` | Moved to BUILT with their emitters |

### 1.2 PF-14: the four destructive paths, as built

| Path | Refuses on a live plan subscription today? | Where |
|---|---|---|
| Admin delete (`/admin/users`) | **Yes**, R-3, both modes, unreadable = refuse | `adminDeletionRefusals.ts` `evaluateR3` + `isPlanSubscriptionLive`; `adminDeletionFacts.ts` |
| Owner self-delete (DE-10b) | **Yes**, guard G-6 in the SQL cleanup function, both modes | `20261081` / `20261092` (generated by `scripts/generate-test-account-cleanup-sql.ts`); blocker `plan_running` |
| Operator test-account cleanup | **Yes**, the same G-6 | same function |
| Danger Zone Reset / Purge (`/api/business-os/purge/commit`, internal surface; customer surface behind `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE`) | **No.** `ResetGuard` has control 1 (Stripe Connect) and control 2 (local money in flight) only | `lib/business-os/purge/ResetGuard.ts` |

Reset and Purge never delete the plan row or the billing record (both are `never` in `descriptors.ts`), so today's harm is smaller than PF-14 describes: the account still exists while Stripe charges. PF-14 and the P-7a row still say Reset is refused while subscribed; P-7a builds that, and §14 BQ-4 asks the user to confirm it.

**The shared rule.** "Live" is `isPlanSubscriptionLive` (TS) and the identical G-6 predicate (SQL): status in `active, trialing, past_due, unpaid, paused`, **or** a subscription id with no `ended_at`. A **cancelling** subscription is still `active`, so it still blocks deletion until Stripe ends it on the paid-through date. That is unchanged by this workplan unless the user decides otherwise (BQ-2): changing it would mean a new version of the SQL cleanup function, i.e. a migration.

### 1.3 F-3 / AC-F8.3 (Founding Partner who cancels)

Confirmed in code by SA (2026-10-13) and kept true by P-6a.1 (FC-1): the apply function never writes `cohort` / `cohort_expires_at`, the mirror never moves `tier_expires_at`, and `deriveLifecycle` resumes a live cohort once the tier, plus the 24 h margin, has lapsed. `planPaymentNotice` already shows no "ended" banner when the lifecycle is not `grace` / `paused` (AC-F6.5). **No code change is needed for the behaviour.** P-7a adds (a) a pure test that walks the cancel case end to end through `deriveLifecycle`, and (b) if the user agrees (BQ-5), one sentence in the cancel confirmation saying they go back to Founding Partner.

### 1.4 Standards

- **Deprecated patterns found:** the legacy agent-platform portal / cancel / reactivate helpers and routes above. Not used or extended; recorded here.
- **`console.*`:** none in the files this slice edits (checked: `PlanSection.tsx`, `planText.tsx`, `planPurchaseView.ts`, `planPurchaseTypes.ts`, `StripeService.ts`, `ResetGuard.ts`, `adminDeletionRefusals.ts`, `blockerCopy.ts`, `DangerZonePanel.tsx`, `PlanPaymentBanner.tsx`, `lib/audit/events.ts`). Dev re-checks at T0.
- **Schema claims (`business-os-schema-check`):** every column used is in `20261025_business_os_billing_accounts.sql` (read from the migration body): `user_id`, `livemode`, `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `current_period_end`, `cancel_at_period_end`, `ended_at`, `bought_tier`, `updated_at`; `UNIQUE (user_id, livemode)`; `service_role` holds UPDATE on `subscription_status`, `cancel_at_period_end`, `ended_at`, `updated_at`. All are already in `BILLING_ACCOUNT_COLUMNS`, which `findByUser` selects in production. No live DB access was used; Dev runs `npm run schema:check` at T0 and records the ref.

---

## 2. What the Owner Sees and What the Admin Sees

### 2.1 Owner (Settings → Plan, in the plan drawer and the Settings pop-up)

| Situation | Owner sees | What happens behind it |
|---|---|---|
| Paying, renewing | "Renews on {date}." and three controls: **Update card**, **Invoices**, **Cancel plan** | — |
| Presses Cancel plan | A confirmation: "You keep {plan} until {date}. After that it will not renew, and nothing is refunded." **Yes, cancel** / **Keep my plan** | Nothing until confirmed |
| Confirms | "Cancelled. You keep {plan} until {date}." The line becomes "Ends on {date}. It will not renew." with a **Reactivate** button. Upgrade buttons disappear, with no explanatory line (TL 2026-10-26, SA deviation 6: the "Reactivate your plan to upgrade." line is dropped) | Stripe: cancel at period end. Our record: the same flag, at once. Audit "cancelled". No refund (Q-B7) |
| Founding Partner confirms (free access still running after the paid-through date) | As above, plus (BQ-5): "Then you go back to your Founding Partner free access, which runs until {freeUntil}." | Same |
| Presses Reactivate before the date | "Your plan will renew on {date}." Cancel is back. Nothing charged now | Stripe: cancellation removed. Audit "reactivated" |
| Does nothing | On the date: plan stops; after the 24 h margin, 5 days of grace, then paused (F6, recorded not enforced until S-5). The banner says "Your subscription ended" during grace / paused | Stripe ends the subscription; the webhook records it (P-6a.2) |
| Founding Partner does nothing | After the date: back on Founding Partner, with the pill; no "ended" banner (AC-F8.3) | `deriveLifecycle` resumes the cohort |
| Wants it back after the date | Choose a plan again (F1), new billing date | Checkout, as P-4 |
| Payment failed, presses Cancel | Depends on BQ-3 (recommended: the plan ends now, no further charge attempts) | §4.3 |
| Presses Update card | Stripe's portal opens on the card form, in the same tab; "Return to AgentPilot" brings them back to Settings → Plan | Portal session on our dedicated configuration (card and invoices only) |
| Opens Invoices | The last 12 invoices: date, what it was for (Plan started / Monthly renewal / Plan change), amount in USD, status (Paid / Due / Not charged / Unpaid), **View invoice and receipt** link (Stripe's hosted page, new tab). "See all in Stripe" opens the portal's invoice list | Read from Stripe for **our** customer id only, when the list is opened (not on every drawer open) |
| Wants to delete the account while subscribed | Delete-account steps say: "Your plan is still running. Cancel it in Settings → Plan. You can delete your account once it has ended." | G-6, unchanged rule; new words |
| No paid plan (trial, Founding Partner without a purchase, admin-assigned plan) | No Cancel / Update card / Invoices controls | `manage` is empty |

Receipts by email are Stripe's, and only once "Successful payments" emails are on in the Stripe dashboard (§9.5 row 10; a demo prerequisite on the sandbox, §10).

### 2.2 Admin

| Situation | Admin sees (already built in P-8a) | P-7a change |
|---|---|---|
| Owner cancelled | Subscriptions list: chip **Cancelling**, "Ends on {date}"; Plan billing block: Cancelling chip, "Ends on" in place of "Next renewal" | None. The audit trail gains a "cancelled" entry with actor `owner` |
| Owner reactivated | Back to **Active**, "Renews on {date}" | None. Audit "reactivated" |
| Cancellation took effect | **Ended**, then (from the plan row's lifecycle) **In grace**, then **Paused**; MRR stops counting it | None |
| Founding Partner whose cancellation took effect | Ended chip; plan column shows Free access = Founding Partner and the state `active` (cohort) | None |
| Admin delete of a subscribed account | R-3 refuses (both modes) | The clearing text changes from "In-app cancel arrives with plan payments P-7a" to "The owner cancels in Settings → Plan, or cancel it in the Stripe dashboard; deletion is possible once the subscription has ended" |
| Danger Zone Reset / Purge of a subscribed account | Today: allowed | Refused with "This business has a live plan subscription …" (control 3, §4.6) |

**Admin gap: none for F8/F9.** One optional nicety is deliberately left out: showing *who* cancelled (owner in the app, an admin in the Stripe dashboard, or Stripe after failed retries). The audit trail has the owner's cancel, and `BOS_BILLING_SUBSCRIPTION_ENDED` already records Stripe's `cancellation_reason`. TQ-9 asks SA whether a dashboard cancel should also be audited.

---

## 3. Scope

| In | Out (and where it lives) |
|---|---|
| Cancel at period end; reactivate before the end (F8 rows 1–2) | Refunds (none by policy; dashboard only, Q-B7) |
| Portal for card update, on a dedicated configuration (SA-P10) | Plan changes in the portal (off; RD-7 stays in the app) |
| Portal configuration script, test and live mode (go-live row 13) | Downgrade at renewal (P-7b.2) |
| In-app invoice list with hosted invoice/receipt links (F9, L-5) | A cancellation reason survey (BQ-6, recommended not in v1) |
| PF-14: Reset / Purge refusal; refusal wording on all four paths | Deleting the Stripe customer on account deletion (BQ-8) |
| AC-F8.3 on screen and pinned by test | Admin in-app cancel / refund (AM-8, later) |
| Conditional P-7a.4: cancel while a payment has failed (BQ-3) | Founding Partner discount (P-11) |

---

## 4. Implementation Approach

### 4.1 One predicate for what an owner may do: `planManageOffer`

New pure function in `lib/business-os/billing/planCheckoutEligibility.ts` (beside `planPurchaseOffer` and `planUpgradeOffer`, so the screen and the routes share one rule, as P-4/P-7b.1 did), from our billing row only:

| Row facts | `manage` answer |
|---|---|
| No row, no subscription id, or `ended_at` set / status `canceled`, `incomplete`, `incomplete_expired` | `{ cancel: false, reactivate: false, portal: <customer exists>, invoices: <customer exists> }` |
| `active` or `trialing`, `cancel_at_period_end = false` | `cancel: true` |
| `active` or `trialing`, `cancel_at_period_end = true`, period end in the future | `reactivate: true` |
| `past_due` / `unpaid` / `failed_attempts > 0` | `cancel` per BQ-3 (default build in P-7a.1: `false`, with the line "Your payment failed. Update your card, or contact us to cancel."; P-7a.4 switches it on if BQ-3 = A) |

`portal` and `invoices` are offered to anyone with a Business OS customer on our record in this mode, ended subscriptions included (an ex-customer may still want an old receipt). `planPurchaseView` adds `manage` to the wire (`PlanPurchaseWire.manage`), computed from the row it already reads: **no new read** on the drawer open.

**C-1 (SA, binding).** `planManageOffer` takes the price-recognition switch (`isPlanPriceRecognitionEnabled()`) as an input, as `planPurchaseOffer` takes its switches: with the switch off, `manage` is all-false, so the screen never offers a button the route would 404. All four P-7a routes gate on the same switch (BQ-1, user 2026-10-26: "Yes, always"). `trialing` behaves as `active` (TQ-14), pinned by a matrix row.

### 4.2 Cancel and reactivate (P-7a.1)

**Routes:** `POST /api/business-os/billing/plan/cancel` and `POST /api/business-os/billing/plan/reactivate`, both per `new-api-route`. Body: strict empty object (`z.object({}).strict()`): any key, such as an injected `userId` or `subscriptionId`, is a 400. Only the session decides the account.

**Orchestration** `lib/business-os/billing/planSubscriptionManage.ts` (ports injected, as `planUpgrade.ts`). **The order is the contract** (as SA V-9): every DB read and every our-data refusal before any Stripe call.

| # | Step | Refusal |
|---|---|---|
| 1 | Switch (TQ-1; default: the price-recognition switch, see BQ-1) off | 404 `not_available`, nothing read |
| 2 | `getUser()` | 401 |
| 3 | Body strict | 400 `invalid_input` |
| 4 | Key mode (`currentStripeMode`) unknown | 503 `manage_unavailable` |
| 5 | Billing row by **session user** + key mode | 503 `billing_row_unreadable` |
| 6 | `planManageOffer` on our row | 409 `not_subscribed` / `subscription_not_active` / `already_cancelling` / `not_cancelling` / `payment_failed_contact_us` |
| 7 | Stripe: subscription fresh (`retrieveBusinessOsSubscription`); its customer and mode must equal our row's, and `bos_user_id` metadata, when present, must be the account | 409 `billing_record_mismatch` (error + alert, nothing written) |
| 8 | Fresh state already says what was asked (double click, second tab) | 200 `outcome: 'unchanged'`, no write, no audit |
| 9 | Fresh state has a pending upgrade update (`pending_if_incomplete`) | 409 `upgrade_pending` (X-3 decides whether Stripe would refuse it anyway) |
| 10 | Stripe write: `cancel_at_period_end: true` / `false` (new `StripeService.setBusinessOsCancelAtPeriodEnd`) | 502 `stripe_error`; if the answer was lost, `outcomeUnknown: true` and the screen re-reads, never "nothing changed" |
| 11 | Mirror Stripe's answer onto our row with `mirrorSubscriptionState` (CAS on user, mode, subscription id) | A failed mirror is logged `warn` and does not fail the request: the webhook writes the same values seconds later (TQ-2) |
| 12 | Audit `BOS_BILLING_SUBSCRIPTION_CANCELLED` / `BOS_BILLING_SUBSCRIPTION_REACTIVATED`, owner actor, `logAndFlush` before the 200 | Bounded; never fails the request |

200 → `{ success: true, data: { outcome: 'cancelled' | 'reactivated' | 'unchanged', endsOn | renewsOn } }`, the date from Stripe's answer (`items[0].current_period_end`, clover shape, as the mirror reads it).

**SA conditions folded in (binding):**

- **C-2.** `setBusinessOsCancelAtPeriodEnd` returns the mirror's facts (status, `cancelAtPeriodEnd`, `cancelAt`, `endedAt`, item period end, customer, `livemode`) from the update response itself: no second retrieve. On step 8's `unchanged`, if **our row** disagrees with the fresh Stripe state, step 11's mirror runs with the fresh state (no audit), so the owner's next press repairs a stale flag.
- **C-3.** X-2 records what a dashboard "cancel at end of period" writes on clover (`cancel_at_period_end` or `cancel_at`). Step 8 treats a fresh `cancel_at` as cancelling; Reactivate clears whichever Stripe reports set. If the dashboard writes only `cancel_at`, the webhook mirror under-reports outside cancellations: recorded as a webhook follow-up, not fixed in P-7a.
- **C-4.** Step 7's cross-checks are exactly: `fresh.id === row.stripeSubscriptionId`, `fresh.customerId === row.stripeCustomerId`, `fresh.livemode === row.livemode === isLiveMode(currentStripeMode())`, and `metadata.bos_user_id`, when present, equals the session account. Any disagreement: 409 `billing_record_mismatch`, `error` + alert, nothing written, nothing audited. A call-order spy pins zero Stripe calls on every refusal of steps 1–6.
- **C-5.** The client always sends `{}`; unparsable JSON stays a 400 (as the upgrade route). The route test pins an injected `userId` → 400 and `{}` → proceeds.
- **TQ-5.** Step 9 refuses `upgrade_pending` whatever X-3 shows.
- **Failed payment (BQ-3 = A, user 2026-10-26).** P-7a.1 ships the "contact us" line first; P-7a.4 then turns Cancel on for that state (§4.3).

**No Stripe idempotency key on the write** (TQ-3): setting a boolean is idempotent, and a key would replay a stale answer on cancel → reactivate → cancel within 24 h. Step 8 absorbs double clicks.

**No plan write, no entitlement invalidation.** Access still follows the plan row's paid-through date (SA-P8); cancel changes nothing about access today.

**UI** (`PlanSection` → new `PlanManage.tsx` island, rendered in the drawer and the Settings pop-up as `PlanBillingNotices` is): Cancel opens an inline confirmation (no nested Radix dialog inside the drawer: the drawer is already a dialog); after the answer, `my-plan` is re-read once (the mirror has written) and the line reads "Ends on". A failed re-read keeps the route's own answer on screen.

### 4.3 Cancel while a payment has failed (P-7a.4, IN scope: BQ-3 = A, user 2026-10-26)

**C-11 (SA, binding).** An open renewal invoice must not re-assert the tier after an immediate cancel: either void the subscription's open invoice(s) in the same orchestration (after `subscriptions.cancel`, each void its own Stripe call, `outcomeUnknown` on a lost answer), or prove by test that the apply path refuses an `invoice.paid` for a subscription our record shows ended. The confirmation for this state says "ends now", not "until {date}". Same audit key `BOS_BILLING_SUBSCRIPTION_CANCELLED` with `details.mode = 'immediate'` (TQ-12).


**As built (P-7a.4, 2026-10-27):** X-4 showed the open invoice stays payable after `subscriptions.cancel` (Stripe only stops retrying it) and that paying it sends `invoice.paid`, which `applyPaidPlanInvoice` would apply (it has no "subscription ended" refusal). So C-11 is met by **voiding** every open invoice of the subscription after the cancel, not by the test option. Details in Implementation Notes (P-7a.4).

A `past_due` subscription's period end has already passed; "cancel at period end" would end it a month later while Stripe keeps retrying the card. If BQ-3 = A, Cancel in that state ends the subscription **now** (`subscriptions.cancel`, `prorate: false`, `invoice_now: false`), and X-4 establishes whether Stripe then stops collecting the open invoice by itself or whether we must void it. The webhook's `.deleted` path (P-6a.2) then records the end; the lifecycle continues grace → paused from the unpaid date. Audit: the same `CANCELLED` key with `details.mode = 'immediate'` (TQ-12, approved). BQ-3 was answered A, so P-7a.4 is built after P-7a.1.

### 4.4 Portal and its configuration (P-7a.2)

**Script** `scripts/setup-bos-portal-configuration.ts`, on the `setup-bos-plan-prices.ts` model and `scripts/lib/stripe-script-guards.ts`:

- `--env <file outside every checkout>` and `--expect-account acct_…` required; dry run by default, `--apply` writes; the key is never printed.
- Test mode by default (`sk_test_` only). **Live mode only with `--live`**, which then requires an `sk_live_`/`rk_live_` key; every returned object must match the mode (TQ-7: SA confirms this is the right shape for go-live row 13).
- Idempotent: lists portal configurations, finds ours by `metadata.product = business_os_portal`; creates it if missing; if found, **compares** features and stops on any difference (never silently edits). Features: `payment_method_update` on, `invoice_history` on, `subscription_cancel` off, `subscription_update` off, `customer_update` off (SA-P10). Business headline and privacy/terms links: as already configured in the Stripe dashboard for branding (go-live row 10). `default_return_url` = `${platformOrigin}/business-os/settings?section=plan`.
- Prints the `bpc_…` id to set as `STRIPE_BOS_PORTAL_CONFIGURATION_ID` for that mode.

**Reader** `lib/business-os/billing/portalConfiguration.ts`: reads the env var; missing or not `bpc_…` → refuse `portal_unavailable` (503) and log `error` + alert. **Never** falls back to Stripe's default configuration, which on many accounts has cancel and plan switching on. Once per server instance, the route retrieves the configuration and checks its features and `livemode` match (TQ-7); a mismatch refuses and alerts.

**Route** `POST /api/business-os/billing/plan/portal`. Body strict: `{ intent: 'update_card' | 'invoices', locale?: 'en' | 'he' | 'es' }`. Order: switch → session → body → key mode → billing row by session user (no row / no customer → 409 `no_billing_account`) → configuration check → `StripeService.createBusinessOsPortalSession({ customerId: <our row>, configurationId, returnUrl, locale, flow })`. `update_card` uses `flow_data: { type: 'payment_method_update' }` (opens on the card form); `invoices` opens the portal home. 200 → `{ url }`; the client sets `window.location.href`. **The portal URL is a bearer link to the customer's billing**: never logged, never audited, never in an error. Portal opening is logged `info` (ids only), not audited (not a money event; TQ-9).

**Card change and a failed payment.** When the owner updates the card in the portal during a failed renewal, Stripe retries the open invoice; a success arrives as `invoice.paid` and P-6a.2's cure clears the banner. X-1 confirms the portal also sets the new card on the **subscription** (Checkout set `subscription.default_payment_method`), or the next renewal would still use the old card.

**SA conditions for P-7a.2 (binding):**

- **C-6.** `returnUrl` from the server-side platform origin only, never the request's `Host` / `Origin`. `update_card` sets `flow_data.after_completion = { type: 'redirect', redirect: { return_url } }`. The once-per-instance configuration check caches **success only**; a failed retrieve refuses 503 `portal_unavailable` and retries next request. Portal and invoice responses carry `Cache-Control: no-store`; the invoice list body, like the portal URL, is never logged.
- **C-7.** If X-1 shows the portal does not move the subscription's card, stop and return to SA. No `payment_method.*` / `customer.updated` webhook handler inside P-7a.
- **C-8.** The script reuses `scripts/lib/stripe-script-guards.ts` (`--env` outside every checkout, key prefix by mode, `--expect-account` compared with `accounts.retrieve()`), on the `setup-bos-plan-prices.ts` model. Compare-and-stop on drift. The `bpc_…` id is printed; the key never is.
- **TQ-8.** `locale` from a strict enum only if X-5 shows Stripe accepts it, else `auto`. **BQ-7 (TL default):** last 12, "See all in Stripe".

### 4.5 Invoice list (P-7a.2)

**Route** `GET /api/business-os/billing/plan/invoices` (no input). Order: switch → session → key mode → billing row by session user → `StripeService.listBusinessOsInvoices({ customerId: <our row>, limit: 12 })` → map.

- Drafts are dropped; every other invoice of this customer is listed (the customer is Business OS-only, SA-P1, so every invoice on it is a plan invoice).
- Each row: `id`, `createdAt`, `reason` (from `billing_reason`: `subscription_create` / `subscription_cycle` / `subscription_update` / `other`, as P-6a's U-10 note requires), `planLabel` (line price id → tier via `planPriceCatalog`, configured label; unknown → none), `amountMinor` (`total`), `currency` (must be `usd`; anything else is dropped and logged `error`, SR-15), `status` (`paid` / `open` / `void` / `uncollectible`), `hostedInvoiceUrl` (must start with `https://invoice.stripe.com/`, the existing `isHostedInvoiceUrl`), `invoicePdfUrl` (Stripe's `pay.stripe.com` / `invoice.stripe.com` prefix only, else dropped).
- `hasMore` → the screen shows "See all in Stripe" (portal, `intent: 'invoices'`).
- Reads nothing from `user_subscriptions`, `billing_events` or our money history (AC-F9.2, RD-2). It is an owner read, never an access decision (SR-11), made only when the owner opens the list (TQ-6).
- The voided upgrade invoice of a declined upgrade (U-10, E-4) reads "Plan change, Not charged", never "failed".

### 4.6 PF-14: Reset / Purge refusal and wording (P-7a.3)

- **`ResetGuard` control 3** `subscription_live`: `hasLivePlanSubscription(userId)` from `adminDeletionFacts.ts` (both modes; `null` → `subscription_unreadable`, refuse). Runs **before** control 1, so the cheapest decisive read comes first and the message names the real blocker. It is the same reads and rule as R-3 and G-6 ("subscribed means one thing").
- The commit and preview routes already return a refused outcome with its control; the new control rides that contract (TQ-10 asks whether PF-14's "409" is meant literally). The Danger Zone panel maps `subscription_live` to: "This business has a live plan subscription. Cancel it in Settings → Plan, and reset once it has ended."
- R-3 clearing text (§2.2) and the self-delete blocker `settings.account_delete.blocker.plan_running` (en / he / es, and the English fallback in `DangerZonePanel.tsx`) point at Settings → Plan instead of "contact us".
- **Cross-path pin** `lib/business-os/purge/__tests__/planSubscriptionLive.paths.test.ts`: the TS predicate's status list equals `R3_LIVE_STATUSES`, equals the status list in the G-6 SQL of the newest cleanup migration (read from the file, as `blockerCopy`'s test reads guards), and `ResetGuard`, `evaluateR3` and `hasLivePlanSubscription` all import the one predicate. A new destructive path, or a drifted list, fails CI.
- The billing record itself is retained on every path (already `minimise` / `never`); unchanged.

**SA conditions for P-7a.3 (binding; they correct the bullets above):**

- **C-9.** `subscription_live` and `subscription_unreadable` are added to `ResetGuardResult['control']` **and** `ResetRefusal` in `ResetService.ts`. The owner-readable text is `ResetGuard`'s own `message`: the Danger Zone prints the server's message, there is no client-side control map, so the "panel maps" step above is dropped. The refusal stays commit-time, before the snapshot, like controls 1 and 2: **no preview change** (the preview never runs `ResetGuard`; the earlier claim was wrong). `ResetService.order.test.ts` mocks the billing reads and pins control 3 before `resolveConnectAccounts`. The admin surface also passes through control 3 (agrees with R-3); admin delete tests pass unchanged. The requirement records that PF-14's "409 `subscription_live`" is met as the purge contract's refused outcome with control `subscription_live`, and as R-3 / G-6 on the deletion paths.
- **C-10.** G-6's operator `clears` text in the generated SQL stays ("Cancel the subscription in the Stripe dashboard …"): changing it is a migration. Only the i18n `plan_running` blocker, the `DangerZonePanel.tsx` English fallback and `R3_CLEARING` change; Implementation Notes say so.
- The cross-path pin selects the cleanup migration by the generator's filename pattern (SA suggestion).

### 4.7 Tenant isolation (`tenant-isolation-guard`)

- Every route takes the account from `getUser()` → `resolveAccountId` only. Bodies are strict and carry no id.
- The subscription and customer ids always come from **our** billing row (session user, server key mode). The fresh Stripe subscription is cross-checked against the row's customer, mode and `bos_user_id` before any write; a disagreement writes nothing and alerts.
- The mirror write is a CAS on `(user_id, livemode, stripe_subscription_id)`, so a row that changed hands in between is not touched.
- Service-role use is the existing repository's documented bypass (server-write-only table, SA-P1); no new service-role path.

### 4.8 Entitlements registration (SR-17, `business-os-entitlements`)

New importers of `lib/business-os/entitlements/`: the three or four new routes (`resolveAccountId`), and `planPurchaseView.ts` again if the BQ-5 sentence reads the cohort end through a `freeAccess` helper. Each is registered as a **non-gate** importer in `enforcementPoints.test.ts` with its "why" (it refuses a billing action, never a capability; no `check()` / `decide()`). `planSubscriptionManage.ts` itself imports nothing from the module (the route resolves the account). `npm run test:bos-entitlements` before handover.

### 4.9 Audit (AM-7)

`BOS_BILLING_SUBSCRIPTION_CANCELLED` and `BOS_BILLING_SUBSCRIPTION_REACTIVATED` in `AUDIT_EVENTS` and `EVENT_METADATA` (severity `info`, compliance flags as the other `BOS_BILLING_*` keys); entity `business_os_billing_account`, `entityId` = account id; details: `subscriptionId`, `endsOn` / `renewsOn`, `livemode`, `actor: 'owner'`, `correlationId`. Refusals and `unchanged` are logged, never audited. `moneyEventAudit.coverage.test.ts`: both rows move from NOT_BUILT to BUILT.

---

## 5. Files to Create / Modify

| File | Action | Reason | Slice |
|---|---|---|---|
| `lib/business-os/billing/planCheckoutEligibility.ts` | modify | `planManageOffer` (§4.1) | .1 |
| `lib/business-os/billing/planSubscriptionManage.ts` | create | Cancel / reactivate orchestration (§4.2) | .1 |
| `lib/stripe/StripeService.ts` | modify | `setBusinessOsCancelAtPeriodEnd` (.1); `createBusinessOsPortalSession`, `retrieveBusinessOsPortalConfiguration`, `listBusinessOsInvoices` (.2); `cancelBusinessOsSubscriptionNow` (.4). Connect and legacy methods untouched | .1 .2 .4 |
| `app/api/business-os/billing/plan/cancel/route.ts` (+ `__tests__/route.test.ts`) | create | §4.2 | .1 |
| `app/api/business-os/billing/plan/reactivate/route.ts` (+ `__tests__/route.test.ts`) | create | §4.2 | .1 |
| `lib/business-os/billing/planPurchaseTypes.ts`, `planPurchaseView.ts` | modify | `manage` on the wire | .1 |
| `components/business-os/settings/planPayloadTypes.ts` | modify | Client type of `manage` | .1 |
| `components/business-os/settings/PlanManage.tsx` | create | Cancel / Reactivate (.1), Update card + Invoices (.2) | .1 .2 |
| `components/business-os/settings/planManageCopy.ts` | create | Refusal code → dictionary key (as `planUpgradeCopy.ts`) | .1 |
| `components/business-os/settings/PlanSection.tsx`, `UpgradeModal.tsx` (Settings pop-up host only), `planText.tsx` | modify | Mount `PlanManage`; replace `plan.update_card_email` with the button; ~~"Reactivate your plan to upgrade"~~ (dropped, TL 2026-10-26) | .1 .2 |
| `components/business-os/billing/PlanPaymentBanner.tsx` | modify | Comment only (Settings now has Update card) | .2 |
| `lib/audit/events.ts` | modify | Two keys + metadata (§4.9) | .1 |
| `lib/business-os/billing/__tests__/moneyEventAudit.coverage.test.ts` | modify | NOT_BUILT → BUILT | .1 |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | Register the new importers (§4.8) | .1 .2 |
| `lib/business-os/translations/en.ts`, `he.ts`, `es.ts` | modify | §11 | .1 .2 .3 |
| `scripts/setup-bos-portal-configuration.ts` (+ test) | create | §4.4 | .2 |
| `lib/business-os/billing/portalConfiguration.ts` | create | Env reader + once-per-instance feature check | .2 |
| `app/api/business-os/billing/plan/portal/route.ts` (+ test) | create | §4.4 | .2 |
| `lib/business-os/billing/planInvoiceList.ts` | create | Pure mapping of Stripe invoices (§4.5) | .2 |
| `app/api/business-os/billing/plan/invoices/route.ts` (+ test) | create | §4.5 | .2 |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` § Billing | modify | Portal env var: "Read from P-7a" → reader, script and refusal named | .2 |
| `lib/business-os/purge/ResetGuard.ts` (+ test) | modify | Control 3 (§4.6) | .3 |
| `components/business-os/purge/PurgeDangerZone.tsx` / `DangerZonePanel.tsx` | modify | `subscription_live` message; fallback blocker text | .3 |
| `lib/business-os/purge/adminDeletionRefusals.ts` | modify | R-3 clearing text | .3 |
| `lib/business-os/purge/__tests__/planSubscriptionLive.paths.test.ts` | create | Cross-path pin (§4.6) | .3 |
| `lib/business-os/entitlements/__tests__/` (lifecycle) | modify | AC-F8.3 walk (§1.3) | .3 |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | P-7a row and Change History at each stage | all |

**Not touched:** any migration; the webhook route and every webhook handler (`planSubscriptionMirror.ts` included); `planUpgrade.ts`; the checkout; the legacy `app/api/stripe/*` portal / cancel / reactivate routes; the SQL cleanup function.

---

## 6. Task List

| # | Task | Est. | Slice |
|---|---|---|---|
| ✅ T0 | Branch check; `npm run schema:check` (record ref); `console.*` re-check; X-1 to X-3 on the standard sandbox (§8), ids recorded. **Done 2026-10-26** except `schema:check` (no database credentials in this worktree; every column is read from the 20261025 body and is already in `BILLING_ACCOUNT_COLUMNS`) and X-1 (moved to P-7a.2, which it decides) | 0.3d | .1 |
| ✅ T1 | `planManageOffer` + tests; `manage` on the wire through `planPurchaseView` | 0.25d | .1 |
| ✅ T2 | `setBusinessOsCancelAtPeriodEnd`; `planSubscriptionManage.ts` (order contract, refusals, mirror, audit facts) + tests with fakes | 0.4d | .1 |
| ✅ T3 | Cancel and reactivate routes per `new-api-route`; audit keys; coverage pin; entitlements registration | 0.25d | .1 |
| ✅ T4 | `PlanManage` cancel / reactivate UI, confirmation, re-read, refusals; en text + he/es drafts; RTL check (the island inherits the section's `dir`; no direction-specific class) | 0.3d | .1 |
| ✅ T5 | Portal script (test + `--live`), dry run on the sandbox, `--apply`, id into `.env.local` (never committed). **Done 2026-10-27:** test configuration `bpc_1UUv5MC7KDUGYIcA3O6iIzRJ`, also in `.env.example` (the test id only) | 0.35d | .2 |
| ✅ T6 | Configuration reader + check; portal route; `createBusinessOsPortalSession` + tests. X-1 and X-5 run first | 0.35d | .2 |
| ✅ T7 | Invoice list mapping + route + `listBusinessOsInvoices` + tests (U-10 voided invoice, non-USD dropped, bad URL dropped) | 0.4d | .2 |
| ✅ T8 | `PlanManage` Update card + Invoices UI (lazy load, empty, error, "See all"); wording; entitlements doc row | 0.4d | .2 |
| ✅ T9 | `ResetGuard` control 3 + tests; Danger Zone message (C-9: the server's own message, no client map) | 0.3d | .3 |
| ✅ T10 | R-3 text, self-delete blocker (en/he/es + fallback), cross-path pin | 0.3d | .3 |
| ✅ T11 | AC-F8.3 lifecycle walk; BQ-5 Founding Partner sentence (SA deviation-5 carry-forward); demo checklist for the sandbox with a test clock (Implementation Notes (P-7a.3)). The demo itself is owed by the user | 0.2d | .3 |
| ✅ T12 | (Only if BQ-3 = A) X-4; immediate cancel for a failed payment; tests; demo step 9. **Committed `639a5b59` 2026-10-27** on `feature/bos-plan-payments-p7a4` (Implementation Notes (P-7a.4)); C-11 met by voiding (X-4: the open invoice stays payable after the cancel) | 0.5d | .4 |

Each slice ends with: `npm test` on the touched suites **plus `app/api/stripe`** locally, `npm run test:bos-entitlements`, the typecheck filtered to the touched files (check it did not OOM), `npm run build`, `git diff --stat` reviewed (no deletion-only file), then SA code review and QA. **Connect harness** (`app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts`): P-7a does not touch the webhook, so the harness must pass with its snapshot **unchanged** (md5 recorded before and after); never run with bare `-u`, never `--updateSnapshot`.

---

## 7. Tests

| Layer | What | Where |
|---|---|---|
| Pure | `planManageOffer` matrix (every status × cancel flag × ended × failed); `planInvoiceList` mapping (reasons, statuses, USD only, URL prefixes, drafts dropped, U-10 voided upgrade) | `lib/business-os/billing/__tests__/` |
| Orchestration | `planSubscriptionManage`: order contract (no Stripe call on any our-data refusal, pinned by a call-order spy), mismatch writes nothing, `unchanged` writes nothing and audits nothing, pending update refused, lost answer → `outcomeUnknown`, mirror failure does not fail the request | `planSubscriptionManage.test.ts` |
| Matrix | `planManageOffer.matrix.test.ts`: drives `readPlanPurchaseView` against the real orchestration, so the screen offers Cancel / Reactivate exactly where the route accepts (the P-4 F-C pattern) | new |
| Routes (integration) | Each route: happy path, 401, invalid body (an injected `userId` → 400), switch off → 404 with zero reads, not subscribed → 409; portal: missing env → 503, never a default configuration; invoices: no billing row → 409 | each route's `__tests__/` |
| Script | Refuses a live key without `--live`, a test key with `--live`, a wrong account, an env file inside a checkout; dry run writes nothing; existing configuration with a different feature → stops | `scripts/__tests__/` |
| PF-14 | `ResetGuard` control 3: live in test mode, live in live mode, cancelling (still live), ended (clear), unreadable (refused); cross-path pin | `lib/business-os/purge/__tests__/` |
| AC-F8.3 | Founding Partner with a dated cohort past the paid-through date: after period end + margin → cohort basis, no `ended` notice; without a cohort → grace then paused (AC-F8.2) | entitlements lifecycle tests |
| Audit | Coverage pin; each route writes exactly one entry per successful write, none on refusal or `unchanged` | as above |
| UI | Source-level Jest guards: `PlanManage` renders only what `manage` says; the portal URL is never logged | `components/business-os/settings/__tests__/` |

Happy path and one failure path per route, as CLAUDE.md and QA require.

---

## 8. Sandbox Experiments

On the standard sandbox `acct_1UPKR4C7KDUGYIcA`, test mode, before the code that depends on each:

| # | Question | Decides |
|---|---|---|
| X-1 | After a card change in a portal session on our configuration, is the new card the **subscription's** default (Checkout set `subscription.default_payment_method`)? Does a past-due invoice get retried at once? | Whether §4.4 needs an extra step |
| X-2 | `cancel_at_period_end` true then false: which events arrive, in what order, and does `customer.subscription.updated` carry the flag on clover (`2026-09-30.endive` endpoint too)? | That the mirror converges (no code expected) |
| X-3 | Cancel while an upgrade's `pending_update` exists: does Stripe accept or refuse it? | Step 9 of §4.2 |
| X-4 | (P-7a.4 only) `subscriptions.cancel` on a `past_due` subscription: is the open invoice still retried? Does it need `voidInvoice`? | §4.3 |
| X-5 | Portal locales: are `he` and `es` accepted by `billingPortal.sessions.create`? | `locale` on the portal body |

Payloads are captured as fixtures (`scripts/capture-stripe-billing-fixtures.ts`), ids recorded in Implementation Notes, and every object is cleaned up the same day.

---

## 9. Sizing and Split

**≈ 3.9 dev-days** (4.4 with P-7a.4) against the row's 2–3d. The difference: the portal configuration script with a live-mode path (go-live row 13 needs it), the invoice list, which has no existing surface, and the PF-14 cross-path pin. Three PRs, each fresh from `origin/main`, **never stacked**:

| Sub-slice | Scope title | Contents | Est. | Done means (demo) |
|---|---|---|---|---|
| **P-7a.1** | **Cancel and reactivate** | T0–T4 | ≈ 1.5d | A paying test owner cancels ("Ends on"), reactivates ("Renews on"), cancels again; the admin list shows Cancelling then Active; two audit entries |
| **P-7a.2** | **Update card and invoices** | T5–T8 | ≈ 1.5d | The owner updates the card in the portal (cancel and plan switching are not offered there) and sees the invoice list with working Stripe links; the sandbox portal configuration id recorded |
| **P-7a.3** | **Never charge a deleted account** | T9–T11 | ≈ 0.8d | Reset, self-delete and admin delete each refuse a subscribed test account and point at Settings → Plan; after the test clock passes the end date, all three are clear; a Founding Partner is back on Founding Partner with the pill |
| **P-7a.4** (IN: BQ-3 = A) | **Cancel during a failed payment** | T12 | ≈ 0.5d | An owner with a failed renewal cancels; the plan ends now ("ends now" wording); no further charge; the old hosted invoice cannot put the tier back (C-11) |

Order: .1 → .2 → .3 (the .3 wording points at the Cancel button .1 ships). P-7a.3 alone closes go-live row 1's PF-14 item; P-7a.1 closes the floor's "a customer must be able to cancel in-app".

---

## 10. Demo Checklist

Standard sandbox `acct_1UPKR4C7KDUGYIcA`, test mode, local `npm run dev` on this branch.

**Before the demo:**

1. Sandbox keys in `.env.local` only (never committed); `BUSINESS_OS_PLAN_PRICES_ENABLED` and `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` on locally; `STRIPE_BOS_PORTAL_CONFIGURATION_ID` = the sandbox configuration from T5 (P-7a.2 on).
2. Stripe dashboard (sandbox): "Successful payments" customer emails on (F9 receipts; go-live row 10); Smart Retries then cancel (row 11).
3. `stripe listen --forward-to localhost:3000/api/stripe/webhook --all-snapshot` (the CLI now needs `--all-snapshot`); put its `whsec_` in `.env.local`.
4. **Warm the webhook route** before anything else: one `curl -X POST http://localhost:3000/api/stripe/webhook` (expect 400, bad signature). The first compile takes about 40 s, longer than the CLI's 30 s timeout, so an unwarmed first event fails.
5. A designated **test** owner (PF-15); on `/test-business-os`, put their test-mode customer on a fresh **test clock** (P-6a.1 panel).

**Steps:**

| # | Do | Expect |
|---|---|---|
| 1 | Buy Essentials from Settings → Plan with `4242 4242 4242 4242` | "You're on Essentials", "Renews on {date}"; Cancel, Update card, Invoices shown |
| 2 | Cancel → confirm | "Cancelled. You keep Essentials until {date}"; "Ends on"; Reactivate; no upgrade buttons. Admin list: Cancelling, Ends on. Audit: cancelled (owner) |
| 3 | Reactivate | "Renews on {date}"; admin: Active; audit: reactivated; Stripe: no new invoice |
| 4 | (.2) Update card → portal → change to `5555 5555 5555 4444` → Return | Back on Settings → Plan; no cancel / plan change offered in the portal; Stripe subscription's default card is the new one (X-1) |
| 5 | (.2) Invoices | One "Plan started", $79.00, Paid, link opens Stripe's hosted invoice with "Download receipt" |
| 6 | (.3) Danger Zone Reset; self-delete steps; admin delete preview | All three refuse, pointing at Settings → Plan |
| 7 | Cancel again; advance the test clock past the period end + 25 h | Webhook: subscription ended; Settings: "Your subscription ended on …", banner during grace; admin: Ended, In grace. After 5 more days: Paused (recorded) |
| 8 | (.3) Repeat step 6 | All clear (the subscription has ended); do **not** commit a deletion on the demo account |
| 9 | Founding Partner variant: a champion account with an admin-set free-access end date after the paid-through date buys, cancels (confirmation names the free access, BQ-5), clock past period end + 25 h | Back on Founding Partner, pill shown, no "ended" banner (AC-F8.3); admin plan column: Free access = Founding Partner |
| 10 | (P-7a.4) Update card to `4000 0000 0000 0341` (portal), advance the clock past the period end + 1 h so the renewal fails; Settings → Plan; Cancel → confirm | Before: banner "payment failed", the line "Your payment failed. Update your card to keep your plan, or cancel it to end it now.", **Cancel only** (no Reactivate). Confirmation says it **ends now**, no date. After: "Cancelled. Essentials has ended, and your card will not be charged again." Stripe: subscription `canceled` now, `cancellation_details.reason` `cancellation_requested`; the renewal invoice **void**; Invoices: that row reads "Not charged", no "Pay now". Banner switches to "Your Essentials subscription has ended" (grace). Webhook: `customer.subscription.deleted` → one `subscription_ended` money-history row. Audit: `BOS_BILLING_SUBSCRIPTION_CANCELLED` with `mode: immediate`, `invoicesVoided: 1`, `invoicesLeftOpen: 0`. Admin list: Ended. Opening the old hosted "Pay now" link (copied before the cancel) shows the invoice void, not payable (C-11) |
| 11 | Refusal path: second tab still showing Cancel after step 2 → press it | "unchanged", no second audit entry |

**After the demo, the same day:** cancel every demo subscription, delete test customers and clocks, switches off and sandbox keys out of `.env.local`, `git diff` shows nothing in env files, ids recorded.

---

## 11. Wording (en / he / es)

English is final once SA and the user accept it; **Hebrew and Spanish are drafts for the user's approval.** **G-5 (P-7a.1 `plan.manage.*`): approved by the user 2026-10-26 with the Hebrew fix** `cancelling` "מבטל…" → "מבטלים…", `reactivating` "מחדש…" → "מחדשים…" (the shipped strings are in `lib/business-os/translations/he.ts` / `es.ts`).

| Key | en | he (draft) | es (draft) |
|---|---|---|---|
| `plan.manage.cancel_button` | Cancel plan | ביטול המינוי | Cancelar plan |
| `plan.manage.cancel_confirm_body` | You keep {plan} until {date}. After that it will not renew, and nothing is refunded. | {plan} יישאר פעיל עד {date}. לאחר מכן המינוי לא יתחדש, ולא יינתן החזר. | Conservas {plan} hasta el {date}. Después no se renovará y no se reembolsa nada. |
| `plan.manage.cancel_confirm_founding` (BQ-5) | Then you go back to your Founding Partner free access, which runs until {freeUntil}. | לאחר מכן תחזרו לגישה החינמית של שותף מייסד, שבתוקף עד {freeUntil}. | Después vuelves a tu acceso gratuito de Socio Fundador, que dura hasta el {freeUntil}. |
| `plan.manage.cancel_confirm` | Yes, cancel | כן, לבטל | Sí, cancelar |
| `plan.manage.keep` | Keep my plan | להשאיר את המינוי | Mantener mi plan |
| `plan.manage.cancelling` | Cancelling… | מבטלים… | Cancelando… |
| `plan.manage.cancelled` | Cancelled. You keep {plan} until {date}. | המינוי בוטל. {plan} יישאר פעיל עד {date}. | Cancelado. Conservas {plan} hasta el {date}. |
| `plan.manage.reactivate_button` | Reactivate | חידוש המינוי | Reactivar |
| `plan.manage.reactivating` | Reactivating… | מחדשים… | Reactivando… |
| `plan.manage.reactivated` | Your plan will renew on {date}. | המינוי יתחדש ב־{date}. | Tu plan se renovará el {date}. |
| ~~`plan.manage.reactivate_to_upgrade`~~ (DROPPED, TL 2026-10-26, SA deviation 6; not built) | ~~Reactivate your plan to upgrade.~~ | — | — |
| `plan.manage.payment_failed_contact` (BQ-3 = B, or until P-7a.4) | Your payment failed. Update your card, or contact us at {support} to cancel. | התשלום נכשל. אפשר לעדכן את הכרטיס, או לפנות אלינו ב־{support} כדי לבטל. | Tu pago no se realizó. Actualiza tu tarjeta o escríbenos a {support} para cancelar. |
| `plan.manage.update_card` | Update card | עדכון כרטיס | Actualizar tarjeta |
| `plan.manage.opening_stripe` | Opening Stripe… | פותח את Stripe… | Abriendo Stripe… |
| `plan.invoices.title` | Invoices | חשבוניות | Facturas |
| `plan.invoices.show` | Show invoices | הצגת חשבוניות | Ver facturas |
| `plan.invoices.empty` | No invoices yet. | אין עדיין חשבוניות. | Todavía no hay facturas. |
| `plan.invoices.unavailable` | We could not load your invoices right now. Please try again. | לא הצלחנו לטעון את החשבוניות כרגע. אפשר לנסות שוב. | No pudimos cargar tus facturas ahora. Inténtalo de nuevo. |
| `plan.invoices.view` | View invoice and receipt | צפייה בחשבונית ובקבלה | Ver factura y recibo |
| `plan.invoices.see_all` | See all in Stripe | לכל החשבוניות ב־Stripe | Ver todas en Stripe |
| `plan.invoices.reason.subscription_create` | Plan started | תחילת המינוי | Inicio del plan |
| `plan.invoices.reason.subscription_cycle` | Monthly renewal | חידוש חודשי | Renovación mensual |
| `plan.invoices.reason.subscription_update` | Plan change | שינוי מינוי | Cambio de plan |
| `plan.invoices.reason.other` | Invoice | חשבונית | Factura |
| `plan.invoices.status.paid` | Paid | שולם | Pagada |
| `plan.invoices.status.open` | Due | לתשלום | Pendiente |
| `plan.invoices.status.void` | Not charged | לא חויב | No cobrada |
| `plan.invoices.status.uncollectible` | Unpaid | לא שולם | Impagada |
| `plan.manage.refusal.not_subscribed` | There is no paid plan on your account. | אין מינוי בתשלום בחשבון. | No hay un plan de pago en tu cuenta. |
| `plan.manage.refusal.already_cancelling` | Your plan is already set to end. | המינוי כבר מוגדר להסתיים. | Tu plan ya está programado para terminar. |
| `plan.manage.refusal.not_cancelling` | Your plan is not set to end. | המינוי לא מוגדר להסתיים. | Tu plan no está programado para terminar. |
| `plan.manage.refusal.upgrade_pending` | An upgrade is waiting for payment. Finish or wait for it first. | שדרוג ממתין לתשלום. יש להשלים אותו או להמתין. | Hay una mejora pendiente de pago. Complétala o espera primero. |
| `plan.manage.refusal.unavailable` | This is not available right now. Please try again later. | האפשרות לא זמינה כרגע. אפשר לנסות שוב מאוחר יותר. | No está disponible ahora. Inténtalo más tarde. |
| `plan.manage.refusal.stripe_error` | The payment provider did not respond. Please try again. | ספק התשלומים לא הגיב. אפשר לנסות שוב. | El proveedor de pagos no respondió. Inténtalo de nuevo. |
| `plan.manage.refusal.contact_support` | We could not change your plan. Please contact us at {support}. | לא הצלחנו לשנות את המינוי. אפשר לפנות אלינו ב־{support}. | No pudimos cambiar tu plan. Escríbenos a {support}. |
| `settings.account_delete.blocker.plan_running` (**changed**) | Your plan is still running. Cancel it in Settings → Plan. You can delete your account once it has ended. | המינוי עדיין פעיל. יש לבטל אותו בהגדרות ← מינוי. אפשר למחוק את החשבון אחרי שהמינוי מסתיים. | Tu plan sigue activo. Cancélalo en Ajustes → Plan. Podrás eliminar tu cuenta cuando haya terminado. |

`plan.update_card_email` stays in the dictionaries (removed only after the button has shipped, with its test). The Danger Zone and admin texts are operator-facing English, as today.

---

## 12. Migration Check

**Verdict: no migration.** Every column is in 20261025 with the needed `service_role` grants (§1.4); the mirror write already exists; audit keys are code; the portal configuration lives in Stripe and an env var. The PF-14 rule is unchanged, so the SQL G-6 guard is unchanged.

**A migration would be needed only if** the user answers BQ-2 with "delete right after cancelling": G-6 would then have to treat `cancel_at_period_end = true` as not-live, which means a new version of the generated cleanup function at the next free number (today **20261093**, after `20261092` on `origin/main`; Dev re-checks every remote branch with `git ls-tree` first), with pre-check, checker, probe and rollback, applied by the user by hand. Dev recommends against it (§14).

---

## 13. Rollout and Rollback

**Production after each merge:** inert. The routes need a Business OS plan subscription on our record, and none exists in production while `BUSINESS_OS_PLAN_PRICES_ENABLED` / `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` are off; `my-plan` shows no `manage` controls without one. The only change that is live at merge is **P-7a.3's Reset refusal**, and it fires only for an account with a live subscription, of which production has none (test-mode rows on the production database are possible, PF-15, and correctly refuse).

**Go-live:** row 13 (live portal configuration via the script, env var in Vercel production) gains its script with P-7a.2. Row 1 lists P-7a; row 15's note ("the checkout flag also opens the upgrade routes") gets a sibling note for the P-7a routes, per BQ-1 / TQ-1.

**Rollback:** revert the PR. Nothing is written that the old code cannot read: the cancel flag and status are the same columns the webhook writes.

---

## 14. Open Questions

### 14.1 Business questions (for the user)

**Decisions (2026-10-26).** Asked by TL, the user's chosen options verbatim: **BQ-3** "Ends now (Recommended)" → option A, P-7a.4 in scope, C-11 binding. **BQ-2** "After month ends (Recommended)" → no migration. **BQ-1** "Yes, always (Recommended)". **TL defaults, not asked:** BQ-4 dropped (already decided by PF-14); BQ-5 yes, the Founding Partner sentence shown only when the free-access end is after the paid-through date plus 24 h (SA note); BQ-6 not in v1; BQ-7 last 12 + "See all in Stripe"; BQ-8 parked with the accountant question BQ-P5.

| # | Question, in plain terms | Recommended default |
|---|---|---|
| **BQ-1** | If we ever **stop selling** plans for a while (switch the checkout off), should **existing** customers still be able to cancel, update their card and see their invoices? | **Yes, always.** A paying customer must always be able to leave and to fix their card. (Technically: these screens follow the switch that recognises plan payments, not the one that sells them.) |
| **BQ-2** | After an owner cancels, can they **delete their account straight away**, or only once the paid month has ended? | **Only once it has ended.** The screen tells them the date. Deleting straight away would need a database change and gives nothing back (no refund either way). |
| **BQ-3** | An owner whose card **has just failed** presses Cancel. What happens? A: the plan ends now and we stop trying to charge the card. B: no Cancel button while a payment is failing; they fix the card or write to us. C: it ends at the end of the month, and Stripe keeps trying to charge until then | **A.** It is what the customer expects and avoids charging someone who said stop. Costs about half a day more (P-7a.4). B is free and acceptable before launch only |
| **BQ-4** | A paying owner wants to **reset** (wipe their business data but keep the account and the plan). Allow it, or ask them to cancel first? | **Ask them to cancel first, as already decided** (PF-14). Reset is admin-only today; revisit when owners get the Reset button |
| **BQ-5** | When a **Founding Partner** cancels a paid plan, should the confirmation say they go back to their free Founding Partner access (and until when)? | **Yes.** Otherwise they may think they lose everything |
| **BQ-6** | Ask **why** they are cancelling (a short list of reasons)? | **Not in v1.** Add later once there are customers to learn from |
| **BQ-7** | How many invoices to show in the app? | **The last 12**, with "See all in Stripe" for the rest |
| **BQ-8** | When an account is deleted, should we also **delete the customer in Stripe** (their saved card and email at Stripe)? | **No, keep it**, like our own billing record: invoices must stay reconcilable for accounting. Revisit with the accountant (BQ-P5) |

### 14.2 Technical questions (for SA)

| # | Question | Dev's proposal |
|---|---|---|
| **TQ-1** | Which switch gates the cancel, reactivate, portal and invoices routes? | `isPlanPriceRecognitionEnabled()` (the webhook's switch), not the checkout switch, so pausing sales never strands a payer (BQ-1). Add a §9.5 row-15 sibling note |
| **TQ-2** | After the Stripe write, mirror Stripe's answer onto our row at once, or wait for the webhook? | Mirror at once with the existing `mirrorSubscriptionState` CAS; a mirror failure is a `warn` and the webhook converges (it reads fresh). Two concurrent tabs can briefly write stale state; the fresh-read webhook corrects it |
| **TQ-3** | Stripe idempotency key on the cancel / reactivate update? | None (boolean set; a key would replay stale on cancel → reactivate → cancel). Step 8 absorbs double clicks |
| **TQ-4** | Order contract and cross-checks | As §4.2: every DB read and our-data refusal before Stripe; fresh subscription cross-checked (customer, mode, `bos_user_id`) before the write |
| **TQ-5** | Cancel with a pending upgrade update | Refuse `upgrade_pending`; X-3 confirms Stripe's own behaviour |
| **TQ-6** | Invoice list source | Live Stripe list for our customer id, only when the owner opens it (owner read, not an access decision, SR-11; §7's "never live Stripe for a list" is about admin lists). Price id → tier via `planPriceCatalog`. Money history is not used (no URLs, and U-10's failure rows would mislabel) |
| **TQ-7** | Portal configuration: script modes and runtime check | Script: test by default, live only with `--live` + `--expect-account`; compare-and-stop on drift, never edit. Runtime: env id required (missing → 503, never the default configuration); once per instance retrieve and check features + `livemode` |
| **TQ-8** | Portal flows and locale | `flow_data.type = 'payment_method_update'` for Update card; plain session for "See all"; `locale` from a strict body enum if X-5 shows Stripe accepts it, else `auto` |
| **TQ-9** | What is audited | Cancel and reactivate (owner actor). Portal opening and invoice reads: log only. A cancel made in the Stripe dashboard is not audited by the mirror (it has no previous value to compare); its end is audited by `SUBSCRIPTION_ENDED` with Stripe's reason. Should the mirror audit the flag's transition too? |
| **TQ-10** | PF-14's "409 `subscription_live`" on Reset / Purge | Ride the existing purge contract (200 with a refused outcome, control `subscription_live`), which the Danger Zone already renders; the owner-facing routes keep 409 codes |
| **TQ-11** | Control 3 placement and rule | First in `ResetGuard`, `hasLivePlanSubscription` (both modes, unreadable = refuse), no change to the shared predicate or G-6 |
| **TQ-12** | (P-7a.4) Immediate cancel mechanics and audit | `subscriptions.cancel` (`prorate: false`, `invoice_now: false`) + void the open invoice if X-4 shows Stripe keeps collecting; audit `CANCELLED` with `details.mode = 'immediate'` rather than a new key |
| **TQ-13** | Entitlements registration | New routes register as non-gate importers (`resolveAccountId`); the orchestration imports nothing from the module; `planPurchaseView` re-registered only if BQ-5 adds a `freeAccess` helper call |
| **TQ-14** | `trialing` subscriptions (P-11's Founding Partner trial, not built) | Treated like `active` by `planManageOffer`: cancelling a trial means no first charge. Pinned by a matrix row so P-11 inherits it |

---

## Implementation Notes (P-7a.1)

**Code complete 2026-10-26, uncommitted**, on `feature/bos-plan-payments-p7a` (base `origin/main` `10761291`). No migration. No webhook change.

### Sandbox experiments (standard sandbox `acct_1UPKR4C7KDUGYIcA`, test mode, 2026-10-26)

One throwaway customer `cus_VVnFz501MTeZl0` with subscription `sub_1UUleiC7KDUGYIcAZS6GHEt8` on the `basic` price; both cancelled and deleted the same run. No test clock was used. The user's account `cus_VQf9jX6fnfVlkK` was not touched.

| # | Finding | Consequence |
|---|---|---|
| X-2 | `cancel_at_period_end: true` sets the flag **and** `cancel_at` = the item period end; `false` clears both. `cancel_at: 'max_period_end'` (the dashboard-style "cancel at" option) sets `cancel_at` **only**, flag stays `false`; a later `cancel_at_period_end: false` clears that `cancel_at` too. Four `customer.subscription.updated` events, one per write, in order, each with `previous_attributes` naming the changed fields (endpoint API version `2026-09-30.endive`). | Step 7 treats the flag OR `cancel_at` as cancelling (C-3); Reactivate sends the flag `false`, which clears either. **C-3 follow-up (not fixed here, webhook untouched):** a cancellation set in the dashboard as `cancel_at` alone is not mirrored, because the mirror copies only the flag; the admin list then shows Active. Belongs with the webhook (and AM-7 "who cancelled", TQ-9) |
| X-3 | With an upgrade's `pending_update` open (card `pm_card_chargeCustomerFail`), Stripe **accepted** both `cancel_at_period_end: true` and `false`, the pending update kept. | Refused anyway (`upgrade_pending`, TQ-5 ruling) |

### What was built

`lib/business-os/billing/planManageOffer.ts` (pure, import-free predicate and wire), `planSubscriptionManage.ts` (orchestration, §4.2 order), `StripeService.setBusinessOsCancelAtPeriodEnd` plus `cancelAt` on `retrieveBusinessOsSubscription`, the two routes, `BOS_BILLING_SUBSCRIPTION_CANCELLED` / `_REACTIVATED` (events, metadata, audience `bos`), `purchase.manage` on my-plan, `PlanManage.tsx` + `planManageCopy.ts`, mounted in the drawer (`PlanSection`) and in the Settings pop-up's "Your plan" strip (`UpgradeModal` via `UpgradeSession`), en text and he / es drafts.

### Deviations for SA

1. **`planManageOffer` lives in its own import-free file**, not in `planCheckoutEligibility.ts` (§4.1 said beside `planUpgradeOffer`). That file imports the entitlements config; keeping the predicate import-free means the orchestration, the my-plan wire and the matrix test reach no entitlements symbol (TQ-13).
2. **No `already_cancelling` / `not_cancelling` refusals.** Step 5 (our data) admits either action whenever the row is renewing or cancelling; which state the subscription is in is decided on the FRESH read at step 7, answering 200 `unchanged` (and healing the row, C-2). Refusing on the row would block exactly the press that repairs a stale row.
3. **A lost answer is audited** with outcome `unknown` (as P-7b.1 V-3); §4.9 said "every successful write". Also audited as `unknown`: a Stripe answer for another subscription, customer or mode, or not in the asked state (alerted `stripe_error`, nothing mirrored).
4. **The fresh status is checked too**: `past_due` / `unpaid` at Stripe → `payment_failed_contact_us`; not `active` / `trialing`, or ended → `subscription_not_active`.
5. **BQ-5's Founding Partner sentence moved to P-7a.3.** The my-plan snapshot carries no cohort end while a tier is in force, so the sentence needs the plan row read; it belongs with the AC-F8.3 work.
6. **"Reactivate your plan to upgrade" not built.** `planUpgradeOffer` answers `cancelling` before it checks for a tier above, so the view cannot tell when the line would be true; the upgrade buttons simply disappear while cancelling, as before. **TL decision (2026-10-26): the line is DROPPED**, not carried to P-7a.3; §2.1 updated. Pinned by QA (`PlanManage.p7a1.qa.render.test.tsx`: cancelling → no upgrade offer, no such line, no such key).
7. **`cancelAt` is optional** on `retrieveBusinessOsSubscription`'s return type, so the existing hand-built fakes stay valid; absent reads as null. One existing `toEqual` (`businessOsPlanWebhookReads.test.ts`) gained `cancelAt: null`.
8. **Also mounted in the Settings pop-up** (UM-D3 "Your plan" strip, hidden while a flow is open): a paying owner with an upgrade offer opens the pop-up from the Settings row, not the drawer, so Cancel would otherwise be unreachable for them. `UpgradeModal` gained one optional prop, `onPlanManaged`.
9. **Hebrew drafts say "תוכנית"** (the word the existing plan and upgrade keys use), not "מינוי" as in the §11 draft table.

### Test and gate results (2026-10-26)

| Gate | Result |
|---|---|
| New suites | `planManageOffer` 10, `planManageOffer.matrix` 25, `planSubscriptionManage` 35, `businessOsPlanCancel` 5, route test (cancel + reactivate) 32, `PlanManage.render` 8 |
| Requested set: `app/api/stripe`, `lib/business-os/purge`, `lib/business-os/billing`, `app/api/business-os/billing`, `components/business-os/settings`, `lib/stripe`, `app/api/business-os/entitlements`, `components/business-os/billing`, `app/admin`, `lib/audit`, the billing repository suite (`--ci`) | **328 suites, 11 446 tests, all passed** |
| `npm run test:bos-entitlements` | **306 suites, 9 227 tests, all passed** |
| Connect harness `connectPath.characterisation.test.ts.snap` | md5 `acdad2efd4d646e687e507a3dd0b01e9` before and after (working-tree CRLF copy; git shows it unmodified); never `-u` |
| Typecheck (`tsc --noEmit`, 8 GB heap) | Completed, no OOM; **0 errors in the 29 touched / new `.ts(x)` files** (1 847 pre-existing elsewhere) |
| ESLint on touched source files | 0 errors; 1 pre-existing warning (`lib/audit/events.ts:1803`, not this slice) |
| `npm run build` | **Compiled successfully**; page-data collection then stopped on missing Supabase env (`supabaseUrl is required`, first at `/api/admin/boost-packs`): this worktree has no `.env.local`. Environmental, not this slice |
| Guards updated (registrations, not loosened) | billing-repository callers (both guards), entitlements non-gate importers (two routes), AM-7 coverage (Cancelled / Reactivated now BUILT), audit audience count 60 → 62 |

---

## Implementation Notes (P-7a.2)

**Code complete 2026-10-27, uncommitted**, on `feature/bos-plan-payments-p7a2` (worktree `neuronforge-p7a`, created by RM on top of P-7a.1 `131a46b1`; `git branch --show-current` checked). Not stacked for review: RM merges `origin/main` (with #519) before the PR, which targets `main`. No migration. No webhook change.

### Sandbox experiments (standard sandbox `acct_1UPKR4C7KDUGYIcA`, test mode, 2026-10-26/27)

Every customer was a throwaway created and deleted in the same run (`cus_VVx2ootQjFpa6L`, `cus_VVx2JQT2UZbB6n`, `cus_VVx4bNMX8GexwY`, `cus_VVx615iwKAhBpZ`, `cus_VVx7LpmjK6cINC`, `cus_VVx9srVKPCkpYM` on test clock `clock_1UUvEpC7KDUGYIcACXP3vTCj` (deleted), `cus_VVxcYFlNv7iV5c`); subscriptions cancelled first. `cus_VQf9jX6fnfVlkK` was not touched. The key was read from the env file outside the repo and never printed. The portal page was driven in headless Chrome over the DevTools protocol from a scratch script (no Playwright in the repo; nothing added to it).

| # | Finding | Consequence |
|---|---|---|
| X-1 | A subscription set up as Checkout does (card `4242` as the **subscription's** `default_payment_method`, customer default empty). A portal session on our configuration, `flow_data.type = payment_method_update` with `after_completion` redirect; card `5555 5555 5555 4444` added and confirmed. Afterwards: `customer.invoice_settings.default_payment_method` = the new Mastercard, and the **subscription's `default_payment_method` was cleared to null**, so the next renewal falls back to the customer default, the new card. The redirect landed on the `return_url` | **The portal moves the renewal to the new card. C-7 is not triggered** (no webhook handler, no extra step) |
| X-1b | Same, on a test clock, after a renewal failed (`pm_card_chargeCustomerFail`, subscription `past_due`, renewal invoice `open`, `attempt_count` 1). After the card change in the portal: the invoice stayed `open`, `attempt_count` 1, `next_payment_attempt` unchanged (checked about 3 s later; on a test clock a retry may only run when the clock advances) | **Not retried at once.** §4.4's "Stripe retries the open invoice" is not immediate: the banner clears at Stripe's next scheduled retry, or when the owner pays the open invoice from the list ("Due", **View invoice and receipt**). Recorded for SA (deviation 9); no code change |
| X-5 | `billingPortal.sessions.create` with `locale`: `es` and `en` accepted (`auto` too); `he` and `he-IL` **refused** (`Invalid locale`) | TQ-8: the body accepts `en` / `he` / `es` (strict enum); `he` is sent to Stripe as `auto` (`portalLocaleFor`) |
| Configuration | The script's first `--apply` created `bpc_1UUv5MC7KDUGYIcA3O6iIzRJ` (card update and invoice history on; cancel, plan switching and customer edits off; default return URL `http://localhost:3000/business-os/settings?section=plan`). **Stripe made it the sandbox's DEFAULT configuration**, being the account's first (no `is_default` parameter was sent). Re-runs: "OK … matches" (idempotent); a different `--return-origin` stops; `--live` with a test key and a wrong `--expect-account` are refused before any write | The script reports this as a NOTE, not a stop (deviation 4). Go-live row 13 now names the command |
| Live check | The real `StripeService` methods and the real orchestration (fake repository, no database) against the sandbox, 10 / 10: configuration read; one paid `usd` invoice of 7900 with its line price read through clover's `pricing.price_details.price`; hosted link on `https://invoice.stripe.com/`; invoice PDF on `https://pay.stripe.com/`; the plan label "Essentials" from the catalog; portal URLs for `update_card` (`he` → `auto`) and `invoices`; no bearer link in any log line; an unknown customer refused `stripe_error` | — |

### What was built

- `lib/business-os/billing/portalConfiguration.ts`: the specification `BOS_PORTAL_FEATURES` (shared by the script and the runtime), `readPortalConfigurationId` (env, `bpc_…` only), `ensurePortalConfiguration` (retrieve and check features, mode and active once per instance; success only cached, C-6; every refusal alerted), `PORTAL_RETURN_PATH` (pinned equal to the checkout's `settings_plan` path).
- `scripts/setup-bos-portal-configuration.ts` (C-8, TQ-7): `stripe-script-guards` for `--env`, key kind and `--expect-account`; test by default (`sk_test` only), `--live` accepts only `sk_live` / `rk_live`; dry run by default; finds ours by metadata `product: business_os_portal`; creates once (idempotency key per mode); compare-and-stop on any drift, never edits; every listed object checked for mode; prints the `bpc_…` id, never the key.
- `StripeService`: `retrieveBusinessOsPortalConfiguration`; `createBusinessOsPortalSession` (configuration, customer, `return_url`, `locale`; `update_card` adds `flow_data` `payment_method_update` with an `after_completion` redirect to the same URL, C-6); `listBusinessOsInvoices` (one `invoices.list` call, the caller's limit clamped to 1..100, no paging; facts only). The legacy agent-platform `createPortalSession` / `listInvoices` are untouched and unused.
- `planManageOffer.ts`: `planCardAndInvoicesOffer` (price switch on, and our row holds a customer **and** a subscription id, ended included) and `cardAndInvoices` on `planManageWire` (present only when true). `planPurchaseView` feeds it from the same row read: no new read on the drawer open.
- `lib/business-os/billing/planInvoiceList.ts` (pure, one type import) and `planBillingDocuments.ts` (orchestration of both routes over injected ports; one refusal table; our data before any Stripe call; the session's customer, mode and configuration checked before a portal URL is returned; the plan label from the plan price catalog, cosmetic; invoices for another customer or mode, or not USD, dropped and alerted by id).
- Routes `POST /api/business-os/billing/plan/portal` (strict body `{ intent, locale? }`) and `GET /api/business-os/billing/plan/invoices` (any query parameter is a 400), per `new-api-route`: price-switch 404 first, `getUser()`, Zod, Pino with `correlationId`, the `development` guard on `details`, **`Cache-Control: no-store` on every answer** (C-6). Not audited (TQ-9); logged with ids and counts only.
- UI: `components/business-os/settings/PlanCardAndInvoices.tsx`, mounted by `PlanManage` where `manage.cardAndInvoices` is set (the drawer and the Settings pop-up's "Your plan" strip; hosts unchanged). Update card navigates in the same tab (one request even on a double click; reset when the page is restored from the back/forward cache). Invoices loads only when opened, once per open: rows with date, what it was for, plan, USD amount, status, **View invoice and receipt** in a new tab (**Pay now** on a Due (`open`) row, same hosted link: FU-P7a2-1, G-5 2026-10-27); empty; "could not load" with Try again; **See all in Stripe** when there are more. `PlanBillingNotices` hides "use the link in Stripe's email" where the button is offered. `PlanPaymentBanner` comment updated. Refusals map by code to the shipped `plan.manage.refusal.*` lines (`planManageCopy.ts`).
- Wording: 19 keys in en, he / es (below), **approved by the user 2026-10-27 (G-5)**, plus `plan.invoices.pay_now` for FU-P7a2-1 (20 keys). Docs: `BUSINESS_OS_ENTITLEMENTS.md` § Billing env row and Change History; `.env.example` (the TEST id only); requirement P-7a row, §9.5 row 13 and Change History.
- Guards updated (registrations, not loosened): billing-repository callers (`routerPlacement.guard`, and `BusinessOsBillingAccountRepository.test` for `planBillingDocuments.ts` and the new route test); entitlements non-gate importer `planBillingDocuments.ts` (`TIER_MATRIX`, label only); the `PlanManage.p7a1.qa` `plan.manage.*` key count 21 → 23.

### Deviations for SA

1. **One orchestration file, `planBillingDocuments.ts`,** beside the pure `planInvoiceList.ts` (§5 listed only the latter and the routes). Both routes share the row read, the predicate and the refusal table, as P-7a.1's `planSubscriptionManage.ts` does for cancel and reactivate.
2. **`cardAndInvoices` needs a subscription id as well as a customer** (§4.1 said "customer exists"). The customer is created when a checkout starts, so an owner who opened a checkout and never paid would otherwise see "Update card" for a plan they never had. Ended subscriptions still qualify (receipts). One flag, not separate `portal` / `invoices` booleans: they are always equal.
3. **No `invoicePdfUrl` on the wire** (§4.5 listed it). Stripe's hosted page already offers "Download invoice" and "Download receipt", and the screen shows one link. The PDF URL is read into the `StripeService` facts only.
4. **Default configuration is a NOTE, not a stop.** Stripe makes an account's first configuration its default. Ours being the default is harmless for Business OS (every session names its configuration) but narrows any portal opened without one (the parked agent platform's legacy `create-portal`) to card and invoices; on the sandbox that is now the case. In live mode, if the account already has a configuration, ours does not become the default. The script never edits the default.
5. **Negative invoice totals are kept** (a credit), shown as "-$5.00"; §4.5 gave no sign rule. A non-integer total is dropped as unreadable.
6. **The routes do not import `resolveAccountId`**: the billing row is keyed on the session user (as `my-plan` and the cancel route's `findByUser`), there is no `bos_user_id` cross-check (no subscription is written) and nothing is audited. So the routes import nothing from the entitlements module, and §4.8's route registrations are not needed; `planBillingDocuments.ts` is registered instead (`TIER_MATRIX`, for the label).
7. **Strict invoice query:** `GET …/invoices` refuses any query parameter (a strict empty Zod object over the search params), so an injected `customerId` is a visible 400 rather than silently ignored.
8. **`plan.update_card_email` stays where no button is offered** (switch off, or a row without a subscription id) rather than being removed; its tests are unchanged. While an upgrade flow is open in the pop-up (or a checkout is processing in the drawer) `PlanManage` is hidden and so is the email line: transient, and an owner in a failed renewal is not offered an upgrade.
9. **X-1b (a past-due invoice is not retried at once)** changes what the demo should expect after a card update during a failed renewal: the banner stays until Stripe's next retry, unless the owner pays the "Due" invoice from the list. No code change proposed; SA may want a Settings line later (not built).

### Wording (P-7a.2; he / es approved by the user 2026-10-27, G-5)

Hebrew follows the shipped "תוכנית" wording and the plural present ("פותחים", "טוענים") of the G-5 fix, not the §11 drafts' "מינוי". **G-5 approved by the user 2026-10-27** as drafted, with TL's recommendation FU-P7a2-1 accepted: a Due (`open`) row's link reads **Pay now** (`plan.invoices.pay_now`), the same hosted-invoice URL in a new tab with `noopener noreferrer`; every other status keeps "View invoice and receipt". The he / es comments in the dictionaries say "approved by the user 2026-10-27 (G-5)".

| Key | en | he | es |
|---|---|---|---|
| `plan.manage.update_card` | Update card | עדכון כרטיס | Actualizar tarjeta |
| `plan.manage.opening_stripe` | Opening Stripe… | פותחים את Stripe… | Abriendo Stripe… |
| `plan.invoices.title` | Invoices | חשבוניות | Facturas |
| `plan.invoices.show` | Show invoices | הצגת חשבוניות | Ver facturas |
| `plan.invoices.hide` (new) | Hide invoices | הסתרת חשבוניות | Ocultar facturas |
| `plan.invoices.loading` (new) | Loading invoices… | טוענים חשבוניות… | Cargando facturas… |
| `plan.invoices.empty` | No invoices yet. | אין עדיין חשבוניות. | Todavía no hay facturas. |
| `plan.invoices.unavailable` | We could not load your invoices right now. Please try again. | לא הצלחנו לטעון את החשבוניות כרגע. כדאי לנסות שוב. | No pudimos cargar tus facturas ahora. Inténtalo de nuevo. |
| `plan.invoices.retry` (new) | Try again | לנסות שוב | Reintentar |
| `plan.invoices.view` | View invoice and receipt | צפייה בחשבונית ובקבלה | Ver factura y recibo |
| `plan.invoices.pay_now` (new, FU-P7a2-1; Due rows only) | Pay now | לתשלום עכשיו | Pagar ahora |
| `plan.invoices.see_all` | See all in Stripe | לכל החשבוניות ב־Stripe | Ver todas en Stripe |
| `plan.invoices.reason.subscription_create` | Plan started | תחילת התוכנית | Inicio del plan |
| `plan.invoices.reason.subscription_cycle` | Monthly renewal | חידוש חודשי | Renovación mensual |
| `plan.invoices.reason.subscription_update` | Plan change | שינוי תוכנית | Cambio de plan |
| `plan.invoices.reason.other` | Invoice | חשבונית | Factura |
| `plan.invoices.status.paid` | Paid | שולם | Pagada |
| `plan.invoices.status.open` | Due | לתשלום | Pendiente |
| `plan.invoices.status.void` | Not charged | לא חויב | No cobrada |
| `plan.invoices.status.uncollectible` | Unpaid | לא שולם | Impagada |

Refusals reuse the shipped `plan.manage.refusal.*` lines (no new refusal copy).

### FU-P7a2-1 "Pay now" on a Due row (CLOSED 2026-10-27)

User decision 2026-10-27 (G-5), accepting TL's recommendation: the link on an `open` row reads **Pay now**; no extra line under Update card. Built: `PlanCardAndInvoices.tsx` picks `plan.invoices.pay_now` when `invoice.status === 'open'`, else `plan.invoices.view`; the `href`, `target="_blank"` and `rel="noopener noreferrer"` are unchanged. Key counts pinned at 20 (was 19) in `PlanCardAndInvoices.render.test.tsx` and `PlanCardAndInvoices.p7a2.qa.render.test.tsx`; the QA RTL test now expects "Pay now" on its Due row and "View invoice and receipt" on its paid row; one new render test (en + he): open row "Pay now", paid row "View invoice and receipt", same link attributes. SA code review comment 3 and deviation 9's follow-up are thereby resolved. **C-11 still binds P-7a.4** (the Due link is the path by which an owner could pay after an immediate cancel).

| Gate (2026-10-27, FU-P7a2-1) | Result |
|---|---|
| `components/business-os/settings`, `components/business-os/billing`, `lib/business-os/billing`, `app/api/business-os/billing` | **100 suites, 4 869 tests, all passed** |
| `npm run test:bos-entitlements` | 308 suites, 9 270 tests: **9 269 passed, 1 failed**, not from this change: `BusinessOsBillingAccountRepository.test` "only the listed files name the repository" finds the uncommitted QA file `app/api/business-os/billing/plan/portal/__tests__/route.p7a2.qa.test.ts`, which is not in its `ALLOWED` list (registration owed; left for TL to route) |
| Typecheck (`tsc --noEmit`, 8 GB heap) | Completed; 0 errors in the touched files (1 864 pre-existing elsewhere) |

### Test and gate results (2026-10-27)

| Gate | Result |
|---|---|
| New suites | portal + invoices routes 44, `PlanCardAndInvoices.render` 19, `planBillingDocuments` 9, `planInvoiceList` 17, `portalConfiguration` 14, `planCardAndInvoicesOffer` 6, `businessOsPlanPortal` (StripeService) 5, `setupBosPortalConfiguration` (script) 20 (134 in all) |
| Requested set: `app/api/stripe`, `lib/business-os/billing`, `app/api/business-os/billing`, `components/business-os/settings`, `components/business-os/billing`, `lib/stripe`, `lib/audit`, `lib/business-os/purge`, `app/api/business-os/entitlements`, the billing repository suite, the two script suites (`--ci`) | **165 suites, 6 296 tests, all passed** |
| `npm run test:bos-entitlements` | **308 suites, 9 270 tests, all passed** |
| Connect harness `connectPath.characterisation.test.ts.snap` | md5 `ab7528ea68309cffb309ffbd46c455ab` before and after (git shows it unmodified); never `-u` |
| Typecheck (`tsc --noEmit`, 8 GB heap) | Completed, no OOM; **0 errors in the 31 touched / new `.ts(x)` files** (1 864 pre-existing elsewhere, including stale `.next/types`) |
| ESLint on the 24 touched / new source and test files | 0 findings |
| Sandbox live check (scratch script, not in the repo) | 10 / 10; throwaway customer deleted |
| `npm run build` | Not run in this slice (P-7a.1's build stop was the worktree's missing `.env.local`, accepted as environmental); compile-affecting changes are covered by the typecheck |

## Implementation Notes (P-7a.4)

**Code complete 2026-10-27, uncommitted**, on `feature/bos-plan-payments-p7a4` (worktree `neuronforge-p7a4`, fresh from `origin/main` `89cd0d90`, which holds P-7a.1 #519, P-7a.2 #528 and D2 #525; `git branch --show-current` checked). Its PR opens only after P-7a.3 merges. No migration. No webhook or apply-path change.

### Sandbox experiment X-4 (standard sandbox `acct_1UPKR4C7KDUGYIcA`, test mode, 2026-10-27)

Run as a scratch script (not in the repo); the key was read from the env file outside the repo and never printed; `cus_VQf9jX6fnfVlkK` was not touched. Test clock `clock_1UV94dC7KDUGYIcAqKYOUzZV` with three throwaway customers on the `bos_plan_basic_monthly_usd` price: A1 `cus_VWBRHKDcQ9bTT1` / `sub_1UV94fC7KDUGYIcAmAum5m7Y`, A2 `cus_VWBR4XfpeHM3j0` / `sub_1UV94iC7KDUGYIcAc0jYhr1e`, B `cus_VWBRHnIXC1ebap` / `sub_1UV94lC7KDUGYIcAygnuJ2P8`. All three customers and the clock were deleted in the same run.

| # | Finding | Consequence |
|---|---|---|
| X-4a | A1 and A2 renewed on a failing card (`pm_card_chargeCustomerFail`), clock past the period end + 1 day: subscription `past_due`, renewal invoice `open`, `attempt_count` 1, `next_payment_attempt` set, `auto_advance` true | The P-7a.4 starting state |
| X-4b | `subscriptions.cancel(id, { invoice_now: false, prorate: false }, { idempotencyKey })` → `status: canceled`, `ended_at` = now (clock time), `cancel_at_period_end` false, **`cancellation_details.reason: 'cancellation_requested'`** (comment and feedback null). Events: `customer.subscription.deleted` (reason `cancellation_requested`), then `invoice.updated` on the open invoice | The webhook's existing `.deleted` path records the end and the `subscription_ended` row; nothing new is needed there |
| X-4c | **The open invoice stays `open` and payable.** Stripe only stops collecting it (`auto_advance` false, `next_payment_attempt` null). Eight clock days later: still `open`, never retried | Stripe does not void it by itself |
| X-4d | **Paying it after the cancel succeeds:** `invoices.pay` with a good card on A1's invoice → `paid`, events `invoice.paid` + `invoice.payment_succeeded`, the subscription stays `canceled`. `applyPaidPlanInvoice` has no refusal for an ended subscription (it reads the status only as a fact), so that `invoice.paid` would put the paid tier back with no subscription | **C-11 needs the void.** The "prove by test that apply refuses" option is false today |
| X-4e | `invoices.voidInvoice` on A2's open invoice after its cancel → `void`. A second void → `StripeInvalidRequestError` "You can only pass in open invoices. This invoice isn't open." Paying the voided invoice → refused, "Voided invoices cannot be paid." Events `invoice.updated`, `invoice.voided` | C-11 met: the hosted "Pay now" link can no longer restore the tier |
| X-4f | `invoices.list({ subscription, status: 'open' })` returns exactly that subscription's open invoice; the invoice's subscription is on clover's `parent.subscription_details.subscription` | The sweep lists by subscription and still cross-checks customer, subscription and mode |
| X-4g (TL / SX-2b) | **`cancellation_details.reason` after (a) the immediate cancel: `cancellation_requested`; after (b) a P-7a.1 period-end cancel (B: `cancel_at_period_end: true`) reaching its end on the clock: `cancellation_requested`** (also already set, with `canceled_at`, at the moment the flag was set; `.deleted` carried it) | Both of our cancel paths leave Stripe's own `cancellation_requested`; a Stripe dunning end would read `payment_failed`. The immediate call sends no `cancellation_details` (pinned by `businessOsPlanCancelNow.test.ts`) |

### What was built

- **`planManageOffer`**: P-7a.1's `none` / `payment_failed` becomes a new kind **`failing`** (a renewal failure open: `past_due`, `unpaid`, or `failed_attempts > 0` on a live status). The wire for `failing` is `{ cancel: true, reactivate: false, paymentFailed: true }`. A failure count left on a status that is not live (`canceled`, `paused`, unknown) now offers nothing (it used to offer only the "contact us" line).
- **`planSubscriptionManage.ts`** (the one engine, D2 W-7). Our row only ADMITS the cancel; **Stripe's fresh status picks the mode** (SA's P-7a.1 binding note): `past_due` / `unpaid` → the immediate path; `active` / `trialing` (cured, webhook lagging) → the unchanged period-end path; a `failing` row whose subscription Stripe already ended → `unchanged` / `ended`, healed, no write, no audit. A Reactivate on a failing row (record) or on a `past_due` subscription (Stripe) is still refused `payment_failed_contact_us`. Immediate path: I-1 pending upgrade update → `upgrade_pending` (TQ-5); I-2 `cancelBusinessOsSubscriptionNow` under `bos-plan-manage:{sub}:cancel_now:{attempt}` (D2's per-attempt key, never logged); refused-before-run errors → `stripe_error`, not audited; a lost answer or an answer that is not OUR ended subscription → `outcomeUnknown`, audited `unknown`, no sweep; I-3 (C-11) list the subscription's open invoices and void each that matches our customer, subscription and mode, each its own call under `bos-plan-manage:{invoice}:void:{attempt}`; I-4 mirror `canceled` + `ended_at` from Stripe's answer. **A void that cannot be done never fails the request** (the plan has ended): counted in `invoicesLeftOpen`, logged `error` + `alert: true` (`bos_billing_cancel_now_invoice_left_open`); a failed list or a second page → `invoicesLeftOpen: null`.
- **`StripeService`**: `cancelBusinessOsSubscriptionNow` (params EXACTLY `{ invoice_now: false, prorate: false }`, the key, no `cancellation_details`; returns `BusinessOsCancelFacts`), `listBusinessOsOpenSubscriptionInvoices` (one page of 20, facts only), `voidBusinessOsInvoice` (no params but the key). `oneDontRenewPath.guard.test.ts`'s engine-only list gains `cancelBusinessOsSubscriptionNow` and `voidBusinessOsInvoice`.
- **Cancel route**: the answer gains `mode: 'immediate'` on the immediate end (absent on period end, so P-7a.1 answers are unchanged), and `unchanged` may carry `state: 'ended'`. Audit (TQ-12): the same `BOS_BILLING_SUBSCRIPTION_CANCELLED`, `details.mode = 'immediate'`, `endsOn` = when it ended, `invoicesVoided`, `invoicesLeftOpen` (immediate only), and D2's optional `reasonCode` (left optional, as agreed). `events.ts`: comment and description edited in place.
- **UI (`PlanManage.tsx`)**, kept to four small hunks away from P-7a.3's: with `manage.paymentFailed` the line reads "Your payment failed. Update your card to keep your plan, or cancel it to end it now." and Cancel is shown; its confirmation (`plan-manage-confirm-now`) says the plan **ends now** and names no date (C-11); after the press, `mode: 'immediate'` or `state: 'ended'` reads "Cancelled. {plan} has ended, and your card will not be charged again."; a period-end answer (Stripe had cured it) reads the usual "You keep {plan} until {date}". `planManageCopy`: `payment_failed_contact_us` → `plan.manage.refusal.payment_failed`.
- **What follows without code**: the banner. `planPaymentNotice` checks `ended_at` first, so once the mirror (or the `.deleted` webhook) writes the end the "payment failed" banner becomes "Your {plan} subscription has ended. Choose a plan to continue." while the lifecycle reads grace / paused (a Founding Partner whose free access is live sees none, AC-F6.5). Settings → Plan shows the ended state; the invoice list shows the renewal as "Not charged" (`void`, U-10 wording) with no "Pay now". The money history gets one `subscription_ended` row from the `.deleted` mirror (our pre-emptive mirror does not suppress it: the CAS is on the subscription id only). The admin list reads the row: Ended.

### Wording (P-7a.4; en final, he / es DRAFTS for G-5)

| Key | en | he (draft) | es (draft) |
|---|---|---|---|
| `plan.manage.payment_failed_cancel_now` | Your payment failed. Update your card to keep your plan, or cancel it to end it now. | התשלום נכשל. אפשר לעדכן את הכרטיס כדי להשאיר את התוכנית, או לבטל אותה ולסיים אותה עכשיו. | Tu pago no se realizó. Actualiza tu tarjeta para conservar tu plan, o cancélalo para terminarlo ahora. |
| `plan.manage.cancel_now_body` | Your last payment didn't go through. If you cancel, {plan} ends now and we stop trying to charge your card. The unpaid invoice is cancelled, so there is nothing left to pay. | התשלום האחרון לא עבר. אם מבטלים, {plan} מסתיימת עכשיו ואנחנו מפסיקים לנסות לחייב את הכרטיס. החשבונית שלא שולמה מבוטלת, כך שאין מה לשלם. | Tu último pago no se realizó. Si cancelas, {plan} termina ahora y dejamos de intentar cobrar tu tarjeta. La factura pendiente se anula, así que no queda nada por pagar. |
| `plan.manage.cancel_now_confirm` | Yes, end it now | כן, לסיים עכשיו | Sí, terminarlo ahora |
| `plan.manage.ended_now` | Cancelled. {plan} has ended, and your card will not be charged again. | התוכנית בוטלה. {plan} הסתיימה, והכרטיס לא יחויב שוב. | Cancelado. {plan} ha terminado y no se volverá a cobrar tu tarjeta. |
| `plan.manage.refusal.payment_failed` | Your payment failed. Update your card first, or cancel your plan. | התשלום נכשל. קודם צריך לעדכן את הכרטיס, או לבטל את התוכנית. | Tu pago no se realizó. Primero actualiza tu tarjeta, o cancela tu plan. |

Retired: `plan.manage.payment_failed_contact` (P-7a.1's "contact us to cancel" line), removed from en / he / es. `plan.manage.*` count 23 → 27 (`PlanManage.p7a1.qa` pin).

### Deviations for SA

1. **C-11 by voiding, not by test**: X-4d shows the apply path would honour a late `invoice.paid` on an ended subscription. Voiding is in the engine, after the cancel, as C-11's first option. **Residual windows, alerted not closed:** (a) the owner pays the hosted link in the seconds between the cancel and the void; (b) the cancel's answer is lost (`outcomeUnknown`, the sweep does not run; `stripe_error` is already alerted, and the log carries `invoiceSweep: 'not_run'`); (c) a void or the list fails. In each, an operator voids the invoice in Stripe. A defence in the apply path (refuse `invoice.paid` whose subscription Stripe reports `canceled` with `ended_at` before the invoice's period end) would close all three, but it is a webhook-side change and the brief says stop for SA: **recommended as a follow-up for SA to rule on**, not built.
2. **Void failures do not fail the request.** The subscription has ended at Stripe, so answering 502 would misreport it. The result is `cancelled` / `immediate` with `invoicesLeftOpen` > 0 (or null) in the audit and an alerted log line.
3. **`unchanged` / `ended`** (new state) only when our row says `failing` and Stripe says `canceled` with `ended_at`: a second tab, or Stripe's own dunning end before our mirror. Other rows keep P-7a.1's `subscription_not_active` (pinned tests unchanged). It does not re-run the void sweep (no unaudited money write); the first press's audit already records any leftover.
4. **Our row's `failing` admits a cancel; the mode follows Stripe**, both ways: a cured row gets a period-end cancel (binding note), and a row that still says renewing while Stripe says `past_due` ends now (the confirmation the owner saw then was the period-end one; the line after the press tells the truth). A `cancelling` row with a `past_due` subscription also ends now: `planManageOffer` checks the failure before the cancel flag, so that row answers `failing` and the screen offers Cancel ("ends now"), not Reactivate (pinned in `planManageOffer.test.ts`). *(Corrected by SA code review 2026-10-27; the first draft said the screen shows Reactivate there.)*
5. **`failing` needs a live status for the count branch**: `failed_attempts > 0` on `canceled` / `paused` / unknown answers `not_active`, so Cancel is never offered for a subscription that cannot be cancelled. Before P-7a.4 that row showed only the contact line.
6. **The key namespace**: `cancel_now` and `void` suffixes in D2's `bos-plan-manage:` shape, from the same attempt id (one per `managePlanSubscription` call). Not logged; pinned.
7. **`reasonCode` stays optional** on the immediate cancel (SA: required only by whichever slice holds the engine after D3 merges).
8. **P-7a.3 merge notes** (its PR merges first): `PlanManage.tsx` hunks were placed apart from P-7a.3's (header paragraph above the P-7a.2 one, `endsNow` beside `planName`, the confirm split on its own line); the `PlanManage.p7a1.qa` key-count pin, the three dictionaries (adjacent `plan.manage.*` lines), this workplan and the requirement P-7a row will conflict textually and need a hand merge (count = 27 + P-7a.3's additions). **After the merge, P-7a.3's Founding Partner sentence (`freeAccessAfter`) should also show in the "ends now" confirmation**, since `planPurchaseView` now sends `manage.cancel` on a failing row and P-7a.3 computes the sentence beside Cancel; wording for that case ("Then you go back to your Founding Partner free access…") reads correctly after an immediate end too. To be done in the P-7a.4 PR after rebasing on P-7a.3.

### Test and gate results (2026-10-27)

| Gate | Result |
|---|---|
| New suites | `planCancelNow.p7a4` (engine) 23, `businessOsPlanCancelNow` (StripeService call shapes, incl. "no `cancellation_details`") 4, `route.p7a4` (cancel route, audit `mode: immediate`) 4, `PlanManage.p7a4.render` 9 (40 in all) |
| Changed suites | `planManageOffer` / `.matrix` (the matrix now counts the immediate end as a write: the screen offers Cancel exactly where the route writes), `planCardAndInvoicesOffer`, `planSubscriptionManage` (the failed-payment refusals are now Reactivate-only), cancel `route.test`, `PlanManage.render`, `PlanManage.p7a1.qa` (key count 23 → 27), `oneDontRenewPath.guard` (engine-only list + 2), `BusinessOsBillingAccountRepository` caller allow-list (+ `route.p7a4.test.ts`) |
| Requested set, run one after another | `app/api/stripe` 22 / 581; `lib/business-os/billing` 49 / 3 766; `app/api/business-os/billing` 7 / 260; `components/business-os/settings` 51 / 952; `components/business-os/billing` 1 / 17; `lib/stripe` 10 / 103; `lib/audit` 16 / 189; `lib/admin/environment` 4 / 122; `lib/repositories/__tests__` 120 / 2 896: **all passed** (first run: the repository caller guard needed the new route test registered, fixed; `PlanPurchase.render` timed out once while ESLint ran beside it, 47 / 47 alone and in the re-run of the whole folder) |
| `npm run test:bos-entitlements` | **313 suites, 9 401 tests, all passed** |
| Connect harness `connectPath.characterisation.test.ts.snap` | md5 `ab7528ea68309cffb309ffbd46c455ab` (unchanged; git shows it unmodified); never `-u` |
| Typecheck (`tsc --noEmit`, 8 GB heap) | Completed, no OOM; **0 errors in the touched / new files** (1 849 pre-existing elsewhere) |
| ESLint on the 23 touched / new source and test files | 0 errors; 1 pre-existing warning in `lib/audit/events.ts` (line 1839, not touched) |
| Env reads | None added (EC-3 catalogue unaffected) |
| `npm run build` | Not run (the worktree has no `.env.local`, as P-7a.1 / P-7a.2) |
| Sandbox X-4 | Above; every object deleted in the same run |

### QA E-1 and E-2: CLOSED by TL ruling (2026-10-27)

- **E-1 (second tab reads "not active").** TL: a second tab pressing Cancel after the immediate end has landed must read "has ended". Built in `planSubscriptionManage.ts` step 5: a **cancel** on a row whose record shows `ended_at` (any ended plan, not only a former failing one) answers `unchanged` / `ended` with our row's `ended_at`, **from our row: no Stripe call, no write, no audit** (logged `info`, `source: 'record'`). A reactivate on such a row keeps 409 `subscription_not_active`. The screen already maps `state: 'ended'` to "has ended". Tests: `planSubscriptionManage.test.ts` (the order-contract row moved into its own test: cancel → `unchanged` / `ended`, reactivate → refused, both with zero Stripe calls); the two QA pins updated (`route.p7a4.qa.test.ts` tab B after the mirror → 200 `unchanged` / `ended`, only `db:findByUser`, one audit in all; `PlanManage.p7a4.qa.render.test.tsx` → "has ended", never "not active"); one new route test in `route.p7a4.test.ts` (ended row → 200 from the row, no Stripe, no audit). Deviation 3 is superseded for rows our record shows ended.
- **E-2 (stale server English).** `PLAN_MANAGE_REFUSALS.payment_failed_contact_us.message` is now "Your payment failed. Update your card first, or cancel your plan." (the en `plan.manage.refusal.payment_failed` line); a route test pins equality with the dictionary and no "contact us". The code name is kept: it is on the wire, in `planManageCopy` and in a dozen tests, and renaming it buys nothing (TL: rename only if cheap).

Re-run after E-1 / E-2, one after another: `app/api/stripe` 22 / 581; `lib/business-os/billing` 49 / 3 768; `app/api/business-os/billing` 8 / 279; `components/business-os/settings` 52 / 970 (first pass: 5 timing failures in `PlanUpgrade.render.test.tsx`, a file P-7a.4 does not touch; 76 / 76 alone and 52 / 970 on the folder re-run); `lib/stripe` 10 / 103; `lib/audit` 16 / 189; `lib/server` 11 / 148; `lib/repositories/__tests__` 120 / 2 896; `npm run test:bos-entitlements` **313 / 9 401**. All passed. Deviation 8's Founding Partner sentence in the "ends now" confirmation waits for RM's merge of `main` (P-7a.3, #534).

### Merge of `origin/main` (P-7a.3, #534) and SA deviation 8 (2026-10-27)

P-7a.4 committed as `639a5b59` (user-approved). TL merged `origin/main`; Dev hand-merged the three textual conflicts, uncommitted and staged, awaiting SA re-review:

- **`PlanManage.p7a1.qa.render.test.tsx`** key-count pin: **28** = P-7a.1's 21 + P-7a.2's 2 + P-7a.3's 1 (`cancel_confirm_founding`) + P-7a.4's +5 −1. Counted in en, he and es after the merge: 28 each, no duplicate, `payment_failed_contact` absent.
- **This workplan and the requirement**: both sides kept. P-7a.3 shown as merged (#534); its SA review and QA report sit before P-7a.4's; the task rows, change history and requirement §9.1 row carry both slices.
- **Semantic conflict, auto-merged file**: `planPurchaseView.test.ts` (P-7a.3) pinned "a failed renewal (no Cancel yet): the port is never called". P-7a.4 gives a failed renewal a Cancel, so the view now asks the port there, and deviation 8 needs exactly that. The `past_due` case moved to the "the port answer is on manage" list; no product change in `planPurchaseView.ts`. The billing-repository ALLOWED list merged sorted with no edit; translations merged clean.
- **Deviation 8 (binding)**: `PlanManage.tsx` shows `foundingLine` (the same `plan.manage.cancel_confirm_founding` sentence, the same `manage.freeAccessAfter` the server sends on the BQ-5 rule) after `cancel_now_body` in the `plan-manage-confirm-now` paragraph, the same way P-7a.3 shows it in `plan-manage-confirm`. No new key. Test: `PlanManage.p7a4.render.test.tsx` "SA deviation 8" (founding past_due account → sentence present, after "ends now"; non-founding → absent).
- **Runs (one after another)**: `components/business-os/settings` 53 / 989 before the new test, `PlanManage*` 6 / 78 after it; `lib/business-os/billing` + `lib/business-os/purge` 66 / 4 296; `lib/stripe` + `app/api/business-os/billing` + the billing repository suite 19 / 512; `lib/admin/environment` + `lib/server` 15 / 270; `app/api/stripe` 22 / 581; `planPurchaseView` + `app/api/business-os/entitlements` 2 / 87. All passed. Typecheck (`tsc --noEmit`, 8 GB heap): completed, no OOM; 0 errors in the touched files (1 849 pre-existing elsewhere, the same count as before the merge).

---

## Implementation Notes (P-7a.3)

**Code complete 2026-10-27, uncommitted**, on `feature/bos-plan-payments-p7a3` (worktree `neuronforge-p7a`, created by RM on top of P-7a.2 `f3176607`; `git branch --show-current` checked). RM merges `origin/main` (with #528, and its env-catalogue fix `663aa9b9`) before the PR, which targets `main`. **No migration. No webhook change.** No sandbox call was needed for this slice (everything is our own data and pure lifecycle); the live half is the demo below.

### What was built

- **Control 3 in `ResetGuard`** (PF-14; SA C-9, TQ-10, TQ-11): `hasLivePlanSubscription(userId)` (both modes, the shared `isPlanSubscriptionLive`) runs FIRST, before the Connect resolver. Live → refused, control `subscription_live`, message "This business has a live plan subscription. Cancel it in Settings → Plan, and reset once it has ended." `null` (or a throw) → `subscription_unreadable`. Commit time only, before the snapshot, like controls 1 and 2; the preview is unchanged. Both codes added to `ResetGuardResult['control']` and `ResetRefusal`. The Danger Zone prints the server's message (no client map, C-9).
- **Admin surface** passes through control 3 (agrees with R-3). Because `AdminDeletionCommitCode` includes `ResetRefusal` and is pinned both ways against the client's `DeletionCommitCodeView`, the two codes were added to `app/admin/users/types.ts`, with a sentence each in `deletionCopy.ts` (reached only if a subscription starts between preview and delete; R-3 refuses it at the preview).
- **Wording (C-10):** `R3_CLEARING` is now "The owner cancels it in Settings → Plan, or cancel it in the Stripe dashboard, in the mode shown (test or live). Deletion is possible once the subscription has ended." (exported). `settings.account_delete.blocker.plan_running` en + the `DangerZonePanel.tsx` fallback: "Your plan is still running. Cancel it in Settings → Plan. You can delete your account once it has ended." (no `{support}` slot any more); he / es drafts below. **G-6's operator `clears` text in the applied cleanup function is unchanged** ("Cancel the subscription in the Stripe dashboard …"): it is operator-facing and changing it is a migration (C-10).
- **Cross-path pin** `lib/business-os/purge/__tests__/planSubscriptionLive.paths.test.ts` (119 tests): (1) every G-6 in the newest cleanup migration, chosen by the generator's filename pattern `^\d{8}[a-z]?_operator_(test_)?account_cleanup(_…)?\.sql$` (today `20261094`, asserted equal to the generator's `MIGRATION_FILE`), and in the operator check / delete scripts, lists exactly `R3_LIVE_STATUSES` plus the "subscription id, not ended" clause (with a non-vacuity drift check); (2) G-6 read as a predicate equals `isPlanSubscriptionLive` for all 8 statuses + null × subscription id × ended; (3) for each of those rows in either mode, the real `evaluateResetGuard`, the real R-3 (`evaluateAdminDeletionRefusals` over `readPlanBilling`) and `hasLivePlanSubscription` agree, and a failed read refuses on both TS paths; (4) source wiring: the guard imports the shared read and writes no status literal, R-3 and the read decide through `isPlanSubscriptionLive`, the generator builds G-6 from `R3_LIVE_STATUSES`, `executePurge(` has one engine caller (`ResetService`, after the guard), the cleanup RPC has one caller (`TestAccountCleanupRepository`). Repo-wide scans read RAW source (the comment-stripper hazard that `no-deletion-paths.guard.test.ts` documents bit the first draft on the generator).
- **AC-F8.3 walk** `lib/business-os/entitlements/__tests__/acF83.foundingPartnerCancel.test.ts` (8 tests), all real functions: cancel recorded → `planManageOffer` "cancelling", "Ends on" the paid-through date, still the paid tier, no pill, no banner; through the paid-through date and the 24 h margin still the tier (FC-1); Stripe ends it, after the margin → Founding Partner basis with the pill, no "ended" banner, nothing to manage, while free access lives; when free access ends → grace, pill gone, "ended" banner. AC-F8.2 contrast (no cohort: grace then paused) and a cohort ending inside the paid period. Cohort and tier found by structure.
- **BQ-5 Founding Partner sentence** (SA deviation-5 carry-forward; binding before the production price switch): `plan.manage.cancel_confirm_founding` "Then you go back to your Founding Partner free access, which runs until {freeUntil}." is shown in the cancel confirmation (after "You keep …") and beside Reactivate while the plan is set to end. It is shown only when `purchase.manage.freeAccessAfter` is sent, which is only:
  - beside Cancel or Reactivate (the port is not even called otherwise);
  - when `freeAccessAfterPaidTier` (new, pure, `lib/business-os/entitlements/freeAccess.ts`) answers: the account has a DATED tier and an admin-dated cohort (no duration), and `deriveLifecycle` at paid-through + the renewal settlement margin (`tierSettlementEndsAt`) puts it on that cohort, live, with an end date strictly later. The sentence is the lifecycle's own answer, never a second rule.
  - **The read (smallest change):** `EntitlementService.getFreeAccessAfterPaidTier(accountId)` reads the same inputs `getSnapshot` reads, through the same 30 s cache. The my-plan route calls `getSnapshot` first, so this is a cache hit with no second DB read; on a miss it reads and caches like `getSnapshot`. A failed read is `null`. The route passes it to `readPlanPurchaseView` as a plain function port (`freeAccessAfterPaidTier`), session account only; a throwing port is a `warn`, never a failed view.

### Deviations for SA

1. **Admin client mirror touched** (`app/admin/users/types.ts`, `deletionCopy.ts`): not in §5, but required by the both-ways type pin of `AdminDeletionCommitCode` ↔ `DeletionCommitCodeView`. Two sentences, operator English.
2. **The BQ-5 sentence is also shown in the cancelling state**, not only in the confirmation (§2.1 said confirmation; the brief said "on the plan screen after cancelling"). Same key, same rule; it stays visible until the end date, so an owner who cancelled yesterday still sees it. The key keeps §11's name `plan.manage.cancel_confirm_founding`.
3. **The BQ-5 read lives in the entitlements module** (a new `EntitlementService` method and a pure helper beside `freeAccessEndedByPurchase`), not in the billing view. The lifecycle owns "which plan decides access when the tier lapses", the service is the only reader of the plan row, and the cache makes the read free after the snapshot. **Entitlements registrations: none needed.** No file outside the module gained an import from it: `planPurchaseView.ts` takes a function port typed locally, the my-plan route's imported symbols are unchanged, and tests are exempt. `npm run test:bos-entitlements` was run (below).
4. **Open-ended free access gets no sentence** (there is no date to name). A paying account with open-ended free access cannot arise through the checkout (BQ-P10 refuses it). An admin could create one by hand; that owner then reads only "It will not renew".
5. **"Founding Partner" is written in the copy** (en, he, es), as §11 drafted, while the rule is structural (admin-dated cohort). Today the only admin-dated cohort is the Founding Partner one, whose config label is "Founding Partner" in all three languages. If a second admin-dated cohort is ever added, the sentence should take the cohort's label from the server (a slot). Flagged, not built.
6. **Existing tests edited** (assertions follow the new copy, none loosened): `adminDeletionRefusals.test.ts` (the R-3 clearing now expects "Settings → Plan" and no "arrives with"), `deleteBusinessDialog.render.test.tsx` (its R-3 fixture text), `DangerZonePanel.selfDelete.test.tsx` and `DeleteAccountDrawer.render.test.tsx` (`plan_running` no longer carries the mailto; a `contact_support` blocker now carries it, and the new text is asserted), `PlanManage.p7a1.qa.render.test.tsx` (`plan.manage.*` key count 23 → 24). `ResetService.order.test.ts` and `ResetService.adminSurface.test.ts` have additions only (0 `-` lines): the billing repository is faked and recorded in the same call log.
7. **Guard registrations:** the billing-repository caller guard (`BusinessOsBillingAccountRepository.test.ts`) lists the three test files that fake the repository by name (`ResetService.order`, `ResetService.adminSurface`, `planSubscriptionLive.paths`). No product file gained a repository import (`ResetGuard` reaches it through `adminDeletionFacts.ts`, already listed).
8. **The Spanish draft says "Configuración → Plan"**, not §11's "Ajustes → Plan", matching the shipped `stripe_connected` blocker ("Configuración → Pagos").

### Wording (P-7a.3; he / es approved by the user 2026-10-27, G-5)

**G-5 approved by the user 2026-10-27** as drafted; "Founding Partner" stays in English in he / es (the config label, as the pill shows it). The he / es comments in the dictionaries say "approved by the user 2026-10-27 (G-5)".

| Key | en | he | es |
|---|---|---|---|
| `settings.account_delete.blocker.plan_running` (changed) | Your plan is still running. Cancel it in Settings → Plan. You can delete your account once it has ended. | התוכנית שלכם עדיין פעילה. מבטלים אותה בהגדרות ← תוכנית, ואפשר למחוק את החשבון אחרי שהיא מסתיימת. | Tu plan sigue activo. Cancélalo en Configuración → Plan. Podrás eliminar tu cuenta cuando haya terminado. |
| `plan.manage.cancel_confirm_founding` (new, BQ-5) | Then you go back to your Founding Partner free access, which runs until {freeUntil}. | לאחר מכן חוזרים לגישה החינמית של Founding Partner, שבתוקף עד {freeUntil}. | Después vuelves a tu acceso gratuito de Founding Partner, que dura hasta el {freeUntil}. |

Operator English (not translated): the Reset `subscription_live` / `subscription_unreadable` messages, `R3_CLEARING`, the admin commit copy for the two codes.

### Demo checklist (P-7a.3; standard sandbox `acct_1UPKR4C7KDUGYIcA`, test mode, local `npm run dev` on this branch)

Prerequisites as §10 "Before the demo" items 1, 3, 4 and 5 (price and checkout switches on locally, `stripe listen … --all-snapshot`, the webhook route warmed, a designated **test** owner on a fresh test clock from `/test-business-os`). Danger Zone Reset needs the internal purge surface for that account. Never commit a deletion on the demo account.

| # | Do | Expect |
|---|---|---|
| 1 | Buy Essentials (`4242…`) | "Renews on {date}"; Cancel, Update card and Invoices shown |
| 2 | Danger Zone → Reset (and Purge) → confirm | Refused: "This business has a live plan subscription. Cancel it in Settings → Plan, and reset once it has ended." No snapshot written; audit `BUSINESS_DATA_PURGE_BLOCKED` with reason `subscription_live` |
| 3 | Settings → Delete my account | Blocker: "Your plan is still running. Cancel it in Settings → Plan. You can delete your account once it has ended." (no mailto on that line) |
| 4 | `/admin/users` → this account → Delete (preview only) | R-3 applies; the clearing text names Settings → Plan and the Stripe dashboard |
| 5 | Cancel → confirm | "Ends on {date}"; steps 2–4 **still refuse** (a cancelling subscription is live until Stripe ends it, BQ-2) |
| 6 | Advance the test clock past the period end + 25 h | Webhook: subscription ended; Settings: ended; admin: Ended, In grace |
| 7 | Advance 5 more days | Paused (recorded) |
| 8 | Repeat steps 2–4 (up to the confirmation only) | None of the three refuses for the plan subscription any more (other refusals, such as a Connect account, may still apply). **Do not commit** |
| 9 | Founding Partner variant: a test account with an admin-set Founding Partner end date well after the coming paid-through date; buy; Cancel | The confirmation adds "Then you go back to your Founding Partner free access, which runs until {date}."; after confirming, the same line shows under Reactivate |
| 10 | The same, with the Founding Partner end date before the paid-through date (or within 24 h after it) | No Founding Partner sentence |
| 11 | Step 9 account: advance the clock past the period end + 25 h | Back on Founding Partner: the pill in the header, no "Your subscription ended" banner; admin plan column Free access = Founding Partner (AC-F8.3) |
| 12 | Step 11 account: advance past the Founding Partner end date | Grace (the cohort's grace), pill gone, "ended" banner |

**After the demo, the same day:** cancel every demo subscription, delete test customers and clocks, switches off and sandbox keys out of `.env.local`; `cus_VQf9jX6fnfVlkK` untouched.

### Test and gate results (2026-10-27)

| Gate | Result |
|---|---|
| New / extended suites | `planSubscriptionLive.paths` 119 (new), `acF83.foundingPartnerCancel` 8 (new), `ResetService.order` +9, `ResetService.adminSurface` +2, `planPurchaseView` +10, `freeAccess` +10, `entitlementService` +4, `PlanManage.render` +5, my-plan route +2 |
| Requested set: `app/api/stripe`, `lib/business-os/purge`, `lib/business-os/billing`, `app/api/business-os/billing`, `components/business-os/settings`, `components/business-os/billing`, `components/business-os/purge`, `components/business-os/account-deletion`, `lib/business-os/account-deletion`, `app/api/business-os/entitlements`, `app/api/business-os/account`, `app/api/business-os/purge`, `app/admin`, `lib/admin`, `lib/audit`, `lib/business-os/entitlements`, the billing repository suite, `testAccountCleanupSql` | 459 suites, 15 445 tests. First run (in parallel with `tsc` and `test:bos-entitlements`): 10 suites failed on load timeouts (130–170 s per suite). **Re-run alone: all pass except `lib/admin/environment/__tests__/catalogueDrift.guard.test.ts` G3-1f**, which flags `lib/business-os/billing/portalConfiguration.ts` (P-7a.2's whole-`process.env` read). Fixed on `feature/bos-plan-payments-p7a2` as `663aa9b9`; it arrives when RM merges `main`. Not this slice: this slice adds no env read |
| `npm run test:bos-entitlements` | 314 suites, 9 423 tests: 9 421 passed. The 2 failures were `app/admin/users/__tests__/creditsBlock.render.test.tsx` under the same contention (133 s); it **passes alone** |
| Connect harness `connectPath.characterisation.test.ts.snap` | md5 `ab7528ea68309cffb309ffbd46c455ab` before and after; file unmodified; never `-u` |
| Typecheck (`tsc --noEmit`, 8 GB heap) | Completed, no OOM; **0 errors in the 30 touched / new `.ts(x)` files** (1 861 pre-existing elsewhere). Two earlier runs caught 4 errors in the new test files (literal widening, a cohort union), fixed |
| ESLint on the touched / new `.ts(x)` files | 0 findings |
| `npm run build` | Not run (as in P-7a.2: no `.env.local` in this worktree); compile-affecting changes are covered by the typecheck |

---

## Workplan: FU-P7a4-1 (alert on a plan invoice paid after its subscription ended)

**Status:** Code complete, uncommitted (2026-10-27); SA workplan review APPROVED WITH CHANGES (R-1 to R-6, applied). Awaiting SA code review. **Branch:** `feature/bos-plan-payments-fu-p7a4-1` (worktree `neuronforge-fu1`, stacked on P-7a.4 = PR #540; `git branch --show-current` checked). No migration, no wording, no UI.

**Scope (SA, deviation 1 ruling + D3.1 review):** alert-only. On `invoice.paid` for a subscription that ended before the invoice's period end, APPLY exactly as today and log `error` + `alert: true`, event `bos_billing_paid_after_end`, so an operator decides honour vs refund. No refusal, no reinstatement, no undo, no audit row, no new DB read.

### Trigger

All of these, computed by one pure exported helper `paidAfterEnd(facts, subscription)` in `planPaymentApply.ts` (returns `null` or the alert facts; never throws: an unparseable time gives `null`):

1. `subscription.endedAt !== null`: the subscription ended (Stripe's `ended_at`).
2. `facts.periodEnd > endedAt`: it ended before the period the invoice pays for was over. A period-end cancel's last invoice has `periodEnd <= ended_at`, so it never fires (SA ruling 1 c).
3. `facts.paidAt > endedAt`: the money came after the end. Without this, a late or replayed delivery of an invoice paid while the subscription was live would alert falsely (the event's name says "paid after end").
4. The apply returned `applied` or `recorded` (a new money row). `already_applied` / `already_recorded` replays, refusals, `subscription_conflict` and the retry throws never alert, so one paid invoice alerts once.

**Which fact says "ended": Stripe's, from the read the apply already makes** (step 9, `retrieveBusinessOsSubscription(facts.subscriptionId)`), not our billing row. No extra call. Our row is not reliable here: Stripe does not order `customer.subscription.deleted` before `invoice.paid`, and a Stripe dunning end (one of the two cases SA named) reaches our row only through that `.deleted` delivery. Our row's `ended_at` is logged beside it (`recordEndedAt`, only when the row holds the same subscription id) as context; it decides nothing. See Q-1.

### Where it sits

- `applyPaidPlanInvoice`: after the existing fresh read and the U-4 guard, `const lateEnd = paidAfterEnd(facts, subscription)`. Nothing passed to `applyPlanPayment` changes.
- `afterApply`, `applied` / `recorded` case: immediately after the existing `bos_billing_invoice_applied` line (so the alert is written at the commit, before the post-commit chain, as SA F-1 placed that line), `if (extra.paidAfterEnd) log.error(...)`. `extra` gains one optional field. Nothing else in `afterApply` reads it.
- `planBillingHandler.ts`: no change (the deps are unchanged).

### Log line (ids only, no owner text, no PII, no metadata values)

```typescript
log.error(
  {
    event: 'bos_billing_paid_after_end', alert: true,
    accountId, billingRowId: account.id, invoiceId, subscriptionId, livemode, stripeEventId,
    status: result.status, planWritten: result.planWritten, tier: facts.tier, billingReason: facts.billingReason,
    amountMinor: facts.amountMinor, currency: 'usd',
    periodEnd: facts.periodEnd, paidAt: facts.paidAt, subscriptionEndedAt /* ISO */, subscriptionStatus,
    recordEndedAt /* our row, same sub only, else null */, cancellationReason /* Q-2 */,
  },
  'Business OS plan invoice paid after its subscription ended; applied as usual, operator to decide honour or refund'
);
```

No customer id (the existing `ids` omit it; kept so). No email, no name, no `bos_user_id` value.

### Files

| File | Action | Reason |
|---|---|---|
| `lib/business-os/billing/planPaymentApply.ts` | modify | `paidAfterEnd` helper; one `extra` field; the log line; header comment step 10a |
| `lib/stripe/StripeService.ts` | modify, only if Q-2 = yes | `retrieveBusinessOsSubscription` gains optional `cancellationReason?: string \| null` from the SAME retrieve (`cancellation_details.reason`, filtered to the mirror's three known values, else null). Optional so existing fakes stay valid |
| `lib/business-os/billing/__tests__/planPaymentApply.paidAfterEnd.test.ts` | create | Below |
| the existing `retrieveBusinessOsSubscription` suite under `lib/stripe/` | modify, only if Q-2 = yes | The reason is read and filtered |
| this workplan, the requirement | modify | Status |

### Tests (`planPaymentApply.paidAfterEnd.test.ts`, the fakes of `planPaymentApply.test.ts`)

1. **Fires:** Stripe `canceled`, `endedAt` after the period start, `paidAt` after `endedAt` (the X-4d shape): exactly one `bos_billing_paid_after_end` line at `error` with `alert: true`, the fields above, and the apply still `applied` with the tier written (as today, SA ruling 1 b).
2. **Fires for a Stripe dunning end** (`cancellationReason: 'payment_failed'`, invoice paid later): one line (SA ruling 1 c: the operator decides).
3. **Does not fire for a live subscription** (`active`, `endedAt` null), nor for `past_due`.
4. **Does not fire for a period-end cancel's last invoice** (`periodEnd === endedAt`), nor for an invoice paid before the end and delivered late (`paidAt < endedAt`).
5. **Does not fire on a replay** (`already_applied`), a refusal, or `subscription_conflict`.
6. **Our row says ended, Stripe says live: no alert; our row says live, Stripe says ended: alert** (Stripe's fresh read decides, Q-1).
7. **Apply outcome byte-identical:** the same event run with the subscription ended and with it live (same status passed through): the `applyPlanPayment` argument, the `recordPlanChange` calls, the `recordEvent` calls, the cure call and the return value are deep-equal; only the log differs.
8. **Never throws:** `endedAt` / `paidAt` / `periodEnd` unparseable or `NaN`: resolves, no alert, apply unchanged.
9. **No PII:** the line's keys are exactly the allow-list above (pinned with `Object.keys(...).sort()`), and no value equals the fixture's email or metadata.
10. Unit tests for `paidAfterEnd` itself: each of conditions 1 to 3 flipped alone returns `null`.

Gates: `lib/business-os/billing` and `app/api/stripe` folders, `lib/stripe` (if Q-2), `npm run test:bos-entitlements` (the file imports from entitlements), the Connect characterisation snapshot md5 unchanged, typecheck 0 errors on the touched files, ESLint on them.

### Task list

- ✅ 1. SA workplan review; apply rulings on Q-1 to Q-3.
- ✅ 2. `paidAfterEnd` helper + its unit tests.
- ✅ 3. Wire into `applyPaidPlanInvoice` / `afterApply`; integration tests 1 to 9.
- ✅ 4. (Q-2 = yes) `cancellationReason` on the subscription read + its test.
- ✅ 5. Gates above; status in this workplan and the requirement.

### Open questions for SA

- **Q-1 (the deciding fact).** The brief said "decide from our own billing row". This plan decides from Stripe's fresh read that `applyPaidPlanInvoice` already makes (no new call, no new DB read), because our row lags the `.deleted` webhook and a Stripe dunning end only reaches it that way; SA's ruling 1 also says "Stripe reports ended". Our row is logged, not used. Confirm, or rule "row OR Stripe".
- **Q-2 (`cancellation_details.reason`).** SA's ruling 1 lists it in the line. The current `retrieveBusinessOsSubscription` result does not carry it. Adding it is one optional field on the same retrieve (no new call), so the line tells `cancellation_requested` (ours, P-7a.4's residual windows) from `payment_failed` (Stripe's dunning end). Yes (recommended) or log without it?
- **Q-3 (condition 3, `paidAt > endedAt`).** Not in SA's ruling text; added to keep a late delivery of a pre-end payment from alerting. Confirm.

### SA review: FU-P7a4-1 workplan

**Reviewed by SA, 2026-10-27. Status: APPROVED WITH CHANGES.** Checked against `planPaymentApply.ts` (`applyPaidPlanInvoice`, `afterApply`), `StripeService.retrieveBusinessOsSubscription` and the apply function in `20261028_business_os_first_payment_stamp.sql`.

**D3.1 trace.** SX-2b moves the account to free on `.deleted` but leaves our billing row on the same subscription id, so a later `invoice.paid` for that sub (an `uncollectible` invoice paid afterwards) takes `v_subscription = p_stripe_subscription_id`, no conflict, and returns `applied` (its period end is past `current_period_end`, so the paid tier is written over the free cohort) or `recorded`. Conditions 1 to 3 hold, so the alert fires in exactly the case it exists for. The gap is an owner who re-subscribed before paying the old invoice: the row holds the new live sub, the function returns `subscription_conflict`, and the plan never emits `bos_billing_paid_after_end`.

| # | Ruling |
|---|---|
| R-1 | **Q-1: Stripe's fresh read alone decides.** Not "row OR Stripe": our row lags `.deleted`, and a row-only end against a live Stripe sub is no late payment. Our row stays as context (`recordEndedAt`). |
| R-2 | **Q-2: yes.** Optional `cancellationReason` from the SAME retrieve, `cancellation_details?.reason` filtered to the three known values, else null. No new call. Add its unit test. |
| R-3 | **Q-3: confirmed.** `paidAt > endedAt` stays. |
| R-4 | **Binding change:** also emit the line on `subscription_conflict` when `eventRowId !== null` (a NEW refusal row, so it fires once), with `status: 'subscription_conflict'` and `planWritten: false`. Add a test for it. Replays and `already_*` stay silent. |
| R-5 | Add `tierBefore` / `tierAfter` (from `result`, `applied` / `recorded` only, else null) to the allow-list: the operator needs to see the free cohort being overwritten. |
| R-6 | Apply-path safety: the helper is pure, uses no `await`, and never throws. Nothing it returns reaches `applyPlanPayment` or the `upgradeGuard` / held-subscription logic. Test 7 (byte-identical outcome) is binding. |

### Implementation notes (FU-P7a4-1, 2026-10-27)

**Code complete, uncommitted**, on `feature/bos-plan-payments-fu-p7a4-1`. No migration, no wording, no UI, no new Stripe call, no new DB read. SA R-1 to R-6 applied.

- **`planPaymentApply.ts`**: the pure `paidAfterEnd(facts, subscription)` (no `await`, whole body in `try`, anything unreadable answers `null`) decides on Stripe's step-9 read alone (R-1): `endedAt` a positive finite unix time, `periodEnd > endedAt`, `paidAt > endedAt` (R-3). It is called **after** `applyPlanPayment` returned (R-6), so nothing it answers can reach the apply, the U-4 guard or the held-subscription logic. Its answer, plus `billingRowId` and our row's `ended_at` (only when the row holds this invoice's subscription; context only), rides on `afterApply`'s `extra.paidAfterEnd`. One `logPaidAfterEnd` writes the line at `error` + `alert: true`: in `applied` / `recorded` immediately after `bos_billing_invoice_applied` (before the post-commit chain), with `tierBefore` / `tierAfter` from the result (R-5); in `subscription_conflict` only when `eventRowId !== null`, with `planWritten: false` and both tiers null (R-4). Replays, `already_*` and refusals stay silent. Header step 10a added.
- **`StripeService.ts`** (R-2): `retrieveBusinessOsSubscription` gains optional `cancellationReason` from the SAME retrieve, `cancellation_details?.reason` kept to the exported `BUSINESS_OS_CANCELLATION_REASONS` (`payment_failed`, `cancellation_requested`, `payment_disputed`, the mirror's three), else null. The comment and feedback text are never read.
- **Log keys (pinned):** `event`, `alert`, `accountId`, `billingRowId`, `invoiceId`, `subscriptionId`, `livemode`, `stripeEventId`, `eventRowId`, `status`, `planWritten`, `tierBefore`, `tierAfter`, `tier`, `billingReason`, `amountMinor`, `currency`, `periodEnd`, `paidAt`, `subscriptionEndedAt`, `subscriptionStatus`, `cancellationReason`, `recordEndedAt`. No customer id, email, name or metadata value.

**Deviations for SA**
1. `eventRowId` is in the line (not in the workplan's list): it names the money row (new `invoice_paid` or refusal) the operator acts on. An id, no PII.
2. The tests sit in a new `describe` pair at the end of `planPaymentApply.test.ts`, not in a new file: they need that file's fake of the apply function (about 300 lines), which is not exported.
3. The mirror keeps its own copy of the three reasons (`planSubscriptionMirror.ts` untouched, to keep this slice to the apply path); the lists are identical.

**Tests:** `planPaymentApply.test.ts` 67 → 84 (+17): helper 5 (fires; each condition flipped; absent reason; 11 unreadable inputs incl. a throwing getter and a time `toISOString` cannot hold, no throw; pure, frozen inputs); webhook 12: 9 (X-4d shape fires once at `error`, keys pinned, placed right after the applied line; no PII with the fixture's email and metadata text; Stripe dunning end with our row's end as context; live `active` / `past_due` silent; period-end last invoice and late pre-end payment silent; row ended + Stripe live silent (R-1); replay and refusal silent; R-4 conflict fires once and its replay is silent; R-4 conflict with `eventRowId` null silent) and R-6 test 7 twice (applied and conflict paths: the apply argument, `recordEvent`, audits, order, cure calls, money rows, billing row, plan row, return value and every other log line deep-equal with and without Stripe's end), plus unreadable Stripe times never throw. `businessOsPlanWebhookReads.test.ts` 16 → 17 (R-2: the three reasons pass, five other shapes are null, the comment never leaves the read, one retrieve each).

**Gates (run one after another, 2026-10-27)**

| Gate | Result |
|---|---|
| `lib/business-os/billing` | 49 / 3 795 passed |
| `app/api/stripe` | 22 / 581 passed |
| `lib/stripe` | 10 / 104 passed |
| `lib/admin/environment` | 4 / 122 passed |
| `lib/server` | 11 / 148 passed |
| `npm run test:bos-entitlements` | 319 suites / 9 559 tests passed |
| Connect `connectPath.characterisation.test.ts.snap` md5 | `ab7528ea68309cffb309ffbd46c455ab`, unchanged (never `-u`) |
| Typecheck (`tsc --noEmit`, 8 GB heap) | Completed, no OOM; **0 errors in the touched files** (1 849 pre-existing elsewhere, the same count as on P-7a.4) |
| ESLint on the 4 touched files | 0 errors, 0 warnings |
| `npm run build` | Not run (no `.env.local` in this worktree, as P-7a.1 to P-7a.4) |

### SA code review: FU-P7a4-1

**Code Review by SA — 2026-10-27**
**Status:** ✅ Code Approved

| Check | Result |
|---|---|
| R-1 to R-6 | ✅ Stripe's step-9 read alone decides; `cancellationReason` from the same retrieve, three values else null; `paidAt > endedAt`; conflict line only when `eventRowId !== null`; tiers from `result`; helper pure, in `try`, called after the apply; test 7 present on both paths |
| Pino | ✅ context first, `error` + `alert: true`; no `console.*` in the diff |
| PII | ✅ ids, amounts, dates, enums only; Stripe's free-text comment / feedback never read |
| Supabase | ✅ no new DB call, no new Stripe call |
| TypeScript | ✅ no `any`; `eventRowId` narrowed to `string` before the conflict call |
| `StripeService` field | ✅ optional and additive; other callers (`planInvoiceResolver`, `planSubscriptionManage`) unaffected |
| Untouched files | ✅ `planBillingHandler.ts` and `planSubscriptionMirror.ts` have no diff |
| Jest (SA rerun) | ✅ the two suites, 101 / 101 |

**Deviations**
1. **Accepted.** `eventRowId` is the id an operator needs; no PII.
2. **Accepted.** Reusing the unexported fake beats duplicating ~300 lines.
3. **Accepted, no pin test now.** D3.1 touches the mirror next and is **bound** to delete its local `CANCELLATION_REASONS` and import `BUSINESS_OS_CANCELLATION_REASONS` from `StripeService.ts`. One list then exists, so no pin test is needed.

### Code Approved for QA: Yes

### QA report: FU-P7a4-1

**QA — 2026-10-27**
**Test mode:** full · **Strategy used:** A (Jest, in-memory; the alert is log-only, no DB or Stripe call) · **Focus:** api, security (PII) · **Skipped:** live Stripe / DB (forbidden by brief; not needed) · **Input source:** TL brief

New QA file: `lib/business-os/billing/__tests__/planPaymentApply.paidAfterEnd.qa.test.ts` (45 tests, harness copied from `planPaymentApply.test.ts`).

#### Test Coverage

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Strict `>`: `endedAt == paidAt`, `endedAt == periodEnd` | ✅ | Pass | Both null; 1 s before fires; 1 ms after fires, same ms does not |
| Seconds vs milliseconds | ✅ | Pass | Seconds echoed as the right ISO; a ms value reads as far future, never fires, never throws |
| `paidAt` null / '' / malformed / number | ✅ | Pass | null, no throw |
| `endedAt` 0, negative, NaN, -Infinity, string, boolean, object | ✅ | Pass | null |
| Malformed `periodEnd`, null facts object | ✅ | Pass | null, no throw |
| `cancellationReason` three values pass; undefined / null → null | ✅ | Pass | |
| `cancellationReason` outside the three ('other', '', new) → null | ⚠️ | Pass at the read | `cancellationReasonOf` filters (Dev test covers `something_new`, 42, null); `paidAfterEnd` itself does not (E-1) |
| Fires on `applied` and `recorded` (planWritten false) | ✅ | Pass | once, `error`, `alert: true` |
| `subscription_conflict`: fires with a row, silent with `eventRowId` null | ✅ | Pass | |
| Silent on `already_applied`, `already_recorded`, `customer_mismatch`, `plan_row_missing`, `billing_row_missing` | ✅ | Pass | |
| `endedAt` == paid_at / 0 / negative through the webhook | ✅ | Pass | applied as usual, no alert |
| PII | ✅ | Pass | no email, name, `@`, customer id, metadata or owner text in the line; no such keys |

#### Issues Found

**Bugs:** none.

**Edge cases (nice to fix):**
1. **E-1: `paidAfterEnd` passes `cancellationReason` through unchecked** — File: `lib/business-os/billing/planPaymentApply.ts` (`cancellationReason: subscription.cancellationReason ?? null`) — Severity: Low. Repro: `paidAfterEnd(facts, { endedAt: <before paid>, status: 'canceled', cancellationReason: 'other' })` returns `'other'` (likewise `''`). Not reachable today: the only producer, `retrieveBusinessOsSubscription`, maps anything outside the three to null, and the type forbids it. Optional hardening: filter against `BUSINESS_OS_CANCELLATION_REASONS` in the helper too.

#### Test Outputs / Counts (run sequentially)

| Suite | Result |
|---|---|
| QA file | 45 / 45 |
| `lib/business-os/billing` | 50 suites, 3 840 / 3 840 (incl. the QA file) |
| `lib/stripe` | 10 suites, 104 / 104 |
| `app/api/stripe` | 22 suites, 581 / 581 |
| `lib/admin/environment` (CI guards) | 4 suites, 122 / 122 |
| `lib/server` (CI guards) | 11 suites, 148 / 148 |
| Connect harness `connectPath.characterisation.test.ts.snap` | md5 `ab7528ea68309cffb309ffbd46c455ab`, unchanged; never `-u` |
| `tsc --noEmit` filtered to touched files + QA file | 0 errors (repo pre-existing errors only; no OOM) |

#### Final Status

- [x] All acceptance criteria pass — ready for commit (E-1 is Low and optional)
- [ ] Issues found — Dev must address before commit

---

## SA Review Notes

### SA Workplan Review — P-7a (2026-10-25)

**Reviewed by SA — 2026-10-25**
**Status:** ✅ APPROVED WITH CONDITIONS (C-1 to C-12). P-7a.1 may start once C-1 to C-5 are folded into §4.1 / §4.2; C-6 to C-12 bind the slice named in each.

#### Claims verified on `origin/main` `10761291` (read by SA, not taken from the workplan)

| Claim | Verdict | Evidence |
|---|---|---|
| Admin delete refuses a live plan subscription (R-3, both modes, unreadable = refuse) | ✅ | `adminDeletionRefusals.ts` `R3_LIVE_STATUSES`, `isPlanSubscriptionLive`, `evaluateR3`; `adminDeletionFacts.ts` `readPlanBilling` / `hasLivePlanSubscription` |
| Self-delete and operator cleanup refuse (G-6) | ✅ | `20261092` G-6, status list `active, trialing, past_due, unpaid, paused` OR subscription id with no `ended_at`, identical to the TS predicate; blocker `plan_running` mapped in `blockerCopy.ts` |
| Only Danger Zone Reset / Purge is missing | ✅ | `ResetGuard.ts` has controls 1 and 2 only; it is reached from `ResetService.runPurgeCommit` step 4 (before the snapshot), on both the internal and the admin surface |
| P-8a admin already shows Cancelling / Active / Ended / In grace / Paused | ✅ | `lib/admin/billing/subscriptionsView.ts` lines 87–104 (`cancelling: !ended && row.cancel_at_period_end`, `active` excludes cancelling and failed) |
| AC-F8.3 needs no behaviour change | ✅ | Consistent with SA's F-3 confirmation (2026-10-13) and P-6a.1 FC-1; a pinned lifecycle walk is the right deliverable |
| No migration | ✅ | 20261025: every column used, incl. `failed_attempts`, exists; `service_role` holds UPDATE on `subscription_status`, `cancel_at_period_end`, `ended_at`, `updated_at`; `mirrorSubscriptionState` already writes them by CAS with `{ count: 'exact' }`, no `.select()`, no `.or()`. The G-6 rule is unchanged, so its SQL is unchanged |
| `retrieveBusinessOsSubscription` returns customer, `livemode`, metadata, items with period, `pendingUpdate` | ✅ | `StripeService.ts` 566–633: everything step 7–9 needs, no new read |
| `isHostedInvoiceUrl` exists | ✅ | `BusinessOsBillingAccountRepository.ts` 177 |
| "The commit **and preview** routes already return a refused outcome with its control" (§4.6) | ❌ **Inaccurate** | `ResetGuard` runs only inside `runPurgeCommit`; `app/api/business-os/purge/preview` never calls it. And the Danger Zone renders the **server's `message`**; there is no client-side control-to-text map. See C-9 |

#### Conditions

1. **C-1 (P-7a.1, TQ-1) — one switch, in the predicate as well as the routes.** All four routes gate on `isPlanPriceRecognitionEnabled()` (404, nothing read), and `planManageOffer` takes that switch as an input (as `planPurchaseOffer` takes `HeldPaymentSwitches`), so with the switch off `manage` is all-false and the screen never offers a button the route would 404. Add the §9.5 row-15 sibling note: "the P-7a routes follow the price-recognition switch, not the checkout switch".
2. **C-2 (P-7a.1, TQ-2) — mirror from the write's own answer, and heal on `unchanged`.** `setBusinessOsCancelAtPeriodEnd` returns the same facts shape the mirror needs (status, `cancelAtPeriodEnd`, `endedAt`, item period end, customer, `livemode`) from the update response: no second retrieve. On step 8's `unchanged`, if **our row** disagrees with the fresh Stripe state, call `mirrorSubscriptionState` with the fresh state (no audit). Reason: the route's mirror is last-write-wins on the subscription id; a delayed route mirror landing after the webhook's fresh write can leave a stale flag until the next event, and the owner's next press must then repair it, not just answer "unchanged".
3. **C-3 (P-7a.1, X-2 extended) — `cancel_at` as well as `cancel_at_period_end`.** X-2 also records what a **dashboard** "cancel at end of period" writes on `2025-10-29.clover` (`cancel_at_period_end` or `cancel_at`). Step 8 treats a fresh `cancel_at` set as "cancelling"; Reactivate clears whichever Stripe reports set. If the dashboard writes only `cancel_at`, the mirror (which reads only the flag) under-reports cancellations made outside the app: record that as a follow-up for the webhook, **not** fixed in P-7a (webhook untouched, Connect harness unchanged). Return to SA if X-2 shows the in-app flag write itself is not reflected in `cancel_at_period_end`.
4. **C-4 (P-7a.1, TQ-4) — cross-check list made explicit.** Before the write: `fresh.id === row.stripeSubscriptionId`, `fresh.customerId === row.stripeCustomerId`, `fresh.livemode === row.livemode === isLiveMode(currentStripeMode())`, and `metadata.bos_user_id`, when present, equals the session account. Any disagreement: 409 `billing_record_mismatch`, `error` log + alert, nothing written, nothing audited. The call-order spy test covers every our-data refusal (steps 1–6) with zero Stripe calls.
5. **C-5 (P-7a.1) — empty body.** `z.object({}).strict()` is right, but `request.json()` on an empty body throws: the client always sends `{}`, and the route's 400 for unparsable JSON stays (as the upgrade route). Pin both in the route test (an injected `userId` → 400; `{}` → proceeds).
6. **C-6 (P-7a.2, TQ-7 / TQ-8) — portal session hardening.** `returnUrl` is built from the server-side platform origin, never from the request's `Host` / `Origin`. `update_card` sets `flow_data.after_completion = { type: 'redirect', redirect: { return_url } }` so the owner comes back without hunting for the link. The once-per-instance configuration check caches **success only**; a failed retrieve refuses (503 `portal_unavailable`) and is retried on the next request. Portal and invoice responses carry `Cache-Control: no-store` (both contain bearer links), and the invoice list body, like the portal URL, is never logged.
7. **C-7 (P-7a.2, X-1) — if the portal does not move the subscription's card, stop and return to SA.** Do not improvise a webhook handler for `payment_method.*` / `customer.updated` inside P-7a: that touches the webhook and the Connect harness. The options (Checkout stops pinning `subscription.default_payment_method`, or a webhook-side update) are a re-plan.
8. **C-8 (P-7a.2) — script reuses the guards, nothing new.** `setup-bos-portal-configuration.ts` uses `scripts/lib/stripe-script-guards.ts` for `--env` outside every checkout, key-prefix-by-mode and `--expect-account` (compared with `accounts.retrieve()`), on the `setup-bos-plan-prices.ts` model. Compare-and-stop on drift is the right shape for go-live row 13 (approved). The `bpc_…` id is printed; the key never is.
9. **C-9 (P-7a.3, TQ-10 / TQ-11) — correct §4.6 and wire control 3 through the types.** Add `subscription_live` and `subscription_unreadable` to `ResetGuardResult['control']` **and** `ResetRefusal` in `ResetService.ts`. The owner-readable text is `ResetGuard`'s own `message` (the panel prints the server message; drop the "panel maps" step and the preview claim). Refusal stays commit-time, before the snapshot, like controls 1 and 2: no preview change. `ResetService.order.test.ts` mocks `businessPurgeRepository` only, so it must mock the billing reads and pin control 3 before `resolveConnectAccounts`. The admin surface also passes through control 3; that agrees with R-3 and is expected, and the admin delete tests must still pass unchanged. Record in the requirement (PF-14) that "409 `subscription_live`" is met as the purge contract's refused outcome with control `subscription_live`, and as R-3 / G-6 on the deletion paths.
10. **C-10 (P-7a.3) — operator SQL text stays.** G-6's `clears` text in the generated cleanup function still says "Cancel the subscription in the Stripe dashboard …". It is operator-facing and changing it would be a migration: leave it, and say so in Implementation Notes. Only the i18n `plan_running` blocker, the `DangerZonePanel.tsx` English fallback and `R3_CLEARING` change.
11. **C-11 (P-7a.4 only, if BQ-3 = A) — an open renewal invoice must not re-assert the tier after an immediate cancel.** Either void the subscription's open invoice(s) in the same orchestration (after `subscriptions.cancel`, each void its own CAS-safe Stripe call, `outcomeUnknown` on a lost answer), or prove by test that the apply path refuses an `invoice.paid` for a subscription our record shows ended. Without one of these, an owner who pays the old hosted invoice link (banner or invoice list) after cancelling would be put back on the paid tier with no subscription. The confirmation copy for this state says "ends now", not "until {date}". Same audit key with `details.mode = 'immediate'` (TQ-12, approved).
12. **C-12 (every slice) — test and merge hygiene.** Local runs: the touched suites **plus** `app/api/stripe`, `lib/business-os/purge`, `lib/business-os/billing`, `app/api/business-os/billing`, `components/business-os/settings`, and `npm run test:bos-entitlements`. Connect harness `connectPath.characterisation.test.ts`: snapshot md5 recorded before and after and identical; **never** bare `-u` / `--updateSnapshot`. Filtered typecheck checked for an OOM. Each PR branches from `origin/main` only after the previous one merged (.1 → .2; .3 may branch after .1 merges, in parallel with .2); never stacked, never retargeted. Splice each stage into the requirement's P-7a row and Change History.

#### TQ rulings

| # | Ruling |
|---|---|
| TQ-1 | **Approved:** `isPlanPriceRecognitionEnabled()`, which is also the only switch under which the webhook records the end (C-1). |
| TQ-2 | **Approved:** mirror at once with `mirrorSubscriptionState`, failure = `warn`; plus heal on `unchanged` (C-2). |
| TQ-3 | **Approved:** no idempotency key; a boolean set is idempotent and a key would replay stale on cancel → reactivate → cancel. |
| TQ-4 | **Approved:** order contract as §4.2, cross-checks as listed in C-4. |
| TQ-5 | **Approved:** refuse `upgrade_pending` **whatever X-3 shows** (a pending update expires within a day; refusing is simpler than reasoning about its interaction). |
| TQ-6 | **Approved:** live Stripe list for our row's customer in the current mode, only on open, 12, no auto-paging; never money history. |
| TQ-7 | **Approved:** script test-by-default, `--live` + `--expect-account`, compare-and-stop; runtime env id required, never the default configuration, success-only cache (C-6, C-8). |
| TQ-8 | **Approved:** `payment_method_update` flow with `after_completion` redirect (C-6); `locale` from a strict enum only if X-5 accepts it, else `auto`. |
| TQ-9 | **Approved:** audit owner cancel and reactivate only; portal opens and invoice reads are logged. **No** mirror-side audit in P-7a (it would edit the webhook); record "who cancelled from the dashboard" as an AM-7 follow-up. |
| TQ-10 | **Approved:** ride the purge contract's refused outcome; the requirement's 409 is not literal (C-9 records it). |
| TQ-11 | **Approved:** control 3 first, `hasLivePlanSubscription` (both modes, `null` = refuse), shared predicate and G-6 untouched (C-9). |
| TQ-12 | **Approved conditionally** (only if BQ-3 = A): `subscriptions.cancel` with `prorate: false`, `invoice_now: false`, same `CANCELLED` key with `details.mode = 'immediate'`, plus C-11. |
| TQ-13 | **Approved:** routes register as non-gate importers of `resolveAccountId`; orchestration imports nothing from the module; `PlanManage.tsx` (client) imports nothing from it; re-register `planPurchaseView.ts` only if BQ-5's sentence adds a new import. |
| TQ-14 | **Approved:** `trialing` behaves as `active`, pinned by a matrix row for P-11. |

#### Notes on BQ-1 to BQ-8 (for TL to put to the user; SA decides none of them)

| # | SA note |
|---|---|
| BQ-1 | **Effectively already decided.** The requirement's go-live floor says "a customer must be able to cancel in-app, since the portal's cancel is off" (§9 floor). Answering "no" would leave a payer unable to leave while sales are paused, which the floor does not allow. TL may present it as a confirmation, not an open choice. Either answer changes nothing in the build beyond which flag reader the routes call. |
| BQ-2 | **Already decided by PF-14** and §6 "Decided without asking" ("deleting or resetting a subscribed account first requires cancelling … no refund", Q-B7), as implemented by R-3 / G-6, where a cancelling subscription is still live until it ends. Changing it is a migration (new G-6). Do not ask; if the user raises it, it is a requirement change routed BA → SA. |
| BQ-3 | **Genuine business choice, between A and B only.** Option C (end at period end while Stripe keeps retrying) charges someone who asked to stop; SA would not approve it. If **A**: P-7a.4 is built, with C-11 binding and a different confirmation ("ends now"); it does not change P-7a.1 (which ships the B behaviour first either way), and it makes PF-14 clear sooner (the subscription ends at once). If **B**: P-7a.4 is dropped. |
| BQ-4 | **Already decided** (PF-14, C-11, §6 "Decided without asking"; the P-7a row says "Reset and deletion are refused while the subscription is live"). Not a question; drop it from the list. |
| BQ-5 | Genuine (wording). If yes: show the sentence only when the cohort end is after the paid-through date plus the 24 h margin, read from the plan row already loaded; otherwise omit it. No ruling changes. |
| BQ-6 | Genuine; "not in v1" changes nothing here. |
| BQ-7 | **Minor product detail, not worth the user's time** (requirement-decisions rule): SA/BA default 12 with "See all in Stripe". |
| BQ-8 | Genuine but **out of P-7a's scope** (account deletion owns it); default "keep" is consistent with the retained billing record. Park it with the accountant question BQ-P5; it blocks nothing here. |

#### Split and sizing

Right-sized: .1 ≈ 1.5d, .2 ≈ 1.5d, .3 ≈ 0.8d, .4 ≈ 0.5d, each a few days at most with its own demo and guardrails. The overrun against the row's 2–3d is justified (go-live row 13's script, an invoice list with no existing surface, the PF-14 cross-path pin). New infrastructure is limited to what SA-P10 and F9 require (portal configuration script and reader, invoice mapping); everything else reuses the P-7b.1 route pattern, the existing mirror method, the existing live predicate and `hasLivePlanSubscription`. No over-engineering found.

#### Optimisation suggestions (non-blocking)

- The cross-path pin reads "the newest cleanup migration": select it by the generator's filename pattern, so an unrelated later migration cannot become "newest".
- Two tabs pressing Cancel at the same instant can both pass step 8 and write two audit entries; harmless (the write is idempotent). Accept, or note it in the route header.
- Importing `hasLivePlanSubscription` pulls `adminDeletionFacts.ts` (and `AdminAccessService`) into `ResetGuard`; there is no import cycle (checked). If the import weight bothers QA, move `readPlanBilling` / `hasLivePlanSubscription` into a small module both import; not required.

#### Approval

[x] Workplan approved with conditions C-1 to C-12. Proceed with P-7a.1 once §4.1 / §4.2 reflect C-1 to C-5. BQ-3 (A or B) and BQ-5 are the only answers the build needs from the user; BQ-3 only blocks P-7a.4.

### SA Code Review — P-7a.1 (2026-10-26)

**Code Review by SA — 2026-10-26**
**Status:** ✅ APPROVED WITH FIXES (one small fix, F-1, applied by SA in the worktree; uncommitted)

Reviewed in the worktree `neuronforge-p7a`, branch `feature/bos-plan-payments-p7a` (base `10761291`), all uncommitted: 18 tracked files and 11 new files.

#### Conditions verified

| Condition | Verdict | Evidence |
|---|---|---|
| C-1: one switch, in the predicate and the routes | ✅ | Both routes 404 on `isPlanPriceRecognitionEnabled()` before `getUser()`, the body, the database or Stripe. `planManageOffer` takes `pricesEnabled` as its first rule. `planPurchaseView` feeds it `readHeldPaymentSwitches().pricesEnabled`, which is the price switch, not the checkout switch. The screen therefore never offers a button that the route would 404. Route test: the price switch off gives a 404 with nothing read; the checkout switch off still works (BQ-1). The §9.5 row-15 sibling note is in the requirement |
| C-2: mirror from the write's own answer; heal on `unchanged`; a failed mirror is a warn | ✅ | `setBusinessOsCancelAtPeriodEnd` maps the `subscriptions.update` response and makes no second retrieve (the test pins the call order: `retrieve, update, mirror`). On `unchanged`, the heal runs when our row's flag or status differs from Stripe's, and it writes no audit. `mirror()` never throws: error, not mirrored and throws all give a warn, and each is pinned |
| C-3: `cancel_at` as well as the flag | ✅ | `isCancelling` = the flag OR `cancel_at`. Reactivate sends `false`, which X-2 shows clears either. The X-2 follow-up (a dashboard cancellation set as `cancel_at` alone is not mirrored) is recorded in Implementation Notes and in the requirement's P-7a row. It is not fixed here, which is correct: the webhook is untouched |
| C-4: order contract and cross-checks | ✅ | Every our-data refusal (switch, key mode, unreadable row, no row, no subscription id, ended, canceled, failed attempts, past_due, period over) is checked for both actions, with **zero** Stripe calls, no mirror and no audit. The four cross-checks (id, customer, mode with row = key, `bos_user_id` when present) each answer 409 `billing_record_mismatch` with an `error` log and `alert: true`, after exactly one retrieve, with nothing written and nothing audited |
| C-5: `{}` body | ✅ | `z.object({}).strict()`. An injected `userId`, `subscriptionId` or `customerId`, or an array body, gives a 400 with nothing read. Unparsable JSON gives a 400. `{}` proceeds (every happy path). The client always sends `'{}'` (render test) |
| CAS, never UPDATE + `.or()` + `.select()` | ✅ | Reuses the existing `mirrorSubscriptionState`: `{ count: 'exact' }`, `.eq('user_id')`, `.eq('livemode')`, `.eq('stripe_subscription_id')`, no `.select()`, no `.or()`. No new repository method |
| Tenant isolation (`tenant-isolation-guard`) | ✅ | The account comes from the session only (`getUser()` → `resolveAccountId`). The subscription and customer ids come from **our** row (session user, server key mode). The fresh Stripe answer is cross-checked before the write, and the write's answer is checked again (id, customer, mode, asked state) before the mirror. The mirror's CAS is keyed on the row's user. There is no new service-role path |
| Entitlements (`business-os-entitlements`) | ✅ | The new importers are the two routes, each importing `resolveAccountId` only and each registered as a non-gate with a "why". `planManageOffer.ts`, `planSubscriptionManage.ts`, `PlanManage.tsx` and `planManageCopy.ts` import nothing from the module. `planPurchaseView.ts` gains no entitlements import. `npm run test:bos-entitlements`: 306 suites, 9 227 tests, all passed (SA run) |
| `new-api-route` | ✅ | Gate, then auth, then Zod, then the orchestration over the repository. Pino `createLogger` + `child({ correlationId })`. Error format with the `development` guard on `details`. `runtime = 'nodejs'`. Refusal text comes from a fixed table, never from Stripe or the database |
| Pino, no `console.*` | ✅ | None in any touched file. Stripe errors are logged through `safeErr` (type, code, status, request id), never the error object |
| Audit | ✅ | `info` severity, SOC2, audience `bos`. Actor `'owner'`, entity `business_os_billing_account` / account id. Written with `logAndFlush` (bounded, never fails the request) **before** the response: the test fails if the `await` is removed (mutation M6). Refusals and `unchanged` are not audited. AM-7 coverage moves both rows to BUILT |
| i18n en / he / es, Hebrew RTL | ✅ | 21 `plan.manage.*` keys in each language (the render test pins he and es parity). No left/right-specific classes: `flex-wrap gap-2` and `space-y` only, so RTL needs nothing more. The he and es texts are drafts, and the user's G-5 approval is owed before go-live |

#### Deviation rulings

| # | Ruling |
|---|---|
| 1 | **Accepted.** An import-free `planManageOffer.ts` is better than §4.1: the predicate, the orchestration and the wire carry no entitlements symbol, which is TQ-13's intent. The pattern is still "one predicate for the screen and the route" |
| 2 | **Accepted, and it is the better design.** The row only decides *whether* the owner may manage. The fresh read decides *which* action is a no-op (`unchanged`) and heals the row (C-2). Refusing `already_cancelling` / `not_cancelling` on the row would block the very press that repairs a stale row. Double clicks and second tabs are still absorbed with no write and no audit |
| 3 | **Accepted.** Auditing a write that was attempted with outcome `unknown` follows P-7b.1 V-3. A money-state change may have happened, and the audit trail must not be silent about it. The "answer differs" case is also alerted (`stripe_error`, `error` + `alert`) and nothing is mirrored, which is correct. A `NOT_EXECUTED` Stripe error (invalid request, auth, permission, rate limit) is correctly **not** audited |
| 4 | **Accepted; it does not paint P-7a.4 into a corner.** The fresh-status check is a single branch that P-7a.4 replaces with the immediate path. The audit type (`mode: 'period_end'`) and the wire (`paymentFailed`) are both open to extension. **Binding note for P-7a.4:** decide immediate vs period end on the **fresh** Stripe status, not on our row. A row with `failed_attempts > 0` whose Stripe status is already `active` again (cured, webhook lagging) must still get period-end behaviour, or the owner would end a paid-up plan at once. Our-data step 5 stays as is: the row admits the action, and Stripe decides the mode. C-11 (void or prove `invoice.paid` is refused) still binds .4 |
| 5 | **Accepted.** SA checked the claim: while a tier is in force the resolution basis is `tier`, so the cohort end is not in the my-plan snapshot, and the sentence needs the plan row. **Condition:** the BQ-5 sentence is a P-7a.3 deliverable (add it to .3's task list), and it must ship before the price switch goes on in production. Until then a Founding Partner reads only "it will not renew". This is behind the flag, so there is no customer impact |
| 6 | **Accepted, as a recorded gap.** With no reason shown, the upgrade buttons simply disappear while cancelling. That is a nicety, not a defect. TL decides whether .3 carries it (`planUpgradeOffer` would need to say whether a higher tier exists while cancelling) or §2.1 drops the line |
| 7 | **Accepted.** An optional `cancelAt` read as `?? null` is safe. The one existing `toEqual` change is a widening, not a loosened guard |
| 8 | **Accepted; no regression found in the upgrade modal.** `PlanManage` renders only in the `strip === 'your_plan'` branch (the Settings pop-up through `UpgradeSession`), and only while no flow is open. The drawer-stacked modal (`strip = 'status'`, from `PlanSection`) does **not** render it, so there are no duplicate controls. It renders `null` without `manage`, so the demo page and accounts without a paid plan are unchanged. `onPlanManaged` is optional, and its only caller passes the re-read with a `mounted` guard. All 46 settings component suites pass |
| 9 | **Accepted.** Using "תוכנית" matches the existing plan and upgrade keys. One key, `plan.manage.refusal.not_active`, says "המינוי". It follows the English "subscription" and is not wrong; leave it for the user's G-5 pass |

#### Code Review Comments

1. `components/business-os/settings/PlanManage.tsx` (the `outcome` branch): an `unchanged` answer showed **nothing**, and relied on the my-plan re-read. Two real cases make that re-read stale: (a) the C-3 / X-2 gap, a `cancel_at` set in the dashboard without the flag, where our row keeps saying "renewing"; (b) a heal mirror that failed (warn). In both, the owner presses Cancel, sees no result, and the Cancel button is still there. **Fix F-1 (applied by SA):** `unchanged` now shows the same line as the action, built from the route's own `state` and `date` ("Cancelled. You keep {plan} until {date}." / "Your plan will renew on {date}."). It reuses existing keys, so there is no new copy. Two render tests were added, and SA mutation-checked them (removing the branch makes both fail). Priority: **Medium**
2. `lib/business-os/billing/planPurchaseView.ts`: `manage` is absent whenever the view returns `null` (plan snapshot unavailable, or `no_plan_row`), even though the route would admit the action. This is the safe direction (never a button the route refuses), but a paying owner hit by a transient entitlements read failure sees no Cancel. No change needed; recorded. Priority: **Low**
3. Two tabs pressing at the same instant can both pass step 7 and write two audit entries. This was accepted at workplan review and is noted in the route header. Priority: **Low (accepted)**

#### SA verification runs (2026-10-26)

| Gate | Result |
|---|---|
| `app/api/stripe`, `lib/business-os/purge`, `lib/business-os/billing`, `app/api/business-os/billing`, `components/business-os/settings`, `components/business-os/billing`, `lib/stripe`, `lib/audit`, `app/api/business-os/entitlements`, billing repository suite (`--ci`) | 154 suites, 6 103 tests, all passed (before F-1); `components/business-os/settings` 46 suites / 886 passed, and `PlanManage.render` 10 / 10 after F-1 |
| `npm run test:bos-entitlements` | 306 suites, 9 227 tests, all passed |
| Connect harness snapshot md5 | `acdad2efd4d646e687e507a3dd0b01e9` before and after; never `-u` |
| Mutation checks (one at a time, each restored by Edit and the md5 re-verified) | M1 switch rule removed from `planManageOffer`: 7 fail. M2 our-data refusals bypassed: 11 fail. M3 heal disabled: 3 fail. M4 `bos_user_id` cross-check off: 1 fails. M5 mirror throw propagated: 1 fails. M6 cancel body not strict: 3 fail. M7 audit not awaited before the response: 1 fails. F-1 branch removed: 2 fail. Every mutation was caught |
| Typecheck (`tsc --noEmit`, 8 GB heap, completed, no OOM) | 1 855 errors repo-wide, **0** in any touched or new file (the pre-existing ones are in untouched Stripe Connect, audit-helper and script files) |
| ESLint, the 10 touched source files | 0 findings |
| `npm run build` | **Accepted as environmental.** "Compiled successfully". Page-data collection then stopped on `supabaseUrl is required` because this worktree has no `.env.local`. Compile and typecheck are what this diff can affect; the required CI Build job runs with env. SA does not require a local `.env.local` copy into a worktree |

#### Optimisation Suggestions (non-blocking)

- `planSubscriptionManage.ts` names its steps 3–10, while §4.2 numbers 1–12. The header table is self-consistent, but aligning the numbers with §4.2 (or citing "§4.2 step N") would save the next reader a mapping.
- `PLAN_MANAGE_REFUSALS[*].message` is English and is only a fallback (the client maps by `code`). That is fine, and it matches the upgrade route.

#### For QA (focus)

1. **Live sandbox walk, test mode, both switches on locally:** renewing → Cancel → confirm → "Cancelled … until {date}". The drawer line becomes "Ends on", Reactivate appears, and the admin list shows **Cancelling**. Then Reactivate → "renew on {date}" and the admin list shows **Active**. Check one audit entry each (`actor: owner`, `info`) and no entry for `unchanged`.
2. **Second tab / double press:** with tab A already cancelled, Cancel in tab B gives 200 `unchanged`. It now shows the line (F-1), there is no second audit entry, and the row is unchanged.
3. **Stale-row heal:** set our row's `cancel_at_period_end` wrong by hand (test mode only), then press. Expect `unchanged`, the row corrected and no audit.
4. **Dashboard `cancel_at` only (X-2 follow-up):** in the Stripe dashboard, set "cancel at" without the flag. Cancel in the app gives `unchanged` with the date (F-1 line), and the admin list still says Active (the known follow-up, not a P-7a.1 defect). Reactivate in the app clears it.
5. **Settings pop-up (deviation 8):** the "Your plan" strip shows Cancel / Reactivate only when no flow is open. The drawer-stacked upgrade modal shows **no** manage controls. An owner without a paid plan sees no change in either window.
6. **Failed payment:** a past_due test subscription shows "Your payment failed … contact us to cancel" and no Cancel button. With the switch off: no controls, and both routes 404.
7. **Hebrew (RTL) and Spanish** at 360 px: the confirmation, the done line and the refusal lines all wrap cleanly. Record the he / es drafts for the user's G-5 pass.
8. Pending upgrade (`pending_if_incomplete`, failing card): Cancel → "An upgrade is waiting for payment…" and no write.

#### Carried forward

- P-7a.3: BQ-5 Founding Partner sentence (deviation 5, binding before the price switch goes on in production); deviation 6 for TL to keep or drop (TL 2026-10-26: dropped, see §2.1).
- P-7a.4: immediate vs period end decided on the **fresh** status (deviation 4 note), plus C-11.
- Webhook follow-up: mirror `cancel_at` as cancelling (C-3 / X-2), together with AM-7 "who cancelled" (TQ-9).
- C-12 for RM: the base `10761291` is behind `origin/main`. Sync from `main` before the PR, never stack, and re-run the C-12 suites after the merge-in.

#### Code Approved for QA: Yes (with F-1 applied)

### SA Code Review — P-7a.2 (2026-10-27)

**Code Review by SA — 2026-10-27**
**Status:** ✅ APPROVED WITH FIXES (one documentation fix, F-2, applied by SA in the worktree; uncommitted. No code change)

Reviewed in the worktree `neuronforge-p7a`, branch `feature/bos-plan-payments-p7a2` (base `131a46b1` = P-7a.1), all uncommitted: 20 tracked files (+433 / −25) and 15 new files.

#### Conditions verified

| Condition | Verdict | Evidence |
|---|---|---|
| C-1: one switch, 404 before any read | ✅ | Both routes answer 404 on `isPlanPriceRecognitionEnabled()` before `getUser()`, the body, the database or Stripe, with `no-store`. `readOwnCustomer` checks the same switch again, and `planCardAndInvoicesOffer` takes it as its first rule, so the screen never offers a button the route refuses. Route test: the checkout switch off still works (BQ-1 "Yes, always") |
| C-6: return URL | ✅ | `portalReturnUrl(platformOrigin())`, a fixed path pinned equal to the checkout's `settings_plan` path. Nothing in the route reads `Host`, `Origin` or `Referer`, and a route test sends all three and asserts they are ignored. (The legacy agent-platform `create-portal` still prefers `origin`. It is untouched and out of scope) |
| C-6: `update_card` flow | ✅ | `flow_data: { type: 'payment_method_update', after_completion: { type: 'redirect', redirect: { return_url } } }`. The `invoices` intent sends no flow. Mutation M5 (removing `after_completion`) is caught |
| C-6: success-only cache | ✅ | `verified` is set only after a pass, keyed by `id:livemode`. A failed retrieve, a mismatch or an id that differs is never cached. Mutation M3 (caching a failed retrieve) is caught by 2 suites |
| C-6: `Cache-Control: no-store` | ✅ | Every answer of both routes goes through the `json()` helper with `NO_STORE`, including 404, 401, 400, refusals and 500. Mutation M2 is caught |
| C-6: no bearer links in logs | ✅ | Logs carry ids, counts, reasons and booleans only. Stripe errors are reduced by `safeErr`. The client logs `{ err, intent }`, never the URL. Route tests assert that no log line holds the portal URL or an invoice link |
| C-7: X-1 evidence | ✅ **not triggered** | X-1 (sandbox, Checkout-shaped subscription): after a portal card change, the customer's invoice default is the new card and the subscription's own `default_payment_method` was cleared, so the next renewal uses the new card. There is no webhook handler and no `payment_method.*` / `customer.updated` change. The Connect snapshot is unchanged |
| C-8: script | ✅ | Uses `stripe-script-guards` for everything: `--env` outside every checkout, `--expect-account` checked with `accounts.retrieve()` before any other call, and the key kind checked before any network call. Test mode by default (`sk_test` only); `--live` accepts `sk_live` / `rk_live` only. Dry run unless `--apply`. Our configuration is found by metadata `product`. Any drift, two of ours, or an archived one gives STOP and no edit. Every listed and created object is checked for mode. The created configuration is re-checked against the specification. The `bpc_…` id is printed; the key never is. **Never Stripe's default:** the runtime refuses `portal_unavailable` (503 + alert) on a missing or malformed id, and every session names its configuration |
| TQ-6: invoice source | ✅ | One `invoices.list({ customer: <our row>, limit: 12 })` call. `limit` is clamped to 1..100 and there is no paging loop (`hasMore` → "See all in Stripe"). Nothing reads `billing_events`, `user_subscriptions` or any money-history table. The list loads only when the owner opens it (render test: no fetch on mount) |
| TQ-8 / X-5: locale | ✅ | A strict body enum `en` / `he` / `es`. `portalLocaleFor` sends `he` (and an absent locale) as `auto`, because X-5 shows that Stripe refuses `he` / `he-IL`. Mutation M7 (sending `he` through) is caught |
| Tenant isolation (`tenant-isolation-guard`) | ✅ | The account comes from the session only (`getUser()` → `findByUser(user.id, <server key mode>)`), and the bodies and query are strict. The customer id is **our row's**, never a request value. The row's own `livemode` must equal the key mode. The portal session that Stripe returns must name our customer, mode and configuration with an `https` URL, or the URL is withheld (502 + alert; mutation M4 is caught). Invoices for another customer or mode, or not in USD, are dropped and alerted by id (mutation M6 is caught). No service-role path is added: `findByUser` is the repository's existing documented read |
| Zod strict | ✅ | Portal: `z.object({ intent, locale? }).strict()`, and unparsable JSON is a 400. Invoices: `z.object({}).strict()` over the search params (deviation 7) |
| `new-api-route` | ✅ | Gate, then auth, then Zod, then the orchestration over the repository. `createLogger` + `child({ correlationId })`. Error format with the `development` guard on `details`. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. Refusal text comes from a fixed table, never from Stripe. Not audited (TQ-9) |
| Pino, no `console.*` | ✅ | No `console.*` in any touched or new file (the script writes to `process.stdout`, as its siblings do) |
| Entitlements (`business-os-entitlements` review checklist) | ✅ | The only new importer in the diff is `planBillingDocuments.ts` → `TIER_MATRIX` (`config/tierMatrix`). It is registered in `KNOWN_NON_GATE_IMPORTERS` with exactly that symbol, and it is truly a non-gate: label only, no `check()` / `decide()`, no refusal by plan. Both routes, `PlanCardAndInvoices.tsx`, `planInvoiceList.ts`, `portalConfiguration.ts` and `planManageOffer.ts` import nothing from the module. No tier literal, no capability change, no snapshot change. `npm run test:bos-entitlements` is green (SA run) |
| i18n en / he / es | ✅ | 19 keys in each language, with placeholder parity pinned by test. The `plan.manage.*` count is 23 (the QA pin was raised, not loosened). Hebrew uses the plural present ("פותחים", "טוענים"), like the G-5 fix, and "תוכנית". Amounts sit in `<bdi>` so RTL keeps the sign in place. he / es are drafts for the user's G-5 pass |
| Coordination with D2 | ✅ | `planSubscriptionManage.ts`, the cancel route and the reactivate route are **not** in the diff. `planManageOffer.ts` only gains a new export plus an optional second argument on `planManageWire`, defaulting to `false`, so existing callers read the same. `planPurchaseView.ts` only feeds that argument from the row it already reads. D2 can rebase onto this without conflict in those code paths |

#### Deviation rulings

| # | Ruling |
|---|---|
| 1 | **Accepted.** `planBillingDocuments.ts` mirrors `planSubscriptionManage.ts`: one order, one refusal table, injected ports. The pure mapper stays separate |
| 2 | **Accepted, and the better rule.** A customer exists from checkout *start*, so "customer only" would offer Update card to someone who never paid. Ended subscriptions still qualifying is right for receipts. Update card on an ended subscription is harmless: it only sets the card on a customer with nothing to renew. One flag is right while the two answers are always equal. If they ever differ (for example "invoices only once ended"), split the flag then. Not now |
| 3 | **Accepted.** Stripe's hosted page offers both the invoice and the receipt download. One link is simpler, and the PDF URL never leaves `StripeService` |
| 4 | **Accepted, with F-2 below.** It is no regression in either mode. Stripe creates no portal session without a configuration on an account that has no default, so before `bpc_1UUv5MC7KDUGYIcA3O6iIzRJ` existed, the parked agent platform's `create-portal` already failed in this sandbox. It now opens card-and-invoices only, the safer direction. **Live:** the script must **not** try to make ours non-default or to edit any other configuration (it cannot, and must not). If the live account has no configuration, ours becomes the default and that is accepted. The real live hazard is different: once ours is the default, the Stripe dashboard's *Customer portal* settings page edits **our** configuration. F-2 adds that warning to §9.5 row 13 |
| 5 | **Accepted.** A negative total is a real credit note on the customer. An unreadable total is dropped, not guessed |
| 6 | **Accepted; verified against the skill.** The routes key the billing row on `user.id`, exactly as the cancel route's `findByUser(user.id, …)`, the drawer view and `my-plan` do. With no write, no audit entity and no `bos_user_id` cross-check, there is nothing for `resolveAccountId` to feed. The routes therefore import nothing from the module and correctly need no registration. `planBillingDocuments.ts` is registered instead with `TIER_MATRIX`, and the symbol list matches its import exactly. §4.8's "routes register `resolveAccountId`" is superseded for P-7a.2 |
| 7 | **Accepted.** The client calls the bare path with `cache: 'no-store'`, and nothing adds parameters to a same-origin `fetch`. A visible 400 for an injected `customerId` is better than silently ignoring it |
| 8 | **Accepted.** The email line stays exactly where no button is offered. The transient hide during an open upgrade flow does not matter in practice, because an owner in a failed renewal is not offered an upgrade |
| 9 | **Accepted as a recorded follow-up; nothing needed in P-7a.2.** SA checked the shipped copy: `billing.notice.payment_failed*` says "Please update your card to keep your plan", and `plan.payment_failed_on` says "Stripe will try again automatically". Neither promises an immediate clear, so nothing is false after X-1b. The owner already has a "pay now" route: the open invoice is in the list as "Due", with Stripe's hosted page. **Follow-up FU-P7a2-1 (for P-7a.4, or a copy pass before the price switch goes on in production):** on an `open` row, label the link "Pay now" instead of "View invoice and receipt", and/or add one line under Update card during `payment_failed`: "After updating your card, pay the due invoice below to clear this now; otherwise Stripe retries on its schedule." This is a wording decision (G-5), not a defect. **C-11 still binds P-7a.4:** that hosted "Due" link is exactly the path by which an owner could pay after an immediate cancel |

#### Code Review Comments

1. `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` §9.5 row 13: the row said only that ours may become the default. It did not say what that means for operators. **Fix F-2 (applied by SA):** the row now records that the default is accepted (no regression), that the dashboard's Customer portal page then edits **our** configuration, so features must never be changed there, that a drift closes Update card (503 + alert) only from the next cold start because a warm instance keeps its pass (the success-only cache by design, TQ-7), and that branding there is fine. Priority: **Medium**
2. `lib/business-os/billing/portalConfiguration.ts`: the once-per-instance pass means a configuration edited in the dashboard after a warm instance verified it keeps being used until that instance recycles. This is accepted, because TQ-7 chose once per instance and the worst case is a portal that also offers cancel, which the webhook records. It is recorded through F-2. No change. Priority: **Low (accepted)**
3. `components/business-os/settings/PlanCardAndInvoices.tsx`: an `open` ("Due") row's link reads "View invoice and receipt". See deviation 9, FU-P7a2-1. Priority: **Low (follow-up)**
4. `app/api/business-os/billing/plan/invoices/__tests__/` is an empty directory. Both routes are tested in `portal/__tests__/route.test.ts`. Git does not track it, so it is harmless. Dev may remove it or leave it. Priority: **Low**
5. `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`: "Last Updated 2026-10-26", while the change was completed on 2026-10-27. Cosmetic, for RM to align if wanted. Priority: **Low**

#### SA verification runs (2026-10-27)

| Gate | Result |
|---|---|
| `app/api/stripe`, `lib/business-os/billing`, `app/api/business-os/billing`, `components/business-os/settings`, `components/business-os/billing`, `lib/stripe`, `lib/audit`, `lib/business-os/purge`, `app/api/business-os/entitlements`, billing repository suite, `scripts/__tests__` (`--ci`) | 172 suites / 6 712 tests: 6 709 passed. 3 failed in `PlanUpgrade.render.test.tsx`, which took 166 s under the full parallel load; that file is **not in the diff**. Re-run alone: **76 / 76 passed**. This is a load timeout and not a regression. QA should note it if it recurs |
| `npm run test:bos-entitlements` | **308 suites, 9 270 tests, all passed** |
| Connect harness snapshot md5 | `ab7528ea68309cffb309ffbd46c455ab` before, after and after every mutation; git shows it unmodified; never `-u` |
| Mutation checks (one at a time, each restored by Edit and the md5 re-verified) | M1: the subscription id removed from `planCardAndInvoicesOffer`, 3 fail. M2: `no-store` removed from the invoices route, 2 fail. M3: a failed configuration retrieve cached, 2 fail. M4: the portal-session customer cross-check removed, 1 fails. M5: `after_completion` removed, 1 fails. M6: the other-customer invoice filter removed, 1 fails. M7: `he` sent to Stripe, 2 fail. **Every mutation was caught**, and all 6 files are back to their pre-review md5 |
| Typecheck / ESLint / build | Not re-run by SA. Dev's record (0 type errors in 31 touched files, no OOM; ESLint 0) is accepted. The local build follows P-7a.1's environmental ruling; the required CI Build job is the gate |

#### Optimisation Suggestions (non-blocking)

- The script's dry run could also say, before `--apply`, whether the account has any configuration yet ("ours will become the default"). Today the NOTE appears only after creation or on a re-run. F-2 covers the operator, so this is optional.
- `isInvoiceRow` on the client does not check `planLabel` / `currency`. The server's mapper is the authority, so this is fine.

#### For QA (focus)

1. **Sandbox walk, test mode, price switch on:** a paid owner opens Settings → Plan → **Update card**, lands on Stripe's card form (not the portal home), adds `5555…4444`, and is redirected straight back to `/business-os/settings?section=plan`. In Stripe, check that the subscription's `default_payment_method` is null and the customer's invoice default is the new card (X-1).
2. **Checkout switch off, price switch on:** Update card and Invoices still work (BQ-1). **Price switch off:** no buttons, and both routes 404 with `Cache-Control: no-store`.
3. **Invoices:** opening the list issues exactly one `GET` (DevTools), and closing then opening issues one more. The rows show date, reason, plan label, USD amount and status. "View invoice and receipt" opens `invoice.stripe.com` in a new tab. With more than 12 invoices (a test clock), **See all in Stripe** opens the portal home. A declined upgrade's voided invoice reads "Plan change · Not charged".
4. **Failed renewal (X-1b):** with a `past_due` test-clock subscription, the "use the link in Stripe's email" line is replaced by the button. After a card update the banner **stays** until the next Stripe retry. Paying the "Due" row's hosted page clears it through `invoice.paid`. Record this as expected behaviour, not a bug (deviation 9).
5. **Owner without a paid plan / a checkout started and abandoned:** no Update card and no Invoices; a direct POST answers 409 `no_billing_account`. **Ended subscription:** only Update card and Invoices are shown, and old receipts are visible.
6. **Injection:** POST `{ intent: 'update_card', customerId: 'cus_x' }` → 400. `GET …/invoices?customerId=cus_x` → 400. Neither reads anything.
7. **Configuration faults:** unset `STRIPE_BOS_PORTAL_CONFIGURATION_ID` (or set it to a non-`bpc_` value) → "not available right now" and an `error` log with `alert: true`. The portal never opens on Stripe's default.
8. **Logs:** in the server output for a full walk, no line contains `billing.stripe.com` or `invoice.stripe.com`.
9. **Hebrew (RTL) and Spanish at 360 px:** buttons and rows wrap. A credit reads "-$5.00" with the sign kept in place in RTL. The Hebrew portal opens in Stripe's `auto` language, the Spanish one in Spanish. Record the he / es drafts for the user's G-5 pass.
10. **Script:** re-run the dry run against the sandbox: "OK … matches" plus the default NOTE. A wrong `--expect-account` and `--live` with a test key are both refused before any write.

#### Carried forward

- FU-P7a2-1: the "Pay now" wording on a Due row and/or the clear-now line (deviation 9). It is a G-5 wording decision, to settle before the price switch goes on in production.
- P-7a.4: C-11 still binds. The invoice list's "Due" link is one of the paths it must make safe after an immediate cancel.
- §9.5 row 13 (F-2): the live run and the warning against editing features in the dashboard.
- C-12 for RM: merge `origin/main` (with #519) before the PR, never stack, and re-run the C-12 suites after the merge-in. D2's `planSubscriptionManage.ts` / cancel / reactivate changes land after this PR merges.

#### Code Approved for QA: Yes (with F-2 applied)

### SA Code Review — P-7a.3 (2026-10-27)

**Code Review by SA — 2026-10-27**
**Status:** ✅ APPROVED WITH FIXES (two small test-only fixes, F-3 and F-4, applied by SA in the worktree; uncommitted. No product code changed)

Reviewed: the uncommitted diff on `feature/bos-plan-payments-p7a3` (base `f3176607`), 30 modified files and 2 new test files.

#### Conditions verified

| Ruling | Verified | How |
|---|---|---|
| TQ-11 / C-9: control 3 FIRST in `ResetGuard` | ✅ | `hasLivePlanSubscription(userId)` runs before `resolveConnectAccounts`. Pinned by source order (paths test §4) and by call order (`ResetService.order`: `billingRead` after `purgeFunctionExists`, before `resolveConnectAccounts`; on refusal there is no Connect read, no local-state count, no snapshot, no `executePurge`) |
| Both modes, shared predicate | ✅ | `hasLivePlanSubscription` reads `readPlanBilling` for test and live and decides through `isPlanSubscriptionLive`. The guard writes no status literal. Mutation M2 (live mode only) → 26 failures |
| Unreadable = refuse | ✅ | `null` and an unexpected throw both give `subscription_unreadable`. Mutation M1 (unreadable passes) → 2 failures |
| Commit time, before the snapshot; preview unchanged | ✅ | The guard is called only from `runPurgeCommit` step 4. `app/api/business-os/purge/preview` is not in the diff |
| Types | ✅ | `subscription_live` / `subscription_unreadable` are in `ResetGuardResult['control']` and `ResetRefusal`. No `Record` over the refusal union elsewhere needed them except the admin client mirror (deviation 1) |
| Admin path passes control 3 | ✅ | `AdminDeletionCommit` → `runPurgeCommit`. `ResetService.adminSurface` +2, additions only; the existing admin delete tests pass unchanged |
| C-10: G-6 SQL text unchanged, no migration | ✅ | No file under `supabase/` in the diff. Only `R3_CLEARING`, the en/he/es `plan_running` blocker and the `DangerZonePanel.tsx` fallback changed |
| Cross-path pin ties every path | ✅ (after F-3) | SQL (newest generated migration + the check and delete scripts) = `R3_LIVE_STATUSES` + the not-ended clause, with a non-vacuity check; G-6 as a predicate = `isPlanSubscriptionLive` over 8 statuses + null × id × ended; the guard, R-3 and `hasLivePlanSubscription` agree row by row in both modes; one engine caller of `executePurge`, after the guard; one caller of the cleanup RPC |
| AC-F8.3 walk | ✅ | Real functions throughout: `planManageOffer`, `billingStateFromRecord`, `resolveEntitlements`, `planBadgeFor`, `planPaymentNotice`, `freeAccessAfterPaidTier`. It covers cancelling, the FC-1 margin, back on the cohort with the pill and no banner, cohort end → grace with the banner, and the AC-F8.2 contrast. Cohort and tier are found by structure |
| P-7a.1 carry-forward: the BQ-5 sentence | ✅ | Built. It must be in production before the price switch is turned on there; this slice delivers it |
| Files owned by D2 not touched | ✅ | `planSubscriptionManage.ts` and the cancel / reactivate routes are not in the diff |
| No new env read (EC-3) | ✅ | No `process.env` in any added line. The local `catalogueDrift.guard` G3-1f red is P-7a.2's `portalConfiguration.ts`, fixed on `main` by `663aa9b9` |
| Pino, no `console.*` | ✅ | No `console.*` call in any touched product file (the two hits in `adminDeletionRefusals.ts` are the words "admin console" in copy) |
| i18n | ✅ | `plan.manage.cancel_confirm_founding` and the changed `plan_running` are in en, he and es. The `PlanManage` key-count pin went from 23 to 24 |
| Entitlements registration (skill review checklist) | ✅ | No file outside the module gained an import from it. The my-plan route's imports from the module are byte-identical (it calls a new method on the already-imported `getEntitlementService`). `planPurchaseView.ts` takes a locally typed function port. There is no tier or cohort-id literal (the copy names the cohort's display label, see deviation 5). Tests are exempt |

#### Deviation rulings

| # | Ruling |
|---|---|
| 1 | **Accepted.** `AdminDeletionCommitCode` ⊇ `ResetRefusal` is pinned both ways against `DeletionCommitCodeView`, so the mirror must move. The two operator sentences are accurate: R-3 refuses first at the preview, and these are reached only in a race |
| 2 | **Accepted.** The sentence is shown beside Reactivate as well as in the confirmation. It is the same key and the same server rule, and an owner who cancelled yesterday should still see where they land. It fits BQ-5's intent |
| 3 | **Accepted.** The lifecycle owns "what decides access when the tier lapses", so the entitlements module is the right home, and the answer comes from `deriveLifecycle` itself, not from a second rule. **Cache hit confirmed:** `getSnapshot` stores the inputs, the new method reads the same entry within the TTL, and a test pins `calls === 1`. **Tenant isolation:** the route passes a closure over `accountId = resolveAccountId(user.id)` (session only). The view takes no account parameter, and the port is called only when Cancel or Reactivate is offered (mutation M5 → 2 failures). **Registration:** none needed (above). Note: on a cache miss it does not fall back to stale inputs as `getSnapshot` does. That is correct for display (`null` = say nothing) |
| 4 | **Accepted.** There is no date to name. BQ-P10 refuses the checkout path, and an admin who creates one by hand gets the plain "It will not renew" |
| 5 | **Accepted with a tripwire (F-4).** The rule is structural (any admin-dated cohort), but the copy names "Founding Partner". It is true today: there is exactly one admin-dated cohort, whose config label is "Founding Partner" in all three languages. F-4 makes the flag enforceable: a test fails if a second admin-dated cohort appears, or if the sentence in any language stops containing that cohort's label. At that point the sentence takes the label as a server slot. Note for the user's G-5 pass: §11 drafted "שותף מייסד" and "Socio Fundador"; the Dev used the config label (untranslated, as the pill shows it). The tripwire follows whichever the user picks only if the config label changes with it |
| 6 | **Accepted.** I read every edited assertion. Each follows the new copy, and none is loosened. The self-delete tests now pin the mailto on `contact_support`, the blocker that still carries `{support}` |
| 7 | **Accepted.** The billing-repository caller guard lists the three test fakes. No product file gained a repository import |
| 8 | **Accepted.** "Configuración" is `settings.title` in es and matches the shipped `stripe_connected` blocker ("Configuración → Pagos") |

#### Code Review Comments

1. `lib/business-os/purge/__tests__/planSubscriptionLive.paths.test.ts` (`newestCleanupMigration`): selecting the newest cleanup migration by **filename pattern** repeated the trap that `scripts/__tests__/testAccountCleanupSql.test.ts` G-b records ("20261081 already broke the `operator_test_account_cleanup` name pattern, so a filename glob would miss the next one"). If another session generates a cleanup migration under a new name, the newest-by-pattern would stay `20261094` while the generator's `MIGRATION_FILE` moves, and this suite would go red on an unrelated PR. — Priority: Medium — **F-3, applied by SA:** select by the generator's first-line marker (`-- … GENERATED by scripts/generate-test-account-cleanup-sql.ts`), as G-b does, and keep the `=== MIGRATION_FILE` assertion. Today it selects the same 10 files, newest `20261094`. A new generated migration is picked up whatever its name, and an unrelated migration can never become "newest".
2. `lib/business-os/entitlements/__tests__/freeAccess.test.ts`: deviation 5 was flagged but nothing enforced it. — Priority: Low — **F-4, applied by SA:** the tripwire test described in deviation 5.
3. `lib/business-os/entitlements/freeAccess.ts:151` (`endsAtMs <= tierEndsAt`): a mutation removing this clause survives, because the lifecycle check above it already excludes a cohort that has ended by then. It is belt-and-braces and costs nothing. Keep it. — Priority: Low (information only)
4. Copy: "Settings → Plan". The settings row and the drawer title are "Your plan" / "התוכנית שלך" / "Tu plan", so "→ Plan" is a close paraphrase rather than the literal label. English is consistent with the P-7a.1 / P-7a.2 copy. Leave it for the user's G-5 pass. — Priority: Low

#### SA verification runs (2026-10-27, each alone, none in parallel)

| Run | Result |
|---|---|
| Focused: `lib/business-os/purge`, `lib/business-os/billing`, `app/api/business-os/entitlements`, entitlements `freeAccess` / `acF83` / `entitlementService`, `PlanManage*` | 68 suites, 4 364 tests, all pass |
| C-12 set: `app/api/stripe`, `lib/business-os/purge`, `lib/business-os/billing`, `app/api/business-os/billing`, `components/business-os/{settings,billing,purge,account-deletion}`, `app/admin`, `lib/admin`, `lib/audit`, `app/api/business-os/entitlements`, `lib/business-os/entitlements`, the billing repository suite, `testAccountCleanupSql` | 442 suites, 15 154 tests: 15 153 pass. **1 expected failure:** `catalogueDrift.guard` G3-1f on P-7a.2's `portalConfiguration.ts` ("found 1, pinned 0"), fixed on `main` by `663aa9b9`, arrives with RM's merge of `main` |
| After F-3 / F-4 | `freeAccess` + `planSubscriptionLive.paths`: 148 tests, all pass |
| `npm run test:bos-entitlements` (on the final diff, with F-3 / F-4) | 314 suites, 9 424 tests, all pass |
| Connect harness snapshot | md5 `ab7528ea68309cffb309ffbd46c455ab`, unchanged; never `-u` |
| Mutations (one at a time, each restored by Edit, md5 confirmed) | M1 unreadable → clear: 2 failures. M2 live mode only: 26 failures. M3 drop `endsAtMs <= tierEndsAt`: survives (comment 3). M4 allow a timed cohort: 1 failure. M5 call the port without Cancel / Reactivate: 2 failures |

Not run by SA: `tsc` (Dev reports 0 errors in the touched files, no OOM) and `npm run build` (no `.env.local` in the worktree). F-3 and F-4 are test-only, and both ran under ts-jest.

#### Optimisation Suggestions (non-blocking)

- `getFreeAccessAfterPaidTier` does not "touch" the LRU entry on a hit, as `getSnapshot` does. That is harmless, because the route has just touched it.
- If a second admin-dated cohort is ever added (F-4 fails), move the cohort label into the wire (`freeAccessAfter: { endsAt, cohortLabel }`) and make the copy a `{cohort}` slot.

#### For QA (focus)

1. **Control 3 on all three paths**, test mode, a designated test owner on a test clock: Danger Zone Reset **and** Purge refuse with the "Settings → Plan" message, write no snapshot, and audit `BUSINESS_DATA_PURGE_BLOCKED` with reason `subscription_live`. Self-delete shows the new `plan_running` line with no mailto. The admin delete preview shows R-3 with the new clearing text.
2. **Cancelling is still live:** after Cancel (status `active`, `cancel_at_period_end`), all three still refuse (BQ-2).
3. **Ended clears:** after the clock passes the end and the webhook mirrors `ended_at`, none of the three refuses for the subscription. Do not commit a deletion on the demo account.
4. **Unreadable refuses:** a Jest-level check is enough (the paths test and `ResetService.order` cover it). Do not break the live database to test it.
5. **BQ-5 sentence:** shown in the confirmation and under Reactivate only for an account with an admin-dated cohort ending later than paid-through + 24 h. It is absent at the boundary, absent for a trial cohort, absent for open-ended free access, absent with no cohort, and absent when the plan is past_due or ended or the price switch is off. Check the date in en, he and es, and RTL in he.
6. **AC-F8.3 live (demo steps 11–12):** back on Founding Partner with the pill and no "ended" banner; then grace when the cohort ends.
7. **Tenant isolation:** `GET /api/business-os/entitlements/my-plan?accountId=<other>` still answers for the session account only (the route's existing guard test). The new port has no input.
8. **G-5 wording** (he / es drafts, deviation 5's "Founding Partner" vs "שותף מייסד" / "Socio Fundador", comment 4) goes to the user, not QA.

#### Carried forward

- G-5: the user approves the he / es drafts for `plan_running` and `cancel_confirm_founding`, including how "Founding Partner" is written in them (deviation 5).
- BQ-5 is now built. It must be merged before the production price switch is turned on (P-7a.1 deviation 5 condition: met by this PR once it merges).
- C-12 for RM: merge `origin/main` (with #528 and `663aa9b9`) before the PR, never stack, then re-run the C-12 suites; `catalogueDrift.guard` must be green after the merge.
- P-7a.4: C-11 still binds.

#### Code Approved for QA: Yes (with F-3 and F-4 applied)

### SA Code Review — P-7a.4 (2026-10-27)

**Code Review by SA — 2026-10-27**
**Status:** ✅ APPROVED WITH FIXES (F-3 applied by SA, F-4 doc correction applied by SA). Worktree `neuronforge-p7a4`, branch `feature/bos-plan-payments-p7a4` from `origin/main` `89cd0d90`, uncommitted. Read on the diff, not taken from the Implementation Notes.

#### Verified

| Check | Result |
|---|---|
| Ordering | Our row read (`findByUser`, session user + server mode), `planManageOffer`, every our-data refusal, then the one fresh `retrieveBusinessOsSubscription`. C-4's four cross-checks (id, customer, mode, `bos_user_id`) run before the mode decision. Immediate path: TQ-5 pending update refused before the cancel; the cancel's answer is checked (id, customer, livemode, `canceled`) before any void or mirror; each invoice is checked (non-empty id, our customer, this subscription, our mode) before its void. A mismatched answer → `outcomeUnknown`, no sweep, no mirror (pinned) |
| Mode from Stripe (P-7a.1 binding note) | `PAYMENT_FAILED_STATUSES.includes(fresh.status) && fresh.endedAt === null` picks immediate. A `failing` row Stripe cured goes to the period-end path; a renewing row Stripe says is `past_due` ends now. Mutation (decide on `offer.kind === 'failing'`) caught |
| Call shape (TQ-12, SX-2b agreement) | `subscriptions.cancel(id, { invoice_now: false, prorate: false }, { idempotencyKey })`, no `cancellation_details`. Mutation (add `cancellation_details`) caught by `businessOsPlanCancelNow.test.ts` |
| Void scope (C-11) | `invoices.list({ subscription, status: 'open', limit: 20 })` then a per-invoice cross-check; `has_more` → `leftOpen: null` + alert, never guessed. Mutation (drop the customer check) caught |
| Idempotency keys | `bos-plan-manage:{sub}:cancel_now:{attempt}`, `bos-plan-manage:{invoice}:void:{attempt}`, one random attempt id per call (D2 shape). Pinned not to appear in any log argument, nor the attempt id |
| Engine-only methods | The three new `StripeService` methods are called only from `planSubscriptionManage.ts`. `cancelBusinessOsSubscriptionNow` / `voidBusinessOsInvoice` were in ENGINE_ONLY; the list read was not (F-3) |
| Audit | Same `BOS_BILLING_SUBSCRIPTION_CANCELLED`, severity `info` (EVENT_METADATA), via the route's existing `logAndFlush` (WC-7 pattern; failure never fails the request). `details.mode`, `endsOn`, `invoicesVoided`, `invoicesLeftOpen` (immediate only), `reasonCode`, `livemode`, `actor: 'owner'`. `unknown` audited on a lost answer; `unchanged` / `ended` not audited |
| Mirror | Existing `mirrorSubscriptionState` CAS (`{ count: 'exact' }`, keyed on user + mode + subscription id), never fails the request. The webhook's `.deleted` still records `subscription_ended`: the CAS update counts matched rows, so `mirrored` stays true after our pre-emptive mirror (read in `planSubscriptionMirror.ts`) |
| Effects claimed | Banner via `ended_at` first, invoice list "Not charged" on `void`, one money-history row from `.deleted`, admin Ended: all follow from existing readers; no code needed. Confirmed by reading, not run live (QA demo step 10) |
| Tenant isolation | Every id is from our row or from Stripe's list of that row's subscription, cross-checked; nothing from the request (body is `{ reasonCode? }`, `.strict()`). Service-role write is the existing user-scoped CAS |
| Entitlements | No new import from `lib/business-os/entitlements/`; no catalog / matrix change. `test:bos-entitlements` green |
| Logging / env / i18n | Pino only, no `console.*` added; no `process.env` read added (EC-3 unaffected). Five keys present in en / he / es; `plan.manage.payment_failed_contact` gone from all three dictionaries and all source (only a test asserting its absence names it) |

#### Deviation rulings

| # | Ruling |
|---|---|
| 1 | **Accepted: voiding + alert meets C-11 for P-7a.4. The apply-path REFUSAL as Dev drafted it is rejected; a narrower follow-up replaces it (FU-P7a4-1), and it is NOT a prerequisite for the production price switch.** Reasons: (a) X-4d/e prove C-11's first option, which is what C-11 asked for. (b) What a residual window actually costs: `applyPaidPlanInvoice` would apply the paid invoice with `subscriptionStatus: 'canceled'` and the invoice's OWN period, so the owner gets the tier only up to the paid-through date of a period they paid for. Money and access match; nothing renews; the harm is a broken "nothing left to pay" promise, not unpaid access or an unbounded tier. (c) A refusal would do worse: it would take the money and give nothing (a refund owed, by hand), and the drafted test ("`canceled` with `ended_at` before the invoice's period end") also matches a legitimate case, Stripe's own dunning end (`cancellation_details.reason = 'payment_failed'`, invoice left `open` or `uncollectible`) later paid by the owner; a period-end cancel's last invoice is not hit (its period ends at or before `ended_at`). (d) SX-2b: a refusal would also leave a paid invoice with no tier while SX-2b's free-period logic reads the end as owner-started, which makes the account state harder to reason about, not easier. **FU-P7a4-1 (webhook slice, before go-live row 13 is ideal, not blocking the switch):** on `invoice.paid` for a subscription Stripe reports ended before the invoice's period end, APPLY as today and log `error` + `alert: true` (`bos_billing_paid_after_end`) with invoice, subscription and `cancellation_details.reason`, so an operator decides honour vs refund. Alert-only, no refusal |
| 2 | **Accepted.** The end has happened at Stripe; a 502 would misreport it and invite a retry that finds `unchanged` / `ended`. `invoicesLeftOpen` > 0 or `null` in the audit plus an `error` + `alert: true` line is the right signal. Mutation (rethrow a void failure) caught by engine and route tests |
| 3 | **Accepted.** `unchanged` / `ended` is scoped to a `failing` row + Stripe `canceled` with `ended_at`; other rows keep `subscription_not_active` (P-7a.1 pins unchanged). Not re-running the sweep there is correct: a second tab's press is not the owner's first decision, and the first press already audited any leftover. Note for FU-P7a4-2: a Stripe dunning end reaching this branch leaves its open / uncollectible invoice untouched, which is Stripe's design for that path |
| 4 | **Accepted, with the doc corrected (F-4).** Stripe decides both directions, as the binding note requires. The draft's claim that a `cancelling` + `past_due` row shows Reactivate was wrong: `planManageOffer` tests the failure first, so that row is `failing`, shows Cancel, and ends now. That is the right behaviour (Stripe would otherwise retry the card until the period end, BQ-3 option C, which SA would not approve) |
| 5 | **Accepted.** Offering Cancel on a non-live status would only produce a `subscription_not_active` refusal. The narrowing is pinned in the matrix |
| 6 | **Accepted.** Same `bos-plan-manage:` namespace and attempt id as D2; suffixes keep the cancel key and each void key distinct; a second void of the same invoice is refused by Stripe ("isn't open"), never a second write. Never logged (pinned) |
| 7 | **Accepted**, as agreed in D2 |
| 8 | **Accepted, binding on the P-7a.4 PR.** Rebase / merge `origin/main` after P-7a.3 (#534) merges, hand-merge the four textual conflicts, recount the `plan.manage.*` pin (27 + P-7a.3's), and show P-7a.3's Founding Partner sentence (`freeAccessAfter`, same BQ-5 rule: only when the free-access end is after the paid-through date + 24 h) in the `plan-manage-confirm-now` group too, with one render test for it. Any new wording there goes to G-5. Re-run this review's suite list after the merge-in; SA re-reviews only the `PlanManage.tsx` merge hunk |

#### Fixes

| # | File | Fix | Applied |
|---|---|---|---|
| F-3 | `lib/business-os/billing/__tests__/oneDontRenewPath.guard.test.ts` | `listBusinessOsOpenSubscriptionInvoices` added to ENGINE_ONLY (the sweep and its cross-checks have one home), and a FORBIDDEN entry for the SDK's `invoices.voidInvoice(` in the scanned tree (the Connect `voidInvoice` in `MutateExecutor.ts` is a different call and does not match). 10 / 10; a probe file naming the list method made it fail, then was removed | ✅ SA |
| F-4 | This workplan, Deviations for SA item 4 | The `cancelling` + `past_due` sentence corrected (above) | ✅ SA |

#### Follow-ups (not blocking QA)

- **FU-P7a4-1** (deviation 1): alert-only detection of `invoice.paid` on a subscription that ended before the invoice's period end. Webhook slice; no refusal.
- **FU-P7a4-2**: the sweep lists `status: 'open'` only. Under a Stripe dunning setting that marks failed invoices **uncollectible**, such an invoice is still payable from its hosted link and is not voided. Check the live account's dunning setting before go-live row 13; if it marks uncollectible, extend the sweep to `uncollectible` (a void works on both). Same bounded consequence as deviation 1 (b).
- **FU-P7a4-3** (TL, SX-2b): X-4g shows the immediate cancel also records `cancellation_requested`, so SX-2b will treat an owner's cancel during a failed payment as owner-started (free period). If SX-2b means "failed-payment ends get none" to include this case, it needs another signal (this audit's `details.mode = 'immediate'`, or the status before the end); `cancellation_details` must stay unsent either way. TL to confirm with the deletion session.
- **FU-P7a4-4** (P-7b.2, with D2's F-2): `failing` is decided before `change_pending`, so a failing row with `pending_tier` set ends now and leaves `pending_tier` on the row. Impossible today (no writer); P-7b.2 decides clear vs refuse for both paths.

#### QA focus

1. Demo step 10 end to end on a test clock, including the old hosted "Pay now" link opened after the cancel (void, not payable) and exactly one `subscription_ended` money-history row.
2. A cured row (renewal paid after the failure, webhook delayed or replayed late): Cancel must give the period-end answer ("You keep … until …"), never "has ended".
3. Two tabs: second press → "has ended" (`unchanged` / `ended`), no second audit, no Stripe write.
4. Forced void failure and `has_more` (unit-level is enough): 200, `invoicesLeftOpen` 1 / `null`, one `error` line with `alert: true`, no key in any log.
5. Reactivate POST on a failing row → 409 with the new `plan.manage.refusal.payment_failed` copy (en / he / es).
6. he / es at 360 px: the ends-now confirmation and the payment-failed line wrap; the drafts go to G-5.

#### SA runs (sequential, after F-3)

`app/api/stripe` 22 / 581; `lib/business-os/billing` 49 / 3 768; `app/api/business-os/billing` 7 / 260; `components/business-os/settings` 51 / 952; `components/business-os/billing` 1 / 17; `lib/stripe` 10 / 103; `lib/audit` 16 / 189; `lib/admin/environment` 4 / 122; `lib/server` 11 / 148; `lib/business-os/purge` 16 / 388; `lib/repositories/__tests__` 120 / 2 896; `npm run test:bos-entitlements` 313 / 9 401. All passed. Connect snapshot md5 `ab7528ea68309cffb309ffbd46c455ab` unchanged (never `-u`). Mutations, one at a time, each restored by Edit and md5-checked: `cancellation_details` sent, mode from our row, invoice customer check dropped, void failure rethrown, `failing` wire without Cancel, UI `endsNow` forced false, list method used outside the engine: **7 / 7 caught**. ESLint on the edited guard: clean.

#### Code Approved for QA: Yes (F-3 and F-4 applied). PR only after P-7a.3 merges, with deviation 8's merge work done in it.

---

## QA Testing Report

### QA Report — P-7a.1

**QA — 2026-10-26**
**Test mode:** full (SA QA focus 2–8; focus 1 and the live half of 4 are the user's demo)
**Strategy used:** A + B (Jest: orchestration, routes, render on the REAL Settings view through `readPlanPurchaseView`) + C (a sandbox script on the standard sandbox `acct_1UPKR4C7KDUGYIcA`, test mode, the REAL `StripeService` and orchestration with a fake repository: no database at all)
**Focus:** api, ui, security, i18n
**Skipped:** the live browser walk and the admin list / audit rows (focus 1, demo); a real database CAS write (no DB in this run; the CAS method is the existing `mirrorSubscriptionState`, unchanged)
**Input source:** TL prompt + SA "For QA (focus)"

#### Results per focus item

| # | Focus item | Result | Evidence |
|---|---|---|---|
| 1 | Live sandbox walk (UI → admin Cancelling / Active, one audit each, none for `unchanged`) | ⚠️ **Owed (demo)** | Logic covered by the sandbox script and route tests (audit only on a write, flushed before the response; `unchanged` not audited) |
| 2 | Second tab / double press | ✅ PASS | Sandbox: second cancel → `unchanged` / `cancelling` with the date, **0** writes, **0** mirrors, no audit facts. QA Jest (stateful fake): cancel ×2 → one write, one mirror, audit facts only on the first; cancel → reactivate → cancel → reactivate → four writes (no idempotency replay, TQ-3). UI: two clicks on "Yes, cancel" (and on Reactivate) before the answer → **one** POST; buttons hidden while busy. F-1 line on `unchanged`: SA's render tests pass |
| 3 | Stale-row heal | ✅ PASS | Sandbox, both directions: row flag `true` + Stripe renewing → reactivate = `unchanged` + one heal mirror (`false`), no Stripe write; row flag `false` + Stripe cancelling → cancel = `unchanged` + heal (`true`). QA Jest: status-only disagreement (row `trialing`, Stripe `active`) heals the status; after a heal the other action writes normally. No audit on any heal |
| 4 | Dashboard `cancel_at` only | ✅ PASS (logic) / ⚠️ live admin half owed | Sandbox: `cancel_at: 'max_period_end'` → `retrieveBusinessOsSubscription` maps `cancelAt`, flag `false`; app cancel → `unchanged` / `cancelling`, date = `cancel_at`, no write, no heal (known C-3 follow-up); app reactivate → one write, Stripe `cancel_at` cleared. QA Jest: date is `cancel_at`, not the period end, when they differ. **See Edge case E-1** (UI cannot reach Reactivate in this state) |
| 5 | Settings pop-up strip vs drawer-stacked modal | ✅ PASS | QA render on real payloads: `your_plan` strip shows Cancel; the `status` strip (drawer-stacked) shows **no** manage controls; opening an upgrade flow hides Cancel, "Back to plans" brings it back; trial / no billing row → nothing in either strip. Mutation (removing `openFlow === null &&`) caught by 1 test; file restored byte-identical (md5 verified) |
| 6 | Failed payment; switch off | ✅ PASS | Real view: `past_due`, `unpaid`, and `active` with `failed_attempts > 0` → `paymentFailed`, the contact line, no button. Price switch off (renewing, cancelling, past_due rows) → no `manage` on the wire, nothing rendered. Route: switch off → 404 with nothing read (existing route test, re-run) |
| 7 | Hebrew (RTL) and Spanish at 360 px | ✅ PASS (structural) / ⚠️ visual owed | 21 `plan.manage.*` keys in en / he / es, every key used, none unused, placeholders identical per key (QA test). he in a `dir="rtl"`, 360 px container and es: confirmation, done line and contact line render with no unfilled `{plan}` / `{date}`; no physical-direction class (`ml-/mr-/pl-/pr-/left-/right-/text-left/right`) anywhere in the island; the button row is `flex-wrap`. jsdom has no layout: actual wrapping at 360 px is a demo check. he / es remain drafts for the user's G-5 pass |
| 8 | Pending upgrade | ✅ PASS | Sandbox not repeated (X-3 by Dev). Existing tests: 409 `upgrade_pending` with `retryAfter`, no write. QA render in en / he / es: the dictionary line, never the server English, no "done" line, host re-reads once |
| — | TL decision, deviation 6 | ✅ Recorded | §2.1, §5 row, §11 key row and Implementation Notes deviation 6 updated; QA test pins: cancelling → no upgrade offer, no "Reactivate your plan to upgrade" text, no such key |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none (no new read on the drawer open; the write's own answer is mirrored, no second retrieve — confirmed against the real Stripe response in the sandbox).

**Edge cases (nice to fix / record):**

1. **E-1 — `cancel_at`-only cancellation: the screen never offers Reactivate** (Low; part of the known C-3 / X-2 webhook follow-up, not a P-7a.1 defect). Our row keeps `cancel_at_period_end = false`, so `manage` = Cancel. Pressing it answers `unchanged` and (F-1) reads "Cancelled. You keep {plan} until {date}." — accurate — but the Cancel button stays and Reactivate is not reachable from the UI; the heal does not help because it copies only the flag (both `false`). The reactivate **route** does clear it (sandbox). Add to the C-3 follow-up: when the webhook mirrors `cancel_at` as cancelling, this resolves.
2. **E-2 — he drafts** "מבטל…" / "מחדש…" are masculine-singular present; and `refusal.not_active` says "המינוי" (SA note). For the G-5 pass, not a defect.

#### Test Outputs / Counts

| Run | Result |
|---|---|
| Requested set `app/api/stripe lib/business-os/purge lib/business-os/billing app/api/business-os/billing components/business-os/settings components/business-os/billing lib/stripe lib/audit` (`--ci`) | **152 suites, 5 937 tests, all passed** (before the QA files) |
| `npm run test:bos-entitlements` | **306 suites, 9 227 tests, all passed** |
| QA files (new, uncommitted): `components/business-os/settings/__tests__/PlanManage.p7a1.qa.render.test.tsx` (17, plus the imported `upgradeModalPayloads` self-check), `lib/business-os/billing/__tests__/planSubscriptionManage.p7a1.qa.test.ts` (6) | **2 suites, 24 tests, all passed**; ESLint clean |
| Sandbox script (scratchpad, not in the repo) | **16 / 16 passed**. Throwaway `cus_VVoeMq6kMuJlBr` / `sub_1UUn1eC7KDUGYIcADxslB5e8` (basic price by lookup key), subscription cancelled and customer deleted the same run; account id asserted before any write; `cus_VQf9jX6fnfVlkK` not touched; key never printed; no database |
| Connect harness snapshot md5 | `acdad2efd4d646e687e507a3dd0b01e9` before and after; never `-u` |
| CRLF | The touched source scans passed on this Windows checkout; the one file QA mutated (`UpgradeModal.tsx`) was restored to its original CRLF bytes (md5 verified) |

#### Owed demo steps (user, sandbox test mode, both switches on locally)

1. Renewing → Cancel → confirm → "Cancelled … until {date}"; drawer line "Ends on", Reactivate shown; admin Subscriptions list **Cancelling**; one audit `BOS_BILLING_SUBSCRIPTION_CANCELLED` (`actor: owner`, `info`).
2. Reactivate → "Your plan will renew on {date}"; admin **Active**; one audit `…_REACTIVATED`.
3. Second tab: Cancel again → the F-1 line, no second audit entry.
4. Stripe dashboard "cancel at" without the flag → app shows Cancel (E-1), pressing it shows the F-1 line with the date; admin list still **Active** (known follow-up).
5. Settings pop-up "Your plan" strip: Cancel / Reactivate present with no flow open, gone during a flow; the drawer-stacked modal shows none.
6. Switch Hebrew and Spanish at 360 px width: confirmation, done and refusal lines wrap cleanly in RTL.

#### Final Status

- [x] All acceptance criteria in QA scope pass — ready for commit (after the user's diff view; demo steps above owed)
- [ ] Issues found — Dev must address before commit

### QA Report — P-7a.2

**QA — 2026-10-27**
**Test mode:** full (SA "For QA (focus)" 1–10; the live browser walk in the app is the user's demo)
**Strategy used:** A + B (Jest: the REAL routes and orchestration with fakes at the edges; render on the REAL Settings view through `readPlanPurchaseView`) + C (a scratch sandbox script on the standard sandbox `acct_1UPKR4C7KDUGYIcA`, test mode: the REAL `StripeService` and the REAL orchestration over a fake repository, with Stripe's portal page driven in headless Chrome over the DevTools protocol; nothing added to the repo; no database at all)
**Focus:** api, ui, security, i18n
**Skipped:** the in-app browser walk (Settings → Plan with the dev server, the banner clearing through the webhook): user's demo. No production database touched
**Input source:** TL prompt + SA "For QA (focus)"

#### Results per focus item

| # | Focus item | Result | Evidence |
|---|---|---|---|
| 1 | Update card → card form → straight back; Stripe's state after (X-1) | ✅ PASS (Stripe side) / ⚠️ in-app click owed (demo) | Sandbox: Checkout-shaped subscription (card on the **subscription**, customer default empty). `openPlanBillingPortal` (`update_card`, `en`) returned a `billing.stripe.com` session; headless Chrome landed on the **card form** directly (inputs `number`, `expiry`, `cvc`), `5555…4444` added, **Add**, and the next top-level document was `localhost:3000/business-os/settings?section=plan`. Afterwards: subscription `default_payment_method` = **null**, customer invoice default = **Mastercard 4444** |
| 2 | Checkout switch off / price switch off | ✅ PASS | Routes, all four switch combinations: prices off → **404** on both routes with `no-store` and nothing read (no session, no row, no Stripe); prices on + checkout off → **200** on both. Real view: prices off → no `manage` at all, no button; checkout off + prices on → `{ cancel, cardAndInvoices: true }`, both buttons render |
| 3 | Invoice list | ✅ PASS | Render: open → exactly **one** `GET` (bare path, `cache: 'no-store'`), close → none, open again → two; the toggle is disabled while loading (double click = one `GET`); a voided `subscription_update` row reads "Plan change" and "$41.00 · Not charged", no "fail"; link `target="_blank"`, `rel="noopener noreferrer"`, "View invoice and receipt"; 12 rows + `hasMore` → **See all in Stripe** posts `{ intent: 'invoices', locale }`. Route: Stripe asked for exactly `limit 12`, one page; no PDF URL on the wire; a non-Stripe hosted link withheld. Sandbox: 12 extra invoices on the customer → `hasMore: true`, drafts dropped, void rows present, every link `invoice.stripe.com`; the first plan invoice maps to "Plan started · Essentials · Paid · 7900". **See E-1** (drafts take slots) |
| 4 | Failed renewal (X-1b) | ✅ PASS (Stripe side + UI) / ⚠️ banner clear owed (demo) | Sandbox test clock: renewal on `pm_card_chargeCustomerFail` → subscription `past_due`, renewal invoice `open`, `attempt_count` 1; our list shows it as `subscription_cycle` / `open` ("Monthly renewal · Due") with an `invoice.stripe.com` link. Card changed in the portal (`he` → `auto`), redirected back. About 4 s later: invoice still `open`, `attempt_count` 1 (**not retried at once — expected, deviation 9**). Paying the Due invoice → `paid`, subscription `active`. Real view render (`past_due`, and `active` with failed attempts): "use the link in Stripe's email" gone (billing state asserted `payment_failed`, so not vacuous), the manage line and **Update card** shown. The `invoice.paid` → banner clear needs the webhook and a database: demo |
| 5 | No paid plan / abandoned checkout / ended | ✅ PASS | Real view: customer without a subscription id → no `cardAndInvoices`, nothing rendered; ended (`canceled`, `endedAt`) → `manage` = `{ cancel: false, reactivate: false, paymentFailed: false, cardAndInvoices: true }`, the only buttons are Update card and Show invoices, an old receipt lists. Routes: abandoned → **409** `no_billing_account` on both, zero Stripe calls; a row whose own `livemode` differs from the key → 409, zero Stripe calls |
| 6 | Injection | ✅ PASS | POST: `customerId`, `configuration`, `flow_data`, `locale: 'he-IL'`, an array intent, a `null` body, a string body, a raw `"__proto__"` key → **400**, nothing read. GET: `?customerId=cus_x`, `?customerId=` (empty), `?userId=`, `?limit=`, `?starting_after=` → **400** with `no-store`, nothing read |
| 7 | Configuration faults | ✅ PASS | Unset, `pc_123`, whitespace only, `bpc_abc/def` → **503** `portal_unavailable`, the owner's "not available right now" line (also checked in the UI: the dictionary line, never server English), an `error` log `bos_billing_portal_configuration_missing` with `alert: true`, **no** Stripe call (no retrieve, no session: never the default configuration). A failed retrieve → `…_unreadable` with `alert: true`; a retrieve answering another id → mismatch, no session. The invoice list does not depend on the configuration |
| 8 | No Stripe link in logs | ✅ PASS | Route walk over every path (both intents × 4 locales, a session for another customer, Stripe errors whose **message holds the portal URL / invoice URL**, an invoice list with other-customer / EUR / draft rows): **0** log lines with `billing|invoice|pay|checkout.stripe.com`; the responses carry none either; the drop alert names ids and reasons only. Sandbox: the whole run's stdout (StripeService's own Pino output included) and the orchestration log: **0** full Stripe URLs |
| 9 | Hebrew (RTL) and Spanish at 360 px | ✅ PASS (structural) / ⚠️ visual owed | 19 keys in en / he / es, non-empty, none equal to English, every he value Hebrew script. Render in a `dir="rtl"` 360 px container and in es: rows read the drafts, a credit renders `-$5.00` inside `<bdi>`, no raw key and no English word in the island, the button row is `flex-wrap`, no physical-direction class in `PlanCardAndInvoices.tsx`; the POST sends `locale: 'he'` / `'es'`. Sandbox: Stripe's portal opened for `es` at `lang="es-ES"` ("Volver a …", "Condiciones"); for `he` (sent as `auto`) at `en-US` in headless Chrome. he / es remain **drafts** for the user's G-5 pass |
| 10 | Script | ✅ PASS | Sandbox dry run: "OK configuration `bpc_1UUv5MC7KDUGYIcA3O6iIzRJ` matches" + the DEFAULT NOTE + the env line, exit 0 (same with `--return-origin http://localhost:3000`). Refused before any write: wrong `--expect-account` (names the real account), `--live` with a test key ("accepts only sk_live, rk_live keys", exit 2), `--env` inside the checkout, no `--expect-account`. The key never printed |
| — | SA note: `PlanUpgrade.render.test.tsx` under load | ✅ Load-only | Passed inside the full parallel run this time (170 / 170 suites) and alone (76 / 76, 51 s). Not in the diff |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none (the list loads only on open, one Stripe page; no new read on the drawer open).

**Edge cases (nice to fix / record):**

1. **E-1 — drafts use slots of the 12** (Low). The route asks Stripe for 12 and drops drafts afterwards, so while a renewal draft exists (about an hour each cycle) the owner sees 11 rows; in the sandbox, 4 drafts among 12 gave 8 rows with "See all in Stripe". Harmless; if wanted later, ask Stripe for 13 or filter by status. Not a P-7a.2 blocker.
2. **E-2 — plan label is always the English label** (Low). `labelForPriceId` reads `TIER_MATRIX.presentation[tier].labels.en`; today en / he / es labels are identical ("Essentials", "Autopilot"), so nothing shows wrong. If the labels are ever localised, the invoice rows will not follow.
3. **E-3 — the Hebrew portal opens in the browser's language** (expected, X-5). Stripe has no Hebrew portal, so `auto` showed English in headless Chrome; a Hebrew-browser owner gets Stripe's fallback. Record for the G-5 pass, not a defect.
4. The `invoices/__tests__/` empty directory (SA comment 4) is still there; harmless.

#### Test Outputs / Counts

| Run | Result |
|---|---|
| Requested set `app/api/stripe lib/business-os/billing app/api/business-os/billing components/business-os/settings components/business-os/billing lib/stripe lib/audit lib/business-os/purge scripts/__tests__` (`--ci`, before the QA files) | **170 suites, 6 544 tests, all passed** (PlanUpgrade.render included) |
| `npm run test:bos-entitlements` | **308 suites, 9 270 tests, all passed** |
| QA files (new, uncommitted): `app/api/business-os/billing/plan/portal/__tests__/route.p7a2.qa.test.ts` (31), `components/business-os/settings/__tests__/PlanCardAndInvoices.p7a2.qa.render.test.tsx` (14) | **2 suites, 45 tests, all passed**; ESLint clean; `tsc --noEmit` (8 GB heap, no OOM): **0 errors** in the touched and QA files (1 864 pre-existing elsewhere, same as Dev's count) |
| Sandbox script (scratchpad, not in the repo) | **20 / 20 passed**. Throwaway `cus_VVzUK4IEc4bdLL` (focus 1, 3, 9), `cus_VVzVAiE6NMPXgx` on test clock `clock_1UUxWwC7KDUGYIcAuiOSRE4m` (focus 4): subscriptions cancelled, customers and clock **deleted**; two earlier aborted runs' customers (`cus_VVzGZYiIlScWn0`, `cus_VVzIeM8AqjBDKZ`) deleted in their own `finally`. A final listing found **0** QA customers and **0** QA clocks left. Account id asserted first; `cus_VQf9jX6fnfVlkK` not touched; key never printed; dummy Supabase URL (127.0.0.1:9), no database |
| Connect harness snapshot md5 | `ab7528ea68309cffb309ffbd46c455ab` before and after; never `-u` |
| CRLF | The new files are CRLF in this Windows checkout (`core.autocrlf=true`); every source scan in the requested set passed on them |

#### Owed demo steps (user, sandbox test mode, price switch on locally, `STRIPE_BOS_PORTAL_CONFIGURATION_ID=bpc_1UUv5MC7KDUGYIcA3O6iIzRJ`)

1. Paying owner → Settings → Plan → **Update card**: Stripe opens on the card form; add `5555 5555 5555 4444`; you come straight back to Settings → Plan.
2. **Show invoices**: DevTools shows one `GET` per open; rows show date, reason, plan, USD amount, status; **View invoice and receipt** opens `invoice.stripe.com` in a new tab.
3. Failed renewal (test clock, `past_due`): the "Stripe email" line is replaced by Update card; after a card update the banner **stays** (expected, X-1b); pay the **Due** row's hosted page → the banner clears through `invoice.paid`.
4. Checkout switch off: both buttons still there. Price switch off: no buttons, both routes 404.
5. Unset `STRIPE_BOS_PORTAL_CONFIGURATION_ID`, press Update card: "not available right now"; the server log has an `error` line with `alert: true`. Grep the dev-server output of the whole walk for `billing.stripe.com` / `invoice.stripe.com`: no hits.
6. Hebrew and Spanish at 360 px: buttons and rows wrap; a credit (if any) reads `-$5.00` in RTL; the Spanish portal opens in Spanish. Settle the he / es drafts and FU-P7a2-1 ("Pay now" on a Due row) in the G-5 pass.

#### Final Status

- [x] All acceptance criteria in QA scope pass — ready for commit (after the user's diff view; demo steps above owed)
- [ ] Issues found — Dev must address before commit

### QA Report — P-7a.3

**QA — 2026-10-27**
**Test mode:** full (SA "For QA (focus)" 1–7; focus 8 is the user's G-5 pass)
**Strategy used:** A + B (Jest: the REAL commit route → REAL `ResetService` → REAL `ResetGuard` with only repositories, auth, purge authz and audit faked; render on the real `PlanManage` and `DeleteAccountDrawer` with the real dictionaries) + C (a scratch sandbox script on the standard sandbox `acct_1UPKR4C7KDUGYIcA`, test mode: the REAL `StripeService` and the REAL `mirrorPlanSubscription` over a fake repository, a throwaway customer on a throwaway test clock; nothing added to the repo; no database at all)
**Focus:** api, ui, security, i18n
**Skipped:** the database halves of focus 1, 3 and 6 (the audit row in the table, the webhook writing our row, the live Settings and admin screens): the user's demo. No production database touched; no database at all
**Input source:** TL prompt + SA "For QA (focus)"

#### Results per focus item

| # | Focus item | Result | Evidence |
|---|---|---|---|
| 1 | Control 3 on all three paths | ✅ PASS (code + copy) / ⚠️ live walk owed (demo) | QA scratch route test, **Reset and Purge** through `POST /api/business-os/purge/commit`: renewing (test), cancelling (test), cancelling (live mode), `past_due`, `trialing` → 200, `data` = `refused` / `subscription_live`, message exactly "This business has a live plan subscription. Cancel it in Settings → Plan, and reset once it has ended.", `snapshotWritten: false`, `rowsDeleted: 0`; no Connect read, no snapshot, no `executePurge`; exactly one audit `BUSINESS_DATA_PURGE_BLOCKED`, `severity: warning`, `details.reason: subscription_live`, `details.level` = the level. Billing read for the **session** user only, both modes (a `userId` in body or query not honoured). The Danger Zone prints the server's `message` as is (`PurgeDangerZone.tsx`, no client map). Self-delete: QA render in en / he / es: the dictionary `plan_running` line, **no mailto on it**, no `{support}` slot in any language, `dir="rtl"` in he; beside a `contact_support` blocker exactly one mailto. `DangerZonePanel` fallback = the en dictionary byte for byte. `blockerCopy` maps G-6 → `plan_running` (unchanged). Admin: `R3_CLEARING` names Settings → Plan and the Stripe dashboard, no "arrives with P-7a" |
| 2 | Cancelling is still live (BQ-2) | ✅ PASS | **Sandbox:** real `setBusinessOsCancelAtPeriodEnd(sub, true)` → Stripe `status: active`, `cancelAtPeriodEnd: true`, `endedAt: null`; the cancel's own `customer.subscription.updated` through the real mirror wrote `active` / `true` / `null`; that row → `isPlanSubscriptionLive` true, R-3 **applies** with the Settings → Plan clearing. Jest: the same row refuses on the Reset **and** Purge route (focus 1 row), and the paths suite's row matrix covers G-6 = the same predicate |
| 3 | Ended clears | ✅ PASS (Stripe side + our mapping) / ⚠️ DB half owed (demo) | **Sandbox:** test clock advanced to period end + 25 h → `retrieveBusinessOsSubscription` `canceled`, `endedAt` = the period end (to the second); Stripe sent `customer.subscription.deleted`; the real mirror on that event wrote `canceled` + `endedAtIso` `2026-11-27T10:40:45.000Z` and one `subscription_ended` history row; that row → `isPlanSubscriptionLive` false, R-3 **clear**. Jest route: the ended row passes control 3 and reaches control 1 (a faked Connect account then refuses `stripe_connected`; nothing deleted), billing read strictly before the Connect read. No deletion committed anywhere |
| 4 | Unreadable refuses | ✅ PASS (Jest only, as ruled) | Route: billing read error → `subscription_unreadable`, no Connect read. Dev's paths suite and `ResetService.order` re-run green; SA mutation M1 recorded |
| 5 | BQ-5 sentence | ✅ PASS | Server rule (Dev suites re-run): boundary paid-through + 24 h exclusive, timed cohort, open-ended free access, no cohort, unknown cohort → none; `past_due`, ended, price switch off → the port is not even called. QA render, en / he / es (he inside `dir="rtl"`, 360 px): in the confirmation the sentence comes **after** "You keep {plan} until {date}"; beside Reactivate while ending; the date is the account-day format: "March 1, 2100" / "1 במרץ 2100" / "1 de marzo de 2100"; exactly one `{freeUntil}` slot per language, no raw key or slot rendered; follows the account clock like "Ends on" (Jerusalem: 23:00 UTC reads the next day); a stray field beside a failed payment or an unreadable date renders nothing; no physical-direction class on the new line |
| 6 | AC-F8.3 live (demo 11–12) | ✅ PASS (logic, Dev's walk re-run) / ⚠️ live owed (demo) | `acF83.foundingPartnerCancel` (8) green in the entitlements set. The webhook + database walk is the user's demo |
| 7 | Tenant isolation, my-plan | ✅ PASS | Route suite re-run (40 / 40): `?accountId=<other>` → the port asked for the session account only; nothing to cancel → not asked. The port takes no input |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none (the BQ-5 read is a cache hit after `getSnapshot`; control 3 is two indexed reads before the Connect resolver).

**Edge cases (nice to fix / record):**

1. **E-1 — the pre-purchase line overstates for a dated Founding Partner** (Low; P-4.2 copy, not this slice). Before buying, `plan.choose.free_access_ends_today` says "Buying ends your free access today…", yet AC-F8.3 (pinned here) returns them to Founding Partner when the paid plan lapses, and the new BQ-5 sentence says so after cancelling. The same owner reads both. For the G-5 pass or P-11. **Open as FU-P7a3-1** (2026-10-27): put to the user with G-5, not answered; the line is unchanged.
2. **E-2 — "Founding Partner" stays English in he / es** (SA deviation 5; G-5). **Decided by the user 2026-10-27:** keep it in English.

#### Test Outputs / Counts

| Run | Result |
|---|---|
| Requested sets, one at a time, `--ci`, before the QA files | `app/api/stripe` 22 / 581 · `lib/business-os/purge` 17 / 518 · `lib/business-os/billing` 45 / 3 716 · `app/api/business-os/billing` 5 / 206 · `components/business-os/settings` 49 / 945 · `components/business-os/billing` 1 / 17 · `components/business-os/purge` 10 / 108 · `app/admin` 188 / 5 823 · `lib/audit` 16 / 189 · `app/api/business-os/entitlements` 1 / 40: **all pass**. `lib/admin` 35 suites / 1 247 tests: **1 expected failure**, `catalogueDrift.guard` G3-1f ("`portalConfiguration.ts` whole-object, found 1, pinned 0"), fixed on `main` by `663aa9b9`. `lib/business-os/entitlements` 49 / 1 401: all pass once the QA scratch file was removed (it tripped `tierLiteral.forbidden`, see below) |
| `npm run test:bos-entitlements` (final, scratch removed) | **314 suites, 9 424 tests, all passed** |
| QA scratch run note | The route scratch file existed during the first `lib/business-os/entitlements` and `test:bos-entitlements` runs and tripped two guards **by design**: `tierLiteral.forbidden` (a tier literal in its fixture) and the billing-repository caller guard (it fakes the repository by name). Both green after removing it (2 suites, 133 tests). Not a product finding |
| QA files | **Kept** (uncommitted): `components/business-os/settings/__tests__/PlanManage.p7a3.qa.render.test.tsx` (14), `components/business-os/account-deletion/__tests__/DeleteAccountDrawer.p7a3.qa.render.test.tsx` (6). **Scratch, deleted after the run:** `app/api/business-os/purge/commit/__tests__/zz.p7a3.qa.scratch.test.ts` (17). **3 suites, 37 tests, all passed**; ESLint clean on the kept files; `components/business-os/settings` + `account-deletion` re-run with them: 53 / 996, all pass |
| Sandbox script (scratchpad, not in the repo) | **17 / 17 passed.** Throwaway `cus_VWA8hLA7vxHpav` / `sub_1UV7oBC7KDUGYIcAIlzaGz6y` on clock `clock_1UV7o9C7KDUGYIcAtTDPfF27` (basic price by lookup key): customer and clock **deleted** the same run; a final listing found **0** QA clocks left. Account id asserted first; `cus_VQf9jX6fnfVlkK` not touched; key never printed; no database |
| Connect harness snapshot md5 | `ab7528ea68309cffb309ffbd46c455ab` before and after; never `-u` |
| CRLF | Working copies are LF (`core.autocrlf` will convert on commit); every source scan in the sets passed |

#### Owed demo steps (user, sandbox test mode, local `npm run dev` on this branch; workplan demo checklist P-7a.3)

1. Steps 1–4: buy Essentials; Danger Zone Reset **and** Purge refuse with the Settings → Plan message; check the audit table for one `BUSINESS_DATA_PURGE_BLOCKED` with `reason: subscription_live` per attempt and no snapshot in storage; self-delete shows the new line with no mailto; admin delete preview shows R-3 with the new clearing text.
2. Step 5: Cancel, then steps 2–4 again: all three still refuse.
3. Steps 6–8: advance the clock past the period end + 25 h; the webhook writes `canceled` + `ended_at` to our row; none of the three refuses for the subscription (stop at the confirmation, **never commit**).
4. Steps 9–12: Founding Partner variant: the sentence in the confirmation and under Reactivate (and absent for an end date inside the 24 h margin); after the clock passes, the pill and no "ended" banner; past the Founding Partner end, grace and the banner.
5. Hebrew and Spanish at 360 px: the founding sentence and the `plan_running` line wrap cleanly in RTL. G-5: the he / es drafts and "Founding Partner" vs "שותף מייסד" / "Socio Fundador".

#### Final Status

- [x] All acceptance criteria in QA scope pass — ready for commit (after the user's diff view; demo steps above owed; `catalogueDrift.guard` must be green after RM merges `main`)
- [ ] Issues found — Dev must address before commit

### QA Report — P-7a.4

**QA — 2026-10-27**
**Test mode:** full (SA "QA focus" 1–6; the database-side halves of focus 1 are the user's demo)
**Strategy used:** A + B (Jest: the REAL cancel and reactivate routes and the REAL engine over a STATEFUL fake repository whose mirror writes back into the row the next request reads; render on the REAL Settings view through `payloadFor` / `readPlanPurchaseView`) + C (a scratch script on the standard sandbox `acct_1UPKR4C7KDUGYIcA`, test mode, on a test clock: the REAL `managePlanSubscription` and the REAL `StripeService` over a fake repository; no database at all)
**Focus:** api, ui, security, i18n
**Skipped:** the database-side effects (one `subscription_ended` money-history row from `.deleted`, the banner switch, the admin list "Ended") and the hosted page's look after the void: user's demo. No production database touched
**Input source:** TL prompt + SA "QA focus"

#### Results per focus item

| # | Focus item | Result | Evidence |
|---|---|---|---|
| 1 | End to end on a test clock: failing renewal → Cancel "ends now" → canceled, `cancellation_requested`, renewal invoice VOID, old "Pay now" refuses | ✅ PASS (Stripe side + engine) / ⚠️ DB half owed (demo) | Sandbox, 22 / 22. Two throwaway customers on clock `clock_1UVATvC7KDUGYIcAn2X94ywG` on `bos_plan_basic_monthly_usd`, card swapped to `pm_card_chargeCustomerFail`, clock past period end + 1 day: both `past_due`, A has one `open` renewal invoice with a hosted link. Engine on A (row `past_due`, `failed_attempts` 1): `cancelled` / `mode: 'immediate'`, audit facts `mode: immediate`, `invoicesVoided` 1, `invoicesLeftOpen` 0, one mirror `canceled` + `endedAtIso`. Stripe after: `canceled`, `ended_at` set, **`cancellation_details.reason = 'cancellation_requested'`**, comment / feedback null; the renewal invoice **`void`**; paying it with a good card → refused **"Voided invoices cannot be paid."** (the hosted link's own payment path); the hosted URL still opens (HTTP 200, Stripe's invoice page). Engine log lines: no idempotency key, no `sk_`, no hosted URL, no alert |
| 2 | A cured row (renewal paid, webhook late or replayed) → period-end answer, never "has ended" | ✅ PASS | Route (QA): row `past_due` / `unpaid` / `active` + `failed_attempts` with Stripe `active`, and row `past_due` with Stripe `trialing` → 200 `{ outcome: 'cancelled', endsOn: <period end> }` with **no `mode`**, exactly one Stripe write (`update:true`), no immediate end, no list, no void, audit `mode: period_end`, row healed to Stripe's status. Replayed press (Stripe `active` + already cancelling) → `unchanged` / `cancelling` with the date, nothing written, not audited, row healed. Sandbox: B cured by paying its Due invoice, row still `past_due` → period-end cancel; Stripe B `active`, `cancel_at_period_end` true, not ended. Render (real view): both answers read "Cancelled. You keep {plan} until {date}", never `ended_now` |
| 3 | Two tabs: second press → "has ended", no second audit, no Stripe write | ⚠️ PARTIAL — invariants PASS, wording differs (**E-1**) | Route (stateful) and sandbox agree. Tab B while our row still lags (mirror not landed) → 200 `unchanged` / `ended`, one Stripe read only, no audit; the screen reads "has ended". **Tab B after our mirror landed (the usual case) → 409 `subscription_not_active` from our row, no Stripe call at all, no audit; the screen reads "Your subscription is not active right now."**, not "has ended". No second write and no second audit in either case. UI: a double press on "Yes, end it now" posts once |
| 4 | Forced void failure and `has_more` | ✅ PASS | Route (QA), each case → 200 `cancelled` / `immediate`, mirror ran, exactly **one** `error` line with `alert: true` (`bos_billing_cancel_now_invoice_left_open`) and no other alert: void throws → voided 0 / leftOpen 1; void answers not `void` → 0 / 1; list throws → 0 / `null`; `has_more` → 1 / `null`; another customer's invoice → 0 / 1 (not voided). No idempotency key, no attempt id, no `bos-plan-manage:` in any log line, the response or the audit details. Keys per attempt: two presses → two distinct `cancel_now` keys, all keys match `bos-plan-manage:{id}:(cancel_now|void):{uuid}` |
| 5 | Reactivate POST on a failing row → 409, new copy en / he / es | ✅ PASS | Route: failing row → 409 `payment_failed_contact_us`, read our row only (no Stripe call), not audited; a stale cancelling row with a failure count is `failing` (failure first) → same 409, no Stripe call; a cancelling row with no failure recorded while Stripe says `past_due` → 409 after the one fresh read, nothing written. Render: a stale cancelling payload (Reactivate shown) answered 409 reads `plan.manage.refusal.payment_failed` in en / he / es; "contact us to cancel" (the server English) never shown. See **E-2** |
| 6 | he / es at 360 px; five keys complete; `payment_failed_contact` gone | ✅ PASS (structural) / ⚠️ visual owed | The five keys present and non-empty in en / he / es, placeholders as en, he in Hebrew script, es not equal to en. Render in a 360 px `dir="rtl"` (he) and `ltr` (es) container: the payment-failed line, the ends-now confirmation (plan filled, no date) and the "has ended" line render in full; the button row is `flex-wrap`; no physical-direction, `whitespace-nowrap`, `truncate` or fixed-width class in the island; no raw key or unfilled placeholder. `plan.manage.payment_failed_contact`: absent from all three dictionaries and from every non-test source file under `app`, `components`, `lib`, `hooks`, `types` (scan). Real view: `past_due`, `unpaid`, `active` + failures, cancelling + `past_due` → `{ cancel, paymentFailed }`, no Reactivate, the ends-now confirmation; a failure count on an ended row → no Cancel (deviation 5). he / es remain **drafts** for G-5 |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none (the immediate path adds one list and one void per open invoice, only on the press).

**Edge cases (nice to fix / record):**

1. **E-1 — the second tab reads "not active", not "has ended"** (Low; SA / TL to rule). `unchanged` / `ended` is reached only while our row still says `failing` (Implementation Notes deviation 3). Once the first press's mirror (or the `.deleted` webhook) has written `canceled` + `ended_at`, `planManageOffer` answers `none` / `not_active` and the route refuses 409 `subscription_not_active` before any Stripe call; the stale tab then shows "Your subscription is not active right now." It is true, safe (no write, no audit) and cheaper, but it does not match QA focus 3's expected "has ended". Fix if wanted: on a cancel, a row with `ended_at` set could answer `unchanged` / `ended` with our row's `ended_at`, no Stripe call. Pinned as-is by `route.p7a4.qa.test.ts` and `PlanManage.p7a4.qa.render.test.tsx` so a change is visible.
2. **E-2 — the server English for `payment_failed_contact_us` is stale** (Low). `PLAN_MANAGE_REFUSALS.payment_failed_contact_us.message` still says "Your payment failed. Update your card, or contact us to cancel." After BQ-3 = A the owner can cancel. The screen never shows it (dictionary key by code), but API clients and logs read it. Suggest "Your payment failed. Update your card first, or cancel your plan." (the en dictionary line); the code name may stay.
3. **E-3 — the hosted page after the void** (demo). The API refusal of payment on the voided invoice was proved; how Stripe's hosted page looks (no "Pay" button, "void") was not checked in a browser. Demo step 4.

#### Test Outputs / Counts

| Run | Result |
|---|---|
| QA files (new, uncommitted): `app/api/business-os/billing/plan/cancel/__tests__/route.p7a4.qa.test.ts` (17), `components/business-os/settings/__tests__/PlanManage.p7a4.qa.render.test.tsx` (17 + the imported `upgradeModalPayloads` self-check = 18) | **2 suites, 35 tests, all passed**; ESLint clean; `tsc --noEmit` (8 GB heap, completed, no OOM): **0 errors** in the QA files (1 849 pre-existing elsewhere, Dev's count) |
| Repository caller guard | `route.p7a4.qa.test.ts` registered in `BusinessOsBillingAccountRepository.test.ts` ALLOWED (sorted, before `route.p7a4.test.ts`); guard passes |
| Requested set, run one after another (`--ci`, QA files included) | `app/api/stripe` 22 / 581; `lib/business-os/billing` 49 / 3 768; `app/api/business-os/billing` 8 / 277; `components/business-os/settings` 52 / 970; `components/business-os/billing` 1 / 17; `lib/stripe` 10 / 103; `lib/audit` 16 / 189; `lib/admin/environment` 4 / 122; `lib/server` 11 / 148; `lib/business-os/purge` 16 / 388; `lib/repositories/__tests__` 120 / 2 896: **all passed** |
| `npm run test:bos-entitlements` | **313 suites, 9 401 tests, all passed** |
| Connect harness snapshot md5 | `ab7528ea68309cffb309ffbd46c455ab` (unchanged, unmodified in git); never `-u` |
| Sandbox script (scratchpad, not in the repo) | **22 / 22 passed**. Clock `clock_1UVATvC7KDUGYIcAn2X94ywG`; A `cus_VWCt1t1xWeSvbq` / `sub_1UVATxC7KDUGYIcA2iFhLfMO` (ends now), B `cus_VWCtdFdAwrvS0h` / `sub_1UVAU1C7KDUGYIcA5OoxaDyp` (cured). Both customers **deleted** (`deleted: true` on retrieve) and the clock **deleted** (`resource_missing`) in the same run; 0 QA clocks left. Account id asserted first; `cus_VQf9jX6fnfVlkK` not touched; key read from the env file, never printed (0 key matches in the run's output); dummy Supabase URL (127.0.0.1:9), no database |
| CRLF | The new files are CRLF in this checkout; every source scan in the requested set passed |

#### Owed demo steps (user, sandbox test mode, price switch on locally, a test-clock owner with a failing renewal)

1. Settings → Plan shows "Your payment failed. Update your card to keep your plan, or cancel it to end it now." and **Cancel plan**; the confirmation says the plan **ends now**, names no date; "Yes, end it now".
2. After the press: "Cancelled. {plan} has ended, and your card will not be charged again."; the banner switches to "Your {plan} subscription has ended. Choose a plan to continue."; the invoice list shows the renewal as **Not charged** with no "Pay now".
3. Money history: exactly **one** `subscription_ended` row (from `.deleted`); admin Subscriptions list: **Ended**; one audit `BOS_BILLING_SUBSCRIPTION_CANCELLED` with `details.mode = 'immediate'`, `invoicesVoided` 1, `invoicesLeftOpen` 0.
4. Open the renewal's old hosted "Pay now" link from Stripe's email: the page shows the invoice void, with no way to pay.
5. Second tab (still showing Cancel): press it → expect "Cancelled. {plan} has ended, and your card will not be charged again." (E-1 closed by TL ruling 2026-10-27; it read "not active" before) and no second audit entry.
6. Hebrew and Spanish at 360 px: the payment-failed line and the ends-now confirmation wrap cleanly; settle the he / es drafts in the G-5 pass.

#### Final Status

- [x] All acceptance criteria in QA scope pass — ready for commit (after the user's diff view, P-7a.3's merge-in per SA deviation 8, and an SA / TL ruling on E-1; demo steps above owed)
- [ ] Issues found — Dev must address before commit

---

## Commit Info

| Item | Value |
|---|---|
| Slice | P-7a.1 Cancel and reactivate |
| Branch | `feature/bos-plan-payments-p7a` |
| Commits | `6e3e5a2a` feat (P-7a.1), `348bfdb6` merge of `origin/main`, plus this docs commit |
| PR | #519 (to `main`, merge commit; auto-merge OFF) |
| Migration | None |
| Merge gate | Live demo owed by the user (§QA "Owed demo steps"); do not merge until the user confirms |

| Item | Value |
|---|---|
| Slice | P-7a.3 Never charge a deleted account |
| Branch | `feature/bos-plan-payments-p7a3` |
| Commits | `7a991f72` feat (P-7a.3), `097b9da3` merge of `origin/main`, plus this docs commit |
| PR | #534 (to `main`, merge commit; auto-merge OFF) |
| Migration | None |
| Merge gate | Live demo owed by the user (§QA P-7a.3 "Owed demo steps"); do not merge until the user confirms |
| Open follow-up | FU-P7a3-1 (QA E-1): the P-4.2 pre-purchase line `plan.choose.free_access_ends_today`, unchanged pending the user |

### SA re-review: P-7a.4 after the P-7a.3 merge (dev-8)

**Code Review by SA — 2026-10-27**
**Status:** ✅ Code Approved (staged merge resolution, uncommitted)

1. `components/business-os/settings/PlanManage.tsx`: `{foundingLine && <> {foundingLine}</>}` inside the `cancel_now_body` `<p>` uses the same `foundingLine` (from `manage.freeAccessAfter.endsAt`) as `plan-manage-confirm`. No new key; the pin is 28 (21 + 2 + 1 + 5 − 1), matching the en count. The render test covers both the founding and the non-founding case, and the order. Accepted.
2. `planPurchaseView.test.ts`: moving `past_due` to "port answer is on manage" is correct. `planPurchaseView.ts` is unchanged against `main`, and its gate (`manage.cancel || manage.reactivate`) always meant "beside Cancel". P-7a.3's pin recorded the absence of a Cancel; it was not a deliberate cost guard. Cost: the port (`EntitlementService.getFreeAccessAfterPaidTier`) reads the snapshot cache that the my-plan route's `getSnapshot` has just filled, so normally no extra DB read. A failure is caught, logged and leaves the field out. Value: `endsAt` is the cohort's fixed end, and it is returned only when that end is later than the tier end + margin. A founding owner who ends the plan now lands on live free access, so the sentence is true.
3. No conflict markers in tracked merge files. The only hits are in `archive/CLAUDE_BACKUP_1406.md`, which has the same markers on `origin/main` and is not part of this merge.

**Optimisation Suggestions (Low, non-blocking):** FU-P7a4-5. `failing` has no period-end check, so an `unpaid` row long past `tierExpiresAt` could name a cohort end that is already past. Guard `endsAt > now` in the view or the port.

### Code Approved for QA: Yes

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-25 | Workplan written (Dev) | On `feature/bos-plan-payments-p7a` from `origin/main` `10761291`. Split P-7a.1 / .2 / .3 (+ conditional .4), ≈ 3.9d (4.4d); no migration; 8 business and 14 technical questions. Awaiting SA review and the user's answers |
| 2026-10-25 | SA workplan review (SA) | APPROVED WITH CONDITIONS C-1 to C-12; TQ-1 to TQ-14 ruled (TQ-12 only if BQ-3 = A). Code claims verified on `10761291`, except §4.6's "preview returns the refusal" / "panel maps the control" (C-9). BQ-1, BQ-2, BQ-4 already decided by the requirement; BQ-7 not for the user; BQ-3 (A or B) and BQ-5 needed |
| 2026-10-26 | Decisions recorded; C-1 to C-11 folded in (Dev) | §14.1 decisions (user via TL: BQ-3 A, BQ-2 after month ends, BQ-1 yes; TL defaults BQ-4 to BQ-8). C-1 in §4.1, C-2 to C-5 and TQ-5 in §4.2, C-11 in §4.3, C-6 to C-8 under §4.4, C-9 / C-10 under §4.6 (correcting the preview and panel-map claims). P-7a.4 in scope |
| 2026-10-26 | P-7a.1 code complete, uncommitted (Dev) | T0 to T4. X-2 / X-3 on the standard sandbox (cleaned up). 9 deviations for SA in Implementation Notes (P-7a.1). Requested suites 328 / 11 446 and `test:bos-entitlements` 306 / 9 227 passed; Connect harness md5 unchanged; 0 type errors in touched files; no migration, no webhook change |
| 2026-10-26 | SA code review of P-7a.1 (SA) | APPROVED WITH FIXES. C-1 to C-5, CAS, tenant isolation, entitlements registrations, audit and i18n verified. Deviations 1–9 accepted (5: the BQ-5 sentence binds P-7a.3 before the price switch goes on in production; 4: P-7a.4 decides the immediate path on the fresh status). F-1 applied: `unchanged` shows Stripe's state from the route answer (+2 render tests). SA runs: 154 suites / 6 103 tests, `test:bos-entitlements` 306 / 9 227, Connect md5 unchanged, 7 + 1 mutations all caught, 0 type errors in touched files. Local build stop on missing `.env.local` accepted as environmental |
| 2026-10-26 | QA of P-7a.1 (QA); TL decision on deviation 6 recorded | PASS, no bugs. Focus 2–8 covered (Jest + 16/16 sandbox checks on a throwaway customer, deleted); focus 1 and the live half of 4 owed as demo. Requested suites 152 / 5 937, `test:bos-entitlements` 306 / 9 227, QA files 2 / 24, Connect md5 unchanged. Edge E-1 (`cancel_at`-only: UI cannot reach Reactivate) added to the C-3 follow-up. "Reactivate your plan to upgrade" DROPPED (TL): §2.1, §5, §11, deviation 6 updated |
| 2026-10-26 | G-5 approved; committed, PR opened (RM) | User approved the wording with the Hebrew fix (`plan.manage.cancelling` "מבטלים…", `plan.manage.reactivating` "מחדשים…"); he / es draft comments marked approved. Committed on `feature/bos-plan-payments-p7a`, `origin/main` merged in, PR #519 opened; auto-merge off, live demo owed before merge |
| 2026-10-27 | P-7a.2 code complete, uncommitted (Dev) | On `feature/bos-plan-payments-p7a2` (on top of `131a46b1`). T5 to T8: portal configuration script and reader, portal and invoices routes, `planCardAndInvoicesOffer`, Update card and Invoices in Settings → Plan. X-1 (the portal moves the renewal to the new card: C-7 not triggered; a past-due invoice is not retried at once) and X-5 (`he` refused → `auto`); test configuration `bpc_1UUv5MC7KDUGYIcA3O6iIzRJ` (became the sandbox default). 9 deviations for SA in Implementation Notes (P-7a.2). Requested suites 165 / 6 296 and `test:bos-entitlements` 308 / 9 270 passed; Connect harness md5 unchanged; 0 type errors in the 31 touched files; no migration, no webhook change |
| 2026-10-27 | SA code review of P-7a.2 (SA) | APPROVED WITH FIXES. C-1, C-6, C-7 (X-1: not triggered), C-8, TQ-6, TQ-8 / X-5, tenant isolation, entitlements (one non-gate `TIER_MATRIX` importer), Zod strict and i18n verified; D2 cancel / reactivate paths untouched. Deviations 1–9 accepted (4: the sandbox default is no regression, live hazard is dashboard edits of our default, so F-2; 9: no false promise in shipped copy, follow-up FU-P7a2-1 "Pay now" wording). F-2 applied: §9.5 row 13 warning. SA runs: 172 suites / 6 712 (3 load timeouts in the untouched `PlanUpgrade.render`, 76 / 76 alone), `test:bos-entitlements` 308 / 9 270, Connect md5 unchanged, 7 mutations all caught |
| 2026-10-27 | G-5 approved for P-7a.2; FU-P7a2-1 built and closed (Dev) | User approved the P-7a.2 he / es wording (G-5) and accepted TL's FU-P7a2-1: a Due (`open`) invoice row's link reads "Pay now" (`plan.invoices.pay_now`: en "Pay now", he "לתשלום עכשיו", es "Pagar ahora"), same hosted URL, new tab, `noopener`. he / es comments marked approved. Key pins 19 → 20, QA RTL test updated, one new render test (en + he). Runs: 4 requested dirs 100 / 4 869 passed; `test:bos-entitlements` 9 269 / 9 270 (the one failure is the unregistered QA portal route test in the billing-repository caller guard, not this change); 0 type errors in touched files. Uncommitted |
| 2026-10-27 | P-7a.3 code complete, uncommitted (Dev) | On `feature/bos-plan-payments-p7a3` (on top of P-7a.2 `f3176607`). T9 to T11: Reset / Purge control 3 `subscription_live` / `subscription_unreadable` (C-9), the self-delete blocker and R-3 clearing text point at Settings → Plan (G-6 SQL text unchanged, C-10), the PF-14 cross-path pin, the AC-F8.3 walk, the BQ-5 Founding Partner sentence (`EntitlementService.getFreeAccessAfterPaidTier` through the snapshot cache). 8 deviations for SA in Implementation Notes (P-7a.3); he / es drafts for G-5; demo checklist. No migration, no webhook change; Connect harness md5 unchanged |
| 2026-10-27 | G-5 approved for P-7a.3; committed, PR opened (RM) | SA APPROVED WITH FIXES (F-3, F-4), QA PASS (no bugs). The user approved the he / es wording (G-5) as drafted and kept "Founding Partner" in English in he / es; he / es comments marked approved. QA E-1 (rewording the P-4.2 line `plan.choose.free_access_ends_today`) not answered: left unchanged, open as FU-P7a3-1. Committed on `feature/bos-plan-payments-p7a3`, `origin/main` merged in (P-7a.2 #528 MERGED 2026-10-27), PR #534 opened; no migration; auto-merge off, live demo owed before merge |
| 2026-10-27 | P-7a.4 code complete, uncommitted (Dev) | On `feature/bos-plan-payments-p7a4` (from `origin/main` `89cd0d90`). X-4 on a test clock: after `subscriptions.cancel` (`invoice_now` / `prorate` false) the open renewal invoice stays payable and paying it sends `invoice.paid`, so C-11 is met by voiding every open invoice of the subscription after the cancel (a voided invoice cannot be paid); `cancellation_details.reason` is `cancellation_requested` after both the immediate and the period-end cancel (TL / SX-2b). `planManageOffer` `failing`; the engine picks immediate vs period end on Stripe's fresh status; `cancelBusinessOsSubscriptionNow`, `listBusinessOsOpenSubscriptionInvoices`, `voidBusinessOsInvoice` (engine-only, guard updated); same CANCELLED audit key with `mode: 'immediate'` and void counts; "ends now" confirmation; 5 keys (he / es drafts), 1 retired. No migration, webhook untouched. Deviations 1–8 for SA (1: the apply-path defence recommended as a follow-up) |
| 2026-10-27 | SA code review of P-7a.4 (SA) | APPROVED WITH FIXES, approved for QA. Ordering, Stripe-decided mode, call shape (no `cancellation_details`), void scope and per-invoice cross-checks, keys never logged, audit, CAS mirror, tenant isolation, i18n verified. Deviation 1: voiding + alert meets C-11; the apply-path refusal is rejected (it would take money and give nothing, and would refuse a legitimate late payment after a Stripe dunning end); replaced by alert-only FU-P7a4-1, not blocking the price switch. Deviations 2–8 accepted (4 corrected, F-4). F-3: the guard's engine-only list gains the open-invoice list, and the SDK `invoices.voidInvoice(` is forbidden in the scanned tree. Follow-ups FU-P7a4-1 to -4. SA runs: 12 sets all green (`test:bos-entitlements` 313 / 9 401), Connect md5 unchanged, 7 / 7 mutations caught |
| 2026-10-27 | QA E-1 / E-2 closed by TL ruling (Dev) | E-1: a cancel on a row our record shows ended answers `unchanged` / `ended` from the row (no Stripe call, no write, no audit); reactivate unchanged. E-2: `payment_failed_contact_us` server message = the en `plan.manage.refusal.payment_failed` line (code kept). Two QA pins and one engine test updated, two route tests added. Re-run: all requested sets green, `test:bos-entitlements` 313 / 9 401. Uncommitted; deviation 8's Founding Partner hunk waits for RM's merge of `main` |
| 2026-10-27 | `origin/main` (P-7a.3, #534) merged into P-7a.4; SA dev-8 built (Dev) | Hand-merged the key-count pin (now 28: P-7a.1 21 + P-7a.2 2 + P-7a.3 1 + P-7a.4 +5 −1) and the status text in this workplan and the requirement. Dev-8: the "ends now" confirmation (`plan-manage-confirm-now`) shows P-7a.3's Founding Partner sentence (`plan.manage.cancel_confirm_founding`, no new key), one render test. Uncommitted, awaiting SA re-review |
| 2026-10-27 | FU-P7a4-1 workplan written (Dev) | Alert-only `bos_billing_paid_after_end` on `invoice.paid` for a subscription that ended before the invoice's period end and was paid after the end; applied exactly as today. Decided from the fresh Stripe read the apply already makes (no new call or DB read); fires once on `applied` / `recorded`. Q-1 to Q-3 for SA. No code yet |
| 2026-10-27 | FU-P7a4-1 code complete, uncommitted (Dev) | SA R-1 to R-6 applied: pure `paidAfterEnd` on Stripe's step-9 read, called after the apply; `bos_billing_paid_after_end` (`error`, `alert: true`) on `applied` / `recorded` and on `subscription_conflict` with a new row, with `tierBefore` / `tierAfter`; optional `cancellationReason` on `retrieveBusinessOsSubscription` (same call). +18 tests incl. R-6 byte-identical outcome on both paths. Gates green; Connect md5 unchanged. Deviations 1-3 for SA |
