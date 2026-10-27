# Requirement: Client Payments in Approximate US Dollars (Admin Finance)

> **Last Updated**: 2026-10-26

**Created by:** BA
**Date:** 2026-10-26
**Status:** **Business decisions taken; ready for SA review.** The user asked for the conversion exception on 2026-10-26 (§2) and answered BQ-1 to BQ-5 the same day (§9, D-1 to D-5). SA requirement review done: approved with conditions (SA-RR-CPU, below). Slice 0 applied, uncommitted, awaiting the user's CLAUDE.md review (§11). Final status "Approved" needs user or TL sign-off.
**Related:** [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md) (cited as **XR**; D-2, D-4, D-5, R-3, §5.4, slices 3 and 4), [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) (cited as **MK**; §3.1 to §3.4, LL-1 to LL-5, USD-1 to USD-6, Q-10), [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) (cited as **FIN**; BD-1, BD-12, BD-13, BD-45, BD-47, BD-50, BD-55, CUR-3), [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) (cited as **LAY**).

## Overview

The Finance page shows what our customers' clients paid them through AgentPilot ("Client payments"), but only one currency at a time: US-dollar payments in `$`, and every other currency on its own line, never added up. So nobody can see, in one number, how much money our customers are processing. This requirement adds **one figure that does**: the total of client payments in the page's window, **converted to approximate US dollars** with the rates an admin keeps on the Exchange rates tab. It counts payments only, takes no refunds off, and says in the figure itself that it is **our customers' revenue, not ours**. It is the first and only place in the platform allowed to convert money, and that exception is kept deliberately narrow (§2).

---

## Table of Contents

