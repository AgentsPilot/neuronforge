# Workplan: MK5B-FU-1, the first-payment read at scale

> **Last Updated**: 2026-10-28

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §0.4, row MK5B-FU-1 (Money MK-5b, SA-CR-MK5B). Sources: [ADMIN_MONEY_MK5B_CONVERTED_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK5B_CONVERTED_WORKPLAN.md) (SA-CR-MK5B follow-up and the QA performance note), [ADMIN_MONEY_MK5B_RETROSPECTIVE.md](/docs/retrospectives/ADMIN_MONEY_MK5B_RETROSPECTIVE.md), [ADMIN_MONEY_MK9_PAYING_TRIAL_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK9_PAYING_TRIAL_WORKPLAN.md) (SA-Q-MK9-1, option 1)
**Branch:** `fix/finance-paying-first-payment-scale`, worktree `neuronforge-mk5bfu`, cut from origin/main `4e75ed9f` and fast-forwarded to origin/main `8967888c` (PR #536 merged). 2026-10-28: committed locally (`713e83fb`) and synced with origin/main `abe9fd64` (merge `23b6eac0`); not pushed. `node_modules` is a junction to the main checkout: never `npm install` here, never `git stash`, never `git worktree remove`.
**Date:** 2026-10-27 (item 8, approved by the user 2026-10-27; its own PR)
**Status:** Code Complete 2026-10-27 (SA-WP-M5F approved with conditions M5F-C1 to C7, all applied). Committed locally and synced with main 2026-10-28; migration renumbered to `20261099`. **Nothing applied to production**: the apply waits for the user's go-ahead after SA code review and QA.
**Path:** full cycle. **One additive production migration** (a read-only view and two partial indexes), which needs the user's go-ahead before it is applied.
**Skills applied:** `business-os-schema-check` (live `select ... limit 0` facts, §2.3), `supabase-postgres-best-practices` (§6; see the note in §6.1), `tenant-isolation-guard` (§5.4), `new-repository` (§5.2), `business-os-entitlements` (one touched file imports the module, §8.3).

## Overview

On every Finance Overview load (all businesses), the builder asks for the **first plan payment** of every non-platform plan-row account. That read pulls every past `invoice_paid` row above $0 in the current Stripe mode and keeps the earliest per account. Its rows grow with accounts multiplied by months of renewals. At its 20,000-row ceiling it fails, so "Converted this month" (F-K5b), the Converted list and MK-9's trial-to-paid "Paid" all show **Unknown**. QA put that at about 1,700 paying accounts after a year.

This slice keeps every figure **exactly** as it is and makes the read bounded:
- A read-only view, `business_os_first_plan_payments`, gives one row per account and mode: the account's earliest qualifying payment.
- "Converted this month" reads only the accounts whose first payment falls in this UTC month.
- MK-9 reads by id, and only for the trial accounts whose trial ended in the window.

Pure code alone cannot get there (§4), so the recommendation is option (a).

---

## Table of Contents

1. [Source quotes](#1-source-quotes)
2. [Step 0 facts](#2-step-0-facts)
3. [The current read's cost model](#3-the-current-reads-cost-model)
4. [Options compared and recommendation](#4-options-compared-and-recommendation)
5. [Design](#5-design)
6. [The migration and its checker](#6-the-migration-and-its-checker)
7. [Files to create or modify](#7-files-to-create-or-modify)
8. [Pins and guards](#8-pins-and-guards)
9. [Tests](#9-tests)
10. [Acceptance criteria](#10-acceptance-criteria)
11. [Task list](#11-task-list)
12. [Estimate](#12-estimate)
13. [Risks](#13-risks)
14. [Concurrent work and overlaps](#14-concurrent-work-and-overlaps)
15. [SA questions](#15-sa-questions)
16. [Business questions](#16-business-questions)

---

## 1. Source quotes

**FIN §0.4, row MK5B-FU-1** (`BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md:320`):

> **Rework the Converted this month first-payment read before the account count passes 1,000** (Money MK-5b, SA-CR-MK5B) | It asks about every plan-row account: one request for each 100 ids (more with paging), so its cost grows with the account count. Fine at today's scale. QA estimate (2026-10-20): because it reads every past payment, the figure turns permanently "Unknown" at about 1,700 paying accounts after a year, so the rework must land well before that. Options include reading only the paying accounts plus this month's payers, a this-month `paid_at` filter with an earlier-payment check, or a server-side first-payment-per-account view. Needs its own SA-reviewed slice, and AC-145's expected calls move | 2026-10-20

**QA estimate** (MK-5b workplan, QA Testing Report, "Issues Found"):

> **Performance (should fix, at MK5B-FU-1's trigger).** This adds to SA's MK5B-FU-1. The read pulls **every historical** `invoice_paid` row of every plan account (accounts × months of renewals), only to keep the earliest per account. So besides the request count SA notes, the **20,000-row ceiling** is reached at, for example, about 1,700 paying accounts after a year of monthly invoices. Past that point the figure is **Unknown** every time (correctly never 0, but permanently). SA's proposed shape fixes both: read this month's events first, then check "first ever" for those accounts only. Add "the finance line's `counts.converted.status` is `unknown` with a ceiling error" as a second trigger.

**SA's follow-up** (MK-5b workplan, SA-CR-MK5B):

> **MK5B-FU-1 (scale).** The first-payment read asks every plan-row account, so its requests grow with the account count: 100 ids per request, sequential (about 1 request today; about 50 at 5,000 accounts, each a PostgREST round trip). **Trigger:** plan rows above 1,000, or `durationMs` on the finance line rising. **The better shape at that point:** first read **this month's** `invoice_paid > 0` events in the current mode (a small set), then check "first ever" only for those accounts with the same method.

**Retrospective** (`ADMIN_MONEY_MK5B_RETROSPECTIVE.md`):

> **The read does not scale.** It pulls every past payment for every account, so the request volume grows with the number of accounts. QA estimates the figure turns permanently "Unknown" at about 1,700 paying accounts after a year.

**MK-9's reuse** (SA-Q-MK9-1, ruled option 1, MK-9 workplan):

> MK-5b's read is reused; no lineage read and no "cannot be checked".

MK-9's risk table records: "The reused read grows with the account count | Already MK5B-FU-1 (rework past 1,000 accounts); MK-9 adds no read to it."

---

## 2. Step 0 facts

### 2.1 Code facts (origin/main `8967888c`)

| # | Fact | Where |
|---|---|---|
| S0-1 | **The read.** `BusinessOsBillingAdminReadRepository.listFirstPlanPaymentsForAccounts(accountIds, livemode, opts?)` reads `business_os_billing_events` with `kind = 'invoice_paid'`, `amount_minor > 0`, `paid_at` not null, `livemode = <mode>` and `user_id IN (<chunk>)`. Ids are UUID-checked, lower-cased, de-duplicated and sorted, then chunked at **100** (`IN_CHUNK`). Each chunk is keyset-paged on `id` at **1,000** (`PAGE_SIZE`). All chunks together reaching **20,000** (`CEILING`) is an `AdminBillingReadCeilingError`. A row for an id not asked for is an `AdminBillingReadIsolationError`. It keeps the earliest `paid_at` per account and returns `{ user_id, paid_at }[]` sorted by `user_id` | `lib/repositories/BusinessOsBillingAdminReadRepository.ts:251-330` |
| S0-2 | **The mode.** `listCurrentModeFirstPlanPayments(accountIds, deps?)` resolves `currentStripeMode()`, calls the read and maps the rows to `{ accountId, paidAt }`. An unknown mode returns an error and reads nothing | `lib/admin/billing/firstPlanPayments.ts:45-60` |
| S0-3 | **The wiring.** `converted.firstPlanPayments: (accountIds) => listCurrentModeFirstPlanPayments(accountIds)` | `lib/business-os/finance/financeHealthDeps.ts:191-194` |
| S0-4 | **The builder asks every non-platform plan row.** `askIds = accountId !== null ? [accountId] : planRows.map(row => row.user_id)`. The read runs only when the plan walk and the paying read both succeeded (`canRead`). Its result feeds `convertedThisMonth` and, for all businesses, `firstPaymentsAll` | `lib/business-os/finance/financeHealth.ts:867-967` (the comment at `:876` names MK5B-FU-1) |
| S0-5 | **MK-9 reuses the result.** `trialsToPaid({ trials, capped, firstPayments: firstPaymentsAll, window, now, minimumTrials })`. It looks up a first payment only for trials that **ended** in `[window.start, window.end)` **and** by `now`. "Paid" means a first payment exists; "paid before end" means `first < trialEnd`. A null `firstPayments` makes Paid and Paid-before-end Unknown | `financeHealth.ts:1502-1523`; `lib/business-os/finance/payingBreakdown.ts` (`trialsToPaid`) |
| S0-6 | **Paying % does not use first payments.** F-K5's `paying` is `planRows.filter(row => payingIds.has(row.user_id)).length` over `planRows.length`. `payingIds` comes from the current-mode billing-status read (`listCurrentModeBillingStatusesAllAccounts`). So the **%** never turns Unknown because of this read. Only these turn Unknown: the "Converted this month" line under it, the Converted list on Plans & subscriptions, and MK-9's Paid, Paid-before-end and rate. (The brief's "F-K5 and F-K5b" is corrected here: only F-K5b and MK-9 are affected.) | `financeHealth.ts:847-860`; `financeHealthDeps.ts:143` |
| S0-7 | **The pure rule.** `convertedThisMonth({ firstPayments, accountIds, payingIds, month })` keeps an account when it is in `accountIds` and its first payment is in `[month.from, month.to)`. "This month" is `currentUtcMonth(now)` | `lib/business-os/finance/convertedThisMonth.ts` |
| S0-8 | **The table is append-only.** `business_os_billing_events` has no UPDATE or DELETE grant (service role: SELECT and INSERT). It is never purged. `user_id` is a foreign key to `auth.users` with `ON DELETE SET NULL`. Indexes: the primary key `(id)`; unique `(stripe_event_id)`; unique `(stripe_invoice_id) WHERE kind = 'invoice_paid'`; `(user_id, created_at DESC)`; `(stripe_subscription_id) WHERE kind = 'invoice_paid' AND plan_written`. **No index has `paid_at`** | `supabase/migrations/20261027_business_os_billing_events.sql` |
| S0-9 | **No embed path.** The events table's only foreign key goes to `auth.users`, which PostgREST does not expose. A per-parent `order` plus `limit(1)` embed from a public table is therefore not available | same migration |
| S0-10 | **The stamp guard.** `firstPaymentStamp.guard.test.ts` (P5-C4) fails on any new product file naming `first_paid_at`, `first_payment_ref`, `firstPaidAt` or `firstPaymentRef`. The view's column is therefore **`first_payment_at`**, and TypeScript uses `firstPaymentAt`, as MK-5b's D-7 did | `lib/business-os/billing/__tests__/firstPaymentStamp.guard.test.ts` |
| S0-11 | **The lineage stamp is not the same fact.** `business_os_account_lineage.first_paid_at` is stamped once, in **either** mode, and never for an account with no lineage row. MK-9 rejected it (SA-Q-MK9-1, MK9-R2: "would disagree with the page") | MK-9 workplan CF-8, MK9-R2; migrations `20261014`, `20261028` |
| S0-12 | **The range-cap guard** (FF-1d) baseline is 11 entries and 17 call sites, and it may only shrink | `lib/repositories/__tests__/rangeCap.source.guard.test.ts` |
| S0-13 | **AC-145 today.** `EXPECTED_CALLS['converted.firstPlanPayments'] = [[[ACCOUNT]]]` and `EXPECTED_SHA256 = 38897cd3295ae0c5e865503cf0394453c38f532b0ec87866610126281b1e4edf` | `app/api/admin/business-os/finance/__tests__/route.test.ts:1326`, `:1371` |
| S0-14 | **Precedents for a migration set:** the migration in `supabase/migrations/`, its rollback in `supabase/SQL Scripts/`, a paste-safe checker in `scripts/check-*.sql` (it opens with `SET default_transaction_read_only = on;`), and a SQL-text Jest test in `supabase/migrations/__tests__/`. A view uses `WITH (security_invoker = true)` | `20261059_exposed_views_slice1b.sql` and its test; `20261053_...`; `scripts/check-bos-billing-events-migration.sql` |
| S0-15 | **The next free migration number** on main `8967888c` is `20261097`. No branch in the local refs holds a `20261097` or later file. The number is re-checked at build. **Superseded 2026-10-28:** main later took `20261097` and `20261098`, so ours is `20261099` | `supabase/migrations/` |

### 2.2 Pins today (LF-normalised file hashes at `8967888c`)

| Pin | File | Hash |
|---|---|---|
| Pin A | `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` | `a130d560` |
| Pin B | `app/admin/finance/__tests__/financeTiles.pin.render.test.tsx` | `eac3590a` |
| Pin C and helper | `app/admin/finance/__tests__/chargeChecksRequest.pin.render.test.tsx`, `chargeChecksRequestPins.ts` | `e57f2675`, `64a565e9` |
| Pin D | `lib/admin/health/__tests__/m5WordingOnly.pin.test.ts` | `1f7cf07a` |
| AC-173 and helper | `app/admin/finance/__tests__/financeRequest.pin.render.test.tsx`, `financeRequestPins.ts` | `3a1a2dd4`, `b84e0c96` |
| T-12 | `app/admin/ai-cost/__tests__/aiCostRequests.render.test.tsx` | `c2891a35` |
| AC-145 payload | `EXPECTED_SHA256` in the route test | `38897cd3…4edf` |

### 2.3 Live schema facts (`business-os-schema-check`)

These are read-only `select <cols> limit 0` probes on project `jgccgkyhpwirgknnceoh` (the URL was confirmed to hold that ref), run with the service role from a scratch script on 2026-10-27. No row was returned and nothing was written.

| Probe | Result |
|---|---|
| `business_os_billing_events`: `id, user_id, livemode, kind, amount_minor, paid_at, created_at` | OK |
| `business_os_billing_accounts`: `id, user_id, livemode, subscription_status, ended_at, last_paid_at` | OK |
| `business_os_account_lineage`: `account_id, source, first_paid_at` | OK |
| `business_os_account_plans`: `user_id, cohort, tier, tier_expires_at` | OK |
| **Planted control:** `business_os_billing_accounts.first_paid_at` | `42703`: does not exist (so there is no stored per-mode first payment, §4 option c) |
| **Planted control:** `business_os_first_plan_payments` | `42P01`: does not exist yet (the name is free) |
| PostgREST aggregate `select('user_id, paid_at.min()')` | `PGRST123`: "Use of aggregate functions is not allowed" (aggregates are off on this project, §4) |

Index presence cannot be probed through PostgREST. The index list in S0-8 is from the migration, and the checker (§6.4) verifies the live catalogue after the apply.

---

## 3. The current read's cost model

Symbols:
- **A**: non-platform plan rows (every account with a plan, paying or not).
- **P**: accounts that ever paid in the current mode.
- **M**: average qualifying payments per paying account (about months of history on a monthly plan).

| Item | Today's read |
|---|---|
| Rows read | **P × M**: every qualifying payment of every asked account, all history |
| Requests | `ceil(A / 100)` chunks, plus one more per extra 1,000 rows inside a chunk. All sequential |
| Failure | P × M ≥ 20,000 gives a ceiling error, so Converted, the list and MK-9 Paid are **Unknown on every load** |
| Grows with | accounts **and** time. It gets worse every month even with no new accounts |

| Scale | Rows | Requests | Result |
|---|---|---|---|
| Today (test mode, a handful of accounts) | tens | 1 | OK |
| A = 1,000, P = 600, M = 6 | 3,600 | about 10 to 13 | OK |
| A = 3,000, P = 1,700, M = 12 | 20,400 | about 50 | **Unknown** (QA's estimate) |
| A = 30,000, P = 20,000, M = 12 | 240,000 | stopped at the ceiling after about 20 requests | **Unknown** |

The new model is in §5.6.

---

## 4. Options compared and recommendation

| | (a) Aggregate in the database | (b) Narrow the read in code | (c) A stored first-paid date |
|---|---|---|---|
| **Shape** | A read-only view: one row per (account, mode) holding the earliest qualifying payment. Read by month range, or by id | Read this month's payers, then check "no earlier payment" for each of them | `first_paid_at` on the lineage table (it exists), or a new per-mode column on `business_os_billing_accounts` |
| **Migration** | Yes, additive: one view and two partial indexes. No table change, no writer change | No | Lineage: no. A new column: yes, plus a backfill and a change to the money write function |
| **Exact (same numbers)** | Yes. It is the same predicate over the same rows, and SQL `min` equals the old "keep the earliest" | Yes, but only while it can finish | **Lineage: no.** It is mode-blind and missing for accounts with no lineage row, which MK-9 ruled out (MK9-R2). **New column:** only while every writer keeps it in step |
| **Bounded** | Yes. The month read returns about one row per **new converter this month**. The id read returns at most one row per asked id | **No.** "This month's payers" is about every paying account (each renews monthly), and the earlier-payment check still pulls each one's whole history, because PostgREST has no `DISTINCT` and aggregates are off (`PGRST123`, §2.3). The rows are P × M again, so it hits the ceiling at the same scale | Yes |
| **Risk** | Low. A read-only object; service role only; RLS still on the base table; a rollback is two `DROP`s | None, but it does not solve the problem | Lineage: wrong numbers. New column: it touches `business_os_apply_plan_payment` (the money write path) and needs a drift proof against the reconciler and late invoices. Large |
| **Estimate** | About 2 days | n/a | Lineage: n/a. New column: 3+ days |

**Why (b) cannot be made to work without the database:**
- The old read collapses all history to one row per account. PostgREST can only do that with aggregates (off on this project; turning them on is a global config change that affects every role, including anon), with a per-parent embed (not available: the events' only foreign key is to `auth.users`, S0-9), or with an `rpc` or view (a migration).
- A per-account `limit(1)` probe is one request per account, which is worse.
- Asking whether Paying % could drop the read does not help: it already does not use it (S0-6). The cost is entirely F-K5b and MK-9.

**Variants of (a) considered:**
- **A view versus an RPC.** A view keeps the repository's existing query-builder shape (`select`, `eq`, `in`, `gte`, `lt`, `order`, `limit`), so the existing tests, the keyset paging and the ceiling all carry over, and there is no `SECURITY DEFINER` question. An RPC would need two functions (by range and by ids), or one with optional arguments, and would be harder to page. **Recommended: the view.**
- **`GROUP BY min()` versus a `NOT EXISTS` anti-join inside the view.** Postgres cannot push a filter on an aggregated value below the `GROUP BY`. So the month read through a `GROUP BY` view would aggregate **all** history of the mode on every load (O(P × M) index entries). The anti-join form ("a qualifying row with no earlier qualifying row for the same account and mode") is a plain row filter. The month range pushes down to a range scan of this month's rows, and each row costs one index probe. **Recommended: the anti-join**, with ties broken by `id` so each account yields exactly one row (§6.2).

**Recommendation: option (a), a read-only `security_invoker` view with an anti-join and two partial indexes.** A production migration is needed. It is additive and read-only.

---

## 5. Design

### 5.1 One rule, two bounded questions

The rule does not change: **an account's first plan payment** is its earliest `business_os_billing_events` row with `kind = 'invoice_paid'`, `amount_minor > 0`, `paid_at` not null, in the current mode. It is defined once, in the view (§6.2). Both readers use that view through the same repository and the same dep, so Converted and MK-9 Paid keep **one shared rule** (SA-Q-MK9-1).

The builder needs exactly two answers:

| Consumer | What it needs | The bounded question |
|---|---|---|
| Converted this month (all businesses) | The plan-row accounts whose first payment is in `[month.from, month.to)` | **Q1:** accounts whose first payment is in this UTC month (cross-account, by range) |
| MK-9 Paid and Paid-before-end | The first payment, if any, of each trial that ended in the window by `now` | **Q2:** the first payment of each of these ids (by id) |
| Converted (one business picked) | That one account's first payment | **Q2** with exactly that id; Q1 is **not** run, so no other account is read |

The builder unions Q1 and Q2 into the same `{ accountId, paidAt }[]` it holds today (`firstRead.data`). It then calls `convertedThisMonth` and `trialsToPaid` **unchanged**.

**Why the union gives the same figures:**
- `convertedThisMonth` keeps only accounts in the plan-row set **and** in the month. Every such account is in Q1. Accounts in the union outside that set are dropped by its own filter, as they are today.
- `trialsToPaid` looks up only trials that ended in the window by `now`. Every such account is in Q2's ask set (§5.3), and its value comes from the same view.
- An account in both Q1 and Q2 gets the same value from both. A difference is an **error**, never a guess (§5.2).

### 5.2 The repository (`BusinessOsBillingAdminReadRepository`)

| Method | Change |
|---|---|
| `listFirstPlanPaymentsForAccounts(accountIds, livemode, opts?)` | **Same name, signature and return type** (`{ user_id, paid_at }[]`, sorted by `user_id`). New source: `.from('business_os_first_plan_payments').select('user_id, first_payment_at').eq('livemode', mode).in('user_id', chunk).order('user_id').limit(pageSize)`. The UUID check, lower-casing, de-duplication, chunks of 100 and isolation error all stay. Each chunk returns at most 100 rows. The keyset paging (now on `user_id`) and the ceiling stay as a defence. New defence: a second row for the same account is an error (`AdminBillingReadDuplicateError`), never a pick. An unreadable `first_payment_at` is still an error. The output field stays `paid_at`, so `firstPlanPayments.ts`'s mapping is unchanged |
| **New:** `listFirstPlanPaymentsInRangeAllAccounts(range, livemode, opts?)` | `range = { from, to }` as ISO text, half-open. Both must parse, `from < to`, and the span must be at most **31 days** (SA-Q-M5F-10). The read is `.from('business_os_first_plan_payments').select('user_id, first_payment_at').eq('livemode', mode).gte('first_payment_at', from).lt('first_payment_at', to)`, keyset on `user_id`, `limit(1000)`. The ceiling (20,000) is an error. It returns `{ user_id, paid_at }[]` sorted by `user_id`. A row whose date falls outside the range is an error (a defence, like the isolation check). Logged at info with counts only, never an id. The name ends `...AllAccounts`, as the header requires for a cross-account read |

The header gains a "MK5B-FU-1" paragraph: the source, why it is a view, the service role, and the callers. The events table is no longer read by this file. The "reads no boost table" pin still holds.

### 5.3 The current-mode wiring (`lib/admin/billing/firstPlanPayments.ts`)

`listCurrentModeFirstPlanPayments(query, deps?)`:
- `query = { accountIds: readonly string[]; firstPaymentIn: { from: string; to: string } | null }`.
- It resolves the mode **once** (`currentStripeMode`). An unknown mode returns an error and reads nothing (unchanged).
- It runs Q1 when `firstPaymentIn` is not null, and Q2 when `accountIds` is not empty. They run sequentially (SA-Q-M5F-9).
- **Either part failing returns an error**: one logical read, as today (SA-Q-M5F-7).
- It unions by `accountId`. The same account with two different dates is an error. The result is sorted by `accountId`, mapped field by field to `{ accountId, paidAt }`, and the mode never travels on.

The finance tree still names no mode. The finance source guard is untouched.

### 5.4 The builder (`financeHealth.ts`, MK-5b block only)

- **Dep type:** `converted.firstPlanPayments: (query: { accountIds: readonly string[]; firstPaymentIn: FinanceMonthSpan | null }) => Promise<RepoResult<Array<{ accountId: string; paidAt: string }>>>`. `FinanceMonthSpan` already exists in `financeTypes.ts`.
- **One business:** `{ accountIds: [accountId], firstPaymentIn: null }`. Exactly one id, as today.
- **All businesses:** `{ accountIds: trialAskIds, firstPaymentIn: month }`. When there are no plan rows, the read is skipped and the result is `[]`, as today's empty `.in()` made no query.
- `canRead` is unchanged: the plan walk and the paying read must both have succeeded. MK-9's Paid is therefore Unknown in exactly the cases it is today (S0-5).
- `convertedThisMonth` gets `accountIds: new Set(planRows ids)` explicitly. Today it receives `new Set(askIds)`, which is the same set.
- `firstPaymentsAll = firstRead.data` (all businesses), unchanged. **The MK-9 block (`:1502-1523`) is not edited.**
- **The MK-9 ask set** comes from a new pure helper, `lib/business-os/finance/firstPaymentAsk.ts`:
  - `trialAccountsToAsk(trials, window)` returns the ids whose `endsAt` parses and is in `[window.start, window.end)`.
  - That is a **superset** of what `trialsToPaid` looks up (it adds the `<= now` condition), so asking it can never drop a lookup. Asking an extra id cannot change a figure, because `trialsToPaid` never reads it.
  - The trials are built the same way as the MK-9 block (`planRows.filter(isTrialRow).map(row => ({ accountId, endsAt: trialEndOf(row, deps.config, now) }))`). `payingBreakdown.ts` is **not** edited (§14).
- **Isolation:** Q2 reads exactly the given ids and refuses any other row. Q1 is an explicit cross-account read, run only for all businesses. It is reached only from the admin finance route, after `requireAdmin` (unchanged). Nothing is written.
- **Log counts** (`counts.converted`, log only, never in the payload): `asked` becomes the number of ids in Q2; new `inMonth` is Q1's row count; `found` is the union's size. Counts only, never an id (SA-Q-M5F-14).

### 5.5 What does not change

- The payload shape and values, the routes, `requireAdmin`, the UI files, `convertedThisMonth.ts`, `payingBreakdown.ts`, the lineage source read and the snapshot wiring.
- The page still makes one request (AC-173).
- The one-business request reads the same single id.

### 5.6 The new cost model

| Read | Rows | Requests | DB work |
|---|---|---|---|
| Q1 (month) | C = accounts whose **first** payment is this month (new converters) | `max(1, ceil(C / 1000))` | A range scan of this month's qualifying rows on the `(livemode, paid_at)` partial index, plus one anti-join probe per row on the `(user_id, livemode, paid_at, id)` partial index. O(this month's payments × log N) |
| Q2 (ids) | At most T = trials that ended in the window | `ceil(T / 100)` (sequential, as today) | One index probe per id |

| Scale | Old | New |
|---|---|---|
| 30,000 plan rows, 20,000 payers × 12 months, 400 converters this month, 2,500 trials ended in a 30-day window | about 20 requests, then **Unknown** | 1 + 25 requests, about 2,900 rows, **exact** |
| One business picked | 1 request | 1 request |

Neither read grows with **history** any more. Q1 fails only at 20,000 **new converters in one month** (an error, so Unknown, never 0).

---

## 6. The migration and its checker

### 6.1 Skill note

`supabase-postgres-best-practices` is not installed as a readable `SKILL.md` in this environment (searched `.claude/skills`, `~/.claude/skills` and the plugin cache). Its practices are applied as earlier slices recorded them (slice 4b.1: index for the filter and join, constraints, least privilege, short lock): partial indexes matched to the queries, `security_invoker`, an explicit revoke of the Supabase default grants, `lock_timeout`, guards before any DDL, and a post-apply probe. **SA to confirm** that this is acceptable, or point Dev to the file (SA-Q-M5F-16).

### 6.2 `supabase/migrations/20261099_business_os_first_plan_payments_view.sql`

Shape (final text at build). ASCII only, and no apostrophes in comments.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Guards: the base table exists; anon and authenticated may not create in public; the view name is free.
DO $guard$ ... RAISE EXCEPTION ... Nothing was applied ... $guard$;

-- Q2 and the anti-join probe: one account in one mode, by payment time, with id as the tie-break.
CREATE INDEX business_os_billing_events_first_payment_idx
  ON public.business_os_billing_events (user_id, livemode, paid_at, id)
  WHERE kind = 'invoice_paid' AND amount_minor > 0 AND paid_at IS NOT NULL;

-- Q1: one mode, a range of payment times.
CREATE INDEX business_os_billing_events_paid_month_idx
  ON public.business_os_billing_events (livemode, paid_at)
  WHERE kind = 'invoice_paid' AND amount_minor > 0 AND paid_at IS NOT NULL AND user_id IS NOT NULL;

CREATE VIEW public.business_os_first_plan_payments WITH (security_invoker = true) AS
SELECT e.user_id, e.livemode, e.paid_at AS first_payment_at
FROM public.business_os_billing_events AS e
WHERE e.kind = 'invoice_paid' AND e.amount_minor > 0 AND e.paid_at IS NOT NULL AND e.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.business_os_billing_events AS earlier
    WHERE earlier.user_id = e.user_id AND earlier.livemode = e.livemode
      AND earlier.kind = 'invoice_paid' AND earlier.amount_minor > 0 AND earlier.paid_at IS NOT NULL
      AND (earlier.paid_at < e.paid_at OR (earlier.paid_at = e.paid_at AND earlier.id < e.id))
  );

REVOKE ALL ON TABLE public.business_os_first_plan_payments FROM PUBLIC;
REVOKE ALL ON TABLE public.business_os_first_plan_payments FROM anon;
REVOKE ALL ON TABLE public.business_os_first_plan_payments FROM authenticated;
REVOKE ALL ON TABLE public.business_os_first_plan_payments FROM service_role;
GRANT SELECT ON TABLE public.business_os_first_plan_payments TO service_role;

COMMENT ON VIEW ... 'One row per account and Stripe mode  the earliest paid plan invoice above zero  Read only  service role only  Admin finance Converted this month and trial to paid';

-- Post-apply probe: service_role can read it; anon and authenticated cannot (has_table_privilege). Raises, so the whole file rolls back.
DO $probe$ ... $probe$;
COMMIT;
```

**Design notes:**
- **Least privilege.** `security_invoker = true`, and RLS stays on the base table, which has no client policy. Only `service_role` (which bypasses RLS) has `SELECT`. Supabase's default privileges would otherwise grant the new view to `anon` and `authenticated`, so the revokes are required, and the probe and the checker both verify them.
- **No `security_barrier`.** It would stop the month and id filters from being pushed down, and only the service role can read the view anyway.
- **Ties.** Two qualifying rows of one account and mode at the same `paid_at` yield one row: the smaller `id`. Its `paid_at` is the same instant, so the value equals the old "keep the earliest".
- **Detached rows** (`user_id` NULL) are left out. The old `.in('user_id', ...)` never matched them either.
- **The lock.** A plain `CREATE INDEX` inside the transaction takes a SHARE lock on a small, low-write table. It blocks webhook inserts for milliseconds, under `lock_timeout = '5s'`. `CONCURRENTLY` cannot run inside a transaction and is not needed at this size (SA-Q-M5F-4).
- **No writer is touched.** `business_os_apply_plan_payment`, the reconciler and the operator cleanup function are unchanged. The view depends on the table, so a future `DROP COLUMN paid_at` would need the view dropped first (recorded in the comment).

### 6.3 Rollback: `supabase/SQL Scripts/20261099_business_os_first_plan_payments_view_rollback.sql`

`DROP VIEW IF EXISTS public.business_os_first_plan_payments;` and `DROP INDEX IF EXISTS` for both indexes, in one transaction. The code would then read Unknown (the reads error), never a wrong number. If the code must be reverted too, the code is reverted first.

### 6.4 The checker: `scripts/check-bos-first-plan-payments-migration.sql`

It is read-only (`SET default_transaction_read_only = on;`), gives one result set, and is paste-safe: ASCII only, no apostrophe in a comment, never the editor's trouble word, and no write keyword. It returns one row of named checks plus an `all_ok`.

| # | Check | Expected |
|---|---|---|
| C-1 | The view exists in `public`, `relkind = 'v'` | 1 |
| C-2 | `reloptions` holds `security_invoker=true` | true |
| C-3 | Columns in order: `user_id uuid`, `livemode boolean`, `first_payment_at timestamp with time zone` | exact signature |
| C-4 | Privileges: `service_role` has SELECT only; `anon`, `authenticated` and `PUBLIC` have nothing (`aclexplode` over `relacl`) | exact |
| C-5 | Both indexes exist, `indisvalid`, with the expected columns and predicates (`pg_get_indexdef` contains them) | 2 |
| C-6 | **Equivalence on the live data:** a full outer join of the view with `SELECT user_id, livemode, min(paid_at) FROM events WHERE <rule> AND user_id IS NOT NULL GROUP BY 1, 2`. The number of keys missing on either side or with a different time | **0** |
| C-7 | Duplicate `(user_id, livemode)` keys in the view | **0** |
| C-8 | The base table still has RLS on and still grants service role SELECT and INSERT only (unchanged) | true |

The checker returns counts only, never an id. A migration-text Jest test pins the migration, the rollback and the checker (§9.6).

### 6.5 Apply order (SA-Q-M5F-8)

1. SA approves the SQL, and the user gives a go-ahead for the production apply (additive and read-only). Precedent: the user has approved additive migrations before, for example 20261055, 20261059 and 20261060, 20261074 and 20261075.
2. The user pastes the migration into a new SQL editor tab, then runs the checker: `all_ok`.
3. `npm run schema:check` is green. The new `.from('business_os_first_plan_payments')` select now resolves.
4. Merge. If the code reaches production before the view exists, Q1 and Q2 error, so Converted and MK-9 Paid show Unknown (fail-closed, never 0 or wrong) until the apply. There is no fallback to the old read (SA-Q-M5F-8).

---

## 7. Files to create or modify

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261099_business_os_first_plan_payments_view.sql` | create | The view and two partial indexes (§6.2) |
| `supabase/SQL Scripts/20261099_business_os_first_plan_payments_view_rollback.sql` | create | Rollback (§6.3) |
| `scripts/check-bos-first-plan-payments-migration.sql` | create | Checker (§6.4) |
| `supabase/migrations/__tests__/bos-first-plan-payments-view.migration.test.ts` | create | SQL-text guard over the three files (§9.6) |
| `lib/repositories/BusinessOsBillingAdminReadRepository.ts` | modify | Q2 re-sourced to the view; new Q1 method; header (§5.2) |
| `lib/repositories/__tests__/BusinessOsBillingAdminReadRepository.test.ts` | modify | R-1 to R-11 rewritten for the view; Q1 cases; the source test's `.from(` list (ordinary test, MK-5b D-3 precedent) |
| `lib/admin/billing/firstPlanPayments.ts` | modify | Query object, one mode, union, either-fails (§5.3) |
| `lib/admin/billing/__tests__/firstPlanPayments.test.ts` | modify | New cases |
| `lib/business-os/finance/firstPaymentAsk.ts` | create | `trialAccountsToAsk`, pure (§5.4) |
| `lib/business-os/finance/__tests__/firstPaymentAsk.test.ts` | create | Includes the superset property against `trialsToPaid` |
| `lib/business-os/finance/financeHealth.ts` | modify | The dep type and the MK-5b block only; the `:876` comment; log counts (§5.4) |
| `lib/business-os/finance/financeHealthDeps.ts` | modify | The wiring passes the query (one line). It imports entitlements (§8.3) |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | modify | Asserted dep call arguments and `counts.converted` |
| `lib/business-os/finance/__tests__/firstPaymentEquivalence.test.ts` | create | The equivalence and scale tests (§9.4, §9.5) |
| `lib/business-os/finance/__tests__/helpers/legacyFirstPlanPayments.ts` | create | A frozen, verbatim copy of main's read (the "old path"), with its LF hash pinned (§9.4) |
| `lib/business-os/finance/__tests__/helpers/fakeFirstPaymentDb.ts` | create | A fake that really applies `eq`, `gt`, `gte`, `lt`, `not is null`, `in`, `order`, `limit` to the events, plus a reference view (SA-Q-M5F-13) |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | modify | AC-145: one ruled re-freeze of `EXPECTED_CALLS` only (§8.1) |
| `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md` | modify | §0.4 MK5B-FU-1 row status, and Change History, at each stage |
| This workplan | modify | Audit trail |

**Not touched:** `payingBreakdown.ts`, `convertedThisMonth.ts`, `financeTypes.ts`, every UI file, every route, the lineage repository, `tests/helpers/fakePostgrest.ts`, and the range-cap guard.

---

## 8. Pins and guards

### 8.1 Pins that move

| Pin | Move | Proof |
|---|---|---|
| **AC-145** `EXPECTED_CALLS` (the named reads) | **One ruled re-freeze.** `'converted.firstPlanPayments'` goes from `[[[ACCOUNT]]]` to `[[{ accountIds: [<the fixture trial ids ended in the window>], firstPaymentIn: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' } }]]` (exact ids set at build from the fixture). No other entry changes | **Restore proof:** the test keeps `MK5B_CALLS_ENTRY = [[[ACCOUNT]]]` and asserts that `EXPECTED_CALLS` with that one entry put back equals main's map. **Payload proof:** `EXPECTED_SHA256` stays **`38897cd3…4edf`**, and every older hash in the chain still holds. The bytes did not move, which is the proof that the numbers did not change |

The AC-145 payload hash is **not** expected to move. If it does, that is a defect, not a re-freeze.

### 8.2 Pins that must not move

Pin A `a130d560`, Pin B `eac3590a`, Pin C `e57f2675` and `64a565e9`, Pin D `1f7cf07a`, AC-173 `3a1a2dd4` and `b84e0c96`, T-12 `c2891a35`, and the AC-145 payload `38897cd3`. These are re-hashed (LF) at handover, after the last edit (MK-5b retrospective lesson).

### 8.3 Guards

| Guard | Expectation |
|---|---|
| Range-cap FF-1d | **Unchanged: 11 entries, 17 call sites.** Every new `.limit` is `ADMIN_BILLING_READ_LIMITS.PAGE_SIZE` (1,000) |
| Finance source guard (`lib/business-os/finance/**` names no mode; app finance source guard) | Green, unedited. `firstPaymentAsk.ts` names no mode or table |
| `firstPaymentStamp.guard` (P5-C4) | Green, unedited: the column is `first_payment_at` (S0-10) |
| Own-repository source test (`.from(` list and livemode count) | Updated, as an ordinary test (MK-5b D-3): accounts, accounts, view, view; every read filters `livemode`; no events table, no boost table, no write call |
| `business-os-entitlements` | `financeHealthDeps.ts` (touched) imports `entitlements/source`. No new importer. Run `npm run test:bos-entitlements` |
| `businessOwnedTables` | Not affected: it scans `CREATE TABLE`, and this is a view (confirm at build) |
| `schema:check` | Red until the migration is applied, then green (§6.5) |
| `test:authz-guard` | No route change; run once |

---

## 9. Tests

### 9.1 Repository (`BusinessOsBillingAdminReadRepository.test.ts`)

| # | Case |
|---|---|
| R-1 | Q2's filter: `from('business_os_first_plan_payments')`, `select('user_id, first_payment_at')`, `eq('livemode', mode)`, `in('user_id', chunk)`, `order('user_id')`, `limit(1000)` |
| R-2 | The mode is passed as asked; a non-boolean is refused before any query |
| R-3 | Chunking: 250 ids give `in()` sizes 100, 100, 50 |
| R-4 | Paging is kept as a defence: a full page asks for the next page with `gt('user_id', last)` |
| R-5 | The ceiling is an error, with `data` null |
| R-6 | Output: `{ user_id, paid_at }` sorted by `user_id`; accounts with no row are absent |
| R-7 | A duplicate account row is `AdminBillingReadDuplicateError` (planted) |
| R-8 | Isolation: a row for an id not asked for is an error; a non-UUID is refused with 0 queries; an empty list makes 0 queries |
| R-9 | An unreadable `first_payment_at` is an error |
| R-10 | Errors are returned, never thrown; logs carry counts only, no id |
| R-11 | Source: the `.from(` list and the livemode count; no events or boost table; no write call |
| Q1-1 | Q1's filter: `eq('livemode')`, `gte('first_payment_at', from)`, `lt('first_payment_at', to)`, `order('user_id')`, `limit(1000)` |
| Q1-2 | Range guard: unparseable, `from >= to`, or a span over 31 days is refused before any query |
| Q1-3 | Keyset paging over 2,500 rows: 1,000, 1,000, 500, with `gt('user_id', last)` |
| Q1-4 | The ceiling is an error; a returned row outside the range is an error (planted) |
| Q1-5 | Logs carry counts only |

### 9.2 Wiring (`firstPlanPayments.test.ts`)

- The mode is resolved once and passed to both reads.
- An unknown mode makes no read.
- Only Q1, only Q2, both, and neither (returns `[]` with 0 reads).
- Either read failing returns the error.
- The union: an account in both with the same date appears once; with different dates it is an error.
- The sort and the field-by-field mapping.

### 9.3 Builder and helper

- **`firstPaymentAsk.test.ts`:** the window edges (`endsAt == start` is in, `== end` is out); null and unparseable `endsAt` are out. **Superset property** (seeded PRNG, 200 runs): for random trials, windows and `now`, every account `trialsToPaid` looks up is in `trialAccountsToAsk`.
- **`financeHealth.test.ts`:**
  - All businesses calls the dep once with `{ accountIds: trialAskIds, firstPaymentIn: currentUtcMonth(now) }`.
  - One business calls it with `{ accountIds: [id], firstPaymentIn: null }`.
  - No plan rows means no call.
  - A plan or paying failure means no call (`canRead`).
  - A dep error makes Converted and MK-9 Paid Unknown.
  - `counts.converted` has the new fields (counts only).

### 9.4 The equivalence test (`firstPaymentEquivalence.test.ts`)

**The old path** is `legacyFirstPlanPayments.ts`: a verbatim copy of main's `listFirstPlanPaymentsForAccounts` body (`8967888c`), reading raw events through the fake, and wired the old way (`firstPlanPayments(planRowIds)`). Its LF hash is pinned in the test, so the copy cannot drift.

**The new path** is the real repository (Q1 and Q2) over the fake view, the real `firstPlanPayments.ts`, and the real builder.

**The reference oracle** is a brute-force `min` by `(paid_at, id)` per account and mode over the same events.

Both paths run `buildFinanceHealth` on the **same seeded data** and the same `now` and window. The assertions:
- `payload.converted`, `payload.payingBreakdown` and `payload.paying` are deep-equal, and the **whole payload JSON is byte-equal**.
- The repository-level outputs are deep-equal, for the ids both are asked.
- The fake view equals the oracle.

| Data set | Covers |
|---|---|
| EQ-1, seeded random (50 seeds) | 0 to 300 accounts; payments spread over 18 months; both modes |
| EQ-2, **1,750 accounts** | Over QA's figure, with rows kept under 20,000 so the old path can still answer (for example 1,750 accounts, about 1 to 10 payments each) |
| EQ-3, **2,000 accounts** | With plan-row counts at 100, 101, 200, 1,000 and 1,001 (chunk boundaries) |
| EQ-4, page boundary | One 100-id chunk holding exactly 1,000, then 1,001 rows |
| EQ-5, ties | Two qualifying rows at the same `paid_at` (same instant, also written with different offsets); a $0 row earlier than the first paid one |
| EQ-6, month edges | `00:00:00Z` on the 1st; `23:59:59.999Z` on the last day; `-01:00` offsets crossing midnight; a payment in the **next** month |
| EQ-7, exclusions | The other mode earlier; `amount_minor = 0`; `paid_at` null; `user_id` null; `kind` refunded, subscription_updated, mismatch_refused; a platform account; an account with no plan row |
| EQ-8, stopped accounts | Converted this month and not paying: listed, not counted, on both paths |
| EQ-9, trials | End at `window.start`, at `window.end`, at `now`, after `now`, and null; paid before, at and after the end; paid in an earlier month (before the window) |
| EQ-10, one business picked | Each of `converted`, `stopped`, `not_converted`; and Unknown on a failed read |
| EQ-11, failures | The plan walk failed, the paying read failed, or the first-payment read failed: the same Unknown states on both paths |

### 9.5 The scale test (same file)

| # | Case | Assertion |
|---|---|---|
| SC-1 | 30,000 plan rows; 20,000 payers × 13 monthly invoices (about 260,000 rows); 400 first payments this month; 2,500 trials ended in a 30-day window | **Old path:** a ceiling error, so `converted.status === 'unknown'` (this documents the defect). **New path:** `status: 'ok'`, and `converted`, `stopped`, `rows` and MK-9 Paid equal the **oracle**. Requests: Q1 = 1, Q2 = 25; every `limit` ≤ 1,000; total rows read ≤ 2,900 |
| SC-2 | 20,000 first payments in one month | Q1's ceiling is an error, so Unknown, never 0 |
| SC-3 | Time budget | SC-1 finishes under 10 s locally (the fake view is precomputed once). This is a ceiling, not a benchmark, so it does not slow CI meaningfully (SA-Q-M5F-12) |

### 9.6 The migration-text test (`bos-first-plan-payments-view.migration.test.ts`)

Precedent: exposed views slice 1b.
- **Migration:** `BEGIN`/`COMMIT`, `lock_timeout`, the guards, both index definitions and predicates, `security_invoker = true`, no `security_barrier`, the view's predicate equal to the rule (`invoice_paid`, `amount_minor > 0`, `paid_at IS NOT NULL`, `user_id IS NOT NULL`), the tie-break on `id`, the four revokes and the single grant, the post-apply probe, and no `SECURITY DEFINER`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` or `ALTER TABLE`.
- **Checker:** read-only, one statement after the `SET`, ASCII only, no apostrophe in a comment, never the trouble word, no write keyword, checks C-1 to C-8 present.
- **Rollback:** drops exactly the three objects.

### 9.7 Runs before handover

| Run |
|---|
| `lib/repositories` |
| `lib/admin/billing` |
| `lib/business-os/finance` |
| `app/admin/finance` |
| The finance route |
| `app/admin/components` |
| `supabase/migrations/__tests__` |
| The guards: range-cap, finance source (lib and app), first-payment stamp, vocabulary, layout, contrast, USD copy |
| `npm run test:authz-guard` |
| `npm run test:bos-entitlements` |
| `npm run lint:hooks` |
| A scoped tsc with a canary (`NODE_OPTIONS=--max-old-space-size=8192`; check the exit code, not a grep) |
| `npm run build` |
| The pins re-hashed (LF) |

---

## 10. Acceptance criteria

| # | Criterion |
|---|---|
| MK5BFU-AC-1 | For every data set the old path can answer (§9.4), the new path gives a **byte-identical payload**: Converted (count, stopped, rows, status), the list, MK-9 Paid, Paid-before-end and rate, and Paying % |
| MK5BFU-AC-2 | At 30,000 plan rows and 20,000 payers with a year of history, Converted and MK-9 Paid are **exact** (they equal the oracle), not Unknown |
| MK5BFU-AC-3 | No request asks for more than 1,000 rows. Q2 asks at most 100 ids per request. Rows read no longer grow with payment history (Q1 is about the new converters this month; Q2 is at most the trial ids) |
| MK5BFU-AC-4 | Converted and MK-9 Paid use **one rule** from one view, through one dep. Either part failing makes both Unknown, never 0 |
| MK5BFU-AC-5 | One business picked reads exactly that id (Q2) and never runs Q1 |
| MK5BFU-AC-6 | The view is `security_invoker`, service role SELECT only, with no `anon`, `authenticated` or `PUBLIC` privilege. RLS on the base table is unchanged. No writer changes |
| MK5BFU-AC-7 | On production, after the apply, the checker's `all_ok` is true, including C-6 (the view equals `GROUP BY min`: 0 differences) and C-7 (0 duplicates) |
| MK5BFU-AC-8 | AC-145: only `EXPECTED_CALLS['converted.firstPlanPayments']` changes, with the restore proof. `EXPECTED_SHA256` stays `38897cd3…` |
| MK5BFU-AC-9 | Pins A to D, AC-173 and T-12 are byte-identical |
| MK5BFU-AC-10 | The range-cap guard is unchanged at 11 and 17. The finance source guards and the stamp guard are green and unedited. `lib/business-os/finance/**` names no mode |
| MK5BFU-AC-11 | No `console.*` in any touched file. Every log carries counts only, never an account id |
| MK5BFU-AC-12 | Admin access is unchanged: the only route stays behind `requireAdmin`, and every read goes through `lib/repositories/` |
| MK5BFU-AC-13 | FIN §0.4 MK5B-FU-1 is updated at each stage (scoping, SA, QA, PR and merge, apply) |

---

## 11. Task list

- ✅ Step 0: Facts re-verified at `8967888c` (main had not moved); `20261097` still free; pins hashed
- ✅ Step 1: The migration, rollback, checker, EXPLAIN probe (M5F-C4) and migration-text test (M5F-C1 to C3)
- ✅ Step 2: The repository (Q2 re-sourced, Q1 new) with tests R-1 to R-10 and Q1-1 to Q1-5
- ✅ Step 3: `firstPlanPayments.ts` with tests
- ✅ Step 4: `firstPaymentAsk.ts` with the superset property test and a planted control
- ✅ Step 5: The builder MK-5b block, the dep type, the wiring, and the builder tests (M5F-C5 spy)
- ✅ Step 6: The legacy copy, the fake, and the equivalence and scale tests
- ✅ Step 7: The AC-145 ruled calls re-freeze, with the restore proof; hash unchanged
- ✅ Step 8: The runs, the pins re-hashed, FIN §0.4 updated
- [ ] Step 9 (user, after SA + QA): apply the migration on production, run the checker, then RM merges

---

## 12. Estimate

**About 2 days**, inside the 1.5 to 2 day target.

| Part | Days |
|---|---|
| Step 0 and the migration set (migration, rollback, checker, text test) | 0.6 |
| Repository and wiring with tests | 0.45 |
| Helper and builder with tests | 0.3 |
| Equivalence and scale tests (fake, legacy copy, oracle) | 0.45 |
| AC-145, runs, pins, docs | 0.2 |

If SA prefers no indexes (SA-Q-M5F-4), subtract 0.05. If SA wants an RPC instead of a view, add 0.25.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| The planner does not push the month range through the anti-join view, and scans all history | The `(livemode, paid_at)` partial index exists for it. After the apply the user may run a plain `EXPLAIN` (not `ANALYZE`), which is read-only, on Q1's shape; the text is given with the checker. `durationMs` on the finance log line is watched. The figures stay exact either way; only latency is at stake |
| The view and the old read disagree in some corner | Checker C-6 compares the view with `GROUP BY min` on the live data; EQ-1 to EQ-11 compare the old and new paths; the oracle checks both |
| The code is deployed before the migration | Fail-closed: Unknown, never 0 or wrong. The apply order in §6.5 puts the apply first |
| Supabase default grants expose the view to `anon` | The explicit revokes; the post-apply probe rolls everything back otherwise; checker C-4 |
| The trial ask set drifts from `trialsToPaid` | It is a superset by construction, and a property test pins it against the real `trialsToPaid` |
| The migration number collides with a parallel branch | It is re-checked at Step 0 and before the PR; RM renumbers if needed (precedent: 4b.1's renumbering) |
| The scale test slows CI | It is precomputed and bounded (SC-3), and runs in the existing Jest job, not on the `next build` path |
| The legacy copy hides a difference by being edited | Its LF hash is pinned to main's function body |
| A future change to the base table must account for the view | Recorded in the view comment; Postgres refuses a `DROP COLUMN` the view depends on |

---

## 14. Concurrent work and overlaps

| Work | Files | Overlap with this slice |
|---|---|---|
| **PR #536** (five-tile grid) | `BlockKpi.tsx`, `CreditsSection.tsx`, `TakingsSection.tsx`, `LeakCheckPanel.tsx` and their tests | **Merged** to main (`e9b0fc77`) during Step 0. This branch was fast-forwarded to `8967888c`, which includes it. No shared file |
| **Follow-ups bundle (another Dev):** `payingBreakdown.ts`, `PayingBreakdownSection.tsx` (Comped "at least") | | **None by design.** This slice does not edit `payingBreakdown.ts` (the ask helper is a new file) or any UI file |
| Same bundle: AI cost drawers, the bos-llm baseline, `SmartLinkRepository` | | None |
| Same bundle, **likely knock-on** in `financeHealth.ts` (the MK-9 block at `:1502-1523`, if Comped "at least" passes `capped` to `compedSplit`) and in `financeHealth.test.ts` | | **Possible textual overlap.** This slice edits only the MK-5b block (`:867-967`), the dep type (`:358-366`) and the counts type. Both edit the same test file: additive, so a merge, not a conflict in kind |
| Same bundle, **likely knock-on** in AC-145 (`route.test.ts`): Comped "at least" may add a payload field, which would re-freeze `EXPECTED_SHA256` | | **Same describe block.** This slice moves `EXPECTED_CALLS` only and leaves the hash alone, so the two changes are independent. Whoever merges second rebases and re-runs AC-145. If the bundle merges first, the hash this slice must keep becomes theirs |
| Same bundle: `financeTypes.ts` (if it adds a `capped` field to `FinanceCompedSplit`) | | None: this slice does not edit `financeTypes.ts` |
| The range-cap guard | | None: this slice neither adds nor removes an entry |

---

## 15. SA questions

| # | Question | Default |
|---|---|---|
| SA-Q-M5F-1 | Option (a), a migration, over (b) and (c)? | **(a).** (b) cannot be bounded without aggregation (§4); (c) on lineage changes the numbers, and a new column touches the money write path |
| SA-Q-M5F-2 | A view or an RPC? | **A view**, `security_invoker`, service role SELECT only |
| SA-Q-M5F-3 | The view's form: a `NOT EXISTS` anti-join with an `id` tie-break, or `GROUP BY min()`? | **The anti-join**, so the month range pushes down |
| SA-Q-M5F-4 | Two partial indexes, created plainly inside the transaction (not `CONCURRENTLY`)? | **Yes, both, plain**: a small, append-only table under `lock_timeout = '5s'` |
| SA-Q-M5F-5 | One dep with a query object, or two deps? | **One dep**: one rule, one failure, one AC-145 key |
| SA-Q-M5F-6 | MK-9's ask set as a superset helper in a new file, leaving `payingBreakdown.ts` unedited, or a shared predicate exported from `payingBreakdown.ts`? | **A new file, a superset, and a property test**: no drift, and no overlap with the parallel bundle |
| SA-Q-M5F-7 | Either part failing makes both Converted and MK-9 Paid Unknown, as today? | **Yes** |
| SA-Q-M5F-8 | Apply before merge, with no runtime fallback to the old read on `42P01`? | **Yes**: fail-closed Unknown in the gap |
| SA-Q-M5F-9 | Q2 chunks of 100, sequential, as today? | **Yes**; concurrency only if `durationMs` shows a need |
| SA-Q-M5F-10 | Q1 refuses a span over 31 days? | **Yes**: it is only ever this UTC month |
| SA-Q-M5F-11 | AC-145: a calls-only re-freeze with the restore proof, the hash unchanged? | **Yes** |
| SA-Q-M5F-12 | A scale test of about 260,000 fake rows in the ordinary Jest job? | **Yes**: bounded at under 10 s locally, and not on the `next build` path (no added CI time on the critical path) |
| SA-Q-M5F-13 | A dedicated fake for this test, or extending `tests/helpers/fakePostgrest.ts` (no `gt`, `lt` or `not` today) with timestamp-aware comparisons? | **Dedicated**: the shared helper and its 5 suites stay untouched |
| SA-Q-M5F-14 | `counts.converted` gains `inMonth`, and `asked` changes meaning (Q2's ids)? | **Yes**: log only, counts only |
| SA-Q-M5F-15 | Migration number `20261097`? | **Yes**, re-checked at Step 0. Superseded 2026-10-28: renumbered to `20261099` |
| SA-Q-M5F-16 | `supabase-postgres-best-practices` was applied from recorded practice, because the `SKILL.md` is not readable here (§6.1). Acceptable? | **Yes**, or point Dev to the file |

---

## 16. Business questions

**None.** This slice changes no definition, wording or figure. The only visible difference is past the old ceiling: where the page would have said "Unknown", it gives the exact figure. Production apply consent (§6.5) is an operational go-ahead, not a business decision.

---

## Implementation Notes

**Built 2026-10-27 on `fix/finance-paying-first-payment-scale` at `8967888c`. Uncommitted. Nothing applied to production.**

### Files

| File | Action |
|---|---|
| `supabase/migrations/20261099_business_os_first_plan_payments_view.sql` | Created. Guards (PG15, base table, schema CREATE, free names, service-role SELECT); `lock_timeout` 5s and `statement_timeout` 120s; two partial indexes; the view; four revokes and one grant; a post-apply probe |
| `supabase/SQL Scripts/20261099_business_os_first_plan_payments_view_rollback.sql` | Created |
| `scripts/check-bos-first-plan-payments-migration.sql` | Created: C-1 to C-8, `base_rows` and `all_ok` |
| `scripts/explain-bos-first-plan-payments-month.sql` | Created: C-9, `EXPLAIN` only, not part of `all_ok` |
| `supabase/migrations/__tests__/bos-first-plan-payments-view.migration.test.ts` | Created (18 tests) |
| `lib/repositories/BusinessOsBillingAdminReadRepository.ts` | Modified. Q2 re-sourced to the view; new `listFirstPlanPaymentsInRangeAllAccounts` (Q1); shared `readLimits`, `keepFirstPayment`, `sortedFirstPayments` and `failed`; `AdminBillingReadDuplicateError`; header |
| `lib/admin/billing/firstPlanPayments.ts` | Modified. Query object, mode resolved once, the two answers joined, either failure fails the whole read |
| `lib/business-os/finance/firstPaymentAsk.ts` | Created |
| `lib/business-os/finance/financeHealth.ts` | Modified. The MK-5b block, the dep type, the counts type, a header paragraph, and one separate type import |
| `lib/business-os/finance/financeHealthDeps.ts` | Modified (one wiring line) |
| `tests/helpers/fakeFirstPaymentDb.ts`, `tests/helpers/legacyFirstPlanPayments.ts` | Created (D-1) |
| Tests | Repository, wiring, ask helper, builder, equivalence and scale, route (AC-145), and the RC-15 guard (D-2) |

### Deviations

| # | Item | Why |
|---|---|---|
| D-1 | The two test helpers live in `tests/helpers/`, not in `lib/business-os/finance/__tests__/helpers/` | Jest collects every `.ts` file under `__tests__`, so a helper there would fail as an empty suite. `fakePostgrest.ts` is the precedent |
| D-2 | **One line added to the RC-15 guard's `ALLOWED` set** (`businessOsEntitlements.imports.guard.test.ts`): `firstPaymentEquivalence.test.ts` | The test names `BusinessOsAccountPlanRepository` only in the path of an `import type`, for its plan-row fixtures. It imports no value and mocks nothing. The guard's header says to declare such a file, not hide the name, and `financeHealth.test.ts` is listed for the same reason. **SA to confirm** |
| D-3 | SC-1 proves the old path fails **at the read**: the legacy reader returns `AdminBillingReadCeilingError`. It does not run a second 19,500-account build | This keeps SC-1 under the 10 s budget (SA-Q-M5F-12). EQ-11 already proves that a failed first-payment read gives the same Unknown through the builder on both paths |
| D-4 | SC-1 uses **19,500** plan rows, not 30,000, with 107,401 qualifying rows | **New finding:** the plan walk has its own cap, `FINANCE_LIMITS.PLAN_CEILING`, at 20,000 plan rows. Above it the walk is cut and Converted becomes `partial` ("at least"), never Unknown. This slice does not change that; it is follow-up **MK5BFU-FU-1** below. SC-1 stays just under the cap so that `partial` does not cloud the comparison |
| D-5 | The log field is `inMonthAsked` (a boolean), not `inMonth` (a count) | The builder sees one joined result, so it cannot count Q1's rows itself. The repository's own info line carries Q1's row count. Counts only, log only (SA-Q-M5F-14) |
| D-6 | The fake view keeps each relation sorted once and memoises parsed times | Needed to keep SC-1 and SC-2 inside the time budget. The view's rows are still computed by the same reference rule |

### Follow-up found while building

| ID | Item |
|---|---|
| MK5BFU-FU-1 | **The plan walk's 20,000-row cap.** `FINANCE_LIMITS.PLAN_CEILING` is the shadow report's own limit. It caps F-K5, Converted and MK-9 at 20,000 plan rows, which counts every account with a plan, paying or not. Past it these figures read "at least": never wrong and never Unknown. Raising the cap is a separate decision, because the plan walk also feeds Section 1 |

### Pins (LF-normalised, after the last edit)

| Pin | Value | Moved? |
|---|---|---|
| AC-145 payload `EXPECTED_SHA256` | `38897cd3295ae0c5e865503cf0394453c38f532b0ec87866610126281b1e4edf` | **No** (asserted, green) |
| AC-145 `EXPECTED_CALLS['converted.firstPlanPayments']` | `[[{ accountIds: [], firstPaymentIn: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' } }]]` (was `[[[ACCOUNT]]]`) | **Yes: the one ruled re-freeze (M5F-11).** Restore proof: `MK5B_FIRST_PAYMENT_CALLS`, and this is the only key that differs |
| Route test file | `52f022fb` → `88e729b0` | Yes (the file holds AC-145) |
| Pin A | `a130d560` | No |
| Pin B | `eac3590a` | No |
| Pin C and its helper | `e57f2675`, `64a565e9` | No |
| Pin D | `1f7cf07a` | No |
| AC-173 and its helper | `3a1a2dd4`, `b84e0c96` | No |
| T-12 | `c2891a35` | No |
| Legacy block (`tests/helpers/legacyFirstPlanPayments.ts`) | `ac0ac49b85eb2295d77b7a42152522a9478fbf92d054a1c5c3d3b47aaf933e04`, equal to lines 251 to 327 at main `8967888c` | New pin |
| Range-cap guard | 11 entries, 17 call sites | No |

### Runs (2026-10-27)

The machine was shared with other sessions, and the CPU was at 100% for part of these runs.

| Run | Result |
|---|---|
| `lib/business-os/finance` | 26 suites, 2,302 tests |
| `lib/admin/billing` | 5 suites, 85 tests |
| Finance route (`app/api/admin/business-os/finance`) | 2 suites, 139 tests |
| `app/admin/finance` (UI) | 29 suites, 960 tests |
| `lib/repositories` (includes range-cap and RC-15) | 124 suites, 2,967 tests |
| `supabase/migrations/__tests__` | 55 suites, 2,767 tests |
| Equivalence and scale (`firstPaymentEquivalence.test.ts`) | 17 tests. **SC-1: 6.8 to 7.2 s** (19,500 plan rows, 107,401 qualifying rows, 16 requests, 2,308 rows read). SC-2: 0.7 s |
| Guards: range-cap, first-payment stamp, finance source (lib and app), USD copy, `businessOwnedTables`, purge no-deletion paths, test-account cleanup SQL | 8 suites, 1,994 tests |
| `npm run test:authz-guard` | 2 suites, 203 tests |
| `npm run test:bos-entitlements` | 320 suites, 9,589 tests |
| `typecheck:bos-llm` (`NODE_OPTIONS=--max-old-space-size=8192`) | Exit 0: 598 files, 11 errors, **0 new** |
| Scoped tsc (8 GB; the 16 touched files and their imports) | Exit 0, **0 errors**. The canary in `firstPaymentAsk.ts` gave TS2322 (exit 2); the file was restored and is `cmp`-identical |
| `npm run lint:hooks` | Exit 0 |
| `console.*` in touched files | None |
| Not run | `npm run build`; `npm run schema:check`, which stays red by design until the view is applied (§6.5) |

### Sync with main and renumbering (2026-10-28, CR-M5F-1)

**Migration renumbered `20261097` → `20261099`.** Main took `20261097_a_session_knows_what_it_replaced.sql` and `20261098_business_os_account_plans_after_plan_moves.sql`; `20261098` is applied on prod. After `git fetch`, `git ls-tree origin/main supabase/migrations/` showed nothing at or above `20261099`, and no remote branch holds a `20261099` or later file. Renamed: the migration, the rollback in `supabase/SQL Scripts/`, and every reference in the checker, the EXPLAIN probe, the migration-text test, the repository comments, this workplan and FIN §0.4. No reference to `20261097` remains that belongs to this view; the ones left are history rows, each marked superseded.

**Commits (local, not pushed).** `713e83fb` `fix(admin-finance): read first plan payments from a bounded view (MK5B-FU-1)`, then `23b6eac0`, the merge of origin/main `abe9fd64` (69 commits, through #559).

**Conflicts.** One: `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md`, Change History, where both sides appended a 2026-10-27 row (main: FU-SL-1 and FU-SL-2 to Offir; ours: MK5B-FU-1 built). Both kept, main's first. `financeHealth.test.ts` (main added the MK9-FU-2 capped-walk test) and `businessOsEntitlements.imports.guard.test.ts` (RC-15) merged cleanly; `payingBreakdown.ts` was changed by main only (one comment, MK9-FU-2) and is not touched by this slice.

**20261098 (D3.1, after-plan moves).** It adds two columns to `business_os_account_plans` (`after_plan_moves`, `after_plan_last_subscription_id`) and three CHECKs. No index, grant, policy or view change, and nothing on `business_os_billing_events`. So:
- **The view and its indexes:** unaffected. The view reads only `business_os_billing_events`.
- **The plan walk (`PLAN_COLUMNS`):** unchanged on main; the new columns are read only by `findAfterPlanMoveInputs`.
- **The equivalence assumptions:** hold. The trial ids we ask about and the trials MK-9 counts both come from `isTrialRow` and `trialEndOf` over the same plan rows, so the ask set stays a superset whatever writes the cohort.
- **A meaning change outside this slice (for BA/SA):** D3.1's code sets an owner-cancelled paid account to cohort `trial` (`AFTER_PLAN.cohort`) with fresh trial dates. When that free period ends, MK-9 trial-to-paid counts it as an ended trial, as paid, and as paid before the end, because its first payment predates the period. Once D3.1 moves happen, repeat cancellers inflate the rate. This is the same under the old read and the new one, so it is not a regression from this slice. Converted this month is not affected: these accounts' first payment is never in the current month. Proposed follow-up: **MK5BFU-FU-2**, keep after-plan periods (`after_plan_moves > 0`, or a first payment before the trial start) out of the MK-9 base.

**Main moved again during the sync.** At the end of the run, origin/main was 2 commits ahead (P-8b, the "disagrees" Subscriptions filter: `lib/admin/billing/subscriptions*`, `billingPanelView.ts`, the finance UI). No migration, and none of this slice's files. Merge it again before the PR.

**Pins after the merge (LF-normalised).**

| Pin | Value | Moved? |
|---|---|---|
| AC-145 `EXPECTED_SHA256` | `38897cd3295ae0c5e865503cf0394453c38f532b0ec87866610126281b1e4edf`, equal to main's | **No** |
| AC-145 `EXPECTED_CALLS` | Only `'converted.firstPlanPayments'` differs from main | As ruled (M5F-11) |
| Route test file | `88e729b0` (main `52f022fb`) | As before |
| Pin A / Pin B | `a130d560` / `eac3590a` | No |
| Pin C and its helper | `e57f2675`, `64a565e9` | No |
| Pin D | `1f7cf07a` | No |
| AC-173 and its helper | `3a1a2dd4`, `b84e0c96` | No |
| T-12 | `c2891a35` | No |
| Legacy block | `ac0ac49b…3e04` (asserted green) | No |
| Range-cap guard | 11 entries, 17 call sites | No |

Every value equals main's file hash, except the route test, which holds AC-145.

**Runs after the merge (2026-10-28).**

| Run | Result |
|---|---|
| Builder, equivalence and scale, `firstPaymentAsk`, route (AC-145), migration-text test, RC-15, range-cap, first-payment stamp, `lib/admin/billing`, repository | 15 suites, 589 tests, green. SC-1: 9.7 s (19,500 plan rows, 107,401 qualifying rows, 16 requests, 2,308 rows read; the machine was shared) |
| `supabase/migrations/__tests__` | 56 suites, 2,776 tests |
| `lib/business-os/finance` and `app/admin/finance` | 55 suites, 3,266 tests. Two UI suites (`exchangeRatesTab`, `chargeChecksRequest.pin`) failed under load and passed alone (31/31); this slice touches neither |
| `npm run test:authz-guard` | 2 suites, 203 tests |
| `typecheck:bos-llm` (8 GB) | Passed: 611 files, 11 errors, 0 new |
| Scoped tsc (8 GB, the slice's 15 TS files) | Exit 0, 0 errors, no OOM. A canary in `firstPaymentAsk.ts` gave TS2322 (exit 2); the file was restored and is identical to HEAD |
| `npm run lint:hooks` | Exit 0 |
| Not run | `npm run build`, `test:bos-entitlements`, `schema:check` (red until the view is applied) |

## SA Review Notes

### SA Workplan Review (SA-WP-M5F)

**Reviewed by SA — 2026-10-27** (worktree at `8967888c`; I read the events migration `20261027` and the exposed-views migration tests)
**Status:** ✅ Approved with conditions (M5F-C1 to M5F-C7). The production apply needs the user's go-ahead, which the coordinator is asking for.

**Fit.** The diagnosis is right:
- Paying % never used first payments (S0-6), so only F-K5b and MK-9 are at stake.
- Option (b) cannot be bounded on this project: aggregates are off (`PGRST123`) and there is no embed path.
- Option (c) on lineage changes the numbers (MK9-R2), and a new column would touch the money write path.
- An additive, read-only view is the smallest correct fix.

The design is also sound:
- One rule in one view, read through one dep, keeps SA-Q-MK9-1 intact.
- The builder change is confined to the MK-5b block, and `payingBreakdown.ts` and `convertedThisMonth.ts` are untouched.
- The payload hash staying at `38897cd3` is the right proof that no figure changed.

**SA-Q-M5F-16: the database design, reviewed by SA from first principles.** The skill file is not readable from my side either. I checked the design against the standing practices: index for the filter and the join, least privilege, short locks, guards first, and verification after apply.

| Point | Finding |
|---|---|
| Push-down | The view has no aggregate, DISTINCT or window function, so Postgres inlines it. Q1's `livemode` and `first_payment_at` range reach the base scan. The view's WHERE implies every condition in `paid_month_idx`'s predicate, so that partial index is usable. The `NOT EXISTS` subquery repeats `first_payment_idx`'s predicate, so each anti-join probe can be an index (often index-only) lookup. **Correct.** `GROUP BY min` would have scanned the mode's whole history on every load. |
| Q2 cost | Per asked id: that account's qualifying rows (about M) on `first_payment_idx`, each with one probe. That is O(M log N) per id. It is fine at M of 12 to 60, and bounded by 100 ids per request. |
| Tie-break | `id` is a **uuid**. `earlier.id < e.id` is a valid total order (deterministic, though not chronological). Two rows at the same instant give one row with the same `paid_at`, so the value equals the old read's. **Accepted.** |
| Least privilege | `security_invoker = true`. The base table keeps RLS with no client policy. The four revokes cover Supabase's default privileges in `public`, followed by one `GRANT SELECT` to `service_role`. Under `security_invoker`, `service_role` also needs SELECT on the base table, which it has (S0-8). There is no `SECURITY DEFINER`. **Correct.** |
| No `security_barrier` | **Correct.** It would block push-down, and only `service_role` can read the view. |
| Locks | A plain `CREATE INDEX` inside the transaction takes a SHARE lock and blocks inserts for the build time. The table is small and append-only, and Stripe retries a failed webhook. `lock_timeout = '5s'` bounds the wait for the lock, but **not the build itself**. See M5F-C2. |
| Write cost | Two more partial indexes on a low-write table, matching only `invoice_paid` rows with an amount. Negligible. |

**Rulings on §15**

| # | Ruling |
|---|---|
| M5F-1 | **Option (a).** |
| M5F-2 | **A view.** It keeps the query-builder shape, the paging and the ceiling, and raises no definer question. |
| M5F-3 | **The anti-join**, with the `id` tie-break (above). |
| M5F-4 | **Both indexes, built plainly inside the transaction**, with M5F-C2. |
| M5F-5 | **One dep with a query object:** one rule, one failure, one AC-145 key. |
| M5F-6 | **A new file, `firstPaymentAsk.ts`, holding a superset helper with a property test against the real `trialsToPaid`.** That keeps `payingBreakdown.ts` free for the parallel bundle. |
| M5F-7 | **Yes.** Either part failing makes both Unknown, as today. |
| M5F-8 | **Apply, then the checker, then merge. No runtime fallback.** In the gap the figures fail closed as Unknown, never 0. |
| M5F-9 | **Yes.** Sequential 100-id chunks. |
| M5F-10 | **Yes.** At most 31 days, because the only caller asks for this UTC month. |
| M5F-11 | **Yes.** A re-freeze of the calls only, with the restore proof; the hash is unchanged. |
| M5F-12 | **Yes.** It runs in the ordinary Jest job, bounded under 10 s locally, and is not on the `next build` path. If it is over 10 s in CI, reduce it to 100k rows, not drop it. |
| M5F-13 | **A dedicated fake.** `fakePostgrest.ts` and its five suites stay untouched. |
| M5F-14 | **Yes.** Log only, counts only. |
| M5F-15 | **Yes. `20261097`**, re-checked at Step 0 and again before the PR. **Superseded 2026-10-28:** main took `20261097` and `20261098` (applied on prod), so the view is renumbered to `20261099`. |
| M5F-16 | **Accepted,** with the review above as the record. |

**Conditions**
1. **M5F-C1, the view-name test:** extend the migration-text test so that it also fails if the view's column list ever includes `first_paid_at` (the stamp guard's word). Also assert that the view selects **only** `user_id, livemode, first_payment_at`, so no amount or invoice id is exposed.
2. **M5F-C2, the build-time bound:** add `SET LOCAL statement_timeout = '120s'` next to `lock_timeout`. Have the checker (or a pre-apply line) report the base table's row count. If it is ever above about 1M rows, stop and switch to `CREATE INDEX CONCURRENTLY` in separate statements outside the transaction, under a new ruling. At today's size, plain is correct.
3. **M5F-C3, the guards before DDL:** the guard block also refuses to run if `server_version_num < 150000`, because `security_invoker` needs PG15. Every failure message says "Nothing was applied".
4. **M5F-C4, the checker:**
   - C-6 and C-7 run over the whole base table and return counts only.
   - Add C-9: an `EXPLAIN` (never `ANALYZE`) of Q1's exact shape, as a separate read-only probe for the user to paste after `all_ok`. It reports whether the plan names `business_os_billing_events_paid_month_idx`. This is information, not part of `all_ok`.
5. **M5F-C5, isolation:** Q1 is the only cross-account read and is named `…AllAccounts`. It is called only from the all-businesses path. One business picked must never call it (MK5BFU-AC-5), and a builder test asserts that with a spy.
6. **M5F-C6, order with the follow-ups bundle (finfu2):**
   - `financeHealth.ts`: this slice edits only the MK-5b block, the dep type and the counts type. The bundle edits MK-9 and Comped. Different hunks.
   - `route.test.ts` AC-145: this slice's invariant is "**this slice does not change `EXPECTED_SHA256`**". If finfu2 merges first and moves the hash, take main in, and the hash this slice keeps becomes finfu2's. The equivalence test proves the bytes are unchanged on both paths whatever the base. Whoever merges second re-runs AC-145 and the pins.
7. **M5F-C7, process:**
   - The user's explicit go-ahead before any production apply, and `all_ok` before the merge.
   - Every pin hash (Pins A to D, AC-173, T-12) recorded at handover after the last edit.
   - FIN §0.4 updated at each stage.
   - No `console.*`.

**Business questions: none.** I agree with §16. The production apply is an operational go-ahead for the user, not a business decision.

### Approval
[x] Workplan approved with conditions M5F-C1 to M5F-C7. Proceed with the code. Production apply waits for the user's go-ahead.

### SA Code Review (SA-CR-M5F)

**Code Review by SA — 2026-10-27** (uncommitted worktree `neuronforge-mk5bfu` at `8967888c`; I read the full diff and every untracked file, and re-ran 11 suites myself: the migration-text test, equivalence and scale, `firstPaymentAsk`, the wiring, the repository, `financeHealth`, the finance route (AC-145), RC-15, both range-cap guards, and the stamp guard. **506/506 green.** SC-1 took 9.6 s under a loaded parallel run; it has no wall-clock assertion, only a 60 s timeout, so it cannot flake on time.)
**Status:** ✅ Code Approved with conditions (CR-M5F-1 and CR-M5F-2, both process steps; no code change is required)

**Correctness: the view against the old read.**
- **Same predicate.** The view's WHERE is exactly the old filter: `kind = 'invoice_paid'`, `amount_minor > 0`, `paid_at IS NOT NULL`, the mode, and `user_id IS NOT NULL`. The old read got that last condition implicitly from `.in('user_id', …)`.
- **Same value.** The anti-join keeps the row with no earlier qualifying row for the same account and mode. Ties at the same instant keep the smaller uuid `id`, so there is exactly one row and its `paid_at` is the same instant the old "keep the earliest" chose. The `earlier` side does not repeat `user_id IS NOT NULL`, but `earlier.user_id = e.user_id` already implies it.
- **Boosts excluded.** Boost money never enters `business_os_billing_events`: its `kind` CHECK has no boost kind, and boosts live in their own tables. The repository still names no boost table.
- **Both modes stay separate,** through the view column and `.eq('livemode', …)`.
- **The union is exact.** For all businesses, `convertedThisMonth` keeps only plan-row accounts whose first payment is in the month, and Q1 returns every such account. `trialsToPaid` looks up only trials that ended in `[start, end)` by `now`, and Q2 asks a strict superset of those (`trialAccountsToAsk` drops the `now` condition only). The superset property test runs against the real `trialsToPaid`. An account in both reads gets the same instant, and a disagreement is an error.
- **The decisive proof:** with real builders over the same seeds, the whole payload is byte-equal to the hash-pinned legacy copy across EQ-1 to EQ-11, and AC-145 `EXPECTED_SHA256` is unchanged at `38897cd3`.
- **One business picked** asks Q2 with exactly that id and `firstPaymentIn: null`. A spy asserts this at both the builder and the route (M5F-C5).
- **No plan rows** makes no call, and the figure is a real 0 of 0.

**Security and tenancy.**
- The view is `security_invoker = true` with no `security_barrier` and no `SECURITY DEFINER`.
- There are four revokes (`PUBLIC`, `anon`, `authenticated`, `service_role`), then a single `GRANT SELECT` to `service_role`.
- The in-transaction probe checks the following, and any failure rolls back the whole file:
  - the invoker option is set;
  - no client role holds any of the seven privileges;
  - `service_role` holds nothing beyond SELECT;
  - a real read succeeds under `SET LOCAL ROLE service_role` (precedent: 20261059).
- Checker C-4 and C-8 re-verify the grants after the apply. RLS on the base table is untouched.
- Q1 is the only cross-account read. It is named `…AllAccounts`, reached only from the admin finance route behind `requireAdmin`, and its rows are UUID-checked and range-checked.
- Q2 keeps the isolation error for any id that was not asked for. Every read goes through `lib/repositories/`.

**CLAUDE.md rules.**
- Pino only. There is no `console.*` in any touched product file.
- Logs carry counts only, never an id or a date. Two tests check this.
- No new API boundary, so no new Zod. The repository's guards (UUID, range, span, limits) play that role, as before.
- No `any`. The new `as unknown as FirstPlanPaymentViewRow[]` follows the existing pattern for an untyped PostgREST result.

**Migration safety.**
- **Guards first.** Every guard runs before any DDL: PG15, the base table, schema CREATE, free names, and service-role SELECT. Every RAISE says "Nothing was applied".
- **Re-running is safe.** A second apply refuses with "already exists". The rollback uses `IF EXISTS` and drops exactly the three objects; the text test pins it byte-for-byte.
- **Lock impact.** The two plain `CREATE INDEX` statements take a SHARE lock on `business_os_billing_events`. That blocks webhook INSERTs only while the index builds. On today's small, append-only table that is milliseconds. `lock_timeout = '5s'` bounds the wait for the lock, and `statement_timeout = '120s'` bounds the build (M5F-C2). Stripe retries a refused webhook. The rollback's `DROP INDEX` takes a brief ACCESS EXCLUSIVE lock under the same lock timeout.
- **Checker.** `base_rows` is reported, so the 1M-row trigger for `CONCURRENTLY` is visible. The checker is read-only, a single statement, and paste-safe (ASCII, no apostrophe in a comment, no trouble word), and the text test enforces all of that.
- **Operator cleanup functions.** The cleanup and anonymise functions (20261042 … 20261096) still DELETE rows and set `user_id` to NULL. A view over the table does not block either. A NULL `user_id` drops out of the view, exactly as it dropped out of the old `.in()`.

**Conditions M5F-C1 to C7: all met in code.**

| Condition | Verdict | Where |
|---|---|---|
| C1 (columns and stamp word) | ✅ | Text test: the SELECT list is exactly `e.user_id, e.livemode, e.paid_at AS first_payment_at`. It contains no `first_paid_at` and no amount, stripe, invoice, tier or currency name. A planted control is included. Checker C-3 pins the live signature |
| C2 (build-time bound) | ✅ | `SET LOCAL statement_timeout = '120s'` is set before the first `CREATE INDEX`. The 1M-row note is in the header, and the checker reports `base_rows` |
| C3 (guards and PG15) | ✅ | `server_version_num < 150000` refuses. All ≥10 RAISEs say "Nothing was applied" (asserted) |
| C4 (checker and EXPLAIN) | ✅ | C-6 is a full outer join against `GROUP BY min` and C-7 counts duplicates; both cover the whole table and return counts only. C-9 is a separate file: `EXPLAIN` only, never ANALYZE, outside `all_ok` |
| C5 (isolation) | ✅ | Spies at the builder and the route: one business picked → `{ accountIds: [id], firstPaymentIn: null }` |
| C6 (order with finfu2) | ⏳ at sync | **#541 (finfu2) has merged to main** (`7a2d541b`); this branch is 9 behind. Main changed `financeHealth.test.ts` (+28) and a comment in `payingBreakdown.ts`. The route test and the AC-145 hash did not move. See CR-M5F-1 |
| C7 (process) | ✅ so far | Pins recorded after the last edit, FIN §0.4 updated, no `console.*`. The go-ahead for the apply is still owed (CR-M5F-2) |

**D-2 ruling (RC-15 `ALLOWED` entry): approved.**
- `firstPaymentEquivalence.test.ts` names `BusinessOsAccountPlanRepository` only in the path of an `import type`. That is exactly the over-report the guard's header describes, and its prescribed remedy is "declare the file in `ALLOWED` with the reason". The entry is commented, sits beside the `financeHealth.test.ts` precedent, and does not widen the guard.
- The same test also imports values from `entitlements/source` and `entitlements/lifecycle`. Test files are exempt from `KNOWN_NON_GATE_IMPORTERS` (business-os-entitlements skill, tripwire 1), and `test:bos-entitlements` was run green, so no registration is needed.

**D-1, D-3 to D-6: accepted.**
- D-1: helpers outside `__tests__`, with `fakePostgrest.ts` as the precedent.
- D-3 and D-4: SC-1 at 19,500 plan rows is the right call. It keeps the plan walk's own cap out of the comparison and still proves the old path hits the ceiling.
- D-5: `inMonthAsked` as a boolean is fine. The repository line carries Q1's row count.
- D-6: an optimisation inside the fake only; the reference rule is unchanged.

**MK5BFU-FU-1 (the plan walk's 20,000-row cap):** I agree it is out of scope and correctly recorded. Past that cap the figures degrade to "at least", never to a wrong number or Unknown. It belongs in FIN §0.4 as its own row when TL next updates the follow-up list.

### Code Review Comments
1. `app/api/admin/business-os/finance/__tests__/route.test.ts` (the AC-145 restore proof): `callsBeforeFu1` is built from `EXPECTED_CALLS` itself, so "only that key differs" is true by construction and proves nothing on its own. The real proof is the git diff (one entry changed) together with the unchanged `EXPECTED_SHA256`. Optional hardening: hash the serialised restored map and compare it with a hash of main's map, as the finfu bundle did (`aebc22cb…`). — Priority: Low (non-blocking)
2. `lib/admin/billing/firstPlanPayments.ts`: the union builds `{ user_id, paid_at }` rows and then maps them a second time to `{ accountId, paidAt }`. One map would do. — Priority: Low (style)
3. `lib/business-os/finance/__tests__/firstPaymentEquivalence.test.ts:508`: SC-1 writes a timing line to `process.stdout` on every run. That is acceptable in a test and useful for M5F-12, but it adds noise to CI logs. Consider putting it behind an env flag. — Priority: Low (style)

### Conditions before merge
- **CR-M5F-1 (M5F-C6 sync):** before the PR, merge `origin/main` (which now includes #541) into this branch. Resolve `financeHealth.test.ts`, which should be additive. Then re-run the finance builder, the route (AC-145), the equivalence suite and the pins, and confirm `EXPECTED_SHA256` is still main's value. Re-check that `20261097` is still free on main; it was as of `7a2d541b`.
- **CR-M5F-2 (M5F-8 and C7 order):** the user's explicit go-ahead → paste the migration → run the checker and get `all_ok = true` → optionally run the C-9 EXPLAIN → `schema:check` green → merge. Until the view exists, Converted and MK-9 Paid fail closed as Unknown, which is accepted. **Not eligible for auto-merge before the apply.**

### Optimisation Suggestions
- After the apply, record the C-9 plan and `base_rows` in this workplan. That gives the 1M-row and `CONCURRENTLY` trigger a baseline.

### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-28** (worktree `neuronforge-mk5bfu`, branch `fix/finance-paying-first-payment-scale` at `fe66a311`; local commits `713e83fb`, `23b6eac0`, `fe66a311`; nothing pushed, nothing applied to any database)
**Test mode:** full
**Strategy used:** A (unit: wiring, ask helper, repository) + B (integration through the real builder, real wiring and real repository over the reference-view fake) + static review of the migration, rollback and checker (no database apply, by instruction)
**Focus:** api, schema, security, performance
**Skipped:** live apply and checker run (not allowed in this pass; owed by CR-M5F-2), `npm run build` and `schema:check` (red until the view exists, §6.5), browser check (no UI change)
**Input source:** prompt keywords (TL brief), checked against §9 and §10

### QA probe added (uncommitted, for Dev/RM to include)

`lib/business-os/finance/__tests__/firstPaymentScale.qa.test.ts` (22 tests). Real `buildFinanceHealth` → real `listCurrentModeFirstPlanPayments` → real `BusinessOsBillingAdminReadRepository` → `fakeFirstPaymentDb`, with a tamper hook that plants database answers the view can never give. It names no repository type (takes the plan-row type from `trialEndOf`), so RC-15 needs no `ALLOWED` entry; RC-15 was run green with it present.

### Test Coverage

| Acceptance criterion / brief item | Tested? | Result | Notes |
|---|---|---|---|
| Happy path: all businesses, exact figures | ✅ | Pass | QA probe, hand-computed: Converted 4, stopped 2; MK-9 ended 3, Paid 2, Paid-before-end 1; payload byte-equal to the frozen legacy read |
| Failure: the view read (Q1) fails | ✅ | Pass | Converted `unknown` (all nulls) **and** MK-9 Paid / Paid-before-end / rate null. QA probe + wiring test |
| Failure: the by-id read (Q2) fails | ✅ | Pass | Same Unknown. QA probe + EQ-11 |
| Failure: range over 31 days | ✅ | Pass | `AdminBillingReadGuardError`, **0 queries**, through wiring + repository (QA) and Q1-2 (31 days 00:00:01 refused; exactly 31 days in December allowed) |
| Failure: duplicate account (Q1 and Q2) | ✅ | Pass | `AdminBillingReadDuplicateError` → payload Unknown (QA), R-7, Q1-4 |
| Failure: row outside the month | ✅ | Pass | Payload Unknown (QA); Q1-4 plants both the next-month start and the last ms of the previous month |
| Failure: row for an account not asked for / no user / bad date | ✅ | Pass | Isolation error → payload Unknown (QA); R-8, R-9 |
| Failure: the two joined reads disagree | ✅ | Pass | Payload Unknown (QA); the same instant written two ways is not a disagreement (wiring test) |
| MK5BFU-AC-1 byte-identical payload | ✅ | Pass | EQ-1 (50 seeds), EQ-2 (1,750 accounts), EQ-3 (100/101/200/1,000/1,001/2,000), EQ-4, EQ-9, EQ-10, EQ-11 + QA probe, all against the hash-pinned legacy block `ac0ac49b…3e04` (asserted) |
| MK5BFU-AC-2 exact at scale (SC-1) | ✅ | Pass | Old read returns `AdminBillingReadCeilingError` (so Unknown, D-3); new path `ok` and equal to the oracle for Converted, stopped, MK-9 Paid, Paid-before-end, ended |
| MK5BFU-AC-3 bounded reads | ✅ | Pass | SC-1: every `limit` ≤ 1,000, every `in()` ≤ 100 ids, rows read ≤ asked ids + month rows and < 1/20 of history; SC-2: 20,000 first payments in one month → ceiling error, never 0 |
| MK5BFU-AC-4 one rule, both Unknown together | ✅ | Pass | Every QA failure case asserts Converted **and** MK-9 Paid Unknown |
| MK5BFU-AC-5 / C5: one business never runs Q1 | ✅ | Pass | QA: for each of 10 accounts (every state), a spy on `listFirstPlanPaymentsInRangeAllAccounts` is never called, exactly 1 query with `in = [that id]`, no `first_payment_at` filter, bytes equal to legacy. Also builder (spy), route (`{ accountIds: [ACCOUNT], firstPaymentIn: null }`) and EQ-10 |
| MK5BFU-AC-6 view security (static) | ✅ | Pass | See migration review below |
| MK5BFU-AC-7 checker on production | ⬜ | Not run | Owed after the user-approved apply (CR-M5F-2). Checker reviewed statically: read-only, one statement, `all_ok` column |
| MK5BFU-AC-8 AC-145 | ✅ | Pass | `EXPECTED_SHA256` = `38897cd3295ae0c5e865503cf0394453c38f532b0ec87866610126281b1e4edf`, the same line as `origin/main` (`b9dc16c7`). `git diff origin/main` on `route.test.ts`: the only `EXPECTED_CALLS` change is `'converted.firstPlanPayments'` (plus comments, the restore constant, and two MK-5b route assertions moved to the query object). Confirmed independently of the in-test restore proof (SA comment 1) |
| MK5BFU-AC-10 guards | ✅ | Pass | Range-cap source guard and tranche-A paging, finance source guard, first-payment stamp guard: green |
| MK5BFU-AC-11 no `console.*`, counts-only logs | ✅ | Pass | 0 `console.*` in the slice's TS files; R-10, Q1-5 and the builder log test |
| MK5BFU-AC-12 access unchanged | ✅ | Pass | No route change; `test:authz-guard` 203/203 |
| Edge: UTC month boundary | ✅ | Pass | `00:00:00.000Z` on the 1st is in, `23:59:59.999Z` on the last day of the previous month is out, `00:00:00.000Z` on the next 1st is out (QA, hand-checked); offsets across midnight in EQ corners |
| Edge: trial whose first payment fell in an earlier month | ✅ | Pass | Counted Paid and Paid-before-end, not in Converted (QA; EQ corners) |
| Edge: amount 0 | ✅ | Pass | A $0 row before the first paid one is ignored; first payment is the later paid row (QA) |
| Edge: livemode mixing | ✅ | Pass | An earlier live-mode payment is ignored in test mode (QA; EQ corners) |
| Edge: null user_id | ✅ | Pass | A detached paid row this month is never counted (QA); the view and both index predicates exclude it |
| Edge: same-instant ties | ✅ | Pass | Two rows at the same instant written with different offsets → one first payment, one Converted row (QA; EQ-5 corners; checker C-7) |

### Migration 20261099: static review

| Check | Result |
|---|---|
| Refuses on PG < 15 | ✅ `server_version_num < 150000` raises before any DDL, "Nothing was applied" |
| `statement_timeout` | ✅ `SET LOCAL statement_timeout = '120s'` (and `lock_timeout = '5s'`), before the first `CREATE INDEX` |
| Guards before DDL | ✅ base table present, no anon/authenticated CREATE on `public`, view and both index names free, service_role can read the base table |
| `security_invoker` | ✅ `WITH (security_invoker = true)`; no `security_barrier`, no `SECURITY DEFINER`; the in-file probe re-checks the option |
| Grants | ✅ `REVOKE ALL` from PUBLIC, anon, authenticated, service_role, then a single `GRANT SELECT … TO service_role`; the probe fails the transaction if any client role holds any of 7 privileges, or service_role holds more than SELECT, and reads the view as service_role |
| View rule | ✅ `invoice_paid`, `amount_minor > 0`, `paid_at IS NOT NULL`, `user_id IS NOT NULL`, anti-join with `(paid_at, id)` tie-break; selects only `user_id, livemode, first_payment_at` |
| Rollback | ✅ `DROP VIEW IF EXISTS public.business_os_first_plan_payments` + `DROP INDEX IF EXISTS` for `…_paid_month_idx` and `…_first_payment_idx`, in one transaction under `lock_timeout`; nothing else |
| Checker | ✅ `SET default_transaction_read_only = on;` then one `WITH … SELECT` (2 `;` in the file); no write keyword outside a string literal; ASCII only; no "into"; returns C-1..C-8, `base_rows`, `view_rows` and `all_ok` |
| Stale `20261097` | ✅ None for this view. Remaining hits are main's own `20261097_a_session_knows_what_it_replaced` (code comments), history rows marked superseded in this workplan and FIN §0.4, and SA's original CR-M5F-1 wording (historical) |
| Number still free | ✅ After `git fetch` (origin/main `b9dc16c7`, #560): highest on main is `20261098`; no remote branch holds `20261099` or later |
| Migration-text test | ✅ `bos-first-plan-payments-view.migration.test.ts` green (also inside `test:bos-entitlements`) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. SC-1 (19,500 plan rows, about 107k qualifying rows) is bounded and passed inside its 60 s timeout under a loaded parallel run.

#### Edge Cases (nice to fix / notes)
1. **Main moved again** (Low, process). `origin/main` is 2 commits ahead (#560, P-8b.3a: `lib/admin/billing/subscriptions*`, `billingPanelView.ts`, `app/admin/finance/**`, the subscriptions route, `planReconcilePass.ts`). `git merge-tree` shows a clean merge and no overlap with this slice's files. After merging it before the PR, re-run `lib/admin/billing`, `app/admin/finance`, the finance route (AC-145) and the equivalence suite.
2. **Sub-millisecond ties** (Informational). The view picks the true minimum at microsecond precision; the old read compared `Date.parse` (milliseconds). They could differ only if one account has two qualifying payments inside the same millisecond. Stripe's `paid_at` is whole seconds, so this cannot happen in practice. Figures could not move anyway, because every comparison downstream is in milliseconds.
3. **SC-1 proves the old path fails at the read, not through the builder** (Informational, D-3 accepted by SA). EQ-11 and the QA probe close the gap: a failed first-payment read gives Unknown through the builder on both paths.
4. **Out of scope:** MK5BFU-FU-2 (a D3.1 after-cancel free period counted in MK-9) and MK5BFU-FU-1 (the plan walk's 20,000-row cap) were not tested, as briefed.

### Test Outputs / Logs

| Run | Result |
|---|---|
| Targeted: builder, equivalence and scale, `firstPaymentAsk`, finance route (both suites), `lib/admin/billing` (5), repository, range-cap source guard + tranche-A paging, first-payment stamp guard, RC-15, finance source guard, migration-text test | 17 suites, **2,005 / 2,005** (43 s) |
| QA probe `firstPaymentScale.qa.test.ts` | **22 / 22**; with RC-15 re-run beside it: 60 / 60 |
| `lib/business-os/finance` + `app/admin/finance` (including the QA probe; `exchangeRatesTab.render` and `chargeChecksRequest.pin.render` passed first time) | 56 suites, **3,288 / 3,288** |
| `npm run test:bos-entitlements` (includes `lib/repositories/__tests__` and `supabase/migrations/__tests__`) | 327 suites, **9,755 / 9,755** |
| `npm run test:authz-guard` | 2 suites, **203 / 203** |
| `typecheck:bos-llm` (`NODE_OPTIONS=--max-old-space-size=8192`) | Exit 0: 612 files in scope, 11 errors, **0 new** |
| Scoped `tsc` (8 GB) over the slice's 15 TS files plus the QA probe | Exit 0, **0 errors**. A canary (a `string[]` assigned to `number` via `trialAccountsToAsk`) gave TS2322 and exit 2, so the run really checks |
| `npm run lint:hooks` | Exit 0 |
| `console.*` in the slice's TS files | 0 |

### Final Status
- [x] All acceptance criteria that can be tested before the apply pass. **QA verdict: PASS.** No bugs. AC-7 (the production checker `all_ok`) is still owed under CR-M5F-2: the user's go-ahead, then apply, then the checker, then merge. Not eligible for auto-merge before the apply.
- [ ] Issues found — Dev must address before commit

## Commit Info

| Item | Value |
|---|---|
| Branch | `fix/finance-paying-first-payment-scale` |
| Commits | `713e83fb` (fix), `23b6eac0` (merge origin/main `abe9fd64`), `fe66a311` (docs: renumber + sync), `a5f3e959` (test: QA probe + QA report), `5a7ec971` (merge origin/main `b9dc16c7`, #560; clean) |
| Re-run after the second sync | `lib/admin/billing` + finance routes (AC-145, `EXPECTED_SHA256` `38897cd3…` equal to main) + `firstPaymentEquivalence` + QA probe: 11 suites, 291 / 291. `app/admin/finance`: 33 suites, 989 / 989. 20261099 still free on origin/main |
| PR | [#562](https://github.com/AgentsPilot/neuronforge/pull/562), **open, awaiting migration apply**. Not on auto-merge (CR-M5F-2) |
| Merge gate | The user's go-ahead, then apply `supabase/migrations/20261099_business_os_first_plan_payments_view.sql` on prod, then run `scripts/check-bos-first-plan-payments-migration.sql` and confirm `all_ok = true`, then `schema:check` green, then merge (merge commit) |
| Merge commit | *(pending)* |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-27 | Created (Dev) | Workplan for MK5B-FU-1 (item 8). Step 0 facts at `8967888c`, live limit-0 probes, the cost model, options (a), (b) and (c) compared; recommends (a), a read-only `security_invoker` anti-join view with two partial indexes (an additive production migration). AC-145 calls-only re-freeze with the hash unchanged; other pins fixed. SA-Q-M5F-1 to 16 |
| 2026-10-27 | SA workplan review (SA-WP-M5F) | Approved with conditions M5F-C1 to M5F-C7. Option (a) view with anti-join, security_invoker, service role only; the DB design reviewed by SA (push-down, partial-index predicates, uuid tie-break, grants, locks). Added: statement_timeout and a row-count note, a PG15 guard, a read-only EXPLAIN probe, view column pins, and the AC-145 order rule with finfu2. No business questions; the production apply needs the user's go-ahead |
| 2026-10-27 | Implemented (Dev) | Migration 20261097 (renumbered `20261099` on 2026-10-28), rollback, checker, EXPLAIN probe, migration-text test (M5F-C1 to C4); repository Q1 and Q2 on the view; wiring; `firstPaymentAsk.ts`; builder; equivalence and scale tests (SC-1 about 7 s); AC-145 calls-only re-freeze with the hash unchanged at `38897cd3`; Pins A to D, AC-173 and T-12 unchanged. D-1 to D-6; MK5BFU-FU-1 (plan walk cap) recorded. Nothing applied to production |
| 2026-10-27 | SA code review (SA-CR-M5F) | Code approved for QA with conditions CR-M5F-1 (sync with main, which now includes #541, and re-run AC-145 and the pins) and CR-M5F-2 (go-ahead → apply → checker `all_ok` → merge; no auto-merge before the apply). M5F-C1 to C5 and C7 verified in code; C6 is due at the sync. D-2 (RC-15 `ALLOWED` entry) approved; D-1 and D-3 to D-6 accepted. 506/506 green on SA's re-run. Three Low, non-blocking comments |
| 2026-10-28 | CR-M5F-1 sync (Dev) | Migration renumbered `20261097` → `20261099` (main took 20261097 and 20261098). Committed locally `713e83fb`; merged origin/main `abe9fd64` in `23b6eac0`; one docs conflict (FIN Change History), both rows kept. 20261098 reviewed: no effect on the view or the equivalence; a meaning change in MK-9 from D3.1 recorded as MK5BFU-FU-2 (proposed). Re-runs green; `EXPECTED_SHA256` equals main; only `converted.firstPlanPayments` differs; pins unchanged |
| 2026-10-28 | QA (full) | **PASS, no bugs.** The QA probe `firstPaymentScale.qa.test.ts` (22 tests, uncommitted) covers every failure path through the real builder, wiring and repository: Q1 fails, Q2 fails, more than 31 days, a duplicate, out of range, not asked for, no user, a bad date, the two reads disagree. Each one leaves Converted and MK-9 Paid Unknown. It also checks the hand-computed edge cases and that one business picked never runs Q1 (C5), byte-equal to legacy. AC-145 hash `38897cd3…` equals main, and only that one calls entry differs. Migration 20261099, its rollback and checker were reviewed statically: no stale 20261097, and the number is still free after fetching main `b9dc16c7`. Results: targeted 2,005/2,005; finance lib and UI 3,288/3,288; `test:bos-entitlements` 9,755/9,755; authz 203/203; `typecheck:bos-llm` 0 new; scoped tsc 0 errors with a canary; `lint:hooks` clean. Notes: main is 2 commits ahead (#560), with a clean merge, so re-run the suites after merging. AC-7 (the production checker) is owed under CR-M5F-2 |
| 2026-10-28 | RM: committed and PR opened | QA work committed `a5f3e959`; origin/main (#560) merged cleanly in `5a7ec971`; re-runs green (291/291 and 989/989; AC-145 hash unchanged); 20261099 still free. PR #562 open, awaiting the migration apply; no auto-merge (CR-M5F-2) |
