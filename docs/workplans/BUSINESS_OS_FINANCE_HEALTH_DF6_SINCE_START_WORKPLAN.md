# Workplan: Business OS Finance & Business Health — Slice DF-6 (since it started, one account)

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md). This workplan covers slice **DF-6**, which is §11L.1 to §11L.12 and the SA Requirement Review after §11L.12 (SA-RR-DF6, E-75 to E-80 applied):
- AC-257 to AC-272;
- checks 29 and 30 (inside §11L.10);
- L-148 to L-154;
- SA-Q92 to SA-Q99 (all ruled by SA);
- BQ-16 (§0.4), its default (one window for every section).
**Branch:** `feature/bos-finance-health-df6` (worktree `neuronforge-finance-m8`, cut from the 6b tip `ea56ad04`; 6b is merged to main). Confirmed with `git branch --show-current`.
**Status:** Code Complete (SA workplan review approved with conditions, SA-WR-DF6; awaiting SA code review; D-1 and D-2 need an SA ruling)

**Decisions in force:**
- BD-26 ("since it started" for one account only, from the charging cut-over).
- BD-30 (U-4: a bad link drops only the bad filter).
- BD-12 (no FX; per currency only).
- BD-33 (fast track: SA, QA and TL approve, then RM commits, opens the PR and turns on auto-merge; no migration here).
- BQ-16 default: client takings use the same window (DF6-W-7).
- SA rulings SA-Q92 (route, pure branch of `resolveFinanceWindow`), SA-Q93 (shared extras, `none` resolution, one ruled update to the extras list pin), SA-Q94 (the cut-over only), SA-Q95 (no window on links past 92 inclusive days), SA-Q96 (pins byte-identical; a new test beside AC-173), SA-Q97 (isolation case in the existing route test), SA-Q98 (ceilings unchanged), SA-Q99 (one workplan, one PR).

**Builds on:** F-4's filter spec and request bridge (`financeFilters.ts`, `financeUrl.ts`), L-2a / L-8a's window extras (`adminWindow.ts`), M-1's links (`financeLinks.ts`) and summary, and 6a / 6b's margins (unchanged).

**Still in force:**
- SA-W6: client `from` / `to` are format-checked and ignored for every non-custom choice.
- SA-W3: cross-key U-4 repair, the dependent key is the bad filter.
- SA-W84: no Accounts tab with a business picked.
- SA-W56: `financeLinks.ts` imports only the wire types (see SA-W-DF6-3).
- AC-145: the Overview payload with no tab and no business is byte-identical.
- SA-WR-7: scoped `tsc` with a canary.

## Overview

DF-6 adds one window choice, **"Since it started"**, offered only while one business is picked. It runs from the charging cut-over instant (`CHARGING_CUTOVER_FLOOR_MS`, 2026-09-29 16:50:53.914 UTC) to the request's `now`, so it can be longer than 92 days. The route resolves it with a pure branch of `resolveFinanceWindow`; the builder, every read, every ceiling and the payload shape are unchanged. All businesses with this choice is a 400. On the page it is a Finance-only window extra (`range=since_start`), the shared resolver maps it to `none`, the links out never carry it, and a bad link drops only the window.

