# Workplan: Admin Layout Standard — Slice L-2b (AI cost & usage, part 2: table, status chips, call-detail drawer)

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (rows 4, 6, 7), §4.3, §5.7, §5.8, §5.9, §5.10, §5.11, §5.12 (A-1 to A-9), §6.1, §6.2 C-3, C-5, C-9, C-12, C-13, C-14, §7.5 (L-2b), §9 F-45 to F-53, §10 D-9 (a), D-10 (a), §12.3; SA rulings Q-15 (constants + `OpenRowButton`), re-check R-6 (no `useDrawerResource` here), R-13; L-1d SA Q-2 (the numeric cell constants wait for the first number column), L-1d SA Q-10 (rows open through the button only); [L-1d workplan](/docs/workplans/ADMIN_LAYOUT_L1D_WORKPLAN.md) (drawer pattern, QA B-1), [L-2a workplan](/docs/workplans/ADMIN_LAYOUT_L2A_WORKPLAN.md) (deferrals, S-5 renames, SA N-2, QA B-1, the 19 type errors)
**Branch:** `feature/admin-layout-l2b`, cut from `feature/admin-layout-l2a` at `f455bb24` (PR #295, open). The L-2b PR targets `main` and carries L-2a until #295 merges. Worktree `neuronforge-admin-layout`
**Date:** 2026-10-11
**Status:** Committed — 1357ad92, PR #296 open (fast-track); awaiting checks + user merge (contains #295 until it merges)
**Path:** Full cycle by classification (SA Q-1, M-1: R-7, shared exports no pilot needed: `ADMIN_TH_NUM` / `ADMIN_TD_NUM` and the `isPlainLeftClick` export). Run as workplan review → SA code review → QA (in sequence) → RM under the user's fast-track (RM commits and opens the PR without a user diff review). The call detail still renders from the row already loaded (R-6)

## Overview

L-2b moves the lower half of `/admin/analytics` onto the standard. The table takes the shared table classes (one density, numbers right-aligned and tabular, unique headers). The call status glyph becomes a `StatusChip` with words. The Trend column goes (D-9 (a)). The hand-built framer-motion call modal becomes `AdminDrawer`, opened by `OpenRowButton` and rendered from the loaded row (no new request). Aggregate rows drill through a real link (§5.8 D-3). The agent panel stops expanding and becomes a static card. Quick stats and the top-consumer list move below the table. Times are UTC, decorative green goes, and the 19 type errors in the page's lower half are fixed. No route, request or data change.

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary-code-verified-at-f455bb24)
- [2. Scope and decisions](#2-scope-and-decisions)
- [3. Implementation Approach and APIs](#3-implementation-approach-and-apis)
- [4. Files to Create / Modify](#4-files-to-create--modify)
- [5. Guard and registry changes](#5-guard-and-registry-changes)
- [6. Tests](#6-tests)
- [7. Verification](#7-verification)
- [8. Task List](#8-task-list)
- [9. Sizing and the split decision](#9-sizing-and-the-split-decision)
- [10. Risks](#10-risks)
- [11. Out of scope and found on the way](#11-out-of-scope-and-found-on-the-way)
- [12. Questions for SA](#12-questions-for-sa)

---

## 1. Analysis Summary (code verified at `f455bb24`)

### 1.1 The lower half of `app/admin/analytics/page.tsx` (1,032 lines)

| Lines | What | Problem (§9 / standard) |
|---|---|---|
| `:5-16` | lucide imports; `DollarSign`, `BarChart3` unused | F-47 |
| `:4` | `motion`, `AnimatePresence` (only the agent panel and call modal use them) | gone with both |
| `:66-100` | `ContextChips`: renders `meta.userCount` / `agentCount` / `executionCount` (type `unknown`) | **3 of the 19 TS errors** (`:76`, `:85`, `:93`, `{}` → `ReactNode`) |
| `:137-139`, `:193` | `availableFilters` state, set from every response, never read | F-52; ESLint warning |
| `:146`, `:216-220`, `:235`, `:243` | `selectedCall` holds a **snapshot** of the clicked item; the call row is opened by a click on the whole `tr` | no button, no keyboard path |
| `:149` | `showAgentJson` (agent panel expand) | §5.8 D-1 |
| `:255-258` | `topConsumers` = the 3 highest-cost items | kept |
| `:323-325` | main grid `grid grid-cols-1 gap-6 xl:grid-cols-12` (L-2a made it collapse below xl) | Q-15: cards below the table |
| `:328-380` | aside: Quick Stats (`:330-354`, `h3`, compact numbers) and Top Token Consumers (`:357-379`, gradient avatars incl. **emerald** `:363`, percentage `text-purple-400`, cost `text-slate-500` `:371`) | F-51-like decoration, T-5, A-6 (`h3` with no `h2`) |
| `:383` | `<section className="xl:col-span-9">` | — |
| `:386-514` | breadcrumbs (rewired in L-2a, S-5); chevrons not hidden from screen readers; count "`| Showing N items`" in `text-slate-500` (`:513`) | T-5 |
| `:517-694` | the table: card wrapper `bg-slate-800 … overflow-hidden` (no sideways scroll); `thead bg-slate-900/50`, `th px-4 py-3`, `td px-4 py-4` (loose, `:570`…); no `scope="col"`, no `aria-label` | §5.7 |
| `:521-547` | headers: first column = the group-by label; aggregate: Cost, Tokens, Calls, (All) Creation / Execution / Memory in **purple / emerald / blue** (`:539-541`), **Trend** (`:544`), an **empty** chevron header (`:545`); call: Cost, Input Tokens, Output Tokens, Total Tokens, Latency, Status. Grouped by Execution in All scope, two headers read "Execution" | §5.7 unique headers; F-46; T-6 |
| `:551-558` | empty row "No data found", `colSpan` 9 / 6, `Cpu` icon, hint in `text-slate-500` | §5.10 Empty |
| `:563-568` | `tr onClick={handleRowClick}`: aggregate rows drill, call rows open the modal; not focusable | §5.8 D-2, D-3; L-1d Q-10 |
| `:573-586` | provider / model "icon" tile: gradients incl. **green / emerald** (`:575-579`) | F-51-like decoration |
| `:592-602` | activity category badge, **emerald** for execution (`:595`) | T-6 |
| `:615-621` | call status: **glyph only** `✓` `text-green-400` / `✗` `text-red-400`; `success` undefined shows `✗` | F-45, A-7 |
| `:629-637`, `:666-674` | category cells and footer totals in purple / **emerald** / blue | T-6 |
| `:640-646` | Trend cell, always "-"; chevron cell | F-46, D-9 (a) |
| `:655-680` | aggregate footer: "Subtotal" only when provider / model / activity / agent is filtered (`:659`) | F-49 (label) |
| `:699-795` | agent panel: framer-motion card, a "Show details" toggle (`:708-729`); inside: Started / Completed as **`toLocaleString()`** (`:747`, `:755`), status coloured **green / red / yellow** text (`:761-767`), Agent ID `text-slate-500` (`:771`), Connected Plugins as purple pills (`:778-789`) | F-50, T-6, T-5, §5.8 D-1 |
| `:797-1029` | call modal: hand-built overlay + panel, no Escape, no focus trap, **icon-only X with no name** (`:828-833`); success pill green / red (`:818-826`); **Cost in `text-green-300`** unless `isHighCost` (`:849`); "Success: Yes / No" green / red (`:855`); BI category pill incl. emerald (`:900-906`); Time **`toLocaleString()`** (`:1004`); Call ID `text-slate-500` (`:1020`) | F-53, F-48, F-51, F-50, T-5; **16 of the 19 TS errors** (`:879`, `:881`, `:882`, `:885`, `:891`, `:897`, `:913`, `:920`, `:926`, `:932`, `:938`, `:956`, `:962`, `:968`, `:985`, `:998`, all `unknown` → `ReactNode`) |

The 19 errors were re-counted for this plan with a scratch tsconfig over `app/admin/analytics/**` (session scratchpad, not committed): exactly the 19 lines above, all in `page.tsx`, none in the L-2a files or the tests.

### 1.2 Where the rows and the detail come from (route unchanged)

| Fact | Where |
|---|---|
| Call rows exist only when an `execution` is filtered, which only the All scope allows | `route.ts:73`, `:79-90`; page `normaliseForScope` |
| A call row carries everything the modal shows in `item` and `item.metadata` (model, provider, input / output tokens, latency, success, timestamp, activity type / name / step, BI category, db category, request type, feature, component, endpoint, workflow step, call id) | `route.ts:1143-1176` (an execution); `route.ts:994-1015` (a `single-` execution: fewer keys) |
| `isHighCost` on a call = the most expensive call of that run (when the run has more than one) | `route.ts:1153` |
| `executionDetails` (started, completed, status, agent summary) comes with the same response | `route.ts:1186-1192` |
| Execution row labels are formatted on the server with `toLocaleString('en-US')` and no time zone | `route.ts:795-801`, `:832-838` (found, §11) |

So the call drawer renders from `items` and the execution card from `executionDetails`, both already loaded: **no new request** and no `useDrawerResource` (R-6).

### 1.3 Shared folder facts this plan depends on

| Fact | Where |
|---|---|
| `adminTable.ts` has `ADMIN_TABLE_WRAP`, `ADMIN_TABLE`, `ADMIN_THEAD`, `ADMIN_TH`, `ADMIN_TBODY`, `ADMIN_TD`, `ADMIN_TD_ID`, `ADMIN_COUNT_LINE`, `ADMIN_BUTTON`, `formatShortId`; the numeric constants are deferred to the first number column (its header comment) | `adminTable.ts:9-12` |
| `AdminDrawer` (`open`, `onClose`, `onReturnFocus`, `title`, `titleSuffix`, `testId`), `DrawerSection` (`role="group"` + `h3`), `DrawerFields`, `DrawerField`; no fetch, no states | `AdminDrawer.tsx:47-132` |
| `OpenRowButton` (`label` must start with "Open", `onOpen(opener)`) | `OpenRowButton.tsx:15-37` |
| `StatusChip` tones `danger`, `warn`, `ok`, `info`, `unknown` (no `neutral`); children must be a string; the only green lives there | `StatusChip.tsx:21-60` |
| `AdminEmpty` (`message`, `hint`, `onClear`, `testId`) | `AdminStates.tsx:61-87` |
| `formatUtc` ("YYYY-MM-DD HH:mm UTC", em dash for null / invalid), `formatCount` | `adminFormat.ts:21-36` |
| `KpiStrip.tsx` has the plain-left-click test the filter tiles use, **not exported** | `KpiStrip.tsx:131-140` |
| L-1d drawer state: `isOpen` + `openId` + opener ref + content ref; an effect closes when the open row leaves the data; focus falls back to a connected content element (QA B-1) | `audit-trail/page.tsx:642-652`, `:802-825`, `:1028`, `:1243-1252` |

### 1.4 Tests that pin the lower half

| File | Pins |
|---|---|
| `bosLens.render.test.tsx` | `rowFor` finds the label in `tbody` and returns its `tr` (`:154-158`), every drill clicks that `tr` (`clickRowAndExpectNext` `:167-170`, P-8 `:273`, P-11 `:320`, P-9 `:355`); P-1 empty `colspan` "6" (`:208-213`); P-2 empty `colspan` "9" (`:226-232`); `table-col-creation/execution/memory` absent in BOS, present in All (`:205`, `:223`); P-7 context chips "2 agents" / "3 executions" (`:234-248`); P-8 "Agent One" shown after an execution click and gone after the scope switch (`:267-285`); P-9 clicks `/Show details/` (`:358`), then "Started", "completed", "Connected Plugins" (`:362`), "google-mail", and no `SECRET-` text (`:350-376`) |
| `analytics.layout.render.test.tsx` | R-13 clicks the `tr` of "Row feature" (`:597-598`); QA B-1 asserts no "No data found" (`:293`) |
| `ownerText.guard.test.ts` | the folder walk covers new files automatically; the "walk finds" case lists five files (`:82-94`) |
| `layoutFolder.guard.test.ts` | registry entry for this page, five files (`:494-504`) |
| `adminTable.test.ts` | the class lists, "one density", "only the id cell is monospace" |

`scope.render`, `linkedWindow.render` and `bosLens.qa.render` use empty or aggregate items and pin nothing in the lower half.

---

## 2. Scope and decisions

### 2.1 In L-2b

1. Table on the shared constants (§5.7); `ADMIN_TH_NUM` / `ADMIN_TD_NUM` built here (their first consumer, L-1d SA Q-2).
2. Call status → `StatusChip` (F-45). Trend column removed (D-9 (a), F-46). The empty chevron column removed. Headers unique, currency named.
3. Call modal → `AdminDrawer` + `OpenRowButton` (F-53, F-48 modal X).
4. Aggregate rows drill through a link in the label cell (§5.8 D-3).
5. Agent panel → a static execution card (§2.4).
6. Quick stats and top consumers → cards below the table (Q-15, R-13).
7. UTC times (F-50); no decorative green (F-51, SA N-2); T-5 text colours.
8. Empty state → `AdminEmpty` (§5.10).
9. Footer "Total" / "Subtotal" from every drill filter (F-49, label only).
10. Zero type errors in `app/admin/analytics/**`; the unused `DollarSign`, `BarChart3`, `availableFilters` removed (F-47, F-52; SA L-2a optimisation note).
11. The lower half extracted into `components/` and one pure helper file (§2.6).

### 2.2 Decision: aggregate rows drill through a link; call rows open through the button only

- **Aggregate rows** (provider … execution) exist to narrow the view, which §5.8 D-3 calls navigation: the row label becomes an `<a href>` to the drilled view (`ANALYTICS_PATH + hrefFor(rowClickPatch(item, effective))`). A plain left click applies the same patch in place (and records the label, as today); a modified or middle click opens the filtered view in a new tab. This is the KPI filter tile's behaviour (L-2a). The `tr` loses its `onClick`: one path, the link, reachable by keyboard (today the row is not focusable at all).
- **Call rows** have more detail than their cells (§5.8 D-1): an `OpenRowButton` in a first "Details" column, and **no** row click (L-1d SA Q-10: no clickable `tr` around a button, one tested path). Today the call row's `tr` click is the only way in.
- Visible change: an admin clicks the row's **name** to drill, not anywhere on the row. Named in the PR (§3.9).

### 2.3 Decision: the plain-click test is the filter tile's own, exported (SA Q-3, M-1)

The filter tile's `isPlainLeftClick` (`KpiStrip.tsx:131-140`) gains `export`: same name, same body, no new file. `components/AnalyticsTable.tsx` imports it through the alias. One implementation, pinned from both sides (the KPI tile's filter-mode tests and T-3). The page-local copy first proposed here is withdrawn (two copies of one predicate drift). `EXPECTED_SOURCES` is unchanged.

### 2.4 Decision: the agent panel becomes a static card, not a drawer

§7.5 says "agent details' inline expand → the drawer". Dev proposes a card instead:

- It is not a row. It describes the run that every row on screen belongs to, so it is context for the table, not the detail of one record. §5.7 sends "a small fixed set of differently-shaped things" to cards.
- It has seven fields (agent name, mode, agent status, run status, started, completed, agent id) and a plugin list. Both statuses stay, labelled apart (SA M-2): "Run status" is the chip, "Agent status" plain text. Hidden behind a click today, it costs one click to see six values; a drawer would keep the click and add a modal.
- One drawer per page stays one drawer (L-1d pattern): no second opener, no second focus-return path, and no interaction with the call drawer.
- §5.8 D-1's ban on "inline expanding rows" is met: nothing expands.

The card sits **above** the table (the context first), in place of today's panel below the grid. Fallback if SA rules for the drawer: a second drawer kind (`{ kind: 'run' }`) opened by an `OpenRowButton` "Open details for this run" on a one-line summary, about +0.5 day. See Q-2.

### 2.5 Decision: the call drawer reads the row by id from the loaded items (L-1d B-1 lesson)

`selectedCall` (a snapshot) becomes `isOpen` + `openCallId`; the drawer shows `items.find(i => i.id === openCallId && i.type === 'call')`. Following L-1d's QA B-1 fix:

- An effect on `[isOpen, openCall]` clears both when the open call leaves `items` (a read in flight that lands without it, or a failed read that clears `items`). Radix does not call `onOpenChange` for a prop change, so without it a later read that brings the call back would reopen the drawer unasked.
- Escape, X and overlay clear only `isOpen`, so the content stays during the slide-out.
- `onReturnFocus` focuses the opener if it is still connected, else a content wrapper that is **always mounted**. Today the content unmounts on an error (L-2a `showContent`), so the wrapper is moved out: one `div ref={contentRef} tabIndex={-1} aria-busy={loading} className="space-y-4 focus:outline-none"` now holds the error, the first-read loading and the content. This also covers the L-2a B-1 sequence (success → failure → retry) with a drawer open.
- The scope switch and the breadcrumb "All Data" also clear both (as they cleared `selectedCall`).

### 2.6 Decision: extract the lower half into the page folder

`page.tsx` would otherwise carry about 500 rewritten lines next to the L-2a code. Extracting keeps each review unit small and lets `page.tsx` hold only state, the fetch, the drawer wiring and the breadcrumbs.

| New file | Contents |
|---|---|
| `analyticsCall.ts` (pure, no React) | `readMeta(item)` → a typed `CallMeta` (each key a string, number or boolean, or `null`; never `unknown`), `callStatus(success)`, `executionStatusTone(status)`, `formatLatency(ms)`, `isDrilled(filters)` |
| `components/AnalyticsTable.tsx` | `AnalyticsTable` (aggregate and call variants, footer), `ContextChips` (moved, typed), the page's `DrillLink` (using the exported `isPlainLeftClick`) |
| `components/AnalyticsCallDetails.tsx` | the drawer body (sections and fields) |
| `components/AnalyticsExecutionCard.tsx` | the run card |
| `components/AnalyticsSummaryCards.tsx` | Quick stats and the top-3 list |

The breadcrumbs stay in `page.tsx` (rewired in L-2a with SA M-1 pinned per level); they get class edits only (§3.7). Expected `page.tsx` size: about 420 lines.

### 2.7 Not in L-2b

Any route or request change; the server-side execution labels (§11); a time column in the call table; the K-4 statuses and the cross-page tile mode (still deferred); the `neutral` chip tone (not needed: plain state words use plain text here); `useDrawerResource` (L-8); F-94.

---

## 3. Implementation Approach and APIs

### 3.1 `adminTable.ts` (shared): the numeric cell classes

```typescript
/** Right-aligned header for a number column (§5.7 Numbers). Pages add `scope="col"`. */
export const ADMIN_TH_NUM = 'px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-slate-400';

/** A number cell: right-aligned, tabular figures, never wrapped, never monospace (C-13). */
export const ADMIN_TD_NUM = 'px-3 py-2 align-top text-right tabular-nums whitespace-nowrap';
```

Literal strings (Tailwind scans them). The header comment loses "arrive with the first table that has a number column" and names AI cost & usage as the first consumer. No other shared file changes.

### 3.2 `analyticsCall.ts` (page, pure)

```typescript
export interface CallMeta {
  model: string | null; provider: string | null;
  latencyMs: number | null; success: boolean | null; timestamp: string | null;
  requestType: string | null; dbCategory: string | null; category: string | null;
  activityType: string | null; activityName: string | null; activityStep: string | null; workflowStep: string | null;
  feature: string | null; component: string | null; endpoint: string | null; callId: string | null;
  userCount: number | null; agentCount: number | null; executionCount: number | null;
}
export function readMeta(item: DrillDownItem): CallMeta;
export function callStatus(success: boolean | null): { tone: StatusTone; word: string };
export function executionStatusTone(status: string | null | undefined): StatusTone;
export function formatLatency(ms: number | null, style: 'cell' | 'detail'): string;
export function isDrilled(filters: AnalyticsFilters): boolean;
```

- `readMeta` narrows each key with `typeof` (a string only if a non-empty string, a number only if finite, a boolean only if boolean). This replaces every `as string` / `as number` cast and is what removes the 19 errors. No `any`.
- `callStatus`: `true` → `ok` "Succeeded"; `false` → `danger` "Failed"; `null` → `unknown` "Unknown" (SA Q-6, M-3). **Today a missing `success` shows `✗` in the table and "No" in the modal**, which reads as a failure nobody recorded (A-7: never invent a status). Named in the PR (§3.9 item 4).
- `executionStatusTone`: `completed` → `ok`, `failed` → `danger`, missing → `unknown` (the chip says "Unknown"), any other value → `info` (today's yellow; §5.9 `info` is "Running / informational"). The chip's words are the stored status as today (`completed`), so P-9 keeps its text.
- `formatLatency`: `cell` = today's table text (`1234ms`, rounded); `detail` = today's modal text (`1.23s` at 1,000 ms and above). Both em dash for `null` **and for 0** (§5.7 Missing value; today a dash "-" via truthiness; SA S-3). The drawer does not render the Latency field for 0 or `null`, as today.
- `isDrilled`: true when any of the eleven drill / business / category fields that `drillPatch` names is not at its default. Used for the footer word (F-49).

`StatusTone` is a type-only import from the shared `StatusChip` (alias path, S-1).

### 3.3 `components/AnalyticsTable.tsx`

Props: `items`, `scope`, `breakdownBy`, `totals`, `categoryTotals`, `drilled: boolean`, `drillHref(item) => string`, `onDrill(item)`, `onOpenCall(item, opener)`.

**Wrapper and table:** `ADMIN_TABLE_WRAP` (sideways scroll inside the frame, §5.7 Wide tables); `<table className={ADMIN_TABLE} aria-label=…>` with "AI cost by {dimension}" or "AI calls in this run"; `thead` `ADMIN_THEAD`; every `th scope="col"`, text in `ADMIN_TH` / numbers in `ADMIN_TH_NUM`; `tbody` `ADMIN_TBODY`; text cells `ADMIN_TD`, numbers `ADMIN_TD_NUM`.

**Aggregate columns** (BOS 4, All 7):

| Header | Cell | testid |
|---|---|---|
| the group-by label (e.g. "Provider") | `DrillLink` with the label (`font-medium text-white hover:underline`, A-1 ring), then `ContextChips`, then the activity category as plain `text-xs text-slate-400` words | — |
| Cost (USD) | `formatCost(item.cost)`, `text-slate-200` | — |
| Tokens | `formatNumber(item.tokens)` (compact, as the Tokens tile) | — |
| Calls | `formatCount(item.calls)` (exact, as the Calls tile; the footer and Quick stats Calls use `formatCount` too, SA S-1) | — |
| Creation (USD) / Execution (USD) / Memory (USD) (All only) | cost or em dash; **no colour** | `table-col-creation` / `-execution` / `-memory` (kept) |

"(USD)" also makes the headers unique when grouped by Execution in the All scope. Trend and the empty chevron column are gone.

**Call columns** (8): Details (`OpenRowButton`, label `Open details for call {n}, {label}`, `testId="open-call-{id}"`), Call (the label), Cost (USD), Input tokens, Output tokens, Total tokens (compact as today), Latency (`formatLatency(…, 'cell')`), Status (`StatusChip` from `callStatus`, `testId="call-status"`). The number in the name keeps it unique when labels repeat ("gpt-4o call").

**Footer** (`tfoot`, `tr className="font-medium text-slate-200"`, numbers on `ADMIN_TD_NUM`): aggregate = "Subtotal" when `drilled`, else "Total", then cost, tokens, calls, and (All) the three category totals uncoloured; call = "Total", cost, input, output, total tokens. Trailing `td`s fill the remaining columns so the footer lines up (no blank header, the footer cells are empty data cells).

**`DrillLink`:** `<a href={drillHref(item)} onClick={…}>`. On a plain left click (button 0, no meta / ctrl / shift / alt, not already prevented): `preventDefault()` and `onDrill(item)`. Anything else: the browser follows the href. The check is `isPlainLeftClick`, exported from `KpiStrip.tsx` and imported through the alias (§2.3, SA Q-3). The `<a>` holds only the label text: `ContextChips` and the activity category words sit outside it, so the link's name is exactly the label (SA S-4); its A-1 ring classes are literal.

**`ContextChips`:** moved, reads `readMeta(item)`; same words, same classes (`bg-slate-700/50 text-slate-400`), same scope rule.

Removed: the provider / model gradient tile (`:573-586`; it repeated the first three letters of the label), the coloured category headers, cells, badge and footer.

### 3.4 `components/AnalyticsCallDetails.tsx` (the drawer body)

Rendered by the page inside `<AdminDrawer open={isOpen && openCall !== null} onClose={() => setIsOpen(false)} onReturnFocus={returnFocus} title="Call details" titleSuffix={meta.timestamp ? formatUtc(meta.timestamp) : undefined} testId="call-drawer">`. Sections (`DrawerSection` + `DrawerFields` + `DrawerField`); a section whose fields are all absent is not rendered, as today:

| Section | Fields |
|---|---|
| Call | Call (label); Status (`StatusChip`); Time (`formatUtc`, em dash when absent); Latency (`formatLatency(…, 'detail')`, when present); Call ID (full, `font-mono text-xs break-all`, when present) |
| Model | Model, Provider ("Unknown" when absent, as today) |
| Cost and tokens | Cost (USD) as plain `text-slate-200`, plus "most expensive call in this run" in `text-slate-400` when `isHighCost` (replaces the red / green colour, which was the only signal, A-7); Input tokens, Output tokens, Total tokens (compact, as today) |
| Classification | Request type, Category (db), BI category (plain words, no coloured pill) |
| Activity | Activity type, name, step, workflow step (shown under today's condition: type, name or step present) |
| System context | Feature, Component, Endpoint (`font-mono text-xs break-all`) |

Input and output tokens come from `item.inputTokens` / `item.outputTokens` (typed, same values as today's `metadata.inputTokens || 0`). The X is the sheet's own close button, named "Close" (F-48). No request is sent on open. Latency 0 hides the field, as today's truthiness check did (SA S-3).

**Where the drawer is rendered (SA M-4):** `AdminDrawer` is rendered **once, at page level, unconditionally**: outside the always-mounted content wrapper and outside every `error` / `hasLoaded` / `showContent` branch, with `open={isOpen && openCall !== null}` and the body only when `openCall` is non-null (the `audit-trail/page.tsx:1243-1252` shape). A failed read therefore closes the dialog through its `open` prop and the tested `onCloseAutoFocus` path, never unmounts it.

### 3.5 `components/AnalyticsExecutionCard.tsx`

Shown when `scope === 'all' && executionDetails?.agent` (today's condition), above the table. Card shell `rounded-xl border border-slate-700 bg-slate-800/40 p-4`, `data-testid="execution-card"`; `h2 text-sm font-semibold text-white` = the agent name; a sub-line `text-xs text-slate-400` "Agent run · {mode} · {n} plugin(s)" (parts present only when known). A `dl` (`grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm`, `dt text-slate-400`, `dd text-slate-200`): Started (`formatUtc`, em dash when absent; today "N/A"), Completed (`formatUtc`, or "In progress" when absent, as today), Run status (`StatusChip` with `executionStatusTone`, the stored word, "Unknown" when absent), Agent status (plain text, the stored word, shown only when present; SA M-2: today's "• active" in the panel sub-line must not vanish), Agent ID (`formatShortId`, full id in `title`, `ADMIN_TD_ID` classes), Connected plugins (one `span` per plugin, `rounded border border-slate-600 bg-slate-700/40 px-2 py-0.5 text-xs text-slate-300`). No expand, no motion, no fields beyond today's (C3-5: metadata only).

### 3.6 `components/AnalyticsSummaryCards.tsx`

Below the table: `grid grid-cols-1 gap-4 md:grid-cols-2`. Card shell as §3.5, `h2` titles:

- **Quick stats:** a `dl`: Calls, Avg cost per call, Avg tokens per call, Input tokens, Output tokens (same values and formatters as today; "-" → em dash).
- **Top 3 by cost** (was "Top Token Consumers"; it is sorted by cost, `:256-258`): an `ol`, each item the label, its cost and its share (`{n}%`), `text-slate-200` / `text-slate-400`, `tabular-nums`. No avatars. Rendered only when there are items, as today.

Both scopes, as L-2a left them (R-13, Q-15).

### 3.7 `page.tsx`

- Imports: drop `motion`, `AnimatePresence`, `Calendar`, `DollarSign`, `BarChart3`, `ChevronDown`, `Cpu`, `X`, `Hash`, `Clock`, `FileJson`, `BREAKDOWN_OPTIONS`, `formatNumber`, `AvailableFilters`; add `useRef`, `AdminDrawer`, `AdminEmpty`, the new components and `analyticsCall`.
- State: `availableFilters` removed (F-52; the type keeps the field, the route still sends it); `selectedCall` → `isOpen` + `openCallId` + `opener` + `contentRef` (§2.5); `showAgentJson` removed.
- `handleRowClick` splits: `onDrill(item)` (label record + `setFilters(rowClickPatch(item, effective))`, the aggregate branch unchanged) and `openCall(item, button)`.
- Content order inside the always-mounted wrapper: error | first-read loading | (incomplete notice → scope notes → breadcrumbs → execution card → count line → table or `AdminEmpty` → summary cards). The run card comes before the count line, so the count line sits directly above the table it counts (SA S-2).
- `AdminDrawer` is rendered once at page level, after and outside the wrapper and every branch (SA M-4, §3.4).
- Count line: `ADMIN_COUNT_LINE` "Showing {n} item(s)" (was `text-slate-500` after a "|").
- Empty: `AdminEmpty testId="analytics-empty" message="No AI usage matches this window and these filters." hint="Try a longer window, the other scope or fewer filters."`, with `onClear={clear}` only while `!isDefault` (the bar's Clear).
- Breadcrumbs: class edits only. `ChevronRight` gets `aria-hidden="true"`; buttons get the A-1 focus ring; the last crumb `aria-current="true"`. Their `drillPatch` calls are untouched (SA M-1).

### 3.8 States and the B-1 sequences (§5.10)

| Sequence | Expected |
|---|---|
| Read in flight → Open a call → the read lands without that call | drawer closes; focus on the content wrapper (connected), never `body`; a later read that brings the call back leaves it closed |
| Success → Open a call → Escape | focus back on that call's Open button |
| Success → Refresh in flight → Open → the read **fails** | drawer closes; the error shows; focus on the wrapper; strip hidden |
| … then Try again (pending) | placeholders and "Reading AI cost and usage…", no "$0.00", no empty-state sentence (L-2a B-1 kept) |
| … then the read succeeds with the call back | drawer stays closed; the table shows; Open works again |

### 3.9 Visible changes on `/admin/analytics` (named in the PR)

0. Call counts are exact ("1,234", as the Calls tile) in the table, footer and Quick stats, where they were compact ("1.2K"); tokens stay compact (SA S-1).
1. Table density and look as every migrated admin table; headers sentence-case on screen as uppercase labels, "Cost (USD)", "Creation (USD)" etc.; numbers aligned in tabular figures; wide tables scroll inside their frame.
2. Trend column and the empty arrow column removed (D-9 (a)).
3. Drill by clicking the row's **name** (a real link: Ctrl- or middle-click opens the drilled view in a new tab); the rest of the row is no longer clickable.
4. Call status reads "Succeeded" / "Failed" / **"Unknown"**: a call with no stored outcome now reads Unknown (it used to show the failure mark).
5. Call details open in a right-side panel from an "Open" button in each call row: Escape, the X and a click outside close it; focus returns to the button.
6. Call cost is no longer green or red; the most expensive call of a run says so in words.
7. Times in the call panel and the run card are UTC ("2026-09-03 10:00 UTC"), not the browser's local time.
8. The run (agent) details are always shown in a card above the calls, with no "Show details" toggle; its status is a chip with words.
9. Quick stats and the top list sit below the table; "Top Token Consumers" is renamed "Top 3 by cost" (it was always sorted by cost); the coloured avatars are gone.
10. No decorative colour in the table, footer or cards: the only green is a "Succeeded" / "completed" chip.
11. Empty result: a sentence, a hint and "Clear filters" (when a filter is on), instead of "No data found" inside the table.
12. The footer says "Subtotal" whenever the view is drilled (any filter, business or category), "Total" otherwise.

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/components/layout/adminTable.ts` | modify | `ADMIN_TH_NUM`, `ADMIN_TD_NUM` (§3.1) |
| `app/admin/components/layout/__tests__/adminTable.test.ts` | modify (extend) | the two constants in the class table, density and monospace cases |
| `app/admin/components/layout/KpiStrip.tsx` | modify | `export` on `isPlainLeftClick`, body unchanged (SA Q-3, M-1) |
| `app/admin/analytics/analyticsCall.ts` | create | §3.2 |
| `app/admin/analytics/components/AnalyticsTable.tsx` | create | §3.3 |
| `app/admin/analytics/components/AnalyticsCallDetails.tsx` | create | §3.4 |
| `app/admin/analytics/components/AnalyticsExecutionCard.tsx` | create | §3.5 |
| `app/admin/analytics/components/AnalyticsSummaryCards.tsx` | create | §3.6 |
| `app/admin/analytics/page.tsx` | modify | §3.7, §2.5 |
| `app/admin/analytics/__tests__/analyticsCall.test.ts` | create | §6.1 |
| `app/admin/analytics/__tests__/analytics.table.render.test.tsx` | create | §6.1 |
| `app/admin/analytics/__tests__/bosLens.render.test.tsx` | modify | §6.2 |
| `app/admin/analytics/__tests__/analytics.layout.render.test.tsx` | modify | §6.2 |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | registry (§5) |
| `app/api/admin/token-usage/drill-down/__tests__/ownerText.guard.test.ts` | modify | the "walk finds" list (§5) |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify | §1 row 7; §9 F-45 to F-53 dispositions; §7.5 page deviations (agent card, empty state); Change History |
| this workplan | modify | task ticks, Implementation Notes |

Not touched: `app/api/**`, `lib/**`, `components/ui/*`, every other shared layout file, the L-2a files (`analyticsTypes.ts`, `analyticsFilters.ts`, `AnalyticsKpis.tsx`, `AnalyticsFilterBar.tsx`), every other admin page. Line endings: the analytics files are CRLF in this checkout and stay CRLF; new files LF (as L-2a).

---

## 5. Guard and registry changes

| File | Change | Why |
|---|---|---|
| `layoutFolder.guard.test.ts` (part (b)) | the analytics entry gains `analyticsCall.ts` and the four new components; its comment drops "The table and drawers in page.tsx are L-2b" | §12.3; every page file must import nothing relative into the shared folder, have no `<h1` and no direct `.json(` |
| `ownerText.guard.test.ts` | the "walk finds" case lists the five new files too | strengthening only; the walk already reads them |

`EXPECTED_SOURCES` and part (a) are unchanged (no new shared file). The shared folder's single green constant stays the only green: the page files gain no `emerald` / `green` class (pinned by §6.1 T-9).

---

## 6. Tests

### 6.1 New

**`__tests__/analyticsCall.test.ts`** (unit):

| # | Case |
|---|---|
| U-1 | `readMeta` keeps strings, finite numbers and booleans; turns `''`, `NaN`, `Infinity`, objects, arrays and wrong types into `null`; `{}` and a missing `metadata` give all `null` |
| U-2 | `callStatus`: `true` → ok "Succeeded", `false` → danger "Failed", `null` → unknown "Unknown" |
| U-3 | `executionStatusTone`: `completed` ok, `failed` danger, `running` / `pending` / anything else info, `''` / `null` / `undefined` unknown |
| U-4 | `formatLatency`: cell `1234.4` → `1234ms`; detail `999` → `999ms`, `1234` → `1.23s`; `null` and `0` → em dash both (SA S-3) |
| U-5 | `isDrilled`: false at defaults; true for each of the eleven fields alone (feature, component, endpoint, account, request type and category included: the F-49 cases) |

**`__tests__/analytics.table.render.test.tsx`** (real page, the L-2a harness: `next/navigation` and both logger mocks, a fetch stub with `ok`, `json`, `pending` and a **`deferred`** answer the test resolves; the shared `afterEach`: no `pushState`, every `replaceState(null, …)`, no refused Business OS request):

| # | Case |
|---|---|
| T-1 | BOS: the table is named "AI cost by Provider", 4 `columnheader`s (Provider, Cost (USD), Tokens, Calls), each `scope="col"`, all texts unique; numeric headers and cells carry `text-right` and `tabular-nums`, not `font-mono`; no "Trend" anywhere |
| T-2 | All: 7 headers; grouped by Execution, the headers are still unique ("Execution" and "Execution (USD)") |
| T-3 | Drill link: the row label is a link whose `href` is `/admin/analytics?group_by=model&provider=provider-1`; a plain click is `defaultPrevented`, sends one request with `provider` and `breakdownBy=model`, no reload; ctrl, meta, shift and middle clicks are not prevented and send nothing; the `tr` has no click handler (a click on the cost cell sends nothing) |
| T-4 | Call rows (All, `?scope=all&execution=<uuid>`): 8 headers; each row's first cell is an "Open" button named "Open details for call 1, Step 1"; the status chip reads "Succeeded" (`data-tone="ok"`), a `false` row "Failed" (danger), a row without `success` "Unknown" (unknown); no `✓` / `✗` in the page |
| T-5 | Open → a dialog named "Call details 2026-09-03 10:00 UTC"; it shows Model, Provider, Cost (USD) without a green or red class, "most expensive call in this run" for the `isHighCost` row only, the Activity and System context sections when their keys are present and not otherwise; **no request is sent on open**; a row with no stored outcome: the drawer's Status reads "Unknown" (SA S-6) |
| T-6 | Escape closes it and **focus is on that row's Open button**; the X (named "Close") does the same |
| T-7 | **Open row disappears:** a Refresh is `deferred` → Open call 2 → the read lands without call 2 → the dialog is gone, `document.activeElement` is connected and is not `body`; a later read with call 2 back leaves the dialog closed; Open still works |
| T-8 | **Success → failure → retry:** with the drawer open on a deferred Refresh, the read fails (500) → no dialog, `analytics-error` shows, focus on a connected element (not `body`); Try again pending → 4 placeholders and "Reading AI cost and usage…", no "$0.00", no `analytics-empty`; it succeeds with the call back → table shown, no dialog |
| T-9 | No decorative green: in BOS and All, aggregate and call tables, the execution card and the summary cards, no element outside a `[data-tone="ok"]` chip has a class matching `emerald` or `green` |
| T-10 | Execution card: "Agent One", sub-line with the mode and "1 plugin(s)", Started "2026-09-03 10:00 UTC", Completed "2026-09-03 10:01 UTC", Run status chip "completed" (ok), Agent status "active" (plain text, M-2), Agent ID "44444444…" with the full id as `title`, "google-mail"; no button inside the card; no `SECRET-` text |
| T-11 | Empty: `analytics-empty` with the sentence; no `table`; "Clear filters" only when a filter is on, and it resets the URL to clean |
| T-12 | Footer: "Total" at defaults; "Subtotal" after a feature drill (F-49: today's rule said "Total" there) and with `?account=` |
| T-13 | Summary cards follow the table in document order; headings "Quick stats" and "Top 3 by cost" are `h2`; Quick stats shows Calls "3" and Avg cost per call "$0.50" |

### 6.2 Edited deliberately (each listed in the PR with its reason)

| File | Edit | Reason |
|---|---|---|
| `bosLens.render.test.tsx` `rowFor` (`:154-158`) | returns the **drill link** in `tbody` (`getAllByRole('link', { name: label })`), not the `tr`; the doc comment says so. Every caller (`clickRowAndExpectNext` `:167-170`, P-8 `:273`, P-11 `:320`, P-9 `:355`) is unedited | §5.8 D-3: the row drills through its link; the `tr` has no handler (§2.2) |
| `bosLens.render.test.tsx` P-1 empty (`:208-213`) | expects `analytics-empty` and no `table`; renamed "P-1: the empty state is a sentence, not a table row" | §5.10 Empty (`AdminEmpty`); the colspan no longer exists |
| `bosLens.render.test.tsx` P-2 empty (`:226-232`) | same, for All | as above |
| `bosLens.render.test.tsx` P-1 / P-2 (`:196-206`, `:215-224`) | add the header count: 4 in BOS, 7 in All | the column-count intent of the two colspan tests, kept |
| `bosLens.render.test.tsx` P-9 (`:350-376`) | no "Show details" click (the card is always shown); "Connected Plugins" → "Connected plugins"; the rest unedited ("Started", "completed", "google-mail", no owner text, no `SECRET-`) | §2.4 static card; sentence case |
| `analytics.layout.render.test.tsx` R-13 (`:597-598`) | clicks the "Row feature" link, not the `tr` | §2.2 |
| `analytics.layout.render.test.tsx` QA B-1 (`:293`) | also asserts `queryByTestId('analytics-empty')` is null (the old "No data found" check stays and is now always true) | keeps the B-1 pin meaningful after the empty-state change |
| `adminTable.test.ts` | the two constants added to the class table, the density case and the monospace case | §3.1 |
| `layoutFolder.guard.test.ts`, `ownerText.guard.test.ts` | §5 | §5 |

### 6.3 Must stay green with no edit

`scope.render`, `linkedWindow.render`, `bosLens.qa.render`, `analyticsFilters.test`, the rest of `analytics.layout.render` and `bosLens.render` (P-3 to P-8, P-10 to P-12 through the edited helper), every other shared folder test (`AdminDrawer.render`, `OpenRowButton.render` and the KPI strip suite `KpiStrip.render` included: the `isPlainLeftClick` export leaves them unedited and green, M-1), the Audit trail suites (the other `AdminDrawer` consumer), Jobs and Health, the drill-down route tests.

---

## 7. Verification

| # | Step | Expect |
|---|---|---|
| V-1 | `npx jest app/admin/analytics app/admin/components/layout app/api/admin/token-usage --ci` | all green |
| V-2 | `npx jest app/admin/audit-trail app/admin/__tests__ lib/admin/health app/admin/components/__tests__ lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | all green, unedited |
| V-3 | Mutation checks, each restored (md5 before = after, `git status --short` identical): (a) drop `preventDefault` in `DrillLink` → T-3; (b) let a ctrl-click call `onDrill` → T-3 modifiers; (c) empty the close-when-gone effect → **T-7 and T-8**; (d) replace the focus fallback with `opener.current?.focus()` → **T-7 and T-8**; (e) pass a no-op as `onReturnFocus` → **T-6**; (f) add a drill-down `fetch` in the Open handler → T-5 "no request on open"; (g) remove `setHasLoaded(false)` from `fail()` → **T-8** and the L-2a B-1 case; (h) move the content wrapper back inside `showContent` → T-8 focus; (i) map `null` success to "Failed" instead of "Unknown" → U-2, T-4; (j) put the Trend header back → T-1; (k) revert the footer to the provider / model / activity / agent rule → U-5, T-12; (l) format the drawer time with `toLocaleString()` → T-5 and T-10 (run with `TZ=Asia/Jerusalem` for the whole Jest process; a probe asserts `getTimezoneOffset()` is -180, then is deleted); (m) add `text-emerald-400` to the Execution (USD) cells → T-9; (n) drop the agent status line from the card → T-10 (SA S-6); (o) render `AdminDrawer` inside the `showContent` branch → T-8 (SA S-6, M-4) | each named test red, then green after restore |
| V-4 | `npm run test:bos-entitlements` | green (no file imports `lib/business-os/**`) |
| V-5 | Scoped `tsc`: scratch tsconfig in the session scratchpad (never committed), `extends` the worktree `tsconfig.json`, `incremental: false`, absolute `include` of `next-env.d.ts`, `app/admin/analytics/**`, the shared folder and its tests, `components/ui/sheet.tsx`, the Audit trail page (the other drawer and table consumer). **Run 1:** canary `const canary: number = 'x';` appended to `analyticsCall.ts` → exactly that TS2322 and nothing else. **Run 2:** canary removed (md5 equal) → **zero errors**, the 19 included | both runs recorded |
| V-6 | `npm run lint:hooks`; `npx eslint` on every touched file | no hook violation; zero warnings in `page.tsx` (the three old unused-name warnings gone) |
| V-7 | `git diff --stat feature/admin-layout-l2a` **before reading the diff** (the L-2b part only; the PR diff against `main` also carries L-2a until #295 merges) | insertions where expected; no blanked file; nothing under the "not touched" list of §4. SA S-7: the base is `feature/admin-layout-l2a` while #295 is open; if #295 merges first, rebase onto `origin/main`, re-run V-1 / V-2 before code review and use `origin/main` as the base. The PR text describes only the L-2b changes |
| V-8 | grep the analytics folder for `console.`, `toLocaleString()` with no locale, `emerald`, `green`, `motion`, `as string`, `as number` | none (the KPI `toLocaleString('en-US')` calls stay) |
| V-9 (QA / TL, browser) | §7.1 | one line or screenshot per item |

`node_modules` is a junction to the main checkout: never remove or replace it. No `git stash`, no `git worktree remove`, no commit by Dev.

### 7.1 Browser checks for TL (signed-in admin, DevTools Network open, light **and** dark scheme emulation, SA Q-8)

| # | Do | Expect |
|---|---|---|
| B-B1 | Open `/admin/analytics` | table in the standard frame and density; headers Provider, Cost (USD), Tokens, Calls; numbers right-aligned; no Trend; Quick stats and "Top 3 by cost" below the table; no green anywhere |
| B-B2 | Click a provider name | drills in place (no reload, one request); breadcrumb and chip appear |
| B-B3 | Ctrl-click (or middle-click) a model name | a new tab opens at the drilled view; the current tab is unchanged |
| B-B4 | Tab through the table | each row name gets the purple focus ring; Enter drills |
| B-B5 | Scope off (All); Group by Agent → an agent → an execution | the run card above the calls (agent name, UTC Started / Completed, status chip, short agent id, plugins); call rows with Open buttons and Succeeded / Failed chips |
| B-B6 | Open a call | right-side panel "Call details {UTC time}"; Escape closes it and focus is back on that Open button; the X and a click outside also close it; the X is visible and rings on focus in both schemes |
| B-B7 | Compare the panel's Time with the database `created_at` | the same UTC minute (not the local time) |
| B-B8 | DevTools "Slow 3G": Refresh, then at once Open a call; then offline + Refresh with a call open via keyboard (Tab to Open, Enter, then the read fails) | the panel never reopens by itself; after the failure the red alert shows and focus is on the page, not lost; Try again shows "Reading…" then the table |
| B-B9 | A window and filters with no data | the empty sentence, the hint and "Clear filters" |
| B-B10 | Phone width | the table scrolls sideways inside its frame; the page does not; the two cards stack |
| B-B11 | Grouped by Execution in All scope | first header "Execution", category header "Execution (USD)" |

---

## 8. Task List

- [x] T-1 `adminTable.ts` numeric constants + `adminTable.test.ts` (§3.1)
- [x] T-2 `analyticsCall.ts` + `analyticsCall.test.ts` (§3.2)
- [x] T-3 `components/AnalyticsTable.tsx` (§3.3)
- [x] T-4 `components/AnalyticsCallDetails.tsx`, `components/AnalyticsExecutionCard.tsx`, `components/AnalyticsSummaryCards.tsx` (§3.4 to §3.6)
- [x] T-5 `page.tsx`: drawer state and the B-1 handling, the always-mounted content wrapper, the empty state, breadcrumb classes, removals (§2.5, §3.7)
- [x] T-6 `analytics.table.render.test.tsx` (T-1 to T-13) and the §6.2 edits
- [x] T-7 Registry and `ownerText.guard` (§5)
- [x] T-8 Verification V-1 to V-8; results under Implementation Notes
- [x] T-9 Requirement: §1 row 7 status and built list; §9 F-45, F-46, F-47, F-48 (modal), F-49 (label), F-50, F-51, F-52, F-53 dispositions; §7.5 page deviations (static run card, `AdminEmpty` instead of a colspan row; Q-2); the new §9 finding (§11); Change History
- [x] T-10 Hand over to TL for SA code review (uncommitted)

---

## 9. Sizing and the split decision

| Part | Days |
|---|---|
| Shared constants + tests | 0.15 |
| `analyticsCall.ts` + unit tests | 0.4 |
| `AnalyticsTable` (two variants, drill link, footer) | 0.8 |
| Drawer body, run card, summary cards | 0.5 |
| `page.tsx` rewiring, drawer state, B-1 handling, layout | 0.5 |
| New render suite (T-1 to T-13) + test edits | 0.9 |
| Guards, mutations, tsc, lint, docs | 0.5 |
| **Total** | **about 3.75 days** |

**Decision: one slice.** It is inside "a few days" and below L-2a (4.5). The parts are tied: the drawer opener lives in the table, and the B-1 handling needs the content wrapper the table half sits in. **Tripwire, pre-proposed:** if the work passes about 5 days, split at T-4 / T-5: L-2b1 = table, chips, drill link, cards, empty state, layout, the type errors in `ContextChips`; L-2b2 = drawer, run card and the 16 modal type errors (the modal stays untouched in L-2b1). See Q-5.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| The drawer reopens by itself, or focus falls to `body`, when the open call leaves the data | §2.5 (L-1d's fix, plus a wrapper that survives the error state); T-7, T-8; mutations (c), (d), (h) |
| A drill link causes a full navigation | `preventDefault` on plain left click only; T-3; B-B2 |
| Admins used to clicking anywhere on a row | The name is a visible link with underline on hover; named in the PR (§3.9 item 3) |
| A call with no stored outcome now reads "Unknown" instead of the failure mark | Named in the PR (§3.9 item 4); it was never a recorded failure |
| `readMeta` narrowing hides a value the modal used to show (e.g. a numeric string) | The route sends these keys from typed columns (`route.ts:1157-1175`); U-1 pins each type; B-B5 / B-B6 compare with today |
| Removing `availableFilters` breaks a reader | Grep: no reader in the page folder (ESLint already flags it as unused); the type field stays |
| The PR also shows L-2a while #295 is open | Expected; V-7 reads the L-2b diff against `feature/admin-layout-l2a`; RM rebases or retargets once #295 merges |

---

## 11. Out of scope and found on the way

**Out of scope:** §2.7.

**Found (to add to §9 at T-9, not fixed):**

- **F-new-1** The route builds execution row labels ("Agent One - Jun 15, 3:45 PM") with `toLocaleString('en-US')` and **no time zone** (`route.ts:795-801`, `:832-838`): the label shows the server's clock, unlabelled. On Vercel that is UTC, but the label does not say so. A route change; disposition open.
- **F-new-2** The Activity section is hidden when a call has only a workflow step (the condition at `page.tsx:914` does not include it, though the field is shown inside). Kept as is in L-2b (no behaviour change); disposition open.

---

## 12. Questions for SA

| # | Question | Dev lean |
|---|---|---|
| Q-1 | Path: L-2b adds two literal class constants to `adminTable.ts` (`ADMIN_TH_NUM`, `ADMIN_TD_NUM`). They are named in C-13 and were deferred to "the first table with a number column, L-2b or L-3" by L-1d SA Q-2. Does that keep L-2b on the UI short path (no new behaviour, no new component), or does R-6 / R-7 make it full cycle? | Short path. **SA ruling: full cycle by classification (applied, M-1)** |
| Q-2 | The agent panel becomes a static run card above the table instead of a drawer (§2.4), a recorded deviation from §7.5's text | Card |
| Q-3 | The drill link's plain-click check is a page-local copy of `KpiStrip`'s private `isPlainLeftClick` (§2.3), rather than a new shared export | Page-local copy. **SA ruling: export it unchanged and import it (applied, M-1)** |
| Q-4 | `AdminEmpty` replaces the "No data found" table row (§5.10), so the P-1 / P-2 colspan pins become "no table + the empty sentence" plus a header count (§6.2), instead of §7.5's "one column fewer" | As stated |
| Q-5 | One slice of about 3.75 days, with the L-2b1 / L-2b2 tripwire at about 5 days (§9) | One slice |
| Q-6 | Call status `null` → `unknown` (was the failure mark); execution status other than completed / failed → `info` (was yellow text) | As stated. **SA ruling: the word is "Unknown" (applied, M-3)** |
| Q-7 | The footer says "Subtotal" whenever any of the eleven drill / business / category fields is set (F-49, label only, no data change) | As stated |
| Q-8 | "Top Token Consumers" renamed "Top 3 by cost" (it is sorted by cost) | As stated |

No product question for the user: every visible change above follows from the standard or corrects a label.

---

## Implementation Notes (Dev, 2026-10-11)

Branch `feature/admin-layout-l2b` (worktree `neuronforge-admin-layout`), nothing committed. One slice: the L-2b1 tripwire was not reached.

### Workplan edits before coding (SA M-1 to M-4)

| # | Applied in |
|---|---|
| M-1 | Header Path line (full cycle by classification), §2.3 (export, not a copy), §3.3 `DrillLink`, §4 (`KpiStrip.tsx` row), §6.3 (KPI strip suite), §12 Q-1 / Q-3 rulings noted |
| M-2 | §2.4 (seven fields, both statuses), §3.5 ("Run status" chip, "Agent status" plain text), T-10 |
| M-3 | "Unknown" in §3.2, U-2, T-4, §3.9 item 4, §10, V-3 (i), §12 Q-6 |
| M-4 | §3.4 (drawer rendered once at page level, unconditionally) and §3.7 |
| S-6 / S-3 / S-1 / S-2 / S-7 | Mutations (n) and (o) and the T-5 no-outcome case in §6.1 / §7; latency 0 in §3.2 and U-4; exact call counts in §3.3 and §3.9 item 0; run card before the count line in §3.7; the diff-base note in V-7 |

### Files

| File | Change |
|---|---|
| `app/admin/components/layout/adminTable.ts` | `ADMIN_TH_NUM`, `ADMIN_TD_NUM` (literal strings); header comment names AI cost & usage as the first consumer |
| `app/admin/components/layout/KpiStrip.tsx` | `export` on `isPlainLeftClick`; its doc comment names the second consumer. Body unchanged (SA Q-3) |
| `app/admin/analytics/analyticsCall.ts` | new (121 lines): `readMeta`, `callStatus`, `executionStatusTone`, `formatLatency`, `isDrilled` (compares against `drillPatch({})`, so `analyticsFilters.ts` is untouched) |
| `app/admin/analytics/components/AnalyticsTable.tsx` | new (259): aggregate and call tables, `ContextChips` (moved, typed), `DrillLink` (imports `isPlainLeftClick`) |
| `app/admin/analytics/components/AnalyticsCallDetails.tsx` | new (108): drawer body |
| `app/admin/analytics/components/AnalyticsExecutionCard.tsx` | new (76): the run card |
| `app/admin/analytics/components/AnalyticsSummaryCards.tsx` | new (64): Quick stats, Top 3 by cost |
| `app/admin/analytics/page.tsx` | 1,032 → 538 lines (297 insertions, 791 deletions): drawer state and B-1 effect, always-mounted content wrapper, page-level drawer, empty state, count line, breadcrumb class edits, removals. Larger than the 420 estimated because the breadcrumbs stayed as they were (class edits only, SA M-1 of L-2a) |
| Tests | `analyticsCall.test.ts` (new, 33 cases), `analytics.table.render.test.tsx` (new, 20 cases), §6.2 edits |
| Guards | `layoutFolder.guard.test.ts` registry, `ownerText.guard.test.ts` walk list (now 10 files) |
| Docs | requirement §1 row 7, §7.5 as-built note, §9 F-45 to F-53, F-99, F-100, count, Change History |

Line endings preserved: `page.tsx`, `bosLens.render.test.tsx` and `ownerText.guard.test.ts` are CRLF in this checkout and stay CRLF; every other touched file was LF and stays LF; new files LF.

### Verification (V-1 to V-8)

| # | Result |
|---|---|
| V-1 + V-2 | `npx jest app/admin/analytics app/api/admin/token-usage app/admin/components/layout app/admin/__tests__ app/admin/audit-trail app/admin/business-os-llm app/admin/users app/admin/finance app/admin/components/__tests__ lib/admin/health lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci`: **92 suites, 2,492 tests, all passed.** (One pre-existing `console.error` "Not implemented: window.scrollTo" from framer-motion in `app/admin/users/__tests__/businessOsPanel.render.test.tsx`, not touched by L-2b.) |
| V-3 | Every mutation red, then restored: md5 equal and `git status --short` identical for each. Results below |
| V-4 | `npm run test:bos-entitlements`: 233 suites, 6,382 tests, all passed |
| V-5 | Scoped `tsc` (scratch tsconfig in the session scratchpad, never committed; `extends` the worktree `tsconfig.json`, `incremental: false`; includes `next-env.d.ts`, `app/admin/analytics/**`, the shared folder and its tests, `components/ui/sheet.tsx`, `audit-trail/page.tsx`). **Run 1**, canary `const canary: number = 'x';` appended to `analyticsCall.ts`: exactly one error, `analyticsCall.ts(123,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Run 2**, canary removed (md5 `b19e306d…` before and after): **zero errors** (the 19 included) |
| V-6 | `npm run lint:hooks`: clean (max-warnings 0). `npx eslint` on every touched source and test file: zero errors, zero warnings (the three old unused-name warnings in `page.tsx` are gone) |
| V-7 | `git diff --stat feature/admin-layout-l2a`: 9 tracked files, 376 insertions, 816 deletions (page.tsx 297 / 791); 7 new untracked source and test files plus this workplan. No deletion-only file; nothing under `app/api/**` except the test guard, nothing in `lib/**` or `components/ui/*` |
| V-8 | grep of the analytics folder's non-test sources for `console.`, `: any`, `as any`, `as string`, `as number`, `framer-motion`, `motion.`, `emerald`, `green`, `toLocaleString()`: no code match (one L-2a doc comment in `AnalyticsKpis.tsx` says "green-down", text only) |

**Mutations (V-3).** Each named test red, every other test in the run green:

| # | Mutation | Red |
|---|---|---|
| (a) | drop `preventDefault` in `DrillLink` | T-3 plain click |
| (b) | a modified click calls `onDrill` | T-3 ctrl, meta, shift, middle |
| (c) | empty the close-when-gone effect | T-7, T-8 |
| (d) | focus fallback replaced by `opener.current?.focus()` | T-7, T-8 |
| (e) | no-op `onReturnFocus` | T-6 (and T-7, T-8) |
| (f) | a drill-down `fetch` in the Open handler | T-5 (and T-7, T-8, which count requests) |
| (g) | remove `setHasLoaded(false)` from `fail()` | T-8 and the L-2a QA B-1 case in `analytics.layout.render` |
| (h) | content wrapper moved back inside `showContent` | T-8 |
| (i) | `null` success → "Failed" | U-2, T-4, T-5 |
| (j) | Trend header back | T-1, T-2 |
| (k) | `isDrilled` reverted to the provider / model / activity / agent rule | U-5 (7 fields), T-12 (both) |
| (l) | drawer Time, drawer title and run card Started via `toLocaleString()`, `TZ=Asia/Jerusalem` for the whole Jest process | T-5, T-10. The probe (`getTimezoneOffset()` of 2026-09-03 is -180) passed in the same run and was deleted |
| (m) | `text-emerald-400` on the Execution (USD) cells | T-9 |
| (n) | agent status removed from the card | T-10 |
| (o) | `AdminDrawer` inside the `showContent` branch | T-8 (see deviation 1) |

### Deviations from the workplan

1. **Mutation (o) needed a pin T-8 did not have.** In jsdom, Radix returns focus through the same `onCloseAutoFocus` handler on unmount (FocusScope's unmount auto-focus), so a drawer unmounted with the content behaved the same as one closed by its prop and T-8 stayed green under (o). `analytics.table.render.test.tsx` therefore wraps the real `AdminDrawer` with a hidden marker (`data-testid="drawer-mounted"`, via `jest.mock` + `jest.requireActual`; the drawer itself is the real one), and T-8 asserts the marker is present while the error shows and during the Try again read. (o) is now red on T-8.
2. **`isDrilled` reads `drillPatch({})`** for the eleven defaults instead of a new export from `analyticsFilters.ts`, so that L-2a file stays untouched.
3. **The Classification section is hidden when all three of its fields are absent** (the old modal showed the heading with nothing under it). §3.4 already said "a section whose fields are all absent is not rendered".
4. **The count line is always shown** under the content (as before, "Showing 0 items" included), now on `ADMIN_COUNT_LINE`, with `data-testid="analytics-count"`.
5. **The top list's share reads "{n}% of cost"** (SA N-4, optional, taken).
6. **`page.tsx` is 538 lines**, not about 420 (the breadcrumbs kept their structure).
7. **Breadcrumbs:** besides the planned class edits, each crumb button gained `type="button"`, and "All Data" takes `aria-current` when no other crumb shows. The drill patches are untouched.

### Tests edited (each with its reason)

| File | Edit | Reason |
|---|---|---|
| `bosLens.render.test.tsx` | `rowFor` returns the drill link in `tbody` by exact name; callers unedited | §5.8 D-3: the row drills through its link; the `tr` has no handler |
| `bosLens.render.test.tsx` | P-1 / P-2 empty → `analytics-empty` and no `table`; renamed | §5.10 Empty (`AdminEmpty`, SA Q-4) |
| `bosLens.render.test.tsx` | P-1 / P-2 → header counts 4 and 7 | the column intent of the old colspan pins (D-9 (a)) |
| `bosLens.render.test.tsx` | P-9: no "Show details" click; "Connected plugins" | static run card (SA Q-2); sentence case |
| `analytics.layout.render.test.tsx` | R-13 clicks the "Row feature" link | §2.2 |
| `analytics.layout.render.test.tsx` | QA B-1 also asserts no `analytics-empty` | keeps the B-1 pin meaningful after the empty-state change |
| `adminTable.test.ts` | the two constants in the class table, density and monospace cases | §3.1 |
| `layoutFolder.guard.test.ts` | analytics registry entry: 10 files, comment updated | §5 |
| `ownerText.guard.test.ts` | "walk finds" lists the 10 files, floor 10 | §5 (strengthening only) |

`scope.render`, `linkedWindow.render`, `bosLens.qa.render`, `analyticsFilters.test`, `KpiStrip.render`, `AdminDrawer.render`, `OpenRowButton.render` and every Audit trail suite: green with no edit.

### User-visible changes (for the PR, L-2b only)

The §3.9 list stands as written (items 0 to 12), with "Unknown" for a call with no stored outcome, and the run card showing both "Run status" (chip) and "Agent status" (plain text).

### Found on the way (not fixed)

- F-99 and F-100 recorded in requirement §9 (from §11 of this plan).
- Pre-existing, unrelated: `app/admin/users/__tests__/businessOsPanel.render.test.tsx` logs "Not implemented: window.scrollTo" from framer-motion (the suite passes).

### QA-B1 + C-1 fix (Dev, 2026-10-11, TL decision after SA approval and QA PASS WITH NOTES)

| # | Fix | Where |
|---|---|---|
| QA-B1 | After a drill the focused name link unmounts, and focus fell to `<body>`. `drill` now moves focus to the always-mounted content wrapper (`contentRef`) after it applies the patch. The wrapper gains `data-testid="analytics-content"` so the test can name it | `app/admin/analytics/page.tsx` (`drill`, the content wrapper) |
| C-1 | `AnalyticsTotals` is now `DrillDownResponse['totals']` instead of a hand-written interface, so the shapes cannot drift. Name kept (the summary cards import it) | `app/admin/analytics/components/AnalyticsTable.tsx` |

**New test:** `analytics.table.render.test.tsx` "QA-B1: Enter on a focused row name drills once, and focus lands on the content area, never <body>": focus the name link, Enter (keyDown plus the click a browser makes of it), then one more request (two in total), the old link detached, and `document.activeElement` is the content wrapper, not `body`.

**Mutation:** remove the `contentRef.current?.focus()` call: the QA-B1 test is red (1 failed, 20 passed); restored, md5 `247c7eda…` equal before and after, `git status --short` identical.

**Re-run:** `npx jest app/admin/analytics app/admin/components/layout --ci`: 24 suites, 624 tests, all passed. `npm run lint:hooks`: clean. `npx eslint` on the touched files: 0 errors, 0 warnings. Scoped `tsc` (same scratch config): 0 errors. Line endings kept (`page.tsx` CRLF; the other two LF). Nothing committed.

## SA Review Notes

Workplan review: see "SA Workplan Review — 2026-10-11" below. The code review is added here at the code stage.

## SA Workplan Review — 2026-10-11

**Reviewed by SA — 2026-10-11** (workplan stage, no code). Worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l2b` at `f455bb24` (L-2a commit + docs; PR #295 open).
**Status:** APPROVED WITH CONDITIONS (M-1 to M-4 are workplan edits Dev makes before coding, no second SA pass; S-1 to S-7 checked at code review). One slice. No product question for the user.

**Verified against the code at `f455bb24`:** `app/admin/analytics/page.tsx` (state `:130-152`, `fail()` with the L-2a B-1 `setHasLoaded(false)` `:153-160`, `handleRowClick` `:216-224`, scope toggle `:231-238`, "All Data" `:241-244`, `topConsumers` `:256-258`, `showContent` `:261`, aside `:328-380`, table `:517-694`, agent panel `:699-795`, call modal `:797-1029`); `analyticsFilters.ts` (`drillPatch` `:292`, `DIMENSION_FIELD`, `NEXT_DIMENSION`, `rowClickPatch` `:350-358`: every aggregate row has a drill target, at worst its own filter with the same group by, so every aggregate label may be a link); `analyticsTypes.ts` (`metadata?: Record<string, unknown>`, `formatNumber` compact, `formatCost`); the route (`percentage` is the **cost** share, `route.ts:903` and `:1151`; call metadata keys `:1154-1175`; `executionDetails` `:1186-1192`); shared `adminTable.ts`, `KpiStrip.tsx:131-140` (`isPlainLeftClick`, private), `OpenRowButton.tsx`, `StatusChip.tsx` (`StatusTone` exported, no `neutral`); the L-1d drawer wiring in `audit-trail/page.tsx` (`:646-651`, `:802-825`, `:1028`, `:1243-1252`); `bosLens.render.test.tsx` (`rowFor` `:154-158`, P-9 `:350-376`, fixture `:100-113`: execution status `completed`, **agent status `active`**). No test pins `aria-busy` in the analytics folder (grep), so moving it to an always-mounted wrapper edits no test.

### Rulings on Q-1 to Q-8

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Full cycle, by classification; nothing changes in practice.** L-2b builds shared exports no pilot needed (`ADMIN_TH_NUM` / `ADMIN_TD_NUM`, plus the Q-3 export), which is exactly the R-7 trigger; the constants being literals does not exempt them. The cycle this slice runs is the one already running: this workplan review, then SA code review, **then** QA (in sequence, not in parallel as on the short path), then RM under the user's fast-track (which replaces the user diff read). Update the header Path line and §1 row 7 accordingly (M-1) | The rule is about shared surface, not size. Being honest about the classification costs nothing: every slice has had workplan review + code review + QA anyway, and the drawer focus logic deserves the sequential QA pass after code review |
| Q-2 | **Approved: a static run card, above the table, as a recorded page deviation from §7.5's wording.** Condition M-2 (the agent status must not disappear) | §5.8 D-1 governs rows; the run panel is not a row but the context every call row belongs to, and §5.7 sends a small fixed set of differently-shaped things to cards. "No inline expand" is met (nothing expands). One drawer per page keeps one opener and one focus-return path (the L-1d pattern). Six values hidden behind a click had no reason to be hidden (C3-5 metadata only, P-9 still pins no owner text) |
| Q-3 | **Promote, do not copy: export the existing `isPlainLeftClick` from `KpiStrip.tsx` unchanged (same name, same body, no new file) and import it in `AnalyticsTable.tsx` through the alias.** The page-local copy is withdrawn | Two consumers now exist, and both implement the same contract (§5.8 D-3 drill link = the K-6 filter tile's "real link, plain left click applies in place"). Two copies of a five-line predicate drift silently (one gains a check the other lacks, and the two links behave differently on the same page). Dev's only argument against was the full-cycle cost, which Q-1 removes. No guard change: `EXPECTED_SOURCES` is unchanged, and the predicate imports nothing new. The KPI tile's filter-mode tests and T-3 then pin the one implementation from both sides |
| Q-4 | **Approved: `AdminEmpty` replaces the colspan row; P-1 / P-2 become "no table + the empty sentence" plus a header count (4 / 7).** Record as a page deviation from §7.5's test-edit line | §5.10 Empty is the standard; §7.5's "one column fewer" was written while the empty row still existed. The header count keeps the column intent (D-9 (a): Trend gone). Same as Audit trail after L-1d (QA case 8: `AdminEmpty` and no table) |
| Q-5 | **One slice. Pre-authorised tripwire as written:** past about 5 days, stop at the T-4 / T-5 boundary of §9 (L-2b1 table, chips, drill link, cards, empty state, `ContextChips` errors; L-2b2 drawer, run card, the 16 modal errors) and hand L-2b1 over alone; SA adds the L-2b2 row then | 3.75 days is under L-2a's 4.5; the opener lives in the table and the B-1 handling needs the wrapper the table sits in, so a split forces throwaway interim wiring |
| Q-6 | **Approved as standard-forced, with one wording change (M-3): a missing call outcome reads "Unknown" (`unknown` tone), not "Not recorded".** Execution status other than completed / failed → `info`: approved | Moving to a chip forces a word for every value (§5.9 "text is always present", A-7). Writing "Failed" for a call with no stored outcome would put an untrue word into new code: the old glyph was a side effect of `success ? ✓ : ✗`, never a decision. This is the same call SA and QA made in L-1d (E-1: empty severity → "Unknown", `unknown` tone), so it is not a behaviour fix smuggled into a layout slice. The word is "Unknown" because §5.7 "Missing value" names it, Audit trail uses it, and this very plan already uses "Unknown" for a missing run status: one page, one word for "no status stored". `info` is the nearest §5.9 meaning for running / pending and keeps today's "not success, not failure" reading; `warn` would invent a "needs a look" judgement for values like cancelled (K-5 spirit: no page-invented status) |
| Q-7 | **Confirmed: label only, no data change. F-49 is closed by L-2b (label).** "Subtotal" whenever any of the eleven drill / business / category fields is off its default; "Total" otherwise | The footer figures are the response's `totals` and `categoryTotals` either way; only the word changes. The footer is being rewritten, so a condition must be written; writing the known-wrong one (F-49) into new code is not "no behaviour change". L-2a made every one of those filters visible as a chip (Q-14) and URL key (U-1), so the word must now agree with the chips. Record F-49 in §9 as "std L-2b (label only)" |
| Q-8 | **Approved: "Top 3 by cost".** | It is sorted by cost (`:256-258`) and its percentage is the cost share (`route.ts:903`, `:1151`); nothing in it is about tokens, so the old title was simply false. D-3 governs the page h1, not card titles; §7.5 says the card is "kept", which it is. Named in the PR (§3.9 item 9). Optional: write the share as "{n}% of cost" (N-4) |

### Checks asked for by TL

| Item | Result |
|---|---|
| Drawer state vs L-1d B-1 | ✅ `isOpen` + `openCallId`, the open call derived from `items` by id **and** `type === 'call'`, the close-when-gone effect on `[isOpen, openCall]`, close clears only `isOpen` (S-1 of L-1d), opener ref + connected check: identical to `audit-trail/page.tsx:802-825`. Scope switch and "All Data" clear both, as they cleared `selectedCall` |
| Focus fallback vs L-2a B-1 | ✅ The wrapper moves out of `showContent` so it exists through error and first-read loading; `fail()` empties `items`, so the effect closes the drawer on a failed read and focus lands on the wrapper. T-7 / T-8 and mutations (c), (d), (g), (h) cover it. One gap: where `AdminDrawer` itself is rendered is not stated (M-4) |
| Aggregate-row drill link | ✅ `<a href>` built from `rowClickPatch(item, effective)` through `hrefFor`, plain left click `preventDefault` + `onDrill` (label record + `setFilters`), modified / middle click left to the browser, `tr` with no handler: §5.8 D-3 and the K-6 contract. With Q-3 the predicate is the tile's own. S-4 on the link's content |
| Call-row Open names | ✅ "Open details for call {n}, {label}": starts with the visible "Open" (WCAG 2.5.3), the row number makes it unique when labels repeat; testid by call id. Header "Details", as Audit trail (`audit-trail/page.tsx:1144`) |
| Zero TS errors; `readMeta` typing | ✅ `readMeta` narrows `Record<string, unknown>` by `typeof` into a `CallMeta` of `string | number | boolean | null`; no `any`, no `as` casts. This is what removes all 19 errors (16 modal, 3 `ContextChips`); V-5's canary run proves the scope. `StatusTone` is a type-only alias import from `StatusChip` (exported there) |
| No fetch change | ✅ No edit to `fetchData`, the query, the route or `lib/**`; T-5 counts fetch calls across open; mutation (f). `availableFilters` state removal leaves the type field and the request untouched |
| `ownerText.guard` | ✅ The L-2a walk reads every non-test `.ts` / `.tsx` under `app/admin/analytics/`, `components/` included, so the five new files are covered with no edit; adding them to the "walk finds" list is strengthening only |
| Tests enumerated | ✅ U-1 to U-5, T-1 to T-13, nine deliberate edits each with a reason, and the must-stay-green list. Add the KPI strip suites to §6.3 explicitly (the Q-3 export must leave them unedited and green) and the S-6 cases |
| Mutation checks | ✅ (a) to (m) map one-to-one onto the risks; (l) uses the L-2a S-8 whole-process `TZ` recipe. Add the two in S-6 |
| Sizing | ✅ 3.75 days; Q-3 removes code rather than adding it; M-2 is one field |
| Browser checks | ✅ B-B1 to B-B11 in light and dark (A-8), with Network open. Add to B-B5: the card shows the agent status (M-2); add to B-B6: a call without a stored outcome, if one exists, reads "Unknown" |

### Findings

**Must (workplan edits before coding; SA checks them at code review)**

| # | Where | Finding |
|---|---|---|
| M-1 | Header Path line, §2.3, §3.3 `DrillLink`, §4, §6.3, §12 Q-1 / Q-3 | Apply the Q-1 and Q-3 rulings: the slice is full cycle (R-7), run as workplan review → SA code review → QA → RM (fast-track). `KpiStrip.tsx` joins §4 as "modify: `export` on `isPlainLeftClick`, body unchanged"; §2.3's page-local copy is dropped; the KPI strip suites join §6.3 (green, unedited). Record the export as a shared edit in requirement §1 row 7 at T-9 |
| M-2 | §2.4, §3.5, T-10 | **The run card drops the agent's own status.** Today's panel header shows two statuses: the agent's (`executionDetails.agent.status`, "• active" in the sub-line, `page.tsx:718`) and the run's (`executionDetails.status`, the coloured text inside, `:761-767`). §3.5's sub-line "Agent run · {mode} · {n} plugin(s)" and the single Status field keep only the run's; the agent status would vanish (R-13: no data leaves the page). Keep both, labelled so they cannot be confused: "Run status" = the chip (`executionStatusTone`, stored word, "Unknown" when absent); "Agent status" = plain text, shown when present (it is a plain state word, so no chip, consistent with §2.7). T-10 asserts "active"; P-9's `getByText('completed')` stays unique |
| M-3 | §3.2 `callStatus`, U-2, T-4, §3.9 item 4, §10, V-3 (i) | Missing call outcome reads **"Unknown"** with the `unknown` tone (Q-6), not "Not recorded". Update every place the word appears; §3.9 item 4 becomes "a call with no stored outcome now reads Unknown (it used to show the failure mark)" |
| M-4 | §3.4, §3.7 | State that `AdminDrawer` is rendered **once, at page level, unconditionally**: outside the always-mounted wrapper and outside every `error` / `hasLoaded` / `showContent` branch, with `open={isOpen && openCall !== null}` and the body only when `openCall` is non-null (the `audit-trail/page.tsx:1243-1252` shape). If it sat inside `showContent`, a failed read would unmount the open dialog instead of closing it, and focus return would depend on Radix's unmount path rather than the tested `onCloseAutoFocus` path. T-8 then pins it; see S-6 for its mutation |

**Should (checked at code review)**

| # | Where | Finding |
|---|---|---|
| S-1 | §3.3 Calls column and footer, §3.6 Quick stats, §3.9 | Calls in the table become exact (`formatCount`) where they were compact (`formatNumber`, "1.2K"). Good (§5.11 counts; matches the L-2a Calls tile), but then the footer Calls and the Quick stats Calls must use `formatCount` too, or one page shows the same figure two ways. Name "call counts are exact" in §3.9. Tokens stay compact everywhere (page precision, as the Tokens tile) |
| S-2 | §3.7 content order | Put the run card **before** the count line: breadcrumbs → run card → count line → table (or `AdminEmpty`) → summary cards. §5.7 puts the count line directly above the table it counts |
| S-3 | §3.2 `formatLatency`, U-4 | Today `latencyMs` 0 shows "-" in the cell and hides the field in the modal (truthiness, `:611`, `:983`). Keep that (rule 4, no behaviour change): 0 → em dash in the cell, field absent in the drawer; pin 0 in U-4 |
| S-4 | §3.3 `DrillLink`, §6.2 `rowFor` | The `<a>` contains only the label text: `ContextChips` and the activity category words sit outside it, so the link's accessible name is exactly the label and `getAllByRole('link', { name: label })` matches by exact name. Keep the link's A-1 ring classes literal |
| S-5 | T-9 requirement edits | In §1 row 7 record: Q-1 path, the `isPlainLeftClick` export, page deviations from §7.5 (Q-2 static run card; Q-4 `AdminEmpty` instead of the colspan edit), Q-6 ("Unknown"), Q-7, Q-8. In §9: F-45, F-46, F-48 (modal close), F-50, F-51, F-53 "done L-2b"; F-47, F-52 "fixed in L-2b (unused code removed)"; F-49 "std L-2b (label only)"; F-new-1 and F-new-2 as **F-99** and **F-100** (next free ids), dispositions open |
| S-6 | V-3, §6.1 | Add mutations: (n) drop the agent status line from the card → T-10; (o) render `AdminDrawer` inside the `showContent` branch → T-8 (M-4). Extend T-5 with a no-outcome row: the drawer's Status reads "Unknown" |
| S-7 | §7 V-7, PR text | Diff base for review is `feature/admin-layout-l2a` while #295 is open; if #295 merges first, rebase onto `origin/main` and re-run V-1 / V-2 before code review, and use `origin/main` as V-7's base. The PR text describes only the L-2b changes (L-2a SA N-2: nothing claims the whole page until this slice) |

**Notes (no action required)**

- N-1: Aggregate drill links can share a name when two rows share a label (e.g. two runs of one agent in the same minute). Acceptable: the targets differ and the row context disambiguates (WCAG 2.4.4 in context); call rows are numbered because they open the same drawer.
- N-2: The breadcrumb's last crumb with `aria-current="true"` is fine (it matches the L-2a tile's `current`).
- N-3: `h2` = the agent name on the run card is fine (A-6: one region heading); the sub-line names it as an agent run.
- N-4: Optional: the top list's share as "{n}% of cost" says what the percentage is.
- N-5: F-new-1 (server-formatted execution labels without a time zone) is a route change: its own full-cycle slice if the user asks, never in a layout slice (rule 5).
- N-6: No newest-wins guard on the fetch (L-2a N-1, unchanged). It does not affect the drawer: the effect closes it on whatever read lands last.
- N-7: No entitlements import, no `console.*`, no Supabase, no Zod boundary in this slice (no route change).

### Verdict

**APPROVED WITH CONDITIONS.** Dev makes M-1 to M-4 in this workplan (small edits) and proceeds without a second SA pass; SA checks M-1 to M-4 and S-1 to S-7 at code review, then QA, then RM under the user's fast-track. One slice, Q-5 tripwire pre-authorised. No product question for the user: every visible change is forced by the standard (§5.7 to §5.11, A-7) or corrects a false label (F-49, the card title).

## SA Code Review — 2026-10-11

**Code Review by SA — 2026-10-11**
**Status:** ✅ Code Approved (no must-fix). Proceed to QA, then RM under the user's fast-track.

**Base (S-7):** PR #295 is still OPEN (checked with `gh pr view 295`), so the review base is `feature/admin-layout-l2a`. `git diff --stat feature/admin-layout-l2a`: 9 tracked files, 390 insertions, 827 deletions; 7 new untracked files plus this workplan. No deletion-only file (`page.tsx` 297 / 791 is the planned extraction). Nothing under `app/api/**` except `ownerText.guard.test.ts`; nothing in `lib/**` or `components/ui/*`. If #295 merges before RM opens the PR, RM rebases onto `origin/main` and QA re-runs V-1 / V-2 there.

### What was checked

| Item | Result |
|---|---|
| `page.tsx` read in full after the splice | ✅ Nothing lost. Upper half identical to L-2a (header, KPI strip, filter bar, `normaliseForScope` effect, scope notes, incomplete notice). Breadcrumbs: all ten `drillPatch` calls byte-identical to L-2a (`page.tsx:358-470`, SA M-1 of L-2a kept); only `type="button"`, `aria-hidden` on the chevrons, the A-1 ring and `aria-current` added (deviation 7). L-2a QA B-1 fix kept: `fail()` still calls `setHasLoaded(false)` (`page.tsx:132`). The read is still keyed on the request string (`page.tsx:99`, `:176-178`); `fetchData` unchanged apart from the dropped `availableFilters` state |
| M-1 | ✅ `isPlainLeftClick` exported from `KpiStrip.tsx:135`, body unchanged (doc comment only); imported through the alias at `AnalyticsTable.tsx:18`. `KpiStrip.render` green, unedited |
| M-2 | ✅ `AnalyticsExecutionCard.tsx:146-159`: "Run status" is the chip, "Agent status" plain text, shown when present; T-10 pins "active" and no `data-tone` inside it |
| M-3 | ✅ `analyticsCall.ts:84-88`: `null` → `unknown` "Unknown"; the table (T-4) and the drawer (T-5) both pin it |
| M-4 | ✅ `page.tsx:526-535`: one `AdminDrawer`, after and outside the content wrapper and every `error` / `hasLoaded` / `showContent` branch, `open={isOpen && openCall !== null}`, body only when `openCall` is non-null |
| S-1 | ✅ Calls exact via `formatCount` in the table (`AnalyticsTable.tsx:168`), the footer (`:185`) and Quick stats (`AnalyticsSummaryCards.tsx:222`); tokens compact |
| S-2 | ✅ Run card before the count line, count line directly before the table frame (`page.tsx:489-506`); T-10 pins the order |
| S-3 | ✅ `formatLatency` returns an em dash for 0 and `null` (`analyticsCall.ts:108`); the drawer hides the field for 0 (`AnalyticsCallDetails.tsx:31`); U-4, T-4, T-5 pin it |
| S-4 | ✅ The `<a>` holds only `item.label` (`AnalyticsTable.tsx:105-115`); chips and category words sit outside it; ring classes literal |
| S-5 | ✅ Requirement §1 row 7, §9 F-45 to F-53 dispositions, F-99 / F-100 added, count 98 → 100, Change History row |
| S-6 | ✅ Mutations (n) and (o) recorded; T-5 has the no-outcome row |
| S-7 | ✅ See Base above |
| Drawer state vs L-1d B-1 | ✅ `isOpen` + `openCallId`; the open call derived by id **and** `type === 'call'` (`page.tsx:199-200`); close clears only `isOpen` (`:528`); close-when-gone effect on `[isOpen, openCall]` (`:218-223`); `returnFocus` checks `isConnected`, else the always-mounted wrapper (`:227-230`, `:320`), the same shape as `audit-trail/page.tsx:825`, `:1028`. Scope switch and "All Data" clear both |
| Drill link semantics | ✅ `href` = `ANALYTICS_PATH + hrefFor(rowClickPatch(item, effective))` (the L-2a tile recipe); plain left click → `preventDefault` + `drill` (label record + `setFilters`, the L-2a branch unchanged); modified / middle click left to the browser; no `tr` has a handler. T-3 pins all three |
| Open button names | ✅ "Open details for call {n}, {label}" starts with the visible "Open" (WCAG 2.5.3) and is unique per row; `testId` by call id; header "Details" |
| TypeScript | ✅ SA's own scoped `tsc` (scratch tsconfig in the session scratchpad, `extends` the worktree config, `incremental: false`, the analytics folder, the shared layout folder, `components/ui/sheet.tsx`, `audit-trail/page.tsx`): **zero errors**. Canary (a scratch file importing `readMeta` and assigning `.model` to a `number`) gave exactly one TS2322, so the run really type-checks the folder. Canary file removed; `git status` unchanged |
| `any` / casts | ✅ None in the new or edited source. The only casts in the folder are L-2a's `body as unknown as DrillDownResponse` (`page.tsx:155`, commented, pre-existing). The test's `(global as any).fetch` carries its eslint-disable reason (rule 6) |
| No fetch / API change | ✅ Request, route and `lib/**` untouched; T-5 counts requests across three opens |
| `ownerText.guard` | ✅ The walk lists all ten files, floor 10; green |
| `layoutFolder.guard` | ✅ Registry entry gains the five files; green. `EXPECTED_SOURCES` unchanged (no new shared file) |
| K-5 / no decorative green | ✅ grep: no `emerald` / `green` in the new sources; T-9 pins both views, with a cost in the Execution (USD) cell so a coloured cell would show |
| UTC | ✅ `formatUtc` for the drawer title suffix, drawer Time, card Started / Completed; no `toLocaleString()` without a locale in the folder |
| Accessibility | ✅ Table `aria-label`, every `th scope="col"`, `h2` card titles, `dl` / `dt` / `dd` (the `div` grouping inside `dl` in `Stat` is valid HTML), chevrons `aria-hidden`, last crumb `aria-current`, focus fallback target `tabIndex={-1}` as Audit trail |
| Logging | ✅ No `console.*` in any touched file; the page still logs through `clientLogger` (F-56) |
| Entitlements / skills | ✅ No import from `lib/business-os/**`; no route, repository or plugin scaffolded |
| Line endings | ✅ `git ls-files --eol`: `page.tsx`, `bosLens.render.test.tsx`, `ownerText.guard.test.ts` CRLF in the worktree as before; every other touched file LF as before; the new files LF (0 CR bytes). No backslash in this workplan or in the requirement's added lines |
| ESLint | ✅ `npx eslint app/admin/analytics` plus the two shared files: no output |
| Tests (SA spot run) | ✅ `npx jest app/admin/analytics app/admin/components/layout app/api/admin/token-usage app/admin/audit-trail --ci`: **43 suites, 935 tests, all passed** |

### Ruling on deviation 1 (the `drawer-mounted` marker)

**Accepted.** The `jest.mock` wrapper (`analytics.table.render.test.tsx:37-50`) spreads `jest.requireActual` of the module, so `DrawerSection`, `DrawerFields` and `DrawerField` are the real ones, and it renders the real `AdminDrawer` with the props unchanged: every behaviour T-1 to T-13 asserts still goes through the real drawer and Radix. The marker is a pure presence probe for M-4, which cannot be observed any other way here: a closed sheet renders nothing, and Dev showed that in jsdom Radix's unmount path returns focus through the same `onCloseAutoFocus` handler, so "closed by prop" and "unmounted with the content" are indistinguishable from focus alone. `getByTestId` also throws on two matches, so T-8 pins "exactly one drawer" as well. It is scoped to this one file; the other suites use the drawer unwrapped. Keep the comment that names M-4 (it is there).

### Code Review Comments

None at High or Medium.

| # | File:line | Comment | Priority |
|---|---|---|---|
| C-1 | `components/AnalyticsTable.tsx:44-50` | `AnalyticsTotals` restates the totals shape that `DrillDownResponse['totals']` (`analyticsTypes.ts:98`) and `EMPTY_TOTALS` already carry. Prefer `type AnalyticsTotals = DrillDownResponse['totals']` so the three cannot drift. Not blocking | Low |
| C-2 | `components/AnalyticsCallDetails.tsx:56`, `components/AnalyticsExecutionCard.tsx:133` | The old modal and panel applied `capitalize` to provider, mode and agent status ("Openai", "On_demand", "Active"); the new card and drawer show the stored word ("openai", "on_demand", "active"). Consistent with the stored-word rule for statuses and better than a CSS-cased id, but it is a visible change not in §3.9. RM: one line in the PR's visible-changes list. Not blocking | Low |

### Optimisation Suggestions

- The call table's footer always says "Total" (`AnalyticsTable.tsx:245-247`), while the aggregate footer says "Subtotal" for the same drilled state. That matches §3.3 and is right (a run's calls sum to the run's total), so no change; noted only so QA does not file it.
- `formatLatency(…, 'detail')` keeps the old modal's unrounded sub-second text (a fractional `latencyMs` would show "999.4ms"). Same as before; leave it.

### Code Approved for QA: Yes

No must-fix before commit. C-1 and C-2 are Low and may ride as follow-ups; C-2 only asks RM for one PR line. QA runs next (sequential, full cycle), including the §7.1 browser checks in light and dark schemes.

## QA Report — 2026-10-11

**QA — 2026-10-11**
**Test mode:** full
**Strategy used:** A (unit, existing) + B-style real-page render tests in jsdom (the page with the route mocked at `fetch`) + throwaway probe tests; D listed for TL (browser). No route or data change in this slice, so no live Supabase run is needed.
**Focus:** ui (table, drill links, drawer, focus, states), a11y, schema of the rendered metadata
**Skipped:** live browser checks (handed to TL, §7.1 list below)
**Input source:** TL prompt (probes named there) + workplan §6 / §7 + SA code review notes
**Base:** PR #295 is still OPEN (`gh pr view 295`), so the branch still sits on `feature/admin-layout-l2a`; nothing to re-run on `origin/main` yet (S-7).

### Commands and results (run by QA)

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/admin/analytics app/api/admin/token-usage app/admin/components/layout app/admin/__tests__ app/admin/audit-trail app/admin/business-os-llm app/admin/users app/admin/finance app/admin/components/__tests__ lib/admin/health lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **92 suites, 2,492 tests, all passed** (96 s). Only console noise: the pre-existing "Not implemented: window.scrollTo" from framer-motion in `app/admin/users/__tests__/businessOsPanel.render.test.tsx` (not touched by L-2b) |
| 2 | `npm run test:bos-entitlements` | **233 suites, 6,382 tests, all passed** |
| 3 | Scoped `tsc`, scratch tsconfig in the session scratchpad (`extends` the worktree `tsconfig.json`, `incremental: false`; includes `next-env.d.ts`, `app/admin/analytics/**`, the shared layout folder and its tests, `components/ui/sheet.tsx`, `audit-trail/page.tsx`). **Canary run:** a scratch file importing `readMeta` and assigning `.model` to a `number` | exactly one error: `canary.ts(3,14): error TS2322: Type 'string or null' is not assignable to type 'number'` (the union is written in words here) |
| 4 | Same, **clean run** (canary file not included) | **0 errors**; `--listFiles` shows 18 files of `app/admin/analytics` were checked |
| 5 | `npm run lint:hooks`; `npx eslint app/admin/analytics app/admin/components/layout/KpiStrip.tsx app/admin/components/layout/adminTable.ts` | both clean, no output |
| 6 | grep of the analytics folder's sources for `console.`, `toLocaleString()`, `emerald`, `green`, `framer-motion`, `as string`, `as number`, `: any` | two comment-only hits (L-2a doc comments), no code |
| 7 | Throwaway probe suite (34 cases) in `app/admin/analytics/__tests__/`, run twice, once with `TZ=Asia/Jerusalem` (the probe confirmed `getTimezoneOffset()` = -180 for 2026-09-03) | **34 / 34 passed** both runs. Deleted afterwards; `git status --short` identical to before (diffed) |
| 8 | Mutation spot check: close-when-gone effect disabled in `page.tsx` (restored from a copy, md5 OK) | T-7, T-8 and QA probes Q-3, Q-13 all red: the probes really pin the B-1 path |

### Edge cases probed

| # | Case | Result |
|---|---|---|
| Q-1 | Every group-by dimension: BOS 8 dimensions (4 headers), All 10 dimensions (7 headers); table name "AI cost by {dimension}"; headers unique, all `scope="col"`; first header text-aligned, the rest `text-right`; first cell plain, the rest `tabular-nums` | ✅ all 18 views |
| Q-2 | Focus after activating a drill link (plain click; a keyboard Enter is the same click in browsers) | ⚠️ the link's row is replaced by the drilled rows and focus falls to `<body>` (see QA-B1) |
| Q-3 | Drawer open on a call → Back (URL loses `execution`) → Forward (URL gets it back) | ✅ drawer closes when the run leaves, focus on the content wrapper (connected, not `body`); Forward shows the calls with the drawer closed |
| T-7 / T-8 | Refresh in flight → Open → read lands without the call; success → failure → retry | ✅ (Dev tests, re-run green) |
| Q-13 | Drawer open → read fails → Try again lands **without** the call → a later read brings it back | ✅ no dialog at any point; focus on the wrapper after the failure; no "$0.00" and no empty sentence on retry; never reopens |
| Q-14 | Drawer open while a read lands with the **same** call carrying new figures | ✅ stays open, shows the fresh cost (reads by id, not a snapshot) |
| Q-4 | Two calls labelled "gpt-4o call" | ✅ Open names unique ("Open details for call 1, gpt-4o call" / "call 2, …") |
| Q-4 | Call with no `metadata` at all | ✅ row: latency "—", status "Unknown"; drawer: Model / Provider "Unknown", Time "—", title "Call details" (no suffix), no Classification / Activity / System sections |
| Q-4 | `latencyMs: 0`, `success: 'yes'` (wrong type), `model: ''`, `timestamp: 'not-a-date'` | ✅ "—" in the cell, no Latency field, "Unknown" status, Model "Unknown", Time "—". Title reads "Call details —" (E-1) |
| Q-4 | Huge figures: cost 123,456,789.12345, tokens 9.9 billion | ✅ "$123,456,789.1235", no overflow error; tokens "9900.0M" (E-2, pre-existing formatter) |
| Q-5 | Run card with run status `running`, `cancelled` → `info`; `failed` → `danger`; `''` / missing → "Unknown" (`unknown`); no agent status, no plugins, no mode, no start / end | ✅ chip words and tones as specified; no "Agent status" row; no plugins row; Started "—", Completed "In progress"; sub-line "Agent run" |
| Q-6 | Footer word for each drill / business / category field alone (provider, model, activity, account, request_type, feature, component, endpoint, agent, category) | ✅ "Subtotal" for all ten; "Total" for `scope=all`, `period=7d`, `group_by=model` (not drill filters) |
| Q-7 | Top 3 by cost with 4 rows out of order | ✅ three rows, sorted by cost: "Big $0.666 67% of cost", "Mid $0.33 33% of cost", "Small $0.004 0% of cost" (E-3) |
| Q-8 | UTC with the process in Asia/Jerusalem (UTC+3 on that date): call at 23:30Z | ✅ drawer name "Call details 2026-09-03 23:30 UTC", Time the same; run card Started "2026-09-03 10:00 UTC" |
| Q-9 | Overlay close (pointerdown outside); no request on open | ✅ closes, focus back on that row's Open button; request count unchanged across open and close |
| T-6 | Escape and the X ("Close") | ✅ (Dev test, re-run green) |
| Q-11 | Chips: text and icon | ✅ both the call chip and the run chip have words and an `aria-hidden="true"` svg |
| Q-12 | Empty result with only `scope=all` set | ✅ sentence + hint; "Clear filters" shown (scope is a filter, as the bar's Clear) and returns to the default view (E-4) |
| Q-15 | Alt-click and middle click (`auxclick`) on a drill link | ✅ not prevented, no request (T-3 covers ctrl / meta / shift / middle `click`) |
| L-2a M-1 | Breadcrumbs reset per level | ✅ the L-2a pins in `bosLens.render` / `analytics.layout.render` pass unedited apart from the planned `rowFor` edit |

### Accessibility in jsdom

| Check | Result |
|---|---|
| One `h1` | ✅ "AI cost & usage" only; card titles `h2` ("Quick stats", "Top 3 by cost", the agent name); drawer title `h2`, its sections `h3` |
| Table headers | ✅ `scope="col"` on every header, unique texts in every dimension and both scopes (Q-1) |
| Drill link name | ✅ exactly the label, even with context chips ("2 users 3 agents 4 executions") and the category word in the same cell |
| Open button names | ✅ "Open details for call {n}, {label}", unique |
| Dialog name | ✅ "Call details {UTC time}"; "Call details" when there is no time |
| Chips | ✅ words + hidden icon |
| Landmarks | ✅ no `section`, `aside`, `nav` or `role="region"` on the page (count 0) |

### Issues Found

#### Bugs (must fix before commit)

None at High or Medium.

1. **QA-B1: focus is lost after a drill link is used** — File: `app/admin/analytics/page.tsx` (`drill`), `components/AnalyticsTable.tsx` (`DrillLink`) — Severity: **Low** (not blocking)
   - Steps to reproduce: Tab to a row name (e.g. "openai"), press Enter (or click it).
   - Expected: focus stays somewhere meaningful on the page (the standard's "never `<body>`" rule that the drawer follows, D-6 / QA B-1).
   - Actual: the drilled rows replace the old ones, the focused `<a>` is removed, and `document.activeElement` is `<body>` (probe Q-2). Chrome and Firefox keep the sequential focus starting point, so the next Tab usually continues near the table, but a screen reader announces nothing and Safari restarts from the top. Not a regression (rows were not focusable at all before L-2b); new with the keyboard path. Suggested fix for Dev, if taken: after `setFilters` in `drill`, move focus to the always-mounted content wrapper (`contentRef`), or keep it on the table caption / count line. Can ride as a follow-up.

#### Performance Issues (should fix)

None. Opening the drawer sends no request (T-5, Q-9).

#### Edge Cases (nice to fix)

1. **E-1** A non-empty but invalid `timestamp` gives the drawer title "Call details —" (the suffix is `formatUtc` of a bad value). The route always sends `created_at`, so this is not reachable today.
2. **E-2** Tokens above a billion read "9900.0M" (`formatNumber` has no B step). Pre-existing L-2a formatter, unchanged by this slice.
3. **E-3** A share below 0.5% reads "0% of cost" in Top 3 by cost. Pre-existing rounding (`toFixed(0)`), now with words.
4. **E-4** In the empty state, "Clear filters" also shows when only `scope=all` is set, and returns to Business OS scope. Same rule as the bar's Clear (`isDefault` counts the scope). Consistent, noted only.
5. **E-5** In the empty state the count line ("Showing 0 items") and the Quick stats card still show (deviation 4; the old side panel also stayed). Noted only.
6. Not filed (SA asked QA not to): the call table footer always says "Total".

### Browser checks for TL (signed-in admin, DevTools Network open, light and dark)

The workplan §7.1 list B-B1 to B-B11 stands. In addition:

| # | Do | Expect |
|---|---|---|
| B-QA1 (SA C-2) | Open a call and a run card | Provider ("openai"), the run card's mode ("on_demand") and Agent status ("active") show as the stored lowercase words (no `capitalize`); RM names this in the PR's visible-changes list |
| B-QA2 (QA-B1) | Tab to a row name, press Enter | it drills in place with one request; note where the next Tab lands (Chrome / Firefox: near the table is acceptable for this slice) |
| B-QA3 | Ctrl-click and middle-click a row name | a new tab at the drilled view; the current tab sends no request |
| B-QA4 | Browser Back while a call panel is open | the panel closes when the run leaves, focus stays on the page; Forward does not reopen it |
| B-QA5 | A call without a stored outcome, if one exists | "Unknown" chip in the table and in the panel |
| B-QA6 (B-B5, SA M-2) | Run card | both "Run status" (chip) and "Agent status" (plain text) |
| B-QA7 | Dark and light | the panel X is visible and rings on focus; the only green is the Succeeded / completed chip |

### Final Status

- [x] All acceptance criteria pass — ready for commit (one Low bug and five edge cases recorded, none blocking)
- [ ] Issues found — Dev must address before commit

**Verdict: PASS WITH NOTES.** No High or Medium bug. QA-B1 (focus after a drill, Low) and E-1 to E-5 may ride as follow-ups. RM may commit and open the PR under the user's fast-track; if #295 merges first, rebase onto `origin/main` and re-run command 1 there (S-7).

## Commit Info

| Field | Value |
|---|---|
| Branch | `feature/admin-layout-l2b` |
| Commit | 1357ad92 — feat(admin): admin layout standard L-2b — AI cost & usage table, call drawer, run card, summary cards |
| Merge of origin/main | abb05b04 (brought in #294: `app/admin/users/page.tsx`, `TestAccountCleanupPanel`; no conflicts) |
| PR | #296 — https://github.com/AgentsPilot/neuronforge/pull/296 (base `main`; contains #295 until it merges) |
| Tests (RM, after merge) | admin Jest set 92 suites / 2,493 tests passed; test:bos-entitlements 233 / 6,382 passed; lint:hooks clean |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Workplan written | Dev: L-2b plan (one slice, about 3.75 days); decisions on drill links vs the Open button, the static run card, the drawer B-1 handling, the extraction; Q-1 to Q-8 for SA |
| 2026-10-11 | SA workplan review | APPROVED WITH CONDITIONS. Q-1 full cycle (R-7), Q-3 export `isPlainLeftClick` from `KpiStrip.tsx` instead of a copy, Q-2 / Q-4 / Q-5 / Q-7 / Q-8 approved, Q-6 approved with "Unknown". M-1 to M-4 (path and export, keep the agent status, "Unknown", drawer mounted at page level); S-1 to S-7; no user question |
| 2026-10-11 | M-1 to M-4 applied; implemented | Dev: workplan edits per SA M-1 to M-4 (and the S-1, S-2, S-3, S-6, S-7 notes); code complete, uncommitted; V-1 to V-8 recorded under Implementation Notes; deviation 1 adds a mounted-drawer pin to T-8 so mutation (o) is red |
| 2026-10-11 | SA code review | CODE APPROVED, no must-fix. M-1 to M-4 and S-1 to S-7 verified; deviation 1 (the `drawer-mounted` test marker) accepted; SA scoped tsc zero errors (canary proven), 43 suites / 935 tests green; Low C-1 (reuse the totals type), C-2 (name the dropped `capitalize` in the PR) |
| 2026-10-11 | QA | PASS WITH NOTES. 92 suites / 2,492 tests and entitlements 233 / 6,382 green; scoped tsc 0 errors (canary proven); 34 throwaway probes green (one run under Asia/Jerusalem), deleted. Low QA-B1 (focus to `body` after a drill link), edge cases E-1 to E-5; browser list for TL |
| 2026-10-11 | QA-B1 + C-1 fixed | Dev (TL decision): focus moves to the content wrapper after a drill (new render test, mutation red then restored); `AnalyticsTotals` aliases `DrillDownResponse['totals']`; Status ready for RM |
| 2026-10-11 | Committed + PR | RM fast-track: commit 1357ad92, origin/main merged (abb05b04), PR #296; tests green; awaiting checks + user merge |
