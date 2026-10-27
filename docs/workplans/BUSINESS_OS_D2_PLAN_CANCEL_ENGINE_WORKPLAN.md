# Workplan: D2 (SX-1) Plan cancel at period end + "Keep my plan" engine

> **Last Updated**: 2026-10-26

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md) §5, §6.2 row SX-1, §7, §10 (carried rulings), §11 (boundary). Parent: [BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md) §6, §9.2, §17 and the SA review of 2026-10-25.
**Step:** D2 (doc slice id **SX-1**), DELETE scope
**Branch:** `feature/plan-cancel-d2` (worktree `neuronforge-d2`, from `origin/main` `a105fa4a`, which includes D1 #508 and plan payments P-7a.1 #519)
**Date:** 2026-10-26
**Status:** Code Complete, uncommitted (SA workplan review 2026-10-26: approved with W-1 to W-12; awaiting SA code review)

## Overview

D2 is meant to give the owner one server engine that sets "don't renew" on their plan (cancel at period end) and clears it again ("Keep my plan"). The deletion flow (D6 / DL-1b) will call the same engine. **Most of that engine is already on `main`.** Plan payments P-7a.1 (PR #519, merged 2026-10-26, a few hours before this branch was cut) shipped the Stripe method, the orchestration, both routes, the mirror write, the audit and the Settings → Plan controls. C-1 had already ruled that SX-1 to SX-3 are P-7a's cancel half. So this workplan does **not** build a second engine. It adopts P-7a.1's engine as the one "don't renew" path and adds only what SX-1 asks for and P-7a.1 does not have. Several of those additions conflict with rulings P-7a's SA has already made, so SA has to rule on them (§10) before code starts.

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Requirement-to-code reconciliation](#2-requirement-to-code-reconciliation)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Task List](#5-task-list)
6. [Tests](#6-tests)
7. [Acceptance Criteria](#7-acceptance-criteria)
8. [Risks](#8-risks)
9. [Business questions: TL defaults](#9-business-questions-tl-defaults)
10. [Open items for SA](#10-open-items-for-sa)
11. [Estimate](#11-estimate)
12. [Hand-overs to later steps](#12-hand-overs-to-later-steps)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

**What the slice touches:** Stripe billing for the owner's Business OS plan subscription, meaning the `business_os_billing_accounts` row (read, and the mirror's compare-and-set write) and Stripe's `subscriptions.update({ cancel_at_period_end })`. It does not touch the plan row, entitlements, the closure table, emails or UI copy.

**What is already on `main` (P-7a.1, #519), read on `a105fa4a`:**

| Piece | Where | What it does |
|---|---|---|
| Stripe write | `lib/stripe/StripeService.ts` `setBusinessOsCancelAtPeriodEnd(subscriptionId, flag)` → `BusinessOsCancelFacts` | The single `cancel_at_period_end` update. It returns the update's own answer (status, flag, `cancel_at`, `ended_at`, latest item period end). **No idempotency key** (P-7a SA TQ-3) |
| Fresh read | `retrieveBusinessOsSubscription` (now also returns `cancelAt`) | Used for the cross-checks before the write |
| Orchestration | `lib/business-os/billing/planSubscriptionManage.ts` `managePlanSubscription({ action: 'cancel' \| 'reactivate', userId, accountId }, deps)` | Built in the `planUpgrade.ts` shape: injected ports, every DB read and our-data refusal before any Stripe call, C-4 cross-checks (subscription, customer, mode, `bos_user_id`), `unchanged` with heal, `upgrade_pending`, the write, then the mirror CAS from Stripe's answer. Refusals are results, never throws |
| Eligibility predicate | `lib/business-os/billing/planManageOffer.ts` `planManageOffer(facts, { pricesEnabled }, now)` | The one predicate behind both the screen and the routes (step 5): switch off, no subscription, ended / not live, failed payment, period over, cancelling, renewing |
| Mirror | `BusinessOsBillingAccountRepository.mirrorSubscriptionState` (the webhook's own CAS, keyed on user, mode and subscription id) | Our row is written from Stripe's answer (= SA-3) |
| Routes | `POST /api/business-os/billing/plan/cancel` and `/plan/reactivate` | Body `{}` strict; session user only (`getUser()` + `resolveAccountId`); 404 while `isPlanPriceRecognitionEnabled()` is off (P-7a C-1, BQ-1 "Yes, always"); Pino with `correlationId`; audit `BOS_BILLING_SUBSCRIPTION_CANCELLED` / `_REACTIVATED` once per request that reached the write, via `logAndFlush` |
| Screen | `components/business-os/settings/PlanManage.tsx`, `PlanSection.tsx`, wire `PlanPurchaseWire.manage` from `planPurchaseView.ts` | Cancel / Reactivate in Settings → Plan |
| Entitlements registrations | `enforcementPoints.test.ts` `KNOWN_NON_GATE_IMPORTERS`: both routes, symbol `resolveAccountId` | Already registered. The engine imports nothing from the entitlements module (TQ-13) |
| Tests | `planSubscriptionManage.test.ts`, `planSubscriptionManage.p7a1.qa.test.ts`, `planManageOffer.test.ts`, `planManageOffer.matrix.test.ts`, `app/api/business-os/billing/plan/cancel/__tests__/route.test.ts` (covers both routes) | Includes a stateful cancel → reactivate → cancel → reactivate run with four writes (QA row 2) |

**SA-6 is already met on `main`:** `planUpgradeOffer` refuses `cancelling` (record) and `planUpgradeEligibility` refuses `cancel_at_period_end` (Stripe). `planPurchaseOffer` refuses `paying` while the subscription is live, and a cancelling subscription is still live. Reactivating clears the flag, so the upgrade comes back. D2 only pins this with a test.

**Not touched (as ordered):** the legacy agent-platform route `app/api/stripe/cancel-subscription/route.ts`, the webhook plan handler and `planSubscriptionMirror.ts` (C-3 is D6, see §3.7), the closure table and its repository, emails, the drawer, and the cleanup generator (EXPORT holds the cleanup-regen lock; D2 does not regenerate).

**Migration:** none. Every column D2 reads (`pending_tier`, `open_checkout_session_id`, `open_checkout_expires_at`, `cancel_at_period_end`, `ended_at`, `failed_attempts`) exists since `20261025` and is already selected by `BusinessOsBillingAccountRepository`. If SA's rulings somehow need one, the number must be reserved in `SELF_SERVICE_EXIT_COORDINATION.md` first (next free is 20261097).

**Phase / pattern note:** this is not V6 work. No new pattern. The attempt idempotency key copies the existing `{ idempotencyKey }` option already used by `createOrGetCustomer`, `createBusinessOsPlanCheckoutSession` and the upgrade.

**`console.*` check (CLAUDE.md § Logging):** every file D2 edits has 0 `console.*` calls (StripeService.ts, featureFlags.ts, planSubscriptionManage.ts, planManageOffer.ts, planPurchaseView.ts, both routes, events.ts). Nothing to convert.

---

## 2. Requirement-to-code reconciliation

> **Revised 2026-10-26 after the SA workplan review (W-1 to W-12).** P-7a's later, built rulings win on the plain cancel. Struck items are kept so the review trail stays readable.

Each SX-1 item from the requirement row and the TL brief, mapped against `main`:

| # | SX-1 asks for | On `main` | D2 delta (as ruled) |
|---|---|---|---|
| R-1 | `StripeService.setBusinessOsPlanCancelAtPeriodEnd` (SA-1) | `setBusinessOsCancelAtPeriodEnd` | **Name kept** (Q-2). Optional per-attempt key added (R-6) |
| R-2 | `planCancellation.ts` in the `planUpgrade.ts` shape | `planSubscriptionManage.ts` | **No new file** (Q-2); extended in place |
| R-3 | Routes `…/plan/cancel`, `…/plan/keep` | `/plan/cancel`, `/plan/reactivate` | **No `/plan/keep`** (Q-2). "Keep my plan" is D3's label |
| R-4 | SA-2 eligibility, incl. `trialing` refused | Everything except `pending_tier` / open checkout; `trialing` manageable (P-7a TQ-14) | Add `change_pending` on the **renewing → cancel** side only (W-3). **`trialing` stays manageable** (Q-1) |
| R-5 | Already cancelling = success, no write; Keep needs active + cancelling + before period end | Done | Pinned by tests only |
| R-6 | Fresh key per attempt (SX C-4) | No key (P-7a TQ-3) | Random key per `managePlanSubscription` call, never logged (Q-3, W-4) |
| R-7 | Mirror write from Stripe's answer (SA-3) | Done | None |
| R-8 | SA-16 audit names | `BOS_BILLING_SUBSCRIPTION_CANCELLED` / `_REACTIVATED` | **P-7a keys kept** (Q-4) + optional `details.reasonCode` on cancel. No `eventAudience.ts` change |
| R-9 | Reason code only (SX C-10, SA-4) | Body `{}` strict | Optional `reasonCode` enum on cancel (Q-5); reactivate stays `{}` strict |
| ~~R-10~~ | ~~`isPlanSelfCancelEnabled()`~~ | Cancel follows the price switch (P-7a C-1, user BQ-1) | **Dropped (W-1)**: superseded by P-7a C-1 / BQ-1. No `featureFlags.ts` / `FEATURE_FLAGS.md` edit |
| R-11 | One engine for both callers | `managePlanSubscription`, route-agnostic | **`origin` moves to D6 (W-5).** The engine is route-agnostic; the guard (W-7) makes D6 call it |
| R-12 | SA-6 | Done | Pin test only |
| R-13 | SX C-1 P-7a note; R-3 text | — | D2 writes the P-7a cross-reference note (W-8). R-3 text stays D4. "Correct C-6": no D2 work (Q-9) |
| R-14 | SX C-3 | Needs D6's `pending` rows | **D6** (Q-10), with the `cancel_at` note |

---

## 3. Implementation Approach

### 3.1 One engine, extended in place

`managePlanSubscription` stays the only orchestration and keeps its step order. Additions:

- `PlanManageInput.reasonCode?: PlanLeaveReasonCode | null` (cancel only; ignored for reactivate, which always audits `null`).
- `PlanManageDeps.newAttemptId?: () => string` (default `crypto.randomUUID`), so tests are deterministic.
- `PlanManageAuditFacts.reasonCode: PlanLeaveReasonCode | null`.
- The `change_pending` refusal (§3.2), decided at step 5 from our data, zero Stripe calls.
- The per-attempt key on the single write (§3.3).

No `origin` (W-5), no switch port (W-1).

### 3.2 `change_pending` (SA-2, W-3), cancel side only

In `planManageOffer`, after the `cancelAtPeriodEnd` branch and before `return { kind: 'renewing' }`:

| Rule | Answer |
|---|---|
| `pendingTier !== null` | `none` / `change_pending` |
| `openCheckoutSessionId !== null` and `openCheckoutExpiresAt` later than `now` | `none` / `change_pending` |

A cancelling row with either fact still answers `cancelling`, so Keep is never refused for this reason. The header comment says that today neither state can occur (nothing writes `pending_tier`, and no checkout lock exists alongside a live subscription), so this is a defence for P-7b.2. `PlanManageFacts` gains three **optional** fields, so existing callers and P-7a.2's hunks are unaffected. `planManageWire` and `planPurchaseView.ts` are **not touched** (W-2): `change_pending` falls through `planManageWire` to `null` (nothing to show), as `period_over` does. The engine maps the reason to the refusal code `change_pending` (409, "A plan change is in progress. Try again once it is finished."), logged at warn and never audited.

### 3.3 Per-attempt key (SX C-4, Q-3, W-4)

A pure exported builder, `planManageAttemptKey(subscriptionId, action, attemptId)` → `bos-plan-manage:{subscriptionId}:{action}:{attemptId}`. It is called once per `managePlanSubscription` call and passed only to `setBusinessOsCancelAtPeriodEnd(subscriptionId, flag, { idempotencyKey })`. The options argument is optional. The key is never logged and appears in no audit row.

### 3.4 (removed: switch, W-1)

### 3.5 Audit (Q-4)

The keys and writer rules stay as they are. The cancel route adds `details.reasonCode` (the code or `null`). The reactivate details are unchanged. The `EVENT_METADATA` description lines are edited in place to mention the reason code.

### 3.6 Reason codes (SX C-10, BQ-7 TL default, W-6)

`lib/business-os/billing/planLeaveReasons.ts` is pure, has no imports and is client-safe. It holds the seven suggested codes. A test checks every code against the `20261093` `reason_code` CHECK regex. The cancel body is `z.object({ reasonCode: z.enum(PLAN_LEAVE_REASON_CODES).optional() }).strict()`.

### 3.7 SX C-3 is D6 (Q-10)

D6 must also read `cancel_at` (see P-7a's C-3 follow-up).

### 3.8 Tenant isolation

Unchanged from P-7a.1. The body carries only an optional enum. The account comes from the session. The subscription comes from our billing row, and P-7a C-4 cross-checks it before the write.

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/billing/planLeaveReasons.ts` | create | Reason codes (W-6) |
| `lib/business-os/billing/planManageOffer.ts` | modify | `change_pending` rule + optional facts (W-3). **Not** `planManageWire` (W-2) |
| `lib/business-os/billing/planSubscriptionManage.ts` | modify | `reasonCode`, `newAttemptId`, key builder, `change_pending` refusal, audit fact |
| `lib/stripe/StripeService.ts` | modify | Optional `{ idempotencyKey }` on `setBusinessOsCancelAtPeriodEnd` only |
| `app/api/business-os/billing/plan/cancel/route.ts` | modify | Body `reasonCode?`; `details.reasonCode` |
| `lib/audit/events.ts` | modify | Two description lines in place |
| `lib/business-os/billing/__tests__/planLeaveReasons.test.ts` | create | Codes vs the CHECK regex |
| `lib/business-os/billing/__tests__/planManageOffer.matrix.test.ts` | modify | `change_pending` rows |
| `lib/business-os/billing/__tests__/planCancelEngine.d2.test.ts` | create | Key per attempt (cancel → keep → cancel), key never logged, `change_pending` zero Stripe calls, reason in facts, SA-6 pin |
| `lib/business-os/billing/__tests__/oneDontRenewPath.guard.test.ts` | create | W-7 (a), (b), (c) |
| `lib/stripe/__tests__/businessOsPlanCancel.test.ts` | modify | Key forwarded / omitted |
| `app/api/business-os/billing/plan/cancel/__tests__/route.test.ts` | modify | Reason accept / reject; reactivate `{ reasonCode }` → 400 |
| `docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md` | modify | SX-1 as-built note (W-8) + Change History. §11 untouched |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | P-7a row SX C-1 cross-reference + Change History. No §9.5 sentence |

**Not touched:** `featureFlags.ts`, `FEATURE_FLAGS.md`, `planManageWire`, `planPurchaseView.ts`, `eventAudience.ts`, the reactivate route, the mirror, the webhook, the legacy cancel route, the closure files, UI, translations, every S-1 file.

---

## 5. Task List

- [x] **T-0** SA gate (SA workplan review 2026-10-26)
- [x] **T-1** Coordination with plan payments (done by SA; order P-7a.2 → D2 → P-7a.4, W-9)
- [ ] ~~**T-2** switch~~ (removed, W-1)
- [x] **T-3** `planLeaveReasons.ts` + test
- [x] **T-4** StripeService optional key + test
- [x] **T-5** `planManageOffer` `change_pending` (cancel side) + matrix rows
- [x] **T-6** Engine: reason, key, `change_pending` refusal + tests
- [ ] ~~**T-7** view~~ (removed, W-2)
- [x] **T-8** Cancel route body + audit details; route tests (incl. reactivate `{ reasonCode }` → 400)
- [x] **T-9** `events.ts` description lines
- [x] **T-10** `planCancelEngine.d2.test.ts` (key per attempt, SA-6 pin)
- [x] **T-11** `oneDontRenewPath.guard.test.ts` (W-7)
- [x] **T-12** Docs (W-8)
- [x] **T-13** Verify: P-7a C-12 run list, `test:bos-entitlements`, Connect harness md5 before and after, tsc on touched files. Leave everything uncommitted

---

## 6. Tests

All Stripe calls go through mocked ports. Pure Jest, no added CI time.

- **Matrix:** renewing + `pending_tier` → `change_pending`; renewing + open checkout in the future → `change_pending`; renewing + expired checkout → `renewing`; cancelling + `pending_tier` → `cancelling`; cancelling + open checkout → `cancelling`; `trialing` → `renewing` (TQ-14, unchanged).
- **Engine:** cancel → reactivate → cancel within 24 h → three writes, three distinct keys of shape `^bos-plan-manage:sub_…:(cancel|reactivate):<uuid>$`, no stale replay. The key appears in no logger argument. `change_pending` → zero Stripe calls, no audit facts. `reasonCode` is in the cancel facts (`null` when absent) and `null` on reactivate. Reactivate on a cancelling row with `pending_tier` set → proceeds.
- **SA-6 pin:** a cancelling row → `planUpgradeOffer` `none` / `cancelling`; reactivated → upgrade offered; `planPurchaseOffer` refuses `paying` while live.
- **Routes:** `{ reasonCode: 'too_expensive' }` → 200, audit `details.reasonCode`. Invalid code → 400. `{ reasonCode: 'other', note }` → 400. `{}` → 200 with `reasonCode: null`. Reactivate `{ reasonCode }` → 400. Existing 404 / 401 / 400 tests unchanged.
- **StripeService:** key forwarded when given; called with one argument when not.
- **Guard (W-7):** non-test files under `lib/business-os/**` and `app/api/business-os/**`: (a) `setBusinessOsCancelAtPeriodEnd` referenced only in `planSubscriptionManage.ts`; (b) no `subscriptions.update(` / `subscriptions.cancel(`; (c) no `cancelSubscription(` / `reactivateSubscription(`.

---

## 7. Acceptance Criteria

- [ ] **AC-D2.1** Cancel / Keep behave as P-7a.1, with a fresh idempotency key per attempt that is never logged; cancel → keep → cancel within 24 h makes three real writes.
- [ ] **AC-D2.2** A renewing plan with `pending_tier` or an unexpired open checkout is refused `change_pending` with zero Stripe calls; a cancelling plan can still be kept.
- [ ] **AC-D2.3** `trialing` is manageable (TQ-14); already cancelling → `unchanged`; Keep after the period end is refused (unchanged).
- [ ] ~~AC-D2.4 switch~~ (removed, W-1). Cancel stays gated on the price switch exactly as P-7a C-1 built it.
- [ ] **AC-D2.5** The cancel audit row carries `details.reasonCode` (a code or `null`), never free text, a Stripe error or the key.
- [ ] **AC-D2.6** The engine is route-agnostic; the guard makes D6 call it rather than Stripe.
- [ ] **AC-D2.7** SA-6 pinned.
- [ ] **AC-D2.8** No migration, no S-1 file, legacy route untouched, `test:bos-entitlements` green, Connect harness unchanged, no added CI time.
- [ ] **AC-D2.9** As-built note in the DELETE requirement and the cross-reference note in plan payments.

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| ~~R-1~~ | ~~Switch hides Cancel~~ | Removed with the switch (W-1) |
| R-2 | P-7a.2 edits `planManageOffer.ts`, `planPurchaseView.ts` and `StripeService.ts` | D2 does not touch `planManageWire` or the view (W-2). In `StripeService.ts` it touches only the one method. **Rebase on `main` after P-7a.2 merges, before enqueue** (W-9) |
| R-3 | Conflicting rulings | Ruled by SA (P-7a wins on the plain cancel) |
| R-5 | Two tabs can still both write | As today; `unchanged` absorbs the second press |
| R-6 | Hotspot files | Only `events.ts` description lines (in place) |
| R-7 | BQ-11 vs P-7a BQ-3 | BQ-11 now covers the deletion request only (D6) |
| R-8 | P-7a.4 must carry `details.reasonCode` and be added to the guard | Recorded for P-7a.4 (W-6, W-7) |

---

## 9. Business questions: TL defaults

These are TL defaults; the user may change any of them.

| BQ | Default used | Effect on D2 |
|---|---|---|
| **BQ-11** Failed last payment | Refuse self-service; "update your card, or contact support" (suggestion) | The engine keeps refusing `payment_failed_contact_us` (already on `main`). **Note for TL:** for a *plain* cancel the user already decided P-7a BQ-3 = "Ends now" (P-7a.4 will allow an immediate cancel in this state). So BQ-11 should be re-worded to cover the deletion request only, or the user re-asked |
| **BQ-15** Switch on while plan limits are not enforced | Yes (suggestion) | None in D2 (the switch stays off until SX-3); recorded in the flag doc |
| **BQ-18** No purchase while a deletion is pending | No, Keep first (suggestion) | None in D2 (D6 reads the closure repository) |
| **BQ-7** Reason list | The suggested seven codes | `planLeaveReasons.ts`. Labels and their order are SX-2's |
| **BQ-17** List only, no free text | Yes | The body accepts the enum only |

---

## 10. Open items for SA

| # | Question | Dev recommendation |
|---|---|---|
| **Q-1** | `trialing`: SA-2 (2026-10-24, refuse) vs P-7a TQ-14 (2026-10-25, approved, on `main`: manageable) | Keep TQ-14: it is later, already shipped and pinned, and it protects the customer (cancelling a trial means no first charge). Amend SA-2 for the plan cancel. The deletion request (DL-1b) can still refuse `trialing` on its own if SA wants |
| **Q-2** | Names: adopt `setBusinessOsCancelAtPeriodEnd`, `planSubscriptionManage.ts`, `/plan/reactivate` instead of the requirement's `setBusinessOsPlanCancelAtPeriodEnd`, `planCancellation.ts`, `/plan/keep` | Adopt; no aliases. BA amends the SX-1 row ("as built", T-12). "Keep my plan" stays the owner-facing label (SX-2) |
| **Q-3** | C-4 (fresh key per attempt) vs TQ-3 (no key): is a random per-attempt key the right reconciliation? | Yes (§3.3): it gives retry safety within an attempt and never replays across attempts |
| **Q-4** | Audit names: keep `BOS_BILLING_SUBSCRIPTION_CANCELLED` / `_REACTIVATED` (+ `reasonCode`, `origin` in details) or add SA-16's `BOS_BILLING_CANCEL_REQUESTED` / `_UNDONE`? | Keep. One act, one key; P-7a's are already in the money-audit coverage set. Alternative costed in §3.5 (+0.25 d) |
| **Q-5** | `reasonCode` optional in D2 (P-7a's screen sends `{}`), made required in SX-2 when the drawer ships? | Yes. SX-2 flips `.optional()` off in the same PR as the drawer |
| **Q-6** | Semantics of `isPlanSelfCancelEnabled()`: gate **new owner cancels only** (route 404 + no Cancel button), never Keep, never DL-1b; both it and the price switch must be on to cancel | Yes, with the go-live sentence. Alternative: gate the SX-2 drawer only and leave P-7a's cancel on the price switch (then "switch off → 404" is not met). This changes merged behaviour, so TL may want to tell the user |
| **Q-7** | `change_pending` as one new refusal code for `pending_tier` and an open checkout, separate from `upgrade_pending` (Stripe's pending update) | Yes. Our-data vs Stripe-data stay distinguishable in logs |
| **Q-8** | FEATURE_FLAGS.md anchor: there is no summary-table row for self-delete; is "directly after the self-delete **section**" correct under SR-10? | Yes |
| **Q-9** | TL's brief lists "correct C-6" under C-1. Dev cannot find the referent (parent C-6 = list export; P-7a C-6 = portal hardening, P-7a.2's) | TL / SA to say what it means. Otherwise it goes with the P-7a note in SX-3 |
| **Q-10** | C-3 placed in D6 (DL-1b), not D2 (§3.7) | Confirm |

---

## 11. Estimate

Re-cut by SA (W-12): **≈ 1.2 d**. T-3 0.2 · T-4 0.15 · T-5 0.25 · T-6 0.25 · T-8 0.15 · T-10 + T-11 0.15 · T-12 + T-13 0.25. T-2, T-7 and the switch half of T-8 are gone.

---

## 12. Hand-overs to later steps

| To | What |
|---|---|
| **D3 (SX-2)** drawer | Sends `{ reasonCode }` and makes it required (Q-5); "Keep my plan" label over `/plan/reactivate`; labels for `planLeaveReasons.ts`; `planEndingView` in the entitlements module with registrations (XC-19) |
| **D4 (SX-3)** | Emails (cancelled / kept / 3-day reminder), R-3 text in `adminDeletionRefusals.ts`, switch on (BQ-15), the remaining C-1 / "C-6" doc work |
| **D6 (DL-1b)** | Adds `origin: 'owner' | 'deletion_request'` to the engine with its first real caller (W-5; absent `details.origin` on older rows = owner) and calls `managePlanSubscription({ action, userId, accountId, origin: 'deletion_request', reasonCode })`, never the Stripe method directly (guard T-11). Reads `renewal_was_on` from our billing row before calling (XC-2). Keep only if it was on. **SX C-3**: `planSubscriptionMirror.ts` (reading `cancel_at` as well as the flag, Q-10) clears a `pending` closure row on a Stripe-side reactivation. Owner `/plan/reactivate` is refused while a deletion is pending ("no own undo", requirement §5 table). BQ-11 / BQ-18 refusals |
| **Plan payments (P-7a.4, P-11)** | P-7a.4 rebases on D2 (R-2). P-11 inherits the Q-1 `trialing` ruling |
| **Plan payments (P-7b.2)** (SA code review F-2, 2026-10-27) | Cancel with a scheduled downgrade: decide whether to refuse or to clear it. Also close the stale-row path, where step 5 answers `cancelling` from our row while Stripe is renewing and so skips `change_pending`: re-check our pending facts after step 7, and only when the write would happen (never turning a correct `unchanged` into a 409). Not fixed in D2, because `pending_tier` has no writer until P-7b.2 |

---

## Implementation Notes (Dev, 2026-10-27)

Built on `feature/plan-cancel-d2` (base `a105fa4a`), **uncommitted**. Not rebased: W-9 requires a rebase on `main` after P-7a.2 merges and before enqueue.

| Item | As built |
|---|---|
| Reason codes | `lib/business-os/billing/planLeaveReasons.ts` (no imports). Its test reads the `reason_code` CHECK out of migration `20261093` and matches every code against it |
| Key | `planManageAttemptKey(subscriptionId, action, attemptId)` is exported and pure (SA's suggestion). The attempt id is node `crypto.randomUUID` through the `newAttemptId` port, built once per call and only when the write is reached (`unchanged` uses no key). Neither the key nor the attempt id is logged |
| StripeService | `setBusinessOsCancelAtPeriodEnd(id, flag, options?)`. With no key (or an empty one), the call is made with two arguments exactly as P-7a.1 built it |
| `change_pending` | In `planManageOffer`, after the cancelling branch and before `renewing`. Facts gain three **optional** fields, so `planPurchaseView.ts` is untouched; it passes the full row, so the screen also hides Cancel for it, via `planManageWire` → `null` (untouched, W-2). An open checkout whose expiry is unknown counts as open (fails closed for a cancel; Keep is unaffected). Engine step 5: refused only for `action === 'cancel'`; a reactivate goes on to the fresh read (stale-row repair, P-7a C-2) |
| Audit | `details.reasonCode` on `BOS_BILLING_SUBSCRIPTION_CANCELLED` (the code or null; the reactivate route is unchanged). In `events.ts`, a comment line only |
| Guard | `oneDontRenewPath.guard.test.ts`: (a) / (b) / (c) of W-7 over 100+ files, plus a non-vacuity check |
| Docs | DELETE requirement: SX-1 as-built paragraph under the §6.2 table + Change History (§11 untouched). Plan payments: SX C-1 note appended to the P-7a row + Change History. **Rebase note:** P-7a.2 also edits that row and that table, so resolve by keeping both |

**Verification (2026-10-27):**
- P-7a C-12 run list (`lib/business-os/billing`, `lib/stripe`, `app/api/stripe`, `lib/business-os/purge`, `app/api/business-os/billing`, `components/business-os/settings`): 140 suites, 5804 tests passed.
- `npm run test:bos-entitlements`: 313 suites, 9399 tests passed.
- Connect harness snapshot md5 `ab7528ea68309cffb309ffbd46c455ab` was the same before and after; no `-u`.
- ESLint on the touched files is clean.
- `tsc --noEmit -p .` (8 GB heap, no OOM): **0 errors in touched files**. The 1853 errors elsewhere were there before D2.
- **Correction (SA F-1, 2026-10-27):** that claim was wrong. My filter covered only the touched files, while the full output already contained `planManageCopy.ts(19,14) TS2741` (an importer of `PlanManageRefusalCode`). After F-1, `tsc` was re-run and filtered over the touched files **plus all 93 importers** of the changed modules (`planSubscriptionManage`, `planManageOffer`, `planLeaveReasons`, `planManageCopy`, `StripeService`): the only change from the first run is that the F-1 error is gone (1853 → 1852). The 10 errors left in that set are in five untouched Stripe Connect routes (`StripeConnectAccount` / audit entity-type mismatches); none mentions a D2 symbol, and all were in the first run. No OOM.

**Known edge, not handled (impossible today):** a cancel on a STALE row that says cancelling while Stripe says renewing passes step 5 as `cancelling`, so it skips the `change_pending` check. Both conditions together cannot occur today (no `pending_tier` writer). If SA wants it closed, step 5 can re-check pending facts for `action === 'cancel'` regardless of the offer kind (≈ 5 lines + 1 test).

## SA Review Notes

_SA populates this section._

## SA Workplan Review — 2026-10-26

**Reviewed by SA — 2026-10-26** (code read on `a105fa4a` in `neuronforge-d2`; P-7a.2's uncommitted diff read in `neuronforge-p7a`)
**Status:** ⚠️ Approved with conditions W-1 to W-12. **Scope is cut**: the switch and `origin` come out (about 1.2 d left, not 2.1 d)

### Claims verified (read by SA, not taken from the workplan)

| Claim | Verdict |
|---|---|
| P-7a.1 (#519, `ff8e2011`) shipped the engine: `setBusinessOsCancelAtPeriodEnd`, `managePlanSubscription` steps 3 to 10, `planManageOffer`, both routes gated on `isPlanPriceRecognitionEnabled()`, `MANAGEABLE_STATUSES = ['active', 'trialing']` | ✅ |
| No idempotency key on the write (P-7a TQ-3) | ✅ `StripeService.ts:671`. Note: stripe-node 19.2.1 defaults `maxNetworkRetries` to 2 and then makes **its own random key per call** (`RequestSender._defaultIdempotencyKey`). So retry safety inside one attempt already exists today; R-6 makes it explicit and independent of the SDK default |
| `pending_tier` / open checkout are "SA-2 gaps" | ⚠️ True, but **neither can happen today**. Nothing writes `pending_tier` non-null (the repository only clears it, `BusinessOsBillingAccountRepository.ts:684`); it is P-7b.2's column. A checkout lock cannot open while a subscription is live (`planPurchaseOffer` refuses `paying`), and the subscribed mirror clears it (`:685`). The rule is a cheap defence for P-7b.2, not a live bug |
| §6.4 guard: "exactly one non-test file writes `cancel_at_period_end:` in a Stripe update" | ❌ False as written. `StripeService.ts:1020` / `:1031` (legacy `cancelSubscription` / `reactivateSubscription`), `lib/server/stripe-plugin-executor.ts:432` (the user's own Stripe plugin) and the repository column writes all match. See W-7 |
| P-7a.2 is in flight on the same lines | ✅ Uncommitted in `neuronforge-p7a`: it already edits `planManageOffer.ts` (it changes the **signature** of `planManageWire` to `(offer, cardAndInvoices = false)`), `planPurchaseView.ts` and `StripeService.ts` (+120 lines). D2's planned `planManageWire(offer, { selfCancelEnabled })` would collide head-on |
| "C-4" means two different things | ⚠️ Self-exit C-4 = a fresh key per attempt; P-7a C-4 = the four-way cross-check. The workplan uses both (§1 and R-6). Code comments and docs must say "SX C-4" / "P-7a C-4" (W-11) |

### Which ruling wins where the two requirement sets disagree

Rule used: P-7a's rulings are **later, built, demoed and in part decided by the user**. SX-1's were written when "no Business OS route cancels a plan" (parent §2) was still true. Where they conflict on the **plain plan cancel**, P-7a wins. SX rulings still govern what is new: the deletion request (D6), the drawer (D3) and emails (D4).

| Topic | SX ruling | P-7a ruling | Winner and why |
|---|---|---|---|
| Switch for cancel | XC-15 / SR-10: new `isPlanSelfCancelEnabled()`, default off | C-1 + **BQ-1 (user: "Yes, always")**: cancel follows the price-recognition switch only, so a payer can always leave | **P-7a.** A user decision beats an SA technical ruling, and the go-live floor requires in-app cancel. XC-15's cancel switch is **superseded** (W-1) |
| `trialing` | SA-2: refuse | TQ-14: same as `active`, pinned by a matrix row | **P-7a** for the plan cancel: cancelling a trial means no first charge, which protects the customer. D6 decides `trialing` for the deletion request in its own review |
| Idempotency key | C-4: fresh key per attempt | TQ-3: no key (a fixed key replays a stale answer) | **No real conflict.** TQ-3 rejected a *fixed* key; C-4 asks for no reuse *across* attempts. A random key per attempt meets both (Q-3) |
| Audit names | SA-16: `BOS_BILLING_CANCEL_REQUESTED` / `_UNDONE` | AM-7: `BOS_BILLING_SUBSCRIPTION_CANCELLED` / `_REACTIVATED`, in the money-audit coverage set; TQ-12 extends it with `details.mode` | **P-7a.** One act, one key. SA-16's real point (deletion events survive deletion, XC-13) is about DL events, not this pair |
| Failed last payment | BQ-11 (suggestion): refuse self-service | **BQ-3 (user: "Ends now")**: P-7a.4 ends the plan at once | **P-7a** for the plain cancel. BQ-11 now covers **only the deletion request** (D6) and is still open |
| Names | `setBusinessOsPlanCancelAtPeriodEnd`, `planCancellation.ts`, `/plan/keep` | As built | **As built** (Q-2) |

### Rulings on Q-1 to Q-10

| # | Ruling |
|---|---|
| Q-1 | **TQ-14 stands** (`trialing` manageable for the plan cancel). The SX-1 row, §5 "Refused: … `trialing`" and the §7 AC are amended through the as-built note. D6 rules `trialing` for the deletion request separately |
| Q-2 | **Adopt the names on `main`**: no rename, no alias, no `/plan/keep` route. "Keep my plan" is the D3 label over `/plan/reactivate` |
| Q-3 | **Approved**: a random key per call to `managePlanSubscription` (`crypto.randomUUID`), never derived from ids, time or the action alone. It adds no behaviour over the SDK's own retry key, but it makes C-4 explicit and survives a change of SDK defaults. The key is never logged |
| Q-4 | **Keep P-7a's keys**, plus `details.reasonCode` (cancel only, code or `null`). No new keys, no `eventAudience.ts` change. Editing the existing `EVENT_METADATA` description lines in place is allowed (not an anchor edit) |
| Q-5 | **Approved**: `reasonCode` optional in D2 (`z.object({ reasonCode: z.enum(PLAN_LEAVE_REASON_CODES).optional() }).strict()`). D3 makes it required in the same PR as the drawer |
| Q-6 | **No second switch. Drop `isPlanSelfCancelEnabled()` from D2** (W-1). It would hide the merged and demoed Cancel wherever the price switch is on and the new one is not. That breaks the user's BQ-1 answer and the go-live floor, and it adds one more go-live coupling to forget. Gating only the "new reason path" is not needed either: an optional field that nothing sends changes nothing. If D3 / D4 want to ship the drawer or emails dark, they may add a **presentation-only** switch that picks the drawer over P-7a's confirm, or holds the emails. It may **never** remove Cancel. SA reviews that in D3 |
| Q-7 | **Approved**, with a narrowing (W-3): `change_pending` refuses only the **renewing → cancel** answer. `cancelling` stays `cancelling` (Keep is never refused because of a pending change or a stale checkout lock) |
| Q-8 | **Moot**: no switch, so no `featureFlags.ts` / `FEATURE_FLAGS.md` edit in D2 (this also removes a shared hotspot conflict with EXPORT's `isModuleExportEnabled()`) |
| Q-9 | **No D2 work.** SA cannot find a referent either. The nearest candidate is P-7a's C-6 (portal hardening, which carries the "portal cannot cancel" half of SX C-1, and belongs to P-7a.2). TL names it before D4, or it is dropped. It does not block D2 |
| Q-10 | **Confirmed: C-3 goes to D6.** Hand-over addition: D6's detection of a Stripe-side reactivation must read `cancel_at` as well as `cancel_at_period_end`. P-7a's open follow-up says the webhook mirrors only the flag, so a dashboard change made through `cancel_at` alone is invisible today. That follow-up must land before or inside D6 |

### Conditions (binding)

1. **W-1 Drop the switch.** Remove R-10, §3.4, T-2, AC-D2.4, risk R-1, the switch port in `PlanManageDeps`, the step-3 owner check and every `FEATURE_FLAGS.md` / §9.5 edit. The cancel stays gated on `isPlanPriceRecognitionEnabled()` exactly as P-7a C-1 built it. T-12 records in the DELETE requirement's SX-1 as-built note: "`isPlanSelfCancelEnabled()` superseded for the plan cancel by plan-payments P-7a C-1 / BQ-1 (2026-10-26); XC-15 and the SR-10 anchor row for it no longer apply to the cancel". §11 is not edited (it must stay identical to EXPORT's). BA carries the same note into §11 of both files at the next joint splice.
2. **W-2 Do not touch `planManageWire` or `planPurchaseView.ts`.** With W-1 there is no wire change, so T-7 is removed. This keeps D2 off the two hunks P-7a.2 is rewriting.
3. **W-3 `change_pending`, cancel side only.** In `planManageOffer`, the new rules sit **after** the `cancelAtPeriodEnd` branch and **before** `return { kind: 'renewing' }`. A cancelling row with `pending_tier` set still answers `cancelling` (matrix row required). The expired-checkout rule compares `openCheckoutExpiresAt` with the injected `now`, matching the repository's `lte.now`. The header comment states that today neither state can occur (no `pending_tier` writer; no checkout lock with a live subscription) and that the rule is P-7b.2's defence. Logged at warn, never audited, zero Stripe calls (call-order spy).
4. **W-4 The attempt key** as Q-3: built once per call, passed only to the one write, optional in the method signature, never logged. Log `attemptId` only if it is a separate uuid from the key's suffix, or log neither (simpler). Test: two calls produce two different keys, each matching the stated shape, and the key never appears in a logger fake's arguments.
5. **W-5 `origin` moves to D6.** D2 has one caller, so `origin` would be an input with nothing but its default. D6 adds `origin: 'owner' | 'deletion_request'` with its first real caller; an absent `details.origin` on older rows means owner. The AC-D2.6 and R-11 text change to "the engine is route-agnostic; the guard (W-7) makes D6 call it".
6. **W-6 Reason codes.** `planLeaveReasons.ts` stays pure, import-free and client-safe. The codes are checked against the `20261093` `reason_code` CHECK regex in a test. The cancel route forwards the parsed code only. The audit carries the code, never a label or free text. **P-7a.4's immediate cancel must carry the same `details.reasonCode`** (recorded in the coordination file).
7. **W-7 The guard, re-specified.** Over non-test files under `lib/business-os/**` and `app/api/business-os/**`: (a) `setBusinessOsCancelAtPeriodEnd` is referenced only in `planSubscriptionManage.ts`; (b) no file calls `subscriptions.update(` or `subscriptions.cancel(` (the Stripe SDK) directly; (c) no file calls StripeService's legacy `cancelSubscription(` / `reactivateSubscription(`. `StripeService.ts`, the legacy `app/api/stripe/*` routes, the plugin executor and the repositories are outside the scanned roots, so the "exactly one `cancel_at_period_end:`" wording goes. P-7a.4's new immediate-cancel method must also be called only from `planSubscriptionManage.ts`; the guard lists it when P-7a.4 adds it. Pure fs read, milliseconds.
8. **W-8 Docs (T-12).** DELETE requirement: an SX-1 "as built" note covering the names (Q-2), `trialing` (Q-1), the switch superseded (W-1), `origin` → D6 (W-5), C-3 → D6 with the `cancel_at` note (Q-10), and BQ-11 now scoped to the deletion request, with Change History. Plan-payments requirement: the C-1 cross-reference note in the P-7a row ("SX-1 / D2 extends `planSubscriptionManage`; one engine; AC-F8.1 to F8.3 met by P-7a.1") and a Change History row. **No** §9.5 sentence (no switch).
9. **W-9 Order with the plan-payments session** (recorded in the coordination file by SA today): **P-7a.2 merges first** (it is in flight and owns the `planManageWire` change). D2 may be built now, but it is **rebased on `main` after P-7a.2 merges and before it is enqueued**, resolving by keeping both. **P-7a.4 branches from `main` only after D2 merges** (P-7a's own C-12 "never stacked" rule), and decides its immediate path on the fresh status (P-7a.1 deviation-4 note). P-7a.3 does not touch these files and is not ordered against D2. If the plan-payments session needs P-7a.4 first for go-live reasons, it says so in the coordination file and D2 rebases on it instead. Nobody edits these files in parallel.
10. **W-10 Tests and hygiene.** Everything in §6 that survives W-1 and W-5. Add: Reactivate is not refused by `change_pending`; `{ reasonCode }` on `/plan/reactivate` → 400 (its body stays `{}` strict). Apply P-7a's C-12 run list (billing, `app/api/stripe`, `lib/business-os/purge`, `app/api/business-os/billing`, `components/business-os/settings`, `npm run test:bos-entitlements`) and the Connect harness md5 before and after, identical, never `-u`. No added CI time.
11. **W-11 Label hygiene.** Comments and docs written by D2 say "SX C-4", "P-7a C-4", "SX C-3", "P-7a C-3", never a bare "C-n" (both requirement sets use C-1 to C-12).
12. **W-12 Estimate** re-cut to about **1.2 d**: T-3 0.2, T-4 0.15, T-5 0.25, T-6 0.25, T-8 0.15, T-10 + T-11 0.15, T-12 + T-13 0.25. T-2, T-7 and the switch half of T-8 are gone.

### Is D2 still its own slice? (question c)

**Yes, as a small slice. Do not fold it.** D3 (drawer + `planEndingView` + en/he/es) and D6 (two-phase request + Keep + C-3) are each already at the 2.5 d cap, so adding about 1.2 d to either breaks the cap. D2 is also the right place to **settle the engine contract once**, with the reason field, the per-attempt key, the cancel-only `change_pending` and the guard that makes D6 call the engine. That has to happen before P-7a.4 and D6 both edit it. Kept to backend and docs, D2 is a short review.

### Business questions for the user

None needed for D2. For TL to pass on as **information** (not a choice): "The Cancel button in Settings → Plan you approved stays under the same on/off as plan payments. We are not adding a second switch that could hide it."

Still open, needed **before D6** (not now), in plain words: *"If an owner's last card payment failed and they ask to delete their account, what should happen? A: we ask them to fix the card or contact support first (today's suggestion). B: like the plain Cancel you chose, the plan ends now and the deletion goes ahead."*

### Optimisation suggestions (non-blocking)

- `PLAN_MANAGE_REFUSALS.change_pending` copy: "A plan change is in progress. Try again once it is finished." is fine. The he / es versions are D3's (G-5 precedent: the user approves wording).
- Consider exporting the key builder as a small pure function, so the shape test does not reach into the engine.

### Approval

[x] Workplan approved with conditions W-1 to W-12. Dev revises §2 to §8 and §11 for W-1, W-2, W-5, W-7 and W-12 (insert-only or in place, SA rechecks at code review). Then implement. Leave everything uncommitted for SA code review and the user's diff. T-0 is satisfied by this review. T-1 is done by SA (coordination file updated).

## SA Code Review — 2026-10-27

**Code Review by SA — 2026-10-27** (uncommitted diff on `feature/plan-cancel-d2`, base `a105fa4a`, worktree `neuronforge-d2`)
**Status:** ⚠️ Approved with fixes. **F-1 is a real compile error** that no CI job would catch; F-2 and F-3 are small. SA re-checks F-1 only (no full re-review).

### What SA re-ran (not taken from the Implementation Notes)

| Check | Result |
|---|---|
| P-7a C-12 run list (`lib/business-os/billing`, `lib/stripe`, `app/api/stripe`, `lib/business-os/purge`, `app/api/business-os/billing`, `components/business-os/settings`), incl. `oneDontRenewPath.guard.test.ts` | ✅ 140 suites / 5804 tests, 116 snapshots |
| `npm run test:bos-entitlements` | ✅ 313 suites / 9399 tests |
| Focused `tsc` over the touched files **and their importers** (`planManageCopy.ts`, `PlanManage.tsx`, `planPurchaseView.ts`, the reactivate route, all touched tests) | ❌ **1 error**: `components/business-os/settings/planManageCopy.ts(19,14) TS2741: Property 'change_pending' is missing` (F-1). Everything else clean |
| `console.*` in touched non-test files | ✅ 0 in all six |
| Not touched: `featureFlags.ts`, `FEATURE_FLAGS.md` / `feature_flags.md`, `planPurchaseView.ts`, `planManageWire`, `eventAudience.ts`, the reactivate route | ✅ (`git diff --quiet`); `planManageWire` body unchanged (W-2) |
| No `origin` input (W-5) | ✅ Only a header comment saying D6 adds it |
| Entitlements imports | ✅ The only new one is `TIER_ORDER` in a test file (exempt per the skill); the cancel route's `resolveAccountId` import is pre-existing and registered |

### Conditions W-1 to W-12: as built

| W | Verdict |
|---|---|
| W-1 no switch | ✅ Cancel still gated on `isPlanPriceRecognitionEnabled()` only |
| W-2 no wire / view edits | ✅ `change_pending` reaches the screen through the untouched `planPurchaseView` → `planManageWire` → `null` (no control), as `period_over` |
| W-3 cancel side only, after the cancelling branch, `now` comparison, header comment | ✅ `hasPendingChange` sits after the `cancelAtPeriodEnd` branch; engine step 5 refuses only `action === 'cancel'` and `break`s for reactivate; warn-logged, zero Stripe calls, not audited (route test + engine test + matrix). Header says neither state can happen today and it is P-7b.2's defence |
| W-4 key | ✅ `planManageAttemptKey` pure + exported; `randomUUID` via the `newAttemptId` port, once per call and only when the write is reached; key passed only to the write; in no log context (`safeErr` copies only name / type / code / status / requestId) and in no audit details (route test asserts it) |
| W-5 `origin` → D6 | ✅ |
| W-6 reason codes | ✅ `planLeaveReasons.ts` import-free (test pins it); every code matched against the CHECK regex **read from 20261093** (a change to the migration fails the test); route forwards the parsed enum only; reactivate always `null` |
| W-7 guard | ✅ (a), (b), (c) over `lib/business-os/**` + `app/api/business-os/**` non-test files; non-vacuity asserts the engine and the cancel route are in the scanned set and > 100 files. Pure fs read |
| W-8 docs | ✅ DELETE §6.2 as-built paragraph covers Q-2 names, Q-1 `trialing`, W-1 superseded switch, W-5, SX C-3 + `cancel_at`, BQ-11 scope; §11 untouched. Plan-payments P-7a row note + Change History; no §9.5 sentence |
| W-9 order | ⬜ Rebase on `main` after P-7a.2 merges, before enqueue. **New touchpoint from F-1:** P-7a.2 also edits `planManageCopy.ts` (and the translations), so resolve by keeping both |
| W-10 tests | ✅ Reactivate not refused by `change_pending` (matrix + engine + route); `/plan/reactivate` with `{ reasonCode }` → 400; run list and entitlements green |
| W-11 labels | ⚠️ One bare label in new D2 text (F-3) |
| W-12 estimate | ✅ Proportionate diff (+223 / −20 plus four new files) |

### Code Review Comments

1. `components/business-os/settings/planManageCopy.ts:19` — **compile error.** Adding `'change_pending'` to `PlanManageRefusalCode` leaves `PLAN_MANAGE_REFUSAL_KEYS` (typed `Record<PlanManageRefusalCode | …, string>`) without a key: TS2741. The file's own header says "a new refusal code fails the build until it is given a line here", but `next.config.js` ignores type errors and no required CI job type-checks this path (Jest does not type-check), so it would have merged silently. Dev's "0 errors in touched files" checked only the touched files, not their importers. **Fix (F-1):** add `change_pending: 'plan.manage.refusal.unavailable'` (an existing key, "This is not available right now. Please try again later.", already in en / he / es), so D2 adds **no** translation string and no G-5 wording round; D3 may give it its own line with the drawer. **And** add a runtime parity test (e.g. `components/business-os/settings/__tests__/planManageCopy.test.ts`, with `jest.mock('@/lib/supabaseServer', …)` as in `planCancelEngine.d2.test.ts`): every key of `PLAN_MANAGE_REFUSALS` is an own key of `PLAN_MANAGE_REFUSAL_KEYS`. That turns the header's promise into a Jest failure, which CI does run. Re-run the focused `tsc` over importers. — Priority: **High**
2. Dev open item 2 (a STALE row that says cancelling while Stripe says renewing passes step 5 as `cancelling` and skips `change_pending`) — **SA ruling: do not fix in D2.** It needs two conditions together, and one of them (`pending_tier` non-null) has no writer until P-7b.2. P-7b.2 is the slice that must decide what a cancel does to a scheduled downgrade (refuse, or clear it), and a check added now would likely be the wrong shape for that decision. The suggested fix is also not free: re-checking pending facts at step 5 regardless of the offer would turn today's correct `unchanged` (row cancelling, Stripe cancelling) into a 409. **Fix (F-2):** record it, insert-only, as a hand-over row to **P-7b.2** in §12 ("cancel with a scheduled downgrade: decide refuse vs clear; and close the stale-row path where step 5 answers `cancelling` while Stripe is renewing, by re-checking our pending facts after step 7, only when the write would happen"). — Priority: Low
3. Dev open item 3 (an open checkout with a session id but NULL expiry counts as open) — **SA ruling: accept as built.** It is unreachable: migration `20261025` has `business_os_billing_accounts_checkout_lock_pair CHECK ((open_checkout_session_id IS NULL) = (open_checkout_expires_at IS NULL))`. It also matches the repository's own lock rule (`open_checkout_session_id.is.null,open_checkout_expires_at.lte.<now>`), under which a NULL expiry is not "expired" either. Failing closed on a cancel while never touching Keep is the right direction. No change. — Priority: none
4. `lib/business-os/billing/planSubscriptionManage.ts` step 5, new `case 'change_pending'` comment — "(our row says renewing, but it may be stale, C-2)" is a bare label in D2-written text (W-11). **Fix (F-3):** "P-7a C-2". Pre-existing bare labels elsewhere in the file are P-7a.1's and not D2's to change. — Priority: Low
5. `lib/stripe/StripeService.ts` `setBusinessOsCancelAtPeriodEnd` — the two-branch call means a missing or empty key sends exactly P-7a.1's two-argument request; pinned by the service test (whole-object params assertion kept). Good; no change. — Priority: none
6. `app/api/business-os/billing/plan/cancel/route.ts` — Zod `.strict()` with an optional enum before any read (the 400 tests assert `state.log` empty); `reasonCode` reaches the audit only through the engine facts; correlationId, `logAndFlush` before the response, error format unchanged. Compliant with `new-api-route`. — Priority: none

### Optimisation Suggestions (non-blocking)

- Process: when a change widens an exported union, run the focused `tsc` over the **importers** (`grep -rl` the type name), not only the touched files. It is the only type gate this path has.
- The two requirement Change History rows are dated 2026-10-26 for work done 2026-10-27: harmless; correct at the W-9 rebase if convenient.

### Rulings on Dev's open items

| # | Ruling |
|---|---|
| 2 | Defer to P-7b.2, recorded as a hand-over (F-2). Not a D2 defect |
| 3 | Accept as built; unreachable under the 20261025 pair CHECK and consistent with the repository's lock rule |

### What QA must exercise

1. **F-1 after the fix:** the parity test fails if a `PLAN_MANAGE_REFUSALS` key is removed from `PLAN_MANAGE_REFUSAL_KEYS` (mutate locally, then revert); focused `tsc` over `planManageCopy.ts` is clean.
2. Cancel route: `{}` → 200 with audit `details.reasonCode: null`; each of the seven codes → 200 with that code in the audit; an unlisted code, label text, a number, an extra `note` key, an injected `userId` → 400 with zero reads; reactivate with `{ reasonCode }` → 400.
3. `change_pending`: a renewing row with `pending_tier`, or with an unexpired checkout lock → 409 `change_pending`, zero Stripe calls, no audit row, warn log; an expired lock → the cancel proceeds; a cancelling row with either fact → Keep succeeds; a renewing row with a pending fact while Stripe is (stale) cancelling → Keep repairs it. The Settings → Plan screen shows no Cancel control in that state (wire `null`).
4. Idempotency: cancel → keep → cancel within one fake day makes three writes under three distinct keys of the stated shape; a double press consumes one key; neither the key nor its uuid appears in any log line or audit row; without a key the Stripe request is the two-argument P-7a.1 shape.
5. Guard: add `setBusinessOsCancelAtPeriodEnd(` to a scratch non-test file under `app/api/business-os/` and see (a) fail; the same for `stripe.subscriptions.update(` (b) and `cancelSubscription(` (c); revert.
6. Regression: the P-7a C-12 run list, `npm run test:bos-entitlements`, and the Connect harness md5 unchanged (never `-u`).
7. No live Stripe demo is needed for D2 (no behaviour change on any reachable path beyond the reason code in the audit and the per-attempt key). If TL wants one: a sandbox cancel with `{ reasonCode: 'too_expensive' }`, then check the audit row carries it.

### Code Approved for QA: Yes, after F-1 (SA re-check of F-1 only). F-2 and F-3 may land in the same pass without re-review.

**SA re-check — 2026-10-27: ✅ F-1 closed. Code approved for QA.** `planManageCopy.ts` now maps `change_pending` to the existing `plan.manage.refusal.unavailable` line, so there is no new wording. `__tests__/planManageCopy.test.ts` checks three things: every `PLAN_MANAGE_REFUSALS` code has a line, `change_pending` resolves to that line, and every key it names exists in `en`. It passes 3/3. Focused `tsc` over the 16 touched files and importers gives **0 errors**.
The `app/api/payments/stripe-connect/` errors are pre-existing. That tree is identical to `origin/main` (`git diff --quiet`). The spot-checked `delete/route.ts(77)` and `disconnect/route.ts(72)` both fail with TS2322 `'stripe_connect_account'` (not an allowed audit entity type), and D2's edit to `events.ts` is comment-only.

## QA Testing Report

_QA populates this section._

## QA Report — 2026-10-27

**QA — 2026-10-27** (uncommitted diff on `feature/plan-cancel-d2`, worktree `neuronforge-d2`, base `a105fa4a`)
**Test mode:** full
**Strategy used:** A + B. Unit tests, plus route integration through the real cancel and reactivate routes and the real engine, with fakes only at the edges. Mutation probes check that the parity test and the guard are not vacuous.
**Focus:** api, schema, security
**Skipped:** item 7, the sandbox demo. The worktree has no `.env` / `.env.local`, so no Stripe test key is configured. Live keys are never used. SA rules no demo needed.
**Input source:** TL prompt (SA code review, "What QA must exercise" items 1–6)

### Test Coverage

| # | Item (SA "What QA must exercise") | Tested? | Result | Notes |
|---|---|---|---|---|
| 1a | F-1 parity test fails when a key is removed | ✅ | Pass | Two mutations of `planManageCopy.ts` (backup to scratch, then restore, md5 `101149b0…` before = after). Removing `change_pending` gives 2 failed / 1 passed. Removing `upgrade_pending` (a generic key) gives 1 failed / 2 passed (the parity test) |
| 1b | Focused `tsc` over `planManageCopy.ts` is clean | ✅ | Pass | Scratch tsconfig extending the project config over all 21 `app/lib/components` importers of `planManageCopy` / `planSubscriptionManage` / `planManageOffer` / `planLeaveReasons`, plus `StripeService.ts` and its test: **0 errors**. Not vacuous: with the `change_pending` line removed, the same run reports `planManageCopy.ts(19,14) TS2741` |
| 2a | `{}` → 200, audit `details.reasonCode: null` | ✅ | Pass | The key is present with the value null, not absent |
| 2b | Each of the 7 codes → 200 with that code in the audit | ✅ | Pass | 7 cases, one write each. The list is pinned to the seven BQ-7 codes |
| 2c | Unlisted code / label / number / extra `note` / injected `userId` → 400, nothing read | ✅ | Pass | 13 cases: unlisted, upper case, English label, Hebrew label, number, `''`, `null`, an array, `note` beside a valid code, `userId` beside a code, `userId` alone, `subscriptionId` beside a code, `accountId` beside a code. All give 400 `invalid_input`, with an empty repository and Stripe log and no audit |
| 2d | Reactivate with `reasonCode` → 400 | ✅ | Pass | All 7 codes give 400, nothing read. Reactivate's audit has no reason (the details are unchanged from P-7a.1) |
| 3a | Renewing row + `pending_tier` → 409, zero Stripe calls, no audit, warn log | ✅ | Pass | At the route. The body message matches. Exactly one warn line has `code: 'change_pending'`, and it does not contain the reason code |
| 3b | Renewing row + unexpired checkout lock → 409 (same checks) | ✅ | Pass | At the route. This was a gap: before, only the engine and matrix covered it |
| 3c | Expired lock → cancel proceeds | ✅ | Pass | Route 200 `cancelled`, audited |
| 3d | Cancelling row + either fact → Keep succeeds | ✅ | Pass | Both facts: one retrieve, one write `false` |
| 3e | Stale renewing row + pending fact, Stripe cancelling → Keep repairs it | ✅ | Pass | Both facts: the write `false` reaches Stripe |
| 3f | The screen shows no Cancel in that state | ✅ | Pass | `planManageWire(planManageOffer(…))` is `null` for `pending_tier` and for an unexpired lock. An expired lock shows Cancel. Cancelling + pending shows Keep. The matrix test also covers this through the real `readPlanPurchaseView` |
| 4a | cancel → keep → cancel = 3 writes, 3 distinct keys `bos-plan-manage:{sub}:{action}:{uuid}` | ✅ | Pass | Through the routes, with a stateful fake Stripe. The actions are `cancel`, `reactivate`, `cancel`. The write is always called with 3 arguments |
| 4b | Double press = 1 key | ✅ | Pass | The second press answers `unchanged`. One key, one audit row |
| 4c | Key / uuid never in logs or audit | ✅ | Pass | The route test captures **every** logger line (route and engine child loggers). No full key and no uuid appears in the logs or the 3 audit rows |
| 4d | No key → the original 2-argument Stripe request | ✅ | Pass | `businessOsPlanCancel.test.ts`: with no options, `{}`, or `idempotencyKey: ''`, the `subscriptions.update` call is exactly `['sub_1', { cancel_at_period_end }]` |
| 5 | Guard negatives (a), (b), (c) | ✅ | Pass | Each scratch non-test `.ts` under `app/api/business-os/__qa_scratch/` failed exactly its own test: `setBusinessOsCancelAtPeriodEnd(` (a), `subscriptions.update(` (b), `subscriptions.cancel(` (b), `cancelSubscription(` (c), `reactivateSubscription(` (c). A `.tsx` under `lib/business-os/__qa_scratch/` failed (a). Scratch directories removed, and the guard is back to 6/6 |
| 6a | P-7a C-12 run list | ✅ | Pass | **142 suites / 5847 tests / 116 snapshots** passed. That is Dev's 141 / 5807 plus the QA file (1 / 40). `--ci`, no `-u` |
| 6b | `npm run test:bos-entitlements` | ✅ | Pass | **313 / 9399** passed after the allowlist fix below. The first run was red only because of the new QA test file, not the D2 code |
| 6c | Connect harness snapshot md5 | ✅ | Pass | `ab7528ea68309cffb309ffbd46c455ab` before and after every run. Never `-u` |
| — | `lib/repositories` (outside the C-12 list) | ✅ | Pass | 120 / 2896 |

### Tests added by QA (test code only, no production code)

| File | What |
|---|---|
| `app/api/business-os/billing/plan/cancel/__tests__/route.d2.qa.test.ts` (new) | 40 tests: items 2, 3 and 4 through the real routes, with a capturing logger and a stateful fake Stripe |
| `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts` (+3 lines) | Adds the new QA test file to the "only the listed files name the repository" allowlist, with a comment. It fakes the repository module by name, as `route.test.ts` already does |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None.

#### Edge Cases (nice to fix)

1. **The one-path guard can be evaded by syntax it does not scan.** File: `lib/business-os/billing/__tests__/oneDontRenewPath.guard.test.ts`. Severity: Low.
   - Each of these scratch files passed the guard (6/6 green): `stripe.subscriptions['update'](…)` (bracket access, which escapes (b)), and a `.js` file calling `setBusinessOsCancelAtPeriodEnd(` (only `.ts` / `.tsx` are scanned, and `allowJs` is on).
   - A guard of this kind cannot be complete, and nobody writes code this way by accident.
   - Optional hardening: also scan `.js` / `.mjs` files, and match `subscriptions\s*(\.\s*|\[\s*['"])update`.
2. **Process note: the C-12 run list misses the repository caller guard.** Severity: Low.
   - A new test that fakes `BusinessOsBillingAccountRepository` by name passes the whole C-12 list. It fails only in `lib/repositories` (`test:bos-entitlements` and the CI Jest run catch it).
   - Add `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts` to the run list for billing slices.
3. **Reactivate's audit omits `reasonCode`, while cancel always has it (null or a code).** Severity: none (as designed).
   - This matches §3.5, which keeps reactivate's details unchanged. The engine facts carry null.
   - D6 and admin readers should treat a missing value as null.

### Test Outputs / Logs

```text
planManageCopy.test.ts, change_pending line removed:   Tests: 2 failed, 1 passed, 3 total
planManageCopy.test.ts, upgrade_pending line removed:  Tests: 1 failed, 2 passed, 3 total
focused tsc (21 importers + StripeService), clean:     0 errors (exit 0)
focused tsc, change_pending line removed:              planManageCopy.ts(19,14): error TS2741
route.d2.qa.test.ts:                                   Tests: 40 passed, 40 total
oneDontRenewPath guard, each scratch probe:            Tests: 1 failed, 5 passed, 6 total (x6)
C-12 run list:                                         Test Suites: 142 passed; Tests: 5847 passed; Snapshots: 116 passed
npm run test:bos-entitlements:                         Test Suites: 313 passed; Tests: 9399 passed
lib/repositories:                                      Test Suites: 120 passed; Tests: 2896 passed
connectPath.characterisation.test.ts.snap md5:         ab7528ea68309cffb309ffbd46c455ab (unchanged)
```

Full `npm test -- --ci` (informational, not a D2 gate): 1729 passed, 25 failed, 8 skipped suites; 44686 passed, 146 failed tests.

- None of the 25 failing suites imports a module D2 changed, and none sits in a D2 path.
- The failures are in `lib/pilot`, `lib/agentkit`, `lib/orchestration`, CRM / onboarding / scheduling source guards, and similar areas.
- 24 of the 25 still fail when run alone. The worktree has `core.autocrlf=true`, the known local CRLF failure class for source scans.
- QA did not re-run them on bare `a105fa4a` (no stash allowed). They are not attributed to D2.

### Final Status

- [x] All acceptance criteria pass, ready for commit. QA items 1–6 pass, no bugs, and item 7 is skipped with reason. W-9 (rebase on `main` after P-7a.2, keeping both `planManageCopy.ts` edits) still applies before enqueue.
- [ ] Issues found, Dev must address before commit

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-26 | Workplan written (Dev) | D2 / SX-1 on `feature/plan-cancel-d2` from `a105fa4a`. Finding: P-7a.1 (#519) already shipped the engine (Stripe method, orchestration, cancel / reactivate routes, mirror, audit, screen). Plan adopts it as the one "don't renew" path and adds SA-2 gaps (`pending_tier`, open checkout), a per-attempt key (C-4), reason code + origin in audit (SA-4), `origin` for DL-1b, `isPlanSelfCancelEnabled()` (new owner cancels only), a one-write-site guard and an SA-6 pin. No migration. C-3 placed in D6. 13 tasks, ≈ 2.1 d. Q-1…Q-10 for SA |
| 2026-10-26 | SA workplan review (SA) | ⚠️ Approved with conditions W-1…W-12. P-7a's later, built rulings win on the plain cancel (C-1/BQ-1 switch, TQ-14 trialing, AM-7 audit keys, BQ-3 failed payment). `isPlanSelfCancelEnabled()` dropped (would hide the merged Cancel; superseded by BQ-1). `origin` → D6. `change_pending` cancel side only. Guard re-specified (the one-write-site claim was false). Order: P-7a.2 → D2 → P-7a.4. D2 kept as its own ≈ 1.2 d slice. Coordination file updated |
| 2026-10-27 | Revised for W-1/2/5/7/12, then implemented (Dev) | §2–§8, §11 revised (no switch, no `origin`, no wire/view edits, guard re-specified, ≈ 1.2 d). Built uncommitted: `planLeaveReasons.ts`, per-attempt key, cancel-side `change_pending`, `details.reasonCode`, one-path guard, SA-6 pin, doc notes in both requirements. C-12 run list 140 suites / 5804 tests, `test:bos-entitlements` 313 / 9399, harness md5 unchanged, tsc 0 errors in touched files. Awaiting SA code review; rebase after P-7a.2 merges (W-9) |
| 2026-10-27 | SA code review (SA) | ⚠️ Approved with fixes. F-1 (High): `planManageCopy.ts` TS2741, `change_pending` missing from `PLAN_MANAGE_REFUSAL_KEYS`; map to the existing `plan.manage.refusal.unavailable` key + a runtime parity test. F-2: Dev open item 2 deferred to P-7b.2 as a §12 hand-over. F-3: bare "C-2" label. Open item 3 accepted (unreachable under the 20261025 pair CHECK). SA re-ran: C-12 list 140 / 5804, `test:bos-entitlements` 313 / 9399 |
| 2026-10-27 | SA code review fixes (Dev) | F-1: `change_pending` → existing `plan.manage.refusal.unavailable` in `planManageCopy.ts`, plus the runtime parity test `planManageCopy.test.ts` (shown to fail with the line removed, then reverted). F-2: §12 hand-over row to P-7b.2. F-3: "P-7a C-2" label. Typecheck over touched files and importers: F-1 gone, nothing new. Billing run list 141 / 5807, `test:bos-entitlements` 313 / 9399, harness md5 unchanged |
| 2026-10-27 | QA (QA) | ✅ Items 1–6 pass, no bugs, item 7 skipped (no local test key). F-1 parity test and focused tsc both proven non-vacuous by mutation; 40 route-level gap tests added (`route.d2.qa.test.ts`) plus a test-only allowlist line in the billing repository caller guard; guard negatives (a)/(b)/(c) each fail; C-12 list 142 / 5847 / 116 snapshots, `test:bos-entitlements` 313 / 9399, harness md5 unchanged. 3 low edge cases (guard evasion via bracket access / `.js`, run list misses the repository guard, reactivate audit omits `reasonCode`) |
