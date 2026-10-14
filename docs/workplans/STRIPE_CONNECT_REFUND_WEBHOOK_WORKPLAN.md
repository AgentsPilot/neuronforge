# Workplan: Stripe Connect Refunds Reach the Books (refund webhook fix)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [STRIPE_CONNECT_REFUND_WEBHOOK_REQUIREMENT.md](/docs/requirements/STRIPE_CONNECT_REFUND_WEBHOOK_REQUIREMENT.md) (SA-approved with amendments A-1..A-12 folded; Q1–Q3 answered 2026-10-14: Q1 (a) leave the five, Q2 (a) slice 3 in scope without the confirm-time email, Q3 (a) keep the booking behaviour)
**Diagnosis:** [STRIPE_CONNECT_CHARGE_REFUNDED_WEBHOOK_RCA.md](/docs/investigations/STRIPE_CONNECT_CHARGE_REFUNDED_WEBHOOK_RCA.md)
**Branch:** `fix/stripe-connect-refund-webhook` (created by RM from `origin/main` @ `47175fa5`, no upstream yet; worktree `distracted-sammet-74b018`. Dev confirmed it with `git branch --show-current` before the first edit)
**Planned against:** `main` @ `3b300f58` (worktree HEAD). `origin/main` is at `99fb09a0`; the two differ only in AI-price-review files, none of which this plan touches
**Date:** 2026-10-14
**Status:** SA code review round 2: Code Approved for QA (CR-1..CR-4 fixed; see SA Review Notes). Slices 1–3 implemented, all uncommitted; see §12. Next: QA

## Overview

