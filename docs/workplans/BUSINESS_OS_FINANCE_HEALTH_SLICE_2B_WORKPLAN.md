# Workplan: Business OS Finance & Business Health — Slice 2b (Client payment problems)

> **Last Updated**: 2026-10-12

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md), slice **2b** (§0.1, §0.3 SA-Q13 to SA-Q19 and SA-W18 to SA-W27, §11A.0, §11A.2, §11A.3, §11A.5, §11A.7 to §11A.10, §12, §13 checks 10 to 13, "SA Requirement Review — Slice 2"). BD-13 holds: every layer-B row is shown and treated as real.
**Live facts:** [BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md) (cited as **LC**).
**Builds on:** slice 2a, merged as PR #312. [2a workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md) · [2a retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_RETROSPECTIVE.md). Reused from 2a: `currencyGroups.ts` (`groupByCurrency`, `toHundredths`, `normaliseCurrencyCode`), the `toMoney` rule (divide by 100 once), `formatMoney`, the `FinanceSection` `badge` prop (SA-W24), the finance source guard's positive table pin (SA-WR-16), and the 2a pager in the finance read repository.
**Layout standard:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md). The new block uses the shared parts. 2b builds the deferred shared export `formatUtcDate`, so this slice runs the **full cycle** (R-7, SA-Q18). The page shell is **not** migrated (DF-4).
**SA rulings implemented:**
- SA-Q14: R-j is injected from the route, has an explicit 2 s deadline, shows plain figures, and is never called with a business picked.
- SA-Q15: keyset on `id`, page 1,000, ceiling 5,000, rows plus `reachedCeiling`; `.or()` on a SELECT only, built from literals and the validated date.
- SA-Q16: the three Stripe guards are not tripped; they are run unchanged.
- SA-Q17: one route; `durationMs` is recorded.
- SA-Q18: shared parts through the alias, and `formatUtcDate` in `adminFormat.ts`.
- Findings S2-F1 (2b tables join the pin), S2-F3, S2-F5 (date-only, AC-74), S2-F6, S2-F7 and S2-F9.
- The "For 2b" line of the SA slice-2 review.

Still in force from earlier slices: SA-W1 / AC-42, SA-WR-3, SA-WR-4, SA-WR-5, SA-WR-7, SA-W22, SA-W24 and SA-W26.
**Date:** 2026-10-12
**Branch:** `feature/bos-finance-health-2b`, cut by RM from `main` `045a4d06` (the 2a merge). Confirmed with `git branch --show-current` in worktree `neuronforge-finance-health`. `node_modules` is a junction to the main checkout. Never `git worktree remove`, never `git stash`, never commit: RM commits after the user has seen the diff.
**Status:** Code Complete. Uncommitted; awaiting the SA code review.

## Overview

Slice 2b adds **Section 6 block B, "Client payment problems"**: where the businesses' clients are not paying. It has five parts, and each part has its own status:

1. **Failed client payments.** A fixed "not available" panel with no read behind it, never a 0. It also says whether any client plan charge failure has ever been stored.
2. **Overdue invoices**, as of now.
3. **Overdue or past-due instalments**, as of now.
4. **Client plans:** active now, cancelled and completed in the window, and next charge overdue.
5. **Reminder health:** the Jobs & queues figures for `payment_reminders`, linked to `/admin/jobs-queues#queues`, and skipped when a business is picked.

The block is **the businesses' problem, not ours** (BD-2). Every amount is the full invoice or instalment amount, never the amount still owed, and is shown per currency. No amount is ever added across currencies.

2b adds six named reads to `BusinessOsFinanceReadRepository`: **R-g, R-g′, R-h, R-h′, R-i, R-i′**. It reuses `AdminJobsQueuesRepository.readQueueFiguresAllAccounts` (**R-j**), injected from the route. It builds the shared **`formatUtcDate`**. There is no migration, no SQL function, no write, no LLM call, no audit entry, no new query parameter and no KPI tile.

