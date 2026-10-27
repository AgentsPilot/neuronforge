# Workplan: D3 (SX-2) Plan Cancel drawer + `planEndingView`

> **Last Updated**: 2026-10-27

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md) §3.2, §5, §6.2 row SX-2 (+ the SX-1 as-built note), §9 (BQ-7, BQ-17, BQ-20), §10 (XC-19, SA-5, SA-15, C-9, C-10), §11 B.2 / B.7 (S-12, translation anchor), §12. Previous step: [D2 workplan](/docs/workplans/BUSINESS_OS_D2_PLAN_CANCEL_ENGINE_WORKPLAN.md) §12 hand-over to D3. Coordination: `SELF_SERVICE_EXIT_COORDINATION.md` (shared-items table, plan cancel engine row).
**Step:** D3 (doc slice id **SX-2**), DELETE scope
**Branch:** `feature/plan-cancel-drawer-d3` (worktree `neuronforge-d3`), today on top of D2 `e4214caa` (PR #525). Rebased onto `main` once D2 merges, then its own PR from `main` (not stacked)
**Date:** 2026-10-27
**Status:** Code Complete (2026-10-27, uncommitted on `feature/plan-cancel-drawer-d3` at base `4e75ed9f`; awaiting SA code review; merge held until SX-2b, R-2)

## Overview

D3 replaces P-7a.1's one-line inline Cancel confirm in Settings → Plan with the four-step **Cancel plan** drawer the requirement asks for: **reason → what changes → review → confirm**. "What changes" is computed by a new server-side view, `planEndingView`, built inside `lib/business-os/entitlements/` (SA-5, XC-19).

**The user's BQ-20 answer (2026-10-27) changes what step 2 describes.** When a paid plan ends after a cancel (and during the 14-day deletion grace), the account moves to the **free cohort**, which in code is the `trial` cohort ("Test Flight", base tier basic), **with an end date**. After that date the normal cohort-lapse path applies (grace, then paused). So step 2 reads "Your plan moves to the free plan (Test Flight) until {date}; you'll lose {what your plan has that Test Flight does not}".

**Nothing in the code makes that move today** (§1.2). D3 is still UI + `planEndingView` + copy. `planEndingView` **describes** the move: it re-resolves the account as it will be afterwards, through one pure "after-plan" rule that the real writer will also use. The **write** itself (setting the free cohort and its dates on the plan row when the paid plan ends) is a separate follow-up step, **SX-2b** (§14). It needs a webhook or engine change, so it is not D3 scope. Copy must state what the code does (C-9), so D3 must not reach owners before SX-2b does (Q-9).

D3 does **not** edit the plan cancel engine files (§1.4), adds no feature switch and needs no migration.

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [`planEndingView`: signature and data sources](#3-planendingview-signature-and-data-sources)
4. [The four steps and their copy keys](#4-the-four-steps-and-their-copy-keys)
5. [Files to Create / Modify](#5-files-to-create--modify)
6. [Task List](#6-task-list)
7. [Tests](#7-tests)
8. [Acceptance Criteria](#8-acceptance-criteria)
9. [Risks](#9-risks)
10. [Business questions: answers and open points](#10-business-questions-answers-and-open-points)
11. [Open items for SA](#11-open-items-for-sa)
12. [Estimate](#12-estimate)
13. [Hand-overs to later steps](#13-hand-overs-to-later-steps)
14. [Follow-up step SX-2b: the after-plan move to the free cohort (not D3)](#14-follow-up-step-sx-2b-the-after-plan-move-to-the-free-cohort-not-d3)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

### 1.1 What is there today

| Piece | Where | Today |
|---|---|---|
| Cancel / Reactivate controls | `components/business-os/settings/PlanManage.tsx` (P-7a.1; P-7a.2 added `PlanCardAndInvoices`) | "Cancel plan" button → inline confirm ("You keep {plan} until {date} … nothing is refunded", `plan.manage.cancel_confirm_body`) → `POST /plan/cancel` with `{}`. "Reactivate" posts `{}` to `/plan/reactivate`. Shown exactly where `plan.purchase.manage` says (server predicate `planManageOffer`) |
| Host | `PlanSection.tsx` line ~315, rendered inside the Plan `SettingsDrawer` on `app/business-os/settings/page.tsx` | `onChanged` re-reads my-plan |
| Refusal copy | `planManageCopy.ts` (`planManageRefusalKey`, `PLAN_CANCEL_PATH`) | Reused as is |
| Cancel route | `app/api/business-os/billing/plan/cancel/route.ts` (D2) | Body `z.object({ reasonCode: z.enum(PLAN_LEAVE_REASON_CODES).optional() }).strict()`; audits `details.reasonCode` |
| Reason codes | `lib/business-os/billing/planLeaveReasons.ts` (D2) | Seven codes, import-free, client-safe |
| "Ends on {date}. It will not renew." | `plan.ends_on_paid` via `billingEndsWhen` in the my-plan route | Already shown on the card once cancelling |
| Drawer primitive | `components/business-os/settings/SettingsDrawer.tsx` | Settings-only `Sheet` shell: full width on a phone, `sm:max-w-xl` above; `isBusy` refusal; RTL side; props only |
| Plan payload | `app/api/business-os/entitlements/my-plan/route.ts` → `buildCustomerPlanView` + `readPlanPurchaseView`; client mirror `planPayloadTypes.ts` | No ending view |
| Export link | `components/business-os/data-export/DownloadMyDataButton.tsx` | Frozen entry (SR-9) `<DownloadMyDataButton variant="button" />` |

`planEndingView` does not exist yet (SA F-12).

### 1.2 What happens at period end today, and what the user's BQ-20 answer needs

Read on this branch (2026-10-27):

| Mechanism | What it does | Does it move an account to the free cohort at period end? |
|---|---|---|
| Resolver, `deriveLifecycle` A-1 branch (`entitlements/lifecycle.ts`) | Once the tier is past `tier_expires_at` + the settlement margin, the account's **cohort resumes if it is still live**, otherwise it gets subscription grace (5 days, BQ-P12), then `paused` | No. It only reads the row. A paying account normally still has `cohort = 'trial'` from signup (a purchase does not clear it), but its trial ended long ago (14 days from `onboarding_started_at`), so it is not live and the account goes to grace |
| Trial dates (`cohortStatus`) | A trial's start is `trial_started_at` (pin) or the onboarding fact; its end is `trial_ends_at` (pin) or start + `durationHistory` days | The **pins are the lever**. A row with `cohort = 'trial'`, `trial_started_at = X` and `trial_ends_at = X + 14 d` resolves as a live Test Flight until then, then the trial's own grace (7 days), then paused. The columns exist (`BusinessOsAccountPlanPatch` has `cohort`, `trial_started_at`, `trial_ends_at`, `cohort_expires_at`) |
| `adminOps.ts` `set_cohort` (`cohort`, `expiresAt`, `trialEndsAt`) and `set_expiry` (`trial_ends_at`, …) | The admin entitlements route writes these, with `recordPlanChange` (cache invalidate + audit) | Admin-only. There is **no system path** that sets a cohort or trial dates |
| `recordPlanChange.ts` | After any plan-row write: invalidate, audit, bounded flush. Actor is `admin` or `{ kind: 'system', source: 'stripe_webhook' }` | Reusable by a system writer as is |
| `grantRules.ts` | `isGrantableCohort(config, id)`, champion end-date rule, invite cohort grants | A writer must pass `isGrantableCohort` |
| `adminAccountPlans.ts` `cohortAlone` / `describeAccountPlans` | Admin view: "would the cohort take over when the tier ends" | Read-only; the same question `planEndingView` asks |
| Stripe webhook `customer.subscription.deleted` (`planBillingHandler.ts` → `planSubscriptionMirror.ts`, P-6a.2 ended history + audit) | Mirrors status into `business_os_billing_accounts`. Its header says only a paid invoice moves the tier or the plan row | No plan-row write at all |
| Lifecycle job / cron | **None exists** (no plan / grace / lifecycle cron in `app/api/cron` or `vercel.json`); states are derived on read | — |

So the move to the free cohort is **new behaviour that needs a writer** (SX-2b, §14). D3 can still describe it exactly: the after-plan row is a pure function of the current row and the period end, and the resolver answers what that row has.

### 1.3 Who gets what (resolver, with the after-plan rule applied)

| Account at period end | After-plan row (pure rule, §2.2) | Step 2 says |
|---|---|---|
| Founding Partner cohort still live past the period end (dated champion) | Unchanged: FP resumes on its own (today's resolver) | "You go back to Founding Partner until {date}" (`back_to_plan`). Open point: should FP outrank the free cohort? Default yes (BA-10.4) |
| Anyone else (trial long used, no cohort, FP ended) | `cohort = <after-plan cohort>`, `trial_started_at = endsAt`, `trial_ends_at = endsAt + cohort duration` | "Your plan moves to the free plan (Test Flight) until {date}; you'll lose …; after that, read-only for {n} days, then paused" (`free_plan`) |
| Resolver anomaly, or the current basis is not a tier | — | Honest "could not work out" line (`unknown`) |

### 1.4 Engine files: not touched

Per the coordination file's shared-items row, D3 does **not** edit `planManageOffer.ts`, `planSubscriptionManage.ts`, `planPurchaseView.ts` (incl. `planManageWire`), the cancel / reactivate routes or `StripeService`. Every fact D3 needs from them is already on the wire: `purchase.manage.cancel`, `purchase.billing` (`renewing` + date) and the route's refusal codes. **One exception is a question, not a plan:** D2's SA ruling Q-5 said D3 makes `reasonCode` required in the cancel route. That is a one-line edit of an engine file, so it goes to SA as Q-1 (§11), with the recommendation to defer it.

`planManageCopy.ts` is not in the engine list, but P-7a.2 and D2 both edited it. D3 leaves it alone (the `change_pending` line keeps D2's shared "unavailable" key).

### 1.5 Other facts

- **No migration.** D3 reads nothing new from the database: the entitlement inputs are already read by `getSnapshot` (cached) and the billing row by `readPlanPurchaseView`. SX-2b also looks migration-free (the columns exist), to be confirmed in its own workplan.
- **No feature switch** (`isPlanSelfCancelEnabled()` was ruled out, D2 W-1). The drawer appears exactly where today's Cancel button does.
- **Base:** P-7a.2 (#528) **merged to `main`** today (`57d4e397`), so D2 can now rebase (W-9). D3 rebases onto D2-on-`main` **before** code starts, so it is built on P-7a.2's `PlanManage.tsx` (+7 lines, `PlanCardAndInvoices`) and translations. Never `git stash`.
- **`console.*` check (CLAUDE.md § Logging):** to be counted at T-1 on every file D3 edits. The expected touched files (`PlanManage.tsx`, the my-plan route, `EntitlementService.ts`, `customerPlanView.ts`, translations) are believed to have none. Any hit is flagged, not silently left.
- **Not V6 work.** No new pattern except the nested-drawer question (Q-2) and the after-plan config entry (Q-10).

---

## 2. Implementation Approach

### 2.1 Server: compute once, send with the plan

`planEndingView` is computed in the my-plan route and sent as an optional `ending` field on the plan payload, **only when** `purchase.manage.cancel === true` and `purchase.billing` is `renewing` with a date (the drawer can only open then). Every other answer carries `ending: null`. Why the payload rather than a new GET route (Q-6):

- the inputs are already in the service cache from the `getSnapshot` call two lines above;
- the cost is two extra pure resolves;
- the drawer opens with no spinner and no second failure mode;
- no new API route is needed.

A failure to build it never hides the plan: `ending: null`, a warn log, and step 2 shows the honest "could not work out" line.

### 2.2 One after-plan rule, two callers

**File:** `lib/business-os/entitlements/afterPlan.ts` (pure, no I/O)

```typescript
/**
 * The plan row as it will be once a paid tier ends at `endsAt` (user BQ-20, 2026-10-27).
 * Used by planEndingView (D3, to describe it) and by the SX-2b writer (to write it), so the
 * description and the write cannot drift apart.
 */
export function afterPlanAccount(account: EntitlementAccount, endsAt: string, config: EntitlementConfig, now: Date): EntitlementAccount;
```

- `tierExpiresAt` is set to `endsAt` on a **copy**.
- If the account's own cohort is still live at the first instant past the settlement margin (a dated Founding Partner), the row is otherwise unchanged (default BA-10.4).
- Otherwise:
  - `cohort` becomes the configured after-plan cohort;
  - `trialStartedAt = endsAt`;
  - `trialEndsAt = endsAt` + that cohort's `durationHistory` days at `endsAt` (via `historyAt`, never a literal 14; BA-10.2);
  - `cohortExpiresAt` is left as is (a cohort with a duration ignores it).
- **Which cohort** is config, not code: a new `AFTER_PLAN` entry in `entitlements/config/` (e.g. `config/afterPlan.ts`: `{ cohort: 'trial' }`). It is validated by `isGrantableCohort` and a test requires it to be a cohort **with** a `durationHistory`. So no cohort id is written outside `config/**`, and a later "real free plan" is a one-line config change (Q-10).
- Prior trial use is **not** read (BA-10.3 default: an account that used its trial still gets the free cohort).

### 2.3 The preview

A small public method on `EntitlementService`, inside the module:

```typescript
/** The account now, and as it will resolve just after its paid tier ends at `endsAt` (SX-2, planEndingView). Same inputs and cache as getSnapshot. */
async previewAfterPlan(accountId: AccountId, endsAt: string): Promise<{ current: EntitlementResolution; after: EntitlementResolution; afterTrialEnd: EntitlementResolution | null } | null>
```

It takes the cached inputs `getSnapshot` uses and applies `afterPlanAccount`. It then resolves twice:

- `after`: at `tierSettlementEndsAt(endsAt, margin)` + 1 ms;
- `afterTrialEnd`: when `after` is a live cohort with an end, at that end + 1 ms (for the "then read-only, then paused" sentence).

It returns `null` when inputs are unreadable or there is no account. It writes nothing and never touches the cache entry's object.

### 2.4 Client: the drawer

`PlanCancelDrawer.tsx` (new, `'use client'`, in `components/business-os/settings/`) is a `SettingsDrawer` opened by the existing **"Cancel plan"** button in `PlanManage.tsx` (secondary button, same test id). The inline `confirming` phase in `PlanManage.tsx` is removed. The busy / done / refused notices stay where they are, fed by the drawer's result through a callback, so the owner reads the outcome on the card after the drawer closes. The drawer:

- holds `step: 1 | 2 | 3 | 4` and `reason: PlanLeaveReasonCode | null` in local state; "Next" on step 1 is disabled until a reason is picked (BQ-17, list only);
- renders a radio group (`fieldset` + `legend`) of the seven codes in `PLAN_LEAVE_REASON_CODES` order, labels from `settings.plan_cancel.reason.<code>`;
- renders step 2 from `plan.ending` (the wire mirror), step 3 from `purchase.billing.date` + the frozen `<DownloadMyDataButton variant="button" />`, step 4 the confirm;
- on confirm:
  - posts `JSON.stringify({ reasonCode })` to `PLAN_CANCEL_PATH`;
  - passes `isBusy` to `SettingsDrawer` while the request is in flight, so it cannot close mid-request;
  - then closes and hands the route's answer to `PlanManage`. The existing `run` result mapping is lifted into a small function both paths use, not copied;
- moves focus to the step heading on every step change; errors are `role="alert"`; Back on steps 2 to 4; buttons `flex-wrap` so 320 px works; V2 tokens only; RTL via `isRTL` from `useLanguage`;
- imports nothing from `lib/business-os/entitlements/` (UI rule, upgrade modal C-6). It imports `PLAN_LEAVE_REASON_CODES` / `PlanLeaveReasonCode` from `planLeaveReasons.ts` (import-free, client-safe by design, D2 W-6);
- logs through `createLogger({ module: 'BusinessOsPlanCancelDrawer' })`, warn on a failed request, ids and codes only.

**"Keep my plan"** (D2 hand-over): the Reactivate button's label changes from `plan.manage.reactivate_button` ("Reactivate") to `settings.plan_cancel.keep_button` ("Keep my plan"). It still posts `{}` to `/plan/reactivate`. The wording is the user's to approve (G-5 precedent).

### 2.5 Registrations (XC-19, entitlements skill)

| File outside the module | Imports | Registration |
|---|---|---|
| `app/api/business-os/entitlements/my-plan/route.ts` (already listed) | + `readPlanEndingView` | `KNOWN_NON_GATE_IMPORTERS` entry: `symbols` becomes exactly `['buildCustomerPlanView', 'getEntitlementService', 'readPlanEndingView', 'resolveAccountId']`; `why` gains one sentence: "SX-2 (D3): `readPlanEndingView` describes what the account will have once its paid period ends, for the Cancel drawer; display only, refuses nothing, writes nothing, calls no `check()` / `decide()`." |
| `PlanCancelDrawer.tsx`, `PlanManage.tsx`, `planPayloadTypes.ts` | nothing from the module | None (the wire type is mirrored by hand, as every other payload shape) |
| Cancel route | unchanged (`resolveAccountId`) | None |

The cancel is **not** an `ENFORCEMENT_POINTS` gate and nothing is added there. No capability-id or tier-name literal appears outside `entitlements/config/**`. `afterPlan.ts` and `planEndingView.ts` name no cohort id (the id lives in the config entry). SX-2b's writer will be a new importer (`afterPlanAccount`) and registers itself then.

---

## 3. `planEndingView`: signature and data sources

**File:** `lib/business-os/entitlements/planEndingView.ts` (`server-only`, like `customerPlanView`)

```typescript
export type PlanEndingView =
  /** The account's own free plan is still live past the period end (a dated Founding Partner today). */
  | { kind: 'back_to_plan'; endsAt: string; planName: string; until: string | null; loses: string[] }
  /** User BQ-20: the after-plan free cohort (Test Flight today), dated; then its normal lapse. */
  | { kind: 'free_plan'; endsAt: string; planName: string; until: string; loses: string[]; thenReadOnlyDays: number | null; thenPausedFrom: string | null }
  /** The resolver gave an anomaly, or the current basis is not a tier. */
  | { kind: 'unknown'; endsAt: string };

/** Pure. No I/O, no clock: everything comes in. */
export function buildPlanEndingView(input: {
  config: EntitlementConfig;
  current: EntitlementResolution;
  after: EntitlementResolution;
  afterTrialEnd: EntitlementResolution | null;
  endsAt: string;
  locale: Locale;
  rows?: ReadonlyArray<PlanComparisonRowConfig>; // default PLAN_COMPARISON_ROWS, injectable for fixtures
}): PlanEndingView;

/** The one entry point outside the module (registered, XC-19). */
export async function readPlanEndingView(
  input: { accountId: AccountId; endsAt: string; locale: Locale },
  deps?: { service?: Pick<EntitlementService, 'previewAfterPlan'>; config?: EntitlementConfig }
): Promise<PlanEndingView | null>;
```

| Field | Source |
|---|---|
| `endsAt` | `purchase.billing.date` (our billing row's period end, the date the card's "Renews on" shows), passed in by the route. Never a request value |
| `current` / `after` / `afterTrialEnd` | `EntitlementService.previewAfterPlan` (§2.3), through `afterPlanAccount` (§2.2) |
| `kind` | `after.anomaly` or `current.basis.kind !== 'tier'` → `unknown`. `after` is a live cohort and it is the account's **own** cohort unchanged → `back_to_plan`; it is the after-plan cohort → `free_plan`. Decided by comparing rows, not by cohort-id or state literals |
| `planName` | `planLabel(config, after.basis.cohort, locale)` (`planPresentation.ts`): config labels, so neither "Founding Partner" nor "Test Flight" is written in code |
| `until` | `after.lifecycle.accessEndsAt`. For `free_plan` that is `endsAt` + the cohort's duration; for `back_to_plan` it is the cohort's own end (`null` = open-ended) |
| `thenReadOnlyDays` / `thenPausedFrom` | From `afterTrialEnd`: whole days from its access end to `graceEndsAt` (the trial's grace, 7 days today, never a constant), and `graceEndsAt` itself. `null` when not computable |
| `loses` | The **comparison row labels** that are ✓ for `current` and not ✓ for `after`. The labels come from `config/planComparison.ts`, already in en / he / es (user-approved 2026-10-19). For `free_plan` that is what the paid tier has and Test Flight (basic) does not. For `back_to_plan` with Founding Partner (the top tier) it is normally empty, and step 2 then says "You keep everything you have now". Row ✓ uses the **same rule** as the comparison table (UM-D2), see Q-3 |

Shadow mode: the "then read-only, then paused" sentence states the **configured** rule (SA-15). Whether it changes before enforcement is Q-5.

---

## 4. The four steps and their copy keys

All new keys go in **one block per language** with prefix `settings.plan_cancel.*`, directly after the last `settings.account_delete.*` key (SR-10 DELETE anchor), in `lib/business-os/translations/{en,he,es}.ts`. The en text below is a draft. Dev writes he / es, and the **user approves** them before merge (G-5 precedent). Placeholders use the existing `fill()` (`planText.tsx`). Dates go through `formatAccountDay(iso, language, timezone)` (owner's timezone, §12).

| Step | Content | Keys (en draft) |
|---|---|---|
| Shell | Drawer title, step counter, navigation | `settings.plan_cancel.title` "Cancel plan" · `.step_of` "Step {n} of {total}" · `.back` "Back" · `.next` "Next" · `.close` "Close" |
| **1 Reason** | Radio list, required, no free text (BQ-7, BQ-17, confirmed) | `.reason.heading` "Why are you leaving?" · `.reason.hint` "Pick the one that fits best." · `.reason.too_expensive` "Too expensive" · `.reason.not_using_enough` "Not using it enough" · `.reason.missing_feature` "Missing a feature I need" · `.reason.switching_tool` "Moving to another tool" · `.reason.business_closing` "My business is closing or pausing" · `.reason.technical_problems` "Technical problems" · `.reason.other` "Other" · `.reason.required` "Choose a reason to continue." |
| **2 What changes** | From `plan.ending` | `.changes.heading` "What changes" · `.changes.free_plan` "On {date} your plan moves to the free plan, {plan}, until {until}." · `.changes.lose_heading` "You'll lose:" · `.changes.keep_everything` "You keep everything you have now." · `.changes.free_plan_then` "After {until}, your account is read-only for {days} days, then paused, unless you choose a plan." · `.changes.back_to_plan` "On {date} you go back to {plan}, free, until {until}." · `.changes.back_to_plan_open` "On {date} you go back to {plan}, free." · `.changes.data_kept` "Your data is kept. You can always sign in and export it." · `.changes.unknown` "We could not work out exactly what changes. Your data is kept, and you can always sign in and export it." |
| **3 Review** | Last day, no further charge, no refund, export link | `.review.heading` "Before you confirm" · `.review.last_day` "Last day of your plan: {date}" · `.review.last_day_nodate` "Your plan runs to the end of the period you paid for." · `.review.no_charge` "You will not be charged again." · `.review.no_refund` "No refund for the current month." · `.review.export` "Want a copy of your data first?" + `<DownloadMyDataButton variant="button" />` |
| **4 Confirm** | Final action; dismiss keeps the plan | `.confirm.heading` "Cancel {plan}?" · `.confirm.body` "Your plan will not renew. You can keep it any time before {date}." · `.confirm.button` "Cancel my plan" · `.confirm.dismiss` "Don't cancel" · busy reuses `plan.manage.cancelling` |
| After | Card | Outcome reuses `plan.manage.cancelled` / `_nodate` and `planManageRefusalKey`; `settings.plan_cancel.keep_button` "Keep my plan" replaces "Reactivate" |

The confirm's dismiss button says "Don't cancel", not "Keep my plan", so "Keep my plan" means one thing only: the reactivate button. The free plan's name is the config label ("Test Flight" in all three languages today, per `cohorts.ts`).

P-7a.1's now-unused keys (`plan.manage.cancel_confirm_body`, `_nodate`, `plan.manage.cancel_confirm`, `plan.manage.keep`, `plan.manage.reactivate_button`) are **left in place**, because the translation files are add-only for this scope (B.2). Their removal is handed over (§13).

---

## 5. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/entitlements/config/afterPlan.ts` | create | Which cohort an account moves to after a paid plan (Q-10) |
| `lib/business-os/entitlements/afterPlan.ts` | create | `afterPlanAccount` (§2.2), shared with SX-2b |
| `lib/business-os/entitlements/planEndingView.ts` | create | `buildPlanEndingView` (pure) + `readPlanEndingView` (§3) |
| `lib/business-os/entitlements/EntitlementService.ts` | modify | `previewAfterPlan` (§2.3, Q-4) |
| `lib/business-os/entitlements/customerPlanView.ts` | modify | Extract the comparison row ✓ rule into one exported helper used by `buildPlanComparison` and `planEndingView` (Q-3). Behaviour unchanged |
| `app/api/business-os/entitlements/my-plan/route.ts` | modify | `ending` field (§2.1), try/catch → `null` + warn, `ending` kind in the info log |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | my-plan entry `symbols` + `why` (§2.5) |
| `components/business-os/settings/planPayloadTypes.ts` | modify | `PlanEndingWire` mirror + optional `ending?: PlanEndingWire \| null` |
| `components/business-os/settings/PlanCancelDrawer.tsx` | create | The four steps (§2.4, §4) |
| `components/business-os/settings/PlanManage.tsx` | modify | Cancel opens the drawer; inline confirm removed; outcome mapping shared; Keep my plan label |
| `lib/business-os/translations/en.ts`, `he.ts`, `es.ts` | modify | One `settings.plan_cancel.*` block at the DELETE anchor |
| `lib/business-os/entitlements/__tests__/afterPlan.test.ts` | create | §7 |
| `lib/business-os/entitlements/__tests__/planEndingView.test.ts` | create | §7 |
| `lib/business-os/entitlements/__tests__/previewAfterPlan.test.ts` | create | §7 |
| `app/api/business-os/entitlements/my-plan/__tests__/route.test.ts` | modify | `ending` present / null / failure |
| `components/business-os/settings/__tests__/PlanCancelDrawer.render.test.tsx` | create | Steps, a11y, posted body |
| `components/business-os/settings/__tests__/planCancelDrawer.guard.test.ts` | create | Source guard (§7) |
| `components/business-os/settings/__tests__/planCancelCopy.test.ts` | create | en / he / es parity + codes ↔ keys |
| `components/business-os/settings/__tests__/PlanManage.render.test.tsx`, `PlanManage.p7a1.qa.render.test.tsx` | modify | The inline-confirm assertions move to the drawer (about 24 references); Reactivate label |
| `docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md` | modify | SX-2 as-built note under §6.2; BQ-7 / BQ-17 / BQ-20 answers in §9; a §3.2 note that the user's BQ-20 answer replaces "today's rule"; the new SX-2b row; Change History. §11 untouched. BA may prefer to do the requirement edits |
| `SELF_SERVICE_EXIT_COORDINATION.md` | modify | D3 status row; SX-2b as a new step (TL / RM may do this instead) |

**Not touched:** `planManageOffer.ts`, `planSubscriptionManage.ts`, `planPurchaseView.ts` / `planManageWire`, `planPurchaseTypes.ts`, `planManageCopy.ts`, both plan routes (unless SA rules otherwise on Q-1), `StripeService.ts`, the webhook handler and mirror, `adminOps.ts`, `featureFlags.ts`, `events.ts`, `eventAudience.ts`, `tierMatrix.ts` / `cohorts.ts` / `catalog.ts`, the snapshot, migrations, emails.

---

## 6. Task List

- ✅ **T-0a** User answered BQ-7 / BQ-17 (confirmed) and BQ-20 (free cohort with an end date) on 2026-10-27
- ✅ **T-0b** SA workplan review (R-1 to R-14). User decisions 2026-10-27: BQ-20 = 14 days + a fresh 1,000 credits for any owner-started end, halving on repeat cancels (min 1 day); the write, the credits and the halving are SX-2b's
- ✅ **T-1** Base is `origin/main` `4e75ed9f` (D2 #525, P-7a.2 #528, P-7a.3 #534). `console.*` count on every touched file: 0 (EntitlementService, freeAccess, customerPlanView, my-plan route, PlanManage, planPayloadTypes, en / he / es)
- ✅ **T-2** `config/afterPlan.ts` (`AFTER_PLAN`) + `afterPlan.ts` (`afterPlanAccount`, returns `{ account, moved }`) + `afterPlan.test.ts`. R-4a: the "own cohort survives" derivation is one helper, `ownCohortAfterPaidTier` in `freeAccess.ts`, now also behind `freeAccessAfterPaidTier`
- ✅ **T-3** `previewAfterPlan` + one private `readInputs` shared with `getFreeAccessAfterPaidTier` (R-5) + `previewAfterPlan.test.ts`
- ✅ **T-4** `comparisonRowMembers` / `comparisonRowIncluded` extracted in `customerPlanView.ts`; existing comparison tests green unchanged
- ✅ **T-5** `planEndingView.ts` (`buildPlanEndingView` takes the preview; `readPlanEndingView`) + `planEndingView.test.ts`
- ✅ **T-6** my-plan route `ending` + 6 route-test rows + registration (`symbols` now exactly `buildCustomerPlanView`, `getEntitlementService`, `readPlanEndingView`, `resolveAccountId`; nothing in `ENFORCEMENT_POINTS`); `npm run test:bos-entitlements` green
- ✅ **T-7** `PlanEndingWire` mirror in `planPayloadTypes.ts`
- ✅ **T-8** `settings.plan_cancel.*` block (38 keys) in en / he / es at the DELETE anchor + `planCancelCopy.test.ts`. he / es are Dev drafts for the user (G-5)
- ✅ **T-9** `PlanCancelDrawer.tsx` + `PlanManage.tsx` wiring (shared `applyAnswer`, POST moved to `planManageRequest.ts`; "Keep my plan" label) + `PlanCancelDrawer.render.test.tsx` (22 rows incl. Q-2 nesting, R-4c/d, RTL, 320 px wrap). Within the 0.7 d cap
- ✅ **T-10** `planCancelDrawer.guard.test.ts`; PlanManage render tests (`.render`, `.p7a1.qa`, `.p7a3.qa`) moved from the inline confirm to the drawer
- ⬜ **T-11** Docs: requirement SX-2 as-built note (BA / TL per R-3; not done by Dev)
- ✅ **T-12** Verify: results below. Uncommitted for SA code review and the user's diff
- ✅ **T-12a (SA / QA fix round)** SA finding 1: `afterPlan.ts` header states SX-2b adds the repeat-cancel halving (14 → 7 → 4 → 2 → 1 days, 1-day minimum) INSIDE `afterPlanAccount` (comment only). SA finding 2 / QA 8: when the Cancel drawer closes, focus goes to the outcome line (`plan-manage-done` / `plan-manage-refused`), which survives the re-read that removes "Cancel plan"; with no answer it returns to "Cancel plan". New render-test row. QA's `PlanCancelDrawer.qa.render.test.tsx` stays in the PR. Copy unchanged (SA finding 5: the user reviews it in the diff). Re-run: settings + entitlements + my-plan route 108 / 108 suites (2,487 tests), `test:bos-entitlements` 9,591 green, ESLint clean
- ✅ **T-12b (G-5 approved, 2026-10-27)** User copy changes: "always" removed from `changes.data_kept` and `changes.unknown` in en / he / es; `changes.free_plan` now reads "…, {plan}, with {credits} credits, until {until}." (he / es to match), with `changes.free_plan_nocredits` as the fallback when the configured allowance is not a one-off total. `{credits}` comes from the free cohort's CONFIG value (`credits.allowance.total`) through `planEndingView`'s new `credits` field and the wire mirror, formatted in the reader's number format by the drawer; no figure in code. Test rows: view (config value, fixture total, non-total → null, no literal in source), drawer (en / he / es formatting, fallback), copy (placeholders, "always" gone, en exact). Re-run: 108 / 108 suites (2,500 tests), `test:bos-entitlements` 9,594 green, ESLint clean
- ✅ **T-13 (follow-up, TL 2026-10-27)** P-7a.4 merges to `main` before D3. After D3 merges `main`, move BOTH of P-7a.4's confirm variants (period end, and "ends now", testid `plan-manage-confirm-now`, incl. the Cancel on failing-payment rows) into the drawer as `mode="now"`, passing P-7a.4's extra body fields through `requestExtra`; keep the Founding Partner sentence in both modes. The seam is built and tested (`mode: 'period_end' | 'now'`, `requestExtra`, `settings.plan_cancel.review.ends_now` / `confirm.body_now`); nothing passes `now` yet
  - **Done 2026-10-27 (Dev), in the merge of `origin/main` (P-7a.4, #540 / `639a5b59`).** `PlanManage.tsx` conflict resolved to D3's drawer; P-7a.4's inline `plan-manage-confirm-now` and period-end inline confirm are gone. Both Cancel buttons open `PlanCancelDrawer`: renewing → `mode="period_end"`, failing payment (`manage.paymentFailed`) → `mode="now"`. P-7a.4's "has ended" outcome line (`mode: 'immediate'` / `state: 'ended'` → `plan.manage.ended_now`) moved into the shared `applyAnswer`. **`requestExtra` is not passed:** P-7a.4's client posted `{}` and its route schema is still `{ reasonCode? }` strict (the route decides the mode on Stripe's fresh status), so there is no extra field; the drawer posts `{ reasonCode }` in both modes and the reason step stays required (SA ruling 6). Founding Partner sentence: in both modes (step 2 and appended to step 4), unchanged drawer behaviour.
  - **For SA, `planEndingView` for a plan that ends today (ruling 6):** the my-plan route now builds `ending` where Cancel is offered with `endsAt` = the billing row's period end when renewing, **or `new Date().toISOString()` (server clock, never a request value, R-8) when `manage.paymentFailed`**. So step 2's "what changes" (the free plan's `until`, `thenPausedFrom`, `loses`) is computed from today; steps 3 / 4 read `settings.plan_cancel.review.ends_now` / `.confirm.body_now`. No change inside the entitlements module, no new route import (R-6 symbols unchanged). The view describes the expected immediate end; if Stripe has already cured the payment the route ends at period end and the outcome line says so (P-7a.4 focus 2).
  - **Copy:** P-7a.4's `plan.manage.cancel_now_body` (incl. "the unpaid invoice is cancelled, so there is nothing left to pay") and `cancel_now_confirm` are no longer rendered: `confirm.body_now` says only "Your plan ends today and will not renew." Follow-up (TL): the invoice sentence is back in `now` mode, `plan.manage.cancel_now_body` as its own line under `confirm.body_now` in step 4 (testid `plan-cancel-confirm-invoice`), absent in `period_end`; render rows en / he / es. **No keys removed:** the P-7a.1 keys (`cancel_confirm_body`, `_nodate`, `cancel_confirm`, `keep`, `reactivate_button`) and the two P-7a.4 keys are unreferenced by product code but still asserted by the P-7a.1 / P-7a.4 dictionary tests, and translation files are add-only, so they stay; removal is a separate cleanup if SA wants it.
  - **Tests:** `PlanManage.p7a4.render` and `PlanManage.p7a4.qa.render` now walk the drawer (same intents: ends-now wording with no date, reason required, posts once, `immediate` / `ended` → "has ended", cured → "until {date}", FP sentence after the ends-now line, he / es at 360 px, flex-wrap, no physical-direction class); the posted body is now `{ reasonCode }` instead of `{}`. my-plan route: past_due / unpaid / active + failed_attempts build the view from today (between the before / after clock), source guard updated to `endsAt: endingFrom`.
  - **Verification:** Jest settings + entitlements + billing + my-plan / billing routes 167 / 167 suites, 6,588 tests; `npm run test:bos-entitlements` 322 / 322, 9,594; ESLint clean on touched files; tsc (8 GB heap) completed, no OOM: 1,849 pre-existing errors repo-wide (unchanged), 0 in any touched file

### Verification (T-12, 2026-10-27)

| Check | Result |
|---|---|
| Jest: `lib/business-os/entitlements`, `components/business-os/settings`, `lib/business-os/billing`, `app/api/business-os/entitlements`, `app/api/business-os/billing` | 161 suites / 6,483 tests: 158 suites passed in the combined run; `PlanSection.prefetch`, `PlanDrawer.prefetch` and `PlanUpgrade.render` timed out under load and pass alone (31 / 31, 76 / 76) |
| `npm run test:bos-entitlements` | 322 / 322 suites, 9,591 tests green |
| `npx tsc --noEmit` (8 GB heap) | Completed (no OOM). 1,849 pre-existing errors repo-wide, **0** in any touched file or importer (PlanSection, UpgradeModal included) |
| ESLint on touched source + new tests | Clean |

### Deviations from the workplan (for SA)

1. `afterPlanAccount` returns `{ account, moved }` instead of a bare account; `previewAfterPlan` also returns `moved` and `freeAccessAfter` (R-4b: P-7a.3's date on the same ended row). `buildPlanEndingView` takes the preview object.
2. `afterPlanAccount(account, endsAt, inputs: LifecycleInputs, afterPlan = AFTER_PLAN)`: no `now` (nothing reads it); the config is the lifecycle inputs.
3. Q-10 drift snapshot: **not** added (the snapshot shape, `findDrift` and the script would all change, > 0.1 d). D3 ships the invariant test only; SX-2b adds the snapshot line before it writes, as SA allowed.
4. New file `components/business-os/settings/planManageRequest.ts` (the one POST, shared by PlanManage and the drawer; avoids a circular import).
5. Extra copy keys beyond §4: `.confirm.body_nodate` (no billing date) and the P-7a.4 seam keys `.review.ends_now`, `.confirm.body_now`.
6. Step 1 uses `fieldset` + `legend` wrapping the step heading; the "required" hint is the Next button's description.
7. No credit figure in step 2: the user's BQ-20 answer (a fresh 1,000 credits) is SX-2b's to write, and D3 only describes the 14 days. If the user wants it said in the drawer, it is one key plus a field on the view (read from config, never a literal).
8. Two new tests type the plan row through `fromPlanRow` rather than importing the repository type, so the RC-15 referrer guard stays green.

---

## 7. Tests

Pure Jest, small fixtures, no added CI time.

| Test | What it pins |
|---|---|
| `afterPlan.test.ts` | Paying tier + ended trial → after-plan cohort, `trialStartedAt = endsAt`, `trialEndsAt = endsAt + duration` (14 from the real config, read via `historyAt`); dated Founding Partner live past `endsAt` → unchanged; FP ending before `endsAt` → after-plan cohort; the input object is not mutated; the configured cohort passes `isGrantableCohort` and has a `durationHistory`; a fixture config naming another cohort is followed (no id in code) |
| `planEndingView.test.ts` | (1) `free_plan`: `planName` from config labels; `until` = `endsAt` + 14 d; `loses` = rows ✓ for the paid tier and ✗ for basic (non-empty with the real config's top tier; empty in a fixture where the paid tier equals the cohort base); `thenReadOnlyDays` = the trial grace (7); `thenPausedFrom` = its grace end. (2) `back_to_plan` for a dated FP, `loses` empty. (3) anomaly / non-tier basis → `unknown`. (4) labels in he and es. (5) the source contains no cohort id literal (tier literals are covered by `tierLiteral.forbidden.test.ts`) |
| `previewAfterPlan.test.ts` | Uses the cached inputs (one repository read for `getSnapshot` + `previewAfterPlan`); the cached account object is not mutated; resolves past the settlement margin (a renewing subscriber is not read as lapsed inside the margin); `null` on unreadable inputs |
| my-plan `route.test.ts` | `ending` present only when `manage.cancel` and billing `renewing`; `null` otherwise; a throwing `readPlanEndingView` → 200 with `ending: null` and a warn log; still reads no query or body |
| `enforcementPoints.test.ts` | Existing equality checks cover the new symbol; plus `ENFORCEMENT_POINTS` names no plan cancel or my-plan file |
| `planCancelCopy.test.ts` | Every `settings.plan_cancel.*` key exists in en, he and es, non-empty, same `{placeholders}`; every `PLAN_LEAVE_REASON_CODES` code has `settings.plan_cancel.reason.<code>` and there is no reason key without a code |
| `PlanCancelDrawer.render.test.tsx` | Next disabled until a reason is picked; four steps in order with Back; step 2 for each `ending` kind and for `ending: null`; step 3 shows the date in the owner's timezone and the export button; confirm posts `{"reasonCode":"<picked>"}` to `PLAN_CANCEL_PATH`; busy keeps the drawer open; refusal shows `planManageRefusalKey`; focus on the step heading; RTL side |
| `planCancelDrawer.guard.test.ts` | Source: the drawer's cancel `fetch` body is `JSON.stringify({ reasonCode`; no file under `components/business-os/settings/` posts to `PLAN_CANCEL_PATH` with `{}`; the drawer and `PlanManage.tsx` import nothing from `lib/business-os/entitlements/` |

**Run list (T-12):** `lib/business-os/entitlements`, `app/api/business-os/entitlements`, `components/business-os/settings`, `lib/business-os/billing`, `app/api/business-os/billing`, and `npm run test:bos-entitlements` (required by the skill). Results recorded in this workplan.

---

## 8. Acceptance Criteria

- ⬜ **AC-D3.1** "Cancel plan" opens a drawer with four steps: reason (list only, required) → what changes → review → confirm, in en / he / es, usable at 320 px and with the keyboard only.
- ⬜ **AC-D3.2** "What changes" comes from `planEndingView` in the entitlements module. It shows one of: the move to the free plan (Test Flight) until {date}, with what is lost and what follows its end; back to a still-live Founding Partner; or an honest "could not work out" line.
- ⬜ **AC-D3.3** Review shows the last day (owner's timezone), "You will not be charged again", "No refund for the current month" and the export entry (`DownloadMyDataButton`).
- ⬜ **AC-D3.4** Confirm posts `{ reasonCode }` to the existing cancel route; the outcome shows on the card; "Keep my plan" (reactivate) appears once cancelling.
- ⬜ **AC-D3.5** `afterPlanAccount` is the single after-plan rule, ready for SX-2b to write with. The only new importer of the entitlements module is registered with exact symbols; nothing is added to `ENFORCEMENT_POINTS`; `npm run test:bos-entitlements` is green.
- ⬜ **AC-D3.6** No engine file, no webhook file, no migration, no switch, no `console.*`; no added CI time.
- ⬜ **AC-D3.7** D3 does not reach owners before SX-2b's writer is live (Q-9), so step 2 never promises a move the code does not make.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A nested `SettingsDrawer` over the Plan drawer misbehaves (focus, Escape closing both) | Radix nests dialogs as layers (the discard prompt already does this inside `SettingsDrawer`); render test that Escape closes the top layer only. Fallback if SA prefers: steps in place inside the Plan drawer (Q-2) |
| R-2 | **Step 2 promises the free plan before anything writes it** (C-9) | Q-9: D3 merges with or after SX-2b. Both use `afterPlanAccount`, so the words and the write cannot drift |
| R-3 | The preview disagrees with what really happens (another date, or the mirror writes a different `tier_expires_at`) | One rule (`afterPlanAccount`) and the resolver; the date comes from the same billing row the card shows. A test pins the margin |
| R-4 | The free cohort's credits are a one-off total. A restarted trial may have no credits left, or may need a reset (BA-10.5) | Out of D3 (credits belong to SX-2b / the credits module). Step 2 names no credit figure until this is answered |
| R-5 | "Read-only, then paused" while enforcement is still `shadow` | Q-5; SA-15 states the configured rule |
| R-6 | Rebase conflicts in `PlanManage.tsx` and the translation files with plan payments (P-7a.4) | D3 changes only the cancel half of `PlanManage.tsx`; translations at the DELETE anchor; rebase just before enqueue, keep both |
| R-7 | Existing PlanManage tests assert the inline confirm | Updated in T-10, not deleted |
| R-8 | `customerPlanView.ts` extraction changes the comparison table | Pure extraction; existing comparison and `planComparison.config` tests must stay green unchanged |
| R-9 | Dead P-7a.1 keys in three translation files | Recorded hand-over (§13); add-only rule respected |

---

## 10. Business questions: answers and open points

| BQ | Answer / default | Status | Effect on D3 |
|---|---|---|---|
| **BQ-7** | The seven codes in D2's `planLeaveReasons.ts`, in that order | ✅ **Confirmed by the user 2026-10-27** | Step 1 labels |
| **BQ-17** | List only, no free text | ✅ **Confirmed by the user 2026-10-27** | No text field; only the code is posted |
| **BQ-20** | **User's answer (replaces the BA suggestion):** after a cancel, and during the 14-day deletion grace, the account moves to the **free cohort** (`trial`, "Test Flight", base basic) **with an end date**; after it expires, the normal cohort-lapse path (grace, then paused) | ✅ **Answered 2026-10-27** | `planEndingView` kind `free_plan`; the write is SX-2b (§14) |
| **BA-10.2** End date of the free cohort | Default: the trial's own length (14 days today, read from `cohorts.ts` `durationHistory`) counted **from the period end** | ⬜ **Flagged, pending user confirmation** | `until` in step 2. Note: for a deletion request, the 14-day deletion grace and a 14-day free cohort would end on the same day. If the user changes one, they no longer line up |
| **BA-10.3** An account that already used its trial | Default: **it still gets the free cohort**. Nearly every paying account started as a trial, so "only if unused" would mean almost nobody gets it | ⬜ **Flagged, pending user confirmation** | In D3, copy only. If the user says "only if unused", `afterPlanAccount` gains one rule, and step 2 shows the read-only-then-paused line for everyone else |
| **BA-10.4** A Founding Partner whose free access runs past the period end | Default: **they go back to Founding Partner** (the better plan), not to Test Flight | ⬜ **Flagged, pending user confirmation** | `back_to_plan` kind |
| **BA-10.5** Credits on the free cohort | Test Flight's allowance is a **one-off total** (1,000), and using it up ends the trial. Does a former payer get a fresh total? Default: yes, a fresh trial total | ⬜ **Flagged, pending user confirmation** (SX-2b) | None in D3; SX-2b / credits |
| **BA-10.6** A plan that ends for another reason (failed payment, P-7a.4 "Ends now", an admin-set end date) | Default: the account moves to the free cohort only when the plan **ends after the owner cancelled**, as the user said. Other endings keep today's grace path | ⬜ **Flagged, pending user confirmation** | None in D3 (the drawer is only the cancel path); decides where SX-2b writes |
| Wording (G-5) | en draft in §4; he / es by Dev | ✅ **Approved by the user 2026-10-27** with two changes: "always" dropped from `changes.data_kept` / `changes.unknown` (en / he / es), and the credit figure added to the free-plan line | `changes.free_plan` gains `{credits}`; `free_plan` ending gains `credits` |

---

## 11. Open items for SA

| # | Question | Dev recommendation |
|---|---|---|
| **Q-1** | D2 Q-5 said D3 makes `reasonCode` **required** in the cancel route. That edits an engine file (coordination row: D3 should avoid them), and P-7a.4 may be editing the same route | **Defer.** After D3 every UI sender posts a code (guard test). Make it required in whichever slice next owns the route (P-7a.4 or D6), recorded in the coordination file. If SA wants it in D3: one line + three route-test rows, after D2 merges and before P-7a.4 branches |
| **Q-2** | The Plan section already lives in a `SettingsDrawer`. Open Cancel as a **nested** `SettingsDrawer` (the requirement says "opens a drawer"), or render the four steps **in place** inside the Plan drawer? | Nested `SettingsDrawer`: same shell, `isBusy` refusal, focus trap, full width on a phone. It is the first drawer opened from inside another, so it needs SA's ruling (rule 7) |
| **Q-3** | `planEndingView` needs the comparison row ✓ rule. Extract it from `buildPlanComparison` into one exported helper (edits `customerPlanView.ts`)? Or call `buildPlanComparison` with `current` set to a **tier** resolution (no edit, but against its documented contract, SA S-4)? | Extract: one rule, two callers, contract kept |
| **Q-4** | `previewAfterPlan` is a new public method on `EntitlementService` | Approve: reuses the cache and inputs, writes nothing, keeps `toDomain` and the inputs private |
| **Q-5** | Shadow mode: SA-15 says copy states the **configured** rule, but P-6a.2 ruled the Settings plan line never says "paused" before enforcement (S-5). This now applies only to the "after {until}, read-only then paused" sentence | SA-15, because this is a promise about the future, made in this exact flow. If SA prefers P-6a.2, drop that sentence while the mode is not `enforce` (+0.05 d) |
| **Q-6** | `ending` on the my-plan payload vs a new GET route called when the drawer opens | Payload (§2.1) |
| **Q-7** | `loses` = comparison rows ✓ now and ✗ on the after-plan plan | Approve |
| **Q-8** | Leave P-7a.1's unused confirm keys in place (add-only translation rule) and hand their removal over | Approve |
| **Q-9** | **Sequencing with SX-2b.** The drawer replaces a Cancel that is already live (P-7a.1), so the moment D3 merges, owners read "moves to Test Flight until {date}". Options: (a) SX-2b merges first, D3 after; (b) one release, D3 enqueued right after SX-2b; (c) D3 first, with step 2 showing today's read-only-then-paused outcome, switched to `free_plan` by SX-2b | **(a)**: the description and the write go live together, so C-9 holds. D3 can be built and reviewed in parallel; only its merge waits. (c) costs two copy rounds and a code path that is thrown away |
| **Q-10** | Name the after-plan cohort in a new config entry (`entitlements/config/afterPlan.ts`, `{ cohort: 'trial' }`), or find it structurally as "the cohort with a duration"? | Config entry: explicit, validated by a test, and one line to change if a real free plan ever exists (requirement §13). It is an entitlements config change, so `test:bos-entitlements` covers it. It stays out of the drift snapshot (like `planComparison.ts`) unless SA wants it frozen there |
| **Q-11** | Where SX-2b writes the move (§14): webhook at subscription end (recommended), the cancel engine at cancel time, or a resolver rule with no write | See §14; SA picks before SX-2b's workplan |

---

## 12. Estimate

**≈ 2.5 d** (cap 2.5 d): T-1 0.1 · T-2 0.25 · T-3 0.15 · T-4 0.15 · T-5 0.35 · T-6 0.2 · T-7 0.05 · T-8 0.25 · T-9 0.55 · T-10 0.25 · T-11 + T-12 0.2. If Q-1 lands in D3, the he / es copy round (part of T-8) moves out to stay inside the cap. The SX-2b write is **not** in this estimate (§14).

---

## 13. Hand-overs to later steps

| To | What |
|---|---|
| **SX-2b** (new, §14) | Writes the after-plan move with `afterPlanAccount`; registers its importer |
| **D4 (SX-3)** | The "Plan cancelled" email can reuse `planEndingView`'s kind for its "what happens next" line. Emails carry no reason |
| **D6 / D8 (deletion)** | BQ-20 also covers the 14-day deletion grace. The deletion path ends the plan through the same engine, so SX-2b's writer covers it if it keys on "ended after a cancel"; D6 / D8 confirm this. See also BA-10.2's note on the two 14-day periods ending together |
| **D7 (DL-2)** | Deletion drawer reuses `planEndingView` (DL-2 depends on it) and the step-1 reason list (BQ-32); register its importer |
| **Plan payments (P-7a.4)** | "Ends now" cancel: whether it gets the free cohort is BA-10.6; `reasonCode` required (Q-1) if not done here; remove the dead P-7a.1 confirm keys (Q-8) |

---

## 14. Follow-up step SX-2b: the after-plan move to the free cohort (not D3)

**Why it is separate:** it writes the plan row from a system path that does not exist today (§1.2). Every candidate place to do it is the plan cancel engine, the Stripe webhook (plan-payments files) or the resolver core, and none of those are D3's (UI + `planEndingView` + copy). Rough size: 🟡 about 1.5 d, no migration expected (the columns exist), to be confirmed in its own workplan. It must merge **before or with** D3 (Q-9).

**What it writes:** `afterPlanAccount(account, endedAt, config, now)` applied to the plan row through `BusinessOsAccountPlanRepository` (`cohort`, `trial_started_at`, `trial_ends_at`). It then calls `recordPlanChange` with the system actor (cache invalidate + audit, bounded flush). It writes only when the after-plan row differs from the current one, so webhook replays change nothing.

**Where (design fork for SA, Q-11):**

| Option | Where | For | Against |
|---|---|---|---|
| **A (recommended)** | Webhook `customer.subscription.deleted`, inside the plan handler's ended path (P-6a.2 already records the end there), when the subscription had been set to cancel at period end | Writes only when the plan **really** ends, so "Keep my plan" needs nothing. It can tell a cancel from a failed payment (`cancel_at_period_end` / Stripe's cancellation reason), which BA-10.6 needs. The date is Stripe's `ended_at`. The webhook already has claim / replay safety and a system actor for `recordPlanChange` | Edits plan-payments-owned files (`planBillingHandler.ts` / `planSubscriptionMirror.ts`), so it must be sequenced in the coordination file like the engine. An admin-dated tier with no Stripe subscription never gets a webhook (BA-10.6's default keeps today's path for it anyway) |
| B | Cancel engine (`managePlanSubscription`) at cancel time: write the pins as soon as the cancel succeeds, clear them on reactivate | Date known at once; no webhook change | Engine file (sequenced with P-7a.4). Two writes (Stripe, then our row) that can half-fail. A reactivation in the Stripe dashboard does not clear the pins (needs mirror work like SX C-3). A later failed-payment lapse could inherit stale pins |
| C | Resolver rule, no write: a lapsed tier with no live cohort falls back to the after-plan cohort until access end + its duration | No write, no drift, no webhook; works with the test clock | Changes the lifecycle of **every** lapse (failed payments, admin-dated tiers). It cannot tell a cancel from anything else (BA-10.6) or apply BA-10.3. It is a core resolver change needing a dated history entry and a snapshot regeneration (S-7) |

**Also SX-2b's:**

- BA-10.5 credits (a fresh trial total or not, through the credits module).
- The deletion grace case. BQ-20 also names it; D6 / D8 confirm that the deletion path ends the plan through the same cancel, so Option A covers it.
- The admin view: `describeAccountPlans` will simply show the trial cohort with its dates.
- An audit `details` marker that the move was automatic.
- Its own registration in `KNOWN_NON_GATE_IMPORTERS`. It imports `afterPlanAccount` and writes a plan row but refuses nothing, so it is not a gate (SA to confirm).

---

## SA Review Notes

### SA Review — workplan, 2026-10-27

**Reviewed by SA — 2026-10-27** (code read on `e4214caa` in `neuronforge-d3`; P-7a.3's uncommitted diff read in `neuronforge-p7a`)
**Status:** ⚠️ **Approved with conditions R-1 to R-14.** Build may start after T-1's rebase (R-1). **Merge is held until SX-2b has merged** (R-2).

#### Claims verified (read by SA)

| Claim | Verdict |
|---|---|
| Nothing writes a cohort or trial pins from a system path; no lifecycle cron; the webhook does not touch the plan row (§1.2) | ✅ Agreed. BQ-20 is new behaviour and needs a writer |
| D3 touches no engine file (§1.4) | ✅ Except Q-1 (ruled below) |
| P-7a.3 touches only `PlanManage.tsx` of D3's files | ❌ **Not so.** P-7a.3 also edits `EntitlementService.ts` (new `getFreeAccessAfterPaidTier`, +40), `freeAccess.ts` (`freeAccessAfterPaidTier`), the **my-plan route** (passes `freeAccessAfterPaidTier` into `readPlanPurchaseView`), its route test, `planPurchaseTypes.ts` (`manage.freeAccessAfter`), the PlanManage render tests and **all three translation files** (`plan.manage.cancel_confirm_founding`). Five of D3's planned files overlap |
| `freeAccessAfterPaidTier` already answers D3's `back_to_plan` question | ✅ Same question, same method: `deriveLifecycle` at `tierSettlementEndsAt(tierExpiresAt)`, live non-duration cohort, end later than that moment. D3 must not compute it a second time (R-4) |

#### Rulings on Q-1 to Q-11

| # | Ruling |
|---|---|
| **Q-1** | **Defer accepted; D2 Q-5 is amended.** `reasonCode` stays optional in D3. It cannot be made required **before** D3 merges (P-7a.1 / P-7a.3's inline confirm posts `{}`), and D3 must not open an engine file while P-7a.4 owns it. The flip (one line + three route-test rows) goes to **the first slice that holds the plan cancel engine after D3 merges** (P-7a.4 if it is still open then, otherwise D6). TL records it in the coordination shared-items row. Meanwhile the guard test (§7) is what keeps every UI sender honest |
| **Q-2** | **Nested `SettingsDrawer` approved** (rule 7: new pattern, accepted here and reusable by D7). Conditions: Escape and overlay close the **top** layer only; focus returns to the "Cancel plan" button on close; while the cancel request is in flight the child is `isBusy` and the parent Plan drawer cannot close either (pass a busy flag up, or assert Radix layering blocks it); `onChanged` runs once, after the child closes. Each is a render-test row |
| **Q-3** | **Extract approved.** One exported row-✓ helper in `customerPlanView.ts`, used by `buildPlanComparison` and `planEndingView`. Pure extraction: existing comparison and `planComparison.config` tests pass unchanged |
| **Q-4** | **Approved, with a condition (R-5).** P-7a.3's `getFreeAccessAfterPaidTier` already hand-copies the cache-or-read block from `getSnapshot`; `previewAfterPlan` must not be the third copy. Extract one private `readInputs(accountId)` (cache hit or one repository read + store) used by both new methods. Never mutate the cached object (copy before `afterPlanAccount`) |
| **Q-5** | **SA-15 holds** for the "after {until}, read-only for {n} days, then paused" sentence. It is a statement about the future, inside the decision flow this requirement governs, and SA-15 is the rule written for it. P-6a.2 S-5 governs the **current-state** plan line and is not affected |
| **Q-6** | **Payload approved.** `ending` computed only when `manage.cancel` and billing `renewing` with a date; a failure is `ending: null` + warn, never a hidden plan. It sits after `readPlanPurchaseView` in the route and reuses its result for the precondition |
| **Q-7** | **Approved.** `loses` = rows ✓ now and ✗ after, through the Q-3 helper. Labels only from `config/planComparison.ts` |
| **Q-8** | **Approved.** P-7a.1's now-unused keys stay (add-only); removal handed over. Note: `plan.manage.cancel_confirm_founding` (P-7a.3) is **not** dead after D3 (R-4) |
| **Q-9** | **Option (a): D3 merges only after SX-2b has merged.** The Cancel button reaches every environment where the price switch is on, so on merge step 2 would promise a move nothing makes (C-9). D3 is built, SA-reviewed and QA'd in parallel; its PR is opened **without auto-merge** and marked "hold until SX-2b merged" in the coordination file. (c) is rejected (throwaway copy and code path, two he / es rounds). Relying on the prod price switch staying off is rejected too (it would be a hidden go-live coupling, the reason W-1 dropped the switch). Consequence for the user: until SX-2b lands, owners keep P-7a.1's inline confirm (with P-7a.3's Founding Partner sentence) |
| **Q-10** | **Config entry approved** (`config/afterPlan.ts`). Because SX-2b will **write** whatever it names (it grants an account a cohort), it is a grant decision, not a display list: **include it in the entitlements drift snapshot** (`npm run entitlements:snapshot`, never hand-edited), so changing it is visible in review like a tier change. Test: it passes `isGrantableCohort` and has a `durationHistory`. If adding it to the snapshot generator costs more than 0.1 d, D3 ships the test only and SX-2b adds the snapshot line before it writes |
| **Q-11** | **Option A (webhook `customer.subscription.deleted`) for SX-2b**, with these conditions for its workplan: (1) key on Stripe's `cancellation_details.reason === 'cancellation_requested'`, **not** on `cancel_at_period_end` (P-7a.4's immediate cancel never sets that flag); `payment_failed` / `payment_disputed` keep today's grace path (BA-10.6 below); (2) the account is found from **our billing row by subscription id**, never from Stripe metadata (`tenant-isolation-guard`); (3) write only if that subscription is still the one our row holds (a newer subscription wins; replay-safe compare); (4) write through `BusinessOsAccountPlanRepository` with `afterPlanAccount`, then `recordPlanChange` with the system actor, audit `details` marking it automatic; (5) the webhook files belong to PLAN PAYMENTS, so SX-2b gets its own row in the coordination file, ordered against P-7a.4 like the engine. Option B rejected (two writes that half-fail; stale pins on a later failed-payment lapse). Option C rejected (changes every lapse, cannot tell a cancel from a failed payment, core resolver change) |

#### Ruling on the P-7a.3 input (Founding Partner sentence, BQ-5)

**D3 reuses `freeAccessAfterPaidTier`; it does not compute the Founding Partner answer twice.** See R-4.

#### Conditions (binding)

1. **R-1 Sequencing.** Order: **P-7a.3 merges → D2 merged → D3 rebases on `main` (T-1) → code starts.** P-7a.3 is ahead because it touches five D3 files (table above), not one. Never `git stash`. After the rebase, re-read the my-plan route's `KNOWN_NON_GATE_IMPORTERS` entry before writing the new `symbols` list.
2. **R-2 Merge hold (Q-9).** AC-D3.7 stays. D3's PR has no auto-merge until SX-2b is on `main`; TL records the hold in the coordination file.
3. **R-3 SX-2b is a real slice, not a footnote.** BA adds an **SX-2b** row to requirement §6.2 (and the BQ-20 answer to §3.2 / §9, replacing "today's rule") before SX-2b's workplan; TL adds it to the coordination file with Q-11's ownership note. D3's T-11 edits only D3's own as-built note.
4. **R-4 One Founding Partner rule.** (a) `afterPlanAccount` decides "the account's own cohort survives the tier end" with the **same** derivation as `freeAccessAfterPaidTier` (`deriveLifecycle` at `tierSettlementEndsAt`, live, not grace / paused, no anomaly). Factor a shared helper in `freeAccess.ts` after P-7a.3 merges, or call it; do not write a third version. A surviving open-ended cohort also leaves the row unchanged (never downgrade a champion to Test Flight). (b) `planEndingView`'s `back_to_plan.until` **is** `freeAccessAfterPaidTier(...).endsAt` when that is non-null; a test asserts equality with `getFreeAccessAfterPaidTier` on the same fixture. (c) The drawer renders the Founding Partner line with P-7a.3's **existing** key `plan.manage.cancel_confirm_founding` (user-default BQ-5 wording), in step 2 **and** appended to step 4's confirm body, as P-7a.3 does inline. Drop D3's new `.changes.back_to_plan` key for that case; keep `.changes.back_to_plan` / `_open` only for a surviving cohort that is **not** the BQ-5 case (e.g. an unexpired Test Flight). (d) If `ending` is `null` but `manage.freeAccessAfter` is present, the drawer still shows the BQ-5 line from `manage.freeAccessAfter` (their SA requires it before the prod price switch; a `planEndingView` failure must not remove it). (e) P-7a.3's idle `plan-manage-founding` paragraph beside the Reactivate / "Keep my plan" button stays untouched in `PlanManage.tsx`. Render-test rows for (c), (d), (e).
5. **R-5 `EntitlementService`.** One private `readInputs` shared by `getFreeAccessAfterPaidTier` and `previewAfterPlan` (Q-4). `previewAfterPlan` returns `null` on unreadable inputs and logs warn with ids only.
6. **R-6 Registrations (XC-19).** Only the my-plan route gains a symbol (`readPlanEndingView`); `symbols` exactly match its imports after the rebase; `why` states display-only, no `check()` / `decide()`. Nothing in `ENFORCEMENT_POINTS`. `afterPlan.ts`, `planEndingView.ts` and `config/afterPlan.ts` are inside the module (no entry). The drawer, `PlanManage.tsx` and `planPayloadTypes.ts` import nothing from the module (guard). No cohort-id literal outside `config/**` (test in `planEndingView.test.ts` and `afterPlan.test.ts`), no tier literal (existing forbidden test). `npm run test:bos-entitlements` green, result recorded.
7. **R-7 `afterPlanAccount` is SX-2b's writer rule too**, so its header states that it is the single after-plan rule and that the D3 view and the SX-2b write both call it. Its tests pin: duration read via `historyAt` at `endsAt` (never a literal 14), input not mutated, FP survivors unchanged (R-4a).
8. **R-8 Dates.** `endsAt` is our billing row's period end (server-side), never a request value. The drawer formats every date through `formatAccountDay` with the owner's timezone (`user_preferences.timezone`); no `business_profiles.timezone`.
9. **R-9 Logging.** `console.*` counted at T-1 on every touched file and reported; the drawer uses `createLogger`; the route logs `ending.kind` only. No reason code in any client log beyond the code itself.
10. **R-10 Copy.** One `settings.plan_cancel.*` block per language at the DELETE anchor; he / es and the "Keep my plan" relabel go to the user before merge (G-5). Parity test as §7. No credit figure in step 2 until BA-10.5 is answered.
11. **R-11 Tests.** §7 as written, plus: Q-2's four nested-drawer rows; R-4's rows; a preview test that a `cancelling` account is never offered `ending` (the drawer can only open on `renewing`).
12. **R-12 Run list.** §7's list plus P-7a's C-12 set already used by D2 (`app/api/stripe`, `lib/business-os/purge` added). Focused `tsc` over touched files and their importers. No added CI time.
13. **R-13 Out of D3, for SX-2b's workplan:** BA-10.5 credits; a repeated cancel → buy → cancel granting a fresh free period each time (decide whether that is acceptable); the deletion grace case with D6 / D8; a missed webhook falls back to today's grace path (state it, no reconciliation job in SX-2b's first cut).
14. **R-14 Estimate.** The plan sits at the 2.5 d cap and R-1's rebase, R-4 and R-5 add about 0.25 d. To stay inside the cap: requirement and coordination edits move to BA / TL (R-3, about −0.1 d); D3's own `.changes.back_to_plan` copy shrinks (R-4c, about −0.05 d); if still over at T-8, the he / es round moves out of D3's build days (Dev's own fallback). Re-cut ≈ **2.5 d**. If T-9 alone exceeds 0.7 d, stop and tell TL rather than run over.

#### Business points (BA-10.x), SA position

| Point | SA position |
|---|---|
| BA-10.2 free-cohort end date | **Needs the user.** Default (the trial's configured length from the period end) is technically sound |
| BA-10.3 trial already used | SA reads BQ-20 as unconditional ("moves to the free cohort"): default stands; confirm with the user in the same batch |
| BA-10.4 Founding Partner precedence | **Settled** by the user's P-7a BQ-5 ("go back to Founding Partner free access") and by "free" vs "champion": champion outranks free. Not a new question |
| BA-10.5 credits | **Needs the user** (SX-2b, not D3) |
| BA-10.6 other endings | SA default: any **owner-initiated** cancel (period end, P-7a.4 "Ends now", and the deletion request) gets the free cohort; failed / disputed payment lapses and admin-dated ends keep today's path. User confirms in the same batch |

#### Approval

[x] Workplan approved with conditions R-1 to R-14 — start after R-1's rebase; merge held per R-2

### SA Code Review — 2026-10-27

**Code Review by SA — 2026-10-27** (uncommitted diff on `4e75ed9f`, `neuronforge-d3`)
**Status:** ✅ **Code Approved for QA.** No blocking findings. **R-2 merge hold stands**: no auto-merge until SX-2b is on `main`, and the user approves he / es and "Keep my plan" (G-5) before merge.

SA re-ran 13 suites (afterPlan, freeAccess, previewAfterPlan, planEndingView, enforcementPoints, PlanCancelDrawer, planCancel*, PlanManage*, my-plan route): 335 / 335 green.

#### Conditions checked

| Item | Verdict |
|---|---|
| `freeAccessAfterPaidTier` → `ownCohortAfterPaidTier` refactor (R-4a) | ✅ Behaviour-identical: the same guards (tier, tierExpiresAt, cohort; the duration check stays in the caller), the same `deriveLifecycle` at `tierSettlementEndsAt`, the same `endsAtMs <= tierEndsAt` compare. `freeAccess.test.ts` is **unchanged** and green, which is the proof. `afterPlan.test.ts` "agrees with P-7a.3" pins the two together |
| Champion never down to Test Flight (R-4a) | ✅ Open-ended and dated-live FP → `moved: false` (tests). A misconfigured `AFTER_PLAN` also gives `moved: false` (never an endless free plan, never a move). An FP that has already **ended** before the period end moves, which is an upgrade, not a downgrade (workplan §7) |
| R-5 `readInputs` sharing | ✅ One private cache-or-read block behind both methods; `afterPlanAccount` copies, and a test asserts the cached object is not mutated |
| R-4b / c / d / e | ✅ `back_to_plan.until` = `freeAccessAfter.endsAt` (equality test); P-7a.3's key in steps 2 and 4; BQ-5 line survives `ending: null`; the idle `plan-manage-founding` paragraph is untouched |
| Q-2 nested drawer | ✅ Escape closes the top layer only; focus returns to "Cancel plan"; while in flight neither layer closes (`isBusy` → `preventDefault` on Escape / outside); `onFinished` closes first, then `applyAnswer` → `onChanged` once. Each is a render row |
| Q-6 / R-8 / R-11 | ✅ `ending` only on `manage.cancel` + `renewing` + date, from the billing row; failure → `null` + warn; cancelling → never built (route row) |
| R-6 / entitlements skill | ✅ Only the my-plan route gains a symbol; `symbols` exact; `why` amended; nothing in `ENFORCEMENT_POINTS`; `afterPlan.ts` / `planEndingView.ts` name no cohort id (`'trial'` lives only in `config/afterPlan.ts`); client files import nothing from the module (guard) |
| Rule 3 / R-9 | ✅ No `console.*` in any touched or new file; the drawer uses `createLogger`; logs carry ids and the reason code only |
| Mobile / RTL | ✅ `SettingsDrawer` is full width on a phone; every button row is `flex-wrap`; logical `ps-5`; he render row checks `dir=rtl` and no physical-direction class |
| Copy vs what D3 + SX-2b deliver | ✅ With the R-2 hold, every sentence is true once SX-2b writes. "No refund for the current month" is correct: checkout refuses yearly prices. No credit figure (see deviation 4). One caveat, finding 1 |

#### Rulings on Dev's deviations

1. **`{ account, moved }` and `moved` + `freeAccessAfter` on the preview: accepted.** `moved` lets the view decide the kind by structure instead of a cohort id, and carrying `freeAccessAfter` is exactly R-4b.
2. **`afterPlanAccount(account, endsAt, inputs, afterPlan = AFTER_PLAN)`, no `now`: accepted.** Nothing reads a clock, so the function is purer.
3. **`AFTER_PLAN` not in the drift snapshot: accepted under Q-10's 0.1 d clause.** It becomes an **SX-2b entry condition**: the snapshot line lands in SX-2b's PR, before its first write.
4. **New `planManageRequest.ts` and `confirm.body_nodate`: accepted.** It is one shared POST rather than a copy, and it avoids a cycle. `body_nodate` covers a real branch (no billing date) that would otherwise render "before ." as a broken sentence.
5. **No credit sentence in step 2: accepted.** R-10's "no figure until BA-10.5" is now answered (fresh 1,000), but the grant is SX-2b's. If the user wants it said, SX-2b adds one key and a view field read from config (never a literal), in the same PR as the grant.
6. **P-7a.4 seam (`mode`, `requestExtra`, code posted last): accepted.** The spread order means no extra field can replace `reasonCode`, and the guard pins it. T-13 wires `now` after the main merge. Condition for T-13: the "ends now" confirm must still post a `reasonCode`. BA-10.6 / user decision: owner-started ends get the free period, so `planEndingView` must describe `endsAt` = today for `now` (today it is built only for `renewing`). T-13 rules on that with SA, not ad hoc.
7. **T-11 to BA / TL: accepted** (R-3). Docs PR #537 carries the requirement updates; D3's as-built note follows there.

#### Code Review Comments

1. `lib/business-os/entitlements/afterPlan.ts` — **SX-2b condition, not blocking for D3.** The user's halving on a repeated cancel must be implemented **inside `afterPlanAccount`** (for example a prior-free-period count as an input read by the preview too), not only in SX-2b's writer. Otherwise the drawer promises 14 days to a repeat canceller who receives 7, which breaks C-9 (the reason this is one rule). The header's "the halving … is SX-2b's, not here" should read "SX-2b adds it here". — Priority: High (for SX-2b)
2. `components/business-os/settings/PlanManage.tsx` — after a successful cancel, the host re-read removes the "Cancel plan" button that `returnFocusRef` points at, so keyboard focus drops to `<body>`. Move focus to the outcome notice or the new "Keep my plan" button once the notice renders. — Priority: Low
3. `lib/business-os/entitlements/planEndingView.ts` `readPlanEndingView` — the config defaults to `getEntitlementConfig()` while the preview resolved with the service's own `this.config()`. These are the same in production, but an injected service could build the view from a different config than it resolved with. Consider having the preview return the config it used. — Priority: Low
4. `EntitlementService.previewAfterPlan` — `ownCohortAfterPaidTier` decides survival **at** the settlement end, while `after` is resolved 1 ms **past** it. A cohort ending in that exact millisecond would read as `unknown`, which is honest. No change; noted for SX-2b's writer to use the same instant. — Priority: Low
5. Copy `settings.plan_cancel.changes.data_kept` / `.unknown` — "you can **always** sign in and export it" outlives a deletion request and any future purge. Suggest "you can sign in and export it" when the user reviews the he / es wording (G-5). — Priority: Low (wording)

#### Optimisation Suggestions

- The P-7a.1 dead keys (`plan.manage.cancel_confirm_body`, `_nodate`, `cancel_confirm`, `keep`, `reactivate_button`) are now unused (Q-8 hand-over). T-13 is the natural slice to remove them.

#### Code Approved for QA: Yes

Merge stays held per R-2 (after SX-2b; SX-2b carries comment 1 and the deviation-3 snapshot line) and G-5 (user wording approval).

## QA Testing Report

### QA Report — 2026-10-27

**Test mode:** full
**Strategy used:** A (Jest unit and in-memory render tests, real Radix layers) plus source reading for mobile. B for the my-plan route (mocked client). No live browser run, because merge is held (R-2) and the drawer is not reachable by owners before SX-2b.
**Focus:** ui, api, schema (copy)
**Skipped:** manual browser check (D). The R-2 merge hold means no owner can reach this yet. Do the live 375 px and keyboard check on the SX-2b pass.
**Input source:** TL prompt

#### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| AC-D3.1 Four steps, reason required (7 codes, list only), en/he/es, 320 px, keyboard | ✅ | Pass | Drawer render rows: order, `Step n of 4`, Next disabled with `aria-describedby` until picked, focus on each heading, Back on steps 2 to 4 keeps the pick. QA added: Escape on step 3 closes with no request, and a reopen starts at step 1 with nothing picked |
| AC-D3.2 What changes from `planEndingView` | ✅ | Pass | free_plan / back_to_plan (dated + open) / unknown / null. QA added: `ending: null` + `freeAccessAfter` shows the Founding Partner line in steps 2 and 4, not `unknown`. `ending: null` with no field shows `unknown` |
| Champion never "moves to Test Flight" | ✅ | Pass | Server: `afterPlan.test.ts` R-4a rows (dated or open-ended FP gives `moved:false`), and `previewAfterPlan` FP row. Client (QA added): even if the server sent a `free_plan` ending beside `freeAccessAfter`, step 2 shows only the FP sentence, with no "moves to the free plan" and no "then" line |
| AC-D3.3 Review: last day on the owner's clock, no charge, no refund, export | ✅ | Pass | Includes the Jerusalem day-shift row. QA added: no billing date gives `review.last_day_nodate` |
| AC-D3.4 Confirm posts `{ reasonCode }`; outcome on the card; "Keep my plan" | ✅ | Pass | Exact body `{"reasonCode":…}`, one POST on a double click, `null` on throw. QA added: HTTP 400/409/500 and non-JSON 502 through the drawer each close the drawer, show `plan-manage-refused`, show no done line, and keep Cancel. "Keep my plan" replaces Reactivate (`settings.plan_cancel.keep_button`, copy test) |
| FP sentence `plan.manage.cancel_confirm_founding` in confirm and beside "Keep my plan" | ✅ | Pass | `PlanManage.render` R-4c/R-4e rows, plus `p7a3.qa` rows |
| Missing billing date gives `confirm.body_nodate` | ✅ | Pass | QA added; no `{}` and no " ." in the sentence |
| AC-D3.5 Single after-plan rule, registration, `test:bos-entitlements` | ✅ | Pass | `npm run test:bos-entitlements`: **322/322 suites, 9591/9591 tests green** |
| AC-D3.6 No `console.*` | ✅ | Pass | grep over every changed or new non-test file: 0 hits. The drawer uses `createLogger` |
| Copy parity `settings.plan_cancel.*` | ✅ | Pass | QA scratch check: 38/38/38 keys, identical `{placeholder}` sets in he and es, no Latin words or malformed placeholders in Hebrew values (the pre-existing P-7a.3 key keeps "Founding Partner" as a brand name) |
| Mobile 375 px | ✅ (source) | Pass | `SettingsDrawer` is `w-full sm:max-w-xl`, body `p-6 overflow-y-auto`; every button row in the drawer is `flex flex-wrap gap-2`; no fixed width, `whitespace-nowrap` or `min-w` in `PlanCancelDrawer.tsx`; logical `ps-5`. The he render row asserts `flex-wrap` on every step and no physical-direction class |
| AC-D3.7 Not reaching owners before SX-2b | — | N/A | Process hold (R-2), not testable in code |

**New QA test file:** `components/business-os/settings/__tests__/PlanCancelDrawer.qa.render.test.tsx`, 9 rows, all green. Dev decides whether to keep it in the PR.

#### Issues Found

**Bugs (must fix before commit):** none.

**Edge cases (nice to fix):**
1. After a successful cancel, focus falls to `<body>` because the re-read removes "Cancel plan". This is the same as SA comment 2. Low.
2. A refusal closes the Cancel drawer and shows the reason on the card, so an owner retrying walks through all four steps again. This is the intended design (SA Q-2: outcome on the card), noted only for UX. Low.

#### Flaky-suite verdict (`PlanSection.prefetch`, `PlanDrawer.prefetch`, `PlanUpgrade.render`)

- Alone (D3): 3/3 pass, 107 tests.
- Combined in D3: entitlements + settings + routes (113 suites), business-os (188 suites) and components + business-os (768 suites) all passed. Two of these runs ran at the same time as an identical run in the main worktree, for double load.
- Main worktree (`1baf1f9b`, behind origin/main `8967888c`): the same three pass in combined runs.
- `PlanUpgrade.render` takes 33 s alone, 74 s in the mid run and 95 s in the broad run. That is the load signature. QA could not reproduce Dev's failure, and the suites show no order dependency.
- **Verdict: load-related timing flake, pre-existing, not a D3 regression.**

Other failures in the broad runs: 6 suites fail identically in **both** trees (`components/crm/contact-drawer/*` ×3 guards, `bookingNextStep`, `onboarding/servicesAreDraftsWithWords`, `theChainHoldsEndToEnd`). D3 touches none of them, so they are pre-existing on this machine, probably the Windows CRLF source-scan pattern. `upgradeModal.guard` fails only in the older main worktree; it passes on D3.

#### Test Outputs

```text
D3  entitlements+settings+my-plan+billing/plan: Test Suites 113 passed / 113; Tests 2733 passed
D3  npm run test:bos-entitlements:              Test Suites 322 passed / 322; Tests 9591 passed
D3  PlanCancelDrawer.qa.render (new):            Tests 9 passed / 9
D3  components+app/api/business-os+lib/business-os: 762 passed, 6 failed (pre-existing, same set on main)
```

#### Final Status
- [x] All acceptance criteria pass (AC-D3.7 is a process hold). Ready for commit, subject to the SA R-2 merge hold and G-5 wording approval
- [ ] Issues found — Dev must address before commit

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-27 | Created (Dev) | Workplan for D3 / SX-2: four-step Cancel drawer, `planEndingView` in the entitlements module via a resolver preview of the tier end, my-plan `ending` field, `settings.plan_cancel.*` copy in en / he / es, registrations (XC-19). No engine files, no migration, no switch. Q-1 to Q-8 for SA |
| 2026-10-27 | User answers applied (Dev) | BQ-7 / BQ-17 confirmed. BQ-20 answered: after a cancel (and in the deletion grace) the account moves to the free `trial` cohort with an end date, then the normal lapse. `planEndingView` now describes that (`free_plan` kind) through one pure `afterPlanAccount` rule and a config entry naming the cohort; "read-only then paused" is now only what follows the free plan's end. Today only admin ops can assign a cohort: there is no system path, no lifecycle job, and the webhook does not touch the plan row. So the write is a new follow-up step **SX-2b** (§14), not D3. Flagged for the user: end date (14 days from period end), an already-used trial (still gets it), Founding Partner precedence, credits, other ways a plan ends. New SA items Q-9 (D3 merges with or after SX-2b), Q-10 (config entry), Q-11 (where SX-2b writes) |
| 2026-10-27 | SA workplan review | ⚠️ Approved with conditions R-1 to R-14. Q-1 deferred (D2 Q-5 amended: first engine owner after D3 makes `reasonCode` required). Q-9 (a): merge held until SX-2b merges. Q-11 Option A, keyed on Stripe `cancellation_requested`. P-7a.3 merges first (it touches five D3 files); D3 reuses `freeAccessAfterPaidTier` and P-7a.3's `plan.manage.cancel_confirm_founding` for the Founding Partner line (R-4). Q-10 config entry joins the drift snapshot |
| 2026-10-27 | Implemented (Dev) | T-1 to T-10 and T-12 on `4e75ed9f`, uncommitted. `afterPlanAccount` + `config/afterPlan.ts`, `ownCohortAfterPaidTier` shared with P-7a.3, `previewAfterPlan` + private `readInputs`, `planEndingView`, my-plan `ending`, registration, `PlanCancelDrawer` (4 steps, nested drawer, "Keep my plan"), 38 `settings.plan_cancel.*` keys en / he / es, tests. TL heads-up: `mode: 'period_end' \| 'now'` + `requestExtra` seam for P-7a.4, follow-up T-13. Deviations listed under §6 |
| 2026-10-27 | SA / QA fix round (Dev) | SA approved, QA passed. `afterPlan.ts` header: the repeat-cancel halving goes inside `afterPlanAccount` (SX-2b). Focus after the drawer closes moves to the outcome line instead of the removed "Cancel plan" button, plus a test row. QA's drawer test kept. Copy unchanged |
| 2026-10-27 | G-5 approved (Dev) | User approved the wording with two changes: "always" dropped from `data_kept` / `unknown`; the free-plan line names the credits (`{credits}`, read from the free cohort's config through `planEndingView.credits`, locale-formatted). Fallback key `free_plan_nocredits`. Tests added |
| 2026-10-27 | T-13 + main merge (Dev) | Merged `origin/main` (P-7a.4 #540). Both Cancel buttons open the drawer: renewing → `period_end`, failing payment → `now`; P-7a.4's "has ended" line in the shared answer handler; no `requestExtra` (P-7a.4 adds no body field), `reasonCode` posted in both modes. my-plan builds `ending` from today for a failing payment (for SA). P-7a.4 render / QA tests go through the drawer. No copy keys removed (still asserted by tests; add-only) |
