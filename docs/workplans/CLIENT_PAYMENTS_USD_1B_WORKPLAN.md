# Workplan: Client payments in approximate US dollars, slice 1b (UI)

> **Last Updated**: 2026-10-27

**Developer:** Dev
**Requirement:** [ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md](/docs/requirements/ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md)
- §5 (the figure, its wording, leading or lagging, placement D-1), §6.3, §7 (KPI, breakdown, drawer) and §8 R-9 / R-10.
- §11 row 1b and §12 AC-13 to AC-21.
- **SA-RR-CPU**: SA-Q-5, SA-Q-6, CPU-4 and CPU-5.
- Slice 1a's SA-WP-CPU1A rulings SA-Q-1A-8 (the tab copy) and the 1a retrospective follow-up **CPU1A-FU-1**.

Where SA-RR-CPU and the BA draft disagree, SA-RR-CPU wins.

**Branch:** `feature/client-payments-usd-1b`, in the worktree `neuronforge-cpu1b`, created from `origin/main` at `554367c8`.
- **No 1a commit existed** when the worktree was created: 1a was still uncommitted in `neuronforge-cpu1a`, and there was no `feature/client-payments-usd-1a` on the remote. So this branch does not contain 1a. The 1a code was read in `neuronforge-cpu1a`.
- RM merges `origin/main` in after 1a lands, before any 1b code is written, so 1b never stacks on an open PR.
- Nothing is pushed.

