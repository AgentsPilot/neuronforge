# Workplan: D3.1 (SX-2b) Move to the free cohort when an owner-started cancel ends the paid plan

> **Last Updated**: 2026-10-27

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md) §3.2 (BQ-20 answer), §6.2 row **SX-2b**, §9 BQ-20. Previous step: [D3 workplan](/docs/workplans/BUSINESS_OS_D3_PLAN_CANCEL_DRAWER_WORKPLAN.md) §14 and its SA Review Notes (Q-9, Q-10, Q-11, R-3, R-13) and SA Code Review (comment 1, comment 4, deviation 3). Coordination: `SELF_SERVICE_EXIT_COORDINATION.md` (log 2026-10-27: reason verified on the sandbox; FU-P7a4-3 answered).
**Step:** D3.1 (doc slice id **SX-2b**), DELETE scope
**Branch:** `feature/free-cohort-after-cancel-d3-1` (worktree `neuronforge-d31`), on top of D3 `0eb3994c` (PR #539, held until this step merges)
**Date:** 2026-10-27
**Status:** Code Complete (DELETE scope SA-approved part 1; T-1 merges and T-8 webhook wiring done 2026-10-27, awaiting SA part 2 + PLAN PAYMENTS review of the T-8 diff). Nothing committed beyond the two merge commits

## Overview

D3 built the Cancel drawer, which tells the owner "your plan moves to the free plan (Test Flight) until {date}". Nothing writes that move yet. D3.1 is the writer.

When Stripe sends `customer.subscription.deleted` with `cancellation_details.reason = 'cancellation_requested'`, the account moves to the free cohort. That reason covers a period-end cancel, P-7a.4's "Ends now" (also during a failed payment) and, later, a deletion request. The cohort is `AFTER_PLAN.cohort` (`trial`, "Test Flight"). The account gets 14 days (from config) with a fresh credit total from config (1,000 today). Each repeat cancel halves the period, to a 1-day minimum. A `payment_failed` end keeps today's path. A Founding Partner whose free access outlives the plan goes back to Founding Partner.

The write uses the one after-plan rule, `afterPlanAccount`, which gains the halving (SA code review comment 1), so the drawer and the writer cannot disagree. The webhook change is a thin call into a DELETE-owned module. The repeat-cancel count needs **one migration** (two columns on the plan row, §3). It needs no cleanup-function regeneration.

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [Where the repeat-cancel count lives (migration decision)](#3-where-the-repeat-cancel-count-lives-migration-decision)
4. [The after-plan rule with halving, and the end-date semantics](#4-the-after-plan-rule-with-halving-and-the-end-date-semantics)
5. [The credits: a fresh one-off total](#5-the-credits-a-fresh-one-off-total)
6. [The writer, step by step](#6-the-writer-step-by-step)
7. [Audit and logging](#7-audit-and-logging)
8. [Files to Create / Modify](#8-files-to-create--modify)
9. [Task List](#9-task-list)
10. [Tests](#10-tests)
11. [Acceptance Criteria](#11-acceptance-criteria)
12. [Risks](#12-risks)
13. [Open items for SA](#13-open-items-for-sa)
14. [For PLAN PAYMENTS to review](#14-for-plan-payments-to-review)
15. [For the user](#15-for-the-user)
16. [Estimate](#16-estimate)
17. [Sequencing and hand-overs](#17-sequencing-and-hand-overs)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

### 1.1 What is there (read on this branch, 2026-10-27)

| Piece | Where | Today | D3.1 |
|---|---|---|---|
| After-plan rule | `entitlements/afterPlan.ts` `afterPlanAccount(account, endsAt, inputs, afterPlan = AFTER_PLAN)` → `{ account, moved }` | First-time period only. It sets `tierExpiresAt = endsAt`, `trialStartedAt = endsAt` and `trialEndsAt = endsAt + duration` | Adds the halving, plus the S-2 / S-4 / S-11 rules (§4) |
| Config | `entitlements/config/afterPlan.ts` `AFTER_PLAN = { cohort: 'trial' }` | Not in the drift snapshot (D3 deviation 3) | Gains the halving settings. Joins the snapshot (an entry condition) |
| Preview | `EntitlementService.previewAfterPlan(accountId, endsAt)`, through the cached `readInputs` | Knows no count | Reads the count, so the drawer's `{until}` is the halved date |
| Founding Partner rule | `freeAccess.ts` `ownCohortAfterPaidTier` (shared with P-7a.3) | Used by `afterPlanAccount` | Unchanged |
| Writer of plan state from a system path | none (D3 §1.2) | `adminOps.ts` is admin-only; the paid-invoice RPC writes tier and anchor | New |
| Webhook `.deleted` | `planBillingHandler.ts` → `planSubscriptionMirror.ts` `mirrorPlanSubscription` | Finds the billing row by subscription id and mode (SR-8). Reads the subscription fresh. A metadata claim for another account → alert, stop. Then a compare-and-set mirror; on `.deleted` + `mirrored`, `recordSubscriptionEnded`: one money-history row (unique event id, so a replay **returns early**) and the `BOS_BILLING_SUBSCRIPTION_ENDED` audit. Reads `cancellation_details.reason` from the event payload | One thin call after `recordSubscriptionEnded`, **also on a replay** (§6.1) |
| Plan row write | `BusinessOsAccountPlanRepository.updatePlan(accountId, patch, adminId)` | Admin-shaped: stamps `updated_by_admin_id`, no concurrency condition | New system method with conditions (§6.3). `updatePlan` is not reused |
| After-plan audit | `recordPlanChange` with actor `{ kind: 'system', source: 'stripe_webhook' }` | Reusable as is | New audit key (§7) |
| Trial credits | `credits/creditWindowRule.ts`, `ownerCreditUsage.ts` | A `{ total }` allowance is summed **from `period_anchor`** (V-7) | The anchor moves to the end date, which gives a fresh total (§5) |
| Settlement margin | `config/lifecycle.ts` `renewalSettlementMarginHistory` = 1 day | A tier stays in force until `tier_expires_at` + 1 day | Bears on the start of the free period (S-2) |

### 1.2 Whether existing data can give the repeat-cancel count

See §3. In short, no:

- **Audit trail.** Not reliable, because rows are archived out of `audit_trail` (admin archiving module) and audit writes are non-blocking.
- **`subscription_ended` money-history rows.** They have no reason column, so they also count `payment_failed` ends and ends from before SX-2b.
- **The plan row.** It has no history.

### 1.3 Other facts

- **One migration (20261098), columns only, no FK.** The plan table is never purged and is excluded from export (`descriptors.ts` line ~1476). So there is no descriptor change, no cleanup regeneration and no regen lock. If SA prefers a table (S-1 option B), then a regen (20261098, chained on `20261096_operator_test_account_cleanup_export_requests`, descriptors from 164) and the lock are needed.
- **`console.*` count** on every file D3.1 expects to touch (`planSubscriptionMirror.ts`, `planBillingHandler.ts`, `BusinessOsAccountPlanRepository.ts`, `afterPlan.ts`, `config/afterPlan.ts`, `EntitlementService.ts`, `planEndingView.ts`, `snapshot.ts`, `scripts/write-entitlements-snapshot.ts`, `lib/audit/events.ts`, `eventAudience.ts`): **0**.
- **Not V6 work.** The new pattern is a system write of plan state from the webhook (SA Q-11 already chose where). The repository method and its wiring file are new entries in the entitlements imports guard (§8).
- **The base is stacked.** This branch sits on D3, which is not on `main`. See §17 for how the two reach `main` together (C-9).

---

## 2. Implementation Approach

1. **The rule (entitlements module, pure).** `afterPlanAccount` gains an explicit `priorMoves` input and computes the halved length inside itself, from config. The drawer's preview and the writer both pass the count, so `{until}` and the stored date are the same value (SA comment 1).
2. **The count (plan row, one migration).** There are two new columns: `after_plan_moves` (how many free-after-cancel moves this account has had) and `after_plan_last_subscription_id` (the subscription that gave the last one; this is the idempotency key). They are written in **the same single UPDATE** as the cohort and pins, so the count and the move cannot disagree.
3. **The writer (DELETE-owned, injected ports).** This is `lib/business-os/billing/afterPlanMove.ts`. It decides by `cancellation_details.reason`, reads the plan row fresh, applies `afterPlanAccount`, and writes through a new repository method with optimistic conditions. Then it calls `recordPlanChange` (invalidate, audit, bounded flush). Its production wiring lives in `afterPlanMoveDeps.ts`, the one new file that names the plan repository.
4. **The webhook (PLAN PAYMENTS-owned, thin).** `mirrorPlanSubscription` gets one new port, `afterPlanMove`, called after `recordSubscriptionEnded` on `.deleted` when `mirrored` is true. `planBillingHandler.ts` wires that port, one line. Nothing else in their files changes.
5. **The drift snapshot.** `AFTER_PLAN` (cohort, divisor, minimum) is frozen in `entitlements.snapshot.json` like a tier change. This is the SX-2b entry condition from D3 deviation 3.

**Why not the alternatives:**

- The cancel engine (Q-11 option B) and a resolver rule (option C) were rejected by SA.
- A separate "grants" table plus an RPC (S-1 option B) is heavier: a new table with an FK, a cleanup regen and a SQL function. It buys nothing the two columns do not.

---

## 3. Where the repeat-cancel count lives (migration decision)

| Option | Reliable? | Queryable by account? | Cost | Verdict |
|---|---|---|---|---|
| Audit trail (`BOS_BILLING_SUBSCRIPTION_ENDED` details, or the new key) | **No.** Rows are moved to `archived_records` by the archiving module, and audit writes are non-blocking (a failure is logged, not retried) | Yes, until archived | none | Rejected |
| `business_os_billing_events` `subscription_ended` rows | **No.** No reason column. It also counts `payment_failed` ends and ends from before SX-2b, which never gave a free period. It is money history, not a grant record | Yes | none, or a column on a money table | Rejected |
| `recordPlanChange` rows | They **are** audit rows (same as the first row) | — | — | Rejected |
| **A. Two columns on `business_os_account_plans`** (recommended) | Yes. Written in the same UPDATE as the move | Yes, one row per account. It needs no change to the hot entitlement read: only the new methods select the columns | 1 migration, no FK, no regen | **Recommended (S-1)** |
| B. New table `business_os_after_plan_moves` (one row per move, unique subscription id) + an RPC that inserts it and updates the plan row in one transaction | Yes, and it keeps a per-move history | Yes | 2 migrations (table + function, then the cleanup regen 20261098 chained on 20261096, descriptors 164 → 165) + the regen lock | Fallback if SA wants per-move history in SQL |

**Migration (option A): `supabase/migrations/20261098_business_os_account_plans_after_plan_moves.sql`**

- `ALTER TABLE public.business_os_account_plans ADD COLUMN after_plan_moves integer NOT NULL DEFAULT 0`
- `ADD COLUMN after_plan_last_subscription_id text NULL`
- `CHECK (after_plan_moves >= 0)`
- a shape check (`left(…, 4) = 'sub' || chr(95)`, length ≤ 255), following the billing-events style
- a pair check: `(after_plan_moves = 0) = (after_plan_last_subscription_id IS NULL)`
- one transaction, a pre-guard (no anon/authenticated CREATE on `public`; columns absent) and a post-condition
- no FK, no grant changes, no RLS change

The project's companions:

- `scripts/precheck-after-plan-moves.sql`;
- `scripts/check-after-plan-moves-migration.sql`;
- the rollback `supabase/SQL Scripts/20261098_business_os_account_plans_after_plan_moves_rollback.sql`;
- a migration test.

It is a **manual prod gate**: the user applies it **before** the merge deploys. If code ever ran before the columns existed, nothing breaks:

- the writer's read fails and throws, so Stripe retries for up to 3 days and the move applies once the columns exist;
- the preview's count read fails, so `ending` is `null` and the drawer shows its honest "could not work out" line.

The hot path (`findEntitlementInputs`, `PLAN_COLUMNS`) does **not** select the new columns.

**Reservation:** TL reserves **20261098** in the coordination file before T-2 writes the file. Option A needs no regen lock.

---

## 4. The after-plan rule with halving, and the end-date semantics

**File:** `lib/business-os/entitlements/afterPlan.ts` (pure, no I/O, no clock, no cohort id)

```typescript
export function afterPlanAccount(
  account: EntitlementAccount,
  endsAt: string,
  inputs: LifecycleInputs,
  history: { priorMoves: number },          // required: no silent "first time"
  afterPlan: AfterPlanConfig = AFTER_PLAN
): AfterPlanResult;                          // { account, moved, days: number | null }
```

**Config:** `config/afterPlan.ts`

```typescript
export const AFTER_PLAN: AfterPlanConfig = {
  cohort: 'trial',
  // User decision 2026-10-27: each repeat cancel halves the free period, to a minimum.
  repeat: { divisor: 2, minimumDays: 1 },
};
```

**Length:** `days = max(minimumDays, ceil(base / divisor ^ priorMoves))`. Here `base` is the cohort's `durationHistory` entry at `endsAt` (`historyAt`, never a literal 14). With today's config that gives **14 → 7 → 4 → 2 → 1 → 1 …**: ceil(3.5) = 4, ceil(1.75) = 2, ceil(0.875) = 1. Closed-form ceil equals step-by-step ceil for integers, so either reading of "halve each time" gives the same sequence (S-3: ceil proposed). A non-integer or negative `priorMoves` is treated as 0 and logged by the caller. The input is validated by the caller, so this cannot happen from the DB because of the CHECK.

### 4.1 End-date semantics

| Date | Value | Why |
|---|---|---|
| `endsAt` (the input) | **Writer:** Stripe's `ended_at` from the fresh read (`endedAtIso`, already computed by the mirror). **Drawer:** the billing row's period end (D3), or "now" for P-7a.4's "Ends now" (D3 T-13) | For a period-end cancel Stripe ends the subscription **at** `current_period_end`, so the writer's instant equals the drawer's (SA comment 4). For an immediate cancel both are "now" |
| `tier_expires_at` written | The **earlier** of the row's value and `endsAt` (S-11). In practice it is unchanged: a period-end cancel already holds that date, and a `past_due` immediate cancel holds the old paid-through date | Never extend a paid tier. D3's rule sets `tierExpiresAt = endsAt` on a copy. For a `past_due` cancel that would push a lapsed tier forward and give 1 day of the paid plan again (settlement margin). Same change in the preview |
| Survival check (Founding Partner) | `ownCohortAfterPaidTier({ ...account, tierExpiresAt: endsAt })`, unchanged from D3 | The same instant as the preview (SA comment 4). A champion is never moved down |
| **Free period start** `trial_started_at` | **S-2 (recommended):** `freeFrom = max(endsAt, tierSettlementEndsAt(tier_expires_at written))`, i.e. when paid access **really** ends. Period-end cancel: `endsAt + 1 day`. `past_due` immediate cancel: `endsAt` | With D3's `trialStartedAt = endsAt`, the 1-day settlement margin is eaten from the free period. So 14 days is really 13, and the user's **1-day minimum would be 0 days** (the drawer would even show "could not work out", because `after` is no longer live). The alternative keeps D3's dates and accepts that |
| Free period end `trial_ends_at` | `freeFrom + days` | `{until}` in the drawer. With S-2, a first period-end cancel reads period end + 15 days |
| `grace_ends_at` | **S-4:** cleared when the row holds a pin earlier than the new `trial_ends_at` (a stale pin from an earlier lapse or admin op); otherwise kept | A stale pin would make the free cohort's lapse "paused" at once instead of "read-only for 7 days, then paused", which the drawer promises (SA-15) |
| After the free period | Nothing is written. The resolver's normal cohort lapse applies: the trial's `graceHistory` (7 days read-only), then paused | Requirement §3.2: "the normal cohort lapse". No job, no second write |
| `cohort_expires_at` | Unchanged | A cohort with a duration ignores it (D3 §2.2) |

S-2, S-4 and S-11 all go **inside `afterPlanAccount`**, so `previewAfterPlan` (and so the drawer) applies them too. D3's tests that pin `endsAt + 14 d` are updated in T-4 to the S-2 dates if SA rules S-2 as recommended.

### 4.2 The preview reads the count

`EntitlementService.previewAfterPlan` gains one read, `repository.findAfterPlanMoveState(accountId)` → `{ moves, lastSubscriptionId }`. It is uncached and small, and it runs only when the drawer can open (my-plan builds `ending` only on `manage.cancel` + `renewing`). That read passes `priorMoves = moves`. A failed read returns `null` (warn, ids only), so the drawer shows `unknown` and never the first-time 14 days to a repeat canceller (C-9). The my-plan route and its registration do not change.

---

## 5. The credits: a fresh one-off total

Test Flight's allowance is a **one-off total** (`credits.allowance: { total: TRIAL_CREDIT_TOTAL }`, 1,000 today). The owner card, the admin column and the low-line record all sum it **over every credit period from `period_anchor`** (`creditWindowRule` → `trial_total`, `ownerCreditUsage.ts` `listTotalsFrom(anchor)`).

So the fresh total is given by **moving `period_anchor` to the end date in the same UPDATE**. No number is written, so the total is whatever the cohort config says (never hardcoded), and the D3 drawer's `{credits}` (read from the same config) stays true.

- **Value:** `period_anchor = min(endsAt, now)`. Normally that is `endsAt`. `now` guards a Stripe test clock whose `ended_at` is ahead of real time, because a future anchor would make the database's period function count backwards (S-5).
- **Consistent with PF-13** (`adminOps.ts`): the anchor moves only when no plan subscription is live. The mirror has already set `ended_at` before this step runs.
- **A period-end cancel keeps its period keys.** The old anchor's next period starts exactly at `endsAt`, so charges just after the end key to `endsAt` under either anchor.
- **Usage counted:** paid usage from before `endsAt` falls outside the trial window. Usage during the 1-day settlement margin (still the paid tier) counts against the fresh total (S-5, at most one day).
- **Not credit lots.** A lot is "extra credits" on top of the allowance. A former payer's trial total, summed from an old anchor, is already used up, so a lot would show 1,000 extra on top of a negative trial balance, which is wrong. Lots also need an admin actor and a reason, and they are slice 11's.
- **A re-purchase re-anchors anyway.** The paid-invoice RPC sets the anchor on a new subscription's first paid invoice.

---

## 6. The writer, step by step

### 6.1 The thin webhook call (PLAN PAYMENTS files)

**File:** `lib/business-os/billing/planSubscriptionMirror.ts`

```typescript
// PlanSubscriptionMirrorDeps gains one port:
afterPlanMove: (input: AfterPlanMoveInput, log: Logger) => Promise<void>;

// in mirrorPlanSubscription, replacing the existing `.deleted` block:
if (event.type === 'customer.subscription.deleted' && mirrored.data.mirrored) {
  await recordSubscriptionEnded(event, embedded, account, endedAtIso, log, deps);
  // SX-2b (D3.1): owner-started end → free cohort. DELETE-owned module; decides everything itself.
  await deps.afterPlanMove(
    {
      accountId: account.accountId,
      subscriptionId,
      livemode: event.livemode,
      stripeEventId: event.id,
      endedAt: endedAtIso,
      cancellationReason: embedded.cancellation_details?.reason ?? null,
    },
    log
  );
}
```

- It is called **after** `recordSubscriptionEnded` and **outside** it. `recordSubscriptionEnded` returns early on a replayed event, and a replay is exactly when an earlier move attempt that threw must run again.
- It runs only when `mirrored` is true: the billing row, found by subscription id and mode (SR-8), **still holds this subscription** (SA Q-11 (2), (3)). A newer subscription means `mirrored: false`, so nothing is called.
- **Throw means retry.** `afterPlanMove` throws only on a read or write failure, or on a stale write (§6.3). The route then releases the claim and Stripe retries. The retry re-runs the mirror (idempotent) and `recordSubscriptionEnded` (duplicate, so it returns), then the move (idempotent, §6.3).
- **`planBillingHandler.ts`:** one line in the production ports, `afterPlanMove: applyAfterPlanMove` from `afterPlanMoveDeps.ts`. Its type is already the union of the use-case deps, so it needs no other edit.

### 6.2 The DELETE module

**File:** `lib/business-os/billing/afterPlanMove.ts` (DELETE-owned; ports injected; no repository named)

| # | Step | On no |
|---|---|---|
| 1 | `cancellationReason === 'cancellation_requested'` | `info` `bos_plan_after_plan_skipped` `{ skip: 'not_owner_end', cancellationReason }`, return. `payment_failed`, `payment_disputed` and null keep today's path |
| 2 | `endedAt` is a parseable instant | `warn` `skip: 'no_end_date'`, return |
| 3 | `isGrantableCohort(config, AFTER_PLAN.cohort)` (GR-1) | `error` + `alert: true` `skip: 'after_plan_misconfigured'`, return (a retry cannot fix config) |
| 4 | Read fresh: `findAfterPlanMoveInputs(accountId)` → plan row (`PLAN_COLUMNS`) + `after_plan_moves` + `after_plan_last_subscription_id`, `.eq('user_id', accountId)` | No row → `warn` `skip: 'no_plan_row'`, return. Read error → throw |
| 5 | **Idempotency:** `after_plan_last_subscription_id === subscriptionId` | `info` `skip: 'already_applied'`, return. No write, no audit |
| 6 | `afterPlanAccount(fromPlanRow(row), endedAt, lifecycleInputs, { priorMoves: row.after_plan_moves })` | `moved: false` (own cohort survives, champion BQ-5) → `info` `skip: 'own_cohort_survives'`, return. **No count increment** |
| 7 | Write (§6.3) with the diff of the result against the row + `period_anchor` (§5) + `after_plan_moves + 1` + this subscription id | `stale` → `warn` `bos_plan_after_plan_stale`, **throw** (retry). Error → throw |
| 8 | `recordPlanChange` (system actor `stripe_webhook`, `invalidatesEntitlements: true`, §7) | Never throws (its own contract) |
| 9 | `info` `bos_plan_after_plan_moved` | — |

**Account id:** taken only from **our billing row** (passed in by the mirror, `resolveAccountId`). Stripe metadata is never read here. The mirror has already refused a metadata claim for another account (tenant-isolation-guard).

### 6.3 The repository write

**File:** `lib/repositories/BusinessOsAccountPlanRepository.ts`. Two new methods follow the `new-repository` skill (`RepositoryResult`, injected client, scoped logger, `user_id` filter).

```typescript
/** SX-2b: the plan row plus the after-plan move state, read fresh (never the entitlement cache). */
findAfterPlanMoveInputs(accountId: string): Promise<RepositoryResult<BusinessOsAfterPlanMoveInputs | null>>;
/** SX-2b: the count only, for the Cancel drawer's preview. */
findAfterPlanMoveState(accountId: string): Promise<RepositoryResult<{ moves: number; lastSubscriptionId: string | null }>>;

/**
 * SX-2b: the system write of the after-plan move. One UPDATE, conditional:
 *   .eq('user_id', accountId)
 *   .eq('after_plan_moves', expected.moves)                     // concurrent duplicate deliveries: one wins
 *   .eq('tier_expires_at', expected.tierExpiresAt) | .is(null)  // a paid invoice that landed in between wins
 * Sets the allow-listed fields only (cohort, trial_started_at, trial_ends_at, tier_expires_at when changed,
 * grace_ends_at when cleared, period_anchor, after_plan_moves, after_plan_last_subscription_id), updated_at,
 * and updated_by_admin_id = NULL (a system write).
 * `{ outcome: 'applied', row }` or `{ outcome: 'stale' }` (no row matched). No `.or()` (PostgREST
 * update + or + select bug).
 */
applyAfterPlanMove(input: ApplyAfterPlanMoveInput): Promise<RepositoryResult<ApplyAfterPlanMoveResult>>;
```

- `expected.tierExpiresAt` is the **exact string** the read returned, as the credit-period code does, so microseconds never break the equality.
- The cohort id written is validated by the caller (`isGrantableCohort`). The method accepts no caller object: it takes named fields (tenant-isolation-guard §3).
- **Imports guard:** `applyAfterPlanMove` joins `WRITE_METHODS` in `businessOsEntitlements.imports.guard.test.ts`. `afterPlanMoveDeps.ts` becomes the one wiring file allowed to call it (pattern: `INVITE_REDEMPTION_WIRING`). `findAfterPlanMoveState` is a read used by `EntitlementService` (already a no-state-write referrer).

---

## 7. Audit and logging

**Audit** (through `recordPlanChange`, on `applied` only):

| Field | Value |
|---|---|
| `action` | New key **`BOS_PLAN_FREE_PERIOD_AFTER_CANCEL`** in `lib/audit/events.ts` at the DELETE anchor (SR-10, add only), audience as `BOS_BILLING_SUBSCRIPTION_ENDED` (`'bos'`) in `eventAudience.ts` |
| actor | `{ kind: 'system', source: 'stripe_webhook' }`, so `platformActorId()` + `details.actor = 'stripe_webhook'` (never the owner) |
| `entityType` / `entityId` | `'business_os_account_plan'` / the account id |
| `changes` | `before` / `after` of `cohort`, `trial_started_at`, `trial_ends_at`, `tier_expires_at`, `grace_ends_at`, `period_anchor`, `after_plan_moves` |
| `details` | `automatic: true`, `trigger: 'owner_end'`, `cancellationReason`, `subscriptionId`, `endedAt`, `days`, `priorMoves`, `cohort` (the config id), `livemode`, `stripeEventId`. No email, no name, no reason code (the owner's reason stays on `BOS_BILLING_SUBSCRIPTION_CANCELLED`) |
| `severity` | `info` |
| `invalidatesEntitlements` | `true` (the plan row changed) |

**Pino** (`createLogger({ module: 'BusinessOsAfterPlanMove' })`, child of the webhook's request logger so the claim's correlation context carries through): `bos_plan_after_plan_moved` (info), `bos_plan_after_plan_skipped` (info / warn, with `skip` from a closed list), `bos_plan_after_plan_stale` (warn), `after_plan_misconfigured` (error, `alert: true`), and read/write errors as `{ err }`. Fields are **ids and codes only**: `accountId` (UUID), `subscriptionId`, `livemode`, `stripeEventId`, `priorMoves`, `days`, `skip`, `cancellationReason`. No email, no business name, no Stripe customer object.

---

## 8. Files to Create / Modify

| File | Action | Owner | Reason |
|---|---|---|---|
| `supabase/migrations/20261098_business_os_account_plans_after_plan_moves.sql` | create | DELETE | §3 option A |
| `supabase/SQL Scripts/20261098_business_os_account_plans_after_plan_moves_rollback.sql` | create | DELETE | Rollback |
| `scripts/precheck-after-plan-moves.sql`, `scripts/check-after-plan-moves-migration.sql` | create | DELETE | Prod gate pre-check + checker |
| `supabase/migrations/__tests__/business-os-after-plan-moves.migration.test.ts` | create | DELETE | Columns, defaults, checks, no FK, one transaction |
| `lib/repositories/BusinessOsAccountPlanRepository.ts` | modify | shared (entitlements) | Three methods (§6.3); `PLAN_COLUMNS` untouched |
| `lib/repositories/__tests__/BusinessOsAccountPlanRepository.afterPlanMove.test.ts` | create | DELETE | §10 |
| `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` | modify | shared | `WRITE_METHODS` + the wiring allowance |
| `lib/business-os/entitlements/config/afterPlan.ts` | modify | DELETE | `repeat: { divisor, minimumDays }` |
| `lib/business-os/entitlements/afterPlan.ts` | modify | DELETE | Halving, S-2, S-4, S-11; returns `days` |
| `lib/business-os/entitlements/EntitlementService.ts` | modify | DELETE (D3 method) | `previewAfterPlan` reads the count |
| `lib/business-os/entitlements/snapshot.ts`, `scripts/write-entitlements-snapshot.ts`, `__tests__/entitlements.snapshot.json` (regenerated, never hand-edited) | modify | entitlements | `afterPlan` frozen in the drift snapshot (D3 deviation 3, SA Q-10) |
| `lib/business-os/entitlements/__tests__/afterPlan.test.ts`, `previewAfterPlan.test.ts`, `planEndingView.test.ts` | modify | DELETE (D3 tests) | Halving, dates, count |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | shared | `KNOWN_NON_GATE_IMPORTERS` entries for `afterPlanMove.ts` and `afterPlanMoveDeps.ts` (exact symbols, `why`: writes the after-plan move from the webhook, refuses nothing by plan, no `check()` / `decide()`) |
| `lib/business-os/billing/afterPlanMove.ts` | create | **DELETE** | The use case (§6.2) |
| `lib/business-os/billing/afterPlanMoveDeps.ts` | create | **DELETE** | Production wiring (plan repository, config, `recordPlanChange`, clock) |
| `lib/business-os/billing/__tests__/afterPlanMove.test.ts` | create | DELETE | §10 |
| `lib/business-os/billing/__tests__/afterPlanMove.guard.test.ts` | create | DELETE | Source: reads no Stripe metadata, names no cohort id, called only from the mirror |
| **`lib/business-os/billing/planSubscriptionMirror.ts`** | modify | **PLAN PAYMENTS** | One port + one call (§6.1), header line 5 amended ("no plan write" → "the after-plan move is SX-2b's port") |
| **`lib/business-os/billing/planBillingHandler.ts`** | modify | **PLAN PAYMENTS** | One production-port line |
| **`lib/business-os/billing/__tests__/planSubscriptionMirror.test.ts`**, **`planBillingHandler.test.ts`** | modify | **PLAN PAYMENTS** | Deps builders gain a stub port; new rows (§10) |
| **`lib/business-os/billing/__tests__/planRenewal.captured.test.ts`** | modify | **PLAN PAYMENTS** | Deps builder gains the stub `afterPlanMove` port (forced by the new required port), plus one assertion that the captured Stripe give-up hands the port `payment_failed`. Accepted by PLAN PAYMENTS SA (SA part 2 comment 1) |
| **`app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts`** | modify | **PLAN PAYMENTS** | One registration entry, `'afterPlanMoveDeps.ts': [ACCOUNT_PLANS]`, appended with a D3.1 comment (existing order kept). Written in the DELETE scope because the guard is red without it; **part of the T-8 diff** PLAN PAYMENTS reviews (SA part 1 ruling) |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts` | modify | shared (add only, DELETE anchor) | New key |
| `docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md` | modify (BA / TL) | DELETE | SX-2b as-built note, the count location, the S-2 date rule |

**Not touched:** `app/api/stripe/webhook/route.ts`, `planPaymentApply.ts` (FU-P7a4-1's area), `planSubscriptionManage.ts` / `planManageOffer.ts` / `planPurchaseView.ts` / the cancel and reactivate routes / `StripeService.ts` (the cancel engine), the my-plan route, `adminOps.ts`, `cohorts.ts`, `tierMatrix.ts`, purge descriptors, the cleanup generator, the translation files, the D3 drawer.

---

## 9. Task List

- ✅ **T-0** SA reviewed (DR-1 to DR-12, PLAN PAYMENTS conditions folded in); user answered U-1, U-2, U-3, U-5 (2026-10-27)
- ✅ **T-1** Base check: P-7a.4 and FU-P7a4-1 merged → TL rebases this branch (D3's T-13 "now" seam resolved by D3's owner). Re-read the mirror and the handler port list after the rebase. `console.*` recount. **Done 2026-10-27 as merges, not a rebase** (the DELETE work was uncommitted): backup patch + untracked copies taken, tracked changes reset, `origin/feature/plan-cancel-drawer-d3` (`9e2b3f6a`) merged → `195b7afb`, `origin/main` (`b088b51d`) merged → `841163f4`, both without conflicts; the patch re-applied cleanly with `git apply --3way` (all 22 files clean) and unstaged; the drift snapshot regenerated and came out identical. The mirror and the handler port list are unchanged by P-7a.4 / FU-P7a4-1 (last touched by P-6a.2), so T-8 needed exactly the one handler-port line (DR-12 holds). `console.*`: 0 in every touched file
- ✅ **T-2** Migration 20261098 + rollback + pre-check + checker + migration test. **Not applied anywhere**: the user pastes it on prod (U-4)
- ✅ **T-3** Repository: `findAfterPlanMoveInputs`, `findAfterPlanMoveState`, `applyAfterPlanMove` (DR-5 compare-and-set on `updated_at` + `after_plan_moves`, `{ count: 'exact' }`, no `tier_expires_at`) + tests + imports guard
- ✅ **T-4** `AFTER_PLAN.repeat` + `afterPlanAccount` (DR-4 order: paid-through, survival, halving, S-2 start, S-4 pin; `days`, closed `skip` list) + D3 test updates
- ✅ **T-5** Drift snapshot: `afterPlan` in `EntitlementSnapshot`, `findDrift` (`after_plan_changed`), the script, regenerated JSON (`npm run entitlements:snapshot`)
- ✅ **T-6** `previewAfterPlan` reads the count; `planEndingView` tests for repeat cancels; `unknown` on a non-survival skip
- ✅ **T-7** `afterPlanMove.ts` + `afterPlanMoveDeps.ts` + tests + guard + registrations. The production port is `afterPlanMove`, exported from `afterPlanMoveDeps.ts` (type `AfterPlanMovePort`)
- ✅ **T-8** (after P-7a.4 and FU-P7a4-1 merge, then TL's rebase; **done 2026-10-27**, exact files and lines in "T-8 for PLAN PAYMENTS" below) Thin call in `planSubscriptionMirror.ts`: one port `afterPlanMove: AfterPlanMovePort`, and one call after `recordSubscriptionEnded` inside `.deleted && mirrored` (also on a replay) passing `{ accountId, subscriptionId, livemode, stripeEventId: event.id, endedAt: endedAtIso, cancellationReason }`. Plus one wiring line in `planBillingHandler.ts` (`afterPlanMove` from `afterPlanMoveDeps.ts`), their test rows (§10) and the DR-8 guard row (the mirror passes no `metadata` into the port input). **Added 2026-10-27 (PLAN PAYMENTS SA ruling on FU-P7a4-1):** in the same edit, delete the mirror's local `CANCELLATION_REASONS` list and import `BUSINESS_OS_CANCELLATION_REASONS` from `lib/stripe/StripeService.ts` instead (one list, no pin test). PLAN PAYMENTS reviews this diff
- ✅ **T-9** Audit key `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL` + audience `'bos'` at the DELETE anchor; filter group `BOS_PLAN_` → "Business OS Billing"
- ✅ **T-10** Verify (DELETE scope): results in "T-10 results" below
- ⬜ **T-11** (deferred to after merge by the user, 2026-10-28) Sandbox check (with QA): a test-clock period-end cancel and a P-7a.4 immediate cancel each move the account once; a replayed event changes nothing; a second cancel gives 7 days

---

## 10. Tests

Pure Jest with injected ports. No added CI time.

| Test | What it pins |
|---|---|
| `afterPlan.test.ts` | `priorMoves` 0 to 6 → 14, 7, 4, 2, 1, 1, 1 with the real config. A fixture config with a base of 10 and minimum 2 → 10, 5, 3, 2, 2 (no literal in the rule). A dated or open-ended Founding Partner → `moved: false` for every `priorMoves`. S-2: `trial_started_at` = settlement end for a period-end cancel and `endsAt` for a `past_due` immediate one. S-11: `tierExpiresAt` never later than the input row. S-4: a stale `graceEndsAt` cleared, a later one kept. Input not mutated. No cohort id in the source |
| `previewAfterPlan.test.ts` | The count read is used (`moves: 2` → `until` = start + 4 d). A failed count read → `null` + warn. The cache object is not mutated. Still one plan read (cache) |
| `planEndingView.test.ts` | `free_plan.until` for a repeat canceller; `credits` still the config total |
| `afterPlanMove.test.ts` | **Reason:** `cancellation_requested` → write; `payment_failed`, `payment_disputed`, null → no read, no write, no audit. **Current subscription:** the module is never reached when `mirrored: false` (mirror test); the writer uses only the account id passed in. **Idempotency:** `last_subscription_id === sub` → no write, no audit; `stale` → throws, and the retry with the updated row → `already_applied`; two parallel calls → one write. **Champion:** open-ended or dated-live → no write, count unchanged. **Halving:** `after_plan_moves` 0 / 1 / 4 → 14 / 7 / 1 days written and `moves + 1`. **Credits:** `period_anchor = min(endedAt, now)` (test-clock row). Missing `endedAt` → skip warn. No plan row → skip warn. Misconfigured `AFTER_PLAN` → error with alert, no write, no throw. Read / write error → throws. Audit entry: key, system actor, `automatic: true`, no PII. Log fields are a closed set |
| `afterPlanMove.guard.test.ts` | Source: no `metadata` read, no cohort id or tier literal, no `.updatePlan(`; `applyAfterPlanMove` called only from `afterPlanMoveDeps.ts` |
| `planSubscriptionMirror.test.ts` (PLAN PAYMENTS file) | `.deleted` + mirrored → `afterPlanMove` once, after `recordSubscriptionEnded`, with the payload's reason and `endedAtIso`. **A replayed `.deleted`** (money-history duplicate) → still called. `.updated` → not called. `mirrored: false` → not called. Metadata mismatch → not called. `afterPlanMove` throws → the mirror throws (claim released) |
| `planBillingHandler.test.ts` | The production ports include `afterPlanMove`; the PF-15 mode mismatch still writes nothing |
| `BusinessOsAccountPlanRepository.afterPlanMove.test.ts` | Each method: the `user_id` filter; the selected columns (not `*`); `applyAfterPlanMove` payload is the allow-list only, `updated_by_admin_id: null`, `.eq('after_plan_moves', n)`, `tier_expires_at` `.eq` vs `.is(null)`, no `.or(`; no-match → `stale`; error → `{ data: null, error }` + log |
| `businessOsEntitlements.imports.guard.test.ts` | `applyAfterPlanMove` in `WRITE_METHODS`; only the wiring file calls it |
| `enforcementPoints.test.ts` | Two new non-gate importers, exact symbols; nothing added to `ENFORCEMENT_POINTS` |
| Drift snapshot (`snapshot.test.ts` or the existing drift suite) | The committed snapshot holds `afterPlan`. Changing the cohort, the divisor or the minimum without regenerating → drift reported |
| `business-os-after-plan-moves.migration.test.ts` | Number and name, one `BEGIN` / `COMMIT`, the three checks, defaults, no `REFERENCES`, no `GRANT` to anon / authenticated; the duplicate-prefix guard (SR-7) stays green |
| Audit registration (existing `events` tests) | The key is registered with an audience |

**Run list (T-10):** `lib/business-os/billing`, `lib/business-os/entitlements`, `lib/repositories/__tests__`, `supabase/migrations/__tests__`, `app/api/stripe`, `app/api/business-os/entitlements`, `components/business-os/settings` (D3's drawer against the new dates), `lib/audit/__tests__`, and `npm run test:bos-entitlements` (required by the entitlements skill).

---

## 11. Acceptance Criteria

- ⬜ **AC-D31.1** A `customer.subscription.deleted` with `cancellation_requested`, on the subscription our billing row still holds, moves a non-champion account to `AFTER_PLAN.cohort`. The free period lasts the configured days (halved per earlier move, minimum from config). The credit total is fresh from config. One audit entry.
- ⬜ **AC-D31.2** `payment_failed`, `payment_disputed` and a missing reason write nothing: today's grace → paused path.
- ⬜ **AC-D31.3** A Founding Partner whose free access outlives the plan is not moved and its count does not change.
- ⬜ **AC-D31.4** A replayed or concurrent duplicate event moves the account at most once. A newer subscription is never overwritten.
- ⬜ **AC-D31.5** The drawer's `{until}` equals the `trial_ends_at` the writer stores, for a first and a repeat cancel (one rule, `afterPlanAccount`).
- ⬜ **AC-D31.6** `AFTER_PLAN` is in the drift snapshot; `npm run test:bos-entitlements` is green.
- ⬜ **AC-D31.7** The webhook diff is one port and one call in `planSubscriptionMirror.ts` plus one wiring line in `planBillingHandler.ts`, reviewed by PLAN PAYMENTS.
- ⬜ **AC-D31.8** Migration 20261098 is applied on prod before the deploy, and its checker is green. No `console.*`; logs carry ids and codes only.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A move is lost: the money-history row is written, the move throws, and the replay returns early | The call sits **after** `recordSubscriptionEnded`, outside it, and runs on a replay too (§6.1). Test row |
| R-2 | A double move or a double count from Stripe redelivery | `after_plan_last_subscription_id` short-circuit + `.eq('after_plan_moves', n)` on the UPDATE (§6.3) |
| R-3 | A new subscription's paid invoice races the move and the move overwrites the new tier | The mirror's CAS (`mirrored`) + `.eq('tier_expires_at', read)` on the UPDATE → `stale` → retry → the mirror then reports `mirrored: false` and nothing runs |
| R-4 | The drawer and the writer disagree on the date | Same function; the preview reads the same count; the writer's `ended_at` equals the drawer's period end for a period-end cancel. Test AC-D31.5 |
| R-5 | The 1-day settlement margin eats the free period, so the minimum gives 0 days | S-2 |
| R-6 | Code deployed before the migration | No hot-path change; the writer throws and Stripe retries (up to 3 days); the preview shows `unknown`. Apply-before-merge is the gate |
| R-7 | A missed webhook (Stripe gives up) → no free period, today's grace path | Stated, as SA R-13 allows; no reconciliation job in this first cut. The audit gap is visible next to `BOS_BILLING_SUBSCRIPTION_ENDED` |
| R-8 | An admin cancelling in the Stripe dashboard also produces `cancellation_requested` | Stripe cannot tell them apart. The user is asked (U-2); an admin can `set_cohort` afterwards |
| R-9 | Conflicts with PLAN PAYMENTS' FU-P7a4-1 (`bos_billing_paid_after_end` on `invoice.paid`) | Different file (`planPaymentApply.ts`). At most the handler's port list overlaps; whoever merges second rebases and keeps both |
| R-10 | A test clock's `ended_at` is ahead of real time | Anchor = `min(endedAt, now)`. The trial dates follow clock time like every other test-clock date |

---

## 13. Open items for SA

| # | Question | Dev recommendation |
|---|---|---|
| **S-1** | Where the repeat-cancel count lives (§3) | **Option A**, two plan-row columns, migration 20261098, no regen. B (table + RPC + regen 20261098) only if per-move history in SQL is wanted |
| **S-2** | When the free period starts: at `endsAt` (D3 today) or when paid access really ends (`endsAt` + 1-day settlement for a period-end cancel)? | **Settlement end.** Otherwise every period is a day short and the 1-day minimum is 0 days (the drawer would show `unknown`). D3's tests move by one day. The user sees it as `{until}` = period end + 15 days on a first cancel (U-3) |
| **S-3** | Rounding of the halving | **ceil**: 14, 7, 4, 2, 1 (the user's own sequence) |
| **S-4** | A stale `grace_ends_at` pin earlier than the new trial end | **Clear it** inside `afterPlanAccount` (the preview then agrees). Keep a later pin |
| **S-5** | Credits: `period_anchor = min(endedAt, now)`; settlement-day usage counts against the fresh total | Approve; the alternative (anchor at the settlement end) puts a future anchor in the period function |
| **S-6** | The module in `lib/business-os/billing/` (DELETE-owned, named in the coordination row) rather than `account-deletion/` | Approve. It is a billing event consumer, and D2's `planLeaveReasons.ts` set the precedent |
| **S-7** | A stale write throws (claim released, Stripe retries) rather than returning | Approve. A return would drop a move a retry can make correctly |
| **S-8** | Audit key `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL`, audience `'bos'`, `invalidatesEntitlements: true` | Approve or rename |
| **S-9** | New repository write method `applyAfterPlanMove` (system write, `updated_by_admin_id = NULL`) + wiring file allowance in the imports guard (rule 7, new pattern) | Approve; it mirrors the invite-finalise allowance |
| **S-10** | The reason is read from the **event payload** (`embedded.cancellation_details`), as P-6a.2 does, not from the fresh read | Approve; the reason is fixed once the subscription is deleted, and widening `retrieveBusinessOsSubscription` would edit `StripeService.ts` |
| **S-11** | `afterPlanAccount` never extends `tierExpiresAt` (earlier of row and `endsAt`) | Approve; same change seen by the preview |

---

## 14. For PLAN PAYMENTS to review

Before T-8 is coded, and again on the diff:

1. **`planSubscriptionMirror.ts`:** the one new port `afterPlanMove` and the one call after `recordSubscriptionEnded`, inside the existing `.deleted && mirrored` branch, **also on a replay**. The header's step 5 line changes from "No plan write" to "the after-plan move (SX-2b) runs through its port". `recordSubscriptionEnded` itself is unchanged.
2. **`planBillingHandler.ts`:** one production-port line (`afterPlanMove`). The switch, PF-15 and the other ports are unchanged.
3. **Their tests:** the deps builders in `planSubscriptionMirror.test.ts` and `planBillingHandler.test.ts` gain a stub port; the new rows are in §10.
4. **Retry semantics:** a failure inside the move throws through their handler (claim released, the mirror re-runs). Confirm this is acceptable on their `.deleted` path.
5. **Ordering with FU-P7a4-1:** it is in `planPaymentApply.ts`, which D3.1 does not touch. Agree who rebases.
6. **Interplay:** a late `invoice.paid` on the ended subscription (FU-P7a4-1's case, voided by P-7a.4's C-11) can still re-extend the tier after the move. The move's trial pins then stay hidden behind the tier until it lapses. Confirm no further handling is wanted in D3.1.

---

## 15. For the user

| # | Point | Default |
|---|---|---|
| **U-1** | Does the repeat-cancel count ever reset (say, after a year of paying)? | **Never** (the user's rule as stated). One cancel a year for five years ends at 1 day |
| **U-2** | An admin who cancels a subscription in the Stripe dashboard also produces "owner requested", so that account gets the free period too | **Accept** (rare; an admin can change the cohort afterwards) |
| **U-3** | If SA rules S-2: the 14 days start when paid access really ends (one day after the period end, Stripe's payment settlement window). So the drawer's "until" date is period end + 15 days on a first cancel | Pending SA |
| **U-4** | Manual prod step: paste migration 20261098 (pre-check, apply, checker) **before** this step merges | Required |

---

## 16. Estimate

**≈ 2.1 d** (cap 2.5 d; the plan said ≈ 1.5 d):

| Task | Days |
|---|---|
| T-1 | 0.05 |
| T-2 (migration + companions) | 0.35 |
| T-3 | 0.3 |
| T-4 | 0.3 |
| T-5 (the snapshot extension D3 deferred) | 0.2 |
| T-6 | 0.15 |
| T-7 | 0.4 |
| T-8 | 0.15 |
| T-9 | 0.05 |
| T-10 | 0.15 |

T-11 (sandbox) is QA time. The difference from 1.5 d is the migration and its prod-gate companions, plus the snapshot line D3 handed over. If SA picks S-1 option B, add about 0.6 d (table + function + regen), which goes over the cap: stop and tell TL.

---

## 17. Sequencing and hand-overs

- **Order:** P-7a.4 merges → D3 merges `main` and wires its "now" mode (D3 T-13, which also passes through `previewAfterPlan`, so it gets the count automatically) → D3.1 builds on that → 20261098 applied on prod → **D3 and D3.1 reach `main` in the same deploy** (C-9, SA Q-9). Because D3.1 is stacked on D3, the simplest route is **one PR from this branch to `main` carrying both commits, with #539 closed as included**. The alternative is D3 merging immediately followed by D3.1 in one queue run. RM / TL decide, and never stacked-into-branch (memory: stacked PR hazard).
- **Coordination file (TL):** reserve 20261098; add an SX-2b shared-items row: `planSubscriptionMirror.ts` + `planBillingHandler.ts` + their tests, sequenced with PLAN PAYMENTS (P-7a.4 first, FU-P7a4-1 either side); `afterPlanMove*.ts` DELETE-owned. No regen lock under S-1 A.
- **D6 (deletion request):** ends the plan through the same engine, so its Stripe end carries `cancellation_requested` and D3.1 covers it. D6 confirms on the sandbox.
- **D4 (cancel emails):** the "what happens next" line can read the audit's `days` / `trial_ends_at`, or `planEndingView`.
- **Admin view:** `describeAccountPlans` shows the trial cohort with its dates as it already does. Showing `after_plan_moves` there is a possible follow-up, not in D3.1.

---

### T-10 results (DELETE scope, 2026-10-27)

| Check | Result |
|---|---|
| Jest: `lib/business-os/billing`, `lib/business-os/entitlements`, `lib/repositories/__tests__`, `supabase/migrations/__tests__`, `app/api/stripe`, `app/api/business-os/entitlements`, `app/api/business-os/billing`, `components/business-os/settings`, `lib/audit/__tests__`, `lib/business-os/credits` | 415 suites, 14,094 tests: green (after the router-guard registration, deviation 6) |
| `npm run test:bos-entitlements` | 324 suites, 9,657 tests: green |
| ESLint on touched files | 0 errors. Warnings: three commented `any` in the new repository test stub (same pattern as the existing suite), one in `lib/audit/events.ts` that was already there |
| `npx tsc --noEmit` (`--max-old-space-size=8192`) | Completed, no OOM or V8 trace. 0 errors in touched files (only the repo's existing errors) |

### Deviations from the plan (DELETE scope)

1. **The production port is named `afterPlanMove`** (exported from `afterPlanMoveDeps.ts`), not `applyAfterPlanMove`, so it cannot be confused with the repository write of that name. T-8's wiring line uses the port's own name.
2. **`applyAfterPlanMove` returns `{ outcome: 'applied', moves } | { outcome: 'stale' }`** without the row: DR-5's `{ count: 'exact' }` with no `.select()`. The audit `after` is built from the rule's result.
3. **`EntitlementService`'s repository option takes `findAfterPlanMoveState` as optional.** A repository without it fails closed (`null`, the drawer's "could not work out"), so the many fakes that never preview need not change.
4. **`previewAfterPlan` resolves `after` past the LATER of the two settlement ends** (`endsAt`'s and the row's paid-through date's), so a row paid through inside the margin after `endsAt` is not read as still paid (the S-2 instant).
5. **`planEndingView` returns `unknown` explicitly** when the rule skipped for any reason other than `own_cohort_survives`, so the preview agrees with the S-11 replacement.
6. **Shared files outside §8, registration only:** `lib/audit/filterOptions.ts` (a `BOS_PLAN_` group rule; without it the key falls into a group called "Bos"), `lib/audit/__tests__/eventAudience.test.ts` (count 62 → 63 BOS), `lib/repositories/index.ts` (re-exports the new types) and **PLAN PAYMENTS' `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts`** (one entry: `afterPlanMoveDeps.ts` imports the plan repository).
7. **DR-9 rows** went into `creditLeakCheck.test.ts` (re-anchored mid-period, charges on both sides, no leak) and `ownerCreditUsage.test.ts` (the trial total summed from the moved anchor reads the full total).

### T-8 for PLAN PAYMENTS (webhook wiring, 2026-10-27)

Line numbers are in the working tree after the T-1 merges (HEAD `841163f4`).

| File | Lines | Change |
|---|---|---|
| `lib/business-os/billing/planSubscriptionMirror.ts` | 29-39 | Header: step 5 "No plan write" → "No plan write here"; new step 6 describes the after-plan port (also on a replay; account id from our billing row, never metadata; a throw releases the claim) |
| | 50 | `import { BUSINESS_OS_CANCELLATION_REASONS, type StripeService } from '@/lib/stripe/StripeService'` (was type-only) |
| | 60 | `import type { AfterPlanMovePort } from '@/lib/business-os/billing/afterPlanMove'` |
| | 69-70 | `PlanSubscriptionMirrorDeps.afterPlanMove: AfterPlanMovePort` |
| | (old 62-63) | The local `CANCELLATION_REASONS` list deleted |
| | 150-163 | The one call, after `recordSubscriptionEnded`, inside `.deleted && mirrored`: `{ accountId: resolveAccountId(account.accountId), subscriptionId, livemode: event.livemode, stripeEventId: event.id, endedAt: endedAtIso, cancellationReason: embedded.cancellation_details?.reason ?? null }` |
| | 197 | `recordSubscriptionEnded` filters through `BUSINESS_OS_CANCELLATION_REASONS` (the only edit inside it; behaviour identical) |
| `lib/business-os/billing/planBillingHandler.ts` | 67, 133-134 | Import `afterPlanMove` from `afterPlanMoveDeps.ts`; one production-port line `afterPlanMove,`. The switch, PF-15 and the other ports unchanged |
| `lib/business-os/billing/__tests__/planSubscriptionMirror.test.ts` | 17-27, 94-95, 276-532 | Imports for the real move (stateful replay row); stub port in `setup`; 10 port rows (order after history + audit, exact payload, reason verbatim ×4, replay still calls, `.updated` / `mirrored: false` / metadata mismatch / no record do not call, history failure stops before the move, a move throw propagates with the mirror's writes unchanged and the retry runs it again); 2 rows with the REAL `moveToFreeCohortAfterPlan` (`payment_failed` keeps today's path: no plan read, no write; `cancellation_requested` with a failed read alerts `error` + `alert: true` and throws); 1 replay row (below) |
| `lib/business-os/billing/__tests__/planRenewal.captured.test.ts` | 224-225, 310-311 | **Not in §8, forced by the new required port:** its mirror deps builder gains the stub port (without it the captured X-4 story fails `deps.afterPlanMove is not a function`), plus one assertion that the captured Stripe give-up hands the port `payment_failed` (which never moves) |
| `lib/business-os/billing/__tests__/planBillingHandler.test.ts` | 27-37, 87, 162-181 | `afterPlanMoveDeps` mocked to a sentinel, `currentStripeMode` pinned to test; the production handler hands the mirror an `afterPlanMove` that is the wiring's port (and does not call it itself); PF-15 still first (other mode reaches neither) |
| `lib/business-os/billing/__tests__/afterPlanMove.guard.test.ts` (DELETE file) | 11-12, 28-45, 94-121 | DR-8 rows: one port call in the mirror; its input names no `metadata` / metadata key / fresh read; account id is `resolveAccountId(account.accountId…)`; the call sits after `recordSubscriptionEnded` inside the branch |
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` | 89-93 | `'afterPlanMoveDeps.ts': [ACCOUNT_PLANS]` with its D3.1 comment, still the last entry (written in the DELETE scope, reviewed here) |

**Retry semantics (unchanged from §6.1 / §14 item 4 / S-7):** a read or write failure inside the move is logged `error` + `alert: true` there and THROWS through the mirror, so the route releases the claim and Stripe retries. The mirror's own result (billing row, `subscription_ended` row, ended audit) is already written before the call and a retry leaves it unchanged (pinned by test). Config faults, the S-11 skip and audit failures never throw.

**Replay (PLAN PAYMENTS P-8b reconcile, requirement added 2026-10-27):** the nightly reconcile replays missed events, `customer.subscription.deleted` included, through the same claim table and `planBillingHandler`. A second full run of the same `.deleted` after a successful move is a no-op, pinned at both levels with a stateful plan store (the write lands on the row the next read returns):

| Level | Test (file › describe › name) | Pins |
|---|---|---|
| `afterPlanMove` | `afterPlanMove.test.ts` › `idempotency (R-2, AC-D31.4)` › `replay (P-8b reconcile): the same subscription run twice against the stored row: the second run is a no-op (no move, no anchor change, no audit)` | First run: one write, `after_plan_moves` 0 → 1, last subscription id set, one `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL`. Second run: skip `already_applied` (info), no write, store deep-equal (count still 1, `period_anchor` unchanged), still one audit |
| mirror | `planSubscriptionMirror.test.ts` › `the mirror with the REAL after-plan move (ports stubbed): only an owner-started end moves` › `replay (P-8b reconcile): the same .deleted twice replayed through the mirror after a successful move: the port is called each time, reports already_applied, and nothing changes` | Three full runs of the same event (PLAN PAYMENTS ruling 9). The port is called on every run; after runs 2 and 3 each: `already_applied` logged (twice in total), one plan write total; store deep-equal (count, `period_anchor`); one free-period audit; billing row, money history and every audit unchanged; the mirror's own `subscription_ended_replayed` logged |

**T-8 verification (2026-10-27, HEAD `841163f4` + working tree):**

| Check | Result |
|---|---|
| Jest `lib/business-os/billing` | 52 suites, 3,895 tests: green |
| Jest `app/api/stripe` + `lib/stripe` | 32 suites, 685 tests: green |
| Jest `components/business-os/settings` + `app/api/business-os/billing/plan` + `app/api/business-os/entitlements` (D3 drawer / PlanManage) | 66 suites, 1,377 tests: green (`--testTimeout=30000`; at the default 5 s one `PlanPurchase.render` first test timed out under parallel load and passed alone) |
| `npm run test:bos-entitlements` | 324 suites, 9,658 tests: green |
| `npx tsc --noEmit` (8 GB heap) | Completed, no OOM / V8 trace; 1,849 pre-existing errors repo-wide, **0 in the 32 touched `.ts` / `.tsx` files** |
| `console.*` | 0 in every touched file |

## SA Review Notes

**Reviewed by SA — 2026-10-27**
**Status:** ⚠️ Approved with conditions (DR-1 to DR-12). Code may start at T-1 once T-0's coordination items are done. PLAN PAYMENTS' five conditions (their SA, checked against P-7a.4 HEAD `639a5b59`) are folded in as DR-6, DR-7, DR-8, DR-10 and U-5.

### What was verified

- **Cleanup function (the migration claim).** G-10 reads `pg_constraint` for foreign keys **to `auth.users`**. G-18 reads `pg_constraint` for foreign keys **into a table the plan removes**. Both work at the constraint level, so a column with no `REFERENCES` is invisible to them. `business_os_account_plans` is a whole-row step B delete by `user_id` in both modes (`generate-test-account-cleanup-sql.ts` line 297). It is not in `KEEP_SET` and not in the anonymise blank list, so G-11 never names its columns. The purge descriptor and the classification baseline are table-level (`never`, `exclude(BILLING)`). **"No regen, no regen lock" is correct.**
- **Replay reaches the move.** `mirrorSubscriptionState` matches on `user_id` + `livemode` + `stripe_subscription_id` and returns `mirrored: count === 1`. A replay of the same `.deleted` therefore still reports `mirrored: true`, so R-1's "call after `recordSubscriptionEnded`, also on a replay" holds.
- **Anchor.** The paid-invoice RPC sets `period_anchor = p_billing_cycle_anchor` (Stripe's anchor), so a period-end cancel's `endsAt` falls on a period boundary of the old anchor. `adminOps` PF-13 already resets the anchor to "now" when **no** plan subscription is live. The move runs after the mirror has stamped `ended_at`, so it is that same case. `creditLeakCheck` reads each charge's stored `period_start` verbatim and uses the anchor only for periods with no charge. A mid-period re-anchor (an immediate cancel) is the PF-13 shape, which is already in production.
- **`updated_at`.** It is written explicitly by every plan-row writer: the RPC (`20261028` line ~192), `adminOps` through the repository (lines 613, 677) and the M-5 upsert.

### Rulings on §13

| # | Ruling |
|---|---|
| **S-1** | **Option A approved.** Two columns, 20261098, no FK, no regen, no lock (verified above). A whole-row delete removes the count with the row, which only matters for the test-account hard delete (a re-signup is a new account anyway). Data purge Reset never touches the table (`never`), so Reset cannot launder the count. Keep the pair CHECK. |
| **S-2** | **Approved: the free period starts when paid access really ends**, `freeFrom = max(endsAt, tierSettlementEndsAt(row.tier_expires_at))`. Without it the 1-day minimum is 0 days, so the rule as written cannot meet the user's decision. U-3 tells the user about the +1 day. |
| **S-3** | **ceil approved** (14, 7, 4, 2, 1). |
| **S-4** | **Approved**, inside `afterPlanAccount`. Clear the pin only when it is earlier than the new `trial_ends_at`. `before` / `after` go in the audit `changes`. |
| **S-5** | **Approved.** `period_anchor = min(endsAt, now)`, written as the exact string. The analysis is right: it is the PF-13 "no live subscription" reset, not a new accounting rule, and it is not a credit lot. Add one `creditLeakCheck` test row: an account re-anchored mid-period by the move, with charges on both sides, reports no leak (DR-9). |
| **S-6** | **Approved** (`lib/business-os/billing/`, DELETE-owned, named in the coordination row). |
| **S-7** | **Approved, with PLAN PAYMENTS condition 1.** A stale write throws and stays `warn`. A thrown read or write error is logged `error` with `alert: true`: Stripe stops retrying after about 3 days, and the account would then fall silently to grace and then paused. |
| **S-8** | **Approved** as named: `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL`, `'bos'`, `invalidatesEntitlements: true`. |
| **S-9** | **Approved (rule 7 new pattern: a system write of plan state).** It mirrors the invite-finalise allowance. **Changed:** see DR-5 for the compare condition. |
| **S-10** | **Approved.** The reason comes from the event payload, and `StripeService.ts` is not touched. |
| **S-11** | **Replaced by PLAN PAYMENTS condition 3.** `afterPlanAccount` **never writes `tierExpiresAt`** in either direction: no extend and no shorten. If the row's `tier_expires_at` is later than `endsAt` + the settlement margin, `afterPlanAccount` returns `moved: false` with `skip: 'paid_through_after_end'`. The writer logs that skip at `error` + `alert: true` and writes nothing. The rule lives in `afterPlanAccount`, so the preview agrees (`ending` → unknown). `tier_expires_at` leaves the write allow-list. |

### Rulings that change the plan

1. **DR-1 Sequencing: one PR, close #539.** Push D3's remaining work (T-13 "now" mode after P-7a.4, and its main merges) to the D3 branch as D3 commits. D3.1 merges that branch, and **one PR from `feature/free-cohort-after-cancel-d3-1` to `main`** carries both commits. #539 is closed with "included in #NNN". Why:
   - Q-9(a) forbids D3 on `main` without the writer. "#539 then D3.1 straight after" leaves a window of at least one deploy where it is. If D3.1 is then held (the 20261098 paste, the T-8 review by PLAN PAYMENTS, or a red check), owners are promised a move nothing makes.
   - It is also the only form that is not stacked-into-branch (memory: stacked PR hazard).
   - The "every slice its own PR from main" rule yields to Q-9. D3 keeps its own reviewed commit. The PR body lists both slice ids and both SA reviews.
2. **DR-2 Where the D3-file changes go.** S-2, S-4, the S-11 replacement and the `priorMoves` input are **D3.1 commits** (T-4). The D3 branch is frozen except for T-13 and main merges. D3's tests that pin `endsAt + 14 d` move in D3.1's T-4.
3. **DR-3 Order.** P-7a.4 → **FU-P7a4-1 lands before D3.1** (PLAN PAYMENTS condition 2) → D3 T-13 → D3.1 T-1 rebases and re-reads the mirror and the handler port list → 20261098 applied on prod → the one PR merges.
4. **DR-4 The resolution order in `afterPlanAccount`** is fixed and tested:
   1. paid-through check (S-11 replacement);
   2. the Founding Partner survival check (`tierExpiresAt: endsAt`, unchanged);
   3. halving;
   4. S-2 start;
   5. S-4 pin.

   It returns `{ account, moved, days, skip? }`, with `skip` from a closed list.
5. **DR-5 Compare-and-set on `updated_at`.** `applyAfterPlanMove` conditions on `.eq('user_id')`, `.eq('updated_at', <exact read string>)` and `.eq('after_plan_moves', n)`, with `{ count: 'exact' }` and no `.or()` (PLAN PAYMENTS condition 5).
   - Why `updated_at`: every plan writer stamps it, so it also catches an admin `set_cohort` or `assign_tier` between the read and the write. `.eq('tier_expires_at')` alone would let the move overwrite those.
   - Drop the `tier_expires_at` `.eq` / `.is(null)` branch.
   - Repository test: `count === 0` → `stale`.
6. **DR-6 Audit can never trigger a retry** (PLAN PAYMENTS condition 1b). A test makes the `recordPlanChange` port reject or throw after `applied` and checks that `afterPlanMove` resolves, logs and does not throw. Wrap step 8 defensively. Do not rely only on its contract.
7. **DR-7 Late `invoice.paid` after the move** (§14 item 6) is **alert-only, owned by FU-P7a4-1**. D3.1 adds no reinstate and no undo.
8. **DR-8 Seam (question 5).** Thin enough as specified: one port and one call inside the existing `.deleted && mirrored` branch, outside `recordSubscriptionEnded`, plus one wiring line. Further conditions:
   - the account id comes only from the billing row;
   - PF-15 runs before the mirror;
   - the T-8 diff goes to PLAN PAYMENTS before merge (PLAN PAYMENTS condition 5);
   - `afterPlanMove.guard.test.ts` also pins that the mirror passes no Stripe `metadata` field into the port input.
9. **DR-9 Credit test row** (S-5) in `creditLeakCheck` tests, and one in `ownerCreditUsage` tests: a trial total summed from the moved anchor reads the full config total.
10. **DR-10 Log levels** (closed set):
    - `moved`: `info`;
    - `skip` `not_owner_end`, `already_applied`, `own_cohort_survives`: `info`;
    - `no_end_date`, `no_plan_row`, `stale`: `warn`;
    - `after_plan_misconfigured`, `paid_through_after_end`, thrown read or write: `error` + `alert: true`.
11. **DR-11 Entitlements checklist.** The `business-os-entitlements` review checklist applies:
    - two new importers in `KNOWN_NON_GATE_IMPORTERS` with exact symbols;
    - `AFTER_PLAN` in the drift snapshot **before** the first write (regenerated, never hand-edited);
    - `npm run test:bos-entitlements` is green in T-10.
12. **DR-12 Estimate (question 7).** 2.1 d accepted, plus about 0.15 d for DR-1, DR-5, DR-6, DR-9 and the S-11 skip: **about 2.25 d, inside the 2.5 d cap.** S-1 option B is not chosen, so there is no over-cap risk from it. Stop and tell TL if T-1's rebase onto FU-P7a4-1 needs more than the one handler-port line.

### For the user (TL to relay)

- **U-1** The count never resets. **U-2** An admin dashboard cancel counts as owner-started. **U-3** First cancel: `{until}` = period end + 15 days. **U-4** Paste 20261098 (pre-check, apply, checker) before the merge.
- **U-5 (decided 2026-10-27, FU-P7a4-3; ✅ answered: the user reconfirmed YES on 2026-10-27).** An owner cancel during a failed payment gets the free period. PLAN PAYMENTS asks the user to reconfirm, because the combination is: the unpaid renewal invoice is **voided** (P-7a.4 C-11), **and** the owner gets 14 free days **and** a fresh credit total. The default stands as decided unless the user reverses it. A reversal needs a second signal (status at cancel), which is a workplan change.

### Approval

[x] Workplan approved with conditions DR-1 to DR-12. Proceed to T-1 after T-0 (TL reserves 20261098, adds the SX-2b shared-items row, records the one-PR decision and the #539 closure in the coordination file).

### SA Code Review (part 1, DELETE-owned)

**Code Review by SA — 2026-10-27**
**Status:** ✅ Code Approved (DELETE scope), with one condition (comment 1) to close before the one PR opens. T-8 is not reviewed here: it gets part 2, together with PLAN PAYMENTS.

Scope: the uncommitted diff on `feature/free-cohort-after-cancel-d3-1` (base D3 `0eb3994c`), T-2 to T-7 and T-9. SA re-ran the 26 targeted suites (408 tests): green.

#### What was checked and holds

| Area | Result |
|---|---|
| Migration 20261098 | One transaction with `lock_timeout`. Pre-guard: schema CREATE, table present, columns absent. `NOT NULL DEFAULT 0` plus nullable text, so existing rows get 0 / NULL (post-condition 4 proves it). Three CHECKs (count, `sub_` shape, pair). No `REFERENCES`, no GRANT, no policy, RLS untouched. Post-condition 5 refuses any anon / authenticated SELECT or UPDATE. No SQL-editor "into" hazard |
| Rollback, pre-check, checker | The rollback locks before counting and refuses when any count is above 0 (U-1, correct). The pre-check is read-only, 5 rows. The checker covers type, default, nullability, each CHECK body, no FK on the new columns, browser roles still holding nothing, RLS on, and service_role read and write. Row 9 is information only |
| Repository (DR-5, S-9) | `.eq('user_id')`, `.eq('updated_at', <verbatim read string>)`, `.eq('after_plan_moves', n)`, `update(payload, { count: 'exact' })`, no `.select()`, no `.or()`. `count === 0` → `stale`; `count !== 1` → error. Named fields only; `tier_expires_at` is not in the allow-list; `updated_by_admin_id: null`. UUID, `sub_` and count validated before any query. `PLAN_COLUMNS` and the hot read unchanged. An unreadable count is an error, never 0 |
| `afterPlanAccount` (DR-4) | Order: paid-through → survival (`tierExpiresAt: endsAt`) → halving → S-2 → S-4. `max(minimumDays, ceil(base / divisor^n))` with `base` from `historyAt` (14/7/4/2/1/1 pinned). S-2: `freeFrom = max(endsAt, settlement(row.tierExpiresAt))`. `tierExpiresAt` is never written; a later paid-through date or an open-ended tier → `paid_through_after_end`. Founding Partner → `own_cohort_survives`, count unchanged. Input not mutated |
| Writer (`afterPlanMove.ts`) | DR-10 levels match exactly: a thrown read or write is `error` + `alert: true`; stale is `warn` + throw; `paid_through_after_end` and misconfigured are `error` + alert, no throw. Account id only from the input, plus a defensive `user_id` mismatch refusal. Idempotent on `after_plan_last_subscription_id`. `period_anchor = min(endedAt, now)`. DR-6: the audit call is wrapped, and the test covers both a rejecting and a synchronously throwing port. Log fields are a closed, PII-free set, tested on every path |
| Audit | `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL`, `'bos'`, `info`, SOC2, system actor `stripe_webhook`, `invalidatesEntitlements: true`. No email, name or leave reason |
| Drift snapshot (DR-11) | `afterPlan` is in `EntitlementSnapshot`. `findDrift` reports `after_plan_changed` for the cohort, the divisor, the minimum or a dropped entry. The shipped-config test also asserts the committed JSON holds `afterPlan`, so deleting it from the JSON cannot silence the check. The JSON is regenerated by the script |
| Entitlements checklist | Two `KNOWN_NON_GATE_IMPORTERS` entries with exact symbols; nothing added to `ENFORCEMENT_POINTS`. `applyAfterPlanMove` is in `WRITE_METHODS`. The wiring may call exactly `findAfterPlanMoveInputs` and `applyAfterPlanMove`, and it is the only caller (pinned twice) |
| DR-9 | The `creditLeakCheck` row (mid-period re-anchor, charges on both sides, no leak) and the `ownerCreditUsage` row (trial total from the moved anchor) are present |
| Logging | No `console.*` in any touched or new file |

#### Code Review Comments

1. ✅ **Resolved by Dev 2026-10-27:** when `moved`, `after` is resolved at `afterAccount.trialStartedAt + 1 ms` (else the later settlement end as before); `previewAfterPlan.test.ts` row: lapsed tier, `moves: 4`, ended now → `days: 1`, `free_plan`, `until = endsAt + 1 d`. `lib/business-os/entitlements/EntitlementService.ts` `previewAfterPlan` (deviation 4) — **Priority: Medium, a condition before the PR opens.** The preview resolves `after` at `max(settle(endsAt), settle(row paid-through)) + 1 ms`. The writer's free period starts at `max(endsAt, settle(row paid-through))`. The two agree for a period-end cancel. For a lapsed (`past_due`) tier ended "now" (D3 T-13, U-5), they differ by one settlement margin: the preview samples one day after the free period starts. With `days = 1` (the fifth and later cancels), the trial is already over at that instant, so the drawer shows "could not work out" while the writer grants 1 day (AC-D31.5). Fix: when `moved`, resolve `after` at `Date.parse(afterAccount.trialStartedAt) + 1`; otherwise keep the current value. Add one `previewAfterPlan` row: a lapsed tier, `moves: 4`, ended now → `free_plan` with `until = endsAt + 1 d`. Fold it in with T-13 if that lands first, but before the one PR.
2. `lib/business-os/billing/afterPlanMove.ts`, the step 8 catch — Priority: Low. The audit-failure log is `error` without `alert`. That is acceptable, because `recordPlanChange` failures are non-blocking elsewhere too. Noted only so that nobody adds a throw there later.
3. `lib/repositories/BusinessOsAccountPlanRepository.ts` `applyAfterPlanMove` — Priority: Low. The repository does not check `trialStartedAt`, `trialEndsAt` or `periodAnchor` as ISO instants. The caller builds them with `toISOString()`, and the column type would refuse junk. No action needed; add an optional `Number.isFinite(Date.parse(...))` guard if the method is touched again.

#### Rulings on Dev's deviations

| # | Ruling |
|---|---|
| 1. Port named `afterPlanMove` (in `afterPlanMoveDeps.ts`, type `AfterPlanMovePort`) | **Approved.** It avoids a name clash with the repository write. T-8's line uses this name |
| 2. Repository returns `applied` / `stale` without the row | **Approved.** It is what DR-5 asks for (`{ count: 'exact' }`, no `.select()`). The audit `after` comes from the rule's result plus the written count |
| 3. Optional `findAfterPlanMoveState` on the service's repository option | **Approved.** The production default is the real repository, which has the method. A missing method fails closed to `null` with a warn, never to a first-time period |
| 4. Preview reads past the later of the two settlement ends | **Approved with comment 1** (sample at the rule's own `trialStartedAt` when moved) |
| 5. `unknown` whenever not moved, unless `own_cohort_survives` | **Approved.** It follows the S-11 replacement: the writer will not move in those cases, so the drawer must not describe a move |

#### Rulings on files outside §8

| File | Ruling |
|---|---|
| `lib/audit/filterOptions.ts` (`BOS_PLAN_` → "Business OS Billing") | **Approved.** Registration only; no existing `BOS_PLAN_` key is regrouped |
| `lib/audit/__tests__/eventAudience.test.ts` (62 → 63 BOS, 223 → 224) | **Approved.** The exhaustive-audience pin requires it |
| `lib/repositories/index.ts` (four type re-exports) | **Approved.** Types only, no runtime surface |
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` (one entry: `afterPlanMoveDeps.ts` → `ACCOUNT_PLANS`) | **Approved as a registration.** It is a PLAN PAYMENTS file, so list it in the part-2 diff that PLAN PAYMENTS reviews with T-8 (DR-8), and add it to §8 |

#### Optimisation Suggestions

- `AfterPlanMoveWrite` / `AfterPlanMoveWriteResult` in `afterPlanMove.ts` duplicate the repository's `ApplyAfterPlanMoveInput` / `ApplyAfterPlanMoveResult` structurally. They are kept apart so the use case names no repository, which is fine: `tsc` already checks them against each other through `writeMove: (input) => repo.applyAfterPlanMove(input)`.

### Code Approved for QA: Yes (DELETE scope), on condition that comment 1 is fixed before the one PR opens. T-8 and its PLAN PAYMENTS review are part 2.

## SA Code Review — part 2

**Code Review by SA — 2026-10-27**
**Status:** ✅ Code Approved (T-1 re-application + T-8 webhook seam). No blocking items. Comments 1 to 3 are Low. Two process gates remain before the one PR merges (comment 4).

Scope: HEAD `841163f4` (merge of D3 `9e2b3f6a` and origin/main `b088b51d`) plus the uncommitted working tree. Diff read in full: `t8-final.diff` (mirror, handler, their tests, `planRenewal.captured.test.ts`, `routerPlacement.guard.test.ts`), plus the DR-8 rows in `afterPlanMove.guard.test.ts` and the P-8b replay rows in `afterPlanMove.test.ts` / `planSubscriptionMirror.test.ts`. SA re-ran 14 suites (mirror, handler, captured renewal, `afterPlanMove` + guard, router placement, `previewAfterPlan`, `planEndingView`, `afterPlan`, tier-matrix snapshot, the three `PlanCancelDrawer` suites, the entitlements imports guard): **302 tests green**. `enforcementPoints.test.ts`: 146 green.

#### (a) T-1: part 1 re-applied after the merges

| Check | Result |
|---|---|
| `EntitlementService.previewAfterPlan` | Unchanged from part 1, including the comment-1 fix (`freeFromMs` from the rule's own `trialStartedAt` when moved). Optional `findAfterPlanMoveState`, fail-closed to `null` |
| `planEndingView` | Part 1's explicit `unknown` for any skip other than `own_cohort_survives` is present |
| Drift snapshot | `afterPlan` present; tier-matrix snapshot suite green, so the regenerated JSON matches the config |
| D3 drawer "now" mode (T-13) and P-7a.4's unpaid-invoice line | The D3.1 tree does not touch `components/business-os/settings/`. Both come from `28cbec61` / `9e2b3f6a` in HEAD. The `PlanCancelDrawer` render, QA-render and guard suites are green |
| FU-P7a4-1 before D3.1 (DR-3) | Holds: `BUSINESS_OS_CANCELLATION_REASONS` is FU-P7a4-1's export on main, and the mirror now uses it |

#### (b) T-8: the webhook seam against DR-6, DR-7, DR-8, DR-10 and PLAN PAYMENTS' five conditions

| Condition | Verdict | Evidence |
|---|---|---|
| **One port, one call** (DR-8) | ✅ | `PlanSubscriptionMirrorDeps.afterPlanMove: AfterPlanMovePort` (a type-only import, so the mirror pulls in no use-case runtime). Exactly one `deps.afterPlanMove(` in the mirror, pinned by the guard (`portCalls` with balanced parentheses, comments stripped) |
| **Outside `recordSubscriptionEnded`, also on a replay** | ✅ | The call follows `await recordSubscriptionEnded(...)` inside `if (.deleted && mirrored.data.mirrored)`. `recordSubscriptionEnded` is unchanged apart from the reason-list swap. Guard pins the position and that the branch does not close between the two. The mirror test "a replayed .deleted ... still calls it" shows `subscription_ended_replayed` logged once, history 1, audits 1, port called twice |
| **No metadata reaches the port** (DR-8) | ✅ | The input is built from `account.accountId`, `subscriptionId`, `event.livemode`, `event.id`, `endedAtIso` (Stripe's `ended_at`, not metadata) and `embedded.cancellation_details.reason` (S-10). Guard: no `metadata`, no `BOS_USER_ID_METADATA_KEY`, no `claim` / `fresh` in the call text. The metadata-mismatch and no-billing-record paths return before the branch (test: port not called) |
| **Canonical account id** | ✅ | `resolveAccountId(account.accountId as string)`, the same seam `recordSubscriptionEnded` uses, pinned by regex in the guard. The test asserts the exact payload with `ACCOUNT`. The billing row is found by subscription id + livemode (SR-8), so `event.livemode` equals the row's mode |
| **Only `cancellation_requested` moves** | ✅ | The mirror passes the reason verbatim (four reasons pinned, including `null` and an unknown value). The use case decides. The REAL-move row with `payment_failed` shows no plan read, no write and an `info` `not_owner_end` skip. The captured X-4 give-up hands the port `payment_failed`. The ended audit keeps its own filtered reason, which is unchanged |
| **Idempotent on a replay (P-8b reconcile)** | ✅ | Pinned at two levels with a stateful store whose write lands on the next read. The second full mirror run calls the port, logs one `already_applied` (`info`), makes no second write, leaves the store deep-equal (count 1, `period_anchor` unchanged, so no second credit total) and adds no second `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL`. The billing row, money history and audits are unchanged. The key is `after_plan_last_subscription_id`, with the DR-5 CAS behind it for concurrent deliveries |
| **`.updated`, `mirrored: false`, mismatch, no record** | ✅ | None calls the port (four rows). A history-write failure throws before the move is reached |
| **PF-15 first** (DR-8) | ✅ | Handler test: an event from the other mode reaches neither the mirror nor the move, and `bos_billing_mode_mismatch` is `error` + `alert` |
| **Handler: one line** | ✅ | One import and one production-port line `afterPlanMove,`. The switch, PF-15 and the other ports are untouched. The test proves the handler hands the wiring's port to the mirror and does not call it itself |
| **DR-6: an audit failure never retries** | ✅ (part 1) | The step 8 wrap is unchanged. T-8 adds nothing between the move and the mirror's return |
| **DR-7: late `invoice.paid` is alert-only** | ✅ | No reinstate or undo anywhere in the diff. `planPaymentApply.ts` is untouched |
| **DR-10 levels** | ✅ | The mirror adds no log line of its own. The REAL-move row pins `bos_plan_after_plan_read_failed` as `error` + `alert: true` through the mirror. The other levels were pinned in part 1 |
| **PLAN PAYMENTS condition 5** (CAS without `.or()`, diff reviewed before merge) | ✅ code / ⬜ process | CAS verified in part 1. Sign-off on this diff: see comment 4 |
| **Router-placement registration** | ✅ | One entry, last in the map, existing order kept, with a D3.1 comment. `afterPlanMoveDeps.ts` → `ACCOUNT_PLANS` only |
| **`planRenewal.captured.test.ts`** (outside §8) | ✅ approved | Forced by the new required port. A stub plus one assertion; no behaviour change. See comment 1 |
| **Entitlements skill** | ✅ | T-8 adds no new import from `lib/business-os/entitlements/` to production code: the mirror's symbols stay `RecordPlanChangeInput` and `resolveAccountId`, already registered, and the handler imports only from billing. The new entitlements imports in `planSubscriptionMirror.test.ts` are under `__tests__/`, which the registry excludes. `enforcementPoints` and `test:bos-entitlements` are green |
| **`console.*`** | ✅ | 0 in every modified and new `.ts` / `.tsx` file (grep over `git diff --name-only HEAD` plus the untracked files) |
| **CLAUDE.md rules** | ✅ | Rule 1: no DB access added to the mirror or handler; the repository is reached only through `afterPlanMoveDeps.ts`, which is `server-only`. Rules 3 and 6: no `any`. Rule 4 / tenant isolation: the account id comes from our row only. Rule 7: the seam is the pattern SA approved in DR-8 |

#### Ruling: throw → claim released → Stripe retries

**It stands.** Reasons:

1. Everything the retry re-runs is idempotent: the mirror (an absolute state write), `recordSubscriptionEnded` (a duplicate returns early), and the move (`already_applied`, or the CAS refuses). The test "the move throwing ... the retry runs the move again" shows the first attempt's billing row, history and audit are byte-equal after the retry.
2. Only transient faults throw: a read or write error, which alerts, and a stale write, `warn` then throw, which re-reads on retry. Config faults, `paid_through_after_end`, `no_end_date`, `no_plan_row` and audit failures do not throw, so nothing deterministic can loop the claim.
3. Swallowing instead would leave a failed move unrecoverable: an owner promised a free period would fall to grace and then paused, unseen. With a throw, Stripe retries for about 3 days. P-8b's nightly reconcile replays the `.deleted` through the same claim table after that, and the port is reached on a replay by design.
4. The claim is per event, so a stuck move never blocks other events for the account.

Condition: the alert on a thrown read or write (S-7 / PLAN PAYMENTS condition 1) is the safeguard and must not be downgraded.

#### Code Review Comments

1. Workplan §8 — `lib/business-os/billing/__tests__/planRenewal.captured.test.ts` is missing. Add a row: owner PLAN PAYMENTS, "deps builder gains the stub port (forced by the required port) and one `payment_failed` assertion". — Priority: Low. ✅ **Resolved by Dev 2026-10-27:** §8 row added (owner PLAN PAYMENTS, accepted by PLAN PAYMENTS SA)
2. `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts`, the `planSubscriptionMirror.ts` entry's `why` — Priority: Low, optional. ✅ **Resolved by Dev 2026-10-27:** one clause appended ("on an owner-ended `.deleted` it hands off to the after-plan port (`afterPlanMove.ts`, registered separately, D3.1 / SX-2b)"); symbols unchanged. It still says "It writes no plan row, invalidates nothing". That stays literally true of the file, because the plan write and the invalidation happen behind the port. A reader auditing the registry would still benefit from one clause: "on an owner-ended `.deleted` it hands off to the after-plan port (`afterPlanMove.ts`, registered separately)". The symbols are unchanged, so the gate does not need it. It is a shared file: touch it only if the diff is reopened anyway.
3. `lib/business-os/billing/planSubscriptionMirror.ts`, the `account.accountId as string` in the port call — Priority: Low, no action. The earlier `account.accountId === null` return already narrows the value, so the cast is redundant. It matches `recordSubscriptionEnded`'s existing line, and the guard regex tolerates it. Leave it as is for consistency. **Superseded by PLAN PAYMENTS review item 8 (2026-10-27):** the redundant `as string` was dropped in the port call only (`recordSubscriptionEnded`'s line untouched); tsc stays clean on the touched files.
4. **Process gates before the one PR merges** (not code defects):
   - (a) PLAN PAYMENTS records sign-off on this T-8 diff in the coordination log (DR-8 / condition 5). SA's part 2 covers the technical check, but the owner's acknowledgement is theirs to record. ✅ **PLAN PAYMENTS SA signed off on T-8, 2026-10-27: OK.** Their changes 7 (mirror replay test runs the event a third time, ruling 9) and 8 (drop the redundant cast) applied. Swallow-and-alert rejected; throw-means-retry kept
   - (b) U-4: paste 20261098 on prod (pre-check, apply, checker) before the merge.
   - (c) U-5 reconfirmation is still with the user. ✅ **Answered:** the user reconfirmed YES on 2026-10-27.

#### Optimisation Suggestions

- `StripeService.ts` already has a private `cancellationReasonOf()` that does exactly the mirror's filter. Exporting it would remove the duplicated expression in `recordSubscriptionEnded`. It is not worth editing `StripeService.ts` (listed as not touched) for this slice.

### Code Approved for QA: Yes. Part 1 and part 2 are both approved. QA may start, including T-11 (sandbox). The merge waits on comment 4 (a) to (c).

## QA Testing Report

**QA — 2026-10-27**
**Verdict:** ⚠️ **PASS WITH NOTES.** The code (D3 + D3.1, HEAD `841163f4` + working tree) passes. One Medium bug sits in the prod-gate **checker script**, not in runtime code: it must be fixed before the user pastes 20261098 (B-1). T-11 cannot run until 97 is applied; its checklist is below.
**Test mode:** full (D3.1); regression only for D3 (what the merge could have broken)
**Strategy used:** A + B (Jest with injected ports, fake repositories and the production config), a static migration review, read-only prod reads, and a written T-11 sandbox checklist (D). Option D for the drawer is covered by render tests; the items that only a human click proves are listed below.
**Focus:** api, pipeline (webhook), schema, security, ui (drawer regression)
**Skipped:** T-11 live sandbox (needs 20261098 on prod, not applied yet). Supabase MCP `execute_sql` was **not available** in this QA session, so the prod reads went through PostgREST with the service role, as GET/HEAD only. `supabase_migrations.schema_migrations` is not exposed there; see "Prod read-only results".
**Input source:** prompt keywords (TL brief)

### Test runs

Each run separate, `--ci --testTimeout=60000`, sequential. There were **no timeouts and no failures**, so no re-runs were needed.

| Run | Suites | Tests | Result |
|---|---|---|---|
| `lib/business-os/billing` | 52 (+1 QA, below) | 3,895 (+14 QA) | ✅ |
| `lib/business-os/entitlements` | 52 | 1,475 | ✅ |
| `app/api/stripe` + `lib/stripe` | 32 | 685 | ✅ |
| `lib/repositories` | 125 | 2,970 | ✅ |
| `lib/audit` | 16 | 189 | ✅ |
| `lib/business-os/credits` | 33 | 1,018 | ✅ |
| `supabase/migrations/__tests__` | 55 | 2,758 | ✅ |
| `components/business-os/settings` | 57 | 1,049 | ✅ |
| `app/api/business-os/billing` + `app/api/business-os/entitlements` | 9 | 328 | ✅ |
| `npm run test:bos-entitlements` | 324 | 9,658 | ✅ |
| Guards re-run with the QA test present (`afterPlanMove*`, the entitlements imports guard, `enforcementPoints`, router placement) | 6 | 274 | ✅ |
| `npx tsc --noEmit` (8 GB heap) | — | — | Completed, with no OOM or V8 trace. 1,849 errors repo-wide, all already there; **0 in the 33 touched or new `.ts` / `.tsx` files**. The QA test file was also checked on its own: 0 errors |
| `npm run lint:hooks` | — | — | ✅ exit 0, 0 warnings |
| `console.*` in touched or new files | — | — | 0 |

**Test added by QA (report only, not production code):** `lib/business-os/billing/__tests__/afterPlanMove.previewParity.qa.test.ts`, 14 tests. AC-D31.5 had been pinned only on each side separately, so this test runs the REAL drawer path (`readPlanEndingView` → `EntitlementService.previewAfterPlan`) and the REAL writer (`moveToFreeCohortAfterPlan`) on the same row and count. It asserts `view.until === write.trialEndsAt` for counts 0 to 6 in both modes:
- **period_end:** settlement end + 14/7/4/2/1/1/1 days, which gives period end + 15 days on a first cancel (U-3).
- **now:** a lapsed `past_due` tier ended now, now + 14/7/4/2/1/1/1 days. The 5th and later cancels show 1 day and never "could not work out".

### Test Coverage (D3.1)

| Acceptance criterion / brief item | Tested? | Result | Evidence |
|---|---|---|---|
| AC-D31.1: an owner cancel (`cancellation_requested`) moves to `AFTER_PLAN.cohort`, with 14 days and a fresh total (period-end **and** immediate) | ✅ | Pass | `afterPlanMove.test.ts` › "a first period-end cancel…" (cohort, 14 d from the settlement end, anchor at the end, count + 1) and "U-5: a cancel of a lapsed (past_due) tier starts the free period at the end itself". Fresh credits: the anchor moves to `min(endedAt, now)` (S-5). DR-9 rows in `creditLeakCheck.test.ts` / `ownerCreditUsage.test.ts`. The drawer's `credits` is the config total, 1,000 (`TRIAL_CREDIT_TOTAL`), and does not halve (`planEndingView.test.ts`). One audit entry |
| AC-D31.2: `payment_failed` / `payment_disputed` / null keep today's path | ✅ | Pass | `afterPlanMove.test.ts` `it.each` (no read, no write, no audit). The mirror's REAL-move row with `payment_failed` (no plan read). The captured X-4 give-up hands the port `payment_failed` (`planRenewal.captured.test.ts`) |
| Repeat cancels halve: 14/7/4/2/1, never below 1, the count never resets | ✅ | Pass | `afterPlan.test.ts` (0..6 → 14,7,4,2,1,1,1; fixture base 10/min 2; bad count → 0). Writer rows 0/1/4. View rows 1,2,3,4,9. The QA parity test covers 0..6. Never resets: the only write of `after_plan_moves` in `lib`/`app`/`supabase`/`scripts` is `applyAfterPlanMove` (+1); Data purge Reset never touches the table (SA S-1); the rollback refuses while any count is above 0 |
| U-3: the first free period ends at period end + 15 days | ✅ | Pass | `planEndingView.test.ts` "U-3…", `previewAfterPlan.test.ts` "a first cancel…", the QA parity test |
| U-2: a Stripe-dashboard cancel counts as an owner cancel | ✅ | Pass (by reason) | Stripe sends the same `cancellation_requested` (sandbox-observed in the coordination log, 2026-10-27). The module decides on the reason alone. See note E-1 for an immediate dashboard cancel of a plan that is still paid |
| AC-D31.4: a replay or retry is a no-op (P-8b: three runs) | ✅ | Pass | `afterPlanMove.test.ts` › replay (stateful store, second run `already_applied`, store deep-equal, one audit). `planSubscriptionMirror.test.ts` › the REAL move, the same `.deleted` run three times: one write, two `already_applied`, store and money history unchanged. Two parallel deliveries: the CAS lets one through and the other is stale and throws |
| Throw-means-retry only on a read or write fault | ✅ | Pass | Throws: read error, write error, stale (warn), a row read for another account. No throw: `not_owner_end`, `no_end_date`, `no_plan_row`, `already_applied`, `own_cohort_survives`, `paid_through_after_end`, `after_plan_misconfigured`, audit failure (rejecting and synchronously throwing ports, DR-6). Levels match DR-10 (`afterPlanMove.ts` lines 150-236, tests "failures throw…" and "nothing moves…") |
| S-11 skip with an alert | ✅ | Pass | `afterPlanMove.test.ts` "S-11 replacement: paid through after the end → error + alert, no write, no throw". `afterPlan.test.ts` (later paid-through, open-ended tier, `tierExpiresAt` never written). The preview and view read `unknown` |
| AC-D31.3: a Founding Partner is not moved and the count is unchanged | ✅ | Pass | `afterPlan.test.ts` (dated and open-ended, every `priorMoves`), writer row (info, no write) |
| AC-D31.5: the drawer preview matches the writer, including 1 day on the 5th+ cancel | ✅ | Pass | The QA parity test (14 rows, both modes), `previewAfterPlan.test.ts` "SA code review comment 1…" |
| AC-D31.6: `AFTER_PLAN` in the drift snapshot; `test:bos-entitlements` green | ✅ | Pass | 324 suites green; the tier-matrix snapshot suite asserts `afterPlan` is in the JSON |
| AC-D31.7: the webhook diff is one port, one call, one wiring line | ✅ | Pass | Diff read: mirror +1 port, +1 call after `recordSubscriptionEnded` inside `.deleted && mirrored`, the reason list swapped to `BUSINESS_OS_CANCELLATION_REASONS`; handler +1 import, +1 line. The guard pins the position and that no metadata reaches the port |
| AC-D31.8: 20261098 applied before deploy, checker green; no `console.*`; ids-only logs | ⚠️ | Partial | Not applied yet (verified on prod, below). **Checker row 4 will falsely FAIL (B-1).** 0 `console.*`; the closed log-field set is tested on every path |
| D3 regression after the merges | ✅ | Pass | Settings (57 suites), billing and entitlements API (9), stripe (32): all green. The `PlanCancelDrawer` render, QA-render and guard suites, the `PlanManage` P-7a.1/.3/.4 suites and the copy tests are green |

### Migration review (static)

| Check | Result |
|---|---|
| `20261098_…after_plan_moves.sql` | One `BEGIN`/`COMMIT` with `lock_timeout 5s`. Pre-guard: schema CREATE, table present, columns absent. Two `ADD COLUMN`s (`integer NOT NULL DEFAULT 0`, `text NULL`). Three CHECKs (≥ 0, `sub_` shape ≤ 255, pair). Post-conditions 1-5. `NOTIFY pgrst`. **No `REFERENCES`, no GRANT, no policy, no index.** The word "into" does not appear anywhere (SQL-editor hazard) ✅ |
| Idempotent / safe re-run | A second paste stops at the pre-guard ("a column … already exists") and applies nothing. This is a guarded one-shot, not `IF NOT EXISTS`, and it is safe to re-run ✅ |
| No regen needed | The plan table is a whole-row delete in the cleanup generator, and G-10/G-18 are FK-level (SA verified). No FK here, so no regen and no lock ✅ |
| Rollback | It locks before counting and refuses while any `after_plan_moves > 0`. Then it drops the 3 constraints and the 2 columns, in one transaction ✅ (see E-3) |
| `precheck-after-plan-moves.sql` | Read-only, 5 rows: table, columns absent, no `…after_plan%` constraint, browser roles hold nothing, no public CREATE ✅ |
| `check-after-plan-moves-migration.sql` | Read-only, rows 1-8 gate and row 9 is information. **Row 4 is wrong: B-1** ❌ |
| Migration test | Green (55 suites). It pins the number's uniqueness, the transaction, the checks, no FK/GRANT/policy, the "into" hazard, the rollback guard and the checker naming all three constraints. It cannot catch B-1, because that is a deparse question |

### Prod read-only results (project `jgccgkyhpwirgknnceoh`, 2026-10-27)

All reads were GET/HEAD through PostgREST with the service role key from `.env.local`; the URL ref was confirmed as `jgccgkyhpwirgknnceoh`. Nothing was written.

| Check | Result |
|---|---|
| `public.business_os_account_plans` exists | ✅ 200, **11 rows** |
| `after_plan_moves` absent | ✅ `42703 column business_os_account_plans.after_plan_moves does not exist` |
| `after_plan_last_subscription_id` absent | ✅ `42703 … does not exist` |
| `updated_at` never NULL (the CAS needs it) | ✅ 0 rows with NULL. Format `2026-09-23T19:55:01.28632+00:00`, which is the verbatim string the CAS compares |
| anon reads the plan table | ✅ refused, `42501 permission denied` (consistent with pre-check row 4 and post-condition 5) |
| No `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL` audit rows yet | ✅ 0 |
| T-11 read-back columns exist (`audit_trail`, `business_os_billing_events`, `processed_webhook_events`) | ✅ |
| Number 20261098 not taken | ✅ in git: no other `20261098*` file in the worktree, `origin/main` (highest 20261096) or any of 428 remote branches. The coordination log reserves 20261098 for D3.1 (2026-10-27). ⚠️ `supabase_migrations.schema_migrations` **could not be read** (PGRST106, the schema is not exposed, and the MCP tool was unavailable). The user, or a session with the MCP, should run `select version, name from supabase_migrations.schema_migrations where version >= '20261096' order by version;` (expect only `20261096`; manual pastes may not register there at all) |

### Issues Found

#### Bugs (must fix before the U-4 paste)

1. **B-1: checker row 4 will report FAIL on a correct apply.** File: `scripts/check-after-plan-moves-migration.sql` line 32. Severity: **Medium** (fails safe, no data harm, but the script tells the user to "roll 20261098 back in the same sitting" and blocks U-4).
   - The match is `pg_get_constraintdef(con.oid) LIKE '%left(after_plan_last_subscription_id, 4)%'`. `left` is a `type_func_name` keyword, so PostgreSQL's deparser **quotes it**: the definition reads `CHECK (((after_plan_last_subscription_id IS NULL) OR (("left"(after_plan_last_subscription_id, 4) = ('sub'::text || chr(95))) AND (char_length(after_plan_last_subscription_id) <= 255))))`. The substring `left(after…` is then not present (`left"(after…`).
   - Expected: row 4 ok. Actual (predicted from the deparser rules; QA could not run SQL here): FAIL.
   - Fix: copy the earlier checkers (`check-bos-billing-events-migration.sql` lines 135-138), e.g. `position('after_plan_last_subscription_id' IN def) > 0 AND position('<= 255' IN def) > 0 AND position('sub' IN def) > 0`, or match `'%left"(after_plan_last_subscription_id, 4)%'`. If unsure, the user can run `select pg_get_constraintdef(oid) from pg_constraint where conname = 'business_os_billing_accounts_subscription_id_shape';` on prod first: the 20261025 constraint uses the same `left(...)` and shows the real rendering.

#### Performance Issues

None. The hot read (`PLAN_COLUMNS`, `findEntitlementInputs`) is unchanged. The preview adds one small uncached read, only when the drawer can open.

#### Edge Cases / notes (no fix required for this PR)

1. **E-1:** an **immediate** Stripe-dashboard cancel of a plan that is still paid (not failing) gets `paid_through_after_end` (error + alert) and no move. That is by design (S-11 replacement). So U-2 holds for period-end and failing-card dashboard cancels; an immediate cancel of a paid plan needs an operator. Worth one line to the user with U-2.
2. **E-2:** a P-7a.4 "Ends now" within the first day after the period end (renewal failed < 24 h ago) starts the free period at `tier_expires_at + 1 day`, not at `ended_at` (S-2, correct). T-11 step 4 expects exactly that.
3. **E-3:** after T-11, the sandbox accounts hold `after_plan_moves > 0` on the prod table, so the rollback will refuse until those rows are reset. This is acceptable, but TL should know before relying on the rollback.
4. **E-4:** the coordination file's table row "Migration numbers … Next free: **20261098**" (line 55) was not bumped; only the log line reserves 97. This is a documentation fix for TL.
5. **E-5:** a replay of a `.deleted` whose claim is `completed` stops at the route (`duplicate: true`) and never reaches the mirror. The mirror-level no-op (`already_applied`) is reached only by P-8b's reconcile or a `failed` claim. Both are pinned in Jest; T-11 step 2 checks the route level, and optionally the deeper level.

### UI critical path (D3 drawer): what the render tests cover

| Item | Covered by |
|---|---|
| period_end mode: review and confirm with the date | `PlanCancelDrawer.render.test.tsx` step 3/4 rows, "a late-UTC period end is the next day in Jerusalem" |
| now mode ("ends today", extra fields posted) | `PlanCancelDrawer.render.test.tsx` › "mode: the P-7a.4 seam" and `PlanManage.p7a4*.test.tsx` |
| Reason step (7 codes, radios, Next disabled until picked) | `PlanCancelDrawer.render.test.tsx` step 1 |
| "What changes" free-plan line with credits and the date | "free_plan: the move with both dates…" (`…with 1,000 credits, until December 10, 2099.`), he/es number format, a null credit total, nothing lost, back_to_plan, unknown |
| "Keep my plan" | `PlanManage.render.test.tsx` "Keep my plan (reactivate) posts {}…"; `planCancelCopy.test.ts` label |
| en/he/es keys | `planCancelCopy.test.ts` (same keys and placeholders in all three, he/es not English, one contiguous block, the `{credits}` line), "he: … dir=rtl, every line translated" |

**Only a human click proves:**
- (a) the drawer's `{until}` on a REAL account equals the stored `trial_ends_at` (T-11 steps 1 and 4);
- (b) the date shows on the owner's clock in the real browser locale;
- (c) the he RTL layout and 320 px wrapping look right visually (jsdom checks classes, not pixels);
- (d) focus and Escape in a real browser with a screen reader;
- (e) after the move, Settings → Plan and the usage card show the trial with a fresh 1,000 credits.

### T-11: post-paste checklist (run after 20261098 is applied and the checker is green)

**Setup** (as P-7a §10 "Before the demo"):
- Use the **standard sandbox `acct_1UPKR4C7KDUGYIcA`**: its webhook does not forward to production. Do **not** use a sandbox whose events also reach the production endpoint. Production runs without D3.1, and the event claim is shared in one DB, so production could claim the `.deleted` first and the move would never run.
- Run local `npm run dev` from `neuronforge-d31`, with the sandbox keys in `.env.local` and both plan switches on.
- Run `stripe listen --forward-to localhost:3000/api/stripe/webhook --all-snapshot` and put its `whsec_` in `.env.local`.
- Warm the route: `curl -X POST http://localhost:3000/api/stripe/webhook`, expect 400.
- Use two designated **test** owners, **A** and **B**. On `/test-business-os`, put each test-mode customer on a fresh test clock. Note their UUIDs.
- Baseline: run Q1. Expect `after_plan_moves = 0` and `last = NULL`.

| # | Do | Expect |
|---|---|---|
| 1 | **A, period-end cancel.** Buy Essentials (`4242…`). Settings → Plan → Cancel → pick a reason → step 2: note `{until}`. Confirm. Advance A's clock past the period end + 1 h | Drawer: "…moves to the free plan, Test Flight, with 1,000 credits, until **period end + 15 d**". Logs: `bos_billing_subscription_ended`, then `bos_plan_after_plan_moved` `{days:14, priorMoves:0}`, once. Q1: `cohort = 'trial'`, `after_plan_moves = 1`, `last = A's sub id`, `free_len = 14 days`, `tier_expires_at` unchanged, `updated_by_admin_id` NULL. Q2: `start_ok = true` (`trial_started_at = ended_at + 1 d`), `trial_ends_at` date = the drawer's `{until}`. Q3: 1 row, `days 14`, `prior 0`, reason `cancellation_requested`. Q4: 1 `subscription_ended`, claim `completed`. Usage card: Test Flight with 1,000 credits available |
| 2 | **Replay.** `stripe events resend <A's .deleted evt id>` (from the listen output or Q4) | Route answers `duplicate: true`. Q1 byte-identical (same `updated_at`). Q3 still 1 row. *Optional, deeper, a prod write the user runs:* `update processed_webhook_events set status = 'failed' where event_id = '<evt>';` then resend → logs `subscription_ended_replayed` + `bos_plan_after_plan_skipped skip=already_applied`, Q1 unchanged, Q3 still 1 |
| 3 | **A, second cancel.** Buy again on A. Open Cancel → step 2. Confirm. Advance the clock past the new period end + 1 h | Drawer: `{until}` = new period end + 1 d + **7 d**. Log `days:7, priorMoves:1`. Q1: `after_plan_moves = 2`, `last = the new sub id`, `free_len = 7 days`. Q3: 2 rows (`days 14`, `days 7`). (If the re-buy is refused while A's first free period is live, advance the clock past A's `trial_ends_at` first and record it) |
| 4 | **B, P-7a.4 immediate cancel.** Buy. Portal → card `4000 0000 0000 0341`. Advance the clock past the period end + 1 h (renewal fails, `past_due`). Settings → Plan → Cancel ("ends today") → step 2: note `{until}` → confirm | `.deleted` arrives with no clock advance, reason `cancellation_requested`. Log `days:14, priorMoves:0`, once. Q2: `start_ok = true`; here `trial_started_at = tier_expires_at + 1 d` (the renewal failed < 24 h ago, E-2). `free_len = 14 days`, `tier_expires_at` unchanged, `trial_ends_at` date = the drawer's `{until}`. The open renewal invoice is voided (P-7a.4 C-11). Q3: 1 row for B |
| 5 | **B replay.** Resend B's `.deleted` | `duplicate: true`. Q1 and Q3 unchanged |
| 6 | *(optional)* **payment_failed path.** A third test owner C: failing card, let Smart Retries end the subscription | Log `not_owner_end`, `cancellationReason: payment_failed`. Q1: count 0, cohort unchanged. No Q3 row |

Read-back SQL (read-only; replace the UUIDs):

```sql
-- Q1 plan rows
select user_id, tier, tier_expires_at, cohort, trial_started_at, trial_ends_at,
       trial_ends_at - trial_started_at as free_len, grace_ends_at, period_anchor,
       after_plan_moves, after_plan_last_subscription_id, updated_at, updated_by_admin_id
from public.business_os_account_plans
where user_id in ('<A>', '<B>');

-- Q2 the start rule (S-2) against Stripe's end
select b.user_id, b.stripe_subscription_id, b.subscription_status, b.current_period_end,
       b.cancel_at_period_end, b.ended_at, p.tier_expires_at, p.trial_started_at,
       greatest(b.ended_at, p.tier_expires_at + interval '1 day') as expected_free_from,
       p.trial_started_at = greatest(b.ended_at, p.tier_expires_at + interval '1 day') as start_ok
from public.business_os_billing_accounts b
join public.business_os_account_plans p on p.user_id = b.user_id
where b.user_id in ('<A>', '<B>') and b.livemode = false;

-- Q3 the free-period audit (one per move)
select created_at, entity_id, details->>'days' as days, details->>'priorMoves' as prior,
       details->>'subscriptionId' as sub, details->>'cancellationReason' as reason,
       details->>'stripeEventId' as evt, details->>'livemode' as livemode
from public.audit_trail
where action = 'BOS_PLAN_FREE_PERIOD_AFTER_CANCEL' and entity_id::text in ('<A>', '<B>')
order by created_at;

-- Q4 money history and the webhook claims
select e.user_id, e.kind, e.stripe_event_id, e.stripe_subscription_id, e.created_at, c.status as claim
from public.business_os_billing_events e
left join public.processed_webhook_events c on c.event_id = e.stripe_event_id
where e.user_id in ('<A>', '<B>') and e.kind = 'subscription_ended'
order by e.created_at;
```

**Pass when:** steps 1-5 match. Each subscription moves exactly once, each replay changes nothing, the second cancel is 7 days, and every `{until}` equals the stored `trial_ends_at` date.

### Final Status
- [x] All acceptance criteria pass — ready for commit. B-1 fixed (checker row 4 matches `"left"(`). U-4 done 2026-10-28: 20261098 applied on prod by the user; pre-check 5/5 ok, checker 8/8 ok (row 9: 0 accounts). SA comment 4 (a), (b), (c) all met. The user approved the diff and chose to ship now and run T-11 against the sandbox after the merge.
- [ ] T-11 sandbox check: owed after merge (checklist above).

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-27 | Created (Dev) | Workplan for D3.1 / SX-2b: webhook `.deleted` + `cancellation_requested` → free cohort through `afterPlanAccount` (gains the halving, settlement-start, no-extend and stale-grace rules), DELETE-owned `afterPlanMove` behind a thin mirror port, a conditional system write through a new repository method, `recordPlanChange` with a new audit key, the fresh credit total by moving `period_anchor`. Repeat-cancel count on the plan row: migration 20261097 (columns only, no regen). `AFTER_PLAN` joins the drift snapshot. S-1 to S-11 for SA, §14 for PLAN PAYMENTS, U-1 to U-4 for the user. ≈ 2.1 d |
| 2026-10-27 | Dev: DELETE scope implemented (T-2 to T-7, T-9, T-10) | Migration 20261097 + rollback, pre-check, checker (not applied). Repository `findAfterPlanMoveInputs` / `findAfterPlanMoveState` / `applyAfterPlanMove` (DR-5 CAS). `afterPlanAccount` with the DR-4 order, halving, S-2, S-4 and the S-11 replacement. `AFTER_PLAN.repeat` + drift snapshot. `previewAfterPlan` reads the count. `afterPlanMove.ts` + `afterPlanMoveDeps.ts` (port `afterPlanMove`). Audit key. Tests incl. DR-6, DR-9, DR-10. Jest + `test:bos-entitlements` green, tsc clean for touched files. T-8 left (waits for P-7a.4 + FU-P7a4-1); T-8 now also swaps the mirror's `CANCELLATION_REASONS` for `BUSINESS_OS_CANCELLATION_REASONS` (PLAN PAYMENTS SA ruling) |
| 2026-10-27 | SA workplan review | ⚠️ Approved with DR-1 to DR-12. S-1 A (no-regen claim verified: G-10/G-18 are FK-level, plan table is a whole-row delete). S-2 to S-10 approved. S-11 replaced: never write `tier_expires_at`, skip `paid_through_after_end` + alert. CAS on `updated_at` + `after_plan_moves`. PLAN PAYMENTS conditions folded in (alert on thrown read or write, audit never retries, FU-P7a4-1 first, late `invoice.paid` alert-only). One PR carries D3 + D3.1 and #539 is closed. U-5 recorded for reconfirmation. ≈ 2.25 d |
| 2026-10-27 | Dev: SA part 1 comment 1 fixed | `previewAfterPlan` samples `after` at the rule's `trialStartedAt` + 1 ms when moved; new test row (lapsed tier, 5th cancel, ended now → 1 day). Router-placement guard entry added to §8 as PLAN PAYMENTS-owned, part of the T-8 diff; its comment names D3.1. Entitlements, billing and stripe suites re-run green |
| 2026-10-27 | Dev: review follow-ups on T-8 | PLAN PAYMENTS SA sign-off on T-8 recorded (OK; changes 7 and 8 applied; swallow-and-alert rejected, throw-means-retry kept). Mirror replay test now runs the event three times (ruling 9), renamed "…twice replayed…". Redundant `as string` dropped in the port call. §8 row for `planRenewal.captured.test.ts` (SA comment 1). `enforcementPoints` mirror `why` gains the hand-off clause, symbols unchanged (SA comment 2). U-5 marked answered (user reconfirmed YES) |
| 2026-10-27 | Dev: T-1 merges + T-8 webhook wiring | T-1: backup, reset, merged `origin/feature/plan-cancel-drawer-d3` (`9e2b3f6a`) and `origin/main` (`b088b51d`) → HEAD `841163f4`, no conflicts; patch re-applied cleanly, unstaged; snapshot regenerated identical. T-8: mirror port + one call after `recordSubscriptionEnded` (also on replay), local `CANCELLATION_REASONS` deleted for `BUSINESS_OS_CANCELLATION_REASONS`, one handler-port line; mirror / handler / DR-8 guard rows; `planRenewal.captured.test.ts` deps builder gained the stub port (outside §8, forced); P-8b replay rows at the move and mirror levels. Throw-means-retry kept as approved. Nothing committed beyond the two merge commits; nothing stashed |
| 2026-10-27 | SA code review, part 1 (DELETE scope) | ✅ Approved with one condition: the preview must sample `after` at the rule's own `trialStartedAt` when moved (a lapsed tier ended "now" with 1 day showed "could not work out"). Deviations 1 to 5 approved (4 with that condition). Out-of-plan files approved as registration; the router-placement guard entry goes to PLAN PAYMENTS with T-8 |
| 2026-10-27 | QA (D3 + D3.1, one PR) | ⚠️ PASS WITH NOTES. 10 Jest runs green (no timeouts), `test:bos-entitlements` 324/9,658, tsc 0 errors in 33 touched files (no OOM), `lint:hooks` clean. QA test `afterPlanMove.previewParity.qa.test.ts` (14) pins drawer `{until}` = stored `trial_ends_at` for counts 0..6 in both modes. Prod read-only: table present (11 rows), both columns absent, 20261097 free in git. B-1 (Medium): checker row 4 matches unquoted `left(`, which the deparser renders `"left"(`, so it falsely FAILs; fix before U-4. T-11 post-paste checklist + read-back SQL written |
| 2026-10-27 | SA code review, part 2 (T-1 + T-8) | ✅ Approved, no blocking items. T-1 re-application intact (preview fix, `planEndingView`, snapshot, D3 now mode, P-7a.4 line). T-8 meets DR-6/7/8/10 and PLAN PAYMENTS' conditions: one port and one call outside `recordSubscriptionEnded`, also on a replay; no metadata; canonical account id; only `cancellation_requested` moves; P-8b replay a no-op at both levels. Throw → claim released → Stripe retries **stands**. 302 targeted tests green, 0 `console.*`. Low: add `planRenewal.captured.test.ts` to §8; optional registry `why` clause. Merge gates: PLAN PAYMENTS sign-off, 20261097 on prod, U-5 |
| 2026-10-28 | U-4 applied; ready to ship | User approved the D3 + D3.1 diff and pasted 20261097 on prod; pre-check 5/5 ok, checker 8/8 ok. All merge gates met. User chose to ship now; T-11 runs against the sandbox after merge. One PR from `feature/free-cohort-after-cancel-d3-1`; #539 closed |
| 2026-10-28 | Migration renumbered 20261097 → 20261098 | main took 20261097 for `20261097_a_session_knows_what_it_replaced.sql` (40f642ef) and `migrationNumberUnique` guards numbers ≥ 20261093. File, rollback, pre-check, checker, migration test and repository comments renamed; the SQL is byte-identical to what the user applied on prod on 2026-10-28, so nothing is re-applied. Earlier history rows keep the old number |