Refunds made outside the app (Stripe dashboard, Stripe itself, agent workflows through the Stripe plugin, or app refunds whose Stripe reply was lost) never reach the refund ledger. The handler for `charge.refunded` reads a list Stripe stopped sending in 2022. This plan records refunds from `refund.created`, `refund.updated` and `refund.failed` instead. It ships as **one PR with three commits**: (1) the app's Stripe refund carries its ledger row id in metadata; (2) the webhook handles `refund.*` events through three narrow, user-scoped repository methods and a compare-and-set status rule, and the app's own post-reply writes stop overwriting the webhook; (3) a refund Stripe reports as still processing stays `pending` and the caller is told `IN_FLIGHT`. **No migration.** The live-DB check owed before any code (SA-8) is in §2. Everything that could be checked read-only matched the migrations. Three catalogue items could not be reached read-only, and the plan gates T-1 on them (§2.4).

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. SA-8 Live-DB Schema Check (prerequisite)](#2-sa-8-live-db-schema-check-prerequisite)
- [3. Implementation Approach](#3-implementation-approach)
- [4. Tenant-Isolation Checklist (F3-b)](#4-tenant-isolation-checklist-f3-b)
- [5. Callers of `refund()` and how each renders `IN_FLIGHT` (S3-2)](#5-callers-of-refund-and-how-each-renders-in_flight-s3-2)
- [6. Fixture Source (A-9 / F5-c)](#6-fixture-source-a-9--f5-c)
- [7. Files to Create / Modify](#7-files-to-create--modify)
- [8. Test Plan](#8-test-plan)
- [9. Task List](#9-task-list)
- [10. Open Technical Questions for SA](#10-open-technical-questions-for-sa)
- [11. Flags Recorded (not fixed here)](#11-flags-recorded-not-fixed-here)
- [12. Implementation Notes (Dev, 2026-10-14)](#12-implementation-notes-dev-2026-10-14)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

Line numbers are at `3b300f58`.

| Area | Where | Today |
|---|---|---|
| Dead handler | `app/api/stripe/webhook/route.ts:494-578` `handleChargeRefunded` | Loops over `charge.refunds?.data ?? []` (:518), which is always empty, so `paymentRefundRepository.upsertFromStripe` (:536) is never reached. It ignores the lookup's `error` (:503). It has no `accountOwns` check (FU-3) |
| Dispatch | `route.ts:2481-2486` `case 'charge.refunded'` | Called for Connect **and** platform events. Platform boost refunds are taken by the billing router before the switch (:2359-2384), so they never get here |
| Router placement | `route.ts:2346-2384` | `dispatchBusinessOsEvent` runs only inside `if (!isConnectEvent)`. This plan does not change it (FR 8, SA-2) |
| Owner proof | `route.ts:1089-1121` `accountOwns` / `accountOwner` | Cached. Throws on a read error (FU-5), so a lookup failure means 500 and a retry. Refusal pattern used elsewhere: `log.error(...)` then `return` (for example :660, :2089) |
| Payment lookup | `lib/repositories/PaymentRepository.ts:788-801` `findFirstByStripeReference` | ⟨unscoped-by-design⟩. Uses the payment intent **when the event has one**, otherwise the charge id. It does not fall back from intent to charge (see §10 Q-SA-1) |
| Payment columns | `PaymentRepository.ts:161` `WEBHOOK_TRANSACTION_REFUND_COLUMNS = 'id, user_id, invoice_id, currency'`; row type `:191` `Pick<PaymentTransaction, …>` | `PaymentTransaction` (:8-42) has **no** `stripe_connect_account_id` field, so the widened row type is written as `Pick<…> & { stripe_connect_account_id: string \| null }` and cannot use `Pick` alone |
| Refund repository | `lib/repositories/PaymentRefundRepository.ts` | One method, `upsertFromStripe` (⟨unscoped-by-design⟩, `onConflict: 'processor_refund_id'` against a **partial** unique index). Its only caller is `handleChargeRefunded` |
| App refund | `lib/payments/RefundService.ts:695` `refund()` | Ledger row inserted `pending` first (:848-902); 23505 replay (:906-962, returns `IN_FLIGHT` for a pending original, :936-944); `P0001`/`23514` → `EXCEEDS_REMAINING` (:966); `stripe.refunds.create` (:1070-1085); **unconditional** success write (:1087-1095: `failed` if Stripe says failed, otherwise `succeeded`, `succeeded_at = now`); **unconditional** catch write (:1116-1124: `failed`) |
| Bookings | `lib/payments/syncBookingPaymentState.ts:194` `syncBookingsForTransactions` | Reused unchanged. The `propagate_refund_to_booking` trigger is the authority (§8 of the requirement) |
| Logging | route and `RefundService.ts` | 0 `console.*` in either (requirement §11, SA-confirmed). No conversion needed |

**Phase named (rule 8 / V6 principle, by analogy):** this is a webhook/payments fix, not V6. The root cause is the webhook's choice of event (`charge.refunded`), so the fix is in the webhook's event handling and the ledger repository, not in a downstream reconciler.

---

## 2. SA-8 Live-DB Schema Check (prerequisite)

**Measured:** 2026-10-14 ~14:08 UTC, against `jgccgkyhpwirgknnceoh.supabase.co` (prod).
**Tools, all read-only:**
1. `npm run schema:check` from the main checkout (`main @ e49a4719`, working tree dirty with another session's unrelated edits). Result: `FAIL — 25 of 663 selects cannot run`. **None of the 25 touch `payment_refunds` or `payment_transactions`**; all are pre-existing and unrelated (`user_credits`, `user_api_keys`, `agents.workflow`, …). Every scanned select on the two tables in scope runs.
2. A scratch Node script (session scratchpad; not in the repo) that made only: the read-only RPC `purge_schema_introspect()` (SECURITY DEFINER, no DML/DDL, migration `20260915a`; returns columns, FKs, triggers with `pg_get_triggerdef`, policies); `GET /rest/v1/` (PostgREST OpenAPI: defaults and required columns); two zero-row selects; and `HEAD … Prefer: count=exact` counts. No writes, no DDL, no migrations.
3. A probe of `Accept-Profile: pg_catalog` / `information_schema`. Both returned `406 PGRST106 "The schema must be one of the following: public, graphql_public"`. **The catalogue is not reachable through PostgREST**, and no RPC exposes `pg_constraint` CHECK definitions, `pg_indexes` or function bodies (the OpenAPI document lists 114 RPCs; the only introspection one is `purge_schema_introspect`).

### 2.1 Verified, and matching the migrations

Compared with `20260828b_payment_refund_ledger.sql`, `20260828c_payment_account_context.sql`, `20260828d_invoice_refund_state.sql`, `20260903_propagate_refund_to_booking.sql`, `20260903b_refund_reason_derived.sql`, `20260904_processor_fees.sql`, `20260916_business_data_ownership.sql`, `20260920_pipeline_transitions.sql`, `20260929_refund_reason_note.sql`, `20261006_business_event_triggers.sql`, `20260722_create_payment_tables.sql`.

| Item | Live | Migrations | Match |
|---|---|---|---|
| `payment_refunds` columns (24) | `id, user_id, transaction_id, invoice_id, amount, amount_minor, currency, status, reason, processor_type, processor_refund_id, stripe_connect_account_id, idempotency_key, source, initiated_by, failure_code, failure_message, metadata, created_at, updated_at, succeeded_at, fee_returned, refund_fee, reason_note` | 20260828b (21) + 20260904 (`fee_returned`, `refund_fee`) + 20260929 (`reason_note`) | ✅ |
| NOT NULL | `id, user_id, transaction_id, amount, amount_minor, currency, status, processor_type, idempotency_key, source, metadata, created_at, updated_at` | Same 13 | ✅ |
| Defaults (OpenAPI) | `id gen_random_uuid()`, `status 'pending'`, `processor_type 'stripe'`, `created_at now()`, `updated_at now()`. `metadata`: **no default reported** (PostgREST omits jsonb defaults in OpenAPI) | Same, plus `metadata DEFAULT '{}'` | ✅ (metadata default unconfirmed but moot: the insert always sets `metadata`) |
| **NOT NULL without default** | `user_id, transaction_id, amount, amount_minor, currency, idempotency_key, source` (+ `metadata` if its default were missing) | Same | ✅. `insertFromStripe` sets every one of them |
| Later columns nullable | `fee_returned`, `refund_fee`, `reason_note` nullable | Nullable | ✅ |
| Triggers on `payment_refunds` (2) | `refund_guard_before_trigger BEFORE INSERT OR UPDATE OF amount, status, currency … EXECUTE FUNCTION refund_guard_before()`; `recompute_transaction_refund_state_trigger AFTER INSERT OR DELETE OR UPDATE … recompute_transaction_refund_state()` | Same (20260828b) | ✅ |
| Triggers on `payment_transactions` (7) | `log_payment_activity_trigger`, `promote_contact_on_payment_trigger` (WHEN succeeded, amount > 0, contact set), `propagate_refund_to_booking_trigger`, `propagate_refund_to_invoice_trigger` (both `AFTER INSERT OR UPDATE OF refunded_amount, refund_status, status`), `trg_transaction_events` (`AFTER INSERT OR UPDATE`), `update_invoice_on_payment_trigger`, `update_payment_transactions_updated_at_trigger` | Same seven: 20260722 (3), 20260828d, 20260903, 20260920, 20261006 | ✅ |
| FKs on `payment_refunds` | `user_id → auth.users CASCADE`, `transaction_id → payment_transactions RESTRICT`, `invoice_id → payment_invoices SET NULL`, `payment_refunds_business_fk → business_profiles CASCADE` | 20260828b + 20260916 | ✅ |
| RLS policies on `payment_refunds` | Exactly one: `payment_refunds_select_own SELECT USING (auth.uid() = user_id)` | Same, SELECT-only | ✅ |
| `payment_transactions.stripe_connect_account_id` | Exists, `text`, nullable | 20260828c | ✅ |
| Data snapshot (counts only) | 42 rows: 42 `succeeded`, 42 `source='app'`, 0 `webhook`, 11 with NULL `processor_refund_id`, 0 with `metadata.refund_row_id` | Matches RCA §2 | ✅ |

### 2.2 Not verifiable read-only through the available channels

PostgREST does not expose `pg_catalog`, and no existing read-only RPC returns these. They are **unverified, not mismatched**:

| # | Item | Expected from 20260828b | Why it matters to this plan |
|---|---|---|---|
| U-1 | CHECK constraints on `payment_refunds` | `amount > 0`, `amount_minor > 0`, `status IN ('pending','succeeded','failed','canceled')`, `source IN ('app','webhook','reconciler','manual')` | `failed` / `canceled` and `source='webhook'` writes depend on it |
| U-2 | Index definitions | `idx_payment_refunds_idempotency` UNIQUE on `idempotency_key`; `idx_payment_refunds_processor_id` UNIQUE on `processor_refund_id` **WHERE processor_refund_id IS NOT NULL**; plus `_transaction`, `_user`, `_pending` | F1-g relies on a `23505` from either unique index |
| U-3 | `refund_guard_before` body | `RAISE EXCEPTION` with no `USING ERRCODE`, so SQLSTATE `P0001` | FR 12 acknowledges `P0001` only |

Indirect evidence for U-3: `RefundService.ts:966` already maps `P0001` to `EXCEEDS_REMAINING`. That is the code's belief, not a measurement.

**Closed 2026-10-14 (recorded by SA).** The main session ran the §2.3 selects read-only against prod (`jgccgkyhpwirgknnceoh`). All three match 20260828b:

| # | Live result | Match |
|---|---|---|
| U-1 | Four CHECKs: `amount > 0`; `amount_minor > 0`; `source IN ('app','webhook','reconciler','manual')`; `status IN ('pending','succeeded','failed','canceled')` | ✅ |
| U-2 | `idx_payment_refunds_idempotency` UNIQUE (`idempotency_key`); `idx_payment_refunds_processor_id` UNIQUE (`processor_refund_id`) **WHERE `processor_refund_id IS NOT NULL`** (partial, which confirms SA-6); `idx_payment_refunds_pending` (`created_at`) WHERE `status='pending'`; `idx_payment_refunds_transaction`; `idx_payment_refunds_user` (`user_id, created_at DESC`); the pkey | ✅ |
| U-3 | `refund_guard_before`: `SELECT … FOR UPDATE` on `payment_transactions`. It runs `RAISE EXCEPTION` with **no `ERRCODE`** (so SQLSTATE `P0001`) in **three** cases: (i) the transaction does not exist; (ii) the currency differs from the transaction's (case-insensitive); (iii) `committed + NEW.amount > tx_amount`, where `committed` sums `status IN ('pending','succeeded') AND id <> NEW.id`. It sets `NEW.updated_at := NOW()`. The trigger fires on `INSERT` **and** on `UPDATE OF amount, status, currency` | ✅ |

Two facts from U-3 that the handler must respect (SA ruling in SA Review Notes, C-1 and C-6): `P0001` covers all three cases, not only an over-refund; and the guard adds `NEW.amount` whatever `NEW.status` is, so a `failed`/`canceled` insert or a status update can also raise it.

### 2.3 Read-only SQL to close U-1..U-3 (user pastes it in the Supabase SQL editor)

Selects only. The text avoids the word that breaks the editor (see memory note on the SQL editor).

```sql
-- U-1: CHECK constraints on payment_refunds
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.payment_refunds'::regclass and contype = 'c'
order by conname;

-- U-2: every index on payment_refunds (shows UNIQUE and any WHERE predicate)
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'payment_refunds'
order by indexname;

-- U-3: the guard (and the recompute function, for the record)
select p.proname, pg_get_functiondef(p.oid) as body
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('refund_guard_before', 'recompute_transaction_refund_state');
```

**Pass condition:** U-1 shows the four CHECKs above; U-2 shows both unique indexes, with the processor-id one partial; U-3's guard raises without an `ERRCODE` (or with `P0001`) and still filters `status IN ('pending','succeeded') AND id <> NEW.id`. **Any difference is a stop-and-report to SA** (requirement §4), and the plan below is not adjusted to fit around it.

### 2.4 Verdict

**Match** on everything verifiable (§2.1). **No mismatch found.** U-1..U-3 are open. T-1 (first code step) is gated on them: either the user runs §2.3, or SA rules that the migration bodies plus §2.1 are enough. See §10 Q-SA-0.

**Final verdict (SA, 2026-10-14): Match.** U-1..U-3 were closed by the §2.3 selects (§2.2), and all three match the migrations. SA-8 is complete, T-0b is done and T-1 is unblocked.

---

## 3. Implementation Approach

### 3.1 Slice 1: the refund carries its ledger row id

- New leaf module `lib/payments/stripeRefundLedger.ts`, holding only `export const REFUND_ROW_ID_METADATA_KEY = 'refund_row_id' as const;` in slice 1. It is a leaf (no imports), so the webhook route can import it without pulling `RefundService`'s Stripe and Supabase imports into the route's test harness. It sits beside `RefundService.ts` in `lib/payments/`. SA to confirm this reads FR 15 ("beside the code that writes it") correctly: §10 Q-SA-2.
- `RefundService.ts` :1070: add `metadata: { [REFUND_ROW_ID_METADATA_KEY]: ledgerRow.id }` to the `refunds.create` params. Nothing else about the call changes.

### 3.2 Slice 2: `refund.*` handling

**Pure logic** (`lib/payments/stripeRefundLedger.ts`, no I/O, unit-tested exhaustively):
- `mapStripeRefundStatus(status: string | null): LedgerRefundStatus | null`. Maps `succeeded→succeeded`, `failed→failed`, `canceled→canceled`, `pending|requires_action→pending`. Returns **null for `null` or an unknown value**. The SDK types `Refund.status` as `string | null`, so the handler needs a defined answer for null (§10 Q-SA-3).
- `nextLedgerRefundStatus(current, hasStripeId, incoming)`, which returns `{ kind: 'apply', status, warn? } | { kind: 'noop' }`, exactly per FR 6 / A-3:
  - `pending`/`requires_action` is a no-op from `pending`, and **applies `pending` from `failed`/`canceled` only when `!hasStripeId`** (SA CR-1 at code review, amending A-3: a lost-reply row must not keep `failed` while the event fills its Stripe id, or the later `succeeded` becomes a no-op);
  - `succeeded` applies from `pending`, and from `failed`/`canceled` only when `!hasStripeId`. `succeeded→succeeded` is a no-op;
  - `failed` applies from `pending` or `succeeded`;
  - `canceled` applies from `pending` or `succeeded` (`warn: true` for `succeeded→canceled`);
  - `failed↔canceled` is a no-op.
  - Filling a missing `processor_refund_id` on a no-op is decided by the handler, not here (the function is about status only).
- `vetLedgerRowIdCandidate(metadata)`: the A-1 shape check. It reads only `metadata[REFUND_ROW_ID_METADATA_KEY]`: absent → `{ id: null }`; not UUID-shaped → `{ id: null, malformedLength }`; otherwise `{ id }`. It reuses the exported `isUuidShaped` from `lib/payments/ownedLinkId.ts`, the same test `vetLinkId` / `ownedOrNull` use, imported rather than re-written.
- `isTrustedAppRowFor(row, refund)`: the remaining A-1 checks on the row returned by the scoped (b) read: `source === 'app'`, `processor_type === 'stripe'`, `amount_minor === refund.amount`, currencies equal case-insensitively, `processor_refund_id` null or equal to `refund.id`. It returns the failing check's **name** (for the warn log), never a value.

**Repository** (`PaymentRefundRepository.ts`). `upsertFromStripe`, `NewStripeRefundRow` and the ⟨unscoped-by-design⟩ header are removed. Three methods, all scoped by `user_id` **and** `transaction_id`:
1. `findForStripeRefund(userId, transactionId, { processorRefundId, ledgerRowId? })`. Query (a): `.eq('user_id').eq('transaction_id').eq('processor_refund_id', id).maybeSingle()`. Only if (a) finds nothing and `ledgerRowId` is set, query (b): `.eq('id', ledgerRowId).eq('transaction_id').eq('user_id').maybeSingle()`. It selects only `id, status, processor_refund_id, source, processor_type, amount_minor, currency` and returns `{ data: { row, matchedBy: 'processor_refund_id' | 'ledger_row_id' } | null, error }`. Two plain reads, no `.or()`.
2. `insertFromStripe(row: NewWebhookRefundRow)`: a plain `.insert(row)` with **no `.select()`** and no `onConflict`. `NewWebhookRefundRow` is a closed interface: `source: 'webhook'`, `processor_type: 'stripe'`, `idempotency_key: \`stripe:${string}\``, `metadata: { origin: 'refund.created' | 'refund.updated' | 'refund.failed'; charge_id: string | null; payment_intent_id: string | null }`, `status` covering all four values, and `created_at`, `succeeded_at`, `failure_code`, `failure_message`.
3. `applyStripeRefundState(userId, transactionId, id, expected: { status: LedgerRefundStatus; processorRefundId: string | null }, patch: StripeRefundStatePatch)`: `.update(patch, { count: 'exact' }).eq('id').eq('transaction_id').eq('user_id').eq('status', expected.status)`, then `.is('processor_refund_id', null)` or `.eq('processor_refund_id', expected.processorRefundId)`. **No `.or()`, no `.select()`** (the PostgREST 42703 bug). It returns `{ data: { count }, error }`. `StripeRefundStatePatch` is a closed interface: `status?`, `processor_refund_id?`, `stripe_connect_account_id?`, `succeeded_at?`, `failure_code?`, `failure_message?`, `updated_at`. An extra key is a `tsc` error (F2-f).
- The file header is rewritten: the service-role note stays (documented RLS bypass); the scoping is now literal (rule 4); the callers are the webhook and `RefundService`.

**`PaymentRepository.ts`**: `WEBHOOK_TRANSACTION_REFUND_COLUMNS` becomes `'id, user_id, invoice_id, currency, stripe_connect_account_id'`, and its row type becomes `Pick<PaymentTransaction, 'id'|'user_id'|'invoice_id'|'currency'> & { stripe_connect_account_id: string | null }`. The doc comments that name `charge.refunded` / FU-3 are updated (A-7). The dispute list is unchanged.

**Route** (`app/api/stripe/webhook/route.ts`):
- `handleChargeRefunded` is **deleted** (SA-4). `case 'charge.refunded':` becomes one `log.info({ chargeId }, 'charge.refunded ignored: refunds are recorded from refund.* events')` and `break`, with a comment pointing to `refund.*`.
- New cases, in the `customer.subscription.created` shape (SA-2):
  ```text
  case 'refund.created': case 'refund.updated': case 'refund.failed':
    if (!isConnectEvent) { log.info(..., 'Platform refund event; not recorded in the client ledger'); break; }
    await handleConnectRefund(event, connectAccountId!, log); break;
  ```
  `charge.refund.updated` is not added (it stays in `default`).
- New top-level `handleConnectRefund(event, connectAccountId, log)`. **Every repository call has exactly one call site**, so the `MONEY_ROW_CALLS` guard stays exact. The 23505 re-read is a two-pass loop, not a second call site:
  1. `refund = event.data.object as Stripe.Refund`. `chargeId` and `paymentIntentId` are taken from string-or-object, as the deleted handler did.
  2. `incoming = mapStripeRefundStatus(refund.status)`. If null: `log.warn` with the status value (a Stripe enum, not metadata), acknowledge, and write nothing (Q-SA-3).
  3. `findFirstByStripeReference(…, WEBHOOK_TRANSACTION_REFUND_COLUMNS)`. **A lookup error now throws** (500 and retry). Today it is ignored and reads as "unknown payment", which acknowledges a real refund. No payment found: `log.error` and acknowledge, as today (FR 11).
  4. `accountOwns(connectAccountId, transaction.user_id, log)` false → `log.error` and return (no write, no sync). A non-null `transaction.stripe_connect_account_id !== connectAccountId` → `log.error` and return. NULL → `log.warn` and continue (A-5).
  5. `candidate = vetLedgerRowIdCandidate(refund.metadata)`. If malformed: `log.warn({ key, length })`.
  6. Loop `for (let pass = 1; pass <= 2; pass++)`:
     - `findForStripeRefund(transaction.user_id, transaction.id, { processorRefundId: refund.id, ledgerRowId: candidate.id })`. An error throws.
     - If the match came by `ledger_row_id` and `isTrustedAppRowFor` fails: `log.warn({ check, ledgerRowId, stripeRefundId, transactionId })` (ids and the check name only) and treat it as no match.
     - **Match** → compute `nextLedgerRefundStatus(row.status, !!row.processor_refund_id, incoming)`. Build `patch` field by field: `status` when it applies; `processor_refund_id: refund.id` when the row has none; `stripe_connect_account_id: connectAccountId` only when the row has none (§10 Q-SA-4); `succeeded_at = iso(event.created)` only when moving **into** `succeeded`; `failure_code = refund.failure_reason ?? null` and `failure_message: null` only when moving into `failed`; `updated_at`. Nothing to change (a no-op with the id already set) → `log.info` and return, with no write and no sync. Otherwise `applyStripeRefundState(transaction.user_id, transaction.id, row.id, { status: row.status, processorRefundId: row.processor_refund_id }, patch)`. On error: `P0001` → acknowledge with an alert (below); anything else throws. `count === 0` → throw (race lost; the retry re-reads). Status applied → `syncBookingsForTransactions([transaction.id], transaction.user_id)`. Only the id filled → no sync (A-6: sync only on an applied **status** change). Return.
     - **No match** → `insertFromStripe({ user_id: transaction.user_id, transaction_id: transaction.id, invoice_id: transaction.invoice_id, amount: fromMinorUnits(refund.amount, currency), amount_minor: refund.amount, currency, status: incoming, processor_type: 'stripe', processor_refund_id: refund.id, stripe_connect_account_id: connectAccountId, idempotency_key: \`stripe:${refund.id}\`, source: 'webhook', created_at: iso(refund.created), succeeded_at: incoming === 'succeeded' ? iso(event.created) : null, failure_code: incoming === 'failed' ? refund.failure_reason ?? null : null, failure_message: null, metadata: { origin: event.type, charge_id, payment_intent_id } })`, where `currency = (refund.currency || transaction.currency).toUpperCase()` as today. No error → sync and return. `23505` on pass 1 → `continue` (re-read once). `23505` on pass 2 → throw. `P0001` → acknowledge with an alert. Anything else throws.
  7. Acknowledge with an alert (FR 12 / SA-7) is exactly one `log.error({ alert: true, eventId: event.id, stripeRefundId: refund.id, transactionId: transaction.id, pgCode: 'P0001' }, 'Refund ledger refused a Stripe refund (refund_guard_before)')`, then return. The switch then completes the claim and answers 200.
- `failure_message` stays null. Stripe's Refund object has no failure message field (SDK 19.2.1: only `failure_reason`), so "where Stripe provides one" is never met today.

**`RefundService.ts` A-4 (in slice 2):** both post-reply writes move to `paymentRefundRepository.applyStripeRefundState(userId, tx.id, ledgerRow.id, { status: 'pending', processorRefundId: null }, patch)`.
- **Structural change, deliberately:** the success-path write moves **out of** the `try` around `stripe.refunds.create`. Today a throw inside that `try` after Stripe has answered would run the catch and write `failed` over money that moved. The repository returns `{ error }` and does not throw, but keeping the write outside the `try` makes "the catch only ever describes a failed Stripe call" structural rather than incidental.
- Count 0 on either write: `log.info({ refundId }, 'Webhook already recorded Stripe's answer; keeping it')`, and the webhook's state stands (A4-2). The return value still follows Stripe's own reply (success path) or the error (catch path).
- In slice 2 the success-path **mapping** stays as today (`failed` if Stripe says failed, otherwise `succeeded`, `succeeded_at = now`). Slice 3 changes it.

### 3.3 Slice 3: pending shown as pending

`RefundService.ts`, success path only:
- `ledgerStatus = mapStripeRefundStatus(stripeRefund.status) ?? 'pending'`. A null or unknown reply is treated as still in flight, never as success.
- Patch: `status: ledgerStatus`, `processor_refund_id`, `succeeded_at` **only** when `succeeded`, and `failure_code = stripeRefund.failure_reason` when `failed`.
- Return value by Stripe's reply:
  - `succeeded` → `ok: true` and `recordRefundActivity()`, as today.
  - `pending` (incl. `requires_action`) → `{ ok: false, code: 'IN_FLIGHT', message }`, with no `recordRefundActivity()` (SA-9). The message gets its own minimal copy (S3-2, §5): *"Stripe has accepted this refund and is still processing it. It will show as refunded once Stripe confirms. Do not refund it again."*
  - `failed` / `canceled` → **today this returns `ok: true`** (it writes `failed` and still reports success). Proposed: `{ ok: false, code: 'PROCESSOR_ERROR', message }` with the existing production-safe message, and no activity. This is a correction inside the same lines. SA to confirm: §10 Q-SA-5.

---

## 4. Tenant-Isolation Checklist (F3-b)

Per `.claude/skills/tenant-isolation-guard/SKILL.md`, for `handleConnectRefund` and the three repository methods.

| Step | Outcome |
|---|---|
| 1. Applies? | **Yes.** Service role (`supabaseServer`, RLS bypassed). Caller-controlled input: `refund.metadata.refund_row_id`, which any connected business can write on a dashboard refund; also `refund.charge` / `refund.payment_intent`, which Stripe sets but which name an object on the **sending** account |
| 2. Ownership pre-check | `accountOwns(event.account, transaction.user_id)` **plus** the stored `stripe_connect_account_id` equality (when non-null), **before** any ledger read by row id and before any write. The metadata row id is read only inside the proven payment (`id + transaction_id + user_id`), so a foreign id is simply not found and fails closed into "no match → new webhook row". Not-found and error are separated: an error throws for a retry, `!data` means no match |
| 2b. Every caller-supplied id | `refund_row_id`: scoped read + A-1 checks. Charge / intent: resolve only to a payment whose owner is then proven against `event.account` |
| 3. Field allow-list | Insert: a typed literal built field by field; `user_id` / `transaction_id` / `invoice_id` copied from the proven payment row; `metadata` is our own three keys and never Stripe's. Update: `StripeRefundStatePatch` is closed; it cannot carry `source`, `idempotency_key`, `reason*`, `initiated_by`, `metadata`, `amount*`, `user_id` or `created_at` |
| 4. Scope-defeating three | **Upsert**: removed entirely (SA-6). **Triggers**: `refund_guard_before` locks `payment_transactions WHERE id = NEW.transaction_id`, which is the proven payment; `recompute_transaction_refund_state` updates the same proven payment; the invoice and booking propagation triggers run from that payment row. None can reach another tenant once the payment is proven. **Payload injection**: none, since every field is explicit |
| 5. Global catalog | Not applicable |
| 6. Queue runner | Not applicable (synchronous webhook) |
| 7. Tests | F3-a (foreign account: no ledger call, no sync), F3-c (stored account mismatch / NULL), F3-d (owner read error → 500), F1-e (foreign, cross-payment or forged metadata ignored, named row untouched), plus the `OWNER_PROVED` guard ordering (§8) |

---

## 5. Callers of `refund()` and how each renders `IN_FLIGHT` (S3-2)

`IN_FLIGHT` already exists (23505 replay of a pending original, `RefundService.ts:936-944`). Slice 3 adds a second source: a pending Stripe reply.

| # | Caller | What it does on `IN_FLIGHT` | Side effects fired? | Shown to the owner as |
|---|---|---|---|---|
| 1 | `app/api/payments/refunds/route.ts:359` (single payment) | 409 (`STATUS_FOR.IN_FLIGHT`, :157), `{ success:false, error: message, code }` | None: returns before audit, booking sync, email and plan/booking follow-ups | **Error**: `RefundModal` (:555-644) → `onError(data.error)` → error banner in `MoneyList`, `PaymentInvoiceList`, `PaymentTransactionList`, `PaymentsSection`, `CRMContactDrawerV2`, `NeedsYouCard` |
| 2 | `app/api/payments/refunds/route.ts:246` (whole booking / `scope: 'all'`, via `refundGroup`) | The leg is `ok:false` with code `IN_FLIGHT`; group `succeeded < requested` → 409 "X of Y payments were refunded." | PAYMENT_REFUNDED audit **is** written with the counts (existing behaviour for any partial group); `syncBookingsForTransactions` runs (harmless: pending does not count); email only if `refundedTotal > 0`, which excludes the pending leg | **Error** banner with the X-of-Y text; the leg's own message is in `data.legs` |
| 3 | `app/api/scheduling/bookings/[id]/refund/route.ts:218` (single) | 409 `{ success:false, error: message, code }` | None | **Error**: `PaymentManagementModal.tsx:510-560` throws → `setError` |
| 4 | `app/api/scheduling/bookings/[id]/refund/route.ts:52` (whole booking, `refundGroup`) | As #2: 409 "X of Y…" | `syncBookingPaymentState` (harmless); email only if `refundedTotal > 0` | **Error** banner |
| 5 | `lib/payments/cancelPlan.ts:225` (`refundGroup` with `maxTotal`) | The leg is `ok:false`; the plan is still stopped | `syncBookingsForTransactions` (harmless) | Through the cancel-plan callers' `refund` outcome |
| 7 | `lib/business-os/bizql/mutate/MutateExecutor.ts:688` (Business OS chat refund, added at code review, SA CR-2) | `!result.ok` → `{ data: null, error: new Error(result.message) }`; the chat shows it as an error | None: it returns before any follow-up | **Chat error** with the server message (the new processing copy for a pending reply). Behaviour is correct as built; no change |
| 6 | `app/api/payments/blocks/execute/route.ts:309` (automation refund block) | `emitPaymentEvent('refund.failed', …)` then `throw` → the step fails | **Yes: a `refund.failed` payment event is emitted** for money that may still move. This already happens for the replay `IN_FLIGHT` | Automation step error |

**Minimal copy change (in scope):** callers 1, 3 and (through the legs) 2 and 4 show the message as an error. Slice 3 gives the pending-reply `IN_FLIGHT` its own server message (§3.3), so the banner says the refund is processing and must not be repeated. No component, translation or UI-state change. **Not changed, raised for SA:** caller 6's `refund.failed` event (Q-SA-6) and `refundGroup`'s `maxTotal` budget not counting a pending leg (Q-SA-7).

---

## 6. Fixture Source (A-9 / F5-c)

- **Source used:** Stripe's API reference for the Refund object and the `refund.created` / `refund.updated` / `refund.failed` / `charge.refunded` events at the pinned `2025-10-29.clover`, cross-checked against the installed SDK's types (`stripe@19.2.1`, `types/Refunds.d.ts`, `types/EventTypes.d.ts`). Refund fields used: `id, object, amount, balance_transaction, charge, created, currency, destination_details, failure_balance_transaction, failure_reason, metadata, payment_intent, pending_reason, reason, receipt_number, source_transfer_reversal, status, transfer_reversal`. Event envelope: `id, object, account, api_version, created, data.object, livemode, pending_webhooks, request, type`. No invented field; `charge.refunded`'s Charge carries **no** `refunds` key.
- **Not used:** a real captured test-mode payload. The local `STRIPE_SECRET_KEY` is not the Connect platform's key (RCA §5), so no event can be pulled. **Optional upgrade:** if the user exports one `refund.updated` from the Connect platform's test-mode dashboard (Developers → Events), the fixture is replaced by it, with ids scrubbed.
- Fixtures: `charge-refunded.json` (replaced, no `refunds`), new `refund-created.json` (pending, with `metadata.refund_row_id`), `refund-updated-succeeded.json` (no metadata, i.e. a dashboard refund), `refund-updated-pending-to-succeeded.json`, `refund-failed.json` (`failure_reason: 'expired_or_canceled_card'`). All are `livemode: false` and have `account: 'acct_…'`.

---

## 7. Files to Create / Modify

| File | Action | Slice | Reason |
|---|---|---|---|
| `lib/payments/stripeRefundLedger.ts` | create | 1 (constant), 2 (pure functions) | FR 15 key constant; FR 5/6 mapping and transition; A-1 checks |
| `lib/payments/RefundService.ts` | modify | 1, 2, 3 | Metadata on `refunds.create`; A-4 conditional writes through the repository; slice 3 status mapping and `IN_FLIGHT` |
| `lib/repositories/PaymentRefundRepository.ts` | modify | 2 | Remove `upsertFromStripe`; add three scoped methods; types |
| `lib/repositories/PaymentRepository.ts` | modify | 2 | Widen `WEBHOOK_TRANSACTION_REFUND_COLUMNS` + row type; doc comments |
| `app/api/stripe/webhook/route.ts` | modify | 2 | Delete `handleChargeRefunded`; `charge.refunded` no-op; `refund.*` cases; `handleConnectRefund` |
| `app/api/stripe/webhook/__tests__/fixtures/connect/charge-refunded.json` | modify | 2 | Real shape (F5-a) |
| `app/api/stripe/webhook/__tests__/fixtures/connect/refund-*.json` (4) | create | 2 | F5-b fixtures (data files, not test files) |
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` + `.snap` | modify | 2 | 7a, X4, X25, X26 rewritten; new `refund.*` / F1 / F2 / F3 / R / T / G cases; harness mock gains `update(…, { count })` + `.is()` if absent |
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` | modify | 2 | `MONEY_ROW_CALLS`; `OWNER_PROVED` extended to `paymentRefundRepository` writes; comment says dispute only |
| `app/api/stripe/webhook/__tests__/moneyRowsRepository.qa.test.ts` | modify | 2 | **Not in requirement §6.** Its E1/E2 cases drive `charge-refunded` + `upsertFromStripe` (:240-241, :322-328, :394-402, :405-417). Rewritten onto `refund.*` |
| `app/api/stripe/webhook/__tests__/boostRouting.integration.test.ts` | modify | 2 | **Not in requirement §6.** :393-405 assert the "legacy refund handler" reads `payment_transactions` for a non-boost platform `charge.refunded`. After SA-4 it reads nothing, so `legacyRefundRead()` flips to `false` and the test names change |
| `lib/repositories/__tests__/PaymentRefundRepository.test.ts` | modify (rewrite) | 2 | One test per method; scoping and compare-and-set filters; no `.or`, no upsert; F2-f `@ts-expect-error` |
| `lib/business-os/billing/__tests__/webhookDispatcher.test.ts` | modify | 2 | F4-a (i) |
| `lib/payments/__tests__/refundService.test.ts` | modify | 1, 2, 3 | S1-1/2/3; A4-1/2 on a repository mock; S3-1/2 |
| `lib/payments/__tests__/stripeRefundLedger.test.ts` | **create** (new unit-test file, see Q-SA-8) | 2 | F2-a/F2-d exhaustive transitions; A-1 helper cases |
| `lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts` | none | — | Run only, to confirm green (A-8) |
| `docs/requirements/STRIPE_CONNECT_REFUND_WEBHOOK_REQUIREMENT.md` | modify | each stage | §0 status rows (standing rule: every stage spliced into the main requirement) |

No migration. No change to `webhookDispatcher.ts`, resolvers, `syncBookingPaymentState.ts`, `scripts/reconcile-stripe-payments.ts` or `lib/server/stripe-plugin-executor.ts`. Nothing imports `lib/business-os/entitlements/`, so the entitlements skill does not apply.

---

## 8. Test Plan

All inside the existing Jest job (`tests.yml`, the gate config; none of these suites is quarantined). **No new CI gate, no workflow change.** The only new file is the pure-function unit test (Q-SA-8), which adds well under a second.

| AC | Where | How |
|---|---|---|
| S1-1, S1-2, S1-3 | `refundService.test.ts` | `refunds.create` params: `metadata` deep-equals `{ refund_row_id: <ledger id> }`; key imported from the constant; the rest unchanged; manual paths make no Stripe call |
| F1-a, F1-b, F1-c, F1-d | characterisation | Fixtures with a pending app row by metadata / by id / none; assert the recorded chain: one row, the patch has none of the app's columns, the insert literal, redelivery → (a) match, no second insert |
| F1-e (6 cases) | characterisation | Non-UUID, foreign payment / user (the scoped read returns null), `source='manual'`, `processor_type='manual'`, amount mismatch, currency mismatch, different Stripe id → named row untouched, one `webhook` insert, the warn log has ids/keys only (assert the metadata value is absent from every log arg; length only for non-UUID) |
| F1-f | `PaymentRefundRepository.test.ts` | Filters `id`, `transaction_id`, `user_id` on read (b); `user_id`, `transaction_id`, `processor_refund_id` on read (a) |
| F1-g | characterisation | Insert → 23505 → re-read finds → applied; and 23505 → re-read null → 500, claim released |
| F2-a, F2-d | `stripeRefundLedger.test.ts` | Mapping per status incl. `null`/unknown; exhaustive loop over 4 current × 2 hasStripeId × 5 incoming = 40 cases against a literal expected table |
| F2-b | characterisation + QA | Status write asserted; the trigger effect manually on a test DB (`npm run test:triggers` is available locally, Docker; not CI) |
| F2-c, T-3 | characterisation | `refund.updated(succeeded)` then a late `refund.created(pending)` → no-op; `succeeded_at` from the event that moved it; redelivery leaves it |
| F2-e | repo test + characterisation | `update(patch, { count: 'exact' })`, `.eq` ×4 + `.is`/`.eq` on the processor id; no `or`/`select` in the chain; route: count 0 → 500 |
| F2-f, T-2 | `PaymentRefundRepository.test.ts` | `// @ts-expect-error` on `source`, `created_at`, `metadata`, `amount`, `user_id` keys in the patch (compiled by ts-jest diagnostics, the same pattern as `BillingEventRepository.test.ts:108`) |
| R-1, R-2 | characterisation | `P0001` on insert and on update → 200, claim completed, exactly one `alert: true` error log with the five fields; `XX000` → 500 |
| A4-1, A4-2 | `refundService.test.ts` | `jest.mock('@/lib/repositories/PaymentRefundRepository')`; both paths call `applyStripeRefundState` with `{ status: 'pending', processorRefundId: null }`; count 0 → info log, no further write; no `supabaseServer.update` on `payment_refunds` remains |
| F3-a, F3-c, F3-d, F3-e, F3-f | characterisation | Foreign account → no `payment_refunds` op, no sync, error log, 200; stored-account mismatch → same; NULL → recorded + warn; owner read error → 500; insert literal's `user_id`/`transaction_id`/`invoice_id` from the payment row, `stripe_connect_account_id` = `event.account` |
| F3-b | `routerPlacement.guard.test.ts` | `handleConnectRefund` in `OWNER_PROVED` with `transaction.user_id`; each `insertFromStripe`/`applyStripeRefundState` call after an `accountOwns` whose 2nd arg is `transaction.user_id`; the insert literal's `user_id` and the update's 1st arg are `transaction.user_id` |
| F4-a | dispatcher test + characterisation | (i) `DEFAULT_RESOLVERS` → `not_business_os` for the 3 types, boost port not called; (ii) platform `refund.*` → no money-row op, info log, claim completed |
| F4-b, F4-c | guard (unchanged assertion) + characterisation | The router-placement assertion stays green; `charge.refund.updated` → "Unhandled event type" |
| F5-a, F5-b | characterisation + snapshots | 7a: `charge.refunded` → no op, one info log; new `refund.*` snapshots; `MONEY_ROW_CALLS` has no `handleChargeRefunded` |
| G-1 | characterisation | Sync called for applied `succeeded` and `succeeded→failed`; not for a no-op |
| G-2 | characterisation | Insert error (non-P0001, non-23505) → 500, claim released |
| G-5 | `PaymentRefundRepository.test.ts` | No `upsert` in any recorded chain; `upsertFromStripe` is undefined on the instance |
| S3-1, S3-2 | `refundService.test.ts` | Reply `pending` / `requires_action` → row stays pending, `succeeded_at` absent, `IN_FLIGHT` with the new message, no CRM activity; `succeeded` → as today; `failed`/`canceled` → mapped status, `PROCESSOR_ERROR` (pending Q-SA-5) |
| G-3, G-4 | QA manual, post-deploy, test mode | Dashboard refund lands (payment, booking, guard, Finance takings); app refund → one `source='app'` row and `refund_row_id` visible on the Stripe refund |

**Commands (each slice before handing over):**
```bash
npx jest app/api/stripe/webhook lib/repositories/__tests__/PaymentRefundRepository.test.ts \
  lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts \
  lib/business-os/billing/__tests__/webhookDispatcher.test.ts lib/payments/__tests__ --ci
npm run lint -- --file <each touched file>
```
Snapshots are updated with `-u` **only** for the cases this change rewrites, and the `.snap` diff is reviewed hunk by hunk (no unrelated snapshot may move). Type check: ts-jest diagnostics cover the tested files. A scoped `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` is filtered to the touched files, checking tsc's own exit code (schema-check skill Rule 7).

**Environment note:** this worktree has **no `node_modules`**. Before running tests, link the shared one as a junction, and **unlink the junction before any `git worktree remove`** (shared-junction hazard), or run from a scratch export.

---

## 9. Task List

### Slice 0: gates (no code)
- ✅ T-0a RM created `fix/stripe-connect-refund-webhook` from `origin/main` @ `47175fa5`; Dev confirmed it with `git branch --show-current` (Dev did not create it)
- ✅ T-0b SA-8 U-1..U-3 closed 2026-10-14: §2.3 run read-only against prod, results recorded in §2.2, verdict = match (§2.4). **Any mismatch → stop and report to SA**
- ✅ T-0c SA workplan review incl. the §14.3 fold-in check and §10 rulings (approved with conditions C-1..C-9)

### Slice 1: refund carries the ledger row id (commit 1)
- ✅ T-1.1 Create `lib/payments/stripeRefundLedger.ts` with `REFUND_ROW_ID_METADATA_KEY`
- ✅ T-1.2 `RefundService.ts`: `metadata: { [REFUND_ROW_ID_METADATA_KEY]: ledgerRow.id }` on `refunds.create`
- ✅ T-1.3 `refundService.test.ts`: S1-1..S1-3
- ✅ T-1.4 Run the slice-1 test set (41/41); update requirement §0

### Slice 2: `refund.*` handling (commit 2)
- ✅ T-2.1 `stripeRefundLedger.ts`: `mapStripeRefundStatus`, `nextLedgerRefundStatus`, `vetLedgerRowIdCandidate`, `untrustedAppRowCheck` (named `isTrustedAppRowFor` in §3.2; see §12.3 D-1), types
- ✅ T-2.2 `stripeRefundLedger.test.ts`: F2-a, F2-d (exhaustive, 40 combinations), A-1 helper cases, leaf source-shape check
- ✅ T-2.3 `PaymentRefundRepository.ts`: remove `upsertFromStripe`; add `findForStripeRefund`, `insertFromStripe`, `applyStripeRefundState`; rewrite header
- ✅ T-2.4 `PaymentRefundRepository.test.ts` rewritten (F1-f, F2-e, F2-f, G-5)
- ✅ T-2.5 `PaymentRepository.ts`: widen the refund column list + row type; doc comments
- ✅ T-2.6 `route.ts`: delete `handleChargeRefunded`; `charge.refunded` no-op; `refund.*` cases; `handleConnectRefund` (§3.2)
- ✅ T-2.7 `RefundService.ts` A-4: both post-reply writes through `applyStripeRefundState`; success write moved out of the `try`
- ✅ T-2.8 `refundService.test.ts`: A4-1, A4-2, C-2; the existing `dbState.updates` assertion for the catch write moved to the repository mock
- ✅ T-2.9 Fixtures: replace `charge-refunded.json`; add 4 `refund-*.json` (§6)
- ✅ T-2.10 Characterisation: 7a/X4/X25/X26 rewritten; R1–R4 snapshots; F1/F2/F3/R/T/G/F4 cases; the harness already accepted `update(…, {count})` + `.is()` (no harness change); snapshots reviewed entry by entry (§12.4)
- ✅ T-2.11 `routerPlacement.guard.test.ts`: `MONEY_ROW_CALLS` updated; new refund branch test (C-5); comment says dispute only
- ✅ T-2.12 `moneyRowsRepository.qa.test.ts` and `boostRouting.integration.test.ts` updated (§7); also `PaymentTransactionRepository.webhook.test.ts` (column string, §12.3 D-6)
- ✅ T-2.13 `webhookDispatcher.test.ts`: F4-a (i)
- ✅ T-2.14 Full slice-2 test set + `paymentTablesWriteLockdownMigration.test.ts` green (23 suites, 782 tests, 107 snapshots); tenant checklist (§4) met; requirement §0 updated

### Slice 3: pending shown as pending (commit 3)
- ✅ T-3.1 `RefundService.ts`: Stripe's real status through `mapStripeRefundStatus`; `succeeded_at` only on succeeded; the return value per §3.3 (incl. Q-SA-5: `failed`/`canceled` → `PROCESSOR_ERROR`)
- ✅ T-3.2 Pending-reply `IN_FLIGHT` message (§5 minimal copy)
- ✅ T-3.3 `refundService.test.ts`: S3-1, S3-2, C-8
- ✅ T-3.4 Full test set green (24 suites, 837 tests, 107 snapshots); requirement §0 updated; status → Code Complete
- ✅ T-3.5 (C-3, Q-SA-6) `app/api/payments/blocks/execute/route.ts`: no `refund.failed` emit on `IN_FLIGHT`; the step still throws. No test file (QA manual note, §12.6)
- ✅ T-3.6 (C-4, Q-SA-7) `refundGroup`: an `IN_FLIGHT` leg spends its `legAmount` of `maxTotal`; one case in `refundService.test.ts`

---

## 10. Open Technical Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-SA-0 | SA-8 U-1..U-3 (CHECKs, index definitions incl. the partial predicate, guard SQLSTATE) are not reachable read-only through PostgREST. Gate T-1 on the user running §2.3, or accept the migration bodies plus the §2.1 matches? | Gate on §2.3. It is three selects and the requirement said "the live DB can differ from migrations" |
| Q-SA-1 | FR 2 says "by its payment intent, or failing that by its charge". As built, `findFirstByStripeReference` uses the charge **only when there is no intent**; it does not fall back when the intent is not found. Keep as built (reuse, as FR 2 also says "the same lookup")? | Keep as built; a fallback is a behaviour change to a shared method |
| Q-SA-2 | `refund_row_id` constant lives in a new leaf module `lib/payments/stripeRefundLedger.ts` (imported by `RefundService` and the route) rather than inside `RefundService.ts`, to keep `RefundService`'s imports out of the webhook route. Acceptable reading of FR 15? | Yes |
| Q-SA-3 | `Refund.status` is `string \| null` in the SDK. On `null` or an unknown value: acknowledge with a warn and write nothing (a later `refund.updated` carries the status), or record as `pending`? | Acknowledge + warn, no write. Recording `pending` would hold refund budget on a guess |
| Q-SA-4 | When the webhook updates an existing row whose `stripe_connect_account_id` is NULL, should the patch fill it with `event.account`? (FR 13 allows the column in the patch; FR 7 only says "on a new row") | Fill only when NULL; never overwrite |
| Q-SA-5 | Slice 3: a synchronous Stripe reply of `failed` / `canceled` today returns `ok: true` (fires activity, callers email and sync). Return `PROCESSOR_ERROR` with no side effects? | Yes. Same lines, and it is the same class of "reported done when it is not" that slice 3 fixes |
| Q-SA-6 | Caller 6 (automation refund block) emits a `refund.failed` payment event on any `!ok`, including `IN_FLIGHT`. Slice 3 makes that more frequent. In scope (skip the emit for `IN_FLIGHT`) or flag-only? | Flag-only, per "minimal copy change" scope; raise as a follow-up |
| Q-SA-7 | `refundGroup` with `maxTotal` (cancelPlan) does not subtract a pending leg from `budget`, so a later leg could exceed the cap by the pending amount. The DB guard still bounds each payment, not the plan total. In scope? | Flag-only; rare (needs a pending reply mid-group) |
| Q-SA-8 | The exhaustive transition test is a **new** co-located unit-test file (`lib/payments/__tests__/stripeRefundLedger.test.ts`) in the existing Jest job. Acceptable under "no new CI gate / guard changes in existing files", or should it live in `refundService.test.ts`? | New file. It is a unit test for a new module, not a guard, and adds well under a second |
| Q-SA-9 | A first-seen `failed`/`canceled` refund is **inserted** as a `webhook` row. `refund_guard_before` checks `committed + NEW.amount > tx_amount` for any status, so on an already-fully-refunded payment that insert raises `P0001` and is acknowledged with an alert. Accept that (the alert is noise but bounded), or skip inserting a row first seen as `failed`/`canceled`? | Accept; the row is a true record and the case is rare. SA may prefer skip |
| Q-SA-10 | Requirement §6 lists 4 guards. `moneyRowsRepository.qa.test.ts` and `boostRouting.integration.test.ts` also pin the old `charge.refunded` behaviour (§7) and must change. Confirm they belong in this PR | Yes (existing files, no CI change) |

---

## 11. Flags Recorded (not fixed here)

| Flag | Where | Note |
|---|---|---|
| The other direct `supabaseServer` queries | `RefundService.ts` (:258, :416, :439, :450, :700, :848, :907, :993, :1001); `syncBookingPaymentState.ts` | Requirement §11; unchanged. Only the two post-reply writes move (A-4) |
| Reconciler's unsafe upsert (A-10) | `scripts/reconcile-stripe-payments.ts:320` | Not touched |
| `refund.failed` event on `IN_FLIGHT` | `app/api/payments/blocks/execute/route.ts:333-337` | Q-SA-6 |
| `maxTotal` vs pending legs | `RefundService.ts` `refundGroup` | Q-SA-7 |
| PAYMENT_REFUNDED audit on a group with 0 succeeded | `app/api/payments/refunds/route.ts:258-275` | Existing behaviour; counts are recorded, so it is not wrong, only noisy |
| `schema:check` FAIL, 25 unrelated selects | main @ e49a4719 | Pre-existing; none in this scope |
| Worktree has no `node_modules` | this worktree | Junction hazard; §8 |

---

## 12. Implementation Notes (Dev, 2026-10-14)

Everything is **uncommitted** on `fix/stripe-connect-refund-webhook`. No DB write, no migration, no Stripe call against any account. `git stash` was not used.

### 12.1 Files and hunks per slice (for the three commits)

| File | Slice 1 | Slice 2 | Slice 3 |
|---|---|---|---|
| `lib/payments/stripeRefundLedger.ts` (new) | Module header + `REFUND_ROW_ID_METADATA_KEY` | `import { isUuidShaped }` and everything below the constant (types, `mapStripeRefundStatus`, `nextLedgerRefundStatus`, `vetLedgerRowIdCandidate`, `untrustedAppRowCheck`) | — |
| `lib/payments/RefundService.ts` | `import { REFUND_ROW_ID_METADATA_KEY }`; `metadata` on `refunds.create` | `import { paymentRefundRepository }`; `OPENED_BY_THIS_REQUEST`; `try` narrowed to the Stripe call; catch write and success write via `applyStripeRefundState` (mapping as before), C-2 logging | `type StripeRefundStatePatch` + `mapStripeRefundStatus` imports; `PROCESSING_AT_STRIPE_MESSAGE`; `refundGroup` `IN_FLIGHT` budget (C-4); success path: real status, `IN_FLIGHT` / `PROCESSOR_ERROR` returns |
| `lib/payments/__tests__/refundService.test.ts` | Constant import; describe "the Stripe refund carries the ledger row id (S1)" | `PaymentRefundRepository` mock + shared `childLog`; `beforeEach` resets; the "leaves the ledger row failed" assertion moved to the repository mock; describe "post-reply ledger writes do not overwrite the webhook (A-4)" | `connectAccount` + `tablesTouched` on the `dbState` type (also fixes the 5 pre-existing `tsc` errors in this file); `tablesTouched` recording; describe "what Stripe answered is what is recorded (slice 3)" |
| `lib/payments/__tests__/stripeRefundLedger.test.ts` (new) | — | whole file | — |
| `lib/repositories/PaymentRefundRepository.ts` | — | whole file | — |
| `lib/repositories/__tests__/PaymentRefundRepository.test.ts` | — | whole file | — |
| `lib/repositories/PaymentRepository.ts` | — | refund column list, row type, `findFirstByStripeReference` doc | — |
| `lib/repositories/__tests__/PaymentTransactionRepository.webhook.test.ts` | — | the two column-string assertions | — |
| `lib/repositories/index.ts` | — | barrel exports | — |
| `docs/REPOSITORY_STRATEGY.md` | — | structure tree line, "Superseded" note, Change History row | — |
| `app/api/stripe/webhook/route.ts` | — | whole diff | — |
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` + `.snap` | — | whole diff | — |
| `app/api/stripe/webhook/__tests__/fixtures/connect/charge-refunded.json` + 4 new `refund-*.json` | — | whole | — |
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` | — | whole diff | — |
| `app/api/stripe/webhook/__tests__/moneyRowsRepository.qa.test.ts` | — | whole diff | — |
| `app/api/stripe/webhook/__tests__/boostRouting.integration.test.ts` | — | whole diff | — |
| `lib/business-os/billing/__tests__/webhookDispatcher.test.ts` | — | whole diff | — |
| `app/api/payments/blocks/execute/route.ts` | — | — | whole diff (C-3) |

**Rebuilding the three commits.** Slices 2 and 3 both rewrite the same lines of `RefundService.ts`, so `git add -p` cannot produce the slice-2 state on its own. Dev saved three incremental patches (each against the previous slice, built with a temporary index file; the real index was not touched). They reproduce the working tree byte for byte (checked blob by blob):
`slice1.patch`, `slice2.patch`, `slice3.patch` in the session scratchpad (a local temp folder, not in the repo). They do not include the three docs (RCA, requirement, workplan), which RM places as it sees fit. Each intermediate state was tested: slice 1 (refundService 41/41), slice 2 (23 suites, 782 tests, 107 snapshots, `tsc` no new errors).

### 12.2 SA conditions

| # | Where it is met |
|---|---|
| C-1 | `handleConnectRefund` `acknowledgeLedgerRefusal`: six fields incl. `pgMessage` (300 chars); no branching on the text. Characterisation R-1 asserts both the insert and the update path |
| C-2 | `RefundService.refund()`: both writes check `{ error }`, log, no second write, return per Stripe reply / existing error result. Tests "C-2: …" (two). The P0001-unreachable note is in the success-path comment |
| C-3 | `app/api/payments/blocks/execute/route.ts`: `refund.failed` emitted only when `outcome.code !== 'IN_FLIGHT'`; still throws. No test file (QA manual, §12.6) |
| C-4 | `refundGroup`: `IN_FLIGHT` with `legAmount` set → `budget -= legAmount`. Test "C-4 / Q-SA-7" |
| C-5 | Guard test "every refund-ledger write comes after accountOwns on the payment owner…": every `paymentRefundRepository` call (reads included) has nearest `accountOwns(…, transaction.user_id)`; insert literal inline with `user_id: transaction.user_id`; `applyStripeRefundState` arg 0 is `transaction.user_id`. FU-3 comment now says dispute only |
| C-6 | Tombstone comment above `insertFromStripe` in `handleConnectRefund` |
| C-7 | `updated_at` is required in `StripeRefundStatePatch` and set in every patch (route and `RefundService`); a `@ts-expect-error` test pins it |
| C-8 | Slice-3 tests: `failed` / `canceled` → `PROCESSOR_ERROR`, no activity; pending → `succeeded_at` absent from the patch |
| C-9 | "Stripe refund for an unknown payment" logs `stripeRefundId`, `chargeId`, `paymentIntentId`; characterisation C-9 |

SA optimisation suggestions taken: typed `StripeRefundEvent` union (no `as` cast on the refund); `!isConnectEvent || !connectAccountId` narrowing (no `connectAccountId!` on the new case); the failing-check name is a string-literal union (`UntrustedRowCheck`).

### 12.3 Deviations from the workplan

| # | Deviation | Why |
|---|---|---|
| D-1 | `isTrustedAppRowFor` is named `untrustedAppRowCheck` | It returns the failing check's name or `null`; an `is…` name returning `null` for "trusted" reads backwards |
| D-2 | `findForStripeRefund` also selects `stripe_connect_account_id` (8 columns, FR 13 lists 7) | Q-SA-4 needs it: fill only when NULL, warn when it differs |
| D-3 | `applyStripeRefundState` returns `{ count: number \| null }`. The route treats `!count` (0 or an absent count) as a lost race and throws; `RefundService` logs "webhook already recorded" only on `count === 0` | An unconfirmable update is safest retried; the retry re-reads |
| D-4 | A refund naming neither a charge nor a payment intent is logged at error and acknowledged before the payment lookup | `findFirstByStripeReference` needs one of them; not reachable with Stripe's documented Refund shape |
| D-5 | Sync `failed` / `canceled` reply returns the production-safe message in every environment | There is no Stripe message on a Refund object to show in development |
| D-6 | Also touched, not in §7: `lib/repositories/index.ts` (barrel), `lib/repositories/__tests__/PaymentTransactionRepository.webhook.test.ts` (column string), `docs/REPOSITORY_STRATEGY.md` (described `upsertFromStripe`) | Each would otherwise be stale or fail |
| D-7 | F4-a (i) runs the dispatcher with `[planResolver, createBoostResolver(mock port)]` and asserts `DEFAULT_RESOLVERS` is `[plan, boost]` | Same pattern as the existing R-5 case; the real boost port would load the DB client |
| D-8 | `refundService.test.ts` logger mock now returns one shared `childLog` | So A4-2 / C-2 can assert the info and error lines |
| D-9 | Pre-existing `tsc` errors in `refundService.test.ts` (`connectAccount` missing from the `dbState` type) fixed in slice 3 | Touched file; CLAUDE.md "fix them anyway" |

### 12.4 Snapshot changes (`connectPath.characterisation.test.ts.snap`)

Compared entry by entry with `HEAD`: **99 entries byte-identical, 4 removed, 8 added, 0 changed.**

| Entry | Change | Why |
|---|---|---|
| 7a | Renamed + re-recorded: now claim → complete, no `payment_transactions` read, no `payment_refunds` op | F5-a: the old fixture had an impossible `refunds.data`; `charge.refunded` is a pure no-op (SA-4) |
| X4 | Renamed + re-recorded: platform `charge.refunded` reads and writes nothing | Same (SA-4) |
| X25 | Renamed onto `refund.updated`: one payment lookup, no owner lookup, nothing written | Old arm deleted with `handleChargeRefunded` |
| X26 | Renamed onto `refund.updated`: the ledger insert fails → 500, claim failed | Old upsert arm deleted (SA-6) |
| R1–R4 | New | F5-b, one per new fixture |

### 12.5 Test and type-check results (final state)

- Jest (`app/api/stripe/webhook`, `PaymentRefundRepository`, `PaymentTransactionRepository.webhook`, `paymentTablesWriteLockdownMigration`, `webhookDispatcher`, `refundService`, `stripeRefundLedger`, `cancelPlan`, `cancelQuoteStages`, `--ci`): **24 suites, 837 tests, 107 snapshots passed, exit 0.** Baseline before any change: 22 suites, 641 tests, 103 snapshots, exit 0.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`: exit 2 both before and after (pre-existing errors elsewhere). Total 1,863 → 1,858. **No new error anywhere**; the 5 removed are the pre-existing `refundService.test.ts` ones (D-9). Errors in touched files: 5 → 0.
- ESLint on the 16 touched TS files: 0 errors, 12 warnings, all pre-existing (unused imports, `any`), none in new code.
- `console.*` in touched source files: 0.

### 12.5a SA code review round 1 (CHANGES REQUESTED, 2026-10-14) — fixes

All four belong to **slice 2**. `slice2.patch` was regenerated; `slice3.patch` is unchanged in content and still applies on top. Applied in order to `47175fa5` in a temporary index, the three patches give trees `24be4c12` → `60770b0c` → `8c8df16f`. `8c8df16f` matches every changed or new working-tree file blob for blob.

| # | Fix |
|---|---|
| CR-1 (High) | `nextLedgerRefundStatus`: `failed|false|pending` and `canceled|false|pending` now **apply `pending`** (A-3 amended by SA). A lost-reply `failed` row with no Stripe id that receives `refund.created(pending)` becomes `pending` with the id filled and one booking sync, so a later `succeeded` applies. The 40-case table was updated (2 entries). New characterisation case "CR-1. a lost-reply failed row…" covers both steps. §3.2 bullet updated |
| CR-2 (Low) | Seventh caller added to §5 (`MutateExecutor.ts:688`, chat refund: a chat error, no side effects, no change). QA line in §12.6 |
| CR-3 (Low) | A second 23505 now has its own log line and error message ("Refund row collided twice and cannot be found in this payment"). The F1-g case asserts it |
| CR-4 (nit) | `boostRouting.integration.test.ts` title: "the client payment table is never read" in place of "the legacy refund handler never runs" |

Re-run: Jest same set **24 suites, 838 tests, 107 snapshots, exit 0** (+1 test, no snapshot moved). `tsc`: see Change History.

### 12.6 For QA (manual)

- C-3: an automation refund block whose Stripe reply is `pending` fails the step **without** a `refund.failed` payment event (only `refund.initiated` exists for it).
- CR-2: a Business OS chat refund (`MutateExecutor` `refund`) whose Stripe reply is `pending` shows the processing message as a chat error, and writes no CRM activity, booking change or email.
- G-3 / G-4 / F2-b trigger effect, as in §8.

---

## SA Review Notes

**Reviewed by SA — 2026-10-14** (workplan review, read against `main` @ `3b300f58`)
**Status:** ✅ Approved with conditions. Dev folds C-1..C-9 in while implementing. Nothing here needs a second workplan pass, and SA checks every condition at code review.

### What was checked

| Area | Read | Result |
|---|---|---|
| §14.3 fold-in (requirement) | FR 3 / F1-e (A-1), FR 4 + 13 (A-2), FR 6 (A-3), FR 14 (A-4), FR 7 (A-5, A-7), FR 10 (A-6), §6 (A-8), F5-c (A-9), §11 (A-10), §0 (A-11), §12 (A-12); Q2 re-worded in §9 | ✅ All twelve folded in as ruled. No second requirement pass |
| SA-8 live DB | §2.1, plus U-1..U-3 run read-only 2026-10-14 (§2.2) | ✅ Match. T-0b done |
| Guard SQL | `20260828b_payment_refund_ledger.sql:115-157` | Matches U-3. P0001 fires in three cases, and the guard adds `NEW.amount` **whatever `NEW.status` is**. It fires on `INSERT` and on `UPDATE OF amount, status, currency`. Other triggers in the chain (`recompute_…`, `propagate_…`, `trg_transaction_events`) contain no `RAISE` in the migrations |
| Rule 1 (repositories) | §3.2 repo methods, A-4 | ✅ Every new DB access goes through `PaymentRefundRepository` / `PaymentRepository`. The two `RefundService` writes move behind the repository. The other direct queries stay flagged (§11) |
| Rule 2 (Zod) | Route input | ✅ No new HTTP surface. The payload is a signature-verified Stripe event in the route's existing pattern. The one caller-controlled field, `metadata.refund_row_id`, is shape-checked (`isUuidShaped`) and then scope-checked (A-1). No Zod schema is owed |
| Rule 3 (Pino) | Route, `RefundService.ts` | ✅ 0 `console.*` in either. Logging uses the per-request `log`, and metadata values are never logged |
| Rule 4 (`user_id`) | 3 repo methods | ✅ Met literally: `user_id` + `transaction_id` on every query. The `⟨unscoped-by-design⟩` header goes, and nothing new is exempted. `findFirstByStripeReference` keeps its existing documented exemption, and `accountOwns` then proves the owner |
| Rule 5 (models) | — | N/A |
| Rule 6 (types) | §3.2 | ✅ Closed `NewWebhookRefundRow` / `StripeRefundStatePatch`, `@ts-expect-error` tests. Two casts to tidy (Optimisation Suggestions) |
| `tenant-isolation-guard` | §4 against the skill checklist | ✅ All eight checklist items addressed. The caller-supplied id is read inside the proven payment. There is no upsert. The triggers only reach the proven payment |
| `routerPlacement` guard | `routerPlacement.guard.test.ts:373-460` | ✅ The approach fits. **C-5:** the `OWNER_PROVED` loop needs its own refund branch |
| PostgREST update + `.or()` + `.select()` | `applyStripeRefundState`, `insertFromStripe` | ✅ No `.or()`, no `.select()` on the update, `{ count: 'exact' }`. The insert has no `.select()`. Reads (a) and (b) are separate `.eq` chains |
| No added CI time | §8 | ✅ No workflow or gate change. One new unit-test file inside the existing Jest job (well under 1 s) |
| Entitlements | §7 | N/A: no import from `lib/business-os/entitlements/` |
| Concurrency | CAS + guard `FOR UPDATE` | ✅ Under READ COMMITTED, a second concurrent CAS re-evaluates `status = expected` after the first commits, matches 0 rows, throws, and the retry re-reads. Concurrent inserts collide on either unique index (23505), which leads to a re-read |

### Rulings on §10

| # | Ruling |
|---|---|
| **Q-SA-0** | **Closed.** The user's session ran §2.3 read-only against prod. U-1..U-3 match (§2.2), and T-0b is done. |
| **Q-SA-1** | **Keep as built** (intent if present, otherwise charge; no fallback). FR 2 says "the same lookup", the dispute path shares it, and a fallback would change a shared method. **C-9:** the "no payment found" `log.error` carries both `chargeId` and `paymentIntentId`, so a miss can be diagnosed. A fallback is a follow-up only if G-3 or prod shows a miss. |
| **Q-SA-2** | **Approved.** `lib/payments/stripeRefundLedger.ts` sits beside the writer (`RefundService.ts`) in the same directory, so it satisfies FR 15. Keeping it a leaf is a valid reason, and `ownedLinkId.ts` (which it imports `isUuidShaped` from) has no imports either. Keep it a leaf: no repository, Stripe or Supabase import, ever. |
| **Q-SA-3** | **Approved: acknowledge, `log.warn`, write nothing.** Recording `pending` on a guess would hold guard budget. A later `refund.updated` carries a real status. Log the raw status value (a Stripe enum, not metadata). |
| **Q-SA-4** | **Approved: fill `stripe_connect_account_id` only when the row's value is NULL; never overwrite.** The payment-level check (A-5) has already proven `event.account`. If a matched row holds a different non-NULL value, `log.warn` (ids only) and leave it. That should not happen, because app rows take the account from the same payment. |
| **Q-SA-5** | **Approved: a synchronous `failed` / `canceled` reply returns `PROCESSOR_ERROR`** with the existing production-safe message, and records no activity. Today's `ok: true` sends a "refunded" email and records activity for money that did not move. That is the same defect class as slice 3, in the same lines. `PROCESSOR_ERROR` is an existing code that every caller already handles. Add it to S3-1's test cases. |
| **Q-SA-6** | **In scope, minimal (C-3). This overrides Dev's flag-only proposal.** S3-2 says callers fire **no** side effects on `IN_FLIGHT`. Emitting `refund.failed` for money that is about to move is a side effect and a false business event. Slice 3 turns it from a crash-orphan rarity into every pending Stripe reply. Change: in `app/api/payments/blocks/execute/route.ts`, skip the `refund.failed` emit when `outcome.code === 'IN_FLIGHT'`, and still `throw` so the step reports "not done". One condition. That route has no test file, so it is covered by code review plus a QA manual note. Do **not** add a new test file for it. |
| **Q-SA-7** | **In scope, minimal (C-4). This overrides Dev's flag-only proposal.** Before slice 3, a pending reply returned `ok: true` and **was** subtracted from `budget`. Slice 3 removes that, so it creates a real over-cap refund path in `cancelPlan`. The DB guard bounds each payment, not the plan cap. Change: in `refundGroup`, when a leg returns `IN_FLIGHT` and `legAmount !== undefined`, do `budget -= legAmount`. For money, err toward refunding less: the owner can top up, but cannot take back. Test: one case in the existing `refundGroup` describe in `refundService.test.ts`. |
| **Q-SA-8** | **Approved: new co-located file `lib/payments/__tests__/stripeRefundLedger.test.ts`.** It is a unit test for a new module, not a guard or a gate. It runs in the existing Jest job and adds well under a second. The 40-case table belongs with the module, not inside `refundService.test.ts`. |
| **Q-SA-9** | **Accept the insert (keep a first-seen `failed` / `canceled` row).** One more reason beyond Dev's: the row is the **tombstone** that turns a late `refund.created(pending)` into a no-op. Skipping the insert would let that late pending event insert a `pending` row that holds guard budget for a refund that is already dead. The rare P0001 on a fully refunded payment is acknowledged with an alert (C-1), and the refund changes no money. |
| **Q-SA-10** | **Confirmed in this PR.** `moneyRowsRepository.qa.test.ts` and `boostRouting.integration.test.ts` pin the deleted behaviour. They are existing files in the existing job, so updating them adds no CI. Rename the `boostRouting` cases to say what is now true (no legacy refund read), and don't just flip the boolean. |

**Ruling on the P0001 ambiguity (U-3: three causes).** **Acceptable to acknowledge all three. The handler must not branch on the message text.** All three are deterministic for the same inputs, so a retry cannot succeed:
- (i) cannot normally happen: the handler has just read the transaction, the guard locks it, and the FK is `RESTRICT`.
- (ii) means Stripe and our payment row disagree on currency, which is a data defect.
- (iii) is the over-refund that SA-7 was written for.

Acknowledge + alert is right for all three, but the alert must let an operator tell them apart. Hence **C-1**. Parsing the SQL message to decide behaviour would tie the route to the wording of a SQL function, so it is not allowed. The same ruling covers P0001 raised by the **CAS update** (the guard fires on `UPDATE OF status`), which the workplan already routes to the same acknowledge. The likely real case is a `failed` (no Stripe id) → `succeeded` update on a payment the owner has since refunded again. The alert is exactly the "ledger and Stripe disagree" signal.

### Conditions (fold in while implementing; checked at code review)

| # | Where | Condition |
|---|---|---|
| C-1 | §3.2 step 7, R-1 | The alert log gains **`pgMessage`** (PostgREST `error.message`, truncated to 300 chars), so it carries six fields: `alert, eventId, stripeRefundId, transactionId, pgCode, pgMessage`. Server-side log only. The message holds amounts, a currency and the transaction id, with no PII or secrets. Never branch on it. R-1 asserts the field on both the insert and the update path |
| C-2 | §3.2 A-4 | **Handle the `{ error }` that `applyStripeRefundState` returns in `RefundService`.** On the success path: `log.error({ err, refundId })`, no second write, and return per Stripe's reply. The row stays `pending` with a NULL id, and the webhook fills it through `refund_row_id` (slice 1). That is why the write must not throw. On the catch path: `log.error` and return the existing error result. Today the success write's error is silently dropped (:1087). One test per path. Also state in the code comment that a P0001 here should be unreachable (a `pending` row already holds its budget), and that it is logged rather than mapped |
| C-3 | §5 caller 6, §7, §9 | Q-SA-6: skip `emitPaymentEvent('refund.failed')` on `IN_FLIGHT` in `app/api/payments/blocks/execute/route.ts`. Add the file to §7 (slice 3) and a task T-3.5. Record it in the QA manual check. No new test file |
| C-4 | §5 caller 5, §7, §9 | Q-SA-7: in `refundGroup`, take an `IN_FLIGHT` leg's `legAmount` off `budget` when `maxTotal` is set. Test in `refundService.test.ts` (`refundGroup` describe). Add a task T-3.6 |
| C-5 | T-2.11 | The existing `OWNER_PROVED` loop selects only `paymentTransactionRepository` writes and asserts `writes.length > 0`, so adding `handleConnectRefund` to that map would fail. Add a **refund branch**: receiver `paymentRefundRepository`, writes `insertFromStripe` / `applyStripeRefundState`. For each write, the nearest earlier `accountOwns(…)` has 2nd argument `transaction.user_id`. The insert's **inline** object literal has `user_id: transaction.user_id`, so the literal must be passed inline and not through a variable, or the guard cannot read it. `applyStripeRefundState`'s `arguments[0]` text is `transaction.user_id`. Update the "dispute and refund writes… (FU-3)" comment to say dispute only |
| C-6 | §3.2 step 6 | Record the Q-SA-9 tombstone reason in a code comment beside the insert of a non-`pending` status, so a later reader does not "optimise" it away |
| C-7 | §3.2 step 6, match branch | When the computed patch has no `status` but has `processor_refund_id` (an id-only fill), the guard does not fire (it is not `UPDATE OF status`), so the patch's `updated_at` is the only source. Keep `updated_at` in every patch. On status updates the guard overwrites it with `NOW()`, which is harmless |
| C-8 | §8, slice 3 | Add to S3-1's tests: a synchronous `failed` / `canceled` reply → `PROCESSOR_ERROR`, no `recordRefundActivity()` (Q-SA-5). And the pending-reply `IN_FLIGHT` leaves `succeeded_at` **absent from the patch**, not set to null over a webhook value |
| C-9 | §3.2 step 3 | "No payment found" `log.error` includes both `chargeId` and `paymentIntentId` (Q-SA-1) |

### Optimisation Suggestions (non-blocking)

- Type `handleConnectRefund`'s `event` as `Stripe.RefundCreatedEvent | Stripe.RefundUpdatedEvent | Stripe.RefundFailedEvent` (SDK 19.2.1 exports them), so `event.data.object` is a `Stripe.Refund` with no `as` cast.
- Avoid `connectAccountId!`. Narrow with a guard (`if (!isConnectEvent || !connectAccountId)`) so the type follows the check.
- `isTrustedAppRowFor` returning the failing check's name is good. Make the return a string-literal union, not `string`, so the warn log's `check` values are a closed set.
- In the characterisation harness, assert that the `.snap` diff moves only the rewritten cases (as §8 already says). Mention in the PR body which snapshots moved.

### Code Review Readiness

At code review SA will walk C-1..C-9, the `tenant-isolation-guard` checklist (§4) and the `new-repository` checklist for the three methods (client injection, `RepositoryResult` shape, `user_id` filter, one unit test each). SA will also grep the diff for `upsert`, `onConflict`, `.or(` and `from('payment_refunds')` outside the repository.

### Approval

[x] Workplan approved, conditional on C-1..C-9 being folded in during implementation. Proceed once RM has created `fix/stripe-connect-refund-webhook` (T-0a). The user decisions stand: Q1 = leave, Q2 = (a) with slice 3 in scope and no confirm-time email, Q3 = keep.

---

**Code Review by SA — 2026-10-14** (uncommitted tree on `fix/stripe-connect-refund-webhook`, base `origin/main` @ `47175fa5`)
**Status:** 🔄 Fix Required. There is one High finding (CR-1). It is small and contained. Everything else is approved. SA re-reviews only the CR-1 delta, with no full second pass.

### What was verified, in the code

| Area | Result |
|---|---|
| Tenant isolation (`handleConnectRefund`, `route.ts:531`) | ✅ The order is status map → payment lookup (an error throws) → `accountOwns(connectAccountId, transaction.user_id)` → a non-NULL stored `stripe_connect_account_id` must equal `event.account` (NULL gets a warn) → only then any ledger read or write. A refusal logs at error and returns: no ledger op and no sync. The insert's `user_id` / `transaction_id` / `invoice_id` come from the proven payment row, and `stripe_connect_account_id` = `event.account` |
| Repository scoping (`PaymentRefundRepository.ts:155-228`) | ✅ Read (a) is `user_id` + `transaction_id` + `processor_refund_id`. Read (b) is `id` + `transaction_id` + `user_id`, and runs only when (a) misses. The CAS is `id` + `transaction_id` + `user_id` + `status`, plus `.is`/`.eq` on `processor_refund_id`. The insert takes the closed `NewWebhookRefundRow`. The `⟨unscoped-by-design⟩` header is gone and no new exemption was added |
| A-1 metadata trust | ✅ `vetLedgerRowIdCandidate` reuses `isUuidShaped` and logs only the length. The row id is read only inside the proven payment. `untrustedAppRowCheck` checks source, processor_type, amount_minor, currency (case-insensitive, and a null refund currency fails) and processor id. The warn carries the check name and ids, never the value. On a failed check the code falls through to (c) |
| A-3 table + CAS | ✅ `nextLedgerRefundStatus` matches A-3 as written (40-case table). The CAS `expected` is the row as read. When the count is 0 or absent, the code throws, the retry re-reads, and a booking sync happens only on an applied status change. **But A-3 as written has a hole, see CR-1** |
| A-4 app writes | ✅ Both post-reply writes go through `applyStripeRefundState` with `{ pending, null }`. Only `stripe.refunds.create` is inside the `try`, so the success write and `recordRefundActivity()` (fire-and-forget) can no longer reach the catch. Count 0 logs at info and keeps the webhook's state. Errors are logged and not thrown (C-2) |
| P0001 | ✅ Both paths (CAS `route.ts:701`, insert `route.ts:777`) go to `acknowledgeLedgerRefusal`, which writes one `alert: true` error with six fields and does not branch on the message. Every other code throws. R-1 tests cover both |
| Platform `refund.*` | ✅ The router block (`dispatchBusinessOsEvent` inside `if (!isConnectEvent)`) is unchanged. The F4-a dispatcher test proves the default resolvers answer `not_business_os` with zero boost reads. The switch case logs and breaks on `!isConnectEvent \|\| !connectAccountId` |
| `routerPlacement` guard | ✅ Not weakened. `MONEY_ROW_CALLS` is still exact per function and in total (the new handler has 1 + 3 call sites). The existing `OWNER_PROVED` loop is unchanged. The new C-5 test covers every `paymentRefundRepository` call, reads included: each must come after `accountOwns(…, transaction.user_id)`, the insert literal must be inline with `user_id: transaction.user_id`, and the CAS argument 0 must be `transaction.user_id`. The FU-3 comment now says dispute only. The router-placement assertions are untouched |
| PostgREST hazard | ✅ No `.or()` anywhere, no `.select()` on the update or the insert, and `{ count: 'exact' }` is used. A repository source-shape test pins this |
| Snapshots | ✅ SA compared them independently against `HEAD` by loading both `.snap` files. Of 103 → 107 entries: **99 identical, 0 changed, 4 removed (7a, X4, X25, X26 old names), 8 added (7a/X4/X25/X26 new names + R1–R4)** |
| Fixtures | ✅ The four `refund-*` files and the replaced `charge-refunded.json` use only real Refund/Event fields for `2025-10-29.clover` (`pending_reason: processing` and `failure_reason: expired_or_canceled_card` are valid enums). The Charge has no `refunds` key, and all fixtures are `livemode: false` with `account` set. They are a subset of a real payload, derived from the reference rather than captured. That meets A-9 as stated in §6 |
| Scratchpad slice patches | ✅ In a throwaway `git worktree add --detach` at `47175fa5`, `slice1` → `slice2` → `slice3` each passed `git apply --check` and applied in order. All **23** resulting files are blob-identical (`git hash-object`) to this worktree, with no extra file. Slice 1 touches only `RefundService.ts`, its test and the leaf constant. Slice 3 touches only `RefundService.ts`, its test and the blocks route. The scratch worktree had no `node_modules` junction and has been removed. This worktree and its index were not touched |
| Rules 1–6 | ✅ Rule 1: the new access is via repositories, and the two remaining direct `payment_refunds` queries in `RefundService` (insert :873, replay read :932) are pre-existing and flagged in §11. Rule 2: no new HTTP surface (signature-verified event), and the metadata id is shape- and scope-checked. Rule 3: `console.*` count is 0 in all 7 touched source files. Rule 4: met literally. Rule 5: N/A. Rule 6: the patch and insert row types are closed with `@ts-expect-error` pins, there is no new `any`, and the refund event union replaces the cast |

### Conditions C-1..C-9 and Q-SA-6 / Q-SA-7

| # | Verdict | Where |
|---|---|---|
| C-1 | ✅ | `acknowledgeLedgerRefusal` adds `pgMessage` (300 chars), giving six fields, with no branching on the message. R-1 covers the insert and the update |
| C-2 | ✅ | `RefundService.ts` catch and success writes check `{ error }`, log it and do not write again. The answer follows Stripe or the existing error. The P0001 note is in the success-path comment |
| C-3 / Q-SA-6 | ✅ | `blocks/execute/route.ts:331-341`: there is no `refund.failed` emit on `IN_FLIGHT`, and the step still throws. QA manual note in §12.6 |
| C-4 / Q-SA-7 | ✅ | `refundGroup` takes `budget -= legAmount` on `IN_FLIGHT` under a cap, with a test |
| C-5 | ✅ | See the guard row above |
| C-6 | ✅ | Tombstone comment above the insert |
| C-7 | ✅ | `updated_at` is required in `StripeRefundStatePatch` and set in every patch, pinned by `@ts-expect-error` |
| C-8 | ✅ | `failed` / `canceled` → `PROCESSOR_ERROR` with no activity. `succeeded_at` is absent from a pending patch |
| C-9 | ✅ | The "unknown payment" error carries `stripeRefundId`, `chargeId`, `paymentIntentId` |

### Deviations D-1..D-9

| # | Ruling |
|---|---|
| D-1 | ✅ Accepted. `untrustedAppRowCheck` returning the failing name or `null` reads correctly |
| D-2 | ✅ Accepted. The 8th column is what Q-SA-4 needs, and A-2's list is amended by that ruling |
| D-3 | ✅ Accepted. A `null` count is retried rather than trusted. With `{ count: 'exact' }`, PostgREST always returns one, so this is a defensive branch only |
| D-4 | ✅ Accepted. It is unreachable with Stripe's documented shape and fails loud |
| D-5 | ✅ Accepted. A Refund has no message to surface |
| D-6 | ✅ Accepted. Each of the three files would otherwise be stale or red |
| D-7 | ✅ Accepted. Same pattern as R-5, and the real boost port would load the DB client |
| D-8 | ✅ Accepted. Test-only |
| D-9 | ✅ Accepted. This is the "fix them anyway" rule applied to a touched file |

### Code Review Comments

1. **CR-1: `route.ts:673` with `stripeRefundLedger.ts:89-91`. A pending event can lock a lost-reply row at `failed` for good.** Priority: **High**
   Sequence: the app's catch path writes `failed` with **no** Stripe id (the lost-reply or connection-reset case that A-4 / SA-5 exist for), but Stripe did create the refund. Then `refund.created` arrives with `status: pending` (any slower refund method), matched by `refund_row_id`. `nextLedgerRefundStatus('failed', false, 'pending')` returns a no-op, **but line 673 fills `processor_refund_id` anyway**, as A-3's "a no-op still records a missing id" says. The row is now `failed` **with** a Stripe id. When `refund.updated(succeeded)` arrives, `('failed', true, 'succeeded')` is a no-op. The money has left and the books say `failed`. The guard also no longer counts that refund, so the owner can refund the same money again. This is the exact worst case A-4 names, reached by a different door. Nothing tests it: the SA-5 case only covers `succeeded` arriving directly.
   The root cause is in SA's own A-3 table: "has a Stripe id" stands in for "Stripe has given a verdict", and the id fill on a `pending` no-op breaks that stand-in. **Ruling (amends A-3):** a row in `failed` / `canceled` with **no** `processor_refund_id` has never had a Stripe verdict, so an incoming `pending` **applies `pending`** to it, under the same rule SA-5 uses for `succeeded`. Change `'failed|false|pending'` and `'canceled|false|pending'` to `apply pending` in `nextLedgerRefundStatus` and in the 40-case table. The id fill then happens with the status move, so the later `succeeded` applies from `pending` as normal. If the owner has refunded again in the meantime, the `UPDATE OF status` raises P0001, and C-1's alert is the correct "Stripe and the ledger disagree" signal. Add one characterisation case: a lost-reply `failed` row with a NULL id, then `refund-created.json` (pending), gives status `pending` with the id filled and one sync. Then a `succeeded` event on that row gives `succeeded`. Not acceptable: only skipping the id fill. That leaves the row `failed`, so the guard does not count the money while it is in flight.
2. **CR-2: §5 misses a seventh caller of `refund()`: `lib/business-os/bizql/mutate/MutateExecutor.ts:688`** (the chat `refund` mutation). Priority: Low. Its behaviour is acceptable without a code change: any `!ok` becomes `{ error: new Error(result.message) }`, so `IN_FLIGHT` shows the "still processing, do not refund again" text and `PROCESSOR_ERROR` shows the existing safe message, with no side effects. Add the row to §5 and a QA manual line (one chat refund with a pending Stripe reply).
3. **CR-3: `route.ts:771-781`. A 23505 caused by a row in a *different* payment cannot be resolved.** Priority: Low, no change required. If the unique `processor_refund_id` / `idempotency_key` already belongs to a row under another transaction (for example, `findFirstByStripeReference`'s unordered `limit(1)` picks a different payment row for the same intent), the scoped re-read misses on both passes. The handler then answers 500 on every retry until Stripe gives up. This fails safe (no wrong write) and loud (error log every attempt), which is right for a data defect. It is recorded here so a run of 500s on one refund id is recognisable. Optional: a distinct message on the pass-2 throw ("unique key held outside this payment").
4. **CR-4: `boostRouting.integration.test.ts:369`. The test title still says "the legacy refund handler never runs".** Priority: Low (nit). Q-SA-10 asked for names that say what is now true. Fix it with CR-1 if convenient.

### Optimisation Suggestions

- None blocking. The PR body should list the moved snapshots (7a, X4, X25, X26 renamed and re-recorded; R1–R4 added), as the workplan review asked.

### Code Approved for QA: No (conditional)

Approved for QA **once CR-1 is fixed** as ruled above, with its table rows and one characterisation case. SA re-checks only that delta. CR-2 is a doc row plus a QA line. CR-3 and CR-4 are optional. The slice map does not change: CR-1 belongs in slice 2 (`stripeRefundLedger.ts` + its test + the characterisation test), so RM must regenerate `slice2.patch` (and re-check that `slice3.patch` still applies on top), or fold the fix into commit 2 another way.

**Code Review by SA, round 2 (CR delta only): 2026-10-14**
**Status:** ✅ Code Approved

### Delta verified

The pre-fix copies of the touched files (from Dev's scratch `precr/`) were diffed against the working tree, so this check is limited to the delta.

| # | Verdict |
|---|---|
| CR-1 | ✅ Fixed as ruled. `nextLedgerRefundStatus` applies `pending` from `failed` / `canceled` only when `!hasStripeId`, and the docblock table and comment are updated. The 40-case `EXPECTED` map differs from round 1 in exactly `failed\|false\|pending` and `canceled\|false\|pending`, and no other transition moved. SA ran `stripeRefundLedger.test.ts` (72/72 pass). The characterisation case "CR-1. a lost-reply failed row…" asserts three things. Step 1: the exact patch `{ status: 'pending', processor_refund_id: 're_connect_1' }` under CAS `status = failed AND processor_refund_id IS NULL`, with exactly one booking sync. Step 2: `succeeded` from `pending` with the id, setting `succeeded_at`, with one sync. The route's apply path is unchanged; only the table moved |
| CR-2 | ✅ §5 row 7 (`MutateExecutor.ts:688`) and the §12.6 QA line are present |
| CR-3 | ✅ A second 23505 throws with its own log line and error ("Refund row collided twice and cannot be found in this payment"). F1-g asserts the message. The new branch sits before the P0001 check and changes no other path |
| CR-4 | ✅ The `boostRouting` title now reads "the client payment table is never read" |
| Snapshots | ✅ No change since round 1: the `.snap` file is byte-identical to SA's round-1 copy (107 entries). The CR-1 case asserts explicitly and records no snapshot, so there are no additions to expect. `--ci` run: 107 snapshots pass, none written or obsolete |
| Slice patches | ✅ `slice1/2/3.patch` (19:04) applied in order to a throwaway detached worktree at `47175fa5`, with no `node_modules`, removed afterwards. All three apply. All 23 code and test files are blob-identical to this worktree, and the status lists match. The only files not covered are the three docs (requirement, RCA, workplan), which the slices leave out on purpose, as in round 1 |
| Regression | ✅ The touched suites (`lib/payments`, `app/api/stripe/webhook`, `app/api/payments`, the two refund/transaction repository tests, `webhookDispatcher`) ran with `--ci`: 74 suites, 1,606 tests, 107 snapshots, all passing |

### Optimisation Suggestions (non-blocking)

- When `failed` → `pending` (CR-1) or `failed` → `succeeded` (SA-5) is applied, `failure_code` / `failure_message` from the catch path are left in place. The status is right and the guard counts the money. Only a stale reason remains on a row that is no longer failed. This is a candidate follow-up: clear them on any move out of `failed`. Not required for this PR.

### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-14** (uncommitted tree on `fix/stripe-connect-refund-webhook`, base `47175fa5`)
**Test mode:** full
**Strategy used:** A + B (Jest unit + mocked-Supabase integration / characterisation harness), plus a source review (Option D substitute) of the two §12.6 manual paths. No live run: there is no Connect platform Stripe key locally, and prod must not be written. Live checks are in the post-deploy checklist below.
**Focus:** api, security, schema (the webhook, the refund ledger repository, `RefundService`, the automation and chat callers)
**Skipped:** live end-to-end (G-3, G-4, F2-b trigger effect). These are post-deploy manual checks.
**Input source:** prompt keywords (TL trigger) + workplan §8 / §12.6

### Test runs

| Run | Result |
|---|---|
| Full `npx jest --ci` from this worktree (the same as `npm test`) | All **1,345** suite files resolved under `.claude/worktrees/distracted-sammet-74b018/`, so it ran this worktree's tests and not the main checkout's. Run 2: **1,321 passed, 16 failed, 8 skipped suites; 32,440 passed, 130 failed, 65 skipped tests; 144 snapshots passed; exit 1.** Run 1: 19 failed suites, 133 failed tests, also exit 1; the extra 3 were timing flakes. |
| The 16 failing suites | **None is related to this change**, and none imports or reads a touched file. **11 are on the CI quarantine list** (`.github/ci/jest-quarantine.json`: v4/v6/pilot/orchestration). The **other 5 are Windows-local artefacts**: `publicEndpointsAreThrottled.guard` (backslash paths), `bookingsSearchAndPaging.guard` and `finance.source.guard` DF-5 (CRLF in the read source), `oneAddressPolicy.guard` (path match), and `supabaseFetch` (NODE_ENV-dependent ceiling, 20000 vs 60000). Every file they read is untouched by this diff. No clean `origin/main` run was made: a second checkout would need another `node_modules` junction (the junction hazard). |
| Targeted set (`app/api/stripe/webhook`, `PaymentRefundRepository`, `PaymentTransactionRepository.webhook`, `paymentTablesWriteLockdownMigration`, `webhookDispatcher`, `lib/payments/__tests__`) | **72 suites, 1,620 tests, 107 snapshots, all passed, exit 0** (before the QA guard was added) |
| `refundService.test.ts` + `stripeRefundLedger.test.ts` after the QA addition | 2 suites, **128/128** passed |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` | tsc's own exit code is **2** (errors already present elsewhere). **1,858** errors in total, the same as Dev's post-change count, and **0 errors in the 16 touched TS files** (including QA's test edit). No new errors |

### Static checks

| Check | Result |
|---|---|
| `console.*` in touched source (route, blocks route, `RefundService`, `stripeRefundLedger`, `PaymentRefundRepository`, `PaymentRepository`, repositories `index`) | 0 in all 7 |
| `.or(` / `.select(` on the new update | None. `applyStripeRefundState` is `.update(patch, { count: 'exact' })` + `.eq`×4 + `.is`/`.eq`. The only `.select(` calls are the two reads in `findForStripeRefund`. No `upsert` / `onConflict` |
| Direct Supabase added outside repositories | None. In app/lib source, every added line naming `supabase`/`.from(` is in a snapshot. The two `RefundService` `supabaseServer.update` calls on `payment_refunds` were **removed** and now go through the repository |
| Entitlements | Not applicable: no import from `lib/business-os/entitlements/` |

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes (test that proves it) |
|---|---|---|---|
| S1-1 metadata carries only `refund_row_id` | ✅ | Pass | `refundService` "S1-1" |
| S1-2 nothing else in the call changes | ✅ | Pass | "S1-2" + existing Stripe-call suite |
| S1-3 manual refunds make no Stripe call | ✅ | Pass | "S1-3" + "money returned by hand" |
| F1-a app row with NULL id + `refund.created` first (race) | ✅ | Pass | Characterisation R1: found by `refund_row_id`, patch is exactly `{processor_refund_id, updated_at}`, no insert, no sync. App side: `refundService` "A4-2 … success path, count 0 keeps the webhook state" |
| F1-b matched on Stripe id | ✅ | Pass | R3 |
| F1-c app columns kept | ✅ | Pass | "F1-c" |
| F1-d dashboard refund → one `webhook` row; redelivery adds none | ✅ | Pass | R2 (**happy path**: one insert, `source='webhook'`, `idempotency_key`, our metadata only, one booking sync); "F1-d. redelivering…" |
| F1-e forged / untrusted `refund_row_id` (6 cases + non-UUID + no value in logs) | ✅ | Pass | "F1-e" `it.each` + 2 cases; `stripeRefundLedger` `untrustedAppRowCheck` / `vetLedgerRowIdCandidate` |
| F1-f scoped (b) read | ✅ | Pass | `PaymentRefundRepository` "(b) by the metadata row id…" |
| F1-g 23505 → re-read → apply; re-read null → 500 | ✅ | Pass | Two "F1-g" cases (the second asserts the CR-3 message) |
| F2-a status mapping | ✅ | Pass | `stripeRefundLedger` `mapStripeRefundStatus` (incl. null/unknown) |
| F2-b `failed` on pending/succeeded; `refunded_amount` drops back | ⚠️ | Partial | Row status: R4 (succeeded→failed) + ledger table (pending→failed). **Trigger effect: post-deploy manual** |
| F2-c out-of-order (pending after succeeded) | ✅ | Pass | "F2-c / T-3": nothing written, no sync |
| F2-d exhaustive transitions (40) | ✅ | Pass | `stripeRefundLedger` 40-case table (incl. CR-1 rows) |
| F2-e CAS filters; count 0 → 500 | ✅ | Pass | Repo "applyStripeRefundState" cases + route "F2-e…race lost" |
| F2-f / T-2 closed patch type | ✅ | Pass | `@ts-expect-error` cases (compiled by ts-jest; `tsc` clean on the file); R1 asserts the exact patch keys (no `created_at`) |
| R-1 P0001 acknowledged with an alert (insert and update) | ✅ | Pass | Two "R-1" cases: 200, claim completed, one `alert: true` log with six fields |
| R-2 other error → 500 | ✅ | Pass | "R-2", X26, `moneyRowsRepository` E3/E4 |
| T-1 `created_at` = Stripe refund time | ✅ | Pass | R2 literal |
| T-3 `succeeded_at` from the moving event; never overwritten | ✅ | Pass | R3, "T-3. a redelivered succeeded…" |
| A4-1 both post-reply writes via CAS `{pending, null}` | ✅ | Pass | Two "A4-1" cases |
| A4-2 count 0 keeps the webhook state (lost reply ≠ failed) | ✅ | Pass | Two "A4-2" cases; C-2 error paths (two) |
| F3-a tenant mismatch (owner) | ✅ | Pass | "F3-a": no ledger read or write, no sync, 200; `moneyRowsRepository` "E (A-5…)" |
| F3-c stored account ≠ event account; NULL → recorded + warn | ✅ | Pass | Two "F3-c" cases |
| F3-d owner read error → 500 | ✅ | Pass | "F3-d" |
| F3-e row owner/links from the payment | ✅ | Pass | R2, `moneyRowsRepository` "E: the ledger row carries…" |
| F3-f column widened | ✅ | Pass | `PaymentTransactionRepository.webhook` column string; F3-c depends on it; `tsc` |
| F3-b guard / OWNER_PROVED | ✅ | Pass | `routerPlacement.guard` "every refund-ledger write comes after accountOwns…" (C-5) |
| F4-a platform `refund.*` ignored | ✅ | Pass | (i) `webhookDispatcher` "platform refund.* events are not Business OS"; (ii) route "F4-a. platform %s" ×3 |
| F4-b Connect never routed | ✅ | Pass | Existing router-placement assertion green |
| F4-c `charge.refund.updated` unhandled | ✅ | Pass | "F4-c" |
| F5-a `charge.refunded` no-op; handler gone | ✅ | Pass | 7a, X4 snapshots; `MONEY_ROW_CALLS` |
| F5-b four `refund.*` fixtures | ✅ | Pass | R1–R4 snapshots |
| F5-c fixture source | ✅ | Pass (doc) | §6 states the source (API reference + SDK 19.2.1 types); SA confirmed the fields |
| G-1 sync on applied change only | ✅ | Pass | R2, R4, CR-1 (sync once); F2-c, R1 (no sync) |
| G-2 ledger write/read error → 500 | ✅ | Pass | "G-2", X26 |
| G-3 dashboard refund lands (live) | ❌ | Not run | Post-deploy manual (checklist below) |
| G-4 app refund → one `app` row + `refund_row_id` on Stripe (live) | ❌ | Not run | Post-deploy manual |
| G-5 no upsert | ✅ | Pass | Repo "upsertFromStripe is gone" + source-shape test; grep |
| S3-1 Stripe's real status recorded | ✅ | Pass | Slice-3 `it.each(pending, requires_action)`, null/unknown → pending, succeeded, failed, canceled |
| S3-2 `IN_FLIGHT` / `PROCESSOR_ERROR`, no side effects | ✅ | Pass | The same cases assert the processing message, no `succeeded_at`, no CRM activity |
| Unknown payment | ✅ | Pass | X25, "C-9…logs both the charge and the intent" |
| CR-1 lost-reply sequence (failed, NULL id → pending → succeeded) | ✅ | Pass | "CR-1. a lost-reply failed row…" + "SA-5" (failed → succeeded directly) |
| C-4 `refundGroup` cap with a pending leg | ✅ | Pass | "C-4 / Q-SA-7" (Stripe amounts 10000 then 5000 against a cap of 150) |
| C-3 automation block: no `refund.failed` on `IN_FLIGHT` | ✅ | Pass (source guard) | **Added by QA**: `refundService.test.ts` "C-3 / Q-SA-6 (source guard)…". It fails against `HEAD` (base has no `IN_FLIGHT` exclusion). Behaviour is not exercised: the route pulls in the whole kernel, and SA ruled out a new test file |
| CR-2 chat refund (`MutateExecutor`) on `IN_FLIGHT` / `PROCESSOR_ERROR` | ⚠️ | Pass (source review) | See manual review below |

### Manual / source review (§12.6)

- **C-3, automation refund block** (`app/api/payments/blocks/execute/route.ts:330-343`). On `!outcome.ok`, `refund.failed` is emitted only when `outcome.code !== 'IN_FLIGHT'`, and `throw new Error(outcome.message)` is unconditional. `refund.initiated` (emitted before the call) is unchanged. A retry of the step reuses `execution_id` as `clientRequestId`, so it replays (23505), gets `IN_FLIGHT` again, and does not refund twice. `PROCESSOR_ERROR` (a synchronous `failed` / `canceled`) still emits `refund.failed`, which is correct.
- **CR-2, chat refund** (`lib/business-os/bizql/mutate/MutateExecutor.ts:685-701`). `!result.ok` returns `{ error: new Error(result.message) }`. `executeMutate` (`:2208-2216`) logs "Write failed" and **throws before "Write applied"**, so no follow-up runs. `applyWrites.ts:114-121` marks the write-log entry `failed` and rethrows. `refund()` itself writes no CRM activity, booking or email on `IN_FLIGHT` / `PROCESSOR_ERROR` (slice-3 tests). **Not verified:** the exact text the chat UI renders for a thrown write error. That needs one live chat refund (checklist item 6).

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The webhook adds at most 2 reads + 1 write per event, and a re-read only on a 23505.

#### Edge Cases (nice to fix / follow-up)
1. **Stale failure reason after leaving `failed`** (`route.ts` match branch, `RefundService` catch write). This is SA's round-2 note. After CR-1 (`failed` → `pending`) or SA-5 (`failed` → `succeeded`), `failure_code` / `failure_message` from the catch path stay on the row. Status and money are right. Low.
2. **Transient `pending` after an app refund that succeeded** (by design, A4-2). If `refund.created(pending)` fills the Stripe id before Stripe's synchronous reply is written, the app's write gets count 0. The row then stays `pending` until `refund.updated` arrives, while `refund()` returns `ok: true` and the caller emails "refunded". This is correct only if the endpoint is subscribed to `refund.updated` (checklist item 2). Low.
3. **`refundGroup` replay can exceed `maxTotal`. Pre-existing; not introduced here.** On a retry of the same capped group (same `clientRequestId`), a leg already fully refunded under that intent has `remaining = 0`, so it is skipped with `continue` and **does not spend budget**. A later leg can then take the cap again. Slice 3 adds one more way into this: a pending leg that the webhook later marks succeeded. Whether `cancelPlan` ever retries with the same id was not verified. Worth a follow-up check. Low.
4. **The C-3 coverage is a source guard, not a behavioural test.** It pins the shape of the condition only.

### Post-deploy manual checks (owed by the user, test mode, after the PR deploys)

1. **Deploy first.** The app's refund call and the webhook ship together (requirement §4).
2. **A-11, endpoint subscriptions.** In the Stripe dashboard (Connect platform, test mode), go to Developers → Webhooks → the Connect endpoint. Confirm it is subscribed to **`refund.created`, `refund.updated` and `refund.failed`** (all three are needed; `refund.updated` is essential for edge case 2). `charge.refunded` can stay.
3. **G-3, dashboard refund.** On a connected test account, take a test payment through the app, then refund part of it **in the Stripe dashboard**. Expect, read-only:
   - `payment_refunds`: **one** new row with `source='webhook'`, `processor_type='stripe'`, `processor_refund_id = re_…`, `idempotency_key = 'stripe:re_…'`, `status='succeeded'` (or `pending`, then `succeeded` on the next event), `stripe_connect_account_id = acct_…`, `created_at` ≈ the Stripe refund time, `metadata = {origin, charge_id, payment_intent_id}`, and `user_id` / `transaction_id` = the payment's.
   - `payment_transactions`: `refunded_amount` and `refund_status` (`partial` / `full`) updated by trigger.
   - The booking's `payment_status` follows (requirement §8).
   - The app no longer offers that amount for refund (`getRefundability.remaining` drops).
   - The Finance page client takings drop by the refund.
   - Webhook logs: "Processing Stripe refund" → "Stripe refund recorded"; **no** `alert: true`; `charge.refunded` logs "ignored".
4. **G-4, app refund.** Refund a test payment from the app. Expect **exactly one** `payment_refunds` row (`source='app'`), with `processor_refund_id` set and no second `webhook` row. In the dashboard, the Stripe refund shows metadata `refund_row_id = <that row's id>`. The logs may show "Webhook already recorded Stripe's answer; keeping it" (info), which is fine.
5. **F2-b, failed refund.** If test mode allows a failing refund (a test card whose refunds fail), confirm the row goes to `failed` with `failure_code` set, and `refunded_amount` drops back.
6. **CR-2 / C-3, where a pending reply can be produced** (a slow refund method in test mode). Check two things. A chat refund shows the "Stripe has accepted this refund and is still processing it… Do not refund it again." text, with no CRM activity, booking change or email. An automation refund step fails without a `refund.failed` payment event.
7. **Platform event.** A platform-account `refund.*` (boost) logs "Platform refund event; not recorded in the client ledger" and writes no `payment_refunds` row.

### Tests added by QA

- `lib/payments/__tests__/refundService.test.ts`: one test, "C-3 / Q-SA-6 (source guard): the automation refund block emits no refund.failed on IN_FLIGHT and still throws". It is in the existing slice-3 describe. It reads `app/api/payments/blocks/execute/route.ts` and asserts four things: exactly one `refund.failed` emit in the file; the emit sits inside `if (outcome.code !== 'IN_FLIGHT')`; that block closes before the unconditional `throw`. It passes on this tree and would fail on `HEAD`. Slice placement: **slice 3** (with T-3.5). RM should add it to commit 3. `slice3.patch` in the scratchpad does **not** include it.

### Final Status
- [x] All acceptance criteria that can run here pass. The open High/Medium count is 0, so this is **ready for the user's diff review**. G-3, G-4 and the F2-b trigger effect are owed post-deploy (checklist above)
- [ ] Issues found — Dev must address before commit

## Commit Info

_RM populates._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created | Dev workplan for slices 1–3 (one PR, three commits). SA-8 live-DB check run read-only: `schema:check` (no failures in scope) + `purge_schema_introspect` + OpenAPI. Columns, NOT NULLs, defaults, triggers (2 + 7), FKs, RLS and `payment_transactions.stripe_connect_account_id` match the migrations. CHECKs, index definitions and the guard body are not reachable read-only (U-1..U-3); read-only SQL given; T-1 gated on it. 11 SA questions (Q-SA-0..Q-SA-10) |
| 2026-10-14 | SA workplan review | U-1..U-3 closed by the read-only prod selects and recorded in §2.2; verdict match, T-0b done. §14.3 fold-in verified. Q-SA-0..Q-SA-10 ruled. Q-SA-6 and Q-SA-7 brought into scope (minimal: no `refund.failed` emit on `IN_FLIGHT`; `IN_FLIGHT` leg spends `maxTotal` budget). P0001 ambiguity ruled: acknowledge all three guard causes, never branch on the message, alert carries `pgMessage`. Conditions C-1..C-9. Status: approved with conditions |
| 2026-10-14 | Implementation (slices 1–3) | Dev implemented slices 1, 2 and 3 on `fix/stripe-connect-refund-webhook` (uncommitted), with C-1..C-9 and Q-SA-6 / Q-SA-7 (T-3.5, T-3.6 added). Task list ✅. New §12: per-slice file and hunk map plus three incremental patches for RM, the condition trace, deviations D-1..D-9, snapshot review (99 identical, 4 removed, 8 added), results (24 suites / 837 tests / 107 snapshots green; `tsc` no new errors, 5 pre-existing fixed). Status: Code Complete |
| 2026-10-14 | QA | PASS WITH NOTES. Targeted set: 72 suites, 1,620 tests, 107 snapshots, exit 0. Full suite from this worktree: 1,345 files, all from this worktree; 16 failing suites, none related (11 quarantined, 5 Windows CRLF/path/env artefacts), exit 1. `tsc` exit 2, 1,858 errors total, 0 in touched files. Every automatable criterion is mapped to a test. QA added one source guard for C-3 in `refundService.test.ts` (slice 3). No bugs. 4 low edge cases. Post-deploy checklist (A-11, G-3, G-4, F2-b, CR-2/C-3) in the QA report |
| 2026-10-14 | SA code review round 2 | Code Approved for QA. CR-1..CR-4 delta verified against the pre-fix copies. Only the 2 ruled transitions changed (72/72 ledger tests run by SA). The CR-1 characterisation case covers failed (NULL id) → pending → succeeded. The snapshot file is unchanged from round 1. The 19:04 slice patches rebuild 23/23 code files blob-identically from `47175fa5` (throwaway worktree, removed). Touched suites: 74 / 1,606 / 107 snapshots, `--ci`, passing. One non-blocking note: stale `failure_code` / `failure_message` after a move out of `failed` |
| 2026-10-14 | SA code review round 1 fixes | CR-1: lost-reply `failed`/`canceled` rows with no Stripe id now move to `pending` on a pending event (A-3 amended; table + new characterisation case). CR-2: seventh `refund()` caller (`MutateExecutor`) in §5, plus a QA line. CR-3: a second 23505 gets its own message. CR-4: `boostRouting` title renamed. All in slice 2; `slice2.patch` regenerated; the 3 patches rebuild the tree blob for blob from `47175fa5` (§12.5a). Jest 24 suites / 838 tests / 107 snapshots, exit 0. `tsc` exit 2 (existing errors elsewhere): 1,858 total, 0 in touched files, no new errors. Next: SA re-review |
| 2026-10-14 | SA code review | Fix Required. C-1..C-9, Q-SA-6/7 verified in code; D-1..D-9 accepted; snapshots independently confirmed (99 identical / 0 changed / 4 removed / 8 added); slice patches confirmed to rebuild the tree (23 files blob-identical). CR-1 (High): a `pending` event on a lost-reply `failed` row with no Stripe id fills the id and locks the row at `failed`, which amends A-3 (`failed`/`canceled` with no id + `pending` → apply `pending`). CR-2..CR-4 Low |
