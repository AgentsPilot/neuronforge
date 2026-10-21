# Workplan: Admin exchange rates, slice 1c.2 (filter bar)

> **Last Updated**: 2026-10-20

**Developer:** Dev
**Requirement:** [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md) §1 (1c row), §3.3, §5.5.1, FR-14 to FR-16, §8 slice 1c.2, §13.4 (SQ-8, SQ-9, SA-1c-1, SA-1c-5, Dev 1c.2 items)
**Branch:** `feature/admin-exchange-rates-1c2` (worktree `neuronforge-fx-rates-1c2`, cut at `1fc1313f`, the 1c.1 branch tip = PR #482, in the merge queue). `origin/main` is merged in after #482 lands; the PR opens only after that.
**Date:** 2026-10-20
**Status:** Code Complete (uncommitted, awaiting SA code review + QA, short path). SA workplan review APPROVED-WITH-CHANGES (§9); C-1, C-2 and the minor items applied. Branch fast-forwarded to `origin/main` `0c27b576` (#482 merged) before the build

## Overview

Slice 1c.2 answers the user's comment 2 on the Exchange rates page: "add a filter on the top, in the same standard as the rest of the admin pages filters, default should be to present only enabled prices." The page's Refresh-only bar becomes the full shared `AdminFilterBar` with a **Show** select (Enabled only by default, Disabled only, All) kept in the URL under the key `currencies`, and a **Search** on code or name held in page state only, never in the URL. A count line ("Showing N of X currencies") and the shared empty state are added. The filter narrows the rates table only: the KPIs, the history list and the Last rate change tile keep counting every currency. A currency switched on or off stays in view until Refresh, the next successful read, or any filter or search change (SQ-9). The view takes an `active` prop, default `true`, so slice 2 can mount it in a Finance tab without editing the spec. Page-only work: no route, repository, migration, dependency or `app/admin/finance/` change. UI short path. Country flags were dropped by the user and are not part of this slice.

## Table of Contents

1. [Approved scope (quoted verbatim)](#1-approved-scope-quoted-verbatim)
2. [Analysis summary](#2-analysis-summary)
3. [Implementation approach](#3-implementation-approach)
4. [Questions for SA](#4-questions-for-sa)
5. [Files to create / modify](#5-files-to-create--modify)
6. [Task list](#6-task-list)
7. [Tests and commands](#7-tests-and-commands)
8. [Risks](#8-risks)
9. [SA Review Notes](#9-sa-review-notes)
10. [QA Testing Report](#10-qa-testing-report)
11. [Commit Info](#11-commit-info)
12. [Change History](#change-history)

---

## 1. Approved scope (quoted verbatim)

Copied from the requirement with `sed` from this worktree at `1fc1313f`, not retyped. Where this workplan and a quote differ, the quote wins. Anything about flags (SQ-10, SQ-11, the Country column) was dropped by the user and is left out on purpose.

### 1.1 §1 Progress, slice 1c row (lines 39-40, 44)

> | # | Slice | Status | PR | Notes |
> |---|---|---|---|---|
> | 1c | Page refinements from the user's 2026-10-19 page review (D-7): filter bar (Enabled only by default), newest 10 changes, admin name instead of the id, new KPIs (Enabled currencies, Last rate change; Stale tile removed). ~~Country flag column~~ dropped by the user (§3.3 comment 3) | 🟡 1c.1 built, PR open (SA approved after C-1/C-2, QA PASS-WITH-NOTES, user click-through passed 2026-10-20); 1c.2 next | — | **Build before slice 2.** Two small slices (§5.5.7): **1c.1** history cap + names + KPIs (route and page; full cycle, the route starts reading people's names), then **1c.2** filter bar only (page only; short path). No migration, no prod step. Comment 1 of the review is resolved by slice 2 (no Settings link) |

### 1.2 §3.3 User page review, 2026-10-19 (D-7) (lines 122-133)

Comment 2 is the user's own words and this slice's purpose: "add a filter on the top, in the same standard as the rest of the admin pages filters, default should be to present only enabled prices."

> ### 3.3 User page review, 2026-10-19 (D-7)
>
> The user reviewed the slice 1a page on 2026-10-19 and left six comments, then answered two follow-up questions. All quoted verbatim. After the SA review the user answered BQ-1 (flags on Windows) on 2026-10-19 with "skip this requirement, not needed", which **drops comment 3** entirely.
>
> | # | User comment (verbatim) | Follow-up answer (verbatim) | Decision | Built in |
> |---|---|---|---|---|
> | 1 | "add it to the settings section of the admin side bar." | Placement: "Finance tab only" | **Replaced by the follow-up answer.** No Settings sidebar link. The page is reached from the Finance tab (slice 2) and by typing its URL (D-6) | **Slice 2** (resolves comment 1) |
> | 2 | "add a filter on the top, in the same standard as the rest of the admin pages filters, default should be to present only enabled prices." | — | The shared admin filter bar. **Show: Enabled only** by default, plus Disabled only and All, and a search on code or name | 1c.2 (FR-14 to FR-16) |
> | 3 | "can you add a country icon or flag icon near each currency? as another column near SYMBOL" | BQ-1: "skip this requirement, not needed" | **Dropped by the user** (2026-10-19). No Country column | — (FR-17 withdrawn) |
> | 4 | "the latest changes, can we narrow it down to last 10 changes" | — | The **newest 10** changes (was 50) | 1c.1 (FR-18) |
> | 5 | "can we change the GUID to user name" | — | The admin's **name**, else their email, else "Unknown user", worked out on the server | 1c.1 (FR-19) |
> | 6 | "top KPIs should be: active/enabled currencies out of X, don't think we need stale KPI, and another box stating last action - for example: currency X changed from A to B" | Stale: "Keep the row mark" | Two tiles: **Enabled currencies** (N of X) and **Last rate change** (currency, A → B, who, when). **Stale tile removed**; the per-row Stale chip stays (35 days, USD never stale) | 1c.1 (FR-20 to FR-22) |

### 1.3 §5.5.1 Filter bar (comment 2) (lines 211-227)

> #### 5.5.1 Filter bar (comment 2)
>
> **Pattern:** the shared admin filter bar `AdminFilterBar` (`app/admin/components/layout/AdminFilterBar.tsx`, Admin Layout Standard C-8, §5.5) with the URL state hook `useAdminFilters` + `textFilter` (`app/admin/components/layout/useAdminFilters.ts`, C-7, §5.6). The closest page is **Businesses** (`app/admin/users/usersFilters.ts`, L-4a): one status select kept in the URL, its default (`active`) never written (U-3), an unknown value ignored (U-4), and the search text held by the page and **never** written to the URL (layout standard U-1 exception (1), its D-6 (a)). Field markup follows `app/admin/business-os-invites/components/InviteFilters.tsx`: labelled native `<select>` and `type="search"` input on `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL`.
>
> | Control | Spec |
> |---|---|
> | Show | Native select, label "Show": **Enabled only** (default), Disabled only, All. **In the URL**, like every other admin page filter: key **`currencies`** with values `disabled` and `all`; the default `enabled` is never written, so the plain URL opens Enabled only; any other value is ignored (SQ-8 ruling: `show` is taken by Finance's Accounts tab, SA-1c-1) |
> | Search | `type="search"`, label "Search", placeholder "Code or name". Case-insensitive match on the currency code or name. **Held by the page, never written to the URL** (the layout standard's rule for all free text) |
> | Clear | Resets Show and Search to their defaults; disabled at the defaults |
> | Read at + Refresh | Unchanged from 1a |
>
> - **Where the filter runs:** in the page, over the `GET` payload. The route keeps returning every currency (43 rows); it takes no filter parameter.
> - **KPIs count every currency, never the filtered view. BA recommends this.** Under the default filter, "Enabled currencies" counted over the filtered rows would always read "N of N", which says nothing. Businesses hit the same trap (its tile had to say "shown" rather than "total", SA C-15 (a) in L-4a). The history list and the Last change tile ignore the filter too.
> - A count line above the table: "Showing N of X currencies". When nothing matches: the shared empty state, "No currencies match these filters.", with Clear available.
> - USD is enabled, so it shows under Enabled only and All.
> - **A row switched off while "Enabled only" is shown:** BA suggests it stays in place, its chip now "Disabled", until the next Refresh or filter change, so the row and the keyboard focus do not vanish under the admin (SQ-9).
> - **Slice 2 compatibility:** the same `ExchangeRatesView` will render inside a Finance tab, where several tabs share one address bar. The Plans tab already uses `status` and the Accounts tab uses `show`, so 1c uses `currencies` (SQ-8). In slice 2 the view's hook takes the `{ active }` option (layout L-9a, F-113), as Business OS AI does.

### 1.4 §6 Functional requirements for 1c.2 (lines 288-289, 303-305)

> | # | Requirement | Slice |
> |---|---|---|
> | FR-14 | The page has the shared admin filter bar: Show (Enabled only by default, Disabled only, All), Search (code or name), Clear, Read at, Refresh (§5.5.1) | 1c.2 |
> | FR-15 | Show is kept in the URL under the key `currencies` (values `disabled` / `all`; the default `enabled` is never written; an unknown value is ignored); the search text is never written to the URL | 1c.2 |
> | FR-16 | The filter narrows the rates table only. The KPIs, the history list and the Last change tile always count every currency. A count line says how many currencies are shown; an empty result shows the shared empty state | 1c.2 |

### 1.5 §8 Acceptance criteria, slice 1c.2 (lines 370-380)

> **1c.2 — filter bar** (the Country column was dropped by the user, §5.5.2)
>
> - [ ] Opening `/admin/exchange-rates` shows only enabled currencies; Show reads "Enabled only"; the URL has no `currencies` key (`enabled` is never written).
> - [ ] Disabled only and All work and are written to the URL as `currencies=disabled` / `currencies=all`; opening that URL reproduces the view; an unknown value falls back to Enabled only.
> - [ ] Search matches code or name, case-insensitive, and never appears in the URL.
> - [ ] Clear returns to the defaults and is disabled at the defaults; Read at and Refresh behave as in 1a.
> - [ ] The KPI figures are identical under Enabled only, Disabled only and All (render test).
> - [ ] The count line is right; a filter that matches nothing shows the empty state.
> - [ ] Switching a currency off under "Enabled only" behaves per the SQ-9 ruling: the row stays visible with its chip "Disabled" (focus stays on its switch) until **Refresh**, or a filter or search change; after Refresh it is gone. One render test.
> - [ ] ~~Country column~~ — dropped by the user 2026-10-19 ("skip this requirement, not needed").
> - [ ] The bar follows the layout standard (`role="search"` named "Filters", labelled native controls); the existing layout and Exchange rates guards stay green.

### 1.6 §13.4 SA review, the parts that apply to 1c.2

Rulings SQ-8 and SQ-9 (lines 549-552):

> | # | Ruling |
> |---|---|
> | SQ-8 | **Rejected as proposed; key `currencies`.** `show` is already a Finance URL key (`FINANCE_FILTER_SPEC.show`, Accounts tab, values `all` / `active` / `negative`), and `financeFilterRepair` rewrites any non-default `show` when the tab is not Accounts. In slice 2 the two would fight over one address bar (`?tab=exchange-rates&show=all` would be "repaired" away). Use **`currencies`**, values `disabled` / `all`, default `enabled` never written (U-3), any other value ignored (U-4), via `textFilter({ key: 'currencies', defaultValue: 'enabled', isValid })` in a module-level spec (e.g. `app/admin/exchange-rates/exchangeRatesFilters.ts`). Search is a `pageOnly` field or plain page state, never written (U-1 exception). The view's hook takes `{ active }` from a prop defaulting to `true`, so slice 2 needs no edit to the spec. Dev greps every `FINANCE_FILTER_SPEC` key and alias at Step 0 and confirms `currencies` is still free |
> | SQ-9 | **Accepted, with the mechanism fixed.** Today `setEnabled` replaces the row in `payload`, so a filter derived from `payload` would drop the row at once. The view keeps a `heldCodes` set: a code switched in this view stays visible (`matchesFilter(row) \|\| heldCodes.has(code)`) with its new chip. The set is emptied on Refresh, on every successful read, and on any filter or search change. The count line counts what is shown (held rows included). Focus stays on the switch because the row does not unmount. One render test: switch off under Enabled only → row stays, chip "Disabled"; Refresh → row gone |

Additional rulings SA-1c-1 and SA-1c-5 (lines 563-565, 569):

> | # | Topic | Ruling |
> |---|---|---|
> | SA-1c-1 | §5.3 / §5.5.1 slice 2 note | The "different key" rationale names `status` only. BA adds that `show` is also Finance's (Accounts), and records for slice 2 that `FINANCE_FILTER_SPEC.tab` (`['accounts', 'plans']`) and `financeFilterRepair` must learn the new tab, while the exchange-rates hook runs with `{ active: tab === 'exchange-rates' }`. Slice 2 concern only; nothing in 1c touches `app/admin/finance/` |
> | SA-1c-5 | Filter bar | `role="search"` named "Filters", labelled native `<select>` ("Show") and `type="search"` ("Search", placeholder "Code or name") on `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL`; Clear disabled at defaults; Read at and Refresh unchanged. Search: trimmed, case-insensitive substring on `currencyCode` or `currencyName`; no regex built from input. Empty result: `AdminEmpty` "No currencies match these filters." with Clear |

Required changes, Dev 1c.2 (lines 592-596):

> **Dev, 1c.2 workplan and build:**
>
> 1. Filter spec and bar per SQ-8, SA-1c-5; held rows per SQ-9.
> 2. ~~Country column per SQ-11~~ — dropped by the user 2026-10-19; not built.
> 3. Render tests per §8 1c.2, incl. KPIs identical under all three Show values.

---

## 2. Analysis summary

Read from this worktree at `1fc1313f` (1c.1 built and merged into its branch):

| Area | What is there today | What 1c.2 does with it |
|---|---|---|
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | Owns `payload` and the three `fetch(` call sites (plain GET, `?currency=` GET, PATCH). `setEnabled` replaces the row in `payload`. Renders `AdminFilterBar` with only `what` / `busy` / `onRefresh` / `readAt` (the plain-`div` Refresh-only branch) | Gets the bar's controls, works out the visible rows, holds switched rows (SQ-9), takes `active` |
| `ExchangeRatesTable.tsx` | Renders whatever `rates` it is given. Row state (`editing`, `draft`, `busy`, `rowError`) is keyed by currency code. The switch button stays the same element when its label flips | **Unchanged.** Gets the visible rows instead of all rows |
| `ExchangeRatesKpis.tsx` | Counts `payload.rates` / `payload.history` of the plain GET (SA-1c-2) | **Unchanged.** Keeps receiving the full `payload`, never the filtered rows |
| `RateHistoryTable.tsx` | Overall list from `payload.history`, or one currency's own read | **Unchanged.** Not filtered (FR-16) |
| `app/admin/components/layout/useAdminFilters.ts` | `useAdminFilters(spec, { active })` and `textFilter({ key, defaultValue, isValid, pageOnly })`. The default is omitted (U-3), an invalid value is ignored (U-4), unrelated keys such as `tab` are kept. `useSearchParams` is null outside the App Router, so the hook takes the defaults and writes nothing | Used as is. No shared-folder edit |
| `app/admin/components/layout/AdminFilterBar.tsx` | With `children` / `onClear` it is `role="search"` named "Filters". Clear is disabled when `canClear === false`. Exports `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL` | Used as is |
| `app/admin/users/usersFilters.ts` + `app/admin/users/page.tsx` | Module-level spec with one `textFilter` (`status`, default `active`). Search is plain `useState`, never in the spec. Clear = `clear()` + `setSearchTerm('')`. `canClear = !isDefault \|\| searchTerm !== ''` | The pattern copied |
| `app/admin/business-os-invites/components/InviteFilters.tsx` | Labelled native `<select>` and `type="search"` on `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL` | Field markup copied |
| `AdminEmpty` (`AdminStates.tsx`) | `message`, `hint`, `onClear` (a "Clear filters" button), `testId` | The filtered empty state |
| `FINANCE_FILTER_SPEC` (`app/admin/finance/financeFilters.ts:130`) | Keys `window` (alias `preset`), `account` (alias `accountId`), `tab`, `sort`, `group`, `show`, `status` | `currencies` is still free (checked 2026-10-20; checked again at Step 0) |
| Guards | `redundantPages.source.guard` G-6 walks every non-test file under `app/admin/exchange-rates/` (bans, `ALLOWED_FETCH`, fetch count **3**, module logger). The `layoutFolder.guard` part (b) registry entry for Exchange rates lists 5 files | See §3.6 |

No file to be touched uses `console.*` (G-6 already proves it for the folder). There is no entitlements import, LLM call, cron, schema claim or tenant id, so no domain skill is triggered (SA-1c-8 stands). This is not V6 / pilot work.

---

## 3. Implementation approach

### 3.1 The filter spec (new pure module)

**File:** `app/admin/exchange-rates/exchangeRatesFilters.ts` (the path SA named in SQ-8). Module-level, no `'use client'`, no React, no fetch.

```typescript
export const CURRENCY_SHOWS = ['enabled', 'disabled', 'all'] as const;
export type CurrencyShow = (typeof CURRENCY_SHOWS)[number];

/** The select's options, in this order; labels from §5.5.1. */
export const CURRENCY_SHOW_OPTIONS: ReadonlyArray<{ value: CurrencyShow; label: string }>;
// enabled → 'Enabled only', disabled → 'Disabled only', all → 'All'

export interface ExchangeRatesFilters {
  /** Narrowed with toCurrencyShow at the use site (the Businesses pattern). */
  currencies: string;
}

export const EXCHANGE_RATES_FILTER_SPEC: AdminFilterSpec<ExchangeRatesFilters> = {
  currencies: textFilter({ key: 'currencies', defaultValue: 'enabled', isValid: isCurrencyShow }),
};

export function toCurrencyShow(raw: string): CurrencyShow; // anything else → 'enabled'
export function matchesCurrencyFilter(rate: ExchangeRateWire, show: CurrencyShow, search: string): boolean;
export function visibleRates(
  rates: readonly ExchangeRateWire[],
  show: CurrencyShow,
  search: string,
  held: ReadonlySet<string>
): ExchangeRateWire[];
export function currencyCountLine(shown: number, total: number): string; // "Showing 3 of 43 currencies"
export const NO_MATCHING_CURRENCIES = 'No currencies match these filters.';
```

- `isValid` accepts the three values. `currencies=enabled` parses to the default, and the hook's write removes it (U-3). `currencies=bogus` fails `isValid`, is ignored (U-4), and the write removes it too. Tests pin both.
- Search: `search.trim().toLowerCase()`. An empty term after trimming matches everything. Otherwise `code.toLowerCase().includes(term) || name.toLowerCase().includes(term)`, using `String.prototype.includes` and never a `RegExp` built from input (SA-1c-5). `currencyName` is a non-null `string` on the wire.
- `visibleRates` keeps the payload's order: `rates.filter((r) => matchesCurrencyFilter(r, show, search) || held.has(r.currencyCode))` (SQ-9's formula verbatim).
- Count line: "Showing N of X currencies", using `formatCount` from the shared folder. X is `payload.rates.length` (every currency). N counts what is shown, held rows included (SQ-9). "currency" is singular when X is 1.
- Search is **not** in the spec, either as a URL field or as `pageOnly`. A `pageOnly` field is still **read** from an inbound `?search=` link, and the brief and the layout standard's free-text rule want search held in page state only, as on Businesses.

### 3.2 The view

**File:** `app/admin/exchange-rates/components/ExchangeRatesView.tsx`.

1. **Props:** `export interface ExchangeRatesViewProps { /** L-9a: false while a Finance tab hides this view (slice 2). Default true. */ active?: boolean }` and `ExchangeRatesView({ active = true }: ExchangeRatesViewProps = {})`. `page.tsx` stays `<ExchangeRatesView />`, unedited.
2. **State:** `const { filters, setFilters, clear, isDefault } = useAdminFilters(EXCHANGE_RATES_FILTER_SPEC, { active })`, `const show = toCurrencyShow(filters.currencies)` and `const [searchTerm, setSearchTerm] = useState('')`. The search is page state only: never logged, never in the URL.
3. **Held rows (SQ-9), with no reset effect:**
   - `const [held, setHeld] = useState<HeldRows>(NO_HELD)`, where `HeldRows = { filters: ExchangeRatesFilters | null; searchVersion: number; codes: ReadonlySet<string> }`.
   - `searchVersion` is a counter. Every search edit and every Clear bumps it. Search only changes through this view's own handlers.
   - The held set **counts only while the view is the one it was taken under**: `const heldNow = held.filters === filters && held.searchVersion === searchVersion ? held.codes : EMPTY_SET`. The hook's `filters` keeps its identity until a value changes, and every value change gives a new object, outside changes included (Back, a sidebar link). So **any** Show change, even a change and back, retires the set at once, in the same render. There is no one-frame flash and no `useEffect` that resets state.
   - After a successful switch (`patch` resolved `null`), the code is added: `setHeld((h) => fresh(h) ? add(h, code) : { filters: filtersRef.current, searchVersion: searchVersionRef.current, codes: new Set([code]) })`. The refs hold the values at the moment the PATCH **settles**: if the filter changed during the PATCH, the row is judged under the new view, not held under the old one.
   - The set is emptied (`setHeld(NO_HELD)`) in two places. One is the Refresh click, before the read, so a failed Refresh still releases the rows. The other is **every** successful plain read in `load`: the mount read, Refresh, Retry and the after-save re-read (the SQ-9 ruling).
   - A one-currency history read (`?currency=`) does not empty the set. It is not a rates read and returns no rates.
4. **Visible rows:** `const rows = payload ? visibleRates(payload.rates, show, searchTerm, heldNow) : []`.
5. **Bar:** `AdminFilterBar` keeps `what` / `busy` / `onRefresh` / `readAt`. It gains `onClear={clearAll}`, `canClear={!isDefault || searchTerm !== ''}` and two children in §5.5.1 order (Show, then Search). Each child is a `<div>` with a `<label htmlFor>` on `ADMIN_FIELD_LABEL` and the control on `ADMIN_FIELD_CONTROL`, with ids from `useId`:
   - Show: native `<select>`, label "Show", `data-testid="currencies-show"`, options from `CURRENCY_SHOW_OPTIONS`, `onChange` → `setFilters({ currencies: toCurrencyShow(value) })`.
   - Search: `type="search"`, label "Search", placeholder "Code or name", `data-testid="currencies-search"`, `autoComplete="off"`, a `maxLength` (e.g. 64), `onChange` → `setSearchTerm` and a `searchVersion` bump.
   - `clearAll = () => { clear(); setSearchTerm(''); bump searchVersion; }`.
   - The bar shows its controls from the first render (Q-1).
6. **Content (`payload` present):**
   - `payload.rates.length === 0` → the existing `AdminEmpty` "No currencies are recorded." (unchanged; no count line, no Clear).
   - Otherwise the count line comes first: `<p data-testid="rates-count" className="text-xs text-slate-400">{currencyCountLine(rows.length, payload.rates.length)}</p>` (whether it is a live region is Q-2). Then:
     - if `rows.length === 0`: `<AdminEmpty testId="rates-filtered-empty" message={NO_MATCHING_CURRENCIES} onClear={atDefaults ? undefined : clearAll} />`. Clear is offered while a filter is on, as the `AdminEmpty` contract says. At the defaults the list cannot be empty while USD is enabled.
     - otherwise: `<ExchangeRatesTable rates={rows} … />`, every other prop unchanged.
   - The history panel below is untouched. It keeps reading `payload.history` or the one-currency payload.
7. **KPIs:** `<ExchangeRatesKpis payload={error ? null : payload} …/>` stays exactly as it is. It gets the full payload, never `rows` (FR-16, SA-1c-2).
8. **No new fetch.** A filter or search change never reads the route. The three call sites are unchanged, so the G-6 count stays 3.
9. **Header comment:** the "Refresh-only bar" sentence is rewritten for the 1c.2 bar: Show in the URL as `currencies`, search page-only, held rows, KPIs counting every currency. It cites §5.5.1, FR-14 to FR-16, SQ-8, SQ-9 and SA-1c-5.

### 3.3 Focus under SQ-9

The switched row is held, so it does not unmount. The switch stays the same `<button>` element, and only its label flips from "Switch off EUR" to "Switch on EUR", so focus stays on it. The button is `disabled` while its PATCH runs (existing table behaviour, untouched). The render test asserts that `document.activeElement` is that button after the PATCH settles. See risk R-3 for what jsdom can and cannot prove here.

### 3.4 Slice 2 readiness

- The `active` prop defaults to `true` and is passed as `useAdminFilters(spec, { active })`. Slice 2 passes `active={tab === 'exchange-rates'}` and edits neither the spec nor the view's internals (SQ-8, SA-1c-1).
- `currencies` is not a `FINANCE_FILTER_SPEC` key or alias, so `financeFilterRepair` will not touch it. The hook keeps unrelated keys (`tab`) on every write.
- Nothing in 1c.2 touches `app/admin/finance/`.

### 3.5 What 1c.2 does not touch

`page.tsx`, `ExchangeRatesTable.tsx`, `ExchangeRatesKpis.tsx`, `RateHistoryTable.tsx`, `changedByText.ts`, both routes, the repository, `lib/admin/exchangeRates/*`, the shared layout folder (`app/admin/components/layout/*`), the sidebar, `app/admin/finance/**`, `package.json`, the lockfile and migrations. No new dependency and no new pattern: the spec plus page-state search is the Businesses pattern.

### 3.6 Guards: which may need an edit

| Guard | Expected effect | Edit? |
|---|---|---|
| `app/admin/__tests__/redundantPages.source.guard.test.ts` G-6 | The walk picks up the new `exchangeRatesFilters.ts` (6 files become 7, still `>= 5`). No ban is hit (Supabase, `.from(`, `CurrencyService`, `https?://`, `console.`). `ALLOWED_FETCH` is unaffected. **The fetch count must stay `toBe(3)`**: neither the new file nor the view adds a `fetch(`. The module logger is still present | **No edit.** Re-run it. A red count means a fetch was added by mistake: stop |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` part (b) | The Exchange rates registry entry lists 5 files. Each listed file is checked: it exists, has no own `<h1`, no `.json(`, and reaches the shared folder only through the alias | **Yes, small.** Add `'app/admin/exchange-rates/exchangeRatesFilters.ts'` to the entry, as `usersFilters.ts` and `costsFilters.ts` are in theirs. The entry comment's "Refresh-only bar" becomes "the filter bar (Show in the URL as `currencies`, search page-only)". Add one "Amended by Exchange rates 1c.2" line to the file header. The "every file in exactly one entry" test stays green. No rule change |
| Admin filter-standard guards (grep of `AdminFilterBar` / `useAdminFilters` in `__tests__`) | Shared-folder suites: `AdminFilterBar.render`, `useAdminFilters.render`, `AdminBusinessPicker.render`, `layoutFolder.guard`. Page-scoped suites: Finance (`source.guard`, `financeFilterBar.layout.render`, `financeFilters`, `financeLinks`, `financeUrl`), Invites (`source.guard`), BOS AI (`activityFilters`, `costsFilters`), Messages (`messages.layout.render`). **None of them scans `app/admin/exchange-rates/`**, and no cross-page guard lists filter specs or URL keys | **No edit.** The shared-folder suites are re-run, because the view now uses the bar's controls branch |
| `KpiStrip.callers.pin.render` | Neither `ExchangeRatesKpis.tsx` nor `KpiStrip.tsx` is edited | **No edit.** Re-run it. Any hash change is a stop |
| `app/admin/finance/__tests__/source.guard.test.ts`, `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | Nothing under finance moves | **No edit.** Re-run as proof |
| `AdminSidebar.nav` (`UNLISTED` entry) and `admin-authz-surface.guard` | `page.tsx` and the sidebar are untouched | **No edit.** Re-run |

---

## 4. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | Before the first read and while the page shows an error, does the bar show its controls, or is it Refresh-only as on Signup Invites (SA L-6 M-3)? | **Controls from the first render**, as on Businesses. Show is URL state that means something before any data arrives (an inbound `?currencies=all` should show "All" at once). Switching the bar's branch after the read would also move the Refresh button under the admin's pointer |
| Q-2 | Is the count line a live region (`role="status"`)? | **No.** As a live region it would be announced on every keystroke in Search. It is plain text above the table, like Audit trail's "Showing …" lines, and screen-reader users read it in flow |
| Q-3 | SQ-9 says the held set is emptied "on any filter or search change". The plan retires it by **identity** (the hook's `filters` object plus a search counter), not by a `useEffect` that resets state. The row then disappears in the same render as the change, and a change and back does not bring it back. Is this mechanism acceptable? | Yes (§3.2 item 3) |
| Q-4 | A switch made under **Disabled only** (switching a currency on) is held the same way, the mirror of SQ-9. Under **All**, holding changes nothing. Do you confirm that SQ-9 applies under every Show value? | Hold under every Show value |
| Q-5 | Does `WHAT` ("the exchange rates") stay a private constant in the view, or move to the new module beside the spec, as `USERS_WHAT` sits in `usersFilters.ts`? | Leave it in the view. Nothing in this slice needs it moved, and slice 2 needs nothing from it |
| Q-6 | The page has no `<Suspense>` around the code that calls `useSearchParams`. Businesses (`app/admin/users/page.tsx`) has none either and builds, because the admin layout is dynamic (`requireAdminPage` reads cookies). Audit trail has one. Follow Businesses (no boundary)? | Follow Businesses; CI `Build` is the proof. If SA prefers the boundary, it goes in `page.tsx` with `fallback={null}` |
| Q-7 | Process: SQ-16 says 1c.2 branches from `origin/main` after 1c.1 merges. This branch was cut at the 1c.1 tip (`1fc1313f`, PR #482, in the merge queue). `origin/main` is merged in after #482 lands and before the PR opens, so the PR is never stacked. Does that satisfy SQ-16? | Yes. Before opening the PR, RM checks that `1fc1313f` is an ancestor of `origin/main` |

---

## 5. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/admin/exchange-rates/exchangeRatesFilters.ts` | create | Module-level spec (`currencies`), the Show options, pure filter and count helpers (SQ-8, SA-1c-5, the SQ-9 formula) |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | modify | `active` prop, the hook, page-state search, held rows, the bar's controls, count line, filtered empty state, header comment |
| `app/admin/exchange-rates/__tests__/exchangeRatesFilters.test.ts` | create | Unit tests of the pure module |
| `app/admin/exchange-rates/__tests__/exchangeRatesFilters.render.test.tsx` | create | Render tests of the bar, URL, search, Clear, count line, empty state, identical KPIs, SQ-9 and `active`. It mocks `next/navigation` with a settable search string and spies on `history.replaceState`, as `businessesLayout.render` does |
| `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx` | modify | The three tests that assert the disabled JPY row (lines ~161, ~171, ~213) select Show "All" first. Otherwise Enabled only hides the row, or the null assertion becomes vacuous. One header line for 1c.2. No other test changes |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | The registry entry gains `exchangeRatesFilters.ts`, plus the entry comment and one "Amended by" header line (§3.6) |
| `docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1C2_WORKPLAN.md` | create | This file |
| `docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md` | modify | The §1 1c row status and a Change History row at each stage (workplan, SA, built, QA, PR) |

Not edited: everything in §3.5, and `app/admin/__tests__/redundantPages.source.guard.test.ts` (re-run only).

---

## 6. Task list

- ✅ Step 0: Check that `git branch --show-current` is `feature/admin-exchange-rates-1c2`, `git status` is clean and HEAD is `1fc1313f`. Grep every `FINANCE_FILTER_SPEC` key and alias, and every `textFilter({ key:` / `choiceFilter(` under `app/admin/`, and confirm `currencies` is still free (SQ-8). Run the §7.2 Jest set, the §7.3 `tsc` and `lint:hooks` for a baseline; record the results here.
- ✅ Step 1: Create `exchangeRatesFilters.ts` (§3.1) and its unit test `exchangeRatesFilters.test.ts` (§7.1 U-1 to U-8). Run it.
- ✅ Step 2: Wire the view (§3.2 items 1, 2 and 4 to 9): `active` prop, the hook, Show select, Search, Clear, count line, filtered empty state. The KPIs and history stay untouched.
- ✅ Step 3: Held rows per SQ-9 (§3.2 item 3): the identity gate, adding a code on a switch, and emptying the set on the Refresh click and on every successful plain read.
- ✅ Step 4: Update the three JPY tests in `exchangeRates.render.test.tsx` (Show "All" first) and its header line. Run the file: every 1a / 1c.1 test still passes.
- ✅ Step 5: Write `exchangeRatesFilters.render.test.tsx` (§7.1 R-1 to R-14). Run it.
- ✅ Step 6: Update the `layoutFolder.guard` registry entry, the entry comment and the "Amended by" line (§3.6). Run it.
- ✅ Step 7: Run the full §7.2 Jest set, the §7.3 narrow `tsc`, and §7.4 `eslint` + `lint:hooks`. Run `git diff --stat` and `git diff --numstat`: no file may show deletions without matching insertions (truncation check), and no file outside §5 may change.
- ✅ Step 8: Record results and any deviations in a new §6.1 (Implementation notes). Update the requirement's §1 row and Change History. Leave everything uncommitted and hand to TL for SA code review and QA (short path), then the user's diff view.
- ✅ Step 9 (after #482 lands; RM's call): done before the build: the branch was fast-forwarded to `origin/main` `0c27b576`, so the build and every run below are on the merged tree. `origin/main` is merged into this branch. Re-run §7.2 and §7.3 on the merged tree before the PR opens.

### 6.1 Implementation notes (Dev, 2026-10-20)

Built uncommitted on `feature/admin-exchange-rates-1c2` at `origin/main` `0c27b576`.

**Step 0.** Branch and HEAD checked; `git status` clean apart from this workplan. `currencies` is not a key or alias anywhere under `app/admin/` (`FINANCE_FILTER_SPEC`: `window`/`preset`, `account`/`accountId`, `tab`, `sort`, `group`, `show`, `status`). All §7.2 paths exist. Baseline narrow Jest: **27 suites / 2,611 tests passed**.

**SA changes applied:**

| Item | How |
|---|---|
| C-1 | The held code is added **inside `patch`, immediately before `setPayload`**, only when `body.field === 'enabled'`. The view comes from `filtersRef` / `searchVersionRef` (assigned in an effect, like `openCodeRef`), with a comment saying why: `patch` has `[]` deps, so its closure would hold the first render's values. R-11 asserts the switch is the same DOM node before and after, and holds focus. One extra render test pins the refs: a Show change made while the PATCH is in flight still holds the row under the view current when it settles |
| C-2 | "fresh rows lose the chip" asserts `getByTestId('rate-row-JPY')` after selecting All, before the `stale-JPY` null check |
| Q-4 | R-12 (Q-4): under Disabled only, switching JPY on keeps the row (same node); after Refresh the filtered empty state shows |
| `canClear` | One const, `!isDefault \|\| searchTerm !== ''`, used by the bar and by the empty state's Clear. No `atDefaults` |
| R-14 | Also asserts Show reads "Enabled only" under `active={false}` with `?currencies=all` |
| `.from(` ban | The new module has no `Array.from(`; the held set is built with `new Set(current.codes).add(code)` |
| Guards | `redundantPages` not edited; G-6 fetch count still **3**. `layoutFolder.guard`: registration only (entry + comment + one "Amended by" line); the new module has no `<h1`, no `.json(`, and reaches the shared folder only via `@/` |
| Suspense | None, as on Businesses (Q-6). No build was run locally; CI `Build` is the proof. If it reports a missing-Suspense bailout, add `fallback={null}` in `page.tsx` and record it as a deviation |

**Deviations:**

| # | Deviation | Why |
|---|---|---|
| DV-1 | The view imports the new module **relatively** (`'../exchangeRatesFilters'`), not through `@/app/admin/exchange-rates/...` | The alias path contains `/admin/exchange-rates`, and `redundantPages` G-4 ("no file names either page route in code") failed on it in the first full run. A relative import inside the page's own folder is what the view already does for its siblings; S-1 only requires the alias for the **shared** folder. A comment beside the import gives the reason. Guard unedited |
| DV-2 | The count line and the table (or the filtered empty state) sit in one `space-y-2` wrapper inside `exchange-rates-content` | Layout only: keeps the count line close to the table. No test id or role changed |
| DV-3 | Render tests: 25 cases rather than 14 (R-4 is an `it.each` of 5 searches; R-12 has four release/Q-4 cases plus the in-flight PATCH case). Unit tests: 24 cases | More coverage of the same plan items; nothing outside §7.1 |

**Behaviours to know (R-4, accepted by SA; not defects):**

- An open rate editor whose row a filter hides **comes back with its draft** when the row returns: `ExchangeRatesTable` keys `editing` / `draft` by currency code. Nothing is saved without a click.
- If the filtered result goes **empty**, the table unmounts (the `AdminEmpty` branch) and an open editor's **draft is discarded**.
- The one-currency history panel stays open for a currency the filter hides (the history is not filtered, FR-16).

**Results (Step 7):**

| Check | Result |
|---|---|
| Narrow Jest (§7.2) | **29 suites / 2,662 tests passed** (baseline 27 / 2,611; +2 new suites, +51 tests: 24 unit, 25 render, +2 in the guard registry's per-file checks) |
| Exchange rates folder alone | 3 suites / 87 tests passed (the existing 38-test page file passes with only the §7.1 edits) |
| Narrow `tsc` (scratch `tsconfig.fx1c2.json`, 9 files) | exit 0, **0 errors** |
| `eslint` on the 6 touched `.ts` / `.tsx` files | exit 0, 0 findings |
| `npm run lint:hooks` | exit 0 |
| `git diff origin/main --stat` (tracked) | `layoutFolder.guard.test.ts` +9 / −3, `exchangeRates.render.test.tsx` +14 / −0, `ExchangeRatesView.tsx` +173 / −13, requirement +3 / −2. Untracked (new): `exchangeRatesFilters.ts` (94 lines), `exchangeRatesFilters.test.ts` (159), `exchangeRatesFilters.render.test.tsx` (445), this workplan. All §5 files; no deletion without matching insertions |

---

## 7. Tests and commands

### 7.1 Tests added or changed

**Unit, `app/admin/exchange-rates/__tests__/exchangeRatesFilters.test.ts`:**

| # | Case |
|---|---|
| U-1 | Spec: key `currencies`, default `enabled`. `parse` returns `disabled` / `all` as given and `enabled` as `enabled`. `bogus`, `ENABLED` and `''` return `undefined`. `serialise('disabled')` = `{ currencies: 'disabled' }` |
| U-2 | `toCurrencyShow`: the three values pass through; anything else → `enabled` |
| U-3 | `CURRENCY_SHOW_OPTIONS`: exact values and labels, in order (Enabled only, Disabled only, All) |
| U-4 | `matchesCurrencyFilter` by Show: an enabled row and a disabled row under each value; USD (enabled) shows under Enabled only and All |
| U-5 | Search on code and name: case-insensitive (`ils`, `ILS`, `Shekel`), trimmed (`'  eur  '`); an empty or spaces-only term matches all; no match → false |
| U-6 | Search is literal: `.`, `(`, `*` and `\` neither throw nor match everything |
| U-7 | `visibleRates`: payload order is kept; a held code shows even when it fails the filter; a held code missing from the rates adds nothing |
| U-8 | `currencyCountLine`: "Showing 3 of 4 currencies", "Showing 0 of 4 currencies", "Showing 1 of 1 currency"; thousands go through `formatCount` |

**Render, `app/admin/exchange-rates/__tests__/exchangeRatesFilters.render.test.tsx`.** Same fixture shape as the existing file (EUR, ILS and USD enabled; JPY disabled). `next/navigation` is mocked with a settable `mockSearch`, and `history.replaceState` is spied on:

| # | Case | Criterion |
|---|---|---|
| R-1 | Plain URL: rows EUR, ILS and USD only; Show reads "Enabled only"; no `replaceState` call carries `currencies`; `window.location.search` has no `currencies` | §8 1c.2 bullet 1 |
| R-2 | Select Disabled only → JPY only, URL `?currencies=disabled`. All → four rows, URL `?currencies=all`. Back to Enabled only → key removed | bullet 2, FR-15 |
| R-3 | Inbound `currencies=all` and `currencies=disabled` show their views at first render. `currencies=bogus` → Enabled only, and the write removes the key. An unrelated key (`tab=x`) is kept | bullet 2, U-4 |
| R-4 | Search `ils` / `ILS name` / `  eur ` narrows the table to one row. The typed text never appears in any `replaceState` argument or in `window.location.search` | bullet 3, FR-15 |
| R-5 | Clear is disabled at the defaults, and enabled after a Show change and after a search. Clicking it restores Enabled only, an empty search and a clean URL | bullet 4 |
| R-6 | Read at shows, and Refresh re-reads the plain GET exactly once, as in 1a | bullet 4 |
| R-7 | **KPIs identical under all three Show values:** the text of `kpi-enabled-currencies` ("3 of 4") and `kpi-last-rate-change` is captured under Enabled only, then compared under Disabled only and All, and again with a search that matches nothing | bullet 5, FR-16 |
| R-8 | The overall history list shows the same rows under every Show value | FR-16 |
| R-9 | Count line: "Showing 3 of 4 currencies" (default), "Showing 1 of 4" (Disabled only), "Showing 4 of 4" (All) | bullet 6 |
| R-10 | A search with no match → `AdminEmpty` "No currencies match these filters." with its Clear button, and clicking it restores the default view. The table is gone while the result is empty; the KPIs are not | bullet 6, SA-1c-5 |
| R-11 | **SQ-9:** under Enabled only, focus "Switch off EUR" and click. The PATCH answers `isEnabled: false`. The EUR row is still shown with the chip "Disabled", focus is on the same button (now "Switch on EUR"), and the count still reads "Showing 3 of 4". Click **Refresh** (the GET answers EUR disabled) → the EUR row is gone and the count reads "Showing 2 of 4" | bullet 7 |
| R-12 | SQ-9 release paths, after the switch: (a) Show → All → Enabled only: EUR not shown; (b) type in Search, then clear it: EUR not shown; (c) a successful rate save on ILS (with its after-save re-read): EUR not shown | bullet 7, SQ-9 |
| R-13 | Bar shape: `role="search"` named "Filters"; `getByLabelText('Show')` is a `<select>`; `getByLabelText('Search')` is `type="search"` with placeholder "Code or name". No filter or search change calls `fetch` | bullet 8, SA-1c-5 |
| R-14 | `active={false}` (slice 2 readiness): `<ExchangeRatesView active={false} />` rendered with `mockSearch = 'currencies=all'` shows the default view and never calls `replaceState` | SQ-8 |

**Changed, `exchangeRates.render.test.tsx`:** three tests select Show "All" before their JPY assertions: "reads only the admin route, and shows every currency…", "marks stale rows in words…" and "fresh rows lose the chip…". Nothing else changes. No `next/navigation` mock is added there: outside the App Router the hook takes the defaults and writes nothing, which is what those tests need. If the Show select needs the router to apply a change, the mock is added as in the new file.

**Changed, `layoutFolder.guard.test.ts`:** the registry entry only (§3.6).

### 7.2 Narrow Jest set

```bash
npx jest app/admin/exchange-rates app/admin/__tests__/redundantPages.source.guard.test.ts app/admin/components/layout/__tests__ app/admin/components/__tests__/AdminSidebar.nav.test.ts app/admin/finance/__tests__/source.guard.test.ts lib/business-os/finance/__tests__/finance.source.guard.test.ts app/admin/business-os-invites/__tests__/source.guard.test.ts lib/admin/__tests__/admin-authz-surface.guard.test.ts --ci
```

Run at Step 0 (baseline), Step 7 and Step 9. `app/admin/components/layout/__tests__` covers `layoutFolder.guard`, `AdminFilterBar.render`, `useAdminFilters.render` and the `KpiStrip` pin. At Step 0 Dev confirms each path exists, drops any that does not, and notes it here.

### 7.3 Type check (narrow)

A full `tsc` ran out of memory on this machine in 1a. Instead, use a scratch tsconfig in the session scratchpad (never committed), `tsconfig.fx1c2.json`. It `extends` the worktree's `tsconfig.json` by absolute path, and its `include` lists the worktree's `next-env.d.ts`, `types/**/*.d.ts` and the §5 `.ts` / `.tsx` files (absolute paths). Run:

```bash
npx tsc --noEmit -p "<scratchpad>/tsconfig.fx1c2.json"
```

Run it from the worktree root and check the exit code. Filter the output to the §5 files and compare it with the Step 0 baseline. Pass = no new error in a touched file.

### 7.4 Lint

```bash
npx eslint app/admin/exchange-rates/exchangeRatesFilters.ts app/admin/exchange-rates/components/ExchangeRatesView.tsx app/admin/exchange-rates/__tests__/exchangeRatesFilters.test.ts app/admin/exchange-rates/__tests__/exchangeRatesFilters.render.test.tsx app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx app/admin/components/layout/__tests__/layoutFolder.guard.test.ts
npm run lint:hooks
```

No `npm install`, no build, no CI change. No added CI time: two small test files inside the existing Jest gate.

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The default hides disabled rows. The existing 1a / 1c.1 tests that assert JPY then fail, or a `queryBy…` null assertion on JPY passes vacuously | Step 4 selects Show "All" in exactly those tests. That file's diff is limited to them and its header |
| R-2 | The held set is emptied too late (the row flashes for one frame under the new filter), or comes back after a change and back | The identity gate (§3.2 item 3), with no effect. R-12 (a) and (b) pin both |
| R-3 | SQ-9 focus: jsdom does not blur a focused button that becomes `disabled`. So the focus assertion in R-11 proves the row did not unmount; it says nothing about real-browser focus while the PATCH runs (the existing `disabled={busy !== null}`) | The test asserts the button is the same DOM node before and after. QA checks focus with the keyboard in the browser during the short-path click-through |
| R-4 | A filter change hides a row whose rate editor is open. `ExchangeRatesTable` keeps `editing` / `draft` keyed by code, so the editor reappears when the row comes back | Accepted and recorded: no data is lost and nothing is saved silently. Not fixed in this slice unless SA asks |
| R-5 | The one-currency history panel stays open for a currency the filter now hides | Intended: the history panel is not filtered (FR-16). "Show all currencies" still closes it |
| R-6 | A URL key clash with Finance in slice 2 | `currencies` is checked against every Finance key and alias at Step 0. R-14 proves `active={false}` writes nothing |
| R-7 | Search text leaking into the URL, logs or storage | Search is not in the spec and is never logged. R-4 asserts both the `replaceState` arguments and `window.location.search` |
| R-8 | The fetch-count guard turning red | No new `fetch(`, so the G-6 count stays `toBe(3)`. A red count is a stop, never a reason to edit the guard |
| R-9 | `useSearchParams` without `<Suspense>` failing `next build` | Businesses has the same shape and builds (dynamic admin layout). CI `Build` is the proof; see Q-6 |
| R-10 | Base drift: the branch sits on `1fc1313f` while `origin/main` moves before #482 lands | Step 9: merge `origin/main` after #482 and re-run §7.2 / §7.3 before the PR opens. No stacked PR (SQ-16, Q-7) |
| R-11 | Shared `node_modules` junction and shared stash list | No `git worktree remove`, no `git stash`, no commits by Dev. Work only in this worktree |

---

## 9. SA Review Notes

### SA workplan review

**Reviewed by SA — 2026-10-20**
**Status:** APPROVED-WITH-CHANGES (two required changes, C-1 and C-2, both small; no re-review needed: SA checks them in code review)

I read this from the worktree at `1fc1313f`: `useAdminFilters.ts`, `ExchangeRatesView.tsx`, `ExchangeRatesTable.tsx`, `page.tsx`, `exchangeRates.render.test.tsx`, the G-6 block of `redundantPages.source.guard.test.ts`, the Exchange rates entry in `layoutFolder.guard.test.ts`, and `app/admin/users/page.tsx`. Requirement §13.4 rulings checked: SQ-8, SQ-9, SA-1c-1, SA-1c-5, SQ-16.

#### Conformance to the §13.4 rulings

| Ruling | Workplan | Verdict |
|---|---|---|
| SQ-8 | Key `currencies` via `textFilter({ key: 'currencies', defaultValue: 'enabled', isValid })` in module-level `exchangeRatesFilters.ts`. Default never written, unknown value ignored, `{ active }` from a prop defaulting to `true`, Step 0 re-greps `FINANCE_FILTER_SPEC` | ✅ Conforms |
| SQ-9 | Held set, `matches \|\| held`. Emptied on Refresh, on every successful plain read, and on any filter or search change. Count includes held rows. One render test (R-11) plus release paths (R-12) | ✅ Conforms in design. The add step is fixed in C-1 |
| SA-1c-1 | Nothing under `app/admin/finance/` is touched. Slice 2 passes `active` | ✅ |
| SA-1c-5 | `role="search"` "Filters", labelled native select and search input on the shared field constants, Clear disabled at defaults, trimmed literal `includes` with no `RegExp`, `AdminEmpty` with Clear | ✅ |
| SQ-16 | Sequential, not stacked | ✅. See Q-7 |

#### Rulings on §4

| # | Ruling |
|---|---|
| Q-1 | **Accepted: controls from the first render.** Show is URL state and means something before data arrives. Keeping one bar branch also stops Refresh moving. L-6 M-3 (Invites) was about a bar whose controls drive a server read; this bar filters locally, so the precedent does not bind |
| Q-2 | **Accepted: not a live region.** Announcing on every keystroke is worse than reading the line in flow. The empty state is already announced by `AdminEmpty` |
| Q-3 | **Accepted: retire by identity.** Verified in `useAdminFilters.ts`: `mergeKeepingIdentity` returns `prev` when nothing changed, and returns a new object on any value change. That covers outside re-reads (Back, a sidebar link) and Clear at defaults (identity kept, and `searchVersion` bumps). So `held.filters === filters && held.searchVersion === searchVersion` is a correct, effect-free gate, and a change and back cannot revive the set. Assign the refs (`filtersRef`, `searchVersionRef`) the same way the view already assigns `openCodeRef`, or in the render body. Either way, comment why the add step reads refs rather than closures (`patch` has `[]` deps) |
| Q-4 | **Confirmed: hold under every Show value.** It mirrors SQ-9 under Disabled only and does nothing under All. One assertion under Disabled only (switch JPY on → row stays) goes in R-12 or R-11 |
| Q-5 | **Accepted: `WHAT` stays in the view** |
| Q-6 | **Accepted: follow Businesses, no `<Suspense>`.** The page is already a client component under the dynamic admin layout, the same shape as `app/admin/users/page.tsx`. CI `Build` is the proof. If Build reports a missing-Suspense bailout, add the boundary in `page.tsx` with `fallback={null}`. Dev records that as a deviation, not a new pattern |
| Q-7 | **Satisfies SQ-16, and the hazard is already behind us.** The stacked-PR hazard is a PR whose base is the parent branch, so it merges into that branch and never reaches `main`. This plan never opens a PR against `feature/admin-exchange-rates-1c`, and it opens nothing until the parent is in `main`, so that hazard cannot arise. SA checked on 2026-10-20: **#482 has landed** (`origin/main` = `0c27b576`, a merge commit), `git merge-base --is-ancestor 1fc1313f origin/main` passes, and `origin/main` has no diff from `1fc1313f` under `app/admin/exchange-rates`, `app/admin/components/layout` or `app/admin/__tests__`. Step 9 can therefore run as soon as RM is ready. Conditions: (a) RM runs the ancestor check again right before the PR opens, because a re-queued or amended #482 would leave stale 1c.1 commits on this branch; (b) the PR base is `main`; (c) `git diff origin/main...HEAD --stat` lists only §5 files. If it shows any 1c.1 file, stop |

#### The specific checks asked for

| Item | Ruling |
|---|---|
| Search not a `pageOnly` field | **Approved.** Verified: a `pageOnly` field is still parsed from an inbound link and re-parsed on outside changes (`useAdminFilters.ts` lines 48 and 177-179). So `?search=` would be honoured, which the layout standard's free-text rule does not want here. Plain `useState` is the Businesses pattern (`users/page.tsx:140`, `canClear` at :466). SQ-8 allowed either |
| Held rows retired by object identity | **Sound** (Q-3). One gap in *adding* to the set: see C-1 |
| Three JPY tests selecting "All" first | **Approved, with C-2.** The hook works without a `next/navigation` mock: `useSearchParams()` is null outside the App Router, so `setFilters` updates state and nothing is written. The two existing EUR switch tests (lines ~316 and ~610: "Disabled" visible after the switch) now **depend on SQ-9 holding the row** under Enabled only. Leave them unedited, as a second proof of the held set |
| `layoutFolder.guard` edit | **Acceptable.** It is a registry addition (as `usersFilters.ts` and `costsFilters.ts` are in theirs), plus a comment and an "Amended by" line, with no rule change. The new module must satisfy the entry's per-file checks: no own `<h1`, no `.json(`, and shared-folder imports through the `@/` alias only |
| Fetch count stays 3, no `redundantPages` edit | **Confirmed.** G-6 strips comments before counting, and neither the new module nor the view adds a call. The new file is also walked by the bans (no `console.`, no `https?://`, no `.from(`). Keep URLs and `.from(` out of its *code*: `Array.from(` would trip the `.from(` ban, so build arrays with spread or `filter`. A red G-6 is a stop, never a guard edit |
| Rate editor reappearing (R-4) | **Accepted as recorded.** The editor state is keyed by code inside `ExchangeRatesTable`, so a hidden row's open editor returns when the row returns. Nothing is saved without a click. If the filtered result goes empty, the table unmounts (the `AdminEmpty` branch) and the draft is discarded, which is also acceptable. No fix in 1c.2. Note both behaviours in §6.1 so QA does not raise them as defects |

#### Required changes

| # | Where | Change |
|---|---|---|
| **C-1** | §3.2 item 3, the add step | **Add the held code in the same synchronous step that replaces the row, not after `patch` resolves.** Today `patch` calls `setPayload(...)` and then `return null`. The caller's `setHeld` would run in a later microtask. Correctness would then rest on React batching both updates into one render. That holds today, but no contract guarantees it. If the row renders once as "disabled, not held", it unmounts under Enabled only and remounts. Focus is lost, and SQ-9's whole point goes with it. Do the add inside `patch`, immediately **before** `setPayload`, only when `body.field === 'enabled'` (a rate save is never held). Keep the `fresh(h) ? add : new snapshot from refs` logic as written. R-11's same-DOM-node assertion is the pin. No new fetch, no new prop |
| **C-2** | §7.1 "Changed, `exchangeRates.render.test.tsx`" | In "fresh rows lose the chip", after selecting All, assert `getByTestId('rate-row-JPY')` exists before the `queryByTestId('stale-JPY')` null check, so the check cannot pass vacuously (risk R-1's own concern). The other two tests use `getBy…` on JPY and are self-proving |

#### Minor items (not blocking)

- §3.2 item 6 uses `atDefaults` in the `AdminEmpty` branch, but no such name is defined. Use the same expression as `canClear` (`!isDefault || searchTerm !== ''`), held in one const.
- R-14: also assert that the Show select reads "Enabled only" (the inactive mount takes the defaults without parsing), not only that `replaceState` was not called.
- The header comment of the new module must not contain the literal route with a scheme. Comments are stripped by G-6, but keep it consistent with the view's header.

### Approval
[x] Workplan approved. Proceed to implementation with C-1 and C-2 folded in. Short path: SA code review and QA, then the user's diff view, then RM.

### SA code review

**Code Review by SA — 2026-10-20**
**Status:** ✅ Code Approved (one condition, CR-11, which is on the QA probe block and not on Dev's code)

Read on `feature/admin-exchange-rates-1c2` at `0c27b576`, uncommitted: `git diff` (4 tracked files) and the three new files (`exchangeRatesFilters.ts`, `exchangeRatesFilters.test.ts`, `exchangeRatesFilters.render.test.tsx`). Also read for context: `useAdminFilters.ts` (parse, `mergeKeepingIdentity`, the write effect, `active`), `page.tsx`, `app/admin/layout.tsx`, `app/admin/users/page.tsx`, and the G-4 / G-6 blocks of `redundantPages.source.guard.test.ts`.

#### Code Review Comments

| # | Where | Finding | Priority |
|---|---|---|---|
| CR-1 | `ExchangeRatesView.tsx` `patch` | **C-1 conforms.** The held code is added inside `patch`, before `setPayload`, only when `body.field === 'enabled'`. The view comes from `filtersRef` / `searchVersionRef`, with a comment saying why (`patch` has `[]` deps). The refs are written in an effect after commit. That is safe, because a PATCH can only settle after the click's render has committed. The in-flight test (Show changed and changed back while the PATCH is held) tells the refs apart from closures: with a closure the snapshot would be the first `filters` object, the gate would fail and EUR would be hidden | — |
| CR-2 | `exchangeRates.render.test.tsx` | **C-2 conforms.** `getByTestId('rate-row-JPY')` comes before the null `stale-*` loop. The other two JPY tests use `getBy…` after `showAll()`, so they prove themselves. The two existing EUR switch tests are unedited, which keeps them as a second proof of the held set, as ruled | — |
| CR-3 | View, the bar | **Q-1 to Q-6 conform.** Controls show from the first render. The count line is a plain `<p>`, not a live region. Held rows are retired by identity with no reset effect. Holding works under every Show value (R-12 Q-4). `WHAT` stays in the view. No `<Suspense>`. **Q-7:** RM's three conditions still apply before the PR opens: run the ancestor check, use `main` as the base, and check that `git diff origin/main...HEAD --stat` lists only §5 files | — |
| CR-4 | View | **`canClear` conforms.** One const, `!isDefault \|\| searchTerm !== ''`, is used by both the bar and the `AdminEmpty` Clear. There is no `atDefaults` | — |
| CR-5 | `currencies` key | **Verified.** `textFilter` has `isValid: isCurrencyShow`. `parse` returns `enabled` for `currencies=enabled`, and the write effect's `projectSearch` drops a value equal to the default, so the mount write removes the key. A bogus or mixed-case value fails `isValid`, takes the default, and is removed by that same write. `setFilters` passes values through `toCurrencyShow`, so nothing outside the three values can enter the state. `currencies` is not a Finance key or alias | — |
| CR-6 | Search | **Kept out of the URL.** Search is not in the spec, not even as `pageOnly`. The hook reads an inbound `?search=` for nothing, and the write effect never sees the text. It is never logged (no logger call takes `searchTerm`). The match is `trim().toLowerCase()` with `String.prototype.includes`; no `RegExp` is built from the input. `maxLength` 64. U-6 pins the literal characters | — |
| CR-7 | KPIs / history | **Unfiltered.** `ExchangeRatesKpis` still gets `payload` (or null on error), never `rows`. The `RateHistoryTable` branches still read `payload.history` or the one-currency payload. Only `ExchangeRatesTable` gets `rows`. R-7 and R-8 pin this | — |
| CR-8 | Held rows | **Correct.** The gate (`held.filters === filters && held.searchVersion === searchVersion`) works because the hook gives a new object on any value change, outside changes included, and `NO_HELD`'s `filters: null` can never match. A change and back cannot bring the set back. The set is emptied on the Refresh click (before the read, so a failed Refresh releases it; QA Q-G pins that) and on every successful plain read. A one-currency history read does not empty it. `setEnabled` does no re-read, so a switch is not released by its own save. **One accepted edge, not introduced by this slice:** if a plain read is in flight when a switch settles, and the server answered that read before the PATCH, the read overwrites the switched row with the older state and releases the hold. The overwrite already happens to the row in 1a; holding does not make it worse. No fix | Low (note only) |
| CR-9 | `active` prop | **Conforms.** `ExchangeRatesView({ active = true }: ExchangeRatesViewProps = {})` passes `{ active }` to the hook. The hook reads it as a primitive, so an inline object is safe. `page.tsx` is unedited. R-14 asserts the inactive mount takes the defaults and never calls `replaceState` | — |
| CR-10 | Hooks, fetch count, guards | Every hook (`useAdminFilters`, `useState`, `useRef`, `useEffect`, both `useId`s) is called unconditionally at the top level, and there is no early return; Dev's `lint:hooks` run is clean. **No new `fetch(`:** the three call sites are unchanged and `redundantPages` passes unedited (G-6 count `toBe(3)`). The new module has no `Array.from(`, no URL with a scheme and no `console.`. The **`layoutFolder.guard` edit is registration only**: one file added to the Exchange rates entry, the entry comment reworded, one "Amended by" header line. No rule or helper changed, and the guard passes | — |
| CR-11 | `exchangeRatesFilters.render.test.tsx` | **Condition.** The suite does not compile at the moment because of the `QA probes` block that QA is appending: the `it.each` list in Q-D holds `'\'`, an unterminated string literal, so TS1128 is raised at the last line. **This is not Dev's code.** SA ran the folder and the guards: 4 of 5 suites passed (488 tests: `exchangeRatesFilters.test.ts`, `exchangeRates.render.test.tsx`, `redundantPages`, `layoutFolder.guard`). The new render suite could not be re-run independently while the probes are mid-edit. QA must fix the literal (`'\\'`) and show the whole suite green (Dev's 25 cases plus the probes) in §10 before RM | High (blocks RM, not QA) |
| CR-12 | No `<Suspense>` | **No build failure expected.** Next 14 refuses `useSearchParams` without a boundary only on a page it prerenders statically. `app/admin/layout.tsx` awaits `requireAdminPage`, which reads cookies, so every `/admin` route is dynamic. `app/admin/users/page.tsx` has the same shape (a client page, `useAdminFilters`, no boundary) and builds on `main`. CI `Build` is the proof. If it does report the bailout, the Q-6 fallback stands: a `Suspense` with `fallback={null}` in `page.tsx`, recorded as a deviation | — |
| CR-13 | View state | **No correctness bug found.** I traced these paths: a switch, then Show changed and back; a switch, then a search typed and cleared; a switch during an in-flight Refresh (Refresh clears the set, the PATCH holds the row, and the read's success clears it again, which is correct); Clear at the defaults (it cannot be clicked); the filtered result going empty (the table unmounts and the editor draft is lost, which R-4 accepted); a held code no longer in the payload (`visibleRates` adds nothing). Empty-state Clear is offered only while `canClear` is true. At the defaults the list cannot be empty while USD stays enabled | — |

#### Rulings on the deviations

| # | Ruling |
|---|---|
| DV-1 | **Approved.** `@/app/admin/exchange-rates/...` contains `/admin/exchange-rates`, and G-4 refuses that in code anywhere outside comments (the `(?<!/api)` lookbehind only exempts the API path). S-1 requires the alias only for the shared folder. A relative import inside a page's own folder is already established: `app/admin/analytics/components/*` import `'../analyticsFilters'` and `'../analyticsTypes'`. The reason is given in a comment beside the import. No guard edit. **Forward note for slice 2 (not this slice):** `FinanceView` will need `ExchangeRatesView`, and the alias path trips G-4 there too. The slice 2 workplan must plan for that: either a relative import from `app/admin/finance/components/` (`'../../exchange-rates/components/ExchangeRatesView'`), or a G-4 amendment through SA. It cannot be found only when the guard turns red |
| DV-2 | **Approved.** One `space-y-2` wrapper holds the count line with the table or the empty state. Layout only: no test id, role or landmark changed. `exchange-rates-content` still wraps it |
| DV-3 | **Approved.** The extra cases are `it.each` expansions and release paths of planned items (R-4, R-12), plus the in-flight PATCH case that pins C-1's refs. None of them reaches outside §7.1, and no CI time is added beyond the existing Jest gate |

#### Optimisation Suggestions

- None that need action. `visibleRates` runs on every render over about 40 rows, so `useMemo` would only add noise.

#### Code Approved for QA: Yes

QA may proceed now. RM may not proceed until CR-11 is closed: the render suite must compile and every case in it must pass, Dev's and QA's. The Q-7 checks in CR-3 come next, and then the user's diff view (short path).

---

## 10. QA Testing Report

**QA — 2026-10-20**
**Test mode:** full (short path, UI-only)
**Strategy used:** A + B-style render tests (Jest + jsdom, `next/navigation` mocked, real `history.replaceState` spied), plus the CI-parity source guards. D (manual browser check) is owed by the user, see below
**Focus:** ui, schema (URL state), regression of the 1a / 1c.1 page and the admin guards
**Skipped:** manual browser check and real keyboard focus (owed by the user); full `tsc` (OOMs here, Dev's narrow `tsc` stands; ts-jest compiles every test file it runs)
**Input source:** TL prompt (QA judgment for the probe list)

### Verdict

**PASS-WITH-NOTES.** No bugs. 14 QA probe cases added (render file only, `describe('QA probes …')`), all green. SA CR-11 (the `'\'` compile break in Q-D) is closed: the literal was replaced and the whole render suite is green (39 / 39).

### Runs

| Run | Result |
|---|---|
| §7.2 narrow set, `--ci`, before QA additions | **29 suites / 2,662 tests passed** (matches Dev's §6.1 figure) |
| §7.2 narrow set, `--ci`, after QA additions | **29 suites / 2,676 tests passed** (+14 QA probes) |
| `app/admin/exchange-rates` alone, `--ci`, twice more (flake check) | 101 / 101 both times (3 suites) |
| `exchangeRatesFilters.render.test.tsx` alone | 39 / 39 (Dev 25 + QA 14) |
| `eslint` on the edited render test | exit 0 |

### Test coverage (§8 slice 1c.2)

| Acceptance criterion | Tested? | Result | Test |
|---|---|---|---|
| Plain URL shows only enabled; Show reads "Enabled only"; no `currencies` key | ✅ | Pass | R-1; QA Q-A (inbound `currencies=enabled` normalised away) |
| Disabled only / All written as `currencies=disabled` / `all`; inbound URL reproduces; unknown → Enabled only | ✅ | Pass | R-2, R-3; QA Q-B (`ALL`, `All`, `Disabled`, `ENABLED` → ignored and removed) |
| Search on code or name, case-insensitive, never in the URL | ✅ | Pass | R-4 (5 terms + URL check), U-5, U-6; QA Q-C (inbound `?search=` ignored), Q-D (regex characters) |
| Clear returns to defaults, disabled at defaults; Read at / Refresh as 1a | ✅ | Pass | R-5, R-6; Q-A asserts Clear disabled after the `enabled` normalisation |
| KPI figures identical under all three Show values | ✅ | Pass | R-7 (three values plus a no-match search) |
| Count line right; nothing-matches shows the empty state | ✅ | Pass | R-9, R-10, U-8 (singular, thousands); QA Q-D, Q-E (empty by Show alone, Clear offered and works) |
| SQ-9: switched-off row stays, chip "Disabled", focus kept, until Refresh / filter / search change | ✅ (jsdom) | Pass | R-11 (same DOM node, `activeElement`), R-12 (a)(b)(c), in-flight PATCH case; QA Q-G (a **failed** Refresh still releases) |
| Country column | — | Dropped by the user | — |
| Bar follows the layout standard; layout and Exchange rates guards green | ✅ | Pass | R-13; guards below |

### Edge-case probes (TL list)

| Probe | Result | Where |
|---|---|---|
| `?currencies=enabled` | Opens Enabled only; the write strips the key (`?tab=x` kept); no view write ever carries `currencies` | Q-A |
| `?currencies=bogus` | Ignored, removed, unrelated key kept | R-3 |
| `?currencies=ALL` (mixed case) | Ignored (falls back to Enabled only, does **not** map to All) and removed. Correct per U-4 / U-1 unit case | Q-B, U-1 |
| `?search=x` inbound | Ignored: box empty, rows not narrowed. The key itself is left in the address bar (the hook keeps keys it does not own, like `tab`). Note N-2 | Q-C |
| Regex characters `(`, `.*`, `[`, `+?`, `^$` (unit also `\`, `.`, `*`) | No throw, no match, empty state with "Showing 0 of 4" | Q-D, U-6 |
| Case-insensitive code and name | Pass | R-4, U-5 |
| Clear disabled at defaults | Pass | R-5, Q-A |
| Empty state with Clear | Pass, both by search (R-10) and by Show alone (Q-E) | R-10, Q-E |
| Disabled only: switch a row on, it stays | Pass (same node) | R-12 (Q-4) |
| Refresh releases held rows | Pass, success (R-11) and failure (Q-G) | R-11, Q-G |
| USD under Disabled only | Not shown; shown under Enabled only and All | Q-F, U-4 |
| KPIs identical across filters | Pass | R-7 |
| Count line text | "Showing N of X currencies", singular at 1, thousands grouped | R-9, U-8 |

### CI-parity guards

| Guard | Result |
|---|---|
| `redundantPages.source.guard` G-6 (fetch count `toBe(3)`, line 234, unedited) | Pass |
| `layoutFolder.guard` (registry entry gains `exchangeRatesFilters.ts`; registration only) | Pass |
| `KpiStrip.callers.pin.render` | Pass (hashes unchanged) |
| `AdminSidebar.nav` | Pass |
| `admin-authz-surface.guard` | Pass |
| `app/admin/finance/__tests__/source.guard` and `lib/business-os/finance/__tests__/finance.source.guard` | Pass |
| CRLF safety | No new source scan was added by this slice (the `layoutFolder` edit is a registry entry and comments only; the new tests read no files). Every touched file is CRLF in this worktree (`core.autocrlf=true`) and every guard passed on it; CI checks out LF |

### Issues found

#### Bugs (must fix before commit)
None.

#### Performance issues
None. A filter or search change issues no request (R-13).

#### Edge cases / notes (no fix needed)
1. **N-1** Mixed-case `currencies=ALL` falls back to Enabled only rather than mapping to All. That is what U-4 says; noted only in case the user expects case folding.
2. **N-2** An inbound `?search=x` is ignored, but the key stays in the address bar until the admin leaves, because the hook only rewrites keys the spec owns. Harmless; stripping it would need `search` in the spec, which SA ruled out.
3. **N-3** The R-4 behaviours (an editor's draft comes back, or is discarded when the result goes empty) are as SA accepted; not raised.

### Owed by the user (manual, short path)
- Browser click-through of `/admin/exchange-rates`: default Enabled only, the three Show values and the URL, search, Clear, the empty state, Refresh.
- **Keyboard focus** under SQ-9: Tab to "Switch off EUR", press Enter/Space, confirm focus stays on the switch while the PATCH runs and after (jsdom does not blur a disabled button, so R-11 proves only that the node did not unmount, risk R-3).

### Final status
- [x] All acceptance criteria pass in Jest — ready for commit once the user's browser and keyboard check is done
- [ ] Issues found

---

## 11. Commit Info

*RM populates this section.*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-20 | Workplan written | Dev: slice 1c.2 (filter bar) planned on `feature/admin-exchange-rates-1c2` at `1fc1313f`. Scope quoted verbatim from the requirement (§1 1c row, §3.3, §5.5.1, FR-14 to FR-16, §8 1c.2, §13.4 SQ-8 / SQ-9 / SA-1c-1 / SA-1c-5 / Dev 1c.2). Questions Q-1 to Q-7 for SA. No code yet |
| 2026-10-20 | SA workplan review | **APPROVED-WITH-CHANGES** (§9). Q-1 to Q-7 accepted. Q-7: #482 already landed (`origin/main` `0c27b576`) and `1fc1313f` is an ancestor, so the PR is not stacked; RM re-checks before the PR opens and confirms the diff lists only §5 files. Search as plain page state is approved (a `pageOnly` field would still be read from an inbound link). The identity gate is sound; the layoutFolder registry edit is acceptable; the G-6 fetch count stays 3 with no guard edit; R-4 is accepted. Required: **C-1** add the held code inside `patch`, before `setPayload`, for `enabled` changes only; **C-2** assert the JPY row exists in "fresh rows lose the chip" before the null check |
| 2026-10-20 | Implemented | Dev: built uncommitted on `0c27b576` with SA C-1, C-2, Q-4 and the minor items (§6.1). Deviations DV-1 (relative import: the alias path tripped G-4) to DV-3. Narrow Jest 29 suites / 2,662 tests passed; narrow `tsc` 0 errors; `eslint` and `lint:hooks` clean. Awaiting SA code review and QA |
| 2026-10-20 | SA code review | **Code Approved** (§9, SA code review, CR-1 to CR-13). C-1, C-2, Q-1 to Q-7 and the `canClear` const conform. DV-1 (a relative import, because the alias path trips G-4), DV-2 and DV-3 approved. Verified: the `currencies` default is never written and unknown values are ignored; the search stays out of the URL and the logs, matched as a literal; the KPIs and history read the full payload; the held-rows gate and the C-1 refs; `active` defaults to true; hooks rules; the fetch count is still 3; the layoutFolder edit is registration only; no build risk without `<Suspense>` (the same shape as Businesses). Condition CR-11: QA's in-progress probe block breaks the render suite's compile (`'\'` in Q-D); it must be fixed and the whole suite shown green before RM. Forward note for slice 2: `FinanceView`'s import of the view will meet the same G-4 rule |
| 2026-10-20 | QA | **PASS-WITH-NOTES** (§10). §7.2 narrow set `--ci`: 29 suites / 2,662 before QA, **29 / 2,676** after 14 QA probes (render file only: inbound `currencies=enabled` normalised, mixed-case values ignored, inbound `?search=` ignored, regex characters, empty by Show alone with Clear, USD under Disabled only, failed Refresh releases held rows). SA CR-11 closed: the Q-D literal fixed, render suite 39 / 39. All §8 1c.2 criteria mapped; no bugs; notes N-1 to N-3. Guards green (G-6 fetch count 3, layoutFolder, KpiStrip pin, sidebar, authz surface, both finance guards); no new source scan, CRLF-safe. Owed by the user: browser click-through and keyboard focus under SQ-9 |