There is no migration and no new read, repository method, SQL function, table or write.

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify](#files-to-create--modify)
- [DF6.1 The window branch](#df61-the-window-branch)
- [DF6.2 The route](#df62-the-route)
- [DF6.3 Shared window extra](#df63-shared-window-extra)
- [DF6.4 Finance URL state and request bridge](#df64-finance-url-state-and-request-bridge)
- [DF6.5 The control and the labels](#df65-the-control-and-the-labels)
- [DF6.6 Links out](#df66-links-out)
- [DF6.7 AC-145 baseline and the frozen pins](#df67-ac-145-baseline-and-the-frozen-pins)
- [Entitlements registration check](#entitlements-registration-check)
- [Tenant isolation check](#tenant-isolation-check)
- [Guard table, line by line](#guard-table-line-by-line)
- [Test plan](#test-plan)
- [AC mapping](#ac-mapping)
- [Verification plan](#verification-plan)
- [Logging](#logging)
- [Risks](#risks)
- [Estimate](#estimate)
- [Task List](#task-list)
- [Checklist before SA code review](#checklist-before-sa-code-review)
- [Implementation Notes](#implementation-notes)
- [SA Workplan Review](#sa-workplan-review)
- [SA Code Review](#sa-code-review)
- [QA Report](#qa-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

I read the code at `ea56ad04` in the DF-6 worktree. Each fact below is one I checked myself.

| # | Fact | Where | Consequence |
|---|---|---|---|
| VL-1 | `resolveFinanceWindow(query, now)` sends every non-custom choice to `resolveAdminWindow(query.preset, now)` and then `windowInstants(dates)` (whole UTC days, end = next midnight) | `lib/business-os/finance/financeWindow.ts:53-63` | A `since_start` branch must return **before** `windowInstants`: `start` = the floor, `end` = `now`. The file already imports `CHARGING_CUTOVER_FLOOR_MS` (`:15`) |
| VL-2 | The route's enum is `z.enum(ADMIN_WINDOW_CHOICES)` (shared, `adminWindowPresets.ts:20`); `superRefine` already holds E-48, SA-W84 and the custom cap, in that order | `app/api/admin/business-os/finance/route.ts:88, :128, :140-160` | DF6-FR-1: a route-local `FINANCE_ROUTE_CHOICES = [...ADMIN_WINDOW_CHOICES, 'since_start'] as const`; the shared list is not edited. DF6-FR-2: one new `superRefine` issue |
| VL-3 | `requireAdmin` is the first call in GET (`:169`); the route test pins `requireAdmin(` before `searchParams` (`route.test.ts:1281-1290`) | route | Order unchanged (DF6-FR-5); the window line `:204-207` keeps its place |
| VL-4 | `FinanceWindowChoice` is a literal union at `financeTypes.ts:56`; `FinanceQuery.preset` is `AdminWindowChoice` at `financeUrl.ts:29` | types | E-80's three widenings confirmed at the stated lines |
| VL-5 | **The shared resolver** sends every extra other than `24h` / `90d` to `resolveDateExtra` | `app/admin/components/layout/adminWindow.ts:228-231` | E-76: an explicit `since_start` case first, returning `{ kind: 'none' }`. `resolveDateExtra`'s parameter type stays the four whole-date extras |
| VL-6 | `ADMIN_WINDOW_EXTRAS` (`:48`) and `ADMIN_WINDOW_EXTRA_LABELS` (`:51-58`, `Record<AdminWindowExtra, string>`, so TS forces the label) are pinned by exact `toEqual` | `adminWindow.test.ts:203-211` | The one ruled update (SA-Q93): both `toEqual`s gain `since_start` / "Since it started". No other exact list of the shared extras exists (`grep`): `activityFilters.test.ts:78` pins Activity's own four, `DatePresets.render.test.tsx:232` and `adminWindowExtras.parity.test.ts:17` pin the four date extras only |
| VL-7 | **Extras consumers:** Analytics (`analyticsFilters.ts:79`, `['24h','90d']`; `:220` reads `ROLLING_PERIOD_DAYS[value.extra]`, a `Record<string, number>`), Activity (`activityFilters.ts:47`) and Costs (`costsFilters.ts:36`) list their own extras, so `parseWindow` (`adminWindow.ts:111`) never returns `since_start` for them. Activity and Costs fall back to their default on `none` (`activityFilters.ts:93-97`, `costsFilters.ts:48-52`) | page filter files | U-4 holds with no edit to those pages. One test per page proves `range=since_start` is ignored (E-76) |
| VL-8 | `DatePresets` renders an extra's button from `ADMIN_WINDOW_EXTRA_LABELS[extra]` (`:178-187`) and seeds the Custom inputs from `resolveWindow` (`:86-90`): `none` gives empty inputs | `app/admin/components/layout/DatePresets.tsx` | No `DatePresets` edit. `AdminFilterBar` already forwards `windowControl.extras` (`AdminFilterBar.tsx:67, :181`) |
| VL-9 | **Finance's window field** is built with no extras and `parse` rejects every `extra` (`financeFilters.ts:78-93`, `:85`) | `financeFilters.ts` | `windowFilter({ …, extras: FINANCE_WINDOW_EXTRAS })` and `parse` accepts `extra` only when it is `since_start`. Whether a business is picked is the repair's job (SA-W3 shape), not the field's |
| VL-10 | **The first request is built before the repair runs.** `FinanceView` computes `toFinanceQuery(filters)` in `useMemo` (`FinanceView.tsx:110`) and repairs in a `useEffect` (`:121-124`) | `FinanceView.tsx` | `toFinanceQuery` must send `preset=this_month` for `since_start` with no account, so the request before and after the repair is the same string and the route is never asked for a 400 (DF6-FR-8 "no request is ever sent that the route would refuse"). See SA-W-DF6-4 |
| VL-11 | "All businesses" is the business chip's X (`onRemoveBusiness`, `FinanceView.tsx:152`: `setFilters({ account: '' })`); `AdminBusinessPicker` has no "All businesses" row | `FinanceView.tsx`, `AdminBusinessPicker.tsx` | DF6-FR-9's one write: `onRemoveBusiness` writes `{ account: '', window: FINANCE_DEFAULT_WINDOW }` when the window is `since_start`, otherwise `{ account: '' }` as today. Clear (`FINANCE_CLEAR_PATCH`, `financeFilters.ts:185-189`) already resets the window |
| VL-12 | **The page label** is `ADMIN_WINDOW_LABELS[data.window.preset]` / `[query.preset]` (`FinanceView.tsx:200-202`), keyed by `AdminWindowPreset \| 'custom'`. The same `windowLabel` feeds the header `asOf`, K-5's caption and every section subtitle | `FinanceView.tsx`, `FinanceKpiStrip.tsx:93`, sections | Widening `FinanceWindowChoice` makes this a type error, so `FinanceView` gets a `since_start` branch giving DF6-FR-9's line. Every other window's label is byte-identical |
| VL-13 | **`AccountSummary` has no window line today.** It shows figures, credits, the plan group and four links (`AccountSummary.tsx:170-254`); the window is shown only by the page header and section subtitles | `AccountSummary.tsx` | AC-266 ("the window line … in the account summary") and §11L.6 ("The summary's window line reads…") name a line that does not exist. See SA-W-DF6-2 |
| VL-14 | **`formatUtc(window.start)`** returns `"2026-09-29 16:50 UTC"` (`adminFormat.ts:21-27`), not "29 Sep 2026" (L-149), and carries its own " UTC" suffix | `adminFormat.ts` | DF6-FR-9 written literally gives "Since it started: 2026-09-29 16:50 UTC to now (UTC)". See SA-W-DF6-1 |
| VL-15 | **`financeLinks.ts` may import only `@/lib/business-os/finance/financeTypes`**, an exact-list pin with a planted control | `app/admin/finance/__tests__/source.guard.test.ts:192-196` | DF6-FR-10's "at most 92 inclusive days" needs `inclusiveDays` / `ADMIN_WINDOW_MAX_DAYS` (`adminWindowPresets.ts:28, :53`) or a local copy. The requirement's §11L.8 does not list this guard. See SA-W-DF6-3 |
| VL-16 | `wholeDayWindow` (`financeLinks.ts:31-39`) falls through to `range=<preset>`; `analyticsWindow` (`:42-50`) sends any other choice as `range=custom&from&to` with no length check; `section3AnalyticsHref` (`:91-96`) goes through `analyticsWindow`; `k1AnalyticsHref` uses a fixed This month (`:99`); `accountViewHref` (`:133-142`) writes `preset=<choice>` | `financeLinks.ts` | E-77: both window helpers branch on `since_start` with an exhaustive `never` default. `accountViewHref` is only reached from the Accounts tab (all businesses), so `since_start` never reaches it; it is left alone and a test records that its output would be a valid route request (SA-W-DF6-7) |
| VL-17 | `cutoverClamp(start, end)` gives `after_cutover` when `start >= CHARGING_CUTOVER_FLOOR_MS` (`aiActivity.ts:219-225`; the floor at `:146`); the builder reads from `clamp.readFrom` (`financeHealth.ts:541`) | credits, builder | AC-258 holds by construction: start = floor, so coverage is `after_cutover` and every margin is computed |
| VL-18 | The payload window is copied from the resolved window (`financeHealth.ts:1231-1237`); the route info line logs `window.preset`, `from`, `to` (`route.ts:257`) | builder, route | DF6-W-5 and DF6-FR-6 need no builder or log edit |
| VL-19 | "New in window" counts by `created_at` (`planGroups.ts:224`, `within(row.created_at, …)`); §11L.6 says `:225`, one line off | `planGroups.ts` | E-79 note only; no code change |
| VL-20 | **Pins at Step 0** (LF-normalised SHA-256), all equal to the 6b handover values:<ul><li>AC-173 `3a1a2dd4…f6f8`;</li><li>its helper `b84e0c96…aabf`;</li><li>Pin A `30f5fc24…2e01`;</li><li>Pin B `24ff0da7…df9f`;</li><li>Pin C `98ea0507…1e4b`;</li><li>its helper `02813360…5bd8`;</li><li>Pin D `1f7cf07a…f144`</li></ul> | `tr -d '\r' \| sha256sum` | Re-checked at handover |
| VL-21 | The AC-173 table (`financeRequestPins.ts`) has rows 1 to 15, all `preset=` requests, none with `since_start` (CF-9) | pin helper | The since-start request is pinned in a new `describe` in `financeUrlState.render.test.tsx`, never in the table |

---

## Scope

| In | Out |
|---|---|
| `since_start` branch of `resolveFinanceWindow` (AC-257)<br>Route enum and the "needs a business" 400 (AC-259, AC-260)<br>`since_start` as a shared window extra resolving to `none`, its label, the one ruled extras pin update (E-76)<br>Finance window field, request bridge, cross-key repair, chip X (DF6-FR-7 to DF6-FR-9)<br>The window label and the summary window line (DF6-FR-9, AC-266)<br>Links out: exhaustive branch, 92-day rule (DF6-FR-10, E-77)<br>Guards, tests, checks 29 and 30 | Any read, repository method, page size or ceiling<br>The builder (`financeHealth.ts`) and every section builder<br>The 92-day cap of Today, 7 days, 30 days, This month, Custom, Activity, Charge checks and AI calls & usage<br>The Accounts tab (all businesses only)<br>Time buckets<br>Any timezone read<br>History before the cut-over<br>Section 1's "new in window" rule (E-79, existing behaviour) |

---

## Questions for SA before code

Each has my suggestion; I build on it unless SA rules otherwise.

| # | Question | Dev suggestion |
|---|---|---|
| **SA-W-DF6-1** (VL-14) | DF6-FR-9 says `{from}` is `formatUtc(window.start)`; that gives "2026-09-29 16:50 UTC", so the line would read "…16:50 UTC to now (UTC)", and L-149 shows "29 Sep 2026" | Keep `formatUtc` (the §5.11 admin format; no new date format) and drop its " UTC" suffix, as `boundLabel` does in `adminWindow.ts:254-256`: **"Since it started: 2026-09-29 16:50 to now (UTC)"**. The copy function `sinceStartWindowLine(start: string)` in `financeCopy.ts` takes the already formatted text. QA reads L-149 against this text |
| **SA-W-DF6-2** (VL-13) | AC-266 and §11L.6 name a window line "in the account summary" that does not exist | Add one `<p className={NOTE} data-testid="account-summary-window">` under the summary heading, **rendered only for `since_start`**, with the same text as the page label. Every other window's summary stays byte-identical, so no existing summary render test changes. Alternative: show a window line for every window (more consistent, but it edits every M-1 summary render) |
| **SA-W-DF6-3** (VL-15) | `financeLinks.ts` may import only `financeTypes` (exact pin). The 92-day test needs the shared day count | **One ruled update of that pin** to `['@/lib/business-os/finance/financeTypes', '@/app/admin/components/adminWindowPresets']`, importing `inclusiveDays` and `ADMIN_WINDOW_MAX_DAYS`. That module is the shared one the links' targets use for their own cap (so the rule cannot drift), and it is not another admin page, which is what SA-W56 forbids. The planted control stays. Alternative with no guard edit: the server adds nothing and `financeLinks.ts` computes the day count from the two `YYYY-MM-DD` strings with a local `92`, plus a test pinning the local value equal to `ADMIN_WINDOW_MAX_DAYS` |
| **SA-W-DF6-4** (VL-10) | The request is built before the repair effect | `toFinanceQuery` maps `since_start` to `preset: 'since_start'` **only when `filters.account !== ''`**; with no account it sends the default window. So `range=since_start` with no account sends `preset=this_month` on the first render, the repair then writes `range` away, and the request string does not change (no second read). Same pattern as the tab, which `toFinanceQuery` already drops without an account (`financeFilters.ts:136`) |
| **SA-W-DF6-5** | Where `since_start` is listed for the page | `FINANCE_WINDOW_EXTRAS = ['since_start'] as const satisfies readonly AdminWindowExtra[]` in `financeFilters.ts`. The field always parses it (so a link is not lost while the account parses in the same read); the bar offers it only with a business (`extras: filters.account ? FINANCE_WINDOW_EXTRAS : []`); the repair drops it without a business |
| **SA-W-DF6-6** | §11L.8 asks the source guard to prove `financeWindow.ts` "reads no clock"; `k1Spans` already builds `new Date(<number>)` | The new rule forbids `Date.now(` and a zero-argument `new Date()` in `financeWindow.ts` (planted control: `const t = new Date();`), and forbids `user_preferences`, `timezone`, `onboarding_started_at`, `profile_created_at` and `created_at` there. A whole-folder `user_preferences` / `timezone` ban over `lib/business-os/finance/` and `app/admin/finance/` (AC-270) is a second rule, with a planted control |
| **SA-W-DF6-7** (VL-16) | `accountViewHref` with `since_start` | Not reachable (Accounts tab only, all businesses). Left unedited; one `financeLinks.test.ts` case records that it would write `preset=since_start&accountId=<id>`, which the route accepts, so no branch is needed |
| **SA-W-DF6-8** | The `from` label of the window | `from` = `new Date(CHARGING_CUTOVER_FLOOR_MS).toISOString().slice(0, 10)` (`2026-09-29`), `to` = `todayUtc(now)`. Computed, not a literal, so the label cannot drift from the constant |

---

## Analysis Summary

| Area | Touch |
|---|---|
| Pure logic | `financeWindow.ts` (one branch) |
| Types | `financeTypes.ts:56` `FinanceWindowChoice`; `financeUrl.ts:29` `FinanceQuery.preset` |
| Route | `route.ts`: local choices list, enum, one `superRefine` issue, header paragraph |
| Shared layout | `adminWindow.ts`: extras list, label, `resolveWindow` case, header paragraph |
| Page | `financeFilters.ts` (field, bridge, repair), `FinanceView.tsx` (label, chip X), `FinanceFilterBar.tsx` (extras), `AccountSummary.tsx` (window line), `financeCopy.ts` (two texts), `financeLinks.ts` (two branches, 92-day rule) |
| Builder, reads, repositories | **None** |
| DB | None |

## Implementation Approach

1. **Resolve once, on the server.** The route's only new logic is the enum value and the 400. `resolveFinanceWindow` returns `{ preset: 'since_start', from: '2026-09-29', to: todayUtc(now), start: floor, end: now }`. The builder sees an ordinary `ResolvedFinanceWindow`, so every section, ceiling and margin rule applies unchanged (DF6-W-6, DF6-P-1).
2. **The page never resolves it.** The shared resolver gives `none` (E-76); the page labels come from the payload (`window.start`), as M3-FR-13 requires; no component does date arithmetic.
3. **One rule per invalid combination, in one place.** No business with `since_start`: the field keeps it, `toFinanceQuery` does not send it, the repair removes it, the chip X removes it in the same write. Each is a one-line branch beside the existing tab rule.
4. **Links fail closed.** Both window helpers switch on `window.preset` with a `never` default; `since_start` goes out as custom dates while at most 92 inclusive days, else with no window.

---

## Files to Create / Modify

### Create

None. No new source or test file; the new cases go into existing test files.

### Modify

| File | Anchor | Change |
|---|---|---|
| `lib/business-os/finance/financeWindow.ts` | `:53-63` | `since_start` branch before `windowInstants`; header paragraph (DF-6, E-75) |
| `lib/business-os/finance/financeTypes.ts` | `:56` | `FinanceWindowChoice` gains `'since_start'`; doc comment on `FinanceWindowInfo.end` notes "now for since_start" |
| `app/admin/finance/financeUrl.ts` | `:25`, `:29`, `:73-88` | `FinanceQuery.preset: AdminWindowChoice \| 'since_start'`; the serialiser is unchanged (it already writes `preset` as is and dates only for custom) |
| `app/api/admin/business-os/finance/route.ts` | `:6-7`, `:88`, `:128`, `:140-160` | `FINANCE_ROUTE_CHOICES`; enum; issue "since_start needs a business picked" when `preset === 'since_start' && accountId === undefined`; header usage line and a DF-6 paragraph |
| `app/admin/components/layout/adminWindow.ts` | `:16-26`, `:48`, `:51-58`, `:228-231` | `'since_start'` appended to `ADMIN_WINDOW_EXTRAS`; label "Since it started"; explicit `since_start` case returning `{ kind: 'none' }` before the `resolveDateExtra` line; header paragraph |
| `app/admin/finance/financeFilters.ts` | `:78-93`, `:118-124`, `:132-141`, `:144-159`, `:176-182` | `FINANCE_WINDOW_EXTRAS`; field with extras, `parse` admits `since_start` only; `windowQuery` / `toFinanceQuery` (SA-W-DF6-4); `fromFinanceQuery` maps back to `{ kind: 'extra', extra: 'since_start' }`; repair branch "no account and `since_start` → window to default"; `isSinceStart(value)` helper |
| `app/admin/finance/components/FinanceView.tsx` | `:152`, `:200-202` | Chip X one write (VL-11); label branch (VL-12, SA-W-DF6-1) |
| `app/admin/finance/components/FinanceFilterBar.tsx` | `:72-77` | `extras: filters.account ? FINANCE_WINDOW_EXTRAS : []` |
| `app/admin/finance/components/AccountSummary.tsx` | `:170-200` | Window line for `since_start` only (SA-W-DF6-2) |
| `app/admin/finance/financeCopy.ts` | window copy block | `sinceStartWindowLine(start)`. The choice label lives in the shared `ADMIN_WINDOW_EXTRA_LABELS` |
| `app/admin/finance/financeLinks.ts` | `:25`, `:31-50`, header | Exhaustive `switch` in `wholeDayWindow` and `analyticsWindow`; `sinceStartFitsLinks(window)` (≤ 92 inclusive days); header paragraph |
| Tests | see [Test plan](#test-plan) | — |

**Not touched** (checked at handover with `git diff --exit-code`): `financeHealth.ts`, `financeHealthDeps.ts`, every builder in `lib/business-os/finance/` other than `financeWindow.ts`, `adminWindowPresets.ts`, `DatePresets.tsx`, `AdminFilterBar.tsx`, `analyticsFilters.ts`, `activityFilters.ts`, `costsFilters.ts`, `lib/repositories/**`, `supabase/**`, the seven pin files, `aiCostVocabulary.source.guard.test.ts`.

---

## DF6.1 The window branch

**File:** `lib/business-os/finance/financeWindow.ts` (sketch)

```typescript
import { resolveAdminWindow, todayUtc } from '@/app/admin/components/adminWindowPresets';

/** DF-6 (E-75): the charging cut-over's UTC date, the window's `from` label. */
const CUTOVER_DATE = new Date(CHARGING_CUTOVER_FLOOR_MS).toISOString().slice(0, 10);

export function resolveFinanceWindow(query: FinanceWindowQuery, now: Date): ResolvedFinanceWindow {
  if (query.preset === 'since_start') {
    // Instants, not whole days: from the cut-over to this request's clock (DF6-W-1, DF6-W-2).
    // Client from / to are ignored (SA-W6). No plan-row fact and no timezone (DF6-W-4).
    return { preset: 'since_start', from: CUTOVER_DATE, to: todayUtc(now), start: new Date(CHARGING_CUTOVER_FLOOR_MS), end: new Date(now.getTime()) };
  }
  // … unchanged; TS narrows query.preset to AdminWindowPreset | 'custom' below
}
```

- `query.from` / `query.to` sent with `since_start` are ignored (AC-259).
- A clock before the cut-over (tests only) gives `end <= start`, which `cutoverClamp` reads as `entirely_before_cutover`; no production path reaches it. A unit test records it so the behaviour is deliberate.

## DF6.2 The route

**File:** `app/api/admin/business-os/finance/route.ts`

```typescript
/** DF-6 (DF6-FR-1): Finance's own choice; the shared ADMIN_WINDOW_CHOICES is not edited. */
const FINANCE_ROUTE_CHOICES = [...ADMIN_WINDOW_CHOICES, 'since_start'] as const;
// preset: z.enum(FINANCE_ROUTE_CHOICES).default('this_month'),
// in superRefine, after SA-W84 and before the custom early return:
if (q.preset === 'since_start' && q.accountId === undefined) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'since_start needs a business picked' });
}
```

- `since_start` with `tab=accounts` and an account is already a 400 (SA-W84); with `tab` and no account it is a 400 by the new issue (DF6-FR-3).
- `since-start` (hyphen) is a 400 by the enum (AC-259).
- The window line (`:204-207`) is unchanged; the type now accepts the choice.
- The info line already logs `window.preset`, `from` and `to` (VL-18).

## DF6.3 Shared window extra

**File:** `app/admin/components/layout/adminWindow.ts`

- `ADMIN_WINDOW_EXTRAS` gains `'since_start'` (last). `ADMIN_WINDOW_EXTRA_LABELS.since_start = 'Since it started'`.
- `resolveWindow`, `case 'extra'`: first line `if (value.extra === 'since_start') return { kind: 'none' };` with the comment "the shared folder never resolves it; Finance resolves it on the server (E-76)". The narrowed type then reaches the existing `resolveDateExtra` call unchanged.
- No import is added (S-3 / S-4 hold).
- `adminWindow.test.ts:203-211`: **the one ruled update** (SA-Q93). Both `toEqual`s gain the new entry. The test title gains "(DF-6: since it started, SA-Q93)". No other assertion in that file is edited; new cases are added below it.

## DF6.4 Finance URL state and request bridge

**File:** `app/admin/finance/financeFilters.ts`

| Function | Change |
|---|---|
| `financeWindowField` | `windowFilter({ defaultValue, extras: FINANCE_WINDOW_EXTRAS })`; `parse` returns `undefined` for `linked` and for any `extra` other than `since_start` |
| `windowQuery(window, account)` | `since_start` with an account → `{ preset: 'since_start', from: null, to: null }`; without → the default (SA-W-DF6-4) |
| `toFinanceQuery` | passes `filters.account` to `windowQuery` |
| `fromFinanceQuery` | `query.preset === 'since_start'` → `{ kind: 'extra', extra: 'since_start' }` |
| `financeFilterRepair` | New first branch: `filters.account === '' && isSinceStart(filters.window)` → `{ window: FINANCE_DEFAULT_WINDOW }`. It composes with the existing branches: a URL with no account, `since_start` and stray tab keys gets both fixes over two effect runs, each a URL-only write with the same request |
| `financeCanClear`, `FINANCE_CLEAR_PATCH`, `financeWindowProblem` | Unchanged (Clear already resets the window; `financeWindowProblem` checks custom only) |

DF6-FR-8 cases: (a) no account → default window; (b) bad account → the account field drops it, then (a); (c) `from` / `to` beside `range=since_start` → `parseWindow` returns the extra before looking at dates, and `serialiseWindow` writes only `range`, so the useless dates leave the URL on the next write; (d) `tab=accounts` with an account → the existing branch drops the tab.

## DF6.5 The control and the labels

- **`FinanceFilterBar.tsx`**: `windowControl.extras` is `FINANCE_WINDOW_EXTRAS` while `filters.account !== ''`, else `[]`.
- **`FinanceView.tsx` chip X**: `setFilters(isSinceStart(filters.window) ? { account: '', window: FINANCE_DEFAULT_WINDOW } : { account: '' })`. One write.
- **`FinanceView.tsx` label**: `data.window.preset === 'since_start'` → `sinceStartWindowLine(formatUtc(data.window.start).replace(/ UTC$/, ''))`; before data, `ADMIN_WINDOW_EXTRA_LABELS.since_start`. Every other branch is unchanged.
- **`AccountSummary.tsx`**: when `window.preset === 'since_start'`, one `<p className={NOTE} data-testid="account-summary-window">` under the heading with the same text (SA-W-DF6-2).
- **`financeCopy.ts`**: `sinceStartWindowLine = (start: string) => \`Since it started: ${start} to now (UTC)\``. It uses no SA-Q51 vocabulary word, so the vocabulary guard needs no edit; its text count floor rises by one.

## DF6.6 Links out

**File:** `app/admin/finance/financeLinks.ts` (per SA-W-DF6-3)

```typescript
/** DF-6 (SA-Q95): a since-start span goes out as dates only while the targets accept it. */
function sinceStartFitsLinks(window: FinanceLinkWindow): boolean {
  return inclusiveDays(window.from, window.to) <= ADMIN_WINDOW_MAX_DAYS;
}

function wholeDayWindow(params: URLSearchParams, window: FinanceLinkWindow): void {
  switch (window.preset) {
    case 'today': case '7d': case '30d': case 'this_month': params.set('range', window.preset); return;
    case 'custom': setDates(params, window); return;
    case 'since_start': if (sinceStartFitsLinks(window)) setDates(params, window); return; // never range=since_start (E-77)
    default: { const unreachable: never = window.preset; return unreachable; }
  }
}
// analyticsWindow: today / this_month as presets; 7d, 30d, custom as dates; since_start as above; never default.
```

- Past 92 inclusive days the link carries only the account (and `tab=activity` for Activity), so the target opens on its default.
- Businesses, K-1 and Leak check links are unchanged.

## DF6.7 AC-145 baseline and the frozen pins

- **AC-145** (`route.test.ts:1135-1246`) is a no-tab, all-businesses `this_month` request: no new key, no new field, `window` unchanged. `EXPECTED_SHA256` stays `6761620e…5250`. The region is **not edited**. If it fails, that is a DF-6 defect, raised to SA, never a re-hash.
- **The seven pins** are byte-identical (VL-20). None reads the route enum or the extras list. The since-start request is pinned in a **new** `describe` in `financeUrlState.render.test.tsx` with its literal `preset=since_start&accountId=<uuid>` (SA-Q96). No re-freeze is expected.

---

## Entitlements registration check

No file in this diff imports from `lib/business-os/entitlements/` (type-only included), and none writes a capability id or tier literal. `financeWindow.ts` imports only the presets module, `aiActivity` and `creditReport`, as today. I still run `npm run test:bos-entitlements`, as the skill requires, and record the result.

## Tenant isolation check

Applied per the `tenant-isolation-guard` skill. The route is a service-role, cross-account admin read that takes a caller-supplied `accountId`.
- The window depends on no account data (E-75): it is the constant and `now`.
- `requireAdmin` stays first; the platform-account 404 and the builder's plan check (404 / 500) still run before any other read.
- Every account-scoped dep still receives exactly the checked id; no all-accounts read is reachable with a business picked, so none is reachable with `since_start`.
- The new route test case (SA-Q97) asserts it for account A with account B in the fixtures, one assertion per account-scoped dep, `countRevenueRows` and the all-accounts recorded read at zero calls, plus the 400 with no account where the builder is never called.

## Guard table, line by line

| Guard | Expected | Action |
|---|---|---|
| **Frozen pins** (AC-173 `3a1a2dd4…f6f8`, helper `b84e0c96…aabf`; Pin A `30f5fc24…2e01`; Pin B `24ff0da7…df9f`; Pin C `98ea0507…1e4b`, helper `02813360…5bd8`; Pin D `1f7cf07a…f144`) | Byte-identical | Hashed at Step 0 (VL-20) and at handover; full values in [Verification plan](#verification-plan) |
| AC-145 baseline (`route.test.ts:1135-1246`) | Unedited, green | — |
| `aiCostVocabulary.source.guard.test.ts` | Passes, **no edit**, no ALLOWED entry | "Since it started" and the window line use no SA-Q51 word; `git diff --exit-code` on the file |
| `layoutFolder.guard.test.ts` (C-14) | Passes, no edit | `adminWindow.ts` gains no import (S-3, S-4), no console (S-5); the migrated-pages registry is not changed |
| `test:authz-guard` | Passes, no edit | `requireAdmin` stays first in the route |
| `test:bos-entitlements` | Passes, no edit | No entitlements import touched |
| `adminWindow.test.ts:203-211` | **One ruled update** (SA-Q93) | The two `toEqual`s only |
| `app/admin/finance/__tests__/source.guard.test.ts:192-196` (links import pin) | **One ruled update if SA-W-DF6-3 is accepted**; otherwise unedited | Planted control unchanged |
| App source guard, other rules (types-only imports from `lib/business-os/finance`, no `console.`, `CLIENT_FOLD`, `MONEY_6A` / `MONEY_6B`) | Pass | No date arithmetic in components: the label only formats and strips a suffix |
| `finance.source.guard.test.ts` | Passes; **new** `describe('slice DF-6 …')` at the end | `financeWindow.ts`: no repository, Supabase, entitlements or server-only import, no `Date.now(` or zero-argument `new Date()`, no plan-row field name, no `user_preferences` / `timezone`; folder-wide `user_preferences` / `timezone` ban over `lib/business-os/finance/` and `app/admin/finance/` (AC-270); planted controls for each |
| `DatePresets`, `adminWindowExtras.parity`, Analytics / Activity / Costs filter tests | Pass; new cases only | — |
| Repository caller lists, `serviceColumn.guard`, `tierLiteral.forbidden`, webhook placement guards, contrast | Not tripped | Run unchanged |
| Health tests (`lib/admin/health/__tests__`) | Pass unchanged | — |

## Test plan

| Test file | What it asserts (new cases unless stated) |
|---|---|
| `lib/business-os/finance/__tests__/financeWindow.test.ts` | AC-257: with `now = 2026-10-17T12:34:56.789Z`, `since_start` gives `start` = `2026-09-29T16:50:53.914Z`, `end` = now exactly, `from` = `2026-09-29`, `to` = `2026-10-17`, `preset` = `since_start`; `from` / `to` in the query are ignored; at `now = 2027-03-01` the span is over 92 days and still resolved. AC-258: `cutoverClamp(start, end).coverage === 'after_cutover'`. A clock before the cut-over gives `end <= start` (deliberate, VL note). Existing cases unedited |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | AC-259: `since_start&accountId` → 200 with `window.preset` `since_start`, `window.start` the floor; `since_start` alone → 400 `INVALID_QUERY`, no read, dev detail "since_start needs a business picked"; with `tab=accounts` (with and without account) → 400; `from` / `to` sent with it → same `window` as without; `since-start` → 400. AC-260: existing `:460-464` unedited; new: 93 days with `accountId` → 400, 92 with `accountId` → 200. AC-261 / SA-Q97: in the AC-42 shape (`:529`), a since-start request for A calls every scoped dep with exactly A (never B), `countRevenueRows` and the all-accounts recorded read zero times; plan row missing → 404, plan check failing → 500, nothing else read. AC-262: the dep calls of a since-start request and a 92-day custom request (same account) are equal in methods, ids, page sizes and ceilings; only range start and end differ (custom end = next UTC midnight, since_start end = now). AC-271: the info line's `window` is `{ preset: 'since_start', from, to }` and carries no plan fact, amount or name. AC-145 region unedited |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | AC-263: with a since-start window and the ledger read at `reachedCeiling: true`, Section 3 is "at least" and `accountMargin.margin` / `marginAfterFees` are `unknown`; with the recorded read at its ceiling, "Recorded above charged" is unknown; never 0. AC-267: K-1 equals its value under This month (same `now`, same account); K-5 follows the window. AC-268 (unit part): an ILS boost in the window gives `other_currency` for both margins. Existing cases unedited |
| `app/admin/components/layout/__tests__/adminWindow.test.ts` | `:203-211` ruled update. New: `parseWindow` returns `since_start` only when listed; `resolveWindow({ kind: 'extra', extra: 'since_start' }, now)` is `{ kind: 'none' }`; `serialiseWindow` writes only `range=since_start` |
| `app/admin/components/layout/__tests__/DatePresets.render.test.tsx` | With `extras={['since_start']}` the button reads "Since it started" and is pressed for that value; Custom inputs open empty (resolves to `none`) |
| `app/admin/analytics/__tests__/analyticsFilters.test.ts`, `app/admin/business-os-llm/__tests__/activityFilters.test.ts`, `app/admin/business-os-llm/__tests__/costsFilters.test.ts` | U-4 (E-76): `range=since_start` parses to the page's default and the request is the default request |
| `app/admin/finance/__tests__/financeFilters.test.ts` | DF6-FR-7: the field parses `range=since_start` and legacy `preset=since_start`; `toFinanceQuery` with an account → `preset: 'since_start'`, without → `this_month` (SA-W-DF6-4); `fromFinanceQuery` round-trips. DF6-FR-8 (a) to (d) through `financeFilterRepair`. AC-173 bridge `describe` (`:91`) unedited |
| `app/admin/finance/__tests__/financeUrl.test.ts` | `serialiseFinanceUrl` writes `preset=since_start&accountId=<id>` and no dates even when `from` / `to` are set |
| `app/admin/finance/__tests__/financeUrlState.render.test.tsx` | AC-264 (new `describe`, beside AC-173, SA-Q96): `range=since_start&account=<uuid>` sends exactly `preset=since_start&accountId=<uuid>`; legacy `preset=since_start&accountId=<uuid>` reaches the same state; no account or a bad account → the address bar shows This month with no `range=since_start`, and the only request sent is `preset=this_month`; dates beside it are dropped; `tab=accounts&account=…` drops the tab. AC-265: the choice appears only after a pick; the chip X while selected switches to This month in **one** history write (spy on the hook's write count); Clear resets both |
| `app/admin/finance/__tests__/financeFilterBar.layout.render.test.tsx` | The Window control shows "Since it started" with a business and not without (L-148 automated) |
| `app/admin/finance/__tests__/financeAccount.render.test.tsx` | AC-266: with a since-start payload, `account-summary-window` reads "Since it started: 2026-09-29 16:50 to now (UTC)"; absent for every other window. AC-268: the summary's charged figure equals Section 3's; "Not available" never appears |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | AC-266: the header `asOf` and a section subtitle read the since-start line; other windows' labels unchanged (existing cases unedited) |
| `app/admin/finance/__tests__/financeLinks.test.ts` | AC-269: since-start from `2026-09-29` to `2026-12-29` (92 inclusive days) → Activity, Charge checks and AI calls & usage carry `range=custom&from&to` and the account; to `2026-12-30` (93) → account only, no `range`, `from`, `to`; no href ever contains `since_start` (all helpers, both spans); each href still parses back through the target's own spec (the existing contract helper); Businesses and K-1 unchanged; `accountViewHref` note (SA-W-DF6-7) |
| `app/admin/finance/__tests__/source.guard.test.ts` | Links import pin per SA-W-DF6-3 (ruled update or unedited); the existing `never`-free files keep passing |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | New DF-6 `describe` (SA-W-DF6-6, AC-270) with planted controls |

## AC mapping

| AC | Proven by |
|---|---|
| AC-257 | `financeWindow.test.ts` |
| AC-258 | `financeWindow.test.ts` (coverage); `financeAccount.render.test.tsx` (no "Not available") |
| AC-259 | `route.test.ts` validation cases |
| AC-260 | `route.test.ts` `:460-464` unedited plus the two `accountId` cases; preset cases unedited |
| AC-261 | `route.test.ts` isolation case (SA-Q97) and plan-check cases |
| AC-262 | `route.test.ts` same-reads comparison |
| AC-263 | `financeHealth.test.ts` ceiling cases |
| AC-264 | `financeUrlState.render.test.tsx`, `financeFilters.test.ts`, `financeUrl.test.ts`; the seven pins unchanged |
| AC-265 | `financeUrlState.render.test.tsx`, `financeFilterBar.layout.render.test.tsx`, Analytics / Activity / Costs filter tests |
| AC-266 | `financeAccount.render.test.tsx`, `financePage.render.test.tsx`, `adminWindow.test.ts` (label); vocabulary guard unedited and green |
| AC-267 | `financeHealth.test.ts` (K-1, K-2 to K-4 as of now, K-5 follows the window); QA against check 29 |
| AC-268 | `financeHealth.test.ts`, `financeAccount.render.test.tsx`; QA against check 29 |
| AC-269 | `financeLinks.test.ts` |
| AC-270 | `finance.source.guard.test.ts` DF-6 rules; V-8 `tsc`; V-10 diff shows no `supabase/` or `lib/repositories/` path |
| AC-271 | Guard table; V-9 hashes; AC-145 unedited; route info-line case |
| AC-272 | QA manual steps L-148 to L-154, recorded in the QA Report |

## Verification plan

The worktree has the `node_modules` junction. Never run `git stash`, `git worktree remove` or `npm install` through it. Each command runs alone; its own exit code is read, never through a pipe.

| # | Command | Evidence |
|---|---|---|
| V-1 | `npx jest app/admin/finance lib/business-os/finance app/api/admin/business-os/finance --ci` | Suites and tests passed |
| V-2 | `npx jest app/admin/components app/admin/analytics app/admin/business-os-llm --ci` (layout, `adminWindow`, `DatePresets`, parity, Pin A, layout folder, contrast, extras pages) | Pass |
| V-3 | `npx jest app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` | Pass; `git diff --exit-code` on the file is 0 |
| V-4 | `npm run test:authz-guard` | Exit 0 |
| V-5 | `npm run test:bos-entitlements` | Exit 0 |
| V-6 | `npm run lint:hooks` | Exit 0 |
| V-7 | `npx eslint <every touched file>` | Clean |
| V-8 | Scoped `tsc` with a canary (SA-WR-7): scratch tsconfig **outside the worktree**, absolute `extends`, `noEmit`, `incremental: false`, `include` = `types/**/*.d.ts`, `next-env.d.ts`, every touched file, the seven pin files, and `analyticsFilters.ts`, `activityFilters.ts`, `costsFilters.ts`, `DatePresets.tsx`, `AdminFilterBar.tsx` (the widened extra type reaches them); plant `const __canary: number = 'x';` in `financeWindow.ts`, expect exactly one TS2322, remove (`grep -c __canary` = 0), re-run clean | Both runs recorded |
| V-9 | The seven pin hashes (`tr -d '\r' < f \| sha256sum`) | Equal to the table below |
| V-10 | `git diff --stat` and `--numstat` read **before** the diff: no deletion-only file; no `supabase/`, `lib/repositories/`, `financeHealth.ts` path; no requirement MD edit by Dev beyond the §0.1 workplan link | Pasted |
| V-11 | `git diff --exit-code` on the "Not touched" list | Exit 0 |
| V-12 | Checks 29 and 30 (read-only, Supabase SQL editor) with the owner test account id in each `p` block | Compared with K-5, the summary, Section 3 (L-150) |

**Expected pin hashes (from the 6b handover, re-confirmed at Step 0):**

| Pin | Hash |
|---|---|
| AC-173 `app/admin/finance/__tests__/financeRequest.pin.render.test.tsx` | `3a1a2dd415b3d0e0ffe44488a8c410b8e67a0bedf2ca908bbf064b6708bcf6f8` |
| AC-173 helper `app/admin/finance/__tests__/financeRequestPins.ts` | `b84e0c961e60c994414af7b418dd7f9dc94273e45695d632956427fade68aabf` |
| Pin A `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` | `30f5fc24f4e46870033ecdc984efa1c0647f633256f73ccfb302fa9899e62e01` |
| Pin B `app/admin/finance/__tests__/financeTiles.pin.render.test.tsx` | `24ff0da7efb824ccc2b5d90687e34b3cd9da33803658dccf19c0d096ae56df9f` |
| Pin C `app/admin/finance/__tests__/chargeChecksRequest.pin.render.test.tsx` | `98ea05072007b028604e782e43a3cbbc3c0098d360a11a76491be88afc111e4b` |
| Pin C helper `app/admin/finance/__tests__/chargeChecksRequestPins.ts` | `028133609122976f034c71bc841dde4b95c170a592862500bc6381ad2e545bd8` |
| Pin D `lib/admin/health/__tests__/m5WordingOnly.pin.test.ts` | `1f7cf07af1ea07975badca277c903a5568793cd4e88ff49f83ff9cdff34af144` |

**V-12 expectations.** Check 29's `window_start` is `2026-09-29 16:50:53.914+00`; for the owner test account its `usd_revenue_after_tax_minor`, `usd_fee_minor`, `ai_cost_usd`, `ai_margin_usd` and `margin_after_fees_usd` equal K-5, "Paid us", charged AI cost, AI margin and the margin after fees (with "Stripe fees, estimate" = `usd_fee_minor` / 100). Check 30 counts what the view leaves out (BQ-16). Known difference: check 29's `end_at` is the SQL `now()`, the page's is the request clock, so a charge between the two runs explains a small gap; run them back to back.

**Manual QA steps (proposal; QA's list governs):** L-148 to L-154 as written in §11L.9, with L-149's line read as "Since it started: 2026-09-29 16:50 to now (UTC)" if SA accepts SA-W-DF6-1.

## Logging

- No `console.*` is added. I count existing `console.*` calls in each touched file before editing; I expect none (the finance and layout guards forbid them). Any found are flagged per CLAUDE.md § Logging.
- No new log line. The route's info line already logs `window.preset`, `from`, `to` and `durationMs` (L-153 reads it).

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The first render sends `preset=since_start` with no account before the repair (a 400 shown as an error) | Medium if missed | SA-W-DF6-4; the `financeUrlState` case asserts the only request is `preset=this_month` |
| Widening `AdminWindowExtra` breaks a page that maps extras by key | Low | VL-7: Analytics' map is `Record<string, number>` and unreachable; V-8 includes the three extras pages |
| A link sends `range=since_start` and the target silently drops it | Low | E-77 exhaustive `never`; the "no href contains `since_start`" assertion |
| A busy account reaches a ceiling over the long window | Business, expected | Existing "At least" / Unknown rules (DF6-W-6); L-153 records timing and whether the owner account comes near it |
| The label format differs from L-149 | Low | SA-W-DF6-1 ruling before code |
| A pin or AC-145 changes | Very low | No pin reads the enum or extras (VL-21); AC-145 has no new field; hashed twice |
| The requirement MD has uncommitted coordinator edits in this worktree | Low | Dev edits only the §0.1 DF-6 workplan cell; V-10 checks it |

## Estimate

**About 1.5 days** (§11L.12; SA's 1.25 to 1.5):
- window branch, route enum and rule, unit and route tests (isolation, same reads): 0.5 d;
- shared extra, field, bridge, repair, chip X, control, labels, summary line, render tests: 0.5 d;
- link rule, source guards, extras-page tests, hashes, `tsc`, checks 29 and 30, handover: 0.5 d.

## Task List

- [x] ✅ Step 0: branch confirmed (`feature/bos-finance-health-df6`); the seven pins hashed (VL-20); line anchors confirmed (VL-1 to VL-21)
- [x] ✅ Step 1: SA workplan review (SA-WR-DF6) approved with conditions; rulings SA-W-DF6-1 to -8 and DF6-R1 to DF6-R3 applied
- [x] ✅ Step 2: baseline on the untouched tree: `npx jest app/admin/finance lib/business-os/finance app/api/admin/business-os/finance app/admin/components app/admin/analytics app/admin/business-os-llm --ci` → 86 suites, 4214 passed
- [x] ✅ Step 3: `financeTypes.ts`, `financeUrl.ts` type widenings (E-80)
- [x] ✅ Step 4: `financeWindow.ts` branch + `financeWindow.test.ts` (AC-257, AC-258)
- [x] ✅ Step 5: route `since_start` + 400 + `route.test.ts` (AC-259 to AC-262, AC-271); AC-145 untouched and green. **Deviation D-1** (the pinned schema is not edited)
- [x] ✅ Step 6: `financeHealth.test.ts` cases (AC-263, AC-267, AC-268), no builder edit
- [x] ✅ Step 7: `adminWindow.ts` extra, label, `none` case + the ruled `adminWindow.test.ts:203-211` update + `DatePresets` and extras-page tests (E-76)
- [x] ✅ Step 8: `financeFilters.ts` field, bridge, repair + `financeFilters.test.ts`, `financeUrl.test.ts` (DF6-FR-7, DF6-FR-8)
- [x] ✅ Step 9: `FinanceFilterBar.tsx`, `FinanceView.tsx`, `AccountSummary.tsx`, `financeCopy.ts` + render tests (AC-264 to AC-266)
- [x] ✅ Step 10: `financeLinks.ts` exhaustive branches and 92-day rule + `financeLinks.test.ts` (AC-269); the ruled links import pin update (E-83)
- [x] ✅ Step 11: DF-6 source-guard rules with planted controls (AC-270, DF6-R1)
- [x] ✅ Step 12: verification, pin hashes, Implementation Notes; status → Code Complete. One open type item for SA (D-2)

## Checklist before SA code review

- [x] ✅ Every SA-W-DF6 ruling applied, or each deviation recorded with a reason (D-1 to D-3)
- [x] ✅ The seven pins byte-identical; AC-145 region and `financeHealth.ts` unchanged
- [x] ✅ DF6-R3: exactly two ruled test edits (`adminWindow.test.ts:203-211`, `source.guard.test.ts:196`), quoted below; every other test change is additions only (`git diff --numstat`: 0 deletions)
- [x] ✅ The vocabulary guard file unchanged and green
- [x] ✅ No `console.*` and no `any` added; `@/` imports
- [x] ✅ `git diff --numstat` read before the diff: no deletion-only file
- [x] ✅ Verification pasted with each command's own exit code
- [x] ✅ Nothing committed (RM commits under BD-33)

## Implementation Notes

**Built 2026-10-17 in `neuronforge-finance-m8`, branch `feature/bos-finance-health-df6`, uncommitted.** Dev edited the requirement MD only for the §0.1 workplan link (before this build).

### Files

| File | Change |
|---|---|
| `lib/business-os/finance/financeTypes.ts` | `FinanceWindowChoice` gains `since_start`; `end` doc |
| `lib/business-os/finance/financeWindow.ts` | `CUTOVER_DATE` from the constant; `since_start` branch (start = floor, end = copy of `now`, `from` 2026-09-29, `to` = `todayUtc(now)`); header |
| `app/admin/finance/financeUrl.ts` | `FinanceQuery.preset: AdminWindowChoice \| 'since_start'` (serialiser untouched: Pin C region) |
| `app/api/admin/business-os/finance/route.ts` | `parseFinanceQuery` around the pinned schema (D-1); `SINCE_START_NEEDS_A_BUSINESS`; header |
| `app/admin/components/layout/adminWindow.ts` | `since_start` in `ADMIN_WINDOW_EXTRAS`, label "Since it started", explicit `none` case; header |
| `app/admin/finance/financeFilters.ts` | `FINANCE_WINDOW_EXTRAS`, `isSinceStart`; field admits only that extra; `windowQuery(window, account)`; `fromFinanceQuery` maps back; repair branch; header |
| `app/admin/finance/components/FinanceView.tsx` | `windowLabelOf` (the one place the line is built, DF6-R2); `sinceStartLine` passed to the summary; chip X one write |
| `app/admin/finance/components/FinanceFilterBar.tsx` | `extras` only with a business |
| `app/admin/finance/components/AccountSummary.tsx` | `windowLine` prop, shown as given, only when set |
| `app/admin/finance/financeCopy.ts` | `sinceStartWindowLine` |
| `app/admin/finance/financeLinks.ts` | `setDates`, `sinceStartFitsLinks` (shared `inclusiveDays` / `ADMIN_WINDOW_MAX_DAYS`), exhaustive `switch` with `never` in both helpers |
| Tests (additions only, except the two ruled edits) | `financeWindow.test.ts`, `route.test.ts`, `financeHealth.test.ts`, `finance.source.guard.test.ts`, `adminWindow.test.ts`, `DatePresets.render.test.tsx`, `analyticsFilters.test.ts`, `activityFilters.test.ts`, `costsFilters.test.ts`, `financeFilters.test.ts`, `financeUrl.test.ts`, `financeUrlState.render.test.tsx`, `financeFilterBar.layout.render.test.tsx`, `financeAccount.render.test.tsx`, `financePage.render.test.tsx`, `financeLinks.test.ts`, app `source.guard.test.ts` |

Untouched, `git diff --quiet` exit 0: `financeHealth.ts`, `financeHealthDeps.ts`, `adminWindowPresets.ts`, `DatePresets.tsx`, `AdminFilterBar.tsx`, `analyticsFilters.ts`, `activityFilters.ts`, `costsFilters.ts`, `lib/repositories`, `supabase`, `aiCostVocabulary.source.guard.test.ts`.

### The two ruled test edits (DF6-R3), verbatim

```diff
--- a/app/admin/components/layout/__tests__/adminWindow.test.ts
@@ -202,3 +202,3 @@
-    expect(ADMIN_WINDOW_EXTRAS).toEqual(['24h', '90d', 'yesterday', 'this_week', 'last_week', 'last_month']);
+    expect(ADMIN_WINDOW_EXTRAS).toEqual(['24h', '90d', 'yesterday', 'this_week', 'last_week', 'last_month', 'since_start']);
@@ -210,2 +210,3 @@
       last_month: 'Last month',
+      since_start: 'Since it started',
--- a/app/admin/finance/__tests__/source.guard.test.ts
@@ -196 +196 @@
-    expect(importsOf(codeOf(LINKS))).toEqual(['@/lib/business-os/finance/financeTypes']);
+    expect(importsOf(codeOf(LINKS))).toEqual(['@/lib/business-os/finance/financeTypes', '@/app/admin/components/adminWindowPresets']);
```

The `adminWindow.test.ts` test title was left as is (the workplan suggested a suffix; not needed, one edit fewer).

### Deviations

| # | Deviation | Reason |
|---|---|---|
| D-1 | **The route's Zod schema is not edited.** `since_start` is admitted by `parseFinanceQuery`, around `buildQuerySchema`: for `preset=since_start` every other key goes through the unchanged strict schema (unknown keys, the format of an ignored `from` / `to`, E-48, SA-W84), then the choice is accepted only with `accountId`, else a `ZodError` with "since_start needs a business picked", so the 400 body and the development detail have the same shape as every other 400 | **AC-173 part B hashes the text from `const DATE =` to the end of `buildQuerySchema`** (`financeRequest.pin.render.test.tsx:116-123`, constant in the pin). The planned enum and `superRefine` edits failed it on the first run (1 failure). SA-Q96 / VL-21 said no pin reads the route enum: that was wrong. Editing the schema would need a re-freeze of a frozen pin; working around it keeps all seven pins and AC-145 byte-identical. DF6-FR-1's intent (shared `ADMIN_WINDOW_CHOICES` not edited) holds. **SA please confirm** |
| D-2 | **One type error in an existing test, not edited.** `financeLinks.test.ts:36` (`windowFor` calls `resolveAdminWindow(preset)` with `preset: FinanceWindowChoice` minus `custom`) no longer type-checks once E-80 widens `FinanceWindowChoice`. ts-jest does not type-check, so the suite is green; the scoped `tsc` reports it | Fixing it is a third edit to an existing test, which DF6-R3 does not allow. Proposed one-line ruled edit: `function windowFor(preset: Exclude<FinanceWindowChoice, 'since_start'>)` (and the same type on `PRESETS` at `:39`). **SA to rule** |
| D-3 | The window line is built in `windowLabelOf` (a module function in `FinanceView.tsx`), called once per render; `sinceStartLine` reuses its result | DF6-R2 (built once, in the view, passed down), without a cast on `ADMIN_WINDOW_LABELS` |

### Verification (each command run alone; exit code read from the tool)

| # | Command | Exit | Result |
|---|---|---|---|
| V-1a | `npx jest app/admin/finance --ci` | 0 | 19 suites, **649 passed** (one existing `act()` console note, as in 6b) |
| V-1b | `npx jest lib/business-os/finance --ci` | 0 | 16 suites, **1668 passed** |
| V-1c | `npx jest app/api/admin/business-os/finance --ci` | 0 | 1 suite, **106 passed** (AC-145 baseline unedited) |
| V-2 | `npx jest app/admin/components --ci` | 0 | 25 suites, **824 passed** (Pin A, layout folder C-14, contrast, `adminWindow`, `DatePresets`, parity) |
| V-2b | `npx jest app/admin/components app/admin/analytics app/admin/business-os-llm --ci` | 0 | 50 suites, **1868 passed** |
| — | Same 86 suites as the baseline | — | 4214 → **4291** passed (+77 new), 0 failed |
| V-3 | `npx jest app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` | 0 | **182 passed**; `git diff --exit-code` on the file: 0 |
| V-4 | `npm run test:authz-guard` | 0 | 2 suites, **203 passed** |
| V-5 | `npm run test:bos-entitlements` | 0 | 280 suites, **8583 passed** |
| V-6 | `npm run lint:hooks` | 0 | Clean |
| V-7 | `npx eslint` on the 28 changed `.ts` / `.tsx` files | 0 | Clean (one unused-variable warning in `route.ts` fixed, re-run clean) |
| V-8 | Scoped `tsc`: scratch `tsconfig.df6.json` outside the worktree (absolute `extends`, `noEmit`, `incremental: false`), 43 files: the 28 changed, the seven pin files, `analyticsFilters.ts`, `activityFilters.ts`, `costsFilters.ts`, `tabWindowFilter.ts`, `DatePresets.tsx`, `AdminFilterBar.tsx`, `AccountsTab.tsx`, `financeHealth.ts`, plus `types/**/*.d.ts` and `next-env.d.ts` | canary: 2; clean: 2 | Canary run: **2** errors, the canary `financeWindow.ts(104,7) TS2322` and D-2. Canary removed by restoring the saved copy: `sha256sum -c` OK, `grep -c __canary` = 0. Clean run: **1** error, D-2 only (`financeLinks.test.ts(36,42) TS2345`) |
| V-9 | Pin hashes (`tr -d '\r' < f \| sha256sum`) | — | All seven equal (table below) |
| V-10 | `git diff --numstat` | — | 29 paths; no deletion-only file; deletions only in source files and the two ruled test lines; no `supabase/`, `lib/repositories/` or `financeHealth.ts` |

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

### Logging and `console.*`

No touched source file has a `console.*` call (grep exit 1). No log line added; the route's info line already carries `window` (AC-271 test).

### Owed to QA / the user

Checks 29 and 30 with the owner test account, then L-148 to L-154 (L-149 line: "Since it started: 2026-09-29 16:50 to now (UTC)").

---

## SA Workplan Review

**Reviewed by SA, 2026-10-17, at `ea56ad04`.**
**Status: APPROVED WITH CONDITIONS (SA-WR-DF6).** Implementation may start; DF6-R1 to DF6-R3 apply.

**Spot-checked in code:** `source.guard.test.ts:192-196` (exact import list with a planted control); `adminWindowPresets.ts:28` / `:53` export `ADMIN_WINDOW_MAX_DAYS` and `inclusiveDays`; `formatUtc` returns `YYYY-MM-DD HH:MM UTC`; `FinanceView.tsx:110` builds the query in `useMemo` before the repair `useEffect` at `:121-124`; `AccountSummary.tsx` has no window line; every test file named in the plan exists. VL-1 to VL-21 match what I read in the requirement review.

### Rulings

| # | Ruling |
|---|---|
| SA-W-DF6-1 | **Accepted.** `formatUtc(window.start)` with the trailing " UTC" removed: "Since it started: 2026-09-29 16:50 to now (UTC)". There is no new date format. The requirement is amended in DF6-FR-9, AC-266 and L-149 (**E-81, applied by SA**) |
| SA-W-DF6-2 | **Accepted: `since_start` only.** Existing summary renders stay byte-identical. **DF6-R2:** the label text is computed **once**, in `FinanceView` (where `windowLabel` already lives), and passed to `AccountSummary` as a prop. The summary does not format or strip anything itself. The requirement is amended in §11L.6 and AC-266 (**E-82, applied**) |
| SA-W-DF6-3 | **Accepted: one ruled update of the pin.** The list becomes `['@/lib/business-os/finance/financeTypes', '@/app/admin/components/adminWindowPresets']`. The presets module is the shared source of the targets' own cap, not another admin page, so SA-W56's intent holds. Do not add a local `92`. The planted control is unchanged. A §11L.8 row was added (**E-83, applied**) |
| SA-W-DF6-4 | **Accepted.** `toFinanceQuery` sends the default window for `since_start` when no business is picked, the same pattern as the tab at `financeFilters.ts:136`. The render test must assert that **one** request is sent (`preset=this_month`), not two. The route's 400 stays as the server backstop |
| SA-W-DF6-5 | Accepted. Parse always; offer only with a business; the repair drops it otherwise |
| SA-W-DF6-6 | Accepted. **DF6-R1:** the folder-wide `user_preferences` / `timezone` ban covers non-test sources only, and excludes `__tests__/`, because the guard itself names the tokens. It keeps a planted control |
| SA-W-DF6-7 | Accepted. Leave `accountViewHref` unedited; the recording test is enough |
| SA-W-DF6-8 | Accepted. Compute `CUTOVER_DATE` from the constant |
| VL-19 | `planGroups.ts:224`, corrected in §11L.6 (**E-84, applied**) |

### Checks

| Area | Result |
|---|---|
| File list vs §11L and E-75 to E-80 | ✅ Complete. The builder, reads, repositories and `supabase/` are untouched, and the "Not touched" list is checked by `git diff --exit-code` |
| Task-to-AC map | ✅ AC-257 to AC-272 are each mapped. AC-263, AC-267 and AC-268 sit in `financeHealth.test.ts` with no builder edit, which is correct |
| Isolation (SA-Q97) | ✅ The A/B case, the zero all-accounts calls, and the 400 with no builder call |
| Pins | ✅ The seven hashes match the 6b handover. AC-145 is unedited. **DF6-R3:** exactly two ruled test edits are allowed, `adminWindow.test.ts:203-211` and `source.guard.test.ts:196`, and the handover lists their diffs verbatim |
| Guards / vocabulary / entitlements / authz | ✅ As tabled |
| CI time | ✅ No new job; the cases go into existing suites |
| Estimate | ✅ 1.5 days accepted |

### Approval
[x] Workplan approved. Proceed to implementation under DF6-R1 to DF6-R3.

## SA Code Review

**Code Review by SA, 2026-10-17. Reviewed: the uncommitted diff on `feature/bos-finance-health-df6`, 29 paths.**
**Status: Code Approved (SA-CR-DF6).** No conditions.

### Deviation rulings

| # | Ruling |
|---|---|
| D-1 | **Approved.** SA-Q96 / VL-21 were wrong: AC-173 part B hashes the text from `const DATE =` to the end of `buildQuerySchema`. `parseFinanceQuery` is the right answer, because it keeps a frozen pin frozen. A since-start request still passes every other key through the unchanged strict schema (unknown keys, the date format of an ignored `from` / `to`, E-48, SA-W84). The choice is then accepted only with `accountId`. The 400 has the same body shape as every other 400. Any other value, `since-start` included, is still the schema's own 400. Recorded in §0.3 (SA-CR-DF6) as a correction to SA-Q96 |
| D-2 | **Approved, and applied by SA. This amends DF6-R3:** a third ruled test edit is allowed, `financeLinks.test.ts:34` and `:39`, which narrows `windowFor` and `PRESETS` to `Exclude<FinanceWindowChoice, 'since_start'>`. Type only; no assertion changed. SA re-ran the scoped `tsc` (Dev's `tsconfig.df6.json`). Canary run: **1** error (`financeWindow.ts(104,7) TS2322`, the canary). File restored from the saved copy: `sha256sum -c` OK, `grep -c __canary` = 0. Clean run: **0 errors, exit 0** |
| D-3 | Approved: `windowLabelOf` builds the label in one place, which meets DF6-R2 |

### Checks against §11L, E-75 to E-84 and DF6-R1 to DF6-R3

| Item | Result |
|---|---|
| Window resolved in the route, purely (E-75, SA-Q92) | ✅ `resolveFinanceWindow` `since_start` branch: floor to a copy of `now`; `CUTOVER_DATE` is computed from the constant; no plan-row fact and no timezone |
| No account gives a 400 that never reaches the builder | ✅ `parseFinanceQuery`. Route test "no business → 400 INVALID_QUERY, no read"; dev detail case |
| Isolation (SA-Q97) | ✅ For account A: nine scoped deps each called with A only; 14 all-accounts deps not called; B's id appears in no call |
| Links never carry `since_start` (E-77, E-83) | ✅ Exhaustive `switch` with a `never` default in both helpers; ≤ 92 days uses the shared `inclusiveDays` / `ADMIN_WINDOW_MAX_DAYS`, otherwise the account only |
| U-4 (DF6-FR-8) | ✅ The field parses only that extra; repair branch; the chip X makes one write; Clear; tested for (a) to (d) |
| First request (SA-W-DF6-4) | ✅ No business or a bad business: `requests()` equals `[pinnedRequest(1)]`, exactly one request |
| Timezone ban (AC-270, DF6-R1) | ✅ Planted control; scope proven to contain no `__tests__` file |
| Label (E-81, E-82) | ✅ Built once in `FinanceView`; the summary shows the prop as given, `since_start` only |
| Shared extra (E-76) | ✅ Explicit `none` case before `resolveDateExtra`; Analytics, Activity and Costs ignore it (tests) |
| Seven pins, recomputed by SA (LF-normalised) | ✅ `3a1a2dd4`, `b84e0c96`, `30f5fc24`, `24ff0da7`, `98ea0507`, `02813360`, `1f7cf07a`, all equal |
| AC-145 | ✅ `route.test.ts` diff is +172 / −0 |
| Vocabulary guard | ✅ File untouched; 182 passed |
| Untouched set | ✅ `git diff --quiet` on `financeHealth.ts`, `lib/repositories`, `supabase`, the vocabulary guard |
| Standards | ✅ Zod at the boundary, `requireAdmin` first, no `console.*`, no `any`, comments say why. Test edits are additive except the three ruled ones |

**SA re-run:** `npx jest app/admin/finance lib/business-os/finance app/api/admin/business-os/finance app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` gave 37 suites, **2605 passed**, 0 failed (after the D-2 edit).

### Optimisation Suggestions
- None blocking.

### Code Approved for QA: Yes

## QA Report

**QA — 2026-10-17**
**Test mode:** full
**Strategy used:** A + B:
- Jest window, route, builder, render, link and guard suites, run one at a time.
- An independent QA probe against the real pure modules: a temporary untracked `zz_qa_df6_probe.test.ts` that reuses the filter test's parse helper verbatim. It ran 6/6 and was deleted (`git status` clean of it).
- A code read of the D-1 wrapper, a scoped tsc with a canary, and an editor-safety scan of checks 29 and 30.

The browser look and checks 29 and 30 on production are the user's (L-148 to L-154).
**Focus:** api, ui, security
**Skipped:** the live browser look and the live checks 29 and 30 (user, below).
**Input source:** prompt + workplan

**Verdict: PASS. No bugs.**

### Suite runs (each alone, worktree `neuronforge-finance-m8`, branch `feature/bos-finance-health-df6`, uncommitted)

| Suite | Result |
|---|---|
| `app/admin/finance` | 19/19, 649/649 |
| `lib/business-os/finance` | 16/16, 1668/1668 |
| `app/api/admin/business-os/finance` (incl. the AC-145 baseline) | 1/1, 106/106 |
| `app/admin/components` (`adminWindow`, `DatePresets`, parity, C-14, contrast, Pin A) | 25/25, 824/824 |
| `app/admin/analytics` + `app/admin/business-os-llm` (the three extras pages) | 25/25, 1044/1044 |
| Vocabulary guard | 1/1, 182/182; file unedited |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 280/280, 8583/8583 |
| `npm run lint:hooks` | exit 0 |

These match Dev's and SA's counts.

**Pins (LF-normalised):** AC-173 `3a1a2dd4…f6f8` ✅, helper `b84e0c96…aabf` ✅, A `30f5fc24…2e01` ✅, B `24ff0da7…df9f` ✅, C `98ea0507…1e4b` ✅, C helper `02813360…5bd8` ✅, D `1f7cf07a…f144` ✅. `git diff --quiet HEAD` is clean on these and on the whole "Not touched" set: `financeHealth.ts`, `financeHealthDeps.ts`, `adminWindowPresets.ts`, `DatePresets.tsx`, `AdminFilterBar.tsx`, the three page filter files, `lib/admin/health`, `lib/repositories`, `supabase`.

**Test-file deletions** are exactly the three ruled edits (DF6-R3 as amended): `adminWindow.test.ts` 1, `financeLinks.test.ts` 2 (D-2), `source.guard.test.ts` 1. Every other test change is additions only.

**Scoped tsc:**
- Config in the scratchpad covering 43 files: the changed files, the seven pins, the extras pages, `DatePresets`, `AdminFilterBar`, `AccountsTab` and `financeHealth`.
- A canary in `financeWindow.ts` gave `(104,7) TS2322` only.
- The file was restored with `cp` and checked with `cmp` (identical; numstat back to 20/2).
- The clean run gives **exit 0, 0 errors**, which confirms that D-2 is resolved.

### Edge cases

| Case | Result | Evidence |
|---|---|---|
| `since_start` with no account gives 400 and never reaches the builder | ✅ | route test "no business → 400 INVALID_QUERY, no read". A code read of `parseFinanceQuery` (`route.ts`, D-1) shows it returns the ZodError before `GET` reaches any read |
| With an account: start = cut-over, end = now | ✅ | QA probe: `2026-09-29T16:50:53.914Z`; `end` equals `now` and is a copy; `from` 2026-09-29, `to` = today. At 2027-06-01 the start is unchanged |
| `from` / `to` alongside are ignored | ✅ | QA probe (window); route test (same window); page: `range=since_start&account=A&from&to` sends exactly `preset=since_start&accountId=A` |
| A bad `range` drops only the window (U-4) | ✅ | QA probe: `bogus`, `SINCE_START`, `since-start` and `24h` each give This month and keep the account |
| Activity and Charge-checks links never carry `since_start` | ✅ | QA probe at 19, 92, 93 and 365 days. ≤ 92 inclusive days gives `range=custom&from=2026-09-29&to`; ≥ 93 gives the account only. Businesses, Leak check and K-1 are unchanged. The `never` default is in both helpers |
| Exactly one first request when no business is picked | ✅ | QA probe: `range=since_start`, `preset=since_start`, a bad account, and an uppercase account plus junk each send the This-month request, and the repair drops the window. The render test asserts `requests()` equals `[pinnedRequest(1)]` |
| Label | ✅ | `sinceStartWindowLine('2026-09-29 16:50')` gives "Since it started: 2026-09-29 16:50 to now (UTC)"; render test AC-266 |
| Margins are figures, not "Not available" | ✅ | builder "coverage after the cut-over; margins are figures"; render AC-258 |
| 92-day cap unchanged for custom | ✅ | route AC-260: 92 gives 200, 93 gives 400 with a business; the existing cases are unedited |
| Isolation | ✅ | route AC-261 / SA-Q97: with account A, every scoped dep receives A only and B appears in no call; all-accounts deps are not called; the 404 / 500 plan checks still apply |
| Read ceilings and "at least" | ✅ | builder AC-263: the ledger ceiling gives "at least" and both margins Unknown, never 0; the recorded ceiling makes "Recorded above charged" Unknown |
| No money in logs | ✅ | route AC-271: the info line carries the choice and its dates, with no plan fact, amount or name. No new log line. No `console.*` in touched sources (guard) |
| Checks 29 and 30 paste-safe | ✅ | Extracted from §11L.10 and tokenised: 0 non-ASCII, 0 "into", 0 apostrophes in comments, one `;` each (one result set), no `SET`, no unclosed string. The cut-over literal is `2026-09-29 16:50:53.914+00` and the end is `now()` |

**D-1 read:** `since_start` is stripped, and the rest still goes through the unchanged strict schema (unknown keys, the date format, E-48, SA-W84). So a `tab` or a bad date beside it is still a 400. `since-start` reaches the schema's own enum 400.

### Test Coverage

| AC | Verdict | Evidence |
|---|---|---|
| AC-257 | PASS | `financeWindow.test.ts`; QA probe |
| AC-258 | PASS | builder + render (no "Not available") |
| AC-259 | PASS | route 200 / 400 / dev detail / hyphen / dates ignored |
| AC-260 | PASS | route 92 → 200, 93 → 400; existing cap cases unedited |
| AC-261 | PASS | route isolation (A not B), 404 / 500, platform 404 |
| AC-262 | PASS | route "same reads as a 92-day custom request" |
| AC-263 | PASS | builder ceiling cases |
| AC-264 | PASS | `financeUrlState` DF-6 `describe`; QA probe; AC-173 pins unchanged |
| AC-265 | PASS | offered only with a business; chip X in ONE write; Clear; extras pages ignore it |
| AC-266 | PASS | summary line and header label render cases; vocabulary guard unedited |
| AC-267 | PASS (code), live owed | builder K-1..K-4 = This month, K-5 follows; check 29 is L-151 |
| AC-268 | PASS (code), live owed | builder ILS case; summary = Section 3; check 29 is L-151 |
| AC-269 | PASS | `financeLinks.test.ts`; QA probe |
| AC-270 | PASS | DF-6 source guards (planted controls, no test files in scope); tsc; no `supabase` / `lib/repositories` path |
| AC-271 | PASS | 7 pins, AC-145 unedited and green, info-line case |
| AC-272 | NOT-TESTED (user) | L-148 to L-154 below |

### Issues Found
- **Bugs:** none.
- **Performance:** none (the reads are unchanged; ceilings as before).
- **Edge cases:** none new. Recorded only, not defects:
  - the long window will reach a read ceiling sooner for a busy account; it shows "at least" or Unknown by design;
  - checks 29 and 30 use SQL `now()`, so run them back to back with the page.

### Manual live steps (user, after deploy; read-only)

- **L-148 Choice offered only with a business.**
  - `/admin/finance` with All businesses: the Window control has no "Since it started".
  - Pick the owner test account: "Since it started" appears.
- **L-149 Pick it.**
  - The URL gains `range=since_start` and keeps `account`.
  - The header and section subtitles read "Since it started: 2026-09-29 16:50 to now (UTC)".
  - The account summary shows the same line under its heading.
- **L-150 Figures.**
  - The AI margin and the margin after fees are figures, never "Not available".
  - K-1 to K-4 read as under This month; K-5 and the summary follow the window.
- **L-151 Check 29** (Supabase SQL editor, new tab; put the owner account id, quoted, in the `p` block): `window_start` is `2026-09-29 16:50:53.914+00`. Revenue after tax, fees, AI cost, AI margin and margin after fees equal K-5, Paid us, charged AI cost, AI margin and margin after fees on the page. Run it right after loading the page.
- **L-152 Check 30** (same account): it counts rows dated before the cut-over. The page leaves these out by design.
- **L-153 Links and log.**
  - From the summary, open Activity and Charge checks: the URL has `range=custom&from=2026-09-29&to=<today>` and the account, and never `since_start`.
  - The dev-server log info line shows `preset: since_start`, its from and to, and no amount.
- **L-154 Leaving and bad links.**
  - Remove the business chip (X): the page goes to This month with All businesses in one step.
  - Paste `/admin/finance?range=since_start` with no business: the page opens on This month and shows no error.
  - Paste `?range=bogus&account=<id>`: the window falls back to This month and the business stays.

### Final Status
- [x] All acceptance criteria pass in code. AC-272, and the live halves of AC-267 and AC-268, are the user's L-148 to L-154. No bugs. **Ready for TL / RM (BD-33).**
- [ ] Issues found

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Dev: workplan written | From §11L and SA-RR-DF6 (E-75 to E-80) at `ea56ad04`; VL-1 to VL-21 checked in code; eight questions for SA (SA-W-DF6-1 to SA-W-DF6-8), three of them spec-to-code gaps (VL-13 summary window line, VL-14 label format, VL-15 links import pin). No code changed |
| 2026-10-17 | Dev: DF-6 implemented (uncommitted) | Steps 1 to 12; Implementation Notes; deviations D-1 (route schema left byte-identical because AC-173 part B hashes it; `since_start` admitted around it) and D-2 (one type error in `financeLinks.test.ts:36` held for an SA ruling under DF6-R3), D-3; seven pins equal; 4214 → 4291 tests in the finance, layout and extras-page suites |
| 2026-10-17 | SA workplan review | APPROVED WITH CONDITIONS (SA-WR-DF6). SA-W-DF6-1 to SA-W-DF6-8 ruled (all accepted; summary label computed once in FinanceView). DF6-R1 (ban skips tests), DF6-R2 (one label source), DF6-R3 (two ruled test edits listed). Requirement E-81 to E-84 applied by SA. No code changed |
| 2026-10-17 | SA code review | Code Approved (SA-CR-DF6). D-1, D-2 (applied by SA, DF6-R3 amended), D-3 approved; scoped tsc canary 1 / clean 0; pins equal; 2605 passed |
