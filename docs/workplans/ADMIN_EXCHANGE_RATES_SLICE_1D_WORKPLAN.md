# Workplan: Admin Exchange Rates — Slice 1d (History window)

> **Last Updated**: 2026-10-21

**Developer:** Dev
**Requirement:** [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md) — §1 row 1d, D-8, §5.6, FR-28 to FR-34, §8 slice 1d, §13.6
**Branch:** `feature/admin-exchange-rates-1d-history-window` (worktree `neuronforge-fx-1d`, from `origin/main` `930a6cee`)
**Date:** 2026-10-20
**Status:** Code Complete (uncommitted; awaiting SA code review and QA)
**Workplan review:** none. SA ruled the §13.6 step list detailed enough to build from (§13.6 verdict).

## Overview

Slice 1d adds a Window control (Today, 7 days, 30 days, This month, Custom; default This month) above the Exchange rates history table. The history table and the per-currency History view then show the newest 10 rate changes inside the window, selected on the server. The "Last rate change" KPI tile stays all-time through a new `lastChange` field on the plain `GET`. The window lives in page state only (no URL key, no Finance edit). No migration, no new `fetch(` site, no Finance file change. The build follows the SA's §13.6 Dev steps 0 to 10 exactly; they are the task list below, and the source text is quoted verbatim at the end of this document.

## Table of Contents

