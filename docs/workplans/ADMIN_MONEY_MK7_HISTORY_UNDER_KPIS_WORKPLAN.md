# Workplan: Money MK-7, History under its KPIs (Page 1 part only)

> **Last Updated**: 2026-10-20

**Developer:** Dev
**Requirement:** [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) §12 MK-7; §6 item 13; C-7; SA-RR-MK pins table ("MK-1, MK-6, MK-7: none expected"); FIN slice 8.3 (E-85, E-99, E-100, E-101, AC-173, C-1)
**Branch:** `feature/admin-money-mk7-history-under-kpis` (from main `5e6e489c`; MK-6 #489 merged)
**Date:** 2026-10-20
**Status:** Code Complete
**Path:** UI short path. Markup and copy only. The payload, the finance request and the history route are unchanged.

## Overview

The separate "History" block on the Finance Overview is split, so each trend sits under its KPI (§6 item 13):

| Trend | From | To |
|---|---|---|
| Plan mix trend | History block | **Plan mix** (`AccountsByPlanSection`), after its content |
| Credits trend | History block | **Credits** (`CreditsSection`), after its content |

**Deferred: C-7, moving the recorded AI cost detail to AI cost.** It depends on MK-3, which is Page 2 and has not been started. The user asked to stop before any Page 2 work. The recorded AI cost detail stays on Finance, unchanged, and C-7 is deferred to MK-3.

## Design

**One shared lazy fetch.** The design choice offered in the task is settled this way:
- `FinanceHistoryProvider` wraps the Finance content and holds the existing `useFinanceHistory` (same route, same query, same reader).
- Each trend (`HistoryTrend`, `trend: 'planMix' | 'credits'`) has its own Show / Hide toggle.
- The provider fetches only while at least one trend is open. Two open trends share one request and one view. Before, the one block's open state did the same job.

**Behaviour kept from slice 8.3:**
- No request on load, so the page still makes exactly one fetch (E-85, AC-173).
- Opening a trend sends exactly one history request. A window change while a trend is open sends one more, and none while all trends are closed.
- Closing sends nothing.
- The open state is local, never a URL key.
- The "not available yet" (E-100), "no history yet" (E-101) and "none in this window" wording is unchanged and shown inside each trend.
- The block keeps E-99: it formats only, with no fold, no sort and no date arithmetic.
- C-1's 1,000-row paging is in the route and repository, and is untouched.

**Per trend:**
- A small "History" sub-heading.
- The existing subtitle ("Each point is the state at the end of that UTC day…").
- The toggle (`history-<trend>-toggle`, with `aria-expanded` and `aria-controls`).
- When open: the loading, error (with Try again), not-installed, start-line and weekly states, and that trend's table. The table test ids stay `history-plan-mix` and `history-credits`.

**A business picked.** Each block shows the existing one line, "History is kept for all businesses together…", with no button and no request (HS-FR-11).

**Placement:**
- Each trend renders in its host's normal content and, because it is its own read, also when the host could not load (`alsoWhenUnknown`).
- The Plans tab shows Plan mix too, so its trend appears there as well, still lazy.
- `HistoryBlock` and the separate `section-history` frame go away. `HistoryAllBusinessesLine` stays.

**What does not change:**
- The payload and AC-145 (`23a12c7e`), Pin B, Pin A, AC-173 and Pins C and D.
- `HISTORY_*` copy. `HISTORY_TITLE` becomes the sub-heading.

## Files

| File | Action |
|---|---|
| `app/admin/finance/components/HistoryBlock.tsx` | `HistoryBlock` removed; keeps the table formatter (now exported) and the all-businesses line |
| `app/admin/finance/components/HistoryTrends.tsx` | **New:** `FinanceHistoryProvider` and `HistoryTrend` (see D-1) |
| `app/admin/finance/components/AccountsByPlanSection.tsx`, `CreditsSection.tsx` | Optional `trend` prop, rendered last and also when the section is unknown |
| `app/admin/finance/components/FinanceView.tsx` | The provider; the trends passed to the two sections; the History block removed |
| `app/admin/finance/__tests__/historyBlock.render.test.tsx` | Rewritten for the trends |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | The 8.3 page cases re-pointed, plus MK-7 cases (placement, one shared request) |

## Task List

- ✅ Step 1: Provider and trend component
- ✅ Step 2: Host the trends; remove the block
- ✅ Step 3: Tests
- ✅ Step 4: Runs and pins

## Implementation Notes

**Built as designed**, with one deviation.

**D-1.** The provider and the trend live in a new file, `HistoryTrends.tsx`, not in `HistoryBlock.tsx`. #486's `exchangeRatesTab.render.test.tsx` mocks the `HistoryBlock` module with only `HistoryBlock` and `HistoryAllBusinessesLine`, so a provider exported from there would be undefined in that test. With the new file, #486's tests stay untouched and pass.

**D-2.** The slice 8.3 guard in `app/admin/finance/__tests__/source.guard.test.ts` now also covers `HistoryTrends.tsx`: E-99 (no fold, no date arithmetic) and "only types cross from lib/business-os/finance". This is additive coverage, not a pin.

**Deferred.** C-7, moving the recorded AI cost detail to AI cost, is deferred to MK-3 (Page 2, not started, stopped by the user). The recorded AI cost detail on Finance is unchanged.

**Test edits.**
- `historyBlock.render.test.tsx`: rewritten for the trends. Every 8.3 state is kept per trend, plus 2 MK-7 cases: two open trends make one request, and closing one with the other open sends nothing.
- `financePage.render.test.tsx`: the 8.3 page cases now point at the trends. Both trends are closed on load and sit inside Plan mix and Credits; there is exactly 1 fetch on load; "Show history" makes one more, pinned request, and the second trend shares it; a window change while closed sends nothing; a picked business shows the one line in each block.
- No pin file is edited.

### Runs

| Run | Result |
|---|---|
| `app/admin/finance` | 25 suites, 854 tests |
| History route | 16 tests |
| `lib/repositories` (snapshot read included) | 113 suites, 2,746 tests |
| `app/admin/components` | 878 tests |
| Guards (vocabulary, layout, contrast, range-cap, finance source, USD copy, Finance source) | 7 suites, 2,252 tests |
| Pins A, B, AC-173, C, D and the route (AC-145 `23a12c7e`) | 6 suites, 216 tests; no pin file differs from main |
| `test:authz-guard` | 203 tests |
| `test:bos-entitlements` | 301 suites, 9,158 tests |
| `lint:hooks` | Clean |
| Scoped tsc | 385 files, 0 errors. The canary in `historyBlock.render.test.tsx` gave TS2322, and the file was restored byte-identical |

**Full gate:** 21 suites and 141 tests failed. That is exactly the known Windows-only set: the 20-suite baseline plus `upgradeModal.guard`, the CRLF failure from UM-1a on main.

**Logging:** there are no `console.*` calls in any touched file.

## SA Review Notes

### SA Code Review (MK-7, Page 1 part)

**Code Review by SA, 2026-10-20. Reviewed: the uncommitted tree on `feature/admin-money-mk7-history-under-kpis` (from main `5e6e489c`).**
**Status: Code Approved (SA-CR-MK7).** No conditions.

| Item | Result |
|---|---|
| §6 item 13 | ✅ The plan-mix trend sits under Plan mix (`AccountsByPlanSection` `trend`) and the credits trend under Credits. The standalone History block is gone; `HistoryBlock.tsx` now only exports the shared table view and the all-businesses line. With a business picked, the "all businesses together" line shows instead (HS-FR-11) |
| E-85 (on demand) and AC-173 (one fetch on load) | ✅ Each trend renders **closed**. `FinanceHistoryProvider` runs `useFinanceHistory(query, anyOpen)`, so nothing is requested until a trend is opened. AC-173 and the page tests are unedited and green |
| No double fetch | ✅ **One shared read** sits in the provider: opening the second trend while the first is open sends nothing. Closing one while the other stays open sends nothing. Closing both and reopening reads again. All are tested (`historyBlock.render.test.tsx:174-187`). An unmounted trend (a tab switch) reports itself closed |
| C-1 paging, not installed, empty wording | ✅ `app/api/**` and `lib/**` are untouched, so the history route and the read repository's 1,000-row paging are unchanged. The trends reuse the same copy constants (`HISTORY_NOT_INSTALLED`, `HISTORY_NONE_YET`, `historyNoneInWindow`, `historyStartsOn`, `HISTORY_WEEKLY`) and the same `AdminError` / Try again |
| Guards | ✅ The app Finance source guard now holds `HistoryTrends.tsx` to the same rules as the block (types-only imports, no fold or arithmetic, no `console.`): an addition, not a loosening. `app/admin/finance`, `app/admin/__tests__` (vocabulary, contrast, C-14) and `app/admin/components`: **2361 passed** |
| Pins | ✅ None of the seven pin files differs from HEAD, and the payload is unchanged (**AC-145 `23a12c7e`**) |
| C-7 deferral | ✅ **Recorded correctly** (header line 21 and §82: "deferred to MK-3 (Page 2, not started, stopped by the user)"; the recorded AI cost detail on Finance is unchanged). That matches the review doc's §12, where MK-7 lists C-7, and the user's stop before Page 2. **MK-3's workplan must pick C-7 up** |

#### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-20** (worktree `neuronforge-finance-m8`, branch `feature/admin-money-mk7-history-under-kpis` on `5e6e489c`, uncommitted)
**Test mode:** full (UI short path)
**Strategy used:**
- **A:** Jest suites and guards, each run alone.
- A code read.
- **A temporary before/after probe, deleted afterwards** (`git status` is clean of `zz_*`). Main's `HistoryBlock` (from `git show HEAD:`) and the new `FinanceHistoryProvider` + two `HistoryTrend`s were given the **same** history responses and driven with real `user-event` clicks: ready (weekly, with a gap, "Not recorded" cells and a retired plan column), not installed, no history, none in window, and a 500 error. Their DOM was compared, and the requests counted.
- A scoped tsc with a canary.

**Focus:** ui
**Skipped:** the live page (user, below).
**Input source:** prompt + workplan

**Verdict: PASS. No bugs.**

### Behaviour

| Item | Result | Evidence |
|---|---|---|
| The separate History block is gone | ✅ | `HistoryBlock` is removed and `FinanceView` no longer mounts `section-history`. No non-test source under `app/admin` names `section-history` or `#history`. `HistoryAllBusinessesLine` stays |
| Plan mix and Credits each have their trend | ✅ | `HistoryTrend trend="planMix"` is passed to `AccountsByPlanSection` (Overview, and the Plans tab), and `trend="credits"` to `CreditsSection`. Each renders last in its section and also when the section could not load (`alsoWhenUnknown`). Probe: the plan-mix table is only under the plan-mix trend and the credits table only under credits; neither host holds the other's table |
| No history request on load; exactly one fetch overall | ✅ | Probe: **0 requests on mount**. Dev's page test: exactly 1 fetch on load (finance). AC-173 `3a1a2dd4` / `b84e0c96` are unchanged and green |
| Opening one trend fetches once; opening the second does not fetch again | ✅ | Probe with real clicks: open Credits gives **1** request. Open Plan mix: still **1**, and its table renders from the shared view. Close Credits: still 1. Close Plan mix: still 1. Re-open Plan mix: **2**, which is exactly main's behaviour (main's block also re-requests on close then re-open; checked as a baseline). One provider sits above the tabs and the tab bodies are a ternary, so two plan-mix trends are never mounted at once |
| Trend content is the same as the old block | ✅ | Probe, ready state: the **plan-mix and credits tables are byte-identical** to main's (`outerHTML` equal). Each holds the weekly points, the "**No snapshot**" gap row and "**Not recorded**" cells (never `0`). The "**History starts on 2026-10-01**" line, the weekly note and the subtitle ("Each point is the state at the end of that UTC day…") have **identical text** to main's, said once in each trend |
| Not-installed and empty states: same wording | ✅ | Probe: for not installed, no history ("no history yet"), none in window, and the error with Try again, each trend's text **equals main's** word for word, and the tables are absent in both versions |
| E-99 and the lib boundary | ✅ | `source.guard.test.ts` now also scans `HistoryTrends.tsx`: no fold or sort, no date arithmetic, and only types imported from `lib/business-os/finance`. The edit is **additive** (the file added to existing loops); no rule is loosened |
| The recorded AI cost detail is unchanged (C-7 deferred) | ✅ | `AiCostSection.tsx`, `RecordedCostLines.tsx`, `lib/` and `app/api/` are byte-identical to HEAD (`git diff --quiet`) |
| No pin moved | ✅ | No pin or `*Pins.ts` file differs from HEAD, and nothing under `app/api` does. Pin A `96fae2be` (main's), Pin B `a1b3db0c`, AC-173 `3a1a2dd4` / `b84e0c96`, Pin C `98ea0507` / `02813360`, Pin D `1f7cf07a`, AC-145 `23a12c7e` |

### Suite runs (each alone)

| Suite | Result |
|---|---|
| `app/admin/finance` | 25/25, **854/854** |
| History route (`app/api/admin/business-os/finance/history`) | 1/1, **16/16** |
| `lib/repositories` | 113/113, **2746/2746** |
| `app/admin/components` | 26/26, **878/878** |
| Guards: vocabulary, contrast, layout folder, range-cap, finance source (lib and app), USD copy | 7/7, **2252/2252** |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 301/301, **9158/9158** |
| `npm run lint:hooks` | exit 0 |

All counts match Dev's.

**Scoped tsc:**
- Scope: `app/admin/finance/**`, `app/admin/components/**` and `app/admin/exchange-rates/**`, 284 app and lib files.
- The canary in `HistoryTrends.tsx` gave `(153,7) TS2322`. The file was restored with `cp` and checked with `cmp` (identical).
- The clean run: **0 errors**.

### Issues Found
- **Bugs:** none.
- **Performance:** none. Same one lazy read, shared; no request on load.
- **Notes (not defects):**
  - The old block's "OK" chip, shown only once a view was read, has no per-trend equivalent. The state is still said in words in each trend.
  - With a business picked, the one line "History is kept for all businesses together…" now appears twice, once in Plan mix and once in Credits. That is by design.

### User browser steps (signed in as an admin)
1. **Money → Finance**, Overview. There is no separate "History" section. In the network panel, **one** finance request on load and **no** history request.
2. **Plan mix:** at its foot there is a small "History" heading, the "Each point is the state at the end of that UTC day…" line, and **Show history**. Click it: **one** history request; the plan-mix table appears with "History starts on …", the weekly note when the window is long, "No snapshot" rows for missing weeks and "Not recorded" where nothing was recorded.
3. **Credits:** click its **Show history**. **No new request**; the credits table appears.
4. Hide both, then change the window: no request. Show one again: one request.
5. Pick one business: each block shows "History is kept for all businesses together…", with no button.
6. **AI cost:** the recorded AI cost detail is where it was.

### Final Status
- [x] All MK-7 behaviours pass. The trend content is byte-identical to the old block, there is one shared lazy request, and no pin moved. **Ready for RM.**
- [ ] Issues found

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-20 | Created (Dev) | Short workplan; C-7 deferred to MK-3 |
| 2026-10-20 | Implemented (Dev) | Trends under Plan mix and Credits, one shared lazy read; History block removed; C-7 deferred to MK-3; no pin moved |
| 2026-10-20 | SA code review | Code Approved (SA-CR-MK7): trends under their KPIs; one shared lazy read (no double fetch, tested); E-85 and AC-173 kept; paging and wording unchanged; pins and AC-145 unchanged; the C-7 deferral to MK-3 recorded correctly |
