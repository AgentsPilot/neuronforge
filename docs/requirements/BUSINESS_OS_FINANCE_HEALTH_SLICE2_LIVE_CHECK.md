# Business OS Finance Page Slice 2: Live Check of Business Takings

> **Last Updated**: 2026-10-11

## Overview

This is a read-only check of the live production Supabase database for slice 2 of the admin Finance page. Slice 2 covers business takings (layer B, where clients pay businesses) and client-payment problems, grouped by currency. Nothing was written, migrated or changed.

**Method.** Column names came from the live PostgREST OpenAPI description (`GET /rest/v1/`, service role). Distributions came from full `select=*` reads, paged at 1,000 rows, of every table listed below. Every table is small. The scripts were kept in the scratchpad, not the repo.

**Refs.**

- Live DB: measured 2026-10-11.
- Code: `origin/main @ a66b4c41`.

This check re-verifies [BUSINESS_OS_FINANCE_HEALTH_LIVE_SCHEMA.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_LIVE_SCHEMA.md) (2026-10-09). Row counts have grown since then, and its claim of "no failure columns" needs the qualifications given below.

**Correction to the brief.** There is no `invoices` table. The table is `payment_invoices`.

---

## 1. Columns that matter

| Table | Amount / currency | Status | Timestamps | Linkage | Fee / refund |
|---|---|---|---|---|---|
| payment_transactions | `amount` numeric, `currency` | `status`, `refund_status` | `paid_at` (110/110), `created_at`, `refunded_at` | `user_id` (business), `contact_id`, `invoice_id`, `service_id`, `booking_id` | `processor_fee`, `net_amount`, `fee_currency` (51/110 set); `refunded_amount` |
| | | `failure_reason` (0 set) | | `stripe_connect_account_id`, `charge_account_kind` (connect 71 / platform 39), `processor_type` (stripe 71 / manual 39) | |
| payment_refunds | `amount`, `amount_minor`, `currency` | `status`, `failure_code`/`failure_message` (0 set) | `created_at`, `succeeded_at` | `user_id`, `transaction_id`, `invoice_id` | `fee_returned`, `refund_fee` (0 set) |
| payment_invoices | `amount`, `currency` | `status`, `refund_status` | `due_date` (date), `sent_at`, `paid_at`, `refunded_at`; `last_retry_at`/`next_retry_at` (0 set) | `user_id`, `contact_id`, `service_id`, `booking_id` | `refunded_amount` |
| payment_plans (plan definitions) | `total_amount`, `installment_amount`, `currency` | `is_active` | `created_at` | `user_id`, `service_id` | none |
| payment_plan_subscriptions | `installment_amount`, `next_charge_amount`, `currency` | `status` | `next_charge_at`, `last_failure_at` (0 set), `cancelled_at`, `completed_at` | `user_id`, `contact_id`, `payment_plan_id` | `last_failure_code` (0 set) |
| payment_plan_installments | `amount`, `currency` | `status` | `due_date`, `paid_at`, `cancelled_at`, `completed_at`; `last_retry_at`/`next_retry_at` (0 set) | `user_id`, `subscription_id`, `invoice_id`, `transaction_id` | none |
| payment_reminders | none | `status`, `error_message` (0 set) | `scheduled_at`, `sent_at`, `claimed_at`, `next_attempt_at` (0 set) | `user_id`, `invoice_id`, `installment_id` | `claimed_by`, `attempts` |
| scheduling_services | `price`, `currency` | `status` | | `user_id` | none |

No `livemode` column exists on any of these tables.

---

## 2. Test mode compared with live mode (SA-Q9)

| Signal | Finding |
|---|---|
| `livemode` column | Exists only on `business_os_billing_accounts`, `business_os_billing_events` and `business_os_boost_purchases` (layer A). There is **none in layer B** and none on `stripe_connect_accounts` |
| Stripe id prefix | The ids are `pi_` (71), `acct_` (71), `cus_`, `re_` (30), `in_` (113) and `sub_` (6). **Stripe ids do not encode the mode**, so a prefix cannot separate test from live |
| Row metadata | `payment_transactions.metadata` has no mode key. `payment_refunds.metadata` and `payment_plan_subscriptions.metadata` are empty |
| Webhook log | `processed_webhook_events.metadata.livemode` is `false` on 1,000 of the 1,000 rows read (1,659 rows in total). The rows are keyed by `event_id`, and there is no join to a transaction |
| Server key | The local `.env.local` `STRIPE_SECRET_KEY` is `sk_test_…`. The production Vercel value was not readable from here |

**Counts.** No row in layer B can be classified from the data alone. The evidence points to all 71 Stripe-processed transactions, 30 refunds and 6 plans being **test mode**. The 39 manual transactions have no mode at all.

**Implication.** Slice 2 needs one of the following, and SA should decide which:

- (a) A new `livemode` column written by the webhook, plus a backfill.
- (b) A deploy-level "Stripe is in test mode" banner, derived from the key prefix on the server.

