# Requirement: Stripe Connect Refunds Reach the Books (refund webhook fix)

> **Last Updated**: 2026-10-14

**Created by:** BA
**Date:** 2026-10-14
**Status:** SA-approved with amendments folded; business decisions taken (2026-10-14). Next: Dev workplan
**Branch:** `fix/stripe-connect-refund-webhook`
**Source of truth (diagnosis):** [STRIPE_CONNECT_CHARGE_REFUNDED_WEBHOOK_RCA.md](/docs/investigations/STRIPE_CONNECT_CHARGE_REFUNDED_WEBHOOK_RCA.md). This requirement does not re-diagnose. Where the two disagree, the RCA is right and this file is corrected.

## Overview

A refund made outside the app has never been recorded. That covers refunds made in the Stripe dashboard, refunds Stripe makes itself, and app refunds whose Stripe reply was lost. The webhook handler meant to catch them (`handleChargeRefunded`, `app/api/stripe/webhook/route.ts:518`) loops over a list Stripe stopped sending in 2022, so it writes nothing and still marks the event `completed`. As a result the refund ledger, the payment's refund state, the booking and the admin Finance page all miss these refunds. The double-refund guard also cannot see them. This fix records refunds from the `refund.created`, `refund.updated` and `refund.failed` events. Those events already arrive and are currently dropped. No live-mode refund is affected yet; every affected event so far is test mode.

---

## Table of Contents

