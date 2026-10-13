# Business OS Finance & Health Page — Live Schema Check

> **Last Updated**: 2026-10-09

## Overview

Read-only check of the live production Supabase schema for a planned read-only admin finance and business-health page. Nothing was written, migrated or changed.

**Method.** The `business-os-schema-check` skill says to measure the live database rather than read migrations. `npm run schema:check` only replays selects that already exist in code, so this check went straight to the live PostgREST OpenAPI description (`GET /rest/v1/`, service role). That description lists every exposed table and view with its column names and types, and returns no rows. Row counts came from `HEAD … Prefer: count=exact` with `limit=0`. A few small distinct-value reads (at most 2,000 rows each) were run on status, kind and currency columns.

**Refs measured.**

- Live DB: 2026-10-09.
- Migrations compared: `origin/main @ 88f97171`. This is the `docs/bos-finance-health-req` worktree, which has 230 migration files. The local `main` checkout is stale at `89dbc568`.
- Column lists were compared by a rough parser of `CREATE TABLE`, `ADD COLUMN` and `DROP COLUMN` statements in those migrations.

**Not verifiable this way.** CHECK constraints, indexes, RLS policies and function bodies. The allowed-values lists quoted below come from the migrations, so they are not live facts.

There are **two separate money layers**, and the page must not mix them:

| Layer | Meaning | Tables |
|---|---|---|
| **A — Platform revenue** | Business owners paying AgentPilot | `business_os_billing_*`, `business_os_boost_purchases`, `business_os_account_plans`, credits |
| **B — Business GMV** | Business owners' clients paying the business | `payment_*`, `scheduling_services` |

There is also a legacy agent-platform layer, made of `user_subscriptions`, `credit_transactions`, `boost_pack*`, `billing_events`, `subscription_invoices` and `exchange_rates`. It is not Business OS.

---

## A. Platform plan payments (Stripe, Business OS)

| table | column | live? | type | notes |
|---|---|---|---|---|
| business_os_billing_accounts | user_id | yes | uuid, nullable | **0 rows** |
| | livemode | yes | bool | |
| | subscription_status | yes | text | migration CHECK: incomplete, trialing, active, past_due, canceled, unpaid, paused, … |
| | bought_tier / pending_tier | yes | text | |
| | current_period_end | yes | timestamptz | |
| | cancel_at_period_end | yes | bool | |
| | ended_at | yes | timestamptz | **churn timestamp** |
| | last_paid_at / last_payment_failed_at | yes | timestamptz | |
| | failed_attempts | yes | int | |
| | founder_discount_applied_at | yes | timestamptz | |
| business_os_billing_events | kind | yes | text | **0 rows**. Migration CHECK: invoice_paid, invoice_payment_failed, payment_action_required, subscription_updated, subscription_ended, refunded, dispute_opened, dispute_closed, mismatch_refused |
| | amount_minor / amount_tax_minor | yes | int | **no Stripe fee column** |
| | currency | yes | text | |
| | tier, period_start/end, paid_at | yes | text / timestamptz | |
| | plan_written, refusal_reason | yes | bool / text | |
| business_os_account_plans | user_id (PK) | yes | uuid | **8 rows**. `tier` is NULL on all 8. Every row has cohort `champion`. Origin: 7 `backfill`, 1 `invite` |
| | tier, tier_expires_at | yes | text / timestamptz | |
| | cohort, cohort_expires_at | yes | text / timestamptz | |
| | trial_started_at / trial_ends_at / grace_ends_at | yes | timestamptz | |
| | period_anchor | yes | timestamptz | |
| | onboarding_started_at / profile_created_at | yes | timestamptz | |
| business_os_account_lineage | invite_id, parent/root_account_id, level | yes | | 1 row |
| | first_paid_at, first_payment_ref | yes | timestamptz / text | |
| business_os_entitlement_overrides | capability, op, expires_at, ended_at | yes | | 0 rows |

RPC `business_os_apply_plan_payment` is live. It is a writer, so the page must not call it.

## B. Credit boosts

