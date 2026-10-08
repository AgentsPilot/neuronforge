# Workplan: Business OS Credits Boost — Slice 4a "Crediting from the webhook"

> **Last Updated**: 2026-10-08

**Developer:** Dev
**Requirement:** [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md): FR-13 to FR-19, FR-27; HP-1 to HP-4; T-4, T-6, T-7, T-8; §18.10 R-6, R-8, R-10; F-1, F-8 / DEP-9
**Carry-forwards taken in:**
- slice 2a §3.4b;
- slice 2b §9: N-1 (class 22 is deterministic), I-3 (repository validation is deterministic), the outcome map, `lot_key_conflict` alerts, and "pass the row id, never `client_reference_id` unchecked";
- slice 3 §9: C-8 (a) the `client_reference_id` fallback, C-8 (b) `bos_boost_paid_not_creditable`;
- P-1: the dispatcher contract and SA Q-6 ("could not tell" releases the claim).

**Branch:** `feature/bos-credits-boost-slice-4a`, cut from `origin/main` `a2b23edb` (after #252)
**Date:** 2026-10-07
**Status:** **Approved and committed 2026-10-08, PR open; after deploy the user subscribes the Stripe events (§7); checkout flag stays off until 5b.** **QA (4a) 2026-10-07: PASS WITH NOTES** (QA4a-D1 Medium, a false alert on a late unpaid event; see QA Testing Report). **SA code review (4a) 2026-10-07: Code Approved for QA**; CR-1 (`monitoring/page.tsx` `console.*`, rule 3) to be converted or explicitly declined by the user before the commit. Previously: **Code Complete 2026-10-07, awaiting SA code review.** C-1 to C-6 applied (§3.0); results in §6.1. Nothing is committed. *(Earlier: SA approved with conditions 2026-10-07.)*

## Overview

Slice 3 creates a paid Stripe checkout for a boost, but nothing credits it: today a boost `checkout.session.completed` falls through the Business OS router (the plan resolver answers `not_business_os` for payment-mode sessions). It then reaches the legacy agent-platform `handleCheckoutCompleted`, which finds no `user_id` in the metadata, logs an error and completes the event. That is why the flag has stayed off (slice 3 C-1).

4a adds **one resolver and one handler** to the P-1 dispatcher (R-6). The resolver recognises a platform boost checkout event by **our purchase row**. The handler credits exactly once through `business_os_credit_boost_purchase` (slice 2b), moves the row through its other states, records the receipt link, audits, and maps every outcome to "complete the event" or "release it for a Stripe retry".

**Refunds, disputes and the stuck-purchase pass are 4b.**

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope and guardrails](#2-scope-and-guardrails)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Task List](#5-task-list)
6. [Test Plan](#6-test-plan)
7. [Going live for testing (after 4a deploys)](#7-going-live-for-testing-after-4a-deploys)
8. [CI, entitlements, estimate and risks](#8-ci-entitlements-estimate-and-risks)
9. [Notes for 4b, 5b and P-3b.2](#9-notes-for-4b-5b-and-p-3b2)
10. [Questions for SA](#10-questions-for-sa)

---

## 1. Analysis Summary

| Area | As built on `a2b23edb` | What 4a does |
|---|---|---|
| **Webhook route** `app/api/stripe/webhook/route.ts` (2,668 lines) | **Signature:** two secrets. **Claim:** `processed_webhook_events`; `completed` / `processing` short-circuit as duplicates; a `failed` row is reclaimed. **Connect split**, then `dispatchBusinessOsEvent` for platform events only. **Outcomes:** `deny` → `completeClaim` + 200. `flow` → `BUSINESS_OS_FLOW_HANDLERS[flow](event, log)` → `completeClaim` + 200. A throw → the catch sets the claim `failed` and answers 500, so Stripe retries. `BUSINESS_OS_FLOW_HANDLERS` is **empty** | Registers `boost: handleBoostWebhookEvent`. **No other change to the route** |
| **Dispatcher** `lib/business-os/billing/webhookDispatcher.ts` | `DEFAULT_RESOLVERS = [planResolver]`. Connect → `not_business_os` before any resolver runs. Two deciders → `deny resolver_conflict`. A resolver throw propagates. The header says "Boost 4a appends its resolver" | Appends `boostResolver`. The header records R-6's deliberate extension: the boost resolver reads **one row** |
| **Plan resolver** | `checkout.session.completed` with `mode !== 'subscription'` → `not_business_os` (the "boost pack" branch). Everything except invoices and subscription sessions → `not_business_os` | Untouched. Disjoint by **mode**: boost claims only `mode = 'payment'` |
| **Legacy** `handleCheckoutCompleted` | Agent-platform boost packs (`metadata.purchase_type = 'boost_pack'`, `user_id`) | Never sees a Business OS boost session once the boost resolver claims it. Agent-platform packs are not Business OS rows, so they keep their path (P-10 retires them) |
| **Repository** `BusinessOsBoostPurchaseRepository` | `findBySessionIdForWebhook`, `findByPaymentIntentIdForWebhook` (unscoped by design, R-6). `credit` → `credited` / `already_credited` / `mismatch(flagReason)` / `not_creditable` / `not_found`. `transition` → `transitioned` / `already` / `stale` / `recorded` / `not_allowed` / `mismatch` / `not_found`. `recordReceipt` → `recorded` / `already_recorded` / `conflict` / `not_paid` / `not_found`. **`fail()` returns `new Error(message)` and drops the SQLSTATE** | Two small additions (§3.5): `findByIdForWebhook` (C-8 a), and errors that keep **whether they are deterministic** (N-1, I-3) |
| **SQL** (20261031, applied to PROD) | `credit` locks the row and accepts `pending`, `awaiting_payment` and `expired`; anything else → `not_creditable`. The lot key is per purchase. `transition`: `awaiting_payment` only from `pending`; `failed` / `expired` / `flagged_mismatch` only from `pending` or `awaiting_payment`; `flag_reason` is free text of 1–64 characters. Argument errors raise `22004` / `22023` | Used as is. **No migration** |
| **Session** (slice 3) | `client_reference_id` = purchase id; `metadata.product = business_os_boost` on the session and its payment intent; `payment_intent_data.receipt_email`; USD; `mode: 'payment'`; `ui_mode: 'embedded'` | The resolver's identity and cross-check |
| **Audit** | `BOS_BOOST_CHECKOUT_STARTED`; entity type `business_os_boost_purchase` is **owner-visible** (visibility is by entity type); `logAndFlush` (2 s bound, never throws) | Three new events (§3.4) |
| **#245 / 20261040** | Drops two dead RLS policies on the agent-platform `public.boost_packs` | **Does not touch** `business_os_boost_purchases`, the lots or the 2b functions. Confirmed by reading the migration |
| **#242 Fix-1, #246 Fix-1b, #250 FU-5** | Connect ownership checks (`accountOwns`, `accountOwnerCache`, cleared per delivery); a failed owner lookup now retries | Connect only. 4a's code never runs for a Connect event, and the characterisation harness proves it (HP-4) |
| **P-3b** (plan, in flight) | P-3b.1 (inert) is in review. **P-3b.2** registers `BUSINESS_OS_FLOW_HANDLERS.plan` and claims **subscription-mode** `checkout.session.completed` / `.expired` | Disjoint by mode. The two slices touch the same map line and the dispatcher test's `DEFAULT_RESOLVERS` pin; whichever lands second rebases (§9) |

**F-1, stuck `processing`.** A function that is killed (timeout, crash) after claiming leaves the claim `processing`. Every Stripe retry is then answered as a duplicate. 4a does not change the claim mechanics; that is P-8b's in-webhook reclaim (PF-5) and boost 4b's reconcile pass (R-8). 4a keeps it **recoverable**:
- The purchase row stays `pending` or `awaiting_payment`, never `paid` without a lot.
- `credit` is idempotent on the row.
- The handler does its money write first and its slow, best-effort parts (the receipt read, the audit flush) after it.

So a killed run either credited (a retry reads `already_credited`) or did not (the row is still creditable). 4b's pass re-reads Stripe for any `pending` / `awaiting_payment` row past expiry plus grace and credits it through the same function. §7 gives the manual recovery for test mode until 4b.

---

## 2. Scope and guardrails

**In scope:**
- The boost resolver.
- The boost handler for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`.
- The receipt fill.
- Three audit events.
- Two repository additions.
- Registration in the dispatcher and the route.
- Tests, including the Connect characterisation before and after.
- Docs, including the §7 go-live-for-testing steps.

**Out of scope:**
- `charge.refunded` and `charge.dispute.*` (4b, T-9; see Q-4 for the gap until then).
- The stuck-purchase reconcile pass and the in-webhook reclaim (4b and P-8b).
- The Buy flow, the embedded form and the Purchases history (5b).
- The admin view (6).

**Guardrails (must not):**
- Run for a Connect event, or change any Connect, plan or agent-platform handler (HP-4). The characterisation snapshot stays byte-identical.
- Read an account from the event: `user_id` always comes from the row (R-6, SR-8). Pass `client_reference_id` to `credit` unchecked (§9 of 2b).
- Credit from anything but `payment_status === 'paid'` on a signature-verified platform event (FR-13). Call `credit` for `no_payment_required`.
- Write to `user_subscriptions`, `credit_transactions` or any agent-platform table (FR-18). Touch capabilities, tiers or the trial (FR-19).
- Return normally after a transient database failure (HP-1). Throw on a deterministic one (N-1: it would loop for about 3 days).
- Let the receipt read, the audit or a log failure fail crediting (T-8).
- Import from `lib/business-os/entitlements/` (crediting uses the row's snapshot, FR-4). Add a migration.

---

## 3. Implementation Approach

### 3.0 SA conditions applied (2026-10-07)

| # | Condition | Where |
|---|---|---|
| C-1 | SQLSTATE classification. **Deterministic** (complete + alert): class 22, 23514, 23502, 23503, 42xxx, and repository validation refusals. **Transient** (throw → retry): 23505, 40xxx, 08xxx, 53xxx, 57xxx, network or timeout errors, plain errors, and XX000, which also gets `error` + `alert` | §3.5; every code pinned in the repository test |
| C-2 | The resolver and the handler ship together; a test asserts that every flow a default resolver can return has a registered handler | §3.6; `routerPlacement.guard` |
| C-3 | Fallback row (session-id miss): (a) stored session NULL → `credit` (it flags `no_session`); (b) stored session non-NULL and different → **no** `credit` / `transition`; `error bos_boost_orphan_session_paid` with `alert` and both session ids; `BOS_BOOST_FLAGGED` (`orphan_session_paid`); complete | §3.2; handler test, both branches |
| C-4 | The receipt retrieve passes `{ timeout: 5000, maxNetworkRetries: 0 }` as **request options**; the step never throws or hangs (a hanging mock released by a fake timer) | §3.3 |
| C-5 | The owner sees a neutral label for `BOS_BOOST_FLAGGED` ("Payment under review", en/he/es) and no raw codes; admins keep the details | §3.4 |
| C-6 | §7: never set the flag on Preview (shared database); the step 6 recovery SQL is exact and paste-safe, only for a test-mode event whose row is `pending` / `awaiting_payment` | §7 |

Rulings Q-1 to Q-8 as proposed (§10): `findByIdForWebhook` guarded to `boostWebhookSession.ts`; owner-visible codes-only audit; the marker check in the handler; refunds before 4b acceptable in test mode only, behind the go-live gate; the bounded retrieve; `fail()` gains `{ sqlstate, deterministic }`; a late `not_allowed` is `error` + alert + audit; one PR.

### 3.1 The resolver — `lib/business-os/boost/boostWebhookResolver.ts` (new)

`createBoostResolver({ purchases })` returns `{ flow: 'boost', resolve }`. Production wiring lives in `boostWebhookDeps.ts` (`server-only`).

| Step | Rule |
|---|---|
| 1 | The event type must be one of the four `checkout.session.*` types; otherwise → `not_business_os`. Connect never arrives (the dispatcher returns before any resolver) |
| 2 | `session.mode !== 'payment'` → `not_business_os` (subscription mode is the plan resolver's) |
| 3 | `findBySessionIdForWebhook(session.id)`. `{ error }` → **throw** (the claim is released, SA Q-6). A row → step 5 |
| 4 | **Miss (C-8 a):** only if `metadata.product === 'business_os_boost'` **and** `client_reference_id` is a UUID: `findByIdForWebhook(client_reference_id)`. `{ error }` → throw. A row → step 5; the handler's `credit` call then flags `no_session` / `session_mismatch`, so an orphan session (slice 3 C-2) becomes visible. **No row and the marker present** → `deny metadata_mismatch` (an `error` line with `alert`, as the route already does for that reason). **No marker** → `not_business_os` (an agent-platform pack or a foreign session) |
| 5 | Row found → `{ kind: 'flow', flow: 'boost', lookupKeys: [] }`. The marker is a cross-check that the **handler** applies (§3.2 step 3), so a disagreement flags the row rather than leaving it pending. The outcome carries **no account** |

**Disjointness:**
- Plan claims only subscription-mode sessions and invoices.
- Boost claims only payment-mode sessions that have a boost row (or carry the boost marker).
- An agent-platform pack has neither, so it still reaches the legacy switch.
- The `resolver_conflict` deny stays the backstop.

### 3.2 The handler — `lib/business-os/boost/boostWebhookHandler.ts` (new)

`createBoostWebhookHandler(deps)(event, log)`, with `deps = { purchases, receipts, audit }`.

The route registers the production instance. It returns normally when the event may be **completed**, and throws `BoostTransientError` when the claim must be **released**.

**Steps:**
1. **Narrow the session with Zod** (I-3 made unreachable):
   - `id` ^`cs_`;
   - `mode` = `payment`;
   - `payment_status` ∈ {`paid`, `unpaid`, `no_payment_required`};
   - `payment_intent`: a `pi_` string or null;
   - `amount_subtotal` / `amount_total`: non-negative safe integers;
   - `total_details.amount_tax`: a non-negative integer or null (null → 0);
   - `currency`, `client_reference_id`, `metadata`.

   A session that fails the schema is **deterministic**. It flags the row with `transition(flagged_mismatch, 'session_unreadable')`, then logs `error` with `alert`, writes the flagged audit entry, and completes.
2. **Find the row** with the resolver's lookup, shared as `findBoostPurchaseForSession`. If it is gone (a race), log `warn` and complete. **The account is `row.userId`, from here on and only from here.**
3. **Cross-checks before any write:**
   - **Livemode** (R-10): `event.livemode !== row.livemode` → `transition(flagged_mismatch, 'livemode_mismatch')`.
   - **Marker** (HP-3): a session whose metadata names another product, or carries the legacy Pilot-Credit keys (`user_id`, `credits`, `pilot_credits`) → `transition(flagged_mismatch, 'metadata_mismatch')`.

   Both lead to the **flagged** path.
4. **By event:**

| Event | `payment_status` | Call |
|---|---|---|
| `checkout.session.completed` | `paid` | `credit({ purchaseId: row.id, sessionId, paymentIntentId, amounts, currency, livemode })` |
| 〃 | `unpaid` | `transition(awaiting_payment, paymentIntentId)`, for a delayed method (T-7) |
| 〃 | `no_payment_required` | `transition(flagged_mismatch, 'no_payment_required')`. Promotion codes are off, so this should never happen (T-7) |
| `checkout.session.async_payment_succeeded` | `paid` | `credit(...)` |
| `checkout.session.async_payment_failed` | — | `transition(failed)` |
| `checkout.session.expired` | — | `transition(expired)` |

   A `paid` session with no payment intent is flagged `no_payment_intent`. `credit` needs one, and payment mode always has one.

**Outcome map** (every row ends in "complete" or "release"):

| Result | Log | Audit | Then |
|---|---|---|---|
| `credit` → `credited` | `info bos_boost_credited` (purchase id, lot id, credits, no amounts beyond the price) | `BOS_BOOST_CREDITED` | Receipt (§3.3), then complete |
| `credit` → `already_credited` | `info` (a replay) | none (FR-15: no second record) | Receipt only if the row has none, then complete |
| `credit` → `mismatch(reason)` | `error bos_boost_mismatch`, `alert: true`, the reason (`lot_key_conflict` and `payment_intent_mismatch` included, §9 of 2b) | `BOS_BOOST_FLAGGED` | Complete |
| `credit` → `not_creditable` on a **paid** session | `error bos_boost_paid_not_creditable`, `alert: true`, the row's status (C-8 b) | `BOS_BOOST_FLAGGED` | Complete. 4b's pass lists these rows |
| `credit` → `not_found` | `warn` (the resolver found it, so this is a race) | none | Complete |
| `transition` → `transitioned` / `already` | `info` | `BOS_BOOST_PAYMENT_FAILED` for `failed` only | Complete |
| `transition` → `mismatch` (`payment_intent_reused`) | `error`, `alert` | `BOS_BOOST_FLAGGED` | Complete |
| `transition` → `not_allowed` | `error`, `alert` (e.g. `expired` arriving after `paid`; async `failed` after `paid`) | `BOS_BOOST_FLAGGED`, with the event type and the row's status, so the row's own status is not overwritten | Complete |
| `transition` → `stale` / `recorded` | Not reachable for these targets; `warn` if seen | none | Complete |
| A repository error, **deterministic** (class-22 SQLSTATE, or a repository validation refusal; §3.5) | `error bos_boost_deterministic_failure`, `alert` | `BOS_BOOST_FLAGGED` | **Complete** (N-1, I-3) |
| A repository error, **transient** (anything else: network, timeout, other SQLSTATE, a lookup error) | `error` | none | **Throw**: the route releases the claim and Stripe retries (HP-1) |

**Order inside the handler:** the money write → the audit (`logAndFlush`, bounded to 2 s, never throws) → the receipt (bounded) → return. The route then completes the claim and answers 200. Total worst case: the RPC, plus 2 s, plus 5 s. A failure in the audit or the receipt never changes the outcome.

### 3.3 The receipt — `lib/business-os/boost/boostReceipt.ts` (new)

**Source.** The session event carries `payment_intent` as an id only, and its charge (`latest_charge`) with `receipt_url` is not embedded. Nothing in the four subscribed session events carries the receipt. The alternatives cost more:
- subscribing to `charge.succeeded` is one more event type, and its ordering is not guaranteed (it can arrive before the row is `paid`, giving `not_paid`);
- expanding fields on the event is impossible.

So T-8's ruling stands: **one** `paymentIntents.retrieve(pi, { expand: ['latest_charge'] })` after a successful credit.

**Bounds:** a 5 s `timeout`, `maxNetworkRetries: 0`, using `getBusinessOsStripeClient()` (slice 3) with the pinned API version.

**Mode guard:** the client's key mode (`currentStripeMode()`) must equal `event.livemode`; otherwise skip and `warn`.

**Result:**
- Fill only with `recordReceipt(row.id, latest_charge.id, latest_charge.receipt_url)`, and only when the charge id is `ch_` / `py_` and the URL is https.
- Any failure → `warn bos_boost_receipt_unavailable` and nothing else; crediting is already done.
- `already_recorded` / `conflict` / `not_paid` → `warn` or `info`.
- A missing receipt is backfilled by 4b's pass (§9).

The receipt **email** is Stripe's, from `receipt_email` (slice 3), and is verified on the first live purchase (FR-27, F-6).

### 3.4 Audit

New events in `lib/audit/events.ts`, plus `eventAudience` (`bos`) and severities. The entity type stays `business_os_boost_purchase` (owner-visible), the entity id is the purchase id, and `userId` is the row's account.

| Event | Severity | Details (no Stripe secrets, no email, no session id) |
|---|---|---|
| `BOS_BOOST_CREDITED` | `info` | `package_id`, `package_version`, `credits_total`, `price_minor`, `currency`, `lot_id`, `stripe_payment_intent_id` (FR-17's "Stripe reference"; not a secret), `livemode` |
| `BOS_BOOST_PAYMENT_FAILED` | `info` | `package_id`, `livemode` |
| `BOS_BOOST_FLAGGED` | `warning` | `reason` (a code: the flag reason, `paid_not_creditable`, `transition_not_allowed:<event>`, `deterministic_failure`), `row_status`, `event_type`, `livemode` |

**Visibility (Q-2):** flagged entries share the owner-visible entity type, so the owner can read "a boost purchase is under review" and its reason code. Codes only, with no internal notes. The alternative, an operator-only entity type, needs a migration to the owner audit policy. I propose not to add one.

The pins in `eventAudience.test.ts` move by +3 (deliberately). The `BOS_BOOST_` filter group already exists (slice 3).

### 3.5 Repository additions (`BusinessOsBoostPurchaseRepository`)

1. **`findByIdForWebhook(purchaseId)`.** Unscoped by design, like `findBySessionIdForWebhook`. It is used only by the C-8 (a) fallback, where the id is `client_reference_id`: written by our server when it created the session (secret key), read from a signature-verified platform event, never from a request. Documented with tenant-isolation-guard's Step 6 shape: every effect afterwards is scoped by the row's own `user_id`, inside the SQL functions.
2. **Deterministic versus transient errors.** `fail()` keeps the message and also attaches `{ sqlstate, deterministic }`:
   - `deterministic = sqlstate starts with '22'`, or the error is a `BoostPurchaseRepositoryError` (validation, I-3);
   - exported `isDeterministicRepositoryError(error)`;
   - the handler reads only that.

   The existing `{ data, error }` contract is unchanged; existing callers (slice 3) are unaffected. A test pins `22004`, `22023`, `22003` and a validation refusal as deterministic, and `08006`, `57014`, `40001` and a plain `Error` as transient.

### 3.6 Registration

- `webhookDispatcher.ts`: `DEFAULT_RESOLVERS = [planResolver, boostResolver]`, plus the header note (R-6's deliberate DB read, in `lib/business-os/boost/`, not `billing/`, so the P-1 "billing modules are DB-free" guard keeps its meaning).
- `route.ts`: `BUSINESS_OS_FLOW_HANDLERS = { boost: handleBoostWebhookEvent }`. One line and its import.

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/boost/boostWebhookResolver.ts` | create | §3.1 |
| `lib/business-os/boost/boostWebhookHandler.ts` | create | §3.2 |
| `lib/business-os/boost/boostWebhookSession.ts` | create | The Zod narrowing plus the shared `findBoostPurchaseForSession` |
| `lib/business-os/boost/boostReceipt.ts` | create | §3.3 |
| `lib/business-os/boost/boostWebhookDeps.ts` | create | Production wiring (`server-only`) |
| `lib/business-os/boost/__tests__/boostWebhookResolver.test.ts` | create | Resolver unit tests |
| `lib/business-os/boost/__tests__/boostWebhookHandler.test.ts` | create | Handler unit tests (every event × outcome) |
| `lib/business-os/boost/__tests__/boostReceipt.test.ts` | create | Receipt unit tests |
| `lib/business-os/boost/__tests__/fixtures/` | create | Session event fixtures (completed paid / unpaid / no_payment_required, async succeeded / failed, expired, Connect copy, plan-mode copy) |
| `app/api/stripe/webhook/__tests__/boostRouting.integration.test.ts` | create | Through `POST` and the dispatcher (§6) |
| `lib/repositories/BusinessOsBoostPurchaseRepository.ts` (+ its test) | modify | §3.5 |
| `lib/business-os/billing/webhookDispatcher.ts` | modify | Append the resolver; header |
| `lib/business-os/billing/__tests__/webhookDispatcher.test.ts` | modify | The `DEFAULT_RESOLVERS` pin → `[planResolver, boostResolver]` |
| `app/api/stripe/webhook/route.ts` | modify | The handler map line |
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` | modify (if needed) | Pin that the boost handler is the only registered flow handler, and that it lives outside `billing/` |
| `lib/audit/events.ts`, `eventAudience.ts`, `__tests__/eventAudience.test.ts` | modify | Three events; pins +3 |
| `docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md` | modify | Status, Change History, DEP-9 confirmation step |

---

## 5. Task List

- ✅ T4a.1 Repository: `findByIdForWebhook` and deterministic errors, plus tests
- ✅ T4a.2 Session narrowing and the shared lookup, plus tests
- ✅ T4a.3 Resolver, plus tests
- ✅ T4a.4 Handler (outcome map), plus tests
- ✅ T4a.5 Receipt, plus tests
- ✅ T4a.6 Audit events and pins
- ✅ T4a.7 Register in the dispatcher and the route. **Connect characterisation snapshot before and after: byte-identical** (HP-4)
- ✅ T4a.8 Route integration test
- ✅ T4a.9 Run the broad set, the webhook suites and scoped tsc; record in §6
- ✅ T4a.10 Docs: requirement status, DEP-9, §7 steps

---

## 6. Test Plan

**Resolver (mocked repository):**
- each of the four types with a row → `flow boost`, with no account in the outcome;
- subscription mode → `not_business_os`, and the repository is never called;
- `invoice.paid` → `not_business_os`;
- a session-id miss + marker + UUID `client_reference_id` + row → `flow`;
- the same with no row → `deny metadata_mismatch`;
- a miss with no marker → `not_business_os`, with no second read;
- a marker with a non-UUID reference → `deny`, with no read;
- a lookup `{ error }` → throws (both reads);
- the dispatcher with both resolvers: a plan invoice still resolves to `plan` and a boost session to `boost`, with no conflict.

**Handler (mocked repository, receipt and audit):**
- every row of §3.2, including credited, already_credited (no second audit), each mismatch reason (`lot_key_conflict` and `payment_intent_mismatch` alerted), not_creditable on paid (alert + audit), not_found;
- unpaid → awaiting_payment with the intent; no_payment_required → flagged;
- async succeeded → credit; async failed → failed + audit; expired → expired;
- not_allowed → alert + audit;
- livemode mismatch → flagged and **no credit call**; a foreign marker or legacy keys → flagged;
- a Zod failure → flagged;
- deterministic errors (22004 / 22023 / validation) → complete, alert, audit; a transient error → **throws**, and no audit claims success;
- the account in every call and audit is the **row's**, never `client_reference_id` or metadata (an event planted with another `bos_user_id` cannot move it);
- the order is money write → audit → receipt;
- an audit or receipt failure does not throw.

**Receipt:**
- the retrieve uses expand, a 5 s timeout and no retries;
- a mode mismatch skips it;
- bad or missing charge data → `warn`, with no `recordReceipt`;
- a Stripe error → `warn`;
- `recordReceipt` statuses are handled.

**Route integration** (`POST` with signed fixtures, the claim table mocked as in `routerEdgeCases.qa.test.ts`):
- a boost `checkout.session.completed` (paid) → the handler runs, the claim is completed, 200, and the legacy `handleCheckoutCompleted` is not called;
- a transient credit failure → 500, claim `failed`;
- a deterministic one → 200, completed;
- a **Connect** `checkout.session.completed` that carries the boost marker → never reaches the resolver (the repository is never called), and takes the Connect handler;
- an agent-platform pack session (no row, no marker) → still the legacy handler;
- a plan `invoice.paid` → the plan path, unchanged (deny or flow exactly as before);
- a replayed completed event → a duplicate short-circuit, with no handler call.

**Characterisation:** `connectPath.characterisation.test.ts` passes with **no snapshot update** (HP-4 evidence).

**Guards and pins:** `routerPlacement.guard`, `pinoLogging.guard`, `receiptOnPaid.guard`, the audit guards (`eventAudience`, `ownerVisibility`), `enforcementPoints` (no new importer), `oneAddressPolicy` (Linux-path copy), the repository test.

**Commands:** the scratch Jest configs with `--runTestsByPath`, and the scoped tsc (SA's types-first config for any `.tsx`; 4a has none). `npm run test:bos-entitlements` and the Jest gate run in CI.

---

### 6.1 Results (Dev, 2026-10-07)

| Run (scratch configs, `--runTestsByPath`) | Result |
|---|---|
| New suites: `boostWebhookResolver` (25), `boostWebhookHandler` (54), `boostReceipt` (17), `boostRouting.integration` (11), `ownerEventPresentation` (4); repository additions (+21 in `BusinessOsBoostPurchaseRepository.test.ts`); the C-2 handler-coverage test and the C-5 route test | ✅ all green |
| **Broad set:** all boost, billing and Stripe-route suites, the boost checkout and packages routes, the whole `test:bos-entitlements` file set, `lib/audit`, `app/api/audit`, `app/admin/audit-trail`, `components/business-os`, and `oneAddressPolicy.guard` **on a Linux-path copy** (deleted after) | ✅ **284 suites, 6,865 tests, 45 snapshots** |
| **Connect characterisation (HP-4)** | ✅ **Every Connect entry is byte-identical.** One **platform** entry changed on purpose: P6, the agent-platform boost-pack session. It now shows the boost resolver's one keyed read of `business_os_boost_purchases` (no row) before the unchanged legacy branch. Only that snapshot was updated (`-t P6 -u`); the diff is those 17 added lines |
| Mutations | ✅ M1 C-3 (b) guard removed → 2 failures. M2 23505 made deterministic → 2 failures. M3 the boost handler unregistered → 5 failures. All restored |
| **Scoped tsc**, SA's types-first config (`tsconfig.4a.json`: every 4a file, the route, the audit and query files, the monitoring page) | ✅ **0 errors in any file 4a creates or changes.** The 67 reported errors are all in files the route imports transitively and 4a does not touch (`lib/analytics`, `lib/i18n` duplicate keys, `lib/pdf`, `lib/pilot`, …) |

**QA follow-ups (Dev, 2026-10-07):**

| # | Change | Tests |
|---|---|---|
| QA4a-D1 (Medium) | In `moveRow`, `transition(awaiting_payment)` → `not_allowed` from a **paid-family** status (`paid`, `partially_refunded`, `refunded`, `disputed`, `dispute_lost`) is a stale event: `info bos_boost_stale_event`, no alert, no `BOS_BOOST_FLAGGED`, complete. `failed` / `expired` against a paid row, and `awaiting_payment` against `failed` / `flagged`, keep `error` + alert + audit (SA Q-7) | R-1 in `boostWebhookMatrix.test.ts`: async-succeeded then a late `completed(unpaid)`; paid / refunded / disputed rows; failed / flagged still alert; failed / expired after paid still alert; the usual order. Mutation (stale check removed) → 6 failures |
| QA I-3 | `flagRow` reports accurately when the transition is not applied: `bos_boost_mismatch_unflagged`, still with an alert and the audit entry (`flag_applied: false`) | R-1 group, last case |
| QA I-2 | §7 step 6's statement also requires `event_type` to be `checkout.session.completed` or `checkout.session.async_payment_succeeded` (dots as `chr(46)`, underscores as `chr(95)`) | R-6 `boostRecoverySql.doc.test.ts`: one statement, no comments, literals `[A-Za-z0-9 ]` only, no "into", no auth, the processing / test-mode / event-type predicates, `cs_test_` only, pending / awaiting only |
| R-2 | The pinned matrix: 7 event × payment-status cases × 8 row states (56 cells). Each cell pins complete-vs-throw, whether `credit` is called, alert, audit reasons and final status, with the row's account on every audit | `boostWebhookMatrix.test.ts` (fake repository following 20261031) |
| R-3 | SQLSTATE through the handler, for `credit` and the lookup. **Complete:** 22004, 22023, 22003, 22P02, 23514, 23502, 23503, 42883, 42501, 42P01. **Throw:** 23505, 40001, 40P01, 08006, 53300, 57014, XX000, null, `PGRST301` | `boostWebhookMatrix.test.ts` |
| R-4 | A Stripe error whose message and `raw` body carry the email → only type, code, request id and status are logged | `boostReceipt.test.ts` |
| R-5 | Dispatcher level: a Connect `checkout.session.completed` with the boost marker → `not_business_os` and **zero** boost reads | `webhookDispatcher.test.ts` |
| I-1, I-4 | Noted in §9 | — |

**Re-run after the QA follow-ups:**
- **4a local bar** (JSX scratch config, `--ci`): all of `lib/business-os/boost/__tests__`, every `app/api/stripe/webhook/__tests__` suite, `lib/business-os/billing/__tests__`, `lib/audit/__tests__`, `app/api/audit/__tests__`, the repository test and `enforcementPoints`: **47 suites (the 45 plus the matrix and doc tests), 1,165 tests, 45 snapshots, all green**.
- **Connect characterisation:** unchanged since code review. The snapshot diff is still only the 17 P6 lines; no new update.
- **Scoped tsc** (`tsconfig.4a.json`): 0 errors in 4a files (67 in untouched files, as before).
- ~~**SA CR-1** (`monitoring/page.tsx`, 6 `console.*` calls): awaiting the user's decision; the file's logging is not touched.~~ **Resolved 2026-10-08, see below.**

**SA CR-1 resolved: the monitoring page was converted to Pino (user decision 2026-10-08):**
- **What changed:** `app/(protected)/monitoring/page.tsx` ('use client') now uses `createLogger({ module: 'MonitoringPage' })` from `@/lib/logger`, the same pattern as `UsageCard`. The six calls are replaced in place, at the same moments, context first:
  - the fetch failure → `logger.error({ err }, …)`;
  - the five former `console.log` traces → `logger.debug(…)`, with their fields unchanged (time filter, stats, user stats, category breakdown, drill-down term).
- **No other change.** The file now has 0 `console.*` calls.
- **Note:** the five traces moved from `console.log` to `debug` level, so they are hidden wherever the logger runs above debug. The page's behaviour is unchanged.
- **Tests:** no test renders this page; the admin audit-trail suites, which share a component name, were run and are green.

**Bringing the branch up to date with main (2026-10-08): stopped, as instructed.**
- `origin/main` is now `711fe71e`. Since the branch base it brought in: #253 (Danger Zone cleanup UI), #254 (CF-5 PR 0, Connect harness gaps), #255 (SECURITY DEFINER inventory), #256 (test-account cleanup fix, migration 20261043) and #257 (one address per business: settlement recovery, money surfaces, landing pages, client portal). 303 files in total.
- P-3b.2 has **not** landed: on main the handler map is still `{}` and `DEFAULT_RESOLVERS` is still `[planResolver]`. So the C-2 `plan` exemption stays.
- `git merge` **refused** on the dirty tree (nothing was changed; no merge in progress). Two files overlap the uncommitted 4a work: `app/api/stripe/webhook/route.ts` and the Connect characterisation snapshot.
- A scratch three-way preview (`git merge-file`, the base, the working copy and main) merges **both cleanly**:
  - **route.ts:** main changed the Connect checkout handler (the settlement dedupe); 4a changed the import and the handler map.
  - **The snapshot:** main added #254's new entries; 4a added the P6 lines.

  The first raw preview of route.ts reported a conflict only because the working copy is CRLF and main's blob is LF; with line endings normalised there is none.
- **Next:** RM commits the 4a work, then merges `origin/main`; after that, the 4a bar and the characterisation are re-run.

**After RM's merge of `origin/main` (e9a0b0ed, 2026-10-08):** #254 added four platform agent-platform boost-pack characterisation entries (X44, X45, X46, X54). Each one now shows the same single keyed boost read as P6: one `select` on `business_os_boost_purchases`, `.eq('stripe_checkout_session_id', 'cs_platform_boost')`, `.maybeSingle()`, before the unchanged legacy branch. That is the known 4a effect, accepted under QA I-1 and SA's P6 ruling.
- Only those four entries were regenerated (`-t "X(44|45|46|54)\. boost-pack" -u`).
- The snapshot diff against HEAD is exactly **+68 / −0**: four hunks of 17 lines, each that read and nothing else. No Connect entry was touched.
- **4a bar** (`--ci`): **47 suites, 1,220 tests, 100 snapshots, all green.**
- Left uncommitted for RM.

**Re-run after the conversion (on the current base):**
- the 4a bar (`--ci`): **47 suites, 1,165 tests, 45 snapshots**;
- the wider set (the entitlements file set, credits, admin users and audit-trail, usage, data export, and `oneAddressPolicy` on a Linux-path copy): **197 suites, 5,261 tests**;
- the Connect snapshot is unchanged: still only the 17 P6 lines;
- scoped tsc (`tsconfig.4a.json`, which includes the monitoring page): **0 errors in 4a files** (67 elsewhere, unchanged).

**Deviations from the plan (for SA code review):**
1. **The resolver's lookup and the session narrowing share one module** (`boostWebhookSession.ts`), as planned. The **wiring file** `boostWebhookDeps.ts` also names `findByIdForWebhook`, to pass it through. The Q-1 guard allows exactly those two files (plus the repository).
2. **The repository is loaded lazily** in `boostWebhookDeps.ts` (`await import(...)` on the first boost event). The dispatcher now imports the boost resolver, and an eager import would create the service-role client whenever the dispatcher module loads (in the route, and in every test that imports the dispatcher).
3. **C-3 is applied a little more broadly than written.** A row found by reference is **never moved by any status event** (expired / failed / unpaid), even with a NULL stored session. Only a paid credit proceeds (C-3 a). A cross-check failure on such a row is alerted and audited, but **not** flagged in place.
4. **C-2's test exempts `plan` until P-3b.2.** The plan resolver can already return `flow: 'plan'` and has no handler, which is the pre-existing, intended release (P-3a SA Q-1). The test asserts `boost` is handled, and that every other flow is handled once `plan` appears in the map.
5. **C-5 lives in the owner READ path**, not in the writer. `lib/audit/ownerEventPresentation.ts` gives the four boost events a neutral `owner_label` (en/he/es) and empties `BOS_BOOST_FLAGGED`'s details. It is applied in `GET /api/audit/query`, and unlabelled rows are returned unchanged (the existing route pins pass). The owner `/monitoring` page shows `owner_label.en` (a one-line change). **That page has 6 `console.*` calls** (CLAUDE.md § Logging): flagged here and proposed for conversion; not converted in this slice. The data export is unchanged (the owner's full record).
6. **The receipt has a 6 s local hard bound** above the 5 s request timeout, so a client that ignored its options still cannot hold the webhook (C-4's "never hangs").
7. **Flag reasons written by the handler through `transition`:** `livemode_mismatch`, `metadata_mismatch`, `no_payment_intent`, `no_payment_required`, `session_amounts_missing`, `session_unreadable`. All are 1–64-character codes, as 20261031 requires.
8. **The handler's events with the same audit outcome share `BOS_BOOST_FLAGGED`**, with a `reason` code. `orphan_session_paid`, `paid_not_creditable`, `deterministic_failure` and `transition_not_allowed:<target>` are audit reasons only, never written to the row.

## 7. Going live for testing (after 4a deploys)

**Go-live gate for real money (SA point 7):** 4b merged and deployed (refunds and disputes stored on the purchase, and the reconcile pass), **and** the stuck-claim reclaim (P-8b or 4b's pass, R-8), in addition to DEP-3, DEP-7, DEP-8, DEP-9 and the first live receipt. Until then, refunds on boost charges fall to the legacy "unknown payment" error (Q-4), which is acceptable in test mode only.

Production Stripe is in **test mode**, so nothing here takes real money. Real-money go-live waits for the requirement's go-live note: DEP-3 key rotation, DEP-7 accountant, DEP-8 fee check, DEP-9, the first live receipt, and **4b's reconcile pass or P-8b** (R-8).

1. **Confirm 4a is deployed.** Vercel → Production → the deployment includes the 4a merge commit.
2. **Stripe dashboard (test mode) → Developers → Webhooks → the platform endpoint** (`https://<production host>/api/stripe/webhook`) → **Events to send**. Make sure all of these are selected; add any that are missing:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `charge.refunded` *(used by 4b; already handled for other flows)*
   - `charge.dispute.created`
   - `charge.dispute.closed`
   - `charge.dispute.funds_reinstated` *(the three `charge.dispute.*` events the route handles today; 4b)*

   If the Connect events go to the **same** endpoint, leave them as they are. Do not create a second endpoint.
3. **Note the endpoint's API version** (P2b-Q2: it may still be `2025-09-30.clover`). Every session field 4a reads (`payment_status`, `payment_intent`, `amount_subtotal`, `amount_total`, `total_details.amount_tax`, `currency`, `client_reference_id`, `metadata`, `livemode`) has the same shape on both versions. No change is needed for 4a.
4. **Vercel → Settings → Environment Variables → Production only.** ⚠️ **Never set `BUSINESS_OS_CREDITS_BOOST_ENABLED` on the Preview environment** (SA C-6 a): Preview and Production share one database, so a preview deployment would take boost checkouts against production rows.
   - Set `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS` = your own account id **first**.
   - Then set `BUSINESS_OS_CREDITS_BOOST_ENABLED` = `true`.
   - **Redeploy**, because env changes apply to new deployments.

   With the list set, only that account can reach the checkout. Remove `BUSINESS_OS_CREDITS_BOOST_ENABLED` to switch it off again.
5. **What can be tested before 5b:** the picker's Buy is still disabled (5a), so there is no in-product way to pay yet. **The end-to-end paid test (card 4242…, and a delayed method) is the first step of 5b.** Until then, step 4 is optional and harmless: the switch only opens `POST /checkout` to the listed account.
6. **If a test payment ever does not credit** (a stuck claim, F-1, until 4b or P-8b). **Only** for a **test-mode** event whose purchase row is still `pending` or `awaiting_payment` (SA C-6 b):
   1. Stripe dashboard (test mode) → Developers → Events → the `checkout.session.completed` (or `async_payment_succeeded`) event. Note its id (`evt_…`) and the session id in its data (`cs_test_…`).
   2. Supabase → SQL editor. Paste the statement below. Replace `PASTEEVENT` with everything **after** `evt_` in the event id, and `PASTESESSION` with everything **after** `cs_test_` in the session id. Underscores are written as `chr(95)` and dots as `chr(46)`, so nothing you paste contains either. The statement only matches a claim for a `checkout.session.completed` or `checkout.session.async_payment_succeeded` event (QA I-2); it is pinned by `lib/business-os/boost/__tests__/boostRecoverySql.doc.test.ts`.

      ```sql
      update public.processed_webhook_events as claim_row set status = 'failed' where claim_row.event_id = 'evt' || chr(95) || 'PASTEEVENT' and claim_row.status = 'processing' and (claim_row.metadata ->> 'livemode') = 'false' and claim_row.event_type in ('checkout' || chr(46) || 'session' || chr(46) || 'completed', 'checkout' || chr(46) || 'session' || chr(46) || 'async' || chr(95) || 'payment' || chr(95) || 'succeeded') and exists (select 1 from public.business_os_boost_purchases as purchase_row where purchase_row.stripe_checkout_session_id = 'cs' || chr(95) || 'test' || chr(95) || 'PASTESESSION' and purchase_row.livemode = false and purchase_row.status in ('pending', 'awaiting' || chr(95) || 'payment'));
      ```

      It must report **1 row** updated. **0 rows** means: the claim is not stuck, the event is live mode, or the purchase is no longer pending / awaiting payment. **Stop, and do not resend.** The statement never touches `auth.users`, and changes nothing but that one claim row.
   3. Stripe → that event → **Resend**. The retry credits exactly once (`already_credited` if an earlier run had credited).

## 8. CI, entitlements, estimate and risks

| Item | Value |
|---|---|
| CI | Mocked suites in existing jobs; no new job, so no added time |
| Entitlements | **No import** from `lib/business-os/entitlements/`: crediting uses the row's snapshot (FR-4). `enforcementPoints` must stay green with no new entry. The skill was checked |
| Schema | Every column and function used is from 20261030 / 20261031, read in the migration files and the repository's `BOOST_PURCHASE_COLUMNS` (both applied to PROD and verified, 2026-10-06). No new column |
| Estimate | **About 3 days** (slightly over the 2.5 asked): T4a.1–2 0.5 d; resolver and handler 1.25 d; receipt 0.25 d; audit, registration and integration 0.5 d; docs and checks 0.5 d |
| Split if SA prefers | **4a.1:** resolver, handler and repository (crediting complete, receipt omitted), about 2.25 d. **4a.2:** the receipt read and fill, about 0.5 d. Crediting does not depend on the receipt (T-8) |

| Risk | Mitigation |
|---|---|
| A boost event loops forever on a caller defect | N-1 / I-3 errors are deterministic and complete; the tests pin each SQLSTATE |
| Paid but not credited (a stuck claim, or a not-creditable row) | Alerts (`bos_boost_paid_not_creditable`, `bos_boost_mismatch`); row-based recovery (§1 F-1); 4b's pass; §7 step 6 |
| Connect path change | Not reachable (the dispatcher returns first); characterisation snapshot byte-identical |
| Conflict with P-3b.2 | Disjoint by mode; second lander rebases one map line and one test pin (§9) |
| Receipt read slows the webhook | 5 s bound and no retries, after the money write |

---

## 9. Notes for 4b, 5b and P-3b.2

| For | Note |
|---|---|
| 4b | Refunds and disputes: extend `boostResolver` to `charge.refunded` / `charge.dispute.*` by `findByPaymentIntentIdForWebhook` (R-6), and handle them per T-9, N-2 and I-1. **Until 4b**, a refund on a boost charge reaches the legacy `handleChargeRefunded`. That handler finds no `payment_transactions` row, logs `error` "charge.refunded for an unknown payment", writes nothing and completes (Q-4) |
| 4b | The reconcile pass (R-8) also: lists `bos_boost_paid_not_creditable` rows; backfills a missing `receipt_url` for `paid` rows (`recordReceipt` is fill-once); recovers F-1 |
| 5b | The first end-to-end paid test (§7 step 5). `purchaseAvailable` from the server-side access check (5a §9) |
| Incident note (QA I-1) | Legacy agent-platform boost-pack events (payment mode, no marker) now make **one** `business_os_boost_purchases` read before reaching the legacy branch. If that read fails, the resolver throws and the **legacy** event is released for a Stripe retry. That is safe, but those events depend on the read until P-10 retires the packs |
| 4b / review (QA I-4) | The handler relies on `recordBoostReceipt` never throwing (its own try/catch). If an injected receipt dependency ever threw, the handler would throw **after** the credit; the claim would be released, and the retry would answer `already_credited`. That is safe by idempotency, but keep the "never throws" contract on any replacement |
| P-3b.2 | Both slices edit `BUSINESS_OS_FLOW_HANDLERS` (one line each) and the `DEFAULT_RESOLVERS` pin in `webhookDispatcher.test.ts`. Whichever lands second rebases onto the other's line; the final map is `{ plan, boost }` |

---

## 10. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | C-8 (a) needs an unscoped `findByIdForWebhook`. Is it acceptable beside `findBySessionIdForWebhook`, under the same "signature-verified platform event only" rule? | Yes, with a header note naming its one caller, and the routerPlacement-style guard extended to pin that it is imported only by `boostWebhookSession.ts` |
| Q-2 | Flagged audit entries: owner-visible under `business_os_boost_purchase` (reason codes only), or a new operator-only entity type (requires an owner-audit-policy migration)? | Owner-visible, codes only; no migration |
| Q-3 | Where does the marker cross-check sit? In the resolver (deny, row left pending) or in the handler (flag the row)? | Handler: the row is the identity, so a disagreement flags that row and alerts. The resolver denies only when no row exists (C-8 a) |
| Q-4 | Refunds between the 4a deploy and 4b fall to the legacy "unknown payment" error and are completed (the fact is not stored on the purchase). Acceptable for test mode? | Yes: test mode only; the reconcile pass and 4b's handler store refunds before real money (go-live requires 4b) |
| Q-5 | The receipt: one bounded `paymentIntents.retrieve(expand latest_charge)` (T-8), versus subscribing to `charge.succeeded` | The retrieve (T-8): no extra event, no ordering problem; best-effort, and 4b backfills |
| Q-6 | Repository error classification: extend `fail()` with `{ sqlstate, deterministic }`, or classify in the handler from the message? | Extend `fail()`: the SQLSTATE is otherwise lost today |
| Q-7 | `transition → not_allowed` on a late `expired` / `failed` after `paid`: `error` + alert + audit (proposed), or `warn` only? | `error` + alert: it means Stripe and our row disagree about money |
| Q-8 | Split 4a.1 / 4a.2 (receipt separate), or one PR of about 3 days? | One PR, unless SA prefers the split |

## Business questions

None. §7 lists what the user does in the Stripe and Vercel dashboards. The end-to-end paid test needs 5b's Buy flow; that is a sequencing fact, not a decision.

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-07, against `a2b23edb` (`origin/main` is now `98dae9a7`; #253 does not touch the webhook)**
**Status:** ✅ Approved with conditions (C-1 to C-6). The Dev writes them in as the first step, and no second review is needed. **No user question.**

The design is right. It is one resolver and one handler on P-1's dispatcher. The row is the identity, the account comes only from the row, the money write comes first and best-effort work after it, every outcome ends in "complete" or "release", and there is no migration, no entitlements import and no Connect change. The F-1 stance (row-based recoverability, with 4b and P-8b owning the claim fix) is correct.

#### The eight points asked

**1. Claim lifecycle.** The route completes the claim **only after the handler returns**, and a throw sets it `failed` with a 500, so Stripe retries. The plan makes every deterministic outcome return normally: mismatch, `not_creditable`, `not_allowed`, a deterministic repository error, a Zod failure, the deny. Only transient failures throw. A transient failure **in the money write** therefore never completes the event. ✅ Two gaps:
- the SQLSTATE classes are under-specified (C-1);
- the resolver and the handler map must ship together (C-2).

**2. Tenant isolation with a crafted `client_reference_id`.** Signature verification means only our platform key can create such a session. With a leaked key (DEP-3), an attacker could put a **victim's purchase id** in `client_reference_id` and pay. The fallback then finds the victim's row and `credit` compares `p_session_id` with the row's **stored** session:
- a different stored session → `session_mismatch`;
- a NULL stored session → `no_session`.

**So the wrong account can never be credited.** ✅ But the attacker can **flag the victim's row**. Their real payment would then answer `not_creditable`, which is a grief vector. C-3 closes it.

**3. P-3b.2.** The handler map on `origin/main` is still `{}` (P-3b.1 is merged and inert), and the plan and boost resolvers are disjoint by `mode`. Whichever lands second rebases one map line and one pin. ✅

**4. The receipt cannot hurt the event.** It runs after the money write. `stripe@19` `RequestOptions` supports per-request `timeout` and `maxNetworkRetries` (verified in `types/lib.d.ts`), so 5 s with no retries is enforceable. A failure is a `warn`. Worst case: the RPC + 2 s audit + 5 s receipt, within Stripe's response window. Even if Stripe times out first, the claim completes when the function finishes, so a redelivery is a duplicate, never a second credit. ✅ (C-4 pins it.)

**5. Livemode.** Production Stripe is in test mode, so events and reserved rows are both `livemode = false` (slice 3 reserves with `currentStripeMode()`). The handler flags a mismatch before any credit, and the receipt skips on a key/event mismatch. ✅

**6. Audit visibility.** Owner-visible under `business_os_boost_purchase` is acceptable (Q-2). The details carry codes and the payment-intent id (FR-17's Stripe reference); a payment-intent id is not a secret. C-5 keeps the owner's **rendering** neutral.

**7. Refunds before 4b.** Acceptable **only while Stripe is in test mode.** **Go-live gate, made explicit:** real money requires **4b merged and deployed** (the refund and dispute handling stored on the purchase, plus the reconcile pass) **and** the stuck-claim reclaim (P-8b or 4b's pass, R-8), in addition to DEP-3, DEP-7, DEP-8, DEP-9 and the first live receipt. Recorded in §7.

**8. Go-live-for-testing steps and the event list** are correct and complete for 4a and 4b: the four `checkout.session.*` events plus `charge.refunded` and the three `charge.dispute.*`, one endpoint, list set **before** the flag, then redeploy. C-6 adds two small points.

#### Conditions

| # | Severity | Condition |
|---|---|---|
| **C-1** | **Medium** | **Classify SQLSTATEs precisely** in `isDeterministicRepositoryError`. A deterministic error is completed with an alert; a transient one throws. **Deterministic:** class **22** (data exceptions), **23514** (check violation), **23502** (not null), **23503** (FK), **42xxx** (syntax / undefined object: a deploy defect that a retry cannot fix), and repository validation refusals. **Transient:** **23505** (a cross-row unique race; 2b showed the retry converges and flags), **40xxx** (serialisation and deadlock), **08xxx**, **53xxx**, **57xxx**, a network or timeout error, a plain `Error`, and **XX000** (also logged at `error` with `alert`: the 2b "no lot back" anomaly). Pin each in the repository test. |
| **C-2** | **Medium** | **Resolver and handler ship together.** A recognised flow with no handler throws `BusinessOsHandlerMissingError` and **releases the claim**, which would loop Stripe for about 3 days. The same PR appends `boostResolver` **and** registers `BUSINESS_OS_FLOW_HANDLERS.boost`. A test (in `routerPlacement.guard` or the dispatcher test) asserts that every flow a default resolver can return has a registered handler. |
| **C-3** | **Medium** | **The `client_reference_id` fallback must not mutate a row it did not match by session.** When the row comes from the fallback (session-id miss): (a) **stored session NULL** (slice 3's ambiguous create) → call `credit` as planned, which flags it `no_session` (visible, refundable); (b) **stored session non-NULL and different** → **do not call `credit` or `transition`**. Log `error` `bos_boost_orphan_session_paid` with `alert: true` and both session ids, write `BOS_BOOST_FLAGGED` (reason `orphan_session_paid`) against the row's account, and **complete**. The row keeps its own session, so the owner's real payment still credits, and a leaked-key griefer can no longer flag someone else's purchase. A test covers both branches. |
| **C-4** | Low | **Pin the receipt bounds:** the call passes `{ timeout: 5000, maxNetworkRetries: 0 }` as **request options** (not client options, which would affect slice 3's checkout client). The receipt step never throws, which a test proves with a hanging mock that a fake timer releases. |
| **C-5** | Low | **Owner rendering of the boost audit events:** the owner audit view shows a neutral label for `BOS_BOOST_FLAGGED` ("Payment under review"), and does not show raw reason codes or the payment-intent id as prose. If the owner UI already renders labels per event and hides details, state that and add the labels in en, he and es. The admin view keeps the full details. |
| **C-6** | Low | **§7 additions.** (a) **Preview stays off:** never set `BUSINESS_OS_CREDITS_BOOST_ENABLED` on the Preview environment (the database is shared). (b) **Step 6 recovery:** the SQL must be the exact paste-safe statement (no comments, no word **into** in a string, never touching `auth.users`), and it is used **only** on a test-mode event while the row is still `pending` or `awaiting_payment`. |

#### Rulings on Q-1 to Q-8

| Q | Ruling |
|---|---|
| **Q-1** | **Yes:** `findByIdForWebhook`, unscoped, with the header note and a guard that only `boostWebhookSession.ts` imports it, under C-3's restriction. |
| **Q-2** | **Owner-visible, codes only, no migration**, with C-5. |
| **Q-3** | **In the handler**, as proposed. The row is the identity, and the resolver denies only when no row exists. |
| **Q-4** | **Yes for test mode only**, behind the go-live gate in point 7. |
| **Q-5** | **The single bounded retrieve** (T-8). 4b backfills a missing receipt. |
| **Q-6** | **Extend `fail()`** with `{ sqlstate, deterministic }`, with C-1's classification. |
| **Q-7** | **`error` + alert + audit**: Stripe and our row disagree about money. |
| **Q-8** | **One PR** (about 3 days plus about 0.5 day for C-1 to C-6). The split is not needed: the receipt is small and isolated. |

#### Other checks

- **HP-4:** the Connect characterisation snapshot must stay byte-identical. The dispatcher returns before any resolver for `event.account`, and an integration test sends a marker-carrying Connect session. ✅
- **FR-18 / FR-19:** no agent-platform table and no plan, tier or trial is touched. ✅
- **Schema:** only columns and functions from 20261030 / 20261031, applied and verified. ✅
- **CI:** mocked suites; no added time. **Entitlements:** no import. ✅

#### Approval

[x] Workplan approved with conditions C-1 to C-6. Proceed to implementation.

### SA Code Review (4a)

**Code Review by SA — 2026-10-07**
**Status:** ✅ **Code Approved for QA, with one condition from CLAUDE.md rule 3** (CR-1): `app/(protected)/monitoring/page.tsx` is touched and still has 6 `console.*` calls. Unless the user explicitly declines its conversion, it is converted to Pino before the commit. Everything else is approved with no change.

**Scope:**
- **Created:** five `lib/business-os/boost/` webhook modules, fixtures, three unit test files, the boost routing integration test, `lib/audit/ownerEventPresentation.ts` and its test.
- **Modified:** `route.ts` (the handler map line), `webhookDispatcher.ts` and its test, the Connect characterisation snapshot, the repository and its test, audit events and audience, `app/api/audit/query/route.ts` and its test, the monitoring page (one line), the requirement.

#### What I verified myself

| Check | Result |
|---|---|
| 21 suites: the 4a units, the integration test, the dispatcher, the repository, the audit and audit-route tests, **every** `app/api/stripe/webhook/__tests__` suite (incl. the Connect characterisation, `routerPlacement`, `pinoLogging`, `receiptOnPaid`, `fix1Ownership`, `ownerCacheRetry`, `planOwnership`, `routerEdgeCases`), and `enforcementPoints` | ✅ **591 passed, 45 snapshots passed** |
| **The Connect snapshot** | ✅ **0 lines removed and 17 added**, all inside the **P6 platform** entry (`Stripe webhook, platform path through the Business OS router (P-1) P6…`, at line 5796): the boost resolver's single `select … eq stripe_checkout_session_id`. **Every Connect entry (1a–11, FU5) is byte-identical** (HP-4) |
| Scoped tsc over **every** touched `.ts` / `.tsx` (types-first config) | ✅ **0 errors in the touched files.** The 67 errors sit in 20 other files, **all byte-identical to `origin/main`**, so they are pre-existing |
| Mutation M1: a transient repository failure completes instead of throwing | ✅ Caught: 12 red (handler and integration) |
| Mutation M2: a row matched only by reference gets flagged (C-3 broken) | ✅ Caught: 1 red |
| Mutation M3: `23505` classed as deterministic | ✅ Caught: 2 red (repository) |
| Restoration after each mutation | ✅ SHA-1 checked |

#### The claim lifecycle, end to end

`route.ts` is unchanged except the map line: **handler returns → `completeClaim` + 200; handler throws → the catch sets the claim `failed` + 500 → Stripe retries; a dispatcher `deny` → complete + 200.** In the handler:

- **Every transient path throws `BoostWebhookTransientError`:** a lookup, credit, transition or flag write with a non-deterministic error, including `23505`, `40xxx`, network errors and `XX000` (which is also alerted). M1 proves a transient credit failure can **never** complete the event.
- **Every deterministic path returns:** class 22 / 42, `23514` / `23502` / `23503`, validation, a Zod failure (flagged), mismatch, `not_creditable` on paid (C-8 b), `not_allowed`, a `none` row, and an unexpected event type. None throws.
- The audit (`logAndFlush`, 2 s, never throws) and the receipt (never throws) cannot change the outcome.

✅

#### Conditions C-1 to C-6 and the Q rulings

| | Met? |
|---|---|
| C-1 SQLSTATE classes | ✅ `isDeterministicSqlState`: 22*, 42*, 23514, 23502, 23503 deterministic; everything else transient; `XX000` alerted. M3 pins `23505` |
| C-2 resolver and handler together | ✅ `DEFAULT_RESOLVERS = [planResolver, boostResolver]` and `BUSINESS_OS_FLOW_HANDLERS = { boost }` in the same diff, with a guard. `plan` is exempt until P-3b.2 (deviation, accepted: a pre-existing P-1 state) |
| C-3 the fallback never mutates a mismatched row | ✅ `by_reference` with a different stored session → alert (`bos_boost_orphan_session_paid` when paid) + `BOS_BOOST_FLAGGED`, **no write**. With a NULL stored session and paid → `credit` (→ `no_session`). Applied more broadly (deviation): **any** flag on a by-reference row is alert + audit only, never a transition. Accepted, because it is stricter. M2 proves it |
| C-4 receipt bounds per request | ✅ `BOOST_RECEIPT_REQUEST_OPTIONS = { timeout: 5000, maxNetworkRetries: 0 }` passed as **request** options to `paymentIntents.retrieve`, plus a local hard limit. The slice 3 client is untouched. The mode guard skips on a key/event mismatch |
| C-5 owner rendering | ✅ `presentOwnerAuditRow` in the owner query route adds a neutral `owner_label` (en/he/es) and **empties `details` for `BOS_BOOST_FLAGGED`**. The admin audit routes are unchanged, so admins keep the full details. Note: an owner can still read their own raw row through the existing owner RLS policy on `audit_trail`. That shows the same codes, which are not secret, so this is accepted per Q-2 |
| C-6 §7 Preview off and the recovery SQL | ✅ (§7) |
| Q-1 to Q-8 | ✅ As ruled |

#### Other checks

- **Tenant isolation:** the account is `row.accountId` everywhere (calls, audit `userId`). `client_reference_id` is used only as a lookup key, and C-3 stops it from mutating a mismatched row. ✅
- **No secrets in logs:** session and payment-intent ids, statuses and codes only; no email, client secret or key. ✅
- **Lazy repository load** (deviation): `boostWebhookDeps.ts` dynamic-imports the repository module, so importing the dispatcher (which tests and other routes do) does not pull in the service-role client. The module cache makes it a single singleton after the first call, so the service-role client lifecycle is unchanged. A load failure throws, which is transient: the claim is released. ✅
- **P-3b.2 ordering:** `origin/main`'s map is still `{}`, and the resolvers are disjoint by mode. P-3b.2 rebases one map line and the `DEFAULT_RESOLVERS` pin. ✅
- **No entitlements import, no migration, no CI time added.** ✅

#### Findings

| # | File | Finding | Priority |
|---|---|---|---|
| **CR-1** | `app/(protected)/monitoring/page.tsx` | **CLAUDE.md rule 3: a touched file still has 6 `console.*` calls.** The Dev flagged it and the coordinator is asking the user. **Convert it to the Pino standard before the commit unless the user explicitly declines.** If the user declines, record the decision in §6.1 and this item closes. | **Must-fix (or explicit decline)** |
| N-1 | Note for 4b | 4b's refund and dispute resolver reuses `findByPaymentIntentIdForWebhook`, and must apply the same by-reference rule: never mutate a row it did not match by its own identifier. | Carry-forward |

#### Code Approved for QA: **Yes**, with CR-1 closed (converted, or declined by the user) before the commit

#### CR-1 closed, and the merge plan (SA, 2026-10-08)

✅ **CR-1 closed.**
- **The conversion:** the user chose to convert. `monitoring/page.tsx` (`'use client'`) now uses `createLogger({ module: 'MonitoringPage' })`, the same client-safe pattern as `UsageCard`, with 0 `console.*` left. The single `error` is logged as `{ err }`, and the five traces as `debug`.
- **Logged fields:** counts, time filters, stats objects, `sample` (action and date only), and the admin's own `searchTerm` at debug level. There are no secrets, tokens, emails or other users' data, so the fields are acceptable.
- **The plan is approved:** commit 4a, merge `origin/main` 711fe71e (#253–#257), re-run the 4a bar and the Connect characterisation, then open the PR.
- **What RM must watch:**
  - **Line endings:** `route.ts` is LF in the index and CRLF in the working copy, and `core.autocrlf=true`. Check `git diff --cached --stat` shows only the handler-map line plus the import, not the whole file, before committing.
  - **#257:** its change is a dedupe **inside the Connect `invoice.paid` handler** (`payment_transactions` by payment intent). It runs only for Connect events, which the dispatcher never offers to the boost resolver. So it does not interact with the resolver order. Re-running the characterisation after the merge confirms it, and any snapshot change must sit only in #257's own entries.

## QA Testing Report

### QA — 4a (2026-10-07)

**Verdict:** ✅ **PASS WITH NOTES.** Money correctness holds in every case QA tried:
- Credit happens only on `paid`.
- The account always comes from the row.
- A replay never credits twice.
- Every deterministic outcome completes the event, and every transient one throws (so Stripe retries).
- Connect, plan and legacy-pack events are untouched.
- The receipt and the audit write can never change the outcome.

There is **one Medium defect** (a false alert, plus an owner-visible "Payment under review" entry, on an already-credited purchase when a stale `completed(unpaid)` arrives late) and **two Low/Info items**. SA's CR-1 (`monitoring/page.tsx` `console.*`) is the user's call and is not assessed here.

**Test mode:** full
**Strategy used:** A + B (Jest, everything mocked: no Stripe, no Supabase). One scratch suite, `qa/boostWebhook4a.qa.test.ts` (132 tests), is **not committed**. It has:
- a fake repository emulating the 2b SQL's creditable and transition rules;
- the real handler, resolver, dispatcher, receipt and owner presentation;
- the real repository `fail()` behind a fake RPC client.

Also: three source mutations of the handler, each restored and SHA-1 checked.
**Focus:** api (webhook), money correctness, tenant isolation, security (logs and audit), runbook SQL
**Skipped:**
- real Stripe deliveries and real ordering (no account);
- the live `processed_webhook_events` schema (QA cannot reach PROD; the route's insert writes `metadata.livemode`, so the recovery predicate matches what the code writes);
- the `oneAddressPolicy` Linux-path copy (the Dev ran it);
- CR-1.

**Input source:** coordinator brief + workplan §3, §6, §7

#### Commands run

| Check | Result |
|---|---|
| 4a local bar (JSX scratch config, `--ci` so no snapshot is written):<br>• all of `lib/business-os/boost/__tests__`;<br>• **every** `app/api/stripe/webhook/__tests__` suite (incl. the Connect characterisation, `boostRouting.integration`, `routerPlacement`, `pinoLogging`, `receiptOnPaid`, `fix1Ownership`, `ownerCacheRetry`, `planOwnership`, `routerEdgeCases`);<br>• `lib/business-os/billing/__tests__`;<br>• `lib/audit/__tests__` and `app/api/audit/__tests__`;<br>• the repository test;<br>• `enforcementPoints` | ✅ **45 suites, 1,075 tests, 45 snapshots passed** |
| Scoped tsc (SA's types-first `tsconfig.4a.json`) | ✅ **0 errors in any changed or new file.** 67 errors in 20 other files, none of them in this diff, as SA recorded |
| QA scratch suite | ✅ 132 / 132, with the observations below |
| Handler mutations | ✅ Each caught (2 red in the handler and integration suites): livemode check removed; marker check removed; `unpaid` credited. Restored, SHA-1 identical |
| Source untouched | ✅ The SHA-1 of all 24 non-doc files and the `git status --porcelain` output match the pre-QA snapshot |

#### Matrix: event × `payment_status` × row state (fake 2b rules)

Every one of the 56 combinations **completes** (none throws, because none is transient), and **`credit` is called only when `payment_status = 'paid'`**. Audits always carry the row's account.

| Event / status | pending | awaiting | expired | paid | abandoned¹ | failed | flagged | refunded |
|---|---|---|---|---|---|---|---|---|
| completed / paid | credited + audit + receipt | credited | credited | already (no audit; receipt fill) | paid_not_creditable, alert | paid_not_creditable, alert | paid_not_creditable, alert | already (no audit) |
| completed / unpaid | → awaiting | already | not_allowed, alert | **not_allowed, alert + FLAGGED (QA4a-D1)** | no write | not_allowed, alert | not_allowed, alert | not_allowed, alert |
| completed / no_payment_required | flagged `no_payment_required`, alert | flagged | flag attempted, alert | flag attempted, alert | no write | flag attempted | flag attempted | flag attempted |
| async_succeeded / paid | credited | credited | credited | already | paid_not_creditable | paid_not_creditable | paid_not_creditable | already |
| async_succeeded / unpaid | alert + FLAGGED `async_succeeded_not_paid`, no write | 〃 | 〃 | 〃 | no write | 〃 | 〃 | 〃 |
| async_failed | → failed + `PAYMENT_FAILED` audit | → failed + audit | not_allowed, alert | not_allowed, alert | no write | already | not_allowed | not_allowed |
| expired | → expired | → expired | already | not_allowed, alert | no write | not_allowed | not_allowed | not_allowed |

¹ An abandoned row holds no session, so the session read misses and the row is found by reference with a NULL stored session. C-3 then allows only a paid credit (`not_creditable` → alert); every status event leaves it alone.

#### Other results

| Area | Result | Notes |
|---|---|---|
| Replays | ✅ | The same `completed(paid)` twice → `credited`, then `already_credited`; **one** `BOS_BOOST_CREDITED` audit. Duplicate event ids are short-circuited by the route's claim (integration suite) |
| Out-of-order | ✅ / ⚠️ | `expired`, then a late `completed(paid)` → credited (expired is creditable). `async_succeeded` before `completed(unpaid)` → credited, then the stale unpaid event raises `transition_not_allowed:awaiting_payment` with an alert and an owner-visible `BOS_BOOST_FLAGGED` (QA4a-D1). `completed(paid)`, then `expired` → `not_allowed` alert + FLAGGED (Stripe does not send `expired` for a completed session, so this is Info) |
| Livemode mismatch | ✅ | Flagged `livemode_mismatch`, no credit |
| Marker / legacy keys | ✅ | Another product's marker, or legacy `user_id` / `credits` keys → flagged `metadata_mismatch`, no credit. A planted `bos_user_id` or another account's `client_reference_id` never moves the account |
| Row without marker | ✅ | A session found by its own session id with empty metadata still credits (the row is the identity, Q-3) |
| Marker without row | ✅ | `deny metadata_mismatch`. Marker plus a non-UUID `client_reference_id` → deny after **one** read (no id read) |
| Fallback (`client_reference_id`) | ✅ | Stored NULL + paid → `credit` → `no_session` flag, alert. Stored different + paid → **no write**, `orphan_session_paid` alert + audit, the row stays `pending`. Stored different or NULL + expired → no write, no audit (C-3 holds) |
| Connect | ✅ | A Connect `checkout.session.completed` with the boost marker → the dispatcher answers `not_business_os` with **zero** boost reads (and the resolver also returns early on `event.account`). The characterisation snapshot passes with no update |
| Plan / other types | ✅ | Subscription-mode session → `not_business_os` with no read; `invoice.paid` → no boost read; `charge.refunded` and `payment_intent.succeeded` → `not_business_os` (4b) |
| Legacy pack | ✅ / Info | No marker and no row → `not_business_os` after one keyed read, so the legacy branch runs unchanged (integration suite and the P6 snapshot). See I-1 |
| SQLSTATE matrix (C-1) | ✅ | Through the handler, for both `credit` and the lookup: **complete** on 22004, 22023, 22003, 22P02, 23514, 23502, 23503, 42883, 42501, 42P01. **Throw** on 23505, 40001, 40P01, 08006, 53300, 57014, XX000, a null code, a non-SQL code, and a plain `Error`. The real repository `fail()` classifies an RPC error with `code: '22023'` as deterministic and a thrown fetch error as transient. A repository method that *throws* propagates, and the route releases the claim (same effect as transient) |
| Receipt | ✅ | `paymentIntents.retrieve(pi, {expand:['latest_charge']}, {timeout:5000, maxNetworkRetries:0})`, as request options. A hung call → `unavailable` after the 6 s hard limit (fake timers). A Stripe error (message containing the email), a throwing client, no charge, or an `http` receipt URL → `unavailable`, never a throw, **and the email never reaches the logs**. A key/event mode mismatch or an unknown mode → `skipped_mode` |
| Audit and logs | ✅ | Across credited, not-creditable, livemode, a Zod failure, an orphan and async-failed scenarios, no audit entry or log line contains the buyer's email or the session `client_secret` |
| Owner presentation (C-5) | ✅ | `BOS_BOOST_FLAGGED` → `owner_label` "Payment under review" / "התשלום בבדיקה" / "Pago en revisión", with `details` `{}`. The stored row is unchanged, so the admin view keeps the details. Unlabelled rows are returned as the same object. `BOS_BOOST_CREDITED` keeps `lot_id` and `stripe_payment_intent_id` for the owner (accepted by SA, Q-2) |

#### §7 step 6 recovery SQL (review)

| Check | Result |
|---|---|
| Paste rules | ✅ One statement, no `--` or `/*`. Literals `'failed'`, `'evt'`, `'PASTEEVENT'`, `'processing'`, `'livemode'`, `'false'`, `'cs'`, `'test'`, `'PASTESESSION'`, `'pending'`, `'awaiting'`, `'payment'` are all `[A-Za-z0-9_ ]`; underscores come from `chr(95)`. The word **into** appears nowhere |
| Scope | ✅ It updates only `public.processed_webhook_events`, only a row whose `status = 'processing'` **and** `metadata->>'livemode' = 'false'`. The route's insert writes `metadata: { livemode: event.livemode }`, so `->>` yields `'false'` for test events. It is gated on an existing `business_os_boost_purchases` row with a **`cs_test_`** session, `livemode = false` and status `pending` / `awaiting_payment`. The live prefix `cs_live_` can never match |
| `auth.users` | ✅ Never named |
| Safety if misused | ✅ Setting a claim back to `failed` only lets the next delivery reclaim it; `credit` is idempotent under the row lock, so a still-running original plus the resend cannot double-credit |
| Note | Info I-2: the statement does not tie the **event** to the **session** (they are independent placeholders), so a mistaken event id would release an unrelated stuck test-mode claim. That is harmless in test mode (the resend is processed normally). The "1 row" expectation in §7 is the user's check |

#### Issues Found

##### Bugs

1. **QA4a-D1: a late `completed(unpaid)` on an already-credited purchase raises a false alert and an owner-visible "Payment under review".** Severity: **Medium**. Money is unaffected; the cost is on-call noise and a confusing, support-generating entry in the owner's activity. File: `lib/business-os/boost/boostWebhookHandler.ts` (`moveRow` → `not_allowed` → `flagged`).
   - Steps to reproduce: a delayed-method purchase. `checkout.session.async_payment_succeeded` is processed first, and the row is credited (`paid`). Then `checkout.session.completed` with `payment_status: 'unpaid'` arrives.
   - Expected: a stale "awaiting payment" event for a purchase that is already paid is benign, so it should complete with `info` / `warn`, and with no `BOS_BOOST_FLAGGED`.
   - Actual: `transition(awaiting_payment)` → `not_allowed` → `error bos_boost_transition_not_allowed` with `alert: true`, and `BOS_BOOST_FLAGGED` (`transition_not_allowed:awaiting_payment`). The owner then sees "Credits added" **and** "Payment under review".
   - How it happens: Stripe does not guarantee event order. More commonly, the first delivery of `completed(unpaid)` fails transiently and is retried after `async_payment_succeeded` has been processed.
   - Fix: in `moveRow`, treat `awaiting_payment` → `not_allowed` from a **paid-family** status (`paid`, `partially_refunded`, `refunded`, `disputed`, `dispute_lost`) as stale (`info`, no audit). Keep the alert for `failed` / `expired` against a paid row (genuine disagreement, Q-7), and for `awaiting_payment` against `failed` / `flagged`. Add one handler test for each order.

##### Edge Cases / Info

- **I-1:** legacy agent-platform boost-pack events (payment mode, no marker) now make one `business_os_boost_purchases` read before reaching the legacy branch. If that read fails, the resolver throws and the **legacy** event is released for retry. That is safe (Stripe retries), but legacy packs now depend on that read until P-10 retires them. No change needed; worth knowing during an incident.
- **I-2:** the recovery SQL does not bind the event to the session (see above). Optional hardening: `and claim_row.event_type in ('checkout.session.completed', 'checkout.session.async' || chr(95) || 'payment' || chr(95) || 'succeeded')`.
- **I-3:** `completed(no_payment_required)` on a row in a non-flaggable state (paid, failed, expired) logs "flagged" and audits `BOS_BOOST_FLAGGED`, although the transition answered `not_allowed`, so the log line names a flag that did not happen. The outcome is correct (complete + alert). With promotion codes off it is unreachable; it is cosmetic.
- **I-4:** a receipt dependency that *throws* (the production one never does) would make the handler throw **after** the credit. The claim would then be released and the retry would answer `already_credited`. That is safe by idempotency, and noted because the contract "receipt never changes the outcome" depends on `recordBoostReceipt`'s own try/catch.

#### Recommended additions

| # | Test | Where | Priority |
|---|---|---|---|
| R-1 | `async_succeeded` → credited, then a late `completed(unpaid)` → no alert, no FLAGGED audit | `boostWebhookHandler.test.ts` | **With the D1 fix** |
| R-2 | A row-state matrix test (event × payment_status × status) pinning complete-vs-throw and "credit only when paid" | `boostWebhookHandler.test.ts` | Should |
| R-3 | SQLSTATE table extended with 22P02, 40P01, 42501, 42P01, 53300 and a non-SQL code | repository / handler test | Should |
| R-4 | The receipt never logs a Stripe error message (a message containing an email) | `boostReceipt.test.ts` | Nice |
| R-5 | A Connect session carrying the boost marker → zero boost reads (dispatcher level, in addition to the route) | `webhookDispatcher.test.ts` | Nice |
| R-6 | The recovery SQL text pinned in a test: paste rules, `cs_test_` only, no `auth` | migration-style doc test (optional) | Nice |

#### Test Outputs / Logs

```text
4a bar:     Test Suites: 45 passed, 45 total   Tests: 1075 passed, 1075 total   Snapshots: 45 passed, 45 total
QA scratch: Tests: 132 passed, 132 total
  LATE completed(unpaid) after credit -> audits added: [ 'BOS_BOOST_FLAGGED:transition_not_allowed:awaiting_payment' ] alert: true
  fallback stored NULL, paid: writes=credit audits=BOS_BOOST_FLAGGED:no_session alert=true status=flagged_mismatch
  fallback stored different, paid: writes=none audits=BOS_BOOST_FLAGGED:orphan_session_paid alert=true status=pending
  fallback stored different, expired: writes=none audits= alert=false status=pending
  charge.refunded -> not_business_os | payment_intent.succeeded -> not_business_os
  owner CREDITED details keys: [ 'lot_id', 'stripe_payment_intent_id' ]
Mutations:  livemode check off -> 2 failed | marker check off -> 2 failed | unpaid credited -> 2 failed | RESTORED_OK
Scoped tsc: 67 errors, 0 in changed files (20 untouched files)
```

#### Final Status
- [x] The 4a acceptance criteria pass: crediting is exactly once, only when paid, to the row's account, with correct complete / release behaviour. Ready for the user's diff review once SA's CR-1 is closed. **Recommended before the PR:** the small QA4a-D1 fix and its test. The Info items need no change.
- [ ] Issues found that the Dev must address before commit

## Commit Info

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-07 | Created | Slice 4a workplan against `a2b23edb` (after #252). One resolver (platform `checkout.session.*`, payment mode, keyed by our purchase row with the C-8 fallback) and one handler (credit only when paid; awaiting, failed, expired; the outcome map to complete or release; N-1 / I-3 deterministic errors; C-8 b alert), a bounded receipt read, three audit events, and two repository additions. No migration and no entitlements import. Go-live-for-testing steps with the DEP-9 event list. About 3 days (split offered). Eight SA questions; no business question |
| 2026-10-07 | SA workplan review: approved with conditions | C-1 precise SQLSTATE classification (23514/23502/23503/22/42 deterministic; 23505/40/08/53/57/XX000 transient). C-2 resolver and handler in one PR, with a guard that every resolvable flow has a handler. C-3 the fallback never mutates a row with a different stored session (orphan alert instead), closing a leaked-key grief vector. C-4 receipt bounds as request options. C-5 neutral owner rendering of flagged events. C-6 Preview stays off; paste-safe recovery SQL. Go-live gate: real money needs 4b and the stuck-claim reclaim. Q-1 to Q-8 ruled, one PR. No user question |
| 2026-10-07 | SA approved with conditions; implemented; Code Complete | C-1 to C-6 applied (§3.0). Built: the resolver, handler, session narrowing, receipt and wiring; the repository's `findByIdForWebhook` and failure classification; three audit events; the owner presentation (C-5); registration in the dispatcher and the route. 284 suites / 6,865 tests green. The Connect snapshot is byte-identical; P6 (platform boost pack) was updated on purpose for the one boost read. Three mutations caught. 0 tsc errors in 4a files. §7 adds the Preview warning and the exact recovery SQL. Nothing committed |
| 2026-10-07 | SA code review (4a): Code Approved for QA | 591 tests and 45 snapshots green. The Connect snapshot is 0 removed and 17 added, only in the P6 platform entry. Scoped tsc: 0 in touched files; 67 in 20 untouched files identical to main. Mutations caught: a transient failure completing, a by-reference row flagged, `23505` deterministic. Claim lifecycle verified end to end. C-1 to C-6 met; deviations accepted. CR-1: convert `monitoring/page.tsx` `console.*` or record the user's decline |
| 2026-10-07 | QA (4a): PASS WITH NOTES | 4a bar: 45 suites / 1,075 tests / 45 snapshots green (all webhook suites, Connect characterisation unchanged); scoped tsc 0 in changed files. QA scratch suite (132): a 56-cell event × payment_status × row-state matrix (all complete, credit only on paid, account always the row's); replays and out-of-order; livemode and marker checks; marker-without-row deny; the C-3 fallback branches; Connect / plan / legacy untouched; the SQLSTATE matrix (10 complete, 9 throw); receipt timeout / hang / errors / mode never change the outcome or leak the email; owner "Payment under review" with empty details in en/he/es. Three handler mutations caught. §7 step-6 SQL reviewed: paste-safe, test-mode `processing` claims only, gated on a pending / awaiting `cs_test_` purchase, never `auth.users`. QA4a-D1 (Medium): a late `completed(unpaid)` after crediting raises a false alert and an owner-visible "Payment under review". Info I-1 to I-4 |
| 2026-10-07 | QA follow-ups applied | QA4a-D1: a late awaiting-payment event on a paid-family purchase is stale (`info`, no alert, no owner entry). I-3: accurate log when a flag cannot be applied. I-2: the recovery SQL also checks the event type (pinned by a doc test). R-1 to R-6 added (the 56-cell matrix, the SQLSTATE table, receipt log hygiene, the dispatcher-level Connect check, the SQL pin). I-1 and I-4 noted in §9. 4a bar: 47 suites / 1,165 tests / 45 snapshots green. Connect snapshot unchanged. 0 tsc errors in 4a files. CR-1 (the monitoring page's `console.*`) awaits the user. Nothing committed |
| 2026-10-08 | SA CR-1 resolved; branch update stopped | The user chose to convert: `monitoring/page.tsx` now uses `createLogger` (`error` for the fetch failure, `debug` for the five traces); 0 `console.*` left. The merge of `origin/main` (711fe71e: #253–#257) was refused on the dirty tree, as expected. It overlaps `route.ts` and the Connect snapshot, and both merge cleanly in a scratch preview. P-3b.2 has not landed, so the C-2 exemption stays. 4a bar 47 / 1,165 / 45 snapshots, wider set 197 / 5,261, all green; 0 tsc errors in 4a files. Nothing committed |
| 2026-10-08 | SA: CR-1 closed; merge plan approved | `monitoring/page.tsx` converted to the client Pino logger (no PII in the logged fields). Commit, then merge `origin/main` 711fe71e. Watch the CRLF/LF diff on `route.ts`. #257's Connect dedupe is independent of the boost resolver; re-run the characterisation |
| 2026-10-08 | Approved and committed, PR open | The user saw the diff and approved the commit (2026-10-08). RM committed on `feature/bos-credits-boost-slice-4a`, merged `origin/main` in, and opened a PR to `main`. After deploy the user subscribes the Stripe events (§7) |
| 2026-10-08 | Post-merge characterisation (#254) | After the merge with main, #254's four agent-platform boost-pack entries (X44, X45, X46, X54) gain the same keyed boost read as P6 (accepted per QA I-1 and the SA P6 ruling). Only those four were regenerated: +68 / −0, 17 lines each, no Connect entry touched. 4a bar 47 suites / 1,220 tests / 100 snapshots green. Uncommitted for RM |
