# Workplan: Admin exchange rates, slice 2b (retire the old URL)

> **Last Updated**: 2026-10-20

**Developer:** Dev
**Requirement:** [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md) §1 (row 2b), §5.3.3, §5.3.4 (2b), FR-26, §8 slice 2b, §13.5 (SQ-17, SQ-22, SQ-23 2b half, Dev 2b steps)
**Branch:** `feature/admin-exchange-rates-2b-redirect` (worktree `neuronforge-fx-rates-2b`). It starts at `251472bb`, the 2a tip (2a is PR #486, in the merge queue). RM merges `origin/main` in after #486 lands, and the PR opens only then (SA-2-4: 2b is not stacked on an open PR).
**Date:** 2026-10-20
**Status:** Code Complete (uncommitted, awaiting SA code review + QA). SA workplan review APPROVED-WITH-CHANGES (§9); Q-1 to Q-5 and SA-2b-1 to SA-2b-4 applied (§6.1)

## Overview

Slice 2b retires the old address `/admin/exchange-rates`. Since 2a, the rates live on Finance's fourth tab (`/admin/finance?tab=exchange-rates`), and the standalone page only re-renders the same view under its own h1. In 2b that page file is deleted, and `next.config.js` gains one temporary redirect from the old address to the tab. The redirect keeps the query, so `?currencies=all` arrives with it, and the destination's `tab` always wins. This copies the Money MK-4 precedent (`/admin/subscriptions` → `/admin/finance?tab=plans`) exactly: `permanent: false`, no `has`, page deleted, R8 untouched. The rest of the slice is tests: one new redirect config test, and the forced edits the SA listed for guards that read the deleted file or count pages and redirects. No product behaviour changes for anyone who uses the tab. No API route, repository, rate rule or finance figure changes.

## Table of Contents

1. [Approved scope (quoted verbatim)](#1-approved-scope-quoted-verbatim)
2. [Analysis summary](#2-analysis-summary)
3. [Implementation approach](#3-implementation-approach)
4. [Questions for SA](#4-questions-for-sa)
5. [Files to create / modify / delete](#5-files-to-create--modify--delete)
6. [Task list](#6-task-list)
7. [Tests and commands](#7-tests-and-commands)
8. [Risks](#8-risks)
9. [SA Review Notes](#9-sa-review-notes)
10. [QA Testing Report](#10-qa-testing-report)
11. [Commit Info](#11-commit-info)
12. [Change History](#change-history)

---

## 1. Approved scope (quoted verbatim)

Every block in this section was extracted with `sed -n` from `docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md` at `251472bb`. The line numbers are given with each block. Nothing in them is reworded.

### 1.1 §1 Progress, row 2b (table header lines 39-40, row line 44)

| # | Slice | Status | PR | Notes |
|---|---|---|---|---|
| 2b | Old URL retired: `next.config.js` temporary redirect `/admin/exchange-rates` → `/admin/finance?tab=exchange-rates`, `app/admin/exchange-rates/page.tsx` deleted (SQ-17 (a)). FR-26 | ⬜ After 2a | — | Branches from `origin/main` **after 2a merges, not stacked** (SA-2-4). Config + tests only; separately revertible |

### 1.2 §5.3.3 The old URL (lines 222-233)

#### 5.3.3 The old URL (SQ-4)

SQ-4 ruled: `/admin/exchange-rates` becomes a server `redirect('/admin/finance?tab=exchange-rates')`. Authz guard **R8** (`lib/admin/__tests__/admin-authz-surface.guard.test.ts`) accepts a render entry point under `app/admin/**` that is a client component **or** a server page whose first statement awaits `requireAdminPage()` (R8's self-guarding clause, `guardsItselfFirst`); its exemption lists `R8_PARKED` and `R8_PERMANENT` are **empty and capped at 0** "and it has to stay that way". So a Server Component `page.tsx` that calls `redirect()` **fails R8 unless its first statement awaits `requireAdminPage()`**; none exists under `app/admin`, and SA rejects introducing one here (SQ-17 (d), SA-2-1).

**Ruled (SQ-17, 2026-10-20): option (a), built in slice 2b.** (b), (c) and (d) rejected.

| Option | What | Ruling |
|---|---|---|
| (a) **Ruled** | The Money MK-4 precedent: one temporary redirect in `next.config.js` `redirects()` — `{ source: '/admin/exchange-rates', destination: '/admin/finance?tab=exchange-rates', permanent: false }`, no `has`, with a comment in the existing style — and `app/admin/exchange-rates/page.tsx` is **deleted** (as `/admin/subscriptions` was for the Plans tab) | ✅ R8 untouched. The incoming query is kept and the destination's `tab` wins (`prepareDestination`, Next 14.2.35): `?currencies=all` arrives with it, `?tab=accounts` still lands on Exchange rates. The redirect runs before the admin layout; the destination is gated by it, so a non-admin still gets the layout's refusal. New test `app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts` in the `subscriptionsRedirect.config.test.ts` shape (shape block + `prepareDestination` block, asserting the parsed query object); `chargeChecksRedirect.config.test.ts` "three redirects in all" becomes four |
| (b) | Keep `page.tsx` as a `'use client'` component that calls `redirect()` from `next/navigation` during render | ❌ Rejected: a client page whose only job is to leave; drops the query unless it adds `useSearchParams` and a Suspense boundary; renders a flash first |
| (c) | A Server Component page + an R8 exemption, cap 0 → 1 | ❌ Rejected: R8 stays at 0 |
| (d) | A self-guarding server page (`await requireAdminPage()` first, then `redirect()`) | ❌ Rejected although R8 accepts it: it would be the first server-rendered page under `app/admin`, a new pattern (CLAUDE.md rule 7) for no gain over (a) |

### 1.3 §5.3.4, the 2b part (lines 235-247 heading, ruled-list note and "Unchanged in both"; lines 262-272, 2b)

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

**2b — forced edits to existing tests (the complete list)**

| Test | Edit |
|---|---|
| `chargeChecksRedirect.config.test.ts:50-53` | "three redirects in all" → four (`toHaveLength(4)`, test name and comment) |
| `redundantPages` **G-6** (Exchange rates folder) | Drop `expect(files).toContain(EXCHANGE_PAGE)` and the "the REDUNDANT header is gone from the page" test (both read the deleted file); delete the then-unused `EXCHANGE_PAGE` constant; the guard's header gains an "Amended by slice 2" line. 6 non-test files remain (≥ 5 holds); the `fetch(` count stays **3**; the module logger rule is unchanged |
| `AdminSidebar.nav.test.ts` | **On-disk floor 29 → 28** (`expect(onDisk.length).toBeGreaterThanOrEqual(29)`, line 167, becomes 28); `expect(onDisk).toContain('/admin/exchange-rates')` (line 177) becomes `not.toContain` (the MK-4 Subscriptions precedent); `/admin/exchange-rates` leaves `UNLISTED`; the two stale comments (above `UNLISTED`, lines 89-91, and header line 28 "Both pages stay on disk") are rewritten. **`allHrefs` stays 28**; "never names `exchange-rates`" (line 203) stays. No new sidebar item |
| `layoutFolder.guard` C-14 registry (SQ-22) | The `'/admin/exchange-rates (Exchange rates)'` entry is removed and its five non-page files are appended to the `'/admin/finance (Finance)'` entry, with a comment in the Charge checks form ("the view stays in `app/admin/exchange-rates/` (SA-R13) and is listed here, and only here"). `changedByText.ts` is not added |
| `exchangeRates.render.test.tsx`, `exchangeRatesFilters.render.test.tsx` | Render `<ExchangeRatesView />` instead of `import ExchangeRatesPage from '../page'` (lines 44 and 34); the h1 assertion at `exchangeRates.render.test.tsx:173` becomes "the view renders no h1" (the one-h1 check lives in the new Finance tests) |

**2b — new test:** `app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts` per SQ-17 (§5.3.3).

### 1.4 §6 FR-26 (table header lines 364-365, row line 391)

| # | Requirement | Slice |
|---|---|---|
| FR-26 | `/admin/exchange-rates` sends the admin to `/admin/finance?tab=exchange-rates` by a temporary `next.config.js` redirect that keeps the query; the page file is deleted (SQ-4, SQ-17 (a)) | 2b |

### 1.5 §8 Acceptance criteria, slice 2b (lines 485-491)

**2b — the old URL** (FR-26)

- [ ] `next.config.js` has exactly one redirect for `/admin/exchange-rates`: destination `/admin/finance?tab=exchange-rates`, `permanent: false`, no `has` (SQ-17 (a)); `app/admin/exchange-rates/page.tsx` is deleted.
- [ ] The new `exchangeRatesRedirect.config.test.ts` passes: no query → `{ tab: 'exchange-rates' }`; `currencies=all` → `{ tab: 'exchange-rates', currencies: 'all' }`, read as the tab and as All; an incoming `tab=accounts` → `tab: 'exchange-rates'` (the destination wins); `currencies=junk` → the default.
- [ ] A non-admin following the old URL is still refused by the admin layout. Authz R8 green with no new exemption (cap 0).
- [ ] Existing tests are amended only as the 2b list in §5.3.4 says (`chargeChecksRedirect` four, G-6, `AdminSidebar.nav` on-disk floor 29 → 28 and `not.toContain`, layoutFolder registry per SQ-22, the two rates render suites); `allHrefs` stays 28; G-4 unedited.
- [ ] `git diff --stat` shows no file under `app/api/admin/exchange-rates/`, `lib/admin/exchangeRates/`, `lib/repositories/` or `lib/business-os/finance/`; `next.config.js` gains no `console.*`.

### 1.6 §13.5 Rulings for 2b (table header lines 747-748; SQ-17 line 749; SQ-22 line 754; the 2b half of SQ-23, line 755 from `**2b:**` to the end of the row; the row label `SQ-23 (2b half)` is Dev's, the cell after it is verbatim)

| # | Ruling |
|---|---|
| SQ-17 | **(a), the MK-4 mechanism.** In `next.config.js` `redirects()`, one entry `{ source: '/admin/exchange-rates', destination: '/admin/finance?tab=exchange-rates', permanent: false }`, no `has`, with a comment in the existing style (slice 2, SQ-4 / SQ-17, temporary for the same reason, query kept); `app/admin/exchange-rates/page.tsx` is **deleted**. **(b) rejected:** a client page whose only job is to leave, drops the query unless it adds `useSearchParams` and a Suspense boundary, and renders a flash first. **(c) rejected:** R8 stays at 0. **(d), a self-guarding server page (`await requireAdminPage()` then `redirect()`), rejected too** although R8 accepts it (SA-2-1): it would be the first server-rendered page under `app/admin`, a new pattern (CLAUDE.md rule 7) for no gain over (a). SQ-4's "server `redirect()`" is satisfied in spirit: the redirect is server-side, before any render. The redirect runs before the admin layout; the destination is gated by it, so a non-admin still gets the layout's refusal. New test `app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts` in the `subscriptionsRedirect.config.test.ts` shape: shape block (exactly one entry for the source, `toEqual` the three fields); `prepareDestination` block: no query → `{ tab: 'exchange-rates' }`; `currencies=all` → `{ tab: 'exchange-rates', currencies: 'all' }`, read by `FINANCE_FILTER_SPEC.tab` as `exchange-rates` and by the `currencies` field as `all`; an incoming `tab=accounts` → `tab: 'exchange-rates'` (the destination wins); `currencies=junk` → the field reads the default |
| SQ-22 | **Accepted, in 2b.** The `'/admin/exchange-rates (Exchange rates)'` entry is removed and its five non-page files are appended to the `'/admin/finance (Finance)'` entry with a comment in the Charge checks form ("the view stays in `app/admin/exchange-rates/` (SA-R13) and is listed here, and only here"). `changedByText.ts` is not added (not registered today; no scope creep). In 2a the entry is unchanged: `page.tsx` still imports the header |
| SQ-23 (2b half) | **2b:** `chargeChecksRedirect.config.test.ts` three → four (test name and comment); `redundantPages.source.guard` G-6: drop `toContain(EXCHANGE_PAGE)` and the "REDUNDANT header is gone from the page" test, delete the then-unused `EXCHANGE_PAGE` constant, header gains an "Amended by slice 2" line; `AdminSidebar.nav.test.ts`: on-disk floor 29 → 28, `/admin/exchange-rates` `not.toContain`, out of `UNLISTED`, the two stale comments rewritten, `allHrefs` 28 unchanged; `layoutFolder.guard` registry per SQ-22; the two rates render suites render `<ExchangeRatesView />` instead of `../page`, and the h1 assertion at `exchangeRates.render.test.tsx:173` becomes "the view renders no h1" (the one-h1 check moves to the new Finance tests) |

### 1.7 §13.5 Required changes, the Dev 2b steps (lines 789-793)

**Dev, 2b workplan and build (after 2a merges):**

1. `next.config.js` redirect per SQ-17; delete `app/admin/exchange-rates/page.tsx`.
2. New `exchangeRatesRedirect.config.test.ts` per SQ-17; the 2b forced edits per SQ-23 and SQ-22.
3. Confirm `git diff --stat` shows no file under `app/api/admin/exchange-rates/`, `lib/admin/exchangeRates/`, `lib/repositories/` or `lib/business-os/finance/`.

---

## 2. Analysis summary

Read at `251472bb` in this worktree. Every line number below is from that tree.

### 2.1 What exists today

| Item | As built | Source |
|---|---|---|
| Redirects | `next.config.js` `redirects()` (lines 71-99) returns three entries: `/business-os/payments`, the M-5 `/admin/business-os-llm` + `has: tab=costs` entry, and the MK-4 `/admin/subscriptions` → `/admin/finance?tab=plans` entry (lines 89-97, `permanent: false`, no `has`, a four-line comment) | `next.config.js` |
| The old page | `app/admin/exchange-rates/page.tsx`, 25 lines, `'use client'`. It renders `<AdminPageHeader title="Exchange rates" purpose={EXCHANGE_RATES_PURPOSE} />` above `<ExchangeRatesView />` (2a, SQ-21). No `fetch(`, no logger | `app/admin/exchange-rates/page.tsx` |
| What stays in the folder | `exchangeRatesFilters.ts`; `components/ExchangeRatesView.tsx`, `ExchangeRatesKpis.tsx`, `ExchangeRatesTable.tsx`, `RateHistoryTable.tsx`, `changedByText.ts`; `__tests__/` (3 suites). The module logger `AdminExchangeRates` and all three `fetch(` sites are in `ExchangeRatesView.tsx` | `app/admin/exchange-rates/` |
| The destination | Finance's fourth tab, `?tab=exchange-rates` (2a). `FINANCE_FILTER_SPEC.tab` accepts `exchange-rates`. `FINANCE_FILTER_SPEC.currencies` is `EXCHANGE_RATES_FILTER_SPEC.currencies` (the same object), default `DEFAULT_CURRENCY_SHOW = 'enabled'`; an invalid value parses to the default | `app/admin/finance/financeFilters.ts:150, :159`; `app/admin/exchange-rates/exchangeRatesFilters.ts:32, :57` |
| R8 | Reads every render entry point under `app/admin/**` from disk (`ADMIN_RENDER_ENTRIES`, compared with the on-disk list at line 2036). Deleting a page lowers the count; no cap or count is pinned | `lib/admin/__tests__/admin-authz-surface.guard.test.ts:868-889, 2036-2038` |

### 2.2 Every reference to the page, the page path and `EXCHANGE_PAGE`

Found outside `docs/` with `git grep -n "admin/exchange-rates"` (API paths filtered out), `git grep -n "EXCHANGE_PAGE\|exchange-rates/page\|from '../page'"` and `git grep -ln ExchangeRatesPage`.

| Reference | What it does | 2b action |
|---|---|---|
| `app/admin/__tests__/redundantPages.source.guard.test.ts:47` `EXCHANGE_PAGE` | Constant, used only at :214 and :242-243 | Deleted (G-6 forced edit) |
| `redundantPages…:214` `expect(files).toContain(EXCHANGE_PAGE)` | G-6 walk self-check | Dropped (G-6) |
| `redundantPages…:241-244` "the REDUNDANT header is gone from the page" | Reads the page | Test dropped (G-6) |
| `redundantPages…:60` `PAGE_ROUTES` contains `/admin/exchange-rates`; `:260, :273-277, :284` planted controls | G-4 / G-2 still refuse the route in product code | **Unchanged** (G-4 unedited, SA ruling) |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts:93` `UNLISTED` | Lists the page as deliberately unlisted | `/admin/exchange-rates` removed (forced edit) |
| `AdminSidebar.nav…:167` on-disk floor `29` | Scan sanity floor | 28 (forced edit) |
| `AdminSidebar.nav…:177` `toContain('/admin/exchange-rates')` | Page on disk | `not.toContain` (forced edit) |
| `AdminSidebar.nav…:89-92` and `:26-28` comments | "both routes are kept", "Both pages stay on disk" | Rewritten (forced edit) |
| `AdminSidebar.nav…:203` `not.toContain('exchange-rates')` | The sidebar never names it | **Unchanged** |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts:727-742` | The `'/admin/exchange-rates (Exchange rates)'` registry entry, `page.tsx` first | Entry removed; five files move to Finance (SQ-22) |
| `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx:44, 159, 200, 208` | `import ExchangeRatesPage from '../page'` and three renders | Render `<ExchangeRatesView />` |
| `exchangeRates.render…:173` | The h1 "Exchange rates" assertion | Becomes "the view renders no h1" |
| `app/admin/exchange-rates/__tests__/exchangeRatesFilters.render.test.tsx:34, 147, 187` | The import and two renders (`ExchangeRatesView` is already imported at :35) | Render `<ExchangeRatesView />`; drop the `../page` import |
| `exchangeRatesFilters.render…:37` `PATH = '/admin/exchange-rates'` | The jsdom address only (`replaceState` at :119); every assertion reads `location.search` | Left as is (Q-2) |
| `exchangeRates.render…:4` header "on /admin/exchange-rates" | Comment | Q-1 |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx:9-11, :91-92` | Comments: "Reached by its URL only (D-6)"; "and the standalone page until slice 2b deletes it" | Q-1 (comment only) |
| `AdminSidebar.nav…:6` "(except Exchange Rates)"; `redundantPages…:24` "(the page and its components)" and the G-6 test title "walks the page and its components" at :212 | Comments and a test title | Q-1 |
| `lib/repositories/ExchangeRatesRepository.ts:3` | Comment "behind `/admin/exchange-rates`" | **Not touched**: §8 forbids any `lib/repositories/` file in the diff (Q-1 (d)) |
| `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx:67` | Alias import of `ExchangeRatesKpis` (a component, not the page) | Unchanged |
| `app/admin/finance/**` (`FinanceTabs`, `FinanceView`, `financeFilters`, their tests) | The tab key `exchange-rates` and relative imports into `../exchange-rates/` | Unchanged |
| `supabase/migrations/__tests__/*` | Name the checker script `check-bos-exchange-rates-write-access.sql` | Unrelated, unchanged |

No script, JSON config, sitemap or other `.js` file names the page. `next.config.js` is outside G-4's walk roots, so the new redirect source does not trip G-4.

### 2.3 Which phase or layer

Routing config plus tests. This is not V6 work and not a plugin. No DB, no API route, no repository, no LLM call, no entitlements import, no money arithmetic.

---

## 3. Implementation approach

### 3.1 `next.config.js`

Append a fourth entry after the MK-4 entry, in its exact form:

**File:** `next.config.js`

```js
      {
        // Admin Exchange Rates slice 2 (SQ-4, SQ-17): the Exchange rates page
        // is now Finance's Exchange rates tab. Temporary for the same reason
        // as above. Next merges the incoming query with the destination's, so
        // a Show filter (?currencies=all) arrives with it, and the
        // destination's tab wins over an incoming one.
        source: '/admin/exchange-rates',
        destination: '/admin/finance?tab=exchange-rates',
        permanent: false,
      },
```

No `has`, no `console.*`, and nothing else in the file changes. The source has no wildcard, so only the exact old address matches. `/api/admin/exchange-rates` is not matched.

### 3.2 Delete the page

`git rm` is a commit step, so it belongs to RM. Dev deletes the file from the working tree (`rm app/admin/exchange-rates/page.tsx`), so `git status` shows ` D`. The folder stays: without a `page.tsx` it is not a route, and the redirect runs before the filesystem routes anyway. `components/`, `exchangeRatesFilters.ts`, `changedByText.ts` and `__tests__/` stay.

### 3.3 New test `app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts`

This copies the `subscriptionsRedirect.config.test.ts` shape, with the cases SQ-17 lists. It uses `@jest-environment node`, `prepareDestination` from `next/dist/shared/lib/router/utils/prepare-destination`, `jest.requireActual('@/next.config.js')`, and `FINANCE_FILTER_SPEC` by alias. It imports `DEFAULT_CURRENCY_SHOW` by the relative path `'../../exchange-rates/exchangeRatesFilters'` (as `financeFilters.test.ts:323` does, DV-1). The file contains no `exchange_rates` text anywhere (the finance guard scans tests, SA-2-6).

| Block | Case | Assertions |
|---|---|---|
| Shape | Exactly one entry for `/admin/exchange-rates` | `filter(...).toHaveLength(1)`; `toEqual({ source, destination: '/admin/finance?tab=exchange-rates', permanent: false })`; plus `not.toHaveProperty('has')` (Q-3) |
| `prepareDestination` | No query | `pathname` `/admin/finance`; `query` `toEqual({ tab: 'exchange-rates' })`; `FINANCE_FILTER_SPEC.tab.parse(get)` is `exchange-rates`; `currencies.parse(get)` is `DEFAULT_CURRENCY_SHOW` |
| | `currencies=all` | `query` `toEqual({ tab: 'exchange-rates', currencies: 'all' })`; the tab parses as `exchange-rates`; `currencies` parses as `all` |
| | An incoming `tab=accounts` (the destination wins) | `query` `toEqual({ tab: 'exchange-rates' })`; the tab parses as `exchange-rates` |
| | `tab=accounts&currencies=disabled` | `query` `toEqual({ tab: 'exchange-rates', currencies: 'disabled' })`: the tab is overridden and the rest is kept |
| | `currencies=junk` | `query` keeps `currencies: 'junk'`; `currencies.parse(get)` is `DEFAULT_CURRENCY_SHOW` |

Every query check compares the parsed object (`parsedDestination.query`), never a string. The `prepareDestination` block takes `destination` from the config entry (as `chargeChecksRedirect` does), so the config and the cases cannot drift apart (Q-3).

### 3.4 Forced edits (SQ-23 2b half, SQ-22): exactly these lines

| File | Edit |
|---|---|
| `app/admin/finance/__tests__/chargeChecksRedirect.config.test.ts:50-53` | The comment gains "Admin Exchange Rates slice 2b (SQ-17): the Exchange rates redirect joins, so four."; the test name becomes "…; four redirects in all"; `toHaveLength(4)`. The `toContainEqual` payments line stays |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` | Delete `EXCHANGE_PAGE` (:47). Drop `expect(files).toContain(EXCHANGE_PAGE)` (:214). Drop the test "the REDUNDANT header is gone from the page" (:241-244). The header gains one paragraph: "Amended by Admin Exchange Rates slice 2 (2b, SQ-17, SQ-23): the page file is deleted (the old URL redirects to Finance's tab), so G-6 walks the view folder only, and its two page-only checks are dropped. G-4 and `PAGE_ROUTES` are unchanged." `hasHeader` stays (G-1 and the planted controls use it). The fetch count stays **3**, the `≥ 5` floor holds (6 files), and the logger rule is unchanged |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | :167 floor `29` → `28`, with a line added to the comment above it ("Admin Exchange Rates 2b: /admin/exchange-rates left the disk (it redirects to Finance's tab), so 28."). :177 `toContain` → `not.toContain`. :93 becomes `UNLISTED = ['/admin/platform-dashboard']`. The :89-92 comment is rewritten: Exchange rates is no longer a page (it is Finance's tab and its old URL redirects), and the redundant dashboard stays unlisted. Header item 10 (:26-28) "Both pages stay on disk" is rewritten to say the dashboard stays on disk and Exchange rates left it in 2b. `allHrefs` `toHaveLength(28)` and :203 are unchanged |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | Remove the `'/admin/exchange-rates (Exchange rates)'` entry (:727-742). In the `'/admin/finance (Finance)'` entry's `files`, after `FinanceSection.tsx`, append a comment in the Charge checks form ("Admin Exchange Rates slice 2b (SQ-22): the Exchange rates tab. The view stays in `app/admin/exchange-rates/` (SA-R13) and is listed here, and only here.") and the five files: `exchangeRatesFilters.ts`, `components/ExchangeRatesView.tsx`, `components/ExchangeRatesKpis.tsx`, `components/ExchangeRatesTable.tsx`, `components/RateHistoryTable.tsx`. `changedByText.ts` is not added. No rule changes |
| `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx` | Remove the :44 `import ExchangeRatesPage from '../page'`. The existing `REFRESH_AFTER_SAVE_FAILED` import from `'../components/ExchangeRatesView'` (:45) gains `ExchangeRatesView`. The three `<ExchangeRatesPage />` (:159, :200, :208) become `<ExchangeRatesView />`. :173 becomes `expect(screen.queryByRole('heading', { level: 1 })).toBeNull();` (Q-4) |
| `app/admin/exchange-rates/__tests__/exchangeRatesFilters.render.test.tsx` | Remove the :34 import. `<ExchangeRatesPage />` at :147 and :187 become `<ExchangeRatesView />` (already imported at :35) |

The handover includes each forced-edit file's diff. Nothing else in those files changes, apart from what SA rules under Q-1 and Q-2.

### 3.5 Requirement bookkeeping (doc only)

- §5.3.4, the "2a — forced edits" table: add the DV-3 row, as the SA asked in the 2a code review ("Record it in the requirement's §5.3.4 2a forced-edit list when the requirement is next updated, so 2b's reviewer does not take it for drift"). Proposed row (anchored on the test name, SA-2b-3): `financeFilters.test.ts`, the test "fromFinanceQuery maps the Accounts tab's query back" (at `251472bb`: `it(` line 205, the edit at 214-215) (DV-3, accepted in the 2a code review) | The "fromFinanceQuery maps the Accounts tab's query back" expectation gains `currencies: undefined` with a one-line comment, after `status: undefined` (MK-4 form); `fromFinanceQuery` is unchanged (SQ-20 (3)).
- §1 row 2b: the status and workplan link at each stage, plus a Change History row (standing rule: every slice stage goes into the main requirement).

Q-5 asks who writes these lines: Dev in this branch, or the BA.

### 3.6 What 2b does not touch

`app/api/admin/exchange-rates/**`, `lib/admin/exchangeRates/**`, `lib/repositories/**`, `lib/business-os/finance/**`, every finance product file, the view's code, `ExchangeRatesKpis.tsx` (so `KpiStrip.callers.pin` stays), G-4, G-2, R8, the finance guards and the sidebar component.

---

## 4. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | Some comments go stale when the page is deleted but are **not** in the SQ-23 list: (a) `ExchangeRatesView.tsx:9-11` "Reached by its URL only (D-6); slice 2 renders this same view from a Finance tab" and `:91-92` "the Finance tab, and the standalone page until slice 2b deletes it"; (b) in forced-edit files: `AdminSidebar.nav.test.ts:6` "(except Exchange Rates)", `redundantPages…:24` "(the page and its components)" and the G-6 test title "walks the page and its components" (:212), and `exchangeRates.render.test.tsx:4` "on /admin/exchange-rates"; (c) the `layoutFolder.guard` header; (d) `lib/repositories/ExchangeRatesRepository.ts:3` | (a) Fix both as comment-only edits: the view is reached only from Finance's tab, and the old URL redirects there. (b) Fix them in the same files: the comments and the one test title only. (c) Add one "Amended by Exchange rates 2b" paragraph, as 1c.2 did. (d) Leave it: §8 keeps `lib/repositories/` out of the diff, and the sentence is still true of the data behind the tab. Record it as a follow-up |
| Q-2 | `exchangeRatesFilters.render.test.tsx:37` `PATH = '/admin/exchange-rates'` sets only the jsdom address; no assertion reads the pathname | Leave it (SQ-23: nothing else in the file changes). The alternative is `/admin/finance`, one line |
| Q-3 | MK-4's shape check is `toEqual`, which ignores `has: undefined`. MK-4's `prepareDestination` block also uses a literal destination | Keep `toEqual` and add `not.toHaveProperty('has')`, so "no `has`" is pinned literally. Take `destination` from the config entry, as `chargeChecksRedirect` does. Both are stricter than MK-4, and neither changes its shape |
| Q-4 | The h1 assertion at `exchangeRates.render.test.tsx:173` | Same test, same title; the line becomes `expect(screen.queryByRole('heading', { level: 1 })).toBeNull()`. The one-h1 "Finance" check already lives in `exchangeRatesTab.render.test.tsx` (2a) |
| Q-5 | DV-3 into §5.3.4's 2a table, plus the §1 row 2b and the Change History | Dev writes the DV-3 row and the §1 status in this branch as doc-only edits (§3.5). The BA confirms the wording at the next requirement pass |

---

## 5. Files to create / modify / delete

| File | Action | Reason |
|---|---|---|
| `next.config.js` | modify | One redirect, `permanent: false`, no `has` (SQ-17 (a), FR-26) |
| `app/admin/exchange-rates/page.tsx` | **delete** | SQ-17 (a) |
| `app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts` | create | The SQ-17 new test |
| `app/admin/finance/__tests__/chargeChecksRedirect.config.test.ts` | modify | Three → four (SQ-23) |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` | modify | G-6 (SQ-23) |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | modify | Floor 29 → 28, `not.toContain`, `UNLISTED`, two comments (SQ-23) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | Registry move (SQ-22) |
| `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx` | modify | Render the view; no h1 (SQ-23) |
| `app/admin/exchange-rates/__tests__/exchangeRatesFilters.render.test.tsx` | modify | Render the view (SQ-23) |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | modify (comments only) | Only if SA accepts Q-1 (a) |
| `docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md` | modify (doc) | DV-3 row, §1 row 2b, Change History (Q-5) |
| `docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_2B_WORKPLAN.md` | create | This workplan |

---

## 6. Task list

- ✅ Step 0: Confirm the branch (`git branch --show-current` = `feature/admin-exchange-rates-2b-redirect`) and that `HEAD` is `251472bb` (or the RM merge of `origin/main` after #486). Run the narrow Jest set (§7.1) and the narrow `tsc` (§7.2) for a baseline.
- ✅ Step 1: Add the `next.config.js` redirect (§3.1).
- ✅ Step 2: Delete `app/admin/exchange-rates/page.tsx` (§3.2).
- ✅ Step 3: Write the new `exchangeRatesRedirect.config.test.ts` (§3.3). Mutation check: point the config destination at `?tab=plans` and add `has: []`, confirm that the shape and parse cases fail, then revert.
- ✅ Step 4: `chargeChecksRedirect` three → four.
- ✅ Step 5: `redundantPages` G-6 edits and the header paragraph.
- ✅ Step 6: `AdminSidebar.nav` edits.
- ✅ Step 7: `layoutFolder.guard` registry move (SQ-22).
- ✅ Step 8: Make the two rates render suites render the view, and change the h1 line (Q-4).
- ✅ Step 9: Comment edits as ruled under Q-1 / Q-2.
- ✅ Step 10: Requirement bookkeeping (§3.5, Q-5).
- ✅ Step 11: Run §7 in full. Check `git status` (SA-2b-4): exactly one ` D` (`app/admin/exchange-rates/page.tsx`), two `??` (the new test and this workplan) and nine ` M` (the nine modified files in §5, including `ExchangeRatesView.tsx` and the requirement MD). Check with `git diff -U0` that every changed line in `ExchangeRatesView.tsx` is inside a comment. Check `git diff --stat`: no file under `app/api/admin/exchange-rates/`, `lib/admin/exchangeRates/`, `lib/repositories/` or `lib/business-os/finance/`. Check that `git diff -- next.config.js` adds no `console.`. Compare deletions with insertions per file (the truncation hazard).
- ✅ Step 12: Handover: each forced-edit file's diff and the commands' output; Status → Code Complete. No commit (that is RM's).


### 6.1 Implementation notes (Dev, 2026-10-20)

Built uncommitted on `feature/admin-exchange-rates-2b-redirect` at `251472bb`. The page was deleted from the working tree only; `git rm` is RM's.

**SA rulings applied**

| Ruling | Applied as |
|---|---|
| Q-1 (a) | `ExchangeRatesView.tsx` :9-11 and :92 are comment-only edits. `git diff -U0` shows 4 lines changed, every one inside the header block or the `EXCHANGE_RATES_PURPOSE` doc comment |
| Q-1 (b) | `AdminSidebar.nav.test.ts:6` "(except the unlisted ones)"; `redundantPages…:25` "(then the page and its components)"; the G-6 test title is now "walks the folder and its components, never a test (guards the walk itself)" (text only); `exchangeRates.render.test.tsx:4` "in the Exchange rates view" |
| Q-1 (c) | One "Amended by Admin Exchange Rates slice 2b (SQ-22)" paragraph in the `layoutFolder.guard` header |
| Q-1 (d) | `ExchangeRatesRepository.ts` not edited. A follow-up bullet was added to requirement §9 |
| Q-2 | `PATH` left as it is |
| Q-3 | `filter(...).toHaveLength(1)`, `toEqual` on the three fields, and `not.toHaveProperty('has')`. The entry is resolved once in a `beforeAll`, and `prepareDestination` takes `entry.destination` |
| Q-4 | `exchangeRates.render.test.tsx:172` is `expect(screen.queryByRole('heading', { level: 1 })).toBeNull();`, in the same test with the same title |
| Q-5 | Requirement: the §1 row 2b status, the DV-3 row in the §5.3.4 2a table (anchored on the test name, SA-2b-3), the §9 follow-up and a Change History row |
| SA-2b-1, SA-2b-2 | §7.4 rewritten: the `Location` is compared by parameters, and the trailing-slash `curl` is added |
| SA-2b-4 | Step 11 expected status, verified: 1 ` D`, 2 `??`, 9 ` M` |
| Finance guard | The new test contains no `exchange_rates`, `HealthTile` or `STATUS_STYLES` (grep count 0) |

**Deviations**

| # | Deviation | Why |
|---|---|---|
| DV-1 | "`currencies=junk` → the default", and the no-query case, are asserted as `FINANCE_FILTER_SPEC.currencies.parse(get)` **`toBeUndefined()`** plus `FINANCE_FILTER_SPEC.currencies.defaultValue` `toBe(DEFAULT_CURRENCY_SHOW)`. §3.3 had said `parse` returns `DEFAULT_CURRENCY_SHOW` | `textFilter.parse` (`useAdminFilters.ts:261-266`) returns `undefined` for an absent or invalid value, and the URL hook then applies `defaultValue`. This is the same form MK-4 uses for `status` (`status.parse` `toBeUndefined()`), and the same one `financeFilters.test.ts`'s `parseLink` uses. My first draft asserted `toBe('enabled')`, and those two cases failed. The expectation moved, not the code |
| DV-2 | The DV-3 line numbers in the requirement are `it(` at **205** and the edit at **214-215**. SA-2b-3 said 204 / 214 | `grep -n` at `251472bb`: the `it(` is line 205, the comment is 214 and `currencies: undefined` is 215. The row's anchor is the test name, so this is bookkeeping only |
| DV-3 | The test count moved by +2, not by "+ new cases − 1" as §7.1 said | +6 new cases; −1 dropped G-6 test. In the layoutFolder registry, the removed entry carried 14 tests (2 + 6 files × 2) and the Finance entry gains 10 (5 × 2), so −4. The finance `source.guard` F-5 `it.each(ALL)` also scans the new test file, so +1. Net: 4,705 + 6 − 1 − 4 + 1 = **4,707** |

**Results**

| Check | Baseline (Step 0) | After |
|---|---|---|
| Narrow Jest (§7.1) | 94 suites / 4,705 tests passed | **95 suites / 4,707 tests passed** |
| Narrow `tsc` (§7.2, `tsconfig.fx2b.json`) | exit 0, 0 errors | **exit 0, 0 errors** |
| `eslint` on the 9 files (§7.3) | — | **exit 0, 0 findings** |
| `npm run lint:hooks` | — | **exit 0** |
| `git diff --stat` on `app/api/admin/exchange-rates/`, `lib/admin/exchangeRates/`, `lib/repositories/`, `lib/business-os/finance/` | — | empty |
| `console.` added to `next.config.js` | — | 0 |
| Per-file numstat (insertions / deletions) | — | `next.config.js` 10/0; `page.tsx` 0/26 (the delete); `redundantPages` 7/9; `AdminSidebar.nav` 12/8; `layoutFolder.guard` 13/16; `exchangeRates.render` 6/7; `exchangeRatesFilters.render` 2/3; `ExchangeRatesView` 4/4; `chargeChecksRedirect` 3/2; requirement 4/1. No file lost content beyond the ruled lines |

**Mutation check (Step 3).** Each mutation was made to `next.config.js` from a scratch backup and restored byte for byte afterwards (the `git diff --stat` is unchanged at 10/0):

| Mutation | New test result |
|---|---|
| Destination → `/admin/finance?tab=plans` | **6 of 6 failed** (the shape and every parse case) |
| `has: []` added to the entry | **1 failed** (shape: `toEqual` / `not.toHaveProperty('has')`), 5 passed |
| `permanent: true` | **1 failed** (shape), 5 passed |

---

## 7. Tests and commands

### 7.1 Narrow Jest set

This is the 2a set. It covers both redirect tests (`subscriptionsRedirect` and the new one), `chargeChecksRedirect`, the rates suites, `layoutFolder.guard`, `KpiStrip.callers.pin`, `AdminSidebar.nav`, `redundantPages`, R8 and the finance guards:

```bash
npx jest app/admin/finance app/admin/exchange-rates app/admin/components app/admin/__tests__ lib/admin/__tests__ lib/business-os/finance/__tests__ --ci
```

Pass = all suites green. The suite count is the baseline + 1 (the new file). The test count is the baseline + the new cases − 1 (the dropped G-6 test).

### 7.2 Type check (narrow)

A full `tsc` runs out of memory on this machine. Use a scratch config in the session scratchpad, never committed: `tsconfig.fx2b.json`, which `extends` the worktree's `tsconfig.json` by absolute path. Its `include` lists the worktree's `next-env.d.ts`, `types/**/*.d.ts`, `app/admin/finance/**/*.ts(x)`, `app/admin/exchange-rates/**/*.ts(x)`, `app/admin/__tests__/redundantPages.source.guard.test.ts`, `app/admin/components/__tests__/AdminSidebar.nav.test.ts` and `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` (absolute paths).

```bash
npx tsc --noEmit -p "<scratchpad>/tsconfig.fx2b.json"
```

Pass = no new error compared with the Step 0 baseline. In particular, nothing may still import `../page`.

### 7.3 Lint

```bash
npx eslint next.config.js app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts app/admin/finance/__tests__/chargeChecksRedirect.config.test.ts app/admin/__tests__/redundantPages.source.guard.test.ts app/admin/components/__tests__/AdminSidebar.nav.test.ts app/admin/components/layout/__tests__/layoutFolder.guard.test.ts app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx app/admin/exchange-rates/__tests__/exchangeRatesFilters.render.test.tsx app/admin/exchange-rates/components/ExchangeRatesView.tsx
npm run lint:hooks
```

Pass = exit 0 with 0 findings for each command.

### 7.4 Manual check (QA)

Run `npm run dev` on this worktree. Compare the `Location` **parameters**, never the string: Next spreads the incoming query first (`{ ...query, ...destination }`, `prepare-destination.js:225-227` in 14.2.35), so the header reads `…?currencies=all&tab=exchange-rates` (SA-2b-1).

| Request | Expected |
|---|---|
| `curl -sI "http://localhost:3000/admin/exchange-rates?currencies=all"` | `307`; `Location` path `/admin/finance`, parameters `currencies=all` and `tab=exchange-rates` (the header reads `/admin/finance?currencies=all&tab=exchange-rates`) |
| `curl -sI "http://localhost:3000/admin/exchange-rates?tab=accounts"` | `307`; `Location` path `/admin/finance`, parameters `tab=exchange-rates` only |
| `curl -sI "http://localhost:3000/admin/exchange-rates/"` (SA-2b-2) | `308` to `/admin/exchange-rates` (Next's default trailing-slash redirect); following it (`curl -sIL`), a `307` to `/admin/finance?tab=exchange-rates` |
| The destination without an admin session | The admin layout's refusal, as for any `/admin/finance` request |

This is the fallback the `chargeChecksRedirect` header names in case Next's internals move.

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | `prepareDestination` is a Next internal (14.2.35), and an upgrade can move it | Same exposure as MK-4 and M-5, and it fails loudly in the test. The fallback is the shape block plus the §7.4 `curl` |
| R-2 | Semantic conflict at the `origin/main` merge: another PR adds a redirect or an admin page, so "four" or the floors go stale | The merge queue tests the merged tree. After RM merges `origin/main`, Dev re-runs §7.1 and §7.2 before the PR is marked ready. The sidebar floor is `≥`, so a new page does not break it |
| R-3 | A running dev server still serves the deleted page from `.next` | Restart the dev server for §7.4. Only this worktree is touched |
| R-4 | A forced edit drifts beyond the ruled lines | The handover shows each file's diff, and Step 11 compares insertions with deletions per file |
| R-5 | The layoutFolder move breaks a rule for the moved files | It should not. The five files already pass every per-file rule in their current entry (no own h1 since 2a, no direct `.json(`, alias-only into the layout folder). The Finance entry's header-import rule is met by `app/admin/finance/page.tsx`. "Exactly one entry" holds because the old entry is removed |
| R-6 | G-6 goes vacuous without the page | 6 non-test files remain (≥ 5). The 3 `fetch(` sites and the module logger are all in `ExchangeRatesView.tsx`; the page had none |
| R-7 | A bookmark carries a stale `tab` | The destination's `tab` wins (pinned in §3.3). A `307` is not cached, so the change stays reversible |
| R-8 | An outside link with a trailing slash (`/admin/exchange-rates/`) | `trailingSlash` is not set, so Next's default trailing-slash redirect removes the slash first, and then this entry matches. Same as MK-4; QA can confirm it with the §7.4 `curl` |

---

## 9. SA Review Notes

_SA populates this section._

### SA workplan review

**Reviewed by SA — 2026-10-20** (read-only, in worktree `neuronforge-fx-rates-2b` at `251472bb`)
**Status:** ✅ **APPROVED-WITH-CHANGES.** Proceed to implementation and apply SA-2b-1 to SA-2b-4 as you build. None of them needs another workplan pass. Show them in the handover.

#### Against the §13.5 rulings

| Ruling | Workplan | Verdict |
|---|---|---|
| SQ-17 (a) | §3.1 is one entry, `source` / `destination` / `permanent: false`, no `has`, appended after MK-4 with a comment in the MK-4 style. §3.2 deletes `page.tsx`, the folder stays, and it does not touch R8 | ✅ Matches. No `:path*` wildcard, so `/api/admin/exchange-rates` cannot match (and the `/api` prefix differs anyway) |
| SQ-17 new test | §3.3 has the shape block plus a `prepareDestination` block, with every case SQ-17 names. The `tab=accounts&currencies=disabled` case is extra | ✅ The extra case is accepted: it is additive and pins "override `tab`, keep the rest" in one assertion |
| SQ-22 | §3.4: the old entry is removed. The five non-page files are appended to the Finance entry after `FinanceSection.tsx`, with a comment in the Charge checks form. `changedByText.ts` is not added | ✅ Matches. Checked at `layoutFolder.guard.test.ts:515-748`. The per-entry rules are "files exist", "some file imports `AdminPageHeader` by alias" (met by the Finance page/view), "no own `<h1`, no direct `.json(`" and "alias-only into the layout folder". The five files already pass all of these under their current entry. "Exactly one entry per file" (:779) holds because the old entry goes |
| SQ-23 (2b half) | §3.4 covers every item in the ruled list: `chargeChecksRedirect` 4, G-6, the `AdminSidebar.nav` floor / `not.toContain` / `UNLISTED` / two comments, the registry, and the two render suites | ✅ Matches, line for line |

#### Specific checks

| Check | Finding |
|---|---|
| §2.2 reference sweep | ✅ **Complete.** I re-ran it independently: `git grep "exchange-rates"` over `*.ts/*.tsx/*.js/*.json/*.mjs` outside `docs/`, plus `EXCHANGE_PAGE`, `exchange-rates/page`, `ExchangeRatesPage` and `from '../page'`. The only hits are the ones §2.2 lists. The many other `from '../page'` hits are other admin folders' own pages, which are unaffected. The only other occurrences are the `supabase/migrations/__tests__` checker filename and `KpiStrip.callers.pin`'s component import, and both are rightly left alone. I also found no further stale prose in `app/admin/exchange-rates/**` or `app/admin/finance/**`. "The page that owns the h1" in `ExchangeRatesView.tsx:30` is still true of Finance |
| G-6 floor after the delete | ✅ The walk's non-test files after the delete are `exchangeRatesFilters.ts` plus the five in `components/`, so **6 ≥ 5**. All three `fetch(` sites and the `AdminExchangeRates` logger are in `ExchangeRatesView.tsx`, and the page had neither, so the `toBe(3)` count and the logger rule are unchanged and the guard does not go vacuous. `hasHeader` and `read` are still used (G-1, planted controls), so no dead helper is left after `EXCHANGE_PAGE` goes |
| layoutFolder registry move | ✅ See SQ-22 above. Nothing else in the guard references the Exchange rates entry by name |
| `AdminSidebar.nav` floor 29 → 28 | ✅ **Exact.** The one-level scan (`adminPageRoutes`, `/admin` plus every `app/admin/<dir>/page.tsx`) counts **29** today. The only nested page is `finance/charges`, which goes through `NESTED_LISTED`. After the delete it is 28, so the `≥ 28` floor sits at the real count, as MK-4 left it. `allHrefs` stays **28**: the route leaves `onDisk` and `UNLISTED` together, so `expected` is unchanged |
| `chargeChecksRedirect` count | ✅ `next.config.js:71-99` has exactly three entries today (payments, M-5, MK-4), so four after 2b. `git grep "redirects()"` in tests finds only `chargeChecksRedirect` and `subscriptionsRedirect`, so no other count pin exists. `subscriptionsRedirect` filters by its own source and is unaffected |
| Trailing slash | ✅ The reasoning is right. `next.config.js` sets no `trailingSlash`, `basePath` or `i18n`. With the default `trailingSlash: false`, Next's built-in redirect strips the slash (a **308**) before custom redirects run, and then this entry's 307 matches. That 308 is permanent, but its target is the slash-less old URL, which stays redirected, so reverting 2b is still clean. QA adds it to §7.4 (SA-2b-2) |
| `prepareDestination` (Next internal) | ✅ **Acceptable, on the MK-4 / M-5 precedent.** Verified in the installed **14.2.35** (`node_modules/next/dist/shared/lib/router/utils/prepare-destination.js:225-227`): `parsedDestination.query = { ...query, ...parsedDestination.query }`, so the incoming query is kept and the destination's `tab` wins, exactly as SQ-17 claims. The test is the third consumer of the same internal import path. An upgrade breaks all three loudly, together, and the documented fallback (shape block plus `curl`) is already in `chargeChecksRedirect`'s header. No new pattern. Redirects in `next.config.js` run before `middleware.ts` and the admin layout, so the destination's gate still applies to a non-admin |
| Phase / layer | ✅ Routing config plus tests. No DB, route, repository, LLM, entitlements import or money arithmetic, so the skill checklists (`new-api-route`, `new-repository`, `tenant-isolation-guard`, `business-os-entitlements`) do not apply. No `console.*` is introduced. `next.config.js` already logs nothing |
| Finance guards on the new test file | ✅ `source.guard`'s F-5 `walkAll` scans `app/admin/finance/__tests__/` too. The new file must not contain `exchange_rates` (SA-2-6), `components/health/HealthTile` or `STATUS_STYLES`, and §3.3 already commits to the first. `usdCopy.source.guard` skips `__tests__` |

#### Rulings on the Dev's questions

| # | Ruling |
|---|---|
| Q-1 | **Comment-only fixes for comments that go stale, as proposed for (a), (b) and (c).** (a) `ExchangeRatesView.tsx:9-11` and `:91-92`: comments only, no code token changes. (b) The stale comments in the forced-edit files (`AdminSidebar.nav.test.ts:6`, `redundantPages…:24`, `exchangeRates.render.test.tsx:4`). The G-6 test title at `redundantPages…:212` is renamed as well: the `toContain(EXCHANGE_PAGE)` line it describes is deleted in that same test, so the title would otherwise be false. That is text only. (c) One "Amended by Admin Exchange Rates slice 2b" paragraph in the `layoutFolder.guard` header, in the established amend-log form. **(d) The repositories folder stays out of it:** `lib/repositories/ExchangeRatesRepository.ts:3` is not edited (§8 forbids any `lib/repositories/` file in the diff). Record it as a follow-up in §3.5's requirement bookkeeping, not in code |
| Q-2 | **Leave `PATH = '/admin/exchange-rates'` as it is.** It sets the jsdom address only, and no assertion reads the pathname. SQ-23 says nothing else in that file changes. G-4 skips `__tests__`, so it is not a guard hit |
| Q-3 | **Accepted.** Keep `toEqual` for the three fields and add `expect(entry).not.toHaveProperty('has')`. The `prepareDestination` block takes `destination` from the config entry, not a literal. Note that the config read is async (`await config.redirects()`), so resolve the entry once in a `beforeAll` (or make the helper async) rather than calling it per case. Keep the existing `filter(...).toHaveLength(1)` "exactly one entry" check in the shape block |
| Q-4 | **Accepted.** `exchangeRates.render.test.tsx:173` becomes `expect(screen.queryByRole('heading', { level: 1 })).toBeNull();`, in the same test with the same title. The one-h1 "Finance" pin already lives in `exchangeRatesTab.render.test.tsx` (2a) |
| Q-5 | **Dev writes both, in this branch, as doc-only edits:** the DV-3 row in §5.3.4's 2a forced-edit table, the §1 row 2b status/workplan link at each stage, and a requirement Change History row, along with the Q-1 (d) follow-up line. The BA confirms the wording at the next requirement pass. RM resolves any conflict with the requirement on `origin/main` at the post-#486 merge, before the PR opens |

#### Required changes (apply during the build)

1. **SA-2b-1 (§7.4, query order).** The `curl` expectation `Location: /admin/finance?tab=exchange-rates&currencies=all` is wrong in its order. The merge spreads the incoming query **first** (`{ ...query, ...dest }`), so the real header is `…?currencies=all&tab=exchange-rates`. QA compares the **parameters**, not the string. The Jest cases are unaffected because they already compare parsed objects with `toEqual`.
2. **SA-2b-2 (§7.4, trailing slash).** Add `curl -sI "http://localhost:3000/admin/exchange-rates/"`. Expect a 308 to `/admin/exchange-rates`, then (following it) a 307 to the tab. This closes R-8 with evidence.
3. **SA-2b-3 (§3.5, DV-3 citation).** Cite the lines as they stand on the branch at build time. At `251472bb` the `it(` is at `financeFilters.test.ts:204` and the `currencies: undefined` line is at `:214`. The 2a workplan said 206-214, and this workplan says 206-216. The row describes the edit, so use the test name as the anchor, with the line numbers as secondary.
4. **SA-2b-4 (Step 11, expected status).** The expected `git status` is: ` D app/admin/exchange-rates/page.tsx`, `??` for the new test and this workplan, and ` M` for exactly the nine files in §5 (including `ExchangeRatesView.tsx`, comments only, and the requirement MD). For `ExchangeRatesView.tsx`, also confirm with `git diff -U0` that every changed line is inside a comment.

#### Optimisation suggestions (non-blocking)

- None needed for G-6. With the page-path self-check gone, the remaining `components/` prefix check, the `≥ 5` floor and the exact `fetch(` count of 3 still guard the walk. Do not add a replacement assertion: SQ-23 says nothing else in the file changes.

#### Approval

[x] Workplan approved — proceed to implementation, with SA-2b-1 to SA-2b-4 applied. The PR opens only after RM merges `origin/main` following #486 and Dev re-runs §7.1 and §7.2 (R-2).

### SA code review

**Code Review by SA — 2026-10-20** (read-only, worktree `neuronforge-fx-rates-2b`, branch `feature/admin-exchange-rates-2b-redirect` at `251472bb`, uncommitted)
**Status:** ✅ **Code Approved.** No fix required. One low-priority comment correction is optional: it can go in before RM commits, or be skipped (CR-1).

#### Scope and status checks

| Check | Finding |
|---|---|
| `git status` (SA-2b-4) | ✅ Exactly 1 ` D` (`app/admin/exchange-rates/page.tsx`), 2 `??` (`exchangeRatesRedirect.config.test.ts`, this workplan), 9 ` M` (`redundantPages`, `AdminSidebar.nav`, `layoutFolder.guard`, the two rates render suites, `ExchangeRatesView.tsx`, `chargeChecksRedirect`, the requirement MD, `next.config.js`). Nothing else |
| Forbidden paths | ✅ `git diff --stat` names no file under `app/api/`, `lib/admin/exchangeRates/`, `lib/repositories/` or `lib/business-os/finance/` |
| `ExchangeRatesView.tsx` | ✅ Comments only. `git diff -U0` shows 4 removed and 4 added lines, all inside the file header block or the `EXCHANGE_RATES_PURPOSE` JSDoc. No code token changed, so `KpiStrip.callers.pin` and the finance pins are unaffected |
| `next.config.js` vs MK-4 / SQ-17 (a) | ✅ One entry appended after MK-4: `source: '/admin/exchange-rates'`, `destination: '/admin/finance?tab=exchange-rates'`, `permanent: false`, no `has`, no wildcard. Its five-line comment is in the MK-4 style ("Temporary for the same reason as above", query kept, destination `tab` wins). No `console.` added. Nothing else in the file changed (10/0) |
| Page deleted | ✅ Deleted from the working tree only (`git rm` is RM's). The folder keeps `exchangeRatesFilters.ts`, `components/` (5 files incl. `changedByText.ts`) and `__tests__/`. Without `page.tsx` it is not a route, so R8 has one render entry point fewer and no exemption (cap 0, green) |

#### Guards: nothing weakened beyond the ruled edits

| Guard | Diff | Verdict |
|---|---|---|
| `redundantPages` G-6 | `EXCHANGE_PAGE` removed; `toContain(EXCHANGE_PAGE)` removed; the "REDUNDANT header is gone from the page" test removed; title text renamed (Q-1 (b)); one "Amended by … 2b" header paragraph. The `components/` prefix check, the no-`__tests__` check, the `≥ 5` floor, the exact `fetch(` count of 3, the Supabase / `.from(` / `CurrencyService` / host / `console.` rules and the module-logger rule are all unchanged. G-4, `PAGE_ROUTES`, G-2 and the planted controls are unedited | ✅ Exactly SQ-23. **G-6 floor holds:** the walk now finds 6 non-test files (`exchangeRatesFilters.ts` + 5 in `components/`), so ≥ 5 holds. All 3 `fetch(` sites and the `AdminExchangeRates` logger are in `ExchangeRatesView.tsx`, so the guard is not vacuous |
| `AdminSidebar.nav` | Floor `29 → 28` with a comment line; `toContain` → `not.toContain('/admin/exchange-rates')`; `UNLISTED` loses the route; the `UNLISTED` comment and header item 10 rewritten; header item 2 reworded (Q-1 (b)). `allHrefs` 28 and the "never names `exchange-rates`" check unchanged | ✅ Exactly SQ-23. The floor sits at the real one-level count, as MK-4 left it |
| `layoutFolder.guard` C-14 registry | Old entry removed (6 files incl. `page.tsx`); the five non-page files appended to the Finance entry after `FinanceSection.tsx` with the SQ-22 comment; `changedByText.ts` not added; one "Amended by … 2b (SQ-22)" header paragraph. No rule, regex or shared source changed | ✅ Exactly SQ-22. "Exactly one entry per file" holds |
| `chargeChecksRedirect` | `toHaveLength(3)` → `4`, test name and one comment line; the payments `toContainEqual` kept | ✅ Exactly SQ-23 |
| The two rates render suites | `../page` imports removed; renders of `<ExchangeRatesPage />` → `<ExchangeRatesView />` (3 + 2); the h1 assertion → `queryByRole('heading', { level: 1 })` is null, same test and title (Q-4); `exchangeRates.render` header wording (Q-1 (b)); `PATH` left (Q-2) | ✅ Exactly SQ-23 + Q-4. The no-h1 assertion is stronger than "not the old h1", and the one-h1 "Finance" pin lives in `exchangeRatesTab.render` (2a) |
| Finance guards on the new file | No `exchange_rates`, `HealthTile` or `STATUS_STYLES` in it (grep 0). F-5's `walkAll` scans it and passes (the +1 in DV-3) | ✅ SA-2-6 met |

#### New test `exchangeRatesRedirect.config.test.ts`

✅ It follows the `subscriptionsRedirect` shape. The shape block has `filter(...).toHaveLength(1)`, `toEqual` on the three fields and `not.toHaveProperty('has')` (Q-3). The entry is resolved once in a `beforeAll` (Q-3 note). The `prepareDestination` block takes `entry.destination` from the config, never a literal, and compares parsed query objects with `toEqual`, never a string. It covers every SQ-17 case, plus the accepted `tab=accounts&currencies=disabled` case. Dev's mutation check (destination → `?tab=plans`: 6/6 fail; `has: []`: 1 fail; `permanent: true`: 1 fail) shows the test catches a change to each field it claims to pin.

#### Rulings on DV-1 to DV-3 (§6.1)

| # | Ruling |
|---|---|
| DV-1 | **Accepted.** The inaccurate part was the workplan's §3.3 wording ("`currencies.parse(get)` is `DEFAULT_CURRENCY_SHOW`"), not the code. `textFilter.parse` returns `undefined` for an absent or invalid value, and `useAdminFilters` then applies `defaultValue`. Asserting `parse` → `toBeUndefined()` **and** `defaultValue` → `DEFAULT_CURRENCY_SHOW` pins both halves of "reads the default", in the MK-4 `status` form. SQ-17's "`currencies=junk` → the field reads the default" is met. The expectation moved; no product code moved |
| DV-2 | **Accepted, bookkeeping only.** The requirement row is anchored on the test name (SA-2b-3), and the line numbers Dev cites (205, 214-215) are the ones `grep -n` gives at `251472bb`. My 204 / 214 was off by one |
| DV-3 | **Accepted.** The arithmetic reconciles: +6 new cases, −1 dropped G-6 test, −4 net in the layoutFolder registry (−14 for the removed 6-file entry, +10 for the 5 moved files), +1 for F-5 scanning the new file. That takes 4,705 to 4,707. My independent run of §7.1 gives **95 suites / 4,707 tests**, which matches. The §7.1 "baseline + new − 1" formula was mine to get right: it ignored the per-file registry tests |

#### Live evidence (TL, dev server on this worktree, port 3015)

| Request | Observed | Verdict |
|---|---|---|
| `/admin/exchange-rates?currencies=all` | 307 → `/admin/finance?currencies=all&tab=exchange-rates` | ✅ Incoming query first, as SA-2b-1 predicted; parameters correct |
| `/admin/exchange-rates/` | 308 → `/admin/exchange-rates` | ✅ SA-2b-2 / R-8 closed: Next's default trailing-slash strip, then the 307 above applies |
| `/admin/exchange-rates?tab=accounts&currencies=disabled` | 307 → `/admin/finance?tab=exchange-rates&currencies=disabled` | ✅ The destination's `tab` wins and the rest is kept (the key order follows the incoming keys, as the spread gives) |
| `/api/admin/exchange-rates` | 401, unchanged | ✅ The redirect does not match the API path, and the API's auth is untouched |

#### Code review comments

1. **CR-1: `app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts:18`.** The comment "Relative on purpose: the alias path would spell the page route that the G-4 guard (redundantPages) refuses (DV-1, SQ-18)" is copied from `financeFilters.ts:50`, and it is not true of this file. G-4 skips `__tests__` (`SKIP_DIRS`, `redundantPages…:69`). Also, "DV-1" here refers to the 2a workplan's DV-1, while this workplan's DV-1 is about something else. The relative import itself is fine and matches `financeFilters.test.ts:322-323` ("Relative, as the finance files import it (SQ-18)"). Suggested wording: `// Relative, as the finance files import it (SQ-18).` Priority: **Low** (comment accuracy only; not blocking).
2. **CR-2: `app/admin/__tests__/redundantPages.source.guard.test.ts:25`.** "(then the page and its components)" reads awkwardly inside the historical slice-1a paragraph, but it is accurate: the paragraph describes the 1a state, and the new 2b paragraph records the change. No action. Priority: **Low**.
3. **CR-3: test run note.** In my full §7.1 run (218 s, under load), one test in `app/admin/__tests__/jobsQueues.items.render.test.tsx` timed out. That suite is not in this diff and does not touch the redirect, the rates folder or the registry. Re-run alone, it passes **25/25**. This is a load-dependent timing flake, not a 2b regression. QA should re-run §7.1 once and treat a repeat as a separate finding. Priority: **Low**.

#### Standards

No touched file has a `console.*` call: `next.config.js` logs nothing, and the Pino rule covers product code, not test files. This slice has no API route, repository, Supabase call, LLM call or entitlements import, so `new-api-route`, `new-repository`, `tenant-isolation-guard`, `bos-llm-call-standards` and `business-os-entitlements` do not apply. No new pattern: the redirect is the third use of the MK-4 / M-5 mechanism and of the `prepareDestination` import. No dead code: `EXCHANGE_PAGE` is gone, and G-1 and the planted controls still use `hasHeader` and `read`. The requirement edits (§1 row 2b, the DV-3 row, the §9 follow-up, Change History) match Q-5 and only add lines (4/1; the 1 is the replaced row-2b status cell).

#### Optimisation suggestions

- None.

#### Code Approved for QA: **Yes**

The conditions from the workplan review still apply. RM merges `origin/main` after #486 lands. Dev then re-runs §7.1 and §7.2 on the merged tree (R-2: "four redirects" and the floor of 28 are the counts that can go stale). Only then does the PR open.

---

## 10. QA Testing Report

_QA populates this section._

### QA report

**QA — 2026-10-20** (worktree `neuronforge-fx-rates-2b`, uncommitted; no product code changed, no test added)
**Test mode:** full
**Strategy used:** A (Jest config, guard and render suites) + live `curl` against the worktree's running dev server on `:3015` (the §7.4 manual check)
**Focus:** routing config, guards, security (the destination's admin gate)
**Skipped:** browser click-through (no UI changed; the destination tab is 2a's, already QA'd)
**Input source:** TL prompt + workplan §7

#### Test coverage (§8 slice 2b)

| Acceptance criterion | Tested? | Result | Evidence |
|---|---|---|---|
| Exactly one redirect for `/admin/exchange-rates`, destination `/admin/finance?tab=exchange-rates`, `permanent: false`, no `has`; `page.tsx` deleted | ✅ | Pass | `exchangeRatesRedirect.config.test.ts` shape block (`toHaveLength(1)`, `toEqual`, `not.toHaveProperty('has')`); `git diff -- next.config.js` is the single 10-line entry; `git status` ` D app/admin/exchange-rates/page.tsx`; live: 307 (temporary) |
| New test passes: no query, `currencies=all`, incoming `tab=accounts`, `currencies=junk` | ✅ | Pass | 6/6 cases green; plus the extra `tab=accounts&currencies=disabled` case. Live `curl` agrees: `?currencies=all` → `/admin/finance?currencies=all&tab=exchange-rates`; `?tab=accounts` → `?tab=exchange-rates`; `?tab=accounts&currencies=disabled` → `?tab=exchange-rates&currencies=disabled`; `?currencies=junk` → `?currencies=junk&tab=exchange-rates` (parameters compared, SA-2b-1) |
| Non-admin following the old URL is still refused by the admin layout; R8 green, cap 0 | ✅ | Pass | Unauthenticated `GET /admin/finance?tab=exchange-rates` returns 200 whose body is the layout's refusal only: `NEXT_REDIRECT;replace;/business-os;307` + `meta refresh` to `/business-os`, and no "Exchange rates" text (0 hits). R8: "scan sees every render entry point on disk", "0 PARKED", "0 PERMANENT", "genuinely zero" all green. R8's list is derived from disk (no hand-kept page list), so it tracks the delete automatically |
| Existing tests amended only per §5.3.4 2b list; `allHrefs` 28; G-4 unedited | ✅ | Pass | `git diff -U0` read for `redundantPages`, `AdminSidebar.nav`, `chargeChecksRedirect`, `layoutFolder.guard`, both render suites: only the ruled lines plus the SA-ruled Q-1 comment/title text. G-4 and `PAGE_ROUTES` hunks: none. `allHrefs` line untouched |
| `git diff --stat` shows nothing under `app/api/admin/exchange-rates/`, `lib/admin/exchangeRates/`, `lib/repositories/`, `lib/business-os/finance/`; no `console.*` in `next.config.js` | ✅ | Pass | Scoped `git diff --stat` is empty; the `next.config.js` diff has no `console.` |

#### Live checks (dev server `:3015`, not restarted)

| Request | Result |
|---|---|
| `/admin/exchange-rates` | 307 → `/admin/finance?tab=exchange-rates` |
| `/admin/exchange-rates?currencies=all` | 307 → `/admin/finance?currencies=all&tab=exchange-rates` |
| `/admin/exchange-rates/` | 308 → `/admin/exchange-rates`; followed (`-L`): 307 → `/admin/finance?tab=exchange-rates` → 200 (SA-2b-2, R-8 closed) |
| `/admin/exchange-rates?tab=accounts&currencies=disabled` | 307 → `/admin/finance?tab=exchange-rates&currencies=disabled` |
| `/admin/exchange-rates?tab=accounts` | 307 → `/admin/finance?tab=exchange-rates` |
| `/admin/exchange-rates?currencies=junk` | 307 → `/admin/finance?currencies=junk&tab=exchange-rates` |
| `/admin/exchange-rates/foo` | 404 (no wildcard, as designed) |
| `/admin/finance?tab=exchange-rates` (no session) | 200, not redirected by config; body is the layout refusal (streamed `NEXT_REDIRECT` to `/business-os`) |
| `/api/admin/exchange-rates` (no session) | 401 (not matched by the redirect) |

#### Test outputs

| Run | Result |
|---|---|
| §7.1 narrow set, `--ci` | 95 suites / 4,707 tests: **4,706 passed, 1 failed**. The failure is `app/admin/__tests__/jobsQueues.items.render.test.tsx` "a refresh (a new refreshKey) resets the open list to page 1" (frame at the `it(` line, a timeout under load with the dev server running). The file is untouched by 2b and never names exchange rates; re-run alone with `--ci`: **25/25 passed**. Same flake the SA saw (CR-3). Matches Dev's 95 / 4,707 |
| CI-parity guards, `--ci` (redundantPages, AdminSidebar.nav, layoutFolder.guard, chargeChecksRedirect, subscriptionsRedirect, exchangeRatesRedirect, finance `source.guard` + `usdCopy.source.guard`, financeTiles pin, financeRequest pin, KpiStrip.callers pin, admin-authz-surface) | **12 suites / 935 tests passed**. Finance `source.guard` scans the new file: "exchangeRatesRedirect.config.test.ts: names neither Health's tile file nor its STATUS_STYLES (AC-179)" green; `exchange_rates` / `HealthTile` / `STATUS_STYLES` grep count in the new file is 0 |
| `git status --short` | exactly 1 ` D`, 2 `??`, 9 ` M` (SA-2b-4) |

#### Issues found

- **Bugs:** none.
- **Performance:** none.
- **Edge cases / notes:** (1) `jobsQueues.items.render` timeout under parallel load is a pre-existing flake, unrelated to 2b. (2) The `currencies=junk` case does not re-assert `tab.parse` (the other four do); not a gap against §8, which only asks for the default, so no case was added.

#### Final status

- [x] All acceptance criteria pass — ready for commit (after RM's `origin/main` merge post-#486 and the R-2 re-run)
- [ ] Issues found — Dev must address before commit

**Verdict: PASS-WITH-NOTES** (the one note is the unrelated `jobsQueues` load flake).

---

## 11. Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-20 | Created | Dev: slice 2b workplan. Scope quoted verbatim with `sed` (§1) from the requirement at `251472bb`. Branch `feature/admin-exchange-rates-2b-redirect`, starting at the 2a tip (`251472bb`, PR #486 in the merge queue); `origin/main` is merged in after #486 lands. Reference sweep in §2.2. Five SA questions: Q-1 stale comments outside the SQ-23 list, Q-2 the jsdom `PATH`, Q-3 a strict "no `has`" check and the destination read from config, Q-4 the h1 line, Q-5 DV-3 bookkeeping. Awaiting SA workplan review |
| 2026-10-20 | SA workplan review | SA: **APPROVED-WITH-CHANGES** (§9 "SA workplan review"). SQ-17 (a), SQ-22 and the SQ-23 2b half all match. Verified at `251472bb`: the reference sweep is complete, the G-6 floor is 6 ≥ 5 with the `fetch(` count 3 unchanged, the one-level sidebar scan goes 29 → 28 exactly with `allHrefs` staying 28, the redirects go 3 → 4 with no other count pin, and `prepareDestination` in 14.2.35 merges `{ ...query, ...dest }` (acceptable, the MK-4 / M-5 precedent). Q-1 comments only, with `lib/repositories/` left out and recorded as a follow-up. Q-2 `PATH` unchanged. Q-3 `not.toHaveProperty('has')`, destination read from config. Q-4 `queryByRole` → null. Q-5 Dev writes DV-3 and §1 in this branch. Required: SA-2b-1 (`curl` query order: incoming first), SA-2b-2 (trailing-slash `curl`), SA-2b-3 (cite DV-3 lines as built), SA-2b-4 (exact expected `git status`) |
| 2026-10-20 | Implemented | Dev: slice 2b built uncommitted at `251472bb` per §6 (Q-1 to Q-5, SA-2b-1 to SA-2b-4). `next.config.js` gains the redirect; `page.tsx` is deleted from the working tree; there is a new `exchangeRatesRedirect.config.test.ts` (6 cases); the forced edits and comment-only fixes are in; the requirement has the DV-3 row, the §1 status, the §9 follow-up and Change History. Deviations DV-1 to DV-3 (§6.1). Mutation check: 6/6, 1 and 1 failures, then restored. Narrow Jest 95 suites / 4,707 tests passed (baseline 94 / 4,705); narrow `tsc` 0 errors; `eslint` and `lint:hooks` clean. Awaiting SA code review and QA |
| 2026-10-20 | SA code review | SA: **Code Approved** (§9 "SA code review"). `git status` is exactly 1 D / 2 ?? / 9 M. No file under `app/api/`, `lib/admin/exchangeRates/`, `lib/repositories/` or `lib/business-os/finance/`. `ExchangeRatesView.tsx` changes are comments only. The `next.config.js` entry matches MK-4 / SQ-17 (a). Every guard edit is exactly the SQ-22 / SQ-23 list, and the G-6 floor holds (6 ≥ 5, `fetch(` 3). DV-1 to DV-3 accepted. Independent §7.1 run: 95 suites / 4,707 tests, with one timeout in the untouched `jobsQueues.items.render` suite, which passes 25/25 alone (load flake, CR-3). TL's live evidence (307 with the query kept and `tab` winning, trailing-slash 308, API 401) closes SA-2b-1 / SA-2b-2. One optional Low comment fix in the new test (CR-1). Code approved for QA |
| 2026-10-20 | QA | QA: **PASS-WITH-NOTES** (§10 "QA report"). Every §8 slice 2b criterion maps to a test or live evidence; no gaps, no test added. §7.1 `--ci`: 95 suites / 4,707 tests, 4,706 passed, 1 failed (`jobsQueues.items.render` load timeout, untouched file, 25/25 alone). CI-parity guards 12 suites / 935 tests passed, incl. R8 (cap 0, list derived from disk) and the finance `source.guard` scan of the new test. Live on `:3015`: 307s with the query kept and `tab` winning, trailing slash 308 → 307, `/admin/exchange-rates/foo` 404, unauthenticated destination streams the layout refusal to `/business-os`, API 401. `git status` 1 D / 2 ?? / 9 M. No bugs |
