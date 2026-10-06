# Workplan: Business OS credits boost — slice 2b, crediting and status

> **Last Updated**: 2026-10-06

**Developer:** Dev
**Requirement:** [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md): FR-4, FR-13 to FR-17, FR-30, FR-31, FR-35 to FR-37, FR-43, HP-1, HP-2, NFR-9, NFR-10; SA rulings §18.3 T-4 to T-9, T-14; §18.9; §18.10 slice 2 row, R-6, R-8, R-10, R-13
**Parent workplan:** [BUSINESS_OS_CREDITS_BOOST_SLICE_2_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_2_WORKPLAN.md). Slice 2a is merged (PR #233). Migration `20261030` was applied to PROD on 2026-10-06 and verified (its §6.9). Binding from it: SA C-8 (§3.5), the Q-5 / Q-6 rulings, the carry-forward notes (§3.4b), the paste rules and the PGlite procedure (§6.8).
**Why a separate file:** the parent is ~700 lines and records a merged, applied slice. A separate 2b file keeps 2b's review, results and runbook apart. The parent's §3.5 gets a pointer here.
**Worktree:** `neuronforge-boost`
**Branch:** `feature/bos-credits-boost-slice-2b`, cut from `origin/main` `1fbccab8` (includes #233). Not stacked. The worktree was clean before the switch, confirmed with `git branch --show-current` on 2026-10-06.
**Date:** 2026-10-06
**Status:** **2b applied to PROD 2026-10-06 16:44:09 UTC and verified (§6.6); [PR #235](https://github.com/AgentsPilot/neuronforge/pull/235) awaiting merge.** **QA follow-ups applied 2026-10-06** (D1, D2 and R-1 to R-6, §7.5). Earlier: **2b QA 2026-10-06: PASS WITH NOTES** (two Low defects, QA2b-D1/D2; see QA Testing Report). **2b SA code review 2026-10-06: Code Approved for QA** (doc must-fixes CR-1 before the PR is merged, CR-2 before the PROD apply). Previously: **Code Complete 2026-10-06, awaiting SA code review.** SA workplan review: approved with conditions C-1 to C-6 (C-7 a note), applied in §3.0. The local Jest bar, the scoped tsc and the PGlite runs are green (§7.5). Nothing is committed.

## Overview

2b adds the money-arrival half of the purchases table: migration **`20261031`**, with three `SECURITY INVOKER` functions and the column grants they need.

- **`business_os_credit_boost_purchase`** turns a paid Stripe checkout into exactly one credit lot. It locks the purchase row, cross-checks Stripe's facts against the **row** (never the catalogue), and calls the existing `business_os_record_credit_lot` in the same transaction. A mismatch flags the row and returns normally.
- **`business_os_transition_boost_purchase`** moves the status for unpaid, failed and expired checkouts, refunds and disputes, under one fixed transition table. It never touches a lot.
- **`business_os_record_boost_receipt`** fills the receipt link and charge id once, only where they are empty. Per C-8 (a), it is not a status transition.

It also adds repository methods, an updated checker, a new write probe, a rollback, tests and a PROD runbook. Nothing is wired: the 4a webhook handler is the first caller. **Lots, draws and both lot functions stay byte-identical.**

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope, out of scope and guardrails](#2-scope-out-of-scope-and-guardrails)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Task List](#5-task-list)
6. [Checker, probe, rollback and the PROD runbook](#6-checker-probe-rollback-and-the-prod-runbook)
7. [Test Plan](#7-test-plan)
8. [CI impact, entitlements, estimate and risks](#8-ci-impact-entitlements-estimate-and-risks)
9. [Notes for slices 3 and 4a](#9-notes-for-slices-3-and-4a)
10. [Open questions for SA](#10-open-questions-for-sa)
11. [SA Review Notes](#sa-review-notes)
12. [QA Testing Report](#qa-testing-report)
13. [Commit Info](#commit-info)
14. [Change History](#change-history)

---

## 1. Analysis Summary

**Verified at `1fbccab8` (2026-10-06).** Everything below was read from the migration bodies (business-os-schema-check Rule 3). PROD state is from the parent §6.9, where the user ran the checkers on 2026-10-06.

| Thing | Where | Relevance |
|---|---|---|
| `business_os_boost_purchases` with all 30 columns, the 11-status CHECK, `paid_family_complete`, `lot_only_when_paid`, `flag_reason_shape`, UNIQUE on the session id, payment intent, charge id and `lot_id`, and the `lot_id` FK to lots | `20261030` (PROD, verified) | 2b only **writes** columns that already exist. **No `ALTER TABLE`** |
| service_role's current purchases grants: `SELECT`; `INSERT` on the 13 reservation columns; `UPDATE (status, stripe_checkout_session_id, checkout_expires_at, status_changed_at, updated_at)` | `20261030` | 2b needs `UPDATE` on 11 more columns (§3.4) |
| `business_os_record_credit_lot(...)` → `(out_recorded, out_lot_id)`. INVOKER, EXECUTE to service_role only. `ON CONFLICT (idempotency_key) DO NOTHING`; a replay with the same user, source and credits returns `false` and the same id; a key reused differently raises `23505`. No advisory lock | `20261017` (PROD) | Called once per credited purchase. CHECK `boost_purchase_shape`: actor `stripe_webhook`, no admin, no reason, `source_ref` NOT NULL, key prefix `boost:`. Key limited to 200 characters, and the 194-character session CHECK (C-2) guarantees the fit |
| Lots draw lock `business_os_credit_lots:<user_id>` | `20261017` (taken by the reversal function); slice 9's consumption writer will take it too | 2b **never** takes it (R-13: inserting a lot only adds credit). See §3.5 for lock order |
| Boost cap lock `business_os_boost_cap:<user_id>` | `20261030` (reserve, set and end override) | 2b's functions do not take it. Crediting changes no counted amount: every 2b-reachable status that counts was already counting |
| md5 of the five 2a function bodies | computed 2026-10-06 from `20261030` with carriage returns stripped | Pre-check stop condition (§6.5): `reserve_purchase 1a643ef0bebb158b644d27341361b9e7`, `attach_checkout 11220b2ba6002f70f966edd6a1344c82`, `abandon_purchase 8fa06355c38894c93671477cdde01e2b`, `set_cap_override fb45a45590ecc998341cdc2c64ac0069`, `end_cap_override c1d52130512f757ad5f14f6767b14fe1`. The 11a and charge md5s are in the parent §6.7 |
| Migration block | Requirement R-4; parent §6.5 (both sessions acknowledged 2026-10-05) | `20261031` is free on `main`. ⚠️ Observation for the coordinator: `main` now has `20261036_business_addresses_book.sql`, while the plan-payments session said P-10 would use `20261036`. That is not boost's number, but worth a word to them |

---

## 2. Scope, out of scope and guardrails

### In scope

| # | Item | Requirement |
|---|---|---|
| S-1 | `business_os_credit_boost_purchase`: row lock, cross-checks against the row, `record_credit_lot`, set `paid`. Replay → `already_credited`. Mismatch → `flagged_mismatch`, returns normally | FR-13 to FR-16, T-5, T-6, R-10, C-8 (b)(c), Q-5, Q-6 |
| S-2 | `business_os_transition_boost_purchase`: the fixed transition table for unpaid, failed, expired, refund and dispute phases | T-7, T-9, C-8 (d) |
| S-3 | `business_os_record_boost_receipt`: fill-only receipt URL and charge id on a paid-family row | T-8, C-8 (a) |
| S-4 | Column UPDATE grants for the 11 columns these write; EXECUTE to service_role only | §3.4 |
| S-5 | Repository: `credit`, `transition`, `recordReceipt` on `BusinessOsBoostPurchaseRepository` | NFR-4 |
| S-6 | Checker updated to the post-2b state; new probe; rollback; migration test | 2a precedent |
| S-7 | Docs: one entitlements-doc paragraph; requirement status and Change History; parent §3.5 pointer | — |

### Out of scope

| Not in 2b | Where |
|---|---|
| The webhook resolver and handler, Stripe calls, audit entries, Pino logs on the event path | 4a (R-6). The audit entry for crediting (FR-17) is written by 4a around this function |
| The reconcile pass (FR-43) | 4b; it calls `credit` / `transition` here |
| Any clawback or write to a lot or draw on refund or dispute | Never in boost (T-9, C-8 (d)); manual take-back is 11b's `confirmPaidCredits` |
| Any `ALTER` of the purchases or overrides tables, or of 11a objects | Never (G-1) |
| Any write to `auth.users` in a PROD script | Never (user decision 2026-10-06) |

### Guardrails (must not)

| # | Guardrail | Checked by |
|---|---|---|
| G-1 | Lots, draws, both lot functions and the charge path byte-identical; the 2a functions byte-identical | Migration test (2b names lots only in the one `record_credit_lot` call); checker B8 (INFO); pre-check md5 stop |
| G-2 | No `SECURITY DEFINER`, trigger, `IF NOT EXISTS`, `ALTER TABLE` or `CREATE TABLE` in `20261031` | Migration test |
| G-3 | The account comes from the row, never from an argument. The credit and transition functions take **no** user id | Signature pins; probe |
| G-4 | Only the credit function writes `lot_id` or `paid_at`, and only together with a lot recorded in the same transaction | Migration test (the UPDATE that sets `lot_id` comes after the `record_credit_lot` call and uses its id); checker B7 71 |
| G-5 | A mismatch never raises; only database errors do (C-8 b) | Migration test (no `RAISE` on a mismatch path); probe |
| G-6 | Paste rules: no comments, literal charset, `chr(58)` / `chr(95)`, no **into** in a literal, no single-letter alias | Migration test |
| G-7 | The repository never writes a table directly; no entitlements import | Repository source guards (already in place, extended) |

---

## 3. Implementation Approach

### 3.0 SA conditions applied (2026-10-06)

These override the text below where they differ.

| # | Applied as |
|---|---|
| **C-1** | Only the `record_credit_lot` call is wrapped in `BEGIN … EXCEPTION WHEN unique_violation THEN … END`. A `23505` there sets `flagged_mismatch` with `flag_reason = 'lot_key_conflict'` and returns **`mismatch` normally**. Every other database error still throws (HP-1). **Every deterministic problem is flagged; only transient database failures throw.** Probe P07 expects `mismatch` / `lot_key_conflict` with no exception and no new lot; the migration test pins that the `EXCEPTION` block encloses exactly the lot call |
| **C-2** | The currency is compared as `upper(btrim(p_currency))` against the row. Probe P01 credits with `'usd'` and gets `credited`; the migration test pins the `upper(` |
| **C-3** | (a) **Dispute won** (`p_to_status = 'dispute_won'`) restores the pre-dispute status from `amount_refunded_minor`: 0 → `paid`; between 0 and the total → `partially_refunded`; equal to the total → `refunded`. No new column. (b) A refund arriving while the row is `disputed` (or `dispute_lost`) updates `amount_refunded_minor` monotonically **without** a status change, and answers **`recorded`**. Probe P08 covers both orders: refund → dispute → won, and dispute → refund → won |
| **C-4** | On a `flagged_mismatch` row, a refund (`amount_refunded_minor`, monotonic) and a dispute (`stripe_dispute_id`) are recorded **without** a status change and answer **`recorded`**. Dispute won or lost on a flagged row answers `already` (no status to restore) |
| **C-5** | The probe calls `business_os_set_boost_cap_override(owner, 1000000, 'USD', …, probe actor)` inside its rolled-back transaction before any reservation, so an existing override cannot interfere; pinned by the test |
| **C-6** | (a) `payment_intent_reused` means another purchase **with a different id** holds it (`other.id <> p_purchase_id`), in `credit` and in `pending → awaiting_payment`. (b) New flag **`payment_intent_mismatch`**: the row already stores a payment intent different from `p_payment_intent_id`, checked right after `session_mismatch`. Probe P03 includes it |
| **C-7** | Note for slice 9 in §3.5 and §9 |

The `credit` cross-check order is now: `no_session`, `session_mismatch`, `payment_intent_mismatch`, `livemode_mismatch`, `currency_mismatch`, `amount_mismatch`, `total_mismatch`, `payment_intent_reused`, `account_deleted`, then the lot call (whose `23505` gives `lot_key_conflict`). The payment intent is stored on a flagged row only if the row has none and no other purchase holds it, so the UNIQUE key can never throw.

**Transition targets** (`p_to_status`): `awaiting_payment`, `failed`, `expired`, `flagged_mismatch`, `partially_refunded`, `refunded`, `disputed`, `dispute_won`, `dispute_lost`. The outcomes are `transitioned`, `already`, `stale`, `recorded`, `not_allowed`, `mismatch` and `not_found`. A refund above the stored total answers `not_allowed`; it is never a CHECK error, which would loop.

### 3.1 `business_os_credit_boost_purchase`

```
(p_purchase_id uuid, p_session_id text, p_payment_intent_id text,
 p_amount_subtotal integer, p_amount_tax integer, p_amount_total integer,
 p_currency text, p_livemode boolean)
→ (out_status text, out_user_id uuid, out_lot_id uuid, out_flag_reason text)
```

`LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''`. The steps, in this order (pinned by position):

1. Any argument NULL → `22004`. A session id without `cs_` or over 194 characters, a payment intent without `pi_`, or a negative amount → `22023`. These are caller defects: 4a narrows the Stripe event with Zod first.
2. `SELECT … FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.id = p_purchase_id FOR UPDATE`. Missing → **`not_found`**.
3. `lot_id` already set → **`already_credited`** with the row's account and lot. A replay, a retry or a reconcile run all converge here (FR-15). This is checked before the status, so a credited row later refunded still answers `already_credited`.
4. Status not in `pending`, `awaiting_payment`, `expired` → **`not_creditable`** (`failed`, `abandoned` and `flagged_mismatch` stay so, per Q-5).
5. **Cross-checks against the row**, first failure wins. Each sets `status = 'flagged_mismatch'`, `flag_reason = <code>`, `status_changed_at` and `updated_at`, then returns **`mismatch`** with the code, **normally**. The transaction commits, so a retry cannot fix it (C-8 b).
   - `no_session`: the stored session id is NULL (C-8 c)
   - `session_mismatch`: the stored session ≠ `p_session_id`
   - `livemode_mismatch`: `p_livemode` ≠ the row's (R-10)
   - `currency_mismatch`: `p_currency` ≠ the row's (`USD`)
   - `amount_mismatch`: `p_amount_subtotal` ≠ `price_minor` (the snapshot, FR-4)
   - `total_mismatch`: `p_amount_total` ≠ subtotal + tax
   - `payment_intent_reused`: another purchase already holds `p_payment_intent_id`. This is checked so the UNIQUE key never raises a `23505` that 4a would retry forever
   - `account_deleted`: the row's `user_id` is NULL (Q-6). No lot can be written, because `record_credit_lot` refuses a NULL user.

   On a mismatch the function also stores the payment intent (unless `payment_intent_reused`) and the three amounts. That way 4b's refund and dispute routing (by payment intent) finds the flagged row, and an admin sees what Stripe reported. Q-3.
6. `SELECT lot_result.out_recorded, lot_result.out_lot_id INTO … FROM public.business_os_record_credit_lot(v_user, 'boost_purchase', v_base, v_bonus, v_credit_value_version, NULL, 'boost' || chr(58) || v_session, p_purchase_id, 'stripe_webhook', NULL, NULL) AS lot_result`. The base, bonus and credit value version come from the row snapshot. `out_recorded = false` with an id means already recorded, and it is still linked. A `23505` (key reused for a different lot) is **not caught**: it throws, and 4a releases the claim (HP-1).
7. `UPDATE … SET status = 'paid', lot_id, paid_at = now(), stripe_payment_intent_id, amount_subtotal_minor, amount_tax_minor, amount_total_minor, status_changed_at, updated_at` → **`credited`** with the account and the lot.

Tax: credits come only from the snapshot, and the amounts are stored as reported. A session with `amount_tax > 0` gives the same lot (T-14). The probe and the PGlite run both show it.

### 3.2 `business_os_transition_boost_purchase`

```
(p_purchase_id uuid, p_to_status text, p_payment_intent_id text,
 p_amount_refunded_minor integer, p_dispute_id text, p_flag_reason text)
→ (out_status text, out_user_id uuid, out_from_status text)
```

It locks the row `FOR UPDATE`, then applies one fixed table:

| From | To | Requires / writes |
|---|---|---|
| `pending` | `awaiting_payment` | `p_payment_intent_id` (`pi_`), stored. A payment intent held by another row → `flagged_mismatch` `payment_intent_reused`, answered `mismatch` |
| `pending`, `awaiting_payment` | `failed`, `expired` | — |
| `pending`, `awaiting_payment` | `flagged_mismatch` | `p_flag_reason` (1–64 chars) |
| `paid`, `partially_refunded` | `partially_refunded` | `0 < p_amount_refunded_minor < amount_total_minor`, never below the stored amount |
| `paid`, `partially_refunded` | `refunded` | `p_amount_refunded_minor = amount_total_minor` |
| `paid`, `partially_refunded`, `refunded` | `disputed` | `p_dispute_id` (`dp_` / `du_`) |
| `disputed` | `paid` (dispute won), `dispute_lost` | The dispute id must match the stored one |

Outcomes:
- **`transitioned`**.
- **`already`**: same status and same facts; idempotent.
- **`stale`**: a refund amount lower than the stored one. Stripe events can arrive out of order, so nothing changes.
- **`not_allowed`**: anything else, nothing changes.
- **`mismatch`**: a flagged payment-intent reuse.
- **`not_found`**.

`lot_id` is never written or cleared, and no lot or draw is touched (C-8 d). A refund keeps the credits, by T-9. `paid` is reachable only from `disputed`; first crediting goes only through §3.1.

### 3.3 `business_os_record_boost_receipt` (C-8 a)

```
(p_purchase_id uuid, p_charge_id text, p_receipt_url text)
→ (out_status text, out_user_id uuid)
```

It locks the row. Not a paid-family row → `not_paid`. Otherwise it sets `stripe_charge_id` and `receipt_url` **only where they are NULL**:
- **`recorded`**: something was written.
- **`already_recorded`**: the values were equal.
- **`conflict`**: a stored value differs, or another row holds the charge id. Nothing is overwritten.
- **`not_found`**.

The status is never changed. The charge id must start `ch_` or `py_`, and the URL `https://` and be at most 2,048 characters, or the call gets `22023`. Failing to record a receipt never fails crediting: 4a calls it after `credit`, and logs a `warn` on failure (T-8).

### 3.4 Grants

The 2a grants stay. 2b adds one line:

`GRANT UPDATE (stripe_payment_intent_id, stripe_charge_id, receipt_url, amount_subtotal_minor, amount_tax_minor, amount_total_minor, amount_refunded_minor, stripe_dispute_id, flag_reason, lot_id, paid_at) ON TABLE public.business_os_boost_purchases TO service_role;`

`INSERT` and the owner grant are unchanged. **Known limit (Q-2):** because the functions are INVOKER (SA Q-2 in 2a), service_role could also update these columns directly. That is the same trade-off 2a accepted for status. The defences:
- the repository's no-direct-write source guard (G-7);
- the table CHECKs (`paid_family_complete`, `lot_only_when_paid`);
- checker B7 71, which proves every `lot_id` points at its own boost lot with the same account and credits.

### 3.5 Locks and order (no deadlock with slice 9)

| Lock | Taken by | Never by |
|---|---|---|
| Purchase row (`FOR UPDATE`) | attach, abandon (2a); credit, transition, receipt (2b) | Slice 9's draw writers. They read lots and draws, never purchases |
| `business_os_boost_cap:<user_id>` (advisory) | reserve, set and end override (2a) | Any 2b function |
| `business_os_credit_lots:<user_id>` (advisory) | 11a's reversal; slice 9 / 10 consumption | **Any boost function**. Inserting a lot needs no lock (R-13) |

Because no boost function takes the lots lock, and no lots writer locks a purchase row, there is no lock cycle. **(SA C-7)** A lot inserted by `credit` without the lots lock may be invisible to a draw writer running concurrently. That draw then sees **less** credit than exists, which is conservative and harmless, and it is the reason R-13 holds. **Binding rule, recorded for slice 9 and for any later boost change:** if a boost function ever needs the lots lock, it takes the purchase row first and the lots lock second, and no lots writer may lock a purchase row.

### 3.6 Repository additions (`BusinessOsBoostPurchaseRepository`)

| Method | Returns |
|---|---|
| `credit({ purchaseId, sessionId, paymentIntentId, amountSubtotalMinor, amountTaxMinor, amountTotalMinor, currency, livemode })` | `credited` (accountId, lotId) / `already_credited` (accountId, lotId) / `mismatch` (accountId or null, flagReason) / `not_creditable` / `not_found`. A database error is `{ error }`, and 4a then throws to release the claim |
| `transition({ purchaseId, toStatus, paymentIntentId, amountRefundedMinor, disputeId, flagReason })` | The six outcomes, with accountId and fromStatus |
| `recordReceipt({ purchaseId, chargeId, receiptUrl })` | `recorded` / `already_recorded` / `conflict` / `not_paid` / `not_found` |

The same rules as 2a apply:
- arguments are built field by field;
- unknown status → error;
- the "never 0" parsers;
- no throw;
- null input → `{ error }` (QA-D3 pattern).

The account is always the one **returned** (R-6). No method takes an account id.

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261031_business_os_boost_crediting.sql` | create | Three functions, grants (§3) |
| `supabase/migrations/__tests__/business-os-boost-crediting.migration.test.ts` | create | Pins for 2b (§7.1) |
| `scripts/check-bos-boost-purchases-migration.sql` | modify | The post-2b state (§6.2). One checker for both tables. Q-4 |
| `supabase/migrations/__tests__/business-os-boost-purchases.migration.test.ts` | modify | Its checker expectations follow the post-2b counts; its migration pins are unchanged |
| `scripts/probe-bos-boost-crediting-migration.sql` | create | 2b write probe (§6.3) |
| `supabase/SQL Scripts/20261031_business_os_boost_crediting_rollback.sql` | create | Drops the three functions, revokes the 2b grant (§6.4) |
| `lib/repositories/BusinessOsBoostPurchaseRepository.ts`, its test, `lib/repositories/index.ts` | modify | §3.6 |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | One paragraph at the end of § Metering + a Change History row |
| `docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_2_WORKPLAN.md` | modify | §3.5 pointer to this file |
| `docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md` | modify | Status + Change History |

No registry change (no new table). No change to `20261030`, `20261017` or any slice 1 file.

---

## 5. Task List

- ✅ T2b.0: Branch confirmed; scratch Jest and tsc configs and the PGlite harness ready (the parent §6.8 procedure)
- ✅ T2b.1: Migration `20261031` (three functions, grant, revokes); paste rules
- ✅ T2b.2: Migration test (§7.1)
- ✅ T2b.3: Checker update + test updates (§6.2)
- ✅ T2b.4: Probe (§6.3) + pins
- ✅ T2b.5: Rollback (§6.4) + pins
- ✅ T2b.6: Repository methods + tests
- ✅ T2b.7: PGlite run, including the local-only account-deleted check and mutations (§7.3)
- ✅ T2b.8: Docs; requirement status
- ✅ T2b.9: Local bar, scoped tsc, `git diff --stat`; Code Complete. **Leave uncommitted**

---

## 6. Checker, probe, rollback and the PROD runbook

### 6.1 Migration outline

`BEGIN; SET LOCAL lock_timeout = '5s';` → the `GRANT UPDATE (…)` line → three `CREATE FUNCTION` blocks (tags `credit_purchase`, `transition_purchase`, `record_receipt`) → four `REVOKE ALL` and one `GRANT EXECUTE` per function → `COMMIT;`. A second paste fails at the first `CREATE FUNCTION` with `already exists` and changes nothing.

### 6.2 Checker (`check-bos-boost-purchases-migration.sql`, updated to the post-2b state)

The same file is updated (Q-4):
- **B3 31:** updatable columns 8 → **19**, with the column list extended.
- **B5 / B6:** **8** functions, the three new signatures added.
- **B7:** gains row **74**, "every paid-family purchase has exactly its own lot": the lot's key is `boost:` ∥ the session id, its actor is `stripe_webhook`, and its credits equal the snapshot. Row **72**, "boost lots without a purchase", turns from INFO into a **PASS/FAIL**, because after 2b every boost lot must have one.
- **B8 (INFO):** now also reports the five 2a function md5s.

Before 2b is applied the updated checker would FAIL B3 / B5, so the runbook runs it only after the apply. The pre-check uses the md5 query, not the checker.

### 6.3 Probe (`probe-bos-boost-crediting-migration.sql`)

It is one `DO $probe$` block that always ends in `RAISE EXCEPTION`, and **it never writes `auth.users`**. It has the same guards as 2a (placeholder, uuid, read-only, account exists, plan row), **without** the "no existing purchases" guard: every reservation is made with a cap argument of 1,000,000, so the account's real purchases cannot interfere. Every row is checked by its own id.

| Id | Proves |
|---|---|
| P00 | INFO: lot, draw and purchase counts |
| P01 | Reserve + attach + credit → `credited`. The row is `paid`, with `lot_id`, `paid_at`, payment intent and amounts. The lot has source `boost_purchase`, key `boost:` ∥ session, `source_ref` = purchase id, actor `stripe_webhook`, credits = snapshot, and no expiry |
| P02 | The same credit again → `already_credited` with the same lot; lots +1 only |
| P03 | Each mismatch on a fresh attached reservation: `session_mismatch`, `livemode_mismatch`, `currency_mismatch`, `amount_mismatch`, `total_mismatch`, `payment_intent_reused` → each `mismatch`, row `flagged_mismatch` with that code, no lot, **no exception** |
| P04 | A reservation with no session → `no_session` (C-8 c) |
| P05 | An `expired` row (transitioned first) is credited (Q-5); `failed` and `abandoned` → `not_creditable` |
| P06 | Tax: `amount_tax = 50`, `total = price + 50` credits the same snapshot (T-14) |
| P07 | Key reuse: a lot pre-recorded with key `boost:` ∥ session for other credits makes `credit` **raise** `23505`; the row is unchanged |
| P08 | Transitions: every allowed row of §3.2 → `transitioned`; a repeat → `already`; a lower refund → `stale`; a forbidden move (e.g. `failed` → `paid`, `refunded` → `partially_refunded`) → `not_allowed`; the lot and the draws are unchanged throughout (C-8 d) |
| P09 | Receipt: fill → `recorded`; same → `already_recorded`; different → `conflict` (no overwrite); on a pending row → `not_paid`; the status is never changed |
| P10 | Bad arguments → `22004` / `22023` |
| P11 | The owner cannot execute any 2b function (`42501`) |
| P12 | The charge path never moved (charges and totals counts) |
| P13 | INFO: `account_deleted` needs an account deletion, which the PROD probe never does; it is proven by the local PGlite check |

### 6.4 Rollback (`20261031_business_os_boost_crediting_rollback.sql`)

It drops the three functions (exact signatures) and runs `REVOKE UPDATE (the 11 columns) … FROM service_role`. It **never drops a table or touches a row.** It refuses (Q-5) if any purchase has `lot_id` set, because once credits exist the crediting function must not disappear. It is valid only until 4a deploys; after that the rollback is code-only.

### 6.5 2b on PROD: the exact steps (user, Supabase SQL editor)


**⚠️ Do NOT run `scripts/check-bos-boost-purchases-migration.sql` on PROD until `20261031` has been applied (SA CR-1).** The checker now describes the post-2b state, and on a 2a-only database it would FAIL B3, B5 and B6. Before the apply, use only the pre-check query below. To re-check 2a alone, use the 2a checker from `main` at `1fbccab8`: `git show 1fbccab8:scripts/check-bos-boost-purchases-migration.sql`.

**Pre-check query (SA CR-2).** Paste it as one run. It follows the paste rules: no comments, literals made only of letters, digits, underscores and spaces, and no single-letter aliases.

```sql
SELECT pg_proc.proname AS function_name,
       pg_get_function_identity_arguments(pg_proc.oid) AS arguments,
       md5(replace(pg_proc.prosrc, chr(13), '')) AS body_md5
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND pg_proc.proname IN ('business_os_reserve_boost_purchase', 'business_os_attach_boost_checkout', 'business_os_abandon_boost_purchase', 'business_os_set_boost_cap_override', 'business_os_end_boost_cap_override', 'business_os_record_credit_lot', 'business_os_reverse_credit_lot', 'business_os_record_credit_charge', 'business_os_credit_period_start', 'business_os_credit_boost_purchase', 'business_os_transition_boost_purchase', 'business_os_record_boost_receipt')
ORDER BY pg_proc.proname;
```

Then run `SELECT version();` on its own.

**Expected: exactly these nine rows, in this order, with these `body_md5` values.** The five 2a functions and the four 11a and charge functions must be **present**. There must be **no row** for `business_os_credit_boost_purchase`, `business_os_transition_boost_purchase` or `business_os_record_boost_receipt` (the 2b functions are absent). Any extra row, missing row or different md5 means stop, and send the rows to the Dev.

| `function_name` | Expected `body_md5` | From |
|---|---|---|
| `business_os_abandon_boost_purchase` | `8fa06355c38894c93671477cdde01e2b` | 2a (`20261030`) |
| `business_os_attach_boost_checkout` | `11220b2ba6002f70f966edd6a1344c82` | 2a (`20261030`) |
| `business_os_credit_period_start` | `b00af2d2c4738e51e08e2ec92195077e` | charges (`20261015`) |
| `business_os_end_boost_cap_override` | `c1d52130512f757ad5f14f6767b14fe1` | 2a (`20261030`) |
| `business_os_record_credit_charge` | `a7aa425de95fe06da72d31257f7818a2` | charges (`20261015`) |
| `business_os_record_credit_lot` | `89c46b47f1fc57f7080ba8064c28fd63` | 11a (`20261017`) |
| `business_os_reserve_boost_purchase` | `1a643ef0bebb158b644d27341361b9e7` | 2a (`20261030`) |
| `business_os_reverse_credit_lot` | `da020d2d87ebfae366b19ea6b0c7b5be` | 11a (`20261017`) |
| `business_os_set_boost_cap_override` | `fb45a45590ecc998341cdc2c64ac0069` | 2a (`20261030`) |

The 2a values were recomputed on 2026-10-06 from the applied `20261030` file, as the migration test does: CRLF normalised, carriage returns stripped, the text between the dollar tags hashed. The four 11a and charge values equal the parent §6.7 and the 2a PROD pre-check (parent §6.9). The migration test pins every value in this table against the files and the checker.

1. **Pre-check:**
   - `to_regprocedure` for the five 2a functions and `business_os_record_credit_lot` must be present, and for the three 2b functions absent.
   - The md5 query over the **nine** functions (five 2a, two 11a, two charge) must equal §1 and the parent §6.7.
   - Run `SELECT version();`.
   - Any difference: stop.
2. **Apply** `20261031`; record the time.
3. **Checkers:** the updated boost checker gives `VERDICT PASS`. The lots and charges checkers are unchanged and PASS.
4. **Probe** in a new tab on the user's own account (with a plan row): `PROBE PASS`. It writes nothing to `auth.users` and keeps nothing.
5. **Recheck:** the boost checker PASSes, and the lots checker's L9 boost count is unchanged.
6. **Rollback only on the Dev's word.**
7. Paste the results into this workplan.

---

### 6.6 2b PROD apply results (2026-10-06)

Run by the user in the Supabase SQL editor on PROD, following §6.5. The probe ran on the user's own account. Every step passed.

| Step | Time (UTC) | Result |
|---|---|---|
| Pre-check | — | 9 rows; every md5 equals the §6.5 table; no 2b function present. PostgreSQL 17.4 on aarch64 ✅ |
| Apply `20261031` | 2026-10-06 16:44:09.648637 | Success ✅ |
| Boost checker | 16:45:53 | **VERDICT PASS 22/0.** B3 31: 18 insertable and 19 updatable service_role columns. B5/B6: 8 functions, service_role only. B7 71, 72 and 74 PASS. B8 INFO yes, including the slice 2a functions 5 of 5. B9: 0 purchases, 0 overrides ✅ |
| Lots checker | 16:46:53 | **VERDICT PASS 23/0.** L9: 1 lot (admin_grant) and 1 draw (reversal), 0 unexpired credits, 0 boost_purchase lots. The reversal of the 200-credit admin test grant happened between the 2a apply and this run and is **not** from boost (boost writes no draws); presumed to be the credit-deduction session's take-back test ✅ |
| Charges checker | 16:47:42 | **VERDICT PASS 19/0.** C7: 0 mismatched; 216 charge rows, 7 totals rows ✅ |
| Probe (user's own account) | after checkers | **PROBE PASS.** P00 INFO: 1 lot, 1 draw. P01–P12 and P07b PASS. P13 INFO: `account_deleted` is proven locally only. P14 INFO: concurrency; the row lock is pinned by a test ✅ |
| Recheck | 17:20:05 | **VERDICT PASS 22/0**, 0 purchases, 0 overrides. The probe kept nothing ✅ |

## 7. Test Plan

### 7.1 Migration test (`business-os-boost-crediting.migration.test.ts`)

- **Paste safety and the auth rule:**
  - paste safety on the migration, probe and rollback;
  - **the probe never writes `auth.users`**.
- **Structure:**
  - exactly three `CREATE FUNCTION`;
  - zero `CREATE TABLE`, `ALTER TABLE`, `DEFINER` or `TRIGGER`;
  - the only lots reference is the one `business_os_record_credit_lot(` call, with `'boost_purchase'`, `'boost' || chr(58) ||`, `'stripe_webhook'` and `NULL, NULL` for admin and reason.
- **Signatures:**
  - all three take no user id (G-3);
  - each has `out_user_id`.
- **Credit function:**
  - the step order by position: arguments, `FOR UPDATE`, `already_credited`, the status gate, each cross-check in §3.1 order, the lot call, then the paid update;
  - the creditable set is exactly `pending, awaiting_payment, expired`;
  - every mismatch path ends in `RETURN` with no `RAISE`;
  - the paid UPDATE sets `lot_id` from the lot call's id.
- **Transition function:**
  - the table of §3.2 exactly;
  - it never names `lot_id` in a SET, nor any lots table.
- **Receipt function:**
  - it fills only with `COALESCE`-on-NULL semantics;
  - it never sets `status`.
- **Grant:** the exact 11-column `GRANT UPDATE` line; EXECUTE to service_role only; `REVOKE ALL` × 4 roles × 3 functions.
- **G-1:** the md5 of the five 2a bodies and the four 11a / charge bodies equal the checker's B8 constants and this workplan's §1.
- **Rollback:** no `DROP TABLE`; drops exactly the three functions; revokes exactly the 11 columns; the refusal comes before the drops.

### 7.2 Repository tests

- each new method: args field by field, every outcome mapped, unknown status → error;
- null input → `{ error }`;
- a database error → `{ error }`, never a throw;
- the account is taken from the RPC row;
- source guards still hold (no direct writes, no entitlements import).

### 7.3 PGlite (scratchpad only, pinned 0.5.8)

- **Setup:** the parent §6.8 harness. Apply `20261017`, `20261015`, `20261030`, then `20261031`.
- **Checks to run:**
  - the updated checker passes;
  - the 2b probe passes;
  - the 2a probe still passes;
  - the rollback refuses with a credited row and drops when there are none;
  - the migration re-applies;
  - QA's `qa2a.mjs` is still 134/134.
- **Local-only checks:**
  - **account deleted:** a scratchpad SQL file deletes an `auth.users` row, then `credit` gives `mismatch` / `account_deleted` with no lot;
  - **mutations:** removing a cross-check, or giving the transition table a `lot_id` write, is caught by the probe or the checker.
- **Not provable:** real concurrency, PROD state, and how the SQL editor parses a paste.

### 7.4 Local bar

- **Suites:**
  - the 12 suites of the parent §7.4;
  - the new 2b migration test;
  - the updated 2a migration test.
- **Scoped tsc:** 0 errors in the touched files.
- **CI:** runs `test:bos-entitlements` and the required type-check.

---

### 7.5 Results (Dev, 2026-10-06)

| Check | Result |
|---|---|
| New `business-os-boost-crediting.migration.test.ts` | ✅ 40 tests |
| `BusinessOsBoostPurchaseRepository.test.ts` (2a + 2b) | ✅ 41 tests |
| Updated `business-os-boost-purchases.migration.test.ts` (the checker is now post-2b) | ✅ 78 tests |
| Local bar: those three + the lots, charges and billing-accounts migration tests, `businessOwnedTables`, `descriptors.invariant`, `accountDeletionPolicy`, `BusinessOsCreditLotRepository`, `entitlementSqlScripts.guard`, `enforcementPoints`, `accountSeam.guard` (scratch config, `--runTestsByPath`) | ✅ **13 suites, 717 tests** |
| Scoped tsc (`tsconfig.slice2b.json` in the scratchpad) | ✅ **0 errors in the touched files.** 7 errors in files outside this diff, reached through `lib/repositories/index.ts`: `lib/geo/countries.ts` (3, new on `main` since 2a), `lib/pilot/insight/MemoryManager.ts` (2), `CalibrationSessionRepository.ts` (1), `lib/types/plugin-types.ts` (1) |

**PGlite 0.5.8 (PostgreSQL 18.3), scratchpad only.** The harness emulates Supabase roles (`service_role` with `BYPASSRLS`) and applies `20261017`, `20261015`, `20261030`, then `20261031`.

| Step | Result |
|---|---|
| Apply `20261031` | ✅ Applied; a second paste fails with `already exists` |
| Shared checker (post-2b) | ✅ `VERDICT PASS 22 pass 0 fail`: B5 8 functions, B3 19 updatable columns, B7 72 and 74 PASS, B8 INFO `yes` with the 2a functions 5 of 5 |
| 2b probe | ✅ `PROBE PASS` P00–P14, with 0 purchases and 0 lots kept |
| 2a probe after 2b | ✅ `PROBE PASS` (see deviation 1) |
| Lots checker after the probes | ✅ No FAIL row |
| Rollback with a credited purchase | ✅ `ROLLBACK REFUSED  a boost purchase already holds credits so the crediting functions were kept` |
| Rollback on a database with no credits | ✅ The three functions gone; the `lot_id` UPDATE grant revoked, the 2a `status` grant kept; the tables present. Re-apply → `VERDICT PASS` |
| Dev adversarial `pglite/dev2b.mjs` | ✅ **13 / 13** (below) |
| QA's `pglite/qa2a.mjs` | 133 / 134. The one failure is DEL-6: that script applies only `20261030`, then runs the shared checker, which now describes the post-2b state (SA Q-4). **Expected, not a regression.** QA should apply `20261031` in that script |

The adversarial pass `dev2b.mjs` covered:
- **Q-6:** an account deleted locally gives `mismatch` `account_deleted` with no lot.
- **C-2:** `' usd '` (spaces and lower case) is credited.
- **Replay** gives `already_credited` with the same lot.
- **Q-5:** an expired row is credited.
- **C-6 (a):** an awaiting-payment row with its own intent is credited.
- **C-1:** a lot key conflict gives `lot_key_conflict`.
- **Locks:** no advisory lock is held after `credit`.
- **Over-total:** a refund above the total gives `not_allowed`.
- **Checker:** after real credits plus the planted orphan lot, exactly row 72 fails.
- **Four code mutations,** each caught by the 2b probe:
  - dropping `upper(btrim(...))` → P01, P02, P03;
  - catching the wrong exception → P07 raises `23505`;
  - dispute won always `paid` → P08;
  - reuse check including the row itself → P05.

  The last one was missed at first, so P05 gained the own-intent case.

**What PGlite cannot prove:** real concurrency, PROD state, the SQL editor's paste parsing, and Supabase's real default privileges. The PROD checker and probe remain the proof.

**QA (2b) follow-ups applied (Dev, 2026-10-06):**

| # | Change | Proof |
|---|---|---|
| QA2b-D1 (R-1) | In `transition`, the "lower cumulative refund → `stale`" check now runs **before** the "`refunded` → `partially_refunded` → `not_allowed`" rule. An equal or higher partial on a refunded row is still `not_allowed` | Migration test (order pinned); probe P08 (a partial of 500 after a full refund → `stale`); mutation M6 (the old order) caught by P08 |
| QA2b-D2 (R-2) | In `credit`, when `record_credit_lot` answers already-recorded, the lot is linked only if it is this purchase's own lot: source `boost_purchase`, `source_ref` = the purchase id, the same account, and base, bonus and total equal to the snapshot. Otherwise the function flags `lot_key_conflict` and returns `mismatch` normally, with no link. The check is one read-only `SELECT` on `business_os_credit_lots` (G-1 test updated: lots are named by the one call and this one read, never written) | Migration test (all six clauses pinned, placed after the exception block); new probe step **P07b** (a same-key, same-credit lot whose `source_ref` is another purchase → `lot_key_conflict`, no link, no new lot); mutation M5 (`source_ref` clause removed) caught by P07b |
| R-3 | Probe P08: a lower refund while disputed → `stale`; a refund above the total while disputed → `not_allowed` | Migration test pins |
| R-4 | Probe P09: a paid row with a charge id but no URL → `recorded`, only the URL filled | Migration test pin |
| R-5 | Probe P11: the owner reading `stripe_dispute_id` or `amount_subtotal_minor` → `42501` | Migration test pin |
| R-6 | PGlite only (`dev2b.mjs`): a lot whose credits differ from the purchase snapshot makes checker rows **71 and 74** FAIL (exactly 0, 71, 74) | — |
| I-1, I-3 | Notes for 4b and 4a in §9 | — |

**Re-run after the QA follow-ups:**
- **Jest:** 13 suites, **719 tests** green.
- **PGlite 0.5.8:**
  - the checker passes 22/0;
  - the 2b probe passes P00–P14 plus P07b, and the 2a probe passes, each keeping 0 rows;
  - the rollback refuses with a credited row and drops cleanly without one, then the migration re-applies to PASS;
  - `dev2b.mjs` passes **16 / 16** (R-6, plus mutations M5 and M6);
  - QA's `qa2b.mjs` passes **147 / 147**;
  - QA's `qa2a.mjs` gives **133 / 134**. The one failure, `GR-svc-update-lot`, is the expected post-2b grant and is by design (SA Q-2).
- **The nine-function md5 pre-check is unaffected.** Only 2b function bodies changed. The §6.5 query, run on a 2a-only PGlite database, still returns exactly the nine rows and values of the §6.5 table.

**Deviations from the plan (small, for SA code review):**
1. **The 2a probe now tolerates 2b's grant.** Its P12 "update `lot_id`" block accepts `check_violation` as well as `insufficient_privilege`. After 2b, service_role may update `lot_id`, and the CHECK `lot_only_when_paid` still refuses it on a pending row. The 2a probe therefore stays valid before and after 2b. One line in `scripts/probe-bos-boost-purchases-migration.sql`.
2. **The "dispute won" target is passed as `dispute_won`.** The function derives the restored status (C-3 a), so the caller never sends `paid`.
3. **The probe has P00–P14.** P05 gained the awaiting-payment-with-its-own-intent case. P13 (account deleted) and P14 (concurrency) are INFO.
4. **`credit` raises `XX000`** if the lot function ever returns no id without an error. That is defensive: a database anomaly, so it throws.
5. **Refunds that would break a CHECK** (above the total, or 0 on a paid row) answer `not_allowed`, so they can never loop. `refunded → partially_refunded` answers `not_allowed` (SA Q-7). Dispute won or lost on a flagged row answers `already`.
6. **The rollback locks purchases** `IN SHARE ROW EXCLUSIVE MODE`: writes wait during the refusal check, reads continue.
7. **The repository** answers `{ error }` if the database reports `credited` without an account or a lot id. That should never happen.

## 8. CI impact, entitlements, estimate and risks

- **CI:** no new job, script or dependency. The new tests run in the existing entitlements job and the Jest gate (about 1 s).
- **Entitlements:** nothing is imported from `lib/business-os/entitlements/`, so no registration is needed.
- **Estimate:** about 1.5 to 2 days.

| Risk | Mitigation |
|---|---|
| A paid boost lost by a failing credit | One transaction; key reuse and database errors throw, so 4a retries (HP-1); 4b reconcile (FR-43) |
| Double credit | `lot_id` checked first; lot key UNIQUE; UNIQUE `lot_id` |
| A webhook retry loop on a deterministic problem | Every data mismatch is flagged and returned normally (C-8 b), including payment-intent reuse |
| A direct service-role write linking a wrong lot | Source guard; CHECKs; checker B7 71 / 74 (Q-2) |
| Deadlock with slice 9 | §3.5: no boost function takes the lots lock; written lock order |

---

## 9. Notes for slices 3 and 4a

Carried from the parent §3.4b, plus 2b's:

| For | Note |
|---|---|
| Slice 3 | Treat `boost_checkout_session_in_use` (23505 on attach) as a refusal: expire that Stripe session. On `reservation_expired`, expire the Stripe session and do not show it. Attach immediately after creating the session |
| Slice 3 / 4a | No PROD runbook step may write `auth.users` (user decision 2026-10-06) |
| 4a | Map the `credit` outcomes: `credited` / `already_credited` → complete the event, audit (FR-17), then `recordReceipt` (best effort, `warn` on failure); `mismatch` → complete the event, `error` log `bos_boost_mismatch` with the flag reason, audit; `not_creditable` / `not_found` → complete the event, `warn` (the resolver found the row, so `not_found` means a race); a database error → **throw** to release the claim |
| 4a | `checkout.session.completed` with `payment_status = unpaid` → `transition(awaiting_payment, payment intent)`. `async_payment_failed` → `failed`. `checkout.session.expired` → `expired`. Never call `credit` for `no_payment_required` (promotion codes are off) |
| 4b | `charge.refunded` → `transition(partially_refunded or refunded, cumulative amount)`; `stale` is normal for out-of-order events. Disputes → `disputed` / `paid` / `dispute_lost` with the dispute id |
| **4a (SA N-1)** | A SQLSTATE of class **22** (`22004`, `22023`) from these RPCs is **deterministic**: a retry will not fix it. Log it at `error` with `alert: true`, write an audit entry, and **complete** the event. Do not throw. Only other database errors throw (HP-1) |
| **4b (SA N-2)** | A refund event on a `pending`, `awaiting_payment` or `expired` row answers `not_allowed`. Log it at `error`, write an audit entry, and let the reconcile pass credit or flag the row. A dispute **outcome** (won or lost) on a flagged row is not stored (it answers `already`); 4b's audit entry is the record |
| **4b (QA I-1)** | A row flagged through `transition` (`flagged_mismatch`, or `payment_intent_reused` from `pending`) has no reported amounts, so a refund recorded on it has no total bound. It is only a recorded fact, but 4b logs any refund on such a row at `warn`, with the amount |
| **4a (QA I-3)** | Validation refusals raised by the repository itself (bad prefix, fractional amount, null input) come back as `{ error }` with no SQLSTATE. 4a treats them as deterministic, like class 22 (N-1): log at `error` with an alert, audit, complete the event. Better, 4a's Zod narrowing of the Stripe event makes them unreachable |
| **Slice 6 (SA N-3)** | The admin per-account view lists `flagged_mismatch` purchases with their reason code (`flag_reason`), so an admin can find and refund them |
| Slice 6 | Overrides on deleted accounts are not active (QA I-2) |
| Slice 9 | (SA C-7) A boost lot inserted without the lots lock may be invisible to a concurrent draw, which then sees less credit than exists. That is conservative and harmless. Slice 9 must never lock a purchase row (§3.5 lock order) |
| 4a / 4b (SA) | Log `lot_key_conflict` at `error` with `alert: true`. Add `payment_intent_mismatch` to the mismatch log. Treat `recorded` as a normal refund or dispute outcome. Pass the **row id from `findBySessionIdForWebhook`**, never `client_reference_id` unchecked |

---

## 10. Open questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | Separate 2b workplan file rather than revising the parent | Yes; the parent records a merged, applied slice |
| Q-2 | INVOKER plus column UPDATE grants on `lot_id`, `paid_at` and the amounts (direct service-role writes are possible, guarded by the source guard, the CHECKs and B7) — same as 2a's Q-2? | Yes |
| Q-3 | On a mismatch, store the payment intent (unless reused) and the amounts on the flagged row, so refund and dispute routing and admins can see it | Yes |
| Q-4 | Update the existing boost checker to the post-2b state (one checker), rather than a second checker file | Yes; B72 becomes PASS/FAIL |
| Q-5 | The rollback refuses once any purchase has a lot | Yes |
| Q-6 | `payment_intent_reused` as a flag code (avoids a 23505 retry loop) | Yes |
| Q-7 | The transition table in §3.2, especially `refunded` → `disputed`, `disputed` → `paid` (won), and `stale` for a lower cumulative refund | As written |
| Q-8 | Receipt as a separate fill-only function (C-8 a, first option) | Yes |

**Business questions:** none. Refunds and disputes only flag (T-9, P-3), and expired-but-paid rows are credited (Q-5, already ruled).

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-06, against `1fbccab8`, the applied `20261030` and 11a's `20261017`**
**Status:** ✅ Approved with conditions (C-1 to C-6; C-7 is a note). The Dev writes them into §3, §6 and §7 as the first step of implementation, and no second review is needed. Three of the conditions are **Medium**, because each would otherwise cause a paid-but-uncredited state or a wrong status in production.

The design meets C-8 (a)–(d). The account comes only from the row, and none of the three functions takes a user id. The cross-checks are against the **row snapshot**, never the catalogue. `already_credited` is checked first. Expired rows are creditable (Q-5). No boost function takes the lots lock, and the lock order is written down. Lots are never touched by a transition. The PROD runbook checks the md5 of 9 functions plus `version()`, and no script writes `auth.users`.

#### Facts verified

| Claim | Verified |
|---|---|
| `record_credit_lot(uuid, text, numeric, numeric, integer, timestamptz, text, uuid, text, uuid, text)` → `(out_recorded, out_lot_id)`. `ON CONFLICT (idempotency_key) DO NOTHING`; a matching replay returns `false` plus the id; a different lot on the same key raises `23505`; no advisory lock | ✅ `20261017` |
| 2a CHECKs: `paid_family_complete` (lot, `paid_at`, payment intent and three amounts), `flag_reason_shape` (set iff `flagged_mismatch`, 1–64 characters), `refund_within_total`, dispute id `dp_` / `du_` | ✅ `20261030:73–83`. Every flag code in §3.1 fits within 64 characters |
| The 2a UPDATE grant has 5 columns; 2b adds 11 (none of `user_id`, `livemode`, the snapshot or the versions) | ✅ |

#### Conditions

| # | Severity | Condition |
|---|---|---|
| **C-1** | **Medium** | **A lot-key `23505` must be flagged, not thrown.** The purchase row is locked `FOR UPDATE` before the lot call, and the session id is UNIQUE on purchases. So the only way `record_credit_lot` can raise `23505` is a lot that **already exists under the key `boost:<session>` with different credits**. That is a data anomaly, and a retry can never fix it. Thrown, it would make 4a release the claim on every delivery for about 3 days, and the 4b reconcile pass would throw too. The boost would end paid but uncredited, with the only trace a stream of `error` lines. **Fix:** wrap **only** the `record_credit_lot` call in `BEGIN … EXCEPTION WHEN unique_violation THEN … END`. In the handler, set `flagged_mismatch` with `flag_reason = 'lot_key_conflict'` and return `mismatch` **normally**, the same way as `payment_intent_reused`. Every other database error still throws (HP-1). P07 changes to expect `mismatch` / `lot_key_conflict`, with no lot added and no exception. The migration test pins that the `EXCEPTION` block encloses exactly the lot call. 4a logs this code at `error` with `alert: true`. So the split Dev asked about lands as: **every deterministic problem is flagged, and only transient database failures throw.** No input then causes an infinite Stripe retry loop. |
| **C-2** | **Medium** | **Currency case.** Stripe reports `currency: 'usd'` in lower case, and the row stores `'USD'`. A literal comparison would flag **every** boost as `currency_mismatch`. Compare `upper(btrim(p_currency))` with the row's currency in SQL, so the guarantee does not depend on 4a remembering to upper-case it. The probe credits once with `'usd'` → `credited`, and the migration test pins the `upper(`. |
| **C-3** | **Medium** | **Disputes and refunds interleave.** (a) "Dispute won" must **restore the pre-dispute status**, not always `paid`. Derive it from `amount_refunded_minor` (no new column): 0 → `paid`; between 0 and the total → `partially_refunded`; equal to the total → `refunded`. Otherwise a refunded-then-disputed-then-won purchase would read `paid` with a refund amount on it. (b) A refund event that arrives while the row is `disputed` updates `amount_refunded_minor` (monotonically, never lowering it) **without** changing the status, and answers `recorded`. Today it would answer `not_allowed` and lose the refund fact (FR-35). P08 covers both orders: refund then dispute then won, and dispute then refund then won. |
| **C-4** | Low | **Refunds and disputes on `flagged_mismatch` rows.** A flagged row holds the money but no credit, and its payment intent is stored (Q-3), so 4b will route refund and dispute events to it. Record the facts (`amount_refunded_minor`, monotonic, and `stripe_dispute_id`) **without** a status change, and answer `recorded`, so FR-35 holds for exactly the purchases an admin is most likely to refund. 4b writes the audit entry and the flag. |
| **C-5** | Low | **The probe and existing overrides.** `reserve` ignores the default cap argument when the account has an **active override**. The 1,000,000 default therefore does not protect the probe on an account that has an override. Inside the probe's transaction (it is rolled back), call `business_os_set_boost_cap_override` with a 1,000,000 cap and a probe actor uuid before reserving, and pin the call in the test. |
| **C-6** | Low | **Payment intent identity.** (a) The `payment_intent_reused` check is "another purchase **with a different id** holds it" (`id <> p_purchase_id`), in both `credit` and the `pending → awaiting_payment` transition. Pin it. (b) An `awaiting_payment` row already stores a payment intent. If `credit` is then called with a **different** one, flag `payment_intent_mismatch` (a new code, checked right after `session_mismatch`). Add it to P03. |
| C-7 | Info | **For slice 9 (record in §3.5):** a lot inserted by `credit` without the lots lock may be invisible to a draw writer that is running concurrently. That draw sees **less** credit than exists, which is conservative and harmless. It is the reason R-13 holds. The binding lock order stays as written. |

#### Rulings on §10

| Q | Ruling |
|---|---|
| **Q-1** | **Yes:** a separate 2b file. The parent's §3.5 points here. |
| **Q-2** | **Yes:** the same trade-off as 2a. A direct service-role write of `lot_id` is bounded by `paid_family_complete`, the UNIQUE `lot_id`, the FK, the repository's no-direct-write guard and checker B7 71 / 74. |
| **Q-3** | **Yes:** store the payment intent (unless reused) and the amounts on a flagged row. It is required for C-4 routing and for admin visibility. |
| **Q-4** | **Yes:** one checker updated to the post-2b state. The runbook runs it only after the apply, and the pre-check uses the md5 query, which is right. B72 as PASS/FAIL is right. |
| **Q-5** | **Yes:** the rollback refuses once any `lot_id` exists, and is valid only until 4a deploys. |
| **Q-6** | **Yes**, with C-6 (a). |
| **Q-7** | **As written, plus C-3 and C-4.** `refunded → disputed` is right: a dispute can be opened on a refunded charge. `stale` for a lower cumulative refund is right, because Stripe reports the cumulative amount and events arrive out of order. `refunded → partially_refunded` stays `not_allowed`. |
| **Q-8** | **Yes:** the separate fill-only receipt function. `conflict` never overwrites, which is right. |

#### Other checks

- **Tenant isolation:** no user id parameter, and `out_user_id` comes from the row (G-3). 4a must pass the **row id from `findBySessionIdForWebhook`**, never `client_reference_id` taken unchecked from the event. A wrong id is caught anyway by `session_mismatch`. ✅
- **Idempotency:** the order lock → `lot_id` → status → cross-checks → lot → update means a replay, retry or reconcile run always converges on `already_credited`. With C-1 there is no loop. A paid-but-uncredited row can only be `flagged_mismatch`, and that is visible. ✅
- **Feeds 4a and 4b:** the §9 outcome map is correct. Add `lot_key_conflict` (alert) and `payment_intent_mismatch` to 4a's mismatch log, and `recorded` to 4b's refund and dispute handling. ✅
- **Paste rules and the auth rule:** pinned by the test (§7.1). PGlite covers `account_deleted` locally, which is acceptable because PROD never deletes users. ✅
- **CI and entitlements:** no change. **Size:** about 1.5–2 days. ✅

**No user question.**

#### Approval

[x] Workplan approved with conditions C-1 to C-6. Proceed to implementation.

### SA Code Review (2b)

**Code Review by SA — 2026-10-06**
**Status:** ✅ **Code Approved for QA.** The SQL, the repository and the tests need no change. **Two documentation must-fixes** (CR-1, CR-2) apply to the PROD runbook and must land **before the 2b PR is merged**, because they protect the apply. Notes N-1 to N-3 carry forward to 4a and 4b.

**Scope:**
- **Created:** `20261031` (three functions, an 11-column UPDATE grant), the 2b probe P00–P14, the rollback, the 2b migration test.
- **Modified:** the shared checker (now post-2b), the 2a probe (one line, deviation 1), the 2a migration test, the repository (`credit`, `transition`, `recordReceipt`) with tests and `index.ts`, the entitlements doc, the requirement status line, the parent pointer.
- `git diff --stat`: 434 insertions and 18 deletions across 9 tracked files, with no deletion lacking an insertion. `20261017`, `20261030` and `20261015` are not in the diff.

#### What I verified myself

| Check | Result |
|---|---|
| The 13-suite local bar (scratch config, `--runTestsByPath`) | ✅ **717 passed** |
| PGlite 0.5.8: apply 15, 17, 30 and 31, then the shared checker | ✅ **VERDICT PASS 22 / 0**. B5 shows 8 functions, B3 19 updatable columns, B7 71, 72 and 74 PASS |
| 2b probe | ✅ **PROBE PASS P00–P14.** P01 credits with lower-case `usd`. P07 gives `lot_key_conflict` and returns normally. P08 covers both refund and dispute orders with "won" restoring the status. 0 rows kept |
| 2a probe after 2b | ✅ PROBE PASS P00–P16 (deviation 1) |
| 2b rollback with a credited row | ✅ `ROLLBACK REFUSED  a boost purchase already holds credits …` |
| Dev's adversarial `dev2b.mjs` | ✅ **13 / 13**, including no advisory lock held after `credit`, and the four probe-caught mutations |
| My mutation MX1: `FOR UPDATE` removed from `credit` | ✅ Migration test red (1) |
| My mutation MX2: `user_id` added to the 2b UPDATE grant | ✅ Migration test red (1), **and** the PGlite checker FAILs B3 31 ("mismatches … user_id") |
| Restoration after each mutation | ✅ SHA-1 matches the original |
| The 7 tsc errors outside the diff | ✅ **Pre-existing.** `lib/geo/countries.ts` (from 28f284e8 on main), `MemoryManager.ts`, `CalibrationSessionRepository.ts` and `plugin-types.ts` are all byte-identical to `origin/main`. `index.ts` only gains boost exports, which import none of them |
| Requirement status line tidied into a slice list | ✅ **No information lost.** The detail it dropped (the slice 1 and 2a QA and SA outcomes, and the 2a workplan conditions C-1 to C-8) is all in Change History rows 780–795, and the line now says so |

#### Conditions C-1 to C-7

| | Met? |
|---|---|
| C-1 lot-key `23505` flagged | ✅ A `BEGIN … EXCEPTION WHEN unique_violation` encloses **only** the `record_credit_lot` call. It sets `lot_key_conflict`, and P07 and M2 cover it |
| C-2 currency case | ✅ `upper(btrim(p_currency))`. P01 tests `usd`, and the adversarial run tests `' usd '` |
| C-3 dispute won restores status; a refund on a disputed row is recorded | ✅ `dispute_won` derives the status from `amount_refunded_minor`, and `disputed` / `dispute_lost` record the refund (P08, M3) |
| C-4 facts on flagged rows | ✅ The refund amount (monotonic) and dispute id are recorded with no status change |
| C-5 the probe neutralises overrides | ✅ (P01 setup) |
| C-6 payment-intent identity | ✅ `id <> p_purchase_id` in both places, and the new `payment_intent_mismatch` (P03, P05, M4) |
| C-7 note for slice 9 | ✅ Recorded in §3.5 |

#### The seven §7.5 deviations: all accepted

- **1. The 2a probe accepts `check_violation`.** Correct: after 2b, service_role may update `lot_id`, and the CHECK `lot_only_when_paid` is what refuses it on a pending row.
- **2. `dispute_won` as the target.** Right: the caller never chooses the restored status.
- **3. P00–P14.**
- **4. `XX000` when the lot function returns no id.** A database anomaly, so a throw is right.
- **5. Refunds that would break a CHECK answer `not_allowed`, and won/lost on a flagged row answers `already`.** No loop is possible.
- **6. The rollback's `SHARE ROW EXCLUSIVE` lock.** It makes the refusal check race-free.
- **7. The repository refuses an incoherent `credited` answer.**

#### The rule "deterministic → flag, transient → throw"

Every data mismatch in `credit` is flagged and returned normally: no session, session, payment intent, livemode, currency, amount, total, reused intent, deleted account, and lot-key conflict. The checks happen under the row lock, so the payment-intent UNIQUE can only collide through a cross-row race. That race rolls the whole transaction back, including the lot, so no lot is left without a purchase. The retry then sees the reuse and flags it. The transition and receipt functions answer every disallowed move as a status. **No input to these functions produces a perpetual retry, and no path leaves a purchase paid but uncredited without a visible `flagged_mismatch`.** The one remaining throw class is argument validation (`22004` / `22023`); see N-1.

#### Locks, grant, rollback, tenant isolation

- **Locks:** the purchase row only. No advisory lock is taken in `credit`; the adversarial run shows 0 held afterwards. The binding lock order is in §3.5. ✅
- **Grant:** 11 columns, none of them `user_id`, `livemode`, the snapshot or the versions. Proven by MX2. ✅
- **Rollback:** it refuses once any `lot_id` exists, never drops a table, and revokes only the 2b columns. ✅
- **Tenant isolation:** no user id parameter in any function. `out_user_id` comes from the row, and the repository takes no account id (G-3). ✅
- **Paste rules:** pinned by the migration tests (no comments, the literal charset, no **into**, `chr(58)` / `chr(47)` / `chr(95)`). ✅

#### Findings

| # | Where | Finding | Priority |
|---|---|---|---|
| **CR-1** | §6.5 and the parent §6.6 / §6.9 | **The shared checker is post-2b only, and the runbooks do not say so where people will read it.** From the moment the 2b PR merges, `scripts/check-bos-boost-purchases-migration.sql` describes 8 functions and 19 updatable columns. Run on PROD **before** `20261031` is applied, it FAILs B3 31, B5 and B6, and someone could take that as 2a being broken. The warning is only in §6.2's prose. **Fix:** (a) in §6.5, a bold line at the top: "From the 2b merge on, the boost checker describes the post-2b state. Do not run it on PROD until step 2 (apply) is done; the pre-check uses the md5 query instead." (b) In the parent §6.6, a one-line note: "Superseded for re-runs: since 2b, this checker expects `20261031`; to re-check 2a alone, use the copy at `1fbccab8` (`git show 1fbccab8:scripts/check-bos-boost-purchases-migration.sql`)." | **Must-fix (docs), before the PR is merged** |
| **CR-2** | §6.5 step 1 | **The 9-function md5 pre-check is described but not written down.** The user must paste exact SQL and compare it with exact values, never improvise. Add the paste-safe query (`SELECT proname, md5(replace(prosrc, chr(13), '')) … WHERE proname IN (nine names) ORDER BY proname`) and a table of the nine expected md5s: the five from §1 and the four from the parent §6.7. Add one line of expected `to_regprocedure` results. | **Must-fix (docs), before the PROD apply** |
| N-1 | Note for 4a | Argument errors (`22004` / `22023`) from these functions are caller defects. Retrying cannot fix them, and a thrown error would loop for about 3 days. 4a must treat SQLSTATE **class 22** from these RPCs as deterministic: an `error` log with `alert: true`, an audit entry, and the event **completed**. Only other database failures release the claim. 4a's Zod narrowing should make this unreachable, but the handler still needs the rule. | Carry-forward |
| N-2 | Note for 4b | A refund on a `pending`, `awaiting_payment` or `expired` row answers `not_allowed`, so the fact is not stored. That is reachable only if money is refunded before the credit event is processed. 4b logs it at `error` with an audit entry, and the reconcile pass then credits or flags the row. A dispute's won/lost outcome on a flagged row is not stored either (`already`); the dispute id is, and that is enough for an admin. | Carry-forward |
| N-3 | Note for slice 6 | A `flagged_mismatch` purchase is never creditable again. If a 4a bug ever flags rows wrongly, the remedy is an admin refund or a manual grant, not a re-drive. Slice 6's admin view should list flagged rows with their codes. | Carry-forward |

#### Code Approved for QA: **Yes**

QA can start now. CR-1 lands before the 2b PR is merged, and CR-2 before the PROD apply. Both are workplan text only, and SA re-checks them by reading. QA should apply `20261031` in its `qa2a.mjs` (the DEL-6 expectation).

#### Re-check of the QA follow-ups QA2b-D1 and QA2b-D2 (SA, 2026-10-06, diff only)

✅ **Still Code Approved.**

- **D2: the extra lots read.** The new `NOT EXISTS (SELECT … FROM business_os_credit_lots …)` runs inside the same transaction, after the purchase row's `FOR UPDATE` and the `record_credit_lot` call. It is a plain read that takes no row or advisory lock. Lots are append-only and are never updated in place, so it cannot deadlock with or race 11a's writers. The reversal function writes draws, not lots, and slice 9's draw writers will not lock purchases.
- **D2: flag, not throw.** Flagging is right. `out_recorded = false` with a lot that is not *this* purchase's own (source, `source_ref`, account, base, bonus and total all checked against the row snapshot) is a deterministic anomaly. Linking it could double-count credits, and a retry cannot fix it. So it becomes `lot_key_conflict` and returns normally, consistent with C-1.
- **Replay is unaffected.** The `already_credited` check on the row's `lot_id` still runs before any of this. A genuine first-run replay inside the lot function can only return the purchase's own lot, which passes the check.
- **D1: transition order.** `stale` (a lower cumulative refund) is now decided before the `refunded → partially_refunded` refusal, so an out-of-order older refund answers `stale` rather than `not_allowed`. Neither outcome changes anything, and `stale` is the more accurate answer for 4b's logs.
- **Re-run by SA:** the three boost suites pass (161 tests). PGlite: checker 22/0; 2b probe PASS, including the new P07b; `dev2b.mjs` 16/16. The pre-check md5 table needs no change for the 2a and 11a functions. CR-1 and CR-2 stand as before.

## QA Testing Report

### QA — 2b (2026-10-06)

**Verdict:** ✅ **PASS WITH NOTES.** Money correctness holds on every path QA tried:
- One lot per credited purchase, with base + bonus = total, and the account taken from the row.
- A replay never writes a second lot.
- Every deterministic mismatch flags the row and returns normally, with no lot.
- No transition touches a lot or a draw.
- The receipt is fill-only.
- Grants hold.
- The rollback refuses after a credit.

No High or Medium defect. Two Low defects and some Info notes.

**Test mode:** full
**Strategy used:** A + B + C:
- **A:** the Jest suites, plus a scratch repository suite (25 tests).
- **B/C:** an adversarial PGlite script `pglite/qa2b.mjs`, 147 checks. It runs on PGlite 0.5.8 / PostgreSQL 18.3 with Supabase roles emulated, and applies `20261017`, `20261015`, `20261030` and `20261031`. It also includes the md5 pre-check on a separate 2a-only database.

All scratch files are in the session scratchpad and none are committed.
**Focus:** money correctness (credit, transitions, receipt), security (grants), runbook (pre-check, checker, rollback)
**Skipped:** real concurrency (PGlite runs one backend), PROD state, and the SQL editor's paste parsing. The PROD checker and probe remain the proof. `npm run test:bos-entitlements` is left to CI, because the worktree has no `node_modules`.
**Input source:** coordinator brief + workplan §3.0, §6, §7

#### Commands run

| Check | Result |
|---|---|
| 13-suite local bar (scratch config, `--runTestsByPath`) | ✅ **13 suites, 717 tests passed**, 13.3 s |
| Scoped tsc (`tsconfig.slice2b.json`) | ✅ **0 errors in the touched files.** 7 elsewhere, all pre-existing (`lib/geo/countries.ts` 3, `MemoryManager.ts` 2, `CalibrationSessionRepository.ts` 1, `plugin-types.ts` 1), the same as SA's run |
| QA `pglite/qa2b.mjs` | **146 / 147.** The one failure is QA2b-D1 |
| QA `pglite/qa2a.mjs`, now applying `20261031` (per the brief) | **133 / 134.** DEL-6 now passes (2a's QA-D1 fix), and LATE-1 now answers `reservation_expired` (2a's QA-D2 fix). The one failure, `GR-svc-update-lot` ("service_role UPDATE lot_id → allowed"), is the **expected post-2b grant** (Q-2). The table CHECK is the backstop, and `qa2b` proves it (`23514` on unlinking a paid row) |
| QA scratch repository suite `qa/boostRepo2b.qa.test.ts` | ✅ 25 / 25. `credit`, `transition` and `recordReceipt` resolve `{ error }` on a null input. All 10 flag codes map. An unknown flag code → error. `credited` without a lot → error. The account comes from the row. A `23505` → error. Every transition outcome maps. Target `paid` and fractional amounts are refused client-side without an RPC. Re-running the 2a repository suite confirms the 2a fix: null inputs now resolve to `{ error }` |
| Source untouched | ✅ The SHA-1 of the 10 non-doc changed files and the `git status --porcelain` output match the pre-QA snapshot. No source was mutated |

#### Test matrix

| Area | Ids | Result | Notes |
|---|---|---|---|
| Happy credit with a bonus (Plus: 12,500 + 1,250) | CR-1..4 | ✅ | `credited`; `out_user_id` comes from the row. **Exactly 1 lot:** base 12,500, bonus 1,250, granted 13,750, source `boost_purchase`, key `boost:` ∥ session, `source_ref` = purchase id, actor `stripe_webhook`, no admin, reason or expiry, user = the row's. The row is `paid` with the lot, `paid_at`, payment intent and amounts. Credited with `'usd'` |
| Replay | CR-5 | ✅ | Same args → `already_credited`, same lot. Garbage args (another session, 9999, `EUR`, live) → still `already_credited`. Lots +1 in total |
| Tax (T-14) | CR-6 | ✅ | Tax 170, total 1,170 → the same 5,000-credit lot |
| Currency variants | CR-cur | ✅ | `' USD '` and `'Usd'` are credited; `'EUR'` → `currency_mismatch` |
| Expired and awaiting rows creditable (Q-5, C-6) | CR-7, CR-8 | ✅ | |
| Every mismatch code returns normally, with no lot | MM-* | ✅ | `no_session`, `session_mismatch`, `payment_intent_mismatch` (the stored intent is kept), `livemode_mismatch`, `currency_mismatch`, `amount_mismatch`, `total_mismatch`, `payment_intent_reused` (no intent stored), `account_deleted` (local auth delete), `lot_key_conflict`. Each: no exception; the row is `flagged_mismatch` with the code; `lot_id` NULL; lots +0. A later `credit` on a flagged row → `not_creditable` |
| Not creditable | NC-* | ✅ | Abandoned, failed and flagged → `not_creditable`. A refunded row → `already_credited`, because the lot is checked first (§3.1 step 3, by design) |
| Deterministic vs transient | ARG-* | ✅ | Only argument defects throw, all class 22: a NULL intent gives `22004`; a bad session or intent prefix, or a negative tax, gives `22023`; a tax of 2,147,483,647 gives `22003` (integer overflow in the total check). The row is unchanged. These fall under N-1 |
| Refund ladder | TR-A | ✅ except one | Partial 300: `transitioned`; again: `already`; 200: `stale`; 1,000 as partial: `not_allowed`; 1,001: `not_allowed`; 600 as refunded: `not_allowed`; refunded 1,000: `transitioned`; again: `already`; refund 0: `not_allowed`. **A partial 500 arriving after the full refund → `not_allowed`, not `stale` (QA2b-D1)** |
| Refund → dispute → refund while disputed → won | TR-B | ✅ | `recorded` while disputed; a lower amount → `stale`; won with the wrong dispute id → `not_allowed`; won → **`partially_refunded`** with 500 refunded; won again → `already` |
| Dispute → full refund while disputed → won | TR-C | ✅ | Over-total while disputed → `not_allowed`; won → **`refunded`** |
| Won with no refund; second dispute; lost | TR-D | ✅ | Won → `paid`; a new dispute after the win is allowed; lost → `dispute_lost`; again → `already`; a refund after lost → `recorded` with the status kept; won after lost → `not_allowed`; a new dispute on `dispute_lost` → `not_allowed` |
| Pre-payment moves | TR-E, TR-F | ✅ | `awaiting_payment` → `transitioned` / `already`; a different intent → `not_allowed`; a refund or dispute on awaiting → `not_allowed` (N-2); failed, then expired → `not_allowed`; a reused intent → `mismatch` / `payment_intent_reused` |
| Flagged rows record facts (C-4) | TR-FL | ✅ | Refund 500 → `recorded`; 400 → `stale`; 999 (= the reported total) → `recorded`; 1,000 → `not_allowed`; a dispute → `recorded`; another dispute id → `not_allowed`; won or lost → `already`. The status and `lot_id` never change |
| Invalid targets | TR-bad | ✅ | `paid`, `pending`, `abandoned`, `PAID`, a refund without an amount, and a `ch_` dispute id each → `22023`. A missing row → `not_found` |
| Lots and draws untouched by transitions (C-8 d) | TR-lots, TR-draws, TR-lot-kept | ✅ | Earlier lots are byte-identical, the lot count changed only through the five credits, 0 draws, and every credited row keeps its `lot_id` through refunds and disputes |
| Receipt, fill-only (C-8 a) | RC-* | ✅ | Pending → `not_paid`; fill → `recorded`; same → `already_recorded`; a different URL or charge → `conflict`, with no overwrite and the status still `paid`; another row's charge → `conflict`; charge present and URL missing → `recorded` (fills the URL only); a refunded row → `recorded`; a flagged row → `not_paid`; `http://`, `txn_` and a URL over 2,048 chars → `22023` |
| Grants | GR-* | ✅ | The owner reads their own receipt, tax, total, refunded and `paid_at`; another owner sees 0 rows. Owner SELECT of the payment intent, charge id, `lot_id`, `flag_reason`, `amount_subtotal_minor` or `stripe_dispute_id` → `42501`. anon and authenticated: EXECUTE of all 3 functions and UPDATE → `42501`. service_role UPDATE of `user_id`, `livemode`, the price, any `credits_*`, `package_*`, either version, the currency, the tax flag or `created_at`, and DELETE → `42501`. Unlinking a paid row's lot → `23514` |
| Checkers after real credits | CK-* | ✅ | The boost checker gives **22 pass, 0 fail**; the lots and charges checkers give 0 FAIL rows |
| Checker plants (inside a rolled-back transaction) | CK-plant-* | ✅ | Orphan boost lot → **72 FAIL**. Two purchases' lots swapped → **71, 72 and 74 FAIL**. A lot's credits edited → **71, 72 and 74 FAIL** |
| Probes | PR-* | ✅ | The 2b probe gives `PROBE PASS`. The 2a probe after 2b, on a fresh account, gives `PROBE PASS` (deviation 1). Probes kept 0 lots |
| Rollback after a credit | RB-refused | ✅ | `ROLLBACK REFUSED  a boost purchase already holds credits …`, and the functions are still present |
| md5 pre-check (§6.5, CR-2) | PC-* | ✅ | The query was extracted verbatim from §6.5. It is paste-safe: no comments, 14 literals all `[A-Za-z0-9_ ]`, no **into**. On a 2a-only database it returns **exactly the 9 rows of the §6.5 table, in order, with equal md5s**. After `20261031` the same query returns 12 rows, which is the "stop" signal |

#### Issues Found

##### Bugs

1. **QA2b-D1: an out-of-order partial refund after a full refund is answered `not_allowed`, not `stale`.** Severity: **Low**, because the data stays correct; the cost is 4b alert noise. File: `20261031`, `business_os_transition_boost_purchase`, in the refund branch.
   - Steps to reproduce: credit 1,000. Transition to `refunded` with 1,000. Then transition to `partially_refunded` with 500. This is a cumulative event from an earlier partial refund delivered late, which is realistic: two partial refunds that sum to the total, with events delivered in reverse.
   - Expected: `stale`. It is a lower cumulative amount, the same as 300 → 200, which answers `stale`.
   - Actual: `not_allowed`. The `refunded` + `partially_refunded` → `not_allowed` rule runs **before** the `p_amount_refunded_minor < v_refunded` → `stale` check.
   - Impact: no data change. 4b would treat a normal Stripe re-ordering as an error and alert on it.
   - Fix: evaluate the `stale` check before the `refunded → partially_refunded` rule. Keep `not_allowed` for an equal or higher amount. Add a P08 line. SA Q-7's "refunded → partially_refunded stays not_allowed" still holds for a non-lower amount.
2. **QA2b-D2: a pre-existing boost lot with the same key, user and total is linked silently.** Severity: **Low**. It is not reachable through the functions; it is defence in depth. File: `20261031`, `credit`.
   - Steps to reproduce: write a boost lot with key `boost:<session>`, the same user and the same **granted total**, but a different base/bonus split (4,000 + 1,000 against the snapshot's 5,000 + 0) and a foreign `source_ref`. Then credit the purchase.
   - Expected: `mismatch` / `lot_key_conflict`, like the different-total case (C-1).
   - Actual: `credited` with **0 new lots**, and the purchase linked to the foreign lot. `record_credit_lot`'s replay branch compares only user, source and total. The checker catches it afterwards (71, 72 and 74 FAIL).
   - Reachability: a `boost:` key is only ever written by `credit` under the row lock, and the session id is UNIQUE. Only an out-of-band lot write could cause this.
   - Fix (optional): when `out_recorded = false`, check that the lot's `source_ref = p_purchase_id`. Otherwise flag `lot_key_conflict`.

##### Performance Issues

None measurable here.

##### Info

- **I-1:** a row flagged through `transition` (`flagged_mismatch`, or `payment_intent_reused` from `pending`) has no reported amounts. A refund on it is therefore unbounded: 99,999,999 → `recorded`. That is harmless, because the value is only a recorded fact, but 4b should log it.
- **I-2:** an absurd tax (2,147,483,647) throws `22003` from integer overflow in the total check rather than flagging. It is class 22, so it falls under N-1. Stripe amounts cannot reach it.
- **I-3:** validation errors raised in the repository itself (bad prefix, fractional amount) come back as `{ error }` with no SQLSTATE. 4a's N-1 rule ("class 22 → complete the event") should treat these repository refusals as deterministic too, or 4a's Zod narrowing must make them unreachable.
- **I-4:** the brief expected "credit on a refunded row → `not_creditable`". It answers **`already_credited`**, which is correct by §3.1 step 3: the lot is checked before the status, so a replay after a refund still converges.
- **I-5:** the 2a QA findings are confirmed fixed on this branch: the checker no longer FAILs B7 on detached overrides, a stale reservation's late attach answers `reservation_expired`, and the 2a repository methods resolve `{ error }` on a null input. An attach `23505` now maps to `boost_checkout_session_in_use`.

#### Recommended additions

| # | Test | Where | Priority |
|---|---|---|---|
| R-1 | Full refund, then a late lower partial → `stale` | probe P08 + migration test | With the QA2b-D1 fix |
| R-2 | A same-total foreign boost lot under the key → `lot_key_conflict` (if D2 is fixed), or a checker-plant test (71/72/74 FAIL) if not | probe P07 / migration test | Should |
| R-3 | Both refund/dispute interleavings as written in TR-B and TR-C, including `stale` while disputed and over-total while disputed | probe P08 | Nice (P08 covers the main orders) |
| R-4 | Receipt partial fill: charge present, URL missing → only the URL filled | probe P09 | Nice |
| R-5 | Owner SELECT of `stripe_dispute_id` and `amount_subtotal_minor` → `42501` (the 2b-written hidden columns) | probe P11 | Nice |
| R-6 | Checker plant: a lot's credits differ from the snapshot → 71/74 FAIL | migration test (checker text) or PGlite only | Nice |

#### Test Outputs / Logs

```text
13-suite bar:  Test Suites: 13 passed, 13 total   Tests: 717 passed, 717 total   Time: 13.342 s
qa2b.mjs:      QA 2b probes: 146 pass, 1 fail
               FAIL TR-A partial after refunded :: not_allowed (want stale), status refunded
               PASS MM-same-total-orphan :: INFO ... credit credited, new lots 0, linked lot source_ref foreign true
               PASS MM-same-total-orphan-checker :: 71 ... 72 ... 74 FAIL
               PASS CK-clean :: checker after all credits: 22 pass 0 fail
               PASS PR-2b :: PROBE PASS ... | PR-2a :: PROBE PASS ... (fresh account, after 2b)
               PASS RB-refused :: ROLLBACK REFUSED  a boost purchase already holds credits so the crediting functions were kept
               PASS PC-2a-db :: 2a-only DB: 9 rows, equal to the workplan table in order: true
qa2a.mjs:      QA 2a probes: 133 pass, 1 fail  (GR-svc-update-lot: expected post-2b grant, Q-2)
Scoped tsc:    7 errors, all outside the diff (countries.ts 3, MemoryManager.ts 2, CalibrationSessionRepository.ts 1, plugin-types.ts 1)
```

#### Final Status
- [x] The 2b acceptance criteria pass. Ready for the PR once the user has seen the diff. QA2b-D1 and QA2b-D2 are Low: fix them in this PR or carry them to 4b. SA's CR-1 and CR-2 doc items are in place, and the pre-check was verified above.
- [ ] Issues found that the Dev must address before commit

## Commit Info

*(RM populates.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-06 | Created | Slice 2b workplan drafted against main `1fbccab8` (after #233 and the 2a PROD apply). Migration 20261031: credit, transition and receipt functions, an 11-column UPDATE grant, the checker updated to the post-2b state, a new probe (no `auth.users` writes), a rollback that never drops a table. Eight SA questions; no business question |
| 2026-10-06 | SA workplan review: approved with conditions | C-1 a lot-key 23505 is flagged `lot_key_conflict`, not thrown (deterministic, so no Stripe retry loop). C-2 compare currency with `upper(btrim())` (Stripe sends `usd`). C-3 dispute won restores the pre-dispute status from the refunded amount; a refund on a disputed row is recorded. C-4 refund and dispute facts recorded on flagged rows. C-5 the probe neutralises an existing cap override. C-6 payment-intent identity checks. Q-1 to Q-8 agreed. No user question |
| 2026-10-06 | Implemented; Code Complete | C-1 to C-6 applied (§3.0), C-7 recorded. Migration 20261031, the shared checker moved to post-2b, the 2b probe (P00–P14, no `auth.users` writes), the rollback, the migration test, repository methods and tests, the entitlements doc paragraph. 13 suites / 717 tests; scoped tsc 0 errors in the touched files; PGlite checker, both probes, rollback and adversarial 13/13 green (§7.5). Nothing committed |
| 2026-10-06 | SA code review (2b): Code Approved for QA | 13 suites and 717 tests green. PGlite: checker PASS 22/0, 2b probe P00–P14 PASS, 2a probe PASS, rollback refuses, adversarial 13/13. My mutations (no FOR UPDATE; `user_id` in the grant) caught by the test and by checker B3. C-1 to C-7 met; deviations 1–7 accepted. The 7 tsc errors are pre-existing. The status-line tidy lost nothing. Must-fix (docs): CR-1 the checker is post-2b only, warned in §6.5 and the parent §6.6; CR-2 the exact 9-function md5 query and values in §6.5. Notes N-1 to N-3 for 4a, 4b and slice 6 |
| 2026-10-06 | SA code review (2b) doc fixes CR-1, CR-2; notes N-1 to N-3 | §6.5: warning not to run the post-2b checker on PROD before the apply; the exact paste-safe nine-function md5 pre-check query; the table of the nine expected values; the 2b functions expected absent. §9: N-1 (class-22 errors complete the event), N-2 (refunds on unpaid rows; dispute outcomes on flagged rows), N-3 (slice 6 lists flagged rows). No code change |
| 2026-10-06 | QA (2b): PASS WITH NOTES | 13 suites / 717 green; scoped tsc 0 errors in the touched files. PGlite `qa2b.mjs` 146/147: credits with a bonus write exactly one lot, with the account from the row; replay converges; all 10 mismatch codes flag with no lot and no throw; expired and awaiting rows are credited; both refund/dispute interleavings restore the right status; flagged rows record facts; the receipt is fill-only; grants hold; the checkers pass after credits and catch orphan, swapped and edited lots; both probes pass; the rollback refuses after a credit; the §6.5 md5 pre-check is paste-safe and returns exactly the 9 tabled rows on a 2a-only database. `qa2a.mjs` with 20261031 applied: 133/134, where the one failure is the expected post-2b `lot_id` grant. QA2b-D1 (Low): a late partial refund after a full refund answers `not_allowed` instead of `stale`. QA2b-D2 (Low): a same-total foreign lot under the key is linked silently (unreachable through the functions; the checker catches it). Recommended tests R-1 to R-6 |
| 2026-10-06 | QA (2b) follow-ups applied | D1: a lower refund is `stale` before the refunded-to-partial rule. D2: an already-recorded lot is linked only if it is the purchase's own lot (otherwise `lot_key_conflict`). Probe P07b, plus P08, P09 and P11 additions (R-1 to R-5); the R-6 checker plant in PGlite; notes I-1 and I-3 in §9. 13 suites / 719 tests; `qa2b` 147/147; `qa2a` 133/134 (by design); `dev2b` 16/16; md5 pre-check unchanged. Nothing committed |
| 2026-10-06 | SA re-check of the QA follow-ups D1 and D2: still Code Approved | The lots read in `credit` is lock-free and append-only-safe inside the row-locked transaction. A lot that is not the purchase's own is flagged `lot_key_conflict`, not linked or thrown. Replay is unaffected. `stale` ordering is correct. 161 tests and PGlite (checker 22/0, probe incl. P07b, dev2b 16/16) re-run green |
| 2026-10-06 | 2b approved and committed, PR #235 open | The user saw the diff and approved the commit (2026-10-06). RM committed on `feature/bos-credits-boost-slice-2b` and opened [PR #235](https://github.com/AgentsPilot/neuronforge/pull/235) to `main`. PROD apply of 20261031 is pending: the user runs §6.5 after merge. Do NOT run `scripts/check-bos-boost-purchases-migration.sql` on PROD before 20261031 is applied (SA CR-1) |
| 2026-10-06 | 2b applied to PROD and verified | The user applied 20261031 at 16:44:09 UTC (PG 17.4; the pre-check md5s matched §6.5). Boost checker PASS 22/0, lots (23/0) and charges (19/0) checkers PASS, probe PASS on the user's own account, recheck PASS 22/0 with 0 rows kept. The one lot draw (a reversal of the admin test grant) is not from boost. Results in §6.6. PR #235 awaiting merge |