Thirteen points need an SA ruling before code (SA-W28 to SA-W40, [below](#questions-for-sa-before-code)). Four of them are gaps between the requirement and the code:
- SA-W30: the sort order of the overdue tables;
- SA-W31: the status of the block frame;
- SA-W32: the `formatUtcDate` output format;
- SA-W34: two selected columns that no figure uses.

None of the thirteen reopens a business decision.

---

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify](#files-to-create--modify)
- [The reads: R-g to R-i′](#the-reads-r-g-to-r-i)
- [The reminder read: R-j reused](#the-reminder-read-r-j-reused)
- [Date-only due dates and `formatUtcDate`](#date-only-due-dates-and-formatutcdate)
- [The payment problems builder](#the-payment-problems-builder)
- [The builder, the wiring and the route](#the-builder-the-wiring-and-the-route)
- [With a business picked (AC-65, AC-42 re-run)](#with-a-business-picked-ac-65-ac-42-re-run)
- [Failure matrix](#failure-matrix)
- [The page](#the-page)
- [Guard table, line by line](#guard-table-line-by-line)
- [AC mapping](#ac-mapping)
- [Verification plan](#verification-plan)
- [Logging](#logging)
- [Risks](#risks)
- [Estimate](#estimate)
- [Task List](#task-list)
- [Implementation Notes](#implementation-notes)
- [SA Workplan Review](#sa-workplan-review)
- [SA Code Review](#sa-code-review)
- [QA Report](#qa-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

I opened every file below at `045a4d06` in this worktree. Line numbers are from that tree.

| Claim | Where |
|---|---|
| The finance repository header: "WHY A SEPARATE REPOSITORY", layer-B paragraph (writers named in words only), ACCOUNT SCOPE list, LIVE MODE (layer A only), PAGING | `lib/repositories/BusinessOsFinanceReadRepository.ts:9-25`, `:34-47`, `:49-54`, `:56-60` |
| `FINANCE_READ_LIMITS`: `CLIENT_PAGE_SIZE: 1000`, `CLIENT_CEILING: 5_000` already exist (2b needs no new key) | `BusinessOsFinanceReadRepository.ts:90-97` |
| The 2a column constants and row types; the read result `{ rows, reachedCeiling }`; `FinanceClientRange`; `FinanceClientReadOptions` | `BusinessOsFinanceReadRepository.ts:103-156` |
| `ClientQuery` type, `UUID_PATTERN`, `FinanceReadGuardError`, `fail` (warn for a guard refusal, error otherwise) | `BusinessOsFinanceReadRepository.ts:159`, `:161`, `:163-168`, `:192-199` |
| The 2a public methods each pass their own literal `.from('<table>')` to the private pager (D-3) | `BusinessOsFinanceReadRepository.ts:319-381` |
| The private pager `pageClientRows`: account id, range and option checks inside `try`; `start().gte(col).lt(col)`, then `.eq('user_id')`, then `.gt('id')`, `.order('id')`, `.limit`; `>=` ceiling returns rows with `reachedCeiling`; log label chosen by `dateColumn` | `BusinessOsFinanceReadRepository.ts:391-454` (`:401-415` checks, `:424-427` the chain, `:432-435` ceiling, `:441-449` logs) |
| The repository test's recording client: method list `select, eq, not, gt, gte, lt, order, limit, maybeSingle` (2b adds `or`) | `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts:52-77` (`:61`) |
| `FINANCE_READ_LIMITS` equality pin (unchanged in 2b) | `BusinessOsFinanceReadRepository.test.ts:101-106` |
| The 2a layer-B `describe.each` (exact table, columns, `gte`/`lt`, order, page) | `BusinessOsFinanceReadRepository.test.ts:318-438` |
| No-write pin, no-aggregate pin, money-writer names pin, one-caller pin (text match on `BusinessOsFinanceReadRepository`) | `BusinessOsFinanceReadRepository.test.ts:447-495` (`:469-494` one caller) |
| SA-WR-19 writer-names-in-words test: `PaymentRepository`, `PaymentRefundRepository`, `PaymentPlanSubscriptionRepository` | `BusinessOsFinanceReadRepository.test.ts:497-510` |
| Payment repositories that exist (the writers / owner-scoped readers of the 2b tables): `PaymentRepository` (invoices), `PaymentPlanRepository`, `PaymentPlanSubscriptionRepository`, `PaymentReminderRepository` | `lib/repositories/` listing |
| The finance source guard: `FILES` (walks `lib/business-os/finance` and `app/admin/finance`, so new files join automatically), `REPOSITORY`, `LAYER_B_FREE` | `lib/business-os/finance/__tests__/finance.source.guard.test.ts:49-60` |
| The layer-B-free rule (`payment_transactions\|payment_refunds\|payment_plan_`) | `finance.source.guard.test.ts:102-104` |
| The positive table pin: `FROM_LITERAL`, `FROM_ANY`, `tablesOf`, `fromCallsOf`, planted controls, the five-table set, `not.toContain('payment_reminders')`, planted extra | `finance.source.guard.test.ts:216-258` |
| `LAYER_B_METHODS` and the `bodyOf` slicer (no `livemode` in a layer-B body) | `finance.source.guard.test.ts:261-294` |
| `FinanceHealthDeps.finance` Pick (gains six methods); `findNames` injected by the route | `lib/business-os/finance/financeHealth.ts:124-169` (`:135-144`, `:146`) |
| `FINANCE_LIMITS` (gains `OVERDUE_ROWS_SHOWN`, `REMINDER_DEADLINE_MS`) | `financeHealth.ts:99-111` |
| `FinanceHealthCounts` (gains `paymentProblems`) | `financeHealth.ts:180-216` |
| The picked-business check first; the settled `Promise.all` (gains three reads) | `financeHealth.ts:259-269`, `:307-352` |
| The takings names pattern (ids from rows read only, platform labelled, NULL id → unknown business) | `financeHealth.ts:479-511` |
| The payload assembly | `financeHealth.ts:581-603` |
| The wiring returns `Omit<FinanceHealthDeps, 'findNames'>`; its `finance` block | `lib/business-os/finance/financeHealthDeps.ts:95-131` (`:108-120`) |
| `FinancePayload` (gains `paymentProblems`); `FinanceSectionStatus` | `lib/business-os/finance/financeTypes.ts:167-179`, `:25` |
| The route: `requireAdmin` first, the `correlationId`, `gate.user.id`, the deps spread plus the injected `findNames`, the one info line | `app/api/admin/business-os/finance/route.ts:99-107`, `:141-145`, `:158-181` |
| The route test: `mockDeps`, the `financeHealthDeps` mock, `allReads()` (AC-45 / AC-46 cover every function in it) | `app/api/admin/business-os/finance/__tests__/route.test.ts:63-96`, `:222-233` |
| The admin jobs & queues repository: `DEAD_LETTER_MARKER`, `STUCK_AFTER_SECONDS = 90 + 10 * 60`, `ADMIN_QUEUE_SPECS.payment_reminders` | `lib/repositories/AdminJobsQueuesRepository.ts:48`, `:54`, `:78-90` |
| `RawQueueFigures` (the fields R-j returns), `AdminReadOptions { signal }` | `AdminJobsQueuesRepository.ts:201-223` |
| `readQueueFiguresAllAccounts(context, queue, now, options)`: context required (`requireContext`), `abortSignal` on every query, never throws, logs counts only | `AdminJobsQueuesRepository.ts:420-575`, `:374-379` |
| The isolation guard: no file outside `app/api/admin/**` (tests, barrel and the file excepted) names `AdminJobsQueuesRepository` or `adminJobsQueuesRepository`, **matched on the text, import paths included** | `lib/repositories/__tests__/AdminJobsQueuesRepository.test.ts:234-262` |
| `adminReadMethods.guard`: an explicit method list without `readQueueFiguresAllAccounts` | `lib/repositories/__tests__/adminReadMethods.guard.test.ts:479-490` |
| The injection precedent: the route binds `{ correlationId, adminId }` and injects a structural reader | `app/api/admin/health-summary/route.ts:149`, `:163-171` (`:167-168`) |
| The structural reader type in `lib/` (names no repository) and `underDeadline` per queue | `lib/admin/jobs/readJobsQueues.ts:37-50`, `:114-115` |
| `underDeadline(read, timings, run, deadlineMs = ADMIN_READ_DEADLINE_MS)`, `ADMIN_READ_DEADLINE_MS = 5000`, the signal aborted at the deadline, timer cleared | `lib/admin/readUnderDeadline.ts:17`, `:41-85` |
| `todayUtc(now)`, `isRealDate(value)` (UTC-anchored `Date.parse('…T00:00:00.000Z')`), `inclusiveDays(from, to)` | `app/admin/components/adminWindowPresets.ts:41-55` |
| `formatUtcDate` is not built yet; `adminFormat.ts` exports `formatUtc`, `formatCount`, `formatUtcTime` | `app/admin/components/layout/adminFormat.ts:7`, `:19-44` |
| Layout folder guard: `EXPECTED_SOURCES` (no new file in 2b), the S-3 allow-list with the one presets exception, the migrated-pages registry (finance not in it) | `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts:84-101`, `:121-135`, `:472` |
| §5.11 "Date: `YYYY-MM-DD`" | `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md:625-634` |
| `formatShortId(id)` and `ADMIN_TD_ID` (short id in the cell, full id in `title`) | `app/admin/components/layout/adminTable.ts:36-37`, `:57-60` |
| `StatusChip` tones `warn`, `unknown`, `neutral` | `app/admin/components/layout/StatusChip.tsx:25-28`, `:40-48` |
| `FinanceSection`: `unknown` replaces the children with "Could not load this section" (why the block frame must never be `unknown`, SA-W31) | `app/admin/finance/components/FinanceSection.tsx:39-80` (`:71`) |
| The page order (block goes after `CreditsSection`) | `app/admin/finance/components/FinanceView.tsx:91-99` |
| `formatMoney` (exactly two decimals, the code always shown) | `app/admin/finance/financeFormat.ts:15-18` |
| The page guard: imports from `lib/business-os/finance/` are type-only, one line each | `app/admin/finance/__tests__/source.guard.test.ts:44-52` |
| The date-only lesson (INV-00013): render in UTC, never `new Date(due)`, never noon UTC | `lib/payments/__tests__/dateOnlyIsNotMidnightUTC.guard.test.ts:1-70` |
| `payment_invoices`: `user_id NOT NULL … CASCADE`, `amount DECIMAL(10,2)`, `currency TEXT DEFAULT 'USD'` (nullable), `status` (no CHECK), **`due_date DATE` nullable**, `notes`, `internal_notes`, `line_items` (never selected) | `supabase/migrations/20260722_create_payment_tables.sql:7-35` |
| `payment_plan_installments`: `amount DECIMAL(10,2)`, `currency NOT NULL`, **`due_date DATE NOT NULL`**, `status` default `pending` (comment: pending, paid, overdue, cancelled), `contact_id` (never selected) | `supabase/migrations/20260723_enhance_payments.sql:139-160` |
| `payment_plan_subscriptions`: `status` CHECK `pending, active, past_due, paused, completed, cancelled`; `next_charge_at`, `last_failure_at`; card and Stripe columns (never selected) | `supabase/migrations/20260828e_payment_plan_subscriptions.sql:28-80` (`:61-62`) |
| `payment_plan_installments.subscription_id` added later | `supabase/migrations/20260828e_payment_plan_subscriptions.sql:135-145` |
| Live: invoices 140 (overdue 16, sent 5, none past due); instalments 59 (overdue 1, **pending past due 2**, due 2026-10-05); plans 6 (active 5, cancelled 1); reminders 188 (none processing, none failed); no failure or retry field set anywhere | LC §1, §3, §5 |
| Stripe placement guards scan only named files (`routerPlacement`: the webhook route; `planSurfaces`: named files; `invoiceIntentsStayUnowned`: `PaymentRepository` and the Stripe routes) | `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts:27-28`, `:295-298`, `:466-470`; `lib/payments/__tests__/planSurfaces.guard.test.ts:17-181` |
| `test:bos-entitlements` includes `lib/repositories/__tests__`; `test:authz-guard`; `lint:hooks` | `package.json:20`, `:23`, `:25` |

`console.*` count in every file to modify: **0**. I grepped the repository, the barrel, `lib/business-os/finance/*.ts`, the route, every `app/admin/finance` file and `adminFormat.ts`. The CLAUDE.md flag-and-convert rule has nothing to convert.

**Schema (business-os-schema-check).** Every column selected by R-g to R-i′ is listed live in LC §1 (OpenAPI, 2026-10-11), except `id`, which every one of these tables has as its primary key in the migrations above. SQL checks 10 to 12 name every selected column except `id` and `subscription_id`. `npm run schema:check` cannot see selects that pass exported column constants, and the worktree has no credentials (2a, SA-W27). V-10 records the result or the note either way.

---

## Scope

This is exactly the 2b row of requirement §11A.0.

| In 2b | Out (later, or not at all) |
|---|---|
| R-g, R-g′, R-h, R-h′, R-i, R-i′ in `BusinessOsFinanceReadRepository`; R-j reused, injected from the route | Platform payment problems (block A, slice 7) |
| Section 6 block B, "Client payment problems" (S2-FR-15 to S2-FR-26): failed payments panel, overdue invoices, overdue instalments, client plans, reminder health | Any KPI tile (§11A.6) |
| The shared `formatUtcDate` (full cycle, R-7; date-only, S2-F5, AC-74) | The page shell, URL renames, `useAdminFilters` (DF-4) |
| Date-only due-date helpers (`dueDates.ts`) | Filtering out test businesses (DF-3); a `livemode` for layer B (FU-2a-7) |
| The finance source guard: the table pin grows to eight tables; new rules with planted controls | Any change to `AdminJobsQueuesRepository`, `readJobsQueues` or Jobs & queues |
| ACs tagged 2b, and re-runs of AC-45, AC-46 and AC-68 to AC-73 over the 2b diff | Any change to the 2a takings logic or block |

---

## Questions for SA before code

Each question has a recommendation, which I build unless SA rules otherwise. Numbering continues from 2a (SA-W27).

| # | Issue | Recommendation |
|---|---|---|
| **SA-W28** | **One pager for every layer-B read.** The 2a private pager (`BusinessOsFinanceReadRepository.ts:391-454`) takes a `dateColumn` and a range. R-g / R-h need an `.or()` with today's date instead, and R-i needs no filter at all. | **Generalise the pager, without changing its behaviour.** It takes `prepare: () => (query) => query`, called **inside** its `try`, so a refused argument is still `{ data: null, error }` and never a throw. It also takes the log noun. For the 2a methods, `prepare` checks the range and returns `q.gte(col, from).lt(col, to)`. The chain order stays filter, then `.eq('user_id')`, then `.gt('id')`, then `.order`, then `.limit`, and the 2a log messages stay word for word. **The 2a T1 tests are not edited and must pass.** That is the proof. The alternative is a second pager, which would copy about 40 lines of keyset and ceiling logic. |
| **SA-W29** | **What "a reminder status literal" means in AC-61.** The reminder vocabulary (`pending, processing, sent, failed, cancelled`, `AdminJobsQueuesRepository.ts:81`) overlaps the invoice and instalment vocabulary that R-g and R-h must filter on (`sent`, `pending`, SA-Q15). `'failed'` is already in `financeHealth.ts:300` (the credit pass outcome). | **The AC-61 rule, over every finance file (`FILES`):** <br>• No `STUCK_AFTER_SECONDS`, `DEAD_LETTER_MARKER`, `ADMIN_QUEUE_SPECS`, `dead-letter`, `'processing'`, `claimed_at`, `error_message`, `690` or `90 + 10`. <br>• No file but the route names `AdminJobsQueuesRepository`, `adminJobsQueuesRepository` or `readQueueFiguresAllAccounts`. This is a positive pin: the namers are exactly `[route.ts]`. <br>• The literals `'sent'` and `'pending'` appear only in the repository (the R-g / R-h filters) and in `paymentProblems.ts` (the invoice, instalment and plan vocabularies). This is also a positive pin with a planted control. |
| **SA-W30** | **The sort order of the overdue tables, against S2-CUR-5.** S2-FR-17 / S2-FR-18 say "sorted by due date, oldest first". S2-CUR-5 says any list holding several currencies is "sorted by currency first". Both cannot hold. | **Sort by due date, oldest first** (NULL due dates last, then `id`). Sorting by date ranks no money across currencies, which is what S2-CUR-5 and BD-12 protect against. Every amount cell still names its currency. The per-currency lines above the table stay sorted by currency. **BA edit E-11:** append to S2-CUR-5: "A list sorted by a date (the overdue invoice and instalment tables) keeps its date order; no amount is compared across currencies." |
| **SA-W31** | **The block frame's status.** S2-FR-15 gives each of the five parts its own status, and S2-FR-23 says one failed read fails only its part. But `FinanceSection` in `unknown` replaces **all** its children with "Could not load this section" (`FinanceSection.tsx:71`). | **The block frame is never `unknown`.** The fixed failed-payments panel always renders. The frame is `partial` when any read part is `partial` or `unknown`, and `ok` otherwise. Each part shows its own status as a page-local part heading with a `StatusChip` (`ok`, `warn` for partial, `unknown` for "Could not load this part"), plus its own Retry-free sentence. Retry stays on the page. No change to `FinanceSection`. |
| **SA-W32** | **The `formatUtcDate` output, against AC-74.** AC-74 says 2026-09-30 "renders as 30 September". The layout standard §5.11 (`:625-634`) says a date is `YYYY-MM-DD`, and every admin page follows it. | **`YYYY-MM-DD`, per §5.11.** I read AC-74 as "the same calendar date, not 29 September". `formatUtcDate(value)` accepts a **date-only** string only. A real `YYYY-MM-DD` (checked with `isRealDate`, the S-3 presets exception) is returned as that same text. Anything else, NULL and full timestamps included, gives "—". It never calls `new Date`. **BA edit E-12:** AC-74 "renders as 30 September" becomes "renders as `2026-09-30` (never `2026-09-29` or `2026-10-01`)". |
| **SA-W33** | **Date-only arithmetic without `new Date(due_date)`.** S2-F5 forbids passing `due_date` through `new Date`. "Days past due" still needs a day difference. | **Reuse the presets helpers.** `todayUtc(now)` gives today (`now` is an instant). Past due is the string comparison `due < today`, done only after `isRealDate(due)`. Days past due is `inclusiveDays(due, today) - 1`. These helpers build the date at an explicit `T00:00:00.000Z` and read it back in UTC: the anchor `dateOnlyIsNotMidnightUTC` endorses ("built in UTC, read back in UTC"). They live in a new pure `dueDates.ts`. A source rule forbids `new Date(` and `Date.parse(` in `dueDates.ts` and in `formatUtcDate`'s body. A due date that is not a real date is "unknown": it is counted, and never past due by accident. |
| **SA-W34** | **Two selected columns no figure uses.** §11A.7 selects `subscription_id` in R-h and `currency` in R-i. Nothing in S2-FR-18 / S2-FR-19 reads them: client plans carry no amount, and an instalment is identified by its own short id. | **Drop both** (schema-check rule 5, a dead select). This means less data travels, and AC-64 is unaffected. **BA edit E-13:** in §11A.7, R-h columns `id, user_id, amount, currency, status, due_date`; R-i columns `id, user_id, status, cancelled_at, completed_at, next_charge_at, last_failure_at`. If SA prefers to keep the requirement's lists unchanged, I select them and pin them unused. |
| **SA-W35** | **The reminder figures' type.** The isolation guard matches the repository name **in the text, import paths included** (`AdminJobsQueuesRepository.test.ts:255-260`). So a finance `lib/` file cannot `import type { RawQueueFigures }` from it. | **A structural `FinanceReminderFiguresInput` in `paymentProblems.ts`** (the `readJobsQueues.ts:37-50` precedent). It holds `dueNow, inProgress, stuck, failed24h, failed7d, deadLettered24h, deadLettered7d` (non-negative integers) and `oldestDueAt` (ISO or null). The pure mapper checks each field. A malformed result makes the part `unknown`, never a 0. The route's closure returns the repository's `RawQueueFigures`, which fits; `tsc` proves the fit. |
| **SA-W36** | **An invoice with no due date.** `payment_invoices.due_date` is nullable (`20260722_create_payment_tables.sql:23`). A `sent` row with NULL is never past due (SQL `NULL < x` is not true). An `overdue` row with NULL is still returned. | It is counted as **marked overdue**, with due date "Unknown" and days past due "Unknown". It is sorted after every dated row and left out of "oldest due date". Check 10 behaves the same (`min()` skips NULL). Instalments cannot have this case (`due_date NOT NULL`). |
| **SA-W37** | **The fixed "Not recorded" lines.** S2-FR-16 shows instalment retries as "Not recorded" (LC §1: empty everywhere), but no 2b read selects a retry column. Failed plan charges come from R-i `last_failure_at`. | **Plan charges are conditional** (S2-FR-16): "Not recorded: no failure has ever been stored" while no row read has `last_failure_at`. Once any row has it, the part shows the count with a failure time in the window. **Instalment retries are fixed copy**, worded as a fact about storage, not a count: "Instalment retries: not recorded (no retry time is stored)". It never shows a number. If SA wants it conditional, R-h would add `last_retry_at` (not client data); I recommend not doing that in 2b. |
| **SA-W38** | **Names for the two overdue tables.** | **One `findNames` call** for the union of the shown rows of both tables (at most 100 ids, under the 200-id chunk). The ids come only from rows already read (SEC-5). A platform account is labelled; a NULL id is "Unknown business". This is the 2a pattern (`financeHealth.ts:479-511`). A names failure never fails a part. |
| **SA-W39** | **Client plan statuses.** S2-FR-19: every status is shown, and an unrecognised one is counted as such. "Active now" must match check 12. | `CLIENT_PLAN_STATUSES = ['pending', 'active', 'past_due', 'paused', 'completed', 'cancelled'] as const` is literal data in `paymentProblems.ts`. A test checks it against the migration CHECK (`20260828e:61-62`), as SA-W2 did. Statuses are matched exactly, with no trim (SA-WR-15). Any other value, NULL included, is listed under its stored text and counted as "unrecognised". **Active now = exactly `active`**, as check 12 does, so `past_due` is not active. "Next charge overdue" = `active` and `next_charge_at` before `now`. |
| **SA-W40** | **The writer-names-in-words test (SA-WR-19) for the 2b tables.** The 2b tables' writers include `PaymentRepository` (invoices, already pinned), `PaymentPlanRepository` and `PaymentPlanSubscriptionRepository` (already pinned). | Add **one new** test, not an edit of the 2a one, asserting the repository source does not contain `PaymentPlanRepository` or `PaymentReminderRepository`. The names are built from parts, with a planted control. The header names them in words. |

---

## Analysis Summary

| Area | What changes |
|---|---|
| Finance read repository | Six new named reads (R-g to R-i′); three column constants and row types; the pager generalised (SA-W28); a date-only validator for `todayUtc`; header paragraphs |
| Date-only helpers (new, pure) | `dueDates.ts`: `isPastDue`, `daysPastDue`, `isDueDate`. No `new Date` and no `Date.parse` (SA-W33) |
| Payment problems builder (new, pure) | `paymentProblems.ts`: overdue invoices and instalments per currency, rows and cap, client plans, failed-charge state, reminder mapping, part statuses |
| Shared layout folder | `formatUtcDate` in `adminFormat.ts` plus its tests (full cycle, R-7) |
| Builder | `financeHealth.ts`: three settled reads, one deadline-bound injected read, the block, its names call, the counts |
| Wiring | `financeHealthDeps.ts`: six methods in the `finance` block; the return type omits `readReminderFigures` too |
| Route | Binds `{ correlationId, adminId }` and the queue id, injects `readReminderFigures`, adds the info line |
| Page | New `PaymentProblemsSection.tsx` and `OverdueTable.tsx` after Credits; copy |
| Tables read | `payment_invoices`, `payment_plan_installments`, `payment_plan_subscriptions` (repository); `payment_reminders` only through R-j |
| Not touched | 2a takings logic and block, every slice-1 read and section, the KPI strip, URL, filter bar, `FinanceSection`, Jobs & queues code, Health, the Businesses list, payment writers, Stripe code |

---

## Implementation Approach

1. **The repository first, behind the existing pins.** Generalise the pager and prove it with the unedited 2a T1 tests. Then add R-g to R-i′ and their tests.
2. **Pure code next:**
   - `formatUtcDate` with its tests;
   - `dueDates.ts` with its tests;
   - `paymentProblems.ts` with its tests.

   All of it takes its inputs as parameters (SA-WR-4) and reads no clock.
3. **Builder, wiring, route**, then **the page**.
4. **Guard edits last**, each with a planted negative control.
5. **No new pattern.**
   - Named all-accounts / account-scoped pairs follow R-c / R-c′ and R-e / R-e′.
   - Keyset and ceiling use the 2a pager.
   - The structural injected reader is the health-summary / `readJobsQueues` precedent.
   - `underDeadline` is the shared helper, given an explicit deadline.
   - Names use the 2a takings pattern.
   - Money uses `currencyGroups` and `formatMoney`.
   - The only new shared export is `formatUtcDate`, which the standard already plans (C-5).

---

## Files to Create / Modify

### Create

| File | Purpose |
|---|---|
| `lib/business-os/finance/dueDates.ts` | Pure date-only helpers (SA-W33), built on `todayUtc`, `isRealDate` and `inclusiveDays` |
| `lib/business-os/finance/__tests__/dueDates.test.ts` | AC-57, AC-74 (logic half), invalid dates |
| `lib/business-os/finance/paymentProblems.ts` | Pure `buildPaymentProblems(input)`. Structural input types (SA-W22, SA-W35); `CLIENT_PLAN_STATUSES` |
| `lib/business-os/finance/__tests__/paymentProblems.test.ts` | AC-56 to AC-63 (method), SA-W36, SA-W39 |
| `app/admin/finance/components/PaymentProblemsSection.tsx` | The block: chip, five parts, notes, empty and partial states, the link |
| `app/admin/finance/components/OverdueTable.tsx` | Page-local table for the overdue invoice and instalment parts (one component, two uses) |

### Modify

| File | Change |
|---|---|
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | Pager generalised (SA-W28); R-g to R-i′; column constants `FINANCE_CLIENT_INVOICE_DUE_COLUMNS`, `FINANCE_CLIENT_INSTALMENT_DUE_COLUMNS`, `FINANCE_CLIENT_PLAN_COLUMNS`; row types; header |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | Recording client gains `or`; six new describes; SA-W40 test. **2a describes, `:101-106` and the pins at `:447-510` not edited** |
| `lib/repositories/index.ts` | Export the three constants and row types (new-repository skill, step 4) |
| `lib/business-os/finance/financeTypes.ts` | `FinancePaymentProblemsSection` and its part types; `FinancePayload.paymentProblems` |
| `lib/business-os/finance/financeHealth.ts` | `finance` Pick + six methods; `readReminderFigures` dep; `FINANCE_LIMITS.OVERDUE_ROWS_SHOWN: 50`, `REMINDER_DEADLINE_MS: 2 * 1000`; three settled reads plus one deadline read; names; `counts.paymentProblems` |
| `lib/business-os/finance/financeHealthDeps.ts` | Six wiring lines; return type `Omit<FinanceHealthDeps, 'findNames' \| 'readReminderFigures'>`; header line |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | `makeDeps` gains six methods and `readReminderFigures`; new describes (AC-56 to AC-67 through the builder) |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | Pin set to eight tables; `LAYER_B_METHODS` gains six; AC-61 rules (SA-W29); date-only rule (SA-W33); no-client-data column rule; wording; non-vacuity |
| `app/api/admin/business-os/finance/route.ts` | Binds the reminder reader; info line gains `sections.paymentProblems` and `counts.paymentProblems`; header |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | Mock `@/lib/repositories/AdminJobsQueuesRepository`; `allReads()` gains the reminder mock; new cases (payload, AC-61 binding, AC-65, AC-66, AC-67, AC-69) |
| `app/admin/components/layout/adminFormat.ts` | `formatUtcDate`; header line updated (it "arrives with the first pilot that uses it": finance 2b) |
| `app/admin/components/layout/__tests__/adminFormat.test.ts` | `formatUtcDate` cases, two time zones (AC-74) |
| `app/admin/finance/components/FinanceView.tsx` | `<PaymentProblemsSection>` after `<CreditsSection>` |
| `app/admin/finance/financeCopy.ts` | Every 2b string (S2-FR-14 rule); the jobs link constant |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | Fixture gains `paymentProblems`; render cases for AC-56 to AC-63, AC-68, AC-74 |

**Not modified, on purpose:**
- the 2a files `takings.ts`, `currencyGroups.ts` and `TakingsSection.tsx`;
- `FinanceSection.tsx`, `financeFormat.ts`, `FinanceKpiStrip.tsx`, `financeUrl.ts`, `adminWindowPresets.ts`;
- `AdminJobsQueuesRepository.ts` and its tests, `readJobsQueues.ts`, `readUnderDeadline.ts`;
- every Health and Jobs & queues file;
- the shared folder's other files and `layoutFolder.guard.test.ts`;
- the payment writer repositories and every Stripe file;
- the requirement MD (TL records the link).

---

## The reads: R-g to R-i′

All of them are in `BusinessOsFinanceReadRepository`, with the service role (constructor default, `:186-190`). Every method returns `{ data, error }` and never throws.

### Shared rules (the 2a rules, unchanged)

| Item | Spec |
|---|---|
| Paging | The generalised pager (SA-W28): keyset on `id`, `.order('id', asc)`, `.limit(min(pageSize, ceiling - read))`, `.gt('id', last)` from page two as its own filter, stop on a short page |
| Ceiling | `FINANCE_READ_LIMITS.CLIENT_CEILING` (5,000), `>=` rule: return the rows with `reachedCeiling: true`, never an error (SA-Q15) |
| Options | `opts?: { pageSize?; ceiling? }` for tests, each an integer from 1 to its default, or refused |
| Account scope | The `…ForAccount` method refuses a malformed UUID **before** `from` is called, then `.eq('user_id', accountId)` on every page |
| Mode / status | No `livemode` (BD-13). R-g / R-h filter status only through the `.or()` below; R-i reads every status |
| Logging | All-accounts: `info` `{ method, rows, reachedCeiling, durationMs }`. Account-scoped: `debug` `{ method, rows, reachedCeiling }`. Never an amount, a currency, a date or an id |
| Writes | None. The no-write and no-aggregate pins hold, unedited |

### The `todayUtc` argument (R-g, R-h)

The argument is a `YYYY-MM-DD` string, checked inside `prepare`:
- it must match `/^\d{4}-\d{2}-\d{2}$/`;
- it must round-trip as a real date through `Date.parse(\`${v}T00:00:00.000Z\`)`.

Otherwise the read is refused before any query. The repository does not import from `app/`. Because of the strict pattern, the value can only be digits and dashes before it goes into the filter string (SA-Q15).

### Columns (exact, exported)

| Constant | Columns | Excluded on purpose (S2-FR-26, AC-64) |
|---|---|---|
| `FINANCE_CLIENT_INVOICE_DUE_COLUMNS` | `id, user_id, amount, currency, status, due_date` | `contact_id`, `invoice_number`, `line_items`, `notes`, `internal_notes`, `payment_terms`, every client name / email / phone column, `metadata`, Stripe ids, `refunded_amount` |
| `FINANCE_CLIENT_INSTALMENT_DUE_COLUMNS` | `id, user_id, amount, currency, status, due_date` (SA-W34; `+ subscription_id` if SA keeps it) | `contact_id`, `booking_id`, `payment_method`, `transaction_id`, retry columns |
| `FINANCE_CLIENT_PLAN_COLUMNS` | `id, user_id, status, cancelled_at, completed_at, next_charge_at, last_failure_at` (SA-W34; `+ currency` if SA keeps it) | `contact_id`, card columns, Stripe ids, `last_failure_code`, `metadata`, amounts |

### The six methods

| # | Signature | Query |
|---|---|---|
| **R-g** | `listOverdueClientInvoicesAllAccounts(todayUtc, opts?)` | `.from('payment_invoices').select(COLS).or(\`status.eq.overdue,and(status.eq.sent,due_date.lt.${today})\`)` + keyset |
| **R-g′** | `listOverdueClientInvoicesForAccount(accountId, todayUtc, opts?)` | UUID check first, then the same with `.eq('user_id', accountId)` |
| **R-h** | `listOverdueClientInstalmentsAllAccounts(todayUtc, opts?)` | `.from('payment_plan_installments').select(COLS).or(\`status.eq.overdue,and(status.eq.pending,due_date.lt.${today})\`)` + keyset |
| **R-h′** | `listOverdueClientInstalmentsForAccount(accountId, todayUtc, opts?)` | UUID check first, then the same with `.eq('user_id', accountId)` |
| **R-i** | `listClientPlansAllAccounts(opts?)` | `.from('payment_plan_subscriptions').select(COLS)` + keyset (every row; 6 today) |
| **R-i′** | `listClientPlansForAccount(accountId, opts?)` | UUID check first, then the same with `.eq('user_id', accountId)` |

The status literals in the `.or()` strings are fixed text in the repository (SA-Q15). The keyset `.gt('id')` and the `.eq('user_id')` stay separate top-level filters. Each public method keeps its own literal `.from('<table>')`, so the SA-WR-16 count rule holds (D-3).

### Header changes

- The opening lines name slice 2b and R-g to R-i′.
- The layer-B paragraph adds that invoices, instalments and client plans have writer and owner-scoped repositories, named in words only (SA-W40).
- ACCOUNT SCOPE lists the three new pairs.
- PAGING says: "layer B uses one pager; R-g / R-h filter by the stored status and a validated UTC date; R-i reads every row".
- New line: **this file never reads the reminder queue**; Jobs & queues owns it (R-j).

### Tests (`BusinessOsFinanceReadRepository.test.ts`)

The recording client gains `or`. The 2a describes and pins are not edited.

1. **Columns:** each constant equals its exact list. None contains `contact_id`, `name`, `email`, `phone`, `notes`, `metadata`, `invoice_number`, `line_items` or `livemode` (AC-64).
2. **R-g / R-h:**
   - the exact table and columns;
   - **one** `or` call whose argument is exactly the expected string for `'2026-10-01'`;
   - no `eq` at all;
   - `order('id', asc)` and `limit(1000)`;
   - no `livemode`;
   - an info line with counts only.
3. **R-i:** the exact table and columns, **no filter call** (no `or`, `eq`, `gte` or `lt`), and the keyset.
4. **Keyset and ceiling:** for each of the three tables, a full first page then `gt('id', last)`. With `{ ceiling: 3, pageSize: 2 }`: 3 rows give `reachedCeiling: true` and `error: null`, and 2 rows give `false`.
5. **Account-scoped:** `.eq('user_id', A)` on every page. A malformed id is refused before `from`, with a warn line and no id logged.
6. **Bad `todayUtc`** (`''`, `'2026-02-30'`, `'2026-10-01T00:00:00Z'`, `"2026-10-01,status.eq.paid"`, a `Date`): refused before `from`.
7. **A read error** → `{ data: null, error }`, logged at error, never thrown.
8. **SA-W28 proof:** the 2a describes at `:318-438` pass byte-identical.

---

## The reminder read: R-j reused

**Not a new read.** It is `AdminJobsQueuesRepository.readQueueFiguresAllAccounts(context, 'payment_reminders', now, { signal })` (`AdminJobsQueuesRepository.ts:420-575`). It owns the one definition of stuck (`STUCK_AFTER_SECONDS`, `:54`) and dead-lettered (`DEAD_LETTER_MARKER`, `:48`), the same definition that feeds Jobs & queues and Health tile 7 (SA-Q14).

| Step | Where | What |
|---|---|---|
| Bind | `route.ts`, after `requireAdmin` | `const reminderContext = { correlationId, adminId: gate.user.id }` |
| Inject | `route.ts`, beside `findNames` | `readReminderFigures: (readAt, signal) => adminJobsQueuesRepository.readQueueFiguresAllAccounts(reminderContext, 'payment_reminders', readAt, { signal })` |
| Type | `financeHealth.ts` | `readReminderFigures: (now: Date, signal: AbortSignal) => Promise<RepoResult<FinanceReminderFiguresInput>>`, the structural type from `paymentProblems.ts` (SA-W35) |
| Call | `financeHealth.ts`, only when `accountId === null` | `underDeadline('reminders', timings, (signal) => deps.readReminderFigures(now, signal), FINANCE_LIMITS.REMINDER_DEADLINE_MS)` (`readUnderDeadline.ts:41-46`): an **explicit** 2 s, not the default 5 s (S2-F9); the signal reaches every query (`AdminJobsQueuesRepository.ts:442`) |
| Map | `paymentProblems.ts` | `mapReminderFigures(raw)`: the seven counts and `oldestDueAt`, each checked; malformed → `unknown` |
| Show | `PaymentProblemsSection.tsx` | Plain figures, **no colour**, no `buildJobsQueuesView`; the link "Open Jobs & queues" → `/admin/jobs-queues#queues` (the anchor exists, `JobsQueuesView.tsx:428`) |

`lib/business-os/finance/**` never names the repository, its singleton, `ADMIN_QUEUE_SPECS`, `STUCK_AFTER_SECONDS` or the marker (SA-W29 rules). `FINANCE_LIMITS.REMINDER_DEADLINE_MS` is written `2 * 1000`: a bare `2000` reads as the trial allowance in `creditFigures.fromConfig.guard`.

---

## Date-only due dates and `formatUtcDate`

### `lib/business-os/finance/dueDates.ts` (pure, SA-W33)

```ts
/** A real calendar date written YYYY-MM-DD (isRealDate). Anything else is not a due date. */
export function isDueDate(value: unknown): value is string;
/** Past due = strictly before today's UTC date; a due date equal to today is NOT past due. String comparison, only after isDueDate. */
export function isPastDue(dueDate: string, todayUtc: string): boolean;
/** Whole UTC days from the due date to today (inclusiveDays − 1); null when either is not a real date. */
export function daysPastDue(dueDate: unknown, todayUtc: string): number | null;
```

`todayUtc` itself comes from `todayUtc(now)` (`adminWindowPresets.ts:41-43`), computed once by the builder from the request's one clock.

### `formatUtcDate` in `app/admin/components/layout/adminFormat.ts` (shared, full cycle)

```ts
/**
 * A date-only value ("YYYY-MM-DD", a SQL DATE such as a due date) shown as that
 * same calendar date in any process time zone (§5.11; INV-00013). It is never
 * passed through `new Date`: a real date is returned as its own text. Em dash
 * for null, an invalid date, or anything that is not date-only (a timestamp
 * goes through formatUtc).
 */
export function formatUtcDate(value: string | null): string;
```

It imports `isRealDate` from `@/app/admin/components/adminWindowPresets`, the one named S-3 exception (`layoutFolder.guard.test.ts:121-135`), so S-3 to S-10 hold.

**Tests (`adminFormat.test.ts`, AC-74):**
- `formatUtcDate('2026-09-30')` gives `'2026-09-30'` with `process.env.TZ` set to `America/New_York`, then to `Pacific/Auckland`.
- **Non-vacuity control:** under the same TZ, `new Date('2026-09-30').toLocaleDateString('en-CA')` really gives `2026-09-29` in New York. If changing TZ at run time does not take effect on this platform, the control uses `toLocaleDateString('en-CA', { timeZone })`, as `dateOnlyIsNotMidnightUTC` does.
- `'2026-02-30'`, `''`, `null` and `'2026-09-30T00:00:00Z'` give "—".
- A source assertion: the function body has no `new Date` and no `Date.parse`.

---

## The payment problems builder

`lib/business-os/finance/paymentProblems.ts`: pure (SA-WR-4). It imports only `currencyGroups` and `dueDates`, plus types from `financeTypes`. No repository, so the one-caller pin holds (SA-W22).

```ts
export interface DueRowInput { id: string; user_id: string | null; amount: unknown; currency: unknown; status: string | null; due_date: unknown }
export interface ClientPlanInput { id: string; user_id: string | null; status: string | null; cancelled_at: string | null; completed_at: string | null; next_charge_at: string | null; last_failure_at: string | null }
export interface FinanceReminderFiguresInput { dueNow: number; inProgress: number; stuck: number; failed24h: number; failed7d: number; deadLettered24h: number; deadLettered7d: number; oldestDueAt: string | null }
export const CLIENT_PLAN_STATUSES = ['pending', 'active', 'past_due', 'paused', 'completed', 'cancelled'] as const;

export function buildOverdue(input: {
  kind: 'invoice' | 'instalment';
  read: { rows: readonly DueRowInput[]; reachedCeiling: boolean } | null;   // null: the read failed
  todayUtc: string; isPlatformAccount: (id: string) => boolean; displayCap: number; // OVERDUE_ROWS_SHOWN
}): OverdueBuilt;
export function buildClientPlans(input: {
  read: { rows: readonly ClientPlanInput[]; reachedCeiling: boolean } | null;
  window: { start: Date; end: Date }; now: Date;
}): ClientPlansBuilt;
export function mapReminderFigures(raw: unknown): FinanceReminderFiguresInput | null;
```

### Overdue invoices and instalments (S2-FR-17, S2-FR-18)

| Figure | Rule |
|---|---|
| Kind of row | **Marked** = `status === 'overdue'`. **Past due** = `status === 'sent'` (invoice) or `'pending'` (instalment) **and** `isPastDue(due_date, todayUtc)`. Matched exactly, with no trim (SA-WR-15), so the page and checks 10 / 11 cannot differ. Any other row the read returns is counted in `unexpectedRows` and left out (it cannot happen: the `.or()` returns only these). |
| Lines (per currency) | Through `groupByCurrency` over the counted rows: `marked`, `pastDue`, **`amount`** (both kinds; integer hundredths, `toHundredths`), `businesses` (distinct non-null `user_id`), `oldestDueDate` (minimum real date string), `unreadable` (amounts) |
| Amount label | The **invoice amount** / **instalment amount**: the full amount, not what is still owed (S2-F7). Partial payments and `refunded_amount` are not read and not deducted |
| Unreadable amount | Left out of the sum and counted. That line's amount reads "At least", and the part is `partial` (S2-CUR-3; the 2a QA-2 rule) |
| Overall | `businesses` (distinct, across currencies: a count, not money), `total` rows |
| Rows | Every counted row as `{ id, accountId, isPlatform, kind, dueDate, daysPastDue, amount, currency }`. Sorted by due date, oldest first, NULL / invalid last, then `id` (SA-W30, SA-W36). Sliced to 50; `rowsTotal` reported |
| Ceiling | `exact = !reachedCeiling`. On the ceiling every count and amount is "At least", the part is `partial`, and the table note says it lists the oldest rows **among those read** (S2-FR-22) |
| Status | Read failed → `unknown` (no figures). Otherwise `partial` on the ceiling or any unreadable amount, else `ok` |
| Empty | No counted row → `empty: true`, no line, status `ok`: "No overdue invoices" / "No overdue instalments" (AC-63) |
| SA-W36 | An `overdue` invoice with NULL or invalid `due_date`: marked, `dueDate: null`, `daysPastDue: null`, sorted last, not in `oldestDueDate` |

### Client plans (S2-FR-19, S2-FR-16)

| Figure | Rule |
|---|---|
| By status | One entry per stored status, in `CLIENT_PLAN_STATUSES` order, then other values sorted (NULL shown as "(none)"). Every known status is shown, zeros included. `unrecognised` = rows whose status is not in the list (SA-W39) |
| Active now | `status === 'active'` (as of now) |
| Cancelled / completed in the window | `cancelled_at` / `completed_at` within `[window.start, window.end)`, any status (check 12) |
| Next charge overdue | `status === 'active'` and `Date.parse(next_charge_at) < now` (timestamps are instants; an unparseable value is not counted and is reported in `unreadableTimes`) |
| Failed plan charges | `everRecorded` = any row read has `last_failure_at`; `inWindow` = rows with `last_failure_at` in the window. While `everRecorded` is false the panel says "Not recorded: no failure has ever been stored" (AC-60) |
| Ceiling / status | As above: `partial` and "At least"; read failed → `unknown` |
| Empty | No row → "No client payment plans", `ok` |

### Failed client payments (S2-FR-16)

The part is the fixed `{ state: 'not_stored' }`. It has no read, no count and no status that could look like a 0. The panel shows:
- the fixed sentence;
- the failed plan charges line, taken from client plans;
- "Instalment retries: not recorded" (SA-W37).

It never feeds a tile.

### Reminder health (S2-FR-20, S2-FR-21)

| State | When | Shown |
|---|---|---|
| `read` | All businesses, the read answered in under 2 s and the result is well formed | The seven figures and the oldest due time (`formatUtc`), plain, with the link |
| `failed` | Error, deadline passed, or malformed (SA-W35) | "Could not check reminders" with the link (AC-66, AC-67) |
| `not_narrowed` | A business is picked: **no call** | "Reminder health is platform-wide and is not narrowed to one business" with the link |

The part's status is `ok` for `read` and `not_narrowed`, and `unknown` for `failed`.

### Block status (SA-W31)

`partial` if any of the four read parts is `partial` or `unknown`, otherwise `ok`. It is never `unknown`.

All sums stay integer hundredths inside the builder. The payload values are divided by 100 once (SA-W26).

---

## The builder, the wiring and the route

### `financeHealth.ts`

- `finance` Pick gains the six methods (`:135-144`). There is a new dep `readReminderFigures`.
- `FINANCE_LIMITS` (`:99-111`) gains `OVERDUE_ROWS_SHOWN: 50` and `REMINDER_DEADLINE_MS: 2 * 1000` (data, §11A.6).
- `const today = todayUtc(now)`: computed once.
- The `Promise.all` (`:307-342`) gains:
  - `settle(() => accountId !== null ? deps.finance.listOverdueClientInvoicesForAccount(accountId, today) : deps.finance.listOverdueClientInvoicesAllAccounts(today))`;
  - the same for instalments and for plans (`listClientPlansForAccount(accountId)` / `listClientPlansAllAccounts()`);
  - `accountId !== null ? Promise.resolve(NOT_NARROWED) : underDeadline('reminders', timings, (signal) => deps.readReminderFigures(now, signal), FINANCE_LIMITS.REMINDER_DEADLINE_MS)`.
- Failures are logged through the existing `failed(read, err)` (`:257`): `client_overdue_invoices`, `client_overdue_instalments`, `client_plans`, `reminders`, each as `{ read, err }` like every other finance read (fix round 1, QA-2: the reminder error holds no client data; see Implementation Notes).
- `buildOverdue` × 2, `buildClientPlans`, `mapReminderFigures`.
- Then **one** names call for the union of the shown overdue rows (SA-W38), with each row's `nameStatus` set as in 2a.
- `payload.paymentProblems = { status, scope, failedPayments, overdueInvoices, overdueInstalments, clientPlans, reminders }` (S2-FR-24).
- `counts.paymentProblems`: `{ invoices, instalments, plans` (rows read, or null when failed)`, invoicesCeiling, instalmentsCeiling, plansCeiling, unreadableAmounts, unexpectedRows, overdueRowsShown, reminders: 'read' | 'failed' | 'not_narrowed', reminderMs, namesFound }`. Counts, booleans and a state word only.

### `financeHealthDeps.ts`

There are six delegation lines in the `finance` block (`:108-120`). The return type becomes `Omit<FinanceHealthDeps, 'findNames' | 'readReminderFigures'>`: both are admin-route reads, injected by the route. The header adds "overdue invoices and instalments, and client plans (layer B, slice 2b)". There is no other import.

### `financeTypes.ts`

```ts
export interface FinanceDueLine { currency: string | null; marked: number; pastDue: number; amount: number; amountExact: boolean; unreadable: number; businesses: number; oldestDueDate: string | null }
export interface FinanceDueRow {
  id: string; accountId: string | null; name: string | null;
  nameStatus: 'found' | 'missing' | 'unavailable' | 'platform' | 'unknown_business';
  kind: 'marked' | 'past_due'; dueDate: string | null; daysPastDue: number | null; amount: number | null; currency: string | null;
}
export interface FinanceDueFigures { empty: boolean; exact: boolean; lines: FinanceDueLine[]; businesses: number; total: number; unreadableAmounts: number; rows: FinanceDueRow[]; rowsTotal: number }
export interface FinanceDuePart { status: FinanceSectionStatus; figures: FinanceDueFigures | null }
export interface FinanceClientPlansFigures {
  exact: boolean; total: number; byStatus: Array<{ status: string | null; plans: number; recognised: boolean }>; unrecognised: number;
  activeNow: number; cancelledInWindow: number; completedInWindow: number; nextChargeOverdue: number; unreadableTimes: number;
  failedCharges: { everRecorded: boolean; inWindow: number };
}
export interface FinanceReminderFigures { dueNow: number; inProgress: number; stuck: number; failed24h: number; failed7d: number; deadLettered24h: number; deadLettered7d: number; oldestDueAt: string | null }
export interface FinancePaymentProblemsSection {
  status: FinanceSectionStatus;          // never 'unknown' (SA-W31)
  scope: 'all' | 'one';
  today: string;                          // the UTC date the as-of-now rule used
  failedPayments: { state: 'not_stored' };
  overdueInvoices: FinanceDuePart;
  overdueInstalments: FinanceDuePart;
  clientPlans: { status: FinanceSectionStatus; figures: FinanceClientPlansFigures | null };
  reminders: { status: FinanceSectionStatus; state: 'read' | 'failed' | 'not_narrowed'; figures: FinanceReminderFigures | null };
}
```

Every money field sits in an object that also has a `currency` key. The 2a payload walker (AC-48) covers the new block unchanged.

### The route

- After the gate: `const reminderContext = { correlationId, adminId: gate.user.id }`.
- The deps object gains `readReminderFigures` (the table above), beside `findNames`. The route imports `adminJobsQueuesRepository`. It is under `app/api/admin/**`, so the isolation guard allows it.
- The info line gains `sections.paymentProblems` (the block plus the five part states) and `counts.paymentProblems`.
- Zod, the gate, 404 / 500 and `no-store` are untouched. There is **no new query parameter**.

---

## With a business picked (AC-65, AC-42 re-run)

This is the tenant-isolation-guard **read** invariant. The service role is used, and the only caller-supplied id is `accountId`:
- it is validated as a UUID (`route.ts:80`);
- it is refused if it is a platform account (`:132-134`);
- it is checked against the plan table **before** any read (`financeHealth.ts:259-269`).

Nothing writes, so the write steps of the guard (pre-check before a write, field allow-list, trigger, upsert) do not apply. `todayUtc` is server-computed, never caller data.

| Read | All businesses | One business picked |
|---|---|---|
| Overdue invoices | **R-g**(today) | **R-g′(accountId, today)**: UUID refused before any query; `.eq('user_id')` on every page |
| Overdue instalments | **R-h**(today) | **R-h′(accountId, today)** |
| Client plans | **R-i** | **R-i′(accountId)** |
| Reminders | **R-j** under 2 s | **Not called**: the platform-wide note and the link |
| Names | Ids from overdue rows read | Only `accountId`, only if it appears in a row read |

With `accountId` set, **R-g, R-h, R-i and R-j have zero calls**, as do `pagePlans`, R-a, R-b, R-c, R-e and R-f (AC-42, AC-65).

**Required test (SA-WR-3 shape):** in `financeHealth.test.ts`, and through the route in `route.test.ts`, with spies on all six methods, `readReminderFigures` (the route's mocked repository method) and `findNames`. With `accountId`:
- R-g′, R-h′ and R-i′ each receive exactly `accountId` (and R-g′ / R-h′ today's date);
- the all-accounts methods and the reminder read have zero calls;
- names receive at most `[accountId]`.

---

## Failure matrix

A failed read is never a 500 (SA-Q8). Every slice-1 and 2a section renders unchanged in every row of this table.

| What happens | Its part | Block | Others |
|---|---|---|---|
| Nothing wrong | `ok` | `ok` | — |
| R-g failed (AC-66) | Overdue invoices `unknown`: "Could not load this part" | `partial` | All render |
| R-g at its ceiling (AC-62) | `partial`, "At least" on counts and amounts, notice, "among the rows read" | `partial` | — |
| R-h failed / at its ceiling | Same for instalments | `partial` | — |
| R-i failed (AC-66) | Client plans `unknown`; the failed-charges line says "Could not check" | `partial` | — |
| R-i at its ceiling | Client plans `partial`, "At least" | `partial` | — |
| R-j error or malformed (AC-66) | Reminders `unknown`: "Could not check reminders" + link | `partial` | — |
| R-j past 2 s (AC-67) | Same; the signal aborts its queries | `partial` | — |
| A business picked | Reminders `not_narrowed`, `ok` | unchanged | — |
| An unreadable amount | That line "At least", the part `partial`, counted | `partial` | — |
| Names failed | "Name unavailable" on rows | unchanged | — |

---

## The page

`PaymentProblemsSection.tsx` is a client component, with `import type` only from `lib/business-os/finance/`, each on one line (D-4). It is rendered in `FinanceView` **after `<CreditsSection>`** (§11A.0 page order).

- **Frame:** `FinanceSection` with `id="payment-problems"`, the title "Client payment problems", and the subtitle "Problems with clients paying the businesses · As of now, UTC ({today}); plans cancelled or completed: {window} UTC · Covers businesses that still exist". The block status follows SA-W31. `badge={{ tone: 'neutral', label: "The businesses' problem, not ours" }}` (BD-2).
- **Part headings:** a page-local `h3` with a `StatusChip`: `ok` "OK", `warn` "Partial", `unknown` "Could not load this part". Text and icon, never colour alone.
- **Failed client payments:** the fixed sentence (S2-FR-16), the failed plan charges line, the instalment retries line. Never a number in place of "not available".
- **Overdue invoices / Overdue instalments** (`OverdueTable` twice):
  - **Per-currency table** (`aria-label` "Overdue invoices per currency"). Columns: Currency, Marked overdue, Past due date, not marked (instalments: "Past due date, still pending"), **Invoice amount** / **Instalment amount**, Businesses, Oldest due date (UTC). Money is formatted with `formatMoney`, so each cell names its currency. Counts use the shared `formatCount`. Dates use `formatUtcDate`.
  - **The note** (S2-F7): "This is the full amount of each invoice, not the amount still owed: part payments and refunds are not deducted."
  - **The 50 oldest:** Business, Invoice (`formatShortId`, full id in `title`, `ADMIN_TD_ID`), Due date (UTC), Days past due, Amount, and a `warn` chip "Overdue" or "Past due, not marked" / "Past due, still pending". The chip comes from the stored status and the date, never from a threshold (K-5 (i)).
  - **Lines around the table:** `ADMIN_COUNT_LINE` "Showing N of M". At the ceiling: "Lists the oldest among the rows read".
- **Client plans:** the status counts (every status), Active now, Cancelled in this window, Completed in this window, Next charge overdue.
- **Reminder health:** a small definition list, plain figures (no chip colour, no tone):
  - due now;
  - in progress;
  - stuck;
  - failed (24 h, 7 d);
  - dead-lettered (24 h, 7 d);
  - oldest due time (`formatUtc`).

  Under it, `<a href={JOBS_QUEUES_HREF}>` "Open Jobs & queues", with a descriptive name.
- **States:** `AdminEmpty` for each empty part (AC-63) and `AdminNotice` for each partial cause. A missing value shows "Unknown" or "—", never a blank.
- **BD-13:** no test-mode wording anywhere in the block.
- **Copy:** every string lives in `financeCopy.ts`. No figure, status literal, currency code or threshold is typed in a component.

The KPI strip still holds exactly K-1 to K-5 (AC-68); `FinanceKpiStrip.tsx` is not touched.

---

## Guard table, line by line

| Guard | Does 2b trip it? | Exact change |
|---|---|---|
| **`lib/business-os/finance/__tests__/finance.source.guard.test.ts`**, the positive table pin (`:232-258`) | **Yes, by design** (S2-F1: "2b adds its three tables to the pin") | **1.** The expected set grows to exactly eight: the five at `:238-244` plus `payment_invoices`, `payment_plan_installments`, `payment_plan_subscriptions`. `fromCallsOf(code) === tablesOf(code).length` stays (SA-WR-16). `not.toContain('payment_reminders')` stays. **2.** The planted extra at `:249-258` is updated to the eight-table set and still fails. A new planted control: `payment_plans` (near miss of `payment_plan_installments`) makes the set differ. **3.** `tables.length >= 8` (non-vacuity) |
| Same file, `LAYER_B_FREE` rule (`:102-104`) | **No**, it holds as is | The regex already covers `payment_plan_`. **`payment_invoices` is added** to it, so no builder, route or page file names the new table. Planted control: `"from('payment_invoices')"` matches |
| Same file, `LAYER_B_METHODS` (`:261-268`) | **Extended** | It gains the six 2b method names. The pager's name is unchanged, so each `bodyOf` slice is found and names no `livemode`. The layer-A control (`:292-294`) is unchanged |
| Same file, **new 2b rules** (§12.1, AC-61, AC-64, AC-74) | Added, each with a planted control | (a) **AC-61 / SA-W29:** the forbidden reminder vocabulary over `FILES`; the namers of `AdminJobsQueuesRepository`, `adminJobsQueuesRepository` and `readQueueFiguresAllAccounts` are exactly `['app/api/admin/business-os/finance/route.ts']`; the files with a `'sent'` / `'pending'` literal are exactly the repository and `paymentProblems.ts`. (b) **SA-W33:** `dueDates.ts` has no `new Date(` and no `Date.parse(`. (c) **AC-64:** no 2b file selects or names `contact_id`, `client_name`, `client_email`, `client_phone`, `line_items`, `invoice_number` or `internal_notes`. (d) **BD-13 / S2-F6:** the 2b files have no `livemode`, no test-mode wording and no "Deleted business". (e) **CUR:** `paymentProblems.ts` adds no two money lines (the 2a SA-WR-18 regex is extended to `amount`). (f) Non-vacuity adds `dueDates.ts`, `paymentProblems.ts`, `PaymentProblemsSection.tsx`, `OverdueTable.tsx` |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | **Extended**, pins **not tripped** | New describes (above); the recording client gains `or`; the SA-W40 test. **`FINANCE_READ_LIMITS` equality (`:101-106`) is not edited**, because 2b reuses the client keys. The no-write, no-aggregate, writer-name and SA-WR-19 pins (`:447-510`) are unedited. **The one-caller pin (`:469-494`) holds**: `paymentProblems.ts` and `dueDates.ts` use structural types and never write the class name |
| `lib/repositories/__tests__/AdminJobsQueuesRepository.test.ts` isolation guard (`:234-262`) | **No** | The finance route is under `app/api/admin/**`. `paymentProblems.ts` declares `FinanceReminderFiguresInput` structurally (SA-W35), because the guard matches the name **in import paths too**. No list edit. Run unchanged (V-5) |
| `lib/repositories/__tests__/adminReadMethods.guard.test.ts` (`:479-490`) | **No** | `readQueueFiguresAllAccounts` is not in `ADMIN_METHODS` (S2-F3), and `findAdminIdentitiesByUserIds` is still called only from the route. Run unchanged |
| Other `AdminJobsQueuesRepository` suites, `readJobsQueues`, health-summary route tests | **No**, no change to them | Run unchanged (V-5): R-j's contract is what they pin |
| Shared layout folder guard `layoutFolder.guard.test.ts` (C-14) | **No** | No file is added to the folder (`EXPECTED_SOURCES`, `:84-101`, unchanged). `formatUtcDate` imports only the named presets exception (S-3, G-3); no BOS module, no Supabase, no console, no `.json(` (S-4 to S-6). Finance stays out of the registry (`:472`, DF-4). Run unchanged |
| `app/admin/components/layout/__tests__/adminFormat.test.ts` | Extended | `formatUtcDate` cases (AC-74) |
| `app/admin/finance/__tests__/source.guard.test.ts` | **No**, by construction | The new components import only types from `lib/business-os/finance/`, each on one line (D-4). No repository, no `server-only`, no `console.` |
| `lib/payments/__tests__/dateOnlyIsNotMidnightUTC.guard.test.ts` | **No** (scans named files) | Its rule is applied to 2b by the SA-W33 source rule and AC-74. Run unchanged |
| Stripe placement guards: `routerPlacement.guard`, `invoiceIntentsStayUnowned.guard`, `planSurfaces.guard` | **No** (SA-Q16). They scan the webhook route, `PaymentRepository` and the Stripe routes, and named files (`routerPlacement.guard.test.ts:27-28`, `:466-470`) | None. Run unchanged and paste (V-5). Any trip goes to SA, never a list edit |
| `paymentTablesWriteLockdownMigration.test.ts` | **No** (write verbs only) | Run unchanged |
| `enforcementPoints`, `tierLiteral.forbidden`, RC-15, ledger caller list, G3, `creditFigures.fromConfig`, `accountSeam` | **No.** No entitlements import, no tier literal, no plan / ledger / lot repository name in a new file; the deadline is written `2 * 1000` | None. `test:bos-entitlements` proves it (V-3) |
| `serviceColumn.guard` (N-10), `businessOwnedTables`, purge descriptors | **No.** No `service` column, no new table | None |
| Admin authz surface guard | **No.** No new route or page | Run (V-4) |
| `AdminSidebar.nav`, Health suites | **No** | Run unchanged |

**No new CI job and no added PR critical-path time.** Every new test runs in the existing Jest gate. The repository test also runs in `test:bos-entitlements`.

---

## AC mapping

T-numbers:
- **T1** `BusinessOsFinanceReadRepository.test.ts`
- **T2** `dueDates.test.ts` (new)
- **T3** `paymentProblems.test.ts` (new)
- **T4** `financeHealth.test.ts`
- **T5** `finance.source.guard.test.ts`
- **T6** finance `route.test.ts`
- **T7** `financePage.render.test.tsx`
- **T8** `app/admin/finance/__tests__/source.guard.test.ts`
- **T9** `adminFormat.test.ts`

QA = a recorded manual step.

| AC | Test / check |
|---|---|
| **AC-45** (re-run) | T6: 401 and 403 (including the `profiles.role`-only admin) with zero calls on every `mockDeps.finance` method, the six new ones included, **and on the mocked `readQueueFiguresAllAccounts`** (added to `allReads()`) |
| **AC-46** (re-run) | T6: every AC-4, AC-33 and AC-34 case still returns 400 with zero layer-B reads, R-j included; no new parameter |
| **AC-56** | T3 against an independent `checkTen` helper written in the test (the 1b / 2a method): per currency, marked, past due, invoice amount, businesses and oldest. T4: switching the window (this month, 7d, custom) leaves the figures unchanged. T7: the "Invoice amount" label and the not-the-amount-owed note. QA: check 10 (V-11) |
| **AC-57** | T2 and T3, with injected `now` at `2026-09-30T23:59:00Z` and `2026-10-01T00:01:00Z`: a `sent` invoice and a `pending` instalment due `2026-09-30` are not past due, then past due with 1 day; a due date equal to today is never past due. T4: R-g / R-h receive `'2026-09-30'` then `'2026-10-01'`. T1: the exact `.or()` string |
| **AC-58** | T3 against an independent `checkEleven` helper; T7: "Instalment amount", the note, "Past due, still pending". QA: check 11 |
| **AC-59** | T3: by status (every known status, zeros, unrecognised), active now = exactly `active`, cancelled and completed in the window (a row just outside each edge is excluded), next charge overdue. T4: the cancelled count follows the window. QA: check 12 |
| **AC-60** | T3: no `last_failure_at` gives "never recorded"; a mocked row in the window gives a count. T7: the "not available" panel with its reason, no `0` in it. T5/T7: the KPI strip has five tiles and none reads layer B |
| **AC-61** | T6: `readQueueFiguresAllAccounts` is called with `({ correlationId, adminId }, 'payment_reminders', <Date>, { signal })`, and the payload figures equal its return. T5: the SA-W29 rules with planted controls. T7: the figures carry no tone or colour class, and the link's `href` is `/admin/jobs-queues#queues`. QA: check 13 |
| **AC-62** | T1: injected small ceiling gives `reachedCeiling`. T3: "At least" flags, `partial`. T4: the part is `partial`. T7: "At least", the notice, "among the rows read" |
| **AC-63** | T3: empty gives `empty`, `ok`. T7: "No overdue invoices", "No overdue instalments", "No client payment plans", and no `0.00` |
| **AC-64** | T1: the column constants hold no client column. T5: the 2b file rule. T6: a payload walker finds no key named `contact_id`, `name` (other than the business name), `email`, `phone`, `notes` or `metadata` under `paymentProblems` |
| **AC-65** (2b) | T4 and T6: R-g′, R-h′ and R-i′ get exactly the id; R-g, R-h, R-i and R-j get zero calls; names at most `[id]`; the reminder part shows the platform-wide note and the link (T7) |
| **AC-66** (2b) | T4 and T6: each of R-g, R-h, R-i and R-j failing alone fails only its part; the route returns 200; every slice-1 and 2a section renders. T7 renders each |
| **AC-67** | T4 with fake timers: a never-settling `readReminderFigures` gives "Could not check reminders" after `FINANCE_LIMITS.REMINDER_DEADLINE_MS`, and the signal it received is `aborted`. A pin asserts `FINANCE_LIMITS.REMINDER_DEADLINE_MS === 2000` and `!== ADMIN_READ_DEADLINE_MS`. T7 renders the state with the link |
| **AC-68** (re-run) | T7: `StatusChip` with words on every part and row, table constants on number cells, the currency on every money cell, "Unknown" / "—", `AdminNotice`, `AdminEmpty`, `aria-label` and `scope="col"`; the KPI strip has exactly five tiles |
| **AC-69** (re-run) | T6: the info line carries `sections.paymentProblems` and `counts.paymentProblems` (counts, booleans and state words). A planted amount, currency code, due date and business name appear in no log call. T1: repository info lines carry counts only |
| **AC-70** (re-run) | T5 write-verb pins over the new files; T1 no-write pin unedited; V-9 shows no `supabase/migrations` path |
| **AC-71** (re-run) | V-3 to V-6: every §12.2 slice-2 row, the three Stripe guards unchanged, AC-31's list re-run, results pasted |
| **AC-72** (re-run) | V-8: scoped `tsc` with a canary in `paymentProblems.ts` |
| **AC-73** (2b) | QA manual steps L-32 to L-40 below |
| **AC-74** | T9 (`formatUtcDate` in `America/New_York` and `Pacific/Auckland`, with a non-vacuity control); T2 (past due and days unchanged in both zones); T7 (the due date cell shows `2026-09-30`); T5 (no `new Date` / `Date.parse` in `dueDates.ts`) |

---

## Verification plan

The worktree has the `node_modules` junction. Never `git worktree remove`, never `git stash`, never `npm install` through the junction.

Before SA code review, Dev runs these and pastes the command, the exit code and the counts. Exit codes are read from the tool itself, never from a pipe (schema-check skill, Rule 7).

| # | Command | Evidence |
|---|---|---|
| V-1 | **Finance suites:** `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts app/admin/components/layout/__tests__/adminFormat.test.ts --ci` | Suites and tests passed |
| V-2 | **Businesses-list suites:** `npx jest app/api/admin/users app/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`, then `git diff --exit-code -- app/api/admin/users app/admin/users lib/business-os/credits` | Pass; diff exit 0 |
| V-3 | `npm run test:bos-entitlements` | Exit 0 |
| V-4 | `npm run test:authz-guard` | Exit 0 |
| V-5 | **Guards and neighbours, run unchanged:** `npx jest app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts lib/payments/__tests__/planSurfaces.guard.test.ts lib/payments/__tests__/dateOnlyIsNotMidnightUTC.guard.test.ts lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts lib/repositories/__tests__/adminReadMethods.guard.test.ts lib/repositories/__tests__/AdminJobsQueuesRepository.test.ts lib/repositories/__tests__/AdminJobsQueuesRepository.items.test.ts lib/admin/jobs app/api/admin/health-summary app/api/admin/jobs-queues app/admin/components/layout lib/business-os/credits/__tests__/serviceColumn.guard.test.ts lib/admin/health app/admin/components/__tests__/AdminSidebar.nav.test.ts --ci`, then `git diff --exit-code` on every one of those paths **except** `app/admin/components/layout/adminFormat.ts` and its test | Pass; diff exit 0 (no guard file edited but the finance source guard) |
| V-6 | `npm run lint:hooks` | Exit 0 |
| V-7 | `npx eslint <every touched and new file>` | Clean |
| V-8 | **Scoped `tsc` with a canary (AC-72)**, procedure below | Canary TS2322 reported, then the clean run |
| V-9 | `git diff --stat`, read before the diff | No deletion-only file, no `supabase/migrations` path, only `adminFormat.ts` and its test in the shared folder, the requirement MD untouched |
| V-10 | `npm run schema:check` if the worktree has credentials, otherwise the note in the Verification Log | Output or the note |
| V-11 | **Read-only SQL checks 10 to 13 for the user** (§13), at QA time | See the table below |

**V-8 procedure** (SA-WR-7):
1. Write a tsconfig **outside the worktree**, in the session scratchpad. It has an absolute `extends` to the worktree's `tsconfig.json`, `compilerOptions: { noEmit: true, incremental: false }`, and `include` = the worktree's `types/**/*.d.ts`, `next-env.d.ts`, and every touched and new `.ts` / `.tsx` file (absolute paths).
2. Plant `const __canary: number = 'x';` in `lib/business-os/finance/paymentProblems.ts`.
3. Run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p <scratch config>` and record its own exit code. It **must** report TS2322 at the canary, or the run is not evidence.
4. Remove the canary (`grep -c __canary` = 0) and re-run.
5. Record every diagnostic: zero in touched files, and any pre-existing one attributed by path. 2a saw three outside the diff: `MemoryManager.ts` ×2 and `CalibrationSessionRepository.ts` ×1.

The scratch config is never written into the worktree.

**V-11, the user's read-only SQL checks.** Run them in the Supabase SQL editor, with the page on "This month" and "All businesses".

| Check | Page figure | Match |
|---|---|---|
| 10 | Overdue invoices per currency | `marked_overdue` = Marked overdue; `sent_past_due` = Past due, not marked; `amount` = Invoice amount; `businesses` = Businesses; `oldest_due_date` = Oldest due date. Today: 16 marked, 0 past due (LC §3) |
| 11 | Overdue instalments per currency | `marked_overdue`, `pending_past_due`, `amount`, `businesses`, `oldest_due_date`. Today: 1 marked, 2 pending past due (due 2026-10-05) |
| 12 | Client plans | Per status `plans`; Σ `cancelled_this_month` = Cancelled in this window; Σ `completed_this_month`; Σ `next_charge_overdue`; Σ `failure_recorded` = 0 matches "Not recorded". Today: active 5, cancelled 1 |
| 13 | Reminder health | `stuck` (all time) ≥ the page's stuck figure, and both are 0 today; `dead_lettered` (all time) ≥ the 7 d dead-lettered figure (the page is windowed, the check is not); the processing count ≥ in progress. The page must also equal the Jobs & queues `payment_reminders` card read at the same time |

**Manual QA steps (AC-73), continuing from 2a's L-31.** Run `npm run dev` from `neuronforge-finance-health`, signed in as a platform admin.

| # | Step | Expected |
|---|---|---|
| L-32 | Open `/admin/finance` | "Client payment problems" is the last block, after Credits. It has "The businesses' problem, not ours", its subtitle ("As of now, UTC"), and five parts, each with its own status chip |
| L-33 | Read the failed-payments part | The fixed "not available" sentence, never a 0; "Failed client plan charges: Not recorded"; "Instalment retries: not recorded" |
| L-34 | Run checks 10 and 11 | Every V-11 row for 10 and 11 matches. "Invoice amount" / "Instalment amount" with the not-owed note; no line adds two currencies; due dates read `YYYY-MM-DD` |
| L-35 | Look at the 2 pending instalments due 2026-10-05 | "Past due, still pending", with days past due = today's UTC date − 5 October |
| L-36 | Run check 12 | Status counts, active now and cancelled match; switch to 7d and to a custom range: cancelled follows the window, while the overdue parts and active now do not change |
| L-37 | Run check 13 and open Jobs & queues | The reminder figures equal the `payment_reminders` card; no colour on the finance figures; the link lands on the Queues section |
| L-38 | Pick one business with an overdue invoice, then reload the URL | Only its rows; the reminder part shows the platform-wide note and the link; the reload reproduces the view |
| L-39 | Signed out, then as a non-admin, call `/api/admin/business-os/finance` | 401 / 403, `no-store`, no figures |
| L-40 | Read the dev-server log | One "Admin read the Business OS finance page" line with `sections.paymentProblems` and `counts.paymentProblems` (counts and states only), plus the repository's "… of all accounts read" lines. No amount, due date, currency code or name. **Record `durationMs`** for All businesses and for one business (SA-Q17), and `counts.paymentProblems.reminderMs` |

---

## Logging

- **New lines:**
  - R-g / R-h / R-i: `info` `{ method, rows, reachedCeiling, durationMs }`.
  - The account-scoped reads: `debug` `{ method, rows, reachedCeiling }`.
  - Guard refusals: `warn` (existing `fail`).
  - Builder read failures: `error` `{ read, err }` through the existing `failed`, with `read` one of `client_overdue_invoices`, `client_overdue_instalments`, `client_plans`, `reminders`, `overdue_names`.
- **The reminder read** logs its own info line in the repository (`AdminJobsQueuesRepository.ts:547-559`): correlation id, admin id and counts. That is unchanged.
- **The route's accountability line** gains `sections.paymentProblems` and `counts.paymentProblems`: counts, booleans and state words only.
- **Never logged:** an amount, a currency, a due date, a business name, an email, or an account id at info. The route's validated `accountId` filter is the existing exception.
- Errors are logged as `{ err }`. There is no `console.*` (T5 and T8 pin it).

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A due date shifts by a day in some zone (INV-00013) | Date-only strings end to end; `formatUtcDate` returns its input text; `dueDates.ts` has no `new Date` / `Date.parse` (T5); AC-74 in two zones with a non-vacuity control |
| R-2 | The UTC-midnight edge is off by one | AC-57 at 23:59 and 00:01 UTC; "equal to today is not past due" is pinned |
| R-3 | A guard trips that §12.2 does not list (the 1a SA-W2 lesson) | Every guard that scans the finance files, the repositories folder, the shared folder, the payment tables or the jobs repository was opened and is in the guard table; V-3 to V-5 run them all; the isolation guard's import-path match is answered by SA-W35 |
| R-4 | The pager refactor changes 2a | SA-W28: the 2a T1 describes are not edited and must pass; the call order and log text are preserved |
| R-5 | The reminder read slows the page | An explicit 2 s deadline with abort; it is not called with a business picked; `reminderMs` and `durationMs` are recorded (L-40) |
| R-6 | The block hides parts when one fails | SA-W31: the frame is never `unknown`; each part has its own status (AC-66) |
| R-7 | Client data travels | Exact column lists with no client column (T1); the payload walker (T6); ids are shown short |
| R-8 | An amount is read as "what is owed" | "Invoice amount" / "Instalment amount" labels and the note (S2-F7); T7 |
| R-9 | `.or()` injection through the date | A strict `YYYY-MM-DD` round-trip check before any query; the date is server-computed; T1 refusal cases |
| R-10 | The requirement file is rewritten whole and loses lines | Dev does not edit it (TL records the link; BA edits E-11 to E-13 go to an Edit-capable agent, 2a lesson 1). Line count and `git diff --stat` are checked after any edit |
| R-11 | The junction | Never `git worktree remove` or `git stash`; stop rather than `npm install` |

---

## Estimate

About **2.5 days**, as the requirement sets (§11A.0). The full cycle for `formatUtcDate` makes this the tighter half, so I report at the end of day 2 if it slips (SA, slice 2 review).

| Day | Work |
|---|---|
| 0.5 | Pager generalised (2a T1 green unedited), R-g to R-i′, header, barrel, T1 |
| 1.0 | `formatUtcDate` + T9; `dueDates.ts` + T2; `paymentProblems.ts` + T3 |
| 1.5 | Types, builder (reads, deadline read, names, counts), wiring, route; T4, T6 |
| 2.0 | `PaymentProblemsSection.tsx`, `OverdueTable.tsx`, copy, view order; T7; the finance source guard edits (T5) |
| 2.5 | V-1 to V-10, the canary run, fixes; results pasted |

---

## Task List

- ✅ 0. SA workplan review: APPROVED WITH CONDITIONS; SA-W28 to SA-W40 built as approved; SA-WR-20 to SA-WR-25 applied (see Implementation Notes). E-11 to E-14 are BA's, applied in parallel; not edited here
- ✅ 1. Branch `feature/bos-finance-health-2b` confirmed (`git branch --show-current`); junction present; nothing committed, nothing stashed
- ✅ 2. Pager generalised (SA-W28); 2a T1 describes green and unedited (SA-WR-20)
- ✅ 3. R-g, R-g′, R-h, R-h′, R-i, R-i′, column constants, row types, `todayUtc` check, header; barrel exports; T1 (AC-57 string, AC-62, AC-64, SA-W40, SA-WR-25)
- ✅ 4. `formatUtcDate` + T9 (AC-74, full cycle, SA-WR-21)
- ✅ 5. `dueDates.ts` + T2 (AC-57, AC-74)
- ✅ 6. `paymentProblems.ts` + T3 (AC-56 to AC-63 method; SA-W35 to SA-W39, SA-WR-22)
- ✅ 7. `financeTypes.ts`; `financeHealth.ts` (reads, deadline read, names, counts); `financeHealthDeps.ts`; T4 (AC-56, AC-57, AC-59, AC-65, AC-66, AC-67, SA-WR-23)
- ✅ 8. Route binding and info line; T6 (AC-45, AC-46, AC-61, AC-64, AC-65, AC-66, AC-69, SA-WR-24)
- ✅ 9. `PaymentProblemsSection.tsx`, `OverdueTable.tsx`, `FinanceView` order, `financeCopy.ts`; T7 (AC-56 to AC-63, AC-65 to AC-68, AC-74)
- ✅ 10. Finance source guard: eight-table pin, `LAYER_B_METHODS`, AC-61 / SA-W29 rules, date-only rule, client-data rule, wording, non-vacuity, planted controls (T5)
- ✅ 11. V-1 to V-10, outputs pasted in Implementation Notes
- ✅ 12. Hand over to SA code review, uncommitted

---

## Implementation Notes

**Dev, 2026-10-12.** Built on `feature/bos-finance-health-2b` in worktree `neuronforge-finance-health`. Nothing committed or stashed. The requirement MD was not edited by Dev: its diff in `git status` is BA's E-11 to E-14, applied in parallel.

### Files

| Action | File |
|---|---|
| Created | `lib/business-os/finance/dueDates.ts`, `lib/business-os/finance/paymentProblems.ts`, `app/admin/finance/components/PaymentProblemsSection.tsx`, `app/admin/finance/components/OverdueTable.tsx` |
| Created (tests) | `lib/business-os/finance/__tests__/dueDates.test.ts`, `lib/business-os/finance/__tests__/paymentProblems.test.ts` |
| Modified | `lib/repositories/BusinessOsFinanceReadRepository.ts`, `lib/repositories/index.ts`, `lib/business-os/finance/financeTypes.ts`, `financeHealth.ts`, `financeHealthDeps.ts`, `app/api/admin/business-os/finance/route.ts`, `app/admin/components/layout/adminFormat.ts`, `app/admin/finance/financeCopy.ts`, `app/admin/finance/components/FinanceView.tsx` |
| Modified (tests) | the repository test, `adminFormat.test.ts`, `financeHealth.test.ts`, `finance.source.guard.test.ts`, the finance `route.test.ts`, `financePage.render.test.tsx` |

### Required changes

- **SA-WR-20 (pager).** `pageClientRows(method, start, prepare, noun, scope, opts)`. `prepare` is called inside the `try`, after the account-id check and before the option checks, which is the 2a order. The 2a methods pass `rangeFilter(col, range)` and their 2a nouns, so the log text is unchanged; the unedited 2a describes assert it. The `git diff` hunks on the repository test are `@@ -14,6 +14,14 @@` (header lines added), `@@ -45,6 +53,12 @@` (a second, separate import added), `@@ -58,7 +72,7 @@` (**the one deleted line: the recording-client method list, which gains `'or'`**) and `@@ -508,3 +522,252 @@` (2b describes appended). Numstat is 264 added and 1 deleted.
- **SA-WR-21 (`formatUtcDate`).** `adminFormat.ts` diff is 15 added and 0 deleted: the import `@/app/admin/components/adminWindowPresets` (`isRealDate`) and the function. The header line was left unchanged, as SA-WR-21 asks. `adminFormat.test.ts` diff is 46 added and 0 deleted: a separate import line and a new describe. Importer suites are in V-5b below.
- **SA-WR-22.** `paymentProblems.test.ts` extracts the `status ... CHECK (status IN (...))` list from `20260828e_payment_plan_subscriptions.sql`. It asserts six values and equality with `CLIENT_PLAN_STATUSES`, in order, plus a planted control.
- **SA-WR-23.** `REMINDER_DEADLINE_MS: 2 * 1000` is pinned three ways: equal to 2000, different from `ADMIN_READ_DEADLINE_MS`, and the source text `2 * 1000`. A fake-timer test shows a never-settling reader still pending at 1,999 ms, then `failed` at 2,000 ms with its received signal `aborted`. A second test shows the reminder read starts while another read in the same `Promise.all` has not settled.
- **SA-WR-24.** The route test asserts exactly `({ correlationId: 'corr-2b-test', adminId: ADMIN.id }, 'payment_reminders', <Date>, { signal })`. The fourth argument's only key is `signal`. With `accountId`, there are zero calls.
- **SA-WR-25.** T1 pins `status.eq.overdue,and(status.eq.sent,due_date.lt.2026-10-01)` and its `pending` twin: exactly one `or` call, with no `eq` / `gte` / `lt`. These are refused before `from` is called: `''`, `'2026-02-30'`, `'2026-10-01T00:00:00Z'`, `'2026-10-01,status.eq.paid'`, `'26-10-01'` and a `Date`.

### Deviations and decisions (for SA)

1. **AC-61 vocabulary rule.** The rule matches `dead-letter` case-sensitively, on code with comments removed. The page's own words are "Dead-lettered (24 h)", the Jobs page label. The test ids were named `deadlettered-*` so the marker word never appears in finance code. A planted control proves the page words pass and the marker text is caught.
2. **The `'sent'` / `'pending'` pin** matches a quoted literal **or** `.eq.sent` / `.eq.pending`. In the repository the literals sit inside the `.or()` template, not quoted. The holders are exactly the repository and `paymentProblems.ts`. The copy's unquoted key `pending:` and the sentence "still pending" do not match, and there is a planted control for that.
3. **Client plans `partial` on an unreadable time.** `unreadableTimes > 0` makes the plans part `partial`, matching the unreadable-amount rule. A NULL time is "not set" and is never counted as unreadable.
4. **The reminder part when it fails.** The part chip says "Could not load this part", and the body says "Could not check reminders" with the link. `Part` takes an `unknownBody` for this, so the link never disappears.
5. **Tests that changed beyond pure additions, as the 2b design required:**
   - the route test's payload key list gains `paymentProblems`;
   - its `mockDeps.finance` length goes from 7 to 13;
   - the 2a wiring test in `financeHealth.test.ts` goes from 7 keys to 13;
   - the finance guard's five-table pin becomes eight (S2-F1);
   - the guard's `LAYER_B_FREE` regex gains `payment_invoices`.
6. **Pre-existing defect found, not fixed (out of scope).** `finance.source.guard.test.ts:124` (at HEAD, before 2b) contains a literal backspace character (`\x08`) where `\b` was meant: `/['"`]\s*(===|!==)\s*\w*\.cohort<BS>/`. That cohort rule can never match, so it is vacuous. The same character also appears in `app/admin/business-os-llm/__tests__/ledgerPanel.render.test.tsx` and `app/admin/components/__tests__/AdminSidebar.nav.test.ts`. Recommend a separate fix.

`console.*` in the touched files: **0 calls**. The only match is the guard's own `/\bconsole\./` rule in `finance.source.guard.test.ts`.

### Verification (real output)

| # | Command | Result |
|---|---|---|
| V-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts app/admin/components/layout/__tests__/adminFormat.test.ts --ci` | **17 suites, 1,202 tests passed, exit 0.** Repository 194, builder 72, route 49, page (3 suites) 85, finance guard 476, dueDates + paymentProblems 43, adminFormat 12 |
| V-1a | Finance source guard alone | 476 passed |
| V-2 | `npx jest app/api/admin/users app/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`, then `git diff --exit-code -- app/api/admin/users app/admin/users lib/business-os/credits` | 22 suites, 567 tests passed, exit 0; diff exit 0 |
| V-3 | `npm run test:bos-entitlements` | 239 suites, 6,982 tests passed, exit 0 |
| V-4 | `npm run test:authz-guard` | 2 suites, 203 tests passed, exit 0 |
| V-5 | Every V-5 path (Stripe guards ×3, `dateOnlyIsNotMidnightUTC`, write-lockdown, `adminReadMethods`, jobs-queues isolation + items, `lib/admin/jobs`, health-summary, jobs-queues routes, layout folder incl. `layoutFolder.guard`, `serviceColumn.guard`, `lib/admin/health`, `AdminSidebar.nav`) | **50 suites, 1,853 tests passed, exit 0.** The first run had 1 failure in `app/api/admin/jobs-queues/__tests__/qa-slice5-pr2.route.test.ts`, a real-time 5 s deadline test under load. That file is unchanged; it passed alone (11/11), in its folder twice (384/384), and in the full re-run. `git diff --exit-code` on every V-5 path except the layout folder: exit 0. Layout folder diff: only `adminFormat.ts` and its test, insertions only |
| V-5b | SA-WR-21 importers: `npx jest app/admin/analytics app/admin/archiving app/admin/audit-trail app/admin/users app/admin/business-os-tiers app/admin/components app/admin/__tests__ --ci` (`components` covers jobs, health and the layout folder; `__tests__` covers `jobsQueues.render`) | 76 suites, 1,900 tests passed, exit 0. No importer suite edited |
| V-6 | `npm run lint:hooks` | exit 0 |
| V-7 | `npx eslint` on all 22 touched / new `.ts` / `.tsx` files | 0 errors, 0 warnings, exit 0. Three unused-variable warnings in two new tests were fixed first |
| V-8 | Scoped `tsc` (config in the session scratchpad: absolute `extends`, `noEmit`, `incremental: false`, include = `types/**/*.d.ts` and the 22 changed files) | With the canary: exit 2, `paymentProblems.ts(342,7): error TS2322`. Canary removed (`grep -c __canary` = 0). Clean run: exit 2 with **0 errors in changed files**; 3 pre-existing outside the diff (`MemoryManager.ts` ×2, `CalibrationSessionRepository.ts` ×1, as in 2a) |
| V-9 | `git diff --numstat` | No file has deletions without insertions. No `supabase/migrations` path. In the shared folder, only `adminFormat.ts` and its test. The requirement MD diff is BA's, not Dev's |
| V-10 | `npm run schema:check` | Not run: the worktree has only `.env.example`, no credentials. Columns are as recorded in the Verification Log (LC §1 plus the migrations) |

### Fix round 1 (Dev, 2026-10-12)

Still uncommitted, with nothing stashed. The requirement MD was not edited.

- **SA-CR-1.** `finance.source.guard.test.ts:145`: the literal 0x08 byte is now the two characters `\b`, so the rule is `/['"`]\s*(===|!==)\s*\w*\.cohort\b/`. I added a planted control, "the cohort-literal rules bite":
  - `'champion' === row.cohort` is caught;
  - `'x' === row.cohortExpiresAt` is not;
  - `row.cohort === 'champion'` is caught by the sibling rule.

  The corrected rule passes on today's code. `grep -nP "\x08"` on the guard file returns nothing (exit 1). `ledgerPanel.render.test.tsx` and `AdminSidebar.nav.test.ts` were not touched.
- **QA-1.** "Not recorded: no failure has ever been stored" now shows only when the plans read was complete (`exact` and part status `ok`). Otherwise the line reads the new copy string `PROBLEMS_FAILED_NONE_IN_READ`: "No failure found in the rows read (not every plan was read)". `paymentProblems.ts` now says in a comment that `everRecorded` covers the rows read only.
  - Tests: one in `paymentProblems.test.ts` (ceiling with no failure gives `everRecorded: false`, `exact: false`, `partial`);
  - three in `financePage.render.test.tsx`: at the ceiling, partial from an unreadable time, and complete.
- **QA-2.** The reminder failure keeps `{ read, err }`, like every other finance read. I checked whether the error can carry client data, and it cannot:
  - R-j's queries are head counts filtered by fixed statuses and server-computed times;
  - `AdminJobsQueuesRepository`'s `asError` keeps a PostgREST error's message and code only;
  - a deadline is the fixed `ReadDeadlineError`.

  I added a comment at the call in `financeHealth.ts`, and corrected the builder line in this workplan, which had said "the error class name only". `readUnderDeadline.ts` is left unchanged, since it is outside 2b's scope; its "never logged as text" note concerns showing the error, and this page never shows it.

**Re-run results**

| Check | Result |
|---|---|
| Finance suites, guard included | 17 suites, 1,207 tests passed, exit 0. That is 5 more than before: 1 guard control, 1 builder test, 3 render tests |
| Businesses list | 567 passed; `git diff --exit-code` 0 |
| `test:bos-entitlements` | 6,982 passed, exit 0 |
| `test:authz-guard` | 203 passed, exit 0 |
| `lint:hooks` | exit 0 |
| ESLint on touched files | exit 0, no output |
| Scoped tsc (config in the scratchpad) | The canary was caught: `paymentProblems.ts(343,7)` TS2322. After removal (`grep -c __canary` = 0), 0 errors in changed files; the same 3 errors outside the diff remain |
| `git diff --stat` | 16 files, 2,209 insertions, 85 deletions. No file has deletions without insertions |

---

## SA Workplan Review

**Reviewed by SA — 2026-10-12, against `045a4d06`**
**Status:** ✅ **APPROVED WITH CONDITIONS.** Proceed, applying SA-WR-20 to SA-WR-25 as you build; SA checks them at code review. BA applies E-11 to E-14 below. Coding does not wait for them, but V-11 and QA do.

**How it was checked.** I opened the code:
- `readUnderDeadline.ts:41-85`: `run(signal)` returns `RepoResult`; the explicit `deadlineMs` argument exists, aborts the signal and clears its timer;
- `AdminJobsQueuesRepository.ts:48, 54, 78-90, 201-223`;
- the isolation guard's text match, import paths included;
- `adminReadMethods` `ADMIN_METHODS`, which does not list `readQueueFiguresAllAccounts`;
- `20260828e:61-62`, the plan status CHECK: `pending, active, past_due, paused, completed, cancelled`;
- layout standard §5.11, "Date: `YYYY-MM-DD`";
- `adminFormat.ts`, which has no imports today and is imported by about 22 admin files (Analytics, Archiving, Audit trail, Plans, Health, Jobs, Businesses, finance takings);
- the S-3 presets exception in `layoutFolder.guard`;
- the current finance files, which contain no `'sent'`, `'pending'`, `'processing'`, `claimed_at`, `error_message` or `690` literal, so the SA-W29 positive pins start clean;
- requirement S2-CUR-5, S2-FR-23, §11A.7 R-h / R-i and AC-74 as they stand.

**Confirmed:**
- **R-g to R-i′:** named pairs, UUID refused before any query, `.eq('user_id')` on every page, keyset on `id`, page 1,000, ceiling 5,000 with the `>=` rule ("At least"). The `.or()` is built only from fixed status literals and a strict `YYYY-MM-DD`. No `livemode`. Columns hold no client data.
- **R-j:** reused through a structural reader injected by the route (the health-summary precedent), under an explicit 2 s `underDeadline`, and not called with a business picked.
- **Finance source guard:** the table pin grows to eight tables, with planted controls including the `payment_plans` near miss.
- **Not tripped:** the jobs-queues isolation guard, `adminReadMethods`, the three Stripe guards, `dateOnlyIsNotMidnightUTC`, the write-lockdown scan, the layout guard (no new file in the folder; the import is the named exception) and the entitlements suite.
- **Due dates:** handled as date-only strings end to end. `todayUtc`, `isRealDate` and `inclusiveDays` anchor at `T00:00:00.000Z` and read back in UTC.
- **AC mapping:** every 2b AC (AC-56 to AC-67 and AC-74) and every re-run (AC-45, AC-46, AC-68 to AC-73) is mapped.
- **Canary:** in `paymentProblems.ts`, scratch config outside the worktree.
- **Estimate:** 2.5 days, accepted. Report at the end of day 2 if it slips.

### Rulings SA-W28 to SA-W40

| # | Ruling |
|---|---|
| **SA-W28** | **Approved.** Generalise the pager with `prepare` called inside its `try`. The chain order and the 2a log text do not change. The proof is SA-WR-20. |
| **SA-W29** | **Approved as proposed.**<br>• A forbidden reminder vocabulary over `FILES`.<br>• `readQueueFiguresAllAccounts` and the repository and singleton names appear only in `route.ts`.<br>• The `'sent'` / `'pending'` literals appear only in the repository and `paymentProblems.ts`.<br>All three are positive pins with planted controls. `'failed'` is not banned, because it is also the credit pass outcome. |
| **SA-W30** | **Approved.** The overdue tables keep date order. Ordering by a date ranks no money across currencies, and the per-currency lines stay currency-first. BA edit **E-11**. |
| **SA-W31** | **Approved.** The block frame is never `unknown`: it is `partial` when any part is `partial` or `unknown`, and `ok` otherwise. Each part carries its own `StatusChip`, and `FinanceSection` is unchanged. This is a requirement gap, so it gets BA edit **E-14**. |
| **SA-W32** | **Approved: `YYYY-MM-DD` per §5.11.** My slice 2 review wrote "30 September"; the intent was the same calendar date. BA edit **E-12**. |
| **SA-W33** | **Approved.** `dueDates.ts` builds on `todayUtc`, `isRealDate` and `inclusiveDays`, with no `new Date(` or `Date.parse(` in it or in the body of `formatUtcDate`. A due date that is not a real date is "unknown": counted, and never past due. |
| **SA-W34** | **Approved: drop `subscription_id` and the plan `currency`.** Nothing reads them. BA edit **E-13**. |
| **SA-W35** | **Approved.** A structural `FinanceReminderFiguresInput`, checked field by field. A malformed result makes the part `unknown`, never 0. |
| **SA-W36** | **Approved.** An `overdue` invoice with no due date counts as marked, with "Unknown" date and days. It sorts last and is left out of the oldest due date, matching check 10's `min()`. |
| **SA-W37** | **Approved.** Failed plan charges are conditional on `last_failure_at`. "Instalment retries: not recorded (no retry time is stored)" is fixed copy and never a number. |
| **SA-W38** | **Approved.** One names call over the union of the shown rows (at most 100 ids), using only ids from rows read. |
| **SA-W39** | **Approved.** `CLIENT_PLAN_STATUSES` is literal data, checked against the migration CHECK by a test (the SA-W2 method). Statuses are matched exactly; "active now" is exactly `active`, as in check 12. |
| **SA-W40** | **Approved.** One new test, built from parts with a planted control. |

### Required changes (apply while building; SA verifies at code review)

1. **SA-WR-20 (Medium). The pager refactor (SA-W28).** `git diff` on `BusinessOsFinanceReadRepository.test.ts` may show deletions only on the recording-client method-list line (`:61`, gaining `or`). Every 2a `describe` and pin is otherwise byte-identical. The 2a log messages are unchanged word for word (asserted). Paste the diff hunk list in Implementation Notes.
2. **SA-WR-21 (Medium). `formatUtcDate` is the first import in a shared file with about 22 importers.**
   - Change nothing else in `adminFormat.ts`. The existing `adminFormat.test.ts` cases stay unedited and only gain cases.
   - V-5 adds the importer suites: `app/admin/analytics`, `app/admin/archiving`, `app/admin/audit-trail`, `app/admin/users`, `app/admin/business-os-tiers`, `app/admin/components/jobs` and `app/admin/components/health`. Run them unchanged.
   - `layoutFolder.guard` runs unchanged; the import is exactly `@/app/admin/components/adminWindowPresets`.
3. **SA-WR-22 (Low). Plan statuses.** `CLIENT_PLAN_STATUSES` equals the CHECK list extracted from `20260828e_payment_plan_subscriptions.sql`, with a non-vacuity check that the extraction found six values.
4. **SA-WR-23 (Low). The deadline.**
   - `FINANCE_LIMITS.REMINDER_DEADLINE_MS` is written `2 * 1000`, with a pin that it equals 2000 and differs from `ADMIN_READ_DEADLINE_MS`.
   - With fake timers, a never-settling reader gives `failed`, and its received signal is `aborted`.
   - The reminder read runs inside the same `Promise.all` as the other reads, never after them.
5. **SA-WR-24 (Low). The route binding.** The route test asserts `readQueueFiguresAllAccounts` is called with exactly `({ correlationId, adminId: <gate user> }, 'payment_reminders', <Date>, { signal })`, and with zero calls when `accountId` is set.
6. **SA-WR-25 (Low). The overdue `.or()` string.** T1 pins the exact string for one valid date, and refuses `'2026-10-01,status.eq.paid'`, a timestamp and `'2026-02-30'` before `from` is called. The validator never accepts anything but `^\d{4}-\d{2}-\d{2}$` that round-trips.

### Requirement edits (BA applies; recorded in §0.3 as SA-WP-2b)

- **E-11 (SA-W30).** Append to the S2-CUR-5 cell: " A list sorted by a date (the overdue invoice and instalment tables) keeps its date order; no amount is compared across currencies, and every amount cell names its currency."
- **E-12 (SA-W32).** In AC-74, replace "renders as 30 September" with "renders as `2026-09-30` (never `2026-09-29` or `2026-10-01`), the layout standard's date format (§5.11)".
- **E-13 (SA-W34).** In §11A.7:
  - the R-h Columns cell becomes `id, user_id, amount, currency, status, due_date`;
  - the R-i Columns cell becomes `id, user_id, status, cancelled_at, completed_at, next_charge_at, last_failure_at`.
- **E-14 (SA-W31).** Append to the S2-FR-23 cell: " The block's own status is never `unknown`: it is `partial` when any part is `partial` or `unknown`, and `ok` otherwise, so a failed part never hides the others; each part shows its own status in words."

---

## SA Code Review

**Code Review by SA — 2026-10-12**
**Status:** ✅ **APPROVED WITH CONDITIONS. Code approved for QA.** There is one condition, SA-CR-1 below, a one-character fix with a planted control, made in this slice's fix round. It does not block QA.

**How it was checked.** I read every changed and new file: 15 modified and 6 new.

**My own runs (all green):**
- The finance lib, page and route, the repository test, the shared layout folder, `AdminJobsQueuesRepository`, `adminReadMethods`, the Stripe guards, `lib/payments` (including `dateOnlyIsNotMidnightUTC`) and `app/api/admin/jobs-queues`: 85 suites, 2,867 tests.
- `test:bos-entitlements`: 239 suites, 6,982 tests.
- `test:authz-guard`: 203 tests.

### Required changes

| Item | Verdict |
|---|---|
| **SA-WR-20** | ✅ The only deleted line in the repository test is the recording-client method list (it gains `'or'`). Every 2a describe passes unedited, so the 2a log text is unchanged. |
| **SA-WR-21** | ✅ `adminFormat.ts` has insertions only (15/0): one import of the S-3 presets exception, and `formatUtcDate`, which returns the date's own text after `isRealDate` and never builds a Date. Its test has insertions only. Dev's 76 importer suites were run unchanged. |
| **SA-WR-22** | ✅ `CLIENT_PLAN_STATUSES` is extracted from the `20260828e` CHECK, checked to be six values, compared in order, with a planted control. |
| **SA-WR-23** | ✅ `2 * 1000` is pinned three ways. With fake timers, the read is still pending at 1,999 ms and `failed` at 2,000 ms, with the signal aborted. It runs inside the same `Promise.all`. |
| **SA-WR-24** | ✅ The exact `({ correlationId, adminId }, 'payment_reminders', <Date>, { signal })` call is asserted, with zero calls when a business is picked. |
| **SA-WR-25** | ✅ The exact `.or()` strings for invoices and instalments are pinned. Six bad dates are refused before `from` is called. |

### Deviations

| # | Ruling |
|---|---|
| D-1 | **Approved.** The dead-letter word is matched case-sensitively, on code with comments removed. The page's "Dead-lettered" label is the Jobs page's own word, and a planted control proves the marker text is caught. |
| D-2 | **Approved.** The pin must see `.eq.sent` / `.eq.pending` inside the `.or()` template, or the repository would be invisible to it. The holders are exactly the repository and `paymentProblems.ts`. |
| D-3 | **Approved.** An unreadable plan time makes the plans part `partial`, consistent with the unreadable-amount rule. A NULL time is "not set", never unreadable. |
| D-4 | **Approved.** These are the edits the 2b design forces: the payload key, 7 → 13 keys, the table pin 5 → 8, and `payment_invoices` in `LAYER_B_FREE`. Each one adds, and none weakens a rule. |

**Also verified:**
- **Due dates.** `due_date` stays date-only everywhere. `dueDates.ts` compares the text after `isRealDate` and counts days through `inclusiveDays`. `Date.parse` appears only on real timestamps (plan times, the oldest due instant). AC-74 is tested in `adminFormat.test.ts` (two zones) and in the render test (`2026-09-30`).
- **Overdue amounts.** They are per currency through `groupByCurrency`, labelled "Invoice amount" / "Instalment amount" with the not-owed note, and never summed across currencies.
- **Failed client payments.** The panel is the fixed `not_stored` part, with no number.
- **Block frame.** It is `partial` or `ok` only; `unknown` never reaches `FinanceSection`.
- **Picked business.** Only R-g′, R-h′ and R-i′ run, with exactly the id. The reminder read is skipped (`not_narrowed`).
- **Ceiling.** At 5,000 rows every count and amount reads "At least", with the "among the rows read" note.
- **Route.** `requireAdmin` is still first. The info line carries counts, booleans and state words only.
- **Data.** The column lists hold no client columns, and no amount, due date or name is logged.
- **The `qa-slice5-pr2` failure is pre-existing and unrelated.** The file is unchanged in this diff; its last change is `5768ca41`. Its test at `:113-115` asserts wall-clock `Date.now() - started < 1000` with real timers, which can fail under parallel load. It passed in my run. Tracking it is a separate item, not part of 2b.

### Code Review Comments

1. **SA-CR-1 (Medium): the cohort rule can never fail.** In `lib/business-os/finance/__tests__/finance.source.guard.test.ts:145`, the regex `/['"`]\s*(===|!==)\s*\w*\.cohort<0x08>/` holds a literal backspace byte where `\b` was meant.
   - **Fix:** replace the byte with `\b`, and add a planted control asserting the rule matches `if ('champion' === row.cohort)` but not `'x' === row.cohortExpiresAt`.
   - **SA ran the corrected rule** over the same 32 files and comment stripper. It finds **no match**, so the fix passes on today's code. What it would catch: a quoted cohort id compared on the left of `===` / `!==` with a `.cohort` property (`'champion' === row.cohort`), the mirror of the line above it. Both controls behave as stated.
   - Do not touch the same defect in `ledgerPanel.render.test.tsx` or `AdminSidebar.nav.test.ts`: those are a separate task.

### Code Approved for QA: **Yes**

QA owes V-11 (checks 10 to 13) and L-32 to L-40, including `durationMs` and `reminderMs`. SA re-checks SA-CR-1 in the fix round.

---

## QA Report

**QA — 2026-10-12**
**Test mode:** full (2b ACs and the 2b re-runs)
**Strategy used:** A (unit) + B (route and builder integration with mocked deps), re-run from the worktree; scoped `tsc` with canary; code reading for the edge cases; D (manual browser check) **listed for the user**, because it needs an admin login.
**Focus:** all (api, ui, schema, security)
**Skipped:** the live browser path and §13 SQL checks 10 to 13 (QA does not run SQL against production). The steps for the user are L-32 to L-41 below.
**Input source:** prompt keywords from TL.
**Verdict:** ✅ **PASS WITH ISSUES**. No bug found. Every 2b AC that Jest can test passes. AC-73 (2b) and the live halves of AC-56, AC-58, AC-59 and AC-61 wait on the user's manual check. Two Low notes, neither blocking.

### Test runs (worktree `neuronforge-finance-health`, branch `feature/bos-finance-health-2b`, uncommitted)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts app/admin/components/layout/__tests__/adminFormat.test.ts --ci` (T1 to T9, the finance source guard included) | exit 0; **17 suites, 1,202 passed** |
| Q-2 | Businesses list: `npx jest app/api/admin/users app/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`, then `git diff --exit-code -- app/api/admin/users app/admin/users lib/business-os/credits` | exit 0; **22 suites, 567 passed**; diff **exit 0** |
| Q-3 | V-5 set, run unchanged: the three Stripe guards, `dateOnlyIsNotMidnightUTC`, write lockdown, `adminReadMethods.guard`, jobs-queues isolation (`AdminJobsQueuesRepository` + `.items`), `lib/admin/jobs`, `app/api/admin/health-summary`, `app/api/admin/jobs-queues`, `app/admin/components/layout` (incl. `layoutFolder.guard`), `serviceColumn.guard`, `lib/admin/health`, `AdminSidebar.nav` | exit 0; **50 suites, 1,853 passed**. `qa-slice5-pr2.route.test.ts` **did not flake** in this run, so it did not need a separate run. `git diff --exit-code` on every path except the layout folder: **exit 0**. Layout folder numstat: `adminFormat.ts` +15 / −0, `adminFormat.test.ts` +46 / −0 (insertions only) |
| Q-4 | SA-WR-21 `adminFormat` importers: `npx jest app/admin/analytics app/admin/archiving app/admin/audit-trail app/admin/users app/admin/business-os-tiers app/admin/components app/admin/__tests__ --ci` | exit 0; **76 suites, 1,900 passed** |
| Q-5 | `npm run test:bos-entitlements` | exit 0; **239 suites, 6,982 passed** |
| Q-6 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-7 | `npm run lint:hooks` | exit 0 |
| Q-8 | Scoped `tsc`. Config: `tsconfig.qa-2b.json` in the session scratchpad (**outside the worktree**), with an absolute `extends`, `noEmit`, `incremental: false`, and `include` = `types/**/*.d.ts` + the 21 changed and new `.ts` / `.tsx` files | **Canary** (`const __qaCanary: number = "qa-canary";` appended to `paymentProblems.ts`): exit 2, `lib/business-os/finance/paymentProblems.ts(341,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Restored** from a byte copy (`cmp` identical, `grep -c qaCanary` = 0). Re-run: exit 2 with **0 diagnostics in changed or new files**. The 3 that remain are pre-existing and outside the diff (`MemoryManager.ts` ×2, `CalibrationSessionRepository.ts` ×1), the same as in 2a |
| Q-9 | `git diff --stat`, `git status --short` | 16 tracked files (+2,173 / −84), 7 new; no migration path; in the shared layout folder only `adminFormat.ts` and its test (insertions only) |

### Test Coverage (2b ACs and re-runs)

| AC | Result | Evidence |
|---|---|---|
| AC-45 (re-run) | ✅ Pass | T6 "AC-45: the six new reads and the reminder read are in allReads() …" and "AC-45 / AC-46 re-run: signed out, a non-admin and an invalid query each make zero 2b calls, R-j included" |
| AC-46 (re-run) | ✅ Pass | Same T6 test; the AC-4 / 33 / 34 cases green |
| AC-56 | ✅ Pass (Jest), live part manual | T3 "marked, past due, the full amount, businesses and the oldest due date per currency equal the SQL"; T4 "AC-56: switching the window leaves the overdue figures and active-now unchanged"; T7 "Invoice amount", not-owed note. Check 10: L-34 |
| AC-57 | ✅ Pass | T2 "a due date of 2026-09-30 is not past due at 23:59 UTC that day, and is 1 day past due at 00:01 UTC the next"; "a due date equal to today is never past due"; T4 "AC-57: R-g and R-h receive the UTC date of the request's clock"; T1 the exact `.or()` string (SA-WR-25) |
| AC-58 | ✅ Pass (Jest), live part manual | T3 "equals the SQL; pending is the unmarked status, not sent"; T7 "Instalment amount". Check 11: L-34, L-35 |
| AC-59 | ✅ Pass (Jest), live part manual | T3 statuses in order with zeros, half-open window, next charge overdue active-only; "the cancelled count follows the window"; T4; T7. Check 12: L-36 |
| AC-60 | ✅ Pass | T3 "no last_failure_at anywhere → never recorded"; "a failure in the window is counted"; T7 three AC-60 render cases (no 0, "Not recorded", "Could not check") |
| AC-61 | ✅ Pass (Jest), live part manual | T6 "SA-WR-24 / AC-61: R-j is called once with exactly ({ correlationId, adminId }, 'payment_reminders', <Date>, { signal }); the payload figures equal …"; T5 SA-W29 rules with planted controls; T7 "plain (no tone, no colour) … the link opens the Queues section". Check 13: L-37 |
| AC-62 | ✅ Pass | T1 small ceiling → `reachedCeiling`; T3 "at the ceiling: not exact, every amount 'at least', the part partial"; T7 "AC-62 … 'among the rows read'" |
| AC-63 | ✅ Pass | T3 "no overdue row → empty, ok"; "no client plan → … every known status shown at 0"; T7 "AC-63: empty parts say so in words, with no 0.00" |
| AC-64 | ✅ Pass | T1 column constants; T5 2b client-data rule; T6 "AC-64: no key under paymentProblems names client data" |
| AC-65 (2b) | ✅ Pass | T4 "exactly the id (and today's date); zero all-accounts calls; zero reminder calls; names at most [id]; the platform-wide note"; T6 "AC-65 / SA-WR-24 through the route"; T7 "AC-65" |
| AC-66 (2b) | ✅ Pass | T4 `it.each(failing)` for R-g / R-h / R-i, plus R-j errors / throws / malformed; T6 `it.each` and "R-j fails → 200 …"; T7 both AC-66 cases |
| AC-67 | ✅ Pass | T4 "is written 2 * 1000, equals 2000 and differs from the admin default deadline"; "a never-settling reader → still pending at 1,999 ms; at 2,000 ms 'failed', and the signal it received is aborted"; T7 "AC-66 / AC-67" |
| AC-68 (re-run) | ✅ Pass | T7 "AC-68: labelled tables with column headers, number cells tabular; every part chip has words; the KPI strip still has exactly five tiles" |
| AC-69 (re-run) | ✅ Pass | T6 "AC-69: the info line carries sections.paymentProblems and counts.paymentProblems …; no amount, currency, due date or name"; T4 "the counts: … no amount, currency, due date or name" |
| AC-70 (re-run) | ✅ Pass | T5 write-verb pins over the new files; T1 no-write pin unedited; Q-9 no migration |
| AC-71 (re-run) | ✅ Pass | Q-3 (Stripe guards unchanged), Q-5, Q-6 |
| AC-72 (re-run) | ✅ Pass | Q-8 |
| AC-73 (2b) | ⬜ NOT-TESTED | Manual L-32 to L-41 below |
| AC-74 | ✅ Pass | T9 "2026-09-30 renders as 2026-09-30 with the process in %s" (New York, Auckland) plus the non-vacuity control "the same date passed through Date really does move a day"; T2 the same zones; T7 "AC-74 … renders as 2026-09-30"; T5 no `new Date` / `Date.parse` in `dueDates.ts` |

### Edge cases (code and tests read)

| Edge case | Result | Evidence |
|---|---|---|
| Due date today / yesterday / across UTC midnight / time-zone offset | Confirmed, never shifted | `dueDates.ts`: `isPastDue` is a string compare after `isRealDate` (`dueDate < todayUtc`), so today is never past due and yesterday is 1 day. `todayUtc(now)` is computed once from the request clock (`financeHealth.ts`). `formatUtcDate` returns its own text, with no `Date`. T2 / T9 / T7 in New York and Auckland |
| Overdue invoice with no due date (SA-W36) | Confirmed | `paymentProblems.ts:127` counts it as marked; `:152` keeps it out of `oldestDueDate`; `:174, :182` give `dueDate` / `daysPastDue` null; it sorts last (`:187`). T3 SA-W36, T7 "Unknown" |
| Overdue amounts per currency, never summed, labelled the invoice amount | Confirmed | `groupByCurrency` per line (`:136-169`); the overall figure is a business count only; T3 "no line adds two currencies"; T7 "Invoice amount" / "Instalment amount" and the not-owed note |
| "Failed client payments not recorded" panel, never a 0 | Confirmed | `PaymentProblemsSection.tsx:150-153`: a fixed sentence with no status chip and no number; plan charges "Not recorded" / "Could not check" (`:192-194`). T7 AC-60 |
| Block frame never unknown, even when every part fails | Confirmed | `paymentProblemsStatus` (`paymentProblems.ts:330-332`) returns only `partial` or `ok`; with four failed parts it is `partial`. The failed-payments part has no read. T7 "the frame never says 'Could not load this section'" |
| Each part failing alone | Confirmed | Each read is `settle`d or under `underDeadline` (which never rejects, `readUnderDeadline.ts:41-85`); T4 / T6 `it.each` over R-g, R-h, R-i; R-j errors, throws and malformed results |
| 5,000 ceiling, "at least" | Confirmed | The pager's `>=` rule returns rows plus `reachedCeiling`; the part is `partial`; amounts and counts "At least"; "among the rows read". T1 / T3 / T7 AC-62 |
| Picked business: account-scoped reads only, no reminder read | Confirmed | R-g′ / R-h′ / R-i′ with `.eq('user_id')` after a UUID check; `accountId !== null` → `NOT_NARROWED`, no R-j call. T4 / T6 spies show zero all-accounts and zero R-j calls |
| Reminder 2 s deadline | Confirmed | `FINANCE_LIMITS.REMINDER_DEADLINE_MS = 2 * 1000`, passed explicitly to `underDeadline`; the timer aborts the signal. T4 fake timers (pending at 1,999, failed at 2,000, signal aborted) |
| Client plans: active now vs cancelled in the window | Confirmed | `paymentProblems.ts:251-254`: active now = `status === 'active'` (not windowed); cancelled / completed by timestamp in `[start, end)`. T3, T4 (window switch) |
| Unreadable plan time makes the plans part partial | Confirmed | `:231-239` counts an unparseable time (NULL is "not set"); `:278` status `partial`. T3 "an unreadable time is counted, never guessed, and makes the part partial" |
| No client data in logs | Confirmed | Column lists exclude client columns (T1); `counts.paymentProblems` is counts, booleans, state words and `reminderMs`; T6 planted amount, currency, due date and name appear in no log call |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None found in code. R-j runs inside the same `Promise.all` under its own 2 s cap (T4 asserts the start order). `durationMs` and `reminderMs` are owed from the live run (L-41).

#### Edge Cases / notes (Low)
1. **"Not recorded: no failure has ever been stored" is stated from the rows read** (`lib/business-os/finance/paymentProblems.ts:257`, rendered at `app/admin/finance/components/PaymentProblemsSection.tsx:193`). If the plans read hit its 5,000 ceiling, `everRecorded: false` would only describe the rows read, but the sentence claims "ever". There are 6 plans today, so this cannot happen soon. Suggest the "Could not check" or an "among the rows read" wording when `!exact`. Low.
2. **Reminder failures log the whole error object** (`lib/business-os/finance/financeHealth.ts:450`, `failed('reminders', reminderRead.error)` → `{ read, err }`). The workplan's Logging section says "the error class name only", and the `DeadlineRead` type comment (`readUnderDeadline.ts`) says its error is "never shown or logged as text". It is consistent with how every other finance read logs `{ err }`, and no client data can be in it. Low; SA to say which rule wins.

The pre-existing `\x08` (literal backspace instead of `\b`) in `finance.source.guard.test.ts:124` and two other test files, reported by Dev (deviation 6), is confirmed outside this slice's scope and still worth a separate fix.

### Manual live steps (continuing from 2a's L-31): for the user

Run `npm run dev` from `neuronforge-finance-health` and sign in as a platform admin. Keep the Supabase SQL editor open for §13 checks 10 to 13 (read-only; QA did not run them). Page on **This month**, **All businesses** unless a step says otherwise.

| # | Step | Expected |
|---|---|---|
| L-32 | Open `/admin/finance` and scroll to the end | "Client payment problems" is the last block, after Credits, with the chip "The businesses' problem, not ours", the subtitle "As of now, UTC (<today>) …", and five parts. Four have a status chip in words; the failed-payments part has none |
| L-33 | The failed-payments part | The fixed "not available" sentence and never a 0; "Failed client plan charges: Not recorded: no failure has ever been stored" (check 12 Σ `failure_recorded` = 0); "Instalment retries: not recorded" |
| L-34 | **Checks 10 and 11** vs Overdue invoices / Overdue instalments | Per currency: Marked overdue = `marked_overdue`; Past due, not marked / still pending = `sent_past_due` / `pending_past_due`; Invoice / Instalment amount = `amount` (to the cent, with the not-owed note); Businesses = `businesses`; Oldest due date = `oldest_due_date`, shown as `YYYY-MM-DD`. No line adds two currencies. Today, by the live check: 16 marked invoices, 1 marked + 2 pending-past-due instalments |
| L-35 | The two pending instalments due 2026-10-05 | Chip "Past due, still pending"; days past due = today's UTC date − 2026-10-05 (7 on 2026-10-12); the due date reads `2026-10-05`, not a day either side |
| L-36 | **Check 12** vs Client plans | Each status count = `plans` (every status shown, zeros included); Active now = the `active` row's `plans`; Cancelled / Completed in this window = Σ `cancelled_this_month` / Σ `completed_this_month`; Next charge overdue = Σ `next_charge_overdue`. Then switch to 7d and to a custom range: only Cancelled / Completed change; the overdue parts and Active now do not |
| L-37 | **Check 13** and the Jobs & queues link | Stuck on the page ≤ check 13 `stuck` (both 0 today); 7 d dead-lettered ≤ `dead_lettered`; in progress ≤ the `processing` row's count. Click "Open Jobs & queues": it lands on the Queues section, and its `payment_reminders` card shows the same figures. The finance figures carry no colour |
| L-38 | Pick one business that has an overdue invoice, then reload the URL | Only its rows and lines (spot-check check 10 with `and i.user_id = '<id>'`); client plans narrow to it; the reminder part says it is platform-wide, with the link and no figure; the reload reproduces the view |
| L-39 | A custom window that ends before today | The overdue parts and Active now are unchanged (as of now); Cancelled / Completed follow the window |
| L-40 | Signed out, then as a non-admin, call `/api/admin/business-os/finance` | 401 / 403, `Cache-Control: no-store`, no figures |
| L-41 | Dev-server log | One "Admin read the Business OS finance page" line per load with `sections.paymentProblems` and `counts.paymentProblems` (counts, booleans, state words, `reminderMs`), plus the repository's "… of all accounts read" lines and the Jobs & queues repository's own reminder info line. No amount, due date, currency code or name. **Record `durationMs`** for All businesses and for one business, and `reminderMs` (must stay well under 2,000) |

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] **Every 2b AC that Jest can test passes, and no bug is open.** AC-73 (2b) and the SQL halves of AC-56, AC-58, AC-59 and AC-61 need the user's manual run (L-32 to L-41) before commit. The two Low notes do not block.

---

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-12 | Created (Dev) | Slice 2b workplan: R-g to R-i′ (keyset on `id`, page 1,000, ceiling 5,000, rows plus `reachedCeiling`, `.or()` on a SELECT from literals and a validated UTC date), R-j reused from the route under an explicit 2 s deadline, `dueDates.ts` and the shared `formatUtcDate` (date-only, never `new Date`), the pure payment problems builder, the block on the shared layout parts, the finance source guard's eight-table pin and AC-61 rules, AC mapping, verification plan with the scoped `tsc` canary and SQL checks 10 to 13. Raises SA-W28 to SA-W40, with proposed BA edits E-11 to E-13. No code changed. |
| 2026-10-12 | SA workplan review: **APPROVED WITH CONDITIONS** | SA-W28 to SA-W40 approved as proposed. Required changes SA-WR-20 (2a pager tests byte-identical) and SA-WR-21 (`formatUtcDate`: about 22 importers of `adminFormat.ts` re-run) to SA-WR-25. Requirement edits E-11 (S2-CUR-5 date order), E-12 (AC-74 `2026-09-30`), E-13 (R-h / R-i columns) and E-14 (S2-FR-23 block never `unknown`) are for BA. Recorded in requirement §0.3 and Change History. |
| 2026-10-12 | Implemented (Dev): **Code Complete**, uncommitted | R-g to R-i′ with the generalised pager, `formatUtcDate`, `dueDates.ts`, `paymentProblems.ts`, builder, wiring, route binding of R-j, the block and its table, guard edits with planted controls. SA-WR-20 to SA-WR-25 applied. V-1 to V-10 results are in Implementation Notes. One pre-existing guard defect is flagged (a backspace character in the cohort rule). |
| 2026-10-12 | SA code review: **APPROVED WITH CONDITIONS** | All 21 code files read. SA-WR-20 to SA-WR-25 verified; D-1 to D-4 approved. SA re-ran 85 suites / 2,867 tests, `test:bos-entitlements` (6,982) and `test:authz-guard` (203), all green. Condition SA-CR-1: fix the backspace byte in the finance guard's cohort rule (`:145`) with a planted control; SA confirmed the corrected rule passes on today's code. The `qa-slice5-pr2` failure is a pre-existing wall-clock test, unrelated. Code approved for QA. |
