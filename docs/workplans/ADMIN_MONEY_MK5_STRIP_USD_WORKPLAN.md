# Workplan: Money MK-5, the Finance strip re-cut, with MK-5a ($) folded in

> **Last Updated**: 2026-10-19

**Developer:** Dev
**Requirement:** [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) §12 MK-5 and MK-5a rows; §3.1 (strip F-K1 to F-K5), §3.3 (LL-1 to LL-5), §3.4 (USD-1 to USD-6), §5 and §5.1 (definitions, Q-11 denominator), §13 FC-1 to FC-3, §14 (FC-2 sentence); SA-RR-MK SA-9 and the pins table (MK-5: Pin B, Pin A, AC-145, one re-freeze each); FIN BD-11, BD-35, BD-46, BD-47, BD-48
**Branch:** `feature/admin-money-mk5-strip-usd` (from main `c60e2f93`; MK-0, MK-1 and MK-4 merged)
**Date:** 2026-10-19
**Status:** Code Complete (uncommitted)
**Path:** full cycle (tile rules, payload change, three ruled re-freezes). No migration and no new read.

## Overview

The Finance strip becomes the five approved tiles, in BD-35's order of revenue, cost, then users:

| # | Tile | Indicator | Opens |
|---|---|---|---|
| F-K1 | Revenue received ($, window) | Lagging | Overview → Revenue |
| F-K2 | MRR now ($) | Leading | Revenue → Recurring now |
| F-K3 | Charged AI cost ($, this month vs the same days last month) | Lagging | Overview → AI cost summary |
| F-K4 | AI margin ($, window) | Lagging | Accounts tab |
| F-K5 | Paying accounts (%) | Lagging | Plans & subscriptions tab |

K-2, K-3 and K-4 leave the strip for their blocks, with the same rules. K-2's chip has been on Credits since MK-1. K-3's BD-11 rule becomes a chip on Plan mix. K-4 is the gifted figure already on Credits.

MK-5a: every money figure on Finance shows as `$1,234.56`. A tile shows the US-dollar line only, with a "plus n … in other currencies, not converted" note. Nothing is ever added across currencies. The "Converted this month" figure is **MK-5b**: a slot is left in F-K5 and not built.

---

## 1. Code facts (at `c60e2f93`)

| # | Fact | Where |
|---|---|---|
| CF-1 | The strip is `FinanceKpiStrip`: K-5, K-1, K-3, K-2, K-4 (6b order) from `payload.tiles` | `app/admin/finance/components/FinanceKpiStrip.tsx` |
| CF-2 | Money is printed by `formatMoney(amount, currency)` ("USD 12.50") and `formatUsd(value)` ("USD 0.0012"). Both are Finance-only: no file outside `app/admin/finance` imports them | `financeFormat.ts`; grep |
| CF-3 | Revenue per currency is `revenue.totals` (boost net plus plans received). The counts per currency are in `revenue.plans` / `revenue.boosts` lines | `financeTypes.ts:414` |
| CF-4 | The platform AI margin (`FinanceEconomicsPlatformLine`) is built only on the Accounts tab. The picked business's margin is `accountMargin`. Both come from the same `buildMargins` over the same reads (R-a, R-k, R-n, R-m), which the Overview also reads | `accountEconomics.ts:493-612`, `financeHealth.ts:1047-1120` |
| CF-5 | The paying set is `payingSetOf(R-c)`, current mode since R4 (BD-37). The plan walk gives every plan row | `financeHealth.ts:540`, `:768` |
| CF-6 | `KpiTile.indicator` and `KpiIndicator` exist (MK-0); `BlockKpi` exists (MK-1) | `KpiStrip.tsx`, `BlockKpi.tsx` |
| CF-7 | Pin B (`financeTiles.pin.render.test.tsx`) pins the five old tiles by test id and text. Pin A pins every existing `KpiTile` shape | pins |
| CF-8 | MK-3's `formatUsdSign` is not on main, so it is built here (SA-9) | grep |

## 2. Design

### 2.1 Payload (AC-145, one ruled re-freeze)

The builder adds two optional keys. Both come from reads it already makes, so there is **no new read**.

- **`paying`** (F-K5, §5.1):
  - all businesses: `{ scope: 'all', status, paying, accounts }`. The numerator is the plan rows whose account is in the current-mode paying set (the single `isPayingBillingRow` definition). The **denominator is every plan row** (all six groups, Q-11: trial, Founding Partner and comped are counted).
  - status: `ok`; `partial` when the plan walk is capped ("at least"); `unknown` when the paying read failed. Never 0%.
  - one business picked: `{ scope: 'one', status, paying: boolean | null }`.