- [0. Status](#0-status)
- [1. Problem](#1-problem)
- [2. User Stories](#2-user-stories)
- [3. Functional Requirements](#3-functional-requirements)
- [4. Slices](#4-slices)
- [5. Acceptance Criteria](#5-acceptance-criteria)
- [6. Guards Touched](#6-guards-touched)
- [7. Non-Functional Requirements](#7-non-functional-requirements)
- [8. Booking Behaviour (as-built)](#8-booking-behaviour-as-built)
- [9. Business Questions](#9-business-questions)
- [10. Questions for SA](#10-questions-for-sa)
- [11. Flags Recorded (not fixed here)](#11-flags-recorded-not-fixed-here)
- [12. Out of Scope / Future Roadmap](#12-out-of-scope--future-roadmap)
- [13. Notes on Integration Points](#13-notes-on-integration-points)
- [14. SA Review](#14-sa-review)
- [Change History](#change-history)

---

## 0. Status

Later stages update this block in place. Do not append a second one.

| Stage | Owner | Status |
|---|---|---|
| RCA | TS | ✅ Done 2026-10-14 (read-only, `main` @ `3b300f58`) |
| Requirement draft | BA | ✅ Drafted 2026-10-14 |
| Business questions Q1–Q3 | User via TL | ✅ Answered 2026-10-14: Q1 (a) leave; Q2 (a) fix now, slice 3 in scope, confirm-time email follow-up deferred (§12); Q3 (a) keep as-built booking behaviour |
| Requirement review (incl. §10 rulings) | SA | ✅ SA-approved with amendments folded 2026-10-14: all 11 SA questions ruled (§14.2); amendments A-1..A-12 folded into §3–§7, §11–§13 by BA on 2026-10-14; Q2 re-worded (§14.4). SA verifies the fold-in at workplan review; no second requirement pass |
| **Next step** | RM | ⬜ Commit slices 1–3 from the three slice patches (QA's C-3 source guard goes into commit 3; docs go into commit 2), push, open the PR. Then the user runs the post-deploy checklist (FU-7) |
| Workplan | Dev | ✅ Written 2026-10-14: [STRIPE_CONNECT_REFUND_WEBHOOK_WORKPLAN.md](/docs/workplans/STRIPE_CONNECT_REFUND_WEBHOOK_WORKPLAN.md). SA-8 run read-only: everything verifiable matches the migrations (columns, NOT NULLs, defaults, the 2 + 7 triggers, FKs, SELECT-only RLS, `payment_transactions.stripe_connect_account_id`). CHECK constraints, index definitions and the `refund_guard_before` body cannot be reached read-only through PostgREST (workplan §2.2 U-1..U-3). Read-only SQL is given in workplan §2.3, and the first code step is gated on it |
| Workplan review | SA | ✅ Done 2026-10-14 (approved with conditions C-1..C-9; §14.3 fold-in verified). Result in the next row |
| Workplan review (result) | SA | ✅ Approved with conditions 2026-10-14 (workplan § SA Review Notes). SA-8 complete: U-1..U-3 run read-only against prod and **match** the migrations (CHECKs, indexes with the partial processor-id index, guard raises `P0001` in three cases and fires on INSERT and UPDATE OF amount/status/currency); T-0b done. §14.3 fold-in verified. Q-SA-0..Q-SA-10 ruled; Q-SA-6 (no `refund.failed` event on `IN_FLIGHT` in the automation block) and Q-SA-7 (`refundGroup` `maxTotal` counts an `IN_FLIGHT` leg) brought into slice 3 as minimal changes. All three `P0001` causes are acknowledged with an alert carrying the DB message; no branching on message text. Conditions C-1..C-9 folded in during implementation and checked at code review. Next: RM creates the branch (T-0a), then Dev slice 1 |
| Slice 1: refund carries the ledger row id (`refund_row_id`) | Dev | ✅ Implemented 2026-10-14 (uncommitted) |
| Slice 2: `refund.*` handling (F1–F5, A-1..A-8) | Dev | ✅ Implemented 2026-10-14 (uncommitted) |
| Slice 3: pending shown as pending (in scope, Q2 = a) | Dev | ✅ Implemented 2026-10-14 (uncommitted), incl. Q-SA-6 (no `refund.failed` event on `IN_FLIGHT`) and Q-SA-7 (`IN_FLIGHT` leg spends the `maxTotal` cap) |
| Implementation | Dev | ✅ Code complete 2026-10-14 on `fix/stripe-connect-refund-webhook`, uncommitted. SA conditions C-1..C-9 folded in. No migration, no DB write, no Stripe call. Affected tests green (24 suites, 837 tests, 107 snapshots); `tsc` shows no new error. Snapshots: 7a / X4 / X25 / X26 rewritten, R1–R4 added, the other 99 byte-identical. Per-slice file map, three incremental patches for RM, and deviations D-1..D-9: workplan §12. Next: SA code review |
| Code review | SA | 🔄 Done 2026-10-14: Fix Required. Result in the next row |
| Code review (result) | SA | 🔄 Fix Required 2026-10-14 (workplan § SA Review Notes, code review). Verified in the code: C-1..C-9 and Q-SA-6/7, D-1..D-9 accepted; tenant order, scoping, A-1, CAS, A-4, P0001 on both paths, platform `refund.*` routing and the `routerPlacement` guard are all sound; snapshots confirmed independently against `HEAD` (99 identical, 0 changed, 4 removed, 8 added); the three slice patches rebuild the tree exactly (23 files). **CR-1 (High)**: the A-3 table as written lets a `pending` event fill the Stripe id on a lost-reply `failed` row, after which the later `succeeded` is a no-op and the refunded money reads as `failed`. **A-3 amended by SA:** a `failed` / `canceled` row with no `processor_refund_id` takes an incoming `pending` (it has had no Stripe verdict, the same reasoning as SA-5). CR-2 (§5 misses the chat `MutateExecutor` caller; behaviour fine, add a doc row and a QA line), CR-3, CR-4 Low |
| Code review round 2 (CR delta only) | SA | ✅ Approved for QA 2026-10-14. CR-1 fixed as ruled: `failed\|false\|pending` and `canceled\|false\|pending` apply `pending`, and no other transition moved (the 40-case table differs from round 1 in those 2 entries only; SA ran the suite, 72/72). The new characterisation case covers failed (NULL id) → pending (id filled, one sync) → succeeded. CR-2 row in workplan §5 plus a QA line in §12.6. CR-3 has its own message, asserted. CR-4 title renamed. The snapshot file is byte-identical to round 1, because the new case asserts explicitly. SA rebuilt the tree from `47175fa5` with the 19:04 slice patches: 23/23 code files match blob for blob |
| QA | QA | ✅ PASS WITH NOTES 2026-10-14 (workplan § QA Testing Report). Every automatable criterion in §5 is mapped to a passing test. Targeted set: 72 suites, 1,620 tests, 107 snapshots, exit 0. Full suite from this worktree: 16 unrelated failures (11 quarantined, 5 Windows-local). `tsc`: 0 errors in touched files. QA added one source guard for C-3 (automation block: no `refund.failed` on `IN_FLIGHT`) in `refundService.test.ts`, which belongs in slice 3. No bugs. Low notes: stale failure reason after leaving `failed`; a transient `pending` until `refund.updated` arrives; a pre-existing `refundGroup` replay-cap gap. CR-2 chat refund checked by source review. G-3, G-4, the F2-b trigger effect and A-11 are owed post-deploy (checklist in the QA report) |
| User sees diff / approval | User + TL | ✅ 2026-10-14: the user saw the diff and approved it for commit and PR |
| Retrospective | TL | ✅ 2026-10-14: [STRIPE_CONNECT_REFUND_WEBHOOK_RETROSPECTIVE.md](/docs/retrospectives/STRIPE_CONNECT_REFUND_WEBHOOK_RETROSPECTIVE.md) (follow-ups FU-1..FU-8) |
| Commit + PR | RM | ⬜ |
| Post-deploy check (a test-mode dashboard refund lands in the books, G-3) | QA / user | ⬜ |
| Post-deploy check (A-11): the Stripe dashboard shows the Connect webhook endpoint subscribed to `refund.failed` (as well as `refund.created` / `refund.updated`). Belt and braces, not a blocker: `refund.updated` also reports failures | User | ⬜ |

---

## 1. Problem

Summarised from RCA §1–§3. The figures are the RCA's, read from the prod DB on 2026-10-14.

| What | Effect today |
|---|---|
| Refund ledger (`payment_refunds`) | Only refunds made through the app's own refund flow are recorded. All 42 rows have `source='app'`. The webhook has written 0. |
| Payment refund state (`payment_transactions.refund_status` / `refunded_amount`) | These are derived from the ledger by trigger, so for an outside refund they stay `none` / `0`. |
| Booking `payment_status` | Not updated for an outside refund. |
| Double-refund guard | The guard reads the ledger. It would let the owner refund the "remaining" amount again even though Stripe has already returned it. |
| Admin Finance page, client takings (slice 2a) | Takings net of refunds are **overstated** by every outside refund. Nothing shows the problem, because the event reads `completed`. |
| Refund state changes | A refund recorded as `pending` never moves to `succeeded` or `failed`. |
| Evidence | 31 of 31 app refunds have a `charge.refunded` event that changed nothing. 5 `charge.refunded` events match no refund row (Q1). `refund.created` / `refund.updated` events were received 30 / 24 times and dropped as unhandled. |
| Live mode | No live-mode refund is affected yet. |

---

## 2. User Stories

- As a **business owner**, I want a refund I make in the Stripe dashboard to show in my books, so my payments, bookings and totals match the money I actually hold.
- As a **business owner**, I want the app to stop offering a refund for money Stripe has already returned, so I cannot return the same money twice.
- As a **business owner**, I want a refund Stripe could not complete to show as failed, so I know the client has not been paid back.
- As a **platform admin**, I want client takings on the Finance page to be net of every refund, wherever it was made, so the figure can be trusted.
- As a **platform operator**, I want refund events from one business's Stripe account to be unable to change another business's records.

---

## 3. Functional Requirements

1. The webhook records a Stripe refund from `refund.created`, `refund.updated` and `refund.failed` on a connected account. It uses only the Refund object in the event (`id`, `amount`, `currency`, `status`, `charge`, `payment_intent`, `metadata`), with no extra Stripe call (RCA §4).
2. The refund is attached to the payment found by its payment intent, or failing that by its charge. This is the same lookup the current handler uses (`paymentTransactionRepository.findFirstByStripeReference`).
3. **F1, one row per refund.** When the event names a refund the app itself started, the webhook updates the app's existing ledger row and does not open a second one. The order of matching is:
   - (a) a row with the same Stripe refund id;
   - (b) failing that, the app's row named in the refund's metadata under the key **`refund_row_id`** (written by slice 1; SA-3);
   - (c) failing both, a new row with `source='webhook'`, `idempotency_key = 'stripe:<refund id>'`, `metadata = { origin, charge_id, payment_intent_id }` (never Stripe's own metadata), and `created_at` = the Stripe refund's `created` time (SA-11).

   **Metadata is untrusted (A-1).** A connected business can write any value on a refund it makes in its own dashboard. The row named in `refund_row_id` is used for (b) only if **all** of these hold:
   - the value is UUID-shaped (otherwise it is ignored and only its length is logged, as `ownedOrNull` does);
   - the row is read by `id` **and** `transaction_id` **and** `user_id` of the payment already proven in FR 7, so a foreign row is simply not found (`tenant-isolation-guard` Step 2, parent-scoped);
   - `source = 'app'` and `processor_type = 'stripe'`;
   - `amount_minor` equals the Stripe refund's `amount`, and the currency matches (case-insensitive);
   - `processor_refund_id` is NULL or equals the refund id.

   On any mismatch: log a warning (keys and ids only, never metadata values), **ignore the metadata and continue as (c)**. The refund is still real money on a payment this account owns, so it is recorded; `refund_guard_before` bounds the total. This stops a business folding a dashboard refund into one of its own manual refund rows, which would undercount.

   If the (c) insert hits a unique violation (`23505`), the handler re-runs the (a)/(b) lookup once and applies the update; if it still finds nothing, it throws so Stripe retries.
4. **Keeping the app's details.** Updating an app-made row must keep its `source` (`app`), `idempotency_key`, `reason`, `reason_note`, `initiated_by`, `metadata`, amounts, `user_id` and `created_at`. **No upsert is used anywhere in the new path** (SA-6). Updates go through a compare-and-set method whose patch type cannot carry those columns (A-2, FR 13).
5. **F2, statuses.** Stripe's statuses map as follows:

   | Stripe status | Ledger status |
   |---|---|
   | `succeeded` | `succeeded` |
   | `failed` | `failed` |
   | `canceled` | `canceled` |
   | `pending`, `requires_action` | `pending` |

   The ledger already allows all four values, so no schema change is needed for this. When a refund fails, `failure_code` = Stripe's `failure_reason` (and `failure_message` where Stripe provides one).
6. **No backwards moves; compare-and-set transitions (SA-5, A-3).** Stripe does not guarantee the order in which events arrive, and `refund.created` / `refund.updated` can be delivered concurrently. Transitions are decided by one pure function in `lib/payments/` (e.g. `nextLedgerRefundStatus(current, hasStripeId, incoming)`, not in the repository), exhaustively unit-tested, and applied **atomically** by a compare-and-set update (FR 13), never by read-then-write:

   | Incoming | Applies from | Otherwise |
   |---|---|---|
   | `pending` / `requires_action` | `pending` only | no-op |
   | `succeeded` | `pending`; also `failed` / `canceled` **only when the row has no `processor_refund_id`** (no Stripe verdict yet: the app's catch path wrote `failed` after a lost reply or timeout) | `succeeded`→`succeeded` may only fill the Stripe id |
   | `failed` | `pending` or `succeeded` | no-op |
   | `canceled` | `pending` or `succeeded` (`succeeded`→`canceled` logs a warning: Stripe documents `canceled` only from `requires_action`) | no-op |
   | `failed` ↔ `canceled` | — | no-op |

   A no-op still records a missing `processor_refund_id` when the row has none. When `failed` applies, `failure_code` = Stripe's `failure_reason`. `succeeded_at` = `event.created` of the event that moves the row **into** `succeeded`, and is never overwritten once set (SA-11). The update path never changes `created_at`.
7. **F3, tenant check (A-5).** A refund is recorded only if **both** hold:
   - `accountOwns(event.account, transaction.user_id, log)` passes. This is the route's existing owner proof: cached, and it throws on a read error, so a lookup failure means 500 and a retry.
   - When `transaction.stripe_connect_account_id` is non-null, it equals `event.account`. NULL is allowed (older payments recorded by other paths do not set it), but is logged at warn.

   If either fails: `log.error`, acknowledge, **no ledger write and no booking sync**. Ledger `user_id` / `transaction_id` / `invoice_id` are always copied from the proven payment row, never from the event. `stripe_connect_account_id` on a new row = `event.account`. Every ledger write comes after the `accountOwns` check. The metadata row (FR 3b) is read only within the proven payment (A-1). Follow the `tenant-isolation-guard` skill. `WEBHOOK_TRANSACTION_REFUND_COLUMNS` in `PaymentRepository` (and its `Pick<…>`) widens to include `stripe_connect_account_id`; the dispute column list is unchanged (A-7).
8. **F4, routing (SA-2).** No change to `dispatchBusinessOsEvent` or any resolver: both resolvers already return `not_business_os` for every `refund.*` type without a DB or Stripe read. Platform `refund.*` events (no `event.account`) are handled in the switch, in the shape `customer.subscription.created` already uses: `case 'refund.created': case 'refund.updated': case 'refund.failed': if (!isConnectEvent) { log.info(…, 'Platform refund event; not recorded in the client ledger'); break; }`, then the Connect handler. Connect `refund.*` events still skip the billing router, as every Connect event does today. No platform refund is written to the ledger; that is not a regression, because the platform `charge.refunded` path writes nothing today either. `charge.refund.updated` (a legacy duplicate of `refund.updated`) is **not** handled and stays "Unhandled event type".
9. **`charge.refunded` becomes a pure no-op (SA-4).** `case 'charge.refunded':` stays, with one `log.info` and a comment pointing to `refund.*`. It writes nothing and starts no re-sync. **`handleChargeRefunded` is deleted**, and its rows are removed from `MONEY_ROW_CALLS`.
10. **The booking follows (A-6).** `syncBookingsForTransactions([transaction.id], transaction.user_id)` is called after **any applied** status change, including `succeeded`→`failed` (which must put the booking back to `paid`). It is skipped on a no-op. The `propagate_refund_to_booking` trigger remains the authority. See §8.
11. **Failures are retried.** If the ledger write fails, or a compare-and-set update matches 0 rows (the race was lost), the handler throws, the claim is released, and Stripe retries; the retry re-reads. A refund for a payment the app never recorded is logged as an error and acknowledged, as `handleChargeRefunded` does today.
12. **The ledger's own refusal (SA-7).** A write refused by `refund_guard_before` surfaces as `P0001`. Only `P0001` is acknowledged: claim completed, 200, one `log.error({ alert: true, eventId, stripeRefundId, transactionId, pgCode }, …)`. Every other error throws, so the claim is released and Stripe retries (FR 11).
13. **Repository shape (SA-6, A-2).** In `lib/repositories/PaymentRefundRepository.ts`, **`upsertFromStripe` is removed** (with its unit tests and its `⟨unscoped-by-design⟩` header; it has no other caller) and replaced by three narrow methods. All three are scoped by `user_id` (the owner proven by `accountOwns`) **and** `transaction_id`, so no new `⟨unscoped-by-design⟩` exception is needed (rule 4 met literally):
    1. `findForStripeRefund(userId, transactionId, { processorRefundId, ledgerRowId? })`: the FR 3 (a)/(b) reads, returning only `id, status, processor_refund_id, source, processor_type, amount_minor, currency`.
    2. `insertFromStripe(row)`: a plain insert of a typed literal row as in FR 3 (c). No `ON CONFLICT` (the processor-id unique index is partial; SA-8).
    3. `applyStripeRefundState(userId, transactionId, id, expected: { status, processorRefundId: string | null }, patch)`: a compare-and-set `UPDATE … .eq(id).eq(transaction_id).eq(user_id).eq(status, expected.status)` plus `.is` / `.eq` on `processor_refund_id`, using `{ count: 'exact' }`. **No `.or()` and no `.select()`** (the known PostgREST update + `.or` + `.select` 42703 failure). `patch` is a closed type: `status`, `processor_refund_id`, `stripe_connect_account_id`, `succeeded_at`, `failure_code`, `failure_message`, `updated_at`. An extra key is a `tsc` error. Count 0 means the race was lost (FR 11).

    The row's `metadata.origin` type covers `refund.created` / `refund.updated` / `refund.failed`, and `status` covers all four values.
14. **The app's own post-reply writes do not overwrite the webhook (A-4, in scope regardless of Q2).** `RefundService.ts` :1087 (success) and :1117 (catch) are today unconditional `supabaseServer` updates; a webhook that lands first could be overwritten (worst case: a lost reply writes `failed` over a webhook `succeeded`, so the money has left and the books say it has not). Both writes move behind `applyStripeRefundState` with `expected = { status: 'pending', processorRefundId: null }`. If the count is 0, the webhook has already recorded Stripe's answer: log at info and keep the webhook's state. This moves those two direct writes behind the repository (rule 1, for the lines touched); the other direct queries in §11 stay flagged. `RefundService` tests that mock the `supabaseServer` chain for these two writes move to the repository mock.
15. **The metadata key is one constant (SA-3).** `refund_row_id` is defined once as an exported constant beside the code that writes it, and imported by the webhook (and optionally by `scripts/reconcile-stripe-payments.ts`, whose exact-match path already reads this key). The value is the ledger row's UUID only; nothing else goes into Stripe metadata.

---

## 4. Slices

Small, numbered and reusing existing infrastructure. **One PR containing slices 1 + 2 + 3 (slice 3 is in scope: Q2 = a), with each slice as a separate commit** so review can read them in order (SA-1). The app's refund call and the webhook ship in one Vercel deployment, so they go live together and no deploy-ordering step is owed. The only remaining window is a refund started on the old deployment whose `refund.*` reaches the new one in the same 1–2 s: test mode only today, and at worst one extra `webhook` row that QA can see (G-4).

| # | Title | Scope | Reuses | New, and why |
|---|---|---|---|---|
| 1 | Refund carries the ledger row id | `lib/payments/RefundService.ts`: the `stripe.refunds.create` call adds `metadata: { refund_row_id: ledgerRow.id }`, with the key as one exported constant (FR 15). Nothing else about the call changes. | The existing `refund()` flow and its ledger row | One metadata key, `refund_row_id` (SA-3). It is the only way to tie a Stripe refund to the app's row before the app learns the Stripe id (F1). It also switches on the reconciler script's existing exact-match path. |
| 2 | `refund.*` handling (F1–F5) | `route.ts`: new `refund.created` / `refund.updated` / `refund.failed` cases and a Connect handler (FR 1–3, 5–12); platform `refund.*` logged and skipped in the switch (FR 8). `charge.refunded` becomes a pure no-op and **`handleChargeRefunded` is deleted** (FR 9). `PaymentRefundRepository`: **`upsertFromStripe` removed and replaced by three narrow methods** (FR 13). `PaymentRepository`: `WEBHOOK_TRANSACTION_REFUND_COLUMNS` widened (FR 7). `lib/payments/`: the status-transition function (FR 6). `RefundService.ts` :1087 / :1117 post-reply writes made conditional (FR 14). Fixtures and guards updated (§6). | `paymentTransactionRepository.findFirstByStripeReference`; the route's `accountOwns`; the existing Connect routing (`event.account`, claim / complete / release); `syncBookingsForTransactions`; `fromMinorUnits`; the existing fixtures harness (`__tests__/fixtures/connect/`, characterisation snapshots) | **Three repository methods** (`findForStripeRefund`, `insertFromStripe`, `applyStripeRefundState`) in place of the removed upsert. Needed because an upsert overwrites `source` / `idempotency_key` / `metadata`, can move a status backwards under concurrency, and cannot reliably target the partial processor-id unique index (SA-6). **One pure function** for status transitions (FR 6). |
| 3 *(in scope, Q2 = a)* | Pending shown as pending | `RefundService.ts` ~1087: write Stripe's real status (`pending` stays `pending`, with no `succeeded_at`), using the F2 mapping and going through `applyStripeRefundState` as in FR 14. A `pending` / `requires_action` reply returns the existing `IN_FLIGHT` result, so callers fire no side effects (SA-9). The workplan lists every caller of `refund()` and how each renders `IN_FLIGHT`; if a caller shows it as an error, the minimal copy change is in scope. | The same file and line as slices 1 and 2 | Nothing new. |

**Expected migrations: none (SA-8).** In the migrations: the `payment_refunds` status CHECK allows `pending/succeeded/failed/canceled`; `source` allows `webhook`; `amount` / `amount_minor` `> 0` (Stripe refund amounts always are); later columns (`fee_returned`, `refund_fee`, `reason_note`) are nullable; RLS is SELECT-only and the webhook writes as the service role. This holds **only because no `ON CONFLICT (processor_refund_id)` is used** (FR 13). Keeping one would need a migration and is not approved.

**Workplan prerequisite: live-DB schema check (SA-8).** Before any code, the Dev runs the `business-os-schema-check` skill against the live DB (it can differ from the migrations) and records the result in the workplan:
- the CHECK constraints on `payment_refunds`;
- `pg_indexes` for both unique indexes on `payment_refunds` (partial or not);
- every trigger on `payment_refunds` and `payment_transactions`, and the current `refund_guard_before` body (which error code it raises);
- NOT NULL columns without defaults on `payment_refunds`;
- that `payment_transactions.stripe_connect_account_id` exists.

Any difference from the above is a stop-and-report to SA, not a silent adjustment.

---

## 5. Acceptance Criteria

Each criterion has a testable condition. "Test" means a Jest test in the existing webhook harness or repository tests, unless it says QA manual.

### Slice 1

- [ ] **S1-1** A Stripe refund created by `RefundService.refund()` carries the app's ledger row id under `refund_row_id`, and nothing else in Stripe metadata. *Test:* the `refunds.create` params include `metadata.refund_row_id === ledgerRow.id`, the key comes from the exported constant, and `metadata` has no other key.
- [ ] **S1-2** Nothing else about the call changes: same target, amount, reason, idempotency key and account options. *Test:* the existing RefundService tests pass unchanged, apart from the added metadata.
- [ ] **S1-3** Manual and returned-outside-processor refunds still make no Stripe call. *Test:* existing tests still pass.

### Slice 2: F1, race with the app's own write

- [ ] **F1-a** `refund.created` arrives **before** the app has written the Stripe id onto its row. The app's row is updated and **no second row** is created. *Test:* fixture whose `metadata.refund_row_id` names a pending app row with `processor_refund_id = null` and matching amount and currency. Afterwards there is exactly 1 row for that transaction, with the Stripe id set.
- [ ] **F1-b** The event arrives **after** the app wrote the Stripe id. The row is matched on the Stripe id and still only 1 row exists. *Test:* row pre-seeded with the id. The row count is unchanged.
- [ ] **F1-c** An app row that is matched keeps `source='app'`, its `idempotency_key`, `reason`, `reason_note` and `initiated_by`. *Test:* assert those columns are unchanged in the recorded write.
- [ ] **F1-d** A refund with no metadata key (made in the dashboard) creates one row with `source='webhook'`, `idempotency_key = stripe:<refund id>`, and `metadata` holding only `origin`, `charge_id`, `payment_intent_id` (no Stripe metadata). Redelivering the same event creates no second row. *Test:* deliver the fixture twice and get 1 row; assert the inserted row literal.
- [ ] **F1-e (A-1)** Untrusted metadata is ignored and the event is recorded as F1-d (a new `webhook` row) when the named row: is not UUID-shaped; belongs to a **different payment** or a different `user_id`; has `source` other than `app` or `processor_type` other than `stripe`; has an `amount_minor` different from the Stripe refund's `amount`; has a different currency (compared case-insensitively); or already has a different Stripe id. *Test:* one case per condition. Each leaves the named row unchanged, inserts one `webhook` row, and logs a warning that contains keys and ids only (assert the metadata value does not appear in the log; for a non-UUID value only its length is logged).
- [ ] **F1-f** The (b) lookup is scoped: `findForStripeRefund` is called with the proven payment's `user_id` and `transaction_id`. *Test:* repository unit test asserts the `id`, `transaction_id` and `user_id` filters.
- [ ] **F1-g** An insert that hits `23505` re-runs the lookup once and applies the update; if the lookup still finds nothing, the handler throws (500, claim released). *Test:* two cases.

### Slice 2: F2, statuses

- [ ] **F2-a** `succeeded`, `failed`, `canceled`, `pending` and `requires_action` map as in FR 5. *Test:* one case per status.
- [ ] **F2-b** `refund.failed` on a row that was `pending` or `succeeded` sets it to `failed`. The payment's `refunded_amount` drops back by that amount, through the existing trigger. *Test:* row status assertion. The trigger effect is checked by QA manually on a test DB.
- [ ] **F2-c** A late `refund.created` (`pending`) arriving after `refund.updated` (`succeeded`) leaves the row `succeeded` (FR 6). *Test:* deliver both out of order.
- [ ] **F2-d (A-3)** The transition function implements every row of the FR 6 table. *Test:* exhaustive unit test over every (current status × has Stripe id × incoming status) combination, including: `failed`/`canceled` with **no** Stripe id → `succeeded` applies; `failed`/`canceled` **with** a Stripe id → `succeeded` is a no-op; `failed`↔`canceled` is a no-op; a no-op still fills a missing `processor_refund_id`; `succeeded`→`canceled` applies and logs a warning.
- [ ] **F2-e (A-2)** Transitions are compare-and-set. `applyStripeRefundState` filters on `id`, `transaction_id`, `user_id`, the expected `status` and the expected `processor_refund_id` (`.is(null)` or `.eq`), uses `{ count: 'exact' }`, and uses no `.or()` and no `.select()`. A count of 0 makes the handler throw (500, claim released). *Test:* repository unit test asserts the filters and options; route case asserts the throw on count 0.
- [ ] **F2-f (A-2)** The update patch cannot carry `source`, `idempotency_key`, `reason`, `reason_note`, `initiated_by`, `metadata`, `amount*`, `user_id` or `created_at`. *Test:* a type-level test (`// @ts-expect-error` on an extra key) compiled by `tsc`.

### Slice 2: SA-7, ledger refusal

- [ ] **R-1** When the ledger write fails with `P0001` (`refund_guard_before`), the event is acknowledged (200, claim completed) and exactly one `log.error` is written with `alert: true`, `eventId`, `stripeRefundId`, `transactionId` and `pgCode`. *Test:* mocked `P0001`.
- [ ] **R-2** Any other DB error code throws (500, claim released). *Test:* mocked non-`P0001` error.

### Slice 2: SA-11, refund timing

- [ ] **T-1** A new `webhook` row has `created_at` = the Stripe refund's `created` time, not the insert time. *Test:* assert the inserted row literal.
- [ ] **T-2** Updating an existing row (app or webhook) never changes `created_at`. *Test:* the patch type has no `created_at` (F2-f) and the route case asserts it is absent.
- [ ] **T-3** `succeeded_at` = `event.created` of the event that moves the row **into** `succeeded`. A later event never overwrites it. *Test:* pending → succeeded fixture sets `succeeded_at` from the second event; a redelivered succeeded event leaves it unchanged.

### Slice 2: A-4, the app's own post-reply writes

- [ ] **A4-1** `RefundService`'s success write (:1087) and catch write (:1117) go through `applyStripeRefundState` with `expected = { status: 'pending', processorRefundId: null }`; no direct `supabaseServer` update remains on those lines. *Test:* RefundService unit cases on the repository mock.
- [ ] **A4-2** When the webhook has already recorded the refund (count 0), the app's write changes nothing, logs at info, and the webhook's state stands. In particular, a lost Stripe reply does **not** turn a webhook-recorded `succeeded` into `failed`. *Test:* repository mock returns count 0 for the catch path; assert no further write and an info log.

### Slice 2: F3, tenant check

- [ ] **F3-a (A-5)** The refund is recorded only after `accountOwns(event.account, transaction.user_id, log)` passes. If it fails, nothing is written to `payment_refunds`, no booking is synced, an error is logged, and the event is acknowledged. *Test:* a fixture with a foreign account produces no repository write and no booking sync.
- [ ] **F3-c (A-5)** When the payment's `stripe_connect_account_id` is non-null and differs from `event.account`, the same no-write / no-sync / error / acknowledge outcome applies. When it is NULL, the refund is recorded and a warning is logged. *Test:* two cases.
- [ ] **F3-d (A-5)** An `accountOwns` read error throws (500, claim released). *Test:* mocked read failure.
- [ ] **F3-e (A-5)** The ledger row's `user_id`, `transaction_id` and `invoice_id` come from the proven payment row and never from the event; a new row's `stripe_connect_account_id` = `event.account`. *Test:* assert the inserted row literal.
- [ ] **F3-f (A-7)** `findFirstByStripeReference` selects `stripe_connect_account_id`. *Test:* covered by the F3-c cases, which depend on the column being read; the `Pick<…>` type widens with it (`tsc`). No new test file (A-8).
- [ ] **F3-b** The `tenant-isolation-guard` skill is followed, and its checklist outcome is recorded in the workplan. The refund handler is listed in `OWNER_PROVED` (owner `transaction.user_id`), not in the FU-3 exemption (§6).

### Slice 2: F4, routing

- [ ] **F4-a (SA-2)** A platform `refund.created` / `refund.updated` / `refund.failed` (no `event.account`) reaches no boost or plan handler, writes no ledger row, and is completed. *Test:* (i) a dispatcher unit case asserting `DEFAULT_RESOLVERS` return `not_business_os` for all three types and that the boost lookup port is **not called**; (ii) a route case asserting no money-row repository call, an info log, and a completed claim.
- [ ] **F4-b** A Connect `refund.*` never calls `dispatchBusinessOsEvent`. *Test:* the existing "router only inside `if (!isConnectEvent)`" guard stays green; no new assertion is needed.
- [ ] **F4-c** `charge.refund.updated` is not handled and still logs "Unhandled event type". `dispatchBusinessOsEvent` and the resolvers are unchanged. *Test:* existing behaviour; diff review.

### Slice 2: F5, fixtures

- [ ] **F5-a** The `charge-refunded.json` fixture is replaced with a real `2025-10-29.clover` payload with **no** `refunds` list. Test 7a now asserts that `charge.refunded` writes nothing and logs once at info. `handleChargeRefunded` no longer exists in `route.ts` (SA-4). *Test:* updated characterisation snapshot; `MONEY_ROW_CALLS` has no `handleChargeRefunded` entry.
- [ ] **F5-b** `refund.created`, `refund.updated` (succeeded), `refund.updated` (pending → succeeded) and `refund.failed` fixtures are added in the real `2025-10-29.clover` shape. Each has a characterisation case.
- [ ] **F5-c (A-9)** Fixtures are shaped from a real Stripe **test-mode** event on the Connect platform (the events already arrive, RCA §2), or from Stripe's Refund object reference at the pinned `2025-10-29.clover`. No hand-invented fields. The workplan states the source.

### Slice 2: general

- [ ] **G-1 (A-6)** After **any applied** status change (including `succeeded`→`failed`), `syncBookingsForTransactions([transaction.id], transaction.user_id)` is called. After a no-op transition it is **not** called. *Test:* harness call assertions for an applied `succeeded`, an applied `succeeded`→`failed`, and a no-op (late `pending`).
- [ ] **G-2** A failed ledger write throws, the route answers 500 and the claim is released. *Test:* existing pattern, new case.
- [ ] **G-3** QA manual (test mode, post-deploy): refund a test payment **from the Stripe dashboard**. The payment shows as refunded, the booking follows (§8), the app no longer offers that amount for refund, and the Finance page takings drop by the refund.
- [ ] **G-4** QA manual: an app refund still produces exactly one ledger row, with `source='app'`, and Stripe shows `refund_row_id` in that refund's metadata.
- [ ] **G-5** `upsertFromStripe` no longer exists, and no new-path code uses `upsert` or `ON CONFLICT` on `payment_refunds` (SA-6). *Test:* `PaymentRefundRepository.test.ts` asserts no upsert; grep in code review.

### Slice 3 (in scope: Q2 = a, answered 2026-10-14)

- [ ] **S3-1** A Stripe reply with status `pending` leaves the app's row `pending` with `succeeded_at` null. `succeeded` sets `succeeded` with `succeeded_at`. `failed` / `canceled` map per F2. *Test:* RefundService unit cases.
- [ ] **S3-2 (SA-9)** A `pending` / `requires_action` Stripe reply returns the existing `IN_FLIGHT` result (`ok: false`, "still being processed"). Callers fire no side effects: no client email, no booking write, no CRM activity, no `succeeded` audit. *Test:* RefundService unit case. The workplan lists every caller of `refund()` and how each renders `IN_FLIGHT`; a caller that shows it as an error gets the minimal copy change.

---

## 6. Guards Touched

From RCA §4, with SA's A-8. Each must be green and updated in slice 2. **All of this stays inside existing test files and the existing Jest job: no new CI gate and no added CI time** (A-8).

| Guard | Change |
|---|---|
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` | `MONEY_ROW_CALLS` loses `handleChargeRefunded` and gains the new refund handler with its exact calls (`findFirstByStripeReference: 1` plus the refund repository methods). The refund handler moves **out** of the FU-3 exemption in "every owner-checked money-row write…" and **into** `OWNER_PROVED` with owner `transaction.user_id`; every `insertFromStripe` / `applyStripeRefundState` call must come after `accountOwns` (A-5). The guard's comment "the dispute and refund writes…" is updated to say dispute only. The "router only inside `if (!isConnectEvent)`" assertion stays green (F4-b) |
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` + snapshots | 7a asserts no write (F5-a), plus the new `refund.*` cases and the F1 / F2 / F3 / R / T cases from §5 |
| `lib/repositories/__tests__/PaymentRefundRepository.test.ts` | Rewritten for the three methods (one unit test per method). Asserts scoping (`user_id` + `transaction_id` filters present), compare-and-set filters present, no `.or`, no upsert. The `upsertFromStripe` tests are removed with the method |
| `lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts` | **No change expected.** It pins a migration that does not list `payment_refunds` (SELECT-only since 20260828b), and its second half only forbids user-credential writes, which this change does not add. Run it to confirm it is green |
| `lib/business-os/billing/__tests__/webhookDispatcher.test.ts` | One new case (F4-a i): `DEFAULT_RESOLVERS` return `not_business_os` for all three `refund.*` types without calling the boost lookup port. Inside the existing test file |

---

## 7. Non-Functional Requirements

- **Performance:** no extra Stripe API call inside the webhook (the reason RCA §4 ranks this approach first). At most one extra DB lookup per event (the F1 match), plus the cached `accountOwns` read. No added CI time (A-8).
- **Security:** F3 tenant check via `accountOwns` plus the stored Connect account (FR 7, A-5); all repository methods scoped by `user_id` + `transaction_id` (FR 13); service-role use documented in the code (CLAUDE.md Security Rules). Metadata from a connected account is **untrusted**: it is used only after every A-1 check passes, and its values are never logged (FR 3, F1-e). No internal error details reach Stripe's response outside development, as today.
- **Logging:** Pino through the route's per-request `log`, with event id, refund id and transaction id. No `console.*`. Metadata values are never logged (keys, ids and lengths only). A `P0001` refusal logs once with `alert: true` (FR 12).
- **Idempotency and concurrency:** redelivery, out-of-order delivery, concurrent delivery and the race with the app's own write all end with exactly one row per Stripe refund, and no status ever moves backwards. Transitions are compare-and-set, not read-then-write (FR 6, FR 13, FR 14).
- **Accessibility:** not applicable (no UI change).

---

## 8. Booking Behaviour (as-built)

As read from `syncBookingsForTransactions` / `syncBookingPaymentState` (`lib/payments/syncBookingPaymentState.ts`) and the `propagate_refund_to_booking` trigger (`supabase/migrations/20260903_propagate_refund_to_booking.sql`). Both sum every settled payment on the booking.

| Refund outcome | Booking `payment_status` | Booking `status` (appointment) |
|---|---|---|
| Full refund (refunded ≥ collected) | → `refunded` | **Unchanged.** The appointment is not cancelled or removed. |
| Partial refund | stays / becomes `paid` | Unchanged, **except** that a booking still `pending` is set to `confirmed` by the TypeScript helper. The trigger does not do this. |
| Refund later fails | goes back to `paid` once the payment's refunded total drops | Unchanged |
| Payment not linked to a booking | — | — |

So a refund made in the Stripe dashboard never cancels an appointment. Once this fix is live, these effects will start to happen for dashboard refunds, which until now changed nothing. They are the same effects an in-app refund already has, because the same helper and trigger run. Two may surprise an owner, and are raised as Q3.

---

## 9. Business Questions

Plain terms, each with a recommendation. **All three were answered by the user via TL on 2026-10-14**; the option text is kept as the user saw it.

- [x] **Q1: Five old test refunds that never reached the books.** (raised by: BA | status: ✅ answered by the user 2026-10-14: **(a) leave them as they are**)
  Five refunds in **test mode** (3 Sep ×3, 4 Sep, 28 Sep 2026) were most likely made in the Stripe dashboard and never recorded. This fix does not pick them up by itself, because Stripe will not resend those old events. Options:
  - (a) Leave them. They are test data and no real customer is affected.
  - (b) Record them in the books. This need not be by hand: the existing payment reconciliation script can do it, but only when run with the Stripe key of the Connect platform account, which is not the key on our machines today.

  **BA recommendation: (a), leave them.** Test money only. Recording them takes time (or the platform key) and teaches nothing the post-deploy test (G-3) does not.

- [x] **Q2: A refund Stripe hasn't finished yet shows as completed.** (raised by: BA, re-worded per SA §14.4 | status: ✅ answered by the user 2026-10-14: **(a) fix now, without the confirm-time email follow-up.** Slice 3 is in scope. The follow-up is deferred (§12))
  When the app refunds a client and Stripe answers "still processing", the app today marks the refund completed straight away. It counts as money returned in the totals and on the payment. For some payment methods Stripe can take days to finish. Options:
  - (a) **Fix now.** A refund Stripe reports as still processing shows as "processing", not "completed", until Stripe confirms. **But** the client then gets no refund email and no "refund issued" entry on their timeline for that refund, unless a follow-up is built that sends them when Stripe confirms. Today they are sent at the moment the owner clicks refund.
  - (b) **Defer.** The books still correct themselves when Stripe's update arrives: if the refund then fails, the money is put back on the payment. But until that update arrives, the refund shows as completed, and the client gets the email straight away as today.
  - (c) **(a) plus the confirm-time email follow-up.** The complete option: the refund shows as "processing" until Stripe confirms, and the client's email and timeline entry are sent when Stripe confirms. The follow-up is a separate small piece of work after this fix.

  **BA recommendation: (c).** Showing money as returned when it has not moved is the thing worth fixing, but not at the cost of the client never hearing about their refund. If the follow-up cannot be scheduled soon, (b) is the safer interim choice, because the books already correct themselves under (b).

- [x] **Q3: What a Stripe-dashboard refund does to a booking.** (raised by: BA | status: ✅ answered by the user 2026-10-14: **(a) keep the as-built booking behaviour**)
  After this fix, a refund made in the Stripe dashboard will affect bookings the same way an in-app refund does. The same applies to refunds made by agent workflows through the Stripe plugin: from now on they also reach the books and the booking.
  - A **full** refund marks the booking's payment as "refunded" but **keeps the appointment** on the calendar. It is not cancelled.
  - A **partial** refund on a booking that is still awaiting confirmation (with money already paid against it) **confirms** that booking.

  Options:
  - (a) Keep this. Refunds behave the same wherever they are made, and the owner cancels an appointment separately.
  - (b) Treat dashboard refunds differently.

  **BA recommendation: (a), keep it.** A refund is not a cancellation (an owner may refund a no-show fee and keep the slot). Behaving differently depending on where the refund was made would be more surprising. If option (b) is wanted, it is a separate requirement, not part of this fix.

---

## 10. Questions for SA

Technical forks, not for the user. **All eleven were ruled by SA on 2026-10-14; the full rulings are in [§14.2](#142-rulings-on-10)** and are folded into §3–§7. BA's original suggestion is kept for the record.

| # | Question | BA suggestion | SA ruling (summary; see §14.2) |
|---|---|---|---|
| SA-1 | Single PR for slices 1+2 (+3), or split PRs? Deploy order? | Split only if slice 1 deploys first and is live before slice 2. Otherwise one PR. | ✅ Ruled: one PR, slices as separate commits; no ordering step (§4) |
| SA-2 | Where F4 sits: deny in `dispatchBusinessOsEvent`, or let it pass and ignore in the switch for non-Connect events | SA's call; F4-a must hold either way | ✅ Ruled: in the switch; no dispatcher or resolver change; `charge.refund.updated` not handled (FR 8) |
| SA-3 | The metadata key name for the ledger row id (e.g. `neuronforge_refund_id`, mirroring `neuronforge_invoice_id`) | Mirror the existing `neuronforge_*` convention | ✅ Ruled: `refund_row_id`, matching the reconciler script; one exported constant (FR 15) |
| SA-4 | `charge.refunded`: pure no-op, or a re-sync trigger? | No-op. Re-sync would need a Stripe call (the RCA's second-ranked alternative). | ✅ Ruled: pure no-op; `handleChargeRefunded` deleted (FR 9) |
| SA-5 | The status ordering rule (FR 6): confirm which transitions are allowed | As in FR 6 | ✅ Ruled: approved with the NULL-Stripe-id exception and compare-and-set (FR 6) |
| SA-6 | Shape of the new repository method that attaches a Stripe refund to an app row by id, and whether `upsertFromStripe` must stop overwriting `source` / `idempotency_key` / `metadata` on conflict (FR 4) | One narrow update method, scoped by row id + transaction id | ✅ Ruled: no upsert; `upsertFromStripe` removed; three scoped methods (FR 13) |
| SA-7 | `refund_guard_before` refuses a webhook write: retry (500) or acknowledge with an alert? | Acknowledge with an error log. A retry cannot succeed and only fills the retry queue. | ✅ Ruled: acknowledge `P0001` only, with an alert log; all else retries (FR 12) |
| SA-8 | Does "no migration expected" hold? | Yes: the status and source CHECKs already allow the needed values | ✅ Ruled: holds, given no `ON CONFLICT`; live-DB check owed as a workplan prerequisite (§4) |
| SA-9 | Slice 3: what the refund route returns to the owner for a `pending` Stripe refund, and whether callers' side effects (booking update, client email, audit) wait for confirmation | Treat as `IN_FLIGHT`-like: no "refunded" email until confirmed | ✅ Ruled: existing `IN_FLIGHT`, no side effects; consequence carried into Q2 (S3-2, §9) |
| SA-10 | Stripe idempotency: adding `metadata` changes the `refunds.create` params. Can a pre-deploy request be replayed against Stripe with the same key after deploy? | Believed unreachable, because the DB `idempotency_key` 23505 replay returns before Stripe is called. SA confirms. | ✅ Ruled: confirmed unreachable; no action |
| SA-11 | Ledger `created_at` for a webhook row is the insert time, not Stripe's refund time. The Finance page reads refunds by `created_at`. Use Stripe's `created` time? | Coordinate with the finance refund-timing scoping (§13) | ✅ Ruled: insert uses Stripe's `created`; updates never change `created_at`; `succeeded_at` from the event that moves into `succeeded` (FR 3c, FR 6, T-1..T-3). Finance page column choice stays with the finance scoping |

---

## 11. Flags Recorded (not fixed here)

| Flag | Where | Note |
|---|---|---|
| Direct `supabaseServer` write in a service (CLAUDE.md rule 1) | `lib/payments/RefundService.ts` | **Partly resolved here (A-4):** the two post-reply writes at ~1087 (success) and ~1117 (catch) move behind `applyStripeRefundState` in slice 2 (FR 14), and slice 3's edit at ~1087 uses the same method. **Still flagged, not fixed:** the file's other direct queries on `payment_refunds`, `payment_transactions`, `payment_invoices` and `business_profiles`, at about lines 258, 416, 439, 450, 700, 848, 907, 993 and 1001. `lib/payments/syncBookingPaymentState.ts` (called by the webhook) also queries `supabaseServer` directly. |
| `console.*` count (logging rule) | `app/api/stripe/webhook/route.ts`: **0**. `lib/payments/RefundService.ts`: **0**. | Both files were read in full on 2026-10-14. Both use Pino (`createLogger`) throughout, so no conversion is needed. |
| `tenant-isolation-guard` applies | F3 | The current handler has no account check (FU-3). **Resolved here (A-2, A-5):** the new handler proves the owner with `accountOwns`, and all three repository methods are scoped by `user_id` + `transaction_id`. The `⟨unscoped-by-design⟩` header goes with `upsertFromStripe`; no new exception is added. |
| Reconciler script uses the same unsafe upsert (A-10) | `scripts/reconcile-stripe-payments.ts` :320 | It uses `upsert(…, { onConflict: 'processor_refund_id' })` against the **partial** unique index (which Postgres very likely cannot infer, 42P10), and on conflict would overwrite an app row's `source`. Recorded here, **not fixed** in this change. The script's `console.*` use is outside `lib/` / `app/` and the script is not touched. |
| Dependency of the Finance page | [BUSINESS_OS_FINANCE_HEALTH_REFUND_TIMING_SCOPING.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REFUND_TIMING_SCOPING.md), branch `feature/bos-finance-health-4`, worktree `C:\Users\Barak\My Projects\AgentsPilot\neuronforge-finance-health` | The Finance page's overstated client takings (slice 2a) depend on this fix. That scoping is where this RCA was first suspected. |

---

## 12. Out of Scope / Future Roadmap

- Recording the 5 historical test-mode refunds (Q1: user chose to leave them, 2026-10-14).
- **Deferred (Q2 = a, user decision 2026-10-14): the confirm-time client email and timeline entry.** When Stripe confirms a refund that was "processing", send the client's refund email and write the "refund issued" timeline entry. Until this is built, a refund Stripe reports as processing gets neither (S3-2).
- Platform-level refunds (boost / plan payments) in the refund ledger.
- A client-timeline entry ("refund issued") and a client email for refunds made outside the app, The in-app flow writes a CRM activity and the webhook path does not. Candidate follow-up; it can share work with the deferred confirm-time email above.
- An audit-trail entry for webhook-recorded refunds: **out of scope, ruled by SA (A-12).** The ledger row is the record, there is no actor, and `refund.completed` already reaches `business_events` through the existing `payment_transactions` trigger (20261006).
- Handling the legacy `charge.refund.updated` event (SA-2: it duplicates `refund.updated`).
- Fixing the reconciler script's upsert (§11, A-10).
- Whether the Finance page reads refunds by `succeeded_at` instead of `created_at` (SA-11; belongs to the finance refund-timing scoping).
- A periodic reconciliation against Stripe's refund list (the RCA's alternative approach).
- Moving `RefundService` / `syncBookingPaymentState` DB access behind repositories (§11).
- Any change to how refunds affect the appointment itself (Q3: user chose to keep the as-built behaviour, 2026-10-14).

---

## 13. Notes on Integration Points

| Area | Touched how |
|---|---|
| `app/api/stripe/webhook/route.ts` | New `refund.*` cases (platform: log and skip; Connect: the new handler, after `accountOwns`). `case 'charge.refunded'` becomes a pure no-op and `handleChargeRefunded` (:494) is **deleted**. Dispatch at :2484. |
| `lib/business-os/billing/webhookDispatcher.ts` and resolvers | **Unchanged** (SA-2). One dispatcher unit case added (F4-a). |
| `lib/payments/RefundService.ts` | Slice 1: `metadata: { refund_row_id }` on `refunds.create` (~1070), key as an exported constant. Slice 2: the post-reply writes at ~1087 and ~1117 go through `applyStripeRefundState` (A-4, FR 14). Slice 3: Stripe's real status at ~1087 and `IN_FLIGHT` for pending. |
| `lib/payments/` (new pure function) | Status-transition function, e.g. `nextLedgerRefundStatus` (A-3, FR 6). |
| `lib/repositories/PaymentRefundRepository.ts` | `upsertFromStripe` and its `⟨unscoped-by-design⟩` header **removed**. Three scoped methods added: `findForStripeRefund`, `insertFromStripe`, `applyStripeRefundState` (A-2, FR 13). Types widened. |
| `lib/repositories/PaymentRepository.ts` | `findFirstByStripeReference` reused. `WEBHOOK_TRANSACTION_REFUND_COLUMNS` and its `Pick<…>` widened to add `stripe_connect_account_id` (A-7); the dispute list is unchanged. |
| `scripts/reconcile-stripe-payments.ts` | Not changed. Its `metadata.refund_row_id` exact-match path starts working once slice 1 ships. Its upsert is flagged (§11, A-10). It needs the Connect platform's key (Q1). |
| `lib/server/stripe-plugin-executor.ts` | Not changed. Its `refunds.create` on the connected account is an "outside the app" refund, so those refunds now reach the books and the booking (Q3). |
| `lib/payments/syncBookingPaymentState.ts` | Reused, unchanged |
| DB: `payment_refunds`, triggers `refund_guard_before`, `recompute_transaction_refund_state`, `propagate_refund_to_invoice`, `propagate_refund_to_booking` | Unchanged. They drive payment, invoice and booking state from the ledger. |
| `processed_webhook_events` | Unchanged claim / complete / release |
| Admin Finance page (`BusinessOsFinanceReadRepository` R-f / R-f′) | No code change here. Its figures become correct once outside refunds are recorded. See SA-11 for the timing question. |
| Stripe dashboard config | `refund.created` / `refund.updated` already reach the endpoint (RCA §2), so no dashboard change is expected. Post-deploy, confirm the Connect endpoint is also subscribed to `refund.failed` (A-11, §0) |
| Live DB | Schema check owed before the workplan's code steps (SA-8, §4) |

---

## 14. SA Review

**Reviewed by SA — 2026-10-14** (requirement review, read against `main` @ `3b300f58`)
**Status:** 🔄 Changes requested. These are fold-in amendments, not a redesign. The approach (record from `refund.*`, match the app's row, no Stripe call in the webhook) is approved.

> **Fold-in note (BA, 2026-10-14):** amendments A-1..A-12 and rulings SA-1..SA-11 were folded into §0, §3–§7 and §9–§13 on 2026-10-14, and Q2 was re-worded per §14.4. This section is otherwise kept as SA wrote it.

### 14.1 What was checked

| Area | Read | Result |
|---|---|---|
| Route | `app/api/stripe/webhook/route.ts`: `handleChargeRefunded` (:494), Connect split + router (:2346–2384), switch (:2386–2545), `accountOwns` / `accountOwner` (:1089–1121) | RCA confirmed. `accountOwns` is the route's established owner proof and is the right tool for F3 |
| Router | `lib/business-os/billing/webhookDispatcher.ts`, `planInvoiceResolver.ts`, `lib/business-os/boost/boostWebhookResolver.ts`, `boostChargeEvents.ts` | Both resolvers return `not_business_os` for every `refund.*` type with **no DB or Stripe read** (plan: `default: NOT_OURS`; boost: only `charge.*` and `checkout.session.*`). Platform `charge.refunded` for a boost purchase is taken by the boost flow **before** the switch, so the switch change in FR 9 cannot affect boost refunds |
| Repository | `lib/repositories/PaymentRefundRepository.ts`, `PaymentRepository.ts` (`findFirstByStripeReference`, `WEBHOOK_TRANSACTION_REFUND_COLUMNS = 'id, user_id, invoice_id, currency'`) | The column list has no `stripe_connect_account_id`; must widen (§14.3 A-7) |
| Schema (migrations) | `20260828b_payment_refund_ledger.sql`, `20260828c_payment_account_context.sql`, `20260904_processor_fees.sql`, `20260929_refund_reason_note.sql`, `20261004_payment_tables_write_lockdown.sql`, `20261006_business_event_triggers.sql` | Status CHECK has all four values; source CHECK has `webhook`; new columns since are nullable. **`idx_payment_refunds_processor_id` is a PARTIAL unique index** (`WHERE processor_refund_id IS NOT NULL`), see SA-6 |
| App write path | `lib/payments/RefundService.ts` :839–975 (ledger open, 23505 replay, P0001 guard), :1068–1125 (Stripe call, post-reply writes) | Two unconditional post-reply writes race the new webhook (§14.2 SA-5 / A-4) |
| Existing consumer of the metadata key | `scripts/reconcile-stripe-payments.ts` :442 | Already matches on `metadata.refund_row_id`, a key the app has never written (see SA-3) |
| Guards | `routerPlacement.guard.test.ts` (`MONEY_ROW_CALLS`, `OWNER_PROVED`), `connectPath.characterisation.test.ts` 7a, `PaymentRefundRepository.test.ts`, `paymentTablesWriteLockdownMigration.test.ts` | All updatable inside existing files and the existing Jest job. **No new CI gate, no added CI time** |
| Skills | `tenant-isolation-guard` | Applies: service role, and a caller-controlled id (the refund metadata). Ruled in F3 / F1-e below |
| Logging | Route and `RefundService.ts` | 0 `console.*` in either (BA's count confirmed by grep). `scripts/reconcile-stripe-payments.ts` uses `console.*`, but it is a CLI script outside `lib/`/`app/` and is not touched |

### 14.2 Rulings on §10

| # | Ruling |
|---|---|
| **SA-1** | **One PR containing slices 1 + 2 (+ 3 if Q2 = now).** The app's refund call and the webhook ship in one Vercel deployment, so they go live together and no ordering step is owed. The only remaining window is a refund started on the *old* deployment whose `refund.*` reaches the *new* one in the same 1–2 s. That is test mode only today, and at worst gives one extra `webhook` row that QA can see (G-4). No migration, so there is no SQL-apply ordering either. Slices stay as separate commits inside the PR, so review can read them in order. |
| **SA-2** | **No change to `dispatchBusinessOsEvent` or any resolver.** Platform `refund.*` already returns `not_business_os` from both resolvers without a read. A `deny` would need a new `DenyReason` in a billing module and would log a warn for every platform refund (every boost refund raises one). Handle it in the switch, using the shape `customer.subscription.created` already uses: `case 'refund.created': case 'refund.updated': case 'refund.failed': if (!isConnectEvent) { log.info(…, 'Platform refund event; not recorded in the client ledger'); break; }` then the Connect handler. F4-a test: (i) a dispatcher unit case asserting `DEFAULT_RESOLVERS` return `not_business_os` for all three types, and that the boost lookup port is **not called**; (ii) a route case asserting no money-row repository call and a completed claim. F4-b: the existing "router only inside `if (!isConnectEvent)`" guard already covers it; no new assertion needed beyond keeping it green. `charge.refund.updated` (24 received) is a legacy duplicate of `refund.updated`. **Do not handle it**; it stays "Unhandled event type". |
| **SA-3** | **Key = `refund_row_id`.** Not `neuronforge_*`. `scripts/reconcile-stripe-payments.ts:442` already matches refunds on `metadata.refund_row_id`, and its comment says "the metadata path is exact and covers everything issued after that change shipped". The app side of that change never shipped (`git log -S refund_row_id` shows only the script). Using this name turns the reconciler's dead exact-match path on at no cost; a new name would leave two names for one fact. Define it once as an exported constant beside the code that writes it, imported by the webhook (and optionally the script). The value is the ledger row's UUID only; nothing else goes into Stripe metadata. |
| **SA-4** | **Pure no-op.** Keep `case 'charge.refunded':` with one `log.info` and a comment pointing to `refund.*`. **Delete `handleChargeRefunded`** (otherwise it is dead code), and remove its rows from `MONEY_ROW_CALLS`. No re-sync: it would need a Stripe call per event and credentials, which RCA §4 ranks second, and `refund.*` already carries the facts. |
| **SA-5** | **FR 6 approved with one addition and one precision.** The transition table is in §14.3 A-3. Addition: a row whose `processor_refund_id` is still NULL has **no Stripe verdict yet**. Its `failed` was written by the app's catch path (lost reply or timeout), so the first Stripe event may set it to anything, `succeeded` included. Without this, the Overview's promise ("app refunds whose Stripe reply was lost") is not met: the row would stay `failed` while the money has left. Precision: transitions are enforced **atomically** by a compare-and-set update (A-2), not by read-then-write, because `refund.created` and `refund.updated` can be delivered concurrently. |
| **SA-6** | **No upsert anywhere in the new path; three narrow repository methods** (A-2). Reasons: (1) an upsert on conflict overwrites `source` / `idempotency_key` / `metadata` (FR 4); (2) a concurrent upsert can move a status backwards, which FR 6 forbids; (3) `idx_payment_refunds_processor_id` is a **partial** unique index, and `ON CONFLICT (processor_refund_id)` without the index predicate very likely cannot infer it (Postgres 42P10). The as-built `upsertFromStripe` has never executed in prod (0 webhook rows), so it may never have worked. **`upsertFromStripe` is removed**, along with its unit tests and its `⟨unscoped-by-design⟩` header; it has no other caller. The reconciler script carries the same upsert. That is flagged in §11 terms, not fixed here (A-10). |
| **SA-7** | **Acknowledge.** A ledger write refused by `refund_guard_before` surfaces as `P0001`, the code `RefundService` already maps to `EXCEEDS_REMAINING` (:966). Only **`P0001`** is acknowledged: claim completed, 200, one `log.error({ alert: true, eventId, stripeRefundId, transactionId, pgCode }, …)`. Every other error throws, so the claim is released and Stripe retries (G-2). Rationale: the guard's inputs do not change between retries, so a retry cannot succeed and only fills the retry queue for 3 days. The alert is the signal that the ledger and Stripe disagree (most likely a manual refund *and* a Stripe refund for the same money). |
| **SA-8** | **"No migration" holds, on two conditions.** (1) In the migrations: status CHECK allows `pending/succeeded/failed/canceled`; source CHECK allows `webhook`; `amount`/`amount_minor` `> 0` (Stripe refund amounts are always > 0); later columns (`fee_returned`, `refund_fee`, `reason_note`) are nullable; RLS is SELECT-only and the webhook writes as the service role. (2) It holds **only because SA-6 removes the dependency on the partial index**. If the Dev wanted to keep an `ON CONFLICT (processor_refund_id)`, that would need a migration and is not approved. **Live-DB check owed in the workplan** (`business-os-schema-check` skill; the live DB can differ from migrations): CHECK constraints on `payment_refunds`; `pg_indexes` for both unique indexes (partial or not); every trigger on `payment_refunds` and `payment_transactions`, and the current `refund_guard_before` body (which error code it raises); NOT NULL columns without defaults on `payment_refunds`; and that `payment_transactions.stripe_connect_account_id` exists. Any difference is a stop-and-report, not a silent adjustment. |
| **SA-9** | Only if Q2 = now. A `pending` / `requires_action` Stripe reply returns the **existing `IN_FLIGHT`** result (`ok: false`, "still being processed"), so callers fire **no** side effects: no client email, no booking write, no CRM activity, no `succeeded` audit. That matches `IN_FLIGHT`'s meaning at :936. The workplan must list every caller of `refund()` and show how each renders `IN_FLIGHT`. If a caller shows it as an error, the minimal copy change is in scope. **Consequence for Q2:** nothing sends the email or the timeline entry when Stripe later confirms, because the webhook path writes neither (§12). See §14.4. |
| **SA-10** | **Confirmed unreachable.** Every Stripe call with key K follows a fresh ledger insert carrying idempotency key K in the same process. A replay hits `23505` (:906) and returns before Stripe is called, and the SDK's own network retries happen inside one process on one code version. A request already in flight across the deploy completes on the old code. A "retry" after a failure needs a new `clientRequestId`, so it gets a new key. No action needed. |
| **SA-11** | **On the insert path (F1 c) set `created_at` = the Stripe refund's `created`.** On the attach / update paths, never change `created_at`. That makes `created_at` mean "when the refund was issued" for both sources: an app row is created at the moment the owner issues it. It also keeps a refund retried across midnight or a month end in the period it was actually made. `succeeded_at` = `event.created` of the event that moves the row **into** `succeeded`, and is never overwritten once set. Today's code uses `refund.created`, which is wrong for a pending→succeeded change. Whether the Finance page should read `succeeded_at` instead of `created_at` (as `ledgerService.ts:174` already does for exports) belongs to the finance refund-timing scoping (§11), **not** this fix. |

### 14.3 Amendments BA folds into §3–§6

| # | Where | Amendment |
|---|---|---|
| A-1 | FR 3 (b), F1-e, §7 | **Metadata is untrusted** (a connected business writes any value on a refund it makes in its own dashboard). The named row is used only if **all** of these hold: the value is UUID-shaped (otherwise ignored, and only its length is logged, like `ownedOrNull`); it is read by `id` **and** `transaction_id` **and** `user_id` of the payment already proven in F3, so a foreign row is simply not found (skill Step 2, parent-scoped); `source = 'app'`; `processor_type = 'stripe'`; `amount_minor` equals the Stripe refund's `amount`; the currency matches (case-insensitive); and `processor_refund_id` is NULL or equals the refund id. On any mismatch, warn (keys and ids only, never metadata values), **ignore the metadata, and continue as F1 (c)**. The refund is still real money on a payment this account owns, so it is recorded; `refund_guard_before` bounds the total. This stops a business from folding a dashboard refund into one of its own *manual* refund rows, which would undercount. |
| A-2 | FR 4, FR 13, §4 slice 2 "New", §6 | **Repository shape** (`PaymentRefundRepository`). All three methods are scoped by `user_id` = the owner proven by `accountOwns` **and** `transaction_id`, so there is no new `⟨unscoped-by-design⟩` exception (rule 4 met literally). (1) `findForStripeRefund(userId, transactionId, { processorRefundId, ledgerRowId? })`: the F1 (a)/(b) reads, returning only `id, status, processor_refund_id, source, processor_type, amount_minor, currency`. (2) `insertFromStripe(row)`: a plain insert of a typed literal row (`source: 'webhook'`, `idempotency_key: 'stripe:<id>'`, `metadata: { origin, charge_id, payment_intent_id }`, never Stripe's own metadata), with `created_at` per SA-11. On `23505`, the caller re-runs (1) once and applies (3); if it still finds nothing, it throws (retry). (3) `applyStripeRefundState(userId, transactionId, id, expected: { status, processorRefundId: string \| null }, patch)`: a compare-and-set `UPDATE … .eq(id).eq(transaction_id).eq(user_id).eq(status, expected.status)` plus `.is`/`.eq` on `processor_refund_id`, using `{ count: 'exact' }`. **No `.or()`, no `.select()`** (the known PostgREST update + `.or` + `.select` 42703 failure). `patch` is a closed type: `status`, `processor_refund_id`, `stripe_connect_account_id`, `succeeded_at`, `failure_code`, `failure_message`, `updated_at`. It **cannot** carry `source`, `idempotency_key`, `reason`, `reason_note`, `initiated_by`, `metadata`, `amount*`, `user_id`, or `created_at` (an extra key is a `tsc` error, as SA C-3 is today). Count 0 means the race was lost: the caller throws so the retry re-reads. Each method gets its unit test (rule: one per repository method). |
| A-3 | FR 6 | **Status transitions** (one pure function, e.g. `nextLedgerRefundStatus(current, hasStripeId, incoming)`, exhaustively unit-tested; in `lib/payments/`, not in the repository). Incoming `pending`/`requires_action` → applies only from `pending` (otherwise a no-op). `succeeded` → from `pending`; from `failed`/`canceled` **only when the row has no `processor_refund_id`** (SA-5); `succeeded`→`succeeded` may only fill the Stripe id. `failed` → from `pending` or `succeeded`. `canceled` → from `pending` or `succeeded` (Stripe documents `canceled` only from `requires_action`, so `succeeded`→`canceled` gets a warn log). `failed`↔`canceled` → no-op. A no-op still records a missing `processor_refund_id` when the row has none. When `failed` applies, `failure_code` = Stripe's `failure_reason`. |
| A-4 | New FR (slice 2), §4 slice 2 scope, §13 | **The app's own post-reply writes must not overwrite the webhook.** `RefundService.ts` :1087 (success) and :1117 (catch) are unconditional `supabaseServer` updates. With slice 2 live, a webhook that lands first can be overwritten. The worst case: a lost reply makes the catch path write `failed` over a webhook `succeeded`, so the money has left and the books say it has not. Both writes move behind `applyStripeRefundState` with `expected = { status: 'pending', processorRefundId: null }`. If the count is 0, the webhook has already spoken, so log at info and keep the webhook's state. This is in scope regardless of Q2. It also closes the window BA describes under Q2. It moves two of `RefundService`'s direct writes behind the repository (rule 1, for the lines this change touches); the other direct queries listed in §11 stay flagged. `RefundService` tests that mock the `supabaseServer` chain for these two writes move to the repository mock. |
| A-5 | FR 7, F3-a, §5 | **Tenant check = `accountOwns(connectAccountId, transaction.user_id, log)`** (the route's existing owner proof, cached, with throw-on-read-error, so a lookup failure means 500 and a retry) **AND**, when `transaction.stripe_connect_account_id` is non-null, it must equal `event.account`. NULL is allowed (older payments recorded by other paths do not set it), but log it at warn. Either failure: `log.error`, acknowledge, **no ledger write, no booking sync**. Ledger `user_id` / `transaction_id` / `invoice_id` are always copied from the proven payment row, never from the event. `stripe_connect_account_id` on a new row = `event.account`. Guard: move the refund handler **out** of the FU-3 exemption in `routerPlacement.guard.test.ts` "every owner-checked money-row write…" and into `OWNER_PROVED` with owner `transaction.user_id`. Every `insertFromStripe` / `applyStripeRefundState` call must come after that `accountOwns`. Update the guard's comment ("the dispute and refund writes…") to say dispute only. |
| A-6 | FR 10, G-1 | Call `syncBookingsForTransactions([transaction.id], transaction.user_id)` after **any applied** status change (including `succeeded`→`failed`, which must put the booking back to `paid`). Skip it on a no-op. |
| A-7 | §13 `PaymentRepository` row | Widen `WEBHOOK_TRANSACTION_REFUND_COLUMNS` to add `stripe_connect_account_id`, and its `Pick<…>`. The dispute list is unchanged. |
| A-8 | §6 guards | `routerPlacement.guard.test.ts`: `MONEY_ROW_CALLS` loses `handleChargeRefunded` and gains the new handler with its exact calls (`findFirstByStripeReference: 1` plus the refund repository methods), and A-5's `OWNER_PROVED` entry. `connectPath.characterisation.test.ts`: 7a asserts no write (F5-a), plus the new `refund.*` cases and the F1/F2/F3 cases from §5. `PaymentRefundRepository.test.ts`: rewritten for the three methods (scoping asserted: `user_id` + `transaction_id` filters present, compare-and-set filters present, no `.or`, no upsert). `paymentTablesWriteLockdownMigration.test.ts`: **no change expected**. It pins a migration that does not list `payment_refunds` (that table has been SELECT-only since 20260828b), and the second half only forbids user-credential writes, which this change does not add. Run it to confirm it is green. All of this stays inside existing test files and the existing Jest job: **no new CI gate and no added CI time.** |
| A-9 | F5-c | Real `refund.*` payload shapes: take them from a Stripe **test-mode** event on the Connect platform (the events already arrive, RCA §2) or from Stripe's Refund object reference at the pinned `2025-10-29.clover`. State the source in the workplan. No hand-invented fields. |
| A-10 | §11 (new flag row) | `scripts/reconcile-stripe-payments.ts` :320 uses the same `upsert(…, { onConflict: 'processor_refund_id' })` against the partial index, and would overwrite an app row's `source`. Recorded here, not fixed. |
| A-11 | Post-deploy row (§0) | Add: confirm in the Stripe dashboard that the Connect endpoint is subscribed to `refund.failed` (the RCA counted `refund.created` / `refund.updated` but not `refund.failed`). `refund.updated` also reports failures, so this is belt and braces, not a blocker. |
| A-12 | §12 | Audit-trail entry for webhook refunds: **stays out of scope**. The ledger row is the record, there is no actor, and `refund.completed` already reaches `business_events` through the existing `payment_transactions` trigger (20261006). |

### 14.4 Effect on the business questions

- **Q1:** unchanged. One fact for option (b): `scripts/reconcile-stripe-payments.ts` can do it, so it would not have to be by hand, but only with the Connect platform's key (RCA §5 says the local key is not that key).
- **Q2: needs re-wording before the user sees it.** Two facts change the trade-off. (1) A-4 closes the "app overwrites Stripe's processing answer" window regardless of the answer, so that argument for (a) goes away. (2) Under (a) (SA-9), a refund that Stripe reports as "processing" gets **no client email and no client-timeline entry, ever**, unless the §12 follow-up (send them when Stripe confirms) is built. Under (b), slice 2 already corrects the books when Stripe's update arrives, and a failed refund is put back. The residual harm of (b) is that "processing" money reads as returned until Stripe confirms. SA has no technical preference. The option text must state the email consequence of (a), and offer "(a) together with the confirm-time email follow-up" as the complete version.
- **Q3:** unchanged. One addition for the option text: refunds that agent workflows make through the Stripe plugin (`lib/server/stripe-plugin-executor.ts`, `refunds.create` on the connected account) are also "outside the app", and from now on reach the books and the booking in the same way.

### Approval

[ ] Requirement approved. Approval follows once BA has folded in §14.3 and re-worded Q2. SA verifies the fold-in at workplan review; no second requirement pass is needed.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created | BA draft from the RCA: slices 1–3, F1–F5 as acceptance criteria plus an ordering rule (FR 6), 4 guards, business questions Q1–Q3, SA questions SA-1..SA-11, flags recorded |
| 2026-10-14 | SA requirement review | §14 added: SA-1..SA-11 ruled (one PR; F4 in the switch, no dispatcher change; key `refund_row_id`, which matches the reconciler; `charge.refunded` a pure no-op; compare-and-set status transitions with a NULL-Stripe-id exception; no upsert, three scoped repository methods; P0001 acknowledged; no migration, with a live-DB check owed; `IN_FLIGHT` for pending; SA-10 confirmed; `created_at` = Stripe time on insert). Amendments A-1..A-12 for BA to fold in, including RefundService post-reply writes made conditional (A-4) and the tenant check via `accountOwns` (A-5). Q2 to be re-worded. Status: changes requested |
| 2026-10-14 | BA fold-in of SA amendments | A-1..A-12 and SA-1..SA-11 folded in: FR 3 (key `refund_row_id`, untrusted-metadata checks, insert row shape, 23505 re-read), FR 4/13 (no upsert; `upsertFromStripe` replaced by three scoped methods), FR 6 (transition table, compare-and-set), FR 7 (`accountOwns` + stored account check), FR 8 (platform `refund.*` handled in the switch), FR 9 (`charge.refunded` no-op, `handleChargeRefunded` deleted), FR 10 (booking sync on any applied change), FR 12 (`P0001` acknowledged), new FR 14 (app post-reply writes conditional) and FR 15 (one key constant); §4 one PR with slices as separate commits, no-migration conditions, live-DB schema check as a workplan prerequisite; §5 new criteria F1-e..g, F2-d..f, R-1/R-2, T-1..T-3, A4-1/A4-2, F3-c..f, F4-c, G-5; §6 guard changes, no new CI gate; §7 updated; §9 Q1 reconciler option, Q2 re-worded in business terms with option (c), Q3 agent-workflow refunds; §10 marked ruled; §11 A-10 reconciler flag, partial resolution of the rule-1 and tenant flags; §12 A-12 audit out of scope; §13 updated; §0 post-deploy `refund.failed` subscription check (A-11). Status: SA-approved with amendments folded; next = user answers Q1–Q3, then Dev workplan |
| 2026-10-14 | User business decisions recorded | Answered by the user via TL: Q1 (a) leave the five test refunds; Q2 (a) fix now **without** the confirm-time email follow-up, so slice 3 is in scope (§0, §4, §5) and the follow-up (client email and timeline entry when Stripe confirms a processing refund) is deferred in §12; Q3 (a) keep the as-built booking behaviour. Status: business decisions taken; next = Dev workplan, with the SA-8 live-DB schema check as its prerequisite |
| 2026-10-14 | Dev workplan written | §0 updated: workplan linked; SA-8 read-only result recorded (match on everything verifiable; U-1..U-3 unverifiable read-only, first code step gated on them); next = SA workplan review |
| 2026-10-14 | Implementation | §0 updated: "Workplan review" row marked done; slices 1–3 marked implemented; "Implementation" row added (uncommitted, tests green, no new `tsc` error; details in workplan §12). Next: SA code review |
