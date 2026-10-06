# Workplan: Business OS credits boost — slice 2, purchases and cap-override tables

> **Last Updated**: 2026-10-06

**Developer:** Dev
**Requirement:** [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md): FR-8, FR-9, FR-13 to FR-23, FR-30 to FR-34, FR-43, NFR-2, NFR-4, NFR-9, NFR-12, §17, DEP-10; SA rulings §18.3 T-2, T-4 to T-10, T-14; §18.4 standards; §18.8 R-1 to R-5; §18.9; §18.10 slice 2 row, B-1, B-6, B-8, R-6, R-9, R-10, R-13
**Previous slice:** [BUSINESS_OS_CREDITS_BOOST_SLICE_1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_1_WORKPLAN.md) (merged, PR #224)
**Runbook model:** [BUSINESS_OS_CREDIT_DEDUCTION_SLICE_11_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_11_WORKPLAN.md) §3, §6 and §7 (11a: the lots tables this slice links to)
**Worktree:** `neuronforge-boost`
**Branch:** `feature/bos-credits-boost-slice-2`, cut from `origin/main` `b3c32ea7` (includes slice 1, PR #224). Confirmed with `git branch --show-current` on 2026-10-05; the worktree was clean before the switch. 2b, if SA accepts the split, gets its own branch from RM.
**Date:** 2026-10-05
**Status:** **2a approved and committed 2026-10-06, PR open; PROD apply pending (user, §6.6).** **2a QA 2026-10-05: PASS WITH NOTES** (QA-D1 Medium checker fix owed before the PR; QA-D2/D3 Low; see QA Testing Report). **2a SA code review 2026-10-05: Code Approved for QA** (CR-1 migration-number record owed before the PR; CR-2 `version()` in the pre-check). 2a Code Complete 2026-10-05. SA workplan review: approved with conditions C-1 to C-8 (split 2a/2b approved); C-1 to C-7 applied (§3.4a), C-8 recorded for 2b. Local bar and PGlite run green (§6.8, §7.5). 2b not started. Nothing is committed.

## Overview

Slice 2 creates the two tables a boost purchase needs and the SQL functions that are their only write path. **`business_os_boost_purchases`** is one row per attempt to buy a package. It is the cap reservation, the webhook's routing identity, the snapshot of what was sold (FR-4), and the link to the credit lot. **`business_os_boost_cap_overrides`** holds an admin's per-account change to the $150 / 30-day cap. Crediting goes through the existing `business_os_record_credit_lot(...)` with `source = 'boost_purchase'`. The lots and draws tables and both lot functions (credit deduction 11a, migration 20261017) stay byte-identical. Nothing is wired to a route or a screen. The user applies the migration to PROD by hand and runs a checker and a write probe.

The work is about 3.5 days if done in one piece, above the ~2 days the slice should take. **This workplan proposes two sub-slices, each with its own migration, PR and PROD apply** (§2.1):

- **2a, reservation and cap** (migration `20261030`, ~2 d). Both tables with their full column set, RLS and grants. The reserve, attach-checkout and abandon functions, and the cap-override set and end functions. The repository, the registries, a checker, a probe and a rollback. This is everything slice 3 (checkout) needs.
- **2b, crediting and status** (migration `20261031`, ~1.5 d). The credit function, which calls `business_os_record_credit_lot`, and the status-transition function. Repository methods, an extended checker and probe. This is everything 4a and 4b need. It can be built while slice 3 is in review.

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope, split, out of scope and guardrails](#2-scope-split-out-of-scope-and-guardrails)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Task List](#5-task-list)
6. [Checker, probe, rollback and the PROD runbook](#6-checker-probe-rollback-and-the-prod-runbook)
7. [Test Plan](#7-test-plan)
8. [CI impact](#8-ci-impact)
9. [Entitlements registration](#9-entitlements-registration)
10. [Estimate and risks](#10-estimate-and-risks)
11. [Open questions for SA](#11-open-questions-for-sa)
12. [SA Review Notes](#sa-review-notes)
13. [QA Testing Report](#qa-testing-report)
14. [Commit Info](#commit-info)
15. [Change History](#change-history)

---

## 1. Analysis Summary

**Verified in this worktree at `b3c32ea7` (2026-10-05).** Every name below was read from the migration body, not the filename (`business-os-schema-check` Rule 3). Whether each is live on PROD is established by the runbook pre-check (§6.6 step 2). An agent cannot run `npm run schema:check` here: the worktree has no `node_modules` and no database credentials.

| Thing | Where | Relevance |
|---|---|---|
| `business_os_credit_lots`: `id, user_id, source, credits_granted, credits_base, credits_bonus, credit_value_version, expires_at, idempotency_key, source_ref, actor_kind, actor_admin_id, reason, created_at`. CHECK `boost_purchase_shape`: actor `stripe_webhook`, no admin, no reason, `source_ref NOT NULL`, key prefix `boost:` | `20261017_business_os_credit_lots.sql` (applied to PROD 2026-10-02, 11a §17) | `lot_id` FK target (2a). The credit function writes one lot through `business_os_record_credit_lot` (2b). **Not altered** |
| `business_os_record_credit_lot(p_user_id, p_source, p_credits_base, p_credits_bonus, p_credit_value_version, p_expires_at, p_idempotency_key, p_source_ref, p_actor_kind, p_actor_admin_id, p_reason)` → `(out_recorded, out_lot_id)`. `SECURITY INVOKER`, EXECUTE to service_role only. Raises `22004` on a NULL user or key and `23505` when a key is reused for a different lot | same | Called from inside the 2b credit function, in the same transaction (§18.10 superseded row). A nested INVOKER call by service_role works because service_role holds EXECUTE and INSERT on lots |
| `business_os_account_plans.user_id` (PK, FK `auth.users` CASCADE) | `20261005_business_os_entitlements.sql` | Reserve refuses an account with no plan row (FR-9, T-10) |
| `business_os_entitlement_overrides` (ended, never deleted; `reason ≥ 3`; `actor_admin_id`; `ended_*`) | same | Shape mirrored by the cap-override table (T-10) |
| `business_os_billing_accounts` | `20261025` (P-2a) | **Not referenced** by slice 2. Slice 3 reads it (R-9) |
| `currentStripeMode()` / `isLiveMode()` | `lib/business-os/billing/stripeMode.ts` | Slice 3 passes `livemode` to reserve (R-10). Slice 2's SQL takes it as a parameter |
| Slice 1: `BoostPackage` (base, bonus, total credits, versions), `BOOST_PURCHASE_CAP_DEFAULT` | `lib/business-os/entitlements/boostCatalogue.ts`, `config/boostPackages.ts` | **Not imported in slice 2.** The repository takes plain fields; slice 3 maps a package into them (§9) |
| Paste rules for SQL files | 11a §1 "Why no `--` comments"; `scripts/__tests__/entitlementSqlScripts.guard.test.ts`; 11a migration test | No comments; literals only `[A-Za-z0-9_ ]`; a colon is `chr(58)` and an underscore inside a prefix is `chr(95)` (P-2a precedent); no single-letter aliases; standalone statements. The SQL editor also misparses the word **into** inside a string literal, so no `COMMENT ON` text or message uses it |
| Migration block | Requirement R-4 / B-8 | `20261030` to `20261034` are reserved for boost and still free on `main`. 2a takes `20261030` and 2b takes `20261031` |
| Registries | `lib/business-os/businessOwnedTables.ts` (`USER_OWNED_TABLES`), `lib/business-os/purge/descriptors.ts` + `__tests__/classification-baseline.json` (count 144), `lib/business-os/account/accountDeletionPolicy.ts` | Both new tables: `never` purged, keyed to `auth.users`, `minimise` on deletion (NFR-12, F-11) |

**What this slice touches:** two new tables, five SQL functions (2a) plus two (2b), one repository, three registry files plus the purge baseline, one paragraph in the entitlements doc, and the requirement. **No route, no UI, no Stripe call, no flag, no V6 or pilot code, no LLM call.**

---

## 2. Scope, split, out of scope and guardrails

### 2.1 The proposed split

| | 2a — reservation and cap | 2b — crediting and status |
|---|---|---|
| Migration | `20261030_business_os_boost_purchases.sql` | `20261031_business_os_boost_crediting.sql` |
| Creates | Both tables in full: every column, CHECK, index and FK, including those only 2b writes, so 2b needs no `ALTER TABLE` of shape. RLS, owner policy and grants. Functions `reserve`, `attach_checkout`, `abandon`, `set_cap_override`, `end_cap_override` | Functions `credit_boost_purchase` and `transition_boost_purchase`. The extra column UPDATE grants those two need (§3.3) |
| Repository | `BusinessOsBoostPurchaseRepository`: reserve, attach, abandon, reads, cap-override set, end and read | The same class gains `credit` and `transition` |
| Unblocks | Slice 3 (checkout) and slice 6's override operation | 4a (resolver and handler) and 4b (refunds, disputes, reconcile pass) |
| Est. | ~2 d | ~1.5 d |

**Why split here:** slice 3 needs only the reservation, and money never arrives before 4a. The crediting function is the most sensitive SQL in the feature (T-6), so it gets its own review, probe and PROD apply rather than sharing them with ten other objects. **Why the full table shape lands in 2a:** a CHECK on `status` and the paid-row consistency rules are easier to review once than to widen later. 2b's migration then only adds functions and grants. If SA prefers one migration, the two task lists merge into one PR of about 3.5 days (Q-1).

### 2.2 In scope

| # | Item | Sub | Requirement |
|---|---|---|---|
| S-1 | `business_os_boost_purchases`: snapshot, livemode, status lifecycle, Stripe ids UNIQUE, amounts (subtotal, tax, total), receipt, refund and dispute facts, `lot_id` UNIQUE FK | 2a | FR-4, FR-13, FR-14, FR-30, T-4, T-5, T-9, T-14, R-10 |
| S-2 | `business_os_boost_cap_overrides`: one active row per account, ended and never deleted | 2a | FR-22, T-10 |
| S-3 | RLS, the owner column grant on purchases (for slice 5's history), no client writes, function EXECUTE to service_role only | 2a | FR-34, NFR-2 |
| S-4 | `business_os_reserve_boost_purchase`: plan row, cap under the boost cap lock, insert `pending` | 2a | FR-9, FR-20, FR-23, T-10, R-13 |
| S-5 | `business_os_attach_boost_checkout`, `business_os_abandon_boost_purchase` | 2a | T-4, T-10 |
| S-6 | `business_os_set_boost_cap_override`, `business_os_end_boost_cap_override` | 2a | FR-22, T-10 (the admin route is slice 6) |
| S-7 | `business_os_credit_boost_purchase`, calling `business_os_record_credit_lot` | 2b | FR-13 to FR-16, T-5, T-6, R-10 |
| S-8 | `business_os_transition_boost_purchase` (awaiting payment, failed, expired, mismatch, refund and dispute phases) | 2b | T-7, T-9, R-6, FR-43 |
| S-9 | Checker, mandatory write probe and rollback for each migration; migration tests | 2a, 2b | 11a precedent |
| S-10 | Repository (new-repository skill) with unit tests | 2a, 2b | NFR-4, §18.4 |
| S-11 | Registries: owned tables, purge descriptors and baseline, account deletion policy | 2a | NFR-12, F-11 |
| S-12 | Docs: one paragraph in the entitlements doc § Metering; the requirement status and Change History | 2a, 2b | doc standards |

### 2.3 Explicitly out of scope

| Not in slice 2 | Where it goes |
|---|---|
| Re-creating or altering `business_os_credit_lots`, `_lot_draws`, `business_os_record_credit_lot` or `business_os_reverse_credit_lot` | Never (guardrail G-1) |
| Any route: checkout, owner history, admin view, admin override route | Slices 3, 5, 6 |
| Any Stripe call, the webhook resolver and handler, the reconcile pass | Slices 3, 4a, 4b |
| `readPaymentHold` (R-1), the server flag (F-14), `currentStripeMode()` at run time | Slice 3 (the route). Slice 2's SQL takes `livemode` as a parameter |
| Mapping a slice 1 `BoostPackage` into a reservation | Slice 3 (it is the first importer of slice 1 code from outside the module, §9) |
| **(SA C-6)** The payment-hold refusal (R-1) and the server flag | Slice 3: the checkout route calls `readPaymentHold` (fail closed) and checks the flag **before** `reserve`. The SQL does not duplicate the hold predicate, which lives in lineage reads in TypeScript; a second definition would drift |
| Automatic clawback; any write to a lot on refund or dispute | Parked (T-9, P-3) |
| Writing `business_os_account_lineage`, `business_os_account_plans` or anything the payment hold reads | Never (R-2) |
| A Stripe customer | Never (R-9) |

### 2.4 Guardrails (must not)

| # | Guardrail | How it is checked |
|---|---|---|
| G-1 | Lots, draws and both lot functions byte-identical; the charge path untouched | Checker row B8 (md5 of the four function bodies and the four tables' column lists against constants the migration test computes from `20261015` and `20261017`). `git diff --stat` shows neither migration |
| G-2 | No `SECURITY DEFINER`, no trigger, no `IF NOT EXISTS` | Migration test |
| G-3 | No client role can write either table or execute any function | Migration test (grants); checker B2, B3, B6; probe |
| G-4 | `user_id` is never taken from Stripe data. Every function that acts on a purchase id either takes the account and checks it (2a) or returns the row's own account (2b, R-6) | Function tests; probe stranger steps |
| G-5 | The repository never calls `.insert(`, `.update(`, `.delete(` or `.upsert(` on either table; writes are RPCs only | Source guard in the repository test |
| G-6 | Paste rules on every SQL file (no comments, literal charset, `chr(58)` / `chr(95)`, no **into** inside a literal) | Migration test |
| G-7 | No import from `lib/business-os/entitlements/` in slice 2 code | Source guard; `enforcementPoints` stays green with no new entry |
| G-8 | No new npm dependency, workflow or CI job | `git diff --stat` |

---

## 3. Implementation Approach

### 3.1 `business_os_boost_purchases` (2a)

Columns, in order. Money is `integer` minor units, as the plan-payments tables use; credits are `numeric(18,6)`, as the lots use.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()`. It is the purchase reference, Stripe `client_reference_id` and the lot's `source_ref` |
| `user_id` | uuid | yes | FK `auth.users` `ON DELETE SET NULL`. NULL only after the account is deleted |
| `livemode` | boolean | no | Set at reservation from the server key's mode (R-10) |
| `status` | text | no | Default `pending`. See the lifecycle below |
| `package_id` | text | no | 1–32 chars |
| `package_version` | integer | no | > 0 |
| `retail_version` | integer | no | > 0 |
| `credit_value_version` | integer | no | ≥ 0 |
| `price_minor` | integer | no | > 0 |
| `currency` | text | no | CHECK `= 'USD'` (FR-28) |
| `tax_exclusive` | boolean | no | CHECK `= true` (TX-1) |
| `credits_base` | numeric(18,6) | no | > 0 |
| `credits_bonus` | numeric(18,6) | no | ≥ 0 |
| `credits_total` | numeric(18,6) | no | CHECK `= credits_base + credits_bonus`. These are the figures the lot will carry (FR-4) |
| `checkout_expires_at` | timestamptz | no | Set at reserve (now + TTL), replaced by Stripe's `expires_at` at attach |
| `stripe_checkout_session_id` | text | yes | UNIQUE; shape `cs` ∥ `_` prefix, **≤ 194 (SA C-2)**: the lot key `boost:` ∥ session id must fit the lots table's 200-character key limit, and `attach` refuses a longer id with `22023` |
| `stripe_payment_intent_id` | text | yes | UNIQUE; shape `pi_`, ≤ 255 |
| `stripe_charge_id` | text | yes | UNIQUE; shape `ch_` or `py_`, ≤ 255 (T-8: written by 2b / 4a) |
| `receipt_url` | text | yes | `https://`, ≤ 2048 |
| `amount_subtotal_minor` | integer | yes | ≥ 0; set on crediting (T-14) |
| `amount_tax_minor` | integer | yes | ≥ 0; 0 while tax collection is off |
| `amount_total_minor` | integer | yes | ≥ 0 |
| `amount_refunded_minor` | integer | no | Default 0, ≥ 0, ≤ `amount_total_minor` when that is set (T-9) |
| `stripe_dispute_id` | text | yes | Shape `dp_` or `du_`, ≤ 255 |
| `flag_reason` | text | yes | 1–64 chars, a code such as `amount_mismatch` (T-4). Set only with `flagged_mismatch` |
| `lot_id` | uuid | yes | UNIQUE; FK `business_os_credit_lots(id)` (no `ON DELETE`: lots are never deleted) |
| `paid_at` | timestamptz | yes | |
| `status_changed_at` | timestamptz | no | Default `now()` |
| `created_at`, `updated_at` | timestamptz | no | Default `now()`; set by the functions (there is no trigger) |

**Status lifecycle** (CHECK lists exactly these 11):

| Status | Set by | Counts toward the cap (T-10) |
|---|---|---|
| `pending` | reserve | Yes, while `now() < checkout_expires_at + 5 min` |
| `abandoned` | abandon (session creation failed) | No |
| `awaiting_payment` | transition (`payment_status = unpaid`, T-7) | Yes |
| `paid` | credit; or transition `dispute_won` | Yes |
| `failed` | transition (`async_payment_failed`) | No |
| `expired` | transition (`checkout.session.expired`) | No |
| `flagged_mismatch` | credit or transition (deterministic mismatch) | Yes (conservative, T-10) |
| `partially_refunded`, `refunded` | transition (T-9) | Yes (conservative; the override is the remedy) |
| `disputed`, `dispute_lost` | transition (T-9) | Yes |

**Consistency CHECKs** (each named and pinned by the migration test):

- A paid-family row (`paid`, `partially_refunded`, `refunded`, `disputed`, `dispute_lost`) has `lot_id`, `paid_at`, `stripe_payment_intent_id` and all three amounts.
- A `lot_id` appears only on a paid-family row.
- `flag_reason` is set if and only if the status is `flagged_mismatch`.
- `abandoned` has no session id.
- Every CHECK refers to its own row only. No CHECK names `user_id`, so the `ON DELETE SET NULL` detach can never be refused.

**Indexes:** `(user_id, livemode, created_at)` for the cap sum and the owner list. The UNIQUE constraints index the three Stripe ids and `lot_id`.

### 3.2 `business_os_boost_cap_overrides` (2a)

`id, user_id (FK auth.users SET NULL), cap_minor integer > 0, currency text = 'USD', reason text (btrim 3–500), actor_admin_id uuid NOT NULL (no FK, as entitlement overrides), created_at, ended_at, ended_by_admin_id, ended_reason`. A CHECK makes the three `ended_*` columns all set or all NULL, with `ended_reason` 3–500 chars when set. A partial UNIQUE index on `(user_id) WHERE ended_at IS NULL` allows **at most one active override per account**. Rows are ended, never deleted. The FK is to `auth.users` rather than the plan row (the entitlement overrides use the plan row with CASCADE), because NFR-12 makes it a retained record detached by `SET NULL`.

### 3.3 RLS and grants

Both tables: `ENABLE ROW LEVEL SECURITY`, then `REVOKE ALL` from PUBLIC, anon, authenticated and service_role (never an enumerated list), then:

| Grant | Why |
|---|---|
| Purchases: policy `business_os_boost_purchases_owner_select` (`FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id)`) plus `GRANT SELECT (id, user_id, livemode, status, package_id, package_version, credits_base, credits_bonus, credits_total, price_minor, currency, tax_exclusive, amount_tax_minor, amount_total_minor, amount_refunded_minor, receipt_url, paid_at, created_at)` to `authenticated` | FR-26: slice 5's history reads it through the owner's RLS client, as 11d reads lots. Hidden: Stripe ids, `lot_id`, `flag_reason`, `checkout_expires_at`, the version columns and `updated_at`. A column added later is hidden by default. **Q-3** |
| Cap overrides: no policy and no client grant | Admin-only (slice 6) |
| Purchases: service_role `SELECT`, column-level `INSERT` (SA C-1, §3.4a), plus `UPDATE (status, stripe_checkout_session_id, checkout_expires_at, status_changed_at, updated_at)` in 2a | Every function is `SECURITY INVOKER`, so service_role needs the privileges it uses. Column-level UPDATE only, so the snapshot, the price, the credits, `livemode` and `user_id` can never be updated |
| Purchases: 2b adds service_role `UPDATE (stripe_payment_intent_id, stripe_charge_id, receipt_url, amount_subtotal_minor, amount_tax_minor, amount_total_minor, amount_refunded_minor, stripe_dispute_id, flag_reason, lot_id, paid_at)` | What credit and transition write |
| Cap overrides: service_role `SELECT`, `INSERT (user_id, cap_minor, currency, reason, actor_admin_id)` (SA C-1), `UPDATE (ended_at, ended_by_admin_id, ended_reason)` | Set and end |
| Functions: `REVOKE ALL … FROM` PUBLIC, anon, authenticated, service_role; `GRANT EXECUTE … TO service_role` | As 11a |

**Why INVOKER plus column grants, and not `SECURITY DEFINER`:** every Business OS money table so far uses INVOKER (11a, 3b-i), and 50 anon-callable DEFINER functions are already an open P1. Column-level UPDATE means a direct service-role write can only touch the mutable columns, and the repository's source guard forbids even that (G-5).

### 3.4 The 2a functions

All five: `LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''`, every table schema-qualified, OUT columns prefixed `out_`, a `22004` raise on NULL required arguments, and statuses answered as text (never an exception for an expected outcome).

**`business_os_reserve_boost_purchase(p_user_id uuid, p_livemode boolean, p_package_id text, p_package_version integer, p_retail_version integer, p_credit_value_version integer, p_price_minor integer, p_currency text, p_credits_base numeric, p_credits_bonus numeric, p_default_cap_minor integer, p_window_days integer, p_checkout_ttl_seconds integer)`
→ `(out_status text, out_purchase_id uuid, out_cap_minor integer, out_counted_minor bigint)`**

1. `PERFORM pg_advisory_xact_lock(hashtextextended('business_os_boost_cap' || chr(58) || p_user_id::text, 0))`. This is boost's **own** lock, not the lots draw lock (R-13). Two tabs serialise here: the second waits, then sees the first reservation (FR-23).
2. No `business_os_account_plans` row → `no_plan_row`, nothing written (FR-9).
3. Cap = the active override's `cap_minor` if one exists, else `p_default_cap_minor`.
4. Counted = Σ `price_minor` over the account's rows with `livemode = p_livemode` and `created_at > now() − p_window_days days`, whose status counts (table in §3.1). A `pending` row counts only while `now() < checkout_expires_at + interval '5 minutes'`.
5. Counted + `p_price_minor` > cap → `cap_reached`, nothing written (FR-20). The answer carries the cap and the counted sum for the refusal message and the log.
6. Otherwise INSERT a `pending` row with the snapshot and `checkout_expires_at = now() + p_checkout_ttl_seconds` → `reserved` and the id.

The function validates its arguments (positive price, `USD`, base > 0, bonus ≥ 0, window and TTL positive). Invalid input raises `22023`, because it is a caller defect rather than an outcome. The table CHECKs are the backstop.

**`business_os_attach_boost_checkout(p_user_id uuid, p_purchase_id uuid, p_session_id text, p_checkout_expires_at timestamptz)` → `(out_status text)`**: locks the row `FOR UPDATE`. Missing or foreign → `not_found` (one answer for both, the 11a pattern). Already attached to the same session → `already_attached`. Attached to a different session → `session_conflict`. Not `pending` → `not_pending`. Otherwise it sets the session id and Stripe's expiry → `attached`.

**`business_os_abandon_boost_purchase(p_user_id uuid, p_purchase_id uuid)` → `(out_status text)`**: `pending` with no session → `abandoned`. Already `abandoned` → `already_abandoned`. A session is attached → `has_session` (it is left for the webhook or the reconcile pass to settle). Missing or foreign → `not_found`.

**`business_os_set_boost_cap_override(p_user_id uuid, p_cap_minor integer, p_currency text, p_reason text, p_actor_admin_id uuid)` → `(out_status text, out_override_id uuid, out_previous_override_id uuid)`**: takes the same boost cap lock, ends the active override (if any) with `ended_reason` `replaced`, inserts the new one → `set`. With no plan row → `no_plan_row` (the 11b convention: admin ops refuse accounts without one).

**`business_os_end_boost_cap_override(p_user_id uuid, p_actor_admin_id uuid, p_reason text)` → `(out_status text, out_override_id uuid)`**: ends the active override → `ended`, or `none_active`.

### 3.4a SA conditions applied in 2a (2026-10-05)

| # | Applied as |
|---|---|
| C-1 | **Column-level INSERT.** Purchases: service_role may INSERT only `user_id, livemode, package_id, package_version, retail_version, credit_value_version, price_minor, currency, tax_exclusive, credits_base, credits_bonus, credits_total, checkout_expires_at`; `status` falls to its default `pending` and the timestamps to theirs. Overrides: INSERT only `user_id, cap_minor, currency, reason, actor_admin_id`, never `ended_*`. Pinned by the migration test and checker B3. Probe P11 and P12 add direct INSERTs of `status`, `lot_id`, `paid_at` and `ended_at`, each expecting `42501` |
| C-2 | Session id CHECK ≤ 194 characters; `attach` refuses a longer id (or one without the `cs_` prefix) with `22023`. Pinned in the test; probe P05 |
| C-3 | Checker B8 is **INFO** ("lot and charge paths match slice 2 baseline yes or no"), never FAIL. The md5 stop condition stays in the PROD pre-check (§6.6 step 2) |
| C-4 | `reserve` refuses `p_checkout_ttl_seconds` outside 1,800–86,400, `p_window_days` outside 1–366 and `p_default_cap_minor ≤ 0` with `22023`; `set_cap_override` and `end_cap_override` refuse a NULL actor or a reason under 3 characters with `22023`. Probe P10 |
| C-5 | The unscoped finders are `findBySessionIdForWebhook` and `findByPaymentIntentIdForWebhook`, with the JSDoc SA asked for. A source guard allows only `app/api/stripe/webhook/` and the future 4b reconcile cron route (`app/api/cron/bos-billing-reconcile/`) under `app/` to name them |
| C-6 | Recorded in §2.3 |
| C-7 | The coordinator records `20261030` / `20261031` with the plan-payments and credit-deduction sessions (§6.5) |
| C-8 | Binding on 2b; recorded in §3.5 below, not built in 2a |

### 3.4b Carry-forward notes from QA (2a)

| For | Note |
|---|---|
| **Slice 3** (checkout) | `attachCheckout` returns the error `boost_checkout_session_in_use` (`BOOST_SESSION_IN_USE_ERROR`) when another purchase already holds the Stripe session (`23505` on the UNIQUE key, QA R-7). The checkout must treat it as a refusal: do not show that session, expire it in Stripe, and leave the reservation to stop counting. `attach` also answers **`reservation_expired`** for a reservation past its expiry plus 5 minutes (QA-D2). Slice 3 therefore attaches immediately after creating the session, and on that answer expires the Stripe session rather than showing it |
| **Account deletion (all slices)** | No PROD runbook step may write to `auth.users` (user decision 2026-10-06). The detach rule (`ON DELETE SET NULL`) is proven on PROD by checker B4 and locally by the scratchpad PGlite detach check only |
| **Slice 6** (admin view) | An override whose account was deleted keeps `ended_at IS NULL` with `user_id` NULL (QA I-2). It matches no account, so it is harmless, but the admin list must not show it as an active override. Checker row B7 73 counts these as INFO |

### 3.5 The 2b functions (outline for SA; detailed in 2b's revision of this file)

**SA C-8 (binding on 2b):** (a) the receipt fill is **not** a status transition: either a separate `business_os_record_boost_receipt(p_purchase_id, p_charge_id, p_receipt_url)` that fills only NULL fields on a paid-family row, or a written rule that a same-status call fills only those two NULL columns and never overwrites them; (b) the credit function's mismatch path writes `flagged_mismatch` and **returns normally**, so the webhook completes the event; only database errors throw; (c) `credit` refuses a row whose stored session id is NULL (`mismatch`, `flag_reason = no_session`); (d) transitions to `refunded`, `partially_refunded` and `disputed` keep `lot_id`, and no transition writes a lot.

**`business_os_credit_boost_purchase(p_purchase_id uuid, p_session_id text, p_payment_intent_id text, p_amount_subtotal integer, p_amount_tax integer, p_amount_total integer, p_currency text, p_livemode boolean)` → `(out_status text, out_user_id uuid, out_lot_id uuid)`**. This is T-6 plus R-10.

1. Lock the purchase row `FOR UPDATE`. Missing → `not_found`.
2. A row already credited (`lot_id` set) → `already_credited` with its lot. A replay, a retry or a reconcile run converge here (FR-15).
3. Status must be `pending`, `awaiting_payment` or `expired` (Q-5). Anything else → `not_creditable`.
4. **Deterministic cross-checks against the row**, never a catalogue read (FR-4). They cover the session id, `p_livemode = livemode`, `p_currency = currency`, `p_amount_subtotal = price_minor`, and `p_amount_total = p_amount_subtotal + p_amount_tax`. They also check that the account still exists (`user_id IS NOT NULL`). Any mismatch sets `flagged_mismatch` and `flag_reason` and returns `mismatch`. It commits, so a retry cannot fix it (T-4).
5. `SELECT … FROM public.business_os_record_credit_lot(row.user_id, 'boost_purchase', row.credits_base, row.credits_bonus, row.credit_value_version, NULL, 'boost' || chr(58) || p_session_id, row.id, 'stripe_webhook', NULL, NULL)`. The call is in the same transaction. `out_recorded = false` with a lot id is treated as already recorded. A `23505` key reuse is not caught, so it throws and the webhook claim is released (HP-1).
6. UPDATE the row: `paid`, `lot_id`, `paid_at`, the payment intent and the three amounts → `credited`.

`out_user_id` comes from the row, so the 4a handler never takes the account from Stripe data (R-6, tenant-isolation-guard).

**`business_os_transition_boost_purchase(p_purchase_id uuid, p_to_status text, p_payment_intent_id text, p_charge_id text, p_receipt_url text, p_amount_refunded_minor integer, p_dispute_id text, p_flag_reason text)` → `(out_status text, out_user_id uuid, out_from_status text)`**. One function with a fixed transition table, so the lifecycle lives in one place:

| From | To |
|---|---|
| `pending` | `awaiting_payment`, `expired`, `failed`, `flagged_mismatch` |
| `awaiting_payment` | `failed`, `expired`, `flagged_mismatch` |
| `paid`, `partially_refunded` | `partially_refunded`, `refunded`, `disputed` |
| `disputed` | `paid` (dispute won), `dispute_lost` |
| any | itself → `already` (idempotent); `paid` is never reached from any status except `disputed` (crediting goes through the credit function only) |

It answers `transitioned`, `already`, `not_allowed` or `not_found`. It never touches a lot (T-9). It also fills `receipt_url` and the charge id after crediting (T-8), which is a no-status-change `paid → paid` call with the receipt fields.

### 3.6 The repository — `lib/repositories/BusinessOsBoostPurchaseRepository.ts`

It follows the `new-repository` skill and the 11a lot repository: client injection (default `supabaseServer`, documented as an intentional RLS bypass), `createLogger({ service: 'BusinessOsBoostPurchaseRepository' })`, `RepositoryResult`, never throws, exported RPC-name constants, and RPC args built **field by field** (tenant-isolation-guard Step 3). Numbers come back through a "never 0" parser (11a `toCredits`), and an unknown status from the database is an `error`, never a guess.

| Method | Sub | Notes |
|---|---|---|
| `reserve(input)` | 2a | `{ accountId, livemode, packageId, packageVersion, retailVersion, creditValueVersion, priceMinor, currency, creditsBase, creditsBonus, defaultCapMinor, windowDays, checkoutTtlSeconds }` → `reserved` (id) / `cap_reached` (cap, counted) / `no_plan_row` |
| `attachCheckout(accountId, purchaseId, sessionId, expiresAt)` | 2a | Five outcomes |
| `abandon(accountId, purchaseId)` | 2a | Four outcomes |
| `findForAccount(purchaseId, accountId)` | 2a | `.eq('id').eq('user_id').maybeSingle()`; `null` when missing or foreign |
| `findBySessionId(sessionId)` / `findByPaymentIntentId(id)` | 2a | **Unscoped by design:** the 4a resolver's one keyed read (R-6), which learns the account from the row. Documented as the ownership oracle; returns the account with the row |
| `listOwnForAccount(accountId, livemode, limit)` | 2a | The admin and slice 5 read, explicit column list, `.eq('user_id')`, newest first |
| `findActiveCapOverride(accountId)`, `setCapOverride(...)`, `endCapOverride(...)` | 2a | Slice 6 is the caller |
| `credit(input)` / `transition(input)` | 2b | Outcome-mapped like `reverseLot` |

The owner-RLS read for slice 5 (on the owner's client) is **not** in this class. Slice 5 adds it to `BusinessOsCreditOwnerReadRepository` with a column subset test against the 2a GRANT line, as 11d did for lots.

### 3.7 Registries (2a)

| Registry | `business_os_boost_purchases` | `business_os_boost_cap_overrides` |
|---|---|---|
| `businessOwnedTables.ts` `USER_OWNED_TABLES` | "Boost purchases of the account: what was bought, its price and Stripe references. Keyed to auth.users, not business_profiles, so a business Reset cannot erase them" | "Admin changes to the account's boost purchase cap; follows the account for the same reason" |
| `purge/descriptors.ts` | `never(…, U, …)`: a financial record | `never(…, U, …)`: an audited admin record |
| `classification-baseline.json` | `"never"` (count 144 → 146) | `"never"` |
| `accountDeletionPolicy.ts` | `minimise`: `user_id ON DELETE SET NULL`, and service_role holds no UPDATE on `user_id` | `minimise`, same |

### 3.8 Docs

One paragraph at the end of the entitlements doc § Metering ("Boost purchases (credits boost slice 2)"): the two tables, the functions as the only write path, the boost cap lock and that it is separate from the lots lock, the owner column grant, and the lifecycle verdicts. Plus a Change History row. The requirement gets its status and Change History lines. The pricing doc is not changed.

---

## 4. Files to Create / Modify

| File | Action | Sub | Reason |
|---|---|---|---|
| `supabase/migrations/20261030_business_os_boost_purchases.sql` | create | 2a | Tables, RLS, grants, five functions |
| `scripts/check-bos-boost-purchases-migration.sql` | create | 2a | Read-only checker B1–B10 (§6.2) |
| `scripts/probe-bos-boost-purchases-migration.sql` | create | 2a | Mandatory write probe (§6.3) |
| `supabase/SQL Scripts/20261030_business_os_boost_purchases_rollback.sql` | create | 2a | Refuses when rows exist (§6.4) |
| `supabase/migrations/__tests__/business-os-boost-purchases.migration.test.ts` | create | 2a | Pins the migration, checker, probe and rollback (§7.1) |
| `lib/repositories/BusinessOsBoostPurchaseRepository.ts` | create | 2a (+2b) | §3.6 |
| `lib/repositories/__tests__/BusinessOsBoostPurchaseRepository.test.ts` | create | 2a (+2b) | §7.2 |
| `lib/repositories/index.ts` | modify | 2a | Export the class, singleton and types |
| `lib/business-os/businessOwnedTables.ts` | modify | 2a | §3.7 |
| `lib/business-os/purge/descriptors.ts`, `lib/business-os/purge/__tests__/classification-baseline.json` | modify | 2a | §3.7 |
| `lib/business-os/account/accountDeletionPolicy.ts` (+ its test if it pins entries) | modify | 2a | §3.7 |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | 2a, 2b | One paragraph + Change History row each |
| `docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md` | modify | each stage | Status + Change History |
| `supabase/migrations/20261031_business_os_boost_crediting.sql`, matching checker, probe, rollback, test | create | 2b | §3.5 |

Not modified: `20261015`, `20261017`, `BusinessOsCreditLotRepository.ts`, `creditLots.ts`, any slice 1 file, any route, any workflow, `package.json`.

---

## 5. Task List

### 2a

- ✅ T2a.0: Confirm branch; set up the scratch Jest config and scratch tsconfig (slice 1 Q-1 procedure, outside the repo, no junction)
- ✅ T2a.1: Migration `20261030` (tables, CHECKs, indexes, comments, RLS, policy, revokes, grants, five functions, function revokes and grants), paste rules
- ✅ T2a.2: Migration test (paste safety, structure, columns, CHECKs, grants, each function's step order and literals, G-1 constants from `20261015` / `20261017`)
- ✅ T2a.3: Checker B1–B10 and its drift guard in the test
- ✅ T2a.4: Probe P00–P16 and its pins in the test
- ✅ T2a.5: Rollback script and its pins
- ✅ T2a.6: Repository (2a methods) + unit tests + `index.ts` exports
- ✅ T2a.7: Registries + baseline; run their existing tests
- ✅ T2a.8: Optional throwaway PGlite run in the scratchpad, only if TL allows it (Q-8); otherwise the PROD probe is the first execution
- ✅ T2a.9: Docs paragraph; requirement status
- ✅ T2a.10: Local bar (§7.4), scoped tsc, `git diff --stat`; status → Code Complete. **Leave uncommitted**

### 2b (after 2a is merged and applied, or in parallel once 2a's SQL is approved)

- ⬜ T2b.1: Migration `20261031` (two functions, the 2b UPDATE grants)
- ⬜ T2b.2: Migration test, checker rows, probe rows (credit, replay, mismatch, key reuse → `23505`, lot written exactly once and matching the row, transitions table), rollback
- ⬜ T2b.3: Repository `credit` / `transition` + tests
- ⬜ T2b.4: Docs; local bar; Code Complete

---

## 6. Checker, probe, rollback and the PROD runbook

### 6.1 Migration outline (2a)

`BEGIN; SET LOCAL lock_timeout = '5s';` → two `CREATE TABLE` (plain, not `IF NOT EXISTS`, so a second paste fails at the first statement and changes nothing) → named constraints, one `ALTER TABLE … ADD CONSTRAINT` per line → indexes → `COMMENT ON` (letters and spaces only, never the word **into**) → RLS → policy → revokes and grants → five `CREATE FUNCTION` blocks with dollar-quote tags → function revokes and grants → `COMMIT;`. No data, no backfill.

### 6.2 Read-only checker — `scripts/check-bos-boost-purchases-migration.sql`

`SET default_transaction_read_only = on;` then one `SELECT` giving one PASS / FAIL / INFO row per check and row 0 `VERDICT PASS n pass 0 fail`.

| Row | Check |
|---|---|
| B1 | Both tables exist with RLS on. Purchases has exactly one owner SELECT policy (permissive, `TO authenticated`, `auth.uid()` = `user_id`, no `WITH CHECK`). Overrides has none |
| B2 | `authenticated` holds SELECT on exactly the listed purchase columns and nothing else on either table; PUBLIC and anon hold nothing |
| B3 | service_role holds exactly the §3.3 privileges (table-level SELECT, INSERT; UPDATE on exactly the listed columns); no role but the owner holds DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN |
| B4 | Every named CHECK (the counts the test derives from the migration), the UNIQUE keys, the FKs (`user_id → auth.users SET NULL` on both, `lot_id → business_os_credit_lots`), the partial unique index, the indexes by name, no trigger |
| B5 | The five functions with exact signatures, `prosecdef = false`, `proconfig = {search_path=""}` |
| B6 | EXECUTE for service_role only |
| B7 | Integrity: no account with two active overrides; every `lot_id` points at a lot with `source = boost_purchase`, `source_ref` = the purchase id, the same account and `credits_granted = credits_total`; the paid-family rule holds; no purchase in a cap window over its cap (INFO with the count, not FAIL, because an override may have been lowered later) |
| B8 | **INFO, never FAIL (SA C-3).** The lots and charge paths match the slice 2 baseline: `md5(replace(prosrc, chr(13), ''))` of `business_os_record_credit_lot`, `business_os_reverse_credit_lot`, `business_os_record_credit_charge` and `business_os_credit_period_start` equal the constants pinned by the test; the column lists of the four existing tables are unchanged |
| B9 | INFO: purchases by status and mode, active overrides, first purchase time in UTC (`none` when empty) |
| B10 | INFO: checked at, UTC |

### 6.3 Mandatory write probe — `scripts/probe-bos-boost-purchases-migration.sql`

One `DO $probe$` block that **always ends in `RAISE EXCEPTION`**, so nothing survives. It runs on the user's own account (`PASTE_YOUR_OWN_USER_ID_HERE`), with the four 11a guards (placeholder, bad uuid, read-only session, not an account) and a fifth: **no plan row** → `PROBE SKIPPED  that account has no Business OS plan row`. It uses `SET LOCAL ROLE service_role` for writes and `SET LOCAL ROLE authenticated` with `request.jwt.claims` set through `set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'), …)` for RLS steps. Each refusal is caught in its own sub-block against its SQLSTATE. Session ids are minted per run as `'cs' || chr(95) || 'test' || chr(95) || <random hex>`.

| Id | As | Proves |
|---|---|---|
| P00 | postgres | INFO: purchases, overrides, lots, draws, charges row counts before |
| P01 | service_role | Reserve 1000 minor with default cap 3000 → `reserved`; stored row is `pending`, snapshot intact, `checkout_expires_at` ≈ now + TTL |
| P02 | service_role | Two more → `reserved`; the fourth → `cap_reached`, cap 3000, counted 3000, nothing written |
| P03 | service_role | Same account in the **other** mode → `reserved` (R-10: modes counted apart) |
| P04 | service_role | Abandon P01's row → `abandoned`; reserve again → `reserved` (abandoned does not count) |
| P05 | service_role | Attach a session → `attached`; same again → `already_attached`; a different session → `session_conflict`; abandon it → `has_session` |
| P06 | service_role | A pending row whose `checkout_expires_at` + 5 min has passed is not counted. Inserted directly as postgres with a back-dated time, because `now()` is fixed inside the transaction |
| P07 | service_role | Set override 5000 → `set`; reserve now passes where P02 refused; set 6000 → `set` with the previous id ended `replaced`; end → `ended`; end again → `none_active` |
| P08 | service_role | Reserve / set override for a uuid with no plan row → `no_plan_row`, nothing written |
| P09 | service_role | Attach / abandon P01's id under a stranger's id → `not_found`, nothing changed |
| P10 | service_role | Invalid arguments (price 0, `EUR`, bonus < 0) → `22023` |
| P11 | service_role | Direct INSERTs breaking CHECKs (total ≠ base + bonus; bad session shape; `flag_reason` without `flagged_mismatch`; `lot_id` on a pending row) → each `23514` |
| P12 | service_role | Direct UPDATE of `price_minor`, `user_id`, `livemode`, `credits_total` → `42501`; DELETE and TRUNCATE on both tables → `42501` |
| P13 | authenticated (owner) | INSERT into either table → `42501`; EXECUTE of each function → `42501`; own purchases readable through the granted columns; SELECT of `stripe_checkout_session_id` or `flag_reason` → `42501`; overrides not readable |
| P14 | authenticated (stranger) | Sees none of the probe's purchases |
| P15 | postgres | Lots, draws, charges and totals row counts equal P00's |
| P16 | — | INFO: concurrency (two tabs) cannot be shown in one backend; the lock line is pinned by the test |

**The PROD probe never writes to `auth.users` (user decision 2026-10-06).** It only reads it, in the guard that checks the pasted id is an account, and the migration test pins that. The rule that deleting an account keeps its purchases and overrides and detaches them (`ON DELETE SET NULL`) is proven on PROD by checker **B4** (both FKs, `confdeltype = 'n'`) and locally by the scratchpad-only PGlite detach check (`pglite/detach-check.sql`, §7.5). It is never exercised on PROD.

Expected: an error starting `PROBE PASS  this error is expected and rolls everything back`, then one line per id.

### 6.4 Rollback — `supabase/SQL Scripts/20261030_business_os_boost_purchases_rollback.sql`

`LOCK` both tables, refuse with `ROLLBACK REFUSED  the boost purchase tables hold rows so nothing was dropped` if either has a row, then drop the five functions (exact signatures) and both tables. **Valid only until slice 3 is deployed.** After that, the preferred rollback is code-only, and the script must be retired the way 11a's was (its §6.5 warning). The 2b rollback drops only the two 2b functions and revokes the 2b grants; it never drops a table.

### 6.5 Pre-apply coordination

- Record `20261030` (and `20261031`) with the plan-payments and credit-deduction sessions when SA approves this workplan (§18.10 gate table). **(SA C-7, 2026-10-05)** The coordinator is recording both numbers with those sessions before the 2a PR. **Date recorded: 2026-10-05** (SA CR-1 satisfied). Credit deduction session, 2026-10-04: "boost's 20261030–20261034 noted"; its own block is 20261015–19. Plan payments session, 2026-10-05: "Boost's 20261030–34 are untouched"; payments now use P-3b `20261027`, P-5 `20261028`, P-9 `20261029`, P-10 `20261036`. *(Superseded: "Date recorded: TBD".)*
- 20261017 is applied on PROD (11a §17). The pre-check confirms it again (step 2).

### 6.6 2a on PROD: the exact steps (by the user, Supabase SQL editor)

Paste each file **whole**, as its own run. No agent applies anything.

1. **Where you are:** the production project.
2. **Pre-check:** run
   ```sql
   SELECT to_regclass('public.business_os_boost_purchases') AS purchases,
          to_regclass('public.business_os_boost_cap_overrides') AS overrides,
          to_regclass('public.business_os_credit_lots') AS lots,
          to_regclass('public.business_os_account_plans') AS plans,
          to_regprocedure('public.business_os_record_credit_lot(uuid,text,numeric,numeric,integer,timestamptz,text,uuid,text,uuid,text)') AS record_lot_fn;
   ```
   Expect `purchases` and `overrides` NULL, and the other three not NULL. **(SA CR-2)** Also run `SELECT version();` and paste the value into the results. The local PGlite smoke test ran PostgreSQL 18.3 (§6.8); the PROD checker and probe are the proof. Then run the md5 query for the four existing functions (the 11a step 2 form with four names) and compare it with §6.7. Any difference: stop and send the rows to Dev.
3. **Apply:** paste `supabase/migrations/20261030_business_os_boost_purchases.sql`, Run, expect `Success. No rows returned`. A second paste fails at the first `CREATE TABLE` with `already exists` and changes nothing.
4. **Apply time:** `SELECT now() AT TIME ZONE 'UTC' AS applied_at_utc;` → paste into the results section.
5. **New checker:** paste `scripts/check-bos-boost-purchases-migration.sql`, Run, expect `VERDICT PASS` and B9 `0 purchases`.
6. **Existing checkers:** `scripts/check-bos-credit-lots-migration.sql` and `scripts/check-bos-credit-charges-migration.sql`, each `VERDICT PASS` as before.
7. **Your user id:** `SELECT id FROM auth.users WHERE email = '<your login email>';`.
8. **Write probe (mandatory):** in a **new tab**, paste the probe with your id over the placeholder. Confirm the destructive-operation warning (it proves refusals, and everything rolls back). Expect `PROBE PASS  this error is expected and rolls everything back`. `PROBE SKIPPED  that account has no Business OS plan row` means use an account that has one.
9. **Nothing kept:** run the new checker again → still `0 purchases`; the lots checker unchanged.
10. **Rollback (only if Dev says so):** `supabase/SQL Scripts/20261030_business_os_boost_purchases_rollback.sql`. Confirm the destructive warning only then.
11. **Paste the results** (steps 2, 4, 5, 6, 8, 9) into this workplan.

2b's runbook has the same shape, with its pre-check expecting the 2a objects present and the two 2b functions absent.

### 6.7 G-1 constants

The md5 of the four existing function bodies (LF-normalised) are computed by Dev at T2a.2 from `20261015` and `20261017` and printed here. The migration test recomputes them, and the checker and the pre-check compare against them.

| Function | md5 of the body (carriage returns stripped) | From |
|---|---|---|
| `business_os_record_credit_lot` | `89c46b47f1fc57f7080ba8064c28fd63` | `20261017` |
| `business_os_reverse_credit_lot` | `da020d2d87ebfae366b19ea6b0c7b5be` | `20261017` |
| `business_os_record_credit_charge` | `a7aa425de95fe06da72d31257f7818a2` | `20261015` (same value as 11a §6.7) |
| `business_os_credit_period_start` | `b00af2d2c4738e51e08e2ec92195077e` | `20261015` (same value as 11a §6.7) |

Computed by Dev on 2026-10-05 and reproduced by `md5(replace(prosrc, chr(13), ''))` on PGlite after applying the CRLF working-tree copies of both migrations (§6.8). The pre-check query (§6.6 step 2) is:

```sql
SELECT proname, md5(replace(prosrc, chr(13), '')) AS body_md5
FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname IN ('business_os_record_credit_lot', 'business_os_reverse_credit_lot', 'business_os_record_credit_charge', 'business_os_credit_period_start')
ORDER BY proname;
```

Expect four rows equal to the table. Any difference: stop before applying.

---

### 6.8 Throwaway PGlite run (2a, local only, 2026-10-05)

**A smoke test only (SA CR-2):** the PROD checker and the PROD probe are the proof. **Where and what:** `@electric-sql/pglite` **0.5.8** (exact pin), installed only in the session scratchpad (`…/scratchpad/pglite`), never in the repo's `package.json` or lockfile. It reports **PostgreSQL 18.3**. Harness `harness.mjs` lives in the same scratchpad. It follows SA Q-8's five steps:
1. Roles `anon`, `authenticated` and `service_role` were created NOLOGIN, with Supabase-style `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES / FUNCTIONS / SEQUENCES` to all three, applied **before** the migrations. `service_role` has `BYPASSRLS`, as on Supabase (see the finding below).
2. Stubs: `auth.users (id, email)` and `auth.uid()`, which reads `request.jwt.claims`.
3. A minimal `business_os_account_plans (user_id PK → auth.users)`, with the PROD privilege shape (`SELECT, INSERT, UPDATE` to service_role).
4. Applied `20261017` verbatim (also `20261015`, so B8 and P15 have the real charge objects), then `20261030`.
5. One account with a plan row and one account without.

**RLS sanity first:** inside a transaction under `SET LOCAL ROLE authenticated` with owner claims, a test table with an owner policy returned only the owner's row. A table with no grant answered `42501`. So RLS and privileges are real in this version, and the run below is meaningful for grants and RLS, not only for compiling.

| Step | Result |
|---|---|
| Apply `20261030` | ✅ Applied. A second paste fails at the first `CREATE TABLE` with `42P07 relation … already exists` and changes nothing |
| New checker | ✅ `VERDICT PASS 20 pass 0 fail`. B8 INFO `yes`, with all four md5s matching, computed from the CRLF working-tree files. B9 `0 purchases` |
| Lots checker (`check-bos-credit-lots-migration.sql`) after 2a | ✅ No FAIL rows |
| Probe guards | ✅ Placeholder, bad uuid and **no plan row** each answer their `PROBE SKIPPED` text |
| Probe on the seeded account | ✅ `PROBE PASS`, P00–P16, with P13 seeing all 7 of the account's purchases. Afterwards: 0 purchases, 0 overrides, 0 lots (nothing kept) |
| Mutation: table-level `INSERT` granted to service_role | ✅ Caught: probe `P11 FAIL` and checker B3 (rows 30, 31, 32) FAIL |
| Mutation: owner granted `SELECT (flag_reason)` | ✅ Caught: probe `P13 FAIL` and checker B2 row 21 FAIL |
| Rollback with a row present | ✅ `ROLLBACK REFUSED  the boost purchase tables hold rows so nothing was dropped`; nothing dropped |
| Rollback on empty tables | ✅ All seven objects gone; `business_os_credit_lots` still present |
| Re-apply after rollback | ✅ Applies again; checker `VERDICT PASS` |

**Finding (fed back into the files):** INVOKER functions run as the caller, so `service_role`'s writes are subject to RLS unless the role bypasses it. With a plain `service_role`, PGlite's first probe run failed at P01 (`42501 new row violates row-level security policy`). Supabase's `service_role` has `BYPASSRLS`, and 11a relies on the same thing. The checker gained row **B3 33 "service_role bypasses row level security as the functions need"**, so PROD proves it rather than assuming it.

**What this run cannot prove (SA Q-8):**
- PROD's actual state: 11a's objects and grants as the md5s say. That is the pre-check's job.
- Supabase's real default privileges (here they are emulated).
- PostgREST exposure.
- The SQL editor's paste parsing (the word **into**, statement splitting). The migration test enforces the paste rules instead.
- **Real concurrency** of the advisory lock (PGlite is one connection).
- Extensions and performance.

The PROD checker and the mandatory PROD probe stay required.

## 7. Test Plan

### 7.1 `supabase/migrations/__tests__/business-os-boost-purchases.migration.test.ts`

- **Paste safety, all four files:** no `--` or `/*`; literals only `[A-Za-z0-9_ ]`; no literal contains the word **into**; no single-letter alias; standalone statements.
- **Structure:** one `BEGIN;` / `COMMIT;` with the lock timeout; exactly 2 `CREATE TABLE` and 5 `CREATE FUNCTION`; no `SECURITY DEFINER`, `TRIGGER` or `IF NOT EXISTS`. None of `business_os_credit_lots`, `_lot_draws` or either lot function is created, altered or dropped. The only reference to lots is the `lot_id` FK.
- **Columns:** both tables in order with types and nullability. `numeric(18,6)` on credit columns and `integer` on money.
- **Constraints:** each named CHECK's exact text, including the 11 statuses, the paid-family rules and the id shapes with `chr(95)`. No CHECK names `user_id`. FKs and the partial unique index.
- **Grants:** `REVOKE ALL` × 4 roles × each object. The exact GRANT lines, each after every REVOKE of its object. No table-level SELECT for `authenticated`. No DELETE, TRUNCATE, REFERENCES or TRIGGER anywhere. No UPDATE grant names `user_id`, `livemode`, `price_minor`, any `credits_*`, any version column or `package_*`.
- **Reserve:** the lock line exact (`'business_os_boost_cap' || chr(58) || p_user_id::text`) and before any read. Then, by position in the body: plan check, override, sum, compare, insert. The counted-status list equals §3.1. The `+ interval` grace and `livemode` appear in the sum.
- **Attach, abandon, set and end override:** status literals exactly as §3.4; `FOR UPDATE` where stated; set override takes the same lock.
- **G-1 constants:** the md5s of the four existing function bodies equal §6.7. The checker's B8 uses the same constants.
- **Checker:** read-only, one SELECT, B1–B10, names every object of the migration (drift guard), owner column list equal to the GRANT line.
- **Probe:** one `DO` block ending in `RAISE EXCEPTION … PROBE …`; the five guards before any role switch; ids P00–P16 present.
- **Rollback:** outside `supabase/migrations/`; locks, then refusal, then drops; exact function signatures.

### 7.2 Unit tests

| File | Cases |
|---|---|
| `lib/repositories/__tests__/BusinessOsBoostPurchaseRepository.test.ts` | Each RPC: args field by field (an injected `user_id` / `p_user_id` / `status` in input never reaches the call); every outcome mapped; an unknown status → `error`; numeric strings parsed and unparsable figures → `error`, never 0; a rejected promise → `error`, no throw. Reads: `.eq('user_id', accountId)` on scoped reads, explicit column lists (no `*`); `findBySessionId` returns the row's account. **Source guards:** no `.insert(`, `.update(`, `.delete(`, `.upsert(`; no import from `lib/business-os/entitlements/`; RPC names equal the migration's functions; default client is `supabaseServer` |
| `lib/business-os/account/__tests__/accountDeletionPolicy.test.ts` (existing) | Both tables `minimise`, reason names `ON DELETE SET NULL` |
| Existing guards, unedited | `businessOwnedTables.test.ts` (every `CREATE TABLE` classified), `descriptors.invariant.test.ts`, `business-os-credit-lots.migration.test.ts` and `business-os-credit-charges.migration.test.ts` (still green) |

### 7.3 Tenant isolation (tenant-isolation-guard Step 7)

In 2a, the boundary is in SQL and the repository. P09 (a stranger's id gets `not_found` and nothing changes) and P14 (a stranger sees nothing) cover the SQL side. The repository's field-by-field args test covers the rest: an injected account is dropped. The resolver-by-Stripe-id path returns the row's account (R-6), and 4a's tests prove the handler uses it.

### 7.4 Local bar (scratch configs, `--runTestsByPath`)

The new migration and repository tests; `business-os-credit-lots.migration.test.ts`, `business-os-credit-charges.migration.test.ts`, `business-os-billing-accounts.migration.test.ts`; `businessOwnedTables.test.ts`, `descriptors.invariant.test.ts`, `accountDeletionPolicy.test.ts`, `BusinessOsCreditLotRepository.test.ts`, `scripts/__tests__/entitlementSqlScripts.guard.test.ts`; `enforcementPoints.test.ts`, `accountSeam.guard.test.ts`. Scoped tsc over the new and modified `.ts` files: 0 errors in them. CI runs `npm run test:bos-entitlements` (which covers `lib/repositories/__tests__`, `supabase/migrations/__tests__` and the registries) and the required type-check on the PR.

---

### 7.5 Results (Dev, 2026-10-05)

| Check | Result |
|---|---|
| New suites: `business-os-boost-purchases.migration.test.ts` (74 tests), `BusinessOsBoostPurchaseRepository.test.ts` (25 tests) | ✅ Pass |
| §7.4 local bar (12 suites, scratch config, `--runTestsByPath`) | ✅ 12 suites, 646 tests. The one red on the first run was the expected purge baseline pin (`count 144`), bumped to 146 on purpose in `descriptors.invariant.test.ts` |
| The whole `test:bos-entitlements` file set (189 suites, listed with `find` and passed with `--runTestsByPath`; a second scratch config keeps the repo's ts-jest JSX options so the TSX suites parse) | ✅ **189 suites, 4,877 tests passed** |
| Scoped tsc over the new and modified `.ts` files (`tsconfig.slice2a.json` in the scratchpad) | ✅ **0 errors in the touched files.** 4 errors elsewhere, reached through `lib/repositories/index.ts` imports and outside this diff: `lib/pilot/insight/MemoryManager.ts` (2), `lib/repositories/CalibrationSessionRepository.ts` (1), `lib/types/plugin-types.ts` (1) |
| PGlite | ✅ See §6.8 |

**QA (2a) follow-ups applied before the PR (Dev, 2026-10-05):**

| # | Change | Proof |
|---|---|---|
| QA-D1 (R-1) | Checker B7's doubled-override count ignores detached overrides (`AND override_row.user_id IS NOT NULL`). New INFO row **B7 73** counts active overrides detached by account deletion | Migration test pins both texts, and row 73 is INFO-only. PGlite: two accounts with active overrides deleted, then the checker gives `VERDICT PASS 20 pass 0 fail` with row 73 reading `2 active overrides whose account was deleted` |
| QA-D2 (R-2) | `attach` answers the new outcome **`reservation_expired`** when `now() >= checkout_expires_at + 5 min` (after `not_pending`, before the update), so a stale reservation cannot be revived over the cap. The repository maps it (six attach statuses) | Migration test (the line, its order, six outcomes); probe P06 (the stale row answers `reservation_expired` and stores no session); repository test |
| QA-D3 (R-3) | `reserve`, `attachCheckout`, `abandon`, `setCapOverride` and `endCapOverride` build their log ids with optional chaining, so a `null` or `undefined` input resolves to `{ error }` | Repository test: five methods × `null` / `undefined`, with no RPC called |
| I-4 | §6.7 table header fixed (it held a raw line break) | — |
| R-4 | Probe P02: the third reservation brings counted to exactly the cap and is `reserved`, and one more minor unit is `cap_reached` | Migration test pin |
| R-5 | Probe P13: the owner filtering on hidden `flag_reason` gives `42501` | Migration test pin |
| R-6 | ~~Probe **P17**: a throwaway `auth.users` row deleted inside the probe~~ **Removed from the PROD probe by the user (2026-10-06): the production runbook never writes to `auth.users`.** The same SQL now lives only in the session scratchpad (`pglite/detach-check.sql`, run by the harness step `detachCheck`), never in the repo. On PROD the detach rule is proven by checker B4 (both `user_id` FKs are `ON DELETE SET NULL`) | Migration test: the probe has no P17 and no `INSERT`, `DELETE`, `UPDATE` or `TRUNCATE` on `auth.users` (with a negative control). PGlite local detach check: PASS |
| R-7 | Probe P06: attaching a session another purchase holds gives `23505`. The repository returns it as the error `boost_checkout_session_in_use`, logged at warn | Migration test pin; repository test |
| Notes | QA I-2 (slice 6) and the 23505 handling (slice 3) are in §3.4b | — |

**Re-run after the QA follow-ups:**
- 12-suite local bar: **12 suites, 657 tests green**.
- Scoped tsc: 0 errors in the touched files, with the same 4 in files outside this diff.
- PGlite 0.5.8 (PG 18.3):
  - Checker: `VERDICT PASS 20 pass 0 fail`.
  - Probe: `PROBE PASS` P00–P17, with 0 rows kept.
  - Rollback: refuses with a row and drops on empty tables; re-applies to `VERDICT PASS`.
- QA's adversarial script `pglite/qa2a.mjs`: **134 / 134 pass**.

**SA code review (2a) items applied before QA (Dev, 2026-10-05):**

| # | Change | Proof |
|---|---|---|
| CR-1 | Left to the coordinator; §6.5 now reads "Date recorded: TBD" | — |
| CR-2 | Runbook step 2 also runs `SELECT version();`. §6.8 now says the PGlite run is a smoke test on PostgreSQL 18.3, and the PROD checker and probe are the proof | — |
| CR-3 | `attach` refuses `p_checkout_expires_at` at or before `now()`, or after `now() + 24 h 5 min`, with `22023` before the row lock (the existing refusal style). The repository refuses the same window before calling the RPC | Migration test (the line exists and comes before `FOR UPDATE`); probe P06 (an expiry at now and one 25 hours out each give `22023`, and no session is stored); repository test (past, 1 h ago and 24 h 6 min refused without an RPC call; 24 h accepted) |

**Re-run after CR-2 and CR-3:** the 12-suite local bar has **12 suites and 648 tests green** (two tests are new). Scoped tsc has 0 errors in the touched files, and the same 4 errors in files outside this diff. In PGlite 0.5.8 (PG 18.3), the checker gives `VERDICT PASS 20 pass 0 fail`. The probe gives `PROBE PASS` P00–P16, with the new P06 line, and 0 rows are kept. The rollback refuses with a row present, drops all seven objects on empty tables, leaves the lots table in place, and the migration re-applies to `VERDICT PASS`.

**Deviations from the plan (small, for SA code review):**
1. `abandon` has **five** outcomes, not four. `not_pending` covers a non-pending row with no session; such a row is unreachable today, but the outcome keeps the answer explicit.
2. Checker row **B3 33** (service_role `BYPASSRLS`) was added after the PGlite finding (§6.8).
3. Probe guard six: an account that **already has boost purchases or overrides** is `PROBE SKIPPED`, so the probe's cap arithmetic stays exact. The probe ids differ in detail from the §6.3 table:
   - P03 is the stale-pending check (a row inserted as postgres before the role switch).
   - P04 is the other mode.
   - P05 is abandon.
   - P06 is attach, including C-2.
   - P07 is the override.
   - P08 is no plan row.
   - P09 is a stranger or a missing id.
   - P10 is out-of-range arguments (C-4).
   - P11 is direct inserts and CHECKs (C-1).
   - P12 is direct updates, deletes and truncates.
   - P13 and P14 are owner and stranger reads.
   - P15 is lots and draws unchanged.
   - P16 is INFO.
4. Every refusal block in the probe also catches any other error as a FAIL line with its SQLSTATE, so a wrong refusal reads `PROBE FAIL …` rather than a raw error (proved by the mutation runs).
5. A third index, `business_os_boost_cap_overrides_user_created_idx (user_id, created_at)`, is there for slice 6's override history.
6. Repository method names: `listForAccount` (in place of `listOwnForAccount`), and object inputs for `attachCheckout` / `abandon`. The two webhook finders also refuse an id with the wrong Stripe prefix before querying.
7. The migration test also pins the four md5s against this workplan §6.7, which the pre-check quotes.

## 8. CI impact

No new job, workflow, script or dependency. The new tests sit under paths `test:bos-entitlements` and the every-PR Jest gate already run. They are static file reads plus mocked-client unit tests, so they add about a second. No database is contacted in CI.

---

## 9. Entitlements registration

Slice 2 imports **nothing** from `lib/business-os/entitlements/`. The repository takes plain fields, and a source guard pins that (G-7). So no `KNOWN_NON_GATE_IMPORTERS` entry is due, and `enforcementPoints.test.ts` stays as it is. **Slice 3** maps a `BoostPackage` and `BOOST_PURCHASE_CAP_DEFAULT` into a reservation. That file is the first outside importer of slice 1 code, and slice 3 registers it as a non-gate (SA C-7 from slice 1).

---

## 10. Estimate and risks

**Estimate:** 2a ~2 days; 2b ~1.5 days. Unsplit, about 3.5 days.

| Risk | Mitigation |
|---|---|
| A paid boost is lost if crediting fails halfway | One transaction in 2b; the lot and the status move together or not at all; a key reuse throws so the webhook retries (HP-1); the 4b reconcile pass re-drives `pending` / `awaiting_payment` / `expired` rows (FR-43) |
| Double crediting | UNIQUE `lot_id`, UNIQUE session and payment-intent ids, the lot key `boost:<session id>`, the `already_credited` branch |
| The cap bypassed by two tabs | Advisory lock per account, then sum, then insert, in one transaction |
| Touching 11a's objects by accident | B8 md5 pins and the "never created, altered or dropped" test |
| SQL editor misparse | Paste rules enforced by the test, including no **into** inside literals |
| A pending row blocking the cap forever if attach never happens | It stops counting at `checkout_expires_at + 5 min`, set at reserve |
| Rollback run after go-live | The script refuses with rows; the runbook marks it valid only until slice 3 deploys |

---

## 11. Open questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | Split slice 2 into 2a (`20261030`, reservation and cap) and 2b (`20261031`, crediting and status)? | Yes (§2.1). The full table shape lands in 2a, so 2b only adds functions and grants |
| Q-2 | Writers are `SECURITY INVOKER` functions, which means service_role needs column-level UPDATE on the mutable columns (a direct UPDATE of those columns is possible; the repository source guard forbids it). Acceptable, or should the status columns move only through `SECURITY DEFINER` functions? | INVOKER plus column grants, as 11a and P-2a (§3.3) |
| Q-3 | Add the owner column grant and policy now (for slice 5's history), or leave purchases server-only until slice 5? | Now: it avoids a third migration, and the hidden-column rule makes it safe. Column list in §3.3 |
| Q-4 | Reserve takes the default cap, the window and the TTL as arguments (from `BOOST_PURCHASE_CAP_DEFAULT` and slice 3), rather than holding them in SQL | Arguments, so config stays the single source |
| Q-5 | May the credit function credit an `expired` row (a lost or raced expiry event, F-1), as well as `pending` and `awaiting_payment`? | Yes: losing a paid boost is worse; the session id and amount checks still apply |
| Q-6 | A purchase whose account was deleted before payment arrives (`user_id` NULL): `flagged_mismatch` with `flag_reason = account_deleted`? | Yes; no lot can be written (`record_credit_lot` refuses a NULL user) and the admin flag is the record |
| Q-7 | Cap overrides FK to `auth.users` `SET NULL` (NFR-12), unlike entitlement overrides (plan row, CASCADE) | `auth.users`, `SET NULL` |
| Q-8 | (Process, for TL) A throwaway PGlite run in the scratchpad needs PGlite installed there. Allowed? | Ask; without it, the PROD probe is the first execution, as the probe was designed for |
| Q-9 | `stripe_charge_id` accepts `ch_` and `py_` prefixes, and the dispute id `dp_` and `du_` | Yes; Stripe uses both for card and non-card methods |

**Business questions:** none. The cap, the window, the statuses and the refund policy (flag only) are decided (§1, FR-20 to FR-23, T-9).

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-05, against `b3c32ea7`**
**Status:** ✅ Approved with conditions (C-1 to C-8). The Dev writes them into this workplan as the first step of 2a, and no second review is needed. The C-8 items bind 2b's revision of §3.5, which SA reviews with 2b's code.

The design matches T-2 as built by 11a, plus T-4 to T-10, T-14, R-6, R-10, R-13 and NFR-12. The split, the INVOKER-plus-column-grant model, the per-account cap lock, the row-as-oracle rule and the runbook all follow the 11a / 3b-i precedent.

#### Facts verified

| Claim | Verified |
|---|---|
| The 11a lots table, the `boost_purchase_shape` CHECK, the `record_credit_lot` signature and its `22004` / `23505` behaviour | ✅ `20261017` |
| **The lot `idempotency_key` is limited to 1–200 characters** (`business_os_credit_lots_idempotency_key_length`) | ✅ This matters for C-2 |
| The lots draw lock key is `'business_os_credit_lots' ∥ ':' ∥ user_id`, taken only by draw writers (`20261017:239`) | ✅ Boost's `'business_os_boost_cap:…'` is separate (R-13). Inserting a lot needs no lock |
| `business_os_account_plans.user_id` is the PK | ✅ `20261005` |
| `business_os_entitlement_overrides` shape | ✅ `20261005` |
| Registries: lots are already classified in `businessOwnedTables.ts:173`, `descriptors.ts:406` and `accountDeletionPolicy.ts:130`; the baseline holds `count: 144` | ✅ 144 → 146 is right |
| `scripts/check-bos-credit-lots-migration.sql` and `supabase/migrations/__tests__/business-os-billing-accounts.migration.test.ts` exist | ✅ |
| `20261030` and `20261031` are free on `main` (highest are `20261026` and `20261035`) | ✅ |
| FR-43 and DEP-10 exist in the requirement | ✅ |

#### Conditions

| # | Severity | Condition |
|---|---|---|
| **C-1** | **Medium** | **Column-level INSERT, not table-level.** Table-level INSERT lets a direct service-role insert create a row already `paid`, carrying a `lot_id`, Stripe ids and amounts, which would bypass the credit function. Grant `INSERT` on purchases **only** on the columns `reserve` writes: `user_id`, `livemode`, `package_*`, `retail_version`, `credit_value_version`, `price_minor`, `currency`, `tax_exclusive`, `credits_*`, `checkout_expires_at`. `status` then falls to its default `pending`, and timestamps to their defaults. On overrides, grant INSERT only on `user_id`, `cap_minor`, `currency`, `reason`, `actor_admin_id`, never the `ended_*` columns. Pin this in the migration test and B3. P11 and P12 gain "direct INSERT of `status`, `lot_id` or `paid_at` → `42501`". |
| **C-2** | **Medium** | **The session id must fit the lot key.** The lot key is `'boost:' ∥ session_id`, at most 200 characters, so a session id over 194 characters would make `record_credit_lot` raise `23514` inside 2b's credit function. The webhook would then retry until Stripe gives up, and a paid boost would never be credited. Make the CHECK on `stripe_checkout_session_id` length **≤ 194**, not 255, and have `attach` refuse longer ids with `22023`. Stripe session ids are about 66 characters today. Pin both in the test. |
| **C-3** | Medium | **B8 is an apply-time proof, not a permanent FAIL.** The credit deduction session owns those four functions and the lots tables, and its slices 4c, 9 and 11 may legitimately change them later (for example, a new draw kind). The **static** migration test already proves that *this* migration creates, alters and drops none of them (G-1). On PROD, the md5 comparison is the runbook pre-check's stop condition (step 2). In the checker, B8 reports **INFO**, "lot and charge paths match slice 2 baseline: yes/no". It is never FAIL, so the boost checker does not turn red because of another session's legitimate migration. |
| **C-4** | Low | **Argument bounds in `reserve`:** `p_checkout_ttl_seconds` between 1,800 and 86,400 (Stripe's session expiry range), `p_window_days` between 1 and 366, and `p_default_cap_minor` > 0. Each is `22023` when out of range. `set_cap_override` refuses `p_actor_admin_id IS NULL` and a reason under 3 characters (`22023`). The table CHECKs stay as the backstop. |
| **C-5** | Low | **Unscoped finders are named for what they are.** Rename them `findBySessionIdForWebhook` and `findByPaymentIntentIdForWebhook`. Their JSDoc states: unscoped by design (R-6), the input must come from a **signature-verified Stripe event**, never from a request, and the returned `user_id` is the account. A source-guard test asserts that no file under `app/` other than `app/api/stripe/webhook/` (and the slice 4b reconcile cron route) references them. Today no file does, so the guard passes, and the guard keeps it true. |
| **C-6** | Low | **Carry forward to slice 3, recorded in §2.3:** the checkout route calls `readPaymentHold` (R-1, fail closed) and the server flag **before** `reserve`. The SQL does not duplicate the hold predicate, which lives in lineage reads in TypeScript. A second definition would drift. |
| **C-7** | Low | **Record the migration numbers** `20261030` and `20261031` with the plan-payments and credit-deduction sessions **before** the 2a PR, and say so in §6.5 with the date. |
| **C-8** | 2b (binding on its revision) | (a) **Receipt fill is not a status transition.** The §3.5 table says "any → itself → `already`", yet the same section uses `paid → paid` to write `receipt_url` and `stripe_charge_id`. Split it: either a separate `business_os_record_boost_receipt(p_purchase_id, p_charge_id, p_receipt_url)` that fills only NULL fields on a paid-family row, or a written rule that a same-status call may only fill those two NULL columns and never overwrite them. (b) The credit function's mismatch path writes `flagged_mismatch` **and returns normally**, so the webhook marks the event completed (T-4). Only database errors throw. (c) `credit` takes `p_session_id` and refuses when the row's stored session id is NULL (`mismatch`, `flag_reason = no_session`), because a row with no session cannot have been paid through our checkout. (d) Transitions to `refunded`, `partially_refunded` and `disputed` keep `lot_id`, and no transition writes a lot (T-9). |

#### Rulings on §11

| Q | Ruling |
|---|---|
| **Q-1** | **Split approved.** 2a is independently safe to apply and deploy: two empty tables, functions nobody calls until slice 3, an owner read of an empty table, and nothing that moves money. Its rollback is valid until slice 3 deploys (§6.4). 2b may be built in parallel once 2a's SQL is approved, but it **applies after** 2a, and its pre-check asserts the 2a objects. |
| **Q-2** | **INVOKER plus column grants, approved, with C-1.** No `SECURITY DEFINER`, in line with the 50-function DEFINER finding (payment-tables-lockdown memory). |
| **Q-3** | **Add the owner policy and column grant now.** The listed columns are right: the owner's own price, credits, status, tax, refund and receipt. Stripe ids, `lot_id`, `flag_reason`, versions and `checkout_expires_at` stay hidden. It is server-write-only, as in the payment-tables-lockdown pattern. Slice 5's owner read repository pins its column subset against this GRANT line. |
| **Q-4** | **Arguments, approved**, with C-4's bounds. Config (`BOOST_PURCHASE_CAP_DEFAULT`) stays the single source, and slice 3 passes it. |
| **Q-5** | **Yes, credit an `expired` row** after the session-id, livemode, currency and amount checks pass. A lost or raced expiry event must not lose a paid boost (F-1). `failed`, `abandoned` and `flagged_mismatch` stay not creditable. |
| **Q-6** | **Yes:** `flagged_mismatch` with `flag_reason = account_deleted`, and no lot. The flag is the record. The refund is an admin action in Stripe, and slice 6 / the 4b reconcile pass surface it. |
| **Q-7** | **`auth.users` with `ON DELETE SET NULL`, approved** (NFR-12). The `set` function still requires a plan row (`no_plan_row`), so the FK choice does not loosen eligibility. |
| **Q-8** (process) | **Agreed with TL: PGlite only in the session scratchpad, at a pinned exact version, never in the repo's `package.json` or lockfile, and a throwaway run only.** It is technically useful as a smoke test. **What it can prove:** the migration and probe parse and compile (plpgsql bodies are only fully checked when executed, so running the probe matters), every CHECK, UNIQUE and FK fires, the function outcomes for every probe step, the step order in `reserve`, and the rollback's refusal and drop order. With roles emulated (below), it can also show grants and RLS behaving under `SET ROLE`. **What it cannot prove:** PROD's actual state (that 11a's objects and grants are as the md5s say); Supabase's **default privileges** as configured on PROD (PGlite has none unless emulated, so a missing `REVOKE` would look harmless there); PostgREST exposure; the SQL editor's paste parsing (the word **into**, statement splitting); **real concurrency** of the advisory lock (PGlite is one connection); extensions; and performance. **To make it meaningful:** (1) create the roles `anon`, `authenticated` and `service_role` (NOLOGIN), and run `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role` (and the same `ON FUNCTIONS`) **before** applying, to mimic Supabase. (2) Stub `auth.users (id uuid primary key)` and `auth.uid()`, which reads `current_setting('request.jwt.claims', true)::json->>'sub'`. (3) Create the minimal `business_os_account_plans (user_id uuid primary key references auth.users)`. (4) Apply `20261017` verbatim, then `20261030`. (5) Seed one user with a plan row, and run the probe with that id. First run a two-line sanity check that `SET ROLE authenticated` plus RLS actually restricts rows in the pinned PGlite version. If it does not, use PGlite only for compile, CHECK and function-outcome checks, as superuser. The PROD checker and the mandatory PROD probe stay required in every case. Record the PGlite version and the result in §6.6. |
| **Q-9** | **Agreed:** `ch_` / `py_` and `dp_` / `du_`. Both prefixes are real Stripe id families. Keep the `chr(95)` form in the CHECKs. |

#### Other checks

- **Tenant isolation:** `reserve`, `attach` and `abandon` take the account and check it against the row (`not_found` for missing or foreign, P09). The admin override functions take the account from the admin route (slice 6, `requireAdmin`). 2b returns `out_user_id` from the row (R-6). Repository args are built field by field (P13/P14 and the unit tests). ✅
- **11a objects byte-identical and called correctly:** source `'boost_purchase'`, key `'boost' ∥ chr(58) ∥ session_id`, `source_ref` = purchase id, actor `'stripe_webhook'`, admin and reason NULL, expiry NULL, base and bonus from the row snapshot. That satisfies `boost_purchase_shape`. ✅ (C-2 for the key length.)
- **Cap:** the lock comes first, then plan row, override, sum per `livemode` over the rolling window by `created_at` with the counted statuses as in T-10, then the insert. Two tabs serialise. A `pending` row stops counting after expiry plus 5 minutes. This matches FR-20 to FR-23 and R-13. ✅
- **Grants:** `REVOKE ALL` from the four roles, owner column SELECT, column UPDATE only on mutable columns, and (C-1) column INSERT. ✅
- **Registries:** `never` purged, keyed to `auth.users`, `minimise` on deletion, matching the 11a entries. ✅
- **R-1:** belongs in slice 3, before `reserve` (C-6). ✅
- **Runbook:** paste rules, pre-check with stop conditions, apply-time capture, both checkers, the probe in a new tab on an account with a plan row, re-check that nothing was kept, and rollback only on the Dev's word. ✅ (C-3 adjusts B8.)
- **CI:** no added job or time. **Entitlements:** no import (G-7). ✅

**No user question.**

#### Approval

[x] Workplan approved with conditions C-1 to C-8. 2a may proceed. 2b proceeds per Q-1 with C-8 written into its §3.5 revision.

### SA Code Review (2a)

**Code Review by SA — 2026-10-05**
**Status:** ✅ **Code Approved for QA.** There are no must-fix items. Two items are owed before the PR or the PROD apply (CR-1, CR-2), and two optional low items follow.

**Scope:**
- **Created:** the migration `20261030`, the checker, the probe, the rollback, the migration test (74 tests), `BusinessOsBoostPurchaseRepository.ts` and its test (25 tests).
- **Modified:** `repositories/index.ts`, the three registries plus the baseline (144 → 146) and its pin, the entitlements doc paragraph, the requirement, and the slice 1 workplan (PR #224 links).
- **The 11a objects are untouched:** `git diff` names neither `20261015` nor `20261017`. The migration test pins the four md5s, and PGlite's B8 reports "yes".

#### What I verified myself

| Check | Result |
|---|---|
| The §7.4 local bar, 12 suites (my scratch config, `--runTestsByPath`) | ✅ **646 passed** |
| PGlite 0.5.8 (the Dev's harness, run in this session's scratchpad): setup, RLS sanity, apply 20261015 + 20261017 + 20261030, checker, lots checker, probe, row counts, second apply, probe guards | ✅ RLS sanity: `authenticated` sees only its own row and is denied the plans table (42501). Checker **VERDICT PASS 20 / 0**, with B8 INFO "yes". **Probe PASS** for P00–P16, leaving **0 / 0 / 0** rows. The second apply fails `42P07` at the first `CREATE TABLE`. The placeholder and no-plan-row runs both answer `PROBE SKIPPED` |
| PGlite mutation: table-level INSERT granted to service_role | ✅ The checker goes **FAIL 3** (B3 30, 31, 32) |
| PGlite mutation: `flag_reason` granted to `authenticated` | ✅ The checker goes **FAIL 1** (B2 21) |
| PGlite rollback | ✅ It refuses with a row present (`ROLLBACK REFUSED …`). Once empty, it drops both tables and the functions, and `business_os_credit_lots` remains |
| Jest mutation MA: owner grant gains `flag_reason` | ✅ Migration test red (1) |
| Jest mutation MB: the pending row's expiry grace removed (pending always counts) | ✅ Migration test red (1) |
| Jest mutation MC: `findForAccount` loses `.eq('user_id')` | ✅ Repository test red (1) |
| Restoration after each mutation | ✅ SHA-1 matches the pre-mutation copies |
| Paste rules on all four SQL files | ✅ No `--`, no literal containing the word **into**. The test pins the literal charset and `chr(58)` / `chr(95)` |
| Dev's 4 tsc errors (`MemoryManager.ts` 2, `CalibrationSessionRepository.ts` 1, `plugin-types.ts` 1) | ✅ **Pre-existing.** All three files are byte-identical to `origin/main`, and `CalibrationSessionRepository` is already exported from `index.ts` on main. The diff introduces no error |

#### Conditions C-1 to C-7

| | Met? |
|---|---|
| C-1 column INSERT | ✅ Purchases take 13 reserve columns, overrides take 5 and no `ended_*`. Checked by B3 31, P11 and the PGlite mutation |
| C-2 session id ≤ 194 | ✅ CHECK (B4 41), the `attach` refusal with the `cs_` prefix, and P06. The repository refuses the same before calling |
| C-3 B8 INFO | ✅ |
| C-4 bounds | ✅ TTL 1,800–86,400, window 1–366, cap > 0, override actor and reason checked (P10) |
| C-5 webhook finders | ✅ Renamed, JSDoc in place, prefix refusal, and an `app/` source guard that allows only the webhook and reconcile-cron routes |
| C-6 R-1 in slice 3 | ✅ Recorded |
| C-7 migration numbers recorded with both sessions | ⬜ **Owed by the coordinator before the PR** (CR-1) |

#### §7.5 deviations: all accepted

- 1: `abandon` → `not_pending` is an explicit and harmless outcome.
- 2: **B3 33 (`BYPASSRLS`) is a good catch.** INVOKER functions running as service_role read and write RLS-enabled tables, so they depend on service_role bypassing RLS. Supabase's service_role does, and the 11a / 3b-i functions rely on the same thing implicitly. Making it a checked fact is right.
- 3: probe guard six (skip when the account already has boost rows). Accepted, because the probe is an apply-time tool. After go-live, a probe re-run needs an account with no boost history.
- 4: the catch-all `PROBE FAIL` with its SQLSTATE.
- 5: the extra override index, which slice 6 needs.
- 6: the repository naming and inputs, and the prefix refusal in the `…ForWebhook` finders.
- 7: the md5 cross-check test.

#### Tenant isolation, grants and registries

- **Tenant isolation:** `attach` and `abandon` lock the row and answer `not_found` for a missing **or** foreign row (P09). `reserve` and `set_cap_override` write `user_id` only from the argument the server supplies. The repository builds RPC args field by field, scoped reads carry `.eq('user_id')` (MC proves the test catches its removal), and the unscoped finders are guarded. ✅
- **Grants:** server-write-only (payment-tables-lockdown pattern). `REVOKE ALL` from all four roles, the owner gets column SELECT on 18 columns with Stripe ids, `lot_id`, `flag_reason` and versions hidden, service_role gets column INSERT and UPDATE only on the mutable columns, nobody gets DELETE or TRUNCATE (P12), and EXECUTE goes to service_role only (B6). ✅
- **Registries:** both tables are `never` purged, keyed to `auth.users` (`ON DELETE SET NULL`), and `minimise` on deletion, with the same wording and mechanism as the lots. The baseline is 146 with its pin updated. ✅

#### Findings

| # | File | Finding | Priority |
|---|---|---|---|
| **CR-1** | §6.5 | **C-7 is still owed:** record `20261030` and `20261031` with the plan-payments and credit-deduction sessions, and put the date in §6.5, **before the 2a PR is opened**. | Process (before the PR) |
| **CR-2** | §6.6 runbook | PGlite ran **PostgreSQL 18.3**. Step 2 of the PROD pre-check should also record `SELECT version();`, and the results section should note that the PGlite run was on PG 18. It is a smoke test only; the PROD checker and probe remain the proof. | Low (before the apply) |
| CR-3 | migration, `attach` | `p_checkout_expires_at` is not bounded. A slice 3 bug passing a far-future expiry would keep a `pending` row counting toward the cap, though never beyond the 30-day window. Optionally refuse an expiry ≤ now() or > now() + 24 h + 5 min with `22023`, plus one P06 line. | Low (optional) |
| CR-4 | registries (information only) | `receipt_url` and the Stripe ids stay on a detached row after account deletion. That is correct for a financial record, and consistent with `minimise`. No change. | Info |

#### Code Approved for QA: **Yes**

The 2a PR may be opened after CR-1. QA re-runs the 12-suite bar and, at its option, the PGlite harness. The PROD apply follows §6.6, with CR-2's `version()` line.

## QA Testing Report

### QA — 2a (2026-10-05)

**Verdict:** ✅ **PASS WITH NOTES.** The core requirements hold: the cap arithmetic, mode separation, overrides, attach and abandon outcomes, grants and RLS, account-deletion detach, and the rollback refusal. There is no High defect. I found one Medium defect, in the read-only checker (QA-D1), with a one-line fix that should land before the PR. There are two Low defects and some Info notes.
**Test mode:** full
**Strategy used:** A + B + C:
- **A:** the Jest suites, plus a scratch repository-edge suite.
- **B/C:** the Dev's PGlite harness run end to end, plus a new adversarial PGlite script of 134 checks. All of it lives in the session scratchpad, and none of it is committed.

There is no browser path (Option D does not apply).
**Focus:** api (SQL functions + repository), security (grants, RLS, tenant isolation), schema
**Skipped:** real concurrency, because PGlite runs a single backend. I tested two reserves in one statement instead. The PROD checker and probe are not something QA can run. `npm run test:bos-entitlements` is left to CI, because the worktree has no `node_modules`.
**Input source:** coordinator brief + workplan §6–§7

#### Commands run

| Check | Result |
|---|---|
| §7.4 local bar, 12 suites (scratch config, `--runTestsByPath`) | ✅ **12 suites, 648 tests passed**, 10.2 s |
| Scoped tsc (`tsconfig.slice2a.json`) | ✅ **0 errors in the touched files.** 4 in total, all pre-existing and outside the diff (`MemoryManager.ts` 2, `CalibrationSessionRepository.ts` 1, `plugin-types.ts` 1), the same as SA's run |
| Dev's PGlite harness, end to end: setup, RLS sanity, apply 20261015 + 20261017 + 20261030, second apply, checker, lots checker, the three probe guards, probe, row counts, rollback with a row, rollback when empty, re-apply, checker again | ✅ PostgreSQL **18.3** (PGlite 0.5.8). RLS sanity: the owner sees only their own row, and plans are denied with 42501. The second apply fails with `42P07`. Checker **VERDICT PASS 20 / 0** (B8 INFO "yes"). Each probe guard answers `PROBE SKIPPED`. **PROBE PASS P00–P16**, leaving 0/0/0 rows. The rollback refuses with a row present; once the tables are empty it drops all seven objects and `business_os_credit_lots` stays. Re-apply gives PASS 20 / 0 |
| QA adversarial PGlite script `pglite/qa2a.mjs` (scratchpad) | **133 / 134 pass.** The one failure is QA-D1 |
| QA repository edge suite `qa/boostRepo2a.qa.test.ts` (scratchpad) | 16 run. QA-D3 observed |
| Paste rules (scripted scan of every string literal in the four SQL files and the runbook SQL blocks) | ✅ No `--` and no `/*`. No literal contains the word **into**. The four files use only `[A-Za-z0-9_ ]` in literals. The runbook pre-check literals contain `.`, `(` and `,` (function signatures). That is fine for the editor, and the charset rule covers the files only |
| Source untouched | ✅ SHA-1 of all 13 non-doc changed or untracked files and `git status --porcelain` match the pre-QA snapshot. No source was mutated |

#### Test matrix

| Area / criterion | Probe ids | Result | Notes |
|---|---|---|---|
| Cap exactly $150 allowed, $150.01 refused (FR-20) | CAP-1, CAP-2 | ✅ Pass | `reserved` (counted 0); `cap_reached`, cap 15000 |
| Back to back near the cap: 10000 + 5000 then 1¢ | CAP-3 | ✅ Pass | The second is `reserved` (counted 10000); the third is `cap_reached` (counted 15000) |
| Two reserves in one statement (same backend, re-entrant lock) | CAP-4 | ✅ Pass | `reserved`, then `cap_reached`. Real two-session concurrency is not provable in PGlite (§6.8) |
| Test and live counted apart (R-10) | CAP-5 | ✅ Pass | Live is `reserved` with counted 0 while test is full |
| An in-flight pending row counts until expiry + 5 min | CAP-6, CAP-7 | ✅ Pass | 4 min after expiry it is still counted; 6 min after expiry it is not |
| Statuses: abandoned, expired and failed not counted; awaiting_payment and flagged_mismatch counted (T-10) | STATUS-* | ✅ Pass | |
| Rolling window by `created_at` | WINDOW-1..3 | ✅ Pass | 31 days old: 0; 29 days old: counted; a 1-day window excludes the 29-day row |
| Override raises the cap, lowers it below the counted sum, and is replaced, ended, and ended twice | OV-1..8, OV-22 | ✅ Pass | The previous override is ended `replaced` by the admin. After `end` the default applies again. A second end gives `none_active`. Only one active row after many sets |
| Override bounds | OV-9..21 | ✅ Pass | NULL admin, 2-char padded reason, 501-char reason, NULL reason, cap 0 or −5, `'usd'`: each `22023`. NULL user: `22004`. 3-char and 500-char reasons are accepted. `set` on an account with no plan row gives `no_plan_row`; `end` there gives `none_active` |
| Attach: shape and bounds (C-2, CR-3) | AT-1..10 | ✅ Pass | `pi_`, `CS_`, `cs` and 195 chars: `22023`. Expiry at now, in the past, or 24 h 5 m 1 s ahead: `22023`. NULL session: `22004`. Refusals store nothing. 194 chars exactly at 24 h 5 m: `attached` |
| Attach outcomes | AT-11..17 | ✅ Pass | Same session again: `already_attached`; another session: `session_conflict`; foreign or missing row: `not_found`. A foreign account presenting the **same** session gets `not_found`, so there is no oracle. Abandoned or expired row: `not_pending` |
| Attach a session already attached to another purchase | AT-18 | ⚠️ Info | Raises `23505` (UNIQUE), not an outcome. The repository maps it to an error result (verified). Slice 3 must treat it as a refusal |
| Late attach of a stale reservation | LATE-1 | ❌ **QA-D2** | See below |
| Abandon outcomes | AB-1..7 | ✅ Pass | Foreign: `not_found`; `abandoned`; `already_abandoned`; with a session: `has_session`; awaiting_payment with no session: `not_pending`; NULL id: `22004` |
| Reserve argument bounds (C-4) | ARG-* | ✅ Pass | 15 refusals with `22023` or `22004`. TTL 86,400 and window 366 are accepted. 7-decimal credits are rounded to 6. A package id of 33 chars or empty gives `23514`, and credits of 1e13 give `22003`. Both are table backstops; see Info I-1 |
| Grants: anon | GR-anon-* | ✅ Pass | SELECT, INSERT, UPDATE and DELETE on purchases, INSERT on overrides, and EXECUTE of all 5 functions: each `42501` |
| Grants: authenticated owner and another owner | GR-1..3, GR-hidden-*, GR-authenticated-* | ✅ Pass | The owner reads only their own rows through the 18 columns. Filtering for another account gives 0 rows; no claims gives 0 rows. `*` and 12 hidden columns (Stripe ids, `lot_id`, `flag_reason`, `checkout_expires_at`, versions, `updated_at`, `amount_subtotal_minor`, `status_changed_at`) give `42501`, **and so does a WHERE on a hidden column** (no oracle). Overrides are unreadable. No write and no EXECUTE |
| Grants: service_role direct writes | GR-svc-* | ✅ Pass | UPDATE of `price_minor`, `user_id` or `lot_id`, override `cap_minor`, DELETE of overrides, and INSERT with `status`: each `42501`. A direct UPDATE of `status` is permitted by the column grant, by design (Q-2); the repository source guard forbids it |
| Plan row deleted | DEL-1 | ✅ Pass | `no_plan_row`; existing purchase rows are kept |
| Auth user deleted (`ON DELETE SET NULL`) | DEL-2..5 | ✅ Pass | The delete succeeds. Purchases and active overrides are detached (`user_id` NULL); the plan row cascades. No CHECK blocks the detach. The old account id then gets `not_found` from attach and abandon |
| Checker after deletions | DEL-6 | ❌ **QA-D1** | See below |
| Rollback refusal with only override rows present | RB-1 | ✅ Pass | `ROLLBACK REFUSED …`, nothing dropped |
| Repository maps every SQL outcome; unknown status, two rows, unreadable figure or rejected RPC → error | repo edge suite | ✅ Pass | Reserve (3 outcomes + unknown), attach 23505, null counted figure (error, never 0), two rows, network rejection |
| Repository "never throws" | repo edge suite | ❌ **QA-D3** | See below |

#### Issues Found

##### Bugs

1. **QA-D1: checker B7 reports a false FAIL after normal account deletions.** Severity: **Medium**, because it is the PROD proof tool. Fix it before the PR. File: `scripts/check-bos-boost-purchases-migration.sql`, `integrity_summary.doubled_overrides` (about line 236).
   - Steps to reproduce: two accounts each have an active cap override, and both accounts are deleted. `ON DELETE SET NULL` sets both overrides' `user_id` to NULL, and `ended_at` stays NULL. Then run the checker.
   - Expected: `VERDICT PASS`. Detached overrides are not "an account with two active overrides". The partial unique index treats NULLs as distinct, so the database itself is consistent.
   - Actual: `VERDICT 19 pass 1 fail`, with `B7 no account has two active cap overrides :: 1 accounts with two active overrides`. `GROUP BY user_id` puts all the NULLs in one group.
   - Impact: no runtime effect. The checker turns red on PROD once two override-holding accounts are deleted, for example at 2b's apply re-check, and that would block an apply for no reason. Fix: add `AND override_row.user_id IS NOT NULL` to the B7 subquery, plus a migration-test pin. Optionally report detached active overrides as an INFO count.
2. **QA-D2: a late attach can push an account over its cap.** Severity: **Low**. It needs slice 3 to attach more than TTL + 5 min (at least 35 min) after reserving, and the owner cannot trigger that directly. File: the migration, `business_os_attach_boost_checkout`.
   - Steps to reproduce: reserve 15000 (A). A's `checkout_expires_at + 5 min` passes, so A stops counting. Reserve 15000 (B), which gives `reserved`. Now attach a session to A, which gives `attached`. A's expiry is replaced by Stripe's, so A counts again.
   - Expected: the cap holds (FR-20, FR-23), so a stale reservation cannot be revived.
   - Actual: counted **30000** against a cap of 15000.
   - Fix: `attach` refuses a row whose `now() >= checkout_expires_at + interval '5 minutes'`, as `not_pending` (or a new `reservation_expired`), plus a probe line. Do it before the PROD apply, or record it as a slice 3 rule ("attach immediately; on refusal, expire the Stripe session").
3. **QA-D3: the repository can reject instead of returning `{ error }`.** Severity: **Low**, because TypeScript callers cannot pass these inputs. File: `lib/repositories/BusinessOsBoostPurchaseRepository.ts`, in `reserve`, `attachCheckout`, `abandon`, `setCapOverride` and `endCapOverride`.
   - Steps to reproduce: call any of them with `null` or `undefined` as the input object.
   - Expected: `{ data: null, error }`, as the header promises ("Methods never throw").
   - Actual: the promise rejects with `Cannot read properties of null (reading 'accountId')`. The `ids` object is built from `input.accountId` **before** the `try`.
   - Fix: build `ids` inside the `try`, or use `input?.accountId`. Add one test per method.

##### Performance Issues

None. The cap sum uses the `(user_id, livemode, created_at)` index. Performance on PROD is not measurable here.

##### Edge Cases / Info

- **I-1:** `reserve` lets two inputs fall through to table errors rather than its own `22023`. A `package_id` of 0 or more than 32 chars gives `23514`, and credits above `numeric(18,6)` give `22003`. Both are refused, so nothing is unsafe. The SQLSTATE is only inconsistent with C-4's style. Optional: add `char_length(p_package_id) BETWEEN 1 AND 32` to the `22023` block.
- **I-2:** a detached active override (from a deleted account) stays `ended_at IS NULL` forever. That is harmless, because no account matches it. Slice 6's admin list should not show it as active.
- **I-3:** `reserve` in the repository passes a fractional `priceMinor` or `defaultCapMinor` to the RPC. PostgreSQL refuses it, so the result is an error and nothing unsafe happens. `setCapOverride` checks integers client-side, and `reserve` does not.
- **I-4:** the workplan §6.7 table header holds a literal line break (``md5 of the body (`⏎` stripped)``). It renders as a broken table. This is a documentation fix only.
- **I-5 (harness only):** the PGlite `auth.uid()` stub raises `22P02` on empty claims (`''::json`). Supabase's real `auth.uid()` does not. My script sets `{}` instead. This is not a product issue.

#### Recommended additions

| # | Test | Where | Priority |
|---|---|---|---|
| R-1 | B7 ignores detached overrides (`user_id IS NULL`): a static pin on the checker text and an INFO count | migration test + checker | **Must, with the QA-D1 fix** |
| R-2 | Probe line: a pending row past `expiry + 5 min` cannot be attached | probe P06 + migration test | With the QA-D2 fix |
| R-3 | Repository: each write method with a `null` input resolves to `{ error }` | repository test | With the QA-D3 fix |
| R-4 | Probe line: the cap boundary, where a price that makes counted exactly equal to the cap is `reserved` and 1 more is `cap_reached` | probe P02 | Should |
| R-5 | Probe line: the owner's `WHERE` on a hidden column gives `42501` | probe P13 | Nice |
| R-6 | Probe line: the auth-user delete detaches both tables (inside the probe's rollback, on a throwaway `auth.users` row, if the user accepts a temporary row in the transaction) | probe | Nice |
| R-7 | Probe line: attaching a session already used by another purchase gives `23505` | probe P06 | Nice |

#### Test Outputs / Logs

```text
12-suite bar:   Test Suites: 12 passed, 12 total   Tests: 648 passed, 648 total   Time: 10.167 s
Harness:        PostgreSQL 18.3 (PGlite 0.5.8)  checker 0 PASS VERDICT :: 20 pass 0 fail
                PROBE PASS  this error is expected and rolls everything back  (P00-P16 PASS, rows after 0/0/0)
                ROLLBACK REFUSED  the boost purchase tables hold rows so nothing was dropped
QA probes:      QA 2a probes: 133 pass, 1 fail
                FAIL DEL-6 :: checker after deletions: 19 pass 1 fail | 70 B7 no account has two active cap overrides :: 1 accounts with two active overrides
                LATE-1 :: stale pending reserve->(other reserve reserved)->late attach attached; counted now 30000 vs cap 15000  OVER CAP
Repo edges:     reserve(null) THREW Cannot read properties of null (reading 'accountId')   (same for attachCheckout, abandon, setCapOverride, endCapOverride)
Scoped tsc:     4 errors, all outside the diff (MemoryManager.ts 2, CalibrationSessionRepository.ts 1, plugin-types.ts 1)
```

#### Final Status
- [x] The 2a acceptance criteria pass. Ready for the PR **after QA-D1** (a one-line checker fix and its pin). QA-D2 and QA-D3 are Low. Either fix them in the same change, or record QA-D2 as a slice 3 rule. CR-1 (record the migration numbers) is still owed by the coordinator.
- [ ] Issues found that the Dev must address before commit: QA-D1 (Medium, checker only)

## Commit Info

*(RM populates.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-05 | Created | Slice 2 workplan drafted by Dev against requirement §18.10 (main `b3c32ea7`, after slice 1 PR #224). Proposes 2a (migration 20261030, reservation and cap) and 2b (migration 20261031, crediting and status). Nine SA questions; no business question |
| 2026-10-05 | SA workplan review: approved with conditions | Split approved. C-1 column-level INSERT. C-2 session id at most 194 characters (lot key limited to 200). C-3 checker B8 becomes INFO, with the md5 compare as the pre-check stop. C-4 argument bounds. C-5 webhook-only unscoped finders plus a guard. C-6 R-1 hold check in slice 3 before reserve. C-7 record migration numbers. C-8 2b rules (receipt fill, mismatch returns normally, no-session refusal, lots untouched by transitions). Q-1 to Q-9 ruled; Q-8 PGlite scratchpad-only with Supabase role emulation, PROD probe still mandatory. No user question |
| 2026-10-05 | 2a implemented; Code Complete | C-1 to C-7 applied (§3.4a), C-8 recorded for 2b. Migration 20261030, checker (B1–B10, plus B3 33 bypassrls), probe (P00–P16), rollback, migration test, repository and tests, registries (baseline 146), entitlements doc paragraph. PGlite 0.5.8 run green, with mutations caught (§6.8). The `test:bos-entitlements` file set gives 189 suites / 4,877 tests green; scoped tsc 0 errors in touched files (§7.5). Nothing committed |
| 2026-10-05 | SA code review (2a): Code Approved for QA | 12 suites and 646 tests re-run green. PGlite 0.5.8 (PG 18.3): checker PASS 20/0, probe P00–P16 PASS with 0 rows left, rollback refuses and drops. Grant mutations caught by B2 and B3; three Jest mutations caught. Paste rules clean. The 4 tsc errors are pre-existing (files identical to main). C-1 to C-6 met; deviations 1–7 accepted. CR-1: record migration numbers (C-7) before the PR. CR-2: `version()` in the pre-check. CR-3 optional (attach expiry bound) |
| 2026-10-05 | SA code review items CR-2 and CR-3 applied | CR-2: `SELECT version();` added to the pre-check, and the PGlite run noted as a PG 18.3 smoke test. CR-3: `attach` refuses an expiry at or before now, or more than 24 h 5 min ahead (`22023`); the repository refuses the same before the RPC; there are migration, probe P06 and repository tests. CR-1 left to the coordinator (§6.5 date TBD). 12 suites / 648 tests green; PGlite checker, probe and rollback green. Nothing committed |
| 2026-10-05 | QA (2a): PASS WITH NOTES | 12 suites / 648 green; scoped tsc 0 errors in the touched files. The Dev's PGlite harness ran end to end (PG 18.3, checker 20/0, probe P00–P16 PASS, rollback refuse and drop). QA's adversarial PGlite script passed 133/134: cap edges, mode, pending grace, statuses, window, overrides, attach and abandon edges, grants for anon / owner / stranger / service_role, deletion detach, rollback refusal. QA-D1 (Medium): checker B7 gives a false FAIL once two accounts with active overrides are deleted (NULL `user_id` grouped); a one-line fix before the PR. QA-D2 (Low): a late attach of a stale reservation re-counts it and can exceed the cap. QA-D3 (Low): repository methods reject on a null input. Paste rules clean. Recommended tests R-1 to R-7 |
| 2026-10-05 | QA (2a) follow-ups applied | QA-D1: checker B7 ignores detached overrides, with a new INFO row 73. QA-D2: `attach` answers `reservation_expired` for a stale reservation. QA-D3: repository write methods return `{ error }` on null input. I-4: §6.7 header fixed. Probe and test coverage R-1 to R-7 (P02 exact cap, P06 stale and reused session, P13 hidden-column filter, P17 account-deletion detach). Notes for slices 3 and 6 in §3.4b. 12 suites / 657 tests; PGlite checker, probe and rollback green; QA script 134/134. Nothing committed |
| 2026-10-06 | C-7 / CR-1 satisfied | §6.5: migration block 20261030–34 acknowledged by the credit-deduction session (2026-10-04) and the plan-payments session (2026-10-05; payments use 20261027, 20261028, 20261029, 20261036). Date recorded 2026-10-05 |
| 2026-10-06 | Probe P17 removed from PROD (user decision) | The production runbook must never write to `auth.users`. P17 was dropped from `scripts/probe-bos-boost-purchases-migration.sql`, and the detach check moved to a scratchpad-only file (`pglite/detach-check.sql`, harness step `detachCheck`). A migration-test assertion forbids any `auth.users` write in the probe. The detach rule is proven by checker B4 on PROD and by PGlite locally (§6.3, §7.5, §3.4b) |
| 2026-10-06 | 2a approved and committed, PR open | The user saw the diff and approved the commit (2026-10-06). RM committed on `feature/bos-credits-boost-slice-2` and opened a PR to `main`. PROD apply of 20261030 is pending: the user runs §6.6 after merge (pre-check incl. md5 and version, apply, checker, existing checkers, probe, recheck) |