- **`platformMargin`** (F-K4, all businesses): `buildPlatformMargin(reads)`, the SAME function the Accounts tab's platform line now calls, so the two are equal by construction. With a business picked, F-K4 reads the existing `accountMargin`.

### 2.2 Money ($, USD-1 to USD-6, SA-9)

- **`formatMoney(amount, currency)`:** a US-dollar line prints `$1,234.56` (`-$12.50`). Any other code keeps its own code ("ILS 230.30"). That is the breakdown rule of USD-3: each other currency keeps its own line, never converted.
- **`formatUsd(value)`:** `$0.0012` (2 to 4 decimals, as before).
- **New `formatUsdSign(line, opts?)`:** accepts **one USD line** `{ currency, amount }` and returns `$…`, or **null for any other code** (SA-9). The tiles print only through it. `groupByCurrency` is untouched.
- **USD-3 / USD-5 note:** `"plus n payments in other currencies, not converted"` (F-K1) and `"plus n subscriptions in other currencies, not converted"` (F-K2). These are counts, never amounts, and never part of the value.
- **The copy guard (USD-6)** is new, in `app/admin/finance/__tests__/usdCopy.source.guard.test.ts`. No `app/admin/finance` source (comments stripped) holds a money literal of the form `USD <digit>`, `` `USD ${` `` or `'USD '`. A rendered Overview with every section filled shows no `USD <digit>`. Planted controls cover both rules.

  Scope and exemptions (SA-9): the drawer's own-currency client payments are in `app/admin/users` (outside the scan). SQL check files are outside the scan. Labels such as "(estimate, USD)" are not money strings.

### 2.3 The strip

- Five `KpiTile`s, each with `indicator` from one definition constant per KPI (LL-4).
- **F-K4** carries the FC-2 sentence: "A partial gross margin: only AI cost is deducted so far. Stripe fees are an estimate beside it."
- **F-K2** is labelled "Stripe test mode" in test only, from the one allowed constant (C-4, MK-4).
- **Colour (BD-11):** F-K1 keeps K-5's status (the K-6 dispute red); F-K3 keeps K-1's status (amber at 1.5×, red at 2×). F-K2, F-K4 and F-K5 have no colour rule.
- **Targets:**
  - F-K1 `#revenue`;
  - F-K2 `#revenue-mrr`, a new id on the Recurring now part;
  - F-K3 `#ai-cost`;
  - F-K4 the Accounts tab (filter mode: a real link plus one write);
  - F-K5 the Plans & subscriptions tab;
  - with a business picked there are no tabs, so F-K4 and F-K5 have no target.
- **F-K5** has a reserved `slot` for MK-5b (no element is rendered now).

### 2.4 K-3 into its block

`AccountsByPlanSection` gains the K-3 chip: "{n} Founding Partners with no end date". Its tone follows `tiles.k3.status` (amber → `warn`, red → `danger`), shown when the rule fires, so it is the same rule. K-2 has been on Credits since MK-1. K-4's gifted figure is already the Credits summary's.

## 3. Files

| File | Change |
|---|---|
| `lib/business-os/finance/financeTypes.ts` | `FinancePaying`; `FinancePayload.paying?`, `platformMargin?` |
| `lib/business-os/finance/accountEconomics.ts` | `buildPlatformMargin` (exported); the platform line calls it |
| `lib/business-os/finance/financeHealth.ts` | `paying` and `platformMargin` in the payload |
| `app/admin/finance/financeFormat.ts` | `$` for USD; `formatUsdSign` |
| `app/admin/finance/financeCopy.ts` | `FINANCE_KPIS` (labels, definitions, subs, notes) |
| `app/admin/finance/components/FinanceKpiStrip.tsx` | The re-cut |
| `app/admin/finance/components/FinanceView.tsx` | The tab targets for F-K4 / F-K5 |
| `app/admin/finance/components/RecurringNowPart.tsx` | `id="revenue-mrr"` |
| `app/admin/finance/components/AccountsByPlanSection.tsx` | The K-3 chip |
| Tests | §5 |

## 4. Ruled pins

| Pin | Change | Before → after |
|---|---|---|
| **Pin B** `financeTiles.pin.render.test.tsx` | Rewritten for F-K1 to F-K5 (`$`, the indicator, the order) | file hash recorded in the notes |
| **Pin A** `KpiStrip.callers.pin.render.test.tsx` | New cases for the Finance indicator tiles; the existing hashes unchanged | file hash recorded in the notes |
| **AC-145** `route.test.ts` | Keys gain `paying`, `platformMargin`; new hash; stripping them gives MK-4's `30275c29…0631` | recorded in the notes |
| AC-173 file, helper and Parts A to C; Pins C, D | **unchanged**; stop if any moves | — |

