# Workplan: Business OS Credits Boost — Slice 4b "Refunds, disputes and the stuck-purchase pass"

> **Last Updated**: 2026-10-09

**Developer:** Dev
**Requirement:** [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md): FR-35, FR-36, FR-37, FR-43; T-9; R-6, R-8, R-10; F-1; the go-live gate (4a §7)
**Carry-forwards taken in:**
- **2b §9:** N-2 (a refund on `pending` / `awaiting_payment` / `expired` answers `not_allowed`: log `error`, audit; the reconcile pass credits or flags the row); I-1 (a refund on a transition-flagged row is unbounded: log it at `warn` with the amount); the outcome map.
- **4a:** §9 (the resolver extension to `charge.refunded` / `charge.dispute.*` by `findByPaymentIntentIdForWebhook`; I-1 legacy packs read one row; I-4 the receipt never throws); SA C-1 SQLSTATE classes; SA N-1 / C-3 (never write a row not matched by its own identifier); the §7 step 6 manual recovery.
- **Slice 3 §9:** C-8 (b) `bos_boost_paid_not_creditable` rows are listed by the reconcile pass.
- **Plan payments SA-P4 / PF-5:** one `bos-billing-reconcile` cron with pluggable passes, created by whichever of P-8b and boost 4b lands first. The in-webhook reclaim of stale `processing` claims is P-8b's.

