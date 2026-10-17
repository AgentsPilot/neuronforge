# Workplan: Business OS Finance & Business Health — Slice 4b.2 (Refund and dispute display from the reversal events)

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §11I (4b.2 parts: FR-4B-1 to FR-4B-16, §11I.7 reads, §11I.8 4b.2 rows, AC-217 to AC-232), §11C (S4-FR-15 to S4-FR-22, AC-102 to AC-107, kept), "SA Requirement Review — 4b (§11I)" (SA-Q68, SA-Q72, SA-Q73, SA-Q74; E-68, E-69), SA-WP-4b1, SA-CR-4B1-R, BD-17.
**Writer half:** [BUSINESS_OS_FINANCE_HEALTH_SLICE_4B1_REVERSAL_EVENTS_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4B1_REVERSAL_EVENTS_WORKPLAN.md) (table `business_os_boost_reversal_events`, migration `20261076`).
**Decisions in force:** BD-17 (refunds and lost disputes in the month we recorded them; held means held now), BD-12 (never across currencies), BD-14 (test and live together), BD-33 (full cycle, no per-slice user approval), **BQ-13 open: no credit take-back** (RV-10, AC-213).
**Skills applied:** `tenant-isolation-guard` (R-n′ and R-l′: ownership through the parent purchase), `business-os-schema-check` (column claims, §1), `new-repository` (method shape, `RepositoryResult`, never throws).
**Date:** 2026-10-17
**Branch:** `feature/bos-finance-health-4b2`, cut by RM from the #447 tip `20b4cdf1` (confirmed with `git branch --show-current` in worktree `neuronforge-finance-health`). **#447 is not merged:** it waits for the user to apply `20261076` and `20261077`. No PR is opened until #447 is in `main`; then this branch is merged with `origin/main` and re-verified. Never `git stash`, never commit (RM commits), never `git worktree remove`, never `npm install` here (`node_modules` is a junction).
**Status:** Code Complete 2026-10-17 (SA workplan review SA-WR-4b2 approved with conditions 4B2-R1 to R4, all met; see Implementation Notes). Uncommitted. Awaiting SA code review. No PR until #447 is in main (T12).

## Overview

4b.2 is the reader half of BD-17. It adds four reads to `BusinessOsFinanceReadRepository` (R-n, R-n′ for the dated reversal events; R-l, R-l′ for the purchases that need attention now) and changes the finance builders so that:

- refunds and lost disputes count in the window **they were recorded in**, whatever month the purchase was paid;
- open disputes are shown as **held now**, never subtracted from a window's net;
- Section 6 gains block A, "Our payment problems (boosts)";
- K-5 turns red on an open dispute (a rule in `FINANCE_RULES`);
- Section 4 shows **bought credits beside gifted credits**, never combined;
- the Accounts tab and the account summary follow the same refund rule.

No migration, no write, no new route, no new request from the page. Nothing writes a credit lot or a lot draw (BQ-13).

---

## Table of Contents

