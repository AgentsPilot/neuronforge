# Workplan: Business OS Finance & Business Health — Slice 6b (margin after estimated Stripe fees, and KPI order)

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md). This workplan covers slice **6b**, which is §11K.1 to §11K.11:
- AC-243 to AC-256;
- checks 27 and 28 (§11K.9);
- L-142 to L-147;
- SA-Q81 to SA-Q91;
- BQ-15 (§0.4), the default rate;
- BD-35 (§0.2), the tile order.
**Branch:** `feature/bos-finance-health-6b` (worktree `neuronforge-finance-m8`, from main `e43dcb60`, M-8 merged #448). Confirmed with `git branch --show-current`.
**Status:** Code Complete (SA workplan review approved with conditions; awaiting SA code review)

**Decisions in force:**
- BD-7 (BQ-7's default: the AI margin; the Stripe fee is shown only as an estimate).
- BD-12 (no FX; per currency only; never a cross-currency sum).
- BD-14 / BD-20 (test and live money count together, with no label).
- BD-22 (AI margin is on revenue after tax, net of refunds and disputes).
- BD-29 / BD-31 (the strip sits above the filter bar; the tiles are clickable).
- BD-33 (fast track: SA, QA and TL approve, then RM commits, opens the PR and turns on auto-merge; no production migration here).
- BD-35 (tiles re-ordered K-5, K-1, K-3, K-2, K-4; order only).
- BQ-15 default (2.9% + USD 0.30 per successful charge, on the gross amount, USD only; refunds keep their fee; no dispute fee). It is open but does not block.

**Builds on:** the 6a builder (`accountEconomics.ts`, [6a workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_6A_MONEY_M3_WORKPLAN.md)), the F-5 tile mapping (§11G, [F-5 workplan](/docs/workplans/FINANCE_F5_KPI_TILES_WORKPLAN.md)), and M-4's vocabulary guard (§11F).

**Still in force:**
- SA-WR-4: builders are pure.
- SA-W22: input is structural.
- SA-W48 / SA-W64: an unreadable row is decided per row.
- SA-W54: no × 100.
- SA-W75: one integer scale and one division at the edge.
- SA-W82: the precedence of the word states.
- SA-Q45: money is read only through `readMoney` / `readPlanMoney`.
- SA-WR-7: scratch tsconfig with a canary.
- M3-FR-13: the client formats only.

## Overview

6b adds one figure, **"Margin after Stripe fees (estimate, USD)"**, beside the AI margin and never in its place. It is shown on the Accounts tab rows, on the Deleted accounts row, on the platform line and in the one-account summary, with a small fee line under it. It also re-orders the five KPI tiles.

No Stripe fee is recorded for plan or boost payments (LF-2, LF-3). So the fee is estimated per charge from a config entry held as data and passed into the pure 6a builder. There is no migration and no new read, repository method, SQL function or table, and nothing is written.

The tile re-order is a DOM order change in `FinanceKpiStrip.tsx` only. The payload is unchanged, so the AC-145 Overview baseline is unchanged.

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code (SA-W-6b-1 to SA-W-6b-11)](#questions-for-sa-before-code)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify](#files-to-create--modify)
- [6b.1 The fee estimate and its config](#6b1-the-fee-estimate-and-its-config)
- [6b.2 The builder](#6b2-the-builder)
- [6b.3 Payload](#6b3-payload)
- [6b.4 Wiring in financeHealth.ts](#6b4-wiring-in-financehealthts)
- [6b.5 The page](#6b5-the-page)
- [6b.6 KPI re-order](#6b6-kpi-re-order)
- [6b.7 AC-145 Overview baseline](#6b7-ac-145-overview-baseline)
- [6b.8 Failure matrix](#6b8-failure-matrix)
- [Entitlements registration check](#entitlements-registration-check)
- [Tenant isolation check](#tenant-isolation-check)
- [Guard table, line by line](#guard-table-line-by-line)
- [AC mapping](#ac-mapping)
- [Verification plan](#verification-plan)
- [Logging](#logging)
- [Landing order with 4b.2](#landing-order-with-4b2)
- [Risks](#risks)
- [Estimate](#estimate)
- [Task List](#task-list)
- [Checklist before SA code review](#checklist-before-sa-code-review)
- [Implementation Notes](#implementation-notes)
- [SA Workplan Review](#sa-workplan-review)
- [SA Code Review](#sa-code-review)
- [QA Report](#qa-report)
- [Change History](#change-history)

---

## Verification Log

I read the code at `e43dcb60` in the 6b worktree. Each fact below is one I checked myself.

| # | Fact | Where | Consequence |
|---|---|---|---|
| VL-1 | The margin is built in one file. `buildPaid`, `buildCost` and `buildMargin` are private, and `buildMargin` returns only the wire value: it does not return the integer margin units | `lib/business-os/finance/accountEconomics.ts` | The fee step needs those units. `buildMargin` is split into an internal core that returns the units and the wire value, and the wire value does not change (6b.2) |
| VL-2 | `readMoney` returns `{ total, tax, refunded, held, lost }` in minor units. `readPlanMoney` returns `{ code, amount, tax }`. Both return null for a currency whose minor units are not 100 | `boostRevenue.ts:164`, `planRevenue.ts:122` | The gross is `money.total` for a boost and `money.amount` for a plan, read through the readers. There is no raw column, so `RAW_MONEY_COLUMN` (guard `:1124`) still passes |
| VL-3 | The 6a guards pin these in `accountEconomics.ts`, on code with comments stripped:<ul><li>**exactly one** `* MINOR_TO_COST_UNITS`;</li><li>one `/ CURRENCY_SCALE` and one `/ COST_SCALE`;</li><li>the texts `Number.isSafeInteger(revenueUnits)` and `Number.isSafeInteger(marginUnits)`;</li><li>`'USD'` exactly once, as `MARGIN_CURRENCY`;</li><li>no `\brate\b`, `fx` or `exchange_rates` (case-insensitive);</li><li>exports exactly `AccountEconomicsInput`, `buildAccountEconomics`, `buildAccountMargin`;</li><li>zero DF-5 tokens</li></ul> | `finance.source.guard.test.ts:1081-1170` | FE-8 says "fee_minor × MINOR_TO_COST_UNITS". That would be a second multiply and would trip the pin. I subtract the fee in minor units and go through the one scale step (SA-W-6b-2). The config is looked up by `MARGIN_CURRENCY`, and no identifier is named `rate`. The formula lives outside this file, so the export pin stays at three (SA-W-6b-1) |
| VL-4 | `MODE_OR_STRIPE = /livemode\|test.?mode\|live.?mode\|stripe_/i` (**case-insensitive**) is applied to:<ul><li>`accountEconomics.ts`;</li><li>`AccountsTab.tsx`, `AccountEconomicsTable.tsx` and `FinanceTabs.tsx`;</li><li>the raw `financeCopy.ts` block after "The Accounts tab: account economics", comments included</li></ul> | guard `:1173-1185` | No identifier in those files can contain `STRIPE_`: `STRIPE_FEE_ESTIMATE` would trip it. The config constant is named only in `financeRules.ts` and `financeHealth.ts`, and the copy constants are `ECON_FEE…` / `ECON_AFTER_FEES…` (SA-W-6b-3) |
| VL-5 | `STRIPE_OR_LOT` (`:833`) and `PLAN_SECRET` (`:950`) are **case-sensitive** `stripe_`. They scan the whole of `financeCopy.ts`, the strip, the panel and the builders. The route test (`:951`) bans the text `stripe_` anywhere in the payload | guard; route test | Payload keys are camelCase (`marginAfterFees`, `feeEstimate`), so these do not trip |
| VL-6 | The vocabulary guard scans **visible texts only**: string literals, JSX text and labels. It does not scan identifiers, comments, test ids or literal types. "estimated" is forbidden in `financeCopy.ts`, which has a text floor of 439, and `AccountEconomicsTable.tsx` / `AccountsTab.tsx` are not in its list | `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts:37-77, 172, 233-245` | Every new string says "estimate" (FE-12). The floor only rises (7 or 8 new texts). No guard edit and no ALLOWED entry |
| VL-7 | **Pin B does not read order.** It finds each tile by `data-testid`, then checks `data-status`, `textContent.includes(...)` and a count of 5 (`:458-470`). It has no index, `compareDocumentPosition` or `children[i]` on tiles. Its header excludes "the line order" by design (`:18`). Its fixtures build no `accountEconomics` and no `accountMargin`, and both are optional on `FinancePayload` | `financeTiles.pin.render.test.tsx` | Pin B stays byte-identical and green after the re-order and after the new required fields (no type error from ts-jest). **No re-freeze** (SA-Q87) |
| VL-8 | Pin A names no Finance file. The shared `KpiStrip` / `KpiTile` are not touched | `KpiStrip.callers.pin.render.test.tsx` | Pin A stays byte-identical (SA-Q88) |
| VL-9 | No other test reads tile order. The page test asserts only `kpi-strip` before the sections (`financePage.render.test.tsx:537`, `:860`) and a count of 5 (`:1086`, `:1316`). `accountsTab.render.test.tsx` **mocks** `FinanceKpiStrip` (`:42`) | page and tab tests | The new order test goes in `financePage.render.test.tsx`, where the real strip renders on both tabs (SA-Q89) |
| VL-10 | The **AC-145 baseline** (`route.test.ts:1135-1250`) is an all-businesses request with no `tab`. It asserts that `accountEconomics` and `accountMargin` are absent and pins the payload SHA-256 (`6761620e…5250`, plus the 6a hash `b4d10bc1…588c`). `tiles` is an object keyed `k1` to `k5` on the wire, and the re-order does not touch it | route test, `FinanceKpiStrip.tsx:82` | **The baseline payload does not change** (6b.7). No E-55-style update |
| VL-11 | These are exact-shape assertions on 6a's picked-business and tab cases, outside the baseline:<ul><li>`route.test.ts:1357` (a tab row's `margin`) and `:1385` (`accountMargin` toEqual);</li><li>`financeHealth.test.ts:1981` (`accountMargin` toEqual `{ paid, aiCost, margin }` of the row)</li></ul> | route and orchestrator tests | These are ordinary tests, updated to include the new field (SA-W-6b-8) |
| VL-12 | `financeHealth.ts:919` injects `deps.metricParams ?? FINANCE_METRIC_PARAMS`, and rule errors are logged at `error` through `onRuleError` (`:1145`) | `financeHealth.ts` | The same injection is used for the fee config (`deps.feeEstimate ?? STRIPE_FEE_ESTIMATE`). An invalid config is logged once at `error`, naming no value |
| VL-13 | App guard: files under `app/admin/finance` import only **types** from `lib/business-os/finance` (`source.guard.test.ts:55`). `MONEY_6A_ARITHMETIC` bans adding or subtracting two 6a money fields (`:224-235`). `CLIENT_FOLD` bans `.sort(` / `.reduce(` / `.filter(` in the tab files | `app/admin/finance/__tests__/source.guard.test.ts` | The page cannot import the config, so the note's values come from the payload (FE-16). A sibling `MONEY_6B` rule covers the new fields |
| VL-14 | Pins checked at Step 0 (LF-normalised SHA-256). All seven equal the requirement:<ul><li>AC-173 `3a1a2dd4…f6f8`;</li><li>its helper `b84e0c96…aabf`;</li><li>Pin A `30f5fc24…2e01`;</li><li>Pin B `24ff0da7…df9f`;</li><li>Pin C `98ea0507…1e4b`;</li><li>its helper `02813360…5bd8`;</li><li>Pin D `1f7cf07a…f144`</li></ul> | `tr -d '\r' \| sha256sum` | Re-checked at handover |
| VL-15 | **Fee arithmetic, checked with Node** using `s = g·290 + 5000; (s − s mod 10000) / 10000 + 30`:<ul><li>7900 → **259**;</li><li>4414 → **158**;</li><li>1000 → **59**;</li><li>500 → **45** (an exact half rounds up);</li><li>499 → **44**</li></ul>The owner test account in October: 259 + 59 = **318**, so USD 3.18 | scratch run | AC-243 and the check 27 expectations are right |
| VL-16 | 4b.1 (PR #447, `feature/bos-finance-health-4b`) touches **no** finance code. It changes the requirement MD, the purge and export classifications, scripts and migrations. 4b.2 is not built | `git diff --stat e43dcb60...feature/bos-finance-health-4b` | The only 4b.1 overlap is the requirement MD, which the coordinator owns. The 4b.2 overlaps are listed under Landing order |

---

## Scope

| In | Out |
|---|---|
| Per-charge fee estimate (FE-1 to FE-7) with config as data (FE-4)<br>"Margin after Stripe fees (estimate, USD)" and its fee line on the Accounts rows, the Deleted row, the platform line and the one-account summary (FE-8 to FE-16)<br>One new always-on note, plus the 6a first note reworded (§11K.5)<br>Tile DOM order K-5, K-1, K-3, K-2, K-4 (§11K.6)<br>Guards, tests and checks 27 and 28 | Any change to the AI margin's value, rules, sort or filter (FE-15)<br>Real Stripe fees<br>Dispute and other surcharges<br>FX<br>Anything that needs 4b.1's table<br>BD-8 per-plan margin<br>K-7<br>Any tile value, status, label, link or test id<br>`KpiStrip` / `KpiTile`<br>Any repository, read, migration or write |

---

## Questions for SA before code

These are the places where the requirement does not quite fit the code. Each one has my suggestion, and I build on that suggestion unless SA rules otherwise.

| # | Question | Dev suggestion |
|---|---|---|
| **SA-W-6b-1** (SA-Q81) | Where do the config, its range check and the per-charge formula live? | **All in `financeRules.ts`**, beside `FINANCE_METRIC_PARAMS` and `FAR_OVER_ALLOWANCE_PERCENT_RANGE` (the BD-11 precedent), as four exports:<ul><li>`STRIPE_FEE_ESTIMATE`;</li><li>`STRIPE_FEE_ESTIMATE_RANGE`;</li><li>`stripeFeeEntryOf(config, currency)`;</li><li>`estimateChargeFeeMinor(grossMinor, entry)`.</li></ul>`accountEconomics.ts` imports only the two functions and a type. Its export pin stays at three names, and it holds no fee literal (the AC-244 guard). The formula is unit-tested directly in `financeRules.test.ts`. The alternative, a new `stripeFeeEstimate.ts`, adds a file for about 40 lines with no gain. Not a database setting (a new pattern, and a migration) |
| **SA-W-6b-2** | FE-8 writes `fee_minor × MINOR_TO_COST_UNITS`. A second textual `* MINOR_TO_COST_UNITS` breaks the 6a scale pin (VL-3) | Do not edit the pin. Add one private helper, `marginUnitsOf(revenueMinor, costUnits)`, which holds the **only** multiply and both `isSafeInteger` texts. It is called twice: with `usdMinor` for the AI margin, and with `usdMinor − feeMinor` for the margin after fees. Since (r − f)·k − c = (r·k − c) − f·k exactly in integers, the result equals FE-8. AC-246 proves it numerically |
| **SA-W-6b-3** | Naming under the `stripe_`/i ban (VL-4) | No `STRIPE_` / `stripe_` identifier in `accountEconomics.ts`, the three tab files or the 6a copy block:<ul><li>builder input `feeEstimate`;</li><li>type `FeeEstimateEntry`;</li><li>copy constants `ECON_AFTER_FEES`, `ECON_PLATFORM_AFTER_FEES`, `ECON_FEES`, `econFeesLine`, `econFeeNote`, `ACCOUNT_AFTER_FEES`.</li></ul>`STRIPE_FEE_ESTIMATE` (the FE-4 name) appears only in `financeRules.ts` and `financeHealth.ts`, which the /i rule does not scan. The visible copy still says "Stripe" |
| **SA-W-6b-4** | **A zero-total boost.** FE-1 counts every paid-family boost as a charge. A boost with `amount_total_minor` 0 would therefore get a fee of 30, while a zero plan invoice is not a charge (M2-W-5). Checks 27 and 28 match FE-1 (no `> 0` on boosts). None exists live (LF-3: 1 row, 1000) | **Treat a boost total of 0 as no charge**, for symmetry: no money moved, so there is no card fee. This needs BA to edit FE-1 and add `and b.amount_total_minor > 0` to checks 27 and 28. If SA prefers FE-1 as written, I build it as written: one branch, and a test for whichever rule SA picks |
| **SA-W-6b-5** | **Config without a USD entry, or invalid.** FE-9 says "a currency with no entry gives n/a, different currency". But the after-fees figure is only computed when the AI margin is a figure, and then every line is USD. So the only "no entry" case is a config missing `USD`, which is a config fault, not a currency | A missing or out-of-range `USD` entry gives **Unknown** on every after-fees cell (FE-4: "never a guessed fee"), and the section's `feeEstimate` is null. The note then reads, as **one new string**: "Stripe fees are an estimate: none are recorded for plan or boost payments. The assumed fee could not be read, so no margin after Stripe fees is shown." **"n/a, different currency"** still comes from the AI margin (any non-USD line), unchanged |
| **SA-W-6b-6** | Payload shape for the note's numbers (FE-16, no client arithmetic) | `accountEconomics.feeEstimate: { currency: 'USD'; percent: number; fixed: number } \| null`, with `percent = percentBps / 100` (2.9) and `fixed = fixedMinor / CURRENCY_SCALE` (0.3). Both are divided **on the server**, in `financeRules.ts` (`feeEstimateNoteOf`). The page prints `formatCount(percent)` and `formatMoney(fixed, currency)`, which give "2.9" and "USD 0.30", the §11K.5 shape. Only in `accountEconomics`: the summary has no note (§11K.5) |
| **SA-W-6b-7** | Two small display details §11K.5 leaves open | (a) **Platform pair:** when the margin after fees is not a figure, "Stripe fees, estimate" shows the **same word** (Not available / n/a, different currency / Unknown), never a blank and never 0. (b) **FE-10, no revenue:** the cell shows the figure, which equals the AI margin, then the fee line "Stripe fees, estimate: USD 0.00", then the existing "No revenue in this window" note |
| **SA-W-6b-8** (SA-Q85) | Does the payload change touch the AC-145 baseline? | **No** (VL-10). The baseline has neither key, and tiles are unchanged on the wire. The exact-shape 6a cases at `route.test.ts:1357, :1385` and `financeHealth.test.ts:1981` are ordinary tests, extended with `marginAfterFees` (and `feeEstimate` on the tab section). **Please confirm they are not frozen.** If SA reads them as part of the baseline, I make one ruled update, E-55 style, with the hash recorded |
| **SA-W-6b-9** | Logging an invalid config | One `logger.error({ read: 'fee_estimate' }, 'Finance Stripe fee estimate config is invalid')` in `financeHealth.ts`, with no value and no rate. The info line gains nothing (FE-17) |
| **SA-W-6b-10** (SA-Q87, SA-Q88, SA-Q89) | Pins and the order test | Pin A and Pin B are byte-identical (VL-7, VL-8). The order test is a new `describe` in `financePage.render.test.tsx`. Please confirm |
| **SA-W-6b-11** (SA-Q91) | Landing order with 4b.2 | See [Landing order](#landing-order-with-4b2). One rule for whoever lands second: **the fee stays on the charge list** (the paid-family purchases and plan payments read by `paid_at` in the window), never on a dated refund event. I add a builder test that pins this, so a 4b.2 rebase that moves the fee fails |

---

## Analysis Summary

| Area | Touch |
|---|---|
| Pure logic | `financeRules.ts` (config, range, validator, formula, note values)<br>`accountEconomics.ts` (charges per account, fee step, after-fees value on rows, Deleted row, platform line and `buildAccountMargin`) |
| Types | `financeTypes.ts`: `FinanceMarginAfterFeesValue`, the field on four shapes, `feeEstimate` on the section |
| Orchestrator | `financeHealth.ts`: passes the config (injectable), logs an invalid one |
| Route | **No change** (`route.ts` is untouched; the payload flows through) |
| UI | `AccountEconomicsTable.tsx` (column, cell), `AccountsTab.tsx` (platform pair, note), `AccountSummary.tsx` (line), `FinanceKpiStrip.tsx` (order), `financeCopy.ts` (strings) |
| DB | None. No new column is read: gross is `amount_total_minor` / `amount_minor`, already read by R-k / R-m and already passed through the readers |

## Implementation Approach

1. **Formula outside, application inside.** The arithmetic and the data sit together in `financeRules.ts`. The builder receives the config as an input field (`feeEstimate: unknown`), validates the USD entry once per build through `stripeFeeEntryOf`, and applies `estimateChargeFeeMinor` per charge. The builder imports no rate value (SA-WR-4).
2. **Charges are collected where money is already read.** `addBoost` / `addPlan` push the readable gross into `MoneyOf.charges` at the same point they count a revenue row. A zero invoice is skipped (M2-W-5), as is a zero boost if SA-W-6b-4 is accepted. An unreadable row is still counted for the AI margin, and the AI margin is then Unknown, so no fee is needed.
3. **After-fees follows the AI margin.** If the AI margin is not a figure, the after-fees value takes **its kind**, which gives the SA-W82 precedence for free. Only when it is a figure are the fees summed (safe-integer checked) and `marginUnitsOf(usdMinor − feeMinor, cost.units)` computed. Any null gives Unknown.
4. **The display reuses the 6a words.** `marginAfterFeesText` maps the same kinds to the same constants as `marginText` (`ECON_MARGIN_NOT_AVAILABLE`, `ECON_MARGIN_OTHER_CURRENCY`, `ECON_UNKNOWN`). Sorting and filtering are unchanged: `compareMargin` and `isNegative` still read `row.margin`.
5. **The re-order is JSX moved, not rewritten.** The five `<KpiTile>` blocks move as whole blocks inside `FinanceKpiStrip.tsx`. No prop is touched, and the header comment records BD-35.

---

## Files to Create / Modify

### Create

None. No new source file, and no new test file: the new cases go into the existing test files.

### Modify

| File | Change |
|---|---|
| `lib/business-os/finance/financeRules.ts` | `FeeEstimateEntry` type<br>`STRIPE_FEE_ESTIMATE = { USD: { percentBps: 290, fixedMinor: 30 } }`<br>`STRIPE_FEE_ESTIMATE_RANGE = { percentBps: { min: 0, max: 1000 }, fixedMinor: { min: 0, max: 1000 } }`<br>`stripeFeeEntryOf`, `estimateChargeFeeMinor`, `feeEstimateNoteOf`<br>Header paragraph |
| `lib/business-os/finance/financeTypes.ts` | `FinanceMarginAfterFeesValue`<br>`marginAfterFees` on `FinanceEconomicsRow`, `FinanceEconomicsDeletedRow`, `FinanceEconomicsPlatformLine` and `FinanceAccountMargin`<br>`feeEstimate` on `FinanceAccountEconomicsSection` |
| `lib/business-os/finance/accountEconomics.ts` | `feeEstimate` input on `AccountEconomicsInput` and on `buildAccountMargin`'s input<br>`MoneyOf.charges`<br>`marginUnitsOf` helper; the `buildMargin` core returns its units<br>`buildFees`, `buildMarginAfterFees`<br>The new field on every shape; `feeEstimate` on the section<br>Header paragraph |
| `lib/business-os/finance/financeHealth.ts` | `deps.feeEstimate?: unknown`<br>Pass `feeEstimate` to both builders<br>One error log when it is invalid |
| `app/admin/finance/financeCopy.ts` | 6a first note reworded<br>`ECON_AFTER_FEES`, `ECON_PLATFORM_AFTER_FEES`, `ECON_FEES`, `econFeesLine`, `econFeeNote`, `ECON_FEE_NOTE_UNREADABLE` (SA-W-6b-5)<br>`ACCOUNT_AFTER_FEES` |
| `app/admin/finance/components/AccountEconomicsTable.tsx` | New `<th>` after "AI margin (USD)"<br>Exported `marginAfterFeesText` and `MarginAfterFeesValue`<br>Cell on each row and on the Deleted row |
| `app/admin/finance/components/AccountsTab.tsx` | Platform pair under "AI margin"<br>Fee note `<li data-testid="econ-fee-note">` in the notes list |
| `app/admin/finance/components/AccountSummary.tsx` | Line `ACCOUNT_AFTER_FEES` under "AI margin (USD)"; `accountMargin === null` gives Unknown |
| `app/admin/finance/components/FinanceKpiStrip.tsx` | Tile blocks re-ordered K-5, K-1, K-3, K-2, K-4<br>Header comment |
| `lib/business-os/finance/__tests__/financeRules.test.ts` | AC-243, AC-244 formula and config cases |
| `lib/business-os/finance/__tests__/accountEconomics.test.ts` | AC-244 to AC-250, AC-252<br>The charge-list pin (SA-W-6b-11)<br>Fixtures gain `feeEstimate` |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | `:1981` extended<br>Config injection and the error-log case |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | New `describe('slice 6b …')`: no fee literal in `accountEconomics.ts` (with a planted control)<br>Formula and config only in `financeRules.ts`<br>Non-vacuity<br>**No existing 6a pin edited** |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | `:1357`, `:1385` extended<br>One AC-254 payload case (no `stripe_`, `livemode` or tier literal; the rate is not in the info line)<br>**AC-145 baseline untouched** |
| `app/admin/finance/__tests__/accountsTab.render.test.tsx` | Column, Deleted row, platform pair, notes, word states, labels<br>Fixtures gain the field |
| `app/admin/finance/__tests__/financeAccount.render.test.tsx` | Summary line equals the row (AC-250) |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | New `describe('6b tile order (BD-35, AC-253)')`<br>Fixture rows gain the field if they build `accountEconomics` |
| `app/admin/finance/__tests__/source.guard.test.ts` | `MONEY_6B = (afterFeesUsd\|feesUsd)` arithmetic rule with a planted control, over every file; `MONEY_6A` is not edited |

Not touched (and checked at handover):
- `route.ts` and `financeHealthDeps.ts` (the production deps leave `feeEstimate` unset, so the default applies);
- `boostRevenue.ts` and `planRevenue.ts` (their export pins are unchanged);
- `KpiStrip.tsx`, `lib/repositories/**`, `supabase/**` and `lib/business-os/billing/**`;
- the seven pin files.

---

## 6b.1 The fee estimate and its config

**File:** `lib/business-os/finance/financeRules.ts` (sketch; final names per SA-W-6b-1)

```typescript
export interface FeeEstimateEntry { percentBps: number; fixedMinor: number }

/** BQ-15 default: an ASSUMPTION, not a recorded fee. Data: change the numbers, no logic changes (FE-4). */
export const STRIPE_FEE_ESTIMATE: Readonly<Record<string, FeeEstimateEntry>> = {
  USD: { percentBps: 290, fixedMinor: 30 },
};
export const STRIPE_FEE_ESTIMATE_RANGE = { percentBps: { min: 0, max: 1000 }, fixedMinor: { min: 0, max: 1000 } } as const;

const BPS_PER_WHOLE = 10_000;
const HALF_BPS = BPS_PER_WHOLE / 2;

/** The valid entry for a currency, or null (missing, non-integer, out of range). */
export function stripeFeeEntryOf(config: unknown, currency: string): FeeEstimateEntry | null;

/** FE-2: round_half_up(gross × bps / 10000) + fixed, exact integers; null when not a safe integer. */
export function estimateChargeFeeMinor(grossMinor: number, entry: FeeEstimateEntry): number | null {
  if (!Number.isSafeInteger(grossMinor) || grossMinor < 0) return null;
  const scaled = grossMinor * entry.percentBps + HALF_BPS;
  if (!Number.isSafeInteger(scaled)) return null;
  const fee = (scaled - (scaled % BPS_PER_WHOLE)) / BPS_PER_WHOLE + entry.fixedMinor;
  return Number.isSafeInteger(fee) ? fee : null;
}

/** The note's display values, divided once on the server (FE-16). */
export function feeEstimateNoteOf(config: unknown, currency: string): { currency: string; percent: number; fixed: number } | null;
```

- **Exact integer division.** I use `(s − s mod 10000) / 10000`, not `Math.floor(s / 10000)`. Near the safe-integer limit, a float quotient that is a hair below an integer can round up to it. The modulo form is exact for every safe non-negative integer. It equals Postgres `bigint / bigint` (truncation) for the non-negative values in checks 27 and 28.
- **Gross includes tax** (FE-2, SA-Q82). Fees are rounded per charge, then summed (SA-Q83).
- **The range check** (FE-4) requires integers within 0 to 1000 for both fields. Anything else, a fraction, a negative, 1001, `NaN` or a missing key, gives null, and the builder turns that into Unknown.

## 6b.2 The builder

**File:** `lib/business-os/finance/accountEconomics.ts`

1. **Input.** `AccountEconomicsInput.feeEstimate: unknown`, and the same field on `buildAccountMargin`'s input (the `MarginReads` pick is extended).
2. **Charges.**
   - `MoneyOf` gains `charges: number[]`, the readable gross of each counted charge.
   - In `addBoost`, after `readMoney` succeeds, push `money.total`. Per SA-W-6b-4, only when `money.total > 0`.
   - In `addPlan`, after the zero-invoice return, push `money.amount`.
   - FE-5 and FE-6: a refunded, partly refunded, disputed or lost boost is in the paid family, so its gross `total` is pushed **whatever its refunds**. No status is named, so DF-5 stays at zero tokens.
   - `all` (the platform line) receives the same pushes.
3. **`marginUnitsOf(revenueMinor, costUnits)`** holds the single `revenueMinor * MINOR_TO_COST_UNITS` and both `isSafeInteger` checks, and returns `number | null`. The `buildMargin` core returns `{ wire, revenueMinor }` so the fee step can reuse the same revenue. The wire value is byte-identical to 6a for every fixture: the existing tests are left unedited and run.
4. **`buildFees(money, entry)`** sums `estimateChargeFeeMinor` over `money.charges`. It returns `number | null`, where null means an unsafe charge, an unsafe sum or a null entry.
5. **`buildMarginAfterFees(margin, revenueMinor, fees, cost)`:**
   - If `margin.kind !== 'figure'`, return `{ kind: margin.kind }`. That is Not available, then n/a different currency, then Unknown, exactly as SA-W82 orders them.
   - If `fees === null`, return Unknown.
   - Otherwise compute `units = marginUnitsOf(revenueMinor − fees, cost.units)`. If that is null, return Unknown.
   - Else return `{ kind: 'figure', afterFeesUsd: usdOfUnits(units), feesUsd: moneyOfMinor(fees), currency: MARGIN_CURRENCY, noRevenue: margin.noRevenue }`.
   - The one `/ COST_SCALE` and the one `/ CURRENCY_SCALE` are reused through the existing helpers.
6. **Shapes.** Each row, the Deleted row, the platform line (over `all`, before any filter or cap, FE-13) and `buildAccountMargin` (FE-14) gain `marginAfterFees`. The section gains `feeEstimate` from `feeEstimateNoteOf(input.feeEstimate, MARGIN_CURRENCY)`. `feeEstimateNoteOf` is imported from `financeRules`, which gives two imported functions, not counted as exports.
7. **Unchanged.** Sort, filter, the `negative` show option and status (M3-FR-10) all stay as they are. An invalid config does **not** make the section `partial`. The AI-margin figures are complete, the after-fees cells say Unknown, and the note says why.

## 6b.3 Payload

**File:** `lib/business-os/finance/financeTypes.ts`

```typescript
export type FinanceMarginAfterFeesValue =
  | { kind: 'figure'; afterFeesUsd: number; feesUsd: number; currency: string; noRevenue: boolean }
  | { kind: 'not_available' }
  | { kind: 'other_currency' }
  | { kind: 'unknown' };
// marginAfterFees: FinanceMarginAfterFeesValue   on Row, DeletedRow, PlatformLine, AccountMargin
// feeEstimate: { currency: string; percent: number; fixed: number } | null   on FinanceAccountEconomicsSection
```

The payload has no Stripe id, tier literal or `livemode` (FE-17). Its keys are camelCase, so the route test's `stripe_` text ban (VL-5) holds.

## 6b.4 Wiring in `financeHealth.ts`

- `FinanceHealthDeps.feeEstimate?: unknown`, documented as "injected in tests; production uses `STRIPE_FEE_ESTIMATE`" (the `metricParams` precedent).
- `const feeEstimate = deps.feeEstimate ?? STRIPE_FEE_ESTIMATE;` is passed in `economicsReads`, so both builders get it. When `stripeFeeEntryOf(feeEstimate, 'USD')` is null, the code logs once at `error` (SA-W-6b-9). A `'USD'` literal in `financeHealth.ts` is not pinned. Even so, I take the currency from a `FEE_ESTIMATE_CURRENCY` export of `financeRules` to keep the literal in one place.
- No new read, no new `Promise.all` member, and no change to the counts or the info line.

## 6b.5 The page

All strings come from `financeCopy.ts`, in the Accounts-tab block. They say "estimate" and never "estimated", "actual", "real" or "recorded" beside a fee (AC-251).

| Constant | Text |
|---|---|
| `ECON_NOTES[0]` (reworded) | "Paid us is after tax, net of refunds and disputes. The AI margin does not deduct Stripe fees." |
| `ECON_AFTER_FEES` / `ACCOUNT_AFTER_FEES` | "Margin after Stripe fees (estimate, USD)" |
| `ECON_PLATFORM_AFTER_FEES` | "Margin after Stripe fees (estimate)" |
| `ECON_FEES` | "Stripe fees, estimate" |
| `econFeesLine(amount)` | "Stripe fees, estimate: {amount}" |
| `econFeeNote(percent, fixed)` | "Stripe fees are an estimate: none are recorded for plan or boost payments. Assumed {percent}% + {fixed} per card charge. A refunded charge keeps its fee. Dispute fees are not included." Here `fixed` is `formatMoney(fixed, currency)`, which gives "USD 0.30" |
| `ECON_FEE_NOTE_UNREADABLE` (SA-W-6b-5) | "Stripe fees are an estimate: none are recorded for plan or boost payments. The assumed fee could not be read, so no margin after Stripe fees is shown." |

- **Table.** A new `<th scope="col" className={ADMIN_TH_NUM}>` follows the "AI margin (USD)" column. `<MarginAfterFeesValue value testId={`econ-after-fees-${id}`} />` renders `marginAfterFeesText` (`formatUsd`, sign kept, or the word). On a figure it adds `<span className={NOTE} data-testid={`${testId}-fees`}>{econFeesLine(formatMoney(value.feesUsd, value.currency))}</span>`, plus `ECON_NO_REVENUE` when `noRevenue`. The Deleted row gets the same cell, as `econ-after-fees-deleted`.
- **Platform line.** Two more `<dt>` / `<dd>` pairs follow "AI margin": `econ-platform-after-fees` and `econ-platform-fees` (SA-W-6b-7 (a)).
- **Summary.** A `<Line label={ACCOUNT_AFTER_FEES} testId="account-summary-after-fees">` sits directly under the margin line.
- **Notes.** `econ-fee-note` is always shown on the Accounts tab: `econFeeNote(…)` when `feeEstimate` is set, otherwise `ECON_FEE_NOTE_UNREADABLE`.
- **Arithmetic.** None. The new fields are only formatted, and no `.sort(`, `.reduce(` or `.filter(` is added.
- **Currency.** The figure variant carries `currency`, which is always `MARGIN_CURRENCY`. The fee line is `formatMoney(value.feesUsd, value.currency)`, so the page writes no currency literal. In the builder, `MARGIN_CURRENCY` stays the one `'USD'` literal: the pin counts literals, not uses.

## 6b.6 KPI re-order

- **Change.** In `FinanceKpiStrip.tsx` the JSX blocks are re-ordered K-5, K-1, K-3, K-2, K-4. Each block moves whole: test id, label, value, sub, status, detail, link or target. `FinanceKpiPlaceholders` stays at `placeholderCount={5}`. `KpiStrip` / `KpiTile` are untouched. Keyboard order follows the DOM.
- **Pin B: no order dependency, verified (VL-7).** It stays byte-identical and green, so no re-freeze is needed. Pin A is untouched (VL-8).
- **Order test (SA-Q89).** A new `describe` in `financePage.render.test.tsx` collects `[data-testid^="tile-k"][data-status]` in document order and expects `['tile-k5_our_revenue', 'tile-k1_ai_cost', 'tile-k3_founding_no_end_date', 'tile-k2_far_over_allowance', 'tile-k4_gifted_outstanding']`. It runs on four views:
  - (a) Overview, all businesses;
  - (b) Overview, a business picked;
  - (c) `tab=accounts`;
  - (d) `tab=accounts` with a business picked.

  A loading case counts five placeholders before the first response resolves. Each case also asserts that `kpi-strip` precedes the filter bar (BD-29). There are no value assertions here, because Pin B owns values.

## 6b.7 AC-145 Overview baseline

**The payload does not change** (VL-10):
- the baseline request has no `tab` and no business, so neither `accountEconomics` nor `accountMargin` is built;
- `tiles` is unchanged, because the re-order is client-only;
- no other section is touched.

`EXPECTED_SHA256` and `SLICE_6A_SHA256` therefore stay as they are, and the test file region `:1120-1250` is **not edited**. **No E-55-style update is needed.** If the baseline unexpectedly fails, that is a defect in 6b and not a reason to re-hash. I stop and raise it to SA. The exact-shape picked-business cases outside the baseline are extended (SA-W-6b-8).

## 6b.8 Failure matrix

| Situation | AI margin (unchanged) | Margin after fees | Fee line / platform "Stripe fees, estimate" |
|---|---|---|---|
| All USD, readable, exact, after cut-over | Figure | Figure = AI − fees | "Stripe fees, estimate: USD X" |
| No charge in the window (FE-10) | Figure + "No revenue" | Same figure | USD 0.00, plus "No revenue" |
| Window before the cut-over | Not available | Not available | not shown / "Not available…" |
| Any non-USD line (e.g. an ILS boost) | n/a, different currency | n/a, different currency | not shown / same word |
| Read failed, ceiling, unreadable row, inexact boost, Unknown currency | Unknown | Unknown | not shown / Unknown |
| Config invalid, or no USD entry | Figure | **Unknown** | not shown / Unknown; the note is `ECON_FEE_NOTE_UNREADABLE` |
| Fee or sum not a safe integer, or `marginUnitsOf` overflow | Figure | Unknown | not shown / Unknown |

---

## Entitlements registration check

No file in this diff imports from `lib/business-os/entitlements/`, and none writes a capability id or tier literal. `financeHealth.ts` already imports `planGroups` (registered in 1a), and that import is unchanged. I still run `npm run test:bos-entitlements`, as the skill requires, and record the result.

## Tenant isolation check

There is no write, no service-role path and no new id input. The picked `accountId` path is unchanged: `buildAccountMargin` filters on `row.user_id === input.accountId` over the R-k′ / R-m′ reads, which already carry exactly that id (AC-42). The fee step only consumes rows that are already scoped.

## Guard table, line by line

| Guard | Expected | Action |
|---|---|---|
| 6a scale pin (one `* MINOR_TO_COST_UNITS`, one `/ CURRENCY_SCALE`, one `/ COST_SCALE`, `isSafeInteger(revenueUnits)` / `(marginUnits)`) | Passes, not edited | `marginUnitsOf` holds the one multiply (SA-W-6b-2) |
| `'USD'` exactly once in `accountEconomics.ts` | Passes | Lookups use `MARGIN_CURRENCY` |
| `\brate\b`, `fx`, `exchange_rates` ban | Passes | No `rate` identifier |
| 6a export pin (3 names) | Passes | The formula lives in `financeRules.ts` |
| DF-5 zero tokens | Passes | No status or refunded amount is named |
| Readers-only (`RAW_MONEY_COLUMN`) | Passes | Gross comes from `money.total` / `money.amount` |
| Purity (no repository, Supabase, entitlements or clock) | Passes | No new import |
| `MODE_OR_STRIPE`/i on the builder, the tab files and the 6a copy block | Passes | Naming per SA-W-6b-3 |
| `STRIPE_OR_LOT`, `PLAN_SECRET` (case-sensitive), route `stripe_` payload ban | Pass | camelCase keys |
| Boost and plan export pins | Unchanged | Not touched |
| **New 6b rule:** no `\b290\b`, `\b30\b`, `0.029` or `0.3` in `accountEconomics.ts` code; the `STRIPE_FEE_ESTIMATE` definition only in `financeRules.ts`; `accountEconomics.ts` imports `estimateChargeFeeMinor` and `stripeFeeEntryOf` from `./financeRules` | New, with a planted control (a pasted `* 290`) | Add to `finance.source.guard.test.ts` |
| App: types-only imports from `lib/business-os/finance` | Passes | Values come from the payload |
| App: `CLIENT_FOLD`, `MONEY_6A_ARITHMETIC` | Pass | — |
| **New app rule `MONEY_6B`** (`afterFeesUsd`, `feesUsd`) | New, with a planted control | Add to `source.guard.test.ts` |
| App: dim-text, no `console.` | Pass | — |
| Vocabulary guard (forbids "estimated"; floor 439) | Passes, no edit | Count rises |
| `layoutFolder.guard` (C-14), contrast LF-1 | Pass | No shared-folder file added |
| `financeUrl.test.ts`, `FINANCE_URL_KEYS`, AC-173 pin | Unchanged | No URL or request change |
| Repository caller lists, `serviceColumn.guard`, webhook placement, `tierLiteral.forbidden`, `test:bos-entitlements`, `test:authz-guard` | Not tripped | Run |
| Seven frozen pins | Byte-identical | Hash at Step 0 (done, VL-14) and at handover |

## AC mapping

| AC | Proven by |
|---|---|
| AC-243 | `financeRules.test.ts`:<ul><li>7900 → 259, 4414 → 158, 1000 → 59;</li><li>500 → 45 (half up), 499 → 44;</li><li>a safe-limit gross gives null.</li></ul>`accountEconomics.test.ts`: the per-charge sum (two charges of 1000 = 118, not round(2000 × 0.029) + 30), and a zero invoice adds no charge |
| AC-244 | `financeRules.test.ts`: 350 / 25 changes the fee; 1001, 2.5 and −1 give a null entry; a missing `USD` gives null.<br>`accountEconomics.test.ts`: an injected 350 / 25 changes every row and the platform line; an invalid config makes every after-fees value Unknown and `feeEstimate` null.<br>Source guard: no fee literal, with a planted control |
| AC-245 | `accountEconomics.test.ts`: a plan above 0 and each paid-family status are one charge each; a zero invoice, a refused plan row (kind ≠ `invoice_paid`) and a boost outside the family (`pending`, `failed`) are not; `refunded`, `partially_refunded`, `disputed` and `dispute_lost` keep their fee on the gross total (fees asserted, not the margin, where the AI margin is Unknown for an inexact taxed partial refund) |
| AC-246 | `accountEconomics.test.ts`: after-fees = AI margin − fees / 100 for each figure row. The 6a AI-margin assertions are unedited and green. QA: check 19 against check 27 |
| AC-247 | `accountEconomics.test.ts` (kinds) and `accountsTab.render.test.tsx` (words):<ul><li>before the cut-over → Not available;</li><li>ILS alone, and ILS beside USD → "n/a, different currency", no fee line;</li><li>a ceiling, a failed read, an unreadable row or an inexact refund → Unknown, never 0</li></ul> |
| AC-248 | `accountEconomics.test.ts` and render: cost only gives fees 0, after-fees = AI margin, and the "No revenue" note |
| AC-249 | `accountEconomics.test.ts`: the platform line covers every account and the Deleted row, and is identical under each `group` / `show` / `sort` / cap. Render: the pair. QA: check 20 against check 28 |
| AC-250 | `financeHealth.test.ts:1981` extended (`accountMargin.marginAfterFees` equals the row's).<br>`financeAccount.render.test.tsx`: the summary line equals the row text.<br>Fixture: plan 7900 + boost 1000 gives the fee line "USD 3.18" |
| AC-251 | `accountsTab.render.test.tsx` and `financeAccount.render.test.tsx`: exact §11K.5 texts; the note's numbers come from the payload (a fixture with 3.5 / 0.25 shows "3.5% + USD 0.25"); no "actual", "real" or "recorded" in the new texts; K-5 and Our revenue still contain "Stripe fees not deducted" |
| AC-252 | `accountEconomics.test.ts`: for one fixture, row order and membership under every sort and show option equal a snapshot taken from the 6a builder logic (the existing 6a sort tests are unedited and green), and none reads `marginAfterFees` |
| AC-253 | New order `describe` in `financePage.render.test.tsx` (6b.6); Pin B unedited and green |
| AC-254 | App `MONEY_6B` rule; route test: the info line has no amount or rate key, and the payload has no `stripe_`, `livemode` or tier literal; AC-145 baseline unedited and green |
| AC-255 | V-1 to V-11 below; the seven hashes; `git diff --stat` shows no `supabase/` or `lib/repositories/` path |
| AC-256 | QA manual steps L-142 to L-147 (below), recorded in the QA Report |

## Verification plan

The worktree has the `node_modules` junction. Never run `git stash`, `git worktree remove` or `npm install` through it. I run each command alone and read its own exit code, never through a pipe.

| # | Command | Evidence |
|---|---|---|
| V-1 | `npx jest app/admin/finance lib/business-os/finance app/api/admin/business-os/finance --ci` | Suites and tests passed |
| V-2 | `npx jest app/admin/components --ci` (layout, `KpiStrip`, Pin A, layout folder, contrast) | Pass |
| V-3 | `npx jest app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` | Pass, with no edit to the file (`git diff --exit-code` on it) |
| V-4 | `npm run test:authz-guard` | Exit 0 |
| V-5 | `npm run test:bos-entitlements` | Exit 0 |
| V-6 | `npm run lint:hooks` | Exit 0 |
| V-7 | `npx eslint <every touched file>` | Clean |
| V-8 | **Scoped `tsc` with a canary (SA-WR-7):**<ol><li>A scratch tsconfig **outside the worktree** (`…\scratchpad\tsconfig.6b.json`): an absolute `extends`, `noEmit`, `incremental: false`, and `include` = `types/**/*.d.ts`, `next-env.d.ts` and every touched `.ts` / `.tsx` file, tests included.</li><li>Plant `const __canary: number = 'x';` in `accountEconomics.ts`.</li><li>Run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p <scratch>`. It must report TS2322.</li><li>Remove the canary (`grep -c __canary` = 0) and re-run clean.</li><li>Attribute any pre-existing diagnostic by path.</li></ol> | Both runs recorded |
| V-9 | The seven pin hashes (`tr -d '\r' < f \| sha256sum`) | All equal VL-14 |
| V-10 | `git diff --stat` and `git diff --numstat`, read **before** the diff (the truncation lesson). Expect no file that loses lines without gaining any; no `supabase/`, `lib/repositories/` or `lib/business-os/billing/` path; no requirement MD from Dev | Pasted |
| V-11 | `git diff --exit-code` on `route.ts`, `boostRevenue.ts`, `planRevenue.ts`, `KpiStrip.tsx` and the seven pin files | Exit 0 |
| V-12 | **Checks 27 and 28, for the user and QA** (read-only, Supabase SQL editor). In both, replace `null` in the `p` block with `'2026-10-01 00:00:00+00'`. Compare with Accounts, This month in October | Table below |

**V-12 expectations (live facts §11K.1, rate 290 / 30):**

| Check | Column | Expected | Page |
|---|---|---|---|
| 27 | owner account `usd_charges` / `other_currency_charges` | 2 / 0 (plan 7900 and boost 1000), plus any other October charge | — |
| 27 | owner `usd_fee_minor` | **318** = plan (7900·290 + 5000) div 10000 = **229**, + 30 = **259**; boost (1000·290 + 5000) div 10000 = **29**, + 30 = **59** | Fee line "Stripe fees, estimate: **USD 3.18**" |
| 27 + 19 | owner after-fees | check 19 `ai_margin_usd` − 3.18 | "Margin after Stripe fees (estimate, USD)" |
| 27 | other accounts with AI cost only | `usd_fee_minor` 0 (absent from check 27) | Fees USD 0.00, after-fees = AI margin, "No revenue" |
| 27 | the 4414 invoice (account and month not checked, LF-2) | 158 in its own month and account | Fee USD 1.58 there |
| 28 | `usd_fee_minor` / `other_currency_charges` | 318 (plus any other October charge) / 0 | Platform "Stripe fees, estimate" USD 3.18 |
| 28 + 20 | platform after-fees | check 20 margin − `usd_fee_minor` / 100 | Platform "Margin after Stripe fees (estimate)" |

**Known difference:** checks 27 and 28 compute a fee for a non-USD account's USD charges and for an inexact taxed partial refund. The page shows "n/a, different currency" or Unknown there, because the after-fees value follows the AI margin. Neither case exists live. A zero-total boost is the other difference: none exists live (SA-W-6b-4).

**Manual QA steps (proposal; QA's list governs).**

| # | Step | Expected |
|---|---|---|
| L-142 | `/admin/finance`, This month | Tiles left to right: Our revenue, Charged AI cost this month, Founding Partners with no end date, Accounts far over allowance, Gifted credits outstanding. Values are as before. Each click still goes where it did |
| L-143 | Accounts tab | The same tile order. The new column sits after "AI margin (USD)". The owner row shows its AI margin and, beside it, the margin after fees with "Stripe fees, estimate: USD 3.18". The fee note reads "Assumed 2.9% + USD 0.30 per card charge…" |
| L-144 | The platform line | "Margin after Stripe fees (estimate)" and "Stripe fees, estimate" match checks 20 and 28. Changing sort, show or group leaves it unchanged |
| L-145 | Open the owner row | The summary shows the same two lines as the row |
| L-146 | Custom from 2026-09-15 | Both margin cells, row and platform, read "Not available: AI cost is charged only from 29 Sep 2026" |
| L-147 | Dev-server log for both tabs | The info line gained no amount, rate or currency total. No error line about the fee config |

## Logging

- **No `console.*` added.** I open the touched files and count any existing `console.*` calls. If I find any, I flag them per CLAUDE.md § Logging; I expect none, because the finance guards forbid `console.`.
- **One new `logger.error`** for an invalid config (SA-W-6b-9). It names no value.
- **The info line is unchanged.**

## Landing order with 4b.2

4b.1 (PR #447) touches no finance code (VL-16). Its only overlap is the requirement MD, which is not edited by Dev. **4b.2** (§11I on the 4b branch: FR-4B-11, the Accounts tab on the BD-17 refund rule; the DF-5 re-pin) is expected to edit the same places as 6b. If 6b lands first, 4b.2 rebases onto it:

| File | Expected conflict | Resolution rule |
|---|---|---|
| `accountEconomics.ts` (`MoneyOf`, `addBoost`, `boostAfterTax`, `buildMargin`) | High. 4b.2 feeds dated refunds into the boost line; 6b adds `charges` and `marginUnitsOf` | The fee stays on the **charge list** (purchases paid in the window, gross `total`). A refund event never adds, removes or re-dates a fee (FE-5, FE-7). The 6b test "a refund event in a later month changes no fee" is the tripwire. It is written now against a purchase-row refund and extended by 4b.2 |
| `finance.source.guard.test.ts` (the 6a `describe`, DF-5 re-pin) | Medium. 4b.2 re-pins DF-5; 6b adds a separate 6b `describe` and edits no 6a line | Keep both. The 6b `describe` sits at the end of the file to minimise hunks |
| `AccountsTab.tsx` notes list | Medium. FR-4B-6 replaces the S4-W-3 refund note (`econ-refund-note`); 6b adds `econ-fee-note` and rewords `ECON_NOTES[0]` | Different lines; keep both |
| `financeCopy.ts` ECON block | Low to medium | Additive constants |
| `accountEconomics.test.ts`, `accountsTab.render.test.tsx`, `financeTypes.ts` | Medium (shared fixtures) | Additive fields; 4b.2 fixtures gain `marginAfterFees` |
| `route.test.ts` AC-145 region | 4b.2 may rule a baseline update (SA-Q72); 6b does not touch it | No 6b conflict there |
| `boostRevenue.ts` | 4b.2 edits it; **6b does not** | None |

If 4b.2 lands first, I rebase 6b by the same rule. `addBoost` keeps pushing the purchase's gross, whatever 4b.2 does to the refund amounts.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The `marginUnitsOf` refactor changes an AI-margin value | Low | The 6a builder tests are unedited and must stay green, as must the AC-145 hash |
| A new type field breaks ts-jest compilation of a test I cannot edit (a pin) | Low (VL-7: no pin builds these shapes) | V-8 includes the pins; V-1 runs them |
| Naming trips a case-insensitive `stripe_` scan | Medium if careless | SA-W-6b-3 naming; V-1 |
| Fee rounding differs from the SQL near the limits | Very low | Exact modulo form; tests at the half and near the safe limit |
| A conflict with 4b.2 moves the fee to the refund month | Medium | The rule above and the tripwire test |
| The rate is wrong for our account (BQ-15) | Business | The note says it is an assumption; changing it is a one-line data edit |

## Estimate

**About 1.75 days** (§11K.11):
- config, formula and builder, with unit tests: 0.5 d;
- types and wiring: 0.25 d;
- page column, platform pair, summary and note: 0.5 d;
- re-order and its test: 0.25 d;
- guards, hashes, tsc, checks 27 and 28, and the handover: 0.25 d.

## Task List

- [x] ✅ Step 0: branch confirmed (`feature/bos-finance-health-6b`); the seven pins hashed (VL-14). The V-1 baseline on the untouched tree was **not** run separately; the first run after the builder change gave 5 failures, all the exact-shape cases SA listed (see Implementation Notes)
- [x] ✅ Step 1: `financeRules.ts` config, range, validator, formula and note values, with `financeRules.test.ts` (AC-243, AC-244)
- [x] ✅ Step 2: `financeTypes.ts` new types and fields
- [x] ✅ Step 3: `accountEconomics.ts` charges, `marginUnitsOf`, `buildFees`, `buildMargins` (AI margin and margin after fees together), all four shapes and `feeEstimate`
- [x] ✅ Step 4: `accountEconomics.test.ts` (AC-243 to AC-250, AC-252, 6B-R3, the charge-list tripwire), with fixtures updated
- [x] ✅ Step 5: `financeHealth.ts` injection and error log; `financeHealth.test.ts`
- [x] ✅ Step 6: route tests `:1357` / `:1385` extended; AC-145 untouched and green
- [x] ✅ Step 7: `financeCopy.ts` strings, with the vocabulary guard run
- [x] ✅ Step 8: `AccountEconomicsTable.tsx`, `AccountsTab.tsx` and `AccountSummary.tsx`, with render tests (AC-247 to AC-251, 6B-R2)
- [x] ✅ Step 9: `FinanceKpiStrip.tsx` re-order and the order `describe` (AC-253)
- [x] ✅ Step 10: the new source-guard rules (finance 6b `describe`, app `MONEY_6B`), with planted controls
- [x] ✅ Step 11: verification; Implementation Notes; status → Code Complete

## Checklist before SA code review

- [x] ✅ Every SA-W-6b ruling applied, or each deviation recorded with a reason (D-1 to D-6 below)
- [x] ✅ The seven pins are byte-identical; the AC-145 region (`route.test.ts:1120-1250`) and `route.ts` are unchanged
- [x] ✅ No existing 6a guard line is edited; the new rules have planted controls
- [x] ✅ The vocabulary guard file is unchanged and green
- [x] ✅ No `console.*` and no `any` added; imports are `@/` or the existing relative siblings
- [x] ✅ `git diff --numstat` read before the diff: no deletion-only file
- [x] ✅ Verification pasted with each command's own exit code
- [x] ✅ Nothing committed (RM commits under BD-33)

## Implementation Notes

**Built 2026-10-17 in `neuronforge-finance-m8`, branch `feature/bos-finance-health-6b`, uncommitted.** The requirement MD was not edited by Dev.

### Files

| File | Change |
|---|---|
| `lib/business-os/finance/financeRules.ts` | `FeeEstimateEntry`, `FEE_ESTIMATE_CURRENCY`, `STRIPE_FEE_ESTIMATE` (USD 290 / 30), `STRIPE_FEE_ESTIMATE_RANGE`, `stripeFeeEntryOf`, `estimateChargeFeeMinor` (exact modulo division), `feeEstimateNoteOf` |
| `lib/business-os/finance/financeTypes.ts` | `FinanceMarginAfterFeesValue`, `FinanceFeeEstimate`; `marginAfterFees` on the row, Deleted row, platform line and `FinanceAccountMargin`; `feeEstimate` on the section |
| `lib/business-os/finance/accountEconomics.ts` | `feeEstimate` input; `MoneyOf.charges`; `marginUnitsOf` (the one multiply), `buildFees`, `buildMargins`; the field on all four shapes; `feeEstimate` on the section. Exports still three |
| `lib/business-os/finance/financeHealth.ts` | `deps.feeEstimate ?? STRIPE_FEE_ESTIMATE`, passed to both builders; one error line when invalid |
| `app/admin/finance/financeCopy.ts` | `ECON_NOTES[0]` reworded; `ECON_AFTER_FEES`, `ECON_PLATFORM_AFTER_FEES`, `ECON_FEES`, `econFeesLine`, `econFeeNote`, `ECON_FEE_NOTE_UNREADABLE`, `ACCOUNT_AFTER_FEES` |
| `app/admin/finance/components/AccountEconomicsTable.tsx` | Column after "AI margin (USD)"; `marginAfterFeesText`, `feesText`, `MarginAfterFeesValue`; cell on each row and the Deleted row |
| `app/admin/finance/components/AccountsTab.tsx` | Platform pair; `econ-fee-note` |
| `app/admin/finance/components/AccountSummary.tsx` | Line under "AI margin (USD)" |
| `app/admin/finance/components/FinanceKpiStrip.tsx` | Tile blocks moved whole to K-5, K-1, K-3, K-2, K-4 |
| Tests | `financeRules.test.ts`, `accountEconomics.test.ts`, `financeHealth.test.ts`, `finance.source.guard.test.ts`, `route.test.ts`, `accountsTab.render.test.tsx`, `financeAccount.render.test.tsx`, `financePage.render.test.tsx`, `app/admin/finance/__tests__/source.guard.test.ts` |

Untouched, checked with `git diff --exit-code` (exit 0): `route.ts`, `boostRevenue.ts`, `planRevenue.ts`, `financeHealthDeps.ts`, `KpiStrip.tsx`, `lib/repositories`, `supabase`, `lib/business-os/billing`.

### SA conditions

- **6B-R1 (E-74):** `marginUnitsOf(revenueMinor, costUnits)` holds the only `* MINOR_TO_COST_UNITS` and both `isSafeInteger` texts. The AI margin calls it with `usdMinor`; the margin after fees with `usdMinor − fees`. The 6a scale pin passes unedited, and every 6a builder assertion on the AI margin is unchanged and green.
- **6B-R2:** `accountsTab.render.test.tsx` asserts the whole note at the default, "…Assumed 2.9% + USD 0.30 per card charge…", and "Assumed 3.5% + USD 0.25 per card charge." with a 3.5 / 0.25 payload. `formatCount(2.9)` prints "2.9" (no rounding).
- **6B-R3 (E-72):** builder test: a paid boost with total 0 is no charge; fees 0; margin after fees = AI margin (−1.2345), on the row and on the platform line.
- **6b-11:** builder test "the fee stays on the charge": the same purchase paid, then refunded, carries fee 59 both times while its AI margin moves.
- **318¢:** `financeRules.test.ts` asserts 259 + 59 = 318 directly; `accountEconomics.test.ts` asserts the owner fixture (plan 7900 + boost 1000) gives `feesUsd` 3.18, margin after fees 84.5855 beside an unchanged AI margin 87.7655; `buildAccountMargin` gives the same.

### Deviations from the workplan (none changes a ruling)

| # | Deviation | Reason |
|---|---|---|
| D-1 | `financeRules.ts` exports seven names, not four: the four SA counted, plus `FeeEstimateEntry` (type), `FEE_ESTIMATE_CURRENCY` and `feeEstimateNoteOf` | All were in the workplan's file table and 6b.4; `FEE_ESTIMATE_CURRENCY` keeps the `'USD'` literal in one place for `financeHealth.ts`. No guard pins `financeRules.ts` exports |
| D-2 | `buildMarginAfterFees` is folded into `buildMargins`, which returns both values from one precedence pass | One precedence for both values, by construction (FE-9); no second copy of SA-W82 to drift |
| D-3 | The invalid-config error line is logged only when a margin is built (a business picked or the Accounts tab) | No margin is built on Overview with no business, so an error there would be noise; and the AC-145 request stays log-identical |
| D-4 | The platform "Margin after Stripe fees (estimate)" cell prints the value only; the fee sits in its own "Stripe fees, estimate" cell | The pair already shows the fee; a fee line under the first cell would print it twice |
| D-5 | The order test covers three views (Overview, a business picked, the Accounts tab), not four | The route refuses the Accounts tab with a business picked (SA-W84, 400), so that view does not exist |
| D-6 | The route test gained no separate AC-254 case; the existing 6a payload walk was extended instead | That walk already bans `stripe_`, `livemode` and the tier literal over the whole tab payload. It now also requires `afterFeesUsd` and `feesUsd` to sit beside a `currency`. The info line is unchanged (no new field) |

### Verification (each command run alone; exit code read from the tool)

| # | Command | Exit | Result |
|---|---|---|---|
| V-1a | `npx jest app/admin/finance --ci` | 0 | 19 suites, **613 passed**. One `act()` warning from `FinanceView` (`useFinanceData.ts:92`), from the 6a tab cases; none of the new 6b cases renders `FinanceView` with a pending update |
| V-1b | `npx jest lib/business-os/finance --ci` | 0 | 16 suites, **1652 passed** |
| V-1c | `npx jest app/api/admin/business-os/finance --ci` | 0 | 1 suite, **90 passed** (the AC-145 baseline included, unedited) |
| V-2 | `npx jest app/admin/components --ci` | 0 | 25 suites, **818 passed** (Pin A, `KpiStrip`, layout folder, contrast) |
| V-3 | `npx jest app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` | 0 | **182 passed**; `git diff --exit-code` on the file: 0 |
| V-4 | `npm run test:authz-guard` | 0 | 2 suites, **203 passed** |
| V-5 | `npm run test:bos-entitlements` | 0 | 280 suites, **8583 passed** |
| V-6 | `npm run lint:hooks` | 0 | Clean (`--max-warnings 0`) |
| V-7 | `npx eslint` on the 18 touched `.ts` / `.tsx` files | 0 | Clean |
| V-8 | Scoped `tsc`: a scratch `tsconfig.6b.json` outside the worktree, with the 18 touched files, the seven pin files, `types/**/*.d.ts` and `next-env.d.ts` | canary: 2; clean: 0 | Canary: exactly **1** error, `accountEconomics.ts(585,7): error TS2322`. After removing it (`grep -c __canary` = 0): **0 errors** |
| V-9 | Pin hashes (`tr -d '\r' < f \| sha256sum`) | — | Table below; all equal |
| V-10 | `git diff --stat` and `--numstat` | — | 18 code and test files plus the requirement MD (the coordinator's edit, not Dev's); no deletion-only file; no `supabase/`, `lib/repositories/` or `lib/business-os/billing/` path |

A side note on Jest: ts-jest did not report the missing `feeEstimate` and `marginAfterFees` in old fixtures (they surfaced only as runtime failures). V-8 is the type evidence.

**Pin hashes at handover (LF-normalised SHA-256):**

| Pin | Hash | Equal |
|---|---|---|
| AC-173 `financeRequest.pin.render.test.tsx` | `3a1a2dd415b3d0e0ffe44488a8c410b8e67a0bedf2ca908bbf064b6708bcf6f8` | ✅ |
| AC-173 helper `financeRequestPins.ts` | `b84e0c961e60c994414af7b418dd7f9dc94273e45695d632956427fade68aabf` | ✅ |
| Pin A `KpiStrip.callers.pin.render.test.tsx` | `30f5fc24f4e46870033ecdc984efa1c0647f633256f73ccfb302fa9899e62e01` | ✅ |
| Pin B `financeTiles.pin.render.test.tsx` | `24ff0da7efb824ccc2b5d90687e34b3cd9da33803658dccf19c0d096ae56df9f` | ✅ |
| Pin C `chargeChecksRequest.pin.render.test.tsx` | `98ea05072007b028604e782e43a3cbbc3c0098d360a11a76491be88afc111e4b` | ✅ |
| Pin C helper `chargeChecksRequestPins.ts` | `028133609122976f034c71bc841dde4b95c170a592862500bc6381ad2e545bd8` | ✅ |
| Pin D `m5WordingOnly.pin.test.ts` | `1f7cf07af1ea07975badca277c903a5568793cd4e88ff49f83ff9cdff34af144` | ✅ |

### The first failing run (before the fixtures were extended)

5 failures in `lib/business-os/finance` plus `app/api/admin/business-os/finance`: `accountEconomics.test.ts` (the Deleted-row and AC-142 exact shapes), `route.test.ts:1357` and `:1385`, and `financeHealth.test.ts:1981`. All five were the new field appearing in an exact-shape assertion; no value changed. In `app/admin/finance`, 22 render cases failed until the fixtures gained `marginAfterFees` and `feeEstimate`.

### `console.*` and logging

No touched file has a `console.*` call (grep, exit 1 = none found). One new `logger.error({ read: 'fee_estimate' }, …)` naming no value.

### Owed to the user / QA

Checks 27 and 28 (with E-72's `amount_total_minor > 0`), in October: the owner `usd_fee_minor` should be **318** (plan 259 + boost 59). Then L-142 to L-147.

---

## SA Workplan Review

**Reviewed by SA — 2026-10-17, against `e43dcb60`. This is also the SA requirement review of §11K (SA-RR-6b).**
**Status:** ✅ **APPROVED WITH CONDITIONS** (6B-R1 to 6B-R3, all Low). Full cycle under BD-33. SA applied E-72 to E-74 to §11K.

**Checked against the code**
- **The fee formula.** `(g·290 + 5000)` with the exact modulo division gives 7900 → 259, 4414 → 158, 1000 → 59, 500 → 45 and 499 → 44 (SA re-derived these). Integer arithmetic throughout, per charge then summed, gross including tax. It equals Postgres truncating `bigint` division for the non-negative values in checks 27 and 28.
- **6b-2 is exact, with no double scaling.** Revenue and fee are both USD cents. `(r − f)·k − c = (r·k − c) − f·k` holds exactly in integers. One shared `marginUnitsOf` keeps the single `* MINOR_TO_COST_UNITS` and both `isSafeInteger` texts of the 6a pin. `r − f` may be negative, which is fine (sign kept). The AI margin's wire value is byte-identical.
- **No change for existing figures.** Tiles, the AI margin, sort, filter and status are untouched; the new fields sit beside them.
- **Pin B does not depend on order.** It sorts the tile ids before comparing (`[...ids].sort()`, `:453`) and indexes fixtures, not the DOM. Pin A names no Finance file. **All seven pins stay byte-identical.** No re-freeze.
- **6b-8.** `route.test.ts:1357`, `:1385` and `financeHealth.test.ts:1981` are **ordinary tests, not frozen pins**. The seven pins are the only frozen files, and the AC-145 baseline region `:1120-1250` is not touched. Extend those three tests freely.
- **Vocabulary.** Every new string says "estimate" (FE-12). The guard and its floor of 439 pass with no edit.
- **Checks 27 and 28.** SA scanned them: ASCII only, no apostrophe in a comment, no "into", one result set each. They now carry `and b.amount_total_minor > 0` (E-72).
- **The AC mapping is complete** (AC-243 to AC-256). **The estimate of about 1.75 days is accepted.**

**Rulings: requirement questions**

| # | Ruling |
|---|---|
| SA-Q81 | `financeRules.ts`, a code data constant injected through deps. |
| SA-Q82 | The fee is on the **gross** amount, tax included. |
| SA-Q83 | Round **per charge**, then sum. |
| SA-Q84 | Sort and filter stay on the AI margin. |
| SA-Q85 | Fields as proposed. The AC-145 baseline does not change (VL-10). |
| SA-Q86 | "Estimate" wording, with no ALLOWED entry. |
| SA-Q87 | Pin B stays unedited. |
| SA-Q88 | Pin A stays unedited. |
| SA-Q89 | The order test is a new case in `financePage.render.test.tsx`. |
| SA-Q90 | One PR, full cycle, BD-33. |
| SA-Q91 | 6b-11's rule. |

**Rulings: workplan questions**

| # | Ruling |
|---|---|
| **6b-1** | **Approved.** Four exports in `financeRules.ts`. `accountEconomics.ts` keeps three exports and no fee literal. |
| **6b-2** | **Approved** (exact, above). The 6a pin is not edited. |
| **6b-3** | **Approved.** No `STRIPE_`/`stripe_` identifier in the `/i`-scanned files. `STRIPE_FEE_ESTIMATE` is named only in `financeRules.ts` and `financeHealth.ts`; the visible copy still says "Stripe". |
| **6b-4** | **Approved: a boost total of 0 is no charge** (E-72 applied to FE-1, AC-245 and both checks). |
| **6b-5** | **Approved:** a missing or invalid config gives Unknown on every margin-after-fees cell, a null `feeEstimate` and the unreadable note. The AI margin is unaffected and the section is not `partial` (E-73 applied to FE-9). |
| **6b-6** | **Approved.** `percent` and `fixed` are divided on the server. See 6B-R2. |
| **6b-7** | **Approved** (a) and (b). |
| **6b-8** | **Confirmed not frozen** (above). |
| **6b-9** | **Approved:** one `error` log line with no value. |
| **6b-10** | **Approved.** |
| **6b-11** | **Approved:** the fee stays on the charge list, read by `paid_at`. Pin it with the planned builder test, so a 4b.2 rebase that moves the fee fails. Whoever lands second rebases. |

**Required changes (SA verifies at code review)**
1. **6B-R1 (Low). The FE-8 text (E-74, applied)** now matches the minor-unit subtraction. The workplan's 6b.2 step 5 is the implementation.
2. **6B-R2 (Low). A render test** proves the note reads exactly "Assumed 2.9% + USD 0.30 per card charge" at the default rate, and "3.5% + USD 0.25" with a 350 / 25 config. `formatCount` uses `toLocaleString`, so a decimal percent must be shown not to round.
3. **6B-R3 (Low). A builder test for a zero-total paid-family boost** (6b-4): no charge, fee 0, and the margin after fees equals the AI margin.

**Requirement edits (SA applied)**
- **E-72 (FE-1, AC-245, checks 27 and 28).** A paid-family boost with total 0 is not a charge, and both checks gain `and b.amount_total_minor > 0`.
- **E-73 (FE-9).** A missing or out-of-range USD entry is a config fault: Unknown on every margin-after-fees cell, plus the unreadable-note sentence.
- **E-74 (FE-8).** The fee is subtracted in minor units before the one scale step; the exact equivalence is stated.

## SA Code Review

**Code Review by SA — 2026-10-17** (uncommitted on `feature/bos-finance-health-6b`)
**Status:** ✅ **Code Approved.** No conditions.

**Verified in code**
- **E-74 and the AI margin.** `marginUnitsOf(revenueMinor, cost.units)` is the old code moved into one helper: the same single `* MINOR_TO_COST_UNITS` and both `isSafeInteger` checks. The AI margin is that call, unchanged. The after-fees figure is `marginUnitsOf(revenueMinor − fees, cost.units)`, equal to `(r·k − c) − f·k` exactly. Word states share SA-W82's order, and the existing 6a margin tests pass unedited.
- **E-72.** `addBoost` pushes `money.total` only when it is above 0; `addPlan` pushes after the zero-invoice return. Test 6B-R3 (`:691`) covers it.
- **E-73.** `stripeFeeEntryOf` refuses a missing entry, a non-integer or a value out of range, which gives Unknown and a null `feeEstimate`. Render tests cover the unreadable note and the Unknown cells.
- **6B-R2.** The note reads exactly "Assumed 2.9% + USD 0.30 per card charge", and "3.5% + USD 0.25" with a 350 / 25 config.
- **6b-11.** The fee stays on the charge (`:712`).
- **Fee maths.** 7900 → 259, 1000 → 59, total 318 (`:667`). Per-charge rounding is tested (`:676`). Both use exact modulo division.
- **Tile order.** `FinanceKpiStrip` moves whole, identical blocks into the order K-5, K-1, K-3, K-2, K-4. A new order `describe` is in `financePage.render.test.tsx` (`:2193`).
- **Exact-shape tests.** The three cases are ordinary tests and were extended, not frozen.
- **Vocabulary.** "estimate" wording only, and the vocabulary guard passes.
- **No change to existing figures** (tiles, AI margin, sort, filter).

**All seven pins** are byte-identical, LF-normalised, and clean against `HEAD`: `3a1a2dd4`, `b84e0c96`, `30f5fc24`, `24ff0da7`, `98ea0507`, `02813360` and `1f7cf07a`.

**Deviations**

| # | Ruling |
|---|---|
| D-1 | ✅ **Approved.** Seven exports in `financeRules.ts`: the type, the currency constant, the config, the range and three functions. Each has one use, and `accountEconomics.ts` keeps its three exports. |
| D-2 | ✅ **Approved.** One `buildMargins` builds both figures, so they share the precedence by construction. The AI margin value is unchanged. |
| D-3 | ✅ **Approved.** The invalid-config log fires only when a margin is built (the tab or a picked business), so the Overview is not noisy. |
| D-4 | ✅ **Approved.** The platform pair already shows "Stripe fees, estimate", so a repeated fee line would duplicate it. |
| D-5 | ✅ **Approved.** The order test covers three views. The fourth, the Accounts tab with a business picked, is refused by the route (SA-W84) and cannot render. |
| D-6 | ✅ **Approved.** AC-254 is folded into the existing payload check (no Stripe id or `livemode`, no amount in the info line). |

**SA re-run** (one suite at a time, all exit 0)

| Suite | Suites | Tests |
|---|---|---|
| `app/admin/finance` | 19 | 613 |
| `lib/business-os/finance` | 16 | 1652 |
| Finance route plus vocabulary guard | 2 | 272 |
| `test:authz-guard` | 2 | 203 |

**Code Approved for QA: Yes**

## QA Report

**QA — 2026-10-17**
**Test mode:** full
**Strategy used:** A + B:
- Jest builder, render, route and guard suites, run one at a time.
- An independent QA probe against the real builders: a temporary untracked `zz_qa6b_probe.test.ts` that reuses the fixture helpers verbatim. It ran 11/11 and was deleted (`git status` back to 20 entries).
- A sorted-line diff of the strip, a scoped tsc with a canary, and an editor-safety scan of checks 27 and 28.

The browser look and checks 27 and 28 on production are the user's (L-142 to L-147).
**Focus:** all (money, ui, schema)
**Skipped:** the live browser look and the live checks 27 and 28 (user, below).
**Input source:** prompt + workplan

**Verdict: PASS. No bugs.**

### Suite runs (each alone, worktree `neuronforge-finance-m8`, branch `feature/bos-finance-health-6b`, uncommitted)

| Suite | Result |
|---|---|
| `app/admin/finance` | 19/19, 613/613 |
| `lib/business-os/finance` | 16/16, 1652/1652 |
| `app/api/admin/business-os/finance` (incl. the AC-145 baseline) | 1/1, 90/90 |
| `app/admin/components` | 25/25, 818/818 |
| Vocabulary guard `aiCostVocabulary.source.guard` | 1/1, 182/182; file unedited (`git diff --exit-code` 0) |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 280/280, 8583/8583 |
| `npm run lint:hooks` | exit 0 |

These match Dev's counts.

**Pins (LF-normalised):** AC-173 `3a1a2dd4…f6f8` ✅, helper `b84e0c96…aabf` ✅, A `30f5fc24…2e01` ✅, B `24ff0da7…df9f` ✅, C `98ea0507…1e4b` ✅, C helper `02813360…5bd8` ✅, D `1f7cf07a…f144` ✅. `git diff --quiet HEAD` is clean on these, on `route.ts`, `boostRevenue.ts`, `planRevenue.ts`, `financeHealthDeps.ts`, `lib/admin/health`, `lib/repositories`, `supabase` and `lib/business-os/billing`.

**Scoped tsc:**
- Config in the scratchpad covering 21 files: the touched TS/TSX plus Pin B and AC-173.
- A canary in `accountEconomics.ts` gave `(585,7) TS2322`.
- The file was restored with `cp` and checked with `cmp` (identical; numstat back to 86/19).
- The clean run gives **exit 0, 0 errors**.

### Edge cases (QA probe, the real builders)

| Case | Result |
|---|---|
| Fee values | 7900→259, 4414→158, 1000→59, 500→45, 499→44 ✅; 0→30 (the formula; a zero charge is skipped before it); −1 and `MAX_SAFE_INTEGER` → null |
| Owner October | plan 7900 + boost 1000 → `feesUsd` 3.18. AI margin − margin after fees = 3.18 exactly. The platform line shows 3.18. `feeEstimate` `{USD, 2.9, 0.3}`. `buildAccountMargin` equals the row |
| Two 1000 charges | 1.18, not 0.88 (per charge, then summed) |
| Zero-total boost | not a charge: fees 2.59, the plan only (E-72) |
| Refund or dispute keeps its fee | `refunded` 1000, `partially_refunded` 500, `disputed` and `dispute_lost`: each a figure with `feesUsd` 0.59 while the AI margin moves (−1.2345 / 3.7655). A `pending` boost has no fee |
| Non-USD | an ILS boost gives `other_currency` on both the AI margin and after fees; no figure |
| Bad or missing config | `undefined`, `null`, `{}`, ILS only, `percentBps` 1001, a missing `fixedMinor`: Unknown on the row and the platform line, with `feeEstimate` null. 1000/1000 is accepted (the range edge) |
| AI margin unchanged | identical under 350/25, under every invalid config and under a string config |
| Sort unchanged | row order for `ai_cost`, `margin` and `paid` is identical under the default and under 1000/1000 |
| No revenue | fees 0, after fees = AI margin, `noRevenue` true |
| Before the cut-over | after fees takes the AI margin's kind |

**Tile order and clicks.**
- The sorted-line diff of `FinanceKpiStrip.tsx` against HEAD shows **only added comment lines**, so every tile block moved whole.
- The DOM order is k5, k1, k3, k2, k4 (`:89-126`). The order `describe` (`financePage.render.test.tsx:2193`) is green on Overview, a picked business and Accounts. Accounts with a business picked is refused by the route (D-5).
- The page test file only gains lines (+47, 0 removed), so the existing ctrl-click and jump tests (`AC-180` `:2067`, and the K-1 links) run unedited and pass after the re-order.
- The AC-145 baseline is untouched and green.

**Logs.** One new `logger.error({ read: 'fee_estimate' }, …)` names no value. The info line is unchanged. There is no `console.*` in any touched source file.

**Checks 27 and 28** (§11K.9): ASCII, 0 "into", 0 apostrophes in comments, one `;` each, no `SET`. Both carry `amount_total_minor > 0` (E-72). The default month is the current UTC month, so in October no edit is needed.

### Test Coverage

| AC | Verdict | Evidence |
|---|---|---|
| AC-243 | PASS | `financeRules.test.ts`; QA fee values |
| AC-244 | PASS | 350/25 test; QA invalid-config matrix; source guard: no fee literal |
| AC-245 | PASS | builder tests; QA zero boost, refund and dispute, pending |
| AC-246 | PASS (code), live owed | QA: AI − after = fees exactly; check 19 − check 27 is L-145 |
| AC-247 | PASS | render + builder; QA ILS / before cut-over / Unknown |
| AC-248 | PASS | QA no-revenue probe; render |
| AC-249 | PASS (code), live owed | builder platform tests; QA platform 3.18; check 20 − check 28 is L-146 |
| AC-250 | PASS (code), live owed | `financeAccount.render`; QA `buildAccountMargin` = row |
| AC-251 | PASS | §11K.5 texts in `financeCopy.ts`; the 6B-R2 render; vocabulary guard unedited |
| AC-252 | PASS | 6a sort tests unedited; QA sort under two configs |
| AC-253 | PASS | order `describe`; pure-move diff; Pin B unedited |
| AC-254 | PASS | `MONEY_6B` guard; route payload walk; AC-145 baseline green |
| AC-255 | PASS | all suites; 7 pins; protected paths clean |
| AC-256 | NOT-TESTED (user) | L-142 to L-147 below |

### Issues Found
- **Bugs:** none.
- **Performance:** none.
- **Edge cases:** none new. Two differences are documented, not defects:
  - **(a)** checks 27 and 28 compute a fee where the page shows n/a or Unknown (a non-USD account, an inexact refund); neither case exists live.
  - **(b)** the pre-existing `act()` warning in `FinanceView` (`useFinanceData.ts:92`) comes from 6a.

### Manual live steps (user, after deploy; read-only)

- **L-142 Finance, This month.**
  - The tiles read left to right: Our revenue, Charged AI cost this month, Founding Partners with no end date, Accounts far over allowance, Gifted credits outstanding.
  - Values and colours are as before.
  - Click each tile and ctrl-click one: each goes where it went before (K-1 opens AI calls & usage; the others jump to their sections).
- **L-143 Accounts tab.**
  - The same tile order.
  - A new column "Margin after Stripe fees (estimate, USD)" follows "AI margin (USD)".
  - The fee note reads "… Assumed 2.9% + USD 0.30 per card charge. A refunded charge keeps its fee. Dispute fees are not included."
- **L-144 Owner test account row, October.**
  - Paid us is USD 89.00 (plan 79.00 + boost 10.00, after tax).
  - The fee line reads "Stripe fees, estimate: USD 3.18".
  - Margin after fees = 89.00 − its AI cost − 3.18, which is the AI margin minus 3.18.
  - Open the row: the summary shows the same two figures.
- **L-145 Check 27** (Supabase SQL editor, new tab, paste as is): the owner row has `usd_charges` 2, `other_currency_charges` 0 and `usd_fee_minor` **318**. Check 19's `ai_margin_usd` − 3.18 equals the row's margin after fees.
- **L-146 Platform line and check 28.**
  - "Stripe fees, estimate" equals check 28's `usd_fee_minor` / 100 (318 if no other October charge).
  - "Margin after Stripe fees (estimate)" equals check 20's margin minus that.
  - Changing sort, Show or group leaves both unchanged.
- **L-147 Before the cut-over and the logs.**
  - Custom window from 2026-09-15: both margin cells, row and platform, read "Not available: AI cost is charged only from 29 Sep 2026".
  - The dev-server log for both tabs shows no amount or rate, and no fee-config error.

### Final Status
- [x] All acceptance criteria pass in code. AC-256, and the live halves of AC-246, AC-249 and AC-250, are the user's L-142 to L-147. No bugs. **Ready for TL / RM (BD-33).**
- [ ] Issues found

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Workplan written | Dev, from §11K at `e43dcb60`. Seven pins hashed and equal. Fee arithmetic checked (259 / 158 / 59 / 45 / 44; owner October 318). SA-W-6b-1 to SA-W-6b-11 raised |