1. [Task list](#task-list)
2. [Questions for SA](#questions-for-sa)
3. [Deviations](#deviations)
4. [Checks](#checks)
5. [Verbatim source](#verbatim-source)
6. [SA Review Notes](#sa-review-notes)
7. [QA Testing Report](#qa-testing-report)
8. [Commit Info](#commit-info)
9. [Change History](#change-history)

---

## Task list

| # | Step (§13.6) | Files | Status |
|---|---|---|---|
| 0 | Branch and baseline: narrow Jest once before editing | — | ✅ |
| 1 | Rules: the query (`HISTORY_DEFAULT_PRESET`, `HISTORY_WINDOW_MIN_DATE` / `HISTORY_WINDOW_MAX_DATE`, strict schema + `superRefine`, `HistoryWindowDates`) | `lib/admin/exchangeRates/exchangeRateRules.ts` | ✅ |
| 2 | Rules: `historyWindowBounds`, `defaultHistoryWindowDates`, `ExchangeRatesPayload.lastChange` | `lib/admin/exchangeRates/exchangeRateRules.ts` | ✅ |
| 3 | Repository: windowed reads, `findLatestChange()` (`nullsFirst: false`), header line reworded | `lib/repositories/ExchangeRatesRepository.ts` | ✅ |
| 4 | Page helper (new, pure): `HISTORY_DEFAULT_WINDOW`, `historyWindowDates`, `historyWindowParams`, `historyPeriodText` | `app/admin/exchange-rates/historyWindow.ts` | ✅ |
| 5 | Route: dates from query or default, bounds, three parallel reads, `resolveLookup` once over both lists, header | `app/api/admin/exchange-rates/route.ts` | ✅ |
| 6 | View: window state + ref, plain-read counter (SA-1d-1), shown windows (SA-1d-2), `changeHistoryWindow` (SA-1d-6, SQ-34), header | `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | ✅ |
| 7 | Presentational: `DatePresets` in `RateHistoryTable` (SA-1d-5), period captions and empty messages, KPI tile from `lastChange`, `KpiStrip.callers.pin` fixtures + one header line | `RateHistoryTable.tsx`, `ExchangeRatesKpis.tsx`, `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` | ✅ |
| 8 | Tests new and amended (rules, helper, repository, route, the two rates render suites, `describe('slice 1d')` tests 1 to 13) | see step 8 quote | ✅ |
| 9 | Must stay unedited and green (Finance, layout sources, guards, PATCH route; no migration / package change) | — | ✅ |
| 10 | Checks: narrow Jest, narrow `tsc`, `eslint`, `lint:hooks`, `git diff --stat` / `--numstat` | — | ✅ |

## Questions for SA

No ruling is disputed; every ruling in §13.6 is followed as written. One wording point for SA / BA, not a disagreement:

| # | Question | What Dev did |
|---|---|---|
| Q-1 | §8 slice 1d says "the caption names the period in every state". `RateHistoryTable` has never shown the count line while loading, on an error, or over the empty state, and §13.6 step 7 does not change that. Is "every state" meant literally, or as "every caption and empty message"? | Followed step 7: the count line still shows only over rows (with the period); the empty messages are the FR-33 wording ("in this period"), and the Window control, which shows the pressed window, is visible in every state (SA-1d-5). If the criterion is literal, it is a one-line change in `RateHistoryTable` |

## Deviations

| # | Deviation | Why |
|---|---|---|
| DV-1 | `route.test.ts` "only null editors: no lookup at all" also sets `findLatestChange` to a row with a null editor. Not in the SA's forced-edit list | The default `findLatestChange` mock (step 8, in `beforeEach`) returns a row edited by `ADMIN`, and the single lookup now covers `lastChange` (SQ-31), so the test's "no editor, no lookup" premise needed `lastChange` to have no editor too. Its meaning is unchanged |
| DV-2 | `exchangeRates.render.test.tsx`: the four KPI tests that set `history` to drive the tile (old rate null, no history, failed lookup, no editor) also set `lastChange` | Forced by SA-1c-2 as amended (the tile reads `lastChange`). Covered by "fixtures gain `lastChange`", but the four in-test overrides were not listed by line |
| DV-3 | `exchangeRates.render.test.tsx` `stubFetch`: the plain-GET answer may be a promise (`await get()`) | Needed for test 7 (the race), so the first window's answer can be released after the second's. Existing callers are unchanged |
| DV-4 | Step 8 test 9 is two tests: 9a (Enabled currencies, rates count, Show and Search identical under every window) and 9b (a held row is released by a window change) | 9b needs a server whose state changes after the switch, which would make 9a's "identical" check depend on it |
| DV-5 | Step 7 calls the pin `KpiStrip.callers.pin`; the file is `KpiStrip.callers.pin.render.test.tsx` | Naming only |
| DV-6 | `route.test.ts` already fakes the clock for every test (`beforeEach`, `NOW` = 2026-10-19). The "no query → This month" test sets its own clock (`2026-12-31T23:59:59.999Z`, so the bound crosses a year end) inside the test and restores real timers in `finally` | Step 8 asks for `jest.useFakeTimers({ now })` in that test only; the file-wide clock already existed, so the test uses a different `now` to stay meaningful |
| DV-7 | In the verbatim quotes below, heading markers are one or two levels deeper than in the requirement; the text is unchanged | Keeps this document's heading tree and ToC valid |
| DV-8 | Tests beyond the step 8 list: "an empty window still sends the all-time `lastChange`", "no history at all → `lastChange` null, nothing looked up", "an editor in both lists is looked up once", "a `findLatestChange` thrown error is a 500", "a `to` after today is accepted", year-0 / year-9999 400s, and the rules-level `defaultHistoryWindowDates` cases | Cheap coverage of SQ-26, SQ-31 and SA-1d-3 edges; nothing removed |

Mutation check (not committed): removing the SA-1d-1 counter gate in `load` and the SA-1d-6 no-op made exactly two slice 1d tests fail (7 and 10), so both are non-vacuous. The source was restored and the full suite re-run green.

## Checks

| Check | Result |
|---|---|
| Baseline (step 0, before any edit): narrow Jest set | 79 suites, 2,912 tests passed |
| Narrow Jest set after the build (step 10 paths) | **80 suites, 3,010 tests passed** (+1 suite `historyWindow.test.ts`, +98 tests) |
| Narrow `tsc` (scratch tsconfig extending the root one; the 15 touched sources and tests, plus `FinanceView.tsx` and `exchangeRatesTab.render.test.tsx`) | 0 errors |
| `eslint` on the 14 touched `.ts` / `.tsx` files | clean |
| `npm run lint:hooks` | clean |
| `redundantPages` G-6 `fetch(` sites in `app/admin/exchange-rates/` | 3 (both GETs take template literals starting `` `/api/admin/exchange-rates? ``) |
| `console.*` in the touched sources | 0 in all seven |
| `KpiStrip.callers.pin`: hash or case lines changed | none (fixtures gain `lastChange`, one header line added) |
| Files under `app/admin/finance/**`, `lib/business-os/finance/**`, `app/admin/components/layout/**` sources, the `[currencyCode]` PATCH route, migrations, `package.json`, lockfile | unchanged |
| `git diff --numstat` | no deletion-only file |

---

## Verbatim source

Copied with `sed` from the requirement at the time this workplan was written. Do not edit these quotes; the requirement is the source of truth.

### §1 Progress, row 1d

| # | Slice | Status | PR | Notes |
|---|---|---|---|---|
| 1d | History window (D-8): a Window control above the history table (Today / 7 days / 30 days / This month / Custom, default **This month**); the history table and the per-currency History view show the newest 10 rate changes **inside the window**, filtered on the server; the "Last rate change" tile stays **all-time** (new `lastChange` field on the plain `GET`). FR-28 to FR-34 | 🟡 BA draft 2026-10-20. **SA cleared with changes 2026-10-20 (§13.6)**: Dev builds from the §13.6 step list, no separate workplan review | — | User request 2026-10-20 (D-8). Reuses `DatePresets` and `adminWindow.ts` / `adminWindowPresets.ts`. Route `GET` + repository + view; **no migration** (`idx_exchange_rate_history_changed_at` exists, `20261082`). Branches from `origin/main` (2a #486 and 2b #487 merged). Cycle: TL picks; BA suggests full cycle (the route's query and payload change) |

### D-8 (user decision, verbatim)

| # | Topic | Decision | Source (verbatim) | Consequence for this requirement |
|---|---|---|---|---|
| D-8 | History window | The history table shows the **newest 10 rate changes within a chosen period**. A **Window** control like the Finance page's (Today / 7 days / 30 days / This month / Custom) sits **above the history table**, default **This month**. The window filters **the history table and the per-currency History view only**; the **"Last rate change" tile stays all-time** | Request: "add another small change, the history table, needs to show the last 10 changes within a define period. in the main finance page we have a filter like the picture attached, let's have a similar filter above the history exchange rate, where default is "This Month". meaning, last 10 new changes this month." Follow-up: "Go ahead. The window filters the history table and the per-currency History view only. The Last rate change tile stays all-time." (both 2026-10-20) | New slice 1d (§5.6). Amends FR-18 (newest 10 **in the window**) and SA-1c-2's KPI source (`history[0]` → a separate all-time `lastChange`). The picture's note "Only accounts with a business profile can be found by name" belongs to Finance's business picker and does not apply: the history control has no business picker. The rates table, the Show / Search filter and the "Enabled currencies" tile are unchanged |

### §5.6

#### 5.6 Slice 1d — History window (D-8)

The user's 2026-10-20 request (D-8, verbatim in §3): the history shows the newest 10 rate changes **within a chosen period**, picked with a Window control like the Finance page's, default **This month**. The window applies to the history table and the per-currency History view only; the "Last rate change" tile stays all-time. Code facts below were read from `origin/main` `930a6cee` (2a #486 and 2b #487 merged, so the view renders inside Finance's Exchange rates tab). No table, column, migration or write path is added; the `PATCH` route, the audit entries and the 1b lockdown are untouched. D-5 holds: nothing converts or totals money.

##### 5.6.1 What exists to reuse

| Piece | Today |
|---|---|
| `app/admin/components/layout/DatePresets.tsx` | The Admin Layout Standard Window control (C-8, §5.5 parts 1 and 2): labelled group "Window" with Today, 7 days, 30 days, This month, Custom; the Custom row has From (UTC) / To (UTC) whole-date inputs and Apply. A preset applies at once; clicking the pressed preset goes back to `defaultValue`; Apply with both empty goes back to the default; only "From after To" is refused here. Props: `value`, `defaultValue`, `onChange`, optional `extras`, optional `requireBothDates`. Exports `ADMIN_FIELD_LABEL`, `ADMIN_FIELD_CONTROL`, `AdminFieldSpacer` |
| `app/admin/components/layout/adminWindow.ts` | Pure. `AdminWindowValue` (`none` / `preset` / `custom` / `linked` / `extra`), `windowFilter()` owning the URL keys `range` / `from` / `to`, `parseWindow`, `serialiseWindow`, `windowEquals`, `resolveWindow(value, now)` → whole UTC dates, `ADMIN_WINDOW_LABELS` ("Today", "7 days", "30 days", "This month", "Custom") |
| `app/admin/components/adminWindowPresets.ts` | Pure and isomorphic (page and route both import it). `ADMIN_WINDOW_PRESETS` = `today`, `7d`, `30d`, `this_month`; `resolveAdminWindow(preset, now)` → inclusive UTC dates (`this_month` = the 1st of the current UTC month to today; `7d` / `30d` include today); `isRealDate`, `todayUtc`, `inclusiveDays`, `customRangeProblem` (from ≤ to, to not after today UTC, at most `ADMIN_WINDOW_MAX_DAYS` = 92 inclusive days). Its header: "the route re-resolves the preset with its own clock, so the URL is input, never authority" |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | Three literal `fetch(` sites: plain `GET` (rates, newest 10 changes, `readAt`), `GET ?currency=<CODE>` (the open panel), `PATCH /<CODE>`. KPIs and the overall history come from the plain `GET`; the per-currency read feeds the history panel only (SA-1c-2) and is re-run after a rate save and on Refresh. The history (`RateHistoryTable`) renders below the rates table, inside `exchange-rates-content` |
| `app/admin/exchange-rates/components/RateHistoryTable.tsx` | Caption "The newest {HISTORY_LIMIT} changes" when the list reached the cap, else "{n} change(s), newest first"; per-currency prefix "{CODE}: ". Empty: "No rate changes recorded yet." / "No recent rate changes for {CODE}." |
| `app/admin/exchange-rates/components/ExchangeRatesKpis.tsx` | "Last rate change" = `payload.history[0]` (line 57). **Once the history is windowed, `history[0]` is the newest change in the window, not of all time** (see §5.6.3) |
| `app/api/admin/exchange-rates/route.ts` | `requireAdmin` first; repeated query key → 400; `exchangeRatesQuerySchema` = `z.object({ currency: currencyCodeSchema.optional() }).strict()`, so any other key → 400; unknown code → 404; `resolveLabels` names editors, all-or-nothing |
| `lib/repositories/ExchangeRatesRepository.ts` | `listRecentHistory()` and `listRecentHistoryForCurrency(code)`: `.order('changed_at', { ascending: false }).limit(EXCHANGE_RATE_HISTORY_LIMIT)` |
| `lib/admin/exchangeRates/exchangeRateRules.ts` | `HISTORY_LIMIT = 10`, the one source (fixed, never caller-supplied) |
| Index | `idx_exchange_rate_history_changed_at` (btree on `changed_at`), recorded in `20261082`. No migration needed |

##### 5.6.2 The Window control

| Part | Spec |
|---|---|
| Place | **Directly above the history table**, not in the top filter bar (the user: "above the history exchange rate"). One control for both history views: the overall list and the per-currency panel (they are never shown together) |
| Control | The shared `DatePresets`, unchanged: Today, 7 days, 30 days, This month, Custom (From (UTC) / To (UTC), Apply). No `extras`. No business picker (Finance's "Only accounts with a business profile…" note does not apply). `DatePresets.tsx`, `adminWindow.ts` and `adminWindowPresets.ts` are **not edited** |
| Default | **This month** (`{ kind: 'preset', preset: 'this_month' }`). Clicking the pressed preset goes back to This month (the control's own rule) |
| Time zone | UTC, like every admin window (SQ-29) |
| State | Page state of the view, not the address bar (BA default, SQ-25) |
| What it filters | The overall history list and the per-currency History view. **Not** the rates table, **not** the Show / Search filter, **not** either KPI tile |
| Read at / Refresh | Unchanged (the top bar). Refresh re-reads with the window that is applied |

##### 5.6.3 Server-side filtering and the all-time "Last rate change"

- **The window is applied on the server.** The plain `GET` and the per-currency `GET` take the window and return the **newest `HISTORY_LIMIT` (10) changes with `changed_at` inside it**, newest first. They never return the newest 10 overall for the page to trim: a window holding 3 changes shows those 3, and a window holding 40 shows its newest 10.
- **Window bounds:** the inclusive UTC dates `from`..`to` mean `changed_at >= from 00:00:00Z` and `changed_at < (to + 1 day) 00:00:00Z` (SQ-28). The repository applies `.gte` / `.lt` on `changed_at`, the existing order and the fixed limit; the existing index serves it.
- **"Last rate change" stays all-time (D-8).** Today the tile reads `history[0]`; after this slice `history` is windowed, so the plain `GET` returns the all-time newest change **separately**, as a new field `lastChange: ExchangeRateHistoryWire | null` (null when there is no history at all). The tile reads `lastChange`, never `history[0]`. **Flagged for SA (SQ-31):** this amends SA-1c-2 ("Last rate change" = `history[0]`). BA suggestion: a repository read of the newest one row (`limit(1)`, no window), and the label lookup covers its editor too (at most 11 distinct ids, still one `.in()` per source, the same all-or-nothing rule).
- `lastChange` is on the **plain** `GET` only. The per-currency payload (`ExchangeRateHistoryPayload`) does not carry it, so the tile can still never be fed from it (SA-1c-2).
- The rates and the "Enabled currencies" tile are unchanged.

##### 5.6.4 Captions and empty states

Captions **name the period**, so an admin never reads a windowed list as "all history".

| View | Caption (BA wording; Dev may adjust words, not meaning) |
|---|---|
| Overall, list at the cap | "The newest 10 changes this month" / "… today" / "… in the last 7 days" / "… in the last 30 days" / "… from 2026-10-01 to 2026-10-15 (UTC)" |
| Overall, below the cap | "3 changes this month, newest first" (same period wording) |
| Per currency | Prefixed "ILS: ", e.g. "ILS: 2 changes this month, newest first" |
| Empty, overall | "No rate changes in this period." |
| Empty, per currency | "No rate changes for ILS in this period." |

The cap in the caption comes from `HISTORY_LIMIT`, never a literal (SA-1c-4). The period wording comes from one pure helper keyed by the window value, so the two views cannot disagree.

##### 5.6.5 Behaviour details

- A window change re-reads the history for the visible view: the per-currency read when a panel is open, else the plain read (SQ-34).
- After a rate save, the re-reads that already happen (SA Q-3) carry the applied window.
- Leaving the Exchange rates tab and coming back starts again at This month (Finance unmounts hidden panels; SQ-30).
- A refused custom range (From after To) is shown by the control itself and sends nothing.

##### 5.6.6 Unchanged by 1d

- No migration, table, column or index. `PATCH`, audit events, the 1b lockdown, `HISTORY_LIMIT` (still 10), the name-lookup rules (SQ-13) and `UNKNOWN_USER_LABEL`.
- The rates table, the Show / Search filter (`currencies`), held rows (SQ-9), the "Enabled currencies" tile.
- `DatePresets.tsx`, `adminWindow.ts`, `adminWindowPresets.ts`, `useAdminFilters.ts`: reused, not edited.
- Finance: no file under `app/admin/finance/` changes; `FINANCE_FILTER_SPEC`, `financeFilterRepair`, the finance request string and `financeRequest.pin` are untouched (if SQ-25 is ruled as BA suggests). `finance.source.guard` and CUR-3 unchanged.
- `redundantPages` G-6: the folder's literal `fetch(` count stays **3** (the two `GET` sites gain query parameters; no new call site; SQ-33).
- D-5, D-6: nothing converts money; no sidebar change.

### FR-28 to FR-34

| # | Requirement | Slice |
|---|---|---|
| FR-28 | A Window control (the shared `DatePresets`: Today, 7 days, 30 days, This month, Custom with From (UTC) / To (UTC) and Apply) sits directly above the history table; default **This month**; UTC (D-8, §5.6.2) | 1d |
| FR-29 | The history table shows the newest **10** rate changes whose `changed_at` lies **inside the window**, newest first, selected **on the server** (never the newest 10 overall trimmed in the page). Amends FR-18 | 1d |
| FR-30 | The per-currency History view follows the same window, with the same server-side rule | 1d |
| FR-31 | The "Last rate change" tile stays **all-time**: it reads a separate all-time `lastChange` from the plain `GET`, never the windowed list. Amends SA-1c-2 (SQ-31) | 1d |
| FR-32 | Captions name the period ("this month", "today", "in the last 7 days", "in the last 30 days", "from A to B (UTC)"), overall and per currency; the cap comes from `HISTORY_LIMIT` | 1d |
| FR-33 | An empty window shows "No rate changes in this period." (per currency: "No rate changes for {CODE} in this period.") | 1d |
| FR-34 | The window does not affect the rates table, the Show / Search filter or the "Enabled currencies" tile | 1d |

### §8 Slice 1d


- [ ] On `/admin/finance?tab=exchange-rates` a Window control (Today, 7 days, 30 days, This month, Custom) sits directly above the history table, with **This month** pressed on first open.
- [ ] Under This month the history shows only changes dated this UTC month, at most 10, newest first. A route test with more than 10 rows in the window and more outside it proves the 10 returned are the **newest 10 inside the window** (the selection is on the server, not trimmed in the page).
- [ ] Today, 7 days and 30 days each narrow the list as `resolveAdminWindow` defines them (UTC, including today); Custom with From / To applies whole UTC dates with an inclusive end (a change at `to` 23:59:59Z is in, one at `to + 1` 00:00:00Z is out).
- [ ] Opening a currency's History shows that currency's newest 10 changes **in the same window**; changing the window while the panel is open re-reads that currency's history.
- [ ] The "Last rate change" tile shows the **all-time** newest change whatever the window: with no change this month it still shows the last change (e.g. from a previous month), never "No changes yet" while history exists. It reads `lastChange`, never `history[0]` (render test with a window that excludes the newest change).
- [ ] `lastChange` is on the plain `GET` only; the per-currency payload has no `lastChange`. Its editor gets a label under the same all-or-nothing name lookup (SQ-13).
- [ ] An empty window shows "No rate changes in this period." (per currency: "No rate changes for {CODE} in this period."); the caption names the period in every state.
- [ ] Query validation per the SQ-26 ruling: a bad, one-sided or reversed window, an unknown key or a repeated key → **400**, nothing read; the history limit is still the constant 10 and never comes from the request.
- [ ] The rates table, Show / Search, held rows and "Enabled currencies" behave exactly as before under every window (render test).
- [ ] Per the SQ-25 ruling: switching the history window writes nothing to the address bar (BA default), and the Finance request string on the tab is unchanged (`financeRequest.pin` green unedited).
- [ ] Leaving the tab and coming back shows This month again (SQ-30).
- [ ] `redundantPages` G-6 `fetch(` count still **3**; `KpiStrip.callers.pin` per the SQ-31 / SQ-32 ruling (BA expects no hash to move); no file under `app/admin/finance/` or `lib/business-os/finance/` changes; no migration.
- [ ] Nothing does arithmetic on a rate (D-5).

### §13.6 SA review — slice 1d (all of it)


**Reviewed by SA — 2026-10-20.** This is a requirement review of the §1 1d row, D-8, §5.6, FR-28 to FR-34, the §8 slice 1d criteria, the §12 1d rows, and SQ-25 to SQ-34. Code was read from `feature/admin-exchange-rates-1d-history-window` at `origin/main` `930a6cee`.

**Verdict: CLEARED-WITH-CHANGES. Dev builds from the step list below; there is no separate workplan review.** The slice is proportionate. It adds no table, migration, write path, dependency or new fetch site. It reuses the shared Window control and the admin window helpers unedited, and it keeps every Finance file untouched.

Two BA proposals change:
- **SQ-34.** A window change re-reads what Refresh re-reads, not the panel only. Otherwise the overall list behind an open panel goes stale.
- **SQ-32.** No new pin case.

Four gaps the BA did not list are added: SA-1d-1 to SA-1d-4. They cover a request race on the plain read, the caption naming the window the rows were read under, a date range that would otherwise reach Postgres as a 500, and the ordering of a null `changed_at`.

**Not split.** A server-only half would either ship a windowed list with no control and no period caption, or need a temporary all-time default that is then reversed. The slice is one feature over six source files.

**Cycle:** full cycle. The route's query and payload change.

**User decisions, not reopened (D-8):**
- The control has the same five presets, defaults to This month, and shows the newest 10 in the window.
- It filters the history table and the per-currency History view only.
- "Last rate change" stays all-time.

**Verified against the code:**

| Claim | Result |
|---|---|
| `DatePresets` props and rules (§5.6.1) | ✅ `app/admin/components/layout/DatePresets.tsx`: `value`, `defaultValue`, `onChange`, `extras`, `requireBothDates`. A preset applies at once. A second click on the pressed preset calls `onChange(defaultValue)`, so with the default This month pressed it calls `onChange` with an **equal** value (SA-1d-6). "Custom" only opens the row. With `requireBothDates`, Apply stays disabled until both dates are set. Only "From after To" is refused. The type still allows `{ kind: 'custom', from: null }`, so the page's helper must narrow (step 4). **No page imports `DatePresets` directly today.** Every caller goes through `AdminFilterBar`'s `windowControl`. No guard forbids a direct import (`layoutFolder.guard` lists the file and has no import rule for it). See SA-1d-5 |
| `resolveWindow` / `resolveAdminWindow` / `isRealDate`, UTC | ✅ `adminWindow.ts` `resolveWindow(value, now)` maps `preset` through `resolveAdminWindow` and returns `custom` as given. `adminWindowPresets.ts` is UTC throughout (`Date.UTC`, `getUTC*`). `this_month` runs from the 1st to today; `7d` / `30d` include today. `isRealDate` checks the pattern and the round-trip, so it refuses `2026-02-30` and `''`. It **accepts** `0000-01-01` and `9999-12-31` (SA-1d-3). `customRangeProblem` is **not** reusable here: it refuses a `to` after today and anything over 92 days, neither of which this slice wants (SQ-26) |
| Finance owns `range` / `from` / `to` on the tab (SQ-25) | ✅ `FinanceView.tsx:151` `useAdminFilters(FINANCE_FILTER_SPEC)` is unconditional, with no `active` option, so it is mounted on the Exchange rates tab. `financeFilters.ts:116-119`: `window: windowFilter(...)` with alias `preset` → `range`, so it owns `range`, `from`, `to` and reads `preset`. A history window in the URL would be parsed as Finance's window and would change the finance request string. Finance's filter bar is not rendered on the tab (SQ-19 (i)), so the history control is the only group named "Window" on screen |
| Panels unmount (SQ-30) | ✅ As ruled in §13.5 (SQ-20 / SQ-19). `ExchangeRatesView` exists only while its tab is selected, so its page state starts at the default on every visit and on reload |
| Strict query schema | ✅ `exchangeRateRules.ts` `exchangeRatesQuerySchema = z.object({ currency: currencyCodeSchema.optional() }).strict()`. The route refuses a repeated key **before** the parse (`params.getAll(key).length > 1`), then parses `Object.fromEntries(params)`. Adding `.superRefine` turns it into a `ZodEffects`; `safeParse` and `query.data.currency` still work |
| Repository history reads | ✅ `listRecentHistory()` and `listRecentHistoryForCurrency(code)` select `HISTORY_COLUMNS`, `.order('changed_at', { ascending: false }).limit(EXCHANGE_RATE_HISTORY_LIMIT)`. Neither takes a window today. The header promises "No method accepts a caller-supplied filter … or limit" and must be reworded (step 3). `changed_at` is `timestamp with time zone DEFAULT now()` and **nullable** (`20261082` line 116). The trigger always sets `NOW()`, but `ExchangeRateHistoryRow.changed_at` is typed `string` (SA-1d-4). Index `idx_exchange_rate_history_changed_at` exists (line 126) |
| `nameLookup` | ✅ `route.ts` `resolveLabels(records)` takes the ids from `historyEditorIds(records)` (distinct, non-null). It runs both sources in parallel through `settle` (returned and thrown errors are the same failure), and any failure gives `labelHistory(records, { status: 'failed' })`. It returns already-labelled rows, so as written a second list (`lastChange`) would need a second lookup and could disagree with the first. Step 5 splits it into "resolve once" and "label each list" |
| `KpiStrip.callers.pin` (SQ-32) | ✅ Five `ExchangeRatesKpis` cases (lines 294-298, hashes 359-363). The fixtures (`FX_PAYLOAD` and the three spreads, lines 209-217) are typed `ExchangeRatesPayload`, and Jest runs `ts-jest`, so a required `lastChange` **must** be added to them. The tile reads only `lastChange`, so with `lastChange` equal to today's `history[0]` (`null` for no history) the HTML, and so **every hash, is unchanged**. `KpiStrip.tsx` is not touched. With a payload present, `loading` does not swap the tiles for placeholders (line 54), so a window re-read does not flicker the strip |
| `redundantPages` G-6 (SQ-33) | ✅ `` ALLOWED_FETCH = /^\s*(['"`])\/api\/admin\/exchange-rates(['"`/?]\|\$\{)/ `` (guard line 128; the table cell escapes the `\|`). A template literal `` `/api/admin/exchange-rates?${…}` `` passes on the `?` branch. The per-currency site already does. `fetchCount` counts literal `fetch(` sites, so the count stays **3** when both GET sites gain parameters in place. The `\$\{` branch would also pass `` `/api/admin/exchange-rates${suffix}` ``; that form is still forbidden by the SQ-12 ruling (step 6) |
| Held rows vs re-reads (SQ-9, SQ-34) | ✅ `ExchangeRatesView.tsx`: `refresh()` empties the held set **before** its reads, and `load()` empties it on every successful plain read. `load` is `useCallback([])` with **no request counter**, so only the one-currency read has one (`historyRequest`, SA W-3). Two quick window changes could therefore let an older plain answer land last (SA-1d-1) |
| SQ-27 precedent | ✅ The layout-standard pages resolve on the client and send dates: `costsFilters.ts` `costsRouteSearch` and `activityFilters.ts` `activityRouteSearch` send `from` / `to` as whole dates. The AI activity route (`app/api/admin/business-os/ai-activity/route.ts`) takes `from` / `to` `YYYY-MM-DD`, strict. Audit trail and Analytics also send resolved bounds. Finance is the exception: its route takes `preset` and re-resolves with its own clock, because its money aggregates must not trust a client clock. A `lib/` module importing the pure `adminWindowPresets.ts` has precedent too (`lib/business-os/finance/dueDates.ts:20`) |
| Forced test edits (not listed by BA) | ⚠️ Exact-URL matchers break once the GETs carry parameters: `exchangeRates.render.test.tsx` lines 171, 347, 565, 580, and `exchangeRatesFilters.render.test.tsx:143`. Caption assertions using `toHaveTextContent` (a substring match) break on the new period wording: `exchangeRates.render.test.tsx` lines 444, 451, 459, 462, 475, 511, 589. The route-test repository mock drops arguments (`listRecentHistory: () => listRecentHistory()`, line 54). `app/admin/finance/__tests__/exchangeRatesTab.render.test.tsx` matches with `startsWith(RATES_PATH)`, types its payload `unknown` and asserts only that `kpi-last-rate-change` exists, so it stays green **unedited** |

##### Rulings

| # | Ruling |
|---|---|
| SQ-25 | **Accepted: page state only.** `useState<AdminWindowValue>` in `ExchangeRatesView`, default `HISTORY_DEFAULT_WINDOW` (step 4). No URL key. No edit to `FINANCE_FILTER_SPEC`, `financeFilterRepair`, `useAdminFilters` or `EXCHANGE_RATES_FILTER_SPEC`. `financeRequest.pin` is green and unedited |
| SQ-26 | **Accepted, with one addition (SA-1d-3).** `exchangeRatesQuerySchema` stays `.strict()`, and the repeated-key refusal stays first. It gains `from` and `to`, each `z.string().refine(isRealDate)` and inside the SA-1d-3 range. A `superRefine` requires **both or neither**, and `from ≤ to` (a string compare, after both are real dates). Both absent → the server default, `resolveAdminWindow(HISTORY_DEFAULT_PRESET, new Date())`, so every existing no-query route test keeps its meaning. `to` after today is allowed. **No 92-day cap**: the read is 10 rows on an indexed column, not an aggregate. The same keys apply to the plain read and to `currency` + `from` + `to`. The limit never comes from the request |
| SQ-27 | **Accepted: the page resolves and sends whole dates.** This is consistent with Costs, AI activity, Audit trail and Analytics (verified above). Finance's re-resolution is the money-aggregate exception, not the repo's rule for a list. Presets are resolved **at each read**, with `new Date()` at call time: Refresh and the save re-reads re-resolve, so "today" moves with the clock. The server converts the dates to instants (SQ-28). It does not trust them for anything else and has no preset key |
| SQ-28 | **Accepted.** Half-open bounds on UTC midnights: `changed_at >= {from}T00:00:00.000Z` and `changed_at < {to + 1 day}T00:00:00.000Z`. They are built by one pure helper in `exchangeRateRules.ts` (step 2) using `Date.UTC` arithmetic, never local time and never a `23:59:59` literal. `DatePresets` gets `requireBothDates` |
| SQ-29 | **Accepted: UTC**, with the shared labels "From (UTC)" / "To (UTC)" |
| SQ-30 | **Accepted, no code.** Covered by an unmount / remount render test in the rates suite. No Finance test is edited |
| SQ-31 | **Accepted, with a separate method.** `ExchangeRatesPayload` gains `lastChange: ExchangeRateHistoryWire \| null`, on the plain read only. `ExchangeRateHistoryPayload` does not gain it. The repository gets a new `findLatestChange()`: same columns, no window, newest first, `limit(1)`. It is called only on the plain read, in parallel with the other two reads. A failure gives the existing 500, logged `failed: 'lastChange'`. **SA-1c-2 is amended:** "Last rate change" = `payload.lastChange`, never `history[0]`. The label lookup runs **once** over the editors of the windowed rows plus `lastChange` (≤ 11 ids), with the same all-or-nothing rule across both lists (step 5) |
| SQ-32 | **Hashes unchanged, accepted. The additive case is rejected.** The "last change outside the window" case would render byte-identical HTML to `A2 ExchangeRatesKpis two tiles`, because the tile no longer reads `history`, so it adds no coverage of the shared component. The fixtures gain `lastChange` (step 7). `EXPECTED` is untouched. The header gains one line: "Amended by Exchange rates 1d: fixtures gain `lastChange`; no case or hash changed." The "outside the window" behaviour is proven by the view render test (step 8, test 5) |
| SQ-33 | **Accepted: the count stays 3.** Both GET sites stay literal `fetch(` calls whose first argument is a template literal starting `` `/api/admin/exchange-rates? ``. No variable URL, no folded site, no `${suffix}` directly after the path. No guard edit |
| SQ-34 | **Rejected as proposed: a window change runs Refresh's reads.** That means the plain read, plus the open panel's read when a panel is open. With only the panel re-read, the overall `payload.history` stays on the old window, and "Show all currencies" (which reads nothing) would show it under the new window. Running Refresh's reads also empties the held set first. That is the existing SQ-9 rule ("Refresh, every successful read"), and the rates are re-read in the same step, so the table is current. This is recorded for the user's diff review, not a blocker. A history-only read stays rejected (a fourth `fetch(` and a new payload shape) |

##### Additional rulings

| # | Topic | Ruling |
|---|---|---|
| SA-1d-1 | Plain-read race | `load` gets a request counter like `historyRequest` (SA W-3). Every plain read takes a number, and only the newest may write `payload`, the shown window, `error`, `refreshNotice`, the held set or `loading`. Unmount retires it too. A window change while a read is in flight then cannot be overwritten by the older answer |
| SA-1d-2 | Captions name the rows' window | Each answer records the window it was **read under**. The plain read stores it beside `payload`, and `CurrencyHistory` gains `window`. Captions and empty messages use that recorded window, never the control's current value. After a failed window re-read, the rows on screen keep their own period's wording. While a re-read runs, the existing `aria-busy` marks the list |
| SA-1d-3 | Date range | `from` and `to` must also lie in `2000-01-01`..`2999-12-31` (a string compare after `isRealDate`), else 400. Without this, `0000-01-01` (no year 0 in Postgres) or `9999-12-31` (+1 day gives the extended-year ISO `+010000-…`) passes Zod and fails in the database as a 500. Constants `HISTORY_WINDOW_MIN_DATE` / `HISTORY_WINDOW_MAX_DATE` go in `exchangeRateRules.ts` |
| SA-1d-4 | Null `changed_at` | `findLatestChange` orders `{ ascending: false, nullsFirst: false }`, so a row with no time can never be the tile's "last change". The windowed reads exclude nulls by the comparison itself. `listRecentHistory*` keep their existing order call |
| SA-1d-5 | Using `DatePresets` outside `AdminFilterBar` | **Approved as reuse, not a new pattern** (this is the CLAUDE.md rule 7 review). A second `AdminFilterBar` would add a second `role="search"` landmark named "Filters" to the page. The control is rendered **inside `RateHistoryTable`**, between its heading row ("Recent rate changes" and the caption) and its body. It is shown in every state (loading, error, empty, rows), so an admin can always widen an empty window. The two `RateHistoryTable` instances sit in the same slot of the view's ternary, so React keeps one control across opening and closing a panel. No `extras`. No edit to any file in `app/admin/components/layout/` |
| SA-1d-6 | No-op change | A window change whose value `windowEquals` the applied one reads nothing (this covers the second click on the pressed This month) |
| SA-1d-7 | §8 criterion 2 ("a route test proves the newest 10 inside the window") | With a mocked repository, a route test cannot prove a database selection. The proof is in three parts: (a) the repository unit test pins `.gte`, `.lt`, `.order(desc)` and `.limit(10)` on **one** builder chain; (b) the route test pins that the request's dates reach the repository as the SQ-28 instants; (c) a view test shows the page renders exactly the rows it receives, with no trimming. BA rewords the criterion to this; it is a record edit and does not gate Dev |
| SA-1d-8 | Skills and domains | `new-api-route` checklist for the changed handler: `requireAdmin` first, Zod before any read, correlationId, error format. `new-repository` checklist for `findLatestChange` and the windowed reads: `RepositoryResult`, never throws, method logger, counts only. The documented no-`user_id` exemption stays and covers the new method. No entitlements import (type-only included), no LLM call, no cron, no caller-supplied tenant id: `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain` and `tenant-isolation-guard` are not triggered. Schema: `changed_at` is verified from the `20261082` record. No `console.*` in any touched file (0 today in all six), and the new files stay at 0 |
| SA-1d-9 | Logs and privacy | The route may log the window dates at `debug` (not personal data). It never logs a label, name or email (SA-1c-7). The existing logger-spy test is extended to the `lastChange` label |

##### Required changes

**BA (record edits; they do not gate Dev):**
1. §5.6.5 first bullet and SQ-34 consequence: a window change runs Refresh's reads.
2. §8 slice 1d criterion 2 per SA-1d-7; criterion 8 adds the SA-1d-3 range.
3. §8 KPI pin criterion: "no hash moves, no new case".
4. §12: add `app/admin/exchange-rates/historyWindow.ts` (new) and the forced test edits from the table above. The `RateHistoryTable` row adds "renders the Window control (SA-1d-5)".

**Dev, build (the step list is the workplan; record deviations as DV-n in a short workplan MD the TL opens for QA):**

0. **Branch and baseline.** Work in this worktree, from `origin/main` `930a6cee` or newer. Run the narrow Jest set (step 10) once before editing and record the counts.
1. **Rules: the query** (`lib/admin/exchangeRates/exchangeRateRules.ts`).
   - Import `isRealDate`, `resolveAdminWindow` and `type AdminWindowPreset` from `@/app/admin/components/adminWindowPresets`.
   - Add `HISTORY_DEFAULT_PRESET = 'this_month' satisfies AdminWindowPreset`, and the two SA-1d-3 constants.
   - Rewrite `exchangeRatesQuerySchema` per SQ-26: `currency`, `from`, `to`, all optional, `.strict()`, plus the `superRefine` for both-or-neither and `from ≤ to`.
   - Export `type HistoryWindowDates = { from: string; to: string }`.
   - Update the schema's doc comment. `HISTORY_LIMIT` stays 10.
2. **Rules: the bounds and the payload.**
   - Add `historyWindowBounds(dates: HistoryWindowDates): { fromInclusive: string; toExclusive: string }` per SQ-28, pure, using `Date.UTC`.
   - Add `defaultHistoryWindowDates(now: Date): HistoryWindowDates` = `resolveAdminWindow(HISTORY_DEFAULT_PRESET, now)`.
   - `ExchangeRatesPayload` gains `lastChange: ExchangeRateHistoryWire | null`, with a doc comment: all-time, plain read only, SA-1c-2 as amended.
3. **Repository** (`lib/repositories/ExchangeRatesRepository.ts`).
   - `listRecentHistory(window: { fromInclusive: string; toExclusive: string })` and `listRecentHistoryForCurrency(code, window)` add `.gte('changed_at', window.fromInclusive).lt('changed_at', window.toExclusive)` before the existing order and limit.
   - New `findLatestChange(): Promise<RepositoryResult<ExchangeRateHistoryRow | null>>` per SQ-31 and SA-1d-4: `.limit(1)`, then `data[0] ?? null`.
   - Rewrite the header line "No method accepts a caller-supplied filter…" to name the window: two instants the route built from Zod-validated dates.
4. **Page helper, new pure file** `app/admin/exchange-rates/historyWindow.ts` (no React, no fetch; not added to the `layoutFolder` registry, like `changedByText.ts`).
   - `HISTORY_DEFAULT_WINDOW: AdminWindowValue = { kind: 'preset', preset: HISTORY_DEFAULT_PRESET }`.
   - `historyWindowDates(value, now): HistoryWindowDates`: `resolveWindow`, and anything that is not two non-null dates falls back to the default. This is the `costsFilters.datesOf` shape.
   - `historyWindowParams(value, now): URLSearchParams` holding `from` and `to`.
   - `historyPeriodText(value)`: `today` → "today", `7d` → "in the last 7 days", `30d` → "in the last 30 days", `this_month` → "this month", custom → "from A to B (UTC)", anything else → the default's text.
5. **Route** (`app/api/admin/exchange-rates/route.ts`).
   - Dates come from the query, or `defaultHistoryWindowDates(new Date())` when absent, then `historyWindowBounds`.
   - Plain read: `Promise.all([listAll(), listRecentHistory(bounds), findLatestChange()])`, each failure named (`rates` / `history` / `lastChange`).
   - Per-currency read: `listRecentHistoryForCurrency(code, bounds)`, no `findLatestChange`.
   - Split `resolveLabels` into `resolveLookup(records): Promise<{ lookup: EditorLookup; nameLookup: NameLookupStatus }>`, run once over the window rows plus `lastChange`. Then call `labelHistory(rows, lookup)`, and `labelHistory([latest], lookup)[0]` for `lastChange`. Its contract is unchanged (never throws, logs counts only).
   - Rewrite the route header: the query keys, the default window, `lastChange`, and the label lookup over both lists.
6. **View** (`ExchangeRatesView.tsx`).
   - `historyWindow` state and a `historyWindowRef`, both set **in the change handler**, never during render and never in an effect. Do not name a variable `window`.
   - `load` and `loadCurrencyHistory` read the ref at call time and send `` fetch(`/api/admin/exchange-rates?${historyWindowParams(…)}`, …) `` and `` fetch(`/api/admin/exchange-rates?currency=${encodeURIComponent(code)}&${historyWindowParams(…)}`, …) ``.
   - Plain-read counter per SA-1d-1; shown windows per SA-1d-2.
   - `changeHistoryWindow(next)`: SA-1d-6 no-op, else set state and ref, then `refresh()` (SQ-34).
   - Pass `window`, `defaultWindow` and `onWindowChange` plus the rows' window to `RateHistoryTable`.
   - Update header comment lines 17-24: the GETs carry `from` / `to`; a window change runs Refresh's reads.
7. **Presentational.**
   - `RateHistoryTable.tsx` renders `<DatePresets … requireBothDates />` per SA-1d-5.
   - `historyCaption(count, currencyCode, period)`: at the cap, "The newest {HISTORY_LIMIT} changes {period}"; otherwise "{n} change(s) {period}, newest first"; the "{CODE}: " prefix kept.
   - Empty messages: "No rate changes in this period." / "No rate changes for {CODE} in this period." (FR-32, FR-33). Update its header comment.
   - `ExchangeRatesKpis.tsx`: `const last = payload.lastChange;`, and its header comment says all-time, from `lastChange`.
   - `KpiStrip.callers.pin`: fixtures gain `lastChange`. `FX_PAYLOAD` → `FX_CHANGE`; no history → `null`; lookup failed → the same `changedByLabel: null` row; old rate null → the `oldRate: null` row. Add one header line. Show the `git diff` of that file in the handover: no hash or case line moves.
8. **Tests, new and amended.**
   - `exchangeRateRules.test.ts`:
     - Schema: none, `currency` only, `from` + `to`, all three, `from = to` → ok. Only `from`, only `to`, reversed, `2026-02-30`, `''`, `2026-1-01`, `1999-12-31`, `3000-01-01`, an unknown `limit` → refused. A future `to` → ok.
     - `historyWindowBounds`: 10-01..10-20 → `2026-10-01T00:00:00.000Z` / `2026-10-21T00:00:00.000Z`, plus month end, year end, `2028-02-28` → 02-29, `2028-02-29` → 03-01, `2027-02-28` → 03-01.
   - New `app/admin/exchange-rates/__tests__/historyWindow.test.ts`: every preset at a fixed `now`, including `2026-10-01T00:00:00.000Z` and `2026-10-31T23:59:59.999Z`; custom; the fallback; every `historyPeriodText`.
   - `ExchangeRatesRepository.test.ts`:
     - Both windowed reads pin `gte` / `lt` / `eq` (per currency) / `order` desc / `limit(10)` on one chain.
     - `findLatestChange`: no `gte` / `lt`, `nullsFirst: false`, `limit(1)`, a row or `null`, a returned error, a thrown error.
   - `route.test.ts`:
     - Forward mock arguments; mock `findLatestChange` in `beforeEach`.
     - The window reaches the repository as instants. No query gives This month at a pinned clock (`jest.useFakeTimers({ now })` in that test only, then `useRealTimers`).
     - `lastChange` is labelled, including an editor who appears only in `lastChange`: each source is called once with the union of ids.
     - A lookup failure nulls the `lastChange` label too.
     - A `findLatestChange` error gives a 500 with `failed: 'lastChange'`.
     - The per-currency body has no `lastChange` key and `findLatestChange` is not called.
     - 400 with no repository call: one-sided, reversed, bad date, out of range, repeated `from`, `limit=50`.
     - Not admin → refused before any read.
     - The logger spy finds no label value.
   - Rates render suites:
     - Fix the forced URL matchers by comparing `pathname` plus `searchParams`.
     - Rewrite the forced caption assertions to the period wording.
     - Fixtures gain `lastChange`.
   - New `describe('slice 1d')` in `exchangeRates.render.test.tsx`:
     1. One group named "Window", with This month pressed; the first GET carries this month's `from` / `to` (computed in the test with the helper); caption names "this month".
     2. 7 days → one plain GET with those dates; no `replaceState` call and `location.search` unchanged; caption "in the last 7 days".
     3. Custom: Apply is disabled with one date; both dates → exact `from` / `to`; caption "from A to B (UTC)".
     4. Panel open + window change → one plain GET and one `currency` GET with the window; then "Show all currencies" shows the overall list under the new period.
     5. `history: []` with `lastChange` set → the tile shows the change, and the list shows "No rate changes in this period."
     6. Per-currency empty message.
     7. Race: the first window's answer resolves after the second's → the second's rows and caption stay (SA-1d-1).
     8. A failed window re-read → the page error, and the old rows keep their own period caption (SA-1d-2).
     9. "Enabled currencies" is identical under every window, Show / Search are unchanged, and a held row is released by a window change (SQ-34).
     10. A second click on the pressed This month → no read (SA-1d-6).
     11. A rate save → the re-reads carry the applied window.
     12. Unmount and remount → This month (SQ-30).
     13. 3 rows received → 3 shown, and 10 → 10 with "The newest 10 changes this month" (SA-1d-7 (c)).
9. **Must stay unedited and green:** every file under `app/admin/finance/` (including `exchangeRatesTab.render.test.tsx` and `financeRequest.pin`) and `lib/business-os/finance/`; `app/admin/components/layout/**` sources; `redundantPages.source.guard` (count 3); `adminReadMethods.guard`; `layoutFolder.guard`. No migration, `package.json` or lockfile change. The `[currencyCode]/route.ts` PATCH is untouched.
10. **Checks.**
    - Narrow Jest over `app/admin/exchange-rates`, `app/api/admin/exchange-rates`, `lib/admin/exchangeRates`, `lib/repositories/__tests__/ExchangeRatesRepository.test.ts`, `lib/repositories/__tests__/adminReadMethods.guard.test.ts`, `app/admin/finance`, `app/admin/components`, `app/admin/__tests__`, `lib/admin/__tests__`.
    - `tsc` (narrow), `eslint`, `lint:hooks`.
    - Before the handover, run `git diff --stat` and confirm no file outside steps 1 to 8 appears, then run `git diff --numstat` and confirm there is no deletion-only file.

---

## SA Review Notes

_SA populates this section._

### SA code review

**Code Review by SA — 2026-10-21**
**Status:** ✅ Code Approved (no blocking item; three Low items for QA / optimisation below)

**What was read:** `git diff` against `930a6cee` in the `neuronforge-fx-1d` worktree (13 modified files), plus the new `app/admin/exchange-rates/historyWindow.ts` and `__tests__/historyWindow.test.ts`. Checked against §13.6 (SQ-25 to SQ-34, SA-1d-1 to SA-1d-9, Dev steps 0 to 10). SA re-ran the narrow Jest set (exchange-rates page, route, rules, repository, `adminReadMethods.guard`, `redundantPages.source.guard`, `KpiStrip.callers.pin`, `app/admin/finance`): **36 suites, 1,435 tests passed**. `git status` shows no change under `app/admin/finance/**`, `lib/business-os/finance/**`, `supabase/`, `package.json`, the lockfile or the `[currencyCode]` PATCH route. Under `app/admin/components/layout/` only the pin test changed.

#### Focus checks

| # | Check | Result |
|---|---|---|
| 1 | `requireAdmin` first statement | ✅ `route.ts` GET opens with `const gate = await requireAdmin(…)`, pinned by the source test "the first statement of GET is…". The not-admin tests (with and without a window) assert no read |
| 2 | Strict query: repeated key, then Zod `.strict()` + `superRefine`, 400 before any read | ✅ The repeated-key refusal runs before `safeParse`. The schema is `.strict()` and has `from` / `to` as `isRealDate` plus the SA-1d-3 range. `superRefine` checks both-or-neither, then `from ≤ to`. The 14-row `it.each` (one-sided, reversed, `2026-02-30`, unpadded, empty, `1999-12-31`, `3000-01-01`, year 0, year 9999, repeated `from`, `limit` with and without a window, `currency` with one side) asserts 400 and no repository or lookup call |
| 3 | Half-open UTC bounds | ✅ `historyWindowBounds` uses `Date.UTC(y, m-1, d)` and adds one day in milliseconds. That is correct across month ends, year ends and leap years: 2028-02-28 → 02-29, 2028-02-29 → 03-01, 2027-02-28 → 03-01, all tested. The two-digit-year trap in `Date.UTC` (years 0–99 map to the 1900s) cannot be reached, because the minimum is 2000. The maximum, 2999-12-31, gives `3000-01-01T00:00:00.000Z` (four digits) |
| 4 | `findLatestChange` with `nullsFirst: false` | ✅ `.order('changed_at', { ascending: false, nullsFirst: false }).limit(1)`, with no `gte` / `lt`. Pinned in the repository test (line 253). It returns `RepositoryResult`, never throws, and logs only `found` and `duration` |
| 5 | One all-or-nothing name lookup over history plus `lastChange` | ✅ `resolveLookup` runs once over `[...records, latestRecord]`, and `historyEditorIds` dedupes. Both lists are labelled with the same `lookup`. Tests: "an editor only in lastChange is named", "an editor in both lists is looked up once", "a failed lookup nulls the lastChange label too". The per-currency path does not call `findLatestChange`, and its body has no `lastChange` key |
| 6 | No PII in logs | ✅ The new debug line logs `from`, `to` and `currencyCode` only. The SA-1d-9 logger-spy test covers the `lastChange` editor. `console.*` count is 0 in all seven touched sources |
| 7 | Plain-read counter, retired on unmount | ✅ `loadRequest` is taken at the top of `load`. Every write after an await is gated: the network-error `failed`, the `!isCurrent()` return before `result` is used, and `setLoading(false)` in `finally`. The unmount cleanup bumps it next to `historyRequest`. Test 7 (race) proves the gate, and the Dev's mutation check confirms it is not vacuous. **The unmount bump has no test** (finding 1) |
| 8 | Captions from each list's own read window | ✅ `payloadWindow` is set only beside `setPayload`, in the same current-gated block. `CurrencyHistory.window` is kept from the shown rows while a same-code re-read runs (`kept.window`), and replaced only by `settle({ payload, window: readWindow })`. A new code starts at `readWindow`, with no payload. `RateHistoryTable` takes its period from `rowsWindow`, never from `window`. Test 8 proves this for a failed re-read |
| 9 | No-op on an equal window | ✅ `changeHistoryWindow` returns when `windowEquals(next, historyWindowRef.current)`. It compares against the ref, so two quick clicks in the same render cannot both read. Test 10 covers the second click on the pressed This month |
| 10 | A window change runs the same `refresh()` | ✅ `changeHistoryWindow` sets the ref, then the state, then calls `refresh()`, the same callback as Refresh. That empties the held set, runs `load()`, and runs `loadCurrencyHistory(openCode)` when a panel is open. The ref is set before `refresh()`, so both reads resolve the new window. Tests 4 and 9b cover it |
| 11 | Fetch count 3 | ✅ Two GET template literals start `` `/api/admin/exchange-rates? `` and the PATCH is unchanged. No `${suffix}` comes directly after the path. `redundantPages.source.guard` is green and unedited |
| 12 | No URL writes | ✅ No `replaceState`, `pushState` or `useRouter` in the folder. The window lives in `useState` plus a ref. Test 2 asserts `location.search` is unchanged, and `financeRequest.pin` is green and unedited |
| 13 | KpiStrip pin | ✅ The diff is one header line plus `lastChange` on the four fixtures, mapped exactly as step 7 lists. No `CASES` or `EXPECTED` line moved, and the suite is green |
| 14 | Finance untouched | ✅ No file under `app/admin/finance/**` or `lib/business-os/finance/**` appears in `git status`. `exchangeRatesTab.render.test.tsx` passes unedited |
| 15 | Hooks rules | ✅ No hook is conditional. The ref and the state are written only in the handler, never during render or in an effect. `changeHistoryWindow` is a plain per-render function, so it closes over the current `refresh` / `openCode`. No variable is named `window`; the prop is destructured to `windowValue`, as step 6 asked. Under StrictMode the double mount retires the first plain read and runs a second one, which is correct. `lint:hooks` is clean per the Dev, and SA saw no violation |
| 16 | View state across window change / save / Refresh / open panel / Show all | ✅ **Window change:** the plain read and the open panel's read both carry the new window. The shown rows keep their old caption and are marked `aria-busy` until the answers land. **Save:** `load({ afterSave: true })` and `loadCurrencyHistory(openCodeRef.current)` read the ref at call time, so they carry the applied window (test 11). A later window change retires an in-flight after-save read, and that is safe because the newer read includes the saved row. **Refresh:** unchanged, now with the window. **Open panel (new code):** `payload: null`, `window: readWindow`, loading. **Show all:** reads nothing and shows `payload.history` under `payloadWindow`. If the plain read for a new window is still in flight or failed, the caption honestly names the old period (SA-1d-2). The KPI tile reads `lastChange` only (test 5) |

#### Rulings on DV-1 to DV-8

| # | Ruling |
|---|---|
| DV-1 | **Accepted.** The test's premise is "no editor anywhere, so no lookup". Once the lookup also covers `lastChange` (SQ-31), the test can only keep that meaning if `lastChange` has a null editor too |
| DV-2 | **Accepted.** This edit is forced by SA-1c-2 as amended. It falls under "fixtures gain `lastChange`" |
| DV-3 | **Accepted.** `stubFetch` now awaits a value that may be a promise. That is backward-compatible and is needed for test 7 |
| DV-4 | **Accepted.** Splitting test 9 keeps 9a's "identical under every window" check independent of 9b's changing server |
| DV-5 | **Accepted.** Naming only |
| DV-6 | **Accepted.** The file-wide fake clock already existed. A separate `now` of `2026-12-31T23:59:59.999Z` gives a stronger test, because the default window then crosses a year end. `finally` restores the timers |
| DV-7 | **Accepted.** The heading depth change does not change the quoted text |
| DV-8 | **Accepted.** These tests are additive and cover SQ-26, SQ-31 and SA-1d-3 edges. Nothing was removed |

#### Ruling on Q-1

**"In every state" means every caption and every empty message, not a count line in the loading and error states. No code change.**
- The intent of FR-32 / §5.6.4 is "an admin never reads a windowed list as all history". As built, three things meet it:
  - a count line that names the rows' own period;
  - empty messages that say "in this period";
  - the Window control, which SA-1d-5 renders in every state (loading, error, empty, rows) and which shows the pressed window.
- Adding a count line while loading or on an error would put a number on rows that are not on screen.
- Naming the period inside the empty message would change the FR-33 wording, which the user approved through BA.

**BA record edit, not gating:** reword the §8 slice 1d criterion 7 clause to "every caption names the period of the rows it counts, and the Window control shows the applied window in every state".

#### Code Review Comments

1. `app/admin/exchange-rates/components/ExchangeRatesView.tsx` (unmount cleanup, `loadRequest.current += 1`). The SA-1d-1 "unmount retires it too" half has no test. The existing "a failed answer after unmount is dropped" test holds a **currency** read, and the Dev's mutation check did not remove this line. **QA to add one render test:** hold the plain GET, unmount, then resolve it with a 500, and assert no `'Exchange rates read failed'` warn and no `console.error`. As a control, mutate the line away and see the test fail. Priority: **Low** (the code is correct; the gap is coverage only). Not blocking QA entry.
2. `app/admin/exchange-rates/historyWindow.ts` `historyWindowDates`. The final `{ from: '', to: '' }` branch cannot be reached: the default preset always resolves to two dates. It exists only for type narrowing. If it were ever reached, the route would answer 400 rather than read a wrong window, which is the safe failure. Optional: a one-line comment saying it is unreachable and fails closed. Priority: **Low**.
3. `ExchangeRatesView.tsx` `load` / `loadCurrencyHistory`. Each read calls `new Date()` on its own, so a Refresh or window change that straddles UTC midnight could send the plain read and the panel read one day apart. Each list's caption still names its own preset correctly, so nothing is mislabelled. Accept as is. Priority: **Low**, no action.

#### Optimisation Suggestions

- For QA's manual pass, a known and accepted consequence of SA-1d-6:
  - after a **failed** window re-read, the control shows the new window and the rows keep the old one;
  - clicking the same (already applied) window again is a no-op by design;
  - the recovery is the page error's Retry or the top-bar Refresh, and both read the applied window.

  Record this in the QA report; no change.
- The `lib/admin/exchangeRates/exchangeRateRules.ts` → `@/app/admin/components/adminWindowPresets` import goes from `lib/` into `app/`. It was approved in SQ-27 (precedent `lib/business-os/finance/dueDates.ts`) and the target is pure and isomorphic. No action.

#### Skill checklists (SA-1d-8)

- **`new-api-route`:** `requireAdmin` is first, Zod runs before any read, `correlationId` is on the request logger, and the error format and dev-only `details` are unchanged. A plain read writes no audit row.
- **`new-repository`:** the windowed reads and `findLatestChange` return `RepositoryResult`, never throw, use a method logger and log counts only. The documented no-`user_id` exemption covers the new method.
- **Not triggered:** no entitlements import (type-only included), no LLM call, no cron, no caller-supplied tenant id.

### Code Approved for QA: Yes

Finding 1 is a QA coverage add, not a Dev fix. Findings 2 and 3 are optional.

## QA Testing Report

**QA — 2026-10-21**
**Test mode:** full
**Strategy used:** A (Jest unit: rules, page helper, repository) + B (route with mocked repositories) + render tests (jsdom). D (manual browser check) is **owed**, see below.
**Focus:** api, ui, schema, security (gate before read), performance (no new fetch site)
**Skipped:** manual browser pass (not possible in this session; owed before merge)
**Input source:** TL prompt (probe list) + SA code review Finding 1

### Runs

| Run | Result |
|---|---|
| Narrow Jest set (step 10 paths), `--ci`, before QA probes | **80 suites, 3,010 tests passed**: matches Dev |
| Same set after QA probes | **80 suites, 3,022 tests passed** (+12 QA probes, no new suite) |
| CI-parity guards, `--ci`: `redundantPages.source.guard` (G-4 / G-6, count 3), `layoutFolder.guard`, `KpiStrip.callers.pin`, `AdminSidebar.nav`, `admin-authz-surface.guard`, `adminReadMethods.guard`, `lib/business-os/finance/__tests__/finance.source.guard`, every `app/admin/finance/__tests__/*` (incl. `source.guard`, `usdCopy.source.guard`, `financeRequest.pin`, `chargeChecksRequest.pin`, `financeTiles.pin`, `exchangeRatesTab.render`) | **32 suites, 2,802 tests passed** |
| `KpiStrip.callers.pin` diff | Header line plus `lastChange` on the four fixtures only. No case line or hash moved |
| G-6 `fetch(` sites | 3 in code (plain GET, currency GET, PATCH); the 4th grep hit is the header comment, which the guard strips |
| Unchanged | `app/admin/finance/**`, `lib/business-os/finance/**`, `app/admin/components/layout/**` sources, `[currencyCode]` PATCH route, migrations, `package.json`, lockfile: empty `git diff` |
| CRLF | No CR byte in any changed or new file (sources, tests, this workplan). Git's "LF will be replaced by CRLF" warnings come from local `autocrlf` and are not content |
| `console.*` in the 7 touched sources | 0 |
| D-5 (no rate arithmetic) | No arithmetic on a rate in the diff. The only change is the tile's source |
| QA test files: `eslint`, narrow `tsc` (scratch tsconfig, deleted afterwards) | clean, 0 errors |

### Test Coverage (§8 slice 1d)

| Criterion | Tested? | Result | Where |
|---|---|---|---|
| 1. Window control above the history table, This month pressed on first open | ✅ | Pass | render `slice 1d` 1 (one group "Window", inside `rate-history`, This month pressed). On the real `/admin/finance?tab=exchange-rates` the `exchangeRatesTab.render` suite is green; the visual check is in the manual pass |
| 2. This month: only this UTC month, at most 10, newest first; server-side selection | ✅ | Pass (proved in 3 parts, SA-1d-7) | repo `listRecentHistory` (`gte` / `lt` / `order desc` / `limit(10)` on one chain); route "request dates reach both windowed reads"; render 13 (3 → 3, 10 → 10, nothing trimmed) |
| 3. Today / 7 / 30 days per `resolveAdminWindow`; Custom whole UTC dates, inclusive end | ✅ | Pass | `historyWindow.test` (every preset at mid-month, on the 1st 00:00:00.000Z and on the 31st 23:59:59.999Z); rules `historyWindowBounds` (half-open on `to + 1` midnight, month end, year end, leap years); render 2, 3 |
| 4. Per-currency History follows the window; a window change re-reads the open panel | ✅ | Pass | render 4, 11; route `?currency=ILS&from&to` + QA probe `?currency=EUR&from&to` |
| 5. The tile is all-time from `lastChange`, never `history[0]` | ✅ | Pass | render 5 (empty window + an older `lastChange`); QA probes: `history[0]` differs from `lastChange` and the tile shows `lastChange`; the tile does not change across Today / 7 / 30 days |
| 6. `lastChange` on the plain GET only; its editor in the same all-or-nothing lookup | ✅ | Pass | route: exact payload keys, per-currency has no `lastChange` and never calls `findLatestChange`, one lookup over the union, a failed lookup nulls both lists |
| 7. Empty messages; caption names the period | ✅ | Pass (Q-1 ruled by SA: "every caption and empty message") | render 5, 6, captions suite, 8 (rows keep their own period) |
| 8. 400s for bad / one-sided / reversed / unknown / repeated, nothing read; limit fixed at 10 | ✅ | Pass | rules schema table; route `it.each` (14 cases, `noRead()`), `limit=50` refused; QA probe: reversed window with `currency` → 400, nothing read |
| 9. Rates table, Show / Search, held rows, Enabled currencies unchanged under every window | ✅ | Pass | render 9a, 9b |
| 10. Nothing written to the URL; `financeRequest.pin` unedited and green | ✅ | Pass | render 2 (no `replaceState` / `pushState`, `location.search` unchanged); pin green, `app/admin/finance` diff empty |
| 11. Leaving the tab and coming back gives This month (SQ-30) | ✅ | Pass | render 12 (unmount / remount) |
| 12. G-6 count 3; KpiStrip no hash moved; no Finance / migration change | ✅ | Pass | guards above |
| 13. Nothing does arithmetic on a rate (D-5) | ✅ | Pass | diff review |

### Edge-case probes (TL list)

| Probe | Result | Evidence |
|---|---|---|
| No dates means This month, incl. the 1st and the last day at 23:59:59Z | Pass | QA route probes: `2026-10-01T00:00:00Z` → `10-01`..`10-02`; `2026-10-31T23:59:59Z` → `10-01`..`11-01`. Dev's `2026-12-31T23:59:59.999Z` year-end case |
| `from` > `to` → 400 | Pass | route + rules; QA probe with `currency` |
| only `from` / only `to` → 400 | Pass | route + rules |
| `2026-02-30` → 400 | Pass | route + rules |
| year 1999 / 3000 → 400 | Pass | route (`1999-12-31`, `3000-01-01`), also year 0 / 9999 |
| `from` = `to` → one whole UTC day | Pass | QA route probe: `2026-10-20T00:00Z` .. `2026-10-21T00:00Z` |
| leap day `2028-02-29` | Pass | QA route probe `from=to=2028-02-29` → `02-29`..`03-01`; rules bounds |
| `?currency=EUR&from&to`: windowed per-currency list, no `lastChange` | Pass | QA route probe (exact keys, windowed instants, `findLatestChange` and `listRecentHistory` not called) |
| an empty window still returns `lastChange` | Pass | route "an empty window still sends the all-time lastChange" |
| the KPI tile ignores the window | Pass | render 5 + 2 QA render probes |
| Custom requires both dates | Pass | render 3 (Apply disabled with one date) |
| the same window twice → no new fetch | Pass | render 10 (pressed This month); QA probe: the same Custom range applied twice reads once. Note: a second click on a pressed **7 days** is not "the same window". The shared control maps it to This month, and it reads This month (QA probe pins this) |
| two quick window changes: the older answer is dropped | Pass | render 7 |
| a window change releases held rows (SQ-9) | Pass | render 9b |
| the window resets on leave / return | Pass | render 12 |

### SA Finding 1: plain-read unmount retirement

Added to `exchangeRates.render.test.tsx` (`describe('QA probes (slice 1d)')`): "a plain GET held open, then unmount, then a 500: no warning and no console.error (SA-1d-1)". There is also a mounted control test (the same held 500 is logged), so the probe is not vacuous.

**Mutation check:** I deleted `      loadRequest.current += 1;` from the unmount effect in `ExchangeRatesView.tsx` once (md5 before `781a6b80…`). The new test **failed** (1 failed, 5 passed in the QA block). I restored the file from a scratch copy: md5 `781a6b80…` again, and `cmp` shows it byte-identical.

### QA tests added (test files only, no product code)

- `app/api/admin/exchange-rates/__tests__/route.test.ts`: `describe('QA probes (slice 1d)')`, 6 tests (default on the 1st and on the last day, `from = to`, leap day, windowed `?currency=EUR`, reversed window with `currency`).
- `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx`: `describe('QA probes (slice 1d)')`, 6 tests (tile vs a differing `history[0]`, tile stable across windows, the same Custom twice, a pressed 7 days goes back to This month, the SA Finding 1 unmount probe and its mounted control).

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. No new fetch site. Each window change runs Refresh's reads (plain, plus the open panel's), as SQ-34 rules.

#### Edge Cases (nice to fix)
1. **Custom accepts dates the route refuses** (Low). The shared `DatePresets` inputs have no `min` / `max`, so an admin can apply e.g. `1999-01-01`..`1999-01-31`. The GET then returns 400 and the page shows the page-level error, while the control shows the custom range. Retry and Refresh repeat the 400, so the admin has to pick another window. This is unlikely for real use (no history exists before 2026). A fix would be a page-side clamp or a friendlier message, and it must not edit `DatePresets` (§5.6.6). Recorded for BA / SA, not blocking.
2. **SA-accepted behaviour, for the manual pass:** after a failed window re-read, the control shows the new window while the rows (and their caption) keep the old one (SA-1d-2). Retry or Refresh recovers with the applied window.

### Manual browser check: OWED

This session did not drive a browser. Before merge, someone signed in as an admin should open `/admin/finance?tab=exchange-rates` on a desktop viewport and check:
- the Window control above "Recent rate changes", with This month pressed;
- 7 days / Custom change the list and the caption;
- the address bar does not change;
- the "Last rate change" tile is unchanged across windows;
- History for a currency follows the window;
- switching to another Finance tab and back gives This month;
- a failed re-read (e.g. offline) shows the new window on the control and the old rows, and Refresh recovers.

### Final Status
- [x] All acceptance criteria pass under automated tests. Ready for the user diff review, **with the manual browser pass owed**
- [ ] Issues found: Dev must address before commit (none)

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-20 | Created | Dev workplan for slice 1d from §13.6 (no separate workplan review, per SA). Verbatim quotes of §1 row 1d, D-8, §5.6, FR-28 to FR-34, §8 slice 1d and all of §13.6. Baseline 79 suites / 2,912 tests |
| 2026-10-21 | Built (uncommitted) | Steps 0 to 10 done. DV-1 to DV-8, Q-1 recorded. Narrow Jest 80 suites / 3,010 tests passed; narrow `tsc` 0 errors; `eslint`, `lint:hooks` clean; no KpiStrip hash moved. Awaiting SA code review and QA |
| 2026-10-21 | SA code review | ✅ Code Approved for QA. All 16 focus checks pass; DV-1 to DV-8 accepted; Q-1 ruled ("every caption and empty message", the Window control shows the applied window in every state; BA rewords §8 criterion 7, no code). Three Low findings: QA adds a plain-read unmount-retirement test; optional unreachable-branch comment in `historyWindowDates`; per-read `new Date()` at UTC midnight accepted. SA re-run: 36 suites / 1,435 tests passed |
| 2026-10-21 | QA | **PASS-WITH-NOTES.** Narrow `--ci` 80 suites / 3,010 tests (matches Dev), then 3,022 with 12 QA probes; CI-parity guards 32 suites / 2,802 passed; all 13 §8 criteria and the 15 TL probes pass. SA Finding 1 test added, mutation-checked (fails without `loadRequest.current += 1`; source restored byte-identical). No bugs; one Low edge case (Custom accepts pre-2000 dates the route 400s). Manual browser pass owed |
