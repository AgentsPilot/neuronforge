# Business OS Finance Health — Refund Timing Scoping (BD-17)

> **Last Updated**: 2026-10-14

## Overview

On 2026-10-14 the user decided **BD-17**: a refunded credit boost must appear on the admin Finance page in the month the **refund** happened, not the month of the purchase, and **finished months must never change**. Today the boost purchase row holds only a running total (`amount_refunded_minor`) and no refund date, so slice 4a (PR #358) counts refunds in the purchase month (deferral DF-5, default (a)). This is a read-only scoping note. It records where refunds and disputes are written, which timestamps already exist, and the options for recording refund timing from now on, with a recommendation. No code, migration or other file was changed.

**Refs measured.** Code: `origin/main` `d769b9e3` and `feature/bos-finance-health-4` `dba40849`. Every boost, webhook, purge and migration file cited below is identical on both refs (`git diff HEAD origin/main` over those paths is empty), so the line numbers hold for both. The finance builder exists on the branch only. Live database: read-only zero-row selects and counts with the service-role key from the main checkout (`business-os-schema-check` Rule 1), run 2026-10-14.

---

## Table of Contents

1. [Findings: the current write path](#1-findings-the-current-write-path)
2. [Findings: timestamps that already exist](#2-findings-timestamps-that-already-exist)
3. [Options](#3-options)
4. [Recommendation](#4-recommendation)
5. [Disputes](#5-disputes)
6. [Plan payments (P-*)](#6-plan-payments-p-)
7. [Open questions for BA / SA](#7-open-questions-for-ba--sa)
8. [Change History](#change-history)

---

## 1. Findings: the current write path

### 1.1 Events and routing

| Step | Where | What |
|---|---|---|
| Events handled | `lib/business-os/boost/boostChargeEvents.ts:20-25` | `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `charge.dispute.funds_reinstated`. **No `refund.*` events.** Those are not subscribed (DEP-9 lists `charge.refunded` and `charge.dispute.*` only, boost requirement line 417) |
| Routing | `app/api/stripe/webhook/route.ts:2160-2168` (`BUSINESS_OS_FLOW_HANDLERS = { boost, plan }`), dispatch at `:2370` | The boost resolver matches a charge or dispute on the payment intent stored on our purchase row. Unmatched events fall to the legacy Connect switch (`route.ts:2479-2498`) |
| Parse | `boostChargeEvents.ts:50-56, 72-89` | A refund reads only `charge.amount_refunded` (the **cumulative** total), `currency` and `refunded`. No refund id and no refund time are read |
| Handler | `lib/business-os/boost/boostChargeHandler.ts:72-207`; `plan()` at `:211-236` | It finds the purchase by payment intent (`:87`), checks livemode and currency (`:127-136`), then calls one transition. A refund targets `partially_refunded` or `refunded` with the cumulative amount (`:213-221`) |
| Repository | `lib/repositories/BusinessOsBoostPurchaseRepository.ts:979-1010` `transition()` → RPC `business_os_transition_boost_purchase` (`:162`) | Six arguments: `p_purchase_id, p_to_status, p_payment_intent_id, p_amount_refunded_minor, p_dispute_id, p_flag_reason` |
| SQL | `supabase/migrations/20261031_business_os_boost_crediting.sql:174-376` | Refund branch `:269-311`; dispute branches `:313-373` |
| Audit | `boostChargeHandler.ts:164-184` | `BOS_BOOST_PAYMENT_REVERSED` with `amount_refunded_minor` (cumulative) on `transitioned` / `recorded` only |
| Reconcile pass | `lib/business-os/boost/boostReconcilePass.ts:585-598` | When the nightly pass (or the admin button) re-reads a charge, it applies `charge.amount_refunded` through the same `transition()`. **No event, so no event time** |

### 1.2 Partial and multiple refunds

Both work today, **as one running total**:

- The RPC accepts any cumulative amount at least as large as the stored one (`:272` `stale` when smaller). It refuses an amount above the total (`:276`).
- `partially_refunded` → `partially_refunded` with a larger amount updates the row (`:298-306`). A later full refund moves it to `refunded`.
- On a `disputed`, `dispute_lost` or `flagged_mismatch` row, a refund only updates the amount (`:278-286`, `recorded`).
- **Each refund overwrites the previous total.** Nothing keeps the size or time of each step. Two partial refunds in October and November leave one number on the row.
- The boost requirement T-9 (line 569) says "record the Stripe refund or dispute **id**, amount and phase". As built, the **refund id is not recorded**. Only the dispute id is stored (`stripe_dispute_id`).

### 1.3 Credits are never taken back automatically

T-9 and FR-37 (boost requirement lines 193, 569): a refund or dispute never touches the credit lot (`boostChargeHandler.ts:22-23`). A manual take-back is an admin reversal in `business_os_credit_lot_draws` (`20261017_business_os_credit_lots.sql:53-86`, `kind = 'reversal'`, `created_at`, with an `admin_reversal:` idempotency key). That row is dated, but it is an admin decision with no link to a Stripe refund, so it cannot date a refund.

### 1.4 Live data (2026-10-14)

| Check | Result |
|---|---|
| `business_os_boost_purchases` rows | 1 |
| … with `amount_refunded_minor > 0` | **0** |
| … with `stripe_dispute_id` set | **0** |
| `business_os_billing_events` rows of kind `refunded` / `dispute_opened` / `dispute_closed` | 0 |
| `business_os_boost_purchases.refunded_at`, `.disputed_at` | 42703, do not exist |

**There is no refund or dispute to backfill.**

---

## 2. Findings: timestamps that already exist

| Source | Has a time? | Usable for BD-17? |
|---|---|---|
| Stripe `charge.refunded` event, `event.created` | Yes: when Stripe generated the event, within seconds of the refund | Usable on the webhook path only. The handler has it (`event` is in scope at `boostChargeHandler.ts:73`) but never passes it on. Not available on the reconcile path |
| Refund object `refund.created` | Yes | **Not in our payload.** On API `2025-10-29.clover` (`lib/stripe/StripeService.ts:186`) a Charge's `refunds` list is not included in events. Reading it means a Stripe API call (`refunds.list`) or subscribing to `refund.created` (a DEP-9 dashboard change plus a resolver change). Side note: the legacy Connect `handleChargeRefunded` loops over `charge.refunds?.data` (`route.ts:513`), which this API version leaves empty. That is outside this scope and worth its own check |
| `processed_webhook_events` | `processed_at`, `completed_at` and `metadata.created` = `event.created` (`route.ts:2303-2310`). Live columns confirmed | Keyed only by event id and type, with **no link to a purchase**. It is a claim table that the operator test-account cleanup deletes from (`20261047…:189`, ord 99/100). Not a finance source |
| `audit_trail` `BOS_BOOST_PAYMENT_REVERSED` | `created_at`, with the cumulative amount in `details` | Dated, but audit rows are archived (Admin Archiving is live), are not written on `already` or `stale`, and are not a money ledger. At most a fallback for forensics |
| `business_os_boost_purchases.status_changed_at` | Yes. Set on every status change, **including a partial→partial amount increase** (`20261031…:304`) | It holds only the **latest** change. It is not moved by a refund on a disputed or flagged row (`:283`), and it is overwritten by the next refund or dispute step. Right only for a single refund; wrong for multiple refunds across months |
| `business_os_boost_purchases.updated_at` | Yes | Same problem, and it also moves on non-money writes |
| `business_os_credit_lot_draws.created_at` | Yes | Only for an admin take-back, not linked to a refund (§1.3) |
| `business_os_billing_events` | `created_at`, `paid_at` | Plan-shaped and no boost writer (§3, option iii) |

**Summary:** no stored, per-refund, durable time exists for boosts. The only per-refund time we receive is `event.created`, and we discard it.

---

## 3. Options

**Common rule for "finished months never change".** The Finance page dates a refund by the time **we recorded it** (`recorded_at = now()` in the writing transaction). A row is never inserted with a past date, so a closed month can only change if something writes into it after the fact. On the webhook path the gap between Stripe's time and ours is seconds. Late paths (a Stripe retry days later, or the reconcile pass) land in the month we learned of the refund, which is the price of BD-17's "never change". Stripe's own time can be stored next to it for information (§7 Q-1).

### Option (i): `refunded_at` column on the purchase row (last refund only)

| Aspect | Detail |
|---|---|
| Migration | `ALTER TABLE … ADD COLUMN refunded_at timestamptz` plus `CREATE OR REPLACE` of the transition function body to set it. One file and a rollback, applied by hand on PROD |
| Webhook | None, if it is stamped with `now()` in SQL |
| Correctness | **Wrong for BD-17** with two refunds in different months: the October part would move to November, and a finished month would change. It also cannot date a refund recorded on a disputed row separately |
| Guards | Boost repository column list `BusinessOsBoostPurchaseRepository.ts:158` (if read), finance read columns `BusinessOsFinanceReadRepository.ts:168`, finance source guard DF-5 pin (`finance.source.guard.test.ts:672-700`), migration test for 20261031 (signature unchanged) |
| Verdict | Rejected. It is cheap but violates "finished months never change" |

### Option (ii): a small boost reversal events table (recommended)

`business_os_boost_reversal_events`: one append-only row per recorded refund step or dispute phase.

| Column | Note |
|---|---|
| `id uuid` PK | |
| `purchase_id uuid NOT NULL` FK → `business_os_boost_purchases(id)` | The account comes from the purchase. **No `user_id` column**, which keeps it out of the tenancy inventory (see guards) |
| `kind text` CHECK `refund`, `dispute_opened`, `dispute_won`, `dispute_lost` | |
| `amount_minor integer` ≥ 0 | For `refund`, the **delta** = new cumulative − old cumulative, computed inside the function under the existing `FOR UPDATE` lock. For disputes, the amount at stake (the purchase remainder, as the builder computes today) |
| `cumulative_refunded_minor integer` | The idempotency key for refunds |
| `currency text` | Copied from the purchase |
| `stripe_dispute_id text` | For dispute rows |
| `livemode boolean` | Copied |
| `recorded_at timestamptz NOT NULL DEFAULT now()` | **The Finance date** |
| Unique keys | `(purchase_id, cumulative_refunded_minor) WHERE kind = 'refund'`; `(purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund'` |

Each refund raises the running total, so the total after a step identifies that step. That makes the row **idempotent across webhook resends, out-of-order events and the reconcile pass without a Stripe refund id**. An out-of-order older event is already `stale` (`:272`) and writes nothing. Its share is folded into the newer row, dated when we recorded it.

| Aspect | Detail |
|---|---|
| Migration | One file: `CREATE TABLE` (REVOKE from anon/authenticated, no client grant; INSERT for service_role only, no UPDATE/DELETE), plus `CREATE OR REPLACE FUNCTION business_os_transition_boost_purchase` with the **same six-argument signature**. It inserts the event row in the same transaction wherever the function returns `transitioned` or `recorded` for a refund or dispute target (`:282-285`, `:303-306`, `:322-325`, `:330-333`, `:349-352`, `:368-371`). The rollback restores the 20261031 body and drops the table. Plus a pre-check and a post-apply check script, following the `scripts/check-bos-boost-*` pattern. The user applies it by hand on PROD **before** the Finance read that depends on it ships. The writer change is SQL-only, so it is live the moment it is applied |
| Webhook / handler / repository | **None.** Same RPC, same arguments, same outcomes. The reconcile pass is covered for free because it calls the same function |
| Finance page | A new read on `BusinessOsFinanceReadRepository` (a method windowed on `recorded_at`, half-open, the same as `paid_at`). `refundsAndDisputesOf` (`boostRevenue.ts:136-148`) is fed from those rows instead of `amount_refunded_minor`, as its comment already foresees (`:129-131`). The purchase window stays on `paid_at` for gross; refunds and losses come from the events in the window. A refund event whose purchase falls outside the window still counts, which the line/package grouping must handle (it groups by the purchase's package and currency, read through the FK) |
| Guards it trips | (a) **Migration tests:** a new `supabase/migrations/__tests__/…` pinning the REVOKE/GRANT and the same signature `uuid, text, text, integer, text, text` (precedent `business-os-boost-crediting.migration.test.ts:37-39, 134-136, 406`); the 20261031 test itself is unaffected (the file is unchanged). (b) **Boost repository pins:** `BusinessOsBoostPurchaseRepository.test.ts:519-574` stay green (RPC name and arguments unchanged). If the boost repository reads the new table, it needs new method tests. (c) **Finance:** `finance.source.guard.test.ts:672-700` (DF-5 tokens only in `refundsAndDisputesOf`) must be re-pinned on the new input; the finance read repository column and one-caller pins (`BusinessOsFinanceReadRepository.ts:168`, test file) gain a method. (d) **Purge and inventory:** a new table must be classified in `lib/business-os/purge/descriptors.ts` (`never(...)`, like `business_os_boost_purchases` at `:519`), `__tests__/classification-baseline.json` (`:46-48`, count +1) and `lib/business-os/businessOwnedTables.ts` (`:218`). (e) **Operator test-account cleanup:** the cleanup deletes `business_os_boost_purchases` (`20261047…:180`, ord 91) and checks foreign keys against its plan (`fk_catalog`, `:244`). An FK from the new table to purchases will very likely need a regenerated cleanup function (`scripts/generate-test-account-cleanup-sql.ts`, a new dated migration and a version-stamp bump) that deletes event rows first. Choose `ON DELETE CASCADE` vs a cleanup step with SA. (f) **Payment write-lockdown scan** (`lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts:35`, a fixed 12-table list): not tripped automatically, but SA should decide whether to add the table to its "no browser module writes" check (`:347`). (g) **Webhook placement guards** (`routerPlacement.guard.test.ts`): not tripped, because `route.ts` is unchanged. (h) **SECURITY DEFINER inventory:** not tripped (the function stays `SECURITY INVOKER`, service_role only). (i) **Entitlements:** not involved, because nothing imports `lib/business-os/entitlements/` |
| Backfill | None (0 refunds, 0 disputes live). The migration can assert that no purchase has `amount_refunded_minor > 0` or a dispute id, and refuse otherwise, so an unexpected refund cannot go undated |
| Cost | About 1–1.5 days writer side (migration, rollback, checks, migration test, purge/inventory/cleanup registration) plus about 1 day finance read and builder change and pins. **One hand-applied PROD migration, plus a cleanup regeneration if (e) applies** |

### Option (iii): reuse an existing table

| Candidate | Fit |
|---|---|
| `business_os_billing_events` (`20261027…:5-62`) | It already has append-only rows, `stripe_event_id` UNIQUE, `amount_minor`, `currency`, `created_at`, and the kinds `refunded`, `dispute_opened` and `dispute_closed`. **But** it is plan-shaped: its comment says "of a Business OS plan" (`:59`); it has `currency = 'usd'` lowercase (`:51`) while boost stores `USD`; it has no purchase link, no won/lost split, and its idempotency key is the Stripe event id, so the reconcile pass (no event) has no key. Using it means a migration that adds a `boost_purchase_id` column, new CHECKs and a writer in the boost path, plus re-pinning the plan repository (`BusinessOsBillingEventRepository.ts:67-69`) and the P-3b tests. It mixes two products in one ledger that SA-P5 kept separate "to keep RD-2 enforceable by grep and RLS" (plan requirement line 834) |
| `processed_webhook_events` | A claim table, not linked to a purchase, and deleted by the cleanup. No |
| `audit_trail` | Archived and not a ledger. No |
| `payment_refunds` (Connect ledger) | It belongs to client payments of businesses, not platform money. No |
| Verdict | Not recommended. The migration is no smaller than (ii), and it couples boost to the plan ledger's constraints and tests |

---

## 4. Recommendation

**Option (ii), written inside `business_os_transition_boost_purchase` with an unchanged signature, dated by `recorded_at = now()`.**

- It is the only option that is right for multiple partial refunds across months, so finished months stay fixed.
- **No webhook, handler or repository change**, and the reconcile pass is covered by the same function.
- One hand-applied migration (plus its rollback and check scripts). There is no backfill.
- The finance change is the swap DF-5 already anticipates: `refundsAndDisputesOf` reads dated rows.
- Order: the migration on PROD → a finance PR that reads the table → DF-5 closed. Until the migration is applied, the Finance page keeps default (a).

---

## 5. Disputes

Today a dispute is dated only by `status_changed_at`, which is overwritten at each phase (`20261031…:331, 350, 369`). Opened → lost in a later month leaves only the close date. Finance treats "held" as the remainder while the status is `disputed` and "lost" while it is `dispute_lost` (`boostRevenue.ts:145-146`). These are states, not dated flows, so a closed month's "held" figure changes when the dispute closes.

With option (ii), each phase becomes a dated row (`dispute_opened`, `dispute_won`, `dispute_lost`, keyed by dispute id). **Business choice for the user (via BA):** under BD-17, should a lost dispute count as lost in the month it **closed**, and should "held" be shown as held **at the end of each month** (computable from the rows) or only as "open now"? The recommended default is lost in the close month, and held as of the window end, so a finished month never changes.

---

## 6. Plan payments (P-*)

- **The same gap, but not yet built.** Plan refunds and disputes are P-6b (plan requirement lines 93, 353, 883), which is not implemented: `lib/business-os/billing/` has no `charge.refunded` or dispute writer, and plan refunds still fall to the legacy "unknown payment" path (as-built G-15, `BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md:196`).
- **The plan ledger already has the right shape.** `business_os_billing_events` is append-only, one row per Stripe event, with `refunded`, `dispute_opened` and `dispute_closed` kinds reserved (`20261027…:31`) and `created_at` as the insert time. If P-6b writes one row per event with the **refund delta** (not the cumulative `charge.amount_refunded`) and a dated column, plans get BD-17 timing without a new table. Two cautions for P-6b: (1) `charge.refunded` carries a cumulative amount, so P-6b needs the same delta-under-lock rule; (2) `paid_at` is the plan ledger's ordering key and should not be reused to mean "refunded at". Use `created_at`, or add an explicit column.
- **One shared design, two tables.** The rule should be shared: one dated, append-only row per reversal step; delta amounts; dated when recorded; idempotent without relying on the event (for reconcile). Each product keeps its own ledger, per SA-P5's separation. The Finance page then reads "reversals in window" from both through one builder rule. A single cross-product table is not recommended.

---

## 7. Open questions for BA / SA

| # | Question | Default |
|---|---|---|
| Q-1 | Store Stripe's `event.created` as `occurred_at` alongside `recorded_at`? This changes the RPC signature (+1 argument), which trips the 20261031-style signature pins, the repository argument test (`BusinessOsBoostPurchaseRepository.test.ts:519-528`) and a handler change | No. `recorded_at` only |
| Q-2 | Disputes: lost in the close month; held as of the window end (§5) | Yes |
| Q-3 | FK from the events table to purchases: `ON DELETE CASCADE`, or an explicit step in the regenerated test-account cleanup | SA rules |
| Q-4 | Add the new table to the payment write-lockdown browser scan | SA rules |
| Q-5 | Fold the P-6b design rule (§6) into the plan-payments requirement now | Yes, as a note on P-6b |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-14 | Created | Read-only scoping for BD-17 (refund month, finished months fixed). Write path, existing timestamps, live check (0 refunds, 0 disputes), options (i)/(ii)/(iii), recommendation (ii) inside the transition function with an unchanged signature, dispute timing, P-6b alignment. No code or migration changed |