## 5. Tests

| # | Test |
|---|---|
| T-1 | The tile order is F-K1, F-K2, F-K3, F-K4, F-K5; exactly five tiles |
| T-2 | Each icon has its leading or lagging accessible name and the definition from its constant (F-K2 leading; the rest lagging); F-K4's tooltip has the FC-2 sentence |
| T-3 | `$` rendering on every tile; `-$` for a negative margin |
| T-4 | Other currencies: F-K1 and F-K2 show the US-dollar line plus the note (a count, never an amount) |
| T-5 | `formatUsdSign` refuses ILS, null and an unknown code (null); accepts USD in any case |
| T-6 | The USD copy guard: source and render, with planted controls |
| T-7 | Paying %: "18%" with "9 of 50 accounts"; the denominator counts trial, Founding Partner and comped; `partial` gives "at least"; `unknown` gives Unknown, never 0%; with a business picked, "Paying" / "Not paying" |
| T-8 | The K-3 chip on Plan mix follows `tiles.k3.status`; the K-2 chip on Credits (MK-1) and the K-4 figure remain |
| T-9 | Builder: the paying numerator and denominator; `platformMargin` equals the Accounts tab's platform line for the same reads |
| T-10 | Targets: F-K4 → `tab=accounts`, F-K5 → `tab=plans` (real links; a plain click writes once) |

## 6. Guards

- The finance source guard (no mode wording outside the MK-4 allow-list, no money added in a page file), vocabulary (FC-1: "AI"), contrast, C-14, range-cap (no new read), `test:authz-guard`, `test:bos-entitlements`, `lint:hooks`.
- The scoped tsc covers every touched test file (the MK-4 lesson); its file list goes in the notes.

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | `$` changes many test strings ("USD 12.50") | A mechanical, listed edit; Pins B, A and AC-145 are the only pins |
| R-2 | A small AI cost shown as `$0.00` | `formatUsd` keeps 4 decimals |
| R-3 | The platform margin computed on every Overview load | No new read; the pure function is cheap over rows already in memory |
| R-4 | MK-3 in parallel may build its own `formatUsdSign` | MK-3 reuses this one (SA-9: built once) |

## Implementation Notes

**2026-10-19, Dev. Implemented as §2, uncommitted. Exactly three ruled pins moved: Pin B, Pin A and AC-145. No migration and no new read.**

### Files