1. [Verification log (code re-anchored)](#1-verification-log-code-re-anchored)
2. [Where the spec no longer matches the code](#2-where-the-spec-no-longer-matches-the-code)
3. [Analysis summary](#3-analysis-summary)
4. [Reads (R-n, R-n′, R-l, R-l′)](#4-reads-r-n-r-n-r-l-r-l)
5. [Builder changes](#5-builder-changes)
6. [Payload and UI](#6-payload-and-ui)
7. [Before 20261076 is applied: calm degradation](#7-before-20261076-is-applied-calm-degradation)
8. [Questions for SA (SA-W116 to SA-W124)](#8-questions-for-sa-sa-w116-to-sa-w124)
9. [Files to create / modify](#9-files-to-create--modify)
10. [Task list and AC mapping](#10-task-list-and-ac-mapping)
11. [Test plan](#11-test-plan)
12. [Guards](#12-guards)
13. [The user's browser steps](#13-the-users-browser-steps)
14. [Risks](#14-risks)
15. [Estimate](#15-estimate)
16. [SA Review Notes](#sa-review-notes)
17. [QA Testing Report](#qa-testing-report)
18. [Commit Info](#commit-info)
19. [Change History](#change-history)

---

## 1. Verification log (code re-anchored)

Measured 2026-10-17 on `feature/bos-finance-health-4b2` = `20b4cdf1` (4b.1 merged with `origin/main` through DE-8b #453, so 6b #449, DF-6 #450 and M-8 #448 are present; the 8.x branches are not). All line numbers below are at `20b4cdf1`.

| # | Fact | Where | Result |
|---|---|---|---|
| V-1 | Seven frozen pins, LF-normalised SHA-256 (`tr -d '\r' < f \| sha256sum`) | AC-173 `app/admin/finance/__tests__/financeRequest.pin.render.test.tsx`; helper `financeRequestPins.ts`; Pin A `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx`; Pin B `app/admin/finance/__tests__/financeTiles.pin.render.test.tsx`; Pin C `chargeChecksRequest.pin.render.test.tsx`; helper `chargeChecksRequestPins.ts`; Pin D `lib/admin/health/__tests__/m5WordingOnly.pin.test.ts` | `3a1a2dd4…f6f8`, `b84e0c96…aabf`, `30f5fc24…2e01`, `24ff0da7…df9f`, `98ea0507…1e4b`, `02813360…5bd8`, `1f7cf07a…f144`: all equal ✅ |
| V-2 | R-l and R-l′ **do not exist**; 4a built only R-k / R-k′ | `grep NeedingAttention lib app` | No match. 4b.2 builds them (§11I.2 already lists them under 4b.2) |
| V-3 | Boost column list | `BusinessOsFinanceReadRepository.ts:173-174` (spec said `:175`) | Includes `amount_refunded_minor` |
| V-4 | The layer-B pager scopes by `.eq('user_id', …)` | `BusinessOsFinanceReadRepository.ts:784-842`, scope line `:812` | The events table has **no `user_id`**, so R-n′ cannot use the pager's scope; it scopes through the account's purchase ids (§4.2) |
| V-5 | `readMoney` / `refundsAndDisputesOf` | `boostRevenue.ts:122-160` (spec said `:164`) | `refundsAndDisputesOf` `:122-133`; `readMoney` `:145-155` |
| V-6 | Today's net **subtracts held** | `boostRevenue.ts:213-218` (`netOf`); `accountEconomics.ts:135-141` (`boostAfterTax`) | `gross − refunded − held − lost`. FR-4B-5 drops held from net |
| V-7 | The builder's boost read and orchestration | `financeHealth.ts:617-681` (`Promise.all`), `:663-667` (R-k / R-k′), `:809` (`buildBoostRevenue`), `:856-869` (`combineOurRevenue`), `:929-939` (`buildCreditsSection`), `:976-1040` (economics, 6b fee), `:1145-1154` (payment problems), `:1188-1198` (K-5 colour) | All inside the server-side `Promise.all`; the page still makes one request |
| V-8 | `FinanceHealthDeps.finance` is a `Pick<>` of named methods | `financeHealth.ts:253-272`; wiring `financeHealthDeps.ts:123-158` | Four names to add, in both |
| V-9 | K-5 rules are empty and its vocabulary names no metric | `financeRules.ts:52`, `:100` | Gains metric `boostOpenDisputes` and one rule |
| V-10 | The DF-5 source pin | `finance.source.guard.test.ts:724-756`; the timing-sentence pin `:758-787`; boost exports `:812-829`; econ DF-5 `:1135-1144`; table pin `:332-363` | Re-pinned (§12) |
| V-11 | AC-145 Overview baseline | `app/api/admin/business-os/finance/__tests__/route.test.ts:1121-1240`; hash `6761620e…5250` | Iterates **every** `mockDeps.finance` method, so the four new methods enter `EXPECTED_CALLS`. Its comment calls E-55 "the ONE permitted update"; SA-Q72 grants a second (§2, D-4) |
| V-12 | **ts-jest type-checks every test file** (`jest.config.js:60-70`, diagnostics on) | Pin B `financeTiles.pin.render.test.tsx:47-250` builds typed literals: `FinanceCreditRow`, `FinancePayload['credits']`, `FinancePaymentProblemsSection`, `FinanceRevenueSection['boosts']` with a five-field `notes` | **Any new required wire field on those types fails Pin B's compile** (§2, D-1) |
| V-13 | The timing sentence is pinned verbatim in three users | `financeCopy.ts:149-154`; users `RevenuePanel.tsx:151`, `AccountSummary.tsx:119`, `AccountsTab.tsx` | Re-pinned to FR-4B-6's text, same three users |
| V-14 | Route log line | `app/api/admin/business-os/finance/route.ts:299-330` | Gains statuses and counts only |
| V-15 | The AC-173 route-schema hash covers `const DATE =` to the end of `buildQuerySchema` | `financeRequest.pin.render.test.tsx:116-123` | 4b.2 adds **no** query key, so `route.ts`'s schema is not touched |
| V-16 | Live (read-only, 2026-10-17, from 4b.1 V-5 / V-6) | events table absent (42P01); 1 purchase, 0 refunds, 0 disputes | Before the apply, R-n and R-n′ fail; §7 |

---

## 2. Where the spec no longer matches the code

| # | Spec says | Code says | Plan |
|---|---|---|---|
| D-1 | E-68: "Pin B serves fixed payloads, so a server-side change cannot move it" | True for **values**, but Pin B **type-checks** its payload literals (V-12). A new required field on `FinanceCreditRow`, `FinanceCreditsSection`, `FinancePaymentProblemsSection`, `FinanceBoostNotes` or `FinanceBoostRevenue` stops Pin B compiling | **Every new wire field is optional (`?:`)** on those five types; the builder always sets it; the UI treats "absent" as the pre-4b rendering. No field Pin B names is removed or renamed (`notes.refundOrDispute` kept, §6). SA-W116 |
| D-2 | FR-4B-15: `revenue.boosts` **lines** gain `heldNow` | Held now is as of now, per currency; a currency can be held now with no purchase or event in the window, so it would have no line to sit on | `boosts.heldNow?: Array<{ currency, disputes, amount }>` beside the lines; the window `held` leaves `FinanceBoostLine` (Pin B's lines are `[]`, so this compiles). SA-W117 |
| D-3 | §11I.8: DF-5 pin re-pinned in the builder; E-44 keeps **zero** refund or dispute tokens in `accountEconomics.ts` | FR-4B-11 needs the Accounts tab to subtract refund and lost events, which means reading kinds and amounts | `boostRevenue.ts` exports one more reader, `readReversalMoney(event)`, the only code naming the event kinds; `accountEconomics.ts` calls it and still names no token. The export pin goes 5 → 6 with its planted control moved to a seventh. SA-W118 |
| D-4 | SA-Q72: "one ruled update per pin, as E-55" | The AC-145 test comment says E-55 was "the ONE permitted update" | The update follows SA-Q72 exactly: four read keys (R-n / R-l called with exact arguments, R-n′ / R-l′ with none), the payload change, one new hash, the comment amended to cite SA-Q72. The previous hash stays as a second assertion over the payload with the 4b.2 keys removed (the E-55 shape) |
| D-5 | FR-4B-5 / FR-4B-10: "K-5's value changes only where a refund or a lost dispute exists" | Today's net also subtracts **held** (V-6) | K-5 also changes where a dispute is **open** (it stops being subtracted). None live, so no live figure moves; noted for QA |
| D-6 | §11I.7: R-n "plus the purchase's `user_id, package_id, package_version, amount_tax_minor, paid_at`" | The second read also needs the purchase's `currency` only defensively (the event carries its own) | Not added: the event's own `currency` groups it (FR-4B-7). Purchase columns exactly as the spec |
| D-7 | §11I.8: "`amount_refunded_minor` is no longer read by the revenue builder" | R-k still selects it (V-3); 6a's `accountEconomics` reads it through `readMoney` | Removed from `FINANCE_BOOST_PURCHASE_COLUMNS` and `BoostPurchaseInput`. R-l keeps it (the held-now remainder needs it) |
| D-8 | §11I.8 line refs (`:175`, `:164`, `accountEconomics.ts:42,116,126`, `REPOSITORY_TABLES :332`) | Moved (V-3, V-5, V-10) | Re-anchored in this workplan |

---

## 3. Analysis summary

| Area | What 4b.2 touches |
|---|---|
| DB tables read | `business_os_boost_reversal_events` (new to this repository), `business_os_boost_purchases` (already read). **No write, no migration, no grant** |
| Repository | `BusinessOsFinanceReadRepository`: four methods, two column constants, two row types, one private chunked id reader |
| Pure builders | `boostRevenue.ts` (rule change, new reader), new `boostProblems.ts` (block A, held now, K-5 count), `creditsSection.ts` (bought figures), `accountEconomics.ts` (events per account), `financeRules.ts` (K-5 metric and rule), `financeTypes.ts` (optional fields) |
| Orchestration | `financeHealth.ts` (four settled reads in the existing `Promise.all`), `financeHealthDeps.ts` (wiring) |
| Route | `route.ts`: log line only. Schema untouched (V-15) |
| UI | `RevenuePanel.tsx`, `PaymentProblemsSection.tsx`, `CreditsSection.tsx`, `AccountSummary.tsx`, `AccountsTab.tsx` / `AccountEconomicsTable.tsx` (note only), `financeCopy.ts`, `financeLinks.ts` |
| Requests from the page | **Unchanged: one** (AC-173). Every new read rides the existing `GET /api/admin/business-os/finance` |

**Why the reads ride the existing request.** `buildFinanceHealth` already settles every read in one server-side `Promise.all` (`financeHealth.ts:617`). R-n / R-n′ and R-l / R-l′ join it as two more settled entries, so the page's fetch count, the AC-173 table and Pin C are untouched.

---

## 4. Reads (R-n, R-n′, R-l, R-l′)

All in `BusinessOsFinanceReadRepository`, following its header rules: service role documented, exported column lists, no write verb, one caller (`financeHealthDeps.ts`), never throws, **no `livemode`**, no Stripe id, the boost repository named in words only, a named all-accounts method versus an account-scoped one.

**Paging rule (C-1 lesson, slice 8.3).** Every list read asks for at most `FINANCE_READ_LIMITS.CLIENT_PAGE_SIZE` = 1,000 rows per request, keyset on `id`, ascending, until a short page or the 5,000 ceiling (`>=` rule, `reachedCeiling: true`). That includes every 100-id chunk request: each chunk is itself keyset-paged at 1,000, so a chunk can never be silently cut by PostgREST's `max-rows`.

**Chunking rule (E-69).** Every id list sent with `.in(...)` holds at most **100** ids (`FINANCE_READ_LIMITS.ID_CHUNK = 100`, new constant). A shared private helper `pageByIdChunks(method, table literal start, column, ids, extraFilter)` loops the chunks sequentially and the keyset pages inside each. Each `.from(` still names its table as a literal (the table pin).

### 4.1 R-n `listBoostReversalEventsAllAccountsRecordedInRange(range, opts?)`

1. Events: `.from('business_os_boost_reversal_events').select(FINANCE_REVERSAL_EVENT_COLUMNS)`, `.gte('recorded_at', from).lt('recorded_at', to)` (half-open, the existing `rangeFilter`, extended to accept `'recorded_at'`), keyset on `id`, page 1,000, ceiling 5,000.
2. Their purchases: the distinct `purchase_id`s, in chunks of 100, `.from('business_os_boost_purchases').select(FINANCE_REVERSAL_PURCHASE_COLUMNS).in('id', chunk)`, each chunk keyset-paged at 1,000.
3. Join in the method: each event row carries `purchase: { user_id, package_id, package_version, amount_tax_minor, paid_at } | null` (null: not found; counted as unreadable downstream, FR-4B-9).

`FINANCE_REVERSAL_EVENT_COLUMNS = 'id, purchase_id, kind, amount_minor, currency, recorded_at'`. `FINANCE_REVERSAL_PURCHASE_COLUMNS = 'id, user_id, package_id, package_version, amount_tax_minor, paid_at'`. Neither names `stripe_dispute_id`, `livemode`, `status_before`, `status_after` or `cumulative_refunded_minor`. Logged at `info`: counts and timing only.

### 4.2 R-n′ `listBoostReversalEventsForAccountRecordedInRange(accountId, range, opts?)`

Tenant isolation (the `tenant-isolation-guard` "parent-owned" shape): the events table has no `user_id`, so ownership is resolved through the parent.

1. Refuse a malformed UUID before any query (`UUID_PATTERN`, inside the `try`).
2. The account's purchases: `.from('business_os_boost_purchases').select(FINANCE_REVERSAL_PURCHASE_COLUMNS).eq('user_id', accountId)`, keyset-paged at 1,000, ceiling 5,000. **Every status**, because a refund can land on a purchase of any status.
3. Events: `purchase_id` in that id set (chunks of 100) **and** `recorded_at` in range, each chunk keyset-paged at 1,000.
4. **Fail-closed filter:** any event whose `purchase_id` is not in the step-2 set is dropped and counted in the debug log (it cannot happen; it is the belt to the `.in()` braces). The purchase fields come from step 2, so no second purchase read.

A ceiling in step 2 or step 3 sets `reachedCeiling: true` (refunded and lost "At least", net Unknown, FR-4B-9). The account id is the admin's validated and plan-checked id (`financeHealth.ts:520-529`); the purchase ids are never caller-supplied.

### 4.3 R-l `listBoostPurchasesNeedingAttentionAllAccounts(opts?)` and R-l′ `listBoostPurchasesNeedingAttentionForAccount(accountId, opts?)`

1. `.from('business_os_boost_purchases').select(FINANCE_BOOST_ATTENTION_COLUMNS).in('status', ['disputed', 'flagged_mismatch'])`, keyset at 1,000, ceiling 5,000; R-l′ adds `.eq('user_id', accountId)` on every page (the pager's scope). `FINANCE_BOOST_ATTENTION_COLUMNS = 'id, user_id, status, currency, amount_total_minor, amount_refunded_minor, status_changed_at'` (§11C.6).
2. Opened dates: for the `disputed` rows only, `dispute_opened` events by `purchase_id` in chunks of 100 (`.eq('kind', 'dispute_opened')`), keyset at 1,000; the latest per purchase is its opened date.
3. **Step 2 failing never fails the read.** It returns `{ rows, reachedCeiling, openedDates: 'read' | 'failed' }`, and on failure every `disputeOpenedAt` is `null`. So the K-5 dispute rule and the open-dispute count work even when the events table is absent (§7).

Row type `FinanceBoostAttentionRow` = the seven columns plus `disputeOpenedAt: string | null`.

---

## 5. Builder changes

### 5.1 `boostRevenue.ts` (FR-4B-1 to FR-4B-9)

- **Purchases** keep their `paid_at` window (R-k unchanged in rows): purchases, gross, tax, credits sold, by package, deleted accounts.
- `refundsAndDisputesOf` is **removed**. `readMoney` returns `{ total, tax }` only (no refunded, held, lost). `BoostPurchaseInput` loses `amount_refunded_minor` (D-7).
- **New private `reversalsOf(event)`**, the one place naming `'refund'`, `'dispute_lost'` and `amount_minor`: `{ refunded, lost }` in integer minor units, or null when unreadable (amount not a safe integer ≥ 0, currency not a three-letter code with `minorUnitsPerMajor === 100`, purchase null). `dispute_opened` / `dispute_won` give `{ 0, 0 }` (history only, FR-4B-4).
- **New exported `readReversalMoney(event)`** (D-3): `reversalsOf` plus the purchase's tax, for `accountEconomics.ts`. Sixth export.
- **Events grouping (FR-4B-7):** by the event's own currency through `groupByCurrency`; by-package by the purchase's `package_id` / `package_version`; `purchase.user_id === null` goes to "Deleted accounts".
- **Events on purchases never paid (FR-4B-8):** `purchase.paid_at === null` adds no money; counted in `events.onUnpaidPurchases`.
- **Net (FR-4B-5):** `gross − refunded − lost` per currency, integer, `Number.isSafeInteger`; may be negative, never clamped; null when either read reached its ceiling, a line holds an unreadable purchase or event, or overflow. `netMinorByCurrency` carries it to `combineOurRevenue`, so K-5 follows.
- **SA-Q74:** per purchase, refunded plus lost seen in this read above its total sets `events.overTotal` (a count), shown as a note; nothing clamped.
- **Notes:** `refundOrDispute` is kept (Pin B names it) and now means "a refund or lost amount on the page is non-zero, or unknown"; it drives the FR-4B-6 sentence. New optional `events: { state: 'read' | 'failed', exact, unreadable, onUnpaidPurchases, overTotal }`.
- **R-n failed (FR-4B-16):** refunded, lost and net are null ("Unknown") on every line and package row; gross, tax and credits sold still show; status `partial`; **no fallback** to the purchase-month rule (no code for it remains).

### 5.2 New `boostProblems.ts` (FR-4B-4, FR-4B-12, S4-FR-15 to S4-FR-17)

Pure, structural input (the R-l rows). Owns the **one** held-now remainder function `heldNowOf(row)` = `amount_total_minor − amount_refunded_minor` for a `disputed` row (exact rules as S4-W-4). Returns:

- `heldNow` per currency (disputes, amount) for `revenue.boosts.heldNow`;
- block A figures per currency: open disputes (count, amount held, oldest opened date from `disputeOpenedAt`), purchases not credited (count, `amount_total_minor` where recorded, oldest `status_changed_at`);
- `openDisputes` (a count) for the K-5 rule; `null` when R-l failed;
- `openedDatesKnown: boolean`.

Lost disputes are not repeated here (FR-4B-12). The FR-4B-8 note count comes from the revenue builder and is shown in this block.

### 5.3 `creditsSection.ts` (FR-4B-13, S4-FR-18 to S4-FR-20)

A `boughtFigures` twin of `giftedFigures` (`creditsSection.ts:170-216`) over `source === 'boost_purchase'` lots, through the same `extraCreditsAt`: bought outstanding (existing accounts), deleted accounts' bought outstanding (own figure), bought in the window (credits and lot count). Per row, `boughtOutstanding` beside `giftedOutstanding`: 0 with no boost lot, null under the same §8.4 lot-failure rules. **K-4 and every gifted figure stay `admin_grant` only.** The "not taken back" sentence shows while `revenue.boosts.notes.refundOrDispute` reports a refund event (passed as a boolean, so the credits builder reads no event).

### 5.4 `accountEconomics.ts` (FR-4B-11, SA-Q47, SA-Q49)

- `boostAfterTax` becomes `total − tax` (`tax > total` inexact), since a purchase no longer carries refunds.
- Each event of the window (R-n with no business picked and the tab, R-n′ with a business picked) is read through `readReversalMoney`: refunded plus lost is subtracted on the event's own account and currency; **a refund or loss on a taxed purchase is inexact (Unknown)**; deleted accounts' events go to the deleted row.
- An account whose only boost money is a refund gets a row with a negative figure (`moneyByAccount` gains the event's account).
- The 6b fee stays on the gross charge (FE-5 to FE-7): events never add or remove a fee.
- Still names no event kind and no `amount_refunded_minor` (DF-5 E-44 pin unchanged).

### 5.5 `financeRules.ts` (S4-FR-17, AC-103)

`FinanceMetric` gains `'boostOpenDisputes'`; `FINANCE_TILE_VOCABULARY.k5_our_revenue.metrics = ['boostOpenDisputes']`; `FINANCE_RULES.k5_our_revenue = [{ id: 'boosts.openDispute', priority: 1, colour: 'red', description: 'Boost payments in dispute', condition: { kind: 'atLeast', metric: 'boostOpenDisputes', value: 1 } }]`. `FINANCE_GREEN_ELIGIBLE` unchanged (K-5 never green).

### 5.6 `financeHealth.ts` (orchestration)

- Two more settled entries in the `Promise.all` at `:617`: R-n / R-n′ and R-l / R-l′, account-scoped exactly when `accountId !== null` (FR-4B-14: R-n and R-l zero calls with a business picked).
- `buildBoostRevenue({ purchases, events, scope })`; `buildBoostProblems({ attention })`; `buildCreditsSection({ …, refundNote })`; `buildAccountEconomics` / `buildAccountMargin` gain `events`.
- **K-5 colour precedence:** money failed → unchanged (`unavailable`, "Could not read our revenue"); else R-l failed → `neutral`, headline "Dispute check failed", value unchanged; else the rule list with `{ boostOpenDisputes: { value: n, exact: !reachedCeiling } }`. A matched K-5 rule's headline is formatted with the count: "1 boost payment in dispute" / "N boost payments in dispute" (SA-W120). The tile wire shape is unchanged: `status`, `headline`, `ruleId`, `money` only.
- `paymentProblems.boosts` set; its status joins `paymentProblemsStatus`.
- Counts on the log: rows, ceilings, `openedDates`, events by state; never an amount, a currency or an id.

---

## 6. Payload and UI

### 6.1 Wire changes (all additive, optional on the Pin B types, D-1)

| Type | Change |
|---|---|
| `FinanceBoostLine` | `held` removed (window held no longer exists). `refunded` and `lost` become `number \| null` (Unknown when the event read failed) |
| `FinanceBoostPackageRow` | `refunded: number \| null` |
| `FinanceBoostNotes` | unchanged fields; `refundOrDispute` re-defined (§5.1) |
| `FinanceBoostRevenue` | `heldNow?: FinanceBoostHeldNowLine[] \| null`; `events?: FinanceBoostEventsNote` |
| `FinancePaymentProblemsSection` | `boosts?: { status; scope; figures: FinanceBoostProblemsFigures \| null }` |
| `FinanceCreditsSection` | `bought?: FinanceBoughtFigures \| null` |
| `FinanceCreditRow` | `boughtOutstanding?: number \| null` |
| `FinanceAccountMargin` / economics rows | values only (FR-4B-11), no shape change |

### 6.2 UI

| File | Change |
|---|---|
| `RevenuePanel.tsx:191-236` | Lines table: Held column replaced by "Held in open disputes now (not taken off any month)" as its own small table from `heldNow`; refunded, lost, net Unknown when null; net negative with a minus sign (`formatMoney`, no arithmetic in the page). `:151` note: the FR-4B-6 sentence. Notices for `events.state === 'failed'`, `events.exact === false`, `onUnpaidPurchases`, `overTotal` |
| `PaymentProblemsSection.tsx:130-190` | Block A "Our payment problems (boosts)", **before** block B, subtitle "As of now, UTC": per currency, open disputes (count, held, opened date) and purchases not credited (count, amount, oldest date, "Payment received by Stripe, credits not given; check the purchase"); the FR-4B-8 note; with a business picked, the "Boost purchases of one business" link to the per-account credit view (`financeLinks.ts`, existing `businessesHref` shape). Absent `boosts` renders nothing (Pin B) |
| `CreditsSection.tsx:101-175` | "Bought credits outstanding" beside "Gifted credits outstanding", bought in the window line, deleted accounts' bought note, a "Bought outstanding" column beside "Gifted outstanding", the "Credits of a refunded boost are not taken back" sentence. Absent `bought` renders as today |
| `AccountSummary.tsx:106-125` | Boost line follows the new figures; note via the same constant |
| `AccountsTab.tsx` | Note via the same constant (no figure code change; the values come from the builder) |
| `financeCopy.ts:149-154` | `REVENUE_REFUND_TIMING_NOTE` = FR-4B-6's text; new constants for block A, held now, bought credits, "Dispute check failed", the K-5 count headline |

All new tables use the layout standard primitives (`ADMIN_TABLE`, `ADMIN_TD_NUM`, `AdminEmpty`, `formatMoney`, `formatCredits`) and add no colour token; no page file adds or subtracts two money fields (the 4a arithmetic guard). Copy is plain English, no mode words (BD-14 `MODE_WORDING` guard) and no AI-cost vocabulary.

---

## 7. Before 20261076 is applied: calm degradation

4b.2 merges only after the apply (§11I.6 step 6), but it must still behave if the table is absent (local dev, a rollback, a deploy-order slip):

| Read | Error | What the admin sees | Log |
|---|---|---|---|
| R-n / R-n′ | 42P01 or PostgREST `PGRST205` (table not in schema cache) | Gross, tax, credits sold and purchases still show. Refunded, lost and net read "Unknown", with one notice: "Refund and dispute dates could not be loaded, so refunded, lost and net are unknown." Section `partial`. K-5 reads "Unknown" (its net is unknown). Every other section renders. No 500, no red, no purchase-month fallback | **`warn`**, `{ read: 'boost_reversal_events', reason: 'table_absent' }`, once per request, not `error` (SA-W121) |
| R-l / R-l′ opened dates | same | Open disputes and purchases not credited still counted; opened date reads "Not recorded"; block A `partial` | `warn`, same reason |
| R-l / R-l′ purchases | none expected (the table exists) | — | — |

The repository maps both codes to a typed `FinanceReadTableAbsentError` in `fail()` (`BusinessOsFinanceReadRepository.ts:361-368`), logged at `warn` like the guard error; any other error stays `error`. Test: AC-224 with both codes mocked.

---

## 8. Questions for SA (SA-W116 to SA-W124)

| # | Question | Dev suggestion |
|---|---|---|
| **SA-W116** | D-1: Pin B type-checks its payload literals. Make every new field optional on the five Pin B types (builder always sets them), rather than required (which would need a Pin B re-freeze, forbidden by E-68)? | Optional. A builder test asserts every new field is present on every built payload, so "optional" is a typing concession only |
| **SA-W117** | D-2: `heldNow` as a per-currency list on `boosts`, not a field of each window line? | Yes |
| **SA-W118** | D-3: a sixth `boostRevenue.ts` export `readReversalMoney`, so `accountEconomics.ts` keeps zero refund tokens? | Yes; export pin 5 → 6, planted control moves to a seventh |
| **SA-W119** | D-7: drop `amount_refunded_minor` from R-k's columns and `BoostPurchaseInput`? | Yes: least data, and the DF-5 re-pin then needs no exception for it in the builder |
| **SA-W120** | K-5's red headline with a count ("1 boost payment in dispute") is formatted in `financeHealth.ts` when a K-5 rule matched; the rule's `description` stays static data. Acceptable, given every K-5 rule can only name `boostOpenDisputes`? | Yes |
| **SA-W121** | §7: a typed table-absent error logged at `warn`, not `error`? | Yes: a missing table is a deploy state, not a failure to page someone over |
| **SA-W122** | R-n reads every event kind and lets the builder decide (kinds in one function), rather than filtering `kind` in the repository? | Yes: rows are few; the kinds stay in one place |
| **SA-W123** | The AC-145 update (D-4) keeps the previous hash as a second assertion over the payload with the 4b.2 keys removed, as E-55 did? | Yes |
| **SA-W124** | The 6a export pins and `accountEconomics` fixtures with a refunded boost change value under FR-4B-11 (refund now dated by its event). Paste the hunk list in the code review as SA-Q72 asks? | Yes |

---

## 9. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | modify | R-n, R-n′, R-l, R-l′; `ID_CHUNK`; three column constants; row types; `pageByIdChunks`; `rangeFilter` accepts `recorded_at`; `FinanceReadTableAbsentError`; header lists the new methods and the events table |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | modify | One block per method (§11) |
| `lib/business-os/finance/boostRevenue.ts` | modify | §5.1 |
| `lib/business-os/finance/boostProblems.ts` | create | §5.2 |
| `lib/business-os/finance/creditsSection.ts` | modify | §5.3 |
| `lib/business-os/finance/accountEconomics.ts` | modify | §5.4 |
| `lib/business-os/finance/financeRules.ts` | modify | §5.5 |
| `lib/business-os/finance/financeTypes.ts` | modify | §6.1 |
| `lib/business-os/finance/financeHealth.ts` | modify | §5.6 |
| `lib/business-os/finance/financeHealthDeps.ts` | modify | Wire the four methods |
| `app/api/admin/business-os/finance/route.ts` | modify | Log line only (statuses, counts) |
| `app/admin/finance/financeCopy.ts`, `financeLinks.ts` | modify | §6.2 |
| `app/admin/finance/components/RevenuePanel.tsx`, `PaymentProblemsSection.tsx`, `CreditsSection.tsx`, `AccountSummary.tsx`, `AccountsTab.tsx` | modify | §6.2 |
| `lib/business-os/finance/__tests__/boostRevenue.test.ts`, `boostProblems.test.ts` (create), `creditsSection.test.ts`, `accountEconomics.test.ts`, `financeRules.test.ts`, `financeHealth.test.ts`, `ourRevenue.test.ts` | modify / create | §11 |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | modify | §12 re-pins |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | modify | AC-145 ruled update; AC-230 zero event reads on 401 / 403 / 400; mocks for the four methods |
| `app/admin/finance/__tests__/financePage.render.test.tsx`, `financeAccount.render.test.tsx`, `accountsTab.render.test.tsx` | modify | Render cases (§11) |
| The seven pin files | **not touched** | V-1 |
| `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md` | modify | §0.1 row link (this session); status at each stage |

No file outside these. No migration, no `supabase/` file, no boost-module file (`lib/business-os/boost/**`, `BusinessOsBoostPurchaseRepository.ts` and `BusinessOsCreditLotRepository.ts` unchanged).

---

## 10. Task list and AC mapping

- ✅ **T0** Step 0: record the seven pin hashes and the AC-145 hash; run the finance suites green on the untouched tree.
- ✅ **T1** Repository: R-n, R-n′ (AC-217 bounds, AC-229, AC-230), R-l, R-l′ (AC-102, AC-106, AC-229), chunking and paging, table-absent error (AC-224). Repository tests.
- ✅ **T2** `boostRevenue.ts` rule change and `readReversalMoney` (AC-217, AC-218, AC-220 to AC-223, AC-225 logic).
- ✅ **T3** `boostProblems.ts` (AC-102, AC-219, AC-221 note, AC-227).
- ✅ **T4** `financeRules.ts` K-5 metric and rule (AC-103).
- ✅ **T5** `creditsSection.ts` bought figures (AC-104, AC-105, AC-228).
- ✅ **T6** `accountEconomics.ts` events (AC-226).
- ✅ **T7** Types and `financeHealth.ts` orchestration, K-5 precedence, `financeHealthDeps.ts` wiring (AC-103, AC-219, AC-224, AC-229).
- ✅ **T8** Route log line; AC-145 ruled update; 401 / 403 / 400 zero event reads (AC-230).
- ✅ **T9** UI and copy (AC-225, AC-227, AC-228, the FR-4B-6 / FR-4B-9 / FR-4B-16 notices).
- ✅ **T10** Guard re-pins with planted controls (AC-223 source part, AC-231).
- ✅ **T11** Verification: suites, scoped `tsc`, lint, `test:authz-guard`, `test:bos-entitlements` (expected unchanged; no entitlements import is added), seven pin hashes recomputed (AC-231).
- [ ] **T12** After #447 merges and the migration is applied: merge `origin/main`, re-run T11, record. Manual AC-232 / L-137 to L-141 after merge (BD-33).

| AC | Proven by |
|---|---|
| AC-102 | `boostProblems.test.ts` per currency; check 15 at QA |
| AC-103 | `financeRules.test.ts` + `financeHealth.test.ts`: one dispute red with "1 boost payment in dispute", value unchanged; threshold via injected `rules`; R-l failing grey "Dispute check failed"; five tiles (render) |
| AC-104, AC-105 | `creditsSection.test.ts`; check 16 at QA |
| AC-106, AC-229 | `financeHealth.test.ts`: with a business picked, R-n′ / R-l′ / `lots.forAccount` get exactly that id; R-n / R-l zero calls |
| AC-217 | `boostRevenue.test.ts` (October paid, November refunded, two windows); repository test asserts `.gte('recorded_at', …)` / `.lt('recorded_at', …)` and the `23:59:59.999999` / `00:00:00.000000` boundary events fall in exactly one month |
| AC-218 | `boostRevenue.test.ts` opened October, lost November |
| AC-219 | `boostProblems.test.ts` + `financeHealth.test.ts`: held now identical across windows, not in net; check 15 `held_minor` at QA |
| AC-220 | `boostRevenue.test.ts` net with a minus sign; checks 14 and 26 at QA |
| AC-221 | Event with `paid_at` null: no figure moves; note count |
| AC-222 | Deleted-account event to the deleted line; by-package grouping |
| AC-223 | Unreadable amounts, injected small ceiling (`opts.ceiling`); source test: no event amount through `toUnits`, `toHundredths` or `× 100` |
| AC-224 | `financeHealth.test.ts` with R-n returning 42P01 and PGRST205: refunded, lost, net null, section partial, every other section built; render test of the notice; `warn` not `error` |
| AC-225 | Copy pin: new sentence present, "counted in the month of the purchase" absent from every file |
| AC-226 | `accountEconomics.test.ts`: tab row equals revenue restricted to that account; taxed refund Unknown; refund-only account listed negative |
| AC-227 | Render: opened date from the event, oldest change date on not-credited |
| AC-228 | `creditsSection.test.ts` + render: sentence only while a refund event exists; K-4 unchanged |
| AC-230 | Column constants exclude Stripe ids and `livemode` (repository test); payload scan; route 401 / 403 / 400 make zero calls on the four methods |
| AC-231 | Source guard re-pins and controls; seven hashes equal (T11) |
| AC-232 | Manual, after merge (§13) |

---

## 11. Test plan

**Repository** (`BusinessOsFinanceReadRepository.test.ts`, the existing chain-mock style), per method:

- exact column string; no `livemode`, no `stripe_`;
- half-open `recorded_at` bounds; a bad range refused before any query;
- account scoping: R-n′ step 2 has `.eq('user_id', id)`; R-l′ every page; a malformed id → `{ data: null, error }` and **zero** `.from` calls;
- **paging at 1,000:** a mock that returns exactly 1,000 rows asks for the next page with `.gt('id', last)`; `limit` is never above 1,000; ceiling `>=` gives `reachedCeiling: true`;
- **chunking at 100:** 250 purchase ids → three `.in()` calls of 100, 100 and 50, each with `.limit(<= 1000)`; a chunk returning 1,000 rows pages again inside the chunk;
- R-n′ fail-closed: an event with a foreign `purchase_id` is dropped;
- R-l opened dates failing → rows still returned, `openedDates: 'failed'`;
- 42P01 and PGRST205 → `FinanceReadTableAbsentError`, logged at `warn`;
- never throws (a throwing client → `{ data: null, error }`).

**Builders:** `boostRevenue`, `boostProblems`, `creditsSection`, `accountEconomics`, `financeRules`, `ourRevenue` (K-5 from the new net), `financeHealth` (orchestration, precedence, counts, the "every new field present" assertion, SA-W116).

**Route:** AC-145 ruled update; AC-230; the log line carries no amount (existing scan).

**Render:** `financePage.render.test.tsx` (block A, held now, bought credits, notices, negative net, absent-field fallback), `financeAccount.render.test.tsx` (picked business), `accountsTab.render.test.tsx` (note, negative row).

**Not run in CI, done at QA:** checks 14, 15, 16, 25, 26 on production (read-only).

**Commands:** `npm test -- lib/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts app/api/admin/business-os/finance app/admin/finance app/admin/components/layout lib/admin/health app/admin/__tests__`; scoped `tsc --noEmit` over the changed files plus the seven pin files (the DF-6 V-8 method: scratch tsconfig outside the worktree); `npm run lint`; `npm run test:authz-guard`; `npm run test:bos-entitlements`.

---

## 12. Guards

| Guard | Change |
|---|---|
| `finance.source.guard.test.ts` DF-5 pin (`:724-756`) | Re-pinned: `'refund'`, `'dispute_lost'` and `amount_minor` appear only in `reversalsOf` and the event input type; `amount_refunded_minor` and `'disputed'` appear in `boostProblems.ts`'s `heldNowOf` only; **`boostRevenue.ts` names `amount_refunded_minor` nowhere**. Planted controls: a refund read outside `reversalsOf`; a held-now remainder outside `heldNowOf` |
| Same, timing sentence (`:758-787`) | New text; same three users; "month of the purchase" absent everywhere; controls kept |
| Same, boost exports (`:812-829`) | 5 → 6 (`readReversalMoney`); planted seventh |
| Same, econ DF-5 (`:1135-1144`) | Unchanged and still green (D-3) |
| Same, `REPOSITORY_TABLES` (`:332-363`) | Grows by `business_os_boost_reversal_events` (nine); `>= 9`; `fromCallsOf === tables.length`; planted near miss `business_os_boost_reversal_event` |
| Same, purity / no clock / no table in builders | Extended to `boostProblems.ts` |
| Same, 4a money arithmetic in page files | Unchanged; covers the new UI (no page arithmetic) |
| Same, no `livemode` | Covers the new methods and columns |
| Repository "no write verb" and "boost repository named in words only" tests | Unchanged, re-run |
| Vocabulary guard `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` | Unchanged, re-run over the new copy |
| Layout guards (`app/admin/components/layout/__tests__/*`, `layoutFolder.guard.test.ts`, admin layout rules) | Unchanged, re-run; the new UI uses existing primitives only |
| **Seven frozen pins** | Byte-identical; hashes recomputed at T0 and T11 |
| AC-145 baseline | One ruled update (SA-Q72, D-4) |
| `test:authz-guard`, `test:bos-entitlements` | Run, expected unchanged |

---

## 13. The user's browser steps

None before merge (BD-33). After 4b.2 merges and deploys, read-only, about 10 minutes, at `/admin/finance`:

1. **Money → Finance, This month, all businesses.** "Our revenue": the owner's test boost shows as before, no refund; the refund-timing sentence is absent (nothing refunded). (L-137)
2. Same, **30 days**: the same purchase, the same figures. (L-137)
3. "Held in open disputes now" reads none. (L-138)
4. Scroll to **Payment problems**: block A "Our payment problems (boosts)" is first and shows no open dispute and no purchase not credited. K-5 is grey, not red. (L-139)
5. **Credits**: "Bought credits outstanding" shows the owner account's 5,000 beside "Gifted credits outstanding"; K-4 is unchanged. (L-140)
6. **Accounts tab**, then pick the owner business: its boost figure equals Our revenue for that account. (L-141)

Anything that looks wrong: a screenshot to the session; QA cross-checks with checks 14, 15, 16 and 26.

---

## 14. Risks

| # | Risk | Mitigation |
|---|---|---|
| RK-1 | A new required field breaks Pin B's compile (D-1) | Optional fields (SA-W116); scoped `tsc` includes the pin files; hashes recomputed |
| RK-2 | 4b.2 deployed before `20261076` is applied | §7: Unknown figures, `warn`, no 500; and the PR is not opened until #447 is merged and applied |
| RK-3 | A list read silently capped by PostgREST | 1,000-row keyset on every request, chunk requests included; tests assert `limit <= 1000` and the next-page call |
| RK-4 | R-n′ leaks another account's events | Ownership through the account-scoped purchase set; fail-closed filter; test with a foreign event |
| RK-5 | The Accounts tab and Our revenue disagree | One reader (`readReversalMoney`) for both; AC-226 equality test |
| RK-6 | Semantic conflict with whatever lands on main before #447 (the 8.x branches are not here) | T12: merge `origin/main`, re-run all suites and the seven hashes before the PR |
| RK-7 | Over-total cases (SA-Q74) look like double counting | Note on the page; check 25 `over_total` |
| RK-8 | K-5 headline count formatted outside the rule data | SA-W120; test that changing the threshold still changes the colour with no code change |

---

## 15. Estimate

| Part | Days |
|---|---|
| T1 repository and tests | 0.6 |
| T2 to T6 builders and tests | 0.7 |
| T7, T8 orchestration, route, AC-145 | 0.3 |
| T9 UI, copy, render tests | 0.3 |
| T10, T11 guards and verification | 0.2 |
| **Total** | **About 2.1 days** (the spec's 2.5 less the half day 4b.1 already spent on the shared facts). T12 (merge with main after #447) adds about 0.1 if clean |

---

## Implementation Notes

Implemented 2026-10-17 on `feature/bos-finance-health-4b2` at `20b4cdf1`, uncommitted. Nothing applied to production; no migration, no `supabase/` path, no boost-module file.

### Verification (T11)

| Check | Result |
|---|---|
| `npx jest app/admin/finance` | 19 suites, **656 passed** (649 before; 7 new 4b.2 render cases) |
| `npx jest lib/business-os/finance` | 17 suites, **1,729 passed** (new `boostProblems.test.ts`) |
| `npx jest app/api/admin/business-os/finance` (route) | 1 suite, **106 passed** |
| `npx jest lib/repositories` | 105 suites, **2,556 passed** (finance read repository 279) |
| `npx jest app/admin/components` | 25 suites, **824 passed** |
| Vocabulary guard `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` | **182 passed** |
| `npx jest lib/business-os/data-export` | 11 suites, **424 passed** |
| `npx jest lib/business-os/purge` | 16 suites, **364 passed** |
| `npm run test:authz-guard` | 2 suites, **203 passed** |
| `npm run test:bos-entitlements` | 287 suites, **8,790 passed** |
| `npm run lint:hooks` | exit 0 |
| `npx eslint` on the 25 changed and new `.ts`/`.tsx` files | exit 0, 0 errors, 0 warnings |
| Scoped `tsc` (4B2-R3): scratch `tsconfig.4b2.json` **outside the worktree** (absolute `extends`, `noEmit`, `incremental: false`), `include` = `types/**/*.d.ts`, `next-env.d.ts`, all of `lib/business-os/finance/**`, `app/admin/finance/**`, `app/api/admin/business-os/finance/**`, the finance read repository and its test, and the seven pin files (Pin A and Pin D by path; the other five are inside `app/admin/finance/__tests__`) | **Canary run:** canary `const __canary: number = 'x';` appended to `boostProblems.ts` gave its TS2322 (plus one real test typing error, then fixed). Restored from the saved copy: `sha256sum -c` **OK**, `grep -c __canary` = **0**. **Clean run: 0 errors.** Removing `held` from `FinanceBoostLine` compiles every pin file unedited (4B2-R3). The DE TS2353 is outside this scope (pre-existing on main) |
| Seven frozen pins (`tr -d '\r' \| sha256sum`) | AC-173 `3a1a2dd4…f6f8`, helper `b84e0c96…aabf`, Pin A `30f5fc24…2e01`, Pin B `24ff0da7…df9f`, Pin C `98ea0507…1e4b`, helper `02813360…5bd8`, Pin D `1f7cf07a…f144`: **all unchanged** |
| AC-145 (SA-Q72) | One ruled update: new hash `39b35743527b3a1948efd30c3ebc2510eb0916301baa4ea8f2e0210d7e1556ea`; the E-55 hash `6761620e…5250` **still reproduces** as a second assertion over the payload with the 4b.2 keys put back, and the 6a hash `b4d10bc1…588c` from that, so the only byte changes are the 4b.2 keys |

### Conditions

| # | How it is met |
|---|---|
| 4B2-R1 (paging) | One keyset loop, `collect` (`.order('id').limit(size)`, `size` ≤ 1,000, `.gt('id', last)`), used by every read; `collectByIdChunks` sends at most `FINANCE_ID_CHUNK` = 100 ids per `.in()` and pages **each chunk** through `collect`. Repository tests serve exactly 1,000 rows and assert the next-page call for R-n's events, R-n′'s purchases, R-n′'s events **inside one chunk**, R-l and R-l′; 250 / 1,250-id cases assert chunks of ≤ 100, each `limit` ≤ 1,000. Source guard: no `.range(`, no `.limit(<4+ digits>`, exactly three `.from('business_os_boost_reversal_events')` |
| 4B2-R2 (isolation) | R-n′ reads the account's purchases first (`.eq('user_id')` on every page, tested over two pages), then only events whose `purchase_id` is in that set, and **drops any event outside it** (fail closed; test with a foreign event, `dropped: 1` logged at debug). R-l′ `.eq('user_id')` on every page (tested). AC-229 test: with a business picked R-n and R-l have zero calls. The 401/403/400 route cases cover the four new methods through `allReads()` |
| 4B2-R3 (pins, compile) | Above |
| 4B2-R4 (BQ-13) | No lot or draw write anywhere; `boostProblems.ts` sits in `lib/business-os/finance` so the existing "names no lot writer and no lot RPC" guard covers it (green), and a new purity guard pins it has no write verb |

### AC-145 hunk list (SA-W124 / SA-Q72)

1. Comment: an SA-Q72 paragraph naming the second ruled update.
2. `EXPECTED_CALLS`: four keys, `listBoostReversalEventsAllAccountsRecordedInRange: [[RANGE]]`, `listBoostPurchasesNeedingAttentionAllAccounts: [[]]`, the two account-scoped ones `[]`.
3. `EXPECTED_SHA256` → `39b35743…56ea`; `M4_SHA256` keeps `6761620e…5250`.
4. The assertion block: rebuild the payload without the 4b.2 keys (`revenue.boosts.heldNow`, `.events`, each line's `unreadableEvents` out and `held: 0` back in its old key position, `credits.bought`, each credit row's `boughtOutstanding`, `paymentProblems.boosts`), assert `M4_SHA256`, then the unchanged 6a assertion over that.
No other edit to the region. Accounts-tab fixtures changed only where FR-4B-11 changes a figure (`accountEconomics.test.ts`: the four status rows of AC-133, SA-Q47, SA-W81 (ii) replaced by event cases, the 6b fee cases moved to events).

### Deviations (for SA)

| # | Deviation | Why |
|---|---|---|
| DV-1 | `FINANCE_REVERSAL_PURCHASE_COLUMNS` also selects `amount_total_minor` | SA-Q74's "refunded plus lost above a purchase's total" note needs the total. Counted within the window's events only; check 25 stays the full-history check |
| DV-2 | The joined purchase carries `paid: boolean`, not `paid_at` | The 4a guard (AC-88) pins that the boost builder names no date; the repository turns the date into the FR-4B-8 boolean |
| DV-3 | Block A is the first part inside the existing Section 6 frame, whose title and chip still read "Client payment problems" / "The businesses' problem, not ours" | Matches "Section 6 block A, placed before block B" without moving section ids or the F-5 jump links. The frame copy now reads oddly above our own block: **proposed follow-up FU-4B2-1** (copy only) |
| DV-4 | `financeHealth.ts` imports `k5DisputeHeadline` and `K5_DISPUTE_CHECK_FAILED` from `app/admin/finance/financeCopy.ts` | SA-W120 ruled the words live in `financeCopy.ts`; the precedent for a lib → app import is `adminWindowPresets` |
| DV-5 | The test port of check 19 (`accountEconomics.test.ts`) is now status-free (total − tax per purchase) | FR-4B-11. **The SQL check 19 in §13 still deducts refunds by purchase status**, so for a refunded or disputed purchase it no longer equals the tab; QA reads it together with check 26. **Proposed follow-up FU-4B2-2:** re-issue check 19 on the event rule |
| DV-6 | "Credits of a refunded boost are not taken back" shows while a refund event with an amount above 0 exists **in the window** | The page reads the window's events only; a lifetime flag would need another read |
| DV-7 | `counts.boosts` gains two fixed state words (`eventsState`, `openedDates`); the route's AC-98 "numbers and booleans" assertion allows exactly those two from a fixed list | Statuses in words, as `counts.paymentProblems.reminders` already does |
| DV-8 | R-l's opened-date read at its ceiling reports `openedDates: 'failed'` | A partial set of dates cannot be told from missing ones |
| DV-9 | `notes.empty` now means "no counted purchase and no event in the window" | A refund-only window must show its line (FR-4B-5, AC-217) |
| DV-10 | Copy: `REVENUE_NET` → "Net of refunds and lost disputes (…)" (FR-4B-5); `REVENUE_CANNOT` drops "The date of a refund or dispute"; `REVENUE_NOTICE_CUT` no longer mentions dispute amounts | Follows the new rule; K-5's own headline text is unchanged |
| DV-11 | `route.ts` is **not** edited | Its info line already logs the builder's `counts` and section statuses, so the new counts arrive without a route change; the AC-173 schema region is untouched (V-15) |
| DV-12 | Observation, no change: `tsconfig.json` has `isolatedModules: true`, so ts-jest transpiles without type-checking; D-1's compile risk is real for `tsc` (and the scoped run above), not for Jest | Recorded so SA-WR-4b2's E-103 rationale reads correctly |

### SA-CR-4b2 conditions CR-1 and CR-2 (applied 2026-10-17)

| # | Change | Verification |
|---|---|---|
| CR-1 (FU-4B2-1) | Section 6 frame title is now **"Payment problems"** (`PAYMENT_PROBLEMS_TITLE`, new) with **no frame chip**. Block A keeps "Our payment problems (boosts) · As of now, UTC" as its part heading. Block B is a new group `problems-clients` holding the "Client payment problems" heading (`PROBLEMS_TITLE`, unchanged text) and the neutral "The businesses' problem, not ours" chip (`problems-clients-chip`), with the five client parts inside it. Section id `payment-problems` and every jump-link target unchanged; no link or tile label named Section 6 by the old title. Copy and markup only. One render test (L-32) updated to assert the new frame title, no frame badge, and the heading and chip on block B; no frozen pin touched | `app/admin/finance` **656 passed**; vocabulary guard **182 passed**; contrast guard `contrast.lf1.source.guard.test.ts` **85 passed**; `app/admin/components` **824 passed**; eslint on the three files exit 0 |
| CR-2 (FU-4B2-2) | **SQL checks 19 and 20 re-issued** in §13 on the event rule (check 20 shares check 19's revenue rule, so it was re-issued with it): a boost paid in the month gives total less tax whatever its status; refund and dispute_lost events recorded in the month are taken off the account of their purchase, in the event currency; a taxed purchase makes the event inexact (null); an event on a never-paid purchase is left out; held now is never deducted. The §13 intro records the re-issue and that both checks need `20261076` applied first | Script check: ASCII only, no apostrophe in any comment, no "into", one final `select` and one `;` per check |

Seven pins recomputed after CR-1: all unchanged (`3a1a2dd4…f6f8`, `b84e0c96…aabf`, `30f5fc24…2e01`, `24ff0da7…df9f`, `98ea0507…1e4b`, `02813360…5bd8`, `1f7cf07a…f144`). DV-3 and DV-5 are resolved by CR-1 and CR-2. CR-3 (Pin C quiet re-run) is QA's.

### Files

New: `lib/business-os/finance/boostProblems.ts`, `lib/business-os/finance/__tests__/boostProblems.test.ts`. Modified: the 23 files in `git diff --numstat` (finance read repository and test; `boostRevenue`, `creditsSection`, `accountEconomics`, `financeRules`, `financeTypes`, `financeHealth`, `financeHealthDeps` and their tests; the source guard; `financeCopy`, `RevenuePanel`, `PaymentProblemsSection`, `CreditsSection`, `FinanceView`; the route test and two render tests; the requirement §0.1 link).

## SA Review Notes

### SA Workplan Review

**Reviewed by SA, 2026-10-17, at `20b4cdf1`.**
**Status: APPROVED WITH CONDITIONS (SA-WR-4b2).** Code may start. SA applied E-102 to E-104 to §11I (FR-4B-10, FR-4B-15, and the §11I.8 frozen-pins row). No business question is raised.

### Rulings on the six mismatches

| # | Ruling |
|---|---|
| 1. Optional fields (D-1, SA-W116) | **Confirmed, a letter-only conflict with E-68 (E-103).** E-68 meant that Pin B's *values* cannot move, and its bytes stay identical. Optional fields keep its typed literals compiling. The builder test asserting that every new field is present on every built payload is **required** |
| 2. Held leaves the net (D-5) | **Consistent, not a BQ (E-102).** BD-17 makes "held" a *now* figure, so it cannot also be subtracted from a window. FR-4B-5, already approved, defines the net as gross − refunded − lost. FR-4B-10's "changes only where a refund or a lost dispute exists" was a factual slip that missed 4a's held subtraction, so the sentence is corrected. No money rule beyond BD-17 is decided here. With no live dispute, no live figure moves |
| 3. R-l / R-l′ not built (V-2) | **Correct:** §11I.2 already places them in 4b.2. Build them as in §4.3 |
| 4. Accounts tab tokens (D-3, SA-W118) | **Accepted:** a sixth export, `readReversalMoney`; `accountEconomics.ts` keeps zero event tokens; the export pin goes 5 → 6 with the planted control moved |
| 5. AC-145 (D-4, SA-W123) | **Allowed: one ruled update, under SA-Q72.** It adds the four read keys and the payload change, gives one new hash, and amends the comment to cite SA-Q72 alongside E-55. The previous hash stays as a second assertion over the payload with the 4b.2 keys removed. No other edit to that region |
| 6. heldNow (D-2, SA-W117) | **Accepted (E-104):** a per-currency list beside the lines |

### Other questions

- **SA-W119:** accepted. Dropping `amount_refunded_minor` from R-k is least data.
- **SA-W120:** accepted. The count headline's words live in `financeCopy.ts` (singular and plural constants); `financeHealth.ts` only fills in the number.
- **SA-W121:** accepted. The typed table-absent error is logged at `warn`.
- **SA-W122:** accepted.
- **SA-W124:** accepted. Paste the hunk list.

### Conditions

- **4B2-R1 (paging, the C-1 lesson).** Every `.from(` in the four methods, each id-chunk request included, keyset-pages at **1,000** until a short page. The repository test serves 1,000 rows per call and asserts the next-page call, for **each** method and inside a chunk. A single `.limit(5000)` or `.range(0, 4999)` anywhere fails the review.
- **4B2-R2 (isolation).** R-n′'s fail-closed filter, and a test with a foreign event, are mandatory. R-l′ puts `.eq('user_id')` on every page. With a business picked, R-n and R-l make zero calls (AC-229).
- **4B2-R3 (pins and compile).** The scoped `tsc` includes all seven pin files. Removing `held` from `FinanceBoostLine` must compile them unedited; if it does not, stop and raise it to SA.
- **4B2-R4 (BQ-13).** No lot or draw write anywhere. The source guard's existing "no lot writer" rule must stay green, and `boostProblems.ts` must be covered by it.

### Checked and fine

- **AC-173:** one fetch, because every read rides the existing server `Promise.all`; the route's schema is untouched (V-15).
- **Admin gate:** `requireAdmin` is unchanged (log-only route edit).
- **Currency:** no cross-currency sum. Lines, held now, block A and net are all per currency (BD-12).
- **Degradation (§7):** before the apply, figures read Unknown, the log is a `warn`, and there is no fallback.
- **CI:** no new job.
- **Estimate:** about 2.1 days (2.2 with T12), accepted.

### SA Code Review

**Code Review by SA, 2026-10-17. Reviewed: the uncommitted tree on `feature/bos-finance-health-4b2`.**
**Status: Code Approved with two small conditions (SA-CR-4b2).** The code is approved. CR-1 and CR-2 land in this slice before RM commits. SA re-checks those two diffs only.

#### Checked

| Item | Result |
|---|---|
| 4B2-R1 paging | ✅ All four reads use one keyset loop, `collect`: `.order('id').limit(size)` with `size` ≤ 1,000 (guarded by `limitsOf`), then `.gt('id', last)`, ending on a short page or at the `>=` ceiling. `collectByIdChunks` sends ≤ 100 ids per `.in()` and pages **each chunk** through `collect`. There is no `.range(` and no large `.limit(` (source guard), and tests serve 1,000 rows and assert the next page, including inside a chunk |
| 4B2-R2 isolation | ✅ R-n′ reads the account's purchases first (`.eq('user_id')` on every page), then only their events, and drops a foreign event (fail closed, tested). R-l′ has `.eq('user_id')` on every page. With a business picked, R-n and R-l make zero calls. The 401 / 403 / 400 route cases cover the four new methods |
| 4B2-R3 pins and `tsc` | ✅ The scoped `tsc` includes the seven pin files: canary 1, clean 0. SA recomputed the pins: `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a`, all unchanged |
| 4B2-R4 BQ-13 | ✅ No lot or draw write. `boostProblems.ts` is covered by the "no lot writer" rule and a purity rule |
| Optional fields (E-103) | ✅ `heldNow?`, `events?`, `bought?`, `boughtOutstanding?`, `boosts?`; the builder test asserts every one is present on built payloads |
| AC-145 (SA-Q72) | ✅ One ruled update: `EXPECTED_SHA256 = 39b35743…56ea`. `M4_SHA256 6761620e…5250` is re-asserted over the payload with the 4b.2 keys stripped (and the 6a hash from that), so only 4b.2 keys changed. The hunk list is pasted |
| AC-173 / admin gate | ✅ `route.ts` is untouched (`git diff --quiet`). Every read rides the one server request, and `requireAdmin` is unchanged |
| Per currency | ✅ Lines, held now, block A and net are grouped by currency; there is no cross-currency sum |
| Before `20261076` | ✅ `FinanceReadTableAbsentError` for 42P01 / PGRST205, logged at `warn` (`reason: 'table_absent'`). Refunded, lost and net read Unknown, the section is partial, there is no fallback, and no 500 |
| SA re-run | `app/admin/finance`, `lib/business-os/finance`, the finance route, the read repository and the vocabulary guard: 2951 of 2952 passed. **Pin C row 1 failed once under load** (32.7 s, while QA ran in parallel). It passed **11 of 11 alone**. See CR-3 |

#### Deviation rulings

| # | Ruling |
|---|---|
| DV-1 | Approved: `amount_total_minor` is needed for the SA-Q74 note |
| DV-2 | Approved: the `paid` boolean keeps the AC-88 "no date in the builder" rule |
| DV-3 | **Not approved as is. Fixed by CR-1** |
| DV-4 | Approved: the lib → app copy import follows the `adminWindowPresets` precedent and SA-W120 |
| DV-5 | **Fix in this slice, CR-2** |
| DV-6 | Approved: the window's events only; a lifetime flag would be a new read |
| DV-7 | Approved: fixed state words, as `reminders` |
| DV-8 | Approved: honest |
| DV-9, DV-10, DV-11 | Approved |
| DV-12 | Noted. E-103's reason is the scoped `tsc`, where Pin B's typed literals are compiled, so the ruling stands |

#### Conditions

- **CR-1 (Medium, FU-4B2-1 fixed now).** A money page must not label our own problems "The businesses' problem, not ours". The Section 6 **frame** title becomes "Payment problems", with no frame chip. **Block A** carries "Our payment problems (boosts)" as its sub-heading. **Block B** carries "Client payment problems" and the "The businesses' problem, not ours" chip as **its** sub-heading. Keep section ids and the F-5 jump-link targets unchanged. Update any link or jump label that names Section 6 the same way. This is copy and markup only, and no frozen pin names these strings (SA grep). Update the render tests that assert the old frame title.
- **CR-2 (Low, FU-4B2-2 fixed now).** Re-issue **SQL check 19** in §13 on the event rule, so it equals the Accounts tab again. Boost revenue is total − tax per purchase paid in the month. Refunded and lost amounts come from `business_os_boost_reversal_events` recorded in the month (kinds `refund` and `dispute_lost`) on the account of the event's purchase. An event on a taxed purchase makes the account inexact. The check must stay paste-safe (ASCII, no apostrophes in comments, never the editor word, one result set). It is a docs edit; the BA or Dev may apply it, and SA re-checks it.
- **CR-3 (Low).** Before handover, QA runs the full `app/admin/finance` suite once on a quiet machine. If Pin C row 1 times out again with 4b.2 present, stop and raise it to SA. The pin is frozen, so its timeout cannot be raised.

#### Code Approved for QA: Yes, with CR-1 to CR-3 before the RM commit

## QA Testing Report

> The `## QA Testing Report` heading was missing when QA arrived (only the placeholder line remained under SA's section, while the ToC still links `#qa-testing-report`). QA restored the heading here. No other line was touched.

**QA — 2026-10-17** (on the tree **after Dev applied CR-1 and CR-2**; the suites below that CR-1 can affect were re-run after it landed)
**Test mode:** full
**Strategy used:**
- **A + B + C:** Jest builder, repository, route, render and guard suites, run one at a time.
- **PGlite 0.5.8 with `20261076` applied**, using the 4b.1 self-test setup (roles, auth stub, plan rows), in the QA scratchpad and never production. **1,205 reversal events were written by the real `business_os_transition_boost_purchase`** for two accounts:
  - **A:** one purchase with 1,200 one-cent refund steps, plus an open dispute;
  - **B:** refund 500, then a dispute opened and lost, plus a second open dispute.
- A temporary untracked probe ran **the real `BusinessOsFinanceReadRepository`** (R-n, R-n′, R-l, R-l′) over those rows plus 150 synthetic A purchases (one 7-cent refund each), so 1,355 events in all. The fake PostgREST client honours `eq` / `in` / `gte` / `lt` / `gt` / `order` / `limit` and the **1,000-row max-rows cap**, and logs every request. The probe was deleted (`git status` clean of it).
- A scoped tsc with a canary, the pin hashes, and a paste-safety scan plus rule comparison for the re-issued checks 19 and 20.

**Focus:** api, security, schema, ui
**Skipped:** the live browser look and production checks 14, 15, 16, 19, 20, 25 and 26 (user, after #447 is applied and this PR merges).
**Input source:** prompt + workplan + coordinator notes (CR-1 to CR-3)

**Verdict: PASS. No bugs.** CR-1, CR-2 and CR-3 are all verified (below).

### Suite runs (each alone, worktree `neuronforge-finance-health`, branch `feature/bos-finance-health-4b2`, uncommitted)

| Suite | Result |
|---|---|
| `app/admin/finance`, **after CR-1, on a quiet machine with `--runInBand` (CR-3)** | 19/19, **656/656**, 84 s |
| `lib/business-os/finance` (after CR-1) | 17/17, 1729/1729 |
| The finance route `app/api/admin/business-os/finance` | 1/1, 106/106 |
| `lib/repositories` | 105/105, 2556/2556 |
| `app/admin/components` | 25/25, 824/824 |
| Vocabulary guard (after CR-1) | 1/1, 182/182; unedited |
| `lib/business-os/data-export` | 11/11, 424/424 |
| `lib/business-os/purge` | 16/16, 364/364 |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 287/287, 8790/8790 |
| `npm run lint:hooks` | exit 0 |

These match Dev's counts.

**CR-3 (Pin C):** `chargeChecksRequest.pin.render.test.tsx` alone with `--runInBand` gave **11/11, three runs in a row**. Inside the full quiet `app/admin/finance` run it was green too. No timeout with 4b.2 present, so nothing to raise.

**Pins (LF-normalised, recomputed before and after CR-1):** AC-173 `3a1a2dd4…f6f8` ✅, helper `b84e0c96…aabf` ✅, A `30f5fc24…2e01` ✅, B `24ff0da7…df9f` ✅, C `98ea0507…1e4b` ✅, C helper `02813360…5bd8` ✅, D `1f7cf07a…f144` ✅. All are clean against HEAD.

**AC-145 ruled update:**
- `EXPECTED_SHA256` = `39b35743527b3a1948efd30c3ebc2510eb0916301baa4ea8f2e0210d7e1556ea`.
- `M4_SHA256` `6761620e…5250` is still asserted over the payload with the 4b.2 keys stripped, and `SLICE_6A_SHA256` `b4d10bc1…588c` over that. **Both pass** in the route run.
- The region's diff is the SA-Q72 comment, the four `EXPECTED_CALLS` keys, the hash constant and the strip-and-reassert block. The other route-test edits are ordinary 4a tests following the removed `held` and the new count words (DV-7).

**Untouched:** `route.ts`, `supabase/`, `lib/business-os/boost`, `BusinessOsBoostPurchaseRepository.ts` and `BusinessOsCreditLotRepository.ts` are all clean against HEAD. So the page still makes one fetch.

**Scoped tsc:**
- Config in the scratchpad with an absolute `extends`. It includes all of `lib/business-os/finance`, `app/admin/finance` and `app/api/admin/business-os/finance`, the finance read repository and its test, Pin A, Pin D, and the five pins under `app/admin/finance/__tests__`.
- A canary in `boostProblems.ts` gave `(174,7) TS2322` only.
- The file was restored with `cp` and checked with `cmp` (identical).
- The clean run gives **exit 0, 0 errors**, before and after CR-1. Removing `held` compiles every pin unedited (4B2-R3).

### PGlite plus the real repository (R-n, R-n′, R-l, R-l′)

| Check | Result |
|---|---|
| Events written by the real transition function | 1,205 (A 1,201, B 4). **Lots 4, draws 0 after every refund, dispute and loss: no credit taken back (BQ-13, AC-213)** |
| R-n, October | **all 1,355 events**, no duplicate id, every event joined to its purchase, `reachedCeiling` false. Every request had `limit ≤ 1000` and every `.in()` held ≤ 100 ids; events paged in ≥ 2 requests and purchases in ≥ 2 chunks |
| R-n, September | **0 events.** B1's purchase was paid in September, but its refund and lost events are dated by `recorded_at` (October), so they count in October only |
| R-n′(A) | exactly A's **1,351** events (1,201 + 150) through ≥ 3 chunked event requests, each ≤ 100 ids and ≤ 1,000 rows. Every event belongs to an A purchase |
| R-n′(B) | exactly B's **4** events (refund, dispute_opened, dispute_lost and the second dispute_opened); **A's id appears nowhere** |
| R-l / R-l′(B) | open disputes A2 and B2 for all accounts, each with `disputeOpenedAt` from its `dispute_opened` event; R-l′(B) returns only B2 |
| A small ceiling | `reachedCeiling` reported, never a silent cut |

### CR-2: checks 19 and 20, re-issued

- **Paste-safe.** Both were extracted from the requirement and tokenised: 0 non-ASCII, 0 "into", 0 apostrophes in comments, one `;` each (one result set), no `SET`, no unclosed string.
- **Same rule as the Accounts tab.** Check 19 against `accountEconomics.ts`:
  - a boost in the paid family paid in the month gives total less tax, whatever its status;
  - refund and lost events recorded in the month are subtracted on the purchase's account;
  - an event amount of 0 does nothing (code `taken === 0` returns);
  - a non-zero event on a taxed purchase is inexact (SQL `null`, code `inexact`);
  - an event on an unpaid purchase is not revenue (SQL `b.paid_at is not null`, code `not_revenue`);
  - opened and won disputes move nothing (SQL `kind in ('refund','dispute_lost')`, code `reversalsOf` gives 0, 0).
- Check 20's events block is byte-identical to check 19's.
- Both fail with "relation does not exist" before `20261076`, as the note says.

### CR-1: Section 6 relabel

- The frame title is "Payment problems" (`PAYMENT_PROBLEMS_TITLE`) with no frame chip.
- Block A, "Our payment problems (boosts) · As of now, UTC", comes first.
- "Client payment problems" and "The businesses' problem, not ours" now sit on block B only (`PaymentProblemsSection.tsx:173`, `:181`, `:191`, `:194`).
- The render suites, vocabulary guard and pins are green after it.

### Edge cases

| Case | Result | Evidence |
|---|---|---|
| A refund counts in the refund month, not the purchase month | ✅ | builder "October … unchanged by the later refund" / "November: … negative net"; `financeHealth` AC-217; PGlite: the September-paid purchase's refund is in October only |
| A lost dispute counts in the month it was lost | ✅ | "October (opened only): nothing moves; November (lost): lost equals the event amount" |
| An open dispute is held now, makes K-5 red, and is out of net | ✅ | `financeHealth` AC-103 / AC-219: K-5 red "1 boost payment in dispute", value unchanged, held now shown, not in net; threshold is data; R-l failing makes K-5 grey "Dispute check failed" |
| A won dispute is not a loss | ✅ | "a won dispute is history: no money" |
| No credits taken back | ✅ | PGlite: 0 draws, 4 lots unchanged; 4B2-R4 guard green; no lot writer |
| Bought credits beside gifted | ✅ | `creditsSection` bought figures; K-4 and gifted unchanged (AC-104 / AC-105 / AC-228 tests) |
| Per currency, never summed | ✅ | lines, held now, block A and net grouped by currency (BD-12); no cross-currency arithmetic (4a guard) |
| More than 1,000 events, with paging and chunks | ✅ | PGlite plus the real repository (above); repository tests serve 1,000 rows per call, including inside a chunk (4B2-R1) |
| Account A never sees account B | ✅ | R-n′ parent-first plus the fail-closed filter (tested with a foreign event); probe R-n′(B) has no A id; AC-229 (R-n and R-l zero calls with a business picked) |
| Table missing (before `20261076`) | ✅ | `financeHealth` AC-224: 42P01 and PGRST205 give refunded, lost and net Unknown, `partial`, logged at **warn** not error, and every other section renders; any other failure is an error log |
| One fetch per page load | ✅ | AC-173 pin unedited and green; `route.ts` untouched; every new read rides the server `Promise.all` |

### Test Coverage

| AC | Verdict | Evidence |
|---|---|---|
| AC-102 | PASS (code), check 15 owed | `boostProblems.test.ts` per currency |
| AC-103 | PASS | `financeHealth` AC-103 cases (red, threshold, failure) |
| AC-104, AC-105 | PASS (code), check 16 owed | `creditsSection` bought tests |
| AC-106, AC-229 | PASS | `financeHealth` AC-229; probe isolation |
| AC-107, AC-232 | NOT-TESTED (user) | browser steps below |
| AC-217 | PASS | builder, `financeHealth`, PGlite dating |
| AC-218 | PASS | builder opened October / lost November |
| AC-219 | PASS (code), check 15 owed | `financeHealth` AC-219 |
| AC-220 | PASS (code), checks 14 and 26 owed | builder net with a minus sign |
| AC-221 | PASS | never-paid event note (`boostProblems` AC-221; builder) |
| AC-222 | PASS | deleted-account line, by-package grouping |
| AC-223 | PASS | unreadable events; injected ceiling; source guard |
| AC-224 | PASS | 42P01 and PGRST205 give Unknown plus warn |
| AC-225 | PASS | copy pin; "month of the purchase" absent |
| AC-226 | PASS | `financeHealth` AC-226; check 19 re-issued to match (CR-2) |
| AC-227 | PASS | opened date from the event; not-credited oldest change |
| AC-228 | PASS | bought figures; the "not taken back" sentence |
| AC-230 | PASS | column constants; payload scan; 401 / 403 / 400 zero calls |
| AC-231 | PASS | DF-5 re-pin, table pin and controls green; 7 pins equal |

### Issues Found
- **Bugs:** none.
- **Performance:** none. A heavy account is about 2 event pages plus purchase chunks, all inside the one server request.
- **Notes:**
  1. QA restored the missing `## QA Testing Report` heading (see the note at the top of this section).
  2. Recorded, not a defect: DV-6. The "Credits of a refunded boost are not taken back" sentence shows only while a refund event exists in the window, not for the lifetime.

### User browser steps (after #447 is applied, this PR is merged and deployed; read-only, about 10 minutes, `/admin/finance`)

1. **L-137.** This month, all businesses. In "Our revenue" the owner's test boost shows as before, with refunded 0, lost 0 and net equal to gross. The refund-timing sentence is absent (nothing refunded).
2. **L-137.** Switch to 30 days: the same purchase and the same figures. One request per window change (network panel).
3. **L-138.** "Held in open disputes now (not taken off any month)" reads none.
4. **L-139.**
   - Section 6 is titled **"Payment problems"**, with no chip.
   - Its first block is "Our payment problems (boosts) · As of now, UTC", showing no open dispute and no purchase not credited.
   - "Client payment problems" with "The businesses' problem, not ours" heads the second block only.
   - K-5 is grey, not red.
5. **L-140.** In Credits, "Bought credits outstanding" shows the owner account's 5,000 beside "Gifted credits outstanding", and K-4 is unchanged.
6. **L-141.** On the Accounts tab, the owner's boost figure equals Our revenue for that account. Pick the owner business: the summary shows the same.
7. **Optional SQL** (Supabase SQL editor, new tab each): check 19 for this month matches the Accounts tab row; checks 14, 15, 16 and 26 match their sections.

Anything that looks wrong: send a screenshot and the check rows to the session.

### Final Status
- [x] All code-level 4b.2 acceptance criteria pass. CR-1 to CR-3 are verified. AC-107 and AC-232 (manual) are the user's after merge. No bugs. **Ready for RM** once #447 is in main (merge `origin/main`, re-run T11; off auto-merge until then).
- [ ] Issues found

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Workplan created | Dev, on `feature/bos-finance-health-4b2` at `20b4cdf1`. Re-anchored to the code after 6b, DF-6 and M-8; eight spec-to-code differences (D-1 to D-8); SA-W116 to SA-W124 |
| 2026-10-17 | SA workplan review | APPROVED WITH CONDITIONS (SA-WR-4b2): six mismatches ruled, SA-W116 to SA-W124 accepted; 4B2-R1 to R4; requirement E-102 to E-104 applied by SA |
| 2026-10-17 | Implemented | Dev: T0 to T11 done, uncommitted; Implementation Notes with the verification counts, the AC-145 ruled update (new hash `39b35743…56ea`, E-55 hash still reproduces), DV-1 to DV-12, FU-4B2-1 and FU-4B2-2 proposed. Seven pins unchanged |
| 2026-10-17 | CR-1 and CR-2 applied | Dev: Section 6 frame relabelled "Payment problems", client heading and chip moved to block B; SQL checks 19 and 20 re-issued on the event rule (paste-safe). Suites green, seven pins unchanged; uncommitted |
| 2026-10-17 | SA code review | Code Approved with conditions (SA-CR-4b2): CR-1 Section 6 relabel, CR-2 check 19 re-issue, CR-3 Pin C quiet re-run; SA re-checks CR-1 and CR-2 |