Until then, the page must label layer B as **"includes test payments"**.

---

## 3. Status values and what counts as a problem

| Table | Live distribution | Failed | Stuck or at risk |
|---|---|---|---|
| payment_transactions (110) | succeeded 73, refunded 37. `refund_status`: none 71, full 37, partial 2 | **No failed status is ever written.** `failure_reason` is set on 0 rows, so failed charges are not stored here | none |
| payment_refunds (41) | succeeded 41 | `status != 'succeeded'`, or `failure_code` set (0 rows) | none |
| payment_invoices (140) | paid 59, refunded 36, cancelled 24, **overdue 16**, sent 5 | `overdue` | `sent` with a past `due_date` (0 today; all 5 are due in November) |
| payment_plan_subscriptions (6) | active 5, cancelled 1 | `last_failure_at` set (0 rows) | `active` with a past `next_charge_at` |
| payment_plan_installments (59) | paid 28, pending 18, cancelled 12, **overdue 1** | `overdue` | **`pending` with a past `due_date`: 2 rows** (due 2026-10-05, `retry_count` 0) |
| payment_reminders (188) | cancelled 110, sent 56, pending 22 | `failed` + `error_message='dead-letter: max attempts'` = dead-lettered (0) | see below |

**Reminders.** The status vocabulary comes from `2026-08-14_payment_reminders_claim.sql`, which documents `pending`, `processing`, `sent`, `failed` and `cancelled` and has **no CHECK constraint**. The lease is 90 s and `MAX_ATTEMPTS` is 5 (`PaymentReminderService.ts:37-38`).

The existing definition of "stuck" is `status='processing'` and (`claimed_at` is null or older than 90 s + 10 min). It lives in `STUCK_AFTER_SECONDS` in `AdminJobsQueuesRepository`.

Live state:

| Reminder group | Rows |
|---|---|
| processing | 0 |
| failed | 0 |
| claimed and sent | 56, all with `attempts` = 1 |
| claimed and then cancelled | 110, all with `attempts` = 1 |
| pending, unclaimed, due in the future | 22, the earliest due 2026-10-12 |

The maximum `attempts` value is 1, so **nothing is stuck today**. Reuse `ADMIN_QUEUE_SPECS.payment_reminders` rather than redefining "stuck".

---

## 4. Currencies

| Table | Currency counts | Own currency? |
|---|---|---|
| payment_transactions | USD 60, ILS 50 | yes, 0 null |
| payment_refunds | ILS 27, USD 14 | yes |
| payment_invoices | USD 73, ILS 67 | yes |
| payment_plans | ILS 13, USD 6 | yes |
| payment_plan_subscriptions | ILS 3, USD 3 | yes |
| payment_plan_installments | ILS 41, USD 18 | yes |
| scheduling_services | USD 20, ILS 16 | yes (the authority) |
| stripe_connect_accounts | usd 4, **lowercase** | yes |

Every money row carries its own currency, so **no join is needed**. Normalise the case of the currency code (Stripe writes lowercase). `fee_currency` is USD on all 51 rows that have a fee, including fees on ILS charges, so **fees must be grouped by `fee_currency`, not by `currency`**.

---

## 5. Size and existing readers

| Table | Rows |
|---|---|
| payment_transactions | 110 |
| payment_refunds | 41 |
| payment_invoices | 140 |
| payment_plans | 19 |
| payment_plan_subscriptions | 6 |
| payment_plan_installments | 59 |
| payment_reminders | 188 |
| payment_events | 635 |
| processed_webhook_events | 1,659 |

Transactions came from 5 accounts between 2026-09-10 and 2026-10-11. Bounded reads with a ceiling are ample; follow the `BILLING_CEILING` pattern.

**Existing all-accounts readers:**

| Reader | Tables | Guard |
|---|---|---|
| `AdminJobsQueuesRepository` | `payment_reminders` (counts and items) | `lib/repositories/__tests__/AdminJobsQueuesRepository.test.ts` (callers only from `app/api/admin/**` after `requireAdmin`, barrel included) and `adminReadMethods.guard.test.ts` |
| `BusinessOsFinanceReadRepository` | layer A only, no `payment_*` tables | Its own test pins that it makes no writes and has one caller (`financeHealthDeps.ts`) |

**No admin all-accounts read exists** for `payment_transactions`, `payment_refunds`, `payment_invoices`, plans or installments.

The payment repositories are writer or owner-scoped repositories (`PaymentRepository`, `PaymentRefundRepository.upsertFromStripe`, `PaymentPlanSubscriptionRepository`), several of which have Stripe-webhook placement guards:

- `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts`
- `invoiceIntentsStayUnowned.guard.test.ts`
- `lib/payments/__tests__/planSurfaces.guard.test.ts`

Per SA-F2, add the slice 2 reads to `BusinessOsFinanceReadRepository`, not to those writers.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Created | Read-only live check for slice 2 (layer B), by the schema-check agent |