**Date:** 2026-10-27
**Status:** Planning. Awaiting SA workplan review. No code written.
**Status update (2026-10-27):** SA-WP-CPU1B approved with conditions B-1 to B-5 (§12), folded into the body as appended amendments. **Waiting for 1a to merge** (B-5), then `origin/main` is merged in and code starts.
**Status update (2026-10-27, later):** Code Complete, uncommitted, awaiting SA code review and QA. 1a (#527) is merged in. CPU1A-FU-1 has moved to the follow-ups bundle (§11A).

## Overview

Slice 1b puts slice 1a's server figure, `takings.usd`, on the Finance page.
- **The figure.** The Client payments block gets a second headline beside "Businesses taking client payments": "Client payments processed", shown as "≈ $12,346". It carries:
  - a small note inside the tile, "Our customers' revenue, not ours";
  - a **Lagging** pill with the §5.3 tooltip;
  - "At least" whenever a currency was left out or a read was cut off;
  - an amber "Uses a stale rate" chip. Per SA, the chip is not a link; the Exchange rates link sits in the line under the headlines.
- **The breakdown.** A small "Converted to $" table under the headlines: currency, payments, the amount in its own currency, the rate used, its date, and ≈ dollars, with a "≈ Total" row equal to the headline.
- **Unchanged.** Every existing table in the block, the business drawer and the strip.

The shared `BlockKpi` gains one optional `note` prop. Without it the markup is byte-identical, and its hash test stays unedited (CPU-5).

Two small extras ride along:
- the Exchange rates tab's sentence "Nothing on the platform converts money with them" changes to the accepted wording (SA-Q-1A-8);
- the leak guard gains the function-parameter destructure (CPU1A-FU-1).

There is no server change, no migration and no new fetch.

## Table of Contents

1. [Step 0: code facts](#1-step-0-code-facts)
2. [Design](#2-design)
3. [Copy](#3-copy)
4. [Pins](#4-pins)
5. [Guards](#5-guards)
6. [Files to create / modify](#6-files-to-create--modify)
7. [Task list](#7-task-list)
8. [Tests](#8-tests)
9. [Acceptance criteria](#9-acceptance-criteria)
10. [Risks](#10-risks)
11. [Open SA questions](#11-open-sa-questions)
12. [SA Review Notes](#12-sa-review-notes)
13. [QA Testing Report](#13-qa-testing-report)
14. [Commit Info](#14-commit-info)
15. [Change History](#change-history)

---

## 1. Step 0: code facts

Read on 2026-10-27, from `origin/main` `554367c8` in `neuronforge-cpu1b`, and the 1a code in `neuronforge-cpu1a`.

| # | Fact | Where |
|---|---|---|
| F-1 | **The 1a payload.** `takings.usd?: FinanceClientPaymentsUsd` carries `{ status, totalUsd, rows[], converted { payments, currencies }, notConverted { payments, currencies }, ratesRead, stale }`. Each row is `{ currency, payments, gross, rate (text), rateUpdatedAt, state, usd }`. `state` is one of `converted`, `stale`, `no_rate`, `disabled` or `unusable`. It is present on the Overview and in the picked view, absent on the Accounts tab, and `unknown` only when `figures` is null. The USD row has `rate: '1'`. `totalUsd` and `usd` are major-unit numbers from integer cents. | `lib/business-os/finance/financeTypes.ts` (1a) |
| F-2 | **`BlockKpi`** takes `{ label, value, indicator, chip?, testId }`. It renders a `div role="group"` named `"${label}, ${value}"` containing a label span, a value span plus an optional `StatusChip`, and the `KpiIndicator` pill in the top-right corner. It is not a link (A-9). It has **three callers**: Finance's `CreditsSection` and `TakingsSection`, and `LeakCheckPanel` on the AI cost page. | `app/admin/components/layout/BlockKpi.tsx` |
| F-3 | **The `BlockKpi` hash test** renders `{ label: 'Businesses taking client payments', value: 'At least 4', indicator: leading, testId: 'takings' }` with no chip, and pins `sha256(innerHTML) = 99c6969c…fad4`. Two more cases check the group's name, the chip and the pill. | `app/admin/components/layout/__tests__/BlockKpi.render.test.tsx` |
| F-4 | **`TakingsSection`** wraps `FinanceSection` (the "Not our revenue" badge). Inside, `TakingsBody` renders, in order: the one `BlockKpi` (`testId="takings-businesses"`, leading); the partial notices; the "Takings per currency" table; refunds; fees; processors; the by-business table; and "Not shown here". `TakingsBody` renders only when `figures` is non-null. Money goes through `formatMoney` and `atLeast`, and the file adds no money. | `app/admin/finance/components/TakingsSection.tsx` |
| F-5 | **`FinanceView`** passes `data.takings` whole, so `usd` reaches `TakingsSection` with no `FinanceView` change. | `FinanceView.tsx` L441 |
| F-6 | **Formatting helpers.**<br>• `formatMoney(amount, currency)` gives `$1,234.56` for USD and `ILS 45,230.00` otherwise.<br>• `atLeast(text, exact)` prefixes "At least".<br>• `formatCount`.<br>• `formatUsd` keeps up to 4 decimals.<br>• There is **no whole-dollar formatter**. `dollars(amount, min, max)` is private to `financeFormat.ts`. | `app/admin/finance/financeFormat.ts` |
| F-7 | **The indicator.** `KpiIndicatorSpec = { kind, definition }`. Tooltip line 2 and the accessible-name prefix come from the shared `KPI_INDICATOR_WORDS`. For `lagging` that is "Lagging indicator: it tells you what already happened", which is §5.3 line 2 word for word. So 1b supplies only line 1, as one copy constant (LL-4). | `app/admin/components/layout/KpiStrip.tsx` L121-141 |
| F-8 | **`StatusChip` tones**: `danger`, `warn`, `ok`, `info`, `unknown`, `neutral`. `warn` is amber and has an icon (A-7). | `app/admin/components/layout/StatusChip.tsx` |
| F-9 | **Rate display.** `roundRateForDisplay(rate, 3)` rounds on the digits, never through a number ("3.700000" → "3.700"), as the Exchange rates tab does. `exchangeRateRules.ts` is pure and isomorphic, and is already imported by `app/admin/exchange-rates/components/*`. | `lib/admin/exchangeRates/exchangeRateRules.ts` L208-238 |
| F-10 | **Dates.** `formatUtcDate(value)` gives a `YYYY-MM-DD`-style UTC date, and is shared. | `app/admin/components/layout/adminFormat.ts` L56 |
| F-11 | **The Exchange rates tab URL is `/admin/finance?tab=exchange-rates`** (`financeFilters` `tab` choice). It does **not** contain the retired page route `/admin/exchange-rates`, so G-4 in `redundantPages` is unaffected. In-page link precedent: `<a href={PLANS_PAGE}>` in `AccountsByPlanSection`. `financeLinks.ts` has its imports pinned to two modules, which a literal constant does not touch. | `financeFilters.ts` L150; `redundantPages.source.guard` G-4; finance `source.guard` L196 |
| F-12 | **The tab copy.** `EXCHANGE_RATES_PURPOSE = 'Rates an admin keeps by hand, in units of each currency per 1 USD. Nothing on the platform converts money with them.'` The same sentence appears in the file header (L9). Tests assert through the **constant** (`exchangeRatesTab.render.test.tsx` L219, L373), so changing the wording edits no test. | `app/admin/exchange-rates/components/ExchangeRatesView.tsx` L9, L148-149 |
| F-13 | **The takings render tests** build `FinanceTakingsSection` fixtures **without** `usd`, and assert by test id and text, including the "no payments" case with no `0.00`, `USD` or `ILS` text (L1002). **Pin B** (`financeTiles.pin`) renders the strip through `FinanceView` using the same fixture shape, also without `usd`. | `financePage.render.test.tsx` L276, L876-1020; `financeTiles.pin.render.test.tsx` |
| F-14 | **The `usdCopy` guards.**<br>• Source: no `USD <digit>`, `` `USD ${`` or `'USD '` anywhere under `app/admin/finance`.<br>• Render (L2909): no rendered "USD <amount>" on a full page. | `app/admin/finance/__tests__/usdCopy.source.guard.test.ts`; `financePage.render.test.tsx` |
| F-15 | **Finance guard rules on page files**: CUR-3 bans `exchange_rates` in code under `app/admin/finance/**`; `MONEY_ARITHMETIC` bans adding or subtracting two money fields; `MODE_WORDING` applies; and there is no `console.`. | `lib/business-os/finance/__tests__/finance.source.guard.test.ts` |
| F-16 | **The 1a leak guard.**<br>• Its `ALLOWED` list already holds `TakingsSection.tsx` and `financeCopy.ts`.<br>• `TYPED_USD` flags any file that reaches takings (`takings`, `FinanceTakingsSection` or `FinancePayload`) **and** reads a `usd`.<br>• **Gap (CPU1A-FU-1):** a typed destructure in a function's parameters, `function f({ takings: { usd } }: FinancePayload)`, matches no `READS_USD` form, because the braces are followed by `:`, not `=`. | `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts` (1a); `docs/retrospectives/CLIENT_PAYMENTS_USD_1A_RETROSPECTIVE.md` |
| F-17 | **The layout folder guard** (C-14) scans `app/admin/components/layout/**`. It has rules on colours: one green constant, no `dark:`, no `--v2-` tokens. A `slate` text class on the note is allowed. | `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` |

---

## 2. Design

### 2.1 `BlockKpi`: an optional `note` (SA-Q-5, CPU-5)

```tsx
export interface BlockKpiProps {
  // …unchanged…
  /** SA-Q-5 (BD-56): a small line inside the tile, under the figure. Absent: nothing renders (byte-identical). */
  note?: string;
}
// after the value/chip span, before the indicator:
{note && (
  <span className="mt-1 block text-[11px] text-slate-400" data-testid={`${testId}-note`}>
    {note}
  </span>
)}
```

- With no `note`, React renders nothing for `{undefined && …}`, so the three existing callers produce the **same markup**. The hash test stays **green and unedited**.
- The group's accessible name stays `"${label}, ${value}"`. The note is inside the group, so a screen reader reads it as group content (SA-Q-1B-2).
- The header gains one line on the new prop. That is a shared export, so 1b runs the full cycle (LAY R-7).

### 2.2 The block: two headlines, only when `usd` is present

In `TakingsBody`:
- **No `usd` on the section** (the Accounts tab, and every existing fixture): the **current single `BlockKpi` renders exactly as today**, with no wrapper. Old payloads and every existing takings render test are therefore untouched.
- **`usd` present:** a wrapper `div` (`grid gap-3 sm:grid-cols-2`, `data-testid="takings-headlines"`) holds:
  1. the existing "Businesses taking client payments" `BlockKpi`, unchanged;
  2. a new `BlockKpi` with `testId="takings-usd"`:
     - `label = CLIENT_PAYMENTS_USD.label`;
     - `value`: see §2.3;
     - `indicator = { kind: 'lagging', definition: CLIENT_PAYMENTS_USD.definition }`;
     - `note = CLIENT_PAYMENTS_USD.note`;
     - `chip = usd.stale ? { tone: 'warn', label: CLIENT_PAYMENTS_USD.staleChip } : null`.
- Then, still inside the wrapper's block, one line (`data-testid="takings-usd-line"`) holding three parts:
  - the second line, "Converted at admin rates · {n} payments in {m} currencies" (n and m are `usd.converted.*`, never counted on the page);
  - when `usd.notConverted.payments > 0`: "plus {n} payments in other currencies, not converted (no rate)", or, when `ratesRead === 'failed'`, "Exchange rates could not be read; {n} payments in other currencies not converted" (§6.3);
  - **the link** "Exchange rates" → `/admin/finance?tab=exchange-rates`. It is always present when `usd` is present, so a stale rate always has its fix beside the chip (SA-Q-5).
- Then the "Converted to $" table (§2.4), only when `usd.rows.length > 0`.

### 2.3 The headline value

| `usd` | Value |
|---|---|
| `status: 'unknown'` | `KPI_UNKNOWN` ("Unknown"). Not normally reachable, because `TakingsBody` needs `figures` |
| `converted.payments === 0 && notConverted.payments === 0` | `CLIENT_PAYMENTS_USD.none` ("None"). The block's existing empty message, "No client payments recorded in this window", already shows. **Never "≈ $0"** (AC-15, SA-Q-1B-3) |
| `status: 'ok'` | `≈ ${approxWholeDollars(totalUsd)}`, for example "≈ $12,346" |
| `status: 'partial'` | `atLeast(…, false)`, giving "At least ≈ $12,346" |

`approxWholeDollars` is a new `financeFormat.ts` formatter: `dollars(amount, 0, 0)` with the "≈ " prefix. It **formats** the server's number; it does no arithmetic (R-9).

**Amended by SA-WP-CPU1B B-1.** This row is checked before the `partial` row:

| `usd` | Value |
|---|---|
| `converted.payments === 0 && notConverted.payments > 0` (for example, only EUR payments and no EUR rate, or the rates read failed with no US-dollar payments) | `CLIENT_PAYMENTS_USD.notConverted` ("Not converted"), **never "At least ≈ $0"**. The line under the headlines gives the reason: the no-rate note, or the rates-failed note. Test **U-3b** |

### 2.4 The "Converted to $" table

An `ADMIN_TABLE` with `aria-label = CLIENT_PAYMENTS_USD.table`, `data-testid="takings-usd-table"`, and one row per `usd.rows` entry (`data-testid="takings-usd-row-<code|unknown>"`). The rows come in the server's order.

| Column | Cell |
|---|---|
| Currency | `currencyLabel(row.currency)`; Unknown currency for null |
| Payments | `count(row.payments)`, with "At least" when the payments read was cut off, as the per-currency table does |
| Paid, in that currency | `gross(row.gross, row.currency, 0)`, giving `ILS 45,230.00` or `$150.50` (`formatMoney`) |
| Rate used | `row.rate` and USD: "—" (SA-Q-1B-4). `row.rate` and other codes: `${roundRateForDisplay(row.rate)} per $1`. `row.rate === null`: "—" |
| Rate last updated | `formatUtcDate(row.rateUpdatedAt)`, plus a state chip: `stale` → warn "Stale"; `no_rate` → neutral "No rate"; `disabled` → neutral "Rate off"; `unusable` → neutral "Not usable". USD shows "—" |
| ≈ In US dollars | `row.usd !== null` → `≈ ${formatMoney(row.usd, 'USD')}` (cents). Otherwise `CLIENT_PAYMENTS_USD.notConverted` ("Not converted") |

- **The last row** is a `<tfoot>` row, "≈ Total", whose cell is `atLeast(≈ formatMoney(usd.totalUsd, 'USD'), usd.status === 'ok')`. It equals the headline to the cent; the headline shows whole dollars.
- **Under the table**, the footer line "Approximate. Converted at the admin rates on the Exchange rates tab; never part of our revenue.", followed by the same link.

### 2.5 What does not change

- The per-currency, refunds, fees, processor and by-business tables, and "Not shown here" (AC-18). The business drawer (BD-50).
- `FinanceKpiStrip` and every tile (AC-19). `FinanceView`. The route, the payload and every lib file.

### 2.6 The Exchange rates tab copy (SA-Q-1A-8)

`EXCHANGE_RATES_PURPOSE` becomes **"Rates an admin keeps by hand, in units of each currency per 1 USD. They convert one admin figure only: the approximate-dollar total of client payments on Finance."**
- "per 1 USD" is kept, so the `usdCopy` guard is unchanged; that guard does not scan `app/admin/exchange-rates` anyway.
- The header comment at L9 gets the same correction.
- The user sees this line in the 1b diff, beside the figure.

### 2.7 CPU1A-FU-1: the leak guard

- `READS_USD` gains one form: a destructure whose braces are followed by a **type annotation inside a parameter list**, `\{[^{}]*\busd\b[^{}]*\}(?:\s*\})*\s*:\s*[A-Za-z_]`. Like every other form, it is still gated by `REACHES_TAKINGS`.
- **Planted controls**, in every forbidden zone:
  - `function f({ takings: { usd } }: FinancePayload) {}`;
  - `const g = ({ usd }: FinanceTakingsSection) => usd;`.
- **Precision controls**, which must **not** be caught:
  - a file with no takings reach, `function h({ usd }: Other) {}`;
  - a type literal, `type X = { usd: number };`.
- **Real-file check.** `TakingsSection.tsx` will read `takings.usd` and stays an allowed holder.

---

## 3. Copy

All in `financeCopy.ts`, as one object (LL-4):

```ts
/** BD-56 (ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md §5, §7.2): client payments in approximate dollars. */
export const CLIENT_PAYMENTS_USD = {
  label: 'Client payments processed',
  /** §5.3 line 1 (line 2 is the shared lagging line). */
  definition:
    "What our customers' clients paid them through AgentPilot in this window, before refunds and fees, converted to approximate US dollars at the rates on the Exchange rates tab. Our customers' money, never part of our revenue.",
  note: "Our customers' revenue, not ours",
  none: 'None',
  staleChip: 'Uses a stale rate',
  convertedLine: (payments: number, currencies: number) =>
    `Converted at admin rates · ${payments} ${payments === 1 ? 'payment' : 'payments'} in ${currencies} ${currencies === 1 ? 'currency' : 'currencies'}`,
  notConvertedNoRate: (count: number) => `plus ${count} ${count === 1 ? 'payment' : 'payments'} in other currencies, not converted (no rate)`,
  ratesFailed: (count: number) =>
    `Exchange rates could not be read; ${count} ${count === 1 ? 'payment' : 'payments'} in other currencies not converted`,
  ratesLink: 'Exchange rates',
  table: 'Converted to $',
  columns: { currency: 'Currency', payments: 'Payments', paid: 'Paid, in that currency', rate: 'Rate used', updated: 'Rate last updated', usd: '≈ In US dollars' },
  ratePer: (rate: string) => `${rate} per $1`,
  states: { stale: 'Stale', no_rate: 'No rate', disabled: 'Rate off', unusable: 'Not usable' },
  notConverted: 'Not converted',
  total: '≈ Total',
  footer: 'Approximate. Converted at the admin rates on the Exchange rates tab; never part of our revenue.',
} as const;
export const EXCHANGE_RATES_TAB_HREF = '/admin/finance?tab=exchange-rates';
```

Notes on the copy:
- Every money string uses "$" and "≈" (R-10, EX-3). None prints "USD " followed by a number.
- "Rate off" is the Exchange rates tab's own word for a disabled currency, so the two pages use the same term (SA-Q-1B-5).

---

## 4. Pins

| Pin | Moves? | Why |
|---|---|---|
| `BlockKpi` hash `99c6969c…` | **No, unedited** (CPU-5) | No `note` means the same markup |
| Pin A (`KpiStrip.callers`) | No | `BlockKpi` is not a `KpiStrip` caller, and `KpiStrip.tsx` is untouched |
| Pin B (`financeTiles.pin`) | No | The strip is untouched, and the fixtures carry no `usd` |
| Pin C (AI cost, `chargeChecksRequest.pin`), Pin D (Health) | No | Not touched. `LeakCheckPanel` passes no `note` |
| AC-173 (`financeRequest.pin`) | No | No request change |
| AC-145 (route) and the builder-level AC-145 | No | No server change |
| Takings render tests (`financePage.render.test.tsx` L876-1020) | **No, unedited** | Without `usd` the block renders as today (§2.2). The new cases go in a **new** describe |
| `exchangeRatesTab.render.test.tsx` | No, unedited | It asserts through `EXCHANGE_RATES_PURPOSE` |
| `usdCopy` source and render guards | No | Every new string uses "$". The render rule is re-run with a `usd` fixture added in the **new** describe |
| 1a leak guard | **Amended** (FU-1, §2.7) | A pattern and controls are added. Nothing is removed, and `ALLOWED` is unchanged |

If any pin marked **No** moves, that is a defect, and the work stops.

---

## 5. Guards

| Guard | Change | Planted control |
|---|---|---|
| `clientPaymentsUsd.source.guard` (1a) | FU-1 pattern (§2.7) | 2 must-catch forms × every zone; 2 must-not-catch forms |
| **New source test in `financePage` / page guard** | `TakingsSection.tsx` and `BlockKpi.tsx` do no arithmetic on `totalUsd` or `usd`: no `[-+*/]` next to `.totalUsd` or `.usd` in code | A planted `usd.totalUsd * 100` is caught |
| CUR-3, `MONEY_ARITHMETIC`, `MODE_WORDING`, `usdCopy` | No edit. The new code must pass them | existing |
| `redundantPages` G-4 / G-6 | No edit. The link is the Finance tab URL; there is no new `fetch(` | existing |
| `layoutFolder.guard` (C-14) | No edit. The note uses `text-slate-400` only | existing |

**Amended by SA-WP-CPU1B B-2 and B-4.**
- **The no-arithmetic rule (B-2).** It matches only an arithmetic operator applied directly to the field: `\.(?:totalUsd|usd)\s*[-+*/%]` or `[-+*/%]\s*[\w.?]*\.(?:totalUsd|usd)\b`.
  - Planted, must catch: `usd.totalUsd * 100`, `row.usd + 1`, `1 - usd.totalUsd`.
  - Precision, must not catch: `{usd.totalUsd}</span>`, `usd?.totalUsd ?? null`, `formatMoney(row.usd, 'USD')` and `row.usd !== null`.
  - The JSX close tag `</` is excluded by requiring an operand character after `/`, never `<` or `>`.
- **FU-1 (B-4).** The new parameter-destructure form joins `READS_USD` and is therefore gated by `REACHES_TAKINGS`. Both must-not-catch controls are in the suite:
  - another type's parameter in a file with no takings reach, `function h({ usd }: Other) {}`;
  - a type literal, `type X = { usd: number };`.
- `ALLOWED` is unchanged.

---

## 6. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/admin/components/layout/BlockKpi.tsx` | modify | Optional `note` (SA-Q-5) |
| `app/admin/components/layout/__tests__/BlockKpi.render.test.tsx` | **add cases only** | The note renders inside the group; it is absent without the prop. The hash case is not touched |
| `app/admin/finance/components/TakingsSection.tsx` | modify | Two headlines, the line, the table (§2.2-2.4) |
| `app/admin/finance/financeCopy.ts` | modify | `CLIENT_PAYMENTS_USD`, `EXCHANGE_RATES_TAB_HREF` |
| `app/admin/finance/financeFormat.ts` | modify | `approxWholeDollars` |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | **add a describe** | §8.2 |
| `app/admin/finance/__tests__/clientPaymentsUsd.render.test.tsx` | create (alternative to the above, SA-Q-1B-6) | Same cases, in their own file |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | modify | The purpose sentence and the header line (§2.6) |
| `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts` | modify | FU-1 (§2.7) |
| `docs/workplans/CLIENT_PAYMENTS_USD_1B_WORKPLAN.md` | create | This file |

**Amended by SA-WP-CPU1B (SA-Q-1B-6, B-3).**
- `app/admin/finance/__tests__/clientPaymentsUsd.render.test.tsx` is the chosen location. The `financePage.render.test.tsx` row above is the fallback only.
- **New file:** `app/admin/finance/__tests__/clientPaymentsUsdFixtures.ts`, a plain helper with no `describe` and no `it`, holding the payload builder.
- **`BlockKpi.render.test.tsx`:** appended cases only; the hash case and its constant are unedited (B-3).

No API route, repository, lib, migration, `FinanceView` or strip change. Nothing touched imports from `lib/business-os/entitlements/`. `console.*` counts in the files to touch were checked: none.

---

## 7. Task list

- [ ] 1. SA approves this workplan. RM merges `origin/main`, with 1a, into the branch. Confirm that `takings.usd` is in `financeTypes.ts`.
- [ ] 2. `BlockKpi` `note`; new cases in its test; the hash case is green **unedited**.
- [ ] 3. Copy and the formatter (§3, §2.3).
- [ ] 4. `TakingsSection`: headlines, the line, the table.
- [ ] 5. Render tests (§8.2), including the `usdCopy` render rule over a `usd` fixture.
- [ ] 6. `EXCHANGE_RATES_PURPOSE` and its header.
- [ ] 7. FU-1 in the leak guard, with its controls.
- [ ] 8. The new no-arithmetic source rule.
- [ ] 9. Verify:
  - `npx jest app/admin/finance app/admin/components/layout app/admin/__tests__ app/admin/business-os-llm lib/admin/exchangeRates lib/business-os/finance`;
  - `npm run typecheck:bos-llm`;
  - `tsc --noEmit`, filtered to the touched files (8 GB heap; check for an out-of-memory crash);
  - `npm run build`, which needs the real env, so it is owed in CI, as in 1a;
  - `git diff --stat`, with no deletion-only file.
- [ ] 10. Status → Code Complete; leave the changes uncommitted for the SA code review and QA, then the user sees the diff (the CLAUDE.md-adjacent copy, §2.6).

**Amended by SA-WP-CPU1B.**
- **Task 1 (B-5): wait.** Do not start until the coordinator confirms that 1a's PR has merged. Then run `git fetch` and merge `origin/main` into `feature/client-payments-usd-1b` (a merge, never a stash), and confirm that `takings.usd` and `FinanceClientPaymentsUsd` are in `financeTypes.ts` and that 1a's leak guard is present. Slice 0 is merged (#526).
- **Task 5 (B-1):** includes U-3b.
- **Task 8 (B-2):** includes the precision controls.
- **Task 9 (B-3):** the run must include the Leak check suite (`app/admin/business-os-llm`, `leakPanel.render.test.tsx`) and the Credits block render cases (`app/admin/finance`), as proof that `BlockKpi`'s other two callers are unchanged.
- **Build (B-5):** the proof is CI's required Build check on the PR. The PR does not merge until it is green.

---

## 8. Tests

### 8.1 `BlockKpi` (added cases)

- **N-1.** `note="Our customers' revenue, not ours"` renders `[data-testid="x-note"]` inside the group, with that text. The group's `aria-label` is unchanged.
- **N-2.** Without `note`, `x-note` is absent. The existing hash case is unchanged and green.

### 8.2 The Finance page, Client payments block with `usd`

| # | Case (fixture: `takingsSection()` plus a `usd`) | Expect |
|---|---|---|
| U-1 | **Exact (AC-13)**: `ok`, `totalUsd: 12346.32`, USD and ILS converted | Two headlines in `takings-headlines`. "Businesses taking client payments" is unchanged and **Leading**. `takings-usd` reads "≈ $12,346"; its pill reads **Lagging**; its note reads "Our customers' revenue, not ours". The group is named "Client payments processed, ≈ $12,346" |
| U-2 | **Tooltip and name (AC-14)** | Opening the pill shows `CLIENT_PAYMENTS_USD.definition` and the lagging line. Its accessible name starts "Lagging indicator" |
| U-3 | **At least (AC-15)**: `partial`, EUR `no_rate`, `notConverted { 3, 1 }` | "At least ≈ $…"; the line holds "plus 3 payments in other currencies, not converted (no rate)" |
| U-4 | **Rates read failed** | "At least ≈ $…"; the line holds "Exchange rates could not be read; …" |
| U-5 | **No payments** | The value is "None"; there is no "≈ $0" anywhere in the block; there is no table |
| U-6 | **Stale (AC-16)**: `stale: true`, an ILS row `stale` | The chip "Uses a stale rate" is warn-toned and **not** inside an `<a>`. The "Exchange rates" link is in the line, `href="/admin/finance?tab=exchange-rates"` |
| U-7 | **The table (AC-17)** | Columns as §2.4. The ILS row reads "ILS 45,230.00", "3.700 per $1", the date, and "≈ $12,224.32". The USD row shows "—" for the rate and date. The EUR `no_rate` row reads "No rate" and "Not converted". The "≈ Total" cell equals `≈ $` + the total to the cent. The footer and link are present |
| U-8 | **Unchanged tables (AC-18)** | With `usd` present, `takings-lines`, refunds, fees, processors and by-business render the same text as with `usd` absent: the same fixture both ways, comparing those subtrees' `textContent` |
| U-9 | **The strip (AC-19)** | `tile-*` ids, values and order are equal with and without `usd` |
| U-10 | **Copy (AC-20)** | No rendered "USD <digit>" (the `usdCopy` render rule over this page). Every converted amount in the block starts with "≈" or "At least ≈" |
| U-11 | **One business picked** (`scope: 'one'`) | The figure shows for that business. The drawer has no converted line (BD-50) |
| U-12 | **`usd` absent** | Exactly one `BlockKpi` and no `takings-headlines`, as before |
| U-13 | **The Exchange rates tab** | It renders the new purpose sentence (through the constant) |
| U-3b | **B-1: payments exist, none converted.** Only EUR, no EUR rate (`converted.payments 0`, `notConverted { 2, 1 }`, `partial`); and a second fixture where the rates read failed with no USD payments | The value is "Not converted"; the block has no "≈ $0" and no "At least ≈ $0"; the line holds the reason (the no-rate note, or the rates-failed note); the "≈ Total" row reads "Not converted" too |

**Amended by SA-WP-CPU1B SA-Q-1B-6.**
- The render cases live in a new `app/admin/finance/__tests__/clientPaymentsUsd.render.test.tsx`.
- Its payload builder is a **plain helper module in the same `__tests__` folder**, `clientPaymentsUsdFixtures.ts`. The precedent is `chargeChecksRequestPins.ts` and `financeRequestPins.ts`.
- It **never imports from a `*.test.tsx`**, and `financePage.render.test.tsx`'s fixtures are not edited.
- If the helper would need most of that file's builders, the fallback is a new describe at the end of `financePage.render.test.tsx` (no ruling needed).

### 8.3 Guards

FU-1 controls (§2.7) and the no-arithmetic rule (§5), each with its planted control.

### 8.4 Manual (AC-21, QA)

On a real account, QA checks the block in four windows: USD only, mixed currencies, a missing rate (disable a currency on the tab), and a stale rate. The rate is edited back afterwards. QA records the result in the workplan.

---

## 9. Acceptance criteria

These are requirement AC-13 to AC-21, with the SA rulings applied.

- [ ] AC-13: two headlines. "Businesses taking client payments" is unchanged and leading. "Client payments processed" shows "≈ $…", is lagging, and carries the note "Our customers' revenue, not ours" inside the tile (U-1).
- [ ] AC-14: the tooltip and accessible name follow §5.3, from one copy constant (U-2).
- [ ] AC-15: "At least ≈ $…" plus the not-converted note when `partial`; "Unknown" when `unknown`; "None" with the block's empty message when there are no payments; never "≈ $0" (U-3 to U-5).
- [ ] AC-16: the amber "Uses a stale rate" chip shows on the figure, and the Exchange rates link sits beside it, not on it (SA-Q-5) (U-6).
- [ ] AC-17: the "Converted to $" table and its "≈ Total" equal to the headline in cents, with the link (U-7).
- [ ] AC-18: the existing tables and the drawer are unchanged (U-8, U-11).
- [ ] AC-19: the strip is unchanged (U-9; Pin B unedited).
- [ ] AC-20: no money arithmetic on the page, no "USD " money string, and "≈" on every converted amount (U-10, the §5 rule).
- [ ] AC-21: QA's manual check (§8.4).
- [ ] CPU-5: `BlockKpi` without `note` is byte-identical, and the hash test is unedited.
- [ ] SA-Q-1A-8: the tab sentence is changed, and the user has seen it in the diff.
- [ ] CPU1A-FU-1: the parameter destructure is caught, with controls.
- [ ] B-1: payments that exist but none converted read "Not converted", never "At least ≈ $0" (U-3b).
- [ ] B-2: the no-arithmetic rule has planted and precision controls.
- [ ] B-3: the `BlockKpi` hash is unedited; the Leak check and Credits suites ran green.
- [ ] B-4: FU-1 is gated by `REACHES_TAKINGS`, with both must-not-catch controls; `ALLOWED` is unchanged.
- [ ] B-5: `origin/main` with 1a was merged in before any code; CI's Build check is green before merge.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| RK-1 | A shared component change leaks into the other two callers | The note renders only when given; the hash test is unedited (CPU-5); the Leak check render suite runs in task 9 |
| RK-2 | The whole-dollar tile and the cents table disagree | Both format the same `totalUsd`, and U-7 asserts the total row equals the headline. The tile's rounding is display only, and "≈" covers it (§6.2) |
| RK-3 | The figure reads as our revenue | It sits under the block's "Not our revenue" chip, with its own note, and never in the strip (CPU-4). U-9 and the 1a leak guard back this up |
| RK-4 | A two-column grid squeezes on a phone | `sm:grid-cols-2`, so the headlines stack below `sm`. QA checks this on a narrow viewport |
| RK-5 | 1a has not landed when 1b starts | Task 1 waits for the merge of `origin/main`; nothing is stacked |
| RK-6 | The FU-1 pattern over-matches a type literal | It requires `:` straight after the closing brace, and it is gated by `REACHES_TAKINGS`. A precision control covers `type X = { usd: number };` |

---

## 11. Open SA questions

| # | Question | Recommended default |
|---|---|---|
| **SA-Q-1B-1** | Where should the two headlines and the table go when `usd` is absent (the Accounts tab, old payloads)? | Render the block **exactly as today**, with one `BlockKpi` and no wrapper, so no existing render test or pin moves. Only a present `usd` adds the headline, the line and the table |
| **SA-Q-1B-2** | Should the note join the group's accessible name? | No. The name stays `"label, value"`, so the existing three callers' names are unchanged. The note is visible text inside the group and is read as its content. Adding it to the name or to `aria-describedby` would change markup for the new caller only, which is acceptable, but it is not needed |
| **SA-Q-1B-3** | The value when there are no client payments: §5.1 says "No client payments in this window" instead of "≈ $0" | The tile value is **"None"** (the `KPI_MRR_NONE` precedent; a long sentence does not fit a `text-2xl` figure), and the block's existing empty message says "No client payments recorded in this window" just below. AC-15's "never ≈ $0" holds |
| **SA-Q-1B-4** | What should the USD row's "Rate used" and date cells show? | "—" for both. US dollars need no rate, so "1.000 per $1" would imply one was looked up |
| **SA-Q-1B-5** | The state words in the table | Stale (warn chip); No rate; Rate off (the Exchange rates tab's word for a disabled currency); Not usable (zero or junk, or an Unknown currency). Each is neutral apart from Stale |
| **SA-Q-1B-6** | Where do the render tests go? `financePage.render.test.tsx` is very large | A **new file**, `clientPaymentsUsd.render.test.tsx`, reusing the page's fixture builders through a small exported fixture helper. If exporting fixtures is a new pattern, fall back to a new describe at the end of `financePage.render.test.tsx` |
| **SA-Q-1B-7** | The Exchange rates link: a constant in `financeCopy.ts`, or in `financeLinks.ts`? | `financeCopy.ts`, `EXCHANGE_RATES_TAB_HREF`, next to `PLANS_PAGE`, which is the in-page-link precedent. `financeLinks.ts` holds links that carry the window and account to *other* pages; its import pin is unaffected either way |
| **SA-Q-1B-8** | Does the "≈ Total" row repeat "At least" when `partial`? | Yes. `atLeast(…, status === 'ok')`, so the table never looks more complete than the headline |
| **SA-Q-1B-9** | Cycle | Full cycle (a shared component and a money block), as SA-RR-CPU SA-Q-10 ruled. The user sees the diff for the copy change (§2.6) |

---

## 11A. Implementation notes (Dev, 2026-10-27)

**Scope change (coordinator, 2026-10-27): CPU1A-FU-1 has moved out of 1b.** The user approved a separate follow-ups bundle, shipped as one commit, that includes the function-parameter destructure pattern; another developer does it there. I had already written it here, and reverted it in full: `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts` is **byte-identical to HEAD** (`git diff` is empty). 1b's own UI needs no change to that guard, because `TakingsSection.tsx` and `financeCopy.ts` were already allowed holders. §2.7, the FU-1 parts of §5 and §6, the FU-1 acceptance box in §9 and B-4 therefore do not apply to this slice.

| # | Note |
|---|---|
| IN-1 | **B-5.** `git fetch`, then `origin/main` was merged into `feature/client-payments-usd-1b` (it fast-forwarded to `b7f02cd6`, the #527 merge). `takings.usd`, `FinanceClientPaymentsUsd` and 1a's leak guard are present. No stash. |
| IN-2 | **The date column uses `formatUtc` ("2026-10-20 09:15 UTC"), not `formatUtcDate`.** `formatUtcDate` takes date-only text and would print "—" for the stored timestamp. The Exchange rates table shows the same column the same way. |
| IN-3 | **`businessesKpi` is typed `ReactNode`** (the folder's convention), not `JSX.Element`. |
| IN-4 | **The fixture helper carries one self-check.** Jest collects every file under `__tests__/`, so `clientPaymentsUsdFixtures.ts` has one self-check `describe`, as its precedents `financeRequestPins.ts` and `chargeChecksRequestPins.ts` do. It is still a plain module, never a `*.test.tsx`, and imports no test file (SA-Q-1B-6). |
| IN-5 | **B-2's no-arithmetic rule** lives in the new render test file. It scans `TakingsSection.tsx`, `BlockKpi.tsx` and `financeFormat.ts`, with 5 planted and 7 precision controls. |
| IN-6 | **Render tests run at the block level** (`TakingsSection`), not through `FinanceView`. The strip's independence (U-9, AC-19) is proven by Pin B unedited and by the 1a leak guard, which fails any strip file naming the section. |
| IN-7 | **Pins.** `BlockKpi.render.test.tsx` gets two appended cases, and its hash case and constant are unedited and green. `financePage.render.test.tsx`, Pin A, Pin B, Pin C, Pin D, AC-173, AC-145 and `exchangeRatesTab.render.test.tsx` have **no diff**. |

---

## 12. SA Review Notes

### SA Workplan Review (SA-WP-CPU1B)

**Reviewed by SA — 2026-10-27** (against SA-RR-CPU and SA-WP-CPU1A / SA-CR-CPU1A; the code read here and in `neuronforge-cpu1a`)
**Status:** ✅ Approved with conditions (B-1 to B-5).

**Fit**
- The design does what SA-RR-CPU asked: an optional `note` on `BlockKpi`, the stale chip in words, and the link beside the chip rather than on it.
- **No pin moves.** A `usd`-free block renders exactly as today, so the existing takings render tests, Pin B and the `BlockKpi` hash all stay unedited.
- **No server, lib or migration change.**
- **EX-3:** the tile carries "≈" and the line under it says "Converted at admin rates".
- **CPU-4:** the figure stays inside the "Not our revenue" block and never reaches the strip.
- **Importing `roundRateForDisplay`:** formatting a rate string the server sent is display, not reading a rate. `exchangeRateRules.ts` is pure, and its import path does not contain `exchange_rates`, so CUR-3 holds.

**Rulings on §11**

| # | Ruling |
|---|---|
| SA-Q-1B-1 | **Accept.** With no `usd`, the block is today's block byte for byte (U-12). |
| SA-Q-1B-2 | **Accept.** The accessible name stays `"label, value"`. The note is content inside the group. |
| SA-Q-1B-3 | **Accept "None" when there are no payments.** This follows the `KPI_MRR_NONE` precedent, and the block's existing empty message sits right below. **Add one case (B-1).** |
| SA-Q-1B-4 | **Accept "—"** for the USD row's rate and date. |
| SA-Q-1B-5 | **Accept the four words.** "Rate off" matches the Exchange rates tab's own term. Only Stale is a warn chip. |
| SA-Q-1B-6 | **A new file, `clientPaymentsUsd.render.test.tsx`, accepted, but it never imports from a `*.test.tsx` file.** Importing a test file runs its suites. Put its payload builder in a plain helper module in the same `__tests__` folder; `chargeChecksRequestPins.ts` and `financeRequestPins.ts` are the precedent. Do not edit `financePage.render.test.tsx`'s fixtures. If the helper turns out to need most of that file's builders, fall back to a new describe at the end of `financePage.render.test.tsx`, which needs no ruling. |
| SA-Q-1B-7 | **Accept** `EXCHANGE_RATES_TAB_HREF` in `financeCopy.ts`, next to `PLANS_PAGE`. |
| SA-Q-1B-8 | **Accept.** The "≈ Total" row repeats "At least" whenever the headline does. |
| SA-Q-1B-9 | **Full cycle, as ruled.** The user sees the diff, including the tab sentence (§2.6), before RM. |

**Conditions**
1. **B-1: nothing converted, but payments exist.** If `converted.payments === 0` and `notConverted.payments > 0` (for example, only EUR payments and no EUR rate), §2.3 would print "At least ≈ $0". That is true, but it reads as if there were no money. In this case the value is `CLIENT_PAYMENTS_USD.notConverted` ("Not converted"), and the line explains why: no rate, or the rates read failed. Add it to §2.3 as a test case (U-3b).
2. **B-2: the no-arithmetic rule (§5).** Give it a precision control as well as the planted one. JSX such as `{usd.totalUsd}</span>` and an optional chain such as `usd?.totalUsd ?? null` must not trip it. Only an operator directly on the field may.
3. **B-3: CPU-5.** The `BlockKpi` hash case passes unedited, with no change to its file other than appended cases. The Leak check (AI cost) and Credits render suites run in task 9 as proof that the other two callers did not change.
4. **B-4: FU-1.** The new pattern stays gated by `REACHES_TAKINGS`. Both must-not-catch controls (another type's parameter, a type literal) are in the suite. `ALLOWED` is unchanged.
5. **B-5: build and order.** Merge origin/main, including 1a, before any code is written (task 1), and confirm `takings.usd` is present. The `npm run build` proof is CI's required Build check, as in 1a, and the PR does not merge until it is green.

**Business questions:** none. "None" against §5.1's sentence, and "Not converted" (B-1), are presentation rulings within §5.1 and AC-15. **For the user, information only:** they will see the Exchange rates tab's sentence change in the diff: "They convert one admin figure only: the approximate-dollar total of client payments on Finance."

### Approval
[x] Workplan approved with conditions B-1 to B-5. Proceed after origin/main (with 1a) is merged in.

### SA Code Review (SA-CR-CPU1B)

**Code Review by SA — 2026-10-27** (uncommitted tree on `b7f02cd6`, 1a merged)
**Status:** ✅ Code Approved

**What I read**
- The diffs of `BlockKpi.tsx`, `TakingsSection.tsx`, `financeFormat.ts` and `ExchangeRatesView.tsx`.
- §11A, IN-1 to IN-7.

**Conditions met**
- **B-1:** `usdHeadline` gives Unknown, "None" (no payments) or "Not converted" (payments exist but none converted). It never prints "≈ $0" or "At least ≈ $0". The "≈ Total" row follows the same rules and repeats "At least" whenever the headline says it (SA-Q-1B-8).
- **B-2:** the no-arithmetic rule has 5 planted and 7 precision controls. The page only formats server numbers (`formatApproxWholeDollars` and `formatApproxDollars` wrap the existing private `dollars`), so R-9 holds.
- **B-3:** `{note && …}` renders nothing for the three existing callers. The hash case is unedited (its diff removes no lines), and the Leak check (36/36) and Credits (28/28) suites pass.
- **B-4:** superseded by SA-WP-FU. The leak guard is byte-identical in 1b, and CPU1A-FU-1 now lives in the follow-ups bundle.
- **B-5:** origin/main with 1a was merged in first. CI's required Build check is the build proof.

**Other checks**
- **EX-3:** every converted amount starts with "≈", and the line under the headlines says "Converted at admin rates".
- **R-10:** no "USD " money string.
- **CPU-4:** the figure sits inside the "Not our revenue" block, never in the strip.
- **Rate display:** `roundRateForDisplay` comes from the pure `exchangeRateRules.ts`, which the Exchange rates components already import. The import path does not contain `exchange_rates`, so CUR-3 holds.
- **Stale chip:** words only, warn tone, and not a link. The Exchange rates link sits in the line and in the footer (SA-Q-5).
- **Contrast:** slate-400 and purple-300 only.
- **Hygiene:** no `console.*`. No pin file has a diff.

**Rulings on IN-1 to IN-7**

| # | Ruling |
|---|---|
| IN-1 | Accepted (B-5 done). |
| **IN-2** (the "Rate last updated" date column) | **Accepted.** Use `formatUtc` ("2026-10-20 09:15 UTC"). It handles null and invalid values as "—", and it matches the Exchange rates table, which is where the admin goes to fix the rate. `formatUtcDate` would print "—" for a timestamp. The requirement's "2026-10-20" was an example, not a format rule. |
| IN-3 | Accepted. `ReactNode` is the folder's convention. |
| IN-4 | **Accepted.** A plain helper module with one self-check `describe`, following the `financeRequestPins.ts` / `chargeChecksRequestPins.ts` precedent. It imports no test file (SA-Q-1B-6). |
| IN-5 | Accepted. |
| **IN-6** (render tests at block level) | **Accepted.** The new behaviour lives entirely in `TakingsSection`, and `FinanceView` passes `takings` whole. AC-19 (the strip is unchanged) is proven more strongly by Pin B passing **unedited** and by 1a's leak guard failing any strip file that names the section than by a whole-page render. AC-18 is covered at block level by rendering the same fixture with and without `usd`. |
| IN-7 | Accepted. No pin moved. |

### Code Review Comments
None that block.

### Optimisation Suggestions
- `unreadableOn` runs a `find` over the lines for each row. A block has a handful of currencies, so leave it as it is.

**For the user (diff review):** the Exchange rates tab sentence now reads "Rates an admin keeps by hand, in units of each currency per 1 USD. They convert one admin figure only: the approximate-dollar total of client payments on Finance." The header comment says the same.

### Code Approved for QA: Yes

---

## 13. QA Testing Report

### QA — CPU-1b, 2026-10-27

**Worktree:** `neuronforge-cpu1b`, branch `feature/client-payments-usd-1b` on `b7f02cd6` (1a merged), uncommitted. The source has been stable since 11:06, before every run below.

| Field | Value |
|---|---|
| **Test mode** | full |
| **Focus** | ui |
| **Skipped** | the live page (user, AC-21 below) |
| **Input source** | the coordinator's list, requirement AC-13 to AC-21, workplan §2, §3, §11A and §12 (B-1 to B-5) |

**Strategy used:**
- **A + B.** The verify list and the named suites, each run alone. Four suites failed under machine load: another session was running a full `tsc` (CPU at 100%). All four passed alone; see the run table.
- **A code read** of `TakingsSection.tsx`, `BlockKpi.tsx`, `financeFormat.ts` and the tab copy.
- **A temporary, untracked probe, deleted afterwards.** `git status` shows only Dev's files; nothing is kept as a permanent test. It covered:
  - **(1) End to end.** Real payment rows go through `buildTakings`, then the **real 1a converter** (`buildClientPaymentsUsd`), then the rendered `TakingsSection`.
  - **(2) Edge headlines.**
  - **(3) A byte-level baseline.** The block without `usd`, rendered by this branch, against **main's own** `TakingsSection` + `BlockKpi` (extracted from `git show HEAD:`).
  - **(4) Junk rate text.**
- **A scoped tsc with a canary**, and `typecheck:bos-llm` at 8 GB.

**Verdict: PASS.** Two Low findings: B-1 is recommended before commit, and L-1 is optional.

#### 1. The headline "Client payments processed"

| Item | Result | Evidence |
|---|---|---|
| "≈ $X" in whole dollars, the note, the Lagging pill and its tooltip | ✅ | **Probe, end to end:** the server total is $25,012.83. The tile reads "**At least ≈ $25,013**" (partial: one EUR payment has no rate, and an XXX rate is 0). The note reads "Our customers' revenue, not ours". The pill is "Lagging", and its tooltip is the §5.3 line 1 word for word plus "Lagging indicator: it tells you what already happened". The accessible name is "Client payments processed, At least ≈ $…" |
| "At least ≈ $X" on partial; "Not converted" when payments exist but none converted (B-1 / U-3b); "None" with no payments; "Unknown" on a failed read | ✅ | **Probe:** EUR only with no rate gives "**Not converted**", with the line "…plus 1 payment in other currencies, not converted (no rate)". EUR only with the rates read failed gives "**Not converted**", with the line "Exchange rates could not be read; 1 payment in other currencies not converted". Dev's U-cases cover "None" and Unknown (green) |
| **Never "≈ $0" or "At least ≈ $0"** | ⚠️ **B-1 (Low)** | Holds for no data and for nothing converted. **But a real, converted total under $0.50 still prints it.** See Issues |
| The amber "Uses a stale rate" chip is words only, not a link, with the Exchange rates link beside it | ✅ | **Probe:** the chip text has no `<a>` ancestor (GBP rate updated 2026-09-01 gives `stale: true`). The line under the headlines always ends with the "Exchange rates" link |
| "Businesses taking client payments" unchanged; the two tiles stack on mobile | ✅ | The wrapper is `grid gap-3 sm:grid-cols-2`: one column below `sm`, two from `sm` up. The businesses `BlockKpi` element is the same as before (same props); the baseline below confirms it |

#### 2. The line under the headlines

| Item | Result | Evidence |
|---|---|---|
| Counts, the not-converted note, the rates-failed note | ✅ | **Probe, end to end:** "Converted at admin rates · 6 payments in 3 currencies · plus 2 payments in other currencies, not converted (no rate) · Exchange rates". These are exactly the server's `converted {6, 3}` and `notConverted {2}` (EUR no rate, XXX unusable). The rates-failed wording is shown above. Nothing is counted on the page |
| The link goes to `/admin/finance?tab=exchange-rates` | ✅ | `takings-usd-rates-link` href is exact. It appears in the footer too |

#### 3. The "Converted to $" table

The probe rendered these rows from the converter's output:

| Row | Payments | Paid | Rate used | Rate last updated | ≈ In US dollars |
|---|---|---|---|---|---|
| EUR | 1 | EUR 100.00 | — | — **No rate** | Not converted |
| GBP | 1 | GBP 250.00 | **0.787 per $1** (0.786543) | 2026-09-01 00:00 UTC **Stale** | ≈ $317.85 |
| ILS | 3 | ILS 45,618.50 | **3.700 per $1** | 2026-10-20 09:15 UTC | ≈ $12,329.32 |
| USD | 2 | $12,365.66 | **—** | **—** | ≈ $12,365.66 |
| XXX (rate `0`) | 1 | XXX 5.00 | 0.000 per $1 | 2026-10-20 09:15 UTC **Not usable** | Not converted |

| Check | Result | Evidence |
|---|---|---|
| Per-currency rows, rate rounding to 3 places | ✅ | `roundRateForDisplay` gives 0.786543 → 0.787 and 3.700000 → 3.700 |
| USD shows "—" | ✅ | For both the rate and the date (SA-Q-1B-4) |
| Date via `formatUtc` | ✅ | IN-2 |
| State chips | ✅ | Stale is warn; No rate, Rate off and Not usable are neutral (Dev's cases cover Rate off) |
| "≈ Total" equals the headline to the cent, with "At least" | ✅ | The total row reads "**At least ≈ $25,012.83**". The headline is the same figure in whole dollars. Every amount and the total are the server's numbers formatted, never re-added |
| Junk rate text on a not-usable row | ⚠️ **L-1 (Low)** | See Issues |

#### 4. Without `takings.usd` (Accounts tab, old payloads)

✅ **Byte-for-byte.** The probe rendered the block without `usd` on this branch and with **main's** `TakingsSection` and `BlockKpi` (from `git show HEAD:`). The `innerHTML` is **identical** once React's `useId` counters (`:rc:` / `:rd:`) are normalised; those differ only because both renders share one test. The comparison covered a full block, more than 500 characters. In addition, `financePage.render.test.tsx` has no diff and is green.

#### 5. No arithmetic on the page

✅ The headline, the rows and the total all come from `usd.totalUsd` / `row.usd` through `formatApproxWholeDollars` / `formatApproxDollars` (formatting only). The counts come from `usd.converted` / `usd.notConverted`. B-2's no-arithmetic rule is in `clientPaymentsUsd.render.test.tsx` (5 planted and 7 precision controls) and is green.

**The end-to-end cross-check:**
- the converter's ILS `12329.32`, GBP `317.85`, USD `12365.66` and total `25012.83` render as "≈ $12,329.32", "≈ $317.85", "≈ $12,365.66" and "At least ≈ $25,012.83";
- the whole-dollar headline equals `Intl` formatting of the same server number;
- no "USD " followed by a digit appears anywhere in the block.

#### 6. The Exchange rates tab sentence

✅ `EXCHANGE_RATES_PURPOSE` now reads "Rates an admin keeps by hand, in units of each currency per 1 USD. They convert one admin figure only: the approximate-dollar total of client payments on Finance.", exactly §2.6. "**per 1 USD**" is kept, and the header comment matches. `exchangeRatesTab.render.test.tsx` has no diff and is green (it asserts through the constant).

#### 7. Pins and guards

| Item | Result |
|---|---|
| `BlockKpi` hash `99c6969c…` | ✅ The constant is unedited. `BlockKpi.render.test.tsx`'s diff **removes 0 lines** (appended cases only), and the hash case is green |
| Pin A / B / C / D, AC-173 | ✅ `a130d560` / `a1b3db0c` / `e57f2675`, `64a565e9` / `1f7cf07a`, and `3a1a2dd4` / `b84e0c96`. No diff |
| AC-145 | ✅ No diff under `app/api` or `lib`, so there is no server change |
| `financePage.render.test.tsx`, `exchangeRatesTab.render.test.tsx`, the 1a leak guard | ✅ No diff (`git diff --quiet HEAD`). The leak guard is byte-identical; FU-1 moved to the follow-ups bundle (§11A) |
| Contrast | ✅ The added classes are `text-slate-400`, `text-purple-300` and `hover:text-purple-200` only, with no slate-500. The contrast guard (in `app/admin/__tests__`) is green |

#### Suite runs (each alone)

| Suite | Result |
|---|---|
| `app/admin/finance` + `app/admin/components/layout` | 50 suites, 1,822 tests: 1,819 passed, 3 failed **under load**. `chargeChecksRequest.pin` and `exchangeRatesTab` (74 s) failed in this run but **passed alone, 11/11 and 20/20** |
| `app/admin/__tests__` + `app/admin/business-os-llm` | 34 suites, 1,526 tests: 1,523 passed, 3 failed **under load**. `jobsQueues.drain` (143 s) and `jobsQueues.items` (167 s) failed in this run but **passed alone, 21/21 and 25/25**. Neither is touched by 1b |
| `lib/admin/exchangeRates` + `lib/business-os/finance` + `app/admin/exchange-rates` | 37/37, **2,973/2,973** |
| **Leak check** (`leakPanel.render`, BlockKpi caller 2) | **36/36** |
| **Credits** block render cases (BlockKpi caller 3) | **19/19** |
| `npm run test:authz-guard` | 203/203 |
| `npm run test:bos-entitlements` | 313/313, **9,399/9,399** |
| `npm run lint:hooks` | exit 0 |
| `typecheck:bos-llm` (8 GB) | **passed: 592 files in scope, 11 errors, 0 new**; exit 0, with **no OOM trace** |
| Scoped tsc (250 files: `app/admin/finance`, `app/admin/components/layout`, `app/admin/exchange-rates`) | Canary `TakingsSection.tsx(531,7) TS2322`. Restored with `cp`; `cmp` identical. Clean run: **exit 0, 0 errors** |

#### Issues Found

##### Bugs

**B-1 (Low; recommended before commit): a real total under $0.50 prints "≈ $0" or "At least ≈ $0".**

- **File:** `TakingsSection.tsx`, `usdHeadline`.
- **Cause:** the rule special-cases no payments ("None") and nothing converted ("Not converted"). A *converted* total that rounds to zero whole dollars still goes through `formatApproxWholeDollars`.
- **Probe results:**

| Case | Headline | Total row |
|---|---|---|
| One USD payment of $0.30 | **"≈ $0"** | "≈ $0.30" |
| One $0.00 succeeded payment | **"≈ $0"** | — |
| $0.30 USD plus EUR 100 with no rate | **"At least ≈ $0"** | — |

- **Why it matters:** the coordinator's list says the tile never shows either string. B-1 / SA-WP-CPU1B ruled out "At least ≈ $0" because it "reads as if there were no money". The last case is exactly that: EUR 100 is waiting for a rate.
- **How rare:** it needs a window whose converted total is under 50 cents.
- **Suggested fix:** when `0 < totalUsd < 0.5` (or `< 1`), print the headline to the cent, "≈ $0.30" / "At least ≈ $0.30", through `formatApproxDollars`. Pick the text for a converted total of exactly 0 (for example "≈ $0.00"). Add the three cases above as tests.

**Fixed by Dev (2026-10-27):** in `usdHeadline`, a converted total **under $1** is now printed to the cent through `formatApproxDollars`; from $1 up the tile stays in whole dollars.
- **Decision on $0.00:** a converted total of exactly zero reads **"≈ $0.00"**, never "None". "None" means there were no client payments, and here there were. Showing the cents keeps it from reading "as if there were no money", which is the intent of SA-WP-CPU1B B-1.
- **Tests:** QA's three cases.
  - $0.30 USD → "≈ $0.30", with the total row the same.
  - A $0.00 payment → exactly "≈ $0.00", not "None".
  - $0.30 USD plus EUR 100 with no rate → exactly "At least ≈ $0.30", with the no-rate note, and the total row the same.
- Plus a $1.00 case that stays "≈ $1".
- B-2's no-arithmetic rule still passes (the new comparison `< 1` is not arithmetic).

##### Edge cases (nice to fix)

**L-1 (Low): junk rate text is shown raw on a "Not usable" row.**

- **What happens:** for a rate the converter refuses (`unusable`), the "Rate used" cell prints the stored text through `roundRateForDisplay`, which returns non-decimal input unchanged. Probe results:

| Stored rate | Cell |
|---|---|
| `abc` | "abc per $1" |
| (empty) | " per $1" |
| `-3.7` | "-3.7 per $1" |
| `3.7e2` | "3.7e2 per $1" |
| `NaN` | "NaN per $1" |
| `0` | "0.000 per $1" |

- **Impact:** nothing crashes, and the "Not usable" chip sits beside the value. The Exchange rates editor validates rates, so this needs bad data.
- **Suggested fix:** print "—" in "Rate used" whenever `row.state === 'unusable'`.

**Fixed by Dev (2026-10-27):** `rateCell` returns "—" whenever `row.state === 'unusable'`, so the stored text is never printed. The "Not usable" chip still explains the row. **Tests:** QA's six stored values (`abc`, empty, `-3.7`, `3.7e2`, `NaN`, `0`) each give a "Rate used" cell of exactly "—", with no "per $1" in the row.

##### Performance

None. The page adds no request and no read.

#### User browser steps (AC-21, signed in as an admin)

1. **Finance → Overview**, Client payments block, on a **USD-only** window: two headlines side by side (stacked on a phone).
   - "Businesses taking client payments" is unchanged.
   - "Client payments processed" reads "≈ $X" in whole dollars, with "Our customers' revenue, not ours" under it and a grey **Lagging** pill.
   - The line reads "Converted at admin rates · n payments in m currencies · Exchange rates".
   - The "Converted to $" table has a USD row with "—" for the rate and the date, and a "≈ Total" row.
2. A **mixed-currency** window (for example ILS + USD): the ILS row shows "3.700 per $1", its update time and "≈ $…". The ≈ Total equals the headline, to the cent.
3. A window with a **missing rate** (switch a currency off on the Exchange rates tab):
   - the headline reads "At least ≈ $…";
   - the line says "plus n payments in other currencies, not converted (no rate)";
   - the row shows "Not converted" with a "No rate" or "Rate off" chip.
4. A **stale rate** (a currency not updated for more than 35 days): an amber "Uses a stale rate" chip shows on the figure, as plain text. The **Exchange rates** link on the line below opens `/admin/finance?tab=exchange-rates`. There, the purpose line reads "…They convert one admin figure only: the approximate-dollar total of client payments on Finance."
5. On the **Accounts** tab, or with a business picked, the Client payments block looks exactly as before.

#### Final Status

- [x] **All 1b acceptance criteria verified: AC-13 to AC-20, with AC-21 owed to the user (steps above).**
  - The end-to-end check from the real converter to the rendered text matches.
  - The no-`usd` block is byte-identical to main.
  - No pin moved, and every guard, suite, typecheck and tsc is green (the load failures pass alone).
  - **PASS, ready for RM.** B-1 (Low) is a two-line fix recommended before commit; L-1 is optional.
- [ ] Issues found

---

## 14. Commit Info

*(RM populates.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-27 | Created | Dev workplan for slice 1b (UI). Step 0 facts F-1 to F-17; `BlockKpi` note (CPU-5), two headlines only when `usd` is present (no existing pin moves), the "Converted to $" table, tab copy (SA-Q-1A-8), FU-1. Nine open SA questions with defaults. No code written |
| 2026-10-27 | SA workplan review (SA-WP-CPU1B) | Approved with conditions B-1 to B-5. SA-Q-1B-1 to 9 defaults accepted; Q-6 as a new test file using a plain `__tests__` helper module, never an import from a test file. B-1: "Not converted" when payments exist but none converted (never "At least ≈ $0"). B-2: precision controls on the no-arithmetic rule. No business questions; the tab sentence is shown to the user in the diff |
| 2026-10-27 | SA conditions folded in (append only) | SA-WP-CPU1B approved with B-1 to B-5. Amendments appended to §2.3 (B-1, "Not converted"), §5 (B-2 precision controls, B-4 gating), §6 (SA-Q-1B-6 helper module), §7 (B-5 wait, then merge origin/main with 1a; B-3 suites), §8.2 (U-3b) and §9. Slice 0 merged (#526). Code waits for 1a's merge |
| 2026-10-27 | Implemented; FU-1 moved out | Built per §2 with B-1, B-2, B-3 and B-5; `origin/main` with 1a merged in first. CPU1A-FU-1 reverted and moved to the user-approved follow-ups bundle (the leak guard is unchanged in 1b). Implementation notes IN-1 to IN-7 (§11A). Uncommitted |
| 2026-10-27 | SA code review (SA-CR-CPU1B) | Code approved for QA. B-1, B-2, B-3 and B-5 met; B-4 superseded by SA-WP-FU (leak guard byte-identical). IN-1 to IN-7 accepted, including the date-and-time column via `formatUtc` and block-level render tests (the strip is proven by Pin B unedited and the 1a leak guard). No pin moved. Tab sentence shown to the user in the diff |
| 2026-10-27 | QA Low findings fixed | QA B-1: a converted total under $1 is shown to the cent ("≈ $0.30"); exactly zero converted reads "≈ $0.00" (decision recorded). QA L-1: "Not usable" rows show "—" for the rate. Tests added for both; uncommitted |
