# Workplan: Client payments in approximate US dollars, slice 1a (server)

> **Last Updated**: 2026-10-27

**Developer:** Dev
**Requirement:** [ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md](/docs/requirements/ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md): §2.1 (EX-1 to EX-6), §5 to §8, §9 (D-0 to D-5), §11 slice 1a, §12 AC-2 to AC-12, and **SA-RR-CPU** (CPU-1 to CPU-8, rulings SA-Q-1 to SA-Q-10). Where SA-RR-CPU and the BA draft disagree, SA-RR-CPU wins.
**Branch:** `feature/client-payments-usd-1a` (worktree `neuronforge-cpu1a`), from `origin/main` at `a105fa4a`.
**Date:** 2026-10-26
**Status:** Code Complete (uncommitted, awaiting SA code review + QA). SA-WP-CPU1A approved with conditions W-1 to W-5 (§13). Two unforeseen pin moves (AC-48 count, AC-66 object) and one log-key rename await SA ruling (§12A).

## Overview

Slice 1a is the server half of the one approximate-dollar figure for client payments. The admin finance route reads the Exchange rates tab's current rates in the same request as the payments, through a new server-only wiring module in `lib/admin/exchangeRates/`. This follows the MRR precedent: read in the route, merged in the route. A new pure converter in the same folder takes the takings block's per-currency lines and the rate list. It converts each currency's Gross once, with exact BigInt division rounded half away from zero to the cent, and adds the cents. The result goes onto the existing takings section as one optional key, `takings.usd`. The finance lib (`lib/business-os/finance/**`) never sees a rate, and the takings builder and `buildFinanceHealth` do not change. CUR-3 is not loosened. New positive pins fix the one way in for rates and the one converter. A leak scan keeps the section out of every place EX-2, EX-4 and EX-6 forbid. The only pin that moves is AC-145, together with the finance wire types. 1a has no UI, no migration and no write.

## Table of Contents