**Branch:** 4b.1 `feature/bos-credits-boost-slice-4b`, cut from `origin/main` `790e2ca8` (after #267); 4b.2 `feature/bos-credits-boost-slice-4b2`, cut from `origin/main` `88b1938f` (after #272)
**Date:** 2026-10-08
**Status:** **4b.2 merged 2026-10-09 ([PR #278](https://github.com/AgentsPilot/neuronforge/pull/278), 90c33582). Slice 4b is complete.** *(Earlier: approved and committed 2026-10-09, PR #278 open; the user applies 20261032 on PROD before the merge.)* **4b.2 "the stuck-purchase pass": review fixes applied 2026-10-09 (SA CR-1 to CR-3, QA4b2-M1, QA R-1 to R-5), SA re-check 2026-10-09: Code Approved for QA; QA re-check 2026-10-09: PASS (QA4b2-M1 closed)** (§6.2). *(Earlier:* **QA PASS WITH NOTES 2026-10-09 (QA4b2-M1 = SA CR-1 open; re-check after CR-1 to CR-3)**; implemented 2026-10-09; SA code review approved 2026-10-09 after the CR-1 to CR-3 re-check; awaiting the QA re-check and the user diff** (results in §6.2; nothing committed; migration 20261032 not yet applied). **4b.1 "refunds and disputes": merged 2026-10-09 ([PR #272](https://github.com/AgentsPilot/neuronforge/pull/272), 88b1938f).** *(Earlier: 4b.2 in progress.)* *(Earlier: approved and committed 2026-10-08, PR #272 open.)* **QA PASS WITH NOTES 2026-10-08** (QA4b-M1 Medium: a re-delivered dispute.created reopens a won dispute; QA4b-L1 Low wording; see QA Testing Report). SA code review approved 2026-10-08 (Code Complete 2026-10-08) (results in §6.1). 4b.2 (reconcile) not started. *(Earlier: **SA approved with conditions 2026-10-08** (C-1 to C-8; split 4b.1 / 4b.2). BQ-1 (owner wording after a lost dispute) is with the user. Nothing is committed.)*

## Overview

4a credits a paid boost. 4b closes the two gaps left before real money:

1. **Refunds and disputes** (FR-35, FR-36). A refund or a chargeback on a boost charge is recorded on **its own purchase**, alerted to an admin and audited. It is never answered "unknown payment". Credits are **not** clawed back automatically (FR-37, T-9). A manual take-back stays credit deduction 11b's `confirmPaidCredits`.
2. **The stuck-purchase pass** (FR-43, F-1). A nightly `bos-billing-reconcile` cron, plus an admin trigger, re-reads Stripe for any purchase still `pending` / `awaiting_payment` past its checkout expiry plus a grace period. It credits, expires or fails it through the **same** idempotent functions, and backfills missing receipt links. This replaces 4a's manual SQL-plus-Resend recovery as the primary path; that procedure stays documented as the fallback.

**Proposed split** (§8): **4b.1** refunds and disputes (about 1.25 d); **4b.2** the reconcile cron, admin trigger and receipt backfill (about 1.5 d).

---

## 1. Analysis Summary

| Area | As built on `790e2ca8` | 4b |
|---|---|---|
| Boost resolver (4a) | Only the four `checkout.session.*` types; any other type → `not_business_os`. Today a platform `charge.refunded` / `charge.dispute.*` on a boost charge falls to the legacy `handleChargeRefunded` / `handleDispute`, which find no `payment_transactions` row and log "unknown payment" (4a Q-4: acceptable in test mode only) | Adds `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `charge.dispute.funds_reinstated`. Matching is **only by the payment intent stored on our row** (`findByPaymentIntentIdForWebhook`). No metadata fallback for charge events: an unmatched charge stays `not_business_os` (legacy unchanged) |
| Transition function (2b, PROD) | Refunds: `partially_refunded` / `refunded` from `paid`, `partially_refunded`, `refunded`, `disputed`, `dispute_lost` or `flagged_mismatch`. It takes the **cumulative** refunded amount; a lower amount → `stale`; a disputed / lost / flagged row → `recorded` (the amount only); `pending` / `awaiting` / `expired` → `not_allowed` (N-2). Disputes: `disputed` (from paid-family; `recorded` on a flagged row), `dispute_lost` (from `disputed`), `dispute_won` (back to `paid` / `partially_refunded` / `refunded` by the refunded amount); the dispute id must match | Used as is. **The lot is never touched** |
| Credit function (2b) | Accepts `pending` / `awaiting_payment` / `expired`; idempotent on the row (`already_credited`) | The reconcile pass credits through it |
| Repository | `findByPaymentIntentIdForWebhook`, `credit`, `transition`, `recordReceipt`, `listForAccount`; the 4a failure classification (C-1). A repo guard already allows `app/api/cron/bos-billing-reconcile/` to name the webhook finders | Adds one unscoped-by-design cron read: `listForReconcile({ now, graceMinutes, limit })` (§3.4) |
| Webhook claims | `ProcessedWebhookEventRepository` (#258): `findClaim`, `insertClaim`, `reclaimFailed`, `complete`, `markFailed`. A claim stuck in `processing` is never reclaimed (F-1) | 4b does **not** touch claims (P-8b's in-webhook reclaim; passes never share rows). The purchase row is the truth, so the pass recovers the purchase whatever its claim says |
| Cron precedent | `stripe-settlement-gap` and `credit-leak-check`: fail-closed `CRON_SECRET`, `withCronRunRecord` → `bos_cron_runs` (counts only), `maxDuration = 60`, a run deadline. **No `bos-billing-reconcile` route exists** (P-8b is not built) | 4b **creates** `app/api/cron/bos-billing-reconcile/route.ts` with a passes array `[boostReconcilePass]` and a seam for P-8b |
| Indexes on purchases | Only `(user_id, livemode, created_at)` | The pass filters by status and expiry; see the migration question (§3.6) |
| Owner view (5b) | `refunded` / `partially_refunded` / `under_review` (`disputed`, `dispute_lost`, `flagged_mismatch`) | Unchanged unless the user answers BQ-1 |

---

## 2. Scope and guardrails

**In scope:**
- **4b.1:** resolver and handler branches for the four charge events, audit and alerts, tests (including the Connect characterisation).
- **4b.2:** the reconcile cron and its boost pass; a receipt backfill for `paid` rows with no `receipt_url`; the admin trigger route; the `vercel.json` schedule; docs; the 4a §7 step 6 demoted to the fallback.

**Out of scope:**
- Automatic credit clawback (FR-37, T-9; manual take-back through 11b).
- The admin purchases view and its button UI (slice 6).
- P-8b's plan pass and the in-webhook reclaim.
- Any change to the 2b SQL.

**Guardrails (must not):**
- Write a purchase row not matched by **its own stored** payment intent (charge events), or by its own session id / reference under 4a's C-3 (session events). Metadata never routes.
- Touch `business_os_credit_lots`, `_lot_draws` or any agent-platform table.
- Run for a Connect event (the dispatcher returns before any resolver; the characterisation must stay byte-identical for Connect entries).
- Let the cron run without `CRON_SECRET` in production (fail closed).
- Let the pass take an account from Stripe. Each effect runs through the SQL functions on the row's own `user_id`.
- Throw on a deterministic failure (4a C-1) or swallow a transient one.

---

## 3. Implementation Approach

### 3.0 SA conditions applied (2026-10-08)

| # | Slice | Condition | Where |
|---|---|---|---|
| C-1 | 4b.1 (and 4b.2) | Currency case: compare `charge.currency.toUpperCase()` (and the dispute's) with `row.currency` (`'USD'`), or every boost refund would be wrongly alerted with no write. Test with lower-case `usd` | §3.2 |
| C-2 | 4b.2 | A pass racing the webhook: on `not_allowed` / `not_creditable` / `already_credited` for a row read as stuck, re-read the row; if it is now paid-family or otherwise final, count `raced`, log `info`, no alert or audit. Test the row credited between the batch read and the call | §3.4 |
| C-3 | 4b.2 | §3.4 step 2 wording fixed (below): a NULL-session row is never credited; a late payment is flagged `no_session`; expiring after 48 h only stops the row counting toward the cap. Test: expired no-session row + a paid session event → `mismatch` / `no_session`, alerted, no lot | §3.4 |
| C-4 | 4b.2 | Deadline: stop starting new rows when less than 10 s remains before the 45 s deadline; counters report `deadline_hit` and the rows left | §3.4 |
| C-5 | 4b.2 | The admin route goes in the admin access register (`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`); `npm run test:authz-guard` (a required check) is in the definition of done | §3.5 |
| C-6 | 4b.2 (gate text) | Residual: a `charge.refunded` / `charge.dispute.*` claim stuck in `processing` (F-1) is not recovered by the pass (it reads stuck pending / awaiting rows and receipt gaps only). The money facts stay in Stripe; the effect is a missing flag. P-8b's in-webhook reclaim closes it, or an admin resends the event. Named in the §7 gate | §7 |
| C-7 | 4b.2 | `BOS_BOOST_RECONCILE_TRIGGERED` is written against an admin / system entity (the cron-run id, the admin as `userId`), never `business_os_boost_purchase`; a test pins its entity type. 4b.1 writes no admin or system audit | §3.5 |
| C-8 | 4b.1 / 4b.2 | Dispute ids: the webhook's dispute object carries its own id. In the pass's late-reversal read, expand `payment_intent.latest_charge` (and the dispute) so the id `transition` requires is known; a charge showing `disputed: true` without a readable dispute id is a **finding**, not a guess | §3.2, §3.4 |

Rulings Q-1 to Q-8 as proposed (§10): split; no charge-id lookup (a charge without `payment_intent` keeps the legacy path, pinned by a test); refund before credit → alert + audit now, applied by the pass; `BOS_BOOST_PAYMENT_REVERSED` owner-visible with a neutral label and hidden details; not a queue drain; the admin route in 4b.2 with the button in slice 6; migration 20261032 now (plain `CREATE INDEX`, `IF EXISTS` in the rollback); the grace periods as listed.

### 3.1 4b.1 — the resolver for charge events (`boostWebhookResolver.ts`)

| Event | Object | Key read |
|---|---|---|
| `charge.refunded` | Charge | `charge.payment_intent` |
| `charge.dispute.created` / `.closed` / `.funds_reinstated` | Dispute | `dispute.payment_intent` (Q-2: no charge-id fallback) |

- A `pi_` id → `findByPaymentIntentIdForWebhook(pi)`.
  - **Row found** → `flow: 'boost'`.
  - **No row** → `not_business_os`: an agent-platform or Connect-unrelated platform charge keeps the legacy path, exactly as today.
  - **Lookup error** → throw, so the claim is released.
- No `pi_` → `not_business_os`.
- **No marker deny for charge events.** A charge does not carry the session metadata, so there is no cross-check to fail. Only the stored payment intent identifies our purchase (SA N-1 / C-3 shape).

**Disjointness:** the plan resolver does not claim `charge.*`. Its future P-6b invoice-payment lookup resolves plan rows, which never share a payment intent with a boost row; any overlap is the `resolver_conflict` deny.

### 3.2 4b.1 — the handler branches (`boostChargeHandler.ts`, called by the existing flow handler)

`BUSINESS_OS_FLOW_HANDLERS.boost` stays one function. It routes session events to the 4a handler and charge events here. The account is always `row.accountId`.

**Cross-checks first:**
- `event.livemode !== row.livemode` → alert and audit (`livemode_mismatch`), no write.
- A charge currency different from the row's → alert and audit (`currency_mismatch`), no write.

**Calls:**

| Event | Call |
|---|---|
| `charge.refunded` | `transition(amount_refunded >= row.amountTotalMinor ? 'refunded' : 'partially_refunded', { paymentIntentId, amountRefundedMinor: charge.amount_refunded })`, with the **cumulative** amount from the charge |
| `charge.dispute.created` | `transition('disputed', { disputeId })` |
| `charge.dispute.closed`, `status = 'won'` | `transition('dispute_won', { disputeId })` |
| `charge.dispute.closed`, `status = 'lost'` | `transition('dispute_lost', { disputeId })` |
| `charge.dispute.closed`, any other status (e.g. `warning_closed`) | `info` only |
| `charge.dispute.funds_reinstated` | `transition('dispute_won', { disputeId })` (idempotent with `closed(won)`: `already`) |

**Outcome map:**

| Result | Log | Audit | Then |
|---|---|---|---|
| `transitioned` / `recorded` | `error bos_boost_payment_reversed`, `alert: true` (FR-35's admin flag); for `recorded` on a flagged row also a `warn` with the amount (2b I-1) | `BOS_BOOST_PAYMENT_REVERSED` (`kind: refund \| dispute`, `phase`, `amount_refunded_minor`, `to_status`) | Complete |
| `already` | `info` | none | Complete |
| `stale` (an older refund event out of order) | `info` | none | Complete |
| `not_allowed` on a not-yet-credited row (N-2: money moved before we credited). *(QA4b-L1, corrected:)* this fires only for a row with a **stored** payment intent, i.e. `awaiting_payment`, or `expired` / `failed` after `awaiting_payment`. A stuck `pending` row holds no payment intent, so its refund or dispute resolves to `not_business_os` and takes the legacy path; the 4b.2 pass is its recovery | `error bos_boost_reversal_before_credit`, `alert` | `BOS_BOOST_FLAGGED` (`reversal_before_credit`) | Complete. The 4b.2 pass credits the row, then applies the charge's refund / dispute state (§3.4 step 3) |
| `not_allowed`, other | `error`, `alert` | `BOS_BOOST_FLAGGED` (`transition_not_allowed:<target>`) | Complete |
| Repository failure | 4a C-1 classes: deterministic → `error` + `alert` + audit + complete; transient → throw | | |

**Audit:** one new event, `BOS_BOOST_PAYMENT_REVERSED` (severity `warning`, audience `bos`). Its owner presentation follows the 4a C-5 rule: a neutral label ("Payment update"), with the details hidden from the owner (`OWNER_NEUTRAL_EVENTS`; Q-4).

### 3.3 4b.2 — the cron route `app/api/cron/bos-billing-reconcile/route.ts` (new)

- **The settlement-gap shape:**
  - `runtime nodejs`, `maxDuration = 60`, run deadline 45 s;
  - fail-closed `verifyCronSecret` (the same code; production without `CRON_SECRET` → 401 + `error`);
  - `withCronRunRecord('bos-billing-reconcile', …)` → `bos_cron_runs` (counts only, no money).
- **Passes:** `const PASSES: readonly ReconcilePass[] = [boostReconcilePass]`, run in order, each with its own budget slice and counters. `ReconcilePass = { name; run(ctx: { deadline; log; now }): Promise<PassCounts> }`. P-8b appends `planReconcilePass` (**the seam**); passes never share rows.
- **Schedule:** `"41 5 * * *"` (`vercel.json`), after the settlement-gap check at 05:17, on a minute clear of the 5- and 15-minute jobs. The cron line is added **last** (durable-queue-drain Step 8).

**Why this is not a claim-based queue drain** (durable-queue-drain does not apply; the settlement-gap precedent):
- The pass's only writes are the 2b SQL functions, which lock the purchase row and are idempotent (`credit` → `already_credited`; `transition` → `already` / `stale`).
- The receipt fill is fill-once (`already_recorded`).
- Its external calls are Stripe **reads**.
- So two overlapping runs (cron plus admin trigger) converge on the same result, with no double credit and no double audit (only the call that gets `credited` / `transitioned` audits).
- Therefore **no claim RPC and no claim columns** (Q-5).

### 3.4 4b.2 — the boost pass (`lib/business-os/boost/boostReconcilePass.ts`)

**1. Read a bounded batch** with a new repository method:
- `listForReconcile({ now, graceMinutes = 30, limit = 50 })`, **unscoped by design** (a cron, cross-account, by row; durable-queue-drain Step 9 and tenant-isolation Step 6);
- rows where `status IN ('pending', 'awaiting_payment') AND checkout_expires_at < now − grace`, oldest first;
- plus, in a second read, `status = 'paid' AND receipt_url IS NULL AND paid_at < now − 10 min` (receipt backfill), oldest first, the same limit;
- the current Stripe mode only (`livemode = currentStripeMode()`; a row of the other mode cannot be read with this key).

**2. Per stuck row** (until the deadline):
- **No session id:** a reservation that never got its session attached (slice 3's ambiguous create).
  - Past expiry + 48 h → `transition('expired')`, log `warn`.
  - *(Corrected, SA C-3.)* Such a row is **never credited**. A late paid webhook for its session still reaches the row through 4a's C-3 (a) fallback, and 2b's `credit` flags it `no_session` (visible and refundable, slice 3 C-2), whether the row is `pending` or `expired`. Expiring it after 48 h only stops it counting toward the cap.
- **With a session:** `checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.latest_charge'] }, { timeout: 5000, maxNetworkRetries: 0 })`.
  - `payment_status = 'paid'` → `credit(...)` with the session's figures (the 4a narrowing reused), then step 3.
  - `status = 'expired'` (or `open` past `expires_at`) and not paid → `transition('expired')`.
  - The payment intent is `requires_payment_method` / `canceled` after an async attempt → `transition('failed', pi)`.
  - Still `processing` (a delayed method) → leave it and count it.
  - Outcomes as in 4a: `credited` → `BOS_BOOST_CREDITED` audit + receipt; mismatch / not-creditable → flag + alert + audit.
  - **Every row decides its own outcome:** a deterministic failure is counted and alerted; a transient one is counted and **left** for the next run. **The pass never throws for one row.**

**3. Late reversals:** after a `credit` (or for a row already `paid` from the backfill read), if the expanded charge shows `amount_refunded > 0` or a dispute, the 4b.1 branch logic is applied with the charge's figures. A reversal that arrived before crediting (N-2) is therefore recorded once the row is credited.

**4. Receipt backfill:** for `paid` rows with no receipt, the 4a `recordBoostReceipt` (bounded, never throws).

**5. Counters for `bos_cron_runs`:** `examined`, `credited`, `expired`, `failed`, `still_processing`, `flagged`, `receipts_filled`, `deferred_transient`, `deadline_hit`. One `error` `bos_boost_reconcile_finding` per row that needed a person.

### 3.5 4b.2 — the admin trigger

- `POST /api/admin/business-os/credits/boost/reconcile`, with `requireAdmin` as the **first statement** and Zod on an empty or `{}` body.
- It runs the same boost pass once (the same deadline), writes the run through `withCronRunRecord` with `trigger: 'admin'`, and audits `BOS_BOOST_RECONCILE_TRIGGERED` (operator-only) with a bounded flush.
- The button UI is slice 6's (Q-6).

### 3.6 Migration?

**No function or claim migration is needed** (§3.3). **One optional index-only migration, `20261032`** (from boost's block 20261032–34), proposed for 4b.2 (Q-7):

```sql
CREATE INDEX business_os_boost_purchases_reconcile_idx
  ON public.business_os_boost_purchases (checkout_expires_at)
  WHERE status IN ('pending', 'awaiting_payment');

CREATE INDEX business_os_boost_purchases_receipt_backfill_idx
  ON public.business_os_boost_purchases (paid_at)
  WHERE status = 'paid' AND receipt_url IS NULL;
```

- Today the table is tiny, so the pass works without them. They keep the nightly read cheap as purchases grow.
- **PROD runbook (if approved):**
  1. A pre-check that both names are absent.
  2. Paste the two statements in the Supabase SQL editor. They contain no comments and no "into"; the literals are `pending`, `awaiting`, `payment`, `paid` with `chr(95)` where an underscore is needed (for example `'awaiting' || chr(95) || 'payment'`).
  3. A checker selecting `indexname` from `pg_indexes` for both.
  4. The rollback is two `DROP INDEX IF EXISTS`.
- Apply it before the deploy that schedules the cron. If it is not applied, the pass still works.

### 3.7 The 4a manual recovery

4a §7 step 6 is rewritten as **"Fallback only"**: after 4b.2 is deployed, a stuck purchase is recovered by the nightly pass or the admin trigger. The SQL plus Resend stays documented for an emergency (test mode only, pending / awaiting rows only).

---

## 4. Files to Create / Modify

| File | Slice | Action |
|---|---|---|
| `lib/business-os/boost/boostWebhookResolver.ts` (+ test) | 4b.1 | modify (charge events) |
| `lib/business-os/boost/boostChargeHandler.ts` (+ test, + matrix test) | 4b.1 | create |
| `lib/business-os/boost/boostWebhookHandler.ts` / `boostWebhookDeps.ts` | 4b.1 | modify (route charge events to the new branch) |
| `lib/audit/events.ts`, `eventAudience.ts`, `ownerEventPresentation.ts` (+ pins) | 4b.1 / 4b.2 | modify (`BOS_BOOST_PAYMENT_REVERSED`, `BOS_BOOST_RECONCILE_TRIGGERED`) |
| `app/api/stripe/webhook/__tests__/boostRouting.integration.test.ts`; characterisation | 4b.1 | modify / re-run (Connect byte-identical) |
| `lib/repositories/BusinessOsBoostPurchaseRepository.ts` (+ test) | 4b.2 | modify (`listForReconcile`) |
| `lib/business-os/boost/boostReconcilePass.ts` (+ deps, + test) | 4b.2 | create |
| `lib/business-os/billing/reconcilePasses.ts` | 4b.2 | create (the `ReconcilePass` type, the seam) |
| `app/api/cron/bos-billing-reconcile/route.ts` (+ test) | 4b.2 | create |
| `app/api/admin/business-os/credits/boost/reconcile/route.ts` (+ test) | 4b.2 | create |
| `vercel.json` | 4b.2 | modify (schedule, last) |
| `supabase/migrations/20261032_…_reconcile_indexes.sql` + checker, rollback | 4b.2 | create (if Q-7 yes) |
| Requirement, 4a workplan §7, this workplan | both | modify |

---

## 5. Task List

**4b.1**
- ✅ T4b.1 Resolver: the four charge events by stored payment intent + tests (row / no row / no pi / error / Connect)
- ✅ T4b.2 Charge handler + the outcome map + tests (every event × row state, livemode / currency, N-2, I-1, SQLSTATE classes)
- ✅ T4b.3 Audit event + owner presentation + pins
- ✅ T4b.4 Route integration (refund → `partially_refunded`; dispute created → `disputed`; won → `paid`; legacy pack charge unchanged; Connect untouched) + characterisation byte-identical for Connect

**4b.2**
- ✅ T4b.5 Repository `listForReconcile` + tests
- ✅ T4b.6 The boost pass + tests (stuck → credited / expired / failed / still processing; no session past 48 h; late reversal; receipt backfill; deadline; idempotent twice in a row; one bad row never stops the batch; C-9 disputes)
- ✅ T4b.7 The cron route (fail-closed auth, run record, passes seam) + tests
- ✅ T4b.8 The admin trigger route (`requireAdmin` first) + tests; admin access register (C-5)
- ✅ T4b.9 Migration 20261032 + pre-check, checker, rollback, migration test and the PROD runbook (§7); `vercel.json` last
- ✅ T4b.10 Docs: 4a §7 step 6 → fallback; requirement; go-live gate (C-6)

---

## 6. Test Plan

**Resolver:**
- each charge type with a row → `flow boost`;
- no row → `not_business_os` (and the legacy path unchanged at the route);
- no `pi_` → `not_business_os` with no read;
- a lookup error → throw;
- a Connect charge event → zero reads (dispatcher);
- metadata naming a boost while the payment intent matches nothing → still `not_business_os` (**never a metadata match**).

**Charge handler:**
- refund partial / full / stale / again (`already`);
- a refund on `pending` / `awaiting` / `expired` (N-2 alert + audit);
- a refund on a flagged row (`recorded`, I-1 warn);
- dispute created → won (`paid`) / lost (`dispute_lost`) / other status (`info`); `funds_reinstated` after `closed(won)` (`already`); a dispute-id mismatch (`not_allowed` alert);
- livemode / currency mismatch (no write);
- the C-1 SQLSTATE classes;
- the account is always the row's;
- **no call ever touches a lot** (a source guard: the handler and the pass import no lot repository or function).

**Pass:**
- a fake Stripe with paid / expired / open / processing / failed / missing sessions;
- the no-session row past 48 h;
- a late refund and a late dispute after crediting;
- receipt backfill;
- two consecutive runs → identical row state and one audit per effect;
- a transient error on one row → the rest processed, that row deferred;
- the deadline stops new rows;
- other-mode rows never read.

**Cron:** 401 without / with a wrong secret; production with no secret → 401 + `error`; the run record written; the passes seam (a fake second pass runs after boost).

**Admin route:** 401 / 403 via `requireAdmin` (the gate first, nothing read before it); 200 runs the pass; audited.

**Guards and pins:** audit pins, owner presentation, `enforcementPoints` (no entitlements import), `oneAddressPolicy` (Linux-path copy), `routerPlacement` (resolver placement), the repository caller guard (the cron route may name the webhook finders; the new reconcile read is named only by the pass and its deps).

---

### 6.1 Results (Dev, 2026-10-08): 4b.1

**What was built:**
- **`boostChargeEvents.ts`:** the four event types; the payment-intent key; the Zod narrowing of a Charge (refund) and a Dispute; `sameCurrency` (C-1, case-insensitive).
- **The resolver:** charge events are matched **only** by `findByPaymentIntentIdForWebhook`. No payment intent → `not_business_os` with no read (Q-2). No row → `not_business_os` (the legacy path). A lookup error → throw. Metadata is never read.
- **`boostChargeHandler.ts`:**
  - the cross-checks first: unreadable / livemode / currency (C-1), each giving an alert and `BOS_BOOST_FLAGGED`, with no write;
  - then 2b's `transition`, carrying the cumulative refunded amount or the dispute id: created → `disputed`; closed `won` / `funds_reinstated` → `dispute_won` (back to paid-family); closed `lost` → `dispute_lost`; other closed statuses → `info`, no call;
  - the outcomes:
    - `transitioned` / `recorded` → `error bos_boost_payment_reversed` + `alert`, and the new audit `BOS_BOOST_PAYMENT_REVERSED`; a refund recorded on a flagged row also gets a `warn` with its amount (2b I-1);
    - `already` / `stale` → `info`;
    - `not_allowed` on `pending` / `awaiting` / `expired` → `bos_boost_reversal_before_credit` + alert + `FLAGGED` (`reversal_before_credit`) (N-2, Q-3); any other `not_allowed` → alert + `FLAGGED`;
    - repository failures follow 4a C-1.
- **The wiring:** one flow handler (`handleBoostWebhookEvent`) routes charge events to the new branch and session events to 4a's.
- **Audit:** `BOS_BOOST_PAYMENT_REVERSED` (severity `warning`, audience `bos`; pins 193 / 48). The owner label is "Payment update" / "עדכון תשלום" / "Actualización del pago", with the details hidden (Q-4).
- **No admin or system audit in 4b.1** (C-7 is 4b.2's). **No lot is touched:** a source guard on the four 4b.1 files bans the lot tables, the lot repository, the lot function and the take-back names.

| Run (scratch configs, `--runTestsByPath`) | Result |
|---|---|
| New `boostChargeHandler.test.ts` (40: every event × row state on a fake following 20261031, cross-checks, the C-1 classes, `plan`, owner view, the lots guard) | ✅ |
| Resolver (+7 4b.1 cases: each event → flow; unknown intent; **no intent → legacy, no read**; **metadata never matches**; an expanded intent; a lookup error throws; Connect) | ✅ 35 |
| Route integration (+6: refund → transition + audit + completed, legacy refund handler not run; dispute created; transient → 500 + released; a non-boost intent → legacy; no intent → legacy with no boost read; a Connect refund → zero boost reads) | ✅ 17 |
| Mutations: the C-1 upper-case compare removed → 31 failures; the N-2 branch removed → 4 failures. Both restored (byte-compared) | ✅ |
| **Connect characterisation:** run with `--ci` (no snapshot can be written). **All 100 snapshots pass; the snapshot file is unchanged** (no platform charge entry gained a boost read) | ✅ |
| **Broad set** (`--ci`, 278 files: every boost, billing and Stripe suite, `app/api/cron/__tests__`, `components/business-os`, the entitlements set, `lib/audit`, `app/api/audit`, `app/admin/audit-trail`, `oneAddressPolicy` on a Linux-path copy) | ✅ **278 suites, 7,378 tests, 100 snapshots** |
| Scoped tsc, types-first (`tsconfig.4b.json`) | ✅ **0 errors in 4b.1 files** (61 elsewhere, untouched) |

**QA follow-ups (Dev, 2026-10-08), and the user's BQ-1 decision:**

| # | Change | Tests |
|---|---|---|
| QA4b-M1 (Medium) | A repeated `charge.dispute.created` (an admin Resend, or a retry) for a dispute the purchase has already **concluded** no longer reopens it. If the row is `paid` / `partially_refunded` / `refunded` and its stored `stripe_dispute_id` equals the event's dispute id → `info bos_boost_dispute_already_concluded`, no call, no audit, complete. A **new** dispute id on a paid row still opens a dispute. Handler only; no SQL change | R-1: created → won → the same created again (no call, no alert, no audit, stays paid); the same on partially refunded / refunded rows; a new id still opens |
| QA4b-M1 (out of order), **reported, not fixed** | `closed(won)` processed **before** `created` on a paid row: 20261031's dispute outcome branch refuses when the stored dispute id differs (`NULL` here), so `dispute_won` answers `not_allowed` (alerted) and **cannot store the id without a SQL change**. A later `created` then moves the row to `disputed` (stuck "Payment under review"). Rare: disputes take weeks to close, and Stripe sends `created` first. A fix needs 2b's function to store the id on that path (a migration), or 4b.2's pass to re-read open disputes. Left for SA / the user | R-1 "KNOWN GAP" pins today's behaviour |
| QA4b-L1 (Low) | §3.2 wording corrected (above): `reversal_before_credit` needs a stored payment intent (`awaiting_payment`, or `expired` / `failed` after it); a refund on a stuck `pending` purchase is legacy-path and recovered by 4b.2 | R-2 (resolver): a pending row with no stored payment intent → `not_business_os` |
| R-3 | The full event × row-state matrix on the 20261031 fake: 12 events × 11 states = **132 cells**, each pinning the answer (before-credit / transitioned / recorded / already / stale / not_allowed / ignored), complete, the row's account, and alert + audit per class | `boostChargeHandler.test.ts` |
| R-4 | `Usd` is the same currency; `"usd "` is a mismatch (no write); a string amount or a `tr_` id → `reversal_unreadable`; an email planted in `billing_details`, `receipt_email` and the dispute evidence never reaches a log or audit | handler suite |
| R-5 | `charge.succeeded`, `charge.dispute.updated`, `charge.refund.updated`, `charge.captured`, `charge.failed` → `not_business_os` with no read | resolver suite |
| **BQ-1 (user decision 2026-10-08)** | A **lost** chargeback (`dispute_lost`) shows **"Payment reversed"** in the Purchases list; an open dispute keeps "Payment under review"; refunds keep "Refunded" / "Partly refunded". A new owner status `reversed` (types, view map, chip colour), strings en "Payment reversed", es "Pago revertido", he "התשלום בוטל" (drafts, no digits). The return notice treats `reversed` like a refund (it hides; it is not an answer to "did my payment go through?") | view mapping (`dispute_lost` → `reversed`); the list chip in en / he / es with no digits; open dispute and refunds unchanged; the notice hides on `reversed` |

**Re-run after the follow-ups:**
- the handler and resolver suites: **223 + 41** tests green (the 132-cell matrix included);
- the purchases view, list, return-notice and purchases-route suites (BQ-1): **110** green;
- the **broad set** (`--ci`, 278 files, `oneAddressPolicy` on a Linux-path copy): **278 suites, 7,532 tests, 100 snapshots**, with **no snapshot change** (the Connect characterisation is byte-identical);
- **types-first tsc** (`tsconfig.4b1.json`, which adds the list, the notice and their tests): **0 errors in 4b.1 files** (85 elsewhere, untouched).

**Deviations:**
1. **A 4a resolver test changed on purpose:** "charge.refunded / charge.dispute.created → not_business_os (4b)" now uses other non-boost types; the charge events have their own 4b.1 tests.
2. **The refund target:** when our total is known, the cumulative amount against our total decides `refunded` versus `partially_refunded`. Only when it is not known (an uncredited row, which answers `not_allowed` anyway) is Stripe's `refunded` flag used.
3. **A refund event with `amount_refunded = 0` is ignored** (`info`, no call).
4. **Unreadable charge events** (e.g. a negative amount) are flagged in the audit (`reversal_unreadable`) and complete; the row is not moved.
5. **C-8 in 4b.1:** the webhook's dispute object carries its own id, so nothing needs expanding here. The expanded read is the 4b.2 pass's.

### 6.2 Results (Dev, 2026-10-09): 4b.2

**What was built:**
- **`BusinessOsBoostPurchaseRepository.listForReconcile({ kind, livemode, before, limit })`**, unscoped by design: `stuck` (`pending` / `awaiting_payment` with `checkout_expires_at < before`), `receipt_missing` (`paid`, no `receipt_url`, `paid_at < before`) and `disputed` (`status_changed_at < before`, for C-9). One mode per read, oldest first, the id as tie-break, at most 50. A source guard keeps it to the reconcile wiring.
- **`lib/business-os/boost/boostReconcilePass.ts`** (pure, ports injected) and **`boostReconcileDeps.ts`** (server-only wiring, lazy repository, the Business OS Stripe client, the key's mode). Three reads in order: stuck, disputed, receipts.
  - **Stuck:** a row with no session is expired after expiry + 48 h, with no Stripe read and never a credit (C-3). Otherwise `checkout.sessions.retrieve(id, { expand: ['payment_intent.latest_charge'] }, { timeout: 5000, maxNetworkRetries: 0 })` with a 6 s local bound. Paid → `credit` with the session's figures (4a's Zod narrowing), `BOS_BOOST_CREDITED` (with `source: 'reconcile'`), the receipt from the charge already in hand (no second Stripe read), then the charge's refund and dispute state. Expired, or open past `expires_at` → `expired`. Complete but unpaid with the intent at `requires_payment_method` / `canceled` → `failed` + `BOS_BOOST_PAYMENT_FAILED`. Still processing or open → left and counted. A 404 session, an unreadable session, a livemode or marker mismatch and a free session are findings with no write.
  - **C-2:** `already_credited` is a race (info). `not_allowed` and `not_creditable` re-read the row: if a webhook moved it out of the stuck set (or to paid), it is `raced`, with no alert and no audit; otherwise a finding.
  - **Late reversals (N-2, C-8):** the charge's cumulative `amount_refunded` goes through 4b.1's `plan`; a charge showing `disputed` has its dispute listed by the payment intent (see deviation 1), opened as `created` would, then concluded if Stripe says won or lost. No readable dispute is a finding (`dispute_id_unreadable`).
  - **C-9:** each `disputed` row's dispute is retrieved by the stored id: won → `dispute_won`, lost → `dispute_lost`, open → left. `warning_closed` and unknown statuses are findings (see deviation 4).
  - **Receipts:** the 4a `recordBoostReceipt` for `paid` rows 10 min after payment; a receipt not filled is counted, never alerted.
  - **Isolation:** a transient Stripe or SQL failure defers the row; a deterministic one is a finding; XX000 is deferred and alerted; an unexpected throw is deferred and alerted; the next row always runs. A Stripe key refusal (authentication / permission), a missing client or an unknown key mode **stops** the pass (every row would fail the same way) and is reported. **C-4:** no row starts with less than 10 s left; `deadlineHit` and `rowsLeft` are reported.
  - **Counts** (run record keys `boost<Key>`): examined, credited, expired, failed, stillProcessing, stillOpen, flagged, raced, reversalsApplied, disputesExamined, disputesConcluded, disputesStillOpen, receiptsExamined, receiptsFilled, receiptsNotFilled, deferred, deadlineHit, rowsLeft, batchFull, listFailed, stripeUnavailable. Findings do not colour the job (the settlement-gap precedent); deferred rows, the deadline, a failed list, no Stripe and a failed pass make it "partly done".
- **`lib/business-os/billing/reconcilePassRunner.ts`** (the `ReconcilePass` contract and `runReconcilePasses`: in order, one shared deadline, counters flattened as `<pass><Key>`, a throwing pass counted without stopping the next) and **`reconcilePasses.ts`** (THE SEAM: `RECONCILE_PASSES = [boostReconcilePass]`, the 45 s budget). P-8b appends its pass there and adds its counters to the job's registry entry.
- **`app/api/cron/bos-billing-reconcile/route.ts`**: the settlement-gap shape (fail-closed `verifyCronSecret`, `withCronRunRecord('bos-billing-reconcile', runJob)`, `maxDuration = 60`, `runtime = 'nodejs'`). Registered in `lib/cron/bosCronJobs.ts` (daily, `MAX_60`, `addedOn: '2026-10-09'`, 23 counts, 5 partly-done conditions). `vercel.json` gained `41 5 * * *`, added last.
- **`POST /api/admin/business-os/credits/boost/reconcile`**: `requireAdmin` first; the body must be empty or `{}` (strict Zod); a write-ahead `BOS_BOOST_RECONCILE_TRIGGERED` (`warning`, SOC2, audience `bos`) flushed before the pass, on entity `system` with a server-generated run id and the admin as user and actor (C-7); then the boost pass once, trigger `admin`, 45 s deadline; counts only in the response. Registered as row 102 of the admin access register (C-5), with the census re-measured (99 = 93 + 6 + 0 open, 69 files; rows 99–101 register the three test-account cleanup handlers that `main` already had unregistered).
- **Migration 20261032** (two partial indexes, plain `CREATE INDEX` in one transaction), its rollback (`DROP INDEX IF EXISTS`), a read-only pre-check and a checker with a VERDICT row, all pinned by `business-os-boost-reconcile-indexes.migration.test.ts`; the runbook is in §7.
- **4a §7 step 6** is marked "fallback only"; its SQL is unchanged (still pinned by `boostRecoverySql.doc.test.ts`).
- **Lots are never touched:** a source guard over the six new production files bans the lot tables, repository, function and take-back names.

| Run (scratch configs, `--runTestsByPath`, `--ci`) | Result |
|---|---|
| New `boostReconcilePass.test.ts`: 72 (a fake following 20261031 + a fake Stripe that moves a fake clock): every stuck state × Stripe outcome; C-3 incl. an expired no-session row + a late paid event → `mismatch no_session`, alerted, no lot; C-2 (credit race, expire race, a genuine disagreement, two overlapping runs → one credit, one audit); run twice → identical rows and audits; C-4 (9 of 20 rows at 4 s per read, `rowsLeft` 11, later reads not started); the 50-row bound; per-row isolation (5xx, connection error, 23514, 40001, a thrown defect, XX000); key refusal stops; late refund (partial, full), late dispute (open, won, lost), C-8 no readable dispute, currency mismatch; C-9 (won, lost, two open statuses, the out-of-order `closed(won)` before `created` healed, `warning_closed`, 404, another payment, unreadable, no stored id, timeout); receipts; the counters equal the registry; every audit on the purchase and its own account | ✅ |
| Repository (+8: each kind's exact query, no `user_id`, the clamp, refusals before any query, transient vs unreadable, the caller guard; the 4a `findByIdForWebhook` guard now allows `boostReconcileDeps.ts`, see deviation 2) | ✅ 81 |
| `reconcilePassRunner.test.ts` 5; cron route 8 (no header / wrong / no Bearer → 401, production with no secret → 401 + error, development, order + shared deadline + flattened counts, a throwing pass, the route shape); admin route 22 (G-1…G-6, six refused bodies, three accepted, the audit before the pass on `system` with the run id, boost pass only, counts, no cron record, no `CRON_SECRET`, no email in logs); migration test 42 | ✅ |
| Registry and gates: `bosCronJobs` 93 and `vercelCrons` 10 (17 jobs), `runRecord.adoption` 55 (the new job records start + finish as succeeded with numeric counts; a test-mode key is set so "nothing to do" is a clean run), `adminGate.writes` 328 (64 → 65 cases), `eventAudience` (194 / 49 bos) | ✅ |
| **`test:authz-guard` equivalent**: `admin-authz-surface.guard.test.ts` + `security-definer-surface.guard.test.ts` | ✅ |
| Mutations (each restored, SHA-1 checked): C-2 re-read removed → 1 red; the C-4 margin set to 0 → 1 red; C-3 no-session branch removed → 4 red | ✅ |
| **Connect characterisation** run with `--ci` (no snapshot can be written): **all snapshots pass; no snapshot file changed** | ✅ |
| **Broad set** (`--ci`, 338 files: every boost, billing, entitlements, cron, audit, admin API, Stripe, payments, credits, `components/business-os`, `supabase/__tests__` and migration suite) | ✅ **337 suites, 9,567 tests, 110 snapshots**. The one red suite, `scripts/__tests__/stripePlanPriceScripts.test.ts` (2 tests), spawns `<worktree>/node_modules/tsx`, which this worktree does not have (no junction, by rule); it is environmental, and none of its files are touched here |
| `oneAddressPolicy` on a Linux-path copy (deleted after) | ✅ 4 |
| Scoped tsc, types-first (`tsconfig.4b2.json`) | ✅ **0 errors in 4b.2 files** (73 elsewhere, untouched, pulled in through the admin gate test's imports) |

**Deviations (for SA):**
1. **C-8, the dispute id:** in Stripe API `2025-10-29.clover` (SDK 19) a Charge has `disputed: boolean` but **no `dispute` field**, so `latest_charge.dispute` cannot be expanded. The pass lists the disputes **by the payment intent** (`disputes.list({ payment_intent, limit: 10 })`, same 5 s bound) and takes the newest. No readable dispute is a finding, as C-8 asks. This costs a second Stripe read, only for a charge that shows `disputed`.
2. **The C-2 re-read uses `findByIdForWebhook`** (the row by its own id, which the pass read from our table a moment ago). Its source guard (SA Q-1) now also allows `lib/business-os/boost/boostReconcileDeps.ts`; the pass itself names only a `reread` port. The alternative was a duplicate by-id method.
3. **The admin trigger writes no `bos_cron_runs` row.** `withCronRunRecord` records only a proven Vercel call and its repository has one permitted caller, and the "Drain now" precedent (7d C7-11) says an admin press must not record a run of the scheduled job, so a dead cron still shows as dead. The durable trace of a press is the write-ahead audit row (with the run id) plus the counts in the response and the log. §3.5 said "through `withCronRunRecord` with `trigger: 'admin'`".
4. **`warning_closed` (and any unknown dispute status) is a finding, not a conclusion.** C-9 named won, lost and open only. An inquiry that closed without becoming a chargeback leaves the purchase `disputed` ("Payment under review") until a person looks; mapping it to `dispute_won` would be a guess. It repeats nightly until handled. **Question for SA:** map `warning_closed` to `dispute_won`?
5. **No reversal check on receipt-backfill rows.** Those rows were credited by the webhook, so their refunds and disputes reach the webhook (or are the C-6 residual); the extra Stripe read was not worth it.
6. **The pass never flags a row itself** for its own findings (a 404 session, an unreadable session, a livemode or marker mismatch, a free session): it alerts and audits `BOS_BOOST_FLAGGED` with the reason and leaves the row, so a finding repeats each night until a person acts (slice 6 lists them). Only the SQL's own `mismatch` flags a row.
7. **Two runner files** instead of one: `reconcilePassRunner.ts` (pure contract and runner) and `reconcilePasses.ts` (the server-only pass list, the seam). The split keeps the runner testable without the server-only wiring.
8. **`addedOn: '2026-10-09'`** in the job registry must be the real deploy day (a date before the deploy brings back a false "Stopped"). If the merge lands later, RM updates it in the same PR.
9. **The disputed read has no index** (the approved migration has two). Disputed rows are rare; a third index was not added without SA.

**Review fixes (Dev, 2026-10-09): SA CR-1 to CR-3, QA4b2-M1, QA R-1 to R-5.**

| # | Change | Tests |
|---|---|---|
| **CR-1 / QA4b2-M1** (Medium) | **One record per problem, not one per night.** `finding()` now has three modes. **A stuck row** (`pending` / `awaiting_payment`) with any finding (404 / 400 / unreadable session, session, livemode or marker mismatch, a free session, a missing intent or amounts, a still-stuck `not_allowed`) is flagged once with `transition('flagged_mismatch', reason)` (2b allows it from both; `flag_reason` is free text of at most 64 characters). That writes the one `BOS_BOOST_FLAGGED` (with `flag_applied: true`), takes the row out of the stuck set (no nightly Stripe re-read) and lists it for slice 6. If the row moved before the flag (a webhook won), or the flag call fails, it falls back to "audit once". **A row that cannot be flagged** (`disputed`, `paid`, a moved row) is alerted (`error`, `alert: true`) on every run, with `repeat: true` after the first, but audited **only the first time**. **"First" is detected without a migration** by a new, narrow existence check, `AuditTrailRepository.hasFindingEntry({ accountId, purchaseId, reason })`: a head count (no row, no `details` returned) on `audit_trail` scoped `.eq('user_id', <the purchase's own account>)`, entity `business_os_boost_purchase` + the purchase id (the indexed entity id), action `BOS_BOOST_FLAGGED`, `details->>reason`. Its only caller is `boostReconcileDeps.ts` (a source guard pins it). If the check fails, the audit is **skipped** (a `warn`; the alert still fires), so a broken read can never turn into a nightly duplicate. **Why this and not the alternatives:** an operator-only repeat needs a new owner-hidden entity type plus an owner-policy migration; a `status_changed_at` window misses a finding that first appears weeks after the row moved (an open dispute that later takes an unknown status) and double-counts a cron run plus an admin press on the same day; "never audit" loses the one owner-visible record SA asked for. Known limit: two runs overlapping on the same row can each see "no record yet" and both audit (rare: the cron plus an admin press at the same second). **The SQL's own flags** (`credit` → `mismatch`, `transition` → `mismatch`) are audited as before: the row has already left the stuck set, so they cannot repeat. A deterministic SQL failure is never followed by a flag call (`once` mode). | R-1: six stuck causes (404, 400, unreadable, livemode, marker, free) × two runs → exactly one FLAGGED and run 2 reads nothing; five disputed causes (unknown status, 404, another payment, `eur`, unreadable) × two runs → alerted twice, one FLAGGED, `repeat` false then true, no transition; the lookup failing → no audit, alert kept; a row that moved before the flag → audit once. `hasFindingEntry`: 4 (exact query, false, errors and bad input read nothing, the caller guard). Mutations: the "first only" check removed → 5 red; the stuck flag removed → 12 red |
| **CR-2** (Low) | `warning_closed` → `dispute_won` in the pass (C-9 and after a credit) **and** in 4b.1's webhook `plan()` (`charge.dispute.closed`), so the live event and the nightly pass agree. Other unknown statuses stay findings in the pass and `info` in the webhook | R-2: the pass (`disputed` + `warning_closed` → `paid`, one REVERSED, no finding); the webhook (`closed warning_closed` on a disputed row → `dispute_won` → `paid`, alert + REVERSED); the 132-cell matrix row for `closed warning_closed` now equals `closed won`; `prevented` stays ignored / a finding |
| **CR-3** (Low) | `ROW_MARGIN_MS` 10 s → **15 s**: one row can make two 6 s-bounded Stripe reads plus SQL, so 45 s + 15 s = `maxDuration` | C-4 test: 8 rows (not 9) at 4 s per read, `rowsLeft` 12. R-3: a row making two 6 s reads is not started at 34 s (11 s left) and the run ends at 34 s; started at 29.75 s it ends at 41.75 s; never past the 45 s deadline. Mutation: the margin back to 10 s → 3 red |
| R-4 | Cron route: an **empty** `CRON_SECRET` in production refuses `Bearer `, `Bearer`, `Bearer undefined`, `Bearer null` and no header; a lower-case `bearer` scheme → 401 | +2 |
| R-5 | Admin route: bodies `0`, `"x"`, `{"runId":…}` and a truncated `{` → 400 with no audit and no pass | +4 |

**Re-run after the fixes:** the pass 88, the charge handler 183 (incl. the matrix), cron route 10, admin route 26, `hasFindingEntry` 4: all green. **Broad set** (`--ci`, 341 files, now also `AuditTrailRepository*` and `adminReadMethods.guard`): **340 suites, 9,655 tests, 110 snapshots**; no snapshot file changed (Connect characterisation unchanged); the one red suite is again the environmental `stripePlanPriceScripts` (no `node_modules/tsx` in this worktree). `oneAddressPolicy` on a Linux-path copy: 4 green. Types-first tsc: **0 errors in changed files** (73 elsewhere, unchanged). All mutations restored (SHA-1 identical).

**Deviation rulings applied:** 4 (SA: `warning_closed` → `dispute_won`) and 6 (not accepted → CR-1) are superseded by the rows above.

## 7. Go-live and operations

**After 4b.1 deploys:**
- Refunds and disputes on boost charges are recorded and alerted.
- The Stripe events `charge.refunded` and `charge.dispute.*` are already on the DEP-9 list (4a §7).

**Before the 4b.2 deploy: the PROD runbook for migration 20261032** (Supabase SQL editor; nothing here writes to `auth.users`; no file contains a comment or the word "into"):
1. **Pre-check** (one tab): paste `scripts/precheck-bos-boost-reconcile-indexes.sql`. It makes the session read-only, so **open a NEW tab for step 2**. Expect: `Q1 … exists`; both `Q2 index absent …` rows `yes` (a `NO … stop here` means it was already applied: skip to step 3); `Q3` lists the table's current indexes; `Q4` gives row counts only (total, pending or awaiting payment, paid with no receipt link, disputed).
2. **Apply** (a NEW tab): paste `supabase/migrations/20261032_business_os_boost_reconcile_indexes.sql` (one `BEGIN … COMMIT`, two `CREATE INDEX`). It takes a brief write lock on `business_os_boost_purchases` only; the table is small. A second paste fails with "already exists", which is safe.
3. **Checker** (any tab): paste `scripts/check-bos-boost-reconcile-indexes-migration.sql`. Expect `VERDICT PASS` (10 pass, 0 fail): each index exists, is on the purchases table, valid and ready, on one column, and partial on the right statuses.
4. **Rollback, only if needed:** `supabase/SQL Scripts/20261032_business_os_boost_reconcile_indexes_rollback.sql` (two `DROP INDEX IF EXISTS`). The pass still works without the indexes; it only reads more of the table.

**After 4b.2 deploys:**
1. Confirm `CRON_SECRET` is set on Vercel Production (it is, per the payment queue-drain). Without it every call is refused (fail-closed).
2. The `STRIPE_SECRET_KEY` mode decides which rows are read (test key → test purchases only).
3. The nightly run (05:41 UTC) appears in `bos_cron_runs` as `bos-billing-reconcile` and on `/admin/jobs-queues` as "Billing reconcile". `boostFlagged` > 0 means a `bos_boost_reconcile_finding` error log to read.
4. Admins can trigger a run with `POST /api/admin/business-os/credits/boost/reconcile` (body `{}`) now, and from the slice 6 button later. Each press is one `BOS_BOOST_RECONCILE_TRIGGERED` audit row.
5. 4a §7 step 6 (SQL plus Resend) is now the emergency fallback only.

**Real-money gate (4a SA point 7):** 4b.1 and 4b.2 merged and deployed, and migration 20261032 applied with a `VERDICT PASS`. **Residual (SA C-6), recorded at 4b.2:** a refund or dispute event whose webhook claim gets stuck in `processing` is not recovered by the pass; the money facts stay in Stripe and only the flag is missing. P-8b's in-webhook reclaim closes it, or an admin resends the event from Stripe. P-8b's in-webhook reclaim is not required for boost, because this pass covers boost purchases without it (R-8). Then DEP-3, DEP-7, DEP-8, DEP-9 and the first live receipt.

---

## 8. Estimate, split and risks

| Item | Value |
|---|---|
| Estimate | **About 2.75 days.** 4b.1 about 1.25 d; 4b.2 about 1.5 d (+0.25 d with the index migration) |
| Split | **Proposed.** 4b.1 is independent and closes FR-35 / FR-36; 4b.2 closes FR-43 |
| CI | Mocked suites in existing jobs |
| Entitlements | No import from the entitlements module |

| Risk | Mitigation |
|---|---|
| A refund recorded on the wrong purchase | Matched only by our stored payment intent; no metadata path; a test for it |
| A refund before crediting is lost | N-2 alert now; the pass applies the charge's refund state after crediting |
| Overlapping runs (cron plus admin) | Effects are row-locked and idempotent; Stripe reads only; tests run the pass twice |
| A long batch hits `maxDuration` | 45 s deadline, batch 50, per-call 5 s Stripe bound; leftovers next night |
| Credits kept after a refund | By decision (FR-37, T-9): alert + audit; an admin takes back through 11b |

---

## 9. Notes

| For | Note |
|---|---|
| P-8b | Append `planReconcilePass` to `RECONCILE_PASSES` in `lib/business-os/billing/reconcilePasses.ts` (contract in `reconcilePassRunner.ts`); the route needs no change. Add the pass's counters (`plan<Key>`) to the `bos-billing-reconcile` entry in `lib/cron/bosCronJobs.ts`, or the run record drops them. The in-webhook reclaim stays P-8b's |
| Slice 6 | The admin view lists `flagged_mismatch` (with reason), refunded, disputed and `bos_boost_reconcile_finding` rows, and hosts the reconcile button |
| Clawback | Automatic clawback stays parked (T-9); slice 11b's take-back is the tool |
| **BQ-1: decided by the user 2026-10-08 (yes)** | A lost dispute (`dispute_lost`) shows **"Payment reversed"** in the Purchases list; an open dispute keeps "Payment under review"; refunds keep their words. Built in 4b.1 (§6.1) |

---

## 10. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | Split 4b.1 / 4b.2, or one PR? | Split |
| Q-2 | Disputes without a `payment_intent`: add a charge-id lookup (`findByChargeIdForWebhook`), or leave them to the legacy path? | Leave them: Stripe sets `payment_intent` on PaymentIntent charges; a log-only test pins it |
| Q-3 | A refund that arrives before crediting: alert + audit now and apply it in the pass after crediting (proposed), or have the webhook throw and retry until crediting happens? | Alert + audit now, apply in the pass: no retry loop |
| Q-4 | `BOS_BOOST_PAYMENT_REVERSED`: owner-visible with a neutral label and hidden details (proposed), or operator-only (needs an owner-policy migration)? | Owner-visible, neutral, details hidden; no migration |
| Q-5 | Is the "not a queue drain" ruling right? No claim RPC; the effects are row-locked, idempotent SQL functions plus Stripe reads | Yes, the settlement-gap precedent |
| Q-6 | The admin trigger route in 4b.2, with the button UI in slice 6? | Yes |
| Q-7 | The optional index-only migration 20261032 (two partial indexes), now or when the table grows? | Now, in 4b.2: tiny, safe, keeps the nightly read cheap |
| Q-8 | The grace periods: stuck = expiry + 30 min; no-session rows expired after expiry + 48 h; receipt backfill after `paid_at` + 10 min | As listed |

## Business questions

**BQ-1: what an owner sees after a payment reversal.**
- Today a refund shows **"Refunded"** / **"Partly refunded"**, and any dispute, open or lost, shows **"Payment under review"**.
- The credits stay unless an admin takes them back (FR-37). So after a **lost** chargeback the owner would read "Payment under review" indefinitely.
- **Proposal:** a lost dispute reads **"Payment reversed"**, and an open dispute keeps "Payment under review".
- This is a wording choice that the owner sees, so it is the user's.

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-08, against `790e2ca8`**
**Status:** ✅ Approved with conditions (C-1 to C-8). The Dev writes them in first, and no second review is needed. **One business question (BQ-1) stays with the user**; my recommendation is below.

The design is right:
- charge events are matched **only** by our stored payment intent (4a N-1);
- reversals go through 2b's transition function, and lots are never touched (T-9);
- deterministic outcomes complete and transient ones throw;
- the reconcile cron is a pass over row-locked, idempotent SQL plus Stripe **reads**, so there is no claim RPC.

It closes FR-35, FR-36 and FR-43, and with 4b.2 it satisfies the real-money gate's "4b plus a stuck-purchase recovery" (R-8).

#### The points asked

1. **Payment-intent-only match (Q-2):** a boost payment is always a PaymentIntent charge (slice 3), so `charge.payment_intent` and `dispute.payment_intent` are always set. A charge with no payment intent cannot be a boost charge and keeps the legacy path, which is correct. No charge-id lookup is needed. ✅
2. **Deterministic versus transient, end to end:**
   - **Webhook:** every `transition` outcome is a status, so the event completes. A refund before crediting (N-2) is alerted and audited and completes, so there is no retry loop. **The fact is not lost:** the pass credits the row, then re-reads the charge and applies its cumulative refund or dispute state.
   - **The pass:** never throws for one row. Transient errors are deferred to the next run, and deterministic ones are alerted.
   - ✅, with C-2 for the race below.
3. **Overlapping runs (cron + admin, or cron + webhook):** 2b's `credit` and `transition` lock the purchase row `FOR UPDATE`, and the lot key `boost:<session>` is unique.
   - Two credits → one `credited`, one `already_credited`.
   - Two transitions → `transitioned` / `already` (or `stale`).
   - **No double credit is possible.** A **status race** is possible: the pass reads a session as unpaid or expired while the webhook credits it, then calls `transition('expired')` → `not_allowed`. That must not alert (C-2). No claim RPC is needed (Q-5).
4. **The 48 h no-session expiry and a late payment:** correction to §3.4 step 2. A row with **no stored session** can **never** be credited. 4a's C-3 (a) fallback calls `credit`, and 2b's `credit` flags such a row `no_session` **by design** (slice 3 C-2: an orphan session is visible and refundable, never silently credited). So "credit accepts `expired`" is not why this is safe. The real reason is that the late payment still **reaches the row and is flagged**, whether the row is `pending` or `expired`. C-3 (b) of 4a ("never mutate a row with a different stored session") does not apply to a NULL session. **Expiring after 48 h is safe and only stops the row counting toward the cap.** Fix the §3.4 wording (C-3).
5. **Stripe budget versus the deadline:** batch 50 × 5 s worst case exceeds 45 s, so the deadline must stop **starting** rows early enough (C-4). `maxDuration = 60` leaves headroom.
6. **Cron auth and the admin route:**
   - The cron uses the fail-closed `verifyCronSecret` and `withCronRunRecord` (settlement-gap precedent).
   - The admin route has `requireAdmin` as its first statement. The `Admin authz surface guard` (a required check) scans every `app/api/admin/**` handler; a new **gated** handler passes it without changing its exemption caps. The route must also go in the admin access register (C-5).
   - `vercel.json`: the cron line goes last, at `41 5 * * *`.
   - **No CI time is added** (mocked suites in existing jobs).
7. **The go-live gate:** after 4b.1 **and** 4b.2 are deployed, boost no longer needs P-8b's in-webhook reclaim (R-8). One residual remains (C-6).
8. **Owner-visible audit:** `BOS_BOOST_PAYMENT_REVERSED` gets a neutral owner label with the details hidden (4a C-5 pattern). `BOS_BOOST_RECONCILE_TRIGGERED` must not land on the owner's entity (C-7).

#### Conditions

| # | Severity | Condition |
|---|---|---|
| **C-1** | **Medium** | **Currency case** (as 2b C-2): Stripe charges carry `currency: 'usd'` and the row stores `'USD'`. Compare `charge.currency.toUpperCase()` with `row.currency`, or every boost refund would be wrongly alerted as `currency_mismatch` with **no write**, which would lose the refund fact. Test with lower-case `usd`. |
| **C-2** | **Medium** | **A pass racing the webhook.** When the pass's `transition` / `credit` answers `not_allowed`, `not_creditable` or `already_credited` on a row it read as stuck, re-read the row. If it is now paid-family (or otherwise final), count it `raced`, log `info`, and **do not alert or audit**. Only a genuine disagreement after the re-read is a finding. Test: the row is credited between the batch read and the call. |
| **C-3** | Low | **§3.4 step 2 wording:** a NULL-session row is never credited. A late payment is flagged `no_session` (4a C-3 a, slice 3 C-2), and expiring the row after 48 h only stops it counting toward the cap. Fix the text and add a test: an expired no-session row plus a paid session event → `mismatch` / `no_session`, alerted, no lot. |
| **C-4** | Low | **Deadline:** stop starting new rows when less than **10 s** remains before the 45 s deadline (one row is at most 5 s session + 5 s receipt plus the SQL calls). The counters report `deadline_hit` and the rows left. |
| **C-5** | Low | **Admin route registration:** add it to the admin access register (`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`), and run `npm run test:authz-guard` (a required check) in the definition of done. |
| **C-6** | Low | **Residual, recorded in §7:** a `charge.refunded` / `charge.dispute.*` event whose webhook claim gets **stuck in `processing`** (F-1) is not recovered by this pass, because the pass reads only stuck **pending / awaiting** rows and receipt gaps, not paid rows. Credits stay and the money facts are in Stripe, so the effect is a missing flag, not lost money. **P-8b's in-webhook reclaim** closes it, or an admin can resend the event. It is acceptable for go-live; name it in the gate text. |
| **C-7** | Low | **`BOS_BOOST_RECONCILE_TRIGGERED`** is written against an admin / system entity (for example the cron-run id, with the admin as `userId`), **not** `business_os_boost_purchase`, so it never appears in an owner's audit. A test pins its entity type. |
| **C-8** | Low | **Late-reversal read:** expand `payment_intent.latest_charge` (and the dispute when present: `latest_charge.dispute` is an expandable id) so the pass has the dispute **id** that `transition` requires. A charge that shows `disputed: true` without a readable dispute id is a finding, not a guess. |

#### Rulings on Q-1 to Q-8

| Q | Ruling |
|---|---|
| **Q-1** | **Split**, 4b.1 then 4b.2. |
| **Q-2** | **No charge-id lookup** (point 1); keep the log-only test. |
| **Q-3** | **Alert and audit now; the pass applies it after crediting.** No retry loop. |
| **Q-4** | **Owner-visible, neutral label, details hidden**; no migration. |
| **Q-5** | **Yes: not a queue drain** (point 3), with C-2. |
| **Q-6** | **Yes:** the admin route in 4b.2 and the button in slice 6, with C-5 and C-7. |
| **Q-7** | **Yes, now:** migration `20261032`, with paste rules, pre-check, checker and rollback, and a migration-test pin. The `IF EXISTS` in the rollback is fine. The migration itself uses plain `CREATE INDEX` (not `IF NOT EXISTS`, so a second paste fails safely). |
| **Q-8** | **As listed** (stuck = expiry + 30 min; no-session expired after expiry + 48 h; receipt backfill after `paid_at` + 10 min), with C-3. |

#### BQ-1, for the user (SA view)

**I recommend yes:** after a **lost** chargeback, show **"Payment reversed"**, and keep "Payment under review" only while the dispute is open. "Under review" forever is not true once the bank has decided, and it invites support questions. It is display-only (the owner status map in `boostPurchasesView.ts`, plus three strings), with no data or money effect. The credits question stays separate (FR-37: an admin takes them back manually).

#### Approval

[x] Workplan approved with conditions C-1 to C-8. Proceed with 4b.1. BQ-1 is wording only: 4b.1 may start before the user answers, and the answer lands in whichever slice is open.

### SA Code Review (4b.1)

**Code Review by SA — 2026-10-08**
**Status:** ✅ **Code Approved for QA.** There are no must-fix items.

#### What I verified myself

| Check | Result |
|---|---|
| 19 suites: the charge handler, the resolver and the 4a handler; **every** `app/api/stripe/webhook/__tests__` suite (incl. the Connect characterisation, `routerPlacement`, `pinoLogging`, the boost routing integration); the dispatcher; the repository; the audit pins and the owner presentation | ✅ **553 passed, 100 snapshots passed**, with **no snapshot file changed** (`git status` clean under `__snapshots__`) |
| Types-first `tsc` over every touched `.ts` | ✅ **0 errors** |
| Mutation M1: `sameCurrency` made case-sensitive (C-1) | ✅ Caught (28 red) |
| Mutation M2: a transient repository failure returns instead of throwing | ✅ Caught (6 red) |
| Restoration after each mutation | ✅ SHA-1 checked |

#### The rules asked

- **Payment intent only:** the resolver reads `charge.payment_intent` / `dispute.payment_intent` and looks the row up with `findByPaymentIntentIdForWebhook`. No payment intent → `not_business_os`. No row → `not_business_os`, so the legacy path is unchanged. A lookup error throws. There is **no metadata route and no charge-id lookup** (Q-2). The handler finds the row again by the same payment intent. ✅
- **Lots never touched:** a source guard checks that the charge handler and charge-events modules name no lot table, lot repository, `record_credit_lot`, `confirmPaidCredits` or take-back. Every write is 2b's `transition`. ✅
- **Deterministic versus transient:**
  - **Return** for: an unreadable event (`reversal_unreadable`, alert and audit), livemode / currency mismatch (alert and audit, no write), deterministic SQLSTATE classes, `not_allowed`, an unexpected status, and a zero refund (ignored).
  - **Throw** for transient and `XX000` (alerted). M2 proves it.

  ✅
- **Refund before credit (N-2):** `not_allowed` from `pending` / `awaiting_payment` / `expired` → `bos_boost_reversal_before_credit`, alert, `BOS_BOOST_FLAGGED`, and **complete**, so there is no loop. The fact is kept in Stripe (the charge's cumulative `amount_refunded` and dispute), where the 4b.2 pass reads it after crediting. ✅
- **Refunds on flagged rows (I-1):** `recorded` from `flagged_mismatch` → the reversal audit plus a `warn` carrying the amount. ✅
- **C-1 currency:** `sameCurrency` upper-cases both sides. M1 proves it. ✅
- **C-8 dispute id:** the dispute event object carries `dispute.id` and `payment_intent` directly, so no expansion is needed on the webhook path (deviation 4, accepted). The 4b.2 pass still needs the expansion when it reads through the session. ✅
- **Full versus partial refund:** decided by `amount_refunded ≥ our stored amount_total_minor`, or by Stripe's `refunded` flag when our total is not yet stored (deviation 1). 2b's SQL re-checks it, and a mismatch is `not_allowed`, never a wrong status. ✅
- **Owner-visible audit:** `BOS_BOOST_PAYMENT_REVERSED` is labelled "Payment update" in en/he/es and is in `OWNER_NEUTRAL_EVENTS` (details emptied for owners). The details hold codes and amounts only (no Stripe secret or email); admins keep them. ✅
- **Connect untouched:** the dispatcher returns before any resolver for `event.account`, and the characterisation passes with no snapshot change. ✅
- **`findByPaymentIntentIdForWebhook`'s callers:** in `app/`, the existing source guard allows only the webhook and reconcile-cron routes. In `lib/`, only the boost resolver, the charge handler and their webhook-only deps use it. ✅

#### §6.1 deviations: all four accepted

#### Code Approved for QA: **Yes**

**SA re-check of the 4b.1 follow-ups (2026-10-08, diff only):** ✅ still Code Approved, **ready for the user's diff and commit**.
- **QA4b-M1:** a `dispute.created` repeating the stored dispute id on a paid-family row is answered as info, with no call and no audit; a new dispute id still opens.
- **BQ-1 (user: yes):** `dispute_lost` maps to the owner status `reversed` ("Payment reversed"; he/es drafts), and the return notice hides on it.
- **QA tests:** R-1 to R-5 and the matrix pass. 376 tests and 100 snapshots green, and the Connect snapshots are unchanged.
- **Ruling on the out-of-order dispute gap ("closed won" before "created"): option (b), recorded as condition C-9 on 4b.2.** The nightly pass also selects rows in `disputed` (current mode, bounded, oldest `status_changed_at` first, within the same deadline and C-4 margin). For each it retrieves the dispute **by the stored `stripe_dispute_id`** (5 s, no retries): `won` → `transition('dispute_won')`; `lost` → `transition('dispute_lost')`; still open → leave it. Because `created` stored the id, 2b's id match succeeds, so **no SQL change is needed**. Missed or stuck `closed` / `funds_reinstated` events also self-heal. Option (a) is rejected because it changes 2b's state machine for a rare order. Option (c) is rejected because "under review" would stay wrong indefinitely.

### SA Code Review (4b.2)

**Code Review by SA — 2026-10-09 (branch `feature/bos-credits-boost-slice-4b2`, off `88b1938f`)**
**Status:** 🔄 **Fix Required: one Medium (CR-1), two Low (CR-2, CR-3).** Everything else is approved. After the fixes, SA re-checks only that diff, and the code goes to QA.

#### What I verified myself

| Check | Result |
|---|---|
| 14 suites (`--ci`): the pass, the runner, the cron and admin routes, the migration test, the repository, `bosCronJobs`, `vercelCrons`, `runRecord.adoption`, `adminGate.writes`, **`admin-authz-surface.guard`**, `eventAudience`, the Connect characterisation, `entitlementSqlScripts.guard` | ✅ **1,031 passed, 103 snapshots** (no snapshot written: `--ci`) |
| Mutation M1: the pass credits any session that is not `no_payment_required` (i.e. `unpaid` too) | ✅ Caught (8 red) |
| Mutation M2: the cron auth check bypassed | ✅ Caught (4 red) |
| Restoration after each mutation | ✅ SHA-1 checked |
| The Dev's `stripePlanPriceScripts` red | ✅ **Environmental:** it spawns `<root>/node_modules/tsx/dist/cli.mjs`, which this worktree has no `node_modules` for (no junction, by rule). The test file is byte-identical to `origin/main`, and nothing it covers is touched. CI has `node_modules`, so it runs green there |
| The SQL files (migration, pre-check, checker, rollback) | ✅ No comments, no word **into** in a literal, no `auth.users`. Plain `CREATE INDEX` in one transaction; the rollback uses `DROP INDEX IF EXISTS`; the pre-check is read-only |

#### C-2 to C-9, end to end

- **C-2 race:** `already_credited` is info. `not_allowed` / `not_creditable` re-read the row (`findByIdForWebhook`, deviation 2, accepted); if it is no longer stuck it counts as `raced`, with no alert or audit. ✅
- **C-3:** a no-session row is expired after 48 h with no Stripe read and is never credited. A late paid event becomes `mismatch` / `no_session` (tested). ✅
- **C-4:** no row starts with less than 10 s left. ✅ But see CR-3.
- **C-5:** the admin route has `requireAdmin` as its **first statement** and passes the required `admin-authz-surface` guard (`adminGate.writes` goes 64 → 65). Register row 102 is added, and doc-only rows 99–101 record the pre-existing test-account-cleanup handlers; census 99 = 93 + 6 + 0. ✅
- **C-6:** the residual is recorded (§7). ✅
- **C-7:** `BOS_BOOST_RECONCILE_TRIGGERED` is written on entity `system`, with the **admin** as `userId` and a server run id only. `system` is owner-visible, so the **admin** can see their own action in their own audit and no other owner can. That meets C-7's intent ✅ (Info: if a strictly operator-only trace is wanted later, an operator entity type is a small follow-up.)
- **C-8:** deviation 1, accepted. In API `2025-10-29.clover` a Charge has no `dispute` field, so `disputes.list({ payment_intent, limit: 10 })` with the same 5 s bound, newest dispute taken, none readable → finding. ✅
- **C-9:** `disputed` rows are re-read by the stored id: won → `dispute_won`, lost → `dispute_lost`, open → left. ✅
- **Lots never touched:** a source guard covers the six new production files. ✅
- **Overlap with the webhook:** every write goes through 2b's row-locked, idempotent functions, and the "two overlapping runs → one credit, one audit" test passes. ✅
- **Cron auth:** fail-closed `verifyCronSecret` (production without `CRON_SECRET` → 401 + `error`, M2). `maxDuration = 60`. ✅
- **Tenant isolation of `listForReconcile`:** cross-account **by design** (a cron). Its source guard keeps it to the reconcile wiring, the result never leaves the server (the cron and admin responses are counts only), and every write runs on the row's own `user_id` through SQL. ✅
- **Logs:** ids, statuses, codes and SQLSTATEs; no Stripe key, client secret or email. ✅
- **No added CI time:** mocked suites in existing jobs. ✅

#### Deviations

| # | Ruling |
|---|---|
| 1 | **Accepted** (C-8 via `disputes.list`) |
| 2 | **Accepted** (`findByIdForWebhook` for the C-2 re-read, guard widened to `boostReconcileDeps.ts`) |
| 3 | **Accepted** (the admin trigger writes no `bos_cron_runs` row; the write-ahead audit row is its trace, per the "Drain now" precedent) |
| 4 | **Ruling: map `warning_closed` → `dispute_won`** (CR-2). An inquiry that closes without becoming a chargeback took no funds; that is Stripe's definitive outcome, not a guess. `dispute_won` restores the pre-dispute status from the refunded amount (2b), which is exactly right. Other unknown statuses stay findings |
| 5 | **Accepted** (no reversal read on receipt-backfill rows; covered by the webhook, or the C-6 residual) |
| 6 | **Not accepted as is.** See CR-1 |
| 7 | **Accepted** (two runner files) |
| 8 | **Accepted**: RM sets `addedOn` to the real deploy day in the PR |
| 9 | **Accepted** (no index for the `disputed` read: a tiny set) |

#### Findings

| # | File | Finding | Priority |
|---|---|---|---|
| **CR-1** | `boostReconcilePass.ts` (`finding`) | **A repeating finding writes a new owner-visible audit entry every night.** `BOS_BOOST_FLAGGED` is owner-visible with the neutral label "Payment under review". A stuck row with a deterministic finding (a 404 or unreadable session, a livemode / marker mismatch, a free session) is left as is (deviation 6), so the owner's activity log gains one "Payment under review" row **per night, forever**. It also re-reads Stripe nightly for the same row. **Fix:** for a deterministic finding on a **stuck** row (`pending` / `awaiting_payment`), **flag the row** with `transition('flagged_mismatch', <reason>)`, which 2b allows from both statuses. That writes one audit entry, takes the row out of the stuck set, and lists it for slice 6. For findings on a **`disputed`** row (which cannot be flagged): log `error` with `alert: true` each night, but write the audit entry **only on the first occurrence**. The simplest marker is to audit only when the row's `status_changed_at` is newer than its last audit; or audit never and rely on the alert plus slice 6. Tests: run twice → exactly one `BOS_BOOST_FLAGGED` for a stuck-row finding, and the row is out of the next run's set. | **Medium (must-fix)** |
| **CR-2** | `boostReconcilePass.ts` (C-9 branch) **and** `boostChargeHandler.ts` (`plan`) | **`warning_closed` → `dispute_won`** (deviation 4 ruling), in both the pass and the 4b.1 webhook's `charge.dispute.closed` branch, so the live event and the nightly pass agree. One test each. | Low (must-fix) |
| **CR-3** | `boostReconcilePass.ts` (`BOOST_RECONCILE_LIMITS.ROW_MARGIN_MS`) | **The margin is below one row's worst case.** A stuck row can now make two bounded Stripe reads (the session, 6 s locally bounded, plus `disputes.list`, 6 s) and several SQL calls. Ten seconds can be exceeded, and 45 s + about 13 s approaches `maxDuration = 60`. Raise the margin to **15 s** (or bound the row as a whole to 10 s), and update the C-4 test. | Low (must-fix) |

#### Code Approved for QA: **No, pending CR-1 to CR-3**

SA re-checks the diff only. The PROD runbook (§7: the pre-check in its own tab, then the migration, then the checker, before the deploy that schedules the cron) is approved as written.

#### Re-check of CR-1 to CR-3 (SA, 2026-10-09, diff only)

✅ **Code Approved for QA** (QA re-check, then the user's diff).

- **CR-1:**
  - A stuck row with a deterministic finding is flagged once through `transition('flagged_mismatch', reason)` and leaves the stuck set.
  - An unflaggable row (`disputed` / `paid` / moved) alerts every run, and writes the owner-visible `BOS_BOOST_FLAGGED` only on the first occurrence.
  - **The new `AuditTrailRepository.hasFindingEntry` is acceptable:**
    - repository pattern, scoped `.eq('user_id', <the purchase's own account>)` (rule 4);
    - `count: 'exact', head: true`, so no row or audit content is returned;
    - UUID and reason validation before the query;
    - a single caller (`boostReconcileDeps.ts`, which is `server-only`), pinned by its own caller guard; `adminReadMethods.guard` still passes;
    - a failed check skips the audit (`warn`) while the alert still fires.
  - **Query cost:** `audit_trail` has a btree index on `entity_id` (`idx_audit_trail_entity_id`), which is highly selective (one purchase), plus `user_id` and `action` indexes. The `details->>reason` filter applies to a handful of rows, so the cost is negligible at today's and foreseeable sizes.
  - **Archived rows:** once Admin Archiving moves an old `BOS_BOOST_FLAGGED` row out of `audit_trail`, a still-open finding is audited **once more**. That is at most once per archive cycle, which is acceptable. The known overlap limit (two simultaneous runs could both audit) is also accepted.
- **CR-2:** `warning_closed` → `dispute_won` in both the pass (C-9 branch) and the 4b.1 webhook `plan()`. ✅
- **CR-3:** `ROW_MARGIN_MS` is 15 s. ✅
- **Re-run by SA (`--ci`):** `hasFindingEntry`, the pass, the charge handler, `adminReadMethods.guard` and the Connect characterisation pass, **426 tests**.

## QA Testing Report

### QA — 4b.1 (2026-10-08)

**Verdict:** ✅ **PASS WITH NOTES.** Money handling is correct in every case QA tried:
- refunds and disputes land only on the purchase whose **stored** payment intent matches;
- every outcome completes, except transient failures, which throw;
- lots are never touched;
- Connect, plan and legacy paths are unchanged;
- owners see a neutral "Payment update".

There are **one Medium defect** (a re-delivered `dispute.created` reopens a dispute that has already been won) and **one Low documentation correction** (the "refund before credit" path is unreachable for `pending` rows).

**Test mode:** full
**Strategy used:** A + B (Jest, mocked; no Stripe, no Supabase). One scratch suite, `qa/boostCharge4b.qa.test.ts` (185 tests), is **not committed**. It drives the real charge handler and resolver against a fake repository that mirrors the 20261031 `transition` refund and dispute branches line by line, including the stale-before-not_allowed order that fixed 2b's QA2b-D1.
**Focus:** api (webhook), money correctness, tenant isolation, logs and audit
**Skipped:**
- my own source mutations: SA was mutating `boostChargeHandler.ts` in the same worktree at the same time, and I did not want to overlap. SA's M1 and M2, and the Dev's, are recorded above. One of my runs hit SA's in-flight mutation, so I discarded it and re-ran with SHA-1 checks before and after;
- `oneAddressPolicy` (Linux-path copy, run by the Dev).

**Input source:** coordinator brief + workplan §3, §6.1

#### Commands run

| Check | Result |
|---|---|
| 4b.1 bar (JSX scratch config, `--ci`, so no snapshot is written):<br>• `lib/business-os/boost/__tests__`;<br>• **every** `app/api/stripe/webhook/__tests__` suite (Connect characterisation, boost routing integration, `routerPlacement`, `pinoLogging`, …);<br>• `lib/business-os/billing/__tests__`;<br>• `lib/audit/__tests__` and `app/api/audit/__tests__`;<br>• the boost routes;<br>• the repository;<br>• `enforcementPoints` | ✅ **54 suites, 1,435 tests, 100 snapshots passed**; `git status` is clean under `__snapshots__` |
| Types-first tsc (`tsconfig.4b.json`) | ✅ **0 errors in changed files.** 61 errors in other files, none of them in this diff |
| QA scratch suite | ✅ **185 / 185**, with SHA-1 checks on all 11 non-doc files before and after the run |
| Source untouched by QA | ✅ The SHA-1 of the 11 non-doc files and `git status --porcelain` match the pre-QA snapshot |

#### Matrix: event × row state (fake following 20261031)

Every one of the 132 cells **completes** (no throw), audits always carry the row's account and entity `business_os_boost_purchase`, `transitioned` / `recorded` always alert plus `BOS_BOOST_PAYMENT_REVERSED`, `already` / `stale` never alert or audit, and `not_allowed` always alerts.

| Event | paid | partially_refunded (1000) | refunded | disputed | dispute_lost | flagged | pending / awaiting / expired¹ | failed / abandoned¹ |
|---|---|---|---|---|---|---|---|---|
| refund 1000 | → partial | already | **stale** | recorded | recorded | recorded | reversal_before_credit | not_allowed |
| refund 1500 (cumulative) | → partial | → partial 1500 | stale | recorded | recorded | recorded | reversal_before_credit | not_allowed |
| refund 2500 (full) | → refunded | → refunded | already | recorded | recorded | recorded | reversal_before_credit | not_allowed |
| refund 500 (older) | → partial 500 | **stale** | stale | recorded | recorded | recorded | reversal_before_credit | not_allowed |
| refund 0 | ignored (no call, no alert) | ignored | ignored | ignored | ignored | ignored | ignored | ignored |
| refund 3000 (over total) | not_allowed | not_allowed | not_allowed | not_allowed | not_allowed | not_allowed | reversal_before_credit | not_allowed |
| dispute created | → disputed | → disputed | → disputed | already | not_allowed | recorded | reversal_before_credit | not_allowed |
| closed won / funds_reinstated | not_allowed | not_allowed | not_allowed | → paid | not_allowed | not_allowed² | reversal_before_credit | not_allowed |
| closed lost | not_allowed | not_allowed | not_allowed | → dispute_lost | already | not_allowed² | reversal_before_credit | not_allowed |
| closed warning_closed | info only | info | info | info | info | info | info | info |
| created, another dispute id | → disputed | → disputed | → disputed | not_allowed | not_allowed | recorded | reversal_before_credit | not_allowed |

¹ Only if the row has a stored payment intent; see QA4b-L1. ² `already` once the flagged row has recorded that dispute id (per the SQL).

#### Other results

| Area | Result | Notes |
|---|---|---|
| Sequences | ✅ | Refunds 1500 → 1000 → 2500 → 1500 give `transitioned, stale, transitioned, stale`, ending at `refunded`/2500 with exactly 2 reversal audits. Partial refund → dispute → refund more while disputed (`recorded`) → won → `partially_refunded`/1500. created → won → funds_reinstated (`already`) → **created again → `transitioned` back to `disputed`** (QA4b-M1) |
| Currency (C-1) | ✅ | `usd`, `USD` and `Usd` are written. `eur` and `"usd "` (trailing space) → `FLAGGED:currency_mismatch`, no write. A dispute in `eur` → no write |
| Livemode | ✅ | Mismatch → `FLAGGED:livemode_mismatch`, no write |
| Unreadable event | ✅ | A negative amount, a `tr_` charge id or a string amount → `reversal_unreadable`, alert, complete, no write |
| Row gone after the resolver | ✅ | warn, complete |
| SQLSTATE (4a C-1) | ✅ | For `transition` and the lookup: **complete** on 22023, 22004, 23514, 42501; **throw** on 23505, 40001, 08006, 57014, XX000, a null code, and a plain `Error`. A throw writes no audit |
| Resolver | ✅ | All four event types with our payment intent → `flow`. A null, missing or empty payment intent, or a `ch_` value → `not_business_os` with **no read**. A payment intent that is not ours → one payment-intent read, then `not_business_os`. **Metadata naming one of our purchase ids is never used.** An expanded payment-intent object → its id. A lookup error → throw. Other charge types (`charge.succeeded`, `charge.dispute.updated`, `charge.refund.updated`) → no read |
| Connect | ✅ | A Connect `charge.refunded` / `charge.dispute.created` carrying our payment intent → the dispatcher answers `not_business_os` with **zero** boost reads. The characterisation snapshot is unchanged |
| Legacy | ✅ | The integration suite (run in the bar) keeps non-boost refunds and refunds with no payment intent on the legacy handler, with no boost read |
| Lots | ✅ | A source guard over `boostChargeHandler`, `boostChargeEvents`, `boostWebhookResolver` and `boostWebhookDeps` (comments stripped) finds none of the lot tables, the lot functions, `CreditLotRepository`, `confirmPaidCredits`, `user_subscriptions` or `credit_transactions`. In the fake repository, every event made only `find` and `transition` calls |
| Owner view | ✅ | `BOS_BOOST_PAYMENT_REVERSED` → owner label "Payment update" / "עדכון תשלום" / "Actualización del pago" with `details` `{}`; the stored details are intact for admins |
| Logs and audit | ✅ | Across 5 scenarios, with the email planted in `billing_details`, `receipt_email` and the dispute evidence, no log line or audit entry contains it |

#### Issues Found

##### Bugs

1. **QA4b-M1: a re-delivered `charge.dispute.created` reopens a dispute that has already been won.** Severity: **Medium**. The money is correct (credits and Stripe are unaffected), but the row's status is wrong and stays wrong, and the owner sees "Payment under review" with no end. File: `boostChargeHandler.ts` (`plan` for `charge.dispute.created`), with 20261031's `disputed` branch.
   - Steps to reproduce: on a `paid` row, `charge.dispute.created` (`dp_1`) → `disputed`; `charge.dispute.closed` won → `paid` (the row keeps `stripe_dispute_id = dp_1`). Then the **same** `created` event is delivered again: an admin "Resend" (which §7 and C-6 recommend for stuck claims), or a retry after a transient failure.
   - Expected: `already` / stale, because this dispute has already concluded.
   - Actual: `transitioned` back to `disputed`, plus an alert and `BOS_BOOST_PAYMENT_REVERSED`. No later event restores it. The 4b.2 pass reads only stuck pending / awaiting rows, so it will not repair it either.
   - The same end state follows if `closed` is ever processed before `created` (the late `created` finds a `paid` row). Stripe does not guarantee order, but disputes usually take weeks to close, so this mostly arises through Resend.
   - Fix (handler-only, no SQL change): for `charge.dispute.created`, when the row is paid-family and its stored `stripeDisputeId` equals the event's dispute id, the dispute has already concluded. Log `info` (`stale`), with no call and no audit. Add the sequence test.
2. **QA4b-L1: "refund / dispute before credit" (N-2) is unreachable for `pending` rows.** Severity: **Low** (documentation and expectations).
   - A `pending` row has **no stored payment intent**: one is written only by `awaiting_payment`, by `credit`, or on a mismatch flag. Matching is by stored payment intent only, so a refund or dispute on a paid-but-not-yet-credited (stuck pending) purchase resolves to `not_business_os`. It takes the **legacy** path ("unknown payment" `error`) with **no** boost alert or audit.
   - The `reversal_before_credit` branch fires only for `awaiting_payment` rows and rows expired or failed after `awaiting_payment`.
   - The fact is not lost: it stays in Stripe, and the 4b.2 pass credits the row and then applies the charge's refund or dispute state.
   - Fix: state this in §3.2 / §6.1 (N-2 applies to rows with a stored payment intent; for stuck `pending` rows the 4b.2 pass is the recovery). Optionally, a matrix test on a `pending` row with no payment intent → `not_business_os`.

##### Info

- **I-1:** a refund event on a `failed` or `abandoned` row (only possible with a stored payment intent, i.e. failed after `awaiting_payment`) answers `not_allowed` with an alert. That is reasonable, because money and status disagree.
- **I-2:** `closed` with `warning_closed` (an inquiry) is `info` only, with no audit. As designed.

#### Recommended additions

| # | Test | Where | Priority |
|---|---|---|---|
| R-1 | created → won → **created again** (and won before created) → no move back to `disputed` | `boostChargeHandler.test.ts` | **With the M1 fix** |
| R-2 | The resolver with a `pending` row that has no stored payment intent → `not_business_os` (pins QA4b-L1) | resolver test | Should |
| R-3 | The full event × row-state matrix on the 20261031 fake (132 cells), pinning complete, alert and audit per cell | handler test | Should |
| R-4 | Currency `"usd "` and `Usd`; unreadable string amount; the email planted in charge and dispute objects never logged | handler test | Nice |
| R-5 | Other charge types (`charge.succeeded`, `charge.dispute.updated`) → no boost read | resolver test | Nice |

#### Test Outputs / Logs

```text
4b.1 bar:   Test Suites: 54 passed, 54 total   Tests: 1435 passed, 1435 total   Snapshots: 100 passed, 100 total (no snapshot file changed)
QA scratch: Tests: 185 passed, 185 total   (SHA-1 PRE_OK / POST_OK around the run)
  seq refunds:  [ 'transitioned', 'stale', 'transitioned', 'stale' ] refunded 2500
  seq disputes: [ 'transitioned', 'transitioned', 'already', 'transitioned' ] disputed | audits: PAYMENT_REVERSED x3
                (created -> won -> funds_reinstated -> created again => back to disputed: QA4b-M1)
Scoped tsc: 61 errors, 0 in changed files
```

#### Final Status
- [x] The 4b.1 acceptance criteria pass for money correctness (FR-35, FR-36, FR-37, T-9). **Recommended before the PR:** the small QA4b-M1 handler fix with its sequence test, and the QA4b-L1 wording.
- [ ] Issues found that the Dev must address before commit

### QA — 4b.2 (2026-10-09)

**Verdict:** ✅ **PASS WITH NOTES. Not ready for commit until SA's CR-1 to CR-3 land; QA re-checks that diff.**

Money handling is correct in every case QA tried:
- stuck purchases are credited only when Stripe says `paid`, exactly once, on the row's own account;
- expired, failed and still-processing rows are handled as specified;
- a webhook race is quiet;
- one bad row never stops the batch;
- lots are never touched;
- the routes fail closed;
- the migration, pre-check, checker and rollback behave on PGlite.

QA independently reproduced SA's **CR-1**: a repeating finding writes a new owner-visible "Payment under review" audit entry every night. It is open in the code under test and recorded here as **QA4b2-M1**.

**Test mode:** full
**Strategy used:** A + B + C.
- **Jest (mocked):** three scratch suites, none committed:
  - `qa/boostReconcile4b2.qa.test.ts`: 46 tests on the real pass, with a fake repository following 20261030/31, a fake Stripe and a fake clock;
  - `qa/routes4b2.qa.test.ts`: 24 tests on the real cron and admin routes, with the gate, audit, recorder and pass mocked.
- **PGlite 0.5.8 / PG 18.3:** `pglite/qa4b2mig.mjs` runs the migration, pre-check, checker and rollback.

**Focus:** cron pass and money correctness, routes and auth, migration runbook
**Skipped:**
- my own source mutations: SA mutates this worktree in parallel; every run was bracketed by SHA-1 checks of all 26 non-doc files (PRE_OK / POST_OK);
- `oneAddressPolicy` (the Dev's Linux-path copy).

**Input source:** coordinator brief + workplan §6.2, §7

#### Commands run

| Check | Result |
|---|---|
| 4b.2 bar (JSX scratch config, `--ci`, 112 suites):<br>• `lib/business-os/boost` and `billing`;<br>• every Stripe webhook suite;<br>• `app/api/cron`, `app/api/admin/business-os`, `app/api/admin/__tests__`;<br>• `lib/cron`;<br>• audit tests and routes;<br>• **all migration tests**;<br>• the repository;<br>• `enforcementPoints`;<br>• `admin-authz-surface.guard`, `security-definer-surface.guard` | ✅ **111 passed, 4,191 tests, 103 snapshots**; no snapshot file changed. The one red suite is `scripts/__tests__/stripePlanPriceScripts.test.ts` (2 tests): **confirmed environmental**. It spawns `<worktree>/node_modules/tsx/dist/cli.mjs` (line 249), and this worktree has no `node_modules` (`ls node_modules` → absent). It expects exit 2 and gets 1, the spawn failure. The file is untouched |
| Types-first tsc (`tsconfig.4b2.json`) | ✅ **0 errors in changed files**; 73 elsewhere, none of them in this diff |
| QA pass suite | 44 / 46. The 2 reds are **my fake's** limitation: it does not re-check amount or currency inside `credit`, which 20261031 does (a mismatch is flagged by the SQL). They are not a code defect |
| QA routes suite | 23 / 24. The 1 red is a QA expectation: `"Bearer sekret "` (trailing space) is accepted because the Fetch `Headers` object trims values, which is the HTTP standard and not a defect |
| PGlite migration run | ✅ See the migration row below |
| Source untouched | ✅ SHA-1 of the 26 non-doc files and `git status --porcelain` match the pre-QA snapshot |

#### Test matrix

| Area | Result | Notes |
|---|---|---|
| Stuck × session state | ✅ | `pending` / `awaiting` + complete + paid → **credited**, 1 lot, `CREDITED`. complete + unpaid with intent `processing` → left, `stillProcessing`. `requires_payment_method` / `canceled` → **failed** + `PAYMENT_FAILED`. open, not yet expired → left, `stillOpen`. open past `expires_at`, or expired → **expired**. 404 → finding (`reconcile_session_missing`). 400 → finding (`…_refused`). Network or 5xx → **deferred** (no alert). Session livemode `true` on a test row, another product's marker, `no_payment_required` → finding, no write |
| Timeout | ✅ | A hanging session read → deferred after the 6 s local bound (fake timers); **the next row still credits** |
| Auth error | ✅ | `StripeAuthenticationError` on the first row → the **pass stops**: 1 Stripe call, `stripeUnavailable` 1, `rowsLeft` 3, no write. An unknown key mode → no list read at all |
| Mode scope | ✅ | Every list read uses `livemode=false` (the test key). A live row slipping into the batch is never read from Stripe or written |
| 50-row bound and order | ✅ | Every read has `limit: 50`; with 60 stuck rows `batchFull` = 1, and the first 50 are processed in the order the repository returns them (oldest first, pinned in the repository suite) |
| Deadline (C-4) | ✅ | At 4 s per Stripe read: 9 examined, 11 left, `deadlineHit` 1; no row starts with less than 10 s left. (SA CR-3 raises the margin to 15 s, because a row can make two 6 s reads) |
| Idempotence | ✅ | Run twice → identical row, 1 lot, 1 `CREDITED`, 1 `PAYMENT_REVERSED` (partial refund on the charge) |
| Race (C-2) | ✅ | The webhook credits between the batch read and the call → `already_credited` → `raced` 1, **no alert, no audit** from the pass, still 1 lot |
| Isolation | ✅ | A row whose `credit` **throws** → deferred + alert; the rows before and after are credited |
| No-session rows (C-3) | ✅ | 47 h after expiry → left, **no Stripe read**; 49 h → expired; never credited (0 lots). The late-paid → `no_session` path is the 4a webhook's, covered by the Dev's suite |
| Post-credit reversals | ✅ | A full refund on the charge → `refunded`, applied **once** over two runs. Charge `disputed` → disputes listed by payment intent → `disputed` then `won` → `paid`; the second run changes nothing. Listed but empty → `dispute_id_unreadable` finding |
| C-9 disputed rows | ✅ / ⚠️ | won → `paid`, lost → `dispute_lost` (1 audit, none on run 2). `needs_response` / `under_review` → left, no audit. `warning_closed`, an unknown status, another payment intent, `eur`, unreadable, 404 → finding **and a new `BOS_BOOST_FLAGGED` audit on every run** (QA4b2-M1). No stored id → finding with no Stripe read |
| Receipt backfill | ✅ | Only `paid`, no receipt, `paid_at` < now − 10 min (the read's `before` is exactly now − 10 min): 1 of 3 rows examined and filled. A non-https charge receipt after a reconcile credit is not stored |
| Logs and audit | ✅ | With the email planted in the session, the charge and a Stripe error message, and the client secret in the session, neither appears in any log or audit. Every audit is on `business_os_boost_purchase` with the row's account |
| Lots | ✅ | A source guard over the six new production files (comments stripped) finds no lot table, function, repository or take-back name. The fake repository has no lot method, and lots were written only by `credit` |
| Cron route | ✅ | Exports `GET`, `maxDuration`, `runtime` (no POST; Vercel cron calls GET). No header, `Bearer wrong`, no scheme, or lower-case `bearer` → 401 and the pass never runs. **Production with no `CRON_SECRET`** (unset or empty) → 401 for every header, including `Bearer undefined` / `Bearer ` / `Bearer null`. Correct secret → wrapped by `withCronRunRecord`, the pass runs with trigger `nightly` and a 45 s budget, and the counts are flattened (`boostExamined`, `boostCredited`, `passesRun`) |
| Admin route | ✅ | Exports `POST` only. Gate 401 / 403 → returned **before anything** (no body read, audit or pass). The bodies `{"x":1}`, `[]`, `null`, `"x"`, a truncated `{`, `{"dryRun":true}`, `0` and `{"runId":"x"}` → 400 with no audit, no pass and no details. Empty, whitespace, `{}` and ` {} ` → `BOS_BOOST_RECONCILE_TRIGGERED` on entity `system`, with the admin as user and actor and the server `runId` (equal to the response's), **then** the pass with trigger `admin`. **No cron run record.** No admin email in the response or logs |
| Migration (PGlite) | ✅ | Pre-check before: Q1 exists, Q2 both `yes`, Q4 counts. Checker before: `FAIL 0/10`. **Apply → checker `VERDICT PASS 10/0`.** **A second paste fails with `42P07 … already exists`** and changes nothing. The pre-check after shows `NO it already exists stop here`. The planner uses `business_os_boost_purchases_reconcile_idx` for the stuck query. The rollback (twice, idempotent) → checker FAIL; re-apply → PASS. Paste scan of all four files: no comments, no **into**, no `auth.`, all literals `[A-Za-z0-9_ ]` |

#### Issues Found

##### Bugs

1. **QA4b2-M1 (= SA CR-1): a repeating finding writes a new owner-visible "Payment under review" every night.** Severity: **Medium**. File: `boostReconcilePass.ts` (`finding`).
   - Steps to reproduce: a `disputed` row whose dispute is `warning_closed` (or unknown, another payment intent, `eur`, unreadable, 404), or a stuck row with a 404 / unreadable / mode-mismatched / free session. Run the pass twice.
   - Expected: one record per problem.
   - Actual: `BOS_BOOST_FLAGGED` on **each** run (run 1 = 1, run 2 = 1), and owners see it as "Payment under review". The same rows are also re-read from Stripe and re-alerted every night.
   - Fix: as SA CR-1 (flag stuck rows once with `transition('flagged_mismatch', reason)`; audit `disputed`-row findings only once). CR-2 (`warning_closed` → `dispute_won` in both the pass and the 4b.1 webhook) removes the most common case.

##### Info

- **I-1:** the cron route trims the `Authorization` header value (`"Bearer sekret "` passes) because the Fetch `Headers` object does. That is standard and harmless.
- **I-2:** CR-3 (margin 10 s → 15 s) is consistent with QA's measurement: one stuck row can make two 6 s-bounded Stripe reads plus SQL.
- **I-3:** `stripePlanPriceScripts.test.ts` is red only in this worktree (no `node_modules/tsx`); CI is unaffected.

#### Recommended additions

| # | Test | Where | Priority |
|---|---|---|---|
| R-1 | Run the pass twice on a stuck-row finding → exactly one `BOS_BOOST_FLAGGED`, and the row leaves the next run's stuck set; the same for a `disputed`-row finding | pass test | **With CR-1** |
| R-2 | `warning_closed` → `dispute_won` in the pass **and** the webhook handler | both suites | **With CR-2** |
| R-3 | A row making two Stripe reads at the bound never pushes past `deadline + margin` | pass test | **With CR-3** |
| R-4 | The cron route with `CRON_SECRET=''` and `Bearer `, and `bearer` lower-case → 401 | cron route test | Nice |
| R-5 | The admin route bodies `0`, `"x"` and `{"runId":…}` → 400 with no audit | admin route test | Nice |

#### Test Outputs / Logs

```text
4b.2 bar:  Test Suites: 1 failed (stripePlanPriceScripts: node_modules/tsx absent), 111 passed   Tests: 4191 passed   Snapshots: 103 passed
QA pass:   44/46 (2 reds = fake credit has no amount/currency check; the SQL does)   QA routes: 23/24 (trailing-space header trimmed by Headers)
  pending / missing (404): audits=[FLAGGED:reconcile_session_missing] flagged=1 | network / 5xx: deferred=1
  deadline: examined 9 rowsLeft 11 deadlineHit 1
  C-9 warning_closed: final=disputed audits run1=1 run2=1   (QA4b2-M1 / SA CR-1)
  C-9 won: final=paid audits run1=1 run2=0 | lost: final=dispute_lost run1=1 run2=0
PGlite:    checker before FAIL 0/10 -> apply -> VERDICT PASS 10/0; second paste 42P07; rollback x2 -> FAIL; re-apply -> PASS
Scoped tsc: 73 errors, 0 in changed files
```

#### Final Status
- [ ] All acceptance criteria pass, ready for commit
- [x] **Issues found that the Dev must address before commit:** SA CR-1 (= QA4b2-M1, Medium), CR-2 and CR-3. QA re-checks that diff with R-1 to R-3; everything else in 4b.2 passed.

### QA re-check (4b.2) — 2026-10-09

**Scope:** the §6.2 "Review fixes" diff only (SA CR-1 to CR-3 = QA4b2-M1, QA R-1 to R-5). **Strategy:** A (Jest, scratch suites against the new code, fakes only, no Stripe or Supabase), with every run SHA-bracketed (30 files, PRE_OK / POST_OK) because SA was re-checking in parallel. The worktree was unchanged at the end.

| Check | Result | Evidence |
|---|---|---|
| QA4b2-M1 closed: stuck rows, two runs | ✅ | Six causes: 404, 400, unreadable, livemode, wrong product marker, `no_payment_required`. In each case run 1 gives one `BOS_BOOST_FLAGGED` and `flagged_mismatch`. Run 2 gives **no new audit and no Stripe read**, because the row has left the stuck set |
| QA4b2-M1 closed: disputed rows, two runs | ✅ | Five causes: unknown status, 404, another payment intent, `eur`, unreadable. **One alert per run**, **exactly one FLAGGED** over both runs, and the row stays `disputed` |
| `findingRecorded` cannot tell (null) | ✅ | The alert is kept every run and no audit is written. This fails safe: no owner entry rather than a duplicate |
| CR-2 pass | ✅ | A `disputed` row with Stripe `warning_closed` → `paid` and one `PAYMENT_REVERSED`. The second run is quiet |
| CR-2 webhook | ✅ | `plan('charge.dispute.closed', warning_closed)` → `transition dispute_won`, the same as `won`. `prevented` stays ignored |
| CR-3 margin 15 s | ✅ | 10 rows with two Stripe reads each at 6 s per read. Three rows are examined, 7 are left, and the run ends at +36 s (≤ 45 s). `deadlineHit` 1 |
| R-4 / R-5 routes | ✅ | Repo route suites green. QA routes re-check 23/23 (the known trailing-space case is dropped: Headers trims it) |
| Regression bar | ✅ | 13 changed or new suites, 946 tests green. tsc at the 73-error baseline, 0 in changed files |

**Old QA pins that now differ (expected, not defects):** 8 of the original 46 tests fail, and each one is a deliberate behaviour change or a known fake limit:
- 5 old stuck pins expected `pending` and now get `flagged_mismatch` (CR-1);
- 1 old `warning_closed` → `disputed` pin now gets `paid` (CR-2);
- 2 are the known fake limit: my fake `credit` has no amount or currency check, while 20261031 SQL has one.

All 38 new re-check tests pass (76 / 84 overall).

```text
stuck 404|400|unreadable|livemode|marker|free: status=flagged_mismatch flagged=1 reads run1=1 run2=0
disputed unknown status|404|another PI|eur|unreadable: alerts run1=1 run2=1 FLAGGED=1 status=disputed
C-9 warning_closed: final=paid audits run1=1 run2=0 tags=PAYMENT_REVERSED
webhook prevented -> {"kind":"ignore","reason":"dispute_closed_prevented"}
CR-3: examined=3 rowsLeft=7 end offset s=36 stripe calls=6
Repo bar: 11 suites / 597 tests + 2 suites / 349 tests passed   tsc: 73 (baseline), 0 in changed files
```

#### Final Status (re-check)
- [x] **QA PASS.** QA4b2-M1 is closed, CR-2 and CR-3 are confirmed, and R-4 / R-5 are present and green. 4b.2 is ready for the user's diff and the commit. Migration 20261032 still has to be applied in PROD before the deploy that schedules the cron (§7)
- [ ] Issues found

## Commit Info

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-08 | Created | Slice 4b workplan against `790e2ca8` (after #267). 4b.1: the resolver and handler branches for `charge.refunded` and `charge.dispute.*`, matched only by our stored payment intent, recorded through the 2b transition function with cumulative amounts and dispute ids, alerted and audited, never touching lots. 4b.2: the `bos-billing-reconcile` cron (created here, with a seam for P-8b) and its boost pass (stuck purchases credited / expired / failed from Stripe, late reversals, receipt backfill), an admin trigger, an optional index-only migration 20261032; 4a's manual recovery becomes the fallback. About 2.75 days, split proposed. Eight SA questions; one business question (owner wording after a lost dispute) |
| 2026-10-08 | SA workplan review: approved with conditions | C-1 currency case on charges (`usd` vs `USD`). C-2 a pass/webhook race is not a finding (re-read first). C-3 a NULL-session row is never credited; a late payment is flagged `no_session`. C-4 stop starting rows when under 10 s remain. C-5 the admin access register and the authz guard. C-6 the stuck-claim refund residual recorded in the gate. C-7 the reconcile audit kept off owner entities. C-8 expand the dispute id. Q-1 to Q-8 ruled. BQ-1: SA recommends "Payment reversed" after a lost dispute |
| 2026-10-08 | SA approved with conditions; 4b.1 implemented; Code Complete | C-1 to C-8 written in (§3.0); C-3 wording fixed in §3.4; C-6 named in the §7 gate; the BQ-1 TODO in §9 (waiting for the user). Built: charge-event resolution by our stored payment intent only, the refund and dispute handler through 2b's transition function (the cumulative amount, the dispute id), the C-1 currency check, the alert plus `BOS_BOOST_PAYMENT_REVERSED` audit (owner-neutral), N-2 and I-1 handled, lots untouched. 278 suites / 7,378 tests / 100 snapshots green; the Connect characterisation unchanged; 2 mutations caught; 0 tsc errors in 4b.1 files. Nothing committed |
| 2026-10-08 | SA code review (4b.1): Code Approved for QA | 553 tests and 100 snapshots green, with no snapshot change; tsc 0 in touched files. Mutations caught: case-sensitive currency, a transient failure swallowed. Payment-intent-only match, lots never touched, N-2 completes without looping (the fact stays in Stripe for the pass), I-1 warns, owner label neutral. Deviations accepted |
| 2026-10-08 | QA (4b.1): PASS WITH NOTES | 4b.1 bar 54 suites / 1,435 tests / 100 snapshots green (no snapshot changed); tsc 0 in changed files. QA scratch suite (185, against a fake mirroring 20261031) covers:<br>• a 132-cell event × row-state matrix: all complete; alerts and audits as mapped; the account always the row's;<br>• cumulative and out-of-order refunds;<br>• dispute sequences;<br>• currency case (`usd` / `USD` / `Usd` written; `eur` / `"usd "` flagged);<br>• livemode;<br>• unreadable events;<br>• the SQLSTATE classes;<br>• the resolver (payment intent only, no read without one, metadata never used, a lookup error throws, Connect zero reads);<br>• lots never touched (source guard + fake);<br>• owner "Payment update" with no details in en/he/es;<br>• no email in logs.<br>QA4b-M1 (Medium): a re-delivered `dispute.created` after a won dispute moves the paid row back to `disputed`, with nothing to restore it (fix in the handler). QA4b-L1 (Low): the N-2 path is unreachable for `pending` rows (no stored payment intent); the 4b.2 pass recovers them |
| 2026-10-08 | QA follow-ups applied; BQ-1 built | SA code review approved; QA PASS WITH NOTES. QA4b-M1: a repeated dispute.created for a concluded dispute is stale (handler only). The out-of-order case (won before created) needs SQL and is reported, pinned as a known gap. QA4b-L1 wording. R-1 to R-5 added (the 132-cell matrix). BQ-1 (user, yes): `dispute_lost` → "Payment reversed" (en / he / es drafts). Results in the table below. Nothing committed |
| 2026-10-08 | SA re-check of the 4b.1 follow-ups; out-of-order dispute ruling | QA4b-M1 guard, BQ-1 "Payment reversed", QA R-1 to R-5: still Code Approved; 4b.1 ready for the user's diff and commit. Out-of-order `closed won` before `created`: option (b), new condition C-9 on 4b.2 (the nightly pass re-reads open disputes by stored id and concludes them; no migration) |
| 2026-10-08 | 4b.1 approved and committed, PR #272 open | The user saw the diff and approved the commit (2026-10-08). RM committed on `feature/bos-credits-boost-slice-4b` and opened [PR #272](https://github.com/AgentsPilot/neuronforge/pull/272) to `main` |
| 2026-10-09 | 4b.1 merged; 4b.2 started | PR #272 merged into main (88b1938f). 4b.2 (the reconcile cron, the boost pass with C-9, the admin trigger, migration 20261032) starts on `feature/bos-credits-boost-slice-4b2` |
| 2026-10-09 | 4b.2 implemented, awaiting SA code review | The reconcile cron (`41 5 * * *`, added last), the boost pass with C-2 to C-4, C-8 and C-9, the admin trigger (C-5, C-7), migration 20261032 with pre-check, checker, rollback and the PROD runbook (§7), 4a §7 step 6 as the fallback, the C-6 residual in the gate. Results and nine deviations in §6.2 (incl. the dispute id listed by payment intent, and a question on `warning_closed`). Nothing committed |
| 2026-10-09 | SA code review (4b.2): Fix Required | 1,031 tests and 103 snapshots green; mutations caught (crediting unpaid sessions, cron auth bypassed); `stripePlanPriceScripts` red is environmental (no `node_modules/tsx` in the worktree; the file is unchanged from main). Deviations ruled (6 rejected, 4 mapped). CR-1 (Medium): flag stuck rows on deterministic findings, and audit `disputed`-row findings once, so owners don't get a nightly "Payment under review". CR-2: `warning_closed` → `dispute_won` in the pass and the webhook. CR-3: row margin 15 s |
| 2026-10-09 | QA (4b.2): PASS WITH NOTES, not ready for commit | 4b.2 bar 111 suites / 4,191 tests / 103 snapshots green (no snapshot changed). The `stripePlanPriceScripts` red is environmental (no `node_modules/tsx` in the worktree). tsc 0 in changed files. QA scratch suites (46 pass + 24 routes) cover:<br>• every stuck state × Stripe session state (paid → credited once; expired / open-past-expiry → expired; requires_payment_method / canceled → failed; processing / open → left; 404 / 400 / mismatches → findings; network / 5xx / timeout → deferred; an auth error stops the pass);<br>• mode scope, the 50-row bound and order, the C-4 deadline, run-twice idempotence, a webhook race kept quiet, per-row isolation;<br>• no-session rows (48 h, never credited), post-credit refund and dispute applied once, C-9 won / lost / open, receipts (https only, paid_at + 10 min);<br>• no email or secret in logs, lots never touched;<br>• cron auth fail-closed (no secret → 401 for all), the admin gate before anything, strict empty body, the write-ahead audit on `system` with the server run id, no cron record.<br>PGlite: migration → checker PASS 10/0, a second paste 42P07, rollback and re-apply clean; the paste rules hold. **QA4b2-M1 (Medium, = SA CR-1):** repeating findings add an owner-visible "Payment under review" audit every night (reproduced for `warning_closed`, 404, mismatches). Re-check after CR-1 to CR-3 with R-1 to R-3 |
| 2026-10-09 | 4b.2 review fixes applied | SA CR-1 / QA4b2-M1: a stuck row with a finding is flagged once (`flagged_mismatch`), a row that cannot be flagged is alerted each run but audited only the first time (new scoped existence check `AuditTrailRepository.hasFindingEntry`, no migration). CR-2: `warning_closed` → `dispute_won` in the pass and the 4b.1 webhook. CR-3: start margin 15 s. QA R-1 to R-5 added. Broad set green bar the environmental script suite; tsc 0 in changed files. Nothing committed |
| 2026-10-09 | SA re-check of CR-1 to CR-3: Code Approved for QA | Stuck-row findings flagged once; unflaggable findings audited once via `hasFindingEntry` (user-scoped head count, single `server-only` caller, `entity_id` index). `warning_closed` → `dispute_won` in the pass and the webhook. 15 s margin. 426 tests green |
| 2026-10-09 | QA re-check (4b.2): PASS | QA4b2-M1 closed. Each of six stuck findings, run twice, gives one FLAGGED, and run 2 makes no Stripe read. Each of five disputed findings alerts every run with one FLAGGED in total. `warning_closed` → won in the pass and the webhook. The 15 s margin holds (two-read rows end at +36 s). R-4 / R-5 green. Repo bar 946 tests green; tsc baseline. 8 old QA pins differ by design (CR-1 / CR-2) or from the fake limit. Ready for the user diff |
| 2026-10-09 | 4b.2 approved and committed, PR #278 open | The user saw the diff and approved the commit (2026-10-09). RM committed on `feature/bos-credits-boost-slice-4b2` and opened [PR #278](https://github.com/AgentsPilot/neuronforge/pull/278) to `main`. Before the merge the user applies 20261032 on PROD (precheck, apply, checker VERDICT PASS). `bos-billing-reconcile` `addedOn` 2026-10-09 must equal the merge/deploy day |
| 2026-10-09 | 4b.2 merged | PR #278 merged into main (90c33582). Slice 4b complete; slice 6 (admin view and cap override, with the reconcile button) is next |
