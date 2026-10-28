# Workplan: Business OS Plan Payments, P-8b (Reconciliation and webhook health)

> **Last Updated**: 2026-10-28

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §9.1 P-8b row; §7 AM-4, AM-5 and the "Data source" line; §4 PF-5; §8 SR-3, SR-4, SR-8, SR-10, SR-11; §9.4 row "Stuck-event recovery and reconciliation"; §11 SA-P4 and its ruling in "SA Review — 2026-10-02" (SA-2), the P-8b row of SA-4 (no migration; `bos_cron_runs` and the billing record suffice); §9.5 row 1 (PF-5 is on the go-live floor)
**Depends on:** P-6a merged (row's dependency). Boost 4b.2 merged: it created `bos-billing-reconcile` and the pass seam. P-8a merged (#466, #467, #469): the billing panel's stored disagreements.
**Date:** 2026-10-27
**Branch:** `feature/bos-plan-payments-p8b`, worktree `neuronforge-p8b`, fresh from `main` `b088b51d` (#543). Confirmed with `git branch --show-current` on 2026-10-27. Highest migration on that main: `20261096`.
**Status:** SA APPROVED WITH CHANGES (2026-10-27, rulings 1 to 18). P-8b.1 SA-approved, QA passed, **PR #555 opened 2026-10-28** (auto-merge). **P-8b.2 code complete 2026-10-28** (uncommitted, branch `feature/bos-plan-payments-p8b2`, cut from P-8b.1's `66189df1`), awaiting SA code review. P-8b.3 not started.

## Overview

P-8b closes PF-5, the last open hole in "a paid invoice is never silently lost" (SR-4), and gives admins a view of webhook health. It has three parts:

- **Reclaim a stuck claim in the webhook (SA-P4 part 1).** Today a claim row left at `processing` (the function was killed, or the release write failed) makes every later delivery of that event answer "duplicate". After P-8b, a `processing` claim older than 15 minutes is taken back by one conditional UPDATE, and the delivery that wins it processes the event.
- **A plan pass on the nightly `bos-billing-reconcile` cron (SA-P4 part 2, AM-5).** The cron already exists (boost 4b.2) with a pass seam built for exactly this. P-8b appends `planReconcilePass`. It replays any plan event Stripe holds that our claim table does not show as completed, through the **same claim table and the same plan handler** the webhook uses. It also compares Stripe's subscriptions with our billing record and plan row, and reports what does not match.
- **Webhook health on `/admin/jobs-queues` (AM-4)**, plus the plan figures on the existing Billing reconcile job row and a way to run the plan pass now.

**Production after merge:** live, read-only, plus recovery through the same idempotent path (§9.1 row). **No migration** (§1.6). **Size: about 3.3 dev-days**, over the 2-day line, so §9 proposes three numbered PRs, never stacked.

**The one blocking question for SA is Q-1 (§12):** the reclaim changes one entry of the Connect characterisation snapshot by design, so the "md5 unchanged" rule cannot hold for P-8b.1 as written.

---

## Table of Contents

1. [Code facts (as-built on `b088b51d`)](#1-code-facts-as-built-on-b088b51d)
2. [Spec vs code mismatches](#2-spec-vs-code-mismatches)
3. [Scope](#3-scope)
4. [Design](#4-design)
5. [Stripe calls and limits](#5-stripe-calls-and-limits)
6. [Files to create / modify](#6-files-to-create--modify)
7. [Task list](#7-task-list)
8. [Tests and guards](#8-tests-and-guards)
9. [Split and estimate](#9-split-and-estimate)
10. [User browser steps](#10-user-browser-steps)
11. [Risks and overlaps](#11-risks-and-overlaps)
12. [Questions for SA](#12-questions-for-sa)
13. [Business questions (with defaults)](#13-business-questions-with-defaults)

---

## 1. Code facts (as-built on `b088b51d`)

### 1.1 `bos-billing-reconcile` already exists

| Fact | Where |
|---|---|
| The cron route exists, daily at 05:41 UTC, CRON_SECRET fail-closed, wrapped in `withCronRunRecord` (`bos_cron_runs`, counts only) | `app/api/cron/bos-billing-reconcile/route.ts`, `vercel.json` |
| Passes are pluggable. `RECONCILE_PASSES = [boostReconcilePass]`. The header says "plan payments P-8b appends `planReconcilePass` here; the cron route needs no change" | `lib/business-os/billing/reconcilePasses.ts` |
| The runner shares one 45 s deadline across passes in order; a throwing pass is counted, the next still runs; counters are flattened as `<pass><Key>` (pass name `^[a-z]{1,16}$`) | `lib/business-os/billing/reconcilePassRunner.ts` |
| A new pass's counters must also be added to the job's `counts` in the cron registry, or the run record drops them | `lib/cron/bosCronJobs.ts` (job `bos-billing-reconcile`, 7 `boost*` counts) |
| The boost pass's own admin button: `POST /api/admin/business-os/credits/boost/reconcile`, `requireAdmin` first, strict Zod empty body, write-ahead audit, runs **only** the boost pass, never writes `bos_cron_runs` | `app/api/admin/business-os/credits/boost/reconcile/route.ts` |
| The button lives on `/admin/jobs-queues`, on the Billing reconcile job's row only ("Reconcile top-ups now (all accounts)", LF-4c) | `app/admin/components/jobs/JobsQueuesView.tsx` (`RECONCILE_JOB_ID`), `ReconcileTopUpsDialog.tsx`, `reconcileCopy.ts`; pinned by `app/admin/__tests__/jobsQueues.source.guard.test.ts` |
| Boost 4b ruled its pass **not a queue drain** (SA Q-5): it writes only through row-locked idempotent SQL, claims nothing | route header |

**Answer to brief item 1:** the route exists, so P-8b adds a pass. The webhook stale-claim reclaim is **not built at all**: there is no age test anywhere. `ProcessedWebhookEventRepository.markFailed`'s comment names it as "its own change".

### 1.2 The webhook claim (SR-3: one endpoint, one claim table)

`app/api/stripe/webhook/route.ts` (2,930 lines, `maxDuration = 60`), lines 2617 to 2676, through `lib/repositories/ProcessedWebhookEventRepository.ts` (CF-5 PR 1; callers: the route only):

| Read of `findClaim` (`select 'event_id, status'`) | What happens today |
|---|---|
| `completed` | 200 `duplicate` |
| `processing` | 200 `duplicate` ("in flight"), **whatever its age** |
| `failed` | `reclaimFailed` (unconditional UPDATE by `event_id`), then process |
| none | `insertClaim`; `23505` → 200 `duplicate` |

After the handlers: `completeClaim` (the only completing write, pinned by `routerPlacement.guard`). On a throw: `markFailed`, 500.

Two holes:

- **H-1 (PF-5).** The function is killed at 60 s, or `markFailed` fails (DB down): the row stays `processing` for ever and every later delivery is a 200 duplicate.
- **H-2 (found here, not in the requirement).** A delivery that arrives *while* a row is `processing` gets 200. If the in-flight attempt then dies, Stripe has already been told "delivered" and does not retry. So the webhook reclaim alone only helps a delivery that arrives **after** 15 minutes (a Stripe retry later in its 3-day schedule, or a manual "Resend" from the dashboard). The nightly pass is what closes H-2 for plan events (§4.2). Connect and other events are listed on the Jobs page (§4.3) and can be resent from the Stripe dashboard once the reclaim is live.

Also noted: `reclaimFailed` is not conditional, so two simultaneous redeliveries of a `failed` event can both process it. Out of scope; Q-6.

### 1.3 The Connect harness pins the claim queries

`app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` records every Supabase chain. Its snapshot (`md5 ab7528ea68309cffb309ffbd46c455ab`, measured 2026-10-27 on `b088b51d`) names `processed_webhook_events` 321 times. Entry **9b "an in-flight delivery (processing) is short-circuited"** records exactly one effect: the `findClaim` select. Any reclaim attempt on a `processing` row adds an effect there. **So SA-P4 part 1 must change entry 9b**, and nothing else. See §4.1 and Q-1.

### 1.4 Plan handler and mirror

| Fact | Where |
|---|---|
| `handlePlanBillingEvent(event, log)` is exported from lib and registered in the route's `BUSINESS_OS_FLOW_HANDLERS.plan`; "returns = complete, throws = release for retry" | `lib/business-os/billing/planBillingHandler.ts` |
| The dispatcher decides the flow (`plan`, `boost`, `not_business_os`, deny) from the event, platform events only | `lib/business-os/billing/webhookDispatcher.ts` |
| The paid-invoice apply and the mirror take a **`Stripe.Event`**, and money history is unique on the event id ("a replay records nothing") | `planPaymentApply.ts`, `planSubscriptionMirror.ts` |
| The mirror reads the subscription FRESH and copies status, `cancel_at_period_end`, `ended_at` only; never the tier or `current_period_end` | `planSubscriptionMirror.ts` header |
| The billing panel computes stored disagreements `tier_differs`, `paid_through_differs`, `no_tier_on_plan` from our records only. Its type comment: "The check against Stripe itself is P-8b's reconciliation (AM-5)" | `lib/admin/billing/billingPanelTypes.ts`, `billingPanelView.ts` |
| `StripeService` has `subscriptions.list` per customer and `invoices.list`; it has **no** `events.list` / `events.retrieve` method | `lib/stripe/StripeService.ts` |

The replay design (§4.2) follows from the third row: we cannot invent an event, so the pass must use Stripe's own events.

### 1.5 Live schema (read-only probe, 2026-10-27, zero-row selects against production)

| Table | Columns checked | Result |
|---|---|---|
| `processed_webhook_events` | `event_id, event_type, status, processed_at, completed_at, failure_message, metadata, user_id` | OK |
| `business_os_billing_events` | `id, user_id, livemode, kind, stripe_event_id, stripe_invoice_id, amount_minor, paid_at` | OK |
| `business_os_billing_accounts` | `stripe_subscription_id, subscription_status, bought_tier, current_period_end, cancel_at_period_end, ended_at, livemode` | OK |
| `bos_cron_runs` | `job, started_at, outcome` | OK (the column is `job`, not `job_id`) |

The partial index `idx_processed_webhook_events_unfinished (processed_at DESC) WHERE status <> 'completed'` exists in `20260828_webhook_event_status.sql` and serves the Jobs page read. Production today has **5 unfinished claims, all `failed`, none `processing`**: four `payment_intent.succeeded` (2026-09-23 to 2026-10-18) and one `invoice.paid` (2026-09-29). They are what AM-4 will show on day one (B-2).

### 1.6 Migration verdict: none

The claim table already has `status`, `processed_at` and `failure_message`. The reconcile's durable trace is `bos_cron_runs` (counts) plus `error` logs. Per-account flags are derived from stored records (§4.4). This matches SA-4's P-8b row. If SA prefers a stored per-account flag (Q-4 option B), that needs the next free number after `20261096`.

---

## 2. Spec vs code mismatches

| # | Spec says | Code / fact | Proposal |
|---|---|---|---|
| M-1 | SA-P4 (2): the cron "on the `durable-queue-drain` pattern (… bounded batch, per-item lease …)" | Boost 4b ruled its pass not a queue drain (SA Q-5); the route header says so | The plan pass does claim: it uses `processed_webhook_events` as its lease table (the 15-minute stale reclaim is the reaper). That is the §8.1 shape without a new claim RPC. Q-2 |
| M-2 | SA-P4 (2): "lists BOS-price subscriptions and paid invoices since the last good run … re-applies them through `business_os_apply_plan_payment`" | The apply path takes a `Stripe.Event`, and history is keyed on the event id | Replay Stripe's own events (`events.list`), not invoices. A synthesised event would double the history. Q-3 |
| M-3 | AM-5: "Results on AM-1/AM-2 as flags" | AM-1 already shows stored disagreements; AM-2 shows none; no column holds a Stripe-side finding | Option A (default, no migration): the replay makes the mirror current, so stored disagreements become the Stripe-vs-plan flag; AM-2 gains a "Disagrees" marker and filter; Stripe-only findings are `error` logs plus counts. Q-4 |
| M-4 | §9.1 demo: "recovered by the nightly job or the button" | The only button runs the boost pass only | A plan button beside it, or one button for every pass. Q-5 |
| M-5 | AM-4: "Failed and stuck events, oldest first" | `failure_message` holds raw handler error text (up to 500 chars) | Show a short class, not raw text. Q-7 |

---

## 3. Scope

**In:** the webhook stale-claim reclaim (P-8b.1); `planReconcilePass` with event replay, the Stripe vs record comparison and the unassigned-paid-invoice check (P-8b.2); the AM-4 webhook-health block, plan counts on the Billing reconcile row, the plan button, and an AM-2 "Disagrees" marker (P-8b.3).

**Out:** Connect replay (Connect events are only listed and counted; SR-10); making `reclaimFailed` conditional (Q-6); alert emails (AM-9, later); any change to `planBillingHandler.ts`, `planSubscriptionMirror.ts` or `planPaymentApply.ts` (§11, deletion stream).

---

## 4. Design

### 4.1 P-8b.1: stale-claim reclaim in the webhook

One new repository method, used by the route and the pass:

```typescript
// ProcessedWebhookEventRepository
async reclaimStale(eventId: string, cutoffIso: string): Promise<WebhookClaimResult<boolean>>
// UPDATE processed_webhook_events
//   SET status = 'processing', failure_message = NULL, processed_at = now
//   WHERE event_id = $1 AND status = 'processing' AND processed_at < $cutoff
// via .update(values, { count: 'exact' }).eq().eq().lt(); won = count === 1
```

`{ count: 'exact' }`, never `.select()` (the PostgREST update-plus-select defect; no `.or()` here either). The route's `processing` branch becomes:

```
processing → reclaimStale(event.id, now − 15 min)
   won        → log warn 'bos_webhook_stale_claim_reclaimed' (the bound event id and type; the claim's age is not read); processedEventId = event.id; process as a new claim
   not won    → 200 duplicate, as today
   error      → log error; 200 duplicate, as today (never process without a claim)
```

- **15 minutes** is SA-P4's figure: over 60 s `maxDuration` by a wide margin, so a row that old is provably dead. The constant `STALE_CLAIM_AGE_MS` lives in the repository file, so P-8b.2's pass uses the same figure.
- **Connect is affected on purpose (SA ruling 1).** SA-P4: "This also protects Connect money". The reclaim is **not** scoped to plan events, and no `event.account` branch is added. Only a stuck `processing` row behaves differently; every other path makes the same queries as today.
- **The route's `reclaimFailed` stays unconditional in P-8b (SA ruling 6).** Making it conditional changes harness 9c and every failed-retry entry; it is follow-up **FU-P8b-1**. The pass's conditional `reclaimFailedIfStillFailed` (ruling 2) is P-8b.2's and is **not** deferred.
- **P-8b.2 claim rules (SA ruling 2), recorded here because they shape the repository.** The pass is a drain with no new RPC: the unique insert and the conditional updates are the lease, `reclaimStale` is the reaper. The pass never calls the unconditional `reclaimFailed`; it uses a new `reclaimFailedIfStillFailed(eventId)` (`.eq('status','failed')`, `{ count: 'exact' }`, won = 1), of which it is the only caller. It runs the handler only on a won claim and completes or fails the claim through one local helper, pinned by a source guard on `planReconcilePass.ts` that mirrors `routerPlacement`. The repository's CALLERS line names the pass when it lands.
- **SR-10 evidence (SA ruling 1, binding, five parts):**
  - (a) Entry **9b** changes by **exactly one** added effect: the conditional update, which does not win (the mock answers no count). Its response stays `{ received: true, duplicate: true }`, 200.
  - (b) New entry **9d** (Connect `invoice.finalized`, stale `processing`, reclaimed): after its `findClaim` and `reclaimStale` effects, the sequence is **byte-identical** to the fresh-claim entry for the same fixture (**6b**) with its `insertClaim` effect removed. A test asserts this, not only the snapshot.
  - (c) New entry **9e** (reclaim lost): `findClaim`, then `reclaimStale`, then the duplicate response, with no handler effect.
  - (d) A per-export checksum list before and after goes into Implementation Notes. Every export other than 9b, 9d and 9e is identical; the new md5 is recorded. Never a whole-file `-u`: 9b is re-recorded with `-t` on its name only, and 9d / 9e are written as new snapshots.
  - (e) RM names the Connect change in the PR body, so Offir sees it.
- **Harness clock.** The cutoff is 15 minutes before the run, outside the harness's ±10-minute `<NOW>` band, so `sanitise` gains one narrow rule: a timestamp within 1 minute of "run start − 15 min" becomes `<NOW-15MIN>`. The two bands do not overlap, and no fixture timestamp falls in either, so no existing export changes.

### 4.2 P-8b.2: `planReconcilePass`

Appended to `RECONCILE_PASSES` after the boost pass (passes never share rows: this pass touches only events the dispatcher resolves as `plan`, and boost events are left to the boost pass).

**Step A, replay (closes H-1 and H-2 for plan events).**

1. Window: from the start of the last `succeeded` run of `bos-billing-reconcile` in `bos_cron_runs`, minus 1 hour of overlap; never more than 7 days back; 3 days when there is no good run (Q-8). Stripe keeps events 30 days.
2. `StripeService.listBusinessOsPlanEvents({ createdGte, types })` (new, paged at 100, bounded at 10 pages, returns `complete: false` instead of a partial list, the `listCustomerSubscriptions` precedent). Types: the plan handler's own set: `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `customer.subscription.updated`, `customer.subscription.deleted`. Platform account only: `events.list` without a `Stripe-Account` header never returns Connect events. Events whose `livemode` differs from the key's mode are skipped (PF-15).
3. Per event, until the deadline: `findClaim`. `completed` → step C check only. `processing` and fresh → skip. Otherwise run the **dispatcher**; not `plan` → skip, counted. `plan` → take the claim (insert, `reclaimFailed`, or `reclaimStale`; a lost race skips), call `handlePlanBillingEvent(event, log)`, then `complete` or, on a throw, `markFailed`. That is the webhook's own sequence, so the pass and a live delivery converge (SR-4).
4. Batch bound: at most 100 events handled per run, stop starting new ones 15 s before the shared deadline (the boost rule, SA C-4).

The claim helpers move into a small shared module (`lib/business-os/billing/webhookClaim.ts`) only if SA wants one sequence for both callers (Q-2). The default is to leave the route's block in place and have the pass call the repository directly, which keeps the Connect snapshot to the 9b change only.

**Step B, Stripe vs our records (AM-5 "disagreements").** Read our current-mode billing rows that hold a subscription and are not ended (new read method, admin-free, service role, `stripe_subscription_id` included). For each, compare against Stripe's subscription, read in pages (§5):

| Compared | Finding when |
|---|---|
| Status, `cancel_at_period_end`, `ended_at` vs the mirror | differ after step A (the mirror missed an event outside the window) |
| Stripe's price → tier (catalog, CF-1 retired keys included) vs `bought_tier` and the plan row tier | differ (e.g. a price changed in the Stripe dashboard with no paid invoice yet) |
| Stripe's item `current_period_end` vs the mirror's `current_period_end` and the plan row's `tier_expires_at` | differ by more than the panel's 1 s, while paying |
| A BOS-price subscription in Stripe with no billing row | always (orphan) |

Each finding is one `error` log `bos_plan_reconcile_finding` with `{ kind, billingAccountId, stripeSubscriptionId }`, no money and no email, and a counter. **Step B never writes** (Q-4).

**Step C, paid invoice with no plan assignment (AM-5).** For every `invoice.paid` plan event in the window whose claim is `completed`, check `business_os_billing_events` has the `invoice_paid` row for that event. Missing → finding `paid_invoice_unassigned`. Not replayed: the handler already decided (a refusal is logged by the handler; replaying a completed claim would break the claim's meaning).

**Tenant isolation (SR-8, `tenant-isolation-guard`).** The pass takes no account id from anywhere. Every write goes through the plan handler, which resolves the account from our billing record by Stripe id and checks `bos_user_id` metadata against it. The pass adds no service-role write of its own except the claim rows, which carry no business data. Step B and C reads are named `…AllAccounts` (the P-8a D-1 convention) and never write.

**Counters** (added to `bosCronJobs.ts` too): `planEventsSeen`, `planReplayed`, `planReplayFailed`, `planSkippedNotPlan`, `planStaleReclaimed`, `planMismatch`, `planOrphan`, `planUnassigned`, `planIncomplete` (a Stripe list stopped at its page cap).

### 4.3 P-8b.3: admin surfaces

- **AM-4 on `/admin/jobs-queues`.** A new "Stripe webhook events" block, KPI first (memory: money pages KPI-first): tiles **Failed**, **Stuck** (`processing` older than 15 minutes), **Oldest unfinished** (age). Below, a list oldest first, at most 50: event type, flow class (`plan`, `boost`, `connect`, `other`, from `event_type` and `metadata` only, never a Stripe call), status, first seen, age, and the failure **class** (Q-7). Admin-only through the page's `requireAdminPage` and a new `GET /api/admin/jobs-queues/webhook-events` with `requireAdmin` first. Read through a new read-only repository (`AdminWebhookEventReadRepository`, the D-1 pattern), never the writer. Current mode only (`metadata->>livemode`, PF-15).
- **Plan figures** on the Billing reconcile row come for free from the new counts.
- **Run the plan pass now (Q-5).** Default: one new route `POST /api/admin/business-os/billing/reconcile` running the plan pass only, in the shape of the boost route (requireAdmin first, strict empty body, write-ahead audit `BOS_BILLING_RECONCILE_TRIGGERED`, counts-only response, never writes `bos_cron_runs`), and a second dialog on the same row. Each new client file is added to the Jobs source guard narrowly, as LF-4c did.
- **AM-2 "Disagrees".** The Subscriptions list marks rows where the panel's stored disagreement rule fires (the same function, so list and panel cannot differ) and gets a "Disagrees" filter. The AM-1 panel is unchanged.

---

## 5. Stripe calls and limits

| Call | Count per run (today, test mode) | Count at 1,000 subscribers |
|---|---|---|
| `events.list` (5 types, 100 per page) | 1 | about 1 to 3 per day of window (≈ 1,100 plan events a month) |
| Handler reads per replayed event (subscription retrieve, invoice lines) | 0 (nothing to replay) | 2 to 3 × replays, normally 0 |
| `subscriptions.list` for Step B (`status: 'all'`, `price` filter per BOS price id, 100 per page, `expand: items.data.price` not needed) | 1 per plan price (2 today, plus retired) | about 10 to 12 |

Stripe's read limit is 100 per second live and 25 in test mode. A run makes well under 30 calls, sequentially, so no throttling is needed. Pagination is bounded (10 pages per list) and an incomplete list is counted (`planIncomplete`) and treated as "no finding" for the rows it did not reach, never as an orphan. Access decisions never wait on any of this (SR-11): the pass runs at night or on a button.

---

## 6. Files to create / modify

| File | Action | Slice | Reason |
|---|---|---|---|
| `lib/repositories/ProcessedWebhookEventRepository.ts` | modify | 1 | `reclaimStale`; header's caller list gains the pass (in 2) |
| `app/api/stripe/webhook/route.ts` | modify | 1 | the `processing` branch only (≈ 15 lines) |
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` + `.snap` | modify | 1 | 9b changes by one effect; new 9d, 9e (Q-1) |
| `app/api/stripe/webhook/__tests__/staleClaim.qa.test.ts` | create | 1 | reclaim matrix |
| `lib/repositories/__tests__/ProcessedWebhookEventRepository.test.ts` | modify | 1 | the new method's chain, no `user_id`, no `.select()` |
| `lib/stripe/StripeService.ts` | modify | 2 | `listBusinessOsPlanEvents`, `listSubscriptionsByPrice` (paged, bounded) |
| `lib/business-os/billing/planReconcilePass.ts` | create | 2 | steps A to C, pure given deps |
| `lib/business-os/billing/planReconcileDeps.ts` | create | 2 | wiring (`server-only`), like `boostReconcileDeps.ts` |
| `lib/business-os/billing/reconcilePasses.ts` | modify | 2 | append the pass |
| `lib/repositories/BusinessOsBillingAccountRepository.ts` or a new read repo | modify / create | 2 | `listOpenSubscriptionsAllAccounts(livemode)` (Q-9) |
| `lib/repositories/BosCronRunRepository.ts` | modify | 2 | `lastSucceededStart(job)` |
| `lib/repositories/BusinessOsBillingEventRepository.ts` | modify | 2 | `hasEventForStripeEvent(eventIds[])` |
| `lib/cron/bosCronJobs.ts` (+ test) | modify | 2 | plan counts; description now names plans |
| `lib/repositories/AdminWebhookEventReadRepository.ts` | create | 3 | AM-4 read |
| `app/api/admin/jobs-queues/webhook-events/route.ts` | create | 3 | AM-4 GET |
| `app/api/admin/business-os/billing/reconcile/route.ts` | create | 3 | plan button (Q-5) |
| `lib/audit/events.ts` | modify | 3 | `BOS_BILLING_RECONCILE_TRIGGERED` |
| `app/admin/components/jobs/JobsQueuesView.tsx`, `WebhookEventsBlock.tsx`, `ReconcilePlansDialog.tsx`, `reconcileCopy.ts` | modify / create | 3 | UI |
| `app/admin/__tests__/jobsQueues.source.guard.test.ts` | modify | 3 | narrow amendment |
| Subscriptions list view and page files (P-8a.1) | modify | 3 | "Disagrees" marker and filter |
| `lib/admin/environment/catalogue.ts` | none expected | — | no new `process.env` read (§8) |

---

## 7. Task list

- [x] ✅ P-8b.1 Step 1: record the snapshot md5 and a per-export checksum list before any change
- [x] ✅ P-8b.1 Step 2: `reclaimStale` + repository test
- [x] ✅ P-8b.1 Step 3: route `processing` branch; log line
- [x] ✅ P-8b.1 Step 4: harness 9b/9d/9e per the Q-1 ruling; per-export comparison script output in Implementation Notes
- [x] ✅ P-8b.1 Step 5: `staleClaim.qa.test.ts`; `routerPlacement.guard` still green
- [x] ✅ P-8b.2 Step 1: Stripe list methods + tests (paging, cap, `complete: false`)
- [x] ✅ P-8b.2 Step 2: repository reads (cron runs, billing events by event / invoice id, subscription rows) in `PlanReconcileReadRepository` (ruling 9; D-5); `reclaimFailedIfStillFailed` (ruling 2)
- [x] ✅ P-8b.2 Step 3: `planReconcilePass` A, B, C + unit tests, source guard, D3.1 double-replay test; appended to `RECONCILE_PASSES`; counts in `bosCronJobs.ts`
- [x] ✅ P-8b.2 Step 3b: TL decision 11, P-6a follow-up F-1: `replaceCustomer` clears the whole subscription mirror
- [x] ✅ P-8b.2 Step 3c: SA API-version ruling (b), V-1 to V-5 (verified (version, type) map, pass gate and summary warn, endive `checkout.session.completed` capture, ratchet, requirement §9.5 row 9)
- [x] ✅ P-8b.2 Step 4: sandbox demo, re-run 2026-10-28 after V-1 to V-5 (real Stripe test reads, in-memory DB ports). Points 1, 2, 3 and 5 shown; **point 4 (a real-data mismatch) could not be shown** without touching the forbidden customer or a Stripe write; see "API-version ruling built, and the Step 4 demo (P-8b.2)"
- [ ] P-8b.3 Step 1: AM-4 read repo + route + tests (auth failure, invalid input, happy path)
- [ ] P-8b.3 Step 2: plan reconcile route + audit event + tests
- [ ] P-8b.3 Step 3: Jobs page block and dialog; guard amendment; render tests
- [ ] P-8b.3 Step 4: AM-2 "Disagrees" marker and filter
- [ ] Each PR: `npm run test:bos-entitlements` if any entitlements import is touched (the AM-2 change is); build and typecheck filtered to touched files

---

## 8. Tests and guards

| Test | Pins |
|---|---|
| Reclaim matrix (P-8b.1) | fresh `processing` → duplicate, one update attempted, no handler; stale → handler runs, claim completed; stale lost race → duplicate; reclaim error → duplicate, error logged; `completed` and `failed` paths unchanged |
| Connect harness (SA ruling 1) | 9b gains exactly one non-winning update, same response; 9d after `findClaim` + `reclaimStale` equals 6b minus `insertClaim` (asserted in a test, not only by snapshot); 9e = `findClaim`, `reclaimStale`, duplicate, no handler effect; every other export byte-identical (per-export checksum diff in the notes, new md5 recorded); never a whole-file `jest -u` |
| `routerPlacement.guard` (SA ruling 2) | `reclaimStale` joins `findClaim`, `reclaimFailed`, `insertClaim`, `markFailed` in the list of claim methods `POST` calls exactly once |
| Route's `reclaimFailed` (SA ruling 6) | unchanged and still unconditional in P-8b; the conditional version is FU-P8b-1 |
| Repository | `reclaimStale` chain `update(values, {count:'exact'}).eq(event_id).eq(status,'processing').lt(processed_at, cutoff)`, awaited; won only when `count === 1`; no `user_id`, no `.select()`, no `.or()`; existing `mutationOrSelect` guard green. P-8b.2 adds `reclaimFailedIfStillFailed` with the same shape and `.eq('status','failed')` |
| Pass source guard (P-8b.2, SA ruling 2) | `planReconcilePass.ts` never calls `reclaimFailed`; runs the handler only after a won claim; completes / fails the claim through one local helper |
| Pass unit tests | window from last good run, cap, overlap; Connect-free; mode skip; dispatcher non-plan skipped; claim taken before the handler, completed after, failed on throw; never runs the handler without a claim; deadline stops new work; each finding kind; incomplete list → no orphan finding; counts are integers only |
| Convergence | pass and webhook on the same event: one handler run (claim), and a replay of a completed event changes nothing |
| Route tests (P-8b.3) | `requireAdmin` first statement; strict Zod (unknown key 400); 401/403; counts-only response; no `bos_cron_runs` write |
| Jobs source guard | the narrow amendment: one new POST, literal URL, literal body `{}`; the read block is read-only |

**CI time (memory: no added CI time).** All new tests are unit tests in existing Jest shards, no new job, no network. Expected under 3 s total. **Env (EC-3):** no new `process.env` read. If SA wants the 15-minute window or the pass's caps configurable, they stay constants; a new variable would need a catalogue entry in the same PR. **Repository allow-lists:** the pass and routes reach the DB only through `lib/repositories/`; the new read repository is added to whatever repository allow-list guard names admin readers.

---

## 9. Split and estimate

Three PRs, in order, never stacked. Each is about a day.

| PR | Scope title | Done means (acceptance) | Est. |
|---|---|---|---|
| **P-8b.1** | **Stuck webhook claims are taken back** | A claim forced to `processing` with `processed_at` 20 minutes ago is reclaimed by the next delivery (a Stripe dashboard "Resend" in the sandbox) and the event is processed once; one forced 1 minute ago is still a duplicate. Connect: only harness entry 9b changes, by one effect; 9d/9e added; all else byte-identical. | 0.9d |
| **P-8b.2** | **Nightly plan reconcile** | With a test-mode plan `invoice.paid` whose claim is forced to `processing` (stale) or deleted, one cron run (or `GET` with the secret in dev) re-applies it: plan row and money history written once, claim completed; a second run changes nothing. A deliberate mismatch (the plan row's tier changed by admin on a subscribed test account, or a price swapped in the Stripe dashboard) produces one `bos_plan_reconcile_finding` and `planMismatch = 1` in the run record. Boost counts unchanged. | 1.4d |
| **P-8b.3** | **Webhook health and plan reconcile on the Jobs page** | `/admin/jobs-queues` shows Failed / Stuck / Oldest tiles and the list, oldest first (today: the 5 failed production rows in live mode, or none in test mode, by mode); "Reconcile plan payments now" runs the plan pass and shows counts; the Subscriptions list marks and filters "Disagrees". | 1.0d |

Total ≈ 3.3d (row estimate 2 to 3 days; the overrun is the harness evidence and the AM-2 marker).

---

## 10. User browser steps

Owed after P-8b.3 deploys (test mode): open `/admin/jobs-queues`, check the webhook block and its tiles, press "Reconcile plan payments now", and check the Billing reconcile row's counts. Open `/admin/subscriptions` and filter "Disagrees". Forcing a stuck claim is a SQL step on the sandbox data and is done by Dev or QA, not the user (no production writes from Dev).

---

## 11. Risks and overlaps

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The reclaim double-processes a live attempt | Impossible over 60 s `maxDuration`; 15 min is 15× that. The handlers are idempotent anyway |
| R-2 | **Deletion stream overlap.** D3 / D3.1 (SX-2b) edit `planSubscriptionMirror.ts`, `planBillingHandler.ts` and the webhook route (the `customer.subscription.deleted` path, free-cohort move) | P-8b edits **none** of the plan handler files: the pass only imports `handlePlanBillingEvent`. P-8b.1 edits the route's claim block only (≈ line 2641), far from the event switch, and the Connect snapshot. Whichever merges second rebases the snapshot (merge both sides' entries, never `-u`). Once D3.1 lands, a replayed `subscription.deleted` runs its free-cohort move; D3.1 must stay replay-safe, which Stripe redelivery already requires. Name this to the D3.1 owner |
| R-3 | A large window replays many events | 100-event batch cap and the shared deadline; `planIncomplete` counted |
| R-4 | Shared deadline: the boost pass uses most of the 45 s | Plan pass runs second and gets what is left; if `planIncomplete` repeats, Q-10 |
| R-5 | `failure_message` exposes internals | Classes only (Q-7) |

---

## 12. Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| **Q-1 (blocking)** | The brief requires the Connect snapshot md5 unchanged. SA-P4 part 1 changes the `processing` path for every event, Connect included, so entry 9b must gain one effect. How should the evidence be recorded? | Accept a deliberate change to **9b only**, plus new 9d and 9e. Regenerate with `-t` for those three names only (`--ci=false`, never a whole-file `-u`), and attach a per-export checksum diff showing every other export unchanged. Record the new md5 in the notes |
| Q-2 | Is the plan pass a "drain" under SA-P4 (2)? Should it share one claim sequence with the route? | Yes in effect: it leases each event through `processed_webhook_events`, and the 15-min reclaim is the reaper; no new claim RPC. Keep the route's block as is (smaller Connect diff); the pass calls the repository |
| Q-3 | Replay Stripe events (`events.list`) rather than listing invoices and re-applying them? | Yes: the apply path and history are keyed on the event id; a synthesised event would duplicate history |
| Q-4 | Where do Stripe-side findings show? | **A (default):** no migration; the replay keeps the mirror current, AM-1's stored disagreements and AM-2's new marker are the flags; Stripe-only findings (price swapped in Stripe, orphan, unassigned paid invoice) are `error` logs + counts on the Jobs row. **B:** a migration adding `reconcile_findings jsonb` + `reconciled_at` to the billing record, shown on AM-1/AM-2 |
| Q-5 | One button per pass, or one "Reconcile billing now" running every pass? | A second route and dialog for plans (the boost button and its guards stay untouched) |
| Q-6 | Make `reclaimFailed` conditional (`.eq('status','failed')` + count) in P-8b.1? | Not here: it changes harness 9c and every failed-retry entry; a follow-up |
| Q-7 | AM-4 shows raw `failure_message`? | No: a class derived server-side (`handler_error`, `refused`, `timeout`, `unknown`) and the event id with a dashboard link |
| Q-8 | Replay window | Last good run − 1 h, capped at 7 days; 3 days when there is none |
| Q-9 | The Step B read: a method on the writer repository, or a new read-only repository? | A new read-only method set in a separate file (P-8a D-1), so the writer's caller list does not grow |
| Q-10 | Give the plan pass its own deadline share? | No for now; revisit if `planIncomplete` shows |

---

## 13. Business questions (with defaults)

| # | Question, in plain words | Recommended default |
|---|---|---|
| B-1 | When the nightly check finds that Stripe and our records disagree about a customer's plan (for example, someone changed the price in the Stripe dashboard), should it fix our records automatically, or only flag it for a person? | **Only flag it.** Payments it missed are re-applied automatically (that is safe: Stripe already took the money), but a disagreement about which plan someone has is shown to an admin to decide |
| B-2 | The new webhook health list will show 5 old failed payment events from September and October (four client payments, one plan invoice). Should old failures stay on the list until someone acts, or drop off after a time? | **Stay until resolved, oldest first**, with their age shown. Dev reports the 5 rows to the user separately so someone can check them in the Stripe dashboard |

**TL decisions (2026-10-27).**
- **B-1 and B-2 take the defaults:** flag only; old failed events stay listed until someone acts. The user may still change them. If B-1 ever became "auto-fix", Step B would need a write path, and that goes back to SA.
- **TL decision 11 (SA check 18): P-6a follow-up F-1 goes into P-8b.2.** `replaceCustomer` keeps stale columns, and those stale columns would show up as false mismatches in Step B. P-8b.2's scope and estimate grow by that fix.

---

## SA Review Notes

### SA review: P-8b workplan

**Reviewed by SA, 2026-10-27**
**Status:** APPROVED WITH CHANGES. The rulings below are binding, and Dev starts P-8b.1 only once they are folded into §4 to §8.

Checked against: §9.1 P-8b row, AM-4, AM-5, PF-5, SR-4, SR-8, SR-10, SA-P4, the §9.4 coordination row, and the SA-4 P-8b row. Code read: the route's claim block (lines 2617 to 2676), the dispatch block, `completeClaim`, the release block, `ProcessedWebhookEventRepository`, `planBillingHandler.ts`, `planSubscriptionMirror.ts` (`.deleted`), `reconcilePasses.ts`, `reconcilePassRunner.ts`, `bosCronJobs.ts`, `routerPlacement.guard.test.ts`, and the two billing repository allow-list tests. Connect snapshot md5 re-measured: `ab7528ea68309cffb309ffbd46c455ab` (matches §1.3).

#### Rulings on Q-1 to Q-10

1. **Q-1 (blocking): accepted. Do not scope the reclaim to plan events.** SA-P4 part 1 says the reclaim "also protects Connect money", and the stuck-`processing` hole (H-1) loses Connect payments in the same way. A plan-only reclaim would put an `event.account` branch inside the claim block, which is a larger Connect diff and leaves Connect money unprotected. SR-10 asks for before-and-after evidence; it does not ask for a frozen md5. The evidence has five binding parts:
   - (a) Entry 9b changes by **exactly one** added effect: the conditional update, which does not win. Its response stays identical (`{ received: true, duplicate: true }`, 200).
   - (b) 9d (Connect, stale, reclaimed) must record, after the `findClaim` and `reclaimStale` effects, a sequence **byte-identical** to the existing fresh-claim Connect entry for the same fixture with its `insertClaim` effect removed. This proves that the handler path after a reclaim is unchanged.
   - (c) 9e (reclaim lost) records `findClaim`, then `reclaimStale`, then the duplicate response, with no handler effect.
   - (d) The per-export checksum list before and after goes into Implementation Notes. Every export other than 9b, 9d and 9e must be identical. Record the new md5. Never run a whole-file `-u`.
   - (e) RM names the Connect change in the PR body so Offir sees it.
2. **Q-2: the pass is a drain, and it needs no new claim RPC.** The unique insert and the conditional updates on `processed_webhook_events` are the lease, and the 15-minute reclaim is the reaper. Conditions:
   - The pass **must not call the unconditional `reclaimFailed`**, because a nightly actor would race Stripe's own retry of the same `failed` row. Add `reclaimFailedIfStillFailed(eventId)` (`.eq('status','failed')`, `{ count: 'exact' }`, won = 1). The pass is its only caller.
   - The pass runs the handler only on a won claim, and completes or fails the claim through one local helper. Add a source guard on `planReconcilePass.ts` that mirrors `routerPlacement`.
   - In `routerPlacement.guard`, add `reclaimStale` to the list of methods called exactly once.
   - The repository header's CALLERS line names the pass.
3. **Q-3: approved.** The pass replays Stripe's own events.
   - **The type list is the handler's full set, all 7 types, including `checkout.session.completed` and `checkout.session.expired`.** A lost `checkout.session.completed` leaves the subscription unlinked and the checkout lock held. Export the set once from `planBillingHandler.ts` and pin the pass to it. Do not keep a second, hand-written list.
   - **Skip any event whose `api_version` differs from the version the handler is written for, and count it** (`planApiVersionSkipped`). `events.list` renders events at the account's version, not the webhook endpoint's pinned version, so the payload shapes can differ.
   - Replay oldest first (ascending `created`).
4. **Q-4: option A, no migration** (SA-4). Step B never writes.
5. **Q-5: per-pass button, as proposed.** The boost route and its guards stay untouched. The plan route calls `planReconcilePass.run` and never copies its logic.
6. **Q-6: the route's `reclaimFailed` stays as it is in P-8b.** Making it conditional is follow-up FU-P8b-1. The pass's conditional version (ruling 2) is not deferred.
7. **Q-7: approved.** Show failure classes only. The dashboard link uses the row's own mode (the `/test/` path for test events).
8. **Q-8: the window anchor changes.** Anchor on the last `succeeded` run whose plan pass finished all its work: `planIncomplete`, `planDeadlineHit` and `passesFailed` all 0. Never more than 7 days back; 3 days when no such run exists. When the 7-day cap cuts the window short, count it (`planWindowClipped`). A capped or timed-out run must never move the window past events it did not process.
9. **Q-9: a new read-only file, as proposed.**
10. **Q-10: no separate deadline share for now.** Add `partlyDoneWhen` entries for `planIncomplete`, `planDeadlineHit`, `planReplayFailed` and `planWindowClipped`, so a starved pass shows amber.

#### Other checks

11. **H-2 is confirmed**, and Stripe's delivery timeout is shorter than our 60 s, so it is reachable. The plan pass closes it for plan events. For Connect, P-8b only lists the event (AM-4); recovery is a manual Resend. Record this as follow-up FU-P8b-2, with the option of answering a non-2xx to an in-flight duplicate, decided with Offir. It also goes into the §9.5 notes.
12. **D3.1 replay safety.** The pass never replays a `completed` claim, but it can replay a `failed` `.deleted` event days later. **Binding on SX-2b:** the free-cohort move must be a target-state write, guarded by "still the current subscription", and must not depend on `subscription_ended` being new. A retry after a partial failure sees `duplicate` there. The repeat-cancel count must be keyed on the subscription or event id. P-8b adds a test: replaying one `.deleted` event twice produces one end row and one cohort change. TL tells the SX-2b owner.
13. **Step C** limits itself to events the dispatcher classifies as `plan`, and those events count against the cap and the deadline. If the dispatcher throws, the event is counted and skipped; the pass never stops on it.
14. **Stripe limits:** these are acceptable. All Stripe calls are sequential, every list is capped at 10 pages, and `complete: false` never produces an orphan finding.
15. **Admin routes:** `requireAdmin` is the first statement. The GET validates its query with strict Zod, and the POST takes an empty strict body. Both routes have tests for 401, 403 and invalid input. SR-8 holds: no account id is taken from any input.
16. **Allow-lists:** every new file that imports `BusinessOsBillingAccountRepository` or `BusinessOsBillingEventRepository` (deps, read repository, tests) is registered in the `ALLOWED` arrays of both `BusinessOsBilling*Repository.test.ts` files. The AM-2 entitlements import is registered per `business-os-entitlements`.
17. **CI time and EC-3:** both pass. The new tests are unit tests only, with no new job and no new `process.env` read.
18. **P-6a follow-up F-1** (`replaceCustomer` keeps stale columns) is still unplaced. TL decides whether it goes in P-8b.2 or elsewhere.

#### Business questions

B-1 (flag only) and B-2 (failures stay until someone acts) **do not change the design**. Both defaults match it. If the user chose auto-fix in B-1, Step B would need a write path, and it would come back to SA.

#### Approval

[x] Workplan approved with changes. Proceed with P-8b.1 once rulings 1, 2 and 6 are reflected in §4.1 and §8.

## Implementation Notes (P-8b.1)

**Code complete 2026-10-27, uncommitted, on `feature/bos-plan-payments-p8b` (base `b088b51d`).** No migration, no new `process.env` read, no plan-handler file touched.

| File | Change |
|---|---|
| `lib/repositories/ProcessedWebhookEventRepository.ts` | `STALE_CLAIM_AGE_MS` (15 min) and `reclaimStale(eventId, cutoffIso)`: one conditional UPDATE with `{ count: 'exact' }`, `.eq(event_id).eq(status,'processing').lt(processed_at, cutoff)`; `won` only on `count === 1`; error passed through with `data: null`. Header and `markFailed` comment updated |
| `app/api/stripe/webhook/route.ts` | the `processing` branch only: reclaim; not won or error → 200 duplicate as before (error logged); won → `warn` `{ event: 'bos_webhook_stale_claim_reclaimed' }`, `processedEventId` set, processed as a new claim. The `failed` branch becomes `else if` and is otherwise unchanged (ruling 6) |
| `connectPath.characterisation.test.ts` + `.snap` | `sanitise` gains the `<NOW-15MIN>` band; new 9d, 9e snapshots; non-snapshot tests for rulings 1a, 1b, 1c, the warn line, and a reclaim error |
| `routerPlacement.guard.test.ts` | `reclaimStale` added to the claim methods POST calls exactly once (ruling 2) |
| `ProcessedWebhookEventRepository.test.ts` | `reclaimStale` chain, win only on count 1 (0, 2, null, undefined lose), error pass-through, 15-min constant, unscoped marker; `lt` added to the recording client |

**Deviation D-1.** The workplan listed a separate `staleClaim.qa.test.ts`. The reclaim matrix lives in the harness file instead, as non-snapshot tests, because it needs the harness's recording mocks. Covered: fresh → duplicate (9b), stale won → processed and completed (9d), lost → duplicate (9e), error → duplicate. The `completed` and `failed` paths are unchanged (9a, 9c byte-identical).

**Connect evidence (SA ruling 1).**
- (a) 9b: one added effect, the update `[update {status, failure_message, processed_at:<NOW>}, {count:'exact'}] .eq(event_id) .eq(status,'processing') .lt(processed_at,<NOW-15MIN>)`, not won; the response stays `{ received: true, duplicate: true }`, 200 (the `--ci` diff showed +34 lines, −0).
- (b) The 9d ≡ 6b test passes: removing the reclaim (index 2) from 9d and the `insertClaim` (index 2) from 6b leaves identical JSON.
- (c) 9e records only `findClaim` and the reclaim; no handler effect.
- (d) Re-recording: 9b by `-t "9b. an in-flight delivery" -u` (1 updated, 149 skipped), then 9d and 9e written new with `--ci=false -t` (2 written). Never a whole-file `-u`.

Per-export checksums, computed by evaluating the `.snap` and taking the md5 of each export:

| | Count |
|---|---|
| Exports before | 109 |
| Exports after | 111 |
| Identical | 108 |
| Changed | 1: 9b, `ac9c310535817a108cb52372aa8560e1` → `3616e03e4991ac275d4e4ed455da5481` |
| Added | 2: 9d `be6048a8a39fa9412d65d9b37c349d3d`; 9e `3616e03e4991ac275d4e4ed455da5481` (identical to the new 9b, as expected: same effects, same answer) |
| Removed | 0 |

Snapshot file md5: **before `ab7528ea68309cffb309ffbd46c455ab`, after `edb475942e84b1c872b17f7f33fc3f9a`**. `git diff` on the `.snap`: 232 insertions, 0 deletions.

**Gates (run sequentially, 2026-10-27).**

| Gate | Result |
|---|---|
| Connect harness `--ci` | 152 / 152 tests, 111 / 111 snapshots |
| `app/api/stripe` | 22 suites, 588 tests, 111 snapshots, all pass |
| `lib/business-os/billing` | 50 suites, 3,840 tests, all pass |
| `lib/repositories` (incl. `BusinessOsBillingAccountRepository.test.ts`, `BusinessOsBillingEventRepository.test.ts` allow-lists) | 124 suites, 2,963 tests, all pass |
| `lib/admin/environment` | 4 suites, 134 tests, all pass |
| `lib/server` | 11 suites, 148 tests, all pass |
| `npm run test:bos-entitlements` | 319 suites, 9,566 tests, all pass |
| `tsc --noEmit` (full project, 8 GB heap) | completed with diagnostics printed (no OOM); 1,849 pre-existing errors, **0 in touched files** |
| ESLint on the 5 touched code files | 0 errors; 6 pre-existing warnings in `route.ts`, none on changed lines |

**Owed before merge:** SA code review; QA; RM names the Connect change in the PR body (ruling 1e). Follow-ups: FU-P8b-1 (route's conditional `reclaimFailed`), FU-P8b-2 (Connect in-flight duplicate answering non-2xx, with Offir; also into the §9.5 notes).

### SA code review: P-8b.1

**Code Review by SA, 2026-10-27**
**Status:** Code Approved

Checked: the uncommitted diff (route `processing` branch, `reclaimStale`, both test files, `routerPlacement.guard`, the `.snap`). Per-export checksums recomputed independently from `git show HEAD:` against the working copy: 109 -> 111 exports, 108 identical, 9b changed, 9d and 9e added, 0 removed; file md5 `edb475942e84b1c872b17f7f33fc3f9a` confirmed. The 9b diff is +34 / -0, one update effect, response unchanged.

1. Ruling 1 (a) to (d) met. (b) is asserted in a test, not only by snapshot. (e) is owed by RM in the PR body.
2. Lease: `insertClaim` and `reclaimFailed` both write `processed_at`, so the age test is valid; `reclaimStale` resets it to now, which is the lease renewal for the winner. `complete` and `markFailed` never touch it, and `.eq('status','processing')` keeps `completed` and `failed` rows out.
3. Race: the conditional UPDATE is row-locked; the loser re-evaluates the WHERE against the fresh `processed_at`, gets count 0, answers duplicate.
4. The `<NOW-15MIN>` band (+-1 min) cannot mask a wrong age: the constant is pinned to 15 min by the repository test, and a cutoff outside the band prints raw and fails.
5. Standards pass: Pino context-first, unscoped marker (test-pinned), no `.select` / `.or`, guard updated, allow-lists untouched, unit tests only (no CI time).

Low (informational): a legacy row with NULL `processed_at` never matches `.lt` and stays stuck as today; no regression.

**Code Approved for QA: Yes**

## Implementation Notes (P-8b.2)

**Code complete 2026-10-28, uncommitted, on `feature/bos-plan-payments-p8b2`** (cut from P-8b.1 at `66189df1`; P-8b.1 is PR #555, on auto-merge). Option A: **no migration**, no new `process.env` read, no change to `planPaymentApply.ts` or `planSubscriptionMirror.ts`, no change to the webhook route.

| File | Change |
|---|---|
| `lib/business-os/billing/planReconcilePass.ts` (new) | The pass, pure given its ports. Step A replay, Step C unassigned paid invoices, Step B Stripe vs records; window per ruling 8; one `settleClaim` helper; `runOnWonClaim` the only handler call |
| `lib/business-os/billing/planReconcileDeps.ts` (new, `server-only`) | Production wiring, loaded lazily on the first run (importing it creates no client): the webhook's own `dispatchBusinessOsEvent`, `handlePlanBillingEvent`, `PLAN_HANDLER_EVENT_TYPES`, `STALE_CLAIM_AGE_MS`, `STRIPE_API_VERSION` |
| `lib/business-os/billing/reconcilePasses.ts` | `RECONCILE_PASSES = [boostReconcilePass, planReconcilePass]` |
| `lib/business-os/billing/planBillingHandler.ts` | Exports `PLAN_HANDLER_EVENT_TYPES` (all 7, ruling 3). The switch is unchanged |
| `lib/repositories/ProcessedWebhookEventRepository.ts` | `reclaimFailedIfStillFailed` (ruling 2): one UPDATE, `{ count: 'exact' }`, `.eq(event_id).eq(status,'failed')`, won only on count 1; CALLERS line names the pass |
| `lib/repositories/PlanReconcileReadRepository.ts` (new, read-only) | `listRecentReconcileRunsAllJobs`, `listPlanSubscriptionRowsAllAccounts`, `findRecordedPlanPaymentsAllAccounts` (ruling 9) |
| `lib/stripe/StripeService.ts` | `listBusinessOsPlanEvents`, `listBusinessOsSubscriptionsByPrice`: 100 per page, 10 pages, `complete: false` at the cap, platform only |
| `lib/cron/bosCronJobs.ts` | 13 plan counts; `partlyDoneWhen` adds `planIncomplete`, `planDeadlineHit`, `planReplayFailed`, `planWindowClipped` (ruling 10) and `planCheckIncomplete`; description names plans |
| `lib/repositories/BusinessOsBillingAccountRepository.ts` | **F-1** (TL decision 11): `replaceCustomer` clears every subscription-scoped column of the 20261025 grant, the same set as `attachTestClockCustomer` (SA C-6); `founder_discount_applied_at` kept |

**SA rulings honoured.**

| Ruling | How |
|---|---|
| 2 (drain, no new RPC) | Lease = unique insert, `reclaimFailedIfStillFailed`, `reclaimStale`. The pass never calls `reclaimFailed`; the handler runs only in `runOnWonClaim(event, attempt.won)`; `complete` / `markFailed` only in `settleClaim`. Pinned by `planReconcilePass.guard.test.ts` (AST). CALLERS line updated |
| 3 (replay Stripe's events) | All 7 types, from `PLAN_HANDLER_EVENT_TYPES` only (a guard pins the constant to the switch's case labels both ways, and the wiring's `eventTypes` to that constant); `api_version !== STRIPE_API_VERSION` skipped and counted (`planApiVersionSkipped`); oldest first (`created`, then id) |
| 4 (option A) | No migration; Steps B and C never write (tests assert no claim call and no handler call) |
| 8 (window) | Anchor = newest finished run whose plan counts show `planIncomplete`, `planDeadlineHit`, `passesFailed` (and `planReplayFailed`, D-3) all 0, minus 1 h; never more than 7 days (`planWindowClipped`); 3 days when no plan-pass run exists |
| 10 (amber) | `partlyDoneWhen` for the four named counts (+ `planCheckIncomplete`) |
| 12 (D3.1) | `planReconcilePass.d31.test.ts`: the REAL handler and mirror behind the pass; a failed `.deleted` replayed by two runs gives one end row and one plan change; a partial failure's retry sees the duplicate |
| 13 (Step C scope) | Only dispatcher-`plan` events, counted against the 100 cap and the deadline; a dispatcher throw is counted and skipped |
| 14 (Stripe limits) | Sequential calls, 10-page cap; `complete: false` produces no orphan and no not-listed finding |
| 16 (allow-lists) | `planReconcilePass.d31.test.ts` and `PlanReconcileReadRepository.test.ts` registered, sorted, in both `BusinessOsBilling*Repository.test.ts` lists |
| 17 (CI, EC-3) | Unit tests only; no new env read |
| 18 / TL 11 (F-1) | Done, above |

**Deviations (for SA).**

- **D-2 (Stripe list shape).** Step B lists with Stripe's default status (every subscription not cancelled) instead of `status: 'all'`, so cancelled history never fills the 10-page cap. `incomplete` and `incomplete_expired` are never orphans (a checkout still settling).
- **D-3 (window anchor).** (a) A `partial` run may anchor, not only `succeeded`: `partlyDoneWhen` turns any boost deferral, and any clipped window, into `partial`, so "succeeded only" would keep a clipped window clipped for ever. Whether the plan pass finished is read from its own counts. (b) `planReplayFailed` also blocks anchoring, so a replay that failed (claim left `failed`, or a dispatch / claim step that failed before any claim) is listed again until it succeeds or ages past 7 days (then `planWindowClipped` shows amber). An event seen `processing` and fresh sets `planIncomplete`, for the same reason.
- **D-4 (counts).** The run record's `counts` CHECK allows 1,024 bytes, shared with boost's 23 counts. §4.2's list plus the rulings' would not fit, so the plan pass records 13: `planEventsSeen`, `planReplayed`, `planReplayFailed`, `planSkippedNotPlan` (includes the other-mode skips), `planApiVersionSkipped`, `planStaleReclaimed`, `planMismatch`, `planOrphan`, `planUnassigned`, `planIncomplete`, `planDeadlineHit`, `planWindowClipped`, `planCheckIncomplete` (Step B or C, or the run history, not read in full). Worst case with every count at 5 digits is 963 bytes, under 1,024 (test-pinned). About 60 bytes are left (SA-corrected figure): any further key on this job, or a third pass, needs a `counts` migration and SA.
- **D-5 (where the reads live).** The cron-run read is in `PlanReconcileReadRepository`, not `BosCronRunRepository.lastSucceededStart`: that repository's guard allows only the recorder to name it. The money history check is there too, not on `BusinessOsBillingEventRepository` (ruling 9). It is the fourth reader of `business_os_billing_accounts` (guard list updated).
- **D-6 (plan rows).** Read through the existing `businessOsAccountPlanRepository.findEntitlementInputsBatch` (chunks of 100). Registered in RC-15 (`ALLOWED` + `NO_STATE_WRITE_REFERRERS`), with a pin that it calls that one method only.
- **D-7 (Step B, one finding per root difference).** The plan-row checks (`plan_tier_differs`, `plan_paid_through_differs`) are skipped when the mirror already differs from Stripe on the same fact, so a price swapped in the dashboard is one finding, not two. The period and the paid-through date are compared only while Stripe says `active` (not `past_due`: a failed renewal moves Stripe's period ahead by design) and the current period started over 24 hours ago (its paid invoice may still be on the way).
- **D-8 (SR-3 guard).** The wiring calls `dispatchBusinessOsEvent`, so `routerPlacement.guard`'s "router called from the route only" list gains `planReconcileDeps.ts`, with the reason. Its billing-placement map gains the wiring's three repository imports. The pass itself imports no repository.
- **D-9 (F-1 guard).** The "current_period_end written only by the paid apply" source test now admits two CLEARING writers (`replaceCustomer`, `attachTestClockCustomer`) and asserts each writes `null`.
- **D-10.** §3 said "no change to `planBillingHandler.ts`"; ruling 3 requires the exported type set there, so that is the only change to it.
- **Test harness changes.** `runRecord.adoption.test.ts`: its `StripeService` mock gains the two list methods (empty), so "nothing to do" stays a `succeeded` run. Connect harness: not touched; `--ci` 152 / 152, 111 / 111 snapshots, `.snap` unchanged in git.

**Tests and gates (2026-10-28, run sequentially).**

| Gate | Result |
|---|---|
| New: `planReconcilePass.test.ts`, `.guard.test.ts`, `.d31.test.ts`, `PlanReconcileReadRepository.test.ts`, `businessOsPlanReconcileReads.test.ts`, plus `ProcessedWebhookEventRepository.test.ts` | 6 suites, 125 tests, pass |
| `lib/business-os/billing` + `lib/business-os/boost` | 67 suites, 4,545 tests, pass |
| `lib/repositories`, `lib/cron`, `lib/stripe`, `app/api/stripe`, `app/api/cron`, `app/api/admin/business-os/credits` | 178 suites, 4,389 tests, 118 snapshots, pass (after the adoption-test mock and the RC-15 registration) |
| `app/admin`, `lib/admin` (incl. EC-3 catalogue), `lib/server` | 242 suites, 7,580 tests, pass |
| `npm run test:bos-entitlements` | 321 suites, 9,626 tests, pass |
| Guards named in the brief | `routerPlacement.guard`, `oneDontRenewPath.guard`, `catalogueDrift.guard` (EC-3), both `BusinessOsBilling*Repository` allow-lists, RC-15: all pass |
| `tsc --noEmit` (full project, 8 GB heap) | completed (no OOM); 1,864 pre-existing errors, **0 in touched files** |
| ESLint on the touched code and new test files | 0 errors, 0 warnings |

**Owed:** SA code review; QA; the §10 / §9 sandbox demo (Step 4) in test mode, by Dev or QA, after SA review.

### SA code review: P-8b.2

**Code Review by SA, 2026-10-28**
**Status:** APPROVED WITH FIXES. Fixes 1 to 4 below are required before QA. They are small and local to `planReconcilePass.ts`, `PlanReconcileReadRepository.ts` / its wiring and `bosCronJobs.ts`, each with a unit test. SA re-checks the diff of the fixes only.

Checked: the full uncommitted diff and the 8 untracked files on `feature/bos-plan-payments-p8b2`, against the P-8b.2 row and rulings 1 to 18. Re-ran the 9 new or touched suites (331 tests, pass). The Connect `.snap` and `app/api/stripe/webhook/route.ts` are unchanged in git. Schema claims checked against migrations `20261025` (billing accounts: `livemode`, `bought_tier`, `ended_at`) and `20261027` (billing events: `livemode`, `kind`, `stripe_event_id` UNIQUE, `stripe_invoice_id`).

#### Verified

| Check | Result |
|---|---|
| Handler only on a won claim | Yes. `WonClaim` is built only in `takeClaim`; `deps.handle` is called once, inside `runOnWonClaim(event, attempt.won)`; AST-pinned |
| Settle only through `settleClaim` | Yes. `complete` and `markFailed` each appear once, inside `settleClaim`; AST-pinned |
| `reclaimFailedIfStillFailed` | One UPDATE, `{ count: 'exact' }`, `.eq(event_id).eq(status,'failed')`, won only on `count === 1`; no `.select()`, no `.or()`. The unconditional `reclaimFailed` is absent from the port type and from both files (pinned) |
| No orphan when a list is not complete | Yes. A page cap, a Stripe throw, or the deadline in the price loop all clear `listsComplete`, which gates both `orphan` and `subscription_not_listed`. The billing-row read errors at its 20,000 ceiling rather than returning a cut list |
| Tenant isolation (SR-8) | Holds. No account id from input. The service-role reads are documented, mode-filtered, column-limited, and named `…AllAccounts`. Plan-row ids come from our own billing rows. The pass's only own writes are claim rows, with the same `metadata` shape as the route's |
| PII / logging / TS | Findings carry the kind and Stripe or billing-row ids only. No `console`. Pino context comes first. There is no `any`; casts are confined to Supabase row typing |
| Repository pattern | The pass imports no repository (pinned). The wiring reaches the database only through `lib/repositories/` |
| F-1 | `replaceCustomer` writes exactly the `20261025` UPDATE grant minus `founder_discount_applied_at`, identical to `attachTestClockCustomer`. This is pinned against the migration text, not a hand list |
| Connect | Unchanged. The `.snap` is untouched, there is no `Stripe-Account` header on either list, and the route is not edited |

#### Rulings on the deviations

- **D-2 / D-7: approved, all parts.**
  - One finding per root difference for the plan-row checks.
  - Period and paid-through are compared only while Stripe says `active` and the period is more than 24 hours old.
  - Stripe's default status listing is used. An open row whose subscription Stripe no longer lists (for example, cancelled at Stripe) is still surfaced, as `subscription_not_listed`, and only from complete lists.
  - `incomplete` and `incomplete_expired` are never orphans.
- **D-3: approved, both parts.**
  - (a) A `partial` run may anchor when its plan counts are clean. `passesFailed` still blocks.
  - (b) `planReplayFailed` blocks the anchor, and a fresh in-flight claim sets `planIncomplete`.
  - The principle behind (b) is extended by fixes 1 and 2. A deterministically failing event holds the window back for up to 7 days and then shows as `planWindowClipped`. That is acceptable, because it is amber the whole time.
- **D-4: approved, with a corrected figure.** With the 36 keys of this job and every value at 5 digits, the jsonb text is **963 bytes**, so about 60 bytes are left, not about 100. Plan counts are bounded (events ≤ 1,000 per run). Any further key on this job, or a third pass, needs a `counts` migration and comes to SA.
- **D-5: approved.** `BosCronRunRepository` stays the recorder's alone.
- **D-6: approved.** It reuses `findEntitlementInputsBatch` in chunks of 100 (equal to `BOS_ENTITLEMENT_BATCH_LIMIT`), is registered in RC-15 `ALLOWED` and `NO_STATE_WRITE_REFERRERS`, and is pinned to that one method. It reads the override join it does not need; that is acceptable reuse.
- **D-8: approved.** The wiring classifies through the same dispatcher, and it is not a second endpoint. The guard still pins the exact list.
- **D-9: approved.** The test now asserts that both clearing writers write the literal `null` and that there are exactly two of them.
- **D-10: approved.** Only the constant is exported. The switch is unchanged, and the set is pinned to the case labels in both directions.

#### Code Review Comments (fixes required)

1. **`planReconcilePass.ts` `stepA`: every lost claim must block the anchor. Priority: High.** Today only `lost: 'in_flight'` sets `incomplete`. `lost: 'raced'` covers two cases: an insert `23505`, and `reclaimFailedIfStillFailed` with count 0. In both, another actor holds the event **in flight**, and it may still fail. That actor can be:
   - a live delivery whose retry later fails;
   - the P-8b.3 "Reconcile plan payments now" run, which by design never writes `bos_cron_runs`, so its `planReplayFailed` never blocks anything;
   - an overlapping dev `GET`.

   If the cron run's own counts are clean, the window then moves past an event left `failed` that Stripe may no longer retry. **Fix:** set `counts.incomplete = 1` on every `lost` outcome. Test both race shapes.
2. **`settleClaim` / `runOnWonClaim`: a claim that could not be settled must block the anchor. Priority: Medium.** If the handler returns but `complete()` fails, the row stays `processing` and the run counts `replayed` with clean counts. The window moves on, and that row is never relisted, never reclaimed by anyone, and shows as Stuck on AM-4 for ever. **Fix:**
   - `settleClaim` returns whether the write landed.
   - On a failed settle, set `incomplete = 1`. The next run then relists the event, reclaims it as stale after 15 minutes and re-runs the idempotent handler.
   - Test the complete-fails and the markFailed-fails cases.
3. **`planReconcileWindow` and the run read lookback: the 3-day "first night" window can skip days. Priority: Medium.** The pass asks for runs since `now − 7 days`, so "no plan-pass run" also means "the plan pass ran, but not within 7 days". That happens if the cron was down for more than a week, or if every run in the week was recorded `failed`. That case gets 3 days, **unclipped and green**, silently skipping days 3 to 7. **Fix:**
   - Read the run history over Stripe's 30-day event retention (keep the 50-row limit). `first_run` applies only when no plan-pass run exists in that range.
   - The anchor stays capped at 7 days (`windowClipped`).
   - Test: a single clean plan run 10 days ago gives 7 days, clipped.
4. **`bosCronJobs.ts` `partlyDoneWhen`: add `planApiVersionSkipped` (atLeast 1). Priority: Medium.** Events read through `events.list` carry the `api_version` they were rendered at when created, which is the account's version then, not the webhook endpoint's pinned one. If the platform account's default version is not `STRIPE_API_VERSION` (`2025-10-29.clover`), every event is skipped and the pass replays nothing while the run shows green. Making it amber is free (no counts bytes), and it extends ruling 10. Pin it in the existing ruling-10 test. **Also binding on Step 4 (sandbox demo):** record the test account's default API version, and show `planApiVersionSkipped = 0` on the replayed event. If the versions differ, stop and bring it to SA before P-8b.3.

#### Optimisation suggestions (non-blocking)

- A Step C read failure (`recordedPayments`) does not block the anchor, so those paid invoices are not re-checked. That is acceptable for a flag-only check. Note it in the pass header.
- One missed `invoice.paid` (row `past_due`, Stripe `active`) can raise both `status_differs` and `period_differs`. The one-root rule covers only the plan-row checks. That is acceptable; the findings are flags.
- Replayed events are audited by the handler with `source: 'stripe_webhook'`. When the handler freeze (D-10, §11 R-2) lifts, consider a `plan_reconcile` source. Follow-up only.

**Code Approved for QA: Yes, once fixes 1 to 4 land** (SA re-checks the fix diff only; no full re-review).

### Fixes after SA code review (P-8b.2)

**Dev, 2026-10-28.** Fixes 1 to 4 applied in `feature/bos-plan-payments-p8b2`, uncommitted.

| Fix | Change | Test |
|---|---|---|
| 1 (High) | `stepA`: EVERY `lost` claim sets `incomplete = 1` (insert `23505`, `reclaimFailedIfStillFailed` count 0, and `reclaimStale` not won) | The insert race now asserts `incomplete: 1`; new test for a lost conditional failed-reclaim (no handler, `replayFailed: 0`, `incomplete: 1`) |
| 2 (Medium) | `settleClaim` returns whether the write landed; `runOnWonClaim` returns `{ handled, settled }`; an unsettled claim sets `incomplete = 1` | Two cases: `complete()` fails after the handler returned, `markFailed()` fails after it threw (row stays `processing`, one `bos_plan_reconcile_claim_not_settled`, `incomplete: 1`); a control asserts a settled replay stays `incomplete: 0` |
| 3 (Medium) | Run history read over 30 days (`PLAN_RECONCILE_LIMITS.RUN_HISTORY_MS`), 50-row limit kept; the anchor stays capped at 7 days. `first_run` only when no plan-pass run is in those 30 days | One clean plan run 10 days ago → 7 days, clipped, `anchored`; the pass asks for runs since `now − 30 days` |
| 4 (Medium) | `bosCronJobs.ts` `partlyDoneWhen` gains `planApiVersionSkipped` (atLeast 1) | Pinned in the ruling-10 registry test |
| Note | Pass header records that a Step C read failure is amber (`checkIncomplete`) but does not hold the window back | — |

Residual, for SA's information (not fixed, not asked): the run read selects `succeeded` and `partial` runs only. A `failed` run's counts are `{}`, so if every run in 30 days was recorded `failed`, the window falls back to the 3-day first-night window.

**Gates after the fixes (sequential).**

| Gate | Result |
|---|---|
| The three `planReconcilePass*` suites | 74 tests, pass |
| `lib/business-os/billing`, `lib/business-os/boost`, `lib/repositories`, `lib/cron`, `lib/stripe`, `app/api/stripe`, `app/api/cron`, `lib/admin/environment` | 244 suites, 8,943 tests, 118 snapshots, pass |
| Connect harness `--ci` | 152 / 152, 111 / 111 snapshots; `.snap` unchanged in git |
| Billing allow-list guards (both `BusinessOsBilling*Repository.test.ts`) | pass |
| `npm run test:bos-entitlements` | 321 suites, 9,626 tests, pass |
| `tsc --noEmit` (full project, 8 GB heap) | completed (no OOM); 1,864 pre-existing errors, 0 in touched files |
| ESLint on the fixed files | 0 errors, 0 warnings |

**Step 4 sandbox demo: STOPPED at the API-version check (binding condition of SA fix 4).**

- **What ran.** One read-only probe against the Stripe TEST account. The key came from the local test env file and was passed inline, never printed. The database env was pointed at an unreachable address (`127.0.0.1:9`), so no database call was possible. No Stripe write and no database write. The pass itself was **not** run: the versions differ, so the brief says stop.
- **Account:** `acct_1UPKR4C7KDUGYIcA` (the standard test sandbox). It has **no webhook endpoints** registered (local demos use `stripe listen`).
- **Events listed with the handler's 7 types** (`PLAN_HANDLER_EVENT_TYPES`, read from the handler source):
  - Last 3 days: 87.
  - Last 7 days: 87.
  - Last 30 days: 163 (65 `customer.subscription.updated`, 43 `invoice.paid`, 28 `customer.subscription.deleted`, 22 `invoice.payment_failed`, 3 `invoice.payment_action_required`, 2 `checkout.session.completed`).
  - **Every one has `api_version: 2026-09-30.endive`**, and `livemode: false`.
- **The account's default API version is therefore `2026-09-30.endive`**: `events.list` renders each event at the version the account had when the event was created. `STRIPE_API_VERSION` is `2025-10-29.clover`.
- **Consequence:** on this account the pass would skip all 163 events. `planApiVersionSkipped` would be 163, nothing would be replayed, and the run would now show amber (fix 4).
- **For SA before P-8b.3:**
  - Either move the handler's pinned version (and `StripeService` / `stripeClient`) to `2026-09-30.endive`,
  - or accept a set of versions the handler was checked against (§9.5 row 9 already names `2025-09-30.clover` and `2026-09-30.endive` for the endpoint),
  - or re-render the replayed event at the pinned version (`events.retrieve` does not do this).
  - Production's default version is unknown to Dev.
  - Dev made no workaround.

### SA re-review: P-8b.2 fixes, and the API-version ruling

**SA, 2026-10-28**
**Status:** Fixes 1 to 4 APPROVED. The residual gap is ACCEPTED. The API-version question is ruled below as **option (b), per type**, and it is BLOCKING: the slice goes to QA and the Step 4 demo only after items V-1 to V-5 land.

#### Fixes 1 to 4: approved

Re-checked the fix diff only. Re-ran `planReconcilePass*` and `lib/cron`: 277 tests, pass.

| Fix | Verdict |
|---|---|
| 1 | Correct. Every `lost` outcome sets `incomplete` (the `23505` insert race, a lost conditional failed-reclaim, a lost stale reclaim); `replayFailed` is not touched. Both race shapes are tested |
| 2 | Correct. `settleClaim` returns whether the write landed. `runOnWonClaim` returns `{ handled, settled }`, and an unsettled claim sets `incomplete` whether the handler returned or threw. A control test checks that a settled replay stays clean. The guard's single-call pins still hold |
| 3 | Correct. History is read over 30 days (`RUN_HISTORY_MS`) with the 50-row limit kept. The anchor stays capped at 7 days, and `first_run` applies only when no plan-pass run exists in those 30 days |
| 4 | Correct. `planApiVersionSkipped` is in `partlyDoneWhen` and pinned |

#### Residual gap (30 days of only `failed` runs falls back to 3 days): accepted, no fix

- The loss is bounded. The window is never wider than 7 days, so the extra loss is events from days 3 to 7 back. It needs every run for 30 days to be recorded `failed`.
- Each of those runs is **red** on the Jobs page, which is louder than the amber this slice adds. Thirty red days is an incident someone acts on.
- Recovery exists: the P-8b.3 button, or a Stripe "Resend".
- A `failed` run carries no counts, so it cannot be told apart from a boost-only run before this deploy.
- Record it as a known limitation in the pass header (one sentence). Nothing else.

#### API version ruling (BLOCKING): option (b), per (version, event type), tied to captured evidence

**What is true, and how I checked it.** I had no web search in this session, so the Stripe changelog between `2025-10-29.clover` and `2026-09-30.endive` was **not** read. Stripe ships breaking changes only in its twice-yearly major releases, and clover to endive crosses at least one of them, so equal shapes cannot be assumed from the names. The deciding evidence is in the repo instead. `planStripeFields.c6.test.ts` checks every fixture in `fixtures/stripe/` against the handler's §3.7 list of fields it reads (`FIELDS_READ`), and that test passes today:

| Event type | `2025-09-30.clover` (captured) | `2025-10-29.clover` (the SDK pin, hand-built) | `2026-09-30.endive` (captured, P-6a / P-7b.1) |
|---|---|---|---|
| `invoice.paid` | yes | yes | yes (several) |
| `invoice.payment_failed` | — | yes | yes |
| `invoice.payment_action_required` | — | (none) | yes |
| `customer.subscription.updated` | — | yes | yes |
| `customer.subscription.deleted` | yes | yes | yes |
| `checkout.session.completed` | yes | yes | **no** |
| `checkout.session.expired` | — | yes | **no** |

**Webhook versus `events.list`.** These are two different renderings:
- A webhook endpoint created with an API version receives events at that version. Without one, it receives them at the account default.
- `events.list` returns each event as stored: rendered at the account's default version when the event was created, and stamped in `event.api_version`. The request's own `Stripe-Version` does not re-render it.
- The repo bears this out. The sandbox has no endpoint, and both `stripe listen` and `events.list` gave `endive`. Production's test account endpoint on `2025-09-30.clover` delivered clover.
- So a replay can be in a different shape from the live delivery of the same event. That is exactly why the gate stays, keyed on the event's own `api_version`.
- The handler's own follow-up reads (subscription retrieve, invoice lines, invoice payments) go through the SDK at the pin, whatever the event's version. That is already how live endive deliveries are handled (§9.1.2 F-4).

**Rejected:**
- **(a), moving the pin.** It changes every outbound Stripe call platform-wide (Connect, boost, checkout, the Connect harness) and probably needs a `stripe` package upgrade, which is outside P-8b. It would not even help: events already created stay rendered at the version they were created with. If wanted, it is its own stream with SA review.
- **A per-shape detector.** It would be a second parser of Stripe payloads that drifts from `FIELDS_READ`. The evidence-backed allow-list is simpler and cannot accept a shape nobody checked.
- **An exact single string.** It is wrong today: production's endpoint already delivers `2025-09-30.clover`, not the pin.

**Instructions for Dev (V-1 to V-5):**

- **V-1.** In `planBillingHandler.ts`, beside `PLAN_HANDLER_EVENT_TYPES` (this amends D-10 to two exports), add a readonly map `PLAN_HANDLER_VERIFIED_EVENT_SHAPES`, keyed by API version, whose value is the set of event types verified at that version:
  - `2025-10-29.clover`: all 7 (the pin). Hand-built fixtures cover 6 types. `invoice.payment_action_required` carries an invoice object, the same object as `invoice.payment_failed`, so it is verified by that fixture.
  - `2025-09-30.clover`: all 7. This is the same major as the pin, and Stripe's monthly releases within a major are additive. It is also what production's endpoint delivers today.
  - `2026-09-30.endive`: the 5 types captured above. Add `checkout.session.completed` only if V-3 captures it. Add `checkout.session.expired` only if a captured endive fixture exists.
  - A header comment says that adding a version or type requires a captured fixture at that version in `fixtures/stripe/` and SA review.
- **V-2.** In the pass, replace `event.api_version !== deps.apiVersion` with "the version is in the map **and** the type is in its set". Otherwise skip and count `apiVersionSkipped` (same key, no new bytes; relabel it "events at an unverified Stripe API version or shape").
  - Emit **one** summary `warn` per run listing the distinct skipped `(api_version, type)` pairs and their counts (no ids, no PII). Do not log one line per event.
  - The deps field `apiVersion` is replaced by the map. Update the guard and unit tests: a verified pair is replayed; an unverified version is skipped; a verified version with an unverified type (endive `checkout.session.expired`) is skipped.
- **V-3.** Capture one sandbox endive `checkout.session.completed` event, read-only (2 exist in the last 30 days on `acct_1UPKR4C7KDUGYIcA`). Scrub it as C-6 did, add it to `fixtures/stripe/` and `CAPTURED_OBJECTS`, and make sure the C-6 field check passes. Only then put the type into the endive set. Optional: an endive `checkout.session.expired`, by creating and expiring one test-mode session on the sandbox. If skipped, that pair stays unverified (amber if it ever appears).
- **V-4.** Add a ratchet test that, for every `(version, type)` in `PLAN_HANDLER_VERIFIED_EVENT_SHAPES`, at least one fixture of that type exists and passes the C-6 field check.
  - For endive, the fixture must be **captured at endive**.
  - For the two clover versions (one major), a fixture at either clover version counts, captured or hand-built.
  - At clover only, `invoice.payment_action_required` may be met by an `invoice.payment_failed` fixture (the same Stripe object). The test names that mapping with its reason. At endive, no substitution is allowed.
  - The allow-list then cannot grow without evidence.
- **V-5.** Ask the BA to amend requirement §9.5 row 9. Besides the production **endpoint's** version, production's **account default** API version must also be in `PLAN_HANDLER_VERIFIED_EVENT_SHAPES`. Otherwise the nightly replay skips everything and shows amber.

**What the Step 4 demo must show afterwards** (sandbox `acct_1UPKR4C7KDUGYIcA`, test mode):
1. The `api_version` of every replayed event (`2026-09-30.endive`), and `planApiVersionSkipped` equal only to the events of unverified pairs, with the summary line naming them (expected: 0, or the endive `checkout.session.expired` count).
2. An `invoice.paid` plan event whose claim was forced to stale `processing`, and one whose claim was deleted: each is replayed once, the plan row and money history are written once, and the claim is `completed`.
3. A second run: `planReplayed = 0`, no new money-history row.
4. A deliberate mismatch: exactly one `bos_plan_reconcile_finding`, `planMismatch = 1`.
5. Boost counts unchanged, and the run record's outcome and counts as stored in `bos_cron_runs`.

**Question for the user** (plain terms; a go-live item, **not** a merge blocker). With the gate, an unverified version can only cause skipped events and an amber run, never a wrong-shape replay. The question:

> "In the Stripe dashboard of the account our live site uses, open **Developers** and tell us the **API version** shown for the account. Then open **Webhooks**, find the endpoint that points at our site, and tell us the API version shown on it."

Production's test account delivered `2025-09-30.clover` when observed on 2026-10-06, which is in the verified set.

**Optional follow-up FU-P8b-3** (not this slice): the live webhook could apply the same map (it does not check the version today). That is a route change, and it needs the Connect evidence rules, so it is a separate SA decision.

**Code Approved for QA:** after V-1 to V-4 land and SA re-checks that diff only. Then the Step 4 demo runs.

### API-version ruling built, and the Step 4 demo (P-8b.2)

**Dev, 2026-10-28.** SA re-review items V-1 to V-5 are built in `feature/bos-plan-payments-p8b2`, uncommitted. The accepted failed-runs limitation is one sentence in the pass header.

| Item | Change |
|---|---|
| V-1 | `planBillingHandler.ts` exports `PLAN_HANDLER_VERIFIED_EVENT_SHAPES` beside `PLAN_HANDLER_EVENT_TYPES` (D-10 is now two exports). `2025-10-29.clover` and `2025-09-30.clover` map to all 7 types; `2026-09-30.endive` maps to 6 (the 5 captured before plus `checkout.session.completed` from V-3). A header comment says that a new pair needs a captured fixture and SA review. `checkout.session.expired` at endive stays unverified (no capture) |
| V-2 | The pass replays an event only when its own `(api_version, type)` is in the map; anything else adds to `apiVersionSkipped`. One `warn` per run, `bos_plan_reconcile_unverified_shapes`, lists `{ apiVersion, eventType, count }` with no ids. The deps field `apiVersion` is replaced by `verifiedShapes` (the wiring hands in the handler's map, and the guard pins it). The registry label now reads "events at an unverified Stripe API version or shape". Tests: a verified non-pin pair (endive `invoice.paid`) is replayed; an unverified version is skipped and never claimed; endive `checkout.session.expired` is skipped; the summary line is checked exactly |
| V-3 | Read-only capture from `acct_1UPKR4C7KDUGYIcA`: `captured-p8b2-event-checkout-session-completed-AhLSvR.json` (`evt_1UPnZgC7KDUGYIcAy4AhLSvR`, endive). **It is a payment-mode session.** The sandbox's only other endive `checkout.session.completed` in Stripe's 30-day retention, the subscription-mode one, belongs to `cus_VQf9jX6fnfVlkK`, so it was not read further or saved. The checkout session object, and all 7 fields the handler reads, are the same in both modes (`subscription` is present, set to null). Scrubbed: customer email, name, address, tax ids, `customer_email`, `return_url`, and the `purchase_id` metadata (a fake UUID). The C-6 field check passed **before** the type was added to the endive set. The `checkout_session` kind was already in `CAPTURED_OBJECTS`, so that set is unchanged (comment added). **For SA:** if a payment-mode session is not acceptable evidence, remove the one endive line; the ratchet then needs nothing more |
| V-4 | The ratchet lives in `planStripeFields.c6.test.ts`, beside the field check it reuses. Every pair in the map needs a passing event fixture of that type. Endive (and any non-clover) pairs need a capture at exactly that version. Either clover version counts for both clover versions. At clover only, `invoice.payment_action_required` may be met by `invoice.payment_failed`, because both carry the same invoice object; the test names this. Negative controls: endive `checkout.session.expired`, and an unknown version, have no evidence |
| V-5 | Requirement §9.5 row 9: production's **account default** API version must also be in the verified set (per SA ruling, P-8b.2). Change History row added |

**Gates after V-1 to V-5 (sequential).**

| Gate | Result |
|---|---|
| `lib/business-os/billing`, `lib/business-os/boost`, `lib/repositories`, `lib/cron`, `lib/stripe`, `app/api/stripe`, `app/api/cron`, `lib/admin/environment`, `app/admin` | 437 suites, 14,873 tests, 118 snapshots, all pass. This includes `planReconcilePass*` (76 tests) and `planStripeFields.c6` (91, with the 20 ratchet pairs) |
| Connect harness `--ci` | 152 / 152, 111 / 111 snapshots; the `.snap` is unchanged in git |
| Billing allow-list guards | pass |
| `npm run test:bos-entitlements` | 321 suites, 9,626 tests, all pass |
| `tsc --noEmit` (full project, 8 GB heap) | completed with no OOM; 1,864 pre-existing errors, 0 in touched files |
| ESLint, touched files | 0 errors, 0 warnings |

**Step 4 sandbox demo (2026-10-28), what was real and what was faked.**

- **REAL:**
  - Stripe test-mode reads on `acct_1UPKR4C7KDUGYIcA` through the real `StripeService`: `listBusinessOsPlanEvents`, `listBusinessOsSubscriptionsByPrice`, the price catalog's `prices.list`, and the handler's own reads (invoice lines, subscription retrieve).
  - The real `createPlanReconcilePass`, `planResolver`, `createPlanBillingHandler` with the real `applyPaidPlanInvoice`, `planPriceCatalog`, `getEntitlementConfig`, `PLAN_HANDLER_EVENT_TYPES` / `VERIFIED_EVENT_SHAPES`, the real cron registry, and the recorder's `extractCounts` / `isPartlyDone`.
  - The test key was passed inline and never printed, with `MSYS_NO_PATHCONV=1`.
- **FAKED (in memory):**
  - Every DB-side port: the claim table, the two billing records, the money history with the apply function (unique on the invoice), the plan-row writes, the plan rows for Step B, the cron run history (one clean run as the anchor) and the Step C lookups.
  - Also faked: the plan-change audit, the first-payment notifier, and the boost pass (fixed all-zero counts; the real boost pass reads and writes the production DB).
  - The Supabase env pointed at `127.0.0.1:9`, so no database call was possible.
  - **No database write and no Stripe write.**
  - Anything of `cus_VQf9jX6fnfVlkK` was dropped unprocessed by a wrapper on the Stripe port (0 events and 3 subscriptions dropped).

**SA's demo points.**

1. **API versions.** The window held 13 plan-type events, all at `2026-09-30.endive`, all verified pairs. `planApiVersionSkipped = 0`, so no summary line was emitted. The 30-day set has no `checkout.session.expired`. The unverified-pair summary line is shown in the unit test.
2. **Replays.**
   - A, `evt_1UVAUSC7KDUGYIcAl7GFg5DT` (`invoice.paid`, endive), claim forced to stale `processing`: `reclaimStale`, then `complete`.
   - B, `evt_1UVAU4C7KDUGYIcAUyPHpUn8` (`invoice.paid`, endive), claim deleted: `insert`, then `complete`.
   - Each was replayed once. Each wrote one `invoice_paid` money-history row (`in_1UVAU8C7KDUGYIcAIEXykR1C`, `in_1UVAU1C7KDUGYIcAQhUicI6w`) and one plan-row write (`basic`). Both claims ended `completed`.
   - Run 1 counts: `planEventsSeen 13, planReplayed 2, planStaleReclaimed 1`; all others 0.
   - The handler's real apply path ran to `applied`, with no refusal and no error lines.
3. **Second run.** `planReplayed 0`, no claim call, 0 new money-history rows, 0 plan writes.
4. **Deliberate mismatch: NOT SHOWN on real data.** After dropping the forbidden customer, the sandbox has **0** non-cancelled plan subscriptions; the 3 it has all belong to `cus_VQf9jX6fnfVlkK`. Planting a mismatch would need that customer or a new Stripe subscription (a Stripe write), so per the brief it was not worked around. Step B ran on 0 subscriptions: `planMismatch 0, planOrphan 0, planCheckIncomplete 0`. The behaviour is covered by the unit tests (each finding kind, `planMismatch = 1`).
5. **Boost counts and the run record.** Boost counts are identical to the boost pass's output in both runs. What would be stored in `bos_cron_runs` (not written): outcome `succeeded` in both runs, 36 keys, 820 bytes.
   - Run 1: `planEventsSeen 13, planReplayed 2, planStaleReclaimed 1`, every other plan and boost count 0, `passesRun 2, passesFailed 0`.
   - Run 2: the same with `planReplayed 0, planStaleReclaimed 0`.

### SA check: V-1 to V-5 and the Step 4 demo (P-8b.2)

**SA, 2026-10-28**
**Status:** APPROVED. **Ready for QA**, with one QA condition (Q-C1) and two follow-ups recorded.

**What I re-checked: the diff of V-1 to V-5 only.**

| Item | Verdict |
|---|---|
| V-1 | Correct. `PLAN_HANDLER_VERIFIED_EVENT_SHAPES` sits beside the type set, and its header names the evidence rule. Both clover versions get all 7 types; endive gets the 6 captured ones; endive `checkout.session.expired` is left out |
| V-2 | Correct. `isVerifiedShape` uses an own-property lookup (no prototype keys), and a missing `api_version` fails closed. The check runs before any claim or dispatch, so an unverified event is never claimed. There is one summary `warn` per run, with no ids; it is also emitted when the loop stops at the deadline or the batch cap. Unverified skips do not block the anchor, which is right: they are permanent, and the run shows amber |
| V-3 | Accepted. See ruling A |
| V-4 | Correct. The ratchet reuses the C-6 field check. A non-clover pair needs a capture at exactly that version. The one clover substitution is named with its reason. The negative controls bite |
| V-5 | Done (requirement §9.5 row 9) |
| Fixture privacy | The capture is scrubbed (email, name, address, phone, URLs, client secret; metadata ids replaced with fakes), and its `_fixture_source` names the payment mode |

**Ruling A: accept the payment-mode `checkout.session.completed` capture as the endive evidence.**
- The C-6 check proves that the paths the handler reads exist at endive, and `subscription` is present at the top level. A rename or move at endive would show up as an absent key, so the capture does verify the shape.
- What it cannot show is a non-null subscription value. That is Stripe's expandable id, and the handler already handles a null or unknown link (no link, logged).
- The stakes are low. A replayed `checkout.session.completed` only links the subscription and clears the checkout lock, and the lock also expires on its own. Money comes from `invoice.paid`, which has several endive captures.
- **Follow-up FU-P8b-4:** replace it with a subscription-mode endive capture the next time a permitted sandbox account completes a plan checkout (at the latest, the P-8b.3 demo).

**Ruling B: accept the unit-test coverage for demo point 4. No Stripe write for P-8b.2.**
- Step B is read-only and flag-only. Its decisions are pure comparisons over port data, and each finding kind is unit-tested.
- The real list call ran against the sandbox (0 subscriptions).
- One real-shape gap remains: no test feeds a **real** Stripe subscription object through `listBusinessOsSubscriptionsByPrice`'s mapping into Step B. That gap closes without a Stripe write:
  - **Q-C1 (QA condition before commit):** QA adds a unit test that sends a captured subscription fixture (for example `captured-p7b1-e1b-06-subscription-after-pay.json`, at the SDK pin `2025-10-29.clover`, the version `subscriptions.list` answers in) through a mocked `stripe.subscriptions.list` into the real mapping, and then into `createPlanReconcilePass` Step B.
  - The test asserts: a matching billing row and plan row give no finding; a planted `bought_tier` difference gives exactly one `tier_differs` and `planMismatch = 1`; a planted `current_period_end` difference (period started more than 24 hours ago) gives one `period_differs`.
- **The real-data mismatch moves to the P-8b.3 demo**, which needs a disagreeing subscription for the "Disagrees" marker anyway. When it comes, the user is asked once, in these words:

> "For the next demo we need one test subscription in the Stripe **sandbox** `acct_1UPKR4C7KDUGYIcA` (test mode, no real money). We would: (1) sign in as one of our own Business OS test accounts (not the customer we have been told to leave alone), (2) buy the Basic plan through our normal checkout with Stripe's test card 4242 4242 4242 4242, which creates one test customer and one test subscription, (3) change that test account's plan tier on our admin Tiers page so it disagrees with Stripe, run the reconcile, and check that it reports exactly one disagreement, then (4) cancel the test subscription. Nothing touches production's Stripe account. May we?"

**Gates:** I accept Dev's gates as reported: 437 suites and 14,873 tests, the Connect harness unchanged, the allow-list guards, `test:bos-entitlements` with 9,626 tests, `tsc` with 0 errors in touched files, and ESLint clean. The demo's 820-byte counts are within the D-4 budget.

**Code Approved for QA: Yes.** QA adds Q-C1 and runs its own matrix. FU-P8b-4 and the real-data mismatch (in the P-8b.3 demo) are recorded, not blocking.

## QA Testing Report

### QA report: P-8b.1

**QA, 2026-10-27**
**Test mode:** full
**Strategy used:** A (Jest, in-memory). New file `lib/repositories/__tests__/ProcessedWebhookEventRepository.staleClaim.qa.test.ts` (21 tests): a fake Supabase builder that records filters and applies them to rows with Postgres NULL semantics, plus source guards on the route's `processing` branch. No DB, no Stripe. No import from `BusinessOsBilling*Repository` or `entitlements/`.
**Focus:** api, security
**Skipped:** e2e (no UI); `test:bos-entitlements` (the diff has no import from entitlements)
**Input source:** TL prompt

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| `STALE_CLAIM_AGE_MS === 900000` | ✅ | Pass | |
| One conditional UPDATE, `{ count: 'exact' }`, eq event_id, eq status processing, lt processed_at, no `user_id` | ✅ | Pass | recorded chain |
| Boundary: exactly 15 min is not reclaimed (strict lt) | ✅ | Pass | |
| 14:59 stays, 15:01 is reclaimed | ✅ | Pass | |
| NULL `processed_at` (legacy) stays stuck, no throw | ✅ | Pass | row unchanged, `won: false` (SA Low, as today) |
| `completed` / `failed` rows, 24 h old, never touched | ✅ | Pass | |
| Other event ids untouched | ✅ | Pass | |
| Winner writes `processed_at` = now, clears `failure_message` | ✅ | Pass | |
| Two concurrent reclaims: exactly one wins | ✅ | Pass | second sees the renewed lease |
| count 1 wins; 0, 2, null lose | ✅ | Pass | |
| Error passed through, never won; route returns duplicate before `processedEventId` is set, logs error | ✅ | Pass | repo + source guard; harness covers the response |
| Connect and plan alike: no `event.account`/type branch before the reclaim | ✅ | Pass | source guard |
| Warn log carries only `{ event: 'bos_webhook_stale_claim_reclaimed' }` (no PII) | ✅ | Pass | bound context is event id, type, livemode |
| Failed branch unchanged | ✅ | Pass | source guard + harness 9c |

**Issues:** none. Bugs 0, Performance 0, Edge cases 0 (NULL `processed_at` stays stuck, already recorded by SA as Low, not a regression).

**Gates (sequential):** QA file 21/21; Connect harness `--ci` 152/152, 111/111 snapshots; `app/api/stripe` 22 suites, 588 tests; `lib/repositories` 125 suites, 2,984 tests (incl. the BusinessOsBilling* allow-list tests and `ProcessedWebhookEventRepository.test.ts`); `lib/business-os/billing` 50 suites, 3,840; `lib/admin/environment` + `lib/server` 15 suites, 282. All pass. Snapshot md5 after the run: `edb475942e84b1c872b17f7f33fc3f9a` (unchanged); no `-u` used.

**Final status:** ✅ All acceptance criteria pass, ready for commit (the QA test file is new and untracked; RM includes it).

### QA report: P-8b.2

**QA, 2026-10-28**
**Test mode:** full
**Strategy used:** A (Jest, in memory). Two new files, both untracked:
- `lib/business-os/billing/__tests__/planReconcilePass.capturedSubscription.qa.test.ts` (7 tests): SA condition **Q-C1**. The captured `captured-p7b1-e1b-06-subscription-after-pay.json` (`2025-10-29.clover`, active, one item on `bos_plan_pro_monthly_usd`) goes through a mocked `stripe.subscriptions.list`, the REAL `StripeService.listBusinessOsSubscriptionsByPrice` mapping, and the REAL Step B of `createPlanReconcilePass`. The tier comes from the fixture's own lookup key through the real `planTierForLookupKey`.
- `lib/business-os/billing/__tests__/planReconcilePass.qa.test.ts` (29 tests): claim races and claim errors, unsettled claims, window anchoring, unverified shapes, deadline and batch caps, incomplete lists, log keys.

Neither file imports `BusinessOsBillingAccountRepository`, `BusinessOsBillingEventRepository` or `entitlements/` (checked by grep), so no allow-list registration was needed. Both allow-list guards were run anyway: they pass. No DB, no network, no Stripe call, and nothing from `cus_VQf9jX6fnfVlkK`.
**Focus:** pipeline (billing), security, performance
**Skipped:** e2e (no UI in P-8b.2); the real-data mismatch demo (SA ruling B moved it to P-8b.3)
**Input source:** TL prompt + SA condition Q-C1

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| **Q-C1** captured subscription, real mapping, real Step B: a matching billing row and plan row give no finding | ✅ | Pass | `subscriptions.list` called once with `{ price, limit: 100 }`; no claim call and no handler call |
| Q-C1: a planted `bought_tier` difference gives exactly one `tier_differs`, `planMismatch = 1` | ✅ | Pass | the full log context is asserted: kind plus the billing-row and subscription ids, nothing else |
| Q-C1: a planted `current_period_end` difference, period started over 24 h ago, gives exactly one `period_differs` | ✅ | Pass | control: the same difference under 24 h old gives no finding |
| Q-C1 extras: the captured subscription with no billing row is one `orphan`; with `has_more` it stops at 10 pages, gives no orphan, and sets `checkIncomplete` | ✅ | Pass | |
| Claim races: insert `23505`, a lost conditional failed-reclaim, and a lost STALE reclaim (lease renewed between the read and the update) each set `incomplete`, run no handler, and leave a run record that cannot anchor | ✅ | Pass | checked on the record as `runReconcilePasses` flattens it |
| Claim errors (insert other than `23505`, `reclaimStale` error, `reclaimFailedIfStillFailed` error) | ✅ | Pass | no handler; `replayFailed = 1` (which blocks the anchor); exactly one `claim_failed` line with step, event id and type |
| Unsettled claims: `complete()` fails | ✅ | Pass | counted `replayed` **and** `incomplete`; the row stays `processing`; a run 16 minutes later reclaims it as stale and completes it |
| Window: a clean `partial` run anchors (boost deferral, clipped, unverified shapes and `checkIncomplete` do not block) | ✅ | Pass | D-3 (a) |
| Window: a newer `planReplayFailed` or `planIncomplete` run is passed over and the older clean run anchors | ✅ | Pass | |
| Window: 30-day history: only blocked plan runs 20 days back gives 7 days, clipped; only boost-era runs gives the 3-day first night | ✅ | Pass | fix 3 |
| Window: the 7-day cap boundary (anchor at 7 d − 59 min is clipped, at 7 d − 61 min is not); an unparseable `started_at` never anchors; `'0'` stored as a string is not clean | ✅ | Pass | |
| Unverified pairs: a missing `api_version`, `constructor` and `__proto__` as the version, and a verified version with an unverified type | ✅ | Pass | skipped and counted; never claimed or dispatched |
| The summary line is still written when the loop stops at the deadline or at the batch cap; it carries no ids | ✅ | Pass | |
| Deadline during Step A: Step B is not started (no Stripe list), `checkIncomplete` | ✅ | Pass | |
| Deadline inside the price loop, and a price list that throws: no `orphan`, no `subscription_not_listed`, `checkIncomplete` | ✅ | Pass | SA ruling 14 |
| Batch cap: completed non-invoice events do not count; completed `invoice.paid` (Step C checks) do count (ruling 13) | ✅ | Pass | see Performance 1 for the consequence over several nights |
| Counts byte budget | ✅ | Pass | the Dev test (36 keys at 5 digits, 963 bytes) was re-run; the demo's 820 bytes is within budget |
| F-1 column set | ✅ | Pass | re-run: `replaceCustomer` writes exactly the 20261025 UPDATE grant minus `founder_discount_applied_at`, equal to `attachTestClockCustomer`; both clear `current_period_end` to `null` |
| No PII in logs | ✅ | Pass | one run that covers replay, replay failed, not settled, unverified shapes, every Step B kind, Step C and done. Every context key comes from a fixed set. No value holds `@`, `cus_` or the handler's error text (a thrown `jane@example.com … declined` is logged as `errorName: 'Error'` only) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix; SA to rule, not a commit blocker at today's volume)
1. **The batch cap can latch the window open for good, and starve newer events.** — File: `lib/business-os/billing/planReconcilePass.ts` (`stepA`, the `handled >= BATCH` check) — Severity: Medium (not reachable at today's volume)
   - **Why it happens.** Ruling 13 counts every dispatched event against the 100 cap, including the completed `invoice.paid` events that are only Step C checks. Reaching the cap sets `incomplete = 1`, so that run can never anchor the window.
   - **Steps to reproduce.** One night is blocked for any reason, for example a failed replay or a lost race. The window then widens towards 7 days. At about 1,000 subscribers (about 33 `invoice.paid` a day, §5), 7 days hold about 230 completed `invoice.paid`, which is more than 100.
   - **Expected.** The next clean night lets the window move forward again.
   - **Actual.**
     - Every night hits the cap, so every night is `incomplete`. The window never anchors again and stays 7 days, clipped, and amber for good.
     - Only the oldest 100 events of the window, about days 7 to 4 back, are examined each night. A newly failed event is replayed only once it is about 4 to 7 days old, not the next night.
     - Above about 100 dispatched events a day (about 3,000 subscribers), some events are never reached before they leave the window.
     - The same `paid_invoice_unassigned` finding is also logged again every night, for up to 7 days.
   - **Pinned by test.** The test "ruling 13 as built" pins one night of this: 100 completed `invoice.paid` events, then one `failed` event that is not replayed (`incomplete = 1`).
   - **Possible fixes for SA.**
     - Do not count Step C checks of completed claims against the replay cap.
     - Or let a cap reached only by Step C checks leave `incomplete` at 0.
     - Or replay pending events before doing the Step C checks.

#### Edge Cases (nice to fix)
1. **The event list is cut at 10 pages, and the cut drops the OLDEST events.** — File: `lib/stripe/StripeService.ts` (`listBusinessOsPlanEvents`) — Severity: Low
   - Stripe lists events newest first, so a capped list keeps the newest 1,000 and drops the oldest.
   - `incomplete = 1` holds the window, but every later run lists the same newest 1,000, so the oldest events are never reached until they age out.
   - This needs more than 1,000 plan events in the window, about 4,000 or more subscribers over 7 days. It is the same class as Performance 1.
2. **A `null` `bought_tier` hides a Stripe tier difference.** — File: `planReconcilePass.ts` (`tier_differs` requires `row.bought_tier !== null`) — Severity: Low
   - A paying row with a `null` `bought_tier` gets no `tier_differs`.
   - The plan-row check still compares the plan tier with Stripe, so a real disagreement still surfaces as `plan_tier_differs`.

### Test Outputs / Logs

| Gate (run sequentially, 2026-10-28) | Result |
|---|---|
| New QA files | Q-C1 7 / 7; edge cases 29 / 29. All `planReconcilePass*` suites: 5 suites, 112 tests, pass |
| `lib/business-os/billing`, `lib/business-os/boost`, `lib/repositories`, `lib/cron`, `lib/stripe`, `app/api/stripe`, `app/api/cron` (`--ci`) | 242 suites, 8,871 tests, 118 snapshots, all pass |
| `lib/admin`, `app/admin` (`--ci`) | 231 suites, 7,432 tests, all pass |
| Connect harness `--ci` | 152 / 152 tests, 111 / 111 snapshots; the `.snap` is not modified in git (`git status` clean for it); no `-u` used |
| Both `BusinessOsBilling*Repository.test.ts` allow-list guards | 2 suites, 198 tests, pass |
| `npm run test:bos-entitlements` | 321 suites, 9,626 tests, pass. **Note:** the first run failed the FR-12 `tierLiteral.forbidden` guard on QA's own new files, which used tier names as literals. QA replaced them with neutral strings and the re-run passed. Code under test was not involved |
| `tsc --noEmit` (full project, 8 GB heap) | completed with diagnostics printed (no OOM); 1,864 errors, all pre-existing (Dev's baseline); **0 in touched or new files** (a first run found 3 in QA's own file, fixed) |
| ESLint, the two QA files | 0 errors, 0 warnings |

### Final Status
- [x] All acceptance criteria pass, ready for commit. Q-C1 is met. RM includes the two untracked QA files.
- [ ] Issues found that Dev must address before commit: none. Performance 1 (Medium) goes to SA as a follow-up ruling and does not block at today's volume.

### SA rulings on the P-8b.2 QA items

**SA, 2026-10-28.** None of the three blocks this commit. Each is recorded as a follow-up with a trigger. P-8b.2 proceeds to the user's diff review and RM as it is.

**Performance 1 (the cap latches the window): follow-up FU-P8b-5, not fixed now.** QA is right, and the root cause is my ruling 13, which put Step C checks on the replay budget.
- **Why it does not block.**
  - It needs more than 100 examined events in a window. Today's sandbox shows 13 in a night and 163 in 30 days, and production sells no plan in live mode yet.
  - When it does happen, it is visible: `planIncomplete` turns the run amber every night.
  - It can never cause a wrong write.
  - The user is reviewing this diff now, and a restructure would reopen it.
- **Trigger, binding.** Do FU-P8b-5 **before the first of**:
  - live mode passing **300 paying plan subscriptions** (about 70 `invoice.paid` a week), or
  - two nights in a row with `planIncomplete = 1` while `planReplayFailed = 0` and `planDeadlineHit = 0` (that is, the cap alone holding the window).

  TL adds the volume trigger to the requirement's §9.5 go-live checklist as a watch item.
- **Design for FU-P8b-5, so nobody re-decides it:**
  1. **Two budgets.** Replays (claim null, `failed`, or stale `processing`): cap 100. Reaching it sets `incomplete` and stops new replays, as today. Step C checks (completed `invoice.paid`): a separate cap, for example 300. Reaching it sets `checkIncomplete` only, which does not block the anchor, and further checks are skipped while replays continue.
  2. **Restructure the loop.** The cap check at the top of the loop goes. The deadline check stays first. After `findClaim`, the event goes to the budget for its kind.
  3. **Order stays oldest first** (ruling 3) **within the replays.** Step C checks need no order.
  4. **Step C repeats.** A `paid_invoice_unassigned` finding for the same event logs at most once per window day. Optional, as a log-volume nicety only.
  5. **Tests.** QA's "ruling 13 as built" test flips: 100 completed `invoice.paid` plus one `failed` gives the failed one replayed and `incomplete = 0`. The check-cap overflow sets `checkIncomplete = 1` only.
  6. **Also in FU-P8b-5: Edge case 1** (the 10-page list drops the oldest events). Read the window in day slices, oldest slice first: `created: { gte, lt }` per day, each slice still paged and capped. A capped slice sets `incomplete` and stops at that slice, so the oldest unread events are always the next run's first. Same trigger.

**Edge case 1 (the event list keeps the newest 1,000): part of FU-P8b-5** (item 6 above). It needs more than 1,000 plan events in 7 days, well past the FU-P8b-5 trigger.

**Edge case 2 (a paying row with `bought_tier` null gets no `tier_differs`): follow-up FU-P8b-6, Low.** A real tier disagreement still surfaces as `plan_tier_differs`, so nothing is hidden. The gap is a null mirror on a paying row while the plan row matches Stripe, which produces no finding.
- **Fix when it is next touched** (P-8b.3, or with FU-P8b-5): a paying row whose period started more than 24 hours ago and whose `bought_tier` is null while Stripe's tier resolves gives `tier_differs`, and the plan-row tier check is then skipped (the one-root rule).
- Inside 24 hours, a null is a checkout still settling and gives no finding.
- Add one unit test for each case.

## Commit Info

_(RM populates.)_

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-27 | Workplan drafted (Dev) | On `feature/bos-plan-payments-p8b` from `main` `b088b51d`. No migration; three PRs P-8b.1 to P-8b.3 (≈ 3.3d); Q-1 to Q-10 for SA (Q-1 blocking: the Connect snapshot entry 9b must change); B-1, B-2 business questions |
| 2026-10-27 | SA review: P-8b workplan (SA) | APPROVED WITH CHANGES, rulings 1 to 18. Q-1: 9b change accepted for Connect with 9d-equivalence evidence; pass uses a conditional failed-reclaim; replay types = full handler set plus api_version check; window anchored on last complete plan pass |
| 2026-10-27 | Rulings folded in; P-8b.1 code complete (Dev) | §4.1 and §8 carry SA rulings 1, 2 and 6; §13 records TL decisions (B-1, B-2 defaults; F-1 into P-8b.2). P-8b.1 built: `reclaimStale`, the route's `processing` branch, harness 9b changed by one effect, 9d / 9e added, all other 108 exports byte-identical; snapshot md5 `edb47594…`. Implementation Notes (P-8b.1) |
| 2026-10-27 | SA code review: P-8b.1 (SA) | Code Approved. Per-export checksums re-verified (108 identical, 9b changed, 9d / 9e added); lease, race and sanitise band checked; RM owes ruling 1e in the PR body |
| 2026-10-27 | QA report: P-8b.1 (QA) | PASS. 21 new in-memory tests (boundary, 14:59/15:01, NULL, race, error, PII); all gates green; snapshot md5 unchanged |
| 2026-10-28 | P-8b.2 code complete (Dev) | On `feature/bos-plan-payments-p8b2` (from P-8b.1, PR #555 opened 2026-10-28). `planReconcilePass` appended to `bos-billing-reconcile`: a drain on `processed_webhook_events` (insert / `reclaimFailedIfStillFailed` / `reclaimStale`, never `reclaimFailed`), all 7 handler types oldest first, API-version and mode skips, window anchored per ruling 8 (+ D-3); Steps B and C flag only; D3.1 double-replay test; F-1 `replaceCustomer` fix; 13 plan counts within the run record's 1,024-byte CHECK (D-4). No migration. Implementation Notes (P-8b.2) |
| 2026-10-28 | SA code review: P-8b.2 (SA) | APPROVED WITH FIXES. Claim discipline, conditional reclaim, no-orphan-on-incomplete, tenant isolation, F-1 and the unchanged Connect path verified; D-2 to D-10 approved (D-4 headroom corrected to about 60 bytes). Fixes: (1) every lost claim sets `incomplete`; (2) an unsettled claim sets `incomplete`; (3) run read lookback 30 days so "first night" cannot skip days 3 to 7; (4) `planApiVersionSkipped` amber, with the Step 4 demo recording the account API version |
| 2026-10-28 | SA fixes 1 to 4 applied; Step 4 demo stopped (Dev) | Every lost claim and every unsettled claim sets `planIncomplete`; run history read over 30 days; `planApiVersionSkipped` is amber. All gates green. Sandbox demo stopped at the API-version check: the test account renders every plan event at `2026-09-30.endive`, not `2025-10-29.clover`; back to SA |
| 2026-10-28 | SA re-review: P-8b.2 fixes and API-version ruling (SA) | Fixes 1 to 4 approved; residual gap (30 days of failed runs falls back to 3 days) accepted as a known limitation. API version: option (b) per (version, type), `PLAN_HANDLER_VERIFIED_EVENT_SHAPES` beside the event types, each pair backed by a C-6 fixture (ratchet test); endive verified for 5 types, `checkout.session.completed` after a capture; pin move (a) rejected for P-8b. V-1 to V-5 before QA; demo evidence and the user's production API-version question recorded |
| 2026-10-28 | API-version ruling (b) built; Step 4 demo run (Dev) | V-1 to V-5: verified (version, type) map, pass gate with one summary warn, endive `checkout.session.completed` captured (payment mode; flagged to SA), ratchet in the C-6 test, §9.5 row 9 amended. Demo on real Stripe test reads with in-memory DB ports: points 1, 2, 3 and 5 shown; point 4 not shown (the only live plan subscriptions belong to the customer that must not be touched). All gates green |
| 2026-10-28 | SA check: V-1 to V-5 and Step 4 demo (SA) | APPROVED, ready for QA. Ruling A: the payment-mode endive `checkout.session.completed` capture is accepted (FU-P8b-4: replace with a subscription-mode capture). Ruling B: demo point 4 is covered by unit tests, no Stripe write; QA condition Q-C1 (a captured subscription fixture through the real list mapping into Step B); the real-data mismatch moves to the P-8b.3 demo, with the user question written out |
| 2026-10-28 | QA report: P-8b.2 (QA) | PASS. Q-C1 met: 7 tests send the captured clover subscription through the real `listBusinessOsSubscriptionsByPrice` mapping into the real Step B. 29 edge-case tests: claim races and errors, unsettled claims, window anchoring, unverified shapes, deadline and batch caps, no PII. Bugs 0. Performance 1 (Medium, for SA): the batch cap can latch the window at 7 days and starve newer events at about 1,000 subscribers or more. Edge cases 2 (Low). All gates green, tsc 0 in touched files |
| 2026-10-28 | SA rulings on P-8b.2 QA items (SA) | None blocks the commit. Performance 1 (cap latches the window) is FU-P8b-5, with a binding trigger (live mode passes 300 paying plan subscriptions, or two nights of `planIncomplete` with no replay failure or deadline) and a fixed design: separate replay and Step C budgets, day-sliced event listing (which also covers Edge case 1). Edge case 2 (null `bought_tier`) is FU-P8b-6, Low, fixed when next touched |