1. [Step 0: code facts](#1-step-0-code-facts)
2. [Design](#2-design)
3. [Reads](#3-reads)
4. [Payload shape: `takings.usd`](#4-payload-shape-takingsusd)
5. [Pin moves](#5-pin-moves)
6. [Guards](#6-guards)
7. [Files to create / modify](#7-files-to-create--modify)
8. [Task list](#8-task-list)
9. [Tests](#9-tests)
10. [Acceptance criteria](#10-acceptance-criteria)
11. [Risks](#11-risks)
12. [Open SA questions](#12-open-sa-questions)
13. [SA Review Notes](#13-sa-review-notes)
14. [QA Testing Report](#14-qa-testing-report)
15. [Commit Info](#15-commit-info)
16. [Change History](#change-history)

---

## 1. Step 0: code facts

Read on 2026-10-26 from `origin/main` at `a105fa4a`, in this worktree.

| # | Fact | Where |
|---|---|---|
| F-1 | **The takings builder** `buildTakings` is pure. It counts a payment when `status` is exactly `succeeded` or `refunded` (`isCountedPayment`), reads each amount once with `toHundredths`, and groups `{ currency, field: 'gross' \| 'refunded', hundredths }` entries with `groupByCurrency`. That gives integer hundredths per normalised currency: `line.sums.gross`. | `lib/business-os/finance/takings.ts` L95, L133, L139-145 |
| F-2 | **The per-currency subtotals reach the wire as major-unit numbers.** `FinanceTakingsLine.gross = toMoney(line.sums.gross)`, which is `hundredths / CURRENCY_SCALE`, done once. The lines are the union of the currencies seen in counted payments and in succeeded refunds, so a line that only has refunds has `payments: 0, gross: 0`. `unreadablePayments` counts payment amounts that could not be read; `paymentsExact` is false when the payments read reached its ceiling. A line whose sum left the safe range sets `overflow`, which makes the block `partial`. Gross is never reduced by fees or refunds. | `takings.ts` L106, L160-174, L274-275; `financeTypes.ts` `FinanceTakingsLine`, `FinanceTakingsFigures` |
| F-3 | **Codes are normalised**: `normaliseCurrencyCode` trims and upper-cases, and anything that is not then three letters A to Z becomes `null`, the "Unknown currency" line. `toHundredths` is the exact reader. Applied to a wire `gross`, it returns the same integer, because `gross` is a whole number of hundredths divided by 100 once. The module exports exactly five names, pinned. | `lib/business-os/finance/currencyGroups.ts` L32-60; guard L461-467 |
| F-4 | **Takings is built on every tab**, the Accounts tab included, and with a business picked (scope `one`). With `figures: null` and `status: 'unknown'`, the payments read failed. | `lib/business-os/finance/financeHealth.ts` L1308-1346 |
| F-5 | **The finance route.** The order is `requireAdmin` → repeated key → strict Zod → platform-id 404 → window. With no business picked, `readFinanceMrr(null)` **starts before** `buildFinanceHealth`. It is awaited after: `await (mrrRead ?? readFinanceMrr(accountId))`, so with a business picked it starts only after the builder has found the plan row. The payload is `{ ...built, mrr, stripeMode }`. One `info` line carries statuses and counts, never an amount. | `app/api/admin/business-os/finance/route.ts` L267-290, L300-343 |
| F-6 | **The MRR precedent.** `lib/admin/billing/financeMrr.ts` is `server-only`, reads through a repository, never throws (a failure is `status: 'unknown'`), and its one caller is the finance route. The route test fakes it at its module (`jest.mock('@/lib/admin/billing/financeMrr')`). | `financeMrr.ts` L1-80; `route.test.ts` L94-111 |
| F-7 | **`ExchangeRatesRepository.listAll()`** reads every currency, enabled or not, with `rate_to_usd::text`, ordered by code. It has no paging (the table holds one row per currency, about 43), never throws, and returns `{ data: null, error }` on failure. `toExchangeRateWire` maps a row, reading a null `is_enabled` as disabled. Its header names `app/api/admin/exchange-rates/**` as the one permitted caller and says "Nothing reads these rates to convert money (D-5)". | `lib/repositories/ExchangeRatesRepository.ts` L1-49, L108-126, L292-305 |
| F-8 | **Importers of the repository (code):** `app/api/admin/exchange-rates/route.ts` (`listAll`), `…/sync/route.ts` (`listAll`), `…/[currencyCode]/route.ts`, and the barrel `lib/repositories/index.ts` L20 (a re-export). Names that appear only in a comment: `lib/repositories/types.ts`, `lib/admin/exchangeRates/exchangeRateRules.ts` L42, `lib/services/CurrencyService.ts` L14. **No guard pins these importers today** (SA-RR-CPU). | grep |
| F-9 | **`rateMath.divideHalfUp(numerator, denominator, places)`** is exact BigInt division, rounded half away from zero, and throws on a zero denominator. Its only importer outside `rateMath.ts` is `ecbRates.ts`, the rate sync. The header says "Nothing here takes or produces an amount of money (D-5)". The tsconfig target is ES2017, so the code uses `BigInt(…)` calls and never `10n` literals. | `lib/admin/exchangeRates/rateMath.ts` L1-57; `ecbRates.ts` L31 |
| F-10 | **The rate rules**: `BASE_CURRENCY = 'USD'`, `RATE_PATTERN = /^\d{1,6}(\.\d{1,6})?$/`, `isPositiveRate(rate)` (the pattern plus a non-zero digit), and `isRateStale({ currencyCode, lastUpdatedAt }, readAt)`. USD is never stale. A missing or unreadable date is stale. The threshold is `STALE_AFTER_DAYS = 35`. `parseDecimal` is in `lib/ai/pricing-research/decimal.ts`. | `exchangeRateRules.ts` L30-60, L139-141, L248-264 |
| F-11 | **CUR-3**: every file in the finance guard's `FILES` (the finance lib, `financeTypes.ts` included, the route, `recordedReads.ts`, `app/admin/finance/**`, the finance read repository) has comments stripped, and its code must not match `/exchange_rates/`. Planted control at L452. The bans `exchange_rates\|\bfx\b\|\brate\b` sit on `boostRevenue.ts` (L952), `planRevenue.ts` (L1118, L1125) and `accountEconomics.ts` (L1289). | `lib/business-os/finance/__tests__/finance.source.guard.test.ts` L97-108, L451-467 |
| F-12 | **Other rules that would bite on the route or `financeTypes.ts`**: no write verb or RPC, no `console.`, no tier or processor literal, and `MODE_WORDING` (`/livemode\|test.?mode\|live.?mode/i`, which also catches identifiers such as `latestMode`). New code must avoid those shapes. | same file L145-216, L663-741 |
| F-13 | **`rateSync.source.test.ts`** walks `lib/admin/exchangeRates/` (`LIB_FILES`). Its rules: exactly two full URLs in the folder, `fetch(` only in `ecbFeed.ts`, banned imports and float bans on **named** lists only (`SYNC_FILES`, and `NO_FLOAT_FILES = [MATH, PARSER, ROUTE]`). `FLOAT_BANS` include `Number(`, `parseFloat`, `parseInt`, `Math.`, `toFixed(` and BigInt literals. | `lib/admin/exchangeRates/__tests__/rateSync.source.test.ts` L51-112 |
| F-14 | **`redundantPages.source.guard`**: G-4 says no non-test file names the page route `/admin/exchange-rates` in code. G-6 walks `app/admin/exchange-rates/**`: fetches go only to `/api/admin/exchange-rates`, and nothing there uses `.from(`. **No rule pins "nothing converts".** 1a adds no file under `app/admin/`, so G-4 and G-6 are unaffected. | `app/admin/__tests__/redundantPages.source.guard.test.ts` L1-40 |
| F-15 | **The AC-145 baseline** (route test, L1211-1460) pins, for an all-businesses Overview request on a frozen clock (`2026-10-14T12:00:00Z`), the exact read calls (`EXPECTED_CALLS`), the `findNames` calls, the top-level keys (`EXPECTED_KEYS`), and the payload's SHA-256 (`EXPECTED_SHA256 = 333407…2215`). Each earlier ruled re-freeze is chained: strip the new keys and the previous hash comes back. Fixture: **one client payment of ILS 9,876.54 with the stored code `'ils'`, lowercase**, plus a refund of ILS 76.54. `TAKINGS_FIGURE` must never reach a log line (AC-69). `allReads()` (L409) proves zero calls on 401 / 403 / 400. | `app/api/admin/business-os/finance/__tests__/route.test.ts` |
| F-16 | **Other pins checked.** AC-173 (`financeRequest.pin`) pins the page's request literals and the route's Zod schema text, neither of which changes. Pin A (`KpiStrip.callers.pin`), Pin B (`financeTiles.pin`), Pin C (AI cost) and Pin D (Health) render fixtures; the page is untouched. The render fixtures `takingsSection()` build `FinanceTakingsSection` objects, so an optional key leaves them valid. `financeHealth.test.ts` (builder-level AC-145) is unaffected, because the builder does not change. | grep for each pin |
| F-17 | **The snapshot job** (`financeSnapshotJob.ts`, `financeSnapshot.ts`) uses neither `takings` nor `buildFinanceHealth` (SA-RR-CPU), so EX-4 holds for it with no change. | SA-RR-CPU §3 |
| F-18 | **The Exchange rates tab's own copy** says "Nothing on the platform converts money with them." That is user-facing, and it becomes untrue once 1b shows the figure. | `app/admin/exchange-rates/components/ExchangeRatesView.tsx` L149 |
| F-19 | No file that 1a touches has a `console.*` call: route 0, `financeTypes.ts` 0, `rateMath.ts` 0, repository 0. Nothing 1a adds or touches imports from `lib/business-os/entitlements/`. `fast-check` is not installed. | grep |

---

## 2. Design

### 2.1 Shape

```text
route.ts (requireAdmin first)
 ├─ ratesRead = readClientPaymentRates()        ← lib/admin/exchangeRates/clientPaymentRates.ts (server-only wiring)
 │                                                  └─ exchangeRatesRepository.listAll()   (existing method)
 ├─ built = await buildFinanceHealth(...)        ← unchanged; never sees a rate
 ├─ usd = buildClientPaymentsUsd({ takings: built.takings, rates: await ratesRead, readAt: now })
 │                                               ← lib/admin/exchangeRates/clientPaymentsUsd.ts (pure converter)
 └─ payload = { ...built, takings: { ...built.takings, usd }, mrr, stripeMode }
```

`{ ...built, takings: … }` overrides a key that already exists, so `takings` keeps its place in the top-level key order and `EXPECTED_KEYS` does not change. Inside takings, `usd` comes last, after `status`, `scope` and `figures`.

### 2.2 The wiring: `clientPaymentRates.ts`

- `import 'server-only'`, like `financeMrr.ts`. Its one caller is the finance route, after `requireAdmin`.
- `readClientPaymentRates(deps?: { reader?: Pick<ExchangeRatesRepository, 'listAll'> }): Promise<ClientPaymentRatesRead>`. It **never throws**:
  - `{ status: 'ok', rates: ClientPaymentRate[] }`
  - `{ status: 'failed' }`: a repository error, null data, or a thrown error caught.
- `ClientPaymentRate` is narrow, and the field mapping is explicit:
  - `code`: `currency_code`, raw. The converter normalises it.
  - `rate`: `rate_to_usd`, **text**.
  - `enabled`: `is_enabled === true`. This is the `toExchangeRateWire` rule, reused by calling `toExchangeRateWire`, so null means disabled in one place only.
  - `lastUpdatedAt`: `last_updated_at`.
- Logs: one `warn` on failure with `{ err }` only, and one `debug` with `{ rows: n }`. Never a rate or a code list.

### 2.3 The converter: `clientPaymentsUsd.ts`

It is pure: no I/O, no clock (`readAt` is passed in), no logger, no `server-only`.

```ts
export function buildClientPaymentsUsd(input: {
  takings: Pick<FinanceTakingsSection, 'figures'>;  // figures null → payments read failed
  rates: ClientPaymentRatesRead;
  readAt: string;                                    // the request's one clock, ISO
}): FinanceClientPaymentsUsd
```

The rules, in order. Each one cites the ruling it comes from.

1. **Payments unknown.** When `figures` is null, return `status: 'unknown'`, `totalUsd: null` and `rows: []`. `ratesRead` reports the read, and `stale` is false (AC-7).
2. **Rows.** One row per takings line with `payments > 0`, in the takings order (code ascending, Unknown last). A line that only has refunds is left out. It has no payments, and leaving it in would mark the figure `partial` for a refund (D-3, U-3).
3. **Amount.** `hundredths = readLineHundredths(line.gross)`, a thin export over `currencyGroups.toHundredths` (SA-Q-3, second option). A `null` result means a line that overflowed. That row gets `state: 'unusable'` and is not converted. It never touches a float: there is no `Math.round(x * 100)` here.
4. **Code.** `code = normaliseCurrencyCode(line.currency)`. When it is `null` (the "Unknown currency" line), the row gets `state: 'unusable'` and is never converted (CPU-2).
5. **USD.** When `code === BASE_CURRENCY`, cents equal hundredths, `rate: '1'`, `rateUpdatedAt: null` and `state: 'converted'`. No rate row is needed, the USD row's own `enabled` flag is ignored (it is fixed at 1, SA-R8), and the rule applies when the rates read failed too (SA-Q-3).
6. **Rates read failed.** Every row that is not USD gets `state: 'no_rate'`, and `ratesRead: 'failed'` (AC-5).
7. **Match.** Rate rows are matched on `normaliseCurrencyCode(rate.code)`, so a stored `ils` matches `ILS` (CPU-2):
   - none → `no_rate`;
   - more than one after normalising → `unusable`, because the match is ambiguous;
   - `enabled === false` → `disabled`;
   - `!isPositiveRate(rate)` → `unusable`. That covers zero, negative, empty, exponent and junk values. **A rate is never treated as 1** (XR D-4).
8. **Convert, once per currency.** `cents = divideHalfUp({ units: BigInt(hundredths), scale: 0 }, parseDecimal(rate), 0).units`. A currency amount in hundredths divided by (currency per $1) gives US cents, rounded half away from zero (AC-3).
9. **Stale.** `isRateStale({ currencyCode: code, lastUpdatedAt }, readAt)`. When it is true, `state: 'stale'`: the row **is still converted** and the section's `stale` flag is set (D-5, AC-6).
10. **Sum.** The total is the BigInt sum of the converted rows' cents. Each wire money number comes from integer cents through **one** edge function, `centsToWire(cents)`: refuse anything outside the safe-integer range, then `Number(cents) / CURRENCY_SCALE`, as `toMoney` does. See SA-Q-1A-1.
11. **Status.**
    - `unknown`: rule 1.
    - `partial`: any of the following:
      - a row that was not converted (`no_rate`, `disabled` or `unusable`);
      - `figures.paymentsExact === false` (the payments read reached its ceiling);
      - any converted line with `unreadablePayments > 0`.
    - `ok`: none of the above.
    - The refunds state and unreadable fees **do not** affect it, because the figure includes neither (D-3, D-4).
12. **Counts.**
    - `converted { payments, currencies }`: over the `converted` and `stale` rows.
    - `notConverted { payments, currencies }`: over the rest.

### 2.4 The route

- Rates read placement mirrors MRR (F-5):
  - no business picked: `const ratesRead = overview ? readClientPaymentRates() : null` starts before the builder;
  - business picked: the read starts after the builder has found the plan row;
  - Accounts tab: never (SA-Q-1A-4). A 404 for a business that does not exist therefore makes no rates read.
- **No cache** (SA-Q-8). Staleness uses the same `now` that resolved the window.
- Log line: `usd: { status, ratesRead, currencies: rows.length, notConverted: { payments, currencies }, stale }`, or `'not_built'` on the Accounts tab. Counts, flags and state words only. No amount, rate or code (SA-Q-6, EX-4).
- The header gains one paragraph, written in the style of the MK-4 paragraph.
- The query schema is **not** touched (AC-173 part B).

### 2.5 What does not change

- `takings.ts`, `financeHealth.ts`, `financeHealthDeps.ts`, `currencyGroups.ts` (code and exports)
- every page file, `BlockKpi`
- the snapshot job, the data export, the audit trail
- `app/api/business-os/**`
- the rate sync

`finance.source.guard.test.ts` is **not edited** (SA-Q-1A-6), so CUR-3 is visibly not loosened.

---

## 3. Reads

| Read | Method | Rows | When | New? |
|---|---|---|---|---|
| Client payments in window | `listClientPaymentsAllAccountsPaidInRange` / `…ForAccount…` | keyset 1,000 per page, ceiling → "at least" | as today | No |
| Exchange rates | `exchangeRatesRepository.listAll()` | one unpaged select of the reference table, about 43 rows, one per currency; PostgREST `max-rows` (1,000) caps it in any case | once per Overview / picked-business request, same request as payments (SA-Q-8) | **No new method**; one new caller (the wiring) |

There are no writes, no RPC, no aggregate select, no migration, and no new table, column, cron or outside fetch.

---

## 4. Payload shape: `takings.usd`

These are added to `lib/business-os/finance/financeTypes.ts`, which stays runtime-free. The header gains a paragraph on the BD-56 exception: this is the one field that is a total across currencies, converted, approximate, admin only, and never stored.

```ts
/** BD-56 (ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md): why a currency line was or was not converted. */
export type FinanceUsdRowState = 'converted' | 'stale' | 'no_rate' | 'disabled' | 'unusable';

export interface FinanceClientPaymentsUsdRow {
  /** Normalised code; null = the "Unknown currency" line (never converted, CPU-2). */
  currency: string | null;
  /** Counted payments (succeeded or refunded) on this line. */
  payments: number;
  /** The takings line's Gross, in its own currency (the same number as the table above). */
  gross: number;
  /** As stored, text (e.g. "3.700000"); '1' for USD; null when no usable row. */
  rate: string | null;
  rateUpdatedAt: string | null;
  state: FinanceUsdRowState;
  /** ≈ US dollars from integer cents; null unless `converted` or `stale`. */
  usd: number | null;
}

export interface FinanceClientPaymentsUsd {
  /** ok: every counted payment converted, exactly read; partial: "at least"; unknown: payments read failed. */
  status: FinanceSectionStatus;
  /** Σ converted rows, from integer cents; null only when `unknown`. Never part of our revenue (BD-1, EX-6). */
  totalUsd: number | null;
  rows: FinanceClientPaymentsUsdRow[];
  converted: { payments: number; currencies: number };
  notConverted: { payments: number; currencies: number };
  ratesRead: 'ok' | 'failed';
  /** Any converted row used a rate older than 35 days (D-5). */
  stale: boolean;
}

// on FinanceTakingsSection:
  /** BD-56: present on the Overview and the picked view; ABSENT on the Accounts tab. Set by the route, never the builder. */
  usd?: FinanceClientPaymentsUsd;
```

### Status values, by case

| Case | `status` | `ratesRead` | Rows | `totalUsd` |
|---|---|---|---|---|
| USD 100.00 + ILS 370.00 at 3.700000, fresh | `ok` | `ok` | USD `converted` 100.00, ILS `converted` 100.00 | 200.00 (AC-2) |
| ILS has no rate row | `partial` | `ok` | USD `converted`, ILS `no_rate` (usd null) | USD only |
| ILS row disabled | `partial` | `ok` | ILS `disabled` | USD only |
| ILS rate `0.000000` or junk text | `partial` | `ok` | ILS `unusable` | USD only |
| Unknown-currency line | `partial` | `ok` | `currency: null`, `unusable` | others |
| ILS rate updated 40 days ago | `ok` | `ok` | ILS `stale`, converted | both; `stale: true` |
| Rates read failed | `partial` | `failed` | USD `converted`, others `no_rate` | USD only (AC-5) |
| USD only, rates read failed | `ok` | `failed` | USD `converted` | USD |
| Payments read reached its ceiling | `partial` | as read | as computed | "at least" |
| A converted line has unreadable payments | `partial` | as read | as computed | "at least" |
| Payments read failed | `unknown` | as read | `[]` | null (AC-7) |
| No counted payment in window | `ok` | as read | `[]` | 0 (1b shows "No client payments in this window", never "≈ $0") |
| Accounts tab | key absent | — | — | — |

---

## 5. Pin moves

**Only AC-145 and the finance wire types move** (CPU-6). Each moves once, in this slice, with before and after hashes.

| Pin | Moves? | How |
|---|---|---|
| **AC-145** (`route.test.ts`) | **Yes, one ruled re-freeze** | **`EXPECTED_CALLS`** gains `'rates.clientPayments': [[]]`: the wiring was called once, with no argument. **`EXPECTED_KEYS`** does not change, because `takings` keeps its position. **`EXPECTED_SHA256`**: a new hash, with the fixture's ILS 9,876.54 at a mocked `3.700000` updated `2026-10-10`. That converts as 987,654 ÷ 3.7 = 266,933.51…, so 266,934 cents, $2,669.34, `ok`. The current `333407…2215` is kept as `AFTER_MK9_SHA256`, asserted after `delete takings.usd`, so the chain shows that the only byte change is that key. One `expect(takings.usd).toEqual({...})` states the section exactly. Nothing else in the test is edited. |
| Finance wire types (`financeTypes.ts`) | **Yes** | Three new exported types and one optional key on `FinanceTakingsSection`. No existing type is changed. |
| AC-173 (request and schema text) | **No** | The request and the Zod schema are untouched. |
| Pin A (`KpiStrip.callers`) | **No** | The page is untouched. |
| Pin B (`financeTiles.pin`) | **No** | The strip is untouched. |
| Pin C (AI cost), Pin D (Health) | **No** | Not touched. |
| `BlockKpi` hash `99c6969c…` | **No** | 1b's concern (CPU-5). |
| `financeHealth.test.ts` (builder AC-145) | **No** | The builder is unchanged. |
| `currencyGroups` export pin | **No** | Not touched. |

If any pin marked **No** moves, that is a defect: the work stops and goes back to SA.

**Recorded hashes (W-3), AC-145, frozen clock `2026-10-14T12:00:00Z`:**

| | SHA-256 |
|---|---|
| Before (MK-9, kept as `AFTER_MK9_SHA256`, asserted after `delete takings.usd`) | `333407516ae0d081d59e8372a499cf305c207adeebf931fd363b62e58f632215` |
| After (`EXPECTED_SHA256`, with `takings.usd`) | `aebc22cbbb234106b92ff83c99cee138b4b8701d46f700254d1bc048e92597ca` |

Byte-identical (no diff to the file): AC-173 (`financeRequest.pin.render.test.tsx`), Pin A (`KpiStrip.callers.pin.render.test.tsx`), Pin B (`financeTiles.pin.render.test.tsx`), Pin C (`chargeChecksRequest.pin`, AI cost), Pin D (Health), `BlockKpi.render.test.tsx` (`99c6969c…`), `financeHealth.test.ts`, the `currencyGroups` export pin and `finance.source.guard.test.ts`.

---

## 6. Guards

### 6.1 New: `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts`

Every rule is a pure function. It runs on the real files **and** on a planted control that must trip it. Comments are stripped with the shared `stripComments` (`tests/helpers/source-scan`), and CRLF is normalised (PR #394). The walk covers `app/`, `lib/`, `components/` and `hooks/`, skipping `__tests__`, `__mocks__` and `__fixtures__`.

| # | Rule (SA-Q-2 / CPU-3) | Real-file expectation | Planted control |
|---|---|---|---|
| G-a | **Importers of `ExchangeRatesRepository`.** A file counts if it imports from `…/ExchangeRatesRepository` or `./ExchangeRatesRepository`, or if it imports `exchangeRatesRepository` / `ExchangeRatesRepository` from the barrel `@/lib/repositories`. | Exactly: the three `app/api/admin/exchange-rates/**` routes, `lib/repositories/index.ts` (the re-export, SA-Q-1A-5) and `clientPaymentRates.ts` | An import planted in `financeHealth.ts` joins the list. A barrel import planted in the route joins. The name in a comment does not. |
| G-a′ | Non-vacuity | `listAll` is called in the wiring, and the three routes are found | — |
| G-b | **Importers of the wiring and of the converter** (non-test) | Each is imported by exactly `app/api/admin/business-os/finance/route.ts`, with exactly one import statement | A second importer planted in `TakingsSection.tsx` is caught. A duplicate import in the route is caught. |
| G-c | **Importers of `divideHalfUp`**, outside `rateMath.ts` itself | Exactly the rate-sync file `ecbRates.ts` and the converter | A planted import in `financeHealth.ts` or `boostRevenue.ts` is caught. |
| G-d | The converter is **pure**: no `server-only`, no logger, no repository, no `supabase`, no `Date.now(` or `new Date(`, and no `fetch(` | Holds | Each token planted is caught. |
| G-e | **The wiring's log calls** carry no `rate`, `rates`, `rate_to_usd` or `code` value: only `{ err }` and `{ rows }` | Holds | A planted `logger.info({ rate }, …)` is caught. |
| G-f | **The three existing bans are still there** (SA-Q-2 (e)) | `finance.source.guard.test.ts` still contains the `exchange_rates\|\bfx\b\|\brate\b` assertion for `boostRevenue.ts`, `planRevenue.ts` and `accountEconomics.ts`, and the CUR-3 `it.each(FILES)` rule | Removing one in a planted copy of the text is caught. |
| **L-1** | **Leak scan** (SA-Q-6, CPU-3, CPU-8). Tokens: `FinanceClientPaymentsUsd` (and `…Row`), `FinanceUsdRowState`, `buildClientPaymentsUsd`, `readClientPaymentRates`, `clientPaymentsUsd`, `clientPaymentRates`, and the access path `/takings\s*\??\.\s*usd\b/` | The holders of any token are a **subset** of `financeTypes.ts`, `clientPaymentsUsd.ts`, `clientPaymentRates.ts`, the finance route, and 1b's future `TakingsSection.tsx` and `financeCopy.ts`. The non-vacuity check requires the route, `financeTypes.ts` and the converter. | A token planted in each forbidden zone is caught. Planted files: `FinanceKpiStrip.tsx`, `financeTiles` code (in `FinanceKpiStrip.tsx` / the tile files), `accountEconomics.ts`, `ourRevenue.ts`, `financeSnapshot.ts`, `financeSnapshotJob.ts`, a `lib/business-os/data-export/` file, a `lib/business-os/bizql/` file, a `briefing/` file, an `insight/` file, a `chat/` file, `lib/services/AuditTrailService.ts`, a `lib/audit/` file, an `app/api/business-os/` route, and `BusinessDrawer.tsx` (BD-50). |
| L-1′ | **Named zones exist** (so the scan is not vacuous) | Each forbidden directory or file listed above exists and is walked | — |

### 6.2 Amended

| File | Change | Why | Control |
|---|---|---|---|
| `lib/admin/exchangeRates/__tests__/rateSync.source.test.ts` | Add `clientPaymentsUsd.ts` to `NO_FLOAT_FILES`, a **ruled list change** (SA-Q-9). The one sanctioned `Number(` sits inside `centsToWire`: the float scan runs on the file with that one function's declaration removed (the `MODE_ALLOWED_CONSTANTS` pattern). That function is pinned to exist exactly once and to hold exactly one `Number(`. The header gains a line about this. | CPU-1 | A second `Number(` planted outside `centsToWire` is caught. `Math.round(` planted is caught. A `10n` literal planted is caught. |
| `rateSync.source.test.ts`, the existing URL and `fetch(` rules | No edit. The two new files are walked automatically, have no URL and make no `fetch(` (SA-Q-9). | — | existing |
| `finance.source.guard.test.ts` | **No edit** (SA-Q-1A-6). The route still never names `exchange_rates`, because it imports `@/lib/admin/exchangeRates/…` and `exchangeRates` does not match. | SA-Q-2 | existing L452 |
| `redundantPages.source.guard.test.ts` | **No edit.** Checked (F-14): there is no "nothing converts" pin, and 1a adds no file under `app/admin/`. | SA-Q-9 | — |

### 6.3 Header and comment edits ("nothing converts" statements)

| File | Edit |
|---|---|
| `lib/admin/exchangeRates/rateMath.ts` | It keeps "Nothing here takes or produces an amount of money (D-5)", which stays true of the file. It adds one line: "`divideHalfUp` has one caller that converts money, the BD-56 exception: `clientPaymentsUsd.ts` (ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md)." (SA-Q-3) |
| `lib/repositories/ExchangeRatesRepository.ts` | "Nothing reads these rates to convert money (D-5)" becomes "Nothing reads these rates to convert money (D-5), except the admin Finance page's approximate-dollar client payments figure (FIN BD-56), through `lib/admin/exchangeRates/clientPaymentRates.ts`". The caller paragraph names the second permitted caller, also behind `requireAdmin` (the finance route), and states that the importer guard (G-a) enforces this. |
| `lib/business-os/finance/currencyGroups.ts` L19 | **Proposed, comment only** (SA-Q-1A-7). "No exchange rate exists anywhere in the platform (CUR-3)" is already untrue. It becomes "No exchange rate is read anywhere in the finance lib (CUR-3); the one conversion (BD-56) lives outside it." The export pin is unaffected. |
| Left alone | `exchangeRateRules.ts`, `ecbRates.ts`, `rateSyncRules.ts` and the exchange-rates route headers: each statement stays true of its own file (SA-Q-3). `CurrencyService.ts` is legacy and unwired. `ExchangeRatesView.tsx` L149 copy goes to 1b (SA-Q-1A-8). |

---

## 7. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/admin/exchangeRates/clientPaymentRates.ts` | create | The wiring, server-only (SA-Q-1) |
| `lib/admin/exchangeRates/clientPaymentsUsd.ts` | create | The pure converter (SA-Q-3) |
| `lib/admin/exchangeRates/__tests__/clientPaymentRates.test.ts` | create | Wiring unit tests |
| `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.test.ts` | create | Converter unit and property tests |
| `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts` | create | G-a to G-f, L-1 |
| `lib/business-os/finance/financeTypes.ts` | modify | Wire types + header paragraph (§4) |
| `app/api/admin/business-os/finance/route.ts` | modify | Read, merge, log line, header paragraph (§2.4) |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | modify | Mock the wiring; add it to `allReads()`; AC-145 re-freeze; new `takings.usd` describe; AC-69 extension |
| `lib/admin/exchangeRates/__tests__/rateSync.source.test.ts` | modify | `NO_FLOAT_FILES` + sanctioned edge (§6.2) |
| `lib/admin/exchangeRates/rateMath.ts` | modify | Header line only |
| `lib/repositories/ExchangeRatesRepository.ts` | modify | Header only, no code |
| `lib/business-os/finance/currencyGroups.ts` | modify (if SA agrees) | One comment line |
| `docs/workplans/CLIENT_PAYMENTS_USD_1A_WORKPLAN.md` | create | This file |

No migration, no page, no shared component. The requirement's §11 status row and Change History belong to the docs branch (BA / TL), not this PR.

---

## 8. Task list

- [x] 1. SA approves this workplan; apply SA notes here first.
- [x] 2. Wire types in `financeTypes.ts` (§4); typecheck the file.
- [x] 3. `clientPaymentsUsd.ts`: `readLineHundredths`, `centsToWire`, `buildClientPaymentsUsd` (§2.3).
- [x] 4. `clientPaymentsUsd.test.ts`: every case in §9.1, including the property test.
- [x] 5. `clientPaymentRates.ts` and its test (§2.2, §9.2).
- [x] 6. Route: read placement, merge, log line, header (§2.4).
- [x] 7. Route test: mock the wiring at its module, add it to `allReads()`, write the new `takings.usd` describe (§9.3), extend AC-69. Then the **AC-145 re-freeze**: before and after hashes recorded in §5 and here.
- [x] 8. Guards: the new source guard (§6.1) and `rateSync.source.test.ts` (§6.2), each with planted controls; confirm `finance.source.guard.test.ts` and `redundantPages` pass **unedited**.
- [x] 9. Header edits (§6.3).
- [x] 10. Verify: `npx jest lib/admin/exchangeRates lib/business-os/finance app/api/admin/business-os/finance app/admin/finance app/admin/__tests__ app/admin/components/layout lib/repositories/__tests__/ExchangeRatesRepository.test.ts`, plus `npm run test:bos-entitlements` (the repository folder is in its scope) and `npm run typecheck:bos-llm`. A `tsc --noEmit` run is filtered to the touched files, and the run is checked for an OOM crash. Then `npm run build`. Then `git diff --stat` (no deletion-only file).
- [x] 11. Status → Code Complete; changes left **uncommitted** for SA code review and QA.

---

## 9. Tests

### 9.1 Converter (`clientPaymentsUsd.test.ts`), pure and with a frozen `readAt`

| # | Case | Expect |
|---|---|---|
| T-1 | **Happy path (AC-2)**: USD 100.00 + ILS 370.00 at `3.700000`, fresh | `ok`; rows USD and ILS 100.00 each; `totalUsd` 200; `converted {2 currencies}` |
| T-2 | **Convert once, per currency**: ILS 0.01 + 0.01 at `4` | One row: 2 hundredths ÷ 4 = 0.5 → 1 cent. Converting payment by payment would give 0. |
| T-3 | **Half away from zero**: 3 hundredths at `2` → 2 cents; 1 hundredth at `4` → 0 | exact |
| T-4 | **Missing rate gives "at least"**: EUR line, no EUR row | `partial`; EUR `no_rate`, `usd` null; `notConverted {payments, 1}`; total = the others only |
| T-5 | **Disabled rate** (`enabled: false`; null `is_enabled` comes through the wiring as false) | `disabled`, `partial` |
| T-6 | **Stale**: the rate updated 36 days before `readAt`; and one with `lastUpdatedAt: null` | `stale`, converted, `stale: true`, status `ok`. At exactly 35 days: `converted`, not stale. |
| T-7 | **USD-only**: rates read failed, and also no USD rate row at all, and a disabled USD row | USD `converted` at `'1'`; `ok`; never stale |
| T-8 | **Lowercase codes**: payment `ils` (the builder normalises it to `ILS`) and a rate row `ils` | matched and converted |
| T-9 | **Zero or invalid rate**: `0`, `0.000000`, `-3.7`, `3.7e2`, `''`, `abc`, `1234567.1` | each `unusable`, `partial`; `divideHalfUp` never called with zero (no throw) |
| T-10 | **Duplicate rate rows after normalising** (`ILS` and `ils`) | `unusable` |
| T-11 | **The Unknown-currency line** (`currency: null`) | `unusable`, `partial`, counted in `notConverted` (CPU-2) |
| T-12 | **A line with only refunds** (`payments: 0`) and no rate | no row; status unaffected |
| T-13 | **The rates read failed**, mixed currencies | USD only in the total, others `no_rate`, `ratesRead: 'failed'`, `partial` (AC-5) |
| T-14 | **Payments at the ceiling** (`paymentsExact: false`); **unreadable payments** on a line | `partial` |
| T-15 | **The refunds read failed or reached its ceiling, unreadable fees** | status **not** affected (D-3, D-4) |
| T-16 | **Payments read failed** (`figures: null`) | `unknown`, `totalUsd: null`, `rows: []` (AC-7) |
| T-17 | **No counted payments** | `ok`, `rows: []`, total 0 |
| T-18 | **Refunded payments count** (through `buildTakings` with one `succeeded` and one `refunded`) | both in Gross, so both are converted (D-3, AC-8) |
| T-19 | **Property test (CPU-1)**: 500 seeded random windows (a mulberry32 PRNG, so no new dependency). Two-decimal amount strings up to 99,999,999.99; codes drawn from `usd`, `USD`, ` ils `, `EUR`, `gbp`, `xx`, `null`; statuses mixed. | For every line, `readLineHundredths(line.gross)` equals an independent `groupByCurrency` sum of `toHundredths` over the counted inputs. With every rate set to `1`, `totalUsd × 100`, read with `toHundredths`, equals the BigInt sum of those hundredths. |
| T-20 | `centsToWire` at `Number.MAX_SAFE_INTEGER` and one above | returns, then refuses: that row becomes `unusable` and the figure is never a wrong number |
| T-21 | The row order follows the takings lines (code ascending, Unknown last) | exact |

### 9.2 Wiring (`clientPaymentRates.test.ts`), with the reader injected

- An ok read maps field by field. A null `is_enabled` maps to `enabled: false`. The rate stays text (`'3.700000'` stays a string).
- `{ data: null, error }` gives `{ status: 'failed' }`. A thrown error gives `failed` and never rejects. `data: null` with no error gives `failed`.
- On failure the logger is called once with `{ err }`. No log argument contains a rate string.

### 9.3 Route (`route.test.ts`), with the wiring faked at its module

| # | Case | Expect |
|---|---|---|
| R-1 | 401 / 403 / 400 | the wiring is in `allReads()`, with zero calls (it joins the existing loop) |
| R-2 | **Happy path**: an Overview request with all businesses | `takings.usd` equals the exact section ($2,669.34, `ok`). The wiring is called once, **before** the builder resolves: the call is recorded before the first finance read settles. |
| R-3 | **The rates read fails, and the rest of the page is intact** | the wiring resolves `failed`. 200; `takings.usd.status: 'partial'`, `ratesRead: 'failed'`, ILS `no_rate`, `totalUsd: 0`. Every other section **deep-equals** the happy-path payload with `takings.usd` removed. |
| R-4 | **A business is picked** | `takings.usd` narrows to that business's lines; the wiring is called after the plan row is found. A picked id with no plan row returns 404 and **no** rates read. |
| R-5 | Accounts tab (`tab=accounts`) | no rates read; `takings.usd` absent; log `usd: 'not_built'` |
| R-6 | The payments read fails | `takings.usd.status: 'unknown'` |
| R-7 | **AC-69 extended**: the log lines | none contains `2669.34`, `266934`, `3.7`, `3.700000` or `ILS` from the section. The `usd` log key has exactly `status`, `ratesRead`, `currencies`, `notConverted`, `stale`. |
| R-8 | AC-145 re-freeze | per §5 |
| R-9 | **CPU-8**: no `app/api/business-os/**` route returns `usd` | covered by L-1 (source) |

### 9.4 Leak scan

L-1 and L-1′ (§6.1), with every planted zone.

---

## 10. Acceptance criteria

These are requirement AC-2 to AC-12, sharpened by SA-RR-CPU.

- [ ] AC-2 / T-1: USD 100.00 + ILS 370.00 at 3.7 → `totalUsd` 200.00; the USD line is exact.
- [ ] AC-3 / T-2, T-3, T-19: converted once per currency at the current rate (D-2), `divideHalfUp` half away from zero to the cent; no float touches a rate or an amount (CPU-1; the rateSync float ban on the converter).
- [ ] AC-4 / T-4, T-5, T-9, T-10, T-11: no rate, disabled, unusable or unknown code → not converted, not in the total, counted in `notConverted`, `partial`.
- [ ] AC-5 / T-13, R-3: the rates read failing → USD only, `partial`, `ratesRead: 'failed'`; the rest of the payload is unchanged.
- [ ] AC-6 / T-6, T-7: a rate older than 35 days → converted, `stale: true`; USD never stale.
- [ ] AC-7 / T-14, T-16, R-6: the payments read at its ceiling or an unreadable payment → `partial`; the payments read failing → `unknown`.
- [ ] AC-8 / T-18, T-15: `succeeded` and `refunded` both count; before fees; refunds never subtracted.
- [ ] AC-9 / R-4: the same accounts and window as the per-currency table; narrows with a business picked.
- [ ] AC-10 / G-a to G-f: CUR-3 unchanged and unedited; positive pins with planted controls; no finance file names the rates table or the repository.
- [ ] AC-11 / L-1: nothing outside the allowed files names the section (snapshot, export, strip, account economics, our revenue, audit, chat, `app/api/business-os/**`, drawer).
- [ ] AC-12: no write, no migration, no logged amount or rate (R-7, G-e); payments paged at 1,000; one bounded rates select.
- [ ] CPU-6: only AC-145 and the wire types move; the AC-145 chain proves the only byte change is `takings.usd`.
- [ ] CPU-8: the section exists only on `GET /api/admin/business-os/finance`, behind `requireAdmin`.
- [ ] No Stripe mode is named in any new file (BD-13); no `console.*`; Zod schema untouched.

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| RK-1 | Re-reading hundredths from the wire `gross` number could differ from the builder's integer sum | `toHundredths` is the builder's own reader. The property test T-19 proves equality over 500 random windows. An overflowed line is refused (`unusable`), never approximated. |
| RK-2 | The one `Number(` at the edge reads as a float leak | It is a single named function, used on safe integers only (refused otherwise). The rateSync scan allows exactly that declaration, with a planted control. SA rules on it (SA-Q-1A-1). |
| RK-3 | AC-145's re-freeze could hide an unintended change | The chained strip: `delete takings.usd` must give back the current hash `333407…2215`. Nothing else in the test is edited. |
| RK-4 | The rates read has no deadline; a hung read delays the page | The same exposure as MRR today: one small indexed select. A deadline is not added (that would be a new pattern; SA-Q-1A-9). |
| RK-5 | A rates read that starts early, on all-business requests that later 500 | It never rejects. The promise settles harmlessly, as MRR's does. |
| RK-6 | The leak-scan tokens are too generic (`usd`) or too narrow | `usd` alone is not a token. The type, function and module names, plus the `takings.usd` access path, are. Destructuring (`const { usd } = takings`) is not caught by the path regex. The type-name rule catches any typed consumer. This is noted for SA (SA-Q-1A-3). |
| RK-7 | The Exchange rates tab copy "Nothing on the platform converts money" becomes untrue | It matters only once the figure shows (1b). It is scheduled there (SA-Q-1A-8). |
| RK-8 | Shared `node_modules` junction | Worktree hygiene: never `git worktree remove --force`; unlink the junction first. |

---

## 12. Open SA questions

| # | Question | Recommended default |
|---|---|---|
| **SA-Q-1A-1** | The converter must output wire numbers, but `rateSync`'s `NO_FLOAT_FILES` ban includes `Number(`, and turning BigInt cents into a JS number needs one. How should the edge be handled? | One named edge function, `centsToWire(cents: bigint): number`. It refuses anything outside ±`MAX_SAFE_INTEGER` (compared as BigInt), then returns `Number(cents) / CURRENCY_SCALE`, the `toMoney` form. The float scan runs with exactly that declaration removed, and the function is pinned to exist once and to hold one `Number(` (planted control). Alternative: send decimal strings (`"2669.34"`) on the wire, with no `Number(` at all. That breaks the "money is a number on the finance wire" convention and pushes string formatting into 1b. |
| **SA-Q-1A-2** | Where do the integer hundredths come from? | Re-read the wire `line.gross` with `toHundredths`, through an exported `readLineHundredths` (SA-Q-3's second option). `takings.ts` and `financeHealth.ts` stay unchanged, and no non-wire field has to be threaded through the builder result and stripped before JSON. T-19 proves equality with the builder. |
| **SA-Q-1A-3** | Payload additions beyond SA-Q-4's field list. The proposal adds `converted { payments, currencies }`, so that 1b's "{n} payments in {m} currencies" needs no arithmetic on the page. The USD row carries `rate: '1'` and `rateUpdatedAt: null`, with state `converted` (no `base` state). The Unknown-currency line and an overflowed line use `unusable`. | Accept all three. They keep the state enum at SA's five values, and the page does no counting. |
| **SA-Q-1A-4** | The Accounts tab. Takings is built there too (F-4). Should `takings.usd` appear on it? | **Absent on the Accounts tab**, and the read is not made, as `aiCost.recorded` is (AC-167). Present on the Overview and in the picked view. |
| **SA-Q-1A-5** | `lib/repositories/index.ts` re-exports the repository. Is it an allowed importer for G-a? | Allow the barrel as a **re-export only**, and add a G-a clause that no file imports `exchangeRatesRepository` / `ExchangeRatesRepository` *from* the barrel (planted control). Removing the re-export would be an unrelated change. |
| **SA-Q-1A-6** | Where do the new pins live? | In a new guard file, `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts`. `finance.source.guard.test.ts` stays **byte-unedited**, so "CUR-3 is not loosened" is visible in the diff. G-f meta-checks that its three bans and the CUR-3 rule are still present. |
| **SA-Q-1A-7** | `currencyGroups.ts` L19 says "No exchange rate exists anywhere in the platform (CUR-3)". It is already untrue, and it is a "nothing converts" statement SA-Q-9 did not list. | Edit that one comment line in 1a (text in §6.3). There is no code change and the export pin is unaffected. If SA prefers zero diff in the finance lib apart from `financeTypes.ts`, leave it for slice 0's docs pass. |
| **SA-Q-1A-8** | The Exchange rates tab copy (`ExchangeRatesView.tsx` L149), "Nothing on the platform converts money with them.", becomes untrue. | Change it in **1b**, together with the figure, because 1a shows nothing. The wording, for 1b: "Rates an admin keeps by hand, in units of each currency per 1 USD. They convert one admin figure only: the approximate-dollar total of client payments on Finance." |
| **SA-Q-1A-9** | Should the rates read have a deadline (like R-j's 2 s)? | No. It mirrors MRR, which has none: one small select, and `readUnderDeadline` would be a new use for a reference read. Revisit if QA sees latency. |
| **SA-Q-1A-10** | `listAll` is unpaged, and "every list read ≤ 1,000 rows" applies. | Accept it as is. The table is bounded reference data, one row per currency (about 43), and PostgREST `max-rows` caps it at 1,000 in any case. A cut-off list could only make a currency `no_rate`, which is honest ("at least"). No new method. |
| **SA-Q-1A-11** | When should the rates read start with a business picked? | After the builder has found the plan row, exactly as MRR does, so a 404 id makes no extra read. With no business picked it starts before the builder, in parallel (SA-Q-1). |
| **SA-Q-1A-12** | Which log key? | Top-level `usd: { status, ratesRead, currencies, notConverted: { payments, currencies }, stale }` beside `sections`, or `'not_built'` on the Accounts tab. That is SA-Q-6's list plus `ratesRead`, a flag. |

---

## 12A. Implementation notes (Dev, 2026-10-27)

| # | Note | For SA |
|---|---|---|
| IN-1 | **Log key renamed `usd` → `takingsUsd`.** The existing AC-69-family log assertions forbid `/\bUSD\b\|"usd"/` in every log call, so a key literally named `usd` failed them. `takingsUsd` holds exactly SA-Q-1A-12's fields (`status`, `ratesRead`, `currencies`, `notConverted`, `stale`), or `'not_built'`. Renaming the key kept those assertions unedited. | Confirm the rename |
| IN-2 | **Unforeseen pin moves in `route.test.ts` (slice 2a describe).** AC-48 counts money keys inside `takings`; the new row's own-currency `gross` (beside its `currency`, so the rule itself holds) moves the count **8 → 9**. AC-66 states the whole takings object when R-e fails; it now carries `usd` (`status: 'unknown'`). Both edits are minimal and commented "pending SA ruling". CPU-6 says any other pin moving stops the work, so these need a ruling: accept both, or move `usd` out of `takings` (which would move `EXPECTED_KEYS`). | **Ruling needed** |
| IN-3 | Wiring logs `{ rows: result.data.length }` (not `rates.length`): G-e bans the word `rates` in a log call's arguments; message strings are blanked before that scan. | — |
| IN-4 | The converter exports `ClientPaymentRate` / `ClientPaymentRatesRead`; the wiring imports them with `import type` only. G-b pins this exactly (route = the one value importer; wiring = type-only). | — |
| IN-5 | The leak scan strips comments once per file (cached): without the cache it took over 5 minutes, and with it about 40 s. | — |
| IN-6 | Worktree hygiene: the first `node_modules` junction came out garbled (`C:\C:\…`), and the workplan report wrongly said it was fine. It was deleted and recreated correctly via a `.cmd` file. The main checkout's `node_modules` was not touched (842 entries). | — |

### Verification (W-5)

| Check | Result |
|---|---|
| Jest verify list (`lib/admin/exchangeRates lib/business-os/finance app/api/admin/business-os/finance app/admin/finance app/admin/__tests__ app/admin/components/layout lib/repositories/__tests__/ExchangeRatesRepository.test.ts app/api/admin/exchange-rates`) | 103 suites, 5,484 tests: 5,483 passed, 1 failed (`chargeChecksRequest.pin.render.test.tsx`, a timing flake under parallel `tsc` load; that file is unchanged and passes alone, 11/11) |
| New and changed suites | converter 29/29, wiring 5/5, source guard 36/36, `rateSync.source` 68/68, route 123/123 |
| `npm run test:bos-entitlements` | 313 suites, 9,399 tests, all passed |
| `npm run typecheck:bos-llm` | passed (the default heap hit an OOM; rerun with 8 GB) |
| `tsc --noEmit` (full, 8 GB heap, no OOM) | 1,853 pre-existing errors; **0 in touched files** after fixing one (`rateSync.source.test.ts` L201, `edges[0]` possibly undefined) |
| `npm run build` | **Compile step passed** (`✓ Compiled successfully`, no OOM; 8 GB heap). Run 1 failed on the known `next/font` download flake. Runs 2 to 4 compiled, then stopped at "Collecting page data" on routes this slice does not touch (`/api/admin/execution-stats`, `/api/business-os/chat-v2`), because the worktree has no `.env.local`: first Supabase, then `OPENAI_API_KEY`, even with placeholder values. A full green build needs the real env, so it is owed in CI or in the main checkout. Real secrets were not copied into the worktree. |
| `git diff --stat` | 7 tracked files, +311 / −13, no deletion-only file; 5 new files untracked |

---

## 13. SA Review Notes

### SA Workplan Review (SA-WP-CPU1A)

**Reviewed by SA — 2026-10-26** (against SA-RR-CPU in the requirement; code read in this worktree at `a105fa4a`)
**Status:** ✅ Approved with conditions (W-1 to W-5).

**Fit.** The design follows SA-RR-CPU exactly:
- It mirrors the MRR precedent: read in the route, merged in the route.
- `buildFinanceHealth` and `takings.ts` stay unchanged, and `finance.source.guard` stays byte-unedited, so it is visibly clear that CUR-3 is not loosened.
- The converter is pure BigInt, and the only payload change is one optional `takings.usd` section.
- The AC-145 chain (strip `takings.usd` → `333407…2215`) is the right proof that nothing else moved.
- Step 0 facts F-1 to F-19 match what I read. That includes `toHundredths`, `isPositiveRate` (the pattern plus a non-zero digit) and `isRateStale` (USD never stale).

**Rulings on §12**

| # | Ruling |
|---|---|
| **SA-Q-1A-1** | **Accept the one named edge, `centsToWire`. Do not use decimal strings.** Money is a major-unit number everywhere on the finance wire, and `toMoney` does this same `Number(...) / CURRENCY_SCALE` once at the edge. Strings would make 1b format money differently from every other Finance figure.<br>Conditions:<br>• The function refuses anything outside ±`MAX_SAFE_INTEGER`, compared as BigInt, and that row becomes `unusable` (T-20).<br>• It is the only `Number(` in the file. The float scan removes exactly that declaration, with a planted control for a second `Number(`, `Math.round(` and a `10n` literal.<br>• It is pinned to exist exactly once.<br>Removing a named declaration before a scan already has a precedent (`MODE_ALLOWED_CONSTANTS`), so this is not a new pattern. |
| **SA-Q-1A-2** | **Accept re-reading the wire `gross` through `toHundredths`.** This is the second option SA-RR-CPU allowed. It is the builder's own exact reader, and a whole number of hundredths divided by 100 once reads back to the same integer. Keeping `takings.ts` and `financeHealth.ts` unchanged is worth more than a non-wire field. T-19 is the required proof and must stay in the suite. An overflowed line reads as `null` and is `unusable`, never approximated. |
| SA-Q-1A-3 | **Accept all three:** `converted { payments, currencies }`, the USD row as `converted` with `rate: '1'`, and `unusable` for the Unknown line and an overflowed line. The state set stays at the five values. |
| SA-Q-1A-4 | **Accept: absent on the Accounts tab, and no read there.** This follows the `aiCost.recorded` precedent (AC-167). |
| SA-Q-1A-5 | **Accept.** The barrel counts as a re-export only. G-a fails any import of the repository *from* the barrel, with a planted control. Removing the re-export is out of scope. |
| SA-Q-1A-6 | **Accept.** The new guard file holds the pins. `finance.source.guard.test.ts` is byte-unedited, and G-f checks that its CUR-3 rule and the three `\brate\b` bans are still present. |
| **SA-Q-1A-7** | **In 1a, as the coordinator prefers.** It is a one-line comment in a code file, so it belongs in the code PR, not the docs PR. `codeOf` strips comments, so no finance guard sees it, and the five-export pin is unaffected. The proposed text is accepted. |
| **SA-Q-1A-8** | **In 1b, with the figure.** Until 1b ships, nothing on the platform shows a converted figure, so the sentence stays true from a user's point of view. The proposed wording is accepted for 1b, with two conditions:<br>• keep the existing "per 1 USD" form so the `usdCopy` guard is unchanged;<br>• 1b's diff shows the copy change to the user alongside the figure.<br>Record it as a 1b task in that workplan. |
| SA-Q-1A-9 | **Accept: no deadline.** This matches MRR. It is one small select of reference data, and `readUnderDeadline` here would be a new use. If QA measures the read above 300 ms, raise it as a follow-up. |
| SA-Q-1A-10 | **Accept** `listAll` unpaged. It is bounded reference data, about 43 rows, one per currency, and PostgREST max-rows caps it at 1,000. A cut list could only produce an honest `no_rate`. No new method. |
| SA-Q-1A-11 | **Accept.** With a business picked, the read starts after the plan row is found, as MRR does, so a 404 makes no read. With none picked, it starts before the builder. |
| SA-Q-1A-12 | **Accept** the top-level `usd: { status, ratesRead, currencies, notConverted, stale }`, or `'not_built'`. Counts, flags and state words only. |

**Conditions**
1. **W-1 (CPU-1):** the converter calls no float function other than `toHundredths` (through `readLineHundredths`) and `centsToWire`. `parseDecimal` and `divideHalfUp` take the rate text, with `isPositiveRate` checked first, so `divideHalfUp` can never throw on zero (T-9).
2. **W-2 (leak scan, RK-6):** add `FinanceTakingsSection['usd']` / `usd?:` typed access to the L-1 type-name tokens. Also add one planted control in which a forbidden file destructures `{ usd }` from a typed `FinanceTakingsSection`, caught through the type import. An untyped destructure of an `any` is not possible under strict mode in the forbidden zones.
3. **W-3 (pins, CPU-6):** record the before and after hashes for AC-145 in §5 and in the Implementation Notes. AC-173, Pins A to D, the `BlockKpi` hash `99c6969c…`, the builder-level AC-145 in `financeHealth.test.ts` and the `currencyGroups` export pin must all be byte-identical. If any of them moves, stop.
4. **W-4 (CPU-8):** the guard's non-vacuity check (L-1′) must find `app/api/business-os/` and the data-export folder. If a named zone does not exist under that path, fix the path; do not drop the zone.
5. **W-5 (hygiene):** the full verify list in task 10, `npm run build`, and `git diff --stat` with no deletion-only file. Changes are left uncommitted for code review.

**Estimate:** about 2 days is accepted. **Business questions:** none.

### Approval
[x] Workplan approved with conditions W-1 to W-5. Proceed to implementation.

### SA Code Review (SA-CR-CPU1A)

**Code Review by SA — 2026-10-27** (uncommitted tree on `a105fa4a`)
**Status:** ✅ Code Approved

**What I read**
- `clientPaymentsUsd.ts`, `clientPaymentRates.ts` and the route diff.
- The new guard, spot-checked: G-c, W-2's planted destructure and typed access, and the W-4 zones (`app/api/business-os/` > 50 files, `lib/business-os/data-export/` > 3 files).
- §12A IN-1 to IN-6 and §5.

**Correctness**
- **Converted once per currency.** Each currency's Gross is read back through `toHundredths` and converted with `divideHalfUp`, but only after `isPositiveRate`, so a zero rate is never divided by and no rate is ever taken as 1.
- **USD** converts at 1 with no rate row.
- **Codes** are matched after normalising, and duplicate rows after normalising make the currency `unusable`.
- **An overflowed line** reads back as `null` (the gross is outside the safe range) and becomes `unusable`, never a wrong figure.
- **The running total** is checked against the safe range before each add.
- **`partial`** comes only from a row that was not converted, the payments read reaching its ceiling, or unreadable payments on a converted line. Refunds and fees never change it (D-3, D-4).

**Route**
- The rates read starts before the builder only on the Overview with no business picked.
- With a business picked, it starts after the 404 check. On the Accounts tab it never runs (SA-Q-1A-4).
- It never rejects.
- `takings` keeps its key position.

**Logs**
- The wiring logs `{ err }` or `{ rows }` only. The route logs flags and counts only, with no amount, rate or code.

**Pins: CPU-6 / W-3 hold.**
- AC-145 moved `333407…2215` → `aebc22cb…97ca`. Removing `takings.usd` gives back the old hash, and the fixture (ILS 9,876.54 at 3.7) gives $2,669.34.
- No diff in AC-173, Pins A to D, `BlockKpi` `99c6969c`, `financeHealth.test`, the `currencyGroups` export pin, or `finance.source.guard`. CUR-3 is visibly not loosened.
- W-1, W-2 and W-4 are met.

**Rulings**

| # | Ruling |
|---|---|
| **1. AC-48 (8 → 9) and AC-66 (`usd` in the whole-takings object)** | **Both accepted as ruled re-freezes.** They follow directly from SA-Q-4, which put `usd` inside `takings`. AC-48 counts money keys in `takings`, and the new row's own-currency `gross` sits beside its `currency`, so AC-48's own rule still holds. AC-66 states the whole `takings` object on a failed payments read, and `usd` with `status: 'unknown'` is the specified answer (rule 1, AC-7). Moving `usd` out of `takings` would move `EXPECTED_KEYS` and go against SA-Q-4, so it is rejected. **Condition:** IN-2 records both with their before and after values, as it does. No other route-test pin moves. |
| **2. Log key `takingsUsd`, not `usd`** | **Accepted.** Existing log tests forbid the text "usd" in a log line. Renaming the key keeps them unedited and keeps SA-Q-1A-12's fields exactly. |
| **3. Build (W-5)** | **Accepted: CI's required Build check is the proof.** Locally, compile passed and only "Collecting page data" failed, on untouched routes, because the worktree has no `.env.local`. Not copying secrets into a worktree is correct. The PR must not merge until CI Build is green. |
| **4. The `chargeChecksRequest.pin` failure under load** | **Accepted as load-related.** The file is unchanged and passes alone. QA re-runs it alone and records the result. |

### Code Review Comments
None that block.

### Optimisation Suggestions
- `matchRate` filters the whole rate list once per currency. With about 43 rows and a handful of currencies that does not matter, so do not change it.

### Code Approved for QA: Yes

---

## 14. QA Testing Report

### QA — CPU-1a, 2026-10-27

**Worktree:** `neuronforge-cpu1a`, branch `feature/client-payments-usd-1a` on `a105fa4a`, uncommitted. Source stable since 00:14, before every run below.

| | |
|---|---|
| **Test mode** | full |
| **Focus** | api, schema, security (leak guard) |
| **Skipped** | UI, which is slice 1b |
| **Input source** | the coordinator's list, requirement §5 to §9 (D-0 to D-5) and AC-2 to AC-12, workplan §2 to §6, §12A, SA-WP-CPU1A and SA-CR-CPU1A |

**Strategy used**
- **A + B.** The verify list and every guard, each run alone. The verify list totals equal Dev's exactly.
- **Code read.** The converter, the wiring, the route diff, `divideHalfUp`, and the new guard's matchers.
- **One temporary, untracked probe, deleted afterwards** (`git status` is clean of `zz_*`; not kept as a permanent test). It runs real payment rows through `buildTakings` into `buildClientPaymentsUsd`, and checks every row and total against an **independent BigInt calculation**:
  - it parses the amount strings and rate text itself;
  - it rounds half-up as `(2·h·10^s + R) div 2R`;
  - it compares through the one wire edge `centsToWire`, so no float is involved.
- **Matcher tests.** The leak scan's own regexes, run on realistic access forms.
- **A scoped tsc with a canary**, and `typecheck:bos-llm` at 8 GB.

**Verdict: FAIL.** One Medium finding: the leak guard misses common access forms, so AC-11 is not met as written. It is a small, test-only fix. **The conversion, the route, the pins and everything else pass.**

#### User decisions

| Decision | Result | Evidence |
|---|---|---|
| **D-3:** refunded payments count; other statuses do not | ✅ | Probe: `succeeded` and `refunded` counted; `pending` and `failed` excluded (ILS 3 payments, Gross 45,618.50, the pending 999.99 not in it). Dev's T-18 runs through the real builder |
| **D-4:** before fees | ✅ | The converter reads only `line.gross` and `payments`. Fees and refunds never change the status (T-15, code read) |
| **D-2:** the current rate on the Exchange rates tab | ✅ | The wiring reads `exchangeRatesRepository.listAll()` once per request, with no cache. Rates are text, "currency per 1 USD" (`ecbRates.ts:92`), so dividing gives dollars |
| **D-5:** a stale rate is still converted and flagged | ✅ | Probe: updated **exactly 35 days** before `readAt` → `converted`, not stale; **35 days + 1 ms** → `stale`, still converted ($100.00), status `ok`, `stale: true`. USD is never stale |
| A missing or disabled rate is left out, and the total is "at least" | ✅ | Probe (USD 100 + ILS 370 + EUR 50): EUR missing → `no_rate`; disabled → `disabled`. Either way the status is `partial`, the total is **$200** (the others only), and `notConverted {1 payment, 1 currency}` |
| Never added to our revenue, never stored, admin only | ✅ (with **B-1** below) | The section is computed in the route and merged after the builder. The builder, `takings.ts`, the snapshot job and the export are byte-identical. The route keeps `requireAdmin` first (authz guard 203/203). There is no write. The logs carry no amount, rate or code (R-7) |

#### 1. Conversion accuracy (probe, independent BigInt)

| Case | Result |
|---|---|
| **Realistic data.** USD + ILS + EUR + GBP, with lowercase and padded codes (`usd`, ` USD `, `ils`, ` eur `, `gbp`, a rate row `ils`), mixed statuses, rates `3.700000`, `0.912345` and `0.786543`, and a disabled USD row that is ignored | ✅ Every row equals the independent cents, and so does the total: **$25,122.53**. For example ILS 45,618.50 ÷ 3.7 = 12,329.324… → **$12,329.32**, and EUR 100.05 ÷ 0.912345 = 109.662… → **$109.66**. USD converts with `rate: '1'` and **no rate row needed** |
| **Rounding edges** | ✅ At rate 2, 0.01 → $0.01 (exact half up) and 0.03 → $0.02. At rate 4, one payment of 0.01 → $0, but **two** payments of 0.01 → $0.01: the currency is converted **once**, not payment by payment. A 6-decimal rate (`0.333333`) also matches |
| **Large totals** | ✅ 120 payments of ILS 99,999,999.99 at `3.712345` → **$3,232,458,189.85**, equal to BigInt, `ok` |
| **Fuzz.** 400 random windows: up to 25 payments each, amounts up to 99,999,999.99, mixed-case codes, 6-decimal random rates, mixed statuses | ✅ **Every** row and every total equals the independent BigInt calculation |

#### 2. Edge states

| Case | Result |
|---|---|
| Missing, disabled, zero (`0.000000`), junk (`abc`) or exponent (`9e-1`) rate | ✅ `no_rate` / `disabled` / `unusable` / `unusable` / `unusable`. Each is `partial`, `usd: null`, total = the others ($200). Never a rate of 1, and never a division by zero |
| Duplicate rate rows (`EUR` and `eur`) | ✅ `unusable` (ambiguous), `partial` |
| Unknown-currency line (`null` and `''` codes) | ✅ One `currency: null` row, 2 payments, `unusable`, `partial`, total $100 |
| Stale | ✅ As D-5 above |
| USD only: no rate rows, rates read failed, or a disabled USD row (rate 7, 2020) | ✅ Each gives `ok`, $12.34, `rate: '1'`, `converted`, never stale |
| No payments | ✅ `ok`, `rows: []`, total 0 |
| Payments at the ceiling | ✅ `partial`, even with every rate present |
| **Rates read failed** | ✅ Mixed → `partial`, `ratesRead: 'failed'`, USD only ($100). Through the route (R-3): **the rest of the payload is deep-equal** to the happy path (`withoutUsd(data)` equals `withoutUsd(happy)`), and the response is 200. **Note on the brief:** the coordinator's list says `usd` must be `unknown` here. The requirement's AC-5 and the workplan's status table say **`partial`**, with USD only and `ratesRead: 'failed'`, which is what is built. `unknown` is the failed-*payments* case. Built as specified; the brief's wording is the outlier |
| Payments read failed | ✅ `unknown`, `totalUsd: null`, `rows: []`. Through the route as well (R-6) |

#### 3. Route

| Item | Result | Evidence |
|---|---|---|
| Overview, no business: the rates read runs early | ✅ | `ratesRead = accountsTab === null && accountId === null ? readClientPaymentRates() : null`, before `buildFinanceHealth`. R-2 asserts the call order is before the payments read |
| Business picked: only after the plan row; a 404 makes no rates read | ✅ | The read starts in the `usd` expression, after the `account_not_found` 404 and the 500 returns (code read). R-4 (order after `findPlanForAccount`) and R-4b (404, not called) |
| Accounts tab: no rates read, no `takings.usd` | ✅ | R-5: no `usd` key, wiring not called, log `takingsUsd: 'not_built'` |
| `requireAdmin` first | ✅ | Unchanged. `test:authz-guard` 203/203. 401/403/400 still make no read: the route's `allReads()` includes the wiring |
| Logs: no amount, rate or code; key `takingsUsd` | ✅ | R-7: the info line's `takingsUsd` holds `{status, ratesRead, currencies, notConverted, stale}`. No log call carries `2669.34`, `266934`, the rate, `3.7` or `ILS`. The wiring logs `{ err }` or `{ rows }` only (G-e); the converter has no logger (G-d) |
| The early, unawaited promise | ✅ | `readClientPaymentRates` never rejects, so a builder failure leaves no unhandled rejection |

#### 4. Leak and guards

| Guard | Result | Evidence |
|---|---|---|
| New `clientPaymentsUsd.source.guard`: G-a to G-f with planted controls | ✅ | Green, inside the `lib/admin/exchangeRates` run (13 suites, 653 tests) |
| W-4: zone folders exist | ✅ | L-1′ asserts every zone exists and is walked, `app/api/business-os/` has more than 50 files and `lib/business-os/data-export/` more than 3 |
| W-2: typed access and destructure, with planted controls | ⚠️ **B-1** | Its controls pass, but the matcher is narrower than the leak it guards against (below) |
| `rateSync.source.test`: no-float scan on the converter, with `centsToWire` the one sanctioned `Number(` | ✅ | Green, with its planted controls |
| `finance.source.guard` byte-unedited (CUR-3 not loosened) | ✅ | `git diff --quiet HEAD` holds; G-f pins its CUR-3 rule and the bans |
| No current leak | ✅ | The only non-test files mentioning both `takings` and `usd` are the route, the types and the converter, plus an unrelated AI cost string in `financeCopy.ts` (unchanged on this branch) |

#### 5. Pins

| Pin | Expected | Got |
|---|---|---|
| AC-145 | `aebc22cb…97ca`; removing `takings.usd` gives `333407…2215` | ✅ `EXPECTED_SHA256 = aebc22cbbb23…97ca`; `AFTER_MK9_SHA256 = 333407516ae0…2215` is asserted after `delete takings.usd`; the route suite is green |
| AC-48 (8 → 9) and AC-66 (`usd` in the whole-takings object) | ruled re-freezes | ✅ The only other removed lines in `route.test.ts` are exactly these two and the hash constant |
| AC-173 | unchanged | ✅ `3a1a2dd4` / `b84e0c96` |
| Pin A / Pin B / Pin C / Pin D | unchanged | ✅ `a130d560` / `a1b3db0c` / `e57f2675`, `64a565e9` / `1f7cf07a` |
| BlockKpi `99c6969c` | unchanged | ✅ The `BlockKpi.tsx` and test files are byte-identical; the test's constant is still `99c6969c1c39…fad4` |
| `financeHealth.test` | unchanged | ✅ byte-identical, as are `financeHealth.ts`, `takings.ts`, `financeHealthDeps.ts` and every `app/admin` file |
| **`chargeChecksRequest.pin.render.test.tsx` alone** (SA) | record | ✅ **1/1 suite, 11/11 tests**, run alone. Its failure in Dev's run was load |

#### Suite runs (each alone)

| Suite | Result |
|---|---|
| `lib/admin/exchangeRates`, `ExchangeRatesRepository.test`, `app/api/admin/exchange-rates` | 13/13, 653/653 |
| `lib/business-os/finance` + finance route (AC-145, AC-48, AC-66) | 26/26, 2400/2400 |
| `app/admin/finance` + `app/admin/__tests__` + `app/admin/components/layout` | 64/64, 2431/2431 |
| **The verify list in total** | **103 / 5,484 = Dev's count, all passed** (Dev's one failure was the Pin C load flake) |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 313/313, **9399/9399** |
| `npm run lint:hooks` | exit 0 |
| `typecheck:bos-llm` (`NODE_OPTIONS=--max-old-space-size=8192`) | passed: **590 files in scope, 11 errors, 0 new**; exit 0, no OOM trace |
| Scoped tsc | 212 files: `lib/admin/exchangeRates`, `lib/business-os/finance`, the finance and exchange-rates routes, and the repository with its test. Canary `clientPaymentsUsd.ts(199,7) TS2322`, restored with `cp` and checked with `cmp` (identical). Clean run: **exit 0, 0 errors** |

#### Issues Found

##### Bugs (must fix before commit)

**B-1 (Medium, guard): the leak scan misses the natural ways a forbidden file would read the section, so AC-11 is not met as written.**
File: `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts`, `TOKENS` / `TYPED_USD`.

`TOKENS` catches the access path `takings.usd` / `takings?.usd`. `TYPED_USD` needs the file to name **`FinanceTakingsSection`**. But the forbidden zones that hold this data are typed through **`FinancePayload`**, for example `FinanceKpiStrip.tsx` with `data: Pick<FinancePayload, …>`. I ran the guard's own regexes on realistic snippets:

| Form, in a file importing `FinancePayload` only | Caught? |
|---|---|
| `data.takings.usd` | ✅ |
| `data.takings?.usd` | ✅ |
| `const { usd } = data.takings;` | ❌ **missed** |
| `const { takings: { usd } } = data;` | ❌ **missed** |
| `const t = data.takings; … t.usd?.totalUsd` | ❌ **missed** |
| `data.takings["usd"]` | ❌ **missed** |
| `type U = FinancePayload["takings"]["usd"]` | ❌ **missed** |

Each missed form compiles under strict mode. So a later change could read the converted figure in the strip, a snapshot or the chat, and R-1 / AC-11's guard would stay green. There is **no leak today** (checked above). This is about the guard's strength, under a user-sanctioned exception to a core rule.

**Suggested fix (test-only).**
1. Treat `FinancePayload` like `FinanceTakingsSection` in `TYPED_USD`. Simpler still: any file whose code names `takings` and also has `\busd\b` in a destructure, member access or index on a takings-derived name.
2. Add `takings\s*\??\.?\s*\[\s*['"]usd['"]\s*\]` and `\[\s*['"]takings['"]\s*\]\s*\[\s*['"]usd['"]` to `TOKENS`.
3. Plant each missed form above in a forbidden zone as a control.

Keep the existing "a bare `usd` with no takings type is not a leak" control. No product file or pin changes.

**Fixed by Dev (2026-10-27):** this was a test-only change in `clientPaymentsUsd.source.guard.test.ts`. No product file or pin moved.
- `TOKENS` now also matches bracket access: `takings['usd']`, `takings?.['usd']` and the indexed type `['takings']['usd']`, with any quote style.
- `TYPED_USD` is now `REACHES_TAKINGS && READS_USD`.
  - `REACHES_TAKINGS` is true when the file names `takings`, `FinanceTakingsSection` or `FinancePayload`.
  - `READS_USD` catches each of these: member access (`.usd` / `?.usd`, so `const t = data.takings; t.usd` is caught), bracket access (`['usd']`), a destructure (`{ usd } =`, `{ usd: alias } =`, and nested `{ takings: { usd } } =` with or without a type annotation), and a declaration (`usd?:`).
- **Controls added.** Seven forms are planted in **every** forbidden zone, 17 zones × 7, all caught: QA's five missed forms, plus an aliased destructure and a typed nested destructure. One more test checks the regexes alone on each form.
- **Precision.**
  - The real-file check still holds: the only holders are the route, the wiring, the converter and the types. `TakingsSection.tsx` and `financeCopy.ts` stay allowed for 1b.
  - A bare `usd` in a file with no takings reach is still not a leak. That control moved to `AuditTrailService.ts`, because the strip reaches `FinancePayload`, where any `usd` read is now deliberately counted.
- **Results.**
  - Guard: 157/157.
  - `lib/admin/exchangeRates` plus the route test: 10 suites, 640/640, `rateSync.source` included.
  - Full `tsc` (8 GB heap, no out-of-memory crash): 0 errors in the touched files. The 7 new errors are in `.next/types` files generated by the local build, for routes this slice does not touch.

##### Low / Info

- **The brief's "`unknown` on a failed rates read" does not match the spec.** The built `partial` + `ratesRead: 'failed'` follows AC-5 and §4's status table.
- **The full `npm run build` is owed in CI.** The compile step passed locally; there is no `.env.local` in the worktree. SA accepted this (SA-CR-CPU1A ruling 3).

#### Final Status

- [ ] All acceptance criteria pass, ready for commit
- [x] **Issues found: B-1 (Medium, test-only) must be fixed before commit.**
  - AC-2 to AC-10 and AC-12, D-0 to D-5, the route rules, the pins (AC-145 `aebc22cb…`; AC-48 and AC-66 ruled) and every suite, typecheck and tsc are verified.
  - The conversion matches an independent BigInt calculation across realistic data, rounding edges, large totals and 400 random windows.
  - **Re-QA scope after the fix:** the guard diff, its new controls, the new-guard suite, and a re-run of `lib/admin/exchangeRates`.

#### QA re-test of B-1, 2026-10-27: PASS

**Scope:** the guard change only (`clientPaymentsUsd.source.guard.test.ts`), as named above.

**Nothing else changed.** Every other file's timestamp predates my first QA run. The converter's 01:38 timestamp was my own canary restore: `cmp` against my saved copy shows it is byte-identical. The pins and `finance.source.guard` are unchanged (`git diff --quiet HEAD`), and AC-145 is still `aebc22cb…97ca`.

**1. My forms, run through the guard's own regexes.** A scratchpad script extracts `TOKENS`, `REACHES_TAKINGS` and `READS_USD` from the guard file itself, so the test is against what the guard really runs. Each snippet sits in a file that imports `FinancePayload` only.

| Form | Before the fix | Now |
|---|---|---|
| `const { usd } = data.takings;` | missed | ✅ caught |
| `const { takings: { usd } } = data;` | missed | ✅ caught |
| `const t = data.takings; … t.usd?.totalUsd` | missed | ✅ caught |
| `data.takings["usd"]` | missed | ✅ caught |
| `type U = FinancePayload["takings"]["usd"]` | missed | ✅ caught |
| `data.takings.usd` / `data.takings?.usd` | caught | ✅ caught |
| Extra variants: an aliased destructure `{ usd: converted } = data.takings`, a multi-line destructure, an optional bracket `takings?.["usd"]`, an arrow typed parameter `({ usd }: FinancePayload["takings"]) =>`, component props `({ usd }: { usd: FinancePayload["takings"]["usd"] })` | — | ✅ all caught |
| **A function declaration with a typed parameter destructure:** `function f({ usd }: FinancePayload["takings"]) { return usd; }` | — | ⚠️ **missed** (see L-1 below) |

**Precision.**
- With no takings reach, `above.usd`, `finding["usd"]` and `const usd = 1` are all **not** flagged.
- The guard's own B-1 precision test is green.

**2. Over-breadth on the real tree.**
- The guard's L-1 test ("every holder is an allowed file; the route, the types and the converter hold it") passes on today's code. So none of the 17 forbidden zones, and no other non-test file, is flagged by the wider matcher.
- The allowed set is unchanged.
- The W-2 planted case (typed access and destructure caught, bare `usd` in `AuditTrailService` not caught) is green.
- **Guard suite: 157/157.**

**3. Re-run of `lib/admin/exchangeRates`:** 9 suites, **517/517**. This includes the converter (29), the wiring (5), the new guard (157) and `rateSync.source` (68). Dev's 640 also includes the route suite, which was green at 2400 in my first run and is unchanged since.

**L-1 (Low, not blocking).** One narrow form still passes the guard: a **function declaration** that destructures `usd` in a typed parameter. `READS_USD`'s destructure branch needs an `=` after the pattern. An arrow function has one (`=>`), but `function f({ usd }: …) {` has none, and `return usd` is a bare name. Components are usually typed through their own props or `FinanceClientPaymentsUsd`, which `TOKENS` catches, so this is unlikely. If wanted later, a destructure branch followed by `:` and `)` would cover it, with one planted control.

**Final status (supersedes the box above):**

- [x] **B-1 is fixed and verified. All CPU-1a acceptance criteria, D-0 to D-5 and the pins pass. Ready for RM.** L-1 is an optional follow-up.
- [ ] Issues found

---

## 15. Commit Info

*(RM populates.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-26 | Created | Dev workplan for slice 1a (server). Step 0 facts F-1 to F-19 from `origin/main` `a105fa4a`; design follows SA-RR-CPU (MRR precedent; CUR-3 unedited; pure BigInt converter; `takings.usd`; only AC-145 and wire types move); 12 open SA questions with defaults. No code written |
| 2026-10-26 | SA workplan review (SA-WP-CPU1A) | Approved with conditions W-1 to W-5. SA-Q-1A-1 the one `centsToWire` edge accepted, decimal strings rejected; Q-2 re-read through `toHundredths` accepted, with T-19 as the proof; Q-7 comment fix in 1a; Q-8 tab copy in 1b; Q-3 to Q-6 and Q-9 to Q-12 defaults accepted. Leak scan widened to typed `usd` access (W-2) |
| 2026-10-27 | Implemented | Slice 1a built per §2 and W-1 to W-5; AC-145 re-frozen (`333407…2215` → `aebc22cb…97ca`); implementation notes IN-1 to IN-6 (§12A), two unforeseen pin moves for SA ruling; uncommitted |
| 2026-10-27 | SA code review (SA-CR-CPU1A) | Code approved for QA. AC-145 `333407…2215` → `aebc22cb…97ca` (chain verified); no other pin moved. AC-48 and AC-66 accepted as ruled re-freezes that follow from SA-Q-4; log key `takingsUsd` accepted; CI Build accepted as the W-5 build proof (no secrets in the worktree); the `chargeChecksRequest.pin` failure under load to be re-run alone by QA |