1. [The user's request and what it decides](#1-the-users-request-and-what-it-decides)
2. [The exception to "never sum money across currencies"](#2-the-exception-to-never-sum-money-across-currencies)
3. [What exists today (verified)](#3-what-exists-today-verified)
4. [User stories](#4-user-stories)
5. [The new figure](#5-the-new-figure)
6. [The conversion rule](#6-the-conversion-rule)
7. [Page, KPI, breakdown, drawer](#7-page-kpi-breakdown-drawer)
8. [Rules that must still hold](#8-rules-that-must-still-hold)
9. [Business questions and the user's decisions](#9-business-questions-and-the-users-decisions)
10. [Technical questions for SA](#10-technical-questions-for-sa)
11. [Slices](#11-slices)
12. [Acceptance criteria](#12-acceptance-criteria)
13. [Out of scope / future roadmap](#13-out-of-scope--future-roadmap)
14. [Notes on integration points](#14-notes-on-integration-points)
15. [Change History](#change-history)

---

## 1. The user's request and what it decides

User, 2026-10-26, verbatim, answering the TL's offer ("The Exchange rates tab holds manual rates, but nothing converts these totals with them yet. That's the parked exchange-rates slice for a USD view. If you want it, I can scope a slice that converts client payments to `$` using those rates."):

> "yes, scope the USD conversion slice for client payments, using the exchange rate page. have another tile that shows the total amount of revenue our customers are processing from their clients. include only payment (no refund), indicate in a small note it is our customers revenue only in the tile."

| # | What the user decided | Consequence |
|---|---|---|
| U-1 | **Convert client payments to `$`** with the Exchange rates tab's rates | The user's **explicit exception** to the no-conversion rule (CLAUDE.md, FIN BD-12, XR D-5), for client payments only (§2). XR slice 4 ("Conversion / USD view", parked) is unparked for this one figure |
| U-2 | **Another tile** with the total our customers are processing from their clients | One new figure, placed in the Client payments block (D-1) |
| U-3 | **Payments only, no refunds** | Refunds are neither subtracted nor shown in this figure. Payments later refunded still count (D-3) |
| U-4 | **A small note in the tile** that it is our customers' revenue only | Fixed copy in the tile: "Our customers' revenue, not ours" (§5.1) |

---

## 2. The exception to "never sum money across currencies"

### 2.1 What the exception allows, and nothing more

**The user asked for this exception on 2026-10-26** (§1, U-1): the request itself is their explicit exception to "never sum money across currencies", limited to the six conditions below. If any one is not true, the old rule applies.

| # | Condition |
|---|---|
| EX-1 | **Client payments only.** Money our customers' clients paid them (layer B). Our own money (plans, boosts, MRR, AI cost, margin) is never converted; it is US dollars already (MK §3.4) |
| EX-2 | **Admin only.** Shown on the admin Finance page. Never on a Business OS screen, in a business's chat answer, report, export or e-mail (XR D-3) |
| EX-3 | **Labelled as converted.** Every converted amount carries "≈" and the words "converted at admin rates" |
| EX-4 | **Never stored.** Worked out each time the page is read. Not written to any table, snapshot, export, audit entry or log |
| EX-5 | **Never charged.** No price, invoice, credit, payment or fee is ever computed from it |
| EX-6 | **Never added to our own revenue** (FIN BD-1). It never sits inside, beside as a sum with, or as a part of any figure about our money |

### 2.2 Wording changes (applied in slice 0)

The exception is decided (§2.1). The wording below records it in each document; slice 0 applies it. CLAUDE.md is the user's file, so the user sees that diff before it merges.

**CLAUDE.md, Currency & Timezone table, row "Never sum money across currencies", the "Why" cell.** Today:

> An admin-maintained `exchange_rates` table exists, but no figure may be converted or summed with it. Group by currency (`revenue_by_currency`) and label with `primary_currency`

Proposed:

> An admin-maintained `exchange_rates` table exists, but no figure may be converted or summed with it — **one exception:** the admin Finance page's approximate-dollar total of client payments ([ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md](/docs/requirements/ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md)), labelled as converted, worked out on read, never stored, never charged, never added to our revenue. Everywhere else, group by currency (`revenue_by_currency`) and label with `primary_currency`

(It names a pointer, not a status or a count, so it respects CLAUDE.md's own "maintaining this file" rule.) As applied in slice 0, the text also names the limit explicitly: "…client payments ([…](…)), limited to that doc's conditions EX-1 to EX-6: labelled as converted, …".

**FIN, new decision BD-56** (amends BD-12 for client payments only; BD-12 itself stays). Wording as applied in slice 0, per SA-RR-CPU CPU-7 (BD-50 is not amended; of BD-45, BD-47 and BD-50 only the first two forbid conversion):

> **BD-56** | User message 2026-10-26 (amends BD-12, BD-45, BD-47 and MK USD-2 / USD-5 for one figure only; BD-50 is **not** amended) | **Client payments may be shown as one approximate US-dollar total**, converted with the admin Exchange rates (user, verbatim in [ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md](/docs/requirements/ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md) §1). Conditions EX-1 to EX-6 of that requirement apply. BD-1 is unchanged: the figure is never added to our revenue. Every other figure keeps BD-12, BD-45 and BD-47: per currency, no conversion. BD-50 is unchanged. CUR-3 is unchanged; slice 1a adds positive pins on the one way rates enter Finance (SA-RR-CPU SA-Q-2).

**XR §1 progress row 4** ("Conversion / USD view | Parked (D-5)"): becomes "Scoped 2026-10-26 for client payments only, in ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md; exception recorded as FIN BD-56. Any other conversion stays parked." **XR D-5** gains one line: "Amended 2026-10-26 for client payments only (FIN BD-56)." **XR SQ-42** ruling (CPU-7) gains: "That user decision was taken on 2026-10-26 for client payments only (FIN BD-56)."

**MK §3.4 USD-5** ("A KPI tile never shows an other currencies figure as part of its value") gains, per CPU-7: "Exception: the client payments approximate-dollar figure (BD-56), a block KPI, not a strip tile: each currency is converted at the admin rate and the converted amounts are added, shown with ≈."

---

## 3. What exists today (verified)

Read on 2026-10-26 from the worktree `neuronforge-finance-mk8b` (a recent `main`).

| Fact | Where |
|---|---|
| The Client payments block ("Client payments (the businesses' money, not ours)") is the last block of Finance → Overview, with a "Not our revenue" chip. Its block KPI is **Businesses taking client payments** (a count, leading). Below: a per-currency table (Payments, Gross, Refunded, Net, Businesses), Refunds, Recorded processor fees by fee currency, Payments by processor, Per business and currency, and "client payment problems" | `app/admin/finance/components/TakingsSection.tsx` |
| The figures are built by a pure builder on the server: a payment **counts** when its stored status is exactly `succeeded` or `refunded`; any other status is counted only as "another status". A refund counts when its status is `succeeded`. Sums are exact integer hundredths **per currency**; nothing adds two currencies | `lib/business-os/finance/takings.ts` |
| **Gross includes payments later refunded** (status `refunded`); refunds are a separate figure and Net = Gross − Refunded, shown only when exact | same |
| **Fees are never deducted.** They are grouped by the fee's own currency, and only some payments have a fee recorded | same |
| Platform and deleted accounts' payments are included in the per-currency lines (rows mark "Platform" or an unknown business). Test and real payments are counted together (FIN BD-13) | same; FIN BD-13 |
| Reads: client payments **paid in the window** (`listClientPaymentsAllAccountsPaidInRange`, `…ForAccount…`) from `payment_transactions`, refunds **created in the window** from `payment_refunds`. Every read keyset-pages at 1,000 rows and stops at a ceiling, then the page says "At least" | `lib/repositories/BusinessOsFinanceReadRepository.ts` (R-e, R-f) |
| Layer B (client payments) has **no Stripe mode** at all (BD-13); only our own billing status is mode-aware, decided in `lib/admin/billing` (BD-41) | repository header; FIN BD-41 |
| Rates: `exchange_rates.rate_to_usd` is **units of the currency per 1 US dollar** (so dollars = amount ÷ rate), a `numeric(12,6)` read as text, never through a JS number. USD is fixed at 1. Enabled today: USD, ILS, EUR, GBP | XR §2.1; `lib/admin/exchangeRates/exchangeRateRules.ts`; `lib/repositories/ExchangeRatesRepository.ts` |
| Stale rule: a rate not updated for more than **35 days** is stale (USD never) | `exchangeRateRules.ts` (`STALE_AFTER_DAYS`, `isRateStale`) |
| Exact decimal division exists (BigInt, round half away from zero) for the rate sync; its header says nothing there converts money (D-5) | `lib/admin/exchangeRates/rateMath.ts` (`divideHalfUp`) |
| Every rate change is recorded in `exchange_rate_history` (old rate, new rate, time) by a live trigger, so the rate in force on any past date can be recovered (XR §5.4). No month-end table exists (XR slice 3, parked) | XR §2.1, §5.4 |
| `ExchangeRatesRepository`'s **only permitted caller** is `app/api/admin/exchange-rates/**` (its header) | repository header |
| **Guard CUR-3** fails any finance file (the finance lib, the finance route, the finance read repository, every file under `app/admin/finance`) whose code contains `exchange_rates`. Other finance guards: page files may not add or subtract two money fields; no mode wording; `currencyGroups.ts` exports exactly five names; `usdCopy.source.guard` fails a money string printed as "USD " | `lib/business-os/finance/__tests__/finance.source.guard.test.ts`; `app/admin/finance/__tests__/usdCopy.source.guard.test.ts` |
| `BlockKpi` shows a label, a value, the leading / lagging pill and an optional chip. It has **no sub-line or note**. It is shared by three callers (Credits, Client payments, the AI cost Leak check) | `app/admin/components/layout/BlockKpi.tsx` |
| The Finance strip holds five tiles, the layout maximum: F-K1 Revenue received, F-K2 MRR now, F-K3 Charged AI cost, F-K4 AI margin, F-K5 Paying accounts % (with "Converted this month" inside). It is the same on every tab | MK §3.1; FIN BD-42 |

---

## 4. User stories

- As a platform admin, I want one approximate dollar figure for all the money our customers took from their clients in the window, so that I can see how much business runs through AgentPilot regardless of currency.
- As a platform admin, I want that figure to say plainly that it is our customers' money, not ours, so that I never mistake it for our revenue.
- As a platform admin, I want to see which rate converted each currency and how old it is, so that I can judge how approximate the figure is and fix a stale rate.
- As a platform admin, I want the figure to say "at least" when some payments could not be converted, so that it is never silently too low.

---

## 5. The new figure

### 5.1 Name and value

| Part | Text (BA proposal; final words in `financeCopy.ts`) |
|---|---|
| Label | **Client payments processed** |
| Value | **≈ $12,346** (whole dollars on the tile; cents in the breakdown, §7.2) |
| Small note (U-4) | **Our customers' revenue, not ours** |
| Second line | "Converted at admin rates · {n} payments in {m} currencies" |
| Lower bound | "At least ≈ $12,346" when any payment in the window could not be converted or read (§6.3) |
| Stale chip (D-5) | Amber "Uses a stale rate" when any rate used is older than 35 days, linking to the Exchange rates tab |
| Nothing in the window | "≈ $0" is never shown; "No client payments in this window" instead |

### 5.2 What counts as a "payment"

| Question | Rule | Source |
|---|---|---|
| Which statuses | The same set the Client payments table already counts as **Gross**: stored status exactly `succeeded` or `refunded`. A payment later refunded **still counts**. Pending, failed, cancelled or any other status never count | `takings.ts`; **D-3** |
| Refunds | **Never subtracted and never shown in this figure** (U-3). The Refunds table below stays as it is | User |
| Fees | **Gross, before processor fees.** Fees are recorded on only some payments and in their own currency | **D-4** |
| Disputes | Not a separate figure in the Client payments block today; a payment counts by its stored status. Nothing new is added for disputes in this slice | `takings.ts` (no dispute input) |
| Which accounts | **The same set as the per-currency table:** every business, platform accounts and deleted accounts included, test and real together (BD-13). This keeps the figure reconcilable line by line with the table above it. Leaving test or internal businesses out is the existing deferral DF-3 | FIN BD-13, DF-3 |
| Which window | **The page's window** (default This month, the same 92-day limit; "Since it started" only with one business picked, FIN BD-26), counted on the date the payment was **paid**, as today | R-e |
| One business picked | The figure narrows to that business, like the rest of the page | FIN M-1 |

### 5.3 Leading or lagging

**Lagging** (LL-1): it tells what already happened, the money our customers took in the window. The block's existing count, "Businesses taking client payments", stays **leading**.

Tooltip (LL-2), two lines, held in one copy constant (LL-4):

1. "What our customers' clients paid them through AgentPilot in this window, before refunds and fees, converted to approximate US dollars at the rates on the Exchange rates tab. Our customers' money, never part of our revenue."
2. "Lagging indicator: it tells you what already happened"

Accessible name (LL-3): "Lagging indicator. What our customers' clients paid them…".

### 5.4 Where it goes (decided: D-1)

**Decided by the user, 2026-10-26: option A.** The figure is a **second headline in the Client payments block**, beside "Businesses taking client payments". The five strip tiles, their order and their links are unchanged.

The options that were offered, kept for the record:

| Option | What | For | Against |
|---|---|---|---|
| **A (chosen)** | **A second headline in the Client payments block**, beside "Businesses taking client payments" | Sits under the block's "Not our revenue" chip, so it can never be read as ours (BD-1). Strip, its order and its links untouched. Smallest change | Lower on the page: the block is the last on Overview |
| B | Swap a strip tile, for example replace F-K4 AI margin | Seen first, on every tab | Puts our customers' money in the row of our own money (against BD-1 and EX-6); loses an approved KPI |
| C | A sixth strip tile | Nothing else changes | Breaks the five-tile maximum of the layout standard; same BD-1 risk as B |
| D | A small second figure inside an existing strip tile | No sixth tile | No strip tile is about client money; inside Revenue received it would read as ours |

---

## 6. The conversion rule

### 6.1 Which rate (decided: D-2)

**Decided by the user, 2026-10-26:** "the rate that is updated in the exchange rate page". That is **option A: the current rate** of each currency as maintained on the Exchange rates tab, read when the page is read, the same rate for every payment in the window. The breakdown shows the rate used and its date.

For the default window (This month) this is exactly what XR D-2's month-end rule would give too, since the month has not ended. For a window spanning past months, older payments are converted at the current rate; the breakdown makes that visible.

The options that were offered, kept for the record:

| Option | What | Status |
|---|---|---|
| **A (chosen)** | The current rate on the Exchange rates tab | Built in slice 1a |
| B | The month-end rate of each payment's month, recovered from the rate history (XR §5.4) | **Parked** (slice 2) |
| C | The rate in force on each payment's day | Not pursued |

XR slice 3 (a stored month-end table) is not needed and stays parked.

### 6.2 How the sum is made

- Per currency, the exact integer sum in that currency's hundredths comes from the existing builder (no new money arithmetic on the page).
- Each currency's subtotal is converted **once** (not payment by payment): dollars = subtotal ÷ rate, in exact decimal arithmetic (the existing BigInt division), rounded half away from zero **to the cent**.
- The converted cents are added into one total. USD converts at 1, so its line is exact.
- **Rounding on screen:** the tile shows whole dollars; the breakdown shows cents. The "≈" covers the rounding.
- Where "rate" is shown, it is shown as stored ("ILS 3.700000 per $1"), rounded for display to 3 decimals as the Exchange rates tab does.

### 6.3 When a rate is missing, unusable or old

| Case | Behaviour | Why |
|---|---|---|
| A currency with **no rate**, a **disabled** rate, an unknown or empty currency code, or a rate that cannot be read | **Not converted and not counted in the dollar total.** The tile says **"At least ≈ $X"** with the note "plus {n} payments in other currencies, not converted (no rate)", linking to the breakdown | Never assume a rate of 1 (XR D-4); never silently low (USD-3's note pattern) |
| The **rates read fails** | The tile shows "At least ≈ $X" where X is the US-dollar payments only, with "Exchange rates could not be read; {n} payments in other currencies not converted" | Still useful, never silently low |
| The **payments read fails** | "Unknown", as the rest of the block | Existing block behaviour |
| The payments read stopped at its **ceiling**, or an amount was unreadable | "At least", as the rest of the block | Existing behaviour (S2-FR-8) |
| A rate is **stale** (not updated for more than 35 days, R-3) | **Still converted**, with an amber chip on the figure "Uses a stale rate" and the currency marked "Stale" in the breakdown, linking to the Exchange rates tab | **D-5** (accepted by default) |

### 6.4 The existing per-currency lines

**They stay exactly as they are.** The Client payments table keeps every currency on its own line, in its own currency, exact and never converted: that remains the true record. The converted figure sits alongside it as an approximation, never in place of it. The business drawer keeps the business's own currency (BD-50).

---

## 7. Page, KPI, breakdown, drawer

In the user's four-part format (MK §3.2).

### 7.1 Summary

| Page / tab | KPI: what we track, leading or lagging | Breakdown on this page, and what we expect to learn | Side drawer |
|---|---|---|---|
| **Finance → Overview, Client payments block** | **Businesses taking client payments** (count, leading; unchanged) and **Client payments processed** (≈ $, lagging; new), side by side as the block's two headlines | Existing per-currency, refunds, fees, processor and per-business tables, unchanged; **plus a new small table "Converted to $"** (§7.2). *Learn:* how much money our customers run through us in total, which currencies it comes in, and how much the total depends on each rate | **Business drawer:** unchanged, the business's own currency (BD-50). No converted line (§7.3) |

### 7.2 The "Converted to $" breakdown

A small table directly under the two headlines, one row per currency counted:

| Column | Example |
|---|---|
| Currency | ILS |
| Payments | 42 |
| Paid, in that currency | ILS 45,230.00 |
| Rate used | 3.700 per $1 |
| Rate last updated | 2026-10-20 (or "Stale" chip, or "No rate") |
| ≈ In US dollars | ≈ $12,224.32 (or "Not converted") |

A last row, **"≈ Total"**, equals the tile's value (in cents). Under the table, one line: "Approximate. Converted at the admin rates on the Exchange rates tab; never part of our revenue." with a link to the Exchange rates tab.

### 7.3 Drawer

**No converted line in the business drawer.** One business normally takes one currency, and its own-currency figure is exact. A drawer line is slice 3: optional and not scheduled (§11).

---

## 8. Rules that must still hold

| # | Rule | How it holds |
|---|---|---|
| R-1 | **Never added to our revenue** (BD-1, EX-6) | No strip tile, revenue figure, margin or account economics figure reads it. A source guard pins its only consumer (SA-Q-6) |
| R-2 | **Never stored or written** (EX-4) | Computed in the request. Not in the history snapshot job, the data export, the audit trail or logs (logs carry counts only, never amounts) |
| R-3 | **Read-only** | No write path; the existing "no write verb" finance guard covers any new file |
| R-4 | **Admin only** (EX-2) | Reached only through the finance admin route behind `requireAdmin` and the page behind `requireAdminPage` |
| R-5 | **Reads at most 1,000 rows per request, paged** | Payments: the existing paged reads, unchanged. Rates: one read of the rates table (about 43 rows) |
| R-6 | **No mode logic in the finance builder** | Client payments have no Stripe mode (BD-13). Stripe mode is decided only in `lib/admin/billing` (BD-41); this work names no mode anywhere |
| R-7 | **Repositories only** | Rates come only through `ExchangeRatesRepository`; payments only through `BusinessOsFinanceReadRepository`. No direct Supabase call |
| R-8 | **CUR-3 must be amended, not bypassed** | `finance.source.guard` fails any finance file containing `exchange_rates`. The design must bring rates in through a repository plus a lib layer outside the finance files (as MRR enters through `lib/admin/billing`), and CUR-3 becomes a **positive pin**: exactly one named way in for rates, exactly one named converter. SA rules the shape (SA-Q-1, SA-Q-2) |
| R-9 | **The page does no money arithmetic** | The total and every converted line arrive from the server; the existing "no two money fields added" page guard stays |
| R-10 | **`$` display** | `$` with "≈", never "USD " (usdCopy guard) |
| R-11 | **Never a rate of 1 by assumption** (XR D-4) | §6.3 |

---

## 9. Business questions and the user's decisions

All five questions were answered on 2026-10-26.

| # | Question | Decision | Source | Status |
|---|---|---|---|---|
| **D-1** (BQ-1) | Where does the new figure go? | **Option A:** in the Client payments block, beside "Businesses taking client payments" | User, 2026-10-26 | ✅ Decided |
| **D-2** (BQ-2) | Which exchange rate converts the payments? | **Option A, the current rate.** User, verbatim: "the rate that is updated in the exchange rate page". Month-end rates (option B, slice 2) stay **parked** | User, 2026-10-26 | ✅ Decided |
| **D-3** (BQ-3) | Does a payment later refunded still count? | **Option A: yes.** Refunded payments count, matching the Gross column; refunds are not taken off | User, 2026-10-26 | ✅ Decided |
| **D-4** (BQ-4) | Before or after processor fees? | **Option A: before fees** (what the clients paid) | User, 2026-10-26 | ✅ Decided |
| **D-5** (BQ-5) | A rate older than 35 days? | **Option A, accepted by default:** still convert it, show an amber "Uses a stale rate" chip, link to the Exchange rates tab. The user was told this default and did not object | User, 2026-10-26 (default accepted) | ✅ Decided |
| **D-0** | The exception itself | The request is the user's **explicit exception** to "never sum money across currencies", limited to EX-1 to EX-6 (§2.1) | User, 2026-10-26 (§1) | ✅ Decided |

A missing or switched-off rate was never a question: it is always left out, and the figure says "At least" (§6.3).

---

## 10. Technical questions for SA

| # | Question | BA suggestion |
|---|---|---|
| SA-Q-1 | **How do rates reach the finance route?** `ExchangeRatesRepository`'s header names `app/api/admin/exchange-rates/**` as its only caller, and CUR-3 forbids `exchange_rates` in every finance file | A wiring function in `lib/admin/exchangeRates/` (the `lib/admin/billing` → MRR precedent, FIN SA-2) that calls the repository's existing `listAll` and returns a narrow, typed rate list (code, rate as text, enabled, last updated). The finance route calls it once per request. Repository header gains the second permitted caller. Alternative: a separate admin route the block fetches (more requests, a second loading state) |
| SA-Q-2 | **How is CUR-3 amended?** | Replace "no finance file names `exchange_rates`" with a positive pin: (a) no finance file names the table or the repository; (b) exactly one finance file (the route, or its deps) calls the named wiring function; (c) exactly one module converts; (d) `currencyGroups.ts`'s export pin unchanged. Each with a planted control |
| SA-Q-3 | **Where does the converter live, and with what maths?** | A pure module outside `lib/business-os/finance/` (for example `lib/admin/exchangeRates/clientPaymentsUsd.ts`), taking the builder's per-currency integer subtotals and the rate list, returning per-currency converted cents and a total, using `rateMath.divideHalfUp` (BigInt; no float). `rateMath.ts`'s "nothing converts money" header and the repository header are updated to point at the one exception |
| SA-Q-4 | **Payload shape** | One new optional section on the finance payload (for example `clientPaymentsUsd`) with its own status (`ok` / `partial` / `unknown`), the per-currency rows of §7.2, the total in cents, counts of unconverted payments, and a stale flag. Confirm which pins move (financeRequest.pin should not: the request does not change) |
| SA-Q-5 | **Two headlines in one block, and the small note** | `BlockKpi` has no sub-line. Either add an optional `note` prop (shared component, three callers: full cycle under LAY R-7) or render two `BlockKpi` side by side with the note outside. BA prefers the prop: the note belongs inside the tile (U-4) |
| SA-Q-6 | **Keeping it from leaking** (EX-4, EX-6) | A guard that the converted section is read only by the Client payments block, and never by the snapshot job (FIN slice 8), the data export, account economics, the strip, the audit or the BOS chat |
| SA-Q-7 | ~~Month-end rate per currency per month from `exchange_rate_history`~~ | **Moot for now:** D-2 chose the current rate; slice 2 is parked. Kept for the record |
| SA-Q-8 | **Rates and payments read at the same moment** | Rates read in the same request as the payments; the breakdown's "Rate last updated" and the page's "Read at" are enough. No caching |
| SA-Q-9 | **Other guards that may pin "no conversion"** | Check the exchange-rates guards (`rateSync.source.test.ts`, `redundantPages`) and any comment-scanning pin that would fail on the new caller or module |
| SA-Q-10 | **Cycle** | Full cycle for 1a and 1b (money figure, a new data path into Finance, a guard rewritten). Not a fast-track candidate unless the user says so |

---

## 11. Slices

Small, numbered, reusing the existing payments reads, the takings builder, the rates repository, the decimal maths, `BlockKpi` and the leading / lagging pill.

| # | Slice | What | Estimate | Cycle | Status |
|---|---|---|---|---|---|
| 0 | **The exception, on paper** | CLAUDE.md line, FIN BD-56, XR D-5 / row 4, MK USD-5 note (§2.2). Docs only | 0.5 day | Docs PR; the user sees the CLAUDE.md diff | ✅ **Done** (2026-10-26, branch `docs/client-payments-usd-exception`); the user approved the CLAUDE.md diff on 2026-10-27; committed and PR opened by RM |
| 1a | **Server: rates in, conversion, payload** | Wiring function and pure converter (SA-Q-1, SA-Q-3), the payload section (SA-Q-4), CUR-3 rewritten as a positive pin (SA-Q-2), leak guard (SA-Q-6). Current rate (D-2); refunded payments counted (D-3); before fees (D-4); stale rates converted and flagged (D-5). Unit tests: exact maths, missing / disabled / stale rate, rates read failing, ceiling, USD-only, no payments. No UI yet; no migration | about 2 days | Full | ✅ **Merged** as [#527](https://github.com/AgentsPilot/neuronforge/pull/527) |
| 1b | **Page: the figure and the breakdown** | The second headline in the Client payments block with the note (D-1, SA-Q-5), the stale chip, the "Converted to $" table, copy in `financeCopy.ts`, tooltip constant, render tests (exact, at least, unknown, stale chip, no payments, one business picked). No change to the existing tables | about 1.5 days | Full (shared component) | 🟡 **1b: PR [#532](https://github.com/AgentsPilot/neuronforge/pull/532)** opened 2026-10-27, auto-merge on (commit `021d0174`; SA-CR-CPU1B, QA with B-1 and L-1 fixed, TL approved; no pin moved; [retrospective](/docs/retrospectives/CLIENT_PAYMENTS_USD_1B_RETROSPECTIVE.md)). The user owes AC-21 (manual browser check) |
| 2 | Month-end rates (SA-Q-7) | Rate of each payment's month from the history | 1.5 to 2 days | Full | **Parked** (D-2) |
| 3 | Drawer line | "≈ $X at admin rate" for a non-US-dollar business in the business drawer | 0.5 to 1 day | Short path if SA agrees | **Optional, not scheduled** |

No production migration in any slice. No new table, column, cron or outside fetch.

---

## 12. Acceptance criteria

**Slice 0**
- [x] AC-1: CLAUDE.md, FIN (BD-56), XR (D-5, row 4) and MK (USD-5) carry the §2.2 wording; the user has seen the CLAUDE.md diff. ✅ The user approved the CLAUDE.md diff on 2026-10-27 ("yes").

**Slice 1a**
- [ ] AC-2: For a window with USD 100.00 and ILS 370.00 at a rate of 3.7, the payload total is 20,000 cents ($200.00), USD line exact.
- [ ] AC-3: Each currency subtotal is converted once, at the current rate on the Exchange rates tab (D-2), with exact decimal division rounded half away from zero to the cent; no JS float touches a rate or an amount.
- [ ] AC-4: A currency with no rate, a disabled rate, or an unknown code is not converted, not in the total, counted in "not converted", and the section is `partial`.
- [ ] AC-5: When the rates read fails, the total holds the US-dollar payments only, the section is `partial`, and the reason is given.
- [ ] AC-6: A rate older than 35 days is still converted and sets the stale flag (D-5); USD is never stale.
- [ ] AC-7: A payments read at its ceiling, or an unreadable amount, makes the section `partial`; a failed payments read makes it `unknown`.
- [ ] AC-8: Payments with status `succeeded` and `refunded` both count (D-3); amounts are before fees (D-4); refunds are never subtracted.
- [ ] AC-9: The figure covers the same accounts and window as the per-currency table, and narrows with a business picked.
- [ ] AC-10: CUR-3 is a positive pin (SA-Q-2) with planted controls; no finance file names the rates table or repository.
- [ ] AC-11: A guard shows nothing outside the Client payments block reads the converted section (snapshot job, export, strip, account economics, audit, chat included).
- [ ] AC-12: No write, no migration, no logged amount; every read pages at 1,000 rows or fewer.

**Slice 1b**
- [ ] AC-13: The Client payments block shows two headlines: "Businesses taking client payments" (leading, unchanged) and "Client payments processed" "≈ $…" (lagging) with the note "Our customers' revenue, not ours" inside it (D-1).
- [ ] AC-14: The tooltip and accessible name follow §5.3 (LL-2, LL-3), from one copy constant.
- [ ] AC-15: "At least ≈ $…" with "plus n payments in other currencies, not converted" whenever the section is `partial`; "Unknown" when `unknown`; "No client payments in this window" when empty; never "≈ $0" for no data.
- [ ] AC-16: When any rate used is stale, an amber "Uses a stale rate" chip shows on the figure and links to the Exchange rates tab (D-5).
- [ ] AC-17: The "Converted to $" table shows currency, payments, amount in that currency, rate used, rate date (Stale / No rate chips) and ≈ dollars, with a "≈ Total" row equal to the headline, and a link to the Exchange rates tab.
- [ ] AC-18: The existing per-currency, refunds, fees, processor and per-business tables, and the business drawer, render exactly as before.
- [ ] AC-19: The five strip tiles, their order and their links are unchanged.
- [ ] AC-20: The page adds no two money figures; no money string prints "USD "; every converted amount carries "≈".
- [ ] AC-21: QA records a manual check of the block with a USD-only window, a mixed-currency window, a window with a missing rate, and one with a stale rate.

---

## 13. Out of scope / future roadmap

- Converting any of **our own** money (it is US dollars already).
- Converted figures anywhere a business can see them (XR D-3).
- Month-end rates per payment month (slice 2, parked by D-2) and a stored month-end rate table (XR slice 3, still parked).
- Net of refunds, or after fees, in dollars (D-3, D-4).
- A converted line in the business drawer (slice 3, optional, not scheduled).
- A trend or history of the converted figure (it is never stored, EX-4).
- Leaving test or internal businesses out (FIN DF-3).
- A live market rate or an automatic rate update (XR D-9: suggestions only).

---

## 14. Notes on integration points

| Area | Effect |
|---|---|
| `lib/business-os/finance/takings.ts` | Unchanged logic; its per-currency integer subtotals (Gross: `succeeded` + `refunded`) feed the converter |
| `app/api/admin/business-os/finance/route.ts` (and its deps) | Calls the rates wiring once and adds the new payload section (SA-Q-1, SA-Q-4) |
| `lib/admin/exchangeRates/` | New wiring function and pure converter (SA-Q-1, SA-Q-3); `rateMath.ts` header updated |
| `lib/repositories/ExchangeRatesRepository.ts` | Existing `listAll`; header gains the second permitted caller. No new method expected |
| `app/admin/finance/components/TakingsSection.tsx`, `financeCopy.ts` | Second headline, note, stale chip, "Converted to $" table, tooltip constant |
| `app/admin/components/layout/BlockKpi.tsx` | Optional note prop, if SA agrees (SA-Q-5); three callers |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | CUR-3 rewritten as a positive pin; leak guard added |
| Tables | Read only: `payment_transactions`, `payment_refunds` (existing reads), `exchange_rates`. Nothing written |
| Exchange rates tab | Unchanged. Its rates now feed one admin figure, which makes keeping them current (and the Sync rates suggestions) more valuable |

---

## SA Requirement Review (SA-RR-CPU)

**Reviewed by SA — 2026-10-26.** Code facts read from `origin/main` (through the `neuronforge-finance-mk8b` worktree, which is at `35c97b4f` plus MK-3b): `finance.source.guard.test.ts`, `ExchangeRatesRepository.ts`, `rateMath.ts`, `exchangeRateRules.ts`, `rateSync.source.test.ts`, `takings.ts`, `currencyGroups.ts`, the finance route, and the snapshot job.
**Verdict:** ✅ **Approved with conditions (CPU-1 to CPU-8).** The scope is proportionate, and the exception (D-0, EX-1 to EX-6) is narrow and enforceable. The slice plan is confirmed. The one material change from the BA draft: **CUR-3 is not loosened.** It stays as written and gains positive pins (SA-Q-2). §2.2's BD-56 wording changes to match.

**§3 facts: confirmed**, with three additions:
- `currencyGroups.normaliseCurrencyCode` upper-cases codes, so a stored `ils` matches the rate row `ILS`. The converter must match on the per-currency table's normalised code, never on the raw code.
- The finance snapshot job (`financeSnapshotJob.ts`, `financeSnapshot.ts`) uses neither `takings` nor `buildFinanceHealth`, and its metric shape is already pinned (`SNAPSHOT_METRIC_SHAPE`). EX-4 therefore holds for the snapshot without any change.
- No guard pins `ExchangeRatesRepository`'s importers today; its "one permitted caller" rule is a header comment only. Slice 1a adds that guard (CPU-3).

### Rulings on §10

| # | Ruling |
|---|---|
| SA-Q-1 | **Follow the MRR precedent: read in the route, merged in the route.**<br>• A new server-only wiring module, `lib/admin/exchangeRates/clientPaymentRates.ts`, calls the existing `listAll`. It returns a narrow, typed list: code, rate as **text**, enabled, last updated. No new repository method.<br>• The finance route starts this read at the start of the request, in parallel with the builder, as it already does with `readFinanceMrr`. It awaits the read after the builder and passes the takings lines and the rates to the converter.<br>• `buildFinanceHealth` and everything under `lib/business-os/finance/` never see a rate.<br>• The repository header names the second permitted caller.<br>• Rejected: a separate admin route fetched by the block (a second loading state, and a figure that could disagree with the table above it). |
| SA-Q-2 | **CUR-3 stays exactly as it is.** The finance files in the guard's `FILES` list (the route included) still never name `exchange_rates`. The route imports the wiring module by its module path, which does not contain that string. Slice 1a **adds** positive pins, each with a planted control:<br>(a) `ExchangeRatesRepository` is imported only under `app/api/admin/exchange-rates/**` and by `clientPaymentRates.ts`;<br>(b) `clientPaymentRates.ts` and the converter are imported only by the finance route, each exactly once;<br>(c) the converter is the only file outside the rate-sync files that imports `divideHalfUp`;<br>(d) `currencyGroups.ts` still exports exactly its five names;<br>(e) the existing bans on `exchange_rates` / `\bfx\b` / `\brate\b` in `boostRevenue.ts`, `planRevenue.ts` and `accountEconomics.ts` stay untouched. They already enforce EX-6 for our own money.<br>Nothing is relaxed. |
| SA-Q-3 | **A pure converter at `lib/admin/exchangeRates/clientPaymentsUsd.ts`. No I/O and no clock: `now` is passed in.**<br>• **Inputs:** the takings per-currency lines, using normalised codes, Gross only, payment counts and the exactness flags; plus the rate list.<br>• **Amounts as integer hundredths, never through a JS float.** Take them either from the builder's own integer sums (a non-wire field, like MK-3's `ChargedAiCostWithUnits`), or by re-reading the wire figure with `currencyGroups.toHundredths`, the same exact reader the builder applies to stored amounts. Never `Math.round(x * 100)`. A test asserts, for every line, that the converter's hundredths equal the builder's.<br>• **Rate:** parsed from text with `parseDecimal`. It must match `RATE_PATTERN` and be greater than 0; otherwise the currency is "unusable" and is not converted (never treat the rate as 1, XR D-4). `divideHalfUp(hundredths, rate, 0)` gives US cents, rounded half away from zero. Each currency is converted once.<br>• **USD** is converted at 1 without a rate row (`BASE_CURRENCY`), so it still converts when the rates read fails.<br>• **Stale** uses `isRateStale` with the request's `now`.<br>• **Headers:** `rateMath.ts` keeps its "nothing here converts money" sentence, which stays true of that file, and adds one line naming the converter as the BD-56 exception. `exchangeRateRules.ts`, `ecbRates.ts` and the XR SQ-42 ruling text are left alone, except for the pointer line in XR D-5 (§2.2). |
| SA-Q-4 | **One optional section, `takings.usd` (`FinanceClientPaymentsUsd`), inside the existing takings section.** Like `aiCost.recorded`, it is absent wherever takings is absent.<br>• **Fields:** `status: 'ok' \| 'partial' \| 'unknown'`; `totalUsd` (a major-unit number made from the integer cents at the edge, as `toMoney` does today; the page does no arithmetic); `rows[]` with code, payments, gross in that currency, rate as text, rate updated at, `state` (`converted` / `stale` / `no_rate` / `disabled` / `unusable`) and usd or null; `notConverted { payments, currencies }`; `ratesRead: 'ok' \| 'failed'`; `stale: boolean`.<br>• **Pins:** **AC-145 moves**, in one ruled re-freeze in slice 1a with before and after hashes, and so do the finance wire-type pins. **AC-173 does not move** (the request is unchanged). **Pin B does not move** (the strip is unchanged). **Pins A, C and D do not move**: Pin A pins the `KpiStrip` callers, and `BlockKpi` is not one; C is AI cost; D is Health. So I do not accept the brief's "Pin A/B/C/D will move". If any of them does move, that is a defect, not a re-freeze. |
| SA-Q-5 | **Add an optional `note?: string` prop to `BlockKpi`. This is a shared export, so the full cycle applies (LAY R-7).**<br>• With no `note`, the markup must be byte-identical. The MK-3a hash test (`99c6969c…`) stays green **unedited**, which proves the three existing callers do not change.<br>• The two headlines sit side by side in the block, each its own `BlockKpi`.<br>• The stale state uses the existing `chip` prop (warning tone, in words). `BlockKpi` stays "not a link" (A-9), so the link to the Exchange rates tab goes in the line under the headlines and in the table footer, **not** on the chip. That is a small change from §5.1's "chip linking to the Exchange rates tab". AC-16 is read as "chip on the figure, link next to it". |
| SA-Q-6 | **Approved. The leak guard is a source scan on the section's type name and key.**<br>• They appear only in `financeTypes.ts`, the converter, the wiring, the finance route, `TakingsSection.tsx`, `financeCopy.ts`, and tests.<br>• They must never appear under `lib/business-os/` outside `financeTypes.ts`, under `app/api/business-os/**`, in the data export, the briefing or chat (`bizql`, `briefing`, `insight`), the snapshot files, `accountEconomics.ts`, `ourRevenue.ts`, `FinanceKpiStrip.tsx` or `financeTiles`.<br>• **Logs:** the route's log line gains `usd: { status, currencies, notConverted, stale }`, which is counts and flags only. No amount and no rate is ever logged (EX-4). |
| SA-Q-7 | Moot (D-2). |
| SA-Q-8 | **Approved.** Same request, no cache. Staleness and the "Rate last updated" date come from the same read, with the request's `now`. |
| SA-Q-9 | **Checked.**<br>• `rateSync.source.test.ts` walks `lib/admin/exchangeRates/`. The two new files must keep its rules: no `fetch(`, and no full URL. **Add the converter to `NO_FLOAT_FILES`**, as a ruled list change.<br>• The finance `\brate\b` bans are on three named files only, so the route and `TakingsSection` are unaffected.<br>• `usdCopy.source.guard` holds: the page prints `$` and "≈", and the table's "ILS 45,230.00" is the existing own-currency form.<br>• The `currencyGroups` export pin is not touched.<br>• No other guard scans for "convert". |
| SA-Q-10 | **Full cycle for 1a and 1b, confirmed.** 1a is a new data path into Finance plus new guards; 1b changes a shared export and a money block. Not a fast-track candidate unless the user says so. |

### Slice plan: confirmed
- **0, docs (0.5 day):** applies §2.2 with the CPU-7 changes.
- **1a, server (about 2 days):** the wiring module, the converter, the payload section, the positive pins and the leak guard. Includes the AC-145 re-freeze. No migration.
- **1b, UI (about 1.5 days):** the `BlockKpi` note prop, the second headline, the stale chip, the "Converted to $" table and the copy. Full cycle.
- Slice 2 stays parked; slice 3 is optional. **No migration in any slice**, which I confirmed: there is no new table, column or write.

### Conditions
1. **CPU-1:** no float touches an amount or a rate (SA-Q-3), with a property test showing the converter's hundredths equal the builder's for each currency line.
2. **CPU-2:** rows match on the normalised code. The "Unknown" currency line is never converted: it is counted in `notConverted` and makes the section `partial`.
3. **CPU-3:** the positive pins (a) to (e) of SA-Q-2 and the importer guard on `ExchangeRatesRepository`, each with a planted control.
4. **CPU-4:** the ≈ total is never placed beside, inside or as part of any figure about our money. It appears only in the Client payments block, under its existing "Not our revenue" chip (EX-6, R-1).
5. **CPU-5:** `BlockKpi` with no `note` stays byte-identical, and its hash test passes unedited.
6. **CPU-6:** the pin moves are only AC-145 and the finance wire types, each re-frozen once in 1a with before and after hashes. Any other pin moving stops the work.
7. **CPU-7: §2.2 wording, adjusted before slice 0.**
   - **CLAUDE.md:** the proposed text is accepted. It is a pointer, not a status, and it quotes origin/main's current text exactly (I checked line 179). It is the user's file: the user sees and approves the diff before it merges, as §2.2 says.
   - **BD-56:** replace "CUR-3 is amended as that requirement's slice 1a rules (SA)" with "CUR-3 is unchanged; slice 1a adds positive pins on the one way rates enter Finance (SA-RR-CPU SA-Q-2)". Before slice 0, check that each of BD-45, BD-47 and BD-50 really forbids conversion. Name in "amends" only those that do. BD-50 (the drawer keeps the business's own currency) is **not** amended, because the drawer does not change.
   - **XR:** the row-4 and D-5 lines are accepted. Also add one line under XR SQ-42 ("Any future use of a rate on an amount still needs a user decision reversing D-5"): "That user decision was taken on 2026-10-26 for client payments only (FIN BD-56)."
   - **MK USD-5:** "converts rather than adds raw amounts" is inaccurate, because the figure does add the converted amounts. Use instead: "Exception: the client payments approximate-dollar figure (BD-56), a block KPI, not a strip tile: each currency is converted at the admin rate and the converted amounts are added, shown with ≈."
8. **CPU-8, admin only (EX-2):** the section exists only on the admin finance payload behind `requireAdmin`. `app/api/business-os/**` and every business-facing builder are covered by the CPU-3 / SA-Q-6 scan.

### Business questions: none open
- **D-0 to D-5** are the user's decisions (§9).
- **Which accounts count** (platform and deleted accounts, test and real together): already decided by FIN BD-13 for this block, with exclusions deferred as DF-3. Using the same set as the per-currency table keeps the figure reconcilable with it.
- **Whole dollars on the tile and cents in the table:** a presentation choice under LL / USD rules. No user question.
- **One thing for the coordinator to tell the user, not to ask:** the stale chip is not itself a link; the Exchange rates link sits next to it (SA-Q-5).

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-26 | Created | BA scoped the client payments approximate-dollar figure from the user's 2026-10-26 request; exception wording proposed (§2.2); BQ-1 to BQ-5 and SA-Q-1 to SA-Q-10 open |
| 2026-10-26 | Business decisions recorded | User answers (relayed by the coordinator): BQ-1 option A (Client payments block), BQ-2 option A, "the rate that is updated in the exchange rate page", BQ-3 option A (refunded payments count), BQ-4 option A (before fees), BQ-5 default accepted (convert stale rates, amber chip, link). The exception recorded as the user's explicit request of 2026-10-26 (§2.1, D-0). Slices now 0, 1a (about 2 days), 1b; slice 2 parked; slice 3 optional, not scheduled; SA-Q-7 moot. Status: business decisions taken; ready for SA review |
| 2026-10-26 | SA requirement review (SA-RR-CPU) | Approved with conditions CPU-1 to CPU-8. SA-Q-1 rates read in the route and merged there (MRR precedent; finance lib never sees a rate); SA-Q-2 CUR-3 unchanged, positive pins added; SA-Q-3 pure BigInt converter in `lib/admin/exchangeRates/`; SA-Q-4 `takings.usd`, only AC-145 and the finance wire types move (Pins A to D do not); SA-Q-5 optional `BlockKpi` note, hash unchanged when no note; SA-Q-6 leak scan; SA-Q-8 to 10 approved. Slice plan confirmed (0, 1a, 1b; no migration). §2.2 BD-56 and USD-5 wording adjusted (CPU-7). No business questions open |
| 2026-10-26 | Slice 0 applied (uncommitted) | §2.2 wording, with the CPU-7 corrections, applied on `docs/client-payments-usd-exception`: CLAUDE.md "Never sum money across currencies" row gains the one exception with a pointer here; FIN gains BD-56 (amends BD-12, BD-45, BD-47 and MK USD-2 / USD-5; BD-50 not amended; CUR-3 unchanged), a §0.1 pointer row and a log line; XR D-5 and §1 row 4 unparked for client payments only, SQ-42 gains the decision line; MK USD-5 gains the reworded exception. §2.2 quotes updated to the applied wording. Awaiting the user's review of the CLAUDE.md diff (AC-1) |
| 2026-10-27 | Slice 0 done; user approved the CLAUDE.md diff | The user approved the CLAUDE.md change on 2026-10-27 ("yes"). §8 slice 0 row marked done; AC-1 ticked. RM commits the docs PR (CLAUDE.md, FIN BD-56, XR, MK and this requirement) on `docs/client-payments-usd-exception` |
| 2026-10-27 | RM: 1b committed, PR #532 opened, auto-merge on | Commit `021d0174` on `feature/client-payments-usd-1b`; origin/main (`d040115b`, through #525) merged in `50c6eaf0` with no conflicts. The UI for the ≈ $ figure: headline, states, stale chip, counts line, "Converted to $" table; the Exchange rates tab sentence now says the rates convert one admin figure only. No pin moved (AC-145 `aebc22cb…97ca`); the leak guard unchanged; no migration. Re-run: finance, layout guards, admin guards, Leak check, exchange rates, finance lib 104 / 5498; test:bos-entitlements 9401; typecheck:bos-llm passed (8 GB). Completes the stream with #526 and #527. §11: the 1a row is marked merged (#527) and the 1b row records #532. The user owes AC-21 |
