# Workplan: Business OS Finance & Business Health — Slice 8.3 (the History block)

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md). This workplan covers slice **8.3 only**:
- §11M.8 (HS-FR-9 to HS-FR-16), HS-W-6 (gaps), HS-W-8 (isolation) and HS-W-10 (tier keys as data);
- the 8.3 rows of §11M.10;
- AC-287 to AC-292, and AC-293 / AC-294 for 8.3;
- L-159 to L-162;
- E-85 (S8-F1: the block opens closed) and the rest of E-85 to E-97 as applied.

**Branch:** `feature/bos-finance-health-8-3` (worktree `neuronforge-finance-m8`, cut from the 8.2 tip `2f335510`). Confirmed with `git branch --show-current`.
**Status:** Code Complete (SA-WR-8.3 approved with conditions 8.3-R1 to 8.3-R3; awaiting SA code review; PR only after #452 and 8.2 are in main)

**Stacking rule:** 8.1 (#452, waiting for the user to apply `20261078`) and 8.2 (branch pushed, no PR) are **not in main**. **8.3's PR is not opened until both have merged.** Then RM merges main into this branch (no rebase) and opens it under BD-33.

**Decisions in force:**
- BD-12 (no FX, never a cross-currency sum). This holds trivially here: the history stores no money and no currency (HS-W-9), so nothing is ever summed across currencies.
- BD-33 (the fast track).
- SA-Q106 (two tables, no chart).
- S8-F1 / E-85 (closed on load, one fetch on load).
- HS-W-6 (no gap filling).
- HS-W-10 (tier keys are data).

## Overview

8.3 adds one read route, two repository reads and a pure view builder, so the Finance Overview can show what the nightly job (8.2) has recorded. The new **History** block sits on the Overview with all businesses. It is **closed on page load**. Only "Show history" sends the history request, so the page still makes exactly one request on load and every frozen pin keeps its bytes. When open, it shows:
- the honest start line;
- the Plan mix and Credits tables;
- the "Change in this window" lines.

Before `20261078` is applied it shows a calm "not available yet" notice instead of an error.

There is no chart, no new dependency, no migration and no write. The finance page route and its payload are not changed.

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Files to Create / Modify](#files-to-create--modify)
- [1. Repository reads](#1-repository-reads)
- [2. The view builder (server)](#2-the-view-builder-server)
- [3. The read route](#3-the-read-route)
- [4. The block (client)](#4-the-block-client)
- [5. How AC-173 and the other pins stay untouched](#5-how-ac-173-and-the-other-pins-stay-untouched)
- [6. Before 20261078 is applied](#6-before-20261078-is-applied)
- [7. Tenant isolation](#7-tenant-isolation)
- [Guard table](#guard-table)
- [Test plan](#test-plan)
- [AC mapping](#ac-mapping)
- [User browser steps](#user-browser-steps)
- [Verification plan](#verification-plan)
- [Risks](#risks)
- [Estimate](#estimate)
- [Task List](#task-list)
- [Implementation Notes](#implementation-notes)
- [SA Workplan Review](#sa-workplan-review)
- [SA Code Review](#sa-code-review)
- [QA Report](#qa-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

I read each fact below myself, on `2f335510`.

| # | Fact | Where | Consequence |
|---|---|---|---|
| VL-1 | **Overview order.** `RevenuePanel`, `TakingsSection`, `AccountsByPlanSection`, `AiCostSection`, `CreditsSection` (Section 4), `PaymentProblemsSection`, inside `OverviewBody`. They render only when `data` has loaded, and only on the Overview, not on the Accounts tab | `app/admin/finance/components/FinanceView.tsx:302-309` | The block goes directly after `CreditsSection` (HS-FR-11, "after Section 4"), so it never renders while the finance read is failing or loading |
| VL-2 | **AC-173 renders with a FAILED finance read** (`failedRead()`), waits for `finance-error`, then asserts `fetch` was called exactly once with the pinned literal | `financeRequest.pin.render.test.tsx:96-112` | With no data the Overview, and so the block, never mounts. A closed block on loaded pages sends nothing either (§5) |
| VL-3 | **Pin B** mocks `fetch` for every URL with the finance body, renders `FinanceView` and reads tiles by `data-testid` (5 tiles). It never counts sections or fetches | `financeTiles.pin.render.test.tsx:321-323, :451-470` | A closed block adds DOM below the tiles but sends no request and no tile, so Pin B passes unedited (HS-FR-11 stop rule kept) |
| VL-4 | Other one-fetch assertions: `accountsTab.render.test.tsx:270`, `financeUrlState.render.test.tsx:155, :162`, `useFinanceData.render.test.tsx:84` | those tests | All stay green because a closed block sends nothing (§5) |
| VL-5 | **`FinanceSection` requires a `status`** (`ok` / `partial` / `unknown`) and always renders a status chip, "OK" in neutral. It has an optional `badge` and `alsoWhenUnknown` | `app/admin/finance/components/FinanceSection.tsx:41-106` | A closed block has no status yet, and an "OK" chip before any read would claim something unread (SA-W-8.3-2) |
| VL-6 | The shared states are `AdminLoading({ what })`, `AdminError({ message, testId, onRetry })` and `AdminNotice({ children, testId })`. A notice has no role, by design | `app/admin/components/layout/AdminStates.tsx:16-110` | Loading, error and "not available yet" (§6) |
| VL-7 | **The data hook pattern.** `useFinanceData(queryString)` uses an abort controller, `readAdminResponse` and `ADMIN_NETWORK_ERROR`, and has a `reload` | `app/admin/finance/useFinanceData.ts:35-110` | `useFinanceHistory(queryString, open)` follows it exactly, but fetches only while `open` |
| VL-8 | **The page's request serialiser is frozen:** AC-173 part C hashes `serialiseFinanceUrl`'s text | `financeRequest.pin.render.test.tsx:145-152`; `financeUrl.ts:73-88` | The history query string comes from a **new** `historyUrl.ts` and never edits `financeUrl.ts` |
| VL-9 | **The page route's query schema is frozen** (AC-173 part B hashes `buildQuerySchema`), and `buildQuerySchema` / `parseFinanceQuery` are module-private | `app/api/admin/business-os/finance/route.ts` | The history route has its **own** strict schema, built from the same shared pieces (`ADMIN_WINDOW_CHOICES`, `isRealDate`, `customRangeProblem`) |
| VL-10 | **Section 1's group order** is `seedGroups(config, payingKnown)`: trial, founding_partner, comped, each `tier:` in `config.tierOrder`, unknown_held. It is module-private | `lib/business-os/finance/planGroups.ts:117-135` | Export it (or a `groupOrderOf(config)` wrapper), never copy it (SA-W-8.3-4). Labels come from `tierLabelForGroup` (`:260-262`) on the server, and from the client's `groupLabel` (`AccountsByPlanSection.tsx:51-54`) |
| VL-11 | **The config without a new entitlements importer.** The finance guard pins the entitlements importers to `financeHealthDeps.ts` and `planGroups.ts` (`finance.source.guard.test.ts:227-228`), and `financeHealthDeps()` returns `config` | guard; wiring | A `financeHistoryDeps()` that picks `config` from `financeHealthDeps()` (the E-94 trick) adds no importer, so the `business-os-entitlements` skill registration is not needed |
| VL-12 | **The 8.1 / 8.2 repository** has `probeTable` and `insertSnapshotRows` only. Its header names its importer and writer caller. The 8.2-R2 guard pins **only** `financeSnapshotDeps.ts` as an importer | `lib/repositories/BusinessOsFinanceSnapshotRepository.ts`; `finance.source.guard.test.ts` (8.2 `describe`) | The new reads join the same repository (HS-FR-10). The 8.2-R2 importer rule needs **one ruled update**: the history wiring becomes the second importer, while the writer-caller rule (only the job calls `insertSnapshotRows`) is unchanged (SA-W-8.3-5) |
| VL-13 | **The client may only format.** The app source guard has:<ul><li>types-only imports from `lib/business-os/finance` (`source.guard.test.ts:55`);</li><li>no `.sort(`, `.reduce(` or `.filter(` in tab files (`CLIENT_FOLD`);</li><li>no date arithmetic on the window in components;</li><li>no `console.`</li></ul> | `app/admin/finance/__tests__/source.guard.test.ts` | Weekly points, "No snapshot" rows, "Not recorded" cells and the change line are computed **on the server** (SA-W-8.3-1) |
| VL-14 | `isMissingRelationError` is the shared "not installed" test; `readJobsQueues.ts:97` maps it to `{ state: 'not_installed' }` | `lib/repositories/supabaseErrorCodes.ts`; `lib/admin/jobs/readJobsQueues.ts` | The precedent for §6 |
| VL-15 | **No chart is drawn in admin.** `recharts` is in `package.json` but is imported by nothing under `app/admin/`. SA-Q106 rules two tables | CF-10; SA-Q106 | No chart and no dependency |
| VL-16 | The vocabulary guard scans `app/admin/finance/financeCopy.ts`, where only the SA-Q51 phrases are forbidden ("estimated", "AI spend" and so on). The layout-folder guard (C-14) governs `app/admin/components/layout/` only | `aiCostVocabulary.source.guard.test.ts:37-77`; `layoutFolder.guard.test.ts` | The new copy uses none of the phrases. No file is added to the shared layout folder, so C-14 is not tripped |
| VL-17 | Pins at Step 0, equal to the 8.2 handover: AC-173 `3a1a2dd4…f6f8`, helper `b84e0c96…aabf`, Pin A `30f5fc24…2e01`, Pin B `24ff0da7…df9f`, Pin C `98ea0507…1e4b`, helper `02813360…5bd8`, Pin D `1f7cf07a…f144` | 8.2 handover | Re-hashed at Step 0 and at handover |

---

## Scope

| In | Out |
|---|---|
| Repository reads `findFirstSnapshotDate`, `listSnapshotsInRange`<br>The pure view builder `historyView.ts`<br>The wiring `financeHistoryDeps.ts`<br>`GET /api/admin/business-os/finance/history`<br>The client hook, the `HistoryBlock` component, the copy and `historyUrl.ts`<br>Guards and tests | A chart (SA-Q106)<br>Per-business history (HS-W-8)<br>Money history (HS-W-9, DF-9)<br>Backfill (BQ-19)<br>Any edit to the finance page route, its payload, `financeUrl.ts`, `useFinanceData.ts` or any pin<br>Any write or migration |

---

## Questions for SA before code

| # | Where the requirement does not fit the code | Dev suggestion |
|---|---|---|
| **SA-W-8.3-1** (VL-13) | HS-FR-9 returns **raw rows**, but HS-FR-14 / HS-FR-15 need these things the client may not do:<ul><li>weekly sampling counting back from the last day;</li><li>"No snapshot" days;</li><li>"Not recorded" cells;</li><li>newest-minus-oldest change lines</li></ul>That is date arithmetic and folding | The route returns a **server-built view**, `{ window, firstSnapshotDate, state, weekly, planMix: { columns, points, change }, credits: { columns, points, change } }`, from a pure `buildHistoryView(...)`. The client formats only. Raw rows never leave the server, which also keeps the payload small |
| **SA-W-8.3-2** (VL-5) | `FinanceSection` always shows a status chip, but a closed block has no status | Add an optional `statusChip?: boolean` (default `true`) to `FinanceSection`. With `false` the right-hand chip is not rendered, and every existing caller renders byte-identical DOM. The block passes `statusChip={open && state === 'ready'}` and `status` from the read. **Alternative:** a fourth `BADGE` state, "Not loaded" in `unknown` tone; that changes a shared type |
| **SA-W-8.3-3** (§6) | The requirement has no "not installed" state. HS-FR-16 sends every failure to `AdminError` | The route answers **200** with `state: 'not_installed'` on a missing relation (VL-14), with no rows. The block shows `AdminNotice` "History is not available yet: it starts once the nightly snapshot is installed." That is calm: no error tone and no Try again. Other failures stay a 500 and show `AdminError` with Try again (HS-FR-16) |
| **SA-W-8.3-4** (VL-10) | The group order is private in `planGroups.ts` | Export `seedGroups` as it is (one keyword), used by the view builder with `payingKnown = true`. Stored `tier:` keys not in the seeded order follow at the end, with their stored key and "(no longer configured)" (HS-W-10). The AC-145 hash and the unedited `planGroups` tests prove nothing moved |
| **SA-W-8.3-5** (VL-12) | The 8.2-R2 guard allows only one importer of the snapshot repository | One **ruled** update: the importer list becomes `[financeHistoryDeps.ts, financeSnapshotDeps.ts]`. The writer rule (only the job calls `insertSnapshotRows`) is unchanged. A new rule pins that only the history wiring calls the two reads, and that the wiring exposes only the reads (a `Pick`, never `insertSnapshotRows`) |
| **SA-W-8.3-6** | HS-FR-12's empty-history line says "taken at 00:07 UTC tonight", which is wrong after 00:07 on a day with no snapshot yet | Keep the requirement's words: they are true for the first night, and a later empty history is the job's failure, which Jobs & queues shows. Recorded only |
| **SA-W-8.3-7** | Which window: the page's own | The block uses the page's current window, with the same `preset` / `from` / `to` sent as the page's request. It never takes `accountId` and is never rendered with a business picked. A window change while open re-reads; a window change while closed sends nothing |

---

## Files to Create / Modify

### Create

| File | Purpose |
|---|---|
| `lib/business-os/finance/historyView.ts` | Pure `buildHistoryView(input)`: the points, gaps, cells, columns and change lines; `HISTORY_LIMITS` (`ROW_CEILING: 5000`, `DAILY_MAX_DAYS: 31`, `WEEK_DAYS: 7`) |
| `lib/business-os/finance/financeHistoryDeps.ts` | `import 'server-only'`; `config` from `financeHealthDeps()`; `Pick<BusinessOsFinanceSnapshotRepository, 'findFirstSnapshotDate' \| 'listSnapshotsInRange'>` |
| `app/api/admin/business-os/finance/history/route.ts` | The read route (the `new-api-route` skill) |
| `app/admin/finance/historyUrl.ts` | `serialiseHistoryQuery(query)` → `preset=…[&from&to]`; pure, with a guard that it never writes `accountId` |
| `app/admin/finance/useFinanceHistory.ts` | `useFinanceHistory(queryString, open)`: fetches only while `open` |
| `app/admin/finance/components/HistoryBlock.tsx` | The block: closed, loading, error, not installed, ready |
| Tests | `lib/business-os/finance/__tests__/historyView.test.ts`; `app/api/admin/business-os/finance/history/__tests__/route.test.ts`; `app/admin/finance/__tests__/historyBlock.render.test.tsx`; `app/admin/finance/__tests__/historyRequest.render.test.tsx` (the new request literal and the one-fetch-on-load proof) |

### Modify

| File | Anchor | Change |
|---|---|---|
| `lib/repositories/BusinessOsFinanceSnapshotRepository.ts` | after `insertSnapshotRows` | `findFirstSnapshotDate()`, `listSnapshotsInRange(from, to)` (§1); header "WHO MAY CALL IT" extended |
| `lib/repositories/__tests__/BusinessOsFinanceSnapshotRepository.test.ts` | end | The read cases (§1); the source pin still forbids `update` / `delete` / `rpc` |
| `lib/business-os/finance/planGroups.ts` | `:117` | `function seedGroups` → `export function seedGroups` (SA-W-8.3-4) |
| `app/admin/finance/components/FinanceSection.tsx` | `:41-106` | Optional `statusChip` (SA-W-8.3-2); default output unchanged |
| `app/admin/finance/components/FinanceView.tsx` | `:307` (after `CreditsSection`) | `{query.accountId === null ? <HistoryBlock query={query} /> : <HistoryAllBusinessesLine />}`; with a business picked, the one-line note only (HS-FR-11) |
| `app/admin/finance/financeCopy.ts` | new block at the end | The HS-FR-11 to HS-FR-15 strings and the §6 notice |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | the 8.2 `describe` and a new 8.3 `describe` | The ruled importer-list edit (SA-W-8.3-5); the new rules (guard table) |
| `app/admin/finance/__tests__/source.guard.test.ts` | end | An 8.3 `describe`: `HistoryBlock.tsx` and the hook import types only from `lib/business-os/finance`, use no `.sort(` / `.reduce(` / `.filter(` and no date arithmetic, and `historyUrl.ts` never names `accountId` |

**Not touched** (checked with `git diff --exit-code`):
- `app/api/admin/business-os/finance/route.ts`, `financeUrl.ts`, `useFinanceData.ts`, `financeFilters.ts`;
- the seven pin files, AC-145's region;
- `app/admin/components/layout/**`;
- `supabase/**`, `lib/business-os/entitlements/**`;
- the 8.2 job, builder and route.

---

## 1. Repository reads

**File:** `lib/repositories/BusinessOsFinanceSnapshotRepository.ts`

| Method | Query | Returns |
|---|---|---|
| `findFirstSnapshotDate()` | `.from(TABLE).select('as_of_date').order('as_of_date', { ascending: true }).limit(1)` | `{ data: { state: 'ready', firstDate: string \| null } }`; or `{ data: { state: 'not_installed' } }` on `isMissingRelationError`; or `{ error }` |
| `listSnapshotsInRange(from, to)` | `.from(TABLE).select('as_of_date, metric, dimension, unit, value').gte('as_of_date', from).lte('as_of_date', to).order('as_of_date').order('metric').order('dimension').range(0, CEILING)`, which asks for one row beyond the ceiling | Rows, or **`{ error: 'ceiling' }` when more than 5,000 come back** (never a partial list, HS-FR-10); `not_installed` as above |

- **Columns:** exactly `as_of_date, metric, dimension, unit, value` (a test pins the select string). `id` and `taken_at` never leave the database.
- **`from` / `to`:** validated `YYYY-MM-DD` strings from the route's schema, with a defensive regex in the method too.
- **No `.eq('user_id')`:** the table has none (the header's existing bypass paragraph). The reads are reached only from `app/api/admin/**`, behind `requireAdmin` (§7).

## 2. The view builder (server)

**File:** `lib/business-os/finance/historyView.ts`. It is pure: no repository, no clock (`window` and `today` are passed in), and no entitlements import. Labels come through `tierLabelForGroup` and `seedGroups` from `./planGroups`.

| Output | Rule |
|---|---|
| `state` | `'no_history'` (no first date), `'none_in_window'` (a first date, no row in the window) or `'ready'` (HS-FR-12). `not_installed` is set by the route (§6) |
| `firstSnapshotDate` | `YYYY-MM-DD` or null |
| `weekly` | `true` when the window has more than `DAILY_MAX_DAYS` (31) inclusive days (HS-FR-14) |
| point dates | Daily: every day from `to` back to `from`. Weekly: `to`, `to − 7`, … while `>= from`. Newest first. Days before `firstSnapshotDate` are not listed (L-162) |
| a point with no row that day | `{ date, kind: 'no_snapshot' }`, rendered "No snapshot" across the row (HS-W-6) |
| a cell whose metric was not written that day | `{ kind: 'not_recorded' }`, never 0 (HS-FR-14) |
| **Plan mix columns** | The `seedGroups(config, true)` order, each with `label` from config; then stored `tier:` keys missing from config, `{ key, label: null, noLongerConfigured: true }`. The values are `accounts_in_group`. Then **Total** (`accounts_total`) and **Founding Partners with no end date** (`founding_no_end_date`) |
| **Credits columns** | `credit_allowance` (Included credits), `credit_used` (Used this period), `gifted_outstanding`, `bought_outstanding`, `credit_outstanding_total`, `credit_over_allowance`, `credit_far_over_allowance` (HS-FR-13) |
| `change` per column | newest recorded point minus oldest point, **only** when both cells are recorded points (not `no_snapshot`, not `not_recorded`); otherwise `{ kind: 'not_available' }` (HS-FR-15). Credits are computed in micro-credits, as integers, and divided once |
| units | `accounts` values are integers, `credits` up to 6 decimals; the client formats with the existing `formatCount` / `formatCredits` |

No money, no currency and no cross-currency sum anywhere: the table holds none (HS-W-9).

## 3. The read route

**File:** `app/api/admin/business-os/finance/history/route.ts`, built with the `new-api-route` skill.

Order, with nothing before the gate:
1. `requireAdmin` (401 / 403), the first statement after the logger set-up.
2. The repeated-key check (400).
3. The **strict** Zod schema:
   - `preset` is `z.enum(ADMIN_WINDOW_CHOICES).default('this_month')`;
   - `from` / `to` are `isRealDate`-checked;
   - `custom` goes through `customRangeProblem` (92 days, `to` not after today UTC);
   - any other key is a 400. That includes `accountId` (HS-FR-9) and `preset=since_start` (it is not in the shared enum), which stay 400 by construction.
4. `resolveFinanceWindow` (the server clock, SA-Q2).
5. The reads, in parallel:
   - `findFirstSnapshotDate`;
   - `listSnapshotsInRange(from, to)`, with `to` clamped to yesterday UTC, since the latest snapshot is D − 1.
6. `buildHistoryView`.
7. The response `{ success: true, data: view }`.

| Result | HTTP | Body |
|---|---|---|
| ready / no_history / none_in_window | 200 | the view |
| either read says not installed | 200 | `{ state: 'not_installed', window, firstSnapshotDate: null }` |
| the ceiling, or a read error | 500 | `{ success: false, error: 'Could not read the finance history.', details: dev only }` |

- `Cache-Control: no-store` on every response (the finance route's `noStore` pattern).
- **Log:** one `info` with `correlationId`, `adminId`, `window`, `state`, the row count and `durationMs`; never a value.
- **Audit:** none. It is a read-only admin view, as the finance route (SA-Q11).

## 4. The block (client)

**Files:** `HistoryBlock.tsx`, `useFinanceHistory.ts`, `historyUrl.ts`, and new strings in `financeCopy.ts`.

| State | What renders |
|---|---|
| **closed** (the default on every load) | `FinanceSection` id `history`, title "History", the subtitle "Each point is the state at the end of that UTC day. Credits are units, not money.", `statusChip={false}`, and one button **"Show history"** (`aria-expanded="false"`, `aria-controls="history-body"`). **No request** |
| open, loading | `AdminLoading` (what: "the finance history") |
| open, error (500, network) | `AdminError` with Try again (the hook's `reload`), inside the block only (HS-FR-16) |
| open, `not_installed` | `AdminNotice` "History is not available yet: it starts once the nightly snapshot is installed." No retry (§6) |
| open, `no_history` | The start line "No history yet: the first snapshot is taken at 00:07 UTC tonight." |
| open, `none_in_window` | "No snapshot in this window. History starts on {firstSnapshotDate} (UTC)." |
| open, `ready` | "History starts on {firstSnapshotDate} (UTC).", then "Weekly points" when `weekly`; then two tables (`adminTable` classes, `scope="col"`), each with a `<caption>` (Plan mix, Credits), newest first, cells formatted only; then "Change in this window" under each; and a **"Hide history"** button |
| a business picked | Only the line "History is kept for all businesses together, not per business." No button, no request (HS-FR-11, L-161) |

Behaviour:
- **Request literal:** `/api/admin/business-os/finance/history?${serialiseHistoryQuery(query)}`, with `cache: 'no-store'`. For example `…/history?preset=this_month`, or `…/history?preset=custom&from=2026-10-01&to=2026-10-17`.
- **Open state** is local React state, not a URL key: no `FINANCE_FILTER_SPEC` change, so no request pin moves. It resets to closed on a full reload. That is the E-85 requirement, and SA may rule a URL key later.

## 5. How AC-173 and the other pins stay untouched

1. **No request on load.** `useFinanceHistory` returns at once while `open` is false. It is mounted only inside the Overview, which itself mounts only after the finance read succeeded (VL-1). So:
   - AC-173 (a failing read, no Overview) sees exactly 1 fetch;
   - Pin B (a succeeding read) sees exactly the finance fetch;
   - the four other one-fetch tests (VL-4) are unchanged.
2. **No pinned file is edited:**
   - the page request is still built by the frozen `serialiseFinanceUrl`, and the history query comes from the new `historyUrl.ts`;
   - the page route and its frozen schema are not edited;
   - the history route is a separate file with its own schema;
   - `FINANCE_FILTER_SPEC` is not edited.
3. **The history literal has its own test** (`historyRequest.render.test.tsx`): on load there is 1 fetch, the finance literal; after "Show history" there are 2, the second being `…/history?preset=this_month`, with no `accountId` ever. It is never added to the AC-173 table.
4. **Markup:** the closed block adds one `section` after Credits. Pin B reads tiles by test id and counts 5 tiles, not sections (VL-3). If any pin or the AC-145 test fails, Dev **stops and raises it to SA** (HS-FR-11); there is no silent re-freeze.
5. **Hashes:** the seven pins are hashed at Step 0 and at handover, LF-normalised.

## 6. Before 20261078 is applied

- The repository's two reads map a missing relation (`42P01` / `PGRST205`, the shared `isMissingRelationError`) to `not_installed`. A missing **column** is still an error.
- The route answers **200 `state: 'not_installed'`**, and logs one `warn` `{ tableMissing: true }`, not an `error`: an admin opening the block early is not a defect.
- The block shows the calm `AdminNotice` sentence (§4). It has no error tone, no Try again and no page error. Every other section is unaffected; the history request is only sent after a click anyway.

## 7. Tenant isolation

The `tenant-isolation-guard` skill is applied:
- **A service-role, all-accounts read**, but of platform aggregates with no account column (HS-W-8). There is no caller-supplied id: `accountId` is refused by the strict schema (400), with a test.
- **Only the five columns** are selected.
- **Only the history wiring** calls the reads, and only this route imports the wiring (guard). The route sits under `app/api/admin/**` with `requireAdmin` first, so the authz-surface guard covers it.
- **Nothing in the response** can carry an account id, a name or a value from another table. A test plants a row with a uuid-shaped dimension, which the 8.1 CHECK would refuse anyway, and proves the view drops unknown plan keys that are not `tier:`-shaped, never echoing them.

---

## Guard table

| Guard | Expected | Action |
|---|---|---|
| **Seven frozen pins** (AC-173 `3a1a2dd4…f6f8`, helper `b84e0c96…aabf`; Pin A `30f5fc24…2e01`; Pin B `24ff0da7…df9f`; Pin C `98ea0507…1e4b`, helper `02813360…5bd8`; Pin D `1f7cf07a…f144`) | Byte-identical and green (§5) | Hash at Step 0 and handover; a failure stops the work |
| AC-145 payload baseline | Unchanged (the page route is not edited) | Run |
| `npm run test:authz-guard` | Passes with no allow-list edit; `requireAdmin` is the first statement of the new `GET` | Run |
| `aiCostVocabulary.source.guard.test.ts` | Passes, no edit; the `financeCopy.ts` text count rises | Run |
| `layoutFolder.guard` (C-14), contrast | Pass; no shared-folder file added; the table uses the shared `adminTable` classes | Run |
| App `source.guard.test.ts` | Existing rules pass; a new 8.3 `describe` (§ Files) | Add |
| `finance.source.guard.test.ts` | **Ruled** importer-list update (SA-W-8.3-5). New rules: `historyView.ts` is pure (no repository, Supabase, server-only, entitlements or clock; no tier literal); only `financeHistoryDeps.ts` calls the two reads, and its `Pick` excludes `insertSnapshotRows`; only the history route imports `financeHistoryDeps`. Planted controls | Edit plus add |
| `test:bos-entitlements` | Pass; no entitlements import added (VL-11) | Run |
| RC-15, `tierLiteral.forbidden`, `serverModulesStayServer`, `anon-default-repositories` | Pass (test files take the plan type through `ClassifyInput`, as in 8.2's D-2) | Run |
| `lint:hooks`, eslint, scoped `tsc` with a canary | Clean | Run |

## Test plan

| File | Asserts |
|---|---|
| `historyView.test.ts` | <ul><li>**HS-FR-12:** the three states and the start date.</li><li>**HS-FR-14:** daily points for 31 days and weekly for 32 (counting back from `to`, newest first); days before the first snapshot are not listed; a missing day gives `no_snapshot`; a missing metric gives `not_recorded`, never 0.</li><li>**HS-FR-13:** the columns follow the seeded group order with config labels; a stored tier not in config comes last with `noLongerConfigured`.</li><li>**HS-FR-15:** change only between two recorded cells; micro-credit exactness (0.1 + 0.2).</li><li>**AC-291:** no tier literal is needed (the fixture tier comes from config).</li><li>**Isolation:** a non-`tier:` unknown plan key is dropped, never echoed.</li></ul> |
| `history/__tests__/route.test.ts` | <ul><li>**AC-287:** `requireAdmin` first (the real gate, 401 / 403 with zero reads); 400 for `accountId`, `preset=since_start`, an unknown key, a repeated key and a 93-day custom window, each with zero reads.</li><li>The window is re-resolved (a preset with client dates is ignored).</li><li>200 with the view; the ceiling gives 500 and never a partial list.</li><li>`not_installed` gives 200 with that state and a `warn`.</li><li>`no-store` on every response; the info line carries no value.</li><li>The source test: no write verb, no audit.</li></ul> |
| `BusinessOsFinanceSnapshotRepository.test.ts` (additions) | <ul><li>The exact select string and ordering; `gte` / `lte`.</li><li>`range(0, 5000)`, and 5,001 rows give the ceiling error.</li><li>`not_installed` on `42P01` / `PGRST205`; `42703` is an error.</li><li>The first date is null on an empty table.</li></ul> |
| `historyBlock.render.test.tsx` | <ul><li>**AC-288 to AC-292** in each state: closed (button, `aria-expanded`, no chip, no request); loading; error with Try again re-sending; `not_installed` notice with no retry; the three start lines with exact copy; the tables with "No snapshot", "Not recorded", "Weekly points" and the change line;</li><li>"(no longer configured)";</li><li>with a business picked: the one line, no button;</li><li>a failed history read leaves the other sections rendered (AC-292)</li></ul> |
| `historyRequest.render.test.tsx` | **AC-290:** the full `FinanceView`. On load exactly 1 fetch (the finance literal). After "Show history" exactly 2 (the new literal, no `accountId`). A window change while open sends one more history request; while closed, none |
| `FinanceSection` tests (existing, unedited) | Default DOM unchanged (`statusChip` defaults to true) |
| Existing finance render tests, the seven pins, AC-145 | Unedited and green |

## AC mapping

| AC | Proven by |
|---|---|
| AC-287 | Route tests; authz guard |
| AC-288 | `historyView.test.ts` (states) and `historyBlock.render.test.tsx` (copy) |
| AC-289 | `historyView.test.ts` (points, gaps, cells, change) and render |
| AC-290 | `historyRequest.render.test.tsx`; the seven pins and the four one-fetch tests unedited |
| AC-291 | `historyView.test.ts`; render; `tierLiteral.forbidden` |
| AC-292 | `historyBlock.render.test.tsx` (the block fails alone) |
| AC-293 (8.3) | Guard table; pins; AC-145; no new CI job |
| AC-294 (8.3) | L-159 to L-162 in the QA Report |

## User browser steps

These run after 8.1 is applied and 8.2 has run at least one night. They are recorded by QA in the workplan.

| # | Step | Expected |
|---|---|---|
| L-159 | Open `/admin/finance`, all businesses, This month. Open the browser's network panel | The History block sits after "Credits", **closed**, with a "Show history" button. The network panel shows **one** request (`/api/admin/business-os/finance?preset=this_month`) |
| L-159 | Click "Show history" | One more request, `/api/admin/business-os/finance/history?preset=this_month`. The block reads "History starts on {first day} (UTC)." and shows one row per day from that day, newest first |
| L-160 | The morning after a snapshot, compare the newest Plan mix row with Section 1 and the Credits row with Section 4, K-2 and K-4 | Equal, except for changes made since 00:07 UTC |
| L-161 | Pick the owner test account | The block shows only "History is kept for all businesses together, not per business." No button, and no history request |
| L-162 | Choose Custom, 60 days | "Weekly points". Days before the first snapshot are not listed, and nothing reads 0 where a figure is missing |
| L-163 (proposal) | Before `20261078` is applied (or on a database without it), open the block | The calm notice "History is not available yet…"; no red error; the rest of the page is fine |

## Verification plan

Each command runs alone, with its own exit code. Never `git stash`, `git worktree remove` or `npm install`.

| # | Command |
|---|---|
| V-1 | `npx jest app/admin/finance lib/business-os/finance app/api/admin/business-os/finance --ci` |
| V-2 | `npx jest lib/repositories/__tests__/BusinessOsFinanceSnapshotRepository.test.ts lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts --ci` |
| V-3 | `npx jest app/admin/components app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` |
| V-4 | `npm run test:authz-guard` |
| V-5 | `npm run test:bos-entitlements` |
| V-6 | `npm run lint:hooks`; `npx eslint` on the touched files |
| V-7 | Scoped `tsc` with a canary in `historyView.ts`: config outside the worktree, the canary file restored byte-identical |
| V-8 | The seven pin hashes; `git diff --exit-code` on the "Not touched" list; `git diff --numstat` read first |

## Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | A one-fetch test or a pin fails because of the block | Low | Closed by default and mounted only after data (§5); the stop rule |
| R-2 | The `statusChip` prop changes `FinanceSection`'s default DOM | Low | Defaults to the current output; the existing section tests stay unedited |
| R-3 | 8.1 and 8.2 are not in main, so the PR would stack | Medium | The stacking rule; RM checks that both commits are ancestors of `origin/main` before opening |
| R-4 | A busy future history exceeds 5,000 rows in 92 days | Very low (about 40 rows a day) | An error at the ceiling, never a partial list (HS-FR-10) |
| R-5 | The empty-history sentence is untrue after a missed night | Low | SA-W-8.3-6; Jobs & queues shows the failure |
| R-6 | A tier renamed in config | Low | The stored key shows with "(no longer configured)" (HS-W-10) |

## Estimate

**About 1 day** (§11M.13):
- repository reads and the view builder with tests: 0.35 d;
- route and wiring with tests: 0.25 d;
- block, hook, copy and render tests: 0.3 d;
- guards, pins, `tsc` and handover: 0.1 d.

## Task List

- [x] ✅ Step 0: branch confirmed (`feature/bos-finance-health-8-3`, from `2f335510`); code read (VL-1 to VL-17)
- [x] ✅ Step 1: SA-WR-8.3 approved with conditions; rulings E-98 to E-101 and 8.3-R1 to 8.3-R3 applied
- [x] ✅ Step 2: the seven pins hashed (all equal). The 8.2 handover counts served as the baseline (D-3)
- [x] ✅ Step 3: **the read-only `BusinessOsFinanceSnapshotReadRepository`** (E-98, 8.3-R1) plus 11 tests; the writer and its test are untouched
- [x] ✅ Step 4: `seedGroups` exported; `historyView.ts` plus 16 tests (AC-288, AC-289, AC-291)
- [x] ✅ Step 5: `financeHistoryDeps.ts` and the route plus 16 tests (AC-287, 8.3-R2, E-100)
- [x] ✅ Step 6: `FinanceSection` `statusChip`; the hook, `historyUrl.ts`, `HistoryBlock.tsx` and the copy (E-101); 9 render tests (AC-288 to AC-292)
- [x] ✅ Step 7: `FinanceView` mount after Section 4; 5 page tests (AC-290, 8.3-R3) appended to `financePage.render.test.tsx` (D-1)
- [x] ✅ Step 8: the 8.3 guards (finance guard 4 tests, app guard 4 tests, planted controls); the 8.2-R2 rule is unedited
- [x] ✅ Step 9: verification, pins, Implementation Notes; status → Code Complete
- [ ] Step 10: after #452 and 8.2 are in main, RM merges main and opens the PR (BD-33)

## Implementation Notes

**Built 2026-10-17 in `neuronforge-finance-m8`, branch `feature/bos-finance-health-8-3`, uncommitted.** Dev edited the requirement MD only for the §0.1 workplan link, before the build.

### Files

| File | State |
|---|---|
| `lib/repositories/BusinessOsFinanceSnapshotReadRepository.ts` | New, read only. `findFirstSnapshotDate`, `listSnapshotsInRange` (five columns, inclusive range, `range(0, 5000)` with an error past it); `not_installed` on a missing relation |
| `lib/business-os/finance/historyView.ts` | New, pure. `buildHistoryView`, `notInstalledHistoryView`, `dayBefore`, `HISTORY_LIMITS`; the view types |
| `lib/business-os/finance/financeHistoryDeps.ts` | New, `server-only`. `config` from `financeHealthDeps()`; a `Pick` of the two reads |
| `app/api/admin/business-os/finance/history/route.ts` | New. `requireAdmin` first, repeated key, strict Zod, the window, two reads, the view; `no-store` everywhere |
| `app/admin/finance/historyUrl.ts`, `useFinanceHistory.ts`, `components/HistoryBlock.tsx` | New. The block is closed by default; the hook fetches only while open; the component formats only |
| `app/admin/finance/components/FinanceSection.tsx` | Optional `statusChip` (default true) |
| `app/admin/finance/components/FinanceView.tsx` | The block after `CreditsSection`; with a business picked, the one line |
| `app/admin/finance/financeCopy.ts` | The History strings (E-101 wording) |
| `lib/business-os/finance/planGroups.ts` | `export` on `seedGroups` |
| Tests | 4 new files (view 16, route 16, read repository 11, block 9). Appended: 5 page tests in `financePage.render.test.tsx`, the app guard 8.3 `describe` and the finance guard 8.3 `describe` |

**Untouched** (`git diff --quiet` exit 0):
- the writer repository and its test (E-98);
- the finance page route, `financeUrl.ts`, `useFinanceData.ts`, `financeFilters.ts`;
- `app/admin/components/layout/`, `lib/business-os/entitlements/`, `supabase/`;
- the 8.2 job, builder and cron route;
- the seven pins.

### How AC-173 stayed untouched

- The block is mounted only inside the loaded Overview.
- Its hook returns at once while closed.
- The page test proves both paths with the full `FinanceView` (8.3-R3):
  - **a failed finance read** → no Overview, no block, exactly 1 fetch (AC-173's own path);
  - **a loaded page** → the block is closed, with no chip, and exactly 1 fetch (Pin B's path).
- "Show history" adds exactly one request, `/api/admin/business-os/finance/history?preset=this_month`. A window change while closed sends no history request.
- AC-173, Pin B and the other one-fetch tests ran unedited and green.

### Deviations

| # | Deviation | Reason |
|---|---|---|
| D-1 | The page-level request tests are a new `describe` at the end of `financePage.render.test.tsx`, not a separate `historyRequest.render.test.tsx` | They need that file's `payload()`, `serve()` and `next/navigation` mocks. A copy would drift. It is additions only, and it is still never in the AC-173 table |
| D-2 | The block passes `status="ok"` to `FinanceSection` always, with the chip shown only once a view is read | `FinanceSection`'s `unknown` state replaces the children with its own "Could not load" line, which would hide the toggle. HS-FR-16 wants the block's own `AdminError` with Try again, inside the block |
| D-3 | No separate untouched-tree baseline run | The base is the 8.2 tip, whose suites were recorded at the 8.2 handover |

### Verification (each command run alone)

| # | Command | Exit | Result |
|---|---|---|---|
| V-1a | `npx jest app/admin/finance --ci` | 0 | 20 suites, **680 passed** |
| V-1b | `npx jest lib/business-os/finance --ci` | 0 | 19 suites, **1892 passed** |
| V-1c | `npx jest app/api/admin/business-os/finance/__tests__ --ci` (the finance route) | 0 | 1 suite, **106 passed** (AC-145 unedited) |
| V-1d | `npx jest app/api/admin/business-os/finance/history --ci` | 0 | 1 suite, **16 passed** |
| V-2 | `npx jest app/admin/components --ci` | 0 | 25 suites, **824 passed** |
| V-3 | `npx jest app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` | 0 | **182 passed**, file unedited |
| V-4 | `npx jest lib/repositories --ci` | 0 | 104 suites, **2515 passed** |
| V-5 | `npm run test:authz-guard` | 0 | 2 suites, **203 passed** (the new route is covered with no allow-list edit) |
| V-6 | `npm run test:bos-entitlements` | 0 | 286 suites, **8758 passed** |
| V-7 | `npm run lint:hooks`; `npx eslint` on the 18 changed and new `.ts` / `.tsx` files | 0 / 0 | clean |
| V-8 | Scoped `tsc` (scratch `tsconfig.83.json` outside the worktree, 28 files: the changed and new files, the seven pins, and the sibling finance components), with a canary in `historyView.ts` | 2 / 0 | Canary run: exactly **1** error, `historyView.ts(219,7) TS2322`. Restored from a copy: `sha256sum -c` OK, `grep -c __canary` = 0. Clean run: **0** errors |
| V-9 | Seven pins (LF-normalised SHA-256) | — | all equal: `3a1a2dd4…f6f8`, `b84e0c96…aabf`, `30f5fc24…2e01`, `24ff0da7…df9f`, `98ea0507…1e4b`, `02813360…5bd8`, `1f7cf07a…f144` |
| V-10 | `git diff --numstat`; `console.` grep over the new sources | — | no deletion-only file; no `console.` (grep exit 1) |

### Fix round 1 (SA-CR-8.3 C-1, High)

**The defect:** `listSnapshotsInRange` read with a single `.range(0, 5000)`. PostgREST caps every response at 1,000 rows, so a 92-day window (about 3,700 rows) silently lost the rows past 1,000, and the 5,000 ceiling could never fire.

**The fix** (`lib/repositories/BusinessOsFinanceSnapshotReadRepository.ts`):
- The read pages at `FINANCE_SNAPSHOT_READ_PAGE_SIZE = 1000` with `.range(offset, offset + 999)`.
- Pages are ordered by the table's unique key (`as_of_date`, `metric`, `dimension`), so pages never overlap or skip.
- A short page ends the read.
- Once the running total passes 5,000, the method returns the ceiling error, never a partial list.

**Tests** (`BusinessOsFinanceSnapshotReadRepository.test.ts`): a new PostgREST-like mock cuts **every** response at 1,000 rows, whatever range is asked for.
- 3,700 rows come back whole and unique, read as ranges `[0, 999]`, `[1000, 1999]`, `[2000, 2999]`, `[3000, 3999]`. The old code returned only 1,000 here.
- 2,000 rows take 3 reads (a full page is followed by one more).
- Exactly 5,000 is fine; 5,001 is the ceiling error.
- The call-order assertion now expects `range(0, 999)`. The repository has 13 tests (was 11).

**Re-run, each alone, exit 0:**

| Suite | Result |
|---|---|
| `lib/repositories` | 104 suites, **2517 passed** |
| `app/api/admin/business-os/finance/history` | **16 passed** |
| `app/admin/finance` | 20 suites, **680 passed** |
| `lib/business-os/finance` | 19 suites, **1892 passed** |
| eslint on the two files | clean |

### Owed

- SA code review, then QA.
- RM: after #452 and 8.2 are in main, merge main (no rebase) and open the PR (BD-33).
- The user, after a few nights: L-159 to L-162. L-163 is dropped (E-100).

---

## SA Workplan Review

**Reviewed by SA, 2026-10-17, at `2f335510`.**
**Status: APPROVED WITH CONDITIONS (SA-WR-8.3).** Code may start. SA applied E-98 to E-101 to §11M.8 (HS-FR-9, HS-FR-10, HS-FR-12, HS-FR-16).

### Rulings

| # | Ruling |
|---|---|
| SA-W-8.3-1 | **Accepted (E-99).** The route returns the server-built view from a pure `buildHistoryView`; raw rows never leave the server. This matches the client "format only" guard and keeps the payload small |
| SA-W-8.3-2 | **Accepted, as an optional `statusChip?: boolean` defaulting to `true`.** `FinanceSection` lives in `app/admin/finance/components/`, not the shared layout folder, so C-14 is not involved. Hiding the chip adds no colour pair, so contrast is unaffected. Do not add a fourth `BADGE` state (a shared type). The existing `FinanceSection` tests must stay unedited and green |
| SA-W-8.3-3 | **Accepted (E-100).** 200 `not_installed`, a `warn`, and a calm `AdminNotice` with no retry. **L-163 is dropped as a browser step:** production has the table before 8.3 ships. Route and render tests prove it |
| SA-W-8.3-4 | **Accepted.** `export function seedGroups` with no other change. Exporting adds no entitlements importer, because `planGroups.ts` already is one |
| SA-W-8.3-5 | **Changed: split the repository, do not widen the guard (E-98).** A read slice should not import the writer's module, and SA-WR-8.2's R2 was written to keep the writer one path wide. Create **`lib/repositories/BusinessOsFinanceSnapshotReadRepository.ts`** with `findFirstSnapshotDate` and `listSnapshotsInRange` and no write method. This follows the `BusinessOsFinanceReadRepository` / `BusinessOsCreditLedgerReadRepository` precedent. The writer file is **not edited** and the 8.2-R2 rule stays **unedited**. New rules, each with a planted control:<br>• only `financeHistoryDeps.ts` imports the read repository;<br>• the read repository has no `.insert(`, `.upsert(`, `.update(`, `.delete(` or `.rpc(`;<br>• only the history route imports `financeHistoryDeps`. |
| SA-W-8.3-6 | **Changed (E-101).** The empty-history line becomes "No history yet: a snapshot is taken every night at 00:07 UTC.", which is true on any day. That is copy only, not a business decision |
| SA-W-8.3-7 | **Accepted.** The page's window, never `accountId`. While the block is open, a window change re-reads it; while closed, it sends nothing. The `to` clamp to yesterday UTC is fine: Today then reads "No snapshot in this window". |

### Conditions

- **8.3-R1:** apply the split (SA-W-8.3-5). In the Files table, the writer repository and its test move to "Not touched", and the new read repository plus its own test are added. `financeHistoryDeps.ts` picks `config` from `financeHealthDeps()` (no new entitlements importer) and imports only the read repository.
- **8.3-R2:** the history route follows the finance route's order. `correlationId` and the child logger come first, then `requireAdmin` as the first statement that can touch anything, as the authz guard accepts today. Every response is `no-store`, and the error body uses the CLAUDE.md format with development-only `details`.
- **8.3-R3:** `historyRequest.render.test.tsx` also proves **AC-173's failed-read path**: no Overview and no History block, so exactly 1 fetch. It also proves Pin B's success path: closed, so 1 fetch.

### Checked and fine

- Tenant isolation: there is no caller id (`accountId` is a 400); the route selects only the five columns of platform aggregates and has no write.
- Reads go through a repository, and no money or currency is involved (HS-W-9).
- The vocabulary guard needs no edit, and no shared-layout file is added (C-14).
- The seven pins and AC-145 are untouched by construction (§5, with the stop rule).
- The browser steps are L-159 to L-162, now without L-163.
- No new CI job.
- The estimate of about 1 day is accepted; the split adds less than 0.1 day.

## SA Code Review

**Code Review by SA, 2026-10-17. Reviewed: the uncommitted tree on `feature/bos-finance-health-8-3`.**
**Status: Code Approved (SA-CR-8.3, after the C-1 re-check, 2026-10-17).** Originally Fix Required on C-1 alone; everything else was already approved.

**C-1 re-check (SA).** The code reads `FINANCE_SNAPSHOT_READ_PAGE_SIZE = 1000` rows per page, using `.range(offset, offset + 999)` ordered by the unique key `(as_of_date, metric, dimension)`. It ends on a short page and returns an error once more than 5,000 rows have been read, never a partial list. A missing relation still gives `not_installed`. The new tests cap the mock at 1,000 rows per call: 3,700 rows all come back, exactly 5,000 come back, and 5,001 is an error. SA re-ran the read repository and history route suites: **29 passed**.

### Finding

| # | File | Issue | Priority |
|---|---|---|---|
| C-1 | `lib/repositories/BusinessOsFinanceSnapshotReadRepository.ts` `listSnapshotsInRange` | **One `.range(0, 5000)` call is silently cut at PostgREST's `max-rows` (1,000).** The repo already depends on that limit: `FINANCE_READ_LIMITS.BILLING_PAGE_SIZE` reads "a larger page would be silently cut", and `AdminTokenUsageAnalyticsRepository`, `AuditTrailRepository` and `BusinessDataExportRepository` say the same. A 92-day window holds about 3,700 rows (about 40 a day). The read would return 1,000, the ceiling test (`> 5000`) would pass, and the view would show about the first 25 days with real days marked **"No snapshot"**. That is a wrong figure presented as complete, which HS-FR-10 forbids. **Fix:** page with 1,000-row `.range(offset, offset + 999)` calls on the same total order (`as_of_date, metric, dimension` is the unique key, so offset paging is stable). Stop on a short page. Return an error once more than 5,000 rows have been read, never a partial list. Name the page size as a constant (`FINANCE_SNAPSHOT_READ_PAGE_SIZE = 1000`, with the max-rows comment). **Tests:** a mock that serves 1,000 rows per call and returns 3,700 rows over 4 calls, all received; 5,001 rows give the ceiling error; the current `range(0, 5000)` assertion is replaced | **High** |

### Checked and approved

| Item | Result |
|---|---|
| Repository split (E-98, 8.3-R1) | ✅ The new read repository has two reads and no write verb. `git diff --quiet` on the writer repository and its test returns 0, and the 8.2 guard `describe` has no deleted line |
| Server-built view (E-99) | ✅ `buildHistoryView` is pure. The client formats only: labels, `formatCount` / `formatCredits` and a `+` sign. There is no sort, filter, reduce or date arithmetic in the component |
| Route (8.3-R2) | ✅ The correlation id, then `requireAdmin` before any read (the finance route's accepted order). Then the repeated key check, the strict schema (`accountId`, `since_start` and unknown keys are 400), the server window, and the clamp to yesterday UTC. Every response is `no-store`, and `details` appear in development only. There is no audit, as for the finance route |
| `not_installed` (E-100) | ✅ 200, a `warn`, and the calm `AdminNotice` with no retry |
| One fetch on load (8.3-R3) | ✅ The failed-read and loaded paths are both proven in `financePage.render.test.tsx`. AC-173, Pin B and the other one-fetch tests are unedited and green |
| `statusChip` | ✅ Defaults to `true`, so existing callers' DOM is unchanged |
| Isolation and money | ✅ No caller id, five columns, platform aggregates only, no currency and no sum across currencies |
| Guards | ✅ The vocabulary guard is unedited and green. No file is added under `app/admin/components/layout/` (C-14). The authz guard covers the new route with no allow-list edit |
| Seven pins (SA recomputed) | ✅ `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a` |
| SA re-run | ✅ `app/admin/finance`, the view, the finance guard, both finance routes, the read repository and the vocabulary guard: **26 suites, 2137 passed** (before C-1) |

### Deviation rulings

| # | Ruling |
|---|---|
| D-1 | **Approved.** `financePage.render.test.tsx` is **not** a frozen-pin file: none of the seven pins and no hash constant names it. The new `describe` only adds tests, and the history literal is not in the AC-173 table |
| D-2 | **Approved.** The error stays visible inside the block: when the hook reports `error`, `AdminError` (`testId="history-error"`) renders with Try again, and the shell's own "Could not load" line is avoided so the toggle survives. The chip shows only once a view is read |
| D-3 | Approved |

### Code Approved for QA: Yes (C-1 fixed and re-checked)

## QA Report

**QA — 2026-10-17** (on the C-1-fixed tree; the read repository and its test changed at 15:40–15:41, before every QA run below)
**Test mode:** full
**Strategy used:**
- **A + B + C:** Jest view, route, repository, render, page and guard suites, run one at a time.
- A code read of the fixed `listSnapshotsInRange`.
- **PGlite 0.5.8 with `20261078` applied**, in the QA scratchpad and never production, seeded with **3,203 real 8.2-builder rows**: 91 days ending yesterday, 2 gap days, one day missing `credit_used`, and `accounts_total` rising daily.
  - It paged the rows exactly as the fixed repository does, and also ran the pre-C-1 single capped read.
- **Temporary untracked probe tests**, deleted after the run:
  - **the real `BusinessOsFinanceSnapshotReadRepository`** against a fake client that serves those rows with PostgREST's **1,000-row max-rows cap** and real filter, order and range semantics;
  - **the real `buildHistoryView`** with the real entitlements config, on daily, weekly, gap and empty windows.
- A scoped tsc with a canary.

**Focus:** api, ui, security
**Skipped:** the live browser look (user, L-159 to L-162 below; L-163 was dropped by E-100).
**Input source:** prompt + workplan + coordinator note on C-1

**Verdict: PASS. No open bugs.** **C-1 (High) was found by SA (SA-CR-8.3), fixed by Dev and re-checked by SA.** QA confirms the fix independently (below).

### Suite runs (each alone, worktree `neuronforge-finance-m8`, branch `feature/bos-finance-health-8-3`, uncommitted)

| Suite | Result |
|---|---|
| `app/admin/finance` (incl. the 5 appended page tests and the block tests) | 20/20, 680/680 |
| `lib/business-os/finance` (incl. `historyView`, the finance guard 8.3 `describe`) | 19/19, 1892/1892 |
| The finance route `app/api/admin/business-os/finance/__tests__` (AC-145) | 1/1, 106/106 |
| The history route `app/api/admin/business-os/finance/history` | 1/1, 16/16 |
| History route + read repository, re-run after C-1 | 2/2, 29/29 (SA's figure) |
| `app/admin/components` | 25/25, 824/824 |
| Vocabulary guard | 1/1, 182/182; unedited |
| `lib/repositories` | 104/104, **2517/2517** (Dev's 2,515 + the 2 C-1 paging tests) |
| `npm run test:authz-guard` | 2/2, 203/203 (the new route covered, no allow-list edit) |
| `npm run test:bos-entitlements` | 286/286, **8760/8760** (Dev's 8,758 + the same 2) |
| `npm run lint:hooks` | exit 0 |

**Pins (LF-normalised):** AC-173 `3a1a2dd4…f6f8` ✅, helper `b84e0c96…aabf` ✅, A `30f5fc24…2e01` ✅, B `24ff0da7…df9f` ✅, C `98ea0507…1e4b` ✅, C helper `02813360…5bd8` ✅, D `1f7cf07a…f144` ✅. All are clean against HEAD.

**Untouched set:** `git diff --quiet HEAD` is clean on:
- the writer repository and its test;
- the finance page route, `financeUrl.ts`, `useFinanceData.ts`, `financeFilters.ts`;
- `app/admin/components/layout`, `supabase`, `lib/business-os/entitlements`;
- the 8.2 builder, job and `app/api/cron`.

No test file loses a line.

**Scoped tsc:**
- Config in the scratchpad covering 26 files: the changed and new files, the sibling sections, the finance route, `useFinanceData`, `financeUrl`, Pin B and AC-173.
- A canary in `historyView.ts` gave `(219,7) TS2322` only.
- The file was restored with `cp` and checked with `cmp` (identical).
- The clean run gives **exit 0, 0 errors**.

### C-1, confirmed independently

| Run | Result |
|---|---|
| PGlite, the pre-C-1 read (one query, capped at max-rows 1,000) | **1,000 rows, 28 of 89 days**: silently partial, which is the defect SA found |
| PGlite, the fixed paging (`ORDER BY as_of_date, metric, dimension`, 1,000 per page, stop on a short page) | **3,203 of 3,203 rows in 4 calls**, no duplicate key |
| The real read repository over a 1,000-capped fake client | 3,203 rows in exactly 4 calls ✅ |
| The real read repository with 6,000 rows | `error: … ceiling`, `data: null`: never a partial list ✅ |

### The view over the seeded rows (real `buildHistoryView`, real config)

| Case | Result |
|---|---|
| 92-day window | `state ready`, `firstSnapshotDate 2026-07-18`, **weekly**. 13 points, newest first, every 7 days back from yesterday (`2026-10-16 … 2026-07-24`). Columns follow Section 1's group order, then Total and Founding Partners with no end date. Change `accounts_total` = 190 − 106 = **84** ✅ |
| 31-day daily window | 31 points; gap day `2026-09-15` gives **No snapshot**; `credit_used` on `2026-09-01` gives **Not recorded** (no value, never 0) ✅ |
| Oldest point is a gap | every change cell is **Not available**, never a guess ✅ |
| Window starting before the first snapshot | no day before `2026-07-18` is listed ✅ |
| Today only | `none_in_window` (`to` clamped to yesterday) ✅ |
| Empty table | `no_history` ✅ |
| Money or currency | none anywhere in the payload (`usd`, `currency`, `revenue`, `amount` absent) ✅ |

### Edge cases

| Case | Result | Evidence |
|---|---|---|
| A non-admin is refused | ✅ | route: no session gives 401; a non-admin (even one whose profile claims admin) gives 403, with no read; `requireAdmin` precedes `searchParams` |
| Every response is no-store | ✅ | route source test; `noStore` on the gate, `NO_STORE` on every JSON body |
| Table missing: "not available yet" | ✅ | route: 200 `not_installed` plus a `warn`; block: the calm `AdminNotice`, no error, no Try again (E-100) |
| No snapshots: "a snapshot is taken every night at 00:07 UTC" | ✅ | `HISTORY_NONE_YET` exact copy (E-101); block test; view `no_history` |
| The start line shows the first snapshot date | ✅ | "History starts on {date} (UTC)."; "No snapshot in this window. History starts on {date} (UTC)."; probe `firstSnapshotDate 2026-07-18` |
| Weekly points and gaps | ✅ | probe (above); `historyView.test.ts` |
| No sums across currencies | ✅ | the table and the view hold no money (HS-W-9); credit change in integer micro-credits |
| Paying unknown shows as unknown, never 0 | ✅ | an unknown-paying night writes no `plan` row (8.2). The view shows a missing metric as **Not recorded**, never 0 (probe) |
| One request on load; "Show history" sends one more | ✅ | page tests: a failed read gives 1 fetch (AC-173's path); loaded and closed gives 1 fetch (Pin B's path); Show gives exactly one more, the pinned literal, never with a business; a window change while closed sends none |
| An error inside the block is visible | ✅ | AC-292: the block's own `AdminError` with Try again, which re-sends; the other sections stay rendered (D-2 approved) |
| Closed by default | ✅ | block test "no status chip and no request"; page test "shows the block CLOSED" |
| The writer is unreachable from the read path | ✅ | `financeHistoryDeps.ts` imports only `BusinessOsFinanceSnapshotReadRepository` (and the config through `financeHealthDeps`). The read repository has **0** write verbs. Only the history route imports the wiring. The writer is imported only by `financeSnapshotDeps.ts` (8.2-R2 unedited). Guards have planted controls |

### Test Coverage

| AC | Verdict | Evidence |
|---|---|---|
| AC-287 | PASS | route tests (401 / 403 with zero reads; 400 for `accountId`, `since_start`, an unknown key, a repeated key and 93 days; re-resolved window; view only, never raw rows; no-store) |
| AC-288 | PASS | three start lines (block tests, view probe) |
| AC-289 | PASS | daily ≤ 31 and weekly beyond; No snapshot; Not recorded; the change line only between recorded cells (probe + `historyView.test.ts`) |
| AC-290 | PASS | page tests (one fetch on load, both paths; one more on Show); the seven pins and the other one-fetch tests unedited and green |
| AC-291 | PASS | "(no longer configured)" render; labels from config; no tier literal (guards) |
| AC-292 | PASS | block test; D-2 |
| AC-293 (8.3) | PASS | 7 pins; AC-145 green; vocabulary unedited; no new CI job |
| AC-294 (8.3) | NOT-TESTED (user) | L-159 to L-162 below |

### Issues Found
- **Bugs:** none open.
  - **C-1 (High), found by SA in SA-CR-8.3, fixed and re-checked.** `listSnapshotsInRange` (`lib/repositories/BusinessOsFinanceSnapshotReadRepository.ts`) did one `.range(0, 5000)` read, which PostgREST cuts at 1,000. It now pages 1,000 rows in key order and errors past 5,000. QA reproduced the loss on the old shape (28 of 89 days) and the fix (all 3,203 rows).
- **Performance:** none. A 92-day window is about 4 page reads of at most 1,000 rows.
- **Edge cases (nice to fix):** none new.

### User browser steps (after 8.1 is applied and 8.2 has run for a few nights; read-only)

- **L-159, on load.**
  - Open `/admin/finance`, All businesses, This month, with the network panel open.
  - The History block sits after "Credits", **closed**, with a "Show history" button and no status chip.
  - Exactly **one** request: `/api/admin/business-os/finance?preset=this_month`.
- **L-159, Show history.**
  - Click "Show history": exactly one more request, `/api/admin/business-os/finance/history?preset=this_month`.
  - The block reads "History starts on {first day} (UTC)." and lists one row per day, newest first, from that day to yesterday.
  - "Hide history" closes it and sends nothing.
- **L-160, the morning after a snapshot.**
  - The newest Plan mix row equals Section 1 (group counts, Total, Founding Partners with no end date).
  - The newest Credits row equals Section 4 and K-2 / K-4, give or take changes since 00:07 UTC.
- **L-161, a business picked.** Pick the owner test account. The block shows only "History is kept for all businesses together, not per business." There is no button and no history request.
- **L-162, a long window.** Custom, 60 days: "Weekly points" shows, no day before the first snapshot is listed, and a missing day reads "No snapshot", never 0.
- **Optional, on the first morning only:**
  - Today-only reads "No snapshot in this window. History starts on … (UTC)."
  - If nothing has been recorded yet, the block reads "No history yet: a snapshot is taken every night at 00:07 UTC."

### Final Status
- [x] All code-level 8.3 acceptance criteria pass on the C-1-fixed tree. AC-294 is the user's L-159 to L-162. No open bugs. **Ready for RM** once #452 and 8.2 are in main (merge main, no rebase; BD-33).
- [ ] Issues found

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Dev: workplan written | From §11M.8 with E-85 to E-97, read against `2f335510`. VL-1 to VL-17. Seven questions for SA: a server-built view instead of raw rows (-1), an optional status chip (-2), a "not installed" state (-3), exporting `seedGroups` (-4), the ruled importer list (-5), the empty-history sentence (-6) and the window (-7). No chart (SA-Q106). No code changed |
| 2026-10-17 | Dev: 8.3 implemented (uncommitted) | Read-only snapshot repository (E-98), the server-built view (E-99), the route with not_installed (E-100), the closed History block with the E-101 copy; 57 new tests plus guards; deviations D-1 to D-3; seven pins equal |
| 2026-10-17 | SA workplan review | APPROVED WITH CONDITIONS (SA-WR-8.3): W-8.3-5 changed to a repository split (no guard widening); W-8.3-6 copy changed; others accepted; 8.3-R1 to R3; requirement E-98 to E-101 applied by SA |
| 2026-10-17 | SA code review | Fix Required (SA-CR-8.3): C-1 page the range read at 1,000 rows; rest approved; D-1 to D-3 approved |
| 2026-10-17 | SA re-check of C-1 | Code Approved (SA-CR-8.3); C-1 paging verified, 29 passed |
