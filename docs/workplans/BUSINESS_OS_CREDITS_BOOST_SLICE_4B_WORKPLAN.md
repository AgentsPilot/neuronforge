# Workplan: Business OS Credits Boost — Slice 4b "Refunds, disputes and the stuck-purchase pass"

> **Last Updated**: 2026-10-08

**Developer:** Dev
**Requirement:** [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md): FR-35, FR-36, FR-37, FR-43; T-9; R-6, R-8, R-10; F-1; the go-live gate (4a §7)
**Carry-forwards taken in:**
- **2b §9:** N-2 (a refund on `pending` / `awaiting_payment` / `expired` answers `not_allowed`: log `error`, audit; the reconcile pass credits or flags the row); I-1 (a refund on a transition-flagged row is unbounded: log it at `warn` with the amount); the outcome map.
- **4a:** §9 (the resolver extension to `charge.refunded` / `charge.dispute.*` by `findByPaymentIntentIdForWebhook`; I-1 legacy packs read one row; I-4 the receipt never throws); SA C-1 SQLSTATE classes; SA N-1 / C-3 (never write a row not matched by its own identifier); the §7 step 6 manual recovery.
- **Slice 3 §9:** C-8 (b) `bos_boost_paid_not_creditable` rows are listed by the reconcile pass.
- **Plan payments SA-P4 / PF-5:** one `bos-billing-reconcile` cron with pluggable passes, created by whichever of P-8b and boost 4b lands first. The in-webhook reclaim of stale `processing` claims is P-8b's.

**Branch:** `feature/bos-credits-boost-slice-4b`, cut from `origin/main` `790e2ca8` (after #267)
**Date:** 2026-10-08
**Status:** **4b.1 "refunds and disputes": approved and committed 2026-10-08, PR open.** **QA PASS WITH NOTES 2026-10-08** (QA4b-M1 Medium: a re-delivered dispute.created reopens a won dispute; QA4b-L1 Low wording; see QA Testing Report). SA code review approved 2026-10-08 (Code Complete 2026-10-08) (results in §6.1). 4b.2 (reconcile) not started. *(Earlier: **SA approved with conditions 2026-10-08** (C-1 to C-8; split 4b.1 / 4b.2). BQ-1 (owner wording after a lost dispute) is with the user. Nothing is committed.)*

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
- [ ] T4b.5 Repository `listForReconcile` + tests
- [ ] T4b.6 The boost pass + tests (stuck → credited / expired / failed / still processing; no session past 48 h; late reversal; receipt backfill; deadline; idempotent twice in a row; one bad row never stops the batch)
- [ ] T4b.7 The cron route (fail-closed auth, run record, passes seam) + tests
- [ ] T4b.8 The admin trigger route (`requireAdmin` first) + tests
- [ ] T4b.9 Migration 20261032 + runbook (if Q-7); `vercel.json` last
- [ ] T4b.10 Docs: 4a §7 step 6 → fallback; requirement; go-live gate

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

## 7. Go-live and operations

**After 4b.1 deploys:**
- Refunds and disputes on boost charges are recorded and alerted.
- The Stripe events `charge.refunded` and `charge.dispute.*` are already on the DEP-9 list (4a §7).

**After 4b.2 deploys:**
1. Confirm `CRON_SECRET` is set on Vercel Production (it is, per the payment queue-drain).
2. If Q-7 is approved: apply 20261032 with the checker **before** the deploy that schedules the cron.
3. The nightly run appears in `bos_cron_runs` as `bos-billing-reconcile`.
4. Admins can trigger a run from the route now, and from the slice 6 button later.

**Real-money gate (4a SA point 7):** 4b.1 and 4b.2 merged and deployed. **Residual (SA C-6):** a refund or dispute event whose webhook claim gets stuck in `processing` is not recovered by the pass; the money facts stay in Stripe and only the flag is missing. P-8b's in-webhook reclaim closes it, or an admin resends the event from Stripe. P-8b's in-webhook reclaim is not required for boost, because this pass covers boost purchases without it (R-8). Then DEP-3, DEP-7, DEP-8, DEP-9 and the first live receipt.

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
| P-8b | Append `planReconcilePass` to `PASSES` in `lib/business-os/billing/reconcilePasses.ts`; the route needs no change. The in-webhook reclaim stays P-8b's |
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
**SA re-check of the 4b.1 follow-ups (2026-10-08, diff only):** ✅ still Code Approved, **ready for the user's diff and commit**.- **QA4b-M1:** a `dispute.created` repeating the stored dispute id on a paid-family row is answered as info, with no call and no audit; a new dispute id still opens.- **BQ-1 (user: yes):** `dispute_lost` maps to the owner status `reversed` ("Payment reversed"; he/es drafts), and the return notice hides on it.- **QA tests:** R-1 to R-5 and the matrix pass. 376 tests and 100 snapshots green, and the Connect snapshots are unchanged.- **Ruling on the out-of-order dispute gap ("closed won" before "created"): option (b), recorded as condition C-9 on 4b.2.** The nightly pass also selects rows in `disputed` (current mode, bounded, oldest `status_changed_at` first, within the same deadline and C-4 margin). For each it retrieves the dispute **by the stored `stripe_dispute_id`** (5 s, no retries): `won` → `transition('dispute_won')`; `lost` → `transition('dispute_lost')`; still open → leave it. Because `created` stored the id, 2b's id match succeeds, so **no SQL change is needed**. Missed or stuck `closed` / `funds_reinstated` events also self-heal. Option (a) is rejected because it changes 2b's state machine for a rare order. Option (c) is rejected because "under review" would stay wrong indefinitely.

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
| 2026-10-08 | 4b.1 approved and committed, PR open | The user saw the diff and approved the commit (2026-10-08). RM committed on `feature/bos-credits-boost-slice-4b` and opened a PR to `main` |
