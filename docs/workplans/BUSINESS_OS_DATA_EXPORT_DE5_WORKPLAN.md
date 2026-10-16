# Workplan: Business OS data export, DE-5: money

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md): §0.2 (DX-1a, DX-1b, DX-8), §0.3.1 (SQ-E5, SQ-E6), §0.3.7 (DE-5 row), §0.4 / §0.4.1, §0.6, §0.7, §0.8; §3.1 group B3
**Branch:** `feature/data-export-de5` (worktree `neuronforge-de5`, from origin/main `447d17a2`, which holds DE-1 #393, DE-2 #402, DE-4 #419 and DE-3 #432)
**Date:** 2026-10-16
**Status:** SA code-approved + QA PASS 2026-10-16; F-1 applied; committed by RM

## Overview

DE-5 adds the business's **client money** to "Download my data": what its clients were quoted, invoiced, charged and refunded, the payment plans they are on and their instalments, and which payment provider and Stripe account the business takes money through. These are the 15 tables DE-2 left `planned('DE-5')` in `lib/business-os/purge/descriptors.ts`. This workplan proposes **10 `include`** (explicit columns, a reason for every column left out) and **5 `exclude`** (with reasons). It reuses the DE-4 / DE-3 pattern unchanged: one descriptor per table, one section per table, every read through `BusinessDataExportRepository.listOwnedRowsForExport` keyed on the session user id, paged to the end, inside the Phase 1 row ceiling. No migration, no new route, no new dependency, no flag, no new file.

**What "money" means here.** IN: money between the business and **its clients** (DX-1b). OUT: money between the business and **us**, AgentPilot (plans, credits, boosts, the Stripe subscription it pays us: DX-1a). None of the 15 tables holds money paid to us by design (§1.2 F-3); T-0 Q9 proves it on live rows.

**Currency rules (CLAUDE.md § Currency & Timezone), applied:** every amount is exported exactly as stored, next to the currency column it is denominated in; nothing is converted (there is no FX rate in the platform); nothing is summed. The file carries **no money totals at all** in DE-5. A test pins both.

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. The 15 tables: proposals](#3-the-15-tables-proposals)
- [4. JSON columns](#4-json-columns)
- [5. Currency and the ledger conventions](#5-currency-and-the-ledger-conventions)
- [6. Files to Create / Modify](#6-files-to-create--modify)
- [7. Task List](#7-task-list)
- [8. Tests](#8-tests)
- [9. CI placement and runtime](#9-ci-placement-and-runtime)
- [10. Risks](#10-risks)
- [11. Live schema verification (SQL for TL)](#11-live-schema-verification-sql-for-tl)
- [12. Open questions for SA](#12-open-questions-for-sa)
- [13. Business calls (for the user, via TL)](#13-business-calls-for-the-user-via-tl)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

### 1.1 What DE-5 touches

| Area | Today (origin/main `447d17a2`) | After DE-5 |
|---|---|---|
| Descriptors | 15 rows `planned('DE-5')` (`descriptors.ts` §3.5 Payments, lines 616–635, and `proposals`, line 725) | 10 × `include` with `columns` + `excludedColumns`; 5 × `exclude` with reasons. `level`, `order`, `scope`, `snapshot`, `area` and `notes` unchanged on all 15 |
| Classification count | 155 = 13 include + 32 planned + 110 exclude | 155 = **23** include + **17** planned (DE-6: 12, DE-7: 5) + **115** exclude |
| Section ids | 14 (`classificationTypes.ts`) | + 10 (§2.3) |
| Groups | `account` (controller AgentPilot), `client_records` (processor) | unchanged; 8 new sections in `client_records`, 2 in `account` (SA-Q1) |
| Reads | 12 tables through `BusinessDataExportRepository`; `profiles` through `UserProfileRepository` | + 10 sections through the same repository method. No new repository, no new method |
| Route | `GET /api/user/data-export` runs `EXPORT_SECTIONS` | **unchanged code**; the sections ride the registry, audit counts are generic |
| Payload | `summary` = section counts, failed sections, size, duration | **unchanged**: no money total is added (§5) |
| DB | — | **none** |

### 1.2 Facts measured in code

Every column claim below is ❓ until T-0. Sources: migration bodies (read, not file names) and the physical catalog `lib/business-os/catalog/catalog.generated.ts` (live, 2026-09-10), which covers 6 of the 15 tables.

| # | Fact | Where | Consequence |
|---|---|---|---|
| F-1 | All 15 tables are `scope: { kind: 'user_id' }`; none is `via` | `descriptors.ts` | Repository bound E-2 holds; every read is `.eq('user_id', <session id>)` first |
| F-2 | Every table has `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` | `20260722`, `20260723`, `20260828b`, `20260828e`, `20260913` | Keyset paging by `id` works as for DE-3/DE-4. T-0 Q3 confirms live |
| F-3 | Money paid **to us** lives elsewhere: `billing_events`, `boost_pack_purchases`, `user_subscriptions`, `business_os_billing_*`, credit tables. The Stripe webhook routes platform events there, never to `payment_transactions` (`app/api/stripe/webhook/route.ts`; P-1 removed the last platform `invoice.paid` conversion) | webhook route, billing modules | The 15 tables are client money. Q9 probes live rows for any purchase / boost / plan marker anyway |
| F-4 | `payment_transactions.charge_account_kind` (`connect` / `platform`) says which Stripe account a **client's** charge lives on. `platform` = a legacy direct charge that landed on our platform account when a Connect account was revoked. It is still the client paying the business, not money to us | `20260828c_payment_account_context.sql` | IN as client money (§3.1). Not a "payment to us" |
| F-5 | **Fees are in their own currency.** `processor_fee` and `net_amount` are in `fee_currency` (Stripe's settlement currency), which "is NOT always the payment's". `payment_refunds.fee_returned` / `refund_fee` have **no currency column** | `20260904_processor_fees.sql` comments | Each amount is paired with its own currency column (§5.1). The two refund fee columns are SA-Q6 |
| F-6 | `payment_transactions.currency` and `payment_invoices.currency` are **nullable** (`DEFAULT 'USD'`, no NOT NULL). The other money tables have `currency NOT NULL` | `20260722`, catalog | A NULL currency is exported as NULL, never filled in (§5.2, SA-Q9). Q6 counts them |
| F-7 | Refunds are an **append-only ledger** (`payment_refunds`), positive amounts (`CHECK amount > 0`), own dates; `payment_transactions.refunded_amount` is a trigger aggregate of it | `20260828b_payment_refund_ledger.sql` | "Refunds as their own dated rows" holds by construction: the `refunds` section. Sign: §5.3, SA-Q4 |
| F-8 | No soft-delete column on any of the 15 (no `deleted_at`, `is_deleted`, `archived_at` in any migration). Statuses (`cancelled`, `refunded`, `failed`, `void`-like) are states, not deletes | migrations | **No `rowFilter`** in DE-5: all history in (DX-8). Q10 confirms no soft-delete column live |
| F-9 | `payment_processors.credentials` jsonb holds processor credentials ("account_id, access_token, etc.") | `20260723` | OUT, never selected (exact deny hit `credentials`). Q9 counts non-empty rows so the negative control is realistic |
| F-10 | `payment_refunds.idempotency_key` matches the `/_key$/` deny pattern | `20260828b` | OUT (internal dedupe key; would also fail the deny check) |
| F-11 | `payment_methods` is dead: zero app references, superseded by `saved_payment_methods`; the user confirmed 0 rows on 2026-08-16; the drop migration was never applied (descriptor note) | `2026-08-14_drop_payment_methods.sql`, descriptor | `exclude` (§3.15). Q9 re-counts; > 0 rows reopens it (SA-Q8) |
| F-12 | `payment_automation_rules` are 3 **coded defaults seeded** by the platform; "no CRUD API/UI" | `lib/payments/defaultPaymentRules.ts` header | Not data the owner entered: `exclude` (§3.12, BC-6) |
| F-13 | `payment_events` is the automation engine's event log ("used by AI for analysis and automation"); `payment_automation_executions` is its run history with claim / lease columns; `payment_reminders` are the reminders scheduled and **sent** to clients | `20260723`, `2026-08-14_*_claim.sql` | Activity (DX-1d), as `business_events` (§0.3.1 SQ-E7) and DE-4 BC-6 (reminder sent markers): `exclude` (BC-4, BC-5) |
| F-14 | Invoice ids were historically bearer links: a bare `/invoice/<id>` URL is still honoured while the invoice is younger than `TOKEN_EXPIRY_DAYS` | `lib/payments/invoiceAccessToken.ts` | `payment_invoices.id` must be in (rows reference it). Owner-only file, `no-store`; SA-Q5 rules |
| F-15 | `stripe_hosted_invoice_url` and `stripe_invoice_pdf` are Stripe-hosted links: anyone holding one can open (and pay) the invoice | catalog, Stripe semantics | OUT by default (BC-3) |
| F-16 | The ledger export already gives the owner `stripe_payment_intent_id` and `stripe_charge_id` | `lib/payments/ledgerService.ts` select | Precedent for including Stripe object ids (BC-11) |
| F-17 | Card data stored: `card_brand`, `card_last4` (`CHECK ~ '^[0-9]{4}$'`), `card_exp_month`, `card_exp_year` on subscriptions; `brand`, `last_four`, `expiry_month`, `expiry_year` on saved methods. "No card number is ever stored in this system" | `20260828e` comment, `20260723` | Brand + last 4 in; expiry out by default (§3.1 B3 wording "brand / last 4"), BC-1. Q11 proves no full card number sits in any text column |
| F-18 | Columns added after the 2026-09-10 catalog: `payment_refunds.reason_note`; `payment_plan_subscriptions.cancel_reason, cancel_note, cancelled_by`; `payment_plan_installments.cancel_reason, cancel_note, cancelled_by, cancelled_at`; `proposals.payment_terms_days, stop_reason, stop_note, stopped_at, sessions, package_booking_id` | `20260917`, `20260928b`, `20260928d`, `20260929`, `20260930`, `20261001`, `20261002` | Expected live counts in §11 Q2. A declared column that is not live fails the whole section (R-1) |
| F-19 | Tests that plant on `proposals` as "still planned (DE-5)" | `exportClassification.test.ts` lines 209–232, 385–386 | Re-planted on `lead_responses` (DE-6) (T-9) |
| F-20 | No touched file uses `console.*` (0 in `descriptors.ts`, every `data-export/*.ts`, `BusinessDataExportRepository.ts`, the route) | grep | Nothing to flag |
| F-21 | No import from `lib/business-os/entitlements/` in any touched file | grep | `business-os-entitlements` does not apply; `test:bos-entitlements` unaffected |

### 1.3 Live schema status

No read-only DB tool in this session and no DB env in the worktree. Every list in §3 is a proposal: final lists are written from T-0 Q1 (every live column in `columns` or `excludedColumns`, nothing else), and SA approves them at code review, as in DE-3 and DE-4. Nine of the 15 tables are **not in the physical catalog** at all, so their column sets come from migrations only and are the most likely to differ.

---

## 2. Implementation Approach

### 2.1 Reuse, not new

- **Descriptors:** 10 `const …_EXPORT: TableExportClassification` blocks, placed in a new `── DE-5: client money ──` block after the DE-3 block. New named reasons go in `EXPORT_COLUMN_REASON` / `EXPORT_REASON` (repeated reasons are named, not retyped: DE-4 SA-Q4). The 15 `planned('DE-5')` calls are replaced; nothing else on those rows changes.
- **Sections:** `clientRecordsSection(id)` for the 8 client sections, `accountTableSection(id)` for the 2 account sections (SA-Q1). Both factories exist. A `mapRow` only if SA chooses a metadata allow-list (SA-Q3).
- **Repository:** `BusinessDataExportRepository` unchanged (comment line only: "DE-5 money sections").
- **Ceiling, paging, failed sections, audit, logging:** unchanged. The new sections draw on the same `maxRows` budget.

### 2.2 Include, exclude: the rule used

| In | Out |
|---|---|
| What the business and its clients agreed and moved: quotes, invoices, payments, refunds, plans, instalments, with every status (DX-8) | Money paid to us (DX-1a): not in these tables |
| What the owner wrote: line items, notes (incl. private notes, as DE-4 BC-1), plan templates | Secrets: `credentials`, idempotency keys, anything on the deny list |
| Processor **references** (Stripe object ids): not credentials; they let the owner match their own Stripe dashboard | Bearer links (hosted invoice page, PDF link) |
| Card brand and last 4 | Card expiry (default, BC-1); no card number exists |
| Which provider and Stripe account the business uses, and its status | Provider capability flags (product facts, not the owner's) |
| | Activity (DX-1d): event log, automation runs, reminders sent |
| | Machinery: retry counters, claim / lease columns, reconciliation state, raw `metadata` (SA-Q3) |
| | `user_id` everywhere (`OWNER_ID`: it is in `export_metadata.user_id`) |

### 2.3 Sections, order and group

Plain words, because DE-8b names each CSV after its section (DE-4 SA-Q3).

| Section id | Table | Group / GDPR role | Position |
|---|---|---|---|
| `payment_account` | `stripe_connect_accounts` | `account` / controller (SA-Q1) | after `business_addresses` |
| `payment_providers` | `payment_processors` | `account` / controller (SA-Q1) | next; then the DE-4 sections unchanged |
| `quotes` | `proposals` | `client_records` / processor | after `time_off` |
| `invoices` | `payment_invoices` | `client_records` / processor | next |
| `payments` | `payment_transactions` | `client_records` / processor | next |
| `refunds` | `payment_refunds` | `client_records` / processor | next |
| `payment_plans` | `payment_plans` | `client_records` / processor | next |
| `client_payment_plans` | `payment_plan_subscriptions` | `client_records` / processor | next |
| `installments` | `payment_plan_installments` | `client_records` / processor | next |
| `client_payment_methods` | `saved_payment_methods` | `client_records` / processor | last |

`quotes`, not `proposals`: the product calls them quotes (`cancelQuoteStages.ts`, the package-quote accept page). `format_version` stays 2 (additive). `payload.ts` needs no change: both group descriptions already fit.

### 2.4 Tenant isolation (tenant-isolation-guard)

Read-only, service role, so RLS does not protect these reads (repository E-5). DE-4's rules, unchanged:

- The only id is `ctx.userId = getUser().id`. The route takes no input; the existing test proving a planted `?userId=` and `x-user-id` are ignored is extended to the 10 tables.
- First filter on every query: `.eq('user_id', ctx.userId)`. **Child tables are read by their own `user_id`**, never by following a parent id: `refunds` is not read "for my transactions", `installments` is not read "for my plans". A crossed pointer can therefore only ever carry a foreign uuid in a column, never a foreign row. Q8 measures every parent / child edge for crossed owners (expected 0).
- No find-by-id, no caller-supplied entity id, no write, trigger or upsert.
- Ids and foreign-key ids **are** exported (they are how a refund points at its payment inside the file), as in DE-4.

### 2.5 Deny list

The proposed `columns` in §3 match no exact entry and no pattern of the deny list (`/_token$/`, `/_secret$/`, `/_key$/`, `/_credentials$/`, `/_hash$/`, `/cost_usd$/`). **No `DENY_EXCEPTIONS` entry is proposed** (it stays at one). The two hits on these tables are excluded, not excepted: `payment_processors.credentials` (exact) and `payment_refunds.idempotency_key` (`_key$`).

Proposed hardening (SA-Q11, cheap, no runtime cost): add `card_number`, `cvc`, `cvv`, `client_secret` to `SECRET_COLUMN_DENY_EXACT`. None exists today (Q1, Q11 confirm); the entries stop a future column of that name from ever being exported by review mistake.

### 2.6 Logging and audit

Unchanged: the repository's existing lines (section, table, user id, pages, rows; never content or amounts). `DATA_EXPORTED` gains 10 section counts through the generic `sectionCounts` (counts only, never an amount or a currency).

---

## 3. The 15 tables: proposals

❓ = to be confirmed by Q1. "In" = in `columns`, in this order. "Out" = in `excludedColumns` with the reason shown. Every table's `user_id` is Out with `OWNER_ID` and is not repeated below. Reason names in `CAPS` are constants (existing or new, §6).

### 3.1 `payment_transactions` → `payments` (expected 31 + 0 = 31 ❓)

| | Columns |
|---|---|
| **In (28)** | `id`, `contact_id`, `invoice_id`, `booking_id`, `service_id`, `amount`, `currency`, `status`, `payment_method`, `description`, `failure_reason`, `paid_at`, `refund_status`, `refunded_amount`, `refunded_at`, `refund_reason`, `processor_type`, `processor_refund_id`, `processor_fee`, `net_amount`, `fee_currency`, `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_customer_id`, `stripe_connect_account_id`, `charge_account_kind`, `created_at`, `updated_at` |
| **Out** | `user_id` (`OWNER_ID`); `metadata` (`PROCESSOR_METADATA`: processor plumbing; SA-Q3); `account_resolution` (`RECONCILIATION_STATE`: our reconciler's work state, SA-Q7) |

Failed, pending and refunded payments are all in (DX-8). `charge_account_kind` stays in: it tells the owner a payment sits on the platform account rather than theirs (F-4), which matters when they reconcile.

### 3.2 `payment_refunds` → `refunds` (expected 24 ❓)

| | Columns |
|---|---|
| **In (20)** | `id`, `transaction_id`, `invoice_id`, `amount`, `amount_minor`, `currency`, `status`, `reason`, `reason_note`, `processor_type`, `processor_refund_id`, `stripe_connect_account_id`, `source`, `failure_code`, `failure_message`, `fee_returned`, `refund_fee`, `created_at`, `updated_at`, `succeeded_at` |
| **Out** | `user_id`; `idempotency_key` (`IDEMPOTENCY`: our internal dedupe key, and a deny-list hit); `initiated_by` (`ACTOR_ID`: the user id that started the refund inside our system, which can be an AgentPilot operator; `source` says how it was started); `metadata` (`PROCESSOR_METADATA`, SA-Q3) |

Failed and cancelled refunds are in (all history). `amount_minor` stays in: it is the figure Stripe was told, in the refund's own `currency`.

### 3.3 `payment_invoices` → `invoices` (expected 39 ❓)

| | Columns |
|---|---|
| **In (33)** | `id`, `contact_id`, `booking_id`, `service_id`, `invoice_number`, `amount`, `currency`, `status`, `line_items`, `due_date`, `payment_terms`, `notes`, `internal_notes`, `sent_at`, `paid_at`, `payment_method`, `payment_received_at`, `payment_notes`, `processor_type`, `processor_checkout_id`, `processor_payment_id`, `processor_customer_id`, `processor_payment_method_id`, `stripe_invoice_id`, `client_name`, `client_email`, `client_address`, `refunded_amount`, `refund_status`, `refunded_at`, `allow_online_payment`, `created_at`, `updated_at` |
| **Out** | `user_id`; `retry_count`, `last_retry_at`, `next_retry_at` (`RETRY_STATE`: the collection run's counters, product machinery, SA-Q12); `stripe_hosted_invoice_url`, `stripe_invoice_pdf` (`BEARER_LINK`: anyone holding the link can open and pay the invoice; the invoice itself is in the file; BC-3) |

Drafts, cancelled and refunded invoices are in. `internal_notes` in (as DE-4 BC-1, BC-7). `sent_at` in: the invoice's own issue state, used by the ledger export, not an email-activity marker (BC-8).

### 3.4 `proposals` → `quotes` (expected 27 + 6 = 33 ❓)

| | Columns |
|---|---|
| **In (32)** | `id`, `contact_id`, `service_id`, `booking_id`, `package_booking_id`, `document_id`, `supersedes_id`, `created_invoice_id`, `created_plan_id`, `title`, `description`, `currency`, `total`, `prices_include_tax`, `tax_rate`, `tax_label`, `payment_shape`, `payment_terms_days`, `sessions`, `status`, `valid_until`, `decline_reason`, `decline_note`, `stop_reason`, `stop_note`, `accepted_snapshot`, `sent_at`, `viewed_at`, `decided_at`, `stopped_at`, `created_at`, `updated_at` |
| **Out** | `user_id` |

Every status in (`draft` … `superseded`, `stopped`). `decline_note` is the client's own words to the business: client record, in. `viewed_at` is the quote's status `viewed`, in (BC-8). `accepted_snapshot` is the record of exactly what the client agreed to: in, whole, subject to the Q4 key census (§4).

### 3.5 `payment_plans` → `payment_plans` (expected 16 ❓)

| | Columns |
|---|---|
| **In (15)** | `id`, `service_id`, `name`, `description`, `total_amount`, `currency`, `supported_currencies`, `installment_count`, `installment_amount`, `installment_frequency`, `allowed_processors`, `preferred_processor`, `is_active`, `created_at`, `updated_at` |
| **Out** | `user_id` |

The owner's plan templates; inactive ones in.

### 3.6 `payment_plan_subscriptions` → `client_payment_plans` (expected 30 + 3 = 33 ❓)

| | Columns |
|---|---|
| **In (29)** | `id`, `contact_id`, `booking_id`, `service_id`, `payment_plan_id`, `stripe_subscription_id`, `stripe_schedule_id`, `stripe_price_id`, `stripe_customer_id`, `stripe_connect_account_id`, `installment_count`, `installment_amount`, `currency`, `frequency`, `periods_paid`, `status`, `next_charge_at`, `next_charge_amount`, `last_failure_code`, `last_failure_at`, `card_brand`, `card_last4`, `cancel_reason`, `cancel_note`, `cancelled_by`, `created_at`, `updated_at`, `completed_at`, `cancelled_at` |
| **Out** | `user_id`; `card_exp_month`, `card_exp_year` (`CARD_EXPIRY`, BC-1); `metadata` (`PROCESSOR_METADATA`, SA-Q3) |

`next_charge_amount` is in the row's `currency` (one currency per plan). Past-due, paused, cancelled and completed plans are in.

### 3.7 `payment_plan_installments` → `installments` (expected 26 + 4 = 30 ❓)

| | Columns |
|---|---|
| **In (26)** | `id`, `payment_plan_id`, `subscription_id`, `booking_id`, `contact_id`, `proposal_id`, `invoice_id`, `transaction_id`, `installment_number`, `label`, `trigger`, `amount`, `currency`, `due_date`, `status`, `paid_at`, `payment_method`, `processor_type`, `stripe_invoice_id`, `completed_at`, `cancel_reason`, `cancel_note`, `cancelled_by`, `cancelled_at`, `created_at`, `updated_at` |
| **Out** | `user_id`; `retry_count`, `last_retry_at`, `next_retry_at` (`RETRY_STATE`) |

### 3.8 `saved_payment_methods` → `client_payment_methods` (expected 15 ❓)

| | Columns |
|---|---|
| **In (12)** | `id`, `contact_id`, `processor_type`, `processor_customer_id`, `processor_method_id`, `method_type`, `brand`, `last_four`, `is_default`, `is_valid`, `created_at`, `updated_at` |
| **Out** | `user_id`; `expiry_month`, `expiry_year` (`CARD_EXPIRY`, BC-1) |

`processor_method_id` (a Stripe `pm_…` id) is a reference, not a credential: charging it needs the business's own secret key (BC-11, SA-Q5).

### 3.9 `stripe_connect_accounts` → `payment_account` (expected 14 ❓)

| | Columns |
|---|---|
| **In (13)** | `id`, `stripe_account_id`, `stripe_account_type`, `charges_enabled`, `payouts_enabled`, `details_submitted`, `onboarding_completed`, `country`, `currency`, `business_type`, `stripe_email`, `created_at`, `updated_at` |
| **Out** | `user_id` |

One row per user (`user_id UNIQUE`). §3.1 B3 says "ids and status only"; `country`, `currency` (the settlement currency, which explains `fee_currency` on payments), `business_type` and `stripe_email` are facts about the owner's own business, proposed in (SA-Q13).

### 3.10 `payment_processors` → `payment_providers` (expected 14 ❓)

| | Columns |
|---|---|
| **In (8)** | `id`, `processor_type`, `is_active`, `is_default`, `connection_status`, `last_verified_at`, `created_at`, `updated_at` |
| **Out** | `user_id`; `credentials` (`EXPORT_REASON.SECRET`: never selected, not even to drop later; exact deny hit); `supports_checkout`, `supports_saved_methods`, `supports_refunds`, `supports_partial_refunds` (`PROVIDER_CAPABILITY`: what the provider can do, a product fact, not the owner's data) |

"Name and status only, never keys" (§3.1 B3), as written. Disconnected rows are a status, in (as DE-1 SA Q-7).

### 3.11 `payment_events` → exclude

`exclude(EXPORT_REASON.ACTIVITY, 'payment event log feeding the automation engine; the payments, invoices and refunds it records are exported themselves (as business_events, §0.3.1 SQ-E7)')`. BC-5.

### 3.12 `payment_automation_rules` → exclude

`exclude(EXPORT_REASON.PLATFORM, 'the three coded default rules the platform seeds; the owner cannot create or edit them (defaultPaymentRules.ts)')`. BC-6. If a rules editor ships later, this is reopened.

### 3.13 `payment_automation_executions` → exclude

`exclude(EXPORT_REASON.ACTIVITY, 'automation run history and its claim / lease columns')`. BC-5.

### 3.14 `payment_reminders` → exclude

`exclude(EXPORT_REASON.ACTIVITY, 'payment reminders scheduled and sent to clients: emails sent are activity (as DE-4 BC-6)')`. BC-4.

### 3.15 `payment_methods` → exclude

`exclude(EXPORT_REASON.PLATFORM, 'dead table superseded by saved_payment_methods: no app reads or writes, 0 rows (user 2026-08-16); drop migration pending')`. Gate: Q9 shows 0 rows. If not, SA-Q8.

---

## 4. JSON columns

Approach (DE-4 / DE-3 precedent): owner-authored structures travel whole; a key allow-list only where a column mixes in data the owner did not enter. Q4 lists every key present; SA decides from it.

| Column | Proposed | Why / what Q4 must show |
|---|---|---|
| `payment_invoices.line_items` (array) | Whole | The owner's lines (description, quantity, unit price, total, tax). Any non-line key → reported |
| `payment_invoices.client_address` | Whole | Address parts of the billed client |
| `proposals.payment_shape` | Whole | How the client pays (one-off, deposit, milestones) as the owner set it |
| `proposals.sessions` (array) | Whole | The package's sessions |
| `proposals.accepted_snapshot` | Whole, after census | The record of what the client accepted. Q4 must show no token, signature secret or IP among its keys; any such key → SA-Q3 allow-list instead |
| `payment_transactions.metadata`, `payment_refunds.metadata`, `payment_plan_subscriptions.metadata` | **Out, whole column** (default) | Processor plumbing: Stripe event bits, ids already in their own columns, refund row ids. Raw webhook payloads are never exported. Q4 lists keys; if a key the owner would recognise is common (code writes `source: 'website_booking'` on payments and `returned_outside_processor: true` on refunds), SA-Q3 decides a named allow-list instead |
| `payment_processors.credentials` | Out, never read | Secret. Q4 does **not** read its keys |

---

## 5. Currency and the ledger conventions

### 5.1 Every amount next to its own currency

The pairing below is pinned in a test (§8 M-4): every amount column in `columns` must have its currency column in the same `columns`.

| Table | Amount column(s) | Denominated in |
|---|---|---|
| `payment_transactions` | `amount`, `refunded_amount` | `currency` |
| `payment_transactions` | `processor_fee`, `net_amount` | `fee_currency` (F-5: may differ from `currency`) |
| `payment_refunds` | `amount`, `amount_minor` | `currency` (minor units for `amount_minor`) |
| `payment_refunds` | `fee_returned`, `refund_fee` | **no currency column** (SA-Q6) |
| `payment_invoices` | `amount`, `refunded_amount`, `line_items[*]` amounts | `currency` |
| `proposals` | `total`, `payment_shape` / `sessions` amounts | `currency` |
| `payment_plans` | `total_amount`, `installment_amount` | `currency` (`supported_currencies` lists the others the plan accepts) |
| `payment_plan_subscriptions` | `installment_amount`, `next_charge_amount` | `currency` |
| `payment_plan_installments` | `amount` | `currency` |
| `stripe_connect_accounts` | — | `currency` = the account's settlement currency |

### 5.2 Rules

- **As stored.** Amounts are PostgREST's rendering of the stored `numeric` (JSON number), unrounded, unconverted. `scheduling_services.currency` (exported in DE-4) is the charge authority for a service; each money row carries the currency **it was actually charged / quoted in**, and that is what is exported. `business_profiles.currency` is never substituted, and a NULL currency is **exported as NULL**, never defaulted to USD or to the business currency (SA-Q9).
- **No FX.** Nothing in the export reads `exchange_rates` or converts. A source guard pins it (§8 M-5).
- **No sums.** The payload gains no total. `summary` keeps exactly its four keys (counts, failed sections, size, duration). Per-currency totals are what the ledger export is for; the owner already has it, and two money views of the same rows can disagree (SQ-E6).

### 5.3 SQ-E6 ledger conventions, as they apply to raw rows

| Convention (`ledgerService`) | In DE-5 |
|---|---|
| Refunds as their own dated rows | Yes: the `refunds` section, one row per refund, with its own `created_at` / `succeeded_at` |
| Refunds negative | **Stored positive** (`CHECK amount > 0`). Exported as stored; DE-8b's README says a refund row is money returned to the client and that `payments.amount` is the gross charge (so refunds are not counted twice). No signed column is invented (SA-Q4) |
| Currency on every amount | Yes (§5.1) |
| Per-currency totals | **None in DE-5** (§5.2). If DE-8b's README ever states a total, it is grouped by currency (SA-Q4) |
| ISO dates | As PostgREST returns them: ISO 8601 with offset for `timestamptz`, `YYYY-MM-DD` for `date` |
| Only `succeeded` / `refunded` payments | **Not followed**: DX-8 "everything we hold" puts failed and pending payments in too, with their status |

---

## 6. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/purge/descriptors.ts` | modify | 10 `include` consts (§3.1–§3.10), 5 `exclude` (§3.11–§3.15); new reason constants: `PROCESSOR_METADATA`, `RECONCILIATION_STATE`, `RETRY_STATE`, `BEARER_LINK`, `CARD_EXPIRY`, `ACTOR_ID`, `PROVIDER_CAPABILITY`, `IDEMPOTENCY` (wording final at T-3); the 15 `planned('DE-5')` replaced, nothing else on those rows |
| `lib/business-os/data-export/classificationTypes.ts` | modify | 10 section ids |
| `lib/business-os/data-export/classification.ts` | modify only if SA-Q11 | 4 names added to `SECRET_COLUMN_DENY_EXACT` |
| `lib/business-os/data-export/sections.ts` | modify | 10 registry entries (§2.3); header comment; a metadata `mapRow` only if SA-Q3 picks an allow-list |
| `lib/repositories/BusinessDataExportRepository.ts` | modify | Header comment only |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | modify | DE-5 block (§8) + re-plants on `lead_responses` |
| `lib/business-os/data-export/__tests__/sections.test.ts` | modify | Registry order, group, role |
| `lib/repositories/__tests__/BusinessDataExportRepository.test.ts` | modify | New sections resolve; cross-tenant; all statuses |
| `app/api/user/data-export/__tests__/route.characterization.test.ts` | modify | Deliberate re-pin (23 tables read in order; DE-3/DE-4 selects byte-identical; 10 new selects literal; audit counts) |
| `app/api/user/data-export/__tests__/route.test.ts` | modify | Billing tables never read; currency payload test; planted ids ignored |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | modify | New §0.9 "DE-5 status" (decisions, as built, SA rulings), per the always-update-main-requirement rule |
| `docs/workplans/BUSINESS_OS_DATA_EXPORT_DE5_WORKPLAN.md` | this file | Audit trail |

Not touched: the route, `payload.ts`, `limits.ts`, `lib/payments/*` (no reuse of `ledgerService` code, conventions only), any purge file other than `descriptors.ts`, any migration.

---

## 7. Task List

- ✅ T-0 TL runs §11 Q1–Q11 on prod (read-only) and pastes results here. **Gate:** no descriptor is written before Q1, Q3 and Q9
- ✅ T-1 SA workplan review: SA-Q1…SA-Q15; TL takes §13 to the user
- ✅ T-2 Finalise §3 from Q1 (every live column in `columns` or `excludedColumns`, nothing else) and §4 from Q4
- ✅ T-3 `descriptors.ts`: 10 include consts, 5 excludes, reason constants
- ✅ T-4 `classificationTypes.ts`: 10 section ids
- ✅ T-5 `sections.ts`: registry entries per §2.3 (and the SA-Q3 mapper if chosen)
- ✅ T-6 `classification.ts`: deny-list names (only if SA-Q11 approves)
- ✅ T-7 Repository header comment
- ✅ T-8 Tests per §8, every negative control shown red once by reverting its rule (mutation check)
- ✅ T-9 Re-plant the "still planned" negative controls from `proposals` to `lead_responses` (DE-6)
- ✅ T-10 Drift check: Dev fills Q12 with the final declared lists; TL runs it. Expect drift 0, missing 0. **Done:** TL ran it 2026-10-16, 0 drift / 0 missing (§11.3)
- ✅ T-11 Run `npm test -- lib/business-os/data-export lib/repositories/__tests__/BusinessDataExportRepository.test.ts app/api/user/data-export lib/business-os/purge` and record runtimes before / after (§9)
- ✅ T-12 Requirement §0.9 and Dev notes here; changes left **uncommitted** for SA code review, QA and the user's diff (RM commits)

---

## 8. Tests

All Jest, in existing files, in the existing required Jest job.

| # | Test | File | Negative control |
|---|---|---|---|
| M-1 | No `planned('DE-5')` left; the 10 tables are `include` with the §2.3 section ids; the 5 are `exclude` with non-empty reasons; counts 23 / 17 / 115 | `exportClassification.test.ts` | Re-plan `payment_refunds` → reported |
| M-2 | Column pins: each of the 10 `columns` lists literal, in order; `columns` ∪ `excludedColumns` equals the Q1 set | same | Move `stripe_hosted_invoice_url` into `columns` → pin red |
| M-3 | Secrets: `credentials` and `idempotency_key` are in `excludedColumns` and never in any select; `DENY_EXCEPTIONS` unchanged (1 entry) | same + `BusinessDataExportRepository.test.ts` | Plant `credentials` in `payment_processors.columns` → `denied_column` at request time (section `failed`) and the CI deny report |
| M-4 | **Currency companion:** for every DE-5 table, each amount column in `columns` has its currency column (§5.1 map, pinned in the test) in `columns` | `exportClassification.test.ts` | Drop `currency` from `payments` → red; drop `fee_currency` while `processor_fee` is in → red |
| M-5 | **No cross-currency sum, no FX:** a payload built from seeded USD + ILS + EUR payments, refunds and invoices (one payment with `fee_currency` ≠ `currency`, one with NULL currency) has `summary` with exactly its four keys; each row's amount and currency come out identical to the seed (NULL stays NULL); a source scan of `lib/business-os/data-export/**` and the repository finds no `exchange_rate`, `convertCurrency`, `fx` import and no amount field read | `route.test.ts`, `exportClassification.test.ts` | Add a `money_total` key to the summary in a planted build → red; plant an `exchange_rates` import in a scratch copy of the scan input → red |
| M-6 | **Money to us never read:** the fake client records every `from()` table; the run's set equals exactly the registry's 23 tables (+ the timezone read), and none of `billing_events`, `business_os_billing_accounts`, `business_os_account_plans`, `business_os_credit_*`, `user_subscriptions`, `boost_pack_purchases`, `credit_transactions` is touched, even when seeded | `route.test.ts` | Add a billing table to the registry in a planted run → red |
| M-7 | **Cross-tenant:** user A and B rows in all 10 tables, incl. B's refund pointing at A's payment and A's instalment pointing at B's plan; the export for A holds only A's rows, B's refund absent although it names A's payment | `BusinessDataExportRepository.test.ts` | Remove the fake's `user_id` filter → B rows appear, red |
| M-8 | **All history:** seeded `failed`, `pending`, `cancelled`, `refunded`, `draft`, `superseded` rows are all exported; no DE-5 descriptor has a `rowFilter` | same + `exportClassification.test.ts` | Add a `rowFilter` on `payments.status` → the "no rowFilter" pin red |
| M-9 | Registry order and groups per §2.3; 2 `account` / controller, 8 `client_records` / processor | `sections.test.ts` | — |
| M-10 | Characterization re-pin: tables read in order; the 13 DE-3/DE-4 select strings (incl. `profiles`) byte-identical to today's literals; the 10 new ones literal; audit `sectionCounts` has the 10 ids, counts only (no amount, no currency) | `route.characterization.test.ts` | — |
| M-11 | Metadata: if out, the three `metadata` columns are never selected; if SA-Q3 allow-list, a seeded `metadata` holding `client_secret`, a raw event and an unknown key yields only the named keys | `BusinessDataExportRepository.test.ts` / `sections.test.ts` | Widen the allow-list by a pattern → red |
| M-12 | Card data: no expiry column in any select (if BC-1 out); `card_last4` / `last_four` pass through as stored | `exportClassification.test.ts` | Plant `card_number` in a columns list → deny report (if SA-Q11) |
| M-13 | Purge baseline: `descriptorsForRun` identical for all level × area combinations; `level/order/scope/snapshot/area/notes` unchanged on the 15 rows | existing purge invariant suites | — |
| M-14 | Planted `?userId=<B>` and `x-user-id: <B>` change nothing in the 10 sections | `route.test.ts` (extend) | — |
| M-15 | Ceiling: 10 money sections draw on the shared row budget; over it → 413, no file | `route.test.ts` (extend existing case) | — |

---

## 9. CI placement and runtime

No new job, script or file: the tests extend suites already in the required Jest gate (a few dozen in-memory assertions, well under a second added). No type-check scope change (DE-2 SA-Q1). `test:bos-entitlements` not affected (F-21). T-11 records before / after runtimes; a material increase goes to SA.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A declared column that is not live (9 tables are absent from the catalog; F-18 columns are newer than it) fails the whole section (42703) | T-0 Q1 before writing; T-10 drift check; the failure is visible (`failed`), never silent |
| R-2 | A NULL currency next to an amount reads as "no currency" in the file | Exported as held; Q6 counts; DE-8b README says "currency not recorded"; never filled in (SA-Q9) |
| R-3 | `metadata` or `accepted_snapshot` carries a raw webhook payload, a `client_secret` or an IP | `metadata` out by default; Q4 census on `accepted_snapshot`; M-11 |
| R-4 | Invoice ids are bearer links for young invoices (F-14) | Owner-only download, `no-store`, counts-only logs and audit; SA-Q5 |
| R-5 | Refund fee columns have no currency; a reader could subtract them from the wrong figure | README wording (SA-Q6); no computation in the file |
| R-6 | `numeric` rendered as a JSON number could lose precision | All money columns are `numeric(10,2)` / `(12,2)` and `amount_minor` is `bigint` well under 2^53; Q6a reports max values |
| R-7 | The JSON body cap (4 MB, DE-4 SA-Q7) is reached sooner with money rows and `line_items` | Q7 measures the largest owner's bytes; today's largest account is ~200 kB with 57 payments; the cap refuses cleanly (413) |
| R-8 | Pinned tests planting on `proposals` break | T-9 re-plants deliberately on `lead_responses` |
| R-9 | `payment_methods` holds rows after all | Q9 gate; SA-Q8 reopens |
| R-10 | A child row's `user_id` differs from its parent's | Children are read by their own `user_id` (§2.4), so nothing foreign is exported; Q8 measures; any non-zero edge is reported to SA as a data-integrity finding |
| R-11 | Two money views disagree (file vs ledger export) | No totals in the file; README points to the ledger export for totals |

---

## 11. Live schema verification (SQL for TL)

**Read-only. Run on PROD in the Supabase SQL editor.** Outputs table and column names, types, constraint names, key names, status and currency codes, counts, sizes and user ids only: no row content, no amounts except maxima, never a credential. The editor's known word bug is avoided: no SQL below contains that four-letter preposition anywhere.

**File:** (pasted by TL; not committed)

```sql
-- Q1: every live column of the 15 tables (reconcile with §3)
SELECT table_name, ordinal_position, column_name, data_type, udt_name, is_nullable, is_generated, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('payment_transactions', 'payment_refunds', 'payment_invoices', 'proposals',
                     'payment_plans', 'payment_plan_subscriptions', 'payment_plan_installments',
                     'saved_payment_methods', 'stripe_connect_accounts', 'payment_processors',
                     'payment_events', 'payment_automation_rules', 'payment_automation_executions',
                     'payment_reminders', 'payment_methods')
ORDER BY table_name, ordinal_position;

-- Q2: column count per table, and whether each table is live at all
-- (expected from migrations: payment_transactions 31, payment_refunds 24, payment_invoices 39,
--  proposals 33, payment_plans 16, payment_plan_subscriptions 33, payment_plan_installments 30,
--  saved_payment_methods 15, stripe_connect_accounts 14, payment_processors 14)
SELECT t.table_name, count(c.column_name) AS columns
FROM (VALUES ('payment_transactions'), ('payment_refunds'), ('payment_invoices'), ('proposals'),
             ('payment_plans'), ('payment_plan_subscriptions'), ('payment_plan_installments'),
             ('saved_payment_methods'), ('stripe_connect_accounts'), ('payment_processors'),
             ('payment_events'), ('payment_automation_rules'), ('payment_automation_executions'),
             ('payment_reminders'), ('payment_methods')) AS t(table_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = t.table_name
GROUP BY t.table_name ORDER BY t.table_name;

-- Q3: primary keys and unique constraints (is id a uuid PK everywhere?), plus unique indexes
SELECT tc.table_name, tc.constraint_type, tc.constraint_name,
       string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
 AND kcu.table_schema = tc.table_schema
 AND kcu.table_name = tc.table_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('payment_transactions', 'payment_refunds', 'payment_invoices', 'proposals',
                        'payment_plans', 'payment_plan_subscriptions', 'payment_plan_installments',
                        'saved_payment_methods', 'stripe_connect_accounts', 'payment_processors')
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
GROUP BY tc.table_name, tc.constraint_type, tc.constraint_name
ORDER BY 1, 2, 3;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('payment_transactions', 'payment_refunds', 'payment_invoices', 'proposals',
                    'payment_plans', 'payment_plan_subscriptions', 'payment_plan_installments',
                    'saved_payment_methods', 'stripe_connect_accounts', 'payment_processors')
  AND indexdef ILIKE '%unique%'
ORDER BY 1, 2;

-- Q4: top-level keys in the jsonb columns (key names and counts only; credentials is NOT read)
SELECT 'payment_transactions.metadata' AS col, k AS key, count(*) AS rows_with_key
FROM public.payment_transactions, LATERAL jsonb_object_keys(metadata) AS k
WHERE jsonb_typeof(metadata) = 'object' GROUP BY k
UNION ALL
SELECT 'payment_refunds.metadata', k, count(*)
FROM public.payment_refunds, LATERAL jsonb_object_keys(metadata) AS k
WHERE jsonb_typeof(metadata) = 'object' GROUP BY k
UNION ALL
SELECT 'payment_plan_subscriptions.metadata', k, count(*)
FROM public.payment_plan_subscriptions, LATERAL jsonb_object_keys(metadata) AS k
WHERE jsonb_typeof(metadata) = 'object' GROUP BY k
UNION ALL
SELECT 'payment_invoices.line_items[]', k, count(*)
FROM public.payment_invoices, LATERAL jsonb_array_elements(line_items) AS e, LATERAL jsonb_object_keys(e) AS k
WHERE jsonb_typeof(line_items) = 'array' AND jsonb_typeof(e) = 'object' GROUP BY k
UNION ALL
SELECT 'payment_invoices.client_address', k, count(*)
FROM public.payment_invoices, LATERAL jsonb_object_keys(client_address) AS k
WHERE jsonb_typeof(client_address) = 'object' GROUP BY k
UNION ALL
SELECT 'proposals.payment_shape', k, count(*)
FROM public.proposals, LATERAL jsonb_object_keys(payment_shape) AS k
WHERE jsonb_typeof(payment_shape) = 'object' GROUP BY k
UNION ALL
SELECT 'proposals.accepted_snapshot', k, count(*)
FROM public.proposals, LATERAL jsonb_object_keys(accepted_snapshot) AS k
WHERE jsonb_typeof(accepted_snapshot) = 'object' GROUP BY k
UNION ALL
SELECT 'proposals.sessions[]', k, count(*)
FROM public.proposals, LATERAL jsonb_array_elements(sessions) AS e, LATERAL jsonb_object_keys(e) AS k
WHERE jsonb_typeof(sessions) = 'array' AND jsonb_typeof(e) = 'object' GROUP BY k
ORDER BY 1, 3 DESC;

-- Q4a: shape of those columns (object / array / null / other), so Q4 misses nothing
SELECT 'payment_transactions.metadata' AS col, jsonb_typeof(metadata) AS shape, count(*) FROM public.payment_transactions GROUP BY 2
UNION ALL SELECT 'payment_refunds.metadata', jsonb_typeof(metadata), count(*) FROM public.payment_refunds GROUP BY 2
UNION ALL SELECT 'payment_plan_subscriptions.metadata', jsonb_typeof(metadata), count(*) FROM public.payment_plan_subscriptions GROUP BY 2
UNION ALL SELECT 'payment_invoices.line_items', jsonb_typeof(line_items), count(*) FROM public.payment_invoices GROUP BY 2
UNION ALL SELECT 'payment_invoices.client_address', jsonb_typeof(client_address), count(*) FROM public.payment_invoices GROUP BY 2
UNION ALL SELECT 'proposals.payment_shape', jsonb_typeof(payment_shape), count(*) FROM public.proposals GROUP BY 2
UNION ALL SELECT 'proposals.accepted_snapshot', jsonb_typeof(accepted_snapshot), count(*) FROM public.proposals GROUP BY 2
UNION ALL SELECT 'proposals.sessions', jsonb_typeof(sessions), count(*) FROM public.proposals GROUP BY 2
ORDER BY 1, 2;

-- Q5: status-like values in use (codes and counts only)
SELECT 'payment_transactions.status' AS col, status AS value, count(*) FROM public.payment_transactions GROUP BY 2
UNION ALL SELECT 'payment_transactions.refund_status', refund_status, count(*) FROM public.payment_transactions GROUP BY 2
UNION ALL SELECT 'payment_transactions.charge_account_kind', charge_account_kind, count(*) FROM public.payment_transactions GROUP BY 2
UNION ALL SELECT 'payment_transactions.account_resolution', account_resolution, count(*) FROM public.payment_transactions GROUP BY 2
UNION ALL SELECT 'payment_transactions.processor_type', processor_type, count(*) FROM public.payment_transactions GROUP BY 2
UNION ALL SELECT 'payment_refunds.status', status, count(*) FROM public.payment_refunds GROUP BY 2
UNION ALL SELECT 'payment_refunds.source', source, count(*) FROM public.payment_refunds GROUP BY 2
UNION ALL SELECT 'payment_invoices.status', status, count(*) FROM public.payment_invoices GROUP BY 2
UNION ALL SELECT 'payment_invoices.refund_status', refund_status, count(*) FROM public.payment_invoices GROUP BY 2
UNION ALL SELECT 'proposals.status', status, count(*) FROM public.proposals GROUP BY 2
UNION ALL SELECT 'payment_plan_subscriptions.status', status, count(*) FROM public.payment_plan_subscriptions GROUP BY 2
UNION ALL SELECT 'payment_plan_installments.status', status, count(*) FROM public.payment_plan_installments GROUP BY 2
UNION ALL SELECT 'payment_plans.is_active', is_active::text, count(*) FROM public.payment_plans GROUP BY 2
UNION ALL SELECT 'saved_payment_methods.method_type', method_type, count(*) FROM public.saved_payment_methods GROUP BY 2
UNION ALL SELECT 'payment_processors.connection_status', connection_status, count(*) FROM public.payment_processors GROUP BY 2
UNION ALL SELECT 'payment_processors.processor_type', processor_type, count(*) FROM public.payment_processors GROUP BY 2
ORDER BY 1, 3 DESC;

-- Q6: currency codes in use per table and column, incl. NULL next to an amount
SELECT 'payment_transactions.currency' AS col, currency AS code, count(*) FROM public.payment_transactions GROUP BY 2
UNION ALL SELECT 'payment_transactions.fee_currency', fee_currency, count(*) FROM public.payment_transactions GROUP BY 2
UNION ALL SELECT 'payment_refunds.currency', currency, count(*) FROM public.payment_refunds GROUP BY 2
UNION ALL SELECT 'payment_invoices.currency', currency, count(*) FROM public.payment_invoices GROUP BY 2
UNION ALL SELECT 'proposals.currency', currency, count(*) FROM public.proposals GROUP BY 2
UNION ALL SELECT 'payment_plans.currency', currency, count(*) FROM public.payment_plans GROUP BY 2
UNION ALL SELECT 'payment_plans.supported_currencies[]', c, count(*) FROM public.payment_plans, LATERAL unnest(supported_currencies) AS c GROUP BY 2
UNION ALL SELECT 'payment_plan_subscriptions.currency', currency, count(*) FROM public.payment_plan_subscriptions GROUP BY 2
UNION ALL SELECT 'payment_plan_installments.currency', currency, count(*) FROM public.payment_plan_installments GROUP BY 2
UNION ALL SELECT 'stripe_connect_accounts.currency', currency, count(*) FROM public.stripe_connect_accounts GROUP BY 2
ORDER BY 1, 3 DESC;

-- Q6a: currency traps (counts), and amount maxima for the precision check
SELECT
  (SELECT count(*) FROM public.payment_transactions WHERE currency IS NULL) AS tx_null_currency,
  (SELECT count(*) FROM public.payment_invoices WHERE currency IS NULL) AS inv_null_currency,
  (SELECT count(*) FROM public.payment_transactions WHERE processor_fee IS NOT NULL AND fee_currency IS NULL) AS fee_without_currency,
  (SELECT count(*) FROM public.payment_transactions WHERE fee_currency IS NOT NULL AND upper(fee_currency) <> upper(currency)) AS fee_in_other_currency,
  (SELECT count(*) FROM public.payment_refunds r JOIN public.payment_transactions t ON t.id = r.transaction_id
     WHERE upper(r.currency) <> upper(t.currency)) AS refund_currency_mismatch,
  (SELECT count(*) FROM (SELECT user_id FROM public.payment_transactions WHERE currency IS NOT NULL
     GROUP BY user_id HAVING count(DISTINCT upper(currency)) > 1) s) AS owners_with_several_currencies,
  (SELECT max(amount) FROM public.payment_transactions) AS tx_max_amount,
  (SELECT max(amount_minor) FROM public.payment_refunds) AS refund_max_minor;

-- Q7: largest owners by rows and approximate bytes across the 10 included tables
WITH s AS (
  SELECT user_id, pg_column_size(x.*) AS b FROM public.payment_transactions x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.payment_refunds x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.payment_invoices x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.proposals x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.payment_plans x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.payment_plan_subscriptions x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.payment_plan_installments x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.saved_payment_methods x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.stripe_connect_accounts x
  UNION ALL SELECT user_id, pg_column_size(x.*) FROM public.payment_processors x
)
SELECT user_id, count(*) AS rows, pg_size_pretty(sum(b)) AS approx_bytes
FROM s GROUP BY user_id ORDER BY sum(b) DESC LIMIT 5;

SELECT 'payment_transactions' AS t, count(*) FROM public.payment_transactions
UNION ALL SELECT 'payment_refunds', count(*) FROM public.payment_refunds
UNION ALL SELECT 'payment_invoices', count(*) FROM public.payment_invoices
UNION ALL SELECT 'proposals', count(*) FROM public.proposals
UNION ALL SELECT 'payment_plans', count(*) FROM public.payment_plans
UNION ALL SELECT 'payment_plan_subscriptions', count(*) FROM public.payment_plan_subscriptions
UNION ALL SELECT 'payment_plan_installments', count(*) FROM public.payment_plan_installments
UNION ALL SELECT 'saved_payment_methods', count(*) FROM public.saved_payment_methods
UNION ALL SELECT 'stripe_connect_accounts', count(*) FROM public.stripe_connect_accounts
UNION ALL SELECT 'payment_processors', count(*) FROM public.payment_processors;

-- Q8: cross-tenant parent / child integrity (expected 0 on every line)
SELECT 'refund->transaction' AS edge, count(*) FROM public.payment_refunds c JOIN public.payment_transactions p ON p.id = c.transaction_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'refund->invoice', count(*) FROM public.payment_refunds c JOIN public.payment_invoices p ON p.id = c.invoice_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'transaction->invoice', count(*) FROM public.payment_transactions c JOIN public.payment_invoices p ON p.id = c.invoice_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'transaction->contact', count(*) FROM public.payment_transactions c JOIN public.crm_contacts p ON p.id = c.contact_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'transaction->booking', count(*) FROM public.payment_transactions c JOIN public.scheduling_bookings p ON p.id = c.booking_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'invoice->contact', count(*) FROM public.payment_invoices c JOIN public.crm_contacts p ON p.id = c.contact_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'proposal->contact', count(*) FROM public.proposals c JOIN public.crm_contacts p ON p.id = c.contact_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'proposal->invoice', count(*) FROM public.proposals c JOIN public.payment_invoices p ON p.id = c.created_invoice_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'proposal->plan', count(*) FROM public.proposals c JOIN public.payment_plans p ON p.id = c.created_plan_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'proposal->supersedes', count(*) FROM public.proposals c JOIN public.proposals p ON p.id = c.supersedes_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'subscription->booking', count(*) FROM public.payment_plan_subscriptions c JOIN public.scheduling_bookings p ON p.id = c.booking_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'subscription->plan', count(*) FROM public.payment_plan_subscriptions c JOIN public.payment_plans p ON p.id = c.payment_plan_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'installment->plan', count(*) FROM public.payment_plan_installments c JOIN public.payment_plans p ON p.id = c.payment_plan_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'installment->subscription', count(*) FROM public.payment_plan_installments c JOIN public.payment_plan_subscriptions p ON p.id = c.subscription_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'installment->transaction', count(*) FROM public.payment_plan_installments c JOIN public.payment_transactions p ON p.id = c.transaction_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'installment->invoice', count(*) FROM public.payment_plan_installments c JOIN public.payment_invoices p ON p.id = c.invoice_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'installment->proposal', count(*) FROM public.payment_plan_installments c JOIN public.proposals p ON p.id = c.proposal_id WHERE p.user_id <> c.user_id
UNION ALL SELECT 'saved_method->contact', count(*) FROM public.saved_payment_methods c JOIN public.crm_contacts p ON p.id = c.contact_id WHERE p.user_id <> c.user_id
ORDER BY 1;

-- Q9: the exclusion gates and the money-to-us probe (counts only)
SELECT
  (SELECT count(*) FROM public.payment_methods) AS payment_methods_rows,
  (SELECT count(*) FROM public.payment_processors WHERE credentials IS NOT NULL AND credentials <> '{}'::jsonb) AS processors_with_credentials,
  (SELECT count(*) FROM public.payment_automation_rules) AS automation_rules,
  (SELECT count(*) FROM public.payment_transactions
     WHERE metadata ?| ARRAY['purchase_type', 'boost_pack_id', 'pilot_credits', 'plan_key', 'price_id']) AS tx_with_platform_purchase_keys,
  (SELECT count(*) FROM public.payment_transactions WHERE contact_id IS NULL) AS tx_without_client,
  (SELECT count(*) FROM public.payment_refunds WHERE initiated_by IS NOT NULL AND initiated_by <> user_id) AS refunds_started_by_other_id;

-- Q10: no soft-delete column on the 15 tables (expected 0 rows)
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name LIKE ANY (ARRAY['payment_%', 'saved_payment_methods', 'stripe_connect_accounts', 'proposals'])
  AND column_name IN ('deleted_at', 'is_deleted', 'archived_at', 'deleted', 'removed_at');

-- Q11: card data shape (counts only): last 4 is always 4 digits; no long digit run in any id or text column
SELECT
  (SELECT count(*) FROM public.payment_plan_subscriptions WHERE card_last4 IS NOT NULL AND card_last4 !~ '^[0-9]{4}$') AS sub_last4_bad,
  (SELECT count(*) FROM public.saved_payment_methods WHERE last_four IS NOT NULL AND last_four !~ '^[0-9]{4}$') AS saved_last4_bad,
  (SELECT count(*) FROM public.saved_payment_methods WHERE processor_method_id ~ '[0-9]{12,19}' OR processor_customer_id ~ '[0-9]{12,19}') AS saved_long_digits,
  (SELECT count(*) FROM public.payment_invoices WHERE notes ~ '[0-9]{13,19}' OR payment_notes ~ '[0-9]{13,19}' OR internal_notes ~ '[0-9]{13,19}') AS invoice_text_long_digits,
  (SELECT count(*) FROM public.payment_plan_subscriptions WHERE card_exp_year IS NOT NULL) AS sub_with_expiry,
  (SELECT count(*) FROM public.saved_payment_methods WHERE expiry_year IS NOT NULL) AS saved_with_expiry;
```

`invoice_text_long_digits` is informational only: a long digit run in free text can be a bank account or a phone number the owner typed, which DE-5 exports as written (same as DE-3 kept `invoice_footer_text`). A non-zero count goes to SA, not to a filter.

**Q12 (T-10, after implementation): drift and missing per table.** Dev fills the declared lists (`columns` ∪ `excludedColumns`) from the branch; TL runs it. Expect both empty.

```sql
-- Q12a drift: live columns the descriptor does not account for (repeat per included table)
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'payment_transactions'
  AND column_name NOT IN (/* Dev: the declared names */);
-- Q12b missing: declared names that are not live (repeat per included table)
SELECT d.name FROM unnest(ARRAY[/* Dev: the declared names */]::text[]) AS d(name)
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'payment_transactions' AND c.column_name = d.name);
```

---

## 12. Open questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| SA-Q1 | Group of `stripe_connect_accounts` and `payment_processors`: `account` (controller, facts about the business itself, as DE-3 SA-Q2 for the business profile) or `client_records` (processor)? | `account`, placed after `business_addresses`. Every other DE-5 table is `client_records` |
| SA-Q2 | Section ids and order (§2.3): `quotes` rather than `proposals`; `client_payment_plans` for subscriptions; `client_payment_methods` for saved methods | As §2.3 |
| SA-Q3 | The three `metadata` columns: out whole (no new code), or a named allow-list per column via `mapRow`, generalising `sourceMetadata` into a typed `pickKeys(value, keys)` that keeps booleans as well as strings? | Out whole, unless Q4 shows an owner-facing key in most rows; then a named allow-list (no prefix match) as BC-4 |
| SA-Q4 | SQ-E6 on raw rows: refunds stored positive (no invented signed column), and **no** per-currency totals anywhere in DE-5 (README in DE-8b explains, and points to the ledger export)? | Yes to both |
| SA-Q5 | Processor ids, per column: in = `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_customer_id`, `stripe_connect_account_id`, `stripe_subscription_id`, `stripe_schedule_id`, `stripe_price_id`, `stripe_invoice_id`, `stripe_account_id`, `processor_*_id`, `processor_refund_id`, `processor_method_id`. None is a credential; all are already visible to the owner in their Stripe dashboard or ledger export. And: invoice `id` stays in although a young invoice's bare URL still opens it (F-14) | All in; invoice id in (owner-only file; the ids are what links rows) |
| SA-Q6 | `payment_refunds.fee_returned` / `refund_fee` have no currency column. Export as stored, and DE-8b's README says they are "in the payment's fee currency (`payments.fee_currency`)"? That is the Stripe behaviour, but the schema does not record it | Export as stored; README wording SA's call; no inference in the data |
| SA-Q7 | `payment_transactions.charge_account_kind` in, `account_resolution` out (reconciler work state)? | Yes |
| SA-Q8 | `payment_methods` `exclude` as dead, gated on Q9 = 0 rows. If rows exist: include on the `saved_payment_methods` column rule, or keep out as unreachable? | Exclude; if Q9 > 0, include brand / last 4 / ids only |
| SA-Q9 | NULL `currency` next to an amount (nullable on payments and invoices): exported as NULL, never defaulted | Yes; README note in DE-8b |
| SA-Q10 | The amount → currency pairing (§5.1): a test-local pinned map (no new descriptor field), or a declarative field on the descriptor that DE-8b's README could read? | Test-local map (a new field is a new pattern) |
| SA-Q11 | Add `card_number`, `cvc`, `cvv`, `client_secret` to `SECRET_COLUMN_DENY_EXACT` (none exists; prevention only) | Yes |
| SA-Q12 | Retry counters (`retry_count`, `last_retry_at`, `next_retry_at`) on invoices and instalments: out as product machinery? | Out |
| SA-Q13 | `stripe_connect_accounts`: `country`, `currency`, `business_type`, `stripe_email` in, beyond the §3.1 "ids and status only" wording? | In (the business's own facts; `currency` explains the fee currency) |
| SA-Q14 | `payment_events` out as activity, against the §3.1 B3 table list, on the `business_events` precedent (§0.3.1 SQ-E7) | Out; user confirms as BC-5 |
| SA-Q15 | `payment_refunds.initiated_by` out (can be an operator id; `source` says how the refund started) | Out |

---

## 13. Business calls (for the user, via TL)

Plain terms. Each has a default; the build follows the default unless the user says otherwise.

| # | Question | Default |
|---|---|---|
| **BC-1** | When a client's card is saved, or a client pays by plan, we store the card's **brand and last 4 digits** and its **expiry month and year**. Should the expiry date be in the download? (No full card number is ever stored.) | **Brand and last 4 in; expiry out** |
| **BC-2** | Should **failed, cancelled, refunded and draft** payments, invoices, quotes and plans be in the download, each with its status? | **In** (everything we hold, DX-8) |
| **BC-3** | Each Stripe invoice has a **web link and a PDF link** that anyone holding them can open, and pay. Should those links be in the download? The invoice details themselves are in either way | **Out** |
| **BC-4** | The **payment reminders** we sent to clients (when, which kind). Emails sent are "activity", which you left out (same as booking reminders) | **Out** |
| **BC-5** | The **payment event log** and the **history of automatic payment actions** (behind-the-scenes records of what the system did) | **Out** |
| **BC-6** | The three **built-in automatic payment rules** (for example "remind 3 days before due"). They are product defaults you cannot edit | **Out** |
| **BC-7** | Your **private notes on invoices** (never shown to the client) | **In** (same as your private booking notes) |
| **BC-8** | When an invoice or quote was **sent**, and when the client **opened** a quote. These are the document's own status, not a copy of the email | **In** |
| **BC-9** | **Processing fees and the net amount** (what Stripe kept, what reached your account), each in its own currency | **In** |
| **BC-10** | **Stripe reference numbers** (payment, charge, customer, plan ids and your Stripe account id), so you can match each row in your Stripe dashboard. They cannot be used to take money | **In** |
| **BC-11** | **No totals.** The download lists every payment in its own currency and never adds different currencies together. For totals per currency, use the existing ledger export | **No totals in the download** |
| **BC-12** | Which payment provider you use and whether it is connected: **in**. Your provider **passwords and keys: never**, whatever you choose | **In / never** |

---

## SA Review Notes

_SA populates._

### SA workplan review DE-5 — 2026-10-16

**Reviewed by SA — 2026-10-16**
**Status:** ✅ Approved with conditions (C-1 … C-9). Code may start once TL has relayed the §13 answers; any BC answer that differs from the default changes only the column lists, which SA re-checks at code review.

**Reconciliation with §11.1 (T-0).** SA checked §3 against the live column lists by script: on all 10 included tables, `columns` ∪ `excludedColumns` equals the live set exactly. Nothing is missing, nothing extra, nothing listed twice (`source` appears in the refunds "Out" cell only in the prose). Live facts confirmed: uuid `id` PK on all 10 (keyset paging OK); no soft-delete column (no `rowFilter`, DX-8); 0 crossed owners on 18 links; `payment_methods`, `saved_payment_methods` and `payment_processors` have 0 rows; NULL `currency` 0 on payments and invoices; `fee_currency` NULL on 58 rows, always with a NULL fee (fee unknown, not zero); fee in a different currency than the payment on 39 rows; 2 owners use several currencies; Connect `currency` stored lower case; largest owner about 100 kB, far below the 4 MB cap.

**Architectural fit.** Matches the DE-4 / DE-3 pattern: descriptors only, the existing `clientRecordsSection` / `accountTableSection` factories, `listOwnedRowsForExport`, no new route, repository method, migration, flag or dependency. Tenant isolation is as `tenant-isolation-guard` requires: the session id is the only id, `.eq('user_id')` is the first filter, children are read by their own `user_id` and never by following a parent id, and there is no write. `business-os-entitlements` does not apply (F-21). No `console.*` (F-20).

#### Rulings on SA-Q1 … SA-Q15

| # | Ruling |
|---|---|
| SA-Q1 | **Approved: `account` / controller** for `payment_account` and `payment_providers`, after `business_addresses`. Which Stripe account and provider the business uses are facts about the business itself, the same as the business profile (DE-3 SA-Q2). The other 8 sections are `client_records` / processor. |
| SA-Q2 | **Approved** as §2.3 (`quotes`, `client_payment_plans`, `client_payment_methods`). |
| SA-Q3 | **Overruled in part.** `payment_refunds.metadata` and `payment_plan_subscriptions.metadata` are **out whole** (Q4: no keys on live rows). `payment_transactions.metadata` gets a **named allow-list, `['notes', 'source']`**, through a `mapRow`. Reason: `notes` is the text the owner typed when recording a cash or bank payment (`PaymentRepository.recordManualPayment` writes `metadata.notes`), and it is stored nowhere else. §2.2's own rule says what the owner wrote travels. Every other live key is out: `checkout_session_id`, `connect_account_id`, `subscription_id`, `stripe_invoice_id`, `booking_id`, `service_id`, `invoice_number`, `installment_count`, `installment_number`. They are processor plumbing or copies of columns that are already in. Implementation: generalise `sourceMetadata` into a typed `pickStringKeys(value, keys)` (strings only, own properties only, no prefix match); `sourceMetadata` becomes a one-line call to it, and its DE-4 tests stay unchanged and green. `metadata` moves from `excludedColumns` to `columns` on `payment_transactions` and its reason text records the allow-list. See C-3. |
| SA-Q4 | **Approved.** Refunds are exported positive, as stored, with no signed column invented. DE-5 adds no total of any kind; `summary` keeps exactly its four keys. If DE-8b's README ever shows a figure, it is per currency and never summed across currencies (CLAUDE.md Currency rules). |
| SA-Q5 | **Approved.** Every Stripe / processor id column in §3 is a reference, not a credential: using any of them needs the business's own secret key. That includes `processor_checkout_id`, which code stores as an id, not a URL. `stripe_hosted_invoice_url` and `stripe_invoice_pdf` are **out** as bearer links (BC-3 default). Invoice `id` stays in: rows reference it, and the file goes only to the owner, `no-store`, with counts-only logs. |
| SA-Q6 | **Ruled: export as stored; pair with nothing; infer nothing.** `fee_returned` and `refund_fee` have no currency column, and no code in the repo writes them today (only the catalog names them), so the platform never recorded what currency they are in. The export must **not** attach a currency to them: no `fee_currency` copied from the parent payment, and no refund `currency` implied. DE-8b's README says: "these two amounts have no recorded currency; for a Stripe refund they are normally in the payment's fee currency (`payments.fee_currency` on the linked payment); check your Stripe dashboard." The pairing test lists them in an explicit **no-currency-column** set (C-4). Before T-2, TL counts the rows where either is NOT NULL (C-1b). Any count is fine; the number goes in §0.9. |
| SA-Q7 | **Overruled: `charge_account_kind` is OUT** with `account_resolution`, under `RECONCILIATION_STATE` ("which Stripe account our refund path must target; internal routing state"). Reason: live, all 37 `platform` rows are `processor_type = 'manual'`. The column says "platform" on cash and bank payments the owner recorded, and in a client-money file "platform" reads as money paid to AgentPilot, which it is not. What the owner needs is already in: `processor_type` and `stripe_connect_account_id`. SA confirms these 37 rows are the owner's **manual client payments, not money paid to us**: `payment_transactions` is written only by client-money paths (recording a manual payment, booking checkout, invoice settlement); platform billing goes to the billing tables (F-3); 0 rows carry a purchase key (Q9). The exact cross-tab goes in C-1a. With this change: `payments` In = 27 (+ `metadata` per SA-Q3 = 28), Out = `user_id`, `account_resolution`, `charge_account_kind`. |
| SA-Q8 | **Approved: exclude.** Q9 shows 0 rows. |
| SA-Q9 | **Approved.** NULL stays NULL, never defaulted (live count 0). NULL `fee_currency` with a NULL fee is exported as is; the README says "fee not recorded", which is not the same as zero. Connect `usd` stays lower case as stored: no normalising, since that would be a change to the data. |
| SA-Q10 | **Approved: a map local to the test.** A new descriptor field would be a new pattern. |
| SA-Q11 | **Approved:** add `card_number`, `cvc`, `cvv` to `SECRET_COLUMN_DENY_EXACT`. `client_secret` is already caught by `/_secret$/`; add it only if a comment says it is listed for clarity, otherwise drop it. The existing deny report over all 155 descriptors must stay green with no new hit, so DE-1 … DE-4 output is unchanged. |
| SA-Q12 | **Approved: out** (`RETRY_STATE`). |
| SA-Q13 | **Approved: in**, `stripe_email` included. It is the owner's own email for their Stripe account (the create routes write it from the owner's input or auth email), so it is controller data about the business, not a client's data. `currency` explains `fee_currency` on payments. |
| SA-Q14 | **Approved: out** as activity, on the `business_events` precedent. Because this departs from the §3.1 B3 table list, it **needs the user's BC-5 answer**. If the user says in, it comes back to SA (event payloads would need a key census first). |
| SA-Q15 | **Approved: out.** |

#### Conditions

- **C-1 (T-0 add-on, before T-2; counts only).** (a) Cross-tab of `charge_account_kind × processor_type` on `payment_transactions`. It must show `platform` only with `manual`. Any `platform × stripe` row comes back to SA, because it would be a legacy direct charge, which is still client money, and the README would then need a sentence on it. (b) The count of `payment_refunds` rows where `fee_returned IS NOT NULL OR refund_fee IS NOT NULL`. (c) The count of `payment_transactions` rows with the `notes` key and with the `source` key, plus the distinct `source` values. Record all three in §11.1.
- **C-2 (column lists).** The §3 lists are approved as reconciled, with the SA-Q3 and SA-Q7 changes. The final literal lists go to SA at code review. M-2 asserts `columns` ∪ `excludedColumns` equals the §11.1 live set for every table. T-10 drift check: 0 drift, 0 missing.
- **C-3 (metadata allow-list test, extends M-11).** Seed `payment_transactions.metadata` with `notes`, `source`, `checkout_session_id`, `connect_account_id`, `client_secret`, an unknown key, and a non-string `notes`. The **section from the registry** (not the helper alone) must export only `{ notes, source }` as strings. Negative controls: build the section without its `mapRow` (raw keys appear → red), and widen the list by a prefix (red). The refunds and subscriptions selects must not contain `metadata`.
- **C-4 (currency-pairing test, M-4, made exhaustive).** The map in the test has three parts: amount → currency column for every amount (§5.1); a **no-currency-column set** of exactly `payment_refunds.fee_returned` and `payment_refunds.refund_fee`; and a completeness check. The completeness check: every DE-5 `columns` entry that is `type: 'money'` in `lib/business-os/catalog/catalog.ts` where that catalog covers the table, or that matches `/(^|_)(amount|fee|total)(_|$)|_minor$/` where it does not, must be in the map or the set. A new amount column with no pairing then fails the test. Exclude `tax_rate`, `*_currency`, `*_id` by name. The no-currency set must equal exactly those two columns. Negative controls: drop `fee_currency` while `processor_fee` is in (red); add a planted `deposit_amount` with no entry (red).
- **C-5 (currency values, extends M-5).** Seed values that cover the live traps: one payment in ILS with fees in USD; one in USD with NULL fee and NULL `fee_currency`; one refund in ILS whose parent payment has `fee_currency` USD, with `fee_returned` set; one Connect row with `usd`; two currencies for one owner. Every amount and currency comes out byte-equal to the seed. The refund row gains **no** currency key and its `currency` stays ILS (no pairing by computation). `summary` keys are exactly the four. The source scan of non-test `lib/business-os/data-export/**` and the repository finds no `exchange_rate`, `convertCurrency`, `toUpperCase()` on a currency, or FX import. Drop the vague phrase "no amount field read"; the scan is the pin.
- **C-6 (money to us never read, M-6 at two levels).** (a) Route level as written: the set of tables the fake client touches equals the registry's 23 tables plus the timezone read, with billing tables seeded. (b) Classification level: no `include` descriptor's table is in a named billing list (`billing_events`, `boost_pack_purchases`, `user_subscriptions`, `credit_transactions`, every `business_os_billing_*`, `business_os_account_plans`, `business_os_credit_*`). Each list entry must be a live table name; the name check from `business-os-schema-check` applies. Negative control: add a billing table to the registry (red).
- **C-7 (DE-3 / DE-4 output unchanged).** M-10: the 13 earlier select strings stay byte-identical; `clients.source_metadata` output stays identical after the `pickStringKeys` refactor (existing DE-4 tests untouched); the M-13 purge invariants hold; the deny-list additions add no hit to any existing include. The `proposals` → `lead_responses` re-plant (T-9) is the only edit to existing negative controls.
- **C-8 (tenant isolation).** M-7 as written, plus one case where B's instalment names A's subscription **and** A's invoice. M-14 is extended to all 10 sections. No find-by-id is added to the repository: a diff check at code review.
- **C-9 (CI time).** No new job, script or suite file. T-11 records runtimes before and after; more than 2 s added to the touched suites comes back to SA (no-added-CI-time rule).

#### Notes (not blocking)
- Free text such as `notes`, `payment_notes`, `internal_notes`, `payment_terms` and `decline_note` is exported as written, so it can contain bank details if the owner typed them. That is the same as DE-3 kept `invoice_footer_text`. Live long-digit count is 0. DE-3's "bank details OUT" applies to the structured bank columns, and DE-5 adds none.
- Requirement §0.9 must record the SA-Q3 and SA-Q7 overrulings and the SA-Q6 README wording (always-update-main-requirement).

### Approval
[x] Workplan approved with conditions C-1 … C-9: proceed to implementation after TL relays the §13 answers. C-1 counts go in §11.1 before T-2.

---

## Dev Implementation Notes (2026-10-16)

**Status:** Code complete, uncommitted on `feature/data-export-de5` (merged `origin/main` first: already up to date). Built under §11.1, §11.2, §13.1 (binding) and the SA review (C-1…C-9, SA-Q1…SA-Q15).

### What changed

| File | Change |
|---|---|
| `lib/business-os/purge/descriptors.ts` | New `── DE-5: client money ──` block: `MONEY_COLUMN_REASON` (PROCESSOR_METADATA, RECONCILIATION_STATE, RETRY_STATE, CARD_EXPIRY, ACTOR_ID, IDEMPOTENCY, PROVIDER_CAPABILITY), ten `*_EXPORT` include consts. The 15 `planned('DE-5')` calls were replaced: 10 by those consts and 5 by `exclude(...)` with reasons that name BC-4 / BC-5 / BC-6 and the dead table. `level`, `order`, `scope`, `snapshot`, `area` and `notes` are unchanged on all 15 rows |
| `lib/business-os/data-export/classificationTypes.ts` | Ten section ids |
| `lib/business-os/data-export/classification.ts` | `card_number`, `cvc`, `cvv` added to `SECRET_COLUMN_DENY_EXACT`. `client_secret` appears only in a comment, because `/_secret$/` already covers it (SA-Q11) |
| `lib/business-os/data-export/sections.ts` | `pickStringKeys(value, keys)` (strings only, own properties only, named keys only). `sourceMetadata` now calls it. `PAYMENT_METADATA_KEYS = ['notes', 'source']`, `paymentMetadata`, the `paymentRow` mapper. Ten registry entries per §2.3. Header comment |
| `lib/repositories/BusinessDataExportRepository.ts` | Header comment only |
| Tests | `exportClassification.test.ts`, `sections.test.ts`, `BusinessDataExportRepository.test.ts`, `route.characterization.test.ts`, `route.test.ts`, `purge/__tests__/SchemaReconciler.test.ts` (see D-5) |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | New §0.9 and a Change History row; insert-only (80 / 0) |

### BC-3 and the deny list (as asked)

`stripe_hosted_invoice_url` and `stripe_invoice_pdf` are in `payment_invoices.columns`. **No deny rule matches either name.** The exact list holds no such name, and neither name ends in `_token`, `_secret`, `_key`, `_credentials`, `_hash` or `cost_usd`. So **no `DENY_EXCEPTIONS` entry** was added (it still holds one entry), and nothing is silently excepted. A test pins `matchesSecretDeny(...) === false` for both, and pins that no exception names them.

### Conditions

| # | How it is met |
|---|---|
| C-2 | `DE5_PINS` holds the ten lists literally, in order, with the excluded key lists. `DE5_LIVE_TABLES` is §11.1 verbatim. The test checks the counts (31/24/39/33/16/33/30/15/14/14), 0 drift and 0 missing, and that `columns` ∪ `excludedColumns` equals the live set for every table |
| C-3 | Through the registry's `payments` section: a seed with `notes`, `source`, `checkout_session_id`, `connect_account_id`, `client_secret`, an unknown key and a non-string `notes` exports only `{ notes, source }` as strings. Negative controls: (a) the registry's `refunds` section, which has no mapper, passes the same raw metadata through; (b) adding prefixes (`connect_`, `checkout`, `client_`) to the key list adds nothing; (c) the list is pinned as exactly the two keys. Mutation checks: removing the mapper turned 32 tests red; widening the list turned 30 red. The refunds and subscription selects do not contain `metadata` (repository test + `exportColumnsOf`) |
| C-4 | A map local to the test (18 amount → currency entries, `processor_fee` / `net_amount` → `fee_currency`), a no-currency set that must be **exactly** `payment_refunds.fee_returned` and `payment_refunds.refund_fee`, and a completeness check. Negative controls: dropping `fee_currency` is red, a planted `deposit_amount` is red, and a fee column taken out of the set is red. See D-1 |
| C-5 | Route test with the live traps: an ILS payment with USD fees, a USD payment with a NULL fee and NULL `fee_currency`, an ILS refund under the USD-fee payment with `fee_returned`, Connect `usd`, and ILS + USD + EUR for one owner. Every row is byte-equal (`JSON.stringify`) to the seed projection. The refund has one currency key (`currency: 'ILS'`). `summary` keys are exactly the four. The audit holds counts only (no currency code, no amount). A source scan covers the non-test `lib/business-os/data-export/*.ts`, the repository and `route.ts` (`exchange_?rate`, `convertCurrency`, `fx`, `.toUpperCase(` / `.toLowerCase(`, `toFixed(`, and import paths naming currency / exchange / fx / money), with negative controls |
| C-6 | (a) Route level: the characterization pin requires the touched set to be exactly the 23 section tables; the timezone read is on `user_preferences`, already one of the 23. The five excluded money tables and 12 billing tables are seeded raw and asserted never read. `route.test.ts` seeds 14 billing + 5 excluded tables and asserts none is touched, with exactly 23 keys and no seeded marker in the body. Negative control included. (b) Classification level: `BILLING_TABLES` must each have a descriptor (names measured live) and be `exclude`, and no section resolves to one. Negative control: a planted include on `billing_events`. Names for TL to verify live: see below |
| C-7 | The 13 earlier select strings in the characterization test are untouched (the diff for that block is insertions only). `sourceMetadata` output is byte-identical: the DE-4 tests are unchanged and green, plus a new comparison against the verbatim DE-4 implementation over 9 inputs. The deny additions hit no existing include. Purge suites are green. The re-plant to `lead_responses` (T-9) is the only edit to existing negative controls |
| C-8 | Cross-tenant: B's refund names A's payment; B's instalment names A's subscription **and** A's invoice; A's instalment names B's plan. A's file holds A's rows only. The single foreign marker is B's plan id on A's instalment, as a bare uuid. Each money query's only `eq` is `user_id = A`, and none uses `in` / `not`. Negative control: a fake that ignores `.eq(user_id)` leaks both B rows. The planted `?userId=` / `x-user-id` test is extended to the ten tables. No find-by-id was added (repository diff is comment-only) |
| C-9 | See D-6 (comes back to SA) |

### Mutation check (each real rule reverted once, then restored in memory; no stash)

| Mutation | Result |
|---|---|
| `charge_account_kind` moved into payments columns | 10 red |
| `fee_currency` dropped from payments | 10 red (incl. M-4 pairing) |
| `payments` registered without `paymentRow` | 32 red |
| `card_number` / `cvc` / `cvv` removed from the deny list | 2 red |
| `PAYMENT_METADATA_KEYS` widened by `checkout_session_id` | 30 red |
| `.eq('user_id')` dropped from the repository | 49 red |

### Runtimes (T-11, C-9)

Same five export suites, `--runInBand`. Baseline: the HEAD versions of the changed files swapped in temporarily, then restored. The machine was loaded (another session's dev server was running).

| | Tests | Assertion time | Wall (sum of suites) |
|---|---|---|---|
| Before (HEAD), 2 runs | 240 | 4.85 s / 4.89 s | 9.13 s / 6.48 s |
| After, 2 runs | 345 | 6.34 s / 6.85 s | 11.28 s / 11.24 s |

By file (assertion ms, before → after): repository 3041 → 3044; characterization 875 → 1867; classification 466 → 781; route 345 → 758; sections 159 → 399.

Full requested set (data-export, purge, both export repository suites, route, `lib/client`): 26 suites, 742 tests, green. `npm run test:bos-entitlements`: 279 suites, 8333 tests, green. `npm run test:authz-guard`: 2 suites, 203 tests, green. ESLint on the changed files is clean.

### Deviations (for SA)

| # | Deviation |
|---|---|
| D-1 | C-4 completeness uses catalog money **∪** the name rule, not "catalog where it covers the table, name rule otherwise". The catalog types only `amount` as money on `payment_transactions` (and `amount` / `total` on invoices / quotes), so the narrower rule would let `processor_fee`, `net_amount` and `refunded_amount` through unpaired. The union is stricter. The JSON carriers (`line_items`, `payment_shape`, `sessions`, `accepted_snapshot`) are in the map too |
| D-2 | The billing list goes beyond SA's named entries. It adds `subscriptions`, `subscription_invoices` and `business_os_boost_purchases` (all `exclude(BILLING)` descriptors), and the route-level seed list also adds the explicit `business_os_credit_*` / `business_os_billing_*` names |
| D-3 | SA-Q3 asked that "its reason text records the allow-list". `metadata` is now in `columns`, which carry no reason field, so the allow-list is recorded in the `PAYMENT_TRANSACTIONS_EXPORT` doc comment and on `PAYMENT_METADATA_KEYS` |
| D-4 | `payments.metadata` is always an object, `{}` when the cell is NULL or not an object, the same as `clients.source_metadata` |
| D-5 | `lib/business-os/purge/__tests__/SchemaReconciler.test.ts` is not in §6 but pins the list of included tables. It was re-pinned (+10 tables, `DE-5:` comments). One existing line was split |
| D-6 | **C-9: about +2.0 s assertion time** (4.87 → ~6.6 s) across the five touched export suites, mostly the characterization re-pin (every GET now pages 23 tables, plus 37 new `it.each` cases). In-band wall time went up by 2–5 s on a loaded machine. That is at or over the 2 s line, so it **comes back to SA**. Done to keep it down: the new whole-registry repository tests seed only the money tables (DE-5 repository tests total 0.12 s). No new job, script or suite file |
| D-7 | The C-5 scan also covers `route.ts`, and also flags `.toLowerCase(` and `toFixed(` |
| D-8 | `exportColumnsOf` throw cases gain `payment_events` (an excluded money table) |
| D-9 | No `BEARER_LINK` reason constant (BC-3 made the links IN) |

### T-10: drift check for TL (single query, ten tables, 249 names; expect 0 rows)

Per-table declared counts: payment_transactions 31, payment_refunds 24, payment_invoices 39, proposals 33, payment_plans 16, payment_plan_subscriptions 33, payment_plan_installments 30, saved_payment_methods 15, stripe_connect_accounts 14, payment_processors 14. The SQL contains no "into".

```sql
-- DE-5 T-10: declared (branch) vs live, both directions, ten tables, 249 names. Expect 0 rows.
WITH declared(table_name, column_name) AS (
  VALUES
    ('payment_transactions','id'), ('payment_transactions','contact_id'), ('payment_transactions','invoice_id'), ('payment_transactions','booking_id'), ('payment_transactions','service_id'), ('payment_transactions','amount'),
    ('payment_transactions','currency'), ('payment_transactions','status'), ('payment_transactions','payment_method'), ('payment_transactions','description'), ('payment_transactions','metadata'), ('payment_transactions','failure_reason'),
    ('payment_transactions','paid_at'), ('payment_transactions','refund_status'), ('payment_transactions','refunded_amount'), ('payment_transactions','refunded_at'), ('payment_transactions','refund_reason'), ('payment_transactions','processor_type'),
    ('payment_transactions','processor_refund_id'), ('payment_transactions','processor_fee'), ('payment_transactions','net_amount'), ('payment_transactions','fee_currency'), ('payment_transactions','stripe_payment_intent_id'), ('payment_transactions','stripe_charge_id'),
    ('payment_transactions','stripe_customer_id'), ('payment_transactions','stripe_connect_account_id'), ('payment_transactions','created_at'), ('payment_transactions','updated_at'), ('payment_transactions','user_id'), ('payment_transactions','account_resolution'),
    ('payment_transactions','charge_account_kind'),
    ('payment_refunds','id'), ('payment_refunds','transaction_id'), ('payment_refunds','invoice_id'), ('payment_refunds','amount'), ('payment_refunds','amount_minor'), ('payment_refunds','currency'),
    ('payment_refunds','status'), ('payment_refunds','reason'), ('payment_refunds','reason_note'), ('payment_refunds','processor_type'), ('payment_refunds','processor_refund_id'), ('payment_refunds','stripe_connect_account_id'),
    ('payment_refunds','source'), ('payment_refunds','failure_code'), ('payment_refunds','failure_message'), ('payment_refunds','fee_returned'), ('payment_refunds','refund_fee'), ('payment_refunds','created_at'),
    ('payment_refunds','updated_at'), ('payment_refunds','succeeded_at'), ('payment_refunds','user_id'), ('payment_refunds','idempotency_key'), ('payment_refunds','initiated_by'), ('payment_refunds','metadata'),
    ('payment_invoices','id'), ('payment_invoices','contact_id'), ('payment_invoices','booking_id'), ('payment_invoices','service_id'), ('payment_invoices','invoice_number'), ('payment_invoices','amount'),
    ('payment_invoices','currency'), ('payment_invoices','status'), ('payment_invoices','line_items'), ('payment_invoices','due_date'), ('payment_invoices','payment_terms'), ('payment_invoices','notes'),
    ('payment_invoices','internal_notes'), ('payment_invoices','sent_at'), ('payment_invoices','paid_at'), ('payment_invoices','payment_method'), ('payment_invoices','payment_received_at'), ('payment_invoices','payment_notes'),
    ('payment_invoices','processor_type'), ('payment_invoices','processor_checkout_id'), ('payment_invoices','processor_payment_id'), ('payment_invoices','processor_customer_id'), ('payment_invoices','processor_payment_method_id'), ('payment_invoices','stripe_invoice_id'),
    ('payment_invoices','stripe_hosted_invoice_url'), ('payment_invoices','stripe_invoice_pdf'), ('payment_invoices','client_name'), ('payment_invoices','client_email'), ('payment_invoices','client_address'), ('payment_invoices','refunded_amount'),
    ('payment_invoices','refund_status'), ('payment_invoices','refunded_at'), ('payment_invoices','allow_online_payment'), ('payment_invoices','created_at'), ('payment_invoices','updated_at'), ('payment_invoices','user_id'),
    ('payment_invoices','retry_count'), ('payment_invoices','last_retry_at'), ('payment_invoices','next_retry_at'),
    ('proposals','id'), ('proposals','contact_id'), ('proposals','service_id'), ('proposals','booking_id'), ('proposals','package_booking_id'), ('proposals','document_id'),
    ('proposals','supersedes_id'), ('proposals','created_invoice_id'), ('proposals','created_plan_id'), ('proposals','title'), ('proposals','description'), ('proposals','currency'),
    ('proposals','total'), ('proposals','prices_include_tax'), ('proposals','tax_rate'), ('proposals','tax_label'), ('proposals','payment_shape'), ('proposals','payment_terms_days'),
    ('proposals','sessions'), ('proposals','status'), ('proposals','valid_until'), ('proposals','decline_reason'), ('proposals','decline_note'), ('proposals','stop_reason'),
    ('proposals','stop_note'), ('proposals','accepted_snapshot'), ('proposals','sent_at'), ('proposals','viewed_at'), ('proposals','decided_at'), ('proposals','stopped_at'),
    ('proposals','created_at'), ('proposals','updated_at'), ('proposals','user_id'),
    ('payment_plans','id'), ('payment_plans','service_id'), ('payment_plans','name'), ('payment_plans','description'), ('payment_plans','total_amount'), ('payment_plans','currency'),
    ('payment_plans','supported_currencies'), ('payment_plans','installment_count'), ('payment_plans','installment_amount'), ('payment_plans','installment_frequency'), ('payment_plans','allowed_processors'), ('payment_plans','preferred_processor'),
    ('payment_plans','is_active'), ('payment_plans','created_at'), ('payment_plans','updated_at'), ('payment_plans','user_id'),
    ('payment_plan_subscriptions','id'), ('payment_plan_subscriptions','contact_id'), ('payment_plan_subscriptions','booking_id'), ('payment_plan_subscriptions','service_id'), ('payment_plan_subscriptions','payment_plan_id'), ('payment_plan_subscriptions','stripe_subscription_id'),
    ('payment_plan_subscriptions','stripe_schedule_id'), ('payment_plan_subscriptions','stripe_price_id'), ('payment_plan_subscriptions','stripe_customer_id'), ('payment_plan_subscriptions','stripe_connect_account_id'), ('payment_plan_subscriptions','installment_count'), ('payment_plan_subscriptions','installment_amount'),
    ('payment_plan_subscriptions','currency'), ('payment_plan_subscriptions','frequency'), ('payment_plan_subscriptions','periods_paid'), ('payment_plan_subscriptions','status'), ('payment_plan_subscriptions','next_charge_at'), ('payment_plan_subscriptions','next_charge_amount'),
    ('payment_plan_subscriptions','last_failure_code'), ('payment_plan_subscriptions','last_failure_at'), ('payment_plan_subscriptions','card_brand'), ('payment_plan_subscriptions','card_last4'), ('payment_plan_subscriptions','cancel_reason'), ('payment_plan_subscriptions','cancel_note'),
    ('payment_plan_subscriptions','cancelled_by'), ('payment_plan_subscriptions','created_at'), ('payment_plan_subscriptions','updated_at'), ('payment_plan_subscriptions','completed_at'), ('payment_plan_subscriptions','cancelled_at'), ('payment_plan_subscriptions','user_id'),
    ('payment_plan_subscriptions','card_exp_month'), ('payment_plan_subscriptions','card_exp_year'), ('payment_plan_subscriptions','metadata'),
    ('payment_plan_installments','id'), ('payment_plan_installments','payment_plan_id'), ('payment_plan_installments','subscription_id'), ('payment_plan_installments','booking_id'), ('payment_plan_installments','contact_id'), ('payment_plan_installments','proposal_id'),
    ('payment_plan_installments','invoice_id'), ('payment_plan_installments','transaction_id'), ('payment_plan_installments','installment_number'), ('payment_plan_installments','label'), ('payment_plan_installments','trigger'), ('payment_plan_installments','amount'),
    ('payment_plan_installments','currency'), ('payment_plan_installments','due_date'), ('payment_plan_installments','status'), ('payment_plan_installments','paid_at'), ('payment_plan_installments','payment_method'), ('payment_plan_installments','processor_type'),
    ('payment_plan_installments','stripe_invoice_id'), ('payment_plan_installments','completed_at'), ('payment_plan_installments','cancel_reason'), ('payment_plan_installments','cancel_note'), ('payment_plan_installments','cancelled_by'), ('payment_plan_installments','cancelled_at'),
    ('payment_plan_installments','created_at'), ('payment_plan_installments','updated_at'), ('payment_plan_installments','user_id'), ('payment_plan_installments','retry_count'), ('payment_plan_installments','last_retry_at'), ('payment_plan_installments','next_retry_at'),
    ('saved_payment_methods','id'), ('saved_payment_methods','contact_id'), ('saved_payment_methods','processor_type'), ('saved_payment_methods','processor_customer_id'), ('saved_payment_methods','processor_method_id'), ('saved_payment_methods','method_type'),
    ('saved_payment_methods','brand'), ('saved_payment_methods','last_four'), ('saved_payment_methods','is_default'), ('saved_payment_methods','is_valid'), ('saved_payment_methods','created_at'), ('saved_payment_methods','updated_at'),
    ('saved_payment_methods','user_id'), ('saved_payment_methods','expiry_month'), ('saved_payment_methods','expiry_year'),
    ('stripe_connect_accounts','id'), ('stripe_connect_accounts','stripe_account_id'), ('stripe_connect_accounts','stripe_account_type'), ('stripe_connect_accounts','charges_enabled'), ('stripe_connect_accounts','payouts_enabled'), ('stripe_connect_accounts','details_submitted'),
    ('stripe_connect_accounts','onboarding_completed'), ('stripe_connect_accounts','country'), ('stripe_connect_accounts','currency'), ('stripe_connect_accounts','business_type'), ('stripe_connect_accounts','stripe_email'), ('stripe_connect_accounts','created_at'),
    ('stripe_connect_accounts','updated_at'), ('stripe_connect_accounts','user_id'),
    ('payment_processors','id'), ('payment_processors','processor_type'), ('payment_processors','is_active'), ('payment_processors','is_default'), ('payment_processors','connection_status'), ('payment_processors','last_verified_at'),
    ('payment_processors','created_at'), ('payment_processors','updated_at'), ('payment_processors','user_id'), ('payment_processors','credentials'), ('payment_processors','supports_checkout'), ('payment_processors','supports_saved_methods'),
    ('payment_processors','supports_refunds'), ('payment_processors','supports_partial_refunds')
),
live AS (
  SELECT table_name::text, column_name::text
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('payment_transactions', 'payment_refunds', 'payment_invoices', 'proposals', 'payment_plans', 'payment_plan_subscriptions', 'payment_plan_installments', 'saved_payment_methods', 'stripe_connect_accounts', 'payment_processors')
)
SELECT coalesce(l.table_name, d.table_name) AS table_name,
       coalesce(l.column_name, d.column_name) AS column_name,
       CASE WHEN d.column_name IS NULL THEN 'drift: live, not declared'
            ELSE 'missing: declared, not live' END AS problem
FROM live l
FULL OUTER JOIN declared d USING (table_name, column_name)
WHERE l.column_name IS NULL OR d.column_name IS NULL
ORDER BY 1, 2;
```

### C-6: billing table names for TL to confirm live

`billing_events`, `boost_pack_purchases`, `user_subscriptions`, `credit_transactions`, `subscriptions`, `subscription_invoices`, `business_os_account_plans`, `business_os_boost_purchases`, `business_os_billing_accounts`, `business_os_billing_events`, `business_os_credit_charges`, `business_os_credit_totals`, `business_os_credit_lots`, `business_os_credit_lot_draws`.

```sql
-- C-6: every billing name is a live table (expect 14 rows, all live = true)
SELECT n.name, to_regclass('public.' || n.name) IS NOT NULL AS live
FROM unnest(ARRAY['billing_events','boost_pack_purchases','user_subscriptions','credit_transactions','subscriptions',
  'subscription_invoices','business_os_account_plans','business_os_boost_purchases','business_os_billing_accounts',
  'business_os_billing_events','business_os_credit_charges','business_os_credit_totals','business_os_credit_lots',
  'business_os_credit_lot_draws']) AS n(name)
ORDER BY 1;
```

---

## QA Testing Report

_QA populates._

### QA — DE-5 — 2026-10-16

**Test mode:** full
**Strategy used:** A + B (Jest unit and integration, mocked Supabase), plus mutation testing in a scratch copy. Option D does not apply: there is no UI change. The download is checked by hand after deploy (see below).
**Focus:** schema, security, api
**Skipped:** live DB run (no DB in the worktree; TL's §11.1–§11.3 live results are the source); browser check (no UI change)
**Input source:** prompt keywords (TL), against the M-1…M-15 tests, C-1…C-9, §13.1 and §11.1–§11.3
**State tested:** the worktree as Dev left it (numstat identical before and after QA). **SA F-1 had not been applied yet** (`'subscriptions'` is still in `BILLING_TABLES`, `MONEY_TO_US_TABLES` and the route.test.ts billing seed). F-1 only edits test lists, so these results stand. After F-1, re-run the three touched suites; that is owed.

#### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| M-1 classification: 10 include, 5 exclude, 23 / 17 / 115 | ✅ | Pass | Re-planning, reworded excludes and moved links all red (mutations) |
| M-2 lists = §11.1 live set; 0 drift / 0 missing | ✅ | Pass | Planted `deposit_amount` → drift red; TL T-10 live 0/0 (§11.3) |
| M-3 / M-12 secrets and card data (BC-1, BC-12) | ✅ | Pass | `credentials`, `idempotency_key`, `card_exp_month`, `expiry_year` each red when planted in `columns` |
| BC-3 Stripe invoice links IN | ✅ | Pass | Removing both links, or only `stripe_invoice_pdf`, is red (M-1 pin + BC-3 test + characterization) |
| M-4 every amount with its own currency | ✅ | Pass | Dropping `fee_currency` red (11); unpaired `deposit_amount` red (M-4 completeness) |
| M-5 / C-5 no FX, no sums, values as stored | ✅ | Pass | `money_total` in summary red (31); `exchangeRate` red (source scan); `.toUpperCase()` on currency red; fee paired by computation (`fee_currency = currency`) red (31) |
| M-6 / C-6 money paid to us never read | ✅ | Pass | `credit_transactions`, `business_os_boost_purchases` and `user_subscriptions` each planted as an include: 60–62 red |
| M-7 / C-8 cross-tenant | ✅ | Pass | Dropping `.eq('user_id')` in the repository: 49 red, incl. the DE-5 M-7/C-8 case (B's refund names A's payment; B's instalment names A's subscription and invoice) |
| M-8 all history, no rowFilter | ✅ | Pass | A planted `rowFilter` on payments is red (8) |
| M-9 groups and order | ✅ | Pass | 2 account + 8 client_records; 24 sections in the body |
| M-10 / C-7 DE-3 / DE-4 unchanged | ✅ | Pass | Reordering the DE-4 `crm_contacts` select (3 red) or the DE-3 `business_profiles` select (6 red) breaks the characterization pin |
| M-11 / C-3 payment metadata allow-list | ✅ | Pass | Adding `checkout_session_id` (31 red) or `connect_account_id` (31 red), or removing the `paymentRow` mapper (33 red), are all red |
| SA-Q7 `charge_account_kind` out | ✅ | Pass | Putting it back is red (5) |
| BC-4 / BC-5 excludes | ✅ | Pass | `payment_events` (65 red) or `payment_reminders` (64 red) made an include is red |
| M-13 purge baseline | ✅ | Pass | The diff removes only the 15 `planned('DE-5')` lines. With `export:` stripped, the 15 rows are byte-identical before and after. Purge suites green |
| M-14 planted ids ignored / M-15 ceiling | ✅ | Pass | In route.test.ts |
| Entitlements / authz guards | ✅ | Pass | No entitlements import in any touched file |
| No `.github` change; no `console.*` | ✅ | Pass | 0 `.github` files in the diff; 0 `console.` in the touched source files |

#### Edge cases (QA scratch test, `qaDe5Edge.test.ts`, scratch copy only, 2/2 pass)

- An owner with no money rows: all 10 money sections are `ok` with 0 rows, `failed_sections` is `[]`, and the body has 24 sections.
- Mixed currencies are byte-identical (`JSON.stringify` equal): an ILS payment with USD fees; a payment in lower-case `usd` with `fee_currency: 'usd'`, kept as stored; a NULL currency stays NULL; EUR.
- A refund is positive as stored, with both `fee_returned` and `refund_fee` NULL and no currency key added; its `metadata` and `initiated_by` are absent.
- `metadata` that is NULL, an array or a string → `{}`. A full object → only `{ notes, source }`; `checkout_session_id`, `connect_account_id` and `client_secret` are absent.
- Client payment plans and saved methods: brand and last 4 present, no expiry. The provider row has no `credentials` and no `supports_*`. The planted `sk_live_NEVER` marker is absent.
- `summary` keeps exactly its four keys.
- DE-3 / DE-4 output is unchanged (mutations l1 / l2 above).

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance (should fix):** none QA can confirm. C-9: the machine was heavily loaded (another session's dev server, plus two full Jest runs). Two in-band runs of the five export suites gave base 11.0 s / 23.1 s and DE-5 17.7 s / 11.1 s assertion time, which is noise. Without the repository suite (the noisiest), run 2 was 4.11 s → 4.36 s. That does not contradict Dev's +2.0 s, and SA accepted that figure (ruling 1).

**Edge cases / follow-ups (nice to fix):**
1. SA F-1 is not applied yet (see "State tested"). After it, re-run `exportClassification`, `route.test` and `route.characterization`.
2. The route-level fake does not apply `.eq`, so cross-tenant row isolation is proven only at the repository level (M-7, red under mutation). The route level checks the filter call. That is the same as DE-4 and is not a gap.

#### Test Outputs / Logs

| Run | Result | Time (loaded machine) |
|---|---|---|
| data-export + purge + export repository + route + lib/client | 25 suites, 731 tests ✅ | 80.7 s |
| `userDataExportReads.test.ts` | 1 suite, 11 tests ✅ | 5.8 s |
| `npm run test:bos-entitlements` | 279 suites, 8333 tests ✅ | 258.7 s |
| `npm run test:authz-guard` | 2 suites, 203 tests ✅ | 80.9 s |
| Full `npx jest --ci`, DE-5 worktree | 1483 suites; 37109 tests; 26 suites / 156 tests failed | 35.6 min |
| Full `npx jest --ci`, baseline (`git archive 447d17a2` + `git init`) | 1483 suites; 37004 tests (+105 = Dev's 240 → 345); 29 suites / 161 tests failed | — |
| Mutation control (scratch copy, unmutated) | 22 suites, 711 tests, 0 failed | — |
| Negative controls | **25 of 25 red** (counts above) | ~85 s each |

Full-suite diff by failing suite: only one fails on DE-5 and not on the baseline. It is `app/admin/business-os-llm/__tests__/activityLayout.render.test.tsx`, a 5000 ms load timeout; alone it passes 38/38, and it shares no code with DE-5. Four suites fail only on the baseline (`tailwind-css-escape.guard`, `auditTrail.layout/table.render`, `creditsBlock.render`), all load or path flakes. The other 25 failures are the same on both sides and are pre-existing or environmental (v6/v4 pipeline, pilot transforms, plugin integration tests, enum-drift, the known guard flakes). **No new failure is caused by DE-5.**

Hygiene: never `git stash`ed, nothing committed. Mutations and the QA test lived only in `scratchpad/de5qa/neg`. Worktree numstat was identical before and after. The scratch node_modules junctions were removed with `rmdir` only, and the shared node_modules is intact.

#### Manual check for the user after deploy (Business OS → Download my data)

1. The account group gains **payment_account** (your Stripe account: id, type, charges/payouts enabled, country, currency, as stored, may be lower case, business type, Stripe email) and **payment_providers** (provider and status only; no keys or passwords).
2. Client records gains **quotes**, **invoices** (with the Stripe web and PDF links, and your private notes), **payments** (fee and net each with its own fee currency; the notes you typed on cash or bank payments, and how each payment was recorded), **refunds** (positive amounts, their own dates), **payment_plans**, **client_payment_plans**, **installments** and **client_payment_methods** (card brand and last 4, no expiry).
3. Each amount shows next to its own currency, and nothing is converted.
4. No totals anywhere.
5. Nothing about your own plan, credits, boosts or subscription with AgentPilot.
6. No payment reminders or payment event log.
7. Failed, cancelled and refunded rows are present, each with its status.

#### Final Status
- [x] All acceptance criteria pass — ready for commit once SA F-1 is applied and its three suites re-run green
- [ ] Issues found — Dev must address before commit

---

## Commit Info

_RM populates._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Created (Dev, workplan only) | 15 tables: 10 include, 5 exclude; currency pairing and no-totals rule; SQL Q1–Q12 for TL; SA-Q1…Q15; BC-1…BC-12 |
| 2026-10-16 | Code complete (Dev) | T-2…T-9, T-11, T-12 done under §13.1 (BC-3 links IN), C-1…C-9 and SA-Q1…Q15. Requirement §0.9 inserted. T-10 SQL (249 names) and the C-6 billing name check handed to TL. Mutation check: 6 of 6 red. D-6: about +2 s test time, back to SA |
| 2026-10-16 | SA code review | Code Approved for QA with one required fix (F-1: drop `subscriptions` from the three new billing lists; not a live table, §11.3). C-9 +2.0 s accepted (off the critical path). D-1…D-9 accepted |

### 11.1 T-0 live results — 2026-10-16 (TL, read-only, Supabase MCP, prod `jgccgkyhpwirgknnceoh`)

**Q1/Q2 columns** (`!` NOT NULL). Counts match the migration expectations exactly: payment_transactions 31, payment_refunds 24, payment_invoices 39, proposals 33, payment_plans 16, payment_plan_subscriptions 33, payment_plan_installments 30, saved_payment_methods 15, stripe_connect_accounts 14, payment_processors 14; plus payment_events 9, payment_automation_rules 17, payment_automation_executions 17, payment_reminders 18, payment_methods 12. Full lists:
- payment_transactions: id!, user_id!, contact_id, stripe_payment_intent_id, stripe_charge_id, stripe_customer_id, amount!, currency, status!, payment_method, description, invoice_id, metadata, failure_reason, paid_at, created_at, updated_at, refund_status, refunded_amount, refunded_at, refund_reason, processor_refund_id, processor_type, service_id, booking_id, stripe_connect_account_id, charge_account_kind, account_resolution!, processor_fee, net_amount, fee_currency
- payment_refunds: id!, user_id!, transaction_id!, invoice_id, amount!, amount_minor:int8!, currency!, status!, reason, processor_type!, processor_refund_id, stripe_connect_account_id, idempotency_key!, source!, initiated_by, failure_code, failure_message, metadata!, created_at!, updated_at!, succeeded_at, fee_returned, refund_fee, reason_note
- payment_invoices: id!, user_id!, contact_id, invoice_number!, amount!, currency, status!, line_items, due_date, payment_terms, notes, internal_notes, sent_at, paid_at, created_at, updated_at, payment_method, payment_received_at, payment_notes, processor_type, processor_checkout_id, processor_payment_id, processor_customer_id, processor_payment_method_id, retry_count, last_retry_at, next_retry_at, stripe_invoice_id, stripe_hosted_invoice_url, stripe_invoice_pdf, client_name, client_email, client_address, booking_id, service_id, refunded_amount!, refund_status!, refunded_at, allow_online_payment
- proposals: id!, user_id!, contact_id!, service_id, title!, description, currency!, total!, prices_include_tax!, tax_rate, tax_label, status!, valid_until, payment_shape!, decline_reason, decline_note, supersedes_id, accepted_snapshot, created_invoice_id, created_plan_id, sent_at, viewed_at, decided_at, created_at!, updated_at!, booking_id, document_id, payment_terms_days, stop_reason, stop_note, stopped_at, sessions, package_booking_id
- payment_plans: id!, user_id!, service_id, name!, description, total_amount!, currency!, supported_currencies:_text, installment_count!, installment_amount!, installment_frequency!, allowed_processors:_text, preferred_processor, is_active, created_at, updated_at
- payment_plan_subscriptions: id!, user_id!, contact_id, booking_id, service_id, payment_plan_id, stripe_subscription_id, stripe_schedule_id, stripe_price_id, stripe_customer_id, stripe_connect_account_id, installment_count!, installment_amount!, currency!, frequency!, periods_paid!, status!, next_charge_at, next_charge_amount, last_failure_code, last_failure_at, card_brand, card_last4, card_exp_month, card_exp_year, metadata!, created_at!, updated_at!, completed_at, cancelled_at, cancel_reason, cancel_note, cancelled_by
- payment_plan_installments: id!, user_id!, payment_plan_id!, booking_id, contact_id, installment_number!, amount!, currency!, due_date, status!, paid_at, payment_method, processor_type, transaction_id, retry_count, last_retry_at, next_retry_at, created_at, updated_at, subscription_id, invoice_id, stripe_invoice_id, label, trigger!, completed_at, proposal_id, cancel_reason, cancel_note, cancelled_by, cancelled_at
- saved_payment_methods: id!, user_id!, contact_id, processor_type!, processor_customer_id!, processor_method_id!, method_type!, last_four, brand, expiry_month, expiry_year, is_default, is_valid, created_at, updated_at
- stripe_connect_accounts: id!, user_id!, stripe_account_id!, stripe_account_type, charges_enabled, payouts_enabled, details_submitted, onboarding_completed, country, currency, business_type, created_at, updated_at, stripe_email:varchar
- payment_processors: id!, user_id!, processor_type!, is_active, is_default, credentials:jsonb, supports_checkout, supports_saved_methods, supports_refunds, supports_partial_refunds, connection_status, last_verified_at, created_at, updated_at

**Q3 keys:** uuid `id` PK on all 10 included tables. Uniques: payment_invoices (user_id, invoice_number); payment_processors (user_id, processor_type); payment_transactions stripe_payment_intent_id; stripe_connect_accounts stripe_account_id and **user_id** (one per owner).

**Q4 jsonb keys:** payment_transactions.metadata = booking_id, checkout_session_id, connect_account_id, installment_count, installment_number, invoice_number, notes, service_id, source, stripe_invoice_id, subscription_id. payment_refunds.metadata, payment_plan_subscriptions.metadata, payment_invoices.client_address, proposals.sessions = no keys present. line_items[] = amount, description, quantity, total, unit_price. payment_shape = count, frequency, kind, stages. accepted_snapshot = accepted_at, currency, description, payment_shape, payment_terms_days, prices_include_tax, tax_label, tax_rate, title, total.

**Q5 statuses:** tx status refunded 44 / succeeded 82; refund_status none 80 / partial 2 / full 44; charge_account_kind platform 37 / connect 89; processor_type stripe 89 / manual 37. Refunds succeeded 48, source app 48. Invoices cancelled 30 / overdue 16 / paid 62 / refunded 41 / sent 6. Proposals accepted 12 / declined 1 / superseded 10 / sent 4 / stopped 13 / withdrawn 1. Subscriptions active 3 / completed 4 / cancelled 2. Installments paid 38 / overdue 6 / pending 16 / cancelled 23. saved_payment_methods and payment_processors: **0 rows**.

**Q6/Q6a currency:** tx ILS 62 / USD 64; **fee_currency NULL 58 / USD 68**; refunds ILS 30 / USD 18; invoices USD 73 / ILS 82; proposals ILS 41; plans USD 5 / ILS 15; subscriptions USD 4 / ILS 5; installments USD 22 / ILS 61; **stripe_connect_accounts `usd` lower-case 4**. NULL currency: tx 0, invoices 0. fee without currency 0. **fee in a different currency than the payment: 39**. refund/payment currency mismatch 0. **owners with several currencies: 2**.

**Q7 size:** largest owner 231 rows / ~100 kB; then 144 / 65 kB; 99 / 54 kB.

**Q8 cross-tenant:** 0 on all 18 links. **Q10:** no soft-delete column on any of the 15 tables.

**Q9/Q11:** payment_methods rows **0** (dead → exclude OK); processors with credentials 0; automation_rules 15; tx with platform-purchase metadata keys 0; tx without a client 3; refunds started by another id 0; card_last4 malformed 0; subscriptions with expiry 0; long digit runs in invoice free text 0.

**For SA:** `charge_account_kind = 'platform'` on 37 rows equals `processor_type = 'manual'` 37 — confirm these are the owner's manual/offline client payments, NOT money paid to AgentPilot (no purchase keys found). `payment_transactions.metadata` carries `checkout_session_id` and `connect_account_id` — rule on the allow-list (SA-Q3). Connect currency stored lower-case — export as stored.

### 11.2 SA C-1 counts — 2026-10-16 (TL, read-only, prod)
- payments by `charge_account_kind` × `processor_type`: **platform/manual 37, connect/stripe 89** — `platform` only ever with `manual` (C-1 ✅).
- refunds with `fee_returned` or `refund_fee` NOT NULL: **0**.
- payments with metadata key `notes`: **29**; with key `source`: **58**; distinct `source` values: booking_marked_paid, manual_mark_paid, payment_intent_webhook, payment_plan, website_booking.

### 13.1 USER DECISIONS — 2026-10-16 (binding; via TL)
| BC | Decision |
|---|---|
| BC-1 card | **Brand + last 4 only.** Expiry (month/year) OUT. |
| BC-2 history | **Everything IN:** failed, cancelled, refunded, draft. |
| BC-3 Stripe invoice web + PDF links | **IN — overrides Dev default and SA-Q5.** The user chose to include `stripe_hosted_invoice_url` and `stripe_invoice_pdf` (accepting that anyone holding the file can open the invoice page). |
| BC-4 payment reminders | **OUT** (activity). |
| BC-5 payment event log + automatic-action history | **OUT** (activity) → SA-Q14 condition met: `payment_events`, `payment_automation_executions` OUT. |
| BC-6 built-in payment rules | **OUT.** |
| BC-7 private invoice notes | **IN**; invoice/quote sent/viewed dates IN. Owner's typed notes on manual payments (metadata `notes`) IN on the same logic. |
| BC-8/9/10 fees, net amount (each with own currency), Stripe reference numbers | **IN.** |
| BC-11 totals | **None.** No totals of any kind. |
| BC-12 provider name + status IN; keys/credentials never | default kept. |

### 11.3 T-10 drift + C-6 billing names — 2026-10-16 (TL, read-only, prod)
- **Drift:** Dev's 249 declared names (include ∪ excluded) for the 10 included tables vs `information_schema.columns`, FULL OUTER JOIN: **0 drift, 0 missing** (249 distinct). T-10 ✅.
- **C-6 billing names:** 13 of 14 are live. **`subscriptions` does NOT exist** in prod (`to_regclass` NULL). SA to rule: drop it from the C-6 named list (the list must name live tables only, per C-6) and check whether its existing `exclude(BILLING)` descriptor is a phantom the purge reconciler should already report.

### SA code review DE-5 — 2026-10-16

**Code Review by SA — 2026-10-16**
**Status:** ✅ Code Approved for QA, with one required fix (F-1) that Dev makes before QA starts. F-1 is a test-list edit and does not need another SA pass. SA re-ran the data-export, route, export-repository and purge suites on the branch: 21 suites, 709 tests, green.

**Scope reviewed.** `descriptors.ts` (DE-5 block and the 15 rows), `classificationTypes.ts`, `classification.ts`, `sections.ts`, `BusinessDataExportRepository.ts` (comment only), the six test files, and requirement §0.9 (insert-only, 80/0). Read against §11.1, §11.2, §11.3, §13.1 and conditions C-1 … C-9.

#### Rulings on the items for SA

| # | Item | Ruling |
|---|---|---|
| 1 | **C-9 runtime, about +2.0 s** | **Accepted, no trim.** The no-added-CI-time rule is about the critical path, and the critical path is `Build (next build)`. None of these suites is on it. `route.*` and the export repository suite run inside `test:bos-entitlements`, a parallel job whose own budget is "+45 s, and finish at least 30 s before Build". About 1.4 s is a small part of that. Everything else runs in the sharded Jest gate, which also finishes before Build. DE-5 adds no new job, script or suite file. The increase comes from real coverage: 23 paged tables per request and 37 `it.each` cases. Dev already kept the repository suite flat (3041 → 3044 ms). If the entitlements job's margin to Build ever drops below 30 s, the trim is its documented one (moving `app/admin/users/__tests__`), not a cut to these pins. |
| 2 | **D-1 stricter C-4** (catalog money ∪ name rule) | **Accepted.** It is stricter than SA's wording, and needed: the catalog types only `amount` / `total` as money, so the narrower rule would have let `processor_fee`, `net_amount` and `refunded_amount` through unpaired. Including the JSON carriers (`line_items`, `payment_shape`, `sessions`, `accepted_snapshot`) is correct. The no-currency set is exactly `payment_refunds.fee_returned` and `payment_refunds.refund_fee`, and its negative control is red. |
| 3 | **D-2 extended billing list; `subscriptions` phantom** | **Extension accepted, but F-1 must be done now.** C-6 requires every list entry to be a live table, and §11.3 shows `subscriptions` is not one (`to_regclass` NULL). Remove it from the three new lists: `exportClassification.test.ts` `BILLING_TABLES`, `route.characterization.test.ts` `MONEY_TO_US_TABLES`, and the `route.test.ts` billing seed. The `exportClassification.test.ts` doc comment also says that having a descriptor implies the table is live. `subscriptions` shows that is false, so reword it: "names checked live by TL 2026-10-16 (§11.3); a descriptor alone does not prove a table is live". Leave the pre-existing `removed` loops (`agents`, `subscriptions`, `transactions`, …) at route.test.ts:362, route.characterization.test.ts:797 and sections.test.ts:433 alone: they assert that legacy names are absent, which is a different purpose. **The descriptor itself** (`never('subscriptions', U, exclude(BILLING))`) is not a hidden phantom. `SchemaReconciler` already reports a `never` descriptor that is not live under `missingNever`, listed but not blocking by design, because it cannot lose data. **Follow-up, not DE-5:** the purge workstream removes or re-points that descriptor after checking whether the name is legacy or planned. Log it in the requirement §0.9 follow-ups. |
| 4 | **D-5 SchemaReconciler re-pin** | **Accepted.** It is a pin of the included-table list, not behaviour. It gains exactly the 10 DE-5 tables, sorted and commented, and the drift expectation is computed from that list. |
| 5 | **D-3 / D-4 metadata** | **Accepted.** `columns` entries have no reason field, so recording the allow-list in the `PAYMENT_TRANSACTIONS_EXPORT` doc comment and on `PAYMENT_METADATA_KEYS` meets SA-Q3. When the cell is NULL or not an object, it always comes out as an object (`{}`), the same as `clients.source_metadata`. That keeps the column's type stable for anyone parsing the file. |
| 6 | **BC-3: no deny exception** | **Confirmed.** `stripe_hosted_invoice_url` and `stripe_invoice_pdf` match no exact entry and none of `/_token$/`, `/_secret$/`, `/_key$/`, `/_credentials$/`, `/_hash$/`, `/cost_usd$/`. `DENY_EXCEPTIONS` still has its single DE-4 entry. The test pins `matchesSecretDeny === false` for both, and that no exception names them. Nothing is silently excepted. |
| 7 | **Final literal lists** | **Approved as pinned.** payments 28 in / 3 out (`user_id`, `account_resolution`, `charge_account_kind`); refunds 20 / 4 (`user_id`, `idempotency_key`, `initiated_by`, `metadata`); invoices 35 / 4 (BC-3 links in, retry state out); quotes 32 / 1; payment_plans 15 / 1; client_payment_plans 29 / 4 (card expiry and `metadata` out, brand and last 4 in, BC-1); installments 26 / 4; client_payment_methods 12 / 3 (expiry out); payment_account 13 / 1; payment_providers 8 / 6 (`credentials` never selected, BC-12). Each table sums to its §11.1 count; T-10 shows 0 drift and 0 missing over 249 names (§11.3). The five excludes carry reasons that cite BC-4, BC-5 and BC-6 and the dead table. `level`, `order`, `scope`, `snapshot` and `notes` are unchanged. |

#### Cross-checks

| Check | Result |
|---|---|
| Tenant isolation | ✅ The repository diff is a comment only: no find-by-id, no new method. Every money section reads through `listOwnedRowsForExport`, keyed by section id, with `.eq('user_id', session id)` as its only filter. The children (refunds, instalments) are read by their own `user_id`. The C-8 crossed-pointer cases (B's refund naming A's payment; B's instalment naming A's subscription and invoice) leak no row, only a bare id. The negative control (a fake that ignores `user_id`) is red. |
| No FX, no sums | ✅ There is no total, `reduce` or conversion in the export source. The C-5 scan, with its negative controls, covers `data-export/*.ts`, the repository and `route.ts`. `summary` keeps exactly its four keys. Connect `usd` is exported as stored. |
| Fee / currency pairing | ✅ `processor_fee` and `net_amount` are paired with `fee_currency`, which is in the payments list. Every other amount is paired with its own table's `currency`. `fee_returned` and `refund_fee` are exported with no currency key (SA-Q6), and the refund row keeps only its own `currency`. |
| Money paid to us never read | ✅ No billing, credit or boost table has an include descriptor or a section. Both route suites seed those tables raw and assert they are never touched, and the touched set is exactly the 23 section tables. (F-1 fixes only the one non-live name in these lists.) |
| DE-3 / DE-4 unchanged | ✅ In the characterization test, the lines removed are only the composite `TABLES`, `PAGED_ROWS`, body and audit expectations, each rebuilt with the DE-5 parts spread in. The 13 earlier select strings are untouched, byte for byte. The `sourceMetadata` → `pickStringKeys` refactor gives identical output: the DE-4 tests are unchanged, and a new test compares it with the verbatim DE-4 implementation. The only edit to existing negative controls is the `proposals` → `lead_responses` re-plant (T-9). The deny additions (`card_number`, `cvc`, `cvv`) hit no existing include. |
| Secrets / credentials | ✅ None in code. The only `sk_live_…` string is a planted test marker (`sk_live_QA_NEVER`) asserted absent from the output. `credentials` is not in the `payment_processors` select. |
| Logging | ✅ No `console.*` in the diff. The audit holds counts only (no amount, no currency code). |

#### Optimisation suggestions (not blocking)
- `route.characterization.test.ts` seeds the never-read tables with `REMOVED_TABLES.slice(8)`, which depends on position. A named spread (`[...DE5_EXCLUDED_TABLES, ...MONEY_TO_US_TABLES]`) would not break silently if the earlier list grows. Do it with F-1 if convenient.
- That characterization list omits `user_subscriptions` and `credit_transactions`, which route.test.ts and the classification list include. For consistency, add them while making F-1. It is optional, because the touched-set equality already covers them.

### Code Approved for QA: Yes (once F-1 is done; F-1 needs no SA re-review)

### F-1 applied — 2026-10-16 (Dev)

- `subscriptions` (not a live table, §11.3) removed from `BILLING_TABLES` (`exportClassification.test.ts`), `MONEY_TO_US_TABLES` (`route.characterization.test.ts`) and the `MONEY_TO_US` seed (`route.test.ts`). The `BILLING_TABLES` doc comment now says a descriptor alone does not prove a table is live.
- Optional cleanups done: the characterization seed loop uses a named spread `[...EXCLUDED_MONEY_TABLES, ...MONEY_TO_US_TABLES]` instead of `REMOVED_TABLES.slice(8)`; `user_subscriptions` and `credit_transactions` moved from the legacy row of `REMOVED_TABLES` into `MONEY_TO_US_TABLES` (so they are now also seeded raw). The pre-existing legacy `removed` loops (route.test.ts, characterization, sections.test.ts) are untouched.
- The `never('subscriptions', …)` purge descriptor is left as is; logged as a purge follow-up in requirement §0.9.