| File | Change |
|---|---|
| `lib/business-os/finance/financeTypes.ts` | `FinancePaying` (all: `paying` / `accounts` / status; one: boolean); `FinancePayload.paying?`, `platformMargin?` |
| `lib/business-os/finance/accountEconomics.ts` | New exported `buildPlatformMargin(reads)`. The Accounts tab's platform line now spreads it, so the tab and F-K4 are one function. `moneyByAccount` takes only the three money reads it uses. Key order is unchanged |
| `lib/business-os/finance/financeHealth.ts` | `paying` from the plan walk's rows ∩ the paying set (current mode, BD-37) over every plan row (Q-11). `platformMargin` with no business picked. Both are in the payload after `paymentProblems` |
| `app/admin/finance/financeFormat.ts` | `formatMoney`: USD → `$1,234.56` / `-$5.00`; any other code unchanged. `formatUsd`: `$` with 2 to 4 decimals. New `formatUsdSign(line, { maxDecimals })`: USD only, otherwise null |
| `app/admin/finance/financeCopy.ts` | `FINANCE_KPIS` (label, caption and definition per KPI; F-K4 carries the FC-2 sentence word for word), the other-currency notes, the paying and margin words, `accountsK3Chip`. Two `RECORDED_DISTORTIONS` lines say `$0` instead of "USD 0" |
| `app/admin/finance/components/FinanceKpiStrip.tsx` | The re-cut, F-K1 to F-K5, each with its indicator. Money only through `formatUsdSign`. Other currencies are a count note. The test-key label is on F-K2 only. F-K5 has an MK-5b slot comment, with nothing rendered |
| `app/admin/finance/components/FinanceView.tsx` | Passes `data`; adds `tabTarget('accounts' \| 'plans')` (filter mode; empty with a business picked); hands `k3` to Plan mix; drops the unused `k1AnalyticsHref` import |
| `app/admin/finance/components/AccountsByPlanSection.tsx` | The K-3 chip (`accounts-k3-chip`, amber → `warn`, red → `danger`) with the payload's headline |
| `app/admin/finance/components/RecurringNowPart.tsx` | `id="revenue-mrr"` (F-K2's target) |

**`console.*`:** 0 in every touched source file.

### Ruled pins (before → after)

| Pin | Before (sha256, LF) | After |
|---|---|---|
| **Pin B** `financeTiles.pin.render.test.tsx` | `24ff0da7efb824ccc2b5d90687e34b3cd9da33803658dccf19c0d096ae56df9f` | `a1b3db0ccb6cb76cec8181e62225829872cc9845208151484c2657be530f11e4` |
| **Pin A** `KpiStrip.callers.pin.render.test.tsx` | `30f5fc24f4e46870033ecdc984efa1c0647f633256f73ccfb302fa9899e62e01` | `6547dcf74c10c51e6a0dfb71a542fd7395c5cc1578fafcdc95c881fd3951f546` |
| **AC-145** `EXPECTED_SHA256` in `route.test.ts` | `30275c298fa4cb265ffe8933dee56c71d4243c171c39eddbe1d2e55d64950631` | `a13f1ccd7a95db60cce67bccc0df7450290b3162506b6e06f50edac3016f0060` |
| `route.test.ts` file | `225e6ea1…ab42` | `ff387500…4c9a` |
| AC-173 file / helper, Pin C / helper, Pin D | `3a1a2dd4…` / `b84e0c96…`, `98ea0507…` / `02813360…`, `1f7cf07a…` | **unchanged** |

- **Pin B** is rewritten for the five F-K tiles. It keeps its five fixtures and its fixture builders above the cut, unchanged. It now checks status, text fragments ($, notes, words), each icon's kind and that the icon is never inside the tile, and the exact DOM order.
- **Pin A** gains five **A3** cases: the Finance tile shapes with an indicator (anchor lagging with status, anchor leading, tab filter current and plain, no target). Every A1 and A2 hash is unchanged.
- **AC-145:** the keys gain `paying` and `platformMargin` before the route's MRR keys. With those two stripped, the payload gives MK-4's `30275c29…0631`, and the older hashes still reproduce down the chain.

### Ruled test edits (not pins)

- `financePage.render.test.tsx`: old tile ids moved to the F-K ids or to the blocks (K-2 → `credits-over-chip`, K-3 → `accounts-k3-chip`, K-4 → `credits-gifted`). Other changes:
  - K-1's cross-page link test became "F-K3 jumps to `#ai-cost`; Section 3 keeps its own link";
  - the 6b order is now BD-35's F-K order;
  - `NO_CHIP_BUT_STATUS` leaves out the K-3 rule chip;
  - two revenue fixtures gained their `totals` lines;
  - the money-cell regexes accept `$`;
  - T-5 also lets the MRR tile carry the test-key label (C-4).
- `accountsTab`, `financeAccount`, `recordedCost` tests: the mechanical `USD n` → `$n` change (regex literals escaped).
- `finance.source.guard.test.ts`:
  - the accountEconomics export pin gains `buildPlatformMargin` (its planted control is now "a fifth export");
  - SA-WR-34 now pins "the strip prints money only through `formatUsdSign`, never `formatMoney`; K-5 money is read for its kind only".
- `financeHealth.test.ts`: a new describe (6 tests).

### Tests added

| # | Where | What |
|---|---|---|
| T-1, T-3, T-4, T-7 | Pin B (5 fixtures) | Order, `$`, `-$`, at least, the notes as counts (EUR / ILS never shown), 18% with "9 of 50", partial "at least", Unknown never 0%, Paying / Not paying |
| T-2 | `financePage` MK-5 (5 + 1) | Each icon's accessible name = kind word + the KPI's definition constant. FC-2 sentence word for word. FC-1 labels |
| T-5 | `financeFormat.test.ts` (16) | `formatUsdSign` refuses ILS, EUR, US, USDT, empty, null and NaN; `formatMoney` is `$` for USD only |
| T-6 | `usdCopy.source.guard.test.ts` (source, planted) + `financePage` (render, three views) | No "USD <amount>" in source or on the rendered page; labels such as "(USD)" pass |
| T-8 | `financePage` MK-5 | The K-3 chip (warn, danger, none when quiet); K-2 and K-4 in Credits; no `tile-k*` left |
| T-9 | `financeHealth.test.ts` (6) | Paying 1 of 2, unknown on a failed paying or plan read, one business true / false; `platformMargin` present or absent, and equal to the Accounts tab's platform line |
| T-10 | `financePage` | F-K4 → `?tab=accounts`, F-K5 → `?tab=plans`, and a plain click writes once. With a business picked, both are `div`s (no target) |

### Runs

| Run | Result |
|---|---|
| `app/admin/finance` | 23 suites, 792 passed |
| `lib/business-os/finance` | 20 suites, 2051 passed |
| Finance route | 2 suites, 127 passed |
| `app/admin/components` | 26 suites, 851 passed (Pin A) |
| Vocabulary guard | 182 passed |
| Layout (C-14) and contrast guards | 484 passed |
| Range-cap guard | 21 passed |
| `lib/admin/billing` + `app/admin/users` | 32 suites, 739 passed |
| `test:authz-guard` | 2 suites, 203 passed |
| `test:bos-entitlements` | 297 suites, 9004 passed |
| `lint:hooks` | exit 0 |
| ESLint on the touched files | clean |

**Scoped tsc (the MK-4 lesson: every touched test file is in scope)** covers **156 root files**:
- `app/admin/finance/**/*.{ts,tsx}`;
- `lib/business-os/finance/**/*.ts`;
- `app/api/admin/business-os/finance/**/*.ts`;
- `app/admin/components/layout/**/*.{ts,tsx}` (Pin A);
- `lib/admin/billing/**/*.ts`;
- `next-env.d.ts`.

The canary in Pin B gave TS2322 at `(521,7)`. The file was restored byte-identical, and the clean run had **0** errors in scope.

### Deviations for SA

- **D-1:** AC-145 moves for `paying` **and** `platformMargin`. SA's table names only "paying % fields", but F-K4 needs the platform AI margin on the Overview, where only the Accounts tab built it. It is the same function, so there is still one AC-145 re-freeze.
- **D-2:** F-K3 now anchors to the AI cost summary (`#ai-cost`), per §3.1. K-1's cross-page link to AI calls & usage is gone from the strip; Section 3 keeps that link.
- **D-3:** MK-5a is page-wide in one place: `formatMoney` and `formatUsd` print `$`. Breakdown tables keep every other currency on its own line with its code (USD-3). The plan payments and Plans & subscriptions money already used `$` (`formatMinorAmount`).

**Full `npm test`:** 1594 suites (1566 passed, 20 failed, 8 skipped) and 40,600 tests (40,395 passed, 140 failed, 65 skipped), in 692 s. The failing set is **identical** to the 20-suite Windows baseline: the same suites and the same 140 tests.


### SA-CR-MK5 fixes (two Low conditions, 2026-10-19)

- **C-1, fixed by Dev.** Paying % now leaves platform accounts out of the numerator **and** the denominator (§5.1). The rule is the existing `deps.isPlatformAccount`, the one the rest of the builder uses, so no new list. Deleted accounts have no plan row, so they were already out. Two tests in `financeHealth.test.ts`:
  - a paying platform account with a plan row gives 1 of 2, not 2 of 3;
  - a control with the rule switched off gives 2 of 3, so the test is not vacuous.
- **C-2, fixed by Dev.** The K-2 "far over" chip on Credits takes K-2's own BD-11 status (`tiles.k2.status`): red → `danger`, amber → `warn`, anything else grey (`neutral`). It is no longer a fixed amber. `CreditsSection` takes `k2`, and `FinanceView` passes it. Five tests in `financePage.render.test.tsx` cover red, amber, green, neutral and unavailable. MK-1's existing chip assertions (amber fixture → `warn`) still hold.
- **Pins:** nothing moved again. AC-145 is still `a13f1ccd…0060`, because the route fixture has no platform plan row. Pin B is still `a1b3db0c…`, Pin A `6547dcf7…`, and the other five are unchanged.
- **Re-runs:**
  - `app/admin/finance`: 23 suites, 797 passed;
  - `lib/business-os/finance`: 20 suites, 2053 passed;
  - route: 127 passed;
  - Pin A: 54 passed;
  - scoped tsc (the same 156-file globs): canary TS2322 at `CreditsSection.tsx(234,7)`, file restored byte-identical, clean run 0 errors in scope;
  - ESLint: clean.


## SA Review Notes

### SA Code Review (MK-5 with MK-5a)

**Code Review by SA, 2026-10-19. Reviewed: the uncommitted tree on `feature/admin-money-mk5-strip-usd` (from main `c60e2f93`).**
**Status: Code Approved with two Low conditions (SA-CR-MK5)**, both before the RM commit. SA re-checks only those diffs.

#### Deviation rulings

- **D-1 (`platformMargin` in AC-145): within the one ruled re-freeze.** It is a **pure move, not a new computation**. `buildPlatformMargin` is the Accounts tab's platform line extracted unchanged: the same `moneyByAccount`, `buildPaid`, `buildCost`, `buildMargins` and fee entry, over the same four reads (R-a, R-k, R-n, R-m). The tab's line now calls it, so the tab and F-K4 are equal by construction (T-9). There is no new read. Stripping `paying` and `platformMargin` reproduces MK-4's `30275c29…`.
- **D-2 (F-K3 → `#ai-cost`): approved,** as §3.1 says ("Opens Overview → AI cost summary"). Section 3 keeps its own link to the calls page.
- **D-3 (`$` page-wide in `formatMoney` / `formatUsd`): approved.** A USD line prints `$`, and every other code keeps its own line with its code (USD-3). Nothing adds two currencies.

#### Checked

| Item | Result |
|---|---|
| Ruled pins | ✅ SA recomputed: **Pin A** `6547dcf7`, **Pin B** `a1b3db0c`, and **AC-145** `a13f1ccd…` (with MK-4's `30275c29…` still asserted after stripping). The rest are unchanged: AC-173 `3a1a2dd4`, its helper `b84e0c96`, Pin C `98ea0507`, its helper `02813360`, Pin D `1f7cf07a`. Pin A's A1 and A2 hashes are unchanged; only the five new A3 cases are added |
| Tiles, order and icons | ✅ BD-35 order F-K1 to F-K5. Each tile has `indicator` from one definition constant (LL-4): F-K1, F-K3 and F-K4 lagging; F-K2 and F-K5 leading. That matches §3.1 (T-2 checks each accessible name) |
| FC-2 | ✅ F-K4's tooltip carries "A partial gross margin: only AI cost is deducted so far. Stripe fees are an estimate beside it." word for word |
| `$` and the currency rules | ✅ `formatUsdSign` accepts one line whose code is exactly `USD` (trimmed, case-folded) and returns null for ILS, EUR, "US", "USDT", empty, null and NaN (T-5). The tiles print only through it (source guard SA-WR-34). **`groupByCurrency` is untouched**. "Plus n … in other currencies, not converted" is a **count**, never part of the value (USD-3, USD-5) |
| USD-6 copy guard | ✅ `usdCopy.source.guard.test.ts` covers source (comments stripped) and the rendered page, with planted controls for both. Exemptions are by scope: the drawer's own-currency client payments live in `app/admin/users` (USD-4), outside the scan, as do SQL files |
| Paying % (Q-11) | ✅ The numerator is plan rows in the current-mode paying set (the one `isPayingBillingRow`, BD-37). The denominator is **every plan row** (all six groups). Partial reads "at least"; unknown is never 0%; with a business picked it reads Paying or Not paying. **See C-1** |
| K-3 and K-4 into blocks | ✅ The K-3 chip takes **the K-3 tile's own status** (amber or red from `FINANCE_RULES`, BD-11 unchanged). K-4 is a Credits figure (no rule). **See C-2 for K-2** |
| MK-5b slot | ✅ F-K5 has a reserved `slot` with no rendered element. Nothing for "Converted this month" exists yet |
| Scoped `tsc` | ✅ 156 root files, including every touched test (the MK-4 lesson). Canary run 1, clean run 0 |
| Tests and full gate | ✅ SA re-ran `app/admin/finance`, `lib/business-os/finance`, the finance route, `app/admin/components`, `app/admin/__tests__` (vocabulary, contrast, C-14), `app/admin/users`, `lib/admin/billing` and FF-1d: **5199 passed**. Dev's full run fails only the same 20 Windows-only suites and 140 tests |

#### Conditions (Low, before commit)

- **C-1 (§5.1 literal):** "Deleted accounts and platform accounts are not counted." The denominator is `plansResult.data.rows.length`, with no platform filter. Filter the plan rows through the existing `deps.isPlatformAccount` for **both** the numerator and the denominator of `paying` (all businesses), and add a test with a platform account that has a plan row. If no platform account can hold a plan row, a one-line test proving that is enough instead. Deleted accounts already have no plan row.
- **C-2 (BD-11 data, carried from SA-CR-MK1):** the Credits block's K-2 chip still hard-codes `tone: 'warn'` when `farOverAllowance > 0` (`CreditsSection.tsx:129`). The K-2 tile is still computed (`financeHealth.ts:1358`), so drive the chip from **`tiles.k2.status`**, as the K-3 chip does. That way a threshold change in `FINANCE_RULES` moves the chip with no code change. Its render tests (`credits-over-chip`) stay green.

#### Code Approved for QA: Yes, after C-1 and C-2

## QA Testing Report

**QA — 2026-10-19** (worktree `neuronforge-finance-m8`, branch `feature/admin-money-mk5-strip-usd` on `c60e2f93`, uncommitted; on the **final** tree with SA's C-1 and C-2. Code stable since 20:54; the finance suites were re-run at 20:57 and later)
**Test mode:** full
**Strategy used:**
- **A + B:** Jest suites and guards, run one at a time.
- A code read of `FINANCE_KPIS`, `FinanceKpiStrip`, the paying computation and the chips.
- A **wide** scoped tsc with a canary (444 files: the whole finance tree, components, billing, users, the route).

**Focus:** ui, api
**Skipped:** the live browser look (user, below).
**Input source:** prompt + workplan + coordinator note (C-1, C-2)

**Verdict: PASS. No bugs.**

### Behaviour

| Item | Result | Evidence |
|---|---|---|
| Strip order: Revenue received, MRR now, Charged AI cost, AI margin, Paying accounts % | ✅ | `FinanceKpiStrip.tsx:166-210` (`tile-fk1` … `tile-fk5`); Pin B checks the exact DOM order and that there are exactly five |
| Icons: MRR leading, the rest lagging | ✅ | `indicator.kind` `lagging` / `leading` / `lagging` / `lagging` / `lagging`; Pin B checks each icon's kind and that it is never inside the tile |
| Tooltips word for word | ✅ | each from one `FINANCE_KPIS.*.definition` constant (LL-4); test T-2 "each icon's accessible name = kind word + the KPI's definition constant". **AI margin** carries "…A partial gross margin: only AI cost is deducted so far. Stripe fees are an estimate beside it." (test "T-2 / FC-2 … word for word") |
| Links | ✅ | F-K1 → `#revenue`, F-K2 → `#revenue-mrr`, **F-K3 → `#ai-cost`** (the AI cost summary), F-K4 → `?tab=accounts`, F-K5 → `?tab=plans`. Test "AC-180 / MK-5 … each target exists". With a business picked, F-K4 and F-K5 have no target (T-10) |
| Money as `$1,234.56`, never "USD" | ✅ | tiles print only through `formatUsdSign`, which returns null for every other code (`financeFormat.test.ts`, 16 tests: ILS, EUR, US, USDT, empty, null, NaN refused). New USD copy guard (`usdCopy.source.guard.test.ts`): no `USD <digit>` in source, planted controls; the render test finds no `USD -?\d` and does find `$\d` |
| Other currency only as "plus n … not converted" | ✅ | `kpiOtherPayments` / `kpiOtherSubscriptions` are counts, never amounts; Pin B: EUR / ILS amounts never shown |
| Never summed across currencies | ✅ | the tile value is the USD line only; `groupByCurrency` untouched; the finance guard's "no money added in a page file" is green |
| Paying %: the denominator includes trial, Founding Partner and comped | ✅ | `financeHealth.ts`: `accounts = payingRows.length`, **every plan row** (all groups), `paying` = those rows in the current-mode paying set. Definition text "…trials, Founding Partners and comped accounts included". Pin B "18% … 9 of 50" |
| **C-1: a platform account does not affect Paying %** | ✅ | `payingRows` excludes `deps.isPlatformAccount(row.user_id)` from **both** the numerator and the denominator. Tests: "a paying platform account with a plan row is in neither count (the existing isPlatformAccount rule)" plus a non-vacuous control "without the rule the platform row would count" |
| Moved tiles keep their rules | ✅ | **K-3** is a chip on Plan mix, `amber → warn`, `red → danger`, none when quiet (T-8). **K-4** is the gifted figure in Credits. **K-2** is the Credits far-over chip |
| **C-2: the far-over chip follows K-2 (red, amber, grey)** | ✅ | `k2ChipTone` (`CreditsSection.tsx:103-107`): red → `danger`, amber → `warn`, otherwise `neutral`. Test `it.each` "Money MK-5 C-2": red → danger, amber → warn, green, neutral and unavailable → neutral, each with "1 at or over 150% of allowance" |
| One fetch on load (AC-173) | ✅ | the AC-173 file and helper are unchanged and green; no new read; `route.ts` request schema untouched |
| Payload includes the platform margin | ✅ | `platformMargin` present for all businesses and absent with one picked; equal to the Accounts tab's platform line (one function, `buildPlatformMargin`); test "platformMargin equals the Accounts tab platform line…" |

### Pins (LF-normalised)

| Pin | Expected | Got |
|---|---|---|
| Pin B `financeTiles.pin.render.test.tsx` | `a1b3db0c` (ruled rewrite) | ✅ `a1b3db0c` |
| Pin A `KpiStrip.callers.pin.render.test.tsx` | `6547dcf7` (ruled) | ✅ `6547dcf7`. The diff is **additions only** (+17 / −0: the A3 cases), so every existing A1 / A2 hash is unchanged |
| AC-145 `EXPECTED_SHA256` | `a13f1ccd…0060` | ✅ present. `AFTER_MK4_SHA256` `30275c29…0631` is asserted after stripping `paying` and `platformMargin`; route suite green |
| AC-173 file / helper, Pin C / helper, Pin D | unchanged | ✅ `3a1a2dd4` `b84e0c96` `98ea0507` `02813360` `1f7cf07a` |

### Suite runs (each alone, final tree)

| Suite | Result |
|---|---|
| `app/admin/finance` | 23/23, **797/797** (792 before C-1 / C-2; +5 for C-2) |
| `lib/business-os/finance` | 20/20, **2053/2053** (2051 before; +2 for C-1) |
| The finance route (AC-145) | 2/2, 127/127 |
| `app/admin/components` (Pin A) | 26/26, 851/851 |
| Vocabulary + layout (C-14) + contrast + range-cap guards | 4/4, 687/687 |
| `lib/admin/billing` + `app/admin/users` | 32/32, 739/739 |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 297/297, 9004/9004 |
| `npm run lint:hooks` | exit 0 |

**Wide scoped tsc:**
- 444 checked files: `app/admin/finance/**`, `lib/business-os/finance/**`, the route, `app/admin/components/**`, `lib/admin/billing/**`, `app/admin/users/**`.
- A canary in `financeFormat.ts` gave `(69,7) TS2322`.
- The file was restored with `cp` and checked with `cmp` (identical).
- The clean run gives **exit 0, 0 errors**. The MK-4 lesson is covered: every touched test file is in scope.

### Issues Found
- **Bugs:** none.
- **Performance:** none. `paying` and `platformMargin` reuse rows already read; no new read.
- **Note:** this branch also carries an edit to the **MK-4** workplan's QA Final Status, marking QA-MK4-1 and QA-MK4-2 fixed. QA confirms QA-MK4-1 is fixed on main: `financeFilters.test.ts` `DEFAULTS` has `status: ''`, and the wide tsc reads 0 errors. RM should keep that doc edit or move it to its own commit.

### User browser steps (after merge; signed in as an admin, Stripe test key)
1. **Money → Finance**, Overview, This month. The strip reads, left to right: **Revenue received**, **MRR now** (with "Stripe test mode"), **Charged AI cost this month**, **AI margin**, **Paying accounts**.
   - Money shows as `$1,234.56`, never "USD 1,234.56".
   - Paying shows a percentage with "N of M accounts".
2. Hover or Tab to each tile's small icon.
   - MRR has an **arrow** (leading); the others have a **clock** (lagging).
   - The AI margin tooltip ends "A partial gross margin: only AI cost is deducted so far. Stripe fees are an estimate beside it."
3. Click each tile:
   - Revenue jumps to Our revenue, MRR to its Recurring now line, AI cost to the AI cost summary;
   - AI margin opens the **Accounts** tab, Paying opens **Plans & subscriptions**.
4. **Plan mix**: if any Founding Partner has no end date and the rule fires, a chip "N Founding Partners with no end date" shows (amber or red). **Credits**: the far-over chip shows in red, amber or grey per the K-2 rule; the gifted figure is there too.
5. The network panel shows **one** request on load.

### Final Status
- [x] All MK-5 behaviours pass on the final tree, with C-1 and C-2 verified. Pins moved exactly as ruled (B, A, AC-145); the others are unchanged. No bugs. **Ready for RM.**
- [ ] Issues found

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Created and implemented (Dev) | Strip re-cut F-K1 to F-K5 with indicators; `$` page-wide; paying % and platform margin in the payload; K-3 chip on Plan mix |
| 2026-10-19 | SA code review | Code Approved with C-1 (platform accounts out of the paying % rows) and C-2 (K-2 chip from tiles.k2.status), SA-CR-MK5. D-1 platformMargin is a pure move inside the one AC-145 re-freeze; D-2 and D-3 approved; pins as ruled; 5199 passed |
