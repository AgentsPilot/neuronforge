# Workplan: Business OS Plan Payments, P-8b (Reconciliation and webhook health)

> **Last Updated**: 2026-10-27

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §9.1 P-8b row; §7 AM-4, AM-5 and the "Data source" line; §4 PF-5; §8 SR-3, SR-4, SR-8, SR-10, SR-11; §9.4 row "Stuck-event recovery and reconciliation"; §11 SA-P4 and its ruling in "SA Review — 2026-10-02" (SA-2), the P-8b row of SA-4 (no migration; `bos_cron_runs` and the billing record suffice); §9.5 row 1 (PF-5 is on the go-live floor)
**Depends on:** P-6a merged (row's dependency). Boost 4b.2 merged: it created `bos-billing-reconcile` and the pass seam. P-8a merged (#466, #467, #469): the billing panel's stored disagreements.
**Date:** 2026-10-27
**Branch:** `feature/bos-plan-payments-p8b`, worktree `neuronforge-p8b`, fresh from `main` `b088b51d` (#543). Confirmed with `git branch --show-current` on 2026-10-27. Highest migration on that main: `20261096`.
**Status:** SA APPROVED WITH CHANGES (2026-10-27, rulings 1 to 18). **P-8b.1 code complete 2026-10-27** (uncommitted), awaiting SA code review. P-8b.2 and P-8b.3 not started.

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
- [ ] P-8b.2 Step 1: Stripe list methods + tests (paging, cap, `complete: false`)
- [ ] P-8b.2 Step 2: repository reads (cron last good run, billing events by event id, open subscriptions)
- [ ] P-8b.2 Step 3: `planReconcilePass` A, B, C + unit tests; append to `RECONCILE_PASSES`; counts in `bosCronJobs.ts`
- [ ] P-8b.2 Step 4: sandbox demo (§10)
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
