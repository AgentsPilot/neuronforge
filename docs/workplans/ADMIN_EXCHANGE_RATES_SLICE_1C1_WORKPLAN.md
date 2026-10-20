# Workplan: Admin exchange rates, slice 1c.1 (history cap, names, KPIs)

> **Last Updated**: 2026-10-19

**Developer:** Dev
**Requirement:** [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md) §1 (1c row), §3.3, §5.5.3 to §5.5.5, FR-18 to FR-22, §8 slice 1c.1, §13.4
**Branch:** `feature/admin-exchange-rates-1c` (worktree `neuronforge-fx-rates-1c`, cut from `origin/main` `a9551d9c`, which includes #477 and #479)
**Date:** 2026-10-19
**Status:** Code Complete (uncommitted, awaiting SA code review). SA workplan review APPROVED-WITH-CHANGES (§9); Q-1 to Q-3 and W-1 to W-6 applied

## Overview

Slice 1c.1 makes four changes to the admin Exchange rates page and its `GET` route, all from the user's 2026-10-19 page review (D-7): the history list is capped at the newest **10** rate changes; a currency's own History button reads that currency's newest 10 from the route (`GET ?currency=XXX`, SQ-12) instead of filtering the overall list in the browser; the route turns each editor's id into a display label (name, else admin email, else "Unknown user"), all-or-nothing on failure (SQ-13); and the KPI strip becomes two tiles, "Enabled currencies" (N of X) and "Last rate change", with the Stale tile removed and the per-row Stale chip kept. The `KpiStrip` caller pin is re-pinned for the Exchange rates cases only (SQ-15), and the page guard's fetch count goes from 2 to 3. No migration, no new table, column, write path or dependency; the `PATCH` route and its audit entries are untouched. The filter bar (1c.2), flags (dropped by the user) and the Finance tab (slice 2) are out of scope.

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

Copied from the requirement with `sed` (line ranges of the working copy at `a9551d9c` + the uncommitted 1c edits), not retyped. Where this workplan and a quote differ, the quote wins.

### 1.1 §1 Progress, slice 1c row

> | 1c | Page refinements from the user's 2026-10-19 page review (D-7): filter bar (Enabled only by default), newest 10 changes, admin name instead of the id, new KPIs (Enabled currencies, Last rate change; Stale tile removed). ~~Country flag column~~ dropped by the user (§3.3 comment 3) | 🟡 SA cleared with changes (§13.4); 1c.1 next | — | **Build before slice 2.** Two small slices (§5.5.7): **1c.1** history cap + names + KPIs (route and page; full cycle, the route starts reading people's names), then **1c.2** filter bar only (page only; short path). No migration, no prod step. Comment 1 of the review is resolved by slice 2 (no Settings link) |

### 1.2 §3.3 User page review, 2026-10-19 (D-7)

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

### 1.3 §5.5 Slice 1c, the 1c.1 parts (history cap, names, KPIs)

