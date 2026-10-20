# Workplan: Admin exchange rates, slice 2a (Finance tab)

> **Last Updated**: 2026-10-20

**Developer:** Dev
**Requirement:** [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md) §1 (rows 2a / 2b), §3.3 (comment 1), §5.3 (5.3.1 to 5.3.4), FR-12, FR-23 to FR-25, FR-27, §8 slice 2a, §13.5 (SQ-17 to SQ-24, SA-2-1 to SA-2-8, Dev 2a steps)
**Branch:** `feature/admin-exchange-rates-2-finance-tab` (worktree `neuronforge-fx-rates-2`, at `origin/main` `adb1c6e8`, which includes 1a #477, 1b #479, 1c.1 #482 and 1c.2 #484). The requirement carries the BA's uncommitted slice 2 edits; they are kept as they are.
**Date:** 2026-10-20
**Status:** Code Complete (uncommitted, awaiting SA code review + QA). SA workplan review APPROVED-WITH-CHANGES (§9); every ruling and SA-2a-1 to SA-2a-4 applied (§6.1)

## Overview

Slice 2a adds Exchange rates as the fourth and last tab of `/admin/finance`, at `?tab=exchange-rates`. This answers the user's page comment 1 with the follow-up answer "Finance tab only": no Settings link and no sidebar change. The tab renders the existing `ExchangeRatesView` (1c refined) from its own folder. On that tab the page hides the Finance KPI strip, the Finance filter bar, the finance error, the finance loading text and the window "as of" line. The page keeps one h1, "Finance", with the rates purpose sentence. The rates show whether or not the finance read has finished or failed. Finance's filter spec gains the rates `currencies` key as the same field object, plus one repair rule, so every tab switch stays one URL write. The finance request string does not change. The old URL keeps working: during 2a the standalone page renders the header itself. The redirect, the page delete and the layoutFolder registry move are slice 2b. Nothing converts money, and nothing on finance reads a rate (D-5, BD-12, CUR-3).

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

Every block below was extracted with `sed -n` from the requirement's working copy in this worktree (uncommitted slice 2 edits included) on 2026-10-20. The line numbers are that file's. Nothing was retyped. Where §1 had a single slice 2 row, the BA's split (SA-2-4) replaced it with rows 2a and 2b, so those two rows are quoted.

### 1.1 §1 Progress, rows 2a and 2b (lines 39-40, 43-44)

| # | Slice | Status | PR | Notes |
|---|---|---|---|---|
| 2a | Exchange rates as a fourth tab under the Finance admin page (no revenue link). **Finance tab only** (user, D-7), no Settings link. FR-23 to FR-25, FR-27 | 🟡 SA cleared with changes (§13.5); workplan next | — | User go-ahead 2026-10-20: "start slice 2 (the Finance tab)". SA split slice 2 into 2a / 2b (SA-2-4). Branch from `origin/main` once 1c.2 (PR #484) has merged. TL picks full cycle or short path (a money page's layout changes, no figure, request or data path) |
| 2b | Old URL retired: `next.config.js` temporary redirect `/admin/exchange-rates` → `/admin/finance?tab=exchange-rates`, `app/admin/exchange-rates/page.tsx` deleted (SQ-17 (a)). FR-26 | ⬜ After 2a | — | Branches from `origin/main` **after 2a merges, not stacked** (SA-2-4). Config + tests only; separately revertible |

### 1.2 §3.3 User page review, the slice 2 row (lines 127-129)

| # | User comment (verbatim) | Follow-up answer (verbatim) | Decision | Built in |
|---|---|---|---|---|
| 1 | "add it to the settings section of the admin side bar." | Placement: "Finance tab only" | **Replaced by the follow-up answer.** No Settings sidebar link. The page is reached from the Finance tab (slice 2) and by typing its URL (D-6) | **Slice 2** (resolves comment 1) |

### 1.3 §5.3 Slice 2, Finance tab, with 5.3.1 to 5.3.4 (lines 182-272)

### 5.3 Slice 2 — Finance tab

> **Note (2026-10-19, D-7).** The user's page comment 1 ("add it to the settings section of the admin side bar") is **resolved by this slice**: the follow-up answer was "Finance tab only". There is **no Settings sidebar link** and no other sidebar change; D-6, G-2, G-4 and the sidebar `UNLISTED` entry stay. Slice 2 is built **after slice 1c**, so the tab renders the refined view.
>
> **Baseline drift, for the slice 2 workplan.** The paragraph below says the Finance page has no tabs. On `origin/main` `0581637a` it already has three (`app/admin/finance/components/FinanceTabs.tsx`: Overview, Accounts, Plans, selected by `?tab=` through `useAdminFilters`). Slice 2 therefore adds a **fourth tab to an existing tablist**, not tabs from scratch. The Plans tab already owns the URL key `status`, **and the Accounts tab owns `show`** (`FINANCE_FILTER_SPEC.show`: `all` / `active` / `negative`; `financeFilterRepair` resets a non-default `show` whenever the tab is not Accounts), which is why slice 1c's filter uses the key **`currencies`** (SQ-8 ruling, SA-1c-1). BA refreshes this section from `origin/main` before the slice 2 workplan.
>
> **For slice 2 (SA-1c-1).** `FINANCE_FILTER_SPEC.tab` (today `['accounts', 'plans']`) and `financeFilterRepair` must learn the new `exchange-rates` tab, and the exchange-rates view's filter hook runs with `{ active: tab === 'exchange-rates' }`. Slice 2 concern only; nothing in 1c touches `app/admin/finance/`.

> **Refreshed by BA 2026-10-20** from branch `feature/admin-exchange-rates-2-finance-tab` at `c38ad4f4` (the slice 1c.2 tip; 1c.2 is PR #484, in the merge queue). The notes above are kept for the record; the text below **replaces** the 2026-10-19 slice 2 paragraph, which was written when `/admin/finance` had no tabs. User decisions, **not reopened**: placement "Finance tab only" (comment 1, D-7: no Settings link, no new sidebar entry); no linkage to customer revenue (D-5; nothing on finance reads a rate, BD-12, CUR-3); go-ahead on 2026-10-20: "start slice 2 (the Finance tab)".

#### 5.3.1 Finance today (as built)

| File | Today |
|---|---|
| `app/admin/finance/page.tsx` | `'use client'` (authz guard R8), wraps `FinanceView` in `<Suspense>` (`useSearchParams`, Next 14) |
| `app/admin/finance/components/FinanceTabs.tsx` | Page-local APG tablist, manual activation: Left / Right wrap, Home / End, Enter / Space selects, roving `tabIndex`, `aria-controls` / `aria-labelledby`. `FinanceTab = 'overview' \| 'accounts' \| 'plans'`; labels from `financeCopy.ts` (`TAB_OVERVIEW` "Overview", `TAB_ACCOUNTS` "Accounts", `TAB_PLANS` "Plans & subscriptions", `TABS_LABEL` "Finance views"). The finance source guard pins that no file outside `app/admin/finance/` imports it |
| `app/admin/finance/financeFilters.ts` | `FINANCE_FILTER_SPEC`, keys in this order: `window` (`range` / `from` / `to`, alias `preset`), `account` (alias `accountId`), `tab` = `choiceFilter('tab', ['accounts', 'plans'], '')`, `sort`, `group`, `show`, `status`. `FinanceFilters.tab: '' \| 'accounts' \| 'plans'`. `toFinanceQuery` sends `tab` to the finance route **only** for Accounts with no business, so the Plans tab's read is the Overview's. `financeFilterRepair`, in order: (1) "Since it started" without a business → default window; (2) a business with any tab or tab key → drop the tab and its keys (the business wins); (3) tab not Accounts and `sort` / `group` / `show` not at default → reset them; (4) tab not Plans and `status` set → reset it. `FINANCE_CLEAR_PATCH` keeps the tab |
| `app/admin/finance/components/FinanceView.tsx` | One `useAdminFilters(FINANCE_FILTER_SPEC)` (no `active` option). `useFinanceData(queryString)` reads the finance route on **every** tab. Order: `AdminPageHeader` (h1 "Finance", `asOf` = the window label) → `FinanceKpiStrip` (only when data; placeholders while the first read runs) → `FinanceFilterBar` (window, business picker, Clear, Read at, Refresh) → the content area. **The tablist and every panel render only inside `data && !error`**, and there is no tablist with a business picked. A panel is mounted only while its tab is selected (unmounted on leave), unlike Business OS AI, which keeps a visited tab mounted and hidden. `onSelectTab`: Accounts → `{ tab, status: '' }`; Plans → `{ tab, ...TAB_RESET }`; Overview → `{ tab: '', ...TAB_RESET, status: '' }`, one write each |
| Finance tests that pin the tab count | `financePage.render.test.tsx` (~line 1787: the three tab names, in order); `accountsTab.render.test.tsx` (~line 209: the keyboard test, "the keys wrap over three"); `financeFilters.test.ts` (the spec's tab values) |

#### 5.3.2 How the fourth tab fits

| Part | Spec |
|---|---|
| Tab | **Fourth and last**, after Plans & subscriptions. Label **"Exchange rates"** (new `TAB_EXCHANGE_RATES` in `financeCopy.ts`). Id `exchange-rates`; URL `?tab=exchange-rates` (SQ-4). Overview stays the default (no `tab` key), so every existing link keeps working |
| Types and spec (SA-1c-1, SA-2-2, SQ-20 (1)) | `FinanceTab` and `FinanceFilters.tab` gain `'exchange-rates'`; `FINANCE_FILTER_SPEC.tab` becomes `['accounts', 'plans', 'exchange-rates']`. **One finance key is added:** `FinanceFilters` gains `currencies: string`, and `FINANCE_FILTER_SPEC` gains, as its **last** key (after `status`), `currencies: EXCHANGE_RATES_FILTER_SPEC.currencies` — **the same field object**, never a copy, so both hooks parse and serialise the key identically and can never disagree on a URL. No existing finance key is renamed or re-ordered. A Dev comment at the new field says why two specs owning one key is safe: one shared field object, and the view's hook exists only while its tab is shown (SA-2-5). `toFinanceQuery` / `fromFinanceQuery` are untouched; `FINANCE_CLEAR_PATCH` and `financeCanClear` do **not** learn the key |
| `financeFilterRepair` (SA-1c-1, SA-2-2, SQ-20 (3)) | Its existing rules cover the tab itself. A business still drops it (rule 2, the business wins, so `?account=…&tab=exchange-rates` opens that business's Overview view); `show` / `sort` / `group` reset because the tab is not Accounts (rule 3); `status` resets because the tab is not Plans (rule 4). **One new rule, after rule 4:** tab not `exchange-rates` and `currencies` not at its default → `{ currencies: <default> }` (a pasted `?currencies=all` on Overview, or on a business link once rule 2 has dropped the tab; SQ-24). On the tab the new rule returns nothing |
| `onSelectTab` / `selectedTab` (SQ-20 (2), SQ-24) | Exchange rates → `{ tab: 'exchange-rates', ...TAB_RESET, status: '' }`, one write. The Overview, Accounts and Plans branches add `currencies: DEFAULT_CURRENCY_SHOW` (imported with the spec), so leaving the tab is still **one** write. `selectedTab` is `'exchange-rates'` when `filters.tab === 'exchange-rates'` and no business is picked (`query.accountId === null`), so the view never mounts on a business link |
| Request (SQ-19 (ii)) | **Unchanged.** `toFinanceQuery` still sends `tab` for Accounts only, and the request string does not include `currencies`, so on this tab the finance request string is the Overview's (as Plans) and `financeRequest.pin` is unchanged. The finance read **keeps running** on this tab (the Plans precedent), so Overview has its data on return; skipping it is a later optimisation, not this slice |
| Panel | `<FinanceTabPanel id="exchange-rates">` renders the existing `ExchangeRatesView`, reading the same admin route (`GET` / `PATCH /api/admin/exchange-rates…`), same edit, toggle, filter bar, KPIs and history |
| Where the view lives (SA-R13, CUR-3) | **Stays in `app/admin/exchange-rates/components/`.** The finance tab only imports and renders it. No file under `app/admin/finance/**` contains `exchange_rates` (new finance tests included); the hyphenated `exchange-rates` does not match. `finance.source.guard` and `app/admin/finance/__tests__/source.guard.test.ts` stay unchanged and green |
| Import (DV-1) | The alias path `@/app/admin/exchange-rates/components/ExchangeRatesView` contains `/admin/exchange-rates`, which `redundantPages` G-4 refuses in code (only a match preceded by `/api` is exempt). **Ruled (SQ-18):** `FinanceView.tsx` imports `{ ExchangeRatesView, EXCHANGE_RATES_PURPOSE }` from `'../../exchange-rates/components/ExchangeRatesView'`, and `financeFilters.ts` imports `EXCHANGE_RATES_FILTER_SPEC` from `'../exchange-rates/exchangeRatesFilters'`; each with a one-line comment saying the alias would spell the page route G-4 refuses (DV-1). No G-4 edit. No finance file imports `lib/admin/exchangeRates/**` directly |
| Finance chrome on this tab (SQ-19 (i)) | When `selectedTab === 'exchange-rates'`, `FinanceView` renders, under the header, the tablist and the rates panel **outside** the `data && !error` gate, and renders **none** of: `FinanceKpiStrip`, `FinanceKpiPlaceholders`, `FinanceFilterBar` (window, business picker, Clear, Read at, Refresh), the finance `AdminError`, the finance `AdminLoading`, or an `aria-busy` that reflects the finance read; the header's window `asOf` is `null`. None of them applies to rates: rates have no window and no business, and the finance tiles describe money. The view brings its own KPI strip (Enabled currencies, Last rate change), its own bar (Show, Search, Clear, Read at, Refresh), its own states and its own busy flag. The **tablist stays visible**, so the admin can go back. Overview, Accounts and Plans render exactly as today. For the user's diff review: on this tab the tablist sits directly under the header, on the others under the KPI strip and filter bar (an inherent layout shift of hiding the chrome, not a blocker) |
| One h1 (SQ-21) | **Exactly one h1, "Finance".** The view drops its `AdminPageHeader` (and the import) and exports its sentence as `EXCHANGE_RATES_PURPOSE` (the existing `PURPOSE` text, unchanged, still in `ExchangeRatesView.tsx`). On this tab `FinanceView`'s header is `title={PAGE_TITLE}`, `purpose={EXCHANGE_RATES_PURPOSE}`, `asOf={null}` (the Business OS AI precedent, L-8a, F-68). No `showHeader` prop. **During 2a only**, `app/admin/exchange-rates/page.tsx` renders `<AdminPageHeader title="Exchange rates" purpose={EXCHANGE_RATES_PURPOSE} />` above the view, so the standalone URL keeps its h1 until 2b deletes the page. `ExchangeRatesKpis.tsx` is not edited |
| Not gated on the finance read (SQ-19 (i)) | Today the tablist and panels sit inside `data && !error`. On this tab the rates show while the finance read is still running and when it has failed, with no finance error and no finance loading text, since they do not depend on it |
| The view's filter hook (SQ-20 (4), amends SA-1c-1) | The view is rendered **without** an `active` prop (default `true`); no `owns()` gating. Finance unmounts a hidden panel, so the view's hook exists only while its tab is selected; it starts at the default because leaving the tab and the repair remove `currencies`; a Show change is written by the view's hook and Finance's hook re-parses it to the same value (no write, no request). The view's `active` prop and its R-14 test stay (the L-9a contract); the view's header comment line 44 is corrected to "Finance unmounts hidden panels, so no caller passes false today" |
| No revenue link | Nothing on the finance page reads a rate; no finance figure, tile or section changes; no file under `app/admin/finance/` imports `lib/admin/exchangeRates/**` (only the view's own files do) |
| Sidebar | **No change.** Finance is already in the sidebar. No Settings link, no new item; G-2 stays (the sidebar names no `exchange-rates`) |
| KPI links | No Finance KPI tile links to the new tab (BA default; the finance tiles are about money) |

#### 5.3.3 The old URL (SQ-4)

SQ-4 ruled: `/admin/exchange-rates` becomes a server `redirect('/admin/finance?tab=exchange-rates')`. Authz guard **R8** (`lib/admin/__tests__/admin-authz-surface.guard.test.ts`) accepts a render entry point under `app/admin/**` that is a client component **or** a server page whose first statement awaits `requireAdminPage()` (R8's self-guarding clause, `guardsItselfFirst`); its exemption lists `R8_PARKED` and `R8_PERMANENT` are **empty and capped at 0** "and it has to stay that way". So a Server Component `page.tsx` that calls `redirect()` **fails R8 unless its first statement awaits `requireAdminPage()`**; none exists under `app/admin`, and SA rejects introducing one here (SQ-17 (d), SA-2-1).

**Ruled (SQ-17, 2026-10-20): option (a), built in slice 2b.** (b), (c) and (d) rejected.

| Option | What | Ruling |
|---|---|---|
| (a) **Ruled** | The Money MK-4 precedent: one temporary redirect in `next.config.js` `redirects()` — `{ source: '/admin/exchange-rates', destination: '/admin/finance?tab=exchange-rates', permanent: false }`, no `has`, with a comment in the existing style — and `app/admin/exchange-rates/page.tsx` is **deleted** (as `/admin/subscriptions` was for the Plans tab) | ✅ R8 untouched. The incoming query is kept and the destination's `tab` wins (`prepareDestination`, Next 14.2.35): `?currencies=all` arrives with it, `?tab=accounts` still lands on Exchange rates. The redirect runs before the admin layout; the destination is gated by it, so a non-admin still gets the layout's refusal. New test `app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts` in the `subscriptionsRedirect.config.test.ts` shape (shape block + `prepareDestination` block, asserting the parsed query object); `chargeChecksRedirect.config.test.ts` "three redirects in all" becomes four |
| (b) | Keep `page.tsx` as a `'use client'` component that calls `redirect()` from `next/navigation` during render | ❌ Rejected: a client page whose only job is to leave; drops the query unless it adds `useSearchParams` and a Suspense boundary; renders a flash first |
| (c) | A Server Component page + an R8 exemption, cap 0 → 1 | ❌ Rejected: R8 stays at 0 |
| (d) | A self-guarding server page (`await requireAdminPage()` first, then `redirect()`) | ❌ Rejected although R8 accepts it: it would be the first server-rendered page under `app/admin`, a new pattern (CLAUDE.md rule 7) for no gain over (a) |

#### 5.3.4 Guards and tests the slice touches

> **Ruled list (SQ-23, SA-2-3, 2026-10-20).** This table replaces the BA's first draft, which named a `financeFilters.test` tab-values pin that does not exist and missed the `currencies` lines, `financeFilterBar.layout` `DEFAULTS` and the sidebar on-disk floor. Dev shows each forced-edit file's diff in the handover, and nothing else in those files changes.

**Unchanged in both 2a and 2b**

| Guard or test | Effect |
|---|---|
| `redundantPages` **G-4** (no product code names `/admin/exchange-rates`) | **Unchanged.** `/admin/exchange-rates` stays in `PAGE_ROUTES`: in-app links go to the tab, never to the old URL. The redirect target does not name it; `next.config.js` is outside the walk roots (`app`, `lib`, `components`, `hooks`); the relative imports pass (SQ-18) |
| `redundantPages` **G-2** | Unchanged (sidebar not edited) |
| `finance.source.guard`, `app/admin/finance/__tests__/source.guard.test.ts` | **Unchanged** (SA-R13). FinanceTabs stays page-local; no `exchange_rates`; no repository or `server-only` import in finance files. New test files must not contain `exchange_rates` either (SA-2-6) |
| `KpiStrip.callers.pin`, `financeTiles.pin`, `financeRequest.pin` | **Not affected.** `ExchangeRatesKpis` is not edited, so every hash stays; the Finance strip is simply not rendered on this tab and the request string does not change |
| Authz **R8** | Nothing: one render entry point fewer after 2b; no exemption, cap stays 0 |

**2a — forced edits to existing tests (the complete list)**

| Test | Edit |
|---|---|
| `app/admin/finance/__tests__/financePage.render.test.tsx:1787` | The tab names list becomes four: Overview, Accounts, Plans & subscriptions, Exchange rates |
| `accountsTab.render.test.tsx` keyboard test (~209-239) | Wraps over four: Right from Plans, End, and Left from Overview land on Exchange rates; one more `ArrowRight` step; comment updated |
| `financeFilters.test.ts` lines **48, 52, 60** | `currencies` added: line 48 (`parseLink` builds every field), line 52 (`DEFAULTS`), line 60 (the `Object.keys(FINANCE_FILTER_SPEC)` list, `currencies` last) |
| `financeFilterBar.layout.render.test.tsx:39` | `currencies` added to `DEFAULTS: FinanceFilters` (a type error once the field is required) |

**2a — not touched:** G-4, G-6, the layoutFolder registry, `AdminSidebar.nav.test.ts`, `next.config.js`, `chargeChecksRedirect.config.test.ts` and the two rates render suites (the standalone page still renders the h1 they assert).

**2a — new tests (SA-2-6),** in `financePage.render.test.tsx` or a new `app/admin/finance/__tests__/exchangeRatesTab.render.test.tsx`: (1) select the tab from Overview → exactly one `replaceState`, `?tab=exchange-rates`, Accounts keys and `status` reset; rates table, Show select, rates KPIs and history render; no Finance strip, no Finance filter bar, no window `asOf`; exactly one h1, "Finance", with the rates purpose sentence. (2) `?tab=exchange-rates` with the finance read pending and with it failing → the rates render; no finance error, no finance loading text. (3) `?tab=exchange-rates&currencies=all` opens All; change Show; leave to Overview → one write, no `currencies` key; `?currencies=all` on Overview is repaired away. (4) `?account=<id>&tab=exchange-rates` → the business view, no tablist, the view not mounted, the URL keeps `account` only. (5) The finance request string on this tab equals the Overview literal. (6) `financeFilters.test.ts` gains the new repair rule (and null on the tab), and `currencies` is `EXCHANGE_RATES_FILTER_SPEC.currencies` by identity (`toBe`).

**2b — forced edits to existing tests (the complete list)**

| Test | Edit |
|---|---|
| `chargeChecksRedirect.config.test.ts:50-53` | "three redirects in all" → four (`toHaveLength(4)`, test name and comment) |
| `redundantPages` **G-6** (Exchange rates folder) | Drop `expect(files).toContain(EXCHANGE_PAGE)` and the "the REDUNDANT header is gone from the page" test (both read the deleted file); delete the then-unused `EXCHANGE_PAGE` constant; the guard's header gains an "Amended by slice 2" line. 6 non-test files remain (≥ 5 holds); the `fetch(` count stays **3**; the module logger rule is unchanged |
| `AdminSidebar.nav.test.ts` | **On-disk floor 29 → 28** (`expect(onDisk.length).toBeGreaterThanOrEqual(29)`, line 167, becomes 28); `expect(onDisk).toContain('/admin/exchange-rates')` (line 177) becomes `not.toContain` (the MK-4 Subscriptions precedent); `/admin/exchange-rates` leaves `UNLISTED`; the two stale comments (above `UNLISTED`, lines 89-91, and header line 28 "Both pages stay on disk") are rewritten. **`allHrefs` stays 28**; "never names `exchange-rates`" (line 203) stays. No new sidebar item |
| `layoutFolder.guard` C-14 registry (SQ-22) | The `'/admin/exchange-rates (Exchange rates)'` entry is removed and its five non-page files are appended to the `'/admin/finance (Finance)'` entry, with a comment in the Charge checks form ("the view stays in `app/admin/exchange-rates/` (SA-R13) and is listed here, and only here"). `changedByText.ts` is not added |
| `exchangeRates.render.test.tsx`, `exchangeRatesFilters.render.test.tsx` | Render `<ExchangeRatesView />` instead of `import ExchangeRatesPage from '../page'` (lines 44 and 34); the h1 assertion at `exchangeRates.render.test.tsx:173` becomes "the view renders no h1" (the one-h1 check lives in the new Finance tests) |

**2b — new test:** `app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts` per SQ-17 (§5.3.3).

### 1.4 §6 Functional requirements: FR-12, FR-23 to FR-25, FR-27 (lines 364-365, 377, 388-390, 392)

| # | Requirement | Slice |
|---|---|---|
| FR-12 | Exchange rates is a tab on `/admin/finance`; the existing finance view is the default tab and is unchanged | 2a |
| FR-23 | The Finance tablist has a fourth and last tab, "Exchange rates", at `?tab=exchange-rates`, keyboard-usable like the other three (§5.3.2) | 2a |
| FR-24 | On that tab the Finance KPI strip, the Finance filter bar and the window "as of" line are not shown; the rates view's own KPIs, filter bar and states are; the page has exactly one h1, "Finance" (§5.3.2, SQ-21) | 2a |
| FR-25 | The rates on the tab show whether or not the finance read has finished or failed, with no finance error or loading state on the tab (SQ-19) | 2a |
| FR-27 | No sidebar change: no Settings link and no new item (D-7) | 2a |

### 1.5 §8 Acceptance criteria, slice 2a (lines 467-483)

**2a — the tab** (FR-23 to FR-25, FR-27)

- [ ] `/admin/finance` with no `?tab=`, and with `tab=accounts` or `tab=plans`, looks and behaves exactly as before. Existing finance tests stay green; the only edits to them are the 2a forced edits in §5.3.4 (tab names list, keyboard wrap over four, `currencies` at `financeFilters.test` lines 48 / 52 / 60, `financeFilterBar.layout.render.test.tsx:39` `DEFAULTS`).
- [ ] The tablist reads Overview, Accounts, Plans & subscriptions, Exchange rates. Left / Right wrap over four, Home / End, Enter / Space selects, roving `tabIndex`, manual activation (the existing FinanceTabs behaviour).
- [ ] **One write per tab switch:** selecting Exchange rates from any tab writes `?tab=exchange-rates` in exactly one `replaceState` and resets the Accounts keys and `status`; leaving it for Overview, Accounts or Plans is also exactly one write. Opening `?tab=exchange-rates` selects it.
- [ ] `/admin/finance?tab=exchange-rates` shows the rates table, filter bar (Show, default Enabled only, `currencies` in the URL), KPIs (Enabled currencies, Last rate change) and history, with the same edit and on / off behaviour as 1c.
- [ ] On that tab there is no Finance KPI strip (nor its placeholders), no Finance filter bar (window, business, Clear, Read at, Refresh) and no window "as of" line.
- [ ] **Exactly one h1, "Finance"**, on that tab, followed by the rates purpose sentence (`EXCHANGE_RATES_PURPOSE`); the rates view renders no h1 of its own (SQ-21). The standalone `/admin/exchange-rates` page keeps its "Exchange rates" header until 2b.
- [ ] **Rates visible while the finance read is pending or failing:** with the finance read still loading, and with it failed, the rates render; **no finance error, no finance loading text** and no `aria-busy` tied to the finance read appear on the tab (SQ-19 (i)).
- [ ] **`currencies` behaviour (SQ-20):** `FINANCE_FILTER_SPEC.currencies` is `EXCHANGE_RATES_FILTER_SPEC.currencies` by identity (`toBe`), and it is the spec's last key. `?tab=exchange-rates&currencies=all` opens All; a Show change is written once by the view and causes no finance request; leaving the tab leaves no `currencies` key in the address bar; `?currencies=all` on any other tab is repaired away by the new `financeFilterRepair` rule (which returns nothing on the tab). The view is rendered without an `active` prop.
- [ ] **The business wins (SQ-24):** `?account=<id>&tab=exchange-rates` shows the business view with no tablist, the rates view is not mounted, and the URL keeps `account` only (the tab and any `currencies` dropped by the existing rule 2 and the new rule).
- [ ] **Request string unchanged:** the finance request string on every tab, this one included, equals today's (on this tab, the Overview literal); `financeRequest.pin` green unedited; the finance read keeps running on the tab (SQ-19 (ii)).
- [ ] No finance figure changes; `finance.source.guard` and `app/admin/finance/__tests__/source.guard.test.ts` unchanged and green; no file under `app/admin/finance/` (new tests included) contains `exchange_rates`.
- [ ] `FinanceView` and `financeFilters.ts` import from the rates folder by relative path without naming `/admin/exchange-rates` (SQ-18); `redundantPages` G-4 unedited and green.
- [ ] The sidebar is unchanged (no Settings link, no new item; `allHrefs` 28).
- [ ] `KpiStrip.callers.pin` unchanged (no hash moves).
- [ ] Nothing does arithmetic on a rate (D-5).

### 1.6 §13.5 SA review, slice 2, in full (lines 718-793)

### 13.5 SA review — slice 2

**Reviewed by SA — 2026-10-20** (requirement review of §5.3.1 to §5.3.4 as refreshed by the BA on 2026-10-20, FR-23 to FR-27, §8 slice 2, the §11 slice 2 defaults, SQ-17 to SQ-24). Code read from `feature/admin-exchange-rates-2-finance-tab` at `c38ad4f4`; Next internals from the installed `next` 14.2.35.
**Verdict: CLEARED-WITH-CHANGES.** The approach is right and proportionate: one more tab on the existing page-local tablist, the view rendered where it already lives, the old URL retired by the MK-4 mechanism, no route, repository, migration, sidebar or finance-figure change. Three BA statements are wrong or incomplete against the code (SA-2-1: R8 does accept one kind of server page; SA-2-2: §5.3.2 says no finance key is added while SQ-20 adds one; SA-2-3: the forced-edit list misses two edits and names one that does not exist). **Slice 2 is split into 2a and 2b** (SA-2-4), sequential, not stacked. User decisions **not reopened**: "Finance tab only" (no Settings link, no sidebar item, D-7), no link to revenue (D-5), nothing in finance reads a rate (BD-12, CUR-3).

**Verified against the code:**

| Claim | Result |
|---|---|
| Authz R8 forbids a Server Component `page.tsx` that calls `redirect()` | ⚠️ **Partly.** `lib/admin/__tests__/admin-authz-surface.guard.test.ts` R8 accepts a render entry point that is a client component **or** a server page whose first statement awaits `requireAdminPage()` ("the rule's second accepting clause", `guardsItselfFirst`, proved on the `SELF_GUARDING_SERVER_PAGE` fixture). `R8_PARKED` / `R8_PERMANENT` are empty and the cap is 0, as stated. So a self-guarding server page with `redirect()` would pass R8 with no exemption. No such page exists in `app/admin` today (SA-2-1) |
| MK-4 precedent: a `next.config.js` redirect that keeps the query, page deleted | ✅ `next.config.js` `redirects()`: `{ source: '/admin/subscriptions', destination: '/admin/finance?tab=plans', permanent: false }`, no `has`; `app/admin/subscriptions/` is gone; pinned by `app/admin/finance/__tests__/subscriptionsRedirect.config.test.ts` (shape + `prepareDestination`) |
| Option (a): `/admin/exchange-rates?currencies=all` lands on `/admin/finance?tab=exchange-rates&currencies=all` | ✅ `next/dist/shared/lib/router/utils/prepare-destination.js` sets `parsedDestination.query = { ...query, ...parsedDestination.query }`: the incoming `currencies=all` is kept and the destination's `tab` wins over any incoming `tab` (e.g. `?tab=accounts` still lands on Exchange rates). Key order in the string may differ (`currencies` first); Finance's hook re-projects it in spec order on mount with one cosmetic `replaceState`. Tests assert the parsed query object, not the string |
| G-4 is unaffected by a relative import | ✅ `redundantPages.source.guard` G-4 matches `(?<!/api)/admin/exchange-rates` in code with comments stripped. `'../../exchange-rates/components/ExchangeRatesView'` (from `app/admin/finance/components/`) and `'../exchange-rates/exchangeRatesFilters'` (from `app/admin/finance/`) contain no `/admin/exchange-rates`. `next.config.js` is outside `WALK_ROOTS`. A comment naming the route is stripped. The only other non-test mention, `lib/repositories/ExchangeRatesRepository.ts:3`, is a comment |
| The finance read runs on every tab; tabs render only inside `data && !error` | ✅ `FinanceView.tsx`: `useFinanceData(queryString)` with no tab condition (deps `[queryString, attempt]`, so a filter change that leaves the string alone sends nothing); the `FinanceTabs` and every `FinanceTabPanel` sit inside `{data && !error && (…)}` within `finance-content` (`aria-busy={loading}`), after `AdminError` / `AdminLoading` |
| `financeFilterRepair` / `FINANCE_FILTER_SPEC` and `currencies` (L-9a) | ✅ with a correction. `useAdminFilters`' `projectSearch` deletes only the keys **its own spec** owns and keeps every other key, so Finance's hook cannot drop `currencies` unless its spec owns it. `financeFilterRepair` rules 1 to 4 are as the BA lists; rule 2 returns `{ tab: '', ...TAB_KEYS_DEFAULT }`, so a crafted business + tab link with a tab key is cleaned in two passes (the `status` precedent). Business OS AI's save / drop / restore cannot be reused: that page writes `tab` itself, outside `useAdminFilters`, while Finance's `tab` is a hook key (SA-2-5) |
| h1 handling | ✅ `ExchangeRatesView.tsx:351` renders `<AdminPageHeader title="Exchange rates" purpose={PURPOSE} />` with `PURPOSE` module-private (line 89). `FinanceView` renders `AdminPageHeader` (`PAGE_TITLE` "Finance", `PAGE_PURPOSE`, `asOf`). The Business OS AI precedent is real: one `AdminPageHeader`, `purpose={PURPOSE[tab]}` (F-68). `app/admin/finance/__tests__/source.guard.test.ts` pins "FinanceView has no own h1, header by alias" — unaffected |
| layoutFolder registry move | ✅ `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts`: per entry, files exist, **some** file imports `AdminPageHeader` by alias, no file has `<h1` or `.json(`, no relative reach into the layout folder; registry-wide, every file in exactly one entry. The rates entry lists `page.tsx` + the five files the BA names (`changedByText.ts` is not registered today and stays unregistered). The Finance entry contains `FinanceView.tsx` (imports the header), so the five files satisfy it there. The Charge checks entry is the precedent (files from another folder, listed only there) |
| Forced edits: finance tab list | ✅ `financePage.render.test.tsx:1787` (`[TAB_OVERVIEW, TAB_ACCOUNTS, 'Plans & subscriptions']`); no other test counts the tabs |
| Forced edits: keyboard wrap | ✅ `accountsTab.render.test.tsx:209-239`: Right from Plans → Overview, End → Plans, Left from Overview → Plans all change to Exchange rates; one more `ArrowRight` step is added |
| Forced edits: `financeFilters.test` "the spec's tab values" | ❌ **No such pin.** No test asserts the tab values. What does break is the **`currencies` key** (SQ-20): line 48 (`parseLink` builds every field), line 52 (`DEFAULTS`), line 60 (`Object.keys(FINANCE_FILTER_SPEC)` list); and, not named by the BA, `financeFilterBar.layout.render.test.tsx:39` (`DEFAULTS: FinanceFilters`, a type error once the field is required) (SA-2-3) |
| Forced edits: the two rates render suites import `../page` | ✅ `exchangeRates.render.test.tsx:44` and `exchangeRatesFilters.render.test.tsx:34`; the h1 assertion is `exchangeRates.render.test.tsx:173` |
| Forced edits: `chargeChecksRedirect` count | ✅ `chargeChecksRedirect.config.test.ts:50-53` "three redirects in all", `toHaveLength(3)`. No other test counts the redirects |
| `AdminSidebar.nav.test.ts` | ⚠️ **One edit missed.** `onDisk` is a one-level scan: 29 routes today (30 `page.tsx` minus nested `finance/charges`). Deleting the rates page makes it 28, so `expect(onDisk.length).toBeGreaterThanOrEqual(29)` (line 167) fails and becomes 28. `toContain('/admin/exchange-rates')` (line 177) becomes `not.toContain`; `UNLISTED` loses the route; the comment above `UNLISTED` (line 89-91, "writes from the browser straight to the database") and the header line 28 ("Both pages stay on disk") are rewritten; `allHrefs` stays **28**; "never names `exchange-rates`" (line 203) stays (SA-2-3) |
| `redundantPages` G-6 after the delete | ✅ 6 non-test files remain (`exchangeRatesFilters.ts`, `ExchangeRatesView`, `ExchangeRatesKpis`, `ExchangeRatesTable`, `RateHistoryTable`, `changedByText.ts`), so `≥ 5` holds; `fetch(` count stays 3; `toContain(EXCHANGE_PAGE)` and "the REDUNDANT header is gone from the page" read the deleted file and go |
| The api routes `/api/admin/exchange-rates` are untouched | ✅ Nothing in slice 2 needs `app/api/admin/exchange-rates/route.ts` or `[currencyCode]/route.ts`: the view keeps its three literal calls; the redirect `source` is the page path only and does not match `/api/...`. Neither file, nor `lib/admin/exchangeRates/**` nor `ExchangeRatesRepository.ts`, is in the diff |
| Finance guards | ✅ `finance.source.guard` (CUR-3: no `exchange_rates` in any file under `lib/business-os/finance` and `app/admin/finance`) and the page guard (no repository, no `server-only`, value imports from `lib/business-os/finance` refused) have **no rule against importing from `app/admin/exchange-rates/`**; the camel-case specifiers contain no `exchange_rates`. `financeRequest.pin` hashes the route schema and `serialiseFinanceUrl`, not `toFinanceQuery`; both stay byte-identical |

#### Rulings

| # | Ruling |
|---|---|
| SQ-17 | **(a), the MK-4 mechanism.** In `next.config.js` `redirects()`, one entry `{ source: '/admin/exchange-rates', destination: '/admin/finance?tab=exchange-rates', permanent: false }`, no `has`, with a comment in the existing style (slice 2, SQ-4 / SQ-17, temporary for the same reason, query kept); `app/admin/exchange-rates/page.tsx` is **deleted**. **(b) rejected:** a client page whose only job is to leave, drops the query unless it adds `useSearchParams` and a Suspense boundary, and renders a flash first. **(c) rejected:** R8 stays at 0. **(d), a self-guarding server page (`await requireAdminPage()` then `redirect()`), rejected too** although R8 accepts it (SA-2-1): it would be the first server-rendered page under `app/admin`, a new pattern (CLAUDE.md rule 7) for no gain over (a). SQ-4's "server `redirect()`" is satisfied in spirit: the redirect is server-side, before any render. The redirect runs before the admin layout; the destination is gated by it, so a non-admin still gets the layout's refusal. New test `app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts` in the `subscriptionsRedirect.config.test.ts` shape: shape block (exactly one entry for the source, `toEqual` the three fields); `prepareDestination` block: no query → `{ tab: 'exchange-rates' }`; `currencies=all` → `{ tab: 'exchange-rates', currencies: 'all' }`, read by `FINANCE_FILTER_SPEC.tab` as `exchange-rates` and by the `currencies` field as `all`; an incoming `tab=accounts` → `tab: 'exchange-rates'` (the destination wins); `currencies=junk` → the field reads the default |
| SQ-18 | **Accepted.** `FinanceView.tsx` imports `{ ExchangeRatesView, EXCHANGE_RATES_PURPOSE }` from `'../../exchange-rates/components/ExchangeRatesView'`, and `financeFilters.ts` imports `EXCHANGE_RATES_FILTER_SPEC` from `'../exchange-rates/exchangeRatesFilters'`; each with a one-line comment saying the alias would spell the page route G-4 refuses (DV-1). No G-4 edit. No finance file imports `lib/admin/exchangeRates/**` directly |
| SQ-19 | **(i) accepted, made precise; (ii) accepted.** (i) When `selectedTab === 'exchange-rates'`, `FinanceView` renders, under the header: the tablist and the rates panel, **outside** the `data && !error` gate; and it renders **none** of `FinanceKpiStrip`, `FinanceKpiPlaceholders`, `FinanceFilterBar`, the finance `AdminError`, the finance `AdminLoading`, or an `aria-busy` that reflects the finance read (the rates view has its own states and its own busy flag). Overview, Accounts and Plans render exactly as today. (ii) The finance read keeps running on this tab (the Plans precedent): request string unchanged, `financeRequest.pin` green unedited, Overview has its data on return. Skipping the read here is a later optimisation, not this slice. Consequence the user will see in the diff: on this tab the tablist sits directly under the header, while on the other tabs it sits under the KPI strip and the filter bar (an inherent layout shift of hiding the chrome); recorded for the user's diff review, not a blocker |
| SQ-20 | **BA's mechanism accepted; `owns()` gating rejected as unnecessary.** (1) `FinanceFilters` gains `currencies: string`; `FINANCE_FILTER_SPEC` gains, **last** (after `status`), `currencies: EXCHANGE_RATES_FILTER_SPEC.currencies` — **the same field object**, never a copy, so both hooks parse and serialise the key identically and can never disagree on a URL. (2) `onSelectTab`: the Overview, Accounts and Plans branches add `currencies: DEFAULT_CURRENCY_SHOW` (imported with the spec), so leaving the tab is still **one** write; the Exchange rates branch is `{ tab: 'exchange-rates', ...TAB_RESET, status: '' }`. (3) `financeFilterRepair` gains one rule after rule 4: tab not `exchange-rates` and `currencies` not at its default → `{ currencies: <default> }` (a pasted `?currencies=all` on Overview, or a business link). `FINANCE_CLEAR_PATCH` and `financeCanClear` do **not** learn the key (Finance's Clear is never shown on this tab, and elsewhere the key is always at its default). `toFinanceQuery` / `fromFinanceQuery` are untouched. (4) The view is rendered **without** an `active` prop (default `true`). Why no `owns()`: Finance unmounts a hidden panel, so the view's hook exists only while its tab is selected; on the click render it parses the leaving tab's string, which never holds `currencies` (leaving the tab and the repair remove it), so it starts at the default; its write effect (a child effect, run before Finance's) finds nothing to change; Finance then writes `tab` once. On leaving, the view unmounts (an unmount writes nothing) and Finance writes once. A Show change is written by the view's hook; Finance's hook re-parses the echo to the same value and its projection is identical (no write, and no request: the request string does not include `currencies`). The view's `active` prop and its R-14 test stay (they are the L-9a contract, tested, should Finance ever keep panels mounted); the view's header comment line 44 is corrected to "Finance unmounts hidden panels, so no caller passes false today". SA-1c-1's `{ active: tab === 'exchange-rates' }` is amended accordingly: always true where the view is mounted, so it is not written |
| SQ-21 | **Accepted: the view drops its `AdminPageHeader`; one h1, "Finance".** The view exports its sentence as `EXCHANGE_RATES_PURPOSE` (the existing `PURPOSE` text, unchanged, still in `ExchangeRatesView.tsx`, outside `app/admin/finance/`). `FinanceView`'s header on this tab: `title={PAGE_TITLE}`, `purpose={EXCHANGE_RATES_PURPOSE}`, `asOf={null}` (the window does not apply). No `showHeader` prop. Under the 2a / 2b split (SA-2-4), `app/admin/exchange-rates/page.tsx` renders `<AdminPageHeader title="Exchange rates" purpose={EXCHANGE_RATES_PURPOSE} />` above the view **during 2a only**, so the standalone URL keeps its h1 until 2b deletes it. `ExchangeRatesKpis.tsx` is not edited; `KpiStrip.callers.pin` does not move |
| SQ-22 | **Accepted, in 2b.** The `'/admin/exchange-rates (Exchange rates)'` entry is removed and its five non-page files are appended to the `'/admin/finance (Finance)'` entry with a comment in the Charge checks form ("the view stays in `app/admin/exchange-rates/` (SA-R13) and is listed here, and only here"). `changedByText.ts` is not added (not registered today; no scope creep). In 2a the entry is unchanged: `page.tsx` still imports the header |
| SQ-23 | **Approved, with SA-2-3's corrections; the complete list is the one below.** Dev shows each file's diff in the handover and nothing else in those files changes. **2a:** `financePage.render.test.tsx:1787` (four names); `accountsTab.render.test.tsx` keyboard test (wrap over four, comment updated); `financeFilters.test.ts` lines 48, 52, 60 (`currencies`); `financeFilterBar.layout.render.test.tsx:39` (`currencies` in `DEFAULTS`). **2b:** `chargeChecksRedirect.config.test.ts` three → four (test name and comment); `redundantPages.source.guard` G-6: drop `toContain(EXCHANGE_PAGE)` and the "REDUNDANT header is gone from the page" test, delete the then-unused `EXCHANGE_PAGE` constant, header gains an "Amended by slice 2" line; `AdminSidebar.nav.test.ts`: on-disk floor 29 → 28, `/admin/exchange-rates` `not.toContain`, out of `UNLISTED`, the two stale comments rewritten, `allHrefs` 28 unchanged; `layoutFolder.guard` registry per SQ-22; the two rates render suites render `<ExchangeRatesView />` instead of `../page`, and the h1 assertion at `exchangeRates.render.test.tsx:173` becomes "the view renders no h1" (the one-h1 check moves to the new Finance tests) |
| SQ-24 | **Accepted.** The business wins: rule 2 drops the tab; the new rule then drops a stray `currencies`. No special case. `selectedTab` is `'exchange-rates'` only with no business (`query.accountId === null`), as for Plans, so the view never mounts on a business link |

#### Additional rulings

| # | Topic | Ruling |
|---|---|---|
| SA-2-1 | §5.3.3 R8 statement | BA corrects "A Server Component `page.tsx` that calls `redirect()` fails R8" to: "fails R8 unless its first statement awaits `requireAdminPage()` (R8's self-guarding clause); none exists under `app/admin`, and SA rejects introducing one here (SQ-17 (d))". |
| SA-2-2 | §5.3.2 contradiction | The "Types and spec" row says "No other finance key is added"; SQ-20 adds `currencies`. BA rewrites the row per SQ-20 (1) and the `financeFilterRepair` row's "No new finance-key rule" per SQ-20 (3) |
| SA-2-3 | §5.3.4 forced-edit list | BA replaces the "Finance render tests" and `AdminSidebar.nav` rows with the SQ-23 list (the `financeFilters.test` tab-values pin does not exist; the `currencies` lines, `financeFilterBar.layout` `DEFAULTS` and the on-disk floor 29 → 28 were missing) |
| SA-2-4 | **Split: 2a then 2b** | Slice 2 touches config, a page delete, four finance files, the view and ten test files; split so each PR is reviewable in one sitting and the URL retirement is separately revertible. **2a, the tab:** `FinanceTabs.tsx`, `financeCopy.ts` (`TAB_EXCHANGE_RATES`), `financeFilters.ts`, `FinanceView.tsx`, `ExchangeRatesView.tsx` (header removed, `EXCHANGE_RATES_PURPOSE` exported, comment line 44), `app/admin/exchange-rates/page.tsx` (renders the header above the view, temporarily); the 2a forced edits; new Finance render tests. G-4, G-6, the registry, the sidebar test, `next.config.js` and the two rates render suites are **not** touched in 2a (the page still renders the h1 they assert). **2b, the old URL:** `next.config.js` redirect, page deleted, the 2b forced edits, the new redirect test. 2b branches from `origin/main` after 2a merges (not stacked). Cycle: 2a changes a money page's layout but no figure, request or data path; TL picks full cycle or short path. 2b is config + tests only. FR-23 to FR-25 and FR-27 are 2a; FR-26 is 2b |
| SA-2-5 | Why not the Business OS AI mechanism | Recorded so it is not re-proposed: BOS AI's page writes `tab` itself and saves / drops / restores each tab's keys, because its tab is not a hook key. Finance's `tab` is a `useAdminFilters` key and the hook keeps foreign keys, so the smallest correct change is for Finance's spec to own `currencies` too (SQ-20). Two specs owning one key is safe here only because they share **one field object** and the view's hook exists only while its tab is shown; a Dev comment at the new spec field says both |
| SA-2-6 | Tests for 2a (new, in `financePage.render.test.tsx` or a new `exchangeRatesTab.render.test.tsx` under `app/admin/finance/__tests__/`) | (1) Select the tab from Overview: **exactly one** `replaceState`, URL `?tab=exchange-rates`, Accounts keys and `status` reset; the rates table, Show select, rates KPIs and history render; no `FinanceKpiStrip`, no finance filter bar, no window `asOf`; exactly one `heading level 1`, "Finance", with the rates purpose sentence. (2) Open `?tab=exchange-rates` with the finance read **pending** and with it **failing**: the rates render; no finance error, no finance loading text. (3) `?tab=exchange-rates&currencies=all` opens All; change Show; leave to Overview: **one** write, no `currencies` key; `?currencies=all` on Overview is repaired away. (4) `?account=<id>&tab=exchange-rates`: the business view, no tablist, the view not mounted, the URL keeps `account` only. (5) The finance request string on this tab equals the Overview literal (`financeRequest.pin` unedited). (6) `financeFilters.test.ts` gains: the new repair rule (and null when on the tab), and `currencies` is `EXCHANGE_RATES_FILTER_SPEC.currencies` by identity (`toBe`). New test files must not contain `exchange_rates` (CUR-3 does not scan tests, but SA-R13's wording covers them) |
| SA-2-7 | Skills and domains | No entitlements import (type-only included), no LLM call, no cron or queue, no new route, repository, table or column claim, no caller-supplied id: `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain`, `business-os-schema-check`, `tenant-isolation-guard`, `new-api-route`, `new-repository` not triggered. The admin gate is unchanged (`app/admin/layout.tsx`, `requireAdminPage`); no `profiles.role`. Touched files are already on `clientLogger` / no `console.*` (the finance guard pins it for `app/admin/finance/**`; G-6 for the rates folder); Dev confirms `next.config.js` gains no `console.*` |
| SA-2-8 | §11 defaults | All accepted as business-neutral: tab named "Exchange rates", last; Overview stays default; Finance KPIs and filters hidden on the tab; no tile links to it; the old address forwards to the tab; no sidebar item, no Settings link |

#### Required changes

**BA, before the 2a workplan:** ✅ **Applied by BA 2026-10-20** (items 1 to 4: §5.3.3 R8 wording and SQ-17 rulings; §5.3.2 `currencies` / repair rule / no `active` prop / SQ-19 (i) hidden list; §5.3.4 replaced by the SQ-23 list split 2a / 2b; §1 rows 2a / 2b, FR slice column, §8 2a / 2b criteria, §12 page row).

1. §5.3.3: SA-2-1 wording; record SQ-17 (a) as ruled, (b) / (c) / (d) rejected.
2. §5.3.2: SA-2-2 (`currencies` in the spec, the new repair rule, no `active` prop, the SQ-19 (i) list of what is hidden on the tab, including the finance error / loading / `aria-busy`).
3. §5.3.4: SA-2-3 (the SQ-23 list, split into 2a and 2b).
4. §1 and §8: slice 2 becomes rows / criteria **2a** and **2b** per SA-2-4; §8 adds the "one write per switch" and "no finance error or loading on the tab" criteria; the h1 criterion reads "exactly one h1, Finance". §12: the `app/admin/exchange-rates/page.tsx` row reads "header added in 2a, deleted in 2b".

**Dev, 2a workplan and build:**

1. Branch from the current `origin/main` once 1c.2 (PR #484) has merged.
2. `FinanceTab` / `FinanceFilters.tab` / `FINANCE_FILTER_SPEC.tab` gain `'exchange-rates'`; `TABS` gains the fourth entry; `TAB_EXCHANGE_RATES = 'Exchange rates'` in `financeCopy.ts`; update the stale "two views" header comment of `FinanceTabs.tsx`.
3. `currencies` per SQ-20 (same field object, `onSelectTab`, one repair rule); `toFinanceQuery` / `fromFinanceQuery` / `FINANCE_CLEAR_PATCH` / `financeCanClear` untouched.
4. `FinanceView` per SQ-19 (i) and SQ-21; `selectedTab` per SQ-24; relative imports per SQ-18; header comment gains a slice 2 paragraph.
5. `ExchangeRatesView`: drop `AdminPageHeader` (and its import), export `EXCHANGE_RATES_PURPOSE`, fix comment line 44; `page.tsx` renders the header above the view.
6. Forced edits (2a part of SQ-23) and new tests (SA-2-6). Narrow Jest over `app/admin/finance`, `app/admin/exchange-rates`, `app/admin/components`, `app/admin/__tests__`, `lib/admin/__tests__`, `lib/business-os/finance/__tests__`; `tsc`, `eslint`, `lint:hooks`.

**Dev, 2b workplan and build (after 2a merges):**

1. `next.config.js` redirect per SQ-17; delete `app/admin/exchange-rates/page.tsx`.
2. New `exchangeRatesRedirect.config.test.ts` per SQ-17; the 2b forced edits per SQ-23 and SQ-22.
3. Confirm `git diff --stat` shows no file under `app/api/admin/exchange-rates/`, `lib/admin/exchangeRates/`, `lib/repositories/` or `lib/business-os/finance/`.

---

## 2. Analysis summary

Read from `adb1c6e8` on 2026-10-20. Every point below was checked in the code. None of it reopens a ruling.

| Area | As built at `adb1c6e8` | What 2a does to it |
|---|---|---|
| `app/admin/finance/components/FinanceTabs.tsx` | `FinanceTab = 'overview' \| 'accounts' \| 'plans'`; `TABS` holds three entries; the keyboard math uses `TABS.length`, so a fourth entry wraps with no logic change. Header comment still says "two views, Overview and Accounts" | Type and `TABS` gain `'exchange-rates'` / `TAB_EXCHANGE_RATES`, last. Header comment rewritten for four views (Dev step 2) |
| `app/admin/finance/financeCopy.ts` | `TABS_LABEL`, `TAB_OVERVIEW`, `TAB_ACCOUNTS`, `TAB_PLANS` at lines 673-677 | `TAB_EXCHANGE_RATES = 'Exchange rates'` added after `TAB_PLANS` |
| `app/admin/finance/financeFilters.ts` | `FINANCE_FILTER_SPEC` keys `window, account, tab, sort, group, show, status`; `tab = choiceFilter('tab', ['accounts', 'plans'], '')`; `financeFilterRepair` rules 1 to 4; rule 4 reads `(filters.status ?? '')` defensively | `tab` values gain `'exchange-rates'`; `FinanceFilters.tab` and a new `currencies: string`; spec gains `currencies: EXCHANGE_RATES_FILTER_SPEC.currencies` last; rule 5 after rule 4. `toFinanceQuery`, `fromFinanceQuery`, `FINANCE_CLEAR_PATCH`, `financeCanClear` untouched |
| `app/admin/exchange-rates/exchangeRatesFilters.ts` | `EXCHANGE_RATES_FILTER_SPEC.currencies = textFilter({ key: 'currencies', defaultValue: 'enabled', isValid: isCurrencyShow })`; exports `DEFAULT_CURRENCY_SHOW`. `textFilter`'s `serialise` writes any non-`''` value, but `projectSearch` (`useAdminFilters.ts:146`) skips a field at its default, so `enabled` is never written by either hook | **Not edited.** Only imported |
| `app/admin/finance/components/FinanceView.tsx` | Header line 260 (`asOf={data ? windowLabel : null}`); strip / placeholders 263-273; `FinanceFilterBar` 275-287; `finance-content` with `aria-busy={loading}` 290; `AdminError` 291; `AdminLoading` 293; data gate 295; tablist 316 (only with no business); `onSelectTab` 189-195; `selectedTab` 196-197; `onAccountsTab` 199 | Per SQ-19 (i), SQ-21, SQ-24, SQ-20 (2) and SQ-18: see §3.3 |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | `AdminPageHeader` import line 54; `PURPOSE` module-private line 89; `<AdminPageHeader title="Exchange rates" purpose={PURPOSE} />` line 351; header comment line 44 on `active` | Import and header dropped; `PURPOSE` renamed and exported as `EXCHANGE_RATES_PURPOSE` (text unchanged); line 44 corrected |
| `app/admin/exchange-rates/page.tsx` | Renders `<ExchangeRatesView />` only | Renders `<AdminPageHeader title="Exchange rates" purpose={EXCHANGE_RATES_PURPOSE} />` above the view (2a only) |
| `FinanceFilters` literals | Only two in the repo outside `financeFilters.ts`: `financeFilters.test.ts:52` and `financeFilterBar.layout.render.test.tsx:39` (grep of `FinanceFilters\b` under `app/` and `lib/`) | Both gain `currencies` (the SQ-23 forced edits); nothing else needs a type fix |
| Guards that scan the touched files | `app/admin/finance/__tests__/source.guard.test.ts` (no repository, no `server-only`, finance lib imports type-only, no `console`, page is client + Suspense, FinanceView header + states by alias and no `<h1`, `FinanceTabs` imported only inside `app/admin/finance`, no `.sort(` / `.filter(` / `.reduce(` in `FinanceTabs.tsx`, no `text-slate-500` / `-600`); `lib/business-os/finance/__tests__/finance.source.guard.test.ts` (no `exchange_rates` in finance files, AC-270 no `user_preferences` / `timezone` in finance sources, comments included); `usdCopy.source.guard` (no `USD <digit>` strings); `redundantPages` G-4 / G-6; `layoutFolder.guard`; `contrast.lf1` | No guard is edited in 2a. Each one must stay green as written (§8 R-4) |
| `console.*` in touched files | 0 in each of the six production files (grep, 2026-10-20) | Nothing to flag or convert. Logging stays on `clientLogger` (view) / none (others) |

**Skills (SA-2-7).** No entitlements import (type-only included), no LLM call, no cron or queue, no route, repository, table or column claim, no caller-supplied id. `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain`, `business-os-schema-check`, `tenant-isolation-guard`, `new-api-route`, `new-repository` and `new-plugin` are not triggered. The admin gate is unchanged (`app/admin/layout.tsx`, `requireAdminPage`).

**Deprecated patterns.** None touched or extended.

---

## 3. Implementation approach

### 3.1 The tab and its label

- `financeCopy.ts`: `export const TAB_EXCHANGE_RATES = 'Exchange rates';` with a one-line comment (slice 2a, D-7, "Finance tab only").
- `FinanceTabs.tsx`: `FinanceTab = 'overview' | 'accounts' | 'plans' | 'exchange-rates'`; `TABS` gains `['exchange-rates', TAB_EXCHANGE_RATES]` last, with a comment (slice 2a, SQ-4: the rates view rendered from its own folder, SA-R13). The ids become `finance-tab-exchange-rates` / `finance-panel-exchange-rates`. No keyboard change: `TABS.length` already drives the wrap. The header comment now names four views and `tab=accounts | plans | exchange-rates`.

### 3.2 The filter spec (`financeFilters.ts`)

**File:** `app/admin/finance/financeFilters.ts`

```typescript
// Relative on purpose: the alias path would spell the page route that the G-4 guard (redundantPages) refuses (DV-1, SQ-18).
import { DEFAULT_CURRENCY_SHOW, EXCHANGE_RATES_FILTER_SPEC } from '../exchange-rates/exchangeRatesFilters';

export interface FinanceFilters {
  // ...unchanged fields...
  tab: '' | 'accounts' | 'plans' | 'exchange-rates';
  /** Slice 2a (SQ-20): the Exchange rates tab's Show, only with that tab. Never sent to the finance route. */
  currencies: string;
}

export const FINANCE_FILTER_SPEC: AdminFilterSpec<FinanceFilters> = {
  // ...unchanged keys, same order...
  tab: choiceFilter('tab', ['accounts', 'plans', 'exchange-rates'] as const, ''),
  status: choiceFilter('status', SUBSCRIPTION_STATUSES, ''),
  // Slice 2a (SQ-20, SA-2-5): two specs own `currencies` safely because they share this ONE field
  // object (never a copy), so both hooks parse and serialise it identically, and the rates view's
  // hook exists only while its tab is shown (Finance unmounts hidden panels). Last, so both
  // projections write it in the same place.
  currencies: EXCHANGE_RATES_FILTER_SPEC.currencies,
};
```

`financeFilterRepair` gains rule 5 after rule 4. The defensive `??` follows rule 4's precedent: a state built before 2a has no `currencies` key, and it is valid as it is (Q-5).

**File:** `app/admin/finance/financeFilters.ts`

```typescript
  // Slice 2a (SQ-20 (3), SQ-24): `currencies` belongs to the Exchange rates tab only. A business
  // link has already lost the tab to rule 2, so a stray `currencies` goes on the next pass.
  if (filters.tab !== 'exchange-rates' && (filters.currencies ?? DEFAULT_CURRENCY_SHOW) !== DEFAULT_CURRENCY_SHOW) {
    return { currencies: DEFAULT_CURRENCY_SHOW };
  }
  return null;
```

The header comment gains a "Slice 2a" paragraph. `toFinanceQuery` is not edited, so `tab` still reaches the request for Accounts only and `currencies` never does. `fromFinanceQuery`, `FINANCE_CLEAR_PATCH` and `financeCanClear` are not edited either.

### 3.3 `FinanceView.tsx`

**Imports (SQ-18).** `import { EXCHANGE_RATES_PURPOSE, ExchangeRatesView } from '../../exchange-rates/components/ExchangeRatesView';`, with the same one-line comment as in §3.2. No finance file imports `lib/admin/exchangeRates/**` directly. `financeFilters.ts` reaches it transitively through `exchangeRatesFilters.ts`, and only as a type import.

**`selectedTab` (SQ-24).**

**File:** `app/admin/finance/components/FinanceView.tsx`

```typescript
const selectedTab: FinanceTab =
  query.tab === 'accounts'
    ? 'accounts'
    : query.accountId !== null
      ? 'overview'
      : filters.tab === 'plans'
        ? 'plans'
        : filters.tab === 'exchange-rates'
          ? 'exchange-rates'
          : 'overview';
const onRatesTab = selectedTab === 'exchange-rates';
```

This is the existing expression with one more branch. Accounts and Plans give the same results as today.

**`onSelectTab` (SQ-20 (2)), one write per branch.** `CURRENCIES_RESET` is a module constant, `{ currencies: FINANCE_FILTER_SPEC.currencies.defaultValue }` (Q-2):

| Selected | Patch |
|---|---|
| Accounts | `{ tab: 'accounts', status: '', ...CURRENCIES_RESET }` |
| Plans | `{ tab: 'plans', ...TAB_RESET, ...CURRENCIES_RESET }` |
| Exchange rates | `{ tab: 'exchange-rates', ...TAB_RESET, status: '' }` |
| Overview | `{ tab: '', ...TAB_RESET, status: '', ...CURRENCIES_RESET }` |

`targetFor`, `tabTarget`, `onPick` and the tile hrefs are not edited. They are never reached on the rates tab, because the strip is not rendered there, and off the tab `currencies` is always at its default.

**Header (SQ-21).** `<AdminPageHeader title={PAGE_TITLE} purpose={onRatesTab ? EXCHANGE_RATES_PURPOSE : PAGE_PURPOSE} asOf={onRatesTab ? null : data ? windowLabel : null} />`. It stays one header, with no `showHeader` prop.

**Hidden chrome on the tab (SQ-19 (i)).** The KPI strip / placeholders block and `<FinanceFilterBar>` are each wrapped in `!onRatesTab && (...)`. The proposed tree for the content area is below. It is the subject of Q-1, because it keeps the tablist mounted across a tab switch:

**File:** `app/admin/finance/components/FinanceView.tsx`

```tsx
<div data-testid="finance-content" aria-busy={onRatesTab ? undefined : loading} className="space-y-4">
  {!onRatesTab && error && <AdminError ... />}
  {!onRatesTab && loading && !data && !error && <AdminLoading what={FINANCE_WHAT} />}
  {/* Slice 2a (SQ-19 (i)): the rates do not depend on the finance read, so their tab is outside its gate. */}
  {(onRatesTab || (data && !error)) && (
    <div className="space-y-4">
      {!onRatesTab && data && data.accountId !== null && (<>AccountHeader + AccountSummary, unchanged</>)}
      {query.accountId === null && <FinanceTabs selected={selectedTab} onSelect={onSelectTab} />}
      {onRatesTab ? (
        <FinanceTabPanel id="exchange-rates">
          {/* No `active` prop (SQ-20 (4)): Finance unmounts hidden panels. */}
          <ExchangeRatesView />
        </FinanceTabPanel>
      ) : data ? (
        /* the existing plans / accounts / overview ternary, unchanged */
      ) : null}
    </div>
  )}
</div>
```

**Why this shape and not a separate sibling block.** Today the tablist is the second child of the inner `space-y-4` div inside `finance-content`. In this shape it keeps that place in the React tree on every tab. So with the finance data present, Overview → Exchange rates → Overview re-renders the same `<button>` elements, and keyboard focus stays on the tab the admin activated. A separate block placed after the hidden chrome would unmount the tablist and mount a new one on each switch, so the focused button would be removed and focus would drop to `<body>`. That breaks the manual-activation pattern for keyboard users. On Overview, Accounts and Plans the DOM is byte-for-byte today's: the same wrapper, the same `aria-busy={loading}` and the same order. On the rates tab, `aria-busy` is absent, and no finance error, loading text or figure is rendered. The `data` narrowing (`data ? … : null`) is only for TypeScript. With `onRatesTab` false, the outer condition already implies `data`.

`onAccountsTab` (line 199) is `true` on the rates tab (it means "not on Overview"). That is harmless: its only uses are `targetFor`, which the hidden strip never calls, and the `jumpTo` effect, which needs a pending jump that only a strip tile can set. It is not renamed (no scope creep).

**Header comment.** A "Slice 2a" paragraph covers: the fourth tab, which chrome is hidden and why, the one h1, the rates outside the gate, the read still running, `currencies` owned through the shared field, and the relative import.

### 3.4 `ExchangeRatesView.tsx` and the standalone page

- `ExchangeRatesView.tsx`: delete the `AdminPageHeader` import (line 54) and the `<AdminPageHeader … />` element (line 351). Rename `const PURPOSE` to `export const EXCHANGE_RATES_PURPOSE` with the text unchanged, plus a doc comment: "the page header's sentence, rendered by whoever owns the h1: the Finance tab, and the standalone page until 2b". Line 44 becomes "Finance unmounts hidden panels, so no caller passes false today." The header comment's "Layout standard: shared header, …" line drops "shared header" and says the owner renders it (SQ-21). Nothing else changes. The three `fetch(` sites, the logger, the filter bar, the KPIs and the `active` prop are not touched.
- `app/admin/exchange-rates/page.tsx`: renders `<div className="space-y-6"><AdminPageHeader title="Exchange rates" purpose={EXCHANGE_RATES_PURPOSE} /><ExchangeRatesView /></div>`. The header is imported by alias (`@/app/admin/components/layout/AdminPageHeader`), which keeps the layoutFolder entry's "some file imports `AdminPageHeader` by alias" rule satisfied now that the view no longer imports it. `EXCHANGE_RATES_PURPOSE` comes from `./components/ExchangeRatesView`. The header comment gains "2a: renders the header the view dropped (SQ-21); 2b deletes this page". The page stays `'use client'` (R8).

The wrapper reproduces the view's own `space-y-6` gap between header and KPIs, so the standalone page looks as it does today.

### 3.5 Two hooks, one key: why no loop

Two hooks write `currencies`: Finance's spec and the view's. That is safe for three reasons. First, both hooks hold the same `AdminFilterField` object, so parse and serialise are identical. Second, both projections delete the key and append it last: it is the last key of Finance's spec and the only key of the view's, so both hooks produce the same string. Third, the view's hook exists only while the tab is selected. The SA traced the sequences in SQ-20 (4). The new render tests (§7.1) exercise them with a `useSearchParams` that follows `window.location`, as Next 14.2 does after `history.replaceState`. The precedent is `chargeChecks.page.render.test.tsx`. With that mock, each hook really re-reads the other's writes. A static `mockSearch` would hide a ping-pong.

### 3.6 What 2a does not touch

`next.config.js`, the 2b redirect and its test, the page delete, G-4 / G-6 (`redundantPages.source.guard`), the `layoutFolder.guard` registry, `AdminSidebar.nav.test.ts`, `chargeChecksRedirect.config.test.ts`, the two rates render suites, `ExchangeRatesKpis.tsx` (so `KpiStrip.callers.pin` does not move), `financeTiles.pin`, `financeRequest.pin`, `financeUrl.ts`, `useFinanceData.ts`, every API route, `lib/admin/exchangeRates/**`, `lib/repositories/**`, `lib/business-os/finance/**`, the sidebar.

---

## 4. Questions for SA

| # | Question | Dev default if the SA agrees |
|---|---|---|
| Q-1 | **Tree shape (focus).** §3.3 keeps the tablist in its current React position, so a tab switch keeps keyboard focus. To do that, the rates panel goes inside `finance-content` behind a widened gate, `onRatesTab \|\| (data && !error)`, and `aria-busy` is omitted on that tab. The literal alternative is a sibling block after the hidden chrome. It meets SQ-19 (i) word for word, but it remounts the tablist on every switch to or from Exchange rates, which drops focus to `<body>`. Is the §3.3 shape acceptable as meeting "the tablist and the rates panel **outside** the `data && !error` gate"? | §3.3 shape. A new test asserts that focus stays on the activated tab after Enter on Exchange rates and after Enter on Overview |
| Q-2 | **Where `FinanceView` gets the `currencies` default** for `onSelectTab`. Options: (a) `FINANCE_FILTER_SPEC.currencies.defaultValue`, with no new import edge and the same value by construction; (b) import `DEFAULT_CURRENCY_SHOW` in `FinanceView.tsx`, a third relative import that SQ-18 does not list; (c) a new export from `financeFilters.ts` | (a) |
| Q-3 | **Keyboard test.** SA-2-3 says "one more `ArrowRight` step". To keep the test's closing assertion (focus back on Accounts from Overview by Left), the Left chain also gains one step: Overview → Exchange rates → Plans → Accounts. The full new sequence is in §7.1 (F-2). OK? | Yes, one more Right and one more Left, comment updated, nothing else |
| Q-4 | **New render file and its fixtures.** New file `app/admin/finance/__tests__/exchangeRatesTab.render.test.tsx`. Its `useSearchParams` follows `window.location` (§3.5). `FinanceKpiStrip` / `FinanceKpiPlaceholders` / `FinanceFilterBar` and the Overview sections are replaced by stand-ins with distinct test ids (`finance-kpi-strip`, `finance-kpi-placeholders`, `finance-filter-bar`), the `accountsTab.render.test.tsx` precedent, so "no Finance strip / bar" cannot be confused with the rates view's own shared `KpiStrip` / `AdminFilterBar`. `ExchangeRatesView` itself is real, and `fetch` is routed by URL (`/api/admin/exchange-rates…` vs `/api/admin/business-os/finance…`). The rates fixtures are plain object literals, with **no** import from `lib/admin/exchangeRates/**` (reading SQ-18's "no finance file imports `lib/admin/exchangeRates/**`" as covering tests too) and no `exchange_rates` string. Agree, or may the test take `import type { ExchangeRatesPayload }` for fixture typing? | No `lib/admin/exchangeRates` import; the fixture is typed as `unknown` at the `fetch` stub |
| Q-5 | **Defensive `??` in rule 5.** `(filters.currencies ?? DEFAULT_CURRENCY_SHOW)`, following rule 4's `(filters.status ?? '')` precedent for a state built before the key existed. Keep it, or compare directly because the type says `string`? | Keep (precedent) |
| Q-6 | **`financePage.render.test.tsx` comment.** The forced line is **1786** at `adb1c6e8` (SA cited 1787). The comment above it (line 1785, "the third tab, Plans & subscriptions") goes stale. SQ-23 says "nothing else in those files changes". May line 1785 gain "; slice 2a: the fourth, Exchange rates"? | Yes, the comment line plus the expect line, shown in the handover |
| Q-7 | **Test (6) home.** SA-2-6 (6) goes in `financeFilters.test.ts`, which also takes the three forced edits (48, 52, 60). The new cases form a separate `describe('slice 2a: currencies (SQ-20, SQ-24)')` block appended at the end of the file, so the forced-edit lines stay the only edits above it. OK? | Yes |

---

## 5. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/admin/finance/financeCopy.ts` | modify | `TAB_EXCHANGE_RATES` (Dev step 2) |
| `app/admin/finance/components/FinanceTabs.tsx` | modify | Fourth tab in the type and `TABS`; header comment (Dev step 2) |
| `app/admin/finance/financeFilters.ts` | modify | `tab` value, `currencies` field (same object, last), rule 5, relative import, header paragraph (SQ-20, SQ-18) |
| `app/admin/finance/components/FinanceView.tsx` | modify | `selectedTab`, `onSelectTab`, header purpose / `asOf`, hidden chrome, rates panel outside the finance gate, relative import, header paragraph (SQ-19 (i), SQ-21, SQ-24, SQ-18) |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | modify | Header dropped, `EXCHANGE_RATES_PURPOSE` exported, comment line 44 and the "shared header" line (SQ-21, SQ-20 (4)) |
| `app/admin/exchange-rates/page.tsx` | modify | Renders the header above the view, 2a only (SQ-21) |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | modify (forced) | Line 1786 (SA: 1787): four tab names; comment line 1785 per Q-6 |
| `app/admin/finance/__tests__/accountsTab.render.test.tsx` | modify (forced) | Keyboard test wraps over four (~209-239) |
| `app/admin/finance/__tests__/financeFilters.test.ts` | modify (forced + new) | Lines 48, 52, 60 (`currencies`); new `describe` block at the end for SA-2-6 (6) |
| `app/admin/finance/__tests__/financeFilterBar.layout.render.test.tsx` | modify (forced) | Line 39 `DEFAULTS` gains `currencies: 'enabled'` |
| `app/admin/finance/__tests__/exchangeRatesTab.render.test.tsx` | create | SA-2-6 (1) to (5), plus the Q-1 focus test |
| `docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md` | modify | §1 row 2a status / PR, Change History row (standing rule: every slice stage goes into the main requirement). The BA's uncommitted slice 2 edits are kept |
| `docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_2A_WORKPLAN.md` | create | This workplan |

No other file changes. `git diff --stat` at Step 7 must list exactly these.

---

## 6. Task list

- ✅ Step 0: Baseline. Confirm `git branch --show-current` is `feature/admin-exchange-rates-2-finance-tab`, HEAD is `adb1c6e8`, and `git status` shows only the requirement modified (plus this workplan). Re-verify the forced-edit line numbers (`financePage.render.test.tsx` 1786, `accountsTab.render.test.tsx` keyboard test, `financeFilters.test.ts` 48 / 52 / 60, `financeFilterBar.layout.render.test.tsx` 39) and the `FinanceView.tsx` / `ExchangeRatesView.tsx` lines in §2. Confirm `console.` count 0 in the six production files. Run §7.2 Jest, §7.3 `tsc` and `lint:hooks` for a baseline and record the results here. Use no `git stash`. Never delete or unlink the shared `node_modules` junction
- ✅ Step 1: `financeCopy.ts` `TAB_EXCHANGE_RATES`; `FinanceTabs.tsx` type, `TABS` entry, header comment (§3.1)
- ✅ Step 2: `financeFilters.ts` per §3.2: relative import with the comment, `tab` values, `currencies` field last with the SA-2-5 comment, rule 5, header paragraph
- ✅ Step 3: `ExchangeRatesView.tsx` and `page.tsx` per §3.4
- ✅ Step 4: `FinanceView.tsx` per §3.3, using the shape the SA rules on in Q-1, and the default source per Q-2. Every hook stays unconditional at the top level, with no early return
- ✅ Step 5: The 2a forced edits (SQ-23, 2a part), exactly as listed in §7.1 F-1 to F-4, and nothing else in those files
- ✅ Step 6: New tests per §7.1 N-1 to N-7 (SA-2-6). Check that no new or edited file under `app/admin/finance/` contains `exchange_rates`, `timezone` or `user_preferences`
- ✅ Step 7: Run §7.2 Jest, §7.3 narrow `tsc`, §7.4 `eslint` + `lint:hooks`. Run `grep -rn "exchange_rates" app/admin/finance` (expect no hit). Run `git diff --stat` and `git diff --numstat`: no file may show deletions without matching insertions (truncation check), and no file outside §5 may change. Confirm `next.config.js`, `app/api/admin/exchange-rates/**`, `lib/admin/exchangeRates/**`, `lib/repositories/**` and `lib/business-os/finance/**` are untouched
- ✅ Step 8: Update the requirement §1 row 2a and its Change History; set this workplan to Code Complete with implementation notes and deviations (DV-n). Hand over to TL with each forced-edit file's diff (SQ-23). **No commit** (RM, after the user has seen the diff)

### 6.1 Implementation notes (Dev, 2026-10-20)

Built uncommitted on `adb1c6e8`. No commit and no stash were made, the `node_modules` junction was not touched, and the BA's uncommitted requirement edits are kept. Every SA ruling in §9 is applied:

| Ruling | As built |
|---|---|
| Q-1 / SA-2a-1 (a) | The gate is `onRatesTab \|\| (data && !error)`. Every hidden block is a hole **in place**: the strip / placeholders expression became `onRatesTab ? null : …`, `<FinanceFilterBar>` became `!onRatesTab && (…)`, `AdminError` and `AdminLoading` gained `!onRatesTab &&`, the `AccountHeader` fragment gained `!onRatesTab && data &&`, and the busy flag became `aria-busy={onRatesTab ? undefined : loading}`. Nothing was reordered or extracted, and no `key` was added. The panel slot is `onRatesTab ? <FinanceTabPanel id="exchange-rates">… : !data ? null : <the existing ternary, unedited>` |
| Q-2 (a) | `CURRENCIES_RESET = { currencies: FINANCE_FILTER_SPEC.currencies.defaultValue }`, typed `Partial<FinanceFilters>`, with no third relative import. Rule 5 uses `DEFAULT_CURRENCY_SHOW` |
| Q-3 | Keyboard test: one more Right, one more Left, an arrival `tabIndex -1` check for the fourth tab, and the line-216 comment updated |
| Q-4 | The new test imports `EXCHANGE_RATES_PURPOSE` by relative path. There is no `lib/admin/exchangeRates` import and no underscored table name anywhere under `app/admin/finance` (grep: 0 hits) |
| Q-5 | The `??` is kept, with a comment written like rule 4's |
| Q-6 | Only the comment line and the expect line change (see DV-2 for the line numbers) |
| Q-7 | One `describe('slice 2a: currencies (SQ-20, SQ-24)')` block is appended, with its own import line (the `financePage` "separate import" precedent). It includes the SA's extra N-6 case: Accounts with a non-default `sort` and `currencies=all` still resets |
| SA-2a-2 (N-5) | Finance-route calls are filtered by path and checked with `toEqual([OVERVIEW_REQUEST])`: exactly one call, equal to row 1, for both links. Rates calls are counted separately |
| SA-2a-3 (N-7) | The tab nodes are captured first. The test then awaits the address and `aria-selected`, and asserts `isConnected`, `getByRole(...)` `toBe(captured)` and `toHaveFocus()`, in both directions. The pending → settled case is included |
| N-2 addition | The test asserts that the finance Try again button is absent, and that the rates panel has `role="tabpanel"`, `id="finance-panel-exchange-rates"` and `aria-labelledby="finance-tab-exchange-rates"` |
| SA-2a-4 | Wording checked. No `timezone` or `user_preferences` in any edited finance file. No `.sort(` / `.filter(` / `.reduce(` in `FinanceTabs.tsx`. No URL writer in finance production code: the only matches are the existing header comment lines 9-10 of `FinanceView.tsx`. No `/admin/exchange-rates` in finance code. 0 `console.` calls in the six production files |
| `page.tsx` comment | "Reached by typing its URL only" now reads "Reached by its URL and, rendered without this page, from the Finance tab; never linked (D-6 …)". The 2a / 2b line is added |

**N-7 mutation check (SA-2a-3), run once and reverted.** `FinanceView.tsx` was copied aside. It was then changed so that, on the rates tab, the tablist and the rates panel render in a sibling block before `finance-content`, and the in-gate tablist renders only off the rates tab. Result: **N-7 (1) FAILED.** The captured Exchange rates node was detached, so the awaited `aria-selected="true"` on it never appeared. N-7 (3) passed under the mutation, as expected, because the gate does not flip in that case in either shape. The file was restored from the copy and confirmed byte-identical with `cmp`.

**Deviations**

| # | Deviation | Why |
|---|---|---|
| DV-1 | **SA-2a-1 (b), as ruled.** With no finance data (the read is pending or failed), leaving Exchange rates for Overview, Accounts or Plans unmounts the tablist. Those tabs show the finance loading or error text, and they have never had a tablist without data | This is inherent and the same as today. N-2 pins it: after a failed read, Overview shows `finance-error`, its Try again button, and no tablist |
| DV-2 | In `financePage.render.test.tsx` the forced lines are **1786 (comment) and 1787 (expect)** at `adb1c6e8`. The SA's original 1787 was right; the workplan's "1786" and the review's "1785-1786" were one line off | These are the same two lines that Q-6 ruled on. Nothing else in the file changes |
| DV-3 | **A fifth forced edit, not in SQ-23.** The test at `financeFilters.test.ts:206-214` ("fromFinanceQuery maps the Accounts tab's query back") spreads `DEFAULTS` and expects the patch to equal it, so `currencies` has to be `undefined` there. The edit is one line plus a comment, after the existing `status: undefined` line (the MK-4 precedent) | `DEFAULTS` gained `currencies` (the ruled line-52 edit). `fromFinanceQuery` stays untouched per SQ-20, so the expectation moves, not the code |
| DV-4 | The new render file adds a `deliver()` step (re-render the page inside `act`) on top of the live `useSearchParams` mock | The live mock alone does not re-render the parent when the child's hook writes, so Finance's hook would act on a stale `currencies` value. That is a harness artifact: in Next 14.2 the patched `replaceState` delivers the new URL to every `useSearchParams` consumer. `deliver()` follows the `tabCoexistence.render` precedent (`view.rerender`) |
| DV-5 | `origin/main` moved during the build to `0c0ca640` (#485, MK-5b). That merge also edits `FinanceView.tsx` (an import two lines above ours, and a line inside the Plans panel), `financeCopy.ts` and `financePage.render.test.tsx`. As a result, `git diff origin/main --stat` now also lists #485's files, reversed. Against the branch base `adb1c6e8` (`git diff HEAD --stat`), the list is exactly §5 | The #485 hunks do not overlap ours (unchanged lines separate them), so merging `origin/main` should be clean. That merge is a commit, so it belongs to RM. Jest, `tsc` and lint must be re-run after it. The new MK-5b Plans section is gated on `data.converted`, which the new file's payload does not include |

**Results (2026-10-20)**

| Check | Baseline (Step 0) | After |
|---|---|---|
| Narrow Jest (§7.2) | 92 suites / 4,613 tests passed | **93 suites / 4,637 tests passed**. The extra suite is `exchangeRatesTab.render.test.tsx` (15 tests), `financeFilters.test.ts` gained 8, and 1 more is the F-5 source guard's per-file case, which now also walks the new test file |
| Narrow `tsc` (`tsconfig.fx2a.json`, both folders, tests included) | exit 0, 0 errors | exit 0, **0 errors**. Mid-build it showed exactly the three predicted `currencies` errors, at the forced-edit lines |
| `eslint` (the 11 files of §7.4) | — | exit 0, 0 errors. 1 warning: `k5Caption` is unused at `financePage.render.test.tsx:131`. It already exists on `origin/main` and is not on an edited line |
| `npm run lint:hooks` | exit 0 | exit 0 |
| `git diff HEAD --stat` | — | 10 code files and the requirement, plus 2 untracked files (the new test and this workplan): exactly §5. Nothing in `next.config.js`, `app/api/**` or `lib/**` |
| Truncation check (`--numstat`) | — | No file has deletions without matching insertions |

---

## 7. Tests and commands

### 7.1 Tests added or changed

**Forced edits (SQ-23, 2a part, the complete list).**

| # | File | Edit |
|---|---|---|
| F-1 | `financePage.render.test.tsx:1786` | `[TAB_OVERVIEW, TAB_ACCOUNTS, 'Plans & subscriptions', 'Exchange rates']` (the literal style of the third name; the separate import line is not edited). Comment line 1785 per Q-6 |
| F-2 | `accountsTab.render.test.tsx` keyboard test | `const rates = screen.getByTestId('finance-tab-exchange-rates')`, `tabIndex -1`. Sequence: Accounts Right → Plans; Plans Right → **Exchange rates**; Exchange rates Right → Overview; Overview End → **Exchange rates**; Exchange rates Home → Overview; Overview Left → **Exchange rates**; Exchange rates Left → Plans; Plans Left → Accounts. The address and the click part stay unchanged. Comment: "the keys wrap over four" (Q-3) |
| F-3 | `financeFilters.test.ts` | Line 48: `parseLink` adds `currencies: read(S.currencies)`. Line 52: `DEFAULTS` adds `currencies: 'enabled'`. Line 60: the key list ends `'status', 'currencies'` |
| F-4 | `financeFilterBar.layout.render.test.tsx:39` | `DEFAULTS` adds `currencies: 'enabled'` |

**New tests (SA-2-6).** N-1 to N-5 and N-7 are in the new `exchangeRatesTab.render.test.tsx`; N-6 is in `financeFilters.test.ts`.

| # | Case | Asserts |
|---|---|---|
| N-1 | Select the tab from Overview (finance data loaded) | `replaceState` spy cleared after arrival; click Exchange rates → **exactly one** `replaceState`; address `/admin/finance?tab=exchange-rates`; arrival `tab=accounts&sort=margin&group=trial&show=negative` → select Exchange rates → no `sort` / `group` / `show` / `status` in the address, one write; arrival `tab=plans&status=failed` → one write, no `status`. Rates table, Show select (`Enabled only`), `kpi-enabled-currencies`, `kpi-last-rate-change` and the history render; no `finance-kpi-strip`, no `finance-filter-bar`; `getAllByRole('heading', { level: 1 })` is one, "Finance"; the rates purpose sentence is shown; the header has no window "as of" text |
| N-2 | `?tab=exchange-rates`, finance read **pending** (never resolves) and finance read **failing** (500), two cases | The rates render (table and KPIs); no `finance-error`, no "the finance page" loading text, no `finance-kpi-placeholders`; `finance-content` has no `aria-busy` attribute; the tablist is shown with Exchange rates selected |
| N-3 | `?tab=exchange-rates&currencies=all` | Show reads All; choose Disabled only → one write, `currencies=disabled`, and the finance `fetch` count does not change; select Overview → **one** write, address `/admin/finance` with no `currencies`. Separately: arrival `/admin/finance?currencies=all` (Overview) → repaired to `/admin/finance` |
| N-4 | `?account=<id>&tab=exchange-rates`, and the same with `&currencies=all` | The business view (`AccountHeader` stand-in), no tablist, no rates table / rates fetch; address ends `?account=<id>` only |
| N-5 | Finance request on the tab | The first finance `fetch` URL on `?tab=exchange-rates` (and on `?tab=exchange-rates&currencies=all`) equals `PINNED_REQUESTS` row 1 (`/api/admin/business-os/finance?preset=this_month`, the Overview literal) |
| N-6 | `financeFilters.test.ts`, new `describe` block (Q-7) | `FINANCE_FILTER_SPEC.currencies` `toBe(EXCHANGE_RATES_FILTER_SPEC.currencies)` and is the last key; `parseLink('tab=exchange-rates')` → `tab: 'exchange-rates'`; rule 5: `{ ...DEFAULTS, currencies: 'all' }` → `{ currencies: 'enabled' }`; on the tab → `null`; on Accounts / Plans → the reset; business + `tab=exchange-rates` + `currencies=all` → pass 1 `{ tab: '', …TAB_KEYS_DEFAULT }`, pass 2 `{ currencies: 'enabled' }`, pass 3 `null`; `toFinanceQuery` for `tab: 'exchange-rates'` (any `currencies`) equals the Overview query, and its serialised request equals row 1 |
| N-7 | Focus (Q-1) | With finance data loaded: focus Overview, Right ×3, Enter (click) Exchange rates → the Exchange rates button still has focus and is the same DOM node; Left ×3, Enter on Overview → focus still on the Overview button |

The new file's fixtures contain no `exchange_rates` string and no `USD <digit>` money string, and they import nothing from `lib/admin/exchangeRates/**` (Q-4). The rates view's logger (`@/lib/logger/client`) is mocked as in `exchangeRatesFilters.render.test.tsx`.

### 7.2 Narrow Jest set

The SA's set (§13.5, Dev 2a step 6) covers every finance test and pin (`financeRequest.pin`, `financeTiles.pin`, `subscriptionsRedirect.config`, `chargeChecksRedirect.config`, `usdCopy.source.guard`, `source.guard`), the rates suites, `layoutFolder.guard`, `KpiStrip.callers.pin`, `AdminSidebar.nav`, `redundantPages`, `contrast.lf1`, the authz surface guard (R8) and `finance.source.guard`:

```bash
npx jest app/admin/finance app/admin/exchange-rates app/admin/components app/admin/__tests__ lib/admin/__tests__ lib/business-os/finance/__tests__ --ci
```

Run it at Step 0 (baseline) and Step 7. Pass = all suites green, with the suite count = baseline + 1 (the new file).

### 7.3 Type check (narrow)

A full `tsc` runs out of memory on this machine (1a). Use a scratch config in the session scratchpad, never committed: `tsconfig.fx2a.json`. It `extends` the worktree's `tsconfig.json` by absolute path, and its `include` lists the worktree's `next-env.d.ts`, `types/**/*.d.ts`, `app/admin/finance/**/*.ts(x)` and `app/admin/exchange-rates/**/*.ts(x)` (absolute paths, tests included). Every importer of `FinanceFilters`, `FinanceTab` and `ExchangeRatesView` is then checked, not only the edited files. Run from the worktree root:

```bash
npx tsc --noEmit -p "<scratchpad>/tsconfig.fx2a.json"
```

Check the exit code and compare the output with the Step 0 baseline. Pass = no new error in any included file.

### 7.4 Lint

```bash
npx eslint app/admin/finance/financeCopy.ts app/admin/finance/components/FinanceTabs.tsx app/admin/finance/financeFilters.ts app/admin/finance/components/FinanceView.tsx app/admin/exchange-rates/components/ExchangeRatesView.tsx app/admin/exchange-rates/page.tsx app/admin/finance/__tests__/financePage.render.test.tsx app/admin/finance/__tests__/accountsTab.render.test.tsx app/admin/finance/__tests__/financeFilters.test.ts app/admin/finance/__tests__/financeFilterBar.layout.render.test.tsx app/admin/finance/__tests__/exchangeRatesTab.render.test.tsx
npm run lint:hooks
```

Pass = exit 0 with 0 findings for each command.

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | **Focus lost on tab switch** if the tablist remounts | §3.3 shape (Q-1) and test N-7 |
| R-2 | **A write loop or a second write** between Finance's hook and the view's hook over `currencies` | One shared field object, last key in both projections, view hook only while shown (§3.5); N-1 and N-3 count `replaceState` with a live `useSearchParams` mock |
| R-3 | **An extra finance request** on a Show change, or a different request string on the tab | `toFinanceQuery` unedited; `useFinanceData` keyed on the string; N-3 counts finance fetches, N-5 and N-6 compare to the pinned Overview literal; `financeRequest.pin` unedited |
| R-4 | **A guard trips on new text.** `exchange_rates` anywhere under `app/admin/finance` (tests included, SA-R13); `timezone` / `user_preferences` in finance sources even in comments (AC-270); `USD <digit>` strings; `text-slate-500` / `-600`; `.sort(` / `.filter(` / `.reduce(` in `FinanceTabs.tsx`; an alias import naming `/admin/exchange-rates` (G-4); `FinanceView` losing its alias header / states imports | Wording checked at Step 6; Step 7 grep; the whole guard set is in §7.2 |
| R-5 | **The standalone page loses its h1 or the layoutFolder entry loses its alias header import** once the view drops the header | `page.tsx` renders the header by alias (§3.4); `exchangeRates.render.test.tsx:173` and `layoutFolder.guard` stay unedited and must pass |
| R-6 | **Hidden chrome changes the other tabs** (DOM or `aria-busy`) | Every gate is `!onRatesTab`; existing `financePage` / `accountsTab` / `financeUrlState` / `financeTiles.pin` suites stay green with only F-1 / F-2 edited |
| R-7 | **Type widening** of `FinanceTab` / `FinanceFilters.tab` reaches a `switch` or a `Record<FinanceTab, …>` elsewhere | grep at Step 0 found the type only in `FinanceTabs.tsx` and `FinanceView.tsx`; the narrow `tsc` over both folders (§7.3) catches any other |
| R-8 | **Line drift** in the SA's forced-edit references (1787 is 1786 at `adb1c6e8`) | Re-verified at Step 0; the handover shows each diff |
| R-9 | **Visible layout shift** for the user: on this tab the tablist sits directly under the header | Accepted by the SA (SQ-19, not a blocker); named in the handover for the user's diff review |
| R-10 | **Truncated file write** (a known agent hazard) | `git diff --numstat` at Step 7; any deletion with no insertion is a stop |
| R-11 | **Shared worktree hazards** | No `git stash`; never remove or unlink the `node_modules` junction; work only in `neuronforge-fx-rates-2` |

---

## 9. SA Review Notes

*To be filled in by SA.*

### SA workplan review

**Reviewed by SA — 2026-10-20.** I checked the workplan against §13.5 (SQ-17 to SQ-24, SA-2-1 to SA-2-8) and read the code on `feature/admin-exchange-rates-2-finance-tab` at `adb1c6e8`. Files read: `FinanceView.tsx` (lines 130-420), `financeFilters.ts` (the repair rules and the Clear patch), `FinanceTabs.tsx`, `exchangeRatesFilters.ts`, `ExchangeRatesView.tsx` (imports, `PURPOSE`), `app/admin/exchange-rates/page.tsx`, `useAdminFilters.ts` (`projectSearch`, `AdminFilterField`), `financeRequest.pin.render.test.tsx`, `KpiStrip.callers.pin.render.test.tsx`, `app/admin/finance/__tests__/source.guard.test.ts`, `usdCopy.source.guard.test.ts`, `useFinanceData.render.test.tsx` (the server-logger walk), `lib/business-os/finance/__tests__/finance.source.guard.test.ts`, `redundantPages.source.guard.test.ts`, `layoutFolder.guard.test.ts` (C-14 (b)), and the four forced-edit sites.

**Status: APPROVED-WITH-CHANGES.** The plan follows the rulings. Every change below is a test-precision or wording condition. None changes the approach, and Dev may start once they are folded into §3 / §7.1 (TL checks before the handover, no second SA pass needed).

#### Verified against the code

| Claim in the workplan | Result |
|---|---|
| Forced-edit lines | ✅ `financePage.render.test.tsx:1786` is the expect, and 1785 is the "third tab" comment (my 1787 was off by one). `financeFilters.test.ts` 48 (`parseLink` return), 52 (`DEFAULTS`), 60 (`Object.keys`). `financeFilterBar.layout.render.test.tsx:39` (`DEFAULTS`). The keyboard test is at `accountsTab.render.test.tsx:209-239` and its comment at 216 ("the keys wrap over three") |
| No other `FinanceFilters` literal or spec-key iteration breaks | ✅ `financeFilters.test.ts:223` (`FINANCE_CLEAR_PATCH` `toEqual`) stays green because the patch does not learn `currencies`. `financeLinks.test.ts:145-160` checks only `tab`, `sort`, `group` and `show`. `subscriptionsRedirect.config.test.ts` parses only `tab` and `status`. Line 31's alias loop is fine because the field has no aliases |
| `projectSearch` keeps the two hooks convergent | ✅ Finance deletes every key it owns and appends them in spec order, with `currencies` last. The view deletes only `currencies` and appends it, and every other key keeps its order. Starting from Finance's canonical string, each hook's projection gives back the same string, foreign keys included. So nothing ping-pongs, and §3.5 is correct |
| The repair runs until it settles | ✅ `FinanceView.tsx:143-146` runs one rule per render and has no pass cap. So business + `tab=exchange-rates` + `status` + `currencies` cleans up in three passes and then returns `null`. Those are arrival repairs, not tab switches, so the one-write rule is not affected |
| `selectedTab` rewrite | ✅ It is equivalent to today's expression for Accounts, Plans and Overview (`query.tab` is `'accounts'` only when there is no business, and the Plans branch is now behind `query.accountId !== null`) |
| `FINANCE_FILTER_SPEC.currencies.defaultValue` (Q-2 (a)) | ✅ `AdminFilterField<V>.defaultValue: V` is public and equals `DEFAULT_CURRENCY_SHOW` by construction |
| Transitive imports | ✅ `exchangeRatesFilters.ts` takes `lib/admin/exchangeRates/exchangeRateRules` as `import type` only, so the type is erased and no zod is loaded. `ExchangeRatesView` imports `@/lib/logger/client` (already in the Finance graph through `PlansSubscriptions.tsx`) and no server logger. The `useFinanceData` walk ("no file under app/admin/finance imports the server logger") passes |
| Hash pins | ✅ `financeRequest.pin` hashes the route schema and `serialiseFinanceUrl` only. Part A renders `FinanceView` over `PINNED_REQUESTS`, none of which is the rates tab, so the rates view is not mounted and no extra `fetch` is made. `KpiStrip.callers.pin` renders `ExchangeRatesKpis` (not edited). No pin hashes `FinanceView.tsx`, `financeFilters.ts`, `FinanceTabs.tsx` or `ExchangeRatesView.tsx` |
| layoutFolder C-14 (b) | ✅ The rates entry still passes "some file imports `AdminPageHeader` by alias", because `page.tsx` takes it over. `reachesLayoutRelatively` is not tripped by `'../../exchange-rates/components/ExchangeRatesView'` (it resolves into the rates folder, not the layout folder) |
| G-4 / G-6 | ✅ G-4 skips `__tests__` (`SKIP_DIRS`) and strips comments. Neither relative specifier contains `/admin/exchange-rates`. The G-6 bans (Supabase, `.from(`, `CurrencyService`, `http`, `console`) are not touched by dropping a header or by the `space-y-6` page wrapper. The `fetch(` count stays 3 |

#### Rulings on Q-1 to Q-7

| # | Ruling |
|---|---|
| **Q-1** | **Accepted. The §3.3 shape meets SQ-19 (i).** SQ-19 (i) exists so that the rates do not wait on, or fail with, the finance read, and so that no finance chrome shows on the tab. Under `onRatesTab \|\| (data && !error)`, the tablist and the rates panel on this tab do not depend on `data`, `loading` or `error`. That meets the intent, and "outside the gate" is read as "not gated by it". The shape is also better than the literal sibling block, which would remount the tablist on every switch to or from the tab and drop focus to `<body>` (an APG manual-activation regression). **The other three tabs are byte-identical.** I checked each expression with `onRatesTab === false`: `aria-busy={undefined ? … : loading}` becomes `loading`; `!onRatesTab && error` becomes `error`; `false \|\| (data && !error)` becomes the old gate; `!onRatesTab && data && data.accountId !== null` becomes the old `data.accountId !== null` inside the gate; `data ? <ternary> : null` becomes the old ternary (the gate already implies `data`); the header's `purpose` and `asOf` are today's. The suites that pin this stay unedited and must pass: `financePage.render.test.tsx` 1944-1961 and 2002-2016 (`aria-busy` true and false on `finance-content`), 2213, the `accountsTab` suite apart from F-2, `financeUrlState`, `financeTiles.pin` and `financeRequest.pin`. **Conditions (SA-2a-1):** (a) each hidden block (the strip / placeholders expression, `<FinanceFilterBar>`, `AdminError`, `AdminLoading`, the `AccountHeader` fragment) is wrapped **in place** as a `!onRatesTab && …` hole. Do not reorder or extract anything, and do not add a `key`, so that `finance-content`, the inner `space-y-4` and the tablist keep their element type and child index on every tab. (b) Accepted as inherent and the same as today: with no finance data (pending or failed), leaving Exchange rates for Overview, Accounts or Plans unmounts the tablist, because those tabs show the finance loading or error text and have never had a tablist without data. Record this as DV-n in the implementation notes, and name it in the handover |
| Q-2 | **(a).** `CURRENCIES_RESET = { currencies: FINANCE_FILTER_SPEC.currencies.defaultValue }` typed `Partial<FinanceFilters>`, with no third relative import. Rule 5 in `financeFilters.ts` keeps `DEFAULT_CURRENCY_SHOW` (that file imports it anyway) |
| Q-3 | **Yes.** One more Right and one more Left, so the closing "Left from Plans → Accounts" assertion is kept. Add `expect(rates).toHaveAttribute('tabIndex', '-1')` beside the other two at arrival, and update the 216 comment to "wrap over four". Nothing else in the test changes |
| Q-4 | **Dev default accepted.** No import from `lib/admin/exchangeRates/**` in any file under `app/admin/finance/` (tests included) and no `exchange_rates` string. Fixtures go in as plain literals, typed `unknown` at the `fetch` stub. Assert the purpose sentence by **importing `EXCHANGE_RATES_PURPOSE`** through the same relative path, not by retyping the literal (one source, and no `USD` text to keep track of) |
| Q-5 | **Keep the `??`** (rule 4 precedent; a state built in a test or link before 2a). Add a short comment that matches rule 4's |
| Q-6 | **Yes.** Line 1785's comment gains "; slice 2a: the fourth, Exchange rates", and the 1786 expect becomes four names. Both lines go in the handover diff. This is the only allowed growth of SQ-23's "nothing else changes" for this file |
| Q-7 | **Yes.** One appended `describe('slice 2a: currencies (SQ-20, SQ-24)')` at the end of `financeFilters.test.ts`. Above it, only lines 48, 52 and 60 change |

#### Other checks requested by TL

| Topic | Ruling |
|---|---|
| Same-field-object `currencies` | ✅ As specified: `currencies: EXCHANGE_RATES_FILTER_SPEC.currencies`, the last key, never spread or copied (no `{ ...field }`, no `textFilter(...)` re-declaration). The SA-2-5 comment text in §3.2 is accepted. N-6's `toBe` identity check plus the line-60 key list pin it |
| Rule 5 | ✅ Accepted as written: after rule 4, `tab !== 'exchange-rates'` and a non-default value → `{ currencies: DEFAULT_CURRENCY_SHOW }`, otherwise `null`. Rules 1-4 run first, so a business link loses the tab to rule 2 and then `currencies` to rule 5 (N-6 covers the three passes). An invalid value (`currencies=junk`) never reaches the rule, because `isValid` parses it to the default. **Add to N-6:** `tab: 'accounts'` with a non-default `sort` and `currencies: 'all'` → rule 5's reset (proves rule 3 does not swallow it on Accounts) |
| One write per switch | ✅ The four patches in §3.3 are single `setFilters` calls. When you enter the tab, the view's mount-time write effect projects defaults onto the leaving tab's string, which has no `currencies` (rule 5 and the leave patches make sure of that), so nothing is written before Finance's one write. When you leave, the view unmounts (writes nothing) and Finance writes once. N-1 (three arrivals) and N-3 (leaving with `disabled` set) count `replaceState`, and they must use the live `useSearchParams` mock (§3.5), never a static `mockSearch` |
| One h1 | ✅ On the tab: one `AdminPageHeader`, title `PAGE_TITLE`, purpose `EXCHANGE_RATES_PURPOSE`, `asOf={null}`. The view renders no header. `source.guard` "FinanceView has no own h1, header by alias" stays green. The standalone page renders the header by alias above the view (2a only), and `exchangeRates.render.test.tsx:173` stays unedited and green |
| `financeRequest.pin` stays unedited | ✅ Confirmed. Nothing the pin hashes is touched, and its Part A links do not mount the view |
| Forced edits F-1 to F-4 | ✅ This is the complete 2a list. F-1 uses the literal `'Exchange rates'` (the third name's style), with no new import line |
| N-1 to N-6 | ✅ Accepted, with the additions below |
| **N-5 (change, SA-2a-2)** | On the tab, `fetch` is called by both Finance and the rates view, so "the first `fetch` URL" is order-dependent. Filter the calls by path. **Exactly one** call goes to `/api/admin/business-os/finance`, and it equals `PINNED_REQUESTS` row 1 (the pin's own "exactly its request, once" standard). Calls to `/api/admin/exchange-rates` are counted separately and are allowed. Do this for both `?tab=exchange-rates` and `?tab=exchange-rates&currencies=all` |
| **N-7 (change, SA-2a-3)** | Make the focus test discriminating, so it would fail under the sibling-block shape. (1) With finance data loaded, capture the Exchange rates button node before activation. Focus Overview, Right ×3, `fireEvent.click` (the existing tests' proxy for Enter on a button). **Await** the address `?tab=exchange-rates` and `aria-selected="true"` on the captured node. Then assert `captured.isConnected`, `screen.getByRole('tab', { name: 'Exchange rates' })` `toBe(captured)`, and `expect(captured).toHaveFocus()`. (2) Do the same back to Overview (Left ×3, click): the captured Overview node is still connected, selected and focused. (3) **Added:** open `?tab=exchange-rates` with the finance read held pending, focus the Exchange rates tab, then resolve the finance read. The tab node is the same and still has focus (the gate does not flip when the read settles, so landing data never steals focus). Once, during the build and not committed, Dev moves the tablist to a sibling block and confirms that (1) fails. Record the result in the implementation notes |
| N-2 addition | Also assert that the finance Retry button is absent (it belongs to `AdminError`) and that the rates panel has `role="tabpanel"` with `aria-labelledby="finance-tab-exchange-rates"` |
| Guard wording traps (SA-2a-4) | §8 R-4 is right. These are the traps that bite in **comments** too, so take care in the new "Slice 2a" header paragraphs of `FinanceView.tsx`, `financeFilters.ts` and `FinanceTabs.tsx`: (1) `timezone` / `user_preferences`: AC-270 reads the raw file (`NO_ACCOUNT_CLOCK.test(read(file))`) over every non-test file in `app/admin/finance`. (2) `exchange_rates` with an underscore: the CUR-3 check strips comments, but SA-R13's wording covers the whole file, so don't write it anywhere, the new test file included (write "the rates table" or the hyphenated id). (3) `FinanceTabs.tsx`: `.sort(` / `.filter(` / `.reduce(` in code (comments stripped, but keep them out of comments anyway). (4) `URL_WRITER` in any finance production file: no `replaceState` / `pushState` / `router.` / `useRouter` in code. Only the tests may spy on `history.replaceState`. (5) `USD <digit>` and `USD ${`: production files only, comments stripped. The purpose sentence ("per 1 USD") does not match, and it stays in `ExchangeRatesView.tsx` anyway. (6) G-4: no `/admin/exchange-rates` in finance code. The comments above the relative imports may say "the alias path would spell the page route", which `stripComments` removes. (7) `\bfx\b` / `\brate\b` applies only to the lib builders (`boostRevenue`, `planRevenue`, `accountEconomics`), not to `app/admin/finance`, so "a rate" in a finance comment is safe |
| `page.tsx` comment | Optimisation, not blocking: the 1a sentence "Reached by typing its URL only, never linked" stops being true. Change it to "reached by its URL and, rendered without this page, from the Finance tab; never linked (D-6)" in the same edit that adds the "2a / 2b deletes this page" line |
| Skills and logging | ✅ This is SA-2-7 again: no entitlements import (type-only included), LLM call, cron, route, repository or schema claim. The six production files have 0 `console.*`, and `ExchangeRatesView` uses `clientLogger`. Nothing to flag |

#### What the user will see change (for the diff review)

| Where | Change |
|---|---|
| `/admin/finance`, Overview / Accounts / Plans | Only one visible change: a fourth tab, **"Exchange rates"**, at the right-hand end of the tablist. The figures, the KPI strip, the filter bar, the "as of" line, loading and errors are unchanged |
| `/admin/finance?tab=exchange-rates` | The h1 stays **"Finance"**. The sentence under it becomes the rates sentence ("Rates an admin keeps by hand, …"), and there is **no window "as of" line**. The Finance KPI strip and the Finance filter bar (window, business picker, Clear, Read at, Refresh) **disappear**, so the tablist sits **directly under the header** and the content moves up (SQ-19, accepted layout shift). Below the tablist, in this order: the rates KPI tiles (Enabled currencies, Last rate change), the rates filter bar (Show, Search, Clear, Read at, Refresh), the rates table and the history, with the same edit and on / off behaviour as 1c. On this tab, Read at / Refresh refer to the rates read |
| Finance read slow or failing | The rates still show on their tab, with no finance spinner and no finance error. Switching back to Overview then shows the finance loading or error text as it does today (and, as today, no tablist until the finance read succeeds) |
| `/admin/exchange-rates` (typed URL) | Looks the same: its own "Exchange rates" header, then the view. It is retired in 2b |
| Sidebar | No change |

#### Required changes before build (fold into §3 / §7.1; TL verifies, no second SA pass)

1. **SA-2a-1:** §3.3 states condition (a), wrap in place with no reorder, extraction or key. The DV for (b), no tablist off the rates tab without finance data, goes in the implementation notes.
2. **SA-2a-2:** N-5 counts finance-route calls only, exactly one, equal to row 1, for both links.
3. **SA-2a-3:** N-7 gets the captured-node assertions, the awaited write, the pending → settled case, and the one-off sibling-block mutation check recorded in the notes.
4. N-6 gains the "Accounts + non-default `sort` + `currencies=all`" case. N-2 gains the Retry-absent and `tabpanel` / `aria-labelledby` assertions. Q-3 adds the arrival `tabIndex` check for the fourth tab. Q-4 uses the imported `EXCHANGE_RATES_PURPOSE`.
5. **SA-2a-4:** Step 6 checks the new comments against the seven wording traps above.

### Approval

[x] Workplan approved with the changes above — proceed to implementation (Steps 0-8). Code review follows Dev's handover.

### SA code review

**Code Review by SA — 2026-10-20**
**Status:** ✅ Code Approved (one non-blocking test addition recommended, CR-1)

I reviewed `git diff HEAD` on `feature/admin-exchange-rates-2-finance-tab` (worktree `neuronforge-fx-rates-2`, base `adb1c6e8`, uncommitted) and the new `app/admin/finance/__tests__/exchangeRatesTab.render.test.tsx` against §13.5 (SQ-17 to SQ-24, SA-2-1 to SA-2-8) and the workplan review above (Q-1 to Q-7, SA-2a-1 to SA-2a-4, N-1 to N-7).

**Re-run by SA:** the narrow Jest set (§7.2) gave **93 suites / 4,637 tests passed**, which matches the Dev's numbers. `eslint` over the 11 files gave 0 errors and 1 warning (`k5Caption`, which is already on `origin/main` and not on an edited line). `npm run lint:hooks` exited 0. A `--numstat` check found no file with deletions and no matching insertions. I did not re-run `tsc`; I took the Dev's narrow `tsc` result (0 errors) and checked the type narrowing by reading the code (item 6).

#### Verified against the diff

| Focus | Result |
|---|---|
| Other three tabs byte-identical | ✅ I re-checked every changed expression with `onRatesTab === false`. Header `purpose` / `asOf`: today's values. Strip: `null ? … : <old expression>` gives the old expression. Bar: `!false && <bar>` gives the bar. `aria-busy`: `loading`. `AdminError` / `AdminLoading`: the old conditions. Gate: `false \|\| (data && !error)`. `AccountHeader`: `data && data.accountId !== null` inside a gate that already implies `data`. Panel slot: `!data ? null : <old ternary>`, where `!data` is unreachable. The existing pins are **unedited**: `git diff --stat` touches `financePage.render.test.tsx` in exactly 2 lines (the F-1 comment and expect, Q-6 / DV-2), `accountsTab.render.test.tsx` only inside the keyboard test (F-2, Q-3), and not at all in `financeRequest.pin`, `financeTiles.pin`, `financeUrlState` or `source.guard`. All are green |
| Gate widened in place (SA-2a-1 (a)) | ✅ Every hidden block is a hole at its old position. Nothing is reordered or extracted, and no `key` is added. `finance-content`, the inner `space-y-4` and `FinanceTabs` keep their element type and child index. The Dev's one-off sibling-block mutation failed N-7 (1) as it should, so the test discriminates |
| `currencies` is the same field object; rule 5 | ✅ `currencies: EXCHANGE_RATES_FILTER_SPEC.currencies`, the last key, no spread and no re-declaration, pinned by `toBe` and by the key list. The SA-2-5 comment is present. Rule 5 sits after rule 4, has the `??` (Q-5) and a comment in rule 4's form, and returns `{ currencies: DEFAULT_CURRENCY_SHOW }`. N-6 covers on-tab `null`, Overview / Plans / Accounts resets, Accounts with non-default `sort` (rule 3 does not swallow it), the three-pass business case, and a state with no key. `toFinanceQuery`, `fromFinanceQuery`, `FINANCE_CLEAR_PATCH` and `financeCanClear` are untouched |
| One write per tab switch | ✅ The four `onSelectTab` branches are single `setFilters` calls with the §3.3 patches. `CURRENCIES_RESET` comes from `FINANCE_FILTER_SPEC.currencies.defaultValue` (Q-2 (a)), with no third relative import. N-1 (from Overview, from Accounts with keys set, from Plans with `status`) and N-3 (Show change, then leaving to Overview) count `history.replaceState` = 1 after `deliver()`, with the live `useSearchParams` mock |
| One h1 | ✅ On the tab there is one `AdminPageHeader` with title "Finance", `EXCHANGE_RATES_PURPOSE` and `asOf={null}`. The view no longer imports or renders a header. `page.tsx` renders the header by alias above the view (2a only), so `exchangeRates.render.test.tsx:173` and the layoutFolder "imports `AdminPageHeader` by alias" rule both stay green with no edit. The purpose text is unchanged, and the tests assert it through the import (Q-4) |
| `financeRequest.pin` | ✅ Unedited and green. N-5 checks that the tab sends exactly one finance-route call, equal to pin row 1, for both links (SA-2a-2) |
| Relative imports carry a reason | ✅ `FinanceView.tsx`, `financeFilters.ts` and the two test imports each have the one-line "alias would spell the page route G-4 refuses" comment (SQ-18). No finance file imports `lib/admin/exchangeRates/**` |
| Guard wording traps (SA-2a-4) | ✅ Under `app/admin/finance`, grep finds no `exchange_rates`, `timezone` or `user_preferences`, tests included. `FinanceTabs.tsx` has no `.sort(` / `.filter(` / `.reduce(`. In finance production code the only URL-writer words are the existing comment lines 9-10 of `FinanceView.tsx`. No `/admin/exchange-rates` outside `__tests__`. No new `USD <digit>`. 0 `console.*` in the six production files |
| Hooks | ✅ No hook was added, moved or made conditional. `onRatesTab` and `CURRENCIES_RESET` are a derived value and a module constant. `onSelectTab`'s deps are unchanged (`[setFilters]`, and the constants are module-level). `ExchangeRatesView`'s hooks are untouched; it still takes `active` (default `true`), with its R-14 test. `lint:hooks` is clean |
| SQ-24: `FinanceView` state across tab switches with a business selected | ✅ With a business there is no tablist, so no tab switch is possible. The rates tab hides the filter bar, so a business cannot be picked from it, and `onPick` is unreachable there. The only way in is a link: `account` + `tab=exchange-rates` (+ `currencies`). On the first render `selectedTab` is `overview` (the `query.accountId !== null` branch), so the rates view never mounts, even for one frame. The finance chrome renders, and the repair cleans `tab` and then `currencies` in two arrival passes. N-4 pins this, with no rates fetch. `pickedName`, `jumpTo` and `windowProblem` live in `FinanceView` and are not touched by the new tab. `jumpTo`'s effect returns early on the rates tab (`onAccountsTab` is true there), and only a strip tile can set it |

#### Rulings on DV-1 to DV-5

| # | Ruling |
|---|---|
| DV-1 | **Accepted.** This is SA-2a-1 (b) as ruled. N-2 pins it (after a failed read, Overview shows `finance-error` and its Retry, and no tablist) |
| DV-2 | **Accepted.** Bookkeeping only. The two lines edited are the two lines Q-6 ruled on |
| DV-3 | **Accepted** as a forced edit that SQ-23 missed. The expectation spreads `DEFAULTS`, and `fromFinanceQuery` stays untouched by ruling (SQ-20 (3)), so the patch has no `currencies` key and the expected object has to say `currencies: undefined`. It is one line plus a comment, in the MK-4 `status: undefined` form. Record it in the requirement's §5.3.4 2a forced-edit list when the requirement is next updated, so 2b's reviewer does not take it for drift |
| DV-4 | **Accepted.** `deliver()` stands in for Next 14.2 delivering the patched `replaceState` to every `useSearchParams` consumer, and follows the `tabCoexistence.render` precedent. It does not hide a second write: writes are counted on the `replaceState` spy, `deliver()` runs **before** each count, and the re-render re-runs both hooks' write effects. A ping-pong would therefore show up as a count above 1 |
| DV-5 | **Accepted: the merge is clean textually and semantically.** A three-way `git merge-file` of #485 (`adb1c6e8` → `0c0ca640`) into our working copies of `FinanceView.tsx`, `financeCopy.ts` and `financePage.render.test.tsx` gave 0 conflicts. I ran it on scratch copies with CRLF normalised, and wrote nothing to the worktree. Semantically: (1) #485's Plans-panel line `{data.converted && <ConvertedThisMonthSection … />}` lands inside the `!data ? null : selectedTab === 'plans' ? …` false branch, so `data` is narrowed there. It renders only when `onRatesTab` is false, which with the outer gate means `data && !error`, exactly as before. The `!onRatesTab` holes do not reach it. (2) #485's `FinanceKpiStrip` changes (the F-K5 converted pill, `plansTab`) render only off the rates tab. The strip's `plansTab` target calls `onSelectTab('plans')`, which now also carries `CURRENCIES_RESET`. That is a no-op off the rates tab, and still one write. (3) #485's new `financePage` tests use `tab=plans`, Overview or a business, never the rates tab. The Plans test's `urls toHaveLength(2)` is safe because the rates view is not mounted on Plans, and it counts no tabs. (4) #485 does not touch `financeRequest.pin`, `financeFilters.ts`, `FinanceTabs.tsx` or the new test's stubs. The new test's finance payload has no `converted`, so the MK-5b section is not rendered on its Plans arrival. The merge is a commit, so RM does it (or the merge queue tests the merged tree). After it, re-run the §7.2 Jest set and the narrow `tsc` on the merged tree before the PR is marked ready |

#### Code Review Comments

1. **CR-1** `app/admin/finance/__tests__/exchangeRatesTab.render.test.tsx` (N-3). Leaving the tab with a non-default Show is tested only toward **Overview**. The Accounts and Plans branches of `onSelectTab` also carry `...CURRENCIES_RESET`. If either branch lost it, the result would be two writes (the patch, then rule 5's repair), and no test would fail. Recommend an `it.each` over Accounts and Plans: open `?tab=exchange-rates&currencies=disabled`, select the tab, and assert one write and no `currencies` in the address. This is cheap to add in this cycle, or QA can add it. — Priority: **Medium** (not blocking)
2. **CR-2** `FinanceView.tsx` (the `!onRatesTab && <FinanceFilterBar>` hole). A round trip through the rates tab now unmounts and remounts the Finance filter bar, so local drafts reset: business-picker search text, and an unapplied custom date in `DatePresets`. Before 2a these drafts survived a switch between Overview, Accounts and Plans. Two things are unaffected: a refused custom window, held as `windowProblem` in `FinanceView`, still shows on return, and the picker does not fetch on mount (RC-6). This follows from SQ-19 (i), not a defect. Name it in the user's diff review next to the layout shift (R-9). — Priority: Low
3. **CR-3** `ExchangeRatesView.tsx:30-31`. The rewrapped header-comment line is now about 110 characters, longer than the lines around it. Style only. — Priority: Low
4. **CR-4** `app/admin/exchange-rates/page.tsx` is LF in the working copy while the other touched files are CRLF (git warns "LF will be replaced by CRLF"). Git normalises it on commit, and `merge-file` against LF blobs is clean once normalised. Nothing to do. Recorded so RM does not mistake the warning for a content change. — Priority: Low

#### Optimisation Suggestions

- Slice 2b, or a later slice: when Exchange rates is selected and no other tab has been visited yet, the finance read could be skipped. SQ-19 (ii) deliberately keeps it running in 2a. This is not for this slice.

#### Skills and standards

SA-2-7 holds on the diff. The diff has no entitlements import (type-only included), no LLM call, no cron or queue, no route, repository, table or column claim, and no caller-supplied id. The admin gate is unchanged. It adds no `console.*` and changes no `any`. No deprecated pattern. Nothing under `next.config.js`, `app/api/**` or `lib/**` is touched.

### Code Approved for QA: Yes

CR-1 is recommended but not required before QA. CR-2 goes into the user's diff review. DV-5: after the RM merge of `origin/main`, re-run the narrow Jest set and `tsc` on the merged tree.

---

## 10. QA Testing Report

**QA — 2026-10-20**
**Test mode:** full
**Strategy used:** A + B. Jest unit and render tests through the real `FinanceView` and the real `ExchangeRatesView`, with `fetch` stubbed by route, plus static source checks. D (manual browser) is owed by the user, see below.
**Focus:** ui, schema (filter spec), security (guards), regression on the other three Finance tabs
**Skipped:** the manual browser click-through (QA has no browser in this session; Playwright is not installed). The session's permission check refused an LF-checkout re-run of the guards, so CRLF safety was checked statically (Edge Case 2)
**Input source:** prompt keywords (TL brief) + §8 slice 2a criteria

Worktree `neuronforge-fx-rates-2`, branch `feature/admin-exchange-rates-2-finance-tab`, base `adb1c6e8`, uncommitted. QA made no commit and no stash, did not touch the `node_modules` junction, and changed no product code.

### Test Coverage (§8 slice 2a)

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Overview / Accounts / Plans look and behave as before; only the forced test edits | ✅ | Pass | All existing finance suites are green. `git diff -U0` on `app/admin/finance/__tests__/` shows only F-1 to F-4 and DV-3, plus the appended N-6 block |
| Tablist reads four names; arrows wrap over four, Home / End, roving `tabIndex`, manual activation | ✅ | Pass | `financePage.render` F-1, `accountsTab.render` F-2 (Right and Left wrap over four, End lands on Exchange rates), N-1 (names), N-7 (Right ×3 / Left ×3) |
| One write per tab switch, keys reset; opening `?tab=exchange-rates` selects it | ✅ | Pass | N-1 (from Overview, from Accounts with keys set, from Plans with a status) and N-3 (leaving for Overview). **QA probe:** a round trip Overview → rates → Accounts → rates → Plans → rates → Overview → rates → Overview. Show is set to All on each visit to the rates tab. Every switch is exactly 1 `replaceState`, and `currencies` goes in the same write. **This closes CR-1:** if the Accounts or Plans branch lost `CURRENCIES_RESET`, rule 5 would add a second write and the count of 1 would fail |
| The rates table, Show (default Enabled only), KPIs and history on the tab; same edit and on / off as 1c | ⚠️ | Partial | Table, Show, both KPIs and history: N-1 / N-2 / N-3. Edit and on / off are **not** exercised on the Finance tab. The rates suites cover them on the standalone page, through the same component, whose diff is header-only (Edge Case 1) |
| No Finance KPI strip / placeholders / filter bar / "as of" on the tab | ✅ | Pass | `expectNoFinanceChrome()` in N-1, N-2, N-7 and the QA pending-then-failing probe |
| Exactly one h1, "Finance", with the rates purpose; the view has no h1; the standalone page keeps "Exchange rates" | ✅ | Pass | On the tab, `getAllByRole('heading', { level: 1 })` has length 1 (N-1, N-2, QA probe). The standalone page is covered by `exchangeRates.render.test.tsx:173` (h1 "Exchange rates"). Statically, `page.tsx` renders one `AdminPageHeader`, and nothing under `app/admin/exchange-rates/components/` renders `<h1` or `AdminPageHeader` |
| Rates visible while the finance read is pending or failing; no finance error, loading text, Retry or `aria-busy` | ✅ | Pass | N-2 (pending; failed). **QA probe:** the read is pending, **then** fails, while the tab is open. The rates stay, there is no `finance-error` and no Try again, the tab node is unchanged, and there is one h1 |
| `currencies` (SQ-20): shared field by identity and last; `&currencies=all` opens All; a Show change is 1 write and no finance read; leaving leaves no key; repaired on other tabs; no `active` prop | ✅ | Pass | N-6 (`toBe`, last key, rule 5, Clear) and N-3. **QA probes:** `?tab=overview&currencies=all` → `/admin/finance` (the unknown tab value and `currencies` both go, Overview is selected, no rates read). `?tab=accounts&currencies=all` → `?tab=accounts`. `?tab=plans&currencies=all` → `?tab=plans`. `FinanceView.tsx:367` is `<ExchangeRatesView />` with no props |
| The business wins: `?account=<id>&tab=exchange-rates` (± `currencies`) | ✅ | Pass | N-4 and N-6. **QA probe:** the old alias `accountId=<id>&tab=exchange-rates&currencies=all` → `?account=<id>`, no tablist, no rates read. The business key is `account` (alias `accountId`). There is no `business` key, so `?business=<id>` is not a business link |
| Request string unchanged; `financeRequest.pin` green and unedited; the read still runs on the tab | ✅ | Pass | N-5 (`toEqual([OVERVIEW_REQUEST])`) and N-6. `financeRequest.pin` and `financeTiles.pin` are green, and `git diff --stat` is empty for both |
| No finance figure changes; both source guards unchanged and green; no `exchange_rates` under `app/admin/finance/` | ✅ | Pass | `source.guard`, `usdCopy.source.guard` and `finance.source.guard` are green and unedited. `grep -rn exchange_rates app/admin/finance`: 0 hits, QA probes included |
| Relative import, no `/admin/exchange-rates` in finance code; G-4 unedited and green | ✅ | Pass | 0 hits for `/admin/exchange-rates` in finance production files. `redundantPages.source.guard` (G-4, G-6) is green and unedited |
| Sidebar unchanged | ✅ | Pass | `AdminSidebar.nav` is green and unedited. Nothing under `app/admin/components/` changed |
| `KpiStrip.callers.pin` unchanged | ✅ | Pass | Green and unedited |
| Nothing does arithmetic on a rate (D-5) | ✅ | Pass | No `rateToUsd` in finance production code. The rates view's diff is the header and comments only |

### QA tests added

Five cases were appended to `app/admin/finance/__tests__/exchangeRatesTab.render.test.tsx`, in `describe('QA probes (slice 2a QA, 2026-10-20)')`:

- the `tab=overview&currencies=all` repair;
- the `currencies` repair on Accounts and Plans;
- the back-and-forth write count (CR-1);
- the finance read pending then failing on the tab;
- the `accountId` alias.

No product file changed. The appended lines are LF in a CRLF working file, and git normalises them on add (`core.autocrlf=true`).

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None.

#### Edge Cases (nice to fix)

1. **Edit and on / off are not exercised on the Finance tab.** Low. The standalone page covers them through the same component, and the component's diff is header-only. When 2b deletes the standalone page, the rates suites should render through the Finance tab, so this cover is not lost.
2. **CRLF safety was checked statically, not by an LF re-run.** Low.
   - `finance.source.guard` normalises `\r\n`.
   - `usdCopy` and `redundantPages` split on `\r?\n`.
   - The finance `source.guard` splits on `\n` per line. That is pre-existing, and it already passes on CRLF.
   - The new test file does no source scan.

   Nothing new depends on line endings, and CI checks files out as LF.
3. **DV-5 still stands.** `origin/main` moved (#485). After RM merges `origin/main`, re-run the narrow Jest set and the narrow `tsc`.
4. **CR-2 (SA): a round trip through the rates tab resets the Finance filter bar's local drafts.** Add it to the manual check below.

### Test Outputs / Logs

| Check | Result |
|---|---|
| Narrow Jest set (§7.2), `--ci`, before the QA probes | 93 suites / 4,637 tests passed (matches Dev and SA) |
| Narrow Jest set (§7.2), `--ci`, with the QA probes | **93 suites / 4,642 tests passed** |
| `exchangeRatesTab.render.test.tsx` alone | 20 / 20 (15 Dev + 5 QA) |
| CI-parity guards, `--ci` (list below) | 10 suites / 2,154 tests passed |
| `tsc --noEmit`, scratch config over `app/admin/finance/**` and `app/admin/exchange-rates/**`, tests included | exit 0, 0 errors |
| `eslint` on the new test file | exit 0 |
| `test:bos-entitlements` | Not applicable: no file in the diff imports `lib/business-os/entitlements/` |

The CI-parity guards run were:

- finance `source.guard`
- `usdCopy.source.guard`
- `finance.source.guard` (CUR-3)
- `financeTiles.pin`
- `financeRequest.pin`
- `KpiStrip.callers.pin`
- `redundantPages` (G-4 / G-6)
- `layoutFolder.guard`
- `AdminSidebar.nav`
- `admin-authz-surface.guard` (R8, the file `test:authz-guard` runs)

The Jest run ends with the usual "a worker process has failed to exit gracefully" notice. All suites passed.

### Manual check owed by the user

The user still owes a browser click-through of `/admin/finance`:

1. Open the Exchange rates tab. Check there is one "Finance" title with the rates sentence, and no Finance strip, filter bar or "as of".
2. Change Show.
3. Edit a rate, then switch a currency off and on again.
4. Switch tabs with the keyboard.
5. Switch back to Overview, Accounts and Plans. Note CR-2: a search typed in the business picker is cleared after visiting the rates tab.
6. Check that `/admin/exchange-rates` still opens with its own "Exchange rates" title.

### Final Status

- [x] All acceptance criteria pass in automated tests: ready for commit after the user has seen the diff. One criterion is partial (edit and on / off are covered through the standalone page only, Edge Case 1). The user still owes the manual browser check
- [ ] Issues found: Dev must address before commit

---

## 11. Commit Info

*To be filled in by RM.*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-20 | Created | Dev: slice 2a workplan from the requirement as refreshed by the BA and cleared by the SA (§13.5). Scope quoted verbatim with `sed` (§1). Branch `feature/admin-exchange-rates-2-finance-tab` at `adb1c6e8`. Seven SA questions (Q-1 tree shape for focus, Q-2 default source, Q-3 keyboard Left step, Q-4 new test fixtures, Q-5 defensive `??`, Q-6 stale comment line, Q-7 test home). Awaiting SA workplan review |
| 2026-10-20 | SA workplan review | SA: **APPROVED-WITH-CHANGES** (§9). Q-1 accepted: the widened gate `onRatesTab \|\| (data && !error)` meets SQ-19 (i)'s intent and keeps focus; the other three tabs were checked expression by expression and are byte-identical; hidden blocks are wrapped in place (SA-2a-1). Q-2 (a); Q-3 to Q-7 accepted (Q-4: no `lib/admin/exchangeRates` import, purpose sentence asserted through the import). N-5 counts finance-route calls only (SA-2a-2); N-7 made discriminating, plus a pending → settled case and a one-off sibling-block mutation check (SA-2a-3); N-2 and N-6 additions; seven guard wording traps listed (SA-2a-4); the user-visible changes tabulated for the diff review |
| 2026-10-20 | Implemented | Dev: slice 2a built uncommitted on `adb1c6e8` per §9 (SA-2a-1 to SA-2a-4, Q-1 to Q-7). Deviations DV-1 to DV-5 (§6.1): DV-3 is a fifth forced test edit (the `fromFinanceQuery` expectation); DV-5: `origin/main` moved to `0c0ca640` (#485) during the build. N-7 mutation check: the sibling-block shape fails N-7 (1); reverted. Narrow Jest 93 suites / 4,637 tests passed; narrow `tsc` 0 errors; `eslint` and `lint:hooks` clean. Awaiting SA code review and QA |
| 2026-10-20 | SA code review | SA: **Code Approved for QA** (§9 "SA code review"). Re-ran the narrow Jest set (93 / 4,637 passed), `eslint` (0 errors) and `lint:hooks` (clean). The other three tabs are byte-identical and their pins unedited; the gate is widened in place; `currencies` is the same field object; rule 5 is correct; one write per switch; one h1; `financeRequest.pin` unedited; guard wording clean; no hook change; SQ-24 state is correct. DV-1 to DV-5 accepted. DV-5: #485 three-way merge is clean textually and semantically (its Plans line sits in the narrowed `data` branch); re-run Jest and `tsc` after the RM merge. CR-1 (Medium, non-blocking): test leaving the tab to Accounts / Plans with a non-default Show. CR-2 to CR-4 Low |
| 2026-10-20 | QA | QA: **PASS-WITH-NOTES** (§10). Narrow Jest `--ci`: 93 suites / 4,637 tests (as Dev), then 93 / 4,642 after 5 QA probes were appended to `exchangeRatesTab.render.test.tsx`. The probes cover the `tab=overview&currencies=all` repair, the `currencies` repair on Accounts / Plans, a round trip at 1 write per switch (closes CR-1), the read pending then failing on the tab, and the `accountId` alias. CI-parity guards: 10 suites / 2,154 tests, green and unedited. Narrow `tsc`: 0 errors. No bugs. Notes: edit and on / off are covered only through the standalone page; CRLF was checked statically; re-run Jest after the `origin/main` merge (DV-5). The user still owes the manual browser click-through |