| table | column | live? | type | notes |
|---|---|---|---|---|
| business_os_boost_purchases | status | yes | text | **0 rows**. Migration CHECK: pending, abandoned, awaiting_payment, paid, failed, expired, flagged_mismatch, partially_refunded, refunded, disputed, dispute_lost |
| | price_minor, currency, tax_exclusive | yes | int / text / bool | |
| | amount_subtotal/tax/total_minor | yes | int | |
| | amount_refunded_minor | yes | int | refunds are recorded here |
| | stripe_dispute_id, flag_reason | yes | text | |
| | credits_base/bonus/total | yes | numeric | |
| | paid_at, status_changed_at | yes | timestamptz | **no Stripe fee column** |
| business_os_boost_cap_overrides | cap_minor, currency, ended_at | yes | | 0 rows |
| boost_pack_purchases / boost_packs | price_paid_usd, refunded_at | yes | | **legacy** agent platform. 2 and 3 rows. Not in migrations |

## C. Credits and AI cost

| table | column | live? | type | notes |
|---|---|---|---|---|
| business_os_credit_charges | user_id, period_start, credits, cost_usd | yes | uuid / timestamptz / numeric | **265 rows**. kind is `charge` on all rows; triggered_by: owner 189, scheduled 74, external 2 |
| | kind, outcome, triggered_by, service, action_type | yes | text | |
| | group_id, action_id, is_fallback_priced | yes | | |
| business_os_credit_totals | (user_id, period_start) PK | yes | | **6 rows**. Pre-aggregated per account per period |
| | credits_total/owner/scheduled/external/adjustment | yes | numeric | |
| | cost_usd_total, charge_count, fallback_priced_count | yes | numeric / int | |
| business_os_credit_lots | source, credits_granted, expires_at, actor_admin_id | yes | | 1 row (`admin_grant`) |
| business_os_credit_lot_draws | kind, credits | yes | | 1 row (`reversal`) |
| token_usage | user_id, cost_usd, session_id, created_at | yes | uuid / numeric / uuid / timestamptz | **29,598 rows**, about 5,200 in the last 30 days. **No business_id column**; the linkage is user_id plus session_id. Not in migrations (dashboard-only) |
| | feature, component, category, activity_type, success | yes | varchar / bool | |
| daily_token_usage / monthly_token_usage | user_id, day/month, total_cost_usd | yes | views | 1,378 and 326 rows. Not in migrations |

RPCs that are live and could be used:

- `business_os_usage_summary(p_since, p_user_id)`
- `business_os_credit_period_start(p_anchor, p_at)`
- `get_user_usage_summary(days_back, target_user_id)` (legacy)

## D. Invites

| table | column | live? | type | notes |
|---|---|---|---|---|
| business_os_invites | created_at | yes | timestamptz | **2 rows** (both `champion`, issued by an admin) |
| | email_sent_at / email_attempted_at / email_problem_at | yes | timestamptz | sent is recorded (2 of 2) |
| | first_viewed_at | yes | timestamptz | **"opened" is recorded** (1 of 2) |
| | opened_by_existing_account_at | yes | timestamptz | |
| | claimed_at / redeemed_at / redeemed_account_id | yes | | accepted is recorded (1 of 2) |
| | revoked_at, link_expires_at, redemption_failed_at | yes | timestamptz | |
| | invite_type, grant_kind, issuer_kind, issuer_account_id | yes | text / uuid | |

## E. Currency, timezone and profile

| table | column | live? | type | notes |
|---|---|---|---|---|
| scheduling_services | currency | yes | text, default `ILS` | 36 rows: USD 20, ILS 16 |
| business_profiles | currency | yes | text, nullable | 6 rows: ILS 3, USD 2, NULL 1 |
| business_profiles | timezone | **no** | — | confirmed absent |
| user_preferences | timezone, timezone_confirmed_at | yes | varchar / timestamptz | 12 rows, all with a timezone. Only `timezone_confirmed_at` is in the migrations |

## F. Business GMV (clients paying businesses)