> #### 5.5.3 History capped at 10 (comment 4)
>
> - Today `HISTORY_LIMIT = 50` in `lib/admin/exchangeRates/exchangeRateRules.ts`. It is the one source: `ExchangeRatesRepository` re-exports it as `EXCHANGE_RATE_HISTORY_LIMIT` and uses it in `.limit(...)`. Change it to **10**. It stays fixed and never comes from the caller. The comments that say "50" are updated: route header, view header, `RateHistoryTable` header, repository.
> - **Effect on the per-row History button.** Today it filters the loaded rows in the browser ("ILS: 2 of the newest 50"). With 10 rows, most currencies would show nothing. The options for SA (SQ-12):
>   - (a) Keep filtering in the browser over the 10. Simplest, but the view is nearly always empty. BA is against it.
>   - (b) **BA suggestion:** the `GET` takes an optional `?currency=XXX` (validated with the existing `currencyCodeSchema`) and returns that currency's newest 10. The overall list (and the Last change tile) still come from the plain read.
>   - (c) Remove the per-row History button.
>
> #### 5.5.4 Admin name instead of the id (comment 5)
>
> - **Today** `RateHistoryTable` shows `formatShortId(row.changedBy)`, with the full uuid as the hover text.
> - **Change:** the `GET` route turns each distinct `changed_by` in the history rows it returns into a display label, **on the server**, in this order:
>   1. **The person's name**, from `profiles.full_name` (trimmed, non-empty), through `userProfileRepository.findAdminNamesByIds(ids)`. This is the Audit trail route's pattern (`app/api/admin/audit-trail/route.ts`, the user-names block; ADMIN_BOS_CLEANUP slice 4).
>   2. **Otherwise the admin's email**, through `adminUserRepository.findEmailsByUserIds(ids)`. This is the AI model price history pattern (`app/api/admin/model-pricing/history/route.ts`, slice 9, SA SC9-1). It deliberately includes deactivated admins, because history is a permanent record and a former admin should still be named. The archiving route's `adminLabels` uses `listActive()`, which drops former admins, so it is not the pattern here.
>   3. **Otherwise "Unknown user"**, which also covers a null `changed_by` (older rows may have one).
> - **Lookup failure ≠ no name.** The Audit trail posture: log the failure, still answer 200 with rates and history, leave the labels out, and say so in the body (for example `nameLookup: 'failed'`). The page then shows the short id as today, never "Unknown user" (SQ-13).
> - **Wire:** add `changedByLabel: string | null` to `ExchangeRateHistoryWire` (null only when the lookup failed). Whether `changedBy` (the uuid) stays as hover text is part of SQ-13; BA suggests it stays, for tracing.
> - **Cost:** at most 10 distinct ids, so one `.in()` read per table, run after the history read.
> - **Guards:** `lib/repositories/__tests__/adminReadMethods.guard.test.ts` already lets anything under `app/api/admin/**` call both methods, so the guard needs no edit. But both methods' header comments name their "only caller", so they must be updated to add this route.
> - **Privacy.** This is fine because the page is admin-only (`requireAdminPage`) and so is the route (`requireAdmin`). The ids come from the history rows the route itself read, never from the request. The response adds only a display label for the admins who made the changes: no other profile field and no other user's data. Logs carry counts only, never a name or an email (both repository methods already behave that way). D-3 is unchanged: no business ever sees this.
>
> #### 5.5.5 KPIs (comment 6)
>
> The KPIs stay in `app/admin/exchange-rates/components/ExchangeRatesKpis.tsx`, on the existing `KpiStrip` / `KpiTile`. Two tiles, in this order:
>
> | Tile | Spec |
> |---|---|
> | **Enabled currencies** | "N of X": N = rows with `isEnabled === true` (a database null reads as false), X = all rows. Counts the **whole payload**, not the filtered view (§5.5.1). **USD is counted** (it is a real, enabled currency; the old Stale tile excluded it only because its age could never clear). No status colour |
> | **Last rate change** | From the newest history row (the route's order, newest `changed_at` first). Value: "ILS 3.65 → 3.70" (stored strings, shown as stored); old rate null → "ILS set to 3.70". Sub line: "by {label}, {formatUtc(changedAt)}"; the short id when the name lookup failed. No history → "No changes yet" |
>
> - **Do on / off switches count as the "last action"?** No, not from this source. The history table records **rate changes only**: the trigger fires on `rate_to_usd` (§2.1 (b)), and switches are recorded only in the audit trail (`EXCHANGE_RATE_ENABLED_CHANGED`). **BA recommends rate changes only, from history**, with the tile named "Last rate change" so it does not claim more than it shows. Adding switches would need an audit-trail read in the `GET` (SQ-14).
> - **The Stale tile is removed.** The per-row "Stale" `StatusChip` stays, unchanged (FR-8: 35 days, measured against `readAt`; USD is never stale, through `isRateStale`). The FR-8 clause about showing a count of stale rates is withdrawn by D-7.
> - **Pin test:** `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` gets **additive cases only** for the new states: two tiles, no history, name lookup failed, old rate null. But it already pins three `ExchangeRatesKpis` cases (`A2 ExchangeRatesKpis loading`, `A2 ExchangeRatesKpis`, `A2 ExchangeRatesKpis none stale`), and replacing the tiles **necessarily changes those three hashes**. That is a named, forced change limited to the Exchange rates cases; every other caller's hash stays unchanged (SQ-15).
>
> *(From §5.5.6 Unchanged by 1c, the one bullet that binds 1c.1:)*
>
> - The SA-R3 Exchange rates page guard still allows only `fetch(` targets under `/api/admin/exchange-rates`. A `?currency=` read (SQ-12 (b)) stays on that path; Dev confirms the guard's matcher accepts a query string.

### 1.4 §6 Functional requirements for 1c.1

> | # | Requirement | Slice |
> |---|---|---|
> | FR-18 | The history list shows the newest **10** rate changes (fixed, never caller-supplied); the per-currency view follows SQ-12 | 1c.1 |
> | FR-19 | "Changed by" shows the admin's name, else their admin email, else "Unknown user", resolved on the server; a failed lookup shows the short id, not "Unknown user" (§5.5.4) | 1c.1 |
> | FR-20 | KPI "Enabled currencies": N of X, over all currencies, USD included | 1c.1 |
> | FR-21 | KPI "Last rate change": the newest history row as "CODE A → B", with who and when; "No changes yet" when there is none. On / off switches are not counted (SQ-14) | 1c.1 |
> | FR-22 | No Stale KPI tile. The per-row Stale status of FR-8 stays unchanged | 1c.1 |

*(FR-22 points at FR-8, which stays as amended:)*

> | # | Requirement | Slice |
> |---|---|---|
> | FR-8 | Each row shows its age. A rate older than 35 days shows a clear "Stale" status (text, not colour alone). The header or KPI area shows how many enabled rates are stale (**count withdrawn by D-7 in 1c; the row status stays**, FR-22) | 1a |

### 1.5 §8 Acceptance criteria, slice 1c.1

> **1c.1 — history, names, KPIs**
>
> - [ ] The history list shows at most 10 rows, newest first; a route test pins the limit (a constant, never read from the request).
> - [ ] The per-currency History view behaves per the SQ-12 ruling: `GET ?currency=XXX` returns that currency's newest 10 in its own payload type.
> - [ ] SQ-12 query checks (route tests): an unknown query key, a repeated `currency` or a badly shaped code → **400**, nothing read; a valid code with no row → **404**.
> - [ ] "Changed by" shows the name; with no name, the admin email (a deactivated admin included); with neither, "Unknown user". One route test per case.
> - [ ] A history row with a null `changedBy` shows "Unknown user", whether the lookup succeeded or failed (nothing was looked up for it).
> - [ ] If the name lookup fails, the `GET` still answers 200 with rates and history, the page shows the short id, and the failure is logged. No log line holds a name or an email.
> - [ ] The name lookup is all-or-nothing: **any** failure (returned or thrown, either source) gives 200 with `nameLookup: 'failed'` and **every** `changedByLabel` null; never a half-resolved list.
> - [ ] The response adds only the display label: no other profile field, and no id taken from the request.
> - [ ] The KPI strip has exactly two tiles: "Enabled currencies" (N of X, all currencies, USD counted) and "Last rate change" (CODE A → B, who, when), or "No changes yet".
> - [ ] There is no Stale tile; every rate older than 35 days still shows the Stale chip on its row; USD never does.
> - [ ] `KpiStrip.callers.pin`: every non-Exchange-rates hash unchanged; the Exchange rates cases follow the SQ-15 ruling; the new cases are appended.
> - [ ] Nothing does arithmetic on a rate (no difference, no percentage, no total): D-5.

### 1.6 §13.4 SA review — slice 1c (all of it)

> ### 13.4 SA review — slice 1c
>
> **Reviewed by SA — 2026-10-19** (requirement review of §3.3, §5.5, FR-14 to FR-22, §8 slice 1c, the §12 1c rows, SQ-8 to SQ-16, BQ-1). Code read from `origin/main` `0581637a` (this worktree's base); `node_modules` facts read from the main checkout.
> **Verdict: CLEARED-WITH-CHANGES.** The slice is proportionate, adds no table, migration or write path, and reuses the shared filter bar, the URL hook, `KpiStrip` and two existing admin read methods. One BA proposal must change before the workplan: **SQ-8's key `show` is already owned by the Finance page** (the Accounts tab), not only `status` (SA-1c-1). User decisions D-7 (Finance tab only, no Settings link; per-row Stale chip kept, Stale KPI dropped; Enabled only by default; Country column next to Symbol; history capped at 10; names instead of ids; KPIs = Enabled N of X + Last change) are **not reopened**.
>
> **Verified as stated:**
>
> | Claim | Result |
> |---|---|
> | `userProfileRepository.findAdminNamesByIds(userIds: readonly string[])` | ✅ `lib/repositories/UserProfileRepository.ts:446`. Returns `RepositoryResult<AdminProfileName[]>` = `{ id, full_name }[]` (columns `id, full_name` only); de-duplicated, chunked `.in('id', …)`, empty list makes no query, never throws, logs counts only. Header names its only caller as `app/api/admin/audit-trail/route.ts` |
> | `adminUserRepository.findEmailsByUserIds(userIds: readonly string[])` | ✅ `lib/repositories/AdminUserRepository.ts:150`. Returns `RepositoryResult<Array<{ user_id; email }>>`, **active and deactivated** admins (SC9-1), chunked, logs counts only. The file header (line 24) names "the history route" as its only caller |
> | Audit trail failure posture | ✅ `app/api/admin/audit-trail/route.ts` ~185-220: returned **or thrown** failure → logged, request survives, labels dropped, body says `userLookup: 'failed'`; only a trimmed non-empty `full_name` counts as a name |
> | `adminReadMethods.guard` | ✅ with one precision: `lib/repositories/__tests__/adminReadMethods.guard.test.ts` lists both methods in `ADMIN_METHODS` and asserts every **calling file** starts with `app/api/admin/`. So no guard edit is needed **only if the calls sit in a file under `app/api/admin/`** (SA-1c-6) |
> | `AdminFilterBar` / `useAdminFilters` / `textFilter` | ✅ `app/admin/components/layout/AdminFilterBar.tsx` (already used by `ExchangeRatesView` as the Refresh-only bar), `useAdminFilters(spec, { active })` (L-9a option present), `textFilter({ key, defaultValue, isValid, pageOnly })`; unrelated keys such as `tab` are kept on write. `app/admin/users/usersFilters.ts` is the pattern as described |
> | Finance already has tabs | ✅ `app/admin/finance/components/FinanceTabs.tsx`: Overview, Accounts, Plans; `FINANCE_FILTER_SPEC.tab = choiceFilter('tab', ['accounts', 'plans'], '')`. **But** the spec also owns `show` (Accounts tab: `all` / `active` / `negative`), `status`, `sort`, `group`, `window` (alias `preset`), `account` (alias `accountId`), and `financeFilterRepair` resets a non-default `show` whenever the tab is not Accounts. See SA-1c-1 |
> | `HISTORY_LIMIT = 50` single source | ✅ `lib/admin/exchangeRates/exchangeRateRules.ts`; repository re-exports it as `EXCHANGE_RATE_HISTORY_LIMIT` and uses it in `.limit(...)` |
> | `flagOf` private to `CountrySelect`; `countryName()` has no EU | ✅ `components/ui/CountrySelect.tsx:43`; `lib/geo/countries.ts` `countryName` returns the code for an unknown code |
> | 43 codes | ✅ `lib/utils/currencyHelpers.ts` lists exactly the 43 codes in the §5.5.2 map |
> | `KpiStrip.callers.pin` | ✅ three cases at lines 272-274, hashes at 334-336, header line 29 "Amended by Exchange rates 1a" |
>
> **Baseline drift (not a blocker, BA records it).** §1 is stale: slice 1a is **merged** (PR #477, in this base), and slice 1b is **merged** on `origin/main` (PR #479, `a9551d9c`, after `0581637a`). Dev branches 1c.1 from the **current** `origin/main`, not from `0581637a`.
>
> #### Rulings
>
> | # | Ruling |
> |---|---|
> | SQ-8 | **Rejected as proposed; key `currencies`.** `show` is already a Finance URL key (`FINANCE_FILTER_SPEC.show`, Accounts tab, values `all` / `active` / `negative`), and `financeFilterRepair` rewrites any non-default `show` when the tab is not Accounts. In slice 2 the two would fight over one address bar (`?tab=exchange-rates&show=all` would be "repaired" away). Use **`currencies`**, values `disabled` / `all`, default `enabled` never written (U-3), any other value ignored (U-4), via `textFilter({ key: 'currencies', defaultValue: 'enabled', isValid })` in a module-level spec (e.g. `app/admin/exchange-rates/exchangeRatesFilters.ts`). Search is a `pageOnly` field or plain page state, never written (U-1 exception). The view's hook takes `{ active }` from a prop defaulting to `true`, so slice 2 needs no edit to the spec. Dev greps every `FINANCE_FILTER_SPEC` key and alias at Step 0 and confirms `currencies` is still free |
> | SQ-9 | **Accepted, with the mechanism fixed.** Today `setEnabled` replaces the row in `payload`, so a filter derived from `payload` would drop the row at once. The view keeps a `heldCodes` set: a code switched in this view stays visible (`matchesFilter(row) \|\| heldCodes.has(code)`) with its new chip. The set is emptied on Refresh, on every successful read, and on any filter or search change. The count line counts what is shown (held rows included). Focus stays on the switch because the row does not unmount. One render test: switch off under Enabled only → row stays, chip "Disabled"; Refresh → row gone |
> | SQ-10 | **⚪ Moot (BA note, 2026-10-19): comment 3 was dropped by the user ("skip this requirement, not needed"); nothing below is built. SA text kept for the record.** **Depends on SQ-11.** Only under (a): move `flagOf` to one pure helper (`lib/geo/flagEmoji.ts`, unit-tested: `IL` → regional indicators, lower case accepted), imported by `CountrySelect` with behaviour unchanged (its existing tests stay green unedited). Under (b) or (c) **do not touch `CountrySelect`** (no cross-area edit for nothing) |
> | SQ-11 | **⚪ Moot (BA note, 2026-10-19): comment 3 was dropped by the user ("skip this requirement, not needed"); no flag option is built and no dependency is added. SA text kept for the record.** **All three options are buildable; ruled so whichever BQ-1 answer comes back can be built without another review.** Common shape for all three: the currency → region map (`lib/admin/exchangeRates/currencyCountry.ts`, pure, client-safe) returns `{ region: string \| null, label: string }` and knows nothing about drawing; **one** presentational component (`app/admin/exchange-rates/components/CurrencyFlag.tsx`) draws it; the cell is a wrapper `<span role="img" aria-label={label} title={label}>` with the drawing inside `aria-hidden`. The neutral mark for `region: null` (unknown code, XAF/XOF/XCD/XPF/XDR, metals, crypto) is **lucide-react `Globe`** (already a dependency, used across `app/admin`) in every option, so it looks the same on Windows. EU label "European Union" lives in the map. **(a) Emoji:** approved, no new dependency; the user sees letters on Windows (BQ-1). **(b) ISO code badge:** approved, no new dependency; a small mono text badge on the existing chip styling (not `StatusChip`, which means status); the label still comes from `countryName()` / the map. **(c) `country-flag-icons` SVG: approved as a declared direct dependency, conditions below.** Facts checked: MIT (`LICENSE`, © 2020 catamphetamine); version 1.6.20 already locked and hoisted (`package-lock.json`, pulled by `react-phone-number-input ^1.6.14`); 12 MB on disk across all formats, but `react/3x2` is ESM with `"sideEffects": false` and each flag is a `/*#__PURE__*/` function component taking SVG props (incl. `title`), so only imported flags are bundled; the 43 needed flags' SVGs total ≈ 26 KB raw (measured), the whole barrel `modules/react/3x2/index.js` is ≈ 331 KB if tree-shaking is defeated; `exports.require` → `index.cjs`, so Jest resolves it without a transform change. Nothing in the app imports its React flags today. **Is it a new pattern?** Declaring an already-installed package as a direct dependency for a leaf presentational component is not a new architectural pattern; this ruling is the CLAUDE.md rule 7 review, so no further SA step is needed. **Conditions for (c):** (1) `package.json` `dependencies` gains `"country-flag-icons": "^1.6.20"`; the lockfile diff is limited to the root entry; `npm ls country-flag-icons` shows one deduped copy. (2) Named imports only, from `country-flag-icons/react/3x2`, in `CurrencyFlag.tsx` alone, into a static `Record<string, FlagComponent>` for the 43 mapped regions (EU included). **Forbidden:** `import *`, indexing the module namespace by a runtime code, the CSS sprite (`3x2/flags.css`: global CSS + asset URLs), `string/*` (needs `dangerouslySetInnerHTML`), `unicode` / any network flag URL. (3) Dev records the `/admin/exchange-rates` First Load JS from `next build` before and after in the workplan; expected growth well under 30 KB; anything near the barrel size means tree-shaking failed: stop. (4) Fixed size via Tailwind (e.g. `h-3.5 w-5`), `aria-hidden` on the SVG, the label on the wrapper only (no duplicate `<title>`). (5) The diff shown to the user includes `package.json` and the lockfile; 1c.2 under (c) does not use any auto-merge fast-track |
> | SQ-12 | **(b) accepted, shaped.** `GET /api/admin/exchange-rates?currency=XXX`. Query parsed with Zod **before** any read: `z.object({ currency: currencyCodeSchema.optional() }).strict()` over the search params; an unknown key, a repeated `currency` (`getAll().length > 1`) or a bad code → 400. Valid shape but no such row (`findByCode` → null) → 404. New repository method `listRecentHistoryForCurrency(code)`: `.eq('currency_code', code)`, same order, `.limit(EXCHANGE_RATE_HISTORY_LIMIT)`; repository unit test pins the `.eq` and the limit. The per-currency response is a **separate wire type** (`ExchangeRateHistoryPayload { currencyCode; history; nameLookup; readAt }`), not a filtered `ExchangeRatesPayload`, so the page can never take rates or the Last change tile from it. The plain `GET` (no query) is unchanged in shape apart from SQ-13. Route header ("No query string is read") is rewritten. **Guard edit approved:** `redundantPages.source.guard` "the folder does fetch … one read and one write" is pinned at `toBe(2)`; the per-currency read is a third literal call site (`` fetch(`/api/admin/exchange-rates?currency=${encodeURIComponent(code)}`, …) ``, which `ALLOWED_FETCH` already accepts via `?`) and the count becomes **3**, with the test name updated. Do **not** fold it into the existing read with a variable or a bare `${query}` suffix to dodge the count |
> | SQ-13 | **Accepted, precised.** Order: trimmed non-empty `profiles.full_name` → `admin_users.email` (deactivated included) → `UNKNOWN_USER_LABEL = 'Unknown user'` (constant in `exchangeRateRules.ts`). Ids come only from the history rows the route read (distinct, non-null), never from the request. Both lookups run in parallel, each wrapped for **returned and thrown** errors. **Any** lookup failure → `nameLookup: 'failed'`, every `changedByLabel` null (no half-resolved list), one `error` log with counts and the failed source only, still 200. Success → `nameLookup: 'ok'` and every label non-null. A row with `changedBy` null is labelled "Unknown user" in both cases (nothing was looked up, so nothing failed). Wire: `ExchangeRateHistoryWire.changedByLabel: string \| null`; payloads gain `nameLookup: 'ok' \| 'failed'`. `changedBy` stays on the wire and as the cell's `title` (tracing; admin-only). Page: label when present, else `formatShortId(changedBy)`. The precedence rule is one pure function in `lib/admin/exchangeRates/` (unit-tested), but **the two repository calls stay in a file under `app/api/admin/exchange-rates/`** (SA-1c-6). Both repositories' header comments are updated to name this route as a second caller |
> | SQ-14 | **Accepted: rate changes only, from history.** The tile is labelled "Last rate change". No audit-trail read in the `GET` (that would be a second data source and a privacy surface for a label). An on/off switch never changes this tile |
> | SQ-15 | **Re-pinning accepted, as a named, scoped change.** Pin A's purpose is that the shared `KpiTile` / `KpiStrip` renders byte-identically for every caller across shared-component changes; a caller that deliberately changes its own tiles is outside that promise, and the A1 shape cases still guard the shared component. Conditions: `KpiStrip.tsx` is **not** edited in 1c; `A2 ExchangeRatesKpis loading` keeps its name and gets its new hash (two placeholders); `A2 ExchangeRatesKpis` and `A2 ExchangeRatesKpis none stale` are **removed** (the second's name no longer means anything) and the new cases are appended under clear names (two tiles; no history; name lookup failed; old rate null); the header gains one "Amended by Exchange rates 1c.1" line; the `git diff` of the file touches no other case or hash (Dev shows it in the handover); the file's old and new SHA-256 go in the 1c.1 workplan, as MK-5 did |
> | SQ-16 | **Split accepted: 1c.1 then 1c.2, sequential, not stacked.** 1c.2 branches from `origin/main` after 1c.1 merges (both edit `ExchangeRatesView.tsx`; avoid stacked PRs). 1c.1 full cycle (the route starts returning people's names/emails). 1c.2 short path (UI-only) for (a) or (b); under (c) it stays short path for review but the dependency diff goes to the user, never auto-merged (SQ-11 condition 5) |
>
> #### Additional rulings
>
> | # | Topic | Ruling |
> |---|---|---|
> | SA-1c-1 | §5.3 / §5.5.1 slice 2 note | The "different key" rationale names `status` only. BA adds that `show` is also Finance's (Accounts), and records for slice 2 that `FINANCE_FILTER_SPEC.tab` (`['accounts', 'plans']`) and `financeFilterRepair` must learn the new tab, while the exchange-rates hook runs with `{ active: tab === 'exchange-rates' }`. Slice 2 concern only; nothing in 1c touches `app/admin/finance/` |
> | SA-1c-2 | KPI source | Both tiles take `payload.rates` / `payload.history` from the **plain** `GET` only, never from the filtered rows or the per-currency payload. "Enabled currencies" counts `isEnabled === true` over all rows, USD included, no status colour. "Last rate change" = `history[0]`; value shows the two stored strings ("ILS 3.65 → 3.70", or "ILS set to 3.70" when `oldRate` is null), no arithmetic (D-5); sub line by label or short id, `formatUtc(changedAt)` |
> | SA-1c-3 | Stale constants | The Stale tile goes; `STALE_*` constants, `isRateStale` and the row chip stay. Remove only the imports that become unused in `ExchangeRatesKpis.tsx` (no dead code); the tile's `testId="kpi-stale-rates"` disappears with it, so any test asserting it is updated in 1c.1 |
> | SA-1c-4 | History labels | `RateHistoryTable` caption changes with the cap ("The newest 10"; per-currency: "ILS: newest N"), from `HISTORY_LIMIT`, never a literal. Comments that say 50 are updated (route, view, table, repository) |
> | SA-1c-5 | Filter bar | `role="search"` named "Filters", labelled native `<select>` ("Show") and `type="search"` ("Search", placeholder "Code or name") on `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL`; Clear disabled at defaults; Read at and Refresh unchanged. Search: trimmed, case-insensitive substring on `currencyCode` or `currencyName`; no regex built from input. Empty result: `AdminEmpty` "No currencies match these filters." with Clear |
> | SA-1c-6 | Where the name lookups live | The guard allows only files under `app/api/admin/**` to call `findAdminNamesByIds` / `findEmailsByUserIds`. The calls therefore go in `app/api/admin/exchange-rates/route.ts` (or a sibling helper in that folder), never in `lib/admin/exchangeRates/` or the repository. The guard needs no edit |
> | SA-1c-7 | Privacy and logs | The response adds `changedByLabel` and `nameLookup` only. Logs carry counts, the currency code and `nameLookup`, never a name or an email. A route test spies on the logger and asserts no label value appears in any log argument (the N-6 precedent in `adminReadMethods.guard`) |
> | SA-1c-8 | Skills / domains | No entitlements import, no LLM call, no cron, no schema claim beyond columns already verified in 1a, no tenant id: `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain`, `tenant-isolation-guard` not triggered. The `GET` keeps `requireAdmin` as the first statement; the new query parse comes after it. The route edit follows the `new-api-route` checklist for the changed handler (Zod first, correlationId, error format) |
>
> #### Required changes
>
> **BA, before the 1c.1 workplan:** ✅ all four applied 2026-10-19 (item 3's `package.json` / lockfile row not added: flag option (c) is gone with comment 3).
>
> 1. SQ-8: replace key `show` with `currencies` in §5.5.1, FR-15, §8 1c.2 and the §10 SQ-8 row's consequence; add the SA-1c-1 note to §5.3.
> 2. §1: mark slice 1a merged (PR #477) and slice 1b merged (PR #479); 1c row → "SA cleared with changes (§13.4)".
> 3. §12: add the `redundantPages.source.guard` fetch count 2 → 3 (SQ-12) and, under SQ-11 (c) only, `package.json` / `package-lock.json`.
> 4. §8 1c.1: add the SQ-12 400 / 404 cases, the "any lookup failure → all labels null" case, and the null-`changedBy` → "Unknown user" case; §8 1c.2: add the SQ-9 Refresh step.
>
> **Dev, 1c.1 workplan and build:**
>
> 1. Branch from the current `origin/main` (1a and 1b both merged).
> 2. `HISTORY_LIMIT` 50 → 10; captions and comments per SA-1c-4.
> 3. `GET` query parse and per-currency branch per SQ-12; repository `listRecentHistoryForCurrency` + unit test; separate wire type.
> 4. Name resolution per SQ-13 and SA-1c-6 / SA-1c-7; pure precedence function unit-tested; both repositories' caller comments updated.
> 5. KPIs per SA-1c-2 / SA-1c-3; pin per SQ-15 (SHA-256 old/new recorded).
> 6. Route tests: limit is 10 and not from the request; name; email incl. deactivated; neither → "Unknown user"; null `changedBy`; lookup returned-error and thrown → 200, `nameLookup: 'failed'`, labels null, logged without names; `?currency=` valid / bad / unknown key / repeated / unknown code 404; not admin → 401/403 before any read.
>
> **Dev, 1c.2 workplan and build:**
>
> 1. Filter spec and bar per SQ-8, SA-1c-5; held rows per SQ-9.
> 2. ~~Country column per SQ-11~~ — dropped by the user 2026-10-19; not built.
> 3. Render tests per §8 1c.2, incl. KPIs identical under all three Show values.

---

## 2. Analysis summary

Read from this worktree at `a9551d9c` on 2026-10-19.

| Area | As built today (1a + 1b) | What 1c.1 changes |
|---|---|---|
| `lib/admin/exchangeRates/exchangeRateRules.ts` | `HISTORY_LIMIT = 50` (line 30), the one source; `ExchangeRateHistoryWire` has `changedBy` but no label; `ExchangeRatesPayload { rates, history, readAt }`; `currencyCodeSchema` exists | `HISTORY_LIMIT = 10`; `UNKNOWN_USER_LABEL`; `changedByLabel` on the wire; `nameLookup` on the payload; new `ExchangeRateHistoryPayload`; the query schema; the pure label-precedence function |
| `lib/repositories/ExchangeRatesRepository.ts` | `listAll`, `findByCode`, `listRecentHistory` (`.order('changed_at', desc).limit(EXCHANGE_RATE_HISTORY_LIMIT)`), `updateRate`, `setEnabled`; `toExchangeRateHistoryWire` maps a row | New `listRecentHistoryForCurrency(code)`; the history mapper returns the record without a label (the route adds it); "50" wording updated |
| `app/api/admin/exchange-rates/route.ts` (`GET`) | `requireAdmin` first; `listAll` + `listRecentHistory` in parallel; any read failure → 500; header says "No query string is read" | Query parsed with Zod after the gate; per-currency branch (400 / 404 / 200); name resolution for both branches; header rewritten |
| `UserProfileRepository.findAdminNamesByIds` (line 446) / `AdminUserRepository.findEmailsByUserIds` (line 150) | Never throw, return `{ data: null, error }`, log counts only. Their comments name one caller each (audit trail route; model price history route) | **No code change.** Comments name this route as a second caller |
| `lib/repositories/__tests__/adminReadMethods.guard.test.ts` | Both methods in `ADMIN_METHODS`; every calling file must start with `app/api/admin/` | No edit: the calls go in `app/api/admin/exchange-rates/route.ts` (SA-1c-6) |
| `ExchangeRatesKpis.tsx` | One tile `kpi-stale-rates`, "Stale rates", amber above 0, USD left out | Two tiles: `kpi-enabled-currencies`, `kpi-last-rate-change`. No status colour. Stale tile and its now-unused imports removed (SA-1c-3) |
| `RateHistoryTable.tsx` | Filters the loaded 50 in the browser by `currencyCode`; caption "ILS: 2 of the newest 50"; Changed by = `formatShortId(changedBy)` with the uuid as `title` | Rows passed in (overall list or the per-currency payload); caption from `HISTORY_LIMIT`; label, else "Unknown user" for a null id, else short id; uuid stays as `title` |
| `ExchangeRatesView.tsx` | One `fetch` read, one `fetch` PATCH; `historyFor` state filters the table | Adds the third literal `fetch` (`?currency=`), the per-currency state, loading and error inside the history panel |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` | Lines 230-231: "the folder does fetch (the rule is not vacuous): one read and one write" → `toBe(2)`; `ALLOWED_FETCH` (line 124) already accepts `?` right after the path | Count → 3; name updated. Matcher unchanged (the §5.5.6 bullet, confirmed by reading the regex) |
| `KpiStrip.callers.pin.render.test.tsx` | 3 Exchange rates cases (lines 272-274, hashes 334-336); header line 29 "Amended by Exchange rates 1a" | Per SQ-15 (§3.4) |
| `exchangeRates.render.test.tsx` | 14 tests; asserts `kpi-stale-rates` at lines 109, 146, 158; `stubFetch` answers every GET with one `get()` | Stale-tile assertions replaced; `stubFetch` routes the `?currency=` GET separately; new cases |

**Domain skills (SA-1c-8, confirmed by reading):** no import from `lib/business-os/entitlements/` (type-only included), no LLM call, no cron or queue drain, no tenant id (`tenant-isolation-guard` not applicable: a global platform table, no owner column, no caller-supplied account id; the editor ids come from the rows the route read). No schema claim beyond columns verified in 1a (`exchange_rate_history.changed_by` nullable uuid; `profiles.full_name`; `admin_users.user_id`, `email`, already read by the two existing methods). The changed `GET` handler follows the `new-api-route` checklist (gate first, Zod before business logic, `correlationId`, error format). Not V6 / pipeline work: no pipeline phase is involved.

**`console.*` in touched files:** none. All touched app and lib files already use Pino (`createLogger` server-side, `clientLogger` in the view).

---

## 3. Implementation approach

### 3.1 History cap (a)

`HISTORY_LIMIT` 50 → 10 in `exchangeRateRules.ts`, still the one source (the repository keeps re-exporting it as `EXCHANGE_RATE_HISTORY_LIMIT`). Fixed, never read from the request: the only new query key is `currency`, and the strict schema refuses anything else, so no `limit` can reach the repository. Comments that say 50 are updated (route header, view header, `RateHistoryTable` header, repository); the caption comes from the constant (SA-1c-4).

### 3.2 Per-currency read (b), SQ-12

- **Rules module:** `exchangeRatesQuerySchema = z.object({ currency: currencyCodeSchema.optional() }).strict()`. Kept in the pure rules module so it is unit-tested directly.
- **Route order:** `requireAdmin` (first statement, unchanged) → `correlationId` / child logger → **query parse**: if any key appears more than once (`searchParams.getAll(key).length > 1`) → 400; else `safeParse(Object.fromEntries(searchParams))` → 400 on failure. Nothing is read before this point. Lower case (`?currency=ils`) and empty (`?currency=`) are bad shapes → 400.
- **Per-currency branch:** `findByCode(code)`: error → 500; `null` → 404 (same wording as the `PATCH` 404); then `listRecentHistoryForCurrency(code)`: error → 500. Sequential on purpose: a 404 reads no history. Response: `ExchangeRateHistoryPayload { currencyCode, history, nameLookup, readAt }`, a separate type, so the page can never take rates or the Last change tile from it.
- **Repository:** `listRecentHistoryForCurrency(currencyCode)`: `.from('exchange_rate_history').select(HISTORY_COLUMNS).eq('currency_code', code).order('changed_at', { ascending: false }).limit(EXCHANGE_RATE_HISTORY_LIMIT)`; same no-throw contract and logging shape as `listRecentHistory`. The code it receives has already passed `currencyCodeSchema` in the route, so the repository header's "only a currency code the route has already narrowed through Zod" rule holds.
- **Plain `GET`:** unchanged in shape apart from `nameLookup` and `changedByLabel` (SQ-13).
- **Page:** the History button sets `historyFor` and calls `fetch` with the template literal `/api/admin/exchange-rates?currency=${encodeURIComponent(code)}` and `{ cache: 'no-store' }`, as a third **literal** call site (not folded into the plain read). The panel shows its own `AdminLoading` / `AdminError` (with Retry) while that read runs or fails; the rest of the page is unaffected. A response for a currency that is no longer selected is dropped (a request counter in a ref), so a slow ILS answer cannot overwrite an EUR view. "Show all currencies" clears the per-currency state. After a successful rate save, and on Refresh, the open per-currency view is re-read as well (Q-3), so it never shows a list older than the overall one.

### 3.3 Admin names (c), SQ-13 / SA-1c-6 / SA-1c-7

- **Pure part (`lib/admin/exchangeRates/exchangeRateRules.ts`):**
  - `UNKNOWN_USER_LABEL = 'Unknown user'`.
  - `historyEditorIds(records)`: distinct, non-null `changedBy` values. These are the only ids looked up; none comes from the request.
  - `labelHistory(records, lookup)` where `lookup` is `{ status: 'ok'; names: ReadonlyMap<string, string>; emails: ReadonlyMap<string, string> }` or `{ status: 'failed' }`. On `ok`: trimmed non-empty name → email → `UNKNOWN_USER_LABEL`; a null `changedBy` → `UNKNOWN_USER_LABEL`; every label non-null. On `failed`: every `changedByLabel` null (see Q-1 for the null-`changedBy` row).
  - Type: `ExchangeRateHistoryRecord = Omit<ExchangeRateHistoryWire, 'changedByLabel'>` is what the repository mapper returns; only `labelHistory` produces the wire type, so the compiler stops any path that sends history without having resolved labels.
- **Route part (`app/api/admin/exchange-rates/route.ts`, a module-private function, not exported, because a Next.js `route.ts` may export only handlers and route config):** `resolveLabels(records, requestLogger)`. No ids → no lookup, `ok`. Otherwise `Promise.all` of the two lookups (in parallel, per SQ-13), each wrapped so a **returned** error and a **thrown** error both count as failure of that source. Any failure → `{ status: 'failed' }`, one `requestLogger.error({ err, failed: [...sources], requested })`, still 200. Success → maps built (`full_name` trimmed, only non-empty kept), `ok`. The repository calls stay in this file under `app/api/admin/**` (SA-1c-6), so `adminReadMethods.guard` needs no edit.
- **Logs (SA-1c-7):** counts, the currency code and `nameLookup` only. No route log line takes a label, a name or an email. The repository methods already log counts only.
- **Wire:** `ExchangeRateHistoryWire.changedByLabel: string | null`; `ExchangeRatesPayload.nameLookup` and `ExchangeRateHistoryPayload.nameLookup`: `'ok' | 'failed'`. `changedBy` stays on the wire.
- **Page display rule (one helper, `app/admin/exchange-rates/components/changedByText.ts`, used by the table and the Last change tile):** label when present; else, when `changedBy` is null, `UNKNOWN_USER_LABEL`; else `formatShortId(changedBy)`. The cell keeps `title={changedBy}` for tracing.
- **Repository comments:** the `findAdminNamesByIds` doc comment and `AdminUserRepository.ts` (file header lines 17-25 and the `findEmailsByUserIds` doc) name `app/api/admin/exchange-rates/route.ts` as a second caller. Comment-only edits.

### 3.4 KPIs (d), SA-1c-2 / SA-1c-3 / SQ-15

- `ExchangeRatesKpis` takes the **plain** payload only (as today); the per-currency payload never reaches it.
- Tile 1, `testId="kpi-enabled-currencies"`, label "Enabled currencies", value "N of X" (`formatCount` on both) with N = `isEnabled === true` over all rows (USD counted) and X = all rows; no `status`.
- Tile 2, `testId="kpi-last-rate-change"`, label "Last rate change", from `payload.history[0]`. Value "CODE old → new", or "CODE set to new" when `oldRate` is null: the stored strings exactly as sent, no parsing, no arithmetic (D-5). Sub line "by {changedByText(row)}, {formatUtc(row.changedAt)}". No history → value "No changes yet", no sub line. No status colour.
- Loading: `<KpiStrip loading placeholderCount={2} />`.
- Removed: the Stale tile, and only the imports that become unused in this file (`BASE_CURRENCY`, `STALE_DESCRIPTION`, `isRateStale` stay exported and used by the row chip; the rules are untouched).
- `KpiStrip.tsx` is **not** edited.
- **Pin (SQ-15):** keep `A2 ExchangeRatesKpis loading` (new hash, two placeholders); remove `A2 ExchangeRatesKpis` and `A2 ExchangeRatesKpis none stale` with their hashes; append `A2 ExchangeRatesKpis two tiles`, `A2 ExchangeRatesKpis no history`, `A2 ExchangeRatesKpis name lookup failed`, `A2 ExchangeRatesKpis old rate null`; add one header line "Amended by Exchange rates 1c.1 (SQ-15): …". The handover shows the `git diff` of the file (no other case or hash touched) and the old / new SHA-256.
  - **Old file, recorded at Step 0 (this workplan):** working-tree SHA-256 (CRLF checkout) `6a00679350ca609500eda5e896a76ac1f222bdf9ce38e3b8554ed6690e0dbeef`; git blob `64dac974a580da9bd91861435929a3609ec381ee`. Both are recorded because the Windows checkout converts line endings; the blob id is the stable one.

### 3.5 Guard (e)

`redundantPages.source.guard`: the literal `fetch(` count in `app/admin/exchange-rates/` goes from `toBe(2)` to `toBe(3)`; the test is renamed "… one read, one per-currency read and one write". One planted control is added next to the existing ones: `strayFetches` accepts the `?currency=${encodeURIComponent(code)}` template literal (proves the matcher takes the query string, §5.5.6). Nothing else in the guard changes; G-2, G-4 and the sidebar `UNLISTED` entry stay.

### 3.6 What 1c.1 does not touch

The filter bar and the `currencies` URL key (1c.2), flags (dropped), `app/admin/finance/**` (slice 2), the `PATCH` route and audit events, `ExchangeRatesTable.tsx` (its History button already calls `onShowHistory(code)`; the Stale chip is untouched), `KpiStrip.tsx`, `package.json` / lockfile, migrations, CLAUDE.md, and the requirement MD (its uncommitted 1c edits in this worktree are left as they are; recording this workplan in §1 is the BA / TL's step).

---

## 4. Questions for SA

I follow the ruling as written until SA answers.

| # | Question | What I build meanwhile |
|---|---|---|
| Q-1 | SQ-13 says a null-`changedBy` row "is labelled 'Unknown user' in both cases", while SQ-13 and §8 also say that on any lookup failure "**every** `changedByLabel` null". On the wire these conflict for a null-`changedBy` row when the lookup failed | The strict all-or-nothing reading on the wire: on failure every `changedByLabel` is null; the **page** shows "Unknown user" for any row whose `changedBy` is null (§3.3 display rule), so the §8 display criterion holds in both cases. On success such a row's wire label is "Unknown user" (every label non-null). If SA prefers the wire to carry "Unknown user" for those rows on failure too, it is a one-line change in `labelHistory` and one test |
| Q-2 | SA-1c-4 fixes the overall caption as "The newest 10", from `HISTORY_LIMIT`. With fewer than 10 changes recorded it still reads "The newest 10". The archiving page's precedent (SA M-3) says "The latest N" only at the cap | "The newest {HISTORY_LIMIT}" as ruled; per-currency "ILS: newest {rows.length}". I can switch to the archiving form if SA prefers |
| Q-3 | Re-reading the open per-currency view after a rate save and on Refresh (§3.2) is my addition, so the panel never lags the overall list | Built as described; it adds no `fetch(` literal (it reuses the per-currency loader) |

---

## 5. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/admin/exchangeRates/exchangeRateRules.ts` | modify | `HISTORY_LIMIT` 10; `UNKNOWN_USER_LABEL`; `changedByLabel`, `nameLookup`, `ExchangeRateHistoryRecord`, `ExchangeRateHistoryPayload`; `exchangeRatesQuerySchema`; `historyEditorIds`, `labelHistory` |
| `lib/admin/exchangeRates/__tests__/exchangeRateRules.test.ts` | modify | Limit is 10; query schema cases; precedence cases (name, blank name, email, neither, null `changedBy`, failed) |
| `lib/repositories/ExchangeRatesRepository.ts` | modify | `listRecentHistoryForCurrency`; mapper returns `ExchangeRateHistoryRecord`; "50" comments |
| `lib/repositories/__tests__/ExchangeRatesRepository.test.ts` | modify | Limit 10; the new method pins `.eq('currency_code', code)`, the order and `.limit(EXCHANGE_RATE_HISTORY_LIMIT)`; error path |
| `app/api/admin/exchange-rates/route.ts` | modify | Query parse, per-currency branch, label resolution, header rewritten |
| `app/api/admin/exchange-rates/__tests__/route.test.ts` | modify | Mocks for the two lookup repositories and the new method; every case in SA required change 6 (§7.1) |
| `lib/repositories/UserProfileRepository.ts` | modify (comment only) | Second caller named |
| `lib/repositories/AdminUserRepository.ts` | modify (comment only) | Second caller named, file header and method doc |
| `app/admin/exchange-rates/components/changedByText.ts` | create | The one page-side display rule (label → "Unknown user" for a null id → short id) |
| `app/admin/exchange-rates/components/ExchangeRatesKpis.tsx` | modify | Two tiles, Stale tile removed, header comment |
| `app/admin/exchange-rates/components/RateHistoryTable.tsx` | modify | Rows passed in, caption from `HISTORY_LIMIT`, label display, per-currency loading / error, header comment |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | modify | Per-currency read (third literal `fetch`), stale-response drop, re-read after save / Refresh, header comment |
| `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx` | modify | `stubFetch` routes `?currency=`; Stale-tile assertions replaced; new cases (§7.1) |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` | modify | Fetch count 2 → 3, test name, one planted control |
| `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` | modify | SQ-15 re-pin; one header line |
| `docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1C1_WORKPLAN.md` | create | This workplan |

Not modified: `lib/repositories/__tests__/adminReadMethods.guard.test.ts`, `KpiStrip.tsx`, `ExchangeRatesTable.tsx`, `app/api/admin/exchange-rates/[currencyCode]/**`, anything under `app/admin/finance/` or `lib/business-os/`, `package.json` / lockfile.

---

## 6. Task list

- ✅ Step 0: baseline on the unchanged tree. Confirm branch `feature/admin-exchange-rates-1c` at `a9551d9c`; run the narrow Jest set (§7.2) and the narrow `tsc` (§7.3); record suite / test counts and any pre-existing errors; re-confirm the pin file's SHA-256 and blob id match §3.4
- ✅ Step 1: rules module: `HISTORY_LIMIT` 10, `UNKNOWN_USER_LABEL`, wire / payload types, `exchangeRatesQuerySchema`, `historyEditorIds`, `labelHistory`; unit tests
- ✅ Step 2: repository: `listRecentHistoryForCurrency`, mapper type, comments; unit tests
- ✅ Step 3: route: query parse after the gate, per-currency branch, `resolveLabels`, header; route tests (§7.1)
- ✅ Step 4: caller comments in `UserProfileRepository.ts` and `AdminUserRepository.ts`; run `adminReadMethods.guard` (expect green, unedited)
- ✅ Step 5: page: `changedByText.ts`, `RateHistoryTable`, `ExchangeRatesView` (per-currency read, stale-response drop, re-read after save / Refresh)
- ✅ Step 6: KPIs: two tiles, Stale tile and unused imports removed; render tests updated and added
- ✅ Step 7: `KpiStrip.callers.pin` per SQ-15; record the new SHA-256 / blob id and the scoped `git diff`
- ✅ Step 8: `redundantPages.source.guard` count 2 → 3, rename, planted control
- ✅ Step 9: full verification (§7.2 to §7.4); `git diff --stat` checked for any deletion without insertion (truncation hazard); hand over to SA uncommitted (no commit, no stash)

### 6.1 Implementation notes (Dev, 2026-10-19)

**SA rulings applied:**

| # | How it was applied |
|---|---|
| Q-1 / W-2 | `labelHistory`: on `failed`, a row with no editor id gets `UNKNOWN_USER_LABEL` and every looked-up editor gets `null`. Unit test asserts both kinds of row; every route lookup-failure case has one null-`changedBy` row and asserts its label. `changedByText` is `label ?? (changedBy ? formatShortId(changedBy) : UNKNOWN_USER_LABEL)` |
| Q-2 / W-6 | `historyCaption(count, code)` in `RateHistoryTable.tsx`: "The newest {HISTORY_LIMIT} changes" when `count === HISTORY_LIMIT`, else "{n} change(s), newest first"; one-currency view prefixes "{CODE}: ". Render cases: below the cap, at the cap, and both forms for one currency |
| Q-3 / W-6 | The open one-currency panel is re-read after a **successful rate save** and on **Refresh**, through the same `loadCurrencyHistory` and the same `historyRequest` counter; not after an on/off switch. A failed re-read shows `AdminError` (Try again) inside the panel; `REFRESH_AFTER_SAVE_FAILED` stays tied to the plain read. Render cases: save re-reads, Refresh re-reads, switch re-reads nothing, failed re-read stays in the panel |
| W-1 | `toExchangeRateHistoryWire` → `toExchangeRateHistoryRecord` (repository, route, route test mock, repository test). No other caller (`grep` clean) |
| W-3 | `historyRequest` is bumped by a new selection, by "Show all currencies" (and by clicking an open currency's History again, which closes the panel), and on unmount. Render cases: ILS → EUR then the late ILS answer is dropped; Show all then the late ILS answer leaves the panel closed; unmount then the late answer sets no state |
| W-4 | Planted control in `planted controls (no dead rule)`: the `?currency=${encodeURIComponent(code)}` template literal is not stray; `` fetch(`/api/other?currency=${c}`) `` is |
| W-5 | Route tests: valid code with no history → 200, `history: []`, `nameLookup: 'ok'`, neither lookup called; per-currency read with a failed name lookup → 200, `nameLookup: 'failed'` |
| RK-2 | `resolveLabels` is module-private (a source test pins that `route.ts` exports only `GET`, `runtime`, `dynamic`). Route tests cover, per source, a returned error and a throw, plus "returned no data" for names and both failing at once |

**Deviations (none change scope):**

| # | Deviation | Why |
|---|---|---|
| DV-1 | The slice 1a QA probe "the query string is never read (no caller-supplied limit)" is removed and replaced by "a caller-supplied limit is a 400, never forwarded" plus "the route source never names a limit of its own" | SQ-12 makes the route read the query string by design, so the old probe could not stay true; the replacements pin the same intent (no caller-supplied limit) |
| DV-2 | The plain `GET` test request no longer carries `?limit=999` | It is now a 400; the 400 has its own test |
| DV-3 | The count line is hidden over the empty state (and while the one-currency read is loading or failed) | SA Q-2: "An empty list keeps today's empty state"; a "0 changes" line above "No rate changes recorded yet." says nothing more |
| DV-4 | Step 0 `tsc` baseline was not taken before editing; the narrow `tsc` after the change is clean (exit 0, 0 errors over 148 project files, touched files confirmed in `--listFiles`), so there is nothing to compare | The baseline exists to separate pre-existing errors from new ones; with zero errors there are none of either |
| DV-5 | Step 0 Jest baseline overlapped the first edit (`HISTORY_LIMIT` 50 → 10 was saved while the run was in flight): 32 suites / 2,679 tests, 2 failures, both the two `toBe(50)` limit pins that this slice changes | Not a pre-existing failure; both pins are updated in Steps 1–2 |
| DV-6 | `ExchangeRatesView` keeps the last one-currency answer on screen while the same code is re-read (Refresh / after a save); the loading state shows only when nothing is loaded yet | Avoids the panel flashing empty on every save |

**Results (Step 9):**

| Check | Result |
|---|---|
| Narrow Jest set (§7.2) | **32 suites / 2,751 tests passed**, 0 failed |
| Narrow `tsc` (§7.3, scratch `tsconfig.fx1c1.json`) | exit 0, **0 errors** |
| `eslint` on the 15 touched `.ts` / `.tsx` files | exit 0, **0 errors, 0 warnings** |
| `npm run lint:hooks` | exit 0 |
| `adminReadMethods.guard` | green, unedited |
| `redundantPages.source.guard` | fetch count 3, three literal call sites in `ExchangeRatesView.tsx` |
| `git diff --stat` | 15 modified files, +1,587 / −156, plus 2 new (`changedByText.ts`, this workplan); no deletion without insertion. The requirement MD's +244 / −3 is the pre-existing uncommitted 1c edit, untouched |

**KpiStrip pin (SQ-15):**

| | SHA-256 (working tree, CRLF) | git blob |
|---|---|---|
| Old (Step 0) | `6a00679350ca609500eda5e896a76ac1f222bdf9ce38e3b8554ed6690e0dbeef` | `64dac974a580da9bd91861435929a3609ec381ee` |
| New | `8783c9737453ddbae8886c1cc4690582567fb2375d220a1b4795afe3f94e5dac` | `d4507d0f17db19a6f921c960982e2db14fa64ac1` |

The file's `git diff` touches only: one header line ("Amended by Exchange rates 1c.1 …"), the `ExchangeRateHistoryWire` type import, the Exchange rates fixtures, the Exchange rates `CASES` rows (`loading` kept; `A2 ExchangeRatesKpis` and `… none stale` removed; `two tiles`, `no history`, `name lookup failed`, `old rate null` added) and their `EXPECTED` hashes. No other case or hash changed; `KpiStrip.tsx` untouched. New hashes: loading `000fe11e…599596`, two tiles `98dad5c9…cc9b69`, no history `73f1684b…909706`, name lookup failed `8c723a0e…251eb55`, old rate null `59839d2b…c3c4ee`.

**Line endings:** every touched source file is CRLF, as checked out (`core.autocrlf=true`); none mixed.

**Fixes after the SA code review (Dev, 2026-10-20).** N-1 and N-2 were fixed by TL and are left as they are.

| # | Fix | Proof |
|---|---|---|
| F-1 (C-1) | `ExchangeRatesView`: `openCodeRef` follows the open panel's code (`useEffect`), and `saveRate` reads it **after** the PATCH await, so a save re-reads the panel that is open when it finishes. `openCode` is no longer a `saveRate` dependency. `stubFetch` / `renderPage` accept a deferred PATCH answer | Two render tests with a deferred PATCH: "Show all" during the save → the panel stays closed and there is no second `?currency=ILS` read; switching to EUR during the save → EUR stays open and is re-read, ILS is not. Both **fail** against the old `saveRate` (probed locally, then restored byte for byte) |
| F-2 (C-2) | The answer gate is now the single `if (request !== historyRequest.current) return;` after `readAdminResponse` (plus one on the network-error path); `settle` no longer re-checks, so the gate is the line that matters. Late answers in the render tests are delivered inside `act` (helper `late()`), so an update the view should not make is committed before the assertion (with a bare timer tick the old tests could not see it). New tests: ILS (deferred A) → Show all → ILS (deferred B), resolve B then A → B's rows stay; a 500 after unmount → the client logger's "Exchange rate history read failed" warning is **not** called (the view's `clientLogger` is mocked); plus a mounted control showing the same 500 *is* logged | **Probed:** with the gate line deleted locally, the same-currency race test and the unmount test **both fail** (2 failed / 36 passed); restored by copying the saved file back (`cmp` identical), then 38 / 38 pass |
| F-3 (C-3) | Route source pin collects every line starting with `export` and asserts exactly three: `GET`, `runtime`, `dynamic` | `route.test.ts` |
| F-4 (O-1) | `RateHistoryTable` takes a separate `busy` prop; `aria-busy={loading \|\| busy}`. The view passes `busy={currencyHistory.loading}`, so a same-currency re-read over shown rows marks the panel busy | Render test: Refresh with the ILS panel open → `aria-busy="true"` with both rows still shown → `false` after the answer |
| F-5 (O-2) | `route.ts`: comment above `if (failures.length > 0 \|\| !names.rows \|\| !emails.rows)` says the two extra clauses are only for TypeScript narrowing | — |

Re-run: narrow Jest (§7.2) **32 suites / 2,756 tests passed**; `eslint` on the 5 touched files exit 0, no findings; narrow `tsc` exit 0. Fix-only diff: `ExchangeRatesView.tsx` +14 / −3, `RateHistoryTable.tsx` +12 / −2, `exchangeRates.render.test.tsx` +113 / −11, `route.ts` +2 / −0, `route.test.ts` +6 / −2.

---

## 7. Tests and commands

### 7.1 Tests added or changed

| Suite | Cases |
|---|---|
| `exchangeRateRules.test.ts` | `HISTORY_LIMIT` is 10; query schema: `{}` ok, `{ currency: 'ILS' }` ok, lower case / empty / 4 letters / unknown key → fail; `labelHistory` ok: name wins, blank and whitespace name fall through to email, email when no name, neither → "Unknown user", null `changedBy` → "Unknown user", every label non-null; failed: every label null; `historyEditorIds` distinct and non-null |
| `ExchangeRatesRepository.test.ts` | Limit is 10; `listRecentHistoryForCurrency` calls `.eq('currency_code', 'ILS')`, `.order('changed_at', { ascending: false })`, `.limit(10)`; error → `{ data: null, error }`, never throws |
| `route.test.ts` (`GET`) | Not admin → 401 / 403 before any read, also with a bad query; limit is 10 and `?limit=50` is a 400 (unknown key), never forwarded; name; email for a deactivated admin; neither → "Unknown user"; null `changedBy` → "Unknown user" and not looked up; names lookup returned error → 200, `nameLookup: 'failed'`, all labels null, one error log; emails lookup thrown → same; logger spy: no name or email string in any log argument; only `changedByLabel` / `nameLookup` added (exact key set of a history row and of the payload); `?currency=ILS` → 200 `ExchangeRateHistoryPayload` with no `rates` key, labelled; `?currency=ils`, `?currency=`, `?currency=ILS&currency=EUR`, `?foo=1` → 400 and no repository call; `?currency=XYZ` with no row → 404 and no history read; per-currency read failure → 500 |
| `exchangeRates.render.test.tsx` | Exactly two KPI tiles; "Enabled currencies" "N of X" with USD counted; "Last rate change" "ILS 3.65 → 3.70" with "by {name}, {UTC}"; old rate null → "ILS set to 3.70"; no history → "No changes yet"; lookup failed → short id in tile and table; null `changedBy` → "Unknown user"; no `kpi-stale-rates`; the Stale chip still on stale rows, never on USD; the History button fetches `?currency=ILS` and shows its rows with "ILS: newest N"; Show all returns to the overall list; a per-currency failure shows an error in the panel only; the Last change tile is unchanged by a per-currency payload whose first row differs (SA-1c-2); a late answer for a deselected currency is dropped |
| `redundantPages.source.guard.test.ts` | Count is 3; planted control for the `?currency=` template literal |
| `KpiStrip.callers.pin.render.test.tsx` | Per SQ-15 |

### 7.2 Narrow Jest set

```bash
npx jest lib/admin/exchangeRates lib/repositories/__tests__/ExchangeRatesRepository.test.ts lib/repositories/__tests__/adminReadMethods.guard.test.ts lib/repositories/__tests__/AdminUserRepository.test.ts app/api/admin/exchange-rates app/admin/exchange-rates app/admin/__tests__/redundantPages.source.guard.test.ts app/admin/components/__tests__/AdminSidebar.nav.test.ts app/admin/components/layout/__tests__ lib/business-os/finance/__tests__/finance.source.guard.test.ts app/admin/finance/__tests__/source.guard.test.ts lib/admin/__tests__/admin-authz-surface.guard.test.ts --ci
```

Run at Step 0 (baseline) and Step 9. `app/admin/components/layout/__tests__` covers the pin and the layout folder guards; the two finance source guards prove nothing under finance moved.

### 7.3 Type check (narrow)

A full `tsc` ran out of memory on this machine in 1a, so: a scratch tsconfig in the session scratchpad (never committed) that `extends` the worktree's `tsconfig.json`, with `include` = `next-env.d.ts`, `types/**/*.d.ts` and the §5 `.ts` / `.tsx` files; run `npx tsc --noEmit -p <scratchpad>/tsconfig.fx1c1.json`, check the exit code, filter the output to the §5 files and compare with the Step 0 baseline. Pass = no new error in a touched file.

### 7.4 Lint

```bash
npx eslint <the §5 .ts / .tsx files>
npm run lint:hooks
```

No `npm install`, no build, no CI change, no added CI time.

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| RK-1 | **Privacy:** the route now returns admins' names and emails to the browser | Admin-only page and route; ids only from the history rows read; only `changedByLabel` and `nameLookup` added (exact-key test); logger-spy test proves no name or email is logged (SA-1c-7) |
| RK-2 | **Half-resolved labels** when one source fails and the other succeeds | `resolveLabels` treats any returned or thrown failure of either source as `failed`; `labelHistory` nulls every label; a test per source and per failure kind |
| RK-3 | The name lookups end up outside `app/api/admin/**` and break `adminReadMethods.guard` | Calls only in `route.ts`; the pure function in `lib/` takes maps, never a repository; guard run at Step 4 |
| RK-4 | A `route.ts` that exports a helper fails the Next.js route type check / build | `resolveLabels` is module-private; the testable logic lives in the rules module |
| RK-5 | **Pin churn beyond the Exchange rates cases** | `KpiStrip.tsx` untouched; the pin file's `git diff` shown at handover; only the named cases change; old / new SHA-256 and blob id recorded |
| RK-6 | The fetch-count guard dodged (a variable URL or a `${query}` suffix on the plain read) | A third **literal** call site, as SQ-12 requires; planted control added |
| RK-7 | Race in the per-currency panel: a slow answer overwrites a newer selection | Request counter in a ref; render test for a late answer |
| RK-8 | Existing render tests assume one answer for every GET, and assert `kpi-stale-rates` | `stubFetch` routes by URL; the three Stale-tile assertions are replaced, the row-chip assertions kept |
| RK-9 | CRLF on Windows: a file SHA-256 differs between checkouts; source scans on `'\n'` break | The git blob id is recorded with the SHA-256; the new guard control uses no line-ending-sensitive scan |
| RK-10 | D-5 drift: a percentage or difference added to the tile | Stored strings only, no number parsing of a rate in the KPI file; render test asserts the exact stored text |
| RK-11 | 1c.2 conflicts: both slices edit `ExchangeRatesView.tsx` | SQ-16: 1c.2 branches from `origin/main` after 1c.1 merges; no stacking |
| RK-12 | Shared `node_modules` junction in this worktree | Never delete it, never `git worktree remove --force`; no `npm install` |
| RK-13 | The requirement MD's uncommitted 1c edits live in this worktree | Left untouched by Dev; RM decides whether they ride with the 1c.1 commit |

---

## 9. SA Review Notes

### SA workplan review

**Reviewed by SA — 2026-10-19**
**Verdict: APPROVED-WITH-CHANGES.** The workplan follows §13.4 ruling by ruling, quotes its scope verbatim, and stays inside 1c.1 (no filter bar, no flags, nothing under `app/admin/finance/`, no migration, no dependency). Proceed to implementation once W-1 to W-6 below are folded into the build. They are build-time conditions, so the workplan does not need another SA pass first. SQ-11 and SQ-10 are moot, and none of their text applies.

**Verified against the worktree (`a9551d9c`):**

| Claim | Result |
|---|---|
| `route.ts` `GET`: `requireAdmin` first, `Promise.all(listAll, listRecentHistory)`, header "No query string is read" | ✅ as stated |
| `ALLOWED_FETCH` accepts a query string | ✅ `/^\s*(['"`])\/api\/admin\/exchange-rates(['"`/?]\|\$\{)/`: a `?` right after the path matches, so the `?currency=${…}` template literal passes with no matcher change |
| Count test pinned at 2 | ✅ "the folder does fetch (the rule is not vacuous): one read and one write" → `toBe(2)` |
| Planted-controls block exists for the new control | ✅ `describe('planted controls (no dead rule)')`, G-6 entry at line ~290 |
| `KpiStrip` `placeholderCount` | ✅ prop exists (default 4); `KpiStrip.tsx` needs no edit |
| `toExchangeRateHistoryWire` callers | ✅ the route, the route test's partial mock (`actual.toExchangeRateHistoryWire`), and the repository test. See W-1 |
| Current caption | `RateHistoryTable` line 46 reads "The newest ${history.length}" and "ILS: n of the newest ${history.length}". See Q-2 |
| Save flow | `load({ afterSave: true })` already re-reads after a save, with the `REFRESH_AFTER_SAVE_FAILED` notice. See Q-3 |

#### Rulings on §4

| # | Ruling |
|---|---|
| Q-1 | **The wire carries "Unknown user" for a null-`changedBy` row in both cases. That is not the Dev's interim reading.** SQ-13's specific sentence ("a row with `changedBy` null is labelled 'Unknown user' in both cases, nothing was looked up, so nothing failed") governs. "Every `changedByLabel` null" on failure means every row **whose id was looked up**. The purpose of all-or-nothing is to never mix resolved names with raw ids, and a null id has no name to mix. This keeps the label rule in one place on the server (`labelHistory`), and the page's fallback is only a safety net. So in `labelHistory`, on `failed`, a null `changedBy` row gets `UNKNOWN_USER_LABEL` and every other row gets `null`. `changedByText` stays `label ?? (changedBy ? formatShortId(changedBy) : UNKNOWN_USER_LABEL)`, which is harmless and defensive. Tests: `labelHistory` failed case asserts both kinds of row, and the route lookup-failed case includes one null-`changedBy` row and asserts its label. The §8 1c.1 line "**every** `changedByLabel` null" should read "every label of a looked-up editor null". That is a BA / TL wording precision in the requirement and does not block the build |
| Q-2 | **Use the archiving form. This amends SA-1c-4.** A caption must not claim a cap that the list did not reach. Overall: at the cap (`rows.length === HISTORY_LIMIT`), "The newest {HISTORY_LIMIT} changes"; below it, "{n} change(s), newest first". Per-currency: the same two forms prefixed with "{CODE}: ". The cap number comes from `HISTORY_LIMIT`, never a literal. An empty list keeps today's empty state. One render case covers each form (at the cap, and below it) |
| Q-3 | **Accepted, with conditions.** The open per-currency panel is re-read after a **successful rate save** and on **Refresh**, through the same loader and the same request counter, so it adds no `fetch(` literal and the count stays 3. It is **not** re-read after an on/off switch (a switch writes no history row, SQ-14), so there is no extra request. If the re-read fails, the panel shows its own `AdminError` with Retry. The save stays a success, and the page-level `REFRESH_AFTER_SAVE_FAILED` notice stays tied to the plain read only. One render case: save a rate while the ILS panel is open → a second `?currency=ILS` GET is made |

#### Design confirmations (asked by TL)

| Item | Ruling |
|---|---|
| Type split forcing labels | ✅ **Confirmed.** `ExchangeRateHistoryRecord = Omit<ExchangeRateHistoryWire, 'changedByLabel'>` from the repository mapper. Only `labelHistory` produces the wire type, so the compiler refuses unlabelled history in either payload. See W-1 for the mapper name |
| Name lookups in a private function in `route.ts` | ✅ **Confirmed.** `resolveLabels` is module-private and **must not be exported**: a Next.js `route.ts` may export only HTTP handlers and route-segment config (`runtime`, `dynamic`, …), and any other export fails the route type check in `next build`. The calls sit under `app/api/admin/**`, so `adminReadMethods.guard` passes unedited (SA-1c-6). A sibling non-route helper file in the same folder was also allowed by SA-1c-6, but it is not needed. Because the function is private, its behaviour is proven only through `route.test.ts`, so the returned-error and thrown cases per source (RK-2) are mandatory there, not optional |
| Pure `labelHistory` in the rules module | ✅ **Confirmed.** It takes maps or `{ status: 'failed' }`, never a repository, and is client-safe (the module is already imported by the view). Unit-tested per §7.1, with the Q-1 change |
| Per-currency 400 / 404 order | ✅ **Confirmed:** `requireAdmin` → correlationId / child logger → repeated-key check over **every** key (`new Set(searchParams.keys())`, `getAll(k).length > 1` → 400) → strict `safeParse` → 400 → `findByCode` (error → 500, null → 404) → `listRecentHistoryForCurrency` → `resolveLabels`. Nothing is read before the query passes, and a 404 reads no history. A 400 body carries the CLAUDE.md error shape, and `details` (the Zod issues) appears in development only. It never echoes the raw query in production |
| Dropping out-of-order answers | ✅ **Confirmed**, with one precision (W-3): the counter is also bumped by "Show all currencies" and by unmount, so a late answer can neither reopen a closed panel nor set state after unmount. Comparing the counter alone is enough, and no `AbortController` is needed |
| Re-reading the per-currency view after a save | ✅ Per Q-3 (rate save and Refresh only, not on/off switches) |
| Re-pinning the KpiStrip test per SQ-15 | ✅ **Confirmed as written** (§3.4): `loading` kept and re-hashed with two placeholders; `A2 ExchangeRatesKpis` and `… none stale` removed; four cases appended; one header line; `KpiStrip.tsx` untouched. The old SHA-256 and blob id are already recorded. The handover adds the new pair and the file's `git diff`, which must show changes to the Exchange rates cases, their hashes and the one header line, and nothing else |
| Fetch count 2 → 3 with a planted control | ✅ **Confirmed.** It needs three **literal** call sites. The planted control proves `strayFetches` accepts `` fetch(`/api/admin/exchange-rates?currency=${encodeURIComponent(code)}`, …) `` (W-4). Note that `ALLOWED_FETCH` would also accept a bare `` `/api/admin/exchange-rates${query}` `` suffix, so the "no dodge" rule of SQ-12 is enforced by this review and by the count, not by the matcher. Code review will check for it |

#### Required changes (build-time)

| # | Change |
|---|---|
| W-1 | Rename the repository mapper `toExchangeRateHistoryWire` → `toExchangeRateHistoryRecord`, since it no longer returns the wire type. Update its three call sites (route, the route test's partial mock, repository test). A name that claims "Wire" for an unlabelled record undoes the point of the type split. **Low** |
| W-2 | Q-1 as ruled: `labelHistory` labels a null-`changedBy` row "Unknown user" on `failed` too; adjust the unit and route tests. **Medium** |
| W-3 | The request counter is bumped by "Show all currencies" and on unmount as well as by a new selection; the render test for a late answer also covers "Show all, then the ILS answer arrives → panel stays closed". **Medium** |
| W-4 | The new planted control sits in the existing `planted controls (no dead rule)` block and asserts `strayFetches(planted)` is `[]` for the `?currency=` template literal **and** non-empty for a planted `` fetch(`/api/other?currency=${c}`) ``, so the control cannot pass vacuously. **Low** |
| W-5 | Add route tests: a valid code with a row but **no** history → 200, `history: []`, `nameLookup: 'ok'`, neither lookup repository called; the per-currency branch with a failed lookup → 200, `nameLookup: 'failed'` (the same `resolveLabels` path serves both branches). **Medium** |
| W-6 | Q-2 caption forms and the Q-3 conditions (re-read on rate save and Refresh only; panel-local error) with their render cases. **Low** |

#### Standards check

- **Skills:** `new-api-route` checklist holds for the changed `GET` (gate first, Zod before business logic, correlationId, error format, `runtime` / `dynamic` unchanged). `new-repository`: the new method keeps the no-throw `RepositoryResult` contract, the documented service-role / no-`user_id` header (SA-R6) and a unit test. `tenant-isolation-guard`, `business-os-entitlements`, `bos-llm-call-standards` and `durable-queue-drain` are not triggered (SA-1c-8 confirmed: no entitlements import, no LLM, no cron, no tenant id; ids come only from rows the route read). `business-os-schema-check`: no new column claim.
- **Admin gate:** `requireAdmin` stays the first statement. The page is `requireAdminPage` through the admin layout, and there is no `profiles.role` anywhere.
- **Logging:** 0 `console.*` in the touched files (confirmed, and the guard's `console` ban covers the page folder). The new error log takes counts and failed sources only, and the logger-spy test (SA-1c-7) covers names **and** emails.
- **Privacy:** additive keys only (`changedByLabel`, `nameLookup`), pinned by the exact-key-set test. This is acceptable for an admin-only page and route.
- **Proportionality:** fine. The changes are one pure function, one repository method, one private route helper and one display helper. No new pattern (CLAUDE.md rule 7).
- **Verification:** the §7.2 Jest set, §7.3 narrow `tsc` and §7.4 lint are adequate, and nothing adds CI time. At handover, include `git diff --stat` (truncation hazard) and the pin file diff.

### Approval

[x] Workplan approved with changes W-1 to W-6. Proceed to implementation; no further SA workplan pass needed.

### SA code review

**Code Review by SA — 2026-10-19**
**Status:** 🔄 Fix Required (APPROVED-WITH-CHANGES). The route, rules, repository, KPIs, pin and guard are correct and match §13.4, W-1 to W-6 and Q-1 to Q-3. Two Medium items in the view and its tests must be fixed before commit (C-1, C-2); C-3 should be fixed in the same pass. SA re-checks the fix by diff only; no new review cycle is needed. QA's PASS-WITH-NOTES (§10) ran in parallel and did not exercise either Medium item; QA re-runs the render suite after the fix.

**Read from the worktree** `neuronforge-fx-rates-1c` (`a9551d9c` + uncommitted): `git diff` of all 15 files, the new `changedByText.ts`, and the full `route.ts`, `ExchangeRatesView.tsx`, `RateHistoryTable.tsx` and `ExchangeRatesKpis.tsx`. Re-ran the slice's 8 suites (route, page, rules, repository, `adminReadMethods.guard`, `redundantPages.source.guard`, `KpiStrip.callers.pin`): **8 suites / 400 tests passed**. `eslint` on the view and route: clean. No `console.*` in any touched non-test file. Nothing touches `lib/business-os/entitlements/`.

#### Checks requested by TL

| Check | Result |
|---|---|
| `requireAdmin` first statement | ✅ `route.ts:169`; the source pin (`route.test.ts:473`) holds; 401 / 403 with a bad query read nothing |
| Query order: repeated key → strict Zod → `findByCode` → history → labels | ✅ `route.ts:177-209`. The repeated-key check walks every key (`new Set(params.keys())`), then `safeParse(Object.fromEntries(...))`. `findByCode` error → 500, null → 404 with no history or name read; then `listRecentHistoryForCurrency`, then `resolveLabels`. Seven bad-query cases → 400 + `noRead()`, including the same code twice and code + `limit` |
| `resolveLabels` private; `route.ts` exports only `GET`, `runtime`, `dynamic` | ✅ `route.ts:106`, not exported. The pin is at `route.test.ts:480`, but its regex checks less than its name claims (C-3) |
| Name lookups all-or-nothing | ✅ `route.ts:115-147`: each source is wrapped for a returned error, returned null data and a throw. Any failure → `labelHistory(…, { status: 'failed' })`: looked-up editors null, a null editor "Unknown user" (Q-1). Six route cases (each source × each kind, plus both) |
| No name or email in logs | ✅ The error log carries `err`, `failed`, `requested` and `nameLookup`; the debug log carries counts. The logger-spy test serialises every call across success, per-currency and failure, and finds no name or email |
| Type split forces labels | ✅ `ExchangeRateHistoryRecord = Omit<…, 'changedByLabel'>`; mapper renamed `toExchangeRateHistoryRecord` (W-1); both payload literals in `route.ts` are typed, so history can only come from `labelHistory` |
| Out-of-order request counter (selection, Show all, unmount) | ⚠️ The code is right (`ExchangeRatesView.tsx:121, 129, 144, 157, 171-176`), **but none of the three W-3 tests proves the counter** (C-2). Separately, the save path has a stale-closure bug that the counter cannot catch (C-1) |
| Fetch count 3, planted controls both ways | ✅ Three literal call sites (`ExchangeRatesView.tsx:102, 135, 189`); no `${query}` dodge; `toBe(3)`; the planted control accepts the `?currency=${encodeURIComponent(code)}` literal **and** trips on `/api/other?currency=${c}` (W-4) |
| `KpiStrip.callers.pin` diff scoped | ✅ `git diff` checked: one header line, the type import, the FX fixtures, the FX `CASES` rows (`loading` kept, two removed, four added) and their `EXPECTED` hashes. No other case or hash changed; `KpiStrip.tsx` untouched; blob `64dac974` → `d4507d0f` matches §6.1. The four new cases sit in the A2 block where the 1a cases were, not at the file's end. Order affects no hash, so this is accepted as "appended" |
| KPI values from the full, unfiltered data | ✅ `ExchangeRatesKpis` receives only the plain payload (`ExchangeRatesView.tsx:241`); N = `isEnabled === true` over every row (USD included); X = `rates.length`; Last change = `history[0]` of the plain read. The render test with a per-currency payload whose first row differs leaves the tiles unchanged |
| No arithmetic on rates (D-5) | ✅ `rateChangeText` puts the stored strings side by side; no `parseFloat`, `Number(`, `toFixed` or `Math.` in the components (grep clean) |
| Error format | ✅ 400 `{ success: false, error: 'Invalid query', details }` with the Zod issues in development only (tests assert no `details` outside it); 404 `Unknown currency`; 500 through `readFailed` / `devDetails`. The raw query is never echoed |
| Hooks rules | ✅ Every hook is top-level and unconditional; the dependency arrays are complete (`refresh` and `saveRate` list `openCode`); `eslint` and `lint:hooks` are clean. The ref mutation in the unmount cleanup is intentional |

#### Rulings on deviations (§6.1)

| # | Ruling |
|---|---|
| DV-1 | **Accepted.** SQ-12 makes the route read the query by design. The two replacements ("`?limit=` is a 400, never forwarded"; "the route source names no limit of its own") pin the same intent more strongly than the old probe |
| DV-2 | **Accepted.** It follows from DV-1; the 400 has its own test |
| DV-3 | **Accepted.** It is consistent with SA Q-2 ("an empty list keeps today's empty state"). A count line beside a loading or error state would describe a list that is not shown |
| DV-4 | **Accepted.** A zero-error narrow `tsc` after the change leaves nothing to separate. On future slices, take the baseline first anyway; it costs one run |
| DV-5 | **Accepted.** The two failures were the `toBe(50)` pins this slice changes, not pre-existing reds |
| DV-6 | **Accepted, with one follow-up (O-1).** Keeping the last answer on screen during a same-code re-read avoids a flash on every save, but as built the panel then shows no busy state at all (`loading` is passed as `loading && !payload`, so `aria-busy` is false during the re-read) |

#### Code Review Comments

| # | Severity | Where | Finding | Fix |
|---|---|---|---|---|
| C-1 | **Medium** | `app/admin/exchange-rates/components/ExchangeRatesView.tsx:217-228` (line 223) | **A stale closure reopens a panel the admin has since closed or changed.** `saveRate` reads `openCode` from the render in which Save was clicked, and uses it **after** `await patch(...)`. The History buttons and "Show all currencies" stay enabled during a save (`ExchangeRatesTable.tsx:236-243` has no `disabled`). So, with the ILS panel open: edit a rate, Save, then click "Show all currencies" (or History for EUR) before the PATCH answers. When it answers, `loadCurrencyHistory('ILS')` takes a fresh counter number and reopens ILS over the admin's choice. The counter cannot stop this, because it is a new request | Keep the open code in a ref that follows state (for example `openCodeRef`, written wherever `currencyHistory` is set, or synced in an effect), and read `openCodeRef.current` **after** the `await` in `saveRate`. `refresh` runs synchronously on click and may keep `openCode`. Add a render test with a deferred PATCH: ILS panel open → Save → "Show all currencies" → resolve the PATCH → the panel stays closed and there is no second `?currency=ILS` GET. Add a variant that switches to EUR: EUR stays shown and ILS is not re-read |
| C-2 | **Medium** | `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx:453-485` | **The W-3 tests pass without the request counter.** Remove the checks at `ExchangeRatesView.tsx:129` and `:144` and all three still pass. (a) ILS → EUR and (b) Show all → a late ILS answer are both already blocked by `settle`'s `current.code === code` guard (line 130). (c) The unmount test asserts that `console.error` is never called, but React 18.3 no longer warns on a state update after unmount, so it cannot fail. The one case **only** the counter protects is untested: two reads for the **same** code in flight (Refresh twice, Refresh then a save re-read, or ILS → Show all → ILS), where the older answer lands last and overwrites the newer one | Add: ILS opened with deferred answer A → "Show all currencies" → ILS again with deferred answer B → resolve B, then A → B's rows stay shown. Make the unmount test observable: answer 500 after unmount and assert that the client logger's `Exchange rate history read failed` warn is **not** called (line 144 returns before it), or rename the test as a smoke check. Prove both by deleting the line 144 check locally and watching them fail (no commit) |
| C-3 | Low | `app/api/admin/exchange-rates/__tests__/route.test.ts:480-485` | The "exports only GET, runtime, dynamic" pin matches only `export (async) const\|function`. An `export { resolveLabels }`, `export class`, `export let` or `export default` would slip past it, yet still break the Next.js route type check | Collect every line matching `/^export\b/m` and assert there are exactly three, naming `GET`, `runtime` and `dynamic` (or add a negative match for `/^export\s+(\{\|default\|class\|let\|var)/m`) |

#### Optimisation Suggestions (non-blocking)

- **O-1 (DV-6):** pass the panel's in-flight state separately from "show the loading block" (for example `busy={currencyHistory.loading}` → `aria-busy` on `rate-history`), so a same-code re-read is announced without the flash.
- **O-2:** in `route.ts:135`, `failures.length > 0 || !names.rows || !emails.rows` is redundant; the last two clauses exist only for TypeScript narrowing. A short comment would save the next reader a double-take.
- **O-3:** the gate's child logger (`route.ts:169`) has no `correlationId`, because the id is created after the gate. This is the pre-existing 1a shape, shared with other admin routes. Do not change it in this slice.
- QA notes N-1 (requirement §8 wording per SA Q-1) and N-2 (stale render-test header comment) are endorsed. N-2 can ride with the C-2 edit to the same file.

#### Standards

`new-api-route` (gate first, Zod before any read, correlationId on the request logger, error format, `runtime` / `dynamic` unchanged) ✅. `new-repository` (no-throw `RepositoryResult`, documented service-role header, unit test pinning `.eq('currency_code')`, the order and the limit) ✅. `adminReadMethods.guard` passes unedited, because both calls sit in `app/api/admin/exchange-rates/route.ts` (SA-1c-6) ✅. Pino only, 0 `console.*` ✅. No entitlements import, LLM call, cron, tenant id or new column claim (SA-1c-8) ✅. No `any` introduced. Proportionate; no new pattern.

### Code Approved for QA: **Yes, conditional on C-1 and C-2** (C-3 and QA N-2 in the same pass). Dev fixes uncommitted, re-runs the §7.2 Jest set, and hands back the diff of `ExchangeRatesView.tsx` and the two test files. SA confirms by diff, and QA re-runs the page render suite, before RM.

---

## 10. QA Testing Report

**QA — 2026-10-19**
**Test mode:** full
**Strategy used:** A (Jest unit: rules module, repository) + B (Jest route tests with mocked repositories) + source guards; D (manual browser check) is owed by the user, see below
**Focus:** api, ui, security (name lookups, logs, query parse), guards
**Skipped:** live read-only check (no database / HTTP tool in this QA session); manual browser check (the user does it)
**Input source:** prompt keywords (TL brief) + workplan §7.2
**Verdict:** **PASS-WITH-NOTES** (no bug; three low notes)

### Test runs (worktree `neuronforge-fx-rates-1c`, uncommitted, `--ci`)

| Run | Result |
|---|---|
| §7.2 narrow set (12 paths) | **32 suites / 2,751 tests passed**, 0 failed (matches Dev's Step 9) |
| §7.2 set + `lib/audit/__tests__/eventAudience.test.ts` | **33 suites / 2,772 tests passed** (eventAudience 21 / 21) |
| CI-parity guards inside that run | `redundantPages.source.guard` (count 3 + W-4 planted control), `AdminSidebar.nav`, `layoutFolder.guard`, `KpiStrip.callers.pin` (5 Exchange rates hashes), `admin-authz-surface.guard`, `adminReadMethods.guard` (unedited), `finance.source.guard`, `app/admin/finance/__tests__/source.guard`, `eventAudience`: all green |
| CRLF check on the new source scans | The three `route.test.ts` source pins (requireAdmin first, exports only `GET`/`dynamic`/`runtime`, no own limit) re-run in a scratch script over the same `route.ts` normalised to LF and to CRLF: identical results (true / `GET,dynamic,runtime` / false). The redundantPages `FETCH_CALL` / `ALLOWED_FETCH` matchers have no line-ending dependence. All touched sources are CRLF, none mixed |
| KpiStrip pin scope | `git diff` touches only the header line, the type import, the Exchange rates fixtures, cases and hashes; `KpiStrip.tsx` unchanged. SHA-256 `8783c973…5dac`, blob `d4507d0f…` match §6.1 |

### Test Coverage (§8 slice 1c.1)

| Acceptance criterion | Tested? | Result | Test(s) |
|---|---|---|---|
| History at most 10, newest first; route test pins the limit, never from the request | ✅ | Pass | rules "the history limit has one value, 10"; repo `listRecentHistory` / `listRecentHistoryForCurrency` pin `.order(desc)` + `.limit(10)`; route "is the fixed constant 10, and a caller-supplied limit is a 400" + "never names a limit of its own" |
| `GET ?currency=XXX` returns that currency's newest 10 in its own payload type | ✅ | Pass | route "returns that currency's labelled history in its own payload: no rates"; exact-key test (`currencyCode, history, nameLookup, readAt`); repo pins `.eq('currency_code', 'ILS')` |
| Unknown key, repeated `currency`, bad code → 400, nothing read; valid code no row → 404 | ✅ | Pass | route `the query (SQ-12)` table (7 cases, `noRead()`), 404 case asserts no history and no name read |
| Name; else email (deactivated included); else "Unknown user"; one route test per case | ✅ | Pass | route "the name wins", "no name (missing or blank): the admin email, a deactivated admin included", "neither … Unknown user" |
| Null `changedBy` → "Unknown user" whether the lookup succeeded or failed | ✅ | Pass | route "a null changedBy is Unknown user and is never looked up"; every lookup-failure case carries a null-editor row asserted "Unknown user"; rules failed case; render "a row with no editor id" |
| Lookup fails → 200 with rates and history, page shows short id, failure logged, no name / email in any log | ✅ | Pass | route failure table (`rates` length 1, one error log); route SA-1c-7 logger spy over success, per-currency and failure; render "a failed name lookup shows the short id in the tile and the table" |
| All-or-nothing: any failure (returned or thrown, either source) → `failed`, every looked-up label null | ✅ | Pass | route table: names returned error / threw / returned no data, emails returned error / threw, both failed. See note N-1 on the requirement wording |
| Only the display label added; no other profile field; no id from the request | ✅ | Pass | route exact-key test of row and both payloads; "ids … de-duplicated, never from the request" |
| Exactly two tiles: Enabled N of X (USD counted), Last rate change (CODE A → B, who, when) or "No changes yet" | ✅ | Pass | render KPI block (two testids only, "3 of 4" with USD, "ILS 3.600000 → 3.650000", "by Anna Admin, 2025-11-05", "set to", "No changes yet"); KpiStrip pin cases |
| No Stale tile; Stale chip on every row older than 35 days; never USD | ✅ | Pass | render "marks stale rows in words; there is no Stale tile"; "the base currency is never stale" (2 cases) |
| KpiStrip pin: other hashes unchanged, Exchange rates per SQ-15, new cases appended | ✅ | Pass | pin suite green; diff scope checked by QA (above) |
| No arithmetic on a rate (D-5) | ✅ | Pass | render asserts the stored strings verbatim and no `%`; QA grep of the touched components and route for `parseFloat` / `Number(` / `toFixed` / rate operators: none |

### Edge-case probes

| Probe | Covered by | Result |
|---|---|---|
| `?currency=usd` (lower case) | route `?currency=ils` case (same regex path); rules `refuses "usd"` | 400, nothing read |
| `?currency=` (empty) | route "an empty code" | 400, nothing read |
| `?currency=EUR&currency=ILS` | route "a repeated currency" (`ILS&EUR`) and "the same code twice" | 400, nothing read |
| `?limit=5` | route `?limit=999` and `?currency=ILS&limit=50` (strict schema, same path for any value) | 400, nothing read |
| `?foo=1` | route "an unknown key"; also with a signed-out / non-admin caller → 401 / 403 first | 400 / 401 / 403, nothing read |
| Valid code, no row → 404, no history read | route 404 case | Pass |
| Valid code, no history | route W-5 case: 200, `history: []`, `nameLookup: 'ok'`, no lookup | Pass |
| Both name lookups failing | route "both failed" | 200, `failed`, labels null, one error log |
| One lookup throwing | route "names threw", "emails threw" + "names the failed source in the log" (`failed: ['emails']`) | Pass |
| Null `changedBy` | route + rules + render | "Unknown user"; never looked up |
| Deactivated admin with email, no name | route (`FORMER` has no profile name, email from `findEmailsByUserIds`) | email shown |
| "Last rate change" with no history | render "no history: No changes yet" + pin case | Pass |
| "Enabled currencies" counts USD; null `is_enabled` is disabled | render "3 of 4" (USD enabled, counted); repo "is_enabled null reads as false"; route happy path maps `is_enabled: null` → `isEnabled: false`; KPI counts `isEnabled === true` only | Pass (covered across the wire mapping + render, not in one test) |
| Caption at exactly 10 vs fewer | render "at the cap: The newest 10 changes", "below the cap: 1 change, newest first", and both one-currency forms ("ILS: 2 changes…", "EUR: The newest 10 changes") | Pass |

No real gap found, so no test was added.

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues

None. The name lookups run only when there are editor ids (one `Promise.all`, no lookup for an empty or all-null history); a 404 reads no history.

#### Edge Cases / notes (nice to fix)

1. **N-1 (docs, Low):** requirement §8 1c.1 still says any lookup failure gives "**every** `changedByLabel` null". As built (SA Q-1), a null-`changedBy` row keeps "Unknown user" on failure. SA asked BA / TL to reword it to "every label of a looked-up editor null"; not yet done in `docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md`.
2. **N-2 (comment, Low):** `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx` header (lines 5-7) still lists "the stale chip and the stale KPI" among the 1a cases; the Stale KPI no longer exists (the 1c.1 paragraph below it is correct).
3. **N-3 (observation, no action):** the "Enabled currencies treats null `is_enabled` as disabled" rule is proven in two hops (repository mapper null → false; KPI counts `=== true`), not by one render test with a null. Adequate, since the wire type is `boolean`.

### Live check

Skipped: no database or HTTP tool was available in this QA session. Nothing was run against any environment.

### Manual browser check (owed by the user)

On `/admin/exchange-rates` (desktop), after deploy or in local dev: (1) two KPI tiles only, "Enabled currencies" N of X and "Last rate change" with a name (or email), no Stale tile; (2) Stale chips still on old rows, never on USD; (3) history shows at most 10 rows with the right caption; (4) a row's History button shows "CODE: …" with that currency's own changes, and "Show all currencies" returns; (5) "Changed by" shows names, with the id as hover text. The user does this check.

### Final Status

- [x] All acceptance criteria pass — ready for commit once SA code review clears (no bug; notes N-1 and N-2 are low and non-blocking)
- [ ] Issues found — Dev must address before commit

---

## 11. Commit Info

*(RM populates.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Created | Dev workplan for slice 1c.1 (history cap 10, `?currency=` read, admin names, two KPI tiles, guard count 2 → 3). Scope quoted verbatim with `sed` from the requirement (§1 1c row, §3.3, §5.5.3 to §5.5.5 plus one §5.5.6 bullet, FR-18 to FR-22 plus FR-8, §8 1c.1, all of §13.4). Pin file SHA-256 and blob id recorded. Three questions for SA (Q-1 to Q-3). Awaiting SA workplan review |
| 2026-10-19 | SA workplan review | **APPROVED-WITH-CHANGES** (§9). Q-1: the wire labels a null-`changedBy` row "Unknown user" even when the lookup failed; "every label null" covers looked-up editors only. Q-2: archiving-form captions; the cap wording appears only at the cap (amends SA-1c-4). Q-3: accepted; re-read on rate save and Refresh only, panel-local error. Design confirmed: type split, private non-exported `resolveLabels` in `route.ts`, pure `labelHistory`, 400 → 404 order, stale-answer drop, SQ-15 re-pin, fetch count 3 with planted control. Build-time changes W-1 (mapper renamed `toExchangeRateHistoryRecord`) to W-6 |
| 2026-10-19 | Implemented | Slice 1c.1 built uncommitted per the SA-approved plan with Q-1 to Q-3 and W-1 to W-6 (§6.1). Narrow Jest 32 suites / 2,751 tests passed; narrow `tsc` 0 errors; `eslint` and `lint:hooks` clean. KpiStrip pin re-pinned per SQ-15 (new SHA-256 `8783c973…`, blob `d4507d0f…`). Deviations DV-1 to DV-6 recorded. Awaiting SA code review |
| 2026-10-19 | QA | **PASS-WITH-NOTES** (§10). §7.2 set `--ci` 32 suites / 2,751 tests passed; with `eventAudience` 33 / 2,772. All §8 1c.1 criteria mapped to tests; 14 edge probes covered; CI-parity guards green; CRLF / LF parity of the new source scans confirmed. No bug, no test added. Notes: N-1 requirement §8 wording (SA Q-1) not yet updated; N-2 stale render-test header comment. Live check skipped (no tool); manual browser check owed by the user |
| 2026-10-19 | SA code review | **APPROVED-WITH-CHANGES** (§9, "SA code review"). Every TL check passes: gate first, query order, private `resolveLabels`, all-or-nothing labels, no PII in logs, type split, fetch count 3 with two-way planted control, pin diff scoped to Exchange rates, KPIs from the plain payload, no rate arithmetic (D-5), error format, hooks. DV-1 to DV-6 accepted (DV-6 with O-1). Required before commit: C-1 (Medium) a stale `openCode` closure in `saveRate` reopens a panel closed during a save; C-2 (Medium) the W-3 tests pass without the request counter, so a same-code race and an observable unmount test are needed; C-3 (Low) the route-exports pin is too narrow. SA confirms the fix by diff; QA re-runs the render suite |
| 2026-10-20 | SA code review fixes | F-1 (C-1) `openCodeRef` read after the save's await; F-2 (C-2) single answer gate, `act`-wrapped late answers, same-currency race and observable unmount tests, both proven to fail with the gate removed; F-3 (C-3) every `export` line counted; F-4 (O-1) `busy` prop for `aria-busy`; F-5 (O-2) narrowing comment. Narrow Jest 32 / 2,756 passed; eslint and tsc clean. Uncommitted |
