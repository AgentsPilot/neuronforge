# Workplan: Business OS Plan Payments follow-ups: dashboard cancellations are mirrored (C-3) + past cohort end guard (FU-P7a4-5)

> **Last Updated**: 2026-10-30

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md), §9.1 P-7a row (the C-3 / X-2 follow-up). Source of both items: [P-7a workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md). C-3 is defined in the SA conditions (lines ~193 and ~1036), X-2 (~529), the C-3 verdict (~1106), F-1 (~1133) and "Carried forward" (~1169). FU-P7a4-5 is in the P-7a.4 merge review (~1684).
**Depends on:** D4b merged (#569). Its claim (`20261100`) and `markCancelReminderCovered` are the reminder half of the C-3 analysis.
**Date:** 2026-10-30
**Branch:** `fix/bos-plan-payments-followups-c3`, worktree `neuronforge-ppfu`, from `main` `a0804002` (#569). Confirmed with `git branch --show-current` on 2026-10-30. Highest migration on that main: `20261100`.
**Status:** Code Complete 2026-10-30, uncommitted. SA workplan review: approved with changes (W-1 to W-9, applied). Awaiting SA code review. W-5 production count owed by TL (see Implementation Notes).

## Overview

This slice has two small follow-ups left open by P-7a.

1. **C-3: mirror cancellations made in the Stripe dashboard.** The dashboard's "cancel at end of period" can set `cancel_at` alone and leave `cancel_at_period_end` false (X-2, sandbox, 2026-10-26). Our status mirror copies only the flag, so an owner cancelled in the dashboard shows as Active in the admin lists and MRR. My-plan also tells them their plan renews, and D4b never reminds them. The in-app engine and the D4b choke point already read "the flag OR `cancel_at`" on Stripe's fresh answer. This slice makes the **stored** flag mean the same thing.
2. **FU-P7a4-5: never show a cohort end that has passed.** On a `failing` row (`unpaid`, long past `tierExpiresAt`), `freeAccessAfterPaidTier` checks the cohort at the old tier end, so the Cancel sentence can show a Founding Partner end date that has already gone. The guard is `endsAt > now` in the my-plan view.

**Recommendation:** C-3 option (a). The stored `cancel_at_period_end` holds one derived rule. **No migration.** **No change to the webhook route or the Connect harness.** **Estimate: about 0.75 dev-day** in total, as one PR.

## Table of Contents

- [1. Analysis](#1-analysis)
- [2. C-3 design: options and recommendation](#2-c-3-design-options-and-recommendation)
- [3. C-3 implementation](#3-c-3-implementation)
- [4. FU-P7a4-5: past cohort end guard](#4-fu-p7a4-5-past-cohort-end-guard)
- [5. Gates, CI time and estimate](#5-gates-ci-time-and-estimate)
- [6. Questions for SA](#6-questions-for-sa)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis

### 1.1 Who writes `business_os_billing_accounts.cancel_at_period_end`

| Writer | Value written today | File |
|---|---|---|
| Webhook status mirror (`customer.subscription.updated` / `.deleted`, also on a reconcile Step A replay) | `fresh.cancelAtPeriodEnd` from a FRESH `retrieveBusinessOsSubscription` | `lib/business-os/billing/planSubscriptionMirror.ts` → `BusinessOsBillingAccountRepository.mirrorSubscriptionState` |
| In-app engine: write, heal on `unchanged`, P-7a.4 end-now | `after.cancelAtPeriodEnd` / `fresh.cancelAtPeriodEnd` (4 call sites of the local `mirror()`) | `lib/business-os/billing/planSubscriptionManage.ts` lines ~408, ~423, ~468, ~545 |
| Paid-invoice apply RPCs (replacement subscription) | `false` on replacement, else kept | `20261027_…billing_events.sql`, `20261028_…first_payment_stamp.sql` (not changed) |
| Repository resets (new checkout) | `false` | `BusinessOsBillingAccountRepository.ts` ~633, ~721 (not changed) |

`retrieveBusinessOsSubscription` **already returns** `cancelAt` and every item's `currentPeriodEnd` (added in P-7a.1). So the mirror needs no new Stripe call, only a different value from the read it already makes.

### 1.2 Who reads it

| Reader | What it does with it | Effect of C-3 option (a) |
|---|---|---|
| `lib/admin/billing/subscriptionsView.ts` `subscriptionStatuses` (Subscriptions list, billing panel) | `cancelling` / `active` | Correct without a code change |
| `subscriptionsView.ts` `billingDisagreements` (3a "Disagrees") | Does **not** read the flag (tier and paid-through only) | None |
| `lib/business-os/billing/planMrr.ts` | `cancelling` count | Correct without a code change |
| `planReconcilePass.ts` Step B `cancel_flag_differs` | `row.cancel_at_period_end !== subscription.cancelAtPeriodEnd` (raw Stripe flag) | **Must change** to compare against the same derived rule, or every dashboard cancellation becomes a false nightly finding (§3.2) |
| `planPurchaseView.ts` (`ending` state), `planManageOffer.ts` (`cancelling` → Reactivate), `planCheckoutEligibility.ts` (`cancelling`), `planUpgrade.ts` ~454 (row) | My-plan / PlanManage / checkout | Correct without a code change |
| `planSubscriptionManage.ts` step 7 heal: `rowDisagrees = ownRow.cancelAtPeriodEnd !== fresh.cancelAtPeriodEnd` | Heals our row | **Must change**. Otherwise the owner's press would compare against the raw flag and "heal" a correctly mirrored dashboard cancellation back to `false` (§3.2) |
| D4b claim `claim_bos_plan_cancel_reminders` (`20261100`): `WHERE c.cancel_at_period_end AND …`, partial index on it | Picks rows to remind | Unchanged SQL; it starts finding dashboard cancellations (§2.3) |
| `markCancelReminderCovered` CAS `.eq('cancel_at_period_end', true)` | The D4a email covers the reminder | Unchanged (§2.3) |
| D4a plan-cancel emails (`planCancelEmail.ts`) | Sent from the cancel / reactivate **routes** only, never from the mirror or the dashboard (S-6) | None |
| `billingPanelView.ts`, `planTestClock.ts` | Display / test clock | Correct without a code change |
| Legacy `app/api/stripe/webhook/route.ts:366`, `UserSubscriptionRepository`, `components/settings/BillingSettings.tsx`, `app/api/stripe/{cancel,reactivate}-subscription` | **`user_subscriptions`**, the AgentsPilot app's table, not Business OS | Out of scope |

Readers of Stripe's **fresh** flag, not the column: `planSubscriptionManage.isCancelling` and `planCancelReminderPass.isCancelling` already read "flag OR `cancel_at`". `planUpgrade.ts:290` reads the raw flag only (see Q-5).

### 1.3 API versions and fixtures

- The mirror and the reconcile list read the subscription through **our** SDK calls (`subscriptions.retrieve` / `.list`) at the pin `2025-10-29.clover`, not from the event payload. `cancel_at` is a long-standing Subscription field. It is in the SDK type (the P-7a.1 code compiles on it), in the captured `2025-09-30.clover` fixtures (`captured-customer-subscription-created.json`, `-deleted.json`) and in every captured `2026-09-30.endive` subscription fixture (`"cancel_at": null`).
- **`PLAN_HANDLER_VERIFIED_EVENT_SHAPES` is not changed**: no new version and no new type. The handler reads no new field from the event.
- **The C-6 field check (`planStripeFields.c6.test.ts`) has a gap.** `FIELDS_READ.subscription` lists `cancel_at_period_end` but not `cancel_at`, although the code has read it since P-7a.1. This slice adds it. Two **hand-built** clover fixtures lack the field (`customer-subscription-updated.json`, `customer-subscription-deleted.json`), so they get `"cancel_at": null`. **Captured fixtures are never edited.** If one of them lacks the field, stop and return to SA.

### 1.4 Webhook route and Connect harness

- `app/api/stripe/webhook/route.ts` is **not touched**. The change is inside the plan handler's mirror (`lib/`), which the route already calls through `BUSINESS_OS_FLOW_HANDLERS.plan`.
- The Connect harness (`connectPath.characterisation.test.ts`) mocks `StripeService` with `constructWebhookEvent` only, so it never reaches the plan mirror. Its "platform `customer.subscription.updated`" cases are the legacy `user_subscriptions` path. The mirror's Supabase chain shape is also unchanged (the same three columns, a different boolean). Under the P-8b "Connect evidence" rules: run `--ci`, expect all tests and snapshots to pass, `.snap` unchanged in git, never `-u`. Any snapshot diff is a stop and a return to SA.

---

## 2. C-3 design: options and recommendation

### 2.1 The rule (both options need it)

One pure predicate, **`isSetToEndThisPeriod(facts)`**, in a new import-free file `lib/business-os/billing/subscriptionCancelling.ts`, as `planManageOffer.ts` is import-free:

```text
periodEnd = the LATEST item current_period_end of the same read (clover: the period is on the item)
cancelling =  cancelAtPeriodEnd
           OR (cancelAt is a positive number AND (periodEnd is null OR cancelAt <= periodEnd))
```

| Case | Stored flag | Why |
|---|---|---|
| Flag true (in-app cancel; X-2: Stripe also sets `cancel_at` = period end) | `true` | As today |
| `cancel_at` = period end, flag false (dashboard "end of period", `max_period_end`) | `true` | The C-3 fix |
| `cancel_at` **before** the period end (dashboard custom date, ends early) | `true` | It will not renew. Our lifecycle runs to the paid-through date (SA-P8), so "You keep {plan} until {current_period_end}" stays true for access. D4b's choke point compares Stripe's end (`cancel_at`) with our row's period end, finds them different and releases the row (`periodMismatch`), so no wrong-date reminder goes out |
| `cancel_at` **after** the period end (renews at least once more) | `false` | Saying "ends" would promise no further charge, which is untrue. At the next renewal the period moves forward, and once `cancel_at <= periodEnd` the next `.updated` / invoice event mirrors `true` |
| `cancel_at` set, no item period end readable | `true` | It has an end date, and "cancelling" is the honest state. It only shows Reactivate, which clears `cancel_at` (X-2) |
| Neither | `false` | As today |

The mirror's info log gains `cancelSource: 'flag' \| 'cancel_at' \| 'cancel_at_after_period' \| null`, ids only, so an operator can see a dashboard cancellation in the logs.

### 2.2 Option (a): derive into the existing column (recommended)

| Concern | Under (a) |
|---|---|
| Migration | **None** |
| Webhook mirror | Writes `isSetToEndThisPeriod(fresh)` instead of `fresh.cancelAtPeriodEnd` |
| Engine mirror and heal | The local `mirror()` derives the same way. `rowDisagrees` compares the row with the derived value, so a press never undoes a dashboard cancellation |
| Step B | `listBusinessOsSubscriptionsByPrice` returns `cancelAt`. `cancel_flag_differs` = `row.cancel_at_period_end !== isSetToEndThisPeriod(subscription)`. The finding keeps its meaning: our row differs from what the mirror would write now. Rows cancelled in the dashboard **before** this fix show up nightly as `cancel_flag_differs` until any later event, or an owner's press, heals them. That is the backfill signal (Q-3) |
| Step A replay | Same handler, same rule: consistent by construction |
| D4b claim | SQL unchanged. A dashboard end-of-period cancellation now has `cancel_at_period_end = true`, so it is claimed. The choke point re-reads Stripe and already accepts "the flag OR `cancel_at`", and `cancel_at` = our period end, so **the owner gets the 3-day reminder**. An early custom date is released as `periodMismatch` (no send). A later date is never claimed (stored `false`) |
| `markCancelReminderCovered` CAS | Unchanged. It runs only after an **in-app** cancel email, when Stripe set the flag itself, so `.eq('cancel_at_period_end', true)` still matches. A dashboard cancellation sends no D4a email, so it is never "covered", and the reminder is the owner's only notice. That is the intended effect (Q-2) |
| D4a emails | Untouched (routes only) |
| Cost | About 0.5 day |

The loss: the column's name says "at period end", but it now also holds the early `cancel_at` case. A comment on the repository method and the mirror header records this, and the end date shown stays our paid-through date.

### 2.3 Option (b): a new `cancel_at` column

| Concern | Under (b) |
|---|---|
| Migration | `20261101_business_os_billing_cancel_at.sql` (next free after `20261100`, checked with `ls supabase/migrations`): `ADD COLUMN cancel_at timestamptz NULL`, a column `GRANT UPDATE` to `service_role`, and a pre-check and checker. **The existing checker `scripts/check-bos-billing-accounts-migration.sql` pins the exact column signature (line ~208) and the service UPDATE listing (~249), so it must be re-baselined** |
| Mirror / repository | `mirrorSubscriptionState` gains a fourth column, and each of the 5 callers passes it |
| Every reader | Each of the ~8 readers in §1.2 must compute "flag OR `cancel_at` within the period" itself, or through a shared helper over two columns, so there are more places for the rule to drift |
| Step B | Two comparisons (the flag and `cancel_at`), and a new finding kind `cancel_at_differs` with its count key (the run record has a 1,024-byte budget) |
| D4b claim | `CREATE OR REPLACE` of `claim_bos_plan_cancel_reminders` with `(cancel_at_period_end OR cancel_at IS NOT NULL)`. The partial index is rebuilt and the `20261100` post-condition / checker string (`WHERE (cancel_at_period_end AND (ended_at IS NULL))`) changes |
| `markCancelReminderCovered` CAS | It would need "flag OR `cancel_at`" in an UPDATE filter, which is an UPDATE with `.or()`, the known PostgREST hazard (42703). Two CAS attempts or an RPC would avoid it. More surface |
| Gain | The exact early-end date could be shown. Nobody asked for that, and access follows the paid-through date anyway |
| Cost | About 1.5 to 2 days, a migration for the user to apply, and a SECURITY DEFINER function replaced |

**Recommendation: (a).** The truth needed is "this plan will not renew", and our dates already come from the paid-through date, so one boolean holds it. (b) adds a migration, re-baselines two checkers, replaces a claim function and needs an `.or()` CAS, to store a date that no screen needs.

### 2.4 AM-7 "who cancelled" (TQ-9): OUT

Auditing a dashboard cancellation would need the row's **previous** flag. `mirrorSubscriptionState` is a CAS that returns a count only (no `.select()` on an UPDATE, by rule), so we would need a read before the write with a race-safe compare, a new audit event registered in `lib/audit/events.ts` with its metadata, and an actor rule (dashboard user vs Stripe dunning). The end is already audited (`BOS_BILLING_SUBSCRIPTION_ENDED` with Stripe's `cancellation_reason`), and the new `cancelSource` log line shows that a cancellation came from outside the app. Not trivial, so it stays a recorded follow-up (**FU-C3-1**).

---

## 3. C-3 implementation

### 3.1 Files

| File | Action | Reason |
|---|---|---|
| `lib/business-os/billing/subscriptionCancelling.ts` | create | The ONE pure predicate `isSetToEndThisPeriod` and `cancelSourceOf` (import-free) |
| `lib/business-os/billing/planSubscriptionMirror.ts` | modify | Write the derived value; log `cancelSource`; header step 4 text |
| `lib/business-os/billing/planSubscriptionManage.ts` | modify | `mirror()` takes `cancelAt` and the period end and derives; `rowDisagrees` uses the derived value. The step-7 `isCancelling` (fresh, any `cancel_at`) is unchanged |
| `lib/stripe/StripeService.ts` | modify | `listBusinessOsSubscriptionsByPrice` maps `cancelAt`; `BusinessOsReconcileSubscriptionFacts.cancelAt?` (optional, as on the retrieve, so hand-built fakes stay valid) |
| `lib/business-os/billing/planReconcilePass.ts` | modify | `PlanReconcileSubscription.cancelAt?`; `cancel_flag_differs` against the derived value |
| `lib/business-os/billing/planUpgrade.ts` | modify, **only if SA rules IN (Q-5)** | Refuse `subscription_cancelling` on the fresh "flag OR `cancel_at`" |
| `lib/repositories/BusinessOsBillingAccountRepository.ts` | modify (comment only) | `mirrorSubscriptionState` doc: the flag is the derived "will not renew" value |
| `lib/business-os/billing/__tests__/subscriptionCancelling.test.ts` | create | The predicate table of §2.1 |
| `lib/business-os/billing/__tests__/planSubscriptionMirror.test.ts` | modify | Dashboard `cancel_at`-only → `true`; later date → `false`; early → `true`; log `cancelSource` |
| `lib/business-os/billing/__tests__/planSubscriptionManage.test.ts` | modify | Row `true` from a dashboard cancellation + Cancel pressed → `unchanged`, **no heal**; heal still runs when the row is stale the other way |
| `lib/business-os/billing/__tests__/planReconcilePass.test.ts` (+ `capturedSubscription.qa`) | modify | Row `true`, Stripe `cancel_at` only → no finding; row `false`, Stripe `cancel_at` only → `cancel_flag_differs`; the captured list maps `cancelAt` |
| `lib/business-os/billing/__tests__/planStripeFields.c6.test.ts` | modify | Add `cancel_at` to `FIELDS_READ.subscription` |
| `__tests__/fixtures/stripe/customer-subscription-updated.json`, `customer-subscription-deleted.json` | modify (hand-built only) | Add `"cancel_at": null` |
| `lib/business-os/billing/__tests__/planCancelReminderPass.test.ts` | modify (one case) | Pin: a row claimed after a dashboard cancellation (flag false, `cancel_at` = period end) is sent |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md`, P-7a workplan "Carried forward", `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md` (mirror line) | modify | Record that C-3 is closed by this slice, and FU-C3-1 |

### 3.2 Tasks

- [x] ✅ T1. `subscriptionCancelling.ts` + its table test (§2.1, every row, including `cancelAt: 0` / `undefined` and two items with different ends).
- [x] ✅ T2. Mirror writes `isSetToEndThisPeriod(fresh)`; log `cancelSource`; update the header.
- [x] ✅ T3. Engine `mirror()` and `rowDisagrees` on the derived value (4 call sites, one helper).
- [x] ✅ T4. `StripeService` list maps `cancelAt`; Step B compares the derived value.
- [x] ✅ T5. C-6 field + the two hand-built fixtures.
- [x] ✅ T6. (Q-5 IN) the `planUpgrade` fresh refusal.
- [x] ✅ T7. Tests in §3.1. The D4b reminder pin already exists in D's suite (see Implementation Notes, N-3); D's files are untouched.
- [x] ✅ T8. Docs: requirement P-7a row, P-7a "Carried forward" line, FU-C3-1. The as-built line is a deviation (D-1).

### 3.3 Risks

| Risk | Mitigation |
|---|---|
| The engine heal and the webhook disagree and flip-flop the row | Both call the same predicate on the same facts shape; a manage test pins "no heal" on a dashboard-cancelled row |
| A false `cancel_flag_differs` storm after deploy | Step B uses the same predicate. Only rows cancelled in the dashboard **before** the fix are flagged, and they are real (Q-3) |
| An owner cancelled in the dashboard now gets a D4b reminder | Intended. The choke point re-checks Stripe fresh, so a revoked cancellation is not sent (Q-2) |
| An early custom `cancel_at` shows our paid-through date | Access really runs to that date (SA-P8). The reminder is suppressed by S-14 |
| C-6 ratchet fails on a captured fixture | Captured fixtures are not edited. Stop and return to SA |

---

## 4. FU-P7a4-5: past cohort end guard

### 4.1 Where

`planPurchaseView.ts` (~line 314) calls the `freeAccessAfterPaidTier` port (`EntitlementService.getFreeAccessAfterPaidTier` → pure `freeAccessAfterPaidTier` in `lib/business-os/entitlements/freeAccess.ts`). The port answers "at the tier's settlement end, is the cohort live and its end later?". For `failing` (`planManageOffer`: `unpaid` / `past_due` / failed attempts) the Cancel **ends the plan now**, and the tier end can be long past. So `endsAt` can be later than the old tier end and still earlier than `now`. The wire `manage.freeAccessAfter` feeds `PlanManage.tsx` and `PlanCancelDrawer.tsx`.

D3.1's `moveToFreeCohortAfterPlan` / `previewAfterPlan` are **not** involved. The preview calls `freeAccessAfterPaidTier` with `tierExpiresAt: endsAt`, the caller's real end (now, for end-now), so its answer is already after `now`. That pure function is shared, so it is not changed.

### 4.2 The guard (minimal)

In the view, beside the existing finite check: `Date.parse(after.endsAt) > now.getTime()`. Otherwise the field is omitted (as when the port answers `null`), with no log, because this is expected rather than an error. `now` is the view's own injected clock, already used by `planManageOffer`.

Why the view and not the port: the port lives in `lib/business-os/entitlements/` and its pure function is shared with the D3.1 preview, so a change there triggers the entitlements skill and `test:bos-entitlements`. The view guard **adds no import** from the entitlements module, and `planPurchaseView.ts`'s imports are unchanged. The business-os-entitlements skill therefore does not apply. `test:bos-entitlements` is still run once as a cheap check.

| File | Action |
|---|---|
| `lib/business-os/billing/planPurchaseView.ts` | modify: the `> now` guard, a comment citing FU-P7a4-5 |
| `lib/business-os/billing/__tests__/planPurchaseView.test.ts` | modify: three cases |

**Tests:** (1) a `failing` row with the port returning `endsAt` one day before `now` → no `freeAccessAfter`, and Cancel is still offered; (2) `endsAt === now` → omitted (strict); (3) `endsAt` after `now` → present (the existing founding case, unchanged). A mutation check: remove the guard and (1) and (2) fail.

- [x] ✅ T9. Guard + tests.

**Risk:** none beyond a sentence that is now left out. The guard only removes a sentence, never adds one.

---

## 5. Gates, CI time and estimate

| Gate | Expected |
|---|---|
| `npx jest lib/business-os/billing lib/admin/billing app/api/business-os/billing app/api/business-os/entitlements --ci` | Pass |
| Connect harness `npx jest app/api/stripe/webhook --ci` | All pass; `.snap` unchanged in git |
| `npm run test:bos-entitlements` | Pass (no entitlements import added) |
| `tsc --noEmit` filtered to touched files; ESLint on touched files | 0 errors (and the run did not die) |
| `npm run build` | Succeeds |

**CI time impact: none.** No new job, no new suite in a required job beyond ~1 small file in the existing Jest gate (milliseconds).

**Estimate:** C-3 about 0.5 to 0.6 day (T1 to T8); FU-P7a4-5 about 0.1 day (T9); docs and gates about 0.1. **Total about 0.75 dev-day, one PR, no migration.**

---

## 6. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | Option (a), the derived stored flag, rather than (b), a `cancel_at` column | (a) |
| Q-2 | Confirm that a dashboard end-of-period cancellation **should** now receive the D4b 3-day reminder (it gets no D4a email, so it is never covered) | Yes |
| Q-3 | Backfill for rows cancelled in the dashboard before this deploys: rely on Step B's `cancel_flag_differs` plus the next event or press to heal, or add a one-off script? | No script; Step B surfaces them (pre-launch, likely zero rows) |
| Q-4 | The `cancel_at` cases that are not the period end: early → `true`, later → `false`, unknown period → `true` (§2.1) | As stated |
| Q-5 | `planUpgrade.ts:290` refuses on the raw fresh flag only, so a `cancel_at`-only subscription can be upgraded. Include the one-line "flag OR `cancel_at`" refusal (fail-closed) here? | IN (T6), a small fail-closed change |
| Q-6 | Keep the two existing fresh `isCancelling` helpers (any `cancel_at`) as they are, rather than switch them to the period-bounded predicate | Keep. Switching changes P-7a / D4b behaviour for the "later date" edge, which X-2 never tested |
| Q-7 | AM-7 "who cancelled" (TQ-9) OUT, recorded as FU-C3-1 | OUT |
| Q-8 | FU-P7a4-5: guard in the view (no entitlements change) rather than the port | View |

---

## SA Review Notes

### SA review: workplan

**Reviewed by SA — 2026-10-30**
**Status:** ✅ Approved with changes (W-1 to W-9 below are binding; no re-review needed if they are applied as written. Any deviation goes back to SA)

Verified on `main` `a0804002` in this worktree: `planSubscriptionMirror.ts`, `planSubscriptionManage.ts` (steps 6 to 10, `cancelNow`, `mirror()`), `planReconcilePass.ts` Step B (~line 667) and its port types, `planReconcileDeps.ts` (passes `StripeService` straight through, so no adapter change), `StripeService` (`retrieveBusinessOsSubscription`, `listBusinessOsSubscriptionsByPrice`, `setBusinessOsCancelAtPeriodEnd`, `cancelBusinessOsSubscriptionNow`, `unixOrNull`), `planUpgrade.ts:290` and ~454, `planPurchaseView.ts` ~314, `planManageOffer.ts`, `planCheckoutEligibility.ts`, `planMrr.ts`, `lib/admin/billing/subscriptionsView.ts`, `planCancelReminderPass.ts` (`decideReminderRow`, `stripeEndOf`), `20261100_business_os_plan_cancel_reminders.sql` (claim + partial index), `BusinessOsBillingAccountRepository` (`mirrorSubscriptionState`, `markCancelReminderCovered`), the C-6 field test and every subscription fixture, the source guards on the touched files, and the entitlements registrations of `planSubscriptionMirror.ts` / `planUpgrade.ts`.

#### Confirmed

| Claim in the workplan | SA finding |
|---|---|
| The mirror needs no new Stripe call | ✅ `retrieveBusinessOsSubscription` already returns `cancelAt` and every item's `currentPeriodEnd` (paged, fail-closed on incomplete items) |
| Every writer is listed | ✅ Webhook mirror, the engine's `mirror()` (4 call sites: heal ~408, heal ~423, write ~468, end-now ~545), apply RPCs and repo resets (both left alone, correct) |
| Readers need no change except Step B and `rowDisagrees` | ✅ `subscriptionsView` (`cancelling: !ended && flag`), `planMrr`, `planManageOffer` (ended and `failing` checked before the flag; `period_over` guard), `planCheckoutEligibility` (status `active` and not ended first), `planUpgrade` ~454 (row predicate). Every reader checks `ended_at` / status before the flag, so a derived `true` on an ended row is harmless. The captured `.deleted` fixtures show `cancel_at: null` on an immediate cancel, so `cancelNow` keeps writing `false` |
| D4b claim SQL and `markCancelReminderCovered` stay unchanged | ✅ The claim keys on the stored flag + our `current_period_end`; the choke point re-reads Stripe and requires `cancel_at ?? item end` = our period end. The covered CAS runs only after an in-app `cancelled` outcome, where Stripe sets the flag itself, so `.eq('cancel_at_period_end', true)` still matches |
| Captured fixtures already carry `cancel_at` | ✅ All 25 captured subscription-bearing fixtures have it; only the two hand-built ones (`customer-subscription-updated.json`, `-deleted.json`) lack it |
| Webhook route and Connect harness untouched | ✅ The change is in `lib/`, behind `BUSINESS_OS_FLOW_HANDLERS.plan`. Run the harness `--ci`, `.snap` unchanged, never `-u` |
| No migration | ✅ Option (a) needs none |

#### Rulings on Q-1 to Q-8

| # | Ruling |
|---|---|
| **Q-1** | **(a) approved.** One boolean holds "this plan will not renew", which is what every reader asks. (b) buys a date no screen needs, at the price of a migration, two checker re-baselines, a replaced SECURITY DEFINER claim and an UPDATE CAS that would want `.or()` (the 42703 hazard). The column name now under-describes the early-`cancel_at` case; the repository doc comment and the mirror header must say so (T2, T-repo comment) |
| **Q-2** | **Yes, a dashboard end-of-period cancellation gets the D4b reminder. It is the obvious default and needs neither the user's OK nor the D session's agreement; TL sends D an FYI.** Evidence: D4's own SA anticipated exactly this. DR-9 rewrote the reminder copy because "the claim also catches a flag set by an operator in the Stripe dashboard (the mirror writes it)", and D4b's choke point already accepts "the flag OR `cancel_at`". S-6 ("no emails for dashboard changes") governs the D4a cancelled/kept emails, not the reminder. This slice does not change D's code, copy, claim or counts; it only makes the stored flag what D4b already assumed it was. Plan-cancel emails are also still off until Resend, so there is no live effect today |
| **Q-3** | **No script. Approved with W-5 (honest disclosure).** Until a pre-fix dashboard-cancelled row is healed it still shows Active, still misses the D4b reminder, and Step B logs `cancel_flag_differs` as an `error` with `alert: true` **every night** (`finding()` at `planReconcilePass.ts:446`). Heal paths: the owner's press (step 7 heal now compares the derived value), any later `.updated`, or an operator **resending any old `customer.subscription.updated` event for that subscription** from the Stripe dashboard (the mirror reads Stripe FRESH, so an old event writes today's state). Record that procedure where W-5 says |
| **Q-4** | **Approved as stated**, with the edges in W-4 pinned. Early `cancel_at` → `true` (it will not renew; access still runs to the paid-through date, SA-P8; D4b releases it as `periodMismatch`, so no wrong-date mail; expect up to ~3 daily `periodMismatch` releases if the early date falls inside the window, which is correct). Later `cancel_at` → `false` (saying "ends" would deny a charge that will happen). Unknown period → `true` (fail toward "will not renew"; only Reactivate is offered, and Reactivate clears `cancel_at`, X-2) |
| **Q-5** | **IN (T6).** Fail-closed at the fresh read, using the **same any-date predicate** as the other two fresh readers (W-3), not the period-bounded one: the upgrade bills a proration NOW, and a subscription with any end date set must not be sold an upgrade. Keep the outcome `subscription_cancelling`; give the log reason a distinct value when only `cancel_at` triggered it (e.g. `stripe_cancel_at`) so an operator can tell. One unit case: flag `false`, `cancelAt` set → refused before any preview or update call |
| **Q-6** | **Keep the fresh "any `cancel_at`" semantics** in the engine's step 7 and in D4b. Do not move them to the period-bounded predicate. But do not keep the rule in three copies: W-3 |
| **Q-7** | **OUT, recorded as FU-C3-1.** A "who cancelled" audit needs a read-before-write against a count-only CAS, a new registered audit event and an actor rule. The `cancelSource` log line is the proportionate step now |
| **Q-8** | **View, approved.** Strict `Date.parse(endsAt) > now.getTime()`, using the view's injected `now` (already in scope for `planManageOffer`). It only removes a sentence. The pure `freeAccessAfterPaidTier` stays untouched because D3.1's preview shares it. `planPurchaseView.ts` already imports from the entitlements module (lines 69 to 71, registered); this diff adds no import and no symbol, so no re-registration, but `npm run test:bos-entitlements` is still run |

#### The derived rule at the edges (SA analysis)

| Edge | Result | Correct? |
|---|---|---|
| `cancel_at` equal to the latest item period end, flag `false` (dashboard "end of period", `max_period_end`) | `true` (`<=`) | ✅ The C-3 case. Equality must be a pinned test |
| Flag `true`, `cancel_at` = period end (in-app, X-2) | `true` | ✅ Unchanged; the D4a covered CAS still matches |
| `cancel_at` in the past, subscription not yet ended (only a race or clock skew) | `true` | ✅ Stripe ends it at `cancel_at`; `.deleted` mirrors `ended_at`, and every reader checks ended first |
| Several items with different period ends (`min_period_end`, or mixed items) | Compared with the LATEST end → `true` whenever `cancel_at` falls inside the subscription's life | ✅ The whole subscription ends at `cancel_at`. D4b separately releases anything with ≠ 1 item (`periodMismatch`), unchanged |
| Trialing, `cancel_at` = trial end (the item period end during a trial) | `true` | ✅ The predicate is status-blind by design; pin one `trialing` row so nobody adds a status check later |
| `cancel_at` after the period end | `false`, until the renewal moves the item period past `cancel_at`; the next `.updated` then mirrors `true` | ✅ Accepted edge (W-7). If Stripe sends no `.updated` at that renewal, Step B flags it (alerted) and the owner's press or a resend heals it |
| `cancel_at` `0`, `NaN`, negative, `undefined` | treated as absent | ✅ Same as `unixOrNull` / the existing `isCancelling` |

No reader breaks. The engine and the webhook cannot flip-flop the row because both call the same predicate on the same facts. Reactivate on a derived-`true` row reaches Stripe (isCancelling(fresh) is true), and `cancel_at_period_end: false` clears a `cancel_at` set alone (X-2).

#### Binding changes

| # | Change |
|---|---|
| **W-1** | **`planReconcilePass.guard.test.ts:136` pins the pass's import list EXACTLY** (`['@/lib/business-os/billing/reconcilePassRunner', 'stripe']`). Importing the new module fails it. Add the guard file to §3.1 and update the expected list deliberately, with a comment that `subscriptionCancelling.ts` is import-free, so "pure given its ports" still holds. In the new module's own test, pin "imports nothing" the way `planManageOffer.test.ts:96` does |
| **W-2** | **`lib/stripe/__tests__/businessOsPlanReconcileReads.test.ts:89` uses an exact `toEqual` on the list mapping** and will fail. Add it to §3.1 with cases: `cancel_at` a number → mapped; `null` → `null`; `0` → `null`. Map through `unixOrNull`. Make `cancelAt: number \| null` **required** on `BusinessOsReconcileSubscriptionFacts` (only StripeService builds it, so tsc then forbids forgetting the mapping); `cancelAt?` stays optional on the port type `PlanReconcileSubscription` for hand-built fakes |
| **W-3** | **One home for the rule.** `subscriptionCancelling.ts` exports `isSetToEndThisPeriod`, `cancelSourceOf`, `latestItemPeriodEnd` (moved from `planSubscriptionManage.ts`, identical body) and the fresh any-date predicate (e.g. `hasCancelDate`, the identical body of today's `isCancelling`). `planSubscriptionManage.ts` imports both instead of keeping private copies (zero behaviour change). `planUpgrade.ts` (Q-5) imports `hasCancelDate`: no third copy. **`planCancelReminderPass.ts` is D4b's file and is not touched**; its copy stays and is noted as a low-priority consolidation for D |
| **W-4** | **Predicate input** is `{ cancelAtPeriodEnd: boolean; cancelAt?: number \| null; periodEnd: number \| null }`, each caller passing the period end it already has: `latestItemPeriodEnd(fresh.items)` in the mirror and the engine heal, `after.currentPeriodEnd` on the engine write and end-now (already the latest), `latestItemPeriodEnd(subscription.items)` in Step B. Positive finite numbers only. The T1 table must include: equality → `true`; past `cancel_at` → `true`; two items with different ends (the latest decides); a `trialing` row; `cancelAt` `0` / `NaN` / `undefined`; `periodEnd` `null`; flag `true` with a later `cancel_at` → `true` |
| **W-5** | **Backfill disclosure (Q-3).** Before the PR, run a read-only count per mode of open rows (`ended_at IS NULL`, status `active` / `trialing`, `cancel_at_period_end = false`, a subscription id set) and record N in Implementation Notes. These are only candidates: the Stripe side cannot be read from SQL. The X-2 sandbox subscription of 2026-10-26 is the one known case if it is still open. Write the heal procedure (resend any `.updated` for that subscription; the mirror reads fresh) into the as-built mirror line, and state in the requirement row that until healed such a row shows Active, misses the reminder, and raises one alerted Step B finding per night |
| **W-6** | **Q-5 refusal** before any Stripe preview or update call, with the distinct log reason and its test. Check the `subscription_cancelling` refusal copy still reads true for a `cancel_at`-only subscription; if it says "you cancelled", flag it to SA rather than rewording it here |
| **W-7** | **Record the "later date" accepted edge** in the requirement row: my-plan says "renews" (true: it renews once more), Reactivate is not offered (the row predicate says renewing), a Cancel press answers `unchanged` with Stripe's `cancel_at` date and heals nothing, an upgrade is refused (Q-5). Operator-made only. QA, non-blocking and only if a sandbox test clock is cheap: set a later `cancel_at`, advance past the renewal, and confirm the row flips to `true` |
| **W-8** | **Mirror log**: the `cancelAtPeriodEnd` field logs the STORED (derived) value, plus `cancelSource`; ids only. Do not touch the `.deleted && mirrored` branch: `afterPlanMove.guard.test.ts` pins the text `if (event.type === 'customer.subscription.deleted' && mirrored.data.mirrored)` and the call order inside it |
| **W-9** | **Engine tests** (beyond §3.1): heal on press for a pre-fix row (row `false`, Stripe `cancel_at`-only = period end) writes `true`; the reverse (row `true`, Stripe nothing) still heals to `false`; Reactivate on a derived-`true` row calls `setBusinessOsCancelAtPeriodEnd(false)` |

#### Standards

| Area | Verdict |
|---|---|
| Tenant isolation | ✅ No new service-role path, no new write. `mirrorSubscriptionState` is unchanged: `{ count: 'exact' }`, `.eq('user_id')`, `.eq('livemode')`, `.eq('stripe_subscription_id')`, no `.select()`, no `.or()`. The values come from the same fresh read already cross-checked (mirror: metadata claim vs our row; engine: C-4's four checks). Step B writes nothing |
| CAS / PostgREST | ✅ No new UPDATE. `markCancelReminderCovered` unchanged (`count: 'exact'`, `.eq` only) |
| Entitlements | ✅ None. The new module imports nothing. `planSubscriptionMirror.ts`, `planUpgrade.ts` and `planPurchaseView.ts` already import from the module and are registered; their symbols do not change and the registered "why" texts stay true (`planUpgrade` already lists "cancelling" among its refusals). `test:bos-entitlements` runs once |
| Zod / routes | ✅ No route touched |
| Logging | ✅ Pino only; no `console.*` in the touched billing files expected. Dev confirms on each touched file at implementation |
| CI time | ✅ No new job; one small pure test file and a few cases inside the existing Jest gate (milliseconds). Within the "no added CI time" rule |
| Connect evidence | ✅ `npx jest app/api/stripe/webhook --ci`, all pass, `.snap` unchanged in git, never `-u`; any snapshot diff is a stop |

#### Nothing needs the user

Q-2 is a default already designed by D4 (DR-9). TL sends the D session an FYI: "from this slice, a Stripe-dashboard end-of-period cancellation is stored as cancelling and therefore reminded by D4b; your code, copy and claim are unchanged; your `isCancelling` copy in `planCancelReminderPass.ts` may later import the shared one (low priority)."

### Approval
[x] Workplan approved with W-1 to W-9 — proceed to implementation

### SA code review

**Code Review by SA — 2026-10-30**
**Status:** ✅ Code Approved (one condition before the PR, no code change)

Reviewed the uncommitted diff in `neuronforge-ppfu` (`fix/bos-plan-payments-followups-c3`) against `HEAD`, plus the two new files. Re-ran `npx jest lib/business-os/billing lib/stripe --ci`: 76 / 76 suites, 4 472 / 4 472 tests, 7 / 7 snapshots.

#### W-1 to W-9

| # | Verdict | Evidence |
|---|---|---|
| W-1 | ✅ | `planReconcilePass.guard.test.ts:141` lists the new import deliberately, with the "import-free" comment; `subscriptionCancelling.test.ts` pins "imports nothing" (`/^\s*import\s/m`) |
| W-2 | ✅ | `BusinessOsReconcileSubscriptionFacts.cancelAt: number \| null` is required (`StripeService.ts:104`), mapped through `unixOrNull` (`:612`); the list test covers 200 / null / 0. The port type keeps `cancelAt?` |
| W-3 | ✅ | One home: `subscriptionCancelling.ts`. The engine's private `isCancelling` / `latestItemPeriodEnd` are gone (same bodies moved); `planUpgrade.ts` imports `hasCancelDate`. `planCancelReminderPass.ts` untouched |
| W-4 | ✅ | Input shape as ruled; `positive()` filters 0 / NaN / ±Infinity / negative / undefined. Each caller passes the period end it has (mirror and heal: `latestItemPeriodEnd(items)`; write and end-now: `after.currentPeriodEnd`, which `StripeService.ts:853/893` already builds as the max item end; Step B: `latestItemPeriodEnd(subscription.items)`). Every pinned edge is in the T1 table |
| W-5 | ✅ | Heal procedure recorded in the requirement §9.1 P-7a row (see D-1 below). Read-only count run by TL on 2026-10-30: test 1, live 0 (table below) |
| W-6 | ✅ | `planUpgrade.ts:295` refuses `subscription_cancelling` with reason `stripe_cancel_at`, inside `planUpgradeEligibility`, which runs at `:515`, before the preview at `:593`. `planUpgrade.test.ts` asserts zero preview and zero update calls on both preview and confirm. The copy "Your plan is set to end…" reads true; no rewording |
| W-7 | ✅ | Recorded in the requirement row; engine test pins `unchanged` with Stripe's later date and no heal; Step B pins no finding |
| W-8 | ✅ | `planSubscriptionMirror.ts` logs the stored value and `cancelSource`, ids only; the `.deleted && mirrored` branch is unchanged (the `afterPlanMove` guard passes) |
| W-9 | ✅ | Pre-fix heal to `true` (new); no heal back from a mirrored `true` (new); reverse heal to `false` (`planSubscriptionManage.test.ts:315`); Reactivate on a derived-`true` row writes `false` (`:309`) |

#### Q-1 to Q-8

All met as ruled: (a) with no migration; the D4b reminder default with D's code untouched; no backfill script; the Q-4 edges; the Q-5 refusal with the shared any-date predicate; Q-6 fresh semantics kept (step 7 and step 9 use `hasCancelDate`); Q-7 out as FU-C3-1; Q-8 strict view guard.

#### The derived rule at its edges (checked in code and tests)

| Edge | Result | Pinned |
|---|---|---|
| `cancel_at` = period end, flag false | `true` (`<=`) | ✅ unit, mirror, Step B, captured-subscription QA test |
| `cancel_at` in the past, not ended | `true` | ✅ unit |
| Several items, different ends | the latest decides | ✅ unit |
| Trialing | `true`, status-blind | ✅ unit |
| `cancel_at` later than the period end | `false`; source `cancel_at_after_period` | ✅ unit (incl. +1 s), mirror, engine, Step B |
| Missing items list | mirror: `Array.isArray` → period unknown → `true` if a date is set. Engine and Step B always have an array (empty → `null` → same answer), so all three agree | unit covers `periodEnd: null`; the mirror branch itself is not pinned (suggestion 1) |

#### Call sites

- All four `mirror()` call sites pass a `MirrorState` (ended heal and step-7 heal via `freshMirrorState`, step-10 write and end-now via `answerMirrorState`), and `mirror()` stores `storedCancelFlag(state)` (`planSubscriptionManage.ts:684`). No call site can pass the raw flag any more: the type demands `cancelAt` and `periodEnd`.
- Step 7 `rowDisagrees` (`planSubscriptionManage.ts:419`) compares with the derived value, so a press cannot undo a mirrored dashboard cancellation and a pre-fix row heals. The engine and the webhook call the same predicate on the same facts, so no flip-flop.
- Step B `cancel_flag_differs` (`planReconcilePass.ts:675-680`) compares with the same derived value.
- View guard `planPurchaseView.ts:320`: strict `endsAtMs > now.getTime()`, injected clock; `=== now` pinned as omitted, `+1 ms` as shown.

#### Standards

| Area | Verdict |
|---|---|
| No migration; webhook route; D4b | ✅ `git status` shows nothing under `supabase/`, `app/api/stripe/`, `lib/business-os/entitlements/`, or `planCancelReminderPass.ts` |
| CAS / repository | ✅ No new UPDATE; `mirrorSubscriptionState` gets a doc comment only (`{count:'exact'}`, `.eq` only, no `.or()` + `.select()`, unchanged) |
| Entitlements | ✅ No import added; the four new imports are all `subscriptionCancelling` |
| Logging / PII | ✅ Pino only, no `console.*` in the touched source files; the new log field `cancelSource` is an enum; ids only |
| Captured fixtures | ✅ Only the two hand-built fixtures gained `"cancel_at": null`; the C-6 field list adds `cancel_at` |
| Dead code | ✅ The removed private helpers leave no orphan |

#### Rulings

- **D-1, accepted. No new as-built row.** `BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md` is the pre-build inventory of 2026-10-02 and has no plan-mirror row to extend; adding one there would suggest it is a maintained map, which it is not. The requirement §9.1 P-7a row is the living master record (standing rule: always update the main requirement), and that is where an operator looking up P-7a lands. The workplan's W-5 section repeats the procedure. This is the right home.
- **The two tests whose meaning changed (N-1), approved.** `planSubscriptionManage.test.ts` "a `cancel_at` set WITHOUT the flag…" (row false, `cancel_at` = period end) and `planSubscriptionManage.p7a1.qa.test.ts` QA focus 4 (row false, `cancel_at` 3 days early) both describe a subscription that will not renew, so under Q-4 the stored flag is `true` and the press must heal it. The old "no heal" expectation pinned exactly the C-3 bug. Both still assert zero Stripe writes and Stripe's date in the answer, the part of their original intent that stays true; the first one's heal is asserted in the new W-9 case beside it. QA should list both in its report as intended changes, not regressions.

### Code Review Comments

None blocking.

### Optimisation Suggestions (Low, non-blocking)

1. `planSubscriptionMirror.ts:130` — the `Array.isArray(fresh.items)` fallback (N-4) is not pinned by a mirror test with a `cancel_at` and no item list. One case (`{ cancelAtPeriodEnd: false, cancelAt: X }`, no `items` → stored `true`, source `cancel_at`) would stop a later edit turning it into a throw or a `false`. Optional for this PR.
2. `planUpgrade.ts:294-295` — the two refusal lines could be one with a ternary reason; two lines with distinct reasons is fine as is.

### Condition before the PR

- TL fills the W-5 counts (test and live) in Implementation Notes. If live N > 0, say so in the PR body with the resend-to-heal step.

### Code Approved for QA: Yes

## QA Testing Report

### QA report

**QA — 2026-10-30**
**Test mode:** full (adversarial)
**Strategy used:** A (Jest unit, pure predicate against an independent oracle) + B (Jest with hand-built ports through the real mirror, engine, Step B, upgrade and view). No database, no Stripe, no network. E2E is not applicable: the only UI effect is a sentence left out, and its logic is pinned at the view.
**Focus:** pipeline of the stored flag (mirror, engine, reconcile, upgrade, view), regression, D4b interplay
**Skipped:** the W-7 sandbox test-clock check (optional, needs Stripe), and the build (not a QA gate in this brief)
**Input source:** TL prompt keywords

#### New tests (3 files, 57 tests, all pass)

| File | Tests | What it pins |
|---|---|---|
| `lib/business-os/billing/__tests__/subscriptionCancelling.c3.qa.test.ts` | 31 | The predicate against an independent oracle over 2 flags x 11 `cancel_at` values (null, undefined, 0, NaN, negative, Infinity, past, before, equal, +1 s, long after) x 8 item sets (no list, empty, one, two in either order, one early, a null end, null beside a real one). **Property:** for the same facts, the webhook mirror (x 3 statuses: active, trialing, past_due), Step B (x 3 statuses; a row holding the oracle value gives 0 `cancel_flag_differs`, the opposite exactly 1) and the engine's step 7 (active, trialing; a correct row is never healed, a wrong one heals TO the oracle value, no Stripe write) all agree. A round trip (mirror → press → Step B → mirror) never moves the row. SA suggestion 1: the mirror's `Array.isArray` fallback with items absent, `null` or not an array → stored `true`, source `cancel_at`, no throw. The mirror log holds ids and the enum only. Step B's three verdicts with exact `mismatch` counts. Regressions: in-app cancel and reactivate, reactivate of a dashboard cancellation, a write answer with the flag and no `cancel_at`, an immediate `.deleted`, and a scheduled end that has happened (see E-2) |
| `lib/business-os/billing/__tests__/planUpgrade.c3.qa.test.ts` | 11 | `cancel_at` only, for preview and confirm: `subscription_cancelling`, reason `stripe_cancel_at`, zero preview and zero update calls. A later `cancel_at` also refuses (any date, Q-5). Flag only: reason `stripe_cancel_at_period_end`, for preview and confirm. Both set: the flag reason wins. Neither (absent, null, 0): preview and confirm still succeed. The refusal copy does not say "you cancelled" (W-6) |
| `lib/business-os/billing/__tests__/planPurchaseView.c3.qa.test.ts` | 15 | The view guard on a `failing` (unpaid) row: an end one day in the past, long in the past, equal to now, equal to now written with a `+02:00` offset, now - 1 ms, null, undefined, an unparseable string, an empty string, a number, and the port answering `null` all drop the field, keep Cancel and log no warning. Now + 1 ms and now + 1 day are shown verbatim. A renewing row with a past end is dropped too. A row stored `true` by the mirror reads as Reactivate, no Cancel |

**Mutation checks** (each made on the source, restored by copying the original back and confirmed with `cmp`; never with git): `<=` → `<` in `isSetToEndThisPeriod` fails 8 of the new tests; the engine `rowDisagrees` back on the raw flag fails 2; the mirror without the `Array.isArray` guard fails 5.

#### Test coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| C-3: a dashboard `cancel_at` at the period end is stored as cancelling | ✅ | Pass | Mirror, all 3 statuses, every item shape |
| Q-4 edges: early → true, later → false, unknown period → true, equality → true | ✅ | Pass | Oracle table + named cases (+1 s, -1 s, past, `periodEnd` 0) |
| The mirror, the engine and Step B cannot flip-flop the row | ✅ | Pass | Property check over the full table + a round trip |
| Engine heal: a pre-fix row heals to true; a mirrored true is not undone; the reverse still heals to false | ✅ | Pass | Property check, both directions |
| Step B: stored true → no finding; stale false → exactly one; later `cancel_at` stored false → none | ✅ | Pass | With `mismatch` counts |
| SA suggestion 1: the mirror with no item list | ✅ | Pass | Absent, null, non-array |
| Q-5 / W-6: the upgrade refuses on `cancel_at` before any Stripe preview or update; the flag alone still refuses; neither is allowed | ✅ | Pass | Preview and confirm each |
| FU-P7a4-5: a cohort end not strictly after now is never shown | ✅ | Pass | Past, equal, now ± 1 ms, null, unparseable, offset form |
| Regression: in-app cancel / reactivate, immediate `.deleted` | ✅ | Pass | New regression cases + the existing suites unchanged and green |
| D4b interplay (read only) | ✅ | Pass | The claim SQL (`20261100`), the partial index and `markCancelReminderCovered` (`.eq('cancel_at_period_end', true)`, `{ count: 'exact' }`) are unchanged in git. A dashboard end-of-period row is now stored true, so the claim finds it, and D's choke point already sends it (`planCancelReminderPass.test.ts:288`, `planCancelReminderPass.qa.test.ts:341`). An early date is released as `periodMismatch`, a later one is never claimed, and an unknown period (≠ 1 item) is released. The covered CAS runs only after an in-app cancel, where Stripe sets the flag, so it still matches. D's files are untouched and all their suites pass |

**Intended changes, not regressions (SA N-1 ruling):**
1. `planSubscriptionManage.test.ts` "C-3: a `cancel_at` set WITHOUT the flag counts as cancelling (unchanged on cancel)": it no longer asserts "nothing to heal". The heal to true is asserted in the new W-9 case beside it.
2. `planSubscriptionManage.p7a1.qa.test.ts` QA focus 4 "cancel → unchanged…": it now expects one heal mirror with `cancelAtPeriodEnd: true` instead of none. It still asserts zero Stripe writes and Stripe's own date.

#### Issues found

**Bugs (must fix before commit):** none.

**Performance issues:** none. Step B adds one pure call per listed subscription.

**Edge cases (nice to know, non-blocking):**
1. **E-1, the admin "Ends on" date for an early `cancel_at`.** `app/admin/finance/components/SubscriptionsTable.tsx:66` and `app/admin/users/components/PlanBillingBlock.tsx:189` print "Ends on {current_period_end}" whenever the stored flag is true. For a dashboard custom date earlier than the period end, Stripe ends the subscription at `cancel_at`, earlier than the date shown. This is the accepted SA-P8 / Q-4 trade-off: access runs to the paid-through date. An operator reading the admin table might expect Stripe's date. No code change was asked for.
2. **E-2, `.deleted` after a scheduled dashboard end now stores `true`.** When a `cancel_at`-only cancellation reaches its date, the `.deleted` read has `cancel_at` in the past and the flag false, so the mirror now writes `cancel_at_period_end = true` with `ended_at` set. Before this change it wrote `false`. Every reader checks the end first (`subscriptionsView.ts:90-97`, `planManageOffer`, and the D4b claim's `ended_at IS NULL`). The admin label even reads better ("Ends on: Ended …"). Pinned by a QA test so the behaviour is deliberate.
3. **E-3, the W-7 "later date" loop.** A Cancel press on a later-`cancel_at` subscription answers `unchanged` with Stripe's later date, and the row stays `false`, so my-plan keeps offering Cancel until the renewal moves the period. This is accepted and recorded in the requirement (W-7). It is operator-made only.

#### Gates (2026-10-30, run by QA)

| Gate | Result |
|---|---|
| `npx jest lib/business-os/billing lib/stripe lib/admin app/admin app/api/admin app/api/business-os/billing app/api/stripe lib/repositories --ci` | **569 / 569 suites, 19 069 / 19 069 tests, 118 / 118 snapshots** (Dev's 566 + QA's 3 new suites) |
| Connect harness `npx jest app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts --ci` | 152 / 152 tests, 111 / 111 snapshots; `git status` shows nothing under `app/api/stripe/` (`.snap` unchanged); never `-u` |
| `npm run test:bos-entitlements` | 331 / 331 suites, 9 884 / 9 884 tests |
| `tsc --noEmit` (8 GB heap) filtered to the touched and new files | 0 errors. The run completed: 1 920 pre-existing errors elsewhere, no heap or FATAL trace |
| ESLint on the 3 new QA files | 0 problems |

**Gate notes.** The first gate run had 3 red suites, and none was a product defect. (1) `BusinessOsBillingAccountRepository.test.ts` "source guards › only the listed files name the repository" was **caused by QA**: two new QA files imported the row type from the repository module. Fixed in the QA files, which now reach the type through the port types (`PlanSubscriptionMirrorDeps` / `PlanUpgradeDeps`). (2) and (3) `qa-slice5-pr2.route.test.ts` (a 1 023 ms timing bound against < 1 000) and `jobsQueues.items.render.test.tsx` (a 20 s timeout) failed under CPU contention, because `tsc` ran in parallel. Both pass alone, and the clean sequential rerun above is all green.

#### Final status
- [x] All acceptance criteria pass, ready for commit (subject to SA's existing condition: TL fills the W-5 counts, already recorded in Implementation Notes)
- [ ] Issues found, Dev must address before commit

**Verdict: PASS.** No bugs. Three non-blocking edge notes (E-1 to E-3), all within accepted SA rulings.

## Implementation Notes

**Code complete 2026-10-30, uncommitted**, on `fix/bos-plan-payments-followups-c3` (worktree `neuronforge-ppfu`, base `main` `a0804002`). No migration. `app/api/stripe/webhook/route.ts` is untouched. D's `planCancelReminderPass.ts` and its tests are untouched. There were no production DB reads and no Stripe calls.

### Files

| File | Change |
|---|---|
| `lib/business-os/billing/subscriptionCancelling.ts` | **New**, import-free (W-3): `hasCancelDate` (the fresh any-date rule, the body of the old `isCancelling`), `isSetToEndThisPeriod` (the stored flag), `cancelSourceOf`, `latestItemPeriodEnd` (moved, same body) |
| `lib/business-os/billing/planSubscriptionMirror.ts` | Writes the derived flag from the same fresh read. The info log carries the STORED `cancelAtPeriodEnd` and `cancelSource` (W-8). The header says the column now also holds an early `cancel_at`. The `.deleted && mirrored` branch is untouched |
| `lib/business-os/billing/planSubscriptionManage.ts` | Its private `isCancelling` / `latestItemPeriodEnd` copies are removed in favour of the shared module. `mirror()` takes a `MirrorState` (`freshMirrorState` / `answerMirrorState`) and stores `storedCancelFlag(state)` at all 4 call sites. Step 7's `rowDisagrees` compares with the derived value |
| `lib/business-os/billing/planReconcilePass.ts` | `PlanReconcileSubscription.cancelAt?` (optional). `cancel_flag_differs` is computed against `isSetToEndThisPeriod(…, latestItemPeriodEnd(items))`. The header notes the one import-free import |
| `lib/stripe/StripeService.ts` | `BusinessOsReconcileSubscriptionFacts.cancelAt: number \| null` (**required**, W-2). `listBusinessOsSubscriptionsByPrice` maps it through `unixOrNull` |
| `lib/business-os/billing/planUpgrade.ts` | `PlanUpgradeSubscriptionFacts` picks `cancelAt`. After the existing flag rule, `hasCancelDate` refuses `subscription_cancelling` with log reason `stripe_cancel_at` (Q-5, W-6). The copy "Your plan is set to end, so it cannot be upgraded." still reads true for a `cancel_at`-only subscription, so it is not reworded |
| `lib/business-os/billing/planPurchaseView.ts` | FU-P7a4-5: `freeAccessAfter` only when `Date.parse(endsAt) > now.getTime()` (strict). No import is added |
| `lib/repositories/BusinessOsBillingAccountRepository.ts` | Doc comment on `mirrorSubscriptionState` only (the derived meaning). No behaviour change |
| Tests | New `subscriptionCancelling.test.ts`. Modified: `planSubscriptionMirror.test.ts`, `planSubscriptionManage.test.ts`, `planSubscriptionManage.p7a1.qa.test.ts`, `planReconcilePass.test.ts`, `planReconcilePass.capturedSubscription.qa.test.ts`, `planReconcilePass.guard.test.ts` (W-1), `businessOsPlanReconcileReads.test.ts` (W-2), `planStripeFields.c6.test.ts`, `planUpgrade.test.ts`, `planUpgradeEligibility.test.ts`, `planPurchaseView.test.ts` |
| Fixtures (hand-built only) | `customer-subscription-updated.json`, `customer-subscription-deleted.json`: `"cancel_at": null`. No captured fixture was edited |
| Docs | Requirement §9.1 P-7a row (C-3 fixed; pre-fix rows and the heal procedure, W-5; the later-date edge, W-7; FU-C3-1) and a Change History row. P-7a workplan: "Carried forward" C-3 line and the FU-P7a4-5 line marked fixed |

### Notes

- **N-1, two tests changed meaning on purpose.** `planSubscriptionManage.test.ts` ("a `cancel_at` set WITHOUT the flag…") and `planSubscriptionManage.p7a1.qa.test.ts` (QA focus 4) used to pin "row false, Stripe `cancel_at` only → no heal". Under C-3 the derived value is `true`, so the press now heals the row to `true` (W-9). Both tests now assert the heal; neither makes a Stripe write.
- **N-2, W-9 coverage.** Covered: a pre-fix row healed to `true` (new); a mirrored-`true` row not healed back (new); the later-date edge, `unchanged` with Stripe's date and no heal (new, W-7); the reverse heal to `false` (existing "reactivate when Stripe is not cancelling"); Reactivate on a derived-`true` row calling `update(false)` (existing "C-3: reactivate clears a `cancel_at`…").
- **N-3, the D4b reminder pin.** It already exists in D's suite: `planCancelReminderPass.test.ts` "cancel_at alone (set from the dashboard) still counts as set to end; its date is Stripe's" (a claimed row, fresh flag `false` with `cancel_at` = period end → sent). This slice only makes the claim find such rows. D's files are not edited.
- **N-4, the mirror with no item list.** The production retrieve always returns `items`. Some hand-built fakes in the mirror suite do not, so the mirror reads a missing list as "period unknown" (`Array.isArray` guard) rather than throwing.
- **N-5, mutation checks** (each made on a copy and restored by copying the original back, never with git). Removing the view guard fails 2 FU-P7a4-5 tests. Reverting the mirror to the raw flag and Step B to the raw comparison fails 6 tests.

### Deviations (for SA)

- **D-1, no "as-built mirror line" exists.** `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md` is the 2026-10-02 pre-build inventory, and it has no plan-mirror row (its only subscription row is the legacy `user_subscriptions` handler). The W-5 heal procedure is therefore recorded in the requirement's §9.1 P-7a row and here, and the as-built doc is not edited. SA to say if a new as-built row is wanted.

### W-5: pre-fix candidates (read-only count, run by TL against production)

```sql
SELECT livemode, count(*) AS candidates
  FROM public.business_os_billing_accounts
 WHERE ended_at IS NULL
   AND subscription_status IN ('active', 'trialing')
   AND cancel_at_period_end = false
   AND stripe_subscription_id IS NOT NULL
 GROUP BY livemode
 ORDER BY livemode;
```

| Mode | Candidates (N) |
|---|---|
| test (`livemode = false`) | 1 (run by TL 2026-10-30; the likely X-2 sandbox subscription) |
| live (`livemode = true`) | 0 (no live row returned) |

These are candidates only: SQL cannot see the Stripe side. Each is a real pre-fix row only if Stripe holds a `cancel_at` for it. The one known case is the X-2 sandbox subscription of 2026-10-26, if it is still open. Heal procedure: resend any `customer.subscription.updated` event for the subscription from the Stripe dashboard; the mirror reads it fresh.

### Gates (2026-10-30)

| Gate | Result |
|---|---|
| `npx jest lib/business-os/billing lib/stripe lib/admin app/admin app/api/admin app/api/business-os/billing app/api/stripe lib/repositories --ci` | 566 / 566 suites, 19 012 / 19 012 tests, 118 / 118 snapshots |
| Connect harness `connectPath.characterisation.test.ts --ci` | 152 / 152 tests, 111 / 111 snapshots; `.snap` unchanged in git; never `-u` |
| `npm run test:bos-entitlements` | 331 / 331 suites, 9 884 / 9 884 tests |
| `tsc --noEmit` (8 GB heap) filtered to the touched files | 0 errors in touched files. The run completed (1 920 pre-existing errors elsewhere, no OOM or heap trace) |
| ESLint on the 20 touched source and test files | 0 problems |
| CRLF | Source edits made line-ending-preserving (the touched `.ts` files are CRLF in this checkout); no new source scan was added |
| CI time | No new job; one small pure suite in the existing gate |

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-30 | Workplan written | Dev: C-3 (option (a) recommended, no migration, webhook route and Connect harness untouched) and FU-P7a4-5 (view guard). Awaiting SA review |
| 2026-10-30 | SA workplan review | SA: approved with changes W-1 to W-9. Q-1 (a); Q-2 the reminder for dashboard cancellations is the default D4's DR-9 designed (FYI to D, no user OK needed); Q-3 no script, with honest backfill disclosure and the resend-to-heal procedure; Q-4 as stated; Q-5 IN with the shared any-date predicate; Q-6 keep the semantics, one shared home; Q-7 OUT (FU-C3-1); Q-8 view guard. Two test pins Dev missed: the reconcile pass import guard and the StripeService list-mapping `toEqual` |
| 2026-10-30 | Code complete (Dev) | W-1 to W-9 applied; Implementation Notes added (files, N-1 to N-5, deviation D-1, the W-5 SELECT with a placeholder for TL's figure, gates). Uncommitted; awaiting SA code review |
| 2026-10-30 | SA code review | SA: code approved for QA, no must-fix. W-1 to W-9 and Q-1 to Q-8 met; edges, the 4 `mirror()` sites, step-7 `rowDisagrees`, Step B and the strict view guard checked; focused jest 76/76 suites. D-1 accepted (no as-built row; the requirement §9.1 row is the home). The two N-1 tests' changed meaning approved. Condition: TL fills the W-5 counts before the PR. One optional test suggestion (mirror with no item list) |
| 2026-10-30 | QA report | QA: PASS, no bugs. 57 new tests in 3 `*.c3.qa.test.ts` files: the predicate against an independent oracle, a property check that the mirror, the engine heal and Step B agree on the same facts, SA suggestion 1, the upgrade refusal, and the view guard. Mutation checks were run. Gates green: jest 569/569 suites, 19 069 tests; Connect 152/152 with the `.snap` unchanged; entitlements 331/331; tsc 0 errors in touched files. The two N-1 tests are listed as intended changes. Edge notes E-1 to E-3 are non-blocking |