| table | column | live? | type | notes |
|---|---|---|---|---|
| payment_transactions | amount, currency, status, paid_at | yes | numeric / text | **97 rows**. Status: succeeded 67, refunded 30. Currency: USD 59, ILS 38 |
| | refund_status, refunded_amount, refunded_at | yes | | |
| | processor_fee, net_amount, fee_currency | yes | numeric / text | **Stripe fee recorded** (46 of 97 rows populated) |
| | processor_type, charge_account_kind | yes | text | |
| payment_refunds | amount, amount_minor, currency, status, succeeded_at | yes | | 34 rows, all succeeded |
| | fee_returned, refund_fee | yes | numeric | 0 rows populated |
| payment_invoices | amount, currency, status, paid_at, refunded_amount, refund_status | yes | | 126 rows |
| payment_plans | total_amount, currency, installment_* | yes | | 16 rows |
| payment_plan_subscriptions | status, currency, periods_paid, next_charge_at | yes | | 6 rows (active 5, cancelled 1) |
| | last_failure_code / last_failure_at | yes | | failed payments |
| | cancelled_at / cancel_reason | yes | | churn for client plans |
| payment_plan_installments | amount, currency, status, due_date, paid_at, retry_count | yes | | 51 rows |
| payment_reminders | status, attempts, claimed_by, claimed_at, next_attempt_at, sent_at | yes | | 168 rows (cancelled 109, sent 50, pending 9) |
| payment_events | event_type, entity_type, entity_id | yes | | 597 rows |
| stripe_connect_accounts | charges_enabled, payouts_enabled, currency | yes | | 4 rows |

## G. Legacy agent platform (not Business OS)

| table | column | live? | notes |
|---|---|---|---|
| user_subscriptions | status, canceled_at, cancel_at_period_end, monthly_amount_usd, trial_ends_at, free_tier_expires_at | yes | 4 rows. Not in migrations |
| credit_transactions | credits_delta, transaction_type | yes | 564 rows (deduction 554, allocation 10) |
| billing_events / subscription_invoices | amount_usd, amount_cents / amount_paid | yes | 0 rows each |
| exchange_rates | rate_to_usd | yes | 43 rows. **An FX table exists**, even though CLAUDE.md says there is no FX rate. Do not use it for Business OS sums without an SA decision |

---

## Discrepancies: migrations vs live

- Every Business OS table checked matches its migrations column-for-column: billing accounts and events, account plans, lineage, boosts, cap overrides, credit charges, totals, lots and draws, entitlement overrides, invites, `scheduling_services`, `business_profiles`, and all the `payment_*` tables.
- These tables are live but have **no migration** (they were created in the dashboard):
  - `token_usage`
  - `daily_token_usage` and `monthly_token_usage`
  - `user_subscriptions`
  - `credit_transactions`
  - `boost_pack_purchases`
  - `billing_events`
  - `subscription_invoices`
  - `exchange_rates`
  - the base columns of `user_preferences` (including `timezone`)
  - the base columns of `processed_webhook_events`
- CHECK constraints were **not verified live**.

## Numbers that cannot be produced today

- **Platform MRR, revenue, churn, failed plan payments and boost revenue.** The tables exist but are **empty** (0 billing accounts, 0 billing events, 0 boost purchases), and `tier` is NULL on every account plan. The page can only show zeros for now.
- **Stripe fees on platform revenue.** No fee column exists on `business_os_billing_events` or `business_os_boost_purchases`. Net platform revenue is not possible.
- **Refund fees for business GMV.** The columns exist but none are populated.
- **AI cost per business, other than per user.** Neither `token_usage` nor the credit tables has a business id. `user_id` is the only linkage.
- **Plan list price.** It is not in the database; it is in code or Stripe.
- **Cross-currency totals.** USD and ILS are both present in Layer B, so totals must be grouped by currency.

## Sizing

Every Business OS finance table is under 300 rows, so bounded reads are fine. `token_usage` (about 30k rows, growing by about 5k a month) is the only table that needs an aggregate. Use the existing views or RPC, or `business_os_credit_totals`, rather than a raw scan.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-09 | Created | Live check by the schema-check agent |
